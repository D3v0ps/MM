// POST /api/auth/verify { email, code } – logga in med koden. Supabase-sessionen sparas i httpOnly-kakor och
// sessionens tider (mm_login_at, mm_last_seen) sätts för proxy.ts (60 minuters inaktivitet, högst 12 timmar).
import { cookies } from "next/headers";
import { after } from "next/server";
import { clientIp } from "@/server/auth/rate-limit";
import { verifyCode } from "@/server/auth/service";
import { secureCookies } from "@/server/config";
import { BACKEND } from "@/server/runtime";
import { LAST_SEEN_COOKIE, LOGIN_AT_COOKIE, SESSION_MAX_HOURS } from "@/server/session-policy";
import { userClient } from "@/server/supabase";

export async function POST(request: Request) {
  if (BACKEND !== "supabase") return Response.json({ code: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
  try {
    const user = await userClient();
    const res = await verifyCode(user, body?.email, body?.code, clientIp(request.headers), (fn) => after(fn));
    if (res.body.ok) {
      const jar = await cookies();
      const now = String(Date.now());
      const opts = { httpOnly: true, sameSite: "lax" as const, secure: secureCookies(), path: "/", maxAge: SESSION_MAX_HOURS * 3600 };
      jar.set(LOGIN_AT_COOKIE, now, opts);
      jar.set(LAST_SEEN_COOKIE, now, opts);
    }
    return Response.json(res.body, { status: res.status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("inloggning", "verifiera", e instanceof Error ? e.name : "okänt");
    return Response.json({ ok: false, error: "error", message: "Något gick fel. Försök igen om en stund." }, { status: 500 });
  }
}
