// Granskning (perspektiv) 03: konsekvens mellan perspektiven – meddelanden, kallelse, rapportleverans, kvittens, åtgärdsplan.
import { openProto, visit } from './lib.mjs';
const SHOTS = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-perspektiv';
const { page, errors, close } = await openProto();
const txt = async () => page.evaluate(() => (document.querySelector('#main') || document.body).innerText);
const log = (h, t) => console.log(`\n===== ${h} =====\n${t}`);
const route = () => page.evaluate(() => JSON.stringify(MM.route));
const sc = await page.evaluate(() => MM.store.state.script);

// ---- A. Coach skriver meddelande (Nadia, Maria) → syns hos kommunen
await visit(page, 'coach', 'arende.kort', { caseId: sc.nadia, tab: 'meddelanden' });
await page.fill('#arn-msg-body', 'Hej Maria! Nadia började praktiken i dag. Vi hörs på fredag.');
await page.getByRole('button', { name: 'Skicka säkert meddelande' }).click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Se tråden som kommunen' }).click();
await page.waitForTimeout(200);
log('A: route efter "Se tråden som kommunen"', await route());
const a1 = await txt();
log('A: kom.deltagare efter bytet (början)', a1.slice(0, 900));
await visit(page, 'kommun_handlaggare', 'kom.start');
log('A: kom.start – nytt meddelande?', (await txt()).slice(0, 700));
await visit(page, 'kommun_handlaggare', 'kom.deltagare', { caseId: sc.nadia, tab: 'meddelanden' });
const a2 = await txt(); log('A: kom meddelanden', a2.slice(a2.indexOf('SÄKRA MEDDELANDEN'), a2.indexOf('SÄKRA MEDDELANDEN') + 1500));
// Maria svarar
await page.fill('#kom-msg', 'Tack! Vad bra. Hälsa henne.');
await page.getByRole('button', { name: 'Skicka meddelandet' }).click();
await page.waitForTimeout(150);
const lastMsgs = await page.evaluate((id) => MM.sel.messagesOf(id).slice(-2).map((m) => ({ s: m.senderId, readBy: m.readBy, readAt: m.readAt, b: m.body.slice(0, 40) })), sc.nadia);
log('A: två sista meddelanden', JSON.stringify(lastMsgs));
const mailToMb = await page.evaluate(() => MM.store.state.notifications.slice(-1)[0]);
log('A: utskick när kommunen skriver', JSON.stringify(mailToMb));
// Syns svaret hos coachen utan att öppna ärendet?
await visit(page, 'coach', 'coach.minvecka');
const mv = await txt(); log('A: coach.minvecka nämner meddelande/BOT-26-0143?', `${/meddelande/i.test(mv)} / ${mv.includes('BOT-26-0143')}`);
await visit(page, 'coach', 'notiser');
const nt = await txt(); log('A: coach notiser nämner meddelande?', `${/meddelande/i.test(nt)}`);
const unreadSidebar = await page.evaluate(() => MM.sel.unreadNotifications(MM.currentPersonaId(), MM.role()));
log('A: coach olästa notiser', String(unreadSidebar));
await visit(page, 'coach', 'arenden.lista');
const al = await txt(); const i = al.indexOf('BOT-26-0143'); log('A: arenden.lista rad för Nadia', al.slice(i - 100, i + 300));
await visit(page, 'coach', 'arende.kort', { caseId: sc.nadia });
const tabsTxt = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((b) => b.innerText.replace(/\n/g, ' ')).join(' | '));
log('A: arende.kort flikar (räknare)', tabsTxt);

// ---- B. Kalla kommunen till uppföljning (Yusuf, Maria)
await visit(page, 'coach', 'arende.kort', { caseId: sc.yusuf, tab: 'avvikelser' });
await page.getByRole('button', { name: 'Kalla kommunen till uppföljning' }).first().click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Skicka kallelsen' }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Se kallelsen som kommunen' }).click();
await page.waitForTimeout(200);
log('B: route', await route());
log('B: kom.deltagare (Maria) efter kallelse', (await txt()).slice(0, 1400));
await visit(page, 'kommun_handlaggare', 'kom.start');
log('B: kom.start', (await txt()).slice(0, 700));

// B2: Kalla kommunen för Elif (Linda – switch går till kommunens chef)
await visit(page, 'coach', 'arende.kort', { caseId: sc.elif, tab: 'avvikelser' });
const hasCall = await page.getByRole('button', { name: 'Kalla kommunen till uppföljning' }).count();
if (hasCall) {
  await page.getByRole('button', { name: 'Kalla kommunen till uppföljning' }).first().click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Skicka kallelsen' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Se kallelsen som kommunen' }).click();
  await page.waitForTimeout(200);
  log('B2: route (Elif, Linda)', await route());
  const b2 = await txt();
  log('B2: kom.deltagare som kommunens chef', b2.slice(0, 1500));
  log('B2: syns mötesförfrågan/kallelsen på sidan?', String(/Mötesförfrågan|uppföljningsmöte|kalla till/i.test(b2)));
  await page.screenshot({ path: `${SHOTS}/p03-b2-kallelse-som-chef.png`, fullPage: true });
}

