// Tester för ekonomins vy-modeller och egna åtgärder (prototypens eko.*). Frågor och kommandon körs genom samma execute()
// som riktiga appen och prototypen, mot testdatat i minnet och som testpersonerna (behörighet via policy.ts).
// Beslut 2026-10-07 (synpunkt #13): en faktura per avtal och månad med en rad per ärende. Raderna, summorna och veckorna är
// desamma som den gamla prototypens fakturor per ärende (src/core/billing.test.ts jämför alla månader med facit).
// Beslut 5 (2026-10-07): bara ekonomen ser fakturaunderlaget och beloppen.
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
import {
  billingApproveInvoice, billingApproveZeroWeek, billingExport, billingMarkManual, billingSendFortnox, ekoAskCoordinator, ekoCase, ekoCaseList, ekoCloseRun, ekoCsv, ekoFortnoxSync, ekoLine,
  ekoPreview, ekoReissue, ekoRun, ekoStart, ekoTaskDone, invoiceSetBuyerRef,
} from "./api";
import { invoiceSummary, invoiceText, invoiceTitle, monthRules, noteText, poText, prescText, priceSpan, refError, refFromTask, refInfo, weekText, type LedgerRow, type RefRules } from "./model";

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
const JAN = "inv-c-bot-2027-01-avtal";
const DEC2 = "inv-c-bot-2026-12-avtal-tillagg-2";

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

/** Godkänn januaris veckor utan närvaro. */
async function approveZeroWeeks() {
  const v = await qry(ekoRun, { month: "2027-01" });
  for (const l of v.invoices.flatMap((x) => x.lines).filter((x) => x.needsApproval)) {
    for (const ch of l.checks.filter((c) => c.kind === "zero_week" && c.severity === "needs_approval")) {
      await cmd(billingApproveZeroWeek, { month: "2027-01", caseId: l.caseId, weekKey: ch.weekKey!, note: "Kontrollerat med samordnaren." });
    }
  }
}

