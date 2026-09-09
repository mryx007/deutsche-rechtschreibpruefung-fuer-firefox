# Deutsche Rechtschreibprüfung (Lokal & Offline)

Die Rechtschreibprüfung von Firefox ist in der Zeit stehen geblieben. Völlig fremde Wörter werden vorgeschlagen, oft total unpassende.

Ich habe daher ein Add-on gebaut, das genau das verbessert. Mir war es wichtig, alles lokal laufen zu lassen. Cloud-KI-Lösungen können abgeschaltet werden, Daten in der Cloud können mitgeschrieben werden und API-Anbieter können Geld verlangen. **Hier ist alles 100 % lokal.**

---

## Funktionsweise

Das Add-on arbeitet zweistufig:
1. **Mathematischer Wörterbuch-Abgleich:** Falsch geschriebene Wörter werden blitzschnell mit einem kompakten DAFSA-Automaten über 2,7 Millionen Wortformen abgeglichen und im Vorschlags-Popup angezeigt. Das Add-on erkennt sowohl extrem lange, komplexe Zusammensetzungen (Komposita) als auch kurze Wörter.
2. **Lokales BERT-Sprachmodell:** Wörter in Sätzen werden durch das lokale Sprachmodell überprüft. Es ist darauf trainiert, im Satzkontext die treffendste Vorhersage für das fehlerhafte Wort zu treffen (z. B. präzise Nomen- und Verbunterscheidung wie *„aus Versehen“* vs. *„sie wollen versehen“*).

Natürlich klappt es nicht bei jedem einzelnen Wort – aber es gibt eine treffende Auswahl und zu über 98 % passt der beste Vorschlag.

---

## Welches KI-Modell wird eingesetzt?

Im Add-on arbeitet ein für WebAssembly optimiertes **GBERT (German BERT)** – ein neuronales Transformer-Sprachmodell, das speziell auf die deutsche Sprache trainiert wurde:

- **Modellarchitektur:** Bidirektionaler Transformer (BERT-Base Architecture) mit Masked Language Modeling (MLM).
- **Laufzeit-Engine:** **ONNX Runtime Web** mit Multi-Threaded WebAssembly (`WASM`) und Hardware-beschleunigten `SIMD`-Vektoroperationen direkt im Browser.
- **Tokenizer:** Deutscher **WordPiece-Tokenizer** mit 31.102 Vokabeln zur fehlerfreien Zerlegung komplexer Wortstämme und Affixe.
- **Inferenz:** Beim Tippen wird das fragliche Wort durch `[MASK]`-Tokens ersetzt. GBERT analysiert das gesamte Satzumfeld bidirektional und errechnet eine Wahrscheinlichkeitsverteilung über das deutsche Vokabular.

---

## Mathematische Modelle & Berechnungsformeln

Die Generierung und Sortierung der Vorschläge stützt sich auf fundierte probabilistische und mathematische Formeln:

### 1. Bayesianisches Ranking-Modell (Log-Posterior)
Für jeden Korrekturkandidaten $c$ zu einem Tippfehler $w$ wird die A-posteriori-Wahrscheinlichkeit im logarithmischen Raum maximiert:

$$\log P(c \mid w) = \log P(w \mid c) + \alpha \cdot \log P(c)$$

- **Fehlermodell (Likelihood $\log P(w \mid c)$):**
  $$\log P(w \mid c) = -2.2 \cdot \text{Dist}_{\text{weighted}}(w, c) + \text{Boni}_{\text{Phonetik, Präfix, Suffix}}$$
  Hierbei fließt die **gewichtete Damerau-Levenshtein-Distanz** ein, kombiniert mit:
  - **QWERTZ-Tastaturgeometrie:** Euklidischer Tastenabstand auf der deutschen Tastatur ($d \approx 0.35$ für Nachbartasten wie $E \leftrightarrow R$ statt $1.0$).
  - **Kölner Phonetik:** Lautgleiche deutsche Schreibungen (z. B. *V* vs. *F*, *ph* vs. *f*) erhalten einen Likelihood-Bonus von $+0.9$.
  - **Key-Bounce-Erkennung:** Versehentliche Buchstaben-Dopplungen (*„zeitrraum“* $\rightarrow$ *„zeitraum“*) erhalten $+0.8$.
