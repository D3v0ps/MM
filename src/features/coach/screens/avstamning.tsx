"use client";
// Veckoavstämning (/avstamning/:caseId?avstamning=<id>) – manuellt eller med AI-stöd (samma formulär). AI föreslår med belägg,
// coachen accepterar, ändrar eller avvisar varje förslag. Samlad status föreslås aldrig. Röd status kräver en avvikelse.
// Port av prototypens coach.avstamning (CheckInForm, ConsentPanel, AiCapture, AiSourceSummary, CheckInDone, CheckInReadOnly).
// Utkastet sparas automatiskt på servern (useAutosave, beslut 2026-10-02): 2 s efter senaste ändringen, när sidan lämnas
// och när den döljs – samma kommando som "Spara utkast" (autosave: true, en loggrad per besök). Adressen får inte det nya
// utkastets id (det skulle byta Loaded-nyckeln och nollställa formuläret); efter omladdning visas i stället "Det finns ett
// sparat utkast – Öppna utkastet". Id, version, sparat läge och senaste sparningstid ligger i utkastminnet, så Tillbaka visar
// samma sak och fortsatta ändringar sparas i samma utkast – aldrig ett andra utkast: ett sparat utkast som inte är öppnat
// stoppar autosparningen (coachen öppnar det eller sparar själv som nytt), "Börja om" behåller utkastets id, och "Spara
// utkast" behåller minnet. Samma utkast i en annan flik: servern svarar conflict (versionen, 0022) och inget skrivs över.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AUTOSAVE_CHECKIN } from "@/api/invalidation";
import { pct, plural } from "@/core/format";
import { addDays, dayOf, fmtDate, fmtDateShort, fmtDateTime, fmtDateTimeLong, fmtWeekday, fmtWeekKey, monday, timeOf } from "@/core/time";
import { newEditSession, useAutosave, type AutosaveResult } from "@/shell/autosave";
import { useCommand, useQuery, useQueryRunner } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import type { ScreenProps } from "@/shell/routes";
import { useSession } from "@/shell/session";
import {
  AiBox, AiTag, AutosaveStatus, Badge, BuildPhase, Button, Card, Check, cn, DateInput, DateTimeInput, DemoNote, ErrorSummary, Evidence, Field, focusFirstError, FormGrid, Grid, Icon, Input, Kpi, Kv,
  List, Notice, Page,
  Recorder, Row, Seg, Select, SimulatedAiNotice, Stack, Status, STATUS_ICON, STATUS_TEXT, TextArea, TimeInput, Timeline, toast, useAuditView, type IconName, type RecordedAudio, type SegOption,
} from "@/ui";
import { Link } from "@/shell/nav";
import { uploadStart } from "@/features/rost/api";
import { runVoiceFlow } from "@/features/rost/client";
import { VoiceNotesForCheckIn } from "@/features/rost/screens/coach-parts";
import { consentSet } from "@/features/arenden/api";
import { auditView } from "@/features/session/api";
import {
  AI_FIELDS, AI_OFF_TEXT, aiRun, aiRunInfo, checkInAttendance, checkInPage, checkInReceipt, checkinSave, deviationCallCustomer, recordingFinish, recordingState, type AiField,
  type AiFieldSuggestion, type AiSource, type CheckInPage, type CheckInReceipt, type CheckInSuggestions, type CheckInView, type RecordingState,
} from "../api";
import { cap, CaseHeadView, caseCrumbs, CasePicker, ChipButton, Chips, customerPerspective, GateView, lc, PageState, Persp, useCaseView } from "./shared";

type Ok = Extract<CheckInPage, { kind: "ok" }>;
type Goal = "yes" | "partly" | "no";
type Rag = "green" | "yellow" | "red";
type Ec = "0" | "1" | "2+";
type Method = "manual" | "ai";
type Clicked = "accepted" | "edit" | "rejected";
type Outcome = "accepted" | "edited" | "rejected";

const TITLE = "Veckoavstämning";
const AI_BLOCKED = "AI används inte i det här ärendet: samtycke saknas. Dokumentera manuellt.";
const FIELD_ID: Record<AiField, string> = { goalStatus: "ci-goal", nextGoal: "ci-nextgoal", phase: "ci-phase", activitiesDone: "ci-acts", employerContacts: "ci-ec", obstacles: "ci-obst", note: "ci-note" };
const FIELD_LABEL: Record<AiField, string> = {
  goalStatus: "Veckomål uppnått", nextGoal: "Nytt veckomål", phase: "Fas", activitiesDone: "Genomförda aktiviteter", employerContacts: "Arbetsgivarkontakter", obstacles: "Hinder", note: "Anteckning",
};
/** Loggat utfall per AI-förslag: accepted (värdet oförändrat), edited (coachen ändrade värdet), rejected (avvisat). */
const OUTCOME_LABEL: Record<Outcome, string> = { accepted: "Accepterat", edited: "Ändrat", rejected: "Avvisat" };
/** label = underlaget i sammanfattningen, choose = valet av källa. */
const SOURCE: Record<AiSource, { label: string; choose: string; icon: IconName; method: "ai_recording" | "ai_upload" | "teams" | "notes"; audio: boolean }> = {
  recording: { label: "Inspelning i rummet", choose: "Spela in samtalet", icon: "mic", method: "ai_recording", audio: true },
  upload: { label: "Uppladdad ljudfil", choose: "Ladda upp ljudfil", icon: "upload", method: "ai_upload", audio: true },
  teams: { label: "Teams-transkript", choose: "Teams-transkript", icon: "video", method: "teams", audio: false },
  notes: { label: "Inklistrade anteckningar", choose: "Inklistrade anteckningar", icon: "clipboard", method: "notes", audio: false },
};
/** Var AI-körningen gjordes, i klarspråk. Leverantör och modell hör hemma i revisionsloggen, inte i coachens formulär. */
const PROVIDER_TEXT = "Transkriberat och tolkat i Sverige/EU";
const GOAL_TEXT: Record<Goal, string> = { yes: "Ja", partly: "Delvis", no: "Nej" };
const GOAL_OPTIONS: SegOption<Goal>[] = [{ value: "yes", label: "Ja", icon: "check" }, { value: "partly", label: "Delvis", icon: "minus" }, { value: "no", label: "Nej", icon: "x" }];
const MODE_OPTIONS: SegOption<"fysiskt" | "telefon" | "video">[] = [{ value: "fysiskt", label: "Fysiskt", icon: "users" }, { value: "telefon", label: "Telefon", icon: "phone" }, { value: "video", label: "Video", icon: "video" }];
const EC_TYPES = ["ansökan", "intervju", "praktikkontakt", "studiebesök"];
const STATUS_OPTIONS: SegOption<Rag>[] = (["green", "yellow", "red"] as const).map((v) => ({ value: v, label: STATUS_TEXT[v], icon: STATUS_ICON[v], tone: v }));
const CONSENT_LANGS = ["lättläst svenska", "arabiska", "somaliska", "tigrinja", "turkiska", "engelska"];
const scrollTop = () => {
  try {
    window.scrollTo({ top: 0 });
  } catch {
    /* ignoreras */
  }
};

// ================================================================ Skärmen
export function AvstamningScreen({ params, query }: ScreenProps) {
  if (!params.caseId) {
    return (
      <CasePicker kind="avstamning" title={TITLE} lead="Välj den deltagare du har träffat. Dokumentationen tar under fem minuter." basePath="/avstamning" actionLabel="Gör avstämning" />
    );
  }
  return <Avstamning caseId={params.caseId} checkInId={query.get("avstamning")} rostId={query.get("rost")} />;
}

function Avstamning({ caseId, checkInId, rostId }: { caseId: string; checkInId: string | null; rostId: string | null }) {
  const q = useQuery(checkInPage, { caseId, checkInId: checkInId ?? undefined });
  const v = q.data;
  if (!v) return <PageState title={TITLE} error={q.error} onRetry={() => void q.refetch()} />;
  if (v.kind === "gate") return <GateView gate={v.gate} title={TITLE} listPath="/avstamning" />;
  return <Loaded key={`${caseId}|${checkInId ?? ""}`} v={v} rostId={rostId} />;
}

/** Om avstämningen redan var godkänd när vyn öppnades visas den skrivskyddat. Godkänns den här behålls kvittot. */
function Loaded({ v, rostId }: { v: Ok; rostId: string | null }) {
  const [wasApproved] = useState(() => v.checkIn?.status === "approved");
  if (v.checkIn && wasApproved) return <CheckInReadOnly v={v} ci={v.checkIn} />;
  return <CheckInForm v={v} rostId={rostId} />;
}

// ================================================================ Skrivskyddad (redan godkänd)
function CheckInReadOnly({ v, ci }: { v: Ok; ci: CheckInView }) {
  const phaseText = (n: number | null) => (n ? `Fas ${n} · ${v.phases.find((p) => p.no === n)?.name ?? ""}` : "–");
  return (
    <Page title={TITLE} eyebrow={`${v.head.name} · ${v.head.caseNumber}`} crumbs={caseCrumbs(v.head, TITLE)}>
      <Notice tone="ok" title={`Godkänd ${fmtDateTime(ci.approvedAt)} av ${ci.approvedByName ?? "–"}`}>
        En godkänd avstämning ändras inte. Behöver något rättas gör du en ny avstämning.
      </Notice>
      <Card title={`Avstämning ${fmtDateTimeLong(ci.heldAt)}`} icon="clipboard">
        <Kv
          items={[
            ["Sätt och längd", `${cap(ci.mode || "fysiskt")}, ${ci.durationMin || "–"} min`],
            ["Veckomål uppnått", ci.goalStatus ? GOAL_TEXT[ci.goalStatus] : "–"],
            ["Nytt veckomål", ci.nextGoal || "–"],
            ["Fas", phaseText(ci.phase)],
            ["Aktiviteter", ci.activitiesDone.join(", ") || "–"],
            ["Arbetsgivarkontakter", ci.employerContacts ? ecText(ci.employerContacts) : "–"],
            ["Samlad status", <Status key="status" value={ci.overallStatus} />],
            ["Hinder", ci.obstacles.join(", ") || "Inga"],
            ["Anteckning", ci.note || "–"],
            ["Dokumentationstid", ci.docMinutes != null ? `${ci.docMinutes} min` : "–"],
          ]}
        />
      </Card>
      <Row>
        <Button kind="primary" icon="plus" to={`/avstamning/${encodeURIComponent(v.head.caseId)}`}>
          Ny avstämning
        </Button>
        <Button kind="ghost" to="/min-vecka">
          Till Min vecka
        </Button>
      </Row>
    </Page>
  );
}

const ecText = (v: { count: string | null; types?: string[] | null } | null) => (v ? `${v.count}${v.types && v.types.length ? ` (${v.types.join(", ")})` : ""}` : "Framgår inte");

