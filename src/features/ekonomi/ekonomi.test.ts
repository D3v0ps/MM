// Tester för ekonomins vy-modeller och egna åtgärder (prototypens eko.*). Frågor och kommandon körs genom samma execute()
// som riktiga appen och prototypen, mot testdatat i minnet och som testpersonerna (behörighet via policy.ts).
// Siffrorna jämförs med den gamla prototypen (prototyp/tools/data-samples.json och skärmdumparna av eko.start/eko.korning).
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START, decodeTestPnr, normalizePnr } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { caseSetBuyerRef } from "@/features/arenden/api";
import {
  billingApproveInvoice, billingExport, billingSendFortnox, ekoAskCoordinator, ekoCase, ekoCaseList, ekoCloseRun, ekoCsv, ekoFortnoxLog, ekoFortnoxSync, ekoInvoice, ekoPreview,
  ekoReissue, ekoRun, ekoStart, ekoTaskDone,
} from "./api";
import { invoiceSummary, monthRules, noteText, poText, prescText, priceSpan, refError, refFromTask, refInfo, weekText, type LedgerRow, type RefRules } from "./model";

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
const lars = () => as("u-lars", "ekonom");
const karin = () => as("u-karin", "chef");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor = lars()) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const qry = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor = lars()) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const REFFEL1 = "case-260117";
const REFFEL2 = "case-260121";

/** Namn och personnummer på deltagarna – får aldrig finnas i ekonomens vy-modeller. */
function expectNoPersonalData(value: unknown) {
  // Personalens namn (t.ex. "Johan Berg" som skickade uppgiften) får synas – ta bort dem innan kontrollen.
  let text = JSON.stringify(value);
  for (const u of rows("profiles")) text = text.split(u.fullName).join("");
  const digits = text.replace(/\D/g, "");
  for (const p of rows("persons")) {
    for (const n of [p.firstName, p.lastName].filter((x) => x && x.length >= 4)) expect(new RegExp(`\\b${n}\\b`).test(text), `namnet ${n}`).toBe(false);
    const pnr = normalizePnr(decodeTestPnr(p.personnummerEnc));
    if (pnr) expect(digits.includes(pnr), "personnummer").toBe(false);
  }
}

