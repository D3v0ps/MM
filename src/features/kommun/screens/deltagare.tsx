"use client";
// Deltagarna i portalen (/portal/deltagare/:caseId?) – prototypens kom.deltagare. Utan caseId: listan (handläggarens
// deltagare). Med caseId: deltagarens sida (deltagare-kort.tsx). Kommunen har bara rollen handläggare (beslut 2026-10-07).
// Begrepp: deltagare = personen, insats = det kommunen beställt, ärendenummer = beställningens nummer.
import { useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { pick, pickInt, useMemoryState, useQueryPatch } from "@/shell/url-state";
import type { ScreenProps } from "@/shell/routes";
import { Badge, Button, Card, Empty, ErrorNotice, Field, Icon, Input, List, ListItem, Loading, PerspectiveLink, Seg, Stack } from "@/ui";
import { kommunCaseList, type KomCaseList, type KomCaseRow } from "../api";
import { shortStatus } from "../texts";
import { KStatus, KomHead, KomPage, MoreButton, SubLine, UNREAD_EDGE } from "./parts";
import { CaseDetail } from "./deltagare-kort";

// Två urval (beslut 2026-10-09, "Vi behöver inte visa så mycket till kommunens handläggare"): Pågår och Alla.
type Filter = "aktuella" | "alla";
const LIST_FILTERS: { value: Filter; label: string }[] = [
  { value: "aktuella", label: "Pågår" },
  { value: "alla", label: "Alla" },
];
// Pågår: allt som inte är avslutat – också beställningar på väg. Avböjda beställningar syns en tid, så att handläggaren
// hittar orsaken.
const MATCH: Record<Filter, (c: KomCaseRow) => boolean> = {
  aktuella: (c) => !["closed", "declined"].includes(c.status) || c.recentlyDeclined,
  alla: () => true,
};

export function PortalDeltagareScreen({ params, query }: ScreenProps) {
  if (params.caseId) return <CaseDetail key={params.caseId} caseId={params.caseId} tab={query.get("flik")} />;
  return <CaseListScreen />;
}

function CaseListScreen() {
  const q = useQuery(kommunCaseList, {});
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  return <CaseList d={q.data} />;
}

function CaseList({ d }: { d: KomCaseList }) {
  const nav = useNav();
  const patch = useQueryPatch();
  // Valen i adressen (Tillbaka från en deltagare visar samma lista). Söktexten kan vara ett namn: bara i minnet.
  const filter = pick(nav.query, "filter", LIST_FILTERS.map((o) => o.value), "aktuella");
  const setFilter = (v: Filter) => patch({ filter: v === "aktuella" ? null : v });
  const [q, setQ] = useMemoryState("q", "");
  const limit = pickInt(nav.query, "visa", 20);
  const setLimit = (n: number) => patch({ visa: n > 20 ? n : null });
  const all = d.rows;
  const counts = Object.fromEntries(LIST_FILTERS.map((o) => [o.value, all.filter(MATCH[o.value]).length])) as Record<Filter, number>;
  const term = q.trim().toLowerCase();
  const hit = (c: KomCaseRow) => !term || c.caseNumber.toLowerCase().includes(term) || c.name.toLowerCase().includes(term);
  const rows = all.filter((c) => MATCH[filter](c) && hit(c));
  // Sökningen hittar avslutade deltagare under Alla: "1 träff bland alla deltagare – Visa" (så att ingen tror att deltagaren saknas).
  const shownIds = new Set(rows.map((c) => c.id));
  const elsewhereN = term && filter !== "alla" ? all.filter((c) => hit(c) && !shownIds.has(c.id)).length : 0;
  const more = () => setLimit(20);
  return (
    <KomPage>
      <KomHead
        eyebrow={d.customerName}
        title="Mina deltagare"
        back={{ label: "Till start", to: "/portal" }}
        lead="De deltagare som du har beställt en insats för. Välj en deltagare för att se hur insatsen går, rapporter och meddelanden."
      />
      {all.length === 0 ? (
        // Ny handläggare utan någon beställning: inga filter eller sökfält att tolka – bara nästa steg.
        <Card>
          <Empty
            icon="users"
            title="Du har inte beställt någon insats än"
            action={
              <Button kind="primary" icon="file-plus" to="/portal/bestall">
                Beställ ny insats
              </Button>
            }
          >
            När du har skickat en beställning visas deltagaren här med status, rapporter och meddelanden.
          </Empty>
        </Card>
      ) : (
        <>
          <Stack>
            <Seg
              ariaLabel="Visa deltagare"
              value={filter}
              onValueChange={(v) => {
                setFilter(v);
                more();
              }}
              options={LIST_FILTERS.map((o) => ({ value: o.value, label: `${o.label} (${counts[o.value]})` }))}
            />
            <Field id="kom-sok" label="Sök" help="Skriv deltagarens namn eller ärendenumret.">
              <Input
                type="search"
                value={q}
                onValueChange={(v) => {
                  setQ(v);
                  more();
                }}
              />
            </Field>
            {term && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {elsewhereN > 0 && (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Icon name="info" />
                    {elsewhereN === 1 ? "1 träff" : `${elsewhereN} träffar`} bland alla deltagare
                    <Button
                      onClick={() => {
                        setFilter("alla");
                        more();
                      }}
                    >
                      Visa
                    </Button>
                  </span>
                )}
                {term && (
                  <Button kind="ghost" icon="x" onClick={() => setQ("")}>
                    Rensa sökningen
                  </Button>
                )}
              </div>
            )}
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
                    className={c.unread > 0 || (c.status === "declined" && c.recentlyDeclined) ? UNREAD_EDGE : undefined}
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
                    </span>
                    <SubLine>{c.caseNumber}</SubLine>
                    <SubLine>{shortStatus(c, d.phaseCount)}</SubLine>
                  </ListItem>
                ))}
              </List>
            )}
            <MoreButton shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit(limit + 20)} />
          </Card>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="samordnare" to="/arenden" label="Se listan hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}
