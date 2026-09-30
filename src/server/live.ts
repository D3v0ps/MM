// Supabase-läget (MM_BACKEND=supabase): session, identitet, Ctx och körning av API:t. Bara på servern.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, type Ctx } from "@/api/server";
import { execute } from "@/api/handlers";
import type { Actor } from "@/api/roles";
import type { LocalDateTime } from "@/core/time";
import { PARTICIPANT_USER_ID } from "@/data/actors";
import { PolicyError } from "@/data/memory";
import type { AppRepo, Membership, Organization } from "@/data/schema";
import { appRepo, fromDbRow, normalizeTimestamptz, type PgClient } from "@/data/supabase";
import type { AttemptStore } from "./auth/rate-limit";
import { clockNow } from "./clock";
import { liveCtx } from "./ctx";
import { resolveIdentity, type Identity, type IdentityStore, type ProfileRow, type TesterSession } from "./identity";
import { enqueueMessage } from "./notify";
import { loadAppSettings, type AppSettings } from "./settings";
import { serviceClient, userClient } from "./supabase";

const pg = (c: SupabaseClient) => c as unknown as PgClient;

// ---------------------------------------------------------------- Uppslag med service role
export function identityStore(service: SupabaseClient): IdentityStore {
  const repo = appRepo(service);
  return {
    async profileByAuthUser(authUserId) {
      const { data, error } = await service.from("profiles").select("*").eq("auth_user_id", authUserId).maybeSingle();
      if (error) throw new Error(`profiles kunde inte läsas (${error.code})`);
      return data ? fromDbRow<ProfileRow>(data) : null;
    },
    async testerSession(authUserId) {
      const { data, error } = await service.from("tester_sessions").select("profile_id,role").eq("auth_user_id", authUserId).maybeSingle();
      if (error) throw new Error(`tester_sessions kunde inte läsas (${error.code})`);
      return data ? ({ profileId: String(data.profile_id), role: data.role } as TesterSession) : null;
    },
    async directory(scope, profileId) {
      if (scope === "all") {
        const [profiles, memberships, organizations] = await Promise.all([repo.table("profiles").list(), repo.table("memberships").list(), repo.table("organizations").list()]);
        return { profiles, memberships, organizations };
      }
      const [self, memberships, organizations] = await Promise.all([repo.table("profiles").get(profileId), repo.table("memberships").list({ userId: profileId }), repo.table("organizations").list()]);
      return { profiles: self ? [self] : [], memberships, organizations };
    },
  };
}

export function attemptStore(service: SupabaseClient): AttemptStore {
  return {
    async count(q) {
      let f = service.from("login_attempts").select("*", { count: "exact", head: true }).eq("kind", q.kind).gte("attempted_at", q.since);
      if (q.emailHash) f = f.eq("email_hash", q.emailHash);
      if (q.ipHash) f = f.eq("ip_hash", q.ipHash);
      const { count, error } = await f;
      if (error) throw new Error(`login_attempts kunde inte läsas (${error.code})`);
      return count ?? 0;
    },
    async lastAt(q) {
      const { data, error } = await service
        .from("login_attempts")
        .select("attempted_at")
        .eq("kind", q.kind)
        .eq("email_hash", q.emailHash)
        .order("attempted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`login_attempts kunde inte läsas (${error.code})`);
      const v = data?.attempted_at as string | undefined;
      return v ? Date.parse(normalizeTimestamptz(v)) : null;
    },
    async record(a) {
      const { error } = await service.from("login_attempts").insert({ kind: a.kind, email_hash: a.emailHash, ip_hash: a.ipHash, attempted_at: a.at });
      if (error) throw new Error(`login_attempts kunde inte skrivas (${error.code})`);
    },
  };
}

/** Profil för en e-postadress (gemener), med organisation och medlemskap. Service role – bara för inloggningen. */
export async function profileByEmail(service: SupabaseClient, email: string): Promise<{ profile: ProfileRow; org: Organization | null; memberships: Membership[] } | null> {
  const { data, error } = await service.from("profiles").select("*").eq("email", email).maybeSingle();
  if (error) throw new Error(`profiles kunde inte läsas (${error.code})`);
  if (!data) return null;
  const profile = fromDbRow<ProfileRow>(data);
  const repo = appRepo(service);
  const [org, memberships] = await Promise.all([repo.table("organizations").get(profile.organizationId), repo.table("memberships").list({ userId: profile.id })]);
  return { profile, org, memberships };
}

// ---------------------------------------------------------------- Sessionen för en förfrågan
export type LiveSession = {
  settings: AppSettings;
  now: LocalDateTime;
  service: SupabaseClient;
  user: SupabaseClient;
  /** Auth-användarens id och claims (null = inte inloggad). */
  authUserId: string | null;
  claims: Record<string, unknown> | null;
  identity: Identity | null;
};

export async function liveSession(): Promise<LiveSession> {
  const service = serviceClient();
  const user = await userClient();
  const nowMs = Date.now();
  const [settings, claimsRes] = await Promise.all([loadAppSettings(pg(service), nowMs), user.auth.getClaims()]);
  const claims = (claimsRes.data?.claims ?? null) as Record<string, unknown> | null;
  const authUserId = typeof claims?.sub === "string" ? claims.sub : null;
  const identity = authUserId ? await resolveIdentity(identityStore(service), authUserId, settings.environment) : null;
  return { settings, now: clockNow(settings.clock, nowMs), service, user, authUserId, claims, identity };
}

/** Deltagaren via pulslänk – ingen inloggning, inga avtal. Databasen ser rollen anon (ingen åtkomst utan hanterarens systemsteg). */
const PARTICIPANT: Actor = { userId: PARTICIPANT_USER_ID, role: "deltagare", contractIds: [], customerUnit: null };

export function ctxFor(s: LiveSession): { ctx: Ctx; signedIn: boolean } {
  const actor = s.identity?.persona.actor ?? PARTICIPANT;
  const system: AppRepo = appRepo(s.service);
  const ctx = liveCtx({
    actor,
    now: s.now,
    repo: appRepo(s.user),
    system,
    enqueue: enqueueMessage,
    testerId: s.identity?.impersonating ? s.identity.self.id : null,
  });
  return { ctx, signedIn: !!s.identity };
}

/** Kör en fråga eller ett kommando i supabase-läget. Samma regler som minnesläget (execute validerar och kontrollerar roll). */
export async function runLive(kind: "query" | "command", key: string, input: unknown): Promise<unknown> {
  const s = await liveSession();
  if (s.authUserId && !s.identity) throw new ApiError(403, "no_access", "Ditt konto har inte tillgång till Miljonmatch. Kontakta den som bjöd in dig.");
  const { ctx, signedIn } = ctxFor(s);
  try {
    const res = await execute(kind, key, input, ctx);
    return res === undefined ? null : res;
  } catch (e) {
    // Inte inloggad och sidan kräver inloggning: 401, så att webbläsaren skickas till inloggningen.
    if (!signedIn && e instanceof ApiError && e.status === 403) throw new ApiError(403, "unauthenticated", "Du är inte inloggad.");
    if (e instanceof PolicyError) throw new ApiError(403, "forbidden", "Din roll har inte behörighet till det här.");
    throw e;
  }
}
