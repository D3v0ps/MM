// Visning av data: KPI, mätare, nyckel–värde, tidslinje, stegvisare, avatar och diagramyta.
import { Fragment, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { initials } from "@/core/format";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

/**
 * Nyckeltal. tone "alert" = under mål (röd ram, "Kräver åtgärd"), "watch" = bevaka (antracit ram, "Bevaka").
 * Status visas alltid med text och ikon, aldrig bara med ramfärg.
 */
export function Kpi({
  label,
  value,
  sub,
  tone,
  statusText,
  children,
  className,
  onClick,
  actionHint,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "alert" | "watch" | null;
  statusText?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Rutan blir en knapp (t.ex. "gå till avsnittet"). */
  onClick?: () => void;
  /** Text längst ned i en klickbar ruta, t.ex. "Visa". */
  actionHint?: ReactNode;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-card border border-ljusgra bg-vit px-[18px] py-4",
        onClick && "cursor-pointer text-left text-antracit [font-family:inherit] hover:bg-ljusgra-ton",
        tone === "alert" && "border-2 border-rod",
        tone === "watch" && "border-2 border-antracit",
        className,
      )}
    >
      <div className="text-label font-extrabold tracking-[0.08em] text-text-muted uppercase portal:text-body">{label}</div>
      <div className="text-[2rem] leading-[1.1] font-extrabold tabular-nums">{value}</div>
      {(tone === "alert" || tone === "watch") && (
        <div className="inline-flex items-center gap-1.5 text-small font-extrabold portal:text-body [&_svg]:size-4">
          <Icon name={tone === "alert" ? "alert" : "eye"} className={tone === "alert" ? "text-rod" : undefined} />
          {statusText ?? (tone === "alert" ? "Kräver åtgärd" : "Bevaka")}
        </div>
      )}
      {sub && <div className="text-small text-text-muted portal:text-portal">{sub}</div>}
      {children}
      {onClick && actionHint && (
        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-small font-bold underline underline-offset-3">
          {actionHint}
          <Icon name="arrow-right" className="size-3.5" />
        </span>
      )}
    </Tag>
  );
}

export type MeterMarker = { value: number; label: string; tone?: "red" | "dark" };

