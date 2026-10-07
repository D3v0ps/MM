"use client";
// Deltagarkortets flikar Händelser och utfall, Avvikelser (med kallelse till kommunen) och Praktik (prototypens views/arenden.js).
import { useState, type FormEvent } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import { dayOf, fmtDate, fmtDateTime, fmtDateTimeLong } from "@/core/time";
import { RESULT_CLASS_LABEL } from "@/core/labels";
import {
  Badge, BuildPhase, Button, Card, Check, DateInput, DateTimeInput, DemoNote, Empty, Field, FormGrid, Icon, Kv, List, ListItem, Modal, Notice, Select, SlaBadge, Split, Stack,
  TextArea, cn, toast, useConfirm, type IconName,
} from "@/ui";
import { deviationCallCustomer, deviationSave } from "@/features/coach/api";
import { caseDeviations, caseEvents, casePlacements, type CaseDeviationRow, type CaseDeviations } from "../api";
import { canOpen, caseLink, clip, fd, FOUR, Label, MiniList, PLACEMENT, PNR_ERROR, PNR_RE, TabQuery, withDot } from "./common";
import { CustSwitch, type TabProps } from "./kort";

// ---------------------------------------------------------------- Händelser och utfall
const eventIcon = (kind: string): IconName =>
  kind === "praktik_startad" ? "briefcase" : kind === "arbete_paborjat" || kind === "arbetserbjudande" ? "award" : kind === "studier_paborjade" ? "book" : "target";

export function TabHandelser({ card }: TabProps) {
  const q = useQuery(caseEvents, { caseId: card.caseId });
  const role = useSession().actor.role;
  const team = card.access === "team";
  const can = canOpen("coach.handelse", role) && card.edit;
  return (
    <TabQuery q={q}>
      {(e) => {
        const prelim = e.result?.resultClass === "result" && !e.result.verifiedAt;
        const shown = e.events;
        return (
          <Stack>
            {!team && (
              <Card
                title="Utfall"
                icon="target"
                actions={
                  <div className="flex flex-wrap items-center gap-1.5">
                    {can && (card.status === "active" || card.status === "closed") && <Button icon="plus" to={caseLink("/handelse", card.caseId)}>Registrera händelse</Button>}
                    {can && card.status === "active" && <Button icon="check-square" to={caseLink("/handelse", card.caseId, { lage: "avslut" })}>Avsluta insatsen</Button>}
                  </div>
                }
              >
                <Stack gap="sm">
                  {card.status === "closed" && e.result ? (
                    <Kv
                      items={[
                        ["Avslutad", fmtDate(e.result.endDate)],
                        ["Avslutsorsak", e.result.endReasonLabel],
                        [
                          "Resultatklass",
                          <span key="rc" className="flex flex-wrap items-center gap-1.5">
                            {e.result.resultClass === "result" ? (
                              <Badge tone="blue" icon="award">{RESULT_CLASS_LABEL.result}</Badge>
                            ) : e.result.resultClass === "excluded" ? (
                              <Badge tone="grey" icon="minus-circle">{RESULT_CLASS_LABEL.excluded}</Badge>
                            ) : (
                              <Badge tone="outline" icon="circle">{e.result.resultClass ? RESULT_CLASS_LABEL[e.result.resultClass] : "Ej klassad"}</Badge>
                            )}
                            {prelim && <Badge tone="red" icon="alert-circle">Preliminärt</Badge>}
                          </span>,
                        ],
                        e.result.resultClass === "result"
                          ? ["Verifiering", e.result.verifiedAt ? `Verifierad ${fmtDate(e.result.verifiedAt)}` : "Saknas – räknas som resultat först när verifiering har registrerats."]
                          : null,
                      ]}
                    />
                  ) : (
                    <p>
                      Insatsen {card.status === "active" ? "pågår" : "har inte startat"}. Resultatet klassas vid avslut enligt avtalets resultatdefinition. Arbete och studier räknas först när
                      verifiering har registrerats – innan dess visas de som preliminära.
                    </p>
                  )}
                  {e.resultDefinitionUnset && (
                    <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted">
                      <Icon name="info" className="mt-px" />
                      <div>
                        <b className="font-bold text-antracit">Resultatdefinitionen är ej fastställd i avtalet.</b> {e.prototypeDefinition}
                      </div>
                    </div>
                  )}
                </Stack>
              </Card>
            )}
            <Card flush title={team ? `Arbetsgivarkontakter och händelser (${shown.length})` : `Händelser (${shown.length})`} icon="award">
              {team && (
                <div className="px-[18px] pt-4">
                  <p className="text-text-muted">
                    Arbetsgivarkontakter i godkända avstämningar: <b>{e.checkInContacts}</b>. Coachens anteckningar visas inte.
                  </p>
                </div>
              )}
              {shown.length === 0 ? (
                <Empty icon="award" title="Inga händelser ännu">Här registreras praktik, intervjuer, arbetserbjudanden, arbete, studier och validering.</Empty>
              ) : (
                <List>
                  {shown.map((ev) => (
                    <ListItem key={ev.id} data-mal={`ev:${ev.id}`} lead={<Icon name={eventIcon(ev.kind)} size="lg" />} title={ev.label} sub={`${fmtDate(ev.occurredOn)}${ev.actor ? ` · ${ev.actor}` : ""}`}>
                      {ev.note && <span className="text-small">{ev.note}</span>}
                      <span className="flex flex-wrap items-center gap-1.5">
                        {ev.verificationKind ? <Badge tone="bluetone" icon="paperclip">Verifierad: {ev.verificationKind}</Badge> : <Badge tone="outline" icon="help">Ingen verifiering</Badge>}
                        {ev.needsVerification && <Badge tone="red" icon="alert-circle">Preliminärt</Badge>}
                        {ev.possibleBonus && (
                          <>
                            <Badge tone="outline" icon="star">Möjligt bonusunderlag</Badge>
                            <BuildPhase fas={3} off />
                          </>
                        )}
                      </span>
                      {ev.possibleBonus && !e.bonusEnabled && <span className="text-small text-text-muted">Bonus: avstängd – modellen ej fastställd. Underlaget samlas in.</span>}
                    </ListItem>
                  ))}
                </List>
              )}
            </Card>
          </Stack>
        );
      }}
    </TabQuery>
  );
}

