// Feedback på prototypen – port av den gamla prototypens feedbacklager (prototyp/src/90-feedback.js, MM.fb).
// Samma datamodell och samma samlingar i artefaktens delade databas, så att feedback som redan lämnats finns kvar:
//   feedback/{id}                 en punkt (typ, prioritet, text, status, roll, perspektiv, vy …)
//   feedback/{id}/replies/{id}    svar
//   progress/{användar-id}        testade scenariosteg ({ done: { "s1:0": true }, updatedAt })
// Utan window.claude (t.ex. öppnad som fil) sparas feedbacken bara i webbläsaren.
// Ny feedback får också fältet `path` (sökvägen i den nya prototypen); vy-id i `viewId` är den gamla prototypens.
// Typer, prioriteter, statusar och etiketter delas med testmiljöns "Lämna synpunkt" (src/features/synpunkter/model.ts).
import { useSyncExternalStore } from "react";
import type { Role } from "@/api/roles";
import { FB_PRIOS, FB_STATUSES, FB_TYPES, prioLabel, statusLabel, typeIcon, typeLabel } from "@/features/synpunkter/model";
import { toast } from "@/ui/toast";
import { getCapability, type ClaudeDb, type ClaudeUser, type Unsubscribe } from "./claude-runtime";

export { FB_PRIOS, FB_STATUSES, FB_TYPES, prioLabel, statusLabel, typeIcon, typeLabel };

const LS_FB = "miljonmatch-prototyp-feedback-lokal";
const LS_PROG = "miljonmatch-prototyp-scenarier";

export type FeedbackReply = { id: string; text: string; createdAt: string; authorId: string | null };
export type FeedbackItem = {
  id: string;
  type: string;
  priority: string;
  text: string;
  status: string;
  createdAt: string;
  authorId: string | null;
  replyCount?: number;
  lastReplyAt?: string;
  role?: Role | null;
  roleLabel?: string | null;
  perspective?: string | null;
  perspectiveLabel?: string | null;
  viewId?: string | null;
  viewTitle?: string | null;
  viewParams?: Record<string, unknown> | null;
  /** Nytt i v2: sökvägen (med query) i prototypen. */
  path?: string | null;
  scenarioId?: string | null;
  scenarioTitle?: string | null;
  prototypeVersion?: string;
  /** Bara lokalt läge: svaren ligger på punkten. */
  localReplies?: FeedbackReply[];
};
export type NewFeedback = Omit<FeedbackItem, "id" | "status" | "createdAt" | "authorId" | "replyCount">;

export type FeedbackState = {
  mode: "loading" | "local" | "shared";
  myId: string | null;
  items: FeedbackItem[];
  replies: Record<string, FeedbackReply[]>;
  profiles: Record<string, { name: string }>;
  /** Testade scenariosteg: "s1:0" -> true. */
  progress: Record<string, boolean>;
  allProgress: { id: string; done?: Record<string, boolean> }[];
  /** null = plattformen har inte sagt något om skrivbehörighet. */
  canWrite: boolean | null;
  error: string | null;
};

// ---------------------------------------------------------------- Tillstånd (modulnivå, överlever rollbyten)
let state: FeedbackState = { mode: "loading", myId: null, items: [], replies: {}, profiles: {}, progress: {}, allProgress: [], canWrite: null, error: null };
let db: ClaudeDb | null = null;
let user: ClaudeUser | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<FeedbackState>) => {
  state = { ...state, ...patch };
  listeners.forEach((f) => f());
};

const lsGet = <T,>(k: string, def: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
};
const lsSet = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* privat läge */
  }
};
const nowIso = () => new Date().toISOString();

export function useFeedback(): FeedbackState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => state,
    () => state,
  );
}
export const feedbackState = () => state;

/** Namn på den som skrev: "Du", testarens namn i claude.ai eller "En testare". Namnen sparas aldrig – bara id:n. */
export function nameOf(s: FeedbackState, id: string | null | undefined): string {
  if (!id) return "Okänd";
  if (id === s.myId) return "Du";
  return s.profiles[id]?.name || "En testare";
}

