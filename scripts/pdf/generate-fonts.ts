// Skriver src/features/rapporter/pdf/fonts-data.ts: Montserrat (400, 700, 800) som data-URL:er, så att PDF:erna har samma
// typsnitt i Next och i prototypens enda HTML-fil, utan nätverk. Källan är @fontsource/montserrat (SIL Open Font License 1.1),
// delmängderna latin (svenska tecken) och latin-ext (namn som Hodžić, Aydın och Öztürk), woff (fontkit kan inte göra delmängder av woff2).
// Kör: npx tsx scripts/pdf/generate-fonts.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}node_modules/@fontsource/montserrat/package.json`, "utf8")) as { version: string };
const WEIGHTS = [400, 700, 800] as const;
const SUBSETS = ["latin", "latin-ext"] as const;

const data = (subset: string, w: number) =>
  `data:font/woff;base64,${readFileSync(`${root}node_modules/@fontsource/montserrat/files/montserrat-${subset}-${w}-normal.woff`).toString("base64")}`;

const lines = [
  "// GENERERAD FIL – ändra inte för hand. Skapas av scripts/pdf/generate-fonts.ts.",
  `// Montserrat från @fontsource/montserrat ${pkg.version} (SIL Open Font License 1.1 – fri att bädda in i dokument).`,
  "// Delmängderna latin och latin-ext, vikterna 400, 700 och 800, som woff-data-URL:er. Laddas bara när en PDF byggs.",
  "export const MONTSERRAT_FONTS = {",
  ...SUBSETS.flatMap((s) => [
    `  ${JSON.stringify(s)}: {`,
    ...WEIGHTS.map((w) => `    ${w}: ${JSON.stringify(data(s, w))},`),
    "  },",
  ]),
  "} as const;",
  "",
];
const target = `${root}src/features/rapporter/pdf/fonts-data.ts`;
writeFileSync(target, lines.join("\n"));
console.log(`Skrev ${target} (${lines.join("\n").length} tecken)`);
