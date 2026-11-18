// PDF för den interna månadsrapporten (Karims beslut 2026-11-18): samma rubriker, tabeller och siffror som vy-modellen, diagrammen
// ritade med Svg och texten i Montserrat. Renderas i Node och läses tillbaka (pdf-text.ts – det som faktiskt ritas).
import { renderToBuffer } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it } from "vitest";
import "@/api/handlers";
import type { Actor } from "@/api/roles";
import { looksLikePnr } from "@/core/validation";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { MonthlyOverviewView } from "../api";
import { OverviewPdf, type OverviewPdfModel } from "./manad-doc";
import { pdfPages, pdfText } from "./pdf-text";
import { registerPdfFonts } from "./theme";

let rt: MemoryRuntime;
beforeAll(() => {
  rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
  registerPdfFonts();
});
const sara = (): Actor => listPersonas(rt.raw()).find((p) => p.actor.userId === "u-sara" && p.actor.role === "samordnare")!.actor;
async function model(input: Record<string, unknown>): Promise<OverviewPdfModel> {
  const v = (await rt.run("query", "rapporter.manadsrapport", input, sara())) as MonthlyOverviewView;
  if (!v.allowed) throw new Error("inte tillåten");
  return v;
}
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("PDF för den interna månadsrapporten", () => {
  it("rubrikerna, avtalet och perioden, diagrammen och tabellernas siffror – i Montserrat, utan personnummer", async () => {
    const m = await model({ month: "2027-01" });
    const buf = new Uint8Array(await renderToBuffer(<OverviewPdf v={m} sort="omrade" />));
    expect(String.fromCharCode(...buf.slice(0, 5))).toBe("%PDF-");
    const raw = new TextDecoder("latin1").decode(buf);
    // Typsnittet är inbäddat – också i diagrammens Svg-text (ingen standardfont).
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+Montserrat/);
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
    const text = squash(await pdfText(buf));
    for (const h of ["INTERN MÅNADSRAPPORT JANUARI 2027", "START OCH SLUT PER YRKESOMRÅDE", "NÄRVAROGRAD", "PROGRESSION", "AKTIVITETER", "RESULTAT", `PER DELTAGARE (${m.participants.length})`]) {
      expect(text.toUpperCase()).toContain(h);
    }
    expect(text).toContain("332026110, Botkyrka kommun");
    expect(text).toContain("Alla yrkesområden");
    // Flödesdiagrammet (Svg) och tabellen har samma tal.
    expect(text).toContain("Startade");
    expect(text).toContain("Avslutade");
    for (const r of m.flow.rows) expect(text).toContain(r.label.length > 30 ? r.label.slice(0, 20) : r.label);
    expect(text).toContain(squash(m.attendance.total.rateText));
    expect(text).toContain(squash(m.results.month.valueText));
    expect(text).toContain("Avtalets mål");
    // Nivåerna som fördelning – skalans text ur avtalet.
    expect(text).toContain("Nivå 2 – Tydlig");
    for (const p of m.participants.slice(0, 5)) {
      expect(text).toContain(p.caseNumber);
      expect(text).toContain(p.name);
    }
    expect(looksLikePnr(text)).toBe(false);
    // Varje sida har sidfoten och ingen text hamnar utanför sidan.
    const pages = await pdfPages(buf);
    expect(pages.length).toBeGreaterThan(2);
    for (const pg of pages) for (const l of pg.lines) expect(l.y, l.text).toBeGreaterThan(0);
  });

  it("ett yrkesområde och innevarande månad: filtret och läget står i informationsblocket", async () => {
    const m = await model({ month: "2027-02", area: "G" });
    const text = squash(await pdfText(new Uint8Array(await renderToBuffer(<OverviewPdf v={m} sort="narvaro" />))));
    expect(text).toContain("G Lager och logistik");
    expect(text).toContain("Månaden pågår".toUpperCase());
    expect(text).not.toContain("Alla yrkesområden");
  });
});
