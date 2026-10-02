// POST /api/auth/logout – logga ut: Supabase-sessionen avslutas, kakorna tas bort och testarens val nollställs.
import { cookies } from "next/headers";
import { BACKEND } from "@/server/runtime";
import { MM_SESSION_COOKIES } from "@/server/session-policy";
import { serviceClient, userClient } from "@/server/supabase";

export async function POST() {
  if (BACKEND !== "supabase") return Response.json({ code: "not_found" }, { status: 404 });
  const jar = await cookies();
  try {
    const user = await userClient();
    const { data } = await user.auth.getClaims();
    const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    if (uid) await serviceClient().from("tester_sessions").delete().eq("auth_user_id", uid);
    await user.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("utloggning", e instanceof Error ? e.name : "okänt");
  }
  // Säkerställ att sessionens kakor är borta även om Supabase inte svarade.
  for (const c of jar.getAll()) if (c.name.startsWith("sb-")) jar.delete(c.name);
  for (const c of MM_SESSION_COOKIES) jar.delete(c);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
