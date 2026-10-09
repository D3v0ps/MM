// Serverns körläge. Samma hanterare i båda – bara datalagret, klockan och inloggningen skiljer:
//   MM_BACKEND=memory    (standard) prototypens påhittade testdata i minnet, välj testperson i verktygsfältet
//     MM_SEED=empty      tomt testdata: bara avtalet, konfigurationen och de sju kollegorna, riktig tid (beslut 2026-10-08)
//   MM_BACKEND=supabase  Postgres i Stockholm med RLS, inloggning med e-postkod (src/server/live.ts)
import "server-only";
import { cookies } from "next/headers";
import { ApiError } from "@/api/server";
import { createMemoryRuntime, demoClock, realClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { createEmptySeed } from "@/data/seed/empty";
import { listPersonas, personaFor, type Persona } from "@/data/actors";
import { backend, seedMode } from "./config";
import { runLive } from "./live";

export const BACKEND = backend();
export const SEED_MODE = seedMode();
export const PERSONA_COOKIE = "mm_dev_persona";

const g = globalThis as unknown as { __mmRuntime?: MemoryRuntime };

/** Tomt testdata har inga rapporter att skapa i efterhand: rapportutkasten räknas från starten (riktig tid). */
const freshRuntime = (): MemoryRuntime =>
  SEED_MODE === "empty"
    ? createMemoryRuntime({ data: createEmptySeed(), clock: realClock() })
    : createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });

export function memoryRuntime(): MemoryRuntime {
  if (BACKEND !== "memory") throw new Error("Minnesläget är avstängt");
  return (g.__mmRuntime ??= freshRuntime());
}

/** Minnesläget: börja om med nytt testdata och demoklockan på DEMO_START (POST /api/dev-session/reset, e2e). */
export function resetMemoryRuntime(): MemoryRuntime {
  if (BACKEND !== "memory") throw new Error("Minnesläget är avstängt");
  return (g.__mmRuntime = freshRuntime());
}

/** Testarens id i minneslägets kaka: bara bokstäver, siffror och bindestreck (som profilernas id). */
export const DEV_TESTER_ID = /^[a-z0-9-]{1,60}$/;

/**
 * Minnesläget: vald testperson i en kaka (utvecklingsläget). Null i supabase-läget – där gäller inloggningen.
 * Kakan är "userId|role" eller "userId|role|testerId": med testerId simuleras en testare i testmiljön (e2e för
 * src/api/tester-access.ts). Utan testerId är minnesläget oförändrat.
 */
export async function currentPersona(): Promise<Persona | null> {
  if (BACKEND !== "memory") return null;
  const rt = memoryRuntime();
  const jar = await cookies();
  const v = jar.get(PERSONA_COOKIE)?.value;
  const [userId, role, testerId] = (v ?? "").split("|");
  const all = listPersonas(rt.raw());
  // Tom roll i kakan (POST /api/dev-session utan roll): den valda rollen (role_choices), annars medlemskapet med lägst id.
  const persona = (userId ? personaFor(rt.raw(), userId, (role || undefined) as never) : null) ?? all[0] ?? null;
  if (!persona || !testerId || !DEV_TESTER_ID.test(testerId)) return persona;
  return { ...persona, actor: { ...persona.actor, testerId } };
}

/** Kör en fråga eller ett kommando i rätt körläge. Kastar ApiError (status + text till användaren) vid fel. */
export async function runRpc(kind: "query" | "command", key: string, input: unknown): Promise<unknown> {
  if (BACKEND === "supabase") return runLive(kind, key, input);
  const persona = await currentPersona();
  if (!persona) throw new ApiError(403, "unauthenticated", "Du är inte inloggad.");
  return memoryRuntime().run(kind, key, input, persona.actor);
}
