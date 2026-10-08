// Migrationen 0023 (en faktura per avtal och månad, beslut 2026-10-07, synpunkt #13) på data som fanns före beslutet:
// körningar med standardstatus och fakturor per ärende och månad (returnerade, manuella, skapade och godkända) och en
// kreditering per ärende. Kör migrationerna före 0023, läser in testdatat med de kolumner som finns då (utan fakturorna),
// lägger till de gamla fakturaraderna och kör sedan 0023 och de senare migrationerna – samma ordning som i driften.
// Bara påhittade uppgifter.
// Kör: npx vitest run src/data/supabase/migration-0023.test.ts
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { billableWeeks, invoiceLookup, unbilledOld } from "@/core/billing";
import { requireOperational } from "@/core/config";
import { NOW } from "@/data/seed/constants";
import { COLUMNS, quoteIdent, snakeCase, type SqlType } from "../../../scripts/db/columns";
import { seedData, sqlLiteral } from "../../../scripts/db/seed-sql";
import type { BillingRun, InvoiceDraft, InvoiceLine, TableName } from "../schema";
import { fromDbRow } from "./columns";
import { migrationFiles, SUPABASE_STUB_SQL } from "./pglite";
import { SEED_TABLE_ORDER } from "./seed-rows";

const data = seedData();
const MIGRATION = "0023_faktura_per_manad.sql";
/** Fakturatabellerna läses inte in från testdatat – de gamla raderna läggs in nedan. Bilagorna (0024) finns inte än. */
const SKIP = new Set<TableName>(["billing_runs", "invoice_drafts", "invoice_lines", "invoice_credits", "fortnox_runs", "billing_week_approvals", "case_attachments"]);

let db: PGlite;
let failure: string | null = null;

/** INSERT med bara de kolumner som finns i databasen före 0023 (senare migrationer lägger till kolumner). */
async function insertExisting(t: TableName, rows: readonly object[]) {
  if (!rows.length) return;
  const existing = new Set((await db.query<{ c: string }>("select column_name as c from information_schema.columns where table_schema = 'public' and table_name = $1", [t])).rows.map((r) => r.c));
  const cols = Object.entries(COLUMNS[t] as Record<string, SqlType>).filter(([f]) => existing.has(snakeCase(f)));
  for (let i = 0; i < rows.length; i += 200) {
    const values = rows.slice(i, i + 200).map((r) => `(${cols.map(([f, type]) => sqlLiteral((r as Record<string, unknown>)[f], type)).join(", ")})`);
    await db.exec(`insert into public.${t} (${cols.map(([f]) => quoteIdent(snakeCase(f))).join(", ")}) values ${values.join(", ")}`);
  }
}

// Debiterbara ärenden per månad som appen räknar dem (billableWeeks: pausade veckor räknas inte) – facit för migrationen.
const env = { now: NOW };
const billableIn = (month: string) =>
  data.cases.filter((c) => c.contractId === "c-bot" && billableWeeks(c, data, env).some((w) => w.monthKey === month && !w.paused)).map((c) => c.id).sort();
const MONTHS = ["2026-10", "2026-11", "2026-12"];
// Två ärenden med debiterbara veckor i oktober–december.
const [caseA, caseB] = data.cases.filter((c) => MONTHS.every((m) => billableIn(m).includes(c.id))).slice(0, 2);
const oldDraft = (month: string, caseId: string, status: string, extra: Record<string, string> = {}) =>
  `insert into public.invoice_drafts (id, billing_run_id, contract_id, month, kind, case_id, grouping_key, buyer_reference, purchase_order_number, invoiced_object, status, approved_at, fortnox_document_number, manual_invoice_no)
   values ('inv-${month}-${caseId}', 'br-${month}', 'c-bot', '${month}', 'periodic', '${caseId}', '${month}:${caseId}', ${extra.ref ? `'${extra.ref}'` : "null"}, null, '${caseId}', '${status}', ${extra.approvedAt ? `'${extra.approvedAt}'` : "null"}, ${extra.fortnoxNo ? `'${extra.fortnoxNo}'` : "null"}, ${extra.manualNo ? `'${extra.manualNo}'` : "null"})`;

