// Interaktionstest för kommunens portal (src/views/kommun.js).
// Kör: node tools/test-kommun.mjs [--shots KATALOG]   (skärmdumpar i 400 px bredd, hela sidan)
import fs from 'node:fs';
import path from 'node:path';
import { openProto, visit } from './lib.mjs';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const { page, errors, close } = await openProto();
let failures = 0; let passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FEL  ${msg}`); } };
const st = (fn, arg) => page.evaluate(fn, arg);
const text = () => page.evaluate(() => document.querySelector('#main').innerText);
const route = () => st(() => ({ view: MM.route.view, role: MM.route.role, params: MM.route.params }));
const calm = () => page.addStyleTag({ content: '.toasts, .fb-fab { pointer-events: none !important; }' });
const shot = async (name) => {
  if (!shotsDir) return;
  await page.setViewportSize({ width: 400, height: 860 }); await page.waitForTimeout(80);
  const h = await page.addStyleTag({ content: '.toasts, .fb-fab { display: none !important; } .topbars { position: static !important; }' });
  await page.screenshot({ path: path.join(shotsDir, `${name}__m.png`), fullPage: true });
  await h.evaluate((el) => el.remove());
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(40);
};
const noHScroll = async (label) => {
  await page.setViewportSize({ width: 400, height: 860 }); await page.waitForTimeout(80);
  const over = await st(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, `${label}: ingen horisontell scroll på 400 px (${over})`);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(40);
};
await calm();

// ------------------------------------------------------------ 1. Inloggning
console.log('\n1. Inloggning med e-post och engångskod');
await visit(page, 'kommun_handlaggare', 'kom.login');
ok((await page.inputValue('#kom-login-email')) === 'maria.ekdahl@botkyrka.se', 'e-post är förifylld för Maria');
ok(/Safe Links/.test(await text()), 'förklarar varför kod i stället för länk (Safe Links)');
ok(/60 minuter utan aktivitet/.test(await text()), 'nämner utloggning efter 60 minuters inaktivitet');
await page.fill('#kom-login-email', 'maria.ekdahl@gmail.com');
await page.getByRole('button', { name: 'Skicka kod' }).click();
ok(/bara öppen för adresser som slutar på @botkyrka\.se/.test(await text()), 'otillåten domän stoppas med förklaring');
await page.fill('#kom-login-email', 'maria.ekdahl@botkyrka.se');
await page.getByRole('button', { name: 'Skicka kod' }).click();
ok(/Koden gäller i 10 minuter/.test(await text()) && /Du har 5 försök/.test(await text()), 'steg 2 visar giltighetstid och antal försök');
await shot('login-kod');
await page.fill('#kom-login-code', '123');
await page.getByRole('button', { name: 'Logga in' }).click();
ok(/Koden har 6 siffror\. Du har skrivit 3\./.test(await text()), 'för kort kod ger tydligt fel');
const loginBefore = await st(() => MM.store.state.auditLog.filter((x) => x.action === 'auth.login').length);
await page.fill('#kom-login-code', '482913');
await page.getByRole('button', { name: 'Logga in' }).click();
await page.waitForTimeout(150);
let r = await route();
ok(r.view === 'kom.start' && r.role === 'kommun_handlaggare', `handläggaren hamnar på kom.start (${r.view})`);
ok(await st(() => MM.store.state.customerUsers.find((u) => u.id === 'k-maria').lastLoginAt === MM.store.state.auditLog.filter((x) => x.action === 'auth.login').slice(-1)[0].occurredAt), 'senaste inloggning uppdaterad');
ok((await st(() => MM.store.state.auditLog.filter((x) => x.action === 'auth.login').length)) === loginBefore + 1, 'inloggningen loggas i revisionsloggen');
// Chefen loggar in via sin adress och hamnar på beställarrapporten
await visit(page, 'kommun_handlaggare', 'kom.login');
await page.getByRole('button', { name: /Fyll i Eva Bergström/ }).click();
await page.getByRole('button', { name: 'Skicka kod' }).click();
await page.fill('#kom-login-code', '000000');
await page.getByRole('button', { name: 'Logga in' }).click();
await page.waitForTimeout(150);
r = await route();
ok(r.view === 'kom.chef' && r.role === 'kommun_chef', `chefens adress loggar in som kommunens chef (${r.role} / ${r.view})`);
// Okänd adress på rätt domän: inte inbjuden, ingen inloggning
await visit(page, 'kommun_handlaggare', 'kom.login');
const auditBeforeUnknown = await st(() => MM.store.state.auditLog.filter((x) => x.action === 'auth.login').length);
await page.fill('#kom-login-email', 'okand.person@botkyrka.se');
await page.getByRole('button', { name: 'Skicka kod' }).click();
ok(/inte inbjuden till portalen/.test(await text()) && (await page.locator('#kom-login-code').count()) === 0, 'okänd @botkyrka.se-adress får beskedet att den inte är inbjuden');
ok((await st(() => MM.store.state.auditLog.filter((x) => x.action === 'auth.login').length)) === auditBeforeUnknown, 'ingen inloggning loggas för okänd adress');
ok((await st(() => MM.dispatch('kom.login', { email: 'okand.person@botkyrka.se' }))).error === 'unknown', 'kom.login avvisar okänd adress (ingen reserv till aktuell roll)');
await shot('login-okand');
// Spärrad användare kommer inte in
await st(() => MM.dispatch('admin.setCustomerActive', { userId: 'k-maria', active: false }));
await visit(page, 'kommun_handlaggare', 'kom.login');
await page.fill('#kom-login-email', 'maria.ekdahl@botkyrka.se');
await page.getByRole('button', { name: 'Skicka kod' }).click();
ok(/spärrat/.test(await text()) && (await page.locator('#kom-login-code').count()) === 0, 'spärrad användare stoppas vid inloggningen');
ok((await st(() => MM.dispatch('kom.login', { email: 'maria.ekdahl@botkyrka.se' }))).error === 'blocked', 'kom.login avvisar spärrad användare');
await st(() => MM.dispatch('admin.setCustomerActive', { userId: 'k-maria', active: true }));
await visit(page, 'kommun_handlaggare', 'kom.login');
await page.fill('#kom-login-email', 'maria.ekdahl@botkyrka.se');
await page.getByRole('button', { name: 'Skicka kod' }).click();
ok((await page.locator('#kom-login-code').count()) === 1, 'aktiverad igen – kan få kod');
// Kolla din e-post: adressen bryts på mobil
await page.setViewportSize({ width: 400, height: 860 }); await page.waitForTimeout(80);
const mailOverflow = await st(() => { const b = document.querySelector('.notice b'); const n = document.querySelector('.notice'); return b && n ? b.getBoundingClientRect().right - n.getBoundingClientRect().right : 0; });
ok(mailOverflow <= 0, `e-postadressen stannar inne i rutan på 400 px (${Math.round(mailOverflow)})`);
await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(40);

// ------------------------------------------------------------ 2. Startsida
console.log('\n2. Startsida för handläggaren');
await visit(page, 'kommun_handlaggare', 'kom.start');
ok((await page.locator('.bigbtn').count()) === 3, 'tre stora knappar');
const bigTexts = await page.locator('.bigbtn').allInnerTexts();
ok(/Beställ ny insats/.test(bigTexts[0]) && /Mina deltagare/.test(bigTexts[1]) && /Rapporter och meddelanden/.test(bigTexts[2]), 'knapparna har rätt text och ordning');
const unreadCount = await st(() => MM.sel.komUnreadReports('k-maria').filter((r) => r.kind !== 'order_confirmation').length + MM.sel.komUnreadMessages('k-maria', 'kommun_handlaggare').length);
ok(new RegExp(`Olästa rapporter och meddelanden \\(${unreadCount}\\)`, 'i').test(await text()), `olästa överst (${unreadCount})`);
ok(/Tre korta steg och en granskning/.test(await text()), 'startknappen säger tre steg och en granskning');
ok((await page.getByRole('button', { name: 'Se startsidan hos Miljonbemanning' }).count()) === 1, 'perspektivbyte finns på startsidan');
await page.getByRole('button', { name: /Visa alla olästa/ }).click();
r = await route();
ok(r.view === 'kom.rapporter' && r.params.filter === 'olasta', 'Visa alla olästa öppnar rapporterna med filtret Olästa');
ok(await page.locator('[aria-label="Visa rapporter"] button[aria-pressed="true"]', { hasText: 'Olästa' }).count() === 1, 'filtret Olästa är valt');
await visit(page, 'kommun_handlaggare', 'kom.start');
const firstNew = await page.locator('.kom-unread').first().boundingBox(); const firstBig = await page.locator('.bigbtn').first().boundingBox();
ok(firstNew && firstBig && firstNew.y < firstBig.y, 'olästa visas ovanför knapparna');
await shot('start');
await page.locator('.bigbtn').first().click();
ok((await route()).view === 'kom.bestall', 'knappen öppnar beställningen');

// ------------------------------------------------------------ 3. Beställning
console.log('\n3. Beställning i tre steg');
await visit(page, 'kommun_handlaggare', 'kom.bestall');
ok((await page.inputValue('#kom-o-name')) === 'Maria Ekdahl' && (await page.inputValue('#kom-o-email')) === 'maria.ekdahl@botkyrka.se', 'kontaktuppgifter förifyllda');
ok(/Steg 1 av 3/i.test(await text()) && /tre korta steg och en granskning/.test(await text()), 'stegvisaren och ingressen säger tre steg och en granskning');
ok((await page.locator('.kom-stepper li').count()) === 4 && (await page.locator('.kom-stepper li.review .n svg, .kom-stepper li.review .n .ic').count()) >= 1, 'granskningen visas utan stegnummer i stegvisaren');
ok(/8–10 siffror/.test(await text()) === (await st(() => MM.valid.buyerRefLengthText() === '8–10')), 'hjälptexten för referensen läses från avtalet');
ok((await page.getByRole('button', { name: 'Se hur beställningar tas emot hos Miljonbemanning' }).count()) === 1, 'perspektivbyte finns i beställningen');
ok((await page.inputValue('#kom-o-ref')) === '4410023817', 'sparad beställarreferens förifylld');
await page.fill('#kom-o-ref', '44100');
ok(/ska vara 8–10 siffror\. Du har skrivit 5/.test(await text()), 'beställarreferensen valideras direkt');
await page.fill('#kom-o-ref', '4410-0238');
ok(/bara innehålla siffror/.test(await text()), 'bindestreck ger förklarande fel');
await page.fill('#kom-o-ref', '55102983');
ok(/spärrad/.test(await text()), 'spärrad referens upptäcks');
await page.getByRole('button', { name: /Nästa/ }).click();
ok((await page.locator('h2', { hasText: 'Beställning och kontakt' }).count()) === 1, 'kan inte gå vidare med fel referens');
ok(/Välj hur många veckor/.test(await text()), 'omfattning i veckor krävs');
await page.fill('#kom-o-ref', '4410023817');
ok(/rätt format/.test(await text()), 'giltig referens bekräftas');
await page.fill('#kom-o-start', '2027-02-15');
await page.getByRole('group', { name: 'Planerad omfattning i veckor' }).getByRole('button', { name: '8', exact: true }).click();
ok((await page.inputValue('#kom-o-end')) === '2027-04-09', `slutdatum räknas fram (${await page.inputValue('#kom-o-end')})`);
await page.getByRole('button', { name: /Nästa/ }).click();
ok((await page.locator('h2', { hasText: /^Deltagare$/ }).count()) === 1, 'steg 2: deltagare');
ok(/Lämna bara de uppgifter som behövs/.test(await text()), 'mallens text om dataminimering visas');
await page.getByRole('group', { name: 'Skyddade personuppgifter' }).getByRole('button', { name: 'Nej' }).click();
await page.fill('#kom-o-fn', 'Test'); await page.fill('#kom-o-ln', 'Dubblett');
const nadiaPnr = await st(() => MM.sel.person(MM.sel.caseByTag('nadia')).pnr);
await page.fill('#kom-o-pnr', nadiaPnr);
ok(/Personen har redan en pågående insats/.test(await text()) && /BOT-26-0143/.test(await text()), 'dubblettkontroll visar pågående insats');
await page.fill('#kom-o-pnr', '1988041');
await page.getByRole('button', { name: /Nästa/ }).click();
ok(/ÅÅÅÅMMDD-NNNN/.test(await text()), 'felaktigt personnummer får formatfel');
await page.fill('#kom-o-fn', 'Samira'); await page.fill('#kom-o-ln', 'Testsson');
await page.fill('#kom-o-pnr', '19880412-3456');
await page.fill('#kom-o-dphone', '070-000 11 22');
await page.fill('#kom-o-city', 'Tumba');
await page.getByRole('group', { name: 'Föredragen kontaktväg' }).getByRole('button', { name: 'Brev' }).click();
ok(await page.locator('#kom-o-addr').isVisible(), 'adressfält visas bara vid kallelse per brev');
await page.getByRole('button', { name: /Nästa/ }).click();
ok(/Skriv hela adressen/.test(await text()), 'adress krävs vid brev');
await page.fill('#kom-o-addr', 'Testgatan 1, 147 30 Tumba');
await page.fill('#kom-o-needs', 'Behöver skriftliga instruktioner.');
await shot('bestall-steg2');
await page.getByRole('button', { name: /Nästa/ }).click();
ok((await page.locator('h2', { hasText: 'Avtalsområde' }).count()) === 1, 'steg 3: avtalsområde');
await page.getByRole('button', { name: /Nästa/ }).click();
ok(/Välj ett avtalsområde/.test(await text()), 'avtalsområde krävs');
const areaOptions = await page.locator('#kom-o-area option').count();
ok(areaOptions === 13, `A–L finns att välja (${areaOptions - 1} områden)`);
await page.selectOption('#kom-o-area', 'G');
await page.selectOption('#kom-o-area2', 'J');
await page.getByRole('group', { name: 'Förslag på yrkesspår' }).getByRole('button', { name: 'Truckförare A+B' }).click();
ok((await page.inputValue('#kom-o-track')) === 'Truckförare A+B', 'förslag på yrkesspår fyller i fältet');
await page.fill('#kom-o-bg', 'Har arbetat på lager i två år. Vill ta truckkort.');
await page.getByRole('button', { name: /Nästa/ }).click();
ok((await page.locator('h2', { hasText: 'Granska och skicka' }).count()) === 1, 'granskningssteg');
ok(/Granska innan du skickar/i.test(await text()) && !/Steg 4 av/i.test(await text()), 'granskningen räknas inte som ett fjärde steg');
const review = await text();
ok(/•+-?3456/.test(review) && !/19880412-3456/.test(review), 'personnumret visas maskerat i granskningen');
ok(/Beställningens värde/i.test(review) && /8 veckor ×/.test(review), 'beställningens värde visas');
await shot('bestall-granska');
const expectedNo = await st(() => MM.sel.previewNextCaseNumber());
const casesBefore = await st(() => MM.store.state.cases.length);
await page.getByRole('button', { name: 'Skicka beställningen' }).click();
await page.waitForTimeout(150);
const created = await st(() => { const c = MM.store.state.cases.slice(-1)[0]; const p = MM.sel.person(c); const n = MM.store.state.notifications.filter((x) => x.caseId === c.id); return { c, p, n }; });
ok((await st(() => MM.store.state.cases.length)) === casesBefore + 1, 'ett nytt ärende skapades');
ok(created.c.number === expectedNo, `ärendenummer ${created.c.number}`);
ok(created.c.source === 'portal' && created.c.referrerId === 'k-maria' && created.c.status === 'acknowledged', 'källa portal, beställare Maria, status ordererkänd');
ok(created.c.primaryArea === 'G' && created.c.secondaryArea === 'J' && created.c.plannedWeeks === 8 && created.c.buyerReference === '4410023817', 'område, veckor och referens sparade');
ok(created.p.address === 'Testgatan 1, 147 30 Tumba' && created.p.preferredContact === 'letter', 'adress sparad eftersom kallelse sker per brev');
const ack = created.n.find((x) => x.template === 'ordererkannande');
ok(!!ack && ack.body.includes(created.c.number) && !/Samira|Testsson|3456|Tumba/.test(ack.body), 'mejlet innehåller ärendenumret men inga personuppgifter');
const doneText = await text();
ok(doneText.includes(created.c.number) && /Tack! Vi har tagit emot er beställning/.test(doneText), 'ordererkännandet visas direkt på skärmen');
ok(/Mejlet innehåller bara ärendenumret/.test(doneText), 'förklarar att mejlet bara innehåller ärendenumret');
await shot('bestall-klar');
await noHScroll('Ordererkännande');
// Perspektivbyte till samordnarens inkorg
const hasInbox = await st(() => !!MM.views['sam.inkorg']);
await page.getByRole('button', { name: 'Se hur beställningen landar hos Miljonbemanning' }).click();
await page.waitForTimeout(150);
r = await route();
if (hasInbox) ok(r.view === 'sam.inkorg' && r.role === 'samordnare' && r.params.caseId === created.c.id, 'perspektivbyte öppnar ärendet i avropsinkorgen');
else ok(r.view === 'kom.bestall', 'avropsinkorgen finns inte ännu – perspektivbytet stannar kvar (ok)');
// Beställ en till – steg 1 behåller kontaktuppgifter, deltagaren töms
await visit(page, 'kommun_handlaggare', 'kom.bestall');
ok((await page.inputValue('#kom-o-ref')) === '4410023817', 'ny beställning förifyller senast använda referensen');

// Skyddade personuppgifter
console.log('\n3b. Beställning med skyddade personuppgifter');
await page.getByRole('group', { name: 'Planerad omfattning i veckor' }).getByRole('button', { name: '6', exact: true }).click();
await page.getByRole('button', { name: /Nästa/ }).click();
await page.getByRole('group', { name: 'Skyddade personuppgifter' }).getByRole('button', { name: 'Ja' }).click();
ok(/Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen\./.test(await text()), 'säker rutin visas vid ja');
ok(!(await page.locator('#kom-o-dphone').count()) && !(await page.locator('#kom-o-city').count()), 'telefon och ort efterfrågas inte');
await page.fill('#kom-o-fn', 'Skyddad'); await page.fill('#kom-o-ln', 'Person'); await page.fill('#kom-o-pnr', '19790101-1111');
await page.getByRole('button', { name: /Nästa/ }).click();
ok((await page.locator('h2', { hasText: 'Granska och skicka' }).count()) === 1, 'steg 3 hoppas över');
await page.getByRole('button', { name: 'Skicka beställningen' }).click();
await page.waitForTimeout(150);
const prot = await st(() => { const c = MM.store.state.cases.slice(-1)[0]; const p = MM.sel.person(c); const n = MM.store.state.notifications.slice(-1)[0]; return { c, p, n }; });
ok(prot.p.protectedIdentity && prot.p.phone === '' && prot.p.address === null && prot.p.city === '' && prot.c.status === 'received', 'bara namn, personnummer och handläggare sparas');
ok(prot.c.buyerReference === '4410023817' && prot.c.plannedWeeks === 6 && !!prot.c.desiredStart, 'uppgifterna från steg 1 (beställarreferens, start, veckor) behålls');
ok(!prot.c.primaryArea && !prot.c.backgroundInfo, 'inga övriga uppgifter om deltagaren sparas');
ok(prot.n.template === 'generisk_mottagningsbekraftelse' && !prot.n.body.includes(prot.c.number), 'bara generisk mottagningsbekräftelse i mejlet');
const protDone = await text();
ok(/utan ärendenummer och utan personuppgifter/.test(protDone) && !/Mejlet innehåller bara ärendenumret/.test(protDone), 'kvittot beskriver den generiska bekräftelsen rätt');
ok(!/på det sätt du valde/.test(protDone) && /säkra rutinen/.test(protDone), 'kvittot lovar ingen kallelse enligt vald kontaktväg');
ok(await st((id) => MM.store.state.tasks.some((t) => t.kind === 'protected_order' && (t.caseIds || []).includes(id)), prot.c.id), 'avtalsansvarig får en uppgift om skyddad beställning');
await shot('bestall-skyddad-klar');
await page.getByRole('button', { name: 'Se hur beställningen landar hos Miljonbemanning' }).click();
await page.waitForTimeout(150);
r = await route();
ok(r.role === 'avtalsansvarig' && r.view === 'sam.inkorg', `skyddad beställning öppnas som avtalsansvarig (${r.role})`);

// ------------------------------------------------------------ 4. Deltagare
console.log('\n4. Mina deltagare');
await visit(page, 'kommun_handlaggare', 'kom.deltagare');
const nOwn = await st(() => MM.sel.visibleCases('kommun_handlaggare', 'k-maria').filter((c) => !['closed', 'declined'].includes(c.status)).length);
ok(/De deltagare som du har beställt en insats för/.test(await text()) && new RegExp(`${nOwn} deltagare`, 'i').test(await text()), 'listan använder begreppet deltagare');
ok(new RegExp(`Pågår och på väg \\(${nOwn}\\)`).test(await text()), `lista med egna aktuella ärenden (${nOwn})`);
await page.fill('#kom-sok', 'BOT-26-0143');
ok((await page.locator('.list .list-item').count()) === 1 && /Nadia Warsame/.test(await text()), 'sök på ärendenummer');
await shot('deltagare-lista');
await page.locator('.list .list-item').first().click();
r = await route();
ok(r.view === 'kom.deltagare' && r.params.caseId === (await st(() => MM.store.state.script.nadia)), 'öppnar deltagaren');
const det = await text();
ok(/Ordererkänd/.test(det) && /Bekräftad/.test(det) && /Pågår/.test(det) && /Avslutad/.test(det), 'tidslinje Mottagen → Avslutad');
ok(/Ansvarig coach/.test(det) && /Amira Haddad/.test(det) && /Beställningens värde/.test(det) && /Första mötet/.test(det), 'orderbekräftelsens innehåll');
ok(/Närvarande \d+ av \d+ tillfällen/.test(det), 'närvaro sammanfattad');
ok(!/anteckning/i.test(det.replace('Coachens egna anteckningar visas inte för beställaren', '')), 'inga coachanteckningar');
ok(await st(() => MM.store.state.auditLog.some((x) => x.action === 'case.view' && x.entityId === MM.store.state.script.nadia && x.actorId === 'k-maria')), 'visningen loggas');
await shot('deltagare-detalj');
await noHScroll('Deltagarens översikt');
await page.getByRole('tab', { name: /Rapporter/ }).click();
ok((await page.locator('.list .list-item').count()) > 0, 'levererade rapporter listas');
await page.getByRole('tab', { name: /Meddelanden/ }).click();
const msgBefore = await st(() => MM.store.state.messages.length);
await page.fill('#kom-msg', 'Hej! Deltagaren har personnummer 19730216-9545.');
await page.getByRole('button', { name: 'Skicka meddelandet' }).click();
ok(/ser ut som ett personnummer/.test(await text()) && (await st(() => MM.store.state.messages.length)) === msgBefore, 'personnummer i meddelandet stoppas');
await page.fill('#kom-msg', 'Hej Amira! Tisdag förmiddag vecka 6 passar bra för uppföljningen.');
await page.getByRole('button', { name: 'Skicka meddelandet' }).click();
const lastMsg = await st(() => MM.store.state.messages.slice(-1)[0]);
ok(lastMsg.senderId === 'k-maria' && /Tisdag förmiddag/.test(lastMsg.body), 'meddelandet skickas med message.send');
ok(await st((id) => MM.store.state.notifications.some((n) => n.template === 'nytt_meddelande' && n.caseId === id && !/Tisdag/.test(n.body)), lastMsg.caseId), 'notisen innehåller inte meddelandets text');
await shot('deltagare-meddelanden');
// Mötesförfrågan från coachen (scenario 5): skicka som coach, läs som kommunen
const yusuf = await st(() => MM.store.state.script.yusuf);
await visit(page, 'coach', 'coach.minvecka');
await st((caseId) => MM.dispatch('deviation.callCustomer', { caseId, body: 'Hej Maria! Jag vill boka ett uppföljningsmöte om frånvaron. Passar torsdag 4/2 kl. 13?', proposedAt: '2027-02-04T13:00' }), yusuf);
await visit(page, 'kommun_handlaggare', 'kom.start');
ok(/Mötesförfrågan om BOT-26-0148/.test(await text()), 'mötesförfrågan syns bland olästa på startsidan');
await visit(page, 'kommun_handlaggare', 'kom.deltagare', { caseId: yusuf });
ok(/Du har ett nytt meddelande/.test(await text()), 'nytt meddelande lyfts fram i översikten');
ok(await st((id) => MM.sel.messagesOf(id).slice(-1)[0].readBy.length === 0, yusuf), 'inte markerad som läst förrän den öppnas');
await page.getByRole('button', { name: 'Läs och svara' }).click();
await page.waitForTimeout(100);
ok(/Mötesförfrågan/.test(await text()), 'mötesförfrågan visas i tråden');
ok(await st((id) => MM.sel.messagesOf(id).slice(-1)[0].readBy.includes('k-maria'), yusuf), 'meddelandet markeras som läst');
await page.getByRole('button', { name: 'Tiden passar' }).click();
ok((await page.inputValue('#kom-msg')).startsWith('Tack! Tiden passar'), 'snabbsvar fyller i meddelandet');
// Ärende som en annan handläggare beställt
await visit(page, 'kommun_handlaggare', 'kom.deltagare', { caseId: await st(() => MM.store.state.script.elif) });
ok(/Du har inte tillgång/i.test(await text()), 'handläggaren ser inte andras ärenden');
// Chefen ser enhetens ärenden men skyddade namn döljs
await visit(page, 'kommun_chef', 'kom.deltagare');
ok(/Enhetens deltagare/i.test(await text()) && (await page.locator('#kom-who').count()) === 1, 'chefen ser enhetens deltagare med filter per handläggare');
await visit(page, 'kommun_chef', 'kom.deltagare', { caseId: await st(() => MM.store.state.script.skyddad) });
const skT = await text();
ok(/Skyddade personuppgifter/i.test(skT) && !(await st(() => { const p = MM.sel.person(MM.sel.caseByTag('skyddad')); return document.querySelector('#main').innerText.includes(p.lastName); })), 'skyddat namn visas inte för chefen');
ok(!(await page.locator('#kom-msg').count()), 'chefen kan inte skriva meddelanden');
ok(/Bara handläggaren som beställde/.test(skT), 'chefen ser att uppgifterna bara visas för handläggaren');
await page.getByRole('tab', { name: /Meddelanden/ }).click();
ok(/Meddelandena visas bara för handläggaren/.test(await text()), 'chefen läser inte meddelanden om skyddad deltagare');
await page.getByRole('button', { name: 'Se samma deltagare hos Miljonbemanning' }).click();
await page.waitForTimeout(150);
r = await route();
ok(r.role === 'avtalsansvarig' && r.view === 'arende.kort' && r.params.tab === 'meddelanden', `skyddat ärende byter till avtalsansvarig på samma flik (${r.role}, ${r.params.tab})`);
ok(!/Du saknar åtkomst|Ingen åtkomst/.test(await text()), 'bytet landar i en roll med åtkomst');
// Chefen: texter i tredje person, mötesförfrågan i läsläge
const elifId = await st(() => MM.store.state.script.elif);
await st((caseId) => MM.dispatch('deviation.callCustomer', { caseId, body: 'Hej Linda! Kan vi ses om Elifs närvaro?', proposedAt: '2027-02-05T10:00' }), elifId);
await visit(page, 'kommun_chef', 'kom.deltagare', { caseId: elifId });
const elifT = await text();
ok(/Mötesförfrågan till handläggaren/i.test(elifT) && /Skickad till Linda Karlsson/.test(elifT), 'chefen ser mötesförfrågan i läsläge');
ok(/Handläggaren \(Linda Karlsson\) fick ärendenummer/.test(elifT) && !/Du fick ärendenummer/.test(elifT), 'chefen får texter i tredje person');
await shot('chef-deltagare-elif');

// ------------------------------------------------------------ 5. Rapporter och meddelanden
console.log('\n5. Rapporter och meddelanden');
await visit(page, 'kommun_handlaggare', 'kom.rapporter');
const repItems = page.locator('.list .list-item');
ok(/Ny/.test(await repItems.first().innerText()), 'olästa rapporter visas först');
ok(/Veckorapport närvaro, vecka 4 är på väg/.test(await text()), 'väntande veckorapport för vecka 4 förklaras');
await page.getByRole('group', { name: 'Visa rapporter' }).getByRole('button', { name: /^Veckorapporter/ }).click();
ok((await repItems.count()) > 0 && /Veckorapport närvaro/.test(await repItems.first().innerText()), 'filter på veckorapporter');
await shot('rapporter');
const hasReportView = await st(() => !!MM.views['rapport.visa']);
const firstRepId = await st(() => MM.sel.komReports('k-maria').filter((r) => r.kind === 'weekly_attendance').sort((a, b) => (a.openedAt ? 1 : 0) - (b.openedAt ? 1 : 0) || (a.deliveredAt < b.deliveredAt ? 1 : -1))[0].id);
await repItems.first().click();
await page.waitForTimeout(150);
r = await route();
if (hasReportView) ok(r.view === 'rapport.visa' && r.params.reportId === firstRepId, 'rapporten öppnas i rapport.visa');
else ok(r.view === 'kom.rapporter', 'rapport.visa finns inte ännu – stannar kvar (ok)');
await visit(page, 'kommun_handlaggare', 'kom.rapporter');
await page.getByRole('tab', { name: /Meddelanden/ }).click();
ok(/BOT-26-0148/.test(await text()) && /BOT-26-0143/.test(await text()), 'meddelanden per ärende');
await page.locator('.list .list-item').first().click();
r = await route();
ok(r.view === 'kom.deltagare' && r.params.tab === 'meddelanden', 'tråden öppnas i deltagarens meddelandeflik');

// ------------------------------------------------------------ 5b. Händelser, uppgifter och rättelser
console.log('\n5b. Händelser i dina ärenden, uppgifter och rättade rapporter');
const ids = await st(() => ({ mall: MM.store.state.script['inkorg-mall'], nadia: MM.store.state.script.nadia, yusuf: MM.store.state.script.yusuf, samira: MM.store.state.cases.find((c) => c.referrerId === 'k-maria' && c.source === 'portal' && c.status === 'acknowledged').id }));
await visit(page, 'samordnare', 'sam.start');
await st((x) => {
  MM.dispatch('case.decline', { caseId: x.mall, reason: 'Vi har ingen ledig plats inom avtalsområdet den önskade veckan.' });
  MM.dispatch('case.accept', { caseId: x.samira, leadCoachId: 'u-amira', firstMeetingAt: '2027-02-08T10:00', plannedWeeks: 8, buyerReference: '4410023817' });
  MM.dispatch('case.changeCoach', { caseId: x.nadia, toCoachId: 'u-sofia', reason: 'Amira är föräldraledig.' });
}, ids);
await visit(page, 'coach', 'coach.minvecka');
await st((x) => MM.dispatch('deviation.save', { caseId: x.yusuf, data: { description: 'Upprepad ogiltig frånvaro', action: 'Möte med deltagaren', needsCustomerDecision: true } }), ids);
await visit(page, 'kommun_handlaggare', 'kom.start');
let startT = await text();
ok(/Händelser i dina ärenden \(3\)/i.test(startT), 'startsidan visar tre händelser');
ok(/BOT-27-0050 kunde inte tas emot/.test(startT), 'avböjd beställning syns på startsidan');
ok(/Ny ansvarig coach för BOT-26-0143/.test(startT), 'byte av coach syns på startsidan');
ok(/Orderbekräftelse för BOT-/.test(startT), 'ny orderbekräftelse syns på startsidan');
ok(/Att göra \(1\)/i.test(startT) && /Miljonbemanning behöver ditt beslut om BOT-26-0148/.test(startT), 'uppgiften customer_decision syns på startsidan');
ok(!/ kl\. |\b(jan|feb|dec)\b/.test(startT), 'startsidan har inga förkortningar i datum');
await shot('start-handelser');
await noHScroll('Startsidan med händelser');
// Avböjd syns i standardfiltret
await visit(page, 'kommun_handlaggare', 'kom.deltagare');
ok(/BOT-27-0050/.test(await text()), 'avböjd beställning syns i standardfiltret Pågår och på väg');
ok((await page.getByRole('group', { name: 'Visa deltagare' }).getByRole('button', { name: /^Avböjda/ }).count()) === 1, 'eget filter för avböjda');
// Öppna den avböjda – händelsen räknas som läst
await visit(page, 'kommun_handlaggare', 'kom.start');
await page.getByRole('button', { name: /BOT-27-0050 kunde inte tas emot/ }).click();
await page.waitForTimeout(150);
ok(/Vi har ingen ledig plats/.test(await text()), 'orsaken visas i ärendet');
await visit(page, 'kommun_handlaggare', 'kom.start');
startT = await text();
ok(!/BOT-27-0050 kunde inte tas emot/.test(startT) && /Händelser i dina ärenden \(2\)/i.test(startT), 'händelsen försvinner när ärendet har öppnats');
// Uppgiften visas i ärendet och kan markeras som klar
await visit(page, 'kommun_handlaggare', 'kom.deltagare', { caseId: ids.yusuf });
ok(/Miljonbemanning behöver ditt beslut/.test(await text()), 'uppgiften syns i ärendets översikt');
await page.getByRole('button', { name: 'Markera som klar' }).first().click();
await page.waitForTimeout(100);
ok(await st(() => MM.store.state.tasks.filter((t) => t.kind === 'customer_decision').every((t) => t.status === 'done' && t.doneBy === 'k-maria')), 'uppgiften är markerad som klar');
ok((await st(() => { const t = MM.store.state.tasks.find((x) => x.kind === 'customer_decision'); return MM.dispatch('kom.taskDone', { taskId: t.id }); })).error !== 'forbidden', 'handläggaren äger uppgiften');
// Rättelse: den levererade rapporten finns kvar tills den nya versionen är levererad
const delivered = await st(() => MM.store.state.reports.find((r) => r.kind === 'monthly' && r.status === 'delivered' && !r.superseded && (r.deliveredTo || []).includes('k-maria')));
await visit(page, 'coach', 'coach.minvecka');
const corr = await st((id) => MM.dispatch('report.correct', { reportId: id }), delivered.id);
await visit(page, 'kommun_handlaggare', 'kom.deltagare', { caseId: delivered.caseId, tab: 'rapporter' });
ok(/Rättas – en ny version kommer/.test(await text()), 'rapporten som rättas finns kvar med märket Rättas');
ok(await st((id) => MM.sel.komReports('k-maria').some((r) => r.id === id), delivered.id), 'rapporten finns kvar i kundens rapportlista');
await st((id) => { MM.dispatch('report.approve', { reportId: id }); MM.dispatch('report.deliver', { reportId: id }); }, corr.reportId);
await visit(page, 'kommun_handlaggare', 'kom.deltagare', { caseId: delivered.caseId, tab: 'rapporter' });
ok(await st((x) => { const ids = MM.sel.komReports('k-maria').map((r) => r.id); return ids.includes(x.n) && !ids.includes(x.o); }, { n: corr.reportId, o: delivered.id }), 'när den nya versionen levererats visas bara den');
ok(/version 2/.test(await text()), 'version 2 visas');

// ------------------------------------------------------------ 6. Kommunens chef
console.log('\n6. Beställarrapport för kommunens chef');
await visit(page, 'kommun_chef', 'kom.chef');
let chefT = await text();
ok(/December 2026/.test(chefT) && /senaste rapporten som har levererats/.test(chefT), 'december visas som standard med förklaring');
ok(/Avtalsmålet är 32\s%/.test(chefT) && /avtalsmål 32\s%/i.test(chefT), 'avtalsmålet visas');
ok(!/35\s%/.test(chefT) && !/internt/i.test(chefT) && /32\s%/.test(chefT), 'internt mål visas aldrig');
ok(await st(() => !!MM.store.state.reports.find((r) => r.kind === 'customer_summary' && r.month === '2026-12').openedAt), 'rapporten är kvitterad');
for (const tabName of ['Deltagare', 'Progression', 'Närvaro och nöjdhet']) {
  await page.getByRole('tab', { name: tabName }).click();
  chefT = await text();
  ok(!/35\s%/.test(chefT) && !/internt/i.test(chefT), `fliken ${tabName}: inget internt mål`);
}
await page.getByRole('tab', { name: 'Deltagare' }).click();
ok(/färre än 5/.test(await text()), 'små grupper redovisas som "färre än 5"');
ok(/Aktiva under månaden/i.test(await text()) && /Andel som svarat 4 eller 5 på en skala 1–5/.test(await text()), 'etiketterna är utskrivna utan förkortningar');
ok(/Under avtalsmålet/i.test(await page.locator('.kom-kpis .kpi').first().innerText()), 'resultatrutan har statustext och inte bara färg');
await shot('chef');
await noHScroll('Beställarrapport');
// Oktober: 4 av 6 avslut – täljaren är färre än 5 och andelen redovisas inte (samma regel som dokumentet)
await page.getByRole('group', { name: 'Välj månad' }).getByRole('button', { name: /Oktober 2026/ }).click();
await page.getByRole('tab', { name: 'Resultat' }).click();
const octT = await text();
ok(/färre än 5 av 6 avslut/.test(octT) && /Redovisas inte/.test(octT) && !/66,7\s%/.test(octT) && !/\b4 av 6\b/.test(octT), 'små resultatgrupper döljs i oktober');
await shot('chef-oktober');
await page.getByRole('group', { name: 'Välj månad' }).getByRole('button', { name: /Januari 2027/ }).click();
ok(/inte klar än/.test(await text()) && /Du ser inga siffror förrän rapporten är godkänd/.test(await text()), 'januari är utkast och visar inga siffror');
ok(!(await page.locator('.kom-kpis').count()), 'inga nyckeltal för utkastet');
// Åtgärdsplan
const pendingId = await st(() => MM.sel.komPendingActionPlans()[0].id);
await page.getByRole('button', { name: 'Godkänn åtgärdsplanen' }).first().click();
await page.getByRole('dialog').getByRole('button', { name: 'Godkänn åtgärdsplanen' }).click();
await page.waitForTimeout(150);
const cd = await st((id) => MM.store.state.contractDeviations.find((x) => x.id === id), pendingId);
ok(!!cd.customerApprovedAt && cd.customerApprovedBy === 'k-eva', 'åtgärdsplanen godkänd med tid och namn');
ok(await st((id) => MM.store.state.auditLog.some((x) => x.action === 'contract_deviation.action_plan_approved' && x.entityId === id), pendingId), 'godkännandet loggas');
ok(!/Väntar på ditt godkännande/.test(await text()), 'inget kvar att godkänna');
ok((await st(() => MM.dispatch('kom.approveActionPlan', { id: 'cd-1' }))).error === 'already_approved', 'redan godkänd plan kan inte godkännas igen');
// Behörighet: handläggaren kan inte godkänna
await visit(page, 'kommun_handlaggare', 'kom.start');
ok((await st(() => MM.dispatch('kom.approveActionPlan', { id: 'cd-3' }))).error === 'forbidden', 'handläggaren kan inte godkänna åtgärdsplaner');
// Perspektivbyte till ledningsvyn
await visit(page, 'kommun_chef', 'kom.chef');
const hasLedning = await st(() => !!MM.views['chef.oversikt']);
await page.getByRole('button', { name: 'Se Miljonbemannings interna ledningsvy' }).click();
await page.waitForTimeout(120);
r = await route();
ok(hasLedning ? (r.view === 'chef.oversikt' && r.role === 'chef') : r.view === 'kom.chef', 'perspektivbyte till ledningsvyn');

// ------------------------------------------------------------ Summering
const own = errors.filter((e) => !/Vyfel (sam|arende|rapport|chef|coach)\./.test(e));
ok(own.length === 0, `inga konsolfel (${errors.length ? errors.join(' | ') : 'inga'})`);
console.log(`\n${passes} ok, ${failures} fel.`);
await close();
process.exit(failures ? 1 : 0);
