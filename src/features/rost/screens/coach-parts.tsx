"use client";
// Deltagarens röstmeddelanden för coachen (docs/PLAN-ROST.md, flöde 3):
//   VoiceNotesRow      i deltagarkortets huvud (/arenden/:caseId): en rad som fäller ut rutan med inspelningslänken (skicka via
//                      deltagarens kontaktväg, länkens läge) och röstmeddelandena – markera som granskat eller använd texten
//                      som underlag i avstämningen
//   VoiceNotesInbox    på Min vecka: nya röstmeddelanden att granska i coachens ärenden
//   VoiceNotesForCheckIn  i veckoavstämningen: texten som underlag (coachen väljer själv om den ska in i anteckningen)
// Texten är AI-transkriberad (och AI-översatt till svenska när deltagaren talade ett annat språk) och märks så. Visningen
// loggas i revisionsloggen. Aldrig länkar eller inspelning för skyddade personuppgifter – då förklaras varför.
import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtDateShort, fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { DemoOnly } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import {
  AiTag, Badge, BuildPhase, Button, Card, cn, Empty, Field, Icon, List, ListItem, Modal, Notice, PerspectiveLink, Row, Select, Stack, toast, useAuditView,
} from "@/ui";
import { caseVoice, linkSend, noteReview, notesSeen, pendingNotes, type CaseVoiceView, type RostLang, type VoiceNoteView } from "../api";

const LINK_STATE: Record<"open" | "used" | "expired", { text: string; tone: "bluetone" | "blue" | "grey"; icon: "clock" | "check" | "x-circle" }> = {
  open: { text: "Inte använd ännu", tone: "bluetone", icon: "clock" },
  used: { text: "Använd", tone: "blue", icon: "check" },
  expired: { text: "Har gått ut", tone: "grey", icon: "x-circle" },
};
const CHANNEL_SHORT = { sms: "SMS", email: "e-post" } as const;
const RTL = new Set(["ar"]);

/** AI-märkningen av texten: transkriberad, eller översatt till svenska. */
function NoteTags({ n }: { n: Pick<VoiceNoteView, "translated" | "languageName"> }) {
  return (
    <>
      <AiTag>{n.translated ? "AI-översättning" : "AI-transkribering"}</AiTag>
      {n.translated && (
        <Badge tone="plan" icon="globe">
          Talat på {n.languageName} – översättningen granskas av dig
        </Badge>
      )}
    </>
  );
}

// ================================================================ Deltagarkortet
/**
 * Röstmeddelandena som en rad i deltagarkortets huvud: "Röstmeddelanden: 1 nytt" och knappen "Läs", som fäller ut hela rutan
 * under raden. Utan meddelanden: "Inga röstmeddelanden" och "Skicka inspelningslänk". autoOpen (?visa=rost, länken
 * "Läs röstmeddelandet" på Min vecka): utfälld och i bild. Visningen loggas när texten fälls ut (beslut 2026-10-02) –
 * inte när kortet laddas.
 */
export function VoiceNotesRow({ caseId, autoOpen, className }: { caseId: string; autoOpen?: boolean; className?: string }) {
  const q = useQuery(caseVoice, { caseId });
  const seen = useCommand(notesSeen);
  const v = q.data;
  const count = v?.notes.length ?? 0;
  const [open, setOpen] = useState(!!autoOpen);
  const [send, setSend] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loaded = !!v;
  // Röstmeddelandena är transkript (CLAUDE.md punkt 3): visningen loggas vid varje utfällning av texten – en ny visning –
  // och aldrig när kortet bara laddas eller när raden fälls ihop. "Nytt" räknas bort först när coachen markerar som granskat.
  const logView = useRef<() => void>(() => undefined);
  useEffect(() => {
    logView.current = () => {
      if (count > 0) void seen.run({ caseId }).catch(() => undefined);
    };
  });
  const show = (o: boolean) => {
    setOpen(o);
    if (o) logView.current();
  };
  // Utfälld från början (?visa=rost): loggas en gång när innehållet har kommit, och raden skrollas i bild.
  const autoLogged = useRef(false);
  useEffect(() => {
    if (!autoOpen || !loaded) return;
    if (!autoLogged.current) {
      autoLogged.current = true;
      logView.current();
    }
    const t = window.setTimeout(() => ref.current?.scrollIntoView({ block: "start" }), 0);
    return () => window.clearTimeout(t);
  }, [autoOpen, loaded]);
  if (!v) return null;
  const fresh = v.notes.filter((n) => n.status === "new").length;
  const canSend = v.canWork && v.send.allowed;
  return (
    <div ref={ref} id="rost" role="group" aria-labelledby="rost-rubrik" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="rost-rubrik" className="flex items-center gap-1.5 text-body font-bold">
          <Icon name="mic" />
          Röstmeddelanden:
        </h2>
        {count === 0 ? (
          <span>Inga röstmeddelanden</span>
        ) : fresh > 0 ? (
          <Badge tone="red" icon="bell">
            {fresh === 1 ? "1 nytt" : `${fresh} nya`}
          </Badge>
        ) : (
          <span>{count === 1 ? "1 granskat" : `${count} granskade`}</span>
        )}
        <Button kind="ghost" icon={open ? "chevron-up" : "chevron-down"} aria-expanded={open} aria-controls="rost-kropp" onClick={() => show(!open)}>
          {open ? "Dölj" : count > 0 ? "Läs" : "Visa"}
        </Button>
        {count === 0 && canSend && !open && (
          <Button
            icon="send"
            onClick={() => {
              show(true);
              setSend(true);
            }}
          >
            Skicka inspelningslänk
          </Button>
        )}
      </div>
      {open && (
        <div id="rost-kropp">
          <VoiceCardBody v={v} startSend={send} onSendClosed={() => setSend(false)} />
        </div>
      )}
    </div>
  );
}

