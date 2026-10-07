"use client";
// Delade delar för ekonomins skärmar (prototypens små komponenter i prototyp/src/views/ekonomi.js):
// fakturastatus, referensmärken, kontroller, bläddring, rollförklaring, fakturans beställarreferens och inköpsordernummer,
// upparbetat och återstående.
import { useState, type ReactNode } from "react";
import { useCommand } from "@/shell/backend";
import { CASE_NUMBER_RE } from "@/core/cases";
import { invoiceStatusLabel } from "@/core/labels";
import { monthName } from "@/core/time";
import { poNumberError } from "@/core/validation";
import { Badge, Button, cn, DemoNote, Dot, Field, focusFirstError, focusSectionOf, Icon, Input, Kpi, Modal, Notice, toast, type BadgeTone, type IconName } from "@/ui";
import { invoiceSetBuyerRef, invoiceSetPo, type InvoiceCheckView, type LineRow, type RefSuggestion } from "../api";
import { pl, plural, poText, qtyKr, refError, refInfo, refLenText, weekText, type InvoiceSummary, type RefInfo, type RefRules } from "../model";

/** Knapptexter får brytas i ekonomins vyer och dialoger (prototypens .eko .btn { white-space: normal }). */
export const WRAP = "[&_button:not([role=tab])]:whitespace-normal";

// ---------------------------------------------------------------- KPI-rutor (värdet krymper så att det ryms, som prototypens .eko-kpis)
export function EkoKpis({ children }: { children: ReactNode }) {
  return <div className="eko-kpis grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-4">{children}</div>;
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
/**
 * Stopp och retur: konturmärke med röd ikon (Min veckas stil, beslut 2026-10-06) – inte röd ram, så att det enda röda på
 * sidan är det som brådskar (preskriptionsrisken). Status visas fortfarande med text + ikon.
 */
const RED_ICON = "[&_svg]:text-rod";
const STATUS: Record<string, { tone: BadgeTone; icon: IconName; red?: boolean }> = {
  draft: { tone: "grey", icon: "file" },
  approved: { tone: "outline", icon: "check" },
  fortnox_created: { tone: "bluetone", icon: "upload" },
  booked: { tone: "bluetone", icon: "book" },
  sent: { tone: "bluetone", icon: "send" },
  paid: { tone: "blue", icon: "check-circle" },
  returned: { tone: "outline", icon: "reply", red: true },
  manual: { tone: "dark", icon: "edit" },
  blocked: { tone: "outline", icon: "x-circle", red: true },
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
    <Badge tone={m.tone} icon={m.icon} className={m.red ? RED_ICON : undefined}>
      {invoiceStatusLabel(status)}
    </Badge>
  );
}

// ---------------------------------------------------------------- Kontroller
export const CHECK: Record<string, { tone: BadgeTone; icon: IconName; word: string; className?: string }> = {
  blocking: { tone: "outline", icon: "x-circle", word: "Stoppar fakturan", className: RED_ICON },
  needs_approval: { tone: "grey", icon: "clock", word: "Kräver godkännande" },
  approved: { tone: "bluetone", icon: "check", word: "Godkänd" },
  warning: { tone: "outline", icon: "alert-circle", word: "Kontrollera" },
  info: { tone: "outline", icon: "info", word: "Information" },
};
const SHORT: Record<string, string> = {
  buyer_ref: "Referens", po: "Inköpsordernummer", po_mixed: "Olika inköpsordernummer", zero_week: "Ingen närvaro", missing_reg: "Närvaro saknas", too_many: "Fler än 5 veckor", over_order: "Över beställningen",
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
        <Badge
          key={`${c.kind}-${i}`}
          tone={CHECK[c.severity].tone}
          icon={CHECK[c.severity].icon}
          className={CHECK[c.severity].className}
          title={`${c.label}. ${c.text}`}
        >
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
    <Badge tone={r.ok ? "bluetone" : "outline"} icon={r.ok ? "check" : "x-circle"} className={r.ok ? undefined : RED_ICON}>
      {value ? `${value} · ${r.label}` : r.label}
    </Badge>
  );
}

