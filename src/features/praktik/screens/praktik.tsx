"use client";
// Arbetsgivare och praktik (/praktik/:employerId?, prototypens praktik.arbetsgivare): det gemensamma arbetsgivarregistret
// och praktikplatserna med de fyra rätten (SPEC §7.9, byggs i fas 3). Deltagarnas namn visas bara för ärenden man har åtkomst till.
import { useState } from "react";
import { fmtDate, fmtDateShort, fmtWeekday } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly } from "@/shell/runtime";
import {
  Badge, BuildPhase, Button, Card, CaseLink, CellSub, Check, DateInput, DemoNote, Empty, Field, FormGrid, Grid, Icon, Input, Kpi, List, ListItem, Modal, Notice, Page,
  PerspectiveLink, QueryView, Row, Section, Seg, Select, Stack, Table, cn, toast,
} from "@/ui";
import { emailValid } from "@/core/validation";
import { Group, KV } from "@/features/admin/screens/parts";
import {
  praktikAddFollowUp, praktikEmployer, praktikEmployerAdd, praktikList, praktikSetRight, RIGHT_KEYS,
  type EmployerDetailView, type EmployerListView, type PlacementCardView, type PlacementGroup,
} from "../api";

const RIGHTS: [(typeof RIGHT_KEYS)[number], string, string][] = [
  ["uppgift", "Rätt arbetsuppgift", "Arbetsuppgifterna är kopplade till yrkesspåret."],
  ["handledning", "Rätt handledning", "Handledare hos arbetsgivaren, mål och ansvar är bestämda."],
  ["timing", "Rätt tidpunkt", "Coachen har bedömt att deltagaren är redo: krav, tempo och rutiner."],
  ["uppfoljning", "Rätt uppföljning", "Uppföljningsdatum är planerade. Återkopplingen dokumenteras och leder till nästa steg."],
];
const RightsBadge = ({ n }: { n: number }) => (
  <Badge tone={n === 4 ? "blue" : "outline"} icon={n === 4 ? "check" : "alert-circle"}>
    {n} av 4 rätt
  </Badge>
);
const Eyebrow = ({ children }: { children: string }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    {children} <BuildPhase fas={3} />
  </span>
);

export function PraktikScreen({ params }: ScreenProps) {
  return params.employerId ? <EmployerDetail id={params.employerId} /> : <EmployerList />;
}

// ================================================================ Registret
function EmployerList() {
  const q = useQuery(praktikList, {});
  const [adding, setAdding] = useState(false);
  return (
    <Page
      title="Arbetsgivare och praktik"
      eyebrow={<Eyebrow>Gemensamt register för alla coacher</Eyebrow>}
      lead="Arbetsgivare som tar emot praktikanter och de fyra rätten för varje praktikplats. Deltagarnas namn visas bara för ärenden du har åtkomst till."
      actions={
        <>
          {q.data?.demoCaseId && (
            <DemoOnly>
              <PerspectiveLink role="kommun_handlaggare" to={`/portal/deltagare/${q.data.demoCaseId}`} label="Se praktiken från kundens håll" />
            </DemoOnly>
          )}
          <Button kind="primary" icon="plus" onClick={() => setAdding(true)}>
            Lägg till arbetsgivare
          </Button>
        </>
      }
    >
      <QueryView query={q}>{(d) => <ListContent d={d} />}</QueryView>
      {adding && q.data && <AddEmployer areas={q.data.areas} onClose={() => setAdding(false)} />}
    </Page>
  );
}

