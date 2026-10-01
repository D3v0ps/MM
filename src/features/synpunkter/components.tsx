"use client";
// Delar som prototypens feedbacklåda (src/demo/feedback.tsx) och testmiljöns "Lämna synpunkt" (panel.tsx) har gemensamt,
// så att de ser likadana ut: fälten Typ, Hur viktigt? och Vad tycker du?, och kortet för en synpunkt med status och svar.
// Texterna är den gamla prototypens (prototyp/src/90-feedback.js). Bara presentation – lagret ligger hos den som använder dem.
import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field, Seg, TextArea } from "@/ui/form";
import { FB_PRIOS, FB_STATUSES, FB_TYPES, FEEDBACK_REPLY_MAX, FEEDBACK_TEXT_MAX, prioLabel, typeIcon, typeLabel, type FeedbackPriority, type FeedbackType } from "./model";

export const SMALL_BTN = "min-h-11 px-2.5 py-1.5 text-small";

// ---------------------------------------------------------------- Fälten
export function FeedbackFields({
  idPrefix = "fb",
  type,
  onTypeChange,
  priority,
  onPriorityChange,
  text,
  onTextChange,
  error,
}: {
  /** Fältens id: `${idPrefix}-type`, `${idPrefix}-prio`, `${idPrefix}-text` (textfältet får fokus när lådan/dialogen öppnas). */
  idPrefix?: string;
  type: string;
  onTypeChange: (v: FeedbackType) => void;
  priority: string;
  onPriorityChange: (v: FeedbackPriority) => void;
  text: string;
  onTextChange: (v: string) => void;
  error?: string | null;
}) {
  return (
    <>
      <Field label="Typ" id={`${idPrefix}-type`}>
        <Seg<FeedbackType> id={`${idPrefix}-type`} value={type as FeedbackType} onValueChange={onTypeChange} options={FB_TYPES} />
      </Field>
      <Field label="Hur viktigt?" id={`${idPrefix}-prio`}>
        <Seg<FeedbackPriority> id={`${idPrefix}-prio`} value={priority as FeedbackPriority} onValueChange={onPriorityChange} options={FB_PRIOS} />
      </Field>
      <Field label="Vad tycker du?" id={`${idPrefix}-text`} required help="Skriv fritt. Beskriv gärna vad du förväntade dig och vad som hände." error={error ?? undefined}>
        <TextArea
          value={text}
          onValueChange={onTextChange}
          rows={5}
          maxLength={FEEDBACK_TEXT_MAX}
          placeholder="Till exempel: Samordnaren behöver se handläggarens telefonnummer direkt i inkorgen."
        />
      </Field>
    </>
  );
}

// ---------------------------------------------------------------- En synpunkt
export type FeedbackCardReply = { id: string; byline: string; text: string };

export type FeedbackCardProps = {
  id: string;
  type: string;
  priority: string;
  status: string;
  text: string;
  /** Perspektivet (Leverantör, Kund, Deltagare) – kund får blå ton. */
  perspective?: string | null;
  perspectiveLabel?: string | null;
  /** "Du · 2027-02-01 kl. 09.40" */
  byline: string;
  /** "Huvudcoach · Deltagarkort" */
  context: string;
  /** Spara en ny status. Anropas först när användaren väljer "Spara status" (inte när valet i listan ändras). */
  onStatusChange: (status: string) => void;
  /** "Gå till vyn" (prototypen) eller "Gå till sidan" (testmiljön). */
  goTo?: { label: string; onClick: () => void } | null;
  replies: readonly FeedbackCardReply[];
  replyCount: number;
  /** Spara ett svar. true = sparat (fältet töms). */
  onReply: (text: string) => Promise<boolean>;
  /** Svaren visas (styrt utifrån – prototypen prenumererar på svaren först när de visas). Utan: kortet styr själv. */
  repliesOpen?: boolean;
  onRepliesOpenChange?: (open: boolean) => void;
  /** Fler knappar i raden (prototypens "Ta bort"). */
  extraActions?: ReactNode;
};

export function FeedbackCard(p: FeedbackCardProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = p.repliesOpen ?? ownOpen;
  const setOpen = p.onRepliesOpenChange ?? setOwnOpen;
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  // Statusen sparas först med knappen "Spara status": piltangenterna i en stängd lista ger ett change-event per steg
  // (Chrome och Edge på Windows), och varje mellanstatus skulle annars sparas. Valet följer den sparade statusen.
  const [statusDraft, setStatusDraft] = useState(p.status);
  const [savedStatus, setSavedStatus] = useState(p.status);
  if (savedStatus !== p.status) {
    setSavedStatus(p.status);
    setStatusDraft(p.status);
  }
  const sendReply = async (e: FormEvent) => {
    e.preventDefault();
    const t = reply.trim();
    if (!t || sending) return;
    setSending(true);
    const saved = await p.onReply(t).catch(() => false);
    setSending(false);
    if (saved) setReply("");
  };
  return (
    <article className={cn("flex flex-col gap-2 rounded-card border border-ljusgra px-3.5 py-3", p.status === "ny" && "border-l-4 border-l-rod")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-meta text-text-muted portal:text-body">
        <Badge tone={p.type === "fel" ? "red" : p.type === "bra" ? "blue" : "grey"} icon={typeIcon(p.type)}>
          {typeLabel(p.type)}
        </Badge>
        <span className="font-bold text-antracit">{prioLabel(p.priority)}</span>
        {p.perspectiveLabel && <Badge tone={p.perspective === "kund" ? "bluetone" : "outline"}>{p.perspectiveLabel}</Badge>}
        <span>{p.byline}</span>
      </div>
      <div className="text-small text-text-muted">{p.context}</div>
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{p.text}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`st-${p.id}`}>
          Status
        </label>
        <select id={`st-${p.id}`} value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)} className="w-auto px-2.5 py-1.5 text-small">
          {FB_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {statusDraft !== p.status && (
          <Button kind="primary" icon="check" className={SMALL_BTN} onClick={() => p.onStatusChange(statusDraft)}>
            Spara status
          </Button>
        )}
        {p.goTo && (
          <Button kind="ghost" icon="arrow-right" className={SMALL_BTN} onClick={p.goTo.onClick}>
            {p.goTo.label}
          </Button>
        )}
        <Button kind="ghost" icon="reply" className={SMALL_BTN} aria-expanded={open} onClick={() => setOpen(!open)}>
          Svar{p.replyCount ? ` (${p.replyCount})` : ""}
        </Button>
        {p.extraActions}
      </div>
      {open && (
        <div className="flex flex-col gap-2">
          {p.replies.map((r) => (
            <div key={r.id} className="border-l-[3px] border-ljusgra pl-2.5">
              <div className="text-small text-text-muted">{r.byline}</div>
              <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{r.text}</div>
            </div>
          ))}
          <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => void sendReply(e)}>
            <label className="sr-only" htmlFor={`rep-${p.id}`}>
              Svara
            </label>
            <input id={`rep-${p.id}`} type="text" value={reply} maxLength={FEEDBACK_REPLY_MAX} onChange={(e) => setReply(e.target.value)} placeholder="Skriv ett svar" className="min-w-0 flex-1" />
            <Button kind="primary" type="submit" icon="send" pending={sending}>
              Svara
            </Button>
          </form>
        </div>
      )}
    </article>
  );
}
