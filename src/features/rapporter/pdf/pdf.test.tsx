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
import { pdfMultiUnicodeMappings, pdfPages, pdfText as renderedText, type PdfPage } from "./pdf-text";
import { DRAFT_WATERMARK, P, PdfDocument } from "./primitives";
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
  // Beställarrapporten lämnas till kommunen utanför portalen (beslut 2026-10-07) – avtalsansvarig hämtar PDF:en.
  { name: "beställarrapport, levererad", id: () => "rep-16698", actor: () => as("u-johan", "avtalsansvarig"), delivered: true },
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

// ---------------------------------------------------------------- Beslut 2026-10-07 (synpunkt #10 och #12)
/** Sektionen med rubriken som börjar med `heading` i HTML-pappret. */
function htmlSection(doc: ReportDocView, heading: string): Element {
  const d = new JSDOM(renderToStaticMarkup(<ReportDocument doc={doc} />)).window.document;
  const h = [...d.querySelectorAll("section > h2")].find((e) => (e.textContent ?? "").trim().startsWith(heading));
  if (!h?.parentElement) throw new Error(`${heading} saknas`);
  return h.parentElement;
}
const MONEY_TEXT = /\d\s?kr\b|kronor|värde|pris/i;

describe("orderbekräftelsen och månadsrapportens närvaro (beslut 2026-10-07)", () => {
  it("orderbekräftelsen (HTML och PDF) har inget pris och inget ordervärde – bara omfattningen; samma för kommunen och internt", async () => {
    for (const actor of [as("u-sara", "samordnare"), as("u-johan", "avtalsansvarig"), as("k-maria", "kommun_handlaggare")]) {
      const doc = await docOf(orderId(), actor);
      if (doc.kind !== "order_confirmation") throw new Error(doc.kind);
      const html = htmlBlocks(doc).join("\n");
      const pdf = pdfText(<ReportPdf doc={doc} />).join("\n");
      for (const text of [html, pdf]) {
        expect(text).not.toMatch(MONEY_TEXT);
        expect(text).toContain("Planerad omfattning");
        expect(text).toContain(doc.m.period);
        expect(text).not.toMatch(/Saknas – måste kompletteras/);
      }
      expect(JSON.stringify(doc)).not.toMatch(/"price"/);
      expect(squash(htmlSection(doc, "Insatsen").textContent ?? "")).toContain(squash(`Planerad omfattning${doc.m.period}`));
    }
  });

  it("månadsrapportens avsnitt 2 heter Närvaro och har exakt två rader: perioden och närvarograden (HTML och PDF)", async () => {
    for (const [id, actor] of [["rep-16008", as("k-maria", "kommun_handlaggare")], ["rep-16011", as("u-amira", "coach")]] as const) {
      const doc = await docOf(id, actor);
      if (doc.kind !== "monthly") throw new Error(doc.kind);
      const sec = htmlSection(doc, "2.");
      expect(sec.querySelector("h2")?.textContent?.trim()).toBe("2. Närvaro");
      expect([...sec.querySelectorAll("dt")].map((e) => e.textContent?.trim())).toEqual(["Period", "Närvarograd"]);
      expect(sec.querySelectorAll("table")).toHaveLength(0);
      const dd = [...sec.querySelectorAll("dd")].map((e) => e.textContent?.trim());
      expect(dd[0]).toMatch(/^1–3[01] [a-zåäö]+ \d{4}$/);
      expect(dd[1]).toMatch(/^\d{1,3}\s%$|^–$/);
      expect(sec.textContent).toContain("Närvarograd = ");
      // Veckotabellen, orsakerna och upprepad frånvaro finns inte längre i rapporten (finns internt på fliken Närvaro).
      const all = htmlBlocks(doc).join("\n");
      const pdf = pdfText(<ReportPdf doc={doc} />).join("\n");
      for (const text of [all, pdf]) {
        expect(text).not.toMatch(/Giltig frånvaro per orsak|Upprepad ogiltig frånvaro:|Planerade tillfällen|Närvaro och frånvaro/);
        expect(text).toContain("2. Närvaro");
        expect(text).toContain(dd[1]!);
      }
    }
  });
});

