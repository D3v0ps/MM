// KPI:er (SPEC §7.12): resultatgrad med fönster och minsta antal, prognos, trend och månads-KPI:er.
// Mål, fönster och minN läses från avtalskonfigurationen (kpis). Internt mål som är ATT_FASTSTÄLLA ger status "no_target".
import type { Case, Db, ResultClass } from "@/data/schema";
import { isUnset, kpiDef, slaWithin, type KpiWindow } from "./config";
import { attendanceStats } from "./attendance";
import { groupedBy } from "./db-index";
import { windowStart, type DomainEnv } from "./env";
import { avropDue, firstMeetingDue } from "./sla";
import { addMonths, dayOf, monthEnd, monthKey, type LocalDate, type MonthKey } from "./time";

type KpiEnv = Pick<DomainEnv, "cfg" | "now" | "contractStart">;
const RESULT_KEY = "resultatgrad";

export type ResultStatus = "ok" | "below_internal" | "below_contract" | "insufficient";
export type ResultRate = {
  /** Andel avslut med verifierat resultat av avslut som räknas. null om inga avslut räknas. */
  value: number | null;
  /** Verifierade resultat. */
  num: number;
  /** Avslut som räknas (utom de som inte ska räknas i nämnaren). */
  den: number;
  /** Resultat som inte är verifierade ännu (preliminära). */
  prelim: number;
  excluded: number;
  closed: number;
  status: ResultStatus;
  minN: number;
  contractTarget: number | null;
  internalTarget: number | null;
};

/** Räkningen bakom resultatgraden för en lista av avslut (samma för KPI:n på ärendena och rapportbyggaren på frysta fakta). */
export type ResultTally = {
  /** Verifierade resultat (resultClass "result" och verifierat). */
  num: number;
  /** Avslut som räknas: alla utom "excluded" – ett avslut utan resultatklass (null) räknas med. */
  den: number;
  /** Resultat som inte är verifierade ännu. */
  prelim: number;
  excluded: number;
  closed: number;
  /** Avslut utan resultatklass (räknas i nämnaren men aldrig i täljaren). */
  missing: number;
  value: number | null;
};
export function resultTally(xs: readonly { resultClass: ResultClass | null; verified: boolean }[]): ResultTally {
  const counted = xs.filter((x) => x.resultClass !== "excluded");
  const num = counted.filter((x) => x.resultClass === "result" && x.verified).length;
  const prelim = counted.filter((x) => x.resultClass === "result" && !x.verified).length;
  return {
    num, den: counted.length, prelim, excluded: xs.length - counted.length, closed: xs.length, missing: xs.filter((x) => x.resultClass === null).length,
    value: counted.length ? num / counted.length : null,
  };
}

export type ResultRateOpts = { window?: KpiWindow; coachId?: string | null; area?: string | null; from?: LocalDate | null; to?: LocalDate | null };

/** Resultatgrad = avslut med verifierat resultat / avslut som räknas, i fönstret (standard rullande 6 månader). */
export function resultRate(db: Pick<Db, "cases">, opts: ResultRateOpts, env: KpiEnv): ResultRate {
  const { window = "rolling_6m", coachId = null, area = null, from = null, to = null } = opts;
  const start = from || windowStart(window, env);
  const end = to || dayOf(env.now);
  const closed = db.cases.filter(
    (c) => c.status === "closed" && c.endDate != null && c.endDate >= start && c.endDate <= end && (!coachId || c.leadCoachId === coachId) && (!area || c.primaryAreaCode === area),
  );
  const t = resultTally(closed.map((c) => ({ resultClass: c.resultClass ?? null, verified: !!c.resultVerifiedAt })));
  const k = kpiDef(env.cfg, RESULT_KEY);
  const minN = k?.minN ?? 0;
  const contractTarget = k?.contractTarget ?? null;
  const internalTarget = typeof k?.internalTarget === "number" ? k.internalTarget : null;
  const value = t.value;
  let status: ResultStatus = "ok";
  if (t.den < minN) status = "insufficient";
  else if (value != null && contractTarget != null && value < contractTarget) status = "below_contract";
  else if (value != null && internalTarget != null && value < internalTarget) status = "below_internal";
  return { value, num: t.num, den: t.den, prelim: t.prelim, excluded: t.excluded, closed: t.closed, status, minN, contractTarget, internalTarget };
}

export type ResultForecast = {
  /** Om alla i fas 5 eller med arbetserbjudande (och alla preliminära) når resultat. */
  value: number | null;
  candidates: number;
  withOffer: number;
  /** Om bara de med arbetserbjudande (och alla preliminära) når resultat. */
  offerOnly: number | null;
  prelim: number;
};

/** Prognos: om deltagare med arbetserbjudande eller i fas 5 når resultat (rullande 6 månader). */
export function resultForecast(db: Pick<Db, "cases" | "outcome_events">, env: KpiEnv): ResultForecast {
  const base = resultRate(db, { window: "rolling_6m" }, env);
  const events = groupedBy(db.outcome_events, "caseId", (e) => e.caseId);
  const hasOffer = (c: Case) => (events.get(c.id) ?? []).some((e) => e.kind === "arbetserbjudande");
  const candidates = db.cases.filter((c) => c.status === "active" && (c.phase === 5 || hasOffer(c)));
  const withOffer = candidates.filter(hasOffer);
  const div = (n: number, d: number) => (d ? n / d : null);
  return {
    value: div(base.num + base.prelim + candidates.length, base.den + candidates.length),
    candidates: candidates.length,
    withOffer: withOffer.length,
    offerOnly: div(base.num + base.prelim + withOffer.length, base.den + withOffer.length),
    prelim: base.prelim,
  };
}

