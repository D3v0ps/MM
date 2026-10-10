// SIMULERAD AI (prototypens makeSuggestions och parseNotes i prototyp/src/views/coach.js, plus röstinspelningen).
//   1. simulateCheckInSuggestions/simulatedTranscript: kommandot coach.aiRun (förslag till veckoavstämningen) – som förut.
//   2. createSimulatedAi(): porten ctx.ai (src/features/_shared/ai-port.ts) i minnesläget, prototypen och testmiljön
//      (MM_AI_PROVIDER=simulated) tills Vertex AI är inkopplat. Deterministisk: samma ljud-id, text och underlag ger alltid
//      samma svar. Transkripten är påhittade (src/data/seed/voice-texts.ts) – extract och draft arbetar däremot på det
//      verkliga underlaget (transkriptets meningar, godkända avstämningar och närvaro) och hittar aldrig på något.
//
// AI föreslår – människan bedömer (CLAUDE.md punkt 5): samlad status föreslås aldrig. Varje förslag har belägg
// (citat + tidpunkt i sekunder). Det som inte framgår av underlaget blir "Framgår inte" utan förslag (noEvidence).
import { fmtDateShort, MONTHS } from "@/core/time";
import { uniq } from "@/core/util";
import { ACTIVITY_TYPES, GOALS } from "@/data/seed/constants";
import {
  CHECK_IN_CONVERSATION_SECONDS, CHECK_IN_CONVERSATIONS, DICTATIONS, LANGUAGE_NAME_SV, PARTICIPANT_MESSAGES, VOICE_LANGUAGES, type VoiceLanguage,
} from "@/data/seed/voice-texts";
import type { CheckIn, EmployerContacts, GoalStatus, TranscriptLine } from "@/data/schema";
import {
  assertApprovedInput, mmss, noteSourceLabel,
  type AiPort, type AiResult, type AiRunMeta, type ApprovedCheckIn, type AudioInput, type DraftInput, type DraftTemplateKey, type DraftText,
  type ExtractSchemaKey, type ExtractSchemas, type Transcript, type TranscriptSegment, type Translation,
} from "./ai-port";
import { AI_FIELDS, type AiFieldSuggestion, type AiSource, type CheckInSuggestions } from "./ai-types";

export * from "./ai-types";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lc = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const OBST_QUOTE: Record<string, string> = {
  "Språk": "Ibland är det svårt att förstå orden i instruktionerna.",
  "Digital vana": "Jag behöver hjälp när jag ska söka jobb på datorn.",
  "Praktiska förutsättningar (t.ex. barnomsorg, resor)": "Det var svårt att hinna lämna barnen och komma i tid.",
  "Behov av anpassning": "Det går bättre när jag får instruktionerna på papper.",
  "Motivation": "Jag var trött i början av veckan och ville inte komma.",
  "Annat": "Det hände en sak hemma som tog mycket tid.",
};
const PHASE_QUOTE: Record<number, string> = {
  1: "Vi fortsätter kartläggningen och pratar om vilket yrke som passar.",
  2: "Vi övar mer på grunderna innan de yrkesspecifika momenten.",
  3: "Vi fortsätter med de yrkesspecifika momenten.",
  4: "Praktiken fortsätter som planerat.",
  5: "Nu fokuserar vi på ansökningar och matchning.",
};
const PHASE_ACTIVITIES: Record<number, number[]> = { 1: [0], 2: [1, 5], 3: [1, 2, 5], 4: [2, 4, 7], 5: [5, 6, 7] };
const actsForPhase = (ph: number): string[] => ACTIVITY_TYPES.filter((_, i) => (PHASE_ACTIVITIES[ph] ?? [0]).includes(i));

