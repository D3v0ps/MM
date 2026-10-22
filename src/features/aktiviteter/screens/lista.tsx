"use client";
// Aktiviteter (/aktiviteter) – avtalets gruppaktiviteter (coachmötet 2026-10-09): de återkommande (Karims beslut 2026-10-22:
// nivåaktiviteterna varje vecka), i dag och framåt, sedan tidigare. Alla på Miljonbemanning utom ekonomen ser alla ("alla ser
// alla"); de som arbetar i ärendena skapar nya, ändrar och avslutar de återkommande.
import { useState } from "react";
import { GROUP_KIND_LABEL } from "@/core/group-activities";
import { dayOf, fmtDate, fmtDateTimeLong, fmtTime, fmtWeekday } from "@/core/time";
import { useQuery } from "@/shell/backend";
import { Badge, Button, Card, CellSub, Empty, ErrorNotice, Loading, Page, Row, Stack, Table, type Column } from "@/ui";
import { Link } from "@/shell/nav";
import { durationLabel } from "@/features/arenden/screens/kort-start";
import { groupActivityList, type GroupActivityListRow, type SeriesListRow } from "../api";
import { SeriesEditModal, useEndSeries } from "./serie";

export function AktiviteterScreen() {
  const q = useQuery(groupActivityList, {});
  const v = q.data;
  return (
    <Page
      title="Aktiviteter"
      lead="Aktiviteter för flera deltagare. Öppna en aktivitet för att ta närvaro och skriva anteckningar."
      actions={
        v?.canCreate ? (
          <Button kind="primary" icon="plus" to="/aktiviteter/ny">
            Ny aktivitet
          </Button>
        ) : undefined
      }
    >
      {!v ? (
        q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : <Loading />
      ) : (
        <>
          {(v.series.length > 0 || v.canCreate) && <SeriesCard rows={v.series} canEdit={v.canCreate} now={v.now} />}
          <Card title="I dag och framåt" icon="calendar" flush>
            <ActivityTable rows={v.upcoming} now={v.now} empty="Inga planerade aktiviteter." caption="Aktiviteter i dag och framåt" />
          </Card>
          {v.upcoming.length === 0 && v.earlier.length === 0 && v.canCreate && (
            <Empty icon="users" title="Inga aktiviteter än" action={<Button kind="primary" icon="plus" to="/aktiviteter/ny">Ny aktivitet</Button>}>
              Skapa en aktivitet, bjud in deltagarna och ta närvaro för alla på en gång.
            </Empty>
          )}
          {v.earlier.length > 0 && (
            <Card title="Tidigare" icon="clock" flush>
              <ActivityTable rows={v.earlier} now={v.now} empty="Inga tidigare aktiviteter." caption="Tidigare aktiviteter" />
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

/** De återkommande aktiviteterna: dagar och tid, målgrupp, nästa tillfälle, Ändra och Avsluta serien. */
function SeriesCard({ rows, canEdit, now }: { rows: SeriesListRow[]; canEdit: boolean; now: string }) {
  const [editing, setEditing] = useState<SeriesListRow | null>(null);
  const end = useEndSeries();
  return (
    <Card title="Återkommande" icon="refresh" id="akt-aterkommande">
      {rows.length === 0 ? (
        <p className="m-0 text-body text-text-muted">
          Inga återkommande aktiviteter. Välj Upprepa varje vecka i Ny aktivitet, till exempel för en nivå två gånger i veckan.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Återkommande aktiviteter">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-ljusgra py-3 last:border-b-0" data-testid="serie">
              <Stack gap="sm" className="min-w-[min(100%,280px)] flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="outline" icon="refresh">
                    Varje vecka
                  </Badge>
                  {s.next ? (
                    <Link to={`/aktiviteter/${encodeURIComponent(s.next.id)}`} className="inline-flex min-h-11 items-center font-bold underline underline-offset-3">
                      {s.name}
                    </Link>
                  ) : (
                    <span className="font-bold">{s.name}</span>
                  )}
                </span>
                <span className="text-body">
                  {s.schedule} · {durationLabel(s.durationMin)} · {s.location}
                </span>
                <span className="text-body text-text-muted">
                  {s.audienceLabel}
                  {s.responsibleName ? ` · Ansvarig ${s.responsibleName}` : ""}
                  {` · Från ${fmtDate(s.startsOn)}${s.endsOn ? ` till ${fmtDate(s.endsOn)}` : ""}`}
                </span>
                <span className="text-body text-text-muted">
                  {s.next ? `Nästa tillfälle ${fmtDateTimeLong(s.next.startsAt)}.` : "Inga kommande tillfällen just nu."}{" "}
                  {s.notify ? "Deltagarna får meddelande inför varje tillfälle." : "Deltagarna får inget meddelande – coachen ger tiderna."}
                </span>
              </Stack>
              {canEdit && (
                <Row gap="sm">
                  <Button kind="ghost" icon="edit" onClick={() => setEditing(s)}>
                    Ändra<span className="sr-only"> {s.name}</span>
                  </Button>
                  <Button kind="ghost" icon="x" pending={end.pending} onClick={() => void end.run({ ...s, today: dayOf(now) })}>
                    Avsluta serien<span className="sr-only"> {s.name}</span>
                  </Button>
                </Row>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <SeriesEditModal s={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ActivityTable({ rows, now, empty, caption }: { rows: GroupActivityListRow[]; now: string; empty: string; caption: string }) {
  const columns: Column<GroupActivityListRow>[] = [
    {
      key: "startsAt",
      label: "När",
      nowrap: true,
      render: (r) => (
        <>
          <span className="font-bold">{fmtWeekday(dayOf(r.startsAt))}</span>
          <CellSub>
            kl. {fmtTime(r.startsAt)} · {r.durationMin} min
          </CellSub>
        </>
      ),
    },
    {
      key: "name",
      label: "Aktivitet",
      render: (r) => (
        <>
          <Link to={`/aktiviteter/${encodeURIComponent(r.id)}`} className="inline-flex min-h-11 items-center font-bold">
            {r.name}
          </Link>
          <CellSub>
            {GROUP_KIND_LABEL[r.kind]} · {r.location}
            {r.audienceLabel ? ` · ${r.audienceLabel}` : ""}
            {r.seriesId ? " · Återkommande" : ""}
          </CellSub>
        </>
      ),
    },
    { key: "responsibleName", label: "Ansvarig", render: (r) => r.responsibleName ?? "–" },
    {
      key: "invited",
      label: "Deltagare",
      render: (r) =>
        r.cancelled ? (
          <Badge tone="outline" icon="x-circle">
            Inställd
          </Badge>
        ) : r.startsAt < now ? (
          // Status med text och ikon (som raden på Min vecka, GroupDayRow) – aldrig bara text eller färg.
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span>{r.invited} deltagare</span>
            {r.registered === r.invited ? (
              <Badge tone="blue" icon="check">
                Närvaron är registrerad
              </Badge>
            ) : (
              <Badge tone="outline" icon="circle">
                {r.registered} av {r.invited} registrerade
              </Badge>
            )}
          </span>
        ) : (
          <span>{r.invited} inbjudna</span>
        ),
    },
  ];
  return <Table caption={caption} columns={columns} rows={rows} rowKey="id" empty={empty} rowTone={(r) => (r.cancelled ? "muted" : null)} />;
}
