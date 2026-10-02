// PDF:erna (react-pdf) byggs av samma vy-modell som HTML-pappret: varje rapporttyp renderas till en buffer i Node från
// testdatat (börjar med %PDF, minst en sida, metadata), innehåller samma rubriker och texter som pappret, och aldrig något
// som liknar ett personnummer. Den renderade PDF:en kontrolleras också (pdf-text.ts – det som faktiskt ritas): kryssen,
// långa texter som bryts mellan sidor, kolumnrubriker på varje sida, etiketten för en rapport som inte är levererad och
// veckodagen från avtalet.
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { decodeTestPnr } from "@/data/seed/pnr";
import { reportDocument, type ReportDocResult, type ReportDocView } from "../api";
import { ReportDocument } from "../components/report-document";
import { metaTitle, ReportPdf } from "./documents";
import { pdfPages, pdfText as renderedText, type PdfPage } from "./pdf-text";
import { DRAFT_WATERMARK } from "./primitives";
import { registerPdfFonts } from "./theme";

let rt: MemoryRuntime;
beforeAll(() => {
  rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
  registerPdfFonts();
});
const as = (userId: string, role: Role): Actor => listPersonas(rt.raw()).find((p) => p.actor.userId === userId && p.actor.role === role)!.actor;
async function docOf(reportId: string, actor: Actor): Promise<ReportDocView> {
  const res = (await rt.run("query", reportDocument.key, { reportId }, actor)) as ReportDocResult;
  if (!res.ok) throw new Error(`${reportId}: ${res.reason}`);
  return res.doc;
}
const weeklyMaria = () => rt.store.rows("reports").find((r) => r.kind === "weekly_attendance" && r.recipientUserId === "k-maria" && r.week === "2027-W03")!.id;
const orderId = () => rt.store.rows("reports").find((r) => r.kind === "order_confirmation" && r.caseId === "case-260143")!.id;

