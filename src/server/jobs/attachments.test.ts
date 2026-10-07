// Timjobben som kom med bilagorna och självregistreringen (beslut 2026-10-07): attachments_retention och auth_cleanup –
// läggs en gång per timme (samma id), körs med sina beroenden och raderar Auth-användare utan profil efter ett dygn.
import { describe, expect, it } from "vitest";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { SYSTEM_ACTOR } from "@/api/roles";
import { POLICIES } from "@/data/policy";
import { emptyDb, type AppRepo, type Tables } from "@/data/schema";
import { ATTACHMENTS_RETENTION_JOB, AUTH_CLEANUP_JOB, attachmentJobHandlers, deleteOrphanAuthUsers, ensureHourlyJobs, hourlyJobId, type AuthAdminLike } from "./attachments";
import type { Job } from "@/data/schema";

describe("timjobben", () => {
  it("läggs en gång per timme – samma id för timmen, två körningar ger inga dubbletter", async () => {
    const store = new MemoryStore<Tables>(emptyDb() as never);
    const repo = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
    expect(hourlyJobId(ATTACHMENTS_RETENTION_JOB, "2027-02-01T09:12")).toBe("job-attachments_retention-2027-02-01T09");
    expect(await ensureHourlyJobs(repo, "2027-02-01T09:12")).toBe(2);
    expect(await ensureHourlyJobs(repo, "2027-02-01T09:40")).toBe(0);
    expect(await ensureHourlyJobs(repo, "2027-02-01T10:01")).toBe(2);
    expect(store.rows("jobs").map((j) => [j.id, j.kind, j.status])).toEqual([
      ["job-attachments_retention-2027-02-01T09", "attachments_retention", "queued"], ["job-auth_cleanup-2027-02-01T09", "auth_cleanup", "queued"],
      ["job-attachments_retention-2027-02-01T10", "attachments_retention", "queued"], ["job-auth_cleanup-2027-02-01T10", "auth_cleanup", "queued"],
    ]);
  });

  it("utan beroenden ger jobben upp (körs inte här); städningen returnerar antalet", async () => {
    const h = attachmentJobHandlers<{ authCleanup?: () => Promise<number> }>();
    const job = { id: "j", kind: AUTH_CLEANUP_JOB } as unknown as Job;
    await expect(h[ATTACHMENTS_RETENTION_JOB].run(job, {})).rejects.toMatchObject({ retryable: false });
    await expect(h[AUTH_CLEANUP_JOB].run(job, {})).rejects.toMatchObject({ retryable: false });
    expect(await h[AUTH_CLEANUP_JOB].run(job, { authCleanup: async () => 0 })).toBe("none");
    expect(await h[AUTH_CLEANUP_JOB].run(job, { authCleanup: async () => 3 })).toBe("deleted:3");
  });
});

describe("deleteOrphanAuthUsers", () => {
  it("raderar bara Auth-användare utan profil som är äldre än ett dygn", async () => {
    const now = Date.parse("2027-02-02T12:00:00Z");
    const users = [
      { id: "a", email: "ny.person@botkyrka.se", created_at: "2027-02-01T11:00:00Z" }, // äldre än ett dygn, ingen profil -> raderas
      { id: "b", email: "maria.ekdahl@botkyrka.se", created_at: "2027-01-01T11:00:00Z" }, // har profil
      { id: "c", email: "snart@botkyrka.se", created_at: "2027-02-02T10:00:00Z" }, // yngre än ett dygn
      { id: "d", email: null, created_at: "inte ett datum" },
    ];
    const deleted: string[] = [];
    const admin: AuthAdminLike = {
      listUsers: async ({ page }) => ({ data: { users: page === 1 ? users : [] }, error: null }),
      deleteUser: async (id) => (deleted.push(id), { error: null }),
    };
    const n = await deleteOrphanAuthUsers(admin, async (u) => u.email === "maria.ekdahl@botkyrka.se", now);
    expect([n, deleted]).toEqual([1, ["a"]]);
  });

  it("ett fel när kontona läses ger ett nytt försök senare", async () => {
    const admin: AuthAdminLike = { listUsers: async () => ({ data: null, error: { status: 500 } }), deleteUser: async () => ({ error: null }) };
    await expect(deleteOrphanAuthUsers(admin, async () => false, Date.now())).rejects.toMatchObject({ retryable: true });
  });
});
