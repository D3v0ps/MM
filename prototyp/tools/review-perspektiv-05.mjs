// Granskning (perspektiv) 05: fakturabelopp i eko.korning, eko.faktura och eko.arende.
import { openProto, visit } from './lib.mjs';
const { page, errors, close } = await openProto();
const txt = async () => page.evaluate(() => (document.querySelector('#main') || document.body).innerText);
const around = (t, s, a = 60, b = 200) => { const i = t.indexOf(s); return i < 0 ? `(saknas: ${s})` : t.slice(Math.max(0, i - a), i + b).replace(/\n/g, ' ⏎ '); };
const sc = await page.evaluate(() => MM.store.state.script);
for (const tag of ['nadia', 'pausad', 'overlapNy', 'reffel1']) {
  const id = sc[tag];
  const inv = await page.evaluate((id) => { const i = MM.sel.billingForMonth('2027-01').invoices.find((x) => x.caseId === id); return i && { n: i.number, q: i.quantity, p: i.unitPriceOre, a: i.amountOre, st: i.status, acc: i.accruedOre, rem: i.remainingOre }; }, id);
  console.log(`\n### ${tag}`, JSON.stringify(inv));
  await visit(page, 'ekonom', 'eko.korning', { month: '2027-01' });
  const k = await txt(); console.log('korning:', around(k, inv.n, 10, 180));
  await visit(page, 'ekonom', 'eko.faktura', { month: '2027-01', caseId: id });
  const f = await txt(); console.log('faktura rad:', around(f, 'FAKTURARADER', 0, 260)); console.log('faktura text:', around(f, 'FAKTURATEXT', 0, 220));
  await visit(page, 'ekonom', 'eko.arende', { caseId: id });
  const a = await txt(); console.log('arende KPI:', around(a, 'BESTÄLLNING', 0, 330)); console.log('arende jan:', around(a, 'Januari 2027', 0, 140));
}
console.log('\nFEL:', JSON.stringify(errors));
await close();
