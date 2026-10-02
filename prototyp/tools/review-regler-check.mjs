// Granskning "regler" – körtidskontroller av behörighet, personuppgifter, internt mål, AI-regler och fakturaregler.
// Körs: node tools/review-regler-check.mjs  (skriver resultat som JSON till stdout)
import fs from 'node:fs';
import path from 'node:path';
import { openProto, visit } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-regler';
fs.mkdirSync(SHOTS, { recursive: true });
const out = {};
const { page, errors, close } = await openProto();

const text = () => page.evaluate(() => (document.querySelector('#main') || document.body).innerText);
const go = async (role, view, params = {}) => { const p = await visit(page, role, view, params); return { problems: p, text: await text() }; };
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

// Grunddata
const base = await page.evaluate(() => {
  const st = MM.store.state; const sc = st.script;
  return {
    script: sc,
    persons: st.persons.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, prot: p.protectedIdentity })),
    cases: st.cases.map((c) => ({ id: c.id, number: c.number, lead: c.leadCoachId, team: (c.team || []).map((t) => t.userId), referrer: c.referrerId, personId: c.personId, status: c.status })),
  };
});
const nameOf = (caseId) => { const c = base.cases.find((x) => x.id === caseId); const p = base.persons.find((x) => x.id === c.personId); return p.name; };

// ---------------------------------------------------------------- 1. Coach: aldrig eskalering
const ESC = /eskaler|Tidig uppmärksamhet|no_progress_escalated|progress_escalation/i;
const coachHits = [];
const yusuf = base.script.yusuf;
const coachViews = [
  ['coach.minvecka', {}], ['coach.narvaro', {}], ['coach.narvaro', { week: 'last' }], ['coach.avstamning', { caseId: yusuf }], ['coach.manad', { caseId: yusuf, month: '2027-01' }],
  ['arenden.lista', {}], ['arenden.lista', { filter: 'flaggor' }], ['notiser', {}], ['rapporter.lista', {}], ['praktik.arbetsgivare', {}],
];
for (const tab of ['oversikt', 'kartlaggning', 'avstamningar', 'narvaro', 'manad', 'handelser', 'avvikelser', 'praktik', 'rapporter', 'meddelanden', 'historik']) coachViews.push(['arende.kort', { caseId: yusuf, tab }]);
for (const [v, p] of coachViews) {
  const r = await go('coach', v, p);
  const sidebar = await page.evaluate(() => (document.querySelector('.sidebar') || {}).innerText || '');
  const m = r.text.match(new RegExp(`.{0,60}${ESC.source}.{0,60}`, 'i'));
  if (m || ESC.test(sidebar)) coachHits.push({ view: v, params: p, match: m ? m[0] : sidebar.match(ESC)[0] });
}
out.coachEscalationHits = coachHits;
out.coachNotifs = await page.evaluate(() => MM.sel.notificationsFor('u-amira', 'coach').map((n) => n.kind));
out.coachAlertsKinds = await page.evaluate(() => MM.sel.alerts({ role: 'coach', personaId: 'u-amira' }).map((a) => a.kind));
out.chefAlertsEsc = await page.evaluate(() => MM.sel.alerts({ role: 'chef', personaId: 'u-karin' }).filter((a) => a.kind === 'no_progress_escalated').map((a) => a.text));
// Handledare
const handHits = [];
for (const [v, p] of [['hand.start', {}], ['coach.narvaro', {}], ['arenden.lista', {}], ['notiser', {}], ['praktik.arbetsgivare', {}]]) {
  const r = await go('handledare', v, p); const m = r.text.match(new RegExp(`.{0,60}${ESC.source}.{0,60}`, 'i')); if (m) handHits.push({ view: v, match: m[0] });
}
out.handEscalationHits = handHits;

