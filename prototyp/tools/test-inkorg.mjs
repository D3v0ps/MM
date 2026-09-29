// Interaktionstest för src/views/inkorg.js (sam.start, sam.inkorg, sam.deadlines).
// Kör: node tools/test-inkorg.mjs
import assert from 'node:assert/strict';
import { openProto, visit } from './lib.mjs';

const { page, errors, close } = await openProto();
const S = (fn, arg) => page.evaluate(fn, arg);
const dialog = () => page.getByRole('dialog');
let passed = 0; const failed = [];
const step = async (name, fn) => {
  try { await fn(); passed++; console.log(`OK   ${name}`); }
  catch (e) { failed.push(name); console.log(`FEL  ${name}\n     ${String(e && e.message || e).split('\n').slice(0, 6).join('\n     ')}`); }
};
const noProblems = (p) => assert.deepEqual(p, [], `Vyn rapporterade problem: ${p.join('; ')}`);
const caseOf = (tag) => S((t) => { const c = MM.sel.caseByTag(t); return JSON.parse(JSON.stringify(c)); }, tag);
const email = (id) => S((i) => JSON.parse(JSON.stringify(MM.store.state.inboundEmails.find((e) => e.id === i))), id);

// ------------------------------------------------------------ Förfaller (före inkorgsflödena, så att alla avrop finns kvar)
await step('sam.deadlines: grupper, filter per typ och sammanslagna månadsrapporter', async () => {
  noProblems(await visit(page, 'chef', 'sam.deadlines', {}));
  const main = page.locator('#main');
  for (const t of ['Försenat', 'I dag', 'Denna vecka']) await main.getByRole('heading', { name: new RegExp(`^${t} \\(`) }).waitFor();
  await main.getByText('Ej fastställd med Botkyrka').first().waitFor();
  assert.match(await main.innerText(), /\d+ ärenden/, 'Månadsrapporterna ska slås ihop till en rad');
  await main.getByRole('button', { name: /^Svar på avrop \(3\)/ }).click();
  const txt = await main.innerText();
  assert.ok(!/Månadsrapport januari/.test(txt), 'Filtret ska dölja månadsrapporter');
  assert.equal(await main.locator('tbody tr').filter({ hasText: 'Svar på avrop' }).count(), 3);
  assert.match(txt, /Samordnare(\s|\S)*Chef/, 'Eskaleringsvägen ska visas');
  await main.getByRole('button', { name: /^Alla \(/ }).click();
});

// ------------------------------------------------------------ Startsidan
// ------------------------------------------------------------ Samma tal i menyn, sammanfattningen, fliken och på startsidan (MM.sel.inboxToHandle)
await step('Inkorgens antal: menyn, rutan Att hantera, fliken och startsidan visar samma tal', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', {}));
  const n = await S(() => MM.sel.inboxToHandle().length);
  const r = await S(() => ({ nav: document.querySelector('.nav-item.active .count')?.innerText.trim(), sum: document.querySelector('.ink-sum .ink-sum-n')?.innerText.trim(),
    tab: (document.querySelector('[role=tab][aria-selected=true] .count') || {}).innerText, parts: [...document.querySelectorAll('.ink-sum:not(:first-child):not(.grow) .ink-sum-n')].map((x) => Number(x.innerText)) }));
  assert.deepEqual([r.nav, r.sum, r.tab], [String(n), String(n), String(n)], `Olika tal: ${JSON.stringify(r)}`);
  assert.equal(r.parts.reduce((a, b) => a + b, 0), n, 'Uppdelningen ska summera till Att hantera');
  noProblems(await visit(page, 'samordnare', 'sam.start', {}));
  const tile = await page.locator('#main .ink-tile').first().innerText();
  assert.match(tile, new RegExp(`Att hantera i inkorgen\\s+${n}\\b`, 'i'));
});