// ---------------------------------------------------------------- Beslut 6 (2026-10-08): slutrapportens närvaro bara som närvarograd
describe("slutrapportens närvaro (beslut 6, 2026-10-08)", () => {
  it("avsnitt 2 heter Närvaro och har exakt två rader: hela perioden och närvarograden – samma i HTML och PDF; risken står kvar i avsnitt 6", async () => {
    for (const actor of [as("u-sara", "samordnare"), as("k-maria", "kommun_handlaggare")]) {
      const doc = await docOf("rep-16258", actor);
      if (doc.kind !== "final") throw new Error(doc.kind);
      const sec = htmlSection(doc, "2.");
      expect(sec.querySelector("h2")?.textContent?.trim()).toBe("2. Närvaro");
      expect([...sec.querySelectorAll("dt")].map((e) => e.textContent?.trim())).toEqual(["Period", "Närvarograd"]);
      expect(sec.querySelectorAll("table")).toHaveLength(0);
      const dd = [...sec.querySelectorAll("dd")].map((e) => e.textContent?.trim());
      expect(dd[0]).toBe(doc.m.period);
      expect(dd[0]).toMatch(/^\d{1,2} [a-zåäö]+ \d{4} – \d{1,2} [a-zåäö]+ \d{4}$/);
      expect(dd[1]).toMatch(/^\d{1,3}\s%$|^–$/);
      expect(sec.textContent).toContain("Närvarograd = ");
      const all = htmlBlocks(doc).join("\n");
      const pdf = pdfText(<ReportPdf doc={doc} />).join("\n");
      for (const text of [all, pdf]) {
        // Inga månadsrader, inga orsaker, inga antal – men risken "Upprepad ogiltig frånvaro" i avsnitt 6 om den finns.
        expect(text).not.toMatch(/Giltig frånvaro per orsak|Upprepad ogiltig frånvaro:|Planerade tillfällen|Närvaro och frånvaro|Totalt/);
        expect(text).toContain("2. Närvaro");
        expect(text).toContain(dd[1]!);
        expect(text).toContain("6. Avvikelse, risk och åtgärd");
        if (doc.m.deviations.repeated.hit) expect(text).toContain("Upprepad ogiltig frånvaro (");
      }
      // Den renderade PDF:en: inget av det borttagna ritas.
      expect(renderedText(await render(doc))).not.toMatch(/Giltig frånvaro per orsak|Planerade tillfällen|Ogiltig frånvaro\b/);
    }
  }, 30_000);
});

