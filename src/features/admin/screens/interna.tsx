"use client";
// Interna regler för Miljonbemanning (fliken på /admin/avtal?flik=interna): påminnelser och eskalering vid utebliven
// progression och kanaler för notiser. Inte avtalskrav – sparas i org_settings och slår igenom direkt i notiser och flaggor.
import { useState } from "react";
import { fmtDateTime as fmt } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { DemoOnly } from "@/shell/runtime";
import { Button, Card, Check, Field, FormGrid, Icon, Kpi, Notice, PerspectiveLink, QueryView, Row, Select, Split, Stack, toast } from "@/ui";
import { escWord, weeksWord } from "../audit-text";
import { adminOrgRules, adminSetOrgRule, type OrgRulesView, type RuleSnapshot } from "../api";
import { Details, Group, Pre, Small } from "./parts";

const CHANNEL_OPTS: [string, string][] = [["app", "I appen (notiser)"], ["email", "E-post utan personuppgifter"]];

export function InternalRules() {
  const q = useQuery(adminOrgRules, {});
  // Nyckeln nollställer formuläret när de sparade reglerna ändras.
  return <QueryView query={q}>{(d) => <RulesForm key={JSON.stringify(d.saved)} d={d} />}</QueryView>;
}

const norm = (r: RuleSnapshot) => JSON.stringify({ ...r, to: [...r.to].sort(), channels: [...r.channels].sort(), assign: [...r.assign].sort() });