// ---------------------------------------------------------------- Avvikelser
const DEV_SUGGEST = [
  "Upprepad ogiltig frånvaro",
  "Planen håller inte – behöver omplanering",
  "Deltagaren har avbrutit praktiken",
  "Praktiska hinder påverkar insatsen (till exempel resor eller barnomsorg)",
];

export function TabAvvikelser({ card }: TabProps) {
  const q = useQuery(caseDeviations, { caseId: card.caseId });
  return <TabQuery q={q}>{(m) => <Deviations card={card} m={m} />}</TabQuery>;
}

function Deviations({ card, m }: { card: TabProps["card"]; m: CaseDeviations }) {
  const confirm = useConfirm();
  const save = useCommand(deviationSave);
  const [form, setForm] = useState(false);
  const [call, setCall] = useState<{ id: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const devs = m.deviations;
  const open = devs.filter((x) => x.open);
  const k = card.referrer;
  const cr = card.customerRole;
  const close = async (dv: CaseDeviationRow) => {
    const ok = await confirm({
      title: "Markera avvikelsen som åtgärdad?",
      confirmLabel: "Markera som åtgärdad",
      body: (
        <>
          <p>{dv.description}</p>
          <p className="text-text-muted">Avvikelsen finns kvar i historiken och i rapporterna.</p>
        </>
      ),
    });
    if (!ok) return;
    await save.run({ id: dv.id, caseId: card.caseId, data: { status: "closed" } }).catch(() => null);
    toast("Avvikelsen är markerad som åtgärdad.");
  };
  return (
    <Stack>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-text-muted">
          En avvikelse är alltid en åtgärd: vad har hänt, vad gör vi, vem ansvarar och när följer vi upp. Röd samlad status i en avstämning skapar en avvikelse automatiskt.
        </p>
        {card.edit && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button kind="primary" icon="calendar" className="whitespace-normal" onClick={() => setCall({ id: open[0] ? open[0].id : "" })}>
              Kalla kommunen till uppföljning
            </Button>
            {!form && (
              <Button icon="plus" onClick={() => setForm(true)}>
                Ny avvikelse
              </Button>
            )}
          </div>
        )}
      </div>
      {sent && (
        <Notice tone="ok" title="Kallelsen är skickad">
          <Stack gap="sm">
            <div>
              {k ? k.name : "Kommunen"} har fått ett säkert meddelande med förslag på tid {fmtDateTimeLong(sent)} och ett mejl utan personuppgifter.
            </div>
            {cr && (
              <div>
                <CustSwitch card={card} tab="meddelanden" label={(who) => `Se kallelsen som ${who}`} />
              </div>
            )}
          </Stack>
        </Notice>
      )}
      {form && (
        <Card title="Ny avvikelse" icon="flag">
          <DeviationForm
            card={card}
            m={m}
            onDone={(id, needsCust) => {
              setForm(false);
              if (id && needsCust) setCall({ id });
            }}
          />
        </Card>
      )}
      {m.repeated && open.length === 0 && (
        <Notice tone="warn" title="Upprepad ogiltig frånvaro är flaggad">
          {m.repeated.count} ogiltiga frånvarotillfällen inom {m.repeated.withinDays} dagar. Registrera en avvikelse med åtgärd och kalla kommunen till uppföljning.
        </Notice>
      )}
      {devs.length === 0 && !form && (
        <Card>
          <Empty icon="flag" title="Inga avvikelser registrerade">Avvikelser skapas här eller automatiskt när en avstämning får röd samlad status.</Empty>
        </Card>
      )}
      {devs.map((dv) => (
        <Card
          key={dv.id}
          data-mal={`dev:${dv.id}`}
          tone={dv.open ? "red" : undefined}
          title={dv.open ? "Öppen avvikelse" : "Åtgärdad avvikelse"}
          icon={dv.open ? "alert-circle" : "check-circle"}
          actions={
            <span className="text-small text-text-muted">
              {fmtDateTime(dv.createdAt)}
              {dv.fromCheckIn ? " · från veckoavstämning" : ""}
            </span>
          }
          foot={
            card.edit &&
            dv.open && (
              <>
                <Button icon="calendar" onClick={() => setCall({ id: dv.id })}>Kalla kommunen</Button>
                <Button kind="ghost" icon="check" onClick={() => void close(dv)}>Markera som åtgärdad</Button>
              </>
            )
          }
        >
          <Stack gap="sm">
            <div className="text-h3 font-bold">{dv.description}</div>
            <Kv
              items={[
                dv.assessment ? ["Bedömning", dv.assessment] : null,
                ["Åtgärd", dv.action || "–"],
                ["Ansvarig", dv.ownerName ?? "–"],
                [
                  "Uppföljning",
                  dv.followUpOn ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {fmtDate(dv.followUpOn)}
                      {dv.due && <SlaBadge sla={dv.due.sla} dueAt={dv.due.dueAt} />}
                    </span>
                  ) : (
                    "–"
                  ),
                ],
                ["Kommunens beslut", dv.needsCustomerDecision ? "Behövs" : "Behövs inte"],
                ["Uppföljningsmöte", dv.followUpMeetingAt ? `Föreslaget ${fmtDateTimeLong(dv.followUpMeetingAt)}` : "Inte föreslaget"],
              ]}
            />
          </Stack>
        </Card>
      ))}
      {card.readOnly && devs.length > 0 && <p className="text-text-muted">Läsläge – avvikelser hanteras av coach och samordnare.</p>}
      {call && (
        <CallModal
          card={card}
          m={m}
          devs={open}
          initialId={call.id}
          onClose={(ok, at) => {
            if (ok) setSent(at || m.now);
            setCall(null);
          }}
        />
      )}
    </Stack>
  );
}

