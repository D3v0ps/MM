// Granskning "regler" – prober: levererade rapporter räknas om, maskering/loggning, åtkomst.
import { openProto, visit } from './lib.mjs';
const SH = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-regler';
const { page, close } = await openProto();
const txt = () => page.evaluate(() => document.querySelector('#main').innerText);
const out = {};
// 1. Levererad decemberrapport för Nadia – ändras när underlaget ändras?
const info = await page.evaluate(() => { const st = MM.store.state; const sc = st.script; const r = st.reports.find((x) => x.kind === 'monthly' && x.caseId === sc.nadia && x.month === '2026-12'); const act = MM.sel.activitiesOf(sc.nadia).find((a) => a.startsAt.startsWith('2026-12') && (MM.sel.attendanceFor(a.id) || {}).status === 'present'); return { rid: r.id, status: r.status, act: act && act.id }; });
out.info = info;
await visit(page, 'kommun_handlaggare', 'rapport.visa', { reportId: info.rid });
let t = await txt(); const before = (t.match(/Totalt[^\n]*/) || [])[0]; const beforeInv = (t.match(/Upprepad ogiltig frånvaro:[^\n]*/) || [])[0];
await page.evaluate((id) => MM.dispatch('attendance.set', { activityId: id, status: 'absent_invalid', reason: '' }), info.act);
await visit(page, 'kommun_handlaggare', 'rapport.visa', { reportId: info.rid });
t = await txt(); out.deliveredReportChanged = { before, after: (t.match(/Totalt[^\n]*/) || [])[0], beforeInv, afterInv: (t.match(/Upprepad ogiltig frånvaro:[^\n]*/) || [])[0], statusNow: await page.evaluate((id) => MM.store.state.reports.find((r) => r.id === id).status, info.rid) };
// 2. Personnummer: Visa loggas
await visit(page, 'samordnare', 'arende.kort', { caseId: await page.evaluate(() => MM.store.state.script.nadia) });
const vis = page.getByRole('button', { name: 'Visa', exact: true });
out.pnrMaskedBefore = await page.evaluate(() => (document.querySelector('.mono') || {}).innerText);
if (await vis.count()) { await vis.first().click(); await page.waitForTimeout(100); }
out.pnrLog = await page.evaluate(() => MM.store.state.auditLog.filter((a) => a.action === 'pnr.revealed').length);
// 3. Åtkomst: ekonom och kommun till MB-vyer (skiftlägesokänslig kontroll)
out.access = {};
for (const [role, view, p] of [['ekonom', 'arende.kort', { caseId: 'case-260143' }], ['ekonom', 'rapporter.lista', {}], ['ekonom', 'rapport.visa', { reportId: info.rid }], ['ekonom', 'arenden.lista', {}], ['ekonom', 'admin.logg', {}], ['kommun_handlaggare', 'arende.kort', { caseId: 'case-260143' }], ['kommun_chef', 'chef.oversikt', {}], ['handledare', 'rapporter.lista', {}], ['coach', 'chef.oversikt', {}], ['coach', 'admin.logg', {}], ['handledare', 'coach.avstamning', {}]]) {
  await visit(page, role, view, p); const tx = await txt(); out.access[`${role}:${view}`] = /ingen åtkomst/i.test(tx) ? 'nekad' : tx.slice(0, 80).replace(/\n/g, ' | ');
}
// 4. Kommunens chef: rapport för skyddat ärende via portalens egen länk – nameFor vs rapport
// (redan verifierat i probe 1)
// 5. Handledare: finns någon länk i UI till rapport.visa?
await visit(page, 'handledare', 'hand.start', {});
out.handLinksToReports = await page.evaluate(() => /rapport/i.test(document.querySelector('.sidebar').innerText));
// 6. Coach ser annan coachs ärende i veckorapport – namn?
console.log(JSON.stringify(out, null, 2));
await close();
