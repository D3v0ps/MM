// Granskning (design): skärmdumpar av fokusmarkering på olika kontroller.
import path from 'node:path';
import { openProto, visit } from './lib.mjs';
const dir = process.argv[2];
const { page, close } = await openProto();
const shot = async (name, locator, pad = 12) => {
  await locator.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  const b = await locator.boundingBox(); if (!b) return console.log(name, 'ingen box');
  const f = await page.evaluate(() => document.activeElement.outerHTML.slice(0, 80));
  await page.screenshot({ path: path.join(dir, `f-${name}.png`), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(1280, b.width + 2 * pad), height: b.height + 2 * pad } });
  console.log(name, f);
};
await visit(page, 'ekonom', 'eko.korning', { month: '2027-01' });
await shot('tabellrad', page.locator('tr.clickable').nth(2));
await visit(page, 'samordnare', 'sam.inkorg', {});
await shot('inkorgsrad', page.locator('button.ink-row').nth(1));
await shot('sidomeny', page.locator('.sidebar .nav-item').nth(2));
await shot('flik', page.getByRole('tab').nth(1));
await visit(page, 'kommun_handlaggare', 'kom.start', {});
await shot('portal-bigbtn', page.locator('.bigbtn').first());
await shot('portal-meny', page.locator('.portal-header nav button').nth(1));
await visit(page, 'coach', 'coach.avstamning', { caseId: await page.evaluate(() => MM.store.state.script.yusuf) });
await shot('seg', page.locator('.seg button').nth(2));
await visit(page, 'samordnare', 'om.start', {});
await shot('hero-knapp', page.locator('.hero .btn').first());
await visit(page, 'deltagare', 'puls.svar', {});
await shot('puls-sprak', page.locator('.pulse-phone .seg button').nth(1));
await close();
