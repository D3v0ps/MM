// Scenariofältet (Nästa steg/Föregående/Testat/Avsluta) och startsidans Starta-knappar
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s1', { tag: 'bar' });
const { page, S, main, check, note, shot } = T;

await S(() => MM.nav('om.start', {})); await page.waitForTimeout(120);
const scen = await S(() => MM.scenarios().map((s) => ({ id: s.id, n: s.steps.length, title: s.title, steps: s.steps.map((x) => ({ role: x.role, view: x.view, params: x.params })) })));
await check('Startsidan: ett Starta-kort per scenario', async () => { const n = await main.getByRole('button', { name: 'Starta', exact: true }).count(); assert.equal(n, scen.length); return n; });
await check('Startsidan: hjälten "Starta första testscenariot" startar s1', async () => { await main.getByRole('button', { name: 'Starta första testscenariot' }).click(); await page.waitForTimeout(150); const r = await T.route(); assert.equal(r.params.emailId, 'em-101'); });
await check('Scenariofältet: Föregående är inaktiv på steg 1', async () => assert.ok(await T.bar.getByRole('button', { name: /Föregående/ }).isDisabled()));
await check('Scenariofältet: Avsluta döljer fältet', async () => { await T.bar.getByRole('button', { name: 'Avsluta scenariot' }).click(); await page.waitForTimeout(80); assert.equal(await page.locator('.scenbar').count(), 0); });

// Varje scenario: Starta från startsidan, klicka Nästa steg genom alla steg och kontrollera route + inga konsolfel + inga problem i texten
for (const [i, s] of scen.entries()) {
  await S(() => MM.nav('om.start', {})); await page.waitForTimeout(100);
  await main.getByRole('button', { name: 'Starta', exact: true }).nth(i).click(); await page.waitForTimeout(200);
  for (let k = 0; k < s.n; k++) {
    if (k > 0) { await T.bar.getByRole('button', { name: /Nästa steg/ }).click(); await page.waitForTimeout(200); }
    const r = await T.route(); const want = s.steps[k];
    const txt = await T.mainText(); const bt = await T.barText();
    const probs = [];
    if (r.view !== want.view || r.role !== want.role || JSON.stringify(r.params) !== JSON.stringify(want.params)) probs.push(`route ${JSON.stringify(r)} ≠ ${JSON.stringify(want)}`);
    if (!new RegExp(`steg ${k + 1} av ${s.n}`, 'i').test(bt)) probs.push('fel stegnummer i fältet');
    if (/Den här vyn kunde inte visas|Vyn finns inte ännu|Ingen åtkomst|INGEN ÅTKOMST|undefined|NaN|\[object Object\]/.test(txt)) probs.push('problem i vyn: ' + (txt.match(/.{0,40}(kunde inte visas|finns inte ännu|Ingen åtkomst|INGEN ÅTKOMST|undefined|NaN|\[object Object\]).{0,40}/) || [])[0]);
    const errs = T.newErrors(); if (errs.length) probs.push('konsolfel: ' + errs.join(' | '));
    const over = await S(() => document.documentElement.scrollWidth - window.innerWidth); if (over > 1) probs.push(`horisontell scroll ${over}px`);
    if (probs.length) note('FEL', `${s.id} steg ${k + 1}: ${probs.join(' ; ')}`); else note('OK', `${s.id} steg ${k + 1}`);
  }
  const last = await T.bar.getByRole('button', { name: /Feedback på scenariot/ }).count(); if (!last) note('FEL', `${s.id}: sista steget saknar Feedback på scenariot`);
  // Föregående hela vägen tillbaka
  for (let k = s.n - 1; k > 0; k--) { await T.bar.getByRole('button', { name: /Föregående/ }).click(); await page.waitForTimeout(120); }
  const r0 = await T.route(); if (r0.view !== s.steps[0].view || JSON.stringify(r0.params) !== JSON.stringify(s.steps[0].params)) note('FEL', `${s.id}: Föregående tillbaka till steg 1 gav ${JSON.stringify(r0)}`);
}

// Testat → räknaren på startsidan
await check('Testat: markering syns på startsidan', async () => {
  await S(() => MM.startScenario('s4')); await page.waitForTimeout(120); await T.markTested(); await T.bar.getByRole('button', { name: /Nästa steg/ }).click(); await page.waitForTimeout(120); await T.markTested();
  await S(() => MM.nav('om.start', {})); await page.waitForTimeout(120);
  const t = await T.mainText(); const h = (t.match(/TESTSCENARIER \((\d+) av (\d+) steg testade\)/i) || [])[0]; const b = (t.match(/2\/3 testade/) || [])[0]; assert.ok(h && b, t.slice(0, 50)); return `${h} · ${b}`;
});
await check('Testat: avmarkera', async () => { await S(() => MM.startScenario('s4')); await page.waitForTimeout(100); await T.markTested(); const p = await S(() => MM.fb.progress); return p; });

// Mobil 400 px med scenariofältet
await page.setViewportSize({ width: 400, height: 860 });
for (const [sid, k] of [['s1', 1], ['s5', 1], ['s8', 0], ['s3', 1], ['s11', 0]]) {
  await S(({ sid, k }) => MM.startScenario(sid, k), { sid, k }); await page.waitForTimeout(200);
  const over = await S(() => document.documentElement.scrollWidth - window.innerWidth);
  const barH = await S(() => document.querySelector('.scenbar').getBoundingClientRect().height);
  const btns = await S(() => [...document.querySelectorAll('.scenbar button')].map((b) => { const r = b.getBoundingClientRect(); return `${b.innerText.trim() || b.title}:${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)}`; }));
  if (over > 1) note('FEL', `400 px ${sid} steg ${k + 1}: horisontell scroll ${over}px`); else note('OK', `400 px ${sid} steg ${k + 1}: fält ${barH}px högt · ${btns.join(', ')}`);
  await page.screenshot({ path: `${T.SHOTS || '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-scenarier'}/bar-mobil-${sid}.png`, fullPage: false });
}
await T.done();