export type ResultTrendPoint = ResultRate & { month: MonthKey; cumulative: number | null; cumulativeN: number };

/** Resultatgrad per avslutad månad sedan avtalets start, med kumulativt värde. */
export function resultTrend(db: Pick<Db, "cases">, env: KpiEnv): ResultTrendPoint[] {
  const out: ResultTrendPoint[] = [];
  for (let mk = monthKey(env.contractStart); mk < monthKey(env.now); mk = addMonths(mk, 1)) {
    const r = resultRate(db, { from: `${mk}-01`, to: monthEnd(mk) }, env);
    const cum = resultRate(db, { from: env.contractStart, to: monthEnd(mk) }, env);
    out.push({ month: mk, ...r, cumulative: cum.value, cumulativeN: cum.den });
  }
  return out;
}

export type KpiStatus = "ok" | "below_internal" | "no_data" | "no_target" | ResultStatus;
export type KpiValue = {
  key: string;
  label: string;
  value: number | null;
  num: number;
  den: number;
  /** Internt mål, null om det inte är fastställt. */
  target: number | null;
  targetUnset?: boolean;
  status: KpiStatus;
  /** Resultatgrad: avtalsmålet och preliminära resultat. */
  contractTarget?: number | null;
  prelim?: number;
  /** Ärenden som inte klarade tidsgränsen (avrop, första möte). */
  late?: Case[];
  /** Tidsgränsen bygger på ett förslag som inte är fastställt. */
  provisional?: boolean;
  absentValid?: number;
  absentInvalid?: number;
  /** Nöjdhet: aggregat visas först från så här många svar. */
  minN?: number;
};

export type KpiDb = Pick<Db, "cases" | "reports" | "activities" | "attendance" | "pulse_responses">;
export type KpiOpts = { month?: MonthKey; coachId?: string | null };

/** Värdet för en KPI i en månad (standard: förra månaden). null för KPI:er som inte räknas fram här. */
export function kpiValue(db: KpiDb, key: string, opts: KpiOpts, env: KpiEnv): KpiValue | null {
  const month = opts.month ?? addMonths(monthKey(env.now), -1);
  const coachId = opts.coachId ?? null;
  const k = kpiDef(env.cfg, key);
  if (!k) return null;
  const label = k.label ?? key;
  const rawTarget = k.internalTarget;
  const target = typeof rawTarget === "number" ? rawTarget : null;
  const unset = isUnset(rawTarget);
  const wrap = (num: number, den: number, extra: Partial<KpiValue> = {}): KpiValue => {
    const value = den ? num / den : null;
    const status: KpiStatus = den === 0 ? "no_data" : target == null ? "no_target" : value != null && value < target ? "below_internal" : "ok";
    return { key, label, value, num, den, target, targetUnset: unset, status, ...extra };
  };
  const monthCases = () => db.cases.filter((c) => monthKey(c.referredAt) === month);
  const inTime = (kind: "weekly_attendance" | "monthly") => {
    const rs = db.reports.filter((r) => r.kind === kind && r.dueAt != null && monthKey(r.dueAt) === month && r.dueAt < env.now);
    return [rs.filter((r) => r.deliveredAt && r.dueAt && r.deliveredAt <= r.dueAt).length, rs.length] as const;
  };

  switch (key) {
    case "avrop_besvarade_i_tid": {
      const answered = (c: Case) => (c.confirmedAt || c.declinedAt) as string;
      const cs = monthCases().filter((c) => (c.confirmedAt || c.declinedAt) && avropDue(c, env.cfg));
      const isLate = (c: Case) => answered(c) > (avropDue(c, env.cfg) as string);
      return wrap(cs.filter((c) => !isLate(c)).length, cs.length, { late: cs.filter(isLate) });
    }
    case "forsta_mote_inom_en_vecka": {
      if (!slaWithin(env.cfg, "forsta_mote")) return wrap(0, 0);
      const cs = monthCases().filter((c) => c.firstMeetingAt);
      const isLate = (c: Case) => (c.firstMeetingAt as string) > (firstMeetingDue(c, env.cfg) as string);
      return wrap(cs.filter((c) => !isLate(c)).length, cs.length, { late: cs.filter(isLate) });
    }
    case "veckorapporter_i_tid": {
      const [num, den] = inTime("weekly_attendance");
      return wrap(num, den);
    }
    case "manadsrapporter_i_tid": {
      const [num, den] = inTime("monthly");
      return wrap(num, den, { provisional: true });
    }
    case "narvarograd": {
      const st = attendanceStats(db, null, `${month}-01`, monthEnd(month), env);
      return wrap(st.present + st.late, st.planned - st.unregistered, { absentValid: st.absentValid, absentInvalid: st.absentInvalid });
    }
    case "nojdhet": {
      const from = windowStart("rolling_3m", env);
      const rs = db.pulse_responses.filter((x) => x.submittedAt >= from && (!coachId || x.coachId === coachId));
      return wrap(rs.filter((x) => x.answers.q1 >= 4).length, rs.length, { minN: env.cfg.pulse.minNForAggregate });
    }
    case RESULT_KEY: {
      const r = resultRate(db, { window: "rolling_6m", coachId }, env);
      return { key, label, value: r.value, num: r.num, den: r.den, target, contractTarget: r.contractTarget, status: r.status, prelim: r.prelim };
    }
    default:
      return null;
  }
}

/** Alla avtalets KPI:er som räknas fram (i konfigurationens ordning). */
export function kpis(db: KpiDb, opts: KpiOpts, env: KpiEnv): KpiValue[] {
  return env.cfg.kpis.map((k) => kpiValue(db, k.key, opts, env)).filter((x): x is KpiValue => x != null);
}
