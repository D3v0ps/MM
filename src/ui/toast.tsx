"use client";
// Toasts – korta kvittenser efter en åtgärd ("Avropet är accepterat."). Läses upp för skärmläsare (role=status).
// Tillståndet ligger på modulnivå så att toasten syns även när layouten byts (t.ex. efter rollbyte i prototypen).
import { useSyncExternalStore } from "react";
import { useAreaAttr } from "./area";
import { cn } from "./cn";
import { Icon } from "./icons";

export type ToastTone = "ok" | "error";
type ToastItem = { id: number; text: string; tone: ToastTone };

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const EMPTY: ToastItem[] = [];

/** Visa en toast i 5,2 sekunder. tone: ok (blå kant, standard) eller error (röd kant). */
export function toast(text: string, tone: ToastTone = "ok"): void {
  const id = ++seq;
  items = [...items, { id, text, tone }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 5200);
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
      className="fixed bottom-[calc(20px+env(safe-area-inset-bottom,0px))] left-1/2 z-90 flex w-[min(520px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex animate-toast-in items-start gap-2.5 rounded-mb border-l-[6px] bg-antracit px-4 py-3 text-ui text-vit shadow-pop portal:text-portal",
            t.tone === "error" ? "border-rod" : "border-bla",
          )}
        >
          <Icon name={t.tone === "error" ? "alert-circle" : "check-circle"} className="mt-0.5" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
