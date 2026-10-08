"use client";
// Användare och roller (/admin/anvandare, prototypens admin.anvandare). Systemadmin ser personalen, kommunens användare och
// behörighetsmatrisen; avtalsansvarig ser kommunanvändarna (bjuder in och spärrar). Kommunens handläggare
// kan också skapa sina konton själva med en adress på kommunens domän (beslut 2026-10-07) – de märks "Skapade kontot själv".
// Kollegorna (beslut 2026-10-08, skarp drift): systemadministratören lägger till kollegor, ändrar roller (en eller flera) och
// spärrar eller aktiverar – i appen, utan SQL. Mejlet till kollegan innehåller inga personuppgifter.
// Avtal och konfiguration ligger inte i menyn (beslut 2026-10-06): systemadministratören når den härifrån och från Min vecka.
import { useState } from "react";
import { ROLE_LABEL, type SupplierRole } from "@/api/roles";
import { isTesterHiddenPath } from "@/api/tester-access";
import type { EscalationRole } from "@/core/config";
import { fmtDateShort, fmtDateTime } from "@/core/time";
import { useCommand, useQuery } from "@/shell/backend";
import { DemoOnly } from "@/shell/runtime";
import { useSession } from "@/shell/session";
import {
  Avatar, Badge, Button, Card, CellSub, Check, ErrorSummary, Field, focusFirstError, FormGrid, Grid, Icon, Input, Kpi, Modal, ModalCancelButton, Notice, Page, PerspectiveLink, QueryView, Row, Stack, TabPanel, Table, Tabs, toast,
  type IconName, type TabDef,
} from "@/ui";
import { emailDomain } from "@/core/staff";
import { emailValid } from "@/core/validation";
import { escWord } from "../audit-text";
import {
  adminInviteCustomer, adminInviteStaff, adminSetCustomerActive, adminSetStaffActive, adminSetStaffRoles, adminUsers, type CustomerUserRow, type MbUserRow, type UsersView,
} from "../api";
import { INVITE_TEXT, STAFF_INVITE_TEXT } from "../templates";

/** Rollerna en kollega kan få, med hjälptext i klarspråk (samma ordning som i tabellen). */
const STAFF_ROLES: { role: SupplierRole; label: string; help: string }[] = [
  { role: "admin", label: "Systemadministratör", help: "Allt inklusive användare, avtal, integrationer och revisionslogg." },
  { role: "avtalsansvarig", label: "Avtalsansvarig", help: "Accepterar och avböjer avrop, avtalsavvikelser, kommunanvändare, rapportbyggaren." },
  { role: "samordnare", label: "Operativ samordnare", help: "Avropsinkorg, tilldelar coach, bokar första möte." },
  { role: "coach", label: "Huvudcoach", help: "Egna ärenden: närvaro, avstämningar, månadsbedömningar och rapporter." },
  { role: "handledare", label: "Handledare", help: "Tilldelade ärenden: moment, praktik och närvaro." },
  { role: "chef", label: "Chef och controller", help: "Nyckeltal, flaggor, avtalsavvikelser och loggkontroll – i läsläge." },
  { role: "ekonom", label: "Ekonom", help: "Fakturaunderlag och belopp – inga anteckningar eller rapporter." },
];

type UsersTab = "mb" | "kommun" | "matris";
/** Avtal och konfiguration – inte i menyn, länkas härifrån. */
const CONTRACT_PATH = "/admin/avtal";

export function AnvandareScreen() {
  const { actor, hidesCommercial } = useSession();
  const q = useQuery(adminUsers, {});
  // Nyckel per roll: flikar och formulär beror på rollen.
  // Länken till avtalssidan: bara systemadministratören, och inte för begränsade testare (avtalssidan är stängd för dem).
  return (
    <QueryView query={q}>{(d) => <UsersContent key={actor.role} d={d} contractLink={d.isAdmin && !(hidesCommercial && isTesterHiddenPath(CONTRACT_PATH))} />}</QueryView>
  );
}

