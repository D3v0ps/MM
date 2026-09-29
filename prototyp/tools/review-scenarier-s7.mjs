// Scenario s7: Månadsbedömning till kommunen
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s7');
const { page, S, main, dialog, check, note, shot } = T;
const caseId = await S(() => MM.store.state.script.nadia);
const repId = await S((id) => MM.store.state.reports.find((r) => r.caseId === id && r.kind === 'monthly' && r.month === '2027-01').id, caseId);

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'coach.manad'); });
await check('Steg 1: AI-förslag bredvid tom rullgardin', async () => {
  const empty = await S(() => [...document.querySelectorAll('#main select[id^=lvl-]')].every((s) => s.value === ''));
  assert.ok(empty, 'Någon nivå är förifylld'); const t = await T.mainText(); assert.match(t, /FÖRSLAG: \d/i);
});
await check('Steg 1: AI-utkastens källor pekar på godkända avstämningar', async () => {
  const t = await T.mainText(); const approved = (t.match(/GODKÄNDA AVSTÄMNINGAR\n\d+\n([^\n]+)/) || [])[1] || '';
  const srcs = [...new Set((t.match(/Källa: Avstämning [0-9]+ \w+/g) || []).map((x) => x.replace('Källa: Avstämning ', '')))];
  const bad = srcs.filter((s) => !approved.includes(s));
  if (bad.length) throw new Error(`Godkända avstämningar: ${approved}. AI-utkasten citerar avstämningar som inte finns: ${bad.join(', ')}`);
});
await check('Steg 1: AI-sammanfattningen stämmer med underlaget', async () => {
  const t = await T.mainText(); const narv = (t.match(/NÄRVAROGRAD\n[^\n]+\n([^\n]+)/) || [])[1]; const ai = (t.match(/Under januari har deltagaren[^\n]+/) || [''])[0];
  if (/11 av 12/.test(ai) && !/11 av 12/.test(narv || '')) throw new Error(`Underlaget: ${narv}. AI-utkastet: "${ai}"`);
});
await check('Steg 1: AI-observation om frånvaro trots 0 frånvaro', async () => {
  const t = await T.mainText(); if (/meddelat frånvaro i förväg vid två tillfällen/.test(t) && /100 %\n9 av 9/.test(t)) throw new Error('AI-utkast: "Har själv meddelat frånvaro i förväg vid två tillfällen" – men närvarograd 100 %, 9 av 9, ingen frånvaro i januari');
});
await shot('steg1');

await T.next();
await check('Steg 2: nivå 1 utan observation → stoppas', async () => {
  await page.selectOption('#lvl-attendance', '1').catch(async () => { const id = await S(() => document.querySelector('#main select[id^=lvl-]').id); await page.selectOption('#' + id, '1'); });
  await main.getByRole('button', { name: 'Godkänn bedömningen' }).click(); await page.waitForTimeout(150);
  const t = await T.mainText(); assert.match(t, /Skriv en konkret observation|kräver alltid belägg/); 
  return S(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join(' | '));
});
await shot('steg2-stopp', false);
// Fullfölj bedömningen (krävs för steg 3)
await check('Steg 2 (extra): fyll alla områden med AI-förslag + utkast och godkänn', async () => {
  const ids = await S(() => [...document.querySelectorAll('#main select[id^=lvl-]')].map((s) => s.id));
  for (const id of ids) {
    const key = id.slice(4); const row = main.locator('tr', { has: page.locator('#' + id) });
    const sug = ((await row.innerText()).match(/FÖRSLAG: (\d)/i) || [])[1] || '0';
    await page.selectOption('#' + id, sug);
    const use = row.getByRole('button', { name: 'Använd utkastet' }); if (await use.count()) await use.click();
  }
  await main.getByRole('button', { name: /^Grön/ }).click();
  await main.getByRole('button', { name: 'Använd utkastet' }).last().click();
  await main.getByRole('button', { name: 'Godkänn bedömningen' }).click(); await page.waitForTimeout(150);
  const t = await T.mainText(); assert.match(t, /Bedömningen är godkänd/i, (t.match(/[^\n]*(Skriv|Välj)[^\n]*/g) || []).slice(0, 3).join(' | '));
});

const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'rapport.visa'); assert.equal(r3.params.reportId, repId); });
await check('Steg 3: avsnitt 1–8 syns', async () => { const t = await T.mainText(); for (let i = 1; i <= 8; i++) assert.match(t, new RegExp(`\\n${i}\\. [A-ZÅÄÖ]`), `avsnitt ${i}`); assert.ok(!/Visas när coachen har godkänt/.test(t), 'avsnitt 4/7/8 fortfarande dolda'); });
await check('Steg 3: Godkänn', async () => { await main.getByRole('button', { name: 'Godkänn', exact: true }).click(); await page.waitForTimeout(150); return S((id) => MM.store.state.reports.find((r) => r.id === id).status, repId); });
await check('Steg 3: Leverera till kommunen', async () => {
  await main.getByRole('button', { name: 'Leverera till kommunen' }).click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Leverera i portalen' }).click(); await page.waitForTimeout(150);
  const s = await S((id) => MM.store.state.reports.find((r) => r.id === id).status, repId); assert.equal(s, 'delivered'); return s;
});
await shot('steg3');

const r4 = await T.next();
await check('Steg 4 route', () => { assert.equal(r4.view, 'kom.rapporter'); });
await check('Steg 4: rapporten överst bland olästa', async () => { const t = await T.mainText(); const i = t.indexOf('Månadsrapport januari 2027\nNy\nBOT-26-0143'); assert.ok(i >= 0, 'syns inte'); return i; });
await check('Steg 4: öppna rapporten', async () => {
  await main.getByRole('button', { name: /Månadsrapport januari 2027\s+Ny\s+BOT-26-0143/ }).first().click(); await page.waitForTimeout(200);
  const r = await T.route(); assert.equal(r.view, 'rapport.visa'); const t = await T.mainText(); assert.match(t, /kvitterad/i);
  assert.ok(!/35 %|internt mål/i.test(t), 'internt mål syns för kunden');
});
await check('Steg 4: kvitterad i tillståndet', () => S((id) => { const r = MM.store.state.reports.find((x) => x.id === id); if (!r.openedAt) throw new Error('inte kvitterad'); return r.status + ' ' + r.openedAt; }, repId));
await check('Steg 4: kunden ser inte coachens anteckningar i rapporten', async () => { const t = await T.mainText(); return t.length; });
await shot('steg4');
await T.done();
