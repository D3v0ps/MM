// Migrationen 0026 (kommunen har bara rollen handläggare, beslut 2026-10-07) på data som fanns före beslutet:
// chefsmedlemskap, en testare som agerar som kommunens chef, beställarrapporter per mottagare och en sparad rapport delad
// med kommunen. Kör migrationerna före 0026, läser in testdatat, lägger till de gamla raderna och kör sedan 0026 (och
// eventuella senare migrationer) – samma ordning som i driften. Bara påhittade uppgifter.
// Kör: npx vitest run src/data/supabase/migration-0026.test.ts
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { COLUMNS, quoteIdent, snakeCase, type SqlType } from "../../../scripts/db/columns";
import { seedData, sqlLiteral } from "../../../scripts/db/seed-sql";
import type { TableName } from "../schema";
import { asUser, loadSeedForExistingTables, migrationFiles, SUPABASE_STUB_SQL } from "./pglite";
import { authUserIdFor } from "./seed-rows";

const data = seedData();
const MIGRATION = "0026_kommunen_bara_handlaggare.sql";
const TESTER_AUTH = "bbbbbbbb-0000-4000-8000-000000000026";
const CHEF2_AUTH = "cccccccc-0000-4000-8000-000000000026";

/** INSERT av en rad med kolumnerna i schema.ts (som i rls-parity.test.ts). */
function insertSql(t: TableName, row: Record<string, unknown>): string {
  const cols = Object.entries(COLUMNS[t] as Record<string, SqlType>);
  return `insert into public.${t} (${cols.map(([f]) => quoteIdent(snakeCase(f))).join(", ")}) values (${cols.map(([f, type]) => sqlLiteral(row[f], type)).join(", ")})`;
}

let db: PGlite;
let failure: string | null = null;

beforeAll(async () => {
  const files = migrationFiles();
  const at = files.findIndex((f) => f.endsWith(MIGRATION));
  db = new PGlite();
  await db.waitReady;
  await db.exec(SUPABASE_STUB_SQL);
  for (const f of files.slice(0, at)) await db.exec(readFileSync(f, "utf8"));
  // Seeden tömmer också tabeller från senare migrationer (role_choices, 0027) – bara de som finns här. Grupperna (0031)
  // behövs inte i testet och läses inte in.
  await loadSeedForExistingTables(db, undefined, { later: ["groupings", "grouping_members"] });

  // Raderna som fanns före beslutet.
  const maria = data.profiles.find((p) => p.id === "k-maria")!;
  const delivered = data.reports.find((r) => r.kind === "customer_summary" && r.status === "delivered")!;
  const month = { month: "2099-01", periodStart: "2099-01-01", periodEnd: "2099-01-31", dueAt: "2099-02-10T16:00" };
  const mb = data.saved_reports.find((r) => r.visibility === "mb")!;
  const rows: [TableName, Record<string, unknown>][] = [
    ["profiles", { ...maria, id: "k-x-chef", fullName: "Testchef Ett", email: "chef.ett@example.invalid", buyerReferenceId: null, lastLoginAt: null }],
    ["profiles", { ...maria, id: "k-x-chef2", fullName: "Testchef Två", email: "chef.tva@example.invalid", buyerReferenceId: null, lastLoginAt: null }],
    // En chef utan annat medlemskap och Maria som (påhittat) också var chef i samma avtal.
    ["memberships", { id: "ms-x-chef", userId: "k-x-chef", contractId: "c-bot", role: "kommun_chef", customerUnit: "Arbetsmarknadsenheten" }],
    ["memberships", { id: "ms-x-maria-chef", userId: "k-maria", contractId: "c-bot", role: "kommun_chef", customerUnit: "Arbetsmarknadsenheten Alby" }],
    // Två beställarrapporter samma månad, en per chef: ett utkast och en levererad.
    ["reports", { ...delivered, ...month, id: "rep-x-utkast", recipientUserId: "k-x-chef", status: "draft", approvedBy: null, approvedAt: null, deliveredAt: null, deliveredTo: [] }],
    ["reports", { ...delivered, ...month, id: "rep-x-levererad", recipientUserId: "k-x-chef2", deliveredTo: ["k-x-chef2"], approvedAt: "2099-02-08T10:00", deliveredAt: "2099-02-08T10:05" }],
    // En sparad rapport som avtalsansvarig delade med kommunen.
    ["saved_reports", { ...mb, id: "sr-x-kommun", visibility: "customer", sharedBy: "u-johan", sharedAt: "2027-01-20T10:00" }],
  ];
  for (const [t, row] of rows) await db.exec(insertSql(t, row));
  await db.query("insert into auth.users (id, email) values ($1, 'testare.0026@example.invalid')", [TESTER_AUTH]);
  // Den tidigare chefen som fick beställarrapporten levererad loggar in (efter 0026 som handläggare).
  await db.query("insert into auth.users (id, email) values ($1, 'chef.tva@example.invalid')", [CHEF2_AUTH]);
  await db.query("update public.profiles set auth_user_id = $1 where id = 'k-x-chef2'", [CHEF2_AUTH]);
  await db.exec(insertSql("memberships", { id: "ms-x-chef2", userId: "k-x-chef2", contractId: "c-bot", role: "kommun_chef", customerUnit: "Arbetsmarknadsenheten" }));
  // Ett bonusanspråk med belopp i Marias ärende (fas 3, påhittat).
  const mariaCase = data.cases.find((c) => c.referrerId === "k-maria" && c.status === "active")!;
  await db.exec(insertSql("bonus_claims", {
    id: "bc-x-1", caseId: mariaCase.id, kind: "work", basis: "Påhittat underlag", evidencePaths: [], submittedAt: null, customerDecision: null, decidedBy: null,
    decidedAt: null, amountOre: 500000, invoiceDraftId: null,
  }));
  await db.query("insert into public.tester_sessions (auth_user_id, profile_id, role) values ($1, 'k-x-chef', 'kommun_chef')", [TESTER_AUTH]);

  try {
    for (const f of files.slice(at)) await db.exec(readFileSync(f, "utf8"));
  } catch (e) {
    failure = (e as Error).message;
  }
}, 120_000);