type StaffDialog = { mode: "add" } | { mode: "roles"; user: MbUserRow } | null;

function UsersContent({ d, contractLink }: { d: UsersView; contractLink: boolean }) {
  const [tab, setTab] = useState<UsersTab>(d.isAdmin ? "mb" : "kommun");
  const [inviting, setInviting] = useState(false);
  const [staffDialog, setStaffDialog] = useState<StaffDialog>(null);
  const setActive = useCommand(adminSetCustomerActive);
  const setStaffActive = useCommand(adminSetStaffActive);
  const toggleStaffActive = async (u: MbUserRow) => {
    const r = await setStaffActive.run({ userId: u.id, active: !u.active }).catch(() => null);
    if (!r || !r.ok) toast((r && !r.ok && r.message) || "Ändringen kunde inte sparas.", "error");
    else toast(u.active ? `${u.name} är spärrad och kan inte logga in.` : `${u.name} kan logga in igen.`);
  };
  const tabs: TabDef<UsersTab>[] = [
    ...(d.isAdmin ? [{ id: "mb" as const, label: "Miljonbemanning", count: d.mb?.length ?? 0, icon: "briefcase" as const }] : []),
    { id: "kommun", label: d.customerName, count: d.customers.length, icon: "building" },
    { id: "matris", label: "Behörigheter", icon: "shield" },
  ];
  const statusOf = (u: CustomerUserRow) =>
    !u.active ? (
      <Badge tone="red" icon="lock">Spärrad</Badge>
    ) : u.selfRegistered && !u.lastLoginAt ? (
      <Badge tone="outline" icon="user">Skapade kontot själv{u.invitedAt ? ` ${fmtDateShort(u.invitedAt)}` : ""}</Badge>
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
      lead="Kollegorna läggs till här av systemadministratören och loggar in med sin e-postadress på jobbet och en engångskod. Kommunens handläggare loggar in med e-post och engångskod – de kan skapa sitt konto själva med en adress på kommunens domän, eller bjudas in."
      actions={
        <>
          {contractLink && (
            <Button kind="ghost" icon="settings" to={CONTRACT_PATH}>
              Avtal och konfiguration
            </Button>
          )}
          {d.isAdmin && (
            <Button kind="primary" icon="plus" onClick={() => { setTab("mb"); setStaffDialog({ mode: "add" }); }}>
              Lägg till kollega
            </Button>
          )}
          <Button kind={d.isAdmin ? "secondary" : "primary"} icon="plus" onClick={() => { setTab("kommun"); setInviting(true); }}>
            Bjud in kommunanvändare
          </Button>
        </>
      }
    >
      <Grid cols={4}>
        <Kpi label="Miljonbemanning" value={d.kpis.mbActive} sub="aktiva konton · e-post och engångskod" />
        <Kpi label={d.customerName} value={d.kpis.customerActive} sub={`aktiva konton i ${d.kpis.unitCount} enheter`} />
        <Kpi label="Inloggade senaste 30 dagarna" value={d.kpis.loggedIn30} sub={`av ${d.customers.length} kommunanvändare – mejlbeställning kräver ingen inloggning`} />
        <Kpi label="Väntande inbjudningar" value={d.kpis.invited} sub="har inte loggat in ännu" />
      </Grid>
      <Tabs id="anv" ariaLabel="Användare" active={tab} onChange={setTab} tabs={tabs} />
      <TabPanel tabsId="anv" active={tab}>
        {tab === "mb" && d.mb && (
          <Card
            title="Kollegor på Miljonbemanning"
            icon="briefcase"
            flush
            actions={
              <>
                <span className="text-small text-text-muted">Adresser på:</span>
                {d.staffDomains.map((x) => (
                  <Badge tone="outline" key={x}>@{x}</Badge>
                ))}
              </>
            }
            foot={
              <span className="text-text-muted">
                Rollerna gäller i avtalet. En kollega med flera roller väljer roll i sidopanelen. Inloggning med e-post och engångskod – Miljonmatch lagrar inga
                lösenord. Microsoft-inloggning kommer senare.
              </span>
            }
          >
            <Table
              caption="Kollegor på Miljonbemanning"
              rows={d.mb}
              rowTone={(u) => (!u.active ? "muted" : null)}
              columns={[
                {
                  key: "name", label: "Namn",
                  render: (u) => (
                    <span className="flex flex-nowrap items-start gap-1.5">
                      <Avatar name={u.name} size="sm" />
                      <span>
                        <span className="font-bold">{u.name}</span>
                        {u.self && <span className="text-small text-text-muted"> (du)</span>}
                        <CellSub>{u.email}</CellSub>
                      </span>
                    </span>
                  ),
                },
                { key: "title", label: "Titel", render: (u) => u.title || <span className="text-text-muted">–</span> },
                {
                  key: "bot", label: "Roller i avtalet",
                  render: (u) => (
                    <>
                      <span className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} tone={r === "admin" ? "dark" : "bluetone"}>{ROLE_LABEL[r]}</Badge>
                        ))}
                      </span>
                      {u.teamRoleLabel && <CellSub>{u.teamRoleLabel}</CellSub>}
                    </>
                  ),
                },
                { key: "st", label: "Status", render: (u) => (u.active ? <Badge tone="blue" icon="check">Aktiv</Badge> : <Badge tone="red" icon="lock">Spärrad</Badge>) },
                {
                  key: "act", label: "Åtgärd",
                  render: (u) => (
                    <Row gap="sm" className="flex-wrap">
                      <Button kind="ghost" icon="edit" onClick={() => setStaffDialog({ mode: "roles", user: u })}>
                        Ändra roller
                      </Button>
                      {!u.self && (
                        <Button kind="ghost" icon={u.active ? "lock" : "refresh"} onClick={() => void toggleStaffActive(u)}>
                          {u.active ? "Spärra" : "Aktivera"}
                        </Button>
                      )}
                    </Row>
                  ),
                },
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
                <span className="text-text-muted">
                  {d.selfRegistrationDomains.length
                    ? `Alla med en adress som slutar på @${d.selfRegistrationDomains.join(" eller @")} kan skapa ett konto själva när de loggar in första gången. De blir handläggare och fyller i namn, telefon och enhet. `
                    : "Ingen kan skapa ett konto själv i det här avtalet. "}
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
                      <span className="font-bold">Handläggare</span>
                      <div>{u.unit || <span className="text-text-muted">Enhet inte ifylld</span>}</div>
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
                <span className="text-text-muted">
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
      {staffDialog?.mode === "add" && <StaffModal d={d} onClose={() => setStaffDialog(null)} />}
      {staffDialog?.mode === "roles" && <RolesModal user={staffDialog.user} onClose={() => setStaffDialog(null)} />}
    </Page>
  );
}

