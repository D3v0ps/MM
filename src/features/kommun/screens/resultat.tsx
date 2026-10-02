"use client";
// Hämta resultat (/portal/resultat) – kommunens chef hämtar resultaten från de levererade månadsrapporterna som en fil
// (rapporter steg 3). Tre steg: 1 Period · 2 Filtyp · 3 Hämta. Adressen har bara steget och månaderna (?steg=&fran=&till=).
// Filen byggs och loggas på servern (kommun.resultatExport) – skärmen sparar bara filen (useDownload). Fältbeskrivningen
// för kommunen: docs/RESULTATFIL.md.
//
// Perioden i valen och i "Nästa" kommer alltid från adressen (fran/till). Förhandsfrågans svar gäller bara den period det
// hämtades för: medan svaret för en ny period hämtas visas inga antal och "Nästa" är inaktiv.
import { useEffect, useRef, useState, type RefObject } from "react";
import { base64ToBytes } from "@/core/export/base64";
import { useCommand, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, ErrorNotice, Eyebrow, Field, Icon, Kv, Loading, Notice, Select, Stack, Stepper, cn, useDownload } from "@/ui";
import { navCounts } from "@/features/session/nav-api";
import { resultExport, resultExportPreview, type ResultPreview, type ResultTable } from "../api";
import { KomHead, KomPage } from "./parts";

const STEPS = ["Period", "Filtyp", "Hämta"] as const;
const TITLES = ["Vilken period?", "Vilken filtyp?", "Hämta filen"] as const;
type Format = "xlsx" | "csv";
const FORMATS: { value: Format; label: string; help: string }[] = [
  { value: "xlsx", label: "Excel (rekommenderas)", help: "En fil med flikarna Resultat, Progression, Händelser, Avslut och Om filen." },
  { value: "csv", label: "CSV", help: "För statistikprogram. Varje tabell blir en egen fil som du hämtar en i taget." },
];
const CSV_FILES: { table: ResultTable; label: string }[] = [
  { table: "resultat", label: "Hämta resultat (CSV)" },
  { table: "progression", label: "Hämta progression (CSV)" },
  { table: "handelser", label: "Hämta händelser (CSV)" },
  { table: "avslut", label: "Hämta avslut (CSV)" },
  { table: "faltbeskrivning", label: "Hämta fältbeskrivning (CSV)" },
];
const MONTH_RE = /^\d{4}-\d{2}$/;
const FAILED = "Filen kunde inte skapas. Försök igen om en stund.";

export function PortalResultatScreen({ query }: ScreenProps) {
  const fran = query.get("fran");
  const till = query.get("till");
  const from = fran && MONTH_RE.test(fran) ? fran : undefined;
  const to = till && MONTH_RE.test(till) ? till : undefined;
  const q = useQuery(resultExportPreview, { from, to });
  // Vid byte av månad visas föregående antal tills de nya är hämtade (ingen tom sida emellan).
  const [last, setLast] = useState<ResultPreview | undefined>(q.data);
  if (q.data && q.data !== last) setLast(q.data);
  const d = q.data ?? last;
  if (q.error && !d) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return <Loading />;
  if (!d.allowed) {
    return (
      <KomPage>
        <KomHead title="Hämta resultat" />
        <Notice tone="info" title="Den här sidan finns inte för ert avtal." />
      </KomPage>
    );
  }
  const steg = Number(query.get("steg"));
  return <Resultat d={d} current={q.data ?? null} urlFrom={from} urlTo={to} step={steg >= 1 && steg <= 3 ? steg - 1 : 0} />;
}

type ResultatProps = {
  /** Senaste svaret (kan gälla förra perioden medan den nya hämtas) – bara för avtalet och listan med månader. */
  d: ResultPreview;
  /** Svaret för perioden i adressen, eller null medan det hämtas. Antal, fel och "Nästa" bygger bara på det. */
  current: ResultPreview | null;
  urlFrom: string | undefined;
  urlTo: string | undefined;
  step: number;
};

