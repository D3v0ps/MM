// SIMULERAD AI för veckoavstämningen (prototypens makeSuggestions och parseNotes i prototyp/src/views/coach.js).
// Används av kommandot coach.aiRun tills AI-adaptern (lib/ai, SPEC §8) är godkänd och byggd. Då ersätts bara den här
// modulen – kommandot, förslagens form och coachens beslut per fält är desamma.
//
// AI föreslår – människan bedömer (CLAUDE.md punkt 5): samlad status föreslås aldrig. Varje förslag har belägg
// (citat + tidpunkt i sekunder). Det som inte framgår av underlaget blir "Framgår inte" utan förslag (noEvidence).
import { ACTIVITY_TYPES, GOALS } from "@/data/seed/constants";
import type { CheckIn, EmployerContacts, GoalStatus, TranscriptLine } from "@/data/schema";
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

// ---------------------------------------------------------------- Inklistrade anteckningar
const NO_EVIDENCE = <T>(why = "Framgår inte av anteckningarna. Fyll i själv."): AiFieldSuggestion<T> => ({ value: null, quote: why, t: null, noEvidence: true });
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
// Meningar delas efter punkt, utrops- eller frågetecken (lookbehind) eller radbrytning.
const SENTENCE_SPLIT = new RegExp("(?<=[.!?])\\s+|\\n+");

/** Tolkning av inklistrade anteckningar: bara det som står i texten blir ett förslag, med meningen som belägg (SPEC §8.3). */
function fromNotes(text: string): CheckInSuggestions {
  const sentences = String(text || "").split(SENTENCE_SPLIT).map((x) => x.trim()).filter((x) => x.length > 3);
  const find = (re: RegExp) => sentences.find((x) => re.test(x));
  const ev = <T>(value: T, quote: string | undefined): AiFieldSuggestion<T> => ({ value, quote: quote ?? "", t: null });
  const absentAll = find(/sjuk (i )?hela veckan|frånvarande hela veckan|deltog inte i något|deltog inte alls|var inte här (alls|på hela veckan)/i);
  // Veckomål
  const gNo = absentAll || find(/(nådde|klarade|uppnådde) inte (vecko)?målet|(vecko)?målet (nåddes|uppnåddes) inte|inte (nått|klarat) (vecko)?målet/i);
  const gPartly = find(/delvis|nästan hela (vecko)?målet|en del av (vecko)?målet/i);
  const gYes = find(/(nådde|klarade|uppnådde) (vecko)?målet|(vecko)?målet (är |var )?(nått|uppnått|klart)|(vecko)?målet (nåddes|uppnåddes)(?! inte)/i);
  const goalStatus: AiFieldSuggestion<GoalStatus> = gNo ? ev<GoalStatus>("no", gNo) : gPartly ? ev<GoalStatus>("partly", gPartly) : gYes ? ev<GoalStatus>("yes", gYes) : NO_EVIDENCE();
  // Nytt veckomål
  const ng = find(/nästa vecka|nytt (vecko)?mål|veckomål(et)? (för|till) nästa/i);
  const nextGoal = ng ? ev(cap(ng.replace(/^(nytt (vecko)?mål|veckomål|mål)\s*:\s*/i, "").replace(/[.!]$/, "")).slice(0, 140), ng) : NO_EVIDENCE<string>();
  // Fas
  const ph = find(/\bfas\s*[1-5]\b/i);
  const phaseNo = ph ? Number((ph.match(/\bfas\s*([1-5])\b/i) as RegExpMatchArray)[1]) : null;
  const phase = ph && phaseNo ? ev(phaseNo, ph) : NO_EVIDENCE<number>("Framgår inte av anteckningarna. Fasen ändras inte.");
  // Genomförda aktiviteter
  const acts = ACT_KEYWORDS.filter(([, re]) => sentences.some((x) => re.test(x))).map(([a]) => a);
  const firstActRe = acts.length ? (ACT_KEYWORDS.find(([a]) => a === acts[0]) as [string, RegExp])[1] : null;
  const activitiesDone = acts.length && firstActRe ? ev(acts, find(firstActRe)) : absentAll ? ev<string[]>([], absentAll) : NO_EVIDENCE<string[]>();
  // Arbetsgivarkontakter
  const ecZero = find(/ingen arbetsgivarkontakt|inga arbetsgivarkontakter|ingen kontakt med (någon )?arbetsgivare|inte haft kontakt med (någon )?arbetsgivare/i);
  const ecTypes = EC_KEYWORDS.filter(([, re]) => sentences.some((x) => re.test(x))).map(([t]) => t);
  const ecQuote = ecTypes.length ? find((EC_KEYWORDS.find(([t]) => t === ecTypes[0]) as [string, RegExp])[1]) : undefined;
  const employerContacts: AiFieldSuggestion<EmployerContacts> = ecZero
    ? ev<EmployerContacts>({ count: "0", types: [] }, ecZero)
    : ecTypes.length
      ? ev<EmployerContacts>({ count: ecTypes.length > 1 || /\b(två|tre|fyra|fem|[2-9])\b/i.test(ecQuote ?? "") ? "2+" : "1", types: ecTypes }, ecQuote)
      : absentAll ? ev<EmployerContacts>({ count: "0", types: [] }, absentAll) : NO_EVIDENCE();
  // Hinder
  const obst = OBST_KEYWORDS.filter(([, re]) => sentences.some((x) => re.test(x))).map(([o]) => o);
  const noObst = find(/inga hinder|inget hindrar|inga problem/i);
  const firstObstRe = obst.length ? (OBST_KEYWORDS.find(([o]) => o === obst[0]) as [string, RegExp])[1] : null;
  const obstacles = obst.length && firstObstRe ? ev(obst, find(firstObstRe)) : noObst ? ev<string[]>([], noObst) : NO_EVIDENCE<string[]>();
  // Anteckning: kort sammanfattning av de två första meningarna
  const note = sentences.length ? ev(sentences.slice(0, 2).join(" ").slice(0, 500), "Sammanfattning av de inklistrade anteckningarna") : NO_EVIDENCE<string>();
  return { goalStatus, nextGoal, phase, activitiesDone, employerContacts, obstacles, note };
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
  return lines.sort((a, b) => a.t - b.t);
}
