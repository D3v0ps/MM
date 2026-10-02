// Tester för pulsmätningen via engångslänk (prototypens puls.svar och pulse.submit, prototyp/tools/test-admin.mjs):
// svaret sparas med coachen, länken förbrukas, "Ja" på fråga 5 blir en uppgift till samordnaren och lågt betyg på
// fråga 3 går till chefen – aldrig till coachen.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/server";
import { alerts } from "@/core/alerts";
import { domainEnv } from "@/core/env";
import { TABLE_NAMES, type Db } from "@/data/schema";
import { testRuntime } from "../admin/test-runtime";
import { pulseTokenHash } from "./handlers";
import { pulseLink, pulseSubmit } from "./api";

let rt: ReturnType<typeof testRuntime>;
beforeEach(() => {
  rt = testRuntime();
});
const deltagare = () => rt.as("deltagare", "deltagare");
const answers = { q1: 4, q2: 3, q3: 2, q4: "praktik", q5: "ja" };
const dbNow = () => Object.fromEntries(TABLE_NAMES.map((n) => [n, rt.rows(n)])) as unknown as Db;

describe("pulslänkens token utan Web Crypto", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("samma hash med och utan Web Crypto – länken fungerar även på en sida utan https (som röstlänken)", async () => {
    const token = "pulstoken-abc12345";
    const hash = createHash("sha256").update(token, "utf8").digest("hex");
    expect(await pulseTokenHash(token)).toBe(hash);
    const inv = rt.rows("pulse_invites").find((x) => x.id === "pi-demo")!;
    rt.store.insertRow("pulse_invites", { ...inv, id: "pi-token", tokenHash: hash, usedAt: null });
    vi.stubGlobal("crypto", {});
    expect(globalThis.crypto?.subtle).toBeUndefined();
    expect(await pulseTokenHash(token)).toBe(hash);
    expect(await rt.query(pulseLink, { token }, deltagare())).toEqual({ state: "open", language: "sv", days: 7, location: "Alby" });
    expect((await rt.query(pulseLink, { token: "pulstoken-fel12345" }, deltagare())).state).toBe("missing");
  });
});

describe("pulsmätningen", () => {
  it("exempellänken är öppen, gäller i 7 dagar och har svenska som språk", async () => {
    expect(await rt.query(pulseLink, {}, deltagare())).toEqual({ state: "open", language: "sv", days: 7, location: "Alby" });
    // En länk med okänd token fungerar inte – utan att avslöja något
    expect((await rt.query(pulseLink, { token: "abcdefgh12345678" }, deltagare())).state).toBe("missing");
    expect((await rt.query(pulseLink, { token: "x" }, deltagare())).state).toBe("missing");
  });

  it("alla frågor måste besvaras", async () => {
    const r = await rt.command(pulseSubmit, { language: "sv", answers: { ...answers, q4: null }, text: "" }, deltagare());
    expect(r).toMatchObject({ ok: false, error: "incomplete" });
    expect(await rt.command(pulseSubmit, { language: "sv", answers: { ...answers, q1: 6 }, text: "" }, deltagare())).toMatchObject({ ok: false, error: "incomplete" });
  });

  it("svaret sparas, länken förbrukas och rätt roller får flaggorna", async () => {
    const n = rt.rows("pulse_responses").length;
    const r = await rt.command(pulseSubmit, { language: "ar", answers, text: "Jag vill prata om min praktik." }, deltagare());
    expect(r).toEqual({ ok: true });
    const resp = rt.rows("pulse_responses").at(-1)!;
    expect(rt.rows("pulse_responses")).toHaveLength(n + 1);
    expect(resp).toMatchObject({
      inviteId: "pi-demo", caseId: "case-260143", coachId: "u-amira", language: "ar", occasion: "periodic", contactRequested: true, submittedAt: "2027-02-01T09:13",
      answers: { q1: 4, q2: 3, q3: 2, q4: "praktik", q5: "ja" }, text: "Jag vill prata om min praktik.",
    });
    expect(rt.rows("pulse_invites").find((x) => x.id === "pi-demo")).toMatchObject({ usedAt: "2027-02-01T09:13", language: "ar" });
    const task = rt.rows("tasks").find((t) => t.kind === "pulse_contact")!;
    expect(task).toMatchObject({ toRole: "samordnare", fromId: "system", caseIds: ["case-260143"], responseId: resp.id, status: "open" });
    expect(task.text).toBe("En deltagare vill bli kontaktad (pulsmätning 1 feb 2027, ärende BOT-26-0143). Avgör vem som tar kontakten.");
    expect(rt.rows("audit_log").at(-1)).toMatchObject({ action: "pulse.submitted", actorId: "deltagare", entity: "pulse_response", entityId: resp.id, details: { caseId: "case-260143", language: "ar", contactRequested: true } });
    // Flaggorna: samordnaren (kontakt) och chefen (lågt betyg på stödet) – inte coachen
    const env = domainEnv(rt.rows("contracts")[0], rt.rows("org_settings")[0].settings, rt.now());
    const mine = (role: "samordnare" | "coach" | "chef", personaId: string) => alerts(dbNow(), { role, personaId }, env).filter((a) => a.key.includes(resp.id));
    expect(mine("samordnare", "u-sara").map((a) => a.kind)).toEqual(["pulse_contact"]);
    expect(mine("coach", "u-amira")).toEqual([]);
    expect(mine("chef", "u-karin").map((a) => a.kind)).toContain("pulse_low");
    // Länken kan bara användas en gång
    expect((await rt.query(pulseLink, {}, deltagare())).state).toBe("used");
    expect(await rt.command(pulseSubmit, { language: "sv", answers: { q1: 5, q2: 5, q3: 5, q4: "jobb", q5: "nej" }, text: "" }, deltagare())).toMatchObject({ ok: false, error: "used" });
  });

  it("länken har gått ut efter sju dagar", async () => {
    const late = testRuntime("2027-02-09T09:00");
    const who = late.as("deltagare", "deltagare");
    expect((await late.query(pulseLink, {}, who)).state).toBe("expired");
    expect(await late.command(pulseSubmit, { language: "sv", answers, text: "" }, who)).toMatchObject({ ok: false, error: "expired" });
  });

  it("bara deltagaren (via länken) – personalen kan inte svara", async () => {
    await expect(rt.command(pulseSubmit, { language: "sv", answers, text: "" }, rt.as("u-amira", "coach"))).rejects.toBeInstanceOf(ApiError);
  });
});
