"use client";
// Avtal och konfiguration (/admin/avtal, prototypens admin.avtal): avtalsfakta, konfigurationen i klarspråk med värden som
// inte är fastställda, prislistan, jämförelsen Botkyrka–Kammarkollegiet och Miljonbemannings interna regler.
// Alla värden kommer från contracts.config via frågorna – inget avtalsvärde är hårdkodat här.
import type { ReactNode } from "react";
import { isUnset, unsetHint, type ContractConfig } from "@/core/config";
import { kr, pct, plural } from "@/core/format";
import { endReasonLabel } from "@/core/labels";
import { fmtDate } from "@/core/time";
import { uniq } from "@/core/util";
import { useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import {
  Badge, BuildPhase, Button, Card, Icon, Notice, Page, PerspectiveLink, QueryView, Row, Section, Stack, TabPanel, Table, Tabs, cn, type IconName, type TabDef,
} from "@/ui";
import { adminCompare, adminContract, type CompareContract, type ContractFacts, type ContractSummary, type ContractView } from "../api";
import {
  cap, DATA_ROLE, exportText, findUnset, humanPattern, KPI_LABEL, LANGUAGE, meetingText, OCCASION, PRICE_CODE, priceLine, ROLE_WORD, SLA_LABEL, slaRuleText, UNIT,
  UNSET_INFO, whoDecides, WINDOW,
} from "../contract-text";
import { withinText } from "../templates";
import { InternalRules } from "./interna";
import { Details, KV, Lines, Masonry, Pre, Small, StackTable, Unset, Val, YesNo } from "./parts";

type AvtalTab = "avtal" | "priser" | "jamfor" | "interna";
const TAB_ALIAS: Record<string, AvtalTab> = { jamforelse: "jamfor", prislista: "priser" };
const TABS: AvtalTab[] = ["avtal", "priser", "jamfor", "interna"];
const tabOf = (v: string | null): AvtalTab => {
  const w = (v && TAB_ALIAS[v]) || v;
  return TABS.includes(w as AvtalTab) ? (w as AvtalTab) : "avtal";
};

export function AvtalScreen({ query }: ScreenProps) {
  const nav = useNav();
  const { user } = useSession();
  const avtal = query.get("avtal");
  const tab = tabOf(query.get("flik"));
  const q = useQuery(adminContract, avtal ? { contractId: avtal } : {});
  const go = (next: { avtal?: string | null; flik?: AvtalTab }) =>
    nav.replace(path("/admin/avtal", { avtal: next.avtal !== undefined ? next.avtal : avtal, flik: (next.flik ?? tab) === "avtal" ? null : (next.flik ?? tab) }));
  const unsetN = q.data ? findUnset(q.data.config).length : null;
  const tabs: TabDef<AvtalTab>[] = [
    { id: "avtal", label: "Avtal och regler", icon: "file", count: unsetN },
    { id: "priser", label: "Prislista", icon: "card" },
    { id: "jamfor", label: "Jämför avtalen", icon: "layers" },
    { id: "interna", label: "Interna regler (Miljonbemanning)", icon: "bell" },
  ];
  return (
    <Page
      title="Avtal och konfiguration"
      eyebrow={`Systemadmin · ${user.name}`}
      lead="Ett avtal är en konfiguration. Samma kod används för Botkyrka och Kammarkollegiet – mål, svarstider, priser och rapportregler läses härifrån och är aldrig hårdkodade."
    >
      <Tabs id="avtal" ariaLabel="Delar av avtalet" active={tab} onChange={(id) => go({ flik: id })} tabs={tabs} />
      <TabPanel tabsId="avtal" active={tab} className="flex flex-col gap-6">
        {(tab === "avtal" || tab === "priser") && (
          <QueryView query={q}>
            {(d) => (
              <>
                <ContractPicker contracts={d.contracts} value={d.contract.id} onChange={(id) => go({ avtal: id })} />
                {tab === "avtal" ? <ConfigTab d={d} /> : <PriceTab d={d} />}
              </>
            )}
          </QueryView>
        )}
        {tab === "jamfor" && <CompareTab onShowPrices={(id) => go({ avtal: id, flik: "priser" })} />}
        {tab === "interna" && <InternalRules />}
      </TabPanel>
    </Page>
  );
}

// ================================================================ Avtalsväljaren
function ContractPicker({ contracts, value, onChange }: { contracts: ContractSummary[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="group" aria-label="Välj avtal" className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
      {contracts.map((c) => {
        const on = c.id === value;
        return (
          <button
            type="button"
            key={c.id}
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={cn(
              "flex min-h-full cursor-pointer flex-col gap-2 rounded-card border-[1.5px] border-ljusgra bg-vit p-4 text-left text-antracit [font:inherit] hover:border-antracit",
              on && "border-2 border-antracit shadow-[inset_5px_0_0_var(--color-rod)]",
            )}
          >
            <span className="flex items-center gap-2 font-extrabold">
              <Icon name={c.operational ? "building" : "briefcase"} />
              {c.customerName}
            </span>
            <span className="text-small text-text-muted">
              {c.name} · {c.contractNumber}
            </span>
            <Row gap="sm">
              {c.status === "active" ? (
                <Badge tone="blue" icon="check">
                  Aktivt sedan {fmtDate(c.startsOn)}
                </Badge>
              ) : (
                <>
                  <Badge tone="outline" icon="clock">
                    Utkast – startar {fmtDate(c.startsOn)}
                  </Badge>
                  <BuildPhase fas={4} />
                </>
              )}
            </Row>
          </button>
        );
      })}
    </div>
  );
}

// ================================================================ Avtal och regler
function UnsetWarnings({ config }: { config: ContractConfig }) {
  const nav = useNav();
  const list = findUnset(config);
  if (!list.length) return null;
  return (
    <Notice tone="warn" icon="alert" title={`${plural(list.length, "värde är", "värden är")} inte fastställda – reglerna aktiveras inte`}>
      <Stack gap="sm" className="mt-1">
        <p>Systemet vägrar aktivera en regel som fortfarande har värdet ATT_FASTSTÄLLA. Värdena är markerade i korten nedan.</p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          {list.map((u) => {
            const info = UNSET_INFO[u.path];
            const hint = unsetHint(u.value);
            return (
              <li key={u.path}>
                <b>{info ? info[0] : u.path}</b> – {info ? whoDecides(info[1]) : "Ska fastställas"}
                {hint && <span className="text-text-muted"> ({/^(Förslag|Alternativ|Fastställs)/.test(hint) ? hint.charAt(0).toLowerCase() + hint.slice(1) : hint})</span>}
              </li>
            );
          })}
        </ul>
        <DemoOnly>
          <div>
            <Button kind="secondary" icon="help" onClick={() => nav.push("/om/fragor")}>
              Öppna frågor till Botkyrka
            </Button>
          </div>
        </DemoOnly>
      </Stack>
    </Notice>
  );
}

function FactsCard({ k, yearShort }: { k: ContractFacts; yearShort: string }) {
  return (
    <Card title="Avtalsfakta" icon="file">
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 max-[620px]:grid-cols-1">
        <KV
          items={[
            ["Kund", `${k.customerName} (${k.customerOrgNr})`],
            ["Leverantör", `${k.supplierName} (${k.supplierOrgNr})`],
            ["Avtal", k.name],
            ["Avtalsnummer", k.contractNumber],
            ["Diarienummer", k.dnr],
            ["Avtalsperiod", k.endsOn ? `${fmtDate(k.startsOn)} – ${fmtDate(k.endsOn)}` : `Från ${fmtDate(k.startsOn)}`],
            ["Uppsägning", k.termination ?? "–"],
          ]}
        />
        <KV
          items={[
            ["Status", k.status === "active" ? <Badge tone="blue" icon="check">Aktivt</Badge> : <Badge tone="outline" icon="clock">Utkast</Badge>],
            ["Personuppgiftsroll", DATA_ROLE[k.dataRole] ?? k.dataRole],
            ["Ärendeprefix", `${k.casePrefix} – till exempel ${k.casePrefix}-${yearShort}-0001`],
            ["Tillåtna e-postdomäner", k.emailDomains.length ? k.emailDomains.join(", ") : "Inga ännu – läggs till före start"],
            ["Avtalsansvarig", k.managerName],
            ["Omfattning", k.scope ?? "–"],
          ]}
        />
      </div>
    </Card>
  );
}

type CardDef = {
  title: string;
  icon: IconName;
  flush?: boolean;
  wide?: boolean;
  has: (c: ContractConfig) => boolean;
  body: (c: ContractConfig, d: ContractView) => ReactNode;
  foot?: (c: ContractConfig) => ReactNode;
};

const Sub = ({ children }: { children?: ReactNode }) => <div className="mt-1 text-small text-text-muted">{children}</div>;
const pctOrUnset = (v: number | string | undefined | null) => (v == null ? "–" : isUnset(v) ? <Unset v={v} /> : pct(v as number, 0));

const CARDS: Record<string, CardDef> = {
  synlighet: {
    title: "Synlighet för kunden", icon: "eye", has: (c) => !!c.customerVisibility,
    body: (c, d) => {
      const v = c.customerVisibility!;
      const scopeWord: Record<string, string> = { own: "egna ärenden", unit: "enhetens ärenden", all: "alla ärenden" };
      const channelWord: Record<string, string> = { email: "mejl (formell kanal)", portal: "portal", phone: "telefon" };
      return (
        <Stack>
          <KV
            items={[
              "scope" in v && ["Ärenden kommunens användare ser", <><Val v={v.scope} />{v.prototypeScope && <Sub>I prototypen: {scopeWord[v.prototypeScope]}</Sub>}</>],
              ["Individrapporter", <YesNo key="v" v={!!v.seesIndividualReports} />],
              ["Coachanteckningar", <YesNo key="v" v={!!v.seesCoachNotes} />],
              "seesSlaStats" in v && ["SLA-statistik", <><YesNo v={!!v.seesSlaStats} /><div className="text-small text-text-muted">Öppen fråga 17 till ledningen.</div></>],
              c.reportDelivery && ["Rapporter levereras", c.reportDelivery.channel === "portal" ? "I portalen – mottagaren får en notis utan personuppgifter" : c.reportDelivery.channel],
              c.reportDelivery && ["Rapport som bilaga i e-post", <YesNo key="v" v={!!c.reportDelivery.emailAttachmentAllowed} />],
              c.orderChannels && ["Beställningskanaler", cap(c.orderChannels.map((o) => channelWord[o] ?? o).join(", "))],
              c.thirdCountryProcessing && ["Behandling utanför EU/EES", c.thirdCountryProcessing === "forbidden_without_written_approval" ? "Förbjuden utan kommunens skriftliga förhandsgodkännande" : c.thirdCountryProcessing],
            ]}
          />
          {d.contract.operational && (
            <Stack gap="sm">
              <Small>Det interna målet visas aldrig för kommunen – bara avtalsmålet.</Small>
              <DemoOnly>
                <div>
                  <PerspectiveLink role="kommun_chef" to="/portal/bestallarrapport" label="Se kundens beställarrapport" />
                </div>
              </DemoOnly>
            </Stack>
          )}
        </Stack>
      );
    },
  },
  faser: {
    title: "Faser", icon: "layers", has: (c) => !!c.phases,
    body: (c) => (
      <ol className="m-0 flex flex-col gap-2 pl-[22px]">
        {c.phases!.map((p) => (
          <li key={p.no} className="list-decimal">
            <b>Fas {p.no}</b> · {p.name}
          </li>
        ))}
      </ol>
    ),
  },
  fastnat: {
    title: "Fastnat i en fas", icon: "clock", has: (c) => !!c.stuckRules,
    body: (c, d) => {
      const pn = (no: number) => (c.phases ?? []).find((p) => p.no === no)?.name ?? "";
      return (
        <Stack gap="sm">
          <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
            {c.stuckRules!.map((r) => (
              <li key={r.phase}>
                Fas {r.phase} ({pn(r.phase)}): flaggas efter {r.maxDays} dagar{r.unlessPlacementPlanned ? " – utom när praktik är planerad" : ""}.
              </li>
            ))}
          </ul>
          {d.stuckCount != null && <Small>Just nu flaggas {plural(d.stuckCount, "ärende", "ärenden")}. Flaggan går till coach och samordnare.</Small>}
        </Stack>
      );
    },
  },
  progression: {
    title: "Progression", icon: "trending-up", has: (c) => !!c.progression,
    body: (c) => {
      const p = c.progression!;
      const lab = (k: string) => p.areaLabels[k] ?? k;
      return (
        <Stack>
          <Stack gap="sm">
            <div className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Skala</div>
            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
              {Object.entries(p.scale).map(([k, v]) => (
                <li key={k}>
                  <b>{k}</b> – {v}
                </li>
              ))}
            </ul>
          </Stack>
          <Stack gap="sm">
            <div className="text-label font-bold tracking-[0.09em] text-text-muted uppercase">Områden ({p.areas.length})</div>
            <ul className="m-0 list-disc pl-5">
              {p.areas.map((k) => (
                <li key={k}>{lab(k)}</li>
              ))}
            </ul>
            {p.optionalAreas.length > 0 && <Small>Valfria områden (öppen fråga 12): {p.optionalAreas.map(lab).join(", ")}.</Small>}
          </Stack>
          <KV
            items={[
              ["Observation krävs", `Från nivå ${p.observationRequiredFromLevel}`],
              ["Tydlig progression", cap(p.statDefinition.clear.replace(">=", "≥"))],
              ["Någon progression", cap(p.statDefinition.any.replace(">=", "≥"))],
            ]}
          />
        </Stack>
      );
    },
  },
  narvaro: {
    title: "Närvaro", icon: "check-square", has: (c) => !!c.attendance,
    body: (c) => (
      <KV
        items={[
          ["Frånvaronotis samma dag", <Val key="v" v={c.attendance!.sameDayNoticeOnInvalidAbsence} />],
          ["Upprepad ogiltig frånvaro", `${c.attendance!.repeatedAbsenceRule.absentInvalid} tillfällen inom ${c.attendance!.repeatedAbsenceRule.withinDays} dagar ger flagga och förslag på uppföljningsmöte`],
          ["Veckorapport", "Närvaro på deltagarnivå varje vecka, en rapport per handläggare"],
        ]}
      />
    ),
  },
  moten: {
    title: "Mötesminimum", icon: "calendar", has: (c) => !!c.meetingMinimums,
    body: (c) => (
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
        {c.meetingMinimums!.map((m, i) => (
          <li key={i}>{meetingText(m)}</li>
        ))}
      </ul>
    ),
  },
  resultat: {
    title: "Resultat", icon: "target", has: (c) => !!c.result,
    body: (c) => {
      const r = c.result!;
      return (
        <KV
          items={[
            ["Definition", <><Val v={r.definition} />{r.prototypeDefinition && <Sub>{r.prototypeDefinition}</Sub>}</>],
            ["Räknas som resultat", r.countsAsResult.map((x) => endReasonLabel(x)).join(", ")],
            ["Räknas inte i nämnaren", <><Val v={r.excludedFromDenominator} />{r.prototypeExcluded && <Sub>I prototypen: {r.prototypeExcluded.map((x) => endReasonLabel(x).toLowerCase()).join(", ")}.</Sub>}</>],
            ["Kräver verifiering", <><YesNo v={!!r.requiresVerification} /><div className="text-small text-text-muted">Utan verifiering visas resultatet som preliminärt.</div></>],
          ]}
        />
      );
    },
  },
  kpi: {
    title: "Nyckeltal (KPI:er)", icon: "chart", flush: true, wide: true, has: (c) => !!c.kpis,
    foot: (c) => {
      const r = c.kpis!.find((k) => k.notify);
      return r?.notify ? (
        <span className="text-small text-text-muted">
          Flagga under internt mål: {r.notify.belowInternal.map((x) => ROLE_WORD[x] ?? x).join(", ")}. Under avtalsmål: {r.notify.belowContract.map((x) => ROLE_WORD[x] ?? x).join(", ")}.
        </span>
      ) : null;
    },
    body: (c) => {
      const kpis = c.kpis!;
      const withN = kpis.some((k) => k.minN != null);
      return (
        <Table
          caption="Nyckeltal och mål"
          rows={kpis.map((k) => ({ ...k, id: k.key }))}
          columns={[
            {
              key: "label", label: "Nyckeltal",
              render: (k) => (
                <>
                  <div className="font-bold">{k.label ?? KPI_LABEL[k.key] ?? k.key}</div>
                  {k.windows && <div className="text-small text-text-muted">{cap(k.windows.map((w) => WINDOW[w] ?? w).join(", "))}</div>}
                </>
              ),
            },
            { key: "ct", label: "Avtalsmål", render: (k) => pctOrUnset(k.contractTarget) },
            { key: "it", label: "Internt mål", render: (k) => pctOrUnset(k.internalTarget) },
            ...(withN ? [{ key: "n", label: "Minsta underlag", render: (k: (typeof kpis)[number]) => (k.minN != null ? `${k.minN} avslut` : "–") }] : []),
          ]}
        />
      );
    },
  },
  sla: {
    title: "Svarstider och sista dagar (SLA)", icon: "clock", flush: true, wide: true, has: (c) => !!c.sla,
    body: (c) => (
      <Table
        caption="SLA"
        rows={c.sla!.map((s) => ({ ...s, id: s.key }))}
        columns={[
          { key: "label", label: "Vad", render: (s) => <span className="font-bold">{s.label ?? SLA_LABEL[s.key] ?? s.key}</span> },
          { key: "rule", label: "Regel", render: (s) => slaRuleText(s) ?? <Unset v={isUnset(s.within) ? s.within : s.due} /> },
          { key: "auto", label: "Automatiskt", render: (s) => (s.automatic ? <YesNo v /> : "–") },
        ]}
      />
    ),
  },
  puls: {
    title: "Pulsmätning", icon: "smile", has: (c) => !!c.pulse,
    body: (c) => {
      const p = c.pulse!;
      return (
        <KV
          items={[
            ["Tillfällen", cap(p.occasions.map((o) => OCCASION[o] ?? o).join(" och "))],
            ["Långa insatser", `Även var ${p.periodicEveryDays}:e dag`],
            ["Språk", cap(p.languages.map((l) => LANGUAGE[l] ?? l).join(", "))],
            ["Sammanställning", `Visas först vid minst ${p.minNForAggregate} svar`],
            ["Synlighet", "Coachen ser inte enskilda svar"],
          ]}
        />
      );
    },
  },
  statistik: {
    title: "Statistik", icon: "chart", has: (c) => !!c.statistics,
    body: (c) => (
      <KV
        items={[
          ["På begäran", `Högst ${c.statistics!.onRequestMaxPerYear} gånger per år, även ett år efter avtalsslut`],
          ["Kostnadsfritt", <YesNo key="v" v={!!c.statistics!.free} />],
        ]}
      />
    ),
  },
  fakturering: {
    title: "Fakturering", icon: "card", has: (c) => !!c.billing,
    body: (c) => {
      const b = c.billing!;
      const fallback: Record<string, string> = { export_xlsx_pdf: "export till Excel och PDF", botkyrka_fakturaportal: "Botkyrkas fakturaportal" };
      return (
        <KV
          items={[
            ["Enhet", UNIT[b.unit] ?? b.unit],
            ["Debiterbar vecka", b.billableWeekRule === "every_iso_week_with_at_least_one_enrolled_day_excluding_paused_weeks" ? "Alla ISO-veckor med minst en inskriven dag, utom pausade veckor" : b.billableWeekRule],
            ["Veckans månad", b.weekToMonthRule === "iso_thursday" ? "Den månad där veckans torsdag infaller" : b.weekToMonthRule],
            ["Veckor utan närvaro", b.flagZeroAttendanceWeeks ? "Flaggas för kontroll före fakturering" : "Flaggas inte"],
            ["Fakturor", b.invoicePer === "case_and_month" ? "En faktura per ärende och månad" : b.invoicePer],
            ["Samlingsfaktura", <YesNo key="v" v={!!b.collectiveInvoiceAllowed} yes="Tillåten" no="Inte tillåten" />],
            ["Beställarreferens", `${b.buyerReference.required ? "Krävs" : "Frivillig"} – ${humanPattern(b.buyerReference.pattern)}`],
            ["Inköpsordernummer", `${b.purchaseOrderNumber.required ? "Krävs" : "Bara om kommunen lämnat ett"} – ${humanPattern(b.purchaseOrderNumber.pattern)}`],
            ["Faktureringsobjekt", b.invoicedObject === "case_number" ? "Ärendenumret" : b.invoicedObject],
            ["Upparbetat och återstående", <YesNo key="v" v={!!b.showAccruedAndRemaining} yes="Anges på fakturan" no="Anges inte" />],
            ["Betalningsvillkor", `${b.paymentTermsDays} dagar`],
            ["Ofakturerat", `Varning efter ${b.unbilledWarningDays} dagar`],
            ["Format", b.format === "peppol_bis_3_via_fortnox" ? "Peppol BIS Billing 3 via Fortnox" : b.format],
            ["Reserv", cap(b.fallback.map((f) => fallback[f] ?? f).join(", "))],
          ]}
        />
      );
    },
  },
  bonus: {
    title: "Bonus", icon: "award", has: (c) => !!c.bonus,
    body: (c, d) => (
      <KV
        items={[
          ["Status", <Row key="v" gap="sm">{c.bonus!.enabled ? "Aktiv" : "Avstängd – modellen ej fastställd"}<BuildPhase fas={3} /></Row>],
          ["Modell", <Val key="v" v={c.bonus!.model} />],
          ["Egen faktura", <YesNo key="v" v={!!c.bonus!.separateInvoice} />],
          ["Underlag samlas in", `${plural(d.bonusCandidates, "händelse", "händelser")} markerade som möjligt bonusunderlag`],
        ]}
      />
    ),
  },
  viten: {
    title: "Viten och avvikelser", icon: "alert-circle", has: (c) => !!c.penalties,
    body: (c) => (
      <KV
        items={[
          ["Vite vid avvikelse", `${kr(c.penalties!.deviationOre)} per tillfälle`],
          ["Vite vid bristfällig information", `${kr(c.penalties!.insufficientInformationOre)} per tillfälle`],
          !!c.economicDeviation && ["Ekonomisk avvikelse", c.economicDeviation],
          c.keyPersonnelChangeRequiresApproval !== undefined && ["Byte av nyckelpersonal", c.keyPersonnelChangeRequiresApproval ? "Kräver kommunens godkännande" : "Kräver inte godkännande"],
        ]}
      />
    ),
  },
  eskalering: {
    title: "Eskaleringstrappa", icon: "flag", flush: true, wide: true, has: (c) => !!c.escalationLadder,
    foot: (c) => {
      const w = c.escalationLadder!.filter((x) => /skriftlig varning/i.test(x.text)).map((x) => x.step);
      return (
        <span className="text-small text-text-muted">
          {w.length ? `Skriftliga varningar kan ges på steg ${w.length > 1 ? `${Math.min(...w)}–${Math.max(...w)}` : w[0]}. ` : ""}
          {c.warningsBeforeTermination} varningar kan leda till uppsägning.
        </span>
      );
    },
    body: (c) => (
      <Table
        caption="Eskaleringstrappa"
        rows={c.escalationLadder!.map((s) => ({ ...s, id: String(s.step) }))}
        columns={[
          { key: "step", label: "Steg", num: true },
          { key: "level", label: "Nivå", render: (s) => cap(s.level) },
          { key: "text", label: "Innebörd" },
        ]}
      />
    ),
  },
  avslut: {
    title: "Avslut och gallring", icon: "database", has: (c) => !!c.termination,
    body: (c) => (
      <KV
        items={[
          ["Återlämning av data", `Inom ${c.termination!.returnDataWithinDays} dagar efter avtalsslut`],
          ["Radering efter återlämning", <YesNo key="v" v={!!c.termination!.deleteAfterReturn} />],
          "retention" in c && ["Gallring under avtalstiden", <Val key="v" v={c.retention} />],
        ]}
      />
    ),
  },
  ai: {
    title: "AI-stöd", icon: "sparkles", has: (c) => !!c.ai,
    body: (c) => (
      <KV
        items={[
          ["Status", <Row key="v" gap="sm">Test pågår<BuildPhase fas={2} /></Row>],
          ["AI-leverantör", <Val key="v" v={c.ai!.provider} />],
          ["Inspelning", c.ai!.recordingApprovedByCustomer ? `Godkänd av kommunen ${fmtDate(c.ai!.recordingApprovedByCustomer)} – kräver deltagarens samtycke` : "–"],
        ]}
      />
    ),
  },
  exporter: {
    title: "Exporter", icon: "download", has: (c) => !!c.exports,
    body: (c) => (
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
        {c.exports!.map((x) => (
          <li key={x.key}>{exportText(x)}</li>
        ))}
      </ul>
    ),
  },
};

const SECTIONS: [string, string[]][] = [
  ["Leverans och insyn", ["synlighet", "faser", "fastnat", "progression", "narvaro", "moten"]],
  ["Mål och uppföljning", ["resultat", "kpi", "sla", "puls", "statistik"]],
  ["Ekonomi och avtalsvillkor", ["fakturering", "bonus", "viten", "eskalering", "avslut", "ai", "exporter"]],
];

function ConfigTab({ d }: { d: ContractView }) {
  const cfg = d.config;
  const card = (key: string) => {
    const c = CARDS[key];
    return (
      <Card key={key} title={c.title} icon={c.icon} flush={c.flush} foot={c.foot ? c.foot(cfg) : undefined}>
        {c.body(cfg, d)}
      </Card>
    );
  };
  return (
    <Stack gap="lg">
      {d.contract.operational ? (
        <UnsetWarnings config={cfg} />
      ) : (
        <Notice tone="info" title={`Utkast – avtalet startar ${fmtDate(d.contract.startsOn)}`}>
          Konfigurationen är en skiss som visar att samma kod räcker. Övriga regler (faser, fakturering, puls med mera) läggs in när KK-avtalet konfigureras i utvecklingsfas 4. Kontrollera i KK-avtalet om dagarna är kalender- eller arbetsdagar och vilka de åtta statistikfälten är.
        </Notice>
      )}
      <FactsCard k={d.contract} yearShort={d.yearShort} />
      {SECTIONS.map(([title, keys]) => {
        const ks = keys.filter((k) => CARDS[k].has(cfg));
        if (!ks.length) return null;
        const wide = ks.filter((k) => CARDS[k].wide);
        const narrow = ks.filter((k) => !CARDS[k].wide);
        return (
          <Section title={title} key={title}>
            {wide.map(card)}
            {narrow.length > 0 && <Masonry items={narrow.map(card)} />}
          </Section>
        );
      })}
      <Details summary="JSON (contracts.config)">
        <p className="mb-2.5 text-small text-text-muted">Så lagras konfigurationen i databasen. Den valideras med ett zod-schema innan den sparas.</p>
        <Pre text={JSON.stringify(cfg, null, 2)} />
      </Details>
    </Stack>
  );
}

// ================================================================ Prislista
function PriceTab({ d }: { d: ContractView }) {
  const cfgItems = d.config.priceItems;
  if (cfgItems) {
    return (
      <Card
        title="Prislista – skiss"
        icon="card"
        flush
        actions={<Badge tone="plan" icon="alert-circle">Skiss – kontrolleras mot KK-avtalet</Badge>}
        foot={<span className="text-small text-text-muted">Paket-, månads- och styckpriser hanteras med samma tabell (price_items.unit) som Botkyrkas veckopriser.</span>}
      >
        <Table
          caption="Prislista Kammarkollegiet"
          rows={cfgItems.map((p) => ({ ...p, id: p.code }))}
          columns={[
            { key: "code", label: "Tjänst", render: (p) => <span className="font-bold">{PRICE_CODE[p.code] ?? p.code}</span> },
            { key: "unit", label: "Enhet", render: (p) => `${UNIT[p.unit] ?? p.unit}${p.packageMonths ? ` (${p.packageMonths} månader)` : ""}` },
            { key: "price", label: "Pris exkl. moms", num: true, render: (p) => kr(p.priceOre) },
          ]}
        />
      </Card>
    );
  }
  const items = d.priceItems;
  const prices = items.map((p) => p.priceOre);
  return (
    <Card
      title="Prislista – pris per deltagare och vecka"
      icon="card"
      flush
      actions={<Badge tone="plan" icon="alert-circle">Exempelpriser – de riktiga priserna står i avtalet</Badge>}
      foot={
        <span className="text-small text-text-muted">
          Priserna är fasta i 12 månader. Därefter får de justeras enligt indexklausulen i avtalet, högst en gång per tolvmånadersperiod och aldrig retroaktivt. Vid justering skapas en ny rad med nytt giltighetsdatum – den gamla sparas.
        </span>
      }
    >
      <Row className="border-b border-ljusgra px-[18px] py-4">
        <span>
          <b>{items.length}</b> avtalsområden
        </span>
        {items.length > 0 && (
          <span>
            <b>
              {kr(Math.min(...prices))}–{kr(Math.max(...prices))}
            </b>{" "}
            per deltagare och vecka exkl. moms
          </span>
        )}
        <span className="text-text-muted">Artikelnummer matchar artiklarna i Fortnox</span>
      </Row>
      <Table
        caption="Prislista Botkyrka"
        rows={items}
        columns={[
          { key: "area", label: "Avtalsområde", render: (p) => p.areaName },
          { key: "art", label: "Artikelnummer", render: (p) => <span className="tabular-nums tracking-[0.01em]">{p.fortnoxArticleNo}</span> },
          { key: "unit", label: "Enhet", render: (p) => UNIT[p.unit] ?? p.unit },
          { key: "price", label: "Pris exkl. moms", num: true, nowrap: true, render: (p) => kr(p.priceOre) },
          { key: "vat", label: "Moms", num: true, render: (p) => `${p.vatRate} %` },
          { key: "valid", label: "Giltig", nowrap: true, render: (p) => `${fmtDate(p.validFrom)} – ${fmtDate(p.validTo)}` },
        ]}
      />
    </Card>
  );
}

// ================================================================ Jämför avtalen
function CompareTab({ onShowPrices }: { onShowPrices: (contractId: string) => void }) {
  const q = useQuery(adminCompare, {});
  return <QueryView query={q}>{(d) => <CompareContent contracts={d.contracts} yearShort={d.yearShort} onShowPrices={onShowPrices} />}</QueryView>;
}

function CompareContent({ contracts, yearShort, onShowPrices }: { contracts: CompareContract[]; yearShort: string; onShowPrices: (id: string) => void }) {
  const model = (k: CompareContract) =>
    cap(uniq(k.config.priceItems ? k.config.priceItems.map((p) => p.unit) : k.priceUnits).map((u) => (UNIT[u] ?? u).toLowerCase()).join(", "));
  const prices = (k: CompareContract): ReactNode => {
    if (k.config.priceItems) return <Lines items={k.config.priceItems.map(priceLine)} />;
    const ps = k.priceOres;
    return ps.length ? `${kr(Math.min(...ps))}–${kr(Math.max(...ps))} per deltagare och vecka beroende på avtalsområde (exempelpriser)` : "–";
  };
  const kpis = (k: CompareContract) => (
    <Lines
      items={(k.config.kpis ?? [])
        .filter((x) => typeof x.contractTarget === "number")
        .map((x) => `${x.label ?? KPI_LABEL[x.key] ?? x.key}: ${pct(x.contractTarget, 0)}${typeof x.internalTarget === "number" ? ` (internt mål ${pct(x.internalTarget, 0)})` : ""}`)}
    />
  );
  const FROM: Record<string, string> = { avrop_mottaget: "från att avropet kommit in", avslutsdatum: "från avslutsdatum", bestallning: "från beställning" };
  const sla = (k: CompareContract) => (
    <Lines
      items={(k.config.sla ?? [])
        .filter((x) => x.within && typeof x.within === "object" && !x.automatic)
        .map((x) => `${x.label ?? SLA_LABEL[x.key] ?? x.key} inom ${typeof x.within === "object" ? withinText(x.within) : ""} ${FROM[x.from ?? ""] ?? ""}`.trim())}
    />
  );
  const meet = (k: CompareContract) => ((k.config.meetingMinimums ?? []).length ? <Lines items={(k.config.meetingMinimums ?? []).map(meetingText)} /> : "Inget krav");
  const stats = (k: CompareContract) => (
    <Lines items={[k.config.statistics && `På begäran, högst ${k.config.statistics.onRequestMaxPerYear} gånger per år`, ...(k.config.exports ?? []).map(exportText)].filter((x): x is string => !!x)} />
  );
  const status = (k: CompareContract) => (k.facts.status === "active" ? `Aktivt sedan ${fmtDate(k.facts.startsOn)}` : `Utkast – startar ${fmtDate(k.facts.startsOn)}`);
  const rules: [string, (k: CompareContract) => ReactNode][] = [
    ["Status", status],
    ["Personuppgiftsroll", (k) => (k.facts.dataRole === "processor" ? "Personuppgiftsbiträde" : "Personuppgiftsansvarig")],
    ["Ärendenummer", (k) => `${k.facts.casePrefix}-${yearShort}-0001`],
    ["Prismodell", model],
    ["Priser exkl. moms", prices],
    ["Nyckeltal med avtalsmål", kpis],
    ["Svarstider (SLA)", sla],
    ["Mötesminimum", meet],
    ["Kunden ser individrapporter", (k) => <YesNo v={!!k.config.customerVisibility?.seesIndividualReports} />],
    ["Kunden ser coachanteckningar", (k) => <YesNo v={!!k.config.customerVisibility?.seesCoachNotes} />],
    ["Statistik", stats],
  ];
  const [a, b] = contracts;
  if (!a || !b) return <Notice tone="info">Det finns bara ett avtal att visa.</Notice>;
  return (
    <Stack>
      <Notice tone="info" title="Samma kod – ny konfiguration">
        Kammarkollegiet blir avtal nr 2. Kärnflödena är desamma – det som skiljer läses från avtalets konfiguration. Acceptanskriterium i utvecklingsfas 4: KK-avtalet ska kunna konfigureras utan kodändring.
      </Notice>
      <Card
        title={`${a.facts.customerName} och ${b.facts.customerName}`}
        icon="layers"
        flush
        actions={<BuildPhase fas={4} />}
        foot={
          <>
            <span className="text-small text-text-muted">
              Botkyrka betalar per deltagare och vecka, Kammarkollegiet per paket, månad eller styck. Att kontrollera i KK-avtalet: om dagarna i svarstiderna är kalender- eller arbetsdagar, och vilka de åtta statistikfälten är.
            </span>
            <Button kind="secondary" icon="card" onClick={() => onShowPrices(b.facts.id)}>
              Visa {/s$/.test(b.facts.customerName) ? b.facts.customerName : `${b.facts.customerName}s`} prislista
            </Button>
          </>
        }
      >
        <StackTable
          caption="Jämförelse mellan avtalen"
          columns={[
            { label: "Regel", width: "22%", rowHeader: true },
            { label: a.facts.customerName, mobileLabel: true },
            { label: b.facts.customerName, mobileLabel: true },
          ]}
          rows={rules.map(([label, fn]) => ({ key: label, cells: [label, fn(a), fn(b)] }))}
        />
      </Card>
    </Stack>
  );
}

