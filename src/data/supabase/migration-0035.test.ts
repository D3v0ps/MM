// Migrationen 0035 (yrkesområden och nivåer, Karims beslut 2026-10-22) på data från före beslutet: aktiva fria grupper och
// aktiva medlemskap i dem. Kör migrationerna före 0035, läser in testdatat, lägger till de gamla raderna och kör sedan 0035 (och
// eventuella senare migrationer) – samma ordning som i driften. Bevisar att triggrarna från 0031 släpper igenom migrationens
// arkivering (den körs som postgres), att inget raderas och att en andra körning inte ändrar något. Bara påhittade uppgifter.
// Kör: npx vitest run src/data/supabase/migration-0035.test.ts
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { seedData } from "../../../scripts/db/seed-sql";
import { asUser, attempt, loadSeedForExistingTables, migrationFiles, SUPABASE_STUB_SQL } from "./pglite";

const data = seedData();
const MIGRATION = "0035_yrkesomraden_nivaer.sql";
const AT = "2026-10-01T10:00";
/** Två pågående ärenden i Botkyrka (påhittade). */
const [C1, C2] = data.cases.filter((c) => c.contractId === "c-bot" && c.status === "active").map((c) => c.id);

let db: PGlite;
let failure: string | null = null;
type Counts = { activeLevels: number; activeTags: number; groupings: number; members: number };
let before: Counts;

const counts = async (): Promise<Counts> => {
  const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;
  return {
    activeLevels: await n("select count(*)::int as n from public.grouping_members where kind = 'level' and removed_at is null"),
    activeTags: await n("select count(*)::int as n from public.grouping_members where kind = 'tag' and removed_at is null"),
    groupings: await n("select count(*)::int as n from public.groupings"),
    members: await n("select count(*)::int as n from public.grouping_members"),
  };
};

beforeAll(async () => {
  const files = migrationFiles();
  const at = files.findIndex((f) => f.endsWith(MIGRATION));
  db = new PGlite();
  await db.waitReady;
  await db.exec(SUPABASE_STUB_SQL);
  for (const f of files.slice(0, at)) await db.exec(readFileSync(f, "utf8"));
  // De återkommande aktiviteterna (0035) och bytena av yrkesområde (0036) finns inte ännu – deras rader läses inte in
  // (tillfällenas series_id tas bort med kolumnen).
  await loadSeedForExistingTables(db, undefined, { later: ["group_activity_series", "case_area_changes"] });
  // Före beslutet: två aktiva fria grupper med aktiva medlemskap, och ett medlemskap som redan var borttaget.
  await db.exec(`
    insert into public.groupings (id, contract_id, kind, category, name, description, sort_order, created_at, created_by, updated_at, updated_by, archived_at, archived_by) values
      ('grp-x-tisdag', 'c-bot', 'group', null, 'Tisdagsgruppen', '', 7, '${AT}', 'u-sara', null, null, null, null),
      ('grp-x-truck', 'c-bot', 'group', null, 'Truckgruppen', '', 8, '${AT}', 'u-amira', null, null, null, null);
    insert into public.grouping_members (id, contract_id, case_id, grouping_id, kind, slot, added_at, added_by, removed_at, removed_by) values
      ('gm-x-1', 'c-bot', '${C1}', 'grp-x-tisdag', 'group', null, '${AT}', 'u-sara', null, null),
      ('gm-x-2', 'c-bot', '${C2}', 'grp-x-tisdag', 'group', null, '${AT}', 'u-sara', null, null),
      ('gm-x-3', 'c-bot', '${C1}', 'grp-x-truck', 'group', null, '${AT}', 'u-amira', null, null),
      ('gm-x-4', 'c-bot', '${C2}', 'grp-x-truck', 'group', null, '${AT}', 'u-amira', '2026-10-05T10:00', 'u-amira');
  `);
  before = await counts();
  try {
    for (const f of files.slice(at)) await db.exec(readFileSync(f, "utf8"));
  } catch (e) {
    failure = (e as Error).message;
  }
}, 120_000);

