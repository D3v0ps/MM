// @vitest-environment jsdom
// Min vecka för alla MB-roller (beslut 2026-10-06): rätt skärm per roll, samma sidhuvud (MIN VECKA, "Namn · Titel",
// veckoingressen) och fyra rutor – och varje roll anropar bara frågor den redan har (inga nya vägar till data). Hela vägen
// genom hanterarna i minnesläget med testdatat (demoklockan 1 februari 2027 kl. 09.12).
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, SupplierRole } from "@/api/roles";
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

const USER: Record<SupplierRole, string> = {
  samordnare: "u-sara", avtalsansvarig: "u-johan", coach: "u-amira", handledare: "u-petra", chef: "u-karin", ekonom: "u-lars", admin: "u-robin",
};

/** Frågorna som varje roll redan hade före Min vecka (startsidans frågor och notiserna). Sessionens frågor gäller alla. */
const ALLOWED: Record<SupplierRole, string[]> = {
  samordnare: ["inkorg.start", "notiser.list"],
  avtalsansvarig: ["inkorg.start", "notiser.list"],
  coach: ["coach.minVecka", "rost.pendingNotes"],
  handledare: ["arenden.handledare", "coach.narvaro", "notiser.list"],
  chef: ["ledning.overview", "inkorg.deadlines", "rapporter.lista", "notiser.list"],
  ekonom: ["ekonomi.start", "notiser.list"],
  admin: ["admin.integrations", "admin.users", "admin.templates", "notiser.list"],
};

