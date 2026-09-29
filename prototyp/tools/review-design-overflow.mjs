import path from 'node:path';
import { openProto, visit } from './lib.mjs';
const dir = process.argv[2];
const { page, close } = await openProto();
const sc = await page.evaluate(() => ({ ...MM.store.state.script, oc: (MM.store.state.reports.find((r) => r.caseId === MM.store.state.script.nadia && r.kind === 'order_confirmation') || {}).id }));
const T = [
  ['o-rapport-order-h1', 400, 'kommun_handlaggare', 'rapport.visa', { reportId: sc.oc }, '#main h1'],
  ['o-eko-start-kpi', 400, 'ekonom', 'eko.start', {}, '#main .kpi >> nth=2'],
  ['o-narvaro-persp', 400, 'coach', 'coach.narvaro', { week: 'last' }, 'button:has-text("Se veckorapporten från kundens håll")'],
  ['o-admin-anv-persp', 400, 'avtalsansvarig', 'admin.anvandare', {}, 'button:has-text("Se inloggningen från kundens håll")'],
  ['o-notiser-hand', 400, 'handledare', 'notiser', {}, '#main .list-item >> nth=0'],
  ['o-eko-korning-kpi', 1280, 'ekonom', 'eko.korning', { month: '2027-01' }, '#main .kpi >> nth=1'],
];
for (const [name, w, role, view, params, selr] of T) {
  await page.setViewportSize({ width: w, height: 900 }); await visit(page, role, view, params); await page.waitForTimeout(100);
  const el = page.locator(selr).first(); await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.screenshot({ path: path.join(dir, name + '.png'), clip: { x: 0, y: Math.max(0, b.y - 30), width: w, height: Math.min(500, b.height + 60) } });
  console.log(name, JSON.stringify(b));
}
await close();