// ================================================================ Lägg till kollega (beslut 2026-10-08)
/** Kryssrutor för rollerna, med hjälptext per roll. */
function RolePicker({ idPrefix, value, onChange, error }: { idPrefix: string; value: SupplierRole[]; onChange: (roles: SupplierRole[]) => void; error?: string }) {
  return (
    <Field id={`${idPrefix}-roles`} label="Roller" required help="Välj en eller flera. Kollegan väljer sedan roll i sidopanelen." error={error}>
      <div id={`${idPrefix}-roles`} role="group" aria-label="Roller" className="flex flex-col gap-1">
        {STAFF_ROLES.map((r) => (
          <Check
            key={r.role}
            id={`${idPrefix}-role-${r.role}`}
            checked={value.includes(r.role)}
            onCheckedChange={(on) => onChange(on ? [...value, r.role] : value.filter((x) => x !== r.role))}
          >
            <span className="font-bold">{r.label}</span>
            <span className="block text-small text-text-muted">{r.help}</span>
          </Check>
        ))}
      </div>
    </Field>
  );
}

function StaffModal({ d, onClose }: { d: UsersView; onClose: () => void }) {
  const invite = useCommand(adminInviteStaff);
  const [f, setF] = useState({ name: "", email: "", title: "" });
  const [roles, setRoles] = useState<SupplierRole[]>([]);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const set = (key: keyof typeof f) => (v: string) => {
    setServerErr(null);
    setF((x) => ({ ...x, [key]: v }));
  };
  const domains = d.staffDomains;
  const email = f.email.trim().toLowerCase();
  const errs: Partial<Record<"name" | "email" | "roles", string>> = {};
  if (!f.name.trim()) errs.name = "Skriv kollegans namn.";
  if (!email) errs.email = "Skriv e-postadressen.";
  else if (!emailValid(email)) errs.email = "E-postadressen ser inte ut att stämma. Kontrollera stavningen.";
  else if (!domains.includes(emailDomain(email))) errs.email = `Adressen måste sluta på @${domains.join(" eller @")}.`;
  else if ((d.mb ?? []).some((u) => u.email.toLowerCase() === email)) errs.email = "Det finns redan en kollega med den adressen.";
  if (!roles.length) errs.roles = "Välj minst en roll.";
  const show = (key: keyof typeof errs) => (tried ? errs[key] : undefined);
  const submit = async () => {
    setTried(true);
    if (Object.keys(errs).length) {
      focusFirstError(document.querySelector<HTMLElement>("[role=dialog]"));
      return;
    }
    const r = await invite.run({ contractId: d.contractId, name: f.name, email, roles, title: f.title.trim() || undefined }).catch(() => null);
    if (!r || !r.ok) {
      setServerErr((r && !r.ok && r.message) || "Kollegan kunde inte läggas till. Kontrollera fälten.");
      return;
    }
    toast(`${f.name.trim()} är tillagd. Ett mejl med adressen till Miljonmatch har skickats till ${email}.`);
    onClose();
  };
  return (
    <Modal
      title="Lägg till kollega"
      onClose={onClose}
      dirty={!!(f.name.trim() || f.email.trim() || f.title.trim() || roles.length)}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="plus" pending={invite.pending} onClick={() => void submit()}>Lägg till kollega</Button>
        </>
      }
    >
      <Stack>
        <p className="text-text-muted">Kollegan loggar in med sin e-postadress på jobbet och en sexsiffrig engångskod. Rollerna gäller i avtalet och kan ändras när som helst.</p>
        {serverErr && <Notice tone="critical">{serverErr}</Notice>}
        {tried && (
          <ErrorSummary
            items={(["name", "email", "roles"] as const).filter((k) => errs[k]).map((k) => ({ id: k === "roles" ? "ny-kollega-role-admin" : `ny-kollega-${k}`, text: errs[k] as string }))}
            title="Rätta det här innan du lägger till kollegan"
          />
        )}
        <FormGrid>
          <Field id="ny-kollega-name" label="Namn" required help="För- och efternamn." error={show("name")}>
            <Input value={f.name} onValueChange={set("name")} maxLength={120} />
          </Field>
          <Field id="ny-kollega-email" label="E-postadress" required help={`Adressen på jobbet – slutar på @${domains.join(" eller @")}.`} error={show("email")}>
            <Input type="email" value={f.email} onValueChange={set("email")} maxLength={200} />
          </Field>
          <Field id="ny-kollega-title" label="Titel" help="Valfritt, till exempel Jobbcoach. Visas i listan över kollegor.">
            <Input value={f.title} onValueChange={set("title")} maxLength={80} />
          </Field>
        </FormGrid>
        <RolePicker idPrefix="ny-kollega" value={roles} onChange={(r) => { setServerErr(null); setRoles(r); }} error={show("roles")} />
        <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-text-muted">
          <Icon name="mail" className="mt-px" />
          <div>
            <b className="font-bold text-antracit">Mejlet till kollegan (inga personuppgifter):</b> {STAFF_INVITE_TEXT}
          </div>
        </div>
      </Stack>
    </Modal>
  );
}