function setup(role: SupplierRole, extra: Partial<Session> = {}) {
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
  it("samordnaren: dagens startsida i Min veckas stil – inkorgen, flaggor, första möten och uppgifter", async () => {
    const { keys, user } = setup("samordnare");
    const h = await headings("Avropsinkorg");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Min vecka");
    expect(screen.getByText(`${user.name} · ${user.title}`)).toBeTruthy();
    expect(screen.getByText(/^Måndag 1 februari · vecka 5\. Det här behöver du göra/)).toBeTruthy();
    expect(KPI_LABELS()).toEqual(["Att hantera i inkorgen", "Första möten ej bokade", "Förfaller i dag", "Flaggor att kvittera"]);
    // Rutor som leder till en annan sida är länkar; rutor som leder till ett avsnitt på sidan är knappar.
    const links = KPI_LINKS();
    expect(Object.keys(links)).toEqual(["Att hantera i inkorgen", "Förfaller i dag"]);
    expect(links["Att hantera i inkorgen"]).toMatch(/^#\/inkorg(\/[\w-]+)?$/);
    expect(links["Förfaller i dag"]).toBe("#/forfaller");
    // Den röda rutan har undertexten som vanlig text (som coachens) – inget rött märke i rutan.
    const inbox = KPI_TILES()[0];
    expect(inbox.textContent).toContain("Närmast: 53 min kvar");
    expect(inbox.querySelectorAll(".rounded-full")).toHaveLength(0);
    for (const t of ["Avropsinkorg", "Flaggor (12)", "Första möten som inte är bokade", "Förfaller snart", "Avtalsavvikelser", "Tilldelning ger notis", "Olästa notiser"]) {
      expect(h, t).toContain(t);
    }
    expect(h.some((x) => x.startsWith("Öppna uppgifter ("))).toBe(true);
    // Ingen "Öppna"-knapp i listraderna – rubriken är länken.
    expect(screen.queryAllByRole("link", { name: "Öppna" })).toHaveLength(0);
    for (const k of keys) expect(ALLOWED.samordnare, k).toContain(k);
  });

  it("avtalsansvarig: skyddade avrop och Avtalet: avvikelser och frågor", async () => {
    const { keys } = setup("avtalsansvarig");
    const h = await headings("Avropsinkorg");
    expect(h).toContain("Skyddade avrop");
    expect(h).toContain("Avtalet: avvikelser och frågor");
    expect(screen.getByText("Omar Farah · i dag kl. 07.55 · väntar på telefonsamtal")).toBeTruthy();
    for (const k of keys) expect(ALLOWED.avtalsansvarig, k).toContain(k);
  });

  it("coachen: förebilden är oförändrad (samma rubriker och rutor)", async () => {
    const { keys } = setup("coach");
    const h = await headings("I dag");
    expect(KPI_LABELS()).toEqual(["Närvaro att registrera", "Aktiviteter i dag", "AI-utkast att granska", "Månads­bedömningar januari"]);
    expect(KPI_LINKS()).toEqual({});
    for (const t of ["Påminnelser", "Olästa notiser"]) expect(h, t).toContain(t);
    expect(h.some((x) => x.startsWith("Närvaro att registrera – vecka 4"))).toBe(true);
    expect(h.some((x) => x.startsWith("Veckokalender – vecka 5"))).toBe(true);
    for (const k of keys) expect(ALLOWED.coach, k).toContain(k);
  });

  it("handledaren: närvaro att registrera, i dag, kommande sju dagar och praktikplatser – bara tilldelade ärenden", async () => {
    const { keys } = setup("handledare");
    const h = await headings("Mina tilldelade ärenden");
    expect(KPI_LABELS()).toEqual(["Närvaro att registrera", "Tillfällen i dag", "Yrkesmoment den här veckan", "Praktik som saknar något av de fyra rätten"]);
    expect(KPI_LINKS()).toEqual({});
    // Ett tal med en enhet: yrkesmomenten den här veckan, praktikdagarna i undertexten (förut summan av båda).
    const week = KPI_TILES()[2];
    expect(week.querySelector(":scope > div:nth-child(2)")?.textContent).toBe("41");
    expect(week.textContent).toContain("11 praktikdagar · v. 5");
    for (const t of ["Kommande sju dagar", "Mina tilldelade ärenden", "Olästa notiser"]) expect(h, t).toContain(t);
    expect(h.some((x) => /^Närvaro( att registrera)? – vecka 4$/.test(x))).toBe(true);
    expect(h.some((x) => x.startsWith("I dag – måndag"))).toBe(true);
    expect(screen.getByText(/26 pågående/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Öppna listan/ }).getAttribute("href")).toBe("#/handledare");
    for (const k of keys) expect([...ALLOWED.handledare, "session.ping"], k).toContain(k);
  });

  it("handledaren: nästa tillfälle i dag har text och ikon (Nästa · om …), inte bara den röda kanten", async () => {
    // Tisdag 2 februari kl. 08.00: dagens yrkesmoment börjar 09.00.
    rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock("2027-02-02T08:00") });
    setup("handledare");
    await headings("Mina tilldelade ärenden");
    const card = screen.getByRole("heading", { name: /^I dag – tisdag/ }).closest("section") as HTMLElement;
    const next = within(card).getAllByText(/^Nästa · om 1 tim/);
    expect(next).toHaveLength(1);
    // Märket står i raden med den röda kanten.
    const row = next[0].closest("div.shadow-\\[inset_4px_0_0_var\\(--color-rod\\)\\]");
    expect(row).not.toBeNull();
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

  it("ekonomen: fakturakörningen, uppgifterna och referenserna – samma kort som Fakturering", async () => {
    const { keys } = setup("ekonom");
    const h = await headings("Uppgifter till dig");
    expect(KPI_LABELS()).toEqual(["Januari att fakturera", "Stoppade fakturor", "Preskriptions­risk", "Senast i Fortnox"]);
    expect(KPI_LINKS()).toEqual({ "Januari att fakturera": "#/ekonomi/2027-01", "Stoppade fakturor": "#/ekonomi/2027-01?filter=stoppade", "Senast i Fortnox": "#/ekonomi/2027-01" });
    for (const t of ["Fakturakörning januari 2027", "Beställarreferens saknas eller är fel", "Returnerade fakturor", "Veckor utan närvaro att kontrollera", "Olästa notiser"]) {
      expect(h, t).toContain(t);
    }
    expect(screen.getByRole("link", { name: "Öppna körningen januari" }).getAttribute("href")).toBe("#/ekonomi/2027-01");
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
