// Synpunkter (feedback) – gemensamt för prototypens feedbacklåda (src/demo/feedback*.ts[x]) och testmiljöns "Lämna synpunkt"
// (src/features/synpunkter/panel.tsx). Typer, prioriteter och statusar med etiketter (samma texter som den gamla
// prototypen, prototyp/src/90-feedback.js), sidan utan personuppgifter och CSV-exporten. Isomorf och utan I/O.
import { perspectiveOf, ROLE_LABEL, ROLES, type Role } from "@/api/roles";
import { PERSPECTIVES } from "@/data/actors";
import { FEEDBACK_PRIORITIES, FEEDBACK_STATUSES, FEEDBACK_TYPES, type FeedbackPriority, type FeedbackStatus, type FeedbackType } from "@/data/schema";
import type { IconName } from "@/ui/icons";

export { FEEDBACK_PRIORITIES, FEEDBACK_STATUSES, FEEDBACK_TYPES, type FeedbackPriority, type FeedbackStatus, type FeedbackType };

export const FB_TYPES: { value: FeedbackType; label: string; icon: IconName }[] = [
  { value: "fel", label: "Fel", icon: "alert" },
  { value: "forbattring", label: "Förbättring", icon: "edit" },
  { value: "fraga", label: "Fråga", icon: "help" },
  { value: "bra", label: "Bra som det är", icon: "check-circle" },
];
export const FB_PRIOS: { value: FeedbackPriority; label: string }[] = [
  { value: "maste", label: "Måste ändras" },
  { value: "bor", label: "Bör ändras" },
  { value: "kan", label: "Kan vänta" },
];
export const FB_STATUSES: { value: FeedbackStatus; label: string }[] = [
  { value: "ny", label: "Ny" },
  { value: "diskutera", label: "Att diskutera" },
  { value: "andras", label: "Ska ändras" },
  { value: "klar", label: "Klar" },
  { value: "avfardad", label: "Avfärdad" },
];
/** Statusar som räknas som klara (filtret "Inte klara" visar de andra). */
export const FB_DONE: readonly string[] = ["klar", "avfardad"];

export const typeLabel = (v: string) => FB_TYPES.find((t) => t.value === v)?.label ?? v;
export const prioLabel = (v: string) => FB_PRIOS.find((t) => t.value === v)?.label ?? v;
export const statusLabel = (v: string) => FB_STATUSES.find((t) => t.value === v)?.label ?? v;
export const typeIcon = (v: string): IconName | undefined => FB_TYPES.find((t) => t.value === v)?.icon;
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);
/** Roller som har tagits bort men kan finnas i äldre synpunkter (kommunens chef, beslut 2026-10-07). */
const REMOVED_ROLE_LABEL: Record<string, string> = { kommun_chef: "Kommunens chef (borttagen roll)" };
export const roleLabelOf = (role: string | null | undefined): string => (isRole(role) ? ROLE_LABEL[role] : (role && REMOVED_ROLE_LABEL[role]) || "");
/** "Leverantör", "Kund" eller "Deltagare" – samma etiketter som prototypens perspektiv. */
export const perspectiveLabelOf = (role: Role): string => PERSPECTIVES.find((p) => p.key === perspectiveOf(role))?.label ?? "";

/** Längsta texten i en synpunkt och i ett svar (samma gränser som databasen, 0017_synpunkter.sql). */
export const FEEDBACK_TEXT_MAX = 4000;
export const FEEDBACK_REPLY_MAX = 2000;
export const FEEDBACK_TITLE_MAX = 120;

// ---------------------------------------------------------------- Sidan – bara sökväg och id:n
/**
 * Frågeparametrar som får följa med (flikar, filter, månad, vecka och id:n). Allt annat tas bort – en parameter kan
 * innehålla fritext (t.ex. en sökning) eller en återhoppsadress (?till=).
 */
export const FEEDBACK_QUERY_KEYS: readonly string[] = ["flik", "filter", "arende", "vecka", "manad", "lage", "avtal", "avstamning", "rost", "senaste", "fran"];
/** Engångslänkarna (/rost/<token>, /puls/<token>, /p/<token>): token är behörigheten och sparas aldrig. */
const LINK_ROOTS = new Set(["rost", "puls", "p"]);
const SEGMENT = /^[A-Za-z0-9_.-]{1,80}$/;
const QUERY_VALUE = /^[A-Za-z0-9_-]{1,64}$/;
/** Något som kan vara ett personnummer eller samordningsnummer (sex eller åtta siffror, ev. - eller +, fyra siffror). */
const PNR_LIKE = /\d{6}(\d{2})?[-+]?\d{4}/;
/** Det som står i stället för en token eller ett avsnitt som inte är ett id. */
export const PATH_MASK = "•••••";
/**
 * Mönstret som databasen kräver av feedback.path (0017_synpunkter.sql, exakt samma text): en egen sökväg med id:n och
 * frågeparametrar – aldrig "//värd/…" (en adress till en annan webbplats) och inga mellanslag. sanitizeFeedbackPath ger
 * alltid en sökväg som passar.
 */
