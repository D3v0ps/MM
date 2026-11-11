// Villkorade ändringar genom användarens repo (Table.updateIf) mot databasens kolumnrättigheter – i PGlite med alla migrationer
// och testdatat.
//
// Bakgrund (granskningen 2026-11-10): arenden.caseAccept och arenden.caseStart ändrar ärendet med ett villkor på statusen
// (update … where id = ? and status in (…)), så att två samtidiga svar inte båda går igenom. Postgres kräver läsrätt på varje
// kolumn i villkoret, och inloggade fick bara läsa cases.id direkt i tabellen (0013) – ändringen nekades med 42501 för alla
// roller. Minnesläget märkte ingenting. Migration 0041 ger läsrätten på cases.status.
//
// Testerna här:
//   1. kör den riktiga SupabaseRepo (userRepo) som en inloggad användare, med satserna som PostgREST skriver dem
//      (postgrestClient i pglite.ts) – de två villkorade ändringarna går för rätt roller och stoppas för fel roller, och utan
//      rättigheten från 0041 nekas de för alla (testet hade fångat felet);
//   2. håller listan USER_FILTER_COLUMNS (src/data/schema.ts) lika med databasens kolumnrättigheter – samma lista som
//      minneslägets körning och SupabaseRepo använder för att stoppa ett villkor på en kolumn som inte får läsas. En ny
//      villkorad ändring på en annan kolumn stoppas därför redan i hanterarens enhetstest.
// Kör: npx vitest run src/data/supabase/villkorade-andringar.test.ts
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUserIdFor } from "../../../scripts/db/seed-sql";
import { snakeCase } from "../../../scripts/db/columns";
import { PolicyError } from "../memory";
import { FilterColumnError } from "../repo";
import { TABLE_NAMES, USER_FILTER_COLUMNS, type AppRepo, type Case } from "../schema";
import { appRepo, userRepo } from "./index";
import { asUser, createMigratedDatabase, loadSeed, postgrestClient, type Tx } from "./pglite";

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDatabase();
  await loadSeed(db);
  await db.exec("set timezone to 'Europe/Stockholm'");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

/** Kör fn med användarens repo (ctx.repo i produktionen): rollen authenticated, RLS, vyerna och kolumnrättigheterna gäller. */
const asRepo = <T,>(userId: string, fn: (repo: AppRepo, tx: Tx) => Promise<T>, before?: (tx: Tx) => Promise<void>) =>
  asUser(db, authUserIdFor(userId), (tx) => fn(userRepo(postgrestClient(tx)), tx), before ? { before } : {});
type Outcome = "ändrad" | "ingen rad" | "nekad";
/** Utfallet av en villkorad ändring: raden ändrad, ingen rad matchade (eller fick ändras), eller nekad av databasen (42501). */
const outcome = (p: Promise<unknown>): Promise<Outcome> =>
  p.then((r) => (r ? "ändrad" : "ingen rad"), (e) => {
    if (e instanceof PolicyError) return "nekad" as const;
    throw e;
  });

const NOW = "2027-02-01T09:12";
/** BOT-27-0050 (Marias mejlavrop) väntar på svar. Ändringen som arenden.caseAccept skriver – samma fält och samma villkor. */
const PENDING = "case-270050";
const ACCEPT_WHERE = { status: { in: ["received", "acknowledged"] } } as const;
const ACCEPT_PATCH: Partial<Case> = {
  buyerReference: "4410023817", leadCoachId: "u-amira", status: "confirmed", confirmedAt: NOW, plannedStart: "2027-02-08", firstMeetingAt: "2027-02-08T10:00",
  primaryAreaCode: "J", secondaryAreaCode: "H", vocationalTrack: "Butikssäljare", orderPeriodMonths: 6, orderPeriodReason: null, plannedEnd: "2027-08-07", plannedWeeks: 26,
  orderValueWeeks: 26,
};
/** BOT-27-0042 (huvudcoach Mats, handläggare Ahmed) är bekräftat. Ändringen som arenden.caseStart skriver när deltagaren kom tidigare. */
const CONFIRMED = "case-270042";
const START_WHERE = { status: "confirmed" } as const;
const START_PATCH: Partial<Case> = {
  status: "active", startDate: "2027-02-01", meetingDay: 0, meetingTime: "14:00", phase: 1, phaseSince: "2027-02-01", firstMeetingAt: "2027-02-01T14:00", plannedStart: "2027-02-01",
  plannedEnd: "2027-03-12", plannedWeeks: 6, orderValueWeeks: 6,
};
const accept = (repo: AppRepo) => repo.table("cases").updateIf(PENDING, ACCEPT_WHERE, ACCEPT_PATCH);
const start = (repo: AppRepo) => repo.table("cases").updateIf(CONFIRMED, START_WHERE, START_PATCH);

