// @vitest-environment jsdom
// Osparad inmatning: vakten frågar innan appen byter till en annan sida (inte vid byte av bara query), webbläsaren varnar vid
// omladdning, och utkastminnet visar texten igen när man kommer tillbaka.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmHost } from "@/ui";
import { clearAllDrafts, dropStaleDraft, leaveWithoutAsking, rebaseStaleDraft, useDraft, useUnsavedGuard } from "./guard";
import { cancelLeaveDocument, confirmLeaveDocument, NavProvider, runBeforeNavigate, type LinkImpl, type Nav } from "./nav";
import { SessionProvider, type Session } from "./session";

afterEach(cleanup);
beforeEach(clearAllDrafts);
beforeEach(cancelLeaveDocument);

const A: LinkImpl = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);
function wrap(children: ReactNode, userId = "u-amira") {
  const nav: Nav = { path: "/avstamning/case-1", query: new URLSearchParams(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), href: (to) => to };
  const session: Session = { actor: { userId, role: "coach", contractIds: [] }, user: { id: userId, name: "Test", title: "", email: "", orgName: "" } };
  return (
    <SessionProvider session={session}>
      <NavProvider nav={nav} LinkImpl={A}>
        {children}
        <ConfirmHost />
      </NavProvider>
    </SessionProvider>
  );
}

function Guarded({ dirty }: { dirty: boolean }) {
  useUnsavedGuard(dirty);
  return <p>Formulär</p>;
}

