"use client";
// Prislistan som fakturan bygger på (price_items per avtalsområde). Beslut 5 (2026-10-07): belopp syns bara för rollen
// ekonom – prislistan har flyttat hit från avtalssidan (/admin/avtal), där systemadministratören inte längre ser priser.
// Priserna kommer från databasen – inget pris är hårdkodat här (CLAUDE.md punkt 4).
import { useQuery } from "@/shell/backend";
import { kr } from "@/core/format";
import { fmtDate } from "@/core/time";
import { Badge, Card, ErrorNotice, Loading, Page, Row, Table } from "@/ui";
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
  return (
    <Page className={WRAP} title="Prislista" crumbs={crumbs} lead={lead}>
      <Card
        title={`${d.unitText} – ${d.customerName}`}
        icon="card"
        flush
        actions={<Badge tone="plan" icon="alert-circle">Exempelpriser – de riktiga priserna står i avtalet</Badge>}
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
        <Table
          caption={`Prislista ${d.customerName}`}
          rows={d.items}
          rowKey="id"
          empty="Avtalet har inga priser."
          columns={[
            { key: "area", label: "Avtalsområde", render: (p) => p.areaName },
            { key: "art", label: "Artikelnummer", render: (p) => <span className="tabular-nums tracking-[0.01em]">{p.fortnoxArticleNo ?? "–"}</span> },
            { key: "price", label: "Pris exkl. moms", num: true, nowrap: true, render: (p) => kr(p.priceOre) },
            { key: "vat", label: "Moms", num: true, render: (p) => `${p.vatRate} %` },
            { key: "valid", label: "Giltig", nowrap: true, render: (p) => `${fmtDate(p.validFrom)} – ${p.validTo ? fmtDate(p.validTo) : "tills vidare"}` },
          ]}
        />
      </Card>
    </Page>
  );
}
