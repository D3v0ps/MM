// Granskning (perspektiv) 06: klicka varje ui.PerspectiveSwitch i de viktigaste vyerna och kontrollera mål, roll, åtkomst och ärende.
import { openProto, visit } from './lib.mjs';
const { page, errors, close } = await openProto();
const S = await page.evaluate(() => {
  const st = MM.store.state; const sc = st.script;
  const rep = (tag, kind, month) => (st.reports.find((r) => r.caseId === sc[tag] && r.kind === kind && (!month || r.month === month)) || {}).id;
  const ahmedRep = (st.reports.find((r) => r.kind === 'monthly' && r.status === 'delivered' && r.caseId && MM.sel.caseById(r.caseId).referrerId === 'k-ahmed') || {}).id;
  const cs = (st.reports.find((r) => r.kind === 'customer_summary' && r.month === '2026-12') || {}).id;
  const weekly = (st.reports.find((r) => r.kind === 'weekly_attendance' && r.recipientUserId === 'k-maria' && r.status === 'delivered') || {}).id;
  return { sc, nadiaMonthly: rep('nadia', 'monthly', '2027-01'), ahmedRep, cs, weekly };
});
const sc = S.sc;
const sources = [
  ['coach', 'notiser', {}], ['chef', 'notiser', {}],
  ['admin', 'admin.avtal', {}], ['admin', 'admin.anvandare', {}], ['admin', 'admin.mallar', {}], ['admin', 'admin.logg', {}],
  ['samordnare', 'praktik.arbetsgivare', {}],
  ['samordnare', 'arenden.lista', {}], ['samordnare', 'arenden.lista', { filter: 'skyddade' }],
  ['samordnare', 'arende.kort', { caseId: sc.skyddad }], ['samordnare', 'arende.kort', { caseId: sc.nadia }],
  ['samordnare', 'arende.kort', { caseId: sc.nadia, tab: 'rapporter' }], ['samordnare', 'arende.kort', { caseId: sc.nadia, tab: 'meddelanden' }],
  ['samordnare', 'arende.kort', { caseId: sc.elif, tab: 'meddelanden' }], ['coach', 'arende.kort', { caseId: sc.elif, tab: 'rapporter' }],
  ['coach', 'coach.minvecka', {}], ['coach', 'coach.narvaro', { week: 'last' }], ['coach', 'coach.manad', { caseId: sc.nadia, month: '2027-01' }], ['coach', 'coach.manad', { caseId: sc.elif, month: '2027-01' }],
  ['coach', 'coach.kartlaggning', { caseId: sc.amal }], ['coach', 'coach.handelse', { caseId: sc.hodan, mode: 'close' }],
  ['ekonom', 'eko.start', {}], ['ekonom', 'eko.faktura', { month: '2027-01', caseId: sc.nadia }], ['ekonom', 'eko.arende', { caseId: sc.elif }],
  ['samordnare', 'sam.inkorg', { emailId: 'em-101' }], ['samordnare', 'sam.inkorg', { emailId: 'em-102' }], ['samordnare', 'sam.inkorg', { emailId: 'em-105' }], ['samordnare', 'sam.deadlines', {}], ['samordnare', 'sam.start', {}],
  ['kommun_handlaggare', 'kom.start', {}], ['kommun_handlaggare', 'kom.bestall', {}],
  ['kommun_handlaggare', 'kom.deltagare', {}], ['kommun_handlaggare', 'kom.deltagare', { caseId: sc.nadia }], ['kommun_handlaggare', 'kom.deltagare', { caseId: sc.nadia, tab: 'meddelanden' }],
  ['kommun_chef', 'kom.deltagare', { caseId: sc.skyddad }], ['kommun_handlaggare', 'kom.rapporter', {}], ['kommun_chef', 'kom.rapporter', {}], ['kommun_chef', 'kom.chef', {}],
  ['chef', 'chef.oversikt', {}], ['chef', 'chef.oversikt', { tab: 'puls' }], ['chef', 'chef.avvikelser', {}], ['chef', 'chef.avvikelser', { id: 'cd-3' }],
  ['samordnare', 'rapporter.lista', {}], ['samordnare', 'rapport.visa', { reportId: S.nadiaMonthly }], ['samordnare', 'rapport.visa', { reportId: S.cs }], ['samordnare', 'rapport.visa', { reportId: S.weekly }],
  ['kommun_handlaggare', 'rapport.visa', { reportId: S.nadiaMonthly }], ['kommun_chef', 'rapport.visa', { reportId: S.cs }],
];
const sw = () => page.locator('button[title="Prototypfunktion – finns inte i den riktiga tjänsten"]');
for (const [role, view, params] of sources) {
  const pre = await visit(page, role, view, params);
  const n = await sw().count();
  const labels = await sw().allInnerTexts();
  if (n === 0) { console.log(`\n[${role}] ${view} ${JSON.stringify(params)} – INGET perspektivbyte${pre.length ? ' · ' + pre.join('; ') : ''}`); continue; }
  for (let i = 0; i < n; i++) {
    await visit(page, role, view, params);
    const before = await page.evaluate(() => MM.store.state.reports.filter((r) => r.openedAt).length);
    await sw().nth(i).click();
    await page.waitForTimeout(150);
    const res = await page.evaluate(({ params }) => {
      const t = document.querySelector('#main') ? document.querySelector('#main').innerText : '';
      const r = MM.route; const probs = [];
      if (/Den här vyn kunde inte visas/.test(t)) probs.push('Felgräns');
      if (/Ingen åtkomst/.test(t)) probs.push('Ingen åtkomst');
      if (/Du har inte tillgång|inte tillgänglig för dig|Rapporten gäller ett ärende du inte är tilldelad/.test(t)) probs.push('Nekad i vyn');
      if (/Skyddade personuppgifter/.test(t.slice(0, 400))) probs.push('Skyddad-läge');
      const cid = params.caseId; const c = cid ? MM.sel.caseById(cid) : null;
      const sameCase = c ? t.includes(c.number) : null;
      return { route: `${r.role} → ${r.view} ${JSON.stringify(r.params)}`, probs, sameCase, head: t.slice(0, 90).replace(/\n/g, ' ⏎ ') };
    }, { params });
    const after = await page.evaluate(() => MM.store.state.reports.filter((r) => r.openedAt).length);
    console.log(`\n[${role}] ${view} ${JSON.stringify(params)} · knapp ${i + 1}/${n}: "${labels[i].trim()}"\n   → ${res.route}${res.probs.length ? `\n   !! ${res.probs.join(', ')}` : ''}${res.sameCase === false ? '\n   !! ärendenumret syns inte i målvyn' : ''}${after > before ? `\n   !! ${after - before} rapport(er) blev kvitterade av bytet` : ''}\n   ${res.head}`);
  }
}
console.log('\nFEL:', JSON.stringify(errors, null, 1));
await close();