// ---------------------------------------------------------------- Texten i PDF:en (react-pdf-trädet)
/** All text i PDF-trädet: en rad per Text-element (inbäddade Text sätts ihop), i dokumentets ordning. Sidnumret (render) är inte med. */
function pdfText(node: ReactNode): string[] {
  const out: string[] = [];
  const inline = (n: ReactNode): string => {
    if (n == null || typeof n === "boolean") return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(inline).join("");
    if (isValidElement(n)) {
      const el = n as ReactElement<{ children?: ReactNode }>;
      if (typeof el.type === "function") return inline((el.type as (p: unknown) => ReactNode)(el.props));
      return inline(el.props.children);
    }
    return "";
  };
  const walk = (n: ReactNode) => {
    if (n == null || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<{ children?: ReactNode }>;
    if (typeof el.type === "function") return walk((el.type as (p: unknown) => ReactNode)(el.props));
    if (el.type === "TEXT") {
      out.push(inline(el.props.children));
      return;
    }
    if ((el.type as unknown) === Fragment || typeof el.type === "string") walk(el.props.children);
  };
  walk(node);
  return out.filter((t) => t.trim() !== "");
}
const squash = (s: string) => s.replace(/\s+/g, "");

/** jsdom (finns som utvecklingsberoende, utan typer) – bara för att läsa HTML-pappret. */
type Dom = { window: { document: Document } };
let JSDOM: new (html: string) => Dom;
beforeAll(async () => {
  const name = "jsdom";
  JSDOM = ((await import(/* @vite-ignore */ name)) as { JSDOM: typeof JSDOM }).JSDOM;
});

/** Texterna i HTML-pappret (rubriker, stycken, tabellceller, nyckel–värde, listor och informationsblocket). sr-only räknas inte. */
function htmlBlocks(doc: ReportDocView): string[] {
  const dom = new JSDOM(renderToStaticMarkup(<ReportDocument doc={doc} />));
  const d = dom.window.document;
  d.querySelectorAll(".sr-only").forEach((e) => e.remove());
  return [...d.querySelectorAll("h1, h2, h3, p, th, td, dt, dd, li, .text-right > div, [data-print=paper] > div")]
    .map((e) => (e.textContent ?? "").trim())
    .filter(Boolean);
}

const PNR_LIKE = [/\b(19|20)?\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[-+]\d{4}\b/, /\b(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{4}\b/];

// ---------------------------------------------------------------- Fallen
type Case = { name: string; id: () => string; actor: () => Actor; delivered: boolean };
const CASES: Case[] = [
  { name: "månadsrapport, utkast (Nadia januari)", id: () => "rep-16011", actor: () => as("u-amira", "coach"), delivered: false },
  { name: "månadsrapport, levererad (Nadia december, ögonblicksbild)", id: () => "rep-16008", actor: () => as("k-maria", "kommun_handlaggare"), delivered: true },
  { name: "slutrapport, levererad", id: () => "rep-16258", actor: () => as("u-sara", "samordnare"), delivered: true },
  { name: "veckorapport, väntar på närvaro (med skyddat ärende)", id: () => "rep-16692", actor: () => as("u-sara", "samordnare"), delivered: false },
  { name: "veckorapport, levererad, kommunens vy", id: weeklyMaria, actor: () => as("k-maria", "kommun_handlaggare"), delivered: true },
  { name: "orderbekräftelse", id: orderId, actor: () => as("u-sara", "samordnare"), delivered: true },
  { name: "beställarrapport, levererad", id: () => "rep-16698", actor: () => as("k-eva", "kommun_chef"), delivered: true },
  { name: "beställarrapport, utkast", id: () => "rep-16699", actor: () => as("u-johan", "avtalsansvarig"), delivered: false },
];

describe("PDF för varje rapporttyp", () => {
  const pnrs = () => rt.store.rows("persons").map((p) => (p.personnummerEnc ? decodeTestPnr(p.personnummerEnc) : "")).filter(Boolean);

  for (const c of CASES) {
    it(`${c.name}: renderas till en PDF med metadata, samma texter som pappret och inga personnummer`, async () => {
      const doc = await docOf(c.id(), c.actor());
      const buf = await renderToBuffer(<ReportPdf doc={doc} />);
      expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const raw = buf.toString("latin1");
      expect((raw.match(/\/Type \/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(1);
      expect(raw).toContain("/Lang (sv)");
      expect(raw).toMatch(/\/Author/);
      // Metadata: rubrik och ärendenummer – aldrig namn.
      const title = metaTitle(doc);
      if ("participant" in doc) expect(title).not.toContain(doc.participant);
      expect(title).toMatch(/^(Månadsrapport|Slutrapport|Veckorapport närvaro|Orderbekräftelse|Beställarrapport)/);

      const texts = pdfText(<ReportPdf doc={doc} />);
      const all = texts.join("\n");
      // Samma rubriker och texter som HTML-pappret (whitespace räknas inte).
      const flat = squash(texts.join(""));
      const missing = htmlBlocks(doc).filter((b) => !flat.includes(squash(b)));
      expect(missing).toEqual([]);
      // Vattenstämpeln bara på rapporter som inte är levererade.
      expect(all.includes(DRAFT_WATERMARK)).toBe(!c.delivered);
      expect(all).toContain("Miljonbemanning AB · Miljonmatch");
      // Inga personnummer – varken i PDF-texten eller i dokumentet den byggs av.
      const json = JSON.stringify(doc);
      for (const re of PNR_LIKE) {
        expect(all).not.toMatch(re);
        expect(json).not.toMatch(re);
      }
      for (const p of pnrs()) {
        expect(squash(all)).not.toContain(p.replace(/\D/g, "").slice(-10));
      }
    }, 30_000);
  }

  it("namn med tecken utanför latin (ž, ć, ı) ritas med reservtypsnittet", async () => {
    const doc = await docOf("rep-16011", as("u-amira", "coach"));
    const buf = await renderToBuffer(<ReportPdf doc={{ ...doc, participant: "Emir Hodžić Aydın" } as ReportDocView} />);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    // Två typsnitt (latin och latin-ext) är inbäddade.
    expect((buf.toString("latin1").match(/\/FontFile2/g) ?? []).length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});

// ---------------------------------------------------------------- Den renderade PDF:en
const render = async (doc: ReportDocView): Promise<Uint8Array> => new Uint8Array(await renderToBuffer(<ReportPdf doc={doc} />));
const isFooter = (t: string) => /^(Miljonbemanning AB · Miljonmatch|Sida \d+ av \d+)$/.test(t.trim());
const WATERMARK_TEXT = DRAFT_WATERMARK.toUpperCase();
/** Raderna i själva innehållet (inte sidfoten eller vattenstämpeln), med sidnummer. */
const bodyLines = (pages: PdfPage[]) =>
  pages.flatMap((p, i) => p.lines.filter((l) => !isFooter(l.text) && l.text.trim() !== WATERMARK_TEXT).map((l) => ({ ...l, page: i + 1 })));

describe("den renderade PDF:en", () => {
  it("kryssen i avsnitt 3 ritas – ett X per genomförd aktivitetstyp (månadsrapport och slutrapport)", async () => {
    for (const [id, actor] of [["rep-16008", as("k-maria", "kommun_handlaggare")], ["rep-16258", as("u-sara", "samordnare")]] as const) {
      const doc = await docOf(id, actor);
      if (doc.kind !== "monthly" && doc.kind !== "final") throw new Error(id);
      const done = doc.m.activities.types.filter((t) => doc.m.activities.done.includes(t)).length;
      expect(done, id).toBeGreaterThan(0);
      const pages = pdfPages(await render(doc));
      expect(bodyLines(pages).filter((l) => l.text === "X").length, id).toBe(done);
    }
  }, 30_000);

  it("lång sammanfattning (4000 tecken) och avvikelse (3 × 2000 tecken): all text kommer med och inget rinner ut över sidfoten", async () => {
    const doc = await docOf("rep-16008", as("k-maria", "kommun_handlaggare"));
    if (doc.kind !== "monthly" || !doc.m.assessment) throw new Error("rep-16008");
    // Ord som går att känna igen ("S000xxxxx S001xxxxx …"), så att det syns exakt vad som saknas.
    const long = (p: string, n: number) => Array.from({ length: n / 10 }, (_, i) => `${p}${String(i).padStart(3, "0")}xxxxx`).join(" ");
    const dv = doc.m.deviations;
    const item = { id: "dv-lang", date: "4 januari", status: "Öppen", follow: "Följs upp 1 februari", description: long("D", 2000), assessment: long("A", 2000), action: long("T", 2000) };
    const big = { ...doc, m: { ...doc.m, assessment: { ...doc.m.assessment, summary: long("S", 4000) }, deviations: { ...dv, items: [item, ...dv.items] } } } as ReportDocView;
    const pages = pdfPages(await render(big));
    const flat = squash(pages.flatMap((p) => p.lines.map((l) => l.text)).join(""));
    for (const p of ["S", "D", "A", "T"]) {
      const n = p === "S" ? 400 : 200;
      const missing = Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(3, "0")}xxxxx`).filter((w) => !flat.includes(w));
      expect(missing, p).toEqual([]);
    }
    // Inget ritas i sidfotens område eller utanför sidan (sidfoten: 26 pt från nederkanten, innehållet slutar 58 pt upp).
    const low = bodyLines(pages).filter((l) => l.y < 50 || l.y > 842);
    expect(low).toEqual([]);
    pages.forEach((p, i) => expect(p.lines.map((l) => l.text)).toContain(`Sida ${i + 1} av ${pages.length}`));
    // Ett avsnitts rubrik hamnar aldrig ensam sist på en sida.
    for (const [i, p] of pages.entries()) {
      if (i === pages.length - 1) continue;
      const lines = bodyLines([p]);
      const last = lines.reduce((a, b) => (b.y < a.y ? b : a));
      expect(last.text, `sida ${i + 1}`).not.toMatch(/^\d\. [A-ZÅÄÖ ]+/);
    }
  }, 30_000);

  it("tabellens kolumnrubriker upprepas överst på nästa sida (veckorapporten med 28 deltagare)", async () => {
    const doc = await docOf("rep-16692", as("u-sara", "samordnare"));
    const pages = pdfPages(await render(doc));
    expect(pages.length).toBeGreaterThan(2);
    const top = (p: PdfPage) => bodyLines([p]).reduce((a, b) => (b.y > a.y ? b : a)).text;
    // Sida 2 börjar med sammanfattningstabellens rubrikrad, inte mitt i en deltagarrad.
    expect(top(pages[1])).toBe("Deltagare");
    expect(bodyLines([pages[1]]).filter((l) => l.y > bodyLines([pages[1]]).reduce((a, b) => (b.y > a.y ? b : a)).y - 30).map((l) => l.text)).toEqual(
      expect.arrayContaining(["Deltagare", "Närvaro", "Risk"]),
    );
  }, 30_000);

  it("godkänd men inte levererad: etiketten \"Utkast – inte levererad\" står i antracit överst, inte bara i vattenstämpeln", async () => {
    const approved = rt.store.rows("reports").find((r) => r.kind === "monthly" && r.status === "approved")!;
    const doc = await docOf(approved.id, as("u-sara", "samordnare"));
    const first = pdfPages(await render(doc))[0].lines.filter((l) => l.text.trim() === WATERMARK_TEXT);
    // Etiketten (vågrät, överst) och vattenstämpeln.
    expect(first).toHaveLength(2);
    const delivered = renderedText(await render(await docOf("rep-16008", as("k-maria", "kommun_handlaggare"))));
    expect(delivered).not.toContain(WATERMARK_TEXT);
  }, 30_000);

  it("veckorapportens fasta text: veckodagen och klockslaget kommer från avtalet (sla veckorapport_publicering)", async () => {
    const original = structuredClone(rt.store.getRow("contracts", "c-bot")!.config);
    const sla = original.sla!.map((r) => (r.key === "veckorapport_publicering" ? { ...r, weekday: 1, time: "12:00" } : r));
    rt.store.updateRow("contracts", "c-bot", { config: { ...original, sla } });
    try {
      const doc = await docOf(weeklyMaria(), as("k-maria", "kommun_handlaggare"));
      const want = "senast tisdag klockan 12.00 för föregående vecka";
      expect(squash(renderedText(await render(doc)))).toContain(squash(want));
      expect(squash(htmlBlocks(doc).join(" "))).toContain(squash(want));
    } finally {
      rt.store.updateRow("contracts", "c-bot", { config: original });
    }
    const doc = await docOf(weeklyMaria(), as("k-maria", "kommun_handlaggare"));
    expect(squash(renderedText(await render(doc)))).toContain(squash("senast måndag klockan 16.00 för föregående vecka"));
  }, 30_000);
});
