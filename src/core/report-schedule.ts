// Rapportutkast som skapas automatiskt (rapportarbetet steg 1, beslut 2026-10-01). Ren domänlogik utan I/O: vilka
// rapportrader ska finnas när en period är slut, och vilka av dem saknas. Hanteraren (src/features/rapporter/ensure.ts)
// läser data, anropar funktionerna här och skriver raderna med ctx.system.
//
// Reglerna (avtalskonfigurationen, reportSchedule.automatic – CLAUDE.md punkt 4):
//   weekly_attendance  en per avtal, handläggare och ISO-vecka med minst ett inskrivet ärende hos handläggaren, när veckan
//                      är slut. Status waiting – publiceras av publishWeeklyIfComplete när all närvaro är registrerad.
//                      Sista dag: sla[veckorapport_publicering] (Botkyrka: måndag 16.00 veckan efter).
//   monthly            en per ärende och månad där ärendet är inskrivet minst en dag, när månaden är slut. Status draft
//                      (granskad om coachen redan godkänt månadsbedömningen – samma regel som coach/handlers.ts).
//                      Sista dag: sla[manadsrapport] (förslaget: 5:e arbetsdagen efter månadsskiftet kl. 23.59).
//   customer_summary   en per avtal, kommunens chef och månad, när månaden är slut. Status draft.
//                      Sista dag: reportSchedule.customerSummaryDue (förslaget: 8:e arbetsdagen kl. 16.00).
// Fälten blir exakt som testdatats rader (src/data/seed/gen-reports.ts): perioder, dueAt, provisionalDue och mottagare.
//
// Inskriven en dag = startdatum passerat och slutdatum inte passerat (samma regel som veckorapporten och faktureringen).
// Uppehåll (pausade veckor) räknas som inskriven tid: rapporten skapas och visar "Uppehåll". Ett avslutat ärende får
// inga rapporter efter slutdatumet.
//
// Perioden räknas när den är slut: veckan vid måndag 00.00 veckan efter, månaden vid den 1:a 00.00 nästa månad. Bara
// perioder som slutar efter `since` (per rapporttyp) räknas – raderna skapas framåt och historiken fylls aldrig i i efterhand.
import { AUTO_REPORT_KINDS, slaRule, type AutoReportKind, type ContractConfig } from "./config";
import { isProvisionalDue, monthlyReportDueAt } from "./sla";
import { addDays, addMonths, dayOf, isoWeek, monday, monthEnd, monthKey, nthWorkingDay, weekMonday, type LocalDate, type LocalDateTime, type MonthKey } from "./time";
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
  /** Kommunens chefer i avtalet (profiles.id) – mottagare av beställarrapporterna. */
  managerIds: readonly string[];
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

/** Är ärendet inskrivet någon dag mellan from och to (inklusive)? */
export function enrolledBetween(c: ScheduleCase, from: LocalDate, to: LocalDate): boolean {
  if (!c.startDate || c.status === "declined" || c.status === "received" || c.status === "acknowledged") return false;
  const end = c.endDate ?? (c.status === "closed" && c.closedAt ? dayOf(c.closedAt) : null);
  return c.startDate <= to && (!end || end >= from);
}

/** Nyckeln som de unika indexen i databasen speglar (supabase/migrations/0018_rapportutkast.sql). */
export function reportKey(r: ScheduleReport): string | null {
  if (r.kind === "weekly_attendance") return r.recipientUserId && r.week ? `weekly_attendance|${r.contractId}|${r.recipientUserId}|${r.week}` : null;
  if (r.kind === "monthly") return r.caseId && r.month ? `monthly|${r.contractId}|${r.caseId}|${r.month}` : null;
  if (r.kind === "customer_summary") return r.recipientUserId && r.month ? `customer_summary|${r.contractId}|${r.recipientUserId}|${r.month}` : null;
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

  // ---- Månadsrapport individ: per ärende och månad
  if (kinds.includes("monthly") && monthlyReportDueAt(slaCfg, startMonth)) {
    const since = sinceFor(input.since, "monthly");
    const provisionalDue = isProvisionalDue(slaCfg, "monthly");
    const cases = [...input.cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let mk = firstMonth(since); `${mk}-01` <= last && monthEndsAt(mk) <= now; mk = addMonths(mk, 1)) {
      if (!inWindow(monthEndsAt(mk), since, now)) continue;
      const from = `${mk}-01`;
      const to = monthEnd(mk);
      for (const c of cases) {
        if (!enrolledBetween(c, from, to)) continue;
        out.push({
          ...BLANK, contractId: contract.id, kind: "monthly", caseId: c.id, month: mk, periodStart: from, periodEnd: to, version: 1,
          status: input.approvedAssessments?.has(`${c.id}:${mk}`) ? "reviewed" : "draft", dueAt: monthlyReportDueAt(slaCfg, mk), provisionalDue,
        });
      }
    }
  }

  // ---- Beställarrapport: per kommunens chef och månad
  const due = cfg.reportSchedule?.customerSummaryDue;
  if (kinds.includes("customer_summary") && due) {
    const since = sinceFor(input.since, "customer_summary");
    const managers = [...new Set(input.managerIds)].sort();
    for (let mk = firstMonth(since); `${mk}-01` <= last && monthEndsAt(mk) <= now; mk = addMonths(mk, 1)) {
      if (!inWindow(monthEndsAt(mk), since, now)) continue;
      for (const k of managers) {
        out.push({
          ...BLANK, contractId: contract.id, kind: "customer_summary", recipientUserId: k, month: mk, periodStart: `${mk}-01`, periodEnd: monthEnd(mk), status: "draft", version: 1,
          // Beställarrapporten är alltid preliminär i vyerna (core/sla.ts isProvisionalDue) – raden har provisionalDue false som testdatat.
          dueAt: `${nthWorkingDay(addMonths(mk, 1), due.nthWorkingDay)}T${due.time}`,
        });
      }
    }
  }
  return out;
}

/** Raderna som ska finnas men saknas (samma nyckel som de unika indexen; alla versioner av en befintlig rad räknas). */
export function missingReports(input: ScheduleInput): PlannedReport[] {
  const have = new Set(input.existing.map(reportKey).filter((k): k is string => k != null));
  return plannedReports(input).filter((r) => !have.has(reportKey(r) as string));
}

/**
 * Var de automatiska raderna slutar i dag: per rapporttyp tidpunkten då den senaste perioden med en rad tog slut, eller
 * null om typen saknar rader. Används som since när det inte finns någon tidigare körning – då fylls historiken (t.ex.
 * testdatats rapporter) aldrig i, men allt som slutar efter den senaste raden skapas.
 */
export function reportFrontier(existing: readonly ScheduleReport[]): Record<AutoReportKind, LocalDateTime | null> {
  const out: Record<AutoReportKind, LocalDateTime | null> = { weekly_attendance: null, monthly: null, customer_summary: null };
  for (const r of existing) {
    let end: LocalDateTime | null = null;
    if (r.kind === "weekly_attendance" && r.week) end = weekEndsAt(weekMonday(r.week));
    else if ((r.kind === "monthly" || r.kind === "customer_summary") && r.month) end = monthEndsAt(r.month);
    if (!end) continue;
    const k = r.kind as AutoReportKind;
    if (!out[k] || end > (out[k] as string)) out[k] = end;
  }
  return out;
}

const maxS = <T extends string>(a: T, b: T): T => (a > b ? a : b);
