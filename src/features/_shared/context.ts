// Hjälpare för hanterarna i de delade kommandona (utskick, notiser, uppgifter, avtalets konfiguration).
// Bara för hanterare – importeras aldrig av skärmar. Texterna är exakt den gamla prototypens (prototyp/src/03-domain.js).
import type { Role } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { DEFAULT_ORG_SETTINGS, requireOperational, type OperationalConfig, type OrgSettings } from "@/core/config";
import { areaName, teamLabel } from "@/core/labels";
import { fmtDateTime, type LocalDateTime } from "@/core/time";
import type { Table } from "@/data/repo";
import type { Case, Contract, Deviation, TeamRole } from "@/data/schema";
import { caseAccessAsRoles, type AccessCase } from "./case-access";
import { notifyParticipant, type NotifyParticipantResult } from "./participant-notify";

// ---------------------------------------------------------------- Avtal och regler
/** Avtalet och dess driftkonfiguration (validerad). Ärendet är redan läst via ctx.repo, så avtalet är användarens. */
export async function contractOf(ctx: Ctx, contractId: string): Promise<{ contract: Contract; cfg: OperationalConfig }> {
  const contract = await ctx.repo.table("contracts").get(contractId);
  if (!contract) throw new Error(`Avtalet ${contractId} saknas eller är inte tillgängligt`);
  return { contract, cfg: requireOperational(contract.config) };
}

/**
 * Miljonbemannings interna regler (org_settings) för avtalets leverantör.
 * ctx.system: reglerna styr systemsteg (notiser vid tilldelning) och ska gälla oavsett vem som gör ändringen.
 */
export async function orgSettingsFor(ctx: Ctx, contract: Pick<Contract, "supplierId">): Promise<OrgSettings> {
  const row = await ctx.system.table("org_settings").first({ organizationId: contract.supplierId });
  return row?.settings ?? DEFAULT_ORG_SETTINGS;
}

/** "G Lager och logistik" för ärendets primära område. */
export async function caseAreaName(ctx: Ctx, c: Pick<Case, "contractId" | "primaryAreaCode">): Promise<string> {
  const areas = await ctx.repo.table("contract_areas").list({ contractId: c.contractId });
  return areaName(areas, c.primaryAreaCode);
}

/** Har användaren någon av rollerna i avtalet (memberships)? */
export async function hasRoleIn(ctx: Ctx, userId: string, contractId: string, roles: readonly Role[]): Promise<boolean> {
  const ms = await ctx.repo.table("memberships").list({ userId, contractId });
  return ms.some((m) => roles.includes(m.role));
}

/** Ändrar ärendet med full åtkomst (policyns CASE_EDITORS). */
export const CASE_EDIT_ROLES: readonly Role[] = ["samordnare", "avtalsansvarig", "coach"];

/**
 * Får aktören ändra ärendet i någon av rollerna? Samma regel som policyn (caseWrite i src/data/policy.ts) och prototypens
 * canEditCase, prövad per roll (Karims beslut 7, 2026-10-09 – summan av rollerna, aldrig mer):
 *   samordnare, avtalsansvarig och coach  full åtkomst genom en av de rollerna (vid skyddade personuppgifter bara namngiven
 *                                         huvudcoach och avtalsansvarig; beslut 2026-10-09: alla coacher i avtalets ärenden)
 *   kommun_handlaggare                    beställande handläggare (bara kontaktuppgifterna – case.update, triggern
 *                                         cases_protect_columns i 0034)
 *   ekonom                                debiteringsåtkomst – bara beställarreferensen (case.setBuyerRef)
 * roles = rollerna som hanteraren låter ändra (standard CASE_EDIT_ROLES). Ekonomen och kommunen räknas bara när hanteraren
 * anger dem – annars skulle t.ex. coach och ekonom få ändra ett skyddat ärende som ingen av rollerna ensam får ändra.
 * Handledaren ändrar inte ärendet (närvaro, moment, anteckningar och meddelanden styrs av rollkontrollen i respektive hanterare
 * och av policyns workOn). Anropas efter att ärendet lästs via ctx.repo – så att ett nej blir ett begripligt fel i stället för
 * ett behörighetsfel.
 */
export async function canEditCase(ctx: Ctx, c: AccessCase, roles: readonly Role[] = CASE_EDIT_ROLES): Promise<boolean> {
  const mine = ctx.actor.roles.filter((r) => roles.includes(r));
  if (!mine.length) return false;
  const editors = mine.filter((r) => CASE_EDIT_ROLES.includes(r));
  if (editors.length && (await caseAccessAsRoles(ctx, c, editors)) === "full") return true;
  if (mine.includes("kommun_handlaggare") && !!c.referrerId && c.referrerId === ctx.actor.userId && (await caseAccessAsRoles(ctx, c, ["kommun_handlaggare"])) === "customer") return true;
  return mine.includes("ekonom") && (await caseAccessAsRoles(ctx, c, ["ekonom"])) === "billing";
}

// ---------------------------------------------------------------- Rader
/** Spara en rad: uppdatera om den finns, annars skapa den. */
export async function upsert<T extends { id: string }>(table: Table<T>, row: T): Promise<T> {
  const cur = await table.get(row.id);
  return cur ? table.update(row.id, row) : table.insert(row);
}

// ---------------------------------------------------------------- Mottagare
/**
 * E-postadress till en användare för ett utskick.
 * ctx.system: mottagarens adress slås upp som en del av utskicket (ett systemsteg) och lämnas aldrig ut till anroparen.
 */
