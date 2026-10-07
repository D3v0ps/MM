"use client";
// Resultatfil för hela avtalet (/rapportbyggare/resultatfil, ?fran=&till=&avtal=) – Miljonbemannings färdigrapport för alla
// ärenden i avtalet. Avtalsansvarig lämnar filen till kommunen utanför Miljonmatch (kommunen hämtar den inte själv sedan
// 2026-10-07). Filen byggs och loggas på servern (rapporter.resultatfilExport → export.results_mb, med kolumnspärren) –
// skärmen sparar bara filen.
import { useState } from "react";
import { base64ToBytes } from "@/core/export/base64";
import { useCommand, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, ErrorNotice, Field, Icon, Loading, Notice, Page, Select, Stack, useDownload } from "@/ui";
import { contractResultExport, contractResultPreview, type ContractResultPreview } from "../api";
import { RadioCards } from "../components/radio-cards";

const MONTH_RE = /^\d{4}-\d{2}$/;
const FAILED = "Filen kunde inte skapas. Försök igen om en stund.";
type Table = "resultat" | "progression" | "handelser" | "avslut" | "faltbeskrivning";
const CSV_FILES: { table: Table; label: string }[] = [
  { table: "resultat", label: "Hämta resultat (CSV)" },
  { table: "progression", label: "Hämta progression (CSV)" },
  { table: "handelser", label: "Hämta händelser (CSV)" },
  { table: "avslut", label: "Hämta avslut (CSV)" },
  { table: "faltbeskrivning", label: "Hämta fältbeskrivning (CSV)" },
];

export function ResultatfilMbScreen({ query }: ScreenProps) {
  const fran = query.get("fran");
  const till = query.get("till");
  const avtal = query.get("avtal") ?? undefined;
  const q = useQuery(contractResultPreview, { contractId: avtal, from: fran && MONTH_RE.test(fran) ? fran : undefined, to: till && MONTH_RE.test(till) ? till : undefined });
  const [last, setLast] = useState<ContractResultPreview | undefined>(q.data);
  if (q.data && q.data !== last) setLast(q.data);
  const d = q.data ?? last;
  if (q.error && !d) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return <Loading />;
  return <Resultatfil d={d} current={q.data ?? null} />;
}

