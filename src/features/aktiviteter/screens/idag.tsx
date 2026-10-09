"use client";
// Dagens gruppaktiviteter på Min vecka (coachmötet 2026-10-09): en rad per aktivitet med länk till aktivitetsvyn – i coachens
// "Dagens aktiviteter" (tillsammans med de enskilda tillfällena) och i samordnarens eget kort.
import { GROUP_KIND_LABEL } from "@/core/group-activities";
import { fmtTime, fmtWeekday, relative } from "@/core/time";
import { Badge, Button, Card, cn, DoneLine, List, TitleLink } from "@/ui";
import type { TodayGroupActivity } from "../api";

/** En gruppaktivitet i dagens lista: tid, namn (länk), typ, plats och antal – och närvaron när den har startat. */
export function GroupDayRow({ g, now, isNext }: { g: TodayGroupActivity; now: string; isNext?: boolean }) {
  const past = g.startsAt < now;
  const href = `/aktiviteter/${encodeURIComponent(g.id)}`;
  return (
    <div
      data-testid="dagens-gruppaktivitet"
      className={cn(
        "flex min-w-0 flex-wrap items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0",
        past && "bg-ljusgra-ton",
        isNext && "shadow-[inset_4px_0_0_var(--color-rod)]",
      )}
    >
      <div className="flex w-16 flex-none flex-col gap-0.5">
        <span className="text-[1.0625rem] font-extrabold tabular-nums">{fmtTime(g.startsAt)}</span>
        <span className="text-small text-text-muted">{g.durationMin} min</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="font-bold">
          <TitleLink to={href}>{g.name}</TitleLink>
        </div>
        <div className="text-small text-text-muted">
          Gruppaktivitet · {GROUP_KIND_LABEL[g.kind]} · {g.location}
          {g.responsibleName ? ` · ansvarig ${g.responsibleName}` : ""}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isNext && (
            <Badge tone="dark" icon="clock">
              Nästa · {relative(g.startsAt, now)}
            </Badge>
          )}
          <Badge tone="outline" icon="users">
            {g.invited} deltagare
          </Badge>
          {past &&
            (g.registered === g.invited ? (
              <Badge tone="blue" icon="check">
                Närvaron är registrerad
              </Badge>
            ) : (
              <Badge tone="outline" icon="circle">
                {g.registered} av {g.invited} registrerade
              </Badge>
            ))}
        </div>
      </div>
      <div className="flex flex-none flex-col items-end gap-1 max-[620px]:basis-full max-[620px]:flex-row max-[620px]:items-center max-[620px]:pl-[76px]">
        <Button kind={past && g.registered < g.invited ? "primary" : "ghost"} icon="check-square" to={href}>
          {past && g.registered < g.invited ? "Ta närvaro" : "Öppna"}
        </Button>
      </div>
    </div>
  );
}

/** Samordnarens kort: dagens gruppaktiviteter i avtalet. */
export function TodayGroupsCard({ groups, now, today }: { groups: readonly TodayGroupActivity[]; now: string; today: string }) {
  const title = `Dagens aktiviteter – ${fmtWeekday(today)}`;
  if (!groups.length) {
    return (
      <DoneLine id="mv-aktiviteter" title={title} icon="users">
        Inga gruppaktiviteter i dag.
      </DoneLine>
    );
  }
  return (
    <Card id="mv-aktiviteter" title={title} icon="users" flush actions={<Button kind="ghost" iconRight="arrow-right" to="/aktiviteter">Alla aktiviteter</Button>}>
      <List>
        {groups.map((g) => (
          <GroupDayRow key={g.id} g={g} now={now} />
        ))}
      </List>
    </Card>
  );
}
