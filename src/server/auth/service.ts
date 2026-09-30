// Inloggning med e-post och sexsiffrig kod (SPEC §4) i supabase-läget. Används av /api/auth/*.
//   1. requestCode: svarar alltid likadant. Utskicket görs efter svaret (after), så att svarstiden inte avslöjar om
//      adressen finns. Koden skickas bara till en aktiv profil med roll, tillåten domän och – i testmiljön – adress i
//      MM_EMAIL_ALLOWLIST. Supabase Auth skickar mejlet via egen SMTP (Resend).
//   2. verifyCode: högst 5 försök per kod, hastighetsbegränsning per adress och IP, kopplar profiles.auth_user_id,
//      revisionslogg auth.login / auth.login_failed (bara id:n).
// Inga adresser, koder eller IP-adresser i loggar – bara felkoder.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthResult } from "@/shell/session";
import type { LocalDateTime } from "@/core/time";
import { appRepo, toTimestamptz, type PgClient } from "@/data/supabase";
import { clockNow } from "../clock";
import { emailAllowlist, loginHashSecret, staffEmailDomains } from "../config";
import { attemptStore, profileByEmail } from "../live";
import { loadAppSettings, type AppSettings } from "../settings";
import { anonClient, serviceClient } from "../supabase";
import { allowedByList, AUTH_TEXT, domainAllowed, isValidEmail, normalizeEmail } from "./email";
import { checkCodeRequest, checkVerify, hashesFor } from "./rate-limit";

export type AuthResponse = { status: number; body: AuthResult & { message?: string } };

const fail = (status: number, error: Extract<AuthResult, { ok: false }>["error"], message: string): AuthResponse => ({ status, body: { ok: false, error, message } });

/** Loggrad utan personuppgifter. */
const logCode = (step: string, code: unknown) => console.error("inloggning", step, typeof code === "string" ? code : "okänt");

async function audit(service: SupabaseClient, now: LocalDateTime, e: { action: string; actorId: string | null; entityId: string | null; contractId: string | null; details?: Record<string, unknown> }) {
  await appRepo(service)
    .table("audit_log")
    .insert({ id: `log-${crypto.randomUUID()}`, occurredAt: now, actorId: e.actorId, action: e.action, entity: "profile", entityId: e.entityId, contractId: e.contractId, details: e.details ?? {} })
    .catch((err: unknown) => logCode("revisionslogg", (err as Error)?.name));
}

/** Får adressen en kod? (Aktiv profil med roll, tillåten domän, spärrlistan i testmiljön.) */
export async function eligibleForCode(service: SupabaseClient, email: string, settings: AppSettings) {
  const allowlist = emailAllowlist();
  // Testmiljön: testdatat har adresser på riktiga domäner (t.ex. botkyrka.se) som aldrig får få mejl.
  if ((settings.environment === "staging" || allowlist.length) && !allowedByList(email, allowlist)) return null;
  const hit = await profileByEmail(service, email);
  if (!hit || !hit.profile.active || !hit.memberships.length) return null;
  if (!domainAllowed(email, hit.org, staffEmailDomains())) return null;
  return hit;
}

/** Skicka koden (körs efter svaret). */
async function sendCode(email: string) {
  const service = serviceClient();
  const settings = await loadAppSettings(service as unknown as PgClient, Date.now());
  const hit = await eligibleForCode(service, email, settings);
  if (!hit) return;
  const { profile } = hit;
  // Auth-användaren skapas vid första inloggningen (bekräftad e-post, ingen självregistrering). Testdatat har redan
  // ett auth_user_id per profil – samma id används så att kopplingen finns från början.
  const created = await service.auth.admin.createUser({ email, email_confirm: true, ...(profile.authUserId ? { id: profile.authUserId } : {}) });
  if (created.error) {
    const code = created.error.code ?? "";
    if (code !== "email_exists" && code !== "user_already_exists") logCode("skapa-konto", code || created.error.status?.toString());
  } else if (created.data.user && profile.authUserId !== created.data.user.id) {
    const { error } = await service.from("profiles").update({ auth_user_id: created.data.user.id }).eq("id", profile.id);
    if (error) logCode("koppla-konto", error.code);
  }
  const { error } = await anonClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) logCode("skicka-kod", error.code ?? String(error.status ?? ""));
}

