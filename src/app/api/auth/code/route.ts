// POST /api/auth/code { email } – skicka en sexsiffrig inloggningskod (SPEC §4). Svarar alltid likadant, oavsett om
// adressen finns, så att ingen kan pröva fram vilka adresser som har konto. Bara i supabase-läget.
import { after } from "next/server";
import { clientIp } from "@/server/auth/rate-limit";
import { requestCode } from "@/server/auth/service";
import { BACKEND } from "@/server/runtime";

export async function POST(request: Request) {
  if (BACKEND !== "supabase") return Response.json({ code: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  try {
    const res = await requestCode(body?.email, clientIp(request.headers), (fn) => after(fn));
    return Response.json(res.body, { status: res.status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("inloggning", "kod", e instanceof Error ? e.name : "okänt");
    return Response.json({ ok: false, error: "error", message: "Något gick fel. Försök igen om en stund." }, { status: 500 });
  }
}
