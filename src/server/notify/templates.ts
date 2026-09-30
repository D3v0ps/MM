// Mallarnas namn och ämnesrader – samma som prototypens mallkatalog (prototyp/src/views/admin.js, TEMPLATES).
// Själva texten kommer alltid från hanteraren (ctx.notify). Mallen ramar bara in den och sätter ämnesraden.
// Ämnesraden innehåller högst ärendenumret – aldrig namn, personnummer eller andra personuppgifter (CLAUDE.md punkt 9).

export type TemplateInfo = {
  /** Namnet i adminvyn (prototypens mallkatalog). */
  name: string;
  /** Ämnesrad. {arendenummer} ersätts med ärendenumret. Saknas ärendet används FALLBACK_SUBJECT. */
  subject: string;
  /** Vem mejlet är skrivet för. Deltagaren får ingen länk; för övriga avgör mottagarens domän länken (render.ts). */
  audience: "kommun" | "mb" | "deltagare";
};

const T = (name: string, subject: string, audience: TemplateInfo["audience"]): TemplateInfo => ({ name, subject, audience });

/** Mallarna som skickas som e-post. SMS-mallarna (mötespåminnelse, pulslänk) har ingen ämnesrad. */
export const TEMPLATES: Readonly<Record<string, TemplateInfo>> = {
  ordererkannande: T("Ordererkännande", "Vi har tagit emot er beställning – {arendenummer}", "kommun"),
  generisk_mottagningsbekraftelse: T("Generisk mottagningsbekräftelse", "Vi har tagit emot ditt mejl", "kommun"),
  orderbekraftelse: T("Orderbekräftelse", "Orderbekräftelse – {arendenummer}", "kommun"),
  ny_rapport: T("Ny rapport", "Ny rapport i portalen", "kommun"),
  nytt_meddelande: T("Nytt meddelande", "Nytt meddelande om {arendenummer}", "kommun"),
  kallelse: T("Kallelse till första möte", "Kallelse till första möte", "deltagare"),
  tilldelning_coach: T("Tilldelning till coach", "Nytt ärende i Miljonmatch", "mb"),
  paminnelse_progression: T("Påminnelse om progression", "Påminnelse från Miljonmatch", "mb"),
  eskalering_chef: T("Eskalering till chef", "Eskalering i Miljonmatch", "mb"),
  avbojt: T("Avböjt avrop", "Besked om beställning {arendenummer}", "kommun"),
  coachbyte: T("Byte av huvudcoach", "Ny huvudcoach för {arendenummer}", "kommun"),
  beslut_behovs: T("Beslut behövs från kommunen", "Ärende {arendenummer} behöver ert beslut", "kommun"),
  atgardsplan_godkannande: T("Åtgärdsplan att godkänna", "Åtgärdsplan väntar på ert godkännande", "kommun"),
  atgardsplan_godkand: T("Åtgärdsplan godkänd", "Åtgärdsplan godkänd", "mb"),
  inbjudan_kommun: T("Inbjudan till portalen", "Inbjudan till Miljonbemannings portal", "kommun"),
};

/** Portalvarianten av den generiska mottagningsbekräftelsen (samma mallnyckel, egen text och ämnesrad – som i prototypen). */
export const GENERIC_PORTAL_BODY = "Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.";
const GENERIC_PORTAL_SUBJECT = "Vi har tagit emot er beställning";

/** Ämnesrad när mallen är okänd eller ärendenumret saknas. */
export const FALLBACK_SUBJECT = "Meddelande från Miljonmatch";

export const templateInfo = (key: string): TemplateInfo | null => TEMPLATES[key] ?? null;

/** Ämnesraden för ett utskick. Ärendenumret är det enda som får stå i den. */
export function subjectFor(template: string, body: string, caseNumber: string | null): string {
  if (template === "generisk_mottagningsbekraftelse" && body.trim() === GENERIC_PORTAL_BODY) return GENERIC_PORTAL_SUBJECT;
  const t = templateInfo(template);
  if (!t) return FALLBACK_SUBJECT;
  if (!t.subject.includes("{arendenummer}")) return t.subject;
  return caseNumber ? t.subject.replace("{arendenummer}", caseNumber) : FALLBACK_SUBJECT;
}

/** Behöver ämnesraden ärendenumret? (Då slås ärendet upp när utskicket läggs i kön.) */
export const subjectNeedsCaseNumber = (template: string): boolean => !!templateInfo(template)?.subject.includes("{arendenummer}");
