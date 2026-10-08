"use client";
// Rapportsidan i kommunportalen (prototypens PortalReport i views/rapporter.js). Används av området kommun på
// /portal/rapporter/:reportId:
//
//   <PortalReport reportId={params.reportId} from={query.get("fran")} />
//
// from ("fran" i URL:en) = sidan som länkade hit: "rapporter" | "deltagare" | "start". Den styr
// tillbakaknappen ("Tillbaka till deltagaren" …). Utan from: "Till rapporterna".
// Komponenten hämtar rapporten (reportDocument), kvitterar och loggar visningen (reportOpen – en gång per sidvisning;
// bara mottagaren kvitterar), fryser en levererad rapport som saknar ögonblicksbild och visar dokumentet.
// Ett utkast till rättelse visas som den senast levererade versionen. Kommunen ser aldrig interna knappar.
// "Ladda ner PDF" laddar ned den version som visas (components/pdf-button.tsx – behörigheten kontrolleras och loggas på servern).
import type { ReactNode } from "react";
import { path } from "@/shell/nav";
import { usePageTitle } from "@/shell/page-effects";
import { useCommand, useQuery } from "@/shell/backend";
import { Button, Card, Dot, Empty, ErrorNotice, Loading, Notice, PerspectiveLink, Stack, useAuditView } from "@/ui";
import { reportDocument, reportOpen, type PortalReportInfo, type ReportDocResult } from "../api";
import { DENIED, dtFull } from "../report-helpers";
import { useDefaultPersona } from "./parts";
import { PdfDownloadButton } from "./pdf-button";
import { ReportDocument } from "./report-document";
import { useLazySnapshot } from "./use-snapshot";

/** Listans val som följde med länken (?lista=filter=monthly&visa=30) – bara kända nycklar och koder. */
function listQuery(q: URLSearchParams | undefined): Record<string, string> {
  const raw = new URLSearchParams(q?.get("lista") ?? "");
  const out: Record<string, string> = {};
  for (const k of ["flik", "filter", "visa"]) {
    const v = raw.get(k);
    if (v && /^[a-z0-9_-]{1,30}$/i.test(v)) out[k] = v;
  }
  return out;
}

// Tillbaka leder till sidan man kom från – med samma val (filter, antal visade, månad, fliken Rapporter).
const BACK: Record<string, { label: string; to: (caseId: string | null, q: URLSearchParams | undefined) => string | null }> = {
  rapporter: { label: "Tillbaka till rapporterna", to: (_id, q) => path("/portal/rapporter", listQuery(q)) },
  deltagare: { label: "Tillbaka till deltagaren", to: (id) => (id ? `/portal/deltagare/${encodeURIComponent(id)}?flik=rapporter` : null) },
  start: { label: "Tillbaka till start", to: () => "/portal" },
};

function BackButton({ from, caseId, query }: { from?: string | null; caseId: string | null; query?: URLSearchParams }) {
  const b = from ? BACK[from] : undefined;
  const to = b?.to(caseId, query) ?? null;
  return (
    <div>
      <Button kind="ghost" icon="arrow-left" to={to ?? "/portal/rapporter"}>
        {to && b ? b.label : "Till rapporterna"}
      </Button>
    </div>
  );
}

/** "Se från leverantörens håll" (bara prototypen): huvudcoachen om det är den förvalda coachen, annars avtalsansvarig. */
function SupplierPerspective({ reportId, leadCoachId }: { reportId: string; leadCoachId: string | null }) {
  const coach = useDefaultPersona("coach");
  const role = leadCoachId && leadCoachId === coach ? "coach" : "avtalsansvarig";
  return <PerspectiveLink role={role} to={`/rapporter/${encodeURIComponent(reportId)}`} label="Se från leverantörens håll" />;
}

/**
 * query = adressens query (listans val och månaden till tillbakalänken). next = t.ex. "Nästa olästa rapport" (visas längst
 * ned, efter rapporten).
 */
