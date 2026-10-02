// PDF:en byggs i webbläsaren (prototypen och appen) av samma vy-modell som HTML-pappret. Laddas med dynamisk import när
// någon klickar "Ladda ner PDF", så att react-pdf och typsnitten inte gör vanliga sidor större:
//   const { renderReportPdf } = await import("../pdf/render");
//   const blob = await renderReportPdf(doc);
import { pdf } from "@react-pdf/renderer";
import type { ReportDocView } from "../api";
import { ReportPdf } from "./documents";
import { registerPdfFonts } from "./theme";

/** Rapporten som PDF (application/pdf). */
export async function renderReportPdf(doc: ReportDocView): Promise<Blob> {
  registerPdfFonts();
  return pdf(<ReportPdf doc={doc} />).toBlob();
}
