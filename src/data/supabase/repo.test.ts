// SupabaseRepo mot en fejkad query builder: filteröversättning, namnbyten, tidsomvandling, sidor, fel.
// Dessutom: filtren ger samma rader som matches() i MemoryRepo (en liten tolk kör de inspelade PostgREST-filtren).
import { describe, expect, it } from "vitest";
import { MemoryRepo, MemoryStore, PolicyError } from "../memory";
import { matches, type Where } from "../repo";
import { createSeed } from "../seed";
import { TABLE_NAMES } from "../schema";
import { fromTimestamptz, toColumn, toDbRow, toField, toTimestamptz } from "./columns";
import { appRepo, userRepo } from "./index";
import { DataError, IN_CHUNK, PAGE_SIZE, SupabaseRepo, type PgClient, type PgResult } from "./repo";

type Rows = Record<string, unknown>[];
type Call = { table: string; op: "select" | "insert" | "update" | "delete"; args: unknown[]; chain: unknown[][] };

/** Fejkad supabase-js: spelar in anropen och svarar med respond(call). */
function fake(respond: (c: Call) => PgResult = () => ({ data: [], error: null })) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const mk = (op: Call["op"], args: unknown[]) => {
        const call: Call = { table, op, args, chain: [] };
        calls.push(call);
        const b: Record<string, unknown> = {};
        for (const m of ["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "not", "or", "order", "range", "select"]) {
          b[m] = (...a: unknown[]) => {
            call.chain.push([m, ...a]);
            return b;
          };
        }
        b.maybeSingle = () => {
          call.chain.push(["maybeSingle"]);
          return Promise.resolve(respond(call));
        };
        b.then = (res: (v: PgResult) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(res, rej);
        return b;
      };
      return { select: (...a: unknown[]) => mk("select", a), insert: (...a: unknown[]) => mk("insert", a), update: (...a: unknown[]) => mk("update", a), delete: () => mk("delete", []) };
    },
  };
  return { client: client as unknown as PgClient, calls };
}

type T = { id: string; caseNumber: string; status: string | null; phase: number | null; createdAt: string | null; closedAt: string | null; active: boolean };
const repoOf = (client: PgClient) => new SupabaseRepo<{ cases: T }>(client).table("cases");
const filters = (c: Call) => c.chain.filter((x) => !["order", "range", "select", "maybeSingle"].includes(x[0] as string));

