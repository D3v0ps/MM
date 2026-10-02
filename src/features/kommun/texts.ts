// Texter och datum i kommunens portal (prototypens hjälpare i views/kommun.js). Rena funktioner utan React och utan data –
// används av både skärmarna och hanterarna i området. Portalen skriver datum utan förkortningar: "1 februari 2027 klockan 09.12".
import { MONTHS, MONTHS_SHORT, addDays, fmtDateFull, fmtDateTimeFull, fmtTime, fmtWeekday, monthName, weekMonday, type WeekKey } from "@/core/time";
import type { CaseStatus, ReportKind } from "@/data/schema";
import type { KomCase } from "./api";

// ---------------------------------------------------------------- Miljonbemannings kontaktuppgifter (inte avtalsvärden)
/** Telefon för beställningar med skyddade personuppgifter och frågor. */
export const SAFE_PHONE = "08-000 00 00";
/** Kommunens formella beställningskanal (CLAUDE.md punkt 10). */
export const ORDER_MAILBOX = "avrop@miljonbemanning.se";
/**
 * Avsändaren av notiserna (beslut 2026-10-01, SPEC §11): notis@miljonmatch.se – domänen är verifierad i Resend med DNS hos
 * one.com. Svar går till avrop@miljonbemanning.se i produktion (MM_EMAIL_REPLY_TO).
 */
export const NOTIFY_FROM = "notis@miljonmatch.se";
/** Plattformens inloggningsregler (SPEC §4) – samma för alla beställare, inte ett avtalsvärde. */
export const AUTH = { codeDigits: 6, codeMinutes: 10, maxAttempts: 5, idleMinutes: 60, maxHours: 12 } as const;

// ---------------------------------------------------------------- Datum utan förkortningar
/** "1 februari 2027" */
export const fD = (s: string | null | undefined): string => fmtDateFull(s);
/** "1 februari 2027 klockan 09.12" */
export const fDT = (s: string | null | undefined): string => fmtDateTimeFull(s);
/** "tisdag 2 februari 2027 klockan 09.12" */
export const fDTL = (s: string | null | undefined): string => (s ? `${fmtWeekday(s)} ${String(s).slice(0, 4)} klockan ${fmtTime(s)}` : "–");
/** "25 januari" */
export const dayMonth = (s: string): string => fmtDateFull(s).replace(/ \d{4}$/, "");
/** "25 januari–31 januari" */
export const weekRangeText = (key: WeekKey): string => {
  const mon = weekMonday(key);
  return `${dayMonth(mon)}–${dayMonth(addDays(mon, 6))}`;
};
/** "December 2026" */
export const monthCap = (mk: string): string => monthName(mk).replace(/^./, (x) => x.toUpperCase());

const MON_FULL: Record<string, string> = Object.fromEntries(MONTHS_SHORT.map((s, i) => [s, MONTHS[i]]));
/** Texter från kärnan (t.ex. ordererkännandet) skrivs ut utan "kl." och förkortade månader. */
export const fullText = (t: string | null | undefined): string =>
  String(t || "")
    .replace(/\bkl\. /g, "klockan ")
    .replace(/(\d{1,2}) (jan|feb|mars|apr|maj|juni|juli|aug|sep|okt|nov|dec)\b/g, (_m, dd: string, mon: string) => `${dd} ${MON_FULL[mon] || mon}`);

