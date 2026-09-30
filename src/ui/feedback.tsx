"use client";
// Meddelanden i sidan: Notice, DemoNote, Empty, Loading, ErrorNotice och QueryView (laddning/fel för useQuery).
import { useEffect, useState, type ReactNode } from "react";
import { DemoOnly } from "@/shell/runtime";
import { Button } from "./button";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

const NOTICE_TONE = {
  info: "border-bla bg-bla-ton",
  warn: "border-antracit bg-ljusgra-ton2",
  critical: "border-2 border-rod bg-rod-ton [&>svg]:text-rod",
  ok: "border-bla bg-vit",
} as const;
const NOTICE_ICON: Record<keyof typeof NOTICE_TONE, IconName> = { info: "info", warn: "alert-circle", critical: "alert", ok: "check-circle" };
export type NoticeTone = keyof typeof NOTICE_TONE;

/** Meddelanderuta. tone: info (blå, standard) | warn (grå, antracit kant) | critical (röd, läses upp direkt) | ok. */
export function Notice({ tone = "info", title, icon, children, className }: { tone?: NoticeTone; title?: ReactNode; icon?: IconName; children?: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "critical" ? "alert" : undefined}
      className={cn("flex items-start gap-3 rounded-mb border-[1.5px] border-ljusgra bg-vit px-3.5 py-3 portal:text-portal", NOTICE_TONE[tone], className)}
    >
      <Icon name={icon ?? NOTICE_ICON[tone]} className="mt-0.5" />
      <div className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
        {title && <div className="font-extrabold">{title}</div>}
        {children !== undefined && <div>{children}</div>}
      </div>
    </div>
  );
}

/** Förklaring som bara gäller prototypen (streckad ram, "Prototyp:"). Visas aldrig i riktiga appen. */
export function DemoNote({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <DemoOnly>
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted portal:text-portal",
          className,
        )}
      >
        <Icon name="info" className="mt-px" />
        <div>
          <b className="font-bold text-antracit">Prototyp:</b> {children}
        </div>
      </div>
    </DemoOnly>
  );
}

/** Tomt läge: ikon, rubrik, text och ev. knapp. */
export function Empty({ icon = "inbox", title, children, action, className }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-8 text-center text-text-muted", className)}>
      <Icon name={icon} className="size-8 text-antracit" />
      <div className="font-extrabold text-antracit">{title}</div>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

/** Laddar data. Syns först efter 250 ms så att snabba svar inte blinkar. */
export function Loading({ label = "Hämtar…", className }: { label?: string; className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center gap-2.5 px-1 py-6 text-text-muted", !visible && "opacity-0", className)}>
      <span aria-hidden="true" className="size-[18px] animate-spin rounded-full border-2 border-ljusgra border-t-antracit" />
      <span>{label}</span>
    </div>
  );
}

/** Fel från useQuery/useCommand. Visar serverns text (aldrig personuppgifter) eller en allmän text. */
export function ErrorNotice({ error, title = "Uppgifterna kunde inte hämtas", onRetry, className }: { error?: unknown; title?: ReactNode; onRetry?: () => void; className?: string }) {
  // Bara API:ts egna fel (BackendError i appen, ApiError i prototypen – båda har `code`) visar sin text; de är skrivna
  // för användaren och innehåller aldrig personuppgifter. Tekniska fel får en allmän text.
  const apiError = error instanceof Error && typeof (error as { code?: unknown }).code === "string";
  const message = apiError && (error as Error).message ? (error as Error).message : "Något gick fel. Försök igen.";
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Notice tone="critical" title={title}>
        {message}
      </Notice>
      {onRetry && (
        <div>
          <Button icon="refresh" onClick={onRetry}>
            Försök igen
          </Button>
        </div>
      )}
    </div>
  );
}

/** Minsta gränssnitt från useQuery (TanStack Query). */
export type QueryLike<T> = { data: T | undefined; isLoading: boolean; error: unknown; refetch?: () => unknown };

/**
 * Visar Loading medan frågan hämtas, ErrorNotice vid fel och annars children(data).
 * <QueryView query={q}>{(rows) => <Table rows={rows} … />}</QueryView>
 */
export function QueryView<T>({ query, children, loading, errorTitle }: { query: QueryLike<T>; children: (data: T) => ReactNode; loading?: ReactNode; errorTitle?: ReactNode }) {
  if (query.error) return <ErrorNotice error={query.error} title={errorTitle} onRetry={query.refetch ? () => void query.refetch?.() : undefined} />;
  if (query.isLoading || query.data === undefined) return <>{loading ?? <Loading />}</>;
  return <>{children(query.data)}</>;
}
