// Utloggad under tiden: tre 401 i rad ger EN sessionshämtning; en inloggad session släpper spärren; 403 och andra fel rör
// den inte. Felet kastas alltid vidare till frågan.
import { describe, expect, it, vi } from "vitest";
import { BackendError, type Backend } from "@/shell/backend";
import { createSessionRefresh } from "./session-refresh";

const failing = (status: number): Backend => ({
  mode: "app",
  query: async () => {
    throw new BackendError(status, status === 401 ? "unauthenticated" : "forbidden", "Fel");
  },
  command: async () => {
    throw new BackendError(status, status === 401 ? "unauthenticated" : "forbidden", "Fel");
  },
});

describe("createSessionRefresh", () => {
  it("tre 401 i rad (frågor och kommandon): sessionen hämtas om en gång, felet kastas vidare varje gång", async () => {
    const reload = vi.fn();
    const r = createSessionRefresh(failing(401), reload);
    r.sessionLoaded(true);
    for (const run of [() => r.backend.query("a", {}), () => r.backend.query("b", {}), () => r.backend.command("c", {})]) {
      const e = await run().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BackendError);
      expect((e as BackendError).status).toBe(401);
    }
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r.pending()).toBe(true);
    // Sessionen laddades som utloggad (inloggningssidan visas): spärren står kvar – en 401 till hämtar inte om igen.
    r.sessionLoaded(false);
    await r.backend.query("d", {}).catch(() => undefined);
    expect(reload).toHaveBeenCalledTimes(1);
    // En inloggad session släpper spärren: nästa 401 hämtar om igen.
    r.sessionLoaded(true);
    expect(r.pending()).toBe(false);
    await r.backend.query("e", {}).catch(() => undefined);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("403 och andra fel hämtar inte sessionen om", async () => {
    const reload = vi.fn();
    const r = createSessionRefresh(failing(403), reload);
    await r.backend.query("a", {}).catch(() => undefined);
    const plain: Backend = { mode: "app", query: async () => Promise.reject(new Error("nät")), command: async () => null };
    const r2 = createSessionRefresh(plain, reload);
    await r2.backend.query("a", {}).catch(() => undefined);
    expect(reload).not.toHaveBeenCalled();
    expect(r.pending()).toBe(false);
  });

  it("lyckade svar går igenom oförändrade, med keepalive-valet", async () => {
    const command = vi.fn(async () => ({ ok: true }));
    const inner: Backend = { mode: "app", query: async () => 1, command };
    const r = createSessionRefresh(inner, vi.fn());
    expect(await r.backend.query("a", {})).toBe(1);
    expect(await r.backend.command("b", { x: 1 }, { keepalive: true })).toEqual({ ok: true });
    expect(command).toHaveBeenCalledWith("b", { x: 1 }, { keepalive: true });
    expect(r.backend.mode).toBe("app");
  });
});

describe("orsaken till utloggningen (granskning 2026-10-03)", () => {
  const with401 = (reason: string | null): Backend => ({
    mode: "app",
    query: async () => {
      throw new BackendError(401, "unauthenticated", "Du har loggats ut.", reason);
    },
    command: async () => {
      throw new BackendError(401, "unauthenticated", "Du har loggats ut.", reason);
    },
  });
  it("401 med reason idle/max bevaras tills en inloggad session laddats; utan reason blir det 'session'", async () => {
    for (const [reason, expected] of [["idle", "idle"], ["max", "max"], [null, "session"], ["annat", "session"]] as const) {
      const r = createSessionRefresh(with401(reason), vi.fn());
      expect(r.loggedOut()).toBeNull();
      await r.backend.query("a", {}).catch(() => undefined);
      expect(r.loggedOut()).toBe(expected);
      r.sessionLoaded(false);
      expect(r.loggedOut()).toBe(expected);
      r.sessionLoaded(true);
      expect(r.loggedOut()).toBeNull();
    }
  });
});
