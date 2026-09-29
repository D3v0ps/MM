# Granskning: kundens perspektiv, perspektivbyten och datakonsistens (ditt namn: perspektiv)
Läs först /home/user/MM/prototyp/briefs/_review-common.md.
Användaren betonar att allt ska granskas från leverantörens och kundens perspektiv. Kontrollera:
1. Kundens resa hela vägen i portalen (kom.login → kom.start → kom.bestall → kom.deltagare → kom.rapporter → rapport.visa som kommunroll → kom.chef): fungerar varje steg, är det begripligt för en ovan användare, saknas något kunden rimligen behöver (enligt SPEC §7.0, §7.2, §7.11, §7.14)?
2. Varje ui.PerspectiveSwitch: leder den till rätt vy och rätt ärende/rapport, och har rollen åtkomst där? Finns det viktiga vyer som saknar perspektivbyte fast en motsvarighet finns?
3. Konsekvens mellan perspektiven: en åtgärd på ena sidan ska synas på andra (beställning i portalen → syns i avropsinkorgen; accepterat avrop → orderbekräftelse hos kommunen; levererad månadsrapport → syns och kvitteras hos kommunen; meddelande från coach → syns hos kommunen och tvärtom; "Kalla kommunen till uppföljning" → syns hos kommunen; godkänd åtgärdsplan hos kommunens chef → syns i chef.avvikelser). Testa med Playwright (tools/review-perspektiv-*.mjs).
4. Samma siffror i olika vyer: resultatgrad, antal aktiva, närvarograd, nöjdhet ska stämma mellan chef.oversikt, kom.chef och beställarrapporten (med skillnaden att kunden aldrig ser internt mål). Fakturabelopp ska stämma mellan eko.korning, eko.faktura och eko.arende.
5. Notiser och behörighet: coach får tilldelningsnotis när samordnaren accepterar ett avrop; påminnelser syns för coachen; eskaleringar bara för chef; coachens vyer (coach.*, arende.kort som coach, notiser, arenden.lista) avslöjar inte att chefen fått eskalering.
Skriv fynden till review/perspektiv.json.
