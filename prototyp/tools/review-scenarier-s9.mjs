// Scenario s9: Ledningens vy och kundens vy
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s9');
const { page, S, main, dialog, check, note, shot } = T;

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'chef.oversikt'); });
let mbRate;
await check('Steg 1: resultatgrad mellan 32 och 35 % och prognos syns', async () => {
  const t = await T.mainText(); const m = t.match(/RESULTATGRAD, RULLANDE 6 MÅN\n([\d,]+) %/); mbRate = m && m[1];
  const v = Number(mbRate.replace(',', '.')); assert.ok(v < 35 && v >= 32, `värde ${v}`); assert.match(t, /PROGNOS\n[\d,]+ %/); return mbRate;
});
let mbClaim;
await check('Steg 1: "Så ser kommunens chef resultatet"', async () => { const t = await T.mainText(); mbClaim = (t.match(/SÅ SER KOMMUNENS CHEF RESULTATET\n+([^\n]+)/) || [])[1]; return mbClaim; });
await shot('steg1');

await T.next();
const acksBefore = await S(() => Object.keys(MM.store.state.alertAcks || {}).length);
await check('Steg 2: Kvittera flaggan → modal med åtgärdsplan', async () => {
  await main.getByRole('button', { name: 'Kvittera flaggan' }).click(); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Kvittera med åtgärdsplan' }).click(); await page.waitForTimeout(80);
  const err = (await dialog.innerText()).match(/Skriv en kort åtgärdsplan[^\n]*/); assert.ok(err, 'tom plan borde stoppas');
  await page.fill('#ldg-ack-plan', 'Genomgång av fas 5-ärenden med coacherna torsdag. Karin följer upp om två veckor.');
  await dialog.getByRole('button', { name: 'Kvittera med åtgärdsplan' }).click(); await page.waitForTimeout(120);
  const n = await S(() => Object.keys(MM.store.state.alertAcks || {}).length); assert.equal(n, acksBefore + 1);
});
await check('Steg 2: flaggan visas som kvitterad', async () => { const t = await T.mainText(); assert.match(t, /Kvitterade flaggor \(1\)/); return (t.match(/FLAGGOR FÖR CHEF OCH CONTROLLER\n[^\n]+/) || [''])[0].replace(/\n/, ' '); });
await shot('steg2');

const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'chef.avvikelser'); });
await check('Steg 3: varningar 0 av 3, åtgärdsplaner', async () => { const t = await T.mainText(); assert.match(t, /0 av 3/); assert.match(t, /Åtgärdsplan|ÅTGÄRDSPLAN/i); });

const r4 = await T.next();
await check('Steg 4 route', () => { assert.equal(r4.view, 'kom.chef'); assert.equal(r4.role, 'kommun_chef'); });
await check('Steg 4: inget internt mål (35 %) eller prognos i kundens vy', async () => { const t = await T.mainText(); assert.ok(!/internt mål|Internt mål|prognos/i.test(t), 'internt/prognos syns'); assert.ok(!/\b35 %/.test(t), '35 % syns'); assert.match(t, /Avtalsmål 32 %/); });
await check('Steg 4: samma resultat som ledningsvyn påstår att kommunens chef ser', async () => {
  const t = await T.mainText(); const kom = (t.match(/RESULTAT, 6 MÅNADER\n([\d,]+ %)/i) || [])[1]; if (!kom) throw new Error('hittar inte resultatet: ' + t.slice(0, 1500)); const status = /Under avtalsmålet/.test(t) ? 'Under avtalsmålet' : '';
  if (mbClaim && kom && !mbClaim.includes(kom)) throw new Error(`Ledningsvyn: "${mbClaim}". Kommunens chef ser: ${kom} (${status}) för december 2026 – januari är utkast.`);
});
await check('Steg 4: kan kommunens chef välja januari?', async () => {
  const b = main.getByRole('button', { name: /Januari 2027/ }); const n = await b.count(); if (!n) return 'ingen knapp';
  await b.first().click(); await page.waitForTimeout(120); const t = await T.mainText(); return (t.match(/RESULTAT, 6 MÅNADER\n[^\n]+\n[^\n]+/) || [t.slice(0, 200)])[0].replace(/\n/g, ' | ');
});
await shot('steg4');
await T.done();
