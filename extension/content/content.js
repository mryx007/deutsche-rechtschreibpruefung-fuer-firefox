/**
 * German Smart Spellcheck - Content Script (Kompakt & Schlank)
 */

(() => {
  if (window.__smartSpellcheckLoaded) return;
  window.__smartSpellcheckLoaded = true;

  let activeMenu = null;
  let activeMenuKey = null;
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
        lastText: (isTextInput(el) ? el.value : el.textContent) || ""
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

  function adjustErrors(errors, oldText, newText) {
    if (oldText === newText || !errors || errors.length === 0) return errors || [];

    let prefix = 0;
    const minLen = Math.min(oldText.length, newText.length);
    while (prefix < minLen && oldText[prefix] === newText[prefix]) {
      prefix++;
    }

    let oldSuffix = oldText.length;
    let newSuffix = newText.length;
    while (oldSuffix > prefix && newSuffix > prefix && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
      oldSuffix--;
      newSuffix--;
    }

    const delta = newText.length - oldText.length;
    const oldEditStart = prefix;
    const oldEditEnd = oldSuffix;

    return errors.map(err => {
      if (err.end <= oldEditStart) {
        return err;
      }
      if (err.start >= oldEditEnd) {
        return {
          ...err,
          start: err.start + delta,
          end: err.end + delta
        };
      }
      return null;
    }).filter(Boolean);
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
    const ce = elNode.isContentEditable
      ? (elNode.closest("[contenteditable='true'], [contenteditable=''], .ProseMirror, [role='textbox']") || elNode)
      : elNode.closest?.("[contenteditable='true'], [contenteditable=''], .ProseMirror, [role='textbox']");
    return ce?.isContentEditable ? ce : null;
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
  }

  function showMenu(targetRect, word, suggestions, onSelect, onIgnore) {
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
    activeMenuKey = null;

    reposition();
    menu.style.removeProperty("visibility");

    return (newSug) => { if (activeMenu === menu) renderItems(newSug); };
  }

  // Gemeinsamer Öffnungs- und Nachlade-Workflow für alle Feldtypen
  async function openSuggestionMenu(targetRect, error, context, meta, onSelect, onIgnore) {
    const { word, start, end, isFirstWord = false } = error;
    const menuKey = `${meta.fieldId}:${start}:${end}:${word}`;
    if (activeMenu && activeMenuKey === menuKey) {
      return; // Bereits für dieses Wort geöffnet - kein Schließen, Neuaufbau oder Zucken!
    }

    if (activeMenu) {
      closeMenu();
    }
    activeMenuKey = menuKey;

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

    showMenu(targetRect, word, suggestions, onSelect, onIgnore);
    activeMenuKey = menuKey;
  }

  // =========================================================================
  // 2. Textarea & Input Mirror-Overlay
  // =========================================================================

  const activeOverlayInputs = new Set();

  const inputResizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => {
    for (const entry of entries) {
      const input = entry.target;
      const meta = inputMetadata.get(input);
      if (meta?.overlay) {
        syncOverlay(input, meta);
      }
    }
  }) : null;

  let overlayCheckRaf = null;
  function scheduleOverlayCheck() {
    if (activeOverlayInputs.size === 0) return;
    if (overlayCheckRaf) return;
    overlayCheckRaf = requestAnimationFrame(() => {
      overlayCheckRaf = null;
      for (const input of [...activeOverlayInputs]) {
        if (!input.isConnected) {
          const meta = inputMetadata.get(input);
          if (meta?.overlay) {
            inputResizeObserver?.unobserve(input);
            meta.overlay.remove();
            meta.overlay = null;
          }
          activeOverlayInputs.delete(input);
          continue;
        }
        const meta = inputMetadata.get(input);
        if (meta?.overlay) {
          syncOverlay(input, meta);
        } else {
          activeOverlayInputs.delete(input);
        }
      }
    });
  }

  const overlayMutationObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(() => {
    scheduleOverlayCheck();
  }) : null;

  try {
    overlayMutationObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden"],
      childList: true,
      subtree: true
    });
  } catch {}

  function syncOverlay(input, meta) {
    if (!isTextInput(input) || !input.isConnected) {
      if (meta?.overlay) {
        inputResizeObserver?.unobserve(input);
        meta.overlay.remove();
        meta.overlay = null;
      }
      activeOverlayInputs.delete(input);
      return;
    }
    if (!meta.overlay) {
      const overlay = document.createElement("div");
      overlay.className = `sc-mirror-overlay ${input.tagName === "INPUT" ? "sc-mirror-overlay-input" : "sc-mirror-overlay-textarea"}`;
      (document.documentElement || document.body).appendChild(overlay);
      meta.overlay = overlay;
      inputResizeObserver?.observe(input);
      input.addEventListener("scroll", () => {
        if (meta.overlay) {
          meta.overlay.scrollTop = input.scrollTop;
          meta.overlay.scrollLeft = input.scrollLeft;
        }
      }, { passive: true });
    }

    const rect = input.getBoundingClientRect();
    const style = window.getComputedStyle(input);
    const isHidden = style.display === "none" ||
                     style.visibility === "hidden" ||
                     style.opacity === "0" ||
                     rect.width === 0 ||
                     rect.height === 0 ||
                     (style.position !== "fixed" && input.offsetParent === null);

    if (isHidden) {
      meta.overlay.style.display = "none";
      meta.overlay.textContent = "";
      activeOverlayInputs.delete(input);
      return;
    }

    const isSingleLineInput = input.tagName === "INPUT";
    meta.overlay.style.setProperty("display", isSingleLineInput ? "flex" : "block", "important");
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

    [
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign',
      'textIndent', 'textTransform', 'direction', 'wordBreak', 'overflowWrap', 'tabSize'
    ].forEach((prop) => {
      if (style[prop] !== undefined) meta.overlay.style[prop] = style[prop];
    });

    if (!isSingleLineInput) {
      const scrollbarWidth = input.offsetWidth - input.clientWidth - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0);
      if (scrollbarWidth > 0) {
        meta.overlay.style.paddingRight = `${(parseFloat(style.paddingRight) || 0) + scrollbarWidth}px`;
      }
    }

    const val = input.value || "";
    meta.errors = meta.errors.filter(error => errorStillMatches(val, error));

    if (meta.errors.length === 0) {
      meta.overlay.textContent = "";
      meta.overlay.style.display = "none";
      activeOverlayInputs.delete(input);
      return;
    }

    activeOverlayInputs.add(input);
    inputResizeObserver?.observe(input);

    meta.overlay.textContent = "";
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    const errors = [...meta.errors].sort((a, b) => a.start - b.start || a.end - b.end);
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
      const r = m.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 3 && e.clientY <= r.bottom + 6) {
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
        if (firstRect && firstRect.width > 0 && e.clientX <= firstRect.left + firstRect.width / 2) {
          return;
        }

        const lastRange = document.createRange();
        lastRange.setStart(textNode, textNode.textContent.length - 1);
        lastRange.setEnd(textNode, textNode.textContent.length);
        const lastRect = lastRange.getBoundingClientRect();
        if (lastRect && lastRect.width > 0 && e.clientX >= lastRect.right - lastRect.width / 2) {
          return;
        }
      }
    } catch {}

    const onSelect = (selected) => {
      input.focus();
      input.setRangeText(selected, idx, end, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      removeError(meta, error);
      syncOverlay(input, meta);
      scheduleScan(input);
    };

    const onIgnore = () => {
      removeError(meta, error);
      syncOverlay(input, meta);
    };

    openSuggestionMenu(targetRect, error, val, meta, onSelect, onIgnore);
  }

  // =========================================================================
  // 3. Contenteditable (Zero DOM-Mutation via W3C CSS Custom Highlight API)
  // =========================================================================

  const hasHighlightAPI = typeof CSS !== "undefined" && typeof Highlight !== "undefined" && Boolean(CSS.highlights);
  const activeEditableElements = new Set();

  function rebuildHighlights() {
    if (!hasHighlightAPI) return;

    const allRanges = [];

    for (const el of activeEditableElements) {
      if (!el.isConnected) {
        activeEditableElements.delete(el);
        continue;
      }
      const meta = inputMetadata.get(el);
      if (!meta || meta.errors.length === 0) continue;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || (style.position !== "fixed" && el.offsetParent === null)) {
        continue;
      }

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      const errors = [...meta.errors].sort((a, b) => a.start - b.start || a.end - b.end);
      let globalOffset = 0;
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        const nodeEnd = globalOffset + text.length;
        for (const error of errors) {
          if (error.start < globalOffset || error.end > nodeEnd) continue;
          const localStart = error.start - globalOffset;
          const localEnd = error.end - globalOffset;
          if (text.slice(localStart, localEnd) !== error.word) continue;
          const r = new Range();
          r.setStart(node, localStart);
          r.setEnd(node, localEnd);
          allRanges.push(r);
        }
        globalOffset = nodeEnd;
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
    activeEditableElements.add(ce);
    rebuildHighlights();
  }

  function getWordAtPoint(x, y) {
    let node = null;
    let offset = 0;

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }

    if (!node) return null;

    if (node.nodeType === 1) {
      if (node.childNodes && offset < node.childNodes.length) {
        const child = node.childNodes[offset];
        if (child?.nodeType === 3) {
          node = child;
          offset = 0;
        } else if (child?.firstChild?.nodeType === 3) {
          node = child.firstChild;
          offset = 0;
        }
      } else if (node.childNodes && offset >= node.childNodes.length && node.lastChild) {
        const last = node.lastChild;
        if (last?.nodeType === 3) {
          node = last;
          offset = last.textContent.length;
        }
      }
    }

    if (node.nodeType !== 3) return null;

    const text = node.textContent;
    if (!text) return null;

    const wordRegex = /[\p{L}\p{M}]+(?:[-\u2010-\u2015\u2212'\u2018\u2019\u02BC][\p{L}\p{M}]+)*/gu;
    let match;
    while ((match = wordRegex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (offset >= start && offset <= end) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return {
          word: match[0],
          node,
          range,
          start,
          end,
          caretOffset: offset
        };
      }
    }

    return null;
  }

  function getTextOffset(root, targetNode, localOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (node === targetNode) return offset + localOffset;
      offset += (node.textContent || "").length;
    }
    return -1;
  }

  function getRangeForOffsets(root, start, end) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let offset = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
      const length = (node.textContent || "").length;
      if (!startNode && start >= offset && start <= offset + length) {
        startNode = node;
        startOffset = start - offset;
      }
      if (end >= offset && end <= offset + length) {
        endNode = node;
        endOffset = end - offset;
        break;
      }
      offset += length;
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  function handleContentEditableClick(ce, e) {
    const meta = getInputMeta(ce);
    if (!meta || meta.errors.length === 0) return;

    let hit = getWordAtPoint(e.clientX, e.clientY);
    let hitStart = hit ? getTextOffset(ce, hit.node, hit.start) : -1;
    let error = hit ? meta.errors.find(item => item.start === hitStart && item.end === hitStart + hit.word.length && item.word === hit.word) : null;
    if (!hit || !error) {
      hit = getWordAtPoint(e.clientX, e.clientY - 4) || getWordAtPoint(e.clientX, e.clientY - 8);
      hitStart = hit ? getTextOffset(ce, hit.node, hit.start) : -1;
      error = hit ? meta.errors.find(item => item.start === hitStart && item.end === hitStart + hit.word.length && item.word === hit.word) : null;
    }
    if (!hit || !error) return;

    const word = hit.word;
    const targetRect = hit.range.getBoundingClientRect();
    if (!targetRect || targetRect.width === 0) return;

    // Nur öffnen, wenn der Klick tatsächlich innerhalb des Wortes oder auf dessen Wellenlinie lag.
    // Verhindert, dass Klicks vor, hinter oder neben das Wort (z. B. am Zeilenende im Twitch-Chat) das Popup triggern.
    if (
      e.clientX < targetRect.left ||
      e.clientX > targetRect.right ||
      e.clientY < targetRect.top - 3 ||
      e.clientY > targetRect.bottom + 6
    ) {
      return;
    }

    // Caret-Positionierung vor oder hinter dem Wort (|wort oder wort|) darf kein Popup triggern:
    if (hit.caretOffset <= hit.start || hit.caretOffset >= hit.end) {
      return;
    }

    // Geometrische Absicherung an den Wortkanten (Klick in die äußere Hälfte des Randbuchstabens):
    try {
      const textNode = hit.node;
      if (textNode && textNode.nodeType === 3 && hit.word.length > 0) {
        const firstRange = document.createRange();
        firstRange.setStart(textNode, hit.start);
        firstRange.setEnd(textNode, hit.start + 1);
        const firstRect = firstRange.getBoundingClientRect();
        if (firstRect && firstRect.width > 0 && e.clientX <= firstRect.left + firstRect.width / 2) {
          return;
        }

        const lastRange = document.createRange();
        lastRange.setStart(textNode, hit.end - 1);
        lastRange.setEnd(textNode, hit.end);
        const lastRect = lastRange.getBoundingClientRect();
        if (lastRect && lastRect.width > 0 && e.clientX >= lastRect.right - lastRect.width / 2) {
          return;
        }
      }
    } catch {}

    const onSelect = (selected) => {
      ce.focus();
      const sel = window.getSelection();

      let rangeToUse = null;
      if (hit.range.startContainer.isConnected && hit.range.toString() === word) {
        rangeToUse = hit.range;
      } else {
        rangeToUse = getRangeForOffsets(ce, error.start, error.end);
      }

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

      removeError(meta, error);
      rebuildHighlights();

      scheduleScan(ce);
    };

    const onIgnore = () => {
      removeError(meta, error);
      rebuildHighlights();
    };

    const allText = ce.textContent || "";
    openSuggestionMenu(targetRect, error, allText, meta, onSelect, onIgnore);
  }

  // =========================================================================
  // 4. Zentraler Scan & Event-Loop
  // =========================================================================

  async function scanField(el) {
    const isInput = isTextInput(el);
    const text = (isInput ? el.value : el.textContent) || "";
    const meta = getInputMeta(el);

    if (!text.trim() || text.length < 2) {
      meta.errors = [];
      meta.lastText = text;
      if (isInput) syncOverlay(el, meta);
      else updateContentEditableHighlights(el, meta);
      return;
    }

    try {
      const res = await browser.runtime.sendMessage({ action: "check_text", text });
      // Race-Condition-Schutz: Textinhalt hat sich während der async Inferenz geändert -> Resultat verwerfen
      const currentText = (isInput ? el.value : el.textContent) || "";
      if (currentText !== text) return;

      const spellingErrors = (res?.errors || []).filter(error => errorStillMatches(text, error));
      const occupied = new Set(spellingErrors.map(error => error.start));
      const preservedContextErrors = meta.errors.filter(error =>
        error.kind === "context" && !occupied.has(error.start) && errorStillMatches(text, error)
      );
      meta.errors = [...spellingErrors, ...preservedContextErrors].sort((a, b) => a.start - b.start);
      meta.lastText = text;
    } catch {}

    if (isInput) syncOverlay(el, meta);
    else updateContentEditableHighlights(el, meta);
  }

  async function scanContextField(el) {
    const isInput = isTextInput(el);
    const text = (isInput ? el.value : el.textContent) || "";
    if (!text.trim() || text.length < 3) return;
    const meta = getInputMeta(el);

    try {
      const res = await browser.runtime.sendMessage({ action: "check_context", text });
      const currentText = (isInput ? el.value : el.textContent) || "";
      if (currentText !== text) return;

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

    if (isInput) syncOverlay(el, meta);
    else updateContentEditableHighlights(el, meta);
  }

  function scheduleScan(target, delay = 120) {
    const el = getTargetContainer(target);
    if (!el) return;
    const meta = getInputMeta(el);
    clearTimeout(meta.debounceTimer);
    meta.debounceTimer = setTimeout(() => scanField(el), delay);
    clearTimeout(meta.contextTimer);
    meta.contextTimer = setTimeout(() => scanContextField(el), Math.max(550, delay + 300));
  }

  function shouldScanFast(event) {
    if (event.isComposing) return false;
    if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop" ||
        event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
      return true;
    }
    if (typeof event.inputType === "string" && event.inputType.startsWith("delete")) {
      return true;
    }
    return typeof event.data === "string" && /[.\s,!?:\-–—();»«"']/u.test(event.data);
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

  // Während eines Wortes nicht prüfen: Erst eine Wortgrenze, Einfügen oder
  // Fokussieren startet den Scan. So wird das gerade getippte Wort nicht rot.
  ['input', 'paste', 'focusin'].forEach((type) => {
    document.addEventListener(type, (e) => {
      const el = getEventTargetContainer(e);
      if (!el) return;
      if (type === 'focusin') disableNativeSpellcheck(el);
      if (type === 'input') {
        const meta = getInputMeta(el);
        const isInput = isTextInput(el);
        const currentText = (isInput ? el.value : el.textContent) || "";

        if (typeof meta.lastText === "string" && meta.lastText !== currentText) {
          meta.errors = adjustErrors(meta.errors, meta.lastText, currentText);
        }
        meta.lastText = currentText;

        if (isInput) {
          syncOverlay(el, meta);
        } else {
          meta.errors = meta.errors.filter(error => errorStillMatches(currentText, error));
          rebuildHighlights();
        }
      }
      if (type !== 'input') {
        scheduleScan(el, 120);
      } else if (!e.isComposing) {
        const isFast = shouldScanFast(e);
        scheduleScan(el, isFast ? 120 : 600);
      }
    }, true);
  });

  // Globale passive Listener für Input-Overlays mit rAF-Throttling (kein Reflow-Thrashing)
  let scrollRaf = null;
  function onWindowScrollOrResize() {
    if (activeMenu) closeMenu();
    if (activeOverlayInputs.size === 0) return;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      for (const input of activeOverlayInputs) {
        if (!input.isConnected) {
          const meta = inputMetadata.get(input);
          if (meta?.overlay) {
            meta.overlay.remove();
            meta.overlay = null;
          }
          activeOverlayInputs.delete(input);
          continue;
        }
        const meta = inputMetadata.get(input);
        if (meta?.overlay && meta.errors.length > 0) {
          syncOverlay(input, meta);
        } else {
          activeOverlayInputs.delete(input);
        }
      }
    });
  }

  window.addEventListener("resize", onWindowScrollOrResize, { passive: true });
  window.addEventListener("scroll", onWindowScrollOrResize, { passive: true, capture: true });

  ['mousedown', 'click', 'focusin', 'focusout', 'transitionend', 'animationend'].forEach((evt) => {
    document.addEventListener(evt, scheduleOverlayCheck, { passive: true });
  });

  document.addEventListener("keydown", () => { if (activeMenu) closeMenu(); });
  document.addEventListener("contextmenu", () => { if (activeMenu) closeMenu(); });
  document.querySelectorAll("textarea, input, [contenteditable]").forEach(disableNativeSpellcheck);
  document.querySelectorAll(".sc-typo-highlight").forEach((s) => s.replaceWith(document.createTextNode(s.textContent)));
})();