export const FEEDBACK_PATH_PATTERN = "^/([A-Za-z0-9_.•-][A-Za-z0-9/_.•-]*)?(\\?[A-Za-z0-9_=&-]*)?$";

/**
 * Sidan som synpunkten gäller: bara sökvägen med id:n och de tillåtna frågeparametrarna – aldrig namn, personnummer eller
 * fritext. Engångslänkarnas token och avsnitt som inte ser ut som id:n maskeras ("•••••"). Null om det inte är en sökväg.
 * Används både i webbläsaren och av hanteraren (servern litar aldrig på det webbläsaren skickar).
 */
export function sanitizeFeedbackPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const noHash = String(raw).split("#")[0];
  const q = noHash.indexOf("?");
  const pathname = q < 0 ? noHash : noHash.slice(0, q);
  const search = q < 0 ? "" : noHash.slice(q + 1);
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const segs = pathname.split("/").filter(Boolean).slice(0, 8);
  // Token i engångslänken, och avsnitt som inte ser ut som id:n (fritext, kodade tecken, något som kan vara ett
  // personnummer), maskeras.
  const safe = segs.map((s, i) => (i === 1 && LINK_ROOTS.has(segs[0]) ? PATH_MASK : SEGMENT.test(s) && !PNR_LIKE.test(s) ? s : PATH_MASK));
  const params = new URLSearchParams(search);
  const kept: string[] = [];
  for (const key of FEEDBACK_QUERY_KEYS) {
    const v = params.get(key);
    if (v && QUERY_VALUE.test(v) && !PNR_LIKE.test(v)) kept.push(`${key}=${v}`);
  }
  const out = `/${safe.join("/")}${kept.length ? `?${kept.join("&")}` : ""}`;
  return out.slice(0, 300);
}

/** Skärmens titel: en rad, högst 120 tecken. */
export function sanitizeViewTitle(raw: string | null | undefined): string | null {
  const t = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, FEEDBACK_TITLE_MAX) : null;
}

// ---------------------------------------------------------------- CSV
/** Skydd mot formler i kalkylprogram: en cell som börjar med =, +, -, @, tab eller vagnretur får en apostrof först. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Det CSV-exporten behöver av en synpunkt (FeedbackView i api.ts har mer). authorName är alltid hela namnet – aldrig "Du",
 * filen delas med andra.
 */
export type FeedbackCsvRow = {
  /** Testtiden (ctx.now()). */
  createdAt: string;
  /** Riktig tid (sätts av databasen). Saknas i minnesläget – då gäller testtiden. */
  submittedAt?: string | null;
  type: string;
  priority: string;
  status: string;
  role: string;
  viewTitle: string | null;
  path: string | null;
  text: string;
  authorName: string;
  replies: { createdAt: string; submittedAt?: string | null; authorName: string; text: string }[];
};

/** '2027-02-01T09:40' -> '2027-02-01 09:40' (Stockholms tid). */
const csvTime = (t: string) => t.replace("T", " ");

/** Synpunkterna som CSV: semikolon, CRLF, svenska rubriker. UTF-8 med BOM läggs till av nedladdningen (useDownload). */
export function feedbackCsv(items: readonly FeedbackCsvRow[]): string {
  // Tid = när synpunkten sparades (riktig tid). Testdatum = testklockan i testmiljön, det datum testdatat visade.
  const head = ["Tid", "Testdatum", "Typ", "Hur viktigt", "Status", "Roll", "Sida", "Sökväg", "Synpunkt", "Lämnad av", "Antal svar", "Svar"];
  const rows = items.map((x) => [
    csvTime(x.submittedAt ?? x.createdAt),
    csvTime(x.createdAt),
    typeLabel(x.type),
    prioLabel(x.priority),
    statusLabel(x.status),
    roleLabelOf(x.role),
    x.viewTitle ?? "Hela Miljonmatch",
    x.path ?? "",
    x.text,
    x.authorName,
    x.replies.length,
    x.replies.map((r) => `${r.authorName} (${csvTime(r.submittedAt ?? r.createdAt)}): ${r.text}`).join("\n"),
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}
