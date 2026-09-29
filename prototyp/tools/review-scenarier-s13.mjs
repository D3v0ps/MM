// Scenario s13: Notiser, påminnelser och tidig eskalering
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s13');
const { page, S, main, dialog, check, note, shot } = T;
const caseId = await S(() => MM.store.state.script['inkorg-brattom']);
const num = await S((id) => MM.sel.caseById(id).number, caseId);

// Starta via startsidans "Testa scenariot" i kortet Nytt sedan SPEC v0.2
await S(() => MM.nav('om.start', {})); await page.waitForTimeout(120);
await check('Start: knappen "Testa scenariot" startar s13', async () => { await main.getByRole('button', { name: 'Testa scenariot' }).click(); await page.waitForTimeout(200); const r = await T.route(); assert.equal(r.params.emailId, 'em-106'); T.setStep(1); return T.barText().then((x) => x.split('\n')[0]); });

await check('Steg 1: Linda Karlssons avrop visas', async () => { const t = await T.mainText(); assert.match(t, new RegExp(`BESTÄLLNING · ${num}`)); assert.match(t, /Linda Karlsson/); });
await check('Steg 1: acceptera och välj Amira Haddad', async () => {
  await main.getByRole('button', { name: 'Acceptera', exact: true }).first().click(); await dialog.waitFor();
  await dialog.getByText('Amira Haddad', { exact: false }).first().click(); await dialog.getByRole('button', { name: 'Acceptera avropet' }).click(); await page.waitForTimeout(200);
  const t = await dialog.innerText(); assert.match(t, /har fått en notis om tilldelningen/); return (t.match(/Amira Haddad har fått en notis[^\n]*\n[^\n]*/) || [''])[0].replace(/\n/g, ' ');
});
const nt = await S((id) => ({ app: MM.store.state.userNotifications.filter((n) => n.caseId === id).map((n) => ({ to: n.recipientId, kind: n.kind, title: n.title, body: n.body, email: n.emailBody })), mail: MM.store.state.notifications.filter((n) => n.caseId === id && n.byTester).map((n) => `${n.channel}:${n.template}:${n.to}:${n.body}`) }), caseId);
await check('Steg 1: notis i appen till Amira + mejl utan personuppgifter', () => {
  assert.ok(nt.app.some((n) => n.to === 'u-amira' && n.kind === 'assignment')); const pn = nt.app.concat(nt.mail).map((x) => JSON.stringify(x)).join(' ');
  const person = 'Tesfaye|Haile'; assert.ok(!new RegExp(person).test(nt.mail.join(' ')), 'namn i mejl'); return nt;
});
await check('Steg 1: stäng modalen', async () => { await dialog.getByRole('button', { name: 'Klart' }).click(); await page.waitForTimeout(100); });
await shot('steg1');

const r2 = await T.next();
await check('Steg 2 route', () => { assert.equal(r2.view, 'notiser'); assert.equal(r2.role, 'coach'); });
await check('Steg 2: tilldelningen av det nya ärendet syns överst', async () => { const t = await T.mainText(); assert.match(t, new RegExp(num)); return (t.match(new RegExp(`[^\\n]*${num}[^\\n]*`)) || [''])[0]; });
await check('Steg 2: tilldelningsnotisen visar inte deltagarens namn', async () => { const t = await T.mainText(); assert.ok(!/Tesfaye|Haile/.test(t)); });
await check('Steg 2: påminnelser om progression finns', async () => { const t = await T.mainText(); assert.match(t, /Påminnelse: ingen progression/); });
await check('Steg 2: inget om eskalering eller chef', async () => { const t = (await T.mainText()).split('\n').filter((l) => !/^Prototyp/.test(l)).join('\n'); const m = t.match(/[^\n]*(eskaler|chefen|Karin)[^\n]*/gi); if (m) throw new Error(m.join(' || ')); });
await check('Steg 2: coachens sidopanel/Min vecka visar inget om eskalering', async () => {
  await S(() => MM.nav('coach.minvecka', {})); await page.waitForTimeout(120); const t = (await T.mainText()).split('\n').filter((l) => !/^Prototyp/.test(l)).join('\n') + (await page.locator('.sidebar').innerText()); await S(() => MM.gotoStep(1)); await page.waitForTimeout(100);
  const m = t.match(/[^\n]*eskaler[^\n]*/gi); if (m) throw new Error(m.join(' || '));
});
await shot('steg2');

