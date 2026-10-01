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
import { feedbackPortOf, type FeedbackPort, type FeedbackView } from "./api";
import { FeedbackToolbar } from "./panel";

afterEach(cleanup);

const SEED = seedData();
const ROUTES: RouteDef[] = [
  { path: "/arenden/:caseId", title: "Deltagarkort", roles: ["coach"], area: "mb", screen: () => null },
  { path: "/portal/deltagare/:caseId", title: "Deltagare", roles: ["kommun_handlaggare"], area: "portal", screen: () => null },
];
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
    expect(csv[0]).toBe("Tid;Testdatum;Typ;Hur viktigt;Status;Roll;Sida;Sökväg;Synpunkt;Lämnad av;Antal svar;Svar");
    // Hela namnet i filen (den delas med andra) – aldrig "Du".
    expect(csv[1]).toContain(";Fel;Måste ändras;Ny;Huvudcoach;Deltagarkort;/arenden/case-260143?flik=narvaro;Närvaron går inte att spara på mobilen.;Karim Khalil;1;");
    expect(csv[1]).toMatch(/;"?Karim Khalil \(2027-02-01 \d{2}:\d{2}\): Vi tar det på mötet\."?$/);
    expect(String(files[0].content)).not.toMatch(/;Du;|Du \(/);

    // Status: valet i listan sparar ingenting (piltangenterna ger ett change-event per steg) – först "Spara status".
    const [statusSelect] = within(list).getAllByLabelText("Status").filter((el) => el.id.startsWith("st-"));
    expect(within(list).queryByRole("button", { name: "Spara status" })).toBeNull();
    for (const step of ["diskutera", "andras", "klar"]) fireEvent.change(statusSelect, { target: { value: step } });
    expect(rt.store.rows("feedback")[0]).toMatchObject({ status: "ny" });
    expect(rt.store.rows("audit_log").filter((x) => x.action === "feedback.status_changed")).toHaveLength(0);
    // Klar – försvinner ur "Inte klara", syns under "Alla". En rad i revisionsloggen.
    fireEvent.click(within(list).getByRole("button", { name: "Spara status" }));
    expect(await within(list).findByText("Visar 0 av 1 synpunkter.")).toBeTruthy();
    expect(rt.store.rows("audit_log").filter((x) => x.action === "feedback.status_changed").map((x) => x.details)).toEqual([{ from: "ny", to: "klar" }]);
    expect(rt.store.rows("feedback")[0]).toMatchObject({ status: "klar", statusChangedBy: "tester-karim" });
    fireEvent.change(within(list).getAllByLabelText("Status").find((el) => !el.id.startsWith("st-"))!, { target: { value: "alla" } });
    expect(within(list).getByText("Visar 1 av 1 synpunkter.")).toBeTruthy();

    // Gå till sidan.
    expect((within(list).getByLabelText("Status", { selector: "select[id^=st-]" }) as HTMLSelectElement).value).toBe("klar");
    expect(within(list).queryByRole("button", { name: "Spara status" })).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Gå till sidan" }));
    expect(push).toHaveBeenCalledWith("/arenden/case-260143?flik=narvaro");
  });

  it("Gå till sidan: bara egna sökvägar som testpersonen får öppna – annars vilken roll som behövs", async () => {
    // Ali lämnade en synpunkt som kommunens handläggare; en rad har en sökväg till en annan webbplats (skriven förbi
    // hanteraren). Karim agerar som coach.
    const ali = { ...listPersonas(rt.raw()).find((p) => p.actor.userId === "k-maria")!.actor, testerId: "tester-ali" };
    const aliPort = feedbackPortOf({ query: (k, p) => rt.run("query", k, p, ali), command: (k, p) => rt.run("command", k, p, ali) });
    expect(await aliPort.submit({ type: "fraga", priority: "kan", text: "Var ser jag beställningen?", path: "/portal/deltagare/case-260143", viewTitle: "Deltagare" })).toMatchObject({ ok: true });
    rt.store.insertRow("feedback", {
      id: "fb-evil", type: "fel", priority: "bor", text: "Länk till en annan webbplats", status: "ny", role: "coach", path: "//evil.example/logga-in", viewTitle: "Deltagarkort",
      createdAt: "2027-02-01T09:30", authorId: "tester-ali", statusChangedAt: null, statusChangedBy: null, submittedAt: null,
    });
    const { push } = setup({ isTester: true, environment: "staging", feedback: port });
    fireEvent.click(screen.getByRole("button", { name: "Alla synpunkter" }));
    const list = await screen.findByRole("dialog", { name: "Alla synpunkter" });
    const kommun = (await within(list).findByText("Var ser jag beställningen?")).closest("article")!;
    expect(within(kommun).queryByRole("button", { name: "Gå till sidan" })).toBeNull();
    expect(kommun.textContent).toContain("Synpunkten lämnades som kommunens handläggare. Välj en sådan testperson under Agera som för att öppna sidan.");
    expect(kommun.textContent).toContain("Ali Khalil · ");
    const evil = within(list).getByText("Länk till en annan webbplats").closest("article")!;
    expect(within(evil).queryByRole("button", { name: "Gå till sidan" })).toBeNull();
    expect(evil.textContent).not.toContain("Välj en sådan testperson");
    expect(push).not.toHaveBeenCalled();
  });

  it("Gå till sidan litar inte på svaret från servern: '//värd/…' blir aldrig en knapp", async () => {
    const view = (id: string, path: string): FeedbackView => ({
      id, type: "fel", priority: "bor", text: `Text ${id}`, status: "ny", role: "coach", roleLabel: "Huvudcoach", perspective: "leverantor", perspectiveLabel: "Leverantör",
      path, viewTitle: "Deltagarkort", createdAt: "2027-02-01T09:30", submittedAt: null, authorName: "Ali Khalil", mine: false, replies: [],
    });
    const stub: FeedbackPort = { ...port, list: async () => [view("fb-a", "//evil.example/logga-in"), view("fb-b", "/\\evil.example"), view("fb-c", "/arenden/case-1")] };
    const { push } = setup({ isTester: true, environment: "staging", feedback: stub });
    fireEvent.click(screen.getByRole("button", { name: "Alla synpunkter" }));
    const list = await screen.findByRole("dialog", { name: "Alla synpunkter" });
    await within(list).findByText("Text fb-a");
    expect(within(list).getAllByRole("button", { name: "Gå till sidan" })).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: "Gå till sidan" }));
    expect(push).toHaveBeenCalledWith("/arenden/case-1");
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
