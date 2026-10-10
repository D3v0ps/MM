"use client";
// Aktivitetsvyn (/aktiviteter/:id) – coachmötet 2026-10-09: "man ska kunna se alla som kommer till aktiviteten, vi ska kunna ta
// närvaro där". Rubrik, tid, plats och ansvarig; alla inbjudna med närvaro per rad (samma statusar och regler som Närvaro:
// coach.attendanceSet), "Markera övriga som närvarande" (coach.attendanceSetAll – bekräftelse med namnen, ändrar aldrig det som
// redan är registrerat) och en rad anteckning per deltagare som sparas som vanlig anteckning med aktivitetens dag (ingen tid).
// Spår G: gruppmålet – alla klarar det automatiskt (märkt "Automatiskt"), coachen markerar Klarade inte per deltagare och kan
// ändra tillbaka (aktiviteter.malResultat). Internt: syns bara här. Bjud in per grupp, nivå eller enskilt, och kryssrutorna för
// meddelandet till deltagarna när de bjuds in, när tid eller plats ändras, när en deltagare tas bort och när aktiviteten ställs in.
import { useRef, useState } from "react";
import { GROUP_KIND_LABEL } from "@/core/group-activities";
import { plural } from "@/core/format";
import { dayOf, fmtDate, fmtDateTime, fmtDateTimeLong, fmtTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useUnsavedGuard } from "@/shell/guard";
import { useNav } from "@/shell/nav";
import { usePageTitle } from "@/shell/page-effects";
import type { ScreenProps } from "@/shell/routes";
import { Badge, Button, Card, CaseLink, Check, ErrorNotice, Field, Input, Kv, Loading, Modal, Notice, Page, Row, Seg, Stack, toast, useAuditView, useConfirm, type SegOption } from "@/ui";
import { auditView } from "@/features/session/api";
import { durationLabel } from "@/features/arenden/screens/kort-start";
import { attendanceSet, attendanceSetAll } from "@/features/coach/api";
import { ATT_OPTIONS, AttBadge } from "@/features/coach/screens/shared";
import {
  ACTIVITY_NOTE_MAX, groupActivityCancel, groupActivityInvite, groupActivityNotes, groupActivityRemove, groupActivityUpdate, groupActivityView, groupGoalResultSet,
  type GroupActivityView, type GroupParticipant, type InviteProblem,
} from "../api";
import { EMPTY_CHOICE, InviteParticipants, resolveChoice, type InviteChoice } from "./bjud-in";
import {
  ActivityFields, formErrors, formOf, isUpcoming, notifiedText, NotifyCheck, payloadOf, ProblemList, replacedText, skippedText, useActivityConfirm, useActivityFormData,
  type ActivityFormState,
} from "./form";

const CRUMB = { label: "Aktiviteter", to: "/aktiviteter" };
type Ok = Extract<GroupActivityView, { kind: "ok" }>;
type AttStatus = "present" | "late" | "absent_valid" | "absent_invalid";

/** Gruppmålet per deltagare: Klarade (blå) eller Klarade inte (röd ram) – text och ikon, aldrig bara färg. */
const GOAL_OPTIONS: SegOption<"yes" | "no">[] = [
  { value: "yes", label: "Klarade", icon: "check", tone: "green" },
  { value: "no", label: "Klarade inte", icon: "x", tone: "red" },
];
/** Frånvarande deltagare räknas inte i gruppmålet (de var inte med). */
const isAbsent = (p: GroupParticipant) => p.attendance?.status === "absent_valid" || p.attendance?.status === "absent_invalid";

