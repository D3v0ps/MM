// Tester för rapporternas frågor och egna kommandon – samma steg som prototypens tools/test-rapporter.mjs (det som inte
// syns på skärmen: revisionslogg, utskick, ögonblicksbild) plus behörigheten. Körs genom execute() mot testdatat i minnet
// som testpersonerna i rollväljaren (behörighet via policy.ts), precis som prototypen och riktiga appen.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { execute } from "@/api/handlers";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { ApiError, type Ctx } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import type { AppRepo, Report, TableName, Tables } from "@/data/schema";
import { ensureFacts } from "./freeze";
import { orderPeriodText } from "@/core/cases";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { assessmentSave, attendanceSet } from "@/features/coach/api";
import { caseClose } from "@/features/arenden/api";
import {
  reportApprove, reportCorrect, reportCorrectionNote, reportDeliver, reportDocument, reportList, reportOpen, reportQualityReview, reportSaveFinal, reportSaveSummary,
  reportSnapshot, reportView, type ReportDocResult, type ReportView, type WeeklyModel,
} from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});

const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const row = <N extends TableName>(name: N, id: string): Tables[N] | undefined => rt.raw().get(name, id);

const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const amira = () => as("u-amira", "coach");
/** Den vilande rollen handledare (beslut 2026-10-09) – se dormant-role.test-helper.ts. */
const petra = () => dormantSupervisor();
const maria = () => as("k-maria", "kommun_handlaggare");
const omar = () => as("k-omar", "kommun_handlaggare");

// Testdatat (samma id:n som i den gamla prototypen)
const NADIA = "case-260143";
const NADIA_JAN = "rep-16011";
const NADIA_DEC = "rep-16008";
const APPROVED_JAN = "rep-15642";
const CS_JAN = "rep-16699";
const CS_DEC = "rep-16698";
const WEEKLY_WAIT = "rep-16692";
const FIN_DEL = "rep-16258";
const PROT_JAN = "rep-15885";
const PROT_DEL = "rep-15882";
/** Den vilande spärren (beslut 2026-10-07): personen i case-260120 får skyddade personuppgifter – testdatat har inga. */
const protect = () => rt.store.updateRow("persons", row("cases", "case-260120")!.personId, { protectedIdentity: true });

const view = async (id: string, actor: Actor) => (await ask(reportView, { reportId: id }, actor)) as ReportView;
const doc = async (id: string, actor: Actor) => ask(reportDocument, { reportId: id }, actor);
const okDoc = async (id: string, actor: Actor) => {
  const d = await doc(id, actor);
  if (!d.ok) throw new Error(`Rapporten ${id} visas inte: ${d.reason}`);
  return d;
};
const text = (x: unknown) => JSON.stringify(x);

