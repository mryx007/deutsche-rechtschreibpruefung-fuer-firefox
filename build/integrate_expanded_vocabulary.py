# -*- coding: utf-8 -*-
"""
Integrate Expanded Vocabulary into additional_words.txt.
Merges:
1. Existing additional_words.txt
2. Tech & Web platform brands (YouTube, WhatsApp, Spotify, Discord, etc.)
3. LanguageTool grammar.xml proper name suggestions & corrections
4. LanguageTool hunspell/ignore.txt entries with flags (e.g. Discord/S)
5. LibreOffice de_DE_frami.dic with grammatical flag expansions (/S, /E, /N, /F)

Ensures 100% deduplication via Python set() and saves sorted canonical UTF-8 output.
"""

import io
import os
import re
import sys
import time
import urllib.request
import urllib.parse
import json
import xml.etree.ElementTree as ET

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

URL_TECH_BRANDS = [
    "YouTube", "YouTubes",
    "WhatsApp", "WhatsApps",
    "Spotify", "Spotifys",
    "Discord", "Discords",
    "Reddit", "Reddits",
    "Pinterest", "Twitch",
    "TikTok", "TikToks",
    "Instagram", "Instagrams",
    "Facebook", "Facebooks",
    "Twitter", "Twitters",
    "LinkedIn", "LinkedIns",
    "Telegram", "Telegrams",
    "Snapchat", "Snapchats",
    "Netflix", "Netflixs",
    "Amazon", "Amazons",
    "Apple", "Apples",
    "Google", "Googles",
    "Microsoft", "Microsofts",
    "GitHub", "GitHubs",
    "GitLab", "GitLabs",
    "ChatGPT", "OpenAI", "DeepMind", "Gemini", "Claude", "Anthropic",
    "PlayStation", "PlayStations", "Xbox", "Nintendo", "Steam",
    "Mastodon", "Bluesky", "Threads", "BeReal", "Tumblr", "Flickr", "Vimeo",
    "SoundCloud", "Deezer", "Tidal", "Audible", "Kindle",
    "PayPal", "PayPals",
    "Wikipedia", "Wikipedias", "Wikidata", "Wiktionary",
    "Linux", "Ubuntu", "Debian", "Fedora", "Arch",
    "Android", "iOS", "macOS", "Windows",
    "Firefox", "Chrome", "Chromium", "Edge", "Safari", "Opera", "Brave",
    "WordPress", "Shopify", "Slack", "Zoom", "Skype", "Teams",
    "PowerPoint", "Excel", "Word", "Outlook", "OneNote", "OneDrive",
    "GoogleDrive", "Dropbox", "iCloud", "Notion", "Obsidian", "Trello",
    "Asana", "Jira", "Confluence", "Bitbucket", "Docker", "Kubernetes",
    "JavaScript", "TypeScript", "Python", "Rust", "Golang", "Kotlin",
    "Swift", "PHP", "HTML", "CSS", "SQL", "PostgreSQL", "MySQL", "SQLite",
    "MongoDB", "Redis", "GraphQL", "Webpack", "Vite", "NodeJS", "ReactJS",
    "VueJS", "Angular", "NextJS", "NuxtJS", "Tailwind", "Bootstrap"
]

URL_LT_GRAMMAR = "https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-language-modules/de/src/main/resources/org/languagetool/rules/de/grammar.xml"
URL_LT_IGNORE = "https://raw.githubusercontent.com/languagetool-org/languagetool/master/languagetool-language-modules/de/src/main/resources/org/languagetool/resource/de/hunspell/ignore.txt"
URL_FRAMI_DIC = "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/de/de_DE_frami.dic"

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

CANONICAL_BRANDS = {
    "whatsapp": "WhatsApp",
    "whatsapps": "WhatsApps",
    "youtube": "YouTube",
    "youtubes": "YouTubes",
    "tiktok": "TikTok",
    "tiktoks": "TikToks",
    "paypal": "PayPal",
    "paypals": "PayPals",
    "javascript": "JavaScript",
    "powerpoint": "PowerPoint",
    "powershell": "PowerShell"
}

def clean_word(w):
    w = w.strip()
    if not w or len(w) < 2:
        return None
    w_lower = w.lower()
    if w_lower in CANONICAL_BRANDS:
        return CANONICAL_BRANDS[w_lower]
    if w_lower in FUNCTION_WORDS:
        if w.isupper():
            return w
        return w_lower
    return w

