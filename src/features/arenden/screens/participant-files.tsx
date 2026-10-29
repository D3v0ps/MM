"use client";
// Kortet Filer på deltagarkortet (Karims beslut 2026-10-29): deltagarens CV, personliga brev, betyg och intyg – bara
// Miljonbemanning, aldrig kommunen. Visas på fliken Översikt för samordnare, avtalsansvarig och coach med full åtkomst
// (card.files). Samma i appen och prototypen:
//   ladda upp  arenden.deltagarfilStart (med typen) -> appen: PUT direkt till lagringen; minnesläget/prototypen: innehållet med
//              arenden.deltagarfilKlar
//   öppna      arenden.bilagaHamta (loggas attachment.viewed) – filnamnet hamnar aldrig i en URL
//   ta bort    arenden.deltagarfilTaBort efter en fråga – när som helst
import { useState } from "react";
import { fmtDate } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, Card, Empty, ErrorNotice, Field, focusSoon, Icon, Loading, Modal, Select, Stack, useConfirm, useToast } from "@/ui";
import { caseFiles, participantFileDone, participantFileRemove, participantFileStart, type CaseCard, type CaseFiles, type ParticipantFileRow } from "../api";
import { fileProblem, sendFile, typeText, useAttachmentDownload } from "./attachments";

/** Kortet Filer. Rendera bara när card.files är sant. */
export function ParticipantFilesCard({ card }: { card: CaseCard }) {
  const q = useQuery(caseFiles, { caseId: card.caseId });
  const [uploading, setUploading] = useState(false);
  const f = q.data;
  const full = !!f && f.count >= f.maxFiles;
  const canUpload = !!f && !f.uploadBlocked && !full;
  return (
    <Card
      title="Filer"
      icon="file"
      id="deltagarfiler"
      actions={
        canUpload ? (
          <Button kind="secondary" icon="upload" onClick={() => setUploading(true)}>
            Ladda upp fil
          </Button>
        ) : null
      }
    >
      {q.error ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : !f ? (
        q.isLoading ? <Loading /> : null
      ) : (
        <Stack>
          {f.count === 0 ? (
            <Empty icon="file" title="Inga filer ännu">
              Här sparar ni deltagarens CV, personliga brev, betyg och intyg.
            </Empty>
          ) : (
            f.groups
              .filter((g) => g.files.length > 0)
              .map((g) => (
                <section key={g.category} aria-labelledby={`deltagarfiler-${g.category}`} className="flex flex-col gap-2">
                  <h3 id={`deltagarfiler-${g.category}`} className="m-0 text-body font-extrabold tracking-[0.09em] text-text-muted uppercase">
                    {g.label} <span className="font-bold normal-case tracking-normal">({g.files.length})</span>
                  </h3>
                  <ul aria-label={g.label} className="m-0 flex list-none flex-col gap-2 p-0">
                    {g.files.map((x) => (
                      <FileRow key={x.id} file={x} />
                    ))}
                  </ul>
                </section>
              ))
          )}
          {f.uploadBlocked && <p className="m-0 text-text-muted">{f.uploadBlocked}</p>}
          {!f.uploadBlocked && full && (
            <p className="m-0 text-text-muted">
              Deltagaren har {f.maxFiles} filer, vilket är det högsta antalet. Ta bort en fil som inte behövs för att ladda upp en ny.
            </p>
          )}
          <p className="m-0 flex items-start gap-1.5 text-small text-text-muted">
            <Icon name="lock" className="mt-0.5 flex-none" />
            <span>Filerna syns bara för Miljonbemanning – aldrig för kommunen.</span>
          </p>
        </Stack>
      )}
      {uploading && f && <UploadModal caseId={card.caseId} caseNumber={card.caseNumber} files={f} onClose={() => setUploading(false)} />}
    </Card>
  );
}

