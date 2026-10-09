"use client";
// Grupper och nivåer (/grupper) – administrationen av avtalets nivåer, grupper och taggar (coachmötet 2026-10-09, Karims
// beslut 3): byta namn, arkivera och återställa, ny grupp, ny tagg (i en befintlig eller ny kategori). Nivåerna är alltid
// fem – de byter bara namn. Inget raderas. Grupperna skapas fritt av Miljonbemanning; namnen ska vara neutrala ord om stödet,
// aldrig omdömen om personer. Allt är internt – syns aldrig för kommunen.
import { useState } from "react";
import { useCommand, useQuery } from "@/shell/backend";
import { Badge, Button, Card, Empty, ErrorNotice, Field, Input, Loading, Modal, ModalCancelButton, Notice, Page, Row, Stack, TextArea, toast } from "@/ui";
import { groupingArchive, groupingCatalog, groupingCreate, groupingDefaults, groupingRename, type GroupingCatalog, type GroupingOption } from "../api";

const NAME_HELP = "Använd neutrala ord om stödet eller aktiviteten, till exempel ”Måndagsgruppen”. Aldrig omdömen om personer.";

export function GrupperScreen() {
  const q = useQuery(groupingCatalog, { arkiverade: true });
  const title = "Grupper och nivåer";
  if (q.error) return <Page title={title}><ErrorNotice error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (q.data === undefined) return <Page title={title}><Loading /></Page>;
  if (q.data === null) {
    return (
      <Page title={title}>
        <Card>
          <Empty icon="layers" title="Inget aktivt avtal">Grupper och nivåer finns per avtal.</Empty>
        </Card>
      </Page>
    );
  }
  return <Catalog cat={q.data} />;
}

type Dialog = { mode: "rename"; g: GroupingOption } | { mode: "new-group" } | { mode: "new-tag"; category: string | null };

