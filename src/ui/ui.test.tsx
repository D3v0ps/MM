// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/api/roles";
import { NavProvider, type LinkImpl, type Nav } from "@/shell/nav";
import { RuntimeProvider, type RuntimeMode } from "@/shell/runtime";
import { SessionProvider, type Session } from "@/shell/session";
import {
  CaseLink,
  CaseStatusBadge,
  ConfirmHost,
  DemoNote,
  Field,
  Input,
  Kpi,
  Kv,
  MaskedPnr,
  PerspectiveLink,
  QueryView,
  Seg,
  SlaBadge,
  Status,
  Table,
  Tabs,
  Toaster,
  confirmDialog,
  resetAuditViews,
  toast,
  useAuditView,
} from "@/ui";

afterEach(cleanup);

const A: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);
function wrap(children: ReactNode, opts: { role?: Role; runtime?: RuntimeMode; switchRole?: Session["switchRole"]; push?: Nav["push"] } = {}) {
  const nav: Nav = { path: "/", query: new URLSearchParams(), push: opts.push ?? vi.fn(), replace: vi.fn(), back: vi.fn(), href: (to) => `#${to}` };
  const session: Session = {
    actor: { userId: "u-x", role: opts.role ?? "samordnare", contractIds: [] },
    user: { id: "u-x", name: "Test", title: "", email: "", orgName: "" },
    switchRole: opts.switchRole,
  };
  return (
    <RuntimeProvider mode={opts.runtime ?? "app"}>
      <SessionProvider session={session}>
        <NavProvider nav={nav} LinkImpl={A}>
          {children}
        </NavProvider>
      </SessionProvider>
    </RuntimeProvider>
  );
}

