// -*- coding: utf-8 -*-
/**
 * background.js - Vollständige Hintergrund-Engine (DAFSA, Komposita, MLM & IPC)
 * 100% lokal, offline, ohne externe Abhängigkeiten.
 */

// ============================================================================
// 1. DAFSA - Binäres Wörterbuch & Fuzzy Levenshtein-Traversierung
// ============================================================================

const WORD_FLAG_NOUN = 1;
const WORD_FLAG_LOWER_COMPOUND = 2;

function normalizeLookupWord(word) {
  return (word || "")
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
}

class DAFSA {
  constructor(buffer) {
    const view = new DataView(buffer);
    const alphabetLen = view.getUint16(0, true);
    const decoder = new TextDecoder("utf-8");
    this.alphabet = decoder.decode(new Uint8Array(buffer, 2, alphabetLen));

    this.charToId = new Map();
    this.idToChar = [];
    for (let i = 0; i < this.alphabet.length; i++) {
      this.charToId.set(this.alphabet[i], i);
      this.idToChar[i] = this.alphabet[i];
    }

    const offset = (2 + alphabetLen + 3) & ~3;
    const count = (buffer.byteLength - offset) / 4;
    this.transitions = new Uint32Array(buffer, offset, count);
  }

  getWordInfo(word) {
    word = normalizeLookupWord(word);
    if (!word) return { exists: false, flags: 0 };
    let nodeIdx = 0;
    const len = word.length;

    for (let i = 0; i < len; i++) {
      const charId = this.charToId.get(word[i]);
      if (charId === undefined) return { exists: false, flags: 0 };

      let edgeIdx = nodeIdx;
      let matched = false;

      while (true) {
        const val = this.transitions[edgeIdx];
        if ((val & 0x7F) === charId) {
          if (i === len - 1) {
            return { exists: ((val >> 7) & 1) === 1, flags: (val >> 9) & 0x03 };
          }
          const target = val >>> 11;
          if (target === 0) return { exists: false, flags: 0 };
          nodeIdx = target;
          matched = true;
          break;
        }
        if ((val >> 8) & 1) break;
        edgeIdx++;
      }
      if (!matched) return { exists: false, flags: 0 };
    }
    return { exists: false, flags: 0 };
  }

  contains(word) {
    return this.getWordInfo(word).exists;
  }

  hasFlag(word, flag) {
    const info = this.getWordInfo(word);
    return info.exists && (info.flags & flag) !== 0;
  }

  isValidWord(word, isFirstWord = true) {
    if (!word) return false;
    if (this.contains(word)) return true;
    const len = word.length;

    // Erstes Wort im Satz (z. B. "Das" am Satzanfang prüft auch "das")
    if (isFirstWord && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
      if (this.contains(word[0].toLowerCase() + word.slice(1))) return true;
    }

    // Komplett großgeschriebene Wörter werden nur akzeptiert, wenn ihre normale
    // Schreibweise tatsächlich im Wörterbuch steht. Akronyme behandelt die Engine.
    if (word === word.toUpperCase() && word !== word.toLowerCase()) {
      const titleCase = word[0] + word.slice(1).toLowerCase();
      if (this.contains(titleCase) || this.contains(word.toLowerCase())) return true;
    }

    return false;
  }

  findCandidates(word, maxDistance = 2, maxCandidates = 30) {
    if (!word) return [];
    const candidates = new Map();
    const wordLen = word.length;
    const initialRow = Array.from({ length: wordLen + 1 }, (_, i) => i);

    const dfs = (nodeIdx, prefix, prevRow, prevPrevRow, prevCh) => {
      let edgeIdx = nodeIdx;
      while (true) {
        const val = this.transitions[edgeIdx];
        const ch = this.idToChar[val & 0x7F];
        const isTerm = (val >> 7) & 1;
        const isLast = (val >> 8) & 1;
        const target = val >>> 11;

        const currRow = [prevRow[0] + 1];
        let minVal = currRow[0];

        for (let j = 1; j <= wordLen; j++) {
          const isMatch = word[j - 1] === ch || (j === 1 && word[j - 1].toLowerCase() === ch.toLowerCase());
          const cost = isMatch ? 0 : 1;
          let res = Math.min(currRow[j - 1] + 1, prevRow[j] + 1, prevRow[j - 1] + cost);

          if (prevPrevRow && prevCh && j >= 2) {
            const transMatch = (word[j - 1] === prevCh || (j === 2 && word[j - 1].toLowerCase() === prevCh.toLowerCase())) &&
                               (word[j - 2] === ch || (j === 1 && word[j - 2].toLowerCase() === ch.toLowerCase()));
            if (transMatch) {
              res = Math.min(res, prevPrevRow[j - 2] + 1);
            }
          }

          currRow[j] = res;
          if (res < minVal) minVal = res;
        }

        if (minVal <= maxDistance) {
          const newPrefix = prefix + ch;
          const finalDist = currRow[wordLen];
          if (isTerm === 1 && finalDist <= maxDistance) {
            const cur = candidates.get(newPrefix);
            if (cur === undefined || finalDist < cur) candidates.set(newPrefix, finalDist);
          }
          if (target !== 0) dfs(target, newPrefix, currRow, prevRow, ch);
        }

        if (isLast === 1) break;
        edgeIdx++;
      }
    };

    dfs(0, "", initialRow, null, null);

    return Array.from(candidates.entries())
      .map(([cand, dist]) => ({ word: cand, distance: dist }))
      .sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        const diffA = Math.abs(a.word.length - wordLen);
        const diffB = Math.abs(b.word.length - wordLen);
        return diffA !== diffB ? diffA - diffB : a.word.localeCompare(b.word);
      })
      .slice(0, maxCandidates);
  }
}

// ============================================================================
// 2. Komposita-Zerleger für zusammengesetzte deutsche Wörter
// ============================================================================

function isAdjectiveInDafsa(w, dafsa) {
  if (!dafsa.contains(w) || w.length < 3) return false;
  // Funktionswörter ausschließen, die ähnlich flektieren
  if (/^(?:ein|eine|einer|einem|eines|einen|der|die|das|dem|den|des)$/.test(w)) return false;
  if (w === "hoch") return true;

  const stem = w.endsWith("e") ? w.slice(0, -1) : w;
  const syncStem = (w.endsWith("el") || w.endsWith("er")) ? (w.slice(0, -2) + w.slice(-1)) : null;

  const checkAdjectiveEndings = (s) => {
    // Echte deutsche Adjektive flektieren im DAFSA mit -er (Maskulinum/Komparativ), -es (Neutrum) oder -em (Dativ)
    const hasEr = dafsa.contains(s + "er") || dafsa.contains(s + "r");
    const hasEs = dafsa.contains(s + "es") || dafsa.contains(s + "s");
    const hasEm = dafsa.contains(s + "em") || dafsa.contains(s + "m");
    const hasE  = dafsa.contains(s + "e");
    return (hasEr && (hasEs || hasEm)) || (hasEs && hasEm) || (hasE && hasEr && hasEs);
  };

  if (checkAdjectiveEndings(w)) return true;
  if (w.endsWith("e") && checkAdjectiveEndings(stem)) return true;
  if (syncStem && checkAdjectiveEndings(syncStem)) return true;

  return false;
}

function isValidLowercaseSuffix(suffix, dafsa) {
  return dafsa.hasFlag(suffix, WORD_FLAG_LOWER_COMPOUND);
}

class GermanCompoundValidator {
  constructor(dafsa) {
    this.dafsa = dafsa;
    this.fugen = ["", "s", "es", "en", "n"];
  }

  isValidCompound(word, depth = 0, maxDepth = 5) {
    if (!word || word.length < 6 || depth >= maxDepth) return false;
    const isCapitalized = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
    const len = word.length;

    for (let splitIdx = 3; splitIdx <= len - 3; splitIdx++) {
      const prefix = word.slice(0, splitIdx);
      const prefixLower = prefix.toLowerCase();
      const prefixTitle = prefix[0].toUpperCase() + prefix.slice(1).toLowerCase();
      let prefixFlags = this.dafsa.getWordInfo(prefix).flags |
                        this.dafsa.getWordInfo(prefixLower).flags |
                        this.dafsa.getWordInfo(prefixTitle).flags;
      let prefixValid = (prefixFlags & (WORD_FLAG_NOUN | WORD_FLAG_LOWER_COMPOUND)) !== 0;

      // Tilgungsfuge / e-Elision bei Nomen (z. B. Sprache -> Sprach-, Schule -> Schul-, Kirche -> Kirch-)
      if (!prefixValid && !prefixLower.endsWith("e")) {
        const nounWithE = prefixTitle + "e";
        if (this.dafsa.hasFlag(nounWithE, WORD_FLAG_NOUN)) {
          prefixValid = true;
        }
      }

      // Verbstamm als Bestimmungswort (z. B. wohnen -> Wohn-, schreiben -> Schreib-, fahren -> Fahr-)
      if (!prefixValid) {
        const verbInfinitivEn = prefixLower + "en";
        const verbInfinitivN = prefixLower + "n";
        if (this.dafsa.hasFlag(verbInfinitivEn, WORD_FLAG_LOWER_COMPOUND) ||
            this.dafsa.hasFlag(verbInfinitivN, WORD_FLAG_LOWER_COMPOUND)) {
          prefixValid = true;
        }
      }

      if (!prefixValid) continue;

      const isDerivative = (
        (prefixLower.endsWith("heit") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("keit") && prefixLower.length >= 4) ||
        prefixLower.endsWith("schaft") ||
        (prefixLower.endsWith("tät") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("ling") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("ion") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("ung") && prefixLower.length >= 4 && !prefixLower.endsWith("sprung") && !prefixLower.endsWith("schwung") && !prefixLower.endsWith("dung"))
      );

      const rem = word.slice(splitIdx);
      for (const f of this.fugen) {
        if (f && !rem.startsWith(f)) continue;
        if (isDerivative && f === "") continue;
        const suffix = f ? rem.slice(f.length) : rem;
        if (suffix.length < 3) continue;

        if (isCapitalized) {
          // Großgeschriebenes Nomen-Kompositum: Grundwort (Suffix) MUSS ein Nomen sein (in DAFSA groß!)
          const titleSuffix = suffix[0].toUpperCase() + suffix.slice(1).toLowerCase();
          if (this.dafsa.hasFlag(titleSuffix, WORD_FLAG_NOUN)) return true;
          if (this.isValidCompound(titleSuffix, depth + 1, maxDepth)) return true;
        } else {
          // Kleingeschriebenes Kompositum: Suffix darf kein Nomen sein, sondern Adjektiv oder Infinitiv
          const lowerSuffix = suffix.toLowerCase();
          if (isValidLowercaseSuffix(lowerSuffix, this.dafsa)) return true;
          if (this.isValidCompound(lowerSuffix, depth + 1, maxDepth)) return true;
        }
      }
    }
    return false;
  }
}

// ============================================================================
// 3. Lokaler BERT-MLM Kontext-Scorer (ONNX Runtime Web)
// ============================================================================

