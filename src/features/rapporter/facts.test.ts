// Frysta fakta för kommunens resultatfil (rapporter steg 3, Del A): fakta stämmer med rapportens modell för varje
// månadsrapport i testdatat, bara godkända uppgifter, asOf = leveransen, frysningen vid leveransen och omvändningen från en
// fryst modell när ärendet ändrats efter leveransen.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { BOTKYRKA_CONFIG, requireOperational } from "@/core/config";
import { EVENT_LABEL, END_REASON_LABEL } from "@/core/labels";
import { monthEnd } from "@/core/time";
import { looksLikePnr } from "@/core/validation";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, TEST_PNR_CRYPTO } from "@/data/seed";
import { ACTIVITY_TYPES } from "@/data/seed/constants";
import { emptyDb, type AppRepo, type Db, type Report, type Tables } from "@/data/schema";
import { parseDFull, parseDocText, parseFacts, parseLevel, reconcileFinalFacts, reconcileMonthlyFacts, type FinalFacts, type MonthlyFacts } from "./facts";
import { ensureFacts, freezeReport, snapshotFacts } from "./freeze";
import { frozenFacts, frozenModel, reportFacts, reportModel, type FinalModel, type MonthlyModel, type ReportEnv } from "./model";
import { dFull, isDelivered, plain } from "./report-helpers";

const SEED = createSeed();
const db = { ...emptyDb(), ...(structuredClone(SEED) as unknown as Partial<Db>) } as Db;
const contract = db.contracts.find((c) => c.id === "c-bot")!;
const cfg = requireOperational(contract.config);
const env: ReportEnv = { cfg, contract: { id: contract.id, startsOn: contract.startsOn, supplierName: "Miljonbemanning AB" }, now: "2027-02-01T09:12", activityTypes: ACTIVITY_TYPES };
const areas = db.contract_areas.filter((a) => a.contractId === "c-bot");
const monthlies = db.reports.filter((r) => r.kind === "monthly");

/** Fakta ska stämma med modellen (samma datakälla, samma regler) – rad för rad. */
function expectFactsMatchModel(f: MonthlyFacts, m: MonthlyModel) {
  const b = Object.fromEntries(m.basics);
  expect(f.caseNumber).toBe(m.caseNumber);
  expect(f.month).toBe(m.month);
  expect(b["Ärendenummer"]).toBe(f.caseNumber);
  const area = areas.find((a) => a.code === f.primaryAreaCode);
  expect(b["Avtalsområde"]).toBe(area ? `${area.code} ${area.name}` : "–");
  expect(b["Yrkesspår"]).toBe(f.vocationalTrack ?? "Framgår inte");
  expect(b["Insatsen startade"]).toBe(dFull(f.startDate));
  if (f.endDate) expect(b["Insatsen avslutades"]).toBe(dFull(f.endDate));
  else expect(b["Planerat slut"]).toBe(dFull(f.plannedEnd));
  expect(b["Fas vid månadens slut"]).toBe(plain(`Fas ${f.phase} · ${cfg.phases.find((p) => p.no === f.phase)?.name ?? "–"}`));
  // Avsnitt 2
  const { planned, present, late, absentValid, absentInvalid, unregistered, rate } = m.total;
  expect(f.attendance).toEqual({ planned, present, late, absentValid, absentInvalid, unregistered, rate });
  expect(f.weeks).toBe(m.weeks.length);
  expect(f.pausedWeeks).toBe(m.weeks.filter((w) => w.paused).length);
  expect(f.repeatedAbsence).toBe(m.repeated.hit);
  // Avsnitt 3
  const n = /genomfördes (\d+) godkända veckoavstämningar/.exec(m.docText);
  expect(f.checkInsApproved).toBe(n ? Number(n[1]) : 0);
  const contacts = /Arbetsgivarkontakter: (\d+)/.exec(m.docText);
  if (contacts) expect(f.employerContacts).toBe(Number(contacts[1]));
  // Avsnitt 4
  expect(f.assessmentApproved).toBe(m.approved);
  if (m.progression) {
    for (const k of cfg.progression.areas) {
      const row = m.progression.rows.find((r) => r.key === k)!;
      expect(f.levels[k]).toBe(row.level === "Ej bedömd" ? null : Number(row.level.split(" – ")[0]));
    }
    expect(Object.keys(f.levels).sort()).toEqual([...cfg.progression.areas].sort());
    expect(f.areasAssessed).toBe(cfg.progression.areas.filter((k) => f.levels[k] != null).length);
    expect(f.overallStatus).toBe(m.assessment?.overallStatus ?? null);
  } else {
    expect([f.levels, f.areasAssessed, f.progressionClear, f.progressionAny, f.overallStatus, f.assessmentDate]).toEqual([{}, null, null, null, null, null]);
  }
  // Avsnitt 5
  expect(f.events.map((e) => [EVENT_LABEL[e.kind], dFull(e.date)])).toEqual(m.events.map((e) => [e.label, e.date]));
  // Avsnitt 6
  expect(f.deviationsNew).toBe(m.deviations.items.filter((i) => { const d = parseDFull(i.date); return !!d && d >= `${m.month}-01` && d <= monthEnd(m.month); }).length);
  expect(f.needsCustomerDecision).toBe(m.deviations.decision !== "Nej.");
  expect(f.deviationsOpen).toBeLessThanOrEqual(m.deviations.items.length);
}

