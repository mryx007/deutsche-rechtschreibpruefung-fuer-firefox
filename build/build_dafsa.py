# -*- coding: utf-8 -*-
"""
Minimal Binary DAFSA Builder for DEMorphy German Morphological Dictionary.
Builds a minimal directed acyclic finite state automaton using Daciuk's algorithm
and serializes it into a compact 32-bit binary representation.
"""

import zipfile
import io
import time
import struct
import os
import sys

class DAFSANode:
    __slots__ = ('is_terminal', 'word_flags', 'edges', 'index')
    def __init__(self, is_terminal=False):
        self.is_terminal = is_terminal
        self.word_flags = 0
        self.edges = {}  # char -> DAFSANode
        self.index = 0

    def signature(self):
        return (self.is_terminal, self.word_flags, tuple(sorted((c, id(node)) for c, node in self.edges.items())))

WORD_FLAG_NOUN = 1
WORD_FLAG_LOWER_COMPOUND = 2

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

def flags_for_features(features):
    tags = features.split(',')
    pos = tags[0]
    if pos in ('NN', 'NNP'):
        return WORD_FLAG_NOUN
    if pos == 'ADJ':
        return WORD_FLAG_LOWER_COMPOUND
    if pos == 'V':
        if any(t in ('inf', 'ppast', 'ppres', 'zu') for t in tags[1:]):
            return WORD_FLAG_LOWER_COMPOUND
    return 0

def extract_demorphy_words(zip_path):
    print(f"Lese Wörter aus {zip_path}...")
    t0 = time.perf_counter()
    entries = {}
    words = set()
    lemmas = set()
    current_word = None
    
    with zipfile.ZipFile(zip_path, 'r') as z:
        with z.open('DE_morph_dict.txt') as f:
            stream = io.TextIOWrapper(f, encoding='utf-8')
            for line in stream:
                line = line.strip()
                if not line:
                    continue
                parts = line.split(' ')
                if len(parts) == 1:
                    w = parts[0]
                    if len(w) > 1 or w in 'abABszSZ':
                        words.add(w)
                        entries.setdefault(w, 0)
                        current_word = w
                else:
                    lem = parts[0]
                    if len(lem) > 1 or lem in 'abABszSZ':
                        lemmas.add(lem)
                        flag = flags_for_features(parts[1])
                        entries[lem] = entries.get(lem, 0) | flag
                        if current_word:
                            entries[current_word] = entries.get(current_word, 0) | flag

    # Zusätzliche verifizierte Wörter (z. B. Herrn, bestens, Anglizismen, etc.)
    add_path = os.path.join(os.path.dirname(__file__), 'additional_words.txt')
    if os.path.exists(add_path):
        add_count = 0
        with open(add_path, 'r', encoding='utf-8') as f:
            for line in f:
                w = line.strip()
                if not w or len(w) < 2:
                    continue
                w_lower = w.lower()
                if w_lower in FUNCTION_WORDS:
                    if not w.isupper():
                        w = w_lower
                    flag = 0
                    entries[w] = 0
                elif w.isupper():
                    flag = 0
                    entries[w] = entries.get(w, 0) | flag
                elif w[0].isupper():
                    flag = WORD_FLAG_NOUN
                    entries[w] = entries.get(w, 0) | flag
                else:
                    flag = 0
                    entries[w] = entries.get(w, 0) | flag
                words.add(w)
                add_count += 1
        print(f"  - Geladene Zusatzwörter: {add_count:,}")

    # Schweizer Schreibweise ohne Eszett ebenfalls akzeptieren.
    for word, flags in list(entries.items()):
        if 'ß' in word:
            swiss = word.replace('ß', 'ss')
            entries[swiss] = entries.get(swiss, 0) | flags

    print(f"Extrahiert in {time.perf_counter() - t0:.2f}s:")
    print(f"  - Eindeutige Wortformen: {len(words):,}")
    print(f"  - Eindeutige Lemmata:    {len(lemmas):,}")
    
    print(f"  - Gesamtvokabular:       {len(entries):,}")
    return sorted(entries.items()), len(lemmas), len(words)

