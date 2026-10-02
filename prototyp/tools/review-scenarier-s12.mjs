// Scenario s12: Avtalet är konfiguration
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s12');
const { page, S, main, check, note, shot } = T;

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'admin.avtal'); assert.ok(!r1.params.contract); });
await check('Steg 1: ej fastställda värden markerade och aktiveras inte', async () => { const t = await T.mainText(); const m = t.match(/(\d+) värden är inte fastställda – reglerna aktiveras inte/); assert.ok(m); return m[0]; });
await check('Steg 1: Botkyrka-kortet är valt', async () => { const t = await T.mainText(); assert.match(t, /AVTALSFAKTA\nKund\nBotkyrka kommun/); });

const r2 = await T.next();
await check('Steg 2 route', () => { assert.equal(r2.params.contract, 'c-kk'); });
await check('Steg 2: paketpriser syns direkt', async () => { const t = await T.mainText(); if (!/paket|Paket/.test(t.replace('Startpaket: minst 4 möten', '')) || !/kr/.test(t)) throw new Error('Inga paketpriser på fliken som öppnas – de finns under fliken Prislista'); });
await check('Steg 2: KPI:er och SLA syns', async () => { const t = await T.mainText(); assert.match(t, /Placeringsgrad/); assert.match(t, /SLA/); });
await check('Steg 2: fliken Prislista visar KK-paketpriser', async () => {
  await main.getByRole('tab', { name: /Prislista/ }).click(); await page.waitForTimeout(120);
  const t = await T.mainText(); assert.match(t, /Prislista – skiss|PRISLISTA – SKISS/i); return (t.match(/PRISLISTA – SKISS[\s\S]{0,300}/i) || [''])[0].replace(/\n/g, ' | ');
});
await check('Steg 2: Jämför avtalen', async () => { await main.getByRole('tab', { name: /Jämför avtalen/ }).click(); await page.waitForTimeout(120); const t = await T.mainText(); assert.match(t, /Kammarkollegiet/); assert.match(t, /Botkyrka/); });
await shot('steg2');

const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'om.fragor'); });
await check('Steg 3: öppna frågor listas', async () => { const t = await T.mainText(); const n = (t.match(/\n\d+\n/g) || []).length; assert.match(t, /Resultatdefinition/); return `${n} rader`; });
await check('Steg 3: layouten (om-vy utan sidopanel) med rollen admin', async () => { const r = await T.route(); return r.role; });
await check('Steg 3: sista steget – Feedback på scenariot', async () => { await T.bar.getByRole('button', { name: /Feedback på scenariot/ }).click(); await page.waitForTimeout(100); const t = await page.locator('.drawer').innerText(); assert.match(t, /Scenariot: Avtalet är konfiguration/); });
await shot('steg3');
await T.done();
