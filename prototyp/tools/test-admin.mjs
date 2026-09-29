// Interaktionstest för src/views/admin.js – kör: node tools/test-admin.mjs
// Klickar igenom vyernas viktigaste flöden och kontrollerar tillståndet i MM.store.state.
import { openProto, visit } from './lib.mjs';

const { page, errors, close } = await openProto();
let passed = 0; const failures = [];
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ok  ${msg}`); } else { failures.push(msg); console.log(`  FEL ${msg}`); } };
const S = (fn) => page.evaluate(fn);
const btn = (name) => page.getByRole('button', { name }).first();
const main = () => page.locator('#main');
// textContent (inte innerText) så att CSS-versaler i rubriker inte påverkar jämförelserna.
const text = () => main().evaluate((el) => el.textContent.replace(/\u00a0/g, ' '));
const step = (t) => console.log(`\n# ${t}`);

try {
  // ------------------------------------------------------------------ admin.avtal
  step('admin.avtal – konfiguration, varningar, KK och jämförelse');
  let v = await visit(page, 'admin', 'admin.avtal', {});
  ok(v.length === 0, 'vyn renderar utan problem');
  let t = await text();
  const unsetCount = await S(() => { const walk = (o) => (MM.isUnset(o) ? 1 : Array.isArray(o) ? o.reduce((s, x) => s + walk(x), 0) : o && typeof o === 'object' ? Object.values(o).reduce((s, x) => s + walk(x), 0) : 0); return walk(MM.cfg('c-bot')); });
  ok(t.includes(`${unsetCount} värden är inte fastställda`), `varningslistan räknar ${unsetCount} ej fastställda värden`);
  ok((t.match(/Ej fastställt – regeln aktiveras inte/g) || []).length >= unsetCount, 'varje ej fastställt värde är markerat i korten');
  ok(!/\b35 %/.test(t) || t.includes('Internt mål'), 'internt mål visas bara som internt mål');
  await page.locator('summary', { hasText: 'Visa JSON (contracts.config)' }).click();
  ok((await text()).includes('"casePrefix": "BOT"'), '"Visa JSON" fäller ut konfigurationen');
  await btn('Öppna frågor till Botkyrka').click(); await page.waitForTimeout(100);
  ok(await S(() => MM.route.view === 'om.fragor'), 'länken går till om.fragor');
  await visit(page, 'admin', 'admin.avtal', { contract: 'c-kk' });
  t = await text();
  ok(t.includes('Mötesminimum') && t.includes('Placeringsgrad') && t.includes('60 %'), 'KK-skissen visar mötesminimum och KPI 60 %');
  await page.getByRole('button', { name: /Botkyrka kommun/ }).first().click(); await page.waitForTimeout(80);
  ok((await text()).includes('värden är inte fastställda'), 'avtalsväljaren byter till Botkyrka');
  await page.getByRole('tab', { name: /Prislista/ }).click(); await page.waitForTimeout(80);
  ok((await text()).includes('Exempelpriser – de riktiga priserna står i avtalet'), 'prislistan är märkt som exempelpriser');
  await page.getByRole('tab', { name: /Jämför avtalen/ }).click(); await page.waitForTimeout(80);
  t = await text();
  ok(t.includes('Inom 5 dagar') || t.includes('Första kontakt inom 5 dagar'), 'jämförelsen visar KK:s SLA 5 dagar');
  ok(t.includes('Startpaket') && t.includes('80 %') && t.includes('70 %'), 'jämförelsen visar paketpriser och KPI 80/70 %');

  step('admin.avtal {tab:interna} – admin.setOrgRule');
  await visit(page, 'admin', 'admin.avtal', { tab: 'interna' });
  ok((await text()).includes('Interna regler för Miljonbemanning – inte avtalskrav'), 's13 öppnar fliken Interna regler');
  const before = await S(() => ({ esc: MM.sel.progressionWatch().filter((w) => w.level === 'escalated').length, log: MM.store.state.auditLog.length }));
  await page.locator('#rule-remind').selectOption('2');
  await page.waitForTimeout(60);
  ok((await text()).includes('Eskaleringen måste komma efter påminnelsen'), 'ogiltig kombination (påminnelse 2, eskalering 2) ger felmeddelande');
  ok(await btn('Spara reglerna').isDisabled(), 'Spara är avstängd vid fel');
  await page.locator('#rule-esc').selectOption('3');
  await page.locator('#rule-to-avtalsansvarig').check();
  ok(await page.locator('#rule-to-coach').isDisabled(), 'coachen kan inte väljas som mottagare');
  await btn('Spara reglerna').click(); await page.waitForTimeout(120);
  let pw = await S(() => MM.store.state.orgConfig.notifications.progressionWatch);
  ok(pw.remindCoachAfterWeeks === 2 && pw.escalateAfterConsecutiveWeeks === 3, 'reglerna sparades (2 och 3 veckor)');
  ok(pw.escalateTo.includes('chef') && pw.escalateTo.includes('avtalsansvarig'), 'mottagarna sparades');
  ok(pw.escalationVisibleToCoach === false, 'eskalering syns aldrig för coachen');
  const after = await S(() => ({ esc: MM.sel.progressionWatch().filter((w) => w.level === 'escalated').length, rows: MM.store.state.auditLog.filter((a) => a.action === 'org_rule.updated').length, johan: MM.sel.notificationsFor('u-johan', 'avtalsansvarig').filter((n) => n.kind === 'progress_escalation').length, amira: MM.sel.notificationsFor('u-amira', 'coach').filter((n) => n.kind === 'progress_escalation').length }));
  ok(after.esc <= before.esc, `färre eskaleringar med strängare regel (${before.esc} → ${after.esc})`);
  ok(after.rows === 1, 'ändringen loggas i revisionsloggen');
  ok(after.johan === after.esc, 'avtalsansvarig får eskaleringarna direkt');
  ok(after.amira === 0, 'coachen får inga eskaleringar');
  ok((await text()).includes('Påminnelse efter 1 vecka → 2 veckor'), 'ändringshistoriken visar ändringen');
  // återställ till ursprungliga regler
  await page.locator('#rule-remind').selectOption('1'); await page.locator('#rule-esc').selectOption('2'); await page.locator('#rule-to-avtalsansvarig').uncheck();
  await btn('Spara reglerna').click(); await page.waitForTimeout(100);
  pw = await S(() => MM.store.state.orgConfig.notifications.progressionWatch);
  ok(pw.remindCoachAfterWeeks === 1 && pw.escalateAfterConsecutiveWeeks === 2 && pw.escalateTo.join() === 'chef', 'reglerna kan återställas');

  // ------------------------------------------------------------------ admin.anvandare
  step('admin.anvandare – bjud in kommunanvändare');
  await visit(page, 'avtalsansvarig', 'admin.anvandare', {});
  ok((await text()).includes('Kommunens användare'), 'avtalsansvarig landar på kommunfliken');
  const nUsers = await S(() => MM.store.state.customerUsers.length);
  await btn('Bjud in kommunanvändare').click(); await page.waitForTimeout(80);
  await page.locator('#inv-name').fill('Kim Andersson');
  await page.locator('#inv-email').fill('kim.andersson@gmail.com');
  await page.locator('#inv-unit').selectOption('Arbetsmarknadsenheten Tumba');
  await btn('Skicka inbjudan').click(); await page.waitForTimeout(80);
  ok((await page.locator('.modal').innerText()).includes('Adressen måste sluta på @botkyrka.se'), 'fel domän stoppas med förklaring');
  ok(await S(() => MM.store.state.customerUsers.length) === nUsers, 'ingen användare skapas med fel domän');
  await page.locator('#inv-email').fill('kim.andersson@botkyrka.se');
  await page.locator('#inv-role').selectOption('chef');
  await btn('Skicka inbjudan').click(); await page.waitForTimeout(120);
  const inv = await S(() => { const st = MM.store.state; const u = st.customerUsers[st.customerUsers.length - 1]; return { n: st.customerUsers.length, u, mail: st.notifications.find((x) => x.template === 'inbjudan_kommun'), log: st.auditLog.find((a) => a.action === 'customer_user.invited') }; });
  ok(inv.n === nUsers + 1 && inv.u.email === 'kim.andersson@botkyrka.se' && inv.u.role === 'chef' && inv.u.unit === 'Arbetsmarknadsenheten Tumba', 'kommunanvändaren skapas med roll och enhet');
  ok(inv.u.buyerReferenceId === 'br-tumba', 'enhetens beställarreferens kopplas');
  ok(inv.mail && !inv.mail.body.includes('Kim'), 'inbjudan skickas utan personuppgifter i texten');
  ok(!!inv.log, 'inbjudan loggas');
  ok((await text()).includes('Kim Andersson') && (await text()).includes('Inbjuden'), 'tabellen visar den inbjudna');
  await page.getByRole('row', { name: /Kim Andersson/ }).getByRole('button', { name: 'Spärra' }).click(); await page.waitForTimeout(80);
  ok(await S(() => MM.store.state.customerUsers.find((u) => u.email === 'kim.andersson@botkyrka.se').active === false), 'användaren kan spärras');
  await page.getByRole('tab', { name: /Behörigheter/ }).click(); await page.waitForTimeout(80);
  t = await text();
  ok(t.includes('Påminnelser om utebliven progression: coach') && t.includes('Eskaleringar: chef/controller – syns inte för coachen'), 'behörighetsmatrisen har raderna för notiser');
  await visit(page, 'admin', 'admin.anvandare', {});
  ok((await text()).includes('Personal på Miljonbemanning'), 'admin ser MB-användarna');

  // ------------------------------------------------------------------ admin.integrationer
  step('admin.integrationer – underbiträden och bakgrundsjobb');
  await visit(page, 'admin', 'admin.integrationer', {});
  t = await text();
  ok(t.includes('eu-north-1') && t.includes('arn1') && t.includes('Berget AI') && t.includes('Fortnox'), 'underbiträden, regioner och integrationer visas');
  ok(t.includes('Regeln är inte fastställd (fråga 11)'), 'gallringsjobbet är inte aktiverat (ATT_FASTSTÄLLA)');
  await page.getByRole('row', { name: /Läs avrop@-inkorgen/ }).getByRole('button', { name: /Kör nu/ }).click(); await page.waitForTimeout(80);
  ok(await S(() => !!(MM.store.state.adminJobRuns && MM.store.state.adminJobRuns.inbox) && MM.store.state.auditLog.some((a) => a.action === 'job.run_manual')), '"Kör nu" registreras och loggas');

  // ------------------------------------------------------------------ admin.mallar
  step('admin.mallar – personuppgiftskontroll och versioner');
  await visit(page, 'samordnare', 'admin.mallar', {});
  await page.getByRole('button', { name: /Pulslänk/ }).click(); await page.waitForTimeout(80);
  await page.locator('#tpl-body').fill('Hej {namn}! Svara på fem korta frågor: {lank}');
  await page.waitForTimeout(60);
  ok((await text()).includes('Innehåller personuppgifter – kan inte sparas'), 'platshållare för namn flaggas');
  ok(await page.getByRole('button', { name: /Spara som version/ }).isDisabled(), 'mallen kan inte sparas med personuppgifter');
  const direct = await S(() => MM.dispatch('admin.saveTemplate', { key: 'pulslank', body: 'Hej {personnummer}' }));
  ok(direct && direct.error === 'personal_data', 'åtgärden stoppar också personuppgifter');
  await page.locator('#tpl-body').fill('Hej! Hur går det hos oss? Svara på fem korta frågor: {lank} Länken gäller i 7 dagar. Det är frivilligt och påverkar inte din insats.');
  await page.getByRole('button', { name: /Spara som version 3/ }).click(); await page.waitForTimeout(100);
  const tpl = await S(() => (MM.store.state.adminTemplates || {}).pulslank);
  ok(tpl && tpl.length === 1 && tpl[0].version === 3, 'ny version (3) sparas');
  ok((await text()).includes('Version 3'), 'vyn visar den nya versionen');
  await page.getByRole('tab', { name: /Utskickslogg/ }).click(); await page.waitForTimeout(80);
  t = await text();
  ok(t.includes('Kontroll: inga utskick innehåller namn eller personnummer'), 'utskicksloggen kontrolleras mot personuppgifter');
  ok(t.includes('Orsakat av dig i prototypen'), 'utskick som testaren orsakat är märkta');
  await visit(page, 'admin', 'admin.mallar', { tab: 'logg' });
  ok((await text()).includes('Utskickslogg ('), 'params tab=logg öppnar loggen');

  // ------------------------------------------------------------------ puls.svar
  step('puls.svar – deltagaren svarar via engångslänk');
  await visit(page, 'deltagare', 'puls.svar', {});
  await btn('العربية').click(); await page.waitForTimeout(60);
  ok(await page.locator('.pulse-phone').getAttribute('dir') === 'rtl', 'arabiska visas höger till vänster');
  ok((await text()).includes('Översättning – granskas av människa'), 'översättningen är märkt');
  await btn('Soomaali').click(); await page.waitForTimeout(60);
  ok((await page.locator('.pulse-phone').getAttribute('lang')) === 'so', 'somaliska kan väljas');
  await btn('Svenska').click(); await page.waitForTimeout(60);
  t = await text();
  ok(t.includes('Din coach ser inte vad du svarar') && t.includes('frivilligt'), 'introt förklarar frivillighet och att coachen inte ser svaren');
  await btn('Börja').click();
  ok(await btn('Nästa').isDisabled(), 'Nästa kräver ett svar');
  await page.getByRole('button', { name: '4 – Bra' }).click(); await btn('Nästa').click();
  await page.getByRole('button', { name: '3 – Okej' }).click(); await btn('Nästa').click();
  await page.getByRole('button', { name: '2 – Dåligt' }).click(); await btn('Nästa').click();
  await btn('Praktik').click(); await btn('Nästa').click();
  await page.locator('.pulse-phone').getByRole('button', { name: 'Ja', exact: true }).click();
  await page.locator('#pulse-text').fill('Jag vill prata om min praktik.');
  const nResp = await S(() => MM.store.state.pulseResponses.length);
  await btn('Skicka svar').click(); await page.waitForTimeout(120);
  const pr = await S(() => { const st = MM.store.state; const r = st.pulseResponses[st.pulseResponses.length - 1]; return { n: st.pulseResponses.length, r, inv: st.pulseInvites.find((x) => x.id === 'pi-demo'), task: st.tasks.find((x) => x.kind === 'pulse_contact'), alertsSam: MM.sel.alerts({ role: 'samordnare', personaId: 'u-sara' }).filter((a) => a.kind === 'pulse_contact' && a.key.includes(r.id)).length, alertsCoach: MM.sel.alerts({ role: 'coach', personaId: r.coachId }).filter((a) => a.key.includes(r.id)).length, alertsChef: MM.sel.alerts({ role: 'chef', personaId: 'u-karin' }).filter((a) => a.kind === 'pulse_low' && a.key.includes(r.id)).length }; });
  ok(pr.n === nResp + 1 && pr.r.answers.q1 === 4 && pr.r.answers.q4 === 'praktik' && pr.r.answers.q5 === 'ja' && !!pr.r.coachId, 'svaret sparas med coachId');
  ok(!!pr.inv.usedAt, 'länken markeras som använd');
  ok(pr.task && pr.task.toRole === 'samordnare', '"Ja" på fråga 5 blir en uppgift till samordnaren');
  ok(pr.alertsSam === 1 && pr.alertsCoach === 0, 'samordnaren (inte coachen) får flaggan');
  ok(pr.alertsChef === 1, 'lågt betyg på fråga 3 går till chefen');
  ok((await text()).includes('Tack för dina svar!'), 'tackskärmen visas');
  await visit(page, 'chef', 'admin.logg', {});
  await visit(page, 'deltagare', 'puls.svar', {});
  ok((await text()).includes('Länken är redan använd'), 'länken kan bara användas en gång');
  const again = await S(() => MM.dispatch('pulse.submit', { inviteId: 'pi-demo', answers: { q1: 5, q2: 5, q3: 5, q4: 'jobb', q5: 'nej' } }));
  ok(again && again.error === 'used', 'åtgärden stoppar ett andra svar');
  await page.getByRole('button', { name: 'Har gått ut' }).click(); await page.waitForTimeout(60);
  ok((await text()).includes('Länken har gått ut'), 'förhandsvisning av utgången länk');

  // ------------------------------------------------------------------ admin.logg
  step('admin.logg – filter, markering, export och loggkontroll');
  await visit(page, 'admin', 'admin.logg', {});
  t = await text();
  ok(t.includes('Gjort av dig i prototypen'), 'testarens poster är märkta');
  ok(t.includes('Deltagare (engångslänk)'), 'pulssvaret loggas utan namn');
  await page.locator('#log-action').selectOption('org_rule.updated'); await page.waitForTimeout(80);
  ok((await text()).includes('Poster (2)'), 'filter på åtgärd fungerar');
  await page.locator('#log-action').selectOption(''); await page.locator('#log-actor').selectOption('u-robin'); await page.waitForTimeout(80);
  const robinRows = await S(() => MM.store.state.auditLog.filter((a) => a.actorId === 'u-robin').length);
  ok((await text()).includes(`Poster (${robinRows})`), 'filter på aktör fungerar');
  await page.locator('#log-actor').selectOption('');
  const nadiaNo = await S(() => MM.sel.caseByTag('nadia').number);
  await page.locator('#log-case').fill(nadiaNo); await page.waitForTimeout(80);
  const nadiaRows = await S(() => { const id = MM.store.state.script.nadia; return MM.store.state.auditLog.filter((a) => (['case', 'consent'].includes(a.entity) ? a.entityId : a.details && a.details.caseId) === id).length; });
  ok((await text()).includes(`Poster (${nadiaRows})`), 'filter på ärende fungerar');
  await page.locator('#log-case').fill('');
  await btn('Exportera (CSV)').click(); await page.waitForTimeout(150);
  ok(await S(() => MM.store.state.auditLog.some((a) => a.action === 'export.audit_log')), 'exporten loggas via audit.view');
  const csv = await page.locator('#text-modal-area').inputValue().catch(() => '');
  ok(csv.startsWith('"Tidpunkt";"Aktör"'), 'CSV-filen skapas (visas för kopiering i testmiljön)');
  await page.keyboard.press('Escape');
  ok((await text()).includes('Gör kontrollen som chef'), 'admin ser att loggkontrollen görs av chef');
  await visit(page, 'chef', 'admin.logg', {});
  const sample = await page.locator('[aria-label^="Bedömning av"]').count();
  ok(sample > 0, `chefen får ett stickprov (${sample} poster)`);
  for (let i = 0; i < sample; i++) await page.locator('[aria-label^="Bedömning av"]').nth(i).getByRole('button', { name: i === 0 ? /Avvikelse/ : /Motiverad/ }).click();
  await btn('Signera loggkontrollen').click(); await page.waitForTimeout(80);
  ok((await text()).includes('Beskriv avvikelsen'), 'avvikelse kräver anteckning');
  await page.locator('#logcheck-note').fill('Visningen saknar koppling till ett pågående ärende. Följs upp med samordnaren.');
  await btn('Signera loggkontrollen').click(); await page.waitForTimeout(100);
  const lc = await S(() => MM.store.state.logChecks);
  ok(lc && lc.length === 1 && lc[0].items.length === sample && lc[0].signedBy === 'u-karin', 'loggkontrollen signeras och sparas');
  ok((await text()).includes('är signerad'), 'vyn visar att kontrollen är signerad');

  // ------------------------------------------------------------------ praktik.arbetsgivare
  step('praktik.arbetsgivare – register, fyra rätt och behörighet');
  await visit(page, 'samordnare', 'praktik.arbetsgivare', {});
  ok((await text()).includes('Byggs i fas 3'), 'märkt med byggfas 3');
  const nEmp = await S(() => MM.store.state.employers.length);
  await btn('Lägg till arbetsgivare').click(); await page.waitForTimeout(80);
  await page.locator('.modal').getByRole('button', { name: 'Lägg till', exact: true }).click(); await page.waitForTimeout(60);
  ok((await page.locator('.modal').innerText()).includes('Skriv företagets namn'), 'obligatoriska fält kontrolleras');
  await page.locator('#emp-name').fill('Botkyrka Bageri AB');
  await page.locator('#emp-org').fill('556777-1234');
  await page.locator('#emp-contact').fill('Lina Berg');
  await page.locator('#emp-email').fill('lina.berg@example.com');
  await page.locator('#emp-area-D').check(); await page.locator('#emp-area-H').check();
  await page.locator('.modal').getByRole('button', { name: 'Lägg till', exact: true }).click(); await page.waitForTimeout(150);
  const emp = await S(() => MM.store.state.employers[MM.store.state.employers.length - 1]);
  ok(await S(() => MM.store.state.employers.length) === nEmp + 1 && emp.name === 'Botkyrka Bageri AB' && emp.areas.join() === 'D,H', 'arbetsgivaren läggs till med områden');
  ok(await S(() => MM.route.params.employerId) === emp.id, 'vyn visar den nya arbetsgivaren');
  const dup = await S(() => MM.dispatch('employer.add', { name: 'botkyrka bageri ab', areas: ['D'] }));
  ok(dup && dup.error === 'duplicate', 'dubbletter stoppas');
  // fyra rätt på Nadias praktikplats (coach Amira)
  const nadiaPl = await S(() => MM.store.state.placements.find((p) => p.caseId === MM.store.state.script.nadia).id);
  await visit(page, 'coach', 'praktik.arbetsgivare', { employerId: 'emp-1' });
  t = await text();
  ok(t.includes('Nadia Warsame'), 'coachen ser namn i sina egna ärenden');
  ok(t.includes('Praktikplatser i andra team') && t.includes('Deltagare i ett annat team'), 'andra teams deltagare visas utan namn');
  const otherNames = await S(() => { const own = new Set(MM.store.state.cases.filter((c) => MM.sel.access(c, 'coach', 'u-amira') !== 'none').map((c) => c.id)); return MM.store.state.placements.filter((p) => p.employerId === 'emp-1' && p.status === 'ongoing' && !own.has(p.caseId)).map((p) => { const c = MM.sel.caseById(p.caseId); const pe = MM.sel.person(c); return `${pe.firstName} ${pe.lastName}`; }); });
  const tNow = await text();
  ok(otherNames.length > 0 && otherNames.every((n) => !tNow.includes(n)), 'inga namn från andra coachers ärenden syns');
  await page.locator(`#fr-${nadiaPl}-uppfoljning`).check(); await page.waitForTimeout(80);
  ok(await S(() => MM.store.state.placements.find((p) => p.caseId === MM.store.state.script.nadia).fourRights.uppfoljning === true), 'coachen bockar i "Rätt uppföljning"');
  await page.locator(`#fu-${nadiaPl}`).fill('2027-02-10');
  await page.getByRole('button', { name: 'Lägg till uppföljning' }).first().click(); await page.waitForTimeout(80);
  ok(await S(() => MM.store.state.placements.find((p) => p.caseId === MM.store.state.script.nadia).followUpDates.includes('2027-02-10')), 'uppföljningsdatum läggs till');
  ok(await S(() => MM.store.state.auditLog.some((a) => a.action === 'placement.four_rights_updated')), 'ändringen av fyra rätt loggas');
  await visit(page, 'handledare', 'praktik.arbetsgivare', {});
  ok((await text()).includes('Arbetsgivare ('), 'handledaren når registret');
} catch (e) {
  failures.push(`Undantag: ${e.message.split('\n')[0]}`);
  console.log(e);
}

ok(errors.length === 0, `inga konsolfel (${errors.length})`);
if (errors.length) console.log(errors.join('\n'));
console.log(`\n${passed} kontroller godkända, ${failures.length} fel.`);
if (failures.length) console.log(failures.map((f) => ` - ${f}`).join('\n'));
await close();
process.exit(failures.length ? 1 : 0);
