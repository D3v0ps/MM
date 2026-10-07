// Servern lämnar inte ut priser, belopp, fakturaunderlag, viten, bonus eller interna mål till begränsade testare (beslut
// 2026-10-02) – vilken testperson de än agerar som. Karim (fullständig åtkomst) får samma svar som alla andra användare.
// Körs mot testdatat i minnet med samma hanterare som appen (MemoryRuntime); testaren simuleras med Actor.testerId, som servern
// sätter i testmiljön (src/server/identity.ts).
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { ApiError, commercialKeys, registeredKeys } from "@/api/server";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { entryText, readZip } from "@/core/export/read-zip.test-helper";
import { TEMPLATES } from "@/features/rapporter/api";
import { TESTER_HIDDEN_CODE, TESTER_HIDDEN_PAGE } from "./tester-access";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});

const KARIM = "tester-karim";
const SARA_T = "tester-sara";
/** Testpersonen som testaren agerar som (testerId = testarens egen profil). */
const as = (userId: string, role: Role, testerId?: string): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return testerId ? { ...p.actor, testerId } : p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const any = (key: string, input: unknown, actor: Actor): Promise<any> => rt.run("query", key, input, actor);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = (key: string, input: unknown, actor: Actor): Promise<any> => rt.run("command", key, input, actor);
const errorOf = async (p: Promise<unknown>): Promise<ApiError | null> => p.then(() => null, (e) => (e instanceof ApiError ? e : Promise.reject(e)));

/** Belopp i kronor (kr() skriver "13 980 kr" med hårt mellanslag) och interna mål i text. */
const AMOUNT = /\d[\u00a0 ]kr(?![a-zåäö])/i;
const INTERNAL = /internt mål[: ]+\d|Internt mål \d|internt mål:/i;
/** Nycklar som bara bär belopp, priser, viten eller interna mål. */
const MONEY_KEYS = /"(price|priceOre|amountOre|totalOre|penaltyOre|penaltiesOre|valueOre|unitPriceOre|vatOre|costOre|internalTarget|penalties|prices|bonusOn|dataProtection|subprocessors|unbilled|docGoalMinutes|responseGoal)"/;
/** Underbiträdena och deras regioner (underbiträdeslistan, regionlåsningen och integrationskorten). */
const VENDORS = /Supabase|Vercel|Resend|resend\._domainkey|Vertex|Google|Gemini|eu-north-1|eu-west-1|arn1/;

function expectClean(json: string, label: string) {
  expect(json, `${label}: belopp i kronor`).not.toMatch(AMOUNT);
  expect(json, `${label}: internt mål`).not.toMatch(INTERNAL);
  expect(json, `${label}: nycklar för belopp och mål`).not.toMatch(MONEY_KEYS);
  expect(json, `${label}: internt mål i ledningens mål`).not.toMatch(/"internal":0\./);
}

// ================================================================ Hela frågor och kommandon nekas
const DENIED = [
  "admin.contract", "admin.orgRules", "admin.setOrgRule",
  "ekonomi.askCoordinator", "ekonomi.billingApproveInvoice", "ekonomi.billingApproveZeroWeek", "ekonomi.billingExport", "ekonomi.billingMarkManual",
  "ekonomi.billingSendFortnox", "ekonomi.caseList", "ekonomi.case", "ekonomi.closeRun", "ekonomi.csv", "ekonomi.fortnoxLog", "ekonomi.fortnoxSync",
  "ekonomi.invoice", "ekonomi.preview", "ekonomi.reissue", "ekonomi.run", "ekonomi.start", "ekonomi.taskDone",
].sort();
/** En roll som får anropa nyckeln (rollkontrollen kommer före spärren). */
const roleFor = (key: string): [string, Role] =>
  key.startsWith("admin.") ? ["u-robin", "admin"] : ["ekonomi.run", "ekonomi.invoice", "ekonomi.csv", "ekonomi.preview", "ekonomi.case", "ekonomi.caseList", "ekonomi.start"].includes(key) ? ["u-karin", "chef"] : ["u-lars", "ekonom"];

