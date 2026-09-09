import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

add_path = os.path.join(os.path.dirname(__file__), "additional_words.txt")
with open(add_path, "r", encoding="utf-8") as f:
    words = [line.strip() for line in f if line.strip()]

# Funktionswörter (Präpositionen, Konjunktionen, Artikel, Pronomen), die im Satzinneren zwingend kleingeschrieben werden müssen
FUNCTION_WORDS = {
    "über", "unter", "auf", "in", "an", "vor", "nach", "von", "zu", "bei", "mit",
    "für", "um", "durch", "gegen", "ohne", "seit", "aus", "als", "wie", "dass",
    "weil", "wenn", "ob", "obwohl", "denn", "aber", "oder", "und", "doch", "sondern",
    "der", "die", "das", "ein", "eine", "einer", "einem", "eines", "einen",
    "dem", "den", "des", "im", "am", "zum", "zur", "vom", "beim", "ins", "ans",
    "aufs", "fürs", "übers", "unters", "hin", "her", "da", "dort", "hier",
    "nicht", "noch", "schon", "sehr", "nur", "auch", "so", "dann", "nun",
    "wir", "ihr", "sie", "er", "es", "ich", "du", "mir", "dir", "ihm", "ihr",
    "uns", "euch", "ihnen", "mich", "dich", "ihn", "mein", "dein", "sein",
    "ihr", "unser", "euer", "etwas", "nichts", "alles", "man", "jemand", "niemand"
}

CAPITALIZED_FUNCTION_WORDS = {w.capitalize() for w in FUNCTION_WORDS}

filtered = []
removed = []

for w in words:
    if w in CAPITALIZED_FUNCTION_WORDS:
        removed.append(w)
        # Kleingeschriebene Variante hinzufügen
        lower = w.lower()
        filtered.append(lower)
    else:
        filtered.append(w)

unique_sorted = sorted(set(filtered), key=lambda s: (s.lower(), s))

with open(add_path, "w", encoding="utf-8") as f:
    for w in unique_sorted:
        f.write(w + "\n")

print(f"Bereinigung abgeschlossen:")
print(f"- Entfernte fälschlich großgeschriebene Funktionswörter: {len(removed)}")
print(f"- Beispiele entfernt: {', '.join(sorted(removed)[:15])}")
print(f"- Gesamtzahl verbleibende Einträge in additional_words.txt: {len(unique_sorted):,}")
