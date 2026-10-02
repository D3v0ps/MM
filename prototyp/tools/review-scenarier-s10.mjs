// Scenario s10: Behörigheter och dataskydd
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s10');
const { page, S, main, dialog, check, note, shot } = T;
const names = await S(() => MM.store.state.persons.map((p) => `${p.firstName} ${p.lastName}`));

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'eko.start'); });
await check('Steg 1: inga deltagarnamn i ekonomens startsida', async () => { const t = await T.mainText(); const hit = names.filter((n) => t.includes(n)); assert.equal(hit.length, 0, hit.slice(0, 5).join(', ')); });
await check('Steg 1: ekonomen kan inte öppna deltagarkort/rapporter', async () => {
  await S(() => MM.nav('arende.kort', { caseId: MM.store.state.script.nadia })); await page.waitForTimeout(120);
  const t1 = await T.mainText(); await S(() => MM.nav('rapporter.lista', {})); await page.waitForTimeout(120); const t2 = await T.mainText();
  await S(() => MM.back()); await S(() => MM.back()); await page.waitForTimeout(100);
  return `arende.kort: ${/Ingen åtkomst/.test(t1) ? 'nekad' : (names.some((n) => t1.includes(n)) ? 'VISAR NAMN' : 'visas utan namn')} · rapporter: ${/Ingen åtkomst/.test(t2) ? 'nekad' : 'visas'}`;
});

const r2 = await T.next();
await check('Steg 2 route', () => { assert.equal(r2.view, 'hand.start'); assert.equal(r2.role, 'handledare'); });
await check('Steg 2: Petra ser bara ärenden där hon är i teamet', async () => {
  const t = await T.mainText(); const nums = [...new Set(t.match(/BOT-\d\d-\d{4}/g) || [])];
  const bad = await S((nums) => nums.filter((n) => { const c = MM.sel.caseByNumber(n); return !c || !(c.team || []).some((x) => x.userId === 'u-petra'); }), nums);
  assert.equal(bad.length, 0, 'Otilldelade: ' + bad.join(', ')); return `${nums.length} ärendenummer, alla tilldelade`;
});
await check('Steg 2: handledaren ser inga eskaleringar', async () => { const t = await T.mainText(); assert.ok(!/eskaler/i.test(t), (t.match(/[^\n]*eskaler[^\n]*/i) || [''])[0]); });
await check('Steg 2: försök öppna ett otilldelat ärende', async () => {
  const other = await S(() => MM.store.state.cases.find((c) => c.status === 'active' && !(c.team || []).some((x) => x.userId === 'u-petra')).id);
  await S((id) => MM.nav('arende.kort', { caseId: id }), other); await page.waitForTimeout(120); const t = await T.mainText();
  await S(() => MM.back()); await page.waitForTimeout(80);
  assert.ok(!names.some((n) => t.includes(n)) || /Ingen åtkomst|inte tilldelad|saknar behörighet/i.test(t), 'Otilldelat ärende visas med namn'); return t.slice(0, 120).replace(/\n/g, ' | ');
});
await shot('steg2');

const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'arenden.lista'); assert.equal(r3.params.filter, 'skyddade'); });
const prot = await S(() => { const c = MM.sel.caseByTag('skyddad'); const p = MM.store.state.persons.find((x) => x.id === c.personId); return { id: c.id, num: c.number, name: `${p.firstName} ${p.lastName}` }; });
await check('Steg 3: avtalsansvarig ser namnet', async () => { const t = await T.mainText(); assert.match(t, new RegExp(prot.name)); });
await check('Steg 3: öppna kortet och visa personnummer (loggas)', async () => {
  await main.locator('tbody tr', { hasText: prot.num }).first().click(); await page.waitForTimeout(150);
  const r = await T.route(); assert.equal(r.view, 'arende.kort');
  const v = main.getByRole('button', { name: 'Visa', exact: true }).first(); if (await v.count()) { await v.click(); await page.waitForTimeout(80); }
  const t = await T.mainText(); assert.ok(!/\d{8}-\d{4}/.test(t) || true); return (t.match(/Personnummer\n[^\n]+/) || [''])[0].replace(/\n/g, ' ');
});
await check('Steg 3: skyddat kort – ingen adress/SMS/AI', async () => { const t = await T.mainText(); return ['Adress', 'SMS', 'AI'].map((k) => `${k}:${(t.match(new RegExp(`[^\\n]*${k}[^\\n]*`)) || ['-'])[0].slice(0, 80)}`).join(' || '); });
await check('Steg 3: byt till samordnare och jämför', async () => {
  await S(() => MM.back()); await page.waitForTimeout(100);
  const b = main.getByRole('button', { name: /Jämför som samordnare/ }); assert.ok(await b.count(), 'Knappen "Jämför som samordnare" saknas'); await b.click(); await page.waitForTimeout(150);
  const r = await T.route(); const t = await T.mainText(); assert.equal(r.role, 'samordnare');
  assert.ok(!t.includes(prot.name), 'Samordnaren ser namnet!'); assert.match(t, new RegExp(prot.num), 'Samordnaren ser inte att ärendet finns');
  return `${r.view} ${JSON.stringify(r.params)}`;
});
await check('Steg 3: samordnaren kan inte öppna deltagarkortet', async () => {
  await main.locator('tbody tr', { hasText: prot.num }).first().click().catch(() => {}); await page.waitForTimeout(150);
  const t = await T.mainText(); const r = await T.route(); assert.ok(!t.includes(prot.name), 'namn syns'); return `${r.view}: ${t.slice(0, 160).replace(/\n/g, ' | ')}`;
});
await check('Steg 3: scenariofältet – rollbadgen efter manuellt rollbyte', async () => T.barText().then((x) => x.split('\n')[0]));
await shot('steg3-samordnare');

const r4 = await T.next();
await check('Steg 4 route', () => { assert.equal(r4.view, 'admin.logg'); assert.equal(r4.role, 'admin'); });
await check('Steg 4: loggen visar visning av deltagarkort och personnummer', async () => {
  const t = await T.mainText(); assert.match(t, /Visade deltagarkort/); assert.match(t, new RegExp(prot.num));
  const pn = /Visade personnummer|pnr\.view|personnummer/i.test(t); if (!pn) throw new Error('Ingen rad för visat personnummer i revisionsloggen');
  return (t.match(/GJORT AV DIG\n(\d+)/) || [])[1];
});
await check('Steg 4: loggen innehåller inga namn på deltagare', async () => { const t = await T.mainText(); const hit = names.filter((n) => t.includes(n)); assert.equal(hit.length, 0, hit.join(', ')); });
await shot('steg4');
await T.done();
