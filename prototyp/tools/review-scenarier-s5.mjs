// Scenario s5: Röd status blir en avvikelse
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s5');
const { page, S, main, dialog, check, note, shot } = T;
const caseId = await S(() => MM.store.state.script.yusuf);

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'coach.avstamning'); assert.equal(r1.params.caseId, caseId); });
await check('Steg 1: Yusuf Abdi och upprepad ogiltig frånvaro syns', async () => { const t = await T.mainText(); assert.match(t, /YUSUF ABDI/i); assert.match(t, /Upprepad ogiltig frånvaro/); });

await T.next();
await check('Steg 2: route oförändrad (formulärets state finns kvar)', async () => { const r = await T.route(); assert.equal(r.view, 'coach.avstamning'); });
await check('Steg 2: välj Röd visar avvikelsekortet', async () => {
  await main.getByRole('button', { name: /^Röd/ }).click(); await page.waitForTimeout(100);
  const t = await T.mainText(); assert.match(t, /Avvikelse – krävs vid röd status/i);
});
await check('Steg 2: fyll i veckoavstämningen utan avvikelse → stoppas', async () => {
  await main.locator('#ci-status').waitFor().catch(() => {});
  await main.getByRole('button', { name: 'Nej', exact: true }).first().click();
  await page.fill('#ci-nextgoal', 'Komma i tid till alla tillfällen denna vecka');
  await main.getByRole('button', { name: '0', exact: true }).click();
  await main.getByRole('button', { name: 'Godkänn avstämningen' }).click(); await page.waitForTimeout(150);
  const t = await T.mainText(); if (/Avstämningen är godkänd/i.test(t)) throw new Error('Godkändes direkt – avvikelsefälten var förifyllda från flaggan (beskrivning, åtgärd, ansvarig, datum), inget stopp visades'); assert.match(t, /Beskriv avvikelsen/); const toast = await S(() => [...document.querySelectorAll('.toast')].map((x) => x.innerText).join(' | ')); return toast;
});
await shot('steg2-stopp');
if (await page.locator('#dev-desc').count()) await check('Steg 2: fyll avvikelsen (åtgärd, ansvarig, datum) och godkänn', async () => {
  await page.fill('#dev-desc', 'Två ogiltiga frånvarotillfällen på två veckor.');
  await page.fill('#dev-action', 'Ny veckoplan med fasta tider. Uppföljningsmöte med handläggaren.');
  const opts = await page.locator('#dev-owner option').allInnerTexts(); await page.selectOption('#dev-owner', { index: 1 });
  const f = await page.inputValue('#dev-follow'); if (!f) await page.fill('#dev-follow', '2027-02-08');
  await main.locator('#dev-cust').getByRole('button', { name: 'Ja' }).click().catch(() => {});
  await main.getByRole('button', { name: 'Godkänn avstämningen' }).click(); await page.waitForTimeout(200);
  const t = await T.mainText(); assert.match(t, /Avstämningen är godkänd/i); assert.match(t, /Avvikelse skapad/i);
  return { owners: opts.slice(0, 5), follow: f };
});
const dev = await S((id) => JSON.parse(JSON.stringify(MM.store.state.deviations.filter((x) => x.caseId === id))), caseId);
await check('Steg 2: avvikelse i tillståndet', () => { assert.equal(dev.length, 1); return { status: dev[0].status, owner: dev[0].ownerId, follow: dev[0].followUpOn }; });
await shot('steg2-godkand');

const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'arende.kort'); assert.equal(r3.params.tab, 'avvikelser'); });
await check('Steg 3: avvikelsen syns i fliken', async () => { const t = await T.mainText(); assert.match(t, /Upprepad ogiltig frånvaro \(2 tillfällen/); });
await check('Steg 3: Kalla kommunen till uppföljning → modal → skicka', async () => {
  await main.getByRole('button', { name: 'Kalla kommunen till uppföljning' }).click(); await dialog.waitFor();
  const devSel = await page.inputValue('#arn-call-dev'); const body = await page.inputValue('#arn-call-body');
  await dialog.getByRole('button', { name: 'Skicka kallelsen' }).click(); await page.waitForTimeout(150);
  assert.equal(await page.getByRole('dialog').count(), 0, 'Modalen stängdes inte');
  return { devSel, body: body.slice(0, 200).replace(/\n/g, ' ') };
});
const msgs = await S((id) => MM.store.state.messages.filter((m) => m.caseId === id && m.kind === 'meeting_request').map((m) => m.body.slice(0, 80)), caseId);
await check('Steg 3: meddelande skapat', () => { assert.ok(msgs.length >= 1); return msgs; });
await shot('steg3');

const r4 = await T.next();
await check('Steg 4 route', () => { assert.equal(r4.view, 'kom.deltagare'); assert.equal(r4.role, 'kommun_handlaggare'); });
await check('Steg 4: mötesförfrågan syns utan att leta (översikten)', async () => { const t = await T.mainText(); return /uppföljningsmöte|Mötesförfrågan|nytt meddelande/i.test(t) ? 'ja' : (() => { throw new Error('Översikten nämner inte mötesförfrågan: ' + t.slice(0, 200).replace(/\n/g, ' | ')); })(); });
await check('Steg 4: fliken Meddelanden visar mötesförfrågan', async () => {
  await main.getByRole('tab', { name: /^Meddelanden/ }).click(); await page.waitForTimeout(150);
  const t = await T.mainText(); assert.match(t, /uppföljningsmöte/i); return (t.match(/[^\n]*uppföljningsmöte[^\n]*/i) || [''])[0].slice(0, 160);
});
await shot('steg4');
await check('Steg 4: kommunen kan svara', async () => {
  const ta = main.locator('textarea').first(); await ta.fill('Tiden passar bra. /Maria');
  await main.getByRole('button', { name: /Skicka/ }).first().click(); await page.waitForTimeout(150);
  return S((id) => MM.store.state.messages.filter((m) => m.caseId === id).slice(-1)[0].body, caseId);
});
await T.done();
