"use client";
// "Ladda ner PDF" – samma knapp i Miljonbemannings rapportsida och i kommunportalen.
//   <PdfDownloadButton doc={doc} />   doc = ReportDocView från reportDocument (det dokument som visas)
// Flöde: kommandot rapporter.download kontrollerar behörigheten på servern och loggar nedladdningen (report.downloaded) →
// PDF:en byggs i webbläsaren av samma dokument (dynamisk import av react-pdf, så att vanliga sidor inte blir större) →
// filen sparas med useDownload (appen: webbläsarens nedladdning, prototypen: claude.ai:s nedladdning). Filnamnet kommer
// från servern och innehåller inga personuppgifter.
// Medan PDF:en skapas (några sekunder) står det "Skapar PDF …" på knappen och en skärmläsare får höra det. Knappen är
// aria-disabled i stället för disabled, så att fokus stannar kvar på den (en knapp som blir disabled tappar fokus).
import { useState } from "react";
import { useCommand } from "@/shell/backend";
import { Button, useDownload, useToast, type ButtonKind } from "@/ui";
import { reportDownload, type ReportDocView } from "../api";

export function PdfDownloadButton({ doc, kind = "secondary" }: { doc: ReportDocView | null | undefined; kind?: ButtonKind }) {
  const cmd = useCommand(reportDownload);
  const download = useDownload();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      const res = await cmd.run({ reportId: doc.id });
      if (!res.ok) {
        toast(res.message || "Rapporten kunde inte laddas ned.", "error");
        return;
      }
      const { renderReportPdf } = await import("../pdf/render");
      const blob = await renderReportPdf(doc);
      await download(res.filename, blob, "application/pdf");
    } catch {
      toast("PDF-filen kunde inte skapas. Försök igen.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button kind={kind} icon="download" disabled={!doc} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => void onClick()}>
        {busy ? "Skapar PDF …" : "Ladda ner PDF"}
      </Button>
      <span role="status" className="sr-only">
        {busy ? "Skapar PDF-filen. Det kan ta några sekunder." : ""}
      </span>
    </>
  );
}