async function approveNadiaJanAssessment() {
  const areas = Object.fromEntries(BOTKYRKA_CONFIG.progression.areas.map((k) => [k, { level: 1 as const, observation: "Följer instruktionen utan stöd.", nextStep: "Fortsätta öva." }]));
  return run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, summary: "Deltagaren följer planen.", overallStatus: "green", approve: true }, amira());
}
async function deliverNadiaJan() {
  expect(await approveNadiaJanAssessment()).toMatchObject({ ok: true });
  expect(await run(reportApprove, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
  expect(await run(reportDeliver, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
  // Frusen redan vid leveransen (rapporter steg 3) – rap.snapshot har inget kvar att göra.
  expect(await run(reportSnapshot, { reportIds: [NADIA_JAN] }, amira())).toMatchObject({ ok: true, reportIds: [] });
}

// ================================================================ 1. Listan
describe("1. rapportlistan", () => {
  it("samordnaren ser alla 794 rapporter med snabbfilter, typer och sökning", async () => {
    const l = await ask(reportList, {}, sara());
    expect(l.rows).toHaveLength(794);
    expect(l.coach).toBe(false);
    expect(`${l.customerName} · avtal ${l.contractNumber}`).toBe("Botkyrka kommun · avtal 332026110");
    const overdue = rows("reports").filter((r) => !r.superseded && !["delivered", "opened"].includes(r.status) && r.dueAt && r.dueAt < DEMO_START).length;
    expect(l.rows.filter((x) => x.overdue)).toHaveLength(overdue);
    expect(l.rows.filter((x) => x.kind === "customer_summary").map((x) => x.title)).toContain("Beställarrapport januari 2027");
    expect(l.rows.filter((x) => x.kind === "customer_summary")).toHaveLength(4);
    expect(l.rows.filter((x) => x.kind === "customer_summary" && x.search.includes("december"))).toHaveLength(1);
    expect(l.rows.some((x) => x.provisional)).toBe(true);
    expect(text(l)).not.toMatch(/deadline/i);
    // Ärendet som hade skyddade personuppgifter är ett vanligt ärende i dag (beslut 2026-10-07).
    expect(l.rows.find((x) => x.id === PROT_JAN)?.sub).toBe("BOT-26-0120 · Sanna Lindgren");
  });

  it("nästa steg, försenad och förfaller denna vecka är desamma som i den gamla prototypen (facit)", async () => {
    type F = { title: string; eff: string; statusLabel: string; next: string; overdue: boolean; week: boolean };
    const facit = JSON.parse(readFileSync(new URL("./parity/facit.json", import.meta.url), "utf8")) as { reports: Record<string, F> };
    const l = await ask(reportList, {}, sara());
    // Dokumenterad avvikelse (beslut 2026-10-07): beställarrapporterna lämnas till kommunen utanför Miljonmatch – de är
    // levererade men aldrig kvitterade i portalen (prototypen: öppnade av kommunens chef).
    const cs = new Set(rows("reports").filter((r) => r.kind === "customer_summary" && r.status === "delivered").map((r) => r.id));
    expect(cs.size).toBe(3);
    for (const id of cs) {
      expect(facit.reports[id]).toMatchObject({ eff: "opened", statusLabel: "Kvitterad", next: "done:Mottagaren har öppnat rapporten" });
      Object.assign(facit.reports[id], { eff: "delivered", statusLabel: "Lämnad till kommunen", next: "done:Lämnad till kommunen utanför Miljonmatch" });
    }
    const diff = l.rows.filter((x) => {
      const f = facit.reports[x.id];
      return !f || f.title !== x.title || f.eff !== x.eff || f.statusLabel !== x.statusLabel || f.next !== `${x.next.key}:${x.next.label}` || f.overdue !== x.overdue || f.week !== x.week;
    });
    expect(diff.map((x) => x.id)).toEqual([]);
  });

  it("coachen ser bara egna ärenden och veckorapporter där hon har deltagare", async () => {
    const l = await ask(reportList, {}, amira());
    expect(l.coach).toBe(true);
    const foreign = rows("cases").find((c) => c.leadCoachId !== "u-amira" && c.status === "active")!;
    expect(text(l.rows)).not.toContain(foreign.caseNumber);
    expect(l.rows.some((x) => x.kind === "customer_summary")).toBe(false);
    expect(l.rows.some((x) => x.kind === "weekly_attendance")).toBe(true);
  });

  it("handledare och kommunen når inte listan", async () => {
    await expect(ask(reportList, {}, petra())).rejects.toBeInstanceOf(ApiError);
    await expect(ask(reportList, {}, maria())).rejects.toBeInstanceOf(ApiError);
  });
});

// ================================================================ Dokumentet via hanteraren (datainläsningen) = facit
describe("rapporter.dokument läser rätt underlag", () => {
  type Sample = Record<string, { id: string; model: Record<string, unknown> & { sections?: unknown[] } }>;
  const sample = (JSON.parse(readFileSync(new URL("./parity/facit.json", import.meta.url), "utf8")) as { sample: Sample }).sample;
  for (const [name, s] of Object.entries(sample)) {
    it(`${name} (${s.id}) som avtalsansvarig`, async () => {
      const d = await okDoc(s.id, johan());
      if (d.doc.kind === "weekly_attendance") {
        const { sections, ...rest } = s.model;
        expect(d.doc.m).toEqual(rest);
        expect(d.doc.total).toBe(sections?.length);
        expect(d.doc.sections.map((x) => (x.restricted ? x : (({ name: _n, restricted: _r, ...y }) => (void _n, void _r, y))(x)))).toEqual(sections);
      } else if (d.doc.kind === "order_confirmation") {
        // Dokumenterad avvikelse (beslut 2026-10-07, synpunkt #10): inget veckopris – omfattningen i text i stället.
        const { price, ...rest } = s.model;
        expect(price).toEqual(expect.any(Number));
        expect(d.doc.m).toEqual({ ...rest, period: orderPeriodText(row("cases", d.doc.m.caseId)!) });
        expect(JSON.stringify(d.doc)).not.toMatch(/price|kr\b/i);
      } else expect(d.doc.m).toEqual(s.model);
    });
  }
});

// ================================================================ 2. Månadsrapport: blockerad → godkänn → leverera
describe("2. månadsrapport januari (Nadia) – bara godkända uppgifter", () => {
  it("blockerad tills månadsbedömningen är godkänd; sedan godkänn och leverera i portalen med ett mejl utan personuppgifter", async () => {
    const v1 = await view(NADIA_JAN, amira());
    expect(v1).toMatchObject({ ok: true, next: { key: "blocked" }, blocked: { monthText: "januari 2027", missing: false, canOpen: true }, actions: { approve: false } });
    const d1 = await okDoc(NADIA_JAN, amira());
    expect(d1.doc).toMatchObject({ kind: "monthly", participant: "Nadia Warsame", m: { approved: false, progression: null, plan: null, assessment: null } });
    expect(text(d1)).not.toMatch(/\d{6,8}-\d{4}/);

    expect(await approveNadiaJanAssessment()).toMatchObject({ ok: true });
    expect(row("reports", NADIA_JAN)!.status).toBe("reviewed");
    const d2 = await okDoc(NADIA_JAN, amira());
    expect(d2.doc).toMatchObject({ m: { approved: true, assessment: { overallStatus: "green", summary: "Deltagaren följer planen." } } });
    const v2 = await view(NADIA_JAN, amira());
    expect(v2).toMatchObject({ statusLabel: "Granskad av coach", actions: { approve: true, deliver: false } });

    expect(await run(reportApprove, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
    const v3 = await view(NADIA_JAN, amira());
    expect(v3).toMatchObject({ statusLabel: "Godkänd", actions: { deliver: true }, delivery: { attachmentAllowed: false, recipientName: "Maria Ekdahl", notice: "Månadsrapport individ för ärende BOT-26-0143 finns i portalen – logga in för att läsa." } });
    expect(v3.approved).toMatch(/av Amira Haddad$/);

    const n = rows("outbound_messages").length;
    expect(await run(reportDeliver, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
    expect(row("reports", NADIA_JAN)).toMatchObject({ status: "delivered", deliveredTo: ["k-maria"] });
    const mail = rows("outbound_messages").slice(n);
    expect(mail).toHaveLength(1);
    expect(mail[0].body).toMatch(/BOT-26-0143/);
    expect(mail[0].body).not.toMatch(/Nadia|Warsame/);
    // Leveransen fryser innehållet direkt (rapporter steg 3): modellen och fakta för kommunens resultatfil, takenAt = leveransen.
    const delivered = row("reports", NADIA_JAN)!;
    const snap = delivered.snapshot as { reportId: string; takenAt: string; deliveredAt: string; model: { kind: string }; facts: { kind: string; caseNumber: string } };
    expect(snap).toMatchObject({ reportId: NADIA_JAN, takenAt: delivered.deliveredAt, deliveredAt: delivered.deliveredAt, model: { kind: "monthly" }, facts: { kind: "monthly", caseNumber: "BOT-26-0143" } });
    // rap.snapshot (när någon öppnar rapporten) hoppar över den redan frysta rapporten – tyst, klockan står still.
    const t = rt.clock.now();
    expect(await run(reportSnapshot, { reportIds: [NADIA_JAN] }, amira())).toMatchObject({ ok: true, reportIds: [] });
    expect(rt.clock.now()).toBe(t);
  });

  it("frysningen misslyckas vid leveransen: rapporten är levererad, report.delivered loggas och notisen skickas – frysningen görs senare", async () => {
    expect(await approveNadiaJanAssessment()).toMatchObject({ ok: true });
    expect(await run(reportApprove, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
    // Samma ctx som minnesläget, men skrivningen av ögonblicksbilden (systemsteg) kastar – som ett tillfälligt databasfel.
    const actor = amira();
    const store = rt.store;
    const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
    const audits: string[] = [];
    const notices: string[] = [];
    let seq = 0;
    const ctx: Ctx = {
      actor, now: () => "2027-02-01T10:00", repo: new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo,
      system: {
        table: ((name: TableName) => {
          const t = system.table(name as never) as unknown as Record<string, unknown>;
          if (name !== "reports") return t;
          return {
            ...t,
            update: async (id: string, patch: Partial<Report>) => {
              if ("snapshot" in patch) throw Object.assign(new Error("tillfälligt fel"), { name: "DataError" });
              return (t.update as (i: string, p: Partial<Report>) => Promise<Report>)(id, patch);
            },
          };
        }) as unknown as AppRepo["table"],
      } as AppRepo,
      newId: (p) => `${p}-f${++seq}`, crypto: TEST_PNR_CRYPTO,
      audit: async (e) => void audits.push(e.action),
      notify: async (m) => void notices.push(m.template ?? ""),
    };
    const err = console.error;
    const logged: unknown[][] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      expect(await execute("command", reportDeliver.key, { reportId: NADIA_JAN }, ctx)).toMatchObject({ ok: true });
    } finally {
      console.error = err;
    }
    expect(row("reports", NADIA_JAN)).toMatchObject({ status: "delivered", deliveredAt: "2027-02-01T10:00", snapshot: null });
    expect(audits).toContain("report.delivered");
    expect(notices).toEqual(["ny_rapport"]);
    // Serverloggen har bara rapportens id och feltypen – inga värden.
    expect(logged).toEqual([["rapport: frysningen vid leveransen misslyckades", NADIA_JAN, "DataError"]]);
    // Senare (när rapporten öppnas eller vid kommunens export) fryses den med underlaget vid leveransen.
    const f = await ensureFacts({ ...ctx, system }, NADIA_JAN);
    expect(f).toMatchObject({ kind: "monthly", caseNumber: "BOT-26-0143", assessmentApproved: true });
    expect(row("reports", NADIA_JAN)!.snapshot).toMatchObject({ reportId: NADIA_JAN, deliveredAt: "2027-02-01T10:00", model: { kind: "monthly" } });
  });
});

// ================================================================ 3. Kommunens perspektiv och kvittens
describe("3. kommunen öppnar rapporten", () => {
  it("handläggaren ser den levererade rapporten, kvitterar vid första visningen och visningen loggas; inga interna knappar", async () => {
    await deliverNadiaJan();
    const d = await okDoc(NADIA_JAN, maria());
    expect(d.portal).toMatchObject({ isRecipient: true, openedAt: null, title: "Månadsrapport januari 2027", participant: "Nadia Warsame", caseNumber: "BOT-26-0143", canMessage: true });
    expect(await run(reportOpen, { reportId: NADIA_JAN }, maria())).toMatchObject({ ok: true, acknowledged: true });
    expect((await okDoc(NADIA_JAN, maria())).portal?.openedAt).toBeTruthy();
    expect(rows("audit_log").some((l) => l.action === "report.view" && l.entityId === NADIA_JAN && l.actorId === "k-maria")).toBe(true);
    // Kommunen når inte Miljonbemannings rapportsida
    await expect(ask(reportView, { reportId: NADIA_JAN }, maria())).rejects.toBeInstanceOf(ApiError);
  });

  it("handläggaren kan inte öppna beställarrapporten (den lämnas utanför portalen), och ett utkast visas inte", async () => {
    expect(await doc(CS_JAN, maria())).toMatchObject({ ok: false, reason: "not_yours" });
    const undelivered = rows("reports").find((r) => r.kind === "monthly" && r.status === "draft" && row("cases", r.caseId!)!.referrerId === "k-maria")!;
    expect(await doc(undelivered.id, maria())).toMatchObject({ ok: false, reason: "not_delivered", title: "" });
    expect(await run(reportOpen, { reportId: undelivered.id }, maria())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("3b. bara mottagaren läser rapporten i portalen – en annan handläggare och beställarrapporten nås inte", async () => {
    const unopened = rows("reports").find((r) => r.kind === "monthly" && r.status === "delivered" && !r.openedAt && r.deliveredTo.includes("k-maria"))!;
    const d = await okDoc(unopened.id, maria());
    expect(d.portal).toMatchObject({ isRecipient: true, recipientName: "Maria Ekdahl" });
    expect(await doc(unopened.id, omar())).toMatchObject({ ok: false, reason: "not_yours" });
    expect(await doc(CS_DEC, omar())).toMatchObject({ ok: false });
    expect(row("reports", unopened.id)!.openedAt).toBeNull();
    // Datum utan förkortningar i portalens rubrikrad
    expect(d.portal?.deliveredText).toMatch(/^[a-zåäö]+dag \d{1,2} [a-zåäö]+ \d{4} klockan \d{2}\.\d{2}$/);
  });

  it("3c. levererade rapporter är låsta: frysta vid första visningen och när de levereras", async () => {
    const totalOf = (d: ReportDocResult) => (d.ok && d.doc.kind === "monthly" ? d.doc.m.total : null);
    const before = await okDoc(NADIA_DEC, maria());
    expect(before.needsSnapshot).toBe(true);
    expect(await run(reportSnapshot, { reportIds: [NADIA_DEC] }, maria())).toMatchObject({ ok: true, reportIds: [NADIA_DEC] });
    const act = rows("activities").find((a) => a.caseId === NADIA && a.startsAt.startsWith("2026-12") && rows("attendance").some((x) => x.activityId === a.id && x.status === "present"))!;
    expect(await run(attendanceSet, { activityId: act.id, status: "absent_invalid", reason: "" }, amira())).toMatchObject({ ok: true });
    expect(totalOf(await doc(NADIA_DEC, maria()))).toEqual(totalOf(before));
    // Leverantören varnas – dokumentet är oförändrat
    expect((await view(NADIA_DEC, amira())).drift).toEqual({ canCorrect: true });
    expect(totalOf(await doc(NADIA_DEC, amira()))).toEqual(totalOf(before));
    // Januarirapporten efter leverans
    await deliverNadiaJan();
    const jan = totalOf(await doc(NADIA_JAN, maria()));
    const actJan = rows("activities").find((a) => a.caseId === NADIA && a.startsAt.startsWith("2027-01") && rows("attendance").some((x) => x.activityId === a.id && x.status === "present"))!;
    await run(attendanceSet, { activityId: actJan.id, status: "absent_invalid", reason: "" }, amira());
    expect(totalOf(await doc(NADIA_JAN, maria()))).toEqual(jan);
  });

  it("3c. seedad levererad slutrapport har en fryst rekommendation; beställarrapportens nöjdhet gäller rapportens månader", async () => {
    const fin = await okDoc(FIN_DEL, maria());
    expect(fin.doc.kind === "final" && fin.doc.m.recommendation).toBeTruthy();
    const cs = await okDoc(CS_DEC, johan());
    expect(cs.doc.kind === "customer_summary" && cs.doc.m.pulse.period).toBe("oktober–december 2026");
  });
});

// ================================================================ 4. Rättelse = ny version
describe("4. rätta en levererad rapport", () => {
  it("ny version som utkast med orsak; kommunen ser version 1 tills version 2 är levererad", async () => {
    await deliverNadiaJan();
    const cor = await run(reportCorrect, { reportId: NADIA_JAN }, amira());
    if (!cor.ok) throw new Error("rättelsen skapades inte");
    expect(await run(reportCorrectionNote, { reportId: cor.reportId, reason: "  " }, amira())).toMatchObject({ ok: false, error: "reason" });
    expect(await run(reportCorrectionNote, { reportId: cor.reportId, reason: "Fel datum för praktikstart." }, amira())).toMatchObject({ ok: true });
    expect(row("reports", cor.reportId)).toMatchObject({ version: 2, status: "draft", previousId: NADIA_JAN, correctionReason: "Fel datum för praktikstart.", snapshot: null });
    expect(row("reports", NADIA_JAN)).toMatchObject({ superseded: false, status: "delivered", correctionPending: cor.reportId });
    const v2 = await view(cor.reportId, amira());
    expect(v2.versions.map((x) => [x.version, x.current])).toEqual([[1, false], [2, true]]);
    expect(v2.correction).toMatch(/^Fel datum för praktikstart\. \(Amira Haddad, /);
    const v1 = await view(NADIA_JAN, amira());
    expect(v1).toMatchObject({ pendingCorrection: { id: cor.reportId, version: 2 }, next: { label: "Rättas – version 2 är ett utkast" }, actions: { correct: false } });
    // 4b. Kommunen
    expect((await okDoc(NADIA_JAN, maria())).portal).toMatchObject({ correcting: true, version: 1 });
    const viaDraft = await okDoc(cor.reportId, maria());
    expect(viaDraft.doc.id).toBe(NADIA_JAN);
    expect(viaDraft.portal).toMatchObject({ requestedId: cor.reportId, version: 1 });
    // Version 2 levereras → version 1 ersatt, kommunen hänvisas till den rättade versionen
    expect(await run(reportApprove, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(row("reports", NADIA_JAN)!.superseded).toBe(true);
    expect((await okDoc(NADIA_JAN, maria())).portal).toMatchObject({ superseded: true, newerId: cor.reportId });
  });
});

// ================================================================ 5. Kvalitetsgranskning
describe("5. samordnarens kvalitetsgranskning", () => {
  it("sparas och visas; bara samordnaren", async () => {
    expect((await view(APPROVED_JAN, sara())).actions.quality).toBe(true);
    expect(await run(reportQualityReview, { reportId: APPROVED_JAN }, sara())).toMatchObject({ ok: true });
    expect(row("reports", APPROVED_JAN)).toMatchObject({ qualityReviewedBy: "u-sara" });
    const v = await view(APPROVED_JAN, sara());
    expect(v.qualityReviewed).toMatch(/av Sara Lindqvist$/);
    expect(v.actions.quality).toBe(false);
    await expect(run(reportQualityReview, { reportId: APPROVED_JAN }, amira())).rejects.toBeInstanceOf(ApiError);
  });
});

// ================================================================ 6. Beställarrapport
describe("6. beställarrapport januari", () => {
  it("visar bara avtalsmålet; sammanfattning krävs och får inte nämna det interna målet; godkänns och lämnas till kommunen utanför portalen", async () => {
    const d = await okDoc(CS_JAN, johan());
    expect(text(d)).not.toMatch(/0\.35|35\s?%|internalTarget/);
    expect(d.doc.kind === "customer_summary" && d.doc.m.result.contractTarget).toBe(0.32);
    const v = await view(CS_JAN, johan());
    expect(v.summary).toMatchObject({ canApprove: true, text: "" });
    expect(v.summary?.suggestion).toMatch(/^Under januari 2027 var 134 deltagare aktiva/);
    expect(v.slaHidden).toBe(true);
    const t = rt.clock.now();
    expect(await run(reportSaveSummary, { reportId: CS_JAN, summary: "  ", aiUsed: false }, johan())).toMatchObject({ ok: false, error: "summary" });
    expect(await run(reportSaveSummary, { reportId: CS_JAN, summary: "Resultatgraden ligger under det interna målet 35 %.", aiUsed: false }, johan())).toMatchObject({ ok: false, error: "internal_target" });
    expect(await run(reportSaveSummary, { reportId: CS_JAN, summary: "Vi når 35 procent.", aiUsed: false }, johan())).toMatchObject({ ok: false, error: "internal_target" });
    expect(rt.clock.now()).toBe(t);
    expect(row("reports", CS_JAN)!.status).toBe("draft");
    expect(await run(reportSaveSummary, { reportId: CS_JAN, summary: v.summary!.suggestion, aiUsed: true }, johan())).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "report.summary_saved", details: { aiUsed: true } });
    expect(await run(reportApprove, { reportId: CS_JAN }, johan())).toMatchObject({ ok: true });
    expect(row("reports", CS_JAN)).toMatchObject({ status: "approved", approvedBy: "u-johan", summaryAiUsed: true });
    const out0 = rows("outbound_messages").length;
    expect(await run(reportDeliver, { reportId: CS_JAN }, johan())).toMatchObject({ ok: true });
    // Ingen mottagare i portalen, inget mejl och ingen notis – avtalsansvarig lämnar rapporten (beslut 2026-10-07).
    expect(row("reports", CS_JAN)).toMatchObject({ status: "delivered", deliveredTo: [], recipientUserId: null });
    expect(rows("outbound_messages").slice(out0)).toEqual([]);
    expect(rows("audit_log").filter((l) => l.action === "report.delivered" && l.entityId === CS_JAN).pop()).toMatchObject({ details: { kind: "customer_summary", channel: "outside_portal" } });
    expect(await doc(CS_JAN, maria())).toMatchObject({ ok: false });
    expect(await ask(reportView, { reportId: CS_DEC }, amira())).toMatchObject({ ok: false, reason: "role" });
    await expect(run(reportSaveSummary, { reportId: CS_JAN, summary: "x", aiUsed: false }, sara())).rejects.toBeInstanceOf(ApiError);
  });
});

// ================================================================ 7. Veckorapport som väntar
describe("7. veckorapport som väntar på närvaro", () => {
  it("saknade registreringar listas; coachen ser alla handläggarens deltagare (beslut 2026-10-09); publiceras när allt är registrerat", async () => {
    const v = await view(WEEKLY_WAIT, sara());
    expect(v.waiting?.byCoach.length).toBeGreaterThan(0);
    expect(v.waiting?.byCoach[0].coach).toMatch(/: \d+ tillfällen? saknas$/);
    const cd = await okDoc(WEEKLY_WAIT, amira());
    if (cd.doc.kind !== "weekly_attendance") throw new Error("fel typ");
    expect(cd.doc.sections.length).toBe(cd.doc.total);
    // Registrera allt som saknas (som coacherna gör)
    const r = row("reports", WEEKLY_WAIT)!;
    const cases = rows("cases").filter((c) => c.referrerId === r.recipientUserId);
    const acts = rows("activities").filter((a) => cases.some((c) => c.id === a.caseId) && a.startsAt >= "2027-01-25" && a.startsAt <= "2027-01-31T23:59" && a.startsAt < DEMO_START);
    for (const a of acts.filter((x) => !rows("attendance").some((y) => y.activityId === x.id))) {
      const c = cases.find((x) => x.id === a.caseId)!;
      await run(attendanceSet, { activityId: a.id, status: "present" }, as(c.leadCoachId!, "coach"));
    }
    const pub = row("reports", WEEKLY_WAIT)!;
    expect(pub.status).toBe("delivered");
    // Publiceringen fryser rapporten direkt (prototypens rap.snapshot efter automatisk publicering) – ingen lat frysning behövs.
    const snap = pub.snapshot as { reportId: string; takenAt: string; deliveredAt: string; model: WeeklyModel };
    expect(snap).toMatchObject({ reportId: WEEKLY_WAIT, takenAt: pub.deliveredAt, deliveredAt: pub.deliveredAt, model: { kind: "weekly_attendance", week: r.week, recipientUserId: r.recipientUserId } });
    expect(snap.model.sections.length).toBeGreaterThan(0);
    expect(snap.model.sections.every((x) => cases.some((c) => c.id === x.caseId))).toBe(true);
    // Alla passerade tillfällen i veckan är registrerade i den frysta versionen
    const frozenRows = snap.model.sections.flatMap((x) => x.rows);
    expect(frozenRows.length).toBe(acts.filter((a) => snap.model.sections.some((x) => x.caseId === a.caseId)).length);
    const sd = await okDoc(WEEKLY_WAIT, sara());
    expect(sd.needsSnapshot).toBe(false);
    if (sd.doc.kind !== "weekly_attendance") throw new Error("fel typ");
    expect(sd.doc.sections.length).toBe(sd.doc.total);
    expect(sd.doc.sections.map((x) => x.caseId)).toEqual(snap.model.sections.map((x) => x.caseId));
    expect(await run(reportSnapshot, { reportIds: [WEEKLY_WAIT] }, sara())).toMatchObject({ ok: true, reportIds: [] });
    // En senare ändring av närvaron ändrar inte den publicerade veckorapporten
    const md = await okDoc(WEEKLY_WAIT, as(r.recipientUserId!, "kommun_handlaggare"));
    const changed = acts.find((a) => rows("attendance").some((y) => y.activityId === a.id && y.status === "present"))!;
    const cc = cases.find((x) => x.id === changed.caseId)!;
    expect(await run(attendanceSet, { activityId: changed.id, status: "absent_invalid", reason: "" }, as(cc.leadCoachId!, "coach"))).toMatchObject({ ok: true });
    expect(text((await okDoc(WEEKLY_WAIT, as(r.recipientUserId!, "kommun_handlaggare"))).doc)).toBe(text(md.doc));
    // Handledaren kan läsa veckorapporten (närvaro)
    expect(await doc(WEEKLY_WAIT, petra())).toMatchObject({ ok: true, doc: { kind: "weekly_attendance" } });
  });
});

// ================================================================ 8. Slutrapport
describe("8. slutrapport efter avslut", () => {
  it("coachens text krävs innan slutrapporten godkänns", async () => {
    const active = rows("cases").find((c) => c.leadCoachId === "u-amira" && c.status === "active" && c.id !== NADIA && c.id !== "case-260148")!;
    const fin = await run(caseClose, { caseId: active.id, endDate: DEMO_START.slice(0, 10), endReason: "arbete", verified: true }, amira());
    if (!fin.ok) throw new Error("avslutet misslyckades");
    const v1 = await view(fin.reportId, amira());
    expect(v1).toMatchObject({ next: { label: "Coachen skriver rekommenderad fortsättning" }, actions: { approve: false }, finalText: { canEdit: true, recommendation: "" } });
    expect(await run(reportSaveFinal, { reportId: fin.reportId, obstacles: "", recommendation: " " }, amira())).toMatchObject({ ok: false, error: "recommendation" });
    expect(await run(reportSaveFinal, { reportId: fin.reportId, obstacles: "", recommendation: "Ingen fortsatt insats behövs. Deltagaren har börjat arbeta." }, amira())).toMatchObject({ ok: true });
    expect(row("reports", fin.reportId)).toMatchObject({ status: "reviewed", finalText: { recommendation: "Ingen fortsatt insats behövs. Deltagaren har börjat arbeta." } });
    expect(await run(reportApprove, { reportId: fin.reportId }, amira())).toMatchObject({ ok: true });
    const d = await okDoc(fin.reportId, amira());
    expect(d.doc.kind === "final" && d.doc.m.recommendation).toBe("Ingen fortsatt insats behövs. Deltagaren har börjat arbeta.");
    // En annan coach når rapporten (beslut 2026-10-09) – samma kontroller (tom rekommendation stoppas; ingenting skrivs).
    await expect(run(reportSaveFinal, { reportId: fin.reportId, obstacles: "", recommendation: " " }, as("u-erik", "coach"))).resolves.toMatchObject({ ok: false, error: "recommendation" });
  });

  it("en godkänd slutrapport utan coachens text kan inte levereras (texten skapas inte automatiskt)", async () => {
    const r = rows("reports").find((x) => x.kind === "final" && x.status === "draft" && !x.finalText && !row("persons", row("cases", x.caseId!)!.personId)!.protectedIdentity)!;
    const lead = as(row("cases", r.caseId!)!.leadCoachId!, "coach");
    expect(await run(reportApprove, { reportId: r.id }, lead)).toMatchObject({ ok: true });
    const v = await view(r.id, sara());
    expect(v).toMatchObject({ missingRecommendation: true, actions: { deliver: false } });
    expect(await run(reportDeliver, { reportId: r.id }, sara())).toMatchObject({ ok: false, error: "final_text" });
  });
});

// ================================================================ 9. Behörighet
describe("9. behörighet", () => {
  it("skyddade personuppgifter (vilande spärr påslagen): samordnaren nekas, avtalsansvarig ser rapporten, en annan handläggare ser aldrig namnet", async () => {
    // Utan spärren är det en vanlig rapport för samordnaren.
    expect(await doc(PROT_JAN, sara())).toMatchObject({ ok: true });
    protect();
    expect(await ask(reportView, { reportId: PROT_JAN }, sara())).toMatchObject({ ok: false, reason: "protected", caseNumber: "BOT-26-0120" });
    expect(await doc(PROT_JAN, sara())).toMatchObject({ ok: false, reason: "protected" });
    expect(await doc(PROT_JAN, johan())).toMatchObject({ ok: true, doc: { kind: "monthly" } });
    const p = row("persons", row("cases", "case-260120")!.personId)!;
    const name = `${p.firstName} ${p.lastName}`;
    const other = await doc(PROT_DEL, maria());
    expect(other).toMatchObject({ ok: false });
    expect(text(other)).not.toContain(name);
    // Veckorapporten: en annan handläggare når den inte
    const c = row("cases", "case-260120")!;
    const week = rows("reports").find((r) => r.kind === "weekly_attendance" && r.recipientUserId === c.referrerId && ["delivered", "opened"].includes(r.status) && (r.periodEnd ?? "") >= (c.startDate ?? ""))!;
    // Policyn (RLS-spegeln) släpper bara igenom veckorapporter till mottagaren.
    const wd = await doc(week.id, maria());
    expect(text(wd)).not.toContain(name);
    expect(wd).toMatchObject({ ok: false, reason: "not_yours" });
    // Handläggaren som beställde ser sin deltagare
    expect(text(await okDoc(week.id, as(c.referrerId!, "kommun_handlaggare")))).toContain(name);
  });

  it("handledaren får en förklaring i stället för månads- och slutrapporter", async () => {
    expect(await ask(reportView, { reportId: NADIA_DEC }, petra())).toMatchObject({ ok: false, reason: "handledare" });
    expect(await doc(NADIA_DEC, petra())).toMatchObject({ ok: false, reason: "handledare" });
    // Den vilande rollen når alla ärenden i avtalet (beslut 2026-10-09) – teamplatsen spelar ingen roll.
    const fin = rows("reports").find((r) => r.kind === "final")!;
    expect(await ask(reportView, { reportId: fin.id }, petra())).toMatchObject({ ok: false, reason: "handledare" });
    const order = rows("reports").find((r) => r.kind === "order_confirmation")!;
    expect(await ask(reportView, { reportId: order.id }, petra())).toMatchObject({ ok: false, reason: "handledare_order" });
  });

  it("coachen ser kollegornas rapporter (beslut 2026-10-09) – men inte i ett skyddat ärende (vilande spärr)", async () => {
    const foreign = rows("reports").find((r) => r.kind === "monthly" && r.status === "delivered" && !r.snapshot && row("cases", r.caseId!)!.leadCoachId !== "u-amira" && !rows("case_team").some((t) => t.caseId === r.caseId && t.userId === "u-amira"))!;
    expect(await ask(reportView, { reportId: foreign.id }, amira())).toMatchObject({ ok: true });
    rt.store.updateRow("persons", row("cases", foreign.caseId!)!.personId, { protectedIdentity: true });
    expect(await ask(reportView, { reportId: foreign.id }, amira())).toMatchObject({ ok: false, reason: "protected" });
    expect(await run(reportSnapshot, { reportIds: [foreign.id] }, amira())).toMatchObject({ ok: true, reportIds: [] });
    expect(await ask(reportView, { reportId: "rep-finns-inte" }, sara())).toMatchObject({ ok: false, reason: "not_found" });
  });
});
