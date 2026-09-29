// Scenario s6: AI-stöd – granska ett utkast
import assert from 'node:assert/strict';
import { setup } from './review-scenarier-lib.mjs';
const T = await setup('s6');
const { page, S, main, dialog, check, note, shot } = T;
const caseId = await S(() => MM.store.state.script.mehmet);
const ciId = await S((id) => (MM.store.state.checkIns.find((x) => x.caseId === id && x.ai) || {}).id, caseId);

const r1 = await T.startFromHome();
await check('Steg 1 route', () => { assert.equal(r1.view, 'coach.avstamning'); assert.equal(r1.params.checkInId, ciId); });
await check('Steg 1: AI-utkast från fredagens avstämning öppnas', async () => { const t = await T.mainText(); assert.match(t, /MEHMET KAYA/i); assert.match(t, /AI-UTKAST/i); assert.match(t, /fredag 29 jan 2027/); });
await check('Steg 1: AI:s fasförslag är rimligt (inte bakåt från nuvarande fas)', async () => {
  const t = await T.mainText(); const cur = (t.match(/Ärendet är i fas (\d)/) || [])[1]; const sug = (t.match(/AI-FÖRSLAG\nTa ställning till förslaget\nFas (\d)/) || [])[1];
  if (cur && sug && Number(sug) < Number(cur)) throw new Error(`Ärendet är i fas ${cur} (Praktik/APL) men AI föreslår fas ${sug}; citatet och arbetsgivarkontakten ("frågade om praktik i mars") beskriver också en deltagare som inte har börjat praktik`);
});
await shot('steg1');

await T.next();
await check('Steg 2: belägg (citat + tidpunkt) syns vid varje förslag', async () => { const n = await main.locator('.ai-box').count(); const ev = await main.locator('.ai-box').filter({ hasText: /Tidpunkt \d\d:\d\d/ }).count(); assert.equal(n, ev); return `${n} förslag`; });
await check('Steg 2: finns en knapp/länk "Visa beläggen"?', async () => { const n = await main.getByRole('button', { name: /belägg/i }).count(); return n ? 'finns' : 'ingen separat knapp – beläggen visas direkt'; });
await check('Steg 2: samlad status är tom', async () => { const pressed = await main.locator('#ci-status [aria-pressed=true], [aria-label="Samlad status"] [aria-pressed=true]').count(); assert.equal(pressed, 0); });
await check('Steg 2: godkänn innan beslut → stoppas', async () => {
  await main.getByRole('button', { name: 'Godkänn avstämningen' }).click(); await page.waitForTimeout(120);
  const t = await T.mainText(); assert.match(t, /Ta ställning till alla AI-förslag/); 
});
await check('Steg 2: ta ställning – acceptera, avvisa fas, ändra aktiviteter', async () => {
  const boxes = main.locator('.ai-box');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const b = boxes.nth(i); const lbl = await b.getAttribute('aria-label');
    if (/fas/i.test(lbl)) await b.getByRole('button', { name: 'Avvisa' }).click();
    else if (/aktiviteter/i.test(lbl)) await b.getByRole('button', { name: 'Ändra' }).click();
    else await b.getByRole('button', { name: 'Acceptera' }).click();
    await page.waitForTimeout(40);
  }
  const labels = []; for (let i = 0; i < n; i++) labels.push(await boxes.nth(i).getAttribute('aria-label'));
  return labels;
});
await check('Steg 2: efter Avvisa fas – fasfältet', async () => { const t = await T.mainText(); return (t.match(/Ärendet är i fas[^\n]*/) || [''])[0]; });
await check('Steg 2: vad händer vid Ändra (aktiviteter)?', async () => { const box = main.locator('.ai-box').filter({ hasText: /Yrkesspecifika moment, CV/ }); return (await box.innerText()).replace(/\n/g, ' | ').slice(0, 200); });
await check('Steg 2: välj samlad status Grön själv', async () => { await main.getByRole('button', { name: /^Grön/ }).click(); });
await shot('steg2');

await T.next();
await check('Steg 3: godkänn', async () => {
  await main.getByRole('button', { name: 'Godkänn avstämningen' }).click(); await page.waitForTimeout(200);
  const t = await T.mainText(); assert.match(t, /Avstämningen är godkänd/i, (t.match(/[^\n]*(Ta ställning|Välj|Skriv)[^\n]*/g) || []).join(' | '));
  return (t.match(/AI-FÖRSLAG\n[^\n]*\n[^\n]*/) || [''])[0].replace(/\n/g, ' ');
});
const ci = await S((id) => JSON.parse(JSON.stringify(MM.store.state.checkIns.find((x) => x.id === id))), ciId);
await check('Steg 3: råtranskriptet raderat', () => { assert.ok(ci.ai.rawTranscriptDeletedAt); assert.equal(ci.ai.transcript.length, 0); return ci.ai.rawTranscriptDeletedAt; });
await check('Steg 3: varje beslut sparat', () => S((id) => { const r = (MM.store.state.aiFieldDecisions || []).filter((x) => x.aiRunId === id); return r.map((x) => `${x.field}:${x.decision}`); }, ci.aiRunId));
await check('Steg 3: fasen oförändrad (4) efter avvisat fasförslag', () => S((id) => MM.sel.caseById(id).phase, caseId).then((p) => { assert.equal(p, 4); return p; }));
await check('Steg 3: besluten syns i revisionsloggen', async () => {
  const a = await S(() => MM.store.state.auditLog.filter((x) => x.byTester).map((x) => x.action)); return a;
});
await shot('steg3');
await T.done();