// Coach: syns chefens visning i deltagarkortets historik? (indirekt signal om eskalering)
await go('chef', 'chef.oversikt', {});
await go('chef', 'arende.kort', { caseId: yusuf });
const hist = await go('coach', 'arende.kort', { caseId: yusuf, tab: 'historik' });
out.coachHistorySeesChefView = /Karin Wallin[\s\S]{0,80}Öppnade deltagarkortet/.test(hist.text);
await shot('coach-historik-yusuf');

// ---------------------------------------------------------------- 2. Handledare: bara tilldelade ärenden, rapporter
const hand = await page.evaluate(() => {
  const pid = 'u-petra';
  const vis = MM.sel.visibleCases('handledare', pid).map((c) => c.id);
  const team = MM.store.state.cases.filter((c) => (c.team || []).some((t) => t.userId === pid)).map((c) => ({ id: c.id, prot: (MM.sel.person(c) || {}).protectedIdentity }));
  const monthly = MM.store.state.reports.find((r) => r.kind === 'monthly' && vis.includes(r.caseId) && ['delivered', 'opened'].includes(r.status));
  return { visCount: vis.length, teamCount: team.length, teamProt: team.filter((t) => t.prot).length, monthlyId: monthly ? monthly.id : null, monthlyCase: monthly ? monthly.caseId : null };
});
out.hand = hand;
if (hand.monthlyId) {
  const r = await go('handledare', 'rapport.visa', { reportId: hand.monthlyId });
  out.handMonthly = { problems: r.problems, showsProgression: /Progression[\s\S]{0,400}(Nivå|Observation)/.test(r.text), showsSummary: /Coachens sammanfattande bedömning/.test(r.text), snippet: r.text.slice(0, 300) };
  await shot('handledare-manadsrapport');
  const k = await go('handledare', 'arende.kort', { caseId: hand.monthlyCase, tab: 'oversikt' });
  out.handKortNotice = (k.text.match(/Coachens anteckningar[^.]*\./) || [])[0];
}
// Handledare: öppna ett ärende utanför teamet
const nonTeam = base.cases.find((c) => !c.team.includes('u-petra') && c.status === 'active');
out.handNonTeam = (await go('handledare', 'arende.kort', { caseId: nonTeam.id })).text.slice(0, 200);

// ---------------------------------------------------------------- 3. Ekonom: inga namn
const names = base.persons.map((p) => p.name);
const ekoHits = [];
const ekoViews = [['eko.start', {}], ['eko.korning', { month: '2027-01' }], ['eko.korning', { month: '2026-12' }], ['eko.faktura', { month: '2027-01', caseId: base.script.nadia }], ['eko.arende', { caseId: base.script.nadia }], ['eko.arende', { caseId: base.script.skyddad }], ['eko.arende', {}], ['notiser', {}]];
for (const [v, p] of ekoViews) {
  const r = await go('ekonom', v, p);
  const found = names.filter((n) => r.text.includes(n));
  if (found.length || r.problems.length) ekoHits.push({ view: v, params: p, found: found.slice(0, 5), problems: r.problems });
}
// Försök nå vyer med anteckningar/rapporter
for (const [v, p] of [['arende.kort', { caseId: base.script.nadia }], ['rapporter.lista', {}], ['rapport.visa', { reportId: 'x' }], ['arenden.lista', {}]]) {
  const r = await go('ekonom', v, p); ekoHits.push({ view: v, accessDenied: /Ingen åtkomst/.test(r.text) });
}
out.ekonom = ekoHits;

