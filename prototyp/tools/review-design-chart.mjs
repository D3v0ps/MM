import path from 'node:path';
import { openProto, visit } from './lib.mjs';
const dir = process.argv[2];
const { page, close } = await openProto();
for (const [role, view, params] of [['chef', 'chef.oversikt', {}], ['chef', 'chef.oversikt', { tab: 'puls' }], ['chef', 'chef.oversikt', { tab: 'coacher' }], ['kommun_chef', 'kom.chef', {}], ['coach', 'arende.kort', { caseId: 'X', tab: 'narvaro' }]]) {
  for (const w of [1280, 400]) {
    await page.setViewportSize({ width: w, height: 900 });
    if (params.caseId === 'X') params.caseId = await page.evaluate(() => MM.store.state.script.nadia);
    await visit(page, role, view, params); await page.waitForTimeout(100);
    const r = await page.evaluate(() => [...document.querySelectorAll('#main svg.chart, #main svg')].filter((s) => s.querySelector('text')).map((s) => { const texts = [...s.querySelectorAll('text')]; const hs = texts.map((t) => t.getBoundingClientRect().height).filter((h) => h > 0); return { w: Math.round(s.getBoundingClientRect().width), n: texts.length, minH: Math.min(...hs).toFixed(1), medH: hs.sort((a, b) => a - b)[Math.floor(hs.length / 2)]?.toFixed(1) }; }));
    console.log(view, JSON.stringify(params), w, JSON.stringify(r));
    const svg = page.locator('#main svg.chart').first();
    if (await svg.count() && w === 400) { await svg.scrollIntoViewIfNeeded(); await svg.screenshot({ path: path.join(dir, `chart-${view}-${params.tab || 'x'}-m.png`) }); }
  }
}
await close();
