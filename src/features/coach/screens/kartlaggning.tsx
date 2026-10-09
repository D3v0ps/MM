"use client";
// Kartläggning vecka 1 (/kartlaggning/:caseId) – deltagarens reella kompetens, yrkesmål och valt yrkesspår.
// Anpassningar beskrivs funktionellt – aldrig diagnoser. Port av prototypens coach.kartlaggning. Utkastet sparas automatiskt
// på servern tills kartläggningen är godkänd (useAutosave, beslut 2026-10-02) – en text som ser ut som en diagnos stoppar
// autosparningen tills den är borttagen. Fälten ligger i utkastminnet (useDraft), så Tillbaka visar dem igen.
import { useEffect, useRef, useState } from "react";
import { AUTOSAVE_INTAKE } from "@/api/invalidation";
import { fmtDate } from "@/core/time";
import { newEditSession, useAutosave, type AutosaveResult } from "@/shell/autosave";
import { useCommand, useQuery } from "@/shell/backend";
import { useDraft, useUnsavedGuard } from "@/shell/guard";
import type { ScreenProps } from "@/shell/routes";
import { AutosaveStatus, Badge, Button, Card, Field, FormGrid, Input, Notice, Page, Row, Seg, Select, Stack, TextArea, toast } from "@/ui";
import { intakePage, intakeSave, type IntakePage } from "../api";
import { CaseHeadView, caseCrumbs, CasePicker, Chips, customerPerspective, GateView, PageState, Persp, useCaseView } from "./shared";

type Ok = Extract<IntakePage, { kind: "ok" }>;
const DIGITAL = ["Van vid mobil, ovan vid dator", "Använder e-post och BankID själv", "Behöver stöd med digitala tjänster", "Van datoranvändare"];
const LICENCE = ["Inget körkort", "Övningskör", "B-körkort", "C-körkort eller högre", "Truckkort"];
/** Ord som tyder på en diagnos. Diagnoser dokumenteras aldrig i Miljonmatch (CLAUDE.md, klarspråk och funktionella beskrivningar). */
const DIAGNOSIS = /(^|[^a-zåäö0-9])(diagnos|adhd|autism|asperger|depression|ptsd|bipolär|schizofren|diabetes|epilepsi|dyslexi|utmattningssyndrom|ångestsyndrom)/i;
const REQUIRED: Record<string, string> = {
  workExperience: "Beskriv arbetslivserfarenheten.", education: "Fyll i utbildning.", languageNotes: "Beskriv språket.", digitalSkills: "Välj digital vana.",
  drivingLicence: "Välj körkort.", workGoals: "Skriv yrkesmålet.", chosenTrack: "Välj yrkesspår.", firstWeekGoal: "Skriv första veckomålet.",
};
const uniq = (xs: string[]) => [...new Set(xs)];
/** Listan med ett sparat värde som inte finns bland alternativen sist. */
const withValue = (list: string[], value: string) => uniq([...list, ...(value && !list.includes(value) ? [value] : [])]);

export function KartlaggningScreen({ params }: ScreenProps) {
  if (!params.caseId) {
    return (
      <CasePicker
        kind="kartlaggning"
        title="Kartläggning"
        lead="Kartläggningen görs vecka 1 och dokumenterar deltagarens reella kompetens."
        basePath="/kartlaggning"
        actionLabel="Öppna"
      />
    );
  }
  return <Kartlaggning caseId={params.caseId} />;
}

function Kartlaggning({ caseId }: { caseId: string }) {
  const q = useQuery(intakePage, { caseId });
  const v = q.data;
  if (!v) return <PageState title="Kartläggning" error={q.error} onRetry={() => void q.refetch()} />;
  if (v.kind === "gate") return <GateView gate={v.gate} title="Kartläggning" listPath="/kartlaggning" />;
  return <IntakeForm key={caseId} v={v} />;
}

type F = { workExperience: string; education: string; languageNotes: string; digitalSkills: string; drivingLicence: string; workGoals: string; chosenTrack: string; adaptations: string; firstWeekGoal: string };

/** Fälten som de trimmas i anropet. */
const trimmed = (f: F): F => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, String(x).trim()])) as F;