// ---------------------------------------------------------------- 4. Kommunens vyer: internt mål, namn på skyddade, coachanteckningar
const INTERNAL = /intern|35\s?%|35,0|\b35\b/i;
const kom = [];
const reps = await page.evaluate(() => {
  const st = MM.store.state; const sc = st.script; const ok = (r) => ['delivered', 'opened'].includes(r.status) && !r.superseded;
  const pick = (f) => (st.reports.find((r) => ok(r) && f(r)) || {}).id || null;
  return {
    summary: pick((r) => r.kind === 'customer_summary'),
    monthlyNadia: pick((r) => r.kind === 'monthly' && r.caseId === sc.nadia),
    monthlyProt: pick((r) => r.kind === 'monthly' && r.caseId === sc.skyddad),
    finalProt: pick((r) => r.kind === 'final' && r.caseId === sc.skyddad),
    weeklyOmar: pick((r) => r.kind === 'weekly_attendance' && r.recipientUserId === 'k-omar'),
    weeklyMaria: pick((r) => r.kind === 'weekly_attendance' && r.recipientUserId === 'k-maria'),
    order: pick((r) => r.kind === 'order_confirmation' && r.caseId === sc.nadia),
    final: pick((r) => r.kind === 'final'),
    draftMonthlyNadia: (st.reports.find((r) => r.kind === 'monthly' && r.caseId === sc.nadia && r.month === '2027-01') || {}).id,
    draftMonthlyNadiaStatus: (st.reports.find((r) => r.kind === 'monthly' && r.caseId === sc.nadia && r.month === '2027-01') || {}).status,
  };
});
out.reps = reps;
const komViews = [
  ['kommun_handlaggare', 'kom.start', {}], ['kommun_handlaggare', 'kom.deltagare', {}], ['kommun_handlaggare', 'kom.deltagare', { caseId: base.script.nadia }],
  ['kommun_handlaggare', 'kom.deltagare', { caseId: base.script.nadia, tab: 'rapporter' }], ['kommun_handlaggare', 'kom.deltagare', { caseId: base.script.nadia, tab: 'meddelanden' }],
  ['kommun_handlaggare', 'kom.rapporter', {}], ['kommun_handlaggare', 'kom.bestall', {}], ['kommun_handlaggare', 'kom.login', {}],
  ['kommun_chef', 'kom.chef', {}], ['kommun_chef', 'kom.deltagare', {}], ['kommun_chef', 'kom.rapporter', {}], ['kommun_chef', 'kom.deltagare', { caseId: base.script.skyddad }],
  ['kommun_chef', 'kom.deltagare', { caseId: base.script.skyddad, tab: 'rapporter' }],
];
for (const k of ['summary', 'monthlyNadia', 'weeklyMaria', 'order', 'final']) if (reps[k]) { komViews.push(['kommun_chef', 'rapport.visa', { reportId: reps[k] }]); komViews.push(['kommun_handlaggare', 'rapport.visa', { reportId: reps[k] }]); }
for (const [role, v, p] of komViews) {
  const r = await go(role, v, p);
  const m = r.text.match(/.{0,70}(intern|35\s?%|\b35\b).{0,50}/i);
  if (m) kom.push({ role, view: v, params: p, match: m[0] });
}
out.kommunInternal = kom;
// kom.chef flikar
const chefTabs = [];
await go('kommun_chef', 'kom.chef', {});
for (const t of ['Resultat', 'Deltagare', 'Progression', 'Närvaro och nöjdhet']) {
  const btn = page.getByRole('tab', { name: t }); if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(100); const tx = await text(); const m = tx.match(/.{0,60}(intern|35\s?%|\b35\b).{0,40}/i); if (m) chefTabs.push({ tab: t, match: m[0] }); }
}
out.kommunChefTabs = chefTabs;
await shot('kom-chef');

