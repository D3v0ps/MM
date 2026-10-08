// Kontrakt: session och diagnos.
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import { LOG } from "@/api/invalidation";
import { ROLES, type Role } from "@/api/roles";
import { IdSchema } from "../_shared/schemas";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

/**
 * Visningshändelser som webbläsaren får logga, och vilket slags objekt var och en gäller. Allt annat i revisionsloggen
 * (ändringar, "visa personnummer", AI-körningar, inloggning …) skrivs bara av sina egna hanterare.
 */
export const VIEW_EVENTS = {
  "case.view": "case",
  "case.view_denied": "case",
  "report.view": "report",
  "transcript.view": "check_in",
  "export.audit_log": "audit_log",
  "export.contract_deviations": "contract_deviation",
} as const;
export type ViewEvent = keyof typeof VIEW_EVENTS;

/**
 * Visningslogg (prototypens audit.view, tyst): visning av deltagarkort, rapport och transkript samt exporter loggas i
 * revisionsloggen (CLAUDE.md punkt 3). Bara händelserna i VIEW_EVENTS, bara objekt som aktören får se, och bara kända
 * detaljer (antal rader, filter och månad för exporter) – aldrig fri text om deltagare.
 */
export const auditView = command("session.auditView", z.object({
  action: z.enum(Object.keys(VIEW_EVENTS) as [ViewEvent, ...ViewEvent[]]),
  entity: z.string().regex(/^[a-z_]+$/).max(40),
  entityId: IdSchema.nullable(),
  details: z.object({
    rows: z.number().int().min(0).optional(),
    filter: z.string().max(200).optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  }).strict().optional(),
}), { invalidates: "none" }).returns<Result<object>>();

export const sessionPing = query("session.ping", z.object({})).returns<{ now: string; role: string; userId: string }>();

/**
 * Rollväxling för egna roller (beslut 2026-10-08, migration 0027): en användare med flera medlemskap väljer roll i sidopanelens
 * huvud. Valet sparas i role_choices (bara den egna raden) och styr rollen vid nästa anrop – sidan laddas om efteråt, så alla
 * frågor hämtas på nytt; här räknas bara loggen om. Revisionsloggen får role.switched (bara id och roll).
 */
export const switchRole = command("session.vaxlaRoll", z.object({ role: z.enum(ROLES) }), { invalidates: [...LOG] }).returns<Result<{ role: Role }, "no_membership" | "unchanged">>();
