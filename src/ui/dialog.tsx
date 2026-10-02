"use client";
// Dialoger (Radix Dialog: fokusfälla, Escape, fokus tillbaka när dialogen stängs).
// Modal – rendera villkorligt: {open && <Modal title="…" onClose={() => setOpen(false)}>…</Modal>}
//   dirty = det finns osparad text: Esc, klick utanför, krysset och Avbryt (useModalClose) frågar först.
// useConfirm() – bekräftelse som promise (ersätter prototypens MM.confirm; window.confirm används aldrig).
// useTextDialog() – visa text att kopiera (t.ex. när en fil inte kan sparas direkt).
// Fokus efter stängning: elementet som hade fokus när dialogen öppnades, annars senaste fokus utanför dialoger (t.ex. när
// en dialog byts mot en annan medan den laddar), annars returnFocusTo, annars sidans rubrik.
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { useAreaAttr } from "./area";
import { Button } from "./button";
import { cn } from "./cn";
import { DemoNote } from "./feedback";
import { useCopy } from "./download";

// ---------------------------------------------------------------- Fokus tillbaka
/** Senaste elementet utanför dialoger som hade fokus (lyssnaren installeras en gång). */
let lastOutside: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t !== document.body && !t.closest("[role=dialog], [role=alertdialog]")) lastOutside = t;
    },
    true,
  );
}

/** Ett element som kan ta emot fokus nu: finns kvar, syns och är inte inaktiverat. */
function focusable(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected || el === document.body) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  // checkVisibility finns i webbläsarna (inte i jsdom): dolda element (stängd meny, display:none) hoppas över.
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
}

/** Sidans rubrik (skalet gör den fokuserbar), annars #main. */
export function focusPageHeading(): void {
  const h1 = document.querySelector<HTMLElement>("#main h1[data-page-title]") ?? document.querySelector<HTMLElement>("#main h1");
  if (h1) {
    if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
  } else document.getElementById("main")?.focus({ preventScroll: true });
}

export type ReturnFocus = HTMLElement | null | (() => HTMLElement | null | undefined);

/** Dit fokus går när dialogen stängs (Radix gör det bara med Dialog.Trigger). */
function useReturnFocus(returnFocusTo?: ReturnFocus) {
  const [opener] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  return (e: Event) => {
    e.preventDefault();
    // Vänta en bildruta: knappen som öppnade dialogen kan ha bytts ut av samma klick (t.ex. Läst → borta).
    requestAnimationFrame(() => {
      // returnFocusTo går före när den anger ett element (t.ex. nästa flagga efter en kvittering).
      const fromProp = typeof returnFocusTo === "function" ? returnFocusTo() : returnFocusTo;
      const target = [fromProp, opener, lastOutside].find(focusable);
      if (target) target.focus();
      else focusPageHeading();
    });
  };
}

// ---------------------------------------------------------------- Osparad text i en dialog
const ModalCloseContext = createContext<(() => void) | null>(null);
const ModalDirtyContext = createContext<((key: object, dirty: boolean) => void) | null>(null);

/**
 * Ett fält längre ned i en Modal har osparad text (t.ex. en kommentar i en del av dialogen): dialogen frågar innan den
 * stängs, som med Modal dirty.
 */
export function useModalDirty(dirty: boolean): void {
  const report = useContext(ModalDirtyContext);
  const [key] = useState(() => ({}));
  useEffect(() => {
    report?.(key, dirty);
    return () => report?.(key, false);
  }, [report, key, dirty]);
}

/**
 * Stäng den omgivande Modal på samma sätt som krysset – med frågan om osparad text när dialogen är dirty. Använd för
 * Avbryt-knappar i sidfoten: <Button onClick={useModalClose()}>Avbryt</Button>.
 */
export function useModalClose(): () => void {
  const close = useContext(ModalCloseContext);
  return close ?? (() => undefined);
}

/** Avbryt-knapp för en Modals sidfot: stänger som krysset (frågar först när dialogen är dirty). */
export function ModalCancelButton({ children = "Avbryt" }: { children?: ReactNode }) {
  const close = useModalClose();
  return (
    <Button kind="ghost" onClick={close}>
      {children}
    </Button>
  );
}