function ListContent({ d }: { d: EmployerListView }) {
  const nav = useNav();
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const rows = d.employers.filter(
    (e) => (!search.trim() || `${e.name} ${e.contactName}`.toLowerCase().includes(search.trim().toLowerCase())) && (!area || e.areas.some((a) => a.code === area)),
  );
  return (
    <>
      <Grid cols={4}>
        <Kpi label="Arbetsgivare" value={d.kpis.employers} sub="i registret" />
        <Kpi label="Pågående praktik" value={d.kpis.ongoing} sub={`${d.kpis.total} praktikplatser totalt`} />
        <Kpi label="Uppföljningar" value={d.kpis.upcoming} sub={d.mineOnly ? "i dina ärenden de närmaste 7 dagarna" : "de närmaste 7 dagarna"} />
        <Kpi label="Alla fyra rätt" value={`${d.kpis.full} av ${d.kpis.ongoing}`} sub="pågående praktikplatser" tone={d.kpis.full < d.kpis.ongoing ? "watch" : null} />
      </Grid>
      {d.upcoming.length > 0 && (
        <Card title={d.mineOnly ? "Dina uppföljningar de närmaste 7 dagarna" : "Uppföljningar de närmaste 7 dagarna"} icon="calendar" flush>
          <List>
            {d.upcoming.map((u) => (
              <ListItem
                key={u.key}
                icon="calendar"
                title={`${fmtWeekday(u.date)} · ${u.employerName}`}
                sub={u.who}
                side={<RightsBadge n={u.rightsDone} />}
                onClick={() => nav.push(`/praktik/${u.employerId}`)}
              />
            ))}
          </List>
        </Card>
      )}
      <Row className="items-end">
        <div className="flex-[1_1_260px]">
          <Field id="emp-q" label="Sök arbetsgivare">
            <Input type="search" value={search} onValueChange={setSearch} placeholder="Företag eller kontaktperson" />
          </Field>
        </div>
        <div className="flex-[1_1_220px]">
          <Field id="emp-area" label="Avtalsområde">
            <Select value={area} onValueChange={setArea} placeholder="Alla områden" options={d.areas.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))} />
          </Field>
        </div>
      </Row>
      <Card title={`Arbetsgivare (${rows.length})`} icon="building" flush>
        <Table
          caption="Arbetsgivarregister"
          rows={rows}
          empty="Inga arbetsgivare matchar sökningen."
          onRowClick={(r) => nav.push(`/praktik/${r.id}`)}
          columns={[
            { key: "name", label: "Företag", render: (r) => (<><span className="font-bold">{r.name}</span><CellSub>{r.orgNr || "Organisationsnummer saknas"}</CellSub></>) },
            { key: "contact", label: "Kontaktperson", render: (r) => (<>{r.contactName || "–"}{r.phone && <CellSub>{r.phone}</CellSub>}</>) },
            {
              key: "areas", label: "Avtalsområden",
              render: (r) => (
                <Row gap="sm">
                  {r.areas.map((a) => (
                    <Badge key={a.code} tone="outline" title={`${a.code} ${a.name}`}>{a.code}</Badge>
                  ))}
                </Row>
              ),
            },
            { key: "pl", label: "Praktik", nowrap: true, render: (r) => (<><span className="font-bold">{r.ongoing} pågående</span><CellSub>{r.total} totalt</CellSub></>) },
            { key: "next", label: "Nästa uppföljning", nowrap: true, render: (r) => (r.next ? fmtDate(r.next) : "–") },
            { key: "go", label: "", render: () => <Icon name="chevron-right" label="Öppna" /> },
          ]}
        />
      </Card>
      <DemoNote>Arbetsgivarregistret och praktikplatserna med de fyra rätten byggs i utvecklingsfas 3. Arbetsgivarkontakter räknas redan i fas 1 i statistiken och i veckoavstämningen.</DemoNote>
    </>
  );
}

