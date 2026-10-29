"use client";
// Osparad inmatning – samma i appen och prototypen:
//   useUnsavedGuard(dirty, text?, { trySave }) – frågar innan appen byter till en annan sida (menyn, länkar, knappar) och
//     låter webbläsaren varna vid omladdning eller stängning. Med trySave (automatisk utkastsparning) sparas först, och
//     frågan visas bara när det inte gick. Webbläsarens Tillbaka kan inte stoppas – därför finns useDraft.
//   useDraft(key, initial) – utkastminne i minnet (aldrig i webblagring eller adressen): kommer man tillbaka till sidan
//     visas texten igen. Nyckeln är användare + skärm + ärende. Rensas när det sparats, godkänts eller avbrutits.
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog } from "@/ui/dialog";
import { isLeavingDocument, LEAVE_DOCUMENT, onBeforeNavigate, useNav } from "./nav";
import { useSession } from "./session";

export const UNSAVED_TITLE = "Du har inte sparat";
export const UNSAVED_TEXT = "Det du har skrivit sparas inte om du lämnar sidan.";

/** Sökvägen i en intern adress ('/arenden/x?flik=y' → '/arenden/x'). */
export function pathOf(to: string): string {
  const p = to.split("#")[0].split("?")[0];
  return p || "/";
}

/** Frågan när man lämnar en sida med osparad text. true = lämna. */
export function confirmLeave(message?: string): Promise<boolean> {
  return confirmDialog({ title: UNSAVED_TITLE, body: message ?? UNSAVED_TEXT, confirmLabel: "Lämna sidan", cancelLabel: "Stanna kvar", tone: "danger" });
}

/** Satt medan appen lämnar sidan med användarens godkännande (t.ex. Avbryt efter en egen fråga): vakterna frågar inte igen. */
let bypass = false;

/**
 * Navigera utan vaktens fråga – när skärmen redan har frågat (t.ex. "Avbryta beställningen?") eller utkastet har kastats.
 * Gäller navigeringen som startas i go().
 */
export function leaveWithoutAsking(go: () => void): void {
  bypass = true;
  try {
    go();
  } finally {
    // Vakterna körs i ett löfte – släpp spärren först efter dem.
    setTimeout(() => {
      bypass = false;
    }, 0);
  }
}

export type GuardOptions = {
  /** Körs innan frågan visas (t.ex. pausa en inspelning). */
  onAsk?: () => void;
  /** Körs när användaren väljer Stanna kvar (t.ex. fortsätt spela in). */
  onStay?: () => void;
  /**
   * Försök spara först (automatisk utkastsparning, src/shell/autosave.ts): true = allt är sparat, appen lämnar sidan utan
   * fråga. false eller fel = frågan visas som vanligt.
   */
  trySave?: () => Promise<boolean>;
};

/**
 * Fråga innan appen lämnar sidan när dirty är sant. Byte av bara query på samma sida (flik, filter) frågar inte – skärmen
 * ligger kvar. Omladdning och stängning ger webbläsarens egen varning. När appen själv laddar om (byte av testperson,
 * utloggning – confirmLeaveDocument i nav.tsx) frågar vakten först, och webbläsaren varnar sedan inte igen. Med trySave
 * sparas utkastet först, och frågan visas bara när det inte gick.
 */
