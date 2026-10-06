"use client";
// Rapporter och meddelanden i portalen (/portal/rapporter/:reportId?) – prototypens kom.rapporter.
// Utan reportId: handläggarens rapporter och meddelanden (flikar, ?flik=meddelanden, ?filter=olasta …) eller kommunens chefs
// beställarrapporter. Med reportId: rapportsidan (PortalReport från området rapporter).
import { PortalReport } from "@/features/rapporter/components/portal-report";
import { useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { pickInt, useMemoryState, useQueryPatch } from "@/shell/url-state";
import { Badge, Button, Card, Empty, ErrorNotice, Field, Input, List, ListItem, Loading, Notice, PerspectiveLink, Seg, Stack, TabPanel, Tabs } from "@/ui";
import type { ReportKind } from "@/data/schema";
import { navCounts } from "@/features/session/nav-api";
import { kommunReports, type KomReports } from "../api";
import { fDT, fDTL, trunc } from "../texts";
import { KOM_TABS, KomHead, KomPage, LeadIcon, MoreButton, ReportRowItem, SubLine, TitleRow, UNREAD_EDGE } from "./parts";

type Filter = "olasta" | "alla" | ReportKind;
const REP_FILTERS: [Filter, string][] = [
  ["olasta", "Olästa"],
  ["alla", "Alla"],
  ["weekly_attendance", "Veckorapporter"],
  ["monthly", "Månadsrapporter"],
  ["final", "Slutrapporter"],
  ["order_confirmation", "Orderbekräftelser"],
];
const isFilter = (v: string | null): v is Filter => REP_FILTERS.some(([k]) => k === v);

export function PortalRapporterScreen({ params, query }: ScreenProps) {
  if (params.reportId) {
    return <PortalReport key={params.reportId} reportId={params.reportId} from={query.get("fran")} query={query} next={<NextUnread currentId={params.reportId} lista={query.get("lista")} />} />;
  }
  return <ReportsScreen query={query} />;
}

/** "Nästa olästa rapport" på rapportsidan (handläggaren): nästa olästa i samma ordning som listan. */
function NextUnread({ currentId, lista }: { currentId: string; lista: string | null }) {
  const { actor } = useSession();
  const q = useQuery(kommunReports, actor.role === "kommun_handlaggare" ? {} : null);
  const next = q.data?.reports.find((r) => r.unread && r.id !== currentId);
  if (!next) return null;
  return (
    <Button kind="primary" iconRight="arrow-right" to={path(`/portal/rapporter/${encodeURIComponent(next.id)}`, { fran: "rapporter", lista })}>
      Nästa olästa rapport
    </Button>
  );
}

const PAGE = 15;
const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s-]/g, "");

function ReportsScreen({ query }: { query: URLSearchParams }) {
  const q = useQuery(kommunReports, {});
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  return q.data.chef ? <ChefReports d={q.data} /> : <Reports d={q.data} query={query} />;
}