describe("ta emot en beställning: den villkorade ändringen som SupabaseRepo skickar (0041)", () => {
  it("testdatat: beställningen väntar på svar och Amira är avtalets intagsansvarige", async () => {
    const r = await db.query<{ status: string; intake: string | null }>(
      "select c.status, k.intake_coach_id as intake from public.cases c join public.contracts k on k.id = c.contract_id where c.id = $1", [PENDING]);
    expect(r.rows).toEqual([{ status: "acknowledged", intake: "u-amira" }]);
  });

  it("samordnaren, avtalsansvarig och den intagsansvarige: raden ändras och läses tillbaka via vyn – ett andra försök träffar ingen rad", async () => {
    for (const userId of ["u-sara", "u-johan", "u-amira"]) {
      const got = await asRepo(userId, async (repo) => ({ first: await accept(repo), second: await outcome(accept(repo)) }));
      expect(got.first, userId).toMatchObject({ id: PENDING, status: "confirmed", leadCoachId: "u-amira", firstMeetingAt: "2027-02-08T10:00", plannedEnd: "2027-08-07", confirmedAt: NOW });
      // Kontroll och skrivning i ett steg: beställningen är redan besvarad, så samma ändring en gång till ändrar ingenting.
      expect(got.second, userId).toBe("ingen rad");
    }
  });

  it("allt arenden.caseAccept skriver som den intagsansvarige går genom användarens repo: ärendet, teamet, statushistoriken och orderbekräftelsen", async () => {
    // Samma anrop som hanteraren gör mot ctx.repo, i samma ordning. Avropsmejlet och notiserna skriver servern (ctx.system).
    const template = (await asUser(db, null, (tx) => appRepo(postgrestClient(tx)).table("reports").get("rep-16614"), { role: "service_role" }))!;
    const got = await asRepo("u-amira", async (repo) => {
      const c = await accept(repo);
      const team = repo.table("case_team");
      for (const t of await team.list({ caseId: PENDING })) await team.remove(t.id);
      await team.insert({ id: `${PENDING}:u-amira`, caseId: PENDING, userId: "u-amira", role: "lead_coach" });
      await repo.table("case_status_history").insert({
        id: "csh-t-0050", caseId: PENDING, fromStatus: "acknowledged", toStatus: "confirmed", fromCoach: null, toCoach: "u-amira", reason: "Avrop accepterat", customerNotifiedAt: null,
        changedBy: "u-amira", changedAt: NOW,
      });
      await repo.table("reports").insert({
        ...template, id: "rep-t-0050", caseId: PENDING, version: 1, previousId: null, periodStart: "2027-02-01", periodEnd: "2027-02-01", status: "delivered", dueAt: "2027-02-02T08:41",
        approvedBy: "u-amira", approvedAt: NOW, deliveredAt: NOW, deliveredTo: ["k-maria"], snapshot: null, superseded: false, supersededAt: null, supersededBy: null,
      });
      return {
        status: c?.status, team: (await team.list({ caseId: PENDING })).map((t) => [t.userId, t.role]), history: (await repo.table("case_status_history").get("csh-t-0050"))?.toStatus,
        report: (await repo.table("reports").get("rep-t-0050"))?.status,
        // Avropsinkorgens mejl läser coachen aldrig – bokföringen gör servern.
        emails: await repo.table("inbound_emails").count(),
      };
    });
    expect(got).toEqual({ status: "confirmed", team: [["u-amira", "lead_coach"]], history: "confirmed", report: "delivered", emails: 0 });
  });

  it("en coach som inte är intagsansvarig stoppas av databasen (cases_accept_guard, 42501) – och kommunen, ekonomen, chefen och admin tar aldrig emot", async () => {
    for (const userId of ["u-erik", "u-mats"]) expect(await asRepo(userId, (repo) => outcome(accept(repo))), userId).toBe("nekad");
    // Nekad av spärren eller av policyn, eller så syns raden inte alls – aldrig ändrad.
    for (const userId of ["k-maria", "k-ahmed", "u-lars", "u-karin", "u-robin"]) expect(await asRepo(userId, (repo) => outcome(accept(repo))), userId).not.toBe("ändrad");
    // Ingenting ändrades.
    expect((await db.query<{ status: string }>("select status from public.cases where id = $1", [PENDING])).rows[0].status).toBe("acknowledged");
  });

  it("utan läsrätten på cases.status (läget före 0041) nekas ändringen med 42501 för alla – också för samordnaren", async () => {
    const before = async (tx: Tx) => {
      await tx.exec("revoke select (status) on public.cases from authenticated");
    };
    for (const userId of ["u-sara", "u-johan", "u-amira"]) {
      expect(await asRepo(userId, (repo) => outcome(accept(repo)), before), `${userId} ta emot`).toBe("nekad");
      expect(await asRepo(userId, (repo) => outcome(start(repo)), before), `${userId} starta`).toBe("nekad");
    }
    // En vanlig ändring (bara id i villkoret) gick redan före 0041.
    expect(await asRepo("u-sara", (repo) => outcome(repo.table("cases").update(PENDING, { location: "Miljonbemanning Alby" })), before)).toBe("ändrad");
  });
});

