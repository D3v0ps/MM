// Rapportutkast som skapas automatiskt (rapportarbetet steg 1, beslut 2026-10-01). Ren domänlogik utan I/O: vilka
// rapportrader ska finnas när en period är slut, och vilka av dem saknas. Hanteraren (src/features/rapporter/ensure.ts)
// läser data, anropar funktionerna här och skriver raderna med ctx.system.
//
// Reglerna (avtalskonfigurationen, reportSchedule – CLAUDE.md punkt 4):
//   weekly_attendance  en per avtal, handläggare och ISO-vecka med minst ett inskrivet ärende hos handläggaren, när veckan
//                      är slut. Status waiting – publiceras av publishWeeklyIfComplete när all närvaro är registrerad.
//                      Sista dag: sla[veckorapport_publicering] (Botkyrka: måndag 16.00 veckan efter).
//   monthly            en per ärende och månad där ärendet är inskrivet minst reportSchedule.monthly.minEnrolledDays
//                      kalenderdagar (Botkyrka: 11), när månaden är slut. Status draft (granskad om coachen redan godkänt
//                      månadsbedömningen – samma regel som coach/handlers.ts).
//                      Sista dag: sla[manadsrapport] (förslaget: 5:e arbetsdagen efter månadsskiftet kl. 23.59).
//   customer_summary   en per avtal och månad, när månaden är slut. Status draft. Ingen mottagare: avtalsansvarig lämnar
//                      rapporten till kommunen utanför Miljonmatch (beslut 2026-10-07 – kommunens chef är borttagen).
//                      Sista dag: reportSchedule.customerSummaryDue (förslaget: 8:e arbetsdagen kl. 16.00).
// Fälten blir exakt som testdatats rader (src/data/seed/gen-reports.ts): perioder, dueAt, provisionalDue och mottagare.
// Mottagarna (handläggarna) är de med aktivt konto i avtalet – hanteraren filtrerar bort spärrade konton.
//
// Inskriven en dag = startdatum passerat och slutdatum inte passerat (samma regel som veckorapporten och faktureringen).
// Uppehåll (pausade veckor) räknas som inskriven tid: rapporten skapas och visar "Uppehåll". Ett avslutat ärende får
// inga rapporter efter slutdatumet.
//
// Perioden räknas när den är slut: veckan vid måndag 00.00 veckan efter, månaden vid den 1:a 00.00 nästa månad. Bara
// perioder som slutar efter `since` (per rapporttyp eller samma för alla) räknas. Vilka perioder en körning prövar
// räknas ut av scheduleFrom() nedan.
import { AUTO_REPORT_KINDS, slaRule, type AutoReportKind, type ContractConfig } from "./config";
import { isProvisionalDue, monthlyReportDueAt } from "./sla";
import { addDays, addMinutes, addMonths, dayOf, diffDays, isoWeek, monday, monthEnd, monthKey, nthWorkingDay, type LocalDate, type LocalDateTime, type MonthKey } from "./time";
import type { Case, Report } from "@/data/schema";

// ---------------------------------------------------------------- Indata
export type ScheduleCase = Pick<Case, "id" | "status" | "referrerId" | "startDate" | "endDate" | "closedAt">;
export type ScheduleReport = Pick<Report, "kind" | "contractId" | "caseId" | "recipientUserId" | "week" | "month">;

export type ScheduleInput = {
  contract: { id: string; startsOn: LocalDate; endsOn: LocalDate | null; config: ContractConfig };
  /** Avtalets ärenden. */
  cases: readonly ScheduleCase[];
  /** Kommunens handläggare i avtalet (profiles.id) – mottagare av veckorapporterna. */
  caseworkerIds: readonly string[];
  /** Ärende och månad ("case-1:2027-01") där coachen godkänt månadsbedömningen. */
  approvedAssessments?: ReadonlySet<string>;
  /** Avtalets befintliga rapporter (alla versioner). */
  existing: readonly ScheduleReport[];
  /**
   * Perioder som slutar efter den här tidpunkten (exklusivt) räknas. Per rapporttyp eller samma för alla.
   * null = från avtalets start (hela historiken). Saknas typen i objektet: från avtalets start.
   */
  since: LocalDateTime | null | Partial<Record<AutoReportKind, LocalDateTime | null>>;
  now: LocalDateTime;
};

/** En rapportrad som ska finnas (allt utom id). */
export type PlannedReport = Omit<Report, "id">;

/** Fälten som inte sätts av reglerna – samma standardvärden som testdatat (src/data/seed/map.ts). */
const BLANK: Omit<Report, "id" | "contractId" | "kind" | "periodStart" | "periodEnd" | "status" | "version" | "dueAt"> = {
  caseId: null, recipientUserId: null, week: null, month: null, approvedBy: null, approvedAt: null, deliveredAt: null, deliveredTo: [], openedAt: null, openedBy: null,
  provisionalDue: false, pdfPath: null, aiSummaryDraft: null, summary: null, summaryAiUsed: false, finalText: null, previousId: null, correctionPending: null,
  superseded: false, supersededAt: null, supersededBy: null, correctionReason: null, correctedBy: null, correctedAt: null, qualityReviewedBy: null,
  qualityReviewedAt: null, snapshot: null,
};

