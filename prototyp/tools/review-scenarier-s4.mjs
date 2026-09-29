// Scenario s4: Coachens måndag och veckorapporten
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s4');
const { page, S, main, dialog, check, note, shot } = T;

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'coach.minvecka'); assert.equal(r1.role, 'coach'); });
await check('Steg 1: "tre tillfällen från förra veckan saknar närvaro"', async () => {
  const t = await T.mainText(); const m = t.match(/(\d+) tillfällen från förra veckan saknar närvaro/);
  if (!m || m[1] !== '3') throw new Error(`Vyn säger "${m ? m[0] : '?'}" – scenariot säger tre`);
});
await check('Steg 1: nedräkning till 10.00 syns', async () => { const t = await T.mainText(); return t.match(/senast måndag 10\.00 · [^\n]+/)?.[0]; });
await shot('steg1');
await check('Steg 1: knappen Registrera närvaro leder till närvarovyn', async () => {
  await main.getByRole('button', { name: /Registrera närvaro/ }).first().click(); await page.waitForTimeout(150);
  const r = await T.route(); assert.equal(r.view, 'coach.narvaro'); return r.params;
});

const r2 = await T.next();
await check('Steg 2 route', () => { assert.equal(r2.view, 'coach.narvaro'); assert.equal(r2.params.week, 'last'); });
await check('Steg 2: vyn motsäger inte publiceringsregeln (Linda: "kvar" men redan publicerad)', async () => {
  const t = await T.mainText(); const m = t.match(/Linda Karlsson\n[^\n]*\n[^\n]*/); 
  if (m && /tillfällen kvar/.test(m[0]) && /Publicerad/.test(m[0])) throw new Error(m[0].replace(/\n/g, ' | '));
});
const before = await S(() => MM.store.state.reports.filter((r) => r.kind === 'weekly_attendance' && r.week === '2027-W04').map((r) => r.recipientUserId + ':' + r.status));
note('OBS', 'Veckorapporter v4 före: ' + before.join(', '));
let clicks = 0;
await check('Steg 2: registrera alla sex med ett klick var (Närvarande)', async () => {
  for (let i = 0; i < 12; i++) {
    const btn = main.getByRole('button', { name: 'Närvarande', exact: true });
    const n = await S(() => [...document.querySelectorAll('#main .co-att:not(.is-done)')].length);
    if (!n) break;
    await main.locator('.co-att:not(.is-done)').first().getByRole('button', { name: 'Närvarande', exact: true }).click(); clicks++; await page.waitForTimeout(80);
  }
  const left = await S(() => MM.sel.unregistered('u-amira', '2027-01-25', '2027-02-01').length);
  assert.equal(left, 0, `${left} kvar`); return `${clicks} klick`;
});
const toasts = await S(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText));
note('OBS', 'Toasts: ' + toasts.join(' || '));
const after = await S(() => MM.store.state.reports.filter((r) => r.kind === 'weekly_attendance' && r.week === '2027-W04').map((r) => r.recipientUserId + ':' + r.status + ':' + r.deliveredAt));
await check('Steg 2: veckorapporten till Maria publiceras automatiskt', () => { assert.ok(after.some((x) => /^k-maria:delivered/.test(x)), after.join(', ')); return after; });
await check('Steg 2: vyn visar att Marias rapport är publicerad', async () => { const t = await T.mainText(); const m = t.match(/Maria Ekdahl\n[^\n]*\n[^\n]*/); assert.match(m[0], /Publicerad/); return m[0].replace(/\n/g, ' | '); });
await shot('steg2-klar');

const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'kom.rapporter'); assert.equal(r3.role, 'kommun_handlaggare'); });
await check('Steg 3: "på väg"-rutan är borta', async () => { const t = await T.mainText(); assert.ok(!/vecka 4 är på väg/.test(t), 'Visar fortfarande "Veckorapport närvaro, vecka 4 är på väg"'); });
await check('Steg 3: veckorapport vecka 4 finns i listan och kan öppnas', async () => {
  const b = main.getByRole('button', { name: /Veckorapport närvaro, vecka 4/ }); assert.ok(await b.count(), 'Ingen knapp för vecka 4 i listan');
  await b.first().click(); await page.waitForTimeout(200);
  const r = await T.route(); const t = await T.mainText(); return `${r.view} ${JSON.stringify(r.params)} :: ${t.slice(0, 200).replace(/\n/g, ' | ')}`;
});
await check('Steg 3: rapporten innehåller Nadia och Amal som närvarande', async () => {
  const t = await T.mainText(); assert.match(t, /Nadia Warsame/); assert.match(t, /Amal Hassan/); assert.ok(!/Ej registrerad/i.test(t), 'Rapporten visar Ej registrerad');
});
await shot('steg3-rapport');
await check('Steg 3: rapporten kvitteras som läst', () => S(() => { const r = MM.store.state.reports.find((x) => x.kind === 'weekly_attendance' && x.week === '2027-W04' && x.recipientUserId === 'k-maria'); return r.openedAt || r.readAt || JSON.stringify(r); }));
// Lindas rapport: vad visar den för Elif?
await check('Lindas redan publicerade v4-rapport – hur ser Elifs sektion ut', () => S(() => { const w = MM.sel.weeklyReport('k-linda', '2027-W04'); return w.sections.map((s) => `${s.case.number}: ${JSON.stringify(s.stats)}`); }));
await T.done();
