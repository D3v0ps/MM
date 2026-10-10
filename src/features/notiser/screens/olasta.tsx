"use client";
// Kortet "Olästa notiser" i högerkolumnen på Min vecka för alla MB-roller utom coachen (coachens kort får sina data ur
// coach.minVecka). Den som har flera roller ser kortet en gång, efter rolldelarna på Min vecka. Samma utseende som coachens
// kort. Data: notiser.list – den inloggades egna notiser (alla MB-roller).
import { plural } from "@/core/format";
import { useQuery } from "@/shell/backend";
import { Button, Card, ErrorNotice, Loading, Stack, useWeekPart } from "@/ui";
import { notifList } from "../api";

/** De tre senaste olästa notiserna och länken till Notiser. */
export function UnreadNotices() {
  // Flera roller på samma sida (src/ui/week-part.ts): kortet står en gång på sidan – inte i varje rolldel.
  const part = useWeekPart();
  const q = useQuery(notifList, part ? null : {});
  if (part) return null;
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
