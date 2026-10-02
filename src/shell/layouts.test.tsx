// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/api/roles";
import { BackendProvider, type Backend } from "./backend";
import { LayoutFor } from "./layouts";
import { NavProvider, type LinkImpl, type Nav } from "./nav";
import type { RouteDef } from "./routes";
import { RuntimeProvider, type RuntimeMode } from "./runtime";
import { SessionProvider, type Session } from "./session";

afterEach(cleanup);

const A: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

function setup(opts: { role: Role; path: string; routePath?: string; area: RouteDef["area"]; runtime?: RuntimeMode; personas?: boolean; unit?: string; resultFile?: boolean }) {
  const push = vi.fn();
  const switchRole = vi.fn();
  const nav: Nav = { path: opts.path, query: new URLSearchParams(), push, replace: vi.fn(), back: vi.fn(), href: (to) => `#${to}` };
  const backend: Backend = {
    mode: "demo",
    query: async (key) =>
      key === "session.navCounts"
        ? { inbox: 6, deadlines: 3, unregistered: 2, notifications: 4, ...(opts.resultFile !== undefined ? { resultFile: opts.resultFile } : {}) }
        : { now: "2027-02-01T09:12", role: opts.role, userId: "u-x" },
    command: async () => null,
  };
  const session: Session = {
    actor: { userId: "u-x", role: opts.role, contractIds: ["c-bot"] },
    user: { id: "u-x", name: "Test Person", title: "Titel", email: "test@example.se", orgName: "Org", unit: opts.unit ?? null },
    personas: opts.personas ? [{ userId: "u-x", role: opts.role, name: "Test Person", title: "Titel" }, { userId: "u-y", role: "chef", name: "Annan Person", title: "Chef" }] : undefined,
    switchRole,
  };
  const route: RouteDef = { path: opts.routePath ?? opts.path, title: "T", roles: [opts.role], area: opts.area, screen: () => null };
  const wrap = (children: ReactNode) => (
    <RuntimeProvider mode={opts.runtime ?? "demo"}>
      <BackendProvider backend={backend}>
        <SessionProvider session={session}>
          <NavProvider nav={nav} LinkImpl={A}>
            {children}
          </NavProvider>
        </SessionProvider>
      </BackendProvider>
    </RuntimeProvider>
  );
  render(wrap(<LayoutFor match={{ route, params: {} }}>
    <p>Innehåll</p>
  </LayoutFor>));
  return { push, switchRole };
}

