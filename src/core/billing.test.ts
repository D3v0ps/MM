import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSeed } from "@/data/seed";
import type { Db, InvoiceDraft, InvoiceLine } from "@/data/schema";
import {
  billableWeeks, billingLines, buyerRefProblem, CONTRACT_GROUP, groupingKeyOf, invoiceIdOf, invoiceLookup, invoiceRefProblem, invoiceStatus, monthInvoices, parseGroupingKey,
  unbilledOld, vatBreakdown, weekText,
} from "./billing";
import { DEFAULT_ORG_SETTINGS } from "./config";
import { domainEnv } from "./env";
import { cfgWith, mkActivity, mkAttendance, mkBillingRun, mkCase, mkInvoiceDraft, mkPriceItem, testDb, testEnv } from "./test-data";

const env = testEnv();
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

/** En sparad faktura för månaden (avtalets grupp) med status och referens. */
const draft = (month: string, p: Partial<InvoiceDraft> = {}): InvoiceDraft =>
  mkInvoiceDraft({ month, id: invoiceIdOf("c-bot", month, p.groupingKey ?? CONTRACT_GROUP), ...p });
/** En fryst rad på en skapad faktura. */
const frozen = (invoiceDraftId: string, caseId: string, weeks: string[], unitPriceOre = 139800): InvoiceLine => ({
  id: `${invoiceDraftId}:${caseId}`, invoiceDraftId, caseId, priceItemId: "pi-G", quantity: weeks.length, unitPriceOre, vatRate: 25, description: `rad ${caseId}`,
  isoWeeks: weeks, zeroAttendanceWeeks: [], note: "",
});

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
    expect(monthInvoices(db, "2026-09", env).invoices).toEqual([]);
    expect(monthInvoices(db, "2026-10", env).lines.map((x) => x.quantity)).toEqual([1]);
    // v. 13 2027: måndag 29 mars, torsdag 1 april -> april
    const mars = mkCase({ id: "c7", status: "closed", startDate: "2027-03-29", endDate: "2027-03-31" });
    expect(billableWeeks(mars, db, testEnv({ now: "2027-04-10T09:00" }))[0].monthKey).toBe("2027-04");
  });
});