// ================================================================ Rena funktioner
describe("model", () => {
  const rules: RefRules = {
    billing: BOTKYRKA_CONFIG.billing,
    registry: [
      { reference: "55102983", unit: "Arbetsmarknadsenheten Tumba", active: false, note: "Finns inte hos kommunen. Tilläggsfakturan för december returnerades 2027-01-12." },
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
    expect(refInfo("55102983", rules)).toEqual({ ok: false, label: "Spärrad", text: "Finns inte hos kommunen. Tilläggsfakturan för december returnerades 12 jan 2027.", unit: "Arbetsmarknadsenheten Tumba" });
    expect(refInfo("55102938", rules)).toMatchObject({ ok: true, label: "Giltig", text: "Tillhör Arbetsmarknadsenheten Tumba." });
    expect(refInfo("12345678", rules)).toMatchObject({ ok: true, text: "Rätt format. Kontrollera mot kommunens beställning." });
    expect(refError("55102983", "55102983", rules)).toBe("Referensen 55102983 är spärrad hos kommunen. Använd referensen som kommunen har bekräftat.");
    expect(refError("12 34", null, rules)).toBe("Beställarreferensen får bara innehålla siffror – inga mellanslag, bindestreck eller bokstäver.");
    expect(refError("", null, rules)).toBe("Beställarreferens saknas. Kommunen lämnar den när de beställer.");
    expect(refError("55102938", "55102938", rules)).toBe("Det är samma referens som fakturan redan har.");
    expect(refFromTask("Kommunen har bekräftat rätt beställarreferens 55102938 för BOT-26-0117 och BOT-26-0121.", "55102983", rules)).toBe("55102938");
    expect(noteText("returnerades 2027-01-12.")).toBe("returnerades 12 jan 2027.");
  });

  it("avtalsvärden som text läses från konfigurationen", () => {
    expect(poText(BOTKYRKA_CONFIG.billing)).toBe("9 siffror som börjar med 99");
    expect(prescText(BOTKYRKA_CONFIG.billing)).toBe("två månader");
    expect(priceSpan([{ priceOre: 132300, validFrom: "2026-09-10", validTo: null }, { priceOre: 166800, validFrom: "2026-09-10", validTo: null }], "2027-02-01")).toBe("1 323–1 668 kr");
  });

  it("torsdagsregeln: v. 53 2026 hör till december", () => {
    expect(monthRules("2027-01")).toEqual({
      weeks: ["2027-W01", "2027-W02", "2027-W03", "2027-W04"],
      notes: ["V. 53 2026 (28 dec–3 jan) har sin torsdag 31 dec 2026 och hör därför till december 2026."],
    });
  });

  it("fakturans namn och text: månadens faktura och tilläggsfaktura, inga namn", () => {
    expect(invoiceTitle({ month: "2027-01", groupingKey: "avtal" })).toBe("Faktura januari 2027");
    expect(invoiceTitle({ month: "2026-12", groupingKey: "avtal-tillagg-2" })).toBe("Tilläggsfaktura 2 · december 2026");
    expect(invoiceTitle({ month: "2027-01", groupingKey: "case-260117" }, "BOT-26-0117")).toBe("Faktura BOT-26-0117 · januari 2027");
    expect(invoiceText({ contractNumber: "332026110", month: "2027-01", lines: 124, weeks: 356, number: 1, perContract: true })).toBe(
      "Fakturaunderlag januari 2027, avtal 332026110: 124 ärenden, 356 deltagarveckor. En rad per ärende – ärendenumret är faktureringsobjekt.",
    );
  });

  it("radens anmärkning: returnerade veckor faktureras om och räknas inte som fakturerade – inget ordervärde i kronor", () => {
    const dec = Array.from({ length: 5 }, (_, i) => ({ ...w(49 + i, "2026-11-30"), year: 2026, monthKey: "2026-12" })) as unknown as LedgerRow["weeks"];
    const ledger: LedgerRow[] = [
      { mk: "2026-12", weeks: dec, qty: 5, amountOre: 694500, status: "returned", kind: "returned", invoiceId: DEC2 },
      { mk: "2027-01", weeks: [], qty: 4, amountOre: 555600, status: "draft", kind: "unbilled", invoiceId: null },
    ];
    const sm = invoiceSummary({ month: "2027-01", caseNumber: "BOT-26-0121", weeks: [], quantity: 4, amountOre: 555600, orderWeeks: 10, unitPriceOre: 138900 }, ledger);
    expect(sm.billed.qty).toBe(0);
    expect(sm.returned.qty).toBe(5);
    expect(sm.accrued.qty).toBe(9);
    expect(sm.order).toEqual({ qty: 10 });
    expect(sm.text).toContain("Beställning BOT-26-0121: 10 veckor.");
    expect(sm.text).not.toContain("13 890 kr"); // beställningens värde (10 × 1 389 kr) nämns inte
    expect(sm.text).toContain("Tidigare fakturerat: 0 veckor, 0 kr.");
    expect(sm.text).toContain("Returnerad faktura för december 2026");
    expect(sm.text).toContain("Fakturan krediteras och veckorna faktureras om på en ny faktura.");
    expect(sm.text).toContain("Återstår av beställningen: 1 vecka, 1 389 kr.");
  });
});

