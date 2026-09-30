// Pulsmätning: aggregat över svaren (prototypens sel.pulseStats). Enskilda svar visas aldrig –
// aggregat visas först från avtalets minsta antal (pulse.minNForAggregate). Hanteraren räknar via ctx.system.
import type { Db, PulsePriority } from "@/data/schema";
import { byId } from "./db-index";
import { windowStart, type DomainEnv } from "./env";
import type { LocalDate } from "./time";
import { groupBy } from "./util";

export type PulseStats = {
  invites: number;
  responses: number;
  /** Andel av utskicken i perioden som besvarats. */
  responseRate: number | null;
  /** Fördelning 1–5 per fråga. */
  q1: number[];
  q2: number[];
  q3: number[];
  /** Andel 4–5 på fråga 1 (nöjdhet), 2 (närmare jobb/studier) och 3 (stöd från coachen). */
  satisfaction: number | null;
  closer: number | null;
  support: number | null;
  /** Fråga 4: vad deltagarna vill prioritera. */
  priorities: Partial<Record<PulsePriority, number>>;
  /** Tillräckligt många svar för att visa aggregat. */
  enough: boolean;
  minN: number;
};

export type PulseDb = Pick<Db, "pulse_invites" | "pulse_responses" | "cases"> & Partial<Pick<Db, "demo_tags">>;
export type PulseOpts = { from?: LocalDate | null; to?: LocalDate | null; coachId?: string | null };

/**
 * Aggregat för pulsmätningen i perioden (standard: rullande 3 månader). Utskick som bara finns för prototypens
 * genomgång (pulslänken i demo_tags) räknas inte.
 */
export function pulseStats(db: PulseDb, opts: PulseOpts, env: Pick<DomainEnv, "cfg" | "now" | "contractStart">): PulseStats {
  const from = opts.from || windowStart("rolling_3m", env);
  const end = opts.to ? `${opts.to}T23:59` : "9999";
  const coachId = opts.coachId ?? null;
  const demo = new Set((db.demo_tags ?? []).filter((t) => t.entity === "pulse_invites").flatMap((t) => t.entityIds));
  const cases = byId(db.cases);
  const inv = db.pulse_invites.filter(
    (x) => x.sentAt >= from && x.sentAt <= end && !demo.has(x.id) && (!coachId || cases.get(x.caseId)?.leadCoachId === coachId),
  );
  const rs = db.pulse_responses.filter((x) => x.submittedAt >= from && x.submittedAt <= end && (!coachId || x.coachId === coachId));
  const dist = (q: "q1" | "q2" | "q3") => [1, 2, 3, 4, 5].map((v) => rs.filter((x) => x.answers[q] === v).length);
  const share45 = (q: "q1" | "q2" | "q3") => (rs.length ? rs.filter((x) => x.answers[q] >= 4).length / rs.length : null);
  const invIds = new Set(inv.map((i) => i.id));
  const minN = env.cfg.pulse.minNForAggregate;
  return {
    invites: inv.length,
    responses: rs.length,
    responseRate: inv.length ? rs.filter((x) => invIds.has(x.inviteId)).length / inv.length : null,
    q1: dist("q1"),
    q2: dist("q2"),
    q3: dist("q3"),
    satisfaction: share45("q1"),
    closer: share45("q2"),
    support: share45("q3"),
    priorities: Object.fromEntries(Object.entries(groupBy(rs, (x) => x.answers.q4)).map(([k, v]) => [k, v.length])),
    enough: rs.length >= minN,
    minN,
  };
}
