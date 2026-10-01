"use client";
// "Lämna synpunkt" och "Alla synpunkter" i testmiljöns verktygsfält (src/app/_shell/client-root.tsx, raden "Testmiljö").
// Bara för testare i testmiljön: session.feedback finns bara då (servern kontrollerar samma sak, och RLS en gång till).
// Ingenting renderas för andra, i produktion eller i prototypen (prototypen har sin egen feedbacklåda med samma fält och
// kort – components.tsx). Synpunkten sparas med rollen testaren agerar som och sidan (bara sökväg och id:n).
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ROLE_LABEL } from "@/api/roles";
import { safeReturnPath } from "@/core/return-path";
import { fmtDateTime } from "@/core/time";
import { useNav } from "@/shell/nav";
import { resolveRoute, titleOf, type RouteDef } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/dialog";
import { useDownload } from "@/ui/download";
import { Empty, Loading, Notice } from "@/ui/feedback";
import { Field, Select, Seg } from "@/ui/form";
import { toast } from "@/ui/toast";
import type { FeedbackPort, FeedbackView } from "./api";
import { FeedbackCard, FeedbackFields, SMALL_BTN } from "./components";
import { FB_DONE, FB_STATUSES, FB_TYPES, feedbackCsv, PATH_MASK, sanitizeFeedbackPath, type FeedbackPriority, type FeedbackStatus, type FeedbackType } from "./model";

type Open = "ny" | "lista" | null;

/** Knapparna i testmiljöns verktygsfält. routes = appens rutt-tabell (sidans titel). */
export function FeedbackToolbar({ routes }: { routes: readonly RouteDef[] }) {
  const session = useSession();
  const [open, setOpen] = useState<Open>(null);
  const port = session.feedback;
  if (!port || !session.isTester || session.environment !== "staging") return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button kind="primary" icon="message-circle" className={SMALL_BTN} onClick={() => setOpen("ny")}>
        Lämna synpunkt
      </Button>
      <Button kind="ghost" icon="list" className={SMALL_BTN} onClick={() => setOpen("lista")}>
        Alla synpunkter
      </Button>
      {open === "ny" && <SubmitDialog port={port} routes={routes} onClose={() => setOpen(null)} onShowList={() => setOpen("lista")} />}
      {open === "lista" && <ListDialog port={port} routes={routes} onClose={() => setOpen(null)} onNew={() => setOpen("ny")} />}
    </span>
  );
}

// ---------------------------------------------------------------- Lämna synpunkt
type Scope = "page" | "all";

