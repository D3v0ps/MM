// Bygger src/features/hjalp/content.generated.ts ur lathundarna i docs/lathund/*.md, så att hjälpsidorna (/hjalp och
// /portal/hjalp) visar samma text som filerna – utan att bygget (Next/Turbopack och Vite) behöver läsa markdown.
// Körs av `npm run lathund:build` (och före build, demo:build och dev). Testet src/features/hjalp/content.test.ts
// kontrollerar att den genererade filen är i takt med markdownfilerna.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const LATHUND_FILES = { LATHUND_KOLLEGA: "kollega.md", LATHUND_KOMMUN: "kommun.md", LATHUND_MALL: "mall-mejlavrop.md" } as const;

export function renderContentModule(read: (file: string) => string): string {
  const lines = [
    "// GENERERAD FIL – ändra inte här. Källa: docs/lathund/*.md. Bygg om med `npm run lathund:build`.",
    "// Lathundarna som hjälpsidorna visar (src/features/hjalp). Testet content.test.ts kontrollerar att filen är i takt med källan.",
  ];
  for (const [name, file] of Object.entries(LATHUND_FILES)) lines.push(`export const ${name} = ${JSON.stringify(read(file))};`);
  return `${lines.join("\n")}\n`;
}

const read = (file: string) => readFileSync(`${root}docs/lathund/${file}`, "utf8");
writeFileSync(`${root}src/features/hjalp/content.generated.ts`, renderContentModule(read));
console.log("src/features/hjalp/content.generated.ts byggd ur docs/lathund/*.md");