describe("fakta stämmer med modellen", () => {
  it(`varje levererad månadsrapport i testdatat (${monthlies.filter(isDelivered).length} st): fakta vid leveransen = den frysta modellen`, () => {
    let n = 0;
    for (const r of monthlies.filter(isDelivered)) {
      const f = frozenFacts(db, r, env) as MonthlyFacts;
      expect(parseFacts(JSON.parse(JSON.stringify(f)))).toEqual(f);
      expectFactsMatchModel(f, frozenModel(db, r, env) as MonthlyModel);
      n++;
    }
    expect(n).toBe(271);
  });
  it("utkast: dagens data, och en ej godkänd bedömning ger tomma nivåer, flaggor, status och datum", () => {
    const drafts = monthlies.filter((r) => !isDelivered(r));
    expect(drafts.length).toBeGreaterThan(0);
    for (const r of drafts) expectFactsMatchModel(reportFacts(db, r, env) as MonthlyFacts, reportModel(db, r, env) as MonthlyModel);
    const notApproved = drafts.map((r) => reportFacts(db, r, env) as MonthlyFacts).filter((f) => !f.assessmentApproved);
    expect(notApproved.length).toBeGreaterThan(0);
  });
  it("inga namn, inga personnummer och ingen fritext i fakta", () => {
    const facts = monthlies.filter(isDelivered).map((r) => frozenFacts(db, r, env) as MonthlyFacts);
    const all = JSON.stringify(facts);
    const names = db.persons.flatMap((p) => [p.firstName, p.lastName]).filter((x) => x.length > 3);
    for (const name of new Set(names)) expect(all).not.toContain(`"${name}`);
    // Inga personnummer: varken testdatats (dekrypterade) eller något som liknar ett (andelen är ett decimaltal och tas bort först).
    for (const p of db.persons) if (p.personnummerEnc) expect(all).not.toContain(TEST_PNR_CRYPTO.decryptPnr(p.personnummerEnc).replace(/\D/g, "").slice(-10));
    expect(looksLikePnr(JSON.stringify(facts.map((f) => ({ ...f, attendance: { ...f.attendance, rate: null } }))))).toBe(false);
    for (const x of db.monthly_assessments.slice(0, 50)) if (x.summary) expect(all).not.toContain(x.summary);
    for (const x of db.deviations) expect(all).not.toContain(x.description);
    for (const x of db.outcome_events) if (x.actor) expect(all).not.toContain(`"${x.actor}"`);
  });
});