function AddEmployer({ areas, onClose }: { areas: EmployerListView["areas"]; onClose: () => void }) {
  const nav = useNav();
  const add = useCommand(praktikEmployerAdd);
  const [f, setF] = useState({ name: "", orgNr: "", contactName: "", phone: "", email: "", areas: [] as string[] });
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const set = (k: "name" | "orgNr" | "contactName" | "phone" | "email") => (v: string) => {
    setServerErr(null);
    setF((x) => ({ ...x, [k]: v }));
  };
  const errs: Partial<Record<"name" | "orgNr" | "email" | "areas", string>> = {};
  if (!f.name.trim()) errs.name = "Skriv företagets namn.";
  if (f.orgNr.trim() && !/^\d{6}-\d{4}$/.test(f.orgNr.trim())) errs.orgNr = "Skriv organisationsnumret med bindestreck, till exempel 556123-4567.";
  if (f.email.trim() && !emailValid(f.email.trim())) errs.email = "E-postadressen ser inte ut att stämma.";
  if (!f.areas.length) errs.areas = "Välj minst ett avtalsområde.";
  const show = (k: keyof typeof errs) => (tried ? errs[k] : undefined);
  const submit = async () => {
    setTried(true);
    if (Object.keys(errs).length) return;
    const r = await add.run(f).catch(() => null);
    if (!r || !r.ok) {
      setServerErr(r && !r.ok && r.error === "duplicate" ? "Arbetsgivaren finns redan i registret (samma namn eller organisationsnummer)." : "Arbetsgivaren kunde inte sparas. Kontrollera fälten.");
      return;
    }
    toast(`${f.name.trim()} är tillagd i arbetsgivarregistret.`);
    onClose();
    nav.push(`/praktik/${r.employerId}`);
  };
  return (
    <Modal
      title="Lägg till arbetsgivare"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>Avbryt</Button>
          <Button kind="primary" icon="plus" pending={add.pending} onClick={() => void submit()}>Lägg till</Button>
        </>
      }
    >
      <Stack>
        <p className="text-text-muted">Registret delas av alla coacher, handledare och arbetsgivarmatchare. Skriv inga uppgifter om deltagare här.</p>
        {serverErr && <Notice tone="critical">{serverErr}</Notice>}
        <FormGrid>
          <Field id="emp-name" label="Företag" required help="Företagets namn som det står i avtal och på fakturor." error={show("name")}>
            <Input value={f.name} onValueChange={set("name")} />
          </Field>
          <Field id="emp-org" label="Organisationsnummer" help="Tio siffror med bindestreck." error={show("orgNr")}>
            <Input value={f.orgNr} onValueChange={set("orgNr")} inputMode="numeric" maxLength={11} placeholder="556123-4567" />
          </Field>
          <Field id="emp-contact" label="Kontaktperson" help="Den som tar emot praktikanter, ofta handledaren.">
            <Input value={f.contactName} onValueChange={set("contactName")} />
          </Field>
          <Field id="emp-phone" label="Telefon" help="Kontaktpersonens telefon i arbetet.">
            <Input type="tel" value={f.phone} onValueChange={set("phone")} />
          </Field>
          <Field id="emp-email" label="E-post" help="Kontaktpersonens e-post i arbetet." error={show("email")} full>
            <Input type="email" value={f.email} onValueChange={set("email")} />
          </Field>
        </FormGrid>
        <Group id="emp-areas" legend="Avtalsområden" help="Vilka yrkesområden arbetsgivaren kan ta emot praktikanter inom." error={show("areas")}>
          <div className="grid grid-cols-2 gap-x-4 max-[620px]:grid-cols-1">
            {areas.map((a) => (
              <Check
                key={a.code}
                id={`emp-area-${a.code}`}
                checked={f.areas.includes(a.code)}
                onCheckedChange={(v) => setF((x) => ({ ...x, areas: v ? [...x.areas, a.code] : x.areas.filter((y) => y !== a.code) }))}
              >
                {a.code} {a.name}
              </Check>
            ))}
          </div>
        </Group>
      </Stack>
    </Modal>
  );
}

// ================================================================ En arbetsgivare
function EmployerDetail({ id }: { id: string }) {
  const q = useQuery(praktikEmployer, { employerId: id });
  if (q.data && !q.data.found) {
    return (
      <Page title="Arbetsgivaren finns inte" crumbs={[{ label: "Arbetsgivare och praktik", to: "/praktik" }]}>
        <Empty icon="building" title="Arbetsgivaren finns inte i registret" action={<Button icon="arrow-left" to="/praktik">Till registret</Button>} />
      </Page>
    );
  }
  const name = q.data?.found ? q.data.employer.name : "Arbetsgivare";
  return (
    <Page title={name} eyebrow={<Eyebrow>Arbetsgivare</Eyebrow>} crumbs={[{ label: "Arbetsgivare och praktik", to: "/praktik" }, { label: name }]}>
      <QueryView query={q}>{(d) => (d.found ? <DetailContent d={d} /> : null)}</QueryView>
    </Page>
  );
}

