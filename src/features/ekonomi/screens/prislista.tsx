"use client";
// Prislistan som fakturan bygger på (price_items per avtalsområde). Beslut 5 (2026-10-07): belopp syns bara för rollen
// ekonom – prislistan har flyttat hit från avtalssidan (/admin/avtal), där systemadministratören inte längre ser priser.
// Priserna kommer från databasen – inget pris är hårdkodat här (CLAUDE.md punkt 4). Märket "Exempelpris" följer
// price_items.example_only: en faktura med ett exempelpris är stoppad tills avtalets riktiga pris finns i prislistan.
import { useQuery } from "@/shell/backend";
import { kr } from "@/core/format";
import { fmtDate } from "@/core/time";
import { Badge, Card, ErrorNotice, Loading, Notice, Page, Row, Table } from "@/ui";
import { ekoPriceList } from "../api";
import { WRAP } from "./parts";

export function PrislistaScreen() {
  const q = useQuery(ekoPriceList, {});
  const crumbs = [{ label: "Fakturering", to: "/ekonomi" }, { label: "Prislista" }];
  const lead = "Fakturan räknar veckor gånger priset för ärendets avtalsområde. Priserna gäller per deltagare och vecka, utan moms.";
  if (q.error) return <Page className={WRAP} title="Prislista" crumbs={crumbs} lead={lead}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <Page className={WRAP} title="Prislista" crumbs={crumbs} lead={lead}><Loading /></Page>;
  const d = q.data;
  const prices = d.items.map((p) => p.priceOre);
  const examples = d.items.filter((p) => p.exampleOnly).length;
  const exampleText = examples === d.items.length ? "Alla priser är exempelpriser" : `${examples} av ${d.items.length} priser är exempelpriser`;
  return (
    <Page className={WRAP} title="Prislista" crumbs={crumbs} lead={lead}>
      <Card
        title={`${d.unitText} – ${d.customerName}`}
        icon="card"
        flush
        actions={examples > 0 ? <Badge tone="plan" icon="alert-circle">{exampleText} – de riktiga priserna står i avtalet</Badge> : undefined}
        foot={
          <span className="text-small text-text-muted">
            Priserna är fasta i 12 månader. Därefter får de justeras enligt indexklausulen i avtalet, högst en gång per tolvmånadersperiod och aldrig retroaktivt. Vid justering skapas en ny rad med nytt giltighetsdatum – den gamla sparas.
          </span>
        }
      >
        <Row className="border-b border-ljusgra px-[18px] py-4">
          <span>
            Avtal <b className="tabular-nums">{d.contractNumber}</b>
          </span>
          <span>
            <b>{d.items.length}</b> {d.items.length === 1 ? "pris" : "priser"}
          </span>
          {d.items.length > 0 && (
            <span>
              <b>
                {kr(Math.min(...prices))}–{kr(Math.max(...prices))}
              </b>{" "}
              per deltagare och vecka exkl. moms
            </span>
          )}
          <span className="text-text-muted">Artikelnummer matchar artiklarna i Fortnox</span>
        </Row>
        {examples > 0 && (
          <div className="border-b border-ljusgra px-[18px] py-3">
            <Notice tone="warn" title="Fakturor med exempelpris är stoppade">
              En faktura kan inte skapas eller markeras som fakturerad så länge någon rad har ett exempelpris. Be systemadministratören lägga in avtalets riktiga
              priser.
            </Notice>
          </div>
        )}
        <Table
          caption={`Prislista ${d.customerName}`}
          rows={d.items}
          rowKey="id"
          empty="Avtalet har inga priser."
          columns={[
            { key: "area", label: "Avtalsområde", render: (p) => p.areaName },
            { key: "art", label: "Artikelnummer", render: (p) => <span className="tabular-nums tracking-[0.01em]">{p.fortnoxArticleNo ?? "–"}</span> },
            {
              key: "price",
              label: "Pris exkl. moms",
              num: true,
              nowrap: true,
              render: (p) =>
                p.exampleOnly ? (
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    {kr(p.priceOre)}
                    <Badge tone="plan" icon="alert-circle">
                      Exempelpris
                    </Badge>
                  </span>
                ) : (
                  kr(p.priceOre)
                ),
            },
            { key: "vat", label: "Moms", num: true, render: (p) => `${p.vatRate} %` },
            { key: "valid", label: "Giltig", nowrap: true, render: (p) => `${fmtDate(p.validFrom)} – ${p.validTo ? fmtDate(p.validTo) : "tills vidare"}` },
          ]}
        />
      </Card>
    </Page>
  );
}
