"use client";
// Feedbacklådan, feedbackknappen nere till höger och en feedbackpunkt – port av den gamla prototypens
// FeedbackDrawer och FeedbackItem (prototyp/src/90-feedback.js). Bara i prototypen. Fälten och kortet delas med
// testmiljöns "Lämna synpunkt" (src/features/synpunkter/components.tsx), så att de ser likadana ut.
import { useEffect, useState, type FormEvent } from "react";
import { perspectiveOf, ROLES, type Role } from "@/api/roles";
import { FeedbackCard, FeedbackFields, SMALL_BTN } from "@/features/synpunkter/components";
import { useNav } from "@/shell/nav";
import { resolveRoute, titleOf, type RouteDef } from "@/shell/routes";
import { useSession } from "@/shell/session";
import { Button } from "@/ui/button";
import { Drawer } from "@/ui/dialog";
import { useCopy } from "@/ui/download";
import { Empty, Notice } from "@/ui/feedback";
import { Field, Seg } from "@/ui/form";
import { Divider } from "@/ui/layout";
import { Tabs, TabPanel } from "@/ui/tabs";
import { toast } from "@/ui/toast";
import { useGoAs } from "./demo-nav";
import {
  addFeedback,
  asMarkdown,
  closeFeedback,
  fmtWhen,
  nameOf,
  openFeedback,
  prioLabel,
  removeFeedback,
  replyFeedback,
  setDrawerTab,
  setFeedbackStatus,
  typeLabel,
  useDrawer,
  useFeedback,
  watchReplies,
  type FeedbackItem,
} from "./feedback-store";
import { fullPath, isKnownView, pathForView, viewForPath } from "./paths";
import { DEMO_VERSION, demoRole, perspectiveDef } from "./roles";
import { scenarioById } from "./scenarios";
import { useScenarioState } from "./scenario-store";
import { getCapability } from "./claude-runtime";

/** Sidan som visas just nu: vy-id (den gamla prototypens, för filtret "Den här vyn"), titel, parametrar och sökväg. */
export function useCurrentView(routes: readonly RouteDef[]) {
  const nav = useNav();
  const match = resolveRoute(routes, nav.path);
  const { view, params } = viewForPath(nav.path);
  return {
    viewId: view,
    viewTitle: match ? titleOf(match, nav.query) : "Sidan finns inte",
    viewParams: { ...params, ...Object.fromEntries(nav.query) } as Record<string, unknown>,
    path: fullPath(nav.path, nav.query),
  };
}

// ---------------------------------------------------------------- En feedbackpunkt
/** Sökvägen som "Gå till vyn" öppnar: ny feedback har `path`, äldre feedback vy-id och parametrar. */
const targetOf = (it: FeedbackItem): string | null => it.path || (isKnownView(it.viewId) ? pathForView(it.viewId as string, it.viewParams ?? {}) : null);

export function FeedbackItemCard({ it }: { it: FeedbackItem }) {
  const f = useFeedback();
  const session = useSession();
  const goAs = useGoAs();
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => (open ? watchReplies(it.id) : undefined), [open, it.id]);
  const replies = f.mode === "shared" ? (f.replies[it.id] ?? []) : (it.localReplies ?? []);
  const target = targetOf(it);
  const replyCount = it.replyCount || (it.localReplies ?? []).length;
  const role: Role = it.role && (ROLES as readonly string[]).includes(it.role) ? it.role : session.actor.role;
  return (
    <FeedbackCard
      id={it.id}
      type={it.type}
      priority={it.priority}
      status={it.status}
      text={it.text}
      perspective={it.perspective}
      perspectiveLabel={it.perspectiveLabel}
      byline={`${nameOf(f, it.authorId)} · ${fmtWhen(it.createdAt)}`}
      context={`${it.roleLabel ? `${it.roleLabel} · ` : ""}${it.viewTitle || "Hela prototypen"}${it.scenarioTitle ? ` · Scenario: ${it.scenarioTitle}` : ""}`}
      onStatusChange={(v) => void setFeedbackStatus(it.id, v)}
      goTo={
        target
          ? {
              label: "Gå till vyn",
              onClick: () => {
                closeFeedback();
                goAs(role, target);
              },
            }
          : null
      }
      replies={replies.map((r) => ({ id: r.id, byline: `${nameOf(f, r.authorId)} · ${fmtWhen(r.createdAt)}`, text: r.text }))}
      replyCount={replyCount}
      onReply={(text) => replyFeedback(it.id, text)}
      repliesOpen={open}
      onRepliesOpenChange={setOpen}
      extraActions={
        (it.authorId === f.myId || f.mode !== "shared") &&
        (confirmDel ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-small">Ta bort?</span>
            <Button kind="danger" className={SMALL_BTN} onClick={() => void removeFeedback(it.id)}>
              Ja, ta bort
            </Button>
            <Button kind="ghost" className={SMALL_BTN} onClick={() => setConfirmDel(false)}>
              Avbryt
            </Button>
          </span>
        ) : (
          <Button kind="ghost" icon="trash" className={SMALL_BTN} ariaLabel="Ta bort" onClick={() => setConfirmDel(true)} />
        ))
      }
    />
  );
}

