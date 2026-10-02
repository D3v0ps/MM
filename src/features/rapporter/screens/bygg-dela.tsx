"use client";
// Delningsdialogen (avtalsansvarig): "Dela med kommunens chef?" med reglerna och förhandsvisningen i kommunens läge. För en
// sparad rapport körs förhandsvisningen med savedReportId (loggas som visning, saved_report.viewed); för en rapport som inte är
// sparad än med definitionen (loggas inte).
import { useEffect, useRef, useState } from "react";
import { useCommand } from "@/shell/backend";
import { Button, ErrorNotice, Loading, Modal, Notice, Stack } from "@/ui";
import { builderPreview, type BuilderView, type ReportDefinition, type TemplateKey } from "../api";
import { BuilderViewPanel } from "../components/builder-view";

export type ShareSource = { savedReportId: string } | { contractId: string; definition: ReportDefinition; templateKey?: TemplateKey | null };

export function ShareDialog({ source, ownerIsMe, title, minN, hasNames, isList, onShare, onClose, pending }: {
  source: ShareSource;
  /** Avtalsansvarig delar sin egen rapport (och kan ändra den medan den är delad) – annars någon annans (tillägg 2026-10-02). */
  ownerIsMe: boolean;
  title: string;
  minN: number;
  /** Listan har resultat.namn. */
  hasNames: boolean;
  isList: boolean;
  onShare: () => void;
  onClose: () => void;
  pending?: boolean;
}) {
  const cmd = useCommand(builderPreview);
  const [res, setRes] = useState<{ view: BuilderView } | { error: string } | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const input = "savedReportId" in source
      ? { savedReportId: source.savedReportId, audience: "kommun" as const }
      : { contractId: source.contractId, definition: source.definition as unknown as Record<string, unknown>, ...(source.templateKey ? { templateKey: source.templateKey } : {}), audience: "kommun" as const };
    cmd.run(input).then(
      (r) => setRes(r.ok ? { view: r as unknown as BuilderView } : { error: r.message || "Förhandsvisningen kunde inte visas." }),
      () => setRes({ error: "Förhandsvisningen kunde inte visas." }),
    );
  }, [cmd, source]);
  return (
    <Modal
      title="Dela med kommunens chef?"
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="building" pending={pending} onClick={onShare}>
            Dela med kommunen
          </Button>
        </div>
      }
    >
      <Stack>
        <p>Kommunens chef kommer att se rapporten under Hämta resultat. Det här gäller:</p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          <li>Chefen ser bara ärenden i sin egen enhet.</li>
          <li>{`Grupper med färre än ${minN} deltagare visas som "färre än ${minN}".`}</li>
          <li>Miljonbemannings interna mål visas inte.</li>
          <li>Ärenden med skyddade personuppgifter kommer aldrig med.</li>
          {isList && <li>{hasNames ? "Filen innehåller deltagarnas namn och ärendenummer." : "Filen innehåller deltagarnas ärendenummer."}</li>}
          {/* Tillägg 2026-10-02: bara ägaren ändrar innehållet. Avtalsansvarig ändrar bara delningen på andras rapporter. */}
          <li>{ownerIsMe ? "Bara du kan ändra rapporten medan den är delad." : "Rapporten kan inte ändras medan den är delad. Den som skapade den kan ändra den om du slutar dela den."}</li>
          <li>Varje visning och hämtning sparas i loggen.</li>
        </ul>
        <h3 className="text-label font-extrabold tracking-[0.08em] uppercase">Så här ser kommunens chef rapporten</h3>
        {!res ? <Loading /> : "error" in res ? <Notice tone="warn" title={res.error} /> : <BuilderViewPanel view={res.view} title={title} headingLevel={4} />}
        {cmd.error && !res && <ErrorNotice error={cmd.error} />}
      </Stack>
    </Modal>
  );
}
