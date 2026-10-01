// @vitest-environment jsdom
// "Lämna synpunkt" och "Alla synpunkter" i testmiljöns verktygsfält – hela vägen genom samma hanterare som appen
// (feedback.* via porten, minnesläget med testmiljöns data). Minnesläget har inga testare, så e2e-testerna (Playwright)
// kan inte logga in som testare; därför prövas flödet här: lämna en synpunkt, se den i listan, ändra status, svara och
// ladda ner CSV. Knapparna syns bara för testare i testmiljön.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { DEMO_START } from "@/data/seed";
import { seedData } from "@/data/supabase/seed-rows";
import { NavProvider, type LinkImpl, type Nav } from "@/shell/nav";
import type { RouteDef } from "@/shell/routes";
import { SessionProvider, type Session } from "@/shell/session";
import { DownloadProvider, type DownloadFile } from "@/ui/download";
import "@/api/handlers";
import { feedbackPortOf, type FeedbackPort } from "./api";
import { FeedbackToolbar } from "./panel";

afterEach(cleanup);

const SEED = seedData();
const ROUTES: RouteDef[] = [{ path: "/arenden/:caseId", title: "Deltagarkort", roles: ["coach"], area: "mb", screen: () => null }];
const A: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

let rt: MemoryRuntime;
let actor: Actor;
let port: FeedbackPort;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
  // Karim (testare) agerar som coachen Amira – som servern bygger aktören i testmiljön.
  actor = { ...listPersonas(rt.raw()).find((p) => p.actor.userId === "u-amira")!.actor, testerId: "tester-karim" };
  port = feedbackPortOf({ query: (k, p) => rt.run("query", k, p, actor), command: (k, p) => rt.run("command", k, p, actor) });
});

function setup(s: Partial<Session>, files: DownloadFile[] = []) {
  const push = vi.fn();
  const nav: Nav = { path: "/arenden/case-260143", query: new URLSearchParams("flik=narvaro&q=Anna Svensson"), push, replace: vi.fn(), back: vi.fn(), href: (to) => to };
  const session: Session = {
    authenticated: true,
    actor,
    user: { id: "u-amira", name: "Amira Haddad", title: "Huvudcoach", email: "", orgName: "Miljonbemanning AB" },
    ...s,
  };
  const wrap = (children: ReactNode) => (
    <DownloadProvider impl={async (f) => (files.push(f), true)}>
      <SessionProvider session={session}>
        <NavProvider nav={nav} LinkImpl={A}>
          {children}
        </NavProvider>
      </SessionProvider>
    </DownloadProvider>
  );
  const r = render(wrap(<FeedbackToolbar routes={ROUTES} />));
  return { ...r, push, files };
}

