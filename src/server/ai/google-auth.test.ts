// Inloggningen mot Google Cloud (JWT-bearer, RS256) med fejkad fetch och en nyckel som skapas i testet – inga riktiga anrop.
import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AiProviderError } from "./errors";
import { createTokenSource, GOOGLE_SCOPE, GOOGLE_TOKEN_URL, parseServiceAccountKey, signServiceAccountJwt, type FetchLike } from "./google-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const TEST_KEY_JSON = {
  type: "service_account",
  project_id: "miljonmatch-test",
  private_key_id: "abc123",
  private_key: pem,
  client_email: "miljonmatch-ai@miljonmatch-test.iam.gserviceaccount.com",
  token_uri: "https://evil.example/token",
};
const b64 = Buffer.from(JSON.stringify(TEST_KEY_JSON)).toString("base64");

describe("parseServiceAccountKey", () => {
  it("base64 och JSON-text godtas; allt annat stoppas utan att innehållet visas", () => {
    const k = parseServiceAccountKey(b64);
    expect(k).toMatchObject({ clientEmail: TEST_KEY_JSON.client_email, privateKeyId: "abc123", projectId: "miljonmatch-test" });
    expect(parseServiceAccountKey(JSON.stringify(TEST_KEY_JSON)).clientEmail).toBe(TEST_KEY_JSON.client_email);
    for (const bad of ["", "inte-base64-json", Buffer.from(JSON.stringify({ ...TEST_KEY_JSON, type: "authorized_user" })).toString("base64")]) {
      const e = (() => {
        try {
          parseServiceAccountKey(bad);
        } catch (x) {
          return x as AiProviderError;
        }
      })();
      expect(e).toBeInstanceOf(AiProviderError);
      expect(e?.code).toBe("config");
      expect(`${e?.message} ${e?.detail}`).not.toContain("PRIVATE");
    }
  });
});

describe("signServiceAccountJwt", () => {
  it("RS256 med tjänstekontot som utfärdare, Googles tokenadress som mottagare och scope cloud-platform – verifierbar med den publika nyckeln", () => {
    const jwt = signServiceAccountJwt(parseServiceAccountKey(b64), 1_800_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT", kid: "abc123" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({
      iss: TEST_KEY_JSON.client_email, sub: TEST_KEY_JSON.client_email, aud: GOOGLE_TOKEN_URL, scope: GOOGLE_SCOPE, iat: 1_800_000_000, exp: 1_800_003_600,
    });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("createTokenSource", () => {
  it("byter JWT mot token hos Googles fasta adress (aldrig nyckelfilens token_uri), cachar och förnyar fem minuter före utgången", async () => {
    let now = 1_800_000_000_000;
    const calls: { url: string; body: string }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200, json: async () => ({ access_token: `tok-${calls.length}`, expires_in: 3600, token_type: "Bearer" }) };
    };
    const src = createTokenSource({ key: parseServiceAccountKey(b64), fetch, nowMs: () => now });
    expect(await src.token()).toBe("tok-1");
    expect(calls[0].url).toBe(GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);
    now += 3600_000 - 301_000;
    expect(await src.token()).toBe("tok-1");
    now += 2_000;
    expect(await src.token()).toBe("tok-2");
    src.invalidate();
    expect(await src.token()).toBe("tok-3");
    // Samtidiga anrop delar på ett utbyte
    src.invalidate();
    const [a, b] = await Promise.all([src.token(), src.token()]);
    expect([a, b]).toEqual(["tok-4", "tok-4"]);
  });

  it("fel nyckel (400) är ett inställningsfel; 503 och nätverksfel är tillfälliga", async () => {
    const key = parseServiceAccountKey(b64);
    const status = (s: number): FetchLike => async () => ({ ok: false, status: s, json: async () => ({ error: "invalid_grant", error_description: "secret" }) });
    await expect(createTokenSource({ key, fetch: status(400) }).token()).rejects.toMatchObject({ code: "config", retryable: false });
    await expect(createTokenSource({ key, fetch: status(503) }).token()).rejects.toMatchObject({ code: "unavailable", retryable: true });
    await expect(createTokenSource({ key, fetch: async () => { throw new Error("ECONNRESET"); } }).token()).rejects.toMatchObject({ code: "unavailable", retryable: true });
  });
});