// ---------------------------------------------------------------- Namn
describe("namnbyten", () => {
  it("fält -> kolumn och tillbaka", () => {
    expect(toColumn("caseNumber")).toBe("case_number");
    expect(toColumn("followUpOn")).toBe("follow_up_on");
    expect(toColumn("lastLoginAt")).toBe("last_login_at");
    expect(toColumn("personnummerLast4")).toBe("personnummer_last4");
    expect(toColumn("goal1")).toBe("goal1");
    expect(toColumn("id")).toBe("id");
    expect(toField("case_number")).toBe("caseNumber");
    expect(toField("personnummer_last4")).toBe("personnummerLast4");
    expect(toField("goal_1")).toBe("goal1");
    expect(toField("auth_user_id")).toBe("authUserId");
  });

  it("alla fält i testdatat går fram och tillbaka utan förlust", () => {
    const seed = createSeed() as unknown as Record<string, Rows>;
    let n = 0;
    for (const t of TABLE_NAMES) {
      for (const row of seed[t] ?? []) {
        for (const k of Object.keys(row)) {
          expect(toField(toColumn(k)), `${t}.${k}`).toBe(k);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it("bara översta nivån byter namn – jsonb lämnas orört", () => {
    const row = toDbRow({ caseNumber: "BOT-26-0001", config: { casePrefix: "BOT", nested: { someKey: 1 } }, tags: ["aB"], skip: undefined });
    expect(row).toEqual({ case_number: "BOT-26-0001", config: { casePrefix: "BOT", nested: { someKey: 1 } }, tags: ["aB"] });
  });
});

// ---------------------------------------------------------------- Tid
describe("tidsomvandling", () => {
  it("timestamptz -> LocalDateTime i Stockholm", () => {
    expect(fromTimestamptz("2027-02-01T09:12:00+01:00")).toBe("2027-02-01T09:12");
    expect(fromTimestamptz("2027-02-01T08:12:00Z")).toBe("2027-02-01T09:12");
    expect(fromTimestamptz("2027-02-01T08:12:00.123456+00:00")).toBe("2027-02-01T09:12");
    expect(fromTimestamptz("2027-02-01 09:12:33.123456+01")).toBe("2027-02-01T09:12");
    expect(fromTimestamptz("2027-07-01T09:12:00+02:00")).toBe("2027-07-01T09:12");
    expect(fromTimestamptz("2027-07-01T07:12:00Z")).toBe("2027-07-01T09:12");
  });

  it("LocalDateTime -> timestamptz med vinter- och sommartid", () => {
    expect(toTimestamptz("2027-02-01T09:12")).toBe("2027-02-01T09:12:00+01:00");
    expect(toTimestamptz("2027-07-01T09:12")).toBe("2027-07-01T09:12:00+02:00");
    expect(toTimestamptz("2027-03-28T01:59")).toBe("2027-03-28T01:59:00+01:00");
    expect(toTimestamptz("2027-03-28T03:00")).toBe("2027-03-28T03:00:00+02:00");
    // Timmen som inte finns (sommartid börjar 02.00 -> 03.00) tolkas som vintertid.
    expect(toTimestamptz("2027-03-28T02:30")).toBe("2027-03-28T02:30:00+01:00");
  });

  it("läsning gör om tider på översta nivån men inte i jsonb, datum lämnas som de är", async () => {
    const { client } = fake(() => ({
      data: [{ id: "c1", case_number: "BOT-26-0001", created_at: "2027-02-01T09:12:00+01:00", starts_on: "2027-02-01", details: { at: "2027-02-01T09:12:00+01:00", someKey: 1 }, phase: 3, active: true, closed_at: null }],
      error: null,
    }));
    const rows = await repoOf(client).list();
    expect(rows).toEqual([{ id: "c1", caseNumber: "BOT-26-0001", createdAt: "2027-02-01T09:12", startsOn: "2027-02-01", details: { at: "2027-02-01T09:12:00+01:00", someKey: 1 }, phase: 3, active: true, closedAt: null }]);
  });
});

// ---------------------------------------------------------------- Filter
describe("filteröversättning", () => {
  it("Where -> PostgREST-filter", async () => {
    const { client, calls } = fake();
    await repoOf(client).list(
      {
        status: "active",
        caseNumber: { in: ["BOT-26-0001", "BOT-26-0002"] },
        closedAt: { isNull: true },
        createdAt: { gte: "2027-01-01", lte: "2027-01-31T23:59" },
        phase: { neq: 5 },
        active: true,
      },
      { orderBy: "createdAt", desc: true },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("select");
    expect(calls[0].args).toEqual(["*"]);
    expect(calls[0].chain).toEqual([
      ["eq", "status", "active"],
      ["in", "case_number", ["BOT-26-0001", "BOT-26-0002"]],
      ["is", "closed_at", null],
      ["gte", "created_at", "2027-01-01"],
      ["lte", "created_at", "2027-01-31T23:59:00+01:00"],
      ["or", "phase.neq.5,phase.is.null"],
      ["eq", "active", true],
      ["order", "created_at", { ascending: false, nullsFirst: false }],
      ["order", "id", { ascending: true, nullsFirst: false }],
      ["range", 0, PAGE_SIZE - 1],
    ]);
  });

  it("null, isNull:false, neq null, in med null, tomt intervall och citering", async () => {
    const { client, calls } = fake();
    await repoOf(client).list({ status: null, closedAt: { isNull: false }, createdAt: {}, phase: { neq: null } } as Where<T>);
    expect(filters(calls[0])).toEqual([
      ["is", "status", null],
      ["not", "closed_at", "is", null],
      ["not", "created_at", "is", null],
      ["not", "phase", "is", null],
    ]);
    await repoOf(client).list({ status: { in: ["a,b", null] }, caseNumber: { neq: 'x"y' } });
    expect(filters(calls[1])).toEqual([
      ["or", 'status.in.("a,b"),status.is.null'],
      ["or", 'case_number.neq."x\\"y",case_number.is.null'],
    ]);
    await repoOf(client).list({ status: { in: [null] } });
    expect(filters(calls[2])).toEqual([["is", "status", null]]);
  });

  it("tom in-lista skickar ingen fråga", async () => {
    const { client, calls } = fake();
    expect(await repoOf(client).list({ status: { in: [] } })).toEqual([]);
    expect(await repoOf(client).count({ status: { in: [] } })).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("lång in-lista delas upp och resultatet sorteras som i minnet", async () => {
    const ids = Array.from({ length: IN_CHUNK * 2 + 50 }, (_, i) => `c${String(i).padStart(4, "0")}`);
    const { client, calls } = fake((c) => {
      const vs = (c.chain.find((x) => x[0] === "in")?.[2] ?? []) as string[];
      if (c.args[1]) return { data: null, error: null, count: vs.length };
      return { data: vs.map((id, i) => ({ id, phase: i % 3 })), error: null };
    });
    const rows = await repoOf(client).list({ id: { in: ids } } as Where<T>, { orderBy: "phase" });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => (c.chain.find((x) => x[0] === "in")?.[2] as string[]).length)).toEqual([IN_CHUNK, IN_CHUNK, 50]);
    expect(rows).toHaveLength(ids.length);
    expect(rows.map((r) => r.phase)).toEqual([...rows.map((r) => r.phase)].sort());
    expect(await repoOf(client).count({ id: { in: ids } } as Where<T>)).toBe(ids.length);
  });

  it("listor hämtas i sidor; limit och first begränsar", async () => {
    const { client, calls } = fake((c) => {
      const [, from, to] = c.chain.find((x) => x[0] === "range") as [string, number, number];
      const total = PAGE_SIZE + 5;
      const n = Math.max(0, Math.min(to, total - 1) - from + 1);
      return { data: Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` })), error: null };
    });
    expect(await repoOf(client).list()).toHaveLength(PAGE_SIZE + 5);
    expect(calls.map((c) => c.chain.find((x) => x[0] === "range"))).toEqual([["range", 0, PAGE_SIZE - 1], ["range", PAGE_SIZE, 2 * PAGE_SIZE - 1]]);
    calls.length = 0;
    expect(await repoOf(client).list(undefined, { limit: 3 })).toHaveLength(3);
    expect(calls[0].chain.at(-1)).toEqual(["range", 0, 2]);
    calls.length = 0;
    expect((await repoOf(client).first({ status: "x" }))?.id).toBe("r0");
    expect(calls[0].chain.at(-1)).toEqual(["range", 0, 0]);
  });

  it("pick läser bara de angivna kolumnerna (och id och sorteringskolumnen) – även när in-listan delas upp", async () => {
    const { client, calls } = fake(() => ({ data: [{ id: "c1", case_number: "BOT-26-0001", created_at: "2027-02-01T09:12:00+01:00" }], error: null }));
    const rows = await repoOf(client).pick(["caseNumber"], { status: "active" }, { orderBy: "createdAt" });
    expect(calls[0].args[0]).toBe("id,case_number,created_at");
    expect(rows).toEqual([{ id: "c1", caseNumber: "BOT-26-0001", createdAt: "2027-02-01T09:12" }]);
    calls.length = 0;
    const ids = Array.from({ length: IN_CHUNK + 1 }, (_, i) => `c${i}`);
    await repoOf(client).pick(["status", "phase"], { id: { in: ids } } as Where<T>);
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.args[0]).toBe("id,status,phase");
    // list läser fortfarande hela raden
    calls.length = 0;
    await repoOf(client).list();
    expect(calls[0].args[0]).toBe("*");
  });

  it("pickJson läser kolumnerna och jsonb-sökvägarna med alias (facts:snapshot->facts) – samma form som MemoryRepo", async () => {
    type R = { id: string; kind: string; status: string; deliveredAt: string | null; snapshot: Record<string, unknown> | null };
    const json = { facts: ["snapshot", "facts"], snapshotReportId: ["snapshot", "reportId"] } as const;
    const db = [
      { id: "r1", kind: "monthly", status: "delivered", delivered_at: "2027-01-05T10:00:00+01:00", snapshot: { reportId: "r1", model: { stor: true }, facts: { kind: "monthly", n: 1 } } },
      { id: "r2", kind: "monthly", status: "delivered", delivered_at: null, snapshot: null },
    ];
    const { client, calls } = fake(() => ({
      // PostgREST svarar med aliasen (snake_case) och jsonb-värdet som det är; saknad sökväg = null.
      data: db.map((r) => ({ id: r.id, kind: r.kind, delivered_at: r.delivered_at, facts: r.snapshot?.facts ?? null, snapshot_report_id: r.snapshot?.reportId ?? null })),
      error: null,
    }));
    const pg = await new SupabaseRepo<{ reports: R }>(client).table("reports").pickJson(["kind", "deliveredAt"], json, { status: "delivered" });
    expect(calls[0].args[0]).toBe("id,kind,delivered_at,facts:snapshot->facts,snapshot_report_id:snapshot->reportId");
    expect(pg).toEqual([
      { id: "r1", kind: "monthly", deliveredAt: "2027-01-05T10:00", facts: { kind: "monthly", n: 1 }, snapshotReportId: "r1" },
      { id: "r2", kind: "monthly", deliveredAt: null, facts: null, snapshotReportId: null },
    ]);
    // Minnesläget: samma värden ur raderna (modellen läses aldrig ut).
    const store = new MemoryStore<{ reports: R }>({
      reports: db.map((r) => ({ id: r.id, kind: r.kind, status: r.status, deliveredAt: r.delivered_at ? "2027-01-05T10:00" : null, snapshot: r.snapshot })),
    });
    const mem = await new MemoryRepo<{ reports: R }>(store, { userId: "x", role: "admin", contractIds: [] }, {}).table("reports").pickJson(["kind", "deliveredAt"], json, { status: "delivered" });
    expect(mem).toEqual(pg);
    expect(JSON.stringify(mem)).not.toContain("stor");
    // Alias och nycklar hamnar i frågan – bara bokstäver, siffror och understreck.
    await expect(new SupabaseRepo<{ reports: R }>(client).table("reports").pickJson(["kind"], { "x,y": ["snapshot", "facts"] } as never)).rejects.toThrow(/Ogiltig/);
    await expect(new SupabaseRepo<{ reports: R }>(client).table("reports").pickJson(["kind"], { facts: ["snapshot", "a->b"] } as never)).rejects.toThrow(/Ogiltig/);
  });

  it("filtren ger samma rader som matches() i minnesläget", async () => {
    const rows: T[] = [
      { id: "a", caseNumber: "BOT-1", status: "active", phase: 2, createdAt: "2027-01-10T08:00", closedAt: null, active: true },
      { id: "b", caseNumber: "BOT-2", status: "closed", phase: 5, createdAt: "2027-01-31T23:59", closedAt: "2027-02-01T10:00", active: false },
      { id: "c", caseNumber: "BOT-3", status: null, phase: null, createdAt: null, closedAt: null, active: true },
      { id: "d", caseNumber: "BOT-4", status: "paused", phase: 3, createdAt: "2027-02-01T00:00", closedAt: null, active: false },
    ];
    const wheres: Where<T>[] = [
      { status: "active" },
      { status: null },
      { status: { neq: "active" } },
      { status: { neq: null } },
      { phase: { neq: 5 } },
      { status: { in: ["active", "paused"] } },
      { status: { in: ["closed", null] } },
      { closedAt: { isNull: true } },
      { closedAt: { isNull: false } },
      { createdAt: { gte: "2027-01-10T08:00", lte: "2027-01-31T23:59" } },
      { createdAt: { gt: "2027-01-10T08:00" } },
      { createdAt: { lt: "2027-02-01" } },
      { phase: { gte: 3 } },
      { active: false, phase: { lte: 3 } },
      { active: true, status: { neq: "closed" }, closedAt: { isNull: true } },
    ];
    for (const where of wheres) {
      const { client, calls } = fake();
      await repoOf(client).list(where);
      const snake = rows.map((r) => toDbRow(r as unknown as Record<string, unknown>));
      const got = snake.filter((r) => filters(calls[0]).every((f) => evalFilter(r, f))).map((r) => r.id);
      const want = rows.filter((r) => matches(r, where)).map((r) => r.id);
      expect(got, JSON.stringify(where)).toEqual(want);
    }
  });
});

// ---------------------------------------------------------------- Skrivningar och fel
describe("skrivningar och fel", () => {
  it("get, count, insert, update och remove", async () => {
    const { client, calls } = fake((c) => {
      if (c.op === "select" && c.args[1]) return { data: null, error: null, count: 7 };
      if (c.op === "select") return { data: { id: "c1", case_number: "BOT-26-0001", created_at: "2027-02-01T08:12:00Z" }, error: null };
      if (c.op === "insert") return { data: null, error: null };
      if (c.op === "update") return { data: [{ id: "c1", status: "closed", closed_at: "2027-02-01T10:00:00+01:00" }], error: null };
      return { data: [{ id: "c1" }], error: null };
    });
    const t = repoOf(client);
    expect(await t.get("c1")).toEqual({ id: "c1", caseNumber: "BOT-26-0001", createdAt: "2027-02-01T09:12" });
    expect(calls[0].chain).toEqual([["eq", "id", "c1"], ["maybeSingle"]]);

    expect(await t.count({ status: "active" })).toBe(7);
    expect(calls[1].args).toEqual(["*", { count: "exact", head: true }]);

    const row: T = { id: "c2", caseNumber: "BOT-26-0002", status: "active", phase: 1, createdAt: "2027-02-01T09:12", closedAt: null, active: true };
    expect(await t.insert(row)).toEqual(row);
    expect(calls[2].args).toEqual([{ id: "c2", case_number: "BOT-26-0002", status: "active", phase: 1, created_at: "2027-02-01T09:12:00+01:00", closed_at: null, active: true }]);

    expect(await t.update("c1", { id: "x", status: "closed", closedAt: "2027-02-01T10:00" })).toEqual({ id: "c1", status: "closed", closedAt: "2027-02-01T10:00" });
    expect(calls[3].args).toEqual([{ status: "closed", closed_at: "2027-02-01T10:00:00+01:00" }]);
    expect(calls[3].chain).toEqual([["eq", "id", "c1"], ["select", "*"]]);

    await t.remove("c1");
    expect(calls[4].op).toBe("delete");
    expect(calls[4].chain).toEqual([["eq", "id", "c1"], ["select", "id"]]);
  });

  it("ingen rad ändrad eller borttagen = PolicyError (som MemoryRepo)", async () => {
    const { client } = fake(() => ({ data: [], error: null }));
    await expect(repoOf(client).update("c1", { status: "x" })).rejects.toBeInstanceOf(PolicyError);
    await expect(repoOf(client).remove("c1")).rejects.toBeInstanceOf(PolicyError);
  });

  it("RLS-fel blir PolicyError, andra fel DataError utan värden i meddelandet", async () => {
    const rls = fake(() => ({ data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "cases"' } }));
    await expect(repoOf(rls.client).insert({ id: "x" } as T)).rejects.toBeInstanceOf(PolicyError);
    const dup = fake(() => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint", details: "Key (email)=(anna.andersson@botkyrka.se) already exists." } }));
    const err = await repoOf(dup.client).insert({ id: "x" } as T).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as Error).message).toBe("Databasfel i cases (23505)");
    expect((err as Error).message).not.toContain("@");
  });
});

describe("läsning via vy", () => {
  it("användarens repo läser contracts och cases via vyerna men skriver till tabellen; service role läser tabellen", async () => {
    const { client, calls } = fake((c) => (c.op === "update" ? { data: [{ id: "c-bot" }], error: null } : { data: [], error: null }));
    const user = userRepo(client);
    await user.table("contracts").list();
    await user.table("contracts").get("c-bot");
    await user.table("contracts").count();
    await user.table("contracts").update("c-bot", { name: "x" });
    await user.table("cases").list();
    await user.table("cases").update("case-1", { status: "active" });
    await user.table("persons").update("p-1", { city: "Alby" });
    await appRepo(client).table("contracts").list();
    await appRepo(client).table("cases").update("case-1", { status: "active" });
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      "select:contracts_public",
      "select:contracts_public",
      "select:contracts_public",
      "update:contracts",
      "select:contracts_public",
      "select:cases_public",
      "update:cases",
      "select:cases_public",
      "update:persons",
      "select:contracts",
      "update:cases",
    ]);
    // Ändringar i tabeller som läses via en vy returnerar bara id (användaren får inte läsa alla kolumner i tabellen).
    const returning = calls.filter((c) => c.op === "update").map((c) => `${c.table}:${c.chain.find((x) => x[0] === "select")?.[1]}`);
    expect(returning).toEqual(["contracts:id", "cases:id", "persons:*", "cases:*"]);
  });
});

// ---------------------------------------------------------------- Liten tolk för de PostgREST-filter som repot skapar
function evalFilter(row: Record<string, unknown>, f: unknown[]): boolean {
  const [op, col, a, b] = f as [string, string, unknown, unknown];
  const v = row[col];
  const cmp = (x: unknown, y: unknown) => (typeof x === "string" && typeof y === "string" ? Date.parse(norm(x)) - Date.parse(norm(y)) : (x as number) - (y as number));
  switch (op) {
    case "eq": return v != null && cmp(v, a) === 0 || v === a;
    case "in": return v != null && (a as unknown[]).includes(v);
    case "is": return a === null ? v == null : v === a;
    case "not": return a === "is" && b === null ? v != null : true;
    case "gte": return v != null && cmp(v, a) >= 0;
    case "lte": return v != null && cmp(v, a) <= 0;
    case "gt": return v != null && cmp(v, a) > 0;
    case "lt": return v != null && cmp(v, a) < 0;
    case "or": return splitOr(col).some((part) => evalOrPart(row, part));
    default: throw new Error(`okänt filter ${op}`);
  }
}
/** Datum/tid som Date.parse förstår: 'YYYY-MM-DD' = midnatt i Stockholm (databasens tidszon). */
const norm = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? toTimestamptz(`${s}T00:00`) : s);
function splitOr(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && quoted) { cur += ch + s[++i]; continue; }
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
const unquote = (s: string): unknown => {
  if (s.startsWith('"')) return s.slice(1, -1).replace(/\\(.)/g, "$1");
  if (s === "true" || s === "false") return s === "true";
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
};
function evalOrPart(row: Record<string, unknown>, part: string): boolean {
  const [col, op, ...rest] = part.split(".");
  const val = rest.join(".");
  if (op === "is" && val === "null") return row[col] == null;
  if (op === "neq") return row[col] != null && row[col] !== unquote(val);
  if (op === "in") return row[col] != null && splitOr(val.slice(1, -1)).map(unquote).includes(row[col]);
  throw new Error(`okänt or-filter ${part}`);
}