/** En kryssruta i en bekräftelsedialog (förvald). Valet läses ur boxRef när dialogen stängs. */
function ConfirmCheck({ id, boxRef, label }: { id: string; boxRef: { current: boolean }; label: string }) {
  const [on, setOn] = useState(true);
  return (
    <Check
      id={id}
      checked={on}
      onCheckedChange={(v) => {
        boxRef.current = v;
        setOn(v);
      }}
    >
      {label}
    </Check>
  );
}

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
  // Visningslogg (CLAUDE.md punkt 3): vyn visar deltagarnas namn, närvaro och dagens anteckningar – en gång per sidbesök, som
  // deltagarkortet. Servern slår upp vilka deltagare som visades.
  const logView = useCommand(auditView);
  useAuditView(`group_activity.view:${a.id}`, () => logView.run({ action: "group_activity.view", entity: "group_activity", entityId: a.id }).catch(() => undefined));
  const nav = useNav();
  const confirm = useConfirm();
  const set = useCommand(attendanceSet);
  const setAll = useCommand(attendanceSetAll);
  const remove = useCommand(groupActivityRemove);
  const cancel = useCommand(groupActivityCancel);
  const saveNotes = useCommand(groupActivityNotes);
  const setGoal = useCommand(groupGoalResultSet);
  const notifyBox = useRef(true);
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
  const upcoming = isUpcoming(a.startsAt, v.now);
  const parts = v.participants;
  // Gruppmålet räknas bland dem som var med (inte frånvarande).
  const goalParts = a.goal ? parts.filter((p) => !isAbsent(p)) : [];
  const goalDone = goalParts.filter((p) => p.goal?.achieved !== false).length;
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
  const markGoal = async (p: GroupParticipant, achieved: boolean) => {
    const key = `mal:${p.caseId}`;
    if (inflight[key]) return;
    setInflight((x) => ({ ...x, [key]: true }));
    const res = await setGoal.run({ id: a.id, caseId: p.caseId, achieved }).catch(() => null);
    setInflight((x) => {
      const next = { ...x };
      delete next[key];
      return next;
    });
    if (!res || !res.ok) toast(res && !res.ok && res.message ? res.message : "Gruppmålet kunde inte sparas.", "error");
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
    notifyBox.current = true;
    const ok = await confirm({
      title: "Ta bort deltagaren?",
      body: (
        <Stack gap="sm">
          <p className="m-0">{`${p.name} (${p.caseNumber}) tas bort från ${a.name}. Tillfället försvinner ur deltagarens närvaro.`}</p>
          {upcoming && <ConfirmCheck id="akt-ta-bort-meddela" boxRef={notifyBox} label="Meddela deltagaren att aktiviteten är inställd för hen (e-post eller SMS med tid och plats)" />}
        </Stack>
      ),
      confirmLabel: "Ta bort",
      cancelLabel: "Avbryt",
      tone: "danger",
    });
    if (!ok) return;
    const res = await remove.run({ id: a.id, caseId: p.caseId, notify: upcoming && notifyBox.current }).catch(() => null);
    if (!res || !res.ok) toast(res && !res.ok && res.message ? res.message : "Deltagaren kunde inte tas bort.", "error");
    else toast(`${p.name} är borttagen från aktiviteten.${notifiedText(res.notified)}`);
  };

  const cancelActivity = async () => {
    notifyBox.current = true;
    const ok = await confirm({
      title: "Ställa in aktiviteten?",
      body: (
        <Stack gap="sm">
          <p className="m-0">{`${a.name} ${fmtDateTimeLong(a.startsAt)} ställs in. ${parts.length ? `Tillfället tas bort ur närvaron för ${plural(parts.length, "deltagare", "deltagare")}.` : ""}`}</p>
          {upcoming && parts.length > 0 && (
            <ConfirmCheck id="akt-stall-in-meddela" boxRef={notifyBox} label="Meddela deltagarna att aktiviteten är inställd (e-post eller SMS med tid och plats)" />
          )}
        </Stack>
      ),
      confirmLabel: "Ställ in",
      cancelLabel: "Avbryt",
      tone: "danger",
    });
    if (!ok) return;
    const res = await cancel.run({ id: a.id, notify: upcoming && parts.length > 0 && notifyBox.current }).catch(() => null);
    if (!res || !res.ok) toast(res && !res.ok && res.message ? res.message : "Aktiviteten kunde inte ställas in.", "error");
    else {
      toast(`${res.kept ? `Aktiviteten är inställd. ${plural(res.kept, "deltagare", "deltagare")} hann få närvaro registrerad och ligger kvar.` : "Aktiviteten är inställd."}${notifiedText(res.notified)}`);
    }
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
            ["Gruppmål", a.goal ?? "Inget gruppmål"],
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
          {a.goal && parts.length > 0 && (
            <p className="m-0 text-body" data-testid="gruppmal-summa">
              {started
                ? `Gruppmål: ${goalDone} av ${goalParts.length} klarade. Alla klarar målet automatiskt – markera den som inte klarade det.`
                : "Gruppmålet markeras när aktiviteten har startat. Alla klarar målet automatiskt."}
            </p>
          )}
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
              {started && a.goal && p.goal && <GoalRow p={p} canEdit={v.canEdit} busy={!!inflight[`mal:${p.caseId}`]} onPick={(achieved) => void markGoal(p, achieved)} />}
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
              <span className="text-body text-text-muted">Tomma rader sparas inte. Skriv aldrig personnummer – ärendenumret räcker.</span>
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
  const withConfirm = useActivityConfirm();
  const [initial] = useState<ActivityFormState>(() => formOf(v.activity));
  const [value, setValue] = useState<ActivityFormState>(initial);
  const [tried, setTried] = useState(false);
  const [problems, setProblems] = useState<InviteProblem[]>([]);
  const [notify, setNotify] = useState(true);
  // Ny tid eller plats: deltagarna kan få ett meddelande (bara när aktiviteten inte har börjat).
  const timeOrPlace = value.date !== initial.date || value.time !== initial.time || value.location.trim() !== initial.location.trim();
  const upcoming = isUpcoming(`${value.date}T${value.time}`, v.now);
  const submit = async () => {
    setTried(true);
    setProblems([]);
    if (Object.keys(formErrors(value)).length) return;
    const send = timeOrPlace && upcoming && notify && v.participants.length > 0;
    const res = await withConfirm((c) => update.run({ id: v.activity.id, ...payloadOf(value), notify: send, ...c }).catch(() => null));
    if (!res) return;
    if (!res.ok) {
      if ("problems" in res) setProblems(res.problems);
      toast(res.message ?? "Ändringen kunde inte sparas.", "error");
      return;
    }
    toast(res.changed ? `Aktiviteten är ändrad för alla deltagare.${replacedText(res.replaced)}${notifiedText(res.notified)}` : "Inget var ändrat.");
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
          {timeOrPlace && v.participants.length > 0 && (
            <NotifyCheck id="andra-meddela" checked={notify} onChange={setNotify} label="Skicka ny tid och plats till deltagarna" upcoming={upcoming} />
          )}
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
  const withConfirm = useActivityConfirm();
  const [choice, setChoice] = useState<InviteChoice>(EMPTY_CHOICE);
  const [notify, setNotify] = useState(true);
  const [problems, setProblems] = useState<InviteProblem[]>([]);
  const already = v.participants.map((p) => p.caseId);
  const resolved = data ? resolveChoice(choice, data, dayOf(v.activity.startsAt), already) : null;
  const caseIds = resolved?.caseIds ?? [];
  const upcoming = isUpcoming(v.activity.startsAt, v.now);
  const submit = async () => {
    setProblems([]);
    if (!caseIds.length || !resolved) return;
    const res = await withConfirm((c) => invite.run({ id: v.activity.id, caseIds, ...resolved.payload, notify: upcoming && notify, replaceOverlapping: c.replaceOverlapping }).catch(() => null));
    if (!res) return;
    if (!res.ok) {
      if ("problems" in res) setProblems(res.problems);
      toast(res.message ?? "Deltagarna kunde inte bjudas in.", "error");
      return;
    }
    toast(`${plural(res.invited, "deltagare inbjuden", "deltagare inbjudna")}.${replacedText(res.replaced)}${skippedText(res.skipped)}${notifiedText(res.notified)}`);
    onClose();
  };
  return (
    <Modal
      title="Bjud in deltagare"
      wide
      onClose={onClose}
      dirty={caseIds.length > 0 || choice.groupingIds.length > 0}
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
          <InviteParticipants form={data} day={dayOf(v.activity.startsAt)} value={choice} onChange={setChoice} alreadyInvited={already} idPrefix="akt-bjud" />
          {caseIds.length > 0 && <NotifyCheck id="akt-bjud-meddela" checked={notify} onChange={setNotify} label="Skicka inbjudan till deltagarna" upcoming={upcoming} />}
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

/** Gruppmålet för en deltagare: Klarade (automatiskt tills någon väljer) eller Klarade inte. Frånvarande räknas inte. */
function GoalRow({ p, canEdit, busy, onPick }: { p: GroupParticipant; canEdit: boolean; busy: boolean; onPick: (achieved: boolean) => void }) {
  const g = p.goal!;
  if (isAbsent(p)) {
    return (
      <p className="m-0 text-body text-text-muted" data-testid="gruppmal">
        Gruppmål: räknas inte – frånvarande.
      </p>
    );
  }
  const auto = g.auto ? (
    <Badge tone="outline" icon="refresh" title="Alla klarar gruppmålet automatiskt. Markera Klarade inte om deltagaren inte klarade det.">
      Automatiskt
    </Badge>
  ) : null;
  if (!canEdit) {
    return (
      <Row gap="sm" data-testid="gruppmal">
        <span className="text-body font-bold">Gruppmål:</span>
        <Badge tone={g.achieved ? "blue" : "red"} icon={g.achieved ? "check" : "x"}>
          {g.achieved ? "Klarade" : "Klarade inte"}
        </Badge>
        {auto}
      </Row>
    );
  }
  return (
    <Row gap="sm" data-testid="gruppmal">
      <span className="text-body font-bold" id={`mal-${p.caseId}`}>
        Gruppmål:
      </span>
      <Seg ariaLabel={`Gruppmål för ${p.name}`} value={g.achieved ? "yes" : "no"} onValueChange={(x) => onPick(x === "yes")} options={GOAL_OPTIONS} busy={busy} />
      {auto}
    </Row>
  );
}