function SubmitDialog({ port, routes, onClose, onShowList }: { port: FeedbackPort; routes: readonly RouteDef[]; onClose: () => void; onShowList: () => void }) {
  const nav = useNav();
  const { actor } = useSession();
  const match = resolveRoute(routes, nav.path);
  const viewTitle = match ? titleOf(match, nav.query) : "Sidan finns inte";
  const query = nav.query.toString();
  const path = sanitizeFeedbackPath(`${nav.path}${query ? `?${query}` : ""}`);
  const [scope, setScope] = useState<Scope>("page");
  const [type, setType] = useState<FeedbackType>("forbattring");
  const [prio, setPrio] = useState<FeedbackPriority>("bor");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  // Fokus i textfältet när dialogen öppnas (som prototypens feedbacklåda).
  useEffect(() => {
    const t = setTimeout(() => document.getElementById("syn-text")?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!text.trim()) {
      setErr("Skriv vad du tycker innan du sparar.");
      return;
    }
    setBusy(true);
    const whole = scope === "all";
    const res = await port.submit({ type, priority: prio, text: text.trim(), path: whole ? null : path, viewTitle: whole ? null : viewTitle }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setText("");
      setSent(true);
    } else {
      setSent(false);
      setErr(res && !res.ok && res.message ? res.message : "Synpunkten kunde inte sparas just nu. Försök igen om en stund.");
    }
  };

  return (
    <Modal
      title="Lämna synpunkt"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            {sent ? "Stäng" : "Avbryt"}
          </Button>
          <Button kind="primary" type="submit" form="syn-form" icon="send" pending={busy}>
            Spara synpunkt
          </Button>
        </>
      }
    >
      <form id="syn-form" className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        <p>
          Miljonmatch är inte färdigt. Skriv vad som är fel, vad som saknas eller vad som kan bli bättre – i arbetssättet eller på sidan. Alla som testar ser
          synpunkterna, och vi går igenom dem tillsammans.
        </p>
        <Notice tone="info" icon="map-pin" title="Synpunkten sparas med">
          {ROLE_LABEL[actor.role]} · {scope === "all" ? "Hela Miljonmatch" : viewTitle}
        </Notice>
        <Field label="Gäller" id="syn-scope">
          <Seg<Scope>
            id="syn-scope"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: "page", label: "Den här sidan" },
              { value: "all", label: "Hela Miljonmatch" },
            ]}
          />
        </Field>
        <FeedbackFields idPrefix="syn" type={type} onTypeChange={setType} priority={prio} onPriorityChange={setPrio} text={text} onTextChange={setText} error={err} />
        <div role="status">
          {sent && (
            <Notice tone="ok" title="Tack! Synpunkten är sparad.">
              Alla som testar ser den under Alla synpunkter.{" "}
              <Button kind="ghost" className={SMALL_BTN} onClick={onShowList}>
                Visa alla synpunkter
              </Button>
            </Notice>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Alla synpunkter
type StatusFilter = "oppna" | "alla" | FeedbackStatus;
type TypeFilter = "alla" | FeedbackType;

/**
 * "Gå till sidan": bara en egen sökväg (safeReturnPath – aldrig en annan webbplats) utan maskerade avsnitt, till en sida som
 * finns. Får testpersonen som testaren agerar som inte öppna sidan visas i stället vilken roll synpunkten lämnades som
 * (testaren byter testperson under "Agera som" – bytet laddar om sidan, så appen byter inte åt hen).
 */
function feedbackTarget(routes: readonly RouteDef[], path: string | null, role: FeedbackView["role"]): { to: string } | { needsRole: true } | null {
  if (!path || path.includes(PATH_MASK)) return null;
  const to = safeReturnPath(path);
  if (!to) return null;
  const match = resolveRoute(routes, to.split(/[?#]/)[0]);
  if (!match) return null;
  return match.route.public || match.route.roles.includes(role) ? { to } : { needsRole: true };
}

function ListDialog({ port, routes, onClose, onNew }: { port: FeedbackPort; routes: readonly RouteDef[]; onClose: () => void; onNew: () => void }) {
  const nav = useNav();
  const { actor } = useSession();
  const download = useDownload();
  const [items, setItems] = useState<FeedbackView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("oppna");
  const [type, setType] = useState<TypeFilter>("alla");

  // Listan hämtas när dialogen öppnas och efter varje ändring (version).
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    port.list().then(
      (list) => {
        if (cancelled) return;
        setItems(list);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [port, version]);

  const all = items ?? [];
  const shown = all.filter(
    (x) => (status === "alla" || (status === "oppna" ? !FB_DONE.includes(x.status) : x.status === status)) && (type === "alla" || x.type === type),
  );
  const changeStatus = async (id: string, value: string) => {
    const res = await port.setStatus({ feedbackId: id, status: value as FeedbackStatus }).catch(() => null);
    if (!res?.ok) toast("Statusen kunde inte ändras. Försök igen.", "error");
    load();
  };
  const reply = async (id: string, text: string) => {
    const res = await port.reply({ feedbackId: id, text }).catch(() => null);
    if (!res?.ok) {
      toast("Svaret kunde inte sparas.", "error");
      return false;
    }
    load();
    return true;
  };
  const csv = () => {
    // Filnamnet får dagens datum (webbläsarens, inte testklockan).
    const day = new Date().toLocaleDateString("sv-SE");
    void download(`synpunkter-${day}.csv`, feedbackCsv(shown), "text/csv;charset=utf-8");
  };

  return (
    <Modal
      wide
      title="Alla synpunkter"
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Stäng
          </Button>
          <Button kind="primary" icon="message-circle" onClick={onNew}>
            Lämna synpunkt
          </Button>
        </>
      }
    >
      <p>Synpunkter från alla som testar. Svara och ändra status när ni går igenom dem.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status" id="syn-f-status">
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as StatusFilter)}
            options={[{ value: "oppna", label: "Inte klara" }, { value: "alla", label: "Alla" }, ...FB_STATUSES]}
          />
        </Field>
        <Field label="Typ" id="syn-f-type">
          <Select value={type} onValueChange={(v) => setType(v as TypeFilter)} options={[{ value: "alla", label: "Alla typer" }, ...FB_TYPES.map((t) => ({ value: t.value, label: t.label }))]} />
        </Field>
        <Button icon="download" disabled={!shown.length} onClick={csv}>
          Ladda ner (CSV)
        </Button>
      </div>
      <div role="status" className="text-small text-text-muted">
        {items ? `Visar ${shown.length} av ${all.length} synpunkter.` : ""}
      </div>
      {failed && (
        <Notice tone="critical" title="Synpunkterna kunde inte hämtas">
          Försök igen om en stund.{" "}
          <Button kind="ghost" className={SMALL_BTN} onClick={load}>
            Försök igen
          </Button>
        </Notice>
      )}
      {!items && !failed && <Loading label="Hämtar synpunkter…" />}
      {items && shown.length === 0 && (
        <Empty icon="message-circle" title={all.length ? "Inga synpunkter med det här filtret" : "Inga synpunkter ännu"}>
          {all.length ? "Ändra filtret för att se fler." : "Välj Lämna synpunkt för att skriva den första."}
        </Empty>
      )}
      <div className="flex flex-col gap-3">
        {shown.map((it) => {
          const target = feedbackTarget(routes, it.path, actor.role);
          return (
            <FeedbackCard
              key={it.id}
              id={it.id}
              type={it.type}
              priority={it.priority}
              status={it.status}
              text={it.text}
              perspective={it.perspective}
              perspectiveLabel={it.perspectiveLabel}
              byline={`${it.mine ? "Du" : it.authorName} · ${fmtDateTime(it.submittedAt ?? it.createdAt)}`}
              context={`${it.roleLabel} · ${it.viewTitle ?? "Hela Miljonmatch"}`}
              onStatusChange={(v) => void changeStatus(it.id, v)}
              goTo={
                target && "to" in target
                  ? {
                      label: "Gå till sidan",
                      onClick: () => {
                        onClose();
                        nav.push(target.to);
                      },
                    }
                  : null
              }
              extraActions={
                target && "needsRole" in target ? (
                  <span>
                    Synpunkten lämnades som {ROLE_LABEL[it.role].toLowerCase()}. Välj en sådan testperson under Agera som för att öppna sidan.
                  </span>
                ) : null
              }
              replies={it.replies.map((r) => ({ id: r.id, byline: `${r.mine ? "Du" : r.authorName} · ${fmtDateTime(r.submittedAt ?? r.createdAt)}`, text: r.text }))}
              replyCount={it.replies.length}
              onReply={(text) => reply(it.id, text)}
            />
          );
        })}
      </div>
    </Modal>
  );
}
