# Rättning: src/views/rapporter.js
Läs först /home/user/MM/prototyp/briefs/_fix-common.md.
DIN FIL: src/views/rapporter.js (vyer enligt tabellen i AGENTS-GUIDE.md). DITT TEST: tools/test-rapporter.mjs

EXTRA PUNKTER FÖR DIN FIL:
- Levererade rapporter ska vara frysta: spara ett snapshot av rapportens innehåll när den levereras (definiera egen åtgärd som körs direkt efter report.deliver) och rendera därifrån. För seedade levererade rapporter utan snapshot: bygg innehållet bara av uppgifter som fanns vid leveransen (t.ex. närvaro med registeredAt <= deliveredAt, avstämningar med approvedAt <= deliveredAt) så att en senare ändring inte ändrar en levererad version 1.
- Genererade texter (rekommendation, sammanfattning) i levererade rapporter ska vara lagrade/frysta, inte skapas vid visning.
- Handledare får inte se månads- och slutrapporter (bedömningar och samlad status) – visa en tydlig ingen-åtkomst-förklaring.
- Kunden ser senaste levererade versionen även medan en rättelse är utkast.
- Kvittens: visa "Kvitteras bara av mottagaren" när en annan kommunanvändare läser rapporten.
- Skyddade ärenden: kommunens chef ser aldrig namnet (sel.displayName).
