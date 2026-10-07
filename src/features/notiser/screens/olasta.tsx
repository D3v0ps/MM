"use client";
// Kortet "Olästa notiser" i högerkolumnen på Min vecka för alla MB-roller utom coachen (coachens kort får sina data ur
// coach.minVecka). Samma utseende som coachens kort. Data: notiser.list – den inloggades egna notiser (alla MB-roller).
import { plural } from "@/core/format";
import { useQuery } from "@/shell/backend";
import { Button, Card, ErrorNotice, Loading, Stack } from "@/ui";
import { notifList } from "../api";

/** De tre senaste olästa notiserna och länken till Notiser. */
export function UnreadNotices() {
  const q = useQuery(notifList, {});
  const unread = (q.data?.items ?? []).filter((n) => n.readAt === null);
  const latest = unread.slice(0, 3);
  return (
    <Card
      title="Olästa notiser"
      icon="bell"
      actions={
        <Button kind="secondary" iconRight="arrow-right" to="/notiser">
          Öppna notiser
        </Button>
      }
    >
      {q.error ? (
        <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Loading />
      ) : unread.length === 0 ? (
        <p className="text-text-muted">Du har inga olästa notiser.</p>
      ) : (
        <Stack gap="sm">
          <p>
            <b>{plural(unread.length, "oläst", "olästa")}.</b> {unread.length === 1 ? "Den senaste:" : "De senaste:"}
          </p>
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
            {latest.map((n) => (
              <li key={n.id}>
                <span className="font-bold">{n.title}</span>
              </li>
            ))}
          </ul>
        </Stack>
      )}
    </Card>
  );
}
