// Scenario s8: Fakturering januari
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s8');
const { page, S, main, check, note, shot } = T;
const dlg = () => page.getByRole('dialog').last();
const b = () => S(() => { const x = MM.sel.billingForMonth('2027-01'); return { count: x.count, blocked: x.blocked, needs: x.needsApproval, statuses: MM.groupBy(x.invoices, (i) => i.status) && Object.fromEntries(Object.entries(MM.groupBy(x.invoices, (i) => i.status)).map(([k, v]) => [k, v.length])) }; });

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'eko.korning'); assert.equal(r1.role, 'ekonom'); });
await check('Steg 1: torsdagsregeln och v. 53 → december', async () => { const t = await T.mainText(); assert.match(t, /torsdagen infaller/); assert.match(t, /V\. 53 2026[^\n]*december 2026/); });
await check('Steg 1: inga namn i ekonomens vy', async () => { const t = await T.mainText(); assert.ok(!/Nadia|Warsame|Yusuf Abdi/.test(t)); });
note('OBS', 'Start: ' + JSON.stringify(await b()));

await T.next();
await check('Steg 2: Visa stoppade (2)', async () => { await main.getByRole('button', { name: /Visa stoppade/ }).click(); await page.waitForTimeout(100); const n = await main.locator('tbody tr').count(); return n; });
await check('Steg 2: kommunens meddelande (rätt referens) går att se från körningen', async () => {
  await main.locator('tbody tr', { hasText: 'BOT-26-0117' }).click(); await dlg().waitFor();
  const t = await dlg().innerText(); assert.match(t, /55102938/, 'Rätt referens från kommunens meddelande syns inte i fakturadetaljen'); return (t.match(/Uppgift från[^\n]*\n[^\n]*/) || [''])[0].replace(/\n/g, ' ');
});
await shot('steg2-detalj', false);
await check('Steg 2: rätta BOT-26-0117 via förslaget från uppgiften', async () => {
  await dlg().getByRole('button', { name: /Använd 55102938/ }).click(); await dlg().getByRole('button', { name: 'Spara referensen' }).click(); await page.waitForTimeout(150);
  const ref = await S(() => MM.sel.caseByTag('reffel1').buyerReference); assert.equal(ref, '55102938');
  const open = await page.getByRole('dialog').count(); return `modal öppen efter spara: ${open}`;
});
await check('Steg 2: stäng och rätta BOT-26-0121', async () => {
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  if (await page.getByRole('dialog').count()) await dlg().getByRole('button', { name: /Stäng/ }).first().click();
  await main.getByRole('tab', { name: /^Stoppade/ }).click().catch(() => {}); await page.waitForTimeout(80);
  const row = main.locator('tbody tr', { hasText: 'BOT-26-0121' });
  if (!(await row.count())) { await main.getByRole('tab', { name: /^Alla/ }).first().click(); await page.fill('#eko-search', '0121'); await page.waitForTimeout(80); }
  await main.locator('tbody tr', { hasText: 'BOT-26-0121' }).click(); await dlg().waitFor();
  await dlg().getByRole('button', { name: /Använd 55102938/ }).click(); await dlg().getByRole('button', { name: 'Spara referensen' }).click(); await page.waitForTimeout(150);
  const ref = await S(() => MM.sel.caseByTag('reffel2').buyerReference); assert.equal(ref, '55102938');
  await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  return b();
});
await shot('steg2-klar');