beforeAll(async () => {
  const files = migrationFiles();
  const at = files.findIndex((f) => f.endsWith(MIGRATION));
  db = new PGlite();
  await db.waitReady;
  await db.exec(SUPABASE_STUB_SQL);
  for (const f of files.slice(0, at)) await db.exec(readFileSync(f, "utf8"));
  for (const t of SEED_TABLE_ORDER) if (!SKIP.has(t)) await insertExisting(t, data[t] as unknown as object[]);

  // Före beslutet: körningar med standardstatus och fakturor per ärende och månad.
  await db.exec(`
    insert into public.billing_runs (id, contract_id, month, status, created_by, created_at, default_invoice_status) values
      ('br-2026-10', 'c-bot', '2026-10', 'closed', 'u-lars', '2026-11-03 09:00+01', null),
      ('br-2026-11', 'c-bot', '2026-11', 'closed', 'u-lars', '2026-12-02 09:00+01', 'paid'),
      ('br-2026-12', 'c-bot', '2026-12', 'closed', 'u-lars', '2027-01-05 09:00+01', 'sent'),
      ('br-2027-01', 'c-bot', '2027-01', 'draft', 'system', '2027-02-01 06:00+01', 'draft');
    ${oldDraft("2026-10", caseA.id, "fortnox_created", { fortnoxNo: "10042" })};
    ${oldDraft("2026-10", caseB.id, "manual", { manualNo: "20417" })};
    ${oldDraft("2026-11", caseA.id, "paid", { ref: "55102938" })};
    ${oldDraft("2026-12", caseA.id, "returned", { ref: "55102983" })};
    ${oldDraft("2026-12", caseB.id, "returned", { ref: "55102983" })};
    ${oldDraft("2027-01", caseA.id, "draft", { approvedAt: "2027-02-01 09:00+01" })};
    insert into public.invoice_credits (id, contract_id, month, case_id, credited_at, credited_by, buyer_reference) values
      ('kredit-x', 'c-bot', '2026-12', '${caseA.id}', '2027-01-20 10:00+01', 'u-lars', '55102938');
  `);

  try {
    for (const f of files.slice(at)) await db.exec(readFileSync(f, "utf8"));
  } catch (e) {
    failure = (e as Error).message;
  }
}, 120_000);

