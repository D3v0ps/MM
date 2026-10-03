// Proxy (Next.js 16, ersätter middleware) – bara i supabase-läget:
//   1. förnyar Supabase-sessionen (@supabase/ssr) så att kakorna hålls aktuella
//   2. loggar ut efter 60 minuters inaktivitet och senast 12 timmar efter inloggningen (SPEC §4)
//   3. skickar den som inte är inloggad till inloggningen – utom på publika sidor (inloggningen och pulslänken)
// Detta är en förhandskontroll. Behörigheten avgörs alltid i /api/rpc (roll) och i databasen (RLS).
// Minnesläget (prototypen, utveckling, e2e) påverkas inte.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { backend, secureCookies, sessionCookieSecret, supabaseEnv } from "@/server/config";
import {
  effectiveLoginAt,
  isPublicPagePath,
  LAST_SEEN_COOKIE,
  lastSeenFromCookie,
  LOGIN_AT_COOKIE,
  loginPathFor,
  MM_SESSION_COOKIES,
  SESSION_MAX_HOURS,
  sessionIdFromClaims,
  sessionVerdict,
  signLastSeen,
  type SessionVerdict,
} from "@/server/session-policy";

/** API-vägar som alltid släpps igenom utan sessionskontroll: inloggningen själv och bakgrundsjobben (egen nyckel). */
const PASS_THROUGH = ["/api/auth/", "/api/jobs/", "/api/dev-session"];
/** API-vägar som ska få svara även när sessionen just gått ut (de svarar "inte inloggad" själva). */
const SOFT_API = ["/api/session"];

function loginUrl(request: NextRequest, path: string, reason: SessionVerdict | null): URL {
  const url = new URL(loginPathFor(path), request.url);
  const back = path + request.nextUrl.search;
  if (path !== "/") url.searchParams.set("till", back);
  if (reason === "idle") url.searchParams.set("utloggad", "inaktiv");
  if (reason === "max") url.searchParams.set("utloggad", "maxtid");
  return url;
}

function carry(from: NextResponse, to: NextResponse): NextResponse {
  for (const c of from.cookies.getAll()) to.cookies.set(c);
  for (const h of ["cache-control", "expires", "pragma"]) {
    const v = from.headers.get(h);
    if (v) to.headers.set(h, v);
  }
  return to;
}

export async function proxy(request: NextRequest) {
  if (backend() !== "supabase") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (PASS_THROUGH.some((p) => path.startsWith(p))) return NextResponse.next();
  const isApi = path.startsWith("/api/");

  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: { path: "/", sameSite: "lax", httpOnly: true, secure: secureCookies() },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  // Förnyar sessionen vid behov (skriver kakor via setAll). Ogiltigt eller utgånget token = inte inloggad.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  const now = Date.now();
  const mmCookie = { httpOnly: true, sameSite: "lax" as const, secure: secureCookies(), path: "/", maxAge: SESSION_MAX_HOURS * 3600 };

  if (claims) {
    const loginAt = effectiveLoginAt(claims, request.cookies.get(LOGIN_AT_COOKIE)?.value);
    // Senaste aktivitet: bara ett värde som servern själv signerat för den här sessionen räknas (annars "inaktiv").
    const secret = sessionCookieSecret();
    const sessionId = sessionIdFromClaims(claims);
    const lastSeen = await lastSeenFromCookie(secret, sessionId, request.cookies.get(LAST_SEEN_COOKIE)?.value);
    const verdict = sessionVerdict({ now, loginAt, lastSeen });
    if (verdict === "ok") {
      response.cookies.set(LAST_SEEN_COOKIE, await signLastSeen(secret, sessionId, now), mmCookie);
      if (!request.cookies.get(LOGIN_AT_COOKIE) && loginAt) response.cookies.set(LOGIN_AT_COOKIE, String(loginAt), mmCookie);
      return response;
    }
    // Inaktiv för länge eller för länge sedan inloggningen: logga ut (tar bort Supabase-kakorna via setAll).
    await supabase.auth.signOut({ scope: "local" });
    for (const c of MM_SESSION_COOKIES) request.cookies.delete(c);
    let out: NextResponse;
    if (isApi && !SOFT_API.some((p) => path.startsWith(p))) {
      // reason: appen visar varför på inloggningssidan (?utloggad=inaktiv|maxtid) även när sidan inte laddas om.
      out = NextResponse.json({ code: "unauthenticated", message: "Du har loggats ut. Logga in igen.", reason: verdict }, { status: 401 });
    } else if (isApi || isPublicPagePath(path)) {
      out = NextResponse.next({ request });
    } else {
      out = NextResponse.redirect(loginUrl(request, path, verdict));
    }
    carry(response, out);
    for (const c of MM_SESSION_COOKIES) out.cookies.set(c, "", { ...mmCookie, maxAge: 0 });
    return out;
  }

  // Inte inloggad: sidor som kräver inloggning leder till rätt inloggningssida. API:t svarar själv.
  if (!isApi && !isPublicPagePath(path) && request.method === "GET") return carry(response, NextResponse.redirect(loginUrl(request, path, null)));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|css|js|map|txt)$).*)"],
};