// ---------------------------------------------------------------- Feedbackknappen nere till höger
export function FeedbackFab() {
  return (
    <Button
      kind="primary"
      icon="message-circle"
      ariaLabel="Lämna feedback"
      data-print="hide"
      onClick={() => openFeedback()}
      className="fixed right-[18px] bottom-[calc(18px+env(safe-area-inset-bottom,0px))] z-60 shadow-pop max-[900px]:rounded-full max-[900px]:p-2.5"
    >
      <span className="max-[900px]:hidden">Feedback</span>
    </Button>
  );
}

// ---------------------------------------------------------------- Feedbacklådan
type Scope = "view" | "scenario" | "all";
type Filter = "alla" | "nya" | "oppna" | "leverantor" | "kund" | "vy";

export function FeedbackDrawer({ routes }: { routes: readonly RouteDef[] }) {
  const dr = useDrawer();
  const f = useFeedback();
  const scen = useScenarioState();
  const session = useSession();
  const nav = useNav();
  const copy = useCopy();
  const cur = useCurrentView(routes);
  // Utkastet (typ, prioritet, text) finns kvar om lådan stängs utan att spara – som i den gamla prototypen.
  const [type, setType] = useState("forbattring");
  const [prio, setPrio] = useState("bor");
  const [text, setText] = useState("");
  const [scope, setScope] = useState<Scope>("view");
  const [filter, setFilter] = useState<Filter>("alla");
  const [sent, setSent] = useState<"local" | "shared" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Varje gång lådan öppnas: nollställ kvittens och fel, och välj "Scenariot" om lådan öppnades från scenariofältet.
  const [openedSeq, setOpenedSeq] = useState(dr.seq);
  if (dr.open && openedSeq !== dr.seq) {
    setOpenedSeq(dr.seq);
    setSent(null);
    setErr(null);
    setScope(dr.preset.scenarioId ? "scenario" : "view");
  }
  // Fokus: textfältet (Lämna feedback) eller den valda fliken (All feedback).
  useEffect(() => {
    if (!dr.open) return;
    const t = setTimeout(() => {
      const el = document.getElementById("fb-text") ?? document.querySelector<HTMLElement>("#fb-tabs [role=tab][aria-selected=true]");
      el?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [dr.open, dr.seq]);

  if (!dr.open) return null;
  const role = session.actor.role;
  const roleLabel = demoRole(role).label;
  const persp = perspectiveOf(role);
  const pDef = perspectiveDef(role);
  const scenDef = scenarioById(dr.preset.scenarioId || scen.active);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!text.trim()) {
      setErr("Skriv vad du tycker innan du sparar.");
      return;
    }
    const whole = scope === "all";
    const res = await addFeedback({
      type,
      priority: prio,
      text: text.trim(),
      role,
      roleLabel,
      perspective: persp,
      perspectiveLabel: pDef.label,
      viewId: whole ? null : cur.viewId,
      viewTitle: whole ? null : cur.viewTitle,
      viewParams: whole ? null : cur.viewParams,
      path: whole ? null : cur.path,
      scenarioId: scope === "scenario" && scenDef ? scenDef.id : null,
      scenarioTitle: scope === "scenario" && scenDef ? scenDef.title : null,
      prototypeVersion: DEMO_VERSION,
    });
    if (res.ok) {
      setText("");
      setSent(res.local ? "local" : "shared");
    } else
      setErr(
        res.code === "no_write"
          ? "Du har bara läsbehörighet till den här prototypen, så feedbacken kunde inte sparas. Be den som delade länken att bjuda in dig via e-post med behörigheten Redigerare (Editor). Du kan också kopiera texten nedan."
          : res.code === "quota"
            ? "Databasen är full. Säg till den som delade länken."
            : "Feedbacken kunde inte sparas just nu. Försök igen om en stund.",
      );
  };

  const items = f.items.filter(
    (x) =>
      filter === "alla" ||
      (filter === "vy" && x.viewId === cur.viewId) ||
      (filter === "nya" && x.status === "ny") ||
      (filter === "kund" && x.perspective === "kund") ||
      (filter === "leverantor" && x.perspective === "leverantor") ||
      (filter === "oppna" && !["klar", "avfardad"].includes(x.status)),
  );
  const counts = { alla: f.items.length, nya: f.items.filter((x) => x.status === "ny").length };

  const tryComments = async () => {
    try {
      const c = await getCapability("comments");
      if (!c) {
        toast("Kommentarer är inte tillgängliga här.", "error");
        return;
      }
      const el = document.getElementById("main");
      if (!el) return;
      const r = await c.openComposer({ element: el });
      if (!r.opened) toast("Klicka i prototypen först och försök igen.", "error");
    } catch {
      toast("Kommentarer är inte tillgängliga här.", "error");
    }
  };

  return (
    <Drawer title="Feedback" onClose={closeFeedback}>
      {/* Flikarna ligger kvar överst när innehållet rullas (som i den gamla prototypen). */}
      <div className="sticky -top-4 z-10 -mx-[18px] -mt-4 bg-vit px-[18px]">
        <Tabs
          id="fb-tabs"
          ariaLabel="Feedback"
          active={dr.tab}
          onChange={setDrawerTab}
          tabs={[
            { id: "ny", label: "Lämna feedback", icon: "edit" },
            { id: "lista", label: "All feedback", count: counts.alla, icon: "list" },
          ]}
        />
      </div>
      <TabPanel tabsId="fb-tabs" active={dr.tab} className="flex flex-col gap-4">
        {f.mode === "local" && (
          <Notice tone="warn" title="Sparas bara i din webbläsare">
            Den delade feedbackloggen är inte tillgänglig här. Öppna länken i claude.ai för att dela feedbacken, eller kopiera listan.
          </Notice>
        )}
        {f.mode === "shared" && f.canWrite === false && (
          <Notice tone="warn" title="Du kan läsa men inte skriva">
            Be den som delade länken att bjuda in dig via e-post med behörigheten Redigerare (Editor). Tills dess kan du kommentera med knappen längst ned.
          </Notice>
        )}
        {dr.tab === "ny" ? (
          <>
            <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
              <Notice tone="info" icon="map-pin" title={pDef.long} className="text-[0.9375rem]">
                {roleLabel} · {cur.viewTitle}
              </Notice>
              <Field label="Gäller" id="fb-scope">
                <Seg<Scope>
                  id="fb-scope"
                  value={scope}
                  onValueChange={setScope}
                  options={[
                    { value: "view", label: "Den här vyn" },
                    ...(scenDef ? [{ value: "scenario" as const, label: `Scenariot: ${scenDef.title}` }] : []),
                    { value: "all", label: "Hela prototypen" },
                  ]}
                />
              </Field>
              <FeedbackFields idPrefix="fb" type={type} onTypeChange={setType} priority={prio} onPriorityChange={setPrio} text={text} onTextChange={setText} error={err} />
              <div className="flex flex-wrap items-center gap-3">
                <Button kind="primary" type="submit" icon="send">
                  Spara feedback
                </Button>
                {err && text && (
                  <Button kind="ghost" icon="copy" onClick={() => void copy(`${typeLabel(type)} · ${prioLabel(prio)} · ${roleLabel} · ${cur.viewTitle}\n${text}`)}>
                    Kopiera texten
                  </Button>
                )}
              </div>
              {sent && (
                <Notice tone="ok" title="Tack! Feedbacken är sparad.">
                  {sent === "shared" ? "Alla som har länken ser den under All feedback, och vi går igenom den tillsammans." : "Den sparas i din webbläsare."}{" "}
                  <Button kind="ghost" className={SMALL_BTN} onClick={() => setDrawerTab("lista")}>
                    Visa all feedback
                  </Button>
                </Notice>
              )}
            </form>
            <Divider />
            <div className="flex flex-col gap-2">
              <div className="text-small text-text-muted">Vill du hellre peka på en exakt plats på sidan?</div>
              <div>
                <Button icon="message-circle" onClick={() => void tryComments()}>
                  Kommentera i marginalen
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="sr-only" htmlFor="fb-filter">
                Filter
              </label>
              <select id="fb-filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-auto flex-1">
                <option value="alla">Alla ({counts.alla})</option>
                <option value="nya">Nya ({counts.nya})</option>
                <option value="oppna">Inte klara</option>
                <option value="leverantor">Leverantörens perspektiv</option>
                <option value="kund">Kundens perspektiv</option>
                <option value="vy">Den här vyn</option>
              </select>
              <Button icon="copy" disabled={!items.length} onClick={() => void copy(asMarkdown(f, items))}>
                Kopiera lista
              </Button>
            </div>
            <div>
              <Button
                kind="ghost"
                icon="external"
                className={SMALL_BTN}
                onClick={() => {
                  closeFeedback();
                  nav.push("/om/genomgang");
                }}
              >
                Öppna som helsida för genomgång
              </Button>
            </div>
            {f.mode === "loading" && <div className="text-text-muted">Hämtar feedback …</div>}
            {items.length === 0 && f.mode !== "loading" && (
              <Empty icon="message-circle" title="Ingen feedback här ännu">
                Välj Lämna feedback för att skriva den första. Den hamnar här för alla som har länken.
              </Empty>
            )}
            {items.map((it) => (
              <FeedbackItemCard key={it.id} it={it} />
            ))}
          </>
        )}
      </TabPanel>
    </Drawer>
  );
}