describe("bara godkända uppgifter och asOf", () => {
  const dec = db.reports.find((r) => r.id === "rep-16008")!; // NADIA december, levererad
  it("en händelse som registreras efter leveransen kommer inte med i de frysta fakta", () => {
    const before = frozenFacts(db, dec, env) as MonthlyFacts;
    const ev = { id: "oe-efter", caseId: dec.caseId!, kind: "arbetserbjudande" as const, occurredOn: "2026-12-15", actor: "Arbetsgivare AB", verificationKind: null, verificationPath: null, note: "", possibleBonus: false };
    const log = { id: "log-efter", occurredAt: "2027-02-01T09:13", actorId: "u-amira", action: "event.added", entity: "outcome_event", entityId: "oe-efter", contractId: "c-bot", details: {} };
    const changed: Db = { ...db, outcome_events: [...db.outcome_events, ev], audit_log: [...db.audit_log, log] };
    expect((frozenFacts(changed, dec, env) as MonthlyFacts).events).toEqual(before.events);
    // Dagens data (ett utkast för samma månad) har med den
    const draft: Report = { ...dec, id: "rep-utkast", status: "draft", deliveredAt: null };
    expect((reportFacts(changed, draft, env) as MonthlyFacts).events.length).toBe(before.events.length + 1);
  });
  it("ett utkast till avstämning räknas inte", () => {
    const f = frozenFacts(db, dec, env) as MonthlyFacts;
    const ci = db.check_ins.find((x) => x.caseId === dec.caseId && x.status === "approved" && x.heldAt.startsWith("2026-12"))!;
    const changed: Db = { ...db, check_ins: db.check_ins.map((x) => (x.id === ci.id ? { ...x, status: "draft" as const } : x)) };
    const live = reportFacts(changed, { ...dec, status: "draft", deliveredAt: null }, env) as MonthlyFacts;
    expect(live.checkInsApproved).toBe(f.checkInsApproved - 1);
  });
  it("tydlig/någon progression och antal bedömda räknas bara på de obligatoriska områdena – ett valfritt område på nivå 3 räknas inte", () => {
    const ma = db.monthly_assessments.find((m) => m.caseId === dec.caseId && m.month === dec.month)!;
    const areasLow = Object.fromEntries(Object.entries(ma.areas).map(([k, a]) => [k, { ...a, level: 1 as const }]));
    const changed: Db = {
      ...db,
      monthly_assessments: db.monthly_assessments.map((m) =>
        m.id === ma.id ? { ...m, areas: { ...areasLow, halsa_funktionellt: { level: 3 as const, observation: "x", nextStep: "", aiLevelSuggestion: null, aiObservationDraft: null } } } : m),
    };
    const f = frozenFacts(changed, dec, env) as MonthlyFacts;
    expect(f).toMatchObject({ assessmentApproved: true, areasAssessed: 10, progressionClear: false, progressionAny: true });
    expect(Object.keys(f.levels)).not.toContain("halsa_funktionellt");
    expect(JSON.stringify(f)).not.toMatch(/halsa|livskvalitet/);
  });
});

