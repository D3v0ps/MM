// PDF:erna (react-pdf) byggs av samma vy-modell som HTML-pappret: varje rapporttyp renderas till en buffer i Node från
// testdatat (börjar med %PDF, minst en sida, metadata), innehåller samma rubriker och texter som pappret, och aldrig något
// som liknar ett personnummer.
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