/** Frågan innan osparad text slängs. true = släng. */
export function confirmDiscard(): Promise<boolean> {
  return confirmDialog({
    title: "Vill du slänga det du skrivit?",
    body: "Det du har skrivit i rutan sparas inte.",
    confirmLabel: "Släng",
    cancelLabel: "Fortsätt skriva",
    tone: "danger",
  });
}

export type ModalProps = {
  title: ReactNode;
  /** Stäng (Escape, klick utanför, krysset). Utan onClose går dialogen bara att stänga via knapparna i footer. */
  onClose?: () => void;
  /** Knappar längst ned (högerställda). */
  footer?: ReactNode;
  /** 920 px bred i stället för 640 px. */
  wide?: boolean;
  children?: ReactNode;
  className?: string;
  /** Det finns osparad text: Esc, klick utanför, krysset och useModalClose() frågar innan dialogen stängs. */
  dirty?: boolean;
  /**
   * Fokus efter stängning, före elementet som öppnade dialogen – när det anger ett element (null = som vanligt: elementet
   * som öppnade dialogen, annars sidans rubrik). T.ex. nästa rad när knappen man tryckte på försvinner.
   */
  returnFocusTo?: ReturnFocus;
};

/** Dialog i mitten av skärmen. Fokus hamnar i första fältet (eller första knappen), Escape stänger. */
export function Modal({ title, onClose, footer, wide, children, className, dirty, returnFocusTo }: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const areaAttr = useAreaAttr();
  const onCloseAutoFocus = useReturnFocus(returnFocusTo);
  const asking = useRef(false);
  const [dirtyParts, setDirtyParts] = useState<ReadonlySet<object>>(() => new Set());
  const reportDirty = useCallback((key: object, d: boolean) => {
    setDirtyParts((cur) => {
      if (cur.has(key) === d) return cur;
      const next = new Set(cur);
      if (d) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const requestClose = () => {
    if (!onClose) return;
    if (!dirty && dirtyParts.size === 0) {
      onClose();
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void confirmDiscard().then((ok) => {
      asking.current = false;
      if (ok) onClose();
    });
  };
  return (
    <ModalCloseContext.Provider value={requestClose}>
      <ModalDirtyContext.Provider value={reportDirty}>
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open) requestClose();
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-80 grid place-items-center overflow-y-auto bg-antracit/55 p-4" data-print="hide">
              <Dialog.Content
                {...areaAttr}
                ref={contentRef}
                aria-describedby={undefined}
                onEscapeKeyDown={(e) => {
                  if (!onClose) e.preventDefault();
                }}
                onPointerDownOutside={(e) => {
                  if (!onClose) e.preventDefault();
                }}
                onCloseAutoFocus={onCloseAutoFocus}
                onOpenAutoFocus={(e) => {
                  // Som prototypen: första fältet eller knappen (inte krysset) får fokus.
                  e.preventDefault();
                  const el = contentRef.current;
                  const first = el?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-modal-close])");
                  (first ?? el)?.focus();
                }}
                className={cn(
                  "flex max-h-[calc(100dvh-32px)] w-[min(640px,100%)] flex-col rounded-card bg-vit text-antracit shadow-pop outline-none portal:text-portal",
                  wide && "w-[min(920px,100%)]",
                  className,
                )}
              >
                <div className="flex items-center gap-3 border-b border-ljusgra px-5 py-4">
                  <Dialog.Title className="flex-1 text-h2 font-extrabold tracking-[0.03em] uppercase">{title}</Dialog.Title>
                  {onClose && (
                    <Dialog.Close asChild>
                      <Button kind="ghost" icon="x" ariaLabel="Stäng" title="Stäng" data-modal-close="" />
                    </Dialog.Close>
                  )}
                </div>
                <div className="flex flex-col gap-4 overflow-y-auto px-5 py-[18px]">{children}</div>
                {footer && <div className="flex flex-wrap justify-end gap-2.5 border-t border-ljusgra px-5 py-3.5">{footer}</div>}
              </Dialog.Content>
            </Dialog.Overlay>
          </Dialog.Portal>
        </Dialog.Root>
      </ModalDirtyContext.Provider>
    </ModalCloseContext.Provider>
  );
}

/** Låda från höger (t.ex. prototypens feedback). Samma beteende som Modal. */
export function Drawer({ title, onClose, children, actions, footer }: { title: ReactNode; onClose: () => void; children?: ReactNode; actions?: ReactNode; footer?: ReactNode }) {
  const areaAttr = useAreaAttr();
  const onCloseAutoFocus = useReturnFocus();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-70 bg-antracit/35" data-print="hide" />
        <Dialog.Content
          {...areaAttr}
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className="fixed top-0 right-0 bottom-0 z-71 flex w-[min(520px,100%)] flex-col bg-vit pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] text-antracit shadow-pop outline-none portal:text-portal"
        >
          <div className="flex items-center gap-2.5 border-b border-ljusgra px-[18px] py-3.5">
            <Dialog.Title className="flex-1 text-h3 font-extrabold tracking-[0.03em] uppercase">{title}</Dialog.Title>
            {actions}
            <Dialog.Close asChild>
              <Button kind="ghost" icon="x" ariaLabel="Stäng" title="Stäng" />
            </Dialog.Close>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[18px] py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2.5 border-t border-ljusgra px-[18px] py-3.5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------- Bekräftelse som promise
export type ConfirmOptions = {
  title?: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = röd ram på bekräftaknappen (riskabel åtgärd). */
  tone?: "danger";
};
type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let pending: Pending | null = null;
const confirmListeners = new Set<() => void>();
const emitConfirm = () => confirmListeners.forEach((f) => f());
const subscribeConfirm = (f: () => void) => {
  confirmListeners.add(f);
  return () => {
    confirmListeners.delete(f);
  };
};

/** Fråga användaren. Löses med true (bekräftat) eller false (avbrutet). */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (pending) pending.resolve(false);
    pending = { ...opts, resolve };
    emitConfirm();
  });
}
function closeConfirm(ok: boolean) {
  const cur = pending;
  pending = null;
  emitConfirm();
  cur?.resolve(ok);
}