function IntakeForm({ v }: { v: Ok }) {
  const save = useCommand(intakeSave);
  // Automatisk utkastsparning räknar bara om deltagarlistan och kortet – inte sidan själv.
  const draftSave = useCommand(intakeSave, { invalidate: AUTOSAVE_INTAKE });
  const [editSession] = useState(newEditSession);
  useCaseView(v.head.caseId);
  const c = v.head;
  const ia = v.intake;
  const initialForm = (): F => ({
    workExperience: ia?.workExperience ?? "", education: ia?.education ?? "", languageNotes: ia?.languageNotes ?? "", digitalSkills: ia?.digitalSkills ?? "",
    drivingLicence: ia?.drivingLicence ?? "", workGoals: ia?.workGoals ?? "", chosenTrack: ia?.chosenTrack ?? "", adaptations: ia?.adaptations ?? "", firstWeekGoal: ia?.firstWeekGoal ?? "",
  });
  // Utkastminne (bara i minnet): fälten, sparat läge och senaste sparningstid finns kvar om sidan lämnas (2.A).
  const draftKey = `kartlaggning|${c.caseId}`;
  const fDraft = useDraft<F>(draftKey, initialForm);
  const f = fDraft.value;
  const setF = fDraft.set;
  const baselineDraft = useDraft<string>(`${draftKey}|sparat`, () => JSON.stringify(initialForm()));
  const [baseline, setBaseline] = [baselineDraft.value, baselineDraft.set];
  const savedAtDraft = useDraft<string | null>(`${draftKey}|sparadtid`, null);
  // Radens version (0022): skickas som expectedVersion – samma kartläggning sparad i en annan flik ger "conflict", inget skrivs över.
  const versionDraft = useDraft<number | null>(`${draftKey}|version`, ia?.version ?? null);
  const versionRef = useRef<number | null>(versionDraft.value);
  useEffect(() => {
    versionRef.current = versionDraft.value;
  }, [versionDraft.value]);
  const rememberVersion = (version: number) => {
    versionRef.current = version;
    versionDraft.set(version);
  };
  const forgetDraft = () => [fDraft, baselineDraft, savedAtDraft, versionDraft].forEach((d) => d.clear());
  const [allTracks, setAllTracks] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedNow, setSavedNow] = useState<"approved" | "draft" | null>(null);
  const set = (k: keyof F, val: string) => {
    setF((x) => ({ ...x, [k]: val }));
    if (errors[k]) setErrors((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  };
  const diag = DIAGNOSIS.test(f.adaptations);
  const approved = ia?.status === "approved";
  const req = !approved;
  const persp = customerPerspective(v.referrer);
  const changeKey = JSON.stringify(f);
  const dirty = changeKey !== baseline;
  // Automatisk utkastsparning – bara tills kartläggningen är godkänd ("Spara ändringar" på en godkänd görs av coachen själv).
  const autosave = useAutosave({
    enabled: !approved && !save.pending,
    dirty,
    changeKey,
    initialSavedAt: savedAtDraft.value,
    save: async ({ keepalive }): Promise<AutosaveResult> => {
      const snapshot = JSON.stringify(f);
      if (diag) return { ok: false, reason: "invalid", text: "Sparas inte automatiskt förrän diagnosen är borttagen" };
      const res = await draftSave.run({ caseId: c.caseId, data: trimmed(f), approve: false, autosave: true, editSession, expectedVersion: versionRef.current ?? undefined }, { keepalive }).catch(() => null);
      if (!res) return { ok: false, reason: "failed" };
      if (!res.ok) {
        if (res.error === "conflict") return { ok: false, reason: "invalid", text: "Kartläggningen har ändrats i en annan flik eller på en annan enhet – ladda om sidan. Inget skrivs över." };
        return { ok: false, reason: "failed" };
      }
      rememberVersion(res.version);
      setBaseline(snapshot);
      savedAtDraft.set(res.savedAt);
      return { ok: true, savedAt: res.savedAt };
    },
  });
  useUnsavedGuard(dirty && !save.pending, undefined, { trySave: () => autosave.flush() });
  const restartDraft = () => {
    setF(initialForm());
    setErrors({});
    forgetDraft();
  };

  const doSave = async (approve: boolean) => {
    const e: Record<string, string> = {};
    if (approve) for (const [k, msg] of Object.entries(REQUIRED)) if (!String(f[k as keyof F] || "").trim()) e[k] = msg;
    if (diag) e.adaptations = "Texten ser ut att innehålla en diagnos. Beskriv i stället vad deltagaren behöver i arbetet.";
    setErrors(e);
    if (Object.keys(e).length) {
      toast(approve ? "Kartläggningen kan inte godkännas ännu. Se markerade fält." : "Ta bort diagnosen innan du sparar.", "error");
      return;
    }
    // En pågående autosparning får bli klar först.
    await autosave.settle();
    const res = await save.run({ caseId: c.caseId, data: trimmed(f), approve, expectedVersion: versionRef.current ?? undefined }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Kartläggningen kunde inte sparas.", "error");
      return;
    }
    rememberVersion(res.version);
    // Sparat läge först, sedan glöms minnet (sidan hämtas om och visar det sparade).
    setBaseline(JSON.stringify(f));
    autosave.markSaved(res.savedAt);
    forgetDraft();
    setSavedNow(approve ? "approved" : "draft");
    toast(approve ? "Kartläggningen är godkänd. Yrkesspåret är sparat på ärendet." : "Utkastet är sparat.");
  };

  return (
    <Page
      title="Kartläggning vecka 1"
      eyebrow={`${c.name} · ${c.caseNumber}`}
      lead="Dokumentera deltagarens reella kompetens. Underlaget används för validering, matchning och CV."
      crumbs={caseCrumbs(c, "Kartläggning")}
      actions={
        approved ? (
          <Badge tone="blue" icon="check">
            Godkänd {ia?.approvedAt ? fmtDate(ia.approvedAt) : ""}
          </Badge>
        ) : (
          <Badge tone="outline" icon="edit">
            {ia ? "Utkast" : "Ny"}
          </Badge>
        )
      }
    >
      <Card>
        <Row between>
          <CaseHeadView head={c} />
          <Persp role={persp.role} userId={persp.userId} to={`/portal/deltagare/${encodeURIComponent(c.caseId)}`} label="Se deltagaren från kommunens håll" />
        </Row>
      </Card>
      {fDraft.restored && dirty && (
        <Notice tone="info" icon="edit" title="Ditt osparade utkast är återställt">
          <Row gap="sm">
            <span>Det du fyllde i senast finns kvar. Det är inte sparat ännu.</span>
            <Button kind="ghost" icon="reset" onClick={restartDraft}>
              Börja om
            </Button>
          </Row>
        </Notice>
      )}
      {v.stuck && (
        <Notice tone="warn" title={`Fastnat i fas ${v.stuck.phase}`}>
          Ärendet har varit i fas {v.stuck.phase} ({v.stuck.phaseName}) i {v.stuck.days} dagar. Gränsen är {v.stuck.maxDays} dagar. Slutför kartläggningen och välj yrkesspår så att
          deltagaren kan gå vidare.
        </Notice>
      )}
      {v.backgroundInfo && (
        <Notice tone="info" title="Från beställningen">
          {v.backgroundInfo}
          {v.needsInterpreter ? " Deltagaren behöver tolk." : ""}
        </Notice>
      )}
      {savedNow === "approved" && (
        <Notice tone="ok" title="Kartläggningen är godkänd">
          Nästa steg: sätt veckomålet i första mötet och flytta ärendet till fas 2 när deltagaren är redo.
          <Row className="mt-2">
            <Button kind="primary" iconRight="arrow-right" to={`/avstamning/${encodeURIComponent(c.caseId)}`}>
              Öppna mötet
            </Button>
          </Row>
        </Notice>
      )}

      <Card title="Erfarenhet och utbildning" icon="briefcase">
        <FormGrid>
          <Field
            full
            label="Arbetslivserfarenhet"
            id="ia-work"
            required={req}
            error={errors.workExperience}
            help="Vad har deltagaren arbetat med, var och hur länge? Även oavlönat arbete och arbete i andra länder räknas."
          >
            <TextArea rows={3} value={f.workExperience} onValueChange={(x) => set("workExperience", x)} maxLength={800} />
          </Field>
          <Field label="Utbildning" id="ia-edu" required={req} error={errors.education} help="Högsta avslutade utbildning, även från andra länder. Pågående SFI räknas.">
            <Input value={f.education} onValueChange={(x) => set("education", x)} maxLength={160} />
          </Field>
          <Field label="Språk" id="ia-lang" required={req} error={errors.languageNotes} help="Modersmål och hur väl deltagaren förstår och talar svenska i arbetet.">
            <Input value={f.languageNotes} onValueChange={(x) => set("languageNotes", x)} maxLength={200} />
          </Field>
          <Field full label="Digital vana" id="ia-dig" required={req} error={errors.digitalSkills}>
            <Seg id="ia-dig" ariaLabel="Digital vana" value={f.digitalSkills} onValueChange={(x) => set("digitalSkills", x)} options={withValue(DIGITAL, f.digitalSkills)} />
          </Field>
          <Field full label="Körkort" id="ia-lic" required={req} error={errors.drivingLicence}>
            <Seg id="ia-lic" ariaLabel="Körkort" value={f.drivingLicence} onValueChange={(x) => set("drivingLicence", x)} options={withValue(LICENCE, f.drivingLicence)} />
          </Field>
        </FormGrid>
      </Card>

      <Card title="Mål och yrkesspår" icon="target">
        <Stack>
          <Field label="Yrkesmål" id="ia-goal" required={req} error={errors.workGoals} help="Med deltagarens egna ord: vilket arbete vill hen ha?">
            <Input value={f.workGoals} onValueChange={(x) => set("workGoals", x)} maxLength={200} />
          </Field>
          <Field
            label="Valt yrkesspår"
            id="ia-track"
            required={req}
            error={errors.chosenTrack}
            help={`Spår inom ${v.areaNames.primary}${v.areaNames.secondary ? ` och ${v.areaNames.secondary}` : ""}.`}
          >
            {allTracks ? (
              <Select value={f.chosenTrack} placeholder="Välj yrkesspår" onValueChange={(x) => set("chosenTrack", x)} options={v.tracks.all} />
            ) : (
              <Seg id="ia-track" ariaLabel="Valt yrkesspår" value={f.chosenTrack} onValueChange={(x) => set("chosenTrack", x)} options={withValue(v.tracks.area, f.chosenTrack)} />
            )}
          </Field>
          <div>
            <Button kind="ghost" icon={allTracks ? "chevron-up" : "chevron-down"} onClick={() => setAllTracks(!allTracks)}>
              {allTracks ? "Visa bara spår i avtalsområdet" : "Visa spår i alla avtalsområden"}
            </Button>
          </div>
          <Field
            label="Behov av anpassning"
            id="ia-adapt"
            error={errors.adaptations}
            help="Beskriv funktionellt vad som behövs, till exempel ”behöver instruktioner i skrift”. Skriv aldrig diagnos. Lämna tomt om inget behövs."
          >
            <TextArea rows={2} value={f.adaptations} invalid={diag} onValueChange={(x) => set("adaptations", x)} maxLength={300} />
          </Field>
          {diag && !errors.adaptations && (
            <Notice tone="warn" title="Det ser ut som en diagnos">
              Beskriv i stället vad deltagaren behöver i arbetet. Diagnoser dokumenteras aldrig i Miljonmatch.
            </Notice>
          )}
          <Field label="Första veckomål" id="ia-first" required={req} error={errors.firstWeekGoal} help="Kort och konkret. Följs upp i första mötet.">
            <Input value={f.firstWeekGoal} onValueChange={(x) => set("firstWeekGoal", x)} maxLength={140} />
          </Field>
          <Chips label="Förslag på första veckomål" items={v.firstWeekGoals.filter((x) => x !== f.firstWeekGoal)} onPick={(g) => set("firstWeekGoal", g)} />
        </Stack>
      </Card>

      <Row>
        {approved ? (
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void doSave(false)}>
            Spara ändringar
          </Button>
        ) : (
          <>
            <Button kind="primary" size="lg" icon="check" pending={save.pending} onClick={() => void doSave(true)}>
              Godkänn kartläggningen
            </Button>
            <Button kind="secondary" icon="file" pending={save.pending} onClick={() => void doSave(false)}>
              Spara utkast
            </Button>
          </>
        )}
        {!approved && <AutosaveStatus state={autosave.state} savedAt={autosave.savedAt} invalidText={autosave.invalidText} />}
      </Row>
    </Page>
  );
}
