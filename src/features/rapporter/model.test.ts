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
import { ACTIVITY_TYPES } from "@/data/seed/constants";
import { emptyDb, type Db, type Report } from "@/data/schema";
import { canonicalJson, driftedSinceDelivery, frozenModel, reportModel, summaryFromNumbers, type OrderModel, type ReportEnv, type SummaryModel } from "./model";
import { effStatus, periodText, reportTitle, statusLabel } from "./report-helpers";

type FacitRow = { model: string; title: string; period: string; eff: string; statusLabel: string; next: string; overdue: boolean; week: boolean };
type Facit = { meta: { now: string; count: number }; sample: Record<string, { id: string; model: unknown }>; reports: Record<string, FacitRow> };
const facit = JSON.parse(readFileSync(new URL("./parity/facit.json", import.meta.url), "utf8")) as Facit;

const db = { ...emptyDb(), ...(createSeed() as unknown as Partial<Db>) } as Db;
const contract = db.contracts.find((c) => c.id === "c-bot")!;
const supplier = db.organizations.find((o) => o.id === contract.supplierId)!;
const env: ReportEnv = { cfg: requireOperational(contract.config), contract: { id: contract.id, startsOn: contract.startsOn, supplierName: supplier.name }, now: facit.meta.now, activityTypes: ACTIVITY_TYPES };
const hash = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex").slice(0, 16);
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rep = (id: string) => db.reports.find((r) => r.id === id)!;
/**
 * Dokumenterad avvikelse (beslut 2026-10-07, synpunkt #10): orderbekräftelsen har inget veckopris – fältet price är ersatt av
 * omfattningen i text (period). Jämförelsen kontrollerar omfattningen för sig och lägger tillbaka prototypens pris, så att alla
 * andra fält fortfarande jämförs med facit.
 */
function asPrototype(r: Report, m: unknown): unknown {
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
