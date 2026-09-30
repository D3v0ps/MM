// Flikar (prototypens Tabs): tablist med piltangenter, Home och End. Skärmen visar själv innehållet för aktiv flik –
// lägg det i <TabPanel> för rätt koppling för skärmläsare. Flikval i URL:en: onChange={(id) => nav.replace(path(base, { flik: id }))}.
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type TabDef<T extends string = string> = { id: T; label: ReactNode; count?: number | null; icon?: IconName };

const tabDomId = (base: string, id: string) => `${base}-tab-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel = "Flikar",
  id,
  className,
}: {
  tabs: readonly TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  /** Ange samma id på TabPanel. */
  id?: string;
  className?: string;
}) {
  const auto = useId();
  const base = id ?? `t${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const listRef = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    let j: number | null = null;
    if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = tabs.length - 1;
    if (j === null) return;
    e.preventDefault();
    onChange(tabs[j].id);
    const target = j;
    setTimeout(() => listRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[target]?.focus(), 0);
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className={cn("flex gap-0.5 overflow-x-auto border-b-2 border-ljusgra [scrollbar-width:thin]", className)}
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabDomId(base, t.id)}
            aria-selected={on}
            aria-controls={id ? `${base}-panel` : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-0.5 inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-0 border-b-[3px] border-transparent bg-transparent px-3.5 py-2.5 text-ui font-semibold whitespace-nowrap text-text-muted",
              "hover:text-antracit aria-selected:border-rod aria-selected:font-extrabold aria-selected:text-antracit portal:text-body",
            )}
          >
            {t.icon && <Icon name={t.icon} />}
            {t.label}
            {t.count != null && t.count !== 0 && (
              <>
                <span className="sr-only"> </span>
                <span className="rounded-full bg-ljusgra px-[7px] text-label text-antracit portal:text-body">{t.count}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Innehållet för aktiv flik. tabsId = samma id som på Tabs, active = aktiv flik. */
export function TabPanel({ tabsId, active, children, className }: { tabsId: string; active: string; children?: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={tabDomId(tabsId, active)} tabIndex={0} className={cn("min-w-0", className)}>
      {children}
    </div>
  );
}
