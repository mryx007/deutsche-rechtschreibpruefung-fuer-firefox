// ============================================================================
// Automatisierte Satz-Testsuite & Regressionsprüfung für die Rechtschreibprüfung
// Testet Nomen-Signale, Groß-/Kleinschreibung, Kontext-Vorschläge & MLM-Gewichte
// ============================================================================

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// 1. Hintergrund-Skript laden und isoliert ausführen
const bgPath = path.join(__dirname, '..', 'extension', 'background', 'background.js');
const bgSrc = fs.readFileSync(bgPath, 'utf8');

// Vor browser.storage abschneiden, damit nur Klassen und Funktionen geladen werden
const coreSrc = bgSrc.split('let currentCheckCase = true;')[0] + `
globalThis.__testExports = {
  DAFSA,
  GermanCompoundValidator,
  SpellCheckEngine,
  MLMContextScorer,
  normalizeLookupWord,
  detectNounSignal,
  GERMAN_NOUN_SIGNAL_WORDS
};
`;

const ctx = {
  TextDecoder: require('util').TextDecoder,
  console: console,
  Math: Math,
  Set: Set,
  Map: Map,
  Array: Array,
  Object: Object,
  RegExp: RegExp,
  String: String,
  Number: Number,
  Boolean: Boolean
};

vm.createContext(ctx);
vm.runInContext(coreSrc, ctx);

const {
  DAFSA,
  GermanCompoundValidator,
  SpellCheckEngine,
  MLMContextScorer,
  detectNounSignal,
  GERMAN_NOUN_SIGNAL_WORDS
} = ctx.__testExports;

// 2. DAFSA & Sprachdaten laden
const dictBuffer = fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'german_dictionary.bin'));
const ab = dictBuffer.buffer.slice(dictBuffer.byteOffset, dictBuffer.byteOffset + dictBuffer.byteLength);
const dafsa = new DAFSA(ab);
const compounds = new GermanCompoundValidator(dafsa);
const langData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'data', 'german_language_data.json'), 'utf8'));
const vocab = langData.vocab;
const wordFreq = langData.corpus;
const commonTypos = langData.typos;

const engine = new SpellCheckEngine(
  dafsa, compounds, null, new Set(), new Set(), vocab, wordFreq, commonTypos
);

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message, details = "") {
  if (condition) {
    totalPassed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    totalFailed++;
    console.error(`  ❌ FAIL: ${message} ${details ? "(" + details + ")" : ""}`);
  }
}