def build_dafsa(sorted_words):
    print("Erzeuge minimalen DAFSA (Daciuk-Algorithmus)...")
    t0 = time.perf_counter()
    root = DAFSANode()
    register = {}
    last_word = ''

    for word_idx, (word, word_flags) in enumerate(sorted_words):
        if word_idx % 500000 == 0 and word_idx > 0:
            print(f"  {word_idx:,} / {len(sorted_words):,} ({time.perf_counter() - t0:.1f}s, register={len(register):,})")
            
        common = 0
        min_len = min(len(word), len(last_word))
        while common < min_len and word[common] == last_word[common]:
            common += 1

        curr = root
        path = [curr]
        for ch in last_word:
            curr = curr.edges[ch]
            path.append(curr)

        for i in range(len(last_word), common, -1):
            child = path[i]
            parent = path[i - 1]
            ch = last_word[i - 1]
            sig = child.signature()
            if sig in register:
                parent.edges[ch] = register[sig]
            else:
                register[sig] = child

        curr = path[common]
        for ch in word[common:]:
            nxt = DAFSANode()
            curr.edges[ch] = nxt
            curr = nxt
        curr.is_terminal = True
        curr.word_flags = word_flags
        last_word = word

    # Letzten Pfad minimieren
    curr = root
    path = [curr]
    for ch in last_word:
        curr = curr.edges[ch]
        path.append(curr)
    for i in range(len(last_word), 0, -1):
        child = path[i]
        parent = path[i - 1]
        ch = last_word[i - 1]
        sig = child.signature()
        if sig in register:
            parent.edges[ch] = register[sig]
        else:
            register[sig] = child

    print(f"DAFSA fertiggestellt in {time.perf_counter() - t0:.2f}s:")
    print(f"  - Minimale Zustände: {len(register):,}")
    return root, register

def serialize_dafsa(root, register, out_path):
    print(f"Serialisiere DAFSA nach {out_path}...")
    t0 = time.perf_counter()
    
    # 1. Alphabet ermitteln
    alphabet_set = set()
    for ch in root.edges:
        alphabet_set.add(ch)
    for node in register.values():
        for ch in node.edges:
            alphabet_set.add(ch)
            
    alphabet = "".join(sorted(list(alphabet_set)))
    char_to_id = {c: i for i, c in enumerate(alphabet)}
    print(f"  - Alphabet-Größe: {len(alphabet)} Zeichen")
    if len(alphabet) > 127:
        raise ValueError(f"Alphabet überschreitet 127 Zeichen ({len(alphabet)})!")

    # 2. BFS / Topologische Reihenfolge der Zustände zur Indexzuweisung
    # root bekommt Index 0
    ordered_nodes = [root]
    visited = {id(root)}
    queue = [root]
    
    while queue:
        curr = queue.pop(0)
        for ch, child in sorted(curr.edges.items()):
            if id(child) not in visited:
                visited.add(id(child))
                ordered_nodes.append(child)
                queue.append(child)

    # 3. Kantenindexe zuweisen
    # Jedes Node mit len(node.edges) > 0 belegt len(node.edges) 32-Bit-Einträge im transitions-Array
    current_edge_index = 0
    for node in ordered_nodes:
        if node.edges:
            node.index = current_edge_index
            current_edge_index += len(node.edges)
        else:
            node.index = 0  # Blattknoten (keine ausgehenden Kanten)

    total_transitions = current_edge_index
    print(f"  - Gesamtzahl Transitionen: {total_transitions:,}")
    if total_transitions >= (1 << 21):
        raise ValueError(f"Transitionen ({total_transitions}) überschreiten 21-Bit Adressbereich!")

    # 4. Binary Layout:
    # [uint16: alphabet_bytes_len]
    # [alphabet_utf8_bytes]
    # [padding to 4-byte alignment]
    # [uint32 array of transitions]
    #
    # Jede Transition (32 bit):
    # bits 0..6:   char_id (7 bit)
    # bit 7:       is_terminal (1 bit, bezogen auf Zielzustand)
    # bit 8:       is_last_child (1 bit, bezogen auf aktuelle Kantenliste)
    # bit 9:       Nomen/Name
    # bit 10:      Verb oder Adjektiv (zulässiges kleingeschriebenes Grundwort)
    # bits 11..31: target_node_index (21 bit)
    
    alpha_bytes = alphabet.encode('utf-8')
    header = struct.pack('<H', len(alpha_bytes)) + alpha_bytes
    pad_len = (4 - (len(header) % 4)) % 4
    header += b'\x00' * pad_len
    
    transitions = []
    for node in ordered_nodes:
        if not node.edges:
            continue
        edge_items = sorted(node.edges.items())
        num_edges = len(edge_items)
        for idx, (ch, child) in enumerate(edge_items):
            char_id = char_to_id[ch]
            is_term = 1 if child.is_terminal else 0
            is_last = 1 if (idx == num_edges - 1) else 0
            word_flags = child.word_flags if child.is_terminal else 0
            target_idx = child.index

            val = ((char_id & 0x7F) | (is_term << 7) | (is_last << 8) |
                   ((word_flags & 0x03) << 9) | ((target_idx & 0x1FFFFF) << 11))
            transitions.append(val)

    with open(out_path, 'wb') as f:
        f.write(header)
        f.write(struct.pack(f'<{len(transitions)}I', *transitions))

    file_size = os.path.getsize(out_path)
    print(f"DAFSA gespeichert in {time.perf_counter() - t0:.2f}s:")
    print(f"  - Dateigröße: {file_size / (1024 * 1024):.2f} MB ({file_size:,} Bytes)")
    return file_size, alphabet

