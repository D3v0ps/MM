// E-postmallen: en gemensam layout i MB:s grafiska profil för appens alla mejl – notiserna (renderEmail) och
// inloggningskoden (renderLoginCodeEmail). Förebild: kodmejlet som granskades med användaren 2026-10-02 (supabase/templates/otp.html,
// som numera genereras från renderLoginCodeHtml – se scripts/email/generate-otp-template.ts).
//   ljusgrå bakgrund · vit kort med 4 px röd linje överst · ordmärket "Miljonbemanning" + röd punkt och "MILJONMATCH" under ·
//   rubrik 24 px · brödtext 16 px antracit på vitt · knapp i antracit med vit text (minst 44 px hög) och länken som text under ·
//   antracit fot med "Miljonbemanning AB." · testmiljöns banderoll och omdirigeringsraden överst i kortet.
// Alltid HTML och ren text. Förtext (preheader). lang="sv", role="presentation" på layouttabellerna. Inga bilder, inga externa
// typsnitt (Montserrat om det finns, annars Arial), inga spårningspixlar. Inga personuppgifter läggs till: bara hanterarens text
// (ärendenummer och "logga in") och länken. Kodmejlet har ingen länk alls (Safe Links förbrukar länkar).
// Färger – bara MB:s: antracit #1E252B, röd #FF0C01 (linjen och punkterna), ljusgrå #D1D3D3, blå #6BA2B9 (bara som yta eller
// kantlinje, aldrig som text), vitt.
import { CODE_VALID_MINUTES, domainOf, normalizeEmail } from "../auth/email";
import { LOGIN_CODE_TEMPLATE, TEMPLATES, templateInfo } from "./templates";
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
  /** Svarsadressen (MM_EMAIL_REPLY_TO). Satt: foten säger vart svar går. Tom: foten säger att det inte går att svara. */
  replyTo?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const FONT = "Montserrat, Arial, Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";
const ANTRACIT = "#1E252B";
const ROD = "#FF0C01";
const LJUSGRA = "#D1D3D3";
const BLA = "#6BA2B9";
const VIT = "#FFFFFF";
/** Sidmarginal i kortet. */
const PAD = "40px";

export const TEST_SUBJECT_PREFIX = "[Testmiljö] ";
export const TEST_BANNER = "TESTMILJÖ – påhittade testdata. Mejlet går bara till testarna.";

/** Fotens första rad (röd punkt i HTML). */
export const FOOTER_COMPANY = "Miljonbemanning AB.";
export const FOOTER_AUTOMATIC = "Det här mejlet skickades automatiskt från Miljonmatch.";
export const FOOTER_NO_REPLY = "Det går inte att svara på det.";
/** Notisernas rad om personuppgifter (CLAUDE.md punkt 9). */
export const FOOTER_NO_PII = "Skriv inte personnummer eller andra personuppgifter i e-post. Använd ärendenumret.";

/** "Avrop <avrop@miljonbemanning.se>" -> "avrop@miljonbemanning.se". */
const bareAddress = (s: string): string => (s.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? s).trim();

