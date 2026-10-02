"use client";
// Rapporter från Miljonbemanning (/portal/resultat/rapporter/:savedReportId?) – kommunens chef (rapporter steg 4).
// Listan: rapporter som Miljonbemanning har delat. En rapport: kommandot kommun.delad körs en gång per sidvisning (loggas som
// visning) och visar rapporten med chefens egen behörighet (sin enhet, "färre än 5", inget internt mål). Chefen kan inte ändra
// något – inte urval, uppdelning eller period – bara hämta filen. Ingen ny menyrad: "Hämta resultat" är aktiv på undersidorna.
import { useEffect, useRef, useState } from "react";
import { fmtDateFull } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Link } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, ErrorNotice, Kv, Loading, Notice, Stack } from "@/ui";
import { BuilderExplain, BuilderViewPanel, DownloadStatus, ListColumns, useBuilderDownload } from "../../rapporter/components/builder-view";
import { RadioCards } from "../../rapporter/components/radio-cards";
import { sharedReport, sharedReportExport, sharedReports, type SharedReportView } from "../api";
import { KomHead, KomPage } from "./parts";

const NOT_FOR_CONTRACT = "Den här sidan finns inte för ert avtal.";

export function PortalDeladeScreen({ params }: ScreenProps) {
  return params.savedReportId ? <SharedReport id={params.savedReportId} /> : <SharedList />;
}

function SharedList() {
  const q = useQuery(sharedReports, {});
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  if (!q.data.allowed) {
    return (
      <KomPage>
        <KomHead title="Rapporter från Miljonbemanning" />
        <Notice tone="info" title={NOT_FOR_CONTRACT} />
      </KomPage>
    );
  }
  const rows = q.data.reports;
  return (
    <KomPage>
      <KomHead
        title="Rapporter från Miljonbemanning"
        lead="Här finns rapporter som Miljonbemanning har gjort åt dig. De visar bara deltagare i din enhet."
        back={{ label: "Tillbaka till Hämta resultat", to: "/portal/resultat" }}
      />
      {rows.length === 0 ? (
        <Card>
          <Stack>
            <p>Miljonbemanning har inte delat några rapporter med dig.</p>
            <span>
              <Button icon="arrow-left" to="/portal/resultat">
                Tillbaka till Hämta resultat
              </Button>
            </span>
          </Stack>
        </Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <Stack gap="sm">
                  <h2 className="m-0 text-h2 font-extrabold [overflow-wrap:anywhere]">{r.title}</h2>
                  <p className="m-0">{r.outputLabel}</p>
                  <p className="m-0 text-text-muted">{[r.periodLabel, r.sharedAt ? `Delad ${fmtDateFull(r.sharedAt)}` : null].filter(Boolean).join(" · ")}</p>
                  <span>
                    <Button iconRight="arrow-right" to={`/portal/resultat/rapporter/${r.id}`} ariaLabel={`Öppna rapporten ${r.title}`}>
                      Öppna rapporten
                    </Button>
                  </span>
                </Stack>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </KomPage>
  );
}

function SharedReport({ id }: { id: string }) {
  const cmd = useCommand(sharedReport);
  const [res, setRes] = useState<SharedReportView | { failed: true } | null>(null);
  const ran = useRef<string | null>(null);
  // En gång per sidvisning (kommandot loggar visningen – som beställarrapporten).
  useEffect(() => {
    if (ran.current === id) return;
    ran.current = id;
    setRes(null);
    cmd.run({ savedReportId: id }).then(setRes, () => setRes({ failed: true }));
  }, [id, cmd]);
  if (!res) return <Loading />;
  if ("failed" in res) {
    return (
      <KomPage>
        <KomHead title="Rapporter från Miljonbemanning" back={{ label: "Tillbaka till rapporterna", to: "/portal/resultat/rapporter" }} />
        <Notice tone="critical" title="Rapporten kunde inte visas. Försök igen om en stund." />
      </KomPage>
    );
  }
  if (!res.allowed) {
    return (
      <KomPage>
        <KomHead title="Rapporter från Miljonbemanning" />
        <Notice tone="info" title={NOT_FOR_CONTRACT} />
      </KomPage>
    );
  }
  if (!res.found) {
    return (
      <KomPage>
        <KomHead title="Rapporter från Miljonbemanning" />
        <Notice tone="info" title={res.error ?? "Rapporten finns inte längre. Miljonbemanning kan ha slutat dela den."} />
        <p>
          <Link to="/portal/resultat/rapporter" className="underline">
            Tillbaka till rapporterna
          </Link>
        </p>
      </KomPage>
    );
  }
  return <SharedReportBody id={id} res={res} />;
}

function SharedReportBody({ id, res }: { id: string; res: SharedReportView }) {
  const exportCmd = useCommand(sharedReportExport);
  const dl = useBuilderDownload();
  const v = res.view;
  const isList = !!v?.list;
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");
  return (
    <KomPage>
      <KomHead
        title={res.title}
        lead="Rapporten visar ärenden i din enhet. Siffrorna kommer från levererade rapporter."
        back={{ label: "Tillbaka till rapporterna", to: "/portal/resultat/rapporter" }}
      />
      {res.error && <Notice tone="warn" title={res.error} />}
      {v && (
        <>
          <Card>
            <Kv items={[["Period", v.periodLabel], ["Uppgifter", v.datasetLabel], ["Antal deltagare", v.counts.casesText]]} />
          </Card>
          {isList ? (
            <Card>
              <Stack>
                <p>Rapporten är en lista med en rad per deltagare. Listan finns bara i filen.</p>
                <p className="font-bold">
                  Filen har {v.list!.rows} {v.list!.rows === 1 ? "rad" : "rader"} för {v.list!.cases} deltagare.
                </p>
                <ListColumns columns={v.list!.columns} />
                {v.list!.hasNames && (
                  <Notice tone="warn" title="Filen innehåller namn">
                    Spara filen bara där kommunen får spara personuppgifter. Skicka den inte med vanlig e-post. Varje hämtning sparas i Miljonbemannings logg.
                  </Notice>
                )}
                <BuilderExplain view={v} headingLevel={2} />
              </Stack>
            </Card>
          ) : (
            <Card>
              <BuilderViewPanel view={v} title={res.title} headingLevel={2} portal />
            </Card>
          )}
          <Card>
            <Stack>
              <RadioCards
                name="kom-delad-format"
                legend="Hämta rapporten som"
                value={format}
                onChange={(x) => setFormat(x as "xlsx" | "csv" | "pdf")}
                options={[
                  { value: "xlsx", label: "Excel (rekommenderas)", help: "En fil med flikarna Rapport och Om rapporten." },
                  { value: "csv", label: "CSV", help: "För statistikprogram." },
                  ...(isList ? [] : [{ value: "pdf", label: "PDF", help: "För att skriva ut eller spara rapporten." }]),
                ]}
              />
              <span>
                <Button kind="primary" icon="download" pending={!!dl.busy} onClick={() => void dl.fetchFile(format, () => exportCmd.run({ savedReportId: id, format }))}>
                  Hämta
                </Button>
              </span>
              <DownloadStatus done={dl.done} error={dl.error} />
            </Stack>
          </Card>
        </>
      )}
      <p className="text-text-muted">Varje visning och hämtning sparas i Miljonbemannings logg.</p>
    </KomPage>
  );
}
