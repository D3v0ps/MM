"use client";
// Rapportbyggaren: listan (/rapportbyggare) – samordnare, avtalsansvarig och chef. Färdiga rapporter (resultatfilen för hela
// avtalet), mina rapporter och delade inom Miljonbemanning. Sparade rapporter delas aldrig med kommunen (beslut 2026-10-07).
// Har användaren fler än ett avtal i drift visas valet "Avtal" (?avtal=).
import { useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, ErrorNotice, Field, Icon, Loading, Notice, Page, Section, Select, Stack, type IconName } from "@/ui";
import { builderCatalog, savedReportList, VISIBILITY_LABEL, type SavedReportRow } from "../api";
import { Link } from "@/shell/nav";

export const VISIBILITY_ICON: Record<SavedReportRow["visibility"], IconName> = { private: "lock", mb: "users" };

/** Delningen som ikon och text (aldrig bara ikon). */
export function Sharing({ visibility }: { visibility: SavedReportRow["visibility"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <Icon name={VISIBILITY_ICON[visibility]} />
      {VISIBILITY_LABEL[visibility]}
    </span>
  );
}

function ReportRows({ rows, empty }: { rows: SavedReportRow[]; empty: string }) {
  if (!rows.length) return <p className="text-text-muted">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0 p-0">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-ljusgra py-3 last:border-b-0">
          <div className="flex min-w-0 flex-col gap-1">
            <Link to={`/rapportbyggare/${r.id}`} className="inline-flex min-h-11 items-center font-bold underline [overflow-wrap:anywhere]">
              {r.title}
            </Link>
            <span className="text-small text-text-muted">
              {[r.outputLabel, r.datasetLabel, r.periodText, r.createdBy, r.dateText].filter(Boolean).join(" · ")}
            </span>
            <Sharing visibility={r.visibility} />
          </div>
          {/* Rubriken är länken till rapporten (Min veckas rader) – en knapp bara för åtgärden. */}
          <div className="flex flex-wrap gap-2">
            <Button icon="copy" to={path("/rapportbyggare/ny", { kopia: r.id })} ariaLabel={`Gör en kopia av ${r.title}`}>
              Gör en kopia
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ByggListaScreen({ query }: ScreenProps) {
  const nav = useNav();
  const avtal = query.get("avtal") ?? undefined;
  const cat = useQuery(builderCatalog, { contractId: avtal });
  const list = useQuery(savedReportList, { contractId: avtal });
  if (cat.error) return <ErrorNotice error={cat.error} onRetry={() => void cat.refetch()} />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  if (!cat.data || !list.data) return <Loading />;
  const c = cat.data;
  const l = list.data;
  const withContract = (to: string, q: Record<string, string> = {}) => path(to, { ...q, avtal: c.contracts.length > 1 ? (c.contractId ?? undefined) : undefined });
  return (
    <Page
      title="Rapportbyggare"
      lead="Här bygger du egna rapporter av de levererade månads- och slutrapporterna. Du kan spara rapporten och dela den med andra på Miljonbemanning."
      actions={
        c.contractId ? (
          <Button kind="primary" icon="plus" to={withContract("/rapportbyggare/ny")}>
            Ny rapport
          </Button>
        ) : null
      }
    >
      {c.contracts.length > 1 && (
        <Field id="bygg-avtal" label="Avtal" help="Rapporterna gäller ett avtal i taget.">
          <Select value={c.contractId ?? ""} options={c.contracts.map((x) => ({ value: x.id, label: x.label }))} onValueChange={(v) => nav.replace(path("/rapportbyggare", { avtal: v }))} />
        </Field>
      )}
      {!c.contractId ? (
        <Notice tone="info" title="Du har inget avtal i drift att bygga rapporter för." />
      ) : (
        <>
          <Section title="Färdiga rapporter">
            <Card title="Resultatfil för hela avtalet" icon="file">
              <Stack gap="sm">
                <p>
                  Resultatfilen för alla ärenden i avtalet. Avtalsansvarig lämnar den till kommunen utanför Miljonmatch – skicka den inte som bilaga i vanlig
                  e-post.
                </p>
                <span>
                  <Button icon="download" to={withContract("/rapportbyggare/resultatfil")}>
                    Hämta resultatfilen
                  </Button>
                </span>
              </Stack>
            </Card>
          </Section>
          <Section title="Mina rapporter">
            <Card>
              <ReportRows rows={l.mine} empty="Du har inga sparade rapporter. Börja med Ny rapport." />
            </Card>
          </Section>
          <Section title="Delade inom Miljonbemanning">
            <Card>
              <ReportRows rows={l.sharedMb} empty="Inga rapporter är delade inom Miljonbemanning." />
            </Card>
          </Section>
        </>
      )}
    </Page>
  );
}
