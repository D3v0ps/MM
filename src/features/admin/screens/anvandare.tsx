"use client";
// Användare och roller (/admin/anvandare, prototypens admin.anvandare). Systemadmin ser personalen, kommunens användare och
// behörighetsmatrisen; avtalsansvarig ser kommunanvändarna (bjuder in och spärrar). Bara inbjudna konton – ingen självregistrering.
import { useState } from "react";
import type { EscalationRole } from "@/core/config";
import { fmtDateShort, fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { DemoOnly } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import {
  Avatar, Badge, Button, Card, CellSub, ErrorSummary, Field, focusFirstError, FormGrid, Grid, Icon, Input, Kpi, Modal, ModalCancelButton, Notice, Page, PerspectiveLink, QueryView, Select, Stack, TabPanel, Table, Tabs, toast,
  type IconName, type TabDef,
} from "@/ui";
import { emailValid } from "@/core/validation";
import { escWord } from "../audit-text";
import { adminInviteCustomer, adminSetCustomerActive, adminUsers, type CustomerUserRow, type UsersView } from "../api";
import { INVITE_TEXT } from "../templates";

type UsersTab = "mb" | "kommun" | "matris";

export function AnvandareScreen() {
  const { actor } = useSession();
  const q = useQuery(adminUsers, {});
  // Nyckel per roll: flikar och formulär beror på rollen.
  return <QueryView query={q}>{(d) => <UsersContent key={actor.role} d={d} />}</QueryView>;
}

function UsersContent({ d }: { d: UsersView }) {
  const [tab, setTab] = useState<UsersTab>(d.isAdmin ? "mb" : "kommun");
  const [inviting, setInviting] = useState(false);
  const setActive = useCommand(adminSetCustomerActive);
  const tabs: TabDef<UsersTab>[] = [
    ...(d.isAdmin ? [{ id: "mb" as const, label: "Miljonbemanning", count: d.mb?.length ?? 0, icon: "briefcase" as const }] : []),
    { id: "kommun", label: d.customerName, count: d.customers.length, icon: "building" },
    { id: "matris", label: "Behörigheter", icon: "shield" },
  ];
  const statusOf = (u: CustomerUserRow) =>
    !u.active ? (
      <Badge tone="red" icon="lock">Spärrad</Badge>
    ) : u.invitedAt && !u.lastLoginAt ? (
      <Badge tone="outline" icon="mail">Inbjuden {fmtDateShort(u.invitedAt)}</Badge>
    ) : (
      <Badge tone="blue" icon="check">Aktiv</Badge>
    );
  const toggleActive = async (u: CustomerUserRow) => {
    const r = await setActive.run({ userId: u.id, active: !u.active }).catch(() => null);
    if (!r || !r.ok) toast("Ändringen kunde inte sparas.", "error");
    else toast(u.active ? `${u.name} är spärrad och kan inte logga in.` : `${u.name} kan logga in igen.`);
  };
  return (
    <Page
      title={d.isAdmin ? "Användare och roller" : "Kommunanvändare"}
      eyebrow={d.isAdmin ? "Systemadmin" : `Avtalsansvarig · ${d.customerName}`}
      lead="Bara inbjudna konton – ingen självregistrering. Miljonbemanning loggar in med Microsoft Entra ID, kommunen med e-post och engångskod."
      actions={
        <Button kind="primary" icon="plus" onClick={() => { setTab("kommun"); setInviting(true); }}>
          Bjud in kommunanvändare
        </Button>
      }
    >
      <Grid cols={4}>
        <Kpi label="Miljonbemanning" value={d.kpis.mbActive} sub="aktiva konton · Microsoft Entra ID" />
        <Kpi label={d.customerName} value={d.kpis.customerActive} sub={`aktiva konton i ${d.kpis.unitCount} enheter`} />
        <Kpi label="Inloggade senaste 30 dagarna" value={d.kpis.loggedIn30} sub={`av ${d.customers.length} kommunanvändare – mejlbeställning kräver ingen inloggning`} />
        <Kpi label="Väntande inbjudningar" value={d.kpis.invited} sub="har inte loggat in ännu" />
      </Grid>
      <Tabs id="anv" ariaLabel="Användare" active={tab} onChange={setTab} tabs={tabs} />
      <TabPanel tabsId="anv" active={tab}>
        {tab === "mb" && d.mb && (
          <Card
            title="Personal på Miljonbemanning"
            icon="briefcase"
            flush
            actions={<Badge tone="outline" icon="key">Microsoft Entra ID · MFA via M365</Badge>}
            foot={
              <span className="text-small text-text-muted">
                Rollen gäller per avtal. En person kan ha olika roller i Botkyrka- och KK-avtalet. Lösenord och MFA hanteras av Microsoft – Miljonmatch lagrar inga lösenord.
              </span>
            }
          >
            <Table
              caption="Användare på Miljonbemanning"
              rows={d.mb}
              columns={[
                {
                  key: "name", label: "Namn",
                  render: (u) => (
                    <span className="flex flex-nowrap items-start gap-1.5">
                      <Avatar name={u.name} size="sm" />
                      <span>
                        <span className="font-bold">{u.name}</span>
                        <CellSub>{u.email}</CellSub>
                      </span>
                    </span>
                  ),
                },
                { key: "title", label: "Titel", render: (u) => u.title },
                {
                  key: "bot", label: "Roll i Botkyrka-avtalet",
                  render: (u) => (
                    <>
                      <Badge tone={u.isAdmin ? "dark" : "bluetone"}>{u.roleLabel}</Badge>
                      {u.teamRoleLabel && <CellSub>{u.teamRoleLabel}</CellSub>}
                    </>
                  ),
                },
                { key: "kk", label: "Roll i KK-avtalet", render: (u) => (u.kkRoleLabel ? u.kkRoleLabel : <span className="text-text-muted">Tilldelas före start</span>) },
                { key: "st", label: "Status", render: (u) => (u.active ? <Badge tone="blue" icon="check">Aktiv</Badge> : <Badge tone="red" icon="lock">Spärrad</Badge>) },
              ]}
            />
          </Card>
        )}
        {tab === "kommun" && (
          <Card
            title="Kommunens användare"
            icon="building"
            flush
            actions={
              <>
                <span className="text-small text-text-muted">Tillåtna domäner:</span>
                {d.domains.map((x) => (
                  <Badge tone="outline" key={x}>@{x}</Badge>
                ))}
              </>
            }
            foot={
              <Stack gap="sm" className="w-full">
                <span className="text-small text-text-muted">
                  Engångskoden gäller i 10 minuter och man har högst 5 försök. Ingen magisk länk – e-postskydd som Safe Links förbrukar sådana länkar i förväg. Mejlbeställning via avrop@ fungerar även för den som aldrig loggar in.
                </span>
                <DemoOnly>
                  <div className="max-w-full">
                    <PerspectiveLink role="kommun_handlaggare" to="/portal/logga-in" label="Se kundens inloggning" />
                  </div>
                </DemoOnly>
              </Stack>
            }
          >
            <Table
              caption="Kommunens användare"
              rows={d.customers}
              rowTone={(u) => (!u.active ? "muted" : null)}
              columns={[
                { key: "name", label: "Namn", render: (u) => (<><span className="font-bold">{u.name}</span><CellSub>{u.email}</CellSub></>) },
                {
                  key: "unit", label: "Roll och enhet",
                  render: (u) => (
                    <>
                      <span className="font-bold">{u.role === "chef" ? "Chef" : "Handläggare"}</span>
                      <div>{u.unit}</div>
                      {u.buyerReference && <CellSub>Beställarreferens {u.buyerReference}</CellSub>}
                    </>
                  ),
                },
                { key: "login", label: "Senaste inloggning", nowrap: true, render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="text-text-muted">Har inte loggat in</span>) },
                { key: "st", label: "Status", render: statusOf },
                {
                  key: "act", label: "Åtgärd",
                  render: (u) => (
                    <Button kind="ghost" icon={u.active ? "lock" : "refresh"} onClick={() => void toggleActive(u)}>
                      {u.active ? "Spärra" : "Aktivera"}
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        )}
        {tab === "matris" && (
          <Stack gap="lg">
            <Card
              title="Behörighetsmatris"
              icon="shield"
              flush
              foot={
                <span className="text-small text-text-muted">
                  Behörighet = avtal + roll + tilldelning. Den upprätthålls i databasen med radnivåsäkerhet (RLS), inte bara i gränssnittet.
                  <DemoOnly> Byt roll i prototypfältet för att testa.</DemoOnly>
                </span>
              }
            >
              <Matrix escalateTo={d.escalateTo} />
            </Card>
            <Card title="Roller enligt kravspecifikationen (§4)" icon="users" flush>
              <Table
                caption="Roller och behörigheter"
                rows={ROLE_TABLE.map((r) => ({ id: r[0], role: r[0], org: r[1], sees: r[2], does: r[3], login: r[4] }))}
                columns={[
                  { key: "role", label: "Roll", render: (r) => (<><span className="font-bold">{r.role}</span><CellSub>{r.org}</CellSub></>) },
                  { key: "sees", label: "Ser" },
                  { key: "does", label: "Gör" },
                  { key: "login", label: "Inloggning" },
                ]}
              />
            </Card>
          </Stack>
        )}
      </TabPanel>
      {inviting && <InviteModal d={d} onClose={() => setInviting(false)} />}
    </Page>
  );
}

// ================================================================ Bjud in kommunanvändare
function InviteModal({ d, onClose }: { d: UsersView; onClose: () => void }) {
  const invite = useCommand(adminInviteCustomer);
  const [f, setF] = useState({ name: "", email: "", role: "handlaggare", unit: "" });
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const set = (key: keyof typeof f) => (v: string) => {
    setServerErr(null);
    setF((x) => ({ ...x, [key]: v }));
  };
  const domains = d.domains;
  const email = f.email.trim().toLowerCase();
  const errs: Partial<Record<"name" | "email" | "unit", string>> = {};
  if (!f.name.trim()) errs.name = "Skriv personens namn.";
  if (!email) errs.email = "Skriv e-postadressen.";
  else if (!emailValid(email)) errs.email = "E-postadressen ser inte ut att stämma. Kontrollera stavningen.";
  else if (!domains.includes(email.split("@")[1])) errs.email = `Adressen måste sluta på @${domains.join(" eller @")}. Andra domäner kan inte bjudas in till det här avtalet.`;
  else if (d.customers.some((u) => u.email.toLowerCase() === email)) errs.email = "Det finns redan en användare med den adressen.";
  if (!f.unit) errs.unit = "Välj enhet.";
  const br = d.units.find((u) => u.unit === f.unit)?.buyerReference ?? null;
  const show = (key: keyof typeof errs) => (tried ? errs[key] : undefined);
  const submit = async () => {
    setTried(true);
    if (Object.keys(errs).length) {
      // Felsammanfattningen överst läses upp; fokus till första fältet med fel.
      focusFirstError(document.querySelector<HTMLElement>("[role=dialog]"));
      return;
    }
    const r = await invite.run({ contractId: d.contractId, name: f.name, email, role: f.role, unit: f.unit }).catch(() => null);
    if (!r || !r.ok) {
      setServerErr(r && !r.ok && r.error === "exists" ? "Det finns redan en användare med den adressen." : r && !r.ok && r.error === "domain" ? "Adressen har inte en tillåten domän." : "Inbjudan kunde inte skickas. Kontrollera fälten.");
      return;
    }
    toast(`Inbjudan skickad till ${email}.`);
    onClose();
  };
  return (
    <Modal
      title="Bjud in kommunanvändare"
      onClose={onClose}
      dirty={!!(f.name.trim() || f.email.trim() || f.unit)}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="send" pending={invite.pending} onClick={() => void submit()}>Skicka inbjudan</Button>
        </>
      }
    >
      <Stack>
        <p className="text-text-muted">Kommunanvändare kan inte registrera sig själva. De loggar in med sin e-postadress och en sexsiffrig engångskod.</p>
        {serverErr && <Notice tone="critical">{serverErr}</Notice>}
        {tried && (
          <ErrorSummary
            items={(["name", "email", "unit"] as const).filter((k) => errs[k]).map((k) => ({ id: `inv-${k}`, text: errs[k] as string }))}
            title="Rätta det här innan du skickar inbjudan"
          />
        )}
        <FormGrid>
          <Field id="inv-name" label="Namn" required help="För- och efternamn." error={show("name")}>
            <Input value={f.name} onValueChange={set("name")} />
          </Field>
          <Field id="inv-email" label="E-postadress" required help={`Bara adresser som slutar på @${domains.join(" eller @")}.`} error={show("email")}>
            <Input type="email" value={f.email} onValueChange={set("email")} />
          </Field>
          <Field id="inv-role" label="Roll" required help="Handläggare beställer och läser rapporter för sina deltagare. Chef ser beställarrapporten och enhetens ärenden.">
            <Select value={f.role} onValueChange={set("role")} options={[{ value: "handlaggare", label: "Handläggare" }, { value: "chef", label: "Chef" }]} />
          </Field>
          <Field id="inv-unit" label="Enhet" required help={br ? `Beställarreferens som föreslås: ${br}.` : "Enheten styr vilken beställarreferens som föreslås vid beställning."} error={show("unit")}>
            <Select value={f.unit} onValueChange={set("unit")} placeholder="Välj enhet" options={d.units.map((u) => ({ value: u.unit, label: u.unit }))} />
          </Field>
        </FormGrid>
        <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-small text-text-muted">
          <Icon name="mail" className="mt-px" />
          <div>
            <b className="font-bold text-antracit">Mejlet till den inbjudna (inga personuppgifter):</b> {INVITE_TEXT}
          </div>
        </div>
      </Stack>
    </Modal>
  );
}

// ================================================================ Behörighetsmatris
const ROLE_TABLE: [string, string, string, string, string][] = [
  ["Systemadmin", "Miljonbemanning", "Allt inklusive konfiguration och logg", "Användare, avtal, integrationer", "Microsoft Entra ID"],
  ["Avtalsansvarig och kundansvarig", "Miljonbemanning", "Allt inom sina avtal", "Accepterar och avböjer avrop, godkänner beställarrapport, hanterar avtalsavvikelser, bjuder in kommunanvändare", "Microsoft Entra ID"],
  ["Operativ samordnare", "Miljonbemanning", "Alla ärenden i avtalet", "Avropsinkorg, tilldelar coach, bokar start", "Microsoft Entra ID"],
  ["Huvudcoach", "Miljonbemanning", "Egna ärenden", "Kartläggning, avstämningar, närvaro, bedömningar, utfall, rapporter", "Microsoft Entra ID"],
  ["Handledare, arbetsgivarmatchare och SYV", "Miljonbemanning", "Tilldelade ärenden", "Moment, praktik, arbetsgivarkontakter, närvaro, validering", "Microsoft Entra ID"],
  ["Chef och controller", "Miljonbemanning", "Allt i läsläge, nyckeltal, flaggor, revisionslogg", "Kvitterar flaggor, åtgärdsplaner, loggkontroll", "Microsoft Entra ID"],
  ["Ekonom", "Miljonbemanning", "Ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag – inga anteckningar eller rapporter", "Fakturakörning, Fortnox, export", "Microsoft Entra ID"],
  ["Kommunens handläggare och coach", "Botkyrka kommun", "Egna anvisade ärenden – eller hela enheten, om avtalskonfigurationen säger det", "Beställer, läser rapporter, skickar meddelanden, kvitterar, beslutar om bonusanspråk", "E-post och engångskod"],
  ["Kommunens chef", "Botkyrka kommun", "Beställarrapport och enhetens ärenden", "Läser, laddar ner, godkänner åtgärdsplaner", "E-post och engångskod"],
  ["Deltagare", "Utan inloggning i piloten", "Egen plan och bokningar (utvecklingsfas 4)", "Svarar på pulsmätningen via engångslänk", "Ingen – BankID senare"],
];
const MX_ROLES: [string, string][] = [
  ["admin", "Admin"], ["avtalsansvarig", "Avtals­ansvarig"], ["samordnare", "Sam­ordnare"], ["coach", "Coach"], ["handledare", "Hand­ledare"],
  ["chef", "Chef och con­troller"], ["ekonom", "Ekonom"], ["kommun_handlaggare", "Kommunens hand­läggare"], ["kommun_chef", "Kommunens chef"],
];
const MX_CELL: Record<string, [IconName, string]> = {
  ja: ["check", "Ja"], alla: ["check", "Alla"], nej: ["minus", "Nej"], las: ["eye", "Läsa"], egna: ["user", "Egna"], tilldelade: ["user", "Tilldelade"], namngiven: ["user", "Om namngiven"],
  nummer: ["hash", "Bara nummer"], enheten: ["users", "Enhetens"], mottagare: ["bell", "Mottagare"], dold: ["eye-off", "Syns inte"], ser: ["eye", "Ser att de skickats"],
};
function matrixGroups(escalateTo: readonly EscalationRole[]): [string, [string, string[]][]][] {
  const roles = MX_ROLES.map((r) => r[0]);
  const esc = escalateTo as readonly string[];
  return [
    ["Ser", [
      ["Ärenden i avtalet", ["alla", "alla", "alla", "egna", "tilldelade", "las", "nummer", "egna", "enheten"]],
      ["Skyddade personuppgifter", ["nej", "ja", "nej", "namngiven", "nej", "nej", "nej", "egna", "enheten"]],
      ["Coachanteckningar", ["ja", "ja", "ja", "egna", "tilldelade", "las", "nej", "nej", "nej"]],
      ["Rapporter", ["ja", "ja", "ja", "egna", "tilldelade", "las", "nej", "egna", "enheten"]],
      ["Fakturaunderlag", ["ja", "ja", "nej", "nej", "nej", "las", "ja", "nej", "nej"]],
      ["Avtalskonfiguration", ["ja", "las", "nej", "nej", "nej", "las", "nej", "nej", "nej"]],
      ["Revisionslogg", ["ja", "nej", "nej", "nej", "nej", "ja", "nej", "nej", "nej"]],
    ]],
    ["Gör", [
      ["Acceptera och avböja avrop", ["nej", "ja", "ja", "nej", "nej", "nej", "nej", "nej", "nej"]],
      ["Bjuda in kommunanvändare", ["ja", "ja", "nej", "nej", "nej", "nej", "nej", "nej", "nej"]],
      ["Ändra avtal, användare och integrationer", ["ja", "nej", "nej", "nej", "nej", "nej", "nej", "nej", "nej"]],
      ["Kvittera flaggor och godkänna åtgärdsplaner", ["nej", "ja", "nej", "nej", "nej", "ja", "nej", "nej", "ja"]],
      ["Fakturakörning och Fortnox", ["nej", "nej", "nej", "nej", "nej", "nej", "ja", "nej", "nej"]],
      ["Månatlig loggkontroll", ["nej", "nej", "nej", "nej", "nej", "ja", "nej", "nej", "nej"]],
    ]],
    ["Notiser", [
      ["Notis vid tilldelning: huvudcoach och team", roles.map((r) => (["coach", "handledare"].includes(r) ? "mottagare" : "nej"))],
      ["Påminnelser om utebliven progression: coach", roles.map((r) => (r === "coach" ? "mottagare" : r === "chef" ? "ser" : "nej"))],
      [`Eskaleringar: ${escalateTo.map(escWord).join(", ")} – syns inte för coachen`, roles.map((r) => (esc.includes(r) ? "mottagare" : ["coach", "handledare"].includes(r) ? "dold" : "nej"))],
    ]],
  ];
}

function Matrix({ escalateTo }: { escalateTo: EscalationRole[] }) {
  return (
    <div className="overflow-x-auto rounded-card">
      <table className="w-full border-collapse text-ui">
        <caption className="sr-only">Behörighetsmatris: vad varje roll ser, gör och får för notiser</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-[1] min-w-[150px] border-b-2 border-antracit bg-vit px-3 py-2.5 text-left align-bottom text-label font-extrabold tracking-[0.08em] text-text-muted uppercase">
              Behörighet
            </th>
            {MX_ROLES.map(([k, l]) => (
              <th key={k} scope="col" className="border-b-2 border-antracit bg-vit px-1.5 py-2 text-left align-bottom text-[0.6875rem] font-extrabold tracking-[0.05em] whitespace-normal text-text-muted uppercase [hyphens:manual]">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrixGroups(escalateTo).map(([g, rows]) => (
            <MatrixGroup key={g} title={g} rows={rows} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixGroup({ title, rows }: { title: string; rows: [string, string[]][] }) {
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={MX_ROLES.length + 1} className="border-b border-ljusgra bg-ljusgra-ton px-3 py-2 text-left text-label font-extrabold tracking-[0.08em] text-text-muted uppercase">
          {title}
        </th>
      </tr>
      {rows.map(([label, cells]) => (
        <tr key={label}>
          <th scope="row" className="sticky left-0 z-[1] border-b border-ljusgra bg-vit px-3 py-2 text-left align-top text-small font-bold whitespace-normal text-antracit">
            {label}
          </th>
          {cells.map((c, i) => {
            const [icon, txt] = MX_CELL[c];
            return (
              <td key={i} className={`border-b border-ljusgra px-1.5 py-2 align-top text-meta ${c === "nej" ? "text-text-muted" : ""}`}>
                <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
                  <Icon name={icon} size="sm" />
                  <span>{txt}</span>
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
