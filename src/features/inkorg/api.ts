// Kontrakt för området inkorg (frågor och kommandon). Importeras av skärmar – aldrig hanterarna.
import { z } from "zod";
import { command, type Result } from "@/api/contract";
import { INBOUND_EMAIL_STATUSES } from "@/data/schema";
import { IdSchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)
// Samma beteende och felkoder som prototypens MM.defineAction. Nyckeln är "inkorg.<prototypens namn>".

/** Sätt mejlets status, t.ex. "handled" (prototypens email.setStatus). caseId kopplar mejlet till ett ärende. */
export const emailSetStatus = command("inkorg.emailSetStatus", z.object({
  emailId: IdSchema,
  status: z.enum(INBOUND_EMAIL_STATUSES),
  caseId: IdSchema.optional(),
})).returns<Result<object, "not_found">>();

/**
 * För in en komplettering i ärendet (prototypens email.applySupplement): beställarreferens och planerat slut från
 * kompletteringsmejlet. Det ursprungliga avropsmejlet får de tolkade uppgifterna och saknar dem inte längre.
 */
export const emailApplySupplement = command("inkorg.emailApplySupplement", z.object({
  emailId: IdSchema,
})).returns<Result<{ fields: string[] }, "not_found">>();