describe("migrationen 0026 på data från före beslutet", () => {
  it("går igenom", () => {
    expect(failure).toBeNull();
  });

  it("chefsmedlemskapen blir handläggarmedlemskap – en dubblett tas bort, och testaren agerar som handläggare", async () => {
    const ms = (await db.query<{ id: string; user_id: string; role: string }>("select id, user_id, role from public.memberships where user_id in ('k-x-chef', 'k-maria') order by id")).rows;
    expect(ms.some((m) => m.id === "ms-x-maria-chef")).toBe(false);
    expect(ms.find((m) => m.id === "ms-x-chef")?.role).toBe("kommun_handlaggare");
    expect(ms.filter((m) => m.user_id === "k-maria").map((m) => m.role)).toEqual(["kommun_handlaggare"]);
    const chefs = (await db.query<{ n: number }>("select count(*)::int as n from public.memberships where role = 'kommun_chef'")).rows[0].n;
    expect(chefs).toBe(0);
    const ts = (await db.query<{ role: string }>("select role from public.tester_sessions where auth_user_id = $1", [TESTER_AUTH])).rows[0];
    expect(ts.role).toBe("kommun_handlaggare");
  });

  it("kontrollen stoppar nya chefsmedlemskap", async () => {
    await expect(db.query("insert into public.memberships (id, user_id, contract_id, role, customer_unit) values ('ms-x-ny', 'k-x-chef2', 'c-bot', 'kommun_chef', null)")).rejects.toThrow();
    const roles = (await db.query<{ r: string[] }>("select mm.customer_roles() as r")).rows[0].r;
    expect(roles).toEqual(["kommun_handlaggare"]);
  });

  it("beställarrapporten: en per avtal och månad, utan mottagare – den levererade behålls och utkastet markeras som ersatt", async () => {
    const r = (await db.query<{ id: string; recipient_user_id: string | null; superseded: boolean; superseded_by: string | null; previous_id: string | null }>(
      "select id, recipient_user_id, superseded, superseded_by, previous_id from public.reports where kind = 'customer_summary' and month in ('2099-01') order by id",
    )).rows;
    expect(r).toEqual([
      { id: "rep-x-levererad", recipient_user_id: null, superseded: false, superseded_by: null, previous_id: null },
      { id: "rep-x-utkast", recipient_user_id: null, superseded: true, superseded_by: "rep-x-levererad", previous_id: "rep-x-levererad" },
    ]);
    // Testdatats beställarrapporter (redan utan mottagare) är orörda.
    const seedRows = (await db.query<{ n: number; recipients: number; superseded: number }>(
      "select count(*)::int as n, count(recipient_user_id)::int as recipients, count(*) filter (where superseded)::int as superseded from public.reports where kind = 'customer_summary' and month <> '2099-01'",
    )).rows[0];
    expect(seedRows).toEqual({ n: data.reports.filter((x) => x.kind === "customer_summary").length, recipients: 0, superseded: 0 });
    // Det nya unika indexet: en till för samma avtal och månad stoppas.
    const dup = data.reports.find((x) => x.kind === "customer_summary")!;
    await expect(db.exec(insertSql("reports", { ...dup, id: "rep-x-dubblett" } as unknown as Record<string, unknown>))).rejects.toThrow(/reports_customer_summary_key/);
  });

  it("sparade rapporter delade med kommunen blir delade inom Miljonbemanning, och kontrollen stoppar 'customer'", async () => {
    const sr = (await db.query<{ visibility: string; shared_by: string }>("select visibility, shared_by from public.saved_reports where id = 'sr-x-kommun'")).rows[0];
    expect(sr).toEqual({ visibility: "mb", shared_by: "u-johan" });
    await expect(db.query("update public.saved_reports set visibility = 'customer' where id = 'sr-x-kommun'")).rejects.toThrow(/saved_reports_visibility_check/);
  });

  it("den tidigare chefen läser inte den levererade beställarrapporten, fast hens id står kvar i delivered_to", async () => {
    const rows = await asUser(db, CHEF2_AUTH, async (tx) => (await tx.query<{ id: string }>("select id from public.reports where kind in ('customer_summary', 'statistics')")).rows);
    expect(rows).toEqual([]);
    const kept = (await db.query<{ delivered_to: string[] }>("select delivered_to from public.reports where id = 'rep-x-levererad'")).rows[0];
    expect(kept.delivered_to).toEqual(["k-x-chef2"]);
    // Kvittensen går inte heller att skriva.
    const upd = await asUser(db, CHEF2_AUTH, async (tx) => (await tx.query("update public.reports set opened_at = now(), opened_by = 'k-x-chef2' where id = 'rep-x-levererad' returning id")).rows.length);
    expect(upd).toBe(0);
  });

  it("kommunen läser inga belopp: avtalets viten är tomma och bonusanspråken syns inte", async () => {
    const maria = authUserIdFor("k-maria");
    const got = await asUser(db, maria, async (tx) => ({
      penalties: (await tx.query<{ p: unknown }>("select config -> 'penalties' as p from public.contracts_public")).rows[0]?.p,
      bonus: (await tx.query<{ n: number }>("select count(*)::int as n from public.bonus_claims")).rows[0].n,
    }));
    expect(got).toEqual({ penalties: {}, bonus: 0 });
    // Miljonbemanning läser hela avtalet (ekonomen ser bonusanspråket i sitt avtal).
    const mb = await asUser(db, authUserIdFor("u-karin"), async (tx) => (await tx.query<{ p: unknown }>("select config -> 'penalties' as p from public.contracts_public")).rows[0]?.p);
    expect(mb).toEqual({ deviationOre: 2500000, insufficientInformationOre: 2500000 });
    const lars = await asUser(db, authUserIdFor("u-lars"), async (tx) => (await tx.query<{ n: number }>("select count(*)::int as n from public.bonus_claims where id = 'bc-x-1'")).rows[0].n);
    expect(lars).toBe(1);
  });

  it("synligheten unit: enheten tas bara från medlemskapet – aldrig från profilen som handläggaren skriver själv", async () => {
    const unit = (await db.query<{ customer_unit: string }>("select customer_unit from public.memberships where user_id = 'k-maria' and role = 'kommun_handlaggare'")).rows[0].customer_unit;
    await db.query("insert into auth.users (id, email) values ('dddddddd-0000-4000-8000-000000000026', 'ny.person@botkyrka.se')");
    await db.query(`insert into public.profiles (id, organization_id, full_name, email, phone, title, active, customer_unit, invited_by, auth_user_id)
      values ('k-x-self', 'org-botkyrka', 'Ny Person', 'ny.person@botkyrka.se', '', 'Handläggare', true, null, 'self', 'dddddddd-0000-4000-8000-000000000026')`);
    await db.query("insert into public.memberships (id, user_id, contract_id, role, customer_unit) values ('k-x-self:c-bot', 'k-x-self', 'c-bot', 'kommun_handlaggare', null)");
    await db.query(`update public.contracts set config = jsonb_set(config, '{customerVisibility,scope}', '"unit"') where id = 'c-bot'`);
    try {
      const self = await asUser(db, "dddddddd-0000-4000-8000-000000000026", async (tx) => {
        await tx.query("update public.profiles set customer_unit = $1 where id = 'k-x-self'", [unit]);
        return {
          unit: (await tx.query<{ u: string | null }>("select mm.current_unit() as u")).rows[0].u,
          cases: (await tx.query<{ n: number }>("select count(*)::int as n from public.cases_public")).rows[0].n,
        };
      });
      expect(self).toEqual({ unit: null, cases: 0 });
      const maria = await asUser(db, authUserIdFor("k-maria"), async (tx) => ({
        unit: (await tx.query<{ u: string | null }>("select mm.current_unit() as u")).rows[0].u,
        cases: (await tx.query<{ n: number }>("select count(*)::int as n from public.cases_public")).rows[0].n,
      }));
      expect(maria.unit).toBe(unit);
      expect(maria.cases).toBeGreaterThan(0);
    } finally {
      await db.query(`update public.contracts set config = jsonb_set(config, '{customerVisibility,scope}', '"ATT_FASTSTÄLLA (own | unit | all)"') where id = 'c-bot'`);
    }
  });
});
