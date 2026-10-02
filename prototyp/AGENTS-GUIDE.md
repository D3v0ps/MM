# Byggmanual för vyer – Miljonmatch-prototyp

Klickbar prototyp av Miljonmatch (se `SPEC.md` och `CLAUDE-projekt.md` i samma mapp) som ska delas med MB:s chef för test och feedback.
Kärnan är klar: data, domänregler, gemensamma komponenter, skal, feedback och testscenarier. **Du bygger vyer i en egen fil under `src/views/`.**
Rör inte andra filer än din egen, utom om en uppgift uttryckligen säger det. Behöver du en ny domänfunktion: lägg den i din egen fil (t.ex. `MM.sel.minFunktion = ...` eller `MM.defineAction('dittprefix.x', ...)`).

## Viktigast: två perspektiv
Användaren vill granska allt från **två perspektiv: leverantören (Miljonbemanning) och kunden (Botkyrka kommun)**, plus deltagaren.
- Rollen styr layout automatiskt: MB-roller får sidopanel, kommunroller får den enkla portalen (18 px, en sak per skärm), deltagaren en mobilvy.
- Där en vy har en motsvarighet hos andra sidan: lägg in `html\`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.deltagare" params=${{ caseId }} />\`` (eller motsatt riktning). Välj en roll som faktiskt har åtkomst (kommunens handläggare = den som beställde, `c.referrerId === 'k-maria'`; annars `kommun_chef` som ser alla).
- Visa gärna vad den andra sidan ser eller får (t.ex. "Så här ser kommunen orderbekräftelsen", "Mejlet till kommunen innehåller bara ärendenumret").

## Teknik
- Preact + htm via globalen `htmPreact`, inga byggsteg. Allt nås via `window.MM`.
- **Varje fil är en IIFE**: `(() => { const { html, useState, useEffect, useMemo, d, fmt } = MM; const ui = MM.ui; const I = ui.Icon; const sel = MM.sel; ... })();`
- htm-syntax: komponent `html\`<${ui.Card} title="X">...<//>\``, attribut `class=`, händelser `onClick=`/`onInput=`/`onChange=`, villkor `${cond && html\`...\`}` (använd aldrig `${n && ...}` med tal – 0 renderas; skriv `${n > 0 && ...}`). Listor: `${rows.map((r) => html\`<li key=${r.id}>…</li>\`)}`.
- Registrera vyer: `MM.registerView('sam.inkorg', { title: 'Avropsinkorg', roles: ['samordnare','avtalsansvarig'], component: ({ params, role }) => html\`...\` })`. `title` får vara funktion `(params) => string`.
- Komponenten ska rendera även om `params` saknas (visa lista/tomt läge i stället för att krascha).
- Ingen `alert/confirm/prompt` (fungerar inte). Använd `await MM.confirm({ title, body, confirmLabel })`, `ui.Modal` eller inline-bekräftelse.
- Ingen nedladdning via `<a download>`. Export: `MM.download('fil.csv', text)` (öppnar spara-dialog eller visar texten att kopiera). Kopiera: `MM.copy(text)`.
- Ingen `window.print()`. PDF visas som förhandsvisning med `ui.Paper`.