async function resolveNames() {
  if (!user) return;
  const ids = [
    ...new Set([...state.items.map((x) => x.authorId), ...Object.values(state.replies).flat().map((x) => x.authorId), ...state.allProgress.map((x) => x.id)].filter((x): x is string => !!x)),
  ];
  if (!ids.length) return;
  try {
    set({ profiles: await user.profiles(ids) });
  } catch {
    /* namnen är valfria */
  }
}

let started = false;
/** Starta feedbacken en gång (delad databas i claude.ai, annars lokalt). */
export async function initFeedback(): Promise<void> {
  if (started) return;
  started = true;
  set({ progress: lsGet<Record<string, boolean>>(LS_PROG, {}) });
  const [d, u] = await Promise.all([getCapability("db"), getCapability("user")]);
  user = u;
  if (!d) {
    set({ mode: "local", items: lsGet<FeedbackItem[]>(LS_FB, []) });
    return;
  }
  db = d;
  let myId: string | null = null;
  let canWrite: boolean | null = null;
  try {
    myId = u ? await u.id() : null;
  } catch {
    myId = null;
  }
  try {
    canWrite = u ? await u.can("data.write") : null;
  } catch {
    canWrite = null;
  }
  set({ mode: "shared", myId, canWrite });
  d.collection("feedback")
    .orderBy("createdAt", "desc")
    .limit(500)
    .onSnapshot(
      (snap) => {
        set({ items: snap.docs.map((x) => ({ id: x.id, ...(x.data() ?? {}) }) as FeedbackItem), error: null });
        void resolveNames();
      },
      (err) => set({ error: err.code }),
    );
  d.collection("progress").onSnapshot(
    (snap) => {
      const allProgress = snap.docs.map((x) => ({ id: x.id, ...(x.data() ?? {}) }) as FeedbackState["allProgress"][number]);
      const mine = allProgress.find((x) => x.id === state.myId);
      set({ allProgress, progress: mine?.done ? { ...mine.done, ...state.progress } : state.progress });
      void resolveNames();
    },
    () => {
      /* läsning av framsteg är valfri */
    },
  );
}

export type AddResult = { ok: true; local?: boolean } | { ok: false; code: string };

export async function addFeedback(entry: NewFeedback): Promise<AddResult> {
  const doc = { ...entry, status: "ny", createdAt: nowIso(), authorId: state.myId || null, replyCount: 0 };
  if (state.mode !== "shared" || !db) {
    const it = { id: `lokal-${Date.now()}`, ...doc } as FeedbackItem;
    const items = [it, ...state.items];
    lsSet(LS_FB, items);
    set({ items });
    return { ok: true, local: true };
  }
  try {
    await db.collection("feedback").add(JSON.parse(JSON.stringify(doc)) as Record<string, unknown>);
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "invalid_argument") {
      set({ canWrite: false });
      return { ok: false, code: "no_write" };
    }
    if (code === "quota_exceeded") return { ok: false, code: "quota" };
    return { ok: false, code: code || "unknown" };
  }
}

export async function setFeedbackStatus(id: string, status: string): Promise<void> {
  if (state.mode !== "shared" || !db) {
    const items = state.items.map((x) => (x.id === id ? { ...x, status } : x));
    lsSet(LS_FB, items);
    set({ items });
    return;
  }
  try {
    await db.doc(`feedback/${id}`).update({ status, statusChangedAt: nowIso(), statusChangedBy: state.myId || null });
  } catch {
    toast("Kunde inte ändra status. Du kanske bara har läsbehörighet.", "error");
  }
}

export async function removeFeedback(id: string): Promise<void> {
  if (state.mode !== "shared" || !db) {
    const items = state.items.filter((x) => x.id !== id);
    lsSet(LS_FB, items);
    set({ items });
    return;
  }
  try {
    await db.doc(`feedback/${id}`).delete();
  } catch {
    toast("Kunde inte ta bort.", "error");
  }
}

