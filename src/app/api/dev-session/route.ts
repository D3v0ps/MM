// Utvecklingsläge (MM_BACKEND=memory): välj testperson. Finns inte i supabase-läget (testmiljön och produktion).
//   GET                    vald testperson och alla testpersoner
//   POST { userId, role }  byt testperson (verktygsfältet, e2e)
//   POST { email }         simulerad inloggning med e-post och kod: testpersonen med adressen (som prototypen).
//                          Okänd adress: { ok: false } (status 200).
//   POST { userId, role, testerId }  som ovan, men som en testare i testmiljön (t.ex. "tester-sara" = begränsad testare,
//                          src/api/tester-access.ts). Bara för e2e i minnesläget. En begränsad testare får inte välja ekonom.
import { cookies } from "next/headers";
import { roleHiddenFromTesters, hidesCommercial } from "@/api/tester-access";
import { listPersonas, personaFor } from "@/data/actors";
import { BACKEND, currentPersona, DEV_TESTER_ID, memoryRuntime, PERSONA_COOKIE } from "@/server/runtime";

export async function GET() {
  if (BACKEND !== "memory") return Response.json({ code: "not_found" }, { status: 404 });
  const persona = await currentPersona();
  return Response.json({ persona, personas: listPersonas(memoryRuntime().raw()) });
}

export async function POST(request: Request) {
  if (BACKEND !== "memory") return Response.json({ code: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { userId?: string; role?: string; email?: string; testerId?: unknown };
  let { userId, role } = body;
  const testerId = typeof body.testerId === "string" && DEV_TESTER_ID.test(body.testerId) ? body.testerId : null;
  if (body.testerId !== undefined && !testerId) return Response.json({ code: "invalid_request" }, { status: 400 });
  if (!userId && typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    const hit = listPersonas(memoryRuntime().raw()).find((p) => p.user.email.toLowerCase() === email);
    // Okänd adress: 200 med ok=false (som prototypens simulerade inloggning – inget nätverksfel i webbläsaren).
    if (!hit) return Response.json({ ok: false, code: "not_found" });
    userId = hit.actor.userId;
    role = hit.actor.role;
  }
  if (!userId) return Response.json({ code: "invalid_request" }, { status: 400 });
  // Samma regel som "Agera som" i testmiljön (mayImpersonate): en begränsad testare får inte välja rollen ekonom. Kontrollen
  // gäller testpersonen som kakan faktiskt ger (samma uppslag som currentPersona) – inte bara rollen som skickades in, så att
  // en tom eller annorlunda stavad roll inte ger ekonom.
  if (testerId && hidesCommercial({ testerId })) {
    const raw = memoryRuntime().raw();
    const persona = personaFor(raw, userId, (role || undefined) as never) ?? listPersonas(raw)[0] ?? null;
    if (!persona || roleHiddenFromTesters(persona.actor.role) || (role && roleHiddenFromTesters(role))) return Response.json({ code: "invalid_request" }, { status: 400 });
  }
  const jar = await cookies();
  jar.set(PERSONA_COOKIE, `${userId}|${role ?? ""}${testerId ? `|${testerId}` : ""}`, { httpOnly: true, sameSite: "lax", path: "/" });
  return Response.json({ ok: true });
}