await step('sam.start: SLA-märket överlappar inte rubriken (1280 och 1024 px), status med text i rutor', async () => {
  for (const [role, w] of [['samordnare', 1280], ['avtalsansvarig', 1280], ['samordnare', 1024]]) {
    await page.setViewportSize({ width: w, height: 900 });
    noProblems(await visit(page, role, 'sam.start', {}));
    const over = await S(() => [...document.querySelectorAll('.ink-mini-row')].map((r) => { const l = r.querySelector('.ink-l'); const m = r.querySelector('.ink-m'); if (!l || !m) return null;
      const a = (l.firstElementChild || l).getBoundingClientRect(); const b = m.getBoundingClientRect(); // riktig överlappning av rektanglarna (märket kan ligga ovanför texten i smal layout)
      return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1 ? `${l.innerText.trim()} / ${m.innerText.split('\n')[0]}` : null; }).filter(Boolean));
    assert.deepEqual(over, [], `${role} ${w}: överlapp`);
    const noState = await S(() => [...document.querySelectorAll('#main .kpi.alert, #main .kpi.watch')].filter((k) => !k.querySelector('.kpi-state')).map((k) => k.innerText.split('\n')[0]));
    assert.deepEqual(noState, [], 'Rutor med röd/mörk ram ska ha statustext med ikon');
    const btn = await S(() => { const b = [...document.querySelectorAll('#main button')].find((x) => /notiser/.test(x.innerText) && x.closest('.card')); const c = b.closest('.card'); return Math.round(b.getBoundingClientRect().right) <= Math.round(c.getBoundingClientRect().right); });
    assert.ok(btn, 'Knappen till coachens notiser ska ligga inom kortet');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.ok(!/deadline/i.test(await page.locator('#main').innerText()), 'Inga engelska ord (deadline)');
});

await step('sam.start (avtalsansvarig): uppgiften om det skyddade avropet ligger hos avtalsansvarig', async () => {
  noProblems(await visit(page, 'avtalsansvarig', 'sam.start', {}));
  const main = page.locator('#main');
  await main.getByText('Öppna uppgifter (1)').waitFor();
  await main.getByText('Avrop med skyddade personuppgifter från Omar Farah', { exact: false }).first().waitFor();
  await main.getByText('Skapad automatiskt', { exact: false }).first().waitFor();
});

await step('sam.start: översikt, kvittera flagga med åtgärdsplan', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.start', {}));
  const main = page.locator('#main');
  for (const t of ['Att hantera i inkorgen', 'Första möten ej bokade', 'Förfaller i dag', 'Flaggor att kvittera', 'Avrop besvarade inom en arbetsdag', 'Första möte inom en vecka', 'Tilldelning ger notis', 'Öppna uppgifter (0)', 'hanteras av avtalsansvarig']) await main.getByText(t, { exact: false }).first().waitFor();
  const before = await S(() => Object.keys(MM.store.state.alertAcks).length);
  await main.getByRole('button', { name: 'Kvittera', exact: true }).first().click();
  await dialog().getByRole('button', { name: 'Kvittera', exact: true }).click();
  await dialog().getByText('Skriv en kort åtgärdsplan').waitFor();
  await page.fill('#ink-ack-plan', 'Sara ringer handläggaren i dag före kl. 12 enligt den säkra rutinen.');
  await dialog().getByRole('button', { name: 'Kvittera', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  const acks = await S(() => MM.store.state.alertAcks);
  assert.equal(Object.keys(acks).length, before + 1);
  assert.match(Object.values(acks)[0].plan, /Sara ringer/);
  await main.getByRole('button', { name: /Visa kvitterade/ }).click();
  await main.getByText(/Kvitterad av Sara Lindqvist/).waitFor();
});

await step('sam.start: boka första möte för ärende utan bokat möte', async () => {
  const main = page.locator('#main');
  await main.getByRole('button', { name: 'Boka', exact: true }).first().click();
  await dialog().getByRole('button', { name: 'Boka mötet' }).click();
  await dialog().waitFor({ state: 'detached' });
  const c = await caseOf('ingetmote');
  assert.ok(c.firstMeetingAt, 'Första mötet ska vara bokat');
});

// ------------------------------------------------------------ Inkorgen: Word-mall (em-101) → acceptera
await step('sam.inkorg em-101: acceptera med coach och team → orderbekräftelse och notis till coachen', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-101' }));
  const main = page.locator('#main');
  await main.getByText('Originalmejlet').waitFor(); await main.getByText('Tolkat formulär').waitFor();
  await main.getByText('Ordererkännande', { exact: true }).first().waitFor(); await main.getByText('Dubblettkontroll').waitFor();
  await main.getByRole('button', { name: 'Se vad kommunen fick' }).first().waitFor();
  await main.getByRole('button', { name: 'Acceptera', exact: true }).click();
  await dialog().getByRole('button', { name: 'Acceptera avropet' }).click();
  await dialog().getByText('Välj huvudcoach.').waitFor();
  await page.check('#ink-coach-u-amira'); await page.check('#ink-team-u-petra');
  await dialog().getByRole('button', { name: 'Acceptera avropet' }).click();
  await dialog().getByText('Amira Haddad har fått en notis om tilldelningen').waitFor();
  await dialog().getByText('Deltagaren fick kallelse via e-post, sin föredragna kontaktväg', { exact: false }).waitFor();
  assert.equal(await S((id) => MM.store.state.notifications.filter((x) => x.caseId === id && x.template === 'kallelse').slice(-1)[0].channel, await S(() => MM.sel.caseByTag('inkorg-mall').id)), 'email');
  const c = await caseOf('inkorg-mall');
  assert.equal(c.status, 'confirmed'); assert.equal(c.leadCoachId, 'u-amira');
  assert.ok(c.team.some((t) => t.userId === 'u-petra'), 'Petra ska vara med i teamet');
  assert.equal((await email('em-101')).status, 'accepted');
  const n = await S((id) => ({ un: MM.store.state.userNotifications.filter((x) => x.caseId === id && x.kind === 'assignment').map((x) => x.recipientId),
    mail: MM.store.state.notifications.filter((x) => x.caseId === id && x.template === 'orderbekraftelse').map((x) => x.body) }), c.id);
  assert.ok(n.un.includes('u-amira') && n.un.includes('u-petra'), 'Coach och team ska få notis');
  const p = await S((id) => { const c2 = MM.sel.caseById(id); const pp = MM.sel.person(c2); return [pp.firstName, pp.lastName, pp.pnr]; }, c.id);
  assert.ok(n.mail.length === 1 && !p.some((x) => n.mail[0].includes(x)), 'Orderbekräftelsen till kommunen ska finnas och sakna personuppgifter');
  await dialog().getByRole('button', { name: 'Klart' }).click();
  await main.getByText('Orderbekräftelse skickad').waitFor();
});

// ------------------------------------------------------------ Fritext (em-102): stoppas utan beställarreferens, rätta uppgifter
await step('sam.inkorg em-102: acceptera stoppas – felet syns direkt (överst, toast, fokus i fältet)', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-102' }));
  const main = page.locator('#main');
  await main.getByText('Tolkat med AI').waitFor(); await main.getByText(/Osäker \d+/).first().waitFor();
  assert.ok(await main.getByRole('button', { name: /Se vad kommunen fick \(kommunens chef\)/ }).count() > 0, 'Perspektivbyte till kommunens chef när handläggaren inte är Maria');
  await main.getByRole('button', { name: 'Acceptera', exact: true }).click();
  await dialog().getByText('Beställarreferens saknas – avropet kan inte bekräftas').first().waitFor(); // överst redan när dialogen öppnas
  await page.check('#ink-coach-u-erik');
  await dialog().getByRole('button', { name: 'Acceptera avropet' }).click();
  await page.locator('.toast').filter({ hasText: 'Beställarreferens saknas' }).first().waitFor();
  await dialog().locator('.field.invalid').filter({ hasText: 'Beställarreferens' }).getByText(/Beställarreferens saknas\. Kommunen har inte angett någon/).waitFor();
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'ink-ref');
  const inView = await S(() => { const el = document.getElementById('ink-ref'); const b = el.getBoundingClientRect(); const m = el.closest('.modal-body').getBoundingClientRect(); return b.top >= m.top && b.bottom <= m.bottom; });
  assert.ok(inView, 'Fältet för beställarreferens ska synas i dialogen');
  assert.equal((await caseOf('inkorg-fritext')).status, 'acknowledged');
  await dialog().getByText('Det finns en komplettering att föra in först').waitFor();
  await dialog().getByRole('button', { name: 'Avbryt' }).click();
});

