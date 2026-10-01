// Frysta fakta för kommunens resultatfil (rapporter steg 3). Bara koder, tal, sanningsvärden och ISO-datum – inga namn och
// ingen fritext (observationer, sammanfattning, avvikelsetexter, händelsernas anteckningar och aktör, planen, frånvaroorsaker).
// Fakta byggs i samma pass och med samma datakälla som rapportens modell (model.ts: buildMonthlyFacts, buildFinalFacts) och
// fryses i reports.snapshot.facts när rapporten levereras (freeze.ts). Rena funktioner – bara för hanterare och tester.
//
// Den här filen innehåller också omvändningen från en fryst modell (snapshot.model) till fakta: rapporter som frystes före
// steg 3 har bara modellen, och fakta som räknas fram i efterhand har dagens värden i ärendefälten (avtalsområde, yrkesspår,
// datum, fas, uppehåll) och i underlag som ändrats efter leveransen (närvaro som registrerats om, en bedömning som godkänts
// igen). reconcileMonthlyFacts/reconcileFinalFacts tar då värdena ur den frysta modellen – det kommunen fick.
import { z } from "zod";
import { MONTHS, monthEnd, type LocalDate } from "@/core/time";
import { END_REASONS, OUTCOME_EVENT_KINDS, RESULT_CLASSES, TRAFFIC_LIGHTS, type ContractArea, type OutcomeEvent } from "@/data/schema";
import { progressionFlags, type OperationalConfig } from "@/core/config";
import type { FinalModel, MonthlyModel } from "./model";
import { dFull, plain, ucfirst } from "./report-helpers";

export const FACTS_VERSION = 1 as const;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Month = z.string().regex(/^\d{4}-\d{2}$/);
const N = z.int().min(0);
const Level = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const MonthlyFactsSchema = z.strictObject({
  factsVersion: z.literal(FACTS_VERSION),
  kind: z.literal("monthly"),
  caseNumber: z.string().min(1),
  month: Month,
  /** Beställarens enhet (profilens enhet, annars ärendets). */
  referrerUnit: z.string().nullable(),
  primaryAreaCode: z.string().nullable(),
  secondaryAreaCode: z.string().nullable(),
  /** Yrkesspåret (fritext i ärendet – ingen kodlista ännu). Tomt = null. */
  vocationalTrack: z.string().nullable(),
  startDate: Day.nullable(),
  plannedEnd: Day.nullable(),
  /** Avslutad senast vid leveransen. */
  endDate: Day.nullable(),
  /** Fasen vid månadens slut: senaste godkända avstämningen, annars ärendets fas. */
  phase: z.int().min(1).nullable(),
  /** Veckoraderna i rapportens avsnitt 2 (ISO-veckor helt eller delvis i månaden och under insatsen, uppehåll inräknade). */
  weeks: N,
  /** De av veckorna som är uppehåll. */
  pausedWeeks: N,
  attendance: z.strictObject({ planned: N, present: N, late: N, absentValid: N, absentInvalid: N, unregistered: N, rate: z.number().min(0).max(1).nullable() }),
  repeatedAbsence: z.boolean(),
  checkInsApproved: N,
  /** Summan av avstämningarnas svar ("2 eller fler" räknas som 2) – ett minsta antal. */
  employerContacts: N,
  goals: z.strictObject({ yes: N, partly: N, no: N }),
  assessmentApproved: z.boolean(),
  /** Nivå per obligatoriskt område (bara när bedömningen är godkänd – annars tomt). Aldrig de valfria områdena. */
  levels: z.record(z.string(), Level.nullable()),
  /** Antal obligatoriska områden med nivå. null när bedömningen inte är godkänd. */
  areasAssessed: N.nullable(),
  progressionClear: z.boolean().nullable(),
  progressionAny: z.boolean().nullable(),
  overallStatus: z.enum(TRAFFIC_LIGHTS).nullable(),
  assessmentDate: Day.nullable(),
  events: z.array(z.strictObject({ kind: z.enum(OUTCOME_EVENT_KINDS), date: Day, verified: z.boolean() })),
  /** Avvikelser som registrerades under månaden. */
  deviationsNew: N,
  /** Avvikelser som var öppna vid månadens slut. */
  deviationsOpen: N,
  needsCustomerDecision: z.boolean(),
});
export type MonthlyFacts = z.infer<typeof MonthlyFactsSchema>;

