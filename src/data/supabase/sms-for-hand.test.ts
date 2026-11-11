// SMS att skicka (Karims beslut 2026-11-11, migration 0042) mot databasen – i PGlite med alla migrationer och testdatat.
//   1. 0042 lägger till outbound_messages.sent_by (text, null) och tål att köras igen.
//   2. Markera som skickat skriver raden med servern (service role, appRepo – som hanteraren via ctx.system): kanalen sms, status
//      sent_manually och vem (sent_by). Samma id en gång till stoppas av primärnyckeln (UniqueError) – två samtidiga tryck ger en rad.
//   3. Behörigheten är oförändrad och lika med src/data/policy.ts (outbound_messages: läses av systemadministratören och
//      samordnaren, skrivs aldrig av en inloggad): coachen, kommunen och ekonomen läser inte raden och ingen inloggad skriver den.
// Kör: npx vitest run src/data/supabase/sms-for-hand.test.ts
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUserIdFor } from "../../../scripts/db/seed-sql";
import { PolicyError, UniqueError } from "../memory";
import type { OutboundMessage } from "../schema";
import { appRepo, userRepo } from "./index";
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

const ROW: OutboundMessage = {
  id: "out-hand-vecka-case-260143-2027-W05", createdAt: "2027-02-01T09:12", channel: "sms", to: "deltagare (SMS)", template: "veckoschema", subject: null,
  body: "Hej! Dina tider hos Miljonbemanning den här veckan: mån 1 feb kl. 10.00, Miljonbemanning Alby. Frågor? Ring 08-400 22 750.",
  caseId: "case-260143", status: "sent_manually", sentAt: "2027-02-01T09:12", statusReason: null, providerMessageId: null, sentBy: "u-erik",
};
const asService = <T,>(fn: Parameters<typeof asUser<T>>[2]) => asUser(db, null, fn, { role: "service_role" });

describe("0042 outbound_messages.sent_by", () => {
  it("kolumnen finns, är text och får vara tom – och filen tål att köras igen", async () => {
    const col = await db.query<{ data_type: string; is_nullable: string }>(
      "select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'outbound_messages' and column_name = 'sent_by'",
    );
    expect(col.rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);
    await db.exec(readFileSync(`${MIGRATIONS_DIR}/0042_sms_for_hand.sql`, "utf8"));
    const again = await db.query("select count(*)::int as n from information_schema.columns where table_name = 'outbound_messages' and column_name = 'sent_by'");
    expect(again.rows).toEqual([{ n: 1 }]);
  });
});

describe("Markera som skickat: raden i utskicksloggen", () => {
  it("servern skriver raden med vem och när; samma id igen stoppas (två samtidiga tryck ger en rad); samordnaren läser den", async () => {
    const got = await asService(async (tx) => {
      const repo = appRepo(postgrestClient(tx));
      await repo.table("outbound_messages").insert(ROW);
      const twice = await repo.table("outbound_messages").insert({ ...ROW, sentBy: "u-amira" }).then(() => "inlagd", (e) => (e instanceof UniqueError ? "dubblett" : String(e)));
      const back = await repo.table("outbound_messages").get(ROW.id);
      return { twice, back, n: (await tx.query<{ n: number }>("select count(*)::int as n from public.outbound_messages where id = $1", [ROW.id])).rows[0].n };
    });
    expect(got.twice).toBe("dubblett");
    expect(got.n).toBe(1);
    expect(got.back).toEqual(ROW);
  });

  it("behörigheten (som policy.ts): samordnaren och systemadministratören läser – coachen, kommunen och ekonomen inte; ingen inloggad skriver", async () => {
    // Raden läggs in som postgres i samma transaktion (rullas tillbaka) och läses som den inloggade.
    const readAs = async (userId: string) =>
      asUser(db, authUserIdFor(userId), async (tx) => (await userRepo(postgrestClient(tx)).table("outbound_messages").list({ id: `${ROW.id}-las` })).map((r) => r.sentBy), {
        before: async (tx) => {
          await tx.query(
            "insert into public.outbound_messages (id, created_at, channel, \"to\", template, subject, body, case_id, status, sent_at, sent_by) values ($1, $2, 'sms', $3, 'veckoschema', null, $4, $5, 'sent_manually', $2, $6)",
            [`${ROW.id}-las`, "2027-02-01T09:12", ROW.to, ROW.body, ROW.caseId, ROW.sentBy],
          );
        },
      });
    expect(await readAs("u-sara")).toEqual(["u-erik"]);
    expect(await readAs("u-robin")).toEqual(["u-erik"]);
    for (const userId of ["u-erik", "u-amira", "k-maria", "u-lars"]) expect(await readAs(userId), userId).toEqual([]);
    // Ingen inloggad skriver i utskicksloggen – inte heller coachen som markerar (servern skriver raden).
    for (const userId of ["u-erik", "u-sara", "k-maria", "u-lars"]) {
      const denied = await asUser(db, authUserIdFor(userId), async (tx) => {
        const viaRepo = await userRepo(postgrestClient(tx)).table("outbound_messages").insert({ ...ROW, id: `${ROW.id}-${userId}` }).then(() => "inlagd", (e) => (e instanceof PolicyError ? "nekad" : String(e)));
        const viaSql = await attempt(tx, "update public.outbound_messages set sent_by = $1 where channel = 'sms'", [userId]);
        return { viaRepo, viaSql: viaSql.ok ? viaSql.rows : viaSql.code };
      });
      expect(denied.viaRepo, userId).toBe("nekad");
      expect([0, "42501"], userId).toContain(denied.viaSql);
    }
  });
});