describe("migrationen 0035 på fria grupper från före beslutet", () => {
  it("går igenom – triggrarna från 0031 släpper igenom arkiveringen (migrationen körs som postgres)", () => {
    expect(failure).toBeNull();
  });

  it("alla aktiva grupper arkiveras och alla aktiva medlemskap i grupper avslutas av systemet – inget raderas", async () => {
    const groups = (await db.query<{ id: string; archived_by: string | null; archived: boolean }>(
      "select id, archived_by, archived_at is not null as archived from public.groupings where kind = 'group' order by id",
    )).rows;
    expect(groups.every((g) => g.archived)).toBe(true);
    expect(groups.filter((g) => g.id.startsWith("grp-x-")).map((g) => [g.id, g.archived_by])).toEqual([["grp-x-tisdag", "system"], ["grp-x-truck", "system"]]);
    const members = (await db.query<{ id: string; removed_by: string | null }>("select id, removed_by from public.grouping_members where id like 'gm-x-%' order by id")).rows;
    // gm-x-4 var redan borttaget – det ändras inte.
    expect(members).toEqual([
      { id: "gm-x-1", removed_by: "system" }, { id: "gm-x-2", removed_by: "system" }, { id: "gm-x-3", removed_by: "system" }, { id: "gm-x-4", removed_by: "u-amira" },
    ]);
    const after = await counts();
    // Nivåerna och taggarna rörs inte; inga rader försvinner.
    expect(after).toEqual(before);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.grouping_members where kind = 'group' and removed_at is null")).rows[0].n).toBe(0);
  });

  it("befintliga gruppaktiviteter får målgruppen manual och befintliga tillfällen källan manual", async () => {
    const audiences = (await db.query<{ audience: string; n: number }>("select audience, count(*)::int as n from public.group_activities group by audience")).rows;
    expect(audiences.map((r) => r.audience)).toEqual(["manual"]);
    const sources = (await db.query<{ invite_source: string }>("select distinct invite_source from public.activities")).rows.map((r) => r.invite_source);
    expect(sources).toEqual(["manual"]);
  });

  it("efter migrationen nekas en ny aktiv grupp och ett återupplivat medlemskap i en grupp – också för servern", async () => {
    const service = <T>(fn: Parameters<typeof asUser<T>>[2]) => asUser(db, null, fn, { role: "service_role" });
    expect(await service((tx) => attempt(tx, `insert into public.groupings (id, contract_id, kind, category, name, description, sort_order, created_at, created_by, updated_at, updated_by, archived_at, archived_by)
      values ('grp-x-ny', 'c-bot', 'group', null, 'Ny grupp', '', 9, '${AT}', 'u-sara', null, null, null, null)`))).toMatchObject({ ok: false, code: "23514" });
    expect(await service((tx) => attempt(tx, "update public.groupings set archived_at = null, archived_by = null where id = 'grp-x-tisdag'"))).toMatchObject({ ok: false, code: "23514" });
    expect(await service((tx) => attempt(tx, "update public.grouping_members set removed_at = null, removed_by = null where id = 'gm-x-1'"))).toMatchObject({ ok: false, code: "23514" });
  });

  it("en andra körning (SQL Editor) ändrar ingenting", async () => {
    const snap = async () => (await db.query<{ x: string }>(
      "select string_agg(id || ':' || coalesce(removed_at::text, '-') || ':' || coalesce(removed_by, '-'), ',' order by id) as x from public.grouping_members",
    )).rows[0].x + (await db.query<{ x: string }>("select string_agg(id || ':' || coalesce(archived_at::text, '-'), ',' order by id) as x from public.groupings")).rows[0].x;
    const first = await snap();
    await db.exec(readFileSync(migrationFiles().find((f) => f.endsWith(MIGRATION))!, "utf8"));
    expect(await snap()).toBe(first);
  });
});
