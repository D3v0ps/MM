import path from 'node:path';
import { openProto, visit } from './lib.mjs';
const dir = process.argv[2];
const { page, close } = await openProto();
const full = async (name) => { await page.waitForTimeout(150); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
for (const w of [1280, 400]) {
  await page.setViewportSize({ width: w, height: 900 });
  const s = w === 400 ? 'm' : 'd';
  await visit(page, 'kommun_handlaggare', 'kom.login', {});
  await page.fill('#main input[type=email]', 'maria.ekdahl@botkyrka.se'); await page.getByRole('button', { name: 'Skicka kod' }).click(); await full(`p-login2-${s}`);
  await visit(page, 'kommun_handlaggare', 'kom.bestall', {});
  await page.fill('#kom-o-ref', '123'); await page.getByRole('button', { name: /Nästa/ }).click(); await full(`p-bestall1-fel-${s}`);
  await page.fill('#kom-o-ref', '4410023817'); await page.getByRole('button', { name: '8', exact: true }).click(); await page.getByRole('button', { name: /Nästa/ }).click(); await full(`p-bestall2-${s}`);
  // fyll deltagare
  const txt = await page.evaluate(() => [...document.querySelectorAll('#main input, #main select, #main textarea')].map((e) => `${e.id}:${e.type}`).join(' '));
  console.log('steg2 fält', txt);
  await page.getByRole('button', { name: /Nästa/ }).click(); await full(`p-bestall2-fel-${s}`);
}
await close();