type Found = Extract<EmployerDetailView, { found: true }>;
function DetailContent({ d }: { d: Found }) {
  const [show, setShow] = useState<"ongoing" | "done">("ongoing");
  const [limit, setLimit] = useState(6);
  const e = d.employer;
  const group: PlacementGroup = show === "ongoing" ? d.ongoing : d.done;
  const count = show === "ongoing" ? d.ongoingCount : d.doneCount;
  return (
    <>
      <Card title="Kontaktuppgifter" icon="building">
        <div className="grid grid-cols-2 gap-x-8 max-[620px]:grid-cols-1">
          <KV items={[["Organisationsnummer", e.orgNr || "–"], ["Kontaktperson", e.contactName || "–"], ["Telefon", e.phone || "–"], ["E-post", e.email || "–"]]} />
          <KV
            items={[
              ["Avtalsområden", <Row key="v" gap="sm">{e.areas.map((a) => (<Badge key={a.code} tone="outline">{a.code} {a.name}</Badge>))}</Row>],
              ["Praktikplatser", `${d.ongoingCount} pågående, ${d.ongoingCount + d.doneCount} totalt`],
              !!e.createdAt && ["Tillagd", `${fmtDate(e.createdAt)} av ${e.createdByName ?? "–"}`],
            ]}
          />
        </div>
      </Card>
      <Row between>
        <Seg
          ariaLabel="Visa praktikplatser"
          value={show}
          onValueChange={(v) => { setShow(v); setLimit(6); }}
          options={[{ value: "ongoing", label: `Pågående (${d.ongoingCount})` }, { value: "done", label: `Avslutade (${d.doneCount})` }]}
        />
        <span className="text-small text-text-muted">Ofullständiga fyra rätt visas först.</span>
      </Row>
      {count === 0 && (
        <Card>
          <Empty icon="briefcase" title={show === "ongoing" ? "Ingen pågående praktik" : "Inga avslutade praktikplatser"}>
            Praktikplatser läggs till från deltagarens ärende.
          </Empty>
        </Card>
      )}
      {group.mine.length > 0 && (
        <Section title={`${d.scopeLabel} (${group.mine.length})`}>
          <Stack>
            {group.mine.slice(0, limit).map((p) => (
              <PlacementCard key={p.id} pl={p} today={d.today} />
            ))}
            {group.mine.length > limit && (
              <div>
                <Button kind="secondary" icon="chevron-down" onClick={() => setLimit(limit + 6)}>
                  Visa fler ({group.mine.length - limit} till)
                </Button>
              </div>
            )}
          </Stack>
        </Section>
      )}
      {group.others.length > 0 && (
        <Section title={`Praktikplatser i andra team (${group.others.length})`}>
          <Card flush foot={<span className="text-small text-text-muted">Deltagarnas namn och ärendenummer visas bara för teamet i ärendet.</span>}>
            <Table
              caption="Praktikplatser i andra team"
              rows={group.others}
              columns={[
                { key: "who", label: "Deltagare", render: (p) => (<span className="flex flex-nowrap items-start gap-1.5"><Icon name="lock" className="mt-0.5" /><span>{p.who}</span></span>) },
                { key: "period", label: "Period", nowrap: true, render: (p) => `${fmtDateShort(p.startsOn)} – ${fmtDate(p.endsOn)}` },
                { key: "fr", label: "Fyra rätt", render: (p) => <RightsBadge n={p.rightsDone} /> },
              ]}
            />
          </Card>
        </Section>
      )}
    </>
  );
}