await step('sam.inkorg em-102: rätta planerad omfattning – loggas som rättad, övrigt som kontrollerat', async () => {
  const main = page.locator('#main');
  await main.getByRole('button', { name: 'Rätta uppgifter' }).click();
  await page.fill('#ink-c-weeks', '8');
  await dialog().getByRole('button', { name: /Spara och markera/ }).click();
  await dialog().waitFor({ state: 'detached' });
  const c = await caseOf('inkorg-fritext'); const e = await email('em-102');
  assert.equal(c.plannedWeeks, 8); assert.equal(c.orderValueWeeks, 8);
  assert.equal(e.corrections.plannedWeeks.changed, true); assert.equal(e.corrections.primaryArea.changed, false);
  await main.getByText('Rättad', { exact: true }).first().waitFor(); await main.getByText('Kontrollerad', { exact: true }).first().waitFor();
});

await step('sam.inkorg em-103: för in kompletteringen och acceptera', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-103' }));
  const main = page.locator('#main');
  await main.getByText(/Kopplad automatiskt till BOT-27-0049/).waitFor();
  await main.getByRole('button', { name: 'För in uppgifterna' }).click();
  assert.equal((await email('em-103')).status, 'applied');
  assert.equal((await caseOf('inkorg-fritext')).buyerReference, '55102938');
  await main.getByRole('button', { name: 'Acceptera avropet' }).click();
  await page.check('#ink-coach-u-leila');
  await dialog().getByRole('button', { name: 'Acceptera avropet' }).click();
  await dialog().getByText('Leila Nouri har fått en notis om tilldelningen').waitFor();
  await dialog().getByRole('button', { name: 'Klart' }).click();
  assert.equal((await caseOf('inkorg-fritext')).status, 'confirmed');
  assert.equal((await email('em-102')).status, 'accepted');
});

