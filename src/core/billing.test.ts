import { describe, expect, it } from "vitest";
import { billableWeeks, billingForMonth, buyerRefProblem, invoiceStatus, unbilledOld, weekText } from "./billing";
import { cfgWith, mkActivity, mkAttendance, mkBillingRun, mkCase, mkInvoiceDraft, mkPriceItem, testDb, testEnv } from "./test-data";

const env = testEnv();
const NB = " ";
const price = [mkPriceItem({ areaCode: "G", priceOre: 139800 }), mkPriceItem({ areaCode: "E", priceOre: 156200 })];

// c1: start onsdag 30 dec, slut tisdag 19 jan, v. 2 pausad. Närvaro v. 1, ogiltig frånvaro v. 3, oregistrerat v. 2.
const c1 = mkCase({ id: "c1", caseNumber: "BOT-27-0001", status: "closed", startDate: "2026-12-30", endDate: "2027-01-19", pausedWeeks: ["2027-W02"], orderValueWeeks: 4 });
const c1Acts = [
  mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-05T10:00" }),
  mkActivity({ id: "a2", caseId: "c1", startsAt: "2027-01-07T10:00" }),
  mkActivity({ id: "a3", caseId: "c1", startsAt: "2027-01-12T10:00" }),
  mkActivity({ id: "a4", caseId: "c1", startsAt: "2027-01-18T10:00" }),
];
const c1Att = [
  mkAttendance({ activityId: "a1", caseId: "c1", status: "present" }),
  mkAttendance({ activityId: "a2", caseId: "c1", status: "late" }),
  mkAttendance({ activityId: "a4", caseId: "c1", status: "absent_invalid" }),
];
const base = testDb({ cases: [c1], activities: c1Acts, attendance: c1Att, price_items: price });

describe("debiterbara veckor", () => {
  it("alla ISO-veckor med minst en inskriven dag; pausade markeras; torsdagen avgör månaden", () => {
    const w = billableWeeks(c1, base, env);
    expect(w.map((x) => x.key)).toEqual(["2026-W53", "2027-W01", "2027-W02", "2027-W03"]);
    expect(w.map((x) => x.monthKey)).toEqual(["2026-12", "2027-01", "2027-01", "2027-01"]);
    expect(w.map((x) => x.paused)).toEqual([false, false, true, false]);
    expect(w.map((x) => x.partial)).toEqual([true, false, false, true]);
    expect(w.map((x) => x.enrolledDays)).toEqual([5, 7, 7, 2]);
  });
  it("flaggar vecka utan närvaro och saknad registrering", () => {
    const w = billableWeeks(c1, base, env);
    expect(w[1]).toMatchObject({ planned: 2, attended: 2, registered: 2, zeroAttendance: false, missingRegistration: false });
    expect(w[2]).toMatchObject({ planned: 1, registered: 0, zeroAttendance: false, missingRegistration: true });
    expect(w[3]).toMatchObject({ planned: 1, attended: 0, registered: 1, zeroAttendance: true });
  });
  it("pågående ärende: till och med innevarande vecka", () => {
    const c = mkCase({ id: "c9", startDate: "2027-01-20" });
    expect(billableWeeks(c, base, env).map((x) => x.key)).toEqual(["2027-W03", "2027-W04", "2027-W05"]);
  });
  it("inga veckor före start", () => {
    expect(billableWeeks(mkCase({ id: "c9", startDate: "2027-02-08" }), base, env)).toEqual([]);
    expect(billableWeeks(mkCase({ id: "c9", startDate: null }), base, env)).toEqual([]);
  });
  it("torsdagsregeln: veckan faktureras i månaden där torsdagen infaller", () => {
    // v. 40 2026: måndag 28 september, torsdag 1 oktober -> oktober
    const sept = mkCase({ id: "c8", caseNumber: "BOT-26-0008", status: "closed", startDate: "2026-09-28", endDate: "2026-10-02" });
    const db = testDb({ cases: [sept], price_items: price });
    expect(billableWeeks(sept, db, env).map((x) => [x.key, x.monthKey])).toEqual([["2026-W40", "2026-10"]]);
    expect(billingForMonth(db, "2026-09", env).count).toBe(0);
    expect(billingForMonth(db, "2026-10", env).invoices.map((x) => x.quantity)).toEqual([1]);
    // v. 13 2027: måndag 29 mars, torsdag 1 april -> april
    const mars = mkCase({ id: "c7", status: "closed", startDate: "2027-03-29", endDate: "2027-03-31" });
    expect(billableWeeks(mars, db, testEnv({ now: "2027-04-10T09:00" }))[0].monthKey).toBe("2027-04");
  });
});

