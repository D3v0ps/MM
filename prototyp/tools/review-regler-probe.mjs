// Granskning "regler" – riktade prober.
import fs from 'node:fs';
import { openProto, visit } from './lib.mjs';
const SH = '/tmp/claude-0/-home-user-MM/e5c80eff-c572-50a4-9906-30cf010bab8b/scratchpad/review-regler';
const { page, close } = await openProto();
const txt = () => page.evaluate(() => document.querySelector('#main').innerText);
const out = {};
// A. Handledare läser månadsrapport (coachens bedömning)
await visit(page, 'handledare', 'rapport.visa', { reportId: 'rep-15244' });
let t = await txt();
out.handMonthly = { hasSec4: /4\. PROGRESSION/i.test(t), hasLevels: /Uppnått delmål|Tydlig|Liten/i.test(t), hasSec8: /COACHENS SAMMANFATTANDE BEDÖMNING/i.test(t), sec8: (t.match(/COACHENS SAMMANFATTANDE BEDÖMNING[\s\S]{0,300}/i) || [])[0] };
await page.screenshot({ path: `${SH}/handledare-manadsrapport.png`, fullPage: true });
// B. Revisionslogg vid rollbyte: chef öppnar kortet först, sedan coach
await visit(page, 'chef', 'arende.kort', { caseId: await page.evaluate(() => MM.store.state.script.yusuf) });
await visit(page, 'coach', 'arende.kort', { caseId: await page.evaluate(() => MM.store.state.script.yusuf) });
out.viewLogs = await page.evaluate(() => MM.store.state.auditLog.filter((a) => a.action === 'case.view' && a.entityId === MM.store.state.script.yusuf && a.byTester).map((a) => a.actorId));
await visit(page, 'coach', 'arende.kort', { caseId: await page.evaluate(() => MM.store.state.script.yusuf), tab: 'historik' });
t = await txt();
out.coachSeesChefView = (t.match(/.{0,40}Karin Wallin.{0,60}/) || [])[0] || null;
await page.screenshot({ path: `${SH}/coach-historik-efter-chef.png`, fullPage: true });
// C. Månadsrapport-utkast som MB – avsnitt 4/7/8
const draft = await page.evaluate(() => (MM.store.state.reports.find((r) => r.kind === 'monthly' && r.caseId === MM.store.state.script.nadia && r.month === '2027-01') || {}).id);
await visit(page, 'samordnare', 'rapport.visa', { reportId: draft });
t = await txt();
out.draft = { s4: (t.match(/4\. PROGRESSION[\s\S]{0,120}/i) || [])[0], s7: (t.match(/7\. PLAN FÖR NÄSTA MÅNAD[\s\S]{0,120}/i) || [])[0], s8: (t.match(/8\. COACHENS SAMMANFATTANDE BEDÖMNING[\s\S]{0,160}/i) || [])[0], s3: (t.match(/Dokumentation:[\s\S]{0,200}/) || [])[0], s6: (t.match(/6\. AVVIKELSE, RISK OCH ÅTGÄRD[\s\S]{0,300}/i) || [])[0] };
// D. Kommunens chef: ser 35,1 %? var?
await visit(page, 'kommun_chef', 'kom.chef', {});
t = await txt();
out.komChef351 = (t.match(/.{0,120}35,1\s?%.{0,80}/) || [])[0];
out.komChefInternLink = (t.match(/.{0,40}intern.{0,60}/i) || [])[0];
// E. Kommunens chef: skyddad deltagare – via listan -> rapporter-flik -> rapport
const prot = await page.evaluate(() => MM.store.state.script.skyddad);
await visit(page, 'kommun_chef', 'kom.deltagare', { caseId: prot, tab: 'rapporter' });
t = await txt();
out.chefProtReportsTab = t.slice(0, 600);
await page.screenshot({ path: `${SH}/kom-chef-skyddad-rapporter.png`, fullPage: true });
const firstRep = page.locator('#main .list-item.clickable').first();
if (await firstRep.count()) { await firstRep.click(); await page.waitForTimeout(150); t = await txt(); out.chefProtReportOpened = (t.match(/Gäller[^\n]*/) || [])[0]; out.chefProtReportDeltagare = (t.match(/Deltagare\s*\n?[^\n]*/) || [])[0]; await page.screenshot({ path: `${SH}/kom-chef-skyddad-rapport-oppnad.png`, fullPage: true }); }
// Veckorapport till Omar som kommunens chef – skyddad sektion?
const wk = await page.evaluate(() => (MM.store.state.reports.find((r) => r.kind === 'weekly_attendance' && r.recipientUserId === 'k-omar' && ['delivered','opened'].includes(r.status) && r.week === '2027-W04') || MM.store.state.reports.find((r) => r.kind === 'weekly_attendance' && r.recipientUserId === 'k-omar' && ['delivered','opened'].includes(r.status)) || {}).id);
await visit(page, 'kommun_chef', 'rapport.visa', { reportId: wk });
t = await txt();
out.weeklyOmarChef = { hasProtNumber: await page.evaluate((txt2) => { const c = MM.sel.caseById(MM.store.state.script.skyddad); return txt2.includes(c.number); }, t), name: await page.evaluate((txt2) => { const p = MM.sel.person(MM.sel.caseById(MM.store.state.script.skyddad)); return txt2.includes(`${p.firstName} ${p.lastName}`); }, t), week: wk };
// F. Handläggare Omar-rapporter: ser Maria skyddad? (nej – inte hennes)
// G. Coach Amira: rapporter.lista veckorapport – ser hon andra coachers deltagare?
const wkM = await page.evaluate(() => (MM.store.state.reports.find((r) => r.kind === 'weekly_attendance' && r.recipientUserId === 'k-maria' && r.week === '2027-W03') || {}).id);
await visit(page, 'coach', 'rapport.visa', { reportId: wkM });
t = await txt();
out.coachWeekly = (t.match(/Du ser \d+ av \d+ deltagare[^\n]*/) || [])[0];
// H. AI: anteckningar -> förslag
fs.writeFileSync(`${SH}/probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await close();
