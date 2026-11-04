// Redovisningsunderlaget som PDF (SPEC §7.17): logotyp överst, avtalet och ärendet i högerställt block, rubriker i versaler –
// samma byggstenar som rapporternas PDF (src/features/rapporter/pdf/primitives.tsx). Byggs i webbläsaren efter att kommandot
// bonus.underlag har loggat nedladdningen. Laddas med dynamisk import: const { renderBonusPdf } = await import("../pdf");
// Inga belopp (underlaget har inga) och inget i metadata utom ärendenummer och steg.
import { pdf } from "@react-pdf/renderer";
import { Kv, P, PdfDocument, Sec, Small, Table } from "../rapporter/pdf/primitives";
import { registerPdfFonts } from "../rapporter/pdf/theme";
import type { BonusUnderlag } from "./api";
import { underlagSections, underlagTitle } from "./underlag-text";

export function BonusPdf({ u, participantName }: { u: BonusUnderlag; participantName: string }) {
  const sections = underlagSections(u, participantName);
  return (
    <PdfDocument
      metaTitle={`${underlagTitle(u)} – ${u.caseNumber}`}
      title={underlagTitle(u)}
      info={[["Avtal", `${u.contractNumber}, ${u.customerName}`], ["Ärende", u.caseNumber], ["Bonussteg", `${u.step} · ${u.stepLabel}`]]}
    >
      {sections.map((s, i) => (
        <Sec key={s.title} n={String(i + 1)} title={s.title}>
          {s.rows.length > 0 && <Kv items={s.rows} />}
          {s.table && (
            <Table
              cols={s.table.cols.map((label, j) => ({ label, width: j === 0 ? 60 : 20, num: j > 0 }))}
              rows={s.table.rows.map((cells, j) => ({ key: String(j), cells }))}
            />
          )}
          {(s.text ?? []).map((t, j) => (j === 0 && s.rows.length === 0 ? <P key={j}>{t}</P> : <Small key={j} muted>{t}</Small>))}
        </Sec>
      ))}
    </PdfDocument>
  );
}

/** Underlaget som PDF (application/pdf). */
export async function renderBonusPdf(u: BonusUnderlag, participantName: string): Promise<Blob> {
  registerPdfFonts();
  return pdf(<BonusPdf u={u} participantName={participantName} />).toBlob();
}
