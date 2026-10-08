"use client";
// Rapportbyggaren: en sparad rapport (/rapportbyggare/:savedReportId). Förhandsvisningen körs en gång per sidvisning med
// savedReportId – kommandot loggar då saved_report.viewed (beslut 12). ?steg= öppnar byggaren för att ändra rapporten (bara
// ägaren – canEdit). Rapporten delas bara inom Miljonbemanning – aldrig med kommunen (beslut 2026-10-07).
import { useEffect, useRef, useState } from "react";
import { fmtDateFull } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, ErrorNotice, Kv, Loading, Modal, Notice, Page, Stack, toast, useConfirm } from "@/ui";
import { builderExport, builderPreview, savedReport, savedReportArchive, savedReportShare, VISIBILITY_LABEL, type BuilderView, type SavedReportDetail } from "../api";
import { BuilderViewPanel, DownloadStatus, useBuilderDownload } from "../components/builder-view";
import { RadioCards } from "../components/radio-cards";
import { BuilderForSaved } from "./bygg";
import { Sharing, VISIBILITY_ICON } from "./bygg-lista";

type Saved = Extract<SavedReportDetail, { found: true }>;

export function SparadScreen({ params, query }: ScreenProps) {
  const id = params.savedReportId;
  const q = useQuery(savedReport, { savedReportId: id });
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  if (!q.data.found) {
    return (
      <Page title="Sparad rapport" crumbs={[{ label: "Rapportbyggare", to: "/rapportbyggare" }, { label: "Sparad rapport" }]}>
        <Notice tone="info" title="Rapporten finns inte eller så har du inte tillgång till den." />
      </Page>
    );
  }
  const s = q.data;
  const steg = query.get("steg");
  if (steg && s.canEdit && !s.archived) return <BuilderForSaved saved={s} query={query} />;
  return <Saved s={s} justSaved={query.get("sparad") === "1"} lockedStep={!!steg && !s.canEdit} />;
}

