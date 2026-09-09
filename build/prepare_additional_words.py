import json
import re

with open("scratch/missing_true_words.json", "r", encoding="utf-8") as f:
    words = json.load(f)

clean_words = set()
for w in words:
    w = w.strip()
    # Nur echte Wörter (Buchstaben, Bindestrich, Apostroph), mindestens 2 Zeichen
    if len(w) >= 2 and re.match(r"^[A-Za-zÄÖÜäöüß\u00C0-\u024F\-']+$", w):
        # Schweizer 'ss' Variante ebenfalls vorsehen
        clean_words.add(w)

sorted_clean = sorted(clean_words, key=lambda s: (s.lower(), s))
print(f"Erstelle build/additional_words.txt mit {len(sorted_clean)} geprüften Wörtern...")

with open("build/additional_words.txt", "w", encoding="utf-8") as f:
    for w in sorted_clean:
        f.write(w + "\n")

print("Erfolgreich gespeichert!")
