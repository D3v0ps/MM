"use client";
// Redovisningsunderlaget på skärmen (samma avsnitt som PDF:en, underlag-text.ts) och knappen som laddar ned det som PDF.
// Knappen: kommandot bonus.underlag kontrollerar behörigheten och loggar nedladdningen → PDF:en byggs i webbläsaren (dynamisk
// import av react-pdf, så att vanliga sidor inte blir större) → filen sparas med useDownload. Filnamnet har bara ärendenummer
// och steg. Inga belopp.
import { useState } from "react";
import { useCommand } from "@/shell/backend";
import { Button, Paper, PaperFixedText, useDownload, useToast, type ButtonKind } from "@/ui";
import { bonusUnderlag, type BonusUnderlag } from "../api";
import { DRAFT_LABEL, underlagSections, underlagTitle } from "../underlag-text";

export function UnderlagPaper({ u, participantName, draft }: { u: BonusUnderlag; participantName: string; draft?: string | null }) {
  return (
    <Paper title={underlagTitle(u)} draft={draft ?? (u.draft ? DRAFT_LABEL : undefined)} info={[["Avtal", `${u.contractNumber}, ${u.customerName}`], ["Ärende", u.caseNumber], ["Bonussteg", `${u.step} · ${u.stepLabel}`]]}>
      {underlagSections(u, participantName).map((s, i) => (
        <section key={s.title} className="flex flex-col gap-2">
          <h2>{`${i + 1}. ${s.title}`}</h2>
          {s.rows.length > 0 && (
            <table>
              <tbody>
                {s.rows.map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row" className="w-[34%]">{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.table && (
            <table>
              <thead>
                <tr>{s.table.cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                {s.table.rows.map((r, j) => (
                  <tr key={j}>{r.map((cell, k) => (k === 0 ? <th key={k} scope="row">{cell}</th> : <td key={k}>{cell}</td>))}</tr>
                ))}
              </tbody>
            </table>
          )}
          {(s.text ?? []).map((t, j) => <p key={j} className={j === 0 && s.rows.length === 0 ? "m-0" : "m-0 text-small text-text-muted"}>{t}</p>)}
        </section>
      ))}
      <PaperFixedText>Miljonbemanning AB · Redovisningsunderlag enligt incitamentsmodellen. Underlaget bygger bara på godkända uppgifter.</PaperFixedText>
    </Paper>
  );
}

/** "Läs underlaget (PDF)": loggar nedladdningen och sparar PDF:en. */
export function UnderlagPdfButton({ claimId, kind = "secondary", label = "Läs underlaget (PDF)" }: { claimId: string; kind?: ButtonKind; label?: string }) {
  const cmd = useCommand(bonusUnderlag);
  const download = useDownload();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await cmd.run({ claimId, purpose: "download" });
      if (!res.ok) {
        toast(res.message || "Underlaget kunde inte laddas ned.", "error");
        return;
      }
      const { renderBonusPdf } = await import("../pdf");
      const blob = await renderBonusPdf(res.underlag, res.participantName);
      await download(res.filename, blob, "application/pdf");
    } catch {
      toast("PDF-filen kunde inte skapas. Försök igen.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button kind={kind} icon="download" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => void onClick()}>
        {busy ? "Skapar PDF …" : label}
      </Button>
      <span role="status" className="sr-only">
        {busy ? "Skapar PDF-filen. Det kan ta några sekunder." : ""}
      </span>
    </>
  );
}