describe("fakturarader per ärende och månad (räknas som förut)", () => {
  it("räknar veckor, belopp, upparbetat och återstående – en rad per ärende med ärendenumret som radtext", () => {
    const [l] = billingLines(base, "2027-01", env);
    expect(l).toMatchObject({
      month: "2027-01", caseId: "c1", caseNumber: "BOT-27-0001", areaCode: "G", quantity: 2, unitPriceOre: 139800, amountOre: 279600, vatRate: 25, articleNo: "BOT-G",
      priceItemId: "pi-G", caseBuyerReference: "55102938", casePurchaseOrderNumber: "", orderWeeks: 4, accruedWeeks: 3, remainingWeeks: 1, needsApproval: true,
      lineText: "BOT-27-0001 · v. 1, 3 2027",
    });
    expect(l.weeks.map((w) => w.key)).toEqual(["2027-W01", "2027-W03"]);
    expect(l.checks.map((c) => [c.kind, c.severity, c.label])).toEqual([
      ["zero_week", "needs_approval", "Ingen närvaro v. 3 2027"],
      ["paused", "info", "Pausad v. 2 2027"],
      ["partial", "info", "Delvis vecka"],
    ]);
    // Inga namn eller personnummer på raden – bara ärendenummer och veckor.
    expect(JSON.stringify(l)).not.toMatch(/Test|Testsson|personnummer/);
  });
  it("godkänd vecka utan närvaro kräver inte längre godkännande", () => {
    const db = { ...base, billing_week_approvals: [{ id: "c1:2027-W03", contractId: "c-bot", month: "2027-01", caseId: "c1", weekKey: "2027-W03", approvedBy: "u-lars", approvedAt: "2027-02-01T09:00", note: "Kontrollerad" }] };
    const [l] = billingLines(db, "2027-01", env);
    expect(l.needsApproval).toBe(false);
    expect(l.checks[0]).toMatchObject({ kind: "zero_week", severity: "approved", approval: { by: "u-lars", at: "2027-02-01T09:00", note: "Kontrollerad" } });
  });
  it("utan flaggning i avtalet blir veckan utan närvaro ingen kontroll", () => {
    const cfg = cfgWith((c) => { c.billing.flagZeroAttendanceWeeks = false; });
    expect(billingLines(base, "2027-01", { ...env, cfg })[0].checks.map((c) => c.kind)).toEqual(["paused", "partial"]);
  });
  it("överlapp: samma deltagare i två ärenden samma vecka", () => {
    const a = mkCase({ id: "c3", caseNumber: "BOT-26-0131", personId: "p-same", status: "closed", startDate: "2026-12-01", endDate: "2027-01-13" });
    const b = mkCase({ id: "c4", caseNumber: "BOT-27-0004", personId: "p-same", startDate: "2027-01-11" });
    const ov = billingLines(testDb({ cases: [a, b], price_items: price }), "2027-01", env).find((x) => x.caseId === "c3")?.checks.find((c) => c.kind === "overlap");
    expect(ov).toEqual({
      kind: "overlap", severity: "warning", label: "Överlappar BOT-27-0004",
      text: "Samma deltagare har ett annat ärende samma vecka (v. 2 2027). Samma vecka får bara faktureras en gång.",
    });
  });
  it("fler veckor än beställningen", () => {
    const c = mkCase({ id: "c5", caseNumber: "BOT-26-0005", startDate: "2026-12-01", orderValueWeeks: 2 });
    const [l] = billingLines(testDb({ cases: [c], price_items: price }), "2027-01", env);
    expect(l.accruedWeeks).toBe(9);
    expect(l.remainingWeeks).toBe(0);
    expect(l.checks.find((x) => x.kind === "over_order")?.text).toBe("Beställningen gäller 2 veckor men 9 veckor är upparbetade inklusive denna faktura.");
  });
  it("raderna sorteras på ärendenummer", () => {
    const cs = [mkCase({ id: "b", caseNumber: "BOT-27-0010", startDate: "2027-01-04" }), mkCase({ id: "a", caseNumber: "BOT-26-0100", startDate: "2027-01-04" })];
    expect(billingLines(testDb({ cases: cs, price_items: price }), "2027-01", env).map((x) => x.caseNumber)).toEqual(["BOT-26-0100", "BOT-27-0010"]);
  });
});