function VoiceCardBody({ v, startSend, onSendClosed }: { v: CaseVoiceView; startSend?: boolean; onSendClosed?: () => void }) {
  const role = useSession().actor.role;
  const [open, setOpenState] = useState(!!startSend);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    if (!o) onSendClosed?.();
  };
  const [sentPath, setSentPath] = useState<string | null>(null);
  const fresh = v.notes.filter((n) => n.status === "new").length;
  const l = v.lastLink;
  return (
    <Card title="Deltagarens röstmeddelanden" icon="mic" actions={<BuildPhase fas={2} />}>
      <Stack gap="sm">
        <p className="text-small text-text-muted">
          Deltagaren kan spela in ett kort meddelande på sitt språk via en länk. Du får texten, översatt till svenska, som underlag. Inget ljud sparas.
        </p>
        {l && (
          <div className="flex flex-wrap items-center gap-1.5 text-small">
            <span>
              Senaste länk: {fmtDateTime(l.sentAt)} med {CHANNEL_SHORT[l.channel]} på {l.languageName} · gäller till {fmtDateShort(l.expiresAt)}
            </span>
            <Badge tone={LINK_STATE[l.state].tone} icon={LINK_STATE[l.state].icon}>
              {l.state === "used" && l.usedAt ? `Använd ${fmtDateTime(l.usedAt)}` : LINK_STATE[l.state].text}
            </Badge>
          </div>
        )}
        {v.canWork && v.send.allowed && (
          <div>
            <Button icon="send" onClick={() => setOpen(true)} className="whitespace-normal">
              Skicka inspelningslänk till deltagaren
            </Button>
          </div>
        )}
        {v.canWork && !v.send.allowed && v.send.reason && (
          <Notice tone="warn" icon="lock" title="Ingen inspelningslänk">
            {v.send.reason}
          </Notice>
        )}
        {sentPath && (
          <DemoOnly>
            <div className="flex flex-col gap-1">
              <span className="text-small">Länken som deltagaren fick:</span>
              <PerspectiveLink role="deltagare" to={sentPath} label="Öppna länken som deltagaren" />
            </div>
          </DemoOnly>
        )}
        {fresh > 0 && (
          <Badge tone="red" icon="bell">
            {fresh === 1 ? "Ett nytt röstmeddelande att granska" : `${fresh} nya röstmeddelanden att granska`}
          </Badge>
        )}
        {v.notes.length === 0 ? (
          <p className="text-small text-text-muted">Inga röstmeddelanden ännu.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {v.notes.map((n) => (
              <VoiceNote key={n.id} n={n} canWork={v.canWork} canUse={role === "coach" && v.canWork} />
            ))}
          </div>
        )}
      </Stack>
      {open && (
        <SendLinkModal
          v={v}
          onClose={() => setOpen(false)}
          onSent={(p) => {
            setOpen(false);
            setSentPath(p);
          }}
        />
      )}
    </Card>
  );
}