function Reports({ d, query }: { d: KomReports; query: URLSearchParams }) {
  const nav = useNav();
  const patch = useQueryPatch();
  const tab = query.get("flik") === "meddelanden" ? "meddelanden" : "rapporter";
  const f0 = query.get("filter");
  const filter: Filter = isFilter(f0) ? f0 : "alla";
  // Antal visade i adressen (?visa=): Tillbaka från en rapport visar lika många. Söktexten kan vara ett namn – bara i minnet.
  const limit = pickInt(query, "visa", PAGE);
  const setLimit = (n: number) => patch({ visa: n > PAGE ? n : null });
  const [text, setText] = useMemoryState("q", "");
  const needle = norm(text);
  const reps = d.reports;
  const unreadR = reps.filter((r) => !r.openedAt);
  const count = (k: Filter) => (k === "alla" ? reps.length : k === "olasta" ? unreadR.length : reps.filter((r) => r.kind === k).length);
  const list = reps.filter((r) => (filter === "alla" || (filter === "olasta" ? !r.openedAt : r.kind === filter)) && (!needle || norm(`${r.title} ${r.sub}`).includes(needle)));
  // Listans val följer med till rapportsidan, så att "Tillbaka till rapporterna" visar samma lista.
  const lista = new URLSearchParams(Object.entries({ filter: filter === "alla" ? "" : filter, visa: limit > PAGE ? String(limit) : "" }).filter(([, v]) => v)).toString();
  // Flik och filter står i adressen (?flik=meddelanden&filter=olasta), så att länkar från startsidan öppnar rätt vy.
  const go = (t: "rapporter" | "meddelanden", f: Filter) => nav.replace(path("/portal/rapporter", { flik: t === "meddelanden" ? t : null, filter: f === "alla" ? null : f, visa: null }));
  const setTab = (t: "rapporter" | "meddelanden") => go(t, filter);
  const setFilter = (f: Filter) => go(tab, f);
  return (
    <KomPage>
      <KomHead
        eyebrow={d.customerName}
        title="Rapporter och meddelanden"
        back={{ label: "Till start", to: "/portal" }}
        lead="Olästa visas först. Du får ett mejl utan personuppgifter när något nytt kommer."
      />
      <Tabs
        id="kom-rapporter"
        ariaLabel="Rapporter eller meddelanden"
        className={KOM_TABS}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "rapporter", label: "Rapporter", icon: "file", count: unreadR.length },
          { id: "meddelanden", label: "Meddelanden", icon: "message", count: d.unreadMessages },
        ]}
      />
      <TabPanel tabsId="kom-rapporter" active={tab}>
        {tab === "rapporter" ? (
          <Stack>
            {d.coming.map((r) => (
              <Notice key={r.id} tone="info" icon="clock" title={`${r.title} är på väg`}>
                Den publiceras när coacherna har registrerat all närvaro för veckan, senast {fDTL(r.dueAt)}.
              </Notice>
            ))}
            <Seg
              ariaLabel="Visa rapporter"
              value={filter}
              onValueChange={setFilter}
              options={REP_FILTERS.filter(([k]) => k === "alla" || count(k) > 0).map(([k, l]) => ({ value: k, label: `${l} (${count(k)})` }))}
            />
            <Field id="kom-rap-q" label="Sök rapport" help="Skriv deltagarens namn eller ärendenumret, till exempel 0143.">
              <Input
                type="search"
                value={text}
                onValueChange={(v) => {
                  setText(v);
                  if (limit !== PAGE) setLimit(PAGE);
                }}
              />
            </Field>
            <Card flush>
              {list.length === 0 ? (
                <Empty icon={needle ? "search" : "check-circle"} title={needle ? "Ingen rapport matchar sökningen" : filter === "olasta" ? "Du har läst alla rapporter" : "Inga rapporter att visa"}>
                  {needle ? (
                    <Button kind="ghost" icon="x" onClick={() => setText("")}>
                      Rensa sökningen
                    </Button>
                  ) : undefined}
                </Empty>
              ) : (
                <List>
                  {list.slice(0, limit).map((r) => (
                    <ReportRowItem key={r.id} r={r} from="rapporter" lista={lista} />
                  ))}
                </List>
              )}
              <MoreButton shown={Math.min(limit, list.length)} total={list.length} onMore={() => setLimit(limit + PAGE)} />
            </Card>
            <p className="text-text-muted">Rapporterna byggs bara av uppgifter som coachen har godkänt. En rapport räknas som läst när du har öppnat den.</p>
          </Stack>
        ) : (
          <Stack>
            <Card flush title="Meddelanden per deltagare" icon="message">
              {d.threads.length === 0 ? (
                <Empty icon="message" title="Inga meddelanden än">
                  Öppna en deltagare under Mina deltagare för att skriva till Miljonbemanning.
                </Empty>
              ) : (
                <List>
                  {d.threads.map((t) => (
                    <ListItem
                      key={t.caseId}
                      to={path(`/portal/deltagare/${encodeURIComponent(t.caseId)}`, { flik: "meddelanden" })}
                      className={t.unread > 0 ? UNREAD_EDGE : undefined}
                      chevron
                      lead={<LeadIcon name={t.meeting ? "calendar" : "message"} />}
                      title={
                        <TitleRow>
                          <span>
                            {t.caseNumber} · {t.name}
                          </span>
                          {t.unread > 0 && (
                            <Badge tone="dark">
                              {t.unread} {t.unread === 1 ? "ny" : "nya"}
                            </Badge>
                          )}
                        </TitleRow>
                      }
                      sub={`${t.lastSender}, ${fDT(t.lastAt)}: ”${trunc(t.lastBody, 90)}”`}
                    >
                      <SubLine>
                        {t.count} {t.count === 1 ? "meddelande" : "meddelanden"} i tråden
                      </SubLine>
                    </ListItem>
                  ))}
                </List>
              )}
            </Card>
            <p className="text-text-muted">Vill du skriva om en deltagare som inte finns i listan? Öppna deltagaren under Mina deltagare.</p>
            <span>
              <Button iconRight="arrow-right" to="/portal/deltagare">
                Mina deltagare
              </Button>
            </span>
          </Stack>
        )}
      </TabPanel>
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="samordnare" to="/rapporter" label="Se rapporterna hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}

function ChefReports({ d }: { d: KomReports }) {
  const list = d.reports;
  // Rapporter som Miljonbemanning har byggt och delat med chefen (rapportbyggaren) – annars svåra att hitta härifrån.
  const shared = useQuery(navCounts, {}).data?.sharedReports ?? 0;
  return (
    <KomPage>
      <KomHead
        eyebrow={`${d.customerName} · ${d.unit ?? ""}`}
        title="Rapporter"
        back={{ label: "Till beställarrapporten", to: "/portal/bestallarrapport" }}
        lead="Beställarrapporterna som Miljonbemanning har levererat till dig. De kommer en gång i månaden."
      />
      {d.coming.map((r) => (
        <Notice key={r.id} tone="info" title={`${r.title} är på väg`}>
          Rapporten är ett utkast hos Miljonbemanning. Den levereras när avtalsansvarig har godkänt den, senast {fDTL(r.dueAt)}.
        </Notice>
      ))}
      <Card flush title="Beställarrapporter" icon="chart">
        {list.length === 0 ? (
          <Empty icon="file" title="Inga rapporter än" />
        ) : (
          <List>
            {list.map((r) => (
              <ReportRowItem key={r.id} r={r} from="rapporter" />
            ))}
          </List>
        )}
      </Card>
      {shared > 0 && (
        <span>
          <Button iconRight="arrow-right" to="/portal/resultat/rapporter">
            Rapporter som Miljonbemanning har gjort åt dig ({shared})
          </Button>
        </span>
      )}
      <p className="text-text-muted">Meddelanden om enskilda deltagare går till handläggaren som beställde insatsen. Du kan läsa dem under Enhetens deltagare.</p>
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="avtalsansvarig" to="/rapporter" label="Se rapporterna hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}
