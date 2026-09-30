// Kontrakt för området ledning (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, type Result } from "@/api/contract";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

/**
 * Kvittera en flagga med en kort åtgärdsplan (prototypens alert.ack). key = flaggans stabila nyckel, t.ex.
 * "stuck:case-260143:3". Planen sparas i revisionsloggen. En ny kvittering ersätter den tidigare.
 */
export const alertAck = command("ledning.alertAck", z.object({
  key: z.string().min(1).max(200),
  plan: z.string().trim().min(1).max(2000),
})).returns<Result<object>>();