// ---------------------------------------------------------------- Övrigt
export const trunc = (s: string | null | undefined, n: number): string => {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()} …` : t;
};
export const firstName = (name: string | null | undefined): string => String(name || "").split(" ")[0];
/** Personnummer i fri text (meddelanden ska aldrig innehålla personnummer). */
export const looksLikePnr = (s: string | null | undefined): boolean => /\b(19|20)?\d{6}[-+ ]?\d{4}\b/.test(String(s || ""));
/** Maskerat personnummer i granskningen: "••••••••-3456". */
export const maskPnr = (p: string | null | undefined): string => {
  const s = String(p || "").trim();
  return s.length > 4 ? `${s.slice(0, -4).replace(/\d/g, "•")}${s.slice(-4)}` : s;
};
/** Fasnamn utan förkortningen APL: "Praktik/APL" -> "Praktik på en arbetsplats". */
export const phaseText = (name: string): string => name.replace(/^Praktik\s*\/\s*APL$/i, "Praktik på en arbetsplats").replace(/\s*\/\s*APL\b/i, "");
/** Små grupper redovisas som "färre än 5" (minN från avtalet) så att ingen deltagare kan pekas ut. */
export const small = (n: number, minN: number): string => (n > 0 && n < minN ? `färre än ${minN}` : String(n));
export const ucfirst = (s: string): string => s.replace(/^./, (x) => x.toUpperCase());

// ---------------------------------------------------------------- Rapporter
/** Rubriken i portalen: "Veckorapport närvaro, vecka 4", "Månadsrapport januari 2027" … */
export function reportTitle(r: { kind: ReportKind; week: string | null; month: string | null }, kindLabel: (k: ReportKind) => string): string {
  if (r.kind === "weekly_attendance") return `Veckorapport närvaro, vecka ${Number(String(r.week).slice(-2))}`;
  if (r.kind === "monthly") return `Månadsrapport ${monthName(r.month ?? "")}`;
  if (r.kind === "customer_summary") return `Beställarrapport ${monthName(r.month ?? "")}`;
  return kindLabel(r.kind);
}

// ---------------------------------------------------------------- Ärendets status
export type BadgeLook = { label: string; tone: "grey" | "outline" | "bluetone" | "blue" | "dark" | "red"; icon: "inbox" | "clock" | "calendar" | "activity" | "pause" | "check-square" | "x-circle" };
const STATUS: Record<CaseStatus, BadgeLook> = {
  received: { label: "Mottagen", tone: "grey", icon: "inbox" },
  acknowledged: { label: "Väntar på bekräftelse", tone: "outline", icon: "clock" },
  confirmed: { label: "Start bokad", tone: "bluetone", icon: "calendar" },
  active: { label: "Pågår", tone: "blue", icon: "activity" },
  paused: { label: "Pausad", tone: "grey", icon: "pause" },
  closed: { label: "Avslutad", tone: "dark", icon: "check-square" },
  declined: { label: "Avböjd", tone: "red", icon: "x-circle" },
};
/** Statusmärket i portalen. En bekräftad insats utan bokat första möte heter "Bekräftad". */
export function statusLook(c: Pick<KomCase, "status" | "firstMeetingAt">): BadgeLook {
  const s = STATUS[c.status];
  return c.status === "confirmed" && !c.firstMeetingAt ? { ...s, label: "Bekräftad" } : s;
}
export const statusName = (s: CaseStatus): string => STATUS[s].label;

/** Status i en mening (ingressen på deltagarens sida). chef = kommunens chef läser (tredje person). */
export function statusText(c: KomCase, chef: boolean, phaseCount: number): string {
  const Who = chef ? `Handläggaren (${c.referrerName})` : "Du";
  switch (c.status) {
    case "received":
      return c.protectedIdentity
        ? `Beställningen är mottagen. Miljonbemanning ringer ${chef ? "handläggaren" : "dig"} och tar resten enligt den säkra rutinen för skyddade personuppgifter.`
        : "Beställningen är mottagen.";
    case "acknowledged":
      return `Beställningen är mottagen. ${Who} får besked om startdatum och coach senast ${fDTL(c.avropDue)}.`;
    case "confirmed":
      return c.firstMeetingAt
        ? `Insatsen är bekräftad. Första mötet är ${fDTL(c.firstMeetingAt)} i ${c.location || "Alby"}.`
        : `Insatsen är bekräftad. Första mötet bokas senast ${fD(c.firstMeetingDue)}.`;
    case "active":
      return `Insatsen pågår. Deltagaren är i fas ${c.phase} av ${phaseCount} (${phaseText(c.phaseName).toLowerCase()}).`;
    case "paused":
      return "Insatsen är pausad. Pausade veckor faktureras inte.";
    case "closed":
      return `Insatsen avslutades ${fD(c.endDate)}.${c.endReasonLabel ? ` Orsak: ${c.endReasonLabel.toLowerCase()}.` : ""}`;
    case "declined":
      return `Miljonbemanning kunde inte ta emot beställningen.${c.declineReason ? ` Orsak: ${c.declineReason}` : ""}`;
    default:
      return "";
  }
}

/** Status i kort form (listan). */
export function shortStatus(c: KomCase, chef: boolean, phaseCount: number): string {
  if (c.status === "active") return `Fas ${c.phase} av ${phaseCount} · ${phaseText(c.phaseName)}`;
  if (c.status === "acknowledged") return `Besked senast ${fDT(c.avropDue)}`;
  if (c.status === "confirmed") return c.firstMeetingAt ? `Första mötet ${fDT(c.firstMeetingAt)}` : "Första mötet bokas";
  if (c.status === "closed") return `Avslutad ${fD(c.endDate)}${c.endReasonLabel ? ` · ${c.endReasonLabel}` : ""}`;
  if (c.status === "declined") return `Avböjd ${fD(c.declinedAt)}`;
  if (c.status === "received") return chef ? "Miljonbemanning ringer handläggaren" : "Vi ringer dig";
  return statusName(c.status);
}