// ---------------------------------------------------------------- Fynd 9 (2026-10-08): "fi"-ligaturen i textlagret
describe("textlagret i PDF:en (fynd 9, 2026-10-08)", () => {
  it("varje teckenkod står för exakt ett tecken – ord med fi och fl går att söka och kopiera", async () => {
    const buf = await renderToBuffer(
      <PdfDocument metaTitle="Test" title="Test" info={[["Avtal", "332026110"]]} label={null} watermark={false}>
        <P>Sofia Grahn – certifiering, Yrkesspecifika moment, identifierar, verifierat, flytt och fluga.</P>
      </PdfDocument>,
    );
    const pdf = new Uint8Array(buf);
    expect(pdfMultiUnicodeMappings(pdf)).toEqual([]);
    const text = renderedText(pdf);
    for (const w of ["Sofia", "certifiering", "Yrkesspecifika", "identifierar", "verifierat", "flytt", "fluga"]) expect(text).toContain(w);
    expect(text).not.toContain("\ufb01");
    expect(text).not.toContain("�");
  }, 30_000);

  it("rapporterna (månadsrapport, slutrapport, orderbekräftelse) har inga flerteckensmappningar", async () => {
    for (const [id, actor] of [["rep-16008", as("k-maria", "kommun_handlaggare")], ["rep-16258", as("u-sara", "samordnare")], [orderId(), as("u-sara", "samordnare")]] as const) {
      const pdf = await render(await docOf(id, actor));
      expect(pdfMultiUnicodeMappings(pdf), id).toEqual([]);
      expect(renderedText(pdf), id).not.toContain("�");
    }
  }, 60_000);
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

// ---------------------------------------------------------------- Granskningen inför mötet med Botkyrka (2026-10-13)
/** Värdet efter en etikett (Kv: etiketten och värdet står efter varandra). */
const valueAfter = (texts: string[], label: string) => texts[texts.indexOf(label) + 1];

describe("granskningen av rapporterna (2026-10-13)", () => {
  const KRYSS = "Kryss betyder minst en registrerad aktivitet av typen i en godkänd avstämning.";
  it("månadsrapport och slutrapport (HTML och PDF): ingen intern text om mall 02 – månadsrapporten förklarar kryssen", async () => {
    for (const [id, actor] of [["rep-16008", as("k-maria", "kommun_handlaggare")], ["rep-16011", as("u-amira", "coach")], ["rep-16258", as("u-sara", "samordnare")]] as const) {
      const doc = await docOf(id, actor);
      const html = squash(htmlBlocks(doc).join(" "));
      const pdf = squash(renderedText(await render(doc)));
      for (const t of [html, pdf]) {
        expect(t, id).not.toContain(squash("mall 02"));
        expect(t, id).not.toContain(squash("Aktivitetstyperna är exempel"));
      }
      if (doc.kind === "monthly") {
        expect(html, id).toContain(squash(KRYSS));
        expect(pdf, id).toContain(squash(KRYSS));
      }
    }
  }, 30_000);

  it("beställarrapporten (HTML och PDF): avvikelser med exakt antal (Karims beslut 2026-11-25), ingen rad Mottagare och inga ord om prototypen", async () => {
    const base = await docOf("rep-16698", as("u-johan", "avtalsansvarig"));
    if (base.kind !== "customer_summary") throw new Error("rep-16698");
    // Avtalets text om resultatdefinitionen ("Preliminärt i prototypen: …") står inte längre i rapporten (inga hjälptexter).
    expect("resultNote" in base).toBe(false);
    for (const [deviations, contractDeviations, wantDev, wantContract] of [[2, 3, "2", "3"], [0, 1, "0", "1"], [7, 0, "7", "0"]] as const) {
      const doc = { ...base, m: { ...base.m, deviations, contractDeviations } } as ReportDocView;
      const html = htmlBlocks(doc);
      const pdf = pdfText(<ReportPdf doc={doc} />);
      for (const texts of [html, pdf]) {
        expect(valueAfter(texts, "Avvikelser på deltagarnivå")).toBe(wantDev);
        expect(valueAfter(texts, "Avtalsavvikelser")).toBe(wantContract);
        expect(texts.filter((t) => /^Mottagare\b/.test(t))).toEqual([]);
        expect(texts.join("\n")).not.toMatch(/prototyp/i);
      }
      const rendered = renderedText(await render(doc));
      expect(rendered).not.toMatch(/Mottagare|prototyp/i);
    }
  }, 60_000);

  it("beställarrapportens resultattabell: rubrikraden står aldrig ensam på en sida – rubriken och alla tre raderna hålls ihop", async () => {
    const base = await docOf("rep-16698", as("u-johan", "avtalsansvarig"));
    if (base.kind !== "customer_summary") throw new Error("rep-16698");
    // Fler yrkesområden flyttar resultattabellen nedåt, så att sidbrytningen hamnar före, i och efter tabellen.
    for (let extra = 0; extra <= 14; extra++) {
      const areas = [...base.m.byArea, ...Array.from({ length: extra }, (_, i) => ({ ...base.m.byArea[0], code: `X${i}`, name: `Testområde ${i + 1}` }))];
      const doc = { ...base, m: { ...base.m, byArea: areas } } as ReportDocView;
      const lines = bodyLines(pdfPages(await render(doc)));
      const pagesWith = (t: string) => [...new Set(lines.filter((l) => l.text.trim() === t).map((l) => l.page))];
      const head = pagesWith("Period");
      expect(head, `extra ${extra}`).toHaveLength(1);
      for (const row of ["Rullande 6 månader", "Sedan avtalets start"]) expect(pagesWith(row), `extra ${extra}: ${row}`).toEqual(head);
    }
  }, 120_000);
});

// ---------------------------------------------------------------- Karims beslut 2026-11-25: beställarrapportens innehåll
type SummaryDoc = Extract<ReportDocView, { kind: "customer_summary" }>;
const summaryDoc = async (id: string): Promise<SummaryDoc> => {
  const d = await docOf(id, as("u-johan", "avtalsansvarig"));
  if (d.kind !== "customer_summary") throw new Error(id);
  return d;
};
const withM = (d: SummaryDoc, m: Partial<SummaryDoc["m"]>): SummaryDoc => ({ ...d, m: { ...d.m, ...m } });
/** Tabellens kolumnrubriker och rader i HTML-pappret, i avsnittet som börjar med `heading`. */
const htmlTable = (doc: ReportDocView, heading: string, i = 0) => {
  const t = htmlSection(doc, heading).querySelectorAll("table")[i];
  if (!t) throw new Error(`${heading}: ingen tabell ${i}`);
  return {
    head: [...t.querySelectorAll("th")].map((e) => e.textContent?.trim()),
    rows: [...t.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((e) => e.textContent?.trim())),
  };
};
const htmlKv = (doc: ReportDocView, heading: string) => {
  const sec = htmlSection(doc, heading);
  const dt = [...sec.querySelectorAll("dt")].map((e) => e.textContent?.trim() ?? "");
  const dd = [...sec.querySelectorAll("dd")].map((e) => e.textContent?.trim() ?? "");
  return Object.fromEntries(dt.map((k, i) => [k, dd[i]]));
};
/** PDF-texterna mellan två avsnittsrubriker. */
const pdfBetween = (texts: string[], from: string, to: string) => texts.slice(texts.indexOf(from), texts.indexOf(to) > 0 ? texts.indexOf(to) : undefined);
/** "85,5 %" → 85.5 */
const pctNum = (s: string | undefined) => Number(String(s).replace(/\s|%/g, "").replace(",", "."));

// Texterna som är borttagna ur beställarrapporten (hjälptexter, maskering och avtalsmålet).
const REMOVED = [
  /färre än/i, /Rapporten innehåller inga namn/, /Resultatdefinitionen/, /Preliminärt/, /Minst ett område på nivå/, /räknas inte/i, /redovisas inte/i,
  /Underlag:/, /väntar på verifiering/, /Sammanfattningen skrivs/, /avtalsmål/i, /32\s?%/, /35\s?%/, /Avslut som räknas/, /Jämfört med/, /Planerade tillfällen/,
  /Yrkesspår/, /Avtalsområde/, /Övriga \d+ yrkesspår/, /Inte valt än/, /av deltagarna (med|som)/,
];

describe("beställarrapporten (Karims beslut 2026-11-25): HTML och PDF", () => {
  it("exakta antal med 1–4 deltagare i ett yrkesområde – kolumnen heter Yrkesområde och ingen tabell för yrkesspår", async () => {
    const base = await summaryDoc("rep-16699");
    expect(base.m.byTrack.length).toBeGreaterThan(0);
    const doc = withM(base, {
      active: 7, started: 1, closed: 3,
      byArea: [{ code: "A", name: "A Administration", active: 4, started: 1, closed: 2 }, { code: "B", name: "B Hälsa och sjukvård", active: 3, started: 0, closed: 1 }],
    });
    const t = htmlTable(doc, "1.");
    expect(t.head).toEqual(["Yrkesområde", "Aktiva", "Nya", "Avslutade"]);
    expect(t.rows).toEqual([["A Administration", "4", "1", "2"], ["B Hälsa och sjukvård", "3", "0", "1"]]);
    expect(htmlSection(doc, "1.").querySelectorAll("table")).toHaveLength(1);
    expect(htmlKv(doc, "1.")).toEqual({ "Aktiva under månaden": "7", "Nya insatser": "1", "Avslutade insatser": "3" });
    const pdf = pdfText(<ReportPdf doc={doc} />);
    const sec = pdfBetween(pdf, "1. Deltagare", "2. Resultat");
    expect(sec).toEqual(expect.arrayContaining(["Yrkesområde", "A Administration", "4", "1", "2", "B Hälsa och sjukvård", "3", "0"]));
    expect(valueAfter(pdf, "Aktiva under månaden")).toBe("7");
    for (const text of [htmlBlocks(doc).join("\n"), pdf.join("\n"), renderedText(await render(doc))]) {
      expect(text).not.toMatch(/färre än|Yrkesspår|Avtalsområde/i);
    }
  }, 30_000);

  it("resultattabellen har exakt Period · Resultat (arbete eller studier) · Avbrott – inget avtalsmål, ingen andel och ingen mätare", async () => {
    const doc = await summaryDoc("rep-16699");
    const t = htmlTable(doc, "2.");
    expect(htmlSection(doc, "2.").querySelector("h2")?.textContent?.trim()).toBe("2. Resultat");
    expect(t.head).toEqual(["Period", "Resultat (arbete eller studier)", "Avbrott"]);
    const r = doc.m.result;
    expect(r.month.avbrott).toBeGreaterThan(0);
    expect(t.rows).toEqual([
      ["Januari 2027", String(r.month.num), String(r.month.avbrott)],
      ["Rullande 6 månader", String(r.rolling.num), String(r.rolling.avbrott)],
      ["Sedan avtalets start", String(r.sinceStart.num), String(r.sinceStart.avbrott)],
    ]);
    const sec = htmlSection(doc, "2.");
    expect(sec.querySelectorAll("p, [role=meter], meter, svg")).toHaveLength(0);
    const pdf = pdfBetween(pdfText(<ReportPdf doc={doc} />), "2. Resultat", "3. Progression");
    expect(pdf).toEqual(["2. Resultat", "Period", "Resultat (arbete eller studier)", "Avbrott", ...t.rows.flat()]);
    for (const text of [sec.textContent ?? "", pdf.join("\n")]) expect(text).not.toMatch(/32\s?%|Andel|Avslut som räknas|avtalsmål|Resultatgrad/i);
    expect(renderedText(await render(doc))).not.toMatch(/32\s?%|Avslut som räknas|avtalsmål|Resultatgrad/i);
  }, 30_000);

  it("nöjdhet: antalet svar står alltid; andelen 4–5 bara från pulse.minNForAggregate (5) svar – annars \"–\"", async () => {
    const base = await summaryDoc("rep-16699");
    expect(base.m.minN).toBe(5);
    for (const [responses, satisfaction, want] of [[3, 2 / 3, "–"], [4, 1, "–"], [5, 0.6, "60 %"], [6, 4 / 6, "67 %"], [0, null, "–"]] as const) {
      const doc = withM(base, { pulse: { ...base.m.pulse, responses, satisfaction, enough: responses >= 5 } });
      const kv = htmlKv(doc, "6.");
      expect(Object.keys(kv)).toEqual(["Svarsperiod", "Antal svar", "Andel nöjda (4–5)"]);
      expect(kv["Antal svar"]).toBe(String(responses));
      expect(kv["Andel nöjda (4–5)"]?.replace(/\s/g, " ")).toBe(want);
      expect(kv["Svarsperiod"]).toBe(base.m.pulse.period);
      const pdf = pdfText(<ReportPdf doc={doc} />);
      expect(valueAfter(pdf, "Antal svar")).toBe(String(responses));
      expect(valueAfter(pdf, "Andel nöjda (4–5)").replace(/\s/g, " ")).toBe(want);
      expect(pdfBetween(pdf, "6. Nöjdhet", "7. Sammanfattning")).toHaveLength(7);
    }
  }, 30_000);

  it("närvaron i procent med samma nämnare: närvarograd + giltig + ogiltig frånvaro = 100 % – inga planerade tillfällen och inga antal", async () => {
    const base = await summaryDoc("rep-16699");
    expect(base.m.attendance.unregistered).toBeGreaterThan(0);
    const a = { ...base.m.attendance, present: 300, late: 42, absentValid: 37, absentInvalid: 21, unregistered: 9, planned: 409 };
    for (const [doc, st] of [[base, base.m.attendance], [withM(base, { attendance: a, attendanceRate: (300 + 42) / 400 }), a]] as const) {
      const kv = htmlKv(doc, "4.");
      expect(Object.keys(kv)).toEqual(["Närvarograd", "Giltig frånvaro", "Ogiltig frånvaro"]);
      const reg = st.present + st.late + st.absentValid + st.absentInvalid;
      // En decimal: avrundat till närmaste tiondel.
      expect(Math.abs(pctNum(kv["Giltig frånvaro"]) - (st.absentValid / reg) * 100)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.abs(pctNum(kv["Ogiltig frånvaro"]) - (st.absentInvalid / reg) * 100)).toBeLessThanOrEqual(0.05 + 1e-9);
      const sum = pctNum(kv["Närvarograd"]) + pctNum(kv["Giltig frånvaro"]) + pctNum(kv["Ogiltig frånvaro"]);
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.15);
      for (const v of Object.values(kv)) expect(v).toMatch(/^\d{1,3},\d\s%$/);
      const pdf = pdfText(<ReportPdf doc={doc} />);
      for (const k of Object.keys(kv)) expect(valueAfter(pdf, k)).toBe(kv[k]);
      expect(pdfBetween(pdf, "4. Närvaro", "5. Avvikelser")).toHaveLength(7);
    }
    // Inget registrerat: tre streck.
    const none = withM(base, { attendance: { ...a, present: 0, late: 0, absentValid: 0, absentInvalid: 0, unregistered: 12, planned: 12, rate: null }, attendanceRate: null });
    expect(htmlKv(none, "4.")).toEqual({ Närvarograd: "–", "Giltig frånvaro": "–", "Ogiltig frånvaro": "–" });
    for (const text of [htmlBlocks(base).join("\n"), pdfText(<ReportPdf doc={base} />).join("\n"), renderedText(await render(base))]) expect(text).not.toMatch(/Planerade tillfällen/);
  }, 30_000);

  it("avvikelser: deltagare utan progression och avbrott utan resultat med exakta antal, också 0", async () => {
    const base = await summaryDoc("rep-16699");
    expect(base.m.noProgression).toBe(0);
    expect(base.m.avbrottNoResult).toBeGreaterThan(0);
    for (const [deviations, contractDeviations, noProgression, avbrottNoResult] of [[2, 1, 3, 4], [0, 0, 0, 0], [base.m.deviations, base.m.contractDeviations, base.m.noProgression, base.m.avbrottNoResult]] as const) {
      const doc = withM(base, { deviations, contractDeviations, noProgression, avbrottNoResult });
      const want = { "Avvikelser på deltagarnivå": String(deviations), Avtalsavvikelser: String(contractDeviations), "Deltagare utan progression": String(noProgression), "Avbrott utan resultat": String(avbrottNoResult) };
      expect(htmlKv(doc, "5.")).toEqual(want);
      const pdf = pdfText(<ReportPdf doc={doc} />);
      for (const [k, v] of Object.entries(want)) expect(valueAfter(pdf, k)).toBe(v);
    }
  }, 30_000);

  it("progression utan godkända bedömningar: siffrorna (0) och \"–\" – ingen mening", async () => {
    const base = await summaryDoc("rep-16699");
    const doc = withM(base, { progression: { assessed: 0, clear: 0, areaDist: base.m.progression.areaDist.map((a) => ({ ...a, clear: 0, n: 0 })) } });
    expect(htmlKv(doc, "3.")).toEqual({ "Godkända månadsbedömningar": "0", "Tydlig progression": "0", "Andel med tydlig progression": "–" });
    const t = htmlTable(doc, "3.");
    expect(t.head).toEqual(["Område", "Tydlig progression", "Andel"]);
    expect(t.rows).toEqual(base.m.progression.areaDist.map((a) => [a.label, "0", "–"]));
    expect(htmlSection(doc, "3.").querySelectorAll("p")).toHaveLength(0);
    // Med 3 bedömningar (färre än 5) visas andelen ändå.
    const few = withM(base, { progression: { assessed: 3, clear: 2, areaDist: base.m.progression.areaDist.map((a, i) => ({ ...a, clear: i === 0 ? 2 : 0, n: 3 })) } });
    expect(htmlKv(few, "3.")["Andel med tydlig progression"]?.replace(/\s/g, " ")).toBe("67 %");
  });

  it("ingen av de borttagna texterna står i HTML-pappret, PDF-texten eller den renderade PDF:en (utkast, levererad, små tal)", async () => {
    const jan = await summaryDoc("rep-16699");
    const small = withM(jan, {
      active: 3, started: 1, closed: 2, deviations: 1, progression: { ...jan.m.progression, assessed: 2, clear: 1 },
      pulse: { ...jan.m.pulse, responses: 3, satisfaction: 1, enough: false }, result: { ...jan.m.result, rolling: { ...jan.m.result.rolling, prelim: 2 } },
    });
    for (const doc of [jan, await summaryDoc("rep-16698"), small]) {
      const texts = [htmlBlocks(doc).join("\n"), pdfText(<ReportPdf doc={doc} />).join("\n"), renderedText(await render(doc))];
      for (const text of texts) for (const re of REMOVED) expect(text, `${doc.id}: ${re}`).not.toMatch(re);
    }
    // Utkastet utan sammanfattning: bara ett streck, ingen förklaring.
    expect(jan.m.summary).toBeNull();
    expect(squash(htmlSection(jan, "7.").textContent ?? "")).toBe(squash("7. Sammanfattning–"));
  }, 60_000);

  it("en levererad rapport med en ögonblicksbild från före beslutet (utan avbrott och de nya raderna, med byTrack) visas med \"–\" och utan yrkesspår", async () => {
    const id = "rep-16698";
    const row = rt.store.getRow("reports", id)!;
    const fresh = structuredClone((await summaryDoc(id)).m) as SummaryDoc["m"];
    const { noProgression, avbrottNoResult, ...rest } = fresh;
    void noProgression;
    void avbrottNoResult;
    const strip = (x: SummaryDoc["m"]["result"]["month"]) => ({ value: x.value, num: x.num, den: x.den, prelim: x.prelim });
    const old = { ...rest, result: { ...rest.result, month: strip(rest.result.month), rolling: strip(rest.result.rolling), sinceStart: strip(rest.result.sinceStart) } };
    expect(old.byTrack.length).toBeGreaterThan(0);
    rt.store.updateRow("reports", id, { snapshot: { reportId: id, takenAt: "2027-01-12T10:05", deliveredAt: row.deliveredAt, model: old } });
    try {
      const doc = await summaryDoc(id);
      expect(doc.m).toEqual(old);
      expect(htmlTable(doc, "2.").rows.map((r) => r[2])).toEqual(["–", "–", "–"]);
      const kv = htmlKv(doc, "5.");
      expect(kv["Deltagare utan progression"]).toBe("–");
      expect(kv["Avbrott utan resultat"]).toBe("–");
      const buf = await renderToBuffer(<ReportPdf doc={doc} />);
      expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const pdf = pdfText(<ReportPdf doc={doc} />);
      expect(valueAfter(pdf, "Avbrott utan resultat")).toBe("–");
      const flat = squash(pdf.join(""));
      expect(htmlBlocks(doc).filter((b) => !flat.includes(squash(b)))).toEqual([]);
      for (const text of [htmlBlocks(doc).join("\n"), pdf.join("\n"), renderedText(new Uint8Array(buf))]) expect(text).not.toMatch(/Yrkesspår|färre än/i);
    } finally {
      rt.store.updateRow("reports", id, { snapshot: row.snapshot });
    }
  }, 30_000);
});