/** Mätare 0–max med målmarkeringar (t.ex. avtalets mål i rött, internt mål i antracit). */
export function Meter({ value, max = 1, markers = [], tone, label }: { value: number; max?: number; markers?: MeterMarker[]; tone?: "blue" | "red"; label?: string }) {
  const pct = (v: number) => (max ? (v / max) * 100 : 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={label ?? `${Math.round(pct(value))} procent`} className="relative h-3 rounded-full bg-ljusgra-ton2">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", tone === "blue" ? "bg-bla" : tone === "red" ? "bg-rod" : "bg-antracit")}
          style={{ width: `${Math.max(0, Math.min(100, pct(value)))}%` }}
        />
        {markers.map((m) => (
          <div
            key={`${m.label}-${m.value}`}
            title={m.label}
            className={cn("absolute -top-[5px] -bottom-[5px] w-0.5", m.tone === "red" ? "bg-rod" : "bg-antracit")}
            style={{ left: `calc(${pct(m.value)}% - 1px)` }}
          />
        ))}
      </div>
      {markers.length > 0 && (
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-text-muted portal:text-body">
          {markers.map((m) => (
            <span key={`${m.label}-${m.value}`}>
              <span aria-hidden="true" className={cn("mr-1 inline-block h-[3px] w-2.5 align-middle", m.tone === "red" ? "bg-rod" : "bg-antracit")} />
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Nyckel–värde-lista. items: [["Ärendenummer", "BOT-26-0143"], …]; null/false hoppas över, tomt värde visas som "–". */
export function Kv({ items, className }: { items: readonly (readonly [ReactNode, ReactNode] | null | false | undefined)[]; className?: string }) {
  return (
    <dl
      className={cn(
        "m-0 grid grid-cols-[minmax(120px,max-content)_minmax(0,1fr)] gap-x-[18px] gap-y-2 max-[520px]:grid-cols-1 max-[520px]:gap-x-0 max-[520px]:gap-y-0.5",
        className,
      )}
    >
      {items
        .filter((x): x is readonly [ReactNode, ReactNode] => !!x)
        .map(([k, v], i) => (
          <Fragment key={i}>
            <dt className="text-ui font-semibold text-text-muted portal:text-portal">{k}</dt>
            <dd className="m-0 min-w-0 [overflow-wrap:anywhere] max-[520px]:mb-2 portal:text-portal">{v ?? "–"}</dd>
          </Fragment>
        ))}
    </dl>
  );
}

export type TimelineItem = {
  icon?: IconName;
  title: ReactNode;
  sub?: ReactNode;
  body?: ReactNode;
  /** red = röd ring. alert = röd ring och röd ikon (varning – alltid tillsammans med text). */
  tone?: "red" | "alert";
  filled?: boolean;
  key?: string;
  /** Datum (eller "Vecka 39") i en egen kolumn före rubriken – ovanför rubriken på smala skärmar. */
  date?: ReactNode;
  /** Knappar till höger om posten (under den på smala skärmar). */
  actions?: ReactNode;
};

/** Tidslinje (historik, händelser, deltagarkortets tidslinje). as="ol" = en lista för skärmläsare. */
export function Timeline({ items, as = "div", ariaLabel }: { items: TimelineItem[]; as?: "div" | "ol"; ariaLabel?: string }) {
  const List = as;
  const Item = as === "ol" ? "li" : "div";
  return (
    <List aria-label={ariaLabel} className={cn("flex flex-col", as === "ol" && "m-0 list-none p-0")}>
      {items.map((it, i) => (
        <Item
          key={it.key ?? i}
          className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-3 pb-4 before:absolute before:top-[22px] before:bottom-0 before:left-2.5 before:w-0.5 before:bg-ljusgra last:before:hidden"
        >
          <span
            aria-hidden={it.date != null || it.actions != null ? true : undefined}
            className={cn(
              "grid size-[22px] place-items-center rounded-full border-2 border-antracit bg-vit [&_svg]:size-3",
              it.filled && "bg-antracit text-vit",
              it.tone === "red" && "border-rod",
              it.tone === "alert" && "border-rod [&_svg]:text-rod",
            )}
          >
            {it.icon && <Icon name={it.icon} />}
          </span>
          {it.date != null || it.actions != null ? (
            <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1.5">
              {it.date != null && <div className="w-[92px] flex-none pt-px text-small font-bold text-text-muted max-[620px]:w-full portal:text-body">{it.date}</div>}
              <div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-0.5">
                <div className="font-bold">{it.title}</div>
                {it.sub && <div className="text-small text-text-muted portal:text-body">{it.sub}</div>}
                {it.body}
              </div>
              {it.actions != null && <div className="flex flex-none flex-wrap items-center gap-1.5 max-[620px]:w-full">{it.actions}</div>}
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="font-bold">{it.title}</div>
              {it.sub && <div className="text-small text-text-muted portal:text-body">{it.sub}</div>}
              {it.body}
            </div>
          )}
        </Item>
      ))}
    </List>
  );
}

/** Stegvisare: klara steg (blå med bock), aktuellt steg (antracit) och kommande. current = index (0-baserat). */
export function Stepper({ steps, current, ariaLabel }: { steps: readonly ReactNode[]; current: number; ariaLabel?: string }) {
  return (
    <ol aria-label={ariaLabel} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={i}
            aria-current={now ? "step" : undefined}
            className={cn("flex items-center gap-2 pr-2 font-semibold text-text-muted portal:text-body", now && "font-extrabold text-antracit")}
          >
            <span
              className={cn(
                "grid size-[30px] place-items-center rounded-full border-2 border-line-strong text-small font-extrabold portal:text-body",
                done && "border-bla bg-bla text-antracit",
                now && "border-antracit bg-antracit text-vit",
              )}
            >
              {done ? <Icon name="check" /> : i + 1}
            </span>
            {done && <span className="sr-only">Klart: </span>}
            {s}
          </li>
        );
      })}
    </ol>
  );
}

/** Initialer i en rund bricka. onDark = vit bricka (på sidopanelen). */
export function Avatar({ name, size = "md", onDark }: { name: string; size?: "sm" | "md"; onDark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid flex-none place-items-center rounded-full bg-ljusgra font-extrabold tracking-[0.02em] text-antracit",
        size === "sm" ? "size-[26px] text-[0.6875rem]" : "size-[34px] text-meta",
        onDark && "bg-vit",
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Namn med avatar. */
export function UserName({ name, withAvatar = true }: { name: string; withAvatar?: boolean }) {
  return (
    <span className="inline-flex flex-nowrap items-center gap-1.5">
      {withAvatar && <Avatar name={name} size="sm" />}
      <span>{name}</span>
    </span>
  );
}

/** SVG-yta för egna diagram. Klasserna "axis" och "grid-line" på linjer ger rätt färger. Ge alltid aria-label. */
export function Chart({ className, children, ...rest }: ComponentPropsWithoutRef<"svg"> & { "aria-label": string }) {
  return (
    <svg
      role="img"
      className={cn(
        "block h-auto w-full [&_.axis]:stroke-line-strong [&_.axis]:stroke-1 [&_.grid-line]:stroke-ljusgra [&_.grid-line]:stroke-1 [&_text]:fill-antracit [&_text]:font-sans [&_text]:text-[12px]",
        className,
      )}
      {...rest}
    >
      {children}
    </svg>
  );
}
