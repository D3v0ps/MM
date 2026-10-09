"use client";
// Händelser och avslut (/handelse/:caseId?lage=avslut) – händelser enligt mall 02 avsnitt 5 och avslut av insatsen.
// Avslutsorsak och resultat väljer coachen själv; arbete och studier räknas som resultat först när verifiering finns.
// Port av prototypens coach.handelse.
import { useState } from "react";
import { fmtDate, fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { ProtoText, useRuntime } from "@/shell/runtime";
import {
  Badge, BuildPhase, Button, Card, CellSub, DateInput, Field, FormGrid, Icon, Input, Notice, Page, Row, Seg, SlaBadge, Split, Stack, Table, TextArea, toast, useConfirm,
  type BadgeTone, type IconName,
} from "@/ui";
import { caseClose } from "@/features/arenden/api";
import { eventAdd, eventsPage, type EventsPage } from "../api";
import { cap, CaseHeadView, caseCrumbs, CasePicker, Chips, customerPerspective, GateView, lc, PageState, Persp, useCaseView } from "./shared";

type Ok = Extract<EventsPage, { kind: "ok" }>;
type Mode = "event" | "close";
const VERIFICATION = ["Anställningsbevis", "Antagningsbesked", "Praktikavtal", "Intyg eller diplom", "E-post från arbetsgivare", "Ingen verifiering ännu"];
const FILE_FOR: Record<string, string> = {
  Anställningsbevis: "anstallningsbevis.pdf", Antagningsbesked: "antagningsbesked.pdf", Praktikavtal: "praktikavtal.pdf", "Intyg eller diplom": "intyg.pdf", "E-post från arbetsgivare": "e-post.pdf",
};
const fileFor = (x: string | null) => (x && FILE_FOR[x]) || "underlag.pdf";

type Preview = { tone: BadgeTone; icon: IconName; label: string; text: string };
function resultPreview(v: Ok, reason: string | null, verified: boolean): Preview | null {
  if (!reason) return null;
  if (v.result.countsAsResult.includes(reason)) {
    return verified
      ? { tone: "blue", icon: "check-circle", label: "Resultat – verifierat", text: "Räknas som resultat i resultatgraden." }
      : { tone: "outline", icon: "clock", label: "Resultat – preliminärt", text: "Räknas som resultat först när verifiering (anställningsbevis eller antagningsbesked) är registrerad." };
  }
  if (v.result.excluded.includes(reason)) return { tone: "grey", icon: "minus-circle", label: "Exkluderas ur nämnaren", text: "Räknas varken som resultat eller i nämnaren (preliminär regel)." };
  return { tone: "outline", icon: "x-circle", label: "Ej resultat", text: "Räknas i nämnaren men inte som resultat." };
}

export function HandelseScreen({ params, query }: ScreenProps) {
  const close = query.get("lage") === "avslut";
  if (!params.caseId) {
    return (
      <CasePicker
        kind="handelse"
        title={close ? "Avsluta insatsen" : "Registrera händelse"}
        lead="Välj deltagare."
        basePath="/handelse"
        query={close ? { lage: "avslut" } : undefined}
        actionLabel="Välj"
      />
    );
  }
  return <Handelse caseId={params.caseId} mode0={close ? "close" : "event"} />;
}

function Handelse({ caseId, mode0 }: { caseId: string; mode0: Mode }) {
  const q = useQuery(eventsPage, { caseId });
  const v = q.data;
  if (!v) return <PageState title={mode0 === "close" ? "Avsluta insatsen" : "Händelser och utfall"} error={q.error} onRetry={() => void q.refetch()} />;
  if (v.kind === "gate") return <GateView gate={v.gate} title="Händelser" listPath="/handelse" />;
  return <EventForm key={`${caseId}|${mode0}`} v={v} mode0={mode0} />;
}

type Ev = { kind: string | null; occurredOn: string; actor: string; verificationKind: string | null; file: string; note: string };
type Cl = { endDate: string; endReason: string | null; verified: "yes" | "no"; verificationKind: string | null; file: string };

function EventForm({ v, mode0 }: { v: Ok; mode0: Mode }) {
  const demo = useRuntime() === "demo";
  const add = useCommand(eventAdd);
  const close = useCommand(caseClose);
  const confirm = useConfirm();
  useCaseView(v.head.caseId);
  const c = v.head;
  const today = v.now.slice(0, 10);
  const [mode, setMode] = useState<Mode>(mode0);
  const blankEv = (): Ev => ({ kind: null, occurredOn: today, actor: "", verificationKind: null, file: "", note: "" });
  const [ev, setEv] = useState<Ev>(blankEv);
  const [evErr, setEvErr] = useState<Record<string, string>>({});
  const [cl, setCl] = useState<Cl>({ endDate: today, endReason: null, verified: "no", verificationKind: null, file: "" });
  const [clErr, setClErr] = useState<Record<string, string>>({});
  const [closed, setClosed] = useState<{ reportId: string } | null>(null);
  const setE = (k: keyof Ev, val: string | null) => {
    setEv((x) => ({ ...x, [k]: val }));
    setEvErr((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  };
  const setC = (patch: Partial<Cl>) => {
    setCl((x) => ({ ...x, ...patch }));
    setClErr((e) => {
      const n = { ...e };
      for (const k of Object.keys(patch)) delete n[k];
      return n;
    });
  };
  // bonusOn saknas för begränsade testare (servern lämnar inte ut bonus) – då visas ingen bonusmarkering.
  const showBonus = v.bonusOn !== undefined;
  const possibleBonus = showBonus && ev.kind === "arbete_paborjat";
  const events = v.events;
  const eventLabelOf = (k: string | null) => v.eventKinds.find((x) => x.value === k)?.label ?? k ?? "";
  const endReasonLabel = (r: string | null) => v.endReasons.find((x) => x.value === r)?.label ?? "–";

  const addEvent = async () => {
    const e: Record<string, string> = {};
    if (!ev.kind) e.kind = "Välj typ av händelse.";
    if (!ev.occurredOn) e.occurredOn = "Välj datum.";
    if (!ev.actor.trim()) e.actor = "Skriv arbetsgivare, skola eller annan aktör.";
    setEvErr(e);
    if (Object.keys(e).length) {
      toast("Händelsen kan inte sparas. Se markerade fält.", "error");
      return;
    }
    const verified = !!ev.verificationKind && ev.verificationKind !== "Ingen verifiering ännu";
    const res = await add
      .run({
        caseId: c.caseId, kind: ev.kind as Ok["eventKinds"][number]["value"], occurredOn: ev.occurredOn, actor: ev.actor.trim(),
        verificationKind: verified ? lc(ev.verificationKind as string) : null, verificationFile: verified ? ev.file || null : null, note: ev.note.trim(),
      })
      .catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Händelsen kunde inte sparas.", "error");
      return;
    }
    toast(`Händelsen ”${eventLabelOf(ev.kind)}” är registrerad.${possibleBonus ? " Den är markerad som möjligt bonusunderlag." : ""}`);
    setEv(blankEv());
  };

  const needsVer = !!cl.endReason && v.result.countsAsResult.includes(cl.endReason);
  const preview = resultPreview(v, cl.endReason, needsVer && cl.verified === "yes");
  const closeCase = async () => {
    const e: Record<string, string> = {};
    if (!cl.endDate) e.endDate = "Välj avslutsdatum.";
    if (!cl.endReason) e.endReason = "Välj avslutsorsak.";
    if (needsVer && cl.verified === "yes" && !cl.verificationKind) e.verificationKind = "Välj typ av verifiering.";
    setClErr(e);
    if (Object.keys(e).length) {
      toast("Insatsen kan inte avslutas ännu. Se markerade fält.", "error");
      return;
    }
    const ok = await confirm({
      title: "Avsluta insatsen?",
      body: (
        <p>
          Insatsen för <b>{c.name}</b> ({c.caseNumber}) avslutas {fmtDate(cl.endDate)} med orsaken <b>{endReasonLabel(cl.endReason).toLowerCase()}</b>. Ett utkast till slutrapport och en
          pulsmätning skapas automatiskt.
        </p>
      ),
      confirmLabel: "Avsluta insatsen",
    });
    if (!ok) return;
    const verified = needsVer && cl.verified === "yes";
    if (verified && !events.some((x) => x.kind === "arbete_paborjat" || x.kind === "studier_paborjade")) {
      await add
        .run({
          caseId: c.caseId, kind: cl.endReason === "arbete" ? "arbete_paborjat" : "studier_paborjade", occurredOn: cl.endDate, actor: "",
          verificationKind: lc(cl.verificationKind as string), verificationFile: cl.file || fileFor(cl.verificationKind), note: "Registrerad vid avslut",
        })
        .catch(() => null);
    }
    const res = await close.run({ caseId: c.caseId, endDate: cl.endDate, endReason: cl.endReason as Ok["endReasons"][number]["value"], verified }).catch(() => null);
    if (!res || !res.ok) {
      toast("Insatsen kunde inte avslutas.", "error");
      return;
    }
    setClosed({ reportId: res.reportId });
    toast("Insatsen är avslutad. Utkast till slutrapport och pulsmätning är skapade.");
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* ignoreras */
    }
  };

  const persp = customerPerspective(v.referrer);
  const nBonus = events.filter((x) => x.possibleBonus).length;
  const bonusText = `${nBonus === 0 ? "Inga händelser i ärendet är markerade" : nBonus === 1 ? "1 händelse i ärendet är markerad" : `${nBonus} händelser i ärendet är markerade`} som möjligt bonusunderlag.`;
  // Ett helt kort om en avstängd funktion tar plats från det coachen ska göra – då räcker en rad med en bricka.
  const bonusCard =
    showBonus &&
    (v.bonusOn ? (
      <Card title="Bonus" icon="award">
        <Stack gap="sm">
          <Row gap="sm">
            <Badge tone="blue" icon="award">
              Aktiv
            </Badge>
          </Row>
          <p className="text-body">Arbete som börjar i anslutning till insatsen markeras som möjligt bonusunderlag.</p>
          <p className="text-body text-text-muted">{bonusText}</p>
        </Stack>
      </Card>
    ) : (
      <Row gap="sm">
        <Badge tone="grey" icon="minus-circle" title="Underlaget samlas in redan nu, men inget bonusanspråk skapas förrän incitamentsmodellen är beslutad.">
          Bonus avstängd – modellen ej fastställd
        </Badge>
        <span className="text-small text-text-muted">{bonusText}</span>
      </Row>
    ));
  const isClosed = !!v.closed;
  const cv = v.closed;
  const finalRep = v.finalReport;
  const pulse = v.exitPulse;

  return (
    <Page
      title={mode === "close" ? "Avsluta insatsen" : "Händelser och utfall"}
      eyebrow={`${c.name} · ${c.caseNumber}`}
      crumbs={caseCrumbs(c, mode === "close" ? "Avsluta insatsen" : "Händelser")}
      lead={
        mode === "close"
          ? "Avslutsorsak och resultat väljer du själv. Arbete och studier räknas som resultat först när verifiering finns."
          : "Registrera det som hänt i insatsen. Händelserna syns i månadsrapporten och slutrapporten."
      }
    >
      <Card>
        <CaseHeadView head={c} />
      </Card>
      {!closed && !isClosed && (
        <Seg<Mode>
          ariaLabel="Välj uppgift"
          value={mode}
          onValueChange={setMode}
          options={[{ value: "event", label: "Ny händelse", icon: "plus" }, { value: "close", label: "Avslut", icon: "check-square" }]}
        />
      )}

      {mode === "event" && !closed && (
        <Card title="Registrerade händelser" icon="list" flush>
          <Table
            caption="Registrerade händelser"
            empty="Inga händelser registrerade ännu."
            rows={events}
            columns={[
              { key: "occurredOn", label: "Datum", nowrap: true, render: (e) => fmtDate(e.occurredOn) },
              {
                key: "kind",
                label: "Händelse",
                render: (e) => (
                  <>
                    <span className="font-bold">{e.label}</span>
                    {e.note && <CellSub>{e.note}</CellSub>}
                  </>
                ),
              },
              { key: "actor", label: "Aktör", render: (e) => e.actor || "–" },
              {
                key: "ver",
                label: "Verifiering",
                render: (e) =>
                  e.verificationKind ? (
                    <Badge tone="blue" icon="check">
                      {cap(e.verificationKind)}
                    </Badge>
                  ) : (
                    <Badge tone="outline" icon="clock">
                      Saknas
                    </Badge>
                  ),
              },
              ...(showBonus
                ? [
                    {
                      key: "bonus",
                      label: "Bonusunderlag",
                      render: (e: Ok["events"][number]) =>
                        e.possibleBonus ? (
                          <Badge tone="plan" icon="award">
                            Möjligt
                          </Badge>
                        ) : (
                          "–"
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>
      )}

      {closed && cv ? (
        <Stack>
          <Notice tone="ok" title="Insatsen är avslutad">
            {endReasonLabel(cv.endReason)} · {fmtDate(cv.endDate)}. Resultatklass:{" "}
            {cv.resultClass === "result" ? (cv.resultVerifiedAt ? "resultat (verifierat)" : "resultat (preliminärt tills verifierat)") : cv.resultClass === "excluded" ? "exkluderas ur nämnaren" : "ej resultat"}.
          </Notice>
          <Split>
            <Card title="Utkast till slutrapport" icon="file">
              <Stack gap="sm">
                <p>Slutrapporten är skapad som utkast och byggs av godkända uppgifter.</p>
                {finalRep && (
                  <Row gap="sm">
                    {finalRep.sla && finalRep.dueAt && <SlaBadge sla={finalRep.sla} dueAt={finalRep.dueAt} />}
                    <Badge tone="plan">{v.finalProvisional ? `Förslag ${v.finalDays} arbetsdagar – ej fastställt` : "Enligt avtalet"}</Badge>
                  </Row>
                )}
                {finalRep && (
                  <div>
                    <Button kind="primary" icon="file" to={`/rapporter/${encodeURIComponent(finalRep.id)}`}>
                      Öppna slutrapportutkastet
                    </Button>
                  </div>
                )}
              </Stack>
            </Card>
            <Card title="Pulsmätning vid avslut" icon="smile">
              {pulse ? (
                <Stack gap="sm">
                  <p>
                    Skickad {fmtDateTime(pulse.sentAt)} via {pulse.channel === "email" ? "e-post" : "SMS"}. Länken gäller till {fmtDate(pulse.expiresAt)}.
                  </p>
                  <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-body text-text-muted">
                    <Icon name="message" className="mt-1 flex-none" />
                    <div>
                      <b className="text-antracit">Utskicket (utan personuppgifter):</b> Hej! Din tid hos Miljonbemanning är avslutad. Svara gärna på fem korta frågor: [länk] Det är
                      frivilligt.
                    </div>
                  </div>
                  <div>
                    <Persp role="deltagare" to="/puls" label="Se pulsmätningen som deltagaren" />
                  </div>
                </Stack>
              ) : (
                <p className="text-text-muted">Ingen pulsmätning skickas i det här ärendet.</p>
              )}
            </Card>
          </Split>
          <Row>
            <Button kind="secondary" icon="calendar" to="/min-vecka">
              Till Min vecka
            </Button>
            <Persp role={persp.role} userId={persp.userId} to={`/portal/deltagare/${encodeURIComponent(c.caseId)}`} label="Se avslutet från kommunens håll" />
          </Row>
        </Stack>
      ) : isClosed && cv ? (
        <Notice tone="info" title="Insatsen är avslutad">
          {endReasonLabel(cv.endReason)} · {fmtDate(cv.endDate)}.
        </Notice>
      ) : mode === "event" ? (
        <Split wide>
          <Card title="Ny händelse" icon="plus">
            <Stack>
              <Field label="Typ av händelse" id="ev-kind" required error={evErr.kind} help="Välj den händelse som stämmer bäst.">
                <Seg id="ev-kind" ariaLabel="Typ av händelse" value={ev.kind} onValueChange={(x) => setE("kind", x)} options={v.eventKinds} />
              </Field>
              <FormGrid>
                <Field label="Datum" id="ev-date" required error={evErr.occurredOn} help="När det hände.">
                  <DateInput value={ev.occurredOn} onValueChange={(x) => setE("occurredOn", x)} />
                </Field>
                <Field label="Aktör" id="ev-actor" required error={evErr.actor} help="Arbetsgivare, skola eller annan aktör.">
                  <Input value={ev.actor} onValueChange={(x) => setE("actor", x)} maxLength={120} />
                </Field>
              </FormGrid>
              {v.employers.length > 0 && <Chips label="Arbetsgivare i registret" items={v.employers.map((e) => ({ key: e.name, label: e.name }))} onPick={(x) => setE("actor", x)} />}
              <Field label="Verifiering" id="ev-ver" help="Vilket underlag som styrker händelsen.">
                <Seg id="ev-ver" ariaLabel="Verifiering" value={ev.verificationKind} onValueChange={(x) => setE("verificationKind", x)} options={VERIFICATION} />
              </Field>
              {ev.verificationKind && ev.verificationKind !== "Ingen verifiering ännu" && (
                <Row gap="sm">
                  <Button kind="secondary" icon="paperclip" onClick={() => setE("file", fileFor(ev.verificationKind))}>
                    Bifoga fil
                  </Button>
                  {ev.file && (
                    <Badge tone="outline" icon="file">
                      {ev.file}
                    </Badge>
                  )}
                  <span className="text-body text-text-muted">{demo ? "Simulerad – ingen fil laddas upp i prototypen." : "Uppladdning av filer kommer senare. Här sparas att underlaget finns."}</span>
                </Row>
              )}
              <Field label="Kommentar" id="ev-note" help="Kort och saklig. Till exempel omfattning eller startdatum.">
                <TextArea rows={2} value={ev.note} onValueChange={(x) => setE("note", x)} maxLength={300} />
              </Field>
              {possibleBonus && (
                <Notice tone="info" icon="award" title="Möjligt bonusunderlag">
                  Arbete som påbörjas i anslutning till insatsen markeras automatiskt. Bonus är avstängd tills incitamentsmodellen är fastställd. <BuildPhase fas={3} off />
                </Notice>
              )}
              <Row>
                <Button kind="primary" icon="check" pending={add.pending} onClick={() => void addEvent()}>
                  Registrera händelsen
                </Button>
              </Row>
            </Stack>
          </Card>
          {bonusCard}
        </Split>
      ) : (
        <Split wide>
          <Card title="Avslut" icon="check-square">
            <Stack>
              <Field label="Avslutsdatum" id="cl-date" required error={clErr.endDate} help="Sista dagen i insatsen.">
                <DateInput value={cl.endDate} onValueChange={(x) => setC({ endDate: x })} />
              </Field>
              <Field label="Avslutsorsak" id="cl-reason" required error={clErr.endReason} help="Tom tills du väljer.">
                <Seg id="cl-reason" ariaLabel="Avslutsorsak" value={cl.endReason} onValueChange={(x) => setC({ endReason: x })} options={v.endReasons} />
              </Field>
              {needsVer && (
                <Stack>
                  <Field label="Finns verifiering?" id="cl-ver" help="Anställningsbevis eller antagningsbesked. Utan verifiering räknas resultatet som preliminärt.">
                    <Seg<"yes" | "no">
                      id="cl-ver"
                      ariaLabel="Finns verifiering"
                      value={cl.verified}
                      onValueChange={(x) => setC({ verified: x })}
                      options={[{ value: "yes", label: "Ja, registrera nu" }, { value: "no", label: "Nej, inte ännu" }]}
                    />
                  </Field>
                  {cl.verified === "yes" && (
                    <Field label="Typ av verifiering" id="cl-vkind" required error={clErr.verificationKind} help="Välj underlag och bifoga filen.">
                      <Seg id="cl-vkind" ariaLabel="Typ av verifiering" value={cl.verificationKind} onValueChange={(x) => setC({ verificationKind: x, file: fileFor(x) })} options={VERIFICATION.slice(0, 5)} />
                    </Field>
                  )}
                  {cl.verified === "yes" && cl.file && (
                    <Row gap="sm">
                      <Badge tone="outline" icon="paperclip">
                        {cl.file}
                      </Badge>
                      <span className="text-small text-text-muted">{demo ? "Simulerad fil." : "Filen laddas inte upp ännu."}</span>
                    </Row>
                  )}
                </Stack>
              )}
              <Row>
                <Button kind="primary" icon="check-square" pending={close.pending || add.pending} onClick={() => void closeCase()}>
                  Avsluta insatsen
                </Button>
              </Row>
            </Stack>
          </Card>
          <Stack>
            <Card title="Förhandsvisning av resultatklass" icon="chart">
              {preview ? (
                <Stack gap="sm">
                  <div>
                    <Badge tone={preview.tone} icon={preview.icon}>
                      {preview.label}
                    </Badge>
                  </div>
                  <p>{preview.text}</p>
                </Stack>
              ) : (
                <p className="text-text-muted">Välj avslutsorsak för att se hur avslutet räknas.</p>
              )}
              <p className="mt-2.5 text-body text-text-muted"><ProtoText>{v.result.definitionText}</ProtoText></p>
            </Card>
            <Card title="Det här händer vid avslut" icon="info">
              <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
                <li>Ett utkast till slutrapport skapas ({v.finalProvisional ? `förslag, ej fastställt: klar inom ${v.finalDays} arbetsdagar` : `klar inom ${v.finalDays} arbetsdagar`}).</li>
                <li>En pulsmätning skickas till deltagaren via SMS eller e-post, utan personuppgifter.</li>
                <li>Kommunen ser avslutet i portalen när slutrapporten är levererad.</li>
              </ul>
            </Card>
          </Stack>
        </Split>
      )}
    </Page>
  );
}
