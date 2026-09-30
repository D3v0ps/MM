"use client";
// Delade delar för ekonomins skärmar (prototypens små komponenter i prototyp/src/views/ekonomi.js):
// fakturastatus, referensmärken, kontroller, bläddring, rollförklaring, formuläret för att rätta beställarreferens,
// upparbetat och återstående.
import { useState, type ReactNode } from "react";
import { useCommand } from "@/shell/backend";
import { caseSetBuyerRef } from "@/features/arenden/api";
import { invoiceStatusLabel } from "@/core/labels";
import { fmtDateTime, monthName } from "@/core/time";
import { Badge, Button, cn, DemoNote, Dot, Field, Icon, Input, Kpi, Modal, Notice, toast, type BadgeTone, type IconName } from "@/ui";
import type { InvoiceCheckView, InvoiceRow, RefFormCase, TaskRef } from "../api";
import { pl, plural, qtyKr, refError, refFromTask, refInfo, refLenText, weekText, type InvoiceSummary, type RefInfo, type RefRules } from "../model";

// ---------------------------------------------------------------- KPI-rutor (värdet krymper så att det ryms, som prototypens .eko-kpis)
export function EkoKpis({ children }: { children: ReactNode }) {
  return <div className="eko-kpis grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-3">{children}</div>;
}
export function EkoKpi(props: Parameters<typeof Kpi>[0]) {
  return (
    <Kpi
      {...props}
      className={cn(
        "px-4 py-3.5 [container-type:inline-size] max-[620px]:p-3",
        "[&>div:first-child]:[overflow-wrap:break-word] [&>div:first-child]:[hyphens:manual]",
        "[&>div:nth-child(2)]:text-[clamp(1.125rem,14cqi,1.75rem)] [&>div:nth-child(2)]:whitespace-nowrap",
        props.className,
      )}
    />
  );
}

// ---------------------------------------------------------------- Fakturastatus
const STATUS: Record<string, { tone: BadgeTone; icon: IconName }> = {
  draft: { tone: "grey", icon: "file" },
  approved: { tone: "outline", icon: "check" },
  fortnox_created: { tone: "bluetone", icon: "upload" },
  booked: { tone: "bluetone", icon: "book" },
  sent: { tone: "bluetone", icon: "send" },
  paid: { tone: "blue", icon: "check-circle" },
  returned: { tone: "red", icon: "reply" },
  manual: { tone: "dark", icon: "edit" },
  blocked: { tone: "red", icon: "x-circle" },
};
export const STATUS_ONE: Record<string, string> = {
  draft: "underlag", approved: "godkänd", fortnox_created: "skapad i Fortnox", booked: "bokförd", sent: "skickad", paid: "betald", returned: "returnerad",
  manual: "manuellt fakturerad", blocked: "stoppad",
};
export const STATUS_PLURAL: Record<string, string> = {
  draft: "underlag", approved: "godkända", fortnox_created: "skapade i Fortnox", booked: "bokförda", sent: "skickade", paid: "betalda", returned: "returnerade",
  manual: "manuellt fakturerade", blocked: "stoppade",
};
export function InvStatus({ status }: { status: string }) {
  const m = STATUS[status] ?? STATUS.draft;
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {invoiceStatusLabel(status)}
    </Badge>
  );
}