## Tillstånd och åtgärder
- Läs: `const st = MM.useStore();` i komponenten (prenumererar på ändringar). `st.cases`, `st.persons` … se `tools/data-samples.json` för exakta fält.
- Ändra **bara via åtgärder**: `const res = MM.dispatch('case.accept', { ... })`. Returvärdet är åtgärdens resultat (t.ex. `{ error: 'buyer_ref' }` eller `{ reportId }`). Toasta resultatet själv: `MM.toast('Avropet är accepterat.', 'blue')` (tone `'blue'` = ok, `'red'` = fel).
- Egen åtgärd: `MM.defineAction('eko.minsak', (st, p, ctx) => { ...mutera st...; ctx.audit('billing.x', 'case', id, {...}); return {...}; })`. `ctx.now` = demoklockan, `ctx.actorId`, `ctx.id('prefix')`, `ctx.notify(channel, to, template, body, caseId)` (utskick – **aldrig personuppgifter i body**, bara ärendenummer och "logga in för att läsa"). Åtgärder måste vara deterministiska (ingen `Date.now()`/`Math.random()`) eftersom de spelas upp igen vid omladdning.
- Tidsstämplar: använd `d.now()` (demoklockan, t.ex. `'2027-02-01T09:12'`) och `d.today()`. Aldrig `new Date()` för domändata.
- Navigera: `MM.nav('arende.kort', { caseId })`. Byt roll: `MM.setRole('coach')`. Aktuell roll: `MM.role()`, persona: `MM.persona()` / `MM.currentPersonaId()`.
- Visningsloggning (revisionslogg): i deltagarkort, rapporter och transkript anropa `ui.useAuditView('case', caseId, 'case.view')`.

### Gemensamma åtgärder (finns i `03-domain.js`)
`case.create` (portal/manuell) · `case.accept` { caseId, leadCoachId, firstMeetingAt, team, plannedWeeks, buyerReference } → `{error:'buyer_ref'}` om referensen är ogiltig · `case.decline` { caseId, reason } · `case.update` { caseId, patch } · `case.setBuyerRef` { caseId, reference } · `case.bookFirstMeeting` { caseId, at } · `case.changeCoach` { caseId, toCoachId, reason } · `case.close` { caseId, endDate, endReason, verified } (skapar slutrapportutkast + exit-puls) · `email.setStatus` { emailId, status, caseId? } · `email.applySupplement` { emailId } · `attendance.set` { activityId, status, reason } (publicerar veckorapporten automatiskt när handläggarens alla deltagare är registrerade) · `checkin.save` { caseId, checkInId?, data, approve, deviation?, aiDecisions? } → `{error:'deviation_required'}` om Röd utan avvikelse · `deviation.save` · `deviation.callCustomer` { caseId, deviationId, body, proposedAt } · `assessment.save` { caseId, month, areas, summary, overallStatus, approve, plan? } → `{error:'incomplete', missing}` · `intake.save` { caseId, data, approve } · `event.add` · `result.verify` · `report.approve` · `report.deliver` · `report.correct` · `report.open` · `message.send` { caseId, body } · `message.read` { caseId } (dispatcha med `{ silent: true }`) · `alert.ack` { key, plan } · `consent.set` { caseId, value: given|declined|revoked } · `ai.run` · `billing.approveZeroWeek` { month, caseId, weekKey, note } · `billing.approveInvoice` { month, caseIds } · `billing.sendFortnox` { month, caseIds } · `billing.markManual` { month, caseId, invoiceNo } · `billing.export` { month, format } · `audit.view`.

