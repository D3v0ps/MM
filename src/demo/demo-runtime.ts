// Prototypens backend: kör samma hanterare som riktiga appen, direkt i webbläsaren, mot påhittade testdata.
// Det man gör sparas som en logg över kommandon i webbläsaren och spelas upp igen vid omladdning (deterministiskt).
// AI och röstinspelning är simulerade (ctx.ai: createSimulatedAi, ctx.audio: ljud i minnet): inga anrop utanför webbläsaren
// och ingen mikrofon krävs – en inspelning kan simuleras. Riktigt ljud som läggs i minnet (rt.audio.put) sparas inte i
// loggen; vid omladdning spelas kommandona upp utan ljudet, och den simulerade AI:n ger samma svar ändå.
// Bilagor (beslut 2026-10-07): filens innehåll (contentBase64) sparas inte heller i loggen – efter omladdning finns filen
// kvar med namn och storlek, och "Hämta" ger en textfil som säger att innehållet bara fanns i webbläsarens minne. En fil som
// avvisades (fel filsignatur eller storlek – kommandot svarade ok: false) loggas med en ersättning som avvisas på samma sätt
// (REJECTED_CONTENT), så att den inte kommer tillbaka som en godkänd fil efter omladdning (granskningen 2026-10-29).
// Självregistreringen (en ny adress på kommunens domän) loggas som en egen rad (SELF_REGISTER) och spelas upp på samma sätt.
import type { Actor } from "@/api/roles";
import { base64ToBytes } from "@/core/export/base64";
import type { Backend } from "@/shell/backend";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import type { SelfRegisterResult } from "@/features/session/self-register";

const LOG_KEY = "miljonmatch-prototyp-v2-logg";
/** Loggraden för en självregistrering (inte ett kommando). input = { email }. */
const SELF_REGISTER = "__session.selfRegister";
type LogEntry = { key: string; input: unknown; actor: Actor };

function readLog(): LogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as LogEntry[];
  } catch {
    return [];
  }
}
function writeLog(log: LogEntry[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    // Privat läge eller full lagring: prototypen fungerar ändå, men ändringarna sparas inte.
  }
}

/**
 * Ersättningen för innehållet i en avvisad fil: en enda nollbyte (base64). Den stämmer aldrig med någon filsignatur
 * (signatureMatches), så uppspelningen avvisar filen igen – raden blir raderad och loggen får attachment.rejected, som när det hände.
 */
export const REJECTED_CONTENT = "AA==";
/** Ersättningen när innehållet inte ens var giltig base64: inte heller ersättningen går att läsa, så utfallet blir detsamma. */
export const UNREADABLE_CONTENT = "!";

/**
 * Kommandots indata i loggen: utan filinnehåll (bilagor och deltagarfiler) – det kan vara flera megabyte och sparas bara i
 * minnet. Utan innehåll godtar minnesporten filen vid uppspelningen. Svarade kommandot ok: false (filen avvisades) loggas i
 * stället REJECTED_CONTENT, så att uppspelningen ger samma utfall.
 */
export function forLog(payload: unknown, result?: unknown): unknown {
  if (!payload || typeof payload !== "object" || !("contentBase64" in payload)) return payload;
  const rest = { ...(payload as Record<string, unknown>) };
  delete rest.contentBase64;
  const failed = !!result && typeof result === "object" && (result as { ok?: unknown }).ok === false;
  const content = (payload as { contentBase64?: unknown }).contentBase64;
  if (failed && typeof content === "string" && content) {
    let readable = true;
    try {
      base64ToBytes(content);
    } catch {
      readable = false;
    }
    rest.contentBase64 = readable ? REJECTED_CONTENT : UNREADABLE_CONTENT;
  }
  return rest;
}

export type DemoRuntime = {
  rt: MemoryRuntime;
  backend(actor: () => Actor): Backend;
  /** Skapa ett konto som kommunens handläggare för en ny adress på avtalets kommundomän (loggas och spelas upp). */
  selfRegister(email: string, actor: Actor): Promise<SelfRegisterResult>;
  reset(): void;
};

export async function bootDemo(): Promise<DemoRuntime> {
  const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START), ai: createSimulatedAi() });
  const log = readLog();
  const kept: LogEntry[] = [];
  for (const e of log) {
    try {
      if (e.key === SELF_REGISTER) {
        const res = await rt.selfRegister(String((e.input as { email?: unknown })?.email ?? ""));
        if (!res.ok) continue;
      } else await rt.run("command", e.key, e.input, e.actor);
      kept.push(e);
    } catch {
      // Ett kommando som inte längre går att spela upp (t.ex. efter en ny version av prototypen) hoppas över.
    }
  }
  if (kept.length !== log.length) writeLog(kept);
  return {
    rt,
    backend: (actor) => ({
      mode: "demo",
      query: (key, params) => rt.run("query", key, params, actor()),
      command: async (key, payload) => {
        const a = actor();
        const res = await rt.run("command", key, payload, a);
        kept.push({ key, input: forLog(payload, res), actor: a });
        writeLog(kept);
        return res;
      },
    }),
    selfRegister: async (email, actor) => {
      const res = await rt.selfRegister(email);
      if (res.ok) {
        kept.push({ key: SELF_REGISTER, input: { email }, actor });
        writeLog(kept);
      }
      return res;
    },
    reset: () => {
      try {
        localStorage.removeItem(LOG_KEY);
      } catch {
        /* ignoreras */
      }
    },
  };
}
