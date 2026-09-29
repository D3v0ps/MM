// Granskning (perspektiv) 02: notiser och behörighet – coachens vyer får inte avslöja eskaleringar.
import { openProto, visit } from './lib.mjs';
const SHOTS = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-perspektiv';
const { page, errors, close } = await openProto();
const txt = async () => page.evaluate(() => (document.querySelector('#main') || document.body).innerText);
const full = async () => page.evaluate(() => document.body.innerText);
const log = (h, t) => console.log(`\n===== ${h} =====\n${t}`);
const RX = /eskaler|Eskaler|Tidig uppmärksamhet|chefen|Karin|chef\b|Chef\b/g;
const hits = (t) => { const out = []; let m; const re = new RegExp(RX.source, 'g'); while ((m = re.exec(t))) out.push(t.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\n/g, ' ⏎ ')); return out; };

const info = await page.evaluate(() => {
  const w = MM.sel.progressionWatch();
  return { watch: w.map((x) => ({ n: x.case.number, id: x.case.id, coach: x.case.leadCoachId, streak: x.streak, level: x.level })), yusuf: MM.store.state.script.yusuf };
});
log('progressionWatch', JSON.stringify(info, null, 1));
const amiraEsc = info.watch.filter((x) => x.coach === 'u-amira' && x.level === 'escalated');
log('Amiras eskalerade', JSON.stringify(amiraEsc));

// Chefens notiser
await visit(page, 'chef', 'notiser');
log('chef notiser', (await txt()).slice(0, 2500));
// Coachens notiser
await visit(page, 'coach', 'notiser');
const coachNotiser = await full();
log('coach notiser (hela sidan)', coachNotiser.slice(0, 4000));
log('coach notiser – träffar', hits(coachNotiser).join('\n'));
await page.screenshot({ path: `${SHOTS}/p02-coach-notiser.png`, fullPage: true });

// Coach: Min vecka, ärendelista, ärendekort (alla flikar) för eskalerade ärenden
await visit(page, 'coach', 'coach.minvecka');
const mv = await full(); log('coach.minvecka – träffar', hits(mv).join('\n'));
await visit(page, 'coach', 'arenden.lista');
const al = await full(); log('coach arenden.lista – träffar', hits(al).join('\n'));
const tabs = ['oversikt', 'kartlaggning', 'avstamningar', 'narvaro', 'manad', 'handelser', 'avvikelser', 'praktik', 'rapporter', 'meddelanden', 'historik'];
for (const e of amiraEsc) {
  for (const tab of tabs) {
    await visit(page, 'coach', 'arende.kort', { caseId: e.id, tab });
    const t = await full();
    const h = hits(t);
    if (h.length) log(`coach arende.kort ${e.n} ${tab} – träffar`, h.join('\n'));
  }
  await visit(page, 'coach', 'coach.avstamning', { caseId: e.id });
  const t = await full(); const h = hits(t); if (h.length) log(`coach.avstamning ${e.n} – träffar`, h.join('\n'));
}
// Handledare
await visit(page, 'handledare', 'notiser');
log('handledare notiser', (await txt()).slice(0, 1500));
await visit(page, 'handledare', 'hand.start');
const hs = await full(); log('hand.start – träffar', hits(hs).join('\n'));
// Rapporter som coach
await visit(page, 'coach', 'rapporter.lista');
const rl = await full(); log('coach rapporter.lista – träffar', hits(rl).join('\n'));
console.log('\nFEL:', JSON.stringify(errors, null, 1));
await close();