describe("en faktura per avtal och månad med en rad per ärende (beslut 2026-10-07, synpunkt #13)", () => {
  const two = testDb({
    cases: [
      c1,
      mkCase({ id: "c2", caseNumber: "BOT-27-0002", startDate: "2027-01-04", primaryAreaCode: "E", buyerReference: "7730045120" }),
    ],
    activities: c1Acts, attendance: c1Att, price_items: price,
  });

  it("alla ärenden på samma faktura; summor och moms per momssats", () => {
    const bm = monthInvoices(two, "2027-01", env);
    expect(bm.invoices).toHaveLength(1);
    const [inv] = bm.invoices;
    expect(inv).toMatchObject({ id: "inv-c-bot-2027-01-avtal", groupingKey: "avtal", number: 1, stored: false, created: false, storedStatus: "draft" });
    expect(inv.lines.map((l) => [l.caseNumber, l.quantity, l.amountOre])).toEqual([["BOT-27-0001", 2, 279600], ["BOT-27-0002", 4, 4 * 156200]]);
    expect(inv.amountOre).toBe(279600 + 4 * 156200);
    expect(inv.vat).toEqual([{ rate: 25, baseOre: 279600 + 624800, vatOre: Math.round((904400 * 25) / 100) }]);
    expect(bm).toMatchObject({ count: 2, weeks: 6, totalOre: 904400, invoicePer: "contract_and_month" });
  });

  it("moms per momssats: två satser ger två momsrader", () => {
    expect(vatBreakdown([{ vatRate: 25, amountOre: 100000 }, { vatRate: 6, amountOre: 50000 }, { vatRate: 25, amountOre: 30000 }])).toEqual([
      { rate: 6, baseOre: 50000, vatOre: 3000 },
      { rate: 25, baseOre: 130000, vatOre: 32500 },
    ]);
  });

  it("beställarreferensen hör till fakturan: saknas, fel format eller spärrad stoppar – giltig stoppar inte (CLAUDE.md punkt 11)", () => {
    const refs = [{ id: "br1", customerId: "org-bot", reference: "55102983", unit: "Tumba", active: false, note: "Finns inte hos kommunen." }];
    const withRef = (buyerReference: string | null) =>
      monthInvoices({ ...two, buyer_references: refs, invoice_drafts: buyerReference === undefined ? [] : [draft("2027-01", { buyerReference })] }, "2027-01", env).invoices[0];
    // Ärendenas egna referenser (anteckningar från mottagandet) räcker inte – fakturan har ingen referens förrän MB fyller i den.
    const none = monthInvoices(two, "2027-01", env).invoices[0];
    expect(none.buyerReference).toBeNull();
    expect(none).toMatchObject({ blocked: true, status: "blocked" });
    expect(none.checks).toEqual([
      { kind: "buyer_ref", severity: "blocking", label: "Beställarreferens saknas eller är fel", text: "Beställarreferens saknas. Fyll i kommunens referens för fakturan – utan den kan fakturan inte skapas." },
    ]);
    expect(withRef("5510293")).toMatchObject({ blocked: true, checks: [{ kind: "buyer_ref", text: "Beställarreferensen ska vara 8–10 siffror. Du har skrivit 7." }] });
    expect(withRef("55102983")).toMatchObject({ blocked: true, checks: [{ kind: "buyer_ref", text: "Beställarreferensen 55102983 är spärrad. Finns inte hos kommunen." }] });
    const ok = withRef("55102938");
    expect(ok).toMatchObject({ blocked: false, status: "draft", buyerReference: "55102938", checks: [] });
    expect(invoiceRefProblem(" ", testDb(), env.cfg)).toMatch(/saknas/);
    expect(invoiceRefProblem("55102938", testDb(), env.cfg)).toBeNull();
  });

  it("inköpsordernumret: bara kommunens 99-nummer; olika nummer på raderna stoppar fakturan", () => {
    const po = (a: string | null, b: string | null, invoicePo?: string | null) => {
      const cs = [
        mkCase({ id: "p1", caseNumber: "BOT-27-0101", startDate: "2027-01-04", purchaseOrderNumber: a }),
        mkCase({ id: "p2", caseNumber: "BOT-27-0102", startDate: "2027-01-04", purchaseOrderNumber: b }),
      ];
      const d = draft("2027-01", { buyerReference: "55102938", ...(invoicePo !== undefined ? { purchaseOrderNumber: invoicePo } : {}) });
      return monthInvoices(testDb({ cases: cs, price_items: price, invoice_drafts: [d] }), "2027-01", env).invoices[0];
    };
    // Samma 99-nummer på alla rader blir fakturans.
    expect(po("991234567", "991234567")).toMatchObject({ purchaseOrderNumber: "991234567", blocked: false });
    // Inget nummer: tomt (OrderReference lämnas tomt).
    expect(po(null, null)).toMatchObject({ purchaseOrderNumber: "", blocked: false });
    // Fel format (inte 99…) stoppar.
    expect(po("12345", "12345").checks).toEqual([{ kind: "po", severity: "blocking", label: "Inköpsordernumret har fel format", text: "Inköpsordernummer ska vara nio siffror som börjar med 99." }]);
    // Olika nummer kan inte stå på en faktura – stoppar tills ekonomen väljer.
    expect(po("991234567", null).checks.map((c) => c.kind)).toEqual(["po_mixed"]);
    expect(po("991234567", null, "")).toMatchObject({ purchaseOrderNumber: "", blocked: false });
    expect(po("991234567", "997654321", "991234567")).toMatchObject({ purchaseOrderNumber: "991234567", blocked: false });
  });

  it("en skapad faktura har frysta rader; veckor som tillkommer efteråt hamnar på en tilläggsfaktura – varje vecka faktureras en gång", () => {
    const c = mkCase({ id: "s1", caseNumber: "BOT-27-0201", startDate: "2027-01-04", endDate: "2027-01-31", status: "closed" });
    const main = draft("2027-01", { status: "fortnox_created", buyerReference: "55102938", fortnoxIdempotencyKey: "c-bot:2027-01:avtal" });
    // Fakturan skapades med v. 1–3. Sedan registrerades v. 4 (slutdatumet ändrades) – den ska inte ändra den skapade fakturan.
    const db = testDb({ cases: [c], price_items: price, invoice_drafts: [main], invoice_lines: [frozen(main.id, "s1", ["2027-W01", "2027-W02", "2027-W03"])] });
    const bm = monthInvoices(db, "2027-01", env);
    expect(bm.invoices.map((x) => [x.groupingKey, x.status, x.lines.map((l) => l.weeks.map((w) => w.key).join(","))])).toEqual([
      ["avtal", "fortnox_created", ["2027-W01,2027-W02,2027-W03"]],
      ["avtal-tillagg-2", "blocked", ["2027-W04"]],
    ]);
    const supp = bm.invoices[1];
    expect(supp).toMatchObject({ id: "inv-c-bot-2027-01-avtal-tillagg-2", number: 2, stored: false, quantity: 1, amountOre: 139800 });
    expect(supp.lines[0].lineText).toBe("BOT-27-0201 · v. 4 2027");
    // Summan av båda fakturorna = hela månadens underlag (inga dubbletter, inget saknas).
    expect(bm.totalOre).toBe(billingLines(db, "2027-01", env)[0].amountOre);
    // Veckornas status: v. 1–3 skapade, v. 4 underlag.
    const look = invoiceLookup(db);
    expect(["2027-W01", "2027-W04"].map((k) => look.statusOf(c, "2027-01", k))).toEqual(["fortnox_created", "draft"]);
    expect(parseGroupingKey(groupingKeyOf("avtal", 2))).toEqual({ base: "avtal", n: 2 });
    expect(parseGroupingKey("case-260117")).toEqual({ base: "case-260117", n: 1 });
  });

  it("frysta rader behåller sitt sparade belopp och sin text, också om priset eller närvaron ändras efteråt", () => {
    const main = draft("2027-01", { status: "paid", buyerReference: "55102938" });
    const db = { ...base, invoice_drafts: [main], invoice_lines: [{ ...frozen(main.id, "c1", ["2027-W01", "2027-W03"], 120000), note: "Sparad text" }] };
    const [inv] = monthInvoices(db, "2027-01", env).invoices;
    expect(inv.lines[0]).toMatchObject({ frozen: true, unitPriceOre: 120000, amountOre: 240000, note: "Sparad text", needsApproval: false, lineText: "rad c1" });
    expect(inv).toMatchObject({ created: true, blocked: false, needsApproval: false, checks: [] });
  });

  it("äldre data: en skapad faktura utan rader täcker hela månaden", () => {
    const db = { ...base, invoice_drafts: [draft("2027-01", { status: "paid", buyerReference: "55102938" })] };
    const bm = monthInvoices(db, "2027-01", env);
    expect(bm.invoices).toHaveLength(1);
    expect(bm.invoices[0]).toMatchObject({ status: "paid", created: true, amountOre: 279600 });
    expect(invoiceStatus(db, "2027-01", c1)).toBe("paid");
  });

  it("en faktura per ärende och månad finns kvar som val (invoicePer case_and_month)", () => {
    const cfg = cfgWith((c) => { c.billing.invoicePer = "case_and_month"; c.billing.collectiveInvoiceAllowed = false; });
    const bm = monthInvoices(two, "2027-01", { ...env, cfg });
    expect(bm.invoices.map((x) => [x.groupingKey, x.lines.map((l) => l.caseId)])).toEqual([["c1", ["c1"]], ["c2", ["c2"]]]);
    expect(bm.totalOre).toBe(monthInvoices(two, "2027-01", env).totalOre);
  });

  it("kreditering: den returnerade fakturan har samma frysta rader när den görs om – veckorna räknas sedan som fakturerade", () => {
    const c = mkCase({ id: "r1", caseNumber: "BOT-26-0117", status: "closed", startDate: "2026-11-30", endDate: "2026-12-13" });
    const supp = draft("2026-12", { groupingKey: groupingKeyOf("avtal", 2), status: "returned", buyerReference: "55102983" });
    const lines = [frozen(supp.id, "r1", ["2026-W49", "2026-W50"])];
    const refs = [{ id: "br1", customerId: "org-bot", reference: "55102983", unit: "Tumba", active: false, note: "Finns inte hos kommunen." }];
    const returned = testDb({ cases: [c], price_items: price, buyer_references: refs, invoice_drafts: [supp], invoice_lines: lines });
    const inv = monthInvoices(returned, "2026-12", env).invoices[0];
    // Returnerad med spärrad referens: stoppad tills referensen rättas.
    expect(inv).toMatchObject({ status: "returned", created: true, blocked: true, quantity: 2 });
    expect(unbilledOld(returned, env).map((x) => [x.week.key, x.status])).toEqual([["2026-W49", "returned"], ["2026-W50", "returned"]]);
    // Rättad referens och gjord om (ekonomi.reissue): samma rader, ny status – inga gamla ofakturerade veckor.
    const reissued = testDb({ ...returned, invoice_drafts: [{ ...supp, status: "fortnox_created", buyerReference: "55102938", fortnoxIdempotencyKey: "c-bot:2026-12:avtal-tillagg-2:ny" }] });
    const again = monthInvoices(reissued, "2026-12", env).invoices[0];
    expect(again).toMatchObject({ status: "fortnox_created", blocked: false, quantity: 2, amountOre: inv.amountOre });
    expect(again.lines.map((l) => l.weeks.map((w) => w.key))).toEqual(inv.lines.map((l) => l.weeks.map((w) => w.key)));
    expect(unbilledOld(reissued, env)).toEqual([]);
  });
});

