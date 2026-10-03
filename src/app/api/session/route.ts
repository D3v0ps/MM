// GET /api/session – vem är inloggad? { authenticated, persona, isTester, personas, environment }.
// Minnesläget: vald testperson (som /api/dev-session). Supabase-läget: inloggningen, och testarens val i testmiljön.
import { hidesCommercial } from "@/api/tester-access";
import { listPersonas } from "@/data/actors";
import { personaOptionsFor, toOption } from "@/server/identity";
import { liveSession } from "@/server/live";
import { memorySessionView } from "@/server/memory-session-view";
import { BACKEND, currentPersona, memoryRuntime } from "@/server/runtime";
import type { SessionView } from "@/server/session-view";

const noStore = { "cache-control": "no-store" };

export async function GET() {
  if (BACKEND !== "supabase") {
    const persona = await currentPersona();
    // Minnesläget: en simulerad testare (e2e, /api/dev-session med testerId) får samma lista som i testmiljön och räknas
    // som testare (synpunkterna och raden Testmiljö visas) – src/server/memory-session-view.ts.
    const view = memorySessionView(persona, personaOptionsFor(listPersonas(memoryRuntime().raw()).map(toOption), persona?.actor));
    return Response.json(view, { headers: noStore });
  }
  try {
    const s = await liveSession();
    const id = s.identity;
    const view: SessionView = {
      backend: "supabase",
      environment: s.settings.environment,
      authenticated: !!id,
      persona: id ? { actor: id.persona.actor, user: id.persona.user } : undefined,
      selfName: id?.impersonating ? id.self.fullName : undefined,
      isTester: !!id?.isTester,
      impersonating: !!id?.impersonating,
      personas: id?.personas ?? [],
      testNow: s.settings.clock.mode === "test" ? s.now : null,
      hidesCommercial: hidesCommercial(id?.persona.actor),
    };
    return Response.json(view, { headers: noStore });
  } catch (e) {
    console.error("session-fel", e instanceof Error ? e.name : "okänt");
    return Response.json({ code: "server_error", message: "Inloggningen kunde inte hämtas." }, { status: 500, headers: noStore });
  }
}
