# Zusätzliche Namen im Wörterbuch

Stand: 2026-10-09. `additional_names.txt` enthält 2.091 Ergänzungen zum bisherigen Wörterbuch. Die Wörter werden beim Erstellen des Wörterbuchs durch `build_dafsa.py` übernommen, ohne die Merkmale bestehender Einträge zu ändern.

Quellen:

- [LanguageTool spelling_global.txt](https://github.com/languagetool-org/languagetool/blob/master/languagetool-core/src/main/resources/org/languagetool/resource/spelling_global.txt): globale Schreibweisen, Namen und Marken.
- [Wikidata](https://www.wikidata.org/): direkte Instanzen von Software (Q7397) und Marken (Q431289) mit mindestens zehn Sitelinks; deutsche, englische und sprachunabhängige Bezeichnungen. Zusätzlich Bezeichnungen für Siri (Q582159). Wikidata-Daten stehen unter [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing).

Filter: einzelne Wörter mit 2–60 Zeichen, ausschließlich Buchstaben, Bindestriche oder Apostrophe und nur Zeichen des bisherigen Wörterbuchalphabets. Mehrteilige Namen werden nicht in Einzelwörter zerlegt. Nur bislang fehlende Schreibweisen wurden übernommen.
