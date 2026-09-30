// Kontrakt: session och diagnos.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { IdSchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

/**
 * Visningslogg (prototypens audit.view, tyst): visning av deltagarkort, rapport och transkript, "visa personnummer"
 * och exporter loggas i revisionsloggen (CLAUDE.md punkt 3). Skicka bara id:n och korta nycklar – aldrig personuppgifter.
 * action t.ex. "case.view", "case.view_denied", "report.view", "transcript.view", "pnr.revealed", "export.audit_log".
 */
export const auditView = command("session.auditView", z.object({
  action: z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/).max(60).optional(),
  entity: z.string().regex(/^[a-z_]+$/).max(40),
  entityId: IdSchema.nullable(),
  details: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
})).returns<Result<object>>();

export const sessionPing = query("session.ping", z.object({})).returns<{ now: string; role: string; userId: string }>();