/** Förslag från ett samtal (inspelning, ljudfil eller Teams) – byggda på ärendets fas och senaste godkända avstämning. */
function fromConversation(phase: number, last: Pick<CheckIn, "nextGoal" | "obstacles"> | null): CheckInSuggestions {
  const ph = phase || 1;
  const goals = GOALS[ph] ?? GOALS[1];
  const goal = goals.find((g) => !last || g !== last.nextGoal) ?? goals[0];
  const acts = actsForPhase(ph);
  const ec: EmployerContacts = ph >= 4 ? { count: "1", types: ["intervju"] } : ph >= 3 ? { count: "1", types: ["studiebesök"] } : { count: "0", types: [] };
  const obst = last && last.obstacles && last.obstacles.length ? [last.obstacles[0]] : [];
  return {
    attendanceComment: {
      value: "Närvarande måndag, tisdag och torsdag. Onsdag frånvaro med giltigt skäl (möte på kommunen), anmäld i förväg.",
      quote: "Jag var här måndag, tisdag och torsdag. I onsdags hade jag ett möte på kommunen, det sa jag till om i förväg.",
      t: 410,
    },
    goalStatus: { value: "partly", quote: "Jag har gjort det mesta av målet, men en dag hann jag inte.", t: 184 },
    nextGoal: { value: goal, quote: `Nästa vecka ska jag försöka ${lc(goal)}.`, t: 1320 },
    phase: { value: ph, quote: PHASE_QUOTE[ph] ?? "", t: 1485 },
    activitiesDone: { value: acts, quote: `I veckan har vi jobbat med ${acts.map(lc).join(" och ")}.`, t: 96 },
    employerContacts: {
      value: ec,
      quote: ec.count === "0" ? "Jag har inte haft kontakt med någon arbetsgivare den här veckan." : ph >= 4 ? "Jag var på en intervju hos en arbetsgivare i torsdags." : "Vi gjorde ett studiebesök på en arbetsplats i onsdags.",
      t: 742,
    },
    obstacles: { value: obst, quote: obst.length ? OBST_QUOTE[obst[0]] || "Det har varit lite svårt den här veckan." : "Det har inte varit några problem den här veckan.", t: 1034 },
    note: { value: `Har arbetat med ${lc(acts[0])}. Veckomålet nåddes delvis. Nästa steg: ${lc(goal)}.`, quote: "Sammanfattning av samtalet 01:36–24:45", t: 96 },
  };
}

// ---------------------------------------------------------------- Inklistrade anteckningar och transkript
const ACT_KEYWORDS: [string, RegExp][] = [
  ["Kartläggning och individuell planering", /kartlägg|individuell plan/i],
  ["Yrkesförberedande träning", /yrkesförbered|arbetsträn|grundträn/i],
  ["Yrkesspecifika moment", /yrkesspecifik|yrkesmoment|truck|lastsäkr|plockade|ruttplan/i],
  ["Studiebesök och arbetsplatsbesök", /studiebesök|arbetsplatsbesök/i],
  ["Praktik/APL", /\b(på|i) praktik\b|praktiken|praktikdag|\bapl\b/i],
  ["CV och ansökningar", /\bcv\b|cv:t|ansök|sökte (jobb|tjänst)/i],
  ["Intervjuträning", /intervjuträn|övade (på )?intervju/i],
  ["Matchning mot arbetsgivare", /matchning/i],
  ["Vägledning om studier och validering", /vägledning|validering/i],
];
const OBST_KEYWORDS: [string, RegExp][] = [
  ["Språk", /språk|svenskan|förstå orden|förstår inte orden/i],
  ["Digital vana", /dator|digital|bankid|platsbanken/i],
  ["Praktiska förutsättningar (t.ex. barnomsorg, resor)", /barnomsorg|förskola|lämna barnen|buss|pendel|resväg|resor\b/i],
  ["Behov av anpassning", /anpassning|på papper|bildstöd/i],
  ["Motivation", /motivation|orkade inte|ville inte komma|omotiverad/i],
];
const EC_KEYWORDS: [string, RegExp][] = [["intervju", /intervju(?!trän)/i], ["ansökan", /ansök|sökte (jobb|tjänst)/i], ["studiebesök", /studiebesök|arbetsplatsbesök/i], ["praktikkontakt", /praktikplats|praktikkontakt/i]];
/** Meningar som säger något om närvaron: dagar deltagaren var med, frånvaro och skäl, anmält i förväg. */
const ATTENDANCE_RE = /närvar|frånvar|\bsjuk\b|uteblev|kom inte|var inte (här|med)|giltigt skäl|i förväg|(var|varit) (här|med|på plats)/i;
// Meningar delas efter punkt, utrops- eller frågetecken (lookbehind) eller radbrytning.
const SENTENCE_SPLIT = new RegExp("(?<=[.!?])\\s+|\\n+");