describe("fakturaunderlag per ärende och månad", () => {
  it("räknar veckor, belopp, upparbetat och återstående med prototypens texter", () => {
    const b = billingForMonth(base, "2027-01", env);
    expect(b).toMatchObject({ month: "2027-01", count: 1, totalOre: 2 * 139800, weeks: 2, blocked: 0, needsApproval: 1, collectiveAllowed: false });
    const inv = b.invoices[0];
    expect(inv).toMatchObject({
      id: "inv-2027-01-c1", caseId: "c1", caseNumber: "BOT-27-0001", areaCode: "G", quantity: 2, unitPriceOre: 139800, amountOre: 279600, vatRate: 25, articleNo: "BOT-G",
      buyerReference: "55102938", purchaseOrderNumber: "", orderWeeks: 4, orderValueOre: 559200, accruedWeeks: 3, accruedOre: 419400, remainingWeeks: 1, remainingOre: 139800,
      blocked: false, needsApproval: true, status: "draft", fortnoxNo: null, lineText: "BOT-27-0001 · v. 1, 3 2027",
    });
    expect(inv.weeks.map((w) => w.key)).toEqual(["2027-W01", "2027-W03"]);
    expect(inv.invoiceText).toBe(
      `Beställning BOT-27-0001: planerat 4 veckor, 5${NB}592${NB}kr. Upparbetat inklusive denna faktura: 3 veckor, 4${NB}194${NB}kr. Återstår: 1 vecka, 1${NB}398${NB}kr.`,
    );
    expect(inv.checks.map((c) => [c.kind, c.severity, c.label])).toEqual([
      ["zero_week", "needs_approval", "Ingen närvaro v. 3 2027"],
      ["paused", "info", "Pausad v. 2 2027"],
      ["partial", "info", "Delvis vecka"],
    ]);
  });
  it("godkänd vecka utan närvaro blockerar inte längre", () => {
    const db = { ...base, billing_week_approvals: [{ id: "c1:2027-W03", contractId: "c-bot", month: "2027-01", caseId: "c1", weekKey: "2027-W03", approvedBy: "u-lars", approvedAt: "2027-02-01T09:00", note: "Kontrollerad" }] };
    const inv = billingForMonth(db, "2027-01", env).invoices[0];
    expect(inv.needsApproval).toBe(false);
    expect(inv.checks[0]).toMatchObject({ kind: "zero_week", severity: "approved", approval: { by: "u-lars", at: "2027-02-01T09:00", note: "Kontrollerad" } });
  });
  it("utan flaggning i avtalet blir veckan utan närvaro ingen kontroll", () => {
    const cfg = cfgWith((c) => { c.billing.flagZeroAttendanceWeeks = false; });
    expect(billingForMonth(base, "2027-01", { ...env, cfg }).invoices[0].checks.map((c) => c.kind)).toEqual(["paused", "partial"]);
  });
  it("fel beställarreferens och inköpsordernummer stoppar fakturan", () => {
    const c = mkCase({ id: "c2", caseNumber: "BOT-27-0002", startDate: "2027-01-04", buyerReference: "5510293", purchaseOrderNumber: "12345" });
    const inv = billingForMonth(testDb({ cases: [c], price_items: price }), "2027-01", env).invoices[0];
    expect(inv.blocked).toBe(true);
    expect(inv.status).toBe("blocked");
    expect(inv.checks.slice(0, 2)).toEqual([
      { kind: "buyer_ref", severity: "blocking", label: "Beställarreferens saknas eller är fel", text: "Beställarreferensen ska vara 8–10 siffror. Du har skrivit 7." },
      { kind: "po", severity: "blocking", label: "Inköpsordernumret har fel format", text: "Inköpsordernummer ska vara nio siffror som börjar med 99." },
    ]);
  });
  it("spärrad beställarreferens", () => {
    const db = testDb({ buyer_references: [{ id: "br1", customerId: "org-bot", reference: "55102983", unit: "Alby", active: false, note: "Rätt är 55102938." }] });
    expect(buyerRefProblem({ buyerReference: "55102983" }, db, env.cfg)).toBe("Beställarreferensen 55102983 är spärrad. Rätt är 55102938.");
    expect(buyerRefProblem({ buyerReference: "55102938" }, db, env.cfg)).toBeNull();
  });
  it("överlapp: samma deltagare i två ärenden samma vecka", () => {
    const a = mkCase({ id: "c3", caseNumber: "BOT-26-0131", personId: "p-same", status: "closed", startDate: "2026-12-01", endDate: "2027-01-13" });
    const b = mkCase({ id: "c4", caseNumber: "BOT-27-0004", personId: "p-same", startDate: "2027-01-11" });
    const res = billingForMonth(testDb({ cases: [a, b], price_items: price }), "2027-01", env);
    const ov = res.invoices.find((x) => x.caseId === "c3")?.checks.find((c) => c.kind === "overlap");
    expect(ov).toEqual({
      kind: "overlap", severity: "warning", label: "Överlappar BOT-27-0004",
      text: "Samma deltagare har ett annat ärende samma vecka (v. 2 2027). Samma vecka får bara faktureras en gång.",
    });
  });
  it("fler veckor än beställningen", () => {
    const c = mkCase({ id: "c5", caseNumber: "BOT-26-0005", startDate: "2026-12-01", orderValueWeeks: 2 });
    const inv = billingForMonth(testDb({ cases: [c], price_items: price }), "2027-01", env).invoices[0];
    expect(inv.accruedWeeks).toBe(9);
    expect(inv.remainingWeeks).toBe(0);
    expect(inv.checks.find((x) => x.kind === "over_order")?.text).toBe("Beställningen gäller 2 veckor men 9 veckor är upparbetade inklusive denna faktura.");
  });
  it("fakturorna sorteras på ärendenummer", () => {
    const cs = [mkCase({ id: "b", caseNumber: "BOT-27-0010", startDate: "2027-01-04" }), mkCase({ id: "a", caseNumber: "BOT-26-0100", startDate: "2027-01-04" })];
    expect(billingForMonth(testDb({ cases: cs, price_items: price }), "2027-01", env).invoices.map((x) => x.caseNumber)).toEqual(["BOT-26-0100", "BOT-27-0010"]);
  });
});

