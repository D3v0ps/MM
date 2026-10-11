"use client";
// Handläggarens startsida i portalen (/portal) – prototypens kom.start. Uppgifter som väntar på beslut står överst, sedan de
// tre stora knapparna (huvudhandlingen Beställ ny insats), sedan olästa rapporter och meddelanden. Ingen annan navigering på
// sidan (portallayouten visar ingen meny här). Beslut 2026-10-09 ("Vi behöver inte visa så mycket till kommunens
// handläggare"): inga händelser och inga siffror under knapparna.
import { useCommand, useQuery } from "@/shell/backend";
import { path } from "@/shell/nav";
import { Badge, BigButton, BigButtons, Button, Card, ErrorNotice, List, ListItem, Loading, Notice, PerspectiveLink, useToast } from "@/ui";
import { kommunStart, kommunTaskDone, type KomStart, type KomTask } from "../api";
import { CONTACT_PHONE, fDT, fullText } from "../texts";
import { KIND_ICON, KomHead, KomPage, LeadIcon, SubLine, TitleRow, UNREAD_EDGE, reportPath } from "./parts";

/** "Miljonbemanning behöver ditt beslut om BOT-26-0148" */
export const taskTitle = (t: KomTask): string =>
  t.kind === "customer_decision" ? `Miljonbemanning behöver ditt beslut${t.caseNumber ? ` om ${t.caseNumber}` : ""}` : `Uppgift från Miljonbemanning${t.caseNumber ? ` om ${t.caseNumber}` : ""}`;

/** Markera en uppgift som klar (kom.taskDone) med samma besked som prototypen. */
export function useTaskDone() {
  const done = useCommand(kommunTaskDone);
  const toast = useToast();
  return async (t: KomTask) => {
    const res = await done.run({ taskId: t.id }).catch(() => null);
    if (res && res.ok) toast("Uppgiften är klar och är borttagen från listan.");
    else toast("Uppgiften kunde inte markeras som klar.", "error");
  };
}

const deltagarePath = (caseId: string, flik?: string) => path(`/portal/deltagare/${encodeURIComponent(caseId)}`, { flik });

export function PortalStartScreen() {
  const q = useQuery(kommunStart, {});
  if (q.error) return <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) return <Loading />;
  return <StartContent d={q.data} />;
}

function StartContent({ d }: { d: KomStart }) {
  const doneTask = useTaskDone();
  const items = [...d.unreadMessages.map((m) => ({ key: m.id, msg: m, rep: null })), ...d.unreadReports.map((r) => ({ key: r.id, msg: null, rep: r }))];
  const shown = items.slice(0, 3);
  const nothing = d.tasks.length + items.length === 0;
  const allUnread = path("/portal/rapporter", { filter: "olasta", flik: d.unreadReports.length === 0 ? "meddelanden" : null });
  return (
    <KomPage>
      <KomHead eyebrow={d.unit ? `${d.unit} · ${d.customerName}` : d.customerName} title={`Välkommen, ${d.firstName}`} lead="Vad vill du göra i dag?" />
      {d.profileIncomplete && (
        <Notice tone="info" title="Fyll i dina uppgifter">
          <p className="m-0">Vi behöver ditt telefonnummer och din enhet för att kunna kontakta dig om dina beställningar. Fyll i det som saknas under Mina uppgifter.</p>
          <span className="mt-3 flex">
            <Button kind="primary" icon="user" to="/portal/mina-uppgifter">
              Fyll i dina uppgifter
            </Button>
          </span>
        </Notice>
      )}
      {d.tasks.length > 0 && (
        <Card title={`Att göra (${d.tasks.length})`} icon="flag" tone="red" flush>
          <List>
            {d.tasks.map((t) => (
              <ListItem
                key={t.id}
                lead={<LeadIcon name="flag" />}
                title={
                  <TitleRow>
                    <span>{taskTitle(t)}</span>
                    <Badge tone="dark">Ny</Badge>
                  </TitleRow>
                }
                sub={fullText(t.text)}
              >
                <SubLine>Från Miljonbemanning · {fDT(t.createdAt)}</SubLine>
                <span className="mt-2 flex flex-wrap items-center gap-3">
                  {t.caseId && (
                    <Button kind="primary" icon="message" to={deltagarePath(t.caseId, "meddelanden")}>
                      Läs och svara
                    </Button>
                  )}
                  <Button kind="ghost" icon="check" onClick={() => void doneTask(t)}>
                    Markera som klar
                  </Button>
                </span>
              </ListItem>
            ))}
          </List>
        </Card>
      )}
      {/* Huvudhandlingen direkt efter uppgifterna som väntar på beslut – de olästa kommer efter (beslut D8, C6). */}
      <BigButtons ariaLabel="Vad vill du göra?">
        <BigButton primary icon="file-plus" title="Beställ ny insats" sub="Tre korta steg och en granskning. Det tar ungefär fem minuter." to="/portal/bestall" />
        <BigButton icon="users" title="Mina deltagare" to="/portal/deltagare" />
        <BigButton icon="mail" title="Rapporter och meddelanden" to="/portal/rapporter" />
      </BigButtons>
      {items.length > 0 && (
        <Card
          title={`Olästa rapporter och meddelanden (${items.length})`}
          icon="mail"
          flush
          foot={
            items.length > shown.length ? (
              <Button iconRight="arrow-right" to={allUnread}>
                Visa alla olästa ({items.length})
              </Button>
            ) : undefined
          }
        >
          <List>
            {shown.map((it) =>
              it.msg ? (
                <ListItem
                  key={it.key}
                  to={deltagarePath(it.msg.caseId, "meddelanden")}
                  className={UNREAD_EDGE}
                  chevron
                  lead={<LeadIcon name={it.msg.meeting ? "calendar" : "message"} />}
                  title={
                    <TitleRow>
                      <span>
                        {it.msg.meeting ? "Mötesförfrågan" : "Nytt meddelande"} om {it.msg.caseNumber}
                      </span>
                      <Badge tone="dark">Ny</Badge>
                    </TitleRow>
                  }
                  sub={`Från ${it.msg.senderLabel} · ${fDT(it.msg.createdAt)}`}
                />
              ) : it.rep ? (
                <ListItem
                  key={it.key}
                  to={reportPath(it.rep.id, "start")}
                  className={UNREAD_EDGE}
                  chevron
                  lead={<LeadIcon name={KIND_ICON[it.rep.kind] ?? "file"} />}
                  title={
                    <TitleRow>
                      <span>{it.rep.title}</span>
                      <Badge tone="dark">Ny</Badge>
                    </TitleRow>
                  }
                  sub={it.rep.sub}
                >
                  <SubLine>Levererad {fDT(it.rep.deliveredAt)}</SubLine>
                </ListItem>
              ) : null,
            )}
          </List>
        </Card>
      )}
      {nothing && (
        <Notice tone="ok" title="Du är uppdaterad">
          Du har inga uppgifter och inga olästa rapporter eller meddelanden.
        </Notice>
      )}
      {CONTACT_PHONE && (
        <p className="max-w-[62ch] text-text-muted">
          Har du frågor kan du ringa oss på {CONTACT_PHONE}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <PerspectiveLink role="samordnare" to="/min-vecka" label="Se startsidan hos Miljonbemanning" />
      </div>
    </KomPage>
  );
}