// ---------------------------------------------------------------- Kontroller
export const CHECK: Record<string, { tone: BadgeTone; icon: IconName; word: string }> = {
  blocking: { tone: "red", icon: "x-circle", word: "Stoppar fakturan" },
  needs_approval: { tone: "grey", icon: "clock", word: "Kräver godkännande" },
  approved: { tone: "bluetone", icon: "check", word: "Godkänd" },
  warning: { tone: "outline", icon: "alert-circle", word: "Kontrollera" },
  info: { tone: "outline", icon: "info", word: "Information" },
};
const SHORT: Record<string, string> = {
  buyer_ref: "Referens", po: "Inköpsordernummer", zero_week: "Ingen närvaro", missing_reg: "Närvaro saknas", too_many: "Fler än 5 veckor", over_order: "Över beställningen",
  overlap: "Överlapp", paused: "Pausad vecka", partial: "Delvis vecka",
};
export function CheckIcons({ checks, column }: { checks: readonly InvoiceCheckView[]; column?: boolean }) {
  if (!checks.length) {
    return (
      <span className="inline-flex items-center gap-1.5 text-small whitespace-nowrap">
        <Icon name="check" />
        Inga
      </span>
    );
  }
  const main = checks.filter((c) => c.severity !== "info");
  const info = checks.filter((c) => c.severity === "info");
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-1", column && "flex-col items-start")}>
      {main.map((c, i) => (
        <Badge key={`${c.kind}-${i}`} tone={CHECK[c.severity].tone} icon={CHECK[c.severity].icon} title={`${c.label}. ${c.text}`}>
          {c.severity === "approved" ? "Vecka godkänd" : (SHORT[c.kind] ?? c.label)}
        </Badge>
      ))}
      {info.map((c, i) => (
        <span key={`i-${i}`} className="text-text-muted" title={c.label}>
          <Icon name={c.kind === "paused" ? "pause" : "info"} label={c.label} />
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Beställarreferens
/** Referensen i en tabellcell: numret och status (Giltig, Spärrad, Fel format, Saknas). info = refInfo(value, regler). */
export function RefCell({ value, info: r }: { value: string | null; info: RefInfo }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-bold whitespace-nowrap tabular-nums tracking-[0.01em]">{value || "–"}</span>
      <span className="inline-flex items-center gap-1.5 text-small whitespace-nowrap">
        <Icon name={r.ok ? "check" : "x-circle"} className={r.ok ? undefined : "text-rod"} />
        {r.label}
      </span>
    </div>
  );
}
export function RefBadge({ value, info: r }: { value: string | null; info: RefInfo }) {
  return (
    <Badge tone={r.ok ? "bluetone" : "red"} icon={r.ok ? "check" : "x-circle"}>
      {value || "Saknas"} · {r.label}
    </Badge>
  );
}

// ---------------------------------------------------------------- Bläddring
export const PAGE_SIZE = 20;
export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return <span className="text-small text-text-muted">Visar {plural(total, "faktura", "fakturor")}</span>;
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <span className="text-small text-text-muted">
        Visar {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} av {total}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button kind="secondary" icon="chevron-left" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Föregående
        </Button>
        <span className="text-small font-bold whitespace-nowrap" aria-live="polite">
          Sida {page + 1} av {pages}
        </span>
        <Button kind="secondary" iconRight="chevron-right" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
          Nästa
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Rollförklaring
export function RoleNotice({ canAct }: { canAct: boolean }) {
  return canAct ? (
    <Notice tone="info" title="Du ser inga namn">
      Som ekonom ser du ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag. Namn, anteckningar och rapporter visas inte för din roll – deltagaren
      visas som ”–”. Ärendenumret är faktureringsobjektet.
    </Notice>
  ) : (
    <Notice tone="warn" title="Läsläge">
      Du ser fakturaunderlaget i läsläge. Ekonomen godkänner, skapar fakturor och rättar referenser.
    </Notice>
  );
}

/** Rubrik inuti en dialog eller ett kort (prototypens section-title). */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-label font-extrabold tracking-[0.1em] uppercase">
      <Dot />
      {children}
    </h3>
  );
}

/** Tonad ruta för en åtgärd i en kontroll (prototypens eko-fix). */
export function FixBox({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-mb border border-ljusgra bg-ljusgra-ton p-3.5">{children}</div>;
}
/** Citat med blå kant (prototypens eko-quote). */
export function Quote({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1 border-l-[3px] border-bla py-1 pl-3">{children}</div>;
}

// ---------------------------------------------------------------- Rätta beställarreferens (ett eller flera ärenden)
export function RefForm({
  cases,
  task,
  rules,
  canAct,
  idSuffix,
  onDone,
}: {
  cases: readonly RefFormCase[];
  task: TaskRef | null;
  rules: RefRules;
  canAct: boolean;
  idSuffix?: string;
  onDone?: (ref: string) => void;
}) {
  const setRef = useCommand(caseSetBuyerRef);
  const [val, setVal] = useState("");
  const [tried, setTried] = useState(false);
  const current = cases.length === 1 ? cases[0].buyerReference : null;
  const suggestion = refFromTask(task?.text, cases[0]?.buyerReference ?? null, rules);
  const id = `eko-ref-${idSuffix ?? cases[0]?.caseId}`;
  const err = refError(val, current, rules);
  const info = !err && val ? refInfo(val, rules) : null;
  if (!canAct) return <div className="text-small text-text-muted">Ekonomen rättar referensen när kommunen har bekräftat den rätta.</div>;
  const len = refLenText(rules.billing);
  const save = async () => {
    setTried(true);
    if (err) return;
    const ref = val.trim();
    for (const c of cases) {
      const res = await setRef.run({ caseId: c.caseId, reference: ref, source: task ? task.id : "ekonom" }).catch(() => null);
      if (!res || !res.ok) {
        toast("Beställarreferensen kunde inte sparas. Kontrollera siffrorna.", "error");
        return;
      }
    }
    toast(
      cases.length === 1
        ? `Beställarreferensen för ${cases[0].caseNumber} är nu ${ref}. Fakturan är inte längre stoppad.`
        : `Beställarreferensen är nu ${ref} för ${cases.map((c) => c.caseNumber).join(" och ")}.`,
    );
    setVal("");
    setTried(false);
    onDone?.(ref);
  };
  return (
    <FixBox>
      {task && (
        <Quote>
          <span className="text-small text-text-muted">
            Uppgift från {task.fromName} ({fmtDateTime(task.createdAt)})
          </span>
          <span>{task.text}</span>
        </Quote>
      )}
      <Field
        id={id}
        label="Rätt beställarreferens"
        required
        error={tried ? err : undefined}
        help={info?.unit ? `${len} siffror. Referensen tillhör ${info.unit}.` : `${len} siffror, bara siffror. Referensen kommer från kommunens beställning – hitta aldrig på en egen.`}
      >
        <Input value={val} onValueChange={setVal} inputMode="numeric" maxLength={10} invalid={tried && !!err} />
      </Field>
      <div className="flex flex-wrap items-center gap-1.5">
        {suggestion && val !== suggestion && (
          <Button kind="secondary" icon="copy" onClick={() => setVal(suggestion)}>
            Använd {suggestion} från uppgiften
          </Button>
        )}
        <Button kind="primary" icon="check" pending={setRef.pending} onClick={() => void save()}>
          {cases.length === 1 ? "Spara referensen" : `Spara för ${cases.length} ärenden`}
        </Button>
      </div>
    </FixBox>
  );
}

export function RefModal({ cases, task, rules, canAct, onClose }: { cases: readonly RefFormCase[]; task: TaskRef | null; rules: RefRules; canAct: boolean; onClose: () => void }) {
  const first = cases[0];
  return (
    <Modal title="Rätta beställarreferens" onClose={onClose}>
      <p>
        {cases.length === 1 ? `Ärende ${first.caseNumber}` : `Ärendena ${cases.map((c) => c.caseNumber).join(" och ")}`} har referensen{" "}
        <b className="tabular-nums">{first.buyerReference || "saknas"}</b>. {refInfo(first.buyerReference, rules).text}
      </p>
      <RefForm cases={cases} task={task} rules={rules} canAct={canAct} idSuffix={`modal-${first.caseId}`} onDone={onClose} />
      <DemoNote>Ändringen loggas i revisionsloggen med gammal och ny referens. Kommunen får ingen notis – referensen är deras egen.</DemoNote>
    </Modal>
  );
}

// ---------------------------------------------------------------- Upparbetat och återstående
function LedgerRow({ label, sub, value, strong, sum }: { label: ReactNode; sub?: ReactNode; value: ReactNode; strong?: boolean; sum?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-ljusgra py-2 tabular-nums",
        sum && "border-b-2 border-antracit font-extrabold",
      )}
    >
      <span className="min-w-0 flex-[1_1_200px]">
        <span className={cn(strong && "font-bold")}>{label}</span>
        {sub && <span className="block text-meta font-normal text-text-muted">{sub}</span>}
      </span>
      <span className={cn("ml-auto text-right", strong && "font-bold")}>{value}</span>
    </div>
  );
}

/** Upparbetat och återstående för en faktura – samma siffror och ord som fakturatexten. */
export function SummaryList({ inv, sm }: { inv: Pick<InvoiceRow, "weeks">; sm: InvoiceSummary }) {
  const months = (t: InvoiceSummary["returned"]) => t.months.map((r) => monthName(r.mk)).join(", ");
  return (
    <div className="flex w-full flex-col">
      <LedgerRow label="Tidigare fakturerat" sub="Skapat i Fortnox eller manuellt fakturerat" value={qtyKr(sm.billed)} />
      {sm.returned.qty > 0 && (
        <LedgerRow
          strong
          label="Faktureras om"
          sub={`${pl(sm.returned.months.length, "Returnerad faktura", "Returnerade fakturor")} för ${months(sm.returned)}. Krediteras och faktureras på en ny faktura.`}
          value={qtyKr(sm.returned)}
        />
      )}
      {sm.pending.qty > 0 && (
        <LedgerRow label="Ännu inte fakturerat" sub={`Från ${months(sm.pending)} – faktureras på en egen faktura per månad`} value={qtyKr(sm.pending)} />
      )}
      <LedgerRow label="Denna faktura" sub={weekText(inv.weeks)} value={qtyKr(sm.current)} />
      <LedgerRow sum label="Upparbetat inklusive denna faktura" value={qtyKr(sm.accrued)} />
      <LedgerRow label="Beställning" value={qtyKr(sm.order)} />
      <LedgerRow strong label={sm.over ? "Över beställningen" : "Återstår av beställningen"} value={sm.over ? plural(sm.over, "vecka", "veckor") : qtyKr(sm.remaining)} />
    </div>
  );
}
