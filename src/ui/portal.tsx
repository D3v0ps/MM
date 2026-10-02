// Kommunportalens stora knappar och deltagarens mobilvy (pulsmätningen).
import type { ReactNode } from "react";
import { Link } from "@/shell/nav";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

/** Staplade stora knappar (kommunens startsida). Lägg BigButton i. */
export function BigButtons({ children, ariaLabel, className }: { children?: ReactNode; ariaLabel?: string; className?: string }) {
  return (
    <nav aria-label={ariaLabel} className={cn("grid grid-cols-1 gap-3.5", className)}>
      {children}
    </nav>
  );
}

export type BigButtonProps = {
  icon: IconName;
  title: ReactNode;
  /** Förklaring under rubriken. */
  sub?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** Huvudvalet (antracit yta). */
  primary?: boolean;
};

/** Stor knapp: ikon, rubrik, förklaring och pil. Minst 88 px hög. */
export function BigButton({ icon, title, sub, to, onClick, primary }: BigButtonProps) {
  const cls = cn(
    "flex min-h-[88px] w-full cursor-pointer items-center gap-[18px] rounded-card border-2 border-antracit px-6 py-[22px] text-left text-[1.3125rem] font-extrabold no-underline [&_svg]:size-8",
    "max-[620px]:p-[18px] max-[620px]:text-portal",
    primary ? "bg-antracit text-vit" : "bg-vit text-antracit hover:bg-antracit-ton",
  );
  const inner = (
    <>
      <Icon name={icon} />
      <span>
        {title}
        {sub && <span className={cn("mt-0.5 block text-body font-medium", primary ? "text-vit/82" : "text-text-muted")}>{sub}</span>}
      </span>
      <span aria-hidden="true" className="ml-auto inline-flex">
        <Icon name="arrow-right" />
      </span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** Deltagarens "telefon": centrerat kort, max 420 px, 18 px text. Layouten "puls" ger bakgrunden. */
export function PulsePhone({ children, lang, dir, className }: { children?: ReactNode; lang?: string; dir?: "ltr" | "rtl"; className?: string }) {
  return (
    <div lang={lang} dir={dir} className={cn("flex w-[min(420px,100%)] flex-col gap-5 rounded-[22px] bg-vit px-5 pt-[22px] pb-7 text-portal shadow-pop", className)}>
      {children}
    </div>
  );
}

/** Grupp av svarsknappar (fem ansikten eller val). */
export function Smileys({ children, ariaLabel, className }: { children?: ReactNode; ariaLabel: string; className?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("grid grid-cols-5 gap-1.5", className)}>
      {children}
    </div>
  );
}

/** Svarsknapp i pulsmätningen (markerad = antracit). */
export function Smiley({ pressed, onClick, ariaLabel, children, className }: { pressed: boolean; onClick: () => void; ariaLabel?: string; children?: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-line-strong bg-vit text-meta font-bold text-antracit [font-family:inherit] [&_svg]:size-[30px]",
        "aria-pressed:border-antracit aria-pressed:bg-antracit aria-pressed:text-vit",
        className,
      )}
    >
      {children}
    </button>
  );
}
