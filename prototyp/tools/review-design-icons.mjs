import { openProto, visit } from './lib.mjs';
const { page, close } = await openProto();
await page.evaluate(() => { const orig = MM.iconSvg; window.__miss = {}; MM.iconSvg = (n, c) => { if (!MM.iconNames.includes(n)) window.__miss[n] = (window.__miss[n] || 0) + 1; return orig(n, c); }; });
const defs = await page.evaluate(() => { const sc = MM.store.state.script; return Object.values(MM.views).map((v) => ({ id: v.id, roles: Array.isArray(v.roles) ? v.roles : MM.ROLES.map((r) => r.key), params: v.id === 'arende.kort' ? ['oversikt','kartlaggning','avstamningar','narvaro','manad','handelser','avvikelser','praktik','rapporter','meddelanden','historik'].map((tab) => ({ caseId: sc.nadia, tab })) : v.id === 'kom.deltagare' ? [{}, { caseId: sc.nadia }] : [{}] })); });
const where = {};
for (const v of defs) for (const role of v.roles) for (const params of v.params) { const before = await page.evaluate(() => JSON.stringify(window.__miss)); await visit(page, role, v.id, params); const after = await page.evaluate(() => window.__miss); for (const k of Object.keys(after)) if (!JSON.parse(before)[k] || JSON.parse(before)[k] !== after[k]) (where[k] = where[k] || new Set()).add(`${v.id}@${role}`); }
for (const [k, v] of Object.entries(where)) console.log(k, [...v].slice(0, 6).join(', '));
await close();