// ---- C. Leverera månadsrapport (Amira, Maria) → kommunen → kvittens
const repId = 'rep-15994';
await visit(page, 'coach', 'rapport.visa', { reportId: repId });
await page.getByRole('button', { name: 'Leverera till kommunen' }).click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Leverera i portalen' }).click();
await page.waitForTimeout(200);
log('C: status efter leverans', JSON.stringify(await page.evaluate((id) => { const r = MM.store.state.reports.find((x) => x.id === id); return { s: r.status, to: r.deliveredTo, d: r.deliveredAt, o: r.openedAt }; }, repId)));
await visit(page, 'kommun_handlaggare', 'kom.start');
const c1 = await txt(); log('C: kom.start visar rapporten?', String(c1.includes('BOT-26-0140')));
await visit(page, 'kommun_handlaggare', 'rapport.visa', { reportId: repId });
await page.waitForTimeout(150);
await visit(page, 'coach', 'rapport.visa', { reportId: repId });
const c2 = await txt(); const ci = c2.indexOf('Kvitterad'); log('C: MB-sidan efter att kommunen öppnat', c2.slice(ci - 300, ci + 200));

// ---- D. Kommunens chef öppnar en rapport till Ahmed → blir den "kvitterad"?
const ahmedRep = await page.evaluate(() => { const st = MM.store.state; const r = st.reports.find((x) => x.status === 'delivered' && !x.openedAt && x.caseId && MM.sel.caseById(x.caseId).referrerId === 'k-ahmed' && x.kind === 'monthly'); return r && { id: r.id, caseId: r.caseId, n: MM.sel.caseById(r.caseId).number }; });
log('D: rapport till Ahmed', JSON.stringify(ahmedRep));
await visit(page, 'kommun_chef', 'kom.deltagare', { caseId: ahmedRep.caseId, tab: 'rapporter' });
log('D: kommunens chef ser rapporter-fliken', (await txt()).slice(0, 900));
await visit(page, 'kommun_chef', 'rapport.visa', { reportId: ahmedRep.id });
const dTxt = await txt(); log('D: rapport.visa som kommunens chef (början)', dTxt.slice(0, 500));
log('D: openedAt efter att chefen tittat', JSON.stringify(await page.evaluate((id) => MM.store.state.reports.find((x) => x.id === id).openedAt, ahmedRep.id)));
await visit(page, 'samordnare', 'rapport.visa', { reportId: ahmedRep.id });
const d2 = await txt(); const di = d2.indexOf('Kvitterad'); log('D: MB-sidan', d2.slice(di - 200, di + 150));

// ---- D2. "Se som kommunen" från MB för en rapport till Linda → som kommunens chef
const lindaRep = await page.evaluate(() => { const st = MM.store.state; const r = st.reports.find((x) => x.status === 'delivered' && !x.openedAt && x.caseId && MM.sel.caseById(x.caseId).referrerId === 'k-linda'); return r && r.id; });
await visit(page, 'samordnare', 'rapport.visa', { reportId: lindaRep });
await page.getByRole('button', { name: 'Se som kommunen' }).click();
await page.waitForTimeout(200);
log('D2: route', await route());
log('D2: openedAt efter perspektivbyte', JSON.stringify(await page.evaluate((id) => MM.store.state.reports.find((x) => x.id === id).openedAt, lindaRep)));

// ---- E. Åtgärdsplan: kommunens chef godkänner → syns i chef.avvikelser
await visit(page, 'chef', 'chef.avvikelser', { id: 'cd-3' });
log('E: chef.avvikelser cd-3 före', (await txt()).slice(0, 1200));
await page.getByRole('button', { name: /Godkänn planen som kommunens chef/ }).click();
await page.waitForTimeout(200);
log('E: route', await route());
await page.getByRole('button', { name: 'Godkänn åtgärdsplanen' }).first().click();
await page.waitForTimeout(150);
await page.locator('.modal').getByRole('button', { name: 'Godkänn åtgärdsplanen' }).click();
await page.waitForTimeout(200);
log('E: cd-3 efter', JSON.stringify(await page.evaluate(() => { const x = MM.store.state.contractDeviations.find((y) => y.id === 'cd-3'); return { st: x.status, appr: x.customerApprovedAt, by: x.customerApprovedBy }; })));
await visit(page, 'chef', 'chef.avvikelser', { id: 'cd-3' });
log('E: chef.avvikelser cd-3 efter', (await txt()).slice(0, 1500));
await page.screenshot({ path: `${SHOTS}/p03-e-avvikelse-efter.png`, fullPage: true });
await visit(page, 'chef', 'chef.avvikelser', {});
const el = await txt(); const ei = el.indexOf('praktikplatsen'); log('E: chef.avvikelser listan', el.slice(Math.max(0, ei - 400), ei + 400));
console.log('\nFEL:', JSON.stringify(errors, null, 1));
await close();