describe("omvändningen från en fryst modell", () => {
  it("parseDFull är en strikt omvändning av dFull", () => {
    expect(parseDFull("14 december 2026")).toBe("2026-12-14");
    expect(parseDFull("1 februari 2027")).toBe("2027-02-01");
    expect(parseDFull("–")).toBeNull();
    for (const bad of ["31 februari 2027", "14 dec 2026", "14 December 2026", "2026-12-14", "", "01 februari 2027"]) expect(parseDFull(bad)).toBeUndefined();
    expect(parseDFull(undefined)).toBeUndefined();
  });
  it("varje levererad månadsrapport: omvändningen från den frysta modellen ger samma fakta (inget ändrat, inget olöst)", () => {
    let n = 0;
    for (const r of monthlies.filter(isDelivered)) {
      const f = frozenFacts(db, r, env) as MonthlyFacts;
      const m = frozenModel(db, r, env) as MonthlyModel;
      const rec = reconcileMonthlyFacts(f, m, { cfg, areas, events: db.outcome_events.filter((e) => e.caseId === r.caseId) });
      expect({ id: r.id, changed: rec.changed, unresolved: rec.unresolved }).toEqual({ id: r.id, changed: [], unresolved: [] });
      expect(rec.facts).toEqual(f);
      n++;
    }
    expect(n).toBe(271);
  });
  it("avsnitt 3 och nivåerna ur modellens text", () => {
    expect(parseLevel("2 – tydlig")).toBe(2);
    expect(parseLevel("0 – ingen / för tidigt att bedöma")).toBe(0);
    expect(parseLevel("Ej bedömd")).toBeNull();
    expect(parseLevel("tydlig")).toBeUndefined();
    expect(parseDocText("Inga godkända veckoavstämningar finns för oktober 2026.")).toEqual({ checkIns: 0, contacts: 0, goals: { yes: 0, partly: 0, no: 0 } });
    expect(parseDocText("Under oktober 2026 genomfördes 4 godkända veckoavstämningar. Deltagaren har arbetat med cv och intervjuträning. Arbetsgivarkontakter: 3 (ansökan, intervju). Veckomålet uppnåddes 1 gång, delvis 2 gånger och inte 1 gång."))
      .toEqual({ checkIns: 4, contacts: 3, goals: { yes: 1, partly: 2, no: 1 } });
    expect(parseDocText("Under oktober 2026 genomfördes 1 godkända veckoavstämningar. Arbetsgivarkontakter: 0. Veckomålet uppnåddes 0 gånger, delvis 0 gånger och inte 1 gång."))
      .toEqual({ checkIns: 1, contacts: 0, goals: { yes: 0, partly: 0, no: 1 } });
    expect(parseDocText("Coachen har skrivit om texten.")).toBeUndefined();
  });
  it("slutrapportens resultattext: verifierat, väntar på verifiering, exkluderat", () => {
    const base: FinalFacts = { factsVersion: 1, kind: "final", caseNumber: "BOT-26-0001", endDate: "2027-01-29", endReason: "arbete", resultClass: "result", resultVerified: true, resultVerifiedAt: "2027-02-01" };
    const model = (resultText: string, reason = "Arbete"): FinalModel => ({ kind: "final", caseId: "c", caseNumber: "BOT-26-0001", basics: [["Insatsen avslutades", "29 januari 2027"], ["Avslutsorsak", reason]], resultText } as unknown as FinalModel);
    expect(reconcileFinalFacts(base, model("Arbete eller studier – väntar på verifiering. Räknas inte som resultat förrän underlaget är verifierat."), END_REASON_LABEL).facts)
      .toMatchObject({ resultClass: "result", resultVerified: false, resultVerifiedAt: null });
    expect(reconcileFinalFacts({ ...base, resultVerified: false, resultVerifiedAt: null }, model("Arbete eller studier – verifierat 30 januari 2027."), END_REASON_LABEL).facts)
      .toMatchObject({ resultVerified: true, resultVerifiedAt: "2027-01-30" });
    expect(reconcileFinalFacts(base, model("Avslutet räknas inte i resultatgraden (avbrott som inte beror på insatsen).", "Avbrott: flytt"), END_REASON_LABEL).facts)
      .toMatchObject({ resultClass: "excluded", endReason: "avbrott_flytt" });
    expect(reconcileFinalFacts(base, model("Något annat"), END_REASON_LABEL).unresolved).toEqual(["resultClass"]);
  });
});