export function PortalReport({ reportId, from, query, next }: { reportId: string; from?: string | null; query?: URLSearchParams; next?: ReactNode }) {
  const q = useQuery(reportDocument, { reportId });
  const res: ReportDocResult | undefined = q.data;
  const shownId = res && res.ok ? res.doc.id : null;
  const open = useCommand(reportOpen);
  // Visningen loggas alltid och kvitterar när mottagaren själv öppnar rapporten (report.open) – en gång per sidvisning.
  useAuditView(shownId ? `report.open:${shownId}` : null, () => open.run({ reportId: shownId as string }));
  useLazySnapshot(shownId, !!res && res.ok && res.needsSnapshot);
  usePageTitle(res && res.ok && res.portal ? res.portal.title : null);

  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !res) return <Loading />;
  if (!res.ok || !res.portal) {
    const [t, b] = DENIED[res.ok ? "not_yours" : res.reason] ?? DENIED.not_yours;
    return (
      <Stack gap="lg">
        <BackButton from={from} caseId={null} query={query} />
        <Empty icon="file" title={t}>
          {b}
        </Empty>
        <div className="flex flex-wrap gap-3">
          <SupplierPerspective reportId={reportId} leadCoachId={null} />
        </div>
      </Stack>
    );
  }
  const p: PortalReportInfo = res.portal;
  return (
    <Stack gap="lg">
      <BackButton from={from} caseId={p.caseId} query={query} />
      <Stack gap="sm">
        <h1 tabIndex={-1} data-page-title="" className="flex items-center gap-2.5 text-[1.75rem] font-extrabold tracking-[0.03em] uppercase">
          <Dot className="size-2.5" />
          {p.title}
        </h1>
        <p>
          {p.caseNumber &&
            (p.participant == null ? (
              <>
                Gäller ärende <span className="whitespace-nowrap">{p.caseNumber}</span>. Namnet visas inte.{" "}
              </>
            ) : (
              <>
                Gäller {p.participant}, ärende <span className="whitespace-nowrap">{p.caseNumber}</span>.{" "}
              </>
            ))}
          Levererad av Miljonbemanning {p.deliveredText}.{p.version > 1 ? ` Det här är version ${p.version}, som ersätter en tidigare version.` : ""}
        </p>
      </Stack>
      {p.isRecipient && p.openedAt && (
        <Notice tone="ok" title="Rapporten är kvitterad">
          Du öppnade rapporten första gången {dtFull(p.openedAt)}. Miljonbemanning ser att du har läst den.
        </Notice>
      )}
      {!p.isRecipient && (
        <Notice tone="info" title="Kvitteras bara av mottagaren">
          Rapporten skickades till {p.recipientName}. Den blir kvitterad först när {p.recipientName} öppnar den – inte när du läser den.{" "}
          {p.openedAt ? `${p.recipientName} öppnade rapporten ${dtFull(p.openedAt)}.` : `${p.recipientName} har inte öppnat rapporten än.`}
        </Notice>
      )}
      {p.correcting && (
        <Notice tone="info" title="Rapporten rättas">
          Miljonbemanning håller på att rätta rapporten. Du ser den senast levererade versionen (version {p.version}) tills den rättade versionen är levererad. Du får ett mejl när den finns här.
        </Notice>
      )}
      {p.superseded && (
        <Notice tone="warn" title="Rapporten har rättats">
          Miljonbemanning har rättat rapporten. {p.newerId ? "Den rättade versionen finns nedan." : "Den rättade versionen visas här när den är levererad."}
          {p.newerId && (
            <div className="mt-2">
              <Button kind="primary" to={`/portal/rapporter/${encodeURIComponent(p.newerId)}${from ? `?fran=${encodeURIComponent(from)}` : ""}`}>
                Visa den rättade versionen
              </Button>
            </div>
          )}
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <PdfDownloadButton doc={res.doc} />
        <span className="text-small text-text-muted portal:text-portal">Filen innehåller samma rapport som visas nedan.</span>
      </div>
      <ReportDocument doc={res.doc} />
      {/* Efter rapporten: vidare utan att leta i listan. */}
      {next && <div className="flex flex-wrap items-center gap-3">{next}</div>}
      <Card title="Har du frågor om rapporten?" icon="message">
        <Stack>
          <p>Skicka ett meddelande till coachen i portalen. Skriv inte personnummer i e-post.</p>
          {p.canMessage && p.caseId && (
            <div>
              <Button kind="primary" icon="message" to={`/portal/deltagare/${encodeURIComponent(p.caseId)}?flik=meddelanden`}>
                Skriv till coachen
              </Button>
            </div>
          )}
        </Stack>
      </Card>
      <div className="flex flex-wrap gap-3">
        <SupplierPerspective reportId={p.requestedId} leadCoachId={p.leadCoachId} />
      </div>
    </Stack>
  );
}
