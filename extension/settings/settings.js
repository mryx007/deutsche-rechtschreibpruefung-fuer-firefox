/**
 * Spellchecker Settings Script
 */

(() => {
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

  const DEFAULT_SETTINGS = {
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

  const fontSizeInput = document.getElementById("fontSize");
  const fontSizeVal = document.getElementById("fontSizeVal");
  const fontWeightInput = document.getElementById("fontWeight");
  const fontWeightVal = document.getElementById("fontWeightVal");
  const fontFamilySelect = document.getElementById("fontFamilySelect");
  const customFontInput = document.getElementById("customFontInput");
  const hexInput = document.getElementById("hexInput");
  const colorSwatchPreview = document.getElementById("colorSwatchPreview");
  const colorHue = document.getElementById("colorHue");
  const colorLightness = document.getElementById("colorLightness");
  const colorSwatches = document.getElementById("colorSwatches");
  const colorTargetTabs = document.getElementById("colorTargetTabs");
  const textColorIndicator = document.getElementById("textColorIndicator");
  const bgColorIndicator = document.getElementById("bgColorIndicator");
  const labelColorIndicator = document.getElementById("labelColorIndicator");
  const letterSpacingInput = document.getElementById("letterSpacing");
  const letterSpacingVal = document.getElementById("letterSpacingVal");
  const opacityInput = document.getElementById("opacity");
  const opacityVal = document.getElementById("opacityVal");
  const resetBtn = document.getElementById("resetBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const settingsToast = document.getElementById("settingsToast");

  const jsonModalOverlay = document.getElementById("jsonModalOverlay");
  const closeJsonModal = document.getElementById("closeJsonModal");
  const jsonModalTitle = document.getElementById("jsonModalTitle");
  const jsonModalDesc = document.getElementById("jsonModalDesc");
  const jsonTextArea = document.getElementById("jsonTextArea");
  const jsonSecondaryBtn = document.getElementById("jsonSecondaryBtn");
  const jsonPrimaryBtn = document.getElementById("jsonPrimaryBtn");

  const openUserDictBtn = document.getElementById("openUserDictBtn");
  const userDictBadge = document.getElementById("userDictBadge");
  const openIgnoredWordsBtn = document.getElementById("openIgnoredWordsBtn");
  const ignoredWordsBadge = document.getElementById("ignoredWordsBadge");

  const wordListModalOverlay = document.getElementById("wordListModalOverlay");
  const closeWordListModal = document.getElementById("closeWordListModal");
  const wordListModalTitle = document.getElementById("wordListModalTitle");
  const wordListModalDesc = document.getElementById("wordListModalDesc");
  const newWordInput = document.getElementById("newWordInput");
  const addWordBtn = document.getElementById("addWordBtn");
  const filterWordInput = document.getElementById("filterWordInput");
  const wordListContainer = document.getElementById("wordListContainer");
  const wordListFooterCount = document.getElementById("wordListFooterCount");
  const clearWordListBtn = document.getElementById("clearWordListBtn");
  const closeWordListPrimaryBtn = document.getElementById("closeWordListPrimaryBtn");

  let userDict = new Set();
  let ignoredWords = new Set();
  let activeWordListType = "user_dict";

  let modalMode = "export";
  let activeColorTarget = "textColor";
  let currentSettings = { ...DEFAULT_SETTINGS };
  let saveTimer = null;
  let clearConfirmTimer = null;

  function resolveFontFamily(familyKey, customFont) {
    if (familyKey === "custom" && customFont?.trim()) {
      return `"${customFont.trim()}", sans-serif`;
    }
    return FONT_PRESETS[familyKey] || FONT_PRESETS.system;
  }

  function hslToHex(h, s, l) {
    l /= 100;
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`.toLowerCase();
  }

  function hexToHsl(hex) {
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    const num = parseInt(c, 16);
    if (isNaN(num) || c.length !== 6) return null;
    const r = (num >> 16) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h = Math.round(h * 60);
    }
    return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function getFontWeightLabel(weight) {
    const w = parseInt(weight, 10);
    switch (w) {
      case 300: return "300 (Light)";
      case 400: return "400 (Normal)";
      case 500: return "500 (Medium)";
      case 600: return "600 (Semibold)";
      case 700: return "700 (Bold)";
      case 800: return "800 (Extra Bold)";
      default: return `${w}`;
    }
  }

  function updateColorControls(hex, syncSliders = true) {
    if (hexInput) hexInput.value = hex.toUpperCase();
    if (colorSwatchPreview) colorSwatchPreview.style.backgroundColor = hex;

    if (colorSwatches) {
      const buttons = colorSwatches.querySelectorAll(".swatch-btn");
      buttons.forEach((btn) => {
        const btnColor = (btn.getAttribute("data-color") || "").toLowerCase();
        if (btnColor === hex.toLowerCase()) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    }

    if (colorLightness) {
      const hsl = hexToHsl(hex) || { h: 0, s: 0, l: 50 };
      const pureMidColor = hslToHex(hsl.h, hsl.s, 50);
      colorLightness.style.background = `linear-gradient(to right, #000000 0%, ${pureMidColor} 50%, #ffffff 100%)`;
    }

    if (syncSliders) {
      const hsl = hexToHsl(hex);
      if (hsl) {
        if (colorHue) colorHue.value = hsl.h;
        if (colorLightness) colorLightness.value = hsl.l;
      }
    }
  }

  function updatePreviewAndLabels(settings, syncSliders = true) {
    if (fontSizeInput) fontSizeInput.value = settings.fontSize;
    if (fontSizeVal) fontSizeVal.textContent = `${Number(settings.fontSize).toFixed(1)} px`;

    if (fontWeightInput) fontWeightInput.value = settings.fontWeight;
    if (fontWeightVal) fontWeightVal.textContent = getFontWeightLabel(settings.fontWeight);

    if (fontFamilySelect) fontFamilySelect.value = settings.fontFamily || "system";
    if (customFontInput) {
      if (settings.fontFamily === "custom") {
        customFontInput.classList.remove("hidden");
        customFontInput.value = settings.customFont || "";
      } else {
        customFontInput.classList.add("hidden");
      }
    }

    const activeColor = currentSettings[activeColorTarget] || currentSettings.textColor;
    updateColorControls(activeColor, syncSliders);

    const letterSpacing = Math.max(0, typeof settings.letterSpacing === "number" ? settings.letterSpacing : DEFAULT_SETTINGS.letterSpacing);
    if (letterSpacingInput) letterSpacingInput.value = letterSpacing;
    if (letterSpacingVal) letterSpacingVal.textContent = `${Number(letterSpacing).toFixed(2)} px`;

    if (opacityInput) opacityInput.value = settings.opacity;
    if (opacityVal) opacityVal.textContent = `${Math.round(settings.opacity)} %`;


    // Farb-Indikatoren aktualisieren
    if (textColorIndicator) textColorIndicator.style.backgroundColor = settings.textColor;
    if (bgColorIndicator) bgColorIndicator.style.backgroundColor = settings.bgColor || "#ffffff";
    if (labelColorIndicator) labelColorIndicator.style.backgroundColor = settings.labelColor || "#737373";

    // CSS-Variablen der Live-Vorschau sofort aktualisieren
    const rootStyle = document.documentElement.style;
    const resolvedFont = resolveFontFamily(settings.fontFamily, settings.customFont);
    rootStyle.setProperty("--preview-font-family", resolvedFont);
    rootStyle.setProperty("--preview-font-size", `${settings.fontSize}px`);
    rootStyle.setProperty("--preview-font-weight", `${settings.fontWeight}`);
    rootStyle.setProperty("--preview-text-color", settings.textColor);
    rootStyle.setProperty("--preview-bg-color", settings.bgColor || "#ffffff");
    rootStyle.setProperty("--preview-label-color", settings.labelColor || "#737373");

    const bgHsl = hexToHsl(settings.bgColor || "#ffffff") || { h: 0, s: 0, l: 100 };
    const isDark = bgHsl.l < 50;
    rootStyle.setProperty("--preview-border-color", isDark ? "rgba(255, 255, 255, 0.15)" : "#e5e5e5");
    rootStyle.setProperty("--preview-hover-bg", isDark ? "rgba(255, 255, 255, 0.08)" : "#f0f0f0");
    rootStyle.setProperty("--preview-btn-add-bg", isDark ? "rgba(34, 197, 94, 0.20)" : "rgba(22, 163, 74, 0.14)");
    rootStyle.setProperty("--preview-btn-add-color", isDark ? "#4ade80" : "#16a34a");
    rootStyle.setProperty("--preview-btn-add-hover", isDark ? "rgba(34, 197, 94, 0.32)" : "rgba(22, 163, 74, 0.24)");
    rootStyle.setProperty("--preview-btn-add-hover-color", isDark ? "#86efac" : "#15803d");
    rootStyle.setProperty("--preview-btn-ignore-bg", isDark ? "rgba(239, 68, 68, 0.20)" : "rgba(239, 68, 68, 0.14)");
    rootStyle.setProperty("--preview-btn-ignore-color", isDark ? "#f87171" : "#dc2626");
    rootStyle.setProperty("--preview-btn-ignore-hover", isDark ? "rgba(239, 68, 68, 0.32)" : "rgba(239, 68, 68, 0.24)");
    rootStyle.setProperty("--preview-btn-ignore-hover-color", isDark ? "#fca5a5" : "#b91c1c");
    rootStyle.setProperty("--preview-letter-spacing", `${letterSpacing}px`);
    rootStyle.setProperty("--preview-word-opacity", (settings.opacity / 100).toString());
  }

  function persistSettings() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (typeof browser !== "undefined" && browser.storage?.local) {
        browser.storage.local.set({ sc_settings: currentSettings }).catch((err) => {
          console.error("Fehler beim Speichern der Einstellungen:", err);
        });
      }
    }, 50);
  }

  function onFieldChange() {
    currentSettings = {
      ...currentSettings,
      fontSize: parseFloat(fontSizeInput.value) || DEFAULT_SETTINGS.fontSize,
      fontWeight: parseInt(fontWeightInput?.value, 10) || DEFAULT_SETTINGS.fontWeight,
      letterSpacing: Math.max(0, parseFloat(letterSpacingInput.value) || 0),
      opacity: parseInt(opacityInput.value, 10) || DEFAULT_SETTINGS.opacity
    };
    updatePreviewAndLabels(currentSettings, false);
    persistSettings();
  }

  function onFontFamilyChange() {
    const fam = fontFamilySelect.value;
    currentSettings.fontFamily = fam;
    if (fam === "custom") {
      customFontInput.classList.remove("hidden");
      customFontInput.focus();
    } else {
      customFontInput.classList.add("hidden");
    }
    const resolved = resolveFontFamily(fam, currentSettings.customFont);
    document.documentElement.style.setProperty("--preview-font-family", resolved);
    persistSettings();
  }

  function onCustomFontInput() {
    currentSettings.customFont = customFontInput.value.trim();
    const resolved = resolveFontFamily("custom", currentSettings.customFont);
    document.documentElement.style.setProperty("--preview-font-family", resolved);
    persistSettings();
  }

  function applyColorChange(newHex, syncSliders = false) {
    currentSettings[activeColorTarget] = newHex;
    updateColorControls(newHex, syncSliders);

    const rootStyle = document.documentElement.style;
    if (activeColorTarget === "textColor") {
      rootStyle.setProperty("--preview-text-color", newHex);
      if (textColorIndicator) textColorIndicator.style.backgroundColor = newHex;
    } else if (activeColorTarget === "bgColor") {
      rootStyle.setProperty("--preview-bg-color", newHex);
      if (bgColorIndicator) bgColorIndicator.style.backgroundColor = newHex;
      const bgHsl = hexToHsl(newHex) || { h: 0, s: 0, l: 100 };
      const isDark = bgHsl.l < 50;
      rootStyle.setProperty("--preview-border-color", isDark ? "rgba(255, 255, 255, 0.15)" : "#e5e5e5");
      rootStyle.setProperty("--preview-hover-bg", isDark ? "rgba(255, 255, 255, 0.08)" : "#f0f0f0");
      rootStyle.setProperty("--preview-btn-add-bg", isDark ? "rgba(34, 197, 94, 0.20)" : "rgba(22, 163, 74, 0.14)");
      rootStyle.setProperty("--preview-btn-add-color", isDark ? "#4ade80" : "#16a34a");
      rootStyle.setProperty("--preview-btn-add-hover", isDark ? "rgba(34, 197, 94, 0.32)" : "rgba(22, 163, 74, 0.24)");
      rootStyle.setProperty("--preview-btn-add-hover-color", isDark ? "#86efac" : "#15803d");
      rootStyle.setProperty("--preview-btn-ignore-bg", isDark ? "rgba(239, 68, 68, 0.20)" : "rgba(239, 68, 68, 0.14)");
      rootStyle.setProperty("--preview-btn-ignore-color", isDark ? "#f87171" : "#dc2626");
      rootStyle.setProperty("--preview-btn-ignore-hover", isDark ? "rgba(239, 68, 68, 0.32)" : "rgba(239, 68, 68, 0.24)");
      rootStyle.setProperty("--preview-btn-ignore-hover-color", isDark ? "#fca5a5" : "#b91c1c");
    } else if (activeColorTarget === "labelColor") {
      rootStyle.setProperty("--preview-label-color", newHex);
      if (labelColorIndicator) labelColorIndicator.style.backgroundColor = newHex;
    }
    persistSettings();
  }

  function onHueSliderMove() {
    const h = parseInt(colorHue.value, 10) || 0;
    const currentHex = currentSettings[activeColorTarget] || "#606060";
    const hslCurrent = hexToHsl(currentHex) || { h: 0, s: 0, l: 40 };
    const s = hslCurrent.s <= 5 ? 75 : hslCurrent.s;
    const l = Math.max(5, Math.min(hslCurrent.l, 90));
    const newHex = hslToHex(h, s, l);
    applyColorChange(newHex, false);
  }

  function onLightnessSliderMove() {
    const l = parseInt(colorLightness.value, 10);
    const currentHex = currentSettings[activeColorTarget] || "#606060";
    const hslCurrent = hexToHsl(currentHex) || { h: 0, s: 0, l: 40 };
    const newHex = hslToHex(hslCurrent.h, hslCurrent.s, l);
    applyColorChange(newHex, false);
  }

  function onHexInputEdit() {
    let val = hexInput.value.trim();
    if (!val.startsWith("#")) val = `#${val}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      applyColorChange(val.toLowerCase(), true);
    }
  }

  // Event Listener
  fontSizeInput?.addEventListener("input", onFieldChange);
  fontWeightInput?.addEventListener("input", onFieldChange);
  fontFamilySelect?.addEventListener("change", onFontFamilyChange);
  customFontInput?.addEventListener("input", onCustomFontInput);
  letterSpacingInput?.addEventListener("input", onFieldChange);
  opacityInput?.addEventListener("input", onFieldChange);


  colorTargetTabs?.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".color-tab");
    if (!btn) return;
    const target = btn.getAttribute("data-target");
    if (!target) return;
    activeColorTarget = target;
    colorTargetTabs.querySelectorAll(".color-tab").forEach(t => t.classList.toggle("active", t === btn));
    const currentColor = currentSettings[activeColorTarget] || "#606060";
    updateColorControls(currentColor, true);
  });

  colorHue?.addEventListener("input", onHueSliderMove);
  colorLightness?.addEventListener("input", onLightnessSliderMove);
  hexInput?.addEventListener("input", onHexInputEdit);

  colorSwatches?.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".swatch-btn");
    if (!btn) return;
    const color = btn.getAttribute("data-color");
    if (color) {
      applyColorChange(color.toLowerCase(), true);
    }
  });

  let toastTimer = null;
  function showToast(message, isError = false) {
    if (!settingsToast) return;
    settingsToast.textContent = message;
    settingsToast.style.backgroundColor = isError ? "#dc2626" : "#0f172a";
    settingsToast.classList.remove("hidden");
    void settingsToast.offsetWidth;
    settingsToast.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      settingsToast.classList.remove("visible");
      setTimeout(() => settingsToast.classList.add("hidden"), 220);
    }, 2400);
  }

  async function loadAndDisplayExportJson() {
    try {
      const backupData = {
        app: "German local AI Spellchecker",
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: { ...currentSettings },
        userDictionary: [],
        ignoredWords: []
      };

      if (typeof browser !== "undefined" && browser.storage?.local) {
        const stored = await browser.storage.local.get(["sc_user_dict", "sc_ignored_words"]);
        if (Array.isArray(stored?.sc_user_dict)) backupData.userDictionary = stored.sc_user_dict;
        if (Array.isArray(stored?.sc_ignored_words)) backupData.ignoredWords = stored.sc_ignored_words;
      }

      const jsonStr = JSON.stringify(backupData, null, 2);
      if (jsonTextArea) jsonTextArea.value = jsonStr;
      if (jsonModalOverlay) jsonModalOverlay.classList.remove("hidden");

      setTimeout(() => {
        jsonTextArea?.focus();
        jsonTextArea?.select();
      }, 40);

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(jsonStr).then(() => {
          showToast("In Zwischenablage kopiert!");
        }).catch(() => {
          showToast("JSON im Textfeld bereit");
        });
      }
    } catch (err) {
      console.error("Export-Fehler:", err);
      showToast("Export fehlgeschlagen", true);
    }
  }

  function openJsonModal(mode) {
    modalMode = mode;
    if (!jsonModalOverlay) return;

    if (mode === "export") {
      if (jsonModalTitle) jsonModalTitle.textContent = "Einstellungen exportieren";
      if (jsonModalDesc) jsonModalDesc.textContent = "JSON-Daten wurden in die Zwischenablage kopiert. Du kannst sie hier auch manuell kopieren:";
      if (jsonSecondaryBtn) jsonSecondaryBtn.textContent = "In Zwischenablage kopieren";
      if (jsonPrimaryBtn) jsonPrimaryBtn.textContent = "Schließen";
      loadAndDisplayExportJson();
    } else {
      if (jsonModalTitle) jsonModalTitle.textContent = "Einstellungen importieren";
      if (jsonModalDesc) jsonModalDesc.textContent = "Füge deinen gesicherten JSON-Code hier ein und klicke auf Übernehmen:";
      if (jsonTextArea) jsonTextArea.value = "";
      if (jsonSecondaryBtn) jsonSecondaryBtn.textContent = "Aus Zwischenablage";
      if (jsonPrimaryBtn) jsonPrimaryBtn.textContent = "Übernehmen";
      jsonModalOverlay.classList.remove("hidden");
      setTimeout(() => jsonTextArea?.focus(), 40);
    }
  }

  async function applyImportText(rawText) {
    const trimmed = rawText?.trim();
    if (!trimmed) {
      showToast("Bitte JSON-Text einfügen", true);
      jsonTextArea?.focus();
      return;
    }

    try {
      const data = JSON.parse(trimmed);
      const incomingSettings = data.settings || data.sc_settings || (data.fontSize ? data : null);
      const hasDict = Array.isArray(data.userDictionary) || Array.isArray(data.sc_user_dict);
      const hasIgnored = Array.isArray(data.ignoredWords) || Array.isArray(data.sc_ignored_words);

      if (!incomingSettings && !hasDict && !hasIgnored) {
        throw new Error("Keine gültigen Einstellungen im JSON gefunden");
      }

      const updates = {};

      if (incomingSettings && typeof incomingSettings === "object") {
        currentSettings = {
          ...DEFAULT_SETTINGS,
          ...incomingSettings,
          letterSpacing: Math.max(0, typeof incomingSettings.letterSpacing === "number" ? incomingSettings.letterSpacing : DEFAULT_SETTINGS.letterSpacing)
        };
        delete currentSettings.ignoreCase;
        delete currentSettings.checkCase;
        updates.sc_settings = currentSettings;
        updatePreviewAndLabels(currentSettings, true);
      }

      if (hasDict) {
        updates.sc_user_dict = data.userDictionary || data.sc_user_dict;
      }

      if (hasIgnored) {
        updates.sc_ignored_words = data.ignoredWords || data.sc_ignored_words;
      }

      if (typeof browser !== "undefined" && browser.storage?.local) {
        await browser.storage.local.set(updates);
      }

      jsonModalOverlay?.classList.add("hidden");
      showToast("Erfolgreich importiert!");
    } catch (err) {
      console.error("Import-Fehler:", err);
      showToast("Import fehlgeschlagen: " + (err.message || "Ungültiges JSON"), true);
    }
  }

  exportBtn?.addEventListener("click", () => openJsonModal("export"));
  importBtn?.addEventListener("click", () => openJsonModal("import"));

  closeJsonModal?.addEventListener("click", () => {
    jsonModalOverlay?.classList.add("hidden");
  });

  jsonModalOverlay?.addEventListener("click", (e) => {
    if (e.target === jsonModalOverlay) {
      jsonModalOverlay.classList.add("hidden");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && jsonModalOverlay && !jsonModalOverlay.classList.contains("hidden")) {
      jsonModalOverlay.classList.add("hidden");
    }
  });

  jsonSecondaryBtn?.addEventListener("click", async () => {
    if (modalMode === "export") {
      if (jsonTextArea?.value && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(jsonTextArea.value);
          showToast("In die Zwischenablage kopiert!");
        } catch {
          showToast("Kopieren fehlgeschlagen", true);
        }
      }
    } else {
      if (navigator.clipboard?.readText) {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            jsonTextArea.value = text;
            showToast("Aus Zwischenablage eingefügt!");
          } else {
            showToast("Zwischenablage ist leer", true);
          }
        } catch {
          showToast("Bitte manuell mit Strg+V einfügen", true);
          jsonTextArea?.focus();
        }
      } else {
        showToast("Bitte manuell mit Strg+V einfügen", true);
        jsonTextArea?.focus();
      }
    }
  });

  jsonPrimaryBtn?.addEventListener("click", () => {
    if (modalMode === "export") {
      jsonModalOverlay?.classList.add("hidden");
    } else {
      applyImportText(jsonTextArea?.value);
    }
  });

  // =========================================================================
  // Wortlisten-Verwaltung (Eigenes Wörterbuch & Ignorierliste)
  // =========================================================================

  function updateWordListBadges() {
    if (userDictBadge) {
      const uCount = userDict.size;
      userDictBadge.textContent = `${uCount} ${uCount === 1 ? "Wort" : "Wörter"}`;
    }
    if (ignoredWordsBadge) {
      const iCount = ignoredWords.size;
      ignoredWordsBadge.textContent = `${iCount} ${iCount === 1 ? "Wort" : "Wörter"}`;
    }
  }

  function renderWordChips() {
    if (!wordListContainer) return;
    wordListContainer.textContent = "";

    const isUserDict = activeWordListType === "user_dict";
    const targetSet = isUserDict ? userDict : ignoredWords;
    const words = Array.from(targetSet).sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));

    // Suchfilter anzeigen, sobald mindestens 4 Wörter vorhanden sind
    if (words.length >= 4 || (filterWordInput && filterWordInput.value.trim())) {
      filterWordInput?.classList.remove("hidden");
    } else {
      filterWordInput?.classList.add("hidden");
      if (filterWordInput) filterWordInput.value = "";
    }

    const query = (filterWordInput?.value || "").trim().toLowerCase();
    const filteredWords = query ? words.filter(w => w.toLowerCase().includes(query)) : words;

    if (filteredWords.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "wordlist-empty";
      emptyMsg.textContent = query
        ? "Keine passenden Wörter gefunden"
        : (isUserDict ? "Noch keine eigenen Wörter eingetragen" : "Noch keine ignorierten Wörter");
      wordListContainer.appendChild(emptyMsg);
    } else {
      const fragment = document.createDocumentFragment();
      for (const word of filteredWords) {
        const chip = document.createElement("span");
        chip.className = "word-chip";

        const textSpan = document.createElement("span");
        textSpan.textContent = word;
        chip.appendChild(textSpan);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-chip-del";
        delBtn.dataset.word = word;
        delBtn.title = `'${word}' entfernen`;
        delBtn.setAttribute("aria-label", `'${word}' entfernen`);
        delBtn.innerHTML = "&times;";
        chip.appendChild(delBtn);

        fragment.appendChild(chip);
      }
      wordListContainer.appendChild(fragment);
    }

    if (wordListFooterCount) {
      const total = words.length;
      if (query && filteredWords.length !== total) {
        wordListFooterCount.textContent = `${filteredWords.length} von ${total} ${total === 1 ? "Eintrag" : "Einträgen"}`;
      } else {
        wordListFooterCount.textContent = `${total} ${total === 1 ? "Eintrag" : "Einträge"}`;
      }
    }

    if (clearWordListBtn) {
      clearWordListBtn.classList.toggle("hidden", words.length === 0);
    }
  }

  function resetClearBtn() {
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
    if (clearWordListBtn) {
      clearWordListBtn.classList.remove("confirming");
      clearWordListBtn.textContent = "Alle leeren";
    }
  }

  function openWordListModal(type) {
    activeWordListType = type;
    const isUserDict = type === "user_dict";
    resetClearBtn();

    if (wordListModalTitle) {
      wordListModalTitle.textContent = isUserDict ? "Eigenes Wörterbuch" : "Ignorierliste";
    }
    if (wordListModalDesc) {
      wordListModalDesc.textContent = isUserDict
        ? "Wörter, die dauerhaft als richtig anerkannt werden:"
        : "Wörter, die nicht mehr als Fehler unterstrichen werden:";
    }
    if (newWordInput) {
      newWordInput.placeholder = isUserDict
        ? "Neues Wort hinzufügen (z. B. crafter)..."
        : "Neues Wort ignorieren...";
      newWordInput.value = "";
    }
    if (filterWordInput) {
      filterWordInput.value = "";
    }

    renderWordChips();
    wordListModalOverlay?.classList.remove("hidden");
    setTimeout(() => newWordInput?.focus(), 40);
  }

  async function addWordFromInput() {
    const raw = newWordInput?.value?.trim();
    if (!raw) return;

    // Mehrere Wörter auf einmal parsen (unterstützt Komma, Semikolon, Zeilenumbruch und Leerzeichen)
    const tokens = raw.split(/[\r\n,;\t]+/).map(s => s.trim()).filter(Boolean);
    const parsedWords = [];
    for (const t of tokens) {
      const parts = t.split(/\s+/);
      for (const p of parts) {
        const clean = p.replace(/^[\s,.;:!?\-]+|[\s,.;:!?\-]+$/g, "");
        if (clean) parsedWords.push(clean);
      }
    }

    if (parsedWords.length === 0) {
      showToast("Ungültige Eingabe", true);
      return;
    }

    const isUserDict = activeWordListType === "user_dict";
    const targetSet = isUserDict ? userDict : ignoredWords;
    const storageKey = isUserDict ? "sc_user_dict" : "sc_ignored_words";

    const existingLower = new Set(Array.from(targetSet).map(w => w.toLowerCase()));
    const addedWords = [];

    for (const w of parsedWords) {
      const wLower = w.toLowerCase();
      if (!existingLower.has(wLower)) {
        existingLower.add(wLower);
        targetSet.add(w);
        addedWords.push(w);
      }
    }

    if (addedWords.length === 0) {
      showToast(parsedWords.length === 1 ? `'${parsedWords[0]}' ist bereits in der Liste` : "Alle Wörter bereits in der Liste", true);
      newWordInput?.select();
      return;
    }

    updateWordListBadges();
    renderWordChips();
    if (newWordInput) newWordInput.value = "";

    if (typeof browser !== "undefined" && browser.storage?.local) {
      try {
        await browser.storage.local.set({ [storageKey]: Array.from(targetSet) });
      } catch (err) {
        console.error("Fehler beim Speichern der Wortliste:", err);
      }
    }

    if (addedWords.length === 1) {
      showToast(`'${addedWords[0]}' hinzugefügt`);
    } else {
      showToast(`${addedWords.length} Wörter hinzugefügt!`);
    }
    newWordInput?.focus();
  }

  async function deleteWord(word) {
    const isUserDict = activeWordListType === "user_dict";
    const targetSet = isUserDict ? userDict : ignoredWords;
    const storageKey = isUserDict ? "sc_user_dict" : "sc_ignored_words";

    if (targetSet.delete(word)) {
      updateWordListBadges();
      renderWordChips();

      if (typeof browser !== "undefined" && browser.storage?.local) {
        try {
          await browser.storage.local.set({ [storageKey]: Array.from(targetSet) });
        } catch (err) {
          console.error("Fehler beim Löschen des Worts:", err);
        }
      }

      showToast(`'${word}' entfernt`);
    }
  }

  openUserDictBtn?.addEventListener("click", () => openWordListModal("user_dict"));
  openIgnoredWordsBtn?.addEventListener("click", () => openWordListModal("ignored_words"));

  closeWordListModal?.addEventListener("click", () => {
    resetClearBtn();
    wordListModalOverlay?.classList.add("hidden");
  });

  closeWordListPrimaryBtn?.addEventListener("click", () => {
    resetClearBtn();
    wordListModalOverlay?.classList.add("hidden");
  });

  wordListModalOverlay?.addEventListener("click", (e) => {
    if (e.target === wordListModalOverlay) {
      resetClearBtn();
      wordListModalOverlay.classList.add("hidden");
    }
  });

  clearWordListBtn?.addEventListener("click", async () => {
    const isUserDict = activeWordListType === "user_dict";
    const targetSet = isUserDict ? userDict : ignoredWords;
    const storageKey = isUserDict ? "sc_user_dict" : "sc_ignored_words";

    if (targetSet.size === 0) return;

    if (!clearWordListBtn.classList.contains("confirming")) {
      clearWordListBtn.classList.add("confirming");
      clearWordListBtn.textContent = "Wirklich alle leeren?";
      if (clearConfirmTimer) clearTimeout(clearConfirmTimer);
      clearConfirmTimer = setTimeout(resetClearBtn, 3500);
      return;
    }

    // 2. Klick bestätigt
    resetClearBtn();
    targetSet.clear();

    if (typeof browser !== "undefined" && browser.storage?.local) {
      try {
        await browser.storage.local.set({ [storageKey]: [] });
      } catch (err) {
        console.error("Fehler beim Leeren der Liste:", err);
      }
    }

    updateWordListBadges();
    renderWordChips();
    showToast(isUserDict ? "Wörterbuch komplett geleert" : "Ignorierliste komplett geleert");
  });

  addWordBtn?.addEventListener("click", addWordFromInput);

  newWordInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addWordFromInput();
    }
  });

  filterWordInput?.addEventListener("input", renderWordChips);

  wordListContainer?.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-chip-del");
    if (btn) {
      const word = btn.dataset.word;
      if (word) deleteWord(word);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (wordListModalOverlay && !wordListModalOverlay.classList.contains("hidden")) {
        resetClearBtn();
        wordListModalOverlay.classList.add("hidden");
      } else if (jsonModalOverlay && !jsonModalOverlay.classList.contains("hidden")) {
        jsonModalOverlay.classList.add("hidden");
      }
    }
  });

  resetBtn?.addEventListener("click", () => {
    currentSettings = { ...DEFAULT_SETTINGS };
    updatePreviewAndLabels(currentSettings, true);
    if (typeof browser !== "undefined" && browser.storage?.local) {
      browser.storage.local.set({ sc_settings: currentSettings }).catch((err) => {
        console.error("Fehler beim Zurücksetzen der Einstellungen:", err);
      });
    }
    showToast("Auf Standard zurückgesetzt");
  });

  // Einstellungen und Wortlisten aus dem Speicher laden
  if (typeof browser !== "undefined" && browser.storage?.local) {
    browser.storage.local.get(["sc_settings", "sc_user_dict", "sc_ignored_words"]).then((res) => {
      if (res && res.sc_settings) {
        currentSettings = { ...DEFAULT_SETTINGS, ...res.sc_settings };
        if (typeof currentSettings.letterSpacing === "number" && currentSettings.letterSpacing < 0) {
          currentSettings.letterSpacing = 0;
        }
      }
      if (Array.isArray(res?.sc_user_dict)) {
        userDict = new Set(res.sc_user_dict);
      }
      if (Array.isArray(res?.sc_ignored_words)) {
        ignoredWords = new Set(res.sc_ignored_words);
      }
      updatePreviewAndLabels(currentSettings, true);
      updateWordListBadges();
    }).catch((err) => {
      console.error("Fehler beim Laden der Einstellungen:", err);
      updatePreviewAndLabels(currentSettings, true);
      updateWordListBadges();
    });

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") {
        if (changes.sc_user_dict?.newValue && Array.isArray(changes.sc_user_dict.newValue)) {
          userDict = new Set(changes.sc_user_dict.newValue);
          updateWordListBadges();
          if (activeWordListType === "user_dict" && wordListModalOverlay && !wordListModalOverlay.classList.contains("hidden")) {
            renderWordChips();
          }
        }
        if (changes.sc_ignored_words?.newValue && Array.isArray(changes.sc_ignored_words.newValue)) {
          ignoredWords = new Set(changes.sc_ignored_words.newValue);
          updateWordListBadges();
          if (activeWordListType === "ignored_words" && wordListModalOverlay && !wordListModalOverlay.classList.contains("hidden")) {
            renderWordChips();
          }
        }
      }
    });
  } else {
    updatePreviewAndLabels(currentSettings, true);
    updateWordListBadges();
  }
})();
