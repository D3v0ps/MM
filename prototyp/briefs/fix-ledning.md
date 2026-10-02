# Rättning: src/views/ledning.js
Läs först /home/user/MM/prototyp/briefs/_fix-common.md.
DIN FIL: src/views/ledning.js (vyer enligt tabellen i AGENTS-GUIDE.md). DITT TEST: tools/test-ledning.mjs

EXTRA PUNKTER FÖR DIN FIL:
- "Så ser kommunens chef resultatet" ska visa exakt samma siffror som kom.chef visar som standard (senaste levererade beställarrapportens månad, sel.customerSummary(månad).result.rolling) och säga vilken månad.
- Staplarna för SLA-uppfyllnad och andra statusmarkeringar ska ha text och ikon, inte bara färg.
- Knappar som går utanför kort (t.ex. "Förfaller i dag…") ska rymmas.
- "Aktiva deltagare": använd samma definition som beställarrapporten eller skriv tydligt vad talet betyder ("aktiva just nu" respektive "aktiva någon gång under månaden").