describe("avtalets intagsansvarige: ändringen som admin.setIntakeCoach skickar", () => {
  it("systemadministratören byter och tar bort – raden läses tillbaka via vyn; ingen annan ändrar, och en som inte är coach nekas (23514)", async () => {
    const set = (to: string | null) => (repo: AppRepo) => repo.table("contracts").update("c-bot", { intakeCoachId: to });
    expect(await asRepo("u-robin", set("u-erik"))).toMatchObject({ id: "c-bot", intakeCoachId: "u-erik" });
    expect(await asRepo("u-robin", set(null))).toMatchObject({ id: "c-bot", intakeCoachId: null });
    for (const userId of ["u-sara", "u-johan", "u-amira", "k-maria"]) expect(await asRepo(userId, (repo) => outcome(set("u-erik")(repo))), userId).toBe("nekad");
    // Samordnaren har inte rollen coach: databasens kontroll svarar 23514 – ett datafel, inte ett behörighetsfel.
    await expect(asRepo("u-robin", set("u-sara"))).rejects.toMatchObject({ name: "DataError", code: "23514" });
    // Kommunen läser avtalet via vyn utan kolumnen.
    expect(await asRepo("k-maria", (repo) => repo.table("contracts").get("c-bot"))).toMatchObject({ id: "c-bot", intakeCoachId: null });
    expect(await asRepo("u-erik", (repo) => repo.table("contracts").get("c-bot"))).toMatchObject({ id: "c-bot", intakeCoachId: "u-amira" });
  });
});

describe("starta insatsen: den villkorade ändringen som SupabaseRepo skickar", () => {
  it("coachen (huvudcoach eller en annan coach), samordnaren och avtalsansvarig: ärendet pågår med startdatumet och det flyttade mötet", async () => {
    for (const userId of ["u-mats", "u-amira", "u-sara", "u-johan"]) {
      const got = await asRepo(userId, async (repo) => ({ first: await start(repo), second: await outcome(start(repo)) }));
      expect(got.first, userId).toMatchObject({ id: CONFIRMED, status: "active", startDate: "2027-02-01", firstMeetingAt: "2027-02-01T14:00", plannedEnd: "2027-03-12" });
      expect(got.second, userId).toBe("ingen rad");
    }
  });

  it("kommunen, ekonomen, chefen och admin startar aldrig insatsen", async () => {
    for (const userId of ["k-ahmed", "k-maria", "u-lars", "u-karin", "u-robin"]) expect(await asRepo(userId, (repo) => outcome(start(repo))), userId).not.toBe("ändrad");
    expect((await db.query<{ status: string }>("select status from public.cases where id = $1", [CONFIRMED])).rows[0].status).toBe("confirmed");
  });
});

describe("bonusanspråken: samma väg – rättigheten fanns redan (0039)", () => {
  it("coachen ändrar ett förslag med villkoret status = suggested", async () => {
    const CLAIM = "bonus-case-260002-1-1";
    const got = await asRepo("u-amira", (repo) => repo.table("bonus_claims").updateIf(CLAIM, { status: "suggested" }, { basis: "Påhittad kommentar" }));
    expect(got).toMatchObject({ id: CLAIM, status: "suggested", basis: "Påhittad kommentar" });
  });
});

