// Tolkning av mejl till avrop@ (beslut 4c, 2026-10-08, SPEC §7.1) – ren och isomorf, utan I/O. Samma nycklar som
// avropsinkorgen redan visar (OrderExtract, FIELD_LABEL, missingFields), så att ett inläst mejl ser ut precis som
// testdatats mejl i inkorgen.
//
//   Ärendenummer i ämnesraden eller texten (prefixet ur avtalet – aldrig hårdkodat) → ett svar om ett ärende: komplettering
//   om ärendet väntar på beslut (avgörs av anroparen, som känner ärendet), annars Övrigt.
//   Word-mallens fasta etiketter ("Förnamn: Anna", tabellceller) → beställning tolkad utan AI (parseMethod template).
//   Ser ut som ett avrop men saknar etiketter (fritext) → beställning utan tolkning (parseMethod manual): en människa
//   registrerar den i inkorgen. AI-tolkning av fritext hör till fas 2 och är av i produktion.
//   Allt annat → Övrigt (lämnas till en människa).
//
// Personnummer lämnar tolkningen bara som text i extracted.pnr – krypteras av anroparen innan det sparas i en person;
// i inbound_emails.extracted sparas det som i dag (samma som testdatat).
//
// Mallen följer portalens formulär (beslut 2026-10-09): "Yrkesområde" (avtalsområdets namn eller bokstav – tolkas mot
// avtalets avtalsområden, o.areas) är obligatoriskt; bostadsort, föredragen kontaktväg och "vet inte" frågas inte längre
// efter. Gamla mejl med de raderna tolkas som förut (bakåtkompatibelt).
import { MONTHS } from "@/core/time";
import { looksLikePnr, pnrFormatValid } from "@/core/validation";
import type { OrderExtract, OrderField, ParseMethod } from "@/data/schema";

export type ParsedMail = {
  /** order, other – eller reply när ett ärendenummer finns (anroparen avgör komplettering/övrigt). */
  kind: "order" | "other" | "reply";
  parseMethod: ParseMethod;
  /** Ärendenumret i ämnesraden eller texten (versaler), annars null. */
  caseNumber: string | null;
  /** "ärendenummer i ämnesraden" / "ärendenummer i texten". */
  linkedBy: string | null;
  extracted: OrderExtract;
  confidence: Partial<Record<OrderField, number>>;
  missingFields: OrderField[];
};

/**
 * Uppgifter som ordererkännandet frågar efter när de saknas (SPEC §7.1): startdatum, omfattning, deltagarens uppgifter och
 * yrkesområdet (obligatoriskt sedan 2026-10-09).
 */
export const REQUIRED_ORDER_FIELDS: readonly OrderField[] = ["desiredStart", "orderPeriod", "firstName", "lastName", "pnr", "primaryArea"];

/** Ett avtalsområde som yrkesområdet tolkas mot (contract_areas: kod och namn). */
export type AreaRef = { code: string; name: string };

/** Ärendet kan skapas automatiskt när deltagarens namn och ett personnummer i rätt format finns. */
export const canCreateCase = (ex: OrderExtract): boolean => !!ex.firstName && !!ex.lastName && pnrFormatValid(ex.pnr);

// ---------------------------------------------------------------- Etiketterna (Word-mallens fasta etiketter och vanliga varianter)
type Section = "referrer" | "participant" | "background";
type LabelTarget = OrderField | "name" | "contactPhone" | "contactEmail" | "contactName";

