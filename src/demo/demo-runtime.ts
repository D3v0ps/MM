// Prototypens backend: kör samma hanterare som riktiga appen, direkt i webbläsaren, mot påhittade testdata.
// Det man gör sparas som en logg över kommandon i webbläsaren och spelas upp igen vid omladdning (deterministiskt).
import type { Actor } from "@/api/roles";
import type { Backend } from "@/shell/backend";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";

const LOG_KEY = "miljonmatch-prototyp-v2-logg";
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

export type DemoRuntime = {
  rt: MemoryRuntime;
  backend(actor: () => Actor): Backend;
  reset(): void;
};

export async function bootDemo(): Promise<DemoRuntime> {
  const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
  const log = readLog();
  const kept: LogEntry[] = [];
  for (const e of log) {
    try {
      await rt.run("command", e.key, e.input, e.actor);
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
        kept.push({ key, input: payload, actor: a });
        writeLog(kept);
        return res;
      },
    }),
    reset: () => {
      try {
        localStorage.removeItem(LOG_KEY);
      } catch {
        /* ignoreras */
      }
    },
  };
}