export function useUnsavedGuard(dirty: boolean, message?: string, opts?: GuardOptions): void {
  const nav = useNav();
  const pathRef = useRef(nav.path);
  const optsRef = useRef(opts);
  useEffect(() => {
    pathRef.current = nav.path;
    optsRef.current = opts;
  });
  useEffect(() => {
    if (!dirty) return;
    const off = onBeforeNavigate(async (to) => {
      if (bypass || (to !== LEAVE_DOCUMENT && pathOf(to) === pathRef.current)) return true;
      const trySave = optsRef.current?.trySave;
      if (trySave && (await trySave().catch(() => false))) return true;
      optsRef.current?.onAsk?.();
      const leave = await confirmLeave(message);
      if (!leave) optsRef.current?.onStay?.();
      return leave;
    });
    const onUnload = (e: BeforeUnloadEvent) => {
      // Appen laddar om efter att användaren redan har svarat "Lämna sidan" (byte av testperson, utloggning).
      if (isLeavingDocument()) return;
      e.preventDefault();
      // Äldre webbläsare kräver returnValue för att visa varningen.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      off();
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty, message]);
}

// ---------------------------------------------------------------- Utkastminne
const drafts = new Map<string, unknown>();

/** Bara för tester: töm minnet. */
export function clearAllDrafts(): void {
  drafts.clear();
}

/**
 * Utkastminnet för den inloggade utan React-tillstånd: läsa ett värde och glömma nycklar – innan ett formulär läser sina utkast
 * (t.ex. när minnet är äldre än raden på servern). Nycklarna är samma som i useDraft.
 */
export function useDraftMemory(): {
  peek: (key: string) => { has: boolean; value: unknown };
  drop: (keys: readonly string[]) => void;
  put: (key: string, value: unknown) => void;
} {
  const { actor } = useSession();
  const k = (key: string) => `${actor.userId}|${key}`;
  return {
    peek: (key) => ({ has: drafts.has(k(key)), value: drafts.get(k(key)) }),
    drop: (keys) => {
      for (const key of keys) drafts.delete(k(key));
    },
    put: (key, value) => {
      drafts.set(k(key), value);
    },
  };
}

export type DraftMemory = ReturnType<typeof useDraftMemory>;

/**
 * Glöm ett formulärs utkastminne när det är äldre än raden på servern (versionen i minnet < serverVersion) och saknar osparade
 * ändringar. fields: fältens nycklar (med serverns värde – används inte i jämförelsen), i samma ordning som det sparade läget
 * (JSON-listan under saved); saved: nyckeln för det sparade läget; version: nyckeln för versionen; others: övriga nycklar som
 * glöms samtidigt. true = minnet glömdes.
 * Bara fälten som finns i minnet (som coachen har ändrat) kan ha osparade ändringar: de jämförs med sin plats i det sparade
 * läget. Ett fält som inte finns i minnet visar alltid serverns värde – att servern har ändrat det (t.ex. en förifylld
 * sammanfattning som skrevs om när närvaron rättades) är ingen osparad ändring. Går det sparade läget inte att läsa ligger
 * minnet kvar.
 */
export function dropStaleDraft(
  memory: Pick<DraftMemory, "peek" | "drop">,
  o: { fields: readonly (readonly [string, unknown])[]; saved: string; version: string; others?: readonly string[]; serverVersion: number | null },
): boolean {
  const v = memory.peek(o.version);
  if (!v.has || typeof v.value !== "number" || o.serverVersion == null || v.value >= o.serverVersion) return false;
  const saved = memory.peek(o.saved);
  if (saved.has) {
    const base = savedBaseline(saved.value, o.fields.length);
    if (!base) return false;
    const unsaved = o.fields.some(([key], i) => {
      const m = memory.peek(key);
      return m.has && JSON.stringify(m.value) !== JSON.stringify(base[i]);
    });
    if (unsaved) return false;
  }
  memory.drop([...o.fields.map(([key]) => key), o.saved, o.version, ...(o.others ?? [])]);
  return true;
}

/**
 * Lyft ett formulärs utkastminne (ett objekt med fälten under key) till raden på servern när minnet är äldre än raden (versionen
 * i minnet < serverVersion) – i stället för att behålla den gamla versionen, som ger "ändrats i en annan flik" vid nästa
 * sparning. Varje fält jämförs med det sparade läget som utkastet byggde på (JSON-objektet under saved): fält som bara servern
 * ändrat (t.ex. yrkesspåret som Byt yrkesområde tömde) tar serverns värde, fält som bara coachen ändrat behåller utkastets, och
 * orörda fält blir serverns. Har både servern och coachen ändrat samma fält, eller går det sparade läget inte att läsa, ligger
 * minnet kvar som det är (konflikten visas då vid sparningen – inget skrivs över). server: radens fält i formulärets ordning.
 * "rebased" = minnet lyftes (fält, sparat läge och version), "kept" = inget ändrades.
 */
export function rebaseStaleDraft(
  memory: Pick<DraftMemory, "peek" | "put">,
  o: { key: string; saved: string; version: string; server: Readonly<Record<string, unknown>>; serverVersion: number | null },
): "rebased" | "kept" {
  const v = memory.peek(o.version);
  if (!v.has || typeof v.value !== "number" || o.serverVersion == null || v.value >= o.serverVersion) return "kept";
  const draft = memory.peek(o.key);
  const saved = memory.peek(o.saved);
  // Utan fält i minnet finns inga osparade ändringar: bara sparat läge och version lyfts.
  const mine = draft.has ? (draft.value && typeof draft.value === "object" ? (draft.value as Record<string, unknown>) : undefined) : null;
  const base = saved.has ? savedObject(saved.value) : null;
  if (mine === undefined || (mine && !base)) return "kept";
  if (mine && base) {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const merged: Record<string, unknown> = {};
    for (const [field, theirs] of Object.entries(o.server)) {
      if (same(theirs, base[field])) merged[field] = mine[field];
      else if (same(mine[field], base[field])) merged[field] = theirs;
      else return "kept";
    }
    memory.put(o.key, merged);
  }
  memory.put(o.saved, JSON.stringify(o.server));
  memory.put(o.version, o.serverVersion);
  return "rebased";
}

/** Det sparade läget som objekt (JSON), eller null om det inte går att läsa. */
function savedObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Det sparade läget (JSON-listan med fältens värden), eller null om det inte går att läsa eller har fel antal fält. */
function savedBaseline(value: unknown, n: number): unknown[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === n ? parsed : null;
  } catch {
    return null;
  }
}

