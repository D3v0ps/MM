// Sessionsregler (SPEC §4): 60 minuters inaktivitet, högst 12 timmar; testarens rättigheter; publika sidor; återhopp.
import { describe, expect, it } from "vitest";
import {
  canImpersonate,
  effectiveLoginAt,
  isPublicPagePath,
  loginPathFor,
  loginTimeFromClaims,
  parseMs,
  safeReturnPath,
  sessionVerdict,
  toEnvironment,
} from "./session-policy";

const T0 = Date.UTC(2026, 8, 30, 8, 0);
const min = 60_000;
const hour = 60 * min;

describe("sessionVerdict", () => {
  it("aktiv session inom gränserna", () => {
    expect(sessionVerdict({ now: T0 + 30 * min, loginAt: T0, lastSeen: T0 + 5 * min })).toBe("ok");
    // Exakt 60 minuter utan aktivitet är fortfarande ok – en minut till loggar ut.
    expect(sessionVerdict({ now: T0 + 60 * min, loginAt: T0, lastSeen: T0 })).toBe("ok");
  });

  it("utloggning efter 60 minuters inaktivitet", () => {
    expect(sessionVerdict({ now: T0 + 61 * min, loginAt: T0, lastSeen: T0 })).toBe("idle");
    expect(sessionVerdict({ now: T0 + 3 * hour, loginAt: T0, lastSeen: T0 + 1 * hour + 59 * min })).toBe("idle");
  });

  it("utloggning senast 12 timmar efter inloggningen, även om användaren är aktiv", () => {
    expect(sessionVerdict({ now: T0 + 12 * hour, loginAt: T0, lastSeen: T0 + 12 * hour - min })).toBe("ok");
    expect(sessionVerdict({ now: T0 + 12 * hour + min, loginAt: T0, lastSeen: T0 + 12 * hour })).toBe("max");
  });

  it("saknade tider räknas som utgången session", () => {
    expect(sessionVerdict({ now: T0, loginAt: null, lastSeen: T0 })).toBe("max");
    expect(sessionVerdict({ now: T0, loginAt: T0, lastSeen: null })).toBe("idle");
  });
});

describe("kakor och tokenets inloggningstid", () => {
  it("parseMs godtar bara millisekunder", () => {
    expect(parseMs(String(T0))).toBe(T0);
    expect(parseMs("abc")).toBeNull();
    expect(parseMs("")).toBeNull();
    expect(parseMs(undefined)).toBeNull();
    expect(parseMs("12")).toBeNull();
  });

  it("inloggningstiden tas från amr (tidigaste), annars kakan", () => {
    const claims = { sub: "x", amr: [{ method: "otp", timestamp: T0 / 1000 + 60 }, { method: "otp", timestamp: T0 / 1000 }] };
    expect(loginTimeFromClaims(claims)).toBe(T0);
    expect(loginTimeFromClaims({ amr: "x" })).toBeNull();
    expect(loginTimeFromClaims(null)).toBeNull();
    // Kakan kan inte flytta fram inloggningstiden när tokenet har den.
    expect(effectiveLoginAt(claims, String(T0 + 5 * hour))).toBe(T0);
    expect(effectiveLoginAt({ sub: "x" }, String(T0 + 5 * hour))).toBe(T0 + 5 * hour);
    expect(effectiveLoginAt({ sub: "x" }, undefined)).toBeNull();
  });
});

describe("testarens rättigheter", () => {
  it("bara testare, och bara i testmiljön", () => {
    expect(canImpersonate("staging", true)).toBe(true);
    expect(canImpersonate("staging", false)).toBe(false);
    expect(canImpersonate("production", true)).toBe(false);
    expect(canImpersonate("memory", true)).toBe(false);
  });

  it("miljön: bara 'staging' är testmiljö – allt annat, även en saknad rad, är produktion", () => {
    expect(toEnvironment("staging")).toBe("staging");
    expect(toEnvironment("production")).toBe("production");
    expect(toEnvironment(null)).toBe("production");
    expect(toEnvironment("Staging")).toBe("production");
  });
});

describe("sökvägar", () => {
  it("publika sidor: inloggningen och pulslänken", () => {
    for (const p of ["/logga-in", "/portal/logga-in", "/puls", "/puls/abc123"]) expect(isPublicPagePath(p), p).toBe(true);
    for (const p of ["/", "/start", "/portal", "/portal/deltagare/case-1", "/arenden", "/logga-in-x", "/pulsx"]) expect(isPublicPagePath(p), p).toBe(false);
  });

  it("rätt inloggningssida", () => {
    expect(loginPathFor("/portal/rapporter")).toBe("/portal/logga-in");
    expect(loginPathFor("/arenden/case-1")).toBe("/logga-in");
  });

  it("återhopp bara till egna sidor", () => {
    expect(safeReturnPath("/arenden/case-1?flik=narvaro")).toBe("/arenden/case-1?flik=narvaro");
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("/api/rpc")).toBeNull();
    expect(safeReturnPath("/logga-in")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});