// ================================================================ Vy-modeller
describe("ekonomi.start", () => {
  it("januari att fakturera, preskriptionsrisk, uppgifter, returnerade, fakturor utan referens och körningar", async () => {
    const v = await qry(ekoStart, {});
    expect(v.canAct).toBe(true);
    expect(v.current).toMatchObject({
      month: "2027-01", status: "draft", totalOre: 51133200, invoices: 1, count: 124, weeks: 356, blocked: 1, due: "2027-02-03T16:00", dueRelative: "Om 2 dagar", fortnoxDays: 3,
      stepNow: 1, perContract: true, counts: { blocked: 1, zeroPending: 3, review: 0, ready: 0 },
    });
    // Samma ofakturerade veckor som prototypens sel.unbilledOld (data-samples.json)
    expect(v.unbilled).toMatchObject({ totalOre: 557400, count: 4, limit: 45, prescText: "två månader" });
    expect(v.unbilled.rows.map((r) => [r.caseNumber, r.weeks.map((w) => w.key), r.age, r.presc, r.left, r.status])).toEqual([
      ["BOT-26-0117", ["2026-W49", "2026-W50"], 57, "2027-02-06", 5, "returned"],
      ["BOT-26-0121", ["2026-W49", "2026-W50"], 57, "2027-02-06", 5, "returned"],
    ]);
    expect(v.tasks).toHaveLength(1);
    expect(v.tasks[0]).toMatchObject({ id: "task-1", fromName: "Johan Berg", status: "open" });
    expect(v.tasks[0].cases.map((c) => c.caseNumber)).toEqual(["BOT-26-0117", "BOT-26-0121"]);
    // Decembers tilläggsfaktura (Ahmeds två ärenden) är returnerad – samma veckor och belopp som prototypens två fakturor.
    expect(v.returned.map((r) => [r.title, r.month, r.lines, r.quantity, r.amountOre, r.caseNumbers, r.refOk, r.credit])).toEqual([
      ["Tilläggsfaktura 2 · december 2026", "2026-12", 2, 10, 699000 + 694500, ["BOT-26-0117", "BOT-26-0121"], false, null],
    ]);
    expect(v.refInvoices.map((r) => [r.title, r.buyerReference, r.lines])).toEqual([["Faktura januari 2027", null, 124], ["Tilläggsfaktura 2 · december 2026", "55102983", 2]]);
    expect(v.refSuggestions[JAN][0]).toEqual({ reference: "55102938", source: "Uppgift från Johan Berg" });
    expect(v.zero.map((z) => [z.caseNumber, z.weekKey, z.planned, z.approved])).toEqual([
      ["BOT-26-0157", "2027-W03", 3, false],
      ["BOT-26-0159", "2027-W02", 3, false],
      ["BOT-27-0031", "2027-W04", 3, false],
    ]);
    // Samma rader, veckor och belopp per månad som prototypens fakturor per ärende – nu en faktura per månad.
    expect(v.runs.map((r) => [r.month, r.status, r.invoices, r.count, r.weeks, r.totalOre, r.entries, r.todo])).toEqual([
      ["2027-01", "draft", 1, 124, 356, 51133200, [["blocked", 1]], 1],
      ["2026-12", "closed", 2, 131, 438, 63316500, [["sent", 1], ["returned", 1]], 1],
      ["2026-11", "closed", 1, 108, 313, 45639700, [["paid", 1]], 0],
      ["2026-10", "closed", 1, 69, 210, 30277300, [["paid", 1]], 0],
      ["2026-09", "closed", 1, 11, 13, 1852800, [["paid", 1]], 0],
    ]);
    expect(v.priceSpan).toBe("1 323–1 668 kr");
    expectNoPersonalData(v);
  });

  it("bara ekonomen läser ekonomins vyer (beslut 5: belopp bara för ekonomen)", async () => {
    for (const who of [karin(), as("u-johan", "avtalsansvarig"), as("u-robin", "admin"), as("u-sara", "samordnare"), as("k-maria", "kommun_handlaggare")]) {
      await expect(qry(ekoStart, {}, who), who.role).rejects.toBeInstanceOf(ApiError);
      await expect(qry(ekoRun, { month: "2027-01" }, who), who.role).rejects.toBeInstanceOf(ApiError);
    }
  });
});

