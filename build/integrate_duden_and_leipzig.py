import urllib.request
import tarfile
import io
import re
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

add_path = os.path.join(os.path.dirname(__file__), "additional_words.txt")
existing_words = set()
if os.path.exists(add_path):
    with open(add_path, "r", encoding="utf-8") as f:
        for line in f:
            w = line.strip()
            if w:
                existing_words.add(w)

print(f"Bestehende Zusatzwörter: {len(existing_words):,}")

# 1. Duden-Neuzugänge (28. Auflage 2020 & 29. Auflage 2024)
DUDEN_NEOLOGISMS = [
    # Technik, Digitales & KI (Duden 2024)
    "ChatGPT", "Sprachmodell", "Sprachmodelle", "Sprachmodellen", "Prompt", "Prompts",
    "Prompten", "gepromptet", "Balkonkraftwerk", "Balkonkraftwerke", "Balkonkraftwerken",
    "Ladeschale", "Ladeschalen", "Handyticket", "Handytickets", "Passkey", "Passkeys",
    "Deepfake", "Deepfakes", "Kryptowährung", "Kryptowährungen", "Blockchain", "Cyberangriff",
    "Cyberangriffe", "Cyberangriffen", "Phishing", "Ransomware", "Cloudcomputing",

    # Gesellschaft, Klima & Politik (Duden 2020 & 2024)
    "Klimakleber", "Klimaklebern", "Klimaklebers", "Klimakleberin", "Klimakleberinnen",
    "Dürresommer", "Dürresommern", "Extremwetterereignis", "Extremwetterereignisse",
    "Extremwetterereignissen", "Gasmangellage", "Gasmangellagen", "Entlastungspaket",
    "Entlastungspakete", "Entlastungspaketen", "Ukrainekrieg", "Ukrainekriegs",
    "Ampelregierung", "Ampelkoalition", "Zwei-Prozent-Ziel", "Awareness", "Triggerwarnung",
    "Triggerwarnungen", "Bucketlist", "Bucketlists", "meinungsstark", "meinungsstarke",
    "meinungsstarken", "meinungsstarker", "meinungsstarkes", "Beitrittsperspektive",
    "Klimakrise", "Klimanotstand", "Mikroplastik", "Mikroplastiks", "Dachbegrünung",
    "Dachbegrünungen", "bienenfreundlich", "bienenfreundliche", "bienenfreundlichen",
    "Pflegeroboter", "Pflegerobotern", "Videobeweis", "Videobeweise", "Videobeweises",
    "Lockdown", "Lockdowns", "Reproduktionszahl", "Reproduktionszahlen", "Geisterspiel",
    "Geisterspiele", "Geisterspielen", "Impfpass", "Impfpässe", "Impfpässen",

    # Alltag, Ernährung, Lifestyle (Duden 2020 & 2024)
    "Fleischersatz", "Fleischersatzes", "Gemüsekiste", "Gemüsekisten", "Gojibeere",
    "Gojibeeren", "Granola", "Granolas", "Hyaluron", "Hyaluronsäure", "Kochbox",
    "Kochboxen", "Lieblingsmensch", "Lieblingsmenschen", "nerdig", "nerdige", "nerdigen",
    "nerdiger", "nerdiges", "Bartöl", "Bartöle", "Bartölen", "Zwinkersmiley", "Zwinkersmileys",
    "Hackenporsche", "Hackenporsches", "Work-Life-Balance", "Homeoffice", "Homeoffices",
    "Roadtrip", "Roadtrips", "Elektrotretroller", "Elektrotretrollern", "Uploadfilter",
    "Uploadfiltern", "Shitstorm", "Shitstorms", "Ghosten", "geghostet", "Smombie", "Smombies",
    "Binge-Watching", "Faktenfinder", "Faktenfinders", "Homeschooling", "Klickzahlen",
    "Podcasten", "gepodcastet", "Podcaster", "Podcastern", "Podcasterin", "Podcasterinnen"
]

for w in DUDEN_NEOLOGISMS:
    existing_words.add(w)
    if "ß" in w:
        existing_words.add(w.replace("ß", "ss"))

print(f"Nach Duden-Neuaufnahmen: {len(existing_words):,} Wörter")

# 2. Leipzig News 2023 Wörterliste (Top-Wörter aus aktuellen Medien)
LEIPZIG_URL = "https://downloads.wortschatz-leipzig.de/corpora/deu_news_2023_100K.tar.gz"
print("Lade Leipzig News 2023 Korpus (deu_news_2023_100K-words.txt)...")

req = urllib.request.Request(LEIPZIG_URL, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        tar_bytes = resp.read()
    print(f"Heruntergeladen: {len(tar_bytes) / 1024 / 1024:.2f} MB. Entpacke Archiv...")

    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        words_file = None
        for member in tar.getmembers():
            if member.name.endswith("-words.txt"):
                words_file = tar.extractfile(member)
                break

        if words_file:
            stream = io.TextIOWrapper(words_file, encoding="utf-8")
            added_from_leipzig = 0
            for line in stream:
                parts = line.strip().split("\t")
                if len(parts) >= 2:
                    w = parts[1].strip()
                    # Filter: Mindestens Häufigkeit >= 10, echte Wörter
                    freq = int(parts[2]) if len(parts) >= 3 and parts[2].isdigit() else 1
                    if freq >= 15 and len(w) >= 3 and re.match(r"^[A-Za-zÄÖÜäöüß\-']+$", w):
                        if w not in existing_words:
                            existing_words.add(w)
                            added_from_leipzig += 1
            print(f"Aus Leipzig News 2023 hinzugefügt: {added_from_leipzig:,} hochfrequente Wörter")

except Exception as e:
    print(f"Fehler bei Leipzig-Download: {e}")

sorted_all = sorted(existing_words, key=lambda s: (s.lower(), s))
with open(add_path, "w", encoding="utf-8") as f:
    for w in sorted_all:
        f.write(w + "\n")

print(f"Fertig! Gesamtzahl Wörter in additional_words.txt: {len(sorted_all):,}")
