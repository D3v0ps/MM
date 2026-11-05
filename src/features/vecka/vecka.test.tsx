// @vitest-environment jsdom
// Min vecka för alla MB-roller (beslut 2026-10-06): rätt skärm per roll, samma sidhuvud (MIN VECKA, "Namn · Titel",
// veckoingressen) – coach, samordnare, avtalsansvarig och ekonom med att göra-listan överst (paket 2), chef och
// systemadministratör med fyra rutor – och varje roll anropar bara frågor den redan har (inga nya vägar till data). Hela vägen
// genom hanterarna i minnesläget med testdatat (demoklockan 1 februari 2027 kl. 09.12).
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, StaffRole } from "@/api/roles";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import { listPersonas, type Persona } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { DEMO_START } from "@/data/seed";
import { seedData } from "@/data/supabase/seed-rows";
import { BackendProvider, type Backend } from "@/shell/backend";
import { NavProvider, type LinkImpl, type Nav } from "@/shell/nav";
import { RuntimeProvider } from "@/shell/runtime";
import { SessionProvider, type Session } from "@/shell/session";
import { DownloadProvider } from "@/ui/download";
import "@/api/handlers";
import { MinVeckaScreen } from "./screens/min-vecka";

afterEach(cleanup);

const SEED = seedData();
const A: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

let rt: MemoryRuntime;
let personas: Persona[];
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
  personas = listPersonas(rt.raw());
});

// Rollen handledare är borttagen (Karims beslut 2026-10-09, vilande): ingen Min vecka för den.
const USER: Record<StaffRole, string> = {
  samordnare: "u-sara", avtalsansvarig: "u-johan", coach: "u-amira", chef: "u-karin", ekonom: "u-lars", admin: "u-robin",
};

/** Frågorna som varje roll redan hade före Min vecka (startsidans frågor och notiserna). Sessionens frågor gäller alla. */
const ALLOWED: Record<StaffRole, string[]> = {
  samordnare: ["inkorg.start", "notiser.list"],
  avtalsansvarig: ["inkorg.start", "notiser.list"],
  coach: ["coach.minVecka", "rost.pendingNotes"],
  chef: ["ledning.overview", "inkorg.deadlines", "rapporter.lista", "notiser.list"],
  ekonom: ["ekonomi.start", "notiser.list"],
  admin: ["admin.integrations", "admin.users", "admin.templates", "notiser.list"],
};

