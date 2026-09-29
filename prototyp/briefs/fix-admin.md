# Rättning: src/views/admin.js
Läs först /home/user/MM/prototyp/briefs/_fix-common.md.
DIN FIL: src/views/admin.js (vyer enligt tabellen i AGENTS-GUIDE.md). DITT TEST: tools/test-admin.mjs

EXTRA PUNKTER FÖR DIN FIL:
- Revisionsloggen ska visa läsbara svenska etiketter i stället för kodvärden (t.ex. template, email, rolling_6m).
- Mallen för generisk mottagningsbekräftelse ska ha exakt samma text som det som faktiskt skickas (se src/03-domain.js case.create och seedens utskick) – eller visa båda varianterna tydligt.
- Stöd params.tab === 'jamfor' i admin.avtal (jämförelsen mellan Botkyrka och Kammarkollegiet med paketpriser) för scenario 12 steg 2.
- Rätta layout- och textfynd som gäller dina vyer.
