"use client";
// Aktiviteter (/aktiviteter) – avtalets gruppaktiviteter (coachmötet 2026-10-09): i dag och framåt först, sedan tidigare.
// Alla på Miljonbemanning utom ekonomen ser alla ("alla ser alla"); de som arbetar i ärendena skapar nya.
import { GROUP_KIND_LABEL } from "@/core/group-activities";
import { dayOf, fmtTime, fmtWeekday } from "@/core/time";
import { useQuery } from "@/shell/backend";
import { Badge, Button, Card, CellSub, Empty, ErrorNotice, Loading, Page, Table, type Column } from "@/ui";
import { Link } from "@/shell/nav";
import { groupActivityList, type GroupActivityListRow } from "../api";

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
          <span>
            {r.invited} · {r.registered === r.invited ? "närvaron är registrerad" : `${r.registered} av ${r.invited} registrerade`}
          </span>
        ) : (
          <span>{r.invited} inbjudna</span>
        ),
    },
  ];
  return <Table caption={caption} columns={columns} rows={rows} rowKey="id" empty={empty} rowTone={(r) => (r.cancelled ? "muted" : null)} />;
}
