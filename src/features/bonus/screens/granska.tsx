"use client";
// Granska och skicka ett bonusanspråk (/bonus/:claimId, SPEC §7.17, beslut 2026-11-04). Uppifrån och ned, en sak i taget:
//   1. Underlaget i ärendet (det reglerna räknar på: period, närvaro, bedömningar, händelsen, steg 3)
//   2. Det coachen fyller i: verifieringens typ och datum (steg 2–5) eller checklistan med var underlaget finns (steg 1), och en
//      kort kommentar – sparas med Spara
//   3. Förhandsvisningen av redovisningsunderlaget som kommunen får (samma avsnitt som PDF:en)
//   4. Skicka till kommunen (bekräftas). Underlaget fryses och handläggaren får ett mejl med bara ärendenumret och en länk.
// Ett skickat anspråk kan återtas tills kommunen beslutat. Samordnaren och avtalsansvarig kan registrera ett beslut som kommunen
// skickade med mejl. Inga belopp – bara ekonomen ser belopp. Visningen av underlaget loggas en gång per sidbesök.
import { useMemo, useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import { usePageTitle } from "@/shell/page-effects";
import { leaveWithoutAsking, useUnsavedGuard } from "@/shell/guard";
import type { ScreenProps } from "@/shell/routes";
import { fmtDate, fmtDateTime } from "@/core/time";
import {
  Button, Card, Check, DateInput, ErrorNotice, Field, FormGrid, Input, Kv, Loading, Notice, Page, Row, Seg, Stack, TextArea, toast, useAuditView, useConfirm,
} from "@/ui";
import { bonusRecordMail, bonusReview, bonusSave, bonusSubmit, bonusUnderlag, bonusWithdraw, type BonusReviewView } from "../api";
import { BonusStatusBadge } from "./kort-bonus";
import { UnderlagPaper, UnderlagPdfButton } from "./underlag";

export function BonusGranskaScreen({ params }: ScreenProps) {
  const q = useQuery(bonusReview, { claimId: params.claimId ?? "" });
  const crumbs = [{ label: "Ärenden", to: "/arenden" }, { label: "Progression och resultat" }];
  if (q.error) return <Page title="Progression och resultat" crumbs={crumbs}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (q.data === undefined) return <Page title="Progression och resultat" crumbs={crumbs}><Loading /></Page>;
  if (q.data === null) return <Page title="Progression och resultat" crumbs={crumbs}><Notice tone="info" title="Anspråket finns inte">Anspråket finns inte, eller så har du inte behörighet att se det.</Notice></Page>;
  return <Review key={q.data.claimId} v={q.data} />;
}

type Form = BonusReviewView["fields"];
const sameForm = (a: Form, b: Form) => JSON.stringify(a) === JSON.stringify(b);

function Review({ v }: { v: BonusReviewView }) {
  usePageTitle(`Progression och resultat ${v.caseNumber} · steg ${v.step}`);
  const view = useCommand(bonusUnderlag);
  useAuditView(`bonus:${v.claimId}`, () => view.run({ claimId: v.claimId, purpose: "view" }).catch(() => undefined));
  const [form, setForm] = useState<Form>(v.fields);
  // Sparat på servern (Spara, eller en kollega): formuläret följer det sparade. Samma innehåll som förut rör inte formuläret.
  const [saved, setSaved] = useState<Form>(v.fields);
  if (!sameForm(saved, v.fields)) {
    setSaved(v.fields);
    setForm(v.fields);
  }
  const dirty = v.canAct && !sameForm(form, v.fields);
  useUnsavedGuard(dirty);
  const caseTo = `/arenden/${encodeURIComponent(v.caseId)}?flik=handelser`;
  return (
    <Page
      title={`Steg ${v.step} · ${v.label}`}
      eyebrow={`${v.participantName} · ${v.caseNumber}`}
      crumbs={[{ label: "Ärenden", to: "/arenden" }, { label: v.caseNumber, to: caseTo }, { label: `Steg ${v.step}` }]}
      lead={v.canAct ? "Granska underlaget, fyll i det som saknas och skicka till kommunen. Kommunen ser bara det du skickar." : undefined}
      actions={<BonusStatusBadge status={v.status} text={v.statusText} icon={v.icon} />}
    >
      <Stack>
        <Facts v={v} />
        {v.canAct && <Fields v={v} form={form} setForm={setForm} dirty={dirty} />}
        {!v.canAct && <Sent v={v} />}
        <Card title="Redovisningsunderlaget" icon="file" actions={<UnderlagPdfButton claimId={v.claimId} label={v.status === "suggested" ? "Visa underlaget (PDF)" : "Läs underlaget (PDF)"} />}>
          <p className="m-0 mb-3 text-small text-text-muted">
            {v.status === "suggested"
              ? "Så här ser underlaget ut för kommunen om du skickar nu. Det byggs bara av godkända uppgifter och fryses när du skickar."
              : "Underlaget som kommunen fick. Det ändras inte."}
          </p>
          <UnderlagPaper u={v.underlag} participantName={v.participantName} />
        </Card>
        {v.canAct && <SubmitCard v={v} form={form} dirty={dirty} />}
        {(v.canWithdraw || v.canRecordMail) && <Actions v={v} />}
      </Stack>
    </Page>
  );
}

function Facts({ v }: { v: BonusReviewView }) {
  const f = v.facts;
  return (
    <Card title="Underlaget i ärendet" icon="clipboard">
      <p className="m-0 mb-3">{v.rule}</p>
      <Kv
        items={[
          ["Insatsen", `${fmtDate(f.start)} – ${f.end ? fmtDate(f.end) : "pågår"}`],
          v.step === 1 ? ["Närvaro", `${f.attendancePercent == null ? "Ingen registrerad" : `${String(f.attendancePercent).replace(".", ",")} procent`} (gräns ${f.minPercent} procent) – ${f.attendanceMeets ? "räcker" : "räcker inte"}`] : null,
          v.step === 1 ? ["Godkända månadsbedömningar", `${f.approvedAssessments} (minst 2 behövs: före och efter)`] : null,
          f.event ? ["Händelse", `${f.event.label} ${fmtDate(f.event.date)}${f.event.actor ? ` · ${f.event.actor}` : ""}${f.event.verificationKind ? ` · verifierad: ${f.event.verificationKind}` : ""}`] : null,
          f.windowEnd ? ["I anslutning till insatsen", `Senast ${fmtDate(f.windowEnd)}`] : null,
          f.step3 ? ["Steg 3", `${f.step3.statusText}${f.step3.reachedOn ? ` · resultatdatum ${fmtDate(f.step3.reachedOn)}` : ""}`] : null,
          f.speedDeadline ? ["Snabbt resultat", `Steg 3 senast ${fmtDate(f.speedDeadline)}`] : null,
          f.sustainDue ? ["Hållbart resultat", `Kan skickas från ${fmtDate(f.sustainDue)} med en ny verifiering daterad då eller senare`] : null,
          v.source ? ["Anspråket", v.source === "auto" ? "Förslag från reglerna" : "Skapat av Miljonbemanning"] : null,
        ]}
      />
    </Card>
  );
}

function Fields({ v, form, setForm, dirty }: { v: BonusReviewView; form: Form; setForm: (f: Form) => void; dirty: boolean }) {
  const save = useCommand(bonusSave);
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const onSave = async () => {
    const res = await save.run({ claimId: v.claimId, ...toPayload(form) }).catch(() => null);
    if (!res) return toast("Det gick inte att spara. Försök igen.", "error");
    if (!res.ok) return toast(res.message || "Det gick inte att spara.", "error");
    toast("Sparat.");
  };
  return (
    <Card title={v.needsChecklist ? "Checklista" : "Verifiering"} icon="check-square">
      <Stack gap="sm">
        {v.needsChecklist ? (
          <>
            <p className="m-0">Bocka av det som är genomfört och skriv kort var underlaget finns (till exempel mötesrapporten 12 januari eller CV-mappen). Inga personnummer.</p>
            {form.checklist.map((c, i) => (
              <div key={c.item} className="flex flex-col gap-2 border-b border-ljusgra pb-3">
                <Check id={`bonus-check-${c.item}`} checked={c.done} onCheckedChange={(done) => set({ checklist: form.checklist.map((x, j) => (j === i ? { ...x, done } : x)) })}>
                  {c.label}
                </Check>
                <Field label={`Var finns underlaget – ${c.label.toLowerCase()}`} help="Kort text, högst 200 tecken." id={`bonus-where-${c.item}`}>
                  <Input value={c.where} maxLength={200} onValueChange={(where) => set({ checklist: form.checklist.map((x, j) => (j === i ? { ...x, where } : x)) })} />
                </Field>
              </div>
            ))}
          </>
        ) : (
          <FormGrid>
            <Field label="Vilken verifiering finns" help="Till exempel anställningsavtal, arbetsgivarintyg, antagningsbesked eller praktikintyg. Dokumentet skickas till kommunen på annat sätt." id="bonus-ver-kind">
              <Input value={form.verificationKind ?? ""} maxLength={200} onValueChange={(t) => set({ verificationKind: t })} />
            </Field>
            <Field label="Verifieringens datum" help={v.step === 4 ? "Datumet på den nya verifieringen – tidigast när resultatet har kvarstått." : "Datumet på intyget eller beskedet."} id="bonus-ver-on">
              <DateInput value={form.verificationOn ?? ""} onValueChange={(d) => set({ verificationOn: d || null })} />
            </Field>
          </FormGrid>
        )}
        {v.step <= 3 && (
          <Field label={v.step === 3 ? "Resultatdatum" : "Datum när steget nåddes"} help={v.step === 3 ? "Dagen arbetet eller studierna började." : "Dagen steget nåddes under insatsen."} id="bonus-reached">
            <DateInput value={form.reachedOn ?? ""} onValueChange={(d) => set({ reachedOn: d || null })} />
          </Field>
        )}
        <Field label="Kommentar till kommunen" help="Kort och sakligt, högst 500 tecken. Inga personnummer och inga omdömen om personen." id="bonus-basis">
          <TextArea value={form.basis} maxLength={500} rows={3} onValueChange={(basis) => set({ basis })} />
        </Field>
        <Row>
          <Button kind="secondary" icon="check" pending={save.pending} disabled={!dirty} onClick={() => void onSave()}>
            Spara
          </Button>
          {dirty && <span className="text-small text-text-muted">Du har ändringar som inte är sparade.</span>}
        </Row>
      </Stack>
    </Card>
  );
}

const toPayload = (f: Form) => ({
  basis: f.basis, reachedOn: f.reachedOn, verificationKind: f.verificationKind, verificationOn: f.verificationOn,
  checklist: Object.fromEntries(f.checklist.map((c) => [c.item, { done: c.done, where: c.where }])),
});

function SubmitCard({ v, form, dirty }: { v: BonusReviewView; form: Form; dirty: boolean }) {
  const submit = useCommand(bonusSubmit);
  const confirm = useConfirm();
  const nav = useNav();
  const problems = useMemo(() => (dirty ? [] : v.problems), [dirty, v.problems]);
  const onSubmit = async () => {
    const yes = await confirm({
      title: "Skicka till kommunen?",
      body: "Underlaget fryses och kommunens handläggare får ett mejl om att logga in och besluta. Mejlet har bara ärendenumret. Du kan återta anspråket tills kommunen har beslutat.",
      confirmLabel: "Skicka till kommunen",
    });
    if (!yes) return;
    const res = await submit.run({ claimId: v.claimId, ...toPayload(form) }).catch(() => null);
    if (!res) return toast("Anspråket kunde inte skickas. Försök igen.", "error");
    if (!res.ok) return toast(res.message || "Anspråket kunde inte skickas.", "error");
    toast(`Steg ${v.step} är skickat till kommunen.`);
    // Fälten skickades med anspråket – inget är osparat, så vakten ska inte fråga.
    leaveWithoutAsking(() => nav.push(`/arenden/${encodeURIComponent(v.caseId)}?flik=handelser`));
  };
  return (
    <Card title="Skicka till kommunen" icon="send">
      <Stack gap="sm">
        {problems.length > 0 ? (
          <Notice tone="warn" title="Det här saknas innan anspråket kan skickas">
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </Notice>
        ) : (
          <p className="m-0">{dirty ? "Dina ändringar sparas när du skickar." : "Allt som behövs finns. Kontrollera förhandsvisningen ovan innan du skickar."}</p>
        )}
        <Row>
          <Button kind="primary" icon="send" pending={submit.pending} onClick={() => void onSubmit()}>
            Skicka till kommunen
          </Button>
        </Row>
      </Stack>
    </Card>
  );
}

function Sent({ v }: { v: BonusReviewView }) {
  return (
    <Card title="Läget" icon="clock">
      <Kv
        items={[
          v.submitted ? ["Skickat", `${fmtDateTime(v.submitted.at)} av ${v.submitted.byName}`] : null,
          v.withdrawn ? ["Återtaget", `${fmtDateTime(v.withdrawn.at)} av ${v.withdrawn.byName}`] : null,
          v.decision ? ["Kommunens beslut", `${v.decision.decision === "approved" ? "Godkänt" : "Avslaget"} ${fmtDateTime(v.decision.at)} · ${v.decision.via === "mejl" ? `med mejl, registrerat av ${v.decision.byName}` : v.decision.byName}`] : null,
          v.decision?.note ? ["Motivering", v.decision.note] : null,
          v.status === "submitted" && !v.decision ? ["Väntar på", v.waitingForStep3 ? "Kommunens beslut om steg 3 först" : "Kommunens beslut"] : null,
          v.status === "suggested" ? ["Förslag", "Förslaget granskas av den som arbetar i ärendet."] : null,
        ]}
      />
    </Card>
  );
}

function Actions({ v }: { v: BonusReviewView }) {
  const withdraw = useCommand(bonusWithdraw);
  const mail = useCommand(bonusRecordMail);
  const confirm = useConfirm();
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [note, setNote] = useState("");
  const onWithdraw = async () => {
    const yes = await confirm({
      title: "Återta anspråket?",
      body: v.step === 3 ? "Steg 4 och 5 som bygger på steg 3 och inte är beslutade återtas också. Kommunen ser inte längre anspråket." : "Kommunen ser inte längre anspråket.",
      confirmLabel: "Återta",
      tone: "danger",
    });
    if (!yes) return;
    const res = await withdraw.run({ claimId: v.claimId }).catch(() => null);
    if (!res || !res.ok) return toast(res && !res.ok ? res.message || "Det gick inte." : "Det gick inte. Försök igen.", "error");
    toast(res.withdrawn > 1 ? `${res.withdrawn} anspråk är återtagna.` : "Anspråket är återtaget.");
  };
  const onMail = async () => {
    const res = await mail.run({ claimId: v.claimId, decision, note }).catch(() => null);
    if (!res) return toast("Beslutet kunde inte registreras. Försök igen.", "error");
    if (!res.ok) return toast(res.message || "Beslutet kunde inte registreras.", "error");
    toast("Kommunens beslut är registrerat.");
  };
  return (
    <Card title="Åtgärder" icon="settings">
      <Stack>
        {v.canRecordMail && (
          <div className="flex flex-col gap-3">
            <h3 className="m-0 text-h3 font-bold">Kommunen har beslutat med mejl</h3>
            <p className="m-0 text-small text-text-muted">Mejl är kommunens formella kanal. Registrera beslutet här med kommunens motivering eller en hänvisning till mejlet.</p>
            <Field label="Kommunens beslut" id="bonus-mejl-beslut">
              <Seg ariaLabel="Kommunens beslut" value={decision} onValueChange={(x) => setDecision(x as "approved" | "rejected")} options={[{ value: "approved", label: "Godkänt" }, { value: "rejected", label: "Avslaget" }]} />
            </Field>
            <Field label="Motivering eller hänvisning till mejlet" help="Krävs. Till exempel: Godkänt i mejl från handläggaren 3 februari. Inga personnummer." id="bonus-mejl-note" required>
              <TextArea value={note} maxLength={1000} rows={2} onValueChange={setNote} />
            </Field>
            <Row>
              <Button kind="primary" icon="mail" pending={mail.pending} disabled={note.trim().length < 3} onClick={() => void onMail()}>
                Registrera beslutet
              </Button>
            </Row>
          </div>
        )}
        {v.canWithdraw && (
          <Row>
            <Button kind="ghost" icon="minus-circle" pending={withdraw.pending} onClick={() => void onWithdraw()}>
              Återta anspråket
            </Button>
          </Row>
        )}
      </Stack>
    </Card>
  );
}