// Skyddad deltagare hos kommunens chef (inte beställande handläggare)
const protName = nameOf(base.script.skyddad);
out.protName = protName;
const protChecks = [];
for (const k of ['monthlyProt', 'finalProt', 'weeklyOmar']) if (reps[k]) {
  const r = await go('kommun_chef', 'rapport.visa', { reportId: reps[k] }); protChecks.push({ report: k, role: 'kommun_chef', showsName: r.text.includes(protName), snippet: (r.text.match(new RegExp(`.{0,60}${protName}.{0,30}`)) || [])[0] });
  if (k === 'monthlyProt') await shot('kommun-chef-skyddad-manadsrapport');
}
const chefList = await go('kommun_chef', 'kom.deltagare', { caseId: base.script.skyddad });
protChecks.push({ report: 'kom.deltagare', role: 'kommun_chef', showsName: chefList.text.includes(protName) });
// samordnare / chef MB
for (const role of ['samordnare', 'chef', 'admin']) {
  for (const k of ['monthlyProt', 'weeklyOmar']) if (reps[k]) { const r = await go(role, 'rapport.visa', { reportId: reps[k] }); protChecks.push({ report: k, role, showsName: r.text.includes(protName) }); }
  const l = await go(role, 'arenden.lista', { filter: 'skyddade' }); protChecks.push({ report: 'arenden.lista', role, showsName: l.text.includes(protName) });
}
for (const role of ['coach', 'handledare']) { const r = await go(role, 'arende.kort', { caseId: base.script.skyddad }); protChecks.push({ report: 'arende.kort', role, showsName: r.text.includes(protName) }); }
out.protected = protChecks;

// Kommunen: coachanteckningar (avstämningens anteckning) syns?
const noteInfo = await page.evaluate(() => {
  const sc = MM.store.state.script; const ci = MM.sel.checkInsOf(sc.nadia).filter((x) => x.status === 'approved' && x.note);
  return ci.slice(0, 3).map((x) => x.note);
});
const komCase = await go('kommun_handlaggare', 'kom.deltagare', { caseId: base.script.nadia });
let noteLeak = noteInfo.filter((n) => komCase.text.includes(n));
if (reps.monthlyNadia) { const r = await go('kommun_handlaggare', 'rapport.visa', { reportId: reps.monthlyNadia }); noteLeak = noteLeak.concat(noteInfo.filter((n) => r.text.includes(n))); }
out.kommunNoteLeak = noteLeak;

// Rapport-utkast: kommunen ser inte; MB-förhandsvisning bygger på godkända
if (reps.draftMonthlyNadia) {
  const k = await go('kommun_handlaggare', 'rapport.visa', { reportId: reps.draftMonthlyNadia });
  out.draftForKommun = k.text.slice(0, 200);
  const m = await go('samordnare', 'rapport.visa', { reportId: reps.draftMonthlyNadia });
  out.draftForMB = { status: reps.draftMonthlyNadiaStatus, sec4Hidden: /4\. Progression\s*Visas när coachen har godkänt/.test(m.text), sec8Hidden: /8\. Coachens sammanfattande bedömning\s*Visas när coachen/.test(m.text) };
  await shot('samordnare-manadsrapport-utkast');
}