// ================================================================ Ändra roller
function RolesModal({ user, onClose }: { user: MbUserRow; onClose: () => void }) {
  const save = useCommand(adminSetStaffRoles);
  const [roles, setRoles] = useState<SupplierRole[]>(user.roles);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const order = STAFF_ROLES.map((r) => r.role);
  const sorted = order.filter((r) => roles.includes(r));
  const changed = sorted.join("|") !== user.roles.join("|");
  const err = !roles.length ? "Välj minst en roll." : user.self && !roles.includes("admin") ? "Du kan inte ta bort din egen roll som systemadministratör." : undefined;
  const submit = async () => {
    setTried(true);
    if (err) {
      focusFirstError(document.querySelector<HTMLElement>("[role=dialog]"));
      return;
    }
    if (!changed) {
      onClose();
      return;
    }
    const r = await save.run({ userId: user.id, roles: sorted }).catch(() => null);
    if (!r || !r.ok) {
      setServerErr((r && !r.ok && r.message) || "Rollerna kunde inte sparas.");
      return;
    }
    toast(`${user.name} har nu ${sorted.length === 1 ? "rollen" : "rollerna"} ${sorted.map((x) => ROLE_LABEL[x].toLowerCase()).join(", ")}.`);
    onClose();
  };
  return (
    <Modal
      title={`Ändra roller – ${user.name}`}
      onClose={onClose}
      dirty={changed}
      footer={
        <>
          <ModalCancelButton />
          <Button kind="primary" icon="check" pending={save.pending} onClick={() => void submit()}>Spara roller</Button>
        </>
      }
    >
      <Stack>
        <p className="text-text-muted">Rollerna gäller i avtalet. Har kollegan flera roller väljer hen själv roll i sidopanelen.</p>
        {serverErr && <Notice tone="critical">{serverErr}</Notice>}
        {tried && err && <ErrorSummary items={[{ id: "roller-role-admin", text: err }]} title="Rätta det här innan du sparar" />}
        <RolePicker idPrefix="roller" value={roles} onChange={(r) => { setServerErr(null); setRoles(r); }} error={tried ? err : undefined} />
      </Stack>
    </Modal>
  );
}