describe("fakturastatus och ofakturerade veckor", () => {
  const c = mkCase({ id: "c6", caseNumber: "BOT-26-0117", status: "closed", startDate: "2026-11-30", endDate: "2026-12-13" });
  it("status per ärende och månad: fakturan som har ärendets rad, annars månadens öppna eller huvudfaktura, annars underlag", () => {
    const db = testDb({ cases: [c], invoice_drafts: [draft("2026-12", { status: "sent" })], billing_runs: [mkBillingRun({ month: "2026-12" })] });
    expect(invoiceStatus(db, "2026-12", c)).toBe("sent");
    expect(invoiceStatus(db, "2027-01", c)).toBe("draft");
    const approved = testDb({ cases: [c], invoice_drafts: [draft("2027-01", { status: "approved" })] });
    expect(invoiceStatus(approved, "2027-01", c)).toBe("approved");
  });
  it("ofakturerade veckor äldre än 45 dagar (åldern räknas från veckans söndag)", () => {
    const returned = testDb({ cases: [c], price_items: price, invoice_drafts: [draft("2026-12", { status: "returned" })] });
    expect(unbilledOld(returned, env).map((x) => [x.week.key, x.age, x.status, x.amountOre])).toEqual([
      ["2026-W49", 57, "returned", 139800],
      ["2026-W50", 50, "returned", 139800],
    ]);
    const paid = testDb({ cases: [c], price_items: price, invoice_drafts: [draft("2026-12", { status: "paid" })] });
    expect(unbilledOld(paid, env)).toEqual([]);
    expect(unbilledOld(returned, testEnv({ now: "2027-01-20T09:00" })).map((x) => x.week.key)).toEqual([]);
  });
  it("spärrad beställarreferens (ärendets referens vid mottagandet)", () => {
    const db = testDb({ buyer_references: [{ id: "br1", customerId: "org-bot", reference: "55102983", unit: "Alby", active: false, note: "Rätt är 55102938." }] });
    expect(buyerRefProblem({ buyerReference: "55102983" }, db, env.cfg)).toBe("Beställarreferensen 55102983 är spärrad. Rätt är 55102938.");
    expect(buyerRefProblem({ buyerReference: "55102938" }, db, env.cfg)).toBeNull();
  });
});