function RulesForm({ d }: { d: OrgRulesView }) {
  const saved = d.saved;
  const [f, setF] = useState<RuleSnapshot>(saved);
  const save = useCommand(adminSetOrgRule);
  const toggle = (key: "to" | "channels" | "assign", v: string) => setF((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v] }));
  const errs: Partial<Record<"esc" | "to" | "channels" | "assign", string>> = {};
  if (!(f.esc > f.remind)) errs.esc = "Eskaleringen måste komma efter påminnelsen. Välj fler veckor.";
  if (!f.to.length) errs.to = "Välj minst en mottagare.";
  if (!f.channels.length) errs.channels = "Välj minst en kanal.";
  if (!f.assign.length) errs.assign = "Välj minst en kanal.";
  const dirty = norm(f) !== norm(saved);
  const count = (w: number) => d.streaks.filter((s) => s >= w).length;
  const toText = f.to.map(escWord).join(", ") || "ingen mottagare";
  const onSave = async () => {
    const r = await save.run({
      remindCoachAfterWeeks: f.remind, escalateAfterConsecutiveWeeks: f.esc, escalateTo: f.to as ("chef" | "avtalsansvarig" | "samordnare")[],
      channels: f.channels as ("app" | "email")[], assignmentChannels: f.assign as ("app" | "email")[],
    }).catch(() => null);
    if (!r || !r.ok) toast("Reglerna kunde inte sparas. Kontrollera fälten.", "error");
    else toast("Reglerna är sparade. Notiser och flaggor räknas om direkt.");
  };
  return (
    <Stack gap="lg">
      <Notice tone="info" title="Interna regler för Miljonbemanning – inte avtalskrav">
        Reglerna styr hur vi själva följer upp ärenden i alla avtal.
      </Notice>
      <Split wide>
        <Card
          title="Påminnelser och eskalering"
          icon="bell"
          foot={
            <>
              <Button kind="primary" icon="check" disabled={!dirty || Object.keys(errs).length > 0} pending={save.pending} onClick={() => void onSave()}>
                Spara reglerna
              </Button>
              {dirty ? (
                <Button kind="ghost" icon="reset" onClick={() => setF(saved)}>
                  Ångra ändringarna
                </Button>
              ) : (
                <span className="text-small text-text-muted">Inga osparade ändringar.</span>
              )}
            </>
          }
        >
          <Stack>
            <FormGrid>
              <Field id="rule-remind" label="Påminn coachen efter" help="Veckor utan progression: veckomålet är inte uppnått eller ingen mötesrapport är godkänd.">
                <Select value={String(f.remind)} onValueChange={(v) => setF((x) => ({ ...x, remind: Number(v) }))} options={[1, 2, 3, 4].map((w) => ({ value: String(w), label: weeksWord(w) }))} />
              </Field>
              <Field id="rule-esc" label="Eskalera efter" help="Veckor i rad utan progression innan ärendet eskaleras." error={errs.esc}>
                <Select value={String(f.esc)} onValueChange={(v) => setF((x) => ({ ...x, esc: Number(v) }))} options={[2, 3, 4, 5, 6].map((w) => ({ value: String(w), label: `${w} veckor i rad` }))} />
              </Field>
            </FormGrid>
            <Group id="rule-to" legend="Mottagare av eskaleringen" help="Varje notis har exakt en mottagare. Coachen kan inte väljas." error={errs.to}>
              {d.recipients.map((r) => (
                <Check key={r.role} id={`rule-to-${r.role}`} checked={f.to.includes(r.role)} onCheckedChange={() => toggle("to", r.role)}>
                  {r.label} {r.names && <span className="text-text-muted">({r.names})</span>}
                </Check>
              ))}
              <Check id="rule-to-coach" checked={false} disabled>
                Coach <span className="text-text-muted">– kan inte väljas</span>
              </Check>
            </Group>
            <Group id="rule-ch" legend="Kanaler för påminnelser och eskaleringar" help="E-posten innehåller bara ärendenumret och en uppmaning att logga in." error={errs.channels}>
              {CHANNEL_OPTS.map(([c, label]) => (
                <Check key={c} id={`rule-ch-${c}`} checked={f.channels.includes(c)} onCheckedChange={() => toggle("channels", c)}>
                  {label}
                </Check>
              ))}
            </Group>
            <Group id="rule-as" legend="Kanaler för notis vid tilldelning" help="Huvudcoach och team får notis när ett ärende tilldelas eller coach byts." error={errs.assign}>
              {CHANNEL_OPTS.map(([c, label]) => (
                <Check key={c} id={`rule-as-${c}`} checked={f.assign.includes(c)} onCheckedChange={() => toggle("assign", c)}>
                  {label}
                </Check>
              ))}
            </Group>
            <div className="flex flex-col gap-1.5">
              <span className="text-ui font-bold" id="rule-visible-label">
                Eskalering syns för coachen
              </span>
              <div role="note" aria-labelledby="rule-visible-label" className="flex min-h-11 items-center gap-1.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-ljusgra-ton px-3 py-2">
                <Icon name="lock" />
                <b>Nej</b>
                <span className="text-text-muted">– låst</span>
              </div>
              <div className="text-small leading-[1.45] text-text-muted">
                Styrs av behörigheten, inte av en inställning. En eskalering kan bara läsas av sina mottagare – aldrig av coachen. Coachen ser sina egna påminnelser.
              </div>
            </div>
          </Stack>
        </Card>
        <Stack>
          <Card title="Så slår reglerna igenom just nu" icon="activity">
            <Stack>
              <Stack gap="sm" className="gap-3">
                <Kpi label="Påminnelser till coacher" value={count(f.remind)} sub={`ärenden med minst ${weeksWord(f.remind)} utan progression`} />
                <Kpi
                  label="Eskaleringar"
                  value={f.esc > f.remind ? count(f.esc) : "–"}
                  sub={`till ${toText} – syns inte för coachen`}
                  tone={f.esc > f.remind && count(f.esc) > 0 ? "watch" : null}
                />
              </Stack>
              {dirty && (
                <Small>
                  Med de sparade reglerna: {count(saved.remind)} påminnelser och {count(saved.esc)} eskaleringar.
                </Small>
              )}
              <Small>Påminnelsen skickas {d.reminderSchedule}. Ändringen slår igenom direkt i notiser och flaggor.</Small>
              <DemoOnly>
                <Row gap="sm">
                  <PerspectiveLink role="coach" to="/notiser" label="Se coachens notiser" />
                  <PerspectiveLink role="chef" to="/notiser" label="Se chefens notiser" />
                </Row>
              </DemoOnly>
            </Stack>
          </Card>
          <Card title="Ändringshistorik" icon="book">
            {d.history.length === 0 ? (
              <p className="text-text-muted">Inga ändringar sedan avtalsstart. Varje ändring loggas i revisionsloggen.</p>
            ) : (
              <Stack gap="sm">
                {d.history.map((a) => (
                  <div key={a.id} className="flex flex-col gap-0.5 border-b border-ljusgra pb-2">
                    <div className="text-small text-text-muted">
                      {fmt(a.at)} · {a.actorName}
                      {a.byTester && <DemoOnly> · gjort av dig i prototypen</DemoOnly>}
                    </div>
                    <div>{a.text}</div>
                  </div>
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      </Split>
      <Details summary="JSON (org_settings.notifications)">
        <Pre text={JSON.stringify(d.notifications, null, 2)} />
      </Details>
    </Stack>
  );
}

