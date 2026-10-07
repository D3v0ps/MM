"use client";
// Avtal och konfiguration (/admin/avtal, prototypens admin.avtal): avtalsfakta, konfigurationen i klarspråk med värden som
// inte är fastställda och Miljonbemannings interna regler. Prislistan och vitenas belopp visas inte här (beslut 5,
// 2026-10-07: belopp syns bara för rollen ekonom) – prislistan finns under Ekonomi (/ekonomi/prislista). Sidan ligger inte i menyn (beslut 2026-10-06) –
// systemadministratören når den från Användare och roller. Avtalsväljaren visas bara när det finns fler än ett avtal.
// Alla värden kommer från contracts.config via frågorna – inget avtalsvärde är hårdkodat här.
import type { ReactNode } from "react";
import { aiProviderText, isUnset, progressionRuleText, unsetHint, type ContractConfig } from "@/core/config";
import { kr, pct, plural } from "@/core/format";
import { endReasonLabel } from "@/core/labels";
import { fmtDate } from "@/core/time";
import { useQuery } from "@/shell/backend";
import { path, useNav } from "@/shell/nav";
import type { ScreenProps } from "@/shell/routes";
import { DemoOnly, ProtoText } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import {
  Badge, BuildPhase, Button, Card, Icon, Notice, Page, QueryView, Refreshing, Row, Section, Stack, TabPanel, Table, Tabs, cn, type IconName, type TabDef,
} from "@/ui";
import { adminContract, type ContractFacts, type ContractSummary, type ContractView } from "../api";
import { cap, DATA_ROLE, findUnset, humanPattern, LANGUAGE, OCCASION, ROLE_WORD, slaRuleText, UNIT, UNSET_INFO, whoDecides, WINDOW } from "../contract-text";
import { InternalRules } from "./interna";
import { Details, KV, Masonry, Pre, Small, Unset, Val, YesNo } from "./parts";

type AvtalTab = "avtal" | "interna";
// Äldre adresser: ?flik=prislista och ?flik=priser visar avtalet (prislistan finns under Ekonomi, beslut 5). Jämförelsefliken
// finns inte längre – ?flik=jamfor visar också avtalet.
const TABS: AvtalTab[] = ["avtal", "interna"];
const tabOf = (v: string | null): AvtalTab => (TABS.includes(v as AvtalTab) ? (v as AvtalTab) : "avtal");

export function AvtalScreen({ query }: ScreenProps) {
  const nav = useNav();
  const { user } = useSession();
  const avtal = query.get("avtal");
  const tab = tabOf(query.get("flik"));
  // Byte av avtal: det visade avtalet står kvar (dämpat) tills nästa har hämtats – väljaren och fokus ligger kvar.
  const q = useQuery(adminContract, avtal ? { contractId: avtal } : {}, { keepPrevious: true });
  const go = (next: { avtal?: string | null; flik?: AvtalTab }) =>
    nav.replace(path("/admin/avtal", { avtal: next.avtal !== undefined ? next.avtal : avtal, flik: (next.flik ?? tab) === "avtal" ? null : (next.flik ?? tab) }));
  const unsetN = q.data ? findUnset(q.data.config).length : null;
  const tabs: TabDef<AvtalTab>[] = [
    { id: "avtal", label: "Avtal och regler", icon: "file", count: unsetN },
    { id: "interna", label: "Interna regler (Miljonbemanning)", icon: "bell" },
  ];
  return (
    <Page
      title="Avtal och konfiguration"
      eyebrow={`Systemadmin · ${user.name}`}
      crumbs={[{ label: "Användare och roller", to: "/admin/anvandare" }, { label: "Avtal och konfiguration" }]}
      lead="Ett avtal är en konfiguration. Mål, svarstider och rapportregler läses härifrån och är aldrig hårdkodade. Fler kommunavtal kan läggas till utan kodändring. Priser och belopp visas bara för ekonomen."
    >
      <Tabs id="avtal" ariaLabel="Delar av avtalet" active={tab} onChange={(id) => go({ flik: id })} tabs={tabs} />
      <TabPanel tabsId="avtal" active={tab} className="flex flex-col gap-6">
        {tab === "avtal" && (
          <QueryView query={q}>
            {(d) => (
              <Refreshing busy={q.isPlaceholderData}>
                <div className="flex flex-col gap-6">
                  {d.contracts.length > 1 && <ContractPicker contracts={d.contracts} value={d.contract.id} onChange={(id) => go({ avtal: id })} />}
                  <ConfigTab d={d} />
                </div>
              </Refreshing>
            )}
          </QueryView>
        )}
        {tab === "interna" && <InternalRules />}
      </TabPanel>
    </Page>
  );
}

