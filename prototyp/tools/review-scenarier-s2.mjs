// Scenario s2: Fritextmejl utan beställarreferens
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s2');
const { page, S, main, dialog, check, note, shot } = T;
const caseId = await S(() => MM.store.state.script['inkorg-fritext']);

// Steg 1
const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.params.emailId, 'em-102'); });
await check('Steg 1: fredag 15.20, AI-tolkning, konfidens och saknade uppgifter syns', async () => {
  const t = await T.mainText();
  assert.match(t, /fre 29 jan kl\. 15\.20/); assert.match(t, /TOLKAT MED AI/i); assert.match(t, /Osäker \d+ %/); assert.match(t, /Saknas: beställarreferens, planerat slutdatum/);
});
await check('Steg 1: AI-tolkade fält har stöd i mejltexten (bakgrund, bostadsort, yrkesspår)', async () => {
  const e = await S(() => { const e = MM.store.state.inboundEmails.find((x) => x.id === 'em-102'); return { body: e.bodyText, ex: e.extracted, conf: e.confidence }; });
  const probs = [];
  if (e.ex.background && !/två somrar|storkök/.test(e.body) && /två somrar|storkök/.test(e.ex.background)) probs.push(`Bakgrund "${e.ex.background}" (${e.conf.background}) – mejlet säger "jobbat i kök i Syrien"`);
  if (e.ex.city && !e.body.includes(e.ex.city)) probs.push(`Bostadsort "${e.ex.city}" (${e.conf.city}) nämns inte i mejlet`);
  if (e.ex.vocationalTrack && !e.body.includes(e.ex.vocationalTrack)) probs.push(`Yrkesspår "${e.ex.vocationalTrack}" (${e.conf.vocationalTrack}) nämns inte`);
  if (probs.length) throw new Error(probs.join(' ; '));
});
await shot('steg1');

// Steg 2
await T.next();
await check('Steg 2: Acceptera öppnar modal', async () => { await main.getByRole('button', { name: 'Acceptera', exact: true }).first().click(); await dialog.waitFor(); });
await check('Steg 2: med tom beställarreferens stoppas accept', async () => {
  await dialog.getByText('Amira Haddad', { exact: false }).first().click();
  const ref = await page.inputValue('#ink-ref'); const weeks = await page.inputValue('#ink-weeks');
  await dialog.getByRole('button', { name: 'Acceptera avropet' }).click(); await page.waitForTimeout(150);
  const t = await dialog.innerText();
  const c = await S((id) => MM.sel.caseById(id).status, caseId);
  assert.notEqual(c, 'confirmed', 'Ärendet blev bekräftat utan referens!');
  assert.match(t, /Beställarreferens|beställarreferens/);
  const err = (t.match(/[^\n]*(8–10 siffror|saknas|krävs)[^\n]*/i) || [''])[0];
  return `ref="${ref}" weeks="${weeks}" status=${c} fel: ${err}`;
});
await shot('steg2-stopp', false);
await check('Steg 2: försök med ogiltig referens (123) stoppas', async () => {
  await page.fill('#ink-ref', '123'); await dialog.getByRole('button', { name: 'Acceptera avropet' }).click(); await page.waitForTimeout(100);
  const c = await S((id) => MM.sel.caseById(id).status, caseId); assert.notEqual(c, 'confirmed');
  return (await dialog.innerText()).match(/[^\n]*siffr[^\n]*/)?.[0];
});
await check('Steg 2: stäng modalen', async () => { await dialog.getByRole('button', { name: 'Avbryt' }).click(); await page.waitForTimeout(100); assert.equal(await page.getByRole('dialog').count(), 0); });

// Steg 3
const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.params.emailId, 'em-103'); });
await check('Steg 3: kompletteringen visar kopplingen via ärendenummer', async () => { const t = await T.mainText(); assert.match(t, /Kopplad automatiskt till BOT-27-0049/); assert.match(t, /55102938/); });
await check('Steg 3: För in uppgifterna', async () => {
  await main.getByRole('button', { name: 'För in uppgifterna' }).click(); await page.waitForTimeout(150);
  const c = await S((id) => { const c = MM.sel.caseById(id); return { ref: c.buyerReference, end: c.plannedEnd, status: c.status }; }, caseId);
  assert.equal(c.ref, '55102938'); assert.equal(c.end, '2027-03-19'); return c;
});
await check('Steg 3: Acceptera avropet från kompletteringen', async () => {
  await main.getByRole('button', { name: 'Acceptera avropet' }).click(); await dialog.waitFor();
  const ref = await page.inputValue('#ink-ref'); assert.equal(ref, '55102938', 'Referensen följer inte med in i modalen');
  await dialog.getByText('Leila Nouri', { exact: false }).first().click();
  await dialog.getByRole('button', { name: 'Acceptera avropet' }).click(); await page.waitForTimeout(200);
  const t = await dialog.innerText(); assert.match(t, /Avropet är accepterat/);
  const c = await S((id) => MM.sel.caseById(id).status, caseId); assert.equal(c, 'confirmed');
  return (t.match(/Planerad omfattning[^\n]*\n[^\n]*/) || [''])[0].replace(/\n/g, ' ');
});
await shot('steg3-accepterat', false);
await check('Steg 3: stäng', async () => { await dialog.getByRole('button', { name: 'Klart' }).click(); await page.waitForTimeout(100); });
await check('Steg 3: Inkorgen – kompletteringen och avropet hanterade', async () => {
  const t = await T.mainText(); return (t.match(/(\d+) att hantera/) || [])[0];
});
const sentNow = await S((id) => MM.store.state.notifications.filter((n) => n.caseId === id && n.byTester).map((n) => ({ ch: n.channel, t: n.template, b: n.body })), caseId);
note('OBS', 'Utskick skapade vid accept: ' + JSON.stringify(sentNow));

// Steg 4
const r4 = await T.next();
await check('Steg 4 route', () => { assert.equal(r4.view, 'admin.mallar'); assert.equal(r4.role, 'admin'); });
await check('Steg 4: utskicksloggen visar dagens utskick (orderbekräftelse BOT-27-0049, kallelse, tilldelning)', async () => {
  const t = await T.mainText();
  assert.match(t, /BOT-27-0049/);
  const m = t.match(/UTSKICKSLOGG \((\d+)\)/); const orsakade = t.match(/ORSAKADE AV DIG\s*\n\s*(\d+)/);
  return { total: m && m[1], orsakade: orsakade && orsakade[1] };
});
await check('Steg 4: inga personuppgifter (namn Rasha/Khalaf, pnr) i loggtexten', async () => {
  const t = await T.mainText(); assert.ok(!/Rasha|Khalaf/.test(t), 'Namn i utskicksloggen'); assert.ok(!/\d{8}-\d{4}/.test(t), 'pnr');
});
await check('Steg 4: filtret Bara utskick du orsakat', async () => {
  await page.locator('#log-mine').check(); await page.waitForTimeout(120);
  const t = await T.mainText(); const m = t.match(/UTSKICKSLOGG \((\d+)\)/); return m && m[1];
});
await shot('steg4');
await T.done();
