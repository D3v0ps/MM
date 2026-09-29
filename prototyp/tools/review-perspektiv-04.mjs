// Granskning (perspektiv) 04: samma siffror i chef.oversikt, kom.chef och beställarrapporten (rapport.visa).
import { openProto, visit } from './lib.mjs';
const SHOTS = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-perspektiv';
const { page, errors, close } = await openProto();
const txt = async () => page.evaluate(() => (document.querySelector('#main') || document.body).innerText);
const log = (h, t) => console.log(`\n===== ${h} =====\n${t}`);
const around = (t, s, a = 60, b = 200) => { const i = t.indexOf(s); return i < 0 ? `(saknas: ${s})` : t.slice(Math.max(0, i - a), i + b).replace(/\n/g, ' ⏎ '); };

// Beräkningar direkt ur selektorerna
const calc = await page.evaluate(() => {
  const s = MM.sel;
  const jan = s.customerSummary('2027-01'); const dec = s.customerSummary('2026-12');
  const rr = s.resultRate({ window: 'rolling_6m' });
  const kpiN = s.kpiValue('narvarograd', { month: '2027-01' });
  const kpiS = s.kpiValue('nojdhet');
  const pulseAll = s.pulseStats();
  const activeNow = MM.store.state.cases.filter((c) => c.status === 'active').length;
  const decPulseStrict = MM.store.state.pulseResponses.filter((x) => x.submittedAt >= '2026-10-01' && x.submittedAt <= '2026-12-31T23:59');
  const small = jan.small;
  return {
    chef: { rolling: [rr.value, rr.num, rr.den], narvaro: [kpiN.value, kpiN.num, kpiN.den], nojdhet: [kpiS.value, kpiS.num, kpiS.den], pulseSat: pulseAll.satisfaction, pulseN: pulseAll.responses, activeNow },
    jan: { rolling: [jan.result.rolling.value, jan.result.rolling.num, jan.result.rolling.den], month: [jan.result.month.value, jan.result.month.num, jan.result.month.den], active: jan.active, started: jan.started, closed: jan.closed, att: jan.attendanceRate, pulse: [jan.pulse.satisfaction, jan.pulse.responses], prog: jan.progression.assessed },
    dec: { rolling: [dec.result.rolling.value, dec.result.rolling.num, dec.result.rolling.den], month: [dec.result.month.value, dec.result.month.num, dec.result.month.den], active: dec.active, att: dec.attendanceRate, pulse: [dec.pulse.satisfaction, dec.pulse.responses],
      pulseStrict: [decPulseStrict.length ? decPulseStrict.filter((x) => x.answers.q1 >= 4).length / decPulseStrict.length : null, decPulseStrict.length], latestPulse: MM.store.state.pulseResponses.map((x) => x.submittedAt).sort().slice(-1)[0] },
  };
});
log('beräknat', JSON.stringify(calc, null, 1));

// chef.oversikt (KPI-flik)
await visit(page, 'chef', 'chef.oversikt');
const co = await txt();
log('chef.oversikt: resultat', around(co, 'Resultatgrad, rullande 6 mån', 0, 160));
log('chef.oversikt: närvarograd', around(co, 'Närvarograd', 0, 200));
log('chef.oversikt: nöjdhet', around(co, 'Nöjdhet', 0, 200));
log('chef.oversikt: så ser kommunens chef', around(co, 'SÅ SER KOMMUNENS CHEF RESULTATET', 0, 200));
await visit(page, 'chef', 'chef.oversikt', { tab: 'omraden' });
log('chef.oversikt: aktiva', around(await txt(), 'Aktiva deltagare', 0, 120));
await visit(page, 'chef', 'chef.oversikt', { tab: 'puls' });
log('chef.oversikt: puls', around(await txt(), 'Nöjdhet', 0, 120));

// kom.chef (januari)
await visit(page, 'kommun_chef', 'kom.chef');
const kc = await txt();
log('kom.chef: KPI-rad', around(kc, 'RESULTAT, 6 MÅNADER', 0, 500));
log('kom.chef: interna mål nämns?', String(/intern|35\s?%/i.test(kc)));
await page.screenshot({ path: `${SHOTS}/p04-kom-chef.png`, fullPage: true });
// Resultat-flik – under januari
log('kom.chef: resultat januari', around(kc, 'UNDER JANUARI', 0, 300));
await page.getByRole('tab', { name: /Närvaro och nöjdhet/ }).click(); await page.waitForTimeout(100);
log('kom.chef: närvaro-flik', around(await txt(), 'NÄRVARO', 0, 600));
// December
await page.getByRole('button', { name: /December/ }).click(); await page.waitForTimeout(150);
const kcd = await txt();
log('kom.chef december: KPI-rad', around(kcd, 'RESULTAT, 6 MÅNADER', 0, 400));

// Beställarrapporten (dokument) för januari och december som kommunens chef
const ids = await page.evaluate(() => MM.store.state.reports.filter((r) => r.kind === 'customer_summary').map((r) => [r.month, r.id, r.status]));
log('customer_summary', JSON.stringify(ids));
for (const [mk, id] of ids.filter((x) => x[2] !== 'draft')) {
  await visit(page, 'kommun_chef', 'rapport.visa', { reportId: id });
  const t = await txt();
  log(`rapport.visa ${mk} (kommunens chef): resultat`, around(t, '2. RESULTAT', 0, 600));
  log(`rapport.visa ${mk}: närvaro`, around(t, '4. NÄRVARO', 0, 200));
  log(`rapport.visa ${mk}: nöjdhet`, around(t, '6. NÖJDHET', 0, 200));
  log(`rapport.visa ${mk}: deltagare`, around(t, '1. DELTAGARE', 0, 200));
  log(`rapport.visa ${mk}: intern?`, String(/intern|35\s?%/i.test(t)));
}
// Januari-utkastet som avtalsansvarig (MB) – utkastet
const janId = ids.find((x) => x[0] === '2027-01')[1];
await visit(page, 'avtalsansvarig', 'rapport.visa', { reportId: janId });
const ja = await txt();
log('rapport.visa jan (avtalsansvarig, utkast): resultat', around(ja, '2. RESULTAT', 0, 600));
log('rapport.visa jan: intern i dokumentdelen?', String(/intern/i.test(ja.slice(ja.indexOf('FÖRHANDSVISNING')))));
console.log('\nFEL:', JSON.stringify(errors, null, 1));
await close();