/** En fil: namn, typ och storlek, när och av vem – Öppna och Ta bort. */
function FileRow({ file: x }: { file: ParticipantFileRow }) {
  const open = useAttachmentDownload();
  const remove = useCommand(participantFileRemove);
  const toast = useToast();
  const confirm = useConfirm();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-mb border-[1.5px] border-ljusgra px-3 py-2">
      <Icon name="file" className="flex-none" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="font-bold">{x.fileName}</span>
        <span className="block text-small text-text-muted">
          {typeText(x.mimeType)} · {x.sizeText} · uppladdad {fmtDate(x.createdAt)} av {x.uploadedByName}
        </span>
      </span>
      <Button icon="download" onClick={() => void open(x)} ariaLabel={`Öppna ${x.fileName}`}>
        Öppna
      </Button>
      {x.canRemove && (
        <Button
          kind="ghost"
          icon="trash"
          ariaLabel={`Ta bort ${x.fileName}`}
          pending={remove.pending}
          onClick={async () => {
            // Borttagningen går inte att ångra – fråga först.
            const ok = await confirm({
              title: "Ta bort filen?",
              body: (
                <p>
                  {x.fileName} ({x.categoryLabel}) tas bort från deltagarkortet. Filen går inte att få tillbaka.
                </p>
              ),
              confirmLabel: "Ta bort filen",
              tone: "danger",
            });
            if (!ok) return;
            const r = await remove.run({ attachmentId: x.id }).catch(() => null);
            if (r && r.ok) {
              toast("Filen är borttagen.");
              // Raden försvinner – fokus till kortets rubrik.
              focusSoon("deltagarfiler-rubrik");
            } else toast(r && !r.ok && r.message ? r.message : "Filen kunde inte tas bort. Försök igen.", "error");
          }}
        >
          Ta bort
        </Button>
      )}
    </li>
  );
}

/** Dialogen Ladda upp fil: typ (obligatorisk) och filen. */
function UploadModal({ caseId, caseNumber, files: f, onClose }: { caseId: string; caseNumber: string; files: CaseFiles; onClose: () => void }) {
  const start = useCommand(participantFileStart);
  const done = useCommand(participantFileDone);
  const toast = useToast();
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const chosen = f.categories.find((c) => c.value === category);
  const categoryError = tried && !chosen ? "Välj vilken typ av fil det är." : null;
  const fileError = tried && !file ? "Välj en fil." : file ? fileProblem(file) : null;
  const submit = async () => {
    setTried(true);
    setServerError(null);
    if (!chosen || !file || fileProblem(file)) return;
    setBusy(true);
    try {
      const s = await start.run({ caseId, category: chosen.value, fileName: file.name, mimeType: file.type || "", bytes: file.size });
      if (!s.ok) {
        setServerError(s.message || "Filen kunde inte laddas upp.");
        return;
      }
      const sent = await sendFile(s.uploadUrl, file);
      if (!sent.ok) {
        setServerError("Filen kunde inte laddas upp. Försök igen.");
        return;
      }
      const d = await done.run({ attachmentId: s.attachmentId, ...(sent.contentBase64 ? { contentBase64: sent.contentBase64 } : {}) });
      if (!d.ok) {
        setServerError(d.message || "Filen kunde inte tas emot.");
        return;
      }
      toast(`${d.file.fileName} är uppladdad under ${d.file.categoryLabel}.`);
      onClose();
    } catch {
      setServerError("Filen kunde inte laddas upp. Försök igen.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Ladda upp fil"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose} disabled={busy}>
            Avbryt
          </Button>
          <Button kind="primary" icon="upload" pending={busy} onClick={() => void submit()}>
            Ladda upp
          </Button>
        </>
      }
    >
      <Stack>
        <p className="m-0">
          Ärende <span className="font-bold tabular-nums">{caseNumber}</span>
        </p>
        <Field id="deltagarfil-typ" label="Typ av fil" required error={categoryError} help="Filen sorteras under typen på deltagarkortet.">
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              setServerError(null);
            }}
            placeholder="Välj typ av fil"
            options={f.categories}
          />
        </Field>
        <Field id="deltagarfil-fil" label="Fil" required error={fileError} help={f.help}>
          {/* Ett vanligt filfält: Field kopplar etiketten (id) – hjälptexten och felet kopplas här (aria-describedby). */}
          <input
            id="deltagarfil-fil"
            type="file"
            accept={f.accept}
            required
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? "deltagarfil-fil-help deltagarfil-fil-error" : "deltagarfil-fil-help"}
            className="min-h-11 w-full rounded-mb border-[1.5px] border-antracit bg-vit px-3 py-2 file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-mb file:border-[1.5px] file:border-antracit file:bg-vit file:px-3 file:font-bold"
            onChange={(e) => {
              setFile(e.currentTarget.files?.[0] ?? null);
              setServerError(null);
            }}
          />
        </Field>
        {serverError && (
          <p role="alert" className="m-0 flex items-start gap-1.5 font-bold">
            <Icon name="alert-circle" className="mt-0.5 flex-none text-rod" />
            <span>{serverError}</span>
          </p>
        )}
      </Stack>
    </Modal>
  );
}
