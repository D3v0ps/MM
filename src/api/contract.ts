// Kontrakt för applikationens API: frågor (läser) och kommandon (ändrar).
// Filen är isomorf och liten – gränssnittet importerar bara kontrakten, aldrig hanterarna.
// Samma kontrakt körs av riktiga appen (POST /api/rpc på servern) och av prototypen (i webbläsaren).
import type { z } from "zod";

export type QueryDef<P, R> = { readonly kind: "query"; readonly key: string; readonly schema: z.ZodType<P>; readonly _result?: R };
/**
 * Vilka frågor som räknas om efter ett lyckat kommando (useCommand): prefix på frågornas nycklar ("rost.",
 * "session.navCounts" – de namngivna grupperna finns i src/api/invalidation.ts), "none" (kommandot ändrar inget som visas –
 * bara loggning eller utlämning) eller "all" (bara med motivering i en kommentar: bakgrundsjobb vars följder inte är kända
 * i förväg). Mängden bestäms av vilka tabeller kommandot skriver – inte av vad som råkar vara aktivt på skärmen – eftersom
 * prototypen (staleTime oändlig) aldrig hämtar om en fråga som inte räknas om. Kontroll: src/api/invalidation.test.ts.
 */
export type Invalidates = "all" | "none" | readonly string[];
export type CommandDef<P, R> = {
  readonly kind: "command";
  readonly key: string;
  readonly schema: z.ZodType<P>;
  readonly invalidates: Invalidates;
  readonly _result?: R;
};
export type AnyDef = QueryDef<unknown, unknown> | CommandDef<unknown, unknown>;

export type ParamsOf<D> = D extends QueryDef<infer P, unknown> ? P : D extends CommandDef<infer P, unknown> ? P : never;
export type ResultOf<D> = D extends QueryDef<unknown, infer R> ? R : D extends CommandDef<unknown, infer R> ? R : never;

/**
 * Definiera en fråga. Exempel:
 *   export const inboxList = query("inkorg.list", z.object({ filter: z.enum(["open", "all"]) })).returns<InboxRow[]>();
 * Nyckeln är "<område>.<namn>" och måste vara unik.
 */
export function query<S extends z.ZodType>(key: string, schema: S) {
  return { returns: <R>(): QueryDef<z.output<S>, R> => ({ kind: "query", key, schema: schema as unknown as z.ZodType<z.output<S>> }) };
}
/**
 * Definiera ett kommando. Resultatet är ett värde – affärsfel returneras som { ok: false, error }, inte som undantag.
 * meta.invalidates är obligatoriskt: exakt de frågor kommandot påverkar (prefix, se src/api/invalidation.ts), "none" för
 * kommandon som bara loggar eller lämnar ut, "all" bara med motivering. Ett kommando som räknar om allt hämtar om varje
 * aktiv fråga på sidan i onödan; ett som räknar om för lite lämnar prototypen med inaktuella uppgifter.
 */
export function command<S extends z.ZodType>(key: string, schema: S, meta: { invalidates: Invalidates }) {
  return {
    returns: <R>(): CommandDef<z.output<S>, R> => ({
      kind: "command",
      key,
      schema: schema as unknown as z.ZodType<z.output<S>>,
      invalidates: meta.invalidates,
    }),
  };
}

/** Standardform för kommandoresultat. */
export type Ok<T extends object = object> = { ok: true } & T;
export type Fail<E extends string = string> = { ok: false; error: E; message?: string; fields?: Record<string, string> };
export type Result<T extends object = object, E extends string = string> = Ok<T> | Fail<E>;
export const ok = <T extends object>(v?: T): Ok<T> => ({ ok: true, ...(v ?? ({} as T)) });
export const fail = <E extends string>(error: E, message?: string, fields?: Record<string, string>): Fail<E> => ({ ok: false, error, message, fields });
