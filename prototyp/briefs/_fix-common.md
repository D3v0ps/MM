# Rättningsrunda efter granskning – gemensamt
Projekt: /home/user/MM/prototyp (Miljonmatch-prototyp). Läs AGENTS-GUIDE.md igen om du behöver.
Fyra granskare har skrivit fynd i /home/user/MM/prototyp/review/regler.json, scenarier.json, design.json och perspektiv.json.
UPPDRAG: Läs alla fyra filerna. Rätta VARJE fynd som gäller din fil (fältet "file" är din fil, eller "view" är en av dina vyer), plus punkterna i din egen lista nedan. Fynd som bara gäller kärnfilerna (src/0*.js, src/9*.js, styles.css) är redan hanterade av huvudagenten – men anpassa din vy om ändringen påverkar den.
Huvudagenten har redan ändrat kärnan så här (anpassa din vy):
1. sel.access: kommunens chef får 'restricted' för skyddade ärenden (bara beställande handläggare får 'customer'). Visa aldrig namnet för 'restricted' – använd sel.displayName.
2. 'report.open' kvitterar bara när aktören finns i report.deliveredTo; returnerar { acknowledged }.
3. 'report.correct' markerar inte längre den gamla versionen som ersatt; 'report.deliver' sätter prev.superseded när den nya versionen (r.previousId) levereras. Den gamla har r.correctionPending = nyttId under tiden. Kunden ska se senaste levererade versionen.
4. 'message.send' från kommunen skapar st.userNotifications (kind 'message') till huvudcoachen + e-post till coachen.
5. Avvikelse med needsCustomerDecision skapar st.tasks { toRole:'kommun_handlaggare', toId, kind:'customer_decision', caseIds, deviationId, text } och ett mejl utan personuppgifter.
6. 'case.create' med skyddade personuppgifter skapar uppgift till avtalsansvarig (kind 'protected_order'). Seedens task-2 (em-104) går nu till avtalsansvarig.
7. sel.customerSummary(mk).result.* innehåller inte längre internalTarget. sel.pulseStats({ from, to }) har slutdatum; beställarrapportens puls räknas till och med rapportmånaden.
8. sel.aiAllowed(c). 'ai.run' returnerar { error:'not_allowed' } och 'checkin.save' { error:'ai_not_allowed' } om AI används utan samtycke eller för skyddade personuppgifter.
9. Nya hjälpare: MM.valid.buyerRefLengthText() → "8–10"; d.fmtDateFull / d.fmtDateTimeFull (utan förkortningar – använd i kommunportalen); sel.avropDue läser SLA från config; sel.finalReportWorkingDays(); st.orgConfig.alerts.firstMeetingNotBookedAfterDays; st.orgConfig.billing.fortnoxWithinWorkingDays.
10. ui.Kpi har statusText och visar text + ikon för tone 'alert'/'watch'. ui.Tabs stöder piltangenter. ui.Modal håller fokus i dialogen. .badge-redfill och .sla-urgent är inte längre vit text på rött. Toppfälten är inte fastlåsta på mobil. Kommunportalen har 18 px brödtext via CSS.
11. Kallelsen går via deltagarens föredragna kontaktväg.
12. Veckorapporten vecka 4 väntar nu för både Maria (k-maria) och Linda (k-linda).
13. Mehmet är nu i fas 3 utan praktik.
14. AI-utkast till observationer bygger på underlag; utkast utan belägg har noEvidence: true, texten "Framgår inte av månadens godkända avstämningar." och aiLevelSuggestion null.
15. Scenarioändringar: s3 steg 4 öppnar sam.inkorg { latest: true }; s12 steg 2 öppnar admin.avtal { contract:'c-kk', tab:'jamfor' }; s7 steg 2 ber coachen fylla i observationerna och godkänna efter stoppet.
KRAV innan du svarar:
- node tools/check.mjs --views <dina vyer> --mobile → 0 fel.
- Uppdatera och kör ditt eget tools/test-<fil>.mjs så att det går igenom med de nya reglerna. Kör också de granskningsskript i tools/review-*.mjs som testar dina fynd om de finns, och kontrollera att problemen är borta.
- Titta på några skärmdumpar (desktop och 400 px) av det du ändrat.
- Rör bara din egen vyfil och ditt eget testskript.
Svara med en kort lista: vilka fynd (id) som är rättade, vilka som inte är det och varför.
