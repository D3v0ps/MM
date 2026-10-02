// Scenario s3: Kommunen beställer i portalen
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s3');
const { page, S, main, dialog, check, note, shot } = T;

// Steg 1: logga in
const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'kom.login'); assert.equal(r1.role, 'kommun_handlaggare'); });
await check('Steg 1: e-post är förifylld?', async () => page.inputValue('#kom-login-email'));
await check('Steg 1: fel domän ger hjälptext', async () => {
  await page.fill('#kom-login-email', 'maria@gmail.com'); await main.getByRole('button', { name: 'Skicka kod' }).click(); await page.waitForTimeout(80);
  return (await T.mainText()).match(/Portalen är bara öppen[^\n]*/)?.[0];
});
await check('Steg 1: Skicka kod → kodsteget', async () => {
  await page.fill('#kom-login-email', 'maria.ekdahl@botkyrka.se'); await main.getByRole('button', { name: 'Skicka kod' }).click(); await page.waitForTimeout(80);
  assert.ok(await page.locator('#kom-login-code').isVisible());
});
await check('Steg 1: fel kodlängd ger fel', async () => { await page.fill('#kom-login-code', '123'); await main.getByRole('button', { name: 'Logga in' }).click(); await page.waitForTimeout(80); return (await T.mainText()).match(/Koden har[^\n]*/)?.[0]; });
await check('Steg 1: rätt kod loggar in till Start', async () => {
  await page.fill('#kom-login-code', '123456'); await main.getByRole('button', { name: 'Logga in' }).click(); await page.waitForTimeout(200);
  const r = await T.route(); assert.equal(r.view, 'kom.start'); return r;
});
await shot('steg1-inloggad');
await check('Steg 1: scenariofältet finns kvar och visar steg 1', async () => T.expectStep(1));

// Steg 2: beställ
const r2 = await T.next();
await check('Steg 2 route', () => { assert.equal(r2.view, 'kom.bestall'); });
await check('Steg 2: vyn har "tre steg" som scenariot säger', async () => { const t = await T.mainText(); const m = t.match(/STEG 1 AV (\d)/i); if (m && m[1] !== '3') throw new Error(`Vyn visar "Steg 1 av ${m[1]}" och stegindikatorn har ${m[1]} steg (Granska och skicka räknas), scenariot och ingressen säger tre steg`); });
await check('Steg 2: felaktig beställarreferens ger hjälptext', async () => {
  await page.fill('#kom-o-ref', '12345'); await page.waitForTimeout(80);
  const t = await T.mainText(); const m = t.match(/[^\n]*(8–10 siffror|siffror)[^\n]*\n?[^\n]*/g); return m && m.slice(0, 3);
});
await shot('steg2-felref');
await check('Steg 2: rätta referensen och fyll steg 1', async () => {
  await page.fill('#kom-o-ref', '4410023817');
  await main.getByRole('button', { name: '8', exact: true }).click();
  await main.getByRole('button', { name: /Nästa: deltagare/ }).click(); await page.waitForTimeout(120);
  const t = await T.mainText(); assert.match(t, /STEG 2 AV/i);
});
await check('Steg 2: fyll deltagare', async () => {
  await main.locator('#kom-o-prot').getByRole('button', { name: 'Nej' }).click().catch(async () => { await main.getByRole('button', { name: 'Nej', exact: true }).click(); });
  await page.fill('#kom-o-fn', 'Testa'); await page.fill('#kom-o-ln', 'Testsson'); await page.fill('#kom-o-pnr', '19880512-4417');
  await page.fill('#kom-o-dphone', '070-123 45 67'); await page.fill('#kom-o-city', 'Alby');
  await main.getByRole('button', { name: /Nästa: avtalsområde/ }).click(); await page.waitForTimeout(120);
  const t = await T.mainText(); assert.match(t, /STEG 3 AV/i, t.match(/[^\n]*(Skriv|saknas)[^\n]*/g)?.join(' | '));
});
await check('Steg 2: välj avtalsområde', async () => {
  await page.selectOption('#kom-o-area', 'G');
  await main.getByRole('button', { name: /Nästa: granska/ }).click(); await page.waitForTimeout(120);
  const t = await T.mainText(); assert.match(t, /STEG 4 AV/i);
});
await shot('steg2-granska');
await check('Steg 2: skicka beställningen', async () => {
  await main.getByRole('button', { name: 'Skicka beställningen' }).click(); await page.waitForTimeout(200);
  const t = await T.mainText(); assert.match(t, /Beställningen är skickad/i); return t.match(/BOT-\d\d-\d{4}/)?.[0];
});
const newCase = await S(() => { const c = MM.store.state.cases.filter((x) => x.source === 'portal').slice(-1)[0]; return JSON.parse(JSON.stringify({ id: c.id, number: c.number, status: c.status, referredAt: c.referredAt })); });
note('OBS', 'Nytt ärende: ' + JSON.stringify(newCase));

// Steg 3
const r3 = await T.next();
await check('Steg 3: route oförändrad och kvittot finns kvar', async () => { assert.equal(r3.view, 'kom.bestall'); const t = await T.mainText(); assert.match(t, new RegExp(newCase.number)); assert.match(t, /Ordererkännande/i); });
await check('Steg 3: ordererkännandets mejl visas utan personuppgifter', async () => { const t = await T.mainText(); assert.ok(!/Testa|Testsson/.test(t.split('Mejlet du får')[1] || ''), 'namn i mejlet'); return (t.match(/MEJLET DU FÅR[\s\S]{0,300}/i) || [''])[0].replace(/\n/g, ' ').slice(0, 250); });
await shot('steg3');

// Steg 4
const r4 = await T.next();
await check('Steg 4 route', () => { assert.equal(r4.view, 'sam.inkorg'); assert.equal(r4.role, 'samordnare'); });
await check('Steg 4: beställningen syns i inkorgen', async () => { const t = await T.mainText(); assert.match(t, new RegExp(newCase.number), 'Portalbeställningen syns inte i inkorgslistan'); });
await check('Steg 4: beställningen är vald/öppen i detaljpanelen utan extra klick', async () => { const t = await T.mainText(); assert.match(t, new RegExp(`BESTÄLLNING · ${newCase.number}`), 'Detaljpanelen visar ' + (t.match(/(BESTÄLLNING|KOMPLETTERING|ÖVRIGT)[^\n]*·[^\n]*/) || [''])[0]); });
await check('Steg 4: klicka på beställningen i listan och se SLA-klocka (en arbetsdag)', async () => {
  await main.getByRole('button', { name: new RegExp(newCase.number) }).first().click(); await page.waitForTimeout(150);
  const t = await T.mainText(); assert.match(t, new RegExp(`BESTÄLLNING · ${newCase.number}`)); 
  return (t.match(new RegExp(`BESTÄLLNING · ${newCase.number}[\\s\\S]{0,260}`)) || [''])[0].replace(/\n/g, ' | ');
});
await shot('steg4');
await check('Steg 4: portalbeställningen kan accepteras', async () => {
  await main.getByRole('button', { name: 'Acceptera', exact: true }).first().click(); await dialog.waitFor();
  await dialog.getByText('Sofia Grahn', { exact: false }).first().click(); await dialog.getByRole('button', { name: 'Acceptera avropet' }).click(); await page.waitForTimeout(150);
  const s = await S((id) => MM.sel.caseById(id).status, newCase.id); assert.equal(s, 'confirmed'); await dialog.getByRole('button', { name: 'Klart' }).click();
});
await T.done();