### Selektorer (`MM.sel`, se `03-domain.js`)
`caseById, caseByNumber, caseByTag(tag), person(c), area, areaName(code), phaseName(n), phaseLabel(n), priceFor(area, date), orderValueOre(c), coaches(), teamLabel, statusLabel, endReasonLabel, END_REASONS, eventLabel, EVENT_KINDS, attLabel, ABSENCE_REASONS, reportKindLabel, reportStatusLabel, contactLabel`
`access(c, role?, pid?)` → `'full'|'team'|'restricted'|'billing'|'customer'|'none'` · `canSeeNotes(c)` · `visibleCases(role?)` · `displayName(c)` (skyddade → "Skyddade personuppgifter", ekonom → "–")
`activitiesOf, attendanceFor(activityId), checkInsOf, latestCheckIn, assessmentsOf, assessment(caseId, month), reportsOf, eventsOf, deviationsOf, placementsOf, messagesOf, intakeOf, consentOf, planOf(caseId, month), historyOf`
`attendanceStats(caseId|null, from, to)` → { planned, present, late, absentValid, absentInvalid, unregistered, reasons, rate } · `unregistered(coachId, from, to)` · `repeatedAbsence(caseId)` · `phaseSince(c)` · `stuck(c)`
`billableWeeks(c)` · `billingForMonth('2027-01')` → { invoices: [{ caseId, number, area, weeks, quantity, unitPriceOre, amountOre, vatRate, articleNo, buyerReference, orderWeeks, orderValueOre, accruedWeeks, accruedOre, remainingWeeks, remainingOre, checks: [{ kind, severity: blocking|needs_approval|approved|warning|info, label, text, weekKey? }], blocked, needsApproval, status, fortnoxNo, lineText, invoiceText }], totalOre, count, blocked, needsApproval } · `invoiceStatus(month, caseId)` · `invoiceStatusLabel` · `buyerRefProblem(c)` · `unbilledOld()`
`resultRate({ window, coachId, area, from, to })` → { value, num, den, prelim, excluded, status: ok|below_internal|below_contract|insufficient, minN, contractTarget, internalTarget } · `resultForecast()` · `resultTrend()` · `kpiValue(key, { month })` · `kpis()` · `pulseStats()`
`slaStatus(dueAt, metAt?)` → { label, tone } · `avropDue(c)` · `firstMeetingDue(c)` · `inbox()` · `deadlines({ days, coachId })` → [{ kind, label, dueAt, caseId?, reportId?, link: { view, params }, sla, bucket: overdue|today|week, provisional? }] · `alerts({ role, personaId })` → [{ key, kind, severity: critical|warning|info, title, text, caseId?, link, ack }]
`weeklyReport(recipientId, weekKey)` → { sections: [{ case, rows: [{ activity, att }], stats, paused, deviations, risk }], complete } · `customerSummary(month)` (utan internt mål, `small(n)` → "färre än 5") · `previewNextCaseNumber()` · `duplicateActive(pnr)` · `ackTextFor(c)`

### Hjälpare
`d` (datum): `now, today, addDays, addMinutes, addWorkingDays, diffDays, diffMinutes, isWorkingDay, holidayName, monday, isoWeek(s) → {year, week, key}, weekMonday(key), weekMonthKey, weeksOfMonth(mk), monthName(mk), monthEnd, addMonths, nthWorkingDay, fmtDate, fmtDateShort, fmtTime, fmtDateTime, fmtDateTimeLong, fmtWeekday, fmtWeek, fmtWeekKey, fmtWeekRange, relative`.
`fmt.kr(ore)`, `fmt.krExact(ore)`, `fmt.pct(0.339)` → "33,9 %", `fmt.num`, `MM.valid.buyerRef/buyerRefError/poNumber/pnrFormat/email`, `MM.cfg()` (avtalskonfiguration), `MM.isUnset(v)` (värdet är "ATT_FASTSTÄLLA"), `MM.by(key, dir)`, `MM.groupBy`, `MM.sum`, `MM.uniq`, `MM.cls`.

