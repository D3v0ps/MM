// Serverns körläge. Samma hanterare i båda – bara datalagret, klockan och inloggningen skiljer:
//   MM_BACKEND=memory    (standard) prototypens påhittade testdata i minnet, välj testperson i verktygsfältet
//   MM_BACKEND=supabase  Postgres i Stockholm med RLS, inloggning med e-postkod (src/server/live.ts)
import "server-only";
import { cookies } from "next/headers";
import { ApiError } from "@/api/server";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { listPersonas, personaFor, type Persona } from "@/data/actors";
import { backend } from "./config";
import { runLive } from "./live";

export const BACKEND = backend();
export const PERSONA_COOKIE = "mm_dev_persona";

const g = globalThis as unknown as { __mmRuntime?: MemoryRuntime };

const freshRuntime = (): MemoryRuntime => createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });

export function memoryRuntime(): MemoryRuntime {
  if (BACKEND !== "memory") throw new Error("Minnesläget är avstängt");
  return (g.__mmRuntime ??= freshRuntime());
}

/** Minnesläget: börja om med nytt testdata och demoklockan på DEMO_START (POST /api/dev-session/reset, e2e). */
export function resetMemoryRuntime(): MemoryRuntime {
  if (BACKEND !== "memory") throw new Error("Minnesläget är avstängt");
  return (g.__mmRuntime = freshRuntime());
}

/** Minnesläget: vald testperson i en kaka (utvecklingsläget). Null i supabase-läget – där gäller inloggningen. */
export async function currentPersona(): Promise<Persona | null> {
  if (BACKEND !== "memory") return null;
  const rt = memoryRuntime();
  const jar = await cookies();
  const v = jar.get(PERSONA_COOKIE)?.value;
  const [userId, role] = (v ?? "").split("|");
  const all = listPersonas(rt.raw());
  return (userId ? personaFor(rt.raw(), userId, role as never) : null) ?? all[0] ?? null;
}

/** Kör en fråga eller ett kommando i rätt körläge. Kastar ApiError (status + text till användaren) vid fel. */
export async function runRpc(kind: "query" | "command", key: string, input: unknown): Promise<unknown> {
  if (BACKEND === "supabase") return runLive(kind, key, input);
  const persona = await currentPersona();
  if (!persona) throw new ApiError(403, "unauthenticated", "Du är inte inloggad.");
  return memoryRuntime().run(kind, key, input, persona.actor);
}
