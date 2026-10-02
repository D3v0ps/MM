# Uppdrag: src/views/rapporter.js

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

DIN FIL: src/views/rapporter.js
DINA VYER: rapporter.lista,rapport.visa
LÄS I SPEC.md: §7.6 (veckorapport), §7.11 a–f, §7.4 (orderbekräftelse)

UPPDRAG:
rapporter.lista {filter?} – roller: samordnare, avtalsansvarig, coach, chef. Lista över rapporter (st.reports) som rollen får se (coach: egna ärenden), filter på typ, status och period, livscykel utkast → granskad → godkänd → levererad → kvitterad (ui.Badge), förfallotid (märk "Ej fastställd deadline" när provisionalDue), version. Sammanfattning överst: försenade, förfaller denna vecka, väntar på godkännande.
rapport.visa {reportId} – roller: samordnare, avtalsansvarig, coach, handledare, chef, kommun_handlaggare, kommun_chef. ui.useAuditView('report', reportId, 'report.view'). Rendera som PDF-förhandsvisning med ui.Paper (logotyp överst, avtals- och ärendeinformation i högerställt block, versala rubriker) beroende på kind:
- monthly: "Månadsrapport individ" enligt mall 02 avsnitt 1–8 (se SPEC §7.11 c-tabellen): 1 Grunduppgifter (namn + ärendenummer, aldrig personnummer), 2 Närvaro och frånvaro per ISO-vecka i månaden (sel.attendanceStats per vecka), 3 Genomförda aktiviteter (kryss per aktivitetstyp från GODKÄNDA avstämningar + dokumentationstext; märk aktivitetstyperna "exempel – stäms av mot mall 02"), rubriken "4. Progression" (ta med numret) från GODKÄND månadsbedömning, 5 Resultat/utfall (händelser i månaden), 6 Avvikelse, risk och åtgärd (+ "Behöver beslut/stöd från kommunen?"), 7 Plan för nästa månad, 8 Coachens sammanfattande bedömning (samlad status med text, sammanfattning, ansvarig coach och datum, rapporteringsprincipen som fast text). Om månadsbedömningen inte är godkänd: vattenstämpel "Utkast", visa inga ej godkända uppgifter och blockera godkännande med länk till coach.manad.
- final: "Slutrapport" med samma struktur för hela perioden plus resultat, kvarstående hinder och rekommenderad fortsättning.
- weekly_attendance: "Veckorapport närvaro" per handläggare och vecka (sel.weeklyReport(recipientUserId, week)): sektion per deltagare med planerade tillfällen, närvaro, frånvaro med orsak (bara kategori), åtgärd vid ogiltig frånvaro, risk. Status 'waiting' = väntar på närvaroregistrering (visa vilka som saknas).
- order_confirmation: "Orderbekräftelse": startdatum, huvudcoach, första möte, planerad omfattning i veckor, beställningens värde (veckor × veckopris från sel.priceFor).
- customer_summary: "Beställarrapport" (sel.customerSummary(month)): deltagare aktiva/nya/avslutade per område och yrkesspår, resultat (antal, andel, rullande och sedan start, mot avtalsmålet – ALDRIG internt mål), progression, närvarograd, avvikelser, nöjdhet, sammanfattning (AI-utkast som avtalsansvarig godkänner). Grupper under 5 → "färre än 5". SLA-statistik bara om seesSlaStats.
Åtgärder per roll: coach – "Godkänn" (report.approve) när underlaget är godkänt; samordnare – valfri kvalitetsgranskning; coach/samordnare/avtalsansvarig – "Leverera till kommunen" (report.deliver; visa att leveransen sker i portalen och att mejlet bara innehåller en notis utan personuppgifter, bilaga i e-post är avstängt enligt MM.cfg().reportDelivery) och "Rätta" (report.correct → ny version, den gamla sparas). Avtalsansvarig godkänner beställarrapporten. Kommunens roller: ser bara levererade rapporter, inga interna knappar eller anteckningar; första visningen kvitterar (MM.dispatch('report.open', {reportId})). PDF-nedladdning finns inte i prototypen (förklara: PDF skapas med react-pdf i skarp drift). ui.PerspectiveSwitch: MB → kundens vy (kommun_handlaggare om mottagaren/referrer är 'k-maria', annars kommun_chef) och kund → leverantörens vy (coach eller avtalsansvarig). Exportera även MM.reports = { ReportDocument } så andra vyer kan återanvända renderingen.

När du är klar: svara med en kort rapport (fil, vilka vyer som är klara, åtgärder du definierat, resultatet av tools/check.mjs och ditt interaktionstest, kända brister).