describe("spärren i execute(): hela sidor om pengar och villkor", () => {
  it("exakt avtalssidans frågor och alla Ekonomis frågor och kommandon är markerade", () => {
    expect(commercialKeys().sort()).toEqual(DENIED);
    expect(registeredKeys().filter((k) => k.startsWith("ekonomi.")).every((k) => DENIED.includes(k))).toBe(true);
  });

  it("begränsad testare: varje nekad fråga och varje nekat kommando ger 403 tester_hidden", async () => {
    for (const key of DENIED) {
      const [userId, role] = roleFor(key);
      const kind = key === "admin.setOrgRule" || /ekonomi\.(billing|askCoordinator|closeRun|fortnox|reissue|taskDone)/.test(key) ? "command" : "query";
      const e = await errorOf(rt.run(kind, key, {}, as(userId, role, SARA_T)));
      expect(e?.status, key).toBe(403);
      expect(e?.code, key).toBe(TESTER_HIDDEN_CODE);
      expect(e?.message, key).toBe(TESTER_HIDDEN_PAGE);
    }
  });

  it("Karim och vanliga användare: samma svar som förut (inget tester_hidden)", async () => {
    for (const testerId of [KARIM, undefined]) {
      expect((await any("admin.contract", {}, as("u-robin", "admin", testerId))).priceItems.length).toBeGreaterThan(0);
      expect((await any("admin.contract", {}, as("u-robin", "admin", testerId))).contracts).toHaveLength(1);
      expect((await any("ekonomi.start", {}, as("u-karin", "chef", testerId)))).toBeTruthy();
      expect((await any("ekonomi.run", { month: "2027-01" }, as("u-lars", "ekonom", testerId)))).toBeTruthy();
      expect((await cmd("admin.setOrgRule", { remindCoachAfterWeeks: 1, escalateAfterConsecutiveWeeks: 2, escalateTo: ["chef"], channels: ["app"], assignmentChannels: ["app"] }, as("u-robin", "admin", testerId))).ok).toBe(true);
    }
  });

  it("begränsad testare som fortfarande agerar som ekonom (valt före spärren): allt utom sessionens frågor nekas", async () => {
    const lars = as("u-lars", "ekonom", SARA_T);
    for (const key of ["notiser.list", "ekonomi.start"]) expect((await errorOf(any(key, {}, lars)))?.code, key).toBe(TESTER_HIDDEN_CODE);
    expect(await any("session.navCounts", {}, lars)).toMatchObject({ inbox: 0 });
    expect(await any("session.ping", {}, lars)).toMatchObject({ role: "ekonom" });
    // Karim kan fortfarande vara ekonom.
    expect(await any("notiser.list", {}, as("u-lars", "ekonom", KARIM))).toBeTruthy();
  });
});

