# -*- coding: utf-8 -*-
"""
Generiert ein standardisiertes 100.000-Wörter-Benchmark-Set:
- 50.000 echte deutsche Wörter (aus DEMorphy)
- 50.000 realistische Tippfehler (QWERTZ-Nachbarschaft, Transposition, Doppelkonsonanten, Wikipedia)
"""

import zipfile
import io
import json
import random
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

QWERTZ_ADJACENT = {
    'q': 'wa', 'w': 'qase', 'e': 'wsdr', 'r': 'edfgt', 't': 'rfghz',
    'z': 'tghju', 'u': 'zhjki', 'i': 'ujklo', 'o': 'iklpö', 'p': 'olöü',
    'a': 'qwsy', 's': 'wedyxa', 'd': 'erfcxs', 'f': 'rtgvcd', 'g': 'tzhbvf',
    'h': 'zujnbg', 'j': 'uikmnh', 'k': 'iolmj', 'l': 'opök', 'ö': 'lpä',
    'y': 'asx', 'x': 'sdcy', 'c': 'dfvx', 'v': 'fgbc', 'b': 'ghnv',
    'n': 'hjmb', 'm': 'jkn'
}

def mutate_to_typo(word):
    if len(word) < 4:
        return word + "x"
    
    w_chars = list(word)
    mutation_type = random.choice(["transposition", "qwertz", "double_cons", "omission", "insertion", "phonetic"])
    
    if mutation_type == "transposition":
        # 2 benachbarte Buchstaben vertauschen
        idx = random.randint(1, len(w_chars) - 2)
        w_chars[idx], w_chars[idx + 1] = w_chars[idx + 1], w_chars[idx]
        
    elif mutation_type == "qwertz":
        # Tippfehler auf der QWERTZ-Tastatur
        idx = random.randint(1, len(w_chars) - 1)
        ch_lower = w_chars[idx].lower()
        if ch_lower in QWERTZ_ADJACENT:
            sub = random.choice(QWERTZ_ADJACENT[ch_lower])
            w_chars[idx] = sub.upper() if w_chars[idx].isupper() else sub
            
    elif mutation_type == "double_cons":
        # Doppelkonsonant vereinfachen oder einfachen verdoppeln
        for i in range(1, len(w_chars) - 1):
            if w_chars[i].lower() == w_chars[i + 1].lower() and w_chars[i].isalpha():
                del w_chars[i + 1]
                return "".join(w_chars)
        # Verdoppeln
        idx = random.randint(1, len(w_chars) - 1)
        w_chars.insert(idx, w_chars[idx])
        
    elif mutation_type == "phonetic":
        # Phonetische Verwechslung (v/f, d/t, k/ck)
        s = "".join(w_chars)
        if "f" in s: s = s.replace("f", "v", 1)
        elif "v" in s: s = s.replace("v", "f", 1)
        elif "d" in s: s = s.replace("d", "t", 1)
        elif "t" in s: s = s.replace("t", "d", 1)
        elif "k" in s: s = s.replace("k", "ck", 1)
        elif "ss" in s: s = s.replace("ss", "s", 1)
        elif "ie" in s: s = s.replace("ie", "i", 1)
        else: s = s + "e"
        return s
        
    elif mutation_type == "omission":
        # Buchstabe weglassen
        idx = random.randint(1, len(w_chars) - 1)
        del w_chars[idx]
        
    elif mutation_type == "insertion":
        # Buchstabe zufällig einfügen
        idx = random.randint(1, len(w_chars))
        w_chars.insert(idx, random.choice("eanstirldu"))
        
    res = "".join(w_chars)
    return res if res != word else word + "n"

print("Lese Wörter aus morf_dict.zip...")
real_words = []
with zipfile.ZipFile("morf_dict.zip", "r") as z:
    with z.open("DE_morph_dict.txt") as f:
        stream = io.TextIOWrapper(f, encoding="utf-8")
        for line in stream:
            parts = line.strip().split(" ")
            if len(parts) == 1:
                w = parts[0]
                if len(w) >= 4 and w.isalpha():
                    real_words.append(w)
            if len(real_words) >= 400000:
                break

print(f"Gelesene Basis-Wortformen: {len(real_words):,}")

# Zufällig 50.000 echte Wörter auswählen
random.seed(42)
sampled_real = random.sample(real_words, 50000)

print("Generiere 50.000 realistische Tippfehler...")
typos = []
real_set = set(real_words)

# Wikipedia-Tippfehler einlesen falls vorhanden
if os.path.exists("tests/wikipedia_typos.json"):
    with open("tests/wikipedia_typos.json", "r", encoding="utf-8") as f:
        wiki = json.load(f)
        for item in wiki:
            typos.append(item["typo"])

# Auffüllen auf 50.000 Tippfehler
idx = 0
while len(typos) < 50000:
    base_word = sampled_real[idx % len(sampled_real)]
    idx += 1
    mutated = mutate_to_typo(base_word)
    if mutated not in real_set:
        typos.append(mutated)

print(f"Echte Wörter: {len(sampled_real):,}")
print(f"Tippfehler  : {len(typos):,}")

out_path = os.path.abspath("tests/massive_100k_corpus.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({
        "real_words": sampled_real,
        "typos": typos
    }, f, ensure_ascii=False)

size_mb = os.path.getsize(out_path) / (1024 * 1024)
print(f"✅ 100.000 Wörter erfolgreich gespeichert in:")
print(f"   {out_path} ({size_mb:.2f} MB)")
