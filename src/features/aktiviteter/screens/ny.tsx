"use client";
// Ny aktivitet (/aktiviteter/ny) – en gruppaktivitet för flera deltagare (coachmötet 2026-10-09): namn, typ, tid, plats,
// ansvarig, gruppmål och deltagarna (Bjud in deltagare – per yrkesområde, nivå eller enskilt) och kryssrutan för inbjudan till
// deltagarna. Efter Skapa visas aktivitetsvyn.
// Karims beslut 2026-10-22: "Upprepa varje vecka" gör aktiviteten återkommande (veckodagar Mån–Fre, första och sista dag) – för
// en nivå eller ett yrkesområde; servern skapar tillfällena två veckor framåt och bjuder in målgruppen. Meddelandet är av som
// standard för en återkommande aktivitet. Adressen kan förvälja målgruppen och dagen (bara koder och id:n): ?omrade=G, ?niva=<id>,
// ?datum=YYYY-MM-DD, ?upprepa=1 – Planera och Ny nivåaktivitet på Grupper och nivåer.
import { useState } from "react";
import { plural } from "@/core/format";
import { normalizeWeekdays, SERIES_RECOMMENDED_MAX_DAYS, SERIES_WEEKDAY_LABEL, SERIES_WEEKDAYS, seriesScheduleError } from "@/core/group-series";
import { addWorkingDays, dayOf } from "@/core/time";
import { useCommand } from "@/shell/backend";
import { leaveWithoutAsking, useUnsavedGuard } from "@/shell/guard";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { Button, Card, Check, DateInput, ErrorNotice, Field, Loading, Notice, Page, Row, Stack, toast } from "@/ui";
import { groupActivityCreate, groupActivitySeriesCreate, type InviteProblem } from "../api";
import { EMPTY_CHOICE, InviteParticipants, resolveChoice, type InviteChoice } from "./bjud-in";
import {
  ActivityFields, blankForm, formErrors, isUpcoming, notifiedText, NotifyCheck, payloadOf, ProblemList, replacedText, SERIES_NOTIFY_HELP, skippedText, useActivityConfirm,
  useActivityFormData, type ActivityFormState,
} from "./form";

const CRUMBS = [{ label: "Aktiviteter", to: "/aktiviteter" }, { label: "Ny aktivitet" }];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function NyAktivitetScreen({ query }: ScreenProps) {
  const { data, error, retry } = useActivityFormData();
  if (!data) {
    return (
      <Page title="Ny aktivitet" crumbs={CRUMBS}>
        {error ? <ErrorNotice error={error as Error} onRetry={retry} /> : <Loading />}
      </Page>
    );
  }
  return <NyAktivitet form={data} query={query} />;
}

/** Förval ur adressen: målgruppen (bara om den finns i formuläret), dagen och upprepningen. */
function presetFrom(query: URLSearchParams, form: NonNullable<ReturnType<typeof useActivityFormData>["data"]>): { choice: InviteChoice; date: string | null; repeat: boolean } {
  const area = query.get("omrade");
  const level = query.get("niva");
  const date = query.get("datum");
  const choice: InviteChoice = area && form.groupings.some((g) => g.kind === "area" && g.id === area)
    ? { mode: "omrade", audienceId: area, caseIds: [] }
    : level && form.groupings.some((g) => g.kind === "level" && g.id === level)
      ? { mode: "niva", audienceId: level, caseIds: [] }
      : EMPTY_CHOICE;
  const repeat = query.get("upprepa") === "1";
  return {
    choice: repeat && choice.mode === "enskilda" ? { mode: "niva", audienceId: null, caseIds: [] } : choice,
    date: date && DATE_RE.test(date) && date > dayOf(form.now) ? date : null,
    repeat,
  };
}

