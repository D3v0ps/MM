# Rättning: src/views/coach.js
Läs först /home/user/MM/prototyp/briefs/_fix-common.md.
DIN FIL: src/views/coach.js (vyer enligt tabellen i AGENTS-GUIDE.md). DITT TEST: tools/test-coach.mjs

EXTRA PUNKTER FÖR DIN FIL:
- Ta bort alla omnämnanden av eskalering till chef i coachens vyer (även förklaringstexter). Prototyplänkar får finnas om de tydligt är märkta "Prototyp:".
- AI-förslag från inklistrade anteckningar ska bygga på texten: t.ex. "sjuk hela veckan" → veckomål Nej, arbetsgivarkontakter 0; det som inte framgår → "Framgår inte" utan förslag.
- Scenario 5: avvikelsen får inte vara förifylld – kravet ska synas som ett stopp när coachen väljer Röd och försöker godkänna.
- Hantera AI-utkast med noEvidence (visa "Framgår inte", inget nivåförslag).
- Min vecka: visa olästa meddelanden från kommunen (sel.notificationsFor, kind 'message').
- "Ändra" på ett AI-förslag: logga 'edited' när värdet ändrats, annars 'accepted' – och visa det tydligt.
- Rätta layoutfynd (Bedöm-knappen utanför skärmen på mobil, AI-förslaget i versaler på fyra rader, pluralformer som "1 godkända").
