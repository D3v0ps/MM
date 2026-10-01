// Instruktioner och svarsscheman till Gemini (Vertex AI). Svaren valideras ALLTID efteråt mot appens zod-scheman
// (src/features/_shared/ai-port.ts) – schemat här styr bara modellens utdata (OpenAPI-delmängden i Vertex AI:s responseSchema).
// Kärnan i instruktionerna är SPEC §8.3 (AI_CORE_INSTRUCTIONS, EXTRACT_INSTRUCTIONS): dokumentationsstöd, inga beslut, inga
// diagnoser, belägg = citat + tidpunkt, "Framgår inte" när belägg saknas. AI föreslår aldrig nivå, samlad status,
// avslutsorsak eller resultat – de fälten finns inte i något schema.
import { ACTIVITY_TYPES, OBSTACLES } from "@/data/seed/constants";
import { EMPLOYER_CONTACT_COUNTS, GOAL_STATUSES } from "@/data/schema";
import { AI_CORE_INSTRUCTIONS, EXTRACT_INSTRUCTIONS, type DraftInput, type DraftTemplateKey, type Transcript } from "@/features/_shared/ai-port";
import type { AudioPurpose } from "@/features/_shared/audio-port";
import { fmtDateShort } from "@/core/time";

/** Typer av arbetsgivarkontakt i veckoavstämningen (samma som formuläret, src/features/coach/screens/avstamning.tsx). */
export const EMPLOYER_CONTACT_TYPES = ["ansökan", "intervju", "praktikkontakt", "studiebesök"] as const;

/** Språknamn i instruktionerna (deltagarens språk). Okänt språk: koden. */
const LANGUAGE_NAMES: Record<string, string> = { sv: "svenska", en: "engelska", ar: "arabiska", so: "somaliska", fi: "finska", fa: "persiska", ti: "tigrinska", tr: "turkiska", uk: "ukrainska", pl: "polska" };
export const languageName = (code: string): string => LANGUAGE_NAMES[code] ?? code;

// ---------------------------------------------------------------- Svarsscheman (Vertex AI: OpenAPI-delmängd)
export type ResponseSchema = { type: "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY" | "OBJECT"; [k: string]: unknown };
const str = (extra: Record<string, unknown> = {}): ResponseSchema => ({ type: "STRING", ...extra });
const num = (extra: Record<string, unknown> = {}): ResponseSchema => ({ type: "NUMBER", ...extra });
const bool = (): ResponseSchema => ({ type: "BOOLEAN" });
const arr = (items: ResponseSchema, extra: Record<string, unknown> = {}): ResponseSchema => ({ type: "ARRAY", items, ...extra });
const obj = (properties: Record<string, ResponseSchema>, extra: Record<string, unknown> = {}): ResponseSchema => ({
  type: "OBJECT",
  properties,
  required: Object.keys(properties),
  propertyOrdering: Object.keys(properties),
  ...extra,
});

/** Transkriptet: språket och segmenten. Hela texten byggs av segmenten (halverar antalet utdatatoken). */
export const TRANSCRIPT_RESPONSE_SCHEMA = obj({
  language: str({ description: "Språket som talades, ISO 639-1 (två små bokstäver)" }),
  segments: arr(
    obj({
      start: num({ description: "Start i sekunder från inspelningens början" }),
      end: num({ description: "Slut i sekunder" }),
      speaker: str({ nullable: true, description: "Talaren om den går att avgöra, annars null" }),
      text: str({ description: "Det som sades, ordagrant" }),
    }),
  ),
});

const evidence = (value: ResponseSchema): ResponseSchema =>
  obj({
    value: { ...value, nullable: true },
    quote: str({ description: "Kort ordagrant citat ur transkriptet, eller \"Framgår inte\"" }),
    t: num({ nullable: true, description: "Citatets starttid i sekunder, null om belägg saknas" }),
    noEvidence: bool(),
  });

/** Veckoavstämningen (samma fält som CheckInExtractSchema – ingen samlad status). */
export const CHECK_IN_RESPONSE_SCHEMA = obj({
  goalStatus: evidence(str({ enum: [...GOAL_STATUSES] })),
  nextGoal: evidence(str()),
  phase: evidence({ type: "INTEGER" }),
  activitiesDone: evidence(arr(str({ enum: [...ACTIVITY_TYPES] }))),
  employerContacts: evidence(obj({ count: str({ enum: [...EMPLOYER_CONTACT_COUNTS], nullable: true }), types: arr(str({ enum: [...EMPLOYER_CONTACT_TYPES] })) })),
  obstacles: evidence(arr(str({ enum: [...OBSTACLES] }))),
  note: evidence(str()),
});

/** Utkastet: texten, vilka avstämningar den bygger på och om närvaron användes. Källornas namn sätter appen själv. */
export const DRAFT_RESPONSE_SCHEMA = obj({
  text: str(),
  sourceIds: arr(str(), { description: "Id för de godkända avstämningar som texten bygger på" }),
  usedAttendance: bool(),
  noEvidence: bool(),
});

export const TRANSLATION_RESPONSE_SCHEMA = obj({ text: str() });

// ---------------------------------------------------------------- Instruktioner
const SPEAKERS: Record<AudioPurpose, string> = {
  checkin: "Det är ett samtal mellan en jobbcoach och en deltagare. Ange talaren som \"Coach\" eller \"Deltagare\" när det går att avgöra, annars null.",
  dictation: "En handläggare talar in en text. Ange talaren som null.",
  participant: "Det är deltagaren som talar. Ange talaren som \"Deltagare\".",
};

