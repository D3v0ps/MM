import fs from 'node:fs';
import { openProto, visit } from './lib.mjs';
const { page, close } = await openProto();
const defs = await page.evaluate(() => { const sc = MM.store.state.script; const st = MM.store.state;
  const rep = (tag, kind, month) => (st.reports.find((r) => r.caseId === sc[tag] && r.kind === kind && (!month || r.month === month)) || {}).id;
  const P = { 'arende.kort': ['oversikt','kartlaggning','avstamningar','narvaro','manad','handelser','avvikelser','praktik','rapporter','meddelanden','historik'].map((tab) => ({ caseId: sc.nadia, tab })),
    'rapport.visa': [{ reportId: rep('nadia', 'monthly', '2026-12') }, { reportId: rep('slutsen', 'final') }, { reportId: rep('nadia', 'order_confirmation') }, { reportId: st.reports.find((r) => r.kind === 'customer_summary' && r.month === '2026-12').id }],
    'sam.inkorg': ['em-101','em-102','em-103','em-104','em-105','em-106'].map((emailId) => ({ emailId })), 'chef.oversikt': [{}, { tab: 'puls' }, { tab: 'coacher' }, { tab: 'omraden' }],
    'admin.avtal': [{}, { contract: 'c-kk' }, { tab: 'interna' }], 'admin.mallar': [{}, { tab: 'logg' }], 'eko.korning': [{ month: '2027-01' }], 'eko.faktura': [{ month: '2027-01', caseId: sc.nadia }], 'eko.arende': [{ caseId: sc.nadia }],
    'coach.avstamning': [{ caseId: sc.yusuf }, { caseId: sc.mehmet, checkInId: (st.checkIns.find((x) => x.caseId === sc.mehmet && x.ai) || {}).id }], 'coach.manad': [{ caseId: sc.nadia, month: '2027-01' }], 'coach.kartlaggning': [{ caseId: sc.amal }], 'coach.handelse': [{ caseId: sc.hodan }, { caseId: sc.hodan, mode: 'close' }], 'kom.deltagare': [{}, { caseId: sc.nadia }] };
  return Object.values(MM.views).map((v) => ({ id: v.id, roles: Array.isArray(v.roles) ? v.roles : ['samordnare'], params: P[v.id] || [{}] })); });
const lines = [];
for (const v of defs) for (const role of v.roles) for (const params of v.params) { await visit(page, role, v.id, params); const t = await page.evaluate(() => document.querySelector('#main').innerText); for (const l of t.split('\n')) lines.push(`${v.id}@${role}\t${l.trim()}`); }
fs.writeFileSync(process.argv[2], lines.join('\n'));
await close();