### Komponenter (`MM.ui`)
`Page({ title, eyebrow, lead, actions, crumbs:[{label, view, params}] })` · `Card({ title, icon, actions, tone: 'red'|'blue'|'sub', foot, flush })` · `Section({ title, actions })` · `Btn({ kind: primary|secondary|ghost|danger|red|blue, icon, iconRight, onClick, disabled, size:'lg', block, type, title })` · `Badge({ tone: blue|bluetone|grey|red|redfill|dark|outline|plan, icon })` · `Status({ value: green|yellow|red|null, short })` · `CaseStatus({ status })` · `Table({ columns: [{ key, label, render, num, width, nowrap }], rows, onRowClick, rowClass, empty, footer })` · `Field({ label, help, error, required, id })` + `Input/Select({options:[{value,label}]})/TextArea/Check/Seg({ value, onChange, options:[{value,label,icon,tone}], multi })` · `Tabs({ tabs:[{id,label,count,icon}], active, onChange })` · `Modal({ title, onClose, footer, wide })` · `Notice({ tone: info|warn|critical|ok, title })` · `DemoNote` (förklarar vad som är simulerat) · `Empty({ icon, title, action })` · `Kpi({ label, value, sub, tone:'alert'|'watch' })` · `Meter({ value, max, markers:[{value,label,tone}] , tone })` · `SlaBadge({ dueAt, metAt, prefix })` · `Kv({ items: [[label, value]] })` · `Avatar`, `UserName({ id })` · `MaskedPnr({ caseId })` (Visa loggas) · `PhaseBar({ phase })`, `PhaseTag({ phase })` · `BuildPhase({ fas })` (märk funktioner som byggs i fas 2–4 enligt SPEC §12) · `AiTag`, `Evidence({ quote, t })` · `Timeline({ items:[{icon,title,sub,body,tone,filled}] })` · `Stepper({ steps, current })` · `Paper({ title, info:[[k,v]], draft })` (PDF-förhandsvisning) · `PerspectiveSwitch({ role, view, params, label })` · `CaseLink({ caseId })` · `useAuditView(entity, id, action)` · `Icon({ name, size })` – namn i `MM.iconNames`.
CSS-klasser: `stack, stack-sm, stack-lg, row, row-sm, row-between, grid, grid-2, grid-3, grid-4, split, split-wide, muted, small, strong, num, nowrap, list, list-item(.clickable), li-main/li-title/li-sub/li-side, form-grid (.full), kv, chart, paper-*`. Portal: `bigbtns, bigbtn(.primary), bb-sub`. Puls: `pulse-phone, smileys, smiley`.

## Regler från CLAUDE.md som vyerna måste följa
1. **Färger**: bara MB-profilen via befintliga klasser/tokens (`var(--antracit)`, `var(--rod)`, `var(--ljusgra)`, `var(--bla)`, vitt och deras `-ton`-varianter). Inget grönt, inga andra hex-värden. Röd text bara stor och fet; blå aldrig som text på vitt. Status alltid text + ikon (`ui.Status`). Grön→blå, Gul→ljusgrå, Röd→röd.
2. Rubriker och etiketter i versaler (klasserna gör det). Klickytor minst 44 px (knapparna gör det). Allt ska gå med tangentbord; ge alla formulärfält `id` + `label`.
3. Klarspråk på svenska. Kommunportalen: korta meningar, inga förkortningar, hjälptext vid varje fält, en sak per skärm.
4. **AI föreslår – människan bedömer**: nivåer (0–3), samlad status, avslutsorsak och resultat är tomma tills coachen valt. AI-text märks `ui.AiTag` med belägg (citat + tidpunkt). Aldrig AI för skyddade ärenden.
5. **Rapporter byggs bara av godkända uppgifter** (godkända avstämningar/bedömningar).
6. **Inga personuppgifter** i e-post/SMS/notiser/URL. Personnummer visas maskerat (`ui.MaskedPnr`).
7. **Skyddade personuppgifter**: använd `sel.access`/`sel.displayName`. Ingen adress, inga SMS/mejl, ingen AI.
8. **Avtalet är konfiguration**: läs mål, SLA, priser, mönster från `MM.cfg()` / `sel.*` – hårdkoda inte 32 %, 35 %, BOT, priser. Värden `ATT_FASTSTÄLLA` visas som "Ej fastställt" med förklaring.
9. **Det interna målet 35 % visas aldrig i kundens perspektiv** (kommunens vyer, beställarrapporten).
10. Ekonom ser inga namn, anteckningar eller rapporter. Handledare bara tilldelade ärenden. Kommunen ser inte coachanteckningar (`MM.cfg().customerVisibility.seesCoachNotes === false`).
11. Fakturor: beställarreferens 8–10 siffror krävs; inköpsordernummer bara kommunens (99 + 7 siffror); ärendenumret är faktureringsobjekt; inga namn.
12. Tid Europe/Stockholm, ISO-veckor, arbetsdagar med svenska helgdagar, belopp i öre.