type DevForm = { description: string; assessment: string; action: string; ownerId: string; followUpOn: string; needsCustomerDecision: boolean };

function DeviationForm({ card, m, onDone }: { card: TabProps["card"]; m: CaseDeviations; onDone: (id: string | null, needsCust?: boolean) => void }) {
  const save = useCommand(deviationSave);
  const [f, setF] = useState<DevForm>({ description: "", assessment: "", action: "", ownerId: m.defaultOwnerId ?? "", followUpOn: m.defaultFollowUpOn, needsCustomerDecision: false });
  const [err, setErr] = useState<Partial<Record<keyof DevForm, string | null>>>({});
  const set = <K extends keyof DevForm>(k2: K) => (v: DevForm[K]) => {
    setF((cur) => ({ ...cur, [k2]: v }));
    if (err[k2]) setErr((e) => ({ ...e, [k2]: null }));
  };
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const x: Partial<Record<keyof DevForm, string>> = {};
    if (!f.description.trim()) x.description = "Beskriv vad som har hänt.";
    if (!f.action.trim()) x.action = "En avvikelse ska alltid ha en åtgärd.";
    if (!f.ownerId) x.ownerId = "Välj vem som ansvarar för åtgärden.";
    if (!f.followUpOn) x.followUpOn = "Välj datum för uppföljning.";
    else if (f.followUpOn < m.today) x.followUpOn = "Datumet har redan passerat.";
    if (PNR_RE.test(`${f.description} ${f.assessment} ${f.action}`)) x.description = PNR_ERROR;
    setErr(x);
    if (Object.values(x).some(Boolean)) return;
    const res = await save
      .run({
        caseId: card.caseId,
        data: {
          description: f.description.trim(), assessment: f.assessment.trim(), action: f.action.trim(), ownerId: f.ownerId, followUpOn: f.followUpOn,
          needsCustomerDecision: !!f.needsCustomerDecision, followUpMeetingAt: null, status: "open",
        },
      })
      .catch(() => null);
    if (!res || !res.ok) {
      toast("Avvikelsen sparades inte.", "error");
      return;
    }
    toast(`Avvikelsen är sparad. Uppföljning senast ${fmtDate(f.followUpOn)}.`);
    onDone(res.deviationId, f.needsCustomerDecision);
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-small text-text-muted">Vanliga avvikelser:</span>
        {DEV_SUGGEST.map((s) => (
          <Button key={s} kind="ghost" className="h-auto max-w-full px-2.5 py-1.5 text-left whitespace-normal" onClick={() => set("description")(s)}>
            {s}
          </Button>
        ))}
      </div>
      <FormGrid>
        <Field label="Vad har hänt?" id="arn-dev-desc" required full error={err.description} help="Sakligt och funktionellt. Inga diagnoser eller omdömen om personen.">
          <TextArea value={f.description} onValueChange={set("description")} rows={2} />
        </Field>
        <Field label="Bedömning" id="arn-dev-assess" full help="Vad betyder det för insatsen? Till exempel risk för avbrott.">
          <TextArea value={f.assessment} onValueChange={set("assessment")} rows={2} />
        </Field>
        <Field label="Åtgärd" id="arn-dev-action" required full error={err.action} help="Vad gör vi nu? En avvikelse utan åtgärd kan inte sparas.">
          <TextArea value={f.action} onValueChange={set("action")} rows={2} />
        </Field>
        <Field label="Ansvarig" id="arn-dev-owner" required error={err.ownerId} help="Den som ser till att åtgärden blir gjord.">
          <Select value={f.ownerId} onValueChange={set("ownerId")} placeholder="Välj ansvarig" options={m.owners.map((u) => ({ value: u.id, label: u.label }))} />
        </Field>
        <Field label="Följs upp senast" id="arn-dev-follow" required error={err.followUpOn} help="Uppföljningen syns i Förfaller-listan.">
          <DateInput value={f.followUpOn} onValueChange={set("followUpOn")} />
        </Field>
        <div className="col-span-full">
          <Check id="arn-dev-cust" checked={f.needsCustomerDecision} onCheckedChange={set("needsCustomerDecision")}>
            Kräver beslut av kommunen (till exempel ändrad plan eller avbrott)
          </Check>
        </div>
      </FormGrid>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="primary" type="submit" icon="check" pending={save.pending}>Spara avvikelsen</Button>
        <Button kind="ghost" onClick={() => onDone(null)}>Avbryt</Button>
      </div>
    </form>
  );
}

