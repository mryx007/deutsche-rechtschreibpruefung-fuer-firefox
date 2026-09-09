import urllib.request
import re
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

URL_SPELLING = "https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-language-modules/de/src/main/resources/org/languagetool/resource/de/hunspell/spelling.txt"
URL_IGNORE = "https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-language-modules/de/src/main/resources/org/languagetool/resource/de/hunspell/ignore.txt"

print("Lade LanguageTool-Wortlisten von GitHub herunter...")

def fetch_lines(url):
    req = urllib.request.Request(url, headers={"User-Agent": "GeorgSpellcheckIntegration/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        content = resp.read().decode("utf-8")
    return content.splitlines()

spelling_lines = fetch_lines(URL_SPELLING)
ignore_lines = fetch_lines(URL_IGNORE)

print(f"Heruntergeladen: {len(spelling_lines):,} Zeilen aus spelling.txt, {len(ignore_lines):,} aus ignore.txt")

expanded_words = set()

# Bisherige Zusatzwörter beibehalten
add_file = os.path.join(os.path.dirname(__file__), "additional_words.txt")
if os.path.exists(add_file):
    with open(add_file, "r", encoding="utf-8") as f:
        for line in f:
            w = line.strip()
            if w:
                expanded_words.add(w)
    print(f"Bestehende Zusatzwörter eingelesen: {len(expanded_words):,}")

def expand_spelling_entry(entry):
    # Kommentare abschneiden
    entry = entry.split("#")[0].strip()
    if not entry:
        return

    # Sonderzeichen wie Sternchen, Wildcards, Unterstriche ignorieren
    if any(ch in entry for ch in ["*", "_", ":", "/", "\\", "$", "@"]) and not ("/" in entry and entry.count("/") == 1):
        # Wenn es mehr als einen Slash hat oder Regex-Muster enthält
        return

    flags = ""
    word = entry
    if "/" in entry:
        parts = entry.split("/", 1)
        word = parts[0].strip()
        flags = parts[1].strip()

    if not word or len(word) < 2 or not re.match(r"^[A-Za-zÄÖÜäöüß\-']+$", word):
        return

    # Basisform
    expanded_words.add(word)

    # Flags auswerten
    # /S -> +s
    if "S" in flags:
        expanded_words.add(word + "s")
    # /E -> +e
    if "E" in flags:
        expanded_words.add(word + "e")
    # /N -> +n
    if "N" in flags:
        expanded_words.add(word + "n")
    # /F -> +in, +innen
    if "F" in flags:
        expanded_words.add(word + "in")
        expanded_words.add(word + "innen")
    # /A oder /P -> Adjektiv-Deklinationen (e, er, es, en, em)
    if "A" in flags or "P" in flags:
        if word.endswith("e"):
            for end in ["r", "s", "n", "m"]:
                expanded_words.add(word + end)
        else:
            for end in ["e", "er", "es", "en", "em"]:
                expanded_words.add(word + end)
    # /T -> Straßen-Abkürzung
    if "T" in flags and word.endswith("straße"):
        expanded_words.add(word[:-6] + "str.")
        expanded_words.add(word[:-6] + "str")

for line in spelling_lines:
    expand_spelling_entry(line)

for line in ignore_lines:
    entry = line.split("#")[0].strip()
    if entry and len(entry) >= 2 and not any(ch in entry for ch in ["*", "_", ":", "$", "@"]):
        if re.match(r"^[A-Za-zÄÖÜäöüß\-']+$", entry):
            expanded_words.add(entry)

# Schweizer ss Varianten
for w in list(expanded_words):
    if "ß" in w:
        expanded_words.add(w.replace("ß", "ss"))

sorted_all = sorted(expanded_words, key=lambda s: (s.lower(), s))
print(f"Gesamte bereinigte Zusatz-Wortliste: {len(sorted_all):,} eindeutige Wörter")

with open(add_file, "w", encoding="utf-8") as f:
    for w in sorted_all:
        f.write(w + "\n")

print(f"Erfolgreich gespeichert in {add_file}!")
