// Sessionsregler (SPEC §4): 60 minuters inaktivitet, högst 12 timmar; testarens rättigheter; publika sidor; återhopp.
import { describe, expect, it } from "vitest";
import {
  canImpersonate,
  effectiveLoginAt,
  isPublicPagePath,
  lastSeenFromCookie,
  loginPathFor,
  loginTimeFromClaims,
  parseMs,
  safeReturnPath,
  sessionIdFromClaims,
  sessionVerdict,
  signLastSeen,
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

  it("återhopp: tabb, radbrytning, vagnretur och bakstreck leder aldrig till en annan domän", () => {
    // Webbläsaren tar bort \t \n \r och läser \ som / – "/\t/evil.example" blir annars "//evil.example".
    for (const v of ["/\t/evil.example/logga-in", "/\n/evil.example/x", "/\r/evil.example/y", "/\\/evil.example", "/\t\\evil.example", "\t//evil.example"]) {
      expect(new URL(v, "https://test.miljonmatch.se/").origin === "https://test.miljonmatch.se", v).toBe(false); // utan kontrollen: annan domän
      expect(safeReturnPath(v), v).toBeNull();
    }
    // Ett kodat %09 som inte avkodats är bara en konstig men egen sökväg.
    expect(new URL(safeReturnPath("/%09/evil.example")!, "https://test.miljonmatch.se/").origin).toBe("https://test.miljonmatch.se");
    const decoded = new URLSearchParams("till=/%09/evil.example/logga-in&b=/%0A/evil.example&c=/%0D/evil.example&d=/%5C/evil.example");
    for (const k of ["till", "b", "c", "d"]) expect(safeReturnPath(decoded.get(k)), k).toBeNull();
    // Sökvägen tolkas som webbläsaren gör: /./api/ är fortfarande API:t.
    expect(safeReturnPath("/./api/rpc")).toBeNull();
    expect(safeReturnPath("/arenden/../logga-in")).toBeNull();
    expect(safeReturnPath("/portal/rapporter?manad=2027-01#r1")).toBe("/portal/rapporter?manad=2027-01#r1");
  });
});

describe("mm_last_seen är signerad", () => {
  const SECRET = "hemlig-nyckel";
  it("ett värde som servern signerat för sessionen godtas", async () => {
    const v = await signLastSeen(SECRET, "sess-1", T0);
    expect(v).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(await lastSeenFromCookie(SECRET, "sess-1", v)).toBe(T0);
  });

  it("en tid som satts i webbläsaren, ett ändrat värde eller en annan session godtas inte (= inaktiv)", async () => {
    const v = await signLastSeen(SECRET, "sess-1", T0);
    const forged = `${T0 + 2 * hour}.${v.split(".")[1]}`;
    expect(await lastSeenFromCookie(SECRET, "sess-1", String(T0 + 2 * hour))).toBeNull();
    expect(await lastSeenFromCookie(SECRET, "sess-1", forged)).toBeNull();
    expect(await lastSeenFromCookie(SECRET, "sess-2", v)).toBeNull();
    expect(await lastSeenFromCookie("annan-nyckel", "sess-1", v)).toBeNull();
    expect(await lastSeenFromCookie(SECRET, "sess-1", undefined)).toBeNull();
    // Utan giltig senaste aktivitet loggas sessionen ut som inaktiv.
    expect(sessionVerdict({ now: T0 + 2 * hour, loginAt: T0, lastSeen: await lastSeenFromCookie(SECRET, "sess-1", forged) })).toBe("idle");
  });

  it("sessionens id tas ur tokenets claims", () => {
    expect(sessionIdFromClaims({ sub: "u1", session_id: "sess-1" })).toBe("sess-1");
    expect(sessionIdFromClaims({ sub: "u1" })).toBe("u1");
    expect(sessionIdFromClaims(null)).toBe("");
  });
});