describe("useUnsavedGuard", () => {
  it("utan osparad text navigerar appen direkt", () => {
    render(wrap(<Guarded dirty={false} />));
    expect(runBeforeNavigate("/min-vecka")).toBe(true);
  });
  it("frågar innan en annan sida – Stanna kvar stoppar, Lämna sidan släpper igenom", async () => {
    render(wrap(<Guarded dirty />));
    let p!: true | Promise<boolean>;
    act(() => {
      p = runBeforeNavigate("/min-vecka");
    });
    expect(await screen.findByRole("dialog", { name: "Du har inte sparat" })).toBeTruthy();
    expect(screen.getByText("Det du har skrivit sparas inte om du lämnar sidan.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stanna kvar" }));
    await expect(p).resolves.toBe(false);
    act(() => {
      p = runBeforeNavigate("/min-vecka");
    });
    fireEvent.click(await screen.findByRole("button", { name: "Lämna sidan" }));
    await expect(p).resolves.toBe(true);
  });
  it("byte av bara query på samma sida (flik, filter) frågar inte", async () => {
    render(wrap(<Guarded dirty />));
    await expect(runBeforeNavigate("/avstamning/case-1?flik=x")).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("leaveWithoutAsking: skärmen har redan frågat", async () => {
    render(wrap(<Guarded dirty />));
    let p!: true | Promise<boolean>;
    leaveWithoutAsking(() => {
      p = runBeforeNavigate("/portal");
    });
    await expect(p).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Spärren släpps efter vakterna (setTimeout 0) – vänta in det, så att nästa test frågar som vanligt.
    await new Promise((r) => setTimeout(r, 0));
  });
  it("appen laddar om (byte av testperson): frågar först – också på samma sida – och webbläsaren varnar sedan inte igen", async () => {
    render(wrap(<Guarded dirty />));
    let p!: Promise<boolean>;
    act(() => {
      p = confirmLeaveDocument();
    });
    expect(await screen.findByRole("dialog", { name: "Du har inte sparat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stanna kvar" }));
    await expect(p).resolves.toBe(false);
    // Stannar man kvar varnar webbläsaren som vanligt.
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    act(() => {
      p = confirmLeaveDocument();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Lämna sidan" }));
    await expect(p).resolves.toBe(true);
    const ev2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev2);
    expect(ev2.defaultPrevented, "ingen andra fråga från webbläsaren").toBe(false);
  });
  it("utan osparad text laddar appen om direkt", async () => {
    render(wrap(<Guarded dirty={false} />));
    await expect(confirmLeaveDocument()).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("webbläsaren varnar vid omladdning bara medan det finns osparad text", () => {
    const { rerender } = render(wrap(<Guarded dirty />));
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    rerender(wrap(<Guarded dirty={false} />));
    const ev2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });
});

function Saved({ trySave }: { trySave: () => Promise<boolean> }) {
  useUnsavedGuard(true, undefined, { trySave });
  return <p>Formulär</p>;
}

describe("useUnsavedGuard med trySave (automatisk utkastsparning)", () => {
  it("sparningen lyckas: appen lämnar sidan utan fråga", async () => {
    const trySave = vi.fn(async () => true);
    render(wrap(<Saved trySave={trySave} />));
    await expect(runBeforeNavigate("/min-vecka")).resolves.toBe(true);
    expect(trySave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("sparningen misslyckas (eller går inte): frågan visas som vanligt", async () => {
    const trySave = vi.fn(async () => false);
    render(wrap(<Saved trySave={trySave} />));
    let p!: true | Promise<boolean>;
    act(() => {
      p = runBeforeNavigate("/min-vecka");
    });
    expect(await screen.findByRole("dialog", { name: "Du har inte sparat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stanna kvar" }));
    await expect(p).resolves.toBe(false);
    expect(trySave).toHaveBeenCalledTimes(1);
  });
  it("ett fel i sparningen räknas som misslyckad – frågan visas", async () => {
    const trySave = vi.fn(async () => {
      throw new Error("nät");
    });
    render(wrap(<Saved trySave={trySave} />));
    let p!: true | Promise<boolean>;
    act(() => {
      p = runBeforeNavigate("/min-vecka");
    });
    expect(await screen.findByRole("dialog", { name: "Du har inte sparat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lämna sidan" }));
    await expect(p).resolves.toBe(true);
  });
  it("byte av bara query sparar inte och frågar inte", async () => {
    const trySave = vi.fn(async () => true);
    render(wrap(<Saved trySave={trySave} />));
    await expect(runBeforeNavigate("/avstamning/case-1?flik=x")).resolves.toBe(true);
    expect(trySave).not.toHaveBeenCalled();
  });
});

function Note({ k }: { k: string }) {
  const d = useDraft(k, "");
  return (
    <div>
      {d.restored && <p>Ditt osparade utkast är återställt.</p>}
      <label htmlFor="n">Anteckning</label>
      <textarea id="n" value={d.value} onChange={(e) => d.set(e.target.value)} />
      <button type="button" onClick={d.clear}>
        Spara
      </button>
    </div>
  );
}
function Toggle({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOn(!on)}>
        Växla
      </button>
      {on && children}
    </>
  );
}

describe("useDraft", () => {
  it("texten finns kvar när skärmen lämnas och visas igen – med en upplysning", () => {
    render(wrap(<Toggle><Note k="avstamning|case-1" /></Toggle>));
    fireEvent.change(screen.getByLabelText("Anteckning"), { target: { value: "Veckomål: ringa två arbetsgivare." } });
    fireEvent.click(screen.getByRole("button", { name: "Växla" }));
    expect(screen.queryByLabelText("Anteckning")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Växla" }));
    expect((screen.getByLabelText("Anteckning") as HTMLTextAreaElement).value).toBe("Veckomål: ringa två arbetsgivare.");
    expect(screen.getByText("Ditt osparade utkast är återställt.")).toBeTruthy();
  });
  it("rensas när det sparats, och gäller bara samma användare och nyckel", async () => {
    render(wrap(<Toggle><Note k="avstamning|case-1" /></Toggle>));
    fireEvent.change(screen.getByLabelText("Anteckning"), { target: { value: "Text" } });
    fireEvent.click(screen.getByRole("button", { name: "Spara" }));
    fireEvent.click(screen.getByRole("button", { name: "Växla" }));
    fireEvent.click(screen.getByRole("button", { name: "Växla" }));
    await waitFor(() => expect((screen.getByLabelText("Anteckning") as HTMLTextAreaElement).value).toBe(""));
    cleanup();
    render(wrap(<Note k="avstamning|case-2" />));
    fireEvent.change(screen.getByLabelText("Anteckning"), { target: { value: "Ärende 2" } });
    cleanup();
    render(wrap(<Note k="avstamning|case-2" />, "u-erik"));
    expect((screen.getByLabelText("Anteckning") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("dropStaleDraft (minnet äldre än raden på servern)", () => {
  const fake = (entries: Record<string, unknown>) => {
    const m = new Map(Object.entries(entries));
    return { m, memory: { peek: (k: string) => ({ has: m.has(k), value: m.get(k) }), drop: (keys: readonly string[]) => keys.forEach((k) => m.delete(k)) } };
  };
  const o = (serverVersion: number | null) => ({ fields: [["f|a", "server-a"], ["f|b", 1]] as const, saved: "f|sparat", version: "f|version", others: ["f|tid"], serverVersion });

  it("äldre version utan osparade ändringar: minnet glöms (serverns värden och version gäller)", () => {
    const { m, memory } = fake({ "f|a": "mitt", "f|sparat": JSON.stringify(["mitt", 1]), "f|version": 3, "f|tid": "09.00" });
    expect(dropStaleDraft(memory, o(4))).toBe(true);
    expect([...m.keys()]).toEqual([]);
  });

  it("osparade ändringar, samma version eller inget versionsminne: minnet ligger kvar", () => {
    const dirty = fake({ "f|a": "ändrat", "f|sparat": JSON.stringify(["mitt", 1]), "f|version": 3 });
    expect(dropStaleDraft(dirty.memory, o(4))).toBe(false);
    expect(dirty.m.size).toBe(3);
    const same = fake({ "f|a": "mitt", "f|sparat": JSON.stringify(["mitt", 1]), "f|version": 4 });
    expect(dropStaleDraft(same.memory, o(4))).toBe(false);
    expect(dropStaleDraft(fake({ "f|a": "mitt" }).memory, o(4))).toBe(false);
    expect(dropStaleDraft(fake({ "f|version": 1 }).memory, o(null))).toBe(false);
    // Ett sparat läge som inte går att läsa: minnet ligger kvar.
    expect(dropStaleDraft(fake({ "f|a": "mitt", "f|sparat": "{trasigt", "f|version": 3 }).memory, o(4))).toBe(false);
  });

  it("servern ändrade ett fält som inte finns i minnet (t.ex. sammanfattningen när närvaron rättades): ingen osparad ändring – minnet glöms (granskningen, tredje rundan)", () => {
    // Coachen ändrade bara a och autosparade. Sedan skrev servern om b (1 -> 2) och höjde versionen.
    const { m, memory } = fake({ "f|a": "mitt", "f|sparat": JSON.stringify(["mitt", 1]), "f|version": 3, "f|tid": "09.00" });
    const server = { fields: [["f|a", "mitt"], ["f|b", 2]] as const, saved: "f|sparat", version: "f|version", others: ["f|tid"], serverVersion: 4 };
    expect(dropStaleDraft(memory, server)).toBe(true);
    expect([...m.keys()]).toEqual([]);
    // Har coachen också ändrat a efter autosparningen ligger minnet kvar – det är en osparad ändring.
    const dirty = fake({ "f|a": "ändrat igen", "f|sparat": JSON.stringify(["mitt", 1]), "f|version": 3 });
    expect(dropStaleDraft(dirty.memory, server)).toBe(false);
  });
});

describe("rebaseStaleDraft (utkastet lyfts till raden på servern – granskningen, fjärde rundan)", () => {
  const fake = (entries: Record<string, unknown>) => {
    const m = new Map(Object.entries(entries));
    return { m, memory: { peek: (k: string) => ({ has: m.has(k), value: m.get(k) }), put: (k: string, v: unknown) => void m.set(k, v) } };
  };
  const base = { a: "mitt", spar: "Truckförare A+B", c: "" };
  const o = (server: Record<string, unknown>, serverVersion: number | null = 4) => ({ key: "f", saved: "f|sparat", version: "f|version", server, serverVersion });

  it("servern tömde spåret (Byt yrkesområde) och coachen skrev i ett annat fält: spåret blir serverns, coachens text ligger kvar, versionen blir serverns", () => {
    const { m, memory } = fake({ f: { ...base, c: "osparat" }, "f|sparat": JSON.stringify(base), "f|version": 3 });
    const server = { ...base, spar: "" };
    expect(rebaseStaleDraft(memory, o(server))).toBe("rebased");
    expect(m.get("f")).toEqual({ a: "mitt", spar: "", c: "osparat" });
    expect(m.get("f|sparat")).toBe(JSON.stringify(server));
    expect(m.get("f|version")).toBe(4);
  });

  it("ett godkänt formulär som aldrig sparats (fälten utan version i minnet) eller bara versionen i minnet", () => {
    // Utan version i minnet: inget att lyfta – formuläret läser serverns version.
    const noVersion = fake({ f: base, "f|sparat": JSON.stringify(base) });
    expect(rebaseStaleDraft(noVersion.memory, o({ ...base, spar: "" }))).toBe("kept");
    // Bara sparat läge och version (inga fält i minnet): lyfts till serverns.
    const onlyVersion = fake({ "f|sparat": JSON.stringify(base), "f|version": 3 });
    expect(rebaseStaleDraft(onlyVersion.memory, o({ ...base, spar: "" }))).toBe("rebased");
    expect([...onlyVersion.m.keys()].sort()).toEqual(["f|sparat", "f|version"]);
    expect(onlyVersion.m.get("f|version")).toBe(4);
  });

  it("samma fält ändrat både av coachen och servern, ett sparat läge som inte går att läsa, samma version eller ingen rad: minnet ligger kvar", () => {
    const both = fake({ f: { ...base, spar: "Lagerarbetare – plock och pack" }, "f|sparat": JSON.stringify(base), "f|version": 3 });
    expect(rebaseStaleDraft(both.memory, o({ ...base, spar: "" }))).toBe("kept");
    expect(both.m.get("f")).toEqual({ ...base, spar: "Lagerarbetare – plock och pack" });
    expect(both.m.get("f|version")).toBe(3);
    expect(rebaseStaleDraft(fake({ f: base, "f|sparat": "{trasigt", "f|version": 3 }).memory, o({ ...base, spar: "" }))).toBe("kept");
    expect(rebaseStaleDraft(fake({ f: base, "f|sparat": JSON.stringify(base), "f|version": 4 }).memory, o({ ...base, spar: "" }))).toBe("kept");
    expect(rebaseStaleDraft(fake({ f: base, "f|sparat": JSON.stringify(base), "f|version": 3 }).memory, o({ ...base, spar: "" }, null))).toBe("kept");
  });
});
