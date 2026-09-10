/**
 * German Smart Spellcheck - Content Script (Kompakt & Schlank)
 */

(() => {
  if (window.__smartSpellcheckLoaded) return;
  window.__smartSpellcheckLoaded = true;

  let activeMenu = null;
  let activeMenuKey = null;
  let activeMenuField = null;
  let nextFieldId = 1;
  const inputMetadata = new WeakMap();

  function disableNativeSpellcheck(el) {
    if (!el) return;
    if (el.spellcheck !== false) el.spellcheck = false;
  }

  function getInputMeta(el) {
    disableNativeSpellcheck(el);
    let meta = inputMetadata.get(el);
    if (!meta) {
      meta = {
        fieldId: nextFieldId++,
        errors: [],
        overlay: null,
        debounceTimer: null,
        contextTimer: null,
        mutationFrame: null,
        editableObserver: null,
        revision: 0,
        spellingRequest: 0,
        contextRequest: 0,
        isComposing: false,
        detachedSince: 0,
        renderedOverlayKey: "",
        overlayPositionKey: "",
        lastText: readFieldText(el)
      };
      inputMetadata.set(el, meta);
    }
    return meta;
  }

  function sameError(a, b) {
    return a && b && a.start === b.start && a.end === b.end && a.word === b.word;
  }

  function removeError(meta, error) {
    meta.errors = meta.errors.filter(item => !sameError(item, error));
  }

  function errorStillMatches(text, error) {
    if (!Number.isInteger(error.start) || !Number.isInteger(error.end) ||
        text.slice(error.start, error.end) !== error.word) return false;
    const connector = /[\p{L}\p{M}'\u2018\u2019\u02BC\-\u2010-\u2015\u2212]/u;
    const before = error.start > 0 ? text[error.start - 1] : "";
    const after = error.end < text.length ? text[error.end] : "";
    return (!before || !connector.test(before)) && (!after || !connector.test(after));
  }

  function isTextInput(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      return ["text", "search", "email", "url", "tel", ""].includes((el.type || "").toLowerCase());
    }
    return false;
  }

  function getTargetContainer(target) {
    if (!target) return null;
    const elNode = target.nodeType === 3 ? target.parentElement : target;
    if (!elNode || elNode.disabled || elNode.readOnly) return null;
    if (isTextInput(elNode)) return elNode;
    if (!elNode.isContentEditable) {
      const ce = elNode.closest?.("[contenteditable='true'], [contenteditable=''], .ProseMirror, [role='textbox']");
      return ce?.isContentEditable ? ce : null;
    }
    let ce = elNode;
    while (ce.parentElement && ce.parentElement.isContentEditable) {
      ce = ce.parentElement;
    }
    const editorRoot = ce.closest?.("[contenteditable='true'], [contenteditable=''], .ProseMirror, [role='textbox']");
    if (editorRoot?.isContentEditable) {
      ce = editorRoot;
    }
    return ce;
  }

  function getEventTargetContainer(event) {
    // Bei Web Components wird event.target außerhalb des Shadow DOM auf den
    // Host umgebogen. composedPath() enthält bei offenen Shadow Roots dennoch
    // das tatsächliche Input/Contenteditable-Element.
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      const container = getTargetContainer(node);
      if (container) return container;
    }
    return getTargetContainer(event?.target);
  }

  // =========================================================================
  // 1. Settings & Singleton Suggestion Menu
  // =========================================================================

  const FONT_PRESETS = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    segoe: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    arial: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
    verdana: 'Verdana, Geneva, sans-serif',
    roboto: '"Roboto", "Inter", "Helvetica Neue", Arial, sans-serif',
    georgia: 'Georgia, Cambria, "Times New Roman", Times, serif',
    consolas: 'Consolas, "Courier New", Courier, monospace',
    comic: '"Comic Sans MS", "Chalkboard SE", cursive, sans-serif'
  };

  function resolveFontFamily(familyKey, customFont) {
    if (familyKey === "custom" && customFont?.trim()) {
      return `"${customFont.trim()}", sans-serif`;
    }
    return FONT_PRESETS[familyKey] || FONT_PRESETS.system;
  }

  let currentSettings = {
    fontSize: 13.5,
    fontWeight: 600,
    fontFamily: "system",
    customFont: "",
    textColor: "#606060",
    bgColor: "#ffffff",
    labelColor: "#737373",
    letterSpacing: 0.65,
    opacity: 100
  };

  function isColorDark(hex) {
    if (!hex || typeof hex !== "string") return false;
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    const num = parseInt(c, 16);
    if (isNaN(num) || c.length !== 6) return false;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance < 128;
  }

  function applySpellcheckSettings(settings) {
    if (!settings) return;
    currentSettings = { ...currentSettings, ...settings };

    let styleEl = document.getElementById("sc-user-settings");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "sc-user-settings";
      (document.head || document.documentElement).appendChild(styleEl);
    }
    const resolvedFont = resolveFontFamily(currentSettings.fontFamily, currentSettings.customFont);
    const fontSize = currentSettings.fontSize ?? 13.5;
    const fontWeight = currentSettings.fontWeight ?? 600;
    const textColor = currentSettings.textColor || "#606060";
    const bgColor = currentSettings.bgColor || "#ffffff";
    const labelColor = currentSettings.labelColor || "#737373";
    const letterSpacing = Math.max(0, currentSettings.letterSpacing ?? 0.65);
    const wordOpacity = (currentSettings.opacity ?? 100) / 100;
    const isDark = isColorDark(bgColor);
    const borderColor = isDark ? "rgba(255, 255, 255, 0.15)" : "#e5e5e5";
    const hoverBg = isDark ? "rgba(255, 255, 255, 0.08)" : "#f0f0f0";
    const addBg = isDark ? "rgba(34, 197, 94, 0.20)" : "rgba(22, 163, 74, 0.14)";
    const addColor = isDark ? "#4ade80" : "#16a34a";
    const addHover = isDark ? "rgba(34, 197, 94, 0.32)" : "rgba(22, 163, 74, 0.24)";
    const addHoverColor = isDark ? "#86efac" : "#15803d";
    const ignBg = isDark ? "rgba(239, 68, 68, 0.20)" : "rgba(239, 68, 68, 0.14)";
    const ignColor = isDark ? "#f87171" : "#dc2626";
    const ignHover = isDark ? "rgba(239, 68, 68, 0.32)" : "rgba(239, 68, 68, 0.24)";
    const ignHoverColor = isDark ? "#fca5a5" : "#b91c1c";

    styleEl.textContent = `
      :root {
        --sc-font-family: ${resolvedFont} !important;
        --sc-font-size: ${fontSize}px !important;
        --sc-font-weight: ${fontWeight} !important;
        --sc-text: ${textColor} !important;
        --sc-bg: ${bgColor} !important;
        --sc-border: ${borderColor} !important;
        --sc-hover-bg: ${hoverBg} !important;
        --sc-text-dim: ${labelColor} !important;
        --sc-letter-spacing: ${letterSpacing}px !important;
        --sc-word-opacity: ${wordOpacity} !important;
        --sc-btn-add-bg: ${addBg} !important;
        --sc-btn-add-color: ${addColor} !important;
        --sc-btn-add-hover: ${addHover} !important;
        --sc-btn-add-hover-color: ${addHoverColor} !important;
        --sc-btn-ignore-bg: ${ignBg} !important;
        --sc-btn-ignore-color: ${ignColor} !important;
        --sc-btn-ignore-hover: ${ignHover} !important;
        --sc-btn-ignore-hover-color: ${ignHoverColor} !important;
      }
    `;

    if (activeMenu) {
      activeMenu.style.setProperty("--sc-font-family", resolvedFont);
      activeMenu.style.setProperty("--sc-font-size", `${fontSize}px`);
      activeMenu.style.setProperty("--sc-font-weight", `${fontWeight}`);
      activeMenu.style.setProperty("--sc-text", textColor);
      activeMenu.style.setProperty("--sc-bg", bgColor);
      activeMenu.style.setProperty("--sc-border", borderColor);
      activeMenu.style.setProperty("--sc-hover-bg", hoverBg);
      activeMenu.style.setProperty("--sc-text-dim", labelColor);
      activeMenu.style.setProperty("--sc-letter-spacing", `${letterSpacing}px`);
      activeMenu.style.setProperty("--sc-word-opacity", wordOpacity.toString());
      activeMenu.style.setProperty("--sc-btn-add-bg", addBg);
      activeMenu.style.setProperty("--sc-btn-add-color", addColor);
      activeMenu.style.setProperty("--sc-btn-add-hover", addHover);
      activeMenu.style.setProperty("--sc-btn-add-hover-color", addHoverColor);
      activeMenu.style.setProperty("--sc-btn-ignore-bg", ignBg);
      activeMenu.style.setProperty("--sc-btn-ignore-color", ignColor);
      activeMenu.style.setProperty("--sc-btn-ignore-hover", ignHover);
      activeMenu.style.setProperty("--sc-btn-ignore-hover-color", ignHoverColor);
    }
  }

  if (typeof browser !== "undefined" && browser.storage?.local) {
    browser.storage.local.get("sc_settings").then((res) => {
      if (res?.sc_settings) {
        applySpellcheckSettings(res.sc_settings);
      }
    }).catch(() => {});

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") {
        if (changes.sc_settings?.newValue) {
          applySpellcheckSettings(changes.sc_settings.newValue);
        }
        if (changes.sc_user_dict || changes.sc_ignored_words) {
          document.querySelectorAll("textarea, input, [contenteditable='true'], [contenteditable=''], .ProseMirror, [role='textbox']").forEach((el) => {
            if (isTextInput(el) || el.isContentEditable) scheduleScan(el);
          });
        }
      }
    });
  }

  function clearWordGlobally(word) {
    if (!word) return;
    for (const el of activeOverlayInputs) {
      if (!el.isConnected) {
        activeOverlayInputs.delete(el);
        continue;
      }
      const meta = inputMetadata.get(el);
      if (meta && meta.errors.some(error => error.word === word)) {
        meta.errors = meta.errors.filter(error => error.word !== word);
        syncOverlay(el, meta);
      }
    }
    for (const el of activeEditableElements) {
      if (!el.isConnected) {
        activeEditableElements.delete(el);
        continue;
      }
      const meta = inputMetadata.get(el);
      if (meta && meta.errors.some(error => error.word === word)) {
        meta.errors = meta.errors.filter(error => error.word !== word);
      }
    }
    rebuildHighlights();
  }

  function closeMenu() {
    document.querySelectorAll(".sc-suggestion-menu").forEach((el) => el.remove());
    activeMenu = null;
    activeMenuKey = null;
    activeMenuField = null;
  }

  function showMenu(targetRect, word, suggestions, onSelect, onIgnore, ownerField) {
    closeMenu();

    const menu = document.createElement("div");
    menu.className = "sc-suggestion-menu";
    const resolvedFont = resolveFontFamily(currentSettings.fontFamily, currentSettings.customFont);
    const wordOpacity = (currentSettings.opacity ?? 100) / 100;
    const isDark = isColorDark(currentSettings.bgColor || "#ffffff");
    const borderColor = isDark ? "rgba(255, 255, 255, 0.15)" : "#e5e5e5";
    const hoverBg = isDark ? "rgba(255, 255, 255, 0.08)" : "#f0f0f0";
    const addBg = isDark ? "rgba(34, 197, 94, 0.20)" : "rgba(22, 163, 74, 0.14)";
    const addColor = isDark ? "#4ade80" : "#16a34a";
    const addHover = isDark ? "rgba(34, 197, 94, 0.32)" : "rgba(22, 163, 74, 0.24)";
    const addHoverColor = isDark ? "#86efac" : "#15803d";
    const ignBg = isDark ? "rgba(239, 68, 68, 0.20)" : "rgba(239, 68, 68, 0.14)";
    const ignColor = isDark ? "#f87171" : "#dc2626";
    const ignHover = isDark ? "rgba(239, 68, 68, 0.32)" : "rgba(239, 68, 68, 0.24)";
    const ignHoverColor = isDark ? "#fca5a5" : "#b91c1c";
    menu.style.setProperty("--sc-font-family", resolvedFont);
    menu.style.setProperty("--sc-font-size", `${currentSettings.fontSize}px`);
    menu.style.setProperty("--sc-font-weight", `${currentSettings.fontWeight}`);
    menu.style.setProperty("--sc-text", currentSettings.textColor);
    menu.style.setProperty("--sc-bg", currentSettings.bgColor || "#ffffff");
    menu.style.setProperty("--sc-border", borderColor);
    menu.style.setProperty("--sc-hover-bg", hoverBg);
    menu.style.setProperty("--sc-text-dim", currentSettings.labelColor || "#737373");
    menu.style.setProperty("--sc-letter-spacing", `${Math.max(0, currentSettings.letterSpacing ?? 0.65)}px`);
    menu.style.setProperty("--sc-word-opacity", wordOpacity.toString());
    menu.style.setProperty("--sc-btn-add-bg", addBg);
    menu.style.setProperty("--sc-btn-add-color", addColor);
    menu.style.setProperty("--sc-btn-add-hover", addHover);
    menu.style.setProperty("--sc-btn-add-hover-color", addHoverColor);
    menu.style.setProperty("--sc-btn-ignore-bg", ignBg);
    menu.style.setProperty("--sc-btn-ignore-color", ignColor);
    menu.style.setProperty("--sc-btn-ignore-hover", ignHover);
    menu.style.setProperty("--sc-btn-ignore-hover-color", ignHoverColor);

    const header = document.createElement("div");
    header.className = "sc-menu-header";

    const titleSpan = document.createElement("span");
    titleSpan.className = "sc-menu-title";
    titleSpan.textContent = "Vorschläge";
    header.appendChild(titleSpan);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "sc-menu-actions";

    const createSvgLineIcon = (lines) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 14 14");
      svg.setAttribute("width", "11");
      svg.setAttribute("height", "11");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2.2");
      svg.setAttribute("stroke-linecap", "round");
      lines.forEach(([x1, y1, x2, y2]) => {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        svg.appendChild(line);
      });
      return svg;
    };

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "sc-menu-icon-btn sc-menu-btn-add";
    addBtn.title = `„${word}“ zum Wörterbuch hinzufügen`;
    addBtn.appendChild(createSvgLineIcon([[7, 2.5, 7, 11.5], [2.5, 7, 11.5, 7]]));
    addBtn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof browser !== "undefined" && browser.runtime?.sendMessage) {
        browser.runtime.sendMessage({ action: "add_to_dictionary", word }).catch(() => {});
      }
      clearWordGlobally(word);
      onIgnore?.();
      closeMenu();
    });
    actionsDiv.appendChild(addBtn);

    const ignoreBtn = document.createElement("button");
    ignoreBtn.type = "button";
    ignoreBtn.className = "sc-menu-icon-btn sc-menu-btn-ignore";
    ignoreBtn.title = `„${word}“ dauerhaft ignorieren`;
    ignoreBtn.appendChild(createSvgLineIcon([[2.5, 7, 11.5, 7]]));
    ignoreBtn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof browser !== "undefined" && browser.runtime?.sendMessage) {
        browser.runtime.sendMessage({ action: "ignore_word", word }).catch(() => {});
      }
      clearWordGlobally(word);
      onIgnore?.();
      closeMenu();
    });
    actionsDiv.appendChild(ignoreBtn);

    header.appendChild(actionsDiv);
    menu.appendChild(header);

    const list = document.createElement("ul");
    list.className = "sc-menu-list";

    function reposition() {
      const menuRect = menu.getBoundingClientRect();
      const menuHeight = menuRect.height;
      const menuWidth = menuRect.width;

      const spaceBelow = window.innerHeight - targetRect.bottom;
      const spaceAbove = targetRect.top;
      // Oberhalb öffnen, wenn unten nicht genug Platz ist und oben mehr Raum existiert
      const showAbove = (spaceBelow < menuHeight + 10) && (spaceAbove > spaceBelow);

      let top = showAbove
        ? targetRect.top + window.scrollY - menuHeight - 4
        : targetRect.bottom + window.scrollY + 4;

      // Viewport Clamping (vertikal & horizontal)
      const minTop = window.scrollY + 8;
      const maxTop = window.scrollY + window.innerHeight - menuHeight - 8;
      top = Math.max(minTop, Math.min(top, maxTop));

      let left = targetRect.left + window.scrollX;
      const minLeft = window.scrollX + 8;
      const maxLeft = window.scrollX + window.innerWidth - menuWidth - 8;
      left = Math.max(minLeft, Math.min(left, maxLeft));

      menu.style.setProperty("top", `${top}px`, "important");
      menu.style.setProperty("left", `${left}px`, "important");
    }

    let lastRenderedKey = null;
    function renderItems(items) {
      const validItems = items || [];
      const newKey = validItems.map((s) => (typeof s === "string" ? s : s.word || "")).join("||");
      // Wenn die Liste schon gerendert ist und sich nicht verändert hat: Nicht anfassen!
      if (newKey && newKey === lastRenderedKey && list.children.length > 0) {
        return;
      }
      lastRenderedKey = newKey;

      list.textContent = "";
      if (validItems.length === 0) {
        const empty = document.createElement("li");
        empty.className = "sc-menu-empty";
        empty.textContent = "Keine passenden Vorschläge";
        list.appendChild(empty);
      } else {
        validItems.forEach((sug) => {
          const text = typeof sug === "string" ? sug : (sug.word || "");
          const item = document.createElement("li");
          item.className = "sc-menu-item";

          const textSpan = document.createElement("span");
          textSpan.className = "sc-menu-item-text";
          textSpan.textContent = text;
          item.appendChild(textSpan);

          item.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onSelect(text);
            closeMenu();
          });
          list.appendChild(item);
        });
      }
      reposition();
    }

    renderItems(suggestions);
    menu.appendChild(list);

    // Zuerst unsichtbar ins DOM hängen, Position stabil berechnen, dann einblenden
    menu.style.setProperty("visibility", "hidden", "important");
    document.body.appendChild(menu);
    activeMenu = menu;
    activeMenuField = ownerField;
    activeMenuKey = null;

    reposition();
    menu.style.removeProperty("visibility");

    return (newSug) => { if (activeMenu === menu) renderItems(newSug); };
  }

  // Gemeinsamer Öffnungs- und Nachlade-Workflow für alle Feldtypen
  async function openSuggestionMenu(targetRect, error, context, meta, onSelect, onIgnore, ownerField) {
    const { word, start, end, isFirstWord = false } = error;
    const menuKey = `${meta.fieldId}:${start}:${end}:${word}`;
    if (activeMenu && activeMenuKey === menuKey) {
      return; // Bereits für dieses Wort geöffnet - kein Schließen, Neuaufbau oder Zucken!
    }

    if (activeMenu) {
      closeMenu();
    }
    activeMenuKey = menuKey;
    activeMenuField = ownerField;

    let suggestions = Array.isArray(error.quickSuggestions) && error.quickSuggestions.length > 0
      ? [...error.quickSuggestions]
      : (error.suggestion ? [error.suggestion] : []);

    try {
      const fetchPromise = browser.runtime.sendMessage({
        action: "get_suggestions",
        word,
        context,
        isFirstWord,
        start,
        end
      });
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 250));
      const res = await Promise.race([fetchPromise, timeoutPromise]);
      const incoming = (res?.suggestions || []).map(s => typeof s === "string" ? s : (s?.word || "")).filter(Boolean);
      if (incoming.length > 0) {
        suggestions = incoming;
        error.quickSuggestions = incoming;
        error.suggestion = incoming[0];
      }
    } catch {}

    // Wurde während der Abfrage weggeklickt oder ein anderes Wort geöffnet?
    if (activeMenuKey !== menuKey) return;

    showMenu(targetRect, word, suggestions, onSelect, onIgnore, ownerField);
    activeMenuKey = menuKey;
  }

  // =========================================================================
  // 2. Textarea & Input Mirror-Overlay
  // =========================================================================

  const activeOverlayInputs = new Set();
  const activeEditableElements = new Set();
  const styledShadowRoots = new WeakSet();
  const hasHighlightAPI = typeof CSS !== "undefined" && typeof Highlight !== "undefined" && Boolean(CSS.highlights);
  const MIRROR_STYLE_PROPS = [
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant',
    'fontKerning', 'fontOpticalSizing', 'fontFeatureSettings', 'fontVariationSettings',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textAlignLast',
    'textIndent', 'textTransform', 'direction', 'unicodeBidi', 'writingMode', 'textOrientation',
    'wordBreak', 'overflowWrap', 'tabSize'
  ];

  const inputResizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => {
    for (const entry of entries) {
      const input = entry.target;
      const meta = inputMetadata.get(input);
      if (meta?.overlay) {
        positionOverlay(input, meta);
      }
    }
  }) : null;

  function readFieldText(el) {
    return (isTextInput(el) ? el.value : el.textContent) || "";
  }

  function invalidateFieldText(el, meta, text) {
    if (text === meta.lastText) return false;
    meta.revision++;
    meta.lastText = text;
    // Keine alten Offsets verschieben: Rich-Text-Editoren können in einem
    // Schritt mehrere Knoten ersetzen. Bis zum schnellen Neuscan ist eine
    // fehlende Linie korrekt, eine Linie am falschen Wort dagegen nicht.
    meta.errors = [];
    if (isTextInput(el)) syncOverlay(el, meta);
    else rebuildHighlights();
    return true;
  }

  function ensureEditableObserver(ce, meta) {
    if (isTextInput(ce) || meta.editableObserver || typeof MutationObserver === "undefined") return;
    meta.editableObserver = new MutationObserver(() => {
      if (meta.mutationFrame) return;
      meta.mutationFrame = requestAnimationFrame(() => {
        meta.mutationFrame = null;
        if (!ce.isConnected) {
          meta.editableObserver?.disconnect();
          meta.editableObserver = null;
          activeEditableElements.delete(ce);
          rebuildHighlights();
          return;
        }
        const changed = invalidateFieldText(ce, meta, readFieldText(ce));
        if (changed) scheduleScan(ce, 120);
        else rebuildHighlights();
      });
    });
    meta.editableObserver.observe(ce, { childList: true, characterData: true, subtree: true });
  }

  function destroyOverlay(input, meta) {
    if (meta?.overlay) {
      inputResizeObserver?.unobserve(input);
      meta.overlay.remove();
      meta.overlay = null;
      meta.renderedOverlayKey = "";
      meta.overlayPositionKey = "";
    }
    activeOverlayInputs.delete(input);
  }

  function getOverlayHost(input) {
    if (input?.getRootNode?.() !== document) return document.documentElement || document.body;
    const fullscreen = document.fullscreenElement;
    if (fullscreen && fullscreen !== input && fullscreen.contains(input)) return fullscreen;
    const dialog = input.closest?.("dialog[open]");
    if (dialog) return dialog;
    try {
      const popover = input.closest?.(":popover-open");
      if (popover) return popover;
    } catch {}
    return document.documentElement || document.body;
  }

  function ensureOverlay(input, meta) {
    if (!meta.overlay) {
      const overlay = document.createElement("div");
      overlay.className = `sc-mirror-overlay ${input.tagName === "INPUT" ? "sc-mirror-overlay-input" : "sc-mirror-overlay-textarea"}`;
      meta.overlay = overlay;
      inputResizeObserver?.observe(input);
      input.addEventListener("scroll", () => {
        if (meta.overlay) {
          meta.overlay.scrollTop = input.scrollTop;
          meta.overlay.scrollLeft = input.scrollLeft;
        }
      }, { passive: true });
    }
    const host = getOverlayHost(input);
    if (meta.overlay.parentNode !== host) {
      host.appendChild(meta.overlay);
      meta.overlayPositionKey = "";
    }
    return meta.overlay;
  }

  function positionOverlay(input, meta) {
    if (!isTextInput(input) || !input.isConnected || !meta?.overlay) {
      destroyOverlay(input, meta);
      return false;
    }
    ensureOverlay(input, meta);
    const rect = input.getBoundingClientRect();
    const style = window.getComputedStyle(input);
    const isHidden = style.display === "none" ||
                     style.visibility === "hidden" ||
                     style.opacity === "0" ||
                     rect.width === 0 ||
                     rect.height === 0 ||
                     (style.position !== "fixed" && input.offsetParent === null);

    const isSingleLineInput = input.tagName === "INPUT";
    const styleValues = MIRROR_STYLE_PROPS.map(prop => style[prop] ?? "");
    const positionKey = [
      isHidden, isSingleLineInput, input.wrap || "", rect.top, rect.left, rect.width, rect.height,
      input.offsetWidth, input.clientWidth, input.offsetHeight, input.clientHeight, ...styleValues
    ].join("\u0000");

    if (positionKey === meta.overlayPositionKey) {
      meta.overlay.scrollTop = input.scrollTop;
      meta.overlay.scrollLeft = input.scrollLeft;
      return !isHidden;
    }
    meta.overlayPositionKey = positionKey;

    if (isHidden) {
      meta.overlay.style.setProperty("display", "none", "important");
      return false;
    }

    meta.overlay.style.setProperty("display", isSingleLineInput ? "flex" : "block", "important");
    meta.overlay.style.setProperty("white-space", isSingleLineInput || input.wrap === "off" ? "pre" : "pre-wrap", "important");
    meta.overlay.style.setProperty("top", `${rect.top}px`, "important");
    meta.overlay.style.setProperty("left", `${rect.left}px`, "important");
    meta.overlay.style.setProperty("width", `${rect.width}px`, "important");
    meta.overlay.style.setProperty("height", `${rect.height}px`, "important");

    if (isSingleLineInput) {
      meta.overlay.style.alignItems = "center";
      if (style.textAlign === "center") {
        meta.overlay.style.justifyContent = "center";
      } else if (style.textAlign === "right" || style.textAlign === "end") {
        meta.overlay.style.justifyContent = "flex-end";
      } else {
        meta.overlay.style.justifyContent = "flex-start";
      }
    } else {
      meta.overlay.style.alignItems = "normal";
      meta.overlay.style.justifyContent = "normal";
    }

    MIRROR_STYLE_PROPS.forEach((prop, index) => {
      if (styleValues[index] !== undefined) meta.overlay.style[prop] = styleValues[index];
    });

    if (!isSingleLineInput) {
      const scrollbarWidth = input.offsetWidth - input.clientWidth - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0);
      if (scrollbarWidth > 0) {
        meta.overlay.style.paddingRight = `${(parseFloat(style.paddingRight) || 0) + scrollbarWidth}px`;
      }
    }
    meta.overlay.scrollTop = input.scrollTop;
    meta.overlay.scrollLeft = input.scrollLeft;
    return true;
  }

  function syncOverlay(input, meta) {
    if (!isTextInput(input) || !input.isConnected) {
      destroyOverlay(input, meta);
      return;
    }

    const val = input.value || "";
    meta.errors = meta.errors.filter(error => errorStillMatches(val, error));

    if (meta.errors.length === 0) {
      destroyOverlay(input, meta);
      return;
    }

    ensureOverlay(input, meta);
    activeOverlayInputs.add(input);
    ensureStateWatch();
    if (!positionOverlay(input, meta)) return;

    const errors = [...meta.errors].sort((a, b) => a.start - b.start || a.end - b.end);
    const renderKey = `${val}\u0000${errors.map(error => `${error.start}:${error.end}:${error.word}`).join("|")}`;
    if (renderKey === meta.renderedOverlayKey) return;
    meta.renderedOverlayKey = renderKey;

    meta.overlay.textContent = "";
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    for (const error of errors) {
      if (error.start < lastIndex) continue;
      if (error.start > lastIndex) {
        fragment.appendChild(document.createTextNode(val.slice(lastIndex, error.start)));
      }
      const mark = document.createElement("mark");
      mark.className = "sc-mirror-typo";
      mark.textContent = error.word;
      mark.dataset.errorStart = String(error.start);
      mark.dataset.errorEnd = String(error.end);
      fragment.appendChild(mark);
      lastIndex = error.end;
    }

    if (lastIndex < val.length) {
      fragment.appendChild(document.createTextNode(val.slice(lastIndex)));
    }

    meta.overlay.appendChild(fragment);
    meta.overlay.scrollTop = input.scrollTop;
    meta.overlay.scrollLeft = input.scrollLeft;
  }

  function handleInputClick(input, e) {
    const meta = getInputMeta(input);
    if (!meta.overlay || meta.errors.length === 0) return;

    let clickedWord = null;
    let targetRect = null;
    let clickedMark = null;

    for (const m of meta.overlay.querySelectorAll(".sc-mirror-typo")) {
      const r = Array.from(m.getClientRects()).find(rect =>
        rect.width > 0 &&
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top - 3 && e.clientY <= rect.bottom + 6
      );
      if (r) {
        clickedWord = m.textContent.trim();
        targetRect = r;
        clickedMark = m;
        break;
      }
    }
    if (!clickedWord || !targetRect || !clickedMark) return;

    const val = input.value || "";
    const idx = Number(clickedMark.dataset.errorStart);
    const end = Number(clickedMark.dataset.errorEnd);
    const error = meta.errors.find(item => item.start === idx && item.end === end && item.word === clickedWord);
    if (!error || val.slice(idx, end) !== clickedWord) return;

    // 1. Native Caret-Position ermitteln (Gecko/Firefox unterstützt dies nativ auf Inputs/Textareas)
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos && (pos.offsetNode === input || pos.offsetNode?.contains?.(input) || input.contains?.(pos.offsetNode) || pos.offsetNode?.nodeName === "TEXTAREA" || pos.offsetNode?.nodeName === "INPUT")) {
        if (pos.offset <= idx || pos.offset >= end) {
          return;
        }
      }
    }

    // 2. Geometrische Prüfung an den Worträndern (Klick vor dem 1. Buchstaben bzw. hinter dem letzten)
    try {
      const textNode = clickedMark.firstChild;
      if (textNode && textNode.nodeType === 3 && textNode.textContent.length > 0) {
        const firstRange = document.createRange();
        firstRange.setStart(textNode, 0);
        firstRange.setEnd(textNode, 1);
        const firstRect = firstRange.getBoundingClientRect();
        if (firstRect && firstRect.width > 0 &&
            e.clientY >= firstRect.top - 3 && e.clientY <= firstRect.bottom + 6 &&
            e.clientX <= firstRect.left + firstRect.width / 2) {
          return;
        }

        const lastRange = document.createRange();
        lastRange.setStart(textNode, textNode.textContent.length - 1);
        lastRange.setEnd(textNode, textNode.textContent.length);
        const lastRect = lastRange.getBoundingClientRect();
        if (lastRect && lastRect.width > 0 &&
            e.clientY >= lastRect.top - 3 && e.clientY <= lastRect.bottom + 6 &&
            e.clientX >= lastRect.right - lastRect.width / 2) {
          return;
        }
      }
    } catch {}

    const onSelect = (selected) => {
      input.focus();
      try {
        input.setRangeText(selected, idx, end, "end");
      } catch {
        input.value = `${val.slice(0, idx)}${selected}${val.slice(end)}`;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      invalidateFieldText(input, meta, readFieldText(input));
      scheduleScan(input);
    };

    const onIgnore = () => {
      removeError(meta, error);
      syncOverlay(input, meta);
    };

    openSuggestionMenu(targetRect, error, val, meta, onSelect, onIgnore, input);
  }

  // =========================================================================
  // 3. Contenteditable (ohne Text-DOM-Mutation via W3C CSS Custom Highlight API)
  // =========================================================================

  function buildTextIndex(root) {
    const segments = [];
    const chunks = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || "";
      if (!text.length) continue;
      segments.push({ node, start: offset, end: offset + text.length });
      chunks.push(text);
      offset += text.length;
    }
    return { text: chunks.join(""), segments, length: offset };
  }

  function resolveTextPoint(index, offset, isStart) {
    if (!index || offset < 0 || offset > index.length || index.segments.length === 0) return null;
    if (offset === 0) return { node: index.segments[0].node, offset: 0 };
    for (const segment of index.segments) {
      const matches = isStart
        ? offset >= segment.start && offset < segment.end
        : offset > segment.start && offset <= segment.end;
      if (matches) return { node: segment.node, offset: offset - segment.start };
    }
    if (offset === index.length) {
      const last = index.segments[index.segments.length - 1];
      return { node: last.node, offset: last.end - last.start };
    }
    return null;
  }

  function getRangeForOffsets(root, start, end, index = buildTextIndex(root), makeStatic = false) {
    if (start < 0 || end <= start || end > index.length) return null;
    const from = resolveTextPoint(index, start, true);
    const to = resolveTextPoint(index, end, false);
    if (!from || !to) return null;
    if (makeStatic && typeof StaticRange !== "undefined") {
      return new StaticRange({
        startContainer: from.node,
        startOffset: from.offset,
        endContainer: to.node,
        endOffset: to.offset
      });
    }
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  function getTextOffset(index, targetNode, localOffset) {
    const segment = index.segments.find(item => item.node === targetNode);
    if (!segment) return -1;
    return segment.start + Math.max(0, Math.min(localOffset, segment.end - segment.start));
  }

  function ensureHighlightStyleRoot(ce) {
    const root = ce?.getRootNode?.();
    if (!root?.host || styledShadowRoots.has(root)) return;
    try {
      const style = document.createElement("style");
      style.dataset.scHighlightStyle = "";
      style.textContent = `
        ::highlight(sc-typo) {
          text-decoration: underline wavy #dc2626 !important;
          text-decoration-color: #dc2626 !important;
          text-decoration-thickness: 1.5px !important;
          text-underline-offset: 3px !important;
          text-decoration-skip-ink: none !important;
        }
      `;
      root.appendChild(style);
      styledShadowRoots.add(root);
    } catch {}
  }

  function rebuildHighlights() {
    if (!hasHighlightAPI) return;

    const allRanges = [];

    for (const el of activeEditableElements) {
      if (!el.isConnected) {
        activeEditableElements.delete(el);
        continue;
      }
      const meta = inputMetadata.get(el);
      if (!meta || meta.errors.length === 0) {
        activeEditableElements.delete(el);
        continue;
      }

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || (style.position !== "fixed" && el.offsetParent === null)) {
        continue;
      }

      const index = buildTextIndex(el);
      meta.errors = meta.errors.filter(error => errorStillMatches(index.text, error));
      const errors = [...meta.errors].sort((a, b) => a.start - b.start || a.end - b.end);
      for (const error of errors) {
        const range = getRangeForOffsets(el, error.start, error.end, index, true);
        if (range) allRanges.push(range);
      }
    }

    if (allRanges.length > 0) {
      const h = new Highlight();
      for (const r of allRanges) h.add(r);
      CSS.highlights.set("sc-typo", h);
    } else {
      CSS.highlights.delete("sc-typo");
    }
  }

  function updateContentEditableHighlights(ce, meta) {
    if (!hasHighlightAPI || !ce || !ce.isConnected) return;
    ensureHighlightStyleRoot(ce);
    ensureEditableObserver(ce, meta);
    if (meta.errors.length > 0) {
      activeEditableElements.add(ce);
      ensureStateWatch();
    }
    else activeEditableElements.delete(ce);
    rebuildHighlights();
  }

  function getCaretTextOffsetAtPoint(index, x, y) {
    let node = null;
    let offset = -1;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      node = position?.offsetNode || null;
      offset = position?.offset ?? -1;
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      node = range?.startContainer || null;
      offset = range?.startOffset ?? -1;
    }
    return node?.nodeType === 3 ? getTextOffset(index, node, offset) : -1;
  }

  function findContentEditableErrorAtPoint(ce, meta, x, y) {
    const index = buildTextIndex(ce);
    meta.errors = meta.errors.filter(error => errorStillMatches(index.text, error));

    for (const error of meta.errors) {
      const range = getRangeForOffsets(ce, error.start, error.end, index);
      if (!range || range.toString() !== error.word) continue;
      const targetRect = Array.from(range.getClientRects()).find(rect =>
        rect.width > 0 &&
        x >= rect.left && x <= rect.right &&
        y >= rect.top - 3 && y <= rect.bottom + 6
      );
      if (targetRect) return { error, index, range, targetRect };
    }
    return null;
  }

  function handleContentEditableClick(ce, e) {
    const meta = getInputMeta(ce);
    if (!meta || meta.errors.length === 0) return;

    const hit = findContentEditableErrorAtPoint(ce, meta, e.clientX, e.clientY);
    if (!hit) return;

    const { error, index, targetRect } = hit;

    // Ein Klick direkt vor oder hinter dem markierten Wort gehört nicht zum Fehler.
    const caretOffset = getCaretTextOffsetAtPoint(index, e.clientX, e.clientY);
    if (caretOffset >= 0 && (caretOffset <= error.start || caretOffset >= error.end)) return;

    // Auch bei auf mehrere Textknoten verteilter Formatierung bleiben die beiden
    // äußeren Buchstaben geometrisch die exakten Wortgrenzen.
    try {
      const firstRange = getRangeForOffsets(ce, error.start, error.start + 1, index);
      const firstRect = firstRange?.getBoundingClientRect();
      if (firstRect?.width > 0 &&
          e.clientY >= firstRect.top - 3 && e.clientY <= firstRect.bottom + 6 &&
          e.clientX <= firstRect.left + firstRect.width / 2) return;

      const lastRange = getRangeForOffsets(ce, error.end - 1, error.end, index);
      const lastRect = lastRange?.getBoundingClientRect();
      if (lastRect?.width > 0 &&
          e.clientY >= lastRect.top - 3 && e.clientY <= lastRect.bottom + 6 &&
          e.clientX >= lastRect.right - lastRect.width / 2) return;
    } catch {}

    const onSelect = (selected) => {
      ce.focus();
      const sel = window.getSelection();

      const currentIndex = buildTextIndex(ce);
      const rangeToUse = errorStillMatches(currentIndex.text, error)
        ? getRangeForOffsets(ce, error.start, error.end, currentIndex)
        : null;

      if (rangeToUse) {
        sel?.removeAllRanges();
        sel?.addRange(rangeToUse);

        let replaced = false;
        try {
          replaced = document.execCommand("insertText", false, selected);
        } catch {}

        if (!replaced) {
          rangeToUse.deleteContents();
          const textNode = document.createTextNode(selected);
          rangeToUse.insertNode(textNode);
          const afterRange = document.createRange();
          afterRange.setStart(textNode, selected.length);
          afterRange.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(afterRange);
          ce.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }

      invalidateFieldText(ce, meta, readFieldText(ce));
      scheduleScan(ce);
    };

    const onIgnore = () => {
      removeError(meta, error);
      rebuildHighlights();
    };

    openSuggestionMenu(targetRect, error, index.text, meta, onSelect, onIgnore, ce);
  }

  // =========================================================================
  // 4. Zentraler Scan & Event-Loop
  // =========================================================================

  function renderField(el, meta) {
    if (isTextInput(el)) syncOverlay(el, meta);
    else updateContentEditableHighlights(el, meta);
  }

  async function scanField(el) {
    if (!el?.isConnected) return;
    const meta = getInputMeta(el);
    const text = readFieldText(el);
    const revision = meta.revision;
    const request = ++meta.spellingRequest;

    if (!text.trim() || text.length < 2) {
      meta.errors = [];
      meta.lastText = text;
      renderField(el, meta);
      return;
    }

    try {
      const res = await browser.runtime.sendMessage({ action: "check_text", text });
      // Nur die neueste Antwort für exakt diese Feldrevision darf rendern.
      if (!el.isConnected || meta.revision !== revision ||
          meta.spellingRequest !== request || readFieldText(el) !== text) return;

      const spellingErrors = (res?.errors || []).filter(error => errorStillMatches(text, error));
      const occupied = new Set(spellingErrors.map(error => error.start));
      const preservedContextErrors = meta.errors.filter(error =>
        error.kind === "context" && !occupied.has(error.start) && errorStillMatches(text, error)
      );
      meta.errors = [...spellingErrors, ...preservedContextErrors].sort((a, b) => a.start - b.start);
      meta.lastText = text;
    } catch {
      return;
    }

    renderField(el, meta);
  }

  async function scanContextField(el) {
    if (!el?.isConnected) return;
    const meta = getInputMeta(el);
    const text = readFieldText(el);
    const revision = meta.revision;
    const request = ++meta.contextRequest;
    if (!text.trim() || text.length < 3) return;

    try {
      const res = await browser.runtime.sendMessage({ action: "check_context", text });
      if (!el.isConnected || meta.revision !== revision ||
          meta.contextRequest !== request || readFieldText(el) !== text) return;

      const spellingErrors = meta.errors.filter(error => error.kind !== "context");
      const occupied = new Set(spellingErrors.map(error => error.start));
      const contextErrors = (res?.errors || []).filter(error =>
        !occupied.has(error.start) && errorStillMatches(text, error)
      );
      meta.errors = [...spellingErrors, ...contextErrors].sort((a, b) => a.start - b.start);
      meta.lastText = text;
    } catch {
      return;
    }

    renderField(el, meta);
  }

  function scheduleScan(target, delay = 120) {
    const el = getTargetContainer(target);
    if (!el?.isConnected) return;
    const meta = getInputMeta(el);
    if (!isTextInput(el)) ensureEditableObserver(el, meta);
    clearTimeout(meta.debounceTimer);
    meta.debounceTimer = setTimeout(() => scanField(el), delay);
    clearTimeout(meta.contextTimer);
    meta.contextTimer = setTimeout(() => scanContextField(el), Math.max(550, delay + 300));
  }

  function shouldScanFast(event) {
    if (event.isComposing) return false;
    if (typeof event.inputType === "string" &&
        event.inputType !== "insertText" && event.inputType !== "insertCompositionText") return true;
    return typeof event.data === "string" && /[.\s,!?:\-–—();»«"']/u.test(event.data);
  }

  // Ein einziger leichter Wächter deckt Änderungen ab, für die Webseiten kein
  // input-Event senden (value-Zuweisung, Root-Austausch, Layoutbewegung). Er
  // läuft nur solange ein Feld fokussiert ist oder tatsächlich Fehler rendert.
  let watchedField = null;
  let stateWatchTimer = null;
  const pendingDetachedFields = new Set();

  function getDeepActiveElement() {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function retireField(el, meta) {
    clearTimeout(meta?.debounceTimer);
    clearTimeout(meta?.contextTimer);
    if (meta?.mutationFrame) cancelAnimationFrame(meta.mutationFrame);
    meta?.editableObserver?.disconnect();
    if (meta) {
      meta.editableObserver = null;
      meta.mutationFrame = null;
    }
    if (meta?.overlay) destroyOverlay(el, meta);
    activeEditableElements.delete(el);
    pendingDetachedFields.delete(el);
  }

  function fieldKind(el) {
    if (el?.tagName === "TEXTAREA") return "textarea";
    if (el?.tagName === "INPUT" && isTextInput(el)) return `input:${(el.type || "text").toLowerCase()}`;
    return el?.isContentEditable ? "contenteditable" : "";
  }

  function collectReplacementFields(oldField) {
    const fields = new Set();
    const selector = "textarea, input, [contenteditable='true'], [contenteditable=''], .ProseMirror, [role='textbox']";
    const addRoot = (root) => {
      root?.querySelectorAll?.(selector).forEach(candidate => {
        const field = getTargetContainer(candidate);
        if (field) fields.add(field);
      });
    };
    addRoot(document);
    const oldRoot = oldField?.getRootNode?.();
    if (oldRoot && oldRoot !== document) addRoot(oldRoot);
    const focused = getTargetContainer(getDeepActiveElement());
    if (focused?.isConnected) fields.add(focused);
    return [...fields];
  }

  function findReplacementField(oldField, meta, candidates) {
    const kind = fieldKind(oldField);
    if (!kind) return null;
    const sameKind = candidates.filter(candidate => candidate.isConnected && fieldKind(candidate) === kind);
    if (sameKind.length === 0) return null;
    const focused = getTargetContainer(getDeepActiveElement());
    if (focused && sameKind.includes(focused)) return focused;
    const exact = sameKind.find(candidate => readFieldText(candidate) === meta.lastText);
    return exact || (sameKind.length === 1 ? sameKind[0] : null);
  }

  function recoverDetachedField(oldField, meta) {
    if (activeMenuField === oldField) closeMenu();
    if (!meta) {
      retireField(oldField, meta);
      return;
    }
    const replacement = findReplacementField(oldField, meta, collectReplacementFields(oldField));
    if (!replacement) {
      if (!meta.detachedSince) meta.detachedSince = Date.now();
      if (Date.now() - meta.detachedSince < 640) {
        pendingDetachedFields.add(oldField);
        return;
      }
      retireField(oldField, meta);
      return;
    }

    const replacementText = readFieldText(replacement);
    const transferableErrors = replacementText === meta.lastText
      ? meta.errors.filter(error => errorStillMatches(replacementText, error))
      : [];
    retireField(oldField, meta);

    const replacementMeta = getInputMeta(replacement);
    replacementMeta.errors = transferableErrors;
    replacementMeta.lastText = replacementText;
    renderField(replacement, replacementMeta);
    ensureStateWatch(replacement);
    scheduleScan(replacement, 120);
  }

  function ensureStateWatch(field = null) {
    if (field) watchedField = field;
    if (!stateWatchTimer) stateWatchTimer = setTimeout(runStateWatch, 160);
  }

  function runStateWatch() {
    stateWatchTimer = null;
    const previousWatchedField = watchedField;
    const focusedField = getTargetContainer(getDeepActiveElement());
    watchedField = focusedField?.isConnected ? focusedField : null;

    const fields = new Set([...activeOverlayInputs, ...activeEditableElements, ...pendingDetachedFields]);
    if (previousWatchedField) fields.add(previousWatchedField);
    if (watchedField) fields.add(watchedField);

    let highlightsChanged = false;
    for (const el of fields) {
      const meta = inputMetadata.get(el);
      if (!el.isConnected || !meta) {
        recoverDetachedField(el, meta);
        highlightsChanged = true;
        continue;
      }
      meta.detachedSince = 0;
      pendingDetachedFields.delete(el);

      const changed = invalidateFieldText(el, meta, readFieldText(el));
      if (changed) {
        if (activeMenu) closeMenu();
        if (!meta.isComposing) scheduleScan(el, 120);
        highlightsChanged = highlightsChanged || !isTextInput(el);
      } else if (isTextInput(el) && meta.overlay) {
        positionOverlay(el, meta);
      }
    }

    if (highlightsChanged) rebuildHighlights();
    if (watchedField || activeOverlayInputs.size > 0 || activeEditableElements.size > 0 || pendingDetachedFields.size > 0) {
      ensureStateWatch();
    }
  }

  // Mousedown: Singleton-Schließen und punktgenaue Klick-Erkennung
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (!target) return;

    const eventPath = typeof e.composedPath === "function" ? e.composedPath() : [target];
    if (!eventPath.some(node => node?.closest?.(".sc-suggestion-menu"))) closeMenu();

    const field = getEventTargetContainer(e);
    if (isTextInput(field)) {
      handleInputClick(field, e);
      return;
    }

    if (field) {
      handleContentEditableClick(field, e);
    }
  }, true);

  document.addEventListener("focusin", (e) => {
    const el = getEventTargetContainer(e);
    if (!el) return;
    const meta = getInputMeta(el);
    if (!isTextInput(el)) ensureEditableObserver(el, meta);
    invalidateFieldText(el, meta, readFieldText(el));
    ensureStateWatch(el);
    scheduleScan(el, 120);
  }, true);

  document.addEventListener("input", (e) => {
    const el = getEventTargetContainer(e);
    if (!el) return;
    const meta = getInputMeta(el);
    meta.isComposing = Boolean(e.isComposing);
    invalidateFieldText(el, meta, readFieldText(el));
    ensureStateWatch(el);
    if (activeMenu) closeMenu();
    if (!meta.isComposing) scheduleScan(el, shouldScanFast(e) ? 120 : 600);
  }, true);

  document.addEventListener("compositionstart", (e) => {
    const el = getEventTargetContainer(e);
    if (!el) return;
    getInputMeta(el).isComposing = true;
    ensureStateWatch(el);
  }, true);

  document.addEventListener("compositionend", (e) => {
    const el = getEventTargetContainer(e);
    if (!el) return;
    const meta = getInputMeta(el);
    meta.isComposing = false;
    invalidateFieldText(el, meta, readFieldText(el));
    ensureStateWatch(el);
    scheduleScan(el, 120);
  }, true);

  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    const el = getTargetContainer(selection?.anchorNode);
    if (!el || isTextInput(el)) return;
    const wasKnown = inputMetadata.has(el);
    const meta = getInputMeta(el);
    ensureEditableObserver(el, meta);
    const changed = invalidateFieldText(el, meta, readFieldText(el));
    ensureStateWatch(el);
    if (!wasKnown || changed) scheduleScan(el, 120);
  }, { passive: true });

  // Globale passive Listener für Input-Overlays mit rAF-Throttling (kein Reflow-Thrashing)
  let scrollRaf = null;
  function scheduleOverlayPositions() {
    if (activeOverlayInputs.size === 0) return;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      for (const input of activeOverlayInputs) {
        const meta = inputMetadata.get(input);
        if (!input.isConnected || !meta) {
          retireField(input, meta);
          continue;
        }
        if (meta?.overlay && meta.errors.length > 0) {
          positionOverlay(input, meta);
        } else {
          activeOverlayInputs.delete(input);
        }
      }
    });
  }

  function composedContains(ancestor, node) {
    let current = node;
    while (current) {
      if (current === ancestor) return true;
      current = current.parentNode || current.getRootNode?.().host || null;
    }
    return false;
  }

  function scrollMovesMenuAnchor(event) {
    if (event?.type === "resize") return true;
    const target = event?.target;
    if (target === window || target === document || target === document.documentElement || target === document.body) return true;
    if (!activeMenuField?.isConnected) return true;
    return composedContains(target, activeMenuField);
  }

  function onWindowScrollOrResize(event) {
    if (activeMenu && scrollMovesMenuAnchor(event)) closeMenu();
    scheduleOverlayPositions();
  }

  window.addEventListener("resize", onWindowScrollOrResize, { passive: true });
  window.addEventListener("scroll", onWindowScrollOrResize, { passive: true, capture: true });

  ["transitionend", "animationend"].forEach((eventName) => {
    document.addEventListener(eventName, scheduleOverlayPositions, { passive: true, capture: true });
  });

  document.addEventListener("keydown", () => { if (activeMenu) closeMenu(); });
  document.addEventListener("contextmenu", () => { if (activeMenu) closeMenu(); });
  document.querySelectorAll("textarea, input, [contenteditable]").forEach(disableNativeSpellcheck);
  document.querySelectorAll(".sc-typo-highlight").forEach((s) => s.replaceWith(document.createTextNode(s.textContent)));
})();