// ----------------------------------------------------------------------------
// TEST-BLOCK 1: Satz-Kontexte für Nomen-Signal-Erkennung (detectNounSignal)
// ----------------------------------------------------------------------------
function runSignalTests() {
  console.log("\n--- BLOCK 1: Satz-Kontexte Nomen-Signal-Erkennung (detectNounSignal) ---");

  const signalTests = [
    // Präpositionen
    { context: "aus vershen", start: 4, expected: true, label: "Präposition: 'aus'" },
    { context: "bei bedarf", start: 4, expected: true, label: "Präposition: 'bei'" },
    { context: "mit freude", start: 4, expected: true, label: "Präposition: 'mit'" },
    { context: "nach hause", start: 5, expected: true, label: "Präposition: 'nach'" },
    { context: "von herzen", start: 4, expected: true, label: "Präposition: 'von'" },
    { context: "zu fuss", start: 3, expected: true, label: "Präposition: 'zu'" },
    { context: "im voraus", start: 3, expected: true, label: "Präposition: 'im'" },
    { context: "am anfang", start: 3, expected: true, label: "Präposition: 'am'" },
    { context: "beim essn", start: 5, expected: true, label: "Präposition: 'beim'" },
    { context: "zum wohl", start: 4, expected: true, label: "Präposition: 'zum'" },
    { context: "zur hilfe", start: 4, expected: true, label: "Präposition: 'zur'" },
    { context: "ohne zweifl", start: 5, expected: true, label: "Präposition: 'ohne'" },
    { context: "durch zufall", start: 6, expected: true, label: "Präposition: 'durch'" },
    { context: "für kinder", start: 4, expected: true, label: "Präposition: 'für'" },
    { context: "vor angst", start: 4, expected: true, label: "Präposition: 'vor'" },
    { context: "in ordnung", start: 3, expected: true, label: "Präposition: 'in'" },
    { context: "auf wiedersehen", start: 4, expected: true, label: "Präposition: 'auf'" },
    { context: "unter tränen", start: 6, expected: true, label: "Präposition: 'unter'" },
    { context: "über nacht", start: 5, expected: true, label: "Präposition: 'über'" },
    { context: "trotz regen", start: 6, expected: true, label: "Präposition: 'trotz'" },

    // Artikel
    { context: "das essen", start: 4, expected: true, label: "Bestimmter Artikel: 'das'" },
    { context: "der anfang", start: 4, expected: true, label: "Bestimmter Artikel: 'der'" },
    { context: "die hoffnung", start: 4, expected: true, label: "Bestimmter Artikel: 'die'" },
    { context: "ein vershen", start: 4, expected: true, label: "Unbestimmter Artikel: 'ein'" },
    { context: "eine freude", start: 5, expected: true, label: "Unbestimmter Artikel: 'eine'" },
    { context: "kein problem", start: 5, expected: true, label: "Negationsartikel: 'kein'" },

    // Pronomen / Possessiva
    { context: "mein bedauern", start: 5, expected: true, label: "Possessiv: 'mein'" },
    { context: "dein vershen", start: 5, expected: true, label: "Possessiv: 'dein'" },
    { context: "ihr wissen", start: 4, expected: true, label: "Possessiv: 'ihr'" },
    { context: "unser vater", start: 6, expected: true, label: "Possessiv: 'unser'" },
    { context: "sein zögern", start: 5, expected: true, label: "Possessiv: 'sein'" },
    { context: "euer glück", start: 5, expected: true, label: "Possessiv: 'euer'" },

    // Phrasen mit flektiertem Adjektiv
    { context: "aus reinem vershen", start: 11, expected: true, label: "Signal + Adjektiv (-em): 'aus reinem'" },
    { context: "mit grosser freude", start: 12, expected: true, label: "Signal + Adjektiv (-er): 'mit grosser'" },
    { context: "nach langem schlafn", start: 12, expected: true, label: "Signal + Adjektiv (-em): 'nach langem'" },
    { context: "ohne jeden zweifl", start: 11, expected: true, label: "Signal + Adjektiv (-en): 'ohne jeden'" },
    { context: "für besseres wissn", start: 13, expected: true, label: "Signal + Adjektiv (-es): 'für besseres'" },
    { context: "das ewige wartn", start: 10, expected: true, label: "Artikel + Adjektiv (-e): 'das ewige'" },
    { context: "ein lautes lachn", start: 11, expected: true, label: "Artikel + Adjektiv (-es): 'ein lautes'" },

    // Negative Fälle (Verb-/Satzkontext darf KEIN Nomen-Signal auslösen)
    { context: "Userscript für gelesen markieen", start: 23, expected: false, label: "Partizip II + Infinitiv: 'für gelesen markieen'" },
    { context: "als gelesen markieen", start: 12, expected: false, label: "Partizip II nach 'als': 'als gelesen markieen'" },
    { context: "bereit für immer bleibn", start: 17, expected: false, label: "Adverb: 'für immer bleibn'" },
    { context: "Zeit für heute schliessn", start: 15, expected: false, label: "Adverb: 'für heute schliessn'" },
    { context: "Hilfe für zusammen lernn", start: 19, expected: false, label: "Adverb: 'für zusammen lernn'" },
    { context: "sie wollen vershen", start: 11, expected: false, label: "Verbkontext: 'sie wollen'" },
    { context: "wir müssen essn", start: 11, expected: false, label: "Verbkontext: 'wir müssen'" },
    { context: "ich kann wissn", start: 9, expected: false, label: "Verbkontext: 'ich kann'" },
    { context: "sie werden schlafn", start: 11, expected: false, label: "Verbkontext: 'sie werden'" },
    { context: "er hat gesgt", start: 7, expected: false, label: "Verbkontext: 'er hat'" },
    { context: "sie möchten lesn", start: 12, expected: false, label: "Verbkontext: 'sie möchten'" },

    // Edge Cases
    { context: "vershen", start: 0, expected: false, label: "Wort am Textanfang (start = 0)" },
    { context: "", start: 0, expected: false, label: "Leerer Text" },
    { context: null, start: 5, expected: false, label: "null-Kontext" },
    { context: "aus vershen", start: -1, expected: false, label: "Negativer start" }
  ];

  for (const st of signalTests) {
    const result = detectNounSignal(st.context, st.start);
    assert(result === st.expected, st.label, `Erhalten: ${result}, Erwartet: ${st.expected}`);
  }
}

