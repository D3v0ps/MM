"use client";
// Kort i avropsinkorgens detaljvy: originalmejlet, tolkat formulär, beställningen, automatiskt svar, dubblettkontroll,
// orderbekräftelsen och avslaget (prototypens OriginalCard, ParsedCard, CaseFieldsCard, AckCard, DuplicateCard,
// ConfirmationCard och DeclinedCard).
import { useState } from "react";
import { pct } from "@/core/format";
import { useCommand, useQuery } from "@/shell/backend";
import { AiTag, Badge, Button, Card, CaseLink, CaseStatusBadge, ErrorNotice, Icon, Kv, Loading, Notice, PerspectiveLink } from "@/ui";
import {
  inboxConfirmation, inboxRevealPnr, type AckView, type CaseFieldsView, type DeclinedView, type DuplicateView, type ItemCase, type OriginalView, type ParsedView,
} from "../api";
import { LOW, METHOD } from "../texts";
import { Caps, FieldRow, GroupTitle, IconLine, KommunSwitch, Legend, Quote, usePersona, useIsDemo, WrapBtns } from "./parts";

export function OriginalCard({ o }: { o: OriginalView }) {
  const reveal = useCommand(inboxRevealPnr);
  const [shown, setShown] = useState<string | null>(null);
  const show = async () => {
    const r = await reveal.run({ emailId: o.emailId });
    if (r.ok) setShown(r.text);
  };
  return (
    <Card title="Originalmejlet" icon="mail">
      <div className="flex flex-col gap-4">
        <dl className="m-0 grid gap-1.5">
          {[["Från", `${o.fromName} <${o.fromAddress}>`], ["Till", "avrop@miljonbemanning.se"], ["Mottaget", o.receivedLong], ["Ämne", o.subject]].map(([k, v]) => (
            <div key={k} className="flex min-w-0 flex-wrap gap-x-2.5">
              <dt className="min-w-[84px] font-semibold text-text-muted">{k}</dt>
              <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
        <pre className="m-0 rounded-mb bg-ljusgra-ton px-3.5 py-3 [font:inherit] leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]">{shown ?? o.body}</pre>
        {o.hasPnr && (
          <div className="flex flex-wrap items-center gap-1.5 text-small text-text-muted">
            <Icon name="eye-off" />
            <span>Personnummer i mejltexten visas maskerat.</span>
            {!shown && o.mayReveal && (
              <Button kind="ghost" icon="eye" className="px-2 py-1" pending={reveal.pending} onClick={() => void show()}>
                Visa
              </Button>
            )}
            {shown && <span>(visning loggad)</span>}
          </div>
        )}
        {o.attachments.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Caps>Bilagor</Caps>
            <div className="flex flex-wrap items-center gap-1.5">
              {o.attachments.map((a) => (
                <Badge key={a} tone="outline" icon="paperclip">{a}</Badge>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-small text-text-muted">Inga bilagor.</div>
        )}
      </div>
    </Card>
  );
}

export function ParsedCard({ p }: { p: ParsedView }) {
  const head = p.method === "ai" ? <AiTag>Tolkat med AI</AiTag> : <Badge tone="outline" icon="file">Word-mall · utan AI</Badge>;
  return (
    <Card title="Tolkat formulär" icon="clipboard" actions={head} flush>
      <Legend>
        <span>{p.help}</span>
        <span className="inline-flex items-center gap-1.5"><Icon name="alert" /><b>{p.nMissing}</b> saknas</span>
        <span className="inline-flex items-center gap-1.5"><Icon name="alert-circle" /><b>{p.nLow}</b> osäkra (under {pct(LOW, 0)})</span>
        {p.aiRun && <span>{p.aiRun}</span>}
      </Legend>
      <div className="@container">
        {p.groups.map((g) => (
          <div key={g.title}>
            <GroupTitle>{g.title}</GroupTitle>
            {g.fields.map((f) => <FieldRow key={f.key} f={f} />)}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Beställning utan mejl (portal eller telefon) – samma tre steg som mallen, utan konfidens. */
export function CaseFieldsCard({ v }: { v: CaseFieldsView }) {
  const m = METHOD[v.method];
  return (
    <Card title={v.title} icon="clipboard" actions={<Badge tone="outline" icon={m.icon}>{m.label}</Badge>} flush>
      <Legend>
        <span>{m.help}</span>
      </Legend>
      <div className="@container">
        {v.groups.map((g) => (
          <div key={g.title}>
            <GroupTitle>{g.title}</GroupTitle>
            {g.fields.map((f) => <FieldRow key={f.key} f={f} />)}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AckCard({ a, c }: { a: AckView; c: ItemCase | null }) {
  const demo = useIsDemo();
  const foot = c && demo ? <WrapBtns><KommunSwitch c={c} /></WrapBtns> : undefined;
  if (a.kind === "none") {
    return (
      <Card title="Automatiskt svar" icon="mail" foot={foot}>
        <p className="text-text-muted">{a.text}</p>
      </Card>
    );
  }
  return (
    <Card title={a.generic ? "Generisk mottagningsbekräftelse" : "Ordererkännande"} icon="mail" foot={foot}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={a.ok ? "blue" : "red"} icon={a.ok ? "check" : "alert"}>{a.ok ? `Skickat automatiskt efter ${a.mins} min` : `Sent – ${a.mins} min`}</Badge>
          <span className="text-small text-text-muted">{a.when} · krav: inom {a.limit} minuter</span>
        </div>
        <div className="text-small text-text-muted">Till {a.to}</div>
        <Quote>{a.body}</Quote>
        {a.leak ? (
          <Notice tone="critical" title="Personuppgifter i utskicket">Texten innehåller namn eller personnummer. Det får aldrig hända – anmäl till systemadministratören.</Notice>
        ) : (
          <IconLine icon="shield" className="text-small">
            <b>Inga personuppgifter.</b>{" "}
            {a.generic
              ? "Svaret nämner varken deltagaren eller något ärendenummer, eftersom inget ärende skapas automatiskt."
              : "Svaret innehåller bara ärendenumret. Kommunen uppmanas använda det i stället för personnummer."}
          </IconLine>
        )}
      </div>
    </Card>
  );
}

export function DuplicateCard({ d }: { d: DuplicateView }) {
  return (
    <Card title="Dubblettkontroll" icon="users">
      {d.dups.length > 0 ? (
        <Notice tone="warn" title="Personen har redan en aktiv insats">
          <div className="flex flex-col gap-2">
            <span>
              {d.dups.map((x) => (
                <span key={x.caseId} className="inline-flex flex-wrap items-center gap-1.5">
                  <CaseLink caseId={x.caseId} caseNumber={x.caseNumber} />
                  <CaseStatusBadge status={x.status} />
                </span>
              ))}
            </span>
            <span>En person får inte ha två aktiva ärenden samtidigt. Avböj med orsaken dubblett, eller kontakta handläggaren.</span>
          </div>
        </Notice>
      ) : (
        <Notice tone="ok" title="Ingen annan aktiv insats">Kontrollerat mot personnumret inom avtalet. En person kan ha flera ärenden över tid, men inte två aktiva samtidigt.</Notice>
      )}
      <div className="mt-2.5 text-small text-text-muted">Sökningen görs på en krypterad kontrollsumma av personnumret, aldrig i klartext.</div>
    </Card>
  );
}

/** Orderbekräftelsen (efter att avropet accepterats). Hämtar sin egen vy-modell. */
export function ConfirmationCard({ caseId }: { caseId: string }) {
  const q = useQuery(inboxConfirmation, { caseId });
  const coach = usePersona("coach");
  const demo = useIsDemo();
  if (q.error) return <ErrorNotice error={q.error} />;
  if (q.isLoading || q.data === undefined) return <Loading />;
  const v = q.data;
  if (!v) return null;
  return (
    <Card
      tone="blue"
      title="Orderbekräftelse skickad"
      icon="check-circle"
      actions={v.reportId ? <Button kind="secondary" iconRight="arrow-right" to={`/rapporter/${encodeURIComponent(v.reportId)}`}>Öppna</Button> : null}
      foot={demo ? (
        <WrapBtns>
          <KommunSwitch c={{ id: v.caseId, referrerId: v.referrerId }} />
          {coach && v.leadCoachId === coach.userId && <PerspectiveLink role="coach" userId={coach.userId} to="/notiser" label={`Se ${coach.name.split(" ")[0]}s notis`} />}
        </WrapBtns>
      ) : undefined}
    >
      <div className="flex flex-col gap-4">
        <Kv
          items={[
            ["Ärendenummer", <span key="n" className="font-bold tabular-nums tracking-[0.01em]">{v.caseNumber}</span>],
            ["Bekräftad", v.confirmed],
            ["Huvudcoach", v.coachName],
            ["Team", v.team],
            ["Första möte", v.firstMeeting],
            ["Planerad omfattning", v.planned],
            ["Beställningens värde", v.value],
            ["Beställarreferens", v.buyerReference],
          ]}
        />
        {v.leadNotif && (
          <Notice tone="ok" icon="bell" title={v.leadNotif.title}>
            I appen och som e-post utan personuppgifter: <q>{v.leadNotif.emailBody}</q>
            {v.leadNotif.others}
          </Notice>
        )}
        <div className="flex flex-col gap-2 text-small">
          {v.custMail && <IconLine icon="mail"><b>Kommunen fick:</b> {v.custMail}</IconLine>}
          {v.isProtected ? (
            <IconLine icon="lock"><b>Deltagaren:</b> ingen kallelse via SMS eller e-post (skyddade personuppgifter). Coachen ringer enligt den säkra rutinen.</IconLine>
          ) : (
            v.kallelse && <IconLine icon={v.kallelse.icon}><b>{v.kallelse.title}</b> {v.kallelse.body}</IconLine>
          )}
        </div>
      </div>
    </Card>
  );
}

export function DeclinedCard({ d }: { d: DeclinedView }) {
  return (
    <Card tone="red" title="Avropet är avböjt" icon="x-circle">
      <div className="flex flex-col gap-4">
        <Kv items={[["Avböjt", `${d.when}${d.by ? ` av ${d.by}` : ""}`], ["Orsak", d.reason]]} />
        {d.mail && <IconLine icon="mail" className="text-small"><b>Kommunen fick:</b> {d.mail}</IconLine>}
        <div className="text-small text-text-muted">Orsaken är loggad och syns för kommunen i portalen. Avböjda avrop följs upp i avtalsuppföljningen.</div>
      </div>
    </Card>
  );
}
