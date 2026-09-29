// Interaktionstest för src/views/ledning.js (chef.oversikt och chef.avvikelser).
// Kör: node tools/test-ledning.mjs
import { openProto, visit } from './lib.mjs';

const { page, errors, close } = await openProto();
const fails = []; let passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { fails.push(msg); console.log('FEL  ' + msg); } };
const state = (fn, arg) => page.evaluate(fn, arg);
const modal = () => page.locator('.modal');
const mainText = () => page.locator('#main').innerText();
const card = (title) => page.locator('section.card').filter({ has: page.locator('.card-title', { hasText: title }) });

try {
  // ------------------------------------------------------------------ Ledningsvyn, flik KPI
  let probs = await visit(page, 'chef', 'chef.oversikt', {});
  ok(probs.length === 0, `chef.oversikt renderas utan problem (${probs.join('; ')})`);
  let t = await mainText();
  ok(/Resultatgrad, rullande 6 mån/i.test(t) && /Prognos/i.test(t), 'KPI-fliken visar resultatgrad och prognos');
  ok(/Resultatdefinitionen är inte fastställd/i.test(t) && /vilande/.test(t), 'Notering om ej fastställd resultatdefinition och vilande flagga');
  ok(await page.locator('svg.chart rect').count() >= 3, 'Trenddiagrammet har staplar');
  ok(/Tidig uppmärksamhet/i.test(t) && /ser inte att ärendet har eskalerats/i.test(t), 'Tidig uppmärksamhet med text om att coachen inte ser eskaleringen');
  ok(/0 av 3/.test(t), 'Varningar visas som 0 av 3');

  // "Så ser kommunens chef resultatet" = exakt det kom.chef visar som standard: senast levererade beställarrapporten
  const custData = () => state(() => {
    const pid = MM.store.state.customerUsers.find((u) => u.role === 'chef').id;
    const done = (r) => !!r.deliveredAt && ['delivered', 'opened'].includes(r.status) && !r.superseded;
    const reps = MM.store.state.reports.filter((r) => r.kind === 'customer_summary' && !r.superseded && (r.recipientUserId === pid || (r.deliveredTo || []).includes(pid))).sort(MM.by('month'));
    const latest = reps.filter(done).slice(-1)[0];
    const s = MM.sel.customerSummary(latest.month); const rr = s.result.rolling;
    const next = reps.find((r) => !done(r) && r.month > latest.month);
    const nrr = next ? MM.sel.customerSummary(next.month).result.rolling : null;
    return { month: MM.d.monthName(latest.month), value: MM.fmt.pct(rr.value), n: `${rr.num} av ${rr.den}`, below: rr.den >= rr.minN && rr.value < s.result.contractTarget,
      nextId: next ? next.id : null, next: next ? MM.d.monthName(next.month) : null, nextValue: nrr ? MM.fmt.pct(nrr.value) : null };
  });
  const cust = await custData();
  const custCard = card('Så ser kommunens chef resultatet');
  let ct = await custCard.innerText();
  ok(ct.includes(cust.month) && ct.includes(cust.value) && ct.includes(cust.n), `Kundkortet visar ${cust.month}: ${cust.value} (${cust.n}) – samma som kom.chef (${ct.split('\n').slice(1, 3).join(' ')})`);
  ok(cust.below ? /Under avtalsmålet/.test(ct) : /Når avtalsmålet|För få avslut/.test(ct), 'Kundkortet visar samma omdöme som kommunens chef ser');
  ok(!cust.next || (ct.includes(cust.next) && ct.includes(cust.nextValue) && /utkast/.test(ct)), 'Kundkortet säger att nästa rapport är ett utkast och vad den visar med dagens underlag');
  ok(/färre än 5/.test(ct) && !/35\s?%/.test(ct), 'Kundkortet nämner små grupper men inte det interna målets värde');

  // Status med text och ikon, inte bara färg (SLA-staplar)
  const slaCard = card('SLA-uppfyllnad');
  const slaRows = await slaCard.locator('.ldg-slarow').count();
  ok(slaRows === 4 && await slaCard.locator('.ldg-slarow .badge').count() === slaRows && await slaCard.locator('.ldg-slarow .badge svg').count() === slaRows, 'Varje SLA-rad har ett statusmärke med text och ikon');
  ok(/Når målet|Under målet/.test(await slaCard.innerText()) && /mål 100\s?%/.test(await slaCard.innerText()), 'SLA-raderna visar status och mål i text');
  ok(await page.locator('#main .kpi.alert .kpi-state, #main .kpi.watch .kpi-state').count() === await page.locator('#main .kpi.alert, #main .kpi.watch').count(), 'KPI-rutor med markerad ram har statustext');
  ok(!/deadline/i.test(await mainText()), 'Inga engelska ord (deadline) i ledningsvyn');
  ok(await page.locator('#main details.ldg-details > summary .ldg-chev').count() >= 1, 'Utfällbara avsnitt har en pilmarkering');

  // Knappar ryms i sina kort (1280 och 400 px)
  const btnFits = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('#main button')].find((x) => /Förfaller i dag och denna vecka/.test(x.innerText)); if (!b) return 'saknas';
    const c = b.closest('.card').getBoundingClientRect(); const r = b.getBoundingClientRect();
    const out = [...document.querySelectorAll('#main .card .btn')].filter((x) => x.offsetParent && !x.closest('.table-wrap') && x.getBoundingClientRect().right > x.closest('.card').getBoundingClientRect().right + 1).map((x) => x.innerText.trim());
    return r.right <= c.right + 1 && b.scrollWidth <= b.clientWidth + 1 && out.length === 0 ? true : `${Math.round(r.right - c.right)} px; utanför: ${out.join(', ')}`;
  });
  let fit = await btnFits(); ok(fit === true, `Knapparna ryms i korten på 1280 px (${fit})`);
  await page.setViewportSize({ width: 400, height: 860 }); await page.waitForTimeout(150);
  fit = await btnFits(); ok(fit === true, `Knapparna ryms i korten på 400 px (${fit})`);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(100);

  // Kvittera resultatflaggan – först utan text (valideras), sedan med plan
  const rrKey = await state(() => (MM.sel.alerts({ role: 'chef', personaId: 'u-karin' }).find((a) => a.key.startsWith('kpi:resultatgrad')) || {}).key);
  ok(!!rrKey, 'Resultatflaggan finns för chefen');
  await page.getByRole('button', { name: 'Kvittera flaggan' }).click();
  await modal().getByRole('button', { name: 'Kvittera med åtgärdsplan' }).click();
  ok(await modal().locator('.error-text').count() === 1, 'Tom åtgärdsplan ger felmeddelande');
  ok(await state(() => Object.keys(MM.store.state.alertAcks).length) === 0, 'Ingen kvittering sparas utan plan');
  await page.fill('#ldg-ack-plan', 'Genomgång av fas 5-ärenden med coacherna torsdag. Uppföljning 15 februari.');
  await modal().getByRole('button', { name: 'Kvittera med åtgärdsplan' }).click();
  await page.waitForTimeout(100);
  let ack = await state((k) => MM.store.state.alertAcks[k], rrKey);
  ok(ack && ack.by === 'u-karin' && /torsdag/.test(ack.plan), 'Resultatflaggan kvitterad med plan och chefens id');
  ok(await modal().count() === 0, 'Modalen stängs efter kvittering');
  ok(await state(() => MM.store.state.auditLog.some((l) => l.action === 'alert.acknowledged')), 'Kvitteringen loggas i revisionsloggen');

  // Kvittera en eskalering under Tidig uppmärksamhet med förslagsknappen
  const escKeys = await state(() => MM.sel.progressionWatch().filter((w) => w.level === 'escalated').map((w) => `noprog_esc:${w.case.id}:${w.lastWeek}`));
  ok(escKeys.length >= 1, 'Det finns eskalerade ärenden i demodatan');
  const early = card('Tidig uppmärksamhet');
  const before = await early.getByRole('button', { name: 'Kvittera', exact: true }).count();
  await early.getByRole('button', { name: 'Kvittera', exact: true }).first().click();
  await modal().locator('button.btn-ghost', { hasText: 'Avstämning med coachen' }).click();
  await modal().getByRole('button', { name: 'Kvittera med åtgärdsplan' }).click();
  await page.waitForTimeout(100);
  const ackedEsc = await state((keys) => keys.filter((k) => MM.store.state.alertAcks[k]).length, escKeys);
  ok(ackedEsc === 1, 'En eskalering kvitterad');
  ok(await early.getByRole('button', { name: 'Kvittera', exact: true }).count() === before - 1, 'Kvitteringsknappen försvinner för den kvitterade eskaleringen');
  ok(/Kvitterad av Karin Wallin/.test(await early.innerText()), 'Kvitteringen visas i Tidig uppmärksamhet');

  // Kvitterade flaggor syns i den utfällbara listan
  const flags = card('Flaggor för chef och controller');
  ok(/Kvitterade flaggor \(\d+\)/.test(await flags.innerText()), 'Kvitterade flaggor listas');

  // ------------------------------------------------------------------ Flikar
  await page.getByRole('tab', { name: /Per coach/ }).click(); await page.waitForTimeout(150);
  ok(await state(() => MM.route.params.tab) === 'coacher', 'Fliken Per coach sätter params.tab');
  ok(await page.locator('#main table tbody tr').count() === await state(() => MM.sel.coaches().length), 'En rad per coach');
  t = await mainText();
  ok(/Dokumentationstid/i.test(t) && /median utan AI/.test(t), 'Dokumentationstid (baslinje utan AI) visas');
  ok(/Aktiva ärenden just nu/i.test(t) && /Aktiva nu/i.test(t), 'Per coach: aktiva ärenden är tydligt märkta som "just nu"');

  await page.getByRole('tab', { name: /Per avtalsområde/ }).click(); await page.waitForTimeout(150);
  ok(await page.locator('#main table tbody tr').count() === await state(() => MM.store.state.areas.filter((a) => a.contractId === 'c-bot').length), 'En rad per avtalsområde');
  t = await mainText();
  ok(/Litet underlag/.test(t), 'Små grupper markeras');
  const monthActive = await state(() => MM.sel.customerSummary(MM.d.addMonths(MM.d.monthKey(MM.d.today()), -1)).active);
  ok(/Aktiva just nu/i.test(t) && new RegExp(`Aktiva under [^\\n]+\\n${monthActive}\\n`, 'i').test(t) && !/^Aktiva deltagare$/im.test(t),
    `Per avtalsområde: "Aktiva just nu" och "Aktiva under månaden" (${monthActive}, beställarrapportens räknesätt) skiljs åt`);

  await page.getByRole('tab', { name: /Deltagarnas röst/ }).click(); await page.waitForTimeout(150);
  t = await mainText();
  ok(/Svarsfrekvens/i.test(t) && /Nöjdhet/i.test(t) && /inte till coachen/.test(t), 'Pulsfliken visar svarsfrekvens, nöjdhet och regeln om lågt betyg');
  const low = card('Lågt betyg på stödet från coachen');
  if (await low.getByRole('button', { name: 'Kvittera', exact: true }).count()) {
    await low.getByRole('button', { name: 'Kvittera', exact: true }).first().click();
    await page.fill('#ldg-ack-plan', 'Samordnaren ringer deltagaren i dag.');
    await modal().getByRole('button', { name: 'Kvittera med åtgärdsplan' }).click(); await page.waitForTimeout(100);
    ok(await state(() => Object.keys(MM.store.state.alertAcks).some((k) => k.startsWith('pulse_low:'))), 'Lågt pulsbetyg kvitterat');
  }

  // Direktlänk med params.tab
  await visit(page, 'chef', 'chef.oversikt', { tab: 'puls' });
  ok(await page.getByRole('tab', { name: /Deltagarnas röst/ }).getAttribute('aria-selected') === 'true', 'params.tab=puls öppnar pulsfliken');

  // ------------------------------------------------------------------ Behörighet
  probs = await visit(page, 'coach', 'chef.oversikt', {});
  t = await mainText();
  ok(/Ingen åtkomst/i.test(t) && !/eskaler/i.test(t), 'Coachen har ingen åtkomst till ledningsvyn och ser inga eskaleringar');
  await visit(page, 'kommun_chef', 'chef.oversikt', {});
  ok(/Ingen åtkomst/i.test(await mainText()), 'Kommunens chef har ingen åtkomst till den interna ledningsvyn');

  // ------------------------------------------------------------------ Avtalsavvikelser: registrera ny
  probs = await visit(page, 'chef', 'chef.avvikelser', {});
  ok(probs.length === 0, `chef.avvikelser renderas utan problem (${probs.join('; ')})`);
  ok(await page.locator('.ldg-ladder li').count() === await state(() => MM.cfg().escalationLadder.length), 'Eskaleringstrappan har ett steg per konfigurerat steg');
  const cdBefore = await state(() => MM.store.state.contractDeviations.length);
  await page.getByRole('button', { name: 'Registrera avvikelse eller klagomål' }).click();
  await modal().getByRole('button', { name: 'Registrera', exact: true }).click();
  ok(await modal().locator('.error-text').count() >= 4, 'Tomt formulär ger fel på obligatoriska fält');
  await modal().locator('#cd-type').getByRole('button', { name: 'Klagomål' }).click();
  await page.selectOption('#cd-source', 'arbetsgivare');
  await modal().locator('#cd-level').getByRole('button', { name: 'Större' }).click();
  ok(await page.inputValue('#cd-step') === '1', 'Nivå Större föreslår steg 1');
  await page.fill('#cd-desc', 'Arbetsgivaren fick ingen information om ändrade praktiktider vecka 5.');
  await page.fill('#cd-case', 'BOT-99-9999');
  await modal().getByRole('button', { name: 'Registrera', exact: true }).click();
  ok(/Hittar inget ärende/.test(await modal().innerText()), 'Okänt ärendenummer ger fel');
  const nadiaNo = await state(() => MM.sel.caseByTag('nadia').number);
  await page.fill('#cd-case', nadiaNo);
  await page.fill('#cd-plan', 'Samordnaren informerar arbetsgivaren skriftligt vid varje ändring. Checklista uppdateras.');
  await page.fill('#cd-due', '2027-02-19');
  const notifBefore = await state(() => MM.store.state.notifications.length);
  await modal().getByRole('button', { name: 'Registrera', exact: true }).click();
  await page.waitForTimeout(150);
  const created = await state(() => MM.store.state.contractDeviations[MM.store.state.contractDeviations.length - 1]);
  ok(await state(() => MM.store.state.contractDeviations.length) === cdBefore + 1, 'En ny avvikelse har skapats');
  ok(created.type === 'klagomål' && created.source === 'arbetsgivare' && created.level === 'större' && created.escalationStep === 1, 'Typ, källa, nivå och steg sparas');
  ok(created.caseId === await state(() => MM.sel.caseByTag('nadia').id), 'Kopplat ärende sparas som caseId');
  ok(created.actionPlanDue === '2027-02-19' && created.customerApprovedAt === null && created.status === 'action_plan', 'Åtgärdsplan med tidsplan väntar på kommunens godkännande');
  const route = await state(() => MM.route);
  ok(route.view === 'chef.avvikelser' && route.params.id === created.id, 'Efter sparande visas detaljvyn');
  const notif = await state((n) => MM.store.state.notifications.slice(n), notifBefore);
  ok(notif.length === 1 && notif[0].template === 'atgardsplan_godkannande' && /Logga in/.test(notif[0].body), 'Kommunens chef får notis om åtgärdsplanen');
  const names = await state(() => MM.store.state.persons.slice(0, 50).map((p) => p.lastName));
  ok(!names.some((n) => notif[0].body.includes(n)) && !notif[0].body.includes(nadiaNo), 'Notisen innehåller inga personuppgifter eller ärendenummer');

  // Uppdatera åtgärdsplan
  await page.getByRole('button', { name: 'Ändra åtgärdsplan' }).click();
  await page.fill('#cd-edit-plan', 'Samordnaren informerar arbetsgivaren skriftligt senast dagen innan varje ändring.');
  await page.fill('#cd-edit-due', '2027-02-26');
  await page.getByRole('button', { name: 'Spara och skicka till kommunen' }).click();
  await page.waitForTimeout(100);
  let cd = await state((id) => MM.store.state.contractDeviations.find((x) => x.id === id), created.id);
  ok(/dagen innan/.test(cd.actionPlan) && cd.actionPlanDue === '2027-02-26' && cd.customerApprovedAt === null, 'Åtgärdsplanen är uppdaterad och skickad för nytt godkännande');

  // Kommunens chef godkänner planen i sin portal (kom.approveActionPlan i kommun.js) – statusen slår igenom här
  if (await state(() => !!MM.actions['kom.approveActionPlan'])) {
    const res = await state((id) => { MM.setRole('kommun_chef', { view: 'kom.chef' }); return MM.dispatch('kom.approveActionPlan', { id }); }, created.id);
    ok(res && res.ok, 'Kommunens chef kan godkänna åtgärdsplanen');
    await visit(page, 'chef', 'chef.avvikelser', { id: created.id });
    ok(/Åtgärdsplan godkänd – pågår/.test(await mainText()) && /Godkänd av kommunen \(Eva Bergström\)/.test(await mainText()), 'Kommunens godkännande syns i detaljvyn');
  } else console.log('     (kom.approveActionPlan finns inte – godkännandet kontrolleras inte)');

  // Skriftlig varning (steg 1) räknas mot tre
  await page.getByRole('button', { name: 'Ändra', exact: true }).click();
  await page.check('#cd-s-warning');
  await page.selectOption('#cd-s-penalty', 'deviation');
  await page.getByRole('button', { name: 'Spara', exact: true }).click();
  await page.waitForTimeout(100);
  cd = await state((id) => MM.store.state.contractDeviations.find((x) => x.id === id), created.id);
  const penalty = await state(() => MM.cfg().penalties.deviationOre);
  ok(cd.warningIssued === true && cd.warningIssuedAt && cd.penaltyOre === penalty, 'Varning och vite (från konfigurationen) sparas');
  ok(/1 av 3/.test(await mainText()), 'Varningar totalt visar 1 av 3');

  // Markera klar – kräver lärdomar
  await page.getByRole('button', { name: 'Markera som klar' }).click();
  ok(await page.locator('#main .error-text').count() === 1, 'Lärdomar krävs för att markera som klar');
  await page.fill('#cd-lessons', 'Ändringar i praktiktider kommuniceras skriftligt till arbetsgivaren via samordnaren.');
  await page.getByRole('button', { name: 'Markera som klar' }).click();
  await page.waitForTimeout(100);
  cd = await state((id) => MM.store.state.contractDeviations.find((x) => x.id === id), created.id);
  ok(cd.status === 'closed' && cd.closedAt && /skriftligt/.test(cd.lessons), 'Avvikelsen är markerad som klar med lärdomar');
  ok(/Lärdomar/i.test(await mainText()) && !(await page.getByRole('button', { name: 'Markera som klar' }).count()), 'Detaljvyn visar lärdomen och ingen klarknapp');

  // Månadssammanställning för APT
  await visit(page, 'chef', 'chef.avvikelser', {});
  ok(/1 av 3/.test(await mainText()), 'Registret visar 1 av 3 varningar');
  await page.getByRole('tab', { name: /Månadssammanställning/ }).click();
  await page.selectOption('#ldg-apt-month', '2027-02');
  t = await mainText();
  ok(/Arbetsgivaren fick ingen information/.test(t) && /kommuniceras skriftligt/.test(t), 'Februarisammanställningen tar med nya avvikelsen och lärdomen');
  await page.selectOption('#ldg-apt-month', '2027-01');
  ok(/praktikplatsen inte var förberedd/.test(await mainText()), 'Januarisammanställningen visar januaris klagomål');
  await page.getByRole('button', { name: 'Exportera' }).click(); await page.waitForTimeout(150);
  ok(/Månadssammanställning avtalsavvikelser/.test(await page.locator('#text-modal-area').inputValue().catch(() => '')), 'Exporten innehåller sammanställningen');
  if (await modal().count()) await modal().getByRole('button', { name: 'Stäng', exact: true }).last().click();

  // Registret: filter och radklick
  await page.getByRole('tab', { name: /Register/ }).click();
  await page.getByRole('button', { name: /Alla \(\d+\)/ }).click();
  ok(await page.locator('#main table tbody tr').count() === await state(() => MM.store.state.contractDeviations.length), 'Filter Alla visar alla avvikelser');
  await page.locator('#main table tbody tr', { hasText: 'Månadsrapport för december' }).click(); await page.waitForTimeout(100);
  ok(await state(() => MM.route.params.id) === 'cd-2', 'Klick på rad öppnar avvikelsen');

  // Samordnaren kan registrera men inte sätta varning/vite
  await visit(page, 'samordnare', 'chef.avvikelser', {});
  await page.getByRole('button', { name: 'Registrera avvikelse eller klagomål' }).click();
  await modal().locator('#cd-level').getByRole('button', { name: 'Större' }).click();
  ok(await page.isDisabled('#cd-warning') && await page.isDisabled('#cd-penalty'), 'Samordnaren kan inte registrera varning eller vite');
  await modal().getByRole('button', { name: 'Avbryt' }).click();

  // Okänt id
  await visit(page, 'chef', 'chef.avvikelser', { id: 'cd-finns-inte' });
  ok(/Avvikelsen finns inte/.test(await mainText()), 'Okänt id ger tydligt meddelande');

  // Perspektivbyte till kommunens chef
  await visit(page, 'chef', 'chef.oversikt', {});
  await page.getByRole('button', { name: /Så ser kommunens chef resultatet/ }).first().click(); await page.waitForTimeout(150);
  const hasKomChef = await state(() => !!MM.views['kom.chef']);
  if (hasKomChef) { const r = await state(() => MM.route); ok(r.role === 'kommun_chef' && r.view === 'kom.chef', 'Perspektivbytet öppnar kom.chef som kommunens chef'); }
  else console.log('     (kom.chef finns inte ännu – perspektivbytet kontrolleras inte)');

  // Bytet från kundkortet landar på samma månad och samma siffra i kom.chef
  if (hasKomChef) {
    await visit(page, 'chef', 'chef.oversikt', {});
    const c1 = await custData();
    await card('Så ser kommunens chef resultatet').getByRole('button', { name: /som kommunens chef/ }).click(); await page.waitForTimeout(200);
    const kt = await mainText();
    ok(await state(() => MM.route.view) === 'kom.chef' && kt.toLowerCase().includes(c1.month) && kt.includes(c1.value) && (c1.below ? /Under avtalsmålet/.test(kt) : true),
      `kom.chef visar samma månad och resultat som kundkortet (${c1.month}, ${c1.value})`);
    // När nästa rapport levereras följer kortet med
    if (c1.nextId) {
      await state((id) => { MM.setRole('avtalsansvarig', { view: 'rapporter.lista' }); MM.dispatch('report.approve', { reportId: id }); MM.dispatch('report.deliver', { reportId: id }); }, c1.nextId);
      await visit(page, 'chef', 'chef.oversikt', {});
      const c2 = await custData(); const ct2 = await card('Så ser kommunens chef resultatet').innerText();
      ok(c2.month === c1.next && ct2.includes(c2.month) && ct2.includes(c2.value) && !/är ett utkast/.test(ct2), `Efter leverans visar kundkortet ${c2.month} (${c2.value})`);
    }
  }

  // Omladdning: åtgärderna spelas upp igen deterministiskt
  await page.reload();
  await page.waitForFunction(() => window.MM && MM.store && MM.store.state && document.querySelector('.protobar'));
  cd = await state((id) => MM.store.state.contractDeviations.find((x) => x.id === id), created.id);
  ok(cd && cd.status === 'closed' && cd.warningIssued && cd.actionPlanDue === '2027-02-26', 'Avvikelsen finns kvar efter omladdning (uppspelning)');
  ack = await state((k) => MM.store.state.alertAcks[k], rrKey);
  ok(ack && /torsdag/.test(ack.plan), 'Kvitteringen finns kvar efter omladdning');
} catch (e) {
  fails.push('Undantag: ' + e.message); console.log('FEL  Undantag: ' + e.message);
}

const relevant = errors.filter((e) => !/Failed to load resource/.test(e));
ok(relevant.length === 0, `Inga konsol- eller sidfel (${relevant.join(' | ')})`);
console.log(`\n${passed} kontroller godkända, ${fails.length} fel.`);
await close();
process.exit(fails.length ? 1 : 0);
