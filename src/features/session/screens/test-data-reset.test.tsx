// @vitest-environment jsdom
// Knappen "Läs in testdata på nytt": bara för testare i testmiljön, med bekräftelse, och felet visas om inläsningen misslyckas.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, type Session } from "@/shell/session";
import { ConfirmHost } from "@/ui";
import { TestDataReset } from "./test-data-reset";

afterEach(cleanup);

const base: Session = {
  authenticated: true,
  actor: { userId: "tester-karim", role: "admin", contractIds: ["c-bot", "c-kk"] },
  user: { id: "tester-karim", name: "Karim Khalil", title: "Testare", email: "", orgName: "Miljonbemanning AB" },
};

function renderWith(s: Partial<Session>) {
  return render(
    <SessionProvider session={{ ...base, ...s }}>
      <TestDataReset />
      <ConfirmHost />
    </SessionProvider>,
  );
}

const BUTTON = { name: "Läs in testdata på nytt" };

describe("TestDataReset", () => {
  it("syns inte för andra än testare i testmiljön (och aldrig i prototypen eller produktion)", () => {
    const reload = vi.fn();
    for (const s of [
      {},
      { environment: "memory" as const, reloadTestData: reload },
      { isTester: true, environment: "production" as const, reloadTestData: reload },
      { isTester: false, environment: "staging" as const, reloadTestData: reload },
      { isTester: true, environment: "staging" as const },
    ]) {
      const { container, unmount } = renderWith(s);
      expect(container.textContent).toBe("");
      unmount();
    }
    expect(reload).not.toHaveBeenCalled();
  });

  it("frågar först och läser bara in efter bekräftelse", async () => {
    const reload = vi.fn(() => new Promise<never>(() => undefined));
    renderWith({ isTester: true, environment: "staging", reloadTestData: reload });
    expect(screen.getByText(/Allt som har testats nollställs för alla testare/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", BUTTON));
    expect(await screen.findByRole("dialog", { name: "Läsa in testdatat på nytt?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", BUTTON));
    const dialog = await screen.findByRole("dialog", { name: "Läsa in testdatat på nytt?" });
    expect(dialog.textContent).toContain("måndag 1 februari 2027 kl. 09.12");
    const confirmButtons = screen.getAllByRole("button", BUTTON);
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(await screen.findByText("Läser in testdatat. Sidan laddas om när det är klart.")).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("visar felet om inläsningen misslyckas", async () => {
    const reload = vi.fn(async () => ({ ok: false as const, message: "Nycklarna för personnummer saknas i testmiljön." }));
    renderWith({ isTester: true, environment: "staging", reloadTestData: reload });
    fireEvent.click(screen.getByRole("button", BUTTON));
    await screen.findByRole("dialog");
    const buttons = screen.getAllByRole("button", BUTTON);
    fireEvent.click(buttons[buttons.length - 1]);
    expect((await screen.findByRole("alert")).textContent).toContain("Nycklarna för personnummer saknas i testmiljön.");
    expect(screen.queryByText("Läser in testdatat. Sidan laddas om när det är klart.")).toBeNull();
  });
});