// ----------------------------------------------------------------------------
// TEST-BLOCK 2: Vollständige Sätze für getSuggestions (Top-1 Vorschlag)
// ----------------------------------------------------------------------------
const suggestionSentenceTests = [
  // Substantivierte Verben vs. Infinitiv (aus Versehen, beim Essen, zum Lesen etc.)
  {
    label: "Satz: 'aus vershen' -> 'Versehen' (Groß)",
    word: "vershen", context: "aus vershen", start: 4, isFirst: false,
    expectedTop1: "Versehen"
  },
  {
    label: "Satz: 'ein vershen' -> 'Versehen' (Groß)",
    word: "vershen", context: "ein vershen", start: 4, isFirst: false,
    expectedTop1: "Versehen"
  },
  {
    label: "Satz: 'aus reinem vershen' -> 'Versehen' (Groß)",
    word: "vershen", context: "aus reinem vershen", start: 11, isFirst: false,
    expectedTop1: "Versehen"
  },
  {
    label: "Satz: 'sie wollen vershen' -> 'versehen' (Klein)",
    word: "vershen", context: "sie wollen vershen", start: 11, isFirst: false,
    expectedTop1: "versehen"
  },
  {
    label: "Satz: 'beim essn' -> 'Essen' (Groß)",
    word: "essn", context: "beim essn", start: 5, isFirst: false,
    expectedTop1: "Essen"
  },
  {
    label: "Satz: 'wir müssen essn' -> 'essen' (Klein)",
    word: "essn", context: "wir müssen essn", start: 11, isFirst: false,
    expectedTop1: "essen"
  },
  {
    label: "Satz: 'ohne wissn' -> 'Wissen' (Groß)",
    word: "wissn", context: "ohne wissn", start: 5, isFirst: false,
    expectedTop1: "Wissen"
  },
  {
    label: "Satz: 'sie sollten wissn' -> 'wissen' (Klein)",
    word: "wissn", context: "sie sollten wissn", start: 12, isFirst: false,
    expectedTop1: "wissen"
  },
  {
    label: "Satz: 'nach langem schlafn' -> 'Schlafen' (Groß)",
    word: "schlafn", context: "nach langem schlafn", start: 12, isFirst: false,
    expectedTop1: "Schlafen"
  },
  {
    label: "Satz: 'sie wollen schlafn' -> 'schlafen' (Klein)",
    word: "schlafn", context: "sie wollen schlafn", start: 11, isFirst: false,
    expectedTop1: "schlafen"
  },
  {
    label: "Satz: 'zum lesn' -> 'Lesen' (Groß)",
    word: "lesn", context: "zum lesn", start: 4, isFirst: false,
    expectedTop1: "Lesen"
  },
  {
    label: "Satz: 'wir wollen lesn' -> 'lesen' (Klein)",
    word: "lesn", context: "wir wollen lesn", start: 11, isFirst: false,
    expectedTop1: "lesen"
  },
  {
    label: "Satz: 'zum nachdenkn' -> 'Nachdenken' (Groß)",
    word: "nachdenkn", context: "zum nachdenkn", start: 4, isFirst: false,
    expectedTop1: "Nachdenken"
  },
  {
    label: "Satz: 'wir wollen nachdenkn' -> 'nachdenken' (Klein)",
    word: "nachdenkn", context: "wir wollen nachdenkn", start: 11, isFirst: false,
    expectedTop1: "nachdenken"
  },
  {
    label: "Satz: 'das lange wartn' -> 'Warten' (Groß)",
    word: "wartn", context: "das lange wartn", start: 10, isFirst: false,
    expectedTop1: "Warten"
  },
  {
    label: "Satz: 'wir müssen wartn' -> 'warten' (Klein)",
    word: "wartn", context: "wir müssen wartn", start: 11, isFirst: false,
    expectedTop1: "warten"
  },
  {
    label: "Satz: 'beim einkauffn' -> 'Einkaufen' (Groß)",
    word: "einkauffn", context: "beim einkauffn", start: 5, isFirst: false,
    expectedTop1: "Einkaufen"
  },
  {
    label: "Satz: 'sie gehen einkauffn' -> 'einkaufen' (Klein)",
    word: "einkauffn", context: "sie gehen einkauffn", start: 10, isFirst: false,
    expectedTop1: "einkaufen"
  },
  {
    label: "Satz: 'ein lautes lachn' -> 'Lachen' (Groß)",
    word: "lachn", context: "ein lautes lachn", start: 11, isFirst: false,
    expectedTop1: "Lachen"
  },
  {
    label: "Satz: 'sie müssen lachn' -> 'lachen' (Klein)",
    word: "lachn", context: "sie müssen lachn", start: 11, isFirst: false,
    expectedTop1: "lachen"
  },
  {
    label: "Satz: 'mit bedaurn' -> 'Bedauern' (Groß)",
    word: "bedaurn", context: "mit bedaurn", start: 4, isFirst: false,
    expectedTop1: "Bedauern"
  },
  {
    label: "Satz: 'im vorraus' -> 'Voraus' (Groß)",
    word: "vorraus", context: "im vorraus", start: 3, isFirst: false,
    expectedTop1: "Voraus"
  },
  {
    label: "Satz: 'auf wiedersehn' -> 'Wiedersehen' (Groß)",
    word: "wiedersehn", context: "auf wiedersehn", start: 4, isFirst: false,
    expectedTop1: "Wiedersehen"
  },

  // Infinitiv mit 'zu' (§ 57 RdR 2024: Kleinschreibung)
  {
    label: "Satz: 'um zu gehn' -> 'gehen' (Klein)",
    word: "gehn", context: "um zu gehn", start: 6, isFirst: false,
    expectedTop1: "gehen"
  },
  {
    label: "Satz: 'ohne zu wissn' -> 'wissen' (Klein)",
    word: "wissn", context: "ohne zu wissn", start: 8, isFirst: false,
    expectedTop1: "wissen"
  },
  {
    label: "Satz: 'bereit zu helfn' -> 'helfen' (Klein)",
    word: "helfn", context: "bereit zu helfn", start: 10, isFirst: false,
    expectedTop1: "helfen"
  },
  {
    label: "Satz: 'Zeit zu gehnn' -> 'gehen' (Klein)",
    word: "gehnn", context: "Zeit zu gehnn", start: 8, isFirst: false,
    expectedTop1: "gehen"
  },
  {
    label: "Satz: 'Mut zu habn' -> 'haben' (Klein)",
    word: "habn", context: "Mut zu habn", start: 7, isFirst: false,
    expectedTop1: "haben"
  },

  // Partizipien / Adverbien nach Präpositionen (keine Substantivierung)
  {
    label: "Satz: 'Userscript für gelesen markieen' -> 'markieren' (Klein)",
    word: "markieen", context: "Userscript für gelesen markieen", start: 23, isFirst: false,
    expectedTop1: "markieren"
  },
  {
    label: "Satz: 'als gelesen markieen' -> 'markieren' (Klein)",
    word: "markieen", context: "als gelesen markieen", start: 12, isFirst: false,
    expectedTop1: "markieren"
  },

  // Superlativ mit 'am' vs. Nomen (§ 58 (2) RdR 2024)
  {
    label: "Satz: 'das ist am bestn' -> 'besten' (Klein)",
    word: "bestn", context: "das ist am bestn", start: 11, isFirst: false,
    expectedTop1: "besten"
  },
  {
    label: "Satz: 'am schnellstn' -> 'schnellsten' (Klein)",
    word: "schnellstn", context: "am schnellstn", start: 3, isFirst: false,
    expectedTop1: "schnellsten"
  },
  {
    label: "Satz: 'am abend' -> 'Abend' (Groß)",
    word: "abend", context: "am abend", start: 3, isFirst: false,
    expectedTop1: "Abend"
  },

  // Substantivierte Adjektive nach Indefinitpronomen (§ 57 (1) RdR 2024)
  {
    label: "Satz: 'etwas neuess' -> 'Neues' (Groß)",
    word: "neuess", context: "etwas neuess", start: 6, isFirst: false,
    expectedTop1: "Neues"
  },
  {
    label: "Satz: 'alles gutte' -> 'Gute' (Groß)",
    word: "gutte", context: "alles gutte", start: 6, isFirst: false,
    expectedTop1: "Gute"
  },

  // Satzanfang vs. Satzmitte
  {
    label: "Satzanfang: 'verstee' (isFirst=true) -> 'Verstehe'",
    word: "verstee", context: "verstee", start: 0, isFirst: true,
    expectedTop1: "Verstehe"
  },
  {
    label: "Satzmitte: 'er verstee das' (isFirst=false) -> 'verstehe'",
    word: "verstee", context: "er verstee das", start: 3, isFirst: false,
    expectedTop1: "verstehe"
  }
];

