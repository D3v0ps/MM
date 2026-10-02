"use client";
// Deltagarna i portalen (/portal/deltagare/:caseId?) – prototypens kom.deltagare. Utan caseId: listan (handläggaren: sina
// deltagare, kommunens chef: enhetens). Med caseId: deltagarens sida (deltagare-kort.tsx).
// Begrepp: deltagare = personen, insats = det kommunen beställt, ärendenummer = beställningens nummer.
import { useEffect, useState } from "react";
import { useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { Badge, Card, DemoNote, Empty, ErrorNotice, Field, FormGrid, Input, List, ListItem, Loading, PerspectiveLink, Seg, Select, Stack } from "@/ui";
import { kommunCaseList, type KomCaseList, type KomCaseRow } from "../api";
import { shortStatus } from "../texts";
import { KStatus, KomHead, KomPage, MoreButton, SubLine } from "./parts";
import { CaseDetail } from "./deltagare-kort";

type Filter = "aktuella" | "avslutade" | "avbojda" | "alla";
const LIST_FILTERS: { value: Filter; label: string }[] = [
  { value: "aktuella", label: "Pågår och på väg" },
  { value: "avslutade", label: "Avslutade" },
  { value: "avbojda", label: "Avböjda" },
  { value: "alla", label: "Alla" },
];
// Avböjda beställningar syns i standardfiltret en tid, så att handläggaren hittar orsaken.
const MATCH: Record<Filter, (c: KomCaseRow) => boolean> = {
  aktuella: (c) => !["closed", "declined"].includes(c.status) || c.recentlyDeclined,
  avslutade: (c) => c.status === "closed",
  avbojda: (c) => c.status === "declined",
  alla: () => true,
};

export function PortalDeltagareScreen({ params, query }: ScreenProps) {
  if (params.caseId) return <CaseDetail key={params.caseId} caseId={params.caseId} tab={query.get("flik")} />;
  return <CaseListScreen />;
}

function CaseListScreen() {
  const q = useQuery(kommunCaseList, {});
  useEffect(() => {
    if (q.data?.chef) document.title = "Enhetens deltagare – Miljonmatch";
  }, [q.data?.chef]);
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  return <CaseList d={q.data} />;
}

function CaseList({ d }: { d: KomCaseList }) {
  const chef = d.chef;
  const [filter, setFilter] = useState<Filter>("aktuella");
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const [limit, setLimit] = useState(20);
  const all = d.rows;
  const counts = Object.fromEntries(LIST_FILTERS.map((o) => [o.value, all.filter(MATCH[o.value]).length])) as Record<Filter, number>;
  const term = q.trim().toLowerCase();
  const rows = all.filter((c) => MATCH[filter](c) && (!who || c.referrerId === who) && (!term || c.caseNumber.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)));
  const referrers = [...new Map(all.filter((c) => c.referrerId).map((c) => [c.referrerId as string, c.referrerName])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "sv"));
  const more = () => setLimit(20);
  return (
    <KomPage>
      <KomHead
        eyebrow={chef ? `${d.customerName} · ${d.unit ?? ""}` : d.customerName}
        title={chef ? "Enhetens deltagare" : "Mina deltagare"}
        back={chef ? { label: "Till beställarrapporten", to: "/portal/bestallarrapport" } : { label: "Till start", to: "/portal" }}
        lead={
          chef
            ? "Alla deltagare som enhetens handläggare har beställt en insats för. Välj en deltagare för att se hur insatsen går."
            : "De deltagare som du har beställt en insats för. Välj en deltagare för att se hur insatsen går, rapporter och meddelanden."
        }
      />
      <Stack>
        <Seg
          ariaLabel="Visa deltagare"
          value={filter}
          onValueChange={(v) => {
            setFilter(v);
            more();
          }}
          options={LIST_FILTERS.filter((o) => o.value !== "avbojda" || counts.avbojda > 0).map((o) => ({ value: o.value, label: `${o.label} (${counts[o.value]})` }))}
        />
        <FormGrid>
          <Field id="kom-sok" label="Sök" help="Skriv ett namn eller ett ärendenummer, till exempel BOT-26-0143. Ärendenumret är beställningens nummer.">
            <Input
              type="search"
              value={q}
              onValueChange={(v) => {
                setQ(v);
                more();
              }}
            />
          </Field>
          {chef && (
            <Field id="kom-who" label="Handläggare" help="Visa deltagare som en viss handläggare har beställt en insats för.">
              <Select
                value={who}
                onValueChange={(v) => {
                  setWho(v);
                  more();
                }}
                placeholder="Alla handläggare"
                options={referrers}
              />
            </Field>
          )}
        </FormGrid>
      </Stack>
      <Card flush title={`${rows.length} deltagare`} icon="users">
        {rows.length === 0 ? (
          <Empty icon="search" title="Inga deltagare hittades">
            Prova ett annat filter eller en annan sökning.
          </Empty>
        ) : (
          <List>
            {rows.slice(0, limit).map((c) => (
              <ListItem
                key={c.id}
                to={`/portal/deltagare/${encodeURIComponent(c.id)}`}
                marked={c.unread > 0 || (c.status === "declined" && c.recentlyDeclined)}
                chevron
                title={c.name}
              >
                <span className="flex flex-wrap items-center gap-2.5">
                  <KStatus c={c} />
                  {c.unread > 0 && (
                    <Badge tone="dark" icon="message">
                      {c.unread === 1 ? "1 nytt meddelande" : `${c.unread} nya meddelanden`}
                    </Badge>
                  )}
                  {c.protectedIdentity && (
                    <Badge tone="outline" icon="lock">
                      Skyddade personuppgifter
                    </Badge>
                  )}
                </span>
                <SubLine>
                  {c.caseNumber} · {c.primaryAreaName ?? "Avtalsområde inte valt än"}
                </SubLine>
                <SubLine>
                  {shortStatus(c, chef, d.phaseCount)}
                  {chef ? ` · ${c.referrerName}` : ""}
                </SubLine>
              </ListItem>
            ))}
          </List>
        )}
        <MoreButton shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit(limit + 20)} />
      </Card>
      {d.scopeUnset && (
        <DemoNote>Om kommunens användare ska se sina egna deltagare, hela enhetens eller alla är inte bestämt ännu. I prototypen ser handläggaren sina egna och chefen alla.</DemoNote>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="samordnare" to="/arenden" label="Se listan hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}
