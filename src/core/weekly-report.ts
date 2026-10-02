// Veckorapport närvaro: en per handläggare och vecka, en sektion per deltagare (prototypens sel.weeklyReport).
// Rapporten publiceras automatiskt när all närvaro för handläggarens deltagare är registrerad (complete).
import type { Activity, Attendance, Case, Db, Deviation } from "@/data/schema";
import { attendanceStats, type AttendanceStats } from "./attendance";
import { activitiesOf, attendanceFor } from "./db-index";
import type { DomainEnv } from "./env";
import { addDays, dayOf, weekMonday, type LocalDate, type WeekKey } from "./time";

export type WeeklyReportRisk = "Risk för avbrott – uppföljningsmöte föreslås" | "Bevakas" | "Ingen risk noterad";
export type WeeklyReportSection = {
  case: Case;
  rows: { activity: Activity; att: Attendance | null }[];
  stats: AttendanceStats;
  paused: boolean;
  deviations: Deviation[];
  risk: WeeklyReportRisk;
};
export type WeeklyReport = {
  recipientId: string;
  weekKey: WeekKey;
  monday: LocalDate;
  sunday: LocalDate;
  sections: WeeklyReportSection[];
  /** All närvaro för veckans passerade tillfällen är registrerad. */
  complete: boolean;
};

export type WeeklyReportDb = Pick<Db, "cases" | "activities" | "attendance" | "deviations">;

/** Risknivå ur antalet ogiltiga frånvarotillfällen i veckan. */
export const weeklyRisk = (absentInvalid: number): WeeklyReportRisk =>
  absentInvalid >= 2 ? "Risk för avbrott – uppföljningsmöte föreslås" : absentInvalid === 1 ? "Bevakas" : "Ingen risk noterad";

/** Veckorapporten till en handläggare: hennes deltagare som var inskrivna någon dag under veckan. */
export function weeklyReport(db: WeeklyReportDb, recipientId: string, weekKey: WeekKey, env: Pick<DomainEnv, "now">): WeeklyReport {
  const mon = weekMonday(weekKey);
  const sun = addDays(mon, 6);
  const cases = db.cases.filter((c) => c.referrerId === recipientId && c.startDate && c.startDate <= sun && (!c.endDate || c.endDate >= mon));
  const sections = cases.map((c): WeeklyReportSection => {
    const acts = activitiesOf(db, c.id).filter((a) => a.startsAt >= mon && a.startsAt <= `${sun}T23:59`);
    const stats = attendanceStats(db, c.id, mon, sun, env);
    const deviations = db.deviations.filter((x) => x.caseId === c.id && dayOf(x.createdAt) >= mon && dayOf(x.createdAt) <= sun);
    return {
      case: c,
      rows: acts.map((a) => ({ activity: a, att: attendanceFor(db, a.id) })),
      stats,
      paused: c.pausedWeeks.includes(weekKey),
      deviations,
      risk: weeklyRisk(stats.absentInvalid),
    };
  });
  return { recipientId, weekKey, monday: mon, sunday: sun, sections, complete: sections.every((s) => s.stats.unregistered === 0) };
}
