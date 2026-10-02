// Layoutprimitiver – motsvarar prototypens CSS-klasser stack, row, grid, split, form-grid, list och list-item.
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { Link } from "@/shell/nav";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

type DivProps = ComponentPropsWithoutRef<"div">;

const STACK_GAP = { sm: "gap-2", md: "gap-4", lg: "gap-7", xs: "gap-1" } as const;
/** Lodrät stapel. gap: xs 4 px · sm 8 px (stack-sm) · md 16 px (stack) · lg 28 px (stack-lg). */
export function Stack({ gap = "md", as: As = "div", className, ...rest }: DivProps & { gap?: keyof typeof STACK_GAP; as?: ElementType }) {
  return <As className={cn("flex flex-col", STACK_GAP[gap], className)} {...rest} />;
}

/** Vågrät rad som bryts. gap: sm 6 px (row-sm) · md 12 px (row). between = row-between. */
export function Row({ gap = "md", between, nowrap, className, ...rest }: DivProps & { gap?: "sm" | "md"; between?: boolean; nowrap?: boolean }) {
  return (
    <div
      className={cn("flex items-center", nowrap ? "flex-nowrap" : "flex-wrap", gap === "sm" ? "gap-1.5" : "gap-3", between && "justify-between gap-3", className)}
      {...rest}
    />
  );
}

/** Fyller ut en rad (skjuter efterföljande innehåll åt höger). */
export const Spacer = () => <span className="flex-1" aria-hidden="true" />;

const GRID = {
  auto: "grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))]",
  2: "grid-cols-2 max-[620px]:grid-cols-1",
  3: "grid-cols-3 max-[980px]:grid-cols-2 max-[620px]:grid-cols-1",
  4: "grid-cols-4 max-[980px]:grid-cols-2 max-[620px]:grid-cols-1",
} as const;
/** Rutnät med kort/KPI:er. cols: auto (minst 260 px per kolumn) · 2 · 3 · 4 – blir färre kolumner på smala skärmar. */
export function Grid({ cols = "auto", className, ...rest }: DivProps & { cols?: keyof typeof GRID }) {
  return <div className={cn("grid gap-4 [&>*]:min-w-0", GRID[cols], className)} {...rest} />;
}

/** Två kolumner (1:1), eller wide = 2:1. En kolumn under 980 px. */
export function Split({ wide, className, ...rest }: DivProps & { wide?: boolean }) {
  return (
    <div
      className={cn(
        "grid items-start gap-5 max-[980px]:grid-cols-1 [&>*]:min-w-0",
        wide ? "grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "grid-cols-2",
        className,
      )}
      {...rest}
    />
  );
}

/** Formulär i två kolumner (en under 620 px). Fält med `full` tar hela bredden. */
export function FormGrid({ className, ...rest }: DivProps) {
  return <div className={cn("grid grid-cols-2 gap-4 max-[620px]:grid-cols-1 [&>*]:min-w-0", className)} {...rest} />;
}

export const Divider = ({ className }: { className?: string }) => <hr className={cn("my-1 h-px border-0 bg-ljusgra", className)} />;

/** Versal etikett med spärrning (prototypens eyebrow / label-caps). */
export function Eyebrow({ as: As = "div", className, ...rest }: ComponentPropsWithoutRef<"div"> & { as?: ElementType }) {
  return <As className={cn("text-label font-bold uppercase tracking-[0.09em] text-text-muted portal:text-body", className)} {...rest} />;
}

/** Röd punkt – profilens accent. */
export const Dot = ({ className }: { className?: string }) => (
  <span aria-hidden="true" className={cn("inline-block size-[0.5em] shrink-0 rounded-full bg-rod", className)} />
);

/** Ordmärket "MILJONMATCH•" / "MILJONBEMANNING•". Färgen ärvs (vit på sidopanelen, antracit annars). */
export function Brand({ name = "Miljonmatch", size = "md", className }: { name?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-0.5 font-extrabold uppercase tracking-[0.08em]",
        size === "sm" ? "text-body" : size === "lg" ? "text-[1.25rem]" : "text-[1.125rem]",
        className,
      )}
    >
      {name}
      <span aria-hidden="true" className="ml-0.5 inline-block size-[9px] shrink-0 rounded-full bg-rod-logo" />
    </span>
  );
}

/** Lista i ett kort (prototypens .list). Använd ListItem för raderna. */
export function List({ className, as: As = "div", ...rest }: ComponentPropsWithoutRef<"div"> & { as?: ElementType }) {
  return <As className={cn("flex flex-col", className)} {...rest} />;
}

export type ListItemProps = {
  /** Ikon till vänster (valfri). */
  icon?: IconName;
  /** Innehåll före huvuddelen (t.ex. en SlaBadge eller Avatar). */
  lead?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  /** Högerkolumnen (status, knappar). */
  side?: ReactNode;
  /** Gör hela raden klickbar (knapp) … */
  onClick?: () => void;
  /** … eller till en länk. */
  to?: string;
  /** Pil till höger på klickbara rader. */
  chevron?: boolean;
  /** Röd markering i vänsterkanten (t.ex. oläst). */
  marked?: boolean;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
};

const LI = "flex min-w-0 items-start gap-3 border-b border-ljusgra px-[18px] py-3 last:border-b-0 portal:px-5 portal:py-3.5";
const LI_CLICK =
  "w-full cursor-pointer border-x-0 border-t-0 bg-transparent text-left text-inherit no-underline [font:inherit] hover:bg-ljusgra-ton portal:min-h-[68px] portal:items-center";

/** Rad i en lista: titel (fet), underrad (liten, dämpad) och högerkolumn. Klickbar med onClick eller to. */
export function ListItem({ icon, lead, title, sub, side, onClick, to, chevron, marked, className, children, ...aria }: ListItemProps) {
  const inner = (
    <>
      {icon && <Icon name={icon} className="mt-0.5" />}
      {lead}
      {/* span i stället för div: raden kan vara en <button> eller <a>. */}
      <span className={cn("flex min-w-0 flex-1 flex-col gap-[3px]", side !== undefined && "max-[620px]:basis-[calc(100%-44px)]")}>
        {title !== undefined && <span className="block font-bold">{title}</span>}
        {sub !== undefined && <span className="block text-small text-text-muted portal:text-portal">{sub}</span>}
        {children}
      </span>
      {side !== undefined && (
        <span className="flex flex-none flex-col items-end gap-1 max-[620px]:w-full max-[620px]:flex-row max-[620px]:flex-wrap max-[620px]:items-center max-[620px]:justify-start">
          {side}
        </span>
      )}
      {chevron && <Icon name="chevron-right" className="self-center text-text-muted" />}
    </>
  );
  // Under 620 px läggs högerkolumnen på en egen rad (som prototypen); utan högerkolumn bryts inte raden.
  const cls = cn(LI, side !== undefined && "max-[620px]:flex-wrap", (onClick || to) && LI_CLICK, marked && "shadow-[inset_4px_0_0_var(--color-rod)]", className);
  if (to) {
    return (
      <Link to={to} className={cls} {...aria}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} {...aria}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} {...aria}>
      {inner}
    </div>
  );
}

/** Ikon + text på en rad (t.ex. en bekräftelse med bock). */
export function IconText({ icon, children, className }: { icon: IconName; children?: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-start gap-1.5", className)}>
      <Icon name={icon} className="mt-0.5" />
      <span>{children}</span>
    </span>
  );
}
