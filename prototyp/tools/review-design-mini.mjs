import { openProto, visit } from './lib.mjs';
const { page, close } = await openProto();
for (const [role, w] of [['samordnare', 1280], ['avtalsansvarig', 1280], ['samordnare', 1024]]) {
  await page.setViewportSize({ width: w, height: 900 });
  await visit(page, role, 'sam.start', {});
  console.log(role, w, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ink-mini-row')].map((r) => { const l = r.querySelector('.ink-l'); const m = r.querySelector('.ink-m'); if (!l || !m) return null; const lb = l.firstElementChild ? l.firstElementChild.getBoundingClientRect() : l.getBoundingClientRect(); const mb = m.getBoundingClientRect(); return lb.right > mb.left + 1 && Math.abs(lb.top - mb.top) < mb.height ? `${l.innerText.trim()} överlappar "${m.innerText.split('\n')[0].slice(0, 40)}" med ${Math.round(lb.right - mb.left)}px` : null; }).filter(Boolean))));
}
await page.setViewportSize({ width: 1280, height: 900 });
await visit(page, 'kommun_handlaggare', 'kom.start', {});
console.log('portalhuvud', await page.evaluate(() => Math.round(document.querySelector('.portal-header').getBoundingClientRect().height)));
await visit(page, 'kommun_chef', 'kom.chef', {});
console.log('portalhuvud chef', await page.evaluate(() => Math.round(document.querySelector('.portal-header').getBoundingClientRect().height)));
await close();
