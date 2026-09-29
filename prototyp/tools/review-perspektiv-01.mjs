// Granskning (perspektiv) 01: kundens resa i portalen + beställning → avropsinkorg → accept → orderbekräftelse hos kommunen.
import { openProto, visit } from './lib.mjs';
const SHOTS = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-perspektiv';
const { page, errors, close } = await openProto();
const txt = async () => page.evaluate(() => (document.querySelector('#main') || document.body).innerText);
const log = (h, t) => console.log(`\n===== ${h} =====\n${t}`);
const route = () => page.evaluate(() => JSON.stringify(MM.route));

// 1. kom.login
await visit(page, 'kommun_handlaggare', 'kom.login');
log('kom.login', (await txt()).slice(0, 1200));
await page.getByRole('button', { name: 'Skicka kod' }).click();
await page.fill('#kom-login-code', '123456');
await page.getByRole('button', { name: 'Logga in' }).click();
await page.waitForTimeout(200);
log('efter login route', await route());
log('kom.start', await txt());
await page.screenshot({ path: `${SHOTS}/p01-kom-start.png`, fullPage: true });

// 2. kom.bestall – fyll i
await page.getByRole('button', { name: /Beställ ny insats/ }).first().click();
await page.waitForTimeout(150);
log('bestall steg 1', (await txt()).slice(0, 2500));
await page.getByRole('group', { name: 'Planerad omfattning i veckor' }).getByRole('button', { name: '6', exact: true }).click().catch(async (e) => { console.log('seg fel', e.message); });
await page.getByRole('button', { name: /Nästa/ }).click();
await page.waitForTimeout(150);
log('bestall steg 2', (await txt()).slice(0, 1500));
await page.getByRole('group', { name: 'Skyddade personuppgifter' }).getByRole('button', { name: 'Nej' }).click();
await page.fill('#kom-o-fn', 'Test');
await page.fill('#kom-o-ln', 'Testsson');
await page.fill('#kom-o-pnr', '19900101-1234');
await page.fill('#kom-o-dphone', '0701234567');
await page.fill('#kom-o-city', 'Alby');
await page.getByRole('button', { name: /Nästa/ }).click();
await page.waitForTimeout(150);
log('bestall steg 3', (await txt()).slice(0, 1500));
await page.selectOption('#kom-o-area', { index: 1 });
await page.getByRole('button', { name: /Nästa/ }).click();
await page.waitForTimeout(150);
log('bestall steg 4', await txt());
await page.screenshot({ path: `${SHOTS}/p01-kom-bestall-granska.png`, fullPage: true });
await page.getByRole('button', { name: 'Skicka beställningen' }).click();
await page.waitForTimeout(200);
log('bestall klar', await txt());
await page.screenshot({ path: `${SHOTS}/p01-kom-bestall-klar.png`, fullPage: true });
const newCase = await page.evaluate(() => { const c = MM.store.state.cases.filter((x) => x.createdInDemo).slice(-1)[0]; return c && { id: c.id, number: c.number, status: c.status }; });
log('nytt ärende', JSON.stringify(newCase));

// 3. perspektivbyte till inkorgen
await page.getByRole('button', { name: 'Se hur beställningen landar hos Miljonbemanning' }).click();
await page.waitForTimeout(200);
log('route efter byte', await route());
const inbox = await txt();
log('sam.inkorg', inbox.slice(0, 3500));
await page.screenshot({ path: `${SHOTS}/p01-sam-inkorg-ny.png`, fullPage: true });
console.log('Inkorgen visar nya ärendet:', inbox.includes(newCase.number));

// 4. Acceptera
await page.getByRole('button', { name: 'Acceptera', exact: true }).first().click();
await page.waitForTimeout(150);
await page.locator('input[name="ink-coach"]').first().check();
await page.getByRole('button', { name: 'Acceptera avropet' }).click();
await page.waitForTimeout(200);
log('accept modal', (await page.evaluate(() => (document.querySelector('.modal') || document.body).innerText)).slice(0, 2500));
const after = await page.evaluate((id) => { const st = MM.store.state; const c = st.cases.find((x) => x.id === id); return { status: c.status, lead: c.leadCoachId, notifs: st.userNotifications.filter((n) => n.caseId === id), mails: st.notifications.filter((n) => n.caseId === id).map((n) => [n.template, n.to, n.body]), oc: st.reports.filter((r) => r.caseId === id).map((r) => [r.kind, r.status, r.deliveredTo]) }; }, newCase.id);
log('efter accept', JSON.stringify(after, null, 1));
// Stäng modalen
await page.getByRole('button', { name: 'Klart' }).click().catch(() => {});
await page.waitForTimeout(100);

// 5. Coachens notis (om tilldelad coach är Amira)
const coachPid = await page.evaluate(() => MM.roleDef('coach').personaId);
log('lead vs coachpersona', `${after.lead} vs ${coachPid}`);
// Byt till kommunen och se orderbekräftelse
await visit(page, 'kommun_handlaggare', 'kom.start');
log('kom.start efter accept', await txt());
await visit(page, 'kommun_handlaggare', 'kom.deltagare', { caseId: newCase.id });
log('kom.deltagare nytt ärende', await txt());
await page.screenshot({ path: `${SHOTS}/p01-kom-deltagare-bekraftad.png`, fullPage: true });
// Öppna orderbekräftelsen
const ocBtn = page.getByRole('button', { name: 'Öppna orderbekräftelsen' });
if (await ocBtn.count()) { await ocBtn.click(); await page.waitForTimeout(200); log('rapport.visa orderbekräftelse som kommun', await txt()); log('route', await route()); await page.screenshot({ path: `${SHOTS}/p01-kom-orderbekraftelse.png`, fullPage: true }); }
console.log('\nFEL:', JSON.stringify(errors, null, 1));
await close();
