import { openProto, visit } from './lib.mjs';
const { page, close } = await openProto();
const defs = await page.evaluate(() => Object.values(MM.views).map((v) => ({ id: v.id, role: Array.isArray(v.roles) ? v.roles[0] : 'samordnare' })));
const out = {};
for (const v of defs) {
  await visit(page, v.role, v.id, {}); await page.waitForTimeout(50);
  const r = await page.evaluate(() => { const hs = [...document.querySelectorAll('#main h1, #main h2, #main h3, #main h4')].map((h) => +h.tagName[1]);
    const skips = []; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skips.push(`${hs[i - 1]}→${hs[i]}`);
    const h1 = [...document.querySelectorAll('#main h1')].map((h) => h.innerText.trim().slice(0, 30));
    return { h1, skips: [...new Set(skips)], first: hs[0] }; });
  if (r.h1.length !== 1 || r.skips.length || r.first !== 1) out[`${v.id}@${v.role}`] = r;
}
console.log(JSON.stringify(out, null, 1));
await close();