const norm = (s: string): string =>
  s.toLowerCase().normalize("NFKC").replace(/[*_]/g, "").replace(/\s+/g, " ").replace(/[:：]\s*$/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();

/** Etikett (normaliserad) → fält. "contact*" avgörs av avsnittet (handläggaren eller deltagaren). */
const LABELS: Record<string, LabelTarget> = {
  "handläggare": "referrerName", "handläggarens namn": "referrerName", "beställare": "referrerName", "beställarens namn": "referrerName",
  "kontaktperson": "referrerName", "ditt namn": "referrerName", "beställande handläggare": "referrerName",
  "enhet": "referrerUnit", "avdelning": "referrerUnit", "enhet/avdelning": "referrerUnit",
  "handläggarens telefon": "referrerPhone", "ditt telefonnummer": "referrerPhone", "handläggare telefon": "referrerPhone",
  "handläggarens e-post": "referrerEmail", "din e-postadress": "referrerEmail", "handläggare e-post": "referrerEmail", "handläggarens e-postadress": "referrerEmail",
  "beställarreferens": "buyerReference", "referens": "buyerReference", "referensnummer": "buyerReference",
  "önskat startdatum": "desiredStart", "startdatum": "desiredStart", "önskad start": "desiredStart", "önskat startdatum för insatsen": "desiredStart",
  "slutdatum": "plannedEnd", "planerat slut": "plannedEnd", "planerat slutdatum": "plannedEnd",
  "omfattning": "orderPeriod", "insatsens längd": "orderPeriod", "längd": "orderPeriod", "tidsperiod": "orderPeriod",
  "motivering": "orderPeriodReason", "motivering till annan tidsperiod": "orderPeriodReason",
  "förnamn": "firstName", "efternamn": "lastName",
  "namn": "name", "deltagarens namn": "name", "deltagare": "name",
  "personnummer": "pnr", "personnummer eller samordningsnummer": "pnr", "samordningsnummer": "pnr", "pnr": "pnr", "person-/samordningsnummer": "pnr",
  "telefon": "contactPhone", "telefonnummer": "contactPhone", "mobil": "contactPhone", "mobilnummer": "contactPhone",
  "deltagarens telefon": "phone", "deltagarens telefonnummer": "phone",
  "e-post": "contactEmail", "e-postadress": "contactEmail", "mejl": "contactEmail", "mejladress": "contactEmail", "epost": "contactEmail",
  "deltagarens e-post": "email", "deltagarens e-postadress": "email",
  "bostadsort": "city", "ort": "city",
  "föredragen kontaktväg": "preferredContact", "kontaktväg": "preferredContact", "hur vill deltagaren bli kontaktad": "preferredContact", "kontakt via": "preferredContact",
  "kartläggning genomförd": "priorAssessment", "kartläggning": "priorAssessment", "har en kartläggning genomförts": "priorAssessment",
  "bakgrundsinformation": "background", "bakgrund": "background", "bakgrundsinformation om deltagaren": "background", "övrig information": "background",
  "yrkesområde": "primaryArea", "deltagarens yrkesområde": "primaryArea",
  "avtalsområde": "primaryArea", "avtalsområde (primärt)": "primaryArea", "primärt avtalsområde": "primaryArea",
  "avtalsområde (alternativt)": "secondaryArea", "alternativt avtalsområde": "secondaryArea",
  "yrkesspår": "vocationalTrack", "yrkesinriktning": "vocationalTrack",
};
/** Fält som kan sträcka sig över flera rader (till nästa etikett eller en tom rad). */
const MULTILINE: readonly OrderField[] = ["background", "orderPeriodReason"];

/** Avsnittsrubriker i mallen: avgör om "Telefon"/"E-post"/"Namn" gäller handläggaren eller deltagaren. */
function sectionOf(line: string): Section | null {
  const l = norm(line).replace(/^\d+[.)]\s*/, "");
  if (/^(beställning och kontakt|beställning|kontakt|handläggare|beställare|kontaktuppgifter)$/.test(l)) return "referrer";
  if (/^(deltagare|deltagaren|deltagarens uppgifter|om deltagaren)$/.test(l)) return "participant";
  if (/^(bakgrund|bakgrundsinformation|bakgrundsinformation om deltagaren)$/.test(l)) return "background";
  return null;
}

/** Etiketten och värdet på en rad: "Etikett: värde", "Etikett<tab>värde" eller "Etikett – värde". */
function splitLine(line: string): { label: string; value: string } | null {
  const m = /^([^:：\t]{2,60})\s*(?:[:：]|\t+|\s+[–—]\s+)\s*(.*)$/.exec(line.trim());
  if (!m) return null;
  return { label: norm(m[1]), value: m[2].trim() };
}

