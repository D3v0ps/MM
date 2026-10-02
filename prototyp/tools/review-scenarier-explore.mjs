// Utforskning: gå igenom alla scenariosteg och dumpa text + knappar.
import fs from 'node:fs';
import { openProto } from './lib.mjs';
const OUT = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-scenarier/explore';
fs.mkdirSync(OUT, { recursive: true });
const { page, errors, close } = await openProto();
const scen = await page.evaluate(() => MM.scenarios().map((s) => ({ id: s.id, n: s.steps.length, steps: s.steps })));
fs.writeFileSync(OUT + '/scenarios.json', JSON.stringify(scen, null, 1));
for (const s of scen) {
  await page.evaluate((id) => MM.startScenario(id), s.id);
  await page.waitForTimeout(200);
  for (let i = 0; i < s.n; i++) {
    if (i > 0) { await page.evaluate((i) => MM.gotoStep(i), i); await page.waitForTimeout(200); }
    const info = await page.evaluate(() => ({ route: MM.route, text: document.querySelector('#main').innerText, buttons: [...document.querySelectorAll('#main button, #main a, #main select, #main input, #main textarea')].map((b) => `${b.tagName}#${b.id}[${b.getAttribute('aria-label') || ''}] ${b.innerText || b.value || b.placeholder || ''}`.slice(0, 120)) }));
    fs.writeFileSync(`${OUT}/${s.id}-${i + 1}.txt`, `ROUTE ${JSON.stringify(info.route)}\nSTEG: ${s.steps[i].text}\n\n${info.text}\n\n---CONTROLS---\n${info.buttons.join('\n')}\n`);
    await page.screenshot({ path: `${OUT}/${s.id}-${i + 1}.png`, fullPage: true });
  }
}
fs.writeFileSync(OUT + '/errors.txt', errors.join('\n'));
console.log('errors', errors.length, errors.slice(0, 20));
await close();