// ---------------------------------------------------------------- Perioder
/** Tidpunkten då veckan som börjar `mon` är slut: måndag 00.00 veckan efter. */
export const weekEndsAt = (mon: LocalDate): LocalDateTime => `${addDays(mon, 7)}T00:00`;
/** Tidpunkten då månaden är slut: den 1:a 00.00 nästa månad. */
export const monthEndsAt = (mk: MonthKey): LocalDateTime => `${addMonths(mk, 1)}-01T00:00`;
/** Nästa tidpunkt efter t då en vecka eller månad tar slut (måndag 00.00 eller den 1:a 00.00). */
export function nextScheduleBoundary(t: LocalDateTime): LocalDateTime {
  const w = weekEndsAt(monday(dayOf(t)));
  const m = monthEndsAt(monthKey(t));
  return w < m ? w : m;
}

/** Antal kalenderdagar mellan from och to (inklusive) då ärendet är inskrivet – startdatum och slutdatum räknas med. */
export function enrolledDays(c: ScheduleCase, from: LocalDate, to: LocalDate): number {
  if (!c.startDate || c.status === "declined" || c.status === "received" || c.status === "acknowledged") return 0;
  const end = c.endDate ?? (c.status === "closed" && c.closedAt ? dayOf(c.closedAt) : null);
  const a = c.startDate > from ? c.startDate : from;
  const b = end && end < to ? end : to;
  return a > b ? 0 : diffDays(a, b) + 1;
}
/** Är ärendet inskrivet någon dag mellan from och to (inklusive)? */
export const enrolledBetween = (c: ScheduleCase, from: LocalDate, to: LocalDate): boolean => enrolledDays(c, from, to) > 0;

/** Nyckeln som de unika indexen i databasen speglar (0018_rapportutkast.sql; beställarrapporten 0026: avtal och månad). */
export function reportKey(r: ScheduleReport): string | null {
  if (r.kind === "weekly_attendance") return r.recipientUserId && r.week ? `weekly_attendance|${r.contractId}|${r.recipientUserId}|${r.week}` : null;
  if (r.kind === "monthly") return r.caseId && r.month ? `monthly|${r.contractId}|${r.caseId}|${r.month}` : null;
  if (r.kind === "customer_summary") return r.month ? `customer_summary|${r.contractId}|${r.month}` : null;
  return null;
}

const sinceFor = (since: ScheduleInput["since"], kind: AutoReportKind): LocalDateTime | null =>
  since === null || typeof since === "string" ? since : (since[kind] ?? null);
const inWindow = (endsAt: LocalDateTime, since: LocalDateTime | null, now: LocalDateTime) => endsAt <= now && (since == null || endsAt > since);

/** Rapporttyperna som avtalet skapar automatiskt. */
export const automaticKinds = (cfg: ContractConfig): AutoReportKind[] => AUTO_REPORT_KINDS.filter((k) => cfg.reportSchedule?.automatic.includes(k));