function Resultatfil({ d, current }: { d: ContractResultPreview; current: ContractResultPreview | null }) {
  const nav = useNav();
  const run = useCommand(contractResultExport);
  const download = useDownload();
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const from = current?.from ?? d.from;
  const to = current?.to ?? d.to;
  const ready = !!current && !current.periodError && current.reports > 0;
  const setPeriod = (f: string, t: string) => {
    setDone({});
    setFailed(null);
    nav.replace(path("/rapportbyggare/resultatfil", { fran: f, till: t, avtal: d.contracts.length > 1 ? (d.contractId ?? undefined) : undefined }));
  };
  const fetchFile = async (fmt: "xlsx" | "csv", table?: Table) => {
    const key = fmt === "xlsx" ? "xlsx" : (table ?? "resultat");
    if (busy || !d.contractId || !ready) return;
    setBusy(key);
    setFailed(null);
    try {
      const res = await run.run({ contractId: d.contractId, from, to, format: fmt, ...(table ? { table } : {}) });
      if (!res.ok) {
        setFailed(res.message || FAILED);
        return;
      }
      const content = res.encoding === "base64" ? new Blob([base64ToBytes(res.content).slice()], { type: res.mime }) : res.content;
      const saved = await download(res.filename, content, res.mime);
      if (saved === false) {
        setFailed("Filen sparades inte. Du kan hämta den igen.");
        return;
      }
      setDone((x) => ({ ...x, [key]: res.filename }));
    } catch {
      setFailed(FAILED);
    } finally {
      setBusy(null);
    }
  };
  if (!d.allowed) {
    return (
      <Page title="Resultatfil för hela avtalet" crumbs={[{ label: "Rapportbyggare", to: "/rapportbyggare" }, { label: "Resultatfil för hela avtalet" }]}>
        <Notice tone="info" title="Du har inget avtal i drift att hämta resultat för." />
      </Page>
    );
  }
  const options = d.months.map((m) => ({ value: m.value, label: m.label }));
  return (
    <Page
      title="Resultatfil för hela avtalet"
      lead="Resultatfilen för alla ärenden i avtalet. Avtalsansvarig lämnar den till kommunen utanför Miljonmatch."
      crumbs={[{ label: "Rapportbyggare", to: "/rapportbyggare" }, { label: "Resultatfil för hela avtalet" }]}
    >
      <Card>
        <Stack>
          {d.contracts.length > 1 && (
            <Field id="mb-res-avtal" label="Avtal">
              <Select value={d.contractId ?? ""} options={d.contracts.map((c) => ({ value: c.id, label: c.label }))} onValueChange={(v) => nav.replace(path("/rapportbyggare/resultatfil", { avtal: v }))} />
            </Field>
          )}
          <Field id="mb-res-from" label="Från månad" help="Den första månaden som ska vara med.">
            <Select value={from} options={options} onValueChange={(v) => setPeriod(v, to < v ? v : to)} />
          </Field>
          <Field id="mb-res-to" label="Till månad" help={`Den sista månaden som ska vara med. Du kan välja högst ${d.maxMonths} månader.`} error={current?.periodError ?? undefined}>
            <Select value={to} options={options} onValueChange={(v) => setPeriod(from, v)} />
          </Field>
          {!current ? (
            <p className="text-text-muted" aria-live="polite">
              Räknar månadsrapporterna för perioden …
            </p>
          ) : (
            !current.periodError &&
            (current.reports > 0 ? (
              <p className="font-bold" aria-live="polite">
                För perioden finns {current.reports} {current.reports === 1 ? "månadsrapport" : "månadsrapporter"} för {current.participants} deltagare.
              </p>
            ) : (
              <Notice tone="info" title="Det finns inga levererade månadsrapporter för perioden.">
                Välj en annan period.
              </Notice>
            ))
          )}
          <RadioCards
            name="mb-res-format"
            legend="Filtyp"
            value={format}
            onChange={(v) => { setFormat(v as "xlsx" | "csv"); setDone({}); }}
            options={[
              { value: "xlsx", label: "Excel (rekommenderas)", help: "En fil med flikarna Resultat, Progression, Händelser, Avslut och Om filen." },
              { value: "csv", label: "CSV", help: "För statistikprogram. Varje tabell blir en egen fil som du hämtar en i taget." },
            ]}
          />
          <Notice tone="warn" title="Filen innehåller namn">
            Spara filen bara där Miljonbemanning får spara personuppgifter. Skicka den inte med vanlig e-post. Varje hämtning sparas i loggen.
          </Notice>
          {format === "xlsx" ? (
            <Stack gap="sm">
              <span>
                <Button kind="primary" icon="download" disabled={!ready} pending={busy === "xlsx"} onClick={() => void fetchFile("xlsx")}>
                  Hämta filen
                </Button>
              </span>
              {done.xlsx && (
                <p className="flex items-center gap-1.5 font-bold" role="status">
                  <Icon name="check-circle" />
                  Filen är hämtad: {done.xlsx}
                </p>
              )}
            </Stack>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {CSV_FILES.map((f) => (
                <li key={f.table} className="flex flex-wrap items-center gap-3">
                  <Button icon="download" disabled={!ready} pending={busy === f.table} onClick={() => void fetchFile("csv", f.table)}>
                    {f.label}
                  </Button>
                  {done[f.table] && (
                    <span className="flex items-center gap-1.5 font-bold" role="status">
                      <Icon name="check-circle" />
                      Hämtad
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {failed && <Notice tone="critical" title={failed} />}
        </Stack>
      </Card>
    </Page>
  );
}