describe("ekonomi.run, ekonomi.line, ekonomi.preview och ekonomi.case", () => {
  it("januarikörningen: en faktura med en rad per ärende, regler och inga namn", async () => {
    const v = await qry(ekoRun, { month: "2027-01" });
    expect(v).toMatchObject({ month: "2027-01", count: 124, totalOre: 51133200, weeks: 356, vatOre: 12783300, calendarWeeks: 4, run: { status: "draft" } });
    expect(v.due).toEqual({ at: "2027-02-03T16:00", sla: { label: "Senast 3 feb kl. 16.00", tone: "ok" }, days: 3 });
    expect(v.rules).toMatchObject({ perContract: true, refLen: "8–10", poText: "9 siffror som börjar med 99" });
    // Månadens veckor och torsdagsregeln (samma som monthRules) – skrivs inte över av avtalets regler.
    expect(v.rules.weeks).toEqual(["2027-W01", "2027-W02", "2027-W03", "2027-W04"]);
    expect(v.rules.notes).toEqual(["V. 53 2026 (28 dec–3 jan) har sin torsdag 31 dec 2026 och hör därför till december 2026."]);
    expect(v.invoices).toHaveLength(1);
    const [inv] = v.invoices;
    expect(inv).toMatchObject({
      id: JAN, title: "Faktura januari 2027", status: "blocked", buyerReference: null, ref: { label: "Saknas" }, blocked: true, needsApproval: true, remarks: 8,
      amountOre: 51133200, quantity: 356, vat: [{ rate: 25, baseOre: 51133200, vatOre: 12783300 }], purchaseOrderNumber: "", poSet: false,
    });
    expect(inv.lines).toHaveLength(124);
    expect(inv.lines.filter((l) => l.needsApproval).map((l) => l.caseNumber)).toEqual(["BOT-26-0157", "BOT-26-0159", "BOT-27-0031"]);
    expect(inv.refSuggestions.map((s) => s.reference)).toContain("55102938");
    expect(v.runs.map((r) => r.month)).toEqual(["2027-01", "2026-12", "2026-11", "2026-10", "2026-09"]);
    expectNoPersonalData(v);
    // Utan månad: den pågående körningen
    expect((await qry(ekoRun, {})).month).toBe("2027-01");
    // December: månadens faktura (skickad) och tilläggsfakturan (returnerad) – frysta rader.
    const dec = await qry(ekoRun, { month: "2026-12" });
    expect(dec.invoices.map((x) => [x.title, x.status, x.buyerReference, x.lines.length, x.lines.every((l) => l.frozen)])).toEqual([
      ["Faktura december 2026", "sent", "55102938", 129, true], ["Tilläggsfaktura 2 · december 2026", "returned", "55102983", 2, true],
    ]);
  });

  it("radens detalj: överlapp med det andra ärendet och radens anmärkning", async () => {
    const d = await qry(ekoLine, { month: "2027-01", caseId: "case-260131" });
    expect(d?.invoice).toMatchObject({ id: JAN, title: "Faktura januari 2027" });
    expect(d?.overlaps["Överlappar BOT-27-0004"]).toMatchObject({ caseId: "case-270004", caseNumber: "BOT-27-0004", askedAt: null });
    expect(d?.summary.text).toBe(
      "Beställning BOT-26-0131: 8 veckor. Denna faktura: 2 veckor (v. 1–2 2027), 2 646 kr. Tidigare fakturerat: 4 veckor, 5 292 kr. " +
        "Upparbetat inklusive denna faktura: 6 veckor, 7 938 kr. Återstår av beställningen: 2 veckor, 2 646 kr.",
    );
    expectNoPersonalData(d);
    expect(await qry(ekoLine, { month: "2026-08", caseId: "case-260131" })).toBeNull();
  });

  it("förhandsvisningen: hela fakturan, moms per sats, öresavrundning, radens anmärkning och inga namn", async () => {
    const v = await qry(ekoPreview, { month: "2027-01", caseId: "case-260132" });
    expect(v).toMatchObject({ invoiceId: JAN, caseId: "case-260132", caseNumber: "BOT-26-0132", invoices: [{ id: JAN, title: "Faktura januari 2027", status: "blocked" }] });
    expect(v.preview).toMatchObject({
      invoiceDate: "2027-02-01", dueDate: "2027-03-03", roundingOre: 0, grossRoundedOre: 51133200 + 12783300, poText: "9 siffror som börjar med 99", refLen: "8–10",
      invoiceText: "Fakturaunderlag januari 2027, avtal 332026110: 124 ärenden, 356 deltagarveckor. En rad per ärende – ärendenumret är faktureringsobjekt.",
      supplier: { name: "Miljonbemanning AB", orgNr: "556959-9318", vatNo: "SE556959931801" },
      customer: { name: "Botkyrka kommun", orgNr: "212000-2882", eInvoiceContact: "Botkyrkas e-handel (e-handel@botkyrka.se)" },
    });
    expect(v.preview?.inv.lines.find((l) => l.caseId === "case-260132")?.lineText).toBe("BOT-26-0132 · v. 1, 3–4 2027");
    expect(v.preview?.notes["case-260132"]).toBe(
      "Beställning BOT-26-0132: 10 veckor. Denna faktura: 3 veckor (v. 1, 3–4 2027), 4 194 kr. Tidigare fakturerat: 4 veckor, 5 592 kr. " +
        "Upparbetat inklusive denna faktura: 7 veckor, 9 786 kr. Återstår av beställningen: 3 veckor, 4 194 kr.",
    );
    expect(Object.keys(v.preview?.notes ?? {})).toHaveLength(124);
    expect(JSON.stringify(v)).not.toContain("Sjukhusvistelse"); // pausorsaken är en hälsouppgift
    expectNoPersonalData(v);
    // Med fakturans id: decembers tilläggsfaktura.
    const supp = await qry(ekoPreview, { month: "2026-12", invoiceId: DEC2 });
    expect(supp.preview?.inv).toMatchObject({ title: "Tilläggsfaktura 2 · december 2026", status: "returned" });
    expect(supp.invoices.map((x) => x.title)).toEqual(["Faktura december 2026", "Tilläggsfaktura 2 · december 2026"]);
    expect((await qry(ekoPreview, { month: "2026-08", caseId: "case-260132" })).preview).toBeNull();
  });

  it("ärendets underlag: returnerade veckor är ej fakturerade, inget ordervärde, ekonomen ser inget namn", async () => {
    const v = await qry(ekoCase, { caseId: REFFEL2 });
    expect(v).toMatchObject({
      name: "–", orderWeeks: 10, priceOre: 138900, caseBuyerReference: "55102983", accrued: { qty: 10 }, billed: { qty: 0, amountOre: 0 }, returned: { qty: 5, amountOre: 694500 },
      pending: { qty: 5 },
    });
    expect("orderValueOre" in (v ?? {})).toBe(false);
    expect(v?.months.map((m) => [m.mk, m.qty, m.status, m.invoiceTitle])).toEqual([
      ["2026-12", 5, "returned", "Tilläggsfaktura 2 · december 2026"],
      ["2027-01", 4, "blocked", "Faktura januari 2027"],
      ["2027-02", 1, "open", null],
    ]);
    expectNoPersonalData(v);
    expect(await qry(ekoCase, { caseId: "finns-inte" })).toBeNull();
    const list = await qry(ekoCaseList, {});
    expect(list.cases.length).toBeGreaterThan(100);
    expect(list.cases.every((c) => c.startDate)).toBe(true);
    expectNoPersonalData(list);
  });

  it("CSV-exporten: en rad per fakturarad med fakturans huvud först, utan namn – exporten loggas med billingExport", async () => {
    const f = await qry(ekoCsv, { month: "2027-01" });
    expect(f.filename).toBe("fakturaunderlag-2027-01.csv");
    const lines = f.csv.split("\r\n");
    expect(lines).toHaveLength(125);
    expect(lines[0].startsWith("Faktura;Fakturans status;Beställarreferens;Inköpsordernummer;Ärendenummer (faktureringsobjekt);Avtalsområde;Artikel;Veckor")).toBe(true);
    expect(lines.slice(1).every((l) => l.startsWith("Faktura januari 2027;Stoppad;;;BOT-"))).toBe(true);
    expect(f.csv).toContain("BOT-26-0143");
    expectNoPersonalData(f);
    expect(await cmd(billingExport, { month: "2027-01", format: "csv" })).toMatchObject({ ok: true });
    expect(rows("audit_log").pop()).toMatchObject({ action: "export.billing", entityId: "2027-01", actorId: "u-lars" });
  });
});

