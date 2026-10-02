// @vitest-environment jsdom
// Omgång 2 av UI/UX-arbetet (vardagen): utvecklingsfasen bara i prototypen, upptagna knappar behåller fokus, riktiga länkar i
// tabellrader, dialoger med osparad text, felsammanfattning och personnummer som kan döljas igen.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavProvider, type LinkImpl, type Nav } from "@/shell/nav";
import { RuntimeProvider, withoutPrototypeWords, type RuntimeMode } from "@/shell/runtime";
import { SessionProvider, type Session } from "@/shell/session";
import { BuildPhase, Button, ConfirmHost, ErrorSummary, Field, focusFirstError, Input, MaskedPnr, Modal, ModalCancelButton, Table } from "@/ui";

afterEach(cleanup);

const A: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);
function wrap(children: ReactNode, opts: { runtime?: RuntimeMode; push?: Nav["push"] } = {}) {
  const nav: Nav = { path: "/", query: new URLSearchParams(), push: opts.push ?? vi.fn(), replace: vi.fn(), back: vi.fn(), href: (to) => to };
  const session: Session = { actor: { userId: "u-x", role: "samordnare", contractIds: [] }, user: { id: "u-x", name: "Test", title: "", email: "", orgName: "" } };
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

describe("utvecklingsfasen (BuildPhase)", () => {
  it("prototypen visar 'Byggs i fas N'", () => {
    render(wrap(<BuildPhase fas={2} />, { runtime: "demo" }));
    expect(screen.getByText("Byggs i fas 2")).toBeTruthy();
  });
  it("appen visar ingen märkning för det som fungerar – och 'Kommer senare' för det som är avstängt", () => {
    const { container } = render(wrap(<BuildPhase fas={2} />));
    expect(container.textContent).toBe("");
    cleanup();
    render(wrap(<BuildPhase fas={3} off />));
    expect(screen.getByText("Kommer senare")).toBeTruthy();
    expect(screen.queryByText(/Byggs i fas/)).toBeNull();
  });
  it("text från konfigurationen nämner inte prototypen i appen", () => {
    expect(withoutPrototypeWords("Preliminärt i prototypen: avslut till arbete räknas.", "app")).toBe("Preliminärt: avslut till arbete räknas.");
    expect(withoutPrototypeWords("I prototypen: egna ärenden", "app")).toBe("Tills vidare: egna ärenden");
    expect(withoutPrototypeWords("Preliminärt i prototypen: x", "demo")).toBe("Preliminärt i prototypen: x");
  });
});

describe("knapp som arbetar (pending)", () => {
  it("är aria-disabled men inte disabled – fokus stannar – och klick ignoreras", () => {
    const fn = vi.fn();
    render(
      <Button pending onClick={fn}>
        Spara
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Spara" }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("aria-busy")).toBe("true");
    b.focus();
    fireEvent.click(b);
    expect(fn).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(b);
  });
});

describe("tabellrader som leder till en sida (rowHref)", () => {
  const rows = [{ id: "a", n: "BOT-26-0143", s: "Pågår" }];
  const cols = [
    { key: "n", label: "Ärende" },
    { key: "s", label: "Status" },
  ];
  it("första kolumnen är en riktig länk och raden har inget eget tabbstopp", () => {
    render(wrap(<Table columns={cols} rows={rows} rowHref={(r) => `/arenden/${r.id}`} />));
    const link = screen.getByRole("link", { name: "BOT-26-0143" });
    expect(link.getAttribute("href")).toBe("/arenden/a");
    expect(link.closest("tr")!.hasAttribute("tabindex")).toBe(false);
  });
  it("klick i raden byter sida; ctrl-klick och mittenklick öppnar en ny flik", () => {
    const push = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(wrap(<Table columns={cols} rows={rows} rowHref={(r) => `/arenden/${r.id}`} />, { push }));
    const cell = screen.getByText("Pågår");
    fireEvent.click(cell);
    expect(push).toHaveBeenCalledWith("/arenden/a");
    fireEvent.click(cell, { ctrlKey: true });
    expect(open).toHaveBeenCalledWith("/arenden/a", "_blank", "noopener");
    fireEvent(cell, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});

describe("dialog med osparad text", () => {
  function Host({ onClosed }: { onClosed: () => void }) {
    const [open, setOpen] = useState(true);
    const [text, setText] = useState("");
    return (
      <>
        <ConfirmHost />
        {open && (
          <Modal
            title="Skriv anteckning"
            dirty={!!text}
            onClose={() => {
              setOpen(false);
              onClosed();
            }}
            footer={<ModalCancelButton />}
          >
            <label htmlFor="t">Text</label>
            <textarea id="t" value={text} onChange={(e) => setText(e.target.value)} />
          </Modal>
        )}
      </>
    );
  }
  it("Avbryt utan text stänger direkt", async () => {
    const closed = vi.fn();
    render(<Host onClosed={closed} />);
    fireEvent.click(await screen.findByRole("button", { name: "Avbryt" }));
    expect(closed).toHaveBeenCalledTimes(1);
  });
  it("Esc och Avbryt med text frågar först: Fortsätt skriva behåller texten, Släng stänger", async () => {
    const closed = vi.fn();
    render(<Host onClosed={closed} />);
    fireEvent.change(await screen.findByLabelText("Text"), { target: { value: "Arbetsgivaren ringde." } });
    fireEvent.keyDown(screen.getByLabelText("Text"), { key: "Escape" });
    expect(await screen.findByRole("dialog", { name: "Vill du slänga det du skrivit?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fortsätt skriva" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Vill du slänga det du skrivit?" })).toBeNull());
    expect(closed).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("Arbetsgivaren ringde.");
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    fireEvent.click(await screen.findByRole("button", { name: "Släng" }));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });
});

describe("fel i formulär", () => {
  it("felsammanfattningen läses upp och länkarna flyttar fokus till fältet", () => {
    render(
      <>
        <ErrorSummary items={[{ id: "f-namn", text: "Skriv personens namn." }]} />
        <Field id="f-namn" label="Namn" error="Skriv personens namn.">
          <Input value="" onValueChange={() => undefined} />
        </Field>
      </>,
    );
    const alertBox = screen.getAllByRole("alert")[0];
    expect(alertBox.textContent).toContain("Rätta det här innan du går vidare");
    const link = screen.getByRole("link", { name: "Skriv personens namn." });
    expect(link.getAttribute("href")).toBe("#f-namn");
    fireEvent.click(link);
    expect(document.activeElement?.id).toBe("f-namn");
  });
  it("focusFirstError fokuserar första fältet med fel", async () => {
    render(
      <div id="formular">
        <Field id="ok" label="Ok">
          <Input value="x" onValueChange={() => undefined} />
        </Field>
        <Field id="fel" label="Fel" error="Fyll i.">
          <Input value="" onValueChange={() => undefined} />
        </Field>
      </div>,
    );
    focusFirstError(document.getElementById("formular"));
    await waitFor(() => expect(document.activeElement?.id).toBe("fel"));
  });
});

describe("personnummer", () => {
  it("Visa flyttar fokus till numret, och Dölj döljer det igen och ger fokus till Visa", async () => {
    const reveal = vi.fn(async () => "20000101-0000");
    render(wrap(<MaskedPnr masked="••••••••-0000" onReveal={reveal} />));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Visa" })));
    expect(screen.getByText("20000101-0000")).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("20000101-0000"));
    fireEvent.click(screen.getByRole("button", { name: "Dölj" }));
    expect(screen.queryByText("20000101-0000")).toBeNull();
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Visa"));
  });
});