class MLMContextScorer {
  constructor(modelSource, vocab) {
    this.modelSource = modelSource;
    this.vocab = vocab;
    this.maskToken = "[MASK]";
    this.maskTokenId = vocab["[MASK]"] || 104;
    this.clsTokenId = vocab["[CLS]"] || 101;
    this.sepTokenId = vocab["[SEP]"] || 102;
    this.unkTokenId = vocab["[UNK]"] || 100;
    this.session = null;
    this.initPromise = null;
    this.contextCache = new Map();
    this.maxContextCache = 200;
  }

  async init() {
    if (this.session || typeof ort === "undefined") return this.session;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      ort.env.wasm.numThreads = Math.min(navigator?.hardwareConcurrency || 4, 4);
      ort.env.wasm.simd = true;

      let modelData = this.modelSource;
      if (Array.isArray(this.modelSource)) {
        // Chunks laden und im Speicher zusammenfügen (AMO 100 MB Einzelfile-Limit)
        const buffers = await Promise.all(this.modelSource.map(url => fetch(url).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status} beim Laden von ${url}`);
          return r.arrayBuffer();
        })));
        const totalLen = buffers.reduce((sum, b) => sum + b.byteLength, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const buf of buffers) {
          combined.set(new Uint8Array(buf), offset);
          offset += buf.byteLength;
        }
        modelData = combined.buffer;
      }

      this.session = await ort.InferenceSession.create(modelData, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all"
      });
      return this.session;
    })();
    try {
      return await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  tokenize(text) {
    if (!text) return [];
    const tokens = [];
    const basicTokens = text.match(/\[MASK\]|[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu) || [];
    for (const word of basicTokens) {
      if (word === this.maskToken) {
        tokens.push(this.maskTokenId);
        continue;
      }
      let start = 0;
      let isBad = false;
      const subTokens = [];

      while (start < word.length) {
        let end = word.length;
        let curId = null;

        while (start < end) {
          let sub = word.slice(start, end);
          if (start > 0) sub = "##" + sub;
          if (this.vocab[sub] !== undefined) {
            curId = this.vocab[sub];
            break;
          }
          end--;
        }
        if (curId === null) { isBad = true; break; }
        subTokens.push(curId);
        start = end;
      }
      if (isBad) tokens.push(this.unkTokenId);
      else tokens.push(...subTokens);
    }
    return tokens;
  }

  findOccurrence(context, word, occurrenceStart = -1, occurrenceEnd = -1) {
    if (Number.isInteger(occurrenceStart) && Number.isInteger(occurrenceEnd) &&
        occurrenceStart >= 0 && occurrenceEnd > occurrenceStart && occurrenceEnd <= context.length) {
      return { start: occurrenceStart, end: occurrenceEnd };
    }
    const index = context.toLocaleLowerCase("de-DE").indexOf(word.toLocaleLowerCase("de-DE"));
    return index >= 0 ? { start: index, end: index + word.length } : null;
  }

  buildMaskedTokens(context, occurrence, maskCount) {
    const masks = Array.from({ length: maskCount }, () => this.maskToken).join(" ");
    const masked = context.slice(0, occurrence.start) + masks + context.slice(occurrence.end);
    let body = this.tokenize(masked);
    let firstMask = body.indexOf(this.maskTokenId);
    if (firstMask < 0) return null;

    // BERT unterstützt höchstens 512 Tokens. Den Ausschnitt symmetrisch
    // um die zu bewertende Stelle legen, statt bei langen Textfeldern abzustürzen.
    const maxBodyLength = 510;
    if (body.length > maxBodyLength) {
      const before = Math.min(firstMask, Math.floor((maxBodyLength - maskCount) / 2));
      const start = Math.max(0, Math.min(firstMask - before, body.length - maxBodyLength));
      body = body.slice(start, start + maxBodyLength);
      firstMask -= start;
    }

    return {
      tokens: [this.clsTokenId, ...body, this.sepTokenId],
      maskPositions: Array.from({ length: maskCount }, (_, i) => firstMask + 1 + i)
    };
  }

  async getContextLogScores(word, context, candidateWords, occurrenceStart = -1, occurrenceEnd = -1) {
    if (!candidateWords?.length) return [];
    if (!this.session) await this.init();
    const occurrence = this.findOccurrence(context, word, occurrenceStart, occurrenceEnd);
    if (!occurrence) return candidateWords.map(candidate => ({ word: candidate, logScore: -Infinity }));
    const cacheKey = `${context}\u0000${occurrence.start}:${occurrence.end}\u0000${candidateWords.join("\u0001")}`;
    const cached = this.contextCache.get(cacheKey);
    if (cached) return cached.map(item => ({ ...item }));

    const prepared = candidateWords.map(candidate => ({
      word: candidate,
      tokenIds: this.tokenize(candidate)
    })).filter(candidate => candidate.tokenIds.length > 0);
    const groups = new Map();
    for (const candidate of prepared) {
      const count = candidate.tokenIds.length;
      if (!groups.has(count)) groups.set(count, []);
      groups.get(count).push(candidate);
    }

    const scores = new Map();
    const vocabSize = 31102;
    for (const [maskCount, group] of groups) {
      const input = this.buildMaskedTokens(context, occurrence, maskCount);
      if (!input) continue;
      const seqLen = input.tokens.length;
      const inputIds = new ort.Tensor("int64", BigInt64Array.from(input.tokens.map(BigInt)), [1, seqLen]);
      const attentionMask = new ort.Tensor("int64", new BigInt64Array(seqLen).fill(1n), [1, seqLen]);
      const out = await this.session.run({ input_ids: inputIds, attention_mask: attentionMask });
      const logits = out.logits.data;

      const logNormalizers = input.maskPositions.map(maskPos => {
        const offset = maskPos * vocabSize;
        let maxLogit = -Infinity;
        for (let i = 0; i < vocabSize; i++) maxLogit = Math.max(maxLogit, logits[offset + i]);
        let sumExp = 0;
        for (let i = 0; i < vocabSize; i++) sumExp += Math.exp(logits[offset + i] - maxLogit);
        return maxLogit + Math.log(sumExp);
      });

      for (const candidate of group) {
        let logScore = 0;
        for (let i = 0; i < maskCount; i++) {
          logScore += logits[input.maskPositions[i] * vocabSize + candidate.tokenIds[i]] - logNormalizers[i];
        }
        scores.set(candidate.word, logScore / maskCount);
      }
    }

    const result = candidateWords.map(candidate => ({ word: candidate, logScore: scores.get(candidate) ?? -Infinity }));
    if (this.contextCache.size >= this.maxContextCache) {
      this.contextCache.delete(this.contextCache.keys().next().value);
    }
    this.contextCache.set(cacheKey, result);
    return result.map(item => ({ ...item }));
  }

  async scoreCandidates(word, context, candidates, occurrenceStart = -1, occurrenceEnd = -1) {
    if (!candidates?.length) return [];
    const contextScores = await this.getContextLogScores(
      word, context, candidates.map(candidate => candidate.word), occurrenceStart, occurrenceEnd
    );
    const finiteScores = contextScores.map(item => item.logScore).filter(Number.isFinite);
    const maxScore = finiteScores.length ? Math.max(...finiteScores) : 0;
    const weights = contextScores.map(item => Number.isFinite(item.logScore) ? Math.exp(item.logScore - maxScore) : 0);
    const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;

    return candidates.map((c, index) => {
      const lmProb = weights[index] / weightSum;
      const userBonus = c.fromUserDict ? 0.35 : 0.0;
      const score = 0.30 * lmProb + 0.70 * c.editScore + userBonus;
      return { word: c.word, score, confidence: Math.round(Math.min(0.99, score) * 100) };
    }).sort((a, b) => b.score - a.score);
  }
}

// ============================================================================
// 4. Haupt-Spellchecking-Engine & Mathematische Ranking-Modelle
// ============================================================================

// Methode B: QWERTZ-Tastaturgeometrie (Distanzmatrix für Tippfehler)
const QWERTZ_COORDS = {
  '1': [1.0, 1.0], '2': [2.0, 1.0], '3': [3.0, 1.0], '4': [4.0, 1.0], '5': [5.0, 1.0],
  '6': [6.0, 1.0], '7': [7.0, 1.0], '8': [8.0, 1.0], '9': [9.0, 1.0], '0': [10.0, 1.0],
  'ß': [11.0, 1.0],
  'q': [1.5, 2.0], 'w': [2.5, 2.0], 'e': [3.5, 2.0], 'r': [4.5, 2.0], 't': [5.5, 2.0],
  'z': [6.5, 2.0], 'u': [7.5, 2.0], 'i': [8.5, 2.0], 'o': [9.5, 2.0], 'p': [10.5, 2.0],
  'ü': [11.5, 2.0],
  'a': [1.75, 3.0], 's': [2.75, 3.0], 'd': [3.75, 3.0], 'f': [4.75, 3.0], 'g': [5.75, 3.0],
  'h': [6.75, 3.0], 'j': [7.75, 3.0], 'k': [8.75, 3.0], 'l': [9.75, 3.0], 'ö': [10.75, 3.0],
  'ä': [11.75, 3.0],
  'y': [2.25, 4.0], 'x': [3.25, 4.0], 'c': [4.25, 4.0], 'v': [5.25, 4.0], 'b': [6.25, 4.0],
  'n': [7.25, 4.0], 'm': [8.25, 4.0]
};

function keyboardDistance(ch1, ch2) {
  if (ch1 === ch2) return 0;
  const c1 = QWERTZ_COORDS[ch1.toLowerCase()];
  const c2 = QWERTZ_COORDS[ch2.toLowerCase()];
  if (!c1 || !c2) return 1.0;
  const dx = c1[0] - c2[0];
  const dy = c1[1] - c2[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 1.15) return 0.35; // Direkter Nachbar (z.B. v <-> b, f <-> g, w <-> e, o <-> p)
  if (dist <= 1.55) return 0.65; // Diagonale Taste (z.B. g <-> z)
  return 1.0;
}

// Häufige deutsche Schreibfehler bestehen oft aus mehreren Zeichen, sind aber
// linguistisch eine einzige Verwechslung (z. B. f <-> ph oder i <-> ie).
// Diese Kosten werden sowohl beim Ranking als auch bei der gezielten
// Kandidatenerzeugung verwendet.
const GERMAN_REWRITE_RULES = [
  ["ph", "f", 0.48], ["f", "ph", 0.48],
  ["v", "f", 0.10], ["f", "v", 0.10],
  ["ie", "i", 0.26], ["i", "ie", 0.26],
  ["äu", "eu", 0.24], ["eu", "äu", 0.24],
  ["ss", "ß", 0.35], ["ß", "ss", 0.35],
  ["th", "t", 0.55], ["t", "th", 0.55],
  ["ck", "k", 0.52], ["k", "ck", 0.45],
  ["tz", "z", 0.52], ["z", "tz", 0.48],
  ["ä", "e", 0.52], ["e", "ä", 0.52],
  ["ö", "e", 0.58], ["e", "ö", 0.58],
  ["ü", "i", 0.58], ["i", "ü", 0.58]
];
const GERMAN_REWRITE_RULES_BY_INITIAL = new Map();
for (const rule of GERMAN_REWRITE_RULES) {
  const key = `${rule[0][0]}\u0000${rule[1][0]}`;
  if (!GERMAN_REWRITE_RULES_BY_INITIAL.has(key)) GERMAN_REWRITE_RULES_BY_INITIAL.set(key, []);
  GERMAN_REWRITE_RULES_BY_INITIAL.get(key).push(rule);
}

const FUGEN_S_REQUIRED_STEMS = new Set([
  "amt", "ausgang", "beruf", "betrieb", "bischof", "durchschlag", "geburt",
  "gesicht", "liebling", "sehen", "vergleich", "widerstand"
]);

function stronglyPrefersFugenS(prefix, suffixLength) {
  if (prefix.length < 3 || suffixLength < 3) return false;
  if (FUGEN_S_REQUIRED_STEMS.has(prefix)) return true;
  if (prefix.endsWith("sprung") || prefix.endsWith("schwung") || prefix.endsWith("dung")) return false;
  return /(?:heit|keit|schaft|tät|ling|ion|ung)$/u.test(prefix);
}

function areSimpleInflectionVariants(a, b) {
  if (a === b) return true;
  for (const ending of ["e", "en", "er", "n", "s", "es"]) {
    if (a + ending === b || b + ending === a) return true;
  }
  return false;
}

function calcWeightedDamerauLevenshtein(s1, s2) {
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 999;

  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  dp[0][0] = 0;

  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      const base = dp[i][j];
      if (!Number.isFinite(base)) continue;

      if (i < m) {
        const isBounce = (i > 0 && a[i] === a[i - 1]) || (i + 1 < m && a[i] === a[i + 1]);
        const isSilentH = a[i] === "h" && i > 0 && i + 1 < m && /[aeiouäöü]/u.test(a[i - 1]);
        const deletionCost = isBounce ? 0.35 : (isSilentH ? 0.65 : 1.0);
        dp[i + 1][j] = Math.min(dp[i + 1][j], base + deletionCost);
      }
      if (j < n) {
        const isMissingDouble = (j > 0 && b[j] === b[j - 1]) || (j + 1 < n && b[j] === b[j + 1]);
        const isMissingFugenS = b[j] === "s" && stronglyPrefersFugenS(b.slice(0, j), n - j - 1);
        const isMissingSilentH = b[j] === "h" && j > 0 && j + 1 < n && /[aeiouäöü]/u.test(b[j - 1]);
        const isMissingSchwa = b[j] === "e" && ((j + 1 === n && b.endsWith("en")) || (j + 2 === n && (b.endsWith("eln") || b.endsWith("ern"))) || (j > 0 && j + 1 < n && b[j - 1] === "h" && b[j + 1] === "n"));
        const insertionCost = isMissingDouble ? 0.35 : (isMissingFugenS ? 0.45 : (isMissingSilentH ? 0.28 : (isMissingSchwa ? 0.30 : 1.0)));
        dp[i][j + 1] = Math.min(dp[i][j + 1], base + insertionCost);
      }
      if (i < m && j < n) {
        const sharedEnding = a.slice(i + 1) === b.slice(j + 1) ? a.slice(i + 1) : null;
        const finalVoicingPair = sharedEnding !== null && /^(?:|s|e|en|er|es)$/u.test(sharedEnding) &&
          /^(?:bp|pb|dt|td|gk|kg)$/u.test(a[i] + b[j]);
        const substitutionCost = a[i] === b[j]
          ? 0
          : (finalVoicingPair ? 0.20 : keyboardDistance(a[i], b[j]));
        dp[i + 1][j + 1] = Math.min(dp[i + 1][j + 1], base + substitutionCost);
      }
      if (i + 1 < m && j + 1 < n && a[i] === b[j + 1] && a[i + 1] === b[j]) {
        dp[i + 2][j + 2] = Math.min(dp[i + 2][j + 2], base + 0.45);
      }

      if (i < m && j < n) {
        const rewriteRules = GERMAN_REWRITE_RULES_BY_INITIAL.get(`${a[i]}\u0000${b[j]}`);
        if (rewriteRules) {
          for (const [typed, correct, cost] of rewriteRules) {
            if (a.startsWith(typed, i) && b.startsWith(correct, j)) {
              dp[i + typed.length][j + correct.length] = Math.min(
                dp[i + typed.length][j + correct.length],
                base + cost
              );
            }
          }
        }
      }
    }
  }
  return dp[m][n];
}

function generateGermanRewriteForms(word, maxDepth = 2, maxForms = 96) {
  const start = word.toLowerCase();
  const best = new Map([[start, 0]]);
  const queue = [{ word: start, cost: 0, depth: 0 }];

  for (let q = 0; q < queue.length && best.size <= maxForms; q++) {
    const current = queue[q];
    if (current.depth >= maxDepth) continue;

    for (const [typed, correct, ruleCost] of GERMAN_REWRITE_RULES) {
      let at = current.word.indexOf(typed);
      while (at >= 0) {
        const transformed = current.word.slice(0, at) + correct + current.word.slice(at + typed.length);
        const nextCost = current.cost + ruleCost;
        const oldCost = best.get(transformed);
        if ((oldCost === undefined || nextCost < oldCost) && best.size < maxForms) {
          best.set(transformed, nextCost);
          queue.push({ word: transformed, cost: nextCost, depth: current.depth + 1 });
        }
        at = current.word.indexOf(typed, at + 1);
      }
    }
  }

  best.delete(start);
  return Array.from(best, ([form, cost]) => ({ form, cost }));
}

// Methode C: Kölner Phonetik (speziell für deutsche Sprache & Lautverschiebung)
function koelnerPhonetik(word) {
  if (!word) return "";
  const s = word.toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "s");
  const len = s.length;
  const code = [];

  for (let i = 0; i < len; i++) {
    const ch = s[i];
    const next = i + 1 < len ? s[i + 1] : "";
    const prev = i > 0 ? s[i - 1] : "";

    switch (ch) {
      case 'a': case 'e': case 'i': case 'j': case 'o': case 'u': case 'y':
        code.push(0); break;
      case 'b':
        code.push(1); break;
      case 'p':
        code.push(next === 'h' ? 3 : 1); break;
      case 'd': case 't':
        if (['c', 's', 'z'].includes(next)) code.push(8);
        else code.push(2);
        break;
      case 'f': case 'v': case 'w':
        code.push(3); break;
      case 'g': case 'k': case 'q':
        code.push(4); break;
      case 'c':
        if (i === 0) {
          code.push(['a', 'h', 'k', 'l', 'o', 'q', 'r', 'u', 'x'].includes(next) ? 4 : 8);
        } else {
          code.push(['s', 'z'].includes(prev) ? 8 : (['a', 'h', 'k', 'o', 'q', 'u', 'x'].includes(next) ? 4 : 8));
        }
        break;
      case 'x':
        code.push(4); code.push(8); break;
      case 'l':
        code.push(5); break;
      case 'm': case 'n':
        code.push(6); break;
      case 'r':
        code.push(7); break;
      case 's': case 'z':
        code.push(8); break;
    }
  }

  const res = [];
  for (let i = 0; i < code.length; i++) {
    if (i === 0 || code[i] !== code[i - 1]) {
      if (code[i] !== 0 || i === 0) res.push(code[i]);
    }
  }
  return res.join("");
}

function calcDamerauLevenshtein(a, b) {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 2) return 999;

  const dp = [];
  for (let i = 0; i <= al; i++) dp[i] = [i];
  for (let j = 1; j <= bl; j++) dp[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,       // Deletion
        dp[i][j - 1] + 1,       // Insertion
        dp[i - 1][j - 1] + cost // Substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1); // Transposition
      }
      dp[i][j] = val;
    }
  }
  return dp[al][bl];
}

const COMMON_ABBREVIATIONS = new Set([
  "gmbh", "bzw", "usw", "etc", "evtl", "ca", "ggf", "bzgl", "inkl", "exkl",
  "str", "nr", "dr", "prof", "mrd", "mio", "std", "min", "sek", "abb",
  "tab", "abs", "art", "vgl", "ff", "vs", "co", "kg", "ag", "eu", "usa",
  "nato", "uno", "ki", "it", "tv", "pc", "pdf", "usb", "cpu", "gpu", "html",
  "css", "http", "https", "url", "api", "json", "xml", "sql", "dns", "vpn",
  "wlan", "lan", "ram", "ssd", "covid", "sars", "aids", "app", "apps"
]);

const GERMAN_FUNCTION_WORDS = new Set([
  "ich", "du", "er", "sie", "es", "wir", "ihr", "mich", "dich", "sich", "uns", "euch",
  "mir", "dir", "ihm", "ihnen", "mein", "dein", "sein", "unser", "euer",
  "der", "die", "das", "ein", "eine", "einer", "einem", "einen", "eines",
  "in", "im", "an", "am", "zu", "zum", "zur", "mit", "von", "vom", "bei", "beim", "nach",
  "aus", "auf", "ab", "um", "durch", "für", "vor", "über", "unter", "zwischen",
  "und", "oder", "aber", "denn", "weil", "dass", "da", "wenn", "als", "wie",
  "so", "ja", "nein", "nicht", "nur", "noch", "auch", "doch", "mal", "schon", "sehr"
]);
const WORD_FREQUENCY_PRIOR_WEIGHT = 0.24;

// Signalisierende Signalwörter (Präpositionen, Artikel, Pronomen),
// die ein nachfolgendes Nomen einleiten.
const GERMAN_NOUN_SIGNAL_WORDS = new Set([
  "aus", "bei", "beim", "mit", "nach", "von", "vom", "zu", "zum", "zur",
  "ab", "an", "am", "ans", "auf", "aufs", "außer", "dank", "durch", "durchs",
  "für", "fürs", "gegen", "hinter", "hinters", "in", "im", "ins", "neben",
  "ohne", "seit", "über", "übers", "unter", "unters", "vor", "vors", "vorm",
  "während", "wegen", "wider", "zwischen",
  "der", "die", "das", "des", "dem", "den",
  "ein", "eine", "eines", "einer", "einem", "einen",
  "kein", "keine", "keines", "keiner", "keinem", "keinen",
  "etwas", "nichts", "alles", "allerlei", "mancherlei",
  "mein", "meine", "meines", "meiner", "meinem", "meinen",
  "dein", "deine", "deines", "deiner", "deinem", "deinen",
  "sein", "seine", "seines", "seiner", "seinem", "seinen",
  "ihr", "ihre", "ihres", "ihrer", "ihrem", "ihren",
  "unser", "unsere", "unseres", "unserer", "unserem", "unseren",
  "euer", "eure", "eures", "eurer", "eurem", "euren"
]);

const GERMAN_DETERMINERS = new Set([
  "der", "die", "das", "des", "dem", "den",
  "ein", "eine", "eines", "einer", "einem", "einen",
  "kein", "keine", "keines", "keiner", "keinem", "keinen",
  "mein", "meine", "meines", "meiner", "meinem", "meinen",
  "dein", "deine", "deines", "deiner", "deinem", "deinen",
  "sein", "seine", "seines", "seiner", "seinem", "seinen",
  "ihr", "ihre", "ihres", "ihrer", "ihrem", "ihren",
  "unser", "unsere", "unseres", "unserer", "unserem", "unseren",
  "euer", "eure", "eures", "eurer", "eurem", "euren",
  "jeder", "jede", "jedes", "jedem", "jeden",
  "mancher", "manche", "manches", "manchem", "manchen",
  "solcher", "solche", "solches", "solchem", "solchen",
  "welcher", "welche", "welches", "welchem", "welchen",
  "beim", "zum", "zur", "vom", "im", "am", "ins", "ans", "aufs", "fürs", "durchs", "hinters", "unters", "übers", "vors"
]);

const GERMAN_NON_ADJECTIVE_WORDS = new Set([
  "immer", "nimmer", "wieder", "heute", "gestern", "morgen", "gerne", "gern",
  "zusammen", "miteinander", "bisher", "vorher", "nachher", "eher", "lieber",
  "öfter", "oft", "sofort", "bereits", "ebenfalls", "eben", "bald", "nie", "schon",
  "vorne", "hinten", "oben", "unten", "innen", "außen", "drinnen", "draußen",
  "gelesen", "gesehen", "geschrieben", "gesagt", "gemacht", "getan", "geworden", "geblieben"
]);

function isParticipleOrAdverb(word) {
  if (GERMAN_NON_ADJECTIVE_WORDS.has(word)) return true;
  if (word.startsWith("ge") && (word.endsWith("en") || word.endsWith("t") || word.endsWith("et"))) {
    if (!/(?:enes|enem|ener|ene|enen|etes|etem|eter|ete|eten)$/.test(word)) {
      return true;
    }
  }
  return false;
}

function detectNounSignal(context, start) {
  if (!context || typeof context !== "string") return false;
  let s = start;
  if (s == null || s < 0) return false;
  const before = context.slice(0, s).trimEnd();
  const words = before.split(/\s+/);
  if (!words.length || !words[0]) return false;
  const rawLast = words[words.length - 1];
  const lastWord = rawLast.toLowerCase().replace(/[^\p{L}]/gu, '');

  const following = context.slice(s).trimStart();
  const targetWord = following.split(/[\s.,;:!?]/)[0].toLowerCase().replace(/[^\p{L}]/gu, '');

  // 1. Infinitiv mit 'zu' (§ 57 RdR 2024): Verb bleibt klein (z. B. "um zu gehen", "ohne zu wissen")
  if (lastWord === "zu") {
    if (words.length >= 2) {
      const prev = words[words.length - 2].toLowerCase().replace(/[^\p{L}]/gu, '');
      if (/^(?:um|ohne|statt|anstatt|nicht|kaum|schwer|leicht|ist|hat|war|wird|pflegt|scheint|braucht)$/.test(prev)) {
        return false;
      }
    }
    const fixedZuNouns = new Set(["fuss", "fuß", "hause", "besuch", "beginn", "ende", "tisch", "bett", "gast", "recht", "unrecht", "wort", "tage", "papier", "rate"]);
    if (targetWord && !fixedZuNouns.has(targetWord)) {
      return false;
    }
  }

  // 2. Superlativ mit 'am' (§ 58 (2) RdR 2024): Bleibt Adjektiv klein (z. B. "am besten", "am schnellsten")
  if (lastWord === "am" && targetWord && /(?:sten|stn|ten|tn)$/.test(targetWord)) {
    const dativNouns = new Set(["abend", "anfang", "ende", "rand", "tisch", "tag", "himmel", "eingang", "ausgang", "monatsanfang", "monatsende", "ersten"]);
    if (!dativNouns.has(targetWord)) {
      return false;
    }
  }

  if (GERMAN_NOUN_SIGNAL_WORDS.has(lastWord)) return true;
  if (words.length >= 2) {
    const rawPrev = words[words.length - 2];
    const prevWord = rawPrev.toLowerCase().replace(/[^\p{L}]/gu, '');
    const isLastLower = rawLast.length > 0 && rawLast[0] === rawLast[0].toLowerCase();
    if (isLastLower && !isParticipleOrAdverb(lastWord)) {
      if (GERMAN_DETERMINERS.has(prevWord) && /(?:em|en|er|es|e)$/.test(lastWord)) {
        return true;
      }
      if (GERMAN_NOUN_SIGNAL_WORDS.has(prevWord)) {
        if (/(?:em|er|es)$/.test(lastWord)) {
          return true;
        }
        if (lastWord.endsWith("en")) {
          if (targetWord && !/(?:en|eln|ern)$/.test(targetWord)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function isViableCompoundHead(suffix, dafsa, compounds, wordFrequencies, titlecaseCorpusWords, lowercaseCorpusWords) {
  if (!suffix || suffix.length < 3) return false;
  const sLower = suffix.toLowerCase();
  const sTitle = suffix[0].toUpperCase() + suffix.slice(1).toLowerCase();

  // 1. Im Häufigkeitskorpus belegt (Gattungsbegriffe/Alltagswörter)
  if (wordFrequencies && (wordFrequencies[sLower] || 0) >= 1) return true;
  if (titlecaseCorpusWords && titlecaseCorpusWords.has(sLower)) return true;
  if (lowercaseCorpusWords && lowercaseCorpusWords.has(sLower)) return true;

  // 2. Produktive deutsche Substantiv-Derivationssuffixe (Appellativa, niemals reine Ortsnamen)
  if (/(?:ung|heit|keit|schaft|tum|ion|tät|ismus|ling|nis|ment|ur|ik|or|eur|ist|ant|enz|anz)$/i.test(sLower)) {
    return true;
  }
  if (sLower.length >= 4 && sLower.endsWith("er") && dafsa.hasFlag(sTitle, WORD_FLAG_NOUN)) {
    return true;
  }

  // 3. Selbst ein morphologisch valides deutsches Kompositum
  if (compounds && (compounds.isValidCompound(sTitle) || compounds.isValidCompound(sLower))) {
    return true;
  }

  return false;
}

class SpellCheckEngine {
  constructor(
    dafsa,
    compoundValidator,
    mlmScorer = null,
    userDictionary = new Set(),
    ignoredWords = new Set(),
    vocab = null,
    wordFrequencyData = null,
    commonTypoData = null
  ) {
    this.dafsa = dafsa;
    this.compoundValidator = compoundValidator;
    this.mlmScorer = mlmScorer;
    this.userDictionary = userDictionary;
    this.ignoredWords = ignoredWords;
    this.vocab = vocab;
    this.wordFrequencies = wordFrequencyData?.words || null;
    this.wordFrequencyTotal = wordFrequencyData?.totalCount || 0;
    this.wordFrequencyTypes = wordFrequencyData?.words ? Object.keys(wordFrequencyData.words).length : 0;
    this.lowercaseCorpusWords = new Set(wordFrequencyData?.lowercaseWords || []);
    this.titlecaseCorpusWords = new Set(wordFrequencyData?.titlecaseWords || []);
    this.commonTypos = commonTypoData?.corrections || Object.create(null);
    this.cache = new Map();
    this.compoundCorrectionCache = new Map();
    this.MAX_CACHE = 3000;
  }

  isIgnored(token) {
    if (!token || token.length <= 1) return true;
    if (/^[\d.,%€$+\-]+$/.test(token)) return true;
    if (/^(https?:\/\/|www\.)/i.test(token)) return true;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)) return true;
    if (/[\\\/_#@<>{}\d]/.test(token)) return true;
    if (COMMON_ABBREVIATIONS.has(token.toLowerCase())) return true;
    return false;
  }

  matchesCustomException(word, dictSet) {
    if (!dictSet || dictSet.size === 0) return false;
    if (dictSet.has(word)) return true;
    const lower = word.toLowerCase();
    for (const entry of dictSet) {
      if (entry.toLowerCase() === lower) return true;
    }
    return false;
  }

  isCorrect(word, isFirstWord = false, checkCase = true) {
    word = normalizeLookupWord(word);
    if (this.isIgnored(word)) return true;
    if (this.matchesCustomException(word, this.ignoredWords)) return true;
    if (this.matchesCustomException(word, this.userDictionary)) return true;

    const key = `${word}:${isFirstWord ? 1 : 0}:${checkCase ? 1 : 0}`;
    if (this.cache.has(key)) return this.cache.get(key);

    if (word.endsWith("-") && word.length >= 2) {
      const base = word.slice(0, -1);
      const endsWithHyphenValid = this.dafsa.isValidWord(base, isFirstWord) ||
                                  this.dafsa.contains(base.toLowerCase()) ||
                                  Boolean(this.compoundValidator?.isValidCompound(base));
      if (this.cache.size >= this.MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, endsWithHyphenValid);
      return endsWithHyphenValid;
    }

    const directValid = this.dafsa.isValidWord(word, isFirstWord);
    const apostropheValid = this.isValidApostropheWord(word, isFirstWord);
    const hyphenValid = this.isValidHyphenatedWord(word, isFirstWord, checkCase);
    const compoundValid = Boolean(this.compoundValidator?.isValidCompound(word)) ||
      (isFirstWord && Boolean(this.compoundValidator?.isValidCompound(word[0].toLowerCase() + word.slice(1))));
    const suspiciousCompound = compoundValid && !directValid && !apostropheValid && !hyphenValid &&
      this.hasLikelyCorpusCorrection(word);
    const knownCorrection = this.commonTypos[word.toLocaleLowerCase("de-DE")];
    const knownNonwordTypo = Boolean(knownCorrection) && !directValid;

    let valid = !knownNonwordTypo &&
      (directValid || apostropheValid || hyphenValid || (compoundValid && !suspiciousCompound));

    if (!valid && !checkCase) {
      const restIsLower = word.length <= 1 || word.slice(1) === word.slice(1).toLowerCase();
      if (restIsLower) {
        const altFirst = word[0] === word[0].toUpperCase()
          ? word[0].toLowerCase() + word.slice(1)
          : word[0].toUpperCase() + word.slice(1);
        valid = this.dafsa.isValidWord(altFirst, isFirstWord) ||
                this.dafsa.contains(altFirst) ||
                Boolean(this.compoundValidator?.isValidCompound(altFirst));
      }
    }

    if (this.cache.size >= this.MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, valid);
    return valid;
  }

  hasLikelyCorpusCorrection(word) {
    if (!this.wordFrequencies || word.length < 6 || word.length > 48) return false;
    const lower = word.toLocaleLowerCase("de-DE");
    // Im Gegenwartskorpus belegte Gesamtwörter sind stärker als eine zufällige
    // alternative Zerlegung und werden nicht durch diesen Wächter angegriffen.
    if ((this.wordFrequencies[lower] || 0) >= 3) return false;
    if (/^\p{Lu}/u.test(word) && this.titlecaseCorpusWords.has(lower)) return false;
    if (this.compoundCorrectionCache.has(lower)) return this.compoundCorrectionCache.get(lower);

    // Zusammengeklebte Funktionswörter sind keine produktiven Komposita. Das
    // betrifft besonders Kontextverwechslungen wie "seidlangem".
    for (const prefix of ["seid", "das", "dass", "den", "denn", "wen", "wenn"]) {
      if (!lower.startsWith(prefix) || lower.length - prefix.length < 3) continue;
      const suffix = lower.slice(prefix.length);
      if (this.dafsa.contains(suffix) || this.compoundValidator?.isValidCompound(suffix)) {
        this.compoundCorrectionCache.set(lower, true);
        return true;
      }
    }

    const seen = new Set();
    const minimumCandidateCount = 2;
    const consider = (candidateLower, allowWithoutCorpusEvidence = false) => {
      if (!candidateLower || candidateLower === lower || seen.has(candidateLower)) return false;
      if (areSimpleInflectionVariants(lower, candidateLower)) return false;
      seen.add(candidateLower);
      const candidateCount = this.wordFrequencies[candidateLower] || 0;
      if (!allowWithoutCorpusEvidence && candidateCount < minimumCandidateCount) return false;

      const title = candidateLower[0].toUpperCase() + candidateLower.slice(1);
      let dictionaryCandidate = this.dafsa.contains(candidateLower)
        ? candidateLower
        : (this.dafsa.contains(title) ? title : null);
      // Ein im Korpus belegtes, morphologisch gültiges Gesamtkompositum ist
      // ebenfalls ein belastbarer Korrekturkandidat, auch wenn es nicht als
      // fertiger DAFSA-Eintrag vorliegt.
      if (!dictionaryCandidate && !allowWithoutCorpusEvidence &&
          (this.compoundValidator?.isValidCompound(title) || this.compoundValidator?.isValidCompound(candidateLower))) {
        dictionaryCandidate = title;
      }
      if (!dictionaryCandidate) return false;
      const maxDistance = allowWithoutCorpusEvidence
        ? 1.05
        : (candidateCount >= 30 ? 1.20 : 1.05);
      return calcWeightedDamerauLevenshtein(lower, dictionaryCandidate.toLocaleLowerCase("de-DE")) <= maxDistance;
    };

    for (const { form, cost } of generateGermanRewriteForms(lower)) {
      const structuralRewrite = cost <= 0.55 && form.length !== lower.length;
      if (consider(form, structuralRewrite)) {
        this.compoundCorrectionCache.set(lower, true);
        return true;
      }
    }

    const alphabet = "abcdefghijklmnopqrstuvwxyzäöüß";
    for (let i = 0; i < lower.length; i++) {
      if (consider(lower.slice(0, i) + lower.slice(i + 1), true)) {
        this.compoundCorrectionCache.set(lower, true);
        return true;
      }
      if (i + 1 < lower.length && lower[i] !== lower[i + 1] &&
          consider(lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2), true)) {
        this.compoundCorrectionCache.set(lower, true);
        return true;
      }
    }
    for (let i = 0; i <= lower.length; i++) {
      for (const ch of alphabet) {
        if (consider(lower.slice(0, i) + ch + lower.slice(i), true)) {
          this.compoundCorrectionCache.set(lower, true);
          return true;
        }
        if (i < lower.length && ch !== lower[i] &&
            consider(lower.slice(0, i) + ch + lower.slice(i + 1), true)) {
          this.compoundCorrectionCache.set(lower, true);
          return true;
        }
      }
    }

    this.compoundCorrectionCache.set(lower, false);
    if (this.compoundCorrectionCache.size > 1500) {
      this.compoundCorrectionCache.delete(this.compoundCorrectionCache.keys().next().value);
    }
    return false;
  }

  isValidApostropheWord(word, isFirstWord = false) {
    const match = word.match(/^(.{2,})'(?:s|n)$/i);
    if (!match) return false;
    const base = match[1];
    return this.dafsa.isValidWord(base, isFirstWord) ||
           Boolean(this.compoundValidator?.isValidCompound(base));
  }

  isValidHyphenatedWord(word, isFirstWord = false, checkCase = true) {
    if (!word.includes("-")) return false;
    const parts = word.split("-");
    if (parts.length < 2 || parts.some(part => part.length < 1)) return false;

    return parts.every((part, index) => {
      if (/^\d+(?:[A-Za-z]+)?$/u.test(part)) return true;
      if (this.isIgnored(part) || COMMON_ABBREVIATIONS.has(part.toLowerCase())) return true;
      const atStart = index === 0 && isFirstWord;
      if (this.dafsa.isValidWord(part, atStart) || this.compoundValidator?.isValidCompound(part)) return true;
      if (index === 0 && word[0] === word[0].toUpperCase()) {
        const lowerPart = part.toLowerCase();
        const flags = this.dafsa.getWordInfo(lowerPart).flags;
        if ((flags & (WORD_FLAG_NOUN | WORD_FLAG_LOWER_COMPOUND)) !== 0) return true;
      }
      if (checkCase) return false;
      const restIsLower = part.length <= 1 || part.slice(1) === part.slice(1).toLowerCase();
      if (!restIsLower) return false;
      const altFirst = part[0] === part[0].toUpperCase()
        ? part[0].toLowerCase() + part.slice(1)
        : part[0].toUpperCase() + part.slice(1);
      return this.dafsa.isValidWord(altFirst, atStart) ||
             this.dafsa.contains(altFirst) ||
             Boolean(this.compoundValidator?.isValidCompound(altFirst));
    });
  }

  mustBeCapitalized(cand) {
    if (!cand || cand.length === 0) return false;
    const lower = cand.toLowerCase();
    if (GERMAN_FUNCTION_WORDS.has(lower)) return false;
    const title = cand[0].toUpperCase() + cand.slice(1).toLowerCase();
    const titleInfo = this.dafsa.getWordInfo(title);
    const lowerInfo = this.dafsa.getWordInfo(lower);
    // Echte kleingeschriebene Korpusbelege lösen Mehrdeutigkeiten wie
    // vier/Vier oder morgen/Morgen zugunsten der Eingabeschreibung auf.
    if (lowerInfo.exists && this.lowercaseCorpusWords.has(lower)) return false;
    if (titleInfo.exists && (titleInfo.flags & WORD_FLAG_NOUN) !== 0) {
      if (!lowerInfo.exists || (lowerInfo.flags & WORD_FLAG_LOWER_COMPOUND) === 0) {
        return true;
      }
    }
    if (titleInfo.exists && !this.dafsa.contains(lower)) {
      return true;
    }
    if (this.compoundValidator?.isValidCompound(title) && !this.compoundValidator?.isValidCompound(lower)) {
      return true;
    }
    return false;
  }

  synthesizeCompoundCandidates(word, maxResults = 5) {
    word = normalizeLookupWord(word);
    if (!word || word.length < 12 || !this.compoundValidator) return [];
    const len = word.length;
    const isCapitalized = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
    const fugen = ["", "s", "es", "en", "n"];
    const candidatesMap = new Map();
    const wordLower = word.toLowerCase();
    const frequencyRef = this.wordFrequencies;

    const isValidPrefix = (p, pLower, pTitle) => {
      const info = this.dafsa.getWordInfo(pTitle);
      const flags = info.flags | this.dafsa.getWordInfo(pLower).flags;
      if ((flags & WORD_FLAG_NOUN) !== 0 || (flags & WORD_FLAG_LOWER_COMPOUND) !== 0) return true;
      if (p.length >= 6) {
        return Boolean(this.compoundValidator.isValidCompound(pTitle) || this.compoundValidator.isValidCompound(pLower));
      }
      return false;
    };

    // 1. Richtung: Fehler im Grundwort/Suffix (z. B. Betriebskostenabrechnungszeitrraum)
    for (let splitIdx = 4; splitIdx <= len - 4; splitIdx++) {
      const prefix = word.slice(0, splitIdx);
      const prefixLower = prefix.toLowerCase();
      const prefixTitle = prefix[0].toUpperCase() + prefix.slice(1).toLowerCase();

      if (!isValidPrefix(prefix, prefixLower, prefixTitle)) continue;

      const isDerivative = (
        (prefixLower.endsWith("heit") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("keit") && prefixLower.length >= 4) ||
        prefixLower.endsWith("schaft") ||
        (prefixLower.endsWith("tät") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("ling") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("ion") && prefixLower.length >= 4) ||
        (prefixLower.endsWith("ung") && prefixLower.length >= 4 && !prefixLower.endsWith("sprung") && !prefixLower.endsWith("schwung") && !prefixLower.endsWith("dung"))
      );

      const rem = word.slice(splitIdx);
      for (const f of fugen) {
        if (f && !rem.startsWith(f)) continue;
        if ((f === "s" || f === "es") && /(?:s|ß|z|x)$/i.test(prefixLower)) continue;
        if (isDerivative && f === "") continue;
        const suffix = f ? rem.slice(f.length) : rem;
        if (suffix.length < 4 || suffix.length > 20) continue;

        const titleSuffix = suffix[0].toUpperCase() + suffix.slice(1).toLowerCase();
        const candSuffixes = this.dafsa.findCandidates(titleSuffix, 2, 8);

        for (const cs of candSuffixes) {
          if (!this.dafsa.hasFlag(cs.word, WORD_FLAG_NOUN)) continue;
          if (!isViableCompoundHead(cs.word, this.dafsa, this.compoundValidator, frequencyRef, this.titlecaseCorpusWords, this.lowercaseCorpusWords)) continue;

          const cleanPrefix = isCapitalized
            ? (prefix[0].toUpperCase() + prefix.slice(1).toLowerCase())
            : prefix.toLowerCase();
          const reconstructed = cleanPrefix + f + cs.word.toLowerCase();
          const dist = calcDamerauLevenshtein(wordLower, reconstructed.toLowerCase());
          if (dist > 2) continue;

          if (!this.compoundValidator.isValidCompound(reconstructed) && !this.dafsa.contains(reconstructed)) continue;

          let score = dist;
          score -= Math.min(cs.word.length * 0.06, 0.6);
          const csLower = cs.word.toLowerCase();
          if (
            csLower.endsWith("ung") ||
            csLower.endsWith("keit") ||
            csLower.endsWith("heit") ||
            csLower.endsWith("schaft") ||
            csLower.endsWith("tion") ||
            csLower.endsWith("raum") ||
            csLower.endsWith("ordnung") ||
            csLower.endsWith("verfahren") ||
            csLower.endsWith("punkt")
          ) {
            score -= 0.35;
          }
          if (frequencyRef?.[reconstructed.toLocaleLowerCase("de-DE")]) score -= 0.5;
          if (frequencyRef?.[csLower]) score -= 0.4;

          const existing = candidatesMap.get(reconstructed);
          if (existing === undefined || score < existing.score) {
            candidatesMap.set(reconstructed, { word: reconstructed, score, dist });
          }
        }
      }
    }

    // 2. Richtung: Fehler im Präfix (z. B. Betribskostenabrechnungszeitraum)
    if (candidatesMap.size < maxResults) {
      for (let splitIdx = len - 4; splitIdx >= 4; splitIdx--) {
        const suffix = word.slice(splitIdx);
        const suffixLower = suffix.toLowerCase();
        const suffixTitle = suffix[0].toUpperCase() + suffix.slice(1).toLowerCase();

        const isSuffixValid = (this.dafsa.hasFlag(suffixTitle, WORD_FLAG_NOUN) && isViableCompoundHead(suffixTitle, this.dafsa, this.compoundValidator, frequencyRef, this.titlecaseCorpusWords, this.lowercaseCorpusWords)) ||
          (suffix.length >= 6 && Boolean(this.compoundValidator.isValidCompound(suffixTitle)));
        if (!isSuffixValid) continue;

        const prefixPart = word.slice(0, splitIdx);
        for (const f of fugen) {
          if (f && !prefixPart.endsWith(f)) continue;
          const rawPrefix = f ? prefixPart.slice(0, -f.length) : prefixPart;
          if (rawPrefix.length < 3 || rawPrefix.length > 18) continue;

          const titlePrefix = rawPrefix[0].toUpperCase() + rawPrefix.slice(1).toLowerCase();
          const candPrefixes = this.dafsa.findCandidates(titlePrefix, 2, 6);

          for (const cp of candPrefixes) {
            const cpInfo = this.dafsa.getWordInfo(cp.word);
            const cpFlags = cpInfo.flags | this.dafsa.getWordInfo(cp.word.toLowerCase()).flags;
            if ((cpFlags & WORD_FLAG_NOUN) === 0 && (cpFlags & WORD_FLAG_LOWER_COMPOUND) === 0) continue;

            const cleanCp = isCapitalized
              ? (cp.word[0].toUpperCase() + cp.word.slice(1).toLowerCase())
              : cp.word.toLowerCase();
            const reconstructed = cleanCp + f + suffixLower;
            const dist = calcDamerauLevenshtein(wordLower, reconstructed.toLowerCase());
            if (dist > 2) continue;

            if (!this.compoundValidator.isValidCompound(reconstructed) && !this.dafsa.contains(reconstructed)) continue;

            let score = dist;
            score -= Math.min(rawPrefix.length * 0.05, 0.4);
            if (frequencyRef?.[reconstructed.toLocaleLowerCase("de-DE")]) score -= 0.5;
            if (frequencyRef?.[cp.word.toLocaleLowerCase("de-DE")]) score -= 0.4;

            const existing = candidatesMap.get(reconstructed);
            if (existing === undefined || score < existing.score) {
              candidatesMap.set(reconstructed, { word: reconstructed, score, dist });
            }
          }
        }
        if (candidatesMap.size >= 3) break;
      }
    }

    const all = Array.from(candidatesMap.values());
    if (!all.length) return [];
    const minDistance = Math.min(...all.map(c => c.dist));
    // Strikte Distanz-Dominanz: Wenn mindestens ein Distanz-1-Kandidat existiert,
    // werden alle Distanz-2-Kandidaten verworfen (verhindert unpassende Wörter wie Gabelschaft/Leserschaft).
    const filtered = minDistance <= 1 ? all.filter(c => c.dist <= 1) : all;

    const sorted = filtered.sort((a, b) => a.score - b.score);
    if (!sorted.length) return [];
    const bestScore = sorted[0].score;
    const gapFiltered = sorted.filter(c => c.score - bestScore <= 0.35);
    return gapFiltered.slice(0, maxResults);
  }

  collectCandidates(word, isFirstWord = false, limit = 5, isNounSignal = false) {
    word = normalizeLookupWord(word);
    const map = new Map();
    const userDictCandidates = new Set();
    const qLower = word.toLowerCase();
    const isTitle = word.length > 0 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
    const isAllCaps = word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase();
    const germanRewriteCosts = new Map();
    const knownCorrectionCandidates = new Set();
    const searchForms = [word];
    if (isAllCaps) {
      searchForms.push(word[0] + word.slice(1).toLowerCase(), qLower);
    } else if (word.length <= 20) {
      const titleForm = word[0].toUpperCase() + word.slice(1).toLowerCase();
      if (word !== qLower && !searchForms.includes(qLower)) searchForms.push(qLower);
      if (word !== titleForm && !searchForms.includes(titleForm)) searchForms.push(titleForm);
    }

    // 1. DAFSA Suche mit Distanz 2
    for (const searchWord of searchForms) {
      for (const c of this.dafsa.findCandidates(searchWord, 2, 120)) {
        const existing = map.get(c.word);
        if (existing === undefined || c.distance < existing) map.set(c.word, c.distance);
      }
    }

    // 2. Typische deutsche Mehrzeichenfehler direkt zurückschreiben. Dadurch
    // können Kandidaten wie Philosophie/Filosofie oder Bäume/Beume gefunden
    // werden, obwohl ihre normale Editierdistanz zu hoch wäre.
    if (word.length >= 3 && word.length <= 24) {
      for (const { form, cost } of generateGermanRewriteForms(qLower)) {
        const oldRewriteCost = germanRewriteCosts.get(form);
        if (oldRewriteCost === undefined || cost < oldRewriteCost) germanRewriteCosts.set(form, cost);
        const forms = [form, form[0].toUpperCase() + form.slice(1)];
        for (const candidate of forms) {
          if (!this.dafsa.contains(candidate)) continue;
          const existing = map.get(candidate);
          if (existing === undefined || cost < existing) map.set(candidate, cost);
        }
      }
    }

    // Redaktionell belegte, eindeutige Nichtwortfehler bekommen einen direkten
    // Kandidatenpfad. Reale Wörter aus derselben Liste bleiben der separaten
    // Satzkontextprüfung vorbehalten.
    const knownCorrection = this.commonTypos[qLower];
    if (knownCorrection && !this.dafsa.isValidWord(word, isFirstWord)) {
      let displayCorrection = knownCorrection;
      if (isAllCaps) displayCorrection = knownCorrection.toUpperCase();
      else if (isFirstWord) displayCorrection = knownCorrection[0].toUpperCase() + knownCorrection.slice(1);
      map.set(displayCorrection, 0.05);
      knownCorrectionCandidates.add(displayCorrection.toLocaleLowerCase("de-DE"));
    }

    // 3. Bei langen Wörtern und unzureichenden Treffern: Compound-Kandidaten-Synthese
    if (map.size < 4 && word.length >= 12 && this.compoundValidator) {
      const compoundCandidates = this.synthesizeCompoundCandidates(word, limit);
      for (const cand of compoundCandidates) {
        const existing = map.get(cand.word);
        if (existing === undefined || cand.score < existing) {
          map.set(cand.word, cand.score);
        }
      }
    }

    // 4. Bei kürzeren Wörtern und wenigen Treffern auf Distanz 3 im DAFSA erweitern
    if (map.size < 4 && word.length >= 6 && word.length <= 16) {
      for (const searchWord of searchForms) {
        for (const c of this.dafsa.findCandidates(searchWord, 3, 120)) {
          if (!map.has(c.word)) map.set(c.word, c.distance);
        }
      }
    }

    // 5. Benutzerwörterbuch. Ignorierte Wörter sind keine Korrekturvorschläge.
    const scanCustomDict = (dictSet, isUserDict = true) => {
      if (!dictSet) return;
      for (const entry of dictSet) {
        const entryLower = entry.toLowerCase();
        if (entryLower === qLower) {
          map.set(entry, 0.1);
          if (isUserDict) userDictCandidates.add(entry);
          continue;
        }
        const dist = calcDamerauLevenshtein(qLower, entryLower);
        if (dist <= 2) {
          let cand = entry;
          if (isTitle && entry[0] === entry[0].toLowerCase()) {
            cand = entry[0].toUpperCase() + entry.slice(1);
          }
          const distScore = (dist === 1 ? 0.35 : 1.10) + (isUserDict ? 0.0 : 0.1);
          const existing = map.get(cand);
          if (existing === undefined || distScore < existing) {
            map.set(cand, distScore);
            if (isUserDict) userDictCandidates.add(cand);
          }
        }
      }
    };

    scanCustomDict(this.userDictionary, true);

    // 6. Fallback für reine Groß-/Kleinschreibungsfehler (nur echte Wörter im Wörterbuch)
    const titleCand = word[0].toUpperCase() + word.slice(1);
    if (this.dafsa.isValidWord(titleCand, isFirstWord)) {
      map.set(titleCand, 0.2);
    }
    const lowerCand = word.toLowerCase();
    if (this.dafsa.isValidWord(lowerCand, isFirstWord)) {
      map.set(lowerCand, 0.2);
    }

    // 7. Explizite Schreibvarianten als zusätzlicher Fallback
    const rules = [["ae", "ä"], ["oe", "ö"], ["ue", "ü"], ["ss", "ß"], ["ä", "ae"], ["ö", "oe"], ["ü", "ue"], ["ß", "ss"]];
    for (const [f, t] of rules) {
      if (qLower.includes(f)) {
        const rep = qLower.replaceAll(f, t);
        const repTitle = rep[0].toUpperCase() + rep.slice(1);
        if (this.dafsa.isValidWord(rep, isFirstWord)) map.set(rep, 0.4);
        if (this.dafsa.isValidWord(repTitle, isFirstWord)) map.set(repTitle, 0.4);
        for (const c of this.dafsa.findCandidates(rep, 1, 15)) {
          if (!map.has(c.word)) map.set(c.word, c.distance + 0.4);
        }
      }
    }

    // 8. Buchstabendreher (Transposition)
    for (let i = 0; i < word.length - 1; i++) {
      const swapped = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
      if (this.dafsa.isValidWord(swapped, isFirstWord) && (!map.has(swapped) || 0.5 < map.get(swapped))) {
        map.set(swapped, 0.5);
      }
    }

    // 8b. Für kurze Eingaben: systematische 1-Edit-Vollständigkeit garantieren (z.B. ic -> ich, wi -> wir)
    if (word.length <= 4) {
      const alphabet = 'abcdefghijklmnopqrstuvwxyzäöüß';
      for (let i = 0; i <= word.length; i++) {
        for (const ch of alphabet) {
          const ins = qLower.slice(0, i) + ch + qLower.slice(i);
          if (this.dafsa.contains(ins)) {
            if (!map.has(ins)) map.set(ins, 1.0);
          }
          const insTitle = ins[0].toUpperCase() + ins.slice(1);
          if (this.dafsa.contains(insTitle)) {
            if (!map.has(insTitle)) map.set(insTitle, 1.0);
          }
        }
      }
    }

    // 9. Probabilistisches Bayes/Log-Likelihood-Ranking (Sprachmodell-Prior + deutsches Fehlermodell)
    const qPhonetic = koelnerPhonetik(qLower);

    const scored = Array.from(map.entries()).map(([cand, origDist]) => {
      const cLower = cand.toLowerCase();
      const isAcronym = cand.length >= 2 && cand === cand.toUpperCase();
      const isKnownCorrection = knownCorrectionCandidates.has(cLower);

      // --- A. SPRACHMODELL LOG-PRIOR: log P(c) ---
      // Echter Korpusprior statt GBERT-WordPiece-ID. Additive Glättung hält
      // seltene und neu gebildete Komposita im Rennen, ohne häufige Alltagswörter
      // mit Tokenizer-internen IDs zu verwechseln.
      const corpusCount = this.wordFrequencies?.[cLower] || 0;
      const pseudoCount = corpusCount > 0 ? corpusCount : 0.10;
      const denominator = this.wordFrequencyTotal +
        (0.10 * Math.max(1, this.wordFrequencyTypes + 1));
      let logPrior = this.wordFrequencies
        ? Math.log(pseudoCount / Math.max(1, denominator))
        : -14.0;

      // Benutzerwörterbuch-Wörter sind vom Nutzer explizit gewünscht
      const isFromUserDict = userDictCandidates.has(cand) || (cand.length > 0 && userDictCandidates.has(cLower));
      if (isFromUserDict) {
        logPrior = 0.0;
      }

      // --- B. FEHLERMODELL LOG-LIKELIHOOD: log P(w | c) ---
      let logError = 0.0;

      if (cLower === qLower) {
        if (isAcronym && !isAllCaps) {
          logError = -2.5; // Abkürzungen bei Kleinschreibung (z.B. 'ic' -> 'IC')
        } else {
          logError = 0.5; // Exakte Buchstabenfolge (nur Groß-/Kleinschreibung)
        }
      } else {
        const weightedDist = calcWeightedDamerauLevenshtein(qLower, cLower);
        const editDist = Math.min(origDist, weightedDist);
        logError = -2.2 * editDist;

        // Eine explizit modellierte deutsche Mehrzeichenverwechslung ist
        // aussagekräftiger als ein großer Rohfrequenz-Unterschied.
        if (germanRewriteCosts.has(cLower)) logError += 0.5;
        if (isKnownCorrection) logError += 8.0;

        // Natürlicher deutscher Auslassungsfehler (z.B. kome -> komme, ic -> ich, verordung -> verordnung)
        if (cLower.length > qLower.length) {
          const hasDouble = /(.)\1/.test(cLower);
          const hasCh = cLower.includes('ch') && !qLower.includes('ch');
          const hasNung = cLower.endsWith('nung') && qLower.endsWith('ung');
          const hasSchwa = (cLower.endsWith('en') && qLower.endsWith('n')) ||
                           (cLower.endsWith('el') && qLower.endsWith('l')) ||
                           (cLower.endsWith('er') && qLower.endsWith('r'));
          if (hasDouble || hasCh || hasNung || hasSchwa) {
            logError += 0.8;
          }
        }

        // Key-Bounce / versehentlicher doppelter Buchstabe (z.B. zeitrraum -> zeitraum, hafenn -> hafen)
        if (qLower.length > cLower.length) {
          const doubleMatch = /(.)\1/.exec(qLower);
          if (doubleMatch && qLower.replace(doubleMatch[0], doubleMatch[1]) === cLower) {
            logError += 0.8;
          }
        }

        // Kölner Phonetik: Lautet das Wort identisch?
        const cPhonetic = koelnerPhonetik(cLower);
        if (!isAcronym && qPhonetic && cPhonetic && qPhonetic === cPhonetic) {
          logError += 0.9;
        }

        // Strafe für All-Caps Akronyme mit Tippfehler bei Kleinbuchstaben-Eingabe (z.B. 'ic' -> 'IV')
        if (isAcronym && !isAllCaps) {
          logError -= 3.5;
        }
      }

      // Präfix-Übereinstimmung (Wortanfang stimmt überein)
      let prefixMatch = 0;
      while (prefixMatch < qLower.length && prefixMatch < cLower.length && qLower[prefixMatch] === cLower[prefixMatch]) {
        prefixMatch++;
      }
      const isHardC = (qLower[0] === 'k' && cLower[0] === 'c') || (qLower[0] === 'c' && cLower[0] === 'k');
      const isPhF = (qLower.startsWith('ph') && cLower.startsWith('f')) ||
        (qLower.startsWith('f') && cLower.startsWith('ph')) ||
        (qLower.startsWith('v') && cLower.startsWith('f')) ||
        (qLower.startsWith('f') && cLower.startsWith('v'));
      if (prefixMatch === 0 && (isHardC || isPhF)) {
        let subMatch = 1;
        while (subMatch < qLower.length && subMatch < cLower.length && qLower[subMatch] === cLower[subMatch]) {
          subMatch++;
        }
        if (subMatch > 1) {
          prefixMatch = subMatch - 0.3;
        }
      }
      const maxWordLen = Math.max(qLower.length, cLower.length);
      const prefixRatio = prefixMatch / Math.max(1, maxWordLen);

      if (prefixMatch >= 2) {
        logError += prefixMatch * 0.25;
        if (prefixRatio >= 0.55) {
          logError += (prefixRatio - 0.50) * 2.0;
        }
      }

      const lenDiff = Math.abs(qLower.length - cLower.length);
      if (lenDiff === 0 && prefixMatch >= 3) {
        logError += 0.35;
      } else if (lenDiff > 3) {
        logError -= (lenDiff - 3) * 0.30;
      }

      // Suffix-Übereinstimmung
      let suffixMatch = 0;
      while (
        suffixMatch < qLower.length &&
        suffixMatch < cLower.length &&
        qLower[qLower.length - 1 - suffixMatch] === cLower[cLower.length - 1 - suffixMatch]
      ) {
        suffixMatch++;
      }
      if (prefixMatch + suffixMatch > cand.length) {
        suffixMatch = Math.max(0, cand.length - prefixMatch);
      }
      if (suffixMatch >= 2) {
        logError += prefixMatch > 0 ? Math.min(suffixMatch * 0.15, 0.60) : Math.min(suffixMatch * 0.08, 0.25);
      }

      // Groß-/Kleinschreibungs-Präferenz
      let candMustCap = this.mustBeCapitalized(cand);
      if (!candMustCap && isNounSignal) {
        const titleForm = cand[0].toUpperCase() + cand.slice(1).toLowerCase();
        if (this.dafsa.hasFlag(titleForm, WORD_FLAG_NOUN)) {
          candMustCap = true;
        }
      }
      if (candMustCap) {
        if (cand[0] === cand[0].toUpperCase()) logError += 0.3;
        else logError -= 0.2;
      } else if (isTitle) {
        if (cand[0] === cand[0].toUpperCase()) logError += 0.3;
        else logError -= 0.3;
      } else if (!isTitle && !isFirstWord) {
        if (cand[0] === cand[0].toLowerCase()) logError += 0.2;
      }

      // --- C. GESAMT-LOG-POSTERIOR ---
      // log P(c | w) = log P(w | c) + alpha * log P(c)
      const logPosterior = logError + (WORD_FREQUENCY_PRIOR_WEIGHT * logPrior);

      let finalWord = cand;
      if (isAllCaps) {
        finalWord = cand.toUpperCase();
      } else if (isFirstWord || candMustCap) {
        finalWord = cand[0].toUpperCase() + cand.slice(1);
      }

      const effDist = Math.max(0.1, -logPosterior / 3.0);
      const editScore = 1 / (1 + effDist);
      const confidence = Math.max(10, Math.min(98, Math.round(editScore * 100)));

      return {
        word: finalWord,
        score: effDist,
        logPosterior,
        distance: effDist,
        fromUserDict: isFromUserDict,
        editScore,
        confidence,
        prefixMatch
      };
    }).sort((a, b) => b.logPosterior - a.logPosterior);

    const result = [];
    const seenLower = new Set();
    const bestLog = scored[0]?.logPosterior ?? 0;
    const logGap = 4.5;
    const hasStrongPrefix = scored[0] && (scored[0].prefixMatch >= 4);

    for (const item of scored) {
      if (hasStrongPrefix && item.prefixMatch < 2 && result.length >= 3) continue;
      const currentLogGap = (word.length >= 16 && result.length >= 1) ? 0.95 : logGap;
      if (result.length >= (word.length >= 16 ? 1 : 5) && bestLog - item.logPosterior > currentLogGap) break;
      const lower = item.word.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        result.push(item);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  async getSuggestions(word, context = "", isFirstWord = false, checkCase = true, start = -1, end = -1) {
    if (this.isCorrect(word, isFirstWord, checkCase)) return [];
    const occurrence = this.mlmScorer?.findOccurrence(context, word, start, end);
    const occStart = occurrence ? occurrence.start : (start >= 0 ? start : context.toLocaleLowerCase("de-DE").indexOf(word.toLocaleLowerCase("de-DE")));
    const isNounSignal = detectNounSignal(context, occStart);
    const candidates = this.collectCandidates(word, isFirstWord, 10, isNounSignal);
    if (!candidates.length) return [];

    const surroundingContext = occurrence
      ? context.slice(0, occurrence.start) + context.slice(occurrence.end)
      : "";
    if (this.mlmScorer && /\p{L}/u.test(surroundingContext)) {
      try {
        return (await this.mlmScorer.scoreCandidates(word, context, candidates, start, end)).slice(0, 5);
      } catch {}
    }
    return candidates.slice(0, 5);
  }
}

// ============================================================================
// 5. Initialisierung & IPC-Koordinator
// ============================================================================

let engine = null;
let initPromise = null;

async function getEngine() {
  if (engine) return engine;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const dictResp = await fetch(browser.runtime.getURL("data/german_dictionary.bin"));
      const dafsa = new DAFSA(await dictResp.arrayBuffer());
      const compound = new GermanCompoundValidator(dafsa);

      let mlm = null;
      let vocab = null;
      let wordFrequencyData = null;
      let commonTypoData = null;
      try {
        const langResp = await fetch(browser.runtime.getURL("data/german_language_data.json"));
        if (langResp.ok) {
          const langData = await langResp.json();
          wordFrequencyData = langData.corpus || null;
          commonTypoData = langData.typos || null;
          vocab = langData.vocab || null;
        }
      } catch {}

      if (vocab) {
        try {
          const modelUrls = [
            browser.runtime.getURL("data/gbert_part1.bin"),
            browser.runtime.getURL("data/gbert_part2.bin")
          ];
          mlm = new MLMContextScorer(modelUrls, vocab);
          mlm.init().catch(() => {});
        } catch {}
      }

      engine = new SpellCheckEngine(
        dafsa,
        compound,
        mlm,
        userDictionary,
        ignoredWords,
        vocab,
        wordFrequencyData,
        commonTypoData
      );
      return engine;
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

const TOKEN_WORD_REGEX = /(?:(?:\d+[-\u2010-\u2015\u2212])+)?[\p{L}\p{M}]+(?:[-\u2010-\u2015\u2212'\u2018\u2019\u02BC][\p{L}\p{M}\d]+)*(?:[-\u2010-\u2015\u2212](?=\s|$|[.,;:!?]))?/gu;
const PROTECTED_TOKEN_PATTERNS = [
  /(?:https?:\/\/|www\.)[^\s<>"']+/giu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu,
  /(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}\.)+)[\p{L}]{2,}(?:\/[^\s<>"']*)?/gu,
  /[#@][\p{L}\p{M}\p{N}_-]+/gu,
  /(?=[\p{L}\p{M}\p{N}_]*[\p{N}_])[\p{L}\p{M}][\p{L}\p{M}\p{N}_]*/gu,
  /(?:[A-Za-z]:\\|\\\\)[^\s<>"']+/g
];

function getProtectedRanges(text) {
  const ranges = [];
  for (const pattern of PROTECTED_TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function beginsSentence(gap, isFirstToken) {
  if (isFirstToken) return true;
  return /(?:[.!?…]+|[\r\n]+|:)\s*["'„“‚‘’»«()\[\]{}\-–—]*\s*$/u.test(gap);
}

function tokenize(text) {
  const tokens = [];
  const protectedRanges = getProtectedRanges(text);
  let protectedIndex = 0;
  const regex = new RegExp(TOKEN_WORD_REGEX.source, TOKEN_WORD_REGEX.flags);
  let previousEnd = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].end <= m.index) protectedIndex++;
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && m.index < protectedRange.end && m.index + m[0].length > protectedRange.start) continue;

    const word = m[0];
    const isFirstWord = beginsSentence(text.slice(previousEnd, m.index), tokens.length === 0);
    tokens.push({ word, start: m.index, end: m.index + word.length, isFirstWord });
    previousEnd = m.index + word.length;
  }
  return tokens;
}

const CONTEXT_CONFUSION_GROUPS = [
  ["seit", "seid"],
  ["das", "dass"],
  ["den", "denn"],
  ["wen", "wenn"],
  ["wieder", "wider"],
  ["war", "wahr"],
  ["man", "Mann"],
  ["viel", "fiel"],
  ["wurde", "würde"],
  ["tot", "Tod"],
  ["Lid", "Lied"],
  ["ihm", "ihn"],
  ["mir", "mich"],
  ["dir", "dich"],
  ["Stadt", "Statt"],
  ["Mal", "Mahl"],
  ["sieht", "siehst"],
  ["hat", "hast"],
  ["wäre", "werde"]
];
const CONTEXT_GROUP_BY_WORD = new Map();
for (const group of CONTEXT_CONFUSION_GROUPS) {
  for (const word of group) CONTEXT_GROUP_BY_WORD.set(word.toLocaleLowerCase("de-DE"), group);
}
const CONTEXT_ERROR_MARGIN = 1.75;
const MAX_CONTEXT_CHECKS_PER_TEXT = 16;

function getContextConfusionGroup(engine, word) {
  const key = normalizeLookupWord(word).toLocaleLowerCase("de-DE");
  const fixedGroup = CONTEXT_GROUP_BY_WORD.get(key);
  if (fixedGroup) return fixedGroup;

  const correction = engine.commonTypos?.[key];
  if (!correction || correction.toLocaleLowerCase("de-DE") === key) return null;
  // Bewusst akzeptierte ss/ß-Varianten und im aktuellen Korpus mehrfach
  // belegte Formen bleiben unangetastet.
  const normalizedSs = value => value.toLocaleLowerCase("de-DE").replaceAll("ß", "ss");
  if (normalizedSs(correction) === normalizedSs(key)) return null;
  if ((engine.wordFrequencies?.[key] || 0) >= 3) return null;
  return [word, correction];
}

function matchOriginalCase(candidate, original, isFirstWord) {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return candidate.toUpperCase();
  if (isFirstWord) {
    return candidate[0].toUpperCase() + candidate.slice(1);
  }
  return candidate;
}

function isExplicitlyAccepted(engine, word, checkCase) {
  const matches = set => {
    if (!set) return false;
    if (set.has(word)) return true;
    if (checkCase) return false;
    const lower = word.toLocaleLowerCase("de-DE");
    for (const entry of set) if (entry.toLocaleLowerCase("de-DE") === lower) return true;
    return false;
  };
  return matches(engine.userDictionary) || matches(engine.ignoredWords);
}

function getLocalContext(text, token, radius = 280) {
  const hardStart = Math.max(0, token.start - radius);
  const hardEnd = Math.min(text.length, token.end + radius);
  let start = hardStart;
  let end = hardEnd;
  for (let i = token.start - 1; i >= hardStart; i--) {
    if (/[.!?…\r\n]/u.test(text[i])) {
      start = i + 1;
      break;
    }
  }
  for (let i = token.end; i < hardEnd; i++) {
    if (/[.!?…\r\n]/u.test(text[i])) {
      end = i + 1;
      break;
    }
  }
  return { text: text.slice(start, end), start: token.start - start, end: token.end - start };
}

async function findContextErrors(engine, text, tokens, existingErrors, checkCase) {
  if (!engine.mlmScorer || text.trim().length < 3) return [];
  const occupiedStarts = new Set(existingErrors.map(error => error.start));
  const candidates = tokens.filter(token =>
    !occupiedStarts.has(token.start) &&
    Boolean(getContextConfusionGroup(engine, token.word)) &&
    engine.isCorrect(token.word, token.isFirstWord, checkCase) &&
    !isExplicitlyAccepted(engine, token.word, checkCase)
  ).slice(0, MAX_CONTEXT_CHECKS_PER_TEXT);

  const errors = [];
  for (const token of candidates) {
    const originalKey = normalizeLookupWord(token.word).toLocaleLowerCase("de-DE");
    const group = getContextConfusionGroup(engine, token.word);
    const displayCandidates = group.map(candidate => matchOriginalCase(candidate, token.word, token.isFirstWord));
    const localContext = getLocalContext(text, token);
    try {
      const scores = await engine.mlmScorer.getContextLogScores(
        token.word, localContext.text, displayCandidates, localContext.start, localContext.end
      );
      scores.sort((a, b) => b.logScore - a.logScore);
      const best = scores[0];
      const original = scores.find(item => item.word.toLocaleLowerCase("de-DE") === originalKey);
      if (!best || !original || best.word.toLocaleLowerCase("de-DE") === originalKey) continue;
      if (!Number.isFinite(best.logScore) || best.logScore - original.logScore < CONTEXT_ERROR_MARGIN) continue;
      errors.push({
        word: token.word,
        start: token.start,
        end: token.end,
        isFirstWord: token.isFirstWord,
        kind: "context",
        suggestion: best.word,
        quickSuggestions: [best.word]
      });
    } catch {}
  }
  return errors;
}

let currentCheckCase = true;
let userDictionary = new Set();
let ignoredWords = new Set();

async function saveUserDictionary() {
  if (typeof browser !== "undefined" && browser.storage?.local) {
    await browser.storage.local.set({ sc_user_dict: Array.from(userDictionary) });
  }
}

async function saveIgnoredWords() {
  if (typeof browser !== "undefined" && browser.storage?.local) {
    await browser.storage.local.set({ sc_ignored_words: Array.from(ignoredWords) });
  }
}

if (typeof browser !== "undefined" && browser.storage?.local) {
  browser.storage.local.get(["sc_settings", "sc_user_dict", "sc_ignored_words"]).then((res) => {

    if (Array.isArray(res?.sc_user_dict)) {
      userDictionary = new Set(res.sc_user_dict);
      if (engine) engine.userDictionary = userDictionary;
    }
    if (Array.isArray(res?.sc_ignored_words)) {
      ignoredWords = new Set(res.sc_ignored_words);
      if (engine) engine.ignoredWords = ignoredWords;
    }
  }).catch(() => {});

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {

      if (changes.sc_user_dict?.newValue) {
        if (Array.isArray(changes.sc_user_dict.newValue)) {
          userDictionary = new Set(changes.sc_user_dict.newValue);
          if (engine) {
            engine.userDictionary = userDictionary;
            engine.cache.clear();
          }
        }
      }
      if (changes.sc_ignored_words?.newValue) {
        if (Array.isArray(changes.sc_ignored_words.newValue)) {
          ignoredWords = new Set(changes.sc_ignored_words.newValue);
          if (engine) {
            engine.ignoredWords = ignoredWords;
            engine.cache.clear();
          }
        }
      }
    }
  });
}

browser.runtime.onMessage.addListener((req, sender, sendResponse) => {
  const checkCase = typeof req?.checkCase === "boolean" ? req.checkCase : currentCheckCase;

  if (req?.action === "check_text" || req?.action === "check_sentence") {
    (async () => {
      try {
        const eng = await getEngine();
        const text = req.text || req.sentence || "";
        const errors = [];
        const tokens = tokenize(text);
        for (const tok of tokens) {
          if (!eng.isCorrect(tok.word, tok.isFirstWord, checkCase)) {
            const isNounSignal = detectNounSignal(text, tok.start);
            const quick = eng.collectCandidates(tok.word, tok.isFirstWord, 5, isNounSignal).map(c => c.word);
            errors.push({
              word: tok.word,
              start: tok.start,
              end: tok.end,
              isFirstWord: tok.isFirstWord,
              kind: "spelling",
              suggestion: quick[0] || "",
              quickSuggestions: quick
            });
          }
        }
        sendResponse({ errors });
      } catch (err) {
        sendResponse({ errors: [] });
      }
    })();
    return true;
  }

  if (req?.action === "check_context") {
    (async () => {
      try {
        const eng = await getEngine();
        const text = req.text || "";
        const tokens = tokenize(text);
        const errors = await findContextErrors(eng, text, tokens, [], checkCase);
        sendResponse({ errors });
      } catch {
        sendResponse({ errors: [] });
      }
    })();
    return true;
  }

  if (req?.action === "get_suggestions") {
    (async () => {
      try {
        const eng = await getEngine();
        const suggestions = (await eng.getSuggestions(
          req.word, req.context || "", req.isFirstWord, checkCase, req.start, req.end
        )).map(s => s.word);
        sendResponse({ suggestions });
      } catch {
        sendResponse({ suggestions: [] });
      }
    })();
    return true;
  }

  if (req?.action === "add_to_dictionary") {
    (async () => {
      try {
        const rawWord = (req.word || "").trim();
        if (rawWord && !userDictionary.has(rawWord)) {
          userDictionary.add(rawWord);
          if (engine) {
            engine.userDictionary = userDictionary;
            engine.cache.clear();
          }
          await saveUserDictionary();
        }
        sendResponse({ success: true, count: userDictionary.size });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (req?.action === "remove_from_dictionary") {
    (async () => {
      try {
        const rawWord = (req.word || "").trim();
        if (userDictionary.has(rawWord)) {
          userDictionary.delete(rawWord);
          if (engine) {
            engine.userDictionary = userDictionary;
            engine.cache.clear();
          }
          await saveUserDictionary();
        }
        sendResponse({ success: true, count: userDictionary.size });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (req?.action === "get_user_dictionary") {
    sendResponse({ words: Array.from(userDictionary) });
    return false;
  }

  if (req?.action === "ignore_word") {
    (async () => {
      try {
        const rawWord = (req.word || "").trim();
        if (rawWord && !ignoredWords.has(rawWord)) {
          ignoredWords.add(rawWord);
          if (engine) {
            engine.ignoredWords = ignoredWords;
            engine.cache.clear();
          }
          await saveIgnoredWords();
        }
        sendResponse({ success: true, count: ignoredWords.size });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (req?.action === "unignore_word") {
    (async () => {
      try {
        const rawWord = (req.word || "").trim();
        if (ignoredWords.has(rawWord)) {
          ignoredWords.delete(rawWord);
          if (engine) {
            engine.ignoredWords = ignoredWords;
            engine.cache.clear();
          }
          await saveIgnoredWords();
        }
        sendResponse({ success: true, count: ignoredWords.size });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (req?.action === "get_ignored_words") {
    sendResponse({ words: Array.from(ignoredWords) });
    return false;
  }
});

// Sofort im Hintergrund vorladen
getEngine().catch(() => {});
