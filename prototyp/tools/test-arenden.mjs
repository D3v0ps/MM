// Interaktionstest för src/views/arenden.js (arenden.lista, arende.kort, hand.start).
// Kör: node tools/test-arenden.mjs
import { openProto, visit } from './lib.mjs';

const { page, errors, close } = await openProto({ width: 1280, height: 900 });
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log(`OK   ${msg}`); else { fails++; console.log(`FEL  ${msg}`); } };
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 150) => page.waitForTimeout(ms);
const main = () => page.locator('#main').innerText();
const sc = await ev(() => MM.store.state.script);
const btn = (name, scope = page) => scope.getByRole('button', { name, exact: true });

try {
  // ------------------------------------------------------------ 1. Ärendelistan som samordnare
  let pr = await visit(page, 'samordnare', 'arenden.lista', {});
  ok(pr.length === 0, `Listan renderar utan fel (${pr.join('; ')})`);
  const total = await ev(() => MM.sel.visibleCases('samordnare').length);
  const rows = () => page.locator('.arn-wide tbody tr').count();
  ok(await rows() === 50, `Visar 50 rader först (${await rows()})`);
  ok((await main()).includes(`Visar 50 av ${total}`), 'Sidfoten visar "Visar 50 av …"');
  await btn('Visa 50 till').click(); await wait();
  ok(await rows() === 100, `"Visa 50 till" visar 100 rader (${await rows()})`);
  await page.fill('#arn-q', '0143'); await wait();
  ok(await rows() === 1 && (await page.locator('.arn-wide tbody').innerText()).includes('Nadia Warsame'), 'Sök på del av ärendenummer hittar Nadia');
  await page.fill('#arn-q', 'nadia warsame'); await wait();
  ok(await rows() === 1, 'Sök på namn fungerar');
  await btn('Rensa filter').click(); await wait();
  await page.selectOption('#arn-status', 'closed'); await wait();
  const closedN = await ev(() => MM.sel.visibleCases('samordnare').filter((c) => c.status === 'closed').length);
  ok(new RegExp(`${closedN} ärenden`, 'i').test(await main()), `Statusfilter Avslutad ger ${closedN} ärenden`); // rubriker är versaler via CSS
  await page.selectOption('#arn-status', 'alla');
  await page.selectOption('#arn-phase', '4'); await wait();
  const allPhase4 = await page.locator('.arn-wide tbody tr').evaluateAll((trs) => trs.every((tr) => tr.innerText.includes('Fas 4')));
  ok(allPhase4, 'Fasfilter visar bara fas 4');
  await btn('Rensa filter').click(); await wait();
  await page.check('#arn-onlyprot'); await wait();
  const protText = await page.locator('.arn-wide tbody').innerText();
  ok(await rows() === 1 && protText.includes('Skyddade personuppgifter – ingen åtkomst') && !protText.includes('Sanna'), 'Samordnaren ser skyddat ärende utan namn');
  await page.locator('.arn-wide tbody tr').first().click(); await wait();
  ok(await ev(() => MM.route.view) === 'arenden.lista', 'Skyddad rad går inte att öppna för samordnaren');
  await page.check('#arn-onlyflags'); await wait();

  // ------------------------------------------------------------ 2. Skyddade som avtalsansvarig (scenario s10)
  pr = await visit(page, 'avtalsansvarig', 'arenden.lista', { filter: 'skyddade' });
  ok(pr.length === 0 && (await main()).includes('vem ser vad'), 'Förklaringen om skyddade personuppgifter visas');
  ok((await page.locator('.arn-wide tbody').innerText()).includes('Sanna Lindgren'), 'Avtalsansvarig ser namnet i skyddat ärende');
  await page.locator('.arn-wide tbody tr').first().click(); await wait();
  ok(await ev(() => MM.route.view) === 'arende.kort' && await ev(() => MM.route.params.caseId) === sc.skyddad, 'Klick öppnar deltagarkortet');
  let t = await main();
  ok(t.includes('Ej tillämpligt') && !(await btn('Registrera samtycke').count()), 'Skyddat ärende: inget samtycke/AI kan registreras');
  ok(t.includes('Telefon enligt den säkra rutinen'), 'Skyddat ärende: kontaktväg via säker rutin');

  // ------------------------------------------------------------ 3. Coachens lista och åtkomst
  await visit(page, 'coach', 'arenden.lista', { filter: 'skyddade' });
  ok((await main()).includes('Du har inga ärenden med skyddade personuppgifter'), 'Coachen ser inga skyddade ärenden');
  const coachAll = await ev(() => MM.sel.visibleCases('coach').every((c) => c.leadCoachId === 'u-amira' || c.team.some((x) => x.userId === 'u-amira')));
  ok(coachAll, 'Coachens synliga ärenden är bara egna/team');
  const logBefore = await ev(() => MM.store.state.auditLog.length);
  pr = await visit(page, 'coach', 'arende.kort', { caseId: sc.skyddad });
  ok((await main()).includes('Du saknar åtkomst') && !(await main()).includes('Sanna'), 'Coach utan behörighet får tydlig ingen-åtkomst-ruta');
  ok(await ev((id) => MM.store.state.auditLog.some((x) => x.action === 'case.view_denied' && x.entityId === id), sc.skyddad), 'Nekat försök loggas');

  // ------------------------------------------------------------ 4. Deltagarkort, visning loggas, meddelanden
  pr = await visit(page, 'coach', 'arende.kort', { caseId: sc.nadia });
  ok(pr.length === 0, 'Deltagarkortet renderar');
  ok(await ev((id) => MM.store.state.auditLog.some((x) => x.action === 'case.view' && x.entityId === id && x.actorId === 'u-amira'), sc.nadia), 'Visning av deltagarkortet loggas');
  await page.getByRole('tab', { name: /Meddelanden/ }).click(); await wait(250);
  ok(await ev(() => MM.store.state.messages.find((m) => m.id === 'msg-3').readBy.includes('u-amira')), 'Olästa meddelanden markeras som lästa när fliken öppnas');
  const msgBefore = await ev(() => MM.store.state.messages.length);
  await page.fill('#arn-msg-body', 'Deltagaren 19730216-9545 har frågat om resor.');
  await btn('Skicka säkert meddelande').click(); await wait();
  ok(await ev(() => MM.store.state.messages.length) === msgBefore && (await main()).includes('Ta bort personnumret'), 'Meddelande med personnummer stoppas');
  await page.fill('#arn-msg-body', 'Hej Maria! Tisdag vecka 6 kl. 10 passar bra för uppföljningsmötet.');
  await btn('Skicka säkert meddelande').click(); await wait();
  const msg = await ev(() => { const st = MM.store.state; return { n: st.messages.length, last: st.messages[st.messages.length - 1], ntf: st.notifications[st.notifications.length - 1] }; });
  ok(msg.n === msgBefore + 1 && msg.last.senderId === 'u-amira', 'Meddelandet sparas i tråden');
  ok(msg.ntf.template === 'nytt_meddelande' && msg.ntf.body.includes('BOT-26-0143') && !/Nadia|Warsame/.test(msg.ntf.body), 'Mejlet till kommunen saknar personuppgifter');

  // ------------------------------------------------------------ 5. Avvikelse och kallelse (scenario s5)
  pr = await visit(page, 'coach', 'arende.kort', { caseId: sc.yusuf, tab: 'avvikelser' });
  ok(pr.length === 0 && (await main()).includes('Upprepad ogiltig frånvaro'), 'Avvikelsefliken visar flaggad upprepad frånvaro');
  ok(!/eskaler/i.test(await main()), 'Coachen ser ingen eskalering till chef (avvikelser)');
  const devBefore = await ev((id) => MM.store.state.deviations.filter((x) => x.caseId === id).length, sc.yusuf);
  await btn('Ny avvikelse').click(); await wait();
  await btn('Spara avvikelsen').click(); await wait();
  ok((await main()).includes('En avvikelse ska alltid ha en åtgärd'), 'Avvikelse utan åtgärd stoppas');
  await btn('Upprepad ogiltig frånvaro').click();
  await page.fill('#arn-dev-assess', 'Risk att insatsen avbryts om frånvaron fortsätter.');
  await page.fill('#arn-dev-action', 'Samtal om hinder, ny veckoplan och uppföljningsmöte med handläggaren.');
  await page.fill('#arn-dev-follow', '2027-02-08');
  await page.check('#arn-dev-cust');
  await btn('Spara avvikelsen').click(); await wait(250);
  const dev = await ev((id) => MM.store.state.deviations.filter((x) => x.caseId === id), sc.yusuf);
  ok(dev.length === devBefore + 1 && dev.some((x) => x.status === 'open' && x.action.startsWith('Samtal om hinder') && x.needsCustomerDecision && x.ownerId === 'u-amira'), 'Avvikelsen sparas med åtgärd, ansvarig och uppföljning');
  const modal = page.locator('.modal');
  ok(await modal.count() === 1 && /Kalla kommunen till uppföljning/i.test(await modal.innerText()), 'Kräver kommunens beslut → kallelsen öppnas direkt');
  await btn('Avbryt', modal).click(); await wait();
  await btn('Kalla kommunen till uppföljning').click(); await wait();
  const body = await page.inputValue('#arn-call-body');
  ok(body.includes('BOT-26-0148') && body.includes('Upprepad ogiltig frånvaro') && !/19\d{6}-?\d{4}/.test(body), 'Föreslagen mötestext innehåller ärendenummer och avvikelse');
  ok((await modal.innerText()).includes('logga in för att läsa'), 'Modalen visar att mejlet saknar personuppgifter');
  await page.fill('#arn-call-at', '2027-02-03T10:00');
  const before = await ev(() => ({ m: MM.store.state.messages.length, n: MM.store.state.notifications.length }));
  await btn('Skicka kallelsen').click(); await wait(250);
  const after = await ev((id) => { const st = MM.store.state; return { m: st.messages.length, last: st.messages[st.messages.length - 1], ntf: st.notifications.slice(-1)[0], dev: st.deviations.filter((x) => x.caseId === id && x.followUpMeetingAt) }; }, sc.yusuf);
  ok(after.m === before.m + 1 && after.last.kind === 'meeting_request', 'Kallelsen skickas som säkert meddelande');
  ok(after.ntf.template === 'nytt_meddelande' && after.ntf.to === 'maria.ekdahl@botkyrka.se' && !/Yusuf|Abdi/.test(after.ntf.body), 'Kommunen får mejl utan personuppgifter');
  ok(after.dev.some((x) => x.followUpMeetingAt === '2027-02-03T10:00'), 'Föreslagen mötestid sparas på avvikelsen');
  ok((await main()).includes('Kallelsen är skickad'), 'Bekräftelse visas med perspektivbyte');
  await page.getByRole('tab', { name: /Översikt/ }).click(); await wait();
  ok(!/eskaler/i.test(await main()), 'Coachen ser ingen eskalering till chef (översikt)');

  // ------------------------------------------------------------ 6. Chefen: läsläge och eskalering syns
  pr = await visit(page, 'chef', 'arende.kort', { caseId: sc.yusuf });
  t = await main();
  ok(pr.length === 0 && t.includes('Läsläge'), 'Chefen ser kortet i läsläge');
  ok(/veckor i rad utan progression/.test(t), 'Chefen ser eskaleringen');
  for (const name of ['Byt huvudcoach', 'Återkalla samtycke', 'Registrera samtycke', 'Ny veckoavstämning']) ok(await btn(name).count() === 0, `Chefen har ingen knapp "${name}"`);
  await page.getByRole('tab', { name: /Avvikelser/ }).click(); await wait();
  ok(await btn('Kalla kommunen till uppföljning').count() === 0 && await btn('Ny avvikelse').count() === 0, 'Chefen kan inte skapa avvikelser eller kalla kommunen');
  await page.getByRole('tab', { name: /Meddelanden/ }).click(); await wait();
  ok(await page.locator('#arn-msg-body').count() === 0, 'Chefen kan inte skriva meddelanden');

  // ------------------------------------------------------------ 7. Samtycke (coach, Elif – inte tillfrågad)
  await visit(page, 'coach', 'arende.kort', { caseId: sc.elif });
  await btn('Registrera samtycke').click(); await wait();
  await btn('Registrera samtycke', modal).click(); await wait();
  ok((await modal.innerText()).includes('Bekräfta att deltagaren'), 'Samtycke kräver bekräftelse');
  await page.check('#arn-cons-ok');
  await btn('Registrera samtycke', modal).click(); await wait();
  ok(await ev((id) => MM.sel.caseById(id).aiConsent, sc.elif) === 'given', 'Samtycke registreras (consent.set given)');
  await btn('Återkalla samtycke').click(); await wait();
  await btn('Återkalla samtycket', page.locator('.modal')).click(); await wait();
  ok(await ev((id) => MM.sel.caseById(id).aiConsent, sc.elif) === 'revoked', 'Samtycket kan återkallas');

  // ------------------------------------------------------------ 8. Byt huvudcoach (samordnare)
  await visit(page, 'samordnare', 'arende.kort', { caseId: sc.coachbyte });
  await btn('Byt huvudcoach').click(); await wait();
  ok((await modal.innerText()).includes('kommunens godkännande'), 'Krav på kommunens godkännande vid byte av nyckelpersonal visas');
  await btn('Byt huvudcoach', modal).click(); await wait();
  ok((await modal.innerText()).includes('Skriv orsaken'), 'Orsak är obligatorisk');
  await page.selectOption('#arn-coach-to', 'u-leila');
  await page.fill('#arn-coach-reason', 'Sjukskrivning – Leila tar över från vecka 6.');
  await btn('Byt huvudcoach', modal).click(); await wait(250);
  const cb = await ev((id) => { const st = MM.store.state; const c = MM.sel.caseById(id); return { lead: c.leadCoachId, hist: st.caseStatusHistory.filter((h) => h.caseId === id && h.toCoach === 'u-leila' && h.reason.startsWith('Sjukskrivning')).length, un: st.userNotifications.filter((n) => n.recipientId === 'u-leila' && n.caseId === id).length, mail: st.notifications.filter((n) => n.template === 'coachbyte' && n.caseId === id).length }; }, sc.coachbyte);
  ok(cb.lead === 'u-leila' && cb.hist === 1, 'Huvudcoach byts och orsaken loggas i historiken');
  ok(cb.un >= 1 && cb.mail === 1, 'Nya coachen och handläggaren får notis');

  // ------------------------------------------------------------ 9. Boka första möte (samordnare)
  await visit(page, 'samordnare', 'arende.kort', { caseId: sc.ingetmote });
  ok((await main()).includes('Första mötet är inte bokat'), 'Saknat första möte flaggas');
  await btn('Boka första möte').first().click(); await wait();
  await page.fill('#arn-meet-at', '2027-02-06T10:00');
  await btn('Boka mötet', modal).click(); await wait();
  ok((await modal.innerText()).includes('inte en arbetsdag'), 'Helgdag stoppas');
  await page.fill('#arn-meet-at', '2027-02-02T13:00');
  await btn('Boka mötet', modal).click(); await wait();
  ok(await ev((id) => MM.sel.caseById(id).firstMeetingAt, sc.ingetmote) === '2027-02-02T13:00', 'Första mötet bokas (case.bookFirstMeeting)');

  // ------------------------------------------------------------ 10. Handledaren
  pr = await visit(page, 'handledare', 'hand.start', {});
  t = await main();
  ok(pr.length === 0 && t.includes('Du ser bara ärenden du är tilldelad'), 'hand.start förklarar behörigheten');
  const petraActive = await ev(() => MM.sel.visibleCases('handledare').filter((c) => c.team.some((x) => x.userId === 'u-petra') && ['active', 'paused'].includes(c.status)).length);
  ok(t.includes(`Pågående (${petraActive})`), `Pågående ärenden räknas rätt (${petraActive})`);
  ok(await page.locator('.grid > .card').count() === Math.min(12, petraActive), 'Kort per ärende visas (högst 12 åt gången)');
  if (petraActive > 12) { await btn('Visa fler').click(); await wait(); ok(await page.locator('.grid > .card').count() === Math.min(24, petraActive), '"Visa fler" visar fler kort'); }
  pr = await visit(page, 'handledare', 'arende.kort', { caseId: sc.nadia, tab: 'avstamningar' });
  t = await main();
  ok(await page.getByRole('tab').count() === 4, 'Handledaren ser fyra flikar');
  ok(t.includes('Den delen visas inte för din roll'), 'Flik med coachens anteckningar nekas för handledaren');
  ok(!/eskaler/i.test(t) && !t.includes('Följde planen'), 'Handledaren ser varken eskaleringar eller coachens anteckningar');
  await visit(page, 'handledare', 'arende.kort', { caseId: sc.yusuf });
  ok((await main()).includes('Du ser bara ärenden du är tilldelad'), 'Handledaren når inte ärenden utanför teamet');

  // ------------------------------------------------------------ 11. Mobil: ingen horisontell scroll
  await page.setViewportSize({ width: 400, height: 860 });
  for (const [role, view, params] of [['samordnare', 'arenden.lista', {}], ['coach', 'arende.kort', { caseId: sc.nadia, tab: 'narvaro' }], ['handledare', 'hand.start', {}]]) {
    await visit(page, role, view, params);
    const over = await ev(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1, `${view} utan horisontell scroll på 400 px (${over})`);
  }
} catch (e) {
  fails++; console.log('FEL  Undantag:', e.message);
}

ok(errors.length === 0, `Inga konsol- eller sidfel (${errors.join(' | ')})`);
console.log(fails ? `\n${fails} fel.` : '\nAlla kontroller gick igenom.');
await close();
process.exit(fails ? 1 : 0);
