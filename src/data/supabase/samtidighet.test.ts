// Migration 0022 i PGlite: en närvarorad per tillfälle (unik nyckel, 23505) och radversionen på utkasten (default 1,
// villkorad uppdatering på versionen). Kör: npx vitest run src/data/supabase/samtidighet.test.ts
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, attempt, createMigratedDatabase, loadSeed, type Tx } from "./pglite";

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDatabase();
  await loadSeed(db);
}, 120_000);
afterAll(async () => {
  await db?.close();
});
const asService = <T,>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn, { role: "service_role" });

describe("0022 samtidighet", () => {
  it("en andra närvarorad för samma tillfälle stoppas (23505) – den första står kvar", async () => {
    await asService(async (tx) => {
      const row = (await tx.query<{ id: string; activity_id: string; case_id: string }>("select id, activity_id, case_id from public.attendance limit 1")).rows[0];
      const dup = await attempt(tx, "insert into public.attendance (id, activity_id, case_id, status, reason, registered_by, registered_at) values ($1, $2, $3, 'present', '', 'u-amira', now())", ["at-dubblett", row.activity_id, row.case_id]);
      expect(dup).toMatchObject({ ok: false, code: "23505" });
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.attendance where activity_id = $1", [row.activity_id])).rows[0].n).toBe(1);
      // Inga dubbletter i testdatat (kontrollen migrationen beskriver).
      expect((await tx.query("select activity_id from public.attendance group by activity_id having count(*) > 1")).rows).toHaveLength(0);
      // Det gamla indexet är borta, nyckeln finns.
      const idx = (await tx.query<{ indexname: string }>("select indexname from pg_indexes where tablename = 'attendance'")).rows.map((r) => r.indexname);
      expect(idx).toContain("attendance_activity_id_key");
      expect(idx).not.toContain("attendance_activity_id_idx");
    });
  });

  it("version 1 på testdatat, och en uppdatering på versionen träffar bara en gång", async () => {
    await asService(async (tx) => {
      for (const t of ["check_ins", "monthly_assessments", "intake_assessments"]) {
        const r = await tx.query<{ n: number; other: number }>(`select count(*)::int as n, count(*) filter (where version <> 1)::int as other from public.${t}`);
        expect(r.rows[0].n).toBeGreaterThan(0);
        expect(r.rows[0].other).toBe(0);
      }
      const ci = (await tx.query<{ id: string }>("select id from public.check_ins limit 1")).rows[0];
      expect(await attempt(tx, "update public.check_ins set version = 2, note = 'x' where id = $1 and version = 1", [ci.id], { keep: true })).toEqual({ ok: true, rows: 1 });
      expect(await attempt(tx, "update public.check_ins set version = 2, note = 'y' where id = $1 and version = 1", [ci.id])).toEqual({ ok: true, rows: 0 });
      // null stoppas av not null (hanteraren sätter alltid ett tal).
      expect(await attempt(tx, "update public.check_ins set version = null where id = $1", [ci.id])).toMatchObject({ ok: false, code: "23502" });
    });
  });
});
