// Utvecklingsläge (MM_BACKEND=memory): välj testperson. Finns inte i supabase-läget (testmiljön och produktion).
//   GET                    vald testperson och alla testpersoner
//   POST { userId, role? } byt testperson (verktygsfältet, e2e). Testpersonen har alla sina roller samtidigt (Karims beslut 7,
//                          2026-10-09) – rollen väljer inget, men anges den måste personen ha den.
//   POST { email }         simulerad inloggning med e-post och kod: testpersonen med adressen (som prototypen). En adress på
//                          avtalets kommundomän utan konto får ett nytt konto som kommunens handläggare (självregistrering,
//                          beslut 2026-10-07) – svaret säger { ok: true, created: true }. Annan adress eller spärrat konto:
//                          { ok: false } (status 200).
//   POST { userId, role?, testerId }  som ovan, men som en testare i testmiljön (t.ex. "tester-sara" = begränsad testare,
//                          src/api/tester-access.ts). Bara för e2e i minnesläget. En begränsad testare får inte välja en
//                          testperson med rollen ekonom.
import { cookies } from "next/headers";
import { ROLES, type Role } from "@/api/roles";
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
  let { userId } = body;
  const role = body.role || undefined;
  if (role !== undefined && !(ROLES as readonly string[]).includes(role)) return Response.json({ code: "invalid_request" }, { status: 400 });
  const testerId = typeof body.testerId === "string" && DEV_TESTER_ID.test(body.testerId) ? body.testerId : null;
  if (body.testerId !== undefined && !testerId) return Response.json({ code: "invalid_request" }, { status: 400 });
  if (!userId && typeof body.email === "string") {
    const email = body.email.trim().toLowerCase();
    const hit = listPersonas(memoryRuntime().raw()).find((p) => p.user.email.toLowerCase() === email);
    if (hit) {
      userId = hit.actor.userId;
    } else {
      // Ingen testperson med adressen: självregistrering om adressen är på avtalets kommundomän och saknar konto.
      const created = await memoryRuntime().selfRegister(email);
      // Okänd adress eller spärrat konto: 200 med ok=false (som prototypens simulerade inloggning – inget nätverksfel).
      if (!created.ok) return Response.json({ ok: false, code: "not_found" });
      const jar = await cookies();
      jar.set(PERSONA_COOKIE, `${created.profileId}|kommun_handlaggare`, { httpOnly: true, sameSite: "lax", path: "/" });
      return Response.json({ ok: true, created: true });
    }
  }
  if (!userId) return Response.json({ code: "invalid_request" }, { status: 400 });
  const raw = memoryRuntime().raw();
  // Anges en roll måste testpersonen ha den (e2e som väljer "Sara som samordnare" får aldrig någon annan).
  if (role && !personaFor(raw, userId)?.actor.roles.includes(role as Role)) return Response.json({ code: "invalid_request" }, { status: 400 });
  // Samma regel som "Agera som" i testmiljön (mayImpersonate): en begränsad testare får inte välja en testperson med rollen
  // ekonom. Kontrollen gäller testpersonen som kakan faktiskt ger (samma uppslag som currentPersona).
  if (testerId && hidesCommercial({ testerId })) {
    const persona = personaFor(raw, userId) ?? listPersonas(raw)[0] ?? null;
    if (!persona || persona.actor.roles.some(roleHiddenFromTesters)) return Response.json({ code: "invalid_request" }, { status: 400 });
  }
  const jar = await cookies();
  jar.set(PERSONA_COOKIE, `${userId}|${testerId ? `|${testerId}` : ""}`, { httpOnly: true, sameSite: "lax", path: "/" });
  return Response.json({ ok: true });
}