export function transcribeInstructions(purpose: AudioPurpose, language: string): string {
  return [
    "Du transkriberar ljud åt ett dokumentationsstöd. Du fattar inga beslut och bedömer inte personen.",
    `Transkribera ljudet ordagrant på det språk som talas (förväntat språk: ${languageName(language)}). Översätt inte.`,
    "Dela upp i segment: ett segment per yttrande eller mening, med start och slut i sekunder från inspelningens början.",
    SPEAKERS[purpose],
    "Skriv bara det som faktiskt sägs. Lägg inte till, sammanfatta eller rätta något. Det som inte går att höra skrivs [ohörbart].",
    "Ange språket som talades som ISO 639-1-kod (två små bokstäver).",
    "Svara endast med JSON enligt schemat.",
  ].join("\n");
}

const list = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join(", ");

/** Instruktionerna för veckoavstämningen: SPEC §8.3 (EXTRACT_INSTRUCTIONS) + fältens regler och tillåtna värden. */
export function checkInExtractInstructions(base: string = EXTRACT_INSTRUCTIONS.check_in): string {
  return [
    base,
    "",
    "Regler för svaret:",
    "- Varje fält har value, quote, t och noEvidence.",
    "- quote är ett kort ordagrant citat ur transkriptet (högst 200 tecken). t är citatets starttid i sekunder (talet inom hakparentes före raden).",
    "- Finns inget belägg i samtalet: value null, quote \"Framgår inte\", t null och noEvidence true. Gissa aldrig.",
    `- goalStatus: ${list(GOAL_STATUSES)} (veckomålet nåddes, nåddes delvis, nåddes inte).`,
    "- nextGoal: nästa veckas mål med deltagarens egna ord, kort.",
    "- phase: bara om en fas (siffra) nämns uttryckligen.",
    `- activitiesDone: bara värden ur listan ${list(ACTIVITY_TYPES)}.`,
    `- employerContacts: count ${list(EMPLOYER_CONTACT_COUNTS)} och types ur listan ${list(EMPLOYER_CONTACT_TYPES)}.`,
    `- obstacles: bara värden ur listan ${list(OBSTACLES)}. Hälsa beskrivs aldrig som diagnos.`,
    "- note: en kort saklig anteckning om veckan (högst tre meningar). quote är det citat anteckningen främst bygger på.",
  ].join("\n");
}

/** Transkriptet som text till extract: "[96] Deltagare: …" (sekunder, talare). */
export function transcriptForPrompt(t: Transcript): string {
  if (!t.segments.length) return t.text;
  return t.segments.map((s) => `[${Math.round(s.start)}] ${s.speaker ? `${s.speaker}: ` : ""}${s.text}`).join("\n");
}

/** "narvaro_rutiner" -> "narvaro rutiner" (områdets nyckel i avtalskonfigurationen). */
const areaName = (key: string) => key.replace(/_/g, " ");

export function draftInstructions(templateKey: DraftTemplateKey): string {
  const task =
    templateKey === "monthly_summary"
      ? "Skriv en sammanfattning av månaden (två till fyra meningar): deltagande, genomförda aktiviteter, arbetsgivarkontakter och hur veckomålen gått."
      : templateKey === "monthly_plan"
        ? "Skriv en plan för nästa månad (en till tre meningar) utifrån den senaste godkända avstämningens mål, aktiviteter och hinder."
        : `Skriv en kort, konkret observation (en till tre meningar) för progressionsområdet "${areaName(templateKey.slice("monthly_area:".length))}". Beskriv bara det som framgår av underlaget.`;
  return [
    AI_CORE_INSTRUCTIONS,
    "",
    "Du skriver ett utkast till coachens månadsbedömning. Coachen läser, ändrar och godkänner. Underlaget är bara godkända avstämningar och registrerad närvaro.",
    "Sätt aldrig nivå, samlad status, avslutsorsak eller resultat, och skriv inga omdömen om personen.",
    task,
    "sourceIds: id för de avstämningar som texten bygger på (bara id som finns i underlaget). usedAttendance: true om texten bygger på närvaron.",
    "Räcker underlaget inte: noEvidence true, text \"Framgår inte\", sourceIds tom lista och usedAttendance false.",
  ].join("\n");
}

/** Underlaget till draft som JSON-text: bara godkända uppgifter, inga namn. */
export function draftInputForPrompt(input: DraftInput): string {
  const att = input.attendance;
  const count = (...s: string[]) => att.filter((x) => s.includes(x.status)).length;
  return JSON.stringify({
    manad: input.month,
    avstamningar: input.checkIns.map((c) => ({
      id: c.id,
      datum: fmtDateShort(c.heldAt),
      veckomal: c.goalStatus,
      nastaMal: c.nextGoal,
      fas: c.phase,
      aktiviteter: c.activitiesDone,
      arbetsgivarkontakter: c.employerContacts,
      hinder: c.obstacles,
      anteckning: c.note,
    })),
    narvaro: { registreradeTillfallen: att.length, narvarande: count("present", "late"), senAnkomst: count("late"), giltigFranvaro: count("absent_valid"), ogiltigFranvaro: count("absent_invalid") },
  });
}

export function translateInstructions(from: string, to: string): string {
  return [
    `Du översätter en deltagares röstmeddelande från ${languageName(from)} till ${languageName(to)} åt en jobbcoach.`,
    "Översätt troget och fullständigt. Behåll betydelsen, lägg inte till, ta inte bort och tolka inte. Namn, siffror och datum oförändrade.",
    "Svara endast med JSON enligt schemat.",
  ].join("\n");
}
