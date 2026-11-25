// Paritet mot den gamla prototypen: rapportmodellerna byggs av testdatat (createSeed) och jämförs med facit som tagits
// fram ur prototypens egen kod (parity/generate-facit.mjs -> parity/facit.json, MM.reports.modelFor för varje rapport).
// Dessutom: frysningen (levererade rapporter ändras inte) och att beställarrapporten aldrig innehåller det interna målet.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderPeriodText, priceFor } from "@/core/cases";
import { requireOperational } from "@/core/config";
import { dayOf } from "@/core/time";
import { createSeed } from "@/data/seed";
import { withoutAreaChanges } from "@/data/seed/decisions-2026-10-22";
import { withoutFirstMeetingDemo } from "@/data/seed/decisions-2026-11-09";
import { ACTIVITY_TYPES } from "@/data/seed/constants";
import { emptyDb, type Db, type Report } from "@/data/schema";
import { canonicalJson, driftedSinceDelivery, frozenModel, reportModel, summaryFromNumbers, type OrderModel, type ReportEnv, type SummaryModel } from "./model";
import { parseDocText } from "./facts";
import { effStatus, goalSentence, periodText, reportTitle, statusLabel } from "./report-helpers";

type FacitRow = { model: string; title: string; period: string; eff: string; statusLabel: string; next: string; overdue: boolean; week: boolean };
type Facit = { meta: { now: string; count: number }; sample: Record<string, { id: string; model: unknown }>; reports: Record<string, FacitRow> };
const facit = JSON.parse(readFileSync(new URL("./parity/facit.json", import.meta.url), "utf8")) as Facit;

// Facit är från före bytet av yrkesområde i testdatat (Karims beslut 2026-10-22) och före BOT-27-0043:s första möte i januari
// (Karims beslut 2026-11-09) – rapporterna visar ärendets nuvarande yrkesområde, första möte och planerade slut, så jämförelsen
// görs på testdatat utan dem (som src/core/parity.test.ts).
const db = withoutFirstMeetingDemo(withoutAreaChanges({ ...emptyDb(), ...(createSeed() as unknown as Partial<Db>) } as Db));
const contract = db.contracts.find((c) => c.id === "c-bot")!;
const supplier = db.organizations.find((o) => o.id === contract.supplierId)!;
const env: ReportEnv = { cfg: requireOperational(contract.config), contract: { id: contract.id, startsOn: contract.startsOn, supplierName: supplier.name }, now: facit.meta.now, activityTypes: ACTIVITY_TYPES };
const hash = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex").slice(0, 16);
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rep = (id: string) => db.reports.find((r) => r.id === id)!;
/**
 * Dokumenterad avvikelse (granskningen 2026-10-13): meningen om veckomålet i avsnitt 3 skriver inte ut delar som är noll
 * (goalSentence). Jämförelsen läser tillbaka antalen (parseDocText), kontrollerar att meningen är exakt goalSentence av dem och
 * sätter tillbaka prototypens mening med alla tre delarna – så att resten av texten och modellen fortfarande jämförs med facit.
 * Frysta rapporter har kvar den äldre meningen och lämnas som de är.
 */
function protoDocText(t: string): string {
  const p = parseDocText(t);
  if (!p || /^Inga godkända veckoavstämningar/.test(t)) return t;
  const g = p.goals;
  const times = (n: number) => `${n} ${n === 1 ? "gång" : "gånger"}`;
  const old = `Veckomålet uppnåddes ${times(g.yes)}, delvis ${times(g.partly)} och inte ${times(g.no)}.`;
  if (t.endsWith(` ${old}`)) return t;
  const sentence = goalSentence(g);
  expect(t.endsWith(` ${sentence}`), t).toBe(true);
  return `${t.slice(0, -sentence.length)}${old}`;
}
/**
 * Dokumenterad avvikelse (beslut 2026-10-07, synpunkt #10): orderbekräftelsen har inget veckopris – fältet price är ersatt av
 * omfattningen i text (period). Jämförelsen kontrollerar omfattningen för sig och lägger tillbaka prototypens pris, så att alla
 * andra fält fortfarande jämförs med facit.
 */
/**
 * Dokumenterad avvikelse (Karims beslut 2026-11-25): beställarrapporten har exakta antal och tre nya fält – avbrott per
 * resultatrad, deltagare utan progression och avbrott utan resultat. Jämförelsen kontrollerar dem för sig (se nedan), tar
 * bort dem och skriver sammanfattningen med prototypens "färre än 5" – så att resten av modellen fortfarande jämförs med facit.
 */