/** Fotens rader efter "Miljonbemanning AB." – svarsadressen när den finns, annars att det inte går att svara. */
export function footerLines(replyTo: string | null | undefined, opts: { pii: boolean }): string[] {
  const reply = replyTo?.trim() ? `Svar går till ${bareAddress(replyTo)}.` : FOOTER_NO_REPLY;
  return [`${FOOTER_AUTOMATIC} ${reply}`, ...(opts.pii ? [FOOTER_NO_PII] : [])];
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Länken i mejlet: personalen till appen, kommunens användare till portalen, deltagaren ingen länk (loggar inte in). */
export function loginLink(row: Pick<OutboundRow, "template" | "to">, cfg: Pick<RenderConfig, "appUrl" | "staffDomains">): { url: string; label: string } | null {
  const base = (cfg.appUrl ?? "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//.test(base)) return null;
  const info = templateInfo(row.template);
  if (info?.audience === "deltagare" || info?.link === false) return null;
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

// ================================================================ Den gemensamma layouten
/** Förtextens längsta längd (tecken). */
export const PREHEADER_MAX = 110;

/**
 * Förtexten i inkorgen: texten på en rad, högst PREHEADER_MAX tecken. Är den längre klipps den efter sista hela meningen
 * (om den räcker till minst halva längden), annars efter sista hela ordet med " …" (Svenska skrivregler: mellanslag före
 * när hela ord utelämnas). Aldrig mitt i ett ord eller en adress. En mening slutar med . ! ? följt av stor bokstav –
 * "kl. 08.41" och "t.ex. ett" är inga meningsslut.
 */
export function preheaderOf(text: string, max = PREHEADER_MAX): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max + 2);
  let sentence = -1;
  for (const m of head.matchAll(/[.!?](?= [A-ZÅÄÖ])/g)) sentence = m.index;
  if (sentence + 1 >= max / 2) return s.slice(0, sentence + 1);
  const cut = s.lastIndexOf(" ", max - 2);
  if (cut <= 0) return `${s.slice(0, max - 1)}…`;
  return `${s.slice(0, cut).replace(/[\s,;:–-]+$/, "")} …`;
}

/** Utfyllnad efter förtexten, så att mejlprogrammen inte visar resten av mejlet i förhandsvisningen. */
const PREHEADER_FILL = "&#8199;&#847;".repeat(24);

type Layout = {
  /** <title> (ämnesraden). */
  title: string;
  /** Förtexten i inkorgen (ren text). */
  preheader: string;
  /** Innehållet: färdiga <tr>-rader (escapade). */
  rows: string;
  footer: readonly string[];
  testEnvironment: boolean;
  redirectNote: string | null;
};

const td = (style: string, html: string): string => `<tr><td style="${style}">${html}</td></tr>`;
const text16 = `font-family:${FONT};font-size:16px;line-height:26px;color:${ANTRACIT};`;

/** Rubriken (24 px) och brödtexten (16 px) i en rad. */
const headingRow = (heading: string, bodyHtml: string): string =>
  td(
    `padding:28px ${PAD} 8px ${PAD};${text16}`,
    `\n<h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:800;color:${ANTRACIT};">${noWrapCaseNumbers(escapeHtml(heading))}</h1>\n${bodyHtml}\n`,
  );

const p = (html: string, margin = "0 0 16px 0"): string => `<p style="margin:${margin};">${html}</p>`;

function layout(o: Layout): string {
  const note = o.testEnvironment && o.redirectNote ? o.redirectNote : null;
  // Testmiljön: raden om omdirigeringen och banderollen överst i kortet, direkt under den röda linjen.
  const top =
    (note
      ? `${td(`background:${VIT};border-bottom:3px dashed ${ANTRACIT};padding:14px ${PAD};font-family:${FONT};font-size:16px;font-weight:700;line-height:24px;color:${ANTRACIT};`, escapeHtml(note))}\n`
      : "") +
    (o.testEnvironment
      ? `${td(`background:${BLA};padding:10px ${PAD};font-family:${FONT};font-size:14px;font-weight:700;line-height:20px;color:${ANTRACIT};`, escapeHtml(TEST_BANNER))}\n`
      : "");
  const footer = [
    `<div style="font-weight:700;">${escapeHtml(FOOTER_COMPANY.replace(/\.$/, ""))}<span style="color:${ROD};">.</span></div>`,
    // Raderna efter den första (raden om personuppgifter) får lite luft ovanför.
    ...o.footer.map((l, i) => (i === 0 ? `<div>${escapeHtml(l)}</div>` : `<div style="margin-top:8px;">${escapeHtml(l)}</div>`)),
  ].join("\n");
  return `<!doctype html>
<html lang="sv" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(o.title)}</title>
</head>
<body style="margin:0;padding:0;background:${LJUSGRA};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(o.preheader)}${PREHEADER_FILL}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${LJUSGRA};">
<tr><td align="center" style="padding:32px 12px;">

<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${VIT};border-radius:6px;">
<!-- Tunn röd linje överst -->
<tr><td style="height:4px;line-height:4px;font-size:4px;background:${ROD};border-radius:6px 6px 0 0;">&nbsp;</td></tr>
${top}
<!-- Ordmärket -->
<tr><td style="padding:28px ${PAD} 0 ${PAD};font-family:${FONT};color:${ANTRACIT};">
<div style="font-size:22px;line-height:28px;font-weight:800;letter-spacing:0.5px;">Miljonbemanning<span style="color:${ROD};">.</span></div>
<div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:3px;">MILJONMATCH</div>
</td></tr>

${o.rows}

<!-- Foten -->
<tr><td style="background:${ANTRACIT};padding:20px ${PAD};border-radius:0 0 6px 6px;font-family:${FONT};font-size:14px;line-height:21px;color:${VIT};">
${footer}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->

</td></tr>
</table>
</body>
</html>
`;
}

/** Ren text: testmiljöns rader överst, sedan innehållet och foten efter "--". */
function plainText(o: { testEnvironment: boolean; redirectNote: string | null; body: readonly string[]; footer: readonly string[] }): string {
  const note = o.testEnvironment && o.redirectNote ? o.redirectNote : null;
  return [...(note ? [note, ""] : []), ...(o.testEnvironment ? [TEST_BANNER, ""] : []), ...o.body, "", "--", FOOTER_COMPANY, ...o.footer].join("\n");
}

// ================================================================ Notiserna (hanterarnas utskick)
/**
 * Knappen (antracit, vit text, 48 px hög) och länken som text under, för den som inte ser knappen. Utfyllnaden sitter på
 * länken, så att hela knappen går att klicka på. Outlook för Windows (Word-motorn) ignorerar utfyllnad på <a> – där ger
 * mso-padding-alt cellen samma utfyllnad (andra mejlprogram läser inte mso-egenskaper), så knappen blir lika stor.
 */
function buttonRow(link: { url: string; label: string }): string {
  const url = escapeHtml(link.url);
  return td(
    `padding:8px ${PAD} 24px ${PAD};${text16}`,
    `\n<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td bgcolor="${ANTRACIT}" style="background:${ANTRACIT};border-radius:6px;mso-padding-alt:14px 28px;">` +
      `<a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:${VIT};text-decoration:none;border-radius:6px;">${escapeHtml(link.label)}</a>` +
      `</td></tr></table>\n` +
      `<p style="margin:16px 0 0 0;font-size:14px;line-height:21px;">Fungerar inte knappen? Skriv in adressen i webbläsaren:<br>` +
      `<a href="${url}" style="color:${ANTRACIT};text-decoration:underline;word-break:break-all;">${url}</a></p>\n`,
  );
}

export function renderEmail(row: Pick<OutboundRow, "template" | "to" | "subject" | "body">, cfg: RenderConfig): RenderedEmail {
  const baseSubject = (row.subject ?? "").trim() || "Meddelande från Miljonmatch";
  const subject = `${cfg.testEnvironment ? TEST_SUBJECT_PREFIX : ""}${baseSubject}`;
  const link = loginLink(row, cfg);
  const parts = paragraphs(row.body);
  const footer = footerLines(cfg.replyTo, { pii: true });
  const redirectNote = cfg.redirectNote ?? null;

  const text = plainText({
    testEnvironment: cfg.testEnvironment,
    redirectNote,
    body: [parts.join("\n\n"), ...(link ? ["", `${link.label}: ${link.url}`] : [])],
    footer,
  });

  const bodyHtml = parts.map((s, i) => p(noWrapCaseNumbers(escapeHtml(s)).replace(/\n/g, "<br>"), i === parts.length - 1 ? "0 0 20px 0" : "0 0 16px 0")).join("\n");
  const html = layout({
    title: subject,
    preheader: preheaderOf(parts[0] ?? ""),
    rows: [headingRow(baseSubject, bodyHtml), ...(link ? [buttonRow(link)] : [])].join("\n"),
    footer,
    testEnvironment: cfg.testEnvironment,
    redirectNote,
  });
  return { subject, html, text };
}

// ================================================================ Inloggningskoden
export const LOGIN_CODE_SUBJECT = TEMPLATES[LOGIN_CODE_TEMPLATE].subject;
/** Kodens giltighetstid när inget annat anges – samma som Supabase Auth (Email OTP Expiration 600 sekunder, docs/DRIFT.md 2.1). */
export const DEFAULT_CODE_VALID_MINUTES = CODE_VALID_MINUTES;

const LOGIN_CODE_TEXT = {
  heading: "Här är din inloggningskod",
  intro: "Skriv in koden på inloggningssidan i Miljonmatch för att logga in.",
  valid: (minutes: number) => `Gäller i ${minutes} minuter och kan användas en gång.`,
  notYou: "Har du inte bett om en kod?",
  notYouRest: "Då kan du strunta i det här mejlet. Ingen kan logga in utan koden.",
  neverShare: "Lämna aldrig ut koden till någon annan – inte heller till någon som säger att de ringer från Miljonbemanning. Vi frågar aldrig efter den.",
} as const;

export type LoginCodeConfig = { testEnvironment: boolean; validMinutes?: number };

/**
 * Kodmejlets HTML med `code` som text – används av renderLoginCodeEmail och för att generera Supabase-mallen
 * (supabase/templates/otp.html, med `{{ .Token }}`). Ingen länk.
 */
export function renderLoginCodeHtml(code: string, cfg: LoginCodeConfig): string {
  const minutes = cfg.validMinutes ?? DEFAULT_CODE_VALID_MINUTES;
  const t = LOGIN_CODE_TEXT;
  const c = escapeHtml(code);
  const rows = [
    "<!-- Innehållet -->",
    td(`padding:28px ${PAD} 8px ${PAD};${text16}`, `\n<h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:800;color:${ANTRACIT};">${escapeHtml(t.heading)}</h1>\n${p(escapeHtml(t.intro), "0 0 24px 0")}\n`),
    "",
    // Koden kan inte brytas: 6 × (24 px tecken + 8 px spärrning) + 16 px utfyllnad = 208 px, som ryms i kortets textbredd
    // även i en 320 px bred skärm (320 − 2 × 12 − 2 × 40 = 216 px). Mer till vänster än till höger, eftersom spärrningen
    // också läggs efter sista siffran – då står koden mitt i rutan.
    "<!-- Koden -->",
    `<tr><td align="center" style="padding:0 ${PAD};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${LJUSGRA};border-radius:6px;">
<tr><td align="center" style="padding:24px 4px 8px 12px;font-family:${MONO};font-size:40px;line-height:48px;font-weight:700;letter-spacing:8px;color:${ANTRACIT};">${c}</td></tr>
<tr><td align="center" style="padding:0 12px 20px 12px;font-family:${FONT};font-size:14px;line-height:20px;color:${ANTRACIT};">${escapeHtml(t.valid(minutes))}</td></tr>
</table>
</td></tr>`,
    "",
    "<!-- Trygghet -->",
    td(`padding:28px ${PAD} 8px ${PAD};${text16}`, `\n${p(`<b>${escapeHtml(t.notYou)}</b> ${escapeHtml(t.notYouRest)}`)}\n`),
    `<tr><td style="padding:0 ${PAD} 32px ${PAD};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="border-left:4px solid ${BLA};padding:4px 0 4px 16px;${text16}">${escapeHtml(t.neverShare)}</td></tr>
</table>
</td></tr>`,
  ].join("\n");
  return layout({
    title: LOGIN_CODE_SUBJECT,
    preheader: `Din kod är ${code}. Den gäller i ${minutes} minuter.`,
    rows,
    footer: footerLines(null, { pii: false }),
    testEnvironment: cfg.testEnvironment,
    redirectNote: null,
  });
}

/** Kodmejlet: HTML och ren text. Koden står bara i själva mejlet – aldrig i utskicksloggen (src/server/auth/code-mail.ts). */
export function renderLoginCodeEmail(code: string, cfg: LoginCodeConfig): RenderedEmail {
  if (!/^\d{4,10}$/.test(code)) throw new Error("Koden har fel format");
  const minutes = cfg.validMinutes ?? DEFAULT_CODE_VALID_MINUTES;
  const t = LOGIN_CODE_TEXT;
  const text = plainText({
    testEnvironment: cfg.testEnvironment,
    redirectNote: null,
    body: [`${t.heading}:`, "", code, "", `${t.intro} ${t.valid(minutes)}`, "", `${t.notYou} ${t.notYouRest}`, "", t.neverShare],
    footer: footerLines(null, { pii: false }),
  });
  return { subject: `${cfg.testEnvironment ? TEST_SUBJECT_PREFIX : ""}${LOGIN_CODE_SUBJECT}`, html: renderLoginCodeHtml(code, cfg), text };
}
