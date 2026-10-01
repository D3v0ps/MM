// Kontrakt för synpunkter i testmiljön ("Lämna synpunkt", beslut 2026-10-01). Bara inloggade testare i testmiljön
// (Actor.testerId – servern sätter det bara när databasen säger mm.auth_is_tester()). I produktion, i minnesläget och i
// prototypen finns funktionen inte: hanterarna svarar 404 och RLS släpper inte igenom något. Prototypen har kvar sin egen
// feedback i claude.ai (src/demo/feedback-store.ts) med samma modell och samma texter (model.ts).
//
//   feedback.list       alla synpunkter med svar (nyast först, efter riktig tid) – för listan "Alla synpunkter" och CSV-exporten
//   feedback.submit     ny synpunkt: typ, prioritet, text och sidan (bara sökväg och id:n). Rollen tas från aktören.
//   feedback.reply      svar på en synpunkt
//   feedback.setStatus  ändra status (Ny, Att diskutera, Ska ändras, Klar, Avfärdad)
//
// Inga utskick. Revisionslogg: feedback.created, feedback.replied, feedback.status_changed (bara id:n, aldrig text).
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { Perspective, Role } from "@/api/roles";
import type { LocalDateTime } from "@/core/time";
import { IdSchema } from "@/features/_shared/schemas";
import { FEEDBACK_PRIORITIES, FEEDBACK_REPLY_MAX, FEEDBACK_STATUSES, FEEDBACK_TEXT_MAX, FEEDBACK_TYPES, type FeedbackPriority, type FeedbackStatus, type FeedbackType } from "./model";

export type FeedbackReplyView = {
  id: string;
  text: string;
  /** Testtiden. */
  createdAt: LocalDateTime;
  /** Riktig tid (sätts av databasen). Null i minnesläget. */
  submittedAt: LocalDateTime | null;
  /** Hela namnet (även för den inloggade – CSV-filen delas med andra). */
  authorName: string;
  /** Skrivet av den inloggade testaren (dialogen visar "Du"). */
  mine: boolean;
};

export type FeedbackView = {
  id: string;
  type: FeedbackType;
  priority: FeedbackPriority;
  text: string;
  status: FeedbackStatus;
  /** Rollen testaren agerade som. */
  role: Role;
  roleLabel: string;
  perspective: Perspective;
  /** Leverantörens, kundens eller deltagarens perspektiv (samma etiketter som prototypen). */
  perspectiveLabel: string;
  /** Sidan (bara sökväg och id:n), null = hela Miljonmatch. */
  path: string | null;
  viewTitle: string | null;
  /** Testtiden (testklockan i testmiljön). */
  createdAt: LocalDateTime;
  /** Riktig tid när synpunkten sparades (sätts av databasen). Null i minnesläget. */
  submittedAt: LocalDateTime | null;
  /** Hela namnet (även för den inloggade – CSV-filen delas med andra). */
  authorName: string;
  /** Lämnad av den inloggade testaren (dialogen visar "Du"). */
  mine: boolean;
  replies: FeedbackReplyView[];
};

export const feedbackList = query("feedback.list", z.object({})).returns<FeedbackView[]>();

export const FeedbackSubmitSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  priority: z.enum(FEEDBACK_PRIORITIES),
  text: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX),
  /** Sidan som synpunkten gäller (rensas igen av hanteraren). Null = hela Miljonmatch. */
  path: z.string().max(2000).nullable(),
  viewTitle: z.string().max(400).nullable(),
});
export type FeedbackSubmitInput = z.input<typeof FeedbackSubmitSchema>;
export const feedbackSubmit = command("feedback.submit", FeedbackSubmitSchema).returns<Result<{ id: string }>>();

export const feedbackReply = command("feedback.reply", z.object({ feedbackId: IdSchema, text: z.string().trim().min(1).max(FEEDBACK_REPLY_MAX) })).returns<
  Result<{ id: string }, "not_found">
>();

export const feedbackSetStatus = command("feedback.setStatus", z.object({ feedbackId: IdSchema, status: z.enum(FEEDBACK_STATUSES) })).returns<
  Result<object, "not_found">
>();

/**
 * Synpunkterna bakom ett gränssnitt i sessionen (som reloadTestData): finns bara för testare i testmiljön
 * (session.feedback, src/app/_shell/client-root.tsx). Riktiga appen: kommandona ovan via /api/rpc.
 */
export type FeedbackPort = {
  list(): Promise<FeedbackView[]>;
  submit(input: FeedbackSubmitInput): Promise<Result<{ id: string }>>;
  reply(input: { feedbackId: string; text: string }): Promise<Result<{ id: string }, "not_found">>;
  setStatus(input: { feedbackId: string; status: FeedbackStatus }): Promise<Result<object, "not_found">>;
};

/** Porten mot API:t (query/command i backend – /api/rpc i riktiga appen, minnet i tester). */
export function feedbackPortOf(b: { query(key: string, params: unknown): Promise<unknown>; command(key: string, params: unknown): Promise<unknown> }): FeedbackPort {
  return {
    list: () => b.query(feedbackList.key, {}) as Promise<FeedbackView[]>,
    submit: (input) => b.command(feedbackSubmit.key, input) as Promise<Result<{ id: string }>>,
    reply: (input) => b.command(feedbackReply.key, input) as Promise<Result<{ id: string }, "not_found">>,
    setStatus: (input) => b.command(feedbackSetStatus.key, input) as Promise<Result<object, "not_found">>,
  };
}
