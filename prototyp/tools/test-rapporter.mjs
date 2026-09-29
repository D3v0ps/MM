// Interaktionstest för src/views/rapporter.js (rapporter.lista och rapport.visa).
// Kör: node tools/test-rapporter.mjs
import { openProto, visit } from './lib.mjs';

const { page, errors, close } = await openProto();
let failed = 0; let passed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ok   ${msg}`); } else { failed++; console.log(`  FEL  ${msg}`); } };
const st = (fn, arg) => page.evaluate(fn, arg);
const rep = (id) => st((id) => JSON.parse(JSON.stringify(MM.store.state.reports.find((r) => r.id === id) || null)), id);
const mainText = () => page.evaluate(() => document.querySelector('#main').innerText);
const btn = (name) => page.getByRole('button', { name, exact: true });
const wait = (ms = 150) => page.waitForTimeout(ms);

const ids = await st(() => {
  const s = MM.store.state; const sc = s.script; const f = (p) => (s.reports.find(p) || {}).id;
  return {
    nadia: sc.nadia,
    nadiaJan: f((r) => r.caseId === sc.nadia && r.kind === 'monthly' && r.month === '2027-01'),
    approvedJan: f((r) => r.kind === 'monthly' && r.month === '2027-01' && r.status === 'approved'),
    csJan: f((r) => r.kind === 'customer_summary' && r.month === '2027-01'),
    csDec: f((r) => r.kind === 'customer_summary' && r.month === '2026-12'),
    weeklyWait: f((r) => r.kind === 'weekly_attendance' && r.status === 'waiting'),
    amiraActive: (s.cases.find((c) => c.leadCoachId === 'u-amira' && c.status === 'active' && c.id !== sc.nadia && c.id !== sc.yusuf) || {}).id,
  };
});
console.log('Testdata:', ids);

// ---------------------------------------------------------------- 1. Listan och sammanfattningen
console.log('\n1. Rapportlistan (samordnare)');
let probs = await visit(page, 'samordnare', 'rapporter.lista', {});
ok(probs.length === 0, `listan renderar utan problem ${probs.join(' ')}`);
let t = await mainText();
ok(/FÖRSENADE/i.test(t) && /FÖRFALLER DENNA VECKA/i.test(t) && /VÄNTAR PÅ GODKÄNNANDE/i.test(t), 'sammanfattning överst: försenade, förfaller denna vecka, väntar på godkännande');
ok(/Ej fastställd deadline/.test(t), 'förfallotid utan fastställd deadline märks');
const overdueCount = await st(() => MM.store.state.reports.filter((r) => !r.superseded && !['delivered', 'opened'].includes(r.status) && r.dueAt && r.dueAt < MM.d.now()).length);
await page.getByRole('button', { name: /^Försenade/ }).click(); await wait();
t = await mainText();
ok(new RegExp(`${overdueCount} rapporte?r? · försenade`, 'i').test(t), `klick på "Försenade" filtrerar listan till ${overdueCount} rapport(er)`);
await page.getByRole('button', { name: /^Försenade/ }).click(); await wait();
await page.selectOption('#rap-kind', 'customer_summary'); await wait();
t = await mainText();
ok(/4 rapporter/i.test(t) && /Beställarrapport januari 2027/.test(t), 'filter på typ visar de fyra beställarrapporterna');
await page.fill('#rap-q', 'december'); await wait();
t = await mainText();
ok(/(^|\n)1 rapport\b/i.test(t), 'sök inom filtret ger en träff');
await btn('Rensa filter').click(); await wait();
t = await mainText();
ok(/794 rapporter/i.test(t), 'rensa filter visar alla rapporter igen');
await page.locator('table tbody tr.clickable').first().click(); await wait();
ok(await st(() => MM.route.view) === 'rapport.visa', 'klick på en rad öppnar rapporten');

console.log('\n1b. Coachen ser bara egna ärenden');
await visit(page, 'coach', 'rapporter.lista', {});
t = await mainText();
const foreign = await st(() => MM.store.state.cases.find((c) => c.leadCoachId !== 'u-amira' && c.status === 'active').number);
ok(!t.includes(foreign), `coachen ser inte andras ärenden (${foreign} saknas)`);
ok(/Dina ärenden/i.test(t), 'coachens lista är märkt "Dina ärenden"');

// ---------------------------------------------------------------- 2. Månadsrapport: blockerad → godkänn → leverera
console.log('\n2. Månadsrapport januari (Nadia) – bara godkända uppgifter');
probs = await visit(page, 'coach', 'rapport.visa', { reportId: ids.nadiaJan });
ok(probs.length === 0, 'månadsrapporten renderar');
t = await mainText();
ok(/Rapporten kan inte godkännas ännu/.test(t) && /UTKAST/i.test(t), 'utkast-vattenstämpel och blockering när månadsbedömningen inte är godkänd');
ok(/4\. PROGRESSION/i.test(t), 'rubriken "4. Progression" har numret');
ok(/Visas när coachen har godkänt månadsbedömningen/.test(t), 'ej godkända uppgifter visas inte');
ok(await btn('Godkänn').count() === 0, 'knappen Godkänn finns inte när underlaget inte är godkänt');
ok(!/\d{6,8}-\d{4}/.test(t), 'inget personnummer i rapporten');
ok(/exempel – de stäms av mot mall 02/.test(t), 'aktivitetstyperna är märkta som exempel');
await btn('Öppna bedömningen').click(); await wait();
ok(await st(() => MM.route.view) === 'coach.manad', 'länken leder till coach.manad');
// Godkänn månadsbedömningen via domänåtgärden (vyn coach.manad ägs av en annan fil)
const res = await st((caseId) => {
  const cfg = MM.cfg(); const areas = {};
  for (const k of cfg.progression.areas) areas[k] = { level: 1, observation: 'Följer instruktionen utan stöd.', nextStep: 'Fortsätta öva.' };
  return MM.dispatch('assessment.save', { caseId, month: '2027-01', areas, summary: 'Deltagaren följer planen.', overallStatus: 'green', approve: true });
}, ids.nadia);
ok(res && !res.error, 'månadsbedömningen godkänns');
ok((await rep(ids.nadiaJan)).status === 'reviewed', 'rapporten blir "granskad" när bedömningen är godkänd');
await visit(page, 'coach', 'rapport.visa', { reportId: ids.nadiaJan });
t = await mainText();
ok(/Grön – enligt plan/.test(t) && /Deltagaren följer planen\./.test(t), 'avsnitt 8 visar samlad status och sammanfattning efter godkännandet');
await btn('Godkänn').click(); await wait();
let r = await rep(ids.nadiaJan);
ok(r.status === 'approved' && r.approvedBy === 'u-amira', 'coachen godkänner (report.approve)');
await btn('Leverera till kommunen').click(); await wait();
t = await page.locator('.modal').innerText();
ok(/bara innehåller en notis/.test(t) && /inte som bilaga/.test(t), 'bekräftelsen förklarar att mejlet bara är en notis och att bilaga är avstängd');
ok(!/Nadia|Warsame/.test(t.split('notis')[1] || ''), 'notistexten i mejlet innehåller inget namn');
await btn('Leverera i portalen').click(); await wait();
r = await rep(ids.nadiaJan);
ok(r.status === 'delivered' && (r.deliveredTo || []).includes('k-maria'), 'rapporten levereras till handläggaren (report.deliver)');
const ntf = await st(() => MM.store.state.notifications.filter((n) => n.template === 'ny_rapport').slice(-1)[0]);
ok(ntf && /BOT-26-0143/.test(ntf.body) && !/Nadia|Warsame/.test(ntf.body), 'utskicket innehåller ärendenummer men inga personuppgifter');

// ---------------------------------------------------------------- 3. Kundens perspektiv och kvittens
console.log('\n3. Kommunens handläggare öppnar rapporten');
await btn('Se som kommunen').click(); await wait(250);
ok(await st(() => MM.route.role) === 'kommun_handlaggare', 'perspektivbytet går till kommunens handläggare');
r = await rep(ids.nadiaJan);
ok(!!r.openedAt, 'första visningen kvitterar rapporten (report.open)');
t = await mainText();
ok(/Rapporten är kvitterad/.test(t), 'kvittensen visas för kommunen');
ok(await btn('Godkänn').count() === 0 && await btn('Rätta').count() === 0 && await btn('Leverera till kommunen').count() === 0, 'inga interna knappar i kundens vy');
ok(await st((id) => MM.store.state.auditLog.some((l) => l.action === 'report.view' && l.entityId === id), ids.nadiaJan), 'visningen loggas i revisionsloggen');
await visit(page, 'kommun_handlaggare', 'rapport.visa', { reportId: ids.csJan });
t = await mainText();
ok(/inte tillgänglig för dig/.test(t), 'handläggaren kan inte öppna chefens beställarrapport');
const undelivered = await st(() => MM.store.state.reports.find((r) => r.kind === 'monthly' && r.status === 'draft' && MM.sel.caseById(r.caseId).referrerId === 'k-maria').id);
await visit(page, 'kommun_handlaggare', 'rapport.visa', { reportId: undelivered });
t = await mainText();
ok(/inte klar ännu/.test(t) && !(await rep(undelivered)).openedAt, 'ej levererad rapport visas inte och kvitteras inte');
await btn('Se från leverantörens håll').click(); await wait(200);
ok(await st(() => MM.perspective()) === 'leverantor', 'perspektivbytet tillbaka till leverantören fungerar');

// ---------------------------------------------------------------- 4. Rättelse = ny version
console.log('\n4. Rätta en levererad rapport');
await visit(page, 'coach', 'rapport.visa', { reportId: ids.nadiaJan });
await btn('Rätta').click(); await wait();
await btn('Skapa ny version').click(); await wait();
ok(/Skriv varför rapporten rättas/.test(await page.locator('.modal').innerText()), 'orsak krävs för rättelse');
await page.fill('#rap-correct-reason', 'Fel datum för praktikstart.');
await btn('Skapa ny version').click(); await wait(250);
const newId = await st(() => MM.route.params.reportId);
const nr = await rep(newId); const old = await rep(ids.nadiaJan);
ok(newId !== ids.nadiaJan && nr.version === 2 && nr.status === 'draft' && nr.previousId === ids.nadiaJan, 'ny version 2 skapas som utkast (report.correct)');
ok(old.superseded === true && old.status === 'delivered', 'den gamla versionen sparas');
ok(nr.correctionReason === 'Fel datum för praktikstart.', 'orsaken sparas på den nya versionen');
t = await mainText();
ok(/Version 1/.test(t) && /Version 2 \(visas nu\)/.test(t), 'versionshistoriken visar båda versionerna');

// ---------------------------------------------------------------- 5. Samordnarens kvalitetsgranskning
console.log('\n5. Samordnarens valfria kvalitetsgranskning');
await visit(page, 'samordnare', 'rapport.visa', { reportId: ids.approvedJan });
await btn('Markera som kvalitetsgranskad').click(); await wait();
r = await rep(ids.approvedJan);
ok(r.qualityReviewedBy === 'u-sara' && !!r.qualityReviewedAt, 'kvalitetsgranskningen sparas');
ok(/Kvalitetsgranskad/.test(await mainText()), 'kvalitetsgranskningen visas');

// ---------------------------------------------------------------- 6. Beställarrapport
console.log('\n6. Beställarrapport januari (avtalsansvarig)');
await visit(page, 'avtalsansvarig', 'rapport.visa', { reportId: ids.csJan });
t = await mainText();
ok(!/35\s?%/.test(t.split('FÖRHANDSVISNING')[1] || t), 'det interna målet 35 % syns inte i rapporten');
ok(/avtalsmål(et)? 32\s%/i.test(t), 'avtalsmålet visas');
ok(/färre än 5/.test(t), 'små grupper redovisas som "färre än 5"');
await btn('Godkänn beställarrapporten').click(); await wait();
ok(/Skriv en sammanfattning/.test(await mainText()), 'sammanfattning krävs innan godkännande');
await page.fill('#rap-summary', 'Resultatgraden ligger under det interna målet 35 %.');
await btn('Godkänn beställarrapporten').click(); await wait();
ok(/interna mål/.test(await mainText()) && (await rep(ids.csJan)).status === 'draft', 'text som nämner det interna målet stoppas');
await btn('Använd förslaget').click(); await wait();
await btn('Godkänn beställarrapporten').click(); await wait();
r = await rep(ids.csJan);
ok(r.status === 'approved' && r.approvedBy === 'u-johan' && r.summary && r.summaryAiUsed === true, 'avtalsansvarig godkänner med AI-förslaget (loggat som AI-använt)');
await btn('Leverera till kommunen').click(); await wait();
await btn('Leverera i portalen').click(); await wait();
r = await rep(ids.csJan);
ok(r.status === 'delivered' && (r.deliveredTo || []).includes('k-eva'), 'beställarrapporten levereras till kommunens chef');
await visit(page, 'kommun_chef', 'rapport.visa', { reportId: ids.csJan });
t = await mainText();
ok(!/35\s?%/.test(t) && /avtalsmål(et)? 32\s%/i.test(t), 'kommunens chef ser bara avtalsmålet');
ok(!!(await rep(ids.csJan)).openedAt, 'kommunens chef kvitterar vid första visningen');
await visit(page, 'coach', 'rapport.visa', { reportId: ids.csDec });
ok(/inte tillgänglig för din roll/.test(await mainText()), 'coachen kan inte öppna beställarrapporten');

// ---------------------------------------------------------------- 7. Veckorapport som väntar
console.log('\n7. Veckorapport som väntar på närvaro');
await visit(page, 'samordnare', 'rapport.visa', { reportId: ids.weeklyWait });
t = await mainText();
ok(/Väntar på närvaroregistrering/.test(t) && /tillfällen? saknas/.test(t), 'saknade registreringar listas');
await visit(page, 'coach', 'rapport.visa', { reportId: ids.weeklyWait });
t = await mainText();
ok(/Du ser \d+ av \d+ deltagare/.test(t), 'coachen ser bara sina egna deltagare i veckorapporten');

// ---------------------------------------------------------------- 8. Slutrapport: coachens text → godkänn
console.log('\n8. Slutrapport efter avslut');
const fin = await st((caseId) => MM.dispatch('case.close', { caseId, endDate: MM.d.today(), endReason: 'arbete', verified: true }), ids.amiraActive);
ok(fin && fin.reportId, 'avslut skapar ett slutrapportutkast');
await visit(page, 'coach', 'rapport.visa', { reportId: fin.reportId });
t = await mainText();
ok(/Coachen skriver rekommenderad fortsättning/.test(t) && await btn('Godkänn').count() === 0, 'slutrapporten kan inte godkännas utan rekommendation');
await btn('Spara texten').click(); await wait();
ok(/Skriv en rekommenderad fortsättning/.test(await mainText()), 'tom rekommendation stoppas');
await page.fill('#rap-final-rec', 'Ingen fortsatt insats behövs. Deltagaren har börjat arbeta.');
await btn('Spara texten').click(); await wait();
r = await rep(fin.reportId);
ok(r.status === 'reviewed' && /Ingen fortsatt insats/.test(r.finalText.recommendation), 'texten sparas och rapporten blir granskad');
await btn('Godkänn').click(); await wait();
ok((await rep(fin.reportId)).status === 'approved', 'coachen godkänner slutrapporten');
ok(/Rekommenderad fortsättning:\s*Ingen fortsatt insats/.test(await mainText()), 'rekommendationen syns i förhandsvisningen');

// ---------------------------------------------------------------- 9. Behörighet och export
console.log('\n9. Behörighet och export');
const prot = await st(() => MM.store.state.reports.find((r) => r.kind === 'monthly' && r.caseId === MM.store.state.script.skyddad));
if (prot) {
  await visit(page, 'samordnare', 'rapport.visa', { reportId: prot.id });
  t = await mainText();
  ok(/Skyddade personuppgifter/.test(t) && !/1\. GRUNDUPPGIFTER/i.test(t), 'samordnaren ser inte rapporter för skyddade ärenden');
  await visit(page, 'avtalsansvarig', 'rapport.visa', { reportId: prot.id });
  ok(/1\. GRUNDUPPGIFTER/i.test(await mainText()), 'avtalsansvarig ser rapporten för det skyddade ärendet');
}
ok(await st(() => typeof MM.reports === 'object' && typeof MM.reports.ReportDocument === 'function'), 'MM.reports.ReportDocument exporteras');

console.log(`\n${passed} ok, ${failed} fel. Konsolfel: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await close();
process.exit(failed || errors.length ? 1 : 0);
