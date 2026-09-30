// Fel i bakgrundsjobb. Felorsaken sparas i jobs.last_error (och outbound_messages.status_reason) och får därför aldrig
// innehålla personuppgifter: JobError skrivs alltid med fasta texter, andra fel sparas bara som feltyp.
import { PolicyError } from "@/data/repo";
import { DataError } from "@/data/supabase/repo";

export class JobError extends Error {
  /** true = värt att försöka igen senare (nätverk, 429, 5xx). false = försök inte igen. */
  readonly retryable: boolean;
  constructor(message: string, opts: { retryable: boolean }) {
    super(message);
    this.name = "JobError";
    this.retryable = opts.retryable;
  }
}

/** Felorsak att spara: JobError och DataError (bara tabell och felkod) som de är, annars bara feltypen. */
export function safeErrorText(e: unknown): string {
  if (e instanceof JobError) return e.message.slice(0, 500);
  if (e instanceof DataError) return e.message.slice(0, 500);
  if (e instanceof PolicyError) return "Behörighet saknas i databasen";
  return `Oväntat fel (${e instanceof Error ? e.name || "Error" : typeof e})`;
}

/** Ska jobbet försökas igen? Okända fel försöks igen (tills max antal försök). */
export const isRetryable = (e: unknown): boolean => !(e instanceof JobError) || e.retryable;