export type Draft<T> = {
  value: T;
  set: (next: T | ((prev: T) => T)) => void;
  /** Värdet kom från minnet när skärmen visades (visa "Ditt osparade utkast är återställt."). */
  restored: boolean;
  /** Glöm utkastet (efter sparat, godkänt eller avbrutet). Värdet på skärmen ändras inte. */
  clear: () => void;
};

/**
 * Tillstånd som överlever att skärmen lämnas (sidbyte, flikbyte, Tillbaka/Framåt) – bara i minnet, per användare. key =
 * skärm + ärende/post, t.ex. "avstamning|case-260174". null = vanligt tillstånd utan minne.
 */
export function useDraft<T>(key: string | null, initial: T | (() => T)): Draft<T> {
  const { actor } = useSession();
  const k = key ? `${actor.userId}|${key}` : null;
  const [state, setState] = useState<{ k: string | null; value: T; restored: boolean }>(() => {
    if (k && drafts.has(k)) return { k, value: drafts.get(k) as T, restored: true };
    return { k, value: typeof initial === "function" ? (initial as () => T)() : initial, restored: false };
  });
  // Ny nyckel (annat ärende i samma skärm): läs det ärendets utkast.
  let cur = state;
  if (state.k !== k) {
    cur = k && drafts.has(k) ? { k, value: drafts.get(k) as T, restored: true } : { k, value: typeof initial === "function" ? (initial as () => T)() : initial, restored: false };
    setState(cur);
  }
  // Senaste nyckel och värde för händelsehanterarna (flera set i samma klick bygger på varandra).
  const kRef = useRef(k);
  const valueRef = useRef(cur.value);
  useEffect(() => {
    kRef.current = k;
    valueRef.current = cur.value;
  });
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const value = typeof next === "function" ? (next as (p: T) => T)(valueRef.current) : next;
    valueRef.current = value;
    if (kRef.current) drafts.set(kRef.current, value);
    setState((s) => ({ ...s, value }));
  }, []);
  const clear = useCallback(() => {
    if (kRef.current) drafts.delete(kRef.current);
    setState((s) => ({ ...s, restored: false }));
  }, []);
  return { value: cur.value, set, restored: cur.restored, clear };
}
