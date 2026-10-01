// Beställarrapport till kommunens chef (prototypens sel.customerSummary).
// Det interna målet visas aldrig för kunden: det tas bort ur resultatet och "under internt mål" blir "ok".
// Grupper under minsta antal (pulse.minNForAggregate) redovisas som "färre än 5".
import type { Db } from "@/data/schema";
import { kpiDef, levelIsClear, progressionFlags } from "./config";
import { attendanceStats, type AttendanceStats } from "./attendance";
import type { DomainEnv } from "./env";
import { resultRate, type ResultRate, type ResultStatus } from "./kpi";
import { areaName } from "./labels";
import { pulseStats, type PulseDb, type PulseStats } from "./pulse";
import { addMonths, dayOf, monthEnd, type MonthKey } from "./time";
import { by, groupBy } from "./util";

/** Resultat utan internt mål. */
export type CustomerResult = Omit<ResultRate, "internalTarget" | "status"> & { status: Exclude<ResultStatus, "below_internal"> };

export type CustomerSummary = {
  month: MonthKey;
  minN: number;
  active: number;
  started: number;
  closed: number;
  byArea: { code: string; name: string; active: number; started: number; closed: number }[];
  byTrack: { track: string; active: number }[];
  result: { rolling: CustomerResult; sinceStart: CustomerResult; month: CustomerResult; contractTarget: number | null };
  progression: { assessed: number; clear: number; any: number; areaDist: { key: string; label: string; clear: number; n: number }[] };
  attendanceRate: number | null;
  attendance: AttendanceStats;
  deviations: number;
  contractDeviations: number;
  pulse: PulseStats;
  seesSlaStats: boolean;
};

export type CustomerSummaryDb = Pick<Db, "cases" | "activities" | "attendance" | "monthly_assessments" | "deviations" | "contract_deviations" | "contract_areas"> & PulseDb;

/** Tar bort det interna målet ur ett resultat som ska till kunden. */
export function stripInternal(r: ResultRate): CustomerResult {
  const { internalTarget, status, ...rest } = r;
  void internalTarget;
  return { ...rest, status: status === "below_internal" ? "ok" : status };
}

/** Antal för kunden: 1 till minN − 1 visas som "färre än {minN}". */
export const smallCount = (n: number, minN: number): string => (n > 0 && n < minN ? `färre än ${minN}` : String(n));

export function customerSummary(db: CustomerSummaryDb, month: MonthKey, env: DomainEnv): CustomerSummary {
  const minN = env.cfg.pulse.minNForAggregate;
  const start = `${month}-01`;
  const end = monthEnd(month);
  const all = db.cases.filter((c) => c.startDate);
  const active = all.filter((c) => (c.startDate as string) <= end && (!c.endDate || c.endDate >= start));
  const startedSet = new Set(all.filter((c) => (c.startDate as string) >= start && (c.startDate as string) <= end).map((c) => c.id));
  const closedSet = new Set(all.filter((c) => c.status === "closed" && c.endDate != null && c.endDate >= start && c.endDate <= end).map((c) => c.id));
  const byArea = Object.entries(groupBy(active, (c) => String(c.primaryAreaCode)))
    .map(([code, cs]) => ({ code, name: areaName(db.contract_areas, code), active: cs.length, started: cs.filter((c) => startedSet.has(c.id)).length, closed: cs.filter((c) => closedSet.has(c.id)).length }))
    .sort(by("code"));
  const byTrack = Object.entries(groupBy(active, (c) => c.vocationalTrack))
    .map(([track, cs]) => ({ track, active: cs.length }))
    .sort(by("active", -1));
  const mas = db.monthly_assessments.filter((m) => m.month === month && m.status === "approved");
  // Tydlig/någon progression enligt avtalets gränser, bara på de obligatoriska områdena (beslut 2026-10-01).
  const flags = mas.map((m) => progressionFlags(env.cfg, m.areas));
  const clear = flags.filter((f) => f.clear).length;
  const any = flags.filter((f) => f.any).length;
  const areaDist = env.cfg.progression.areas.map((key) => ({
    key, label: env.cfg.progression.areaLabels[key] ?? key, clear: mas.filter((m) => levelIsClear(env.cfg, m.areas[key]?.level)).length, n: mas.length,
  }));
  const att = attendanceStats(db, null, start, end, env);
  const pulse = pulseStats(db, { from: `${addMonths(month, -2)}-01`, to: end }, env);
  const inMonth = (s: string) => dayOf(s) >= start && dayOf(s) <= end;
  return {
    month, minN, active: active.length, started: startedSet.size, closed: closedSet.size, byArea, byTrack,
    result: {
      rolling: stripInternal(resultRate(db, { window: "rolling_6m", to: end }, env)),
      sinceStart: stripInternal(resultRate(db, { from: env.contractStart, to: end }, env)),
      month: stripInternal(resultRate(db, { from: start, to: end }, env)),
      contractTarget: kpiDef(env.cfg, "resultatgrad")?.contractTarget ?? null,
    },
    progression: { assessed: mas.length, clear, any, areaDist },
    attendanceRate: att.rate,
    attendance: att,
    deviations: db.deviations.filter((x) => inMonth(x.createdAt)).length,
    contractDeviations: db.contract_deviations.filter((x) => inMonth(x.raisedAt)).length,
    pulse,
    seesSlaStats: env.cfg.customerVisibility.seesSlaStats ?? false,
  };
}