// ---------------------------------------------------------------- Bläddring
export const PAGE_SIZE = 20;
export function Pager({ page, total, onPage, one = "rad", many = "rader" }: { page: number; total: number; onPage: (p: number) => void; one?: string; many?: string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return <span className="text-small text-text-muted">Visar {plural(total, one, many)}</span>;
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
      visas som ”–”. Ärendenumret står på varje rad i fakturan.
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

// ---------------------------------------------------------------- Fakturans beställarreferens (beslut 2026-10-07: en per faktura)
/** Det formulären behöver veta om fakturan. */
export type RefInvoice = { id: string; month: string; title: string; buyerReference: string | null; ref: RefInfo; refSuggestions: RefSuggestion[] };

/**
 * Fyll i eller rätta fakturans beställarreferens. Miljonbemanning fyller i den (kommunen anger den inte i beställningen) –
 * förslagen kommer från en uppgift, förra månadens faktura och beställningarna. Ekonomen bekräftar alltid själv.
 */
export function InvoiceRefForm({ inv, rules, canAct, idSuffix, onDone }: { inv: RefInvoice; rules: RefRules; canAct: boolean; idSuffix?: string; onDone?: (ref: string) => void }) {
  const setRef = useCommand(invoiceSetBuyerRef);
  const [val, setVal] = useState("");
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const id = `eko-ref-${idSuffix ?? inv.id}`;
  const err = refError(val, inv.buyerReference, rules);
  const info = !err && val ? refInfo(val, rules) : null;
  if (!canAct) return null;
  const len = refLenText(rules.billing);
  const save = async () => {
    setTried(true);
    setServerError(null);
    if (err) {
      focusFirstError(document.getElementById(id)?.parentElement);
      return;
    }
    const ref = val.trim();
    const field = document.getElementById(id);
    const res = await setRef.run({ month: inv.month, invoiceId: inv.id, reference: ref }).catch(() => null);
    if (!res || !res.ok) {
      setServerError(res && !res.ok ? (res.message ?? "Referensen kunde inte sparas.") : "Referensen kunde inte sparas. Försök igen.");
      return;
    }
    toast(`Beställarreferensen på ${inv.title.charAt(0).toLowerCase()}${inv.title.slice(1)} är nu ${ref}.`);
    setVal("");
    setTried(false);
    onDone?.(ref);
    if (!field?.closest("[role=dialog]")) focusSectionOf(field);
  };
  return (
    <FixBox>
      <Field
        id={id}
        label={inv.buyerReference ? "Ny beställarreferens" : "Beställarreferens"}
        required
        error={(tried ? err : null) ?? serverError ?? undefined}
        help={info?.unit ? `${len} siffror. Referensen tillhör ${info.unit}.` : `${len} siffror, bara siffror. Använd referensen som kommunen har lämnat – hitta aldrig på en egen.`}
      >
        <Input value={val} onValueChange={setVal} inputMode="numeric" maxLength={10} invalid={(tried && !!err) || !!serverError} />
      </Field>
      <div className="flex flex-wrap items-center gap-1.5">
        {inv.refSuggestions.filter((x) => x.reference !== val).map((x) => (
          <Button key={x.reference} kind="secondary" icon="copy" onClick={() => setVal(x.reference)}>
            Använd {x.reference} ({x.source.charAt(0).toLowerCase()}{x.source.slice(1)})
          </Button>
        ))}
        <Button kind="primary" icon="check" pending={setRef.pending} onClick={() => void save()}>
          Spara referensen
        </Button>
      </div>
    </FixBox>
  );
}

export function InvoiceRefModal({ inv, rules, canAct, onClose }: { inv: RefInvoice; rules: RefRules; canAct: boolean; onClose: () => void }) {
  return (
    <Modal title="Beställarreferens på fakturan" onClose={onClose} className={WRAP}>
      <p>
        {inv.title} har {inv.buyerReference ? <>referensen <b className="tabular-nums">{inv.buyerReference}</b>.</> : "ingen referens."} {inv.ref.text}
      </p>
      <InvoiceRefForm inv={inv} rules={rules} canAct={canAct} idSuffix={`modal-${inv.id}`} onDone={onClose} />
      <DemoNote>Ändringen loggas i revisionsloggen med gammal och ny referens. Kommunen får ingen notis.</DemoNote>
    </Modal>
  );
}

/** Fakturans inköpsordernummer: bara kommunens eget ordernummer (99…) – aldrig ärendenumret eller andra egna nummer. */
export function InvoicePoForm({ inv, rules, idSuffix }: { inv: { id: string; month: string; purchaseOrderNumber: string; poSet: boolean }; rules: RefRules; idSuffix?: string }) {
  const setPo = useCommand(invoiceSetPo);
  const [val, setVal] = useState(inv.purchaseOrderNumber);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const id = `eko-po-${idSuffix ?? inv.id}`;
  const v = val.trim();
  const err = CASE_NUMBER_RE.test(v) ? "Ärendenumret får aldrig stå som inköpsordernummer. Fältet är bara för kommunens eget ordernummer." : poNumberError(v, { billing: rules.billing });
  const changed = v !== inv.purchaseOrderNumber || (!inv.poSet && v === "");
  const save = async () => {
    setTried(true);
    setServerError(null);
    if (err) return;
    const res = await setPo.run({ month: inv.month, invoiceId: inv.id, purchaseOrderNumber: v }).catch(() => null);
    if (!res || !res.ok) {
      setServerError(res && !res.ok ? (res.message ?? "Inköpsordernumret kunde inte sparas.") : "Inköpsordernumret kunde inte sparas. Försök igen.");
      return;
    }
    toast(v ? `Inköpsordernumret är nu ${v}.` : "Fakturan har inget inköpsordernummer.");
    setTried(false);
  };
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <div className="min-w-[min(100%,260px)] flex-1">
        <Field
          id={id}
          label="Inköpsordernummer (valfritt)"
          error={(tried ? err : null) ?? serverError ?? undefined}
          help={`Bara kommunens eget ordernummer, ${poText(rules.billing)}, om kommunen har beställt via sin e-handel. Lämna tomt annars.`}
        >
          <Input value={val} onValueChange={setVal} inputMode="numeric" maxLength={20} invalid={(tried && !!err) || !!serverError} />
        </Field>
      </div>
      <Button kind="secondary" icon="check" disabled={!changed} pending={setPo.pending} onClick={() => void save()}>
        Spara inköpsordernummer
      </Button>
    </div>
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

/** Upparbetat och återstående för en fakturarad – samma siffror och ord som radens anmärkning på fakturan. */
export function SummaryList({ inv, sm }: { inv: Pick<LineRow, "weeks">; sm: InvoiceSummary }) {
  const months = (t: InvoiceSummary["returned"]) => t.months.map((r) => monthName(r.mk)).join(", ");
  return (
    <div className="flex w-full flex-col">
      <LedgerRow label="Tidigare fakturerat" sub="Skapat i Fortnox eller manuellt fakturerat" value={qtyKr(sm.billed)} />
      {sm.returned.qty > 0 && (
        <LedgerRow
          strong
          label="Faktureras om"
          sub={`${pl(sm.returned.months.length, "Returnerad faktura", "Returnerade fakturor")} för ${months(sm.returned)}. Krediteras och faktureras på nytt.`}
          value={qtyKr(sm.returned)}
        />
      )}
      {sm.pending.qty > 0 && (
        <LedgerRow label="Ännu inte fakturerat" sub={`Från ${months(sm.pending)} – faktureras på fakturan för den månaden`} value={qtyKr(sm.pending)} />
      )}
      <LedgerRow label="Denna faktura" sub={weekText(inv.weeks)} value={qtyKr(sm.current)} />
      <LedgerRow sum label="Upparbetat inklusive denna faktura" value={qtyKr(sm.accrued)} />
      <LedgerRow label="Beställning" value={plural(sm.order.qty, "vecka", "veckor")} />
      <LedgerRow strong label={sm.over ? "Över beställningen" : "Återstår av beställningen"} value={sm.over ? plural(sm.over, "vecka", "veckor") : qtyKr(sm.remaining)} />
    </div>
  );
}
