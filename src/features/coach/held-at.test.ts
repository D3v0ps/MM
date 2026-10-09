// Mötesrapporten utan starttid (coachmötet 2026-10-09: "automatiskt fylla i datumet, tiden är onödig"): formuläret skickar bara
// dagen (heldOn) och servern sätter klockslaget – det planerade mötets tid den dagen, annars när rapporten sparas – och en
// senare sparning av samma utkast flyttar aldrig tiden.
import { beforeEach, describe, expect, it } from "vitest";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import "@/api/handlers";
import { checkinSave } from "./api";

const SEED: MemoryData<Tables> = createSeed();
const NADIA = "case-260143";
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const amira = () => listPersonas(rt.raw()).find((p) => p.actor.userId === "u-amira" && p.actor.role === "coach")!.actor;
const save = (data: Record<string, unknown>, checkInId?: string) =>
  rt.run("command", checkinSave.key, { caseId: NADIA, checkInId, data: { durationMin: 45, mode: "fysiskt", nextGoal: "", ...data }, approve: false }, amira()) as Promise<{ ok: boolean; checkInId: string }>;
const heldAt = (id: string) => rt.store.rows("check_ins").find((c) => c.id === id)?.heldAt;

describe("mötesrapporten: dagen i formuläret, klockslaget från servern", () => {
  it("dagens planerade coachträff (kalendern): mötets klockslag", async () => {
    const res = await save({ heldOn: "2027-02-01" });
    expect(res.ok).toBe(true);
    expect(heldAt(res.checkInId)).toBe("2027-02-01T10:00");
  });

  it("en dag utan planerat möte: klockslaget när rapporten sparas", async () => {
    const res = await save({ heldOn: "2027-01-29" });
    // Demoklockan flyttas en minut per kommando: 09.12 → 09.13.
    expect(heldAt(res.checkInId)).toBe("2027-01-29T09:13");
  });

  it("samma utkast sparas igen (autosparning, Spara utkast): tiden flyttas inte – en ny dag får ny tid", async () => {
    const first = await save({ heldOn: "2027-01-29" });
    rt.clock.set("2027-02-01T11:30");
    await save({ heldOn: "2027-01-29", nextGoal: "Skicka två ansökningar" }, first.checkInId);
    expect(heldAt(first.checkInId)).toBe("2027-01-29T09:13");
    await save({ heldOn: "2027-02-01" }, first.checkInId);
    expect(heldAt(first.checkInId)).toBe("2027-02-01T10:00");
  });

  it("heldAt (äldre anropare) går före och fältet heldOn sparas aldrig i raden", async () => {
    const res = await save({ heldAt: "2027-01-28T14:00", heldOn: "2027-02-01" });
    const row = rt.store.rows("check_ins").find((c) => c.id === res.checkInId) as unknown as Record<string, unknown>;
    expect(row.heldAt).toBe("2027-01-28T14:00");
    expect("heldOn" in row).toBe(false);
  });
});
