// Datainläsning för kommunens portal. Bara för hanterare – importeras aldrig av skärmar.
// Allt läses via ctx.repo (policyn i minnet, RLS i produktion) om inget annat står vid anropet.
// Behörighet och namn per ärende kommer från rapportområdets viewerFor (samma regler som caseAccess i src/core/access.ts).
import type { Ctx } from "@/api/server";
import { isOperational, phaseName, requireOperational, type OperationalConfig } from "@/core/config";
import { areaName, endReasonLabel, reportKindLabel } from "@/core/labels";
import { avropDue, firstMeetingDue } from "@/core/sla";
import type { Case, Contract, ContractArea, Message, Profile, Report } from "@/data/schema";
import { pendingCorrection, viewerFor, type Viewer } from "../rapporter/load";
import { deliveredOk } from "../rapporter/report-helpers";
import type { KomCase, KomMessage, KomReportRow } from "./api";
import { reportTitle, weekRangeText } from "./texts";

/** Miljonbemanning i portalens texter ("Amira Haddad, Miljonbemanning"). */
const SUPPLIER_SHORT = "Miljonbemanning";

export type KomContext = {
  me: Profile | null;
  chef: boolean;
  /** Kommunens namn (användarens organisation), t.ex. "Botkyrka kommun". */
  customerName: string;
  customerOrgId: string | null;
  contracts: Map<string, Contract>;
  cfg(contractId: string): OperationalConfig;
  /** Avtalet som beställningar görs i: det första aktiva avtalet med driftkonfiguration (samma som arenden.caseCreate). */
  active: Contract | null;
  areas: ContractArea[];
  profiles: Map<string, Profile>;
  name(userId: string | null | undefined): string;
};

/** Användaren, kommunen, avtalen och de användare som läsaren får se (MB-personal och kommunens användare i avtalet). */
export async function komContext(ctx: Ctx): Promise<KomContext> {
  const [me, contracts, areas, profiles] = await Promise.all([
    ctx.repo.table("profiles").get(ctx.actor.userId),
    ctx.repo.table("contracts").list(),
    ctx.repo.table("contract_areas").list(),
    ctx.repo.table("profiles").list(),
  ]);
  const org = me ? await ctx.repo.table("organizations").get(me.organizationId) : null;
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const cfgs = new Map<string, OperationalConfig>();
  const cfg = (id: string): OperationalConfig => {
    let v = cfgs.get(id);
    if (!v) {
      const c = byId.get(id);
      if (!c) throw new Error(`Avtalet ${id} saknas eller är inte tillgängligt`);
      v = requireOperational(c.config);
      cfgs.set(id, v);
    }
    return v;
  };
  const active = ctx.actor.contractIds.map((id) => byId.get(id)).find((c) => !!c && c.status === "active" && isOperational(c.config)) ?? null;
  const pmap = new Map(profiles.map((p) => [p.id, p]));
  return {
    me, chef: ctx.actor.role === "kommun_chef", customerName: org?.name ?? "", customerOrgId: me?.organizationId ?? null,
    contracts: byId, cfg, active, areas, profiles: pmap,
    name: (id) => (id ? (pmap.get(id)?.fullName ?? "–") : "–"),
  };
}

/** Ärenden som läsaren har åtkomst till (prototypens sel.visibleCases). */
export async function visibleCases(ctx: Ctx): Promise<Case[]> {
  const cases = await ctx.repo.table("cases").list();
  return cases.filter((c) => ctx.actor.contractIds.includes(c.contractId));
}

/** Ärendet som kommunen ser det. Namnet enligt behörigheten ("Skyddade personuppgifter" för kommunens chef). */
export function komCase(c: Case, viewer: Viewer, k: KomContext, protectedIdentity: boolean): KomCase {
  const cfg = k.cfg(c.contractId);
  const areas = k.areas.filter((a) => a.contractId === c.contractId);
  const restricted = viewer.access(c) === "restricted";
  return {
    id: c.id, caseNumber: c.caseNumber, status: c.status, name: viewer.name(c), protectedIdentity: restricted || protectedIdentity, restricted,
    primaryAreaName: c.primaryAreaCode ? areaName(areas, c.primaryAreaCode) : null,
    secondaryAreaName: c.secondaryAreaCode ? areaName(areas, c.secondaryAreaCode) : null,
    vocationalTrack: c.vocationalTrack, phase: c.phase, phaseName: phaseName(cfg, c.phase), source: c.source,
    referredAt: c.referredAt, acknowledgedAt: c.acknowledgedAt, confirmedAt: c.confirmedAt, declinedAt: c.declinedAt, declineReason: c.declineReason,
    firstMeetingAt: c.firstMeetingAt, location: c.location, startDate: c.startDate, plannedStart: c.plannedStart, desiredStart: c.desiredStart,
    plannedEnd: c.plannedEnd, endDate: c.endDate, endReasonLabel: c.endReason ? endReasonLabel(c.endReason) : null,
    avropDue: avropDue(c, cfg), firstMeetingDue: firstMeetingDue(c, cfg),
    referrerId: c.referrerId, referrerName: c.referrerId ? k.name(c.referrerId) : (c.referrerName ?? "–"),
  };
}