// ================================================================ Frysningen mot datalagret (ctx)
function runtime() {
  const store = new MemoryStore<Tables>(structuredClone(SEED));
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  let seq = 0;
  const ctx = (actor: Actor = SYSTEM_ACTOR, now = "2027-02-01T09:12"): Ctx => ({
    actor, now: () => now, repo: new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo, system, newId: (p) => `${p}-t${++seq}`,
    audit: async (e) => {
      store.insertRow("audit_log", { id: `log-t${++seq}`, occurredAt: now, actorId: actor.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined, crypto: TEST_PNR_CRYPTO,
  });
  return { store, ctx };
}

describe("ögonblicksbilden", () => {
  it("frysningen sparar modellen och fakta i samma pass; en andra frysning gör inget", async () => {
    const { store, ctx } = runtime();
    expect(await freezeReport(ctx(), "rep-16008")).toBe(true);
    const r = store.getRow("reports", "rep-16008")!;
    expect(r.snapshot).toMatchObject({ reportId: "rep-16008", model: { kind: "monthly" }, facts: { kind: "monthly", caseNumber: "BOT-26-0143", month: "2026-12" } });
    expect(snapshotFacts(r)).toEqual(frozenFacts({ ...db }, db.reports.find((x) => x.id === "rep-16008")!, env));
    expect(await freezeReport(ctx(), "rep-16008")).toBe(false);
  });

  it("ändrat ärende efter leveransen: fakta tas ur den frysta modellen – den levande ändringen syns inte", async () => {
    const { store, ctx } = runtime();
    // Ögonblicksbild med bara modellen, som före steg 3.
    await freezeReport(ctx(), "rep-16008");
    const snap = store.getRow("reports", "rep-16008")!.snapshot!;
    store.updateRow("reports", "rep-16008", { snapshot: { reportId: snap.reportId, takenAt: snap.takenAt, deliveredAt: snap.deliveredAt, model: snap.model } });
    const before = snap.facts as MonthlyFacts;
    const c = store.getRow("cases", "case-260143")!;
    const otherArea = areas.find((a) => a.code !== c.primaryAreaCode)!.code;
    store.updateRow("cases", c.id, { vocationalTrack: "Ett helt annat spår", primaryAreaCode: otherArea, plannedEnd: "2027-06-30", phase: 5 });
    const f = (await ensureFacts(ctx(), "rep-16008")) as MonthlyFacts;
    expect(f.vocationalTrack).toBe(before.vocationalTrack);
    expect(f.primaryAreaCode).toBe(before.primaryAreaCode);
    expect(f.plannedEnd).toBe(before.plannedEnd);
    expect(f.phase).toBe(before.phase);
    expect(f).toEqual(before);
    expect(JSON.stringify(store.getRow("reports", "rep-16008")!.snapshot)).not.toContain("Ett helt annat spår");
    // Modellen lämnas orörd, och inget behövde loggas.
    expect(store.getRow("reports", "rep-16008")!.snapshot!.model).toEqual(snap.model);
    expect(store.rows("audit_log").filter((l) => l.action === "report.facts_drift")).toEqual([]);
  });

  it("ett värde som inte går att föra tillbaka behåller det levande värdet och loggas som report.facts_drift utan värden", async () => {
    const { store, ctx } = runtime();
    await freezeReport(ctx(), "rep-16008");
    const snap = store.getRow("reports", "rep-16008")!.snapshot!;
    const model = JSON.parse(JSON.stringify(snap.model)) as MonthlyModel;
    model.basics = model.basics.map(([k, v]) => (k === "Avtalsområde" ? [k, "Z Okänt område"] : [k, v]));
    store.updateRow("reports", "rep-16008", { snapshot: { reportId: snap.reportId, takenAt: snap.takenAt, deliveredAt: snap.deliveredAt, model } });
    const f = (await ensureFacts(ctx(), "rep-16008")) as MonthlyFacts;
    expect(f.primaryAreaCode).toBe((snap.facts as MonthlyFacts).primaryAreaCode);
    const drift = store.rows("audit_log").filter((l) => l.action === "report.facts_drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ entity: "report", entityId: "rep-16008", contractId: "c-bot", details: { fields: ["primaryAreaCode"] } });
    expect(JSON.stringify(drift[0])).not.toMatch(/Okänt|BOT-|Nadia|Warsame/);
  });

  it("ögonblicksbild med bara modellen och underlag som ändrats efter leveransen: närvaron och bedömningen tas ur modellen", async () => {
    // Granskarens scenario: rep-15207 (BOT-26-0001, oktober 2026). Ett oktobertillfälle registreras om (samma status, ny
    // tidpunkt) och oktoberbedömningen godkänns igen – båda efter leveransen. Kommunens rapport (den frysta modellen) är
    // oförändrad, och filen ska ha samma siffror.
    const { store, ctx } = runtime();
    const rid = "rep-15207";
    await freezeReport(ctx(), rid);
    const snap = store.getRow("reports", rid)!.snapshot!;
    const before = snap.facts as MonthlyFacts;
    expect(before).toMatchObject({ caseNumber: "BOT-26-0001", month: "2026-10", assessmentApproved: true, attendance: { unregistered: 0 } });
    store.updateRow("reports", rid, { snapshot: { reportId: snap.reportId, takenAt: snap.takenAt, deliveredAt: snap.deliveredAt, model: snap.model } });
    const r = store.getRow("reports", rid)!;
    const att = store.rows("attendance").find((a) => a.caseId === r.caseId && store.rows("activities").some((x) => x.id === a.activityId && x.startsAt.startsWith("2026-10")))!;
    store.updateRow("attendance", att.id, { registeredAt: "2027-02-01T09:13" });
    const ma = store.rows("monthly_assessments").find((m) => m.caseId === r.caseId && m.month === "2026-10")!;
    store.updateRow("monthly_assessments", ma.id, { decidedAt: "2027-02-01T09:13" });
    // Utan omvändningen skulle fakta räknade i efterhand skilja sig (det är det som prövas).
    const live = frozenFacts({ ...emptyDb(), ...(store.data as unknown as Partial<Db>) } as Db, r, env) as MonthlyFacts;
    expect(live.attendance.unregistered).toBe(1);
    expect(live.assessmentApproved).toBe(false);
    const f = (await ensureFacts(ctx(), rid)) as MonthlyFacts;
    expect(f).toEqual(before);
    expect(store.rows("audit_log").filter((l) => l.action === "report.facts_drift")).toEqual([]);
  });

  it("en omskriven text i avsnitt 3 går inte att föra tillbaka: det levande värdet behålls och loggas utan värden", async () => {
    const { store, ctx } = runtime();
    await freezeReport(ctx(), "rep-16008");
    const snap = store.getRow("reports", "rep-16008")!.snapshot!;
    const model = { ...(JSON.parse(JSON.stringify(snap.model)) as MonthlyModel), docText: "Coachen har skrivit om texten." };
    store.updateRow("reports", "rep-16008", { snapshot: { reportId: snap.reportId, takenAt: snap.takenAt, deliveredAt: snap.deliveredAt, model } });
    const f = (await ensureFacts(ctx(), "rep-16008")) as MonthlyFacts;
    expect(f.checkInsApproved).toBe((snap.facts as MonthlyFacts).checkInsApproved);
    const drift = store.rows("audit_log").filter((l) => l.action === "report.facts_drift");
    expect(drift.map((l) => l.details)).toEqual([{ fields: ["checkInsApproved", "employerContacts", "goals"] }]);
  });

  it("utkast och rapporter utan fakta (veckorapport) får inga fakta", async () => {
    const { ctx } = runtime();
    expect(await ensureFacts(ctx(), "rep-16011")).toBeNull(); // NADIA januari – utkast
    expect(BOTKYRKA_CONFIG.casePrefix).toBe("BOT");
  });
});
