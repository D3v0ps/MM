"use client";
// Rapportbyggarens vy-modell på skärmen – samma komponenter för Miljonbemanning (förhandsvisningen, den sparade rapporten,
// delningsdialogen) och kommunens chef (/portal/resultat/rapporter/:id, 18 px via portal:-varianterna).
//   <BuilderViewPanel view={view} />   tabellen (Deltagare först, Totalt sist), stapeldiagrammet och "SÅ RÄKNAS DET"
//   useBuilderDownload()                hämtar filen: kommandot loggar först, sedan sparas filen (PDF byggs i webbläsaren)
// Listor med en rad per deltagare visar bara antal och kolumnnamn – raderna finns bara i filen.
import { useId, useState, type ElementType } from "react";
import { base64ToBytes } from "@/core/export/base64";
import { BarChart, barValueText, Icon, Notice, Stack, Table, useDownload, type Column } from "@/ui";
import type { BuilderFileResult, BuilderRow, BuilderView } from "../api";

/** Cellens text: "41,7 %" för andelar, talet för antal, tomt när det inte finns något att räkna på. */
export const cellText = (unit: "antal" | "andel", v: number | null): string => (v == null ? "" : barValueText(unit, v));

/** Tabellen: grupp och tidsdel, Deltagare och måttens kolumner. Raden Totalt sist. Skrollar i sidled i sin egen ruta. */
export function BuilderTable({ view }: { view: BuilderView }) {
  const t = view.table;
  if (!t) return null;
  type R = BuilderRow & { total?: boolean };
  const lead: Column<R>[] = [];
  if (t.groupLabel) lead.push({ key: "group", label: t.groupLabel, render: (r) => (r.total ? <strong>Totalt</strong> : r.group) });
  if (t.splitLabel) lead.push({ key: "period", label: t.splitLabel, nowrap: true, render: (r) => (r.total ? (t.groupLabel ? "" : <strong>Totalt</strong>) : r.period) });
  if (!lead.length) lead.push({ key: "all", label: "Urval", render: (r) => (r.total ? <strong>Totalt</strong> : "Alla") });
  const cols: Column<R>[] = [
    ...lead,
    { key: "deltagare", label: "Deltagare", num: true, nowrap: true, render: (r) => (r.total ? <strong>{r.casesText}</strong> : r.casesText) },
    ...t.columns.slice(1).map((c, i): Column<R> => ({
      key: `c${i}`, label: c.label, num: true, nowrap: true,
      render: (r) => (r.total ? <strong>{cellText(c.unit, r.cells[i])}</strong> : cellText(c.unit, r.cells[i])),
    })),
  ];
  const rows: R[] = [...t.rows, { ...t.total, total: true }];
  return <Table<R> caption={`${view.datasetLabel}, ${view.periodLabel}`} columns={cols} rows={rows} rowKey={(r) => r.key} />;
}

/** Rubriknivån under sidans eller dialogens rubrik: 2 i portalen (under h1), 3 under ett korts h2, 4 i delningsdialogen. */
export type HeadingLevel = 2 | 3 | 4;

/** "SÅ RÄKNAS DET": Deltagare och måttens hjälptexter, noterna och de fasta reglerna. */
export function BuilderExplain({ view, headingLevel = 3 }: { view: BuilderView; headingLevel?: HeadingLevel }) {
  // Unikt id: förhandsvisningen och delningsdialogen kan visa samma läge på samma sida.
  const id = useId();
  const H = `h${headingLevel}` as ElementType;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <H id={id} className="m-0 text-label font-extrabold tracking-[0.08em] uppercase portal:text-body">
        Så räknas det
      </H>
      {view.explain.length > 0 && (
        <dl className="m-0 flex flex-col gap-1.5">
          {view.explain.map((e) => (
            <div key={e.label}>
              <dt className="inline font-bold">{e.label}: </dt>
              <dd className="m-0 inline">{e.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {view.notes.length > 0 && (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          {view.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-text-muted">
        {view.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </section>
  );
}

/** Listans kolumner i klarspråk (registrets beskrivning) med kolumnens namn i filen i liten text efter. */
export function ListColumns({ columns }: { columns: readonly { key: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0">Kolumner i filen:</p>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
        {columns.map((c) => (
          <li key={c.key} className="[overflow-wrap:anywhere]">
            {c.label} <span className="text-small text-text-muted portal:text-body">({c.key})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tabellen, diagrammet och "Så räknas det" – eller listans antal och kolumner. portal = kommunens portal (större text i diagrammet). */
export function BuilderViewPanel({ view, title, headingLevel = 3, portal = false }: { view: BuilderView; title: string; headingLevel?: HeadingLevel; portal?: boolean }) {
  if (view.list) {
    return (
      <Stack gap="sm">
        <p className="font-bold">
          Listan har {view.list.rows} {view.list.rows === 1 ? "rad" : "rader"} för {view.list.cases} deltagare. Raderna finns bara i filen.
        </p>
        <ListColumns columns={view.list.columns} />
        <BuilderExplain view={view} headingLevel={headingLevel} />
      </Stack>
    );
  }
  const chart = view.chart;
  return (
    <Stack>
      <BuilderTable view={view} />
      {chart && (
        <BarChart
          title={`${title}, ${view.periodLabel}`}
          unit={chart.unit}
          bars={chart.bars}
          contractTarget={chart.contractTarget}
          internalTarget={chart.internalTarget ?? null}
          smallText={`färre än ${view.minN}`}
          large={portal}
        />
      )}
      <BuilderExplain view={view} headingLevel={headingLevel} />
    </Stack>
  );
}

// ---------------------------------------------------------------- Hämta filen
type Runner = () => Promise<{ ok: true } & BuilderFileResult | { ok: false; error: string; message?: string }>;

/**
 * Hämtar filen: kommandot bygger och loggar (export.saved_report) på servern, sedan sparas filen med useDownload. PDF:en byggs i
 * webbläsaren av vy-modellen som kommandot returnerade (dynamisk import, så att vanliga sidor inte blir större).
 */
export function useBuilderDownload() {
  const download = useDownload();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchFile = async (key: string, run: Runner, failed = "Filen kunde inte skapas. Försök igen om en stund.") => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const res = await run();
      if (!res.ok) {
        setError(res.message || failed);
        return;
      }
      let saved: unknown;
      if ("pdf" in res) {
        const { renderBuilderPdf } = await import("../pdf/builder-doc");
        saved = await download(res.filename, await renderBuilderPdf(res.pdf), "application/pdf");
      } else {
        const content = res.encoding === "base64" ? new Blob([base64ToBytes(res.content).slice()], { type: res.mime }) : res.content;
        saved = await download(res.filename, content, res.mime);
      }
      if (saved === false) {
        setError("Filen sparades inte. Du kan hämta den igen.");
        return;
      }
      setDone(res.filename);
    } catch {
      setError(failed);
    } finally {
      setBusy(null);
    }
  };
  return { fetchFile, busy, done, error, reset: () => { setDone(null); setError(null); } };
}

/** Raden efter en hämtning: "Filen är hämtad: …" eller felet. */
export function DownloadStatus({ done, error }: { done: string | null; error: string | null }) {
  return (
    <>
      {done && (
        <p role="status" className="flex items-center gap-1.5 font-bold [overflow-wrap:anywhere]">
          <Icon name="check-circle" />
          Filen är hämtad: {done}
        </p>
      )}
      {error && <Notice tone="critical" title={error} />}
    </>
  );
}