// ================================================================ Rena funktioner
describe("model", () => {
  const rules: RefRules = {
    billing: BOTKYRKA_CONFIG.billing,
    registry: [
      { reference: "55102983", unit: "Arbetsmarknadsenheten Tumba", active: false, note: "Finns inte hos kommunen. Decemberfakturorna returnerades 2027-01-12." },
      { reference: "55102938", unit: "Arbetsmarknadsenheten Tumba", active: true, note: null },
    ],
  };
  const w = (week: number, monday: string) => ({ key: `2027-W${String(week).padStart(2, "0")}`, week, year: 2027, monday });

  it("veckotext med luckor och utan år", () => {
    expect(weekText([w(1, "2027-01-04"), w(3, "2027-01-18"), w(4, "2027-01-25")])).toBe("v. 1, 3–4 2027");
    expect(weekText([w(1, "2027-01-04"), w(2, "2027-01-11")], true)).toBe("v. 1–2");
    expect(weekText([])).toBe("–");
  });

  it("beställarreferens: saknas, fel format, spärrad, giltig och förslag ur uppgiften", () => {
    expect(refInfo(null, rules)).toMatchObject({ ok: false, label: "Saknas" });
    expect(refInfo("12 34", rules)).toMatchObject({ ok: false, label: "Fel format" });
    expect(refInfo("55102983", rules)).toEqual({ ok: false, label: "Spärrad", text: "Finns inte hos kommunen. Decemberfakturorna returnerades 12 jan 2027.", unit: "Arbetsmarknadsenheten Tumba" });
    expect(refInfo("55102938", rules)).toMatchObject({ ok: true, label: "Giltig", text: "Tillhör Arbetsmarknadsenheten Tumba." });
    expect(refInfo("12345678", rules)).toMatchObject({ ok: true, text: "Rätt format. Kontrollera mot kommunens beställning." });
    expect(refError("55102983", "55102983", rules)).toBe("Referensen 55102983 är spärrad hos kommunen. Använd referensen som kommunen har bekräftat.");
    expect(refError("12 34", null, rules)).toBe("Beställarreferensen får bara innehålla siffror – inga mellanslag, bindestreck eller bokstäver.");
    expect(refError("", null, rules)).toBe("Beställarreferens saknas. Kommunen lämnar den när de beställer.");
    expect(refError("55102938", "55102938", rules)).toBe("Det är samma referens som ärendet redan har.");
    expect(refFromTask("Kommunen har bekräftat rätt beställarreferens 55102938 för BOT-26-0117 och BOT-26-0121.", "55102983", rules)).toBe("55102938");
    expect(noteText("returnerades 2027-01-12.")).toBe("returnerades 12 jan 2027.");
  });

  it("avtalsvärden som text läses från konfigurationen", () => {
    expect(poText(BOTKYRKA_CONFIG.billing)).toBe("9 siffror som börjar med 99");
    expect(prescText(BOTKYRKA_CONFIG.billing)).toBe("två månader");
    expect(priceSpan([{ priceOre: 132300, validFrom: "2026-09-10", validTo: null }, { priceOre: 166800, validFrom: "2026-09-10", validTo: null }], "2027-02-01")).toBe("1\u00a0323–1\u00a0668\u00a0kr");
  });

  it("torsdagsregeln: v. 53 2026 hör till december", () => {
    expect(monthRules("2027-01")).toEqual({
      weeks: ["2027-W01", "2027-W02", "2027-W03", "2027-W04"],
      notes: ["V. 53 2026 (28 dec–3 jan) har sin torsdag 31 dec 2026 och hör därför till december 2026."],
    });
  });

  it("fakturatexten: returnerade veckor faktureras om och räknas inte som fakturerade", () => {
    const dec = Array.from({ length: 5 }, (_, i) => ({ ...w(49 + i, "2026-11-30"), year: 2026, monthKey: "2026-12" })) as unknown as LedgerRow["weeks"];
    const ledger: LedgerRow[] = [
      { mk: "2026-12", weeks: dec, qty: 5, amountOre: 694500, status: "returned", kind: "returned" },
      { mk: "2027-01", weeks: [], qty: 4, amountOre: 555600, status: "draft", kind: "unbilled" },
    ];
    const sm = invoiceSummary({ month: "2027-01", caseNumber: "BOT-26-0121", weeks: [], quantity: 4, amountOre: 555600, orderWeeks: 10, orderValueOre: 1389000, unitPriceOre: 138900 }, ledger);
    expect(sm.billed.qty).toBe(0);
    expect(sm.returned.qty).toBe(5);
    expect(sm.accrued.qty).toBe(9);
    expect(sm.text).toContain("Tidigare fakturerat: 0 veckor, 0 kr.");
    expect(sm.text).toContain("Returnerad faktura för december 2026");
    expect(sm.text).toContain("Fakturan krediteras och veckorna faktureras om på en ny faktura.");
    expect(sm.text).toContain("Återstår av beställningen: 1 vecka, 1 389 kr.");
  });
});