## Demodata och scenarier
- Demodatum måndag 2027-02-01 09.12 (vecka 5). Avtalet startade 2026-09-10. Januari är förra månaden (rapporter förfaller 5 feb, fakturering senast 3 feb).
- Scriptade ärenden: `MM.store.state.script[tag]` → caseId. Taggar: `nadia` (Amira, lager, fas 4, praktik, AI-samtycke, januaribedömning utkast), `yusuf` (Amira, upprepad ogiltig frånvaro 20 och 27 jan), `elif`, `hodan` (fas 5, arbetserbjudande), `mehmet` (AI-utkast från fredagens avstämning att granska), `amal` (fastnat i fas 1, kartläggning utkast), `skyddad` (Erik, skyddade personuppgifter), `reffel1`/`reffel2` (fel beställarreferens 55102983 – rätt är 55102938 enligt meddelande), `overlapGammal`/`overlapNy` (samma person, överlapp v. 2), `noll1`/`noll2` (veckor utan närvaro), `pausad` (v. 2 pausad), `slutsen` (slutrapport försenad), `prelim` (arbete ej verifierat), `fastnat3`, `ingetmote` (första möte inte bokat), `coachbyte`, `inkorg-mall` (em-101), `inkorg-fritext` (em-102 + komplettering em-103), `inkorg-brattom` (em-106, SLA 10.05 i dag).
- Inkorgen: `em-101` Word-mall (Maria, komplett) · `em-102` fritext med AI, saknar beställarreferens · `em-103` komplettering kopplad via ärendenummer · `em-104` skyddade personuppgifter (generisk mottagningsbekräftelse, inget ärende) · `em-105` "Övrigt" kopplat till Nadias ärende · `em-106` Word-mall, SLA-klockan går ut 10.05.
- Personor: samordnare Sara Lindqvist (`u-sara`), avtalsansvarig Johan Berg (`u-johan`), coach Amira Haddad (`u-amira`), handledare Petra Ek (`u-petra`), chef Karin Wallin (`u-karin`), ekonom Lars Nyström (`u-lars`), admin Robin Åberg (`u-robin`), kommunens handläggare Maria Ekdahl (`k-maria`), kommunens chef Eva Bergström (`k-eva`).
- Testscenarierna (se `MM.scenarios()` i `90-feedback.js`) navigerar till dina vyer med vissa params. **Stöd exakt de params som scenarierna och tabellen nedan anger.**

## Vy-id:n och ägare
| Fil | Vyer (id → params) |
|---|---|
| `views/inkorg.js` | `sam.start` · `sam.inkorg` {emailId?, caseId?} · `sam.deadlines` |
| `views/arenden.js` | `arenden.lista` {filter?: 'skyddade'|...} · `arende.kort` {caseId, tab?: oversikt|kartlaggning|avstamningar|narvaro|manad|handelser|avvikelser|praktik|rapporter|meddelanden|historik} · `hand.start` |
| `views/coach.js` | `coach.minvecka` · `coach.narvaro` {week?: 'last'|'this'} · `coach.avstamning` {caseId, checkInId?} · `coach.manad` {caseId, month} · `coach.kartlaggning` {caseId} · `coach.handelse` {caseId, mode?: 'event'|'close'} |
| `views/rapporter.js` | `rapporter.lista` {filter?} · `rapport.visa` {reportId} (även för kommunens roller – visar då kundens vy) |
| `views/ledning.js` | `chef.oversikt` {tab?: 'kpi'|'puls'|'coacher'|'omraden'} · `chef.avvikelser` {id?} |
| `views/ekonomi.js` | `eko.start` · `eko.korning` {month} · `eko.faktura` {month, caseId} · `eko.arende` {caseId} |
| `views/kommun.js` | `kom.login` · `kom.start` · `kom.bestall` · `kom.deltagare` {caseId?} · `kom.rapporter` · `kom.chef` |
| `views/admin.js` | `admin.avtal` {contract?: 'c-bot'|'c-kk'} · `admin.anvandare` · `admin.integrationer` · `admin.mallar` {tab?: 'mallar'|'logg'} · `admin.logg` · `puls.svar` · `praktik.arbetsgivare` |
Redan klart i kärnan: `om.start`, `om.fragor`.