const replySubs = new Map<string, { n: number; stop: Unsubscribe }>();
/** Prenumerera på svaren till en punkt (delat läge). Returnerar avslut. */
export function watchReplies(id: string): () => void {
  if (state.mode !== "shared" || !db) return () => {};
  const cur = replySubs.get(id);
  if (cur) cur.n++;
  else {
    const stop = db
      .collection(`feedback/${id}/replies`)
      .orderBy("createdAt")
      .limit(100)
      .onSnapshot(
        (snap) => {
          set({ replies: { ...state.replies, [id]: snap.docs.map((x) => ({ id: x.id, ...(x.data() ?? {}) }) as FeedbackReply) } });
          void resolveNames();
        },
        () => {},
      );
    replySubs.set(id, { n: 1, stop });
  }
  return () => {
    const s = replySubs.get(id);
    if (!s) return;
    s.n--;
    if (s.n <= 0) {
      s.stop();
      replySubs.delete(id);
    }
  };
}

export async function replyFeedback(id: string, text: string): Promise<boolean> {
  if (state.mode !== "shared" || !db) {
    const items = state.items.map((x) => (x.id === id ? { ...x, localReplies: [...(x.localReplies ?? []), { id: `r${Date.now()}`, text, createdAt: nowIso(), authorId: null }] } : x));
    lsSet(LS_FB, items);
    set({ items });
    return true;
  }
  try {
    await db.collection(`feedback/${id}/replies`).add({ text, createdAt: nowIso(), authorId: state.myId || null });
    const cur = state.items.find((x) => x.id === id);
    await db.doc(`feedback/${id}`).update({ replyCount: (cur?.replyCount || 0) + 1, lastReplyAt: nowIso() });
    return true;
  } catch {
    toast("Svaret kunde inte sparas.", "error");
    return false;
  }
}

/** Markera ett scenariosteg som testat (sparas i webbläsaren och, i claude.ai, under progress/{id}). */
export async function markStep(scenarioId: string, stepIdx: number, done: boolean): Promise<void> {
  const key = `${scenarioId}:${stepIdx}`;
  const progress = { ...state.progress, [key]: done };
  if (!done) delete progress[key];
  lsSet(LS_PROG, progress);
  set({ progress });
  if (state.mode === "shared" && db && state.myId) {
    try {
      await db.doc(`progress/${state.myId}`).set({ done: progress, updatedAt: nowIso() });
    } catch {
      /* valfritt */
    }
  }
}

/** Listan som text (för mötet). */
export function asMarkdown(s: FeedbackState, items: FeedbackItem[]): string {
  return items
    .map(
      (x) =>
        `- [${statusLabel(x.status)}] ${typeLabel(x.type)} · ${prioLabel(x.priority)} · ${x.perspectiveLabel || ""} · ${x.viewTitle || "Hela prototypen"}${x.scenarioTitle ? ` · Scenario: ${x.scenarioTitle}` : ""}\n  ${String(x.text || "").replace(/\n/g, "\n  ")} (${nameOf(s, x.authorId)}, ${new Date(x.createdAt).toLocaleDateString("sv-SE")})`,
    )
    .join("\n");
}

export const fmtWhen = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

// ---------------------------------------------------------------- Feedbacklådan (öppen/stängd, flik, förval)
export type DrawerState = { open: boolean; tab: "ny" | "lista"; preset: { scenarioId?: string; tab?: "ny" | "lista" }; seq: number };
let drawer: DrawerState = { open: false, tab: "ny", preset: {}, seq: 0 };
const drawerListeners = new Set<() => void>();
const setDrawer = (patch: Partial<DrawerState>) => {
  drawer = { ...drawer, ...patch };
  drawerListeners.forEach((f) => f());
};
export const openFeedback = (preset: DrawerState["preset"] = {}) => setDrawer({ open: true, tab: preset.tab ?? "ny", preset, seq: drawer.seq + 1 });
export const closeFeedback = () => setDrawer({ open: false });
export const setDrawerTab = (tab: DrawerState["tab"]) => setDrawer({ tab });
export function useDrawer(): DrawerState {
  return useSyncExternalStore(
    (f) => {
      drawerListeners.add(f);
      return () => {
        drawerListeners.delete(f);
      };
    },
    () => drawer,
    () => drawer,
  );
}
