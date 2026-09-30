// E-postmallen: enkel HTML och ren text i MB:s grafiska profil. Texten kommer från hanteraren – mallen ramar bara in den
// med ordmärket, en rubrik (ämnesraden), en knapp till portalen (MM_APP_URL) och en fot. Inga personuppgifter läggs till: bara
// hanterarens text (ärendenummer och "logga in") och länken. Inga bilder, inga spårningspixlar, inga externa typsnitt.
// Färger: antracit #1E252B, röd #FF0C01 (bara punkten i ordmärket), ljusgrå #D1D3D3, blå #6BA2B9 (yta med antracit text), vitt.
import { domainOf, normalizeEmail } from "../auth/email";
import { templateInfo } from "./templates";
import type { OutboundRow } from "./types";

export type RenderConfig = {
  /** Appens adress utan snedstreck på slutet (MM_APP_URL). Saknas den blir det ingen knapp. */
  appUrl: string | null;
  /** Miljonbemannings domäner – personalen får länken till appen, alla andra till portalen. */
  staffDomains: readonly string[];
  /** Testmiljön märks i ämnesraden och överst i mejlet. */
  testEnvironment: boolean;
  /** Testmiljön: mejlet har skickats om till testaren – raden överst säger vem det skulle ha gått till (redirect.ts). */
  redirectNote?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const FONT = "Montserrat, Arial, Helvetica, sans-serif";
const ANTRACIT = "#1E252B";
const ROD = "#FF0C01";
const LJUSGRA = "#D1D3D3";
const BLA = "#6BA2B9";
const VIT = "#FFFFFF";

export const TEST_SUBJECT_PREFIX = "[Testmiljö] ";
const TEST_BANNER = "TESTMILJÖ – påhittade testdata. Mejlet går bara till testarna.";
export const FOOTER_LINES = [
  "Det här mejlet skickades automatiskt från Miljonmatch, Miljonbemanning AB.",
  "Skriv inte personnummer eller andra personuppgifter i e-post. Använd ärendenumret.",
] as const;

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Länken i mejlet: personalen till appen, kommunens användare till portalen, deltagaren ingen länk (loggar inte in). */
export function loginLink(row: Pick<OutboundRow, "template" | "to">, cfg: Pick<RenderConfig, "appUrl" | "staffDomains">): { url: string; label: string } | null {
  const base = (cfg.appUrl ?? "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//.test(base)) return null;
  if (templateInfo(row.template)?.audience === "deltagare") return null;
  const staff = cfg.staffDomains.map((d) => d.toLowerCase().replace(/^@/, "")).includes(domainOf(normalizeEmail(row.to)));
  return staff ? { url: `${base}/`, label: "Logga in i Miljonmatch" } : { url: `${base}/portal`, label: "Logga in i portalen" };
}

/** Ärendenummer (BOT-27-0049) bryts inte över två rader. Texten ändras inte – den kan kopieras som den är. */
const noWrapCaseNumbers = (html: string): string => html.replace(/\b[A-Z]{2,6}-\d{2}-\d{3,6}\b/g, (m) => `<span style="white-space:nowrap;">${m}</span>`);

/** Stycken: tom rad skiljer stycken, radbrytning inom stycket behålls. */
const paragraphs = (body: string): string[] =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

export function renderEmail(row: Pick<OutboundRow, "template" | "to" | "subject" | "body">, cfg: RenderConfig): RenderedEmail {
  const baseSubject = (row.subject ?? "").trim() || "Meddelande från Miljonmatch";
  const subject = `${cfg.testEnvironment ? TEST_SUBJECT_PREFIX : ""}${baseSubject}`;
  // Rubriken i mejlet är ämnesraden i versaler (sidrubriker i versaler enligt MB:s profil).
  const heading = baseSubject.toUpperCase();
  const link = loginLink(row, cfg);
  const parts = paragraphs(row.body);

  // ---------------------------------------------------------------- Ren text
  const note = cfg.testEnvironment && cfg.redirectNote ? cfg.redirectNote : null;
  const text = [
    ...(note ? [note, ""] : []),
    ...(cfg.testEnvironment ? [TEST_BANNER, ""] : []),
    parts.join("\n\n"),
    ...(link ? ["", `${link.label}: ${link.url}`] : []),
    "",
    "--",
    ...FOOTER_LINES,
  ].join("\n");

  // ---------------------------------------------------------------- HTML
  const p = (s: string) => `<p style="margin:0 0 16px 0;">${noWrapCaseNumbers(escapeHtml(s)).replace(/\n/g, "<br>")}</p>`;
  const preheader = escapeHtml((parts[0] ?? "").replace(/\s+/g, " ").slice(0, 110));
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;"><tr>` +
      `<td style="background:${ANTRACIT};border-radius:4px;">` +
      `<a href="${escapeHtml(link.url)}" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:${VIT};text-decoration:none;">${escapeHtml(link.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 16px 0;font-size:14px;">Fungerar inte knappen? Skriv in adressen i webbläsaren: <a href="${escapeHtml(link.url)}" style="color:${ANTRACIT};text-decoration:underline;">${escapeHtml(link.url)}</a></p>`
    : "";
  const banner =
    (note
      ? `<tr><td style="background:${VIT};border-bottom:3px dashed ${ANTRACIT};padding:12px 32px;font-family:${FONT};font-size:16px;font-weight:700;line-height:24px;color:${ANTRACIT};">${escapeHtml(note)}</td></tr>\n`
      : "") +
    (cfg.testEnvironment
      ? `<tr><td style="background:${BLA};padding:10px 32px;font-family:${FONT};font-size:14px;font-weight:700;line-height:20px;color:${ANTRACIT};">${escapeHtml(TEST_BANNER)}</td></tr>`
      : "");

  const html = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${LJUSGRA};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${LJUSGRA};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${VIT};">
<tr><td style="background:${ANTRACIT};padding:20px 32px;font-family:${FONT};font-size:20px;font-weight:700;letter-spacing:3px;line-height:24px;color:${VIT};">MILJONMATCH<span style="color:${ROD};">&#9679;</span></td></tr>
${banner}<tr><td style="padding:32px 32px 16px 32px;font-family:${FONT};font-size:16px;line-height:24px;color:${ANTRACIT};">
<h1 style="margin:0 0 16px 0;font-size:18px;font-weight:700;letter-spacing:1px;line-height:26px;color:${ANTRACIT};"><span style="color:${ROD};">&#9679;</span>&nbsp;${escapeHtml(heading)}</h1>
${parts.map(p).join("\n")}
${button}
</td></tr>
<tr><td style="background:${LJUSGRA};padding:16px 32px;font-family:${FONT};font-size:14px;line-height:20px;color:${ANTRACIT};">${FOOTER_LINES.map(escapeHtml).join("<br>")}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
  return { subject, html, text };
}
