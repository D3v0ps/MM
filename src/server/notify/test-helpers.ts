// Testhjälpare för utskick och jobb (importeras bara av *.test.ts):
//   memoryNotifyRepo()  outbound_messages, jobs och cases i minnet (samma Repo-gränssnitt som SupabaseRepo)
//   memoryJobStore()    samma regler som mm.claim_jobs (supabase/migrations/0009): queued och förfallna, eller running som fastnat
//   fakeResend()        fejkad fetch mot Resend: sparar anropen, levererar ett mejl per Idempotency-Key, kan svara med fel
import { SYSTEM_ACTOR } from "@/api/roles";
import { addMinutes, type LocalDateTime } from "@/core/time";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import type { Case, Membership, Organization, Profile } from "@/data/schema";
import { STALE_MINUTES, type JobPatch, type JobStore } from "../jobs/runner";
import type { FetchLike } from "./resend";
import type { JobRow, NotifyRepo, NotifyTables } from "./types";

export function memoryNotifyRepo(
  cases: Case[] = [],
  dir: { profiles?: Profile[]; memberships?: Membership[]; organizations?: Organization[] } = {},
): { repo: NotifyRepo; store: MemoryStore<NotifyTables> } {
  const store = new MemoryStore<NotifyTables>({
    outbound_messages: [], jobs: [], cases: structuredClone(cases),
    profiles: structuredClone(dir.profiles ?? []), memberships: structuredClone(dir.memberships ?? []), organizations: structuredClone(dir.organizations ?? []),
  });
  return { repo: new MemoryRepo<NotifyTables>(store, SYSTEM_ACTOR, {}, { bypass: true }), store };
}

export function memoryJobStore(store: MemoryStore<NotifyTables>, staleMinutes = STALE_MINUTES): JobStore & { finished: { id: string; patch: JobPatch }[] } {
  const finished: { id: string; patch: JobPatch }[] = [];
  return {
    finished,
    async claim(n: number, now: LocalDateTime, maxAttempts: number): Promise<JobRow[]> {
      const stale = addMinutes(now, -staleMinutes);
      const due = store
        .rows("jobs")
        .filter((j) => j.attempts < maxAttempts && ((j.status === "queued" && j.runAfter <= now) || (j.status === "running" && !!j.startedAt && j.startedAt < stale)))
        .sort((a, b) => (a.runAfter < b.runAfter ? -1 : a.runAfter > b.runAfter ? 1 : a.id < b.id ? -1 : 1))
        .slice(0, n);
      return due.map((j) => structuredClone(store.updateRow("jobs", j.id, { status: "running", attempts: j.attempts + 1, startedAt: now })));
    },
    async finish(id: string, patch: JobPatch): Promise<void> {
      finished.push({ id, patch });
      store.updateRow("jobs", id, patch);
    },
  };
}

export type ResendCall = { url: string; headers: Record<string, string>; body: { from: string; to: string[]; subject: string; html: string; text: string; tags: { name: string; value: string }[] } };

/**
 * Fejkad Resend. `fail` = svar att ge före lyckade anrop (t.ex. [503, 503]). `delivered` = mejl som faktiskt skulle ha
 * gått iväg: ett per Idempotency-Key (Resend skickar inte samma utskick två gånger inom 24 timmar).
 */
export function fakeResend(opts: { fail?: { status: number; name?: string; message?: string }[]; throwNetwork?: number } = {}) {
  const calls: ResendCall[] = [];
  const delivered = new Map<string, ResendCall>();
  const failures = [...(opts.fail ?? [])];
  let network = opts.throwNetwork ?? 0;
  const fetch: FetchLike = async (url, init) => {
    const call: ResendCall = { url, headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    if (network > 0) {
      network--;
      throw new TypeError("fetch failed");
    }
    const f = failures.shift();
    if (f) return { ok: false, status: f.status, json: async () => ({ statusCode: f.status, name: f.name ?? "application_error", message: f.message ?? "fel" }) };
    const key = init.headers["Idempotency-Key"];
    if (!delivered.has(key)) delivered.set(key, call);
    return { ok: true, status: 200, json: async () => ({ id: `re-${[...delivered.keys()].indexOf(key) + 1}` }) };
  };
  return { fetch, calls, delivered };
}