export async function userEmail(ctx: Ctx, userId: string | null | undefined): Promise<string> {
  if (!userId) return "";
  return (await ctx.system.table("profiles").get(userId))?.email ?? "";
}

/** Namnet på en användare (MB-personal eller kommunanvändare) som prototypens MM.personName. ctx.system: bara namnet på en användare – inga personuppgifter om deltagare. */
export async function userName(ctx: Ctx, userId: string | null | undefined): Promise<string> {
  if (!userId) return "–";
  if (userId === "system") return "Miljonmatch (automatiskt)";
  return (await ctx.system.table("profiles").get(userId))?.fullName ?? "–";
}

/** Beställarens e-post: handläggarens konto, annars kontaktuppgiften i beställningen (mejlavrop utan konto). */
export async function referrerEmail(ctx: Ctx, c: Pick<Case, "referrerId" | "referrerEmail">): Promise<string> {
  return (await userEmail(ctx, c.referrerId)) || c.referrerEmail || "";
}

/** Utskick till beställande handläggare. Texten innehåller bara ärendenummer och "logga in" (CLAUDE.md punkt 9). */
export async function notifyReferrer(ctx: Ctx, c: Pick<Case, "id" | "referrerId" | "referrerEmail">, template: string, body: string, caseId: string | null = c.id): Promise<void> {
  await ctx.notify({ channel: "email", to: await referrerEmail(ctx, c), template, body, caseId });
}

// ---------------------------------------------------------------- Kallelse till deltagaren
/**
 * Kallelse till första mötet (beslut 2026-10-09): e-post, SMS och utringning enligt notifyParticipant
 * (src/features/_shared/participant-notify.ts) – finns ingen kanal får samordnaren en uppgift att ringa deltagaren.
 * Aldrig vid skyddade personuppgifter (CLAUDE.md punkt 8, vilande spärr). Texten innehåller bara tid, plats och telefonnummer.
 * Platsen: ärendets plats, annars Alby (som förut).
 */
export async function sendMeetingInvitation(ctx: Ctx, c: Pick<Case, "id" | "location">, at: LocalDateTime): Promise<NotifyParticipantResult> {
  return notifyParticipant(ctx, { caseId: c.id, template: "kallelse", when: at, place: c.location || "Alby" });
}

// ---------------------------------------------------------------- Notis vid tilldelning
/**
 * Notis till coach eller teammedlem vid tilldelning: i appen + e-post utan personuppgifter (interna regler, org_settings).
 * ctx.system: notisen går till en annan användare – user_notifications skrivs bara av systemet.
 */
export async function notifyAssignment(ctx: Ctx, c: Case, userId: string, role: TeamRole, settings: OrgSettings): Promise<void> {
  const rule = settings.notifications.onAssignment;
  const lead = role === "lead_coach";
  if (!rule.to.includes(lead ? "lead_coach" : "team")) return;
  const u = await ctx.system.table("profiles").get(userId);
  if (!u) return;
  const emailBody = `Du har fått ett nytt ärende i Miljonmatch: ${c.caseNumber}. Logga in för att se detaljerna.`;
  await ctx.system.table("user_notifications").insert({
    id: ctx.newId("un"), recipientId: userId, kind: "assignment", caseId: c.id, createdAt: ctx.now(), channels: [...rule.channels],
    title: lead ? "Nytt ärende tilldelat dig" : "Du har lagts till i ett team",
    body: lead
      ? `Du är huvudcoach för ${c.caseNumber} (${await caseAreaName(ctx, c)}). Första möte ${c.firstMeetingAt ? fmtDateTime(c.firstMeetingAt) : "är inte bokat ännu"}.`
      : `Du är ${teamLabel(role).toLowerCase()} för ${c.caseNumber}.`,
    emailBody,
  });
  if (rule.channels.includes("email")) await ctx.notify({ channel: "email", to: u.email, template: "tilldelning_coach", body: emailBody, caseId: c.id });
}

// ---------------------------------------------------------------- "Behöver beslut/stöd från kommunen"
/**
 * Uppgift till beställande handläggare och ett mejl utan personuppgifter (prototypens customerDecisionTask).
 * Skapas en gång per avvikelse. ctx.system: uppgiften går till en annan användare (kommunen) och dubblettkontrollen
 * ska se alla uppgifter. Utan handläggarkonto skapas ingen uppgift (den skulle annars synas för alla handläggare) – mejlet går ändå.
 */
export async function customerDecisionTask(ctx: Ctx, c: Case, dv: Pick<Deviation, "id" | "description">): Promise<void> {
  if (await ctx.system.table("tasks").first({ deviationId: dv.id })) return;
  if (c.referrerId) {
    await ctx.system.table("tasks").insert({
      id: ctx.newId("task"), toRole: "kommun_handlaggare", toId: c.referrerId, fromId: ctx.actor.userId, createdAt: ctx.now(), status: "open",
      kind: "customer_decision", caseIds: [c.id], deviationId: dv.id, emailId: null, responseId: null, month: null, doneAt: null, doneBy: null, doneNote: null,
      text: `Miljonbemanning behöver ert beslut eller stöd i ärende ${c.caseNumber}: ${dv.description}. Läs mer och svara under ärendets meddelanden.`,
    });
  }
  await notifyReferrer(ctx, c, "beslut_behovs", `Ärende ${c.caseNumber} behöver ert beslut eller stöd – logga in för att läsa.`);
}