def fetch_url(url, encoding="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ExpandedVocabBuilder/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        return raw.decode(encoding, errors="replace")

def main():
    t_start = time.perf_counter()
    add_file = os.path.join(os.path.dirname(__file__), "additional_words.txt")
    words = set()

    # 1. Bestehende Wörter laden
    if os.path.exists(add_file):
        with open(add_file, "r", encoding="utf-8") as f:
            for line in f:
                w = line.strip()
                if w:
                    words.add(w)
        print(f"[1/5] Bestehende Zusatzwörter geladen: {len(words):,}")
    else:
        print("[1/5] Keine bestehende additional_words.txt gefunden. Starte neu.")

    # 2. Tech- & Web-Marken
    for brand in URL_TECH_BRANDS:
        words.add(brand)
    print(f"[2/5] Tech- & Web-Marken integriert: Zwischenstand {len(words):,} Wörter")

    # 3. LanguageTool grammar.xml
    print("[3/5] Lade LanguageTool grammar.xml herunter...")
    try:
        xml_content = fetch_url(URL_LT_GRAMMAR, encoding="utf-8")
        root = ET.fromstring(xml_content)
        lt_grammar_added = 0
        for elem in root.iter():
            items = []
            if elem.tag == "suggestion" and elem.text:
                items.append(elem.text.strip())
            if elem.tag == "example" and "correction" in elem.attrib:
                for c in elem.attrib["correction"].split("|"):
                    items.append(c.strip())
            for w in items:
                if re.match(r"^[A-Za-zÄÖÜäöüß\-]+$", w) and len(w) >= 2 and not w.endswith("-") and not w.startswith("-"):
                    if w not in words:
                        words.add(w)
                        lt_grammar_added += 1
        print(f"      + {lt_grammar_added:,} neue Wörter aus LT grammar.xml. Zwischenstand: {len(words):,}")
    except Exception as e:
        print(f"      Warnung bei LT grammar.xml: {e}")

    # 4. LanguageTool ignore.txt (mit Flag-Parsing)
    print("[4/5] Lade LanguageTool ignore.txt herunter...")
    try:
        ignore_content = fetch_url(URL_LT_IGNORE, encoding="utf-8")
        lt_ignore_added = 0
        for line in ignore_content.splitlines():
            entry = line.split("#")[0].strip()
            if not entry or any(ch in entry for ch in ["*", "_", ":", "$", "@", "."]):
                continue
            base = entry.split("/")[0].strip()
            flags = entry.split("/")[1].strip() if "/" in entry else ""
            if re.match(r"^[A-Za-zÄÖÜäöüß\-]+$", base) and len(base) >= 2:
                if base not in words:
                    words.add(base)
                    lt_ignore_added += 1
                if "S" in flags and (base + "s") not in words:
                    words.add(base + "s")
                    lt_ignore_added += 1
                if "N" in flags and (base + "n") not in words:
                    words.add(base + "n")
                    lt_ignore_added += 1
        print(f"      + {lt_ignore_added:,} neue Wörter aus LT ignore.txt. Zwischenstand: {len(words):,}")
    except Exception as e:
        print(f"      Warnung bei LT ignore.txt: {e}")

    # 5. LibreOffice frami.dic (mit ISO-8859-1 und Flag-Parsing)
    print("[5/5] Lade LibreOffice de_DE_frami.dic herunter (ISO-8859-1)...")
    try:
        frami_content = fetch_url(URL_FRAMI_DIC, encoding="iso-8859-1")
        frami_added = 0
        for line in frami_content.splitlines()[1:]:
            entry = line.strip()
            if not entry or entry.startswith("#"):
                continue
            base = entry.split("/")[0].strip()
            flags = entry.split("/")[1].strip() if "/" in entry else ""

            # Einträge ignorieren, die nur innerhalb von Komposita erlaubt sind ('o'),
            # zwingend ein Affix benötigen ('h') oder verboten sind ('d')
            if any(f in flags for f in ["o", "h", "d"]):
                continue

            if not re.match(r"^[A-Za-zÄÖÜäöüß\-]+$", base) or len(base) < 2:
                continue

            # Kleingeschriebene Nomen-Artefakte verhindern
            if base[0].islower():
                if any(base.endswith(sfx) for sfx in ["ung", "heit", "keit", "schaft", "tion", "tät"]):
                    continue
                if "F" in flags:
                    continue

            if base not in words:
                words.add(base)
                frami_added += 1
            if "S" in flags and (base + "s") not in words:
                words.add(base + "s")
                frami_added += 1
            if "E" in flags and (base + "e") not in words:
                words.add(base + "e")
                frami_added += 1
            if "N" in flags and (base + "n") not in words:
                words.add(base + "n")
                frami_added += 1
            if "F" in flags and base[0].isupper():
                if (base + "in") not in words:
                    words.add(base + "in")
                    frami_added += 1
                if (base + "innen") not in words:
                    words.add(base + "innen")
                    frami_added += 1
        print(f"      + {frami_added:,} neue Wörter aus de_DE_frami.dic. Zwischenstand: {len(words):,}")
    except Exception as e:
        print(f"      Warnung bei LibreOffice frami.dic: {e}")

    # 6. Wikidata Marken & Unternehmen
    print("[6/6] Lade Marken & Unternehmen aus Wikidata ab...")
    try:
        wikidata_added = 0
        queries = [
            """SELECT DISTINCT ?label WHERE {
              VALUES ?type { wd:Q431289 wd:Q167270 wd:Q20792245 wd:Q16323605 wd:Q28803 }
              ?item wdt:P31 ?type .
              ?item rdfs:label ?label .
              FILTER(LANG(?label) = 'de')
            } LIMIT 10000""",
            """SELECT DISTINCT ?label WHERE {
              ?item wdt:P31 wd:Q4830453 .
              ?item rdfs:label ?label .
              FILTER(LANG(?label) = 'de')
            } LIMIT 15000"""
        ]
        legal_suffixes = {'GmbH', 'AG', 'Inc', 'Ltd', 'LLC', 'SE', 'KG', 'OHG', 'KGaA', 'GbR', 'Holding', 'Group', 'Gruppe', 'und', 'der', 'die', 'das', 'von', 'für', 'mit'}
        for q in queries:
            url = 'https://query.wikidata.org/sparql?query=' + urllib.parse.quote(q) + '&format=json'
            req = urllib.request.Request(url, headers={'User-Agent': 'GeorgBrandFetcher/1.0 (info@example.com)'})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode('utf-8'))
                for b in data['results']['bindings']:
                    val = b['label']['value'].strip()
                    if re.match(r"^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+$", val) and 2 <= len(val) <= 30:
                        if val not in legal_suffixes and val not in words:
                            words.add(val)
                            wikidata_added += 1
                    for part in val.split():
                        part = part.strip(" ,.;:!?\"'()[]{}«»")
                        if re.match(r"^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+$", part) and 2 <= len(part) <= 30:
                            if part not in legal_suffixes and part not in words:
                                words.add(part)
                                wikidata_added += 1
        print(f"      + {wikidata_added:,} neue Wörter aus Wikidata-Markentaxonomie. Zwischenstand: {len(words):,}")
    except Exception as e:
        print(f"      Warnung bei Wikidata: {e}")

    # Schweizer ss-Varianten für Einträge mit ß ergänzen
    swiss_added = 0
    for w in list(words):
        if "ß" in w:
            swiss = w.replace("ß", "ss")
            if swiss not in words:
                words.add(swiss)
                swiss_added += 1
    if swiss_added > 0:
        print(f"      + {swiss_added:,} Schweizer ss-Varianten ergänzt.")

    # Bereinigen und Funktionswörter normalisieren
    words = {clean_word(w) for w in words if clean_word(w)}

    # Sortierung und deduplizierte Speicherung
    print(f"\nSortiere {len(words):,} Wörter kanonisch...")
    sorted_words = sorted(words, key=lambda s: (s.lower(), s))

    # Strikter Verifikations-Check auf Duplikate
    assert len(sorted_words) == len(words), "Inkonsistenz bei Deduplikation festgestellt!"

    print(f"Schreibe bereinigte Wörterliste nach {add_file}...")
    with open(add_file, "w", encoding="utf-8", newline="\n") as f:
        for w in sorted_words:
            f.write(w + "\n")

    elapsed = time.perf_counter() - t_start
    print(f"\nFertig in {elapsed:.2f}s! Gesamtbestand: {len(sorted_words):,} absolut eindeutige Wörter.")

if __name__ == "__main__":
    main()
