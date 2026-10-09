"use client";
// Aktivitetsvyn (/aktiviteter/:id) – coachmötet 2026-10-09: "man ska kunna se alla som kommer till aktiviteten, vi ska kunna ta
// närvaro där". Rubrik, tid, plats och ansvarig; alla inbjudna med närvaro per rad (samma statusar och regler som Närvaro:
// coach.attendanceSet), "Markera övriga som närvarande" (coach.attendanceSetAll – bekräftelse med namnen, ändrar aldrig det som
// redan är registrerat) och en rad anteckning per deltagare som sparas som vanlig anteckning med aktivitetens dag (ingen tid).
import { useState } from "react";
import { GROUP_KIND_LABEL } from "@/core/group-activities";
import { plural } from "@/core/format";
import { dayOf, fmtDate, fmtDateTime, fmtDateTimeLong, fmtTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useUnsavedGuard } from "@/shell/guard";
import { useNav } from "@/shell/nav";
import { usePageTitle } from "@/shell/page-effects";
import type { ScreenProps } from "@/shell/routes";
import { Badge, Button, Card, CaseLink, ErrorNotice, Field, Input, Kv, Loading, Modal, Notice, Page, Row, Seg, Stack, toast, useConfirm } from "@/ui";
import { durationLabel } from "@/features/arenden/screens/kort-start";
import { attendanceSet, attendanceSetAll } from "@/features/coach/api";
import { ATT_OPTIONS, AttBadge } from "@/features/coach/screens/shared";
import {
  ACTIVITY_NOTE_MAX, groupActivityCancel, groupActivityInvite, groupActivityNotes, groupActivityRemove, groupActivityUpdate, groupActivityView,
  type GroupActivityView, type GroupParticipant, type InviteProblem,
} from "../api";
import { InviteParticipants } from "./bjud-in";
import { ActivityFields, formErrors, formOf, payloadOf, ProblemList, useActivityFormData, useHolidayConfirm, type ActivityFormState } from "./form";

const CRUMB = { label: "Aktiviteter", to: "/aktiviteter" };
type Ok = Extract<GroupActivityView, { kind: "ok" }>;
type AttStatus = "present" | "late" | "absent_valid" | "absent_invalid";

export function AktivitetScreen({ params }: ScreenProps) {
  const q = useQuery(groupActivityView, { id: params.id ?? "" });
  if (!q.data) {
    return (
      <Page title="Aktivitet" crumbs={[CRUMB, { label: "Aktivitet" }]}>
        {q.error ? <ErrorNotice error={q.error} onRetry={() => void q.refetch()} /> : <Loading />}
      </Page>
    );
  }
  if (q.data.kind === "gate") {
    return (
      <Page title="Aktivitet" crumbs={[CRUMB, { label: "Aktivitet" }]}>
        <Notice tone="warn" title={q.data.title}>
          {q.data.text}
        </Notice>
        <Row>
          <Button kind="primary" icon="list" to="/aktiviteter">
            Till aktiviteterna
          </Button>
        </Row>
      </Page>
    );
  }
  return <Aktivitet v={q.data} />;
}

