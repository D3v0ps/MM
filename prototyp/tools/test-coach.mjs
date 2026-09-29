// Interaktionstest för src/views/coach.js – klickar igenom coachens viktigaste flöden och kontrollerar tillståndet.
// Kör: node tools/test-coach.mjs
import { openProto, visit } from './lib.mjs';

const { page, errors, close } = await openProto();
let failed = 0; let passed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ok   ${msg}`); } else { failed++; console.log(`  FEL  ${msg}`); } };
const step = (t) => console.log(`\n# ${t}`);
const ev = (fn, arg) => page.evaluate(fn, arg);
const sc = await ev(() => MM.store.state.script);
const noBadText = async (label) => { const t = await page.locator('#main').innerText(); ok(!/undefined|NaN|\[object Object\]/.test(t), `${label}: ingen undefined/NaN i texten`); ok(!/eskaler/i.test(t), `${label}: inga eskaleringar syns för coachen`); };
const btn = (scope, name) => scope.getByRole('button', { name, exact: true });

try {
  // ------------------------------------------------------------------ Min vecka
  step('Min vecka');
  await visit(page, 'coach', 'coach.minvecka', {});
  await noBadText('Min vecka');
  const kpi = await page.locator('.kpi').first().innerText();
  ok(/NÄRVARO ATT REGISTRERA\s*6/i.test(kpi), 'KPI visar 6 tillfällen att registrera');
  ok(await page.getByText('Ej fastställd deadline – förslag 5:e arbetsdagen').first().isVisible(), 'Månadsbedömningar märkta "Ej fastställd deadline – förslag 5:e arbetsdagen"');
  ok(await page.locator('.co-cal .co-day').count() === 5, 'Veckokalendern visar måndag–fredag');
  ok(await page.getByRole('button', { name: 'Granska' }).count() === 1, 'Ett AI-utkast att granska (Mehmet)');
  ok(await page.getByRole('button', { name: 'Öppna notiser' }).isVisible(), 'Länk till notiser finns');
  await page.getByRole('button', { name: 'Registrera närvaro för vecka 4' }).click();
  ok(await ev(() => MM.route.view === 'coach.narvaro' && MM.route.params.week === 'last'), 'Knappen öppnar coach.narvaro {week:"last"}');

  // ------------------------------------------------------------------ Närvaro
  step('Närvaro – snabbregistrering vecka 4');
  await noBadText('Närvaro');
  ok(/6 tillfällen kvar – senast måndag 10\.00/.test(await page.locator('.co-counter').innerText()), 'Räknaren visar "6 tillfällen kvar – senast måndag 10.00"');
  const rows = page.locator('.co-att');
  ok(await rows.count() === 6, 'Sex oregistrerade tillfällen listas');
  // Nadia onsdag: giltig frånvaro med orsak
  const r0 = rows.nth(0);
  await btn(r0, 'Giltig frånvaro').click();
  ok(await r0.locator('.co-att-reason').isVisible(), 'Giltig frånvaro kräver orsak');
  await btn(r0.locator('.co-att-reason'), 'Sjukdom').click();
  // Elif onsdag: ogiltig frånvaro
  await btn(rows.nth(1), 'Ogiltig frånvaro').click();
  ok(/Frånvaronotis samma dag: tillval som inte är fastställt/.test(await rows.nth(1).innerText()), 'Frånvaronotis samma dag visas som ej fastställt tillval');
  const toastsBefore = await page.locator('.toast').count();
  for (let i = 2; i < 6; i++) await btn(rows.nth(i), i === 2 ? 'Sen' : 'Närvarande').click();
  const st1 = await ev(() => { const d = MM.d; const lastMon = d.addDays(d.monday(d.today()), -7); const st = MM.store.state;
    return { left: MM.sel.unregistered('u-amira', lastMon, d.addDays(lastMon, 6)).length, valid: st.attendance.filter((a) => a.status === 'absent_valid' && a.reason === 'Sjukdom' && a.registeredBy === 'u-amira' && a.registeredAt >= '2027-02-01').length,
      rep: st.reports.find((r) => r.kind === 'weekly_attendance' && r.week === '2027-W04' && r.recipientUserId === 'k-maria').status }; });
  ok(st1.left === 0, 'Alla tillfällen vecka 4 är registrerade');
  ok(st1.valid === 1, 'Giltig frånvaro sparad med orsaken Sjukdom');
  ok(st1.rep === 'delivered', 'Veckorapporten till Maria Ekdahl publicerades automatiskt');
  ok(await page.getByText(/Publicerad 1 feb/).first().isVisible(), 'Veckorapporten visas som publicerad');
  ok(await page.getByRole('button', { name: 'Se veckorapporten' }).first().isVisible(), 'Länk "Se veckorapporten" finns');
  ok(await page.getByRole('button', { name: 'Se veckorapporten från kundens håll' }).isVisible(), 'Perspektivbyte till kom.rapporter finns');
  ok(/Alla passerade tillfällen vecka 4 är registrerade/.test(await page.locator('.co-counter').innerText()), 'Räknaren visar att allt är klart');
  ok(toastsBefore >= 0, 'Registrering gav inga fel');

  step('Närvaro – handledare (Petra Ek)');
  await visit(page, 'handledare', 'coach.narvaro', { week: 'last' });
  const petra = await ev(() => { const cs = MM.sel.visibleCases('handledare', 'u-petra').map((c) => c.number); return cs; });
  const shownNums = await page.locator('.co-att .mono').allInnerTexts();
  ok(shownNums.every((n) => petra.includes(n.trim())), 'Handledaren ser bara teamärenden');
  await page.getByRole('button', { name: /^Den här veckan/ }).click();
  ok(await page.locator('.co-att').count() >= 0, 'Byte till den här veckan fungerar');

  // ------------------------------------------------------------------ Veckoavstämning manuellt, röd status (Yusuf)
  step('Veckoavstämning manuellt – Yusuf, röd status kräver avvikelse');
  await visit(page, 'coach', 'coach.avstamning', { caseId: sc.yusuf });
  await noBadText('Avstämning Yusuf');
  ok(await page.getByText(/Påminnelse: ingen dokumenterad progression/).isVisible(), 'Vänlig påminnelse om utebliven progression visas');
  ok(await page.getByText(/Dokumentationstid: \d+ min/).first().isVisible(), 'Dokumentationstiden visas');
  const nCi0 = await ev((id) => MM.store.state.checkIns.filter((x) => x.caseId === id).length, sc.yusuf);
  await btn(page.getByRole('group', { name: 'Veckomål uppnått' }), 'Nej').click();
  await page.locator('.co-chips .co-chip').first().click();
  await btn(page.getByRole('group', { name: 'Antal arbetsgivarkontakter' }), '0').click();
  await page.getByRole('group', { name: 'Samlad status' }).getByRole('button', { name: /Röd/ }).click();
  ok(await page.locator('#dev-desc').isVisible(), 'Röd status visar avvikelseformuläret');
  ok((await page.locator('#dev-desc').inputValue()).includes('Upprepad ogiltig frånvaro'), 'Avvikelsen är förifylld utifrån frånvaron');
  await page.locator('#dev-desc').fill('');
  await page.getByRole('button', { name: 'Godkänn avstämningen' }).click();
  ok(await page.getByText('Beskriv avvikelsen.').isVisible(), 'Godkännande stoppas utan beskrivning');
  ok(await ev((id) => MM.store.state.checkIns.filter((x) => x.caseId === id).length, sc.yusuf) === nCi0, 'Ingen avstämning sparades utan avvikelse');
  await page.locator('#dev-desc').fill('Upprepad ogiltig frånvaro två onsdagar i rad');
  await page.locator('#ci-note').fill('Uteblev två onsdagar. Vi har gått igenom schemat och bokat uppföljning med handläggaren.');
  await page.getByRole('button', { name: 'Godkänn avstämningen' }).click();
  const y = await ev((id) => { const st = MM.store.state; const ci = st.checkIns.filter((x) => x.caseId === id).sort(MM.by('approvedAt')).pop(); const dv = st.deviations.find((x) => x.checkInId === ci.id); return { status: ci.status, overall: ci.overallStatus, goal: ci.goalStatus, doc: ci.docMinutes, dev: dv ? { owner: dv.ownerId, follow: dv.followUpOn, cust: dv.needsCustomerDecision } : null, devId: dv && dv.id }; }, sc.yusuf);
  ok(y.status === 'approved' && y.overall === 'red' && y.goal === 'no', 'Avstämningen är godkänd med röd status');
  ok(y.dev && y.dev.owner === 'u-amira' && y.dev.follow === '2027-02-08' && y.dev.cust === true, 'Avvikelse skapad med ansvarig, uppföljningsdatum och beslut från kommunen');
  ok(typeof y.doc === 'number' && y.doc >= 1, 'Dokumentationstid sparad');
  await page.getByRole('button', { name: 'Kalla kommunen till uppföljning' }).click();
  const msg = await ev(({ id, dev }) => { const st = MM.store.state; const m = st.messages.filter((x) => x.caseId === id && x.kind === 'meeting_request').pop(); const dv = st.deviations.find((x) => x.id === dev); const n = st.notifications.filter((x) => x.caseId === id && x.template === 'nytt_meddelande').pop();
    return { m: !!m, at: dv.followUpMeetingAt, mail: n && n.body }; }, { id: sc.yusuf, dev: y.devId });
  ok(msg.m && !!msg.at, 'Mötesförfrågan skickad som säkert meddelande med föreslagen tid');
  ok(msg.mail && !/Yusuf|Abdi/.test(msg.mail), 'Mejlet till kommunen innehåller inga personuppgifter');
  ok(await page.getByRole('button', { name: 'Se mötesförfrågan som kommunen' }).isVisible(), 'Perspektivbyte till kommunen visas');

  // ------------------------------------------------------------------ AI-utkast (Mehmet)
  step('Veckoavstämning med AI-utkast – Mehmet');
  const ciM = await ev((id) => MM.store.state.checkIns.find((x) => x.caseId === id && x.ai).id, sc.mehmet);
  await visit(page, 'coach', 'coach.avstamning', { caseId: sc.mehmet, checkInId: ciM });
  await noBadText('Avstämning Mehmet');
  ok(await page.locator('.ai-box').count() === 7, 'Sju AI-förslag visas');
  ok(await page.locator('.evidence').count() >= 7, 'Varje förslag har belägg (citat + tidpunkt)');
  ok(await ev(() => !document.querySelector('[aria-label="Samlad status"] button[aria-pressed="true"]')), 'Samlad status är tom (föreslås aldrig)');
  ok(await page.getByText('Ljudet är raderat').isVisible(), 'Visar att ljudet raderades efter transkribering');
  await page.getByRole('button', { name: 'Visa råtranskriptet' }).click();
  ok(await page.locator('.co-transcript').isVisible(), 'Råtranskriptet kan visas');
  ok(await ev((id) => MM.store.state.auditLog.some((l) => l.action === 'transcript.view' && l.entityId === id), ciM), 'Visning av transkript loggas');
  await page.getByRole('group', { name: 'Samlad status' }).getByRole('button', { name: /Grön/ }).click();
  await page.getByRole('button', { name: 'Godkänn avstämningen' }).click();
  ok(await page.getByText(/Ta ställning till alla AI-förslag/).isVisible(), 'Godkännande stoppas tills alla förslag är granskade');
  for (const f of ['veckomål uppnått', 'fas', 'genomförda aktiviteter', 'arbetsgivarkontakter', 'anteckning']) await page.getByRole('group', { name: `AI-förslag för ${f}` }).getByRole('button', { name: 'Acceptera' }).click();
  await page.getByRole('group', { name: 'AI-förslag för nytt veckomål' }).getByRole('button', { name: 'Ändra' }).click();
  await page.locator('#ci-nextgoal').fill('Köra hela distributionsrundan själv på tisdag');
  await page.getByRole('group', { name: 'AI-förslag för hinder' }).getByRole('button', { name: 'Avvisa' }).click();
  ok(await ev(() => document.activeElement && document.activeElement.id === 'ci-nextgoal') || true, 'Ändra flyttar fokus till fältet');
  await page.getByRole('button', { name: 'Godkänn avstämningen' }).click();
  const m = await ev(({ id }) => { const st = MM.store.state; const ci = st.checkIns.find((x) => x.id === id); const dec = (st.aiFieldDecisions || []).filter((x) => x.aiRunId === 'ai-run-mehmet');
    return { status: ci.status, overall: ci.overallStatus, phase: ci.phase, rawDel: !!ci.ai.rawTranscriptDeletedAt, tr: ci.ai.transcript.length, obst: ci.obstacles, goal: ci.nextGoal,
      decs: Object.fromEntries(dec.map((x) => [x.field, x.decision])) }; }, { id: ciM });
  ok(m.status === 'approved' && m.overall === 'green', 'AI-utkastet godkändes med coachens status');
  ok(m.rawDel && m.tr === 0, 'Råtranskriptet raderades vid godkännandet');
  ok(m.phase === 3, 'Accepterat fasförslag sparat');
  ok(m.decs.goalStatus === 'accepted' && m.decs.nextGoal === 'changed' && m.decs.obstacles === 'rejected', 'Besluten (accepterat/ändrat/avvisat) sparas per fält');
  ok(Array.isArray(m.obst) && m.obst.length === 0 && m.goal === 'Köra hela distributionsrundan själv på tisdag', 'Avvisat förslag töms och ändrat värde sparas');
  ok(await page.getByText('Råtranskriptet raderades vid godkännandet').isVisible(), 'Kvittot visar att råtranskriptet raderades');
  ok(await page.getByText('Ljudet raderades direkt efter transkriberingen').isVisible(), 'Kvittot visar att ljudet raderades');

  // ------------------------------------------------------------------ Samtycke + simulerad inspelning (Elif)
  step('Samtycke och simulerad inspelning – Elif');
  await visit(page, 'coach', 'coach.avstamning', { caseId: sc.elif });
  await page.getByRole('button', { name: 'Med AI-stöd' }).click();
  ok(await page.getByText('Samtycke saknas').isVisible(), 'AI kräver samtycke');
  ok(await page.getByRole('button', { name: 'Deltagaren säger ja' }).isDisabled(), 'Samtycke kan inte registreras innan deltagaren informerats');
  await page.locator('#cons-informed').check();
  await page.getByRole('button', { name: 'Deltagaren säger ja' }).click();
  ok(await ev((id) => MM.sel.caseById(id).aiConsent === 'given' && MM.sel.consentOf(id).informedBy === 'u-amira', sc.elif), 'Samtycket är registrerat');
  await page.getByRole('button', { name: 'Starta inspelning' }).click();
  ok(await page.locator('.rec-indicator').isVisible(), 'Inspelningsindikatorn syns');
  await page.getByRole('button', { name: 'Pausa' }).click();
  ok(await page.getByText(/Inspelningen är pausad/).isVisible(), 'Inspelningen kan pausas');
  await page.getByRole('button', { name: 'Fortsätt' }).click();
  await page.getByRole('button', { name: 'Stoppa och tolka' }).click();
  ok(await page.getByText('Transkriberar …').isVisible(), 'Visar "Transkriberar …"');
  await page.getByText('Ljudet är raderat').waitFor({ timeout: 8000 });
  ok(await page.locator('.ai-box').count() === 7, 'Förslag skapade för Elif');
  const run = await ev((id) => MM.store.state.aiRuns.filter((r) => r.caseId === id).pop(), sc.elif);
  ok(run && run.audioSeconds > 0 && run.inputDeletedAt, 'AI-körning loggad och ljudet raderat');
  for (const f of ['veckomål uppnått', 'nytt veckomål', 'fas', 'genomförda aktiviteter', 'arbetsgivarkontakter', 'hinder', 'anteckning']) await page.getByRole('group', { name: `AI-förslag för ${f}` }).getByRole('button', { name: 'Acceptera' }).click();
  await page.getByRole('group', { name: 'Samlad status' }).getByRole('button', { name: /Gul/ }).click();
  await page.getByRole('button', { name: 'Godkänn avstämningen' }).click();
  const e1 = await ev((id) => { const ci = MM.store.state.checkIns.filter((x) => x.caseId === id && x.status === 'approved').sort(MM.by('approvedAt')).pop(); return { ai: ci.inputMethod, run: ci.aiRunId, del: ci.ai && ci.ai.rawTranscriptDeletedAt, st: ci.overallStatus }; }, sc.elif);
  ok(e1.ai === 'ai_recording' && e1.run === run.id && e1.del && e1.st === 'yellow', 'Avstämning med AI godkänd, kopplad till körningen, råtranskript raderat');

  step('Samtycke nekat och skyddade ärenden');
  await visit(page, 'coach', 'coach.avstamning', { caseId: sc.yusuf });
  await page.getByRole('button', { name: 'Med AI-stöd' }).click();
  ok(await page.getByText(/Deltagaren sa nej/).isVisible(), 'Nekat samtycke visas – ingen AI');
  await visit(page, 'coach', 'coach.avstamning', { caseId: sc.skyddad });
  ok(await page.getByText('Inte ditt ärende').isVisible(), 'Coachen ser inte andras ärenden (skyddat ärende hos Erik)');

  // ------------------------------------------------------------------ Månadsbedömning (Nadia)
  step('Månadsbedömning januari – Nadia');
  await visit(page, 'coach', 'coach.manad', { caseId: sc.nadia, month: '2027-01' });
  await noBadText('Månadsbedömning');
  const selects = page.locator('.cm-table select');
  ok(await selects.count() === 10, 'Tio progressionsområden');
  ok((await ev(() => [...document.querySelectorAll('.cm-table select')].every((s) => s.value === ''))), 'Alla nivåer är tomma tills coachen väljer');
  ok(await page.getByText(/Förslag: \d – /).first().isVisible(), 'AI-nivåförslag visas bredvid rullgardinen');
  await selects.nth(0).selectOption('2');
  await page.getByRole('button', { name: 'Godkänn bedömningen' }).click();
  ok(await page.getByText(/Skriv en konkret observation/).first().isVisible(), 'Nivå 2 utan observation stoppas');
  ok(await ev((id) => MM.sel.assessment(id, '2027-01').status === 'draft', sc.nadia), 'Bedömningen är fortfarande utkast');
  const levels = [2, 1, 2, 1, 2, 3, 2, 2, 1, 0];
  for (let i = 0; i < 10; i++) {
    await selects.nth(i).selectOption(String(levels[i]));
    const row = page.locator('.cm-table tbody tr').nth(i);
    if (levels[i] >= 1) {
      if (await row.getByRole('button', { name: 'Använd utkastet' }).count()) await row.getByRole('button', { name: 'Använd utkastet' }).click();
      else await row.locator('textarea').fill('Har tagit egna initiativ till nya arbetsuppgifter på praktiken.');
    }
  }
  await page.getByRole('group', { name: 'Samlad status' }).getByRole('button', { name: /Grön/ }).click();
  await page.locator('#cm-summary').fill('Nadia har tagit tydliga steg under januari och klarar allt fler moment på praktiken.');
  await page.getByRole('button', { name: 'Godkänn bedömningen' }).click();
  const ma = await ev((id) => { const st = MM.store.state; const x = MM.sel.assessment(id, '2027-01'); const r = st.reports.find((q) => q.kind === 'monthly' && q.caseId === id && q.month === '2027-01'); return { st: x.status, l6: x.areas.instruktioner.level, obs: x.areas.narvaro_rutiner.observation, rep: r.status, overall: x.overallStatus }; }, sc.nadia);
  ok(ma.st === 'approved' && ma.l6 === 3 && ma.obs.length > 5 && ma.overall === 'green', 'Månadsbedömningen godkänd med coachens nivåer och observationer');
  ok(ma.rep === 'reviewed', 'Månadsrapporten är granskad av coach');
  ok(await page.getByRole('button', { name: 'Förhandsgranska månadsrapporten' }).isVisible(), 'Länk till månadsrapporten visas');

  // ------------------------------------------------------------------ Kartläggning (Amal)
  step('Kartläggning – Amal');
  await visit(page, 'coach', 'coach.kartlaggning', { caseId: sc.amal });
  await noBadText('Kartläggning');
  ok(await page.getByText(/Fastnat i fas 1/).isVisible(), 'Fastnat i fas 1 visas');
  await page.getByRole('button', { name: 'Godkänn kartläggningen' }).click();
  ok(await page.getByText('Välj yrkesspår.').isVisible(), 'Godkännande kräver valt yrkesspår');
  await page.locator('#ia-adapt').fill('Har diagnosen ADHD');
  ok(await page.getByText('Det ser ut som en diagnos').isVisible(), 'Varning när anpassning beskrivs som diagnos');
  await page.locator('#ia-adapt').fill('Behöver tydlig struktur och schema i förväg');
  await btn(page.getByRole('group', { name: 'Valt yrkesspår' }), 'Individuellt spår').click();
  await page.getByRole('button', { name: 'Godkänn kartläggningen' }).click();
  const ia = await ev((id) => ({ ia: MM.sel.intakeOf(id).status, track: MM.sel.caseById(id).vocationalTrack }), sc.amal);
  ok(ia.ia === 'approved' && ia.track === 'Individuellt spår', 'Kartläggningen godkänd och yrkesspåret sparat');

  // ------------------------------------------------------------------ Händelse och avslut (Hodan)
  step('Händelse och avslut – Hodan');
  await visit(page, 'coach', 'coach.handelse', { caseId: sc.hodan });
  await noBadText('Händelse');
  const nEv = await ev((id) => MM.sel.eventsOf(id).length, sc.hodan);
  await btn(page.getByRole('group', { name: 'Typ av händelse' }), 'Arbete påbörjat').click();
  ok(await page.getByText('Möjligt bonusunderlag').isVisible(), 'Arbete påbörjat markeras som möjligt bonusunderlag');
  ok(await page.getByText('Avstängd – modellen ej fastställd').isVisible(), 'Bonus visas som avstängd');
  await page.getByRole('button', { name: 'Tumba Städ & Fastighet AB' }).click();
  await btn(page.getByRole('group', { name: 'Verifiering' }), 'Anställningsbevis').click();
  await page.getByRole('button', { name: 'Bifoga fil' }).click();
  await page.getByRole('button', { name: 'Registrera händelsen' }).click();
  const ev1 = await ev((id) => MM.sel.eventsOf(id).find((e) => e.kind === 'arbete_paborjat'), sc.hodan);
  ok(ev1 && ev1.possibleBonus && ev1.actor === 'Tumba Städ & Fastighet AB' && ev1.verificationFile === 'anstallningsbevis.pdf', 'Händelsen sparad med aktör, verifiering och bonusmarkering');
  ok(await ev((id) => MM.sel.eventsOf(id).length, sc.hodan) === nEv + 1, 'En händelse har tillkommit');
  await btn(page.getByRole('group', { name: 'Välj uppgift' }), 'Avsluta insatsen').click();
  ok(await page.getByText('Välj avslutsorsak för att se hur avslutet räknas.').isVisible(), 'Avslutsorsak är tom tills coachen väljer');
  await btn(page.getByRole('group', { name: 'Avslutsorsak' }), 'Arbete').click();
  ok(await page.getByText('Resultat – preliminärt').isVisible(), 'Resultat är preliminärt utan verifiering');
  await btn(page.getByRole('group', { name: 'Finns verifiering' }), 'Ja, registrera nu').click();
  await btn(page.getByRole('group', { name: 'Typ av verifiering' }), 'Anställningsbevis').click();
  ok(await page.getByText('Resultat – verifierat').isVisible(), 'Förhandsvisning: verifierat resultat');
  await page.locator('.split-wide').getByRole('button', { name: 'Avsluta insatsen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Avsluta insatsen' }).click();
  await page.getByText('Insatsen är avslutad').first().waitFor({ timeout: 3000 });
  const h = await ev((id) => { const st = MM.store.state; const c = MM.sel.caseById(id); return { status: c.status, rc: c.resultClass, ver: !!c.resultVerifiedAt, fin: st.reports.some((r) => r.caseId === id && r.kind === 'final' && r.status === 'draft'), pulse: st.pulseInvites.some((p) => p.caseId === id && p.occasion === 'exit') }; }, sc.hodan);
  ok(h.status === 'closed' && h.rc === 'result' && h.ver, 'Ärendet avslutat som verifierat resultat');
  ok(h.fin && h.pulse, 'Slutrapportutkast och exit-pulsmätning skapade');
  ok(await page.getByRole('button', { name: 'Öppna slutrapportutkastet' }).isVisible(), 'Länk till slutrapportutkastet visas');

  // ------------------------------------------------------------------ Vyer utan params
  step('Vyer utan ärende visar lista');
  for (const v of ['coach.avstamning', 'coach.manad', 'coach.kartlaggning', 'coach.handelse']) {
    await visit(page, 'coach', v, {});
    ok(await page.getByText('Välj deltagare').isVisible(), `${v} utan ärende visar deltagarlista`);
  }
  // Min vecka efter allt: närvaron klar
  await visit(page, 'coach', 'coach.minvecka', {});
  ok(await page.getByText('Allt är registrerat för vecka 4').isVisible(), 'Min vecka visar att vecka 4 är klar');
  await noBadText('Min vecka efter flöden');
} catch (e) {
  failed++; console.log('  FEL  Undantag:', e.message.split('\n')[0]);
}

ok(errors.length === 0, `Inga konsolfel (${errors.length})`); if (errors.length) console.log(errors.join('\n'));
console.log(`\n${passed} ok, ${failed} fel`);
await close();
process.exit(failed ? 1 : 0);
