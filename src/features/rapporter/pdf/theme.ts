// MB:s grafiska profil i PDF:erna (CLAUDE.md "Design"): bara MB:s färger, Montserrat, rubriker i versaler.
// Samma färger som appens tema (src/app/globals.css). Tonerna är antracit och ljusgrå blandade med vitt – samma som
// text-muted (antracit 74 %) och ljusgra-ton (ljusgrå 28 %) i appen, utskrivna som fasta färger eftersom PDF saknar alfa i text.
import { Font } from "@react-pdf/renderer";
import { MONTSERRAT_FONTS } from "./fonts-data";

export const PDF_COLOR = {
  antracit: "#1E252B",
  rod: "#FF0C01",
  /** Logotypfilernas röda (ordmärkets punkt). */
  rodLogo: "#ED2526",
  ljusgra: "#D1D3D3",
  bla: "#6BA2B9",
  vit: "#FFFFFF",
  /** Antracit 74 % på vitt (appens text-muted) – kontrast ca 6,4:1. */
  muted: "#595E62",
  /** Ljusgrå 28 % på vitt (appens ljusgra-ton) – tabellhuvuden. */
  ljusgraTon: "#F2F3F3",
} as const;

/** Typsnittet: Montserrat (latin) med reserv för tecken i latin-ext (t.ex. ž, ć, ı i namn). */
export const PDF_FONT = ["Montserrat", "Montserrat Ext"];

/** Storlekar i punkter (A4 = 595 × 842). Brödtext minst 9,5 pt i tabeller, 10 pt i löptext. */
export const PDF_SIZE = { body: 10, small: 8.5, meta: 8, h1: 14, h2: 8.5, h3: 10, label: 7.5 } as const;

let registered = false;
/** Registrera Montserrat (inbäddat, inget nätverk) en gång. Avstavning stängs av – mönstren är engelska. */
export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  const family = (name: string, subset: keyof typeof MONTSERRAT_FONTS) =>
    Font.register({ family: name, fonts: ([400, 700, 800] as const).map((w) => ({ src: MONTSERRAT_FONTS[subset][w], fontWeight: w })) });
  family("Montserrat", "latin");
  family("Montserrat Ext", "latin-ext");
  Font.registerHyphenationCallback((word) => [word]);
}
