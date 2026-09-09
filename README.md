# Deutsche Rechtschreibprüfung (Lokal & Datenschutzfreundlich)

Die Rechtschreibprüfung von Firefox ist in der Zeit stehen geblieben. Völlig fremde Wörter werden vorgeschlagen, oft total unpassende.

Ich habe daher ein Add-on gebaut, das genau das verbessert. Mir war es wichtig, alles lokal laufen zu lassen. Cloud-KI-Lösungen können abgeschaltet werden, Daten in der Cloud können mitgeschrieben werden und API-Anbieter können Geld verlangen. **Hier ist alles 100 % lokal.**

---

## Funktionsweise

Das Add-on arbeitet zweistufig:
1. **Mathematischer Wörterbuch-Abgleich:** Falsch geschriebene Wörter werden blitzschnell mit einem kompakten DAFSA-Automaten über 2,7 Millionen Wortformen abgeglichen und im Vorschlags-Popup angezeigt. Das Add-on erkennt sowohl extrem lange, komplexe Zusammensetzungen (Komposita) als auch kurze Wörter.
2. **Lokales BERT-Sprachmodell:** Wörter in Sätzen werden durch das lokale Sprachmodell überprüft. Es ist darauf trainiert, im Satzkontext die treffendste Vorhersage für das fehlerhafte Wort zu treffen (z. B. präzise Nomen- und Verbunterscheidung wie *„aus Versehen“* vs. *„sie wollen versehen“*).

Natürlich klappt es nicht bei jedem einzelnen Wort – aber es gibt eine treffende Auswahl und zu über 98 % passt der beste Vorschlag.

---

## Technische Beschreibung & Datenschutz

- **Keine Cloud & keine Telemetrie:** Das Add-on verzichtet vollständig auf externe Schnittstellen, Cloud-APIs oder Hintergrund-Telemetrie.
- **Keine Benutzerregistrierung:** Die gesamte linguistische Analyse, Tokenisierung und neuronale Kontextbewertung findet ausschließlich lokal im Browser statt.
- **Eigene Wörterbücher lokal:** Persönliche Ausnahmelisten und benutzerdefinierte Wörter verbleiben strikt im lokalen Browser-Speicher (`browser.storage.local`).
- **Anpassbares Design:** Vollständige Kontrolle über Schriftgrößen, Farben, Schriftarten und Abstände über das Dashboard.

---

## Benchmarks & Kennzahlen

- **99,22 % Erkennungsrate** auf realem deutschem Gegenwartswortschatz (validiert gegen ein Benchmark-Korpus von 20.000 hochfrequenten Wörtern aus Nachrichten- und Medienquellen).
- **2.696.775 abgedeckte Wortformen und Lemmata.**

---

## Warum beträgt die Downloadgröße ca. 120 MB?

Konventionelle Rechtschreibprüfungen lagern ihre Rechenlast und Sprachmodelle auf externe Rechenzentren aus. Jeder Tastenanschlag wird über HTTP/WebSocket an Fremdserver übertragen – das ermöglicht zwar kleine Downloadgrößen, exponiert jedoch sensible, vertrauliche Textdaten.

Dieses Add-on bringt das gesamte deutsche Wörterbuch, den Häufigkeitskorpus und das neuronale Modell direkt auf deinen Rechner mit. Einmal heruntergeladen, arbeitet die Prüfung für immer offline, unabhängig und privat.

---

## Projektstruktur

```text
├── extension/                     # Die Browser-Erweiterung (Firefox / WebExtension)
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