function protoSummary(m: SummaryModel): string {
  const sm = (n: number) => (n > 0 && n < m.minN ? `färre än ${m.minN}` : String(n));
  const uc = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return summaryFromNumbers(m)
    .replace(/var (\d+) deltagare aktiva och (\d+) nya/, (_, a: string, b: string) => `var ${sm(+a)} deltagare aktiva och ${sm(+b)} nya`)
    .replace(/startade\. (\d+) insatser avslutades, varav (\d+) till/, (_, a: string, b: string) => `startade. ${uc(sm(+a))} insatser avslutades, varav ${sm(+b)} till`)
    .replace(/(\d+) avvikelser på deltagarnivå/, (_, a: string) => `${uc(sm(+a))} avvikelser på deltagarnivå`);
}
function summaryAsPrototype(m: SummaryModel): unknown {
  const { noProgression, avbrottNoResult, ...rest } = m;
  expect(noProgression, "noProgression").toEqual(expect.any(Number));
  expect(avbrottNoResult, "avbrottNoResult").toEqual(expect.any(Number));
  const rate = (x: SummaryModel["result"]["month"]) => {
    const { avbrott, ...r } = x;
    expect(avbrott, "avbrott").toEqual(expect.any(Number));
    return r;
  };
  if (m.summary != null) expect(m.summary).toBe(summaryFromNumbers(m));
  return {
    ...rest, summary: m.summary == null ? null : protoSummary(m),
    result: { ...m.result, month: rate(m.result.month), rolling: rate(m.result.rolling), sinceStart: rate(m.result.sinceStart) },
  };
}
function asPrototype(r: Report, m: unknown): unknown {
  if (r.kind === "customer_summary" && m) return summaryAsPrototype(m as SummaryModel);
  if ((r.kind === "monthly" || r.kind === "final") && m && typeof (m as { docText?: unknown }).docText === "string") {
    return { ...(m as object), docText: protoDocText((m as { docText: string }).docText) };
  }
  if (r.kind !== "order_confirmation" || !m) return m;
  const { period, ...rest } = m as OrderModel;
  const c = db.cases.find((x) => x.id === r.caseId)!;
  expect(period).toBe(orderPeriodText(c));
  expect(canonicalJson(m)).not.toMatch(/price/i);
  return { ...rest, price: priceFor(db.price_items, c.primaryAreaCode, c.startDate || c.plannedStart || c.desiredStart || dayOf(env.now), c.contractId) };
}

describe("rapportmodellerna har paritet med den gamla prototypen", () => {
  it("samma antal rapporter", () => {
    expect(db.reports.length).toBe(facit.meta.count);
  });
  for (const [name, s] of Object.entries(facit.sample)) {
    it(`hela modellen: ${name} (${s.id})`, () => {
      expect(asPrototype(rep(s.id), J(reportModel(db, rep(s.id), env)))).toEqual(s.model);
    });
  }
  it("kontrollsumma för varje rapports modell, rubrik, period och status", () => {
    const diff: string[] = [];
    for (const r of db.reports) {
      const f = facit.reports[r.id];
      if (!f) {
        diff.push(`${r.id}: saknas i facit`);
        continue;
      }
      if (hash(asPrototype(r, J(reportModel(db, r, env)))) !== f.model) diff.push(`${r.id} (${r.kind}): modellen`);
      if (reportTitle(r) !== f.title) diff.push(`${r.id}: rubriken ${reportTitle(r)} ≠ ${f.title}`);
      if (periodText(r) !== f.period) diff.push(`${r.id}: perioden ${periodText(r)} ≠ ${f.period}`);
      // Dokumenterad avvikelse (beslut 2026-10-07): beställarrapporten lämnas utanför Miljonmatch – levererad men aldrig
      // kvitterad i portalen (prototypen: öppnad av kommunens chef).
      const outside = r.kind === "customer_summary" && r.status === "delivered" && f.eff === "opened";
      const [eff, label] = outside ? ["delivered", "Lämnad till kommunen"] : [f.eff, f.statusLabel];
      if (effStatus(r) !== eff || statusLabel(r) !== label) diff.push(`${r.id}: statusen`);
    }
    expect(diff).toEqual([]);
  });
});

describe("frysning", () => {
  const dec = rep("rep-16008");
  it("en levererad rapport byggs av uppgifterna vid leveransen – en senare ändring av närvaron syns inte", () => {
    const before = J(reportModel(db, dec, env));
    const act = db.activities.find((a) => a.caseId === dec.caseId && a.startsAt.startsWith("2026-12") && db.attendance.some((x) => x.activityId === a.id && x.status === "present"))!;
    const changed: Db = { ...db, attendance: db.attendance.map((x) => (x.activityId === act.id ? { ...x, status: "absent_invalid", reason: "", registeredAt: "2027-02-01T09:13" } : x)) };
    const snap: Report = { ...dec, snapshot: { reportId: dec.id, takenAt: "2027-02-01T09:12", deliveredAt: dec.deliveredAt, model: frozenModel(db, dec, env) } };
    // Med ögonblicksbild: oförändrat, och ändringen upptäcks.
    expect(J(reportModel(changed, snap, env))).toEqual(before);
    expect(driftedSinceDelivery(changed, snap, env)).toBe(true);
    expect(driftedSinceDelivery(db, snap, env)).toBe(false);
    // Dagens data ger en annan modell.
    expect(J(reportModel(changed, snap, env, { live: true }))).not.toEqual(before);
  });
});

