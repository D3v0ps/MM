// Hanterarregister och körning. Isomorf: samma kod körs i Next.js-servern och i prototypen.
// Hanterare får aldrig importera serverspecifika moduler direkt – sådant nås via ctx (t.ex. ctx.notify).
import type { AppRepo } from "@/data/schema";
import type { LocalDateTime } from "@/core/time";
import type { CommandDef, QueryDef } from "./contract";
import type { Actor, Role } from "./roles";

/** Utskick (e-post/SMS/notis i appen). Innehåller aldrig personuppgifter – bara ärendenummer och länk. */
export type OutgoingMessage = {
  channel: "email" | "sms";
  to: string;
  template: string;
  subject?: string;
  body: string;
  caseId?: string | null;
};
export type AuditEntry = {
  action: string;
  entity: string;
  entityId: string | null;
  contractId?: string | null;
  details?: Record<string, unknown>;
};

export type Ctx = {
  actor: Actor;
  /** Stockholms lokala tid. Prototypen har en egen demoklocka. */
  now(): LocalDateTime;
  repo: AppRepo;
  /** Repo utan behörighetsfilter – motsvarar service role. Bara för systemsteg som hanteraren uttryckligen behöver (t.ex. löpnummer, revisionslogg). */
  system: AppRepo;
  newId(prefix: string): string;
  audit(entry: AuditEntry): Promise<void>;
  notify(msg: OutgoingMessage): Promise<void>;
};

type Handler = (ctx: Ctx, input: unknown) => Promise<unknown>;
type Entry = { kind: "query" | "command"; roles?: readonly Role[]; silent?: boolean; run: Handler; schema: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: unknown[] } } } };

const registry = new Map<string, Entry>();

export type HandlerOpts = {
  /** Roller som får anropa. Utelämnas bara när hanteraren själv filtrerar per roll. */
  roles?: readonly Role[];
  /** Kommandon som bara registrerar att något lästs/visats (t.ex. läskvitto, visningslogg). Flyttar inte demoklockan. */
  silent?: boolean;
};

export function handleQuery<P, R>(def: QueryDef<P, R>, opts: HandlerOpts, run: (ctx: Ctx, params: P) => Promise<R> | R) {
  register(def.key, { kind: "query", roles: opts.roles, run: (ctx, p) => Promise.resolve(run(ctx, p as P)), schema: def.schema as never });
}
export function handleCommand<P, R>(def: CommandDef<P, R>, opts: HandlerOpts, run: (ctx: Ctx, payload: P) => Promise<R> | R) {
  register(def.key, { kind: "command", roles: opts.roles, silent: opts.silent, run: (ctx, p) => Promise.resolve(run(ctx, p as P)), schema: def.schema as never });
}
function register(key: string, e: Entry) {
  if (registry.has(key)) throw new Error(`Hanteraren ${key} är redan registrerad`);
  registry.set(key, e);
}

export class ApiError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 500, public readonly code: string, message: string) {
    super(message);
  }
}

/** Kör en fråga eller ett kommando: validera indata (zod), kontrollera roll, kör hanteraren. */
export async function execute(kind: "query" | "command", key: string, input: unknown, ctx: Ctx): Promise<unknown> {
  const e = registry.get(key);
  if (!e || e.kind !== kind) throw new ApiError(404, "unknown_key", `Okänd ${kind === "query" ? "fråga" : "åtgärd"}: ${key}`);
  if (e.roles && !e.roles.includes(ctx.actor.role)) throw new ApiError(403, "forbidden", "Din roll har inte behörighet till det här.");
  const parsed = e.schema.safeParse(input ?? {});
  if (!parsed.success) throw new ApiError(400, "invalid_input", "Ogiltiga uppgifter.");
  return e.run(ctx, parsed.data);
}

export const registeredKeys = () => [...registry.keys()];
export const isSilentCommand = (key: string) => registry.get(key)?.silent === true;
