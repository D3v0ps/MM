// Validering av beställarreferens, inköpsordernummer, personnummer och e-post (prototypens MM.valid).
// Mönstren läses från avtalskonfigurationen (CLAUDE.md punkt 4 och 11) – aldrig hårdkodade.
import { buyerRefLengthText, type OperationalConfig } from "./config";

export { buyerRefLengthText };

type BillingCfg = Pick<OperationalConfig, "billing">;
const str = (s: unknown): string => String(s ?? "").trim();

/** Kommunens beställarreferens enligt avtalets mönster (Botkyrka: 8–10 siffror). */
export const buyerRefValid = (s: string | null | undefined, cfg: BillingCfg): boolean => new RegExp(cfg.billing.buyerReference.pattern).test(str(s));

/** Kommunens inköpsordernummer enligt avtalets mönster (Botkyrka: nio siffror som börjar med 99). */
export const poNumberValid = (s: string | null | undefined, cfg: BillingCfg): boolean => new RegExp(cfg.billing.purchaseOrderNumber.pattern).test(str(s));

/** Felmeddelande för beställarreferensen, eller null om den är giltig. Texterna är prototypens. */
export function buyerRefError(s: string | null | undefined, cfg: BillingCfg): string | null {
  const v = str(s);
  if (!v) return "Beställarreferens saknas. Den får ni av kommunens ekonomi eller er chef.";
  if (/\D/.test(v)) return "Beställarreferensen får bara innehålla siffror – inga mellanslag, bindestreck eller bokstäver.";
  if (!buyerRefValid(v, cfg)) {
    const len = buyerRefLengthText(cfg);
    return len ? `Beställarreferensen ska vara ${len} siffror. Du har skrivit ${v.length}.` : `Beställarreferensen har fel format. Du har skrivit ${v.length} siffror.`;
  }
  return null;
}

const NUMBER_WORDS = ["noll", "en", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio", "elva", "tolv"];

/**
 * Beskrivning av inköpsordernumret ur mönstret, t.ex. "^99[0-9]{7}$" -> "nio siffror som börjar med 99".
 * Tom sträng om mönstret har en annan form.
 */
export function poNumberFormatText(cfg: BillingCfg): string {
  const m = cfg.billing.purchaseOrderNumber.pattern.match(/^\^(\d*)\[0-9\]\{(\d+)\}\$$/);
  if (!m) return "";
  const total = m[1].length + Number(m[2]);
  const word = NUMBER_WORDS[total] ?? String(total);
  return m[1] ? `${word} siffror som börjar med ${m[1]}` : `${word} siffror`;
}

/** Felmeddelande för inköpsordernumret (valfritt fält), eller null om det är tomt eller giltigt. */
export function poNumberError(s: string | null | undefined, cfg: BillingCfg): string | null {
  const v = str(s);
  if (!v || poNumberValid(v, cfg)) return null;
  const f = poNumberFormatText(cfg);
  return f ? `Inköpsordernummer ska vara ${f}.` : "Inköpsordernumret har fel format.";
}

/** Personnummer eller samordningsnummer – bara formatet (ÅÅÅÅMMDD-NNNN eller ÅÅMMDD-NNNN). */
export const pnrFormatValid = (s: string | null | undefined): boolean => /^(\d{6}|\d{8})[-+]?\d{4}$/.test(str(s));

/** Luhn-kontroll (kontrollsiffran) på de tio sista siffrorna ÅÅMMDDNNNK. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let v = Number(digits[i]) * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    sum += v;
  }
  return sum % 10 === 0;
}

/** De tio sista siffrorna (ÅÅMMDDNNNK) – normaliseringen för sökning och dubblettkontroll (HMAC i produktion). */
export const normalizePnr = (s: string | null | undefined): string => String(s ?? "").replace(/\D/g, "").slice(-10);

/** Format och kontrollsiffra. */
export const pnrValid = (s: string | null | undefined): boolean => pnrFormatValid(s) && luhn(normalizePnr(s));

/** De fyra sista siffrorna, för maskerad visning. */
export const pnrLast4 = (s: string | null | undefined): string => String(s ?? "").replace(/\D/g, "").slice(-4);

/** Streck som Word, Outlook och andra skriver i stället för bindestreck (‐ ‑ ‒ – — ― − ﹘ ﹣ －). */
const PNR_DASHES = /[‐-―−﹘﹣－]/g;
/** Personnummer efter normaliseringen: ÅÅMMDD-NNNN, ÅÅÅÅMMDDNNNN, mellanslag runt skiljetecknet godtas. */
const PNR_PATTERN = /\b(19|20)?\d{6}\s*[-+]?\s*\d{4}\b/;
const pnrNormalize = (s: string): string => s.normalize("NFKC").replace(PNR_DASHES, "-");

/**
 * Ser texten ut att innehålla ett personnummer (ÅÅMMDD-NNNN, ÅÅÅÅMMDDNNNN …)? Fri text – meddelanden från kommunen och
 * anteckningar i deltagarkortet – får aldrig innehålla personnummer (CLAUDE.md punkt 2). Ärendenumret räcker.
 * Texten normaliseras först: Word och Outlook gör om bindestrecket till tankstreck (–), och text kan innehålla andra
 * streck (‐ ‑ ‒ — ― −), helbreddssiffror eller hårda mellanslag. Mellanslag runt skiljetecknet godtas ("850101 - 1234").
 */
export const looksLikePnr = (s: string | null | undefined): boolean => PNR_PATTERN.test(pnrNormalize(String(s || "")));

/** Ersättningen för ett personnummer i text som tvättas (underlaget till AI, beslut 4 2026-10-09). */
export const PNR_SCRUBBED = "[personnummer borttaget]";

/** Ett varv av tvätten: personnumren byts, resten av texten är orörd (ingen normalisering av det som inte är personnummer). */
function scrubOnce(s: string): string {
  // Normalisera tecken för tecken och kom ihåg varifrån varje normaliserat tecken kommer (start och slut i originalet).
  let norm = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of s) {
    const n = pnrNormalize(ch);
    for (let k = 0; k < n.length; k++) {
      from.push(i);
      to.push(i + ch.length);
    }
    norm += n;
    i += ch.length;
  }
  let out = "";
  let last = 0;
  for (const m of norm.matchAll(new RegExp(PNR_PATTERN.source, "g"))) {
    const start = Math.max(from[m.index], last);
    const end = to[m.index + m[0].length - 1];
    if (end <= start) continue;
    out += s.slice(last, start) + PNR_SCRUBBED;
    last = end;
  }
  return out + s.slice(last);
}

/**
 * Tvätta bort allt som ser ut som ett personnummer (samma mönster som looksLikePnr, efter samma normalisering). Används för
 * coachernas anteckningar innan de blir underlag till AI-utkastet – efteråt gäller looksLikePnr(text) === false. Bara
 * personnumren byts: resten av texten är orörd (normaliseringen görs bara för att hitta dem – "…" blir aldrig "...", så
 * texten blir inte längre än anteckningen var utan personnummer).
 */
export function scrubPnr(s: string): string {
  let out = s;
  for (let round = 0; round < 3 && looksLikePnr(out); round++) out = scrubOnce(out);
  // Säkerhetsnätet (tecken som bara bildar ett personnummer när hela texten normaliseras): hela texten normaliserad.
  return looksLikePnr(out) ? pnrNormalize(out).replace(new RegExp(PNR_PATTERN.source, "g"), PNR_SCRUBBED) : out;
}

export const emailValid = (s: string | null | undefined): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(s));