// ================================================================ Egna åtgärder
describe("ekonomins åtgärder", () => {
  it("Fortnox: referens, godkännande, skapa (idempotens) och hämta status ett steg i taget", async () => {
    await approveZeroWeeks();
    expect(await cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" })).toMatchObject({ ok: true });
    expect(await cmd(billingApproveInvoice, { month: "2027-01", invoiceId: JAN })).toMatchObject({ ok: true, lines: 124 });
    const first = await cmd(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] });
    expect(first).toMatchObject({ ok: true, created: [JAN] });
    expect(rows("fortnox_runs").at(-1)).toMatchObject({ kind: "create", created: 1, skipped: 0, notReady: 0, blocked: 0, ranBy: "u-lars" });
    // Omkörning: inga nya fakturor
    expect(await cmd(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] })).toMatchObject({ ok: true, created: [], skipped: [JAN] });
    const run = await qry(ekoRun, { month: "2027-01" });
    expect(run.fortnoxRuns.map((r) => [r.created, r.skipped])).toEqual([[0, 1], [1, 0]]);
    expect(run.invoices.map((x) => [x.status, x.hasKey, x.lines.every((l) => l.frozen)])).toEqual([["fortnox_created", true, true]]);
    // Samma summa som underlaget före skapandet.
    expect(run.totalOre).toBe(51133200);
    for (const next of ["booked", "sent", "paid"] as const) {
      expect(await cmd(ekoFortnoxSync, { month: "2027-01" })).toEqual({ ok: true, changed: 1 });
      expect((await qry(ekoRun, { month: "2027-01" })).invoices.map((x) => x.status)).toEqual([next]);
    }
    expect(await cmd(ekoFortnoxSync, { month: "2027-01" })).toEqual({ ok: true, changed: 0 });
    expect((await qry(ekoStart, {})).fortnox.lastSync).toMatchObject({ changed: 0 });
    // Alla veckor i januari räknas nu som fakturerade.
    expect((await qry(ekoCase, { caseId: "case-260143" }))?.months.find((m) => m.mk === "2027-01")?.status).toBe("paid");
  });

  it("kreditera returnerad faktura: kräver giltig referens och returnerad status – samma rader, veckorna räknas sedan som fakturerade", async () => {
    expect(await cmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 })).toMatchObject({ ok: false, error: "buyer_ref" });
    expect(await cmd(invoiceSetBuyerRef, { month: "2026-12", invoiceId: DEC2, reference: "55102938" })).toMatchObject({ ok: true });
    expect(await cmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 })).toEqual({ ok: true, reissued: true });
    expect(rows("invoice_credits").at(-1)).toMatchObject({ month: "2026-12", invoiceDraftId: DEC2, caseId: null, buyerReference: "55102938", creditedBy: "u-lars" });
    expect(await cmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 })).toMatchObject({ ok: false, error: "not_returned" });
    const start = await qry(ekoStart, {});
    expect(start.returned.find((r) => r.invoiceId === DEC2)?.credit).toMatchObject({ reference: "55102938" });
    expect(start.unbilled.rows).toEqual([]); // preskriptionsvarningen försvann
    const line = await qry(ekoLine, { month: "2027-01", caseId: REFFEL1 });
    expect(line?.summary.billed.qty).toBe(5);
  });

  it("en vecka som rättas bort i efterhand (uppehåll) står kvar på den skapade fakturan med en varning – och tas bort när den returnerade fakturan görs om", async () => {
    const dec2 = () => rt.raw().get("invoice_drafts", DEC2)!;
    const before = rows("invoice_lines").find((l) => l.invoiceDraftId === DEC2 && l.caseId === REFFEL1)!;
    expect(before.isoWeeks).toContain("2026-W53");
    const otherCases = rows("invoice_lines").filter((l) => l.invoiceDraftId === DEC2 && l.caseId !== REFFEL1).map((l) => [l.caseId, l.quantity]);
    // Samordnaren rättar ärendet: v. 53 var uppehåll.
    const c = rt.raw().get("cases", REFFEL1)!;
    rt.store.updateRow("cases", REFFEL1, { pausedWeeks: [...c.pausedWeeks, "2026-W53"] });
    const run = await qry(ekoRun, { month: "2026-12" });
    const frozen = run.invoices.find((x) => x.id === DEC2)!.lines.find((l) => l.caseId === REFFEL1)!;
    expect(frozen.quantity).toBe(5);
    expect(frozen.checks.map((ch) => [ch.kind, ch.severity, ch.label])).toEqual([["not_billable", "warning", "Inte längre debiterbar: v. 53 2026"]]);
    expect(frozen.remarks).toBe(1);
    // Ekonomen rättar referensen och gör om fakturan: raderna fryses på nytt från dagens underlag.
    expect(await cmd(invoiceSetBuyerRef, { month: "2026-12", invoiceId: DEC2, reference: "55102938" })).toMatchObject({ ok: true });
    expect(await cmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 })).toEqual({ ok: true, reissued: true });
    const after = rows("invoice_lines").find((l) => l.invoiceDraftId === DEC2 && l.caseId === REFFEL1)!;
    expect(after.isoWeeks).not.toContain("2026-W53");
    expect(after.quantity).toBe(4);
    expect(after.description).toMatch(/v\. 49–52 2026$/);
    expect(rows("invoice_lines").filter((l) => l.invoiceDraftId === DEC2 && l.caseId !== REFFEL1).map((l) => [l.caseId, l.quantity])).toEqual(otherCases);
    expect(dec2()).toMatchObject({ status: "fortnox_created", fortnoxIdempotencyKey: "c-bot:2026-12:avtal-tillagg-2:ny" });
    expect(rows("invoice_credits").filter((x) => x.invoiceDraftId === DEC2).map((x) => x.id)).toEqual(["kredit-inv-c-bot-2026-12-avtal-tillagg-2-1"]);
    const line = (await qry(ekoRun, { month: "2026-12" })).invoices.find((x) => x.id === DEC2)!.lines.find((l) => l.caseId === REFFEL1)!;
    expect(line.checks.filter((ch) => ch.kind === "not_billable")).toEqual([]);
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "billing.credited_and_reissued", details: { changes: [{ caseId: REFFEL1, from: 5, to: 4 }] } });
    // Returneras den nya fakturan också görs den om med en ny nyckel och en ny kreditering.
    rt.store.updateRow("invoice_drafts", DEC2, { status: "returned" });
    expect(await cmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 })).toEqual({ ok: true, reissued: true });
    expect(dec2().fortnoxIdempotencyKey).toBe("c-bot:2026-12:avtal-tillagg-2:ny2");
    expect(rows("invoice_credits").filter((x) => x.invoiceDraftId === DEC2)).toHaveLength(2);
  });

  it("återstår ingen debiterbar vecka krediteras den returnerade fakturan utan ny faktura – den täcker inga veckor", async () => {
    const onDec2 = rows("invoice_lines").filter((l) => l.invoiceDraftId === DEC2);
    for (const l of onDec2) rt.store.updateRow("cases", l.caseId, { pausedWeeks: [...rt.raw().get("cases", l.caseId)!.pausedWeeks, ...l.isoWeeks] });
    await cmd(invoiceSetBuyerRef, { month: "2026-12", invoiceId: DEC2, reference: "55102938" });
    expect(await cmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 })).toEqual({ ok: true, reissued: false });
    expect(rt.raw().get("invoice_drafts", DEC2)?.status).toBe("credited");
    // Raderna står kvar som spår; fakturan finns inte längre bland månadens fakturor.
    expect(rows("invoice_lines").filter((l) => l.invoiceDraftId === DEC2)).toHaveLength(onDec2.length);
    expect((await qry(ekoRun, { month: "2026-12" })).invoices.map((x) => x.id)).not.toContain(DEC2);
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "billing.credited", entityId: DEC2 });
  });

  it("en skapelse som avbröts efter första raden kan göras om – fakturan fastnar aldrig som godkänd", async () => {
    await approveZeroWeeks();
    await cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" });
    await cmd(billingApproveInvoice, { month: "2027-01", invoiceId: JAN });
    const v = await qry(ekoRun, { month: "2027-01" });
    const [first] = v.invoices[0].lines;
    // Förra körningen hann skriva en rad (med fel innehåll) och en rad för ett ärende som inte längre hör till fakturan.
    const stray = rows("cases").find((c) => !v.invoices[0].lines.some((l) => l.caseId === c.id))!;
    for (const caseId of [first.caseId, stray.id]) {
      rt.store.insertRow("invoice_lines", {
        id: `${JAN}:${caseId}`, invoiceDraftId: JAN, caseId, priceItemId: "pi-x", quantity: 99, unitPriceOre: 1, vatRate: 25, description: "avbruten", isoWeeks: ["2027-W01"],
        zeroAttendanceWeeks: [], note: "",
      });
    }
    expect(await cmd(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] })).toMatchObject({ ok: true, created: [JAN], skipped: [] });
    expect(rt.raw().get("invoice_drafts", JAN)?.status).toBe("fortnox_created");
    const lines = rows("invoice_lines").filter((l) => l.invoiceDraftId === JAN);
    expect(lines).toHaveLength(124);
    expect(lines.find((l) => l.caseId === first.caseId)).toMatchObject({ quantity: first.quantity, description: first.lineText });
    expect(lines.some((l) => l.caseId === stray.id)).toBe(false);
    expect((await qry(ekoRun, { month: "2027-01" })).totalOre).toBe(51133200);
    // En omkörning hoppar över den skapade fakturan.
    expect(await cmd(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] })).toMatchObject({ ok: true, created: [], skipped: [JAN] });
  });

  it("manuell faktura på en faktura som ännu inte är sparad (avtal utan krav på beställarreferens): raden skapas först", async () => {
    const k = rt.raw().get("contracts", "c-bot")!;
    const cfg = structuredClone(k.config);
    cfg.billing!.buyerReference.required = false;
    rt.store.updateRow("contracts", k.id, { config: cfg });
    await approveZeroWeeks();
    expect(rt.raw().get("invoice_drafts", JAN)).toBeUndefined();
    expect(await cmd(billingMarkManual, { month: "2027-01", invoiceId: JAN, invoiceNo: "20417" })).toEqual({ ok: true });
    expect(rt.raw().get("invoice_drafts", JAN)).toMatchObject({ status: "manual", manualInvoiceNo: "20417" });
    expect(rows("invoice_lines").filter((l) => l.invoiceDraftId === JAN)).toHaveLength(124);
  });

  it("fakturans status och kontroller i radens detalj och på ärendets sida gäller hela fakturan (olika inköpsordernummer)", async () => {
    await cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" });
    const v0 = await qry(ekoRun, { month: "2027-01" });
    const [withPo, other] = v0.invoices[0].lines.map((l) => l.caseId);
    rt.store.updateRow("cases", withPo, { purchaseOrderNumber: "991234567" });
    const v = await qry(ekoRun, { month: "2027-01" });
    expect(v.invoices[0]).toMatchObject({ id: JAN, status: "blocked" });
    expect(v.invoices[0].checks.map((ch) => ch.kind)).toContain("po_mixed");
    expect((await qry(ekoLine, { month: "2027-01", caseId: other }))?.invoice).toMatchObject({ id: JAN, status: "blocked" });
    expect((await qry(ekoCase, { caseId: other }))?.months.find((m) => m.mk === "2027-01")).toMatchObject({ invoiceId: JAN, status: "blocked" });
  });

  it("reservläget en faktura per ärende: ärendets referens gäller, och alla månadens fakturor kan skapas i ett anrop", async () => {
    const k = rt.raw().get("contracts", "c-bot")!;
    const cfg = structuredClone(k.config);
    cfg.billing!.invoicePer = "case_and_month";
    rt.store.updateRow("contracts", k.id, { config: cfg });
    const v = await qry(ekoRun, { month: "2027-01" });
    expect(v.invoices.length).toBe(124);
    // Fakturans referens är ärendets (Miljonbemannings anteckning när beställningen togs emot) – kontrollerad som alla referenser.
    for (const inv of v.invoices) {
      const c = rt.raw().get("cases", inv.lines[0].caseId)!;
      expect(inv.buyerReference).toBe(c.buyerReference);
      expect(inv.checks.some((ch) => ch.kind === "buyer_ref")).toBe(!refInfo(c.buyerReference, { billing: cfg.billing!, registry: rows("buyer_references") }).ok);
    }
    const ok = v.invoices.filter((x) => !x.blocked).length;
    expect(ok).toBeGreaterThan(100);
    // Skärmen skickar alla månadens fakturor i ett anrop (fler än 100).
    const r = await cmd(billingSendFortnox, { month: "2027-01", invoiceIds: v.invoices.map((x) => x.id) });
    expect(r).toMatchObject({ ok: true, created: [] });
    if (r.ok) expect(r.notApproved.length + r.blocked.length).toBe(124);
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
    const d = await qry(ekoLine, { month: "2027-01", caseId: "case-260131" });
    expect(d?.overlaps["Överlappar BOT-27-0004"].askedAt).toBe(t.createdAt);
    expect(await cmd(ekoAskCoordinator, { month: "2027-01", caseId: "case-260131", otherCaseId: "case-260143" })).toMatchObject({ ok: false, error: "no_overlap" });
  });

  it("uppgift klar; körningen stängs bara när alla fakturor är skapade", async () => {
    expect(await cmd(ekoTaskDone, { taskId: "task-1" })).toEqual({ ok: true });
    expect(rows("tasks").find((t) => t.id === "task-1")).toMatchObject({ status: "done", doneBy: "u-lars" });
    expect(await cmd(ekoTaskDone, { taskId: "finns-inte" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(ekoCloseRun, { month: "2027-01" })).toMatchObject({ ok: false, error: "not_done" });
    await approveZeroWeeks();
    await cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" });
    await cmd(billingApproveInvoice, { month: "2027-01", invoiceId: JAN });
    await cmd(billingSendFortnox, { month: "2027-01", invoiceIds: [JAN] });
    expect(await cmd(ekoCloseRun, { month: "2027-01" })).toEqual({ ok: true });
    expect(rows("billing_runs").find((r) => r.month === "2027-01")).toMatchObject({ status: "closed", closedBy: "u-lars" });
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "billing.run_closed", entityId: "br-2027-01" });
  });

  it("bara ekonomen gör åtgärderna", async () => {
    for (const p of [
      cmd(ekoFortnoxSync, { month: "2027-01" }, karin()),
      cmd(ekoReissue, { month: "2026-12", invoiceId: DEC2 }, karin()),
      cmd(ekoTaskDone, { taskId: "task-1" }, karin()),
      cmd(ekoCloseRun, { month: "2027-01" }, karin()),
      cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: JAN, reference: "55102938" }, as("u-johan", "avtalsansvarig")),
    ]) {
      await expect(p).rejects.toBeInstanceOf(ApiError);
    }
  });
});
