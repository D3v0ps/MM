// Granskning (design): automatisk DOM-kontroll av alla vyer/roller på 1280 och 400 px.
// node tools/review-design-audit.mjs OUT.json
import fs from 'node:fs';
import { openProto, visit } from './lib.mjs';
const out = process.argv[2] || 'audit.json';
const { page, close } = await openProto();
const defs = await page.evaluate(() => {
  const sc = MM.store.state.script; const st = MM.store.state;
  const rep = (tag, kind, month) => (st.reports.find((r) => r.caseId === sc[tag] && r.kind === kind && (!month || r.month === month)) || {}).id;
  const ci = (st.checkIns.find((x) => x.caseId === sc.mehmet && x.ai) || {}).id;
  const P = {
    'arende.kort': [{ caseId: sc.nadia }, { caseId: sc.yusuf, tab: 'avvikelser' }, { caseId: sc.skyddad }, { caseId: sc.nadia, tab: 'narvaro' }, { caseId: sc.nadia, tab: 'manad' }, { caseId: sc.nadia, tab: 'rapporter' }, { caseId: sc.nadia, tab: 'meddelanden' }, { caseId: sc.nadia, tab: 'historik' }, { caseId: sc.nadia, tab: 'praktik' }, { caseId: sc.nadia, tab: 'handelser' }, { caseId: sc.nadia, tab: 'avstamningar' }, { caseId: sc.nadia, tab: 'kartlaggning' }],
    'coach.avstamning': [{ caseId: sc.yusuf }, { caseId: sc.mehmet, checkInId: ci }],
    'coach.manad': [{ caseId: sc.nadia, month: '2027-01' }], 'coach.kartlaggning': [{ caseId: sc.amal }], 'coach.handelse': [{ caseId: sc.hodan }, { caseId: sc.hodan, mode: 'close' }],
    'rapport.visa': [{ reportId: rep('nadia', 'monthly', '2027-01') }, { reportId: rep('slutsen', 'final') }, { reportId: st.reports.find((r) => r.kind === 'weekly_attendance' && r.week === '2027-W04' && r.recipientUserId === 'k-maria').id }, { reportId: st.reports.find((r) => r.kind === 'customer_summary' && r.month === '2026-12').id }, { reportId: rep('nadia', 'order_confirmation') }],
    'eko.korning': [{ month: '2027-01' }], 'eko.faktura': [{ month: '2027-01', caseId: sc.nadia }], 'eko.arende': [{ caseId: sc.nadia }],
    'kom.deltagare': [{}, { caseId: sc.nadia }, { caseId: sc.yusuf }, { caseId: sc['inkorg-mall'] }], 'sam.inkorg': [{}, { emailId: 'em-101' }, { emailId: 'em-102' }, { emailId: 'em-103' }, { emailId: 'em-104' }, { emailId: 'em-105' }], 'admin.avtal': [{}, { contract: 'c-kk' }, { tab: 'interna' }], 'chef.oversikt': [{}, { tab: 'puls' }, { tab: 'coacher' }, { tab: 'omraden' }],
    'coach.narvaro': [{}, { week: 'last' }], 'admin.mallar': [{}, { tab: 'logg' }], 'arenden.lista': [{}, { filter: 'skyddade' }],
  };
  return Object.values(MM.views).map((v) => ({ id: v.id, roles: Array.isArray(v.roles) ? v.roles : MM.ROLES.map((r) => r.key), params: P[v.id] || [{}] }));
});
const results = [];
for (const v of defs) {
  for (const role of v.roles) {
    for (const params of v.params) {
      for (const w of [1280, 400]) {
        await page.setViewportSize({ width: w, height: w === 400 ? 860 : 900 });
        await visit(page, role, v.id, params);
        await page.waitForTimeout(60);
        const r = await page.evaluate(({ w }) => {
          const main = document.querySelector('#main'); if (!main) return {};
          const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          const sig = (el) => { const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 50); return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} "${t}"`; };
          const res = { unlabeled: [], small: [], redSmall: [], whiteOnRed: [], blueText: [], overflow: [], portalSmall: {}, badText: [], noName: [] };
          // 1. formulärfält utan etikett
          main.querySelectorAll('input, select, textarea').forEach((el) => {
            if (el.type === 'hidden' || !vis(el)) return;
            const id = el.id; const hasFor = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
            const wrap = el.closest('label'); const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
            if (!hasFor && !wrap && !aria) res.unlabeled.push(sig(el) + (el.placeholder ? ` placeholder="${el.placeholder}"` : '') + ` type=${el.type || ''}`);
          });
          // 2. klickytor under 44 px + knappar utan namn
          main.querySelectorAll('button, a[href], [role="button"], summary, [tabindex="0"], input[type="checkbox"], input[type="radio"]').forEach((el) => {
            if (!vis(el)) return; const b = el.getBoundingClientRect();
            let tb = b; if (el.matches('input[type="checkbox"], input[type="radio"]')) { const l = el.closest('label'); if (l) tb = l.getBoundingClientRect(); }
            if (tb.height < 43.5 || tb.width < 43.5) res.small.push(`${sig(el)} ${Math.round(tb.width)}x${Math.round(tb.height)}`);
            const name = (el.innerText || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || (el.querySelector('[aria-label]') && el.querySelector('[aria-label]').getAttribute('aria-label'));
            if (!name && el.tagName !== 'INPUT') res.noName.push(sig(el));
          });
          // 3. färg och storlek på text
          const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
          const bgOf = (el) => { let e = el; while (e && e !== document.documentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
          const isRed = (c) => c && c.r > 230 && c.g < 40 && c.b < 40; const isBlue = (c) => c && Math.abs(c.r - 107) < 12 && Math.abs(c.g - 162) < 12 && Math.abs(c.b - 185) < 12;
          const isWhite = (c) => c && c.r > 245 && c.g > 245 && c.b > 245;
          const portal = !!document.querySelector('.portal');
          const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
          const seen = new Set();
          while (walker.nextNode()) {
            const tn = walker.currentNode; const txt = tn.textContent.replace(/\s+/g, ' ').trim(); if (!txt) continue;
            const el = tn.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el);
            if (el.closest('.sr-only, svg, .paper')) { /* rapportpapper granskas separat */ }
            const s = getComputedStyle(el); const fs = parseFloat(s.fontSize); const fw = parseInt(s.fontWeight, 10) || 400; const col = parse(s.color); const bg = bgOf(el);
            const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
            if (isRed(col) && !large && col.a > 0.5) res.redSmall.push(`${sig(el)} ${fs}px/${fw}`);
            if (isWhite(col) && isRed(bg) && !large) res.whiteOnRed.push(`${sig(el)} ${fs}px/${fw}`);
            if (isBlue(col) && col.a > 0.5 && (isWhite(bg))) res.blueText.push(`${sig(el)} ${fs}px`);
            if (portal && !el.closest('.protobar, .scenbar, .fb-fab, .drawer, .paper') && fs < 17.5) { const k = `${Math.round(fs * 10) / 10}px`; (res.portalSmall[k] = res.portalSmall[k] || []).length < 6 && res.portalSmall[k].push(txt.slice(0, 60)); }
          }
          // 4. överflöde: text som går utanför sin låda eller kortet
          main.querySelectorAll('.btn, .badge, .kpi-label, .kpi-value, .card-title, .tab, h1, h2, h3, .status, .sla, .ai-tag, td, th, .li-title, dd, dt, label').forEach((el) => {
            if (!vis(el)) return; const s = getComputedStyle(el);
            if (el.scrollWidth > el.clientWidth + 2 && s.overflowX === 'visible' && el.clientWidth > 0) res.overflow.push(`${sig(el)} scroll=${el.scrollWidth} client=${el.clientWidth}`);
            const card = el.parentElement && el.parentElement.closest('.card, .kpi, .notice, .list-item, .rolecard, .modal');
            if (card && !el.closest('.table-wrap, .tabs, [style*="overflow"]')) { const b = el.getBoundingClientRect(); const cb = card.getBoundingClientRect(); if (b.right > cb.right + 2) res.overflow.push(`${sig(el)} går ${Math.round(b.right - cb.right)}px utanför ${card.className.split(' ')[0]}`); }
          });
          // tabeller som scrollar i sidled
          main.querySelectorAll('.table-wrap').forEach((el) => { if (vis(el) && el.scrollWidth > el.clientWidth + 2) res.overflow.push(`table-wrap scrollar i sidled: ${el.scrollWidth}>${el.clientWidth} (${(el.querySelector('th') || {}).innerText || ''}…)`); });
          // 5. konstiga värden
          const t = main.innerText;
          const bad = t.match(/.{0,40}\b(null|undefined|NaN|Invalid Date|\[object Object\]|ATT_FASTSTÄLLA)\b.{0,40}/g); if (bad) res.badText.push(...bad);
          const empt = t.match(/.{0,30}(:\s*$|:\s+·|\(\s*\)|kr\s*$).{0,20}/gm); if (empt) res.badText.push(...empt.slice(0, 5).map((x) => 'tomt? ' + x));
          return res;
        }, { w });
        results.push({ view: v.id, role, params, w, ...r });
      }
    }
  }
}
fs.writeFileSync(out, JSON.stringify(results, null, 1));
await close();
console.log('klar', results.length);
