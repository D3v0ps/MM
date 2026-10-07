// PDF för rapportbyggarens sammanställningar (Del G2): samma rubriker, rader och regeltexter som vy-modellen; kommunens läge
// utan internt mål. Renderas i Node och läses tillbaka (pdf-text.ts – det som faktiskt ritas).
import { renderToBuffer } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { looksLikePnr } from "@/core/validation";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { BuilderPdf, builderPdfTable, type BuilderPdfModel } from "./builder-doc";
import { pdfText } from "./pdf-text";
import { registerPdfFonts } from "./theme";

let rt: MemoryRuntime;
beforeAll(() => {
  rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
  registerPdfFonts();
});
const as = (userId: string, role: Role): Actor => listPersonas(rt.raw()).find((p) => p.actor.userId === userId && p.actor.role === role)!.actor;
async function model(actor: Actor, key: string, input: Record<string, unknown>): Promise<BuilderPdfModel> {
  const res = (await rt.run("command", key, input, actor)) as { ok: boolean; pdf?: BuilderPdfModel };
  if (!res.ok || !res.pdf) throw new Error(JSON.stringify(res).slice(0, 200));
  return res.pdf;
}
const render = async (m: BuilderPdfModel) => pdfText(new Uint8Array(await renderToBuffer(<BuilderPdf m={m} />)));
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("PDF för sammanställningar", () => {
  it("Miljonbemannings läge: rubriker, tabellens rader och Totalt, Så räknas det, reglerna och båda målen", async () => {
    const m = await model(as("u-johan", "avtalsansvarig"), "rapporter.byggExport", { savedReportId: "sr-seed-kommun", format: "pdf" });
    const buf = new Uint8Array(await renderToBuffer(<BuilderPdf m={m} />));
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe("%PDF");
    const text = squash(await render(m));
    for (const h of ["SAMMANSTÄLLNING", "MÅL I AVTALET", "SÅ RÄKNAS DET", "RESULTATGRAD PER AVTALSOMRÅDE"]) expect(text.toUpperCase()).toContain(h);
    for (const r of m.table!.rows) expect(text).toContain(r.group!);
    expect(text).toContain("Totalt");
    for (const r of m.rules) expect(text).toContain(r);
    expect(text).toContain("Avtalets mål");
    expect(text).toContain("Internt mål");
    expect(text).toContain("332026110");
    const t = builderPdfTable(m);
    expect(t.cols.map((c) => c.label)).toEqual(["Avtalsområde", ...m.table!.columns.map((c) => c.label)]);
    expect(t.foot[0]).toBe("Totalt");
    expect(looksLikePnr(text)).toBe(false);
  });
  it("kommunen hämtar inga sammanställningar (beslut 2026-10-07) – och PDF:en nämner inte skyddade personuppgifter", async () => {
    await expect(rt.run("command", "rapporter.byggExport", { savedReportId: "sr-seed-kommun", format: "pdf" }, as("k-maria", "kommun_handlaggare"))).rejects.toThrow();
    await expect(rt.run("command", "kommun.deladExport", { savedReportId: "sr-seed-kommun", format: "pdf" }, as("k-maria", "kommun_handlaggare"))).rejects.toThrow();
    const m = await model(as("u-sara", "samordnare"), "rapporter.byggExport", { savedReportId: "sr-seed-kommun", format: "pdf" });
    expect(squash(await render(m))).not.toMatch(/skyddade personuppgifter/i);
  });
});
