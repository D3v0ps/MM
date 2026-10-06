import { describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { MemoryRepo, MemoryStore, type Policies } from "@/data/memory";
import type { AppRepo, Tables } from "@/data/schema";
import { attendanceStats } from "@/core/attendance";
import { mkActivity, mkAttendance, mkCase, testDb, testEnv } from "@/core/test-data";
import { loadDb } from "./load";

const actor: Actor = { userId: "u-amira", role: "coach", contractIds: ["c-bot"] };
const data = testDb({
  cases: [mkCase({ id: "c1", leadCoachId: "u-amira" }), mkCase({ id: "c2", leadCoachId: "u-erik" }), mkCase({ id: "k1", contractId: "c-ny", leadCoachId: "u-erik" })],
  activities: [mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-25T10:00" })],
  attendance: [mkAttendance({ activityId: "a1", caseId: "c1", status: "present" })],
});
// Policy som bara släpper igenom coachens egna ärenden (som RLS).
const policies: Policies<Tables> = { cases: { read: (c, a) => c.leadCoachId === a.userId } };
const repo = new MemoryRepo<Tables>(new MemoryStore<Tables>(data), actor, policies) as unknown as AppRepo;

describe("loadDb", () => {
  it("läser tabellerna via repot, med behörighetsfilter och where-villkor", async () => {
    const db = await loadDb(repo, ["cases", "activities", "attendance"]);
    expect(Object.keys(db).sort()).toEqual(["activities", "attendance", "cases"]);
    expect(db.cases.map((c) => c.id)).toEqual(["c1"]);
    expect(attendanceStats(db, "c1", "2027-01-25", "2027-01-31", testEnv()).present).toBe(1);
  });
  it("filter per tabell", async () => {
    const all = new MemoryRepo<Tables>(new MemoryStore<Tables>(data), actor, {}) as unknown as AppRepo;
    const db = await loadDb(all, ["cases"], { cases: { contractId: "c-ny" } });
    expect(db.cases.map((c) => c.id)).toEqual(["k1"]);
  });
});
