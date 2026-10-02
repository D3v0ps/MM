// Skriptet före hydreringen: Tillbaka/framåt till en post från ett tidigare dokument laddar om sidan i stället för att Next
// visar fel sida. Poster från det här dokumentet (och poster utan nyckel) lämnas åt Next.
import { describe, expect, it, vi } from "vitest";
import { OWN_KEYS_GLOBAL, POP_GUARD_SCRIPT } from "./pop-guard";

function run(own: Set<string> | undefined) {
  let listener: ((e: unknown) => void) | null = null;
  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === "popstate") listener = fn;
    },
    location: { reload: vi.fn() },
  };
  if (own) win[OWN_KEYS_GLOBAL] = own;
  new Function("window", POP_GUARD_SCRIPT)(win);
  const pop = (state: unknown) => {
    const e = { state, stopImmediatePropagation: vi.fn() };
    listener!(e);
    return { stopped: e.stopImmediatePropagation.mock.calls.length > 0, reloaded: (win.location as { reload: ReturnType<typeof vi.fn> }).reload.mock.calls.length > 0 };
  };
  return { pop, hasListener: () => listener !== null };
}

describe("POP_GUARD_SCRIPT", () => {
  it("lägger en popstate-lyssnare", () => {
    expect(run(new Set()).hasListener()).toBe(true);
  });
  it("post från ett tidigare dokument: stoppar Nexts lyssnare och laddar om", () => {
    const { pop } = run(new Set(["egen"]));
    expect(pop({ mmKey: "gammal", __NA: true })).toEqual({ stopped: true, reloaded: true });
  });
  it("post från det här dokumentet: Next sköter den (inget serveranrop)", () => {
    const { pop } = run(new Set(["egen"]));
    expect(pop({ mmKey: "egen", __NA: true })).toEqual({ stopped: false, reloaded: false });
  });
  it("post utan nyckel (t.ex. en #-länk) och appen som inte har laddat klart: ingenting", () => {
    expect(run(new Set(["egen"])).pop(null)).toEqual({ stopped: false, reloaded: false });
    expect(run(new Set(["egen"])).pop({ __NA: true })).toEqual({ stopped: false, reloaded: false });
    expect(run(undefined).pop({ mmKey: "gammal" })).toEqual({ stopped: false, reloaded: false });
  });
});
