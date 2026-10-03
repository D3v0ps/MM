// @vitest-environment jsdom
// Automatisk utkastsparning: sparar 2 s efter den sista ändringen (inte oftare), aldrig två sparningar samtidigt, flush()
// sparar direkt, ingen sparning när inget är ändrat, "invalid" stoppar väntetiden tills nästa ändring, och en ändring under
// en pågående sparning sparas efteråt. Logiken (AutosaveController) körs med låtsasklocka; hooken kopplar den till skärmen.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveStatus } from "@/ui";
import { AutosaveController, newEditSession, useAutosave, type AutosaveOptions, type AutosaveResult } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Deferred = { resolve: (r: AutosaveResult) => void; promise: Promise<AutosaveResult> };
const deferred = (): Deferred => {
  let resolve!: (r: AutosaveResult) => void;
  const promise = new Promise<AutosaveResult>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
const flushPromises = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

function controller(over: Partial<AutosaveOptions> = {}, save = vi.fn(async (): Promise<AutosaveResult> => ({ ok: true, savedAt: "2027-02-01T09:13" }))) {
  const base: AutosaveOptions = { enabled: true, dirty: false, changeKey: "a", save, ...over };
  const c = new AutosaveController(base);
  const states: string[] = [];
  c.listen((s) => states.push(s.state));
  return { c, save, states, opts: base };
}

describe("AutosaveController", () => {
  it("sparar 2 s efter den sista ändringen – inte oftare", async () => {
    const { c, save } = controller();
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    await vi.advanceTimersByTimeAsync(1500);
    c.update({ enabled: true, dirty: true, changeKey: "bc", save });
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.snapshot).toMatchObject({ state: "saved", savedAt: "2027-02-01T09:13" });
    // Inget nytt är ändrat: ingen ny sparning hur länge man än väntar.
    c.update({ enabled: true, dirty: false, changeKey: "bc", save });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("sparar inte när inget är ändrat eller när den är avstängd, och inte samma innehåll två gånger", async () => {
    const { c, save } = controller();
    c.update({ enabled: true, dirty: false, changeKey: "a", save });
    await vi.advanceTimersByTimeAsync(5000);
    c.update({ enabled: false, dirty: true, changeKey: "b", save });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    // Avstängd med osparade ändringar: flush sparar inte och svarar false (vakten frågar – granskning 2026-10-03).
    expect(await c.flush()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    // Sparat innehåll som skärmen ännu kallar "dirty" (baseline inte uppdaterad): sparas inte igen.
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(1);
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    expect(await c.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush() sparar direkt och svarar om allt är sparat; en misslyckad sparning ger false", async () => {
    const save = vi.fn(async (): Promise<AutosaveResult> => ({ ok: false, reason: "failed" }));
    const { c } = controller({}, save);
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    expect(await c.flush()).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.snapshot.state).toBe("failed");
    save.mockResolvedValueOnce({ ok: true, savedAt: "2027-02-01T09:14" });
    expect(await c.flush()).toBe(true);
    expect(c.snapshot).toMatchObject({ state: "saved", savedAt: "2027-02-01T09:14" });
    // Ett fel som kastas räknas som misslyckad sparning – aldrig ett ohanterat undantag.
    save.mockRejectedValueOnce(new Error("nät"));
    c.update({ enabled: true, dirty: true, changeKey: "c", save });
    expect(await c.flush()).toBe(false);
    expect(c.snapshot.state).toBe("failed");
  });

  it("'invalid' stoppar väntetiden tills nästa ändring, och texten visas", async () => {
    const save = vi.fn(async (): Promise<AutosaveResult> => ({ ok: false, reason: "invalid", text: "Sparas inte automatiskt förrän avvikelsen är ifylld" }));
    const { c } = controller({}, save);
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.snapshot).toMatchObject({ state: "invalid", invalidText: "Sparas inte automatiskt förrän avvikelsen är ifylld" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
    // Nästa ändring: nytt försök.
    save.mockResolvedValueOnce({ ok: true, savedAt: "2027-02-01T09:15" });
    c.update({ enabled: true, dirty: true, changeKey: "bc", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(c.snapshot).toMatchObject({ state: "saved", invalidText: null });
  });

  it("aldrig två sparningar samtidigt – en ändring under sparningen sparas efteråt", async () => {
    const d = deferred();
    const save = vi.fn(async (): Promise<AutosaveResult> => d.promise);
    const { c } = controller({}, save);
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.snapshot.state).toBe("saving");
    // Ändring medan det sparas – och en flush mitt i väntar in den pågående.
    c.update({ enabled: true, dirty: true, changeKey: "bc", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true, savedAt: "2027-02-01T09:13" });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot).toMatchObject({ state: "saved" });
    // Den nya ändringen sparas efter en ny väntetid.
    save.mockResolvedValueOnce({ ok: true, savedAt: "2027-02-01T09:14" });
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(c.snapshot).toMatchObject({ savedAt: "2027-02-01T09:14" });
  });

  it("settle() stoppar väntetiden och väntar in en pågående sparning; markSaved visar manuell sparning", async () => {
    const d = deferred();
    const save = vi.fn(async (): Promise<AutosaveResult> => d.promise);
    const { c } = controller({}, save);
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    await vi.advanceTimersByTimeAsync(1000);
    await c.settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    c.update({ enabled: true, dirty: true, changeKey: "bc", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(1);
    let settled = false;
    void c.settle().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    d.resolve({ ok: true, savedAt: "2027-02-01T09:13" });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    c.markSaved("2027-02-01T09:20");
    expect(c.snapshot).toMatchObject({ state: "saved", savedAt: "2027-02-01T09:20" });
    expect(await c.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("innehållet tillbaka till det sparade: 'kan inte sparas' försvinner utan ny sparning", async () => {
    const save = vi.fn(async (): Promise<AutosaveResult> => ({ ok: true, savedAt: "2027-02-01T09:13" }));
    const { c } = controller({}, save);
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(c.snapshot.state).toBe("saved");
    save.mockResolvedValueOnce({ ok: false, reason: "invalid", text: "diagnos" });
    c.update({ enabled: true, dirty: true, changeKey: "b adhd", save });
    await vi.advanceTimersByTimeAsync(2100);
    expect(c.snapshot).toMatchObject({ state: "invalid", invalidText: "diagnos" });
    // Texten tas bort igen: samma innehåll som sparades – statusraden visar "sparat" och inget sparas om.
    c.update({ enabled: true, dirty: false, changeKey: "b", save });
    expect(c.snapshot).toMatchObject({ state: "saved", savedAt: "2027-02-01T09:13", invalidText: null });
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("kopplas skärmen loss och igen startar väntetiden om – inget utkast förloras", async () => {
    const { c, save } = controller();
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    c.listen(null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    c.listen(() => undefined);
    await vi.advanceTimersByTimeAsync(2100);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("hide() sparar det osparade genast med keepalive", async () => {
    const { c, save } = controller();
    c.update({ enabled: true, dirty: true, changeKey: "b", save });
    c.hide();
    expect(save).toHaveBeenCalledWith({ keepalive: true });
    await vi.advanceTimersByTimeAsync(0);
    c.hide();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("newEditSession ger bara små bokstäver och siffror, 12–32 tecken", () => {
    for (let i = 0; i < 20; i++) expect(newEditSession()).toMatch(/^[a-z0-9]{12,32}$/);
  });
});

// ---------------------------------------------------------------- Hooken
function Form({ save, delayMs }: { save: AutosaveOptions["save"]; delayMs?: number }) {
  const [text, setText] = useState("");
  const [baseline, setBaseline] = useState("");
  const a = useAutosave({
    enabled: true,
    dirty: text !== baseline,
    changeKey: text,
    delayMs,
    save: async (o) => {
      const r = await save(o);
      if (r.ok) setBaseline(text);
      return r;
    },
  });
  return (
    <div>
      <label htmlFor="t">Anteckning</label>
      <input id="t" value={text} onChange={(e) => setText(e.target.value)} />
      <AutosaveStatus state={a.state} savedAt={a.savedAt} invalidText={a.invalidText} />
      <button type="button" onClick={() => void a.flush()}>
        Lämna
      </button>
    </div>
  );
}

describe("useAutosave", () => {
  it("visar 'Utkast sparat 09.13' 2 s efter ändringen – diskret, aldrig som toast – också när React kör effekterna två gånger (StrictMode)", async () => {
    const save = vi.fn(async (): Promise<AutosaveResult> => ({ ok: true, savedAt: "2027-02-01T09:13" }));
    render(
      <StrictMode>
        <Form save={save} />
      </StrictMode>,
    );
    const input = screen.getByLabelText("Anteckning") as HTMLInputElement;
    act(() => {
      input.focus();
    });
    act(() => {
      fireEvent.change(input, { target: { value: "Ringde arbetsgivare." } });
    });
    expect(screen.getByRole("status").textContent).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Utkast sparat 09.13");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    // Vakten: Lämna (flush) med allt sparat sparar inte igen.
    await act(async () => {
      screen.getByRole("button", { name: "Lämna" }).click();
    });
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("flush när autosparningen är avstängd (granskning 2026-10-03)", () => {
  it("avstängd med osparade ändringar: false utan att spara (vakten frågar); avstängd utan ändringar: true", async () => {
    const { c, save, opts } = controller({ enabled: false, dirty: true, changeKey: "b" });
    expect(await c.flush()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    c.update({ ...opts, enabled: false, dirty: false });
    expect(await c.flush()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    // Påslagen igen: flush sparar som vanligt.
    c.update({ ...opts, enabled: true, dirty: true, changeKey: "c" });
    expect(await c.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