describe("FeedbackToolbar", () => {
  it("syns bara för testare i testmiljön (aldrig i produktion, i prototypen eller för vanliga användare)", () => {
    for (const s of [
      {},
      { isTester: true, environment: "staging" as const },
      { isTester: true, environment: "production" as const, feedback: port },
      { isTester: false, environment: "staging" as const, feedback: port },
      { environment: "memory" as const, feedback: port },
    ]) {
      const { container, unmount } = setup(s);
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("lämna en synpunkt och se den i listan: status, svar och nedladdning (CSV)", async () => {
    const { files, push } = setup({ isTester: true, environment: "staging", feedback: port });

    // Lämna synpunkt: rollen och sidan visas, tom text stoppas.
    fireEvent.click(screen.getByRole("button", { name: "Lämna synpunkt" }));
    const dialog = await screen.findByRole("dialog", { name: "Lämna synpunkt" });
    expect(dialog.textContent).toContain("Miljonmatch är inte färdigt.");
    expect(dialog.textContent).toContain("Huvudcoach · Deltagarkort");
    fireEvent.click(within(dialog).getByRole("button", { name: "Spara synpunkt" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Skriv vad du tycker innan du sparar.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Fel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Måste ändras" }));
    fireEvent.change(within(dialog).getByLabelText(/Vad tycker du\?/), { target: { value: "Närvaron går inte att spara på mobilen." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Spara synpunkt" }));
    expect(await within(dialog).findByText("Tack! Synpunkten är sparad.")).toBeTruthy();

    // Sparad med testpersonens roll, testarens id och sidan utan fritext.
    expect(rt.store.rows("feedback")).toEqual([
      expect.objectContaining({ type: "fel", priority: "maste", role: "coach", authorId: "tester-karim", path: "/arenden/case-260143?flik=narvaro", viewTitle: "Deltagarkort", status: "ny" }),
    ]);

    // Alla synpunkter.
    fireEvent.click(within(dialog).getByRole("button", { name: "Visa alla synpunkter" }));
    const list = await screen.findByRole("dialog", { name: "Alla synpunkter" });
    expect(await within(list).findByText("Närvaron går inte att spara på mobilen.")).toBeTruthy();
    expect(within(list).getByText("Visar 1 av 1 synpunkter.")).toBeTruthy();
    expect(list.textContent).toContain("Huvudcoach · Deltagarkort");
    expect(list.textContent).toContain("Du · ");

    // Svar.
    fireEvent.click(within(list).getByRole("button", { name: "Svar" }));
    fireEvent.change(within(list).getByLabelText("Svara"), { target: { value: "Vi tar det på mötet." } });
    fireEvent.click(within(list).getByRole("button", { name: "Svara" }));
    expect(await within(list).findByText("Vi tar det på mötet.")).toBeTruthy();
    expect(await within(list).findByRole("button", { name: "Svar (1)" })).toBeTruthy();

    // Ladda ner (CSV): semikolon, rubriker och synpunkten.
    fireEvent.click(within(list).getByRole("button", { name: "Ladda ner (CSV)" }));
    expect(files).toHaveLength(1);
    expect(files[0].filename).toMatch(/^synpunkter-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(files[0].mime).toBe("text/csv;charset=utf-8");
    const csv = String(files[0].content).split("\r\n");
    expect(csv[0]).toBe("Tid;Typ;Hur viktigt;Status;Roll;Sida;Sökväg;Synpunkt;Lämnad av;Antal svar;Svar");
    expect(csv[1]).toContain(";Fel;Måste ändras;Ny;Huvudcoach;Deltagarkort;/arenden/case-260143?flik=narvaro;Närvaron går inte att spara på mobilen.;Du;1;");

    // Status: Klar – försvinner ur "Inte klara", syns under "Alla".
    const [statusSelect] = within(list).getAllByLabelText("Status").filter((el) => el.id.startsWith("st-"));
    fireEvent.change(statusSelect, { target: { value: "klar" } });
    expect(await within(list).findByText("Visar 0 av 1 synpunkter.")).toBeTruthy();
    expect(rt.store.rows("feedback")[0]).toMatchObject({ status: "klar", statusChangedBy: "tester-karim" });
    fireEvent.change(within(list).getAllByLabelText("Status").find((el) => !el.id.startsWith("st-"))!, { target: { value: "alla" } });
    expect(within(list).getByText("Visar 1 av 1 synpunkter.")).toBeTruthy();

    // Gå till sidan.
    fireEvent.click(within(list).getByRole("button", { name: "Gå till sidan" }));
    expect(push).toHaveBeenCalledWith("/arenden/case-260143?flik=narvaro");
  });

  it("hela Miljonmatch: ingen sida sparas", async () => {
    setup({ isTester: true, environment: "staging", feedback: port });
    fireEvent.click(screen.getByRole("button", { name: "Lämna synpunkt" }));
    const dialog = await screen.findByRole("dialog", { name: "Lämna synpunkt" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hela Miljonmatch" }));
    expect(dialog.textContent).toContain("Huvudcoach · Hela Miljonmatch");
    fireEvent.change(within(dialog).getByLabelText(/Vad tycker du\?/), { target: { value: "Processen för avslut är otydlig." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Spara synpunkt" }));
    expect(await within(dialog).findByText("Tack! Synpunkten är sparad.")).toBeTruthy();
    expect(rt.store.rows("feedback")[0]).toMatchObject({ path: null, viewTitle: null, role: "coach", type: "forbattring", priority: "bor" });
  });
});