// ------------------------------------------------------------ Skyddade personuppgifter (em-104)
await step('sam.inkorg em-104 som samordnare: ingen registrering – förklaring och perspektivbyte till avtalsansvarig', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-104' }));
  const main = page.locator('#main');
  await main.getByText('Avtalsansvarig hanterar skyddade avrop enligt den säkra rutinen').first().waitFor();
  assert.equal(await main.getByRole('button', { name: 'Registrera efter telefonsamtal' }).count(), 0, 'Samordnaren ska inte kunna registrera');
  assert.equal(await main.getByRole('button', { name: 'Acceptera', exact: true }).count(), 0);
  await main.getByRole('button', { name: 'Se avtalsansvarigs vy' }).click();
  await page.waitForFunction(() => MM.role() === 'avtalsansvarig');
  await main.getByRole('button', { name: 'Registrera efter telefonsamtal' }).waitFor();
});

await step('sam.inkorg em-104: registrera efter telefonsamtal (case.create skyddad, telefon, k-omar)', async () => {
  noProblems(await visit(page, 'avtalsansvarig', 'sam.inkorg', { emailId: 'em-104' }));
  const main = page.locator('#main');
  await main.getByText('Skyddade personuppgifter – ingen automatik').waitFor();
  await main.getByText('Generisk mottagningsbekräftelse', { exact: true }).waitFor();
  const nCases = await S(() => MM.store.state.cases.length);
  await main.getByRole('button', { name: 'Registrera efter telefonsamtal' }).click();
  await dialog().getByRole('button', { name: 'Registrera ärendet' }).click();
  await dialog().getByText('Skriv förnamnet.').waitFor();
  assert.equal(await S(() => MM.store.state.cases.length), nCases, 'Inget ärende får skapas med ofullständiga uppgifter');
  await page.fill('#ink-p-first', 'Samir'); await page.fill('#ink-p-last', 'Lindqvist-Test'); await page.fill('#ink-p-pnr', '19880412-1234');
  await page.selectOption('#ink-p-area', 'G'); await page.fill('#ink-p-weeks', '8'); await page.check('#ink-p-confirm');
  await dialog().getByRole('button', { name: 'Registrera ärendet' }).click();
  await dialog().waitFor({ state: 'detached' });
  const r = await S(() => { const st = MM.store.state; const e = st.inboundEmails.find((x) => x.id === 'em-104'); const c = st.cases.find((x) => x.id === e.caseId); const p = st.persons.find((x) => x.id === c.personId);
    return { status: e.status, source: c.source, referrerId: c.referrerId, prot: p.protectedIdentity, phone: p.phone, address: p.address, referredAt: c.referredAt, received: e.receivedAt, task: st.tasks.find((t) => t.id === 'task-2').status,
      openProt: st.tasks.filter((t) => t.status === 'open' && t.kind === 'protected_order' && (t.caseIds || []).includes(c.id)).length,
      alert: MM.sel.alerts({ role: 'avtalsansvarig' }).some((a) => a.key === 'protected:em-104') }; });
  assert.deepEqual([r.status, r.source, r.referrerId, r.prot, r.phone, r.address], ['received', 'phone', 'k-omar', true, '', null]);
  assert.equal(r.referredAt, r.received, 'SLA ska räknas från mejlets mottagning');
  assert.equal(r.task, 'done', 'Uppgiften till avtalsansvarig ska stängas'); assert.equal(r.alert, false, 'Flaggan ska stängas');
  assert.equal(r.openProt, 0, 'Uppgiften som case.create skapade ska stängas – samtalet är redan taget');
});

