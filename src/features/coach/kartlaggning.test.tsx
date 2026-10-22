// @vitest-environment jsdom
// Kartläggningen och Byt yrkesområde (granskningen, fjärde rundan): ett osparat utkast i minnet som är äldre än raden på servern
// lyfts till raden när formuläret visas igen (rebaseStaleDraft) – det gamla yrkesområdets spår visas inte som valt och förs
// aldrig över till ärendet, och nästa sparning får inte "ändrats i en annan flik". Hela vägen genom skärmen och hanterarna i
// minnesläget med testdatat (demoklockan 1 februari 2027 kl. 09.12).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { DEMO_START } from "@/data/seed";
import { seedData } from "@/data/supabase/seed-rows";
import { BackendProvider, type Backend } from "@/shell/backend";
import { clearAllDrafts } from "@/shell/guard";
import { NavProvider, type LinkImpl, type Nav } from "@/shell/nav";
import { RuntimeProvider } from "@/shell/runtime";
import { SessionProvider, type Session } from "@/shell/session";
import { DownloadProvider } from "@/ui/download";
import "@/api/handlers";
import { caseChangeArea } from "@/features/arenden/api";
import { KartlaggningScreen } from "./screens/kartlaggning";

afterEach(() => {
  cleanup();
  clearAllDrafts();
});

const SEED = seedData();
const A: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);
const NADIA = "case-260143";
const AMAL = "case-270012";
const WHY = "Kartläggningen visade erfarenhet från bygg och ett tydligt mål att arbeta där.";

let rt: MemoryRuntime;
let actor: Actor;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === "u-amira" && x.actor.role === "coach")!;
  actor = p.actor;
});

function show(caseId: string) {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === "u-amira" && x.actor.role === "coach")!;
  const backend: Backend = {
    mode: "demo",
    query: async (key, params) => JSON.parse(JSON.stringify(await rt.run("query", key, params, actor))),
    command: async (key, params) => JSON.parse(JSON.stringify(await rt.run("command", key, params, actor))),
  };
  const nav: Nav = { path: `/kartlaggning/${caseId}`, query: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), href: (to) => `#${to}` };
  const session: Session = { authenticated: true, actor, user: p.user };
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
  return render(wrap(<KartlaggningScreen params={{ caseId }} query={new URLSearchParams()} />));
}
const ready = () => screen.findByRole("heading", { level: 1, name: "Kartläggning vecka 1" }, { timeout: 8000 });
const trackButtons = () => within(screen.getByRole("group", { name: "Valt yrkesspår" })).getAllByRole("button").map((b) => b.textContent ?? "");
const byt = (caseId: string) => rt.run("command", caseChangeArea.key, { caseId, toArea: caseId === NADIA ? "C" : "G", motivation: WHY }, actor);

describe("kartläggningen efter Byt yrkesområde", () => {
  it("en godkänd kartläggning ändrad men inte sparad: tillbaka efter bytet visar coachens text men inte det gamla spåret, och Spara ändringar för inte över något spår", async () => {
    show(NADIA);
    await ready();
    expect(trackButtons()).toContain("Truckförare A+B");
    fireEvent.change(document.getElementById("ia-adapt") as HTMLTextAreaElement, { target: { value: "Behöver instruktioner i skrift" } });
    cleanup();
    // Coachen går till deltagarkortet och byter yrkesområde utan spår (det väljs i kartläggningen).
    expect(await byt(NADIA)).toMatchObject({ ok: true });
    show(NADIA);
    await ready();
    await screen.findByText("Ditt osparade utkast är återställt");
    expect((document.getElementById("ia-adapt") as HTMLTextAreaElement).value).toBe("Behöver instruktioner i skrift");
    // C har ett eget spår – G-spåret är inte valt och finns inte bland valen.
    expect(trackButtons()).not.toContain("Truckförare A+B");
    fireEvent.click(screen.getByRole("button", { name: "Spara ändringar" }));
    await waitFor(() => expect(rt.raw().all("intake_assessments").find((x) => x.caseId === NADIA)?.adaptations).toBe("Behöver instruktioner i skrift"));
    expect(rt.raw().get("cases", NADIA)).toMatchObject({ primaryAreaCode: "C", vocationalTrack: "" });
  });

  it("en kartläggning i utkast som sparats automatiskt: tillbaka efter bytet sparas nästa ändring utan falsk konflikt", async () => {
    show(AMAL);
    await ready();
    // Coachen väljer spåret i L – utkastet sparas automatiskt (versionen i minnet).
    fireEvent.click(within(screen.getByRole("group", { name: "Valt yrkesspår" })).getByRole("button", { name: "Individuellt spår" }));
    await waitFor(() => expect(rt.raw().all("intake_assessments").find((x) => x.caseId === AMAL)?.chosenTrack).toBe("Individuellt spår"), { timeout: 8000 });
    cleanup();
    expect(await byt(AMAL)).toMatchObject({ ok: true });
    expect(rt.raw().all("intake_assessments").find((x) => x.caseId === AMAL)?.chosenTrack).toBe("");
    show(AMAL);
    await ready();
    expect(trackButtons()).not.toContain("Individuellt spår");
    fireEvent.change(document.getElementById("ia-work") as HTMLTextAreaElement, { target: { value: "Två år på lager i Alby." } });
    await waitFor(() => expect(rt.raw().all("intake_assessments").find((x) => x.caseId === AMAL)?.workExperience).toBe("Två år på lager i Alby."), { timeout: 8000 });
    expect(screen.queryByText(/ändrats i en annan flik/)).toBeNull();
    expect(rt.raw().get("cases", AMAL)).toMatchObject({ primaryAreaCode: "G", vocationalTrack: "" });
  });
});
