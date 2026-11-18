// Den manuella filen supabase/manual/2026-11-delmal-botkyrka.sql (Karims beslut 2026-11-11) på en databas från före filen: alla
// migrationer och testdatat, men utan delmål (katalogen och lägena tömda, inga delmål på tillfällena) och utan tröskeln i
// avtalskonfigurationen. Bevisar att filen lägger in startlistan – samma nummer, id, områden, namn, ordning och punkter som
// DEFAULT_PROGRESS_GOALS – och tröskeln (samma som BOTKYRKA_CONFIG), att revisionsloggen bara får id:n och antal (inga namn), att
// filen vägrar utan 0043 och att en andra körning inte ändrar något. Bara påhittade uppgifter.
// Kör: npx vitest run src/data/supabase/manual-delmal.test.ts
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { DEFAULT_PROGRESS_GOALS, defaultProgressGoals } from "@/core/progress-goals";
import { createMigratedDatabase, loadSeed, migrationFiles, SUPABASE_STUB_SQL } from "./pglite";

const FILE = `${process.cwd()}/supabase/manual/2026-11-delmal-botkyrka.sql`;

let db: PGlite;
type Snapshot = { goals: unknown[]; stepItemMin: unknown; logs: unknown[] };
const snapshot = async (): Promise<Snapshot> => ({
  goals: (await db.query("select id, contract_id, area_key, label, sort_order, active, step_items, created_by from public.progress_goals order by id")).rows,
  stepItemMin: (await db.query<{ v: unknown }>("select config->'bonus'->'stepItemMin' as v from public.contracts where contract_number = '332026110'")).rows[0].v,
  logs: (await db.query("select id, action, entity, entity_id, contract_id, details from public.audit_log where id like 'log-delmal-2026-11-11-%' order by id")).rows,
});
let first: Snapshot;

beforeAll(async () => {
  db = await createMigratedDatabase();
  await loadSeed(db);
  // Före filen: inga delmål och ingen tröskel (det som 0043 ger ett befintligt avtal).
  await db.exec(`
    delete from public.activity_progress_goals;
    update public.group_activities set progress_goal_ids = '{}';
    update public.group_activity_series set progress_goal_ids = '{}';
    delete from public.case_progress_goals;
    delete from public.progress_goals;
    update public.contracts set config = config #- '{bonus,stepItemMin}' where id = 'c-bot';
  `);
  await db.exec(readFileSync(FILE, "utf8"));
  first = await snapshot();
}, 120_000);

describe("supabase/manual/2026-11-delmal-botkyrka.sql", () => {
  it("lägger in startlistan – samma id, områden, namn, ordning och punkter som DEFAULT_PROGRESS_GOALS", () => {
    expect(DEFAULT_PROGRESS_GOALS).toHaveLength(25);
    const expected = defaultProgressGoals("c-bot", "2026-11-11T18:00").map((g) => ({
      id: g.id, contract_id: g.contractId, area_key: g.areaKey, label: g.label, sort_order: g.sortOrder, active: true, step_items: g.stepItems, created_by: "system",
    })).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(first.goals).toEqual(expected);
  });

  it("sätter tröskeln för punkterna i steg 1–2 till samma som BOTKYRKA_CONFIG", () => {
    expect(first.stepItemMin).toEqual(BOTKYRKA_CONFIG.bonus?.stepItemMin);
  });

  it("revisionsloggen får en rad för startlistan och en för avtalet – bara id:n och antal, inga namn", () => {
    expect(first.logs.map((l) => (l as { action: string }).action).sort()).toEqual(["contract.config_updated", "progress_goal.catalog_seeded"]);
    const details = JSON.stringify(first.logs.map((l) => (l as { details: unknown }).details));
    expect(details).toContain('"count":25');
    for (const g of DEFAULT_PROGRESS_GOALS) expect(details).not.toContain(g.label);
  });

  it("en andra körning ändrar ingenting och skriver inget nytt i revisionsloggen – också när ett delmål bytt namn i appen", async () => {
    await db.exec("update public.progress_goals set label = 'Kommer i tid fyra veckor i rad' where id = 'pg-c-bot-01'");
    const renamed = await snapshot();
    await db.exec(readFileSync(FILE, "utf8"));
    expect(await snapshot()).toEqual(renamed);
  });

  it("startlistans namn krockar inte med det unika namnet i området (progress_goals_label_key) – en dubblett stoppas med 23505", async () => {
    expect(new Set(DEFAULT_PROGRESS_GOALS.map((g) => `${g.areaKey}|${g.label.trim().toLowerCase()}`)).size).toBe(25);
    const err = await db.exec(`insert into public.progress_goals (id, contract_id, area_key, label, sort_order, active, step_items, created_by, created_at)
      values ('pg-t-dubblett', 'c-bot', 'narvaro_rutiner', '  meddelar frånvaro INNAN tillfället ', 99, true, '{}', 'system', now())`).then(() => null, (e: { code?: string }) => e.code);
    expect(err).toBe("23505");
    // Samma namn i ett annat område går bra.
    await db.exec(`insert into public.progress_goals (id, contract_id, area_key, label, sort_order, active, step_items, created_by, created_at)
      values ('pg-t-annat-omrade', 'c-bot', 'ovrigt', 'Meddelar frånvaro innan tillfället', 99, true, '{}', 'system', now())`);
    await db.exec("delete from public.progress_goals where id = 'pg-t-annat-omrade'");
  });

  it("ett delmål med samma namn i området som lagts till i appen före filen: startlistans hoppas över – filen stoppar inte, och en andra körning ändrar ingenting", async () => {
    const other = await createMigratedDatabase();
    await loadSeed(other);
    await other.exec(`
      delete from public.activity_progress_goals;
      update public.group_activities set progress_goal_ids = '{}';
      update public.group_activity_series set progress_goal_ids = '{}';
      delete from public.case_progress_goals;
      delete from public.progress_goals;
      insert into public.progress_goals (id, contract_id, area_key, label, sort_order, active, step_items, created_by, created_at)
        values ('pg-app-1', 'c-bot', 'narvaro_rutiner', 'kommer i tid tre veckor i rad ', 10, true, '{}', 'u-johan', now());
    `);
    const state = async () => ({
      goals: (await other.query<{ id: string }>("select id from public.progress_goals where contract_id = 'c-bot' order by id")).rows.map((r) => r.id),
      logs: (await other.query<{ action: string; details: unknown }>("select action, details from public.audit_log where id like 'log-delmal-2026-11-11-%' order by action")).rows,
    });
    await other.exec(readFileSync(FILE, "utf8"));
    const once = await state();
    expect(once.goals).toHaveLength(25);
    expect(once.goals).toContain("pg-app-1");
    expect(once.goals).not.toContain("pg-c-bot-01");
    expect(once.logs.find((l) => l.action === "progress_goal.catalog_seeded")?.details).toMatchObject({ count: 24 });
    await other.exec(readFileSync(FILE, "utf8"));
    expect(await state()).toEqual(once);
    await other.close();
  }, 120_000);

  it("vägrar utan migration 0043", async () => {
    const fresh = new PGlite();
    await fresh.waitReady;
    await fresh.exec(SUPABASE_STUB_SQL);
    for (const f of migrationFiles().filter((x) => !x.endsWith("0043_delmal.sql"))) await fresh.exec(readFileSync(f, "utf8"));
    await expect(fresh.exec(readFileSync(FILE, "utf8"))).rejects.toThrow(/0043/);
    await fresh.close();
  }, 120_000);
});
