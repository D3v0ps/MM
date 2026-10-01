"use client";
// Rapportsidan för Miljonbemanning (prototypens rapport.visa, MbReport): status och nästa steg, godkänn, kvalitetsgranska,
// leverera och rätta, förhandsvisningen av dokumentet, leveransen och versionerna. Kommunen ser samma dokument i portalen.
import { useEffect, useState, type ReactNode } from "react";
import { fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import {
  AiBox, AiTag, Badge, BuildPhase, Button, Card, Dot, Empty, ErrorNotice, Field, Grid, Kv, List, ListItem, Loading, Modal, Notice, Page, Row, SlaBadge, Split, Stack,
  Stepper, TextArea, useAuditView, useConfirm, useToast, type Crumb,
} from "@/ui";
import { auditView } from "@/features/session/api";
import {
  reportApprove, reportCorrect, reportCorrectionNote, reportDeliver, reportDocument, reportQualityReview, reportSaveFinal, reportSaveSummary, reportSnapshot, reportView,
  type ReportDocResult, type ReportDocView, type ReportView,
} from "../api";
import { useLazySnapshot } from "../components/use-snapshot";
import { PdfDownloadButton } from "../components/pdf-button";
import { ReportDocument } from "../components/report-document";
import { CustomerPerspective, MailNote, ProvisionalBadge, ReportStatusBadge } from "../components/parts";
import { DENIED, effStatus, LIFECYCLE } from "../report-helpers";

const LIST_CRUMB: Crumb = { label: "Rapporter", to: "/rapporter" };

export function RapportVisaScreen({ params }: ScreenProps) {
  const reportId = params.reportId;
  const q = useQuery(reportView, { reportId });
  const docQ = useQuery(reportDocument, { reportId });
  const v = q.data;
  const ok = !!v && v.ok;
  const log = useCommand(auditView);
  useAuditView(ok ? `report.view:${reportId}` : null, () => log.run({ action: "report.view", entity: "report", entityId: reportId }));
  useLazySnapshot(ok ? reportId : null, ok && (v as ReportView).needsSnapshot);
  // Fliken får rapportens rubrik (rutten har bara id:t).
  const title = v?.title;
  useEffect(() => {
    if (title && title !== "Rapport") document.title = `${title} – Miljonmatch`;
  }, [title]);

  if (q.error) return <Page title="Rapport"><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (q.isLoading || !v) return <Page title="Rapport"><Loading /></Page>;
  if (!v.ok) {
    const crumbs: Crumb[] | undefined = v.listCrumb ? [LIST_CRUMB, { label: v.title }] : v.caseId && v.caseNumber ? [{ label: v.caseNumber, to: `/arenden/${v.caseId}` }, { label: v.title }] : undefined;
    if (v.reason === "not_found") {
      return (
        <Page title="Rapport">
          <Empty icon="file" title="Rapporten finns inte" action={v.listCrumb ? <Button kind="primary" to="/rapporter">Visa rapporter</Button> : undefined}>
            Välj en rapport i listan.
          </Empty>
        </Page>
      );
    }
    const [t, b] = DENIED[v.reason] ?? DENIED.role;
    const toCase = v.caseId && (v.reason === "handledare" || v.reason === "handledare_order");
    return (
      <Page title={v.title} eyebrow={v.caseNumber ?? ""} crumbs={crumbs}>
        <Card>
          <Empty
            icon={v.reason === "protected" ? "lock" : "eye-off"}
            title={t}
            action={toCase ? <Button kind="primary" iconRight="arrow-right" to={`/arenden/${v.caseId}?flik=narvaro`}>Till närvaron i ärendet</Button> : undefined}
          >
            {b}
          </Empty>
        </Card>
      </Page>
    );
  }
  return <MbReport v={v} doc={docQ} />;
}

type DocQuery = { data?: ReportDocResult; error: unknown };

function MbReport({ v, doc }: { v: ReportView; doc: DocQuery }) {
  const [correcting, setCorrecting] = useState(false);
  const nav = useNav();
  const confirm = useConfirm();
  const toast = useToast();
  const deliver = useCommand(reportDeliver);
  const snapshot = useCommand(reportSnapshot);
  const crumbs: Crumb[] | undefined = v.listCrumb ? [LIST_CRUMB, { label: v.title }] : v.caseId && v.caseNumber ? [{ label: v.caseNumber, to: `/arenden/${v.caseId}` }, { label: v.title }] : undefined;
  const persp = <CustomerPerspective recipientId={v.recipientId} reportId={v.id} label="Se som kommunen" />;

  const onDeliver = async () => {
    const name = v.delivery.recipientName;
    const yes = await confirm({
      title: "Leverera till kommunen",
      confirmLabel: "Leverera i portalen",
      body: (
        <Stack gap="sm">
          <p>
            <b>{v.title}</b> publiceras i kommunens portal för {name || "mottagaren"}.
          </p>
          <p>{name || "Mottagaren"} får ett mejl som bara innehåller en notis:</p>
          <MailNote>&quot;{v.delivery.notice}&quot;</MailNote>
          <p className="text-small">
            {v.delivery.attachmentAllowed ? "Rapporten skickas även som bilaga enligt kommunens skriftliga instruktion." : "Rapporten skickas inte som bilaga i e-post. Det är avstängt i avtalskonfigurationen."}
          </p>
          <p className="text-small">Innehållet låses vid leveransen. Senare ändringar kräver en rättelse (ny version).</p>
        </Stack>
      ),
    });
    if (!yes) return;
    const res = await deliver.run({ reportId: v.id });
    if (!res.ok) {
      toast(res.message || "Rapporten måste vara godkänd innan den levereras.", "error");
      return;
    }
    // Frys innehållet direkt efter leveransen.
    await snapshot.run({ reportIds: [v.id] });
    toast(`Levererad i portalen till ${name || "kommunen"}. Mejlet innehåller bara en notis utan personuppgifter.`);
  };

  return (
    <Page title={v.title} eyebrow={v.eyebrow} crumbs={crumbs} actions={persp} lead={v.lead}>
      <StatusCard v={v} doc={doc.data && doc.data.ok ? doc.data.doc : null} onDeliver={() => void onDeliver()} onCorrect={() => setCorrecting(true)} />
      {v.drift && (
        <Notice tone="warn" title="Underlaget har ändrats efter leveransen">
          Uppgifter som rapporten bygger på har ändrats sedan rapporten levererades{v.deliveredAt ? ` ${fmtDateTime(v.deliveredAt)}` : ""}. Kommunen ser fortfarande den levererade versionen – den
          ändras aldrig i efterhand.{v.drift.canCorrect ? " Rätta rapporten om ändringen ska redovisas för kommunen. Då skapas en ny version." : ""}
        </Notice>
      )}
      {v.waiting && <WaitingCard w={v.waiting} />}
      {v.finalText && <FinalTextCard key={`${v.id}:${v.finalText.recommendation}`} v={v} f={v.finalText} />}
      {v.summary && <SummaryApprovalCard key={v.id} v={v} s={v.summary} />}
      {v.slaHidden && (
        <Notice tone="info" title="SLA-statistik visas inte för kommunen">
          Ledningen har inte beslutat att kommunen ska se svarstider och SLA-uppfyllnad. Det styrs i avtalskonfigurationen. Den interna ledningsvyn finns under Ledningsvy.
        </Notice>
      )}
      <section aria-label="Förhandsvisning av rapporten" className="flex flex-col gap-2">
        <Row between>
          <h2 className="flex items-center gap-2 text-label font-extrabold tracking-[0.1em] uppercase">
            <Dot />
            Förhandsvisning
          </h2>
          <span className="text-small text-text-muted">{v.delivered ? `Levererad version – låst sedan ${fmtDateTime(v.deliveredAt)}` : "Så ser dokumentet ut för mottagaren"}</span>
        </Row>
        {doc.error ? (
          <ErrorNotice error={doc.error} />
        ) : !doc.data ? (
          <Loading />
        ) : doc.data.ok ? (
          <ReportDocument doc={doc.data.doc} />
        ) : (
          <Empty icon="file" title={(DENIED[doc.data.reason] ?? DENIED.missing)[0]} />
        )}
      </section>
      <Grid cols={2}>
        <DeliveryCard v={v} />
        <VersionsCard v={v} />
      </Grid>
      {correcting && <CorrectModal v={v} onClose={() => setCorrecting(false)} onCreated={(id) => nav.push(`/rapporter/${encodeURIComponent(id)}`)} />}
    </Page>
  );
}

// ---------------------------------------------------------------- Status och nästa steg
function StatusCard({ v, doc, onDeliver, onCorrect }: { v: ReportView; doc: ReportDocView | null; onDeliver: () => void; onCorrect: () => void }) {
  const toast = useToast();
  const approve = useCommand(reportApprove);
  const quality = useCommand(reportQualityReview);
  const a = v.actions;
  const doApprove = async () => {
    const res = await approve.run({ reportId: v.id });
    if (res.ok) toast(`${v.title} är godkänd. Nästa steg: leverera till kommunen.`);
    else toast(res.message || "Rapporten kunde inte godkännas.", "error");
  };
  const doQuality = async () => {
    const res = await quality.run({ reportId: v.id });
    if (res.ok) toast("Rapporten är markerad som kvalitetsgranskad.");
  };
  const dueRow: [ReactNode, ReactNode] | null = v.due
    ? [
        "Förfaller",
        <Row gap="sm" key="due">
          <SlaBadge sla={v.due.sla} dueAt={v.due.dueAt} />
          <span className="text-small">{v.due.long}</span>
        </Row>,
      ]
    : null;
  const any = a.approve || a.deliver || a.correct || a.quality;
  // PDF:en av det dokument som visas – alla som får läsa rapporten kan ladda ner den (nedladdningen loggas).
  const pdf = <PdfDownloadButton doc={doc} kind={any ? "ghost" : "secondary"} />;
  return (
    <Card title="Status och nästa steg" icon="activity" tone={v.overdue ? "red" : undefined}>
      <Stack>
        <Row gap="sm">
          <ReportStatusBadge eff={v.eff} label={v.statusLabel} />
          {v.overdue && (
            <Badge tone="red" icon="alert">
              Försenad
            </Badge>
          )}
          <Badge tone="outline" icon="layers">
            Version {v.version}
          </Badge>
          <ProvisionalBadge text={v.provisional} />
          {v.qualityReviewed && (
            <Badge tone="bluetone" icon="shield">
              Kvalitetsgranskad
            </Badge>
          )}
          {v.pendingCorrection && (
            <Badge tone="outline" icon="edit">
              Rättas – ny version kommer
            </Badge>
          )}
        </Row>
        <Stepper steps={LIFECYCLE} current={v.lifecycleIndex} />
        <Split>
          <Kv
            items={[
              ["Nästa steg", v.next.label], dueRow, v.provisional ? ["Sista dag", v.provisional] : null, v.approved ? ["Godkänd", v.approved] : null,
              v.qualityReviewed ? ["Kvalitetsgranskad", v.qualityReviewed] : null,
            ]}
          />
          <Kv items={[["Mottagare", v.recipient], ["Levererad", v.deliveredText], ["Kvitterad", v.openedText], v.correction ? ["Rättelse", v.correction] : null]} />
        </Split>
        {v.blocked && (
          <Notice tone="warn" title="Rapporten kan inte godkännas ännu">
            <Stack gap="sm">
              <span>
                Månadsbedömningen för {v.blocked.monthText} {v.blocked.missing ? "saknas" : "är inte godkänd"}. Rapporten byggs bara av godkända uppgifter.
              </span>
              {v.blocked.canOpen && (
                <div>
                  <Button kind="primary" iconRight="arrow-right" to={`/manadsbedomning/${encodeURIComponent(v.blocked.caseId)}?manad=${v.blocked.month}`}>
                    Öppna bedömningen
                  </Button>
                </div>
              )}
            </Stack>
          </Notice>
        )}
        {v.missingRecommendation && (
          <Notice tone="warn" title="Rekommenderad fortsättning saknas">
            Rapporten kan inte levereras förrän coachen har skrivit rekommenderad fortsättning och godkänt texten. Texten skapas inte automatiskt.
          </Notice>
        )}
        {v.pendingCorrection && (
          <Notice tone="info" title={`Rättelse pågår – version ${v.pendingCorrection.version} är ett utkast`}>
            <Stack gap="sm">
              <span>
                Kommunen ser version {v.version} tills version {v.pendingCorrection.version} har godkänts och levererats.
              </span>
              <div>
                <Button kind="secondary" iconRight="arrow-right" to={`/rapporter/${encodeURIComponent(v.pendingCorrection.id)}`}>
                  Öppna version {v.pendingCorrection.version}
                </Button>
              </div>
            </Stack>
          </Notice>
        )}
        {v.superseded && (
          <Notice tone="info" title="Den här versionen är ersatt">
            En rättad version finns. Den här versionen sparas men ska inte användas.
          </Notice>
        )}
        {any ? (
          <Row>
            {a.approve && (
              <Button kind="primary" icon="check" pending={approve.pending} onClick={() => void doApprove()}>
                Godkänn
              </Button>
            )}
            {a.quality && (
              <Button kind="secondary" icon="shield" pending={quality.pending} onClick={() => void doQuality()}>
                Markera som kvalitetsgranskad
              </Button>
            )}
            {a.deliver && (
              <Button kind="primary" icon="send" onClick={onDeliver}>
                Leverera till kommunen
              </Button>
            )}
            {a.correct && (
              <Button kind="secondary" icon="edit" onClick={onCorrect}>
                Rätta
              </Button>
            )}
            {pdf}
          </Row>
        ) : (
          <>
            {v.idleText && <p className="text-small text-text-muted">{v.idleText}</p>}
            <Row>{pdf}</Row>
          </>
        )}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- Veckorapport som väntar på närvaro
function WaitingCard({ w }: { w: NonNullable<ReportView["waiting"]> }) {
  return (
    <Card title="Väntar på närvaroregistrering" icon="clock" tone="red">
      <Stack>
        <p>
          Rapporten publiceras automatiskt när alla deltagare är registrerade. Närvaron ska vara registrerad senast {w.regDay} kl. {w.regTime}. Rapporten ska vara publicerad
          senast {w.pubDay} kl. {w.pubTime}.
        </p>
        {w.byCoach.length === 0 ? (
          <p>Alla tillfällen är registrerade.</p>
        ) : (
          <Stack gap="sm">
            {w.byCoach.map((x) => (
              <div key={x.coach} className="flex flex-col gap-0.5">
                <div className="font-bold">{x.coach}</div>
                <ul className="m-0 list-disc pl-5 text-small">
                  {x.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Stack>
        )}
        {w.canRegister && (
          <div>
            <Button kind="primary" iconRight="arrow-right" to="/narvaro?vecka=forra">
              Registrera närvaro
            </Button>
          </div>
        )}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- Coachens text till slutrapporten
function FinalTextCard({ v, f }: { v: ReportView; f: NonNullable<ReportView["finalText"]> }) {
  const toast = useToast();
  const save = useCommand(reportSaveFinal);
  const [obs, setObs] = useState(f.obstacles);
  const [rec, setRec] = useState(f.recommendation);
  const [err, setErr] = useState<string | null>(null);
  const onSave = async () => {
    const res = await save.run({ reportId: v.id, obstacles: obs, recommendation: rec });
    if (!res.ok) {
      setErr(res.error === "recommendation" ? "Skriv en rekommenderad fortsättning. Den behövs innan rapporten kan godkännas." : res.message || "Texten kunde inte sparas.");
      return;
    }
    setErr(null);
    toast("Texten är sparad i slutrapporten. Nästa steg: godkänn rapporten.");
  };
  return (
    <Card title="Coachens text till slutrapporten" icon="edit">
      {f.canEdit ? (
        <Stack>
          <Field label="Kvarstående hinder" id="rap-final-obs" help="Beskriv funktionellt, till exempel språk, digital vana eller resor. Inga diagnoser.">
            <TextArea rows={2} value={obs} onValueChange={setObs} maxLength={400} />
          </Field>
          <Field label="Rekommenderad fortsättning" id="rap-final-rec" required error={err ?? undefined} help="Vad rekommenderar du efter insatsen? Skriv kort och sakligt. Kommunen läser texten.">
            <TextArea
              rows={3}
              value={rec}
              onValueChange={(x) => {
                setRec(x);
                if (err) setErr(null);
              }}
              maxLength={600}
            />
          </Field>
          <Row>
            <Button kind="primary" icon="check" pending={save.pending} onClick={() => void onSave()}>
              Spara texten
            </Button>
            <span className="text-small text-text-muted">
              Rapporten blir granskad när texten är sparad. Därefter godkänner coachen rapporten. Texten sparas i den levererade rapporten och ändras inte i efterhand.
            </span>
          </Row>
        </Stack>
      ) : (
        <p>Huvudcoachen skriver kvarstående hinder och rekommenderad fortsättning innan slutrapporten godkänns.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Beställarrapportens sammanfattning
function SummaryApprovalCard({ v, s }: { v: ReportView; s: NonNullable<ReportView["summary"]> }) {
  const toast = useToast();
  const save = useCommand(reportSaveSummary);
  const approve = useCommand(reportApprove);
  const [text, setText] = useState(s.text);
  const [aiUsed, setAiUsed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onApprove = async () => {
    const t = text.trim();
    if (!t) {
      setErr("Skriv en sammanfattning eller använd förslaget. Den behövs innan rapporten kan godkännas.");
      return;
    }
    const res = await save.run({ reportId: v.id, summary: t, aiUsed });
    if (!res.ok) {
      setErr(res.message || "Sammanfattningen kunde inte sparas.");
      return;
    }
    const ap = await approve.run({ reportId: v.id });
    if (!ap.ok) {
      toast(ap.message || "Rapporten kunde inte godkännas.", "error");
      return;
    }
    setErr(null);
    toast("Beställarrapporten är godkänd. Nästa steg: leverera till kommunens chef.");
  };
  return (
    <Card title="Sammanfattning – avtalsansvarig godkänner" icon="check-square" actions={<BuildPhase fas={2} />}>
      <Stack>
        <AiBox>
          <Row gap="sm">
            <AiTag />
            <span className="text-small text-text-muted">Utkast från rapportens siffror (avsnitt 1–6). Kontrollera innan du använder det.</span>
          </Row>
          <p>{s.suggestion}</p>
          {s.canApprove && (
            <div>
              <Button
                kind="secondary"
                icon="copy"
                onClick={() => {
                  setText(s.suggestion);
                  setAiUsed(true);
                  setErr(null);
                }}
              >
                Använd förslaget
              </Button>
            </div>
          )}
        </AiBox>
        {s.canApprove ? (
          <>
            <Field label="Sammanfattning till kommunen" id="rap-summary" required error={err ?? undefined} help="Kort och sakligt. Inga namn. Skriv aldrig det interna målet – kommunen ser bara avtalsmålet.">
              <TextArea
                rows={4}
                value={text}
                onValueChange={(x) => {
                  setText(x);
                  if (err) setErr(null);
                }}
                maxLength={900}
              />
            </Field>
            <Row>
              <Button kind="primary" icon="check" pending={save.pending || approve.pending} onClick={() => void onApprove()}>
                Godkänn beställarrapporten
              </Button>
              <span className="text-small text-text-muted">
                Sammanfattningen är tom tills du väljer. AI föreslår – du bedömer. Texten sparas i rapporten och ändras inte efter leveransen.
              </span>
            </Row>
          </>
        ) : (
          <p>Avtalsansvarig ({s.manager}) skriver och godkänner sammanfattningen.</p>
        )}
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------- Leverans och versioner
function DeliveryCard({ v }: { v: ReportView }) {
  const d = v.delivery;
  return (
    <Card title="Så levereras rapporten" icon="send">
      <Stack>
        <Kv
          items={[
            ["Kanal", d.channel],
            ["Mottagare", d.recipientName ? v.recipient : "–"],
            ["Kvittens", "Bara mottagaren kvitterar. Andra i kommunen kan läsa rapporten utan att den blir kvitterad."],
            ["Bilaga i e-post", d.attachmentAllowed ? "Tillåten – kommunen har gett skriftlig instruktion" : "Avstängd. Kommunen har inte skriftligt begärt rapporter som bilaga."],
          ]}
        />
        <MailNote>
          <b className="text-antracit">Mejlet till {d.recipientName || "mottagaren"} innehåller bara:</b> &quot;{d.notice}&quot; Inga namn eller personnummer.
        </MailNote>
        <div>
          <CustomerPerspective recipientId={v.recipientId} reportId={v.id} label="Öppna kommunens vy" />
        </div>
      </Stack>
    </Card>
  );
}

function VersionsCard({ v }: { v: ReportView }) {
  return (
    <Card title="Versioner" icon="layers" flush>
      <List>
        {v.versions.map((x) => (
          <ListItem
            key={x.id}
            title={`Version ${x.version}${x.current ? " (visas nu)" : ""}`}
            sub={x.text}
            side={
              <Row gap="sm">
                <ReportStatusBadge eff={effStatus(x)} label={x.statusLabel} />
                {!x.current && (
                  <Button kind="ghost" to={`/rapporter/${encodeURIComponent(x.id)}`}>
                    Öppna
                  </Button>
                )}
              </Row>
            }
          />
        ))}
      </List>
      <div className="border-t border-ljusgra px-[18px] py-4 text-small text-text-muted">
        Rättelse skapar en ny version. Den gamla sparas och syns här. Kommunen ser den senast levererade versionen.
      </div>
    </Card>
  );
}

function CorrectModal({ v, onClose, onCreated }: { v: ReportView; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const correct = useCommand(reportCorrect);
  const note = useCommand(reportCorrectionNote);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!reason.trim()) {
      setErr("Skriv varför rapporten rättas. Orsaken sparas i revisionsloggen.");
      return;
    }
    const res = await correct.run({ reportId: v.id });
    if (!res.ok) {
      toast("Rättelsen kunde inte skapas.", "error");
      return;
    }
    await note.run({ reportId: res.reportId, reason });
    onClose();
    toast(`Version ${v.version + 1} är skapad som utkast. Version ${v.version} sparas.`);
    onCreated(res.reportId);
  };
  return (
    <Modal
      title="Rätta rapporten"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="edit" pending={correct.pending || note.pending} onClick={() => void go()}>
            Skapa ny version
          </Button>
        </>
      }
    >
      <Stack>
        <p>
          En rättelse skapar version {v.version + 1} som utkast. Version {v.version} sparas och syns i versionshistoriken.
          {v.delivered ? ` Kommunen ser version ${v.version} tills den nya versionen har godkänts och levererats.` : ""}
        </p>
        <Field label="Varför rättas rapporten?" id="rap-correct-reason" required error={err ?? undefined} help="Till exempel: fel datum för praktikstart. Skriv inga personuppgifter.">
          <TextArea
            rows={3}
            value={reason}
            onValueChange={(x) => {
              setReason(x);
              if (err) setErr(null);
            }}
            maxLength={300}
          />
        </Field>
      </Stack>
    </Modal>
  );
}