/** const confirm = useConfirm(); if (await confirm({ title: "Avböj avropet?", body: "…", confirmLabel: "Avböj", tone: "danger" })) … */
export const useConfirm = () => confirmDialog;

/** Visar bekräftelsedialogen. Ligger i layouten. */
export function ConfirmHost() {
  const c = useSyncExternalStore(
    subscribeConfirm,
    () => pending,
    () => null,
  );
  if (!c) return null;
  return (
    <Modal
      title={c.title ?? "Bekräfta"}
      onClose={() => closeConfirm(false)}
      footer={
        <>
          <Button kind="ghost" onClick={() => closeConfirm(false)}>
            {c.cancelLabel ?? "Avbryt"}
          </Button>
          <Button kind={c.tone === "danger" ? "danger" : "primary"} onClick={() => closeConfirm(true)}>
            {c.confirmLabel ?? "Bekräfta"}
          </Button>
        </>
      }
    >
      {c.body}
    </Modal>
  );
}

// ---------------------------------------------------------------- Text att kopiera
type TextView = { title: string; text: string; note?: ReactNode };
let textView: TextView | null = null;
const textListeners = new Set<() => void>();
const emitText = () => textListeners.forEach((f) => f());
const subscribeText = (f: () => void) => {
  textListeners.add(f);
  return () => {
    textListeners.delete(f);
  };
};

/** Visa en text i en dialog med knappen Kopiera. note = förklaring överst (visas bara i prototypen). */
export function showText(view: TextView): void {
  textView = view;
  emitText();
}
export const useTextDialog = () => showText;

/** Visar textdialogen. Ligger i layouten. */
export function TextDialogHost() {
  const v = useSyncExternalStore(
    subscribeText,
    () => textView,
    () => null,
  );
  const copy = useCopy();
  if (!v) return null;
  const close = () => {
    textView = null;
    emitText();
  };
  return (
    <Modal
      wide
      title={v.title}
      onClose={close}
      footer={
        <>
          <Button kind="primary" icon="copy" onClick={() => void copy(v.text)}>
            Kopiera
          </Button>
          <Button onClick={close}>Stäng</Button>
        </>
      }
    >
      {v.note && <DemoNote>{v.note}</DemoNote>}
      <label className="sr-only" htmlFor="text-dialog-area">
        Innehåll
      </label>
      <textarea id="text-dialog-area" rows={14} readOnly value={v.text} className="font-mono text-meta" />
    </Modal>
  );
}