describe("fakturastatus", () => {
  const c = mkCase({ id: "c6", caseNumber: "BOT-26-0117", status: "closed", startDate: "2026-11-30", endDate: "2026-12-13" });
  it("egen status, annars körningens standard, annars underlag", () => {
    const db = testDb({ billing_runs: [mkBillingRun({ month: "2026-12", defaultInvoiceStatus: "sent" })], invoice_drafts: [mkInvoiceDraft({ month: "2026-12", caseId: "x", status: "returned" })] });
    expect(invoiceStatus(db, "2026-12", "c6")).toBe("sent");
    expect(invoiceStatus(db, "2026-12", "x")).toBe("returned");
    expect(invoiceStatus(db, "2027-01", "c6")).toBe("draft");
  });
  it("godkänd faktura och sparat Fortnox-nummer", () => {
    const db = testDb({
      cases: [c], price_items: price,
      invoice_drafts: [mkInvoiceDraft({ month: "2026-12", caseId: "c6", status: "fortnox_created", fortnoxDocumentNumber: "12345" })],
    });
    expect(billingForMonth(db, "2026-12", env).invoices[0]).toMatchObject({ status: "fortnox_created", fortnoxNo: "12345" });
    const approved = testDb({ cases: [c], price_items: price, invoice_drafts: [mkInvoiceDraft({ month: "2026-12", caseId: "c6", approvedAt: "2027-01-03T10:00" })] });
    expect(billingForMonth(approved, "2026-12", env).invoices[0].status).toBe("approved");
  });
  it("ofakturerade veckor äldre än 45 dagar (åldern räknas från veckans söndag)", () => {
    const returned = testDb({ cases: [c], price_items: price, billing_runs: [mkBillingRun({ month: "2026-12", defaultInvoiceStatus: "returned" })] });
    expect(unbilledOld(returned, env).map((x) => [x.week.key, x.age, x.status, x.amountOre])).toEqual([
      ["2026-W49", 57, "returned", 139800],
      ["2026-W50", 50, "returned", 139800],
    ]);
    const paid = testDb({ ...returned, invoice_drafts: [mkInvoiceDraft({ month: "2026-12", caseId: "c6", status: "paid" })] });
    expect(unbilledOld(paid, env)).toEqual([]);
    expect(unbilledOld(returned, testEnv({ now: "2027-01-20T09:00" })).map((x) => x.week.key)).toEqual([]);
  });
});

describe("veckotext", () => {
  it("luckor för pausade veckor", () => {
    const w = (week: number, monday: string) => ({ key: `2027-W0${week}`, week, year: 2027, monday });
    expect(weekText([w(1, "2027-01-04"), w(3, "2027-01-18"), w(4, "2027-01-25")])).toBe("v. 1, 3–4 2027");
    expect(weekText([w(1, "2027-01-04")])).toBe("v. 1 2027");
    expect(weekText([])).toBe("");
  });
});
