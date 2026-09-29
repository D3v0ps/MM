// Scenario s1: Från mejl till orderbekräftelse
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s1');
const { page, S, main, dialog, check, note, shot } = T;

// Steg 1
const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'sam.inkorg'); assert.equal(r1.params.emailId, 'em-101'); assert.equal(r1.role, 'samordnare'); return r1; });
await T.expectStep(1);
await check('Steg 1: mejlet från Maria 08.41 med Word-mall, ärendenummer och ordererkännande syns', async () => {
  const t = await T.mainText();
  assert.match(t, /Maria Ekdahl/); assert.match(t, /08\.41/); assert.match(t, /Word-mall/); assert.match(t, /BOT-27-0050/); assert.match(t, /ORDERERKÄNNANDE/i);
});
await check('Steg 1: detaljpanelen visar em-101 (inte det mest brådskande)', async () => { const t = await T.mainText(); assert.match(t, /BESTÄLLNING · BOT-27-0050/); });
await shot('steg1');

// Steg 2
const r2 = await T.next();
await check('Steg 2 route oförändrad', () => { assert.equal(r2.params.emailId, 'em-101'); });
const caseId = await S(() => MM.store.state.script['inkorg-mall']);
await check('Steg 2: klicka Acceptera i detaljpanelen öppnar modal', async () => {
  await main.getByRole('button', { name: 'Acceptera', exact: true }).first().click();
  await dialog.waitFor();
  const t = await dialog.innerText(); return t.slice(0, 80).replace(/\n/g, ' ');
});
await shot('steg2-modal', false);
await check('Steg 2: välj huvudcoach Amira + första möte och acceptera', async () => {
  await dialog.getByText('Amira Haddad', { exact: false }).first().click();
  const date = await page.inputValue('#ink-fm-date'); const time = await page.inputValue('#ink-fm-time');
  await dialog.getByRole('button', { name: 'Acceptera avropet' }).click();
  await page.waitForTimeout(200);
  const t = await dialog.innerText();
  assert.match(t, /Avropet är accepterat|Orderbekräftelse/);
  return `${date} ${time}`;
});
await shot('steg2-klart', false);
const c = await S((id) => JSON.parse(JSON.stringify(MM.sel.caseById(id))), caseId);
await check('Steg 2: ärendet bekräftat i tillståndet', () => { assert.equal(c.status, 'confirmed'); assert.equal(c.leadCoachId, 'u-amira'); assert.ok(c.firstMeetingAt); return { status: c.status, fm: c.firstMeetingAt }; });
await check('Steg 2: orderbekräftelse-rapport skapad', () => S((id) => { const r = MM.store.state.reports.find((x) => x.caseId === id && x.kind === 'order_confirmation'); if (!r) throw new Error('saknas'); return r.status; }, caseId));
await check('Steg 2: notis till coach skapad', () => S((id) => { const n = MM.store.state.userNotifications.filter((x) => x.caseId === id); if (!n.length) throw new Error('ingen notis'); return n.map((x) => x.recipientId + ':' + x.kind); }, caseId));
await check('Steg 2: kund-mejl utan personuppgifter', () => S((id) => { const n = MM.store.state.notifications.filter((x) => x.caseId === id).map((x) => x.template + ': ' + x.body); if (/Diego|Morales/.test(n.join())) throw new Error('namn i utskick: ' + n.join(' || ')); return n; }, caseId));
// Stäng modalen
await check('Steg 2: stäng modalen med Klart', async () => { await dialog.getByRole('button', { name: 'Klart' }).click(); await page.waitForTimeout(150); });
await check('Steg 2: detaljpanelen visar accepterat/orderbekräftelse efter stängning', async () => { const t = await T.mainText(); assert.match(t, /Orderbekräftelse skickad|Accepterad/i); });
await shot('steg2-efter');

// Steg 3
const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'kom.deltagare'); assert.equal(r3.role, 'kommun_handlaggare'); assert.equal(r3.params.caseId, caseId); });
await check('Steg 3: kommunen ser orderbekräftelsen med coach och första möte', async () => {
  const t = await T.mainText();
  assert.ok(!/Väntar på bekräftelse/.test(t), 'Visar fortfarande Väntar på bekräftelse');
  assert.match(t, /Amira Haddad/); assert.match(t, /ORDERBEKRÄFTELSE/i);
  return t.split('\n').slice(0, 8).join(' | ');
});
await check('Steg 3: ordererkännandet går att visa', async () => {
  await main.locator('summary', { hasText: 'Visa ordererkännandet' }).click(); await page.waitForTimeout(150);
  const t = await main.locator('details[open]').innerText();
  assert.match(t, /BOT-27-0050/);
  return t.slice(0, 160).replace(/\n/g, ' ');
});
await page.waitForTimeout(150);
await check('Steg 3: Öppna orderbekräftelsen', async () => {
  const b = main.getByRole('button', { name: /Öppna orderbekräftelsen/i }); await b.first().click(); await page.waitForTimeout(200);
  const r = await T.route(); const t = await T.mainText();
  assert.match(t, /Orderbekräftelse/i); assert.ok(!/undefined|NaN/.test(t), 'undefined/NaN');
  return `${r.view} ${JSON.stringify(r.params)}`;
});
await shot('steg3');
await check('Steg 3: kommunen ser rapporten i Rapporter (orderbekräftelse)', async () => {
  await S(() => MM.nav('kom.rapporter', {})); await page.waitForTimeout(150);
  await main.getByRole('button', { name: /^Alla \(/ }).click(); await page.waitForTimeout(100);
  const t = await T.mainText(); assert.match(t, /Orderbekräftelser \(71\)/); 
});
// Testat + feedback-knapp på sista steget
await S((id) => MM.gotoStep(2), null);
await check('Sista steget: Testat-knappen markerar steget', async () => { await T.markTested(); const p = await S(() => MM.fb.progress); assert.ok(p['s1:2']); return p; });
await check('Sista steget: Feedback på scenariot öppnar lådan med scenariot förvalt', async () => {
  await T.bar.getByRole('button', { name: /Feedback på scenariot/ }).click(); await page.waitForTimeout(150);
  const t = await page.locator('.drawer').innerText(); assert.match(t, /Scenariot: Från mejl/); await page.locator('.drawer').getByRole('button', { name: 'Stäng' }).click();
});
await check('Föregående tar tillbaka till steg 2 (samordnare)', async () => { const r = await T.prev(); assert.equal(r.role, 'samordnare'); await T.expectStep(2); });
await T.done();
