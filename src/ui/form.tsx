// Formulär: Field (etikett, hjälptext, fel) och kontrollerna Input, Select, TextArea, Check, Seg, DateInput, TimeInput.
// Kontrollerna inuti ett Field får id, aria-describedby (hjälptext + fel), aria-invalid och required automatiskt.
import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

type FieldCtx = { id: string; labelId: string; describedBy?: string; invalid: boolean; required: boolean };
const FieldContext = createContext<FieldCtx | null>(null);

export type FieldProps = {
  label?: ReactNode;
  /** Hjälptext under etiketten (kommunportalen: vid varje fält). */
  help?: ReactNode;
  /** Felmeddelande. Visas med ikon och läses upp; fältet markeras rött. */
  error?: ReactNode;
  required?: boolean;
  /** Kontrollens id (standard: genereras). */
  id?: string;
  /** Tar hela bredden i en FormGrid. */
  full?: boolean;
  className?: string;
  children: ReactNode;
};

export function Field({ label, help, error, required, id: idProp, full, className, children }: FieldProps) {
  const auto = useId();
  const id = idProp ?? `f${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const ctx: FieldCtx = { id, labelId: `${id}-label`, describedBy, invalid: !!error, required: !!required };
  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", full && "col-span-full", className)}>
        {label && (
          <label htmlFor={id} id={ctx.labelId} className="text-ui font-bold portal:text-h3">
            {label}
            {required && (
              <span className="font-extrabold before:ml-0.5 before:text-rod before:content-['*']">
                <span className="sr-only">(obligatoriskt)</span>
              </span>
            )}
          </label>
        )}
        {help && (
          <div id={helpId} className="text-small leading-[1.45] text-text-muted portal:text-portal">
            {help}
          </div>
        )}
        {children}
        {error && (
          <div id={errorId} role="alert" className="flex items-start gap-1.5 text-small font-bold text-antracit portal:text-body">
            <Icon name="alert-circle" className="mt-px text-rod" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/** Kontrollens attribut från omgivande Field (id, beskrivning, fel, obligatoriskt). */
function useFieldProps(p: { id?: string; invalid?: boolean; required?: boolean; "aria-describedby"?: string }) {
  const f = useContext(FieldContext);
  const describedBy = [f?.describedBy, p["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  const invalid = p.invalid ?? f?.invalid ?? false;
  return {
    id: p.id ?? f?.id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid ? (true as const) : undefined,
    required: p.required ?? (f?.required || undefined),
  };
}

type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value?: string | number | null;
  /** Nytt värde som text. */
  onValueChange?: (value: string) => void;
  onChange?: InputHTMLAttributes<HTMLInputElement>["onChange"];
  invalid?: boolean;
};

/** Textfält. type: text (standard), email, tel, number, search, password, url. */
export function Input({ value, onValueChange, onChange, invalid, className, id, required, type = "text", autoComplete = "off", ...rest }: InputBase & { type?: string }) {
  const fp = useFieldProps({ id, invalid, required, "aria-describedby": rest["aria-describedby"] });
  return (
    <input
      {...rest}
      {...fp}
      type={type}
      autoComplete={autoComplete}
      value={value ?? ""}
      onChange={(e) => {
        onChange?.(e);
        onValueChange?.(e.target.value);
      }}
      className={className}
    />
  );
}

/** Datum 'YYYY-MM-DD' (LocalDate). */
export const DateInput = (p: InputBase) => <Input {...p} type="date" />;
/** Klockslag 'HH:mm'. */
export const TimeInput = (p: InputBase) => <Input {...p} type="time" />;
/** Datum och tid 'YYYY-MM-DDTHH:mm' (LocalDateTime). */
export const DateTimeInput = (p: InputBase) => <Input {...p} type="datetime-local" />;

export type SelectOption = { value: string; label: string; disabled?: boolean } | string;

/** Inbyggd rullgardin (bäst för skärmläsare och i kommunportalen). placeholder = tomt första val. */
export function Select({
  value,
  onValueChange,
  onChange,
  options,
  placeholder,
  invalid,
  className,
  id,
  required,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value?: string | null;
  onValueChange?: (value: string) => void;
  onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"];
  options: readonly SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}) {
  const fp = useFieldProps({ id, invalid, required, "aria-describedby": rest["aria-describedby"] });
  return (
    <select
      {...rest}
      {...fp}
      value={value ?? ""}
      onChange={(e) => {
        onChange?.(e);
        onValueChange?.(e.target.value);
      }}
      className={className}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );
}

/** Flerradigt textfält. */
export function TextArea({
  value,
  onValueChange,
  onChange,
  invalid,
  rows = 3,
  className,
  id,
  required,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value?: string | null;
  onValueChange?: (value: string) => void;
  onChange?: TextareaHTMLAttributes<HTMLTextAreaElement>["onChange"];
  invalid?: boolean;
}) {
  const fp = useFieldProps({ id, invalid, required, "aria-describedby": rest["aria-describedby"] });
  return (
    <textarea
      {...rest}
      {...fp}
      rows={rows}
      value={value ?? ""}
      onChange={(e) => {
        onChange?.(e);
        onValueChange?.(e.target.value);
      }}
      className={className}
    />
  );
}

/** Kryssruta med etikett (hela raden är klickbar, minst 44 px hög). */
export function Check({
  id,
  checked,
  onCheckedChange,
  disabled,
  children,
  className,
  "aria-describedby": describedBy,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  "aria-describedby"?: string;
}) {
  const auto = useId();
  const f = useContext(FieldContext);
  const cid = id ?? `c${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <label htmlFor={cid} className={cn("flex min-h-11 cursor-pointer items-start gap-2.5 py-2 text-ui portal:text-portal", disabled && "cursor-not-allowed opacity-60", className)}>
      <input
        type="checkbox"
        id={cid}
        checked={!!checked}
        disabled={disabled}
        aria-describedby={[f?.describedBy, describedBy].filter(Boolean).join(" ") || undefined}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        className="mt-px size-[22px] flex-none accent-antracit"
      />
      <span>{children}</span>
    </label>
  );
}

