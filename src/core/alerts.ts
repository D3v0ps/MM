// Flaggor (beräknade, kvitteras med kort åtgärdsplan i alert_acks). Port av prototypens sel.alerts.
// Mottagare per flagga styrs av roller; coachen ser bara flaggor för egna ärenden och aldrig eskaleringar.
import type { Role } from "@/api/roles";
import type { AlertKind, AlertSeverity, Db, UserId } from "@/data/schema";
import { kpiDef } from "./config";
import { repeatedAbsence } from "./attendance";
import { unbilledOld, type BillingDb } from "./billing";
import { stuck } from "./cases";
import { byId } from "./db-index";
import type { DomainEnv } from "./env";
import { kr, pct } from "./format";
import { kpiValue, resultRate, type KpiDb } from "./kpi";
import { personName, phaseName, reportKindLabel } from "./labels";
import { linkHref, viewLink, type ViewLink } from "./links";
import { progressionWatch } from "./progression";
import { firstMeetingDays, firstMeetingDue } from "./sla";
import { addDays, addMinutes, addMonths, dayOf, diffDays, fmtDate, fmtDateTime, fmtWeekKey, monday, monthKey, monthName, type LocalDateTime } from "./time";
import { groupBy, sum } from "./util";

export type AlertAckInfo = { by: UserId; at: LocalDateTime; plan: string };
export type AlertItem = {
  /** Stabil nyckel – samma som alert_acks.id. */
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  text: string;
  caseId?: string;
  /** Roller som flaggan riktar sig till. */
  roles: Role[];
  /** Coachen som äger ärendet – coachen ser bara flaggor för egna ärenden. */
  coachId?: string | null;
  createdAt: LocalDateTime;
  link: ViewLink;
  href: string;
  ack: AlertAckInfo | null;
};

export type AlertDb = BillingDb &
  KpiDb &
  Pick<Db, "check_ins" | "placements" | "pulse_responses" | "inbound_emails" | "alert_acks" | "profiles">;
/**
 * hideCommercial = begränsad testare i testmiljön (src/api/tester-access.ts): inga flaggor som bygger på Miljonbemannings
 * interna mål (Bevaka: resultatgrad och månads-KPI:er under internt mål) och inga flaggor om ofakturerade veckor (belopp i
 * kronor, länk till Ekonomi). Flaggan om resultatgrad under avtalsmålet finns kvar.
 * Belopp syns bara för rollen ekonom (beslut 5, 2026-10-07 – samma regel som hidesMoney i src/api/tester-access.ts): chefen
 * får flaggan om ofakturerade veckor med antal veckor utan kronor och en länk till ärendet i stället för till Ekonomi.
 */
export type AlertOpts = { role: Role; personaId?: string | null; includeAcked?: boolean; hideCommercial?: boolean };

type Draft = Omit<AlertItem, "ack" | "href">;
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
/** Konfigurationens mottagare -> appens roller ("controller" = chef/controller). */
const toRoles = (xs: readonly string[]): Role[] => xs.map((x) => (x === "controller" ? "chef" : x) as Role);