// ---------------------------------------------------------------- Raderna
/** Alla rapportrader som ska finnas för perioder som slutat i fönstret (även de som redan finns). Deterministisk ordning. */
export function plannedReports(input: ScheduleInput): PlannedReport[] {
  const { contract, now } = input;
  const cfg = contract.config;
  const kinds = automaticKinds(cfg);
  const slaCfg = { sla: cfg.sla ?? [] };
  const out: PlannedReport[] = [];
  const startMonday = monday(contract.startsOn);
  const startMonth = monthKey(contract.startsOn);
  const last = contract.endsOn ?? dayOf(now);
  /** Första veckan/månaden att pröva: avtalets start, eller strax före since. */
  const firstMonday = (since: LocalDateTime | null) => (since ? maxS(startMonday, addDays(monday(dayOf(since)), -7)) : startMonday);
  const firstMonth = (since: LocalDateTime | null) => (since ? maxS(startMonth, addMonths(monthKey(since), -1)) : startMonth);

  // ---- Veckorapport närvaro: per handläggare och vecka
  const pub = slaRule(cfg, "veckorapport_publicering");
  if (kinds.includes("weekly_attendance") && pub?.time) {
    const since = sinceFor(input.since, "weekly_attendance");
    const caseworkers = [...new Set(input.caseworkerIds)].sort();
    for (let mon = firstMonday(since); mon <= last && weekEndsAt(mon) <= now; mon = addDays(mon, 7)) {
      if (!inWindow(weekEndsAt(mon), since, now)) continue;
      const sun = addDays(mon, 6);
      const week = isoWeek(mon).key;
      for (const k of caseworkers) {
        if (!input.cases.some((c) => c.referrerId === k && enrolledBetween(c, mon, sun))) continue;
        out.push({
          ...BLANK, contractId: contract.id, kind: "weekly_attendance", recipientUserId: k, week, periodStart: mon, periodEnd: sun, status: "waiting", version: 1,
          // Testdatat: "system" godkänner veckorapporten (publiceras automatiskt) – approvedAt sätts vid publiceringen.
          dueAt: `${addDays(mon, 7 + (pub.weekday ?? 0))}T${pub.time}`, approvedBy: "system",
        });
      }
    }
  }

  // ---- Månadsrapport individ: per ärende och månad med minst minEnrolledDays inskrivna dagar
  const minDays = cfg.reportSchedule?.monthly?.minEnrolledDays;
  if (kinds.includes("monthly") && minDays && monthlyReportDueAt(slaCfg, startMonth)) {
    const since = sinceFor(input.since, "monthly");
    const provisionalDue = isProvisionalDue(slaCfg, "monthly");
    const cases = [...input.cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let mk = firstMonth(since); `${mk}-01` <= last && monthEndsAt(mk) <= now; mk = addMonths(mk, 1)) {
      if (!inWindow(monthEndsAt(mk), since, now)) continue;
      const from = `${mk}-01`;
      const to = monthEnd(mk);
      for (const c of cases) {
        // Färre dagar ger ingen rapport för månaden (Botkyrka: minst 11).
        if (enrolledDays(c, from, to) < minDays) continue;
        out.push({
          ...BLANK, contractId: contract.id, kind: "monthly", caseId: c.id, month: mk, periodStart: from, periodEnd: to, version: 1,
          status: input.approvedAssessments?.has(`${c.id}:${mk}`) ? "reviewed" : "draft", dueAt: monthlyReportDueAt(slaCfg, mk), provisionalDue,
        });
      }
    }
  }

  // ---- Beställarrapport: per avtal och månad (ingen mottagare)
  const due = cfg.reportSchedule?.customerSummaryDue;
  if (kinds.includes("customer_summary") && due) {
    const since = sinceFor(input.since, "customer_summary");
    for (let mk = firstMonth(since); `${mk}-01` <= last && monthEndsAt(mk) <= now; mk = addMonths(mk, 1)) {
      if (!inWindow(monthEndsAt(mk), since, now)) continue;
      out.push({
        ...BLANK, contractId: contract.id, kind: "customer_summary", recipientUserId: null, month: mk, periodStart: `${mk}-01`, periodEnd: monthEnd(mk), status: "draft", version: 1,
        // Beställarrapporten är alltid preliminär i vyerna (core/sla.ts isProvisionalDue) – raden har provisionalDue false som testdatat.
        dueAt: `${nthWorkingDay(addMonths(mk, 1), due.nthWorkingDay)}T${due.time}`,
      });
    }
  }
  return out;
}

/** Raderna som ska finnas men saknas (samma nyckel som de unika indexen; alla versioner av en befintlig rad räknas). */
export function missingReports(input: ScheduleInput): PlannedReport[] {
  const have = new Set(input.existing.map(reportKey).filter((k): k is string => k != null));
  return plannedReports(input).filter((r) => !have.has(reportKey(r) as string));
}

// ---------------------------------------------------------------- Vilka perioder en körning prövar
/**
 * Så långt bakåt (dagar) varje körning prövar perioderna även när allt redan är genomgånget: ett ärende som fått ett
 * startdatum i efterhand får sina rapporter. Inte ett avtalsvärde – en driftgräns som håller körningen liten.
 */
export const LOOKBACK_DAYS = 62;

/**
 * Perioder som slutar efter den här tidpunkten prövas (null = från avtalets start):
 *   checkedThrough  avtalets högvattenmärke – ctx.now() vid den senaste körningen där hela avtalet gicks igenom. Saknas
 *                   det (första körningen, eller automatiken slogs på i efterhand) prövas allt från avtalets start. Är det
 *                   äldre än fönstret (jobbet har stått still) prövas allt från märket – inget hoppas över.
 *   floor           testdatat är komplett hit (testklockans start): perioder som slutar senast då skapas aldrig. null i
 *                   produktionen.
 * Annars prövas de senaste LOOKBACK_DAYS dagarna. De unika indexen gör att en period som redan har sin rad inte skapas igen.
 */
export function scheduleFrom(o: { now: LocalDateTime; checkedThrough: LocalDateTime | null; floor: LocalDateTime | null }): LocalDateTime | null {
  const recent = addMinutes(o.now, -LOOKBACK_DAYS * 24 * 60);
  const lower = o.checkedThrough == null ? null : o.checkedThrough < recent ? o.checkedThrough : recent;
  return o.floor && (lower == null || lower < o.floor) ? o.floor : lower;
}

const maxS = <T extends string>(a: T, b: T): T => (a > b ? a : b);
