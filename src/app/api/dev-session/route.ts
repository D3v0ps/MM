// Utvecklingsläge (MM_BACKEND=memory): välj testperson. Finns inte i produktion.
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
  const { userId, role } = (await request.json().catch(() => ({}))) as { userId?: string; role?: string };
  if (!userId) return Response.json({ code: "invalid_request" }, { status: 400 });
  const jar = await cookies();
  jar.set(PERSONA_COOKIE, `${userId}|${role ?? ""}`, { httpOnly: true, sameSite: "lax", path: "/" });
  return Response.json({ ok: true });
}