describe("ändra tid för ett tillfälle: den villkorade ändringen som arenden.activityMove skickar (Karims beslut 2026-11-11)", () => {
  /** Nadias nästa egna tillfälle (inte en gruppaktivitet), läst som användaren – och flytten med villkoret på tid, längd och plats. */
  const moveNext = (repo: AppRepo) => async () => {
    const acts = repo.table("activities");
    const a = (await acts.list({ caseId: "case-260143", groupActivityId: { isNull: true }, startsAt: { gt: NOW } }, { orderBy: "startsAt" }))[0];
    if (!a) return { first: null, second: "ingen rad" as Outcome };
    const go = () => acts.updateIf(a.id, { startsAt: a.startsAt, durationMin: a.durationMin, location: a.location }, { startsAt: "2027-02-05T13:30", durationMin: 60, location: a.location });
    return { first: await go(), second: await outcome(go()) };
  };

  it("huvudcoachen, en annan coach, samordnaren och avtalsansvarig: raden flyttas (RLS activities_update) – ett andra försök med den gamla tiden träffar ingen rad", async () => {
    for (const userId of ["u-amira", "u-erik", "u-sara", "u-johan"]) {
      const got = await asRepo(userId, (repo) => moveNext(repo)());
      expect(got.first, userId).toMatchObject({ caseId: "case-260143", startsAt: "2027-02-05T13:30", durationMin: 60 });
      expect(got.second, userId).toBe("ingen rad");
    }
  });

  it("kommunen, ekonomen, chefen och admin flyttar aldrig ett tillfälle", async () => {
    for (const userId of ["k-maria", "k-ahmed", "u-lars", "u-karin", "u-robin"]) {
      const got = await asRepo(userId, (repo) => moveNext(repo)().catch((e: unknown) => (e instanceof PolicyError ? { first: null, second: "nekad" as Outcome } : Promise.reject(e))));
      expect(got.first, userId).toBeNull();
    }
  });

  it("villkoret läser bara kolumner som inloggade får läsa: activities har ingen gräns i USER_FILTER_COLUMNS", () => {
    expect(USER_FILTER_COLUMNS.activities).toBeUndefined();
  });
});

describe("kolumnerna som en villkorad ändring får villkoras på", () => {
  it("USER_FILTER_COLUMNS är exakt databasens kolumnrättigheter: tabellerna där inloggade inte läser alla kolumner, och kolumnerna de får läsa", async () => {
    const tableLevel = new Set((await db.query<{ t: string }>(
      "select table_name as t from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'",
    )).rows.map((r) => r.t));
    const columnLevel = new Map<string, string[]>();
    for (const r of (await db.query<{ t: string; c: string }>(
      "select table_name as t, column_name as c from information_schema.column_privileges where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'",
    )).rows) columnLevel.set(r.t, [...(columnLevel.get(r.t) ?? []), r.c]);
    // Tabeller med läsrätt på vissa kolumner men inte på hela tabellen.
    const restricted = TABLE_NAMES.filter((t) => !tableLevel.has(t) && (columnLevel.get(t)?.length ?? 0) > 0);
    expect([...restricted].sort()).toEqual(Object.keys(USER_FILTER_COLUMNS).sort());
    for (const t of restricted) {
      const declared = ["id", ...(USER_FILTER_COLUMNS[t] as readonly string[]).map(snakeCase)].sort();
      expect([...(columnLevel.get(t) ?? [])].sort(), t).toEqual(declared);
    }
    // 0041: statusen, utöver id från 0013.
    expect(USER_FILTER_COLUMNS.cases).toEqual(["status"]);
  });

  it("ett villkor på en annan kolumn stoppas av SupabaseRepo innan något skickas – och hade nekats av databasen", async () => {
    const got = await asRepo("u-sara", async (repo, tx) => ({
      repo: await repo.table("cases").updateIf(PENDING, { leadCoachId: null } as never, { location: "Alby" }).then(() => "skickad", (e) => (e instanceof FilterColumnError ? e.column : "annat fel")),
      // Samma sats direkt mot databasen: läsrätten saknas på kolumnen i villkoret.
      sql: await tx.query(`update public.cases set location = 'Alby' where id = '${PENDING}' and lead_coach_id is null`).then(() => "ok", (e: { code?: string }) => e.code),
    }));
    expect(got).toEqual({ repo: "leadCoachId", sql: "42501" });
  });

  it("service role (ctx.system) har inga sådana gränser", async () => {
    const got = await asUser(db, null, (tx) => appRepo(postgrestClient(tx)).table("cases").updateIf(PENDING, { leadCoachId: null } as never, { location: "Alby" }), { role: "service_role" });
    expect(got).toMatchObject({ id: PENDING, location: "Alby" });
  });
});
