// Kontrakt för området notiser (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, type Result } from "@/api/contract";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

/**
 * Markera personliga notiser som lästa (prototypens notif.read, tyst). Gäller både sparade notiser (user_notifications.id)
 * och beräknade (t.ex. "nprog:case-1:2027-W04"). Bara den inloggades egna läsmarkeringar ändras.
 */
export const notifRead = command("notiser.notifRead", z.object({
  ids: z.array(z.string().min(1).max(200)).max(500),
})).returns<Result<{ marked: number }>>();
