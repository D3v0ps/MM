// Supabase-läget (MM_BACKEND=supabase): session, identitet, Ctx och körning av API:t. Bara på servern.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, type Ctx } from "@/api/server";
import { execute } from "@/api/handlers";
import type { Actor } from "@/api/roles";
import type { LocalDateTime } from "@/core/time";
import { PARTICIPANT_USER_ID } from "@/data/actors";
import type { AppRepo, Membership, Organization } from "@/data/schema";
import { appRepo, fromDbRow, userRepo, type PgClient } from "@/data/supabase";
import { serverAi } from "./ai";
import { serverAttachments } from "./attachments";
import { serverAudio } from "./audio";
import { LIMITS, type GateVerdict, type LoginGate, type SelfRegistrationStore } from "./auth/rate-limit";
import { clockNow } from "./clock";
import { staffEmailDomains } from "./config";
import { lazyServerCrypto } from "./crypto";
import { liveCtx } from "./ctx";
import { resolveIdentity, type DbActor, type Identity, type IdentityStore, type ProfileRow } from "./identity";
import { scheduleJobsAfterResponse } from "./jobs/schedule";
import { enqueueMessage } from "./notify";
import { loadAppSettings, type AppSettings } from "./settings";
import { serviceClient, userClient } from "./supabase";

const pg = (c: SupabaseClient) => c as unknown as PgClient;

// ---------------------------------------------------------------- Uppslag
/** currentActor med användarens session (samma aktör som RLS), katalogen med service role. */
export function identityStore(service: SupabaseClient, user: SupabaseClient): IdentityStore {
  const repo = appRepo(service);
  return {
    async currentActor() {
      const { data, error } = await user.rpc("current_actor");
      if (error) throw new Error(`current_actor kunde inte läsas (${error.code})`);
      return (data ?? null) as DbActor | null;
    },
    async directory(scope, profileIds) {
      if (scope === "all") {
        const [profiles, memberships, organizations] = await Promise.all([repo.table("profiles").list(), repo.table("memberships").list(), repo.table("organizations").list()]);
        return { profiles, memberships, organizations };
      }
      const [profiles, memberships, organizations] = await Promise.all([
        repo.table("profiles").list({ id: { in: profileIds } }),
        repo.table("memberships").list({ userId: { in: profileIds } }),
        repo.table("organizations").list(),
      ]);
      return { profiles, memberships, organizations };
    },
  };
}

/** Inloggningens spärr i databasen (mm.login_attempt_gate, supabase/migrations/0012). Bara service role. */
export function loginGate(service: SupabaseClient): LoginGate {
  return {
    async gate(a) {
      const { data, error } = await service.rpc("login_attempt_gate", {
        p_kind: a.kind, p_email_hash: a.emailHash, p_ip_hash: a.ipHash, p_at: a.at, p_limits: LIMITS,
      });
      if (error) throw new Error(`login_attempt_gate kunde inte köras (${error.code})`);
      const r = (data ?? {}) as { verdict?: unknown; id?: unknown };
      const verdict: GateVerdict = r.verdict === "ok" || r.verdict === "too_many_attempts" ? r.verdict : "rate_limited";
      return { verdict, id: typeof r.id === "number" ? r.id : r.id != null ? Number(r.id) : null };
    },
    async markVerified(id) {
      const { error } = await service.from("login_attempts").update({ kind: "verify_ok" }).eq("id", id);
      if (error) throw new Error(`login_attempts kunde inte skrivas (${error.code})`);
    },
  };
}

/**
 * Påbörjade självregistreringar i login_attempts (kind "self_registration", bara hashade värden – samma tabell och nyckel som
 * inloggningens spärrar). Service role – bara för inloggningen.
 */
export function selfRegistrationStore(service: SupabaseClient): SelfRegistrationStore {
  return {
    async recent(since) {
      const { data, error } = await service.from("login_attempts").select("email_hash, ip_hash").eq("kind", "self_registration").gte("attempted_at", since).limit(5000);
      if (error) throw new Error(`login_attempts kunde inte läsas (${error.code})`);
      return ((data ?? []) as { email_hash: string; ip_hash: string | null }[]).map((r) => ({ emailHash: r.email_hash, ipHash: r.ip_hash ?? "" }));
    },
    async record(a) {
      const { error } = await service.from("login_attempts").insert({ kind: "self_registration", email_hash: a.emailHash, ip_hash: a.ipHash, attempted_at: a.at });
      if (error) throw new Error(`login_attempts kunde inte skrivas (${error.code})`);
    },
  };
}

