// Interaktionstest för src/views/ekonomi.js (eko.start, eko.korning, eko.faktura, eko.arende).
// Kör: node tools/test-ekonomi.mjs
import { openProto, visit } from './lib.mjs';

const { page, errors, close } = await openProto();
let failed = 0; let passed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ok   ${msg}`); } else { failed++; console.log(`  FEL  ${msg}`); } };
const S = (fn, arg) => page.evaluate(fn, arg);
const modal = () => page.locator('.modal').last();
const clickBtn = async (name, scope = page) => { await scope.getByRole('button', { name }).first().click(); await page.waitForTimeout(80); };
const confirmDialog = async (label) => { await modal().getByRole('button', { name: label }).click(); await page.waitForTimeout(120); };
// innerText följer text-transform (versala rubriker) – jämför därför utan hänsyn till skiftläge.
const mainText = async () => { const x = await page.locator('#main').innerText(); return { raw: x, includes: (s) => x.toLowerCase().includes(String(s).toLowerCase()) }; };

try {
  const sc = await S(() => MM.store.state.script);
  const inv = (month, caseId) => S(({ month, caseId }) => { const i = MM.sel.billingForMonth(month).invoices.find((x) => x.caseId === caseId); return i ? { status: i.status, blocked: i.blocked, needsApproval: i.needsApproval, checks: i.checks.map((c) => `${c.kind}:${c.severity}`) } : null; }, { month, caseId });

  console.log('1. Startsidan som ekonom');
  let probs = await visit(page, 'ekonom', 'eko.start', {});
  ok(!probs.length, `eko.start renderar utan problem ${probs.join(', ')}`);
  let t = await mainText();
  ok(/511\s332\skr/.test(t.raw), 'Januari att fakturera visar totalen 511 332 kr');
  ok(t.includes('Ofakturerade veckor äldre än 45 dagar') && t.includes('Risk för preskription'), 'Preskriptionsvarning visas');
  ok(t.includes('Returnerade fakturor') && t.includes('BOT-26-0117'), 'Returnerade decemberfakturor visas');
  ok(t.includes('Uppgifter till dig') && t.includes('55102938'), 'Uppgiften från avtalsansvarig visas med rätt referens');
  ok(t.includes('Byggs i fas 2') && t.includes('Fortnox-synk'), 'Fortnox-synk märkt som fas 2');

  console.log('2. Körningen januari: rätta stoppad faktura i radens detalj');
  probs = await visit(page, 'ekonom', 'eko.korning', { month: '2027-01' });
  ok(!probs.length, 'eko.korning renderar');
  t = await mainText();
  ok(/torsdag/.test(t.raw) && /v\. 53 2026/i.test(t.raw) && /december 2026/.test(t.raw), 'Förklaring av torsdagsregeln (v. 53 hör till december)');
  ok(t.includes('Samlingsfakturor är inte tillåtna'), 'Samlingsfakturor förklaras som inte tillåtna');
  await page.getByRole('tab', { name: /Stoppade/ }).click(); await page.waitForTimeout(80);
  ok(await page.locator('table.table tbody tr').count() === 2, 'Filtret Stoppade visar två fakturor');
  await page.locator('tr', { hasText: 'BOT-26-0117' }).first().click(); await page.waitForTimeout(120);
  ok(await modal().isVisible(), 'Radens detalj öppnas');
  const refInput = modal().locator(`#eko-ref-detail-${sc.reffel1}`);
  await refInput.fill('55102983'); await clickBtn('Spara referensen', modal());
  ok((await modal().innerText()).includes('spärrad'), 'Spärrad referens ger felmeddelande');
  ok(await S((id) => MM.sel.caseById(id).buyerReference, sc.reffel1) === '55102983', 'Tillståndet är oförändrat efter fel');
  await refInput.fill('12 34'); await clickBtn('Spara referensen', modal());
  ok((await modal().innerText()).includes('bara innehålla siffror'), 'Formatfel från MM.valid.buyerRefError visas');
  await clickBtn(/Använd 55102938 från uppgiften/, modal());
  ok(await refInput.inputValue() === '55102938', 'Referensen från uppgiften fylls i när användaren väljer det');
  await clickBtn('Spara referensen', modal());
  ok(await S((id) => MM.sel.caseById(id).buyerReference, sc.reffel1) === '55102938', 'case.setBuyerRef sparade rätt referens');
  let i1 = await inv('2027-01', sc.reffel1);
  ok(i1 && !i1.blocked && i1.status === 'draft', 'Fakturan är inte längre stoppad');
  await clickBtn('Stäng', modal()); await page.waitForTimeout(80);

  console.log('3. Godkänn vecka utan närvaro med kommentar');
  await page.getByRole('tab', { name: /^Alla/ }).click();
  await page.locator('#eko-search').fill('0157'); await page.waitForTimeout(80);
  await page.locator('tr', { hasText: 'BOT-26-0157' }).first().click(); await page.waitForTimeout(120);
  await clickBtn('Godkänn veckan för fakturering', modal());
  ok((await modal().innerText()).includes('Skriv en kort kommentar'), 'Kommentar krävs');
  await modal().locator('textarea').first().fill('Kontrollerat med samordnaren – inskriven hela veckan enligt beställningen.');
  await clickBtn('Godkänn veckan för fakturering', modal());
  const zkey = await S((id) => Object.keys(MM.store.state.billingApprovals['2027-01'].zeroWeeks).find((k) => k.startsWith(id)), sc.noll1);
  ok(!!zkey, `billing.approveZeroWeek sparade godkännandet (${zkey})`);
  ok((await modal().innerText()).includes('Godkänd av Lars Nyström'), 'Godkännandet visas med vem och kommentar');
  await clickBtn('Godkänn fakturan', modal());
  ok((await inv('2027-01', sc.noll1)).status === 'approved', 'Fakturan kan godkännas när veckan är godkänd');
  await clickBtn('Stäng', modal());

  console.log('4. Överlapp: fråga samordnaren och godkänn med bekräftelse');
  await page.locator('#eko-search').fill('0131'); await page.waitForTimeout(80);
  await page.locator('tr', { hasText: 'BOT-26-0131' }).first().click(); await page.waitForTimeout(120);
  ok((await modal().innerText()).includes('BOT-27-0004'), 'Överlappande ärende visas');
  const tasksBefore = await S(() => MM.store.state.tasks.length);
  await clickBtn('Fråga samordnaren', modal());
  const q = await S(() => MM.store.state.tasks[MM.store.state.tasks.length - 1]);
  ok(await S(() => MM.store.state.tasks.length) === tasksBefore + 1 && q.toRole === 'samordnare', 'eko.askCoordinator skapade en uppgift till samordnaren');
  const names = await S(() => MM.store.state.persons.filter((p) => ['case-260131'].includes((MM.store.state.cases.find((c) => c.personId === p.id) || {}).id)).map((p) => p.lastName));
  ok(!names.some((n) => q.text.includes(n)), 'Frågan innehåller inga namn');
  ok(await modal().getByRole('button', { name: 'Godkänn fakturan' }).isDisabled(), 'Godkänn är låst tills anmärkningarna bekräftats');
  await modal().locator(`#eko-rem-${sc.overlapGammal}`).check(); await page.waitForTimeout(60);
  await clickBtn('Godkänn fakturan', modal());
  ok((await inv('2027-01', sc.overlapGammal)).status === 'approved', 'Fakturan med anmärkning godkändes');
  await clickBtn('Stäng', modal());
  await page.locator('#eko-search').fill(''); await page.waitForTimeout(60);

  console.log('5. Masshandlingar: godkänn alla utan anmärkning, skapa i Fortnox, idempotens, statussynk');
  const blockedLeft = await S(() => MM.sel.billingForMonth('2027-01').blocked);
  ok(blockedLeft === 1, 'En faktura är fortfarande stoppad (BOT-26-0121)');
  await clickBtn(/Godkänn alla utan anmärkning/);
  await confirmDialog(/Godkänn \d+ fakturor/);
  const counts = await S(() => { const b = MM.sel.billingForMonth('2027-01'); const by = {}; for (const i of b.invoices) by[i.status] = (by[i.status] || 0) + 1; return by; });
  ok(counts.approved >= 110, `Fakturor utan anmärkning godkändes (${counts.approved})`);
  ok(counts.blocked === 1, 'Stoppade fakturor godkändes inte');
  await clickBtn(/Skapa i Fortnox \(\d+\)/);
  await confirmDialog(/Skapa \d+ fakturor/);
  const afterFx = await S(() => { const b = MM.sel.billingForMonth('2027-01'); const by = {}; for (const i of b.invoices) by[i.status] = (by[i.status] || 0) + 1; return { by, runs: MM.store.state.ekoFortnox.runs.length, keys: Object.keys(MM.store.state.ekoFortnox.keys).length }; });
  ok(afterFx.by.fortnox_created === counts.approved && !afterFx.by.approved, `Alla godkända skapades i Fortnox (${afterFx.by.fortnox_created})`);
  ok(afterFx.by.blocked === 1, 'Stoppad faktura skapades inte');
  const blockedStatus = await S((id) => MM.store.state.invoiceStatus['2027-01'][id] || null, sc.reffel2);
  ok(blockedStatus === null, 'billing.sendFortnox fick aldrig den stoppade fakturan');
  await clickBtn(/Skapa i Fortnox \(0\)/);
  await confirmDialog('Kör ändå');
  const rerun = await S(() => { const f = MM.store.state.ekoFortnox; const b = MM.sel.billingForMonth('2027-01'); return { runs: f.runs.length, last: f.runs[f.runs.length - 1], created: b.invoices.filter((i) => i.status === 'fortnox_created').length }; });
  ok(rerun.runs === 2 && rerun.last.created === 0 && rerun.last.skipped === afterFx.by.fortnox_created, 'Omkörning skapar inga dubbletter och loggar överhoppade');
  ok(rerun.created === afterFx.by.fortnox_created, 'Antal skapade fakturor är oförändrat efter omkörning');
  await clickBtn('Hämta status från Fortnox');
  ok(await S(() => MM.sel.billingForMonth('2027-01').invoices.filter((i) => i.status === 'booked').length) === afterFx.by.fortnox_created, 'Statussynk: skapad → bokförd');
  await clickBtn('Hämta status från Fortnox'); await clickBtn('Hämta status från Fortnox');
  ok(await S(() => MM.sel.billingForMonth('2027-01').invoices.filter((i) => i.status === 'paid').length) === afterFx.by.fortnox_created, 'Statussynk: bokförd → skickad → betald');
  t = await mainText();
  ok(t.includes('Fortnox-körningar') && /dubbletter hoppades över/.test(t.raw), 'Fortnox-körningarna visas med idempotens');

  console.log('6. Reservväg: CSV-export och manuellt fakturerad');
  await clickBtn('Exportera underlag (CSV)'); await page.waitForTimeout(200);
  const csv = await page.locator('#text-modal-area').inputValue();
  ok(csv.startsWith('Ärendenummer (faktureringsobjekt);') && csv.includes('BOT-26-0143'), 'CSV innehåller underlaget');
  const nadiaName = await S((id) => { const p = MM.sel.person(id); return [p.firstName, p.lastName]; }, sc.nadia);
  ok(!nadiaName.some((n) => csv.includes(n)), 'CSV innehåller inga namn');
  ok(await S(() => MM.store.state.auditLog.some((a) => a.action === 'export.billing' && a.byTester)), 'billing.export loggades');
  await clickBtn('Stäng', modal());
  await clickBtn('Markera som manuellt fakturerad');
  await clickBtn('Spara', modal());
  ok((await modal().innerText()).includes('Välj vilket ärende'), 'Val av ärende krävs');
  await modal().locator('#eko-manual-case').selectOption(sc.nadia);
  await modal().locator('#eko-manual-no').fill('12a');
  await clickBtn('Spara', modal());
  ok((await modal().innerText()).includes('3–10 siffror'), 'Fakturanummer valideras');
  await modal().locator('#eko-manual-no').fill('20417');
  await clickBtn('Spara', modal());
  ok(await S((id) => MM.store.state.invoiceStatus['2027-01'][id], sc.nadia) === 'manual' && await S((id) => MM.store.state.billingApprovals['2027-01'].manual[id], sc.nadia) === '20417', 'billing.markManual sparade status och fakturanummer');

  console.log('7. Fakturans förhandsvisning (Peppol)');
  probs = await visit(page, 'ekonom', 'eko.faktura', { month: '2027-01', caseId: sc.pausad });
  ok(!probs.length, 'eko.faktura renderar');
  t = await mainText();
  ok(t.includes('BuyerReference') && t.includes('OrderReference') && t.includes('Er referens') && t.includes('Ert ordernummer'), 'Fältmappningen visas');
  ok(t.includes('BOT-26-0132 · v. 1, 3–4 2027'), 'Radtexten visar veckorna utan den pausade veckan');
  ok(t.includes('Att betala') && t.includes('Moms 25 %') && t.includes('Betalningsvillkor 30 dagar'), 'Summor, moms och betalningsvillkor visas');
  ok(t.includes('Beställning BOT-26-0132: planerat'), 'Fakturatext med upparbetat och återstående visas');
  const pausName = await S((id) => { const p = MM.sel.person(id); return [p.firstName, p.lastName]; }, sc.pausad);
  ok(!pausName.some((n) => t.raw.includes(n)), 'Fakturan innehåller inga namn');
  ok(!t.includes('Sjukhusvistelse'), 'Pausorsaken (hälsouppgift) visas inte');

  console.log('8. Ekonomens ärendevy');
  probs = await visit(page, 'ekonom', 'eko.arende', { caseId: sc.nadia });
  ok(!probs.length, 'eko.arende renderar');
  t = await mainText();
  ok(!nadiaName.some((n) => t.raw.includes(n)), 'Inga namn i ärendevyn');
  ok(t.includes('Beställning') && t.includes('Upparbetat') && t.includes('Återstående') && t.includes('Debiterbara veckor per månad'), 'Beställning, upparbetat, återstående och veckor per månad visas');
  ok(t.includes('Manuellt fakturerad'), 'Januari visas som manuellt fakturerad');
  probs = await visit(page, 'ekonom', 'eko.arende', {});
  ok(!probs.length && (await mainText()).includes('Sök ärendenummer'), 'Utan caseId visas ärendesök');

  console.log('9. Startsidan: uppgift, rätta i båda ärendena, kreditera returnerade');
  await visit(page, 'ekonom', 'eko.start', {});
  await clickBtn('Rätta referensen');
  await clickBtn(/Använd 55102938/, modal());
  const lead = await modal().locator('.modal-body > p').first().innerText();
  ok(lead.includes('BOT-26-0121') && !lead.includes('BOT-26-0117'), 'Modalen gäller bara ärendet som fortfarande har fel referens');
  await clickBtn(/^Spara/, modal());
  ok(await S((id) => MM.sel.caseById(id).buyerReference, sc.reffel2) === '55102938', 'Referensen rättades för det andra ärendet via uppgiften');
  const before = await S(() => MM.sel.unbilledOld().length);
  await clickBtn('Kreditera och skapa ny'); await clickBtn('Kreditera och skapa ny');
  const dec = await S((ids) => ids.map((id) => MM.store.state.invoiceStatus['2026-12'][id]), [sc.reffel1, sc.reffel2]);
  ok(dec.every((x) => x === 'fortnox_created'), 'eko.reissue: decemberfakturorna krediterades och skapades på nytt');
  ok(await S(() => MM.sel.unbilledOld().length) < before, 'Preskriptionsvarningen försvann för de omfakturerade veckorna');
  await clickBtn('Markera som klar');
  ok(await S(() => MM.store.state.tasks.find((x) => x.id === 'task-1').status) === 'done', 'eko.taskDone markerade uppgiften som klar');

  console.log('10. Chef ser läsläge');
  probs = await visit(page, 'chef', 'eko.korning', { month: '2027-01' });
  ok(!probs.length, 'Chef kan öppna körningen');
  ok(await page.getByRole('button', { name: /Godkänn alla utan anmärkning/ }).count() === 0, 'Chef har inga knappar för att godkänna');
  ok((await mainText()).includes('Läsläge'), 'Läsläge förklaras');

  console.log('11. Tillståndet spelas upp igen efter omladdning');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.MM && MM.store && MM.store.state && document.querySelector('.protobar'));
  const replay = await S((ids) => ({ ref: MM.sel.caseById(ids[0]).buyerReference, runs: (MM.store.state.ekoFortnox || { runs: [] }).runs.length, manual: MM.store.state.invoiceStatus['2027-01'][ids[1]] }), [sc.reffel2, sc.nadia]);
  ok(replay.ref === '55102938' && replay.runs === 2 && replay.manual === 'manual', 'Åtgärderna är deterministiska och spelas upp igen');
} catch (e) {
  failed++; console.log('  FEL  Undantag:', e.message);
}
ok(errors.length === 0, `Inga konsolfel (${errors.join(' | ')})`);
console.log(`\n${passed} ok, ${failed} fel.`);
await close();
process.exit(failed ? 1 : 0);