/** En mening i underlaget: t = sekunder in i samtalet (null för anteckningar), who = talaren (transkript). */
type Sentence = { text: string; t: number | null; who?: string | null };
/** Hur underlaget beskrivs i "Framgår inte" och i anteckningens belägg. */
type ExtractMode = {
  noEvidence: string;
  noPhase: string;
  /** Meningarna som anteckningen sammanfattar (de två första). */
  noteSentences(all: Sentence[]): Sentence[];
  /** Belägget för anteckningen. */
  summary(used: Sentence[]): { quote: string; t: number | null };
};
const NOTES_MODE: ExtractMode = {
  noEvidence: "Framgår inte av anteckningarna. Fyll i själv.",
  noPhase: "Framgår inte av anteckningarna. Fasen ändras inte.",
  noteSentences: (all) => all,
  summary: () => ({ quote: "Sammanfattning av de inklistrade anteckningarna", t: null }),
};
const TRANSCRIPT_MODE: ExtractMode = {
  noEvidence: "Framgår inte av samtalet. Fyll i själv.",
  noPhase: "Framgår inte av samtalet. Fasen ändras inte.",
  // Deltagarens egna meningar (inte coachens frågor)
  noteSentences: (all) => all.filter((x) => x.who !== "Coach" && !x.text.endsWith("?")),
  summary: (used) => {
    const ts = used.map((x) => x.t).filter((t): t is number => t != null);
    if (!ts.length) return { quote: "Sammanfattning av samtalet", t: null };
    return { quote: `Sammanfattning av samtalet ${mmss(Math.min(...ts))}–${mmss(Math.max(...ts))}`, t: Math.min(...ts) };
  },
};

