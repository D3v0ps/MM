// Gemensamma hjälpare för granskningen "scenarier" (tools/review-scenarier-sN.mjs).
import fs from 'node:fs';
import { openProto } from './lib.mjs';
export const SHOTS = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-scenarier';
fs.mkdirSync(SHOTS, { recursive: true });

export async function setup(sid, opts = {}) {
  const tag = opts.tag || sid; delete opts.tag;
  const proto = await openProto(opts);
  const { page, errors } = proto;
  const S = (fn, arg) => page.evaluate(fn, arg);
  const main = page.locator('#main');
  const bar = page.locator('.scenbar');
  const dialog = page.getByRole('dialog').last();
  const log = [];
  let stepNo = 0; let errMark = 0;
  const note = (kind, msg) => { log.push({ step: stepNo, kind, msg }); console.log(`${kind === 'OK' ? 'OK  ' : kind === 'FEL' ? 'FEL ' : 'OBS '} [${sid} steg ${stepNo}] ${msg}`); };
  const check = async (name, fn) => {
    try { const r = await fn(); note('OK', name + (r !== undefined && r !== true ? ` → ${typeof r === 'string' ? r : JSON.stringify(r)}` : '')); return r; }
    catch (e) { note('FEL', `${name}: ${String(e && e.message || e).split('\n').slice(0, 4).join(' | ')}`); return undefined; }
  };
  const shot = async (name, full = true) => { const p = `${SHOTS}/${tag}-${name}.png`; await page.screenshot({ path: p, fullPage: full }); return p; };
  const newErrors = () => { const e = errors.slice(errMark); errMark = errors.length; return e; };
  const route = () => S(() => JSON.parse(JSON.stringify(MM.route)));
  const barText = async () => (await bar.count()) ? bar.innerText() : '';
  /** Starta scenariot från startsidan via knappen Starta (som en människa). */
  const startFromHome = async () => {
    await S(() => MM.nav('om.start', {}));
    await page.waitForTimeout(150);
    const idx = await S((id) => MM.scenarios().findIndex((s) => s.id === id), sid);
    if (idx < 0) throw new Error('Okänt scenario ' + sid);
    const cards = main.locator('.card').filter({ has: page.getByRole('button', { name: 'Starta', exact: true }) });
    await cards.nth(idx).getByRole('button', { name: 'Starta', exact: true }).click();
    await page.waitForTimeout(250);
    stepNo = 1;
    const errs = newErrors(); if (errs.length) note('FEL', 'Konsolfel vid start: ' + errs.join(' | '));
    return route();
  };
  /** Klicka Nästa steg i scenariofältet. */
  const next = async () => {
    await bar.getByRole('button', { name: /Nästa steg/ }).click();
    await page.waitForTimeout(250);
    stepNo++;
    const errs = newErrors(); if (errs.length) note('FEL', 'Konsolfel: ' + errs.join(' | '));
    return route();
  };
  const prev = async () => { await bar.getByRole('button', { name: /Föregående/ }).click(); await page.waitForTimeout(250); stepNo--; return route(); };
  const markTested = async () => { await bar.getByRole('button', { name: /Testat/ }).click(); await page.waitForTimeout(80); };
  const endStep = async () => { const errs = newErrors(); if (errs.length) note('FEL', 'Konsolfel: ' + errs.join(' | ')); };
  const mainText = () => main.innerText();
  const expectStep = async (n) => { const t = await barText(); if (!new RegExp(`steg ${n} av`, 'i').test(t)) note('FEL', `Scenariofältet visar inte steg ${n}: ${t.slice(0, 120)}`); };
  const done = async () => {
    await endStep();
    fs.writeFileSync(`${SHOTS}/${tag}-log.json`, JSON.stringify(log, null, 1));
    const fails = log.filter((x) => x.kind === 'FEL').length;
    console.log(`\n${sid}: ${log.filter((x) => x.kind === 'OK').length} OK, ${fails} FEL, ${log.filter((x) => x.kind === 'OBS').length} OBS`);
    await proto.close();
  };
  return { ...proto, S, main, bar, dialog, check, note, shot, newErrors, route, barText, startFromHome, next, prev, markTested, endStep, mainText, expectStep, done, setStep: (n) => { stepNo = n; } };
}