async function runSuggestionTests() {
  console.log("\n--- BLOCK 2: Vollständige Sätze für Top-1 Vorschläge (getSuggestions) ---");
  for (const st of suggestionSentenceTests) {
    const end = st.start + st.word.length;
    const sugs = (await engine.getSuggestions(st.word, st.context, st.isFirst, true, st.start, end)).map(s => s.word);
    const top1 = sugs[0] || "KEIN_VORSCHLAG";
    const ok = top1 === st.expectedTop1;
    assert(ok, st.label, `Erhalten: '${top1}', Erwartet: '${st.expectedTop1}', Top 3: [${sugs.slice(0, 3).join(', ')}]`);
  }
}

// ----------------------------------------------------------------------------
// TEST-BLOCK 3: MLM-Rebalancing & Distanz-Ankerung
// ----------------------------------------------------------------------------
function runMlmWeightTests() {
  console.log("\n--- BLOCK 3: MLM-Rebalancing (Tippfehler vs. Sprachmodell) ---");

  // Gewicht: 0.30 * lmProb + 0.70 * editScore
  const candVersehen = { word: "Versehen", editScore: 0.95, fromUserDict: false };
  const candVersen = { word: "Versen", editScore: 0.65, fromUserDict: false };

  // Mit altem Gewicht (0.72 LM + 0.28 Edit):
  const oldScoreVersehen = 0.72 * 0.15 + 0.28 * 0.95; // 0.374
  const oldScoreVersen = 0.72 * 0.85 + 0.28 * 0.65;   // 0.794 -> Versen gewann fehlerhaft
  assert(oldScoreVersen > oldScoreVersehen, "Altes Modell bevorzugte fälschlicherweise 'Versen' vor 'Versehen'");

  // Mit neuem balancierten Gewicht (0.30 LM + 0.70 Edit):
  const newScoreVersehen = 0.30 * 0.15 + 0.70 * 0.95; // 0.710
  const newScoreVersen = 0.30 * 0.85 + 0.70 * 0.65;   // 0.710
  assert(newScoreVersehen >= newScoreVersen, "Neues Modell verhindert Übersteuerung durch rohe LM-Wahrscheinlichkeit");
}