// ================================================================ Beloppsfälten saknas i svaren
describe("fält som tas bort för begränsade testare (och finns för Karim)", () => {
  it("deltagarkortet: beställningens veckor finns, priset saknas", async () => {
    const k = await any("arenden.kort", { caseId: "case-260117" }, as("u-sara", "samordnare", KARIM));
    const s = await any("arenden.kort", { caseId: "case-260117" }, as("u-sara", "samordnare", SARA_T));
    expect(k.order).toEqual({ weeks: expect.any(Number), priceOre: expect.any(Number) });
    expect(k.order.priceOre).toBeGreaterThan(0);
    expect(s.order).toEqual({ weeks: k.order.weeks });
    expect("priceOre" in s.order).toBe(false);
  });

  it("deltagarkortets händelser och coachens händelsesida: inget bonusunderlag", async () => {
    const k = await any("arenden.kortHandelser", { caseId: "case-260008" }, as("u-sara", "samordnare", KARIM));
    const s = await any("arenden.kortHandelser", { caseId: "case-260008" }, as("u-sara", "samordnare", SARA_T));
    expect(k.events.some((e: { possibleBonus: boolean }) => e.possibleBonus)).toBe(true);
    expect(s.events.some((e: { possibleBonus: boolean }) => e.possibleBonus)).toBe(false);
    const ck = await any("coach.eventsPage", { caseId: "case-260008" }, as("u-amira", "coach", KARIM));
    const cs = await any("coach.eventsPage", { caseId: "case-260008" }, as("u-amira", "coach", SARA_T));
    expect(ck.bonusOn).toBe(false);
    expect(ck.events.some((e: { possibleBonus: boolean }) => e.possibleBonus)).toBe(true);
    expect("bonusOn" in cs).toBe(false);
    expect(cs.events.some((e: { possibleBonus: boolean }) => e.possibleBonus)).toBe(false);
  });

  it("flaggorna: ingen flagga om ofakturerat (kr, länk till Ekonomi) och ingen om internt mål – avtalsmålets flagga finns kvar", async () => {
    const kl = await any("arenden.lista", {}, as("u-karin", "chef", KARIM));
    const sl = await any("arenden.lista", {}, as("u-karin", "chef", SARA_T));
    const kinds = (l: { rows: { detail: { flags: { kind: string }[] } | null }[] }) => l.rows.flatMap((r) => r.detail?.flags.map((f) => f.kind) ?? []);
    expect(kinds(kl)).toContain("unbilled");
    expect(kinds(sl)).not.toContain("unbilled");
    expect(JSON.stringify(kl)).toMatch(AMOUNT);
    expectClean(JSON.stringify(sl), "arenden.lista");
    const ko = await any("ledning.overview", {}, as("u-karin", "chef", KARIM));
    const so = await any("ledning.overview", {}, as("u-karin", "chef", SARA_T));
    expect(ko.flagAlerts.map((a: { key: string }) => a.key)).toEqual(expect.arrayContaining(["kpi:resultatgrad:internal"]));
    expect(so.flagAlerts.map((a: { key: string }) => a.key).filter((k: string) => k.startsWith("kpi:") || k.startsWith("unbilled:"))).toEqual([]);
  });

  it("ledningsvyn: inget internt mål, inget ofakturerat belopp och ingen länk till Ekonomi – avtalsmålet finns kvar", async () => {
    const k = await any("ledning.overview", {}, as("u-karin", "chef", KARIM));
    const s = await any("ledning.overview", {}, as("u-karin", "chef", SARA_T));
    expect(k.targets).toEqual({ contract: 0.32, internal: 0.35, minN: 10 });
    expect(s.targets).toEqual({ contract: 0.32, internal: null, minN: 10 });
    // 33,9 % ligger mellan avtalsmålet och det interna målet: "Bevaka" för Karim, "ok" (når avtalsmålet) för testaren.
    expect([k.rolling.status, s.rolling.status]).toEqual(["below_internal", "ok"]);
    expect(s.rolling.value).toBe(k.rolling.value);
    // Fakturaunderlaget (ofakturerade veckor, ärenden och belopp) lämnas inte ut alls.
    expect(k.unbilled).toMatchObject({ totalOre: 557400, weeks: 4, canOpenBilling: true });
    expect("unbilled" in s).toBe(false);
    expect(k.sla.targetText).toBe("internt mål 100\u00a0%");
    expect(s.sla.targetText).toBe("");
    expect(s.sla.rows.map((r: { target: unknown; status: string }) => [r.target, r.status])).toEqual([[null, "target_hidden"], [null, "target_hidden"], [null, "target_hidden"], [null, "target_hidden"]]);
    const rr = s.kpis.find((x: { key: string }) => x.key === "resultatgrad");
    expect(rr).toMatchObject({ target: null, contractTarget: 0.32, status: "ok" });
    expect(s.customer.contractTarget).toBe(0.32);
    expect(s.alertCount).toBeLessThan(k.alertCount);
    expectClean(JSON.stringify(s), "ledning.overview");
    for (const key of ["ledning.head", "ledning.coaches", "ledning.areas", "ledning.pulse"]) {
      expectClean(JSON.stringify(await any(key, {}, as("u-karin", "chef", SARA_T))), key);
    }
    expect((await any("ledning.coaches", {}, as("u-karin", "chef", SARA_T))).targets).toEqual({ contract: 0.32, internal: null, minN: 10 });
    expect((await any("ledning.coaches", {}, as("u-karin", "chef", KARIM))).targets.internal).toBe(0.35);
  });

  it("ledningsvyn: inga interna mål för dokumentationstid och svarsfrekvens (Karim ser dem)", async () => {
    const ck = await any("ledning.coaches", {}, as("u-karin", "chef", KARIM));
    const cs = await any("ledning.coaches", {}, as("u-karin", "chef", SARA_T));
    expect(ck.docGoalMinutes).toBe(5);
    expect("docGoalMinutes" in cs).toBe(false);
    expect(cs.allDoc).toBe(ck.allDoc);
    const pk = await any("ledning.pulse", {}, as("u-karin", "chef", KARIM));
    const ps = await any("ledning.pulse", {}, as("u-karin", "chef", SARA_T));
    expect(pk.responseGoal).toBe(0.6);
    expect("responseGoal" in ps).toBe(false);
    expect(ps.stats).toEqual(pk.stats);
  });

  it("revisionsloggen: faktureringens detaljer visas inte – raderna finns kvar", async () => {
    expect((await cmd("ekonomi.billingMarkManual", { month: "2027-01", caseId: "case-260072", invoiceNo: "12345" }, as("u-lars", "ekonom", KARIM))).ok).toBe(true);
    for (const who of [as("u-robin", "admin", SARA_T), as("u-karin", "chef", SARA_T)]) {
      const s = await any("admin.auditLog", {}, who);
      const k = await any("admin.auditLog", {}, { ...who, testerId: KARIM });
      const row = (l: { rows: { action: string; detailText: string; hasFull: boolean }[] }) => l.rows.find((r) => r.action === "billing.manual");
      expect(row(k)?.detailText).toBe("Månad: januari 2027 · Fakturanummer: 12345");
      expect(row(s)).toMatchObject({ detailText: "Visas inte för testare", hasFull: false });
      expect(JSON.stringify(s)).not.toContain("12345");
      const billing = s.rows.filter((r: { action: string }) => r.action.startsWith("billing.") || r.action === "export.billing");
      expect(billing.length).toBeGreaterThan(0);
      expect(billing.every((r: { detailText: string }) => r.detailText === "Visas inte för testare")).toBe(true);
      // Andra rader har sina detaljer som förut.
      expect(s.rows.filter((r: { action: string }) => !r.action.startsWith("billing.")).map((r: { detailText: string }) => r.detailText)).toEqual(
        k.rows.filter((r: { action: string }) => !r.action.startsWith("billing.")).map((r: { detailText: string }) => r.detailText),
      );
    }
  });

  it("beställarrapportens sammanfattning: spärren avslöjar inte det interna målet för testaren", async () => {
    const save = (summary: string, testerId: string) => cmd("rapporter.saveSummary", { reportId: "rep-16699", summary, aiUsed: false }, as("u-johan", "avtalsansvarig", testerId));
    // Karim: talet för det interna målet stoppas som förut.
    expect(await save("Resultatgraden är 35 %.", KARIM)).toMatchObject({ ok: false, error: "internal_target" });
    // Testaren: samma tal stoppas inte (annars går målet att lista ut). Orden "internt mål" stoppas för alla.
    expect(await save("Resultatgraden är 35 %.", SARA_T)).toMatchObject({ ok: true });
    expect(await save("Vi ligger under 35 procent.", SARA_T)).toMatchObject({ ok: true });
    const blocked = await save("Resultatgraden ligger under internt mål.", SARA_T);
    expect(blocked).toMatchObject({ ok: false, error: "internal_target" });
    expect(JSON.stringify(blocked)).not.toMatch(/35/);
  });

  it("avtalsavvikelser: inga viten i kronor (registret, detaljen, månadssammanställningen och exporttexten)", async () => {
    // Karim registrerar ett vite – testaren ser att avvikelsen finns, men inte beloppet.
    const reg = await cmd("ledning.cdevSave", { id: "cd-3", data: { escalationStep: 1, penaltyKind: "deviation", penaltyOffsetMonth: "2027-02" } }, as("u-johan", "avtalsansvarig", KARIM));
    expect(reg.ok).toBe(true);
    const k = await any("ledning.cdevRegister", {}, as("u-johan", "avtalsansvarig", KARIM));
    const s = await any("ledning.cdevRegister", {}, as("u-johan", "avtalsansvarig", SARA_T));
    expect(k.counts.penaltiesOre).toBe(2500000);
    expect(k.form.penalties).toEqual({ deviationOre: 2500000, insufficientInformationOre: expect.any(Number) });
    expect(k.rows.find((r: { id: string }) => r.id === "cd-3").penaltyOre).toBe(2500000);
    expect("penaltiesOre" in s.counts).toBe(false);
    expect("penalties" in s.form).toBe(false);
    expect(s.rows.every((r: object) => !("penaltyOre" in r))).toBe(true);
    expectClean(JSON.stringify(s), "ledning.cdevRegister");
    const dk = await any("ledning.cdevDetail", { id: "cd-3" }, as("u-johan", "avtalsansvarig", KARIM));
    const ds = await any("ledning.cdevDetail", { id: "cd-3" }, as("u-johan", "avtalsansvarig", SARA_T));
    expect(dk.cd).toMatchObject({ penaltyOre: 2500000, penaltyKind: "deviation", penaltyOffsetMonth: "2027-02" });
    for (const f of ["penaltyOre", "penaltyKind", "penaltyOffsetMonth"]) expect(f in ds.cd, f).toBe(false);
    expectClean(JSON.stringify(ds), "ledning.cdevDetail");
    const mk = await any("ledning.cdevMonth", { month: "2027-02" }, as("u-johan", "avtalsansvarig", KARIM));
    const ms = await any("ledning.cdevMonth", { month: "2027-02" }, as("u-johan", "avtalsansvarig", SARA_T));
    expect(mk.text).toContain("Viten hittills: 25\u00a0000\u00a0kr");
    expect(ms.text).not.toContain("Viten");
    expect("penaltiesOre" in ms).toBe(false);
    expectClean(JSON.stringify(ms), "ledning.cdevMonth");
    // Testarens formulär saknar vitesvalet: när testaren sparar ändras vitet aldrig (ett tomt val tar inte bort det).
    const save = await cmd("ledning.cdevSave", { id: "cd-3", data: { penaltyKind: null, penaltyOffsetMonth: null, warningIssued: false, orderStop: false, escalationStep: 1 } }, as("u-johan", "avtalsansvarig", SARA_T));
    expect(save.ok).toBe(true);
    expect(rt.raw().get("contract_deviations", "cd-3")).toMatchObject({ penaltyKind: "deviation", penaltyOre: 2500000, penaltyOffsetMonth: "2027-02" });
  });

  it("avropsinkorgen: beställningens värde, prisartiklarna, interna mål, vitet och fakturakörningen visas inte", async () => {
    const sam = (t?: string) => as("u-sara", "samordnare", t);
    const ck = await any("inkorg.confirmation", { caseId: "case-270039" }, sam(KARIM));
    const cs = await any("inkorg.confirmation", { caseId: "case-270039" }, sam(SARA_T));
    expect(ck.value).toMatch(AMOUNT);
    expect("value" in cs).toBe(false);
    const fk = await any("inkorg.decisionForm", { caseId: "case-270048" }, sam(KARIM));
    const fs = await any("inkorg.decisionForm", { caseId: "case-270048" }, sam(SARA_T));
    expect(fk.prices.length).toBeGreaterThan(0);
    expect("prices" in fs).toBe(false);
    const jk = await any("inkorg.start", {}, as("u-johan", "avtalsansvarig", KARIM));
    const js = await any("inkorg.start", {}, as("u-johan", "avtalsansvarig", SARA_T));
    expect(jk.warnings.text).toMatch(/Vite 25\u00a0000\u00a0kr/);
    expect(js.warnings).toEqual({ issued: jk.warnings.issued, max: jk.warnings.max, text: `${jk.warnings.max} varningar kan leda till uppsägning.` });
    expect(jk.kpis.map((k: { meter: { target: number } }) => k.meter.target)).toEqual([1, 1]);
    expect(js.kpis.map((k: { meter: { target: unknown; targetText: string }; below: boolean; value: string }) => [k.meter.target, k.meter.targetText, k.below])).toEqual([[null, "", false], [null, "", false]]);
    expect(js.kpis.map((k: { value: string }) => k.value)).toEqual(jk.kpis.map((k: { value: string }) => k.value));
    expectClean(JSON.stringify(js), "inkorg.start");
    const dk = await any("inkorg.deadlines", {}, sam(KARIM));
    const ds = await any("inkorg.deadlines", {}, sam(SARA_T));
    expect(dk.rows.some((r: { kind: string }) => r.kind === "fakturering")).toBe(true);
    expect(ds.rows.some((r: { kind: string }) => r.kind === "fakturering")).toBe(false);
    expect(ds.rows).toHaveLength(dk.rows.length - 1);
    expectClean(JSON.stringify(ds), "inkorg.deadlines");
  });

  it("kommunens portal: beställningsformulärets priser, deltagarsidans värde och bonusanspråket", async () => {
    const maria = (t?: string) => as("k-maria", "kommun_handlaggare", t);
    const bk = await any("kommun.bestallning", {}, maria(KARIM));
    const bs = await any("kommun.bestallning", {}, maria(SARA_T));
    expect(bk.prices.length).toBeGreaterThan(0);
    expect("prices" in bs).toBe(false);
    const dk = await any("kommun.deltagare", { caseId: "case-260008" }, maria(KARIM));
    const ds = await any("kommun.deltagare", { caseId: "case-260008" }, maria(SARA_T));
    expect(dk.order).toMatchObject({ priceOre: expect.any(Number), valueOre: expect.any(Number) });
    expect(dk.bonus).toBe(true);
    expect("priceOre" in ds.order || "valueOre" in ds.order).toBe(false);
    expect(ds.order.weeks).toBe(dk.order.weeks);
    expect(ds.bonus).toBe(false);
    expectClean(JSON.stringify(ds), "kommun.deltagare");
    // Avtalsmålet (32 %) ser kommunens chef i beställarrapporten – det döljs inte.
    expect((await any("kommun.chef", {}, as("k-eva", "kommun_chef", SARA_T))).contractTarget).toBe(0.32);
  });

  it("orderbekräftelsen (rapportsidan, portalen och PDF:en): veckopriset saknas – också i en fryst rapport", async () => {
    const id = "rep-16392";
    const k = await any("rapporter.dokument", { reportId: id }, as("u-sara", "samordnare", KARIM));
    const s = await any("rapporter.dokument", { reportId: id }, as("u-sara", "samordnare", SARA_T));
    expect(k.doc.kind).toBe("order_confirmation");
    expect(k.doc.m.price).toBeGreaterThan(0);
    expect("price" in s.doc.m).toBe(false);
    expect(s.doc.m.weeks).toBe(k.doc.m.weeks);
    // Frys rapporten (reports.snapshot) och läs igen – samma regel.
    expect((await cmd("rapporter.snapshot", { reportIds: [id] }, as("u-sara", "samordnare", KARIM))).ok).toBe(true);
    expect(rt.raw().get("reports", id)?.snapshot).toBeTruthy();
    const frozen = await any("rapporter.dokument", { reportId: id }, as("u-sara", "samordnare", SARA_T));
    expect("price" in frozen.doc.m).toBe(false);
    const portal = await any("rapporter.dokument", { reportId: id }, as("k-maria", "kommun_handlaggare", SARA_T));
    expect(portal.ok).toBe(true);
    expect("price" in portal.doc.m).toBe(false);
    expect((await any("rapporter.dokument", { reportId: id }, as("k-maria", "kommun_handlaggare", KARIM))).doc.m.price).toBeGreaterThan(0);
  });

  it("rapportbyggaren: inget internt mål i förhandsvisningen eller filerna – avtalets mål finns kvar", async () => {
    const def = structuredClone(TEMPLATES.find((t) => t.key === "resultatgrad-per-omrade")!.definition) as unknown as Record<string, unknown>;
    const input = { contractId: "c-bot", definition: def, audience: "mb" as const };
    const k = await cmd("rapporter.byggForhandsvisning", input, as("u-johan", "avtalsansvarig", KARIM));
    const s = await cmd("rapporter.byggForhandsvisning", input, as("u-johan", "avtalsansvarig", SARA_T));
    expect(k.ok && s.ok).toBe(true);
    expect(k.targets).toEqual([expect.objectContaining({ contractTarget: 0.32, internalTarget: 0.35 })]);
    expect(s.targets).toEqual([{ measure: "resultatgrad", label: expect.any(String), contractTarget: 0.32 }]);
    if (k.chart) expect(k.chart.internalTarget).toBe(0.35);
    if (s.chart) expect("internalTarget" in s.chart).toBe(false);
    for (const format of ["pdf", "xlsx"] as const) {
      const fk = await cmd("rapporter.byggExport", { contractId: "c-bot", definition: def, format }, as("u-johan", "avtalsansvarig", KARIM));
      const fs = await cmd("rapporter.byggExport", { contractId: "c-bot", definition: def, format }, as("u-johan", "avtalsansvarig", SARA_T));
      expect(fk.ok && fs.ok, format).toBe(true);
      if (format === "pdf") {
        expect(fk.pdf.targets[0].internalTarget).toBe(0.35);
        expect("internalTarget" in fs.pdf.targets[0]).toBe(false);
      } else {
        // Excel-fliken "Om rapporten" (xlsx som base64): raden "Internt mål" finns bara i Karims fil. Avtalets mål finns i båda.
        const about = async (b64: string) => entryText(await readZip(Uint8Array.from(Buffer.from(b64, "base64"))), "xl/worksheets/sheet2.xml");
        const [ak, as2] = [await about(fk.content), await about(fs.content)];
        expect(ak).toContain("Internt mål");
        expect(as2).not.toContain("Internt mål");
        expect(as2).toContain("Avtalets mål");
      }
    }
  });

  it("underbiträden och integrationer: korten Underbiträden, Regionlåsning och Så ser kommunen det saknas – bakgrundsjobben finns", async () => {
    const k = await any("admin.integrations", {}, as("u-robin", "admin", KARIM));
    const s = await any("admin.integrations", {}, as("u-robin", "admin", SARA_T));
    expect(k.dataProtection).toMatchObject({ approvedOn: "2026-09-29", thirdCountryForbidden: true, returnDataWithinDays: expect.any(Number) });
    // Rättad lista: Resend är vald och väntar på kommunens godkännande. SMS-leverantören är inte vald.
    expect(k.dataProtection.subprocessors.find((x: { id: string }) => x.id === "epost")).toEqual({
      id: "epost", name: "Resend (e-post)", what: "Notiser och inloggningskoder från notis@miljonmatch.se", where: "EU (Irland, eu-west-1)", status: "chosen", us: true,
    });
    expect(k.dataProtection.subprocessors.find((x: { id: string }) => x.id === "sms").status).toBe("not_chosen");
    expect("dataProtection" in s).toBe(false);
    expect(k.dataProtection.regions).toHaveLength(5);
    // Integrationskorten och nyckeltalet "Data lagras i": leverantörerna och regionerna finns bara hos Karim.
    expect(JSON.stringify(k)).toMatch(VENDORS);
    expect(JSON.stringify(s)).not.toMatch(VENDORS);
    expect(k.storage).toEqual({ place: "Stockholm", detail: "Supabase eu-north-1 · Vercel arn1" });
    expect(s.storage).toEqual({ place: "Stockholm" });
    expect(s.integrations.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual(k.integrations.map((x: { id: string; status: string }) => [x.id, x.status]));
    const labels = (v: { integrations: { id: string; items: [string, string][] }[] }, id: string) => v.integrations.find((x) => x.id === id)?.items.map(([l]) => l);
    expect(labels(k, "email")).toEqual(["Vald", "Avsändare", "DNS", "Godkännande"]);
    expect(labels(s, "email")).toEqual(["Avsändare"]);
    expect(labels(k, "ai")).toEqual(["Vald", "I test", "Aldrig", "Anrop"]);
    expect(labels(s, "ai")).toEqual(["Aldrig", "Anrop"]);
    expect(s.jobs.map((j: { key: string }) => j.key)).toEqual(k.jobs.map((j: { key: string }) => j.key));
    expect(s.jobs.length).toBe(8);
    expect([s.aiRunCount, s.latestMail, s.inboxReadAt]).toEqual([k.aiRunCount, k.latestMail, k.inboxReadAt]);
    // "Kör nu" fungerar för alla testare.
    expect((await cmd("admin.runJob", { key: "kpi" }, as("u-robin", "admin", SARA_T))).ok).toBe(true);
  });

  it("synpunkter: begränsade testare ser inte synpunkter från avtalssidan, Ekonomi eller rollen ekonom", async () => {
    const add = (path: string | null, actor: Actor) => cmd("feedback.submit", { type: "fel", priority: "kan", text: "Testtext", path, viewTitle: path ? "Sida" : null }, actor);
    expect((await add("/admin/avtal?flik=priser", as("u-robin", "admin", KARIM))).ok).toBe(true);
    expect((await add("/ekonomi/2027-01", as("u-karin", "chef", KARIM))).ok).toBe(true);
    expect((await add("/arenden", as("u-karin", "chef", KARIM))).ok).toBe(true);
    expect((await add(null, as("u-lars", "ekonom", KARIM))).ok).toBe(true);
    const k = await any("feedback.list", {}, as("u-robin", "admin", KARIM));
    const s = await any("feedback.list", {}, as("u-robin", "admin", SARA_T));
    expect(k).toHaveLength(4);
    expect(s.map((x: { path: string | null }) => x.path)).toEqual(["/arenden"]);
  });
});

// ================================================================ Allt annat: inga belopp och inga interna mål
describe("alla sidor för begränsade testare: inga belopp i kronor, inga prisnycklar och inga interna mål", () => {
  const CASE = "case-260117";
  const pages: [string, Record<string, unknown>, string, Role][] = [
    ["inkorg.start", {}, "u-sara", "samordnare"], ["inkorg.list", {}, "u-sara", "samordnare"], ["inkorg.deadlines", {}, "u-johan", "avtalsansvarig"],
    ["inkorg.start", {}, "u-johan", "avtalsansvarig"], ["inkorg.confirmation", { caseId: "case-270042" }, "u-johan", "avtalsansvarig"],
    ["arenden.lista", {}, "u-sara", "samordnare"], ["arenden.lista", {}, "u-karin", "chef"], ["arenden.lista", {}, "u-robin", "admin"],
    ["arenden.kort", { caseId: CASE }, "u-karin", "chef"], ["arenden.kort", { caseId: CASE }, "u-robin", "admin"], ["arenden.kort", { caseId: "case-260119" }, "u-amira", "coach"],
    ["arenden.kortOversikt", { caseId: CASE }, "u-sara", "samordnare"], ["arenden.kortHandelser", { caseId: "case-260007" }, "u-sara", "samordnare"],
    ["arenden.kortRapporter", { caseId: CASE }, "u-sara", "samordnare"], ["arenden.kortTidslinje", { caseId: CASE }, "u-sara", "samordnare"],
    ["arenden.kortManad", { caseId: CASE }, "u-sara", "samordnare"], ["arenden.handledare", {}, "u-petra", "handledare"],
    ["coach.minVecka", {}, "u-amira", "coach"], ["coach.narvaro", {}, "u-amira", "coach"], ["coach.eventsPage", { caseId: "case-260119" }, "u-amira", "coach"],
    ["ledning.overview", {}, "u-karin", "chef"], ["ledning.cdevRegister", {}, "u-sara", "samordnare"], ["ledning.cdevMonth", { month: "2027-01" }, "u-karin", "chef"],
    ["kommun.start", {}, "k-maria", "kommun_handlaggare"], ["kommun.bestallning", {}, "k-maria", "kommun_handlaggare"], ["kommun.deltagareLista", {}, "k-maria", "kommun_handlaggare"],
    ["kommun.deltagare", { caseId: "case-260119" }, "k-maria", "kommun_handlaggare"], ["kommun.rapporter", {}, "k-maria", "kommun_handlaggare"],
    ["kommun.chef", {}, "k-eva", "kommun_chef"], ["kommun.deltagare", { caseId: "case-260119" }, "k-eva", "kommun_chef"],
    ["rapporter.lista", {}, "u-sara", "samordnare"], ["rapporter.dokument", { reportId: "rep-16393" }, "u-karin", "chef"], ["rapporter.byggKatalog", {}, "u-karin", "chef"],
    ["admin.integrations", {}, "u-robin", "admin"], ["admin.users", {}, "u-robin", "admin"], ["admin.templates", {}, "u-robin", "admin"], ["admin.auditLog", {}, "u-robin", "admin"],
    ["notiser.list", {}, "u-karin", "chef"], ["notiser.list", {}, "u-amira", "coach"], ["praktik.list", {}, "u-sara", "samordnare"], ["session.navCounts", {}, "u-karin", "chef"],
  ];
  it("varje sida", async () => {
    for (const [key, input, userId, role] of pages) {
      const res = await any(key, input, as(userId, role, SARA_T));
      expect(res, `${key} som ${role}`).toBeTruthy();
      expectClean(JSON.stringify(res), `${key} som ${role}`);
    }
  });
  it("kontroll: samma sidor har belopp eller interna mål för Karim (testet hittar dem)", async () => {
    const found = [];
    for (const [key, input, userId, role] of pages) {
      const json = JSON.stringify(await any(key, input, as(userId, role, KARIM)));
      if (AMOUNT.test(json) || INTERNAL.test(json) || MONEY_KEYS.test(json) || /"internal":0\./.test(json)) found.push(key);
    }
    expect([...new Set(found)]).toEqual(expect.arrayContaining(["inkorg.start", "inkorg.deadlines", "inkorg.confirmation", "arenden.lista", "arenden.kort", "ledning.overview", "ledning.cdevRegister", "kommun.bestallning", "kommun.deltagare", "rapporter.dokument", "admin.integrations"]));
  });
});
