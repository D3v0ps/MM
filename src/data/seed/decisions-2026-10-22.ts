// Steg efter mappningen: Karims beslut 2026-10-22 i testdatat (påhittade uppgifter). Prototypens tillstånd (createProtoState)
// och generatorerna ändras inte, så slumpen och ordningen ligger kvar.
//
//   Byt yrkesområde   Linnea Olssons ärende (BOT-26-0163, huvudcoach Amira) bytte yrkesområde från G Lager och logistik till
//                     D Kök, restaurang och måltidsservice den 27 januari, med en motivering i deltagarkortet. Fakturan räknas
//                     på G till och med januari och på D från februari (case_area_changes, 0036). Det alternativa yrkesområdet
//                     (D) blev det nya och togs bort som alternativ. Paritetstestet mot den gamla prototypen jämför testdatat
//                     utan bytet (withoutAreaChanges nedan).
//   Automatisk        januaris utkast till månadsbedömning (månaden att bedöma vid demoklockan) är ifyllda som jobbet fyller i
//   månadsbedömning   dem (src/core/monthly-prefill.ts): progressionsnivå 0 "Automatiskt – inget belägg" i varje område, samlad
//                     status från den senaste godkända mötesrapporten, sammanfattningen (AI-utkastet när det finns, annars ur
//                     godkända uppgifter) och planen (senaste veckomålet och förra månadens plan) – märkta "Ifyllt automatiskt".
//                     AI:s nivåförslag (deltagare med samtycke) räknas med den simulerade AI:n på testdatat och gäller bara med
//                     ett citat som finns i underlaget (verifyLevelSuggestion) – de slumpade förslagen utan belägg är borta.
//                     De godkända bedömningarna ändras inte (äldre rader – nivån är coachens val).
import { attendanceStats } from "@/core/attendance";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { autoArea, prefillAssessment, previousMonth } from "@/core/monthly-prefill";
import { approvedCheckIns, areaChangeNoteIds, draftNotes, verifyLevelSuggestion, type DraftInput } from "@/features/_shared/ai-port";
import { simulatedDraft } from "@/features/_shared/ai-sim";
import { monthEnd, monthKey } from "@/core/time";
import type { CaseAreaChange, CaseNote, Db } from "../schema";
import { NOW } from "./constants";

/** Månaden att bedöma vid demoklockan (1 februari 2027). */
const ASSESS_MONTH = "2027-01";

/** Bytet av yrkesområde i testdatat. */
export const SEED_AREA_CHANGES: readonly CaseAreaChange[] = [
  {
    id: "cac-seed-linnea", contractId: "c-bot", caseId: "case-260163", fromArea: "G", toArea: "D", effectiveMonth: "2027-02", changedBy: "u-amira",
    changedAt: "2027-01-27T14:10", noteId: "note-byte-linnea", seq: 1,
  },
];
/** Ärendets alternativa yrkesområde före bytet (det blev det nya). */
const SECONDARY_BEFORE: Record<string, string | null> = { "case-260163": "D" };

const motivation = (x: CaseAreaChange): CaseNote => ({
  id: x.noteId, contractId: x.contractId, caseId: x.caseId, authorId: x.changedBy, occurredOn: x.changedAt.slice(0, 10), kind: "other", audience: "team",
  body: "Byte av yrkesområde: G Lager och logistik → D Kök, restaurang och måltidsservice. Kartläggningen visade erfarenhet från storkök och ett tydligt mål att arbeta i kök.",
  createdAt: x.changedAt, updatedAt: null, removedAt: null, removedBy: null,
});

