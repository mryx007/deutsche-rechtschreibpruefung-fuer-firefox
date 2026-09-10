// Regression tests for the shared field state and underline renderers.
// No browser package is required: DOM range endpoints and delayed messages are
// represented by small deterministic fakes.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const contentPath = path.join(__dirname, "..", "extension", "content", "content.js");
const cssPath = path.join(__dirname, "..", "extension", "content", "content.css");
const manifestPath = path.join(__dirname, "..", "extension", "manifest.json");
const source = fs.readFileSync(contentPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function functionSource(name) {
  const markers = [`  function ${name}(`, `  async function ${name}(`];
  const marker = markers.find(candidate => source.includes(candidate));
  const start = marker ? source.indexOf(marker) : -1;
  assert(start >= 0, `function ${name} exists`);
  const nextSync = source.indexOf("\n  function ", start + marker.length);
  const nextAsync = source.indexOf("\n  async function ", start + marker.length);
  const section = source.indexOf("\n  // =========================================================================", start + marker.length);
  const candidates = [nextSync, nextAsync, section].filter(index => index >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.lastIndexOf("\n})();");
  return source.slice(start + 2, end).trim();
}

function compile(name, dependencies = {}) {
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  return Function(...names, `return (${functionSource(name)});`)(...values);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const fakeDocument = {
    createTreeWalker(root) {
      let index = 0;
      return { nextNode: () => root.nodes[index++] || null };
    },
    createRange() {
      return {
        setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
        setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
      };
    }
  };
  const NodeFilter = { SHOW_TEXT: 4 };
  const StaticRange = class {
    constructor(points) { Object.assign(this, points); }
  };

  const buildTextIndex = compile("buildTextIndex", { document: fakeDocument, NodeFilter });
  const resolveTextPoint = compile("resolveTextPoint");
  const getTextOffset = compile("getTextOffset");
  const getRangeForOffsets = compile("getRangeForOffsets", {
    document: fakeDocument,
    StaticRange,
    buildTextIndex,
    resolveTextPoint
  });

  const first = { nodeType: 3, textContent: "ver" };
  const middle = { nodeType: 3, textContent: "st" };
  const last = { nodeType: 3, textContent: "ee" };
  const root = { nodes: [first, middle, last] };
  const index = buildTextIndex(root);

  assert.strictEqual(index.text, "verstee", "split text nodes form one canonical field string");
  assert.deepStrictEqual(resolveTextPoint(index, 3, true), { node: middle, offset: 0 }, "start boundary uses following node");
  assert.deepStrictEqual(resolveTextPoint(index, 3, false), { node: first, offset: 3 }, "end boundary uses preceding node");
  assert.strictEqual(getTextOffset(index, last, 1), 6, "node-local caret maps to global offset");

  const liveRange = getRangeForOffsets(root, 0, 7, index, false);
  assert.strictEqual(liveRange.startContainer, first, "range starts in first formatted node");
  assert.strictEqual(liveRange.startOffset, 0);
  assert.strictEqual(liveRange.endContainer, last, "range ends in last formatted node");
  assert.strictEqual(liveRange.endOffset, 2);

  const staticRange = getRangeForOffsets(root, 2, 6, index, true);
  assert(staticRange instanceof StaticRange, "highlight renderer creates StaticRange snapshots");
  assert.strictEqual(staticRange.startContainer, first);
  assert.strictEqual(staticRange.startOffset, 2);
  assert.strictEqual(staticRange.endContainer, last);
  assert.strictEqual(staticRange.endOffset, 1);

  const isTextInput = compile("isTextInput");
  assert.strictEqual(isTextInput({ tagName: "INPUT", type: "search", disabled: false, readOnly: false }), true,
    "normal search inputs use the input renderer");
  assert.strictEqual(isTextInput({ tagName: "TEXTAREA", disabled: false, readOnly: false }), true,
    "textareas use the input renderer");
  assert.strictEqual(isTextInput({ tagName: "INPUT", type: "password", disabled: false, readOnly: false }), false,
    "password fields remain excluded");

  const fieldKind = compile("fieldKind", { isTextInput });
  const findReplacementField = compile("findReplacementField", {
    fieldKind,
    getTargetContainer: () => null,
    getDeepActiveElement: () => null,
    readFieldText: field => field.value || field.textContent || ""
  });
  const removedSearch = { tagName: "INPUT", type: "search", disabled: false, readOnly: false, isConnected: false };
  const newSearch = { tagName: "INPUT", type: "search", disabled: false, readOnly: false, isConnected: true, value: "verstee" };
  assert.strictEqual(findReplacementField(removedSearch, { lastText: "verstee" }, [newSearch]), newSearch,
    "a replaced search field is matched by field kind and canonical text");

  const body = { parentNode: null };
  const editorArea = { parentNode: body };
  const chatMessages = { parentNode: body };
  const popupField = { parentNode: editorArea, isConnected: true };
  const fakeWindow = {};
  const layoutDocument = { documentElement: { parentNode: null }, body };
  const composedContains = compile("composedContains");
  const scrollMovesMenuAnchor = compile("scrollMovesMenuAnchor", {
    window: fakeWindow,
    document: layoutDocument,
    activeMenuField: popupField,
    composedContains
  });
  assert.strictEqual(scrollMovesMenuAnchor({ type: "scroll", target: chatMessages }), false,
    "an unrelated Twitch message-list scroll keeps the popup open");
  assert.strictEqual(scrollMovesMenuAnchor({ type: "scroll", target: editorArea }), true,
    "scrolling an ancestor of the input closes the now-misaligned popup");
  assert.strictEqual(scrollMovesMenuAnchor({ type: "resize", target: fakeWindow }), true);

  const errorStillMatches = compile("errorStillMatches");
  assert.strictEqual(errorStillMatches("ein verstee wort", { word: "verstee", start: 4, end: 11 }), true);
  assert.strictEqual(errorStillMatches("ein versteeX wort", { word: "verstee", start: 4, end: 11 }), false,
    "an offset that became part of another word is rejected");

  const replacementMeta = { errors: [], lastText: "verstee" };
  const removedMeta = { errors: [{ word: "verstee", start: 0, end: 7 }], lastText: "verstee", detachedSince: 0 };
  let replacementRendered = 0;
  let replacementScanned = 0;
  const recoverDetachedField = compile("recoverDetachedField", {
    findReplacementField,
    collectReplacementFields: () => [newSearch],
    readFieldText: field => field.value || "",
    errorStillMatches,
    retireField: () => {},
    getInputMeta: () => replacementMeta,
    renderField: () => { replacementRendered++; },
    ensureStateWatch: () => {},
    scheduleScan: () => { replacementScanned++; },
    pendingDetachedFields: new Set(),
    activeMenuField: null,
    closeMenu: () => {},
    Date
  });
  recoverDetachedField(removedSearch, removedMeta);
  assert.deepStrictEqual(replacementMeta.errors, removedMeta.errors,
    "valid offsets move atomically to an equivalent replacement root");
  assert.strictEqual(replacementRendered, 1);
  assert.strictEqual(replacementScanned, 1, "replacement is immediately revalidated");

  let inputRenders = 0;
  let editableRenders = 0;
  const invalidateFieldText = compile("invalidateFieldText", {
    isTextInput: el => el.kind === "input",
    syncOverlay: () => { inputRenders++; },
    rebuildHighlights: () => { editableRenders++; }
  });
  const inputMeta = { revision: 4, lastText: "verstee", errors: [{ word: "verstee", start: 0, end: 7 }] };
  assert.strictEqual(invalidateFieldText({ kind: "input" }, inputMeta, "verstehe"), true);
  assert.strictEqual(inputMeta.revision, 5, "a changed value advances the field revision");
  assert.deepStrictEqual(inputMeta.errors, [], "all offsets are invalidated atomically");
  assert.strictEqual(inputRenders, 1);
  assert.strictEqual(invalidateFieldText({ kind: "input" }, inputMeta, "verstehe"), false,
    "unchanged value does not redraw");
  invalidateFieldText({ kind: "editable" }, { revision: 0, lastText: "a", errors: [1] }, "b");
  assert.strictEqual(editableRenders, 1);

  const pending = [];
  const browser = {
    runtime: {
      sendMessage() {
        const item = deferred();
        pending.push(item);
        return item.promise;
      }
    }
  };
  let rendered = 0;
  const asyncMeta = {
    revision: 0,
    spellingRequest: 0,
    errors: [],
    lastText: "verstee"
  };
  const field = { isConnected: true, value: "verstee" };
  const scanField = compile("scanField", {
    getInputMeta: () => asyncMeta,
    readFieldText: el => el.value,
    browser,
    errorStillMatches,
    renderField: () => { rendered++; }
  });

  const staleScan = scanField(field);
  field.value = "verstehe";
  asyncMeta.revision++;
  pending.shift().resolve({ errors: [{ word: "verstee", start: 0, end: 7 }] });
  await staleScan;
  assert.deepStrictEqual(asyncMeta.errors, [], "response from an older field revision is discarded");
  assert.strictEqual(rendered, 0, "stale response never reaches a renderer");

  field.value = "verstee";
  asyncMeta.revision++;
  asyncMeta.lastText = field.value;
  const olderSameTextScan = scanField(field);
  const newestSameTextScan = scanField(field);
  const older = pending.shift();
  const newest = pending.shift();
  newest.resolve({ errors: [{ word: "verstee", start: 0, end: 7, suggestion: "verstehe" }] });
  await newestSameTextScan;
  older.resolve({ errors: [] });
  await olderSameTextScan;
  assert.strictEqual(asyncMeta.errors.length, 1, "older same-text request cannot overwrite the newest result");
  assert.strictEqual(rendered, 1);

  assert(!source.includes("function adjustErrors"), "fragile single-edit offset shifting was removed");
  assert(!source.includes("scheduleDomSync"), "global DOM-driven redraw loop was removed");
  assert(!source.includes("overlayMutationObserver"), "overlay mutations cannot request another overlay redraw");
  assert(!source.includes("lifecycleObserver"), "field replacement does not require a document-wide mutation observer");
  assert(source.includes("recoverDetachedField(el, meta)"),
    "the bounded state watcher recovers a detached field generically");
  assert(source.includes('meta.editableObserver.observe(ce, { childList: true, characterData: true, subtree: true })'),
    "rich editor changes are observed only inside their field");
  assert(source.includes('document.addEventListener("compositionstart"') && source.includes('document.addEventListener("compositionend"'),
    "IME composition has an explicit lifecycle");
  assert(source.includes("getDeepActiveElement") && source.includes("shadowRoot?.activeElement"),
    "open shadow-root fields participate in active-field tracking");
  assert(source.includes("meta.renderedOverlayKey"), "input mirror DOM is rebuilt only when text/errors change");
  assert(/\.sc-mirror-overlay\s*\{[\s\S]*position:\s*fixed\s*!important[\s\S]*pointer-events:\s*none\s*!important/.test(css),
    "search/input overlay is viewport-aligned and click-through");
  assert(manifest.content_scripts.some(entry => entry.all_frames === true), "the content controller runs in frames");

  console.log("PASS: unified underline state, split ranges, search inputs, races, IME, shadow roots and frames");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