export const FinalFactsSchema = z.strictObject({
  factsVersion: z.literal(FACTS_VERSION),
  kind: z.literal("final"),
  caseNumber: z.string().min(1),
  endDate: Day.nullable(),
  endReason: z.enum(END_REASONS).nullable(),
  resultClass: z.enum(RESULT_CLASSES).nullable(),
  /** Verifieringen enligt den levererade slutrapporten (beslut sätt a). */
  resultVerified: z.boolean(),
  resultVerifiedAt: Day.nullable(),
});
export type FinalFacts = z.infer<typeof FinalFactsSchema>;
export type ReportFacts = MonthlyFacts | FinalFacts;

/** Fakta ur en ögonblicksbild – null när de saknas, är ogiltiga eller har en annan version. */
export function parseFacts(raw: unknown): ReportFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  const r = kind === "monthly" ? MonthlyFactsSchema.safeParse(raw) : kind === "final" ? FinalFactsSchema.safeParse(raw) : null;
  return r && r.success ? r.data : null;
}

// ================================================================ Omvändningen av den frysta modellen
/** Strikt omvändning av dFull: "14 december 2026" → "2026-12-14", "–" → null. undefined = går inte att tolka. */
export function parseDFull(s: string | null | undefined): LocalDate | null | undefined {
  if (s == null) return undefined;
  if (s === "–") return null;
  const m = /^(\d{1,2}) ([a-zåäö]+) (\d{4})$/.exec(s);
  if (!m) return undefined;
  const mi = (MONTHS as readonly string[]).indexOf(m[2]);
  if (mi < 0) return undefined;
  const d = `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return dFull(d) === s ? d : undefined;
}

type ReconcileCtx = {
  cfg: Pick<OperationalConfig, "phases" | "progression">;
  areas: readonly Pick<ContractArea, "code" | "name">[];
  /** Ärendets händelser i dag (för verifieringen av händelserna i den frysta modellen). */
  events: readonly Pick<OutcomeEvent, "id" | "kind" | "occurredOn" | "verificationKind">[];
};
export type Reconciled<F> = { facts: F; changed: string[]; unresolved: string[] };

const kv = (basics: readonly (readonly [string, string])[], key: string): string | undefined => basics.find((b) => b[0] === key)?.[1];

/** Nivån i modellens progressionsrad: "2 – tydlig" → 2, "Ej bedömd" → null, annat → undefined (går inte att tolka). */
export function parseLevel(text: string): 0 | 1 | 2 | 3 | null | undefined {
  if (text === "Ej bedömd") return null;
  const m = /^([0-3]) – /.exec(text);
  return m ? (Number(m[1]) as 0 | 1 | 2 | 3) : undefined;
}

/**
 * Avsnitt 3 i modellens text (docText i model.ts): antal godkända avstämningar, arbetsgivarkontakter och veckomålen.
 * undefined = texten följer inte mallen (t.ex. omskriven) och går inte att tolka.
 */
export function parseDocText(t: string): { checkIns: number; contacts: number; goals: { yes: number; partly: number; no: number } } | undefined {
  if (/^Inga godkända veckoavstämningar finns för .+\.$/.test(t)) return { checkIns: 0, contacts: 0, goals: { yes: 0, partly: 0, no: 0 } };
  const head = /^Under .+? genomfördes (\d+) godkända veckoavstämningar\. /.exec(t);
  const tail = / Arbetsgivarkontakter: (\d+)(?: \(.*\))?\. Veckomålet uppnåddes (\d+) (?:gång|gånger), delvis (\d+) (?:gång|gånger) och inte (\d+) (?:gång|gånger)\.$/.exec(t);
  if (!head || !tail) return undefined;
  return { checkIns: Number(head[1]), contacts: Number(tail[1]), goals: { yes: Number(tail[2]), partly: Number(tail[3]), no: Number(tail[4]) } };
}

/**
 * Ta ärendefälten ur den frysta månadsrapporten när de skiljer sig från fakta som räknats fram i efterhand. Fält som inte går
 * att föra tillbaka entydigt behåller det levande värdet och listas i unresolved (bara fältnamn – loggas som report.facts_drift).
 */
export function reconcileMonthlyFacts(f: MonthlyFacts, model: MonthlyModel, ctx: ReconcileCtx): Reconciled<MonthlyFacts> {
  const out: MonthlyFacts = { ...f, events: [...f.events] };
  const changed: string[] = [];
  const unresolved: string[] = [];
  const set = <K extends keyof MonthlyFacts>(field: K, value: MonthlyFacts[K] | undefined) => {
    if (value === undefined) {
      unresolved.push(field);
      return;
    }
    if (JSON.stringify(value) !== JSON.stringify(out[field])) {
      out[field] = value;
      changed.push(field);
    }
  };
  const b = model.basics;
  const caseNumber = kv(b, "Ärendenummer");
  if (caseNumber) set("caseNumber", caseNumber);
  // Avtalsområdet: exakt "G Lager och logistik" (areaName) mot avtalets områden.
  const area = kv(b, "Avtalsområde");
  if (area !== undefined) set("primaryAreaCode", area === "–" ? null : ctx.areas.find((a) => `${a.code} ${a.name}` === area)?.code);
  const track = kv(b, "Yrkesspår");
  if (track !== undefined) set("vocationalTrack", track === "Framgår inte" || track === "" ? null : track);
  const start = kv(b, "Insatsen startade");
  if (start !== undefined) set("startDate", parseDFull(start));
  const ended = kv(b, "Insatsen avslutades");
  const planned = kv(b, "Planerat slut");
  if (ended !== undefined) set("endDate", parseDFull(ended));
  else if (planned !== undefined) {
    set("endDate", null);
    set("plannedEnd", parseDFull(planned));
  }
  // Fasen: "Fas 3 · Yrkesspecifika moment" (plain av avtalets fasnamn).
  const phase = kv(b, "Fas vid månadens slut");
  if (phase !== undefined) {
    const m = /^Fas (\d+) · (.*)$/.exec(phase);
    const no = m ? Number(m[1]) : NaN;
    const name = ctx.cfg.phases.find((p) => p.no === no)?.name;
    set("phase", m && (name ? plain(name) === m[2] : m[2] === "–") ? no : undefined);
  }
  // Beställarens enhet: "Maria Ekdahl, Arbetsmarknadsenheten Alby" (personWithUnit). Utan enhet i rapporten (beställaren
  // saknar konto eller enhet) gäller ärendets enhet, som inte visas i rapporten – då behålls värdet.
  const who = kv(b, "Beställare");
  const comma = who ? who.indexOf(", ") : -1;
  if (who && comma >= 0) set("referrerUnit", who.slice(comma + 2) || null);
  // Veckorna och uppehållen som de stod i rapportens avsnitt 2.
  set("weeks", model.weeks.length);
  set("pausedWeeks", model.weeks.filter((w) => w.paused).length);
  // Händelserna som de stod i avsnitt 5. Verifierad = underlaget (verifieringstypen) stod i rapporten.
  const byId = new Map(ctx.events.map((e) => [e.id, e]));
  const evs: MonthlyFacts["events"] = [];
  let evOk = true;
  for (const row of model.events) {
    const live = byId.get(row.id);
    const date = parseDFull(row.date);
    if (!live || !date) {
      evOk = false;
      break;
    }
    evs.push({ kind: live.kind, date, verified: !!live.verificationKind && row.basis === ucfirst(live.verificationKind) });
  }
  set("events", evOk ? evs : undefined);

  // Avsnitt 2: närvaron och upprepad frånvaro som de stod i rapporten (närvaro kan ha registrerats om efter leveransen).
  const t = model.total;
  set("attendance", { planned: t.planned, present: t.present, late: t.late, absentValid: t.absentValid, absentInvalid: t.absentInvalid, unregistered: t.unregistered, rate: t.rate });
  set("repeatedAbsence", model.repeated.hit);
  // Avsnitt 3: antal avstämningar, arbetsgivarkontakter och veckomål ur rapportens text.
  const doc = parseDocText(model.docText);
  set("checkInsApproved", doc?.checkIns);
  set("employerContacts", doc?.contacts);
  set("goals", doc?.goals);
  // Avsnitt 4 och 8: bedömningen som den stod i rapporten (den kan ha godkänts igen efter leveransen).
  set("assessmentApproved", model.approved);
  if (!model.approved || !model.progression) {
    set("levels", {});
    set("areasAssessed", null);
    set("progressionClear", null);
    set("progressionAny", null);
    set("overallStatus", null);
    set("assessmentDate", null);
  } else {
    const levels: MonthlyFacts["levels"] = {};
    let levelsOk = true;
    for (const k of ctx.cfg.progression.areas) {
      const row = model.progression.rows.find((r) => r.key === k);
      const level = row ? parseLevel(row.level) : undefined;
      if (level === undefined) levelsOk = false;
      else levels[k] = level;
    }
    if (levelsOk) {
      // Flaggorna och antalet bedömda på de obligatoriska områdena – samma regel som när fakta byggs (progressionFlags).
      const flags = progressionFlags(ctx.cfg, Object.fromEntries(Object.entries(levels).map(([k, level]) => [k, { level }])));
      set("levels", levels);
      set("areasAssessed", flags.assessed);
      set("progressionClear", flags.clear);
      set("progressionAny", flags.any);
    } else {
      for (const f of ["levels", "areasAssessed", "progressionClear", "progressionAny"] as const) set(f, undefined);
    }
    set("overallStatus", model.assessment ? model.assessment.overallStatus : undefined);
    set("assessmentDate", model.assessment ? parseDFull(model.assessment.date) : undefined);
  }
  // Avsnitt 6: nya avvikelser (skapade i månaden – alla sådana står i rapporten) och om kommunen behöver besluta.
  const from = `${model.month}-01`;
  const to = monthEnd(model.month);
  const devDates = model.deviations.items.map((i) => parseDFull(i.date));
  set("deviationsNew", devDates.every((d) => typeof d === "string") ? devDates.filter((d) => (d as string) >= from && (d as string) <= to).length : undefined);
  const decision = model.deviations.decision;
  set("needsCustomerDecision", decision === "Nej." ? false : decision.startsWith("Ja") ? true : undefined);
  // Öppna vid månadens slut finns inte i rapporten (den visar statusen när den lämnades). Avvikelserna som pågick då var
  // öppna vid månadens slut – är det levande värdet lägre har underlaget ändrats: ta rapportens antal och logga.
  const ongoing = model.deviations.items.filter((i) => i.status === "Pågår").length;
  if (out.deviationsOpen < ongoing) {
    out.deviationsOpen = ongoing;
    changed.push("deviationsOpen");
    unresolved.push("deviationsOpen");
  }
  return { facts: out, changed, unresolved };
}

/** Samma för slutrapporten: avslutsdatum, avslutsorsak, resultatklass och verifiering som de stod i den frysta rapporten. */
export function reconcileFinalFacts(f: FinalFacts, model: FinalModel, endReasonLabels: Readonly<Record<string, string>>): Reconciled<FinalFacts> {
  const out: FinalFacts = { ...f };
  const changed: string[] = [];
  const unresolved: string[] = [];
  const set = <K extends keyof FinalFacts>(field: K, value: FinalFacts[K] | undefined) => {
    if (value === undefined) {
      unresolved.push(field);
      return;
    }
    if (JSON.stringify(value) !== JSON.stringify(out[field])) {
      out[field] = value;
      changed.push(field);
    }
  };
  const b = model.basics;
  const caseNumber = kv(b, "Ärendenummer");
  if (caseNumber) set("caseNumber", caseNumber);
  const ended = kv(b, "Insatsen avslutades");
  if (ended !== undefined) set("endDate", parseDFull(ended));
  const reason = kv(b, "Avslutsorsak");
  if (reason !== undefined) {
    const code = reason === "–" ? null : (Object.entries(endReasonLabels).find(([, l]) => l === reason)?.[0] ?? undefined);
    set("endReason", code as FinalFacts["endReason"] | undefined);
  }
  // Resultattexten i slutrapporten (buildFinal i model.ts).
  const t = model.resultText;
  const verifiedAt = /^Arbete eller studier – verifierat (.+)\.$/.exec(t);
  if (verifiedAt) {
    const d = parseDFull(verifiedAt[1]);
    set("resultClass", "result");
    set("resultVerified", d ? true : undefined);
    set("resultVerifiedAt", d ?? undefined);
  } else if (t.startsWith("Arbete eller studier – väntar på verifiering")) {
    set("resultClass", "result");
    set("resultVerified", false);
    set("resultVerifiedAt", null);
  } else if (t.startsWith("Avslutet räknas inte i resultatgraden")) {
    set("resultClass", "excluded");
  } else if (t === "Inget resultat enligt resultatdefinitionen.") {
    set("resultClass", "no_result");
  } else if (t === "Framgår inte.") {
    set("resultClass", null);
  } else unresolved.push("resultClass");
  return { facts: out, changed, unresolved };
}
