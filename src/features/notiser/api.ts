// Kontrakt för området notiser (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
// Skärm: /notiser (prototypens vy notiser, prototyp/src/05-notiser.js).
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { AppNotifyChannel } from "@/core/config";
import type { UserNotificationKind } from "@/data/schema";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

/**
 * Markera personliga notiser som lästa (prototypens notif.read, tyst). Gäller både sparade notiser (user_notifications.id)
 * och beräknade (t.ex. "nprog:case-1:2027-W04"). Bara den inloggades egna läsmarkeringar ändras.
 */
export const notifRead = command("notiser.notifRead", z.object({
  ids: z.array(z.string().min(1).max(200)).max(500),
})).returns<Result<{ marked: number }>>();

// ================================================================ Notiser (/notiser)
//
// Frågor (all MB-personal):
//   notiser.list -> NotifList   den inloggades egna notiser (tilldelning, påminnelse, eskalering, meddelande), nyast först.
// Varje notis har exakt en mottagare. Eskaleringar räknas bara fram för rollerna i de interna reglerna (escalateTo) –
// coachen och handledaren får aldrig veta att ett ärende eskalerats till chefen.

export type NotifView = {
  id: string;
  kind: UserNotificationKind;
  title: string;
  body: string;
  /** E-postens text – aldrig personuppgifter, bara ärendenummer och "logga in". */
  emailBody: string;
  channels: AppNotifyChannel[];
  createdAt: string;
  readAt: string | null;
  /** Ärendet som notisen gäller (bara id – sökvägen byggs av skärmen). */
  caseId: string | null;
};

export type NotifList = {
  items: NotifView[];
  /** Rollen får påminnelser (huvudcoach) – visar förklaringen "Så fungerar påminnelserna". */
  isCoach: boolean;
  /** Rollen får eskaleringar enligt de interna reglerna (chef/controller). */
  isEscalationRole: boolean;
  /** Admin ser regeln i adminvyn (texten i prototypens förklaring). */
  isAdmin: boolean;
  reminderSchedule: string;
  escalateAfterWeeks: number;
};
export const notifList = query("notiser.list", z.object({})).returns<NotifList>();
