// @vitest-environment jsdom
// Kommunens avtalsansvarig på avtalssidan (Karims beslut 2026-11-27): raden i Avtalsfakta, Ändra med tre fält (Namn, Telefon,
// E-post) och läsläget. Hela vägen genom skärmen och hanterarna i minnesläget med testdatat. Påhittade uppgifter.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/api/roles";
import { listPersonas, type Persona } from "@/data/actors";
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
import type { ContractView } from "../api";
import { AvtalScreen } from "./avtal";

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
const ROW = "Kommunens avtalsansvarig";

let rt: MemoryRuntime;
let robin: Persona;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
  robin = listPersonas(rt.raw()).find((x) => x.actor.userId === "u-robin" && x.actor.role === "admin")!;
});

/** viewer = den som syns i sessionen. readOnly: avtalssidans svar utan rätten att ändra (som för en annan roll än admin). */
function show(viewer: Persona = robin, opts: { readOnly?: boolean } = {}) {
  const actor: Actor = robin.actor;
  const backend: Backend = {
    mode: "demo",
    query: async (key, params) => {
      const r = JSON.parse(JSON.stringify(await rt.run("query", key, params, actor)));
      if (opts.readOnly && key === "admin.contract") (r as ContractView).contract.canEditCustomerContact = false;
      return r;
    },
    command: async (key, params) => JSON.parse(JSON.stringify(await rt.run("command", key, params, actor))),
  };
  const nav: Nav = { path: "/admin/avtal", query: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), href: (to) => `#${to}` };
  const session: Session = { authenticated: true, actor: viewer.actor, user: viewer.user };
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
  return render(wrap(<AvtalScreen params={{}} query={new URLSearchParams()} />));
}

/** Raden i Avtalsfakta (dt + dd). */
async function row() {
  const dt = await screen.findByText(ROW, { selector: "dt" }, { timeout: 8000 });
  return dt.parentElement as HTMLElement;
}
const contactOf = () => rt.raw().get("contracts", "c-bot")?.config.customerContact ?? null;

describe("avtalssidan: kommunens avtalsansvarig", () => {
  it("raden står efter Intagsansvarig; Ändra öppnar Namn, Telefon och E-post utan hjälptexter; sparat visas som markerbar text", async () => {
    show();
    const r = await row();
    expect(within(r).getByRole("definition").textContent).toMatch(/^–/);
    // Ordningen i Avtalsfakta: Intagsansvarig – kommunens avtalsansvarig – Omfattning.
    const labels = Array.from(document.querySelectorAll("dt")).map((d) => d.textContent);
    expect(labels.indexOf(ROW)).toBe(labels.indexOf("Intagsansvarig – tar emot nya deltagare") + 1);
    expect(labels[labels.indexOf(ROW) + 1]).toBe("Omfattning");

    fireEvent.click(within(r).getByRole("button", { name: "Ändra kommunens avtalsansvarig" }));
    const name = within(r).getByLabelText("Namn") as HTMLInputElement;
    const phone = within(r).getByLabelText("Telefon") as HTMLInputElement;
    const email = within(r).getByLabelText("E-post") as HTMLInputElement;
    expect([name.value, phone.value, email.value]).toEqual(["", "", ""]);
    // Bara etiketter (Karims designregel): inga hjälptexter, inga förklaringar.
    expect(r.querySelectorAll("[id$='-help']")).toHaveLength(0);
    expect(within(r).queryByRole("status")).toBeNull();
    expect(Array.from(r.querySelectorAll("label")).map((l) => l.textContent)).toEqual(["Namn", "Telefon", "E-post"]);

    // Fel per fält – ingenting sparas.
    fireEvent.change(name, { target: { value: "Testa Testsson" } });
    fireEvent.change(phone, { target: { value: "070-000" } });
    fireEvent.change(email, { target: { value: "testa.testsson@exempel.se" } });
    fireEvent.click(within(r).getByRole("button", { name: "Spara" }));
    expect(await within(r).findByText("Skriv ett svenskt telefonnummer, till exempel 070-123 45 67.")).toBeTruthy();
    expect(contactOf()).toBeNull();

    fireEvent.change(phone, { target: { value: "0700000000" } });
    fireEvent.click(within(r).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(within(r).queryByLabelText("Namn")).toBeNull(), { timeout: 8000 });
    expect(contactOf()).toEqual({ name: "Testa Testsson", phone: "+46700000000", email: "testa.testsson@exempel.se" });
    const after = await row();
    await waitFor(() => expect(within(after).getByRole("definition").textContent).toContain("070-000 00 00"), { timeout: 8000 });
    const dd = within(after).getByRole("definition");
    expect(dd.textContent).toContain("Testa Testsson");
    expect(dd.textContent).toContain("testa.testsson@exempel.se");
    // Markerbar text – aldrig tel:- eller mailto:-länkar.
    expect(dd.querySelectorAll("a")).toHaveLength(0);
    expect(document.querySelector("a[href^='tel:'], a[href^='mailto:']")).toBeNull();
    expect(within(dd).getByText("070-000 00 00").className).toContain("select-all");
    expect(within(dd).getByText("testa.testsson@exempel.se").className).toContain("select-all");
  });

  it("Ändra med de sparade uppgifterna: tre tomma fält tar bort kontaktpersonen", async () => {
    await rt.run("command", "admin.setCustomerContact", { contractId: "c-bot", name: "Testa Testsson", phone: "070-000 00 00", email: "testa.testsson@exempel.se" }, robin.actor);
    show();
    const r = await row();
    await waitFor(() => expect(within(r).getByRole("definition").textContent).toContain("Testa Testsson"), { timeout: 8000 });
    fireEvent.click(within(r).getByRole("button", { name: "Ändra kommunens avtalsansvarig" }));
    const fields = ["Namn", "Telefon", "E-post"].map((l) => within(r).getByLabelText(l) as HTMLInputElement);
    expect(fields.map((f) => f.value)).toEqual(["Testa Testsson", "070-000 00 00", "testa.testsson@exempel.se"]);
    for (const f of fields) fireEvent.change(f, { target: { value: "" } });
    fireEvent.click(within(r).getByRole("button", { name: "Spara" }));
    await waitFor(() => expect(contactOf()).toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(within(r).getByRole("definition").textContent).toMatch(/^–/), { timeout: 8000 });
  });

  it("läsläge: utan rätten att ändra visas uppgifterna men ingen Ändra-knapp", async () => {
    await rt.run("command", "admin.setCustomerContact", { contractId: "c-bot", name: "Testa Testsson", phone: "070-000 00 00", email: "testa.testsson@exempel.se" }, robin.actor);
    const johan = listPersonas(rt.raw()).find((x) => x.actor.userId === "u-johan" && x.actor.role === "avtalsansvarig")!;
    show(johan, { readOnly: true });
    const r = await row();
    await waitFor(() => expect(within(r).getByRole("definition").textContent).toContain("070-000 00 00"), { timeout: 8000 });
    expect(within(r).getByRole("definition").textContent).toContain("Testa Testsson");
    expect(within(r).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ändra kommunens avtalsansvarig" })).toBeNull();
  });
});
