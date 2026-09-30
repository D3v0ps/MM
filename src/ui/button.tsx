// Knappar (prototypens Btn). Minst 44 × 44 px. Med `to` blir knappen en länk med samma utseende.
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Link } from "@/shell/nav";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export const buttonVariants = cva(
  [
    "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-mb border-2 border-transparent px-4 py-2.5",
    "text-ui leading-[1.2] font-bold whitespace-nowrap no-underline transition-[background-color,border-color,color,box-shadow] duration-[120ms]",
    "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
    "portal:min-h-[52px] portal:text-h3",
  ],
  {
    variants: {
      kind: {
        /** Huvudåtgärden på sidan (antracit). */
        primary: "bg-antracit text-vit hover:not-disabled:shadow-[inset_0_0_0_999px_rgb(255_255_255/0.12)]",
        /** Vanlig knapp (vit med antracit ram). */
        secondary: "border-antracit bg-vit text-antracit hover:not-disabled:bg-antracit-ton",
        /** Textknapp (understruken). */
        ghost: "bg-transparent text-antracit underline underline-offset-3 hover:not-disabled:bg-antracit-ton portal:min-h-11",
        /** Riskabel åtgärd: vit med röd ram och röd ikon. */
        danger: "border-rod bg-vit text-antracit hover:not-disabled:bg-rod-ton [&_svg]:text-rod",
        /** Röd yta – bara stor fet text. */
        red: "bg-rod text-h2 font-extrabold text-vit hover:not-disabled:shadow-[inset_0_0_0_999px_rgb(30_37_43/0.12)]",
        /** Blå yta med antracit text. */
        blue: "bg-bla text-antracit hover:not-disabled:shadow-[inset_0_0_0_999px_rgb(30_37_43/0.1)]",
      },
      size: {
        md: "",
        lg: "min-h-14 px-[22px] py-3.5 text-h3",
      },
      block: { true: "w-full", false: "" },
      iconOnly: { true: "p-2", false: "" },
    },
    defaultVariants: { kind: "secondary", size: "md", block: false, iconOnly: false },
  },
);

export type ButtonKind = NonNullable<VariantProps<typeof buttonVariants>["kind"]>;

export type ButtonProps = {
  kind?: ButtonKind;
  size?: "md" | "lg";
  block?: boolean;
  /** Ikon före texten. */
  icon?: IconName;
  /** Ikon efter texten (t.ex. arrow-right). */
  iconRight?: IconName;
  /** Gör knappen till en intern länk (navigering). */
  to?: string;
  /** Kommandot pågår: knappen är inaktiv och markerad som upptagen. */
  pending?: boolean;
  /** Tillgängligt namn – krävs för knappar med bara ikon. */
  ariaLabel?: string;
  ariaPressed?: boolean;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "aria-pressed">;

/** Knapp. kind: primary | secondary (standard) | ghost | danger | red | blue. Utan text: ge ariaLabel eller title. */
export function Button({
  kind = "secondary",
  size = "md",
  block,
  icon,
  iconRight,
  to,
  pending,
  ariaLabel,
  ariaPressed,
  children,
  className,
  type = "button",
  disabled,
  title,
  onClick,
  ...rest
}: ButtonProps) {
  const iconOnly = children === undefined || children === null || children === false;
  const cls = cn(buttonVariants({ kind, size, block: !!block, iconOnly }), className);
  const label = ariaLabel ?? (iconOnly ? title : undefined);
  const content = (
    <>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </>
  );
  if (to && !disabled) {
    return (
      <Link
        to={to}
        className={cls}
        title={title}
        aria-label={label}
        onClick={onClick as unknown as (e: MouseEvent<HTMLAnchorElement>) => void}
        id={rest.id}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      title={title}
      aria-label={label}
      aria-pressed={ariaPressed}
      onClick={onClick}
      {...rest}
    >
      {content}
    </button>
  );
}

/** Samma som Button – prototypens namn. */
export const Btn = Button;
