// Serverns datalager. Tills databasplanen är godkänd körs appen i minnesläge (MM_BACKEND=memory) med påhittade testdata.
// SupabaseRepo (Postgres i Stockholm med RLS) kopplas in här efter godkännande – hanterarna ändras inte.
import "server-only";
import { cookies } from "next/headers";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { listPersonas, personaFor, type Persona } from "@/data/actors";

export const BACKEND = process.env.MM_BACKEND ?? "memory";
export const PERSONA_COOKIE = "mm_dev_persona";

const g = globalThis as unknown as { __mmRuntime?: MemoryRuntime };

export function memoryRuntime(): MemoryRuntime {
  if (BACKEND !== "memory") throw new Error("Minnesläget är avstängt");
  return (g.__mmRuntime ??= createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) }));
}

/** Inloggad användare. Minnesläget: vald testperson i en cookie. Produktion: Supabase Auth (efter godkänd plan). */
export async function currentPersona(): Promise<Persona | null> {
  if (BACKEND !== "memory") return null;
  const rt = memoryRuntime();
  const jar = await cookies();
  const v = jar.get(PERSONA_COOKIE)?.value;
  const [userId, role] = (v ?? "").split("|");
  const all = listPersonas(rt.raw());
  return (userId ? personaFor(rt.raw(), userId, role as never) : null) ?? all[0] ?? null;
}
