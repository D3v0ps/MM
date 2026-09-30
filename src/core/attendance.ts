// Närvaro: statistik, oregistrerade tillfällen och upprepad ogiltig frånvaro (prototypens sel.attendanceStats m.fl.).
import type { Activity, Attendance, Case, Db } from "@/data/schema";
import type { OperationalConfig } from "./config";
import { activitiesOf, attendanceFor } from "./db-index";
import type { DomainEnv } from "./env";
import { addDays, dayOf, type LocalDate } from "./time";
import { by } from "./util";

export type AttendanceDb = Pick<Db, "activities" | "attendance">;

export type AttendanceStats = {
  /** Passerade tillfällen i perioden. */
  planned: number;
  present: number;
  late: number;
  absentValid: number;
  absentInvalid: number;
  unregistered: number;
  /** Giltig frånvaro per orsak. */
  reasons: Record<string, number>;
  /** Närvarograd = (närvarande + sena) / registrerade tillfällen. null om inget är registrerat. */
  rate: number | null;
};

/**
 * Närvarostatistik för ett ärende (eller alla aktiviteter i datat om caseId är null) mellan två datum (inklusive).
 * Bara tillfällen som redan har passerat räknas.
 */
export function attendanceStats(db: AttendanceDb, caseId: string | null, from: LocalDate, to: LocalDate, env: Pick<DomainEnv, "now">): AttendanceStats {
  const acts = (caseId ? activitiesOf(db, caseId) : db.activities).filter((a) => {
    const day = dayOf(a.startsAt);
    return day >= from && day <= to && a.startsAt < env.now;
  });
  const r: AttendanceStats = { planned: acts.length, present: 0, late: 0, absentValid: 0, absentInvalid: 0, unregistered: 0, reasons: {}, rate: null };
  for (const a of acts) {
    const at = attendanceFor(db, a.id);
    if (!at) {
      r.unregistered++;
      continue;
    }
    if (at.status === "present") r.present++;
    else if (at.status === "late") r.late++;
    else if (at.status === "absent_valid") {
      r.absentValid++;
      r.reasons[at.reason] = (r.reasons[at.reason] || 0) + 1;
    } else r.absentInvalid++;
  }
  const registered = r.planned - r.unregistered;
  r.rate = registered ? (r.present + r.late) / registered : null;
  return r;
}

export type UnregisteredItem = { activity: Activity; case: Case };

/** Passerade tillfällen utan registrerad närvaro för coachens ärenden (pågående och avslutade), i tidsordning. */
export function unregistered(db: AttendanceDb & Pick<Db, "cases">, coachId: string, from: LocalDate, to: LocalDate, env: Pick<DomainEnv, "now">): UnregisteredItem[] {
  const out: UnregisteredItem[] = [];
  for (const c of db.cases.filter((x) => x.leadCoachId === coachId && (x.status === "active" || x.status === "closed"))) {
    for (const a of activitiesOf(db, c.id)) {
      const day = dayOf(a.startsAt);
      if (day < from || day > to || a.startsAt >= env.now) continue;
      if (!attendanceFor(db, a.id)) out.push({ activity: a, case: c });
    }
  }
  return out.sort((x, y) => by<Activity>("startsAt")(x.activity, y.activity));
}

/**
 * Upprepad ogiltig frånvaro enligt avtalets regel (Botkyrka: 2 tillfällen inom 14 dagar).
 * Returnerar de ogiltiga frånvarotillfällena, eller null om regeln inte slår till.
 */
export function repeatedAbsence(db: AttendanceDb, caseId: string, env: Pick<DomainEnv, "now"> & { cfg: Pick<OperationalConfig, "attendance"> }): Attendance[] | null {
  const rule = env.cfg.attendance.repeatedAbsenceRule;
  const since = addDays(dayOf(env.now), -rule.withinDays);
  const inv = activitiesOf(db, caseId)
    .filter((a) => dayOf(a.startsAt) >= since)
    .map((a) => attendanceFor(db, a.id))
    .filter((x): x is Attendance => !!x && x.status === "absent_invalid");
  return inv.length >= rule.absentInvalid ? inv : null;
}
