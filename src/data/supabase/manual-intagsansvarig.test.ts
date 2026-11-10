// Den manuella filen supabase/manual/2026-11-intagsansvarig-botkyrka.sql (Karims beslut 2026-11-09) på en databas med alla
// migrationer och testdatat, men utan intagsansvarig i Botkyrkaavtalet (läget i produktionen efter migration 0041). Bevisar att
// filen vägrar tills profilens id är ifyllt, vägrar en profil som saknas, är spärrad eller inte har rollen coach i avtalet,
// sätter avtalets intagsansvarige och skriver en rad i revisionsloggen med bara id:n – och att en andra körning inte ändrar
// något. Filen i repot har bara platshållaren, aldrig ett riktigt id. Bara påhittade uppgifter.
// Kör: npx vitest run src/data/supabase/manual-intagsansvarig.test.ts
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, loadSeed } from "./pglite";

const FILE = `${process.cwd()}/supabase/manual/2026-11-intagsansvarig-botkyrka.sql`;
const PLACEHOLDER = "ERSÄTT_MED_PROFILENS_ID";
const SQL = readFileSync(FILE, "utf8");
/** Kopian som körs: platshållaren på raden FYLL I HÄR bytt mot profilens id – inget annat ändras. */
const withProfile = (id: string) => SQL.replace(`:= '${PLACEHOLDER}';`, `:= '${id}';`);

let db: PGlite;
type Snapshot = { intake: string | null; logs: { action: string; actor_id: string; entity: string; entity_id: string; contract_id: string; details: Record<string, unknown> }[] };
const snapshot = async (): Promise<Snapshot> => ({
  intake: (await db.query<{ c: string | null }>("select intake_coach_id as c from public.contracts where contract_number = '332026110'")).rows[0].c,
  logs: (await db.query<Snapshot["logs"][number]>(
    "select action, actor_id, entity, entity_id, contract_id, details from public.audit_log where action = 'contract.intake_coach_changed' order by occurred_at, id",
  )).rows,
});
/** Kör filen; ett fel lämnar transaktionen öppen (begin … commit i filen) – den rullas tillbaka, som SQL Editor gör. */
async function run(sql: string): Promise<string | null> {
  try {
    await db.exec(sql);
    return null;
  } catch (e) {
    await db.exec("rollback");
    return (e as Error).message;
  }
}

beforeAll(async () => {
  db = await createMigratedDatabase();
  await loadSeed(db);
  // Läget i produktionen efter 0041: avtalet har ingen intagsansvarig (testdatat utser Amira).
  await db.exec("update public.contracts set intake_coach_id = null where id = 'c-bot'");
}, 120_000);

describe("supabase/manual/2026-11-intagsansvarig-botkyrka.sql", () => {
  it("filen i repot har bara platshållaren – en gång på raden FYLL I HÄR – och inget riktigt id", () => {
    expect(SQL.split(`:= '${PLACEHOLDER}';`)).toHaveLength(2);
    expect(SQL).toContain("FYLL I HÄR");
    expect(withProfile("u-amira")).not.toContain(`'${PLACEHOLDER}'`);
    // Inga testpersoner, inga uuid:n och inga e-postadresser i filen.
    expect(SQL).not.toMatch(/u-amira|u-erik|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|@/);
  });

  it("vägrar tills profilens id är ifyllt – ingenting ändras", async () => {
    expect(await run(SQL)).toMatch(/Fyll i profilens id/);
    expect(await run(withProfile(""))).toMatch(/Fyll i profilens id/);
    expect(await snapshot()).toEqual({ intake: null, logs: [] });
  });

  it("vägrar en profil som inte finns, som är spärrad eller som inte har rollen coach i avtalet", async () => {
    expect(await run(withProfile("u-finns-inte"))).toMatch(/Hittar ingen profil/);
    // Samordnaren, ekonomen och kommunens handläggare har ingen roll som coach i avtalet.
    for (const id of ["u-sara", "u-lars", "k-maria"]) expect(await run(withProfile(id)), id).toMatch(/rollen coach i avtalet/);
    await db.exec("update public.profiles set active = false where id = 'u-erik'");
    expect(await run(withProfile("u-erik"))).toMatch(/spärrad/);
    await db.exec("update public.profiles set active = true where id = 'u-erik'");
    expect(await snapshot()).toEqual({ intake: null, logs: [] });
  });

  it("sätter avtalets intagsansvarige och skriver en rad i revisionsloggen – bara id:n", async () => {
    expect(await run(withProfile("u-amira"))).toBeNull();
    const s = await snapshot();
    expect(s.intake).toBe("u-amira");
    expect(s.logs).toEqual([{
      action: "contract.intake_coach_changed", actor_id: "system", entity: "contract", entity_id: "c-bot", contract_id: "c-bot", details: { from: null, to: "u-amira", source: "manual" },
    }]);
    // Inga namn eller andra personuppgifter i loggen.
    expect(JSON.stringify(s.logs)).not.toMatch(/Amira|Haddad|@/);
  });

  it("en andra körning ändrar ingenting och skriver inget nytt i revisionsloggen", async () => {
    const first = await snapshot();
    expect(await run(withProfile("u-amira"))).toBeNull();
    expect(await snapshot()).toEqual(first);
    // Inställningarna för lås och tid gäller bara körningen (set local).
    expect((await db.query<{ a: string; b: string }>("select current_setting('lock_timeout') as a, current_setting('statement_timeout') as b")).rows[0]).toEqual({ a: "0", b: "0" });
  });

  it("ett byte till en annan coach loggas med den förra och den nya – och den nya tar emot, inte den förra", async () => {
    expect(await run(withProfile("u-erik"))).toBeNull();
    const s = await snapshot();
    expect(s.intake).toBe("u-erik");
    expect(s.logs.map((l) => l.details)).toEqual([{ from: null, to: "u-amira", source: "manual" }, { from: "u-amira", to: "u-erik", source: "manual" }]);
  });

  it("vägrar när migration 0041 inte är applicerad", async () => {
    // Kolumnen tas bort i en transaktion som rullas tillbaka (vyn, funktionen och triggern som läser den följer med).
    let message: string | null = null;
    try {
      await db.exec("begin; drop view public.contracts_public; drop function mm.visible_contracts(); alter table public.contracts drop column intake_coach_id cascade;");
      // Filens egen begin ger bara en varning i en öppen transaktion; do-blocket är det som prövas.
      await db.exec(withProfile("u-amira").replace(/^begin;$/m, "").replace(/^commit;$/m, ""));
    } catch (e) {
      message = (e as Error).message;
    }
    await db.exec("rollback");
    expect(message).toMatch(/Migration 0041 .* är inte applicerad/);
    expect((await snapshot()).intake).toBe("u-erik");
  });
});
