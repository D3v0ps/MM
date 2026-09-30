// Deadlines (SPEC §7.13): allt som förfaller inom ett antal dagar eller redan är försenat, med SLA-status.
// Port av prototypens sel.deadlines. Tidsgränser från avtalskonfigurationen och de interna reglerna (org_settings).
import type { Role } from "@/api/roles";
import type { Db, DeadlineKind } from "@/data/schema";
import { slaRule } from "./config";
import { unregistered } from "./attendance";
import { avropDue, firstMeetingDue, isProvisionalDue, slaStatus, type SlaStatus } from "./sla";
import { coaches } from "./cases";
import { byId } from "./db-index";
import type { DomainEnv } from "./env";
import { personName } from "./labels";
import { linkHref, viewLink, type ViewLink } from "./links";
import { addDays, addMonths, dayOf, fmtWeekKey, isoWeek, monday, monthName, nthWorkingDay, timeOf, type LocalDateTime } from "./time";
import { by } from "./util";

export type DeadlineBucket = "overdue" | "today" | "week";
export type DeadlineItem = {
  /** Stabil nyckel, t.ex. "avrop:case-270048", "rep:rep-16356", "reg:u-amira". */
  id: string;
  kind: DeadlineKind;
  label: string;
  dueAt: LocalDateTime;
  caseId?: string;
  reportId?: string;
  /** Rollen som äger uppgiften, om den inte har en namngiven ägare. */
  owner?: Role;
  ownerId?: string | null;
  /** Antal (t.ex. oregistrerade tillfällen). */
  count?: number;
  /** Förfallotiden bygger på ett förslag som inte är fastställt i avtalet. */
  provisional?: boolean;
  link: ViewLink;
  href: string;
  sla: SlaStatus;
  bucket: DeadlineBucket;
};

export type DeadlineDb = Pick<
  Db,
  "cases" | "activities" | "attendance" | "reports" | "profiles" | "memberships" | "contract_deviations" | "billing_runs" | "deviations"
>;
export type DeadlineOpts = { days?: number; coachId?: string | null; includeMet?: boolean };

type Draft = Omit<DeadlineItem, "sla" | "bucket" | "href">;

