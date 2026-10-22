"use client";
// Grupper och nivåer (/grupper) – Karims beslut 2026-10-22: "Grupperna ändras om till yrkesområdena", "Grupperna (yrkesområdena)
// bjuds in till större gruppaktiviteter en gång i månaden", "Nivå aktiviteterna sker 1-3 gånger i veckan" och "Fem nivåer,
// deltagare är i exakt en nivå åt gången". Avsnitten:
//   Yrkesområden          varje yrkesområde (avtalsområdena A–L): antal aktiva deltagare och den här och nästa månadens
//                         yrkesområdesträff – eller "Ingen träff planerad i <månad>" med Planera (Ny aktivitet med yrkesområdet)
//   Nivåer                de fem nivåerna: antal, deltagarna (länk till kortet, Höj nivå och Byt nivå) och nivåns återkommande
//                         aktiviteter; Byt namn för den som får ändra
//   Utan nivå             pågående och bekräftade insatser utan nivå – länk till kartläggningen
//   Taggar                som förut: byta namn, arkivera, återställa, nytt värde och ny kategori
// Bara Miljonbemanning – aldrig kommunen eller ekonomen (rutten och frågan). Inget raderas. Allt är internt.
import { useState } from "react";
import { plural } from "@/core/format";
import { addWorkingDays, dayOf, fmtDateTimeLong, monthName, nthWorkingDay, type MonthKey } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import type { ScreenProps } from "@/shell/routes";
import { Link } from "@/shell/nav";
import { useQueryPatch } from "@/shell/url-state";
import {
  Badge, Button, Card, CaseLink, CaseStatusBadge, Empty, ErrorNotice, Field, Input, Loading, Modal, ModalCancelButton, Notice, Page, Row, Select, Seg, Stack, TextArea, toast,
} from "@/ui";
import {
  caseLevelRaise, caseLevelSet, groupingArchive, groupingCreate, groupingDefaults, groupingOverview, groupingRename, type GroupingOption, type GroupingOverview, type OverviewMember,
} from "../api";
import { levelChangeText } from "./grouping-card";

const NAME_HELP = "Använd neutrala ord, till exempel ”Körkort”. Aldrig omdömen om personer.";
const TITLE = "Grupper och nivåer";

export function GrupperScreen({ query }: ScreenProps) {
  // Varje avtal har sina egna nivåer, yrkesområden och taggar – ?avtal= (id) väljer bland aktörens avtal, annars det första.
  const q = useQuery(groupingOverview, { contractId: query.get("avtal") ?? undefined }, { keepPrevious: true });
  if (q.error) return <Page title={TITLE}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (q.data === undefined) return <Page title={TITLE}><Loading /></Page>;
  if (q.data === null) {
    return (
      <Page title={TITLE}>
        <Card>
          <Empty icon="layers" title="Inget aktivt avtal">Yrkesområden och nivåer finns per avtal.</Empty>
        </Card>
      </Page>
    );
  }
  return <Overview v={q.data} />;
}

type Dialog = { mode: "rename"; g: GroupingOption } | { mode: "new-tag"; category: string | null } | { mode: "level"; member: OverviewMember; levelId: string };

/** Planera: en dag i månaden att börja med i Ny aktivitet (i morgon i den här månaden, annars tionde arbetsdagen). */
function planDay(month: MonthKey, today: string): string {
  const tomorrow = addWorkingDays(today, 1);
  if (dayOf(tomorrow).slice(0, 7) === month) return tomorrow;
  return nthWorkingDay(month, 10);
}