await step('sam.inkorg em-104: acceptera skyddat ärende – ingen kallelse till deltagaren', async () => {
  const main = page.locator('#main');
  await main.getByRole('button', { name: 'Acceptera', exact: true }).click();
  await dialog().getByText('Deltagaren får ingen kallelse via SMS eller e-post', { exact: false }).waitFor();
  await page.check('#ink-coach-u-sofia');
  await dialog().getByRole('button', { name: 'Acceptera avropet' }).click();
  await dialog().getByText('Sofia Grahn har fått en notis om tilldelningen').waitFor();
  await dialog().getByRole('button', { name: 'Klart' }).click();
  const r = await S(() => { const st = MM.store.state; const e = st.inboundEmails.find((x) => x.id === 'em-104'); const c = st.cases.find((x) => x.id === e.caseId);
    return { status: c.status, kallelse: st.notifications.filter((n) => n.caseId === c.id && n.template === 'kallelse').length, suppressed: st.auditLog.some((a) => a.action === 'notify.suppressed' && a.entityId === c.id), email: e.status }; });
  assert.deepEqual(r, { status: 'confirmed', kallelse: 0, suppressed: true, email: 'accepted' });
});

await step('sam.inkorg em-104 som samordnare: namnet visas inte', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-104' }));
  const txt = await page.locator('#main').innerText();
  assert.ok(txt.includes('Skyddade personuppgifter'));
  assert.ok(!txt.includes('Lindqvist-Test') && !txt.includes('Samir'), 'Samordnaren får inte se namnet');
  assert.equal(await page.locator('#main').getByRole('button', { name: 'Registrera efter telefonsamtal' }).count(), 0);
});

// ------------------------------------------------------------ Övrigt (em-105)
await step('sam.inkorg em-105: svara med säkert meddelande och markera som hanterad', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-105' }));
  const main = page.locator('#main');
  await main.getByText('Klassat som Övrigt – inte en beställning').waitFor();
  const before = await S(() => MM.store.state.messages.length);
  await main.getByRole('button', { name: 'Svara med säkert meddelande' }).click();
  await main.getByText(/Svar skickat .* som säkert meddelande/).waitFor();
  const r = await S(() => { const st = MM.store.state; const m = st.messages[st.messages.length - 1]; const n = st.notifications.filter((x) => x.template === 'nytt_meddelande').slice(-1)[0];
    return { n: st.messages.length, caseId: m.caseId, sender: m.senderId, mail: n.body, nadia: MM.sel.caseByTag('nadia').id }; });
  assert.equal(r.n, before + 1); assert.equal(r.caseId, r.nadia); assert.equal(r.sender, 'u-sara');
  assert.ok(/logga in för att läsa/.test(r.mail) && !/Nadia|Warsame/.test(r.mail), 'Notisen ska sakna innehåll och personuppgifter');
  await main.getByRole('button', { name: 'Markera som hanterad' }).click();
  assert.equal((await email('em-105')).status, 'handled');
});

