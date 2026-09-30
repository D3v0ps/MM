"use client";
// Dialoger (Radix Dialog: fokusfälla, Escape, fokus tillbaka när dialogen stängs).
// Modal – rendera villkorligt: {open && <Modal title="…" onClose={() => setOpen(false)}>…</Modal>}
// useConfirm() – bekräftelse som promise (ersätter prototypens MM.confirm; window.confirm används aldrig).
// useTextDialog() – visa text att kopiera (t.ex. när en fil inte kan sparas direkt).
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { useAreaAttr } from "./area";
import { Button } from "./button";
import { cn } from "./cn";
import { DemoNote } from "./feedback";
import { useCopy } from "./download";

/** Elementet som hade fokus när dialogen öppnades – dit går fokus tillbaka när den stängs (Radix gör det bara med Dialog.Trigger). */
function useReturnFocus() {
  const [returnTo] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  return (e: Event) => {
    e.preventDefault();
    if (returnTo && returnTo.isConnected) returnTo.focus();
  };
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
};

/** Dialog i mitten av skärmen. Fokus hamnar i första fältet (eller första knappen), Escape stänger. */
export function Modal({ title, onClose, footer, wide, children, className }: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const areaAttr = useAreaAttr();
  const onCloseAutoFocus = useReturnFocus();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
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
