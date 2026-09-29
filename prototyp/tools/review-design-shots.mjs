// Granskning (design): skärmdumpar i bitar för läsning. node tools/review-design-shots.mjs OUTDIR [filter]
import fs from 'node:fs';
import path from 'node:path';
import { openProto, visit } from './lib.mjs';
const out = process.argv[2]; const filter = process.argv[3] || null;
fs.mkdirSync(out, { recursive: true });
const { page, errors, close } = await openProto();
const targets = await page.evaluate(() => {
  const sc = MM.store.state.script; const st = MM.store.state;
  const rep = (tag, kind, month) => (st.reports.find((r) => r.caseId === sc[tag] && r.kind === kind && (!month || r.month === month)) || {}).id;
  const ci = (st.checkIns.find((x) => x.caseId === sc.mehmet && x.ai) || {}).id;
  const wk = (st.reports.find((r) => r.kind === 'weekly_attendance' && r.week === '2027-W04' && r.recipientUserId === 'k-maria') || {}).id;
  const cs = (st.reports.find((r) => r.kind === 'customer_summary' && r.month === '2026-12') || {}).id;
  const T = [
    ['om.start', 'samordnare', 'om.start', {}],
    ['om.feedback', 'samordnare', 'om.feedback', {}],
    ['om.fragor', 'admin', 'om.fragor', {}],
    ['s1-inkorg-em101', 'samordnare', 'sam.inkorg', { emailId: 'em-101' }],
    ['s1-kom-deltagare-mall', 'kommun_handlaggare', 'kom.deltagare', { caseId: sc['inkorg-mall'] }],
    ['s2-inkorg-em102', 'samordnare', 'sam.inkorg', { emailId: 'em-102' }],
    ['s2-inkorg-em103', 'samordnare', 'sam.inkorg', { emailId: 'em-103' }],
    ['s2-mallar-logg', 'admin', 'admin.mallar', { tab: 'logg' }],
    ['s3-kom-login', 'kommun_handlaggare', 'kom.login', {}],
    ['s3-kom-bestall', 'kommun_handlaggare', 'kom.bestall', {}],
    ['s3-inkorg', 'samordnare', 'sam.inkorg', {}],
    ['s4-minvecka', 'coach', 'coach.minvecka', {}],
    ['s4-narvaro-last', 'coach', 'coach.narvaro', { week: 'last' }],
    ['s4-kom-rapporter', 'kommun_handlaggare', 'kom.rapporter', {}],
    ['s5-avst-yusuf', 'coach', 'coach.avstamning', { caseId: sc.yusuf }],
    ['s5-kort-yusuf-avv', 'coach', 'arende.kort', { caseId: sc.yusuf, tab: 'avvikelser' }],
    ['s5-kom-deltagare-yusuf', 'kommun_handlaggare', 'kom.deltagare', { caseId: sc.yusuf }],
    ['s6-avst-mehmet-ai', 'coach', 'coach.avstamning', { caseId: sc.mehmet, checkInId: ci }],
    ['s7-manad-nadia', 'coach', 'coach.manad', { caseId: sc.nadia, month: '2027-01' }],
    ['s7-rapport-nadia', 'coach', 'rapport.visa', { reportId: rep('nadia', 'monthly', '2027-01') }],
    ['s8-korning', 'ekonom', 'eko.korning', { month: '2027-01' }],
    ['s9-chef-oversikt', 'chef', 'chef.oversikt', {}],
    ['s9-chef-avvikelser', 'chef', 'chef.avvikelser', {}],
    ['s9-kom-chef', 'kommun_chef', 'kom.chef', {}],
    ['s10-eko-start', 'ekonom', 'eko.start', {}],
    ['s10-hand-start', 'handledare', 'hand.start', {}],
    ['s10-lista-skyddade-avtal', 'avtalsansvarig', 'arenden.lista', { filter: 'skyddade' }],
    ['s10-lista-skyddade-sam', 'samordnare', 'arenden.lista', { filter: 'skyddade' }],
    ['s10-admin-logg', 'admin', 'admin.logg', {}],
    ['s11-puls', 'deltagare', 'puls.svar', {}],
    ['s11-chef-puls', 'chef', 'chef.oversikt', { tab: 'puls' }],
    ['s13-inkorg-em106', 'samordnare', 'sam.inkorg', { emailId: 'em-106' }],
    ['s13-notiser-coach', 'coach', 'notiser', {}],
    ['s13-notiser-chef', 'chef', 'notiser', {}],
    ['s13-admin-interna', 'admin', 'admin.avtal', { tab: 'interna' }],
    ['s12-admin-avtal', 'admin', 'admin.avtal', {}],
    ['s12-admin-kk', 'admin', 'admin.avtal', { contract: 'c-kk' }],
    ['x-chef-coacher', 'chef', 'chef.oversikt', { tab: 'coacher' }],
    ['x-chef-omraden', 'chef', 'chef.oversikt', { tab: 'omraden' }],
    ['x-chef-kpi', 'chef', 'chef.oversikt', { tab: 'kpi' }],
    ['x-sam-start', 'samordnare', 'sam.start', {}],
    ['x-sam-deadlines', 'samordnare', 'sam.deadlines', {}],
    ['x-kort-nadia', 'samordnare', 'arende.kort', { caseId: sc.nadia }],
    ['x-kort-nadia-coach', 'coach', 'arende.kort', { caseId: sc.nadia }],
    ['x-kort-skyddad-avtal', 'avtalsansvarig', 'arende.kort', { caseId: sc.skyddad }],
    ['x-lista-chef', 'chef', 'arenden.lista', {}],
    ['x-rapporter-chef', 'chef', 'rapporter.lista', {}],
    ['x-rapport-slut', 'samordnare', 'rapport.visa', { reportId: rep('slutsen', 'final') }],
    ['x-rapport-vecka-kom', 'kommun_handlaggare', 'rapport.visa', { reportId: wk }],
    ['x-rapport-bestallar-kom', 'kommun_chef', 'rapport.visa', { reportId: cs }],
    ['x-rapport-order-kom', 'kommun_handlaggare', 'rapport.visa', { reportId: rep('nadia', 'order_confirmation') }],
    ['x-rapport-nadia-kom', 'kommun_handlaggare', 'rapport.visa', { reportId: rep('nadia', 'monthly', '2027-01') }],
    ['x-eko-faktura', 'ekonom', 'eko.faktura', { month: '2027-01', caseId: sc.nadia }],
    ['x-eko-arende', 'ekonom', 'eko.arende', { caseId: sc.nadia }],
    ['x-kom-start', 'kommun_handlaggare', 'kom.start', {}],
    ['x-kom-deltagare', 'kommun_handlaggare', 'kom.deltagare', {}],
    ['x-kom-deltagare-chef', 'kommun_chef', 'kom.deltagare', {}],
    ['x-kom-rapporter-chef', 'kommun_chef', 'kom.rapporter', {}],
    ['x-admin-anv', 'admin', 'admin.anvandare', {}],
    ['x-admin-int', 'admin', 'admin.integrationer', {}],
    ['x-admin-mallar', 'admin', 'admin.mallar', {}],
    ['x-praktik', 'coach', 'praktik.arbetsgivare', {}],
    ['x-kartl-amal', 'coach', 'coach.kartlaggning', { caseId: sc.amal }],
    ['x-handelse-hodan', 'coach', 'coach.handelse', { caseId: sc.hodan }],
    ['x-handelse-close', 'coach', 'coach.handelse', { caseId: sc.hodan, mode: 'close' }],
    ['x-narvaro-this', 'coach', 'coach.narvaro', {}],
    ['x-narvaro-hand', 'handledare', 'coach.narvaro', {}],
    ['x-notiser-hand', 'handledare', 'notiser', {}],
    ['x-rapporter-coach', 'coach', 'rapporter.lista', {}],
    ['x-avvikelse-id', 'chef', 'chef.avvikelser', { id: (st.contractDeviations || [])[0] && st.contractDeviations[0].id }],
  ];
  return T.map(([name, role, view, params]) => ({ name, role, view, params }));
});
const CH = 1000;
for (const t of targets) {
  if (filter && !t.name.includes(filter)) continue;
  for (const [w, suffix] of [[1280, 'd'], [400, 'm']]) {
    await page.setViewportSize({ width: w, height: 900 });
    const before = errors.length;
    const probs = await visit(page, t.role, t.view, t.params);
    await page.waitForTimeout(100);
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    const SW = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w === 1280) {
      const n = Math.ceil(H / CH);
      for (let i = 0; i < n; i++) {
        const h = Math.min(CH, H - i * CH);
        await page.screenshot({ path: path.join(out, `${t.name}__${suffix}${i + 1}.png`), fullPage: true, clip: { x: 0, y: i * CH, width: w, height: h } });
      }
      console.log(`${t.name} ${suffix} h=${H} parts=${n} ${probs.join(';')} ${errors.slice(before).join(';')}`);
    } else {
      // Mobil: klipp i 1500 px höga remsor och lägg upp till 3 bredvid varandra i en bild.
      const MH = 1500; const n = Math.ceil(H / MH); const bufs = [];
      for (let i = 0; i < n; i++) {
        const h = Math.min(MH, H - i * MH);
        bufs.push((await page.screenshot({ fullPage: true, clip: { x: 0, y: i * MH, width: Math.max(w, SW), height: h } })).toString('base64'));
      }
      const ctx = page.context(); const p2 = await ctx.newPage();
      for (let g = 0; g < bufs.length; g += 3) {
        const grp = bufs.slice(g, g + 3);
        await p2.setViewportSize({ width: 3 * (Math.max(w, SW) + 12), height: MH + 30 });
        await p2.setContent(`<html><body style="margin:0;background:#888;display:flex;gap:12px;align-items:flex-start;font:12px sans-serif">${grp.map((b, k) => `<div><div style="color:#fff">del ${g + k + 1}/${bufs.length}</div><img src="data:image/png;base64,${b}" style="display:block"></div>`).join('')}</body></html>`);
        await p2.waitForTimeout(50);
        await p2.screenshot({ path: path.join(out, `${t.name}__${suffix}${g / 3 + 1}.png`), fullPage: true });
      }
      await p2.close();
      console.log(`${t.name} ${suffix} h=${H} sw=${SW} strips=${n} ${probs.join(';')} ${errors.slice(before).join(';')}`);
    }
  }
}
await close();
