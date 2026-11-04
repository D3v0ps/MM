// Den manuella filen supabase/manual/2026-11-bonus-botkyrka.sql (Karims beslut 2026-11-04) på en databas från före beslutet:
// alla migrationer och testdatat, men utan bonusstegens prisrader och med det gamla avsnittet bonus i avtalet (av, modellen
// ej fastställd). Bevisar att filen lägger in de fem prisraderna och den fastställda modellen – samma som BOTKYRKA_CONFIG –,
// att revisionsloggen bara får koder och steg (inga belopp), att kommunens vy av avtalet saknar taket och att en andra körning
// inte ändrar något. Bara påhittade uppgifter.
// Kör: npx vitest run src/data/supabase/manual-bonus.test.ts
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { createMigratedDatabase, loadSeed } from "./pglite";

const FILE = `${process.cwd()}/supabase/manual/2026-11-bonus-botkyrka.sql`;
const OLD_BONUS = { enabled: false, model: "ATT_FASTSTÄLLA – Miljonbemannings incitamentsmodell", separateInvoice: true };

let db: PGlite;
type Snapshot = { prices: unknown[]; bonus: unknown; logs: unknown[] };
const snapshot = async (): Promise<Snapshot> => ({
  prices: (await db.query("select id, code, unit, area_code, price_ore::int as price_ore, vat_rate::int as vat_rate, valid_from::text, valid_to::text, fortnox_article_no, example_only from public.price_items where code like 'BOT-BONUS-%' order by code")).rows,
  bonus: (await db.query<{ bonus: unknown }>("select config->'bonus' as bonus from public.contracts where contract_number = '332026110'")).rows[0].bonus,
  logs: (await db.query("select id, action, entity, entity_id, contract_id, details from public.audit_log where id like 'log-bonus-2026-11-04-%' order by id")).rows,
});
let first: Snapshot;

beforeAll(async () => {
  db = await createMigratedDatabase();
  await loadSeed(db);
  // Före beslutet: inga prisrader för bonusstegen och bonus avstängd. (Testdatats anspråk och bonusfaktura rörs inte – filen
  // läser dem inte.)
  await db.exec(`
    delete from public.price_items where code like 'BOT-BONUS-%';
    update public.contracts set config = jsonb_set(config, '{bonus}', '${JSON.stringify(OLD_BONUS)}'::jsonb) where id = 'c-bot';
  `);
  await db.exec(readFileSync(FILE, "utf8"));
  first = await snapshot();
}, 120_000);

describe("supabase/manual/2026-11-bonus-botkyrka.sql", () => {
  it("lägger in fem prisrader för bonusstegen – enhet bonus_step, utan avtalsområde, artikel BOT-BONUS-n, 25 % moms", () => {
    expect(first.prices).toEqual([1, 2, 3, 4, 5].map((n) => ({
      id: `pi-bonus-${n}-c-bot`, code: `BOT-BONUS-${n}`, unit: "bonus_step", area_code: null, price_ore: [150000, 300000, 600000, 400000, 200000][n - 1],
      vat_rate: 25, valid_from: "2026-09-10", valid_to: "2027-09-09", fortnox_article_no: `BOT-BONUS-${n}`, example_only: false,
    })));
  });

  it("sätter avsnittet bonus till samma modell som BOTKYRKA_CONFIG", () => {
    expect(first.bonus).toEqual(JSON.parse(JSON.stringify(BOTKYRKA_CONFIG.bonus)));
  });

  it("revisionsloggen får en rad per prisrad och en för avtalet – utan belopp", () => {
    expect(first.logs).toHaveLength(6);
    expect(first.logs.map((l) => (l as { action: string }).action).sort()).toEqual(["contract.config_updated", ...Array(5).fill("price_item.created")]);
    expect(JSON.stringify(first.logs.map((l) => (l as { details: unknown }).details))).not.toMatch(/price|Ore|1200000|150000|300000|600000|400000|200000/);
  });

  it("kommunens version av avtalet (mm.customer_safe_config, vyn contracts_public) saknar taket", async () => {
    const r = await db.query<{ has: boolean; enabled: string }>("select (mm.customer_safe_config(config)->'bonus') ? 'capOre' as has, mm.customer_safe_config(config)->'bonus'->>'enabled' as enabled from public.contracts where id = 'c-bot'");
    expect(r.rows[0]).toEqual({ has: false, enabled: "true" });
  });

  it("en andra körning ändrar ingenting och skriver inget nytt i revisionsloggen", async () => {
    await db.exec(readFileSync(FILE, "utf8"));
    expect(await snapshot()).toEqual(first);
  });
});
