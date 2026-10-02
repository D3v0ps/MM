// Granskning (design): tangentbord, fokus och Escape. node tools/review-design-keys.mjs SHOTDIR
import fs from 'node:fs';
import path from 'node:path';
import { openProto, visit } from './lib.mjs';
const dir = process.argv[2]; fs.mkdirSync(dir, { recursive: true });
const { page, errors, close } = await openProto();
const log = (...a) => console.log(...a);
const focusInfo = () => page.evaluate(() => {
  const el = document.activeElement; if (!el || el === document.body) return { tag: 'body', outline: 'body', shadow: false };
  const s = getComputedStyle(el); const b = el.getBoundingClientRect();
  const tb = document.querySelector('.topbars'); const tbb = tb ? tb.getBoundingClientRect().bottom : 0;
  const obscuredByBar = b.bottom <= tbb + 2 && b.top < tbb; const partly = b.top < tbb - 1;
  const fab = document.querySelector('.fb-fab'); const fb = fab ? fab.getBoundingClientRect() : null;
  const underFab = fb && el !== fab && !(b.right < fb.left || b.left > fb.right || b.bottom < fb.top || b.top > fb.bottom);
  return { tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 40), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, shadow: s.boxShadow !== 'none', w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), barBottom: Math.round(tbb), obscuredByBar, partly, underFab: !!underFab,
    visible: b.width > 2 && b.height > 2 };
});

// 1. Första Tab på sidan: hoppa-länken
await visit(page, 'samordnare', 'sam.inkorg', {});
await page.reload(); await page.waitForFunction(() => window.MM && document.querySelector('.protobar'));
await page.keyboard.press('Tab');
log('1. Första Tab:', JSON.stringify(await focusInfo()));
await page.screenshot({ path: path.join(dir, 'k1-forsta-tab.png') });

// 2. Tabba igenom inkorgen och kontrollera synligt fokus + om fokus hamnar under topplisten eller feedbackknappen
await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-101' });
await page.reload(); await page.waitForFunction(() => window.MM && document.querySelector('.protobar'));
const seen = []; let noOutline = [];
for (let i = 0; i < 70; i++) { await page.keyboard.press('Tab'); const f = await focusInfo(); seen.push(f); if (f.outline.startsWith('none') && !f.shadow) noOutline.push(f); }
log('2. Inkorg: fokus utan synlig ram:', JSON.stringify(noOutline.slice(0, 10)));
log('   under feedbackknappen:', JSON.stringify(seen.filter((f) => f.underFab).slice(0, 5)));
// Shift+Tab tillbaka uppåt: hamnar fokus under den klistrade topplisten?
const back = []; for (let i = 0; i < 40; i++) { await page.keyboard.press('Shift+Tab'); const f = await focusInfo(); if (f.partly) back.push(f); }
log('   Shift+Tab – fokus helt/delvis under topplisten:', back.length, JSON.stringify(back.slice(0, 4)));
if (back.length) await page.screenshot({ path: path.join(dir, 'k2-fokus-under-topplist.png') });

// 3. Enter på ett mejl i listan (tangentbord)
await visit(page, 'samordnare', 'sam.inkorg', {});
const item = page.locator('button.ink-row').nth(1); await item.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
log('3. Enter på mejl 2 → vald:', await page.evaluate(() => (document.querySelector('.ink-row.is-active') || {}).innerText?.split('\n')[0]));

// 4. Acceptera-modal: öppna med tangentbord, Escape stänger, fokus tillbaka
await visit(page, 'samordnare', 'sam.inkorg', { emailId: 'em-101' });
const acc = page.getByRole('button', { name: /^Acceptera$/ }).first(); await acc.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
log('4. Modal öppen:', await page.locator('.modal').count(), 'fokus i modal:', await page.evaluate(() => !!document.activeElement.closest('.modal')), JSON.stringify(await focusInfo()));
await page.screenshot({ path: path.join(dir, 'k4-acceptera-modal.png') });
// fokusfälla? tabba 40 gånger och se om fokus lämnar modalen
let left = 0; for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('.modal')))) left++; }
log('   Tab lämnade modalen', left, 'av 40 gånger');
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
log('   efter Escape: modaler', await page.locator('.modal').count(), 'fokus:', JSON.stringify(await focusInfo()));

// 5. Bekräftelsedialog (MM.confirm) – Escape
await visit(page, 'ekonom', 'eko.korning', { month: '2027-01' });
const gk = page.getByRole('button', { name: /Godkänn alla utan anmärkning/ }).first();
if (await gk.count()) { await gk.click(); await page.waitForTimeout(150); log('5. confirm öppen:', await page.locator('.modal').count()); await page.keyboard.press('Escape'); await page.waitForTimeout(150); log('   efter Escape:', await page.locator('.modal').count()); }