export function applyDecisions20261022(db: Db): void {
  // ---- Byt yrkesområde
  for (const x of SEED_AREA_CHANGES) {
    const c = db.cases.find((k) => k.id === x.caseId);
    if (!c) continue;
    db.case_notes.push(motivation(x));
    db.case_area_changes.push({ ...x });
    c.primaryAreaCode = x.toArea;
    if (c.secondaryAreaCode === x.toArea) c.secondaryAreaCode = null;
  }

  // ---- Automatisk månadsbedömning: januaris utkast
  const cfg = BOTKYRKA_CONFIG.progression;
  for (const ma of db.monthly_assessments.filter((m) => m.month === ASSESS_MONTH && m.status === "draft")) {
    const c = db.cases.find((k) => k.id === ma.caseId);
    if (!c) continue;
    const checkIns = db.check_ins.filter((x) => x.caseId === c.id);
    const att = attendanceStats(db, c.id, `${ASSESS_MONTH}-01`, monthEnd(ASSESS_MONTH), { now: NOW });
    const prev = db.monthly_plans.find((p) => p.caseId === c.id && p.month === previousMonth(ASSESS_MONTH)) ?? null;
    const pre = prefillAssessment({
      month: ASSESS_MONTH, areaKeys: cfg.areas, checkIns, attendance: att, previousPlan: prev, ai: { summary: ma.aiSummaryDraft, plan: null },
    });
    // AI:s nivåförslag med belägg (bara med samtycke – samma underlag som jobbet draft_monthly).
    const person = db.persons.find((p) => p.id === c.personId);
    const consent = c.aiConsentStatus === "given" && !!person && !person.protectedIdentity;
    const input: DraftInput | null = consent
      ? {
          caseId: c.id, month: ASSESS_MONTH, checkIns: approvedCheckIns(checkIns.filter((x) => monthKey(x.heldAt) === ASSESS_MONTH)),
          attendance: db.activities
            .filter((a) => a.caseId === c.id && monthKey(a.startsAt) === ASSESS_MONTH && a.startsAt < NOW)
            .map((a) => db.attendance.find((x) => x.activityId === a.id))
            .filter((x): x is NonNullable<typeof x> => !!x)
            .map((x) => ({ status: x.status })),
          notes: draftNotes(db.case_notes.filter((n) => n.caseId === c.id), ASSESS_MONTH, { exclude: areaChangeNoteIds(db.case_area_changes.filter((x) => x.caseId === c.id)) }),
        }
      : null;
    const areas = { ...ma.areas };
    for (const key of cfg.areas) {
      const cur = areas[key];
      // Källorna heter "Mötesrapport <dag>" som nivåförslagets belägg (prototypens testdata skrev "Avstämning <dag>").
      const proto = consent ? (cur?.aiObservationDraft ?? null) : null;
      const obs = proto ? { ...proto, sources: proto.sources.map((x) => x.replace(/^Avstämning /, "Mötesrapport ")) } : null;
      const raw = input && obs && !obs.noEvidence ? simulatedDraft(input, `monthly_area:${key}`).levelSuggestion : null;
      const v = raw && input ? verifyLevelSuggestion(raw, input) : null;
      areas[key] = { ...autoArea({ aiObservationDraft: obs, aiLevelSuggestion: v?.level ?? null, aiLevelEvidence: v?.evidence ?? null }), nextStep: cur?.nextStep ?? "" };
    }
    ma.areas = areas;
    ma.overallStatus = pre.overallStatus;
    ma.summary = pre.summary;
    ma.prefill = pre.prefill;
    // Planen för februari: de förifyllda fälten (märkta), övriga som i testdatat.
    const plan = db.monthly_plans.find((p) => p.caseId === c.id && p.month === ASSESS_MONTH);
    if (plan && plan.status === "draft") {
      for (const k of Object.keys(pre.prefill.plan ?? {}) as (keyof NonNullable<typeof pre.prefill.plan>)[]) plan[k] = pre.plan[k];
    }
  }
}

/**
 * Testdatat utan bytet av yrkesområde (paritetstestet mot den gamla prototypen, src/core/parity.test.ts): ärendets yrkesområden
 * som före bytet och inga byten. Anteckningen med motiveringen ligger kvar – paritetsavsnitten läser inga anteckningar.
 */
export function withoutAreaChanges(db: Db): Db {
  const changed = new Map(SEED_AREA_CHANGES.map((x) => [x.caseId, x]));
  return {
    ...db,
    case_area_changes: db.case_area_changes.filter((x) => !SEED_AREA_CHANGES.some((s) => s.id === x.id)),
    cases: db.cases.map((c) => {
      const x = changed.get(c.id);
      return x ? { ...c, primaryAreaCode: x.fromArea, secondaryAreaCode: SECONDARY_BEFORE[c.id] ?? c.secondaryAreaCode } : c;
    }),
  };
}