function setup(role: StaffRole, extra: Partial<Session> = {}) {
  const p = personas.find((x) => x.actor.userId === USER[role] && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson för ${role}`);
  const actor: Actor = { ...p.actor, ...(extra.actor ?? {}) };
  const keys = new Set<string>();
  const backend: Backend = {
    mode: "demo",
    // Svaren går som JSON, som i båda körlägena.
    query: async (key, params) => {
      keys.add(key);
      return JSON.parse(JSON.stringify(await rt.run("query", key, params, actor)));
    },
    command: async (key, params) => JSON.parse(JSON.stringify(await rt.run("command", key, params, actor))),
  };
  const nav: Nav = { path: "/min-vecka", query: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), href: (to) => `#${to}` };
  const session: Session = { authenticated: true, actor, user: p.user, ...extra };
  const wrap = (children: ReactNode) => (
    <RuntimeProvider mode="app">
      <BackendProvider backend={backend}>
        <DownloadProvider impl={async () => true}>
          <SessionProvider session={session}>
            <NavProvider nav={nav} LinkImpl={A}>
              {children}
            </NavProvider>
          </SessionProvider>
        </DownloadProvider>
      </BackendProvider>
    </RuntimeProvider>
  );
  render(wrap(<MinVeckaScreen />));
  return { keys, user: p.user };
}

/** Rubrikerna (h2) på sidan när innehållet har hämtats. */
async function headings(first: string): Promise<string[]> {
  await screen.findByRole("heading", { name: new RegExp(first) }, { timeout: 8000 });
  return screen.getAllByRole("heading", { level: 2 }).map((h) => (h.textContent ?? "").trim());
}

/** Nyckeltalsraden: rutorna är knappar (avsnitt på sidan) eller länkar (en annan sida). */
const KPI_TILES = () => {
  const grid = document.querySelector("h1")?.closest("div.mx-auto")?.querySelector(":scope > div.grid");
  return [...(grid?.querySelectorAll<HTMLElement>(":scope > button, :scope > a") ?? [])];
};
const KPI_LABELS = () => KPI_TILES().map((t) => t.querySelector(":scope > div:first-child")?.textContent ?? "");
/** Rutor som leder till en annan sida är riktiga länkar (ny flik med ctrl/cmd-klick): etikett → href. */
const KPI_LINKS = () => Object.fromEntries(KPI_TILES().filter((t) => t.tagName === "A").map((t) => [t.querySelector(":scope > div:first-child")?.textContent ?? "", t.getAttribute("href")]));

describe("Min vecka per roll", () => {
  it("samordnaren: att göra-listan överst – sorterad på sista tid, varje ärende en gång med sin knapp (paket 2, S1)", async () => {
    const { keys, user } = setup("samordnare");
    const h = await headings("Att göra");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Min vecka");
    expect(screen.getByText(`${user.name} · ${user.title}`)).toBeTruthy();
    expect(screen.getByText(/^Måndag 1 februari · vecka 5\. Det här behöver du göra/)).toBeTruthy();
    // Inga rutor – listan står överst. Borttaget: Ärenden utan coach (samma som inkorgen), Tilldelning ger notis och tomma block.
    expect(KPI_TILES()).toHaveLength(0);
    expect(h[0]).toBe("Att göra");
    for (const t of ["Ärenden utan coach", "Tilldelning ger notis", "Förfaller snart", "Olästa notiser"]) expect(h, t).not.toContain(t);
    expect(h.some((x) => x.startsWith("Öppna uppgifter ("))).toBe(false);
    expect(h).toContain("Avtalsavvikelser");
    // Varje ärende en gång: BOT-27-0039 (första mötet, flaggan och förfallotiden) och BOT-27-0049 (avropet och kompletteringen).
    const rows = [...document.querySelectorAll<HTMLElement>('ol[aria-label="Att göra"] > li')];
    const titled = (n: string) => rows.filter((r) => (r.querySelector("a")?.textContent ?? "").includes(n));
    expect(titled("BOT-27-0039")).toHaveLength(1);
    expect(titled("BOT-27-0049")).toHaveLength(1);
    // Knapparna säger vad de gäller.
    expect(screen.getByRole("button", { name: "Acceptera BOT-27-0048" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Boka första mötet för BOT-27-0039" })).toBeTruthy();
    // Sorterat på sista tid: den försenade slutrapporten först, sedan avropet som brådskar.
    expect(rows[0].textContent).toContain("Försenad");
    expect(rows[1].textContent).toContain("BOT-27-0048");
    for (const k of keys) expect(ALLOWED.samordnare, k).toContain(k);
  });

  it("samordnaren: Ring deltagaren visar numret som markerbar text med Kopiera numret – ingen tel:-länk (CLAUDE.md punkt 2)", async () => {
    const c = rt.store.rows("cases").find((x) => x.status === "confirmed" && !!x.firstMeetingAt);
    if (!c) throw new Error("Inget bekräftat ärende med första möte i testdatat");
    rt.store.updateRow("persons", c.personId, { phone: "070-000 00 00" });
    rt.store.insertRow("tasks", {
      id: "task-ring-test", toRole: "samordnare", toId: null, fromId: "system", createdAt: "2027-02-01T08:00", status: "open", kind: "participant_contact",
      caseIds: [c.id], text: `Ring deltagaren och kalla till första mötet – ärende ${c.caseNumber}, Alby. Kallelsen kunde inte skickas.`,
      deviationId: null, emailId: null, responseId: null, month: null, doneAt: null, doneBy: null, doneNote: null,
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      setup("samordnare");
      const btn = await screen.findByRole("button", { name: `Kopiera numret till deltagaren i ${c.caseNumber}` }, { timeout: 8000 });
      const row = btn.closest("li") as HTMLElement;
      expect(row.textContent).toContain("Ring deltagaren och kalla till första mötet");
      expect(row.querySelector("[data-phone]")?.textContent).toBe("070-000 00 00");
      // Inga personuppgifter i URL:er: ingen tel:-, sms:- eller mailto:-länk någonstans på sidan.
      expect(document.querySelectorAll('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')).toHaveLength(0);
      btn.click();
      expect(writeText).toHaveBeenCalledWith("070-000 00 00");
      // Utan urklipp (osäker sida, ingen behörighet): numret markeras så att det kan kopieras med tangentbordet.
      writeText.mockRejectedValueOnce(new Error("NotAllowedError"));
      btn.click();
      await vi.waitFor(() => expect(window.getSelection()?.toString()).toBe("070-000 00 00"));
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("samordnaren: ett ärende med flera saker behåller alla knappar – Ringt – kallad finns kvar bredvid Starta insatsen", async () => {
    // Ett bekräftat ärende vars första möte hölls i morse: insatsen ska startas – och kallelsen ligger kvar som uppgift.
    const c = rt.store.rows("cases").find((x) => x.status === "confirmed" && !!x.firstMeetingAt);
    if (!c) throw new Error("Inget bekräftat ärende med första möte i testdatat");
    rt.store.updateRow("cases", c.id, { firstMeetingAt: `${DEMO_START.slice(0, 10)}T08:00` });
    rt.store.insertRow("tasks", {
      id: "task-ring-flera", toRole: "samordnare", toId: null, fromId: "system", createdAt: "2027-02-01T08:00", status: "open", kind: "participant_contact",
      caseIds: [c.id], text: `Ring deltagaren och kalla till första mötet – ärende ${c.caseNumber}, Alby. Kallelsen kunde inte skickas.`,
      deviationId: null, emailId: null, responseId: null, month: null, doneAt: null, doneBy: null, doneNote: null,
    });
    setup("samordnare");
    const ringt = await screen.findByRole("button", { name: `Ringt – kallad ${c.caseNumber}` }, { timeout: 8000 });
    const row = ringt.closest("li") as HTMLElement;
    // Ärendet står en gång – och båda åtgärderna finns i samma rad.
    expect(within(row).getByRole("link", { name: `Starta insatsen ${c.caseNumber}` })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: `Ringt – kallad ${c.caseNumber}` })).toHaveLength(1);
  });

  it("avtalsansvarig: hans egna saker först – beställarrapporten, åtgärdsplanerna, varningarna och målen; inkorgen är en rad (S5)", async () => {
    const { keys } = setup("avtalsansvarig");
    const h = await headings("Att göra");
    expect(h).not.toContain("Skyddade avrop");
    expect(h.slice(0, 3)).toEqual(["Att göra", "Varningar och mål", "Flaggor (11)"]);
    const rows = [...document.querySelectorAll<HTMLElement>('ol[aria-label="Att göra"] > li')].map((r) => r.textContent ?? "");
    expect(rows.some((r) => r.includes("Beställarrapport januari 2027 att godkänna"))).toBe(true);
    expect(rows.filter((r) => r.includes("Åtgärdsplan"))).toHaveLength(2);
    expect(rows.some((r) => /BOT-27-0048/.test(r))).toBe(false);
    expect(screen.getByRole("link", { name: "6 i inkorgen" }).getAttribute("href")).toBe("#/inkorg");
    expect(screen.getByText(/Skriftliga varningar: 0 av 3/)).toBeTruthy();
    expect(screen.queryByText(/väntar på telefonsamtal/)).toBeNull();
    for (const k of keys) expect(ALLOWED.avtalsansvarig, k).toContain(k);
  });

  it("coachen: Att göra i dag överst, Följ upp (samma ärende en gång), Att kartlägga och veckan bakom en knapp (C1, C17)", async () => {
    const { keys } = setup("coach");
    const h = await headings("Att göra i dag");
    expect(KPI_TILES()).toHaveLength(0);
    expect(h[0]).toBe("Att göra i dag");
    for (const t of ["Följ upp", "Att kartlägga (1)"]) expect(h, t).toContain(t);
    // Borttaget för coachen: Rapporter som förfaller (de står i listan) och de tre korten i högerkolumnen.
    for (const t of ["Rapporter som förfaller", "Påminnelser", "Egna flaggor", "Olästa notiser", "Meddelanden från kommunen"]) expect(h, t).not.toContain(t);
    const rows = [...document.querySelectorAll<HTMLElement>('ol[aria-label="Att göra i dag"] > li')];
    // Närvaron först (sista tid i dag 10.00) med regeln om automatisk närvaro i en rad.
    expect(rows[0].textContent).toContain("Närvaro att registrera – vecka 4");
    expect(rows[0].textContent).toContain("registreras automatiskt som närvarande");
    // C17: bara nästa möte har en svart knapp.
    const list = document.querySelector('ol[aria-label="Att göra i dag"]') as HTMLElement;
    const black = [...list.querySelectorAll<HTMLElement>("a, button")].filter((b) => b.classList.contains("bg-antracit"));
    expect(black.map((b) => b.textContent)).toEqual(["Spela in mötet med Nadia Warsame"]);
    // Samma ärende en rad: Nadias möte kl. 10.00 och meddelandet från kommunen står på mötets rad – den andra åtgärden som
    // textknapp under anmärkningarna.
    const titled = (n: string) => rows.filter((r) => (r.querySelector("div.min-h-11.font-bold a")?.textContent ?? "").includes(n));
    expect(titled("Nadia Warsame")).toHaveLength(1);
    const nadia = titled("Nadia Warsame")[0];
    expect(nadia.textContent).toContain("Svara kommunen");
    expect(within(nadia).getByRole("button", { name: /^Läs och svara/ }).classList.contains("bg-antracit")).toBe(false);
    for (const r of rows) {
      const n = r.querySelector("div.min-h-11.font-bold a")?.textContent;
      if (n) expect(titled(n), n).toHaveLength(1);
    }
    // Följ upp: Yusuf har en påminnelse, en flagga och en oläst notis – en rad.
    const follow = [...document.querySelectorAll<HTMLElement>('ol[aria-label="Följ upp"] > li')];
    expect(follow.filter((r) => (r.querySelector("a")?.textContent ?? "").includes("Yusuf Abdi"))).toHaveLength(1);
    // Veckokalendern bakom "Visa hela veckan".
    expect(h.some((x) => x.startsWith("Veckokalender"))).toBe(false);
    screen.getByRole("button", { name: /Visa hela veckan/ }).click();
    await screen.findByRole("heading", { name: /Veckokalender – vecka 5/ });
    for (const k of keys) expect(ALLOWED.coach, k).toContain(k);
  });

  it("coachen: ett AI-utkast från dagens möte står på mötets rad – samma möte en gång, inte två rader", async () => {
    // Dagens möte med en påbörjad mötesrapport blir ett AI-utkast (som efter en inspelning): utkastet ska inte stå på en egen rad.
    const today = DEMO_START.slice(0, 10);
    const draft = rt.store.rows("check_ins").find((x) => x.status === "draft" && !!x.ai);
    const ci = rt.store.rows("check_ins").find((x) => x.heldAt.startsWith(today));
    if (!draft?.ai || !ci) throw new Error("Testdatat saknar ett AI-utkast eller ett möte i dag");
    rt.store.updateRow("check_ins", ci.id, { status: "draft", ai: draft.ai });
    const c = rt.raw().get("cases", ci.caseId);
    setup("coach");
    await headings("Att göra i dag");
    // Raderna om ärendets möte och mötesrapport (månadsbedömningarnas utfällbara lista nämner också ärendet).
    const rows = [...document.querySelectorAll<HTMLElement>('ol[aria-label="Att göra i dag"] > li')]
      .filter((r) => (r.textContent ?? "").includes(c?.caseNumber ?? "?") && /mötesrapport|möte /i.test(r.textContent ?? "") && !(r.textContent ?? "").includes("Månadsbedömningar"));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("mötesrapport att granska – utkast från AI");
    expect(within(rows[0]).getByRole("link", { name: /^Granska mötesrapporten med / }).getAttribute("href")).toBe(`#/avstamning/${ci.caseId}?avstamning=${ci.id}`);
  });

  it("den vilande rollen handledare har ingen Min vecka (Karims beslut 2026-10-09): ingenting visas och inga frågor körs", async () => {
    const { keys } = setup("coach", { actor: dormantSupervisor() });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect([...keys]).toEqual([]);
  });

  it("chefen: flaggor, förfaller, rapporter att granska och nyckeltalen i korthet – inga ekonomi-frågor", async () => {
    const { keys } = setup("chef");
    const h = await headings("Nyckeltal i korthet");
    expect(KPI_LABELS()).toEqual(["Flaggor att hantera", "Förfaller i dag", "Resultatgrad, rullande 6 mån", "Rapporter försenade"]);
    expect(KPI_LINKS()).toEqual({ "Förfaller i dag": "#/forfaller", "Resultatgrad, rullande 6 mån": "#/ledning", "Rapporter försenade": "#/rapporter?filter=forsenade" });
    for (const t of ["Tidig uppmärksamhet", "Förfaller snart", "Avtalsavvikelser och varningar", "Olästa notiser"]) expect(h, t).toContain(t);
    expect(screen.getByRole("link", { name: /Öppna Ledningsvyn/ }).getAttribute("href")).toBe("#/ledning");
    expect([...keys].some((k) => k.startsWith("ekonomi."))).toBe(false);
    for (const k of keys) expect([...ALLOWED.chef, "session.ping"], k).toContain(k);
  });

  it("chefen som begränsad testare: inga belopp – ofakturerat visas inte", async () => {
    setup("chef", { hidesCommercial: true, actor: { userId: "u-karin", role: "chef", contractIds: ["c-bot"], testerId: "tester-sara" } });
    await headings("Nyckeltal i korthet");
    const card = screen.getByRole("heading", { name: /Nyckeltal i korthet/ }).closest("section") as HTMLElement;
    expect(within(card).getByText("Visas inte för testare")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/\d\s?kr(?![a-zåäö])/i);
  });

  it("ekonomen: en rad per faktura med alla anmärkningar och en knapp – varje siffra på ett ställe (E2)", async () => {
    const { keys } = setup("ekonom");
    const h = await headings("Att göra");
    expect(KPI_TILES()).toHaveLength(0);
    expect(h[0]).toBe("Att göra");
    // Fakturering behåller månadsöversikten och historiken – Min vecka har bara listan.
    for (const t of ["Fakturakörning januari 2027", "Fakturor som saknar beställarreferens", "Returnerade fakturor", "Veckor utan närvaro att kontrollera"]) expect(h, t).not.toContain(t);
    const rows = [...document.querySelectorAll<HTMLElement>('ol[aria-label="Att göra"] > li')].map((r) => r.textContent ?? "");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("Faktura januari 2027");
    expect(rows[0]).toContain("Beställarreferens saknas");
    expect(rows[0]).toContain("3 veckor utan närvaro att godkänna");
    expect(rows[1]).toContain("Tilläggsfaktura 2 · december 2026");
    expect(rows[1]).toContain("Returnerad av kommunen");
    expect(rows[1]).toContain("Preskriptionsrisk BOT-26-0117");
    // Januaris bonusfaktura (Karims beslut 2026-11-04): en egen rad med knappen till bonusfakturan.
    expect(rows[2]).toContain("Bonusfaktura januari 2027");
    expect(rows[2]).toContain("2 bonussteg godkända av kommunen");
    expect(rows[3]).toContain("Uppgift från Johan Berg");
    expect(screen.getByRole("link", { name: "Öppna körningen januari" }).getAttribute("href")).toBe("#/ekonomi/2027-01");
    expect(screen.getByRole("link", { name: /^Öppna bonusfakturan/ }).getAttribute("href")).toBe("#/ekonomi/bonus/2027-01");
    for (const k of keys) expect([...ALLOWED.ekonom, "session.ping"], k).toContain(k);
  });

  it("systemadministratören: bakgrundsjobb, utskick och användare – länken till avtalssidan", async () => {
    const { keys } = setup("admin");
    const h = await headings("Bakgrundsjobb");
    expect(KPI_LABELS()).toEqual(["Bakgrundsjobb", "Utskick som inte gick iväg", "Användare", "Avrop@ senast läst"]);
    expect(KPI_LINKS()).toEqual({ Användare: "#/admin/anvandare", "Avrop@ senast läst": "#/admin/integrationer" });
    for (const t of ["Bakgrundsjobb", "Utskick som inte gick iväg", "Användare och roller", "Mallar och loggar", "Olästa notiser"]) expect(h, t).toContain(t);
    expect(screen.getByRole("link", { name: /Avtal och konfiguration/ }).getAttribute("href")).toBe("#/admin/avtal");
    // Synpunkterna visas bara för testare i testmiljön.
    expect(h).not.toContain("Synpunkter från testarna");
    for (const k of keys) expect([...ALLOWED.admin, "session.ping"], k).toContain(k);
  });

  it("systemadministratören: utskick som inte gick iväg räknas för de senaste sju dagarna – inget löfte om att skicka om", async () => {
    const fail = (id: string, createdAt: string) =>
      rt.store.insertRow("outbound_messages", {
        id, createdAt, channel: "email", to: "maria.ekdahl@botkyrka.se", template: "ny_rapport", subject: null,
        body: "Det finns en ny rapport för ärende BOT-26-0143 – logga in för att läsa.", caseId: "case-260143", status: "failed", sentAt: null,
        statusReason: "provider_error", providerMessageId: null,
      });
    fail("out-fel-ny", "2027-01-26T08:00"); // sex dagar före 1 februari: räknas
    fail("out-fel-gammal", "2027-01-25T23:59"); // sju dagar före: bara i utskicksloggen
    setup("admin");
    await headings("Bakgrundsjobb");
    const tile = KPI_TILES()[1];
    expect(tile.querySelector(":scope > div:nth-child(2)")?.textContent).toBe("1");
    expect(tile.textContent).toContain("Kontrollera utskicksloggen");
    expect(tile.textContent).toContain("De senaste 7 dagarna");
    expect(document.body.textContent ?? "").not.toMatch(/skicka om/i);
    const card = screen.getByRole("heading", { name: "Utskick som inte gick iväg" }).closest("section") as HTMLElement;
    expect(within(card).getAllByText("BOT-26-0143", { exact: false })).toHaveLength(1);
    // Inga mottagare eller texter på Min vecka.
    expect(card.textContent ?? "").not.toContain("botkyrka.se");
  });

  it("systemadministratören som begränsad testare: ingen länk till avtalssidan och inga underbiträden", async () => {
    setup("admin", { hidesCommercial: true, actor: { userId: "u-robin", role: "admin", contractIds: ["c-bot"], testerId: "tester-sara" } });
    await headings("Bakgrundsjobb");
    expect(screen.queryByRole("link", { name: /Avtal och konfiguration/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Underbiträden" })).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/Supabase|Vercel|Resend|eu-north-1/);
  });
});