function Saved({ s, justSaved, lockedStep }: { s: Saved; justSaved: boolean; lockedStep: boolean }) {
  const confirm = useConfirm();
  const nav = useNav();
  // ?sparad=1: kvittensen visas (toast och rutan) och tas bort ur adressen – Tillbaka och omladdning visar den inte igen.
  const [savedNow] = useState(justSaved);
  useEffect(() => {
    if (!justSaved) return;
    toast("Rapporten är sparad.");
    nav.replace(path(`/rapportbyggare/${s.id}`));
  }, [justSaved, nav, s.id]);
  const preview = useCommand(builderPreview);
  const exportCmd = useCommand(builderExport);
  const shareCmd = useCommand(savedReportShare);
  const archiveCmd = useCommand(savedReportArchive);
  const dl = useBuilderDownload();
  const [res, setRes] = useState<{ view: BuilderView } | { error: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareChoice, setShareChoice] = useState<string>(s.visibility);
  const [actionError, setActionError] = useState<string | null>(null);
  const ran = useRef(false);
  const valid = !s.definitionError && !s.archived;
  // En gång per sidvisning (loggas som visning av den sparade rapporten).
  useEffect(() => {
    if (!valid || ran.current) return;
    ran.current = true;
    preview.run({ savedReportId: s.id }).then(
      (r) => setRes(r.ok ? { view: r as unknown as BuilderView } : { error: r.message || "Rapporten kunde inte visas." }),
      () => setRes({ error: "Rapporten kunde inte visas. Försök igen om en stund." }),
    );
  }, [s.id, valid, preview]);
  const cur = res;
  // Den sparade definitionen (kan vara ogiltig – då visas definitionError): bara visningssättet.
  const isList = s.definition.output === "lista";

  const share = async (visibility: "private" | "mb") => {
    setActionError(null);
    try {
      const r = await shareCmd.run({ savedReportId: s.id, visibility });
      if (!r.ok) setActionError(r.message ?? "Delningen kunde inte ändras.");
      else if (visibility !== s.visibility) toast(visibility === "mb" ? "Rapporten är delad med alla på Miljonbemanning i avtalet." : "Rapporten syns bara för dig.");
      setSharing(false);
    } catch {
      setActionError("Delningen kunde inte ändras. Försök igen om en stund.");
    }
  };
  const archive = async () => {
    const yes = await confirm({ title: "Arkivera rapporten?", body: "Rapporten visas inte längre i listorna.", confirmLabel: "Arkivera", cancelLabel: "Avbryt", tone: "danger" });
    if (!yes) return;
    setActionError(null);
    try {
      const r = await archiveCmd.run({ savedReportId: s.id });
      if (!r.ok) setActionError(r.message ?? "Rapporten kunde inte arkiveras.");
    } catch {
      setActionError("Rapporten kunde inte arkiveras. Försök igen om en stund.");
    }
  };
  const fetchFile = (format: "xlsx" | "csv" | "pdf") => void dl.fetchFile(format, () => exportCmd.run({ savedReportId: s.id, format }));

  return (
    <Page title={s.title} crumbs={[{ label: "Rapportbyggare", to: "/rapportbyggare" }, { label: s.title }]}>
      {savedNow && <Notice tone="ok" title="Rapporten är sparad." />}
      {s.archived && <Notice tone="info" title="Rapporten är arkiverad." />}
      {lockedStep && s.lockedText && <Notice tone="info" title={s.lockedText} />}
      {!lockedStep && !s.archived && !s.isOwner && s.lockedText && <p className="text-text-muted">{s.lockedText}</p>}
      <Card>
        <Kv
          items={[
            ["Uppgifter", s.datasetLabel || "–"],
            ["Visas som", s.outputLabel || "–"],
            ["Period", s.periodText || "–"],
            ["Delning", <Sharing key="d" visibility={s.visibility} />],
            ["Skapad av", `${s.createdBy}, ${fmtDateFull(s.createdAt)}`],
            s.updatedAt ? ["Ändrad", fmtDateFull(s.updatedAt)] : null,
          ]}
        />
      </Card>
      {actionError && <Notice tone="critical" title={actionError} />}
      {!s.archived && (
        <div className="flex flex-wrap gap-3">
          {s.canEdit && (
            <Button icon="edit" to={path(`/rapportbyggare/${s.id}`, { steg: 2 })}>
              Ändra rapporten
            </Button>
          )}
          <Button icon="copy" to={path("/rapportbyggare/ny", { kopia: s.id })}>
            Gör en kopia
          </Button>
          {s.canChangeSharing && (
            <Button icon="users" onClick={() => { setShareChoice(s.visibility); setSharing(true); }}>
              Ändra delning
            </Button>
          )}
          {s.canArchive && (
            <Button kind="danger" icon="minus-circle" onClick={() => void archive()}>
              Arkivera rapporten
            </Button>
          )}
        </div>
      )}
      {/* Hämta överst – man ska inte behöva skrolla förbi tabellen för att få filen. */}
      {valid && (
        <div className="flex flex-wrap items-center gap-3">
          <Button icon="download" pending={dl.busy === "xlsx"} onClick={() => fetchFile("xlsx")}>
            Hämta som Excel
          </Button>
          <Button icon="download" pending={dl.busy === "csv"} onClick={() => fetchFile("csv")}>
            Hämta som CSV
          </Button>
          {!isList && (
            <Button icon="download" pending={dl.busy === "pdf"} onClick={() => fetchFile("pdf")}>
              Hämta som PDF
            </Button>
          )}
          <DownloadStatus done={dl.done} error={dl.error} />
        </div>
      )}
      {s.definitionError && !s.archived ? (
        <Notice tone="warn" title={`Rapporten behöver ändras innan den kan visas. ${s.definitionError}`}>
          {s.canEdit && (
            <Button to={path(`/rapportbyggare/${s.id}`, { steg: 2 })} icon="edit">
              Ändra rapporten
            </Button>
          )}
        </Notice>
      ) : (
        !s.archived && (
          <Card>
            <Stack>
              <h2 className="text-h2 font-extrabold tracking-[0.03em] uppercase">Rapporten</h2>
              {!cur ? <Loading /> : "error" in cur ? <Notice tone="critical" title={cur.error} /> : null}
              {/* Alltid på sidan (levande region): skärmläsaren hör antalet när rapporten är klar. */}
              <p role="status" className="m-0 font-bold empty:sr-only">
                {cur && "view" in cur ? `${cur.view.counts.casesText} deltagare, ${cur.view.periodLabel}` : ""}
              </p>
              {cur && "view" in cur && <BuilderViewPanel view={cur.view} title={s.title} headingLevel={3} />}
            </Stack>
          </Card>
        )
      )}
      {sharing && (
        <Modal
          title="Ändra delning"
          onClose={() => setSharing(false)}
          footer={
            <div className="flex flex-wrap justify-end gap-3">
              <Button onClick={() => setSharing(false)}>Avbryt</Button>
              <Button kind="primary" pending={shareCmd.pending} onClick={() => void share(shareChoice === "mb" ? "mb" : "private")}>
                Spara delningen
              </Button>
            </div>
          }
        >
          <RadioCards
            name="sparad-vem"
            legend="Vem ska se rapporten?"
            value={shareChoice}
            onChange={setShareChoice}
            options={[
              { value: "private", label: VISIBILITY_LABEL.private, icon: VISIBILITY_ICON.private },
              { value: "mb", label: "Alla på Miljonbemanning i avtalet", help: "Samordnare, avtalsansvarig och chef i avtalet.", icon: VISIBILITY_ICON.mb },
            ]}
          />
          <p className="mt-3 text-text-muted">Sparade rapporter delas inte med kommunen. Ladda ned filen om rapporten ska lämnas till kommunen.</p>
        </Modal>
      )}
    </Page>
  );
}