## Testa
- Bygg: `node tools/build.mjs` (skriver `dist/index.html`).
- Röktest av dina vyer i alla tillåtna roller: `node tools/check.mjs --views sam.start,sam.inkorg --mobile`. Ska ge 0 fel. Kontrollerar felgräns, konsolfel, "undefined/NaN" i texten och horisontell scroll på 400 px.
- Egna interaktionstester med Playwright: se `tools/lib.mjs` (`openProto()`, `visit(page, role, view, params)`). Lägg dem i `tools/test-<din-fil>.mjs`. Klicka igenom dina flöden (t.ex. acceptera avrop, registrera närvaro) och kontrollera att tillståndet ändras och att inga fel uppstår.
- Skärmdumpar: `node tools/check.mjs --views x --shots /tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/shots-<fil>` och titta på dem med Read-verktyget. Kontrollera att designen håller ihop (luft, hierarki, inga överlapp).
- Montserrat laddas inte i testmiljön (reservtypsnitt) – det är normalt.

## Tillägg: notiser, påminnelser och eskalering (nytt krav från användaren)
- Coachen (och teamet) får **notis vid tilldelning** (i appen + e-post utan personuppgifter). Görs automatiskt i `case.accept` och `case.changeCoach`.
- **Påminnelse till coachen** när ett ärende saknar progression en vecka (veckomålet Nej eller ingen godkänd avstämning). **Två veckor i rad eskaleras till chef/controller.**
- **Behörighet:** varje notis har exakt en mottagare. **Coachen får aldrig se att en eskalering gått till chefen** – visa inte eskaleringar, chefens flaggor eller "eskalerad"-markeringar i coachens eller handledarens vyer. Chefen får gärna se att coachen fått påminnelser.
- Regler: `MM.store.state.orgConfig.notifications` (interna regler för MB, inte avtalskrav) – läs antal veckor och mottagare därifrån.
- Selektorer: `sel.weekProgress(c, weekKey)`, `sel.noProgressStreak(c)` → { streak, weeks:[{key, progress, reason}] }, `sel.progressionWatch({ coachId? })` → [{ case, streak, weeks, lastWeek, level: 'reminder'|'escalated' }], `sel.notificationsFor(personaId, role)`, `sel.unreadNotifications(...)`, `sel.orgRules()`. Flaggor: `sel.alerts` ger `no_progress` (coach) och `no_progress_escalated` (bara chef).
- Vyn `notiser` (klar i kärnan, `src/05-notiser.js`) visar personens notiser; länka dit vid behov.

## Tillägg: bonus och incitamentsmodell
- Incitamentsmodellen är **inte fastställd** (SPEC §3, §7.17, §13 fråga 13). `MM.cfg().bonus.enabled === false`. Visa bonus som "Avstängd – modellen ej fastställd" med `ui.BuildPhase fas={3}`, men visa att underlag samlas in (händelser med `possibleBonus: true`).

## Tillägg: fakta från upphandlingsdokumenten (avtalsutkast, AFK)
- Eskaleringstrappa (`MM.cfg().escalationLadder`): steg 0 mindre, steg 1 större, steg 2 allvarlig, steg 3 upprepat allvarlig, steg 4 hävning. Skriftliga varningar på steg 1–3; `warningsBeforeTermination` = 3. Avtalsavvikelser har fältet `escalationStep`.
- Viten: `MM.cfg().penalties` (25 000 kr per tillfälle vid avvikelse och vid bristfällig löpande information). Ekonomisk avvikelse: `MM.cfg().economicDeviation`.
- Byte av nyckelpersonal kräver kommunens godkännande (`keyPersonnelChangeRequiresApproval`) – visa det vid coachbyte/kundansvarig.
- Avtalsuppföljning: kommunen har rätt till all relevant information utan extra kostnad, fakturakontroller och egna enkäter.
- Mall 01 och mall 02 finns inte i underlaget – aktivitetstyperna i `ACTIVITY_TYPES` är exempel som ska stämmas av (märk dem så i rapportvyn).
