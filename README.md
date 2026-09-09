# Deutsche Rechtschreibprüfung (Lokal & Datenschutzfreundlich)

Eine moderne, vollständig lokale Firefox-Erweiterung zur deutschen Rechtschreibprüfung mit Unterstützung für komplexe Komposita und lokaler neuronaler Satzkontext-Bewertung.

---

## Highlights

- **100 % Lokal & Privat:** Keine Cloud, keine externen APIs, keine Telemetrie. Alle Eingaben bleiben ausschließlich im Browser.
- **Umfassender Wortschatz:** Über 2,7 Millionen abgedeckte deutsche Wortformen und Lemmata auf Basis eines kompakten DAFSA-Graphen.
- **Intelligente Komposita-Erkennung:** Zerlegt und korrigiert auch extrem lange, komplexe deutsche Zusammensetzungen (*z. B. „Einkommenssteuererklärungspflicht“*) fehlerfrei und verhindert Fantasiewörter.
- **Kontextbasierte Vorschläge:** Lokales Masked Language Model (GBERT) via ONNX Runtime WebAssembly zur präzisen Unterscheidung von Nomen und Verben (*z. B. „aus Versehen“ vs. „sie wollen versehen“*).
- **Anpassbares Design:** Vollständige Kontrolle über Farben, Schriftarten, Abstände und eigene Wörterbücher über das Einstellungsmenü.

---

## Projektstruktur

```text
├── extension/                     # Die eigentliche Browser-Erweiterung (Firefox / WebExtension)
│   ├── manifest.json              # Extension-Manifest (Manifest V2)
│   ├── background/
│   │   └── background.js          # DAFSA-Engine, Komposita-Synthese, Bayes-Ranking, MLM
│   ├── content/
│   │   ├── content.js             # DOM-Mirroring, Wortprüfung in Textfeldern, Popup-UI
│   │   └── content.css            # Styles für Markierungen und Vorschlagsmenü
│   ├── settings/
│   │   ├── settings.html          # Einstellungs-Dashboard
│   │   ├── settings.js            # UI-Logik, Wörterlisten-Import/Export, Farbwähler
│   │   └── settings.css
│   ├── icons/                     # Icons in den Standardauflösungen (16, 32, 48, 96, 128)
│   └── data/                      # Wörterbuch & Sprachmodelle
│       ├── german_dictionary.bin  # Kompakter binärer DAFSA-Graph (Wörterbuch)
│       ├── german_language_data.json # Häufigkeitskorpus, Wortstatistiken & Tippfehlerdaten
│       ├── gbert_part1.bin        # GBERT-Modellgewichte (Teil 1)
│       ├── gbert_part2.bin        # GBERT-Modellgewichte (Teil 2)
│       ├── ort.min.js             # ONNX Runtime Web
│       ├── ort-wasm-simd-threaded.jsep.wasm
│       └── ort-wasm-simd-threaded.jsep.mjs
│
├── build/                         # Python-Build-Skripte zur DAFSA- und Korpus-Erzeugung
│   ├── build_dafsa.py
│   └── ...
└── .gitignore                     # Schließt sensible Upload-Skripte und Caches aus
```

---

## Lokale Installation in Firefox

1. Klone oder lade das Repository herunter.
2. Öffne in Firefox die Seite `about:debugging#/runtime/this-firefox`.
3. Klicke auf **„Temporäres Add-on laden…“**.
4. Wähle die Datei `extension/manifest.json` aus.