describe("migrationen 0023 på fakturor per ärende från före beslutet", () => {
  it("går igenom", () => {
    expect(failure).toBeNull();
  });

  it("en faktura per skapad status och månad: körningens standardstatus först, sedan den högsta – underlag blir ingen faktura", async () => {
    expect(caseA && caseB).toBeTruthy();
    const r = await db.query<{ id: string; month: string; grouping_key: string; case_id: string | null; status: string; buyer_reference: string | null; fortnox_idempotency_key: string | null; invoiced_object: string }>(
      "select id, month, grouping_key, case_id, status, buyer_reference, fortnox_idempotency_key, invoiced_object from public.invoice_drafts order by month, grouping_key",
    );
    const novRefs = new Set(billableIn("2026-11").map((id) => (id === caseA.id ? "55102938" : data.cases.find((c) => c.id === id)!.buyerReference)));
    const decRefs = new Set(billableIn("2026-12").filter((id) => id !== caseA.id && id !== caseB.id).map((id) => data.cases.find((c) => c.id === id)!.buyerReference));
    const inv = (month: string, grouping_key: string, status: string, buyer_reference: string | null) => ({
      id: `inv-c-bot-${month}-${grouping_key}`, month, grouping_key, case_id: null, status, buyer_reference, fortnox_idempotency_key: `c-bot:${month}:${grouping_key}`, invoiced_object: "332026110",
    });
    expect(r.rows).toEqual([
      // Oktober utan standardstatus: B manuellt (högst) och A skapad i Fortnox – två fakturor, med ärendenas referenser.
      inv("2026-10", "avtal", "manual", caseB.buyerReference),
      inv("2026-10", "avtal-tillagg-2", "fortnox_created", caseA.buyerReference),
      // November: standardstatusen betald gäller alla debiterbara ärenden.
      inv("2026-11", "avtal", "paid", novRefs.size === 1 ? [...novRefs][0] : null),
      // December: standardstatusen skickad för alla utom A och B, som var returnerade.
      inv("2026-12", "avtal", "sent", decRefs.size === 1 ? [...decRefs][0] : null),
      inv("2026-12", "avtal-tillagg-2", "returned", "55102983"),
    ]);
  });

  it("en rad per ärende med fakturans status (utan veckor) – de gamla fakturanumren sparas i anmärkningen", async () => {
    const rows = (await db.query<{ invoice_draft_id: string; case_id: string; iso_weeks: string[]; note: string }>(
      "select invoice_draft_id, case_id, iso_weeks, note from public.invoice_lines order by invoice_draft_id, case_id",
    )).rows;
    const casesOn = (id: string) => rows.filter((x) => x.invoice_draft_id === id).map((x) => x.case_id).sort();
    expect(casesOn("inv-c-bot-2026-10-avtal")).toEqual([caseB.id]);
    expect(casesOn("inv-c-bot-2026-10-avtal-tillagg-2")).toEqual([caseA.id]);
    expect(casesOn("inv-c-bot-2026-11-avtal")).toEqual(billableIn("2026-11"));
    expect(casesOn("inv-c-bot-2026-12-avtal")).toEqual(billableIn("2026-12").filter((id) => id !== caseA.id && id !== caseB.id));
    expect(casesOn("inv-c-bot-2026-12-avtal-tillagg-2")).toEqual([caseA.id, caseB.id].sort());
    expect(rows.every((x) => x.iso_weeks.length === 0)).toBe(true);
    expect(rows.find((x) => x.invoice_draft_id === "inv-c-bot-2026-10-avtal-tillagg-2")?.note).toBe("Före 0023: Fortnox-nummer 10042");
    expect(rows.find((x) => x.invoice_draft_id === "inv-c-bot-2026-10-avtal")?.note).toBe("Före 0023: manuellt fakturanummer 20417");
    expect(rows.filter((x) => x.invoice_draft_id.startsWith("inv-c-bot-2026-11")).every((x) => x.note === "")).toBe(true);
  });

  it("appen räknar som den gamla modellen: ofakturerade ärenden i oktober är ofakturerade, de fakturerade har sin status", async () => {
    const drafts = (await db.query<Record<string, unknown>>("select * from public.invoice_drafts")).rows.map((x) => fromDbRow<InvoiceDraft>(x));
    const lines = (await db.query<Record<string, unknown>>("select * from public.invoice_lines")).rows.map((x) => fromDbRow<InvoiceLine>(x));
    const runs = (await db.query<Record<string, unknown>>("select * from public.billing_runs")).rows.map((x) => fromDbRow<BillingRun>(x));
    const lookup = invoiceLookup({ invoice_drafts: drafts, invoice_lines: lines });
    const other = billableIn("2026-10").find((id) => id !== caseA.id && id !== caseB.id)!;
    const oct = (id: string) => {
      const c = data.cases.find((x) => x.id === id)!;
      const w = billableWeeks(c, data, env).find((x) => x.monthKey === "2026-10" && !x.paused)!;
      return lookup.statusOf(c, "2026-10", w.key);
    };
    expect([oct(caseA.id), oct(caseB.id), oct(other)]).toEqual(["fortnox_created", "manual", "draft"]);
    // Preskriptionsvarningen: oktobers ofakturerade veckor finns kvar (förut försvann de bakom en faktura utan rader).
    const cfg = requireOperational(data.contracts.find((c) => c.id === "c-bot")!.config);
    const old = unbilledOld({ ...data, invoice_drafts: drafts, invoice_lines: lines, billing_runs: runs }, { now: NOW, cfg });
    const octCases = new Set(old.filter((x) => x.week.monthKey === "2026-10").map((x) => x.case.id));
    expect(octCases.has(other)).toBe(true);
    expect(octCases.has(caseA.id) || octCases.has(caseB.id)).toBe(false);
  });

  it("krediteringen gäller fakturan som har ärendets rad; körningens standardstatus är borta", async () => {
    const c = await db.query<{ invoice_draft_id: string | null; case_id: string | null }>("select invoice_draft_id, case_id from public.invoice_credits where id = 'kredit-x'");
    expect(c.rows[0]).toEqual({ invoice_draft_id: "inv-c-bot-2026-12-avtal-tillagg-2", case_id: caseA.id });
    const cols = await db.query<{ c: string }>("select column_name as c from information_schema.columns where table_name = 'billing_runs'");
    expect(cols.rows.map((x) => x.c)).not.toContain("default_invoice_status");
  });

  it("efter migreringen: en periodisk faktura per avtal, månad och grupp, och raderna har en anmärkning", async () => {
    const dup = await db.query("select 1").then(async () => {
      try {
        await db.exec("insert into public.invoice_drafts (id, contract_id, month, kind, grouping_key, invoiced_object, status) values ('inv-x', 'c-bot', '2026-11', 'periodic', 'avtal', '332026110', 'draft')");
        return null;
      } catch (e) {
        return (e as { code?: string }).code ?? "fel";
      }
    });
    expect(dup).toBe("23505");
    const note = await db.query<{ d: string }>("select column_default as d from information_schema.columns where table_name = 'invoice_lines' and column_name = 'note'");
    expect(note.rows[0].d).toBe("''::text");
  });
});