/** POST /api/auth/code */
export async function requestCode(rawEmail: unknown, ip: string, later: (fn: () => Promise<void>) => void): Promise<AuthResponse> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return fail(400, "invalid_email", AUTH_TEXT.invalidEmail);
  const service = serviceClient();
  const attempts = attemptStore(service);
  const h = hashesFor(loginHashSecret(), email, ip);
  const nowMs = Date.now();
  if ((await checkCodeRequest(attempts, h, nowMs)) !== "ok") return fail(429, "rate_limited", AUTH_TEXT.rateLimited);
  await attempts.record({ kind: "code", at: new Date(nowMs).toISOString(), ...h });
  later(async () => {
    try {
      await sendCode(email);
    } catch (e) {
      logCode("skicka-kod", (e as Error)?.name);
    }
  });
  return { status: 200, body: { ok: true, message: AUTH_TEXT.codeSent } };
}

/** POST /api/auth/verify – `user` är SSR-klienten som sätter sessionens kakor. */
export async function verifyCode(user: SupabaseClient, rawEmail: unknown, rawCode: unknown, ip: string, later: (fn: () => Promise<void>) => void): Promise<AuthResponse & { profileId?: string }> {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? "").replace(/\s/g, "");
  if (!isValidEmail(email)) return fail(400, "invalid_email", AUTH_TEXT.invalidEmail);
  if (!/^\d{6}$/.test(code)) return fail(400, "invalid_code", AUTH_TEXT.invalidCode);

  const service = serviceClient();
  const attempts = attemptStore(service);
  const h = hashesFor(loginHashSecret(), email, ip);
  const nowMs = Date.now();
  const gate = await checkVerify(attempts, h, nowMs);
  if (gate === "too_many_attempts") return fail(429, "too_many_attempts", AUTH_TEXT.tooManyAttempts);
  if (gate === "rate_limited") return fail(429, "rate_limited", AUTH_TEXT.rateLimited);

  const settings = await loadAppSettings(service as unknown as PgClient, nowMs);
  const now = clockNow(settings.clock, nowMs);
  const { data, error } = await user.auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.user) {
    await attempts.record({ kind: "verify_failed", at: new Date(nowMs).toISOString(), ...h });
    // Revisionsloggen skrivs efter svaret, så att svarstiden inte avslöjar om adressen har en profil.
    later(async () => {
      const hit = await profileByEmail(service, email).catch(() => null);
      if (hit) await audit(service, now, { action: "auth.login_failed", actorId: null, entityId: hit.profile.id, contractId: hit.memberships[0]?.contractId ?? null, details: { method: "email_otp" } });
    });
    return fail(401, error?.code === "otp_expired" ? "expired" : "invalid_code", AUTH_TEXT.wrongCode);
  }

  const hit = await profileByEmail(service, email);
  if (!hit || !hit.profile.active || !hit.memberships.length) {
    // Kontot finns i Supabase Auth men profilen är spärrad eller borttagen: logga ut direkt.
    await user.auth.signOut({ scope: "local" });
    if (hit) await audit(service, now, { action: "auth.login_denied", actorId: null, entityId: hit.profile.id, contractId: hit.memberships[0]?.contractId ?? null, details: { method: "email_otp", reason: "inactive" } });
    return fail(403, "not_invited", AUTH_TEXT.noAccess);
  }
  const { profile, memberships } = hit;
  const patch: Record<string, unknown> = { last_login_at: toTimestamptz(now) };
  if (profile.authUserId !== data.user.id) patch.auth_user_id = data.user.id;
  const upd = await service.from("profiles").update(patch).eq("id", profile.id);
  if (upd.error) logCode("koppla-konto", upd.error.code);
  // Ny inloggning = testaren är sig själv igen.
  await service.from("tester_sessions").delete().eq("auth_user_id", data.user.id);
  await attempts.record({ kind: "verify_ok", at: new Date(nowMs).toISOString(), ...h });
  await audit(service, now, { action: "auth.login", actorId: profile.id, entityId: profile.id, contractId: memberships[0]?.contractId ?? null, details: { method: "email_otp" } });
  return { status: 200, body: { ok: true }, profileId: profile.id };
}