// ---------------------------------------------------------------- 5. AI-regler
const manad = await go('coach', 'coach.manad', { caseId: base.script.nadia, month: '2027-01' });
out.manadLevels = await page.evaluate(() => Array.from(document.querySelectorAll('select[id^="lvl-"]')).map((s) => s.value));
out.manadOverallPressed = await page.evaluate(() => Array.from(document.querySelectorAll('#cm-overall button[aria-pressed="true"]')).map((b) => b.innerText));
out.manadAiBoxes = (manad.text.match(/AI-utkast/g) || []).length;
await shot('coach-manad-nadia');
// Belägg för AI-observationer: finns godkända avstämningar på källdatumen?
out.aiSources = await page.evaluate(() => {
  const sc = MM.store.state.script; const out2 = {};
  for (const tag of ['nadia', 'hodan', 'mehmet']) {
    const ma = MM.sel.assessment(sc[tag], '2027-01'); if (!ma) continue;
    const approvedDays = MM.sel.checkInsOf(sc[tag]).filter((x) => x.status === 'approved' && x.heldAt.startsWith('2027-01')).map((x) => MM.d.fmtDateShort(x.heldAt));
    const srcs = Object.values(ma.areas).filter((a) => a.aiObservationDraft).map((a) => a.aiObservationDraft.sources[0].replace('Avstämning ', ''));
    const att = MM.sel.attendanceStats(sc[tag], '2027-01-01', '2027-01-31');
    out2[tag] = { status: ma.status, approvedCheckInDays: approvedDays, sources: MM.uniq(srcs), unmatched: MM.uniq(srcs).filter((s) => !approvedDays.includes(s)), summaryDraft: ma.aiSummaryDraft, actualAttendance: `${att.present + att.late} av ${att.planned - att.unregistered} (planerade ${att.planned})`, approvedCheckIns: approvedDays.length };
  }
  return out2;
});
const avst = await go('coach', 'coach.avstamning', { caseId: base.script.mehmet, checkInId: await page.evaluate(() => (MM.store.state.checkIns.find((x) => x.caseId === MM.store.state.script.mehmet && x.ai) || {}).id) });
out.avstMehmet = {
  statusPressed: await page.evaluate(() => Array.from(document.querySelectorAll('#ci-status button[aria-pressed="true"]')).map((b) => b.innerText)),
  goalPressed: await page.evaluate(() => Array.from(document.querySelectorAll('#ci-goal button[aria-pressed="true"]')).map((b) => b.innerText)),
  evidence: (avst.text.match(/Tidpunkt \d\d:\d\d/g) || []).length,
};
await shot('coach-avstamning-mehmet');
// AI utan samtycke och skyddat ärende
const consentCases = await page.evaluate(() => { const sc = MM.store.state.script; return { elif: MM.sel.caseById(sc.elif).aiConsent, yusuf: MM.sel.caseById(sc.yusuf).aiConsent, amal: MM.sel.caseById(sc.amal).aiConsent }; });
out.consentCases = consentCases;
await go('coach', 'coach.avstamning', { caseId: base.script.elif });
await page.getByRole('button', { name: 'Med AI-stöd' }).click(); await page.waitForTimeout(100);
const t1 = await text();
out.aiNoConsent = { consentPanel: /Samtycke saknas/.test(t1), canStartRecording: /Starta inspelning/.test(t1) };
// Avslutsorsak tom
await go('coach', 'coach.handelse', { caseId: base.script.nadia, mode: 'close' });
out.closeReasonPressed = await page.evaluate(() => Array.from(document.querySelectorAll('#cl-reason button[aria-pressed="true"]')).map((b) => b.innerText));
// AI via inklistrade anteckningar – förslagen följer inte texten
await go('coach', 'coach.avstamning', { caseId: base.script.hodan });
await page.getByRole('button', { name: 'Med AI-stöd' }).click(); await page.waitForTimeout(80);
const notesBtn = page.getByRole('button', { name: 'Inklistrade anteckningar' });
if (await notesBtn.count()) {
  await notesBtn.click();
  await page.fill('#ai-notes', 'Deltagaren var sjuk hela veckan och deltog inte i något. Ingen arbetsgivarkontakt.');
  await page.getByRole('button', { name: 'Tolka anteckningarna' }).click();
  await page.waitForTimeout(1200);
  const t2 = await text();
  out.notesAi = { goalSuggestionPartly: /Veckomål uppnått[\s\S]{0,200}Delvis/.test(t2) || /AI-förslag[\s\S]{0,80}Delvis/.test(t2), snippet: (t2.match(/AI-förslag[\s\S]{0,260}/) || [])[0] };
  await shot('coach-ai-anteckningar');
}

