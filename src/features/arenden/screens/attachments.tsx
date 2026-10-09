"use client";
// Bilagor till beställningen (beslut 2026-10-07, synpunkt #7 och beslut 4) – delas av portalen (beställningen och deltagarens
// sida), deltagarkortet och avropsinkorgen. Samma i appen och prototypen:
//   ladda upp  arenden.bilagaStart -> appen: PUT direkt till lagringen (signerad adress, privat bucket i Stockholm);
//              minnesläget/prototypen: ingen adress, innehållet skickas med arenden.bilagaKlar -> arenden.bilagaKlar
//   hämta      arenden.bilagaHamta (loggas) -> appen: kort signerad adress som hämtas som fil; minnesläget: innehållet ->
//              useDownload med filnamnet. Filnamnet hamnar aldrig i en URL.
import { useState } from "react";
import { ATTACHMENT_MAX_BYTES, attachmentMime, fileSizeText } from "@/core/attachments";
import { base64ToBytes, bytesToBase64 } from "@/core/export/base64";
import { PRIOR_ASSESSMENT_LABEL } from "@/core/labels";
import { useCommand } from "@/shell/backend";
import { Button, Card, Icon, Kv, Stack, cn, useConfirm, useDownload, useToast } from "@/ui";
import { attachmentDone, attachmentDownload, attachmentRemove, attachmentStart, type AttachmentRow, type CaseBackground } from "../api";

/** Ikon och text för filtypen ("PDF", "Word", "Bild"). */
function typeText(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Bild";
  return "Word";
}

/** Hämta en bilaga och spara den med sitt filnamn. */
export function useAttachmentDownload() {
  const run = useCommand(attachmentDownload);
  const download = useDownload();
  const toast = useToast();
  return async (a: Pick<AttachmentRow, "id">) => {
    const r = await run.run({ attachmentId: a.id }).catch(() => null);
    if (!r || !r.ok) {
      toast(r && !r.ok && r.message ? r.message : "Filen kunde inte hämtas. Försök igen.", "error");
      return;
    }
    try {
      if (r.url) {
        // Den signerade adressen gäller i 60 sekunder. Filen hämtas som data och sparas med filnamnet ur svaret.
        const res = await fetch(r.url, {
          credentials: "omit",
          cache: "no-store",
        });
        if (!res.ok) throw new Error("hämtning");
        await download(r.fileName, await res.blob(), r.mimeType);
      } else if (r.contentBase64 != null) {
        await download(r.fileName, base64ToBytes(r.contentBase64), r.mimeType);
      }
    } catch {
      toast("Filen kunde inte hämtas. Försök igen.", "error");
    }
  };
}