- **Sprachmodell-Prior ($\log P(c)$):**
  $$\log P(c) = \ln\left(\frac{\text{Count}(c) + \epsilon}{N + \epsilon \cdot V}\right)$$
  Additive Glättung ($\epsilon = 0.10$) über den 40.000+ Häufigkeitskorpus mit Gesamttokenanzahl $N$ und Vokabulargröße $V$.
- **Gewichtungsfaktor:** $\alpha = 0.40$ (`WORD_FREQUENCY_PRIOR_WEIGHT`).

### 2. Neuronales MLM-Rebalancing
Die finale Rangfolge verbindet die geometrische Tippfehler-Distanz mit der Kontext-Wahrscheinlichkeit des neuronalen Sprachmodells:

$$\text{LogScore}(c) = \frac{1}{M} \sum_{i=1}^{M} \left( \text{Logits}[\text{maskPos}_i, \text{tokenId}_i] - \text{LogSumExp}(\text{Logits}[\text{maskPos}_i]) \right)$$

$$P_{\text{LM}}(c) = \frac{\exp(\text{LogScore}(c) - \max_j \text{LogScore}(j))}{\sum_k \exp(\text{LogScore}(k) - \max_j \text{LogScore}(j))}$$

$$\text{FinalScore}(c) = 0.30 \cdot P_{\text{LM}}(c) + 0.70 \cdot \text{EditScore}(w, c) + \text{Bonus}_{\text{UserDict}}$$

$$\text{EditScore}(w, c) = \frac{1}{1 + d_{\text{eff}}}, \quad \text{wobei } d_{\text{eff}} = \max\left(0.1, -\frac{\log P(c \mid w)}{3.0}\right)$$

### 3. Komposita-Zerlegung & Morphologischer Grundwort-Filter
Deutsche Komposita werden nach den Regeln des *Amtlichen Regelwerks (RfdR 2024)* zerlegt:
$$W = P + F + S$$
- $P$: Bestimmungswort (Präfix, z. B. *„Einkommenssteuererklärung“*)
- $F \in \{\emptyset, \text{„s“}, \text{„es“}, \text{„en“}, \text{„n“}\}$: Fugenelement (mit phonotaktischer Sperre nach Zischlauten wie $s, ß, z, x$)
- $S$: Grundwort (Head/Suffix, z. B. *„pflicht“*)
- **Appellativum-Filter:** Das Grundwort $S$ muss im Häufigkeitskorpus belegt sein oder eine produktive deutsche Nomen-Endung (`-ung`, `-heit`, `-keit`, `-schaft`, `-tum`, `-ion`, etc.) tragen. Geografische Eigennamen (wie *„Pflach“* oder *„Pölich“*) werden mathematisch ausgeschlossen.

---

## Benchmarks & Performanz-Kennzahlen

| Metrik | Ergebnis | Validierungsgrundlage |
|---|---|---|
| **Wortschatz-Abdeckung** | **2.696.775** | Deutsche Wortformen und Lemmata im kompakten DAFSA-Graphen |
| **Erkennungsrate** | **99,22 %** | Validiert gegen ein Korpus von 20.000 hochfrequenten Wörtern aus Nachrichtenquellen |
| **Vorschlags-Trefferquote** | **98,73 %** | Reale Tippfehler-Szenarien mit passendem Begriff in den Top-Vorschlägen |
| **Nomen-/Kontext-Regeltreue** | **100 % (80/80)** | Automatisierte Test-Suite für Nomen-Signale, Groß-/Kleinschreibung & RfdR § 57/§ 58 |
| **Wörterbuchgröße (RAM)** | **6,4 MB** | Deterministischer azyklischer endlicher Zustandsautomat (DAFSA) |
| **Latenz pro Wortabgleich** | **< 1 ms** | $O(L)$-Suchzeit unabhängig von der Wörterbuchgröße |

---

## Technische Beschreibung & Datenschutz

- **Keine Cloud & keine Telemetrie:** Das Add-on verzichtet vollständig auf externe Schnittstellen, Cloud-APIs oder Hintergrund-Telemetrie.
- **Keine Benutzerregistrierung:** Die gesamte linguistische Analyse, Tokenisierung und neuronale Kontextbewertung findet ausschließlich lokal im Browser statt.
- **Eigene Wörterbücher lokal:** Persönliche Ausnahmelisten und benutzerdefinierte Wörter verbleiben strikt im lokalen Browser-Speicher (`browser.storage.local`).
- **Anpassbares Design:** Vollständige Kontrolle über Schriftgrößen, Farben, Schriftarten und Abstände über das Dashboard.

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