describe("beställarrapporten", () => {
  it("förslaget till sammanfattning nämner aldrig det interna målet", () => {
    const m = reportModel(db, rep("rep-16699"), env) as SummaryModel;
    const text = summaryFromNumbers(m);
    expect(text).toMatch(/^Under januari 2027 var 134 deltagare aktiva och 44 nya insatser startade\./);
    expect(text).not.toMatch(/35\s?%|internt? mål/i);
    expect(canonicalJson(m)).not.toMatch(/internalTarget|0\.35/);
  });
});

describe("beställarrapporten: Första möte inom en vecka räknar det första bokade mötet (seesSlaStats, Karims beslut 2026-11-09)", () => {
  it("en sen ombokning efter att deltagaren inte kom ändrar inte raden – bara ärendet och mötets tid läses", () => {
    // Testdatat med BOT-27-0043:s första möte fredag 29 januari kl. 14.00 (beställt i januari).
    const live = { ...emptyDb(), ...(createSeed() as unknown as Partial<Db>) } as Db;
    const senv: ReportEnv = { ...env, cfg: { ...env.cfg, customerVisibility: { ...env.cfg.customerVisibility, seesSlaStats: true } } };
    const jan = live.reports.find((x) => x.kind === "customer_summary" && x.month === "2027-01");
    expect(jan).toBeTruthy();
    const draft: Report = { ...jan!, status: "draft", deliveredAt: null };
    const sla = (d: Parameters<typeof reportModel>[0]) => (reportModel(d, draft, senv) as SummaryModel).sla;
    const before = sla(live);
    expect(before?.some(([label]) => /första möte/i.test(label))).toBe(true);
    // Deltagaren kom inte och mötet bokades om till 15 februari – långt efter veckan.
    const rebooked = { ...live, cases: live.cases.map((c) => (c.id === "case-270043" ? { ...c, firstMeetingAt: "2027-02-15T10:00" } : c)) };
    expect(sla({ ...rebooked, first_meeting_no_shows: [{ caseId: "case-270043", meetingAt: "2027-01-29T14:00" }] })).toEqual(before);
    // Utan registreringen räknas ombokningen som sent (så som det var före beslutet).
    expect(sla({ ...rebooked, first_meeting_no_shows: [] })).not.toEqual(before);
  });
});

