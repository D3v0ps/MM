"use client";
// Radioknappar som kort (etikett, hjälptext och ikon) – hela kortet är klickbart, minst 44 px högt, och valet syns med ram och
// tonad yta (inte bara färg: radioknappen är ikryssad). Namnet är bara etiketten (aria-labelledby), hjälptexten är beskrivningen. Samma utseende som filtypsvalet på /portal/resultat.
import { Icon, cn, type IconName } from "@/ui";

export type RadioCardOption = { value: string; label: string; help?: string; icon?: IconName; disabled?: boolean };

export function RadioCards({ name, legend, value, onChange, options }: {
  name: string; legend: string; value: string; onChange: (v: string) => void;
  options: RadioCardOption[];
}) {
  const id = (v: string) => `${name}-${v.replace(/[^a-zA-Z0-9]/g, "_")}`;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
      <legend className="mb-1 font-bold">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          htmlFor={id(o.value)}
          className={cn(
            "flex min-h-11 cursor-pointer items-start gap-3 rounded-mb border-[1.5px] border-line-strong px-4 py-3",
            value === o.value && "border-2 border-antracit bg-bla-ton",
            o.disabled && "cursor-not-allowed opacity-70",
          )}
        >
          <input
            type="radio"
            name={name}
            id={id(o.value)}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            aria-labelledby={`${id(o.value)}-label`}
            aria-describedby={o.help ? `${id(o.value)}-help` : undefined}
            onChange={() => onChange(o.value)}
            className="m-0 mt-1 size-5 flex-none accent-antracit"
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span id={`${id(o.value)}-label`} className="inline-flex items-center gap-1.5 font-bold">
              {o.icon && <Icon name={o.icon} />}
              {o.label}
            </span>
            {o.help && (
              <span id={`${id(o.value)}-help`} className="text-text-muted">
                {o.help}
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