function NyAktivitet({ form, query }: { form: NonNullable<ReturnType<typeof useActivityFormData>["data"]>; query: URLSearchParams }) {
  const nav = useNav();
  const create = useCommand(groupActivityCreate);
  const createSeries = useCommand(groupActivitySeriesCreate);
  const withConfirm = useActivityConfirm();
  const [preset] = useState(() => presetFrom(query, form));
  const [initial] = useState<ActivityFormState>(() => ({ ...blankForm(form, addWorkingDays(dayOf(form.now), 1)), ...(preset.date ? { date: preset.date } : {}) }));
  const [value, setValue] = useState<ActivityFormState>(initial);
  const [choice, setChoice] = useState<InviteChoice>(preset.choice);
  const [notify, setNotify] = useState(true);
  const [repeat, setRepeat] = useState(preset.repeat);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endsOn, setEndsOn] = useState("");
  const [seriesNotify, setSeriesNotify] = useState(false);
  const [tried, setTried] = useState(false);
  const [problems, setProblems] = useState<InviteProblem[]>([]);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const day = DATE_RE.test(value.date) ? value.date : null;
  const resolved = resolveChoice(choice, form, day);
  const upcoming = isUpcoming(`${value.date}T${value.time}`, form.now);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial) || resolved.caseIds.length > 0 || choice.audienceId !== preset.choice.audienceId || repeat !== preset.repeat;
  useUnsavedGuard(dirty && !create.pending && !createSeries.pending);
  const pending = create.pending || createSeries.pending;
  const toggleDay = (d: number, on: boolean) => setWeekdays((xs) => normalizeWeekdays(on ? [...xs, d] : xs.filter((x) => x !== d)));
  // En återkommande aktivitet har alltid en målgrupp: fliken Enskilda finns inte då – Nivå väljs i stället.
  const toggleRepeat = (on: boolean) => {
    setRepeat(on);
    setSeriesError(null);
    if (on && choice.mode === "enskilda") setChoice({ mode: "niva", audienceId: null, caseIds: [] });
  };

  const submitSeries = async () => {
    setSeriesError(null);
    if (!resolved.audience) {
      setSeriesError("En återkommande aktivitet är för en nivå eller ett yrkesområde. Välj fliken Nivå eller Yrkesområde och välj målgruppen.");
      return;
    }
    const err = seriesScheduleError({ weekdays, startTime: value.time, startsOn: value.date, endsOn: endsOn || null }, dayOf(form.now));
    if (err) {
      setSeriesError(err);
      return;
    }
    const p = payloadOf(value);
    const res = await createSeries.run({
      name: p.name, kind: p.kind, weekdays, startTime: value.time, durationMin: p.durationMin, location: p.location, responsibleId: p.responsibleId, goal: p.goal,
      startsOn: value.date, endsOn: endsOn || null, audience: resolved.audience, notify: seriesNotify,
    }).catch(() => null);
    if (!res || !res.ok) {
      setSeriesError(res && !res.ok && res.message ? res.message : "Den återkommande aktiviteten kunde inte skapas.");
      toast(res && !res.ok && res.message ? res.message : "Den återkommande aktiviteten kunde inte skapas.", "error");
      return;
    }
    toast(
      `Den återkommande aktiviteten är skapad. ${res.occurrences ? `${plural(res.occurrences, "tillfälle", "tillfällen")} de närmaste två veckorna med ${plural(res.invited, "inbjudan", "inbjudningar")}.` : "Tillfällena skapas två veckor i förväg."}`,
    );
    leaveWithoutAsking(() => nav.push(res.firstId ? `/aktiviteter/${encodeURIComponent(res.firstId)}` : "/aktiviteter"));
  };

  const submit = async () => {
    setTried(true);
    setProblems([]);
    if (Object.keys(formErrors(value)).length) return;
    if (repeat) {
      await submitSeries();
      return;
    }
    const count = resolved.count;
    const res = await withConfirm((c) =>
      create.run({
        ...payloadOf(value), caseIds: resolved.caseIds, ...(resolved.audience ? { audience: resolved.audience } : {}), ...resolved.payload,
        notify: upcoming && notify && (count > 0 || !!resolved.audience), ...c,
      }).catch(() => null),
    );
    if (!res) return;
    if (!res.ok) {
      if ("problems" in res) setProblems(res.problems);
      toast(res.message ?? "Aktiviteten kunde inte skapas.", "error");
      return;
    }
    toast(`Aktiviteten är skapad${res.invited ? ` med ${plural(res.invited, "deltagare", "deltagare")}` : ""}.${replacedText(res.replaced)}${skippedText(res.skipped)}${notifiedText(res.notified)}`);
    leaveWithoutAsking(() => nav.push(`/aktiviteter/${encodeURIComponent(res.groupActivityId)}`));
  };

  const label = repeat
    ? "Skapa den återkommande aktiviteten"
    : `Skapa aktiviteten${resolved.count ? ` med ${plural(resolved.count, "deltagare", "deltagare")}` : ""}`;
  return (
    <Page title="Ny aktivitet" lead="En aktivitet för flera deltagare. Varje deltagare får aktiviteten i sin närvaro och veckorapport." crumbs={CRUMBS}>
      <Card title="Aktiviteten" icon="calendar">
        <ActivityFields form={form} value={value} onChange={setValue} tried={tried} idPrefix="ny-akt" repeating={repeat} />
      </Card>
      <Card title="Upprepa" icon="refresh">
        <Stack>
          <Check id="ny-upprepa" checked={repeat} onCheckedChange={toggleRepeat} aria-describedby="ny-upprepa-hjalp">
            <span className="font-bold">Upprepa varje vecka</span>
            <span id="ny-upprepa-hjalp" className="block text-body text-text-muted">
              Till exempel en nivåaktivitet på tisdagar och torsdagar. Tillfällena skapas två veckor i förväg, och helgdagar hoppas över.
            </span>
          </Check>
          {repeat && (
            <>
              <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" aria-describedby="ny-dagar-hjalp">
                <legend className="mb-1 text-ui font-bold">Veckodagar</legend>
                <p id="ny-dagar-hjalp" className="m-0 text-small text-text-muted">
                  Välj 1–{SERIES_RECOMMENDED_MAX_DAYS} dagar i veckan. Fler går att välja.
                </p>
                <div className="flex flex-wrap gap-x-4">
                  {SERIES_WEEKDAYS.map((d) => (
                    <Check key={d} id={`ny-dag-${d}`} checked={weekdays.includes(d)} onCheckedChange={(on) => toggleDay(d, on)}>
                      {SERIES_WEEKDAY_LABEL[d]}
                    </Check>
                  ))}
                </div>
                {weekdays.length > SERIES_RECOMMENDED_MAX_DAYS && (
                  <p className="m-0 text-body">Du har valt {weekdays.length} dagar. Nivåaktiviteterna brukar vara 1–{SERIES_RECOMMENDED_MAX_DAYS} gånger i veckan.</p>
                )}
              </fieldset>
              <Field id="ny-sista" label="Sista dagen (valfritt)" help="Lämna tomt om aktiviteten ska fortsätta tills vidare. Du kan avsluta den när som helst.">
                <DateInput value={endsOn} onValueChange={setEndsOn} />
              </Field>
              <Notice tone="info" icon="info" title="Dag, tid och längd ändras inte efteråt">
                Ska tiden ändras avslutar du den återkommande aktiviteten och skapar en ny. Namn, plats, ansvarig och gruppmål kan ändras.
              </Notice>
            </>
          )}
        </Stack>
      </Card>
      <Card title="Deltagare" icon="users">
        <Stack>
          <InviteParticipants form={form} day={day} value={choice} onChange={setChoice} idPrefix="ny-bjud" modes={repeat ? ["omrade", "niva"] : undefined} />
          {repeat ? (
            <NotifyCheck id="ny-meddela-serie" checked={seriesNotify} onChange={setSeriesNotify} label="Meddela deltagarna inför varje tillfälle" upcoming help={SERIES_NOTIFY_HELP} />
          ) : (
            (resolved.count > 0 || resolved.audience) && (
              <NotifyCheck
                id="ny-meddela"
                checked={notify}
                onChange={setNotify}
                label="Skicka inbjudan till deltagarna"
                upcoming={upcoming}
                help={resolved.audience ? "E-post eller SMS med tid, plats och Miljonbemannings telefonnummer – inga namn. De som tillkommer senare får också inbjudan." : undefined}
              />
            )
          )}
          {seriesError && <Notice tone="warn" title={seriesError} />}
          {problems.length > 0 && (
            <Notice tone="critical" title="Några deltagare kan inte bjudas in">
              <ProblemList problems={problems} />
            </Notice>
          )}
        </Stack>
      </Card>
      <Row>
        <Button kind="primary" icon="check" pending={pending} onClick={() => void submit()}>
          {label}
        </Button>
        <Button kind="ghost" to="/aktiviteter">
          Avbryt
        </Button>
      </Row>
    </Page>
  );
}
