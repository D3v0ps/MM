"use client";
// Toasts – korta kvittenser efter en åtgärd ("Avropet är accepterat."). Läses upp för skärmläsare (role=status).
// Tillståndet ligger på modulnivå så att toasten syns även när layouten byts (t.ex. efter rollbyte i prototypen).
//
// UX-genomgången (paket 1, Ö2): högst två åt gången – en ny ersätter den äldsta – och en stängknapp på varje. De ligger
// överst (uppe till höger på dator, under den fasta toppraden på smal skärm), så att de aldrig täcker dialogernas knappar
// eller en fast knapprad längst ned (mötet, månadsbedömningen).
import { useSyncExternalStore } from "react";
import { useAreaAttr } from "./area";
import { cn } from "./cn";
import { Icon } from "./icons";

export type ToastTone = "ok" | "error";
type ToastItem = { id: number; text: string; tone: ToastTone };

/** Högst så många kvittenser visas samtidigt – en ny ersätter den äldsta. */
export const TOAST_MAX = 2;
/** Så länge en kvittens visas (ms). */
export const TOAST_MS = 5200;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const EMPTY: ToastItem[] = [];

const remove = (id: number) => {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
};

/** Visa en toast i 5,2 sekunder. tone: ok (blå kant, standard) eller error (röd kant). Högst två åt gången. */
export function toast(text: string, tone: ToastTone = "ok"): void {
  const id = ++seq;
  items = [...items, { id, text, tone }].slice(-TOAST_MAX);
  emit();
  setTimeout(() => remove(id), TOAST_MS);
}

/** Hook-variant för skärmar: const toast = useToast(); toast("Sparat."). */
export const useToast = () => toast;

function subscribe(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** Visar toasts. Ligger i layouten – skärmar behöver inte rendera den. */
export function Toaster() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
  const areaAttr = useAreaAttr();
  return (
    <div
      {...areaAttr}
      role="status"
      aria-live="polite"
      data-print="hide"
      className={cn(
        // Ytan själv tar inga klick (den ligger över sidan) – bara kvittenserna gör det.
        "pointer-events-none fixed z-90 flex flex-col gap-2",
        "top-4 right-4 w-[min(420px,calc(100%-32px))]",
        "max-[900px]:top-[calc(var(--mm-sticky-top)+8px)] max-[900px]:right-4 max-[900px]:left-4 max-[900px]:w-auto",
      )}
    >
      {list.map((t) => (
        <div
          key={t.id}
          data-toast=""
          className={cn(
            "pointer-events-auto flex animate-toast-in items-start gap-2.5 rounded-mb border-l-[6px] bg-antracit py-1 pr-1 pl-4 text-ui text-vit shadow-pop [--mm-focus:var(--color-vit)] portal:text-portal",
            t.tone === "error" ? "border-rod" : "border-bla",
          )}
        >
          <Icon name={t.tone === "error" ? "alert-circle" : "check-circle"} className="mt-3 flex-none" />
          <span className="min-w-0 flex-1 py-2.5">{t.text}</span>
          <button
            type="button"
            aria-label="Stäng kvittensen"
            title="Stäng"
            onClick={() => remove(t.id)}
            className="grid size-11 flex-none cursor-pointer place-items-center rounded-mb border-0 bg-transparent text-vit hover:bg-vit/10"
          >
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}