function VoiceNote({ n, canWork, canUse }: { n: VoiceNoteView; canWork: boolean; canUse: boolean }) {
  const review = useCommand(noteReview);
  const [orig, setOrig] = useState(false);
  const mark = async (status: "reviewed" | "new") => {
    const res = await review.run({ noteId: n.id, status }).catch(() => null);
    if (!res || !res.ok) {
      toast(res && !res.ok && res.message ? res.message : "Röstmeddelandet kunde inte ändras.", "error");
      return;
    }
    toast(status === "reviewed" ? "Röstmeddelandet är markerat som granskat." : "Röstmeddelandet är markerat som nytt igen.");
  };
  return (
    <article aria-label={`Röstmeddelande ${fmtDateTime(n.createdAt)}`} className="flex flex-col gap-2 rounded-mb border-[1.5px] border-bla bg-bla-ton px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold">{fmtDateTime(n.createdAt)}</span>
        {n.status === "new" ? (
          <Badge tone="red" icon="bell">
            Nytt – att granska
          </Badge>
        ) : (
          <Badge tone="blue" icon="check">
            Granskat{n.reviewedAt ? ` ${fmtDateShort(n.reviewedAt)}` : ""}
            {n.reviewedByName ? ` av ${n.reviewedByName}` : ""}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <NoteTags n={n} />
      </div>
      <blockquote className="m-0 border-l-[3px] border-antracit bg-vit px-3 py-2 [overflow-wrap:anywhere]">{n.textSv}</blockquote>
      {n.textOriginal && (
        <div className="flex flex-col gap-1.5">
          <div>
            <Button kind="ghost" icon={orig ? "eye-off" : "eye"} ariaPressed={orig} onClick={() => setOrig(!orig)}>
              {orig ? "Dölj originaltexten" : `Visa originaltexten (${n.languageName})`}
            </Button>
          </div>
          {orig && (
            <blockquote lang={n.language} dir={RTL.has(n.language) ? "rtl" : "ltr"} className="m-0 border-l-[3px] border-ljusgra bg-vit px-3 py-2 [overflow-wrap:anywhere]">
              {n.textOriginal}
            </blockquote>
          )}
        </div>
      )}
      <span className="text-small text-text-muted">
        Samtycke i länken {fmtDateTime(n.consentGivenAt)}, textversion {n.consentTextVersion}. Ljudet raderades direkt efter transkriberingen.
      </span>
      {canWork && (
        <div className="flex flex-wrap gap-2">
          {n.status === "new" ? (
            <Button kind="primary" icon="check" pending={review.pending} onClick={() => void mark("reviewed")}>
              Markera som granskat
            </Button>
          ) : (
            <Button kind="ghost" icon="reset" pending={review.pending} onClick={() => void mark("new")}>
              Ångra granskningen
            </Button>
          )}
          {canUse && (
            <Button kind="secondary" icon="clipboard" to={`/avstamning/${encodeURIComponent(n.caseId)}?rost=${encodeURIComponent(n.id)}`}>
              Använd i avstämningen
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function SendLinkModal({ v, onClose, onSent }: { v: CaseVoiceView; onClose: () => void; onSent: (path: string | null) => void }) {
  const send = useCommand(linkSend);
  const [lang, setLang] = useState(v.send.defaultLanguage);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    const res = await send.run({ caseId: v.caseId, language: lang as RostLang }).catch(() => null);
    if (!res || !res.ok) {
      setErr(res && !res.ok && res.message ? res.message : "Länken kunde inte skickas. Försök igen.");
      return;
    }
    toast(`Länken är skickad med ${CHANNEL_SHORT[res.channel]}. Den gäller till ${fmtDate(res.expiresAt)}.`);
    onSent(res.path);
  };
  return (
    <Modal
      title="Skicka inspelningslänk"
      onClose={onClose}
      footer={
        <Row>
          <Button kind="primary" icon="send" pending={send.pending} onClick={() => void submit()}>
            Skicka länken
          </Button>
          <Button kind="ghost" onClick={onClose}>
            Avbryt
          </Button>
        </Row>
      }
    >
      <Stack>
        <p>
          Deltagaren får en länk och kan spela in ett meddelande på högst {v.send.maxMinutes} minuter, på sitt språk. Samtycket ges i länken innan något spelas in. Det är
          frivilligt.
        </p>
        <Field label="Språk på sidan" id="vl-lang" help="Deltagaren kan byta språk på sidan. Texten översätts till svenska åt dig.">
          <Select value={lang} onValueChange={setLang} options={v.send.languages.map((x) => ({ value: x.code, label: x.label }))} />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="font-bold">Skickas med</span>
          <span className="flex items-center gap-1.5">
            <Icon name={v.send.channel === "email" ? "mail" : "message"} />
            {v.send.channelText} (deltagarens kontaktväg)
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-bold">Texten i utskicket</span>
          <blockquote className="m-0 border-l-[3px] border-ljusgra bg-ljusgra-ton px-3 py-2">{v.send.messageText} [länk]</blockquote>
          <span className="text-small text-text-muted">Inga personuppgifter – inget namn och inget ärendenummer. Länken gäller i {v.send.days} dagar och fungerar en gång.</span>
        </div>
        {v.lastLink?.state === "open" && <Notice tone="info">Den förra länken slutar gälla när du skickar en ny.</Notice>}
        {err && (
          <div role="alert" className="flex items-start gap-1.5 font-bold">
            <Icon name="alert-circle" className="mt-px text-rod" />
            {err}
          </div>
        )}
      </Stack>
    </Modal>
  );
}

// ================================================================ Min vecka
export function VoiceNotesInbox() {
  const q = useQuery(pendingNotes, {});
  const rows = q.data ?? [];
  return (
    <Card title="Deltagarnas röstmeddelanden" icon="mic" actions={<BuildPhase fas={2} />} flush>
      {rows.length === 0 ? (
        <Empty icon="mic" title="Inga nya röstmeddelanden">
          När en deltagare spelar in ett meddelande via länken hamnar det här.
        </Empty>
      ) : (
        <List>
          {rows.map((r) => (
            <ListItem
              key={r.id}
              lead={
                <Badge tone="red" icon="bell">
                  Nytt
                </Badge>
              }
              title={
                <>
                  {r.name} <span className="font-normal text-text-muted tabular-nums">{r.caseNumber}</span>
                </>
              }
              sub={`${fmtDateTime(r.createdAt)} · ${r.translated ? `talat på ${r.languageName}, AI-översättning` : "AI-transkribering"}`}
              side={
                <Button kind="primary" iconRight="arrow-right" to={`/arenden/${encodeURIComponent(r.caseId)}?visa=rost`}>
                  Läs röstmeddelandet
                </Button>
              }
            >
              <span className="text-small">{r.excerpt}</span>
            </ListItem>
          ))}
        </List>
      )}
    </Card>
  );
}

// ================================================================ Veckoavstämningen
/**
 * Deltagarens röstmeddelanden som underlag i avstämningen. Coachen väljer själv om texten ska in i anteckningen (onUse).
 * highlightId: meddelandet som coachen valde i deltagarkortet (?rost=).
 */
export function VoiceNotesForCheckIn({ caseId, highlightId, onUse }: { caseId: string; highlightId: string | null; onUse: (text: string) => void }) {
  const q = useQuery(caseVoice, { caseId });
  const seen = useCommand(notesSeen);
  const notes = (q.data?.notes ?? []).filter((n) => n.id === highlightId || n.status !== "archived").slice(0, 3);
  useAuditView(notes.length > 0 ? `voice_note.view:${caseId}` : null, () => seen.run({ caseId }).catch(() => undefined));
  if (!notes.length) return null;
  const ordered = highlightId ? [...notes.filter((n) => n.id === highlightId), ...notes.filter((n) => n.id !== highlightId)] : notes;
  return (
    <div className="flex flex-col gap-2 rounded-mb border-[1.5px] border-dashed border-line-strong px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Icon name="mic" />
        <span className="font-bold">Deltagarens röstmeddelanden – underlag</span>
      </div>
      <span className="text-body text-text-muted">Deltagarens egna ord. Använd det som stämmer och skriv sakligt – inga diagnoser.</span>
      {ordered.map((n) => (
        <div key={n.id} className="flex flex-col gap-1.5 border-t border-ljusgra pt-2 first-of-type:border-t-0">
          <div className="flex flex-wrap items-center gap-1.5 text-small">
            <span className="font-bold">{fmtDateTime(n.createdAt)}</span>
            <NoteTags n={n} />
            {n.status === "new" && (
              <Badge tone="dark" icon="bell">
                Inte granskat
              </Badge>
            )}
          </div>
          <blockquote className="m-0 border-l-[3px] border-antracit bg-vit px-3 py-2 text-body [overflow-wrap:anywhere]">{n.textSv}</blockquote>
          <div>
            <Button kind="secondary" icon="copy" onClick={() => onUse(`Deltagarens röstmeddelande ${fmtDateShort(n.createdAt)}: ${n.textSv}`)}>
              Lägg till i anteckningen
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