// ================================================================ Dokumentationstiden
/** Dokumentationstid (mål under 5 minuter, SPEC §7.5 och §8.5). Egen komponent så att bara klockan ritas om. */
function DocTimer({ start, stopped, className }: { start: number; stopped?: number | null; className?: string }) {
  const [nowMs, setNowMs] = useState(start);
  useEffect(() => {
    if (stopped != null) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stopped]);
  const secs = Math.max(0, Math.round(((stopped ?? nowMs) - start) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const over = m >= 5;
  return (
    <span
      role="timer"
      aria-live="off"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-bla-ton2 px-3 py-1.5 font-bold text-antracit tabular-nums",
        over && "border-2 border-rod bg-vit",
        className,
      )}
    >
      <Icon name={over ? "alert-circle" : "clock"} />
      Dokumentationstid: {m} min {String(s).padStart(2, "0")} s<span className="text-small font-semibold">· mål under 5 min</span>
    </span>
  );
}

// ================================================================ Formuläret
type FormState = {
  date: string;
  time: string;
  durationMin: string;
  mode: "fysiskt" | "telefon" | "video";
  attendanceComment: string;
  goalStatus: Goal | null;
  nextGoal: string;
  phase: string;
  activitiesDone: string[];
  ecCount: Ec | null;
  ecTypes: string[];
  overallStatus: Rag | null;
  obstacles: string[];
  note: string;
};
type Dev = { description: string; action: string; ownerId: string; followUpOn: string; needsCustomerDecision: "yes" | "no" | null };
type AiMeta = { runId: string | null; audioDeletedAt: string | null; deleteBy: string | null; transcript: { t: number | null; who: string; text: string }[]; fromSeed?: boolean };
type Proc = { steps: string[]; i: number };
export type LoggedDecision = { field: AiField; decision: Outcome; clicked: Clicked; suggested: unknown; final: unknown };
type Done = { checkInId: string; deviationId: string | null; decisions: LoggedDecision[]; docSecs: number; stopped: number };

const DEV_ERR: Record<keyof Dev, string> = { description: "devDescription", action: "devAction", ownerId: "devOwner", followUpOn: "devFollow", needsCustomerDecision: "devCust" };
const EMPTY_DEV: Dev = { description: "", action: "", ownerId: "", followUpOn: "", needsCustomerDecision: null };
/** Fältet som felet gäller (länkarna i felsammanfattningen). ai pekar på första förslaget som väntar. */
const ERROR_FIELD: Record<string, string> = {
  goalStatus: "ci-goal", nextGoal: "ci-nextgoal", ec: "ci-ec", overallStatus: "ci-status",
  devDescription: "dev-desc", devAction: "dev-action", devOwner: "dev-owner", devFollow: "dev-follow", devCust: "dev-cust",
};
const REC_LEAVE = "Inspelningen stoppas och försvinner. Lämna ändå?";
const UNOPENED_DRAFT = "Sparas inte automatiskt – det finns redan ett sparat utkast. Öppna utkastet, eller spara det här som ett nytt med Spara utkast.";
const ALREADY_APPROVED = "Avstämningen är redan godkänd – inget sparas. Ladda om sidan.";
const CONFLICT_TEXT = "Utkastet har ändrats i en annan flik eller på en annan enhet – ladda om sidan. Inget skrivs över.";
const DEV_MISSING: Record<string, string> = { devDescription: "beskrivning", devAction: "åtgärd", devOwner: "ansvarig", devFollow: "uppföljningsdatum", devCust: "om kommunen behöver fatta beslut" };

function sourceOf(ci: CheckInView | null): AiSource {
  if (!ci?.ai) return "recording";
  return ci.inputMethod === "teams" ? "teams" : ci.inputMethod === "notes" ? "notes" : ci.inputMethod === "ai_upload" ? "upload" : "recording";
}
/** Förslagen ur ett utkast (utan transkript och tider). */
function suggestionsOf(ci: CheckInView | null): CheckInSuggestions | null {
  if (!ci?.ai) return null;
  const { transcript: _t, audioDeletedAt: _a, rawTranscriptDeleteBy: _r, rawTranscriptDeletedAt: _d, ...s } = ci.ai;
  void _t;
  void _a;
  void _r;
  void _d;
  return s;
}

