// Röktest: renderar vyer för alla tillåtna roller och rapporterar fel.
// node tools/check.mjs                      -> alla registrerade vyer
// node tools/check.mjs --views a,b,c        -> bara dessa
// node tools/check.mjs --shots DIR          -> spara skärmdumpar (desktop + mobil) i DIR
// node tools/check.mjs --mobile             -> kör även 400 px bredd och kontrollera horisontell scroll
import fs from 'node:fs';
import path from 'node:path';
import { openProto, visit } from './lib.mjs';
const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = get('--views') ? get('--views').split(',').map((s) => s.trim()) : null;
const shots = get('--shots'); const mobile = args.includes('--mobile');
if (shots) fs.mkdirSync(shots, { recursive: true });
const { page, errors, close } = await openProto();
const defs = await page.evaluate(() => {
  const sc = MM.store.state.script; const st = MM.store.state;
  const rep = (tag, kind, month) => (st.reports.find((r) => r.caseId === sc[tag] && r.kind === kind && (!month || r.month === month)) || {}).id;
  const ci = (st.checkIns.find((x) => x.caseId === sc.mehmet && x.ai) || {}).id;
  const P = {
    'arende.kort': [{ caseId: sc.nadia }, { caseId: sc.yusuf, tab: 'avvikelser' }, { caseId: sc.skyddad }],
    'coach.avstamning': [{ caseId: sc.yusuf }, { caseId: sc.mehmet, checkInId: ci }],
    'coach.manad': [{ caseId: sc.nadia, month: '2027-01' }], 'coach.kartlaggning': [{ caseId: sc.amal }], 'coach.handelse': [{ caseId: sc.hodan }],
    'rapport.visa': [{ reportId: rep('nadia', 'monthly', '2027-01') }, { reportId: rep('slutsen', 'final') }, { reportId: st.reports.find((r) => r.kind === 'weekly_attendance' && r.week === '2027-W04' && r.recipientUserId === 'k-maria').id }, { reportId: st.reports.find((r) => r.kind === 'customer_summary' && r.month === '2026-12').id }, { reportId: rep('nadia', 'order_confirmation') }],
    'eko.korning': [{ month: '2027-01' }], 'eko.faktura': [{ month: '2027-01', caseId: sc.nadia }], 'eko.arende': [{ caseId: sc.nadia }],
    'kom.deltagare': [{}, { caseId: sc.nadia }], 'sam.inkorg': [{}, { emailId: 'em-102' }, { emailId: 'em-104' }], 'admin.avtal': [{}, { contract: 'c-kk' }], 'chef.oversikt': [{}, { tab: 'puls' }],
    'coach.narvaro': [{}, { week: 'last' }],
  };
  return Object.values(MM.views).map((v) => ({ id: v.id, roles: Array.isArray(v.roles) ? v.roles : MM.ROLES.map((r) => r.key), params: P[v.id] || [{}] }));
});
let fails = 0; const results = [];
for (const v of defs) {
  if (only && !only.includes(v.id)) continue;
  for (const role of v.roles) {
    for (const params of v.params) {
      const before = errors.length;
      let problems = [];
      try { problems = await visit(page, role, v.id, params); } catch (e) { problems = ['Exception: ' + e.message]; }
      const newErr = errors.slice(before);
      if (mobile) {
        await page.setViewportSize({ width: 400, height: 860 }); await page.waitForTimeout(80);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (over > 1) problems.push(`Horisontell scroll på 400 px (${over}px för brett)`);
        if (shots) await page.screenshot({ path: path.join(shots, `${v.id}__${role}__m.png`), fullPage: false });
        await page.setViewportSize({ width: 1280, height: 900 });
      }
      if (shots) await page.screenshot({ path: path.join(shots, `${v.id}__${role}.png`), fullPage: true });
      const ok = !problems.length && !newErr.length; if (!ok) fails++;
      results.push({ view: v.id, role, params: JSON.stringify(params), ok, problems, errors: newErr });
    }
  }
}
for (const r of results) if (!r.ok) console.log(`FEL  ${r.view} som ${r.role} ${r.params}\n     ${[...r.problems, ...r.errors].join('\n     ')}`);
console.log(`\n${results.length - fails}/${results.length} kombinationer utan fel.`);
await close();
process.exit(fails ? 1 : 0);
