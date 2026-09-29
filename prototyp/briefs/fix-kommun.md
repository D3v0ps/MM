# Rättning: src/views/kommun.js
Läs först /home/user/MM/prototyp/briefs/_fix-common.md.
DIN FIL: src/views/kommun.js (vyer enligt tabellen i AGENTS-GUIDE.md). DITT TEST: tools/test-kommun.mjs

EXTRA PUNKTER FÖR DIN FIL:
- Små grupper i kom.chef ska visas som "färre än 5" (minN från MM.cfg().pulse.minNForAggregate), precis som beställarrapporten i rapport.visa.
- Inga förkortningar i portalen: skriv ut månader (d.fmtDateFull), "klockan" i stället för "kl.", "praktik" i stället för "APL", förklara "AI" eller undvik det, inga "exkl." eller "dnr".
- Enhetliga begrepp: deltagare, insats och ärende ska användas konsekvent (förklara en gång att ärendenumret är beställningens nummer).
- Beställningen: "tre steg och en granskning" ska stämma med stegvisaren. Skyddad beställning ska behålla uppgifterna från steg 1 (t.ex. beställarreferens) och kvittot ska ha rätt texter.
- kom.start: visa "Händelser i dina ärenden" (avböjda beställningar, byte av coach, orderbekräftelser), uppgifter till personen (st.tasks där toId === persona, t.ex. customer_decision) samt olästa rapporter och meddelanden. Avböjda ärenden får inte döljas av standardfiltret i kom.deltagare.
- Inloggning: en okänd @botkyrka.se-adress ska få beskedet att adressen inte är inbjuden; en spärrad användare (active === false) kommer inte in.
- Kommunens chef ska få texter skrivna för chefen (inte du-form till den som beställde).
- Perspektivbyten ska landa på rätt flik och i en roll med åtkomst.