function Catalog({ cat }: { cat: GroupingCatalog }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const archive = useCommand(groupingArchive);
  const defaults = useCommand(groupingDefaults);
  const edit = cat.canEdit;
  const toggleArchive = async (g: GroupingOption) => {
    const res = await archive.run({ id: g.id, archived: !g.archived }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Det gick inte att ändra.", "error");
      return;
    }
    toast(g.archived ? `${g.name} är återställd.` : `${g.name} är arkiverad. Den kan inte väljas för fler deltagare.`);
  };
  const actionsFor = (g: GroupingOption, archivable: boolean) =>
    edit && (
      <Row gap="sm">
        <Button kind="ghost" icon="edit" onClick={() => setDialog({ mode: "rename", g })}>
          Byt namn<span className="sr-only"> på {g.name}</span>
        </Button>
        {archivable && (
          <Button kind="ghost" icon={g.archived ? "refresh" : "minus-circle"} pending={archive.pending} onClick={() => void toggleArchive(g)}>
            {g.archived ? "Återställ" : "Arkivera"}
            <span className="sr-only"> {g.name}</span>
          </Button>
        )}
      </Row>
    );
  const list = (xs: GroupingOption[], archivable: boolean, empty: string) =>
    xs.length ? (
      <ul className="flex flex-col" aria-label="Lista">
        {xs.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ljusgra py-2.5 last:border-b-0">
            <Stack gap="sm" className="min-w-[min(100%,240px)] flex-1">
              <span className="flex flex-wrap items-center gap-2 font-bold">
                {g.name}
                {g.archived && <Badge tone="outline" icon="minus-circle">Arkiverad</Badge>}
              </span>
              {g.description && <span className="text-small text-text-muted">{g.description}</span>}
            </Stack>
            <span className="text-small text-text-muted">{g.members === 1 ? "1 deltagare" : `${g.members} deltagare`}</span>
            {actionsFor(g, archivable)}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-small text-text-muted">{empty}</p>
    );

  return (
    <Page
      title="Grupper och nivåer"
      lead="Nivåer, grupper och taggar är Miljonbemannings eget arbetsverktyg. Kommunen ser dem aldrig, och de kommer aldrig med i rapporter, resultatfilen eller underlaget till AI."
      actions={<Button kind="ghost" icon="edit" to="/anteckningar">Anteckningar</Button>}
    >
      {!edit && <Notice tone="info" icon="eye" title="Du kan se men inte ändra grupperna och nivåerna." />}
      {cat.missingDefaults && edit && (
        <Notice tone="warn" title="Avtalet saknar nivåerna">
          <Row gap="sm">
            <span>Lägg in de fem nivåerna och taggen Vill arbeta.</span>
            <Button
              kind="secondary"
              pending={defaults.pending}
              onClick={() => void defaults.run({}).then((r) => r.ok && toast(`${r.added} värden är tillagda.`)).catch(() => toast("Det gick inte att lägga in nivåerna.", "error"))}
            >
              Lägg in nivåerna
            </Button>
          </Row>
        </Notice>
      )}
      <Card title="Nivåer" icon="layers">
        <p className="mb-2 text-small text-text-muted">Fem nivåer: hur nära arbete deltagaren är. En deltagare har högst en nivå. Nivåerna kan byta namn men inte arkiveras.</p>
        {list(cat.levels, false, "Inga nivåer.")}
      </Card>
      <Card
        title="Grupper"
        icon="users"
        actions={edit && <Button kind="secondary" icon="plus" onClick={() => setDialog({ mode: "new-group" })}>Ny grupp</Button>}
      >
        <p className="mb-2 text-small text-text-muted">En deltagare kan vara med i flera grupper. En arkiverad grupp kan inte väljas för fler deltagare.</p>
        {list(cat.groups, true, "Det finns inga grupper ännu.")}
      </Card>
      {cat.tags.map((t) => (
        <Card
          key={t.category}
          title={`Tagg: ${t.category}`}
          icon="hash"
          actions={edit && <Button kind="secondary" icon="plus" onClick={() => setDialog({ mode: "new-tag", category: t.category })}>Nytt värde</Button>}
        >
          <p className="mb-2 text-small text-text-muted">En deltagare har högst ett värde i kategorin.</p>
          {list(t.values, true, "Inga värden.")}
        </Card>
      ))}
      {edit && (
        <div>
          <Button kind="ghost" icon="plus" onClick={() => setDialog({ mode: "new-tag", category: null })}>
            Ny taggkategori
          </Button>
        </div>
      )}
      {dialog && <GroupingDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </Page>
  );
}

function GroupingDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const create = useCommand(groupingCreate);
  const rename = useCommand(groupingRename);
  const start = dialog.mode === "rename" ? dialog.g : null;
  const [name, setName] = useState(start?.name ?? "");
  const [description, setDescription] = useState(start?.description ?? "");
  const [category, setCategory] = useState(dialog.mode === "new-tag" ? (dialog.category ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== (start?.name ?? "") || description !== (start?.description ?? "");
  const title = dialog.mode === "rename" ? "Byt namn" : dialog.mode === "new-group" ? "Ny grupp" : dialog.category ? `Nytt värde i ${dialog.category}` : "Ny taggkategori";
  const submit = async () => {
    setError(null);
    const res =
      dialog.mode === "rename"
        ? await rename.run({ id: dialog.g.id, name, description }).catch(() => null)
        : await create.run({ kind: dialog.mode === "new-group" ? "group" : "tag", name, description, ...(dialog.mode === "new-tag" ? { category } : {}) }).catch(() => null);
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
        <Field label="Beskrivning (valfritt)" id="gd-beskrivning" help="Till exempel när gruppen träffas. Skriv aldrig personnummer eller namn på deltagare.">
          <TextArea rows={2} value={description} maxLength={300} onValueChange={setDescription} />
        </Field>
      </Stack>
    </Modal>
  );
}