const firstName = (name: string) => String(name || "").split(" ")[0];

function CallModal({
  card: c,
  m,
  devs,
  initialId,
  onClose,
}: {
  card: TabProps["card"];
  m: CaseDeviations;
  devs: CaseDeviationRow[];
  initialId: string;
  onClose: (ok: boolean, at?: string) => void;
}) {
  const { user } = useSession();
  const send = useCommand(deviationCallCustomer);
  const k = c.referrer;
  const defAt = m.defaultCallAt;
  const [devId, setDevId] = useState(initialId || (devs[0] ? devs[0].id : ""));
  const [at, setAt] = useState(defAt);
  const makeText = (id: string, when: string) => {
    const dv = devs.find((x) => x.id === id);
    return [
      `Hej ${k ? firstName(k.name) : ""}!`.replace(" !", "!"),
      `Vi vill kalla till ett uppföljningsmöte om ärende ${c.caseNumber}.`,
      dv
        ? [`Anledning: ${withDot(dv.description)}`, dv.assessment && `Vår bedömning: ${withDot(dv.assessment)}`, dv.action && `Förslag på åtgärd: ${withDot(dv.action)}`].filter(Boolean).join("\n")
        : "Anledning: vi behöver stämma av planen för insatsen tillsammans.",
      `Förslag på tid: ${when && /T\d{2}:\d{2}$/.test(when) ? fmtDateTimeLong(when) : "(välj tid)"} hos Miljonbemanning i ${c.location || "Alby"}. Det går också bra att ses via Teams. Passar tiden? Svara gärna här i portalen.`,
      `Med vänlig hälsning\n${user.name || "Miljonbemanning"}${user.title ? `, ${user.title.toLowerCase()}` : ""}\nMiljonbemanning`,
    ].join("\n\n");
  };
  const [body, setBody] = useState(() => makeText(devId, defAt));
  const [edited, setEdited] = useState(false);
  const [err, setErr] = useState<{ at?: string | null; body?: string | null }>({});
  const regen = (id: string, when: string) => {
    if (!edited) setBody(makeText(id, when));
  };
  const submit = async () => {
    const x: { at?: string; body?: string } = {};
    if (!at || !/T\d{2}:\d{2}$/.test(at)) x.at = "Välj datum och tid att föreslå.";
    else if (at < m.now) x.at = "Tiden har redan passerat. Välj en senare tid.";
    if (!body.trim()) x.body = "Skriv ett meddelande till kommunen.";
    else if (PNR_RE.test(body)) x.body = PNR_ERROR;
    setErr(x);
    if (Object.values(x).some(Boolean)) return;
    const res = await send.run({ caseId: c.caseId, deviationId: devId || null, body: body.trim(), proposedAt: at }).catch(() => null);
    if (!res || !res.ok) {
      toast("Kallelsen kunde inte skickas.", "error");
      return;
    }
    toast(`Kallelsen är skickad till ${k ? k.name : "kommunen"} som säkert meddelande. Mejlet innehåller bara ärendenumret.`);
    onClose(true, at);
  };
  return (
    <Modal
      wide
      title="Kalla kommunen till uppföljning"
      onClose={() => onClose(false)}
      footer={
        <>
          <Button kind="ghost" onClick={() => onClose(false)}>Avbryt</Button>
          <Button kind="primary" icon="send" pending={send.pending} onClick={() => void submit()}>Skicka kallelsen</Button>
        </>
      }
    >
      <p>Enligt avtalet kallar vi kommunen till uppföljning när en avvikelse kräver dialog eller beslut. Kontrollera texten och skicka.</p>
      <FormGrid>
        <Field label="Gäller avvikelse" id="arn-call-dev" help="Texten fylls i utifrån avvikelsen du väljer.">
          <Select
            value={devId}
            onValueChange={(v) => {
              setDevId(v);
              regen(v, at);
            }}
            placeholder="Ingen specifik avvikelse"
            options={devs.map((x) => ({ value: x.id, label: `${fd(x.createdAt, dayOf(m.now))} – ${clip(x.description, 60)}` }))}
          />
        </Field>
        <Field label="Föreslagen tid" id="arn-call-at" required error={err.at} help="Kommunen bekräftar eller föreslår en annan tid i svaret.">
          <DateTimeInput
            value={at}
            onValueChange={(v) => {
              setAt(v);
              regen(devId, v);
              if (err.at) setErr({ ...err, at: null });
            }}
          />
        </Field>
        <Field label="Meddelande till kommunen" id="arn-call-body" required full error={err.body} help="Skickas som säkert meddelande i portalen. Du kan ändra texten.">
          <TextArea
            value={body}
            onValueChange={(v) => {
              setBody(v);
              setEdited(true);
              if (err.body) setErr({ ...err, body: null });
            }}
            rows={11}
          />
        </Field>
      </FormGrid>
      <Card tone="sub">
        <Stack gap="sm">
          <Label className="m-0">Det här får kommunen</Label>
          <MiniList
            items={[
              { key: "msg", icon: "lock", children: <><b>Ett säkert meddelande i portalen</b> med texten ovan. {k ? k.name : "Handläggaren"} läser det under ärendet efter inloggning.</> },
              { key: "mail", icon: "mail", children: <><b>Ett mejl till {k?.email || "handläggaren"}</b> utan personuppgifter: ”Du har ett nytt meddelande om ärende {c.caseNumber} – logga in för att läsa.”</> },
            ]}
          />
        </Stack>
      </Card>
    </Modal>
  );
}

