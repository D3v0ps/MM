// PDF för den interna månadsrapporten (Karims beslut 2026-11-18): samma rubriker, tabeller och siffror som vy-modellen, diagrammen
// ritade med Svg och texten i Montserrat. Renderas i Node och läses tillbaka (pdf-text.ts – det som faktiskt ritas).
import { renderToBuffer } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it } from "vitest";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { looksLikePnr } from "@/core/validation";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import type { MonthlyOverviewView } from "../api";
import { OverviewPdf, type OverviewPdfModel } from "./manad-doc";
import { pdfPages, pdfText } from "./pdf-text";
import { registerPdfFonts } from "./theme";

// Testdatat med kännetecken i stället för delmålens, nivåernas, taggarnas och gruppernas namn (en träff kan då inte vara en vanlig
// etikett), ett resultat efter ett avslut (en rad utanför urvalet) och ett byte av yrkesområde i januari – så att PDF:en har alla
// slags rader.
function seed(): MemoryData<Tables> {
  const data = createSeed();
  data.progress_goals.forEach((g, i) => (g.label = `DELMALSNAMN${i}X`));
  data.groupings.forEach((g, i) => {
    g.name = `GRUPPERINGSNAMN${i}X`;
    if (g.category) g.category = `TAGGKATEGORI${i}X`;
  });
  const closed = data.cases.find((x) => x.status === "closed" && !!x.endDate && x.endDate < "2026-12-01")!;
  data.outcome_events.push({ ...structuredClone(data.outcome_events[0]), id: "ev-efter", caseId: closed.id, kind: "arbete_paborjat", occurredOn: "2027-01-12" });
  const moved = data.cases.find((x) => x.status === "active" && x.primaryAreaCode === "G" && !!x.startDate && x.startDate < "2026-12-01" && !data.case_area_changes.some((c) => c.caseId === x.id))!;
  data.case_area_changes.push({
    id: "ch-pdf", contractId: moved.contractId, caseId: moved.id, fromArea: "G", toArea: "D", effectiveMonth: "2027-02", changedBy: "u-amira", changedAt: "2027-01-15T11:00", noteId: "note-pdf",
    seq: 1, fromTrack: moved.vocationalTrack ?? "", toTrack: "", fromSecondaryArea: null,
  });
  data.bonus_claims.push({ ...structuredClone(data.bonus_claims[0]), id: "bonus-pdf", caseId: moved.id, step: 1, status: "submitted", reachedOn: "2027-01-20" });
  return data;
}

let rt: MemoryRuntime;
let data: MemoryData<Tables>;
beforeAll(() => {
  data = seed();
  rt = createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
  registerPdfFonts();
});
const actor = (userId: string, role: Role): Actor => listPersonas(rt.raw()).find((p) => p.actor.userId === userId && p.actor.role === role)!.actor;
async function model(input: Record<string, unknown>, who: Actor = actor("u-sara", "samordnare")): Promise<OverviewPdfModel> {
  const v = (await rt.run("query", "rapporter.manadsrapport", input, who)) as MonthlyOverviewView;
  if (!v.allowed) throw new Error("inte tillåten");
  return v;
}
const squash = (s: string) => s.replace(/\s+/g, " ");
const render = async (m: OverviewPdfModel, sort: "omrade" | "narvaro" = "omrade") => new Uint8Array(await renderToBuffer(<OverviewPdf v={m} sort={sort} />));

describe("PDF för den interna månadsrapporten", () => {
  it("rubrikerna, avtalet och perioden, diagrammen, tabellernas siffror och bilagan – i Montserrat, utan personnummer", async () => {
    const m = await model({ month: "2027-01" });
    // Fixturen har alla slags rader: utanför urvalet, ett byte av yrkesområde och ett steg.
    expect(m.participants.some((p) => p.outside)).toBe(true);
    expect(m.participants.some((p) => p.areaChanges.length > 0)).toBe(true);
    expect(m.participants.some((p) => p.steps.length > 0)).toBe(true);
    const buf = await render(m);
    expect(String.fromCharCode(...buf.slice(0, 5))).toBe("%PDF-");
    const raw = new TextDecoder("latin1").decode(buf);
    // Typsnittet är inbäddat – också i diagrammens Svg-text (ingen standardfont).
    expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+Montserrat/);
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
    const text = squash(await pdfText(buf));
    for (const h of ["INTERN MÅNADSRAPPORT JANUARI 2027", "START OCH SLUT PER YRKESOMRÅDE", "NÄRVAROGRAD", "PROGRESSION", "AKTIVITETER", "RESULTAT", `PER DELTAGARE (${m.participants.length})`, "BILAGA: PER DELTAGARE"]) {
      expect(text.toUpperCase()).toContain(h);
    }
    expect(text).toContain("332026110, Botkyrka kommun");
    expect(text).toContain("Alla yrkesområden");
    // Flödesdiagrammet (Svg) och tabellen har samma tal.
    expect(text).toContain("Startade");
    expect(text).toContain("Avslutade");
    for (const r of m.flow.rows) expect(text).toContain(r.label.length > 30 ? r.label.slice(0, 20) : r.label);
    expect(text).toContain(squash(m.attendance.total.rateText));
    expect(text).toContain(squash(m.results.month?.valueText ?? "saknas"));
    expect(text).toContain("Avtalets mål");
    expect(text).toContain(`Status: ${m.results.month?.statusText}`);
    // Nivåerna som fördelning – skalans text ur avtalet.
    expect(text).toContain("Nivå 2 – Tydlig");
    for (const p of m.participants.slice(0, 5)) {
      expect(text).toContain(p.caseNumber);
      expect(text).toContain(p.name);
    }
    // Bilagan: raden utanför urvalet, bytet och frånvaron uppdelad.
    expect(text).toContain(m.participants.find((p) => p.outside)!.outside!);
    expect(text).toContain("G till D från februari 2027");
    expect(text).toContain("ej registrerade");
    expect(looksLikePnr(text)).toBe(false);
    // Varje sida har sidfoten och ingen text hamnar utanför sidan.
    const pages = await pdfPages(buf);
    expect(pages.length).toBeGreaterThan(2);
    for (const pg of pages) for (const l of pg.lines) expect(l.y, l.text).toBeGreaterThan(0);
  });

  it("aldrig delmålens namn eller nivåernas, taggarnas och gruppernas namn – förra och innevarande månad", async () => {
    for (const month of ["2027-01", "2027-02"]) {
      const text = squash(await pdfText(await render(await model({ month }))));
      expect(text, month).not.toMatch(/DELMALSNAMN|GRUPPERINGSNAMN|TAGGKATEGORI/);
      for (const g of data.progress_goals) expect(text).not.toContain(g.id);
    }
  });

  it("coachens PDF har ingen resultatgrad och inga mål för den (Karims beslut 2026-11-24)", async () => {
    const m = await model({ month: "2027-01" }, actor("u-amira", "coach"));
    expect(m.results.month).toBeNull();
    const text = squash(await pdfText(await render(m)));
    expect(text).toContain("RESULTAT");
    expect(text).toContain("Verifierade resultat");
    expect(text).not.toMatch(/Resultatgrad|Avtalets mål|Internt mål/);
  });

  it("ett yrkesområde och innevarande månad: filtret och läget står i informationsblocket", async () => {
    const m = await model({ month: "2027-02", area: "G" });
    const text = squash(await pdfText(await render(m, "narvaro")));
    expect(text).toContain("G Lager och logistik");
    expect(text).toContain("Månaden pågår".toUpperCase());
    expect(text).not.toContain("Alla yrkesområden");
  });
});