// ---------------------------------------------------------------- 6. Utskick och toasts: fånga toasts i några flöden
await page.evaluate(() => { window.__toasts = []; const orig = MM.toast; MM.toast = (t, tone) => { window.__toasts.push(t); return orig(t, tone); }; });
// Acceptera em-101
await go('samordnare', 'sam.inkorg', { emailId: 'em-101' });
const acc = page.getByRole('button', { name: 'Acceptera', exact: true });
if (await acc.count()) {
  await acc.first().click(); await page.waitForTimeout(100);
  await page.locator('input[name="ink-coach"]').first().check();
  await page.getByRole('button', { name: 'Acceptera avropet' }).click(); await page.waitForTimeout(150);
}
// Närvaro som coach
await go('coach', 'coach.narvaro', { week: 'last' });
const presentBtns = page.locator('.co-att .seg button', { hasText: 'Närvarande' });
const nPresent = Math.min(await presentBtns.count(), 12);
for (let i = 0; i < nPresent; i++) { await presentBtns.nth(0).click(); await page.waitForTimeout(40); }
out.toasts = await page.evaluate(() => window.__toasts);
out.notifications = await page.evaluate(() => MM.store.state.notifications.map((n) => ({ t: n.template, to: n.to, body: n.body })));
out.notifLeaks = out.notifications.filter((n) => names.some((x) => n.body.includes(x)) || /\b(19|20)\d{6}[-+]?\d{4}\b/.test(n.body));
out.toastLeaks = out.toasts.filter((t) => names.some((x) => t.includes(x)));
out.userNotifLeaks = await page.evaluate((nm) => MM.store.state.userNotifications.filter((n) => nm.some((x) => `${n.title} ${n.body} ${n.emailBody}`.includes(x))).length, names);
out.auditLeaks = await page.evaluate((nm) => MM.store.state.auditLog.filter((a) => nm.some((x) => JSON.stringify(a.details || {}).includes(x))).map((a) => a.action), names);
out.localStorageHasNames = await page.evaluate((nm) => { const s = JSON.stringify(localStorage); return nm.filter((x) => s.includes(x)).slice(0, 3); }, names);

// ---------------------------------------------------------------- 7. Fakturaregler
out.billing = await page.evaluate(() => {
  const v = MM.valid; const r = {};
  r.ref = { '1234567': v.buyerRef('1234567'), '12345678': v.buyerRef('12345678'), '1234567890': v.buyerRef('1234567890'), '12345678901': v.buyerRef('12345678901'), '1234-5678': v.buyerRef('1234-5678') };
  r.po = { '991234567': v.poNumber('991234567'), '981234567': v.poNumber('981234567'), '99123456': v.poNumber('99123456') };
  const b = MM.sel.billingForMonth('2027-01');
  r.jan = { count: b.count, uniqueCases: new Set(b.invoices.map((x) => x.caseId)).size, blocked: b.blocked, weeks: MM.uniq(b.invoices.flatMap((x) => x.weeks.map((w) => w.key))).sort() };
  const dec = MM.sel.billingForMonth('2026-12');
  r.dec = { weeks: MM.uniq(dec.invoices.flatMap((x) => x.weeks.map((w) => w.key))).sort() };
  const all = [...b.invoices, ...dec.invoices];
  r.anyNameInInvoice = all.filter((x) => { const p = MM.sel.person(MM.sel.caseById(x.caseId)); return p && (`${x.lineText} ${x.invoiceText}`.includes(p.firstName) || `${x.lineText} ${x.invoiceText}`.includes(p.lastName)); }).length;
  r.lineTextSample = b.invoices[0] && b.invoices[0].lineText;
  const sc = MM.store.state.script;
  const rf = b.invoices.find((x) => x.caseId === sc.reffel1);
  r.reffel1 = rf ? { blocked: rf.blocked, status: rf.status, checks: rf.checks.map((c) => c.kind) } : null;
  // Samma vecka i två månader?
  const seen = {}; let dup = 0; for (const mk of ['2026-10', '2026-11', '2026-12', '2027-01']) for (const x of MM.sel.billingForMonth(mk).invoices) for (const w of x.weeks) { const k = `${x.caseId}:${w.key}`; if (seen[k]) dup++; seen[k] = mk; }
  r.weekBilledTwice = dup;
  r.thursday = { '2026-W53': MM.d.weekMonthKey(MM.d.weekMonday('2026-W53')), '2027-W05': MM.d.weekMonthKey(MM.d.weekMonday('2027-W05')), '2027-W13': MM.d.weekMonthKey(MM.d.weekMonday('2027-W13')) };
  // Ärendenummer i inköpsordernummer?
  r.poWithCaseNo = MM.store.state.cases.filter((c) => c.purchaseOrderNumber && /^[A-Z]+-/.test(c.purchaseOrderNumber)).length;
  // accept med ogiltig referens
  return r;
});
out.acceptBadRef = await page.evaluate(() => { const c = MM.store.state.cases.find((x) => ['acknowledged'].includes(x.status) && !x.buyerReference); if (!c) return 'no case'; return MM.dispatch('case.accept', { caseId: c.id, leadCoachId: 'u-amira', firstMeetingAt: '2027-02-03T10:00', plannedWeeks: 6, buyerReference: '123' }); });
out.poOnInvoiceUi = await (async () => { const r = await go('ekonom', 'eko.faktura', { month: '2027-01', caseId: base.script.nadia }); return (r.text.match(/Ert ordernummer[^\n]*\n?[^\n]*/) || [])[0]; })();