describe("Field och kontroller", () => {
  it("kopplar etikett, hjälptext och fel med aria-describedby", () => {
    render(
      <Field id="ref" label="Beställarreferens" help="8–10 siffror." error="Beställarreferensen ska vara 8–10 siffror. Du har skrivit 7." required>
        <Input value="5510298" onValueChange={() => undefined} />
      </Field>,
    );
    const input = screen.getByLabelText(/Beställarreferens/);
    expect(input.id).toBe("ref");
    expect(input.getAttribute("aria-describedby")).toBe("ref-help ref-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.hasAttribute("required")).toBe(true);
    expect(document.getElementById("ref-error")?.textContent).toContain("Du har skrivit 7.");
    expect(screen.getByRole("alert").textContent).toContain("8–10 siffror");
  });
  it("utan fel: inget aria-invalid och bara hjälptexten", () => {
    render(
      <Field label="Namn" help="Förnamn och efternamn.">
        <Input value="" onValueChange={() => undefined} />
      </Field>,
    );
    const input = screen.getByLabelText("Namn");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-help`);
  });
  it("onValueChange får texten", () => {
    const fn = vi.fn();
    render(
      <Field label="E-post">
        <Input type="email" value="" onValueChange={fn} />
      </Field>,
    );
    fireEvent.change(screen.getByLabelText("E-post"), { target: { value: "a@b.se" } });
    expect(fn).toHaveBeenCalledWith("a@b.se");
  });
});

describe("Seg", () => {
  function Multi() {
    const [v, setV] = useState<string[]>(["a"]);
    return <Seg multi ariaLabel="Spår" value={v} onValueChange={setV} options={["a", "b", "c"]} />;
  }
  it("flerval växlar aria-pressed", () => {
    render(<Multi />);
    const b = screen.getByRole("button", { name: "b" });
    expect(screen.getByRole("button", { name: "a" }).getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(b.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(screen.getByRole("button", { name: "a" }).getAttribute("aria-pressed")).toBe("false");
  });
  it("i ett Field namnges gruppen av fältets etikett", () => {
    render(
      <Field id="st" label="Samlad status">
        <Seg value={null} onValueChange={() => undefined} options={[{ value: "green", label: "Grön" }]} />
      </Field>,
    );
    expect(screen.getByRole("group", { name: "Samlad status" })).toBeTruthy();
  });
});

describe("Tabs", () => {
  function T() {
    const [a, setA] = useState<"x" | "y" | "z">("x");
    return <Tabs active={a} onChange={setA} tabs={[{ id: "x", label: "Översikt" }, { id: "y", label: "Närvaro", count: 3 }, { id: "z", label: "Rapporter", count: 0 }]} />;
  }
  it("piltangenter, Home och End byter flik; räknare 0 visas inte", () => {
    render(<T />);
    const list = screen.getByRole("tablist");
    expect(screen.getByRole("tab", { name: "Översikt" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /^Närvaro/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tab", { name: "Rapporter" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Översikt" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Översikt" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Rapporter" }).tabIndex).toBe(-1);
  });
});

describe("status alltid med text", () => {
  it("Status, CaseStatusBadge och SlaBadge", () => {
    render(
      <>
        <Status value="green" />
        <Status value="red" short />
        <Status value={null} />
        <CaseStatusBadge status="acknowledged" />
        <SlaBadge sla={{ tone: "urgent", label: "53 min kvar" }} dueAt="2027-02-01T10:05" />
      </>,
    );
    expect(screen.getByText("Grön – enligt plan")).toBeTruthy();
    expect(screen.getByText("Röd")).toBeTruthy();
    expect(screen.getByText("Ej bedömd")).toBeTruthy();
    expect(screen.getByText("Ordererkänd")).toBeTruthy();
    expect(screen.getByText("53 min kvar").closest("[title]")?.getAttribute("title")).toBe("Förfaller måndag 1 feb 2027 kl. 10.05");
  });
  it("Kpi visar status som text", () => {
    render(
      <>
        <Kpi label="A" value="1" tone="alert" />
        <Kpi label="B" value="2" tone="watch" statusText="Flaggat" />
      </>,
    );
    expect(screen.getByText("Kräver åtgärd")).toBeTruthy();
    expect(screen.getByText("Flaggat")).toBeTruthy();
  });
  it("Kv hoppar över tomma rader och visar – för saknat värde", () => {
    render(<Kv items={[["Ärende", "BOT-26-0143"], null, ["Coach", null]]} />);
    expect(screen.getAllByRole("definition").map((d) => d.textContent)).toEqual(["BOT-26-0143", "–"]);
  });
});

describe("Table", () => {
  it("klickbara rader nås med tangentbordet; tom tabell visar texten", () => {
    const fn = vi.fn();
    const rows = [{ id: "a", n: "BOT-1" }];
    const { rerender } = render(<Table columns={[{ key: "n", label: "Ärende" }]} rows={rows} onRowClick={fn} />);
    const row = screen.getByText("BOT-1").closest("tr")!;
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(fn).toHaveBeenCalledWith(rows[0]);
    rerender(<Table columns={[{ key: "n", label: "Ärende" }]} rows={[]} empty="Inga ärenden." />);
    expect(screen.getByText("Inga ärenden.")).toBeTruthy();
  });
});

describe("ärende och personnummer", () => {
  it("CaseLink leder till rätt vy för rollen", () => {
    const { unmount } = render(wrap(<CaseLink caseId="case-1" caseNumber="BOT-26-0143" />, { role: "coach" }));
    expect(screen.getByRole("link", { name: "BOT-26-0143" }).getAttribute("href")).toBe("#/arenden/case-1");
    unmount();
    render(wrap(<CaseLink caseId="case-1" caseNumber="BOT-26-0143" />, { role: "kommun_chef" }));
    expect(screen.getByRole("link", { name: "BOT-26-0143" }).getAttribute("href")).toBe("#/portal/deltagare/case-1");
    cleanup();
    render(wrap(<CaseLink caseId="case-1" caseNumber="BOT-26-0143" />, { role: "ekonom" }));
    expect(screen.getByRole("link", { name: "BOT-26-0143" }).getAttribute("href")).toBe("#/ekonomi/arende/case-1");
  });
  it("MaskedPnr visar hela numret först efter Visa och anropar onReveal", async () => {
    const reveal = vi.fn(async () => "20000101-0000");
    render(wrap(<MaskedPnr masked="••••••••-0000" onReveal={reveal} />));
    expect(screen.getByText("••••••••-0000")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Visa" })));
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("20000101-0000")).toBeTruthy();
    expect(screen.getByText("(visning loggad)")).toBeTruthy();
  });
  it("MaskedPnr för roll utan behörighet", () => {
    render(<MaskedPnr masked={null} hidden />);
    expect(screen.getByText("Visas inte för din roll")).toBeTruthy();
  });
  it("useAuditView loggar en gång per användare och nyckel – och igen efter ett nytt sidbesök (resetAuditViews)", () => {
    const log = vi.fn();
    function V({ id }: { id: string }) {
      useAuditView(`case.view:${id}`, log);
      return null;
    }
    const { rerender } = render(wrap(<V id="c1" />));
    rerender(wrap(<V id="c1" />));
    expect(log).toHaveBeenCalledTimes(1);
    rerender(wrap(<V id="c2" />));
    expect(log).toHaveBeenCalledTimes(2);
    // Samma kort igen i samma besök: ingen ny rad. Nytt sidbesök (skalet tömmer minnet): en ny rad.
    rerender(wrap(<V id="c1" />));
    expect(log).toHaveBeenCalledTimes(2);
    act(() => resetAuditViews());
    rerender(wrap(<V id="c1" />));
    expect(log).toHaveBeenCalledTimes(2);
    rerender(wrap(<V id="c2" />));
    rerender(wrap(<V id="c1" />));
    expect(log).toHaveBeenCalledTimes(4);
  });
});

describe("bara i prototypen", () => {
  it("DemoNote och PerspectiveLink syns inte i riktiga appen", () => {
    render(wrap(<><DemoNote>Förklaring</DemoNote><PerspectiveLink role="kommun_handlaggare" to="/portal" /></>, { runtime: "app", switchRole: vi.fn() }));
    expect(screen.queryByText("Förklaring")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("PerspectiveLink byter roll och navigerar i prototypen", () => {
    const switchRole = vi.fn();
    const push = vi.fn();
    render(wrap(<PerspectiveLink role="kommun_handlaggare" userId="k-maria" to="/portal/deltagare/case-1" />, { runtime: "demo", switchRole, push }));
    fireEvent.click(screen.getByRole("button", { name: "Se samma sak från kundens håll" }));
    expect(switchRole).toHaveBeenCalledWith("kommun_handlaggare", "k-maria");
    expect(push).toHaveBeenCalledWith("/portal/deltagare/case-1");
  });
  it("DemoNote syns i prototypen med prefixet Prototyp:", () => {
    render(wrap(<DemoNote>Förklaring</DemoNote>, { runtime: "demo" }));
    expect(screen.getByText("Prototyp:")).toBeTruthy();
  });
});

describe("toast, bekräftelse och laddning", () => {
  it("toast visas i role=status", () => {
    render(<Toaster />);
    act(() => toast("Avropet är accepterat."));
    expect(screen.getByRole("status").textContent).toContain("Avropet är accepterat.");
  });
  it("confirmDialog löses med true vid bekräfta och false vid avbryt", async () => {
    render(<ConfirmHost />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirmDialog({ title: "Avböj avropet?", body: "Kommunen får ett mejl.", confirmLabel: "Avböj", tone: "danger" });
    });
    expect(await screen.findByRole("dialog", { name: "Avböj avropet?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avböj" }));
    await expect(p).resolves.toBe(true);
    act(() => {
      p = confirmDialog({ body: "Säker?" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Avbryt" }));
    await expect(p).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("QueryView: fel visar serverns text bara för API-fel", () => {
    const apiErr = Object.assign(new Error("Din roll har inte behörighet till det här."), { code: "forbidden" });
    const { rerender } = render(<QueryView query={{ data: undefined, isLoading: false, error: apiErr }}>{() => "data"}</QueryView>);
    expect(screen.getByText("Din roll har inte behörighet till det här.")).toBeTruthy();
    rerender(<QueryView query={{ data: undefined, isLoading: false, error: new TypeError("Failed to fetch") }}>{() => "data"}</QueryView>);
    expect(screen.getByText("Något gick fel. Försök igen.")).toBeTruthy();
    rerender(<QueryView query={{ data: [1, 2], isLoading: false, error: null }}>{(d) => `rader: ${d.length}`}</QueryView>);
    expect(screen.getByText("rader: 2")).toBeTruthy();
  });
});
