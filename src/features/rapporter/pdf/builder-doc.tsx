// PDF för rapportbyggarens sammanställningar (rapporter steg 4): logotypen överst, högerställt block med avtalet, rapportens
// namn, perioden och "Hämtad", rubriker i versaler, tabellen och "SÅ RÄKNAS DET". Inget diagram (tabellen har alla siffror).
// Byggs i webbläsaren efter att kommandot (rapporter.byggExport eller kommun.deladExport) har loggat hämtningen – samma mönster
// som rapporternas PDF. Laddas med dynamisk import: const { renderBuilderPdf } = await import("../pdf/builder-doc");
import { pdf } from "@react-pdf/renderer";
import type { BuilderRow, BuilderView } from "../builder/run";
import { dtFull } from "../report-helpers";
import { Kv, P, PdfDocument, Sec, Small, Table, type Col } from "./primitives";
import { registerPdfFonts } from "./theme";

export type BuilderPdfModel = BuilderView & { title: string; contractNumber: string; customerName: string; fetchedAt: string };

const pct = (v: number | null) => (v == null ? "" : `${(Math.round(v * 1000) / 10).toFixed(1).replace(".", ",")} %`);
const num = (v: number | null) => (v == null ? "" : String(v));

/** Tabellens kolumner och rader i PDF:en (samma som skärmen: grupp, tidsdel, Deltagare och måttens kolumner, Totalt sist). */
export function builderPdfTable(m: BuilderPdfModel): { cols: Col[]; rows: { key: string; cells: string[] }[]; foot: string[] } {
  const t = m.table;
  if (!t) return { cols: [], rows: [], foot: [] };
  const lead: { label: string; get: (r: BuilderRow, total: boolean) => string }[] = [];
  if (t.groupLabel) lead.push({ label: t.groupLabel, get: (r, total) => (total ? "Totalt" : (r.group ?? "")) });
  if (t.splitLabel) lead.push({ label: t.splitLabel, get: (r, total) => (total ? (t.groupLabel ? "" : "Totalt") : (r.period ?? "")) });
  if (!lead.length) lead.push({ label: "Urval", get: (_r, total) => (total ? "Totalt" : "Alla") });
  const leadW = lead.length === 2 ? 22 : 34;
  const rest = Math.max(8, (100 - leadW * lead.length) / t.columns.length);
  const cols: Col[] = [...lead.map((l) => ({ label: l.label, width: leadW })), ...t.columns.map((c) => ({ label: c.label, width: rest, num: true }))];
  const cells = (r: BuilderRow, total: boolean) => [
    ...lead.map((l) => l.get(r, total)), r.casesText, ...t.columns.slice(1).map((c, i) => (c.unit === "andel" ? pct(r.cells[i]) : num(r.cells[i]))),
  ];
  return { cols, rows: t.rows.map((r) => ({ key: r.key, cells: cells(r, false) })), foot: cells(t.total, true) };
}

export function BuilderPdf({ m }: { m: BuilderPdfModel }) {
  const t = builderPdfTable(m);
  const targets = m.targets ?? [];
  return (
    <PdfDocument
      metaTitle={m.title}
      title={m.title}
      info={[["Avtal", `${m.contractNumber}, ${m.customerName}`], ["Rapport", m.title], ["Period", m.periodLabel], ["Hämtad", dtFull(m.fetchedAt)]]}
    >
      <Kv items={[["Uppgifter", m.datasetLabel], ["Antal deltagare", m.counts.casesText], ["Visning", m.audience === "mb" ? "Miljonbemanning" : "Kommunens chef"]]} />
      <Sec title="Sammanställning">
        <Table cols={t.cols} rows={t.rows} foot={t.foot} />
      </Sec>
      {targets.length > 0 && (
        <Sec title="Mål i avtalet">
          <Kv
            items={targets.flatMap((x) => [
              x.contractTarget != null ? ([`Avtalets mål – ${x.label}`, pct(x.contractTarget)] as const) : null,
              x.internalTarget != null ? ([`Internt mål – ${x.label}`, pct(x.internalTarget)] as const) : null,
            ])}
          />
        </Sec>
      )}
      <Sec title="Så räknas det">
        {m.explain.map((e, i) => (
          <P key={`e${i}`}>
            <P style={{ fontWeight: 700 }}>{`${e.label}: `}</P>
            {e.text}
          </P>
        ))}
        {m.notes.map((n, i) => (
          <Small key={`n${i}`}>{n}</Small>
        ))}
        {m.rules.map((r, i) => (
          <Small key={`r${i}`} muted>
            {r}
          </Small>
        ))}
      </Sec>
    </PdfDocument>
  );
}

/** Sammanställningen som PDF (application/pdf). */
export async function renderBuilderPdf(m: BuilderPdfModel): Promise<Blob> {
  registerPdfFonts();
  return pdf(<BuilderPdf m={m} />).toBlob();
}
