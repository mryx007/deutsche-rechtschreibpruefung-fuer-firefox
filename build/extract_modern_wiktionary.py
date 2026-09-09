import urllib.request
import urllib.parse
import json
import re
import sys
import os

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

pages_to_extract = [
    "Verzeichnis:Deutsch/Anglizismen",
    "Verzeichnis:Deutsch/Anglizismen/Scheinanglizismen",
    "Verzeichnis:Deutsch/Netzjargon",
    "Verzeichnis:Deutsch/Informatik/Themengebiete/Internet",
    "Verzeichnis:Deutsch/Informatik/Themengebiete/Netzwerke",
    "Verzeichnis:Deutsch/Abkürzungen im Internet"
]

extracted_words = set()

for page in pages_to_extract:
    url = f"https://de.wiktionary.org/w/api.php?action=parse&page={urllib.parse.quote(page)}&prop=links&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "GeorgSpellcheckIntegration/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        links = data.get("parse", {}).get("links", [])
        count = 0
        for l in links:
            title = l.get("*", "").strip()
            if not title or ":" in title:
                continue
            # Reine Wörter (Buchstaben, Bindestrich, Punkt bei Abkürzungen wie z.B.)
            clean = title.strip()
            if len(clean) >= 2 and re.match(r"^[A-Za-zÄÖÜäöüß\-']+$", clean):
                extracted_words.add(clean)
                count += 1
                # Plural -s für Anglizismen / Nomen hinzufügen
                if clean[0].isupper() and not clean.endswith("s") and not clean.endswith("ß"):
                    extracted_words.add(clean + "s")
        print(f"[{page}]: {count} Wörter extrahiert")
    except Exception as e:
        print(f"Fehler bei {page}: {e}")

print(f"\nGesamtzahl moderne Wörter extrahiert: {len(extracted_words)}")

# In additional_words.txt integrieren
add_path = os.path.join(os.path.dirname(__file__), "additional_words.txt")
existing_words = set()
if os.path.exists(add_path):
    with open(add_path, "r", encoding="utf-8") as f:
        for line in f:
            w = line.strip()
            if w:
                existing_words.add(w)

before_count = len(existing_words)
existing_words.update(extracted_words)
after_count = len(existing_words)

sorted_all = sorted(existing_words, key=lambda s: (s.lower(), s))
with open(add_path, "w", encoding="utf-8") as f:
    for w in sorted_all:
        f.write(w + "\n")

print(f"Zusatzwörter aktualisiert: {before_count:,} -> {after_count:,} (+{after_count - before_count:,} neue Wörter)")