/** Listan med bilagor: namn, typ och storlek, "Hämta" och – när det är tillåtet – "Ta bort". */
export function AttachmentList({ rows, empty, onRemoved, className }: { rows: readonly AttachmentRow[]; empty?: string; onRemoved?: (id: string) => void; className?: string }) {
  const fetchFile = useAttachmentDownload();
  const remove = useCommand(attachmentRemove);
  const toast = useToast();
  const confirm = useConfirm();
  if (!rows.length) return empty ? <p className="text-text-muted">{empty}</p> : null;
  return (
    <ul aria-label="Bilagor" className={cn("m-0 flex list-none flex-col gap-2 p-0", className)}>
      {rows.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-mb border-[1.5px] border-ljusgra px-3 py-2">
          <Icon name="file" className="flex-none" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="font-bold">{a.fileName}</span>
            <span className="block text-text-muted">
              {typeText(a.mimeType)} · {a.sizeText}
            </span>
          </span>
          <Button icon="download" onClick={() => void fetchFile(a)} ariaLabel={`Hämta ${a.fileName}`}>
            Hämta
          </Button>
          {a.canRemove && (
            <Button
              kind="ghost"
              icon="trash"
              ariaLabel={`Ta bort ${a.fileName}`}
              onClick={async () => {
                // Borttagningen går inte att ångra – fråga först.
                if (!(await confirm({ title: "Ta bort bilagan?", body: <p>Filen går inte att få tillbaka.</p>, confirmLabel: "Ta bort", tone: "danger" }))) return;
                const r = await remove.run({ attachmentId: a.id }).catch(() => null);
                if (r && r.ok) {
                  toast("Filen är borttagen.");
                  onRemoved?.(a.id);
                } else toast(r && !r.ok && r.message ? r.message : "Filen kunde inte tas bort.", "error");
              }}
            >
              Ta bort
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** En fil som håller på att laddas upp, eller som inte kunde tas emot. */
export type UploadingFile = {
  key: string;
  name: string;
  state: "uploading" | "error";
  message: string | null;
};

/**
 * Ladda upp filer. Kontrollerar typ och storlek i webbläsaren först (servern kontrollerar igen, och filsignaturen efter
 * uppladdningen). Returnerar de uppladdade raderna och felen per fil.
 */
export function useAttachmentUpload(caseId: string | null) {
  const start = useCommand(attachmentStart);
  const done = useCommand(attachmentDone);
  return async (file: File): Promise<{ ok: true; row: AttachmentRow } | { ok: false; message: string }> => {
    if (!attachmentMime(file.name, file.type))
      return {
        ok: false,
        message: "Filtypen tas inte emot. Bifoga en PDF, ett Word-dokument eller en bild.",
      };
    if (file.size > ATTACHMENT_MAX_BYTES)
      return {
        ok: false,
        message: `Filen är större än 10 MB (${fileSizeText(file.size)}).`,
      };
    if (file.size === 0) return { ok: false, message: "Filen är tom." };
    try {
      const s = await start.run({
        caseId,
        fileName: file.name,
        mimeType: file.type || "",
        bytes: file.size,
      });
      if (!s.ok)
        return {
          ok: false,
          message: s.message || "Filen kunde inte laddas upp.",
        };
      let contentBase64: string | undefined;
      if (s.uploadUrl) {
        const res = await fetch(s.uploadUrl, {
          method: "PUT",
          body: file,
          headers: {
            "content-type": attachmentMime(file.name, file.type) ?? "application/octet-stream",
            "x-upsert": "false",
            "cache-control": "no-store",
          },
          credentials: "omit",
        });
        if (!res.ok)
          return {
            ok: false,
            message: "Filen kunde inte laddas upp. Försök igen.",
          };
      } else {
        // Minnesläget och prototypen: ingen lagring att ladda upp till – innehållet skickas med (sparas bara i minnet).
        contentBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      }
      const d = await done.run({
        attachmentId: s.attachmentId,
        ...(contentBase64 ? { contentBase64 } : {}),
      });
      if (!d.ok)
        return {
          ok: false,
          message: d.message || "Filen kunde inte tas emot.",
        };
      return { ok: true, row: d.attachment };
    } catch {
      return {
        ok: false,
        message: "Filen kunde inte laddas upp. Försök igen.",
      };
    }
  };
}

/** Filväljaren med listan över valda filer (beställningen och deltagarens sida). */
export function AttachmentPicker({
  id,
  caseId,
  rows,
  onRows,
  maxFiles,
  accept,
  typesText,
  onBusy,
}: {
  id: string;
  caseId: string | null;
  rows: readonly AttachmentRow[];
  onRows: (next: AttachmentRow[]) => void;
  maxFiles: number;
  accept: string;
  typesText: string;
  onBusy?: (busy: boolean) => void;
}) {
  const upload = useAttachmentUpload(caseId);
  const [pending, setPending] = useState<UploadingFile[]>([]);
  const left = maxFiles - rows.length;
  const pick = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const take = list.slice(0, Math.max(0, left));
    const skipped = list.slice(take.length).map((f, i) => ({
      key: `x-${Date.now()}-${i}`,
      name: f.name,
      state: "error" as const,
      message: `Högst ${maxFiles} filer per beställning.`,
    }));
    const items = take.map((f, i) => ({
      key: `u-${Date.now()}-${i}`,
      name: f.name,
      state: "uploading" as const,
      message: null,
    }));
    setPending((p) => [...p.filter((x) => x.state === "uploading"), ...items, ...skipped]);
    onBusy?.(true);
    let cur = [...rows];
    for (const [i, f] of take.entries()) {
      const r = await upload(f);
      const key = items[i].key;
      if (r.ok) {
        cur = [...cur, r.row];
        onRows(cur);
        setPending((p) => p.filter((x) => x.key !== key));
      } else setPending((p) => p.map((x) => (x.key === key ? { ...x, state: "error", message: r.message } : x)));
    }
    onBusy?.(false);
  };
  return (
    <div className="flex flex-col gap-3">
      <AttachmentList rows={rows} onRemoved={(rid) => onRows(rows.filter((x) => x.id !== rid))} />
      {pending.length > 0 && (
        <ul aria-live="polite" className="m-0 flex list-none flex-col gap-2 p-0">
          {pending.map((x) => (
            <li key={x.key} role={x.state === "error" ? "alert" : "status"} className="flex items-start gap-2 [overflow-wrap:anywhere]">
              <Icon name={x.state === "error" ? "alert-circle" : "refresh"} className={cn("mt-1 flex-none", x.state === "error" && "text-rod")} />
              <span>
                <span className="font-bold">{x.name}</span>: {x.state === "error" ? x.message : "laddas upp …"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {left > 0 ? (
        <label
          htmlFor={id}
          className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-mb border-[1.5px] border-antracit bg-vit px-4 py-2 font-bold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-antracit hover:bg-ljusgra-ton"
        >
          <Icon name="paperclip" />
          {rows.length ? "Bifoga fler filer" : "Bifoga fil"}
          <input
            id={id}
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            onChange={(e) => {
              void pick(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
      ) : (
        <p className="text-text-muted">Du har bifogat {maxFiles} filer, vilket är det högsta antalet.</p>
      )}
      <p className="text-text-muted">
        {typesText}. Högst 10 MB per fil och högst {maxFiles} filer.
      </p>
    </div>
  );
}

/**
 * Bakgrundsinformationen från beställningen: omfattningen (med motivering vid annan tidsperiod), om en kartläggning har
 * genomförts, handläggarens text och bilagorna med "Hämta". Portalens deltagarsida och deltagarkortet (full åtkomst).
 */
export function CaseBackgroundCard({ bg, title = "Bakgrundsinformation", onRemoved }: { bg: CaseBackground; title?: string; onRemoved?: (id: string) => void }) {
  return (
    <Card title={title} icon="clipboard">
      <Stack>
        <Kv
          items={[
            ["Omfattning", bg.orderPeriodText],
            bg.orderPeriodReason
              ? [
                  "Motivering",
                  <span key="r" className="whitespace-pre-line">
                    {bg.orderPeriodReason}
                  </span>,
                ]
              : null,
            ["Kartläggning genomförd", bg.priorAssessment ? PRIOR_ASSESSMENT_LABEL[bg.priorAssessment] : "Framgår inte"],
            [
              "Bakgrund",
              bg.text ? (
                <span key="t" className="whitespace-pre-line">
                  {bg.text}
                </span>
              ) : (
                "Inte angiven"
              ),
            ],
          ]}
        />
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-body font-extrabold tracking-[0.09em] text-text-muted uppercase">Bifogade filer</h3>
          <AttachmentList rows={bg.attachments} empty="Inga filer är bifogade." onRemoved={onRemoved} />
        </div>
      </Stack>
    </Card>
  );
}