def verify_dafsa_binary(bin_path, test_words):
    print(f"Verifiziere binären DAFSA ({bin_path})...")
    with open(bin_path, 'rb') as f:
        data = f.read()

    alpha_len = struct.unpack('<H', data[:2])[0]
    alphabet = data[2:2 + alpha_len].decode('utf-8')
    char_to_id = {c: i for i, c in enumerate(alphabet)}
    
    offset = 2 + alpha_len
    pad_len = (4 - (offset % 4)) % 4
    offset += pad_len
    
    transitions = struct.unpack(f'<{(len(data) - offset) // 4}I', data[offset:])

    def contains(word):
        if not word:
            return False
        node_idx = 0
        for i, ch in enumerate(word):
            if ch not in char_to_id:
                return False
            cid = char_to_id[ch]
            
            matched = False
            edge_idx = node_idx
            while True:
                val = transitions[edge_idx]
                if (val & 0x7F) == cid:
                    is_term = (val >> 7) & 1
                    if i == len(word) - 1:
                        return bool(is_term)
                    target = val >> 11
                    if target == 0:
                        return False
                    node_idx = target
                    matched = True
                    break
                if (val >> 8) & 1:  # is_last_child
                    break
                edge_idx += 1
                
            if not matched:
                return False
        return False

    for word, expected in test_words.items():
        res = contains(word)
        status = "OK" if res == expected else "FEHLER"
        print(f"  [{status}] '{word}': {res} (erwartet: {expected})")
        assert res == expected, f"Verifikationsfehler bei '{word}'"
        
    print("Verifikation erfolgreich abgeschlossen!")

if __name__ == '__main__':
    zip_p = 'morf_dict.zip'
    out_p = 'extension/data/german_dictionary.bin'
    
    words, num_lemmas, num_forms = extract_demorphy_words(zip_p)
    root, register = build_dafsa(words)
    file_size, alphabet = serialize_dafsa(root, register, out_p)
    
    test_suite = {
        'geparkt': True,
        'gepargt': False,
        'Auto': True,
        'Schiffahrt': True,
        'Schifffahrt': True,
        # Im Quelldatensatz steht die Präposition kleingeschrieben; die
        # Satzanfangs-Großschreibung behandelt die JavaScript-Engine.
        'Über': False,
        'Straße': True,
        'Strasse': True,
        'Haus': True,
        'Fantasiewort123': False,
        'gehen': True,
        'ging': True,
        'gegangen': True
    }
    verify_dafsa_binary(out_p, test_suite)