await T.next();
await check('Steg 3: route oförändrad', async () => (await T.route()).view);
const zeroCases = await S(() => MM.sel.billingForMonth('2027-01').invoices.filter((i) => i.checks.some((c) => c.kind === 'zero_week' && c.severity === 'needs_approval')).map((i) => i.number));
note('OBS', 'Fakturor med vecka utan närvaro: ' + zeroCases.join(', '));
for (const num of zeroCases) {
  await check(`Steg 3: godkänn vecka utan närvaro för ${num} och godkänn fakturan`, async () => {
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
    await page.fill('#eko-search', num.slice(-4)); await page.waitForTimeout(100);
    await main.getByRole('tab', { name: /^Alla/ }).first().click().catch(() => {}); await page.waitForTimeout(60);
    await main.locator('tbody tr', { hasText: num }).first().click(); await dlg().waitFor();
    const ta = dlg().locator('textarea[id^=eko-zero]'); const n = await ta.count();
    for (let i = 0; i < n; i++) { await dlg().locator('textarea[id^=eko-zero]').first().fill('Kontrollerat med samordnaren – inskriven hela veckan.'); await dlg().getByRole('button', { name: 'Godkänn veckan för fakturering' }).first().click(); await page.waitForTimeout(80); }
    const chk = dlg().locator('input[type=checkbox][id^=eko-rem]'); if (await chk.count()) await chk.check();
    const btn = dlg().getByRole('button', { name: 'Godkänn fakturan' }); const dis = await btn.isDisabled(); if (!dis) await btn.click();
    await page.waitForTimeout(100);
    const st = await S((n) => MM.sel.billingForMonth('2027-01').invoices.find((i) => i.number === n).status, num);
    await page.keyboard.press('Escape'); await page.waitForTimeout(60);
    return `${n} veckor godkända, knapp disabled=${dis}, status=${st}`;
  });
}
await page.fill('#eko-search', '');
await check('Steg 3: förhandsgranska en faktura med upparbetat och återstående belopp', async () => {
  await page.fill('#eko-search', '0143'); await page.waitForTimeout(80);
  await main.locator('tbody tr', { hasText: 'BOT-26-0143' }).first().click(); await dlg().waitFor();
  await dlg().getByRole('button', { name: 'Förhandsgranska faktura' }).click(); await page.waitForTimeout(150);
  const r = await T.route(); const t = await T.mainText(); assert.equal(r.view, 'eko.faktura');
  assert.match(t, /[Uu]pparbetat/); assert.match(t, /[Åå]terstå/);
  return (t.match(/[^\n]*[Uu]pparbetat[^\n]*\n?[^\n]*/) || [''])[0].replace(/\n/g, ' ');
});
await shot('steg3-faktura');
await check('Steg 3: fakturan har inga namn', async () => { const t = await T.mainText(); assert.ok(!/Nadia|Warsame/.test(t)); });

const r4 = await T.next();
await check('Steg 4: Nästa steg tar tillbaka till körningen', () => { assert.equal(r4.view, 'eko.korning'); });
await check('Steg 4: Godkänn alla utan anmärkning', async () => {
  await main.getByRole('button', { name: /Godkänn alla utan anmärkning/ }).click(); await dlg().waitFor();
  await dlg().getByRole('button', { name: /Godkänn \d+ fakturor/ }).click(); await page.waitForTimeout(150); return b();
});
await check('Steg 4: Skapa i Fortnox', async () => {
  const btn = main.getByRole('button', { name: /Skapa i Fortnox \(\d+\)/ }); const lbl = await btn.innerText();
  await btn.click(); await dlg().waitFor(); await dlg().getByRole('button', { name: /Skapa \d+ fakturor|Kör ändå/ }).click(); await page.waitForTimeout(150);
  return lbl + ' → ' + JSON.stringify(await b());
});
await check('Steg 4: reservväg – exportera CSV', async () => {
  await main.getByRole('button', { name: 'Exportera underlag (CSV)' }).first().click(); await page.waitForTimeout(200);
  const n = await page.getByRole('dialog').count(); const t = n ? await dlg().innerText() : ''; if (n) await page.keyboard.press('Escape');
  return t.slice(0, 160).replace(/\n/g, ' | ');
});
await check('Steg 4: reservväg – markera som manuellt fakturerad', async () => {
  await main.getByRole('button', { name: 'Markera som manuellt fakturerad' }).first().click(); await dlg().waitFor();
  const t = await dlg().innerText(); await page.keyboard.press('Escape'); return t.slice(0, 200).replace(/\n/g, ' | ');
});
await shot('steg4');
await T.done();