function Overview({ v }: { v: GroupingOverview }) {
  const patch = useQueryPatch();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const raise = useCommand(caseLevelRaise);
  const archive = useCommand(groupingArchive);
  const defaults = useCommand(groupingDefaults);
  const [busy, setBusy] = useState<string | null>(null);

  const doRaise = async (m: OverviewMember, fromLevelId: string) => {
    if (busy) return;
    setBusy(m.caseId);
    const res = await raise.run({ caseId: m.caseId, fromLevelId }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Nivån kunde inte höjas.", "error");
      return;
    }
    toast(`${m.name} är nu på ${res.levelName}. ${levelChangeText(res)}`.trim());
  };
  const toggleArchive = async (g: GroupingOption) => {
    const res = await archive.run({ id: g.id, archived: !g.archived }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Det gick inte att ändra.", "error");
      return;
    }
    toast(g.archived ? `${g.name} är återställd.` : `${g.name} är arkiverad. Den kan inte väljas för fler deltagare.`);
  };

  return (
    <Page
      title={TITLE}
      lead="Grupperna är yrkesområdena. Varje deltagare har en nivå. Allt här är Miljonbemannings eget arbetsverktyg – kommunen ser det aldrig, och det kommer aldrig med i rapporter eller underlaget till AI."
      actions={<Button kind="ghost" icon="edit" to="/anteckningar">Anteckningar</Button>}
    >
      {v.contracts.length > 1 && (
        <Card>
          <Field label="Avtal" id="gr-avtal" help="Varje avtal har sina egna nivåer, yrkesområden och taggar.">
            <Select value={v.contractId} onValueChange={(x) => patch({ avtal: x || null })} options={v.contracts.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
        </Card>
      )}
      {v.missingDefaults && v.canEdit && (
        <Notice tone="warn" title="Avtalet saknar nivåerna">
          <Row gap="sm">
            <span>Lägg in de fem nivåerna och taggen Vill arbeta.</span>
            <Button
              kind="secondary"
              pending={defaults.pending}
              onClick={() => void defaults.run({ contractId: v.contractId }).then((r) => r.ok && toast(`${r.added} värden är tillagda.`)).catch(() => toast("Det gick inte att lägga in nivåerna.", "error"))}
            >
              Lägg in nivåerna
            </Button>
          </Row>
        </Notice>
      )}

      <Card title="Yrkesområden" icon="users" id="gr-omraden">
        <p className="mb-2 text-body text-text-muted">
          Deltagarens grupp är yrkesområdet i beställningen. En gång i månaden träffas varje yrkesområde. De som tillkommer bjuds in automatiskt fram till träffen.
        </p>
        <ul className="flex flex-col" aria-label="Yrkesområden">
          {v.areas.map((a) => (
            <li key={a.code} className="flex flex-col gap-1.5 border-b border-ljusgra py-3 last:border-b-0" data-testid="yrkesomrade">
              <Row between>
                <span className="font-bold">{a.name}</span>
                <span className="text-body text-text-muted">{plural(a.active, "aktiv deltagare", "aktiva deltagare")}</span>
              </Row>
              {a.meetings.map((m) => (
                <div key={m.month} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {m.items.length ? (
                    m.items.map((g) => (
                      <Link key={g.id} to={`/aktiviteter/${encodeURIComponent(g.id)}`} className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-3">
                        <Badge tone="blue" icon="calendar">Träff</Badge>
                        {g.name} – {fmtDateTimeLong(g.startsAt)}
                      </Link>
                    ))
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1.5 text-body">
                        <Badge tone="outline" icon="circle">Ingen träff</Badge>
                        Ingen träff planerad i {monthName(m.month)}
                      </span>
                      {v.canPlan && (
                        <Button kind="ghost" icon="plus" to={`/aktiviteter/ny?omrade=${encodeURIComponent(a.code)}&datum=${planDay(m.month, v.today)}`}>
                          Planera<span className="sr-only"> en träff för {a.name} i {monthName(m.month)}</span>
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Nivåer" icon="layers" id="gr-nivaer">
        <p className="mb-2 text-body text-text-muted">
          Fem nivåer: hur nära arbete deltagaren är. Varje deltagare är på exakt en nivå. Nivån väljs i kartläggningen och kan höjas när deltagaren utvecklas. Nivåaktiviteterna återkommer varje vecka och bjuder in nivåns deltagare automatiskt.
        </p>
        <Stack>
          {v.levels.map((l) => (
            <section key={l.id} aria-labelledby={`gr-niva-${l.id}`} className="flex flex-col gap-2 rounded-mb border border-ljusgra p-3" data-testid="niva">
              <Row between>
                <h3 id={`gr-niva-${l.id}`} className="m-0 text-ui font-bold">
                  {l.name}
                </h3>
                <Row gap="sm">
                  <span className="text-body text-text-muted">{plural(l.people.length, "deltagare", "deltagare")}</span>
                  {v.canEdit && (
                    <Button kind="ghost" icon="edit" onClick={() => setDialog({ mode: "rename", g: l })}>
                      Byt namn<span className="sr-only"> på {l.name}</span>
                    </Button>
                  )}
                </Row>
              </Row>
              {l.description && <p className="m-0 text-small text-text-muted">{l.description}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-bold">Återkommande aktiviteter:</span>
                {l.series.length ? (
                  l.series.map((x) => (
                    <Link key={x.id} to={x.nextId ? `/aktiviteter/${encodeURIComponent(x.nextId)}` : "/aktiviteter"} className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-3">
                      <Badge tone="outline" icon="refresh">Varje vecka</Badge>
                      {x.name} – {x.schedule}
                    </Link>
                  ))
                ) : (
                  <span className="text-body text-text-muted">Inga ännu.</span>
                )}
                {v.canPlan && (
                  <Button kind="ghost" icon="plus" to={`/aktiviteter/ny?niva=${encodeURIComponent(l.id)}&upprepa=1`}>
                    Ny nivåaktivitet<span className="sr-only"> för {l.name}</span>
                  </Button>
                )}
              </div>
              {l.people.length ? (
                <ul className="m-0 flex list-none flex-col p-0" aria-label={`Deltagare på ${l.name}`}>
                  {l.people.map((m) => (
                    <li key={m.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ljusgra py-1.5">
                      <CaseLink caseId={m.caseId} caseNumber={m.caseNumber} className="-ml-1.5">
                        {m.name}
                      </CaseLink>
                      <span className="text-small tabular-nums text-text-muted">{m.caseNumber}</span>
                      <CaseStatusBadge status={m.status} />
                      {v.canPlace && (
                        <span className="ml-auto flex flex-wrap gap-1">
                          {l.nextLevel && (
                            <Button kind="ghost" icon="trending-up" pending={busy === m.caseId} onClick={() => void doRaise(m, l.id)}>
                              Höj nivå<span className="sr-only"> för {m.name} till {l.nextLevel.name}</span>
                            </Button>
                          )}
                          <Button kind="ghost" icon="layers" onClick={() => setDialog({ mode: "level", member: m, levelId: l.id })}>
                            Byt nivå<span className="sr-only"> för {m.name}</span>
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-body text-text-muted">Ingen deltagare på nivån just nu.</p>
              )}
            </section>
          ))}
        </Stack>
      </Card>

      <Card title="Utan nivå – att kartlägga" icon="clipboard" id="gr-utan-niva">
        <p className="mb-2 text-body text-text-muted">Insatser som pågår eller väntar på start och saknar nivå. Nivån väljs i kartläggningen innan den godkänns.</p>
        {v.unplaced.length ? (
          <ul className="m-0 flex list-none flex-col p-0" aria-label="Deltagare utan nivå">
            {v.unplaced.map((m) => (
              <li key={m.caseId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ljusgra py-1.5 last:border-b-0" data-testid="utan-niva">
                <CaseLink caseId={m.caseId} caseNumber={m.caseNumber} className="-ml-1.5">
                  {m.name}
                </CaseLink>
                <span className="text-small tabular-nums text-text-muted">{m.caseNumber}</span>
                <CaseStatusBadge status={m.status} />
                <Badge tone="outline" icon={m.intake === "draft" ? "edit" : "circle"}>
                  {m.intake === "draft" ? "Kartläggning pågår" : m.intake === "approved" ? "Kartläggningen är godkänd" : "Inte kartlagd"}
                </Badge>
                <Button kind="ghost" icon="arrow-right" to={`/kartlaggning/${encodeURIComponent(m.caseId)}`} className="ml-auto">
                  Öppna kartläggningen<span className="sr-only"> för {m.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-body text-text-muted">Alla pågående insatser har en nivå.</p>
        )}
      </Card>

      {v.tags.map((t) => (
        <Card
          key={t.category}
          title={`Tagg: ${t.category}`}
          icon="hash"
          actions={v.canEdit && <Button kind="secondary" icon="plus" onClick={() => setDialog({ mode: "new-tag", category: t.category })}>Nytt värde</Button>}
        >
          <p className="mb-2 text-small text-text-muted">En deltagare har högst ett värde i kategorin.</p>
          <ul className="flex flex-col" aria-label={`Värden i ${t.category}`}>
            {t.values.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ljusgra py-2.5 last:border-b-0">
                <Stack gap="sm" className="min-w-[min(100%,240px)] flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-bold">
                    {g.name}
                    {g.archived && <Badge tone="outline" icon="minus-circle">Arkiverad</Badge>}
                  </span>
                  {g.description && <span className="text-small text-text-muted">{g.description}</span>}
                </Stack>
                <span className="text-small text-text-muted">{plural(g.members, "deltagare", "deltagare")}</span>
                {v.canEdit && (
                  <Row gap="sm">
                    <Button kind="ghost" icon="edit" onClick={() => setDialog({ mode: "rename", g })}>
                      Byt namn<span className="sr-only"> på {g.name}</span>
                    </Button>
                    <Button kind="ghost" icon={g.archived ? "refresh" : "minus-circle"} pending={archive.pending} onClick={() => void toggleArchive(g)}>
                      {g.archived ? "Återställ" : "Arkivera"}
                      <span className="sr-only"> {g.name}</span>
                    </Button>
                  </Row>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {v.canEdit && (
        <div>
          <Button kind="ghost" icon="plus" onClick={() => setDialog({ mode: "new-tag", category: null })}>
            Ny taggkategori
          </Button>
        </div>
      )}
      {dialog?.mode === "level" && (
        <ChangeLevelDialog member={dialog.member} fromLevelId={dialog.levelId} levels={v.levels.map((l) => ({ id: l.id, name: l.name }))} onClose={() => setDialog(null)} />
      )}
      {dialog && dialog.mode !== "level" && <GroupingDialog dialog={dialog} contractId={v.contractId} onClose={() => setDialog(null)} />}
    </Page>
  );
}

/** Byt nivå för en deltagare: välj vilken som helst av de fem. */
function ChangeLevelDialog({ member, fromLevelId, levels, onClose }: { member: OverviewMember; fromLevelId: string; levels: { id: string; name: string }[]; onClose: () => void }) {
  const set = useCommand(caseLevelSet);
  const [levelId, setLevelId] = useState(fromLevelId);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (levelId === fromLevelId) {
      onClose();
      return;
    }
    const res = await set.run({ caseId: member.caseId, levelId, fromLevelId }).catch(() => null);
    if (!res || !res.ok) {
      setError(res && !res.ok && res.message ? res.message : "Nivån kunde inte bytas.");
      return;
    }
    toast(`${member.name} är nu på ${res.levelName}. ${levelChangeText(res)}`.trim());
    onClose();
  };
  return (
    <Modal
      title={`Byt nivå för ${member.name}`}
      onClose={onClose}
      dirty={levelId !== fromLevelId}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={set.pending} onClick={() => void submit()}>
            Spara
          </Button>
        </>
      }
    >
      <Stack>
        {error && <Notice tone="warn" title={error} />}
        <Field label="Nivå" id="gr-byt-niva" help="Deltagaren bjuds in till den nya nivåns kommande aktiviteter och tas bort ur den gamlas.">
          <Seg id="gr-byt-niva" ariaLabel="Nivå" value={levelId} onValueChange={(x) => x && setLevelId(x)} options={levels.map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
      </Stack>
    </Modal>
  );
}

function GroupingDialog({ dialog, contractId, onClose }: { dialog: Exclude<Dialog, { mode: "level" }>; contractId: string; onClose: () => void }) {
  const create = useCommand(groupingCreate);
  const rename = useCommand(groupingRename);
  const start = dialog.mode === "rename" ? dialog.g : null;
  const [name, setName] = useState(start?.name ?? "");
  const [description, setDescription] = useState(start?.description ?? "");
  const [category, setCategory] = useState(dialog.mode === "new-tag" ? (dialog.category ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== (start?.name ?? "") || description !== (start?.description ?? "");
  const title = dialog.mode === "rename" ? "Byt namn" : dialog.category ? `Nytt värde i ${dialog.category}` : "Ny taggkategori";
  const submit = async () => {
    setError(null);
    const res =
      dialog.mode === "rename"
        ? await rename.run({ id: dialog.g.id, name, description }).catch(() => null)
        : await create.run({ kind: "tag", contractId, name, description, category }).catch(() => null);
    if (!res || !res.ok) {
      setError(res && !res.ok && res.message ? res.message : "Det gick inte att spara. Kontrollera fälten.");
      return;
    }
    toast(dialog.mode === "rename" ? "Namnet är ändrat." : `${name.trim()} är tillagd.`);
    onClose();
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={create.pending || rename.pending} onClick={() => void submit()}>
            Spara
          </Button>
        </>
      }
    >
      <Stack>
        {error && <Notice tone="warn" title={error} />}
        {dialog.mode === "new-tag" && !dialog.category && (
          <Field label="Kategori" id="gd-kategori" required help="Till exempel ”Körkort”. En deltagare har högst ett värde per kategori.">
            <Input value={category} maxLength={60} onValueChange={setCategory} />
          </Field>
        )}
        <Field label="Namn" id="gd-namn" required help={NAME_HELP}>
          <Input value={name} maxLength={80} onValueChange={setName} />
        </Field>
        <Field label="Beskrivning (valfritt)" id="gd-beskrivning" help="Skriv aldrig personnummer eller namn på deltagare.">
          <TextArea rows={2} value={description} maxLength={300} onValueChange={setDescription} />
        </Field>
      </Stack>
    </Modal>
  );
}
