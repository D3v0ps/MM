// Hjälpare för Playwright-tester av prototypen (ingen nätverksåtkomst behövs – CDN-biblioteket serveras lokalt).
// Användning:
//   import { openProto } from './tools/lib.mjs';
//   const { page, errors, close } = await openProto();           // bygger till en temporär fil
//   await page.evaluate(() => MM.setRole('coach'));               // byt roll
//   await page.evaluate(() => MM.nav('coach.minvecka', {}));      // navigera
//   await page.getByRole('button', { name: 'Acceptera' }).click();
//   console.log(errors); await close();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function openProto({ width = 1280, height = 900, htmlPath = null, clearStorage = true } = {}) {
  let file = htmlPath;
  if (!file) {
    file = path.join(os.tmpdir(), `mm-proto-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs'), '--out', file], { stdio: 'pipe' });
  }
  const html = fs.readFileSync(file, 'utf8');
  const lib = fs.readFileSync(path.join(root, 'tools', 'htm-preact.js'), 'utf8');
  const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  const context = await browser.newContext({ viewport: { width, height }, locale: 'sv-SE' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('http://proto.test/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (url.includes('htm@3.1.1/preact/standalone.umd.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: lib });
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.abort();
  });
  await page.goto('http://proto.test/index.html');
  if (clearStorage) { await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} }); await page.reload(); }
  await page.waitForFunction(() => window.MM && MM.store && MM.store.state && document.querySelector('.protobar'), null, { timeout: 15000 });
  const close = async () => { await browser.close(); if (!htmlPath) try { fs.unlinkSync(file); } catch (e) {} };
  return { browser, context, page, errors, close, file };
}
/** Navigera som roll och vänta tills vyn renderats. Returnerar synliga felrutor. */
export async function visit(page, role, view, params = {}) {
  await page.evaluate(({ role, view, params }) => MM.nav(view, params, { role }), { role, view, params });
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const t = document.querySelector('#main') ? document.querySelector('#main').innerText : '';
    const problems = [];
    if (/Den här vyn kunde inte visas/.test(t)) problems.push('Felgräns: ' + (t.match(/\(([^)]*)\)/) || [])[1]);
    if (/Vyn finns inte ännu/.test(t)) problems.push('Vyn saknas');
    if (/Ingen åtkomst/.test(t)) problems.push('Ingen åtkomst för rollen');
    if (/undefined|NaN|\[object Object\]/.test(t)) problems.push('Texten innehåller undefined/NaN/[object Object]: ' + (t.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]);
    return problems;
  });
}
