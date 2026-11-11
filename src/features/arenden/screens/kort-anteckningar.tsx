"use client";
// Deltagarkortets flik Anteckningar och kortet Senaste anteckningar på Översikt (Karims beslut 2026-11-11: "Anteckningar borde
// hamna under deltagarkortet, dem gör inte det idag"). Alla fria anteckningar i ärendet med det senaste först – datum, vem som
// skrev, typ och text – och den korta anteckningen i godkända mötesrapporter som rader som bara läses. Skriv, ändra och ta bort
// med samma dialog och samma regler som Tidslinje. Kommunen och ekonomen ser aldrig anteckningarna (frågan svarar null).
// Data: arenden.kortAnteckningar (buildNotes i timeline.ts).
import { useState } from "react";
import { useQuery } from "@/shell/backend";
import { dayOf } from "@/core/time";
import { Button, Card, cn, Empty, List, ListItem, Section } from "@/ui";
import { caseNotes, type CaseNoteRow, type TimelineNote } from "../api";
import { fd, TabQuery } from "./common";
import { NoteActions, NoteDialog } from "./kort-tidslinje";
import type { TabProps } from "./kort";

const HEADING_ID = "anteckningar-rubrik";
const EMPTY_TEXT = "Här samlas anteckningarna om deltagaren – från deltagarkortet, aktivitetsvyn och de godkända mötesrapporterna. Inga anteckningar än.";

/** En anteckning: rubrik (typ), datum, vem som skrev, var den skrevs och texten. Ändra och Ta bort när rollen får. */
function NoteRowItem({ r, card, onEdit, actions = true }: { r: CaseNoteRow; card: TabProps["card"]; onEdit: (n: TimelineNote) => void; actions?: boolean }) {
  const today = dayOf(card.now);
  const side = actions && r.note && (r.note.canEdit || r.note.canRemove) ? <NoteActions note={r.note} card={card} onEdit={onEdit} headingId={HEADING_ID} /> : undefined;
  return (
    <ListItem
      icon={r.note ? "edit" : "check-square"}
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span>{r.title}</span>
          <span className="text-small font-normal text-text-muted">{fd(r.at, today)}</span>
        </span>
      }
      sub={[r.context, r.sub].filter(Boolean).join(" · ")}
      side={side}
      data-mal={r.id}
    >
      <p className={cn("m-0 mt-1 whitespace-pre-line [overflow-wrap:anywhere]", r.note?.removed && "text-text-muted")}>{r.body}</p>
    </ListItem>
  );
}

export function TabAnteckningar({ card }: TabProps) {
  const q = useQuery(caseNotes, { caseId: card.caseId });
  const [dialog, setDialog] = useState<{ note: TimelineNote | null } | null>(null);
  const t = q.data;
  return (
    <Section
      title={<span id={HEADING_ID} tabIndex={-1}>Anteckningar</span>}
      actions={t?.canWrite ? <Button kind="primary" icon="plus" onClick={() => setDialog({ note: null })}>Skriv anteckning</Button> : undefined}
    >
      <TabQuery q={q}>
        {(d) =>
          d.rows.length === 0 ? (
            <Card>
              <Empty icon="edit" title="Inga anteckningar än">{EMPTY_TEXT}</Empty>
            </Card>
          ) : (
            <Card flush>
              <List>
                {d.rows.map((r) => (
                  <NoteRowItem key={r.id} r={r} card={card} onEdit={(note) => setDialog({ note })} />
                ))}
              </List>
            </Card>
          )
        }
      </TabQuery>
      {dialog && <NoteDialog card={card} note={dialog.note} onClose={() => setDialog(null)} />}
    </Section>
  );
}

/** Översiktens kort: de tre senaste anteckningarna och länken till fliken. Inga knappar för att ändra – det görs i fliken. */
export function LatestNotesCard({ card, setTab }: Pick<TabProps, "card" | "setTab">) {
  const q = useQuery(caseNotes, { caseId: card.caseId, limit: 3 });
  const d = q.data;
  // Inget kort för den som inte ser anteckningar (null) eller medan det laddar – Översikt har annat att visa.
  if (!d) return null;
  return (
    <Card
      title="Senaste anteckningar"
      icon="edit"
      flush
      actions={
        d.total > 0 ? (
          <Button kind="ghost" iconRight="arrow-right" onClick={() => setTab("anteckningar")}>
            Visa alla anteckningar{d.total > d.rows.length ? ` (${d.total})` : ""}
          </Button>
        ) : undefined
      }
    >
      {d.rows.length === 0 ? (
        <div className="px-[18px] py-4">
          <p className="text-text-muted">Inga anteckningar än.</p>
        </div>
      ) : (
        <List>
          {d.rows.map((r) => (
            <NoteRowItem key={r.id} r={r} card={card} onEdit={() => undefined} actions={false} />
          ))}
        </List>
      )}
    </Card>
  );
}
