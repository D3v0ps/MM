// SLA-regler och förfallotider (SPEC §7.13). Tidsgränserna läses från avtalskonfigurationen (config.sla).
// En regel som är ATT_FASTSTÄLLA aktiveras inte – då används regelns förslag (proposal) och tiden visas som preliminär.
import type { Case, ReportKind } from "@/data/schema";
import { isUnset, slaRule, slaWithin, type OperationalConfig, type Within } from "./config";
import type { DomainEnv } from "./env";
import { addDays, addMinutes, addMonths, addWorkingDays, diffMinutes, fmtDateTime, nthWorkingDay, relative, type LocalDate, type LocalDateTime, type MonthKey } from "./time";

type SlaCfg = Pick<OperationalConfig, "sla">;

/** Lägg en tidsgräns (minuter, arbetsdagar eller kalenderdagar) på en tidpunkt. Klockslaget behålls. */
export function addWithin(from: LocalDateTime, within: Within): LocalDateTime {
  if (within.minutes != null) return addMinutes(from, within.minutes);
  if (within.workingDays != null) return addWorkingDays(from, within.workingDays);
  return addDays(from, within.days ?? 0);
}

/** Förfallotid enligt en fastställd regel, eller null om regeln saknas eller är ATT_FASTSTÄLLA. */
export function slaDue(cfg: SlaCfg, key: string, from: LocalDateTime): LocalDateTime | null {
  const w = slaWithin(cfg, key);
  return w ? addWithin(from, w) : null;
}

/** Svar på avrop (acceptera eller avböj) – Botkyrka: inom en arbetsdag från att avropet kom in. */
export const avropDue = (c: Pick<Case, "referredAt">, cfg: SlaCfg): LocalDateTime | null => slaDue(cfg, "avrop_svar", c.referredAt);

/** Första mötet – Botkyrka: inom sju dagar från att avropet kom in. */
export const firstMeetingDue = (c: Pick<Case, "referredAt">, cfg: SlaCfg): LocalDateTime | null => slaDue(cfg, "forsta_mote", c.referredAt);

/** Antal kalenderdagar för första mötet (för texten "inom en vecka"), eller null. */
export const firstMeetingDays = (cfg: SlaCfg): number | null => slaWithin(cfg, "forsta_mote")?.days ?? null;

/** Slutrapportens arbetsdagar efter avslut: fastställt värde, annars förslaget (Botkyrka: förslag 5). */
export function finalReportWorkingDays(cfg: SlaCfg): number | null {
  const w = slaWithin(cfg, "slutrapport");
  if (w?.workingDays != null) return w.workingDays;
  return slaRule(cfg, "slutrapport")?.proposal?.workingDays ?? null;
}

/** Slutrapportens förfallotid (sista arbetsdagen kl. 23.59). */
export function finalReportDueAt(cfg: SlaCfg, endDate: LocalDate): LocalDateTime | null {
  const n = finalReportWorkingDays(cfg);
  return n == null ? null : addWorkingDays(`${endDate}T23:59`, n);
}

/** Månadsrapportens förfallotid: n:e arbetsdagen efter månadsskiftet kl. 23.59 (Botkyrka: förslag den 5:e). */
export function monthlyReportDueAt(cfg: SlaCfg, month: MonthKey): LocalDateTime | null {
  const n = slaRule(cfg, "manadsrapport")?.proposal?.nthWorkingDay;
  return n == null ? null : `${nthWorkingDay(addMonths(month, 1), n)}T23:59`;
}

/**
 * Sant om rapportens förfallotid bara är ett förslag (regeln är ATT_FASTSTÄLLA i avtalet).
 * Beställarrapporten har ingen regel i avtalet och är alltid preliminär.
 */
export function isProvisionalDue(cfg: SlaCfg, kind: ReportKind): boolean {
  if (kind === "monthly") {
    const r = slaRule(cfg, "manadsrapport");
    return !r || isUnset(r.due) || isUnset(r.within) || (r.due == null && r.within == null);
  }
  if (kind === "final") {
    const r = slaRule(cfg, "slutrapport");
    return !r || isUnset(r.within) || r.within == null;
  }
  return kind === "customer_summary";
}

export type SlaTone = "ok" | "soon" | "urgent" | "over" | "met";
export type SlaStatus = { label: string; tone: SlaTone; minutes: number };

/** Status för en tidsgräns: "I tid", "Sent (2 tim)", "Försenad 2 dagar", "48 min kvar", "Senast 2 feb kl. 08.41". */
export function slaStatus(dueAt: LocalDateTime, metAt: LocalDateTime | null | undefined, env: Pick<DomainEnv, "now">): SlaStatus {
  if (metAt) {
    return { label: metAt <= dueAt ? "I tid" : `Sent (${relative(metAt, dueAt).replace("om ", "")})`, tone: metAt <= dueAt ? "met" : "over", minutes: 0 };
  }
  const mins = diffMinutes(env.now, dueAt);
  if (mins < 0) return { label: `Försenad ${relative(dueAt, env.now).replace("för ", "").replace(" sedan", "")}`, tone: "over", minutes: mins };
  if (mins <= 120) return { label: `${relative(dueAt, env.now).replace("om ", "")} kvar`, tone: "urgent", minutes: mins };
  if (mins <= 60 * 8) return { label: `${relative(dueAt, env.now).replace("om ", "")} kvar`, tone: "soon", minutes: mins };
  return { label: `Senast ${fmtDateTime(dueAt)}`, tone: "ok", minutes: mins };
}