/** Profil för en e-postadress (gemener), med organisation och medlemskap. Service role – bara för inloggningen. */
export async function profileByEmail(service: SupabaseClient, email: string): Promise<{ profile: ProfileRow; org: Organization | null; memberships: Membership[] } | null> {
  if (!email) return null;
  const { data, error } = await service.from("profiles").select("*").eq("email", email).maybeSingle();
  if (error) throw new Error(`profiles kunde inte läsas (${error.code})`);
  if (!data) return null;
  const profile = fromDbRow<ProfileRow>(data);
  const repo = appRepo(service);
  const [org, memberships] = await Promise.all([repo.table("organizations").get(profile.organizationId), repo.table("memberships").list({ userId: profile.id }, { orderBy: "id" })]);
  return { profile, org, memberships };
}

// ---------------------------------------------------------------- Sessionen för en förfrågan
export type LiveSession = {
  settings: AppSettings;
  /** Klockan för förfrågan (testtid i testmiljön). */
  now: LocalDateTime;
  service: SupabaseClient;
  user: SupabaseClient;
  /** Auth-användarens id (null = inte inloggad). */
  authUserId: string | null;
  identity: Identity | null;
};

export async function liveSession(): Promise<LiveSession> {
  const service = serviceClient();
  const user = await userClient();
  const nowMs = Date.now();
  // getClaims verifierar tokenet (och förnyar sessionen vid behov) innan databasen anropas med det.
  const [settings, claimsRes] = await Promise.all([loadAppSettings(pg(service), nowMs), user.auth.getClaims()]);
  const sub = claimsRes.data?.claims?.sub;
  const authUserId = typeof sub === "string" ? sub : null;
  const identity = authUserId ? await resolveIdentity(identityStore(service, user), settings.environment) : null;
  return { settings, now: clockNow(settings.clock, nowMs), service, user, authUserId, identity };
}

/** Deltagaren via pulslänk – ingen inloggning, inga avtal. Databasen ser rollen anon (bara hanterarnas systemsteg). */
const PARTICIPANT: Actor = { userId: PARTICIPANT_USER_ID, role: "deltagare", contractIds: [], customerUnit: null };

export function ctxFor(s: LiveSession): Ctx {
  const system: AppRepo = appRepo(s.service);
  return liveCtx({
    actor: s.identity?.persona.actor ?? PARTICIPANT,
    now: s.now,
    repo: userRepo(s.user),
    system,
    enqueue: enqueueMessage,
    testerId: s.identity?.impersonating ? s.identity.self.id : null,
    crypto: lazyServerCrypto,
    // Röstinspelningen: AI-leverantören (MM_AI_PROVIDER), ljudlagringen (bucketen "ljud") och jobbkön (after()).
    ai: serverAi(s.settings.environment),
    audio: (d) => serverAudio(d),
    // Bilagorna till beställningen (bucketen "bilagor").
    attachments: (d) => serverAttachments(d),
    scheduleJobs: scheduleJobsAfterResponse,
    // "Lägg till kollega": personalens tillåtna domäner från miljön (src/core/staff.ts).
    staffEmailDomains: staffEmailDomains(),
  });
}

/** Kör en fråga eller ett kommando i supabase-läget. Samma regler som minnesläget (execute validerar och kontrollerar roll). */
export async function runLive(kind: "query" | "command", key: string, input: unknown): Promise<unknown> {
  const s = await liveSession();
  if (s.authUserId && !s.identity) throw new ApiError(403, "no_access", "Ditt konto har inte tillgång till Miljonmatch. Kontakta den som bjöd in dig.");
  try {
    const res = await execute(kind, key, input, ctxFor(s));
    return res === undefined ? null : res;
  } catch (e) {
    // Inte inloggad och åtgärden kräver en roll: 401, så att webbläsaren skickas till inloggningen.
    if (!s.identity && e instanceof ApiError && e.status === 403) throw new ApiError(403, "unauthenticated", "Du är inte inloggad.");
    throw e;
  }
}