// ---------------------------------------------------------------- Värden
const MONTH_INDEX = new Map<string, number>(MONTHS.map((m, i) => [m, i + 1]));
const pad = (n: number | string) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number): boolean => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** Datum i ISO ("2027-02-08"), "8 februari 2027", "8/2 2027", "8.2.2027" eller "20270208". Tom sträng när det inte går att tolka. */
export function parseSvDate(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/^den\s+/, "");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./ -](\d{4})\b/.exec(s);
  if (m && validDate(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /^(\d{1,2})(?::[ae])?\s+([a-zåäö]+)\s+(\d{4})\b/.exec(s);
  if (m) {
    const month = MONTH_INDEX.get(m[2]) ?? [...MONTH_INDEX.entries()].find(([name]) => name.startsWith(m![2].slice(0, 3)))?.[1];
    if (month && validDate(+m[3], month, +m[1])) return `${m[3]}-${pad(month)}-${pad(m[1])}`;
  }
  return "";
}

/** Omfattningen: "6 månader"/"6 mån"/"6" → "6", "annan tidsperiod" → "annan", annars "". */
export function parseOrderPeriod(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (/\bannan\b/.test(s)) return "annan";
  const m = /^(\d{1,2})\s*(mån|månad|månader)?\b/.exec(s);
  return m ? String(Number(m[1])) : "";
}

const parseContact = (raw: string): OrderExtract["preferredContact"] => {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (/\bsms\b/.test(s)) return "sms";
  if (/telefon|ring|samtal/.test(s)) return "phone";
  if (/e-?post|mejl|mail/.test(s)) return "email";
  if (/brev|post/.test(s)) return "letter";
  return "";
};
/**
 * Kartläggningen: ja eller nej. "Vet inte" frågas inte längre efter (beslut 2026-10-09) men tolkas i äldre mejl – före
 * "inte", så att "Vet inte" inte blir nej. "Inte genomförd" är nej.
 */
const parsePrior = (raw: string): OrderExtract["priorAssessment"] => {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  const no = /\bnej\b|\binte\b|\bej\b/.test(s);
  if (/\bvet\b/.test(s) && !/^(ja|nej)\b/.test(s)) return "vet_inte";
  if (/\bja\b/.test(s) && !/\bnej\b/.test(s)) return "ja";
  if (/genomförd/.test(s) && !no) return "ja";
  if (no) return "nej";
  return "";
};
/** Personnumret som det står, normaliserat till "ÅÅÅÅMMDD-NNNN" eller "ÅÅMMDD-NNNN". Tom sträng om formatet inte stämmer. */
export function parsePnr(raw: string): string {
  const t = raw.normalize("NFKC").replace(/[‐-―−﹘﹣－]/g, "-");
  const m = /(\d{8}|\d{6})\s*([-+])?\s*(\d{4})\b/.exec(t);
  if (!m) return "";
  const v = `${m[1]}${m[2] ?? "-"}${m[3]}`;
  return pnrFormatValid(v) ? v : "";
}
/** Namn och svar jämförs utan skiftläge, skiljetecken och extra mellanslag ("Lager & logistik" ≈ "lager logistik"). */
const areaKey = (s: string): string =>
  s.toLowerCase().normalize("NFKC").replace(/\boch\b|&/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Yrkesområdet → avtalsområdets kod. Med avtalets områden (areas): namnet ("Lager och logistik"), bokstaven ("G"), bokstav
 * och namn ("G Lager och logistik", "G. Lager") eller början av ett namn som bara passar ett område ("Lager"). Utan
 * areas (äldre anrop): bara bokstaven A–L. exact = svaret stämde precis (namn eller bokstav), annars en säker gissning.
 * Tom kod när svaret inte går att tolka.
 */
export function parseArea(raw: string, areas?: readonly AreaRef[]): { code: string; exact: boolean } {
  const s = raw.trim();
  const none = { code: "", exact: false };
  if (!s) return none;
  if (!areas) {
    const m = /^([A-La-l])\b/.exec(s);
    return m ? { code: m[1].toUpperCase(), exact: true } : none;
  }
  const key = areaKey(s);
  if (!key) return none;
  const byName = areas.find((a) => areaKey(a.name) === key);
  if (byName) return { code: byName.code, exact: true };
  // Bokstaven, ensam eller före namnet: "G", "G Lager och logistik", "G – Lager". Namnet måste då höra till samma område.
  const lm = /^(\p{L})(?:\s+(.*))?$/u.exec(key);
  const byCode = lm ? areas.find((a) => a.code.toLowerCase() === lm[1]) : undefined;
  if (byCode) {
    const rest = lm?.[2] ?? "";
    if (!rest || areaKey(byCode.name).startsWith(rest)) return { code: byCode.code, exact: true };
    return none;
  }
  // Början av ett namn ("Lager" → "Lager och logistik") – bara när ett enda område passar.
  const starts = areas.filter((a) => areaKey(a.name).startsWith(key) || key.startsWith(areaKey(a.name)));
  return starts.length === 1 ? { code: starts[0].code, exact: false } : none;
}

// ---------------------------------------------------------------- Texten
/** Mejltexten före ett citerat tidigare mejl (svar på ordererkännandet innehåller ordererkännandet under). */
export function ownText(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^\s*(från|from|-----\s*ursprungligt|-----\s*original|den .* skrev:|on .* wrote:)/i.test(l.trim()) && /[:>]/.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n");
}

/** Ärendenumret med avtalets prefix: "BOT-27-0049" i ämnesraden eller texten. */
export function findCaseNumber(subject: string, body: string, casePrefix: string): { caseNumber: string; where: "subject" | "body" } | null {
  const esc = casePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}-\\d{2}-\\d{4}\\b`, "i");
  const inSubject = re.exec(subject);
  if (inSubject) return { caseNumber: inSubject[0].toUpperCase(), where: "subject" };
  const inBody = re.exec(body);
  return inBody ? { caseNumber: inBody[0].toUpperCase(), where: "body" } : null;
}

type Found = { field: OrderField; value: string; sure: boolean };

/** Etiketterade värden i texten (rad för rad, med avsnitt). */
export function extractLabelled(text: string): Found[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Found[] = [];
  let section: Section = "referrer";
  let open: { field: OrderField; lines: string[] } | null = null;
  const flush = () => {
    if (open) {
      const v = open.lines.join("\n").trim();
      if (v) out.push({ field: open.field, value: v, sure: true });
    }
    open = null;
  };
  const target = (t: LabelTarget): OrderField | "name" => {
    if (t === "contactPhone") return section === "referrer" ? "referrerPhone" : "phone";
    if (t === "contactEmail") return section === "referrer" ? "referrerEmail" : "email";
    if (t === "contactName") return section === "referrer" ? "referrerName" : "name";
    return t;
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s*[-•*]\s+/, "").trim();
    const sec = sectionOf(line);
    if (sec) {
      flush();
      section = sec;
      continue;
    }
    const split = splitLine(line);
    const t = split ? LABELS[split.label] : undefined;
    if (split && t) {
      flush();
      const field = target(t);
      if (field === "name") {
        const parts = split.value.trim().split(/\s+/);
        if (parts.length >= 2) {
          out.push({ field: "firstName", value: parts.slice(0, -1).join(" "), sure: true });
          out.push({ field: "lastName", value: parts[parts.length - 1], sure: true });
        } else if (parts[0]) out.push({ field: "firstName", value: parts[0], sure: false });
        continue;
      }
      // "Deltagare: Anna Berg" byter också avsnitt till deltagaren.
      if (t === "name") section = "participant";
      if (MULTILINE.includes(field)) open = { field, lines: [split.value] };
      else if (split.value) out.push({ field, value: split.value, sure: true });
      continue;
    }
    // Ett fält över flera rader (bakgrunden) slutar vid en tom rad – hälsningsfrasen efter ska inte med.
    if (open) {
      if (!line) flush();
      else open.lines.push(line);
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- Tolkningen
const ORDER_WORDS = /\b(avrop|avropa|beställ|beställning|anvisa|anvisning|ny deltagare|insats)/i;

/**
 * Tolka ett mejl till avrop@. attachmentText = texten ur en bifogad Word-mall (servern läser den) – etiketter där väger
 * som i brödtexten. Returnerar samma struktur som inbound_emails har: extracted, confidence och missingFields.
 */
export function parseInboundMail(
  mail: { subject: string; bodyText: string; attachmentText?: string | null },
  o: { casePrefix: string; areas?: readonly AreaRef[] },
): ParsedMail {
  const subject = String(mail.subject ?? "");
  const own = ownText(String(mail.bodyText ?? ""));
  const text = [own, mail.attachmentText ?? ""].filter(Boolean).join("\n\n");
  const found = extractLabelled(text);
  const ex: OrderExtract = {};
  const confidence: Partial<Record<OrderField, number>> = {};
  const set = <K extends OrderField>(k: K, v: OrderExtract[K], c: number) => {
    if (v === "" || v == null) return;
    if (ex[k] != null && ex[k] !== "") return; // första förekomsten gäller
    ex[k] = v;
    confidence[k] = c;
  };
  for (const f of found) {
    const base = f.sure ? 1 : 0.6;
    switch (f.field) {
      case "desiredStart":
      case "plannedEnd": {
        const d = parseSvDate(f.value);
        set(f.field, d, /^\d{4}-\d{2}-\d{2}$/.test(f.value.trim()) ? base : d ? 0.9 : 0);
        if (!d) {
          ex[f.field] = "";
          confidence[f.field] = 0;
        }
        break;
      }
      case "orderPeriod":
        set("orderPeriod", parseOrderPeriod(f.value), base);
        break;
      case "preferredContact":
        set("preferredContact", parseContact(f.value), base);
        break;
      case "priorAssessment":
        set("priorAssessment", parsePrior(f.value), base);
        break;
      case "pnr":
        set("pnr", parsePnr(f.value), base);
        break;
      case "primaryArea":
      case "secondaryArea": {
        const a = parseArea(f.value, o.areas);
        set(f.field, a.code, a.exact ? base : Math.min(base, 0.7));
        break;
      }
      case "buyerReference":
        set("buyerReference", f.value.replace(/\D/g, ""), base);
        break;
      case "plannedWeeks":
      case "protectedIdentity":
        break;
      default:
        set(f.field, f.value, base);
    }
  }

  const hit = findCaseNumber(subject, own, o.casePrefix);
  if (hit) {
    return {
      kind: "reply", parseMethod: found.length ? "template" : "manual", caseNumber: hit.caseNumber,
      linkedBy: hit.where === "subject" ? "ärendenummer i ämnesraden" : "ärendenummer i texten", extracted: ex, confidence, missingFields: [],
    };
  }
  const labelled = found.length;
  const isOrder = labelled >= 2 || looksLikePnr(own) || ORDER_WORDS.test(subject) || ORDER_WORDS.test(own.slice(0, 600));
  if (!isOrder) return { kind: "other", parseMethod: "manual", caseNumber: null, linkedBy: null, extracted: {}, confidence: {}, missingFields: [] };
  // Fritext utan etiketter: personnumret plockas ut som stöd för registreringen (osäkert), inget annat gissas – AI är av.
  if (labelled < 2 && !ex.pnr) {
    const m = /((?:19|20)?\d{6})\s*[-+]?\s*(\d{4})\b/.exec(own.normalize("NFKC").replace(/[‐-―−﹘﹣－]/g, "-"));
    const pnr = m ? parsePnr(`${m[1]}-${m[2]}`) : "";
    if (pnr) set("pnr", pnr, 0.5);
  }
  const missingFields = REQUIRED_ORDER_FIELDS.filter((k) => ex[k] == null || ex[k] === "");
  return { kind: "order", parseMethod: labelled >= 2 ? "template" : "manual", caseNumber: null, linkedBy: null, extracted: ex, confidence, missingFields };
}

/** Kartläggningen i beställningen (ja/nej i mejlet → ärendets yes/no; "vet inte" i äldre mejl → unknown). */
export const priorFromExtract = (v: OrderExtract["priorAssessment"] | undefined): "yes" | "no" | "unknown" | null =>
  v === "ja" ? "yes" : v === "nej" ? "no" : v === "vet_inte" ? "unknown" : null;