// ================================================================ Vy-modeller (samma siffror som den gamla prototypen)
describe("ekonomi.start", () => {
  it("januari att fakturera, preskriptionsrisk, uppgifter, returnerade och körningar", async () => {
    const v = await qry(ekoStart, {});
    expect(v.canAct).toBe(true);
    expect(v.current).toMatchObject({
      month: "2027-01", status: "draft", totalOre: 51133200, count: 124, weeks: 356, blocked: 2, due: "2027-02-03T16:00", dueRelative: "Om 2 dagar", fortnoxDays: 3, stepNow: 1,
      counts: { blocked: 2, zeroPending: 3, review: 122, ready: 0 },
    });
    // Samma ofakturerade veckor som prototypens sel.unbilledOld (data-samples.json)
    expect(v.unbilled).toMatchObject({ totalOre: 557400, count: 4, limit: 45, prescText: "två månader" });
    expect(v.unbilled.rows.map((r) => [r.caseNumber, r.weeks.map((w) => w.key), r.age, r.presc, r.left, r.status])).toEqual([
      ["BOT-26-0117", ["2026-W49", "2026-W50"], 57, "2027-02-06", 5, "returned"],
      ["BOT-26-0121", ["2026-W49", "2026-W50"], 57, "2027-02-06", 5, "returned"],
    ]);
    expect(v.tasks).toHaveLength(1);
    expect(v.tasks[0]).toMatchObject({ id: "task-1", fromName: "Johan Berg", status: "open" });
    expect(v.tasks[0].cases.map((c) => [c.caseNumber, c.problem])).toEqual([["BOT-26-0117", true], ["BOT-26-0121", true]]);
    expect(v.returned.map((r) => [r.caseNumber, r.month, r.quantity, r.amountOre, r.refOk, r.credit])).toEqual([
      ["BOT-26-0117", "2026-12", 5, 699000, false, null],
      ["BOT-26-0121", "2026-12", 5, 694500, false, null],
    ]);
    expect(v.refCases.map((c) => [c.caseNumber, c.started])).toEqual([["BOT-26-0117", true], ["BOT-26-0121", true], ["BOT-27-0049", false]]);
    expect(v.refCases[2].problem).toBe("Beställarreferens saknas. Kommunen lämnar den när de beställer.");
    expect(v.zero.map((z) => [z.caseNumber, z.weekKey, z.planned, z.approved])).toEqual([
      ["BOT-26-0157", "2027-W03", 3, false],
      ["BOT-26-0159", "2027-W02", 3, false],
      ["BOT-27-0031", "2027-W04", 3, false],
    ]);
    expect(v.runs.map((r) => [r.month, r.status, r.count, r.weeks, r.totalOre, r.entries, r.todo])).toEqual([
      ["2027-01", "draft", 124, 356, 51133200, [["draft", 122], ["blocked", 2]], 124],
      ["2026-12", "closed", 131, 438, 63316500, [["sent", 129], ["returned", 2]], 2],
      ["2026-11", "closed", 108, 313, 45639700, [["paid", 108]], 0],
      ["2026-10", "closed", 69, 210, 30277300, [["paid", 69]], 0],
      ["2026-09", "closed", 11, 13, 1852800, [["paid", 11]], 0],
    ]);
    expect(v.priceSpan).toBe("1\u00a0323–1\u00a0668\u00a0kr");
    expectNoPersonalData(v);
  });

  it("chef/controller läser i läsläge", async () => {
    const v = await qry(ekoStart, {}, karin());
    expect(v.canAct).toBe(false);
    expect(v.current?.totalOre).toBe(51133200);
  });

  it("andra roller får inte läsa ekonomins vyer", async () => {
    await expect(qry(ekoStart, {}, as("u-sara", "samordnare"))).rejects.toBeInstanceOf(ApiError);
    await expect(qry(ekoRun, { month: "2027-01" }, as("k-maria", "kommun_handlaggare"))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("ekonomi.run, ekonomi.invoice, ekonomi.preview och ekonomi.case", () => {
  it("januarikörningen: KPI:er, regler, fack och rader utan namn", async () => {
    const v = await qry(ekoRun, { month: "2027-01" });
    expect(v).toMatchObject({ month: "2027-01", count: 124, totalOre: 51133200, weeks: 356, vatOre: 12783300, calendarWeeks: 4, run: { status: "draft" } });
    expect(v.due).toEqual({ at: "2027-02-03T16:00", sla: { label: "Senast 3 feb kl. 16.00", tone: "ok" }, days: 3 });
    expect(v.rules).toMatchObject({ collectiveAllowed: false, refLen: "8–10" });
    expect(v.rows.filter((r) => r.bucket === "blocked").map((r) => r.caseNumber)).toEqual(["BOT-26-0117", "BOT-26-0121"]);
    expect(v.rows.filter((r) => r.bucket === "review")).toHaveLength(122);
    expect(v.rows.filter((r) => r.bucket === "review" && r.remarks > 0)).toHaveLength(8);
    expect(v.runs.map((r) => r.month)).toEqual(["2027-01", "2026-12", "2026-11", "2026-10", "2026-09"]);
    expectNoPersonalData(v);
    // Utan månad: den pågående körningen
    expect((await qry(ekoRun, {})).month).toBe("2027-01");
  });

  it("detaljen: överlapp med det andra ärendet, fakturatext och uppgift med referens", async () => {
    const d = await qry(ekoInvoice, { month: "2027-01", caseId: "case-260131" });
    expect(d?.overlaps["Överlappar BOT-27-0004"]).toMatchObject({ caseId: "case-270004", caseNumber: "BOT-27-0004", status: "draft", askedAt: null });
    expect(d?.summary.text).toBe(
      "Beställning BOT-26-0131: 8 veckor, 10 584 kr. Denna faktura: 2 veckor (v. 1–2 2027), 2 646 kr. Tidigare fakturerat: 4 veckor, 5 292 kr. " +
        "Upparbetat inklusive denna faktura: 6 veckor, 7 938 kr. Återstår av beställningen: 2 veckor, 2 646 kr.",
    );
    const blocked = await qry(ekoInvoice, { month: "2027-01", caseId: REFFEL1 });
    expect(blocked?.task).toMatchObject({ id: "task-1", fromName: "Johan Berg" });
    expect(blocked?.inv.checks[0]).toMatchObject({ kind: "buyer_ref", severity: "blocking" });
    expectNoPersonalData(d);
  });

  it("förhandsvisningen: Peppol-fält, moms, öresavrundning och inga namn", async () => {
    const v = await qry(ekoPreview, { month: "2027-01", caseId: "case-260132" });
    expect(v.preview).toMatchObject({
      invoiceDate: "2027-02-01", dueDate: "2027-03-03", vatOre: 104850, roundingOre: 50, grossRoundedOre: 524300, po: "", lineText: "BOT-26-0132 · v. 1, 3–4 2027",
      poText: "9 siffror som börjar med 99", refLen: "8–10",
      supplier: { name: "Miljonbemanning AB", orgNr: "556959-9318", vatNo: "SE556959931801" },
      customer: { name: "Botkyrka kommun", orgNr: "212000-2882", eInvoiceContact: "Botkyrkas e-handel (e-handel@botkyrka.se)" },
    });
    expect(v.preview?.summary.text).toBe(
      "Beställning BOT-26-0132: 10 veckor, 13 980 kr. Denna faktura: 3 veckor (v. 1, 3–4 2027), 4 194 kr. Tidigare fakturerat: 4 veckor, 5 592 kr. " +
        "Upparbetat inklusive denna faktura: 7 veckor, 9 786 kr. Återstår av beställningen: 3 veckor, 4 194 kr.",
    );
    expect(JSON.stringify(v)).not.toContain("Sjukhusvistelse"); // pausorsaken är en hälsouppgift
    expectNoPersonalData(v);
    expect((await qry(ekoPreview, { month: "2026-08", caseId: "case-260132" })).preview).toBeNull();
  });

  it("ärendets underlag: returnerade veckor är ej fakturerade, ekonomen ser inget namn (chefen gör det)", async () => {
    const v = await qry(ekoCase, { caseId: REFFEL2 });
    expect(v).toMatchObject({
      name: "–", orderWeeks: 10, orderValueOre: 1389000, accrued: { qty: 10 }, billed: { qty: 0, amountOre: 0 }, returned: { qty: 5, amountOre: 694500 }, pending: { qty: 5 },
    });
    expect(v?.months.map((m) => [m.mk, m.qty, m.status, m.invoiceNo])).toEqual([
      ["2026-12", 5, "returned", "14579"],
      ["2027-01", 4, "blocked", null],
      ["2027-02", 1, "open", null],
    ]);
    expectNoPersonalData(v);
    expect((await qry(ekoCase, { caseId: REFFEL2 }, karin()))?.name).toBe("Hassan Aydın");
    expect(await qry(ekoCase, { caseId: "finns-inte" })).toBeNull();
    const list = await qry(ekoCaseList, {});
    expect(list.cases.length).toBeGreaterThan(100);
    expect(list.cases.every((c) => c.startDate)).toBe(true);
    expectNoPersonalData(list);
  });

  it("CSV-exporten: underlaget utan namn, exporten loggas med billingExport", async () => {
    const f = await qry(ekoCsv, { month: "2027-01" });
    expect(f.filename).toBe("fakturaunderlag-2027-01.csv");
    const lines = f.csv.split("\r\n");
    expect(lines).toHaveLength(125);
    expect(lines[0].startsWith("Ärendenummer (faktureringsobjekt);Avtalsområde;Artikel;Veckor")).toBe(true);
    expect(f.csv).toContain("BOT-26-0143");
    expectNoPersonalData(f);
    expect(await cmd(billingExport, { month: "2027-01", format: "csv" })).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "export.billing", entityId: "2027-01", actorId: "u-lars" });
  });
});

// ================================================================ Egna åtgärder
describe("ekonomins åtgärder", () => {
  it("Fortnox: skapa, logga körningen (idempotens), hämta status ett steg i taget", async () => {
    const ids = ["case-260072", "case-260073"];
    await cmd(billingApproveInvoice, { month: "2027-01", caseIds: ids });
    await cmd(billingSendFortnox, { month: "2027-01", caseIds: ids });
    const log = await cmd(ekoFortnoxLog, { month: "2027-01", created: ids, skipped: 0, notReady: 122, blocked: 2 });
    expect(log.ok).toBe(true);
    expect(rows("fortnox_runs").at(-1)).toMatchObject({ kind: "create", created: 2, skipped: 0, notReady: 122, blocked: 2, ranBy: "u-lars" });
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "billing.fortnox_run", details: { created: 2, skippedDuplicates: 0, blocked: 2, notApproved: 122 } });
    // Omkörning: inga nya fakturor
    await cmd(ekoFortnoxLog, { month: "2027-01", created: [], skipped: 2, notReady: 122, blocked: 2 });
    const run = await qry(ekoRun, { month: "2027-01" });
    expect(run.fortnoxRuns.map((r) => [r.created, r.skipped])).toEqual([[0, 2], [2, 0]]);
    expect(run.rows.filter((r) => r.hasKey).map((r) => r.caseId)).toEqual(ids);

    for (const next of ["booked", "sent", "paid"] as const) {
      expect(await cmd(ekoFortnoxSync, { month: "2027-01", caseIds: ids })).toEqual({ ok: true, changed: 2 });
      const v = await qry(ekoRun, { month: "2027-01" });
      expect(v.rows.filter((r) => ids.includes(r.caseId)).map((r) => r.status)).toEqual([next, next]);
    }
    expect(await cmd(ekoFortnoxSync, { month: "2027-01", caseIds: ids })).toEqual({ ok: true, changed: 0 });
    expect((await qry(ekoStart, {})).fortnox.lastSync).toMatchObject({ changed: 0 });
  });

  it("kreditera returnerad faktura: kräver giltig referens och returnerad status", async () => {
    expect(await cmd(ekoReissue, { month: "2026-12", caseId: REFFEL1 })).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(await cmd(caseSetBuyerRef, { caseId: REFFEL1, reference: "55102938", source: "task-1" })).toMatchObject({ ok: true });
    expect(await cmd(ekoReissue, { month: "2026-12", caseId: REFFEL1 })).toEqual({ ok: true });
    expect(rows("invoice_credits").at(-1)).toMatchObject({ month: "2026-12", caseId: REFFEL1, buyerReference: "55102938", creditedBy: "u-lars" });
    expect(await cmd(ekoReissue, { month: "2026-12", caseId: REFFEL1 })).toMatchObject({ ok: false, error: "not_returned" });
    const start = await qry(ekoStart, {});
    expect(start.returned.find((r) => r.caseId === REFFEL1)?.credit).toMatchObject({ reference: "55102938" });
    expect(start.unbilled.rows.map((r) => r.caseNumber)).toEqual(["BOT-26-0121"]); // preskriptionsvarningen försvann för 0117
    const pv = await qry(ekoPreview, { month: "2027-01", caseId: REFFEL1 });
    expect(pv.preview?.summary.billed.qty).toBe(5);
  });

  it("fråga samordnaren: bara ärendenummer och veckor – inga namn", async () => {
    const res = await cmd(ekoAskCoordinator, { month: "2027-01", caseId: "case-260131", otherCaseId: "case-270004" });
    expect(res.ok).toBe(true);
    const t = rows("tasks").at(-1)!;
    expect(t).toMatchObject({ toRole: "samordnare", fromId: "u-lars", kind: "billing_question", month: "2027-01", caseIds: ["case-260131", "case-270004"] });
    expect(t.text).toBe(
      "Faktureringskontroll januari 2027: BOT-26-0131 och BOT-27-0004 gäller samma deltagare och överlappar (v. 2 2027). Samma vecka får bara faktureras en gång. " +
        "Vilket ärende ska faktureras för veckan? Behöver start- eller slutdatum rättas?",
    );
    expectNoPersonalData(t);
    const d = await qry(ekoInvoice, { month: "2027-01", caseId: "case-260131" });
    expect(d?.overlaps["Överlappar BOT-27-0004"].askedAt).toBe(t.createdAt);
    expect(await cmd(ekoAskCoordinator, { month: "2027-01", caseId: "case-260131", otherCaseId: "case-260143" })).toMatchObject({ ok: false, error: "no_overlap" });
  });

  it("uppgift klar och stäng körningen", async () => {
    expect(await cmd(ekoTaskDone, { taskId: "task-1" })).toEqual({ ok: true });
    expect(rows("tasks").find((t) => t.id === "task-1")).toMatchObject({ status: "done", doneBy: "u-lars" });
    expect(await cmd(ekoTaskDone, { taskId: "finns-inte" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(ekoCloseRun, { month: "2027-01" })).toEqual({ ok: true });
    expect(rows("billing_runs").find((r) => r.month === "2027-01")).toMatchObject({ status: "closed", closedBy: "u-lars" });
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "billing.run_closed", entityId: "br-2027-01" });
  });

  it("bara ekonomen gör åtgärderna – chefen läser", async () => {
    for (const p of [
      cmd(ekoFortnoxSync, { month: "2027-01", caseIds: [] }, karin()),
      cmd(ekoReissue, { month: "2026-12", caseId: REFFEL1 }, karin()),
      cmd(ekoTaskDone, { taskId: "task-1" }, karin()),
      cmd(ekoCloseRun, { month: "2027-01" }, karin()),
    ]) {
      await expect(p).rejects.toBeInstanceOf(ApiError);
    }
  });
});
