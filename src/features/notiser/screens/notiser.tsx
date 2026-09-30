"use client";
// Personliga notiser (/notiser, prototypens vy notiser i 05-notiser.js): tilldelning, påminnelse, eskalering och meddelande.
// Varje notis har exakt en mottagare. Coachen ser sina påminnelser men aldrig att ett ärende eskalerats till chefen –
// det styrs av vilka notiser hanteraren räknar fram för rollen, inte av skärmen.
import { useState } from "react";
import { fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { DemoOnly } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import { Badge, Button, Card, DemoNote, Empty, Icon, Notice, Page, PerspectiveLink, QueryView, Row, Seg, cn, type BadgeTone, type IconName } from "@/ui";
import { notifList, notifRead, type NotifList, type NotifView } from "../api";

const KIND: Record<NotifView["kind"], { label: string; icon: IconName; tone: BadgeTone }> = {
  assignment: { label: "Tilldelning", icon: "user", tone: "bluetone" },
  progress_reminder: { label: "Påminnelse", icon: "bell", tone: "grey" },
  progress_escalation: { label: "Eskalering", icon: "flag", tone: "red" },
  message: { label: "Meddelande", icon: "message", tone: "outline" },
};
type Filter = "alla" | "olasta" | NotifView["kind"];

export function NotiserScreen() {
  const q = useQuery(notifList, {});
  const read = useCommand(notifRead);
  const { user } = useSession();
  const unread = q.data?.items.filter((n) => !n.readAt) ?? [];
  return (
    <Page
      title="Notiser"
      eyebrow={user.name}
      lead="Dina personliga notiser. De skickas i appen och som e-post utan personuppgifter. Ingen annan ser dina notiser."
      actions={
        unread.length > 0 ? (
          <Button icon="check" pending={read.pending} onClick={() => void read.run({ ids: unread.map((n) => n.id) })}>
            Markera alla som lästa
          </Button>
        ) : undefined
      }
    >
      <QueryView query={q}>{(d) => <NotiserContent d={d} onRead={(ids) => read.run({ ids })} />}</QueryView>
    </Page>
  );
}

function NotiserContent({ d, onRead }: { d: NotifList; onRead: (ids: string[]) => Promise<unknown> }) {
  const nav = useNav();
  const [filter, setFilter] = useState<Filter>("alla");
  const [open, setOpen] = useState<string | null>(null);
  const all = d.items;
  const unread = all.filter((n) => !n.readAt);
  const list = all.filter((n) => filter === "alla" || (filter === "olasta" && !n.readAt) || n.kind === filter);
  const kinds = (Object.keys(KIND) as NotifView["kind"][]).filter((k) => all.some((n) => n.kind === k));
  const target = (n: NotifView) => {
    if (!n.caseId) return null;
    const id = encodeURIComponent(n.caseId);
    if (n.kind === "progress_reminder") return { to: `/avstamning/${id}`, label: "Gör avstämning" };
    if (n.kind === "message") return { to: `/arenden/${id}?flik=meddelanden`, label: "Läs meddelandet" };
    return { to: `/arenden/${id}`, label: "Öppna ärendet" };
  };
  return (
    <>
      {d.isCoach && (
        <Notice tone="info" title="Så fungerar påminnelserna">
          Du får en påminnelse när ett av dina ärenden saknar progression en vecka – veckomålet inte uppnått eller ingen godkänd avstämning. Påminnelsen skickas {d.reminderSchedule}.
        </Notice>
      )}
      {d.isEscalationRole && (
        <Notice tone="warn" title="Tidig uppmärksamhet">
          Ärenden med {d.escalateAfterWeeks} veckor i rad utan progression eskaleras till dig. <b>Coachen ser sina påminnelser men inte att ärendet har eskalerats</b> – det styrs av
          behörigheten.
        </Notice>
      )}
      <Row between>
        <Seg
          ariaLabel="Filter"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "alla", label: `Alla (${all.length})` },
            { value: "olasta", label: `Olästa (${unread.length})` },
            ...kinds.map((k) => ({ value: k, label: KIND[k].label, icon: KIND[k].icon })),
          ]}
        />
        {d.isEscalationRole && (
          <DemoOnly>
            <PerspectiveLink role="coach" to="/notiser" label="Se coachens notiser (Amira)" />
          </DemoOnly>
        )}
      </Row>
      <Card flush>
        {list.length === 0 ? (
          <Empty icon="bell" title="Inga notiser">
            När du får ett ärende tilldelat eller en påminnelse visas den här.
          </Empty>
        ) : (
          <div className="flex flex-col" data-notif-list="">
            {list.map((n) => {
              const k = KIND[n.kind] ?? KIND.assignment;
              const isOpen = open === n.id;
              const go = target(n);
              const hasEmail = n.channels.includes("email");
              return (
                <div
                  key={n.id}
                  data-notif={n.id}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3.5 gap-y-2 border-b border-ljusgra px-[18px] py-3.5 last:border-b-0 max-[620px]:grid-cols-[auto_minmax(0,1fr)]",
                    !n.readAt && "shadow-[inset_4px_0_0_var(--color-rod)]",
                  )}
                >
                  <Icon name={k.icon} size="lg" className={n.kind === "progress_escalation" ? "text-rod" : undefined} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <Row gap="sm">
                      <Badge tone={k.tone}>{k.label}</Badge>
                      {!n.readAt && <Badge tone="dark">Oläst</Badge>}
                      <span className="text-small text-text-muted">{fmtDateTime(n.createdAt)}</span>
                    </Row>
                    <div className="font-bold">{n.title}</div>
                    <div>{n.body}</div>
                    <Row gap="sm" className="text-small text-text-muted">
                      <span>Kanaler:</span>
                      {n.channels.map((ch) => (
                        <Badge key={ch} tone="outline" icon={ch === "email" ? "mail" : "bell"}>
                          {ch === "email" ? "E-post" : "I appen"}
                        </Badge>
                      ))}
                      {hasEmail && (
                        <Button kind="ghost" className="px-1.5 py-0.5" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : n.id)}>
                          Visa e-postens text
                        </Button>
                      )}
                    </Row>
                    {isOpen && (
                      <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted">
                        <Icon name="mail" className="mt-px" />
                        <div>
                          <b className="font-bold text-antracit">E-post (utan personuppgifter):</b> {n.emailBody}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 max-[620px]:col-span-full max-[620px]:pl-9">
                    {go && (
                      <Button
                        iconRight="arrow-right"
                        onClick={() => {
                          void onRead([n.id]);
                          nav.push(go.to);
                        }}
                      >
                        {go.label}
                      </Button>
                    )}
                    {!n.readAt && (
                      <Button kind="ghost" icon="check" onClick={() => void onRead([n.id])}>
                        Läst
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <DemoNote>
        {d.isEscalationRole || d.isAdmin
          ? "Påminnelser och eskaleringar räknas fram av reglerna i Admin → Avtal och konfiguration → Interna regler."
          : "Påminnelser räknas fram av reglerna i adminvyn."}{" "}
        I den riktiga tjänsten skickas de av ett schemalagt jobb och lagras i en tabell där varje rad bara kan läsas av sin mottagare (radnivåsäkerhet).
      </DemoNote>
    </>
  );
}