// ---------------------------------------------------------------- 8. Kommunportalens förkortningar
const ABBR = /\b(t\.ex\.|bl\.a\.|ca|kl\.|v\.|st|SLA|KPI|APL|SYV|AI|PDF|PUB|AFK|jan|feb|mars|apr|juni|juli|aug|sep|okt|nov|dec)\b\.?/g;
const abbr = {};
for (const [role, v, p] of [['kommun_handlaggare', 'kom.start', {}], ['kommun_handlaggare', 'kom.deltagare', {}], ['kommun_handlaggare', 'kom.deltagare', { caseId: base.script.nadia }], ['kommun_handlaggare', 'kom.rapporter', {}], ['kommun_chef', 'kom.chef', {}], ['kommun_handlaggare', 'kom.bestall', {}]]) {
  const r = await go(role, v, p); const m = r.text.match(ABBR) || []; abbr[`${role}:${v}:${JSON.stringify(p)}`] = MM_count(m);
}
function MM_count(arr) { const o = {}; for (const x of arr) o[x] = (o[x] || 0) + 1; return o; }
out.kommunAbbr = abbr;
// Fält utan hjälptext i portalen
out.fieldsWithoutHelp = {};
for (const [role, v, p] of [['kommun_handlaggare', 'kom.bestall', {}], ['kommun_handlaggare', 'kom.deltagare', { caseId: base.script.nadia, tab: 'meddelanden' }], ['kommun_handlaggare', 'kom.deltagare', {}], ['kommun_chef', 'kom.chef', {}], ['kommun_chef', 'kom.deltagare', {}]]) {
  await go(role, v, p);
  out.fieldsWithoutHelp[`${role}:${v}`] = await page.evaluate(() => Array.from(document.querySelectorAll('#main input, #main select, #main textarea')).filter((el) => el.offsetParent !== null).filter((el) => { const f = el.closest('.field'); return !(f && f.querySelector('.help')); }).map((el) => `${el.id || el.name || el.type}:${(el.closest('.field') && el.closest('.field').querySelector('label') || {}).innerText || (el.getAttribute('aria-label') || '')}`));
}
// Beställningsflödet steg 2 och 3
await go('kommun_handlaggare', 'kom.bestall', {});
await page.getByRole('button', { name: '5', exact: true }).first().click();
await page.getByRole('button', { name: /Nästa: deltagare/ }).click(); await page.waitForTimeout(80);
out.fieldsWithoutHelp['kom.bestall steg 2'] = await page.evaluate(() => Array.from(document.querySelectorAll('#main input, #main select, #main textarea, #main .seg')).filter((el) => el.offsetParent !== null).filter((el) => { const f = el.closest('.field'); return !(f && f.querySelector('.help')); }).map((el) => el.id || el.className));

out.errors = errors.slice(0, 20);
fs.writeFileSync(path.join(SHOTS, 'result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await close();
