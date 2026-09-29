# Uppdrag: src/views/ekonomi.js

Du bygger en del av en klickbar prototyp av "Miljonmatch" (plattform för arbetsmarknadsinsatser, Miljonbemanning AB, avtal med Botkyrka kommun).
Projektmapp: /home/user/MM/prototyp. Läs FÖRST hela /home/user/MM/prototyp/AGENTS-GUIDE.md (byggmanualen – följ den exakt) och de delar av /home/user/MM/prototyp/SPEC.md som nämns nedan. Projektreglerna finns i /home/user/MM/prototyp/CLAUDE-projekt.md.
Kärnan är klar: src/00-core.js, 01-seed.js, 02-store.js, 03-domain.js, 04-ui.js, 05-notiser.js, 90-feedback.js, 99-shell.js och styles.css. Läs 03-domain.js och 04-ui.js för att se exakt vilka selektorer, åtgärder och komponenter som finns, och tools/data-samples.json för datafält.
REGLER:
- Skriv BARA i din egen fil (anges nedan) och eventuellt tools/test-<filnamn>.mjs. Ändra inga andra filer. Behöver du en ny åtgärd eller selektor: definiera den i din egen fil med ett prefix som inte krockar.
- All text på svenska, klarspråk. Kommunens portal: korta meningar, inga förkortningar, hjälptext vid varje fält, en sak per skärm.
- Användaren vill granska allt från två perspektiv: leverantören (Miljonbemanning) och kunden (Botkyrka kommun). Där din vy har en motsvarighet hos andra sidan, lägg in ui.PerspectiveSwitch och visa gärna vad andra sidan ser eller får.
- Följ design- och dataskyddsreglerna i guiden (MB-färger via klasser/tokens, status med text + ikon, 44 px klickytor, inga personuppgifter i utskick, skyddade personuppgifter, AI föreslår – människan bedömer, rapporter bara från godkända uppgifter, avtalsvärden från MM.cfg(), 35 % aldrig i kundens perspektiv, coachen ser aldrig eskaleringar till chef).
- Märk funktioner som byggs efter fas 1 med ui.BuildPhase och förklara simulerade delar med ui.DemoNote.
- Designkvalitet: det här ska visas för en chef. Tydlig hierarki (sammanfattning före detalj), luftigt men effektivt, konsekventa kort och tabeller, fungerar på 400 px bredd utan horisontell scroll (bred tabell ska ligga i .table-wrap).
- Använd realistiska svenska texter, inga platshållare som "Lorem" eller "TODO".
TESTA innan du svarar:
1. node tools/check.mjs --views <dina vy-id:n kommaseparerade> --mobile  → ska ge 0 fel.
2. Skriv tools/test-<filnamn>.mjs som med Playwright (import { openProto, visit } from './lib.mjs') klickar igenom dina viktigaste flöden (formulär, knappar, åtgärder) och kontrollerar att tillståndet ändras (via page.evaluate mot MM.store.state) och att inga fel uppstår. Kör den tills den går igenom.
3. Ta skärmdumpar (node tools/check.mjs --views ... --shots /tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/shots-<filnamn>) och titta på några med Read-verktyget (desktop och mobil). Rätta designproblem du ser.
Svara med en saklig sammanfattning i det strukturerade formatet.

DIN FIL: src/views/ekonomi.js
DINA VYER: eko.start,eko.korning,eko.faktura,eko.arende
LÄS I SPEC.md: §3 (fakturering), §4 (ekonom), §7.0 (ekonom), §7.15

UPPDRAG:
Roll: ekonom (Lars Nyström). Ekonomen ser ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag – INGA namn, anteckningar eller rapporter (sel.displayName ger '–'). Förklara det kort i vyn.
eko.start – översikt: fakturakörningar per månad (st.billingRuns + sel.billingForMonth för summor och status per månad), januari-körningen som ska vara i Fortnox senast 3 arbetsdagar efter månadsskiftet, ärenden som saknar eller har fel beställarreferens (sel.buyerRefProblem), veckor utan närvaro att kontrollera, ofakturerade veckor äldre än 45 dagar (sel.unbilledOld) med varning om preskription två månader efter utfört arbete, returnerade decemberfakturor, Fortnox-synk (ui.BuildPhase fas 2), uppgifter till ekonom (st.tasks där toRole === 'ekonom').
eko.korning {month} – körningen för en månad: sammanfattning (antal fakturor, total, stoppade, kräver godkännande, veckor), förklaring av månadstillhörighet (veckan faktureras i den månad där torsdagen infaller – vecka 53 2026 hör till december) och att samlingsfakturor inte är tillåtna (MM.cfg().billing.collectiveInvoiceAllowed). Tabell: en rad per faktura (ärendenummer, område, veckor, antal, pris, belopp, beställarreferens med giltighet, status, kontrollikoner) med filter Alla / Stoppade / Kräver godkännande / Klara och paginering. Radens detalj: kontroller med åtgärder – rätta beställarreferens (inmatning med MM.valid.buyerRefError; case.setBuyerRef; uppgiften från avtalsansvarig i st.tasks innehåller rätt referens), godkänn vecka utan närvaro med kommentar (billing.approveZeroWeek), visa överlapp och pausade veckor. Masshandlingar: "Godkänn alla utan anmärkning" (billing.approveInvoice), "Skapa i Fortnox" (billing.sendFortnox – simulerat, ui.BuildPhase fas 2; statusflöde skapad → bokförd → skickad → betald; idempotens – en omkörning skapar inga dubbletter), reservväg "Exportera underlag (CSV)" via MM.download (och billing.export för loggning) och "Markera som manuellt fakturerad" med fakturanummer (billing.markManual). Stoppade fakturor kan inte skapas.
eko.faktura {month, caseId} – förhandsvisning av en faktura (Peppol BIS Billing 3 via Fortnox): säljare Miljonbemanning AB, köpare Botkyrka kommun, BuyerReference = beställarreferensen, OrderReference tom (bara kommunens inköpsordernummer 99xxxxxxx får stå där – aldrig ärendenumret), faktureringsobjekt = ärendenummer, rader (artikel per område, antal veckor, beskrivning t.ex. "BOT-26-0142 · v. 1–4 2027", à-pris, moms per artikel), summor exkl. och inkl. moms (öre till kronor), betalningsvillkor 30 dagar, bankgiro hämtas från Fortnox, fakturatext med upparbetat och återstående (inv.invoiceText). Fältmappningstabell: Fortnox "Er referens" → BuyerReference, "Ert ordernummer" → OrderReference (ska bekräftas med Botkyrkas e-handel innan skarp drift). Inga namn eller personnummer.
eko.arende {caseId} – ekonomens ärendevy: ärendenummer, område, start/slut, pausade veckor, debiterbara veckor per månad (sel.billableWeeks) med fakturastatus, beställarreferens, beställningens värde, upparbetat och återstående. Inga namn.

När du är klar: svara med en kort rapport (fil, vilka vyer som är klara, åtgärder du definierat, resultatet av tools/check.mjs och ditt interaktionstest, kända brister).
