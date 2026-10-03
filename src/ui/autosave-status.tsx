"use client";
// Statusrad för automatisk utkastsparning (src/shell/autosave.ts): diskret text + ikon, läses upp (role=status,
// aria-live=polite) – aldrig en toast per autosparning. Raden finns alltid (tom i viloläge), så att skärmläsare får
// ändringen. Tiden är serverns (savedAt från kommandot), aldrig webbläsarens klocka.
import { fmtTime } from "@/core/time";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type AutosaveStatusState = "idle" | "saving" | "saved" | "invalid" | "failed";

export const AUTOSAVE_TEXT = {
  saving: "Sparar utkast…",
  saved: (savedAt: string) => `Utkast sparat ${fmtTime(savedAt)}`,
  invalid: "Sparas inte automatiskt förrän det markerade är ifyllt",
  failed: "Utkastet kunde inte sparas automatiskt – spara manuellt",
} as const;

const ICON: Record<Exclude<AutosaveStatusState, "idle">, IconName> = { saving: "clock", saved: "check", invalid: "info", failed: "alert" };

export function AutosaveStatus({ state, savedAt, invalidText, className }: { state: AutosaveStatusState; savedAt: string | null; invalidText?: string | null; className?: string }) {
  const text =
    state === "saving" ? AUTOSAVE_TEXT.saving
    : state === "saved" && savedAt ? AUTOSAVE_TEXT.saved(savedAt)
    : state === "invalid" ? (invalidText ?? AUTOSAVE_TEXT.invalid)
    : state === "failed" ? AUTOSAVE_TEXT.failed
    : "";
  const icon = state !== "idle" && text ? ICON[state] : null;
  return (
    <div role="status" aria-live="polite" data-autosave={state} className={cn("flex min-h-6 items-center gap-1.5 text-small", state === "failed" ? "font-bold" : "text-text-muted", className)}>
      {icon && <Icon name={icon} className={cn("size-4 flex-none", state === "failed" && "text-rod")} />}
      <span>{text}</span>
    </div>
  );
}