/** Skyddade personuppgifter per ärende (bara de personer läsaren får se – kommunens chef ser inga skyddade personer). */
export async function protectedFlags(ctx: Ctx, cases: readonly Case[]): Promise<Set<string>> {
  const ids = [...new Set(cases.map((c) => c.personId))];
  const persons = ids.length ? await ctx.repo.table("persons").list({ id: { in: ids } }) : [];
  return new Set(persons.filter((p) => p.protectedIdentity).map((p) => p.id));
}

export { viewerFor, type Viewer };

// ---------------------------------------------------------------- Meddelanden
/** Avsändaren som i prototypen: "Du", "Namn, Botkyrka kommun" eller "Namn, Miljonbemanning". */
export function senderLabel(k: KomContext, senderId: string): string {
  if (senderId === k.me?.id) return "Du";
  return `${k.name(senderId)}, ${fromCustomer(k, senderId) ? k.customerName : SUPPLIER_SHORT}`;
}
/** Meddelandet är skickat av någon hos kommunen. */
export const fromCustomer = (k: KomContext, senderId: string): boolean => !!k.customerOrgId && k.profiles.get(senderId)?.organizationId === k.customerOrgId;

export function komMessage(k: KomContext, m: Message): KomMessage {
  const me = k.me?.id ?? "";
  return {
    id: m.id, senderLabel: senderLabel(k, m.senderId), mine: m.senderId === me, fromCustomer: fromCustomer(k, m.senderId), meeting: m.kind === "meeting_request",
    createdAt: m.createdAt, body: m.body, unread: m.senderId !== me && !m.readBy.includes(me), read: m.readBy.length > 0, readAt: m.readAt,
  };
}

// ---------------------------------------------------------------- Rapporter
/** Levererad och inte ersatt (prototypens deliveredOk) – regeln ligger i rapporternas hjälpare (samma för resultatfilen och rapportbyggaren). */
export { deliveredOk };

// ---------------------------------------------------------------- Kommunens chef: avtalet för resultatfilen och delade rapporter
/**
 * Avtalet där kommunens chef hämtar resultat och delade rapporter: det första av chefens avtal med driftkonfiguration
 * (via ctx.repo). Ett avtal i taget – resultatfilen, de delade rapporterna och menyns räknare (session.navCounts) använder
 * samma funktion.
 */
export async function chefContract(ctx: Ctx, contractId?: string): Promise<{ contract: Contract; cfg: OperationalConfig } | null> {
  const ids = contractId ? (ctx.actor.contractIds.includes(contractId) ? [contractId] : []) : ctx.actor.contractIds;
  if (!ids.length) return null;
  const contracts = await ctx.repo.table("contracts").list({ id: { in: ids } });
  const contract = ids.map((id) => contracts.find((c) => c.id === id)).find((c): c is Contract => !!c && isOperational(c.config)) ?? null;
  return contract ? { contract, cfg: requireOperational(contract.config) } : null;
}

/** Avtalet låter kommunens chef se enhetens individrapporter – resultatfilen och rapporter som Miljonbemanning delar. */
export const seesResults = (cfg: OperationalConfig): boolean => cfg.customerVisibility.seesIndividualReports === true;

/** Rapporten som rad i portalen. sub: veckorapport = veckan, beställarrapport = avtalet, övriga = ärendenummer och namn. */
export async function reportRow(ctx: Ctx, r: Report, k: KomContext, caseOf: (id: string | null) => { caseNumber: string; name: string } | null): Promise<KomReportRow> {
  const me = ctx.actor.userId;
  let sub = "";
  if (r.kind === "weekly_attendance") sub = r.week ? `${weekRangeText(r.week)} · ${k.chef ? "handläggarens deltagare" : "alla dina deltagare"}` : "";
  else if (r.kind === "customer_summary") sub = `Hela avtalet med ${k.customerName}`;
  else {
    const c = caseOf(r.caseId);
    sub = c ? `${c.caseNumber} · ${c.name}` : "";
  }
  // Rättelse på gång: den nya versionen är ett utkast som kommunen inte får läsa – bara att den finns (rapporternas pendingCorrection).
  const correcting = !!r.correctionPending && !!(await pendingCorrection(ctx, r));
  return {
    id: r.id, kind: r.kind, title: reportTitle(r, reportKindLabel), sub, deliveredAt: r.deliveredAt, version: r.version || 1, openedAt: r.openedAt,
    unread: r.deliveredTo.includes(me) && !r.openedAt, correcting,
  };
}