// 6. Feedbacklådan – Escape, fokus
await visit(page, 'chef', 'chef.oversikt', {});
await page.locator('.fb-fab').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
log('6. Feedbacklåda öppen:', await page.locator('.drawer').count(), 'fokus i lådan:', await page.evaluate(() => !!document.activeElement.closest('.drawer')), JSON.stringify(await focusInfo()));
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
log('   efter Escape: lådan finns kvar =', await page.locator('.drawer').count());
await page.screenshot({ path: path.join(dir, 'k6-feedback-escape.png') });
await page.evaluate(() => MM.closeFeedback());

// 7. Klickbar tabellrad: fokusram synlig?
await visit(page, 'ekonom', 'eko.korning', { month: '2027-01' });
const tr = page.locator('tr.clickable').first();
if (await tr.count()) { await tr.focus(); await page.evaluate(() => {}); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); const f = await focusInfo(); log('7. Tabellrad fokus:', JSON.stringify(f)); await tr.screenshot({ path: path.join(dir, 'k7-tabellrad-fokus.png') }); await page.keyboard.press('Enter'); await page.waitForTimeout(150); log('   Enter öppnar modal:', await page.locator('.modal').count()); await page.keyboard.press('Escape'); }

// 8. Närvaro med tangentbord
await visit(page, 'coach', 'coach.narvaro', { week: 'last' });
const before = await page.evaluate(() => MM.sel.unregistered(MM.currentPersonaId(), d0 = MM.d.addDays(MM.d.monday(MM.d.today()), -7), MM.d.today()).length).catch(() => null);
const nb = page.getByRole('button', { name: /Närvarande/ }).first(); await nb.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
const after = await page.evaluate(() => MM.sel.unregistered(MM.currentPersonaId(), MM.d.addDays(MM.d.monday(MM.d.today()), -7), MM.d.today()).length).catch(() => null);
log('8. Närvaro via Enter: oregistrerade före/efter', before, after, 'fokus nu:', JSON.stringify(await focusInfo()));

// 9. Flikar: piltangenter?
await visit(page, 'chef', 'chef.oversikt', {});
const tab = page.getByRole('tab').first(); await tab.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
log('9. Flik + högerpil: fokus', JSON.stringify(await focusInfo()));

// 10. Kommunportalen: beställ med tangentbord – veckor
await visit(page, 'kommun_handlaggare', 'kom.bestall', {});
const w8 = page.getByRole('button', { name: '8', exact: true }).first(); await w8.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
log('10. Veckoknapp 8 med Enter: pressed =', await w8.getAttribute('aria-pressed'), JSON.stringify(await focusInfo()));
await w8.screenshot({ path: path.join(dir, 'k10-vecka-fokus.png') });

// 11. Mobil: hur stor del av skärmen tar den klistrade topplisten?
await page.setViewportSize({ width: 400, height: 860 });
for (const [role, view, params] of [['coach', 'coach.minvecka', {}], ['kommun_handlaggare', 'kom.deltagare', {}], ['chef', 'chef.oversikt', {}]]) {
  await visit(page, role, view, params); await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForTimeout(100);
  const h = await page.evaluate(() => Math.round(document.querySelector('.topbars').getBoundingClientRect().height));
  log(`11. Mobil ${view}: klistrad topplist ${h}px av 860`);
  await page.screenshot({ path: path.join(dir, `k11-mobil-${view}.png`) });
}
// med scenario igång
await page.evaluate(() => MM.startScenario('s4', 1)); await page.waitForTimeout(150); await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForTimeout(100);
log('11b. Mobil med scenario: topplist', await page.evaluate(() => Math.round(document.querySelector('.topbars').getBoundingClientRect().height)), 'px');
await page.screenshot({ path: path.join(dir, 'k11b-mobil-scenario.png') });
// mobil inkorg: klick på mejl – syns detaljen?
await page.evaluate(() => MM.stopScenario());
await visit(page, 'samordnare', 'sam.inkorg', {}); await page.evaluate(() => window.scrollTo(0, 0));
await page.locator('button.ink-row').nth(2).click(); await page.waitForTimeout(200);
const vis = await page.evaluate(() => { const h = [...document.querySelectorAll('#main h2, #main h3')].find((x) => /SV: Vi har tagit emot/.test(x.innerText)); const b = h ? h.getBoundingClientRect() : null; return { scrollY: Math.round(window.scrollY), detailTop: b && Math.round(b.top) }; });
log('12. Mobil inkorg efter klick på mejl 3:', JSON.stringify(vis));
await page.screenshot({ path: path.join(dir, 'k12-mobil-inkorg-klick.png') });
await page.setViewportSize({ width: 1280, height: 900 });

// 13. Skanna alla vyer: element som fångar fokus men har outline none
log('fel i konsolen:', errors.slice(0, 5));
await close();
