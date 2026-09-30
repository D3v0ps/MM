// POST /api/dev-session/reset – bara i minnesläget (MM_BACKEND=memory: utveckling och e2e). Börjar om med samma påhittade
// testdata som prototypen och demoklockan på måndag 1 februari 2027 kl. 09.12, så att varje e2e-test startar likadant.
// Vald testperson (kakan) behålls. Finns inte i supabase-läget (testmiljön och produktion) – där läser testaren in
// testdatat på nytt i adminvyn (POST /api/staging/seed).
import { BACKEND, resetMemoryRuntime } from "@/server/runtime";

export async function POST() {
  if (BACKEND !== "memory") return Response.json({ code: "not_found" }, { status: 404 });
  const rt = resetMemoryRuntime();
  return Response.json({ ok: true, now: rt.clock.now() }, { headers: { "cache-control": "no-store" } });
}
