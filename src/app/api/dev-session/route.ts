// Utvecklingsläge (MM_BACKEND=memory): välj testperson. Finns inte i supabase-läget (testmiljön och produktion).
//   GET                    vald testperson och alla testpersoner
//   POST { userId, role }  byt testperson (verktygsfältet, e2e)
//   POST { email }         simulerad inloggning med e-post och kod: testpersonen med adressen (som prototypen).
//                          Okänd adress: { ok: false } (status 200).
import { cookies } from "next/headers";
import { listPersonas } from "@/data/actors";
import { BACKEND, currentPersona, memoryRuntime, PERSONA_COOKIE } from "@/server/runtime";

export async function GET() {
  if (BACKEND !== "memory") return Response.json({ code: "not_found" }, { status: 404 });
  const persona = await currentPersona();
  return Response.json({ persona, personas: listPersonas(memoryRuntime().raw()) });
}

export async function POST(request: Request) {
  if (BACKEND !== "memory") return Response.json({ code: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { userId?: string; role?: string; email?: string };
  let { userId, role } = body;
  if (!userId && typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    const hit = listPersonas(memoryRuntime().raw()).find((p) => p.user.email.toLowerCase() === email);
    // Okänd adress: 200 med ok=false (som prototypens simulerade inloggning – inget nätverksfel i webbläsaren).
    if (!hit) return Response.json({ ok: false, code: "not_found" });
    userId = hit.actor.userId;
    role = hit.actor.role;
  }
  if (!userId) return Response.json({ code: "invalid_request" }, { status: 400 });
  const jar = await cookies();
  jar.set(PERSONA_COOKIE, `${userId}|${role ?? ""}`, { httpOnly: true, sameSite: "lax", path: "/" });
  return Response.json({ ok: true });
}