function PlacementCard({ pl, today }: { pl: PlacementCardView; today: string }) {
  const setRight = useCommand(praktikSetRight);
  const addFollowUp = useCommand(praktikAddFollowUp);
  const [date, setDate] = useState("");
  const upcoming = pl.followUpDates.filter((x) => x >= today);
  const onRight = async (right: (typeof RIGHT_KEYS)[number], value: boolean) => {
    const r = await setRight.run({ placementId: pl.id, right, value }).catch(() => null);
    if (!r || !r.ok) toast("Ändringen kunde inte sparas.", "error");
  };
  const onAdd = async () => {
    const r = await addFollowUp.run({ placementId: pl.id, date }).catch(() => null);
    if (r && r.ok) {
      toast(`Uppföljning ${fmtDate(date)} är planerad.`);
      setDate("");
    } else toast("Uppföljningen kunde inte sparas. Välj ett datum.", "error");
  };
  return (
    <Card
      title={pl.who}
      icon="user"
      tone={pl.status === "ongoing" && pl.rightsDone < 4 ? "red" : undefined}
      actions={
        <>
          <RightsBadge n={pl.rightsDone} />
          {pl.status === "ongoing" ? <Badge tone="blue" icon="activity">Pågår</Badge> : <Badge tone="grey" icon="check-square">Avslutad</Badge>}
        </>
      }
      foot={
        pl.referrerId ? (
          <DemoOnly>
            <PerspectiveLink role="kommun_handlaggare" userId={pl.referrerId} to={`/portal/deltagare/${pl.caseId}`} label="Se från kundens håll" />
          </DemoOnly>
        ) : undefined
      }
    >
      <Stack>
        <Row gap="sm" className="text-small text-text-muted">
          <CaseLink caseId={pl.caseId} caseNumber={pl.caseNumber} />
          <span aria-hidden="true">·</span>
          <span>
            {fmtDate(pl.startsOn)} – {fmtDate(pl.endsOn)}
          </span>
          <span aria-hidden="true">·</span>
          <span>Handledare {pl.supervisorName || "–"}</span>
        </Row>
        <KV items={[["Arbetsuppgifter", pl.tasks], ["Mål", pl.goals || "–"]]} />
        <Group id={`fr-${pl.id}`} legend={`De fyra rätten – ${pl.rightsDone} av 4 uppfyllda`} help={pl.canEdit ? "Bocka i när kravet är uppfyllt. Ändringen loggas." : "Bara teamet i ärendet kan ändra."}>
          <div className="grid grid-cols-2 gap-x-5 max-[620px]:grid-cols-1">
            {RIGHTS.map(([k, label, help]) => (
              <Check key={k} id={`fr-${pl.id}-${k}`} checked={!!pl.fourRights[k]} disabled={!pl.canEdit} onCheckedChange={(v) => void onRight(k, v)}>
                <span>
                  <span className="font-bold">{label}</span>
                  <br />
                  <span className="text-small text-text-muted">{help}</span>
                </span>
              </Check>
            ))}
          </div>
        </Group>
        <Stack gap="sm">
          <Row gap="sm">
            <span className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Uppföljning</span>
            {pl.followUpDates.length === 0 ? (
              <span className="text-small text-text-muted">Inga datum planerade</span>
            ) : (
              pl.followUpDates.map((x) => (
                <Badge key={x} tone={x < today ? "grey" : x === today ? "dark" : "outline"} icon={x < today ? "check" : "calendar"}>
                  {fmtDate(x)} · {x < today ? "passerad" : x === today ? "i dag" : "planerad"}
                </Badge>
              ))
            )}
          </Row>
          {pl.status === "ongoing" && upcoming.length === 0 && (
            <p className="inline-flex items-start gap-1.5 text-small font-bold">
              <Icon name="alert-circle" className="mt-0.5 text-rod" /> Ingen kommande uppföljning är planerad.
            </p>
          )}
          {pl.canEdit && pl.status === "ongoing" && (
            <Row className={cn("items-end")}>
              <div className="flex-[0_1_220px]">
                <Field id={`fu-${pl.id}`} label="Nytt uppföljningsdatum">
                  <DateInput value={date} onValueChange={setDate} />
                </Field>
              </div>
              <Button kind="secondary" icon="plus" disabled={!date} pending={addFollowUp.pending} onClick={() => void onAdd()}>
                Lägg till uppföljning
              </Button>
            </Row>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