describe("MB-layout", () => {
  it("sidopanel med rollens meny, räknare, aktiv sida och användaren", async () => {
    setup({ role: "samordnare", path: "/arenden/case-1", routePath: "/arenden/:caseId", area: "mb" });
    const menu = screen.getByRole("navigation", { name: "Meny" });
    const links = within(menu).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Notiser", "Startsida", "Avropsinkorg", "Förfaller", "Ärenden", "Rapporter", "Bygg rapport", "Arbetsgivare och praktik"]);
    // Räknarna kommer från navCounts.
    expect(await within(menu).findByText("6")).toBeTruthy();
    expect(within(menu).getByRole("link", { name: /Notiser/ }).textContent).toBe("Notiser 4 olästa");
    expect(within(menu).getByRole("link", { name: /Förfaller/ }).textContent).toBe("Förfaller 3");
    // Ärendekortet hör till Ärenden.
    expect(within(menu).getByRole("link", { name: "Ärenden" }).getAttribute("aria-current")).toBe("page");
    expect(within(menu).getByRole("link", { name: "Ärenden" }).getAttribute("href")).toBe("#/arenden");
    expect(screen.getByText("Test Person")).toBeTruthy();
    expect(screen.getByText("Operativ samordnare")).toBeTruthy();
    expect(screen.getByRole("main").id).toBe("main");
    expect(screen.getByRole("link", { name: "Hoppa till innehållet" })).toBeTruthy();
    // Prototypen: påhittade testdata.
    expect(screen.getByText("Påhittade testdata.")).toBeTruthy();
  });

  it("mobilmenyn öppnas med knappen Meny", () => {
    setup({ role: "coach", path: "/min-vecka", area: "mb" });
    const btn = screen.getByRole("button", { name: "Meny" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("ekonomen får förra månadens fakturakörning", async () => {
    setup({ role: "ekonom", path: "/ekonomi", area: "mb" });
    expect(await screen.findByRole("link", { name: "Fakturakörning januari" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fakturakörning januari" }).getAttribute("href")).toBe("#/ekonomi/2027-01");
  });
});

describe("utvecklingsläget", () => {
  it("visar testpersonväljaren i riktiga appen och byter person", () => {
    const { switchRole } = setup({ role: "coach", path: "/min-vecka", area: "mb", runtime: "app", personas: true });
    const select = screen.getByLabelText("Utvecklingsläge – testperson:") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "u-y|chef" } });
    expect(switchRole).toHaveBeenCalledWith("chef", "u-y");
    expect(screen.getByText("Påhittade testdata.")).toBeTruthy();
  });
  it("syns inte i prototypen", () => {
    setup({ role: "coach", path: "/min-vecka", area: "mb", runtime: "demo", personas: true });
    expect(screen.queryByLabelText("Utvecklingsläge – testperson:")).toBeNull();
  });
  it("syns inte utan testpersoner (produktion) – och ingen text om testdata", () => {
    setup({ role: "coach", path: "/min-vecka", area: "mb", runtime: "app", personas: false });
    expect(screen.queryByLabelText("Utvecklingsläge – testperson:")).toBeNull();
    expect(screen.queryByText("Påhittade testdata.")).toBeNull();
  });
});

describe("kommunens portal", () => {
  it("meny med aktiv sida, namn och enhet, logga ut", () => {
    const { push } = setup({ role: "kommun_handlaggare", path: "/portal/deltagare/case-1", routePath: "/portal/deltagare/:caseId?", area: "portal", unit: "Arbetsmarknadsenheten Alby" });
    const menu = screen.getByRole("navigation", { name: "Portalmeny" });
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Start", "Beställ ny insats", "Mina deltagare", "Rapporter och meddelanden"]);
    expect(within(menu).getByRole("link", { name: "Mina deltagare" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Test Person, Arbetsmarknadsenheten Alby")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Logga ut" }));
    expect(push).toHaveBeenCalledWith("/portal/logga-in");
    // Ingen sidopanel och portalens textstorlek.
    expect(screen.queryByRole("complementary", { name: "Huvudmeny" })).toBeNull();
    expect(screen.getByRole("main").closest("[data-area=portal]")).toBeTruthy();
  });
  it("startsidan har ingen meny – bara de stora knapparna", () => {
    setup({ role: "kommun_handlaggare", path: "/portal", area: "portal", unit: "Arbetsmarknadsenheten Alby" });
    expect(screen.queryByRole("navigation", { name: "Portalmeny" })).toBeNull();
    expect(screen.getByRole("button", { name: "Logga ut" })).toBeTruthy();
    expect(screen.getByText("Test Person, Arbetsmarknadsenheten Alby")).toBeTruthy();
  });
  it("inloggningssidan har ingen meny och ingen utloggning", () => {
    setup({ role: "kommun_handlaggare", path: "/portal/logga-in", area: "portal" });
    expect(screen.queryByRole("navigation", { name: "Portalmeny" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Logga ut" })).toBeNull();
    expect(screen.getByText("Portal för beställare")).toBeTruthy();
  });
  it("chefen har sin egen meny", () => {
    setup({ role: "kommun_chef", path: "/portal/bestallarrapport", area: "portal" });
    const menu = screen.getByRole("navigation", { name: "Portalmeny" });
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Beställarrapport", "Enhetens deltagare", "Rapporter"]);
  });
  it("chefen får Hämta resultat sist när avtalet har resultatfilen", async () => {
    setup({ role: "kommun_chef", path: "/portal/resultat", area: "portal", resultFile: true });
    const menu = screen.getByRole("navigation", { name: "Portalmeny" });
    expect(await within(menu).findByRole("link", { name: "Hämta resultat" })).toBeTruthy();
    expect(within(menu).getAllByRole("link").map((a) => a.textContent)).toEqual(["Beställarrapport", "Enhetens deltagare", "Rapporter", "Hämta resultat"]);
    expect(within(menu).getByRole("link", { name: "Hämta resultat" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("puls och om", () => {
  it("pulsen: bara innehållet i en centrerad yta", () => {
    setup({ role: "deltagare", path: "/puls", area: "puls" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("main").textContent).toBe("Innehåll");
  });
});