export type SegOption<V extends string> = {
  value: V;
  label: ReactNode;
  icon?: IconName;
  /** Färg när valet är markerat: green → blå, yellow → ljusgrå, red → röd ram. */
  tone?: "green" | "yellow" | "red";
  lang?: string;
  dir?: "ltr" | "rtl";
  disabled?: boolean;
};

type SegBase<V extends string> = {
  options: readonly (SegOption<V> | V)[];
  /** Tillgängligt namn för gruppen. Inuti ett Field används fältets etikett. */
  ariaLabel?: string;
  id?: string;
  className?: string;
};
type SegSingle<V extends string> = SegBase<V> & { multi?: false; value: V | null | undefined; onValueChange: (value: V) => void };
type SegMulti<V extends string> = SegBase<V> & { multi: true; value: readonly V[] | null | undefined; onValueChange: (value: V[]) => void };

const SEG_TONE = {
  green: "aria-pressed:bg-bla aria-pressed:text-antracit",
  yellow: "aria-pressed:bg-ljusgra aria-pressed:text-antracit",
  red: "aria-pressed:border-[3px] aria-pressed:border-rod aria-pressed:bg-vit aria-pressed:text-antracit",
} as const;

/** Knappgrupp för snabba val (ett klick). multi = flerval (value är en lista). Knapparna har aria-pressed. */
export function Seg<V extends string>(props: SegSingle<V> | SegMulti<V>) {
  const f = useContext(FieldContext);
  const { options, ariaLabel, id, className } = props;
  const selected = (v: V) => (props.multi ? (props.value ?? []).includes(v) : props.value === v);
  const toggle = (v: V) => {
    if (props.multi) {
      const cur = [...(props.value ?? [])];
      props.onValueChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    } else props.onValueChange(v);
  };
  return (
    <div
      role="group"
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={!ariaLabel && f ? f.labelId : undefined}
      aria-describedby={f?.describedBy}
      className={cn("inline-flex flex-wrap gap-1.5", className)}
    >
      {options.map((raw) => {
        const o: SegOption<V> = typeof raw === "string" ? { value: raw as V, label: raw } : (raw as SegOption<V>);
        const on = selected(o.value);
        return (
          <button
            key={o.value}
            type="button"
            lang={o.lang}
            dir={o.dir}
            disabled={o.disabled}
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={cn(
              "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-mb border-[1.5px] border-line-strong bg-vit px-3.5 py-2 text-ui font-semibold text-antracit [font-family:inherit]",
              "hover:border-antracit aria-pressed:border-antracit aria-pressed:bg-antracit aria-pressed:text-vit disabled:cursor-not-allowed disabled:opacity-45",
              "portal:min-h-12 portal:min-w-12 portal:text-h3 [&_svg]:size-4",
              o.tone && SEG_TONE[o.tone],
            )}
          >
            {o.icon && <Icon name={o.icon} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