// ================================================================ Testdatat: summorna är desamma som med den gamla modellen
// Den gamla modellen (en faktura per ärende och månad) finns i facit från den gamla prototypen (src/core/parity/facit.json,
// fakturaunderlaget per månad och ärende). Den nya modellen grupperar samma rader i en faktura per avtal och månad (plus
// decembers tilläggsfaktura). För testdatats alla månader: summan av radernas belopp, antalet veckor och raderna per ärende
// är exakt desamma.
describe("testdatat: fakturornas rader per månad = den gamla modellens fakturor per ärende", () => {
  const facit = JSON.parse(readFileSync(new URL("./parity/facit.json", import.meta.url), "utf8")) as {
    meta: { now: string };
    billing: Record<string, { totalOre: number; count: number; weeks: number; invoices: { caseId: string; quantity: number; amountOre: number; unitPriceOre: number }[] }>;
  };
  const db = createSeed() as unknown as Db;
  const contract = db.contracts.find((c) => c.id === "c-bot")!;
  const seedEnv = domainEnv(contract, db.org_settings[0]?.settings ?? DEFAULT_ORG_SETTINGS, facit.meta.now);
  const months = Object.keys(facit.billing);

  it("alla sex månader i testdatat (september 2026 – februari 2027) finns i facit", () => {
    expect(months).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  for (const mk of months) {
    it(`${mk}: summan, veckorna och raderna per ärende är exakt desamma`, () => {
      const old = facit.billing[mk];
      const bm = monthInvoices(db, mk, seedEnv);
      expect(bm.totalOre).toBe(old.totalOre);
      expect(bm.invoices.reduce((s, x) => s + x.amountOre, 0)).toBe(old.totalOre);
      expect(bm.lines.reduce((s, l) => s + l.amountOre, 0)).toBe(old.totalOre);
      expect(bm.weeks).toBe(old.weeks);
      expect(bm.count).toBe(old.count);
      const byCase = (rows: { caseId: string; quantity: number; amountOre: number; unitPriceOre: number }[]) =>
        Object.fromEntries(rows.map((x) => [x.caseId, [x.quantity, x.unitPriceOre, x.amountOre]]));
      expect(byCase(bm.lines)).toEqual(byCase(old.invoices));
      // Varje ärende står på exakt en faktura i månaden.
      expect(new Set(bm.lines.map((l) => l.caseId)).size).toBe(bm.lines.length);
    });
  }

  it("grupperingen: en faktura per månad, december också med tilläggsfakturan för de två returnerade ärendena", () => {
    const shape = Object.fromEntries(months.map((mk) => [mk, monthInvoices(db, mk, seedEnv).invoices.map((x) => `${x.groupingKey}:${x.storedStatus}:${x.lines.length}`)]));
    expect(shape).toEqual({
      "2026-09": ["avtal:paid:11"], "2026-10": ["avtal:paid:69"], "2026-11": ["avtal:paid:108"],
      "2026-12": ["avtal:sent:129", "avtal-tillagg-2:returned:2"], "2027-01": ["avtal:draft:124"], "2027-02": ["avtal:draft:91"],
    });
    // Januari saknar beställarreferens tills ekonomen fyller i den (en per faktura).
    expect(monthInvoices(db, "2027-01", seedEnv).invoices[0]).toMatchObject({ buyerReference: null, blocked: true, status: "blocked" });
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
