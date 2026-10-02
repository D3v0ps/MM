"use client";
// Osparad inmatning – samma i appen och prototypen:
//   useUnsavedGuard(dirty) – frågar innan appen byter till en annan sida (menyn, länkar, knappar) och låter webbläsaren
//     varna vid omladdning eller stängning. Webbläsarens Tillbaka kan inte stoppas – därför finns useDraft.
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
};

/**
 * Fråga innan appen lämnar sidan när dirty är sant. Byte av bara query på samma sida (flik, filter) frågar inte – skärmen
 * ligger kvar. Omladdning och stängning ger webbläsarens egen varning. När appen själv laddar om (byte av testperson,
 * utloggning – confirmLeaveDocument i nav.tsx) frågar vakten först, och webbläsaren varnar sedan inte igen.
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