function Resultat({ d, current, urlFrom, urlTo, step: requested }: ResultatProps) {
  const nav = useNav();
  const download = useDownload();
  const run = useCommand(resultExport);
  const [format, setFormat] = useState<Format>("xlsx");
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const headRef = useRef<HTMLHeadingElement | null>(null);
  // Perioden: adressens månader (förval från servern när adressen saknar dem).
  const from = urlFrom ?? current?.from ?? d.from;
  const to = urlTo ?? current?.to ?? d.to;
  // Steg 2 och 3 kräver en giltig period med minst en rapport (direkt i adressen går annars till steg 1) – enligt svaret för
  // just den här perioden.
  const ready = !!current && !current.periodError && current.reports > 0;
  const step = ready ? requested : 0;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headRef.current?.focus();
  }, [step]);

  const go = (s: number, f = from, t = to) => nav.replace(path("/portal/resultat", { steg: s + 1, fran: f, till: t }));
  const setPeriod = (f: string, t: string) => {
    setDone({});
    setFailed(null);
    setNotSaved(false);
    go(0, f, t);
  };

  const fetchFile = async (fmt: Format, table?: ResultTable) => {
    const key = fmt === "xlsx" ? "xlsx" : (table ?? "resultat");
    if (busy || !d.contractId || !ready) return;
    setBusy(key);
    setFailed(null);
    setNotSaved(false);
    try {
      const res = await run.run({ contractId: d.contractId, from, to, format: fmt, ...(table ? { table } : {}) });
      if (!res.ok) {
        setFailed(res.message || FAILED);
        return;
      }
      const content = res.encoding === "base64" ? new Blob([base64ToBytes(res.content).slice()], { type: res.mime }) : res.content;
      const saved = await download(res.filename, content, res.mime);
      // Inte sparad (tittaren sa nej, eller fel): säg det i stället för "Hämtad". "shown" = prototypen visar CSV-texten i en
      // dialog att kopiera från – filen har då lämnats ut (och loggats).
      if (saved === false) {
        setDone((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== key)));
        setNotSaved(true);
        return;
      }
      setDone((x) => ({ ...x, [key]: res.filename }));
    } catch {
      setFailed(FAILED);
    } finally {
      setBusy(null);
    }
  };

  let body;
  if (step === 0) {
    const options = d.months.map((m) => ({ value: m.value, label: m.label }));
    body = (
      <Stack>
        <Field id="kom-res-from" label="Från månad" help="Den första månaden som ska vara med.">
          <Select value={from} options={options} onValueChange={(v) => setPeriod(v, to < v ? v : to)} />
        </Field>
        <Field id="kom-res-to" label="Till månad" help={`Den sista månaden som ska vara med. Du kan välja högst ${d.maxMonths} månader.`} error={current?.periodError ?? undefined}>
          <Select value={to} options={options} onValueChange={(v) => setPeriod(from, v)} />
        </Field>
        <p>Filen får en rad per deltagare och månad. Bara levererade månadsrapporter kommer med.</p>
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
      </Stack>
    );
  } else if (step === 1) {
    body = (
      <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
        <legend className="sr-only">Filtyp</legend>
        {FORMATS.map((f) => (
          <label
            key={f.value}
            htmlFor={`kom-res-format-${f.value}`}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-mb border-[1.5px] border-line-strong px-4 py-3",
              format === f.value && "border-2 border-antracit bg-bla-ton",
            )}
          >
            <input
              type="radio"
              name="kom-res-format"
              id={`kom-res-format-${f.value}`}
              value={f.value}
              checked={format === f.value}
              aria-labelledby={`kom-res-format-${f.value}-label`}
              aria-describedby={`kom-res-format-${f.value}-help`}
              onChange={() => setFormat(f.value)}
              className="m-0 mt-1 size-5 flex-none accent-antracit"
            />
            <span className="flex flex-col gap-1">
              <span id={`kom-res-format-${f.value}-label`} className="font-bold">
                {f.label}
              </span>
              <span id={`kom-res-format-${f.value}-help`} className="text-text-muted">
                {f.help}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    );
  } else {
    body = (
      <Stack>
        <Kv
          items={[
            ["Period", current?.periodLabel ?? ""],
            ["Antal deltagare", String(current?.participants ?? "")],
            ["Antal rader", String(current?.reports ?? "")],
            ["Filtyp", format === "xlsx" ? "Excel" : "CSV"],
          ]}
        />
        <p>Bara levererade månadsrapporter kommer med. Ärenden med skyddade personuppgifter finns aldrig med.</p>
        <Notice tone="warn" title="Filen innehåller namn">
          Spara filen bara där kommunen får spara personuppgifter. Skicka den inte med vanlig e-post. Varje hämtning sparas i Miljonbemannings logg.
        </Notice>
        {format === "xlsx" ? (
          <Stack gap="sm">
            <span>
              <Button kind="primary" size="lg" icon="download" pending={busy === "xlsx"} onClick={() => void fetchFile("xlsx")}>
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
                <Button icon="download" pending={busy === f.table} onClick={() => void fetchFile("csv", f.table)}>
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
        {failed && (
          <Notice tone="critical" title={failed} />
        )}
        {notSaved && (
          <Notice tone="warn" title="Filen sparades inte.">
            Du kan hämta den igen.
          </Notice>
        )}
        <p>Om en rapport rättas efteråt syns det när du hämtar en ny fil.</p>
      </Stack>
    );
  }

  return (
    <KomPage>
      <KomHead
        title="Hämta resultat"
        lead="Här hämtar du resultaten från månadsrapporterna som en fil. Du kan öppna filen i Excel och göra egna sammanställningar."
      />
      <SharedReportsCard />
      <Stepper steps={STEPS} current={step} ariaLabel="Steg för att hämta resultat" />
      <Card>
        <Stack>
          <Stack gap="sm">
            <Eyebrow>{`Steg ${step + 1} av ${STEPS.length}`}</Eyebrow>
            <h2 tabIndex={-1} ref={headRef as RefObject<HTMLHeadingElement | null>} className="text-h2 font-extrabold tracking-[0.03em] uppercase outline-none portal:text-[1.25rem]">
              {TITLES[step]}
            </h2>
          </Stack>
          {body}
        </Stack>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {step > 0 ? (
          <Button icon="arrow-left" onClick={() => go(step - 1)}>
            Tillbaka
          </Button>
        ) : (
          <span />
        )}
        {step < 2 ? (
          <Button kind="primary" size="lg" iconRight="arrow-right" disabled={!ready} onClick={() => go(step + 1)}>
            Nästa
          </Button>
        ) : (
          <Button
            icon="refresh"
            onClick={() => {
              setDone({});
              setFailed(null);
              setNotSaved(false);
              setFormat("xlsx");
              go(0);
            }}
          >
            Börja om
          </Button>
        )}
      </div>
    </KomPage>
  );
}

/** Rapporter som Miljonbemanning har delat med chefen (rapporter steg 4) – antalet från menyns räknare (navCounts.sharedReports). */
function SharedReportsCard() {
  const q = useQuery(navCounts, {});
  const n = q.data?.sharedReports ?? 0;
  if (n <= 0) return null;
  return (
    <Card>
      <Stack gap="sm">
        <h2 className="m-0 text-h2 font-extrabold tracking-[0.03em] uppercase portal:text-[1.25rem]">Rapporter från Miljonbemanning</h2>
        <p className="m-0">{n === 1 ? `Miljonbemanning har gjort ${n} rapport åt dig.` : `Miljonbemanning har gjort ${n} rapporter åt dig.`}</p>
        <span>
          <Button iconRight="arrow-right" to="/portal/resultat/rapporter">
            {n === 1 ? "Visa rapporten" : "Visa rapporterna"}
          </Button>
        </span>
      </Stack>
    </Card>
  );
}