// ================================================================ Avtalsväljaren (bara när det finns fler än ett avtal)
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
  has: (c: ContractConfig, d: ContractView) => boolean;
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
              "scope" in v && ["Ärenden kommunens användare ser", <><Val v={v.scope} />{v.prototypeScope && <Sub><ProtoText>{`I prototypen: ${scopeWord[v.prototypeScope]}`}</ProtoText></Sub>}</>],
              ["Individrapporter", <YesNo key="v" v={!!v.seesIndividualReports} />],
              ["Coachanteckningar", <YesNo key="v" v={!!v.seesCoachNotes} />],
              "seesSlaStats" in v && ["SLA-statistik", <><YesNo v={!!v.seesSlaStats} /><div className="text-small text-text-muted">Öppen fråga 17 till ledningen.</div></>],
              c.reportDelivery && ["Rapporter levereras", c.reportDelivery.channel === "portal" ? "I portalen – mottagaren får en notis utan personuppgifter" : c.reportDelivery.channel],
              c.reportDelivery && ["Rapport som bilaga i e-post", <YesNo key="v" v={!!c.reportDelivery.emailAttachmentAllowed} />],
              c.orderChannels && ["Beställningskanaler", cap(c.orderChannels.map((o) => channelWord[o] ?? o).join(", "))],
              c.thirdCountryProcessing && ["Behandling utanför EU/EES", c.thirdCountryProcessing === "forbidden_without_written_approval" ? "Förbjuden utan kommunens skriftliga förhandsgodkännande" : c.thirdCountryProcessing],
            ]}
          />
          {d.contract.operational && <Small>Det interna målet visas aldrig för kommunen – bara avtalsmålet.</Small>}
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
      const rule = progressionRuleText({ progression: p });
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
              ["Tydlig progression", rule.clear],
              ["Någon progression", rule.any],
            ]}
          />
          <Small>Tydlig och någon progression räknas bara på de obligatoriska områdena. De valfria räknas aldrig i statistiken till kommunen.</Small>
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
  resultat: {
    title: "Resultat", icon: "target", has: (c) => !!c.result,
    body: (c) => {
      const r = c.result!;
      return (
        <KV
          items={[
            ["Definition", <><Val v={r.definition} />{r.prototypeDefinition && <Sub><ProtoText>{r.prototypeDefinition}</ProtoText></Sub>}</>],
            ["Räknas som resultat", r.countsAsResult.map((x) => endReasonLabel(x)).join(", ")],
            ["Räknas inte i nämnaren", <><Val v={r.excludedFromDenominator} />{r.prototypeExcluded && <Sub><ProtoText>{`I prototypen: ${r.prototypeExcluded.map((x) => endReasonLabel(x).toLowerCase()).join(", ")}.`}</ProtoText></Sub>}</>],
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
                  <div className="font-bold">{k.label ?? k.key}</div>
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
          { key: "label", label: "Vad", render: (s) => <span className="font-bold">{s.label ?? s.key}</span> },
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
            ["Fakturor", b.invoicePer === "case_and_month" ? "En faktura per ärende och månad" : b.invoicePer === "contract_and_month" ? "En faktura per avtal och månad med en rad per ärende" : b.invoicePer],
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
          ["Status", <Row key="v" gap="sm">{c.bonus!.enabled ? "Aktiv" : "Avstängd – modellen ej fastställd"}<BuildPhase fas={3} off={!c.bonus!.enabled} /></Row>],
          ["Modell", <Val key="v" v={c.bonus!.model} />],
          ["Egen faktura", <YesNo key="v" v={!!c.bonus!.separateInvoice} />],
          ["Underlag samlas in", `${plural(d.bonusCandidates, "händelse", "händelser")} markerade som möjligt bonusunderlag`],
        ]}
      />
    ),
  },
  viten: {
    title: "Viten och avvikelser", icon: "alert-circle", has: (c, d) => !!c.penalties || d.penaltiesHidden,
    body: (c) => (
      <KV
        items={[
          // Beloppen syns bara för ekonomen (beslut 5) – servern lämnar inte ut dem här.
          ["Vite vid avvikelse", c.penalties ? `${kr(c.penalties.deviationOre)} per tillfälle` : "Per tillfälle enligt avtalet. Beloppet visas bara för ekonomen."],
          ["Vite vid bristfällig information", c.penalties ? `${kr(c.penalties.insufficientInformationOre)} per tillfälle` : "Per tillfälle enligt avtalet. Beloppet visas bara för ekonomen."],
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
          // Bilagor till beställningen (beslut 2026-10-07): raderas när dagarna efter avslutet har gått. Ej fastställt = inget raderas.
          c.retentionRules && [
            "Gallring av bilagor",
            <Val key="v" v={c.retentionRules.attachmentsAfterCloseDays}>{`${plural(Number(c.retentionRules.attachmentsAfterCloseDays), "dag", "dagar")} efter avslutet`}</Val>,
          ],
        ]}
      />
    ),
  },
  bestallning: {
    title: "Beställning och konton", icon: "file-plus", has: (c) => !!c.orderPeriods || !!c.selfRegistration,
    body: (c) => (
      <KV
        items={[
          c.orderPeriods && [
            "Omfattning att välja",
            `${c.orderPeriods.months.map((m) => `${m} månader`).join(" eller ")}${c.orderPeriods.allowOther ? ", eller annan tidsperiod med motivering" : ""}`,
          ],
          [
            "Konto utan inbjudan",
            c.selfRegistration?.emailDomains.length
              ? `Alla med en adress som slutar på @${c.selfRegistration.emailDomains.join(" eller @")} kan skapa ett konto som handläggare`
              : "Nej – bara inbjudna",
          ],
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
          // Leverantören i klarspråk ("Gemini Flash via Google Cloud Vertex AI (EU)"), inte konfigurationens nyckel.
          ["AI-leverantör", <Val key="v" v={c.ai!.provider}>{aiProviderText(c)}</Val>],
          ["Inspelning", c.ai!.recordingApprovedByCustomer ? `Godkänd av kommunen ${fmtDate(c.ai!.recordingApprovedByCustomer)} – kräver deltagarens samtycke` : "–"],
        ]}
      />
    ),
  },
};

const SECTIONS: [string, string[]][] = [
  ["Leverans och insyn", ["synlighet", "bestallning", "faser", "fastnat", "progression", "narvaro"]],
  ["Mål och uppföljning", ["resultat", "kpi", "sla", "puls", "statistik"]],
  ["Ekonomi och avtalsvillkor", ["fakturering", "bonus", "viten", "eskalering", "avslut", "ai"]],
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
          Konfigurationen är inte komplett. Ärenden kan hanteras först när alla regler (faser, fakturering, pulsmätning med mera) är inlagda.
        </Notice>
      )}
      <FactsCard k={d.contract} yearShort={d.yearShort} />
      {SECTIONS.map(([title, keys]) => {
        const ks = keys.filter((k) => CARDS[k].has(cfg, d));
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
        <p className="mb-2.5 text-small text-text-muted">
          Så lagras konfigurationen i databasen. Den valideras med ett zod-schema innan den sparas.{d.penaltiesHidden ? " Vitenas belopp visas bara för ekonomen och är borttagna här." : ""}
        </p>
        <Pre text={JSON.stringify(cfg, null, 2)} />
      </Details>
    </Stack>
  );
}