describe("beställarrapporten: Karims beslut 2026-11-25 (exakta antal, avbrott, deltagare utan progression, avbrott utan resultat)", () => {
  const summary = (d: Db) => reportModel(d, rep("rep-16699"), env) as SummaryModel;
  const inJan = (c: Db["cases"][number]) => c.status === "closed" && c.endDate != null && c.endDate >= "2027-01-01" && c.endDate <= "2027-01-31";
  const isAvbrott = (r: string | null) => r != null && r.startsWith("avbrott_");

  it("sammanfattningen har exakta antal – aldrig \"färre än 5\"", () => {
    const m = summary(db);
    const small = { ...m, active: 3, started: 1, closed: 4, deviations: 2, result: { ...m.result, month: { ...m.result.month, num: 1 } } };
    const text = summaryFromNumbers(small);
    expect(text).toMatch(/^Under januari 2027 var 3 deltagare aktiva och 1 nya insatser startade\. 4 insatser avslutades, varav 1 till arbete eller studier\./);
    expect(text).toContain("2 avvikelser på deltagarnivå har hanterats med åtgärd.");
    expect(text).not.toMatch(/färre än/i);
  });

  it("Avbrott per resultatrad: alla avslut i perioden med en avbrottsorsak – också flytt och kommunens beslut, som inte räknas i nämnaren", () => {
    const m = summary(db);
    const want = db.cases.filter((c) => inJan(c) && isAvbrott(c.endReason)).length;
    expect(want).toBeGreaterThan(0);
    expect(m.result.month.avbrott).toBe(want);
    // En deltagare som flyttar räknas inte i resultatgraden men är ett avbrott.
    const c = db.cases.find((x) => inJan(x) && x.endReason === "arbete")!;
    const moved = summary({ ...db, cases: db.cases.map((x) => (x.id === c.id ? { ...x, endReason: "avbrott_flytt" as const, resultClass: "excluded" as const } : x)) });
    expect(moved.result.month.avbrott).toBe(want + 1);
    expect(moved.result.month.den).toBe(m.result.month.den - 1);
    expect(m.result.rolling.avbrott).toBeGreaterThanOrEqual(want);
    expect(m.result.sinceStart.avbrott).toBe(db.cases.filter((x) => x.status === "closed" && x.endDate != null && x.endDate <= "2027-01-31" && isAvbrott(x.endReason)).length);
  });

  it("Avbrott utan resultat: avslutade under månaden med avbrott och utan resultat – ett avbrott med resultat räknas inte; 0 utan avbrott", () => {
    const m = summary(db);
    const ab = db.cases.filter((c) => inJan(c) && isAvbrott(c.endReason));
    expect(m.avbrottNoResult).toBe(ab.filter((c) => c.resultClass !== "result").length);
    expect(m.avbrottNoResult).toBeGreaterThan(0);
    const withResult = summary({ ...db, cases: db.cases.map((x) => (x.id === ab[0].id ? { ...x, resultClass: "result" as const } : x)) });
    expect(withResult.avbrottNoResult).toBe(m.avbrottNoResult! - 1);
    // Avbrottet står kvar i resultattabellens Avbrott.
    expect(withResult.result.month.avbrott).toBe(m.result.month.avbrott);
    const none = summary({ ...db, cases: db.cases.map((x) => (inJan(x) && isAvbrott(x.endReason) ? { ...x, endReason: "planerat_utan_resultat" as const } : x)) });
    expect(none.avbrottNoResult).toBe(0);
    expect(none.result.month.avbrott).toBe(0);
  });

  it("Deltagare utan progression: bara godkända bedömningar för månaden, inget obligatoriskt område på nivå 1 eller högre – de valfria räknas aldrig", () => {
    const cfg = env.cfg;
    const approved = db.monthly_assessments.filter((x) => x.month === "2027-01" && x.status === "approved");
    expect(approved.length).toBeGreaterThan(3);
    expect(summary(db).noProgression).toBe(0);
    type Ma = (typeof approved)[number];
    const levels = (x: Ma, level: (key: string) => number): Ma => ({
      ...x, areas: Object.fromEntries([...cfg.progression.areas, ...cfg.progression.optionalAreas].map((k) => [k, { ...x.areas[k], level: level(k) }])) as Ma["areas"],
    });
    const optional = new Set<string>(cfg.progression.optionalAreas);
    const [a, b, c] = approved;
    // a: alla obligatoriska på 0, de valfria på 3 – räknas. b: ett obligatoriskt område på nivå 1 – räknas inte. c: utkast med allt på 0 – räknas inte.
    const changed = db.monthly_assessments.map((x) =>
      x.id === a.id ? levels(x, (k) => (optional.has(k) ? 3 : 0))
        : x.id === b.id ? levels(x, (k) => (k === cfg.progression.areas[0] ? 1 : 0))
          : x.id === c.id ? { ...levels(x, () => 0), status: "draft" as const }
            : x,
    );
    expect(summary({ ...db, monthly_assessments: changed }).noProgression).toBe(1);
  });

  it("en ögonblicksbild från före beslutet (utan de nya fälten, med byTrack) visas som den är och ser inte ut att ha ändrats", () => {
    const dec = rep("rep-16698");
    const fresh = J(frozenModel(db, dec, env) as SummaryModel);
    const { noProgression, avbrottNoResult, ...old } = fresh;
    void noProgression;
    void avbrottNoResult;
    const strip = (x: SummaryModel["result"]["month"]) => {
      const { avbrott, ...r } = x;
      void avbrott;
      return r;
    };
    const oldModel = { ...old, result: { ...old.result, month: strip(old.result.month), rolling: strip(old.result.rolling), sinceStart: strip(old.result.sinceStart) } };
    expect(oldModel.byTrack.length).toBeGreaterThan(0);
    const snap: Report = { ...dec, snapshot: { reportId: dec.id, takenAt: "2027-01-12T10:05", deliveredAt: dec.deliveredAt, model: oldModel } };
    expect(J(reportModel(db, snap, env))).toEqual(oldModel);
    expect(driftedSinceDelivery(db, snap, env)).toBe(false);
    // En verklig ändring av underlaget upptäcks fortfarande: ett verifierat resultat i december blir inget resultat.
    const c = db.cases.find((x) => x.status === "closed" && x.endDate?.startsWith("2026-12") && x.resultClass === "result" && x.resultVerifiedAt)!;
    expect(driftedSinceDelivery({ ...db, cases: db.cases.map((x) => (x.id === c.id ? { ...x, resultClass: "no_result" as const } : x)) }, snap, env)).toBe(true);
    // En ny ögonblicksbild (med fälten) jämförs som vanligt.
    expect(driftedSinceDelivery(db, { ...snap, snapshot: { ...snap.snapshot!, model: fresh } }, env)).toBe(false);
  });
});