function Aktivitet({ v }: { v: Ok }) {
  const a = v.activity;
  usePageTitle(a.name);
  const nav = useNav();
  const confirm = useConfirm();
  const set = useCommand(attendanceSet);
  const setAll = useCommand(attendanceSetAll);
  const remove = useCommand(groupActivityRemove);
  const cancel = useCommand(groupActivityCancel);
  const saveNotes = useCommand(groupActivityNotes);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [inflight, setInflight] = useState<Record<string, true>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteProblems, setNoteProblems] = useState<InviteProblem[]>([]);
  const [bulk, setBulk] = useState<string>("");
  const day = dayOf(a.startsAt);
  const started = a.startsAt < v.now;
  const notesOpen = day <= dayOf(v.now);
  const parts = v.participants;
  const open = parts.filter((p) => !p.attendance);
  const filledNotes = Object.entries(notes).filter(([, t]) => t.trim());
  useUnsavedGuard(filledNotes.length > 0 && !saveNotes.pending);

  const register = async (p: GroupParticipant, status: AttStatus, reason = "") => {
    if (inflight[p.activityId] || setAll.pending) return;
    setPending(null);
    setInflight((x) => ({ ...x, [p.activityId]: true }));
    const res = await set.run({ activityId: p.activityId, status, reason }).catch(() => null);
    setInflight((x) => {
      const next = { ...x };
      delete next[p.activityId];
      return next;
    });
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Närvaron kunde inte sparas.", "error");
      return;
    }
    if (res.published) toast(res.published.text);
  };
  const pick = (p: GroupParticipant, s: AttStatus) => {
    if (s === "absent_valid") setPending(p.activityId);
    else void register(p, s);
  };

  const markOthers = async () => {
    if (!open.length) return;
    const ok = await confirm({
      title: `Markera ${open.length} som närvarande?`,
      body: (
        <Stack gap="sm">
          <p>Närvarande registreras för:</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {open.map((p) => (
              <li key={p.activityId}>
                {p.name} ({p.caseNumber})
              </li>
            ))}
          </ul>
          <p>Deltagare som redan är registrerade ändras inte.</p>
        </Stack>
      ),
      confirmLabel: `Markera ${open.length} som närvarande`,
      cancelLabel: "Avbryt",
    });
    if (!ok) return;
    setPending(null);
    const res = await setAll.run({ day, activityIds: open.map((p) => p.activityId) }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Närvaron kunde inte sparas.", "error");
      return;
    }
    setBulk(`${res.marked.length} av ${open.length} markerade som närvarande.`);
    toast(`${plural(res.marked.length, "deltagare markerad", "deltagare markerade")} som närvarande.`);
    for (const pub of res.published) toast(pub.text);
  };

  const removeParticipant = async (p: GroupParticipant) => {
    const ok = await confirm({ title: "Ta bort deltagaren?", body: `${p.name} (${p.caseNumber}) tas bort från ${a.name}. Tillfället försvinner ur deltagarens närvaro.`, confirmLabel: "Ta bort", cancelLabel: "Avbryt", tone: "danger" });
    if (!ok) return;
    const res = await remove.run({ id: a.id, caseId: p.caseId }).catch(() => null);
    if (!res || !res.ok) toast(res && !res.ok && res.message ? res.message : "Deltagaren kunde inte tas bort.", "error");
    else toast(`${p.name} är borttagen från aktiviteten.`);
  };

  const cancelActivity = async () => {
    const ok = await confirm({
      title: "Ställa in aktiviteten?",
      body: `${a.name} ${fmtDateTimeLong(a.startsAt)} ställs in. ${parts.length ? `Tillfället tas bort ur närvaron för ${plural(parts.length, "deltagare", "deltagare")}.` : ""}`,
      confirmLabel: "Ställ in",
      cancelLabel: "Avbryt",
      tone: "danger",
    });
    if (!ok) return;
    const res = await cancel.run({ id: a.id }).catch(() => null);
    if (!res || !res.ok) toast(res && !res.ok && res.message ? res.message : "Aktiviteten kunde inte ställas in.", "error");
    else toast("Aktiviteten är inställd.");
  };

  const submitNotes = async () => {
    setNoteProblems([]);
    const list = filledNotes.map(([caseId, body]) => ({ caseId, body: body.trim() }));
    if (!list.length) return;
    const res = await saveNotes.run({ id: a.id, notes: list }).catch(() => null);
    if (!res || !res.ok) {
      if (res && "problems" in res) setNoteProblems(res.problems);
      toast(res && !res.ok && res.message ? res.message : "Anteckningarna kunde inte sparas.", "error");
      return;
    }
    setNotes({});
    toast(`${plural(res.saved, "anteckning sparad", "anteckningar sparade")} i deltagarkorten.`);
  };

  const actions = v.canEdit ? (
    <Row gap="sm">
      <Button icon="users" onClick={() => setInviting(true)}>
        Bjud in deltagare
      </Button>
      <Button icon="edit" onClick={() => setEditing(true)}>
        Ändra
      </Button>
      <Button kind="danger" icon="x" pending={cancel.pending} onClick={() => void cancelActivity()}>
        Ställ in
      </Button>
    </Row>
  ) : undefined;

  return (
    <Page
      eyebrow={`Aktivitet · ${GROUP_KIND_LABEL[a.kind]}`}
      title={a.name}
      lead={`${fmtDateTimeLong(a.startsAt)} · ${durationLabel(a.durationMin)} · ${a.location}`}
      crumbs={[CRUMB, { label: a.name }]}
      actions={actions}
    >
      {a.cancelledAt && (
        <Notice tone="warn" icon="x-circle" title="Inställd">
          Aktiviteten ställdes in {fmtDateTime(a.cancelledAt)}. Deltagarnas tillfällen är borttagna.
        </Notice>
      )}
      {a.holiday && !a.cancelledAt && (
        <Notice tone="warn" icon="calendar" title="Helgdag">
          {fmtDate(day)} är en helgdag ({a.holiday}). Närvaron registreras inte automatiskt – registrera den här.
        </Notice>
      )}
      <Card title="Om aktiviteten" icon="info">
        <Kv
          items={[
            ["Tid", `${fmtDateTimeLong(a.startsAt)}, ${durationLabel(a.durationMin)}`],
            ["Plats", a.location],
            ["Ansvarig", a.responsibleName ?? "Ingen ansvarig"],
            ["Skapad av", a.createdByName],
          ]}
        />
      </Card>

      <Card
        id="akt-deltagare"
        title={`Deltagare (${parts.length})`}
        icon="users"
        flush
        actions={
          started && v.canEdit && open.length > 0 ? (
            <Button kind="primary" icon="check-square" pending={setAll.pending} onClick={() => void markOthers()}>
              Markera övriga som närvarande ({open.length})
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-1 border-b border-ljusgra px-[18px] py-3">
          <p className="m-0 text-body">
            {parts.length === 0
              ? "Inga deltagare är inbjudna än."
              : !started
                ? "Närvaron registreras när aktiviteten har startat. Markera de som är sena eller frånvarande och sedan övriga som närvarande."
                : open.length === 0
                  ? "Närvaron är registrerad för alla deltagare."
                  : `${parts.length - open.length} av ${parts.length} registrerade. Markera sena och frånvarande först, sedan övriga som närvarande.`}
          </p>
          {/* Statusraden finns alltid (tom tills något markerats), så att skärmläsare läser upp resultatet. */}
          <p role="status" aria-live="polite" className="m-0 text-body font-bold">
            {bulk}
          </p>
        </div>
        {parts.map((p) => {
          const isPending = pending === p.activityId;
          const busy = !!inflight[p.activityId] || setAll.pending;
          return (
            <div key={p.activityId} data-testid="aktivitet-deltagare" className="flex flex-col gap-2.5 border-b border-ljusgra px-[18px] py-3.5 last:border-b-0">
              <Row between>
                <div className="flex min-w-0 flex-col gap-[3px]">
                  <CaseLink caseId={p.caseId} caseNumber={p.caseNumber} className="-ml-1.5 font-bold">
                    {p.name}
                  </CaseLink>
                  <span className="text-small text-text-muted tabular-nums">{p.caseNumber}</span>
                </div>
                <Row gap="sm">
                  {started ? (
                    <AttBadge at={p.attendance} />
                  ) : (
                    <Badge tone="outline" icon="clock">
                      Inbjuden
                    </Badge>
                  )}
                  {v.canEdit && !p.attendance && (
                    <Button kind="ghost" icon="trash" pending={remove.pending} onClick={() => void removeParticipant(p)} ariaLabel={`Ta bort ${p.name} från aktiviteten`}>
                      Ta bort
                    </Button>
                  )}
                </Row>
              </Row>
              {started && v.canEdit && (
                <>
                  <Seg
                    ariaLabel={`Närvaro för ${p.name}`}
                    value={isPending ? "absent_valid" : (p.attendance?.status ?? null)}
                    onValueChange={(s) => pick(p, s)}
                    options={ATT_OPTIONS}
                    busy={busy}
                    className="max-[560px]:grid max-[560px]:grid-cols-2"
                  />
                  {isPending && (
                    <div role="group" aria-label="Orsak till giltig frånvaro" className="flex flex-col gap-1.5 rounded-mb border-[1.5px] border-antracit px-3 py-2.5">
                      <span className="text-body font-bold">Välj orsak (inga andra detaljer):</span>
                      <Seg
                        ariaLabel="Orsak"
                        value={p.attendance?.status === "absent_valid" ? p.attendance.reason : null}
                        onValueChange={(r) => void register(p, "absent_valid", r)}
                        options={v.absenceReasons.map((r) => ({ value: r, label: r }))}
                        busy={busy}
                      />
                      <div>
                        <Button kind="ghost" onClick={() => setPending(null)}>
                          Avbryt
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {p.notes.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {p.notes.map((n) => (
                    <li key={n.id} className="text-body">
                      <span className="text-small text-text-muted">{n.authorName}: </span>
                      {n.body}
                    </li>
                  ))}
                </ul>
              )}
              {v.canEdit && notesOpen && (
                <Field id={`akt-anteckning-${p.caseId}`} label={`Anteckning för ${p.name}`} help={`Sparas i deltagarkortet med datumet ${fmtDate(day)}.`}>
                  <Input value={notes[p.caseId] ?? ""} onValueChange={(t) => setNotes((x) => ({ ...x, [p.caseId]: t }))} maxLength={ACTIVITY_NOTE_MAX} />
                </Field>
              )}
            </div>
          );
        })}
        {v.canEdit && notesOpen && parts.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-ljusgra px-[18px] py-3.5">
            {noteProblems.length > 0 && (
              <Notice tone="critical" title="Ta bort personnummer">
                <ProblemList problems={noteProblems} />
              </Notice>
            )}
            <Row>
              <Button kind="primary" icon="edit" pending={saveNotes.pending} disabled={!filledNotes.length} onClick={() => void submitNotes()}>
                {filledNotes.length ? `Spara ${plural(filledNotes.length, "anteckning", "anteckningar")}` : "Spara anteckningar"}
              </Button>
              <span className="text-small text-text-muted">Tomma rader sparas inte. Skriv aldrig personnummer – ärendenumret räcker.</span>
            </Row>
          </div>
        )}
        {v.canEdit && !notesOpen && parts.length > 0 && <p className="m-0 border-t border-ljusgra px-[18px] py-3 text-body text-text-muted">Anteckningar skrivs från aktivitetens dag.</p>}
      </Card>
      {editing && <EditModal v={v} onClose={() => setEditing(false)} />}
      {inviting && <InviteModal v={v} onClose={() => setInviting(false)} />}
      <Row>
        <Button kind="ghost" icon="arrow-left" onClick={() => nav.push("/aktiviteter")}>
          Alla aktiviteter
        </Button>
        <span className="text-small text-text-muted">Uppdaterad {fmtTime(v.now)}</span>
      </Row>
    </Page>
  );
}

function EditModal({ v, onClose }: { v: Ok; onClose: () => void }) {
  const { data, error, retry } = useActivityFormData();
  const update = useCommand(groupActivityUpdate);
  const withHoliday = useHolidayConfirm();
  const [initial] = useState<ActivityFormState>(() => formOf(v.activity));
  const [value, setValue] = useState<ActivityFormState>(initial);
  const [tried, setTried] = useState(false);
  const [problems, setProblems] = useState<InviteProblem[]>([]);
  const submit = async () => {
    setTried(true);
    setProblems([]);
    if (Object.keys(formErrors(value)).length) return;
    const res = await withHoliday((acceptHoliday) => update.run({ id: v.activity.id, ...payloadOf(value), acceptHoliday }).catch(() => null));
    if (!res) return;
    if (!res.ok) {
      if ("problems" in res) setProblems(res.problems);
      toast(res.message ?? "Ändringen kunde inte sparas.", "error");
      return;
    }
    toast(res.changed ? "Aktiviteten är ändrad för alla deltagare." : "Inget var ändrat.");
    onClose();
  };
  return (
    <Modal
      title="Ändra aktiviteten"
      wide
      onClose={onClose}
      dirty={JSON.stringify(value) !== JSON.stringify(initial)}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="check" pending={update.pending} disabled={!data} onClick={() => void submit()}>
            Spara
          </Button>
        </>
      }
    >
      {!data ? (
        error ? <ErrorNotice error={error as Error} onRetry={retry} /> : <Loading />
      ) : (
        <Stack>
          <p className="m-0 text-body">Tid, längd, plats och typ ändras för alla deltagare. Tiden kan inte flyttas när närvaro är registrerad.</p>
          <ActivityFields form={data} value={value} onChange={setValue} tried={tried} idPrefix="andra-akt" />
          {problems.length > 0 && (
            <Notice tone="critical" title="Några deltagare kan inte vara med den dagen">
              <ProblemList problems={problems} />
            </Notice>
          )}
        </Stack>
      )}
    </Modal>
  );
}

function InviteModal({ v, onClose }: { v: Ok; onClose: () => void }) {
  const { data, error, retry } = useActivityFormData();
  const invite = useCommand(groupActivityInvite);
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [problems, setProblems] = useState<InviteProblem[]>([]);
  const submit = async () => {
    setProblems([]);
    if (!caseIds.length) return;
    const res = await invite.run({ id: v.activity.id, caseIds }).catch(() => null);
    if (!res || !res.ok) {
      if (res && "problems" in res) setProblems(res.problems);
      toast(res && !res.ok && res.message ? res.message : "Deltagarna kunde inte bjudas in.", "error");
      return;
    }
    toast(`${plural(res.invited, "deltagare inbjuden", "deltagare inbjudna")}.`);
    onClose();
  };
  return (
    <Modal
      title="Bjud in deltagare"
      wide
      onClose={onClose}
      dirty={caseIds.length > 0}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button kind="primary" icon="users" pending={invite.pending} disabled={!caseIds.length} onClick={() => void submit()}>
            {caseIds.length ? `Bjud in ${plural(caseIds.length, "deltagare", "deltagare")}` : "Bjud in"}
          </Button>
        </>
      }
    >
      {!data ? (
        error ? <ErrorNotice error={error as Error} onRetry={retry} /> : <Loading />
      ) : (
        <Stack>
          <InviteParticipants
            candidates={data.candidates}
            day={dayOf(v.activity.startsAt)}
            value={caseIds}
            onChange={setCaseIds}
            alreadyInvited={v.participants.map((p) => p.caseId)}
            idPrefix="akt-bjud"
          />
          {problems.length > 0 && (
            <Notice tone="critical" title="Några deltagare kan inte bjudas in">
              <ProblemList problems={problems} />
            </Notice>
          )}
        </Stack>
      )}
    </Modal>
  );
}