/** Förslag ur meningarna: bara det som står i underlaget blir ett förslag, med meningen som belägg (SPEC §8.3). */
function extractCheckIn(sentences: Sentence[], mode: ExtractMode): CheckInSuggestions {
  const find = (re: RegExp) => sentences.find((x) => re.test(x.text));
  const ev = <T>(value: T, s: Sentence | undefined): AiFieldSuggestion<T> => ({ value, quote: s?.text ?? "", t: s?.t ?? null });
  const none = <T>(why = mode.noEvidence): AiFieldSuggestion<T> => ({ value: null, quote: why, t: null, noEvidence: true });
  // Kommentar om närvaron: meningarna som nämner närvaro eller frånvaro (högst två, högst 200 tecken som fältet).
  // Bara kommentarstexten – närvarostatusen registreras i Närvaro, aldrig av AI.
  const attSentences = sentences.filter((x) => ATTENDANCE_RE.test(x.text)).slice(0, 2);
  const attendanceComment: AiFieldSuggestion<string> = attSentences.length
    ? ev(cap(attSentences.map((x) => x.text).join(" ")).slice(0, 200), attSentences[0])
    : none<string>();
  const absentAll = find(/sjuk (i )?hela veckan|frånvarande hela veckan|deltog inte i något|deltog inte alls|var inte här (alls|på hela veckan)/i);
  // Veckomål
  const gNo = absentAll || find(/(nådde|klarade|uppnådde) inte (vecko)?målet|(vecko)?målet (nåddes|uppnåddes) inte|inte (nått|klarat) (vecko)?målet/i);
  const gPartly = find(/delvis|nästan hela (vecko)?målet|en del av (vecko)?målet/i);
  const gYes = find(/(nådde|klarade|uppnådde) (vecko)?målet|(vecko)?målet (är |var )?(nått|uppnått|klart)|(vecko)?målet (nåddes|uppnåddes)(?! inte)/i);
  const goalStatus: AiFieldSuggestion<GoalStatus> = gNo ? ev<GoalStatus>("no", gNo) : gPartly ? ev<GoalStatus>("partly", gPartly) : gYes ? ev<GoalStatus>("yes", gYes) : none();
  // Nytt veckomål
  const ng = find(/nästa vecka|nytt (vecko)?mål|veckomål(et)? (för|till) nästa/i);
  const nextGoal = ng ? ev(cap(ng.text.replace(/^(nytt (vecko)?mål|veckomål|mål)\s*:\s*/i, "").replace(/[.!]$/, "")).slice(0, 140), ng) : none<string>();
  // Fas
  const ph = find(/\bfas\s*[1-5]\b/i);
  const phaseNo = ph ? Number((ph.text.match(/\bfas\s*([1-5])\b/i) as RegExpMatchArray)[1]) : null;
  const phase = ph && phaseNo ? ev(phaseNo, ph) : none<number>(mode.noPhase);
  // Genomförda aktiviteter
  const acts = ACT_KEYWORDS.filter(([, re]) => sentences.some((x) => re.test(x.text))).map(([a]) => a);
  const firstActRe = acts.length ? (ACT_KEYWORDS.find(([a]) => a === acts[0]) as [string, RegExp])[1] : null;
  const activitiesDone = acts.length && firstActRe ? ev(acts, find(firstActRe)) : absentAll ? ev<string[]>([], absentAll) : none<string[]>();
  // Arbetsgivarkontakter
  const ecZero = find(/ingen arbetsgivarkontakt|inga arbetsgivarkontakter|ingen kontakt med (någon )?arbetsgivare|inte haft kontakt med (någon )?arbetsgivare/i);
  const ecTypes = EC_KEYWORDS.filter(([, re]) => sentences.some((x) => re.test(x.text))).map(([t]) => t);
  const ecQuote = ecTypes.length ? find((EC_KEYWORDS.find(([t]) => t === ecTypes[0]) as [string, RegExp])[1]) : undefined;
  const employerContacts: AiFieldSuggestion<EmployerContacts> = ecZero
    ? ev<EmployerContacts>({ count: "0", types: [] }, ecZero)
    : ecTypes.length
      ? ev<EmployerContacts>({ count: ecTypes.length > 1 || /\b(två|tre|fyra|fem|[2-9])\b/i.test(ecQuote?.text ?? "") ? "2+" : "1", types: ecTypes }, ecQuote)
      : absentAll ? ev<EmployerContacts>({ count: "0", types: [] }, absentAll) : none();
  // Hinder
  const obst = OBST_KEYWORDS.filter(([, re]) => sentences.some((x) => re.test(x.text))).map(([o]) => o);
  const noObst = find(/inga hinder|inget hindrar|inga problem/i);
  const firstObstRe = obst.length ? (OBST_KEYWORDS.find(([o]) => o === obst[0]) as [string, RegExp])[1] : null;
  const obstacles = obst.length && firstObstRe ? ev(obst, find(firstObstRe)) : noObst ? ev<string[]>([], noObst) : none<string[]>();
  // Anteckning: kort sammanfattning av de två första meningarna
  const used = mode.noteSentences(sentences).slice(0, 2);
  const note: AiFieldSuggestion<string> = used.length
    ? { value: used.map((x) => x.text).join(" ").slice(0, 500), ...mode.summary(used) }
    : none<string>();
  return { attendanceComment, goalStatus, nextGoal, phase, activitiesDone, employerContacts, obstacles, note };
}

const splitSentences = (text: string): string[] => String(text || "").split(SENTENCE_SPLIT).map((x) => x.trim()).filter((x) => x.length > 3);