/** Flaggor för en roll (och persona för coachen), allvarligast och senast först. Kvitterade flaggor bara med includeAcked. */
export function alerts(db: AlertDb, opts: AlertOpts, env: DomainEnv): AlertItem[] {
  const { role, personaId = null, includeAcked = false, hideCommercial = false } = opts;
  const today = dayOf(env.now);
  const at6 = `${today}T06:00`;
  const acks = byId(db.alert_acks);
  const out: AlertItem[] = [];
  const add = (a: Draft) => {
    const row = acks.get(a.key);
    const ack = row ? { by: row.acknowledgedBy, at: row.acknowledgedAt, plan: row.actionPlan } : null;
    if (!ack || includeAcked) out.push({ ...a, href: linkHref(a.link), ack });
  };
  const cases = byId(db.cases);

  // Resultatgrad mot avtalsmål och internt mål (rullande 6 månader)
  const rr = resultRate(db, { window: "rolling_6m" }, env);
  const k = kpiDef(env.cfg, "resultatgrad");
  const lead = `Resultatgraden är ${pct(rr.value)} (rullande 6 mån, ${rr.num} av ${rr.den}).`;
  if (k && rr.status === "below_contract") {
    add({
      key: "kpi:resultatgrad:contract", kind: "kpi", severity: "critical", title: "Åtgärd krävs: resultatgrad under avtalsmålet",
      text: `${lead} Avtalsmålet är ${pct(k.contractTarget, 0)}.`, roles: toRoles(k.notify?.belowContract ?? []), createdAt: at6, link: viewLink("chef.oversikt"),
    });
  } else if (k && rr.status === "below_internal" && !hideCommercial) {
    add({
      key: "kpi:resultatgrad:internal", kind: "kpi", severity: "warning", title: "Bevaka: resultatgrad under internt mål",
      text: `${lead} Internt mål ${pct(rr.internalTarget, 0)}, avtalsmål ${pct(k.contractTarget, 0)}.`, roles: toRoles(k.notify?.belowInternal ?? []), createdAt: at6, link: viewLink("chef.oversikt"),
    });
  }

  // Månads-KPI:er för förra månaden under internt mål
  const lastMonth = addMonths(monthKey(today), -1);
  for (const key of ["avrop_besvarade_i_tid", "forsta_mote_inom_en_vecka", "veckorapporter_i_tid", "manadsrapporter_i_tid"]) {
    const v = kpiValue(db, key, { month: lastMonth }, env);
    if (v && v.status === "below_internal" && !hideCommercial) {
      add({
        key: `kpi:${key}:${lastMonth}`, kind: "kpi", severity: "warning", title: `Bevaka: ${v.label.toLowerCase()} ${monthName(lastMonth)}`,
        text: `${pct(v.value)} (${v.num} av ${v.den}). Internt mål ${pct(v.target, 0)}.`, roles: ["chef", "samordnare", "avtalsansvarig"], createdAt: at6, link: viewLink("chef.oversikt"),
      });
    }
  }

  // Per ärende: fastnat, upprepad frånvaro, första möte inte bokat
  const fmDays = firstMeetingDays(env.cfg);
  const within = fmDays === 7 ? "inom en vecka" : fmDays != null ? `inom ${fmDays} dagar` : "i tid";
  for (const c of db.cases) {
    if (c.status === "active") {
      const s = stuck(c, db, env);
      if (s) {
        add({
          key: `stuck:${c.id}:${c.phase}`, kind: "stuck", severity: "warning", title: `Fastnat i fas ${c.phase}`,
          text: `${c.caseNumber} har varit i fas ${c.phase} (${phaseName(env.cfg, c.phase)}) i ${s.days} dagar. Gräns: ${s.maxDays} dagar.`,
          caseId: c.id, roles: ["coach", "samordnare"], coachId: c.leadCoachId, createdAt: at6, link: viewLink("arende.kort", { caseId: c.id }),
        });
      }
      const ra = repeatedAbsence(db, c.id, env);
      if (ra) {
        const lastAbs = ra[ra.length - 1];
        add({
          key: `absence:${c.id}:${lastAbs.id}`, kind: "absence", severity: "warning", title: "Upprepad ogiltig frånvaro",
          text: `${c.caseNumber}: ${ra.length} ogiltiga frånvarotillfällen inom ${env.cfg.attendance.repeatedAbsenceRule.withinDays} dagar. Förslag: åtgärdsplan och uppföljningsmöte med handläggaren.`,
          caseId: c.id, roles: ["coach", "samordnare"], coachId: c.leadCoachId, createdAt: lastAbs.registeredAt, link: viewLink("arende.kort", { caseId: c.id, tab: "narvaro" }),
        });
      }
    }
    const after = env.org.alerts.firstMeetingNotBookedAfterDays;
    if (c.status === "confirmed" && !c.firstMeetingAt && diffDays(c.referredAt, today) >= after) {
      add({
        key: `nomeeting:${c.id}`, kind: "first_meeting", severity: "critical", title: "Första möte inte bokat",
        text: `${c.caseNumber} mottogs ${fmtDate(c.referredAt)}. Mötet ska vara bokat ${within} (senast ${fmtDateTime(firstMeetingDue(c, env.cfg))}).`,
        caseId: c.id, roles: ["samordnare", "coach"], coachId: c.leadCoachId, createdAt: `${addDays(dayOf(c.referredAt), after)}T08:00`, link: viewLink("arende.kort", { caseId: c.id }),
      });
    }
  }

  // Inskrivna ärenden utan mottagare för veckorapporten (rapportarbetet steg 1): veckorapporten går till handläggaren som
  // beställde insatsen och har ett aktivt konto i portalen. Saknas det (avrop per mejl eller telefon från en handläggare utan
  // konto, eller ett spärrat konto) kommer deltagarens närvaro inte med i någon veckorapport – samordnaren får veta det.
  if (env.cfg.reportSchedule?.automatic.includes("weekly_attendance")) {
    const profiles = byId(db.profiles);
    for (const c of db.cases) {
      if (!c.startDate || c.startDate > today || !["confirmed", "active", "paused"].includes(c.status)) continue;
      const referrer = c.referrerId ? profiles.get(c.referrerId) : undefined;
      if (referrer?.active) continue;
      add({
        key: `noreportrecipient:${c.id}`, kind: "no_report_recipient", severity: "warning", title: "Ingen mottagare för veckorapporten",
        text: `${c.caseNumber} har ingen handläggare med aktivt konto i portalen. Deltagarens närvaro kommer därför inte med i någon veckorapport. Kontakta kommunen om hur närvaron ska rapporteras.`,
        caseId: c.id, roles: ["samordnare", "avtalsansvarig"], coachId: c.leadCoachId, createdAt: `${c.startDate}T08:00`, link: viewLink("arende.kort", { caseId: c.id }),
      });
    }
  }

  // Ingen progression: påminnelse till coachen, eskalering till chef/controller (syns aldrig för coachen)
  const monday8 = `${monday(today)}T08:00`;
  const watchRule = env.org.notifications.progressionWatch;
  for (const w of progressionWatch(db, {}, env)) {
    const c = w.case;
    if (w.level === "escalated") {
      add({
        key: `noprog_esc:${c.id}:${w.lastWeek}`, kind: "no_progress_escalated", severity: "warning", title: `${w.streak} veckor i rad utan progression`,
        text: `${c.caseNumber} (coach ${personName(db.profiles, c.leadCoachId)}): ${w.weeks.filter((x) => !x.progress).map((x) => `${fmtWeekKey(x.key)} – ${x.reason}`).join("; ")}. Coachen har fått påminnelser men ser inte att detta har eskalerats.`,
        caseId: c.id, roles: [...watchRule.escalateTo], createdAt: monday8, link: viewLink("arende.kort", { caseId: c.id }),
      });
    }
    add({
      key: `noprog:${c.id}:${w.lastWeek}`, kind: "no_progress", severity: "info", title: "Påminnelse: ingen progression förra veckan",
      text: `${c.caseNumber}: ${w.weeks[w.weeks.length - 1].reason}. Planera nästa steg och dokumentera i veckoavstämningen.`,
      caseId: c.id, roles: ["coach"], coachId: c.leadCoachId, createdAt: monday8, link: viewLink("coach.avstamning", { caseId: c.id }),
    });
  }

  // Försenade månads- och slutrapporter
  for (const r of db.reports) {
    if ((r.kind !== "final" && r.kind !== "monthly") || r.status === "delivered" || r.status === "opened" || !r.dueAt || !(r.dueAt < env.now)) continue;
    const c = r.caseId ? cases.get(r.caseId) : undefined;
    if (!c) continue;
    add({
      key: `overdue:${r.id}`, kind: "report_overdue", severity: "critical", title: `${reportKindLabel(r.kind)} försenad`,
      text: `${c.caseNumber}: förföll ${fmtDateTime(r.dueAt)}. Vitesrisk vid bristfällig löpande information.`,
      caseId: c.id, roles: ["coach", "samordnare", "chef"], coachId: c.leadCoachId, createdAt: r.dueAt, link: viewLink("rapport.visa", { reportId: r.id }),
    });
  }

  // Ofakturerade veckor äldre än varningsgränsen
  const limit = env.cfg.billing.unbilledWarningDays;
  for (const [caseId, rows] of Object.entries(groupBy(hideCommercial ? [] : unbilledOld(db, env), (x) => x.case.id))) {
    const c = rows[0].case;
    // Beloppet och länken till Ekonomi bara för ekonomen (beslut 5). Flaggan byggs för den roll som frågar.
    const money = role === "ekonom";
    add({
      key: `unbilled:${caseId}`, kind: "unbilled", severity: "critical", title: `Ofakturerade veckor äldre än ${limit} dagar`,
      text: `${c.caseNumber}: ${rows.length === 1 ? "1 vecka" : `${rows.length} veckor`}${money ? ` (${kr(sum(rows, (x) => x.amountOre))})` : ""}. Preskription två månader efter utfört arbete.`,
      caseId, roles: ["ekonom", "chef"], createdAt: at6, link: money ? viewLink("eko.start") : viewLink("arende.kort", { caseId }),
    });
  }

  // Pulsmätningen: deltagare vill bli kontaktad, lågt betyg på stödet från coachen (går till chef, inte coachen)
  for (const x of db.pulse_responses.filter((p) => p.contactRequested)) {
    add({
      key: `pulse_contact:${x.id}`, kind: "pulse_contact", severity: "info", title: "Deltagare vill bli kontaktad",
      text: `Svar i pulsmätningen ${fmtDate(x.submittedAt)} (${cases.get(x.caseId)?.caseNumber}). Samordnaren avgör vem som tar kontakten.`,
      caseId: x.caseId, roles: ["samordnare"], createdAt: x.submittedAt, link: viewLink("arende.kort", { caseId: x.caseId }),
    });
  }
  const lowSince = `${addMonths(monthKey(today), -1)}-01`;
  for (const x of db.pulse_responses.filter((p) => p.answers.q3 <= 2 && p.submittedAt >= lowSince)) {
    add({
      key: `pulse_low:${x.id}`, kind: "pulse_low", severity: "warning", title: "Lågt betyg på stödet från coachen",
      text: `Ett svar ${fmtDate(x.submittedAt)} gav ${x.answers.q3} av 5 på frågan om stöd från coachen. Går till chef, inte till coachen.`,
      roles: ["chef"], createdAt: x.submittedAt, link: viewLink("chef.oversikt", { tab: "puls" }),
    });
  }

  // Avrop med skyddade personuppgifter
  for (const e of db.inbound_emails.filter((m) => m.status === "protected")) {
    add({
      key: `protected:${e.id}`, kind: "protected_order", severity: "critical", title: "Avrop med skyddade personuppgifter",
      text: `Mejl från ${e.fromName} ${fmtDateTime(e.receivedAt)}. Bara generisk mottagningsbekräftelse skickad. Ring handläggaren enligt den säkra rutinen.`,
      roles: ["avtalsansvarig", "samordnare"], createdAt: e.receivedAt, link: viewLink("sam.inkorg", { emailId: e.id }),
    });
  }

  // AI-utkast att granska
  for (const ci of db.check_ins.filter((x) => x.status === "draft" && x.ai)) {
    const c = cases.get(ci.caseId);
    if (!c) continue;
    add({
      key: `ai_draft:${ci.id}`, kind: "ai_draft", severity: "info", title: "AI-utkast att granska",
      text: `Avstämning ${fmtDateTime(ci.heldAt)} (${c.caseNumber}). Råtranskriptet raderas senast ${fmtDate(ci.ai?.rawTranscriptDeleteBy)}.`,
      caseId: c.id, roles: ["coach"], coachId: c.leadCoachId, createdAt: addMinutes(ci.heldAt, 48), link: viewLink("coach.avstamning", { caseId: c.id, checkInId: ci.id }),
    });
  }

  const roleKey: Role[] = role === "avtalsansvarig" ? ["avtalsansvarig", "samordnare"] : [role];
  return out
    .filter((a) => a.roles.some((r) => roleKey.includes(r)) && (role !== "coach" || !a.coachId || a.coachId === personaId))
    // Samma jämförelse som prototypen (lika tidpunkter behåller inte sin ordning – prototypens beteende).
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.createdAt < b.createdAt ? 1 : -1));
}
