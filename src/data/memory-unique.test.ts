// MemoryStore speglar databasens unika nycklar (UNIQUE_KEYS, 0022 och 0016): en dubblett stoppas med UniqueError (kod 23505,
// som Postgres), och updateIf ändrar raden bara om den fortfarande matchar villkoret – kontroll och skrivning i ett steg.
import { describe, expect, it } from "vitest";
import { listPersonas } from "./actors";
import { MemoryRepo, MemoryStore, UniqueError } from "./memory";
import { POLICIES } from "./policy";
import { UNIQUE_KEYS, type Tables } from "./schema";
import { createSeed } from "./seed";

const store = () => new MemoryStore<Tables>(createSeed(), UNIQUE_KEYS);
const amira = (s: MemoryStore<Tables>) => listPersonas(s.raw()).find((p) => p.actor.userId === "u-amira" && p.actor.role === "coach")!.actor;
const maria = (s: MemoryStore<Tables>) => listPersonas(s.raw()).find((p) => p.actor.userId === "k-maria" && p.actor.role === "kommun_handlaggare")!.actor;

describe("unika nycklar i minnet", () => {
  it("en andra närvarorad för samma tillfälle stoppas – också via en ändring till ett upptaget tillfälle", async () => {
    const s = store();
    const repo = new MemoryRepo<Tables>(s, amira(s), POLICIES);
    const t = repo.table("attendance");
    const existing = (await t.first({ caseId: "case-260143" }))!;
    const free = (await repo.table("activities").list({ caseId: "case-260143" })).find((a) => !s.rows("attendance").some((x) => x.activityId === a.id))!;
    const e = await t.insert({ ...existing, id: "at-x" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UniqueError);
    expect((e as UniqueError).code).toBe("23505");
    expect((e as Error).message).toBe("Dubblett i attendance (activityId)");
    expect(s.rows("attendance").filter((a) => a.activityId === existing.activityId)).toHaveLength(1);
    // Ett ledigt tillfälle går bra; att sedan ändra raden till det upptagna stoppas.
    await t.insert({ ...existing, id: "at-x", activityId: free.id });
    await expect(t.update("at-x", { activityId: existing.activityId })).rejects.toBeInstanceOf(UniqueError);
    expect((await t.get("at-x"))!.activityId).toBe(free.id);
    // Samma id igen: samma fel som databasens primärnyckel ger.
    await expect(t.insert({ ...existing, id: "at-x", activityId: free.id })).rejects.toBeInstanceOf(UniqueError);
  });

  it("updateIf: ändrar bara när raden matchar villkoret, annars null och ingen ändring", async () => {
    const s = store();
    const system = new MemoryRepo<Tables>(s, { userId: "system", role: "admin", contractIds: [] }, POLICIES, { bypass: true });
    const t = system.table("reports");
    const waiting = (await t.first({ kind: "weekly_attendance", status: "waiting" }))!;
    expect(await t.updateIf(waiting.id, { status: "delivered" }, { status: "delivered" })).toBeNull();
    expect((await t.get(waiting.id))!.status).toBe("waiting");
    const changed = await t.updateIf(waiting.id, { status: "waiting" }, { status: "delivered" });
    expect(changed).toMatchObject({ id: waiting.id, status: "delivered" });
    // Andra gången matchar raden inte längre: null – så att två samtidiga publiceringar inte båda går igenom.
    expect(await t.updateIf(waiting.id, { status: "waiting" }, { status: "delivered" })).toBeNull();
    expect(await t.updateIf("finns-inte", { status: "waiting" }, { status: "delivered" })).toBeNull();
    // Policyn: en rad som aktören inte får läsa ger null (ingen information om att den finns). Kommunens handläggare ser
    // bara sina egna beställningar (coachen ser alla ärenden i avtalet sedan 2026-10-09).
    const repo = new MemoryRepo<Tables>(s, maria(s), POLICIES);
    const hidden = (await system.table("cases").list()).find((c) => c.referrerId !== "k-maria" && c.contractId === "c-bot")!;
    expect(await repo.table("cases").updateIf(hidden.id, { status: hidden.status }, { location: "x" })).toBeNull();
  });
});