const r3 = await T.next();
await check('Steg 3 route', () => { assert.equal(r3.view, 'notiser'); assert.equal(r3.role, 'chef'); });
await check('Steg 3: eskaleringen för Yusuf Abdi syns', async () => { const t = await T.mainText(); const yu = await S(() => MM.sel.caseByTag('yusuf').number); assert.match(t, new RegExp(`Eskalering[^\\n]*\\n${yu}|${yu} · coach`)); if (!/Yusuf Abdi/.test(t)) throw new Error(`Eskaleringen visas bara som ${yu} – namnet "Yusuf Abdi" som scenariot nämner syns inte i vyn`); });
await shot('steg3');

const r4 = await T.next();
await check('Steg 4 route', () => { assert.equal(r4.view, 'chef.oversikt'); });
await check('Steg 4: tidig uppmärksamhet per coach', async () => { const t = await T.mainText(); assert.match(t, /TIDIG UPPMÄRKSAMHET/); });
await check('Steg 4: kvittera Yusufs eskalering med kort åtgärd', async () => {
  const sec = main.locator('.card, section').filter({ hasText: /TIDIG UPPMÄRKSAMHET/i }).last();
  await sec.getByRole('button', { name: 'Kvittera', exact: true }).first().click(); await dialog.waitFor();
  const pre = await page.inputValue('#ldg-ack-plan'); await page.fill('#ldg-ack-plan', 'Avstämning med Amira i dag. Nytt veckomål.');
  await dialog.getByRole('button', { name: 'Kvittera med åtgärdsplan' }).click(); await page.waitForTimeout(120);
  return S(() => Object.entries(MM.store.state.alertAcks).map(([k, v]) => `${k}: ${v.plan}`));
});
await check('Steg 4: coachen ser fortfarande inte kvitteringen/eskaleringen', async () => {
  await S(() => MM.nav('notiser', {}, { role: 'coach' })); await page.waitForTimeout(120); const t = (await T.mainText()).split('\n').filter((l) => !/^Prototyp/.test(l)).join('\n');
  await S(() => MM.gotoStep(3)); await page.waitForTimeout(120); const m = t.match(/[^\n]*(eskaler|Kvitterad)[^\n]*/gi); if (m) throw new Error(m.join(' | '));
});
await shot('steg4');

const r5 = await T.next();
await check('Steg 5 route och flik', async () => { assert.equal(r5.view, 'admin.avtal'); const sel = await main.locator('[role=tab][aria-selected=true]').innerText(); assert.match(sel, /Interna regler/); });
await check('Steg 5: ändra eskalering till 3 veckor och spara – slår igenom', async () => {
  const before = await S(() => MM.sel.progressionWatch({}).filter((x) => x.level === 'escalated').length);
  await page.selectOption('#rule-esc', '3'); await main.getByRole('button', { name: 'Spara reglerna' }).click(); await page.waitForTimeout(150);
  const after = await S(() => MM.sel.progressionWatch({}).filter((x) => x.level === 'escalated').length);
  const t = await T.mainText(); return `eskaleringar ${before} → ${after}; ${(t.match(/ESKALERINGAR\n(\d+)/) || [])[0]?.replace('\n', ' ')}`;
});
await check('Steg 5: chefens notiser efter regeländring', async () => {
  await S(() => MM.nav('notiser', {}, { role: 'chef' })); await page.waitForTimeout(120); const t = await T.mainText(); await S(() => MM.gotoStep(4)); return (t.match(/Alla \(\d+\)/) || [''])[0];
});
await shot('steg5');
await T.done();