// ------------------------------------------------------------ Avböj (em-106)
await step('sam.inkorg em-106: avböj kräver orsak', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-106' }));
  const main = page.locator('#main');
  await main.getByRole('button', { name: 'Avböj', exact: true }).click();
  await dialog().getByText(/rangordning/).waitFor();
  await dialog().getByRole('button', { name: 'Avböj avropet' }).click();
  await dialog().getByText('Välj en orsak.').waitFor();
  await page.selectOption('#ink-decline-reason', 'Annat skäl');
  await dialog().getByRole('button', { name: 'Avböj avropet' }).click();
  await dialog().getByText('Beskriv orsaken.').waitFor();
  await page.fill('#ink-decline-text', 'Deltagaren behöver en insats på annat språk än vi kan erbjuda.');
  await dialog().getByRole('button', { name: 'Avböj avropet' }).click();
  await dialog().waitFor({ state: 'detached' });
  const c = await caseOf('inkorg-brattom');
  assert.equal(c.status, 'declined'); assert.match(c.declineReason, /^Annat skäl: Deltagaren behöver/);
  assert.equal((await email('em-106')).status, 'declined');
  await main.getByText('Avropet är avböjt').waitFor();
});

await step('sam.inkorg: flikar och caseId-parameter', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', {}));
  const main = page.locator('#main');
  await main.getByText('Inget att hantera').waitFor();
  await main.getByRole('tab', { name: /Hanterade/ }).click();
  await main.locator('.ink-row').first().waitFor();
  assert.ok(await main.locator('.ink-row').count() >= 6);
  const id = await S(() => MM.sel.caseByTag('inkorg-fritext').id);
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { caseId: id }));
  await main.getByRole('heading', { name: 'Ny deltagare till er – kök' }).waitFor();
});

await step('Portalbeställning från kommunen syns i inkorgen och kan accepteras', async () => {
  const res = await S(() => { MM.nav('om.start', {}, { role: 'kommun_handlaggare' });
    return MM.dispatch('case.create', { source: 'portal', referrerId: 'k-maria', firstName: 'Lina', lastName: 'Portaltest', pnr: '19950505-1111', buyerReference: '4410023817', primaryArea: 'F', plannedWeeks: 6, desiredStart: '2027-02-10', vocationalTrack: 'Lokalvårdare med certifiering' }); });
  assert.ok(res && res.caseId, 'Portalbeställningen ska skapas');
  noProblems(await visit(page, 'samordnare', 'sam.inkorg', { latest: true }));
  const main = page.locator('#main');
  await main.getByRole('heading', { name: 'Beställning i portalen' }).waitFor(); // params.latest väljer den senast mottagna (scenario 3 steg 4)
  await main.locator('.ink-detail').getByText(res.number).first().waitFor();
  await main.getByText('Ordererkännandet visades direkt', { exact: false }).or(main.getByText('Ordererkännande', { exact: true })).first().waitFor();
  await main.getByRole('button', { name: 'Acceptera', exact: true }).click();
  await page.check('#ink-coach-u-mats');
  await dialog().getByRole('button', { name: 'Acceptera avropet' }).click();
  await dialog().getByText('Mats Holm har fått en notis om tilldelningen').waitFor();
  await dialog().getByRole('button', { name: 'Klart' }).click();
  assert.equal(await S((id) => MM.sel.caseById(id).status, res.caseId), 'confirmed');
});

await step('sam.start efter flödena: inkorgen tom, uppgiften klar', async () => {
  noProblems(await visit(page, 'samordnare', 'sam.start', {}));
  const main = page.locator('#main');
  await main.getByText('Inkorgen är tom').waitFor();
  await main.getByText('Inga öppna uppgifter').waitFor();
});

await step('Åtgärderna spelas upp igen efter omladdning (deterministiska)', async () => {
  const snap = () => S(() => { const st = MM.store.state; return JSON.stringify({ cases: st.cases.filter((c) => c.tags.some((t) => t.startsWith('inkorg')) || c.createdInDemo).map((c) => [c.id, c.status, c.leadCoachId, c.buyerReference, c.plannedWeeks]),
    emails: st.inboundEmails.slice(0, 6).map((e) => [e.id, e.status, e.caseId]), acks: Object.keys(st.alertAcks), clock: MM.clock() }); });
  const before = await snap();
  await page.waitForTimeout(300); await page.reload();
  await page.waitForFunction(() => window.MM && MM.store && MM.store.state && document.querySelector('.protobar'));
  assert.equal(await snap(), before);
});

await step('Inga konsol- eller sidfel', async () => { assert.deepEqual(errors, []); });

console.log(`\n${passed} av ${passed + failed.length} steg gick igenom.${failed.length ? ` Fel: ${failed.join(' | ')}` : ''}`);
await close();
process.exit(failed.length ? 1 : 0);
