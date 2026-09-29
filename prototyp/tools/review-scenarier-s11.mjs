// Scenario s11: Deltagarens röst
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s11', { width: 1280 });
const { page, S, main, check, note, shot } = T;
const ph = page.locator('.pulse-phone');

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'puls.svar'); assert.equal(r1.role, 'deltagare'); });
const before = await S(() => ({ n: MM.store.state.pulseResponses.length, stats: MM.sel.pulseStats() }));
await check('Steg 1: byt språk engelska/arabiska/somaliska', async () => {
  const out = [];
  for (const l of ['English', 'العربية', 'Soomaali', 'Svenska']) { await ph.getByRole('button', { name: l }).click(); await page.waitForTimeout(60); out.push(`${l}: ${(await ph.locator('h1').innerText())} dir=${await ph.getAttribute('dir')}`); }
  return out;
});
await check('Steg 1: svara på fem frågor (lågt betyg på stödet, vill bli kontaktad)', async () => {
  await ph.getByRole('button', { name: 'Börja' }).click();
  await ph.getByRole('button', { name: /^4 –/ }).click(); await ph.getByRole('button', { name: 'Nästa' }).click();
  await ph.getByRole('button', { name: /^3 –/ }).click(); await ph.getByRole('button', { name: 'Nästa' }).click();
  await ph.getByRole('button', { name: /^2 –/ }).click(); await ph.getByRole('button', { name: 'Nästa' }).click();
  await ph.getByRole('button', { name: /Praktik/ }).click(); await ph.getByRole('button', { name: 'Nästa' }).click();
  await ph.getByRole('button', { name: 'Ja', exact: true }).click(); await page.fill('#pulse-text', 'Jag vill prata om praktiken.');
  await ph.getByRole('button', { name: 'Skicka svar' }).click(); await page.waitForTimeout(150);
  const t = await ph.innerText(); assert.match(t, /Tack/); return t.slice(0, 120).replace(/\n/g, ' | ');
});
await shot('steg1', false);
const after = await S(() => ({ n: MM.store.state.pulseResponses.length, last: MM.store.state.pulseResponses.slice(-1)[0] }));
await check('Steg 1: svaret sparat', () => { assert.equal(after.n, before.n + 1); return after.last.answers; });

const r2 = await T.next();
await check('Steg 2 route', () => { assert.equal(r2.view, 'chef.oversikt'); assert.equal(r2.params.tab, 'puls'); });
await check('Steg 2: det nya svaret räknas i sammanställningen', async () => {
  const t = await T.mainText(); const m = t.match(/(\d+) svar på (\d+) utskick/); return m && m[0];
});
await check('Steg 2: nytt lågt betyg på stödet syns för chefen (dagens datum)', async () => {
  const t = await T.mainText(); const m = t.match(/Ett svar 1 feb 2027 gav 2 av 5[^\n]*/); assert.ok(m, 'Flaggan för dagens låga betyg syns inte under Lågt betyg'); return m[0];
});
await check('Steg 2: coachen ser inte enskilda svar', async () => {
  await S(() => MM.nav('coach.minvecka', {}, { role: 'coach' })); await page.waitForTimeout(120); const t = await T.mainText();
  await S(() => MM.gotoStep(1)); await page.waitForTimeout(100);
  assert.ok(!/Lågt betyg|2 av 5/.test(t)); 
});
await check('Steg 2: samordnaren får uppgift om kontakt', () => S(() => MM.store.state.tasks.filter((x) => x.kind === 'pulse_contact' && x.status === 'open').map((x) => x.text.slice(0, 90))));
await check('Steg 2: samordnaren ser uppgiften på sin startsida', async () => {
  await S(() => MM.nav('sam.start', {}, { role: 'samordnare' })); await page.waitForTimeout(150); const t = await T.mainText(); await S(() => MM.gotoStep(1)); await page.waitForTimeout(100);
  assert.match(t, /vill bli kontaktad/i); return (t.match(/[^\n]*vill bli kontaktad[^\n]*/i) || [''])[0];
});
await shot('steg2');
await T.done();