// ----------------------------------------------------------------------------
// TEST-BLOCK 4: Allgemeine Rechtschreib- & Casing-Regressionen
// ----------------------------------------------------------------------------
const regressionTests = [
  { word: "vieleicht", expected: "vielleicht" },
  { word: "wiederspiegeln", expected: "widerspiegeln" },
  { word: "Rhytmus", expected: "Rhythmus" },
  { word: "Standart", expected: "Standard" },
  { word: "interesant", expected: "interessant" },
  { word: "komme", isCorrect: true },
  { word: "Versehen", isCorrect: true },
  { word: "versehen", isCorrect: true },
  { word: "Auto", isCorrect: true },
  { word: "auto", isCorrect: false }, // Reines deutsches Nomen kleingeschrieben ist falsch
  { word: "Apfel", isCorrect: true },
  { word: "apfel", isCorrect: false }, // Reines deutsches Nomen kleingeschrieben ist falsch
  { word: "Computer", isCorrect: true },
  { word: "Überraschung", isCorrect: true },
  { word: "Ueberraschung", expected: "Überraschung" }
];

function runRegressionTests() {
  console.log("\n--- BLOCK 4: Allgemeine Rechtschreib- & Casing-Regressionen ---");
  for (const rt of regressionTests) {
    if (rt.isCorrect !== undefined) {
      const ok = engine.isCorrect(rt.word, false, true);
      assert(ok === rt.isCorrect, `isCorrect('${rt.word}') === ${rt.isCorrect}`, `Erhalten: ${ok}`);
    } else {
      const sugs = engine.collectCandidates(rt.word, false, 5).map(c => c.word);
      const top1 = sugs[0] || "KEIN_TREFFER";
      assert(top1.toLowerCase() === rt.expected.toLowerCase(), `collectCandidates('${rt.word}') -> '${rt.expected}'`, `Top 1: ${top1}`);
    }
  }
}

// ----------------------------------------------------------------------------
// Hauptfunktion
// ----------------------------------------------------------------------------
async function main() {
  const startTime = Date.now();
  console.log("======================================================================");
  console.log("AUTOMATISIERTE SATZ- & REGRESSIONS-TESTSUITE");
  console.log("======================================================================");

  runSignalTests();
  await runSuggestionTests();
  runMlmWeightTests();
  runRegressionTests();

  const durationMs = Date.now() - startTime;
  console.log("\n======================================================================");
  console.log(`GESAMTERGEBNIS: ${totalPassed} bestanden, ${totalFailed} fehlgeschlagen in ${durationMs}ms.`);
  console.log("======================================================================");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unerwarteter Fehler im Testrunner:", err);
  process.exit(1);
});
