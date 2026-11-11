// Seriens tid för ett tillfälle (migration 0042, granskningen 2026-11-11) mot databasen – i PGlite med alla migrationer och testdatat.
//   1. group_activities.series_slot finns, är ifylld för seriens tillfällen (testdatat) och 0042 tål att köras igen – en rad utan
//      seriens tid fylls i från en tidigare flytt i revisionsloggen, annars från tillfällets tid.
//   2. Unikt (series_id, series_slot): servern kan inte skapa ett andra tillfälle på seriens tid – också när det första har flyttats.
//      Seriens tid bara med en serie (checken).
//   3. Inloggade ändrar aldrig seriens tid (kolumnskyddet) – samma beslut som src/data/policy.ts (GROUP_FIXED) i minnesläget. En vanlig
//      ändring av tillfället går som förut, för samma person i båda lägena.
// Kör: npx vitest run src/data/supabase/series-slot.test.ts
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { authUserIdFor } from "../../../scripts/db/seed-sql";
import { PolicyError } from "../memory";
import type { GroupActivity } from "../schema";
import { userRepo } from "./index";
import { asUser, attempt, createMigratedDatabase, loadSeed, MIGRATIONS_DIR, postgrestClient } from "./pglite";

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDatabase();
  await loadSeed(db);
  await db.exec("set timezone to 'Europe/Stockholm'");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const OCC = "ga-ser-c-bot-niva-1-2027-02-09";
const SERIES = "ser-c-bot-niva-1";
const asService = <T,>(fn: Parameters<typeof asUser<T>>[2]) => asUser(db, null, fn, { role: "service_role" });

describe("0042 group_activities.series_slot", () => {
  it("testdatats tillfällen har seriens tid = tiden de skapades på; aktiviteter utan serie har ingen", async () => {
    const r = await db.query<{ with_series: number; missing: number; differs: number; without_series_slot: number }>(
      `select count(*) filter (where series_id is not null)::int as with_series,
              count(*) filter (where series_id is not null and series_slot is null)::int as missing,
              count(*) filter (where series_id is not null and series_slot <> starts_at)::int as differs,
              count(*) filter (where series_id is null and series_slot is not null)::int as without_series_slot
         from public.group_activities`,
    );
    expect(r.rows[0].with_series).toBeGreaterThan(5);
    expect(r.rows[0]).toMatchObject({ missing: 0, differs: 0, without_series_slot: 0 });
  });

  it("0042 igen: en rad utan seriens tid fylls i från en tidigare flytt i loggen (Stockholms tid), annars från tiden nu", async () => {
    await db.exec("begin");
    try {
      await db.query("update public.group_activities set series_slot = null, starts_at = '2027-02-11 10:00' where id = $1", [OCC]);
      await db.query(
        `insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details)
         values ('log-probe-slot', now(), 'u-amira', 'group_activity_series.occurrence_moved', 'group_activity_series', $1, 'c-bot',
                 jsonb_build_object('groupActivityId', $2::text, 'seriesSlot', '2027-02-09T13:30', 'from', '2027-02-09T13:30', 'to', '2027-02-11T10:00'))`,
        [SERIES, OCC],
      );
      await db.query("update public.group_activities set series_slot = null where id = 'ga-ser-c-bot-niva-1-2027-02-11'");
      await db.exec(readFileSync(`${MIGRATIONS_DIR}/0042_sms_for_hand.sql`, "utf8"));
      const r = await db.query<{ id: string; slot: string }>(
        "select id, to_char(series_slot at time zone 'Europe/Stockholm', 'YYYY-MM-DD\"T\"HH24:MI') as slot from public.group_activities where id in ($1, 'ga-ser-c-bot-niva-1-2027-02-11') order by id",
        [OCC],
      );
      expect(r.rows).toEqual([{ id: OCC, slot: "2027-02-09T13:30" }, { id: "ga-ser-c-bot-niva-1-2027-02-11", slot: "2027-02-11T13:30" }]);
    } finally {
      await db.exec("rollback");
    }
  });

  it("unikt per serie och seriens tid, och seriens tid bara med en serie", async () => {
    const got = await asService(async (tx) => {
      const base = "insert into public.group_activities (id, contract_id, name, kind, starts_at, duration_min, location, created_by, created_at, audience, audience_level_id, series_id, series_slot, notify) ";
      const dup = await attempt(tx, `${base} select 'ga-probe-dup', contract_id, name, kind, starts_at + interval '1 day', duration_min, location, created_by, created_at, audience, audience_level_id, series_id, series_slot, notify from public.group_activities where id = $1`, [OCC]);
      const noSeries = await attempt(tx, `${base} select 'ga-probe-noseries', contract_id, name, kind, starts_at + interval '2 days', duration_min, location, created_by, created_at, 'manual', null, null, series_slot, notify from public.group_activities where id = $1`, [OCC]);
      return { dup: dup.ok ? "ok" : dup.code, noSeries: noSeries.ok ? "ok" : noSeries.code };
    });
    expect(got).toEqual({ dup: "23505", noSeries: "23514" });
  });

  it("en inloggad ändrar aldrig seriens tid – samma beslut i databasen och i policy.ts; en vanlig ändring går i båda", async () => {
    const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
    const actor = (userId: string, role: string): Actor => listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role)!.actor;
    const memory = async (a: Actor, patch: Partial<GroupActivity>) =>
      rt.ctxFor(a).repo.table("group_activities").update(OCC, patch).then(() => "ok", (e) => (e instanceof PolicyError ? "nekad" : String(e)));
    const database = async (userId: string, patch: Partial<GroupActivity>) =>
      asUser(db, authUserIdFor(userId), async (tx) => userRepo(postgrestClient(tx)).table("group_activities").update(OCC, patch).then(() => "ok", (e) => (e instanceof PolicyError ? "nekad" : String(e))));
    const stamp = { updatedAt: "2027-02-01T09:12", updatedBy: "u-amira" };
    const slot = { ...stamp, seriesSlot: "2027-02-10T13:30" };
    const place = { ...stamp, location: "Miljonbemanning Tumba" };
    const amira = actor("u-amira", "coach");
    expect({ db: await database("u-amira", slot), mem: await memory(amira, slot) }).toEqual({ db: "nekad", mem: "nekad" });
    expect({ db: await database("u-amira", place), mem: await memory(amira, place) }).toEqual({ db: "ok", mem: "ok" });
    const maria = actor("k-maria", "kommun_handlaggare");
    expect({ db: await database("k-maria", { ...place, updatedBy: "k-maria" }), mem: await memory(maria, { ...place, updatedBy: "k-maria" }) }).toEqual({ db: "nekad", mem: "nekad" });
  });
});