// ---------------------------------------------------------------- Praktik
export function TabPraktik({ card }: TabProps) {
  const q = useQuery(casePlacements, { caseId: card.caseId });
  const role = useSession().actor.role;
  const team = card.access === "team";
  return (
    <TabQuery q={q}>
      {(p) => (
        <Stack>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[70ch] text-text-muted">Varje praktikplats ska ha de fyra rätten: rätt arbetsuppgifter, rätt handledning, rätt tidpunkt och rätt uppföljning.</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <BuildPhase fas={3} />
              {canOpen("praktik.arbetsgivare", role) && <Button icon="briefcase" to="/praktik">Arbetsgivarregistret</Button>}
            </div>
          </div>
          {p.placements.length === 0 && (
            <Card>
              <Empty icon="briefcase" title="Ingen praktik ännu">
                Praktik planeras oftast i fas {p.phase < 4 ? "4" : p.phase}. Coachen bedömer när deltagaren är redo (rätt tidpunkt).
              </Empty>
            </Card>
          )}
          {p.placements.map((pl) => {
            const missing = FOUR.filter(([key]) => !pl.fourRights[key]);
            const ongoing = pl.status === "ongoing";
            return (
              <Card
                key={pl.id}
                data-mal={`pl:${pl.id}`}
                title={pl.employerName ?? "Praktikplats"}
                icon="building"
                tone={missing.length && ongoing ? "red" : undefined}
                actions={<Badge tone={ongoing ? "blue" : "grey"} icon={ongoing ? "play" : "check"}>{PLACEMENT[pl.status] ?? pl.status}</Badge>}
              >
                <Stack>
                  {missing.length > 0 && ongoing && (
                    <Notice tone="warn" title={`Saknas: ${missing.map((x) => x[1].toLowerCase()).join(", ")}`}>
                      Komplettera före nästa uppföljningsdatum. Praktikplatsen ska vara förberedd innan deltagaren börjar.
                    </Notice>
                  )}
                  <Split>
                    <Kv
                      items={[
                        ["Period", `${fmtDate(pl.startsOn)} – ${fmtDate(pl.endsOn)}`],
                        ["Arbetsuppgifter", pl.tasks || "–"],
                        ["Mål", pl.goals || "–"],
                        ["Handledare", pl.supervisorName || "–"],
                      ]}
                    />
                    <Kv
                      items={[
                        ["Kontaktperson", pl.contactName ?? "–"],
                        ["Telefon", pl.phone ?? "–"],
                        [
                          "Uppföljning",
                          pl.followUpDates.length ? (
                            <MiniList
                              key="f"
                              items={pl.followUpDates.map((x) => ({
                                key: x,
                                icon: x < p.today ? "check" : "calendar",
                                children: (
                                  <>
                                    {fmtDate(x)}
                                    <span className="text-small text-text-muted"> · {x < p.today ? "genomförd" : x === p.today ? "i dag" : "planerad"}</span>
                                  </>
                                ),
                              }))}
                            />
                          ) : (
                            "Inga datum planerade"
                          ),
                        ],
                      ]}
                    />
                  </Split>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2">
                    {FOUR.map(([key, label, help]) => {
                      const ok = !!pl.fourRights[key];
                      return (
                        // Kortet är redan rött när något saknas – rutan får tjockare antracit ram och röd ikon, inte en röd ram i den röda rutan.
                        <div key={key} className={cn("flex min-w-0 items-start gap-2.5 rounded-mb border-[1.5px] border-ljusgra px-3 py-2.5", !ok && "border-2 border-antracit")}>
                          <Icon name={ok ? "check-circle" : "x-circle"} className={ok ? undefined : "text-rod"} />
                          <div>
                            <div className="font-bold">
                              {label} · {ok ? "Uppfyllt" : "Saknas"}
                            </div>
                            <div className="text-small text-text-muted">{help}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Stack>
              </Card>
            );
          })}
          <Card title="Arbetsgivarkontakter" icon="users" flush>
            <div className="px-[18px] pt-4 pb-1">
              <p>
                I godkända veckoavstämningar: <b>{p.checkInContacts}</b> kontakter. Registrerade händelser: <b>{p.contacts.length}</b>.
              </p>
            </div>
            {p.contacts.length === 0 ? (
              <div className="px-[18px] py-4">
                <p className="text-text-muted">Inga registrerade arbetsgivarkontakter ännu.</p>
              </div>
            ) : (
              <List>
                {p.contacts.map((e) => (
                  <ListItem key={e.id} icon="building" title={e.actor || "Arbetsgivare"} sub={`${e.label} · ${fmtDate(e.occurredOn)}`} />
                ))}
              </List>
            )}
          </Card>
          {team && <DemoNote>Som handledare ser du praktik och arbetsgivarkontakter men inte coachens anteckningar.</DemoNote>}
        </Stack>
      )}
    </TabQuery>
  );
}
