// Mallar för e-post och SMS (SPEC §9: versioneras, innehåller aldrig personuppgifter utöver ärendenummer).
// Isomorf och utan I/O: används av hanterarna (validering när en ny version sparas) och av skärmen (kontroll och
// förhandsvisning medan man skriver). Grundtexterna ligger i koden; sparade versioner i tabellen template_versions.
// Texterna är exakt den gamla prototypens (prototyp/src/views/admin.js, TEMPLATES).
import type { ContractConfig, OrgSettings, Within } from "@/core/config";
import { isUnset } from "@/core/config";
import { plural } from "@/core/format";
import { fmtDateTimeLong } from "@/core/time";
import { uniq } from "@/core/util";

export const GENERIC = "generisk_mottagningsbekraftelse";
export const GENERIC_PORTAL = "generisk_mottagningsbekraftelse_portal";

export type TemplateChannel = "email" | "sms" | "brev";

/** Det "Skickas"-texten beror på: avtalets konfiguration (SLA, puls) och Miljonbemannings interna regler. */
export type TemplateEnv = { cfg: Pick<ContractConfig, "sla" | "pulse">; org: OrgSettings };

export type TemplateDef = {
  key: string;
  name: string;
  channel: TemplateChannel;
  /** Övriga kanaler (kallelsen kan gå som e-post eller brev). */
  alsoVia?: TemplateChannel[];
  from: string;
  to: string;
  when: string | ((env: TemplateEnv) => string);
  subject?: string;
  body: string;
  version: number;
  updatedAt: string;
  /** Portalvarianten av den generiska bekräftelsen skickas med samma mallnyckel men har egen text. */
  variantOf?: string;
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const listSv = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}` : xs.join(""));

/** "5 minuter", "1 arbetsdag", "7 dagar". */
export const withinText = (w: Within): string =>
  w.minutes != null ? `${w.minutes} minuter` : w.workingDays != null ? plural(w.workingDays, "arbetsdag", "arbetsdagar") : w.days != null ? plural(w.days, "dag", "dagar") : "–";

/** Tidsgräns för en SLA-regel i avtalskonfigurationen, t.ex. "5 minuter". */
function slaWithinText(cfg: TemplateEnv["cfg"], key: string): string {
  const r = (cfg.sla ?? []).find((x) => x.key === key);
  return r && r.within && typeof r.within === "object" && !isUnset(r.within) ? withinText(r.within) : "den tid avtalet anger";
}
const OCCASION: Record<string, string> = { week2: "vecka 2", exit: "vid avslut" };
/** "Vecka 2, vid avslut och var 30:e dag vid långa insatser" – från avtalets pulskonfiguration. */
function pulseWhen(cfg: TemplateEnv["cfg"]): string {
  const p = cfg.pulse;
  if (!p) return "Enligt avtalet";
  return cap(listSv([...p.occasions.map((o) => OCCASION[o] ?? o), ...(p.periodicEveryDays ? [`var ${p.periodicEveryDays}:e dag vid långa insatser`] : [])]));
}

export const TEMPLATES: readonly TemplateDef[] = [
  { key: "ordererkannande", name: "Ordererkännande", channel: "email", from: "avrop@miljonbemanning.se (samma tråd via Microsoft Graph)", to: "Kommunens handläggare", when: (e) => `Automatiskt inom ${slaWithinText(e.cfg, "ordererkannande")} när ett avrop kommit in`, subject: "Vi har tagit emot er beställning – {arendenummer}", body: "Tack! Vi har tagit emot er beställning och gett den ärendenummer {arendenummer}. Ni får besked om startdatum och ansvarig coach senast {svar_senast}. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.", version: 3, updatedAt: "2026-12-02T10:14" },
  // Generisk mottagningsbekräftelse finns i två varianter – texterna är exakt de som skickas (inkorgen för mejl, beställningen i portalen).
  { key: GENERIC, name: "Generisk mottagningsbekräftelse – mejl", channel: "email", from: "avrop@miljonbemanning.se", to: "Avsändaren av mejlet", when: "När ett mejl till avrop@ gäller skyddade personuppgifter eller inte kan tolkas", subject: "Vi har tagit emot ditt mejl", body: "Tack för ditt mejl. Vi har tagit emot det och ringer dig i dag.", version: 2, updatedAt: "2026-10-20T13:30", variantOf: GENERIC },
  { key: GENERIC_PORTAL, name: "Generisk mottagningsbekräftelse – portalen", channel: "email", from: "avrop@miljonbemanning.se", to: "Kommunens handläggare som beställde i portalen", when: "När en beställning i portalen gäller skyddade personuppgifter", subject: "Vi har tagit emot er beställning", body: "Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.", version: 1, updatedAt: "2026-10-20T13:30", variantOf: GENERIC },
  { key: "orderbekraftelse", name: "Orderbekräftelse", channel: "email", from: "avrop@miljonbemanning.se", to: "Kommunens handläggare", when: "När avropet accepteras", subject: "Orderbekräftelse – {arendenummer}", body: "Orderbekräftelse för ärende {arendenummer} finns i portalen – logga in för att läsa. Startdatum och ansvarig coach framgår där.\n\n{lank}", version: 2, updatedAt: "2026-10-20T13:32" },
  { key: "ny_rapport", name: "Ny rapport", channel: "email", from: "notis@miljonmatch.se", to: "Mottagaren av rapporten", when: "När en rapport levereras i portalen", subject: "Ny rapport i portalen", body: "{rapporttyp} för ärende {arendenummer} finns i portalen – logga in för att läsa.\n\n{lank}", version: 2, updatedAt: "2026-11-05T09:00" },
  { key: "nytt_meddelande", name: "Nytt meddelande", channel: "email", from: "notis@miljonmatch.se", to: "Kommunens handläggare eller coachen", when: "När ett säkert meddelande skickas i ett ärende", subject: "Nytt meddelande om {arendenummer}", body: "Du har ett nytt meddelande om ärende {arendenummer} – logga in för att läsa.\n\n{lank}", version: 1, updatedAt: "2026-09-08T11:00" },
  { key: "kallelse", name: "Kallelse till första möte", channel: "sms", alsoVia: ["email", "brev"], from: "Miljonbemanning", to: "Deltagaren – via föredragen kontaktväg (SMS, e-post eller brev)", when: "När första mötet bokas. Aldrig vid skyddade personuppgifter.", body: "Välkommen till Miljonbemanning! Ditt första möte är {datum} kl. {tid} i {plats}. Frågor? Ring {telefon}.", version: 2, updatedAt: "2026-10-01T15:10" },
  { key: "motespaminnelse", name: "Mötespåminnelse", channel: "sms", from: "Miljonbemanning (SMS)", to: "Deltagaren", when: "Dagen före ett möte kl. 18.00", body: "Påminnelse: möte i morgon kl. {tid} hos Miljonbemanning i {plats}. Frågor? Ring {telefon}.", version: 1, updatedAt: "2026-09-08T11:00" },
  { key: "pulslank", name: "Pulslänk", channel: "sms", from: "Miljonbemanning (SMS)", to: "Deltagaren (aldrig vid skyddade personuppgifter)", when: (e) => pulseWhen(e.cfg), body: "Hej! Hur går det hos oss? Svara på fem korta frågor: {lank} Länken gäller i 7 dagar. Det är frivilligt att svara.", version: 2, updatedAt: "2026-11-18T10:40" },
  { key: "tilldelning_coach", name: "Tilldelning till coach", channel: "email", from: "notis@miljonmatch.se", to: "Huvudcoach och team", when: "När ett ärende tilldelas eller coach byts", subject: "Nytt ärende i Miljonmatch", body: "Du har fått ett nytt ärende i Miljonmatch: {arendenummer}. Logga in för att se detaljerna.", version: 1, updatedAt: "2027-01-11T08:30" },
  { key: "paminnelse_progression", name: "Påminnelse om progression", channel: "email", from: "notis@miljonmatch.se", to: "Huvudcoachen", when: (e) => `Enligt interna regler: ${e.org.notifications.progressionWatch.reminderSchedule}`, subject: "Påminnelse från Miljonmatch", body: "Påminnelse från Miljonmatch: ett av dina ärenden ({arendenummer}) saknar dokumenterad progression. Logga in för att se vilket steg som behövs.", version: 1, updatedAt: "2027-01-11T08:30" },
  { key: "eskalering_chef", name: "Eskalering till chef", channel: "email", from: "notis@miljonmatch.se", to: "Chef och controller – syns aldrig för coachen", when: (e) => `När ett ärende saknar progression ${e.org.notifications.progressionWatch.escalateAfterConsecutiveWeeks} veckor i rad`, subject: "Eskalering i Miljonmatch", body: "Eskalering i Miljonmatch: ett ärende ({arendenummer}) har {antal_veckor} veckor i rad utan progression. Logga in för att se detaljerna.", version: 1, updatedAt: "2027-01-11T08:30" },
  { key: "avbojt", name: "Avböjt avrop", channel: "email", from: "avrop@miljonbemanning.se", to: "Kommunens handläggare", when: "När ett avrop avböjs", subject: "Besked om beställning {arendenummer}", body: "Vi kan tyvärr inte ta emot beställning {arendenummer}. Logga in i portalen för att läsa orsaken.", version: 1, updatedAt: "2026-09-08T11:00" },
  { key: "coachbyte", name: "Byte av huvudcoach", channel: "email", from: "notis@miljonmatch.se", to: "Kommunens handläggare", when: "När huvudcoachen byts", subject: "Ny huvudcoach för {arendenummer}", body: "Ärende {arendenummer} har fått ny huvudcoach. Logga in i portalen för att se vem.", version: 1, updatedAt: "2026-09-08T11:00" },
  { key: "beslut_behovs", name: "Beslut behövs från kommunen", channel: "email", from: "notis@miljonmatch.se", to: "Kommunens handläggare", when: "När en avvikelse kräver kommunens beslut eller stöd – kommunen får också en uppgift i portalen", subject: "Ärende {arendenummer} behöver ert beslut", body: "Ärende {arendenummer} behöver ert beslut eller stöd – logga in för att läsa.", version: 1, updatedAt: "2027-01-11T08:30" },
  { key: "atgardsplan_godkannande", name: "Åtgärdsplan att godkänna", channel: "email", from: "notis@miljonmatch.se", to: "Kommunens chef", when: "När Miljonbemanning skickar en åtgärdsplan för en avtalsavvikelse till kommunen", subject: "Åtgärdsplan väntar på ert godkännande", body: "En åtgärdsplan inom avtalet med Miljonbemanning väntar på ert godkännande. Logga in i portalen för att läsa den.", version: 1, updatedAt: "2027-01-11T08:30" },
  { key: "atgardsplan_godkand", name: "Åtgärdsplan godkänd", channel: "email", from: "notis@miljonmatch.se", to: "Avtalsansvarig på Miljonbemanning", when: "När kommunen godkänner en åtgärdsplan", subject: "Åtgärdsplan godkänd", body: "Beställaren har godkänt en åtgärdsplan i Miljonmatch. Logga in för att se den.", version: 1, updatedAt: "2027-01-11T08:30" },
  // Deltagarens inspelningslänk (röstinspelning, beslut 2026-09-30): samma text som rost.linkSend skickar (linkMessageText i
  // src/features/rost/texts.ts) – bara länken, inget namn och inget ärendenummer. Länkens giltighet kommer från avtalet.
  { key: "rostlank", name: "Inspelningslänk till deltagaren", channel: "sms", alsoVia: ["email"], from: "Miljonbemanning (SMS) eller notis@miljonmatch.se (e-post)", to: "Deltagaren – via föredragen kontaktväg (SMS eller e-post). Aldrig vid skyddade personuppgifter.", when: "När coachen skickar en inspelningslänk från deltagarkortet", subject: "Spela in ett meddelande till din coach", body: "Hej! Din coach på Miljonbemanning vill gärna höra hur det går. Spela in ett kort meddelande på ditt språk. Det är frivilligt. Länken gäller i {antal_dagar} dagar och kan bara användas en gång: {lank}", version: 1, updatedAt: "2026-09-30T12:00" },
  { key: "inbjudan_kommun", name: "Inbjudan till portalen", channel: "email", from: "notis@miljonmatch.se", to: "Ny kommunanvändare", when: "När avtalsansvarig bjuder in en kommunanvändare", subject: "Inbjudan till Miljonbemannings portal", body: "Du har bjudits in till Miljonbemannings portal för beställare. Logga in på {lank} med din e-postadress. Du får en sexsiffrig kod i ett separat mejl.", version: 1, updatedAt: "2026-09-08T11:00" },
];

export const templateDef = (key: string): TemplateDef | null => TEMPLATES.find((t) => t.key === key) ?? null;
/** "Skickas"-texten för mallen. */
export const templateWhen = (t: TemplateDef, env: TemplateEnv): string => (typeof t.when === "function" ? t.when(env) : t.when);

/** Texten i inbjudan till en ny kommunanvändare (samma som mallen, med portalens adress ifylld). */
export const INVITE_TEXT =
  "Du har bjudits in till Miljonbemannings portal för beställare. Logga in på portal.miljonbemanning.se med din e-postadress. Du får en sexsiffrig kod i ett separat mejl.";

const TPL_NAME: Record<string, string> = Object.fromEntries(TEMPLATES.map((t) => [t.key, t.name]));
const PORTAL_GENERIC_BODY = TEMPLATES.find((t) => t.key === GENERIC_PORTAL)!.body;
/** Vilken mall ett utskick kommer från. Portalvarianten av den generiska bekräftelsen skickas med samma mallnyckel men har egen text. */
export const templateKeyOf = (n: { template: string; body: string }): string =>
  n.template === GENERIC && String(n.body || "").trim() === PORTAL_GENERIC_BODY ? GENERIC_PORTAL : n.template;
/** Mallens namn ("Ordererkännande"). Okänd nyckel blir läsbar text utan understreck. */
export const templateLabel = (key: string | null | undefined): string => TPL_NAME[key ?? ""] ?? cap(String(key || "Utskick").replace(/_/g, " "));

// ---------------------------------------------------------------- Kontroll "Innehåller inga personuppgifter"
export const ALLOWED_PLACEHOLDERS = ["arendenummer", "lank", "svar_senast", "datum", "tid", "plats", "telefon", "rapporttyp", "antal_veckor", "antal_dagar", "vecka"] as const;
const EXAMPLE: Record<string, string> = {
  arendenummer: "BOT-27-0049", lank: "https://portal.miljonbemanning.se", svar_senast: fmtDateTimeLong("2027-02-02T08:41"), datum: "onsdag 3 februari",
  tid: "10.00", plats: "Alby", telefon: "08-000 00 00", rapporttyp: "Månadsrapport individ", antal_veckor: "2", antal_dagar: "7", vecka: "vecka 4",
};
const PII_PH =
  /\{\s*(namn|förnamn|fornamn|efternamn|fullständigt_namn|deltagare|deltagarens?_namn|deltagarnamn|personnummer|pnr|samordningsnummer|födelsedatum|fodelsedatum|adress|gatuadress|postadress|hemadress|postnummer|telefon_deltagare|mobil_deltagare|mobilnummer|epost_deltagare|e-post_deltagare)\s*\}/gi;
/** Något som liknar ett personnummer i klartext (ÅÅÅÅMMDD-NNNN eller ÅÅMMDD-NNNN). */
export const PNR_RE = /\b(19|20)\d{6}[-+]?\d{4}\b|\b\d{6}[-+]\d{4}\b/;

export type TemplateCheck = { pii: string[]; unknown: string[]; pnr: boolean; ok: boolean };
/** Platshållare för namn/personnummer/adress och personnummer i klartext stoppar mallen. Okända platshållare varnas för. */
export function templateCheck(text: string): TemplateCheck {
  const s = String(text || "");
  const pii = uniq((s.match(PII_PH) || []).map((x) => x.replace(/\s/g, "")));
  const unknown = uniq((s.match(/\{[^{}]*\}/g) || []).map((x) => x.replace(/\s/g, "")).filter((x) => !pii.includes(x) && !(ALLOWED_PLACEHOLDERS as readonly string[]).includes(x.slice(1, -1).toLowerCase())));
  const pnr = PNR_RE.test(s);
  return { pii, unknown, pnr, ok: !pii.length && !pnr };
}
/** Förhandsvisning: platshållarna fylls med exempelvärden. */
export const fillExample = (s: string): string =>
  String(s || "").replace(/\{\s*([^{}\s]+)\s*\}/g, (m, k: string) => EXAMPLE[k.toLowerCase()] ?? m);

export const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "E-post", brev: "Brev", letter: "Brev" };
