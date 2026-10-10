"use client";
// Ny aktivitet (/aktiviteter/ny) – en gruppaktivitet för flera deltagare (coachmötet 2026-10-09): namn, typ, tid, plats,
// ansvarig, gruppmål och deltagarna (Bjud in deltagare – per grupp, nivå eller enskilt) och kryssrutan för inbjudan till
// deltagarna. Efter Skapa visas aktivitetsvyn.
import { useState } from "react";
import { plural } from "@/core/format";
import { addWorkingDays, dayOf } from "@/core/time";
import { useCommand } from "@/shell/backend";
import { leaveWithoutAsking, useUnsavedGuard } from "@/shell/guard";
import { useNav } from "@/shell/nav";
import { Button, Card, ErrorNotice, Loading, Notice, Page, Row, Stack, toast } from "@/ui";
import { groupActivityCreate, type InviteProblem } from "../api";
import { EMPTY_CHOICE, InviteParticipants, resolveChoice, type InviteChoice } from "./bjud-in";
import {
  ActivityFields, blankForm, formErrors, isUpcoming, notifiedText, NotifyCheck, payloadOf, ProblemList, replacedText, skippedText, useActivityConfirm, useActivityFormData,
  type ActivityFormState,
} from "./form";

const CRUMBS = [{ label: "Aktiviteter", to: "/aktiviteter" }, { label: "Ny aktivitet" }];

export function NyAktivitetScreen() {
  const { data, error, retry } = useActivityFormData();
  if (!data) {
    return (
      <Page title="Ny aktivitet" crumbs={CRUMBS}>
        {error ? <ErrorNotice error={error as Error} onRetry={retry} /> : <Loading />}
      </Page>
    );
  }
  return <NyAktivitet form={data} />;
}

function NyAktivitet({ form }: { form: NonNullable<ReturnType<typeof useActivityFormData>["data"]> }) {
  const nav = useNav();
  const create = useCommand(groupActivityCreate);
  const withConfirm = useActivityConfirm();
  const [initial] = useState<ActivityFormState>(() => blankForm(form, addWorkingDays(dayOf(form.now), 1)));
  const [value, setValue] = useState<ActivityFormState>(initial);
  const [choice, setChoice] = useState<InviteChoice>(EMPTY_CHOICE);
  const [notify, setNotify] = useState(true);
  const [tried, setTried] = useState(false);
  const [problems, setProblems] = useState<InviteProblem[]>([]);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : null;
  const resolved = resolveChoice(choice, form, day);
  const caseIds = resolved.caseIds;
  const upcoming = isUpcoming(`${value.date}T${value.time}`, form.now);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial) || caseIds.length > 0 || choice.groupingIds.length > 0;
  useUnsavedGuard(dirty && !create.pending);

  const submit = async () => {
    setTried(true);
    setProblems([]);
    if (Object.keys(formErrors(value)).length) return;
    const res = await withConfirm((c) => create.run({ ...payloadOf(value), caseIds, ...resolved.payload, notify: upcoming && notify && caseIds.length > 0, ...c }).catch(() => null));
    if (!res) return;
    if (!res.ok) {
      if ("problems" in res) setProblems(res.problems);
      toast(res.message ?? "Aktiviteten kunde inte skapas.", "error");
      return;
    }
    toast(`Aktiviteten är skapad${res.invited ? ` med ${plural(res.invited, "deltagare", "deltagare")}` : ""}.${replacedText(res.replaced)}${skippedText(res.skipped)}${notifiedText(res.notified)}`);
    leaveWithoutAsking(() => nav.push(`/aktiviteter/${encodeURIComponent(res.groupActivityId)}`));
  };

  return (
    <Page title="Ny aktivitet" lead="En aktivitet för flera deltagare. Varje deltagare får aktiviteten i sin närvaro och veckorapport." crumbs={CRUMBS}>
      <Card title="Aktiviteten" icon="calendar">
        <ActivityFields form={form} value={value} onChange={setValue} tried={tried} idPrefix="ny-akt" />
      </Card>
      <Card title="Deltagare" icon="users">
        <Stack>
          <InviteParticipants form={form} day={day} value={choice} onChange={setChoice} idPrefix="ny-bjud" />
          {caseIds.length > 0 && <NotifyCheck id="ny-meddela" checked={notify} onChange={setNotify} label="Skicka inbjudan till deltagarna" upcoming={upcoming} />}
          {problems.length > 0 && (
            <Notice tone="critical" title="Några deltagare kan inte bjudas in">
              <ProblemList problems={problems} />
            </Notice>
          )}
        </Stack>
      </Card>
      <Row>
        <Button kind="primary" icon="check" pending={create.pending} onClick={() => void submit()}>
          Skapa aktiviteten{caseIds.length ? ` med ${plural(caseIds.length, "deltagare", "deltagare")}` : ""}
        </Button>
        <Button kind="ghost" to="/aktiviteter">
          Avbryt
        </Button>
      </Row>
    </Page>
  );
}
