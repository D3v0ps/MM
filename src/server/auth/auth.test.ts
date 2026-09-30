// Inloggningens regler utan nätverk: adresser, tillåtna domäner, spärrlistan i testmiljön och hastighetsbegränsningen.
import { describe, expect, it } from "vitest";
import { allowedByList, AUTH_TEXT, domainAllowed, isValidEmail, normalizeEmail } from "./email";
import { checkCodeRequest, checkVerify, clientIp, hashesFor, LIMITS, type AttemptKind, type AttemptStore } from "./rate-limit";

describe("e-postadresser", () => {
  it("normaliseras och kontrolleras", () => {
    expect(normalizeEmail("  Maria.Ekdahl@Botkyrka.SE ")).toBe("maria.ekdahl@botkyrka.se");
    expect(isValidEmail("maria.ekdahl@botkyrka.se")).toBe(true);
    expect(isValidEmail("maria.ekdahl@botkyrka")).toBe(false);
    expect(isValidEmail("maria ekdahl@botkyrka.se")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("spärrlistan i testmiljön: hela adresser eller @domän, tom lista = ingen", () => {
    const list = ["karim.khalil@miljonbemanning.se", "ali.khalil@miljonbemanning.se"];
    expect(allowedByList("Karim.Khalil@miljonbemanning.se", list)).toBe(true);
    expect(allowedByList("sara.lindqvist@miljonbemanning.se", list)).toBe(false);
    expect(allowedByList("maria.ekdahl@botkyrka.se", list)).toBe(false);
    expect(allowedByList("x@test.miljonbemanning.se", ["@test.miljonbemanning.se"])).toBe(true);
    expect(allowedByList("x@miljonbemanning.se", ["@test.miljonbemanning.se"])).toBe(false);
    expect(allowedByList("karim.khalil@miljonbemanning.se", [])).toBe(false);
  });

  it("tillåtna domäner per organisation (kunden i databasen, Miljonbemanning från miljövariabeln)", () => {
    const botkyrka = { kind: "customer", emailDomains: ["botkyrka.se"] };
    const mb = { kind: "supplier", emailDomains: [] };
    const staff = ["miljonbemanning.se"];
    expect(domainAllowed("maria.ekdahl@botkyrka.se", botkyrka, staff)).toBe(true);
    expect(domainAllowed("maria.ekdahl@gmail.com", botkyrka, staff)).toBe(false);
    expect(domainAllowed("maria.ekdahl@sub.botkyrka.se", botkyrka, staff)).toBe(false);
    expect(domainAllowed("sara.lindqvist@miljonbemanning.se", mb, staff)).toBe(true);
    expect(domainAllowed("sara.lindqvist@botkyrka.se", mb, staff)).toBe(false);
    expect(domainAllowed("x@kammarkollegiet.se", { kind: "customer", emailDomains: [] }, staff)).toBe(false);
    expect(domainAllowed("x@botkyrka.se", null, staff)).toBe(false);
  });

  it("svaret på 'skicka kod' avslöjar inte om adressen finns", () => {
    expect(AUTH_TEXT.codeSent).toMatch(/^Om adressen finns hos oss/);
  });
});

/** Fejkad login_attempts i minnet. */
function memoryAttempts() {
  const rows: { kind: AttemptKind; at: string; emailHash: string; ipHash: string }[] = [];
  const store: AttemptStore = {
    count: async (q) => rows.filter((r) => r.kind === q.kind && r.at >= q.since && (!q.emailHash || r.emailHash === q.emailHash) && (!q.ipHash || r.ipHash === q.ipHash)).length,
    lastAt: async (q) => {
      const hit = rows.filter((r) => r.kind === q.kind && r.emailHash === q.emailHash).map((r) => Date.parse(r.at));
      return hit.length ? Math.max(...hit) : null;
    },
    record: async (a) => {
      rows.push(a);
    },
  };
  return { rows, store };
}

const T0 = Date.UTC(2026, 8, 30, 8, 0);
const at = (ms: number) => new Date(ms).toISOString();

describe("hastighetsbegränsning", () => {
  it("hashar adress och IP – aldrig klartext", () => {
    const h = hashesFor("hemlig", "maria.ekdahl@botkyrka.se", "203.0.113.7");
    expect(h.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(h)).not.toContain("botkyrka");
    expect(JSON.stringify(h)).not.toContain("203.0.113");
    expect(hashesFor("annan", "maria.ekdahl@botkyrka.se", "203.0.113.7").emailHash).not.toBe(h.emailHash);
  });

  it("IP-adressen tas från x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("");
  });

  it("högst 5 koder per adress och 20 per IP under 15 minuter", async () => {
    const { store } = memoryAttempts();
    const h = hashesFor("k", "a@botkyrka.se", "1.1.1.1");
    for (let i = 0; i < LIMITS.codesPerEmail; i++) {
      expect(await checkCodeRequest(store, h, T0 + i * 60_000)).toBe("ok");
      await store.record({ kind: "code", at: at(T0 + i * 60_000), ...h });
    }
    expect(await checkCodeRequest(store, h, T0 + 5 * 60_000)).toBe("rate_limited");
    // Efter fönstret går det igen.
    expect(await checkCodeRequest(store, h, T0 + 20 * 60_000)).toBe("ok");
    // Samma IP, många adresser.
    const ip = memoryAttempts();
    for (let i = 0; i < LIMITS.codesPerIp; i++) await ip.store.record({ kind: "code", at: at(T0), ...hashesFor("k", `x${i}@botkyrka.se`, "2.2.2.2") });
    expect(await checkCodeRequest(ip.store, hashesFor("k", "ny@botkyrka.se", "2.2.2.2"), T0 + 60_000)).toBe("rate_limited");
    expect(await checkCodeRequest(ip.store, hashesFor("k", "ny@botkyrka.se", "3.3.3.3"), T0 + 60_000)).toBe("ok");
  });

  it("högst 5 felaktiga försök per kod – en ny kod ger 5 nya försök", async () => {
    const { store } = memoryAttempts();
    const h = hashesFor("k", "a@botkyrka.se", "1.1.1.1");
    await store.record({ kind: "code", at: at(T0), ...h });
    for (let i = 0; i < LIMITS.attemptsPerCode; i++) {
      expect(await checkVerify(store, h, T0 + (i + 1) * 1000)).toBe("ok");
      await store.record({ kind: "verify_failed", at: at(T0 + (i + 1) * 1000), ...h });
    }
    expect(await checkVerify(store, h, T0 + 10_000)).toBe("too_many_attempts");
    await store.record({ kind: "code", at: at(T0 + 60_000), ...h });
    expect(await checkVerify(store, h, T0 + 61_000)).toBe("ok");
  });

  it("många fel från samma IP stoppas", async () => {
    const { store } = memoryAttempts();
    for (let i = 0; i < LIMITS.failedPerIp; i++) await store.record({ kind: "verify_failed", at: at(T0), ...hashesFor("k", `x${i}@botkyrka.se`, "9.9.9.9") });
    expect(await checkVerify(store, hashesFor("k", "ny@botkyrka.se", "9.9.9.9"), T0 + 1000)).toBe("rate_limited");
  });
});