/** Deadlines inom `days` dagar (standard 7) och allt som är försenat. Med coachId bara coachens egna. */
export function deadlines(db: DeadlineDb, opts: DeadlineOpts, env: Pick<DomainEnv, "cfg" | "org" | "now" | "contractId">): DeadlineItem[] {
  const { days = 7, coachId = null, includeMet = false } = opts;
  const now = env.now;
  const today = dayOf(now);
  const limit = `${addDays(today, days)}T23:59`;
  const out: Draft[] = [];
  const push = (x: Draft) => {
    if (x.dueAt <= limit || x.dueAt < now) out.push(x);
  };
  const cases = byId(db.cases);

  for (const c of db.cases) {
    if (coachId && c.leadCoachId !== coachId) continue;
    if (c.status === "acknowledged" || c.status === "received") {
      const due = avropDue(c, env.cfg);
      if (due) push({ id: `avrop:${c.id}`, kind: "avrop_svar", label: "Svar på avrop (acceptera eller avböj)", dueAt: due, caseId: c.id, owner: "samordnare", link: viewLink("sam.inkorg", { caseId: c.id }) });
    }
    if (c.status === "confirmed" && !c.firstMeetingAt) {
      const due = firstMeetingDue(c, env.cfg);
      if (due) push({ id: `fm:${c.id}`, kind: "forsta_mote", label: "Första möte ska vara bokat", dueAt: `${dayOf(due)}T${timeOf(c.referredAt)}`, caseId: c.id, owner: "samordnare", link: viewLink("arende.kort", { caseId: c.id }) });
    }
  }

  // Närvaroregistrering för förra veckan (Botkyrka: måndag 10.00)
  const reg = slaRule(env.cfg, "veckorapport_registrering");
  if (reg?.time) {
    const thisMon = monday(today);
    const lastMon = addDays(thisMon, -7);
    const regDue = `${addDays(thisMon, reg.weekday ?? 0)}T${reg.time}`;
    for (const coach of coaches(db, env.contractId)) {
      if (coachId && coach.id !== coachId) continue;
      const missing = unregistered(db, coach.id, lastMon, addDays(lastMon, 6), env);
      if (missing.length || includeMet) {
        push({
          id: `reg:${coach.id}`, kind: "veckorapport_registrering", label: `Närvaro vecka ${isoWeek(lastMon).week}: ${missing.length} tillfällen ej registrerade`,
          dueAt: regDue, ownerId: coach.id, count: missing.length, link: viewLink("coach.narvaro", { week: "last" }),
        });
      }
    }
  }

  for (const r of db.reports) {
    if ((r.status === "delivered" || r.status === "opened") && !includeMet) continue;
    const c = r.caseId ? cases.get(r.caseId) ?? null : null;
    if (coachId && (!c || c.leadCoachId !== coachId)) continue;
    if (!r.dueAt) continue;
    const l = viewLink("rapport.visa", { reportId: r.id });
    if (r.kind === "weekly_attendance") {
      push({ id: `rep:${r.id}`, kind: "veckorapport_publicering", label: `Veckorapport ${r.week ? fmtWeekKey(r.week) : ""} till ${personName(db.profiles, r.recipientUserId)}`, dueAt: r.dueAt, reportId: r.id, owner: "samordnare", link: l });
    }
    if (r.kind === "monthly") {
      push({ id: `rep:${r.id}`, kind: "manadsrapport", label: `Månadsrapport ${r.month ? monthName(r.month) : ""}`, dueAt: r.dueAt, reportId: r.id, caseId: r.caseId ?? undefined, provisional: isProvisionalDue(env.cfg, "monthly"), link: l });
    }
    if (r.kind === "final") {
      push({ id: `rep:${r.id}`, kind: "slutrapport", label: "Slutrapport", dueAt: r.dueAt, reportId: r.id, caseId: r.caseId ?? undefined, provisional: isProvisionalDue(env.cfg, "final"), link: l });
    }
    if (r.kind === "customer_summary") {
      push({ id: `rep:${r.id}`, kind: "bestallarrapport", label: `Beställarrapport ${r.month ? monthName(r.month) : ""}`, dueAt: r.dueAt, reportId: r.id, owner: "avtalsansvarig", provisional: isProvisionalDue(env.cfg, "customer_summary"), link: l });
    }
  }

  if (!coachId) {
    for (const cd of db.contract_deviations.filter((x) => x.status !== "closed" && x.actionPlanDue)) {
      push({
        id: `cd:${cd.id}`, kind: "atgardsplan", label: `Åtgärdsplan: ${cd.description.slice(0, 60)}…`, dueAt: `${cd.actionPlanDue}T${env.org.alerts.followUpDueTime}`,
        owner: "avtalsansvarig", link: viewLink("chef.avvikelser", { id: cd.id }),
      });
    }
    const run = db.billing_runs.find((b) => b.status === "draft");
    if (run) {
      const n = env.org.billing.fortnoxWithinWorkingDays;
      push({
        id: `bill:${run.month}`, kind: "fakturering", label: `Fakturor för ${monthName(run.month)} i Fortnox (internt mål: ${n} arbetsdagar)`,
        dueAt: `${nthWorkingDay(addMonths(run.month, 1), n)}T16:00`, owner: "ekonom", link: viewLink("eko.korning", { month: run.month }),
      });
    }
  }

  for (const dv of db.deviations.filter((x) => x.status === "open" && x.followUpOn)) {
    const c = cases.get(dv.caseId) ?? null;
    if (coachId && (!c || c.leadCoachId !== coachId)) continue;
    push({
      id: `dev:${dv.id}`, kind: "avvikelse_uppfoljning", label: `Uppföljning av avvikelse: ${dv.description}`, dueAt: `${dv.followUpOn}T${env.org.alerts.followUpDueTime}`,
      caseId: dv.caseId, ownerId: dv.ownerId, link: viewLink("arende.kort", { caseId: dv.caseId, tab: "avvikelser" }),
    });
  }

  return out
    .map((x): DeadlineItem => ({ ...x, href: linkHref(x.link), sla: slaStatus(x.dueAt, null, env), bucket: x.dueAt < now ? "overdue" : dayOf(x.dueAt) === today ? "today" : "week" }))
    .sort(by<DeadlineItem>("dueAt"));
}