// ================================================================ Bjud in kommunanvändare
function InviteModal({ d, onClose }: { d: UsersView; onClose: () => void }) {
  const invite = useCommand(adminInviteCustomer);
  const [f, setF] = useState({ name: "", email: "", unit: "" });
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
  if (!f.unit.trim()) errs.unit = "Skriv vilken enhet personen arbetar på.";
  const show = (key: keyof typeof errs) => (tried ? errs[key] : undefined);
  const submit = async () => {
    setTried(true);
    if (Object.keys(errs).length) {
      // Felsammanfattningen överst läses upp; fokus till första fältet med fel.
      focusFirstError(document.querySelector<HTMLElement>("[role=dialog]"));
      return;
    }
    const r = await invite.run({ contractId: d.contractId, name: f.name, email, unit: f.unit }).catch(() => null);
    if (!r || !r.ok) {
      setServerErr(r && !r.ok && r.error === "exists" ? "Det finns redan en användare med den adressen." : r && !r.ok && r.error === "domain" ? "Adressen har inte en tillåten domän." : "Inbjudan kunde inte skickas. Kontrollera fälten.");
      return;
    }
    toast(`Inbjudan skickad till ${email}.`);
    onClose();
  };
  return (
    <Modal
      title="Bjud in kommunens handläggare"
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
        <p className="text-text-muted">
          Kommunens användare är handläggare. De loggar in med sin e-postadress och en sexsiffrig engångskod.
          {d.selfRegistrationDomains.length ? ` Den som har en adress som slutar på @${d.selfRegistrationDomains.join(" eller @")} kan också skapa ett konto själv.` : ""}
        </p>
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
          <Field id="inv-unit" label="Enhet" required help="Skriv vilken enhet personen arbetar på, till exempel Arbetsmarknadsenheten Alby." error={show("unit")}>
            <Input value={f.unit} onValueChange={set("unit")} maxLength={120} list="inv-unit-list" />
          </Field>
          <datalist id="inv-unit-list">
            {d.units.map((u) => (
              <option key={u.unit} value={u.unit} />
            ))}
          </datalist>
        </FormGrid>
        <div className="flex items-start gap-2.5 rounded-mb border-[1.5px] border-dashed border-line-strong bg-vit px-3 py-2.5 text-text-muted">
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
  ["Kommunens handläggare", "Botkyrka kommun", "Egna beställda ärenden", "Beställer, läser rapporter, skickar meddelanden, kvitterar. Skapar sitt konto själv med en adress på kommunens domän", "E-post och engångskod"],
  ["Deltagare", "Utan inloggning i piloten", "Egen plan och bokningar (utvecklingsfas 4)", "Svarar på pulsmätningen via engångslänk", "Ingen – BankID senare"],
];
const MX_ROLES: [string, string][] = [
  ["admin", "Admin"], ["avtalsansvarig", "Avtals­ansvarig"], ["samordnare", "Sam­ordnare"], ["coach", "Coach"], ["handledare", "Hand­ledare"],
  ["chef", "Chef och con­troller"], ["ekonom", "Ekonom"], ["kommun_handlaggare", "Kommunens hand­läggare"],
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
      ["Ärenden i avtalet", ["alla", "alla", "alla", "egna", "tilldelade", "las", "nummer", "egna"]],
      ["Coachanteckningar", ["ja", "ja", "ja", "egna", "tilldelade", "las", "nej", "nej"]],
      ["Rapporter", ["ja", "ja", "ja", "egna", "tilldelade", "las", "nej", "egna"]],
      ["Fakturaunderlag", ["ja", "ja", "nej", "nej", "nej", "las", "ja", "nej"]],
      ["Avtalskonfiguration", ["ja", "las", "nej", "nej", "nej", "las", "nej", "nej"]],
      ["Revisionslogg", ["ja", "nej", "nej", "nej", "nej", "ja", "nej", "nej"]],
    ]],
    ["Gör", [
      ["Acceptera och avböja avrop", ["nej", "ja", "ja", "nej", "nej", "nej", "nej", "nej"]],
      ["Bjuda in kommunanvändare", ["ja", "ja", "nej", "nej", "nej", "nej", "nej", "nej"]],
      ["Ändra avtal, användare och integrationer", ["ja", "nej", "nej", "nej", "nej", "nej", "nej", "nej"]],
      ["Kvittera flaggor och godkänna åtgärdsplaner", ["nej", "ja", "nej", "nej", "nej", "ja", "nej", "nej"]],
      ["Fakturakörning och Fortnox", ["nej", "nej", "nej", "nej", "nej", "nej", "ja", "nej"]],
      ["Månatlig loggkontroll", ["nej", "nej", "nej", "nej", "nej", "ja", "nej", "nej"]],
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
              <th key={k} scope="col" className="border-b-2 border-antracit bg-vit px-1.5 py-2 text-left align-bottom text-label font-extrabold tracking-[0.05em] whitespace-normal text-text-muted uppercase [hyphens:manual]">
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
              <td key={i} className={`border-b border-ljusgra px-1.5 py-2 align-top text-small ${c === "nej" ? "text-text-muted" : ""}`}>
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
