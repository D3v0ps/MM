# Rättning: src/views/inkorg.js
Läs först /home/user/MM/prototyp/briefs/_fix-common.md.
DIN FIL: src/views/inkorg.js (vyer enligt tabellen i AGENTS-GUIDE.md). DITT TEST: tools/test-inkorg.mjs

EXTRA PUNKTER FÖR DIN FIL:
- Definiera MM.sel.inboxToHandle() som returnerar exakt samma lista som fliken "Att hantera" – skalets menyräknare använder den, så att menyn, rutan och fliken visar samma tal.
- Stöd params.latest === true: välj det senast mottagna avropet som väntar på svar (scenario 3 steg 4).
- Scenario 2 steg 2: när Acceptera stoppas av saknad beställarreferens ska felet synas direkt (överst i dialogen eller scrolla till fältet och toast).
- em-104 (skyddade personuppgifter): registrering efter telefonsamtal görs av avtalsansvarig. Samordnaren ser en förklaring ("Avtalsansvarig hanterar skyddade avrop enligt den säkra rutinen") och en perspektivknapp till avtalsansvarig.
- SLA-märket får inte överlappa rubriken på sam.start (ingen fast kolumnbredd som klipper).