function CheckInForm({ v, rostId }: { v: Ok; rostId: string | null }) {
  const { user } = useSession();
  const save = useCommand(checkinSave);
  // Automatisk utkastsparning räknar bara om utkastlistor och kortet – inte sidan själv och inte sidopanelens räknare.
  const draftSave = useCommand(checkinSave, { invalidate: AUTOSAVE_CHECKIN });
  const [editSession] = useState(newEditSession);
  const run = useCommand(aiRun);
  const recStart = useCommand(uploadStart);
  const recFinish = useCommand(recordingFinish);
  const runQuery = useQueryRunner();
  const consent = useCommand(consentSet);
  useCaseView(v.head.caseId);
  const c = v.head;
  const ci0 = v.checkIn;
  const today = dayOf(v.now);
  const last = v.lastApproved;
  const held0 = ci0 ? ci0.heldAt : v.todayMeetingAt ?? v.now;
  const phaseOf = (n: number) => `Fas ${n} · ${v.phases.find((p) => p.no === n)?.name ?? ""}`;
  const suggestionText = (field: AiField, val: unknown): string => {
    if (val == null) return "Framgår inte";
    if (field === "goalStatus") return GOAL_TEXT[val as Goal] ?? String(val);
    if (field === "phase") return phaseOf(Number(val));
    if (field === "activitiesDone" || field === "obstacles") return (val as string[]).length ? (val as string[]).join(", ") : "Inga";
    if (field === "employerContacts") return ecText(val as { count: string; types: string[] });
    return String(val);
  };

  const [start] = useState(() => Date.now());
  const initialForm = (): FormState => ({
    date: dayOf(held0), time: timeOf(held0), durationMin: String(ci0?.durationMin || last?.durationMin || 45), mode: ci0?.mode || last?.mode || "fysiskt",
    attendanceComment: ci0?.attendanceComment || "", goalStatus: ci0?.goalStatus || null, nextGoal: ci0?.nextGoal || "", phase: String(ci0?.phase || c.phase || 1),
    activitiesDone: ci0?.activitiesDone ?? [], ecCount: (ci0?.employerContacts?.count ?? null) as Ec | null, ecTypes: ci0?.employerContacts?.types ?? [],
    overallStatus: ci0?.overallStatus || null, obstacles: ci0?.obstacles ?? [], note: ci0?.note || "",
  });
  // Utkastminne (bara i minnet): det coachen har fyllt i finns kvar om sidan lämnas utan att sparas (2.A).
  const draftKey = `avstamning|${c.caseId}|${ci0?.id ?? "ny"}`;
  const formDraft = useDraft<FormState>(draftKey, initialForm);
  const devDraft = useDraft<Dev>(`${draftKey}|avvikelse`, EMPTY_DEV);
  const form = formDraft.value;
  const setForm = formDraft.set;
  // Det som senast fanns sparat (formuläret som det öppnades, eller efter Spara utkast/autosparning), utkastets id och
  // senaste sparningstid – i samma minne som fälten, så att Tillbaka visar formuläret som sparat (inte "osparat").
  const baselineDraft = useDraft<string>(`${draftKey}|sparat`, () => JSON.stringify([initialForm(), EMPTY_DEV]));
  const baseline = baselineDraft.value;
  const setBaseline = baselineDraft.set;
  const idDraft = useDraft<string | null>(`${draftKey}|id`, ci0 ? ci0.id : null);
  const ciId = idDraft.value;
  const setCiId = idDraft.set;
  const savedAtDraft = useDraft<string | null>(`${draftKey}|sparadtid`, null);
  // Radens version (0022): skickas som expectedVersion – samma utkast sparat i en annan flik ger "conflict", inget skrivs över.
  const versionDraft = useDraft<number | null>(`${draftKey}|version`, ci0 ? ci0.version : null);
  // Senaste kända id och version – också mitt i en autosparning (React-tillståndet hinner inte alltid uppdateras före nästa anrop).
  const ciIdRef = useRef<string | null>(ciId);
  const versionRef = useRef<number | null>(versionDraft.value);
  useEffect(() => {
    ciIdRef.current = ciId;
    versionRef.current = versionDraft.value;
  }, [ciId, versionDraft.value]);
  const remember = (r: { checkInId: string; version: number }) => {
    ciIdRef.current = r.checkInId;
    versionRef.current = r.version;
    setCiId(r.checkInId);
    versionDraft.set(r.version);
  };
  const setF = <K extends keyof FormState>(k: K, val: FormState[K]) => setForm((f) => ({ ...f, [k]: val }));
  const prot = c.protected;
  const [method, setMethod] = useState<Method>(ci0?.ai ? "ai" : "manual");
  const [source, setSource] = useState<AiSource>(sourceOf(ci0));
  const [sugg, setSugg] = useState<CheckInSuggestions | null>(() => suggestionsOf(ci0));
  const [aiMeta, setAiMeta] = useState<AiMeta | null>(() =>
    ci0?.ai ? { runId: ci0.aiRunId, audioDeletedAt: ci0.ai.audioDeletedAt, deleteBy: ci0.ai.rawTranscriptDeleteBy, transcript: ci0.ai.transcript ?? [], fromSeed: true } : null,
  );
  const [decisions, setDecisions] = useState<Partial<Record<AiField, Clicked>>>({});
  const [recActive, setRecActive] = useState(false);
  const [proc, setProc] = useState<Proc | null>(null);
  const [notesText, setNotesText] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [consentInformed, setConsentInformed] = useState(false);
  const [consentLang, setConsentLang] = useState(v.consentLanguage);
  // Fel från servern. Valideringsfelen räknas om medan coachen rättar (attempt = senaste försöket: godkänn eller utkast).
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<boolean | null>(null);
  const dev = devDraft.value;
  const setDevRaw = devDraft.set;
  const [holdRec, setHoldRec] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  // Avvikelsen fylls aldrig i automatiskt: kravet ska synas som ett stopp. Förslaget från flaggan kan coachen själv välja att använda.
  const repeated = v.repeatedAbsence;
  const devSuggestion = repeated
    ? { description: `Upprepad ogiltig frånvaro (${repeated.count} tillfällen inom ${repeated.withinDays} dagar)`, action: "Samtal om hinder, ny veckoplan och uppföljningsmöte med handläggaren." }
    : null;
  const setDev = (next: Dev) => {
    setDevRaw(next);
    setErrors((e) => {
      const n = { ...e };
      for (const [k, ek] of Object.entries(DEV_ERR) as [keyof Dev, string][]) if (n[ek] && next[k]) delete n[ek];
      return n;
    });
  };
  const aiAllowed = v.aiConsent === "given" && !prot;
  const consentOk = v.aiConsent === "given";
  const lastWeekFrom = form.date ? addDays(form.date, -6) : null;
  const draftElsewhere = !ci0 ? v.drafts.find((x) => x.id !== ciId) ?? null : null;
  // Ett sparat utkast som inte är öppnat (t.ex. efter en omladdning): autosparningen skapar aldrig ett andra utkast –
  // coachen öppnar utkastet, eller sparar det här som ett nytt med "Spara utkast".
  const unopenedDraft = !ciId && !!draftElsewhere && !draftElsewhere.ai;

  // ---- AI
  const decide = (field: AiField, dec: Clicked) => {
    const s = sugg?.[field] as AiFieldSuggestion<unknown> | undefined;
    if (!s) return;
    setDecisions((x) => ({ ...x, [field]: dec }));
    if (s.noEvidence) return;
    const apply = (val: unknown) => {
      if (field === "employerContacts") {
        const ec = val as { count: Ec | null; types: string[] } | null;
        setForm((f) => ({ ...f, ecCount: ec ? ec.count : null, ecTypes: ec ? ec.types || [] : [] }));
      } else if (field === "phase") setForm((f) => ({ ...f, phase: val == null ? "1" : String(val) }));
      else setForm((f) => ({ ...f, [field]: Array.isArray(val) ? val.slice() : val }));
    };
    const blank: Record<AiField, unknown> = { goalStatus: null, nextGoal: "", phase: c.phase || 1, activitiesDone: [], employerContacts: null, obstacles: [], note: "" };
    if (dec === "rejected") apply(blank[field]);
    else apply(s.value);
    if (errors.ai) setErrors((e) => {
      const n = { ...e };
      delete n.ai;
      return n;
    });
    if (dec === "edit") {
      setTimeout(() => {
        const el = document.getElementById(FIELD_ID[field]);
        if (!el) return;
        const f = el.matches("input,textarea,select") ? el : el.querySelector<HTMLElement>("input,textarea,button");
        (f as HTMLElement | null)?.focus();
        try {
          el.scrollIntoView({ block: "center" });
        } catch {
          /* ignoreras */
        }
      }, 40);
    }
  };
  const finishAi = async (src: AiSource) => {
    const audio = SOURCE[src].audio;
    const secs = audio ? Math.max(60, Number(form.durationMin) * 60) : 0;
    if (!aiAllowed) {
      toast(AI_BLOCKED, "error");
      setMethod("manual");
      return;
    }
    const kind = src === "notes" ? "extract_notes" : src === "teams" ? "extract_teams" : "transcribe_extract";
    const res = await run.run({ caseId: c.caseId, kind, source: src, notesText: src === "notes" ? notesText : undefined, audioSeconds: secs, costOre: audio ? 80 : 4 }).catch(() => null);
    if (!res || !res.ok || !res.suggestions) {
      toast(res && !res.ok && res.error === "ai_not_allowed" ? AI_BLOCKED : res && !res.ok && res.error === "ai_unavailable" ? AI_OFF_TEXT : "AI-tolkningen gick inte att göra. Dokumentera manuellt.", "error");
      setMethod("manual");
      return;
    }
    const s = res.suggestions;
    setSugg(s);
    setDecisions({});
    setAiMeta({ runId: res.runId, audioDeletedAt: res.audioDeletedAt, deleteBy: res.rawTranscriptDeleteBy, transcript: res.transcript });
    const missing = AI_FIELDS.filter((f) => s[f]?.noEvidence).length;
    toast(
      `${audio ? "Förslagen är klara. Ljudet raderades direkt efter transkriberingen." : "Förslagen är klara. Granska varje förslag."}${missing ? ` ${plural(missing, "fält framgår", "fält framgår")} inte av underlaget – fyll i dem själv.` : ""}`,
    );
  };
  const startProcessing = (src: AiSource) => {
    const steps =
      src === "recording" ? ["Laddar upp inspelningen …", "Transkriberar …", "Tolkar till formuläret …", "Raderar ljudet …"]
        : src === "upload" ? ["Laddar upp ljudfilen …", "Transkriberar …", "Tolkar till formuläret …", "Raderar ljudet …"]
          : src === "teams" ? ["Hämtar transkriptet från Teams …", "Tolkar till formuläret …"]
            : ["Tolkar anteckningarna …"];
    let i = 0;
    setProc({ steps, i: 0 });
    const step = () => {
      i++;
      if (i >= steps.length) {
        setProc(null);
        void finishAi(src);
        return;
      }
      setProc({ steps, i });
      timers.current.push(setTimeout(step, 650));
    };
    timers.current.push(setTimeout(step, 650));
  };
  /**
   * Inspelning eller ljudfil: laddas upp (appen: direkt till lagringen), transkriberas och tolkas till formuläret. Ljudet
   * raderas direkt efter transkriberingen. Samtycket och skyddet kontrolleras av servern (och igen när jobbet körs).
   * En simulerad inspelning (prototypen) räknas som ett samtal på den valda längden.
   */
  const captureAudio = async (audio: RecordedAudio, src: "recording" | "upload") => {
    if (!aiAllowed || !v.recording.allowed) {
      toast(v.recording.blockText ?? AI_BLOCKED, "error");
      return;
    }
    const steps = [src === "recording" ? "Laddar upp inspelningen …" : "Laddar upp ljudfilen …", "Transkriberar …", "Tolkar till formuläret …", "Raderar ljudet …"];
    setProc({ steps, i: 0 });
    const maxSec = v.recording.maxMinutes * 60;
    const durationSec = audio.simulated ? Math.min(maxSec, Math.max(60, Number(form.durationMin) * 60)) : audio.durationSec;
    const res = await runVoiceFlow<RecordingState>({
      audio,
      durationSec,
      minPhaseMs: 650,
      errorText: "Inspelningen kunde inte tolkas. Dokumentera manuellt eller försök igen.",
      onPhase: (ph) => setProc({ steps, i: ph === "uploading" ? 0 : 1 }),
      start: (meta) => recStart.run({ purpose: "checkin", caseId: c.caseId, ...meta }),
      finish: (ticket) => recFinish.run({ caseId: c.caseId, uploadId: ticket.uploadId, source: src, checkInId: ciId, durationSec }),
      poll: (st) => runQuery(recordingState, { aiRunId: st.aiRunId }),
    });
    const result = res.ok && res.state.status === "succeeded" ? res.state.result : null;
    if (!result || !result.suggestions) {
      setProc(null);
      toast(res.ok ? res.state.error || "Inspelningen kunde inte tolkas. Dokumentera manuellt eller försök igen." : res.message, "error");
      return;
    }
    // Stegen efter transkriberingen är redan gjorda på servern – visas som klara innan förslagen öppnas.
    setProc({ steps, i: steps.length });
    await new Promise((r) => timers.current.push(setTimeout(r, 450)));
    setProc(null);
    const s = result.suggestions;
    setSource(src);
    setSugg(s);
    setDecisions({});
    setAiMeta({ runId: result.runId, audioDeletedAt: result.audioDeletedAt, deleteBy: result.rawTranscriptDeleteBy, transcript: result.transcript });
    const missing = AI_FIELDS.filter((f) => s[f]?.noEvidence).length;
    toast(`Förslagen är klara. Ljudet raderades direkt efter transkriberingen.${missing ? ` ${plural(missing, "fält framgår", "fält framgår")} inte av samtalet – fyll i dem själv.` : ""}`);
  };
  const aiActive = method === "ai" && !!sugg;
  const sOf = (f: AiField) => (sugg ? (sugg[f] as AiFieldSuggestion<unknown> | undefined) : undefined);
  const pendingAi = aiActive ? AI_FIELDS.filter((f) => sOf(f) && !sOf(f)?.noEvidence && !decisions[f]) : [];
  /** Jämför fältets nuvarande värde med förslaget (ordning i listor spelar ingen roll). */
  const norm = (val: unknown): unknown =>
    Array.isArray(val)
      ? [...val].sort()
      : val && typeof val === "object"
        ? (() => {
          const o = val as { count: unknown; types?: string[] };
          return { count: o.count == null ? null : String(o.count), types: o.count && o.count !== "0" ? [...(o.types || [])].sort() : [] };
        })()
        : typeof val === "string"
          ? val.trim()
          : val;
  const currentValue = (f: AiField): unknown =>
    f === "employerContacts" ? { count: form.ecCount, types: form.ecTypes } : f === "phase" ? Number(form.phase) : form[f as Exclude<AiField, "employerContacts" | "phase">];
  const suggestedValue = (f: AiField): unknown => (f === "phase" ? Number(sOf(f)?.value) : sOf(f)?.value);
  /** Det som loggas: avvisat, eller accepterat/ändrat utifrån om värdet faktiskt ändrats. */
  const outcomeOf = (f: AiField): Outcome | null => {
    const dec = decisions[f];
    const s = sOf(f);
    if (!dec || !s || s.noEvidence) return null;
    if (dec === "rejected") return "rejected";
    return JSON.stringify(norm(currentValue(f))) === JSON.stringify(norm(suggestedValue(f))) ? "accepted" : "edited";
  };

  // ---- Spara
  const buildData = () => ({
    heldAt: `${form.date}T${form.time || "09:00"}`,
    durationMin: Number(form.durationMin),
    mode: form.mode,
    inputMethod: aiActive ? SOURCE[source].method : ("manual" as const),
    goalStatus: form.goalStatus,
    nextGoal: form.nextGoal.trim(),
    phase: Number(form.phase),
    activitiesDone: form.activitiesDone,
    employerContacts: { count: form.ecCount, types: form.ecCount && form.ecCount !== "0" ? form.ecTypes : [] },
    overallStatus: form.overallStatus,
    obstacles: form.obstacles,
    note: form.note.trim(),
    attendanceComment: form.attendanceComment.trim(),
    docMinutes: Math.max(1, Math.round((Date.now() - start) / 60000)),
    ...(aiActive && aiMeta && !aiMeta.fromSeed && aiMeta.runId ? { aiRunId: aiMeta.runId } : {}),
  });
  const aiDecisionList = (): LoggedDecision[] => {
    if (!aiActive) return [];
    const data = buildData() as Record<string, unknown>;
    return AI_FIELDS.filter((f) => outcomeOf(f)).map((f) => {
      const decision = outcomeOf(f) as Outcome;
      return { field: f, decision, clicked: decisions[f] as Clicked, suggested: sOf(f)?.value ?? null, final: decision === "rejected" ? null : data[f] };
    });
  };
  const validate = (approve: boolean) => {
    const e: Record<string, string> = {};
    if (approve) {
      if (!form.goalStatus) e.goalStatus = "Välj om veckomålet är uppnått.";
      if (!form.nextGoal.trim()) e.nextGoal = "Skriv ett nytt veckomål.";
      if (form.ecCount == null) e.ec = "Välj antal arbetsgivarkontakter.";
      if (!form.overallStatus) e.overallStatus = "Välj samlad status. Den väljer du själv – AI föreslår den aldrig.";
      if (pendingAi.length) e.ai = `Ta ställning till alla AI-förslag innan du godkänner: ${pendingAi.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}.`;
    }
    if (form.overallStatus === "red") {
      if (!dev.description.trim()) e.devDescription = "Beskriv avvikelsen.";
      if (!dev.action.trim()) e.devAction = "Skriv vilken åtgärd som ska göras.";
      if (!dev.ownerId) e.devOwner = "Välj ansvarig.";
      if (!dev.followUpOn) e.devFollow = "Välj datum för uppföljning.";
      if (!dev.needsCustomerDecision) e.devCust = "Välj om kommunen behöver fatta beslut.";
    }
    return e;
  };
  const shown: Record<string, string> = attempt === null ? errors : { ...validate(attempt), ...errors };
  const devMissing = Object.keys(DEV_MISSING).filter((k) => shown[k]).map((k) => DEV_MISSING[k]);
  const summary = Object.entries(shown).map(([k, text]) => ({ id: k === "ai" ? (pendingAi[0] ? FIELD_ID[pendingAi[0]] : "ci-goal") : (ERROR_FIELD[k] ?? "ci-goal"), text }));
  const changeKey = JSON.stringify([form, dev]);
  const dirty = changeKey !== baseline;
  /** Avvikelsen i anropet (bara vid röd status). */
  const deviationPayload = () =>
    form.overallStatus === "red"
      ? { description: dev.description.trim(), action: dev.action.trim(), ownerId: dev.ownerId, followUpOn: dev.followUpOn, needsCustomerDecision: dev.needsCustomerDecision === "yes" }
      : undefined;
  // Automatisk utkastsparning: samma kommando som "Spara utkast". Kan inte sparas (röd status utan avvikelse, AI utan
  // samtycke) → "invalid" tills nästa ändring. Lyckad sparning sätter baseline – fälten står kvar, inget hämtas om på sidan.
  const autosave = useAutosave({
    enabled: !done && !save.pending,
    dirty,
    changeKey,
    initialSavedAt: savedAtDraft.value,
    save: async ({ keepalive }): Promise<AutosaveResult> => {
      const snapshot = JSON.stringify([form, dev]);
      if (unopenedDraft) return { ok: false, reason: "invalid", text: UNOPENED_DRAFT };
      if (Object.keys(validate(false)).length) return { ok: false, reason: "invalid", text: "Sparas inte automatiskt förrän avvikelsen är ifylld" };
      if (aiActive && !aiAllowed) return { ok: false, reason: "invalid", text: "Sparas inte automatiskt – AI-stöd kräver samtycke" };
      const res = await draftSave
        .run(
          { caseId: c.caseId, checkInId: ciIdRef.current || undefined, expectedVersion: versionRef.current ?? undefined, data: buildData(), approve: false, deviation: deviationPayload(), autosave: true, editSession },
          { keepalive },
        )
        .catch(() => null);
      if (!res) return { ok: false, reason: "failed" };
      if (!res.ok) {
        if (res.error === "deviation_required") return { ok: false, reason: "invalid", text: "Sparas inte automatiskt förrän avvikelsen är ifylld" };
        if (res.error === "ai_not_allowed") return { ok: false, reason: "invalid", text: AI_BLOCKED };
        if (res.error === "approved") return { ok: false, reason: "invalid", text: ALREADY_APPROVED };
        if (res.error === "conflict") return { ok: false, reason: "invalid", text: CONFLICT_TEXT };
        return { ok: false, reason: "failed" };
      }
      remember(res);
      setBaseline(snapshot);
      savedAtDraft.set(res.savedAt);
      return { ok: true, savedAt: res.savedAt };
    },
  });
  // Fråga innan sidan lämnas med osparade val eller mitt i en inspelning (inspelningen pausas medan frågan visas).
  // Medan det skickas/sparas (kommandot och omhämtningen efteråt) frågar vakten inte: annars varnar sidan för text som just
  // har skickats, innan fältet hunnit tömmas. Utan inspelning sparas utkastet först (trySave) – frågan visas bara om det inte gick.
  useUnsavedGuard(
    (dirty && !done && !save.pending) || recActive,
    recActive ? REC_LEAVE : undefined,
    recActive ? { onAsk: () => setHoldRec(true), onStay: () => setHoldRec(false) } : { trySave: () => autosave.flush() },
  );
  const forgetDraft = () => {
    formDraft.clear();
    devDraft.clear();
    baselineDraft.clear();
    idDraft.clear();
    savedAtDraft.clear();
    versionDraft.clear();
  };
  // "Börja om": formuläret nollställs men utkastets id behålls – nästa sparning skriver över samma utkast på servern
  // (aldrig ett andra utkast). Inget sparas förrän coachen skrivit något nytt: det tomma formuläret räknas som sparat läge.
  const restartDraft = () => {
    const blank = initialForm();
    setForm(blank);
    setDevRaw(EMPTY_DEV);
    setBaseline(JSON.stringify([blank, EMPTY_DEV]));
    setAttempt(null);
    setErrors({});
    formDraft.clear();
    devDraft.clear();
  };
  const goToDev = () => {
    const el = document.getElementById("dev-card");
    try {
      el?.scrollIntoView({ block: "start" });
    } catch {
      /* ignoreras */
    }
  };
  const doSave = async (approve: boolean) => {
    const e = validate(approve);
    setErrors({});
    setAttempt(approve);
    if (Object.keys(e).length) {
      // Felsammanfattningen vid knapparna läses upp; fokus till första fältet med fel.
      focusFirstError(document.getElementById("main"));
      return;
    }
    if (aiActive && !aiAllowed) {
      toast(AI_BLOCKED, "error");
      return;
    }
    // En pågående autosparning får bli klar först, så att godkännandet gäller samma utkast (aldrig två rader).
    await autosave.settle();
    const decisionsLogged = approve && aiActive ? aiDecisionList() : [];
    const res = await save
      .run({
        caseId: c.caseId,
        checkInId: ciIdRef.current || undefined,
        expectedVersion: versionRef.current ?? undefined,
        data: buildData(),
        approve,
        deviation: deviationPayload(),
        aiDecisions: approve && aiActive ? decisionsLogged.map((x) => ({ field: x.field, decision: x.decision, suggested: x.suggested, final: x.final, changed: x.decision === "edited" })) : undefined,
      })
      .catch(() => null);
    if (!res) {
      toast("Avstämningen kunde inte sparas.", "error");
      return;
    }
    if (!res.ok) {
      if (res.error === "deviation_required") {
        setErrors({ devDescription: "Röd status kräver en avvikelse med åtgärd, ansvarig och uppföljningsdatum." });
        toast("Röd status kräver en avvikelse.", "error");
      } else if (res.error === "ai_not_allowed") toast(AI_BLOCKED, "error");
      else if (res.error === "approved" || res.error === "conflict") toast(res.message ?? "Avstämningen kunde inte sparas.", "error");
      else toast("Avstämningen kunde inte sparas.", "error");
      return;
    }
    remember(res);
    if (!approve) {
      // Sparat läge: formuläret står kvar som sparat, och fortsatta ändringar sparas i samma utkast (id och version ligger
      // kvar i utkastminnet) – aldrig ett andra utkast. Efter en omladdning visas "Det finns ett sparat utkast".
      setBaseline(JSON.stringify([form, dev]));
      savedAtDraft.set(res.savedAt);
      autosave.markSaved(res.savedAt);
      setAttempt(null);
      toast("Utkastet är sparat. Du kan fortsätta senare.");
      return;
    }
    forgetDraft();
    const stopped = Date.now();
    setDone({ checkInId: res.checkInId, deviationId: res.deviationId, decisions: decisionsLogged, docSecs: Math.round((stopped - start) / 1000), stopped });
    toast("Avstämningen är godkänd.");
    scrollTop();
  };

  if (done) return <CheckInDone v={v} done={done} />;

  const ecOn = !!form.ecCount && form.ecCount !== "0";
  const aiBox = (f: AiField) => (method === "ai" && sugg ? <AiSuggestion field={f} s={sOf(f)} decision={decisions[f] ?? null} outcome={outcomeOf(f)} onDecide={decide} text={suggestionText} /> : null);
  /** AI-förslaget till vänster och coachens fält till höger (på bred skärm), annars under varandra. */
  const pair = (f: AiField, control: ReactNode) =>
    method === "ai" && sugg && sOf(f) ? (
      <div className="grid grid-cols-1 items-start gap-x-5 gap-y-3 min-[1100px]:grid-cols-2">
        {aiBox(f)}
        <Stack gap="sm">{control}</Stack>
      </div>
    ) : (
      control
    );
  const goalSuggestions = (v.options.goalsByPhase[Number(form.phase)] ?? []).filter((x) => x !== form.nextGoal);
  const prevGoal = last?.nextGoal;
  const in7 = addDays(today, 7);

  return (
    <Page
      title={TITLE}
      eyebrow={`${c.name} · ${c.caseNumber}`}
      lead="Förifyllt från kalendern och närvaron. Välj med knapparna – det enda du skriver är anteckningen."
      crumbs={caseCrumbs(c, TITLE)}
    >
      <Card>
        <CaseHeadView head={c} />
      </Card>
      {(formDraft.restored || devDraft.restored) && dirty && (
        <Notice tone="info" icon="edit" title="Ditt osparade utkast är återställt">
          <Row gap="sm">
            <span>Det du fyllde i senast finns kvar. Det är inte sparat ännu.</span>
            <Button kind="ghost" icon="reset" onClick={restartDraft}>
              Börja om
            </Button>
          </Row>
        </Notice>
      )}

      {v.watch && (
        <Notice tone="info" icon="bell" title={`Påminnelse: ingen dokumenterad progression ${v.watch.streak === 1 ? "förra veckan" : `${v.watch.streak} veckor i rad`}`}>
          Orsak: {lc(v.watch.reason)} ({fmtWeekKey(v.watch.weekKey)}). Sätt ett konkret och nåbart veckomål tillsammans med deltagaren och dokumentera det här.
        </Notice>
      )}
      {draftElsewhere && (
        <Notice tone="warn" title={draftElsewhere.ai ? "Det finns ett AI-utkast att granska" : "Det finns ett sparat utkast"}>
          Avstämning {fmtDateTimeLong(draftElsewhere.heldAt)}.{" "}
          {!draftElsewhere.ai && "Det du skriver här sparas inte automatiskt förrän du har öppnat utkastet eller sparat det här som ett nytt utkast. "}
          <Button kind="ghost" to={`/avstamning/${encodeURIComponent(c.caseId)}?avstamning=${encodeURIComponent(draftElsewhere.id)}`}>
            Öppna utkastet
          </Button>
        </Notice>
      )}

      <Card title="Indatasätt" icon="layers" actions={<BuildPhase fas={2} />}>
        <Stack>
          <Seg<Method>
            ariaLabel="Indatasätt"
            value={method}
            onValueChange={setMethod}
            options={[{ value: "manual", label: "Manuellt", icon: "edit" }, { value: "ai", label: "Med AI-stöd", icon: "sparkles" }]}
          />
          {method === "manual" && <p className="text-body text-text-muted">Manuell dokumentation är standard och fullt likvärdig. AI fyller samma formulär – det finns ingen separat AI-väg.</p>}
          {method === "ai" && prot && (
            <Notice tone="critical" title="AI används inte för det här ärendet">
              Inget spelas in och ingen AI används i det här ärendet. Dokumentera manuellt.
            </Notice>
          )}
          {method === "ai" && !prot && !consentOk && (
            <ConsentPanel
              v={v}
              informed={consentInformed}
              setInformed={setConsentInformed}
              lang={consentLang}
              setLang={setConsentLang}
              pending={consent.pending}
              onAnswer={async (value) => {
                const res = await consent.run({ caseId: c.caseId, value, language: value === "given" ? consentLang : undefined }).catch(() => null);
                if (!res || !res.ok) {
                  toast(res && !res.ok && res.message ? res.message : "Samtycket kunde inte registreras.", "error");
                  return;
                }
                toast(value === "given" ? `Samtycket är registrerat (textversion v1.0, ${fmtDate(today)}, informerad av ${user.name || "coachen"}).` : "Nejet är registrerat. Dokumentera manuellt.");
              }}
            />
          )}
          {method === "ai" && !prot && consentOk && (
            <Stack>
              <Row gap="sm" className="text-small">
                <Badge tone="bluetone" icon="shield">
                  Samtycke registrerat{v.consent?.givenAt ? ` ${fmtDate(v.consent.givenAt)}` : ""}
                </Badge>
                <span className="text-text-muted">
                  {v.consent ? `Version ${v.consent.textVersion}, informerad av ${v.consent.informedByName} på ${v.consent.language || "lättläst svenska"}.` : ""}
                </span>
                {!sugg && !proc && (
                  <Button
                    kind="ghost"
                    onClick={async () => {
                      const res = await consent.run({ caseId: c.caseId, value: "revoked" }).catch(() => null);
                      if (res && res.ok) {
                        toast("Samtycket är återkallat. Dokumentera manuellt.");
                        setMethod("manual");
                      } else toast("Samtycket kunde inte återkallas.", "error");
                    }}
                  >
                    Deltagaren återkallar
                  </Button>
                )}
              </Row>
              {sugg ? (
                <AiSourceSummary
                  source={source}
                  heldAt={ci0?.ai ? ci0.heldAt : null}
                  aiMeta={aiMeta}
                  pending={pendingAi.length}
                  showTranscript={showTranscript}
                  setShowTranscript={setShowTranscript}
                  ciId={ciId}
                />
              ) : (
                <AiCapture
                  source={source}
                  setSource={setSource}
                  locked={recActive}
                  setLocked={setRecActive}
                  hold={holdRec}
                  proc={proc}
                  start={startProcessing}
                  onAudio={(a, src) => void captureAudio(a, src)}
                  recording={v.recording}
                  notesText={notesText}
                  setNotesText={setNotesText}
                  durationMin={Number(form.durationMin)}
                  today={today}
                />
              )}
            </Stack>
          )}
        </Stack>
      </Card>

      <Card title="Avstämningen" icon="clipboard">
        {sugg && method === "ai" && (
          <div className="mb-4">
            <Notice tone="info" title="AI-förslag – du bedömer">
              Varje förslag visas med belägg{source === "notes" ? " (meningen i dina anteckningar)" : " (citat och tidpunkt)"}. Acceptera, ändra eller avvisa. Det som inte framgår av
              underlaget visas som <b>Framgår inte</b> och fyller du i själv. <b>Samlad status föreslås aldrig</b> – den väljer du själv.
            </Notice>
          </div>
        )}
        <div>
          <Section n="1" title="Datum, längd och sätt" ok={!!form.date} extra={<span className="text-small font-medium text-text-muted">Förifyllt från kalendern</span>}>
            <FormGrid>
              <Field label="Datum" id="ci-date" help="Dagen för mötet.">
                <DateInput value={form.date} onValueChange={(x) => setF("date", x)} />
              </Field>
              <Field label="Starttid" id="ci-time" help="När mötet började.">
                <TimeInput value={form.time} onValueChange={(x) => setF("time", x)} />
              </Field>
              <Field label="Längd" id="ci-dur" help="Ungefärlig längd på samtalet.">
                <Seg id="ci-dur" ariaLabel="Längd" value={form.durationMin} onValueChange={(x) => setF("durationMin", x)} options={["30", "45", "60", "90"].map((x) => ({ value: x, label: `${x} min` }))} />
              </Field>
              <Field label="Sätt" id="ci-mode" help="Hur ni träffades.">
                <Seg id="ci-mode" ariaLabel="Sätt" value={form.mode} onValueChange={(x) => setF("mode", x)} options={MODE_OPTIONS} />
              </Field>
            </FormGrid>
          </Section>

          <AttendanceSection caseId={c.caseId} from={lastWeekFrom} to={form.date} today={today}>
            {repeated && (
              <Notice tone="warn" title="Upprepad ogiltig frånvaro">
                {repeated.count} ogiltiga frånvarotillfällen inom {repeated.withinDays} dagar. Överväg samlad status Röd med en åtgärdsplan.
              </Notice>
            )}
            <Field label="Kommentar om närvaron" id="ci-attc" help="Valfritt. Till exempel vad ni kom överens om efter en frånvaro.">
              <Input value={form.attendanceComment} onValueChange={(x) => setF("attendanceComment", x)} maxLength={200} />
            </Field>
          </AttendanceSection>

          <Section n="3" title="Veckomål" ok={!!form.goalStatus && !!form.nextGoal.trim()}>
            {pair(
              "goalStatus",
              <Field label="Veckomål uppnått" id="ci-goal" required error={shown.goalStatus} help={prevGoal ? `Förra veckans mål: ”${prevGoal}”` : "Stäm av målet från förra veckan."}>
                <Seg id="ci-goal" ariaLabel="Veckomål uppnått" value={form.goalStatus} onValueChange={(x) => setF("goalStatus", x)} options={GOAL_OPTIONS} />
              </Field>,
            )}
            {pair(
              "nextGoal",
              <>
                <Field label="Nytt veckomål" id="ci-nextgoal" required error={shown.nextGoal} help="Kort och konkret. Välj ett förslag för fasen eller skriv eget.">
                  <Input value={form.nextGoal} onValueChange={(x) => setF("nextGoal", x)} maxLength={140} />
                </Field>
                {goalSuggestions.length > 0 && (
                  <Chips label="Förslag på veckomål" items={goalSuggestions} onPick={(g) => setF("nextGoal", g)} />
                )}
              </>,
            )}
          </Section>

          <Section n="4" title="Fas" ok={!!form.phase}>
            {pair(
              "phase",
              <Field label="Fas" id="ci-phase" required help={`Ärendet är i fas ${c.phase} sedan ${fmtDate(v.phaseSince)}. Byte registreras när du godkänner.`}>
                <Seg id="ci-phase" ariaLabel="Fas" value={form.phase} onValueChange={(x) => setF("phase", x)} options={v.phases.map((p) => ({ value: String(p.no), label: `${p.no} ${p.name}` }))} />
              </Field>,
            )}
          </Section>

          <Section n="5" title="Genomförda aktiviteter" ok={form.activitiesDone.length > 0}>
            {pair(
              "activitiesDone",
              <Field label="Aktiviteter under veckan" id="ci-acts" help="Välj alla som stämmer.">
                <Seg id="ci-acts" multi ariaLabel="Genomförda aktiviteter" value={form.activitiesDone} onValueChange={(x) => setF("activitiesDone", x)} options={v.options.activityTypes} />
              </Field>,
            )}
          </Section>

          <Section n="6" title="Arbetsgivarkontakter" ok={form.ecCount != null}>
            {pair(
              "employerContacts",
              <Stack>
                <Field label="Antal" id="ci-ec" required error={shown.ec} help="Konkreta kontakter under veckan.">
                  <Seg<Ec> id="ci-ec" ariaLabel="Antal arbetsgivarkontakter" value={form.ecCount} onValueChange={(x) => setF("ecCount", x)} options={["0", "1", "2+"]} />
                </Field>
                {ecOn && (
                  <Field label="Typ" id="ci-ectype" help="Välj en eller flera.">
                    <Seg id="ci-ectype" multi ariaLabel="Typ av arbetsgivarkontakt" value={form.ecTypes} onValueChange={(x) => setF("ecTypes", x)} options={EC_TYPES.map((x) => ({ value: x, label: cap(x) }))} />
                  </Field>
                )}
              </Stack>,
            )}
          </Section>

          <Section n="7" title="Samlad status" ok={!!form.overallStatus} extra={<span className="text-small font-medium text-text-muted">Ditt val – föreslås aldrig av AI</span>}>
            <Field
              label="Samlad status"
              id="ci-status"
              required
              error={shown.overallStatus}
              help="Grön = enligt plan. Gul = risk eller extra åtgärd. Röd = kräver omplanering eller dialog med kommunen."
            >
              <Seg<Rag> id="ci-status" ariaLabel="Samlad status" value={form.overallStatus} onValueChange={(x) => setF("overallStatus", x)} options={STATUS_OPTIONS} />
            </Field>
            {form.overallStatus === "red" && (
              <Card id="dev-card" tone="red" title="Avvikelse – krävs vid röd status" icon="alert">
                <Stack>
                  <p>Avvikelse = åtgärd. Röd status kan inte godkännas utan en avvikelse: beskriv vad som hänt, vad som ska göras, vem som ansvarar och när ni följer upp.</p>
                  {devSuggestion && (
                    <AiBox className="border-dashed bg-vit">
                      <Row gap="sm">
                        <Badge tone="grey" icon="flag">
                          Flagga: upprepad ogiltig frånvaro
                        </Badge>
                      </Row>
                      <div className="text-body">
                        Förslag utifrån flaggan: ”{devSuggestion.description}” – {lc(devSuggestion.action)}
                      </div>
                      <div>
                        <Button
                          kind="secondary"
                          icon="copy"
                          onClick={() =>
                            setDev({
                              ...dev,
                              description: dev.description.trim() ? dev.description : devSuggestion.description,
                              action: dev.action.trim() ? dev.action : devSuggestion.action,
                            })
                          }
                        >
                          Använd förslaget från flaggan
                        </Button>
                      </div>
                    </AiBox>
                  )}
                  <Field label="Beskrivning" id="dev-desc" required error={shown.devDescription} help="Sakligt och funktionellt. Inga diagnoser.">
                    <TextArea rows={2} value={dev.description} onValueChange={(x) => setDev({ ...dev, description: x })} maxLength={300} />
                  </Field>
                  <Field label="Åtgärd" id="dev-action" required error={shown.devAction} help="Vad görs för att planen ska hålla?">
                    <TextArea rows={2} value={dev.action} onValueChange={(x) => setDev({ ...dev, action: x })} maxLength={300} />
                  </Field>
                  <FormGrid>
                    <Field label="Ansvarig" id="dev-owner" required error={shown.devOwner} help="Den som ser till att åtgärden blir gjord.">
                      <Select value={dev.ownerId} placeholder="Välj ansvarig" onValueChange={(x) => setDev({ ...dev, ownerId: x })} options={v.owners.map((o) => ({ value: o.id, label: o.name }))} />
                    </Field>
                    <Field label="Uppföljningsdatum" id="dev-follow" required error={shown.devFollow} help="Förslag: om en vecka.">
                      <DateInput value={dev.followUpOn} onValueChange={(x) => setDev({ ...dev, followUpOn: x })} />
                      {dev.followUpOn !== in7 && (
                        <div className="flex flex-wrap gap-1.5">
                          <ChipButton onClick={() => setDev({ ...dev, followUpOn: in7 })}>Om en vecka: {fmtWeekday(in7)}</ChipButton>
                        </div>
                      )}
                    </Field>
                  </FormGrid>
                  <Field
                    label="Behöver beslut från kommunen"
                    id="dev-cust"
                    required
                    error={shown.devCust}
                    help="Till exempel om planen, omfattningen eller ett avbrott. Vid Ja får handläggaren en uppgift i portalen."
                  >
                    <Seg<"yes" | "no">
                      id="dev-cust"
                      ariaLabel="Behöver beslut från kommunen"
                      value={dev.needsCustomerDecision}
                      onValueChange={(x) => setDev({ ...dev, needsCustomerDecision: x })}
                      options={[{ value: "yes", label: "Ja" }, { value: "no", label: "Nej" }]}
                    />
                  </Field>
                  <p className="text-body text-text-muted">Efter godkännandet kan du kalla kommunen till ett uppföljningsmöte.</p>
                </Stack>
              </Card>
            )}
          </Section>

          <Section n="8" title="Hinder" ok>
            {pair(
              "obstacles",
              <Field label="Hinder" id="ci-obst" help="Funktionella kategorier. Välj inga om inget hindrar.">
                <Seg id="ci-obst" multi ariaLabel="Hinder" value={form.obstacles} onValueChange={(x) => setF("obstacles", x)} options={v.options.obstacles} />
              </Field>,
            )}
          </Section>

          <Section n="9" title="Kort anteckning" ok={!!form.note.trim()}>
            {pair(
              "note",
              <Field
                label="Anteckning"
                id="ci-note"
                help={`Kort och saklig. Inga diagnoser eller omdömen om personen. ${v.seesCoachNotes ? "Kommunen kan läsa anteckningen." : "Kommunen ser inte anteckningen."}`}
              >
                <TextArea rows={3} value={form.note} onValueChange={(x) => setF("note", x)} maxLength={500} />
              </Field>,
            )}
            <div className="text-right text-small text-text-muted">{form.note.length} av 500 tecken</div>
            {!prot && (
              <VoiceNotesForCheckIn
                caseId={c.caseId}
                highlightId={rostId}
                onUse={(text) => {
                  setForm((f) => ({ ...f, note: (f.note.trim() ? `${f.note.trim()}\n${text}` : text).slice(0, 500) }));
                  toast("Texten är tillagd i anteckningen. Läs och korta den vid behov.");
                }}
              />
            )}
          </Section>
        </div>
      </Card>

      {devMissing.length > 0 && (
        <Notice tone="critical" title="Stopp: röd status kräver en avvikelse">
          Avstämningen godkänns inte förrän avvikelsen är ifylld. Det saknas: {devMissing.join(", ")}.
          <div className="mt-2">
            <Button kind="secondary" icon="chevron-up" onClick={goToDev}>
              Gå till avvikelsen
            </Button>
          </div>
        </Notice>
      )}
      <ErrorSummary items={summary} title={attempt ? "Avstämningen kan inte godkännas ännu" : "Rätta det här innan du sparar"} />
      {/* Knapparna ligger kvar längst ned på skärmen medan man fyller i formuläret. */}
      <div data-print="hide" className="sticky bottom-0 z-10 -mx-1 border-t border-ljusgra bg-vit px-1 py-2.5 shadow-[0_-6px_12px_-8px_rgb(30_37_43/0.25)]">
        {/* Smal skärm: knapparna staplas i full bredd så att "Godkänn avstämningen" aldrig klipps; dokumentationstiden döljs (den syns i kvittot). */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-2 max-[560px]:w-full max-[560px]:flex-col max-[560px]:[&>button]:w-full">
            <Button kind="primary" size="lg" icon="check" pending={save.pending} onClick={() => void doSave(true)}>
              Godkänn avstämningen
            </Button>
            <Button kind="secondary" icon="file" pending={save.pending} onClick={() => void doSave(false)}>
              Spara utkast
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <AutosaveStatus state={autosave.state} savedAt={autosave.savedAt} invalidText={autosave.invalidText} />
            <DocTimer start={start} className="max-[560px]:hidden" />
          </div>
        </div>
      </div>
      <DemoNote>Dokumentationstiden mäts från att formuläret öppnas till godkännandet. Måttet används för att jämföra manuell dokumentation med AI-stöd (SPEC §8.5).</DemoNote>
    </Page>
  );
}

// ---------------------------------------------------------------- Delar av formuläret
/** Numrerad sektion i avstämningen. Bock när sektionen är ifylld. */
function Section({ n, title, ok, extra, children }: { n: string; title: string; ok?: boolean; extra?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-b border-ljusgra py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2 text-body font-extrabold">
        <span
          aria-hidden="true"
          className={cn("grid size-[26px] flex-none place-items-center rounded-full border-2 border-antracit text-meta [&_svg]:size-4", ok && "border-bla bg-bla")}
        >
          {ok ? <Icon name="check" /> : n}
        </span>
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

/** Sektion 2: närvaron senaste veckan fram till avstämningens datum (från närvaroregistreringen). */
function AttendanceSection({ caseId, from, to, today, children }: { caseId: string; from: string | null; to: string; today: string; children?: ReactNode }) {
  const q = useQuery(checkInAttendance, from && to ? { caseId, date: to } : null);
  const att = q.data;
  return (
    <Section
      n="2"
      title="Närvaro senaste veckan"
      ok={!!att && att.unregistered === 0}
      extra={
        <span className="text-small font-medium text-text-muted">
          {from ? `${fmtDateShort(from)}–${fmtDateShort(to)}` : "–"} · från närvaroregistreringen
        </span>
      }
    >
      {att && (
        <Row gap="sm">
          {/* Nollor döljs – bara "närvarande" visas alltid, så att raden inte blir fyra nollor. */}
          <Badge tone="blue" icon="check-circle">
            {att.present} närvarande
          </Badge>
          {att.late > 0 && (
            <Badge tone="grey" icon="clock">
              {att.late} sen
            </Badge>
          )}
          {att.absentValid > 0 && (
            <Badge tone="outline" icon="minus-circle">
              {att.absentValid} giltig frånvaro
            </Badge>
          )}
          {att.absentInvalid > 0 && (
            <Badge tone="red" icon="x-circle">
              {att.absentInvalid} ogiltig frånvaro
            </Badge>
          )}
          {att.unregistered > 0 && (
            // Kontur och ring (som närvarosidan): rött är bara för det som brådskar.
            <Badge tone="outline" icon="circle">
              {att.unregistered} ej registrerade
            </Badge>
          )}
          <span className="text-small text-text-muted">
            {att.rate != null
              ? `Närvarograd ${pct(att.rate, 0)} av ${att.planned} planerade`
              : att.unregistered > 0
                ? "Närvarograden räknas när tillfällena är registrerade"
                : "Inga passerade tillfällen"}
          </span>
        </Row>
      )}
      {att && att.unregistered > 0 && (
        <div>
          <Button kind="ghost" icon="check-square" to={`/narvaro?vecka=${monday(to) === monday(today) ? "denna" : "forra"}`}>
            Registrera närvaron först
          </Button>
        </div>
      )}
      {children}
    </Section>
  );
}

// ---------------------------------------------------------------- AI-förslag
function AiSuggestion({
  field, s, decision, outcome, onDecide, text,
}: {
  field: AiField;
  s: AiFieldSuggestion<unknown> | undefined;
  decision: Clicked | null;
  outcome: Outcome | null;
  onDecide: (f: AiField, d: Clicked) => void;
  text: (f: AiField, v: unknown) => string;
}) {
  if (!s) return null;
  const label = `AI-förslag för ${FIELD_LABEL[field].toLowerCase()}`;
  if (s.noEvidence) {
    return (
      <div role="group" aria-label={label}>
        <AiBox className="border-dashed bg-vit">
          <Row gap="sm">
            <AiTag />
            <span className="text-small text-text-muted">Inget förslag</span>
          </Row>
          <div className="font-bold">Framgår inte</div>
          <div className="text-body text-text-muted">{s.quote || "Framgår inte av underlaget. Fyll i själv."}</div>
        </AiBox>
      </div>
    );
  }
  const badge = !decision ? (
    <span className="text-small text-text-muted">Ta ställning till förslaget</span>
  ) : outcome === "rejected" ? (
    <Badge tone="outline" icon="x">
      Avvisat
    </Badge>
  ) : outcome === "edited" ? (
    <Badge tone="bluetone" icon="edit">
      Ändrat – loggas som ändrat
    </Badge>
  ) : decision === "edit" ? (
    <Badge tone="outline" icon="edit">
      Oförändrat – loggas som accepterat
    </Badge>
  ) : (
    <Badge tone="bluetone" icon="check">
      Accepterat
    </Badge>
  );
  return (
    <div role="group" aria-label={label}>
      <AiBox>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <AiTag />
          {badge}
        </div>
        <div data-testid="ai-forslag-varde" className="font-bold">
          {text(field, s.value)}
        </div>
        <Evidence quote={s.quote} t={s.t} />
        {decision === "edit" && outcome !== "edited" && <div className="text-body">Ändra värdet i fältet. Behåller du förslaget loggas beslutet som accepterat.</div>}
        <Row gap="sm">
          <Button kind={decision === "accepted" ? "primary" : "secondary"} icon="check" ariaPressed={decision === "accepted"} onClick={() => onDecide(field, "accepted")}>
            Acceptera
          </Button>
          <Button kind={decision === "edit" ? "primary" : "secondary"} icon="edit" ariaPressed={decision === "edit"} onClick={() => onDecide(field, "edit")}>
            Ändra
          </Button>
          <Button kind={decision === "rejected" ? "primary" : "ghost"} icon="x" ariaPressed={decision === "rejected"} onClick={() => onDecide(field, "rejected")}>
            Avvisa
          </Button>
        </Row>
      </AiBox>
    </div>
  );
}

// ---------------------------------------------------------------- Samtycke
/** Information och registrering av samtycke till inspelning och AI (SPEC §8.1 punkt 2). */
function ConsentPanel({
  v, informed, setInformed, lang, setLang, pending, onAnswer,
}: {
  v: Ok;
  informed: boolean;
  setInformed: (x: boolean) => void;
  lang: string;
  setLang: (x: string) => void;
  pending: boolean;
  onAnswer: (value: "given" | "declined") => Promise<void>;
}) {
  const status = v.aiConsent;
  return (
    <Stack>
      <Notice tone="warn" title="Samtycke saknas">
        {status === "declined"
          ? `Deltagaren sa nej ${v.consent?.declinedAt ? fmtDate(v.consent.declinedAt) : ""}. Ett nej får inga konsekvenser. Fråga bara igen om deltagaren själv tar upp det.`
          : status === "revoked"
            ? "Deltagaren har återkallat sitt samtycke. Dokumentera manuellt eller informera på nytt om deltagaren själv vill."
            : "Deltagaren har inte fått frågan ännu. Inget får spelas in innan samtycket är registrerat."}{" "}
        Samtycket registreras här nedan eller i{" "}
        <Link to={`/arenden/${encodeURIComponent(v.head.caseId)}`} className="font-bold underline">
          deltagarkortet
        </Link>
        .
      </Notice>
      <div className="flex flex-col gap-1.5 border-l-4 border-bla bg-vit px-3.5 py-2.5">
        <span className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Information till deltagaren (läs upp eller ge i skrift)</span>
        <p>Vi vill spela in samtalet. Då kan din coach skriva anteckningarna snabbare.</p>
        <p>Ljudet raderas direkt när det har skrivits ut. Texten raderas när din coach har godkänt anteckningarna.</p>
        <p>Det är frivilligt. Du kan säga nej eller ändra dig när du vill. Ett nej påverkar inte ditt stöd.</p>
      </div>
      <Field label="Språk för informationen" id="cons-lang" help="Översättning finns på de vanligaste språken.">
        <Seg id="cons-lang" ariaLabel="Språk för informationen" value={lang} onValueChange={setLang} options={CONSENT_LANGS.map((x) => ({ value: x, label: cap(x) }))} />
      </Field>
      <Check id="cons-informed" checked={informed} onCheckedChange={setInformed}>
        Jag har informerat deltagaren och deltagaren har förstått informationen.
      </Check>
      <Row>
        <Button kind="primary" icon="check" disabled={!informed} pending={pending} onClick={() => void onAnswer("given")}>
          Deltagaren säger ja
        </Button>
        <Button kind="secondary" icon="x" disabled={!informed} pending={pending} onClick={() => void onAnswer("declined")}>
          Deltagaren säger nej
        </Button>
      </Row>
    </Stack>
  );
}

// ---------------------------------------------------------------- Inspelning och bearbetning
/**
 * Val av underlag och bearbetning. Spela in samtalet (webbläsarens mikrofon, i prototypen går det också att simulera) eller
 * ladda upp en ljudfil – ljudet transkriberas och raderas direkt. Teams-transkript och inklistrade anteckningar som förut.
 */
function AiCapture({
  source, setSource, locked, setLocked, hold, proc, start, onAudio, recording, notesText, setNotesText, durationMin, today,
}: {
  source: AiSource;
  setSource: (s: AiSource) => void;
  /** En inspelning pågår – källan kan inte bytas. */
  locked: boolean;
  setLocked: (x: boolean) => void;
  /** Pausa inspelningen (frågan om att lämna sidan visas). */
  hold: boolean;
  proc: Proc | null;
  start: (s: AiSource) => void;
  onAudio: (audio: RecordedAudio, src: "recording" | "upload") => void;
  recording: Ok["recording"];
  notesText: string;
  setNotesText: (x: string) => void;
  durationMin: number;
  today: string;
}) {
  if (proc) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-mb border-[1.5px] border-bla bg-bla-ton px-3.5 py-3">
        {proc.steps.map((s, i) => (
          <div key={s} className={cn("flex items-center gap-2", i > proc.i && "text-text-muted", i === proc.i && "font-extrabold")}>
            <Icon name={i < proc.i ? "check" : i === proc.i ? "refresh" : "circle"} />
            {s}
          </div>
        ))}
        <span className="text-body text-text-muted">Bearbetas i Sverige/EU. Ingenting används för att träna modellen.</span>
      </div>
    );
  }
  const maxSeconds = Math.max(60, recording.maxMinutes * 60);
  // AI av (produktion utan leverantör, beslut 2026-10-08): ingen källa att välja – klartext och den manuella vägen.
  if (recording.block === "ai_off") {
    return (
      <Notice tone="warn" title="Tal till text är inte kopplat ännu">
        {recording.blockText ?? AI_OFF_TEXT} Fyll i formuläret manuellt – det är fullt likvärdigt.
      </Notice>
    );
  }
  const blocked =
    !recording.allowed && (source === "recording" || source === "upload") ? (
      <Notice tone="warn" title="Inspelning används inte">
        {recording.blockText ?? "Inspelning kan inte göras i det här ärendet."} Välj Teams-transkript eller inklistrade anteckningar, eller dokumentera manuellt.
      </Notice>
    ) : null;
  return (
    <Stack>
      <Field label="Källa" id="ai-src" help="AI fyller samma formulär som den manuella vägen.">
        <Seg<AiSource>
          id="ai-src"
          ariaLabel="Källa"
          value={source}
          onValueChange={(x) => {
            if (!locked) setSource(x);
          }}
          options={(Object.entries(SOURCE) as [AiSource, (typeof SOURCE)[AiSource]][]).map(([k, x]) => ({ value: k, label: x.choose, icon: x.icon, disabled: locked && k !== source }))}
        />
      </Field>
      {source === "recording" &&
        (blocked ?? (
          <Stack gap="sm">
            <p className="text-body">
              Spela in samtalet i rummet. Pausa när samtalet går in på sådant som inte behövs för uppdraget. Ljudet laddas upp till en privat lagring i Sverige och
              raderas direkt efter transkriberingen.
            </p>
            <Recorder
              idPrefix="ci-rec"
              maxSeconds={maxSeconds}
              onActiveChange={setLocked}
              hold={hold}
              texts={{
                stop: "Stoppa och tolka",
                hint: "Pausa när samtalet går in på sådant som inte behövs för uppdraget.",
                simulateNote: `Webbläsaren i prototypen har ofta ingen mikrofon. Simulera en inspelning: tiden går men inget ljud spelas in, och förslagen bygger på ett påhittat samtal på ${durationMin} minuter. I tjänsten spelas samtalet in i webbläsaren.`,
              }}
              onRecorded={(a) => onAudio(a, "recording")}
            />
          </Stack>
        ))}
      {source === "upload" &&
        (blocked ?? (
          <Stack gap="sm">
            <Recorder
              idPrefix="ci-up"
              record={false}
              upload
              maxSeconds={maxSeconds}
              texts={{ fileLabel: "Ljudfil", fileButton: "Ladda upp och tolka" }}
              onRecorded={(a) => onAudio(a, "upload")}
            />
            <DemoNote>
              <span className="flex flex-col items-start gap-2">
                <span>Filen laddas inte upp i prototypen – den tolkas som ett påhittat samtal på {durationMin} minuter.</span>
                <Button
                  kind="secondary"
                  icon="paperclip"
                  onClick={() =>
                    onAudio(
                      { blob: null, mimeType: "audio/mp4", durationSec: null, bytes: durationMin * 60 * 4000, simulated: true, source: "file", fileName: `avstamning_${today}.m4a` },
                      "upload",
                    )
                  }
                >
                  Använd exempelfil
                </Button>
              </span>
            </DemoNote>
          </Stack>
        ))}
      {source === "teams" && (
        <Stack gap="sm">
          <p>Transkriptet (.vtt) hämtas från Teams-mötet. Ingen ljudbehandling behövs.</p>
          <DemoNote>Kopplingen till Microsoft Graph är simulerad.</DemoNote>
          <div>
            <Button kind="primary" icon="video" onClick={() => start("teams")}>
              Hämta transkript från Teams
            </Button>
          </div>
        </Stack>
      )}
      {source === "notes" && (
        <Stack gap="sm">
          <Field label="Dina anteckningar" id="ai-notes" help="Klistra in stödord eller anteckningar från mötet. Minst 20 tecken.">
            <TextArea rows={4} value={notesText} onValueChange={setNotesText} maxLength={3000} />
          </Field>
          <div>
            <Button kind="primary" icon="sparkles" disabled={notesText.trim().length < 20} onClick={() => start("notes")}>
              Tolka anteckningarna
            </Button>
          </div>
        </Stack>
      )}
    </Stack>
  );
}

/** Sammanfattning av AI-körningen och dataminimeringen (ljud och råtranskript). */
function AiSourceSummary({
  source, heldAt, aiMeta, pending, showTranscript, setShowTranscript, ciId,
}: {
  source: AiSource;
  heldAt: string | null;
  aiMeta: AiMeta | null;
  pending: number;
  showTranscript: boolean;
  setShowTranscript: (x: boolean) => void;
  ciId: string | null;
}) {
  const src = SOURCE[source] ?? SOURCE.recording;
  const info = useQuery(aiRunInfo, aiMeta?.runId ? { runId: aiMeta.runId } : null);
  const transcript = aiMeta?.transcript ?? [];
  return (
    <Stack>
      <Row gap="sm">
        <AiTag>AI-utkast</AiTag>
        <span className="font-bold">
          {src.label}
          {heldAt ? ` · ${fmtDateTimeLong(heldAt)}` : ""}
        </span>
        {info.data && info.data.provider !== "simulated" && <span className="text-small text-text-muted">{PROVIDER_TEXT}</span>}
      </Row>
      {/* Testmiljön: den simulerade AI-leverantören ger påhittad text (beslut 2026-10-07, synpunkt #8). */}
      {info.data?.provider === "simulated" && <SimulatedAiNotice who="you" />}
      <Timeline
        items={[
          src.audio
            ? { icon: "trash", filled: true, title: "Ljudet är raderat", sub: aiMeta?.audioDeletedAt ? `${fmtDateTimeLong(aiMeta.audioDeletedAt)} – direkt efter transkriberingen` : "Direkt efter transkriberingen" }
            : { icon: "info", title: "Inget ljud", sub: source === "teams" ? "Transkriptet hämtades från Teams." : "Förslagen bygger på dina anteckningar." },
          { icon: "file", title: "Råtranskriptet raderas när du godkänner", sub: aiMeta?.deleteBy ? `Senast ${fmtDate(aiMeta.deleteBy)} om avstämningen inte godkänns.` : "" },
          { icon: "check", title: pending > 0 ? `${pending} förslag väntar på ditt beslut` : "Alla förslag är granskade", sub: "Varje beslut sparas och loggas." },
        ]}
      />
      {transcript.length > 0 && (
        <Stack gap="sm">
          <div>
            <Button kind="ghost" icon={showTranscript ? "eye-off" : "eye"} ariaPressed={showTranscript} onClick={() => setShowTranscript(!showTranscript)}>
              {showTranscript ? "Dölj råtranskriptet" : "Visa råtranskriptet"}
            </Button>
          </div>
          {showTranscript && <TranscriptPanel ciId={ciId} transcript={transcript} />}
          {showTranscript && <span className="text-body text-text-muted">Visningen loggas i revisionsloggen. Rapporter byggs aldrig från råtranskriptet.</span>}
        </Stack>
      )}
    </Stack>
  );
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Råtranskriptet. Visningen loggas i revisionsloggen (CLAUDE.md punkt 3). */
function TranscriptPanel({ ciId, transcript }: { ciId: string | null; transcript: AiMeta["transcript"] }) {
  const log = useCommand(auditView);
  useAuditView(`transcript.view:${ciId ?? "ny"}`, () => log.run({ action: "transcript.view", entity: "check_in", entityId: ciId }).catch(() => undefined));
  return (
    <div data-testid="ratranskript" tabIndex={0} aria-label="Råtranskript" className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto rounded-mb border border-ljusgra px-3 py-2.5 text-body">
      {transcript.map((x, i) => (
        <div key={i}>
          {x.t != null && <span className="mr-2 font-bold tabular-nums">{mmss(x.t)}</span>}
          <b>{x.who}:</b> {x.text}
        </div>
      ))}
    </div>
  );
}

// ================================================================ Kvittot efter godkännandet
/** Efter godkännande: sammanfattning, dataminimering och "Kalla kommunen till uppföljning". */
function CheckInDone({ v, done }: { v: Ok; done: Done }) {
  const q = useQuery(checkInReceipt, { caseId: v.head.caseId, checkInId: done.checkInId, deviationId: done.deviationId });
  const r = q.data;
  if (!r) return <PageState title="Avstämningen är godkänd" error={q.error} onRetry={() => void q.refetch()} />;
  if (r.kind === "gate") return <GateView gate={r.gate} title={TITLE} listPath="/avstamning" />;
  return <Receipt v={v} r={r} done={done} />;
}

function Receipt({ v, r, done }: { v: Ok; r: Extract<CheckInReceipt, { kind: "ok" }>; done: Done }) {
  const call = useCommand(deviationCallCustomer);
  const ref = r.referrer;
  const [proposed, setProposed] = useState(r.proposedAt);
  const template = (at: string) =>
    `Hej${ref.name ? ` ${ref.name.split(" ")[0]}` : ""}! Veckoavstämningen för ärende ${r.caseNumber} visar att planen behöver ses över. Jag föreslår ett uppföljningsmöte ${
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? fmtDateTimeLong(at) : "en tid som passar dig"
    } hos oss i ${r.location}. Svara gärna här om tiden passar eller föreslå en annan. Hälsningar ${r.coachName}, Miljonbemanning`;
  const [edited, setEdited] = useState<string | null>(null);
  const body = edited ?? template(proposed);
  const [sent, setSent] = useState(false);
  const count = (k: Outcome) => done.decisions.filter((x) => x.decision === k).length;
  const m = Math.floor(done.docSecs / 60);
  const s = done.docSecs % 60;
  const ci = r.checkIn;
  const dv = r.deviation;
  const persp = customerPerspective(ref);
  const phaseText = (val: unknown) => `Fas ${Number(val)} · ${v.phases.find((p) => p.no === Number(val))?.name ?? ""}`;
  const text = (field: AiField, val: unknown): string => {
    if (val == null) return "Framgår inte";
    if (field === "goalStatus") return GOAL_TEXT[val as Goal] ?? String(val);
    if (field === "phase") return phaseText(val);
    if (field === "activitiesDone" || field === "obstacles") return (val as string[]).length ? (val as string[]).join(", ") : "Inga";
    if (field === "employerContacts") return ecText(val as { count: string; types: string[] });
    return String(val);
  };
  const send = async () => {
    if (!dv) return;
    const res = await call.run({ caseId: v.head.caseId, deviationId: dv.id, body: body.trim(), proposedAt: proposed }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Mötesförfrågan kunde inte skickas.", "error");
      return;
    }
    setSent(true);
    toast("Mötesförfrågan är skickad till kommunen.");
  };
  return (
    <Page title="Avstämningen är godkänd" eyebrow={`${r.name} · ${r.caseNumber}`} crumbs={caseCrumbs({ caseId: v.head.caseId, caseNumber: r.caseNumber }, TITLE)}>
      <Grid cols={3}>
        <Kpi label="Dokumentationstid" value={`${m} min ${String(s).padStart(2, "0")} s`} sub={m < 5 ? "Under målet 5 min" : "Över målet 5 min"} tone={m < 5 ? undefined : "watch"} />
        <Kpi label="Samlad status" value={<Status value={ci?.overallStatus ?? null} short />} sub={ci?.phaseLabel ?? ""} />
        <Kpi
          label="AI-förslag"
          value={done.decisions.length ? `${count("accepted")} / ${count("edited")} / ${count("rejected")}` : "–"}
          sub={done.decisions.length ? "accepterade / ändrade / avvisade" : "Manuell dokumentation"}
        />
      </Grid>
      {done.decisions.length > 0 && (
        <Card title="Loggade AI-beslut" icon="check-square" flush foot={<span className="text-body text-text-muted">Varje beslut sparas med vem som beslutade och när. Förslag som inte framgick av underlaget räknas inte.</span>}>
          <List>
            {done.decisions.map((x) => (
              <div key={x.field} className="flex min-w-0 flex-wrap items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0">
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <div className="font-bold">{FIELD_LABEL[x.field]}</div>
                  <div className="text-small text-text-muted">
                    Förslag: {text(x.field, x.suggested)}
                    {x.decision === "edited" ? ` · Sparat: ${text(x.field, x.final)}` : ""}
                  </div>
                  {x.clicked === "edit" && x.decision === "accepted" && <div className="text-body">Du valde Ändra men behöll förslaget. Därför loggas beslutet som accepterat.</div>}
                </div>
                <div className="flex flex-none">
                  <Badge tone={x.decision === "rejected" ? "outline" : "bluetone"} icon={x.decision === "rejected" ? "x" : x.decision === "edited" ? "edit" : "check"}>
                    {OUTCOME_LABEL[x.decision]}
                  </Badge>
                </div>
              </div>
            ))}
          </List>
        </Card>
      )}
      {ci?.ai && (
        <Card title="Dataminimering" icon="shield">
          <Timeline
            items={[
              ci.ai.audioDeletedAt
                ? { icon: "trash", filled: true, title: "Ljudet raderades direkt efter transkriberingen", sub: fmtDateTimeLong(ci.ai.audioDeletedAt) }
                : { icon: "info", title: "Inget ljud användes" },
              { icon: "trash", filled: true, title: "Råtranskriptet raderades vid godkännandet", sub: ci.ai.rawTranscriptDeletedAt ? fmtDateTimeLong(ci.ai.rawTranscriptDeletedAt) : "" },
              { icon: "check", filled: true, title: "Kvar finns bara godkända, strukturerade uppgifter", sub: "Det är dem månadsrapporten byggs av." },
            ]}
          />
        </Card>
      )}
      {dv && (
        <Card tone="red" title="Avvikelse skapad" icon="alert">
          <Stack>
            <Kv
              items={[
                ["Beskrivning", dv.description],
                ["Åtgärd", dv.action],
                ["Ansvarig", dv.ownerName],
                ["Uppföljning", fmtDate(dv.followUpOn)],
                ["Beslut från kommunen", dv.needsCustomerDecision ? "Behövs" : "Behövs inte"],
              ]}
            />
            {dv.needsCustomerDecision && dv.taskCreated && (
              <p className="text-body">Handläggaren {ref.name ?? ""} har fått en uppgift i portalen om att beslutet behövs. Mejlet innehåller bara ärendenumret.</p>
            )}
            {!sent ? (
              <Stack>
                <span className="flex items-center gap-2 text-label font-extrabold tracking-[0.1em] uppercase">
                  <span aria-hidden="true" className="inline-block size-[0.5em] rounded-full bg-rod" />
                  Kalla kommunen till uppföljning
                </span>
                <p className="text-body">
                  Mötesförfrågan skickas som ett säkert meddelande i portalen till {ref.name ? `${ref.name}, ${ref.unit ?? ""}` : "handläggaren"}. Mejlet till handläggaren innehåller bara
                  ärendenumret.
                </p>
                <FormGrid>
                  <Field label="Föreslagen tid" id="call-at" help="Förslag: om två arbetsdagar.">
                    <DateTimeInput value={proposed} onValueChange={setProposed} />
                  </Field>
                </FormGrid>
                <Field label="Meddelande" id="call-body" help="Skrivs i portalen. Skriv inga känsliga detaljer.">
                  <TextArea rows={4} value={body} onValueChange={setEdited} maxLength={800} />
                </Field>
                <Row>
                  <Button kind="primary" icon="send" disabled={!body.trim() || !proposed} pending={call.pending} onClick={() => void send()}>
                    Kalla kommunen till uppföljning
                  </Button>
                </Row>
              </Stack>
            ) : (
              <Stack>
                <Notice tone="ok" title="Mötesförfrågan är skickad">
                  Föreslagen tid: {fmtDateTimeLong(proposed)}. Handläggaren fick mejlet: ”Du har ett nytt meddelande om ärende {r.caseNumber} – logga in för att läsa.”
                </Notice>
                <Row>
                  <Persp role={persp.role} userId={persp.userId} to={`/portal/deltagare/${encodeURIComponent(v.head.caseId)}`} label="Se mötesförfrågan som kommunen" />
                </Row>
              </Stack>
            )}
          </Stack>
        </Card>
      )}
      <Row>
        <Button kind="primary" icon="calendar" to="/min-vecka">
          Till Min vecka
        </Button>
        <Button kind="secondary" to={`/arenden/${encodeURIComponent(v.head.caseId)}?flik=avstamningar`}>
          Öppna deltagarkortet
        </Button>
      </Row>
    </Page>
  );
}