/** Tolkning av inklistrade anteckningar. */
function fromNotes(text: string): CheckInSuggestions {
  return extractCheckIn(splitSentences(text).map((x) => ({ text: x, t: null })), NOTES_MODE);
}

/** Simulerade förslag till veckoavstämningen. */
export function simulateCheckInSuggestions(input: {
  source: AiSource;
  /** Ärendets fas nu. */
  phase: number;
  /** Senaste godkända avstämningen (veckomål och hinder), eller null. */
  lastApproved: Pick<CheckIn, "nextGoal" | "obstacles"> | null;
  notesText?: string;
}): CheckInSuggestions {
  if (input.source === "notes") return fromNotes(input.notesText ?? "");
  return fromConversation(input.phase, input.lastApproved);
}

/** Transkriptet som visas bredvid förslagen: citaten i tidsordning. Tomt för anteckningar. */
export function simulatedTranscript(s: CheckInSuggestions, source: AiSource): TranscriptLine[] {
  if (source === "notes") return [];
  const lines: TranscriptLine[] = [];
  for (const f of AI_FIELDS) {
    const x = s[f];
    if (x.t != null) lines.push({ t: x.t, who: "Deltagare", text: x.quote });
  }
  return lines.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

// ================================================================ Simulerad leverantör för ctx.ai (ai-port.ts)
export const SIMULATED_PROVIDER = "simulated";
export const SIMULATED_MODEL = "simulerad";

/** FNV-1a (32 bitar): väljer variant ur ljudets id – samma id ger alltid samma transkript. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const variantOf = (key: string, n: number): number => hash32(key) % n;
const tokensOf = (text: string): number => Math.ceil(text.length / 4);
/** Ljud räknas som 32 token per sekund (SPEC §8.6). */
const AUDIO_TOKENS_PER_SECOND = 32;
/** Uppskattad kostnad för ljud: ≈ 1,70 kr per 30 minuter (SPEC §8.6, ordinarie pris från 2027). Minst 1 öre. */
const audioCostOre = (sec: number): number => Math.max(1, Math.round((sec * 170) / 1800));
const isVoiceLanguage = (l: string): l is VoiceLanguage => (VOICE_LANGUAGES as readonly string[]).includes(l);

/** Meningarna som segment med tider: jämnt fördelade efter textens längd över total sekunder. */
function spread(sentences: readonly { text: string; who?: string | null }[], total: number): TranscriptSegment[] {
  const chars = sentences.reduce((n, x) => n + x.text.length, 0) || 1;
  let at = 0;
  return sentences.map((x) => {
    const len = Math.max(1, Math.round((total * x.text.length) / chars));
    // Kort ljud (1–2 sekunder) och många meningar: start kan passera total – segmentet slutar aldrig före det börjar.
    const seg: TranscriptSegment = { start: at, end: Math.max(at, Math.min(total, at + len)), text: x.text, speaker: x.who ?? null };
    at += len;
    return seg;
  });
}

/** Påhittat transkript för ljudet (deterministiskt ur ljudets id, syfte, längd och språk). */
export function simulatedAudioTranscript(audio: AudioInput, language: string): Transcript {
  if (audio.purpose === "checkin") {
    const conv = CHECK_IN_CONVERSATIONS[variantOf(audio.uploadId, CHECK_IN_CONVERSATIONS.length)];
    const total = audio.durationSec && audio.durationSec > 0 ? audio.durationSec : CHECK_IN_CONVERSATION_SECONDS;
    const scale = total / CHECK_IN_CONVERSATION_SECONDS;
    const segments = conv.map((l, i): TranscriptSegment => {
      const start = Math.round(l.t * scale);
      const next = i + 1 < conv.length ? Math.round(conv[i + 1].t * scale) : total;
      return { start, end: Math.max(start, next - 1), text: l.text, speaker: l.who };
    });
    return { text: conv.map((l) => l.text).join(" "), segments, language: "sv" };
  }
  if (audio.purpose === "dictation") {
    const d = DICTATIONS[variantOf(audio.uploadId, DICTATIONS.length)];
    return { text: d.join(" "), segments: spread(d.map((text) => ({ text })), audio.durationSec && audio.durationSec > 0 ? audio.durationSec : 20), language: "sv" };
  }
  const lang: VoiceLanguage = isVoiceLanguage(language) ? language : "sv";
  const msg = PARTICIPANT_MESSAGES[variantOf(audio.uploadId, PARTICIPANT_MESSAGES.length)][lang];
  return { text: msg.join(" "), segments: spread(msg.map((text) => ({ text, who: "Deltagare" })), audio.durationSec && audio.durationSec > 0 ? audio.durationSec : 45), language: lang };
}

/** Förslag till veckoavstämningen ur ett transkript: meningarna med tidpunkter som belägg. */
export function checkInSuggestionsFromTranscript(t: Transcript): CheckInSuggestions {
  const sentences: Sentence[] = t.segments.length
    ? t.segments.flatMap((seg) => splitSentences(seg.text).map((text) => ({ text, t: Math.round(seg.start), who: seg.speaker ?? null })))
    : splitSentences(t.text).map((text) => ({ text, t: null }));
  return extractCheckIn(sentences, TRANSCRIPT_MODE);
}

// ---------------------------------------------------------------- Utkast från godkända uppgifter (prototypens evidenceDraft)
/** Första meningen (högst 160 tecken) – den simulerade AI:n citerar, den hittar aldrig på. */
const firstSentence = (t: string): string => {
  const s = t.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return s.length > 160 ? `${s.slice(0, 157).trimEnd()}…` : s;
};
const byHeldAt = (a: ApprovedCheckIn, b: ApprovedCheckIn) => (a.heldAt < b.heldAt ? -1 : a.heldAt > b.heldAt ? 1 : 0);
const srcLabel = (ci: Pick<ApprovedCheckIn, "heldAt">) => `Avstämning ${fmtDateShort(ci.heldAt)}`;
const weeksText = (n: number) => (n === 1 ? "en vecka" : `${n} veckor`);
const NOT_FOUND: DraftText = { text: "Framgår inte av månadens godkända avstämningar.", sources: [], sourceIds: [], noEvidence: true };

/**
 * Utkast till observation, sammanfattning eller plan – samma texter som testdatats AI-utkast (src/data/seed/gen-reports.ts,
 * prototypens evidenceDraft). Bara från godkända avstämningar och registrerad närvaro; saknas underlag: "Framgår inte".
 * Sammanfattningen citerar dessutom de två senaste anteckningarna (med samtycke, personnummer tvättade – beslut 4
 * 2026-10-09) med "Anteckning <datum>" som källa. Utan anteckningar är texterna exakt testdatats.
 */
export function simulatedDraft(input: DraftInput, templateKey: DraftTemplateKey): DraftText {
  assertApprovedInput(input);
  const cis = [...input.checkIns].sort(byHeldAt);
  const att = input.attendance;
  const notes = [...input.notes].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const attended = att.filter((x) => x.status === "present" || x.status === "late").length;
  const late = att.filter((x) => x.status === "late").length;
  const invalid = att.filter((x) => x.status === "absent_invalid").length;
  const hasContact = (x: ApprovedCheckIn) => !!(x.employerContacts && x.employerContacts.count && x.employerContacts.count !== "0");
  const contacts = cis.filter(hasContact);
  const goalsMet = cis.filter((x) => x.goalStatus === "yes" || x.goalStatus === "partly");
  const withAct = (t: string) => cis.filter((x) => (x.activitiesDone || []).includes(t));
  const from = (text: string, used: ApprovedCheckIn[], extra: string[] = [], noEvidence = false): DraftText => ({
    text, sources: [...extra, ...used.map(srcLabel)], sourceIds: used.map((x) => x.id), noEvidence,
  });

  if (templateKey === "monthly_summary") {
    // Coachernas anteckningar (beslut 4 2026-10-09): de två senaste, första meningen ordagrant, med datum som källa.
    const used = notes.slice(-2);
    const fromNotes = used.map((n) => `${fmtDateShort(n.date)}: ${firstSentence(n.text)}`).join(" ");
    const withNotes = (d: DraftText): DraftText =>
      used.length ? { ...d, text: `${d.text} Ur anteckningarna – ${fromNotes}`, sources: [...d.sources, ...used.map(noteSourceLabel)], sourceIds: [...d.sourceIds, ...used.map((n) => n.id)] } : d;
    if (!cis.length) {
      if (!used.length) return { ...NOT_FOUND, text: "Framgår inte – det finns inga godkända avstämningar för månaden." };
      return withNotes({ text: "Det finns inga godkända avstämningar för månaden.", sources: [], sourceIds: [], noEvidence: false });
    }
    const m = MONTHS[Number(input.month.slice(5)) - 1];
    const text = `Under ${m} deltog deltagaren i ${attended} av ${att.length} registrerade tillfällen. ${contacts.length ? `Arbetsgivarkontakter fanns ${weeksText(contacts.length)}.` : "Inga arbetsgivarkontakter framgår."} (Källa: ${cis.length} godkända avstämningar, ${cis.map((x) => fmtDateShort(x.heldAt)).join(", ")}.)`;
    return withNotes(from(text, cis));
  }
  if (templateKey === "monthly_plan") {
    const last = cis[cis.length - 1];
    if (!last) return { ...NOT_FOUND, text: "Framgår inte – det finns inga godkända avstämningar för månaden." };
    const parts: string[] = [];
    if (last.nextGoal) parts.push(`Mål: ${last.nextGoal.replace(/[.!]$/, "")}.`);
    if (last.activitiesDone.length) parts.push(`Fortsatta aktiviteter: ${last.activitiesDone.map(lc).join(", ")}.`);
    if (last.obstacles.length) parts.push(`Hinder att arbeta vidare med: ${last.obstacles.map(lc).join(", ")}.`);
    return parts.length ? from(parts.join(" "), [last]) : { ...from("Framgår inte av den senaste godkända avstämningen.", [last]), noEvidence: true };
  }
  const key = templateKey.slice("monthly_area:".length);
  if (key === "narvaro_rutiner") {
    if (!att.length) return NOT_FOUND;
    const text = `Närvarande vid ${attended} av ${att.length} registrerade tillfällen${late ? `, varav ${late} med sen ankomst` : ""}.${invalid ? ` ${invalid} ogiltig frånvaro.` : " Ingen ogiltig frånvaro."}`;
    return from(text, cis.slice(-1), ["Närvaroregistrering"]);
  }
  if (key === "arbetsgivarkontakter") {
    if (!contacts.length) return from("Ingen arbetsgivarkontakt framgår av avstämningarna.", cis, [], true);
    return from(`Arbetsgivarkontakt registrerad ${weeksText(contacts.length)} (${uniq(cis.flatMap((x) => (x.employerContacts && x.employerContacts.types) || [])).join(", ")}).`, contacts);
  }
  if (key === "yrkesfardigheter" && withAct("Yrkesspecifika moment").length) {
    const used = withAct("Yrkesspecifika moment");
    return from(`Yrkesspecifika moment genomförda ${used.length} av ${cis.length} veckor.`, used);
  }
  if (key === "beredskap" && withAct("Praktik/APL").length) {
    const used = withAct("Praktik/APL");
    return from(`Har genomfört praktik ${weeksText(used.length)} under månaden.`, used);
  }
  if (key === "sjalvstandighet" && cis.length) return from(`Veckomålet uppnått helt eller delvis ${goalsMet.length} av ${cis.length} veckor.`, cis);
  if (key === "digital_sjalvstandighet" && withAct("CV och ansökningar").length) {
    const used = withAct("CV och ansökningar");
    return from(`Har arbetat med CV och ansökningar ${weeksText(used.length)}.`, used);
  }
  return NOT_FOUND;
}

// ---------------------------------------------------------------- Översättning (deltagarens röstmeddelanden)
const SENTENCE_END = /(?<=[.!?؟])\s+/;
/** Översättning ur testdatats parallella texter; okända meningar lämnas som de är och märks. */
export function simulatedTranslation(text: string, from: string, to: string): string {
  const src = text.trim();
  if (from === to || !src) return src;
  if (isVoiceLanguage(from) && isVoiceLanguage(to)) {
    for (const msg of PARTICIPANT_MESSAGES) if (msg[from].join(" ") === src) return msg[to].join(" ");
    let unknown = false;
    const out = src.split(SENTENCE_END).map((sentence) => {
      for (const msg of PARTICIPANT_MESSAGES) {
        const i = msg[from].indexOf(sentence);
        if (i >= 0) return msg[to][i];
      }
      unknown = true;
      return sentence;
    });
    if (!unknown) return out.join(" ");
    return `(Simulerad översättning från ${LANGUAGE_NAME_SV[from] ?? from}) ${out.join(" ")}`;
  }
  return `(Simulerad översättning från ${LANGUAGE_NAME_SV[from] ?? from}) ${src}`;
}

/**
 * Simulerad AI för ctx.ai: minnesläget, prototypen och testmiljön (MM_AI_PROVIDER=simulated). Samma form på svaren som den
 * riktiga leverantören, och svaren valideras mot samma zod-scheman (EXTRACT_SCHEMAS, DraftTextSchema) i testerna.
 * Mätvärdena (tid, token, kostnad) är uppskattningar så att ai_runs och uppföljningen går att testa.
 */
export function createSimulatedAi(opts: { provider?: string; model?: string } = {}): AiPort {
  const provider = opts.provider ?? SIMULATED_PROVIDER;
  const model = opts.model ?? SIMULATED_MODEL;
  const runOf = (m: Omit<AiRunMeta, "provider" | "model">): AiRunMeta => ({ provider, model, ...m });
  const textRun = (inText: string, outText: string): AiRunMeta =>
    runOf({ latencyMs: 400 + 2 * tokensOf(inText + outText), tokensIn: tokensOf(inText), tokensOut: tokensOf(outText), audioSeconds: null, costOre: 1 });
  return {
    provider,
    model,
    async transcribe(audio: AudioInput, o: { language: string }): Promise<AiResult<Transcript>> {
      const value = simulatedAudioTranscript(audio, o.language);
      const sec = audio.durationSec && audio.durationSec > 0 ? audio.durationSec : Math.max(0, ...value.segments.map((s) => s.end));
      return { value, run: runOf({ latencyMs: 800 + 20 * sec, tokensIn: sec * AUDIO_TOKENS_PER_SECOND, tokensOut: tokensOf(value.text), audioSeconds: sec, costOre: audioCostOre(sec) }) };
    },
    async extract<K extends ExtractSchemaKey>(t: Transcript, schemaKey: K): Promise<AiResult<ExtractSchemas[K]>> {
      if (schemaKey !== "check_in") throw new Error(`Okänt formulär för extract: ${String(schemaKey)}`);
      const value = checkInSuggestionsFromTranscript(t) as ExtractSchemas[K];
      return { value, run: textRun(t.text, JSON.stringify(value)) };
    },
    async draft(input: DraftInput, templateKey: DraftTemplateKey): Promise<AiResult<DraftText>> {
      const value = simulatedDraft(input, templateKey);
      return { value, run: textRun(JSON.stringify([input.checkIns, input.notes]), value.text) };
    },
    async translate(text: string, from: string, to: string): Promise<AiResult<Translation>> {
      const out = simulatedTranslation(text, from, to);
      return { value: { text: out, from, to }, run: textRun(text, out) };
    },
  };
}
