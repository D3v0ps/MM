// Bonusstegen från coachen till kommunen och ekonomen (Karims beslut 2026-11-04, SPEC §7.17) – genom samma execute() som appen
// och prototypen, mot testdatat i minnet (demoklockan 1 februari 2027 kl. 09.12). Bara påhittade uppgifter.
//   BOT-26-0043 (Erik, Maria)  förslag till bonussteg 3 och 5 från regeln, verifieringens datum saknas
//   BOT-26-0027 (Erik, Maria)  bonussteg 3 och 5 skickade – Maria beslutar
//   BOT-26-0008 (Amira, Maria) bonussteg 2, 3 och 5 godkända, bonussteg 4 som förslag
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { customerSafeConfig } from "@/core/config";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START, decodeTestPnr } from "@/data/seed";
import type { TableName, Tables } from "@/data/schema";
import { base64ToBytes } from "@/core/export/base64";
import { readZip } from "@/core/export/read-zip.test-helper";
import { MemoryRepo } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { minVecka } from "@/features/coach/api";
import { billingExportXlsx, billingMarkManual, ekoBonus, ekoReissue, ekoRun, ekoStart, invoiceSetBuyerRef } from "@/features/ekonomi/api";
import { kommunStart } from "@/features/kommun/api";
import { notifList } from "@/features/notiser/api";
import { navCounts } from "@/features/session/nav-api";
import { TEMPLATES } from "@/server/notify/templates";
import {
  bonusCard, bonusCreate, bonusDecide, bonusPortal, bonusRecordMail, bonusReview, bonusSave, bonusSubmit, bonusUnderlag, bonusWithdraw, type BonusUnderlag,
} from "./api";
import { underlagSections } from "./underlag-text";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
const erik = () => as("u-erik", "coach");
const amira = () => as("u-amira", "coach");
const sara = () => as("u-sara", "samordnare");
const maria = () => as("k-maria", "kommun_handlaggare");
const lars = () => as("u-lars", "ekonom");
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = (def: { key: string }, input: unknown, actor: Actor): Promise<any> => rt.run("command", def.key, input, actor);

const S3 = "bonus-case-260043-3-1";
const S5 = "bonus-case-260043-5-1";
const SENT3 = "bonus-case-260027-3-1";
const SENT5 = "bonus-case-260027-5-1";
const FIELDS = { basis: "", reachedOn: "2026-12-19", verificationKind: "anställningsbevis", verificationOn: "2026-12-17", checklist: {} };

/** Belopp, priser och tak – får aldrig finnas hos coachen eller kommunen. */
const MONEY = /\d[  ]kr(?![a-zåäö])|"(price|priceOre|amountOre|totalOre|capOre|unitPriceOre)"|BOT-BONUS-/i;

describe("coachen: kortet Bonus och granskningen", () => {
  it("kortet visar de fem bonusstegen med läge i text och ikon – inga belopp", async () => {
    const v = await q(bonusCard, { caseId: "case-260008" }, amira());
    if (!v.on) throw new Error("bonus av");
    expect(v.steps.map((s) => [s.step, s.label, s.status, s.statusText])).toEqual([
      [1, "Dokumenterad progression", "none", "Inte aktuellt än"], [2, "Stark progression", "approved", "Godkänt av kommunen"],
      [3, "Arbete eller studier", "approved", "Godkänt av kommunen"], [4, "Hållbart resultat", "suggested", "Förslag att granska"],
      [5, "Snabbt resultat", "approved", "Godkänt av kommunen"],
    ]);
    expect(v.steps.every((s) => !!s.icon)).toBe(true);
    expect(v.canAct).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(MONEY);
    // Ekonomen arbetar inte i ärendet: kortet finns inte för ekonomen (inte bland läsarna).
    await expect(q(bonusCard, { caseId: "case-260008" }, lars())).rejects.toBeInstanceOf(ApiError);
  });

  it("granskningen säger vad som saknas; personnummer i texten stoppas; skicka fryser underlaget och mejlar handläggaren", async () => {
    const r = await q(bonusReview, { claimId: S3 }, erik());
    expect(r).toMatchObject({ step: 3, status: "suggested", canAct: true, needsVerification: true });
    expect(r!.problems).toEqual(["Fyll i verifieringens datum."]);
    expect(JSON.stringify(r)).not.toMatch(MONEY);
    // Personnummer i kommentaren stoppas på servern.
    expect(await cmd(bonusSave, { claimId: S3, ...FIELDS, basis: "Gäller 19900101-1234" }, erik())).toMatchObject({ ok: false, error: "pnr" });
    // Utan datum går det inte att skicka.
    expect(await cmd(bonusSubmit, { claimId: S3, ...FIELDS, verificationOn: null }, erik())).toMatchObject({ ok: false, error: "problems" });
    expect(rt.raw().get("bonus_claims", S3)!.status).toBe("suggested");

    const before = rows("outbound_messages").length;
    expect(await cmd(bonusSubmit, { claimId: S3, ...FIELDS, basis: "Tillsvidareanställning som lagerarbetare." }, erik())).toMatchObject({ ok: true });
    const k = rt.raw().get("bonus_claims", S3)!;
    expect(k).toMatchObject({ status: "submitted", submittedBy: "u-erik", verificationOn: "2026-12-17", amountOre: null });
    expect(k.snapshot).toMatchObject({ v: 1, caseNumber: "BOT-26-0043", step: 3, comment: "Tillsvidareanställning som lagerarbetare." });
    // Mejlet till Maria: bara ärendenumret och portalen – inget namn, inget belopp, inget om vad anspråket gäller.
    const mail = rows("outbound_messages").slice(before);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ channel: "email", template: "bonusansprak", caseId: "case-260043" });
    expect(mail[0].body).toBe("Ett underlag om progression och resultat för ärende BOT-26-0043 väntar på ditt beslut. Logga in i portalen för att läsa underlaget och besluta.");
    const c = rt.raw().get("cases", "case-260043")!;
    const p = rt.raw().get("persons", c.personId)!;
    for (const s of [p.firstName, p.lastName, decodeTestPnr(p.personnummerEnc) ?? "x"]) expect(mail[0].body).not.toContain(s);
    expect(TEMPLATES.bonusansprak.subject).toBe("Underlag om progression och resultat att besluta om – {arendenummer}");
    // Ett skickat anspråk kan inte ändras eller skickas igen.
    expect(await cmd(bonusSave, { claimId: S3, ...FIELDS }, erik())).toMatchObject({ ok: false, error: "locked" });
    expect(rows("audit_log").filter((l) => l.entityId === S3).map((l) => l.action)).toEqual(["bonus_claim.suggested", "bonus_claim.submitted"]);
  });

  it("steg 5 skickas först när steg 3 är skickat", async () => {
    expect(await cmd(bonusSubmit, { claimId: S5, ...FIELDS }, erik())).toMatchObject({ ok: false, error: "problems", message: expect.stringContaining("Skicka steg 3 till kommunen först.") });
    await cmd(bonusSubmit, { claimId: S3, ...FIELDS }, erik());
    expect(await cmd(bonusSubmit, { claimId: S5, ...FIELDS }, erik())).toMatchObject({ ok: true });
  });

  it("återta steg 3: steg 5 som bygger på det återtas också; ett nytt anspråk kan skapas", async () => {
    expect(await cmd(bonusWithdraw, { claimId: S3 }, erik())).toMatchObject({ ok: true, withdrawn: 2 });
    expect([S3, S5].map((id) => rt.raw().get("bonus_claims", id)!.status)).toEqual(["withdrawn", "withdrawn"]);
    const created = await cmd(bonusCreate, { caseId: "case-260043", step: 3 }, erik());
    expect(created).toMatchObject({ ok: true });
    expect(rt.raw().get("bonus_claims", created.claimId)).toMatchObject({ source: "manual", status: "suggested", createdBy: "u-erik", step: 3, kind: "work" });
    expect(await cmd(bonusCreate, { caseId: "case-260043", step: 3 }, erik())).toMatchObject({ ok: false, error: "exists" });
  });

  it("bara den som arbetar i ärendet: ekonomen och kommunen kan inte skapa, ändra eller skicka", async () => {
    for (const who of [lars(), maria()]) {
      await expect(cmd(bonusSubmit, { claimId: S3, ...FIELDS }, who), who.role).rejects.toBeInstanceOf(ApiError);
      await expect(cmd(bonusCreate, { caseId: "case-260043", step: 2 }, who), who.role).rejects.toBeInstanceOf(ApiError);
    }
  });
});

describe("kommunen: Läs och besluta", () => {
  it("kommunen läser bara skickade och beslutade anspråk – aldrig förslag", async () => {
    expect(await q(bonusPortal, { claimId: S3 }, maria())).toBeNull();
    const v = await q(bonusPortal, { claimId: SENT3 }, maria());
    expect(v).toMatchObject({ caseNumber: "BOT-26-0027", step: 3, status: "submitted", canDecide: true });
    expect(JSON.stringify(v)).not.toMatch(MONEY);
    // Steg 5 väntar på steg 3.
    expect(await q(bonusPortal, { claimId: SENT5 }, maria())).toMatchObject({ canDecide: false, waitingForStep3: true });
    expect(await cmd(bonusDecide, { claimId: SENT5, decision: "approved" }, maria())).toMatchObject({ ok: false, error: "needs_step3" });
  });

  it("beslutet registreras en gång, ändrar anspråket och huvudcoachen får en notis utan namn", async () => {
    expect(await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria())).toMatchObject({ ok: true });
    expect(rt.raw().get("bonus_claims", SENT3)).toMatchObject({ status: "approved", customerDecision: "approved", decidedBy: "k-maria", amountOre: null });
    expect(rows("bonus_claim_decisions").filter((d) => d.claimId === SENT3)).toMatchObject([{ decision: "approved", via: "portal", decidedBy: "k-maria", recordedBy: "k-maria" }]);
    const n = rows("user_notifications").filter((x) => x.kind === "bonus_decision");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ recipientId: "u-erik", caseId: "case-260027", channels: ["app"], title: "Kommunen har beslutat om progression och resultat – BOT-26-0027" });
    const c = rt.raw().get("cases", "case-260027")!;
    const p = rt.raw().get("persons", c.personId)!;
    expect(`${n[0].title} ${n[0].body} ${n[0].emailBody}`).not.toContain(p.lastName);
    // En gång: ett andra beslut nekas.
    expect(await cmd(bonusDecide, { claimId: SENT3, decision: "rejected" }, maria())).toMatchObject({ ok: false, error: "decided" });
    // Nu kan steg 5 godkännas.
    expect(await cmd(bonusDecide, { claimId: SENT5, decision: "approved", note: "Bra jobbat." }, maria())).toMatchObject({ ok: true });
  });

  it("Miljonbemanning registrerar ett beslut som kom med mejl: bara samordnare och avtalsansvarig, med anteckning", async () => {
    await expect(cmd(bonusRecordMail, { claimId: SENT3, decision: "approved", note: "Mejl från handläggaren 2 februari." }, erik())).rejects.toBeInstanceOf(ApiError);
    await expect(cmd(bonusRecordMail, { claimId: SENT3, decision: "approved", note: "" }, sara())).rejects.toBeInstanceOf(ApiError);
    expect(await cmd(bonusRecordMail, { claimId: SENT3, decision: "rejected", note: "Mejl från handläggaren 2 februari." }, sara())).toMatchObject({ ok: true });
    expect(rows("bonus_claim_decisions").find((d) => d.claimId === SENT3)).toMatchObject({ via: "mejl", decidedBy: null, recordedBy: "u-sara", decision: "rejected" });
    // På anspråket står den som registrerade beslutet (som triggern mm.apply_bonus_decision skriver).
    expect(rt.raw().get("bonus_claims", SENT3)).toMatchObject({ status: "rejected", customerDecision: "rejected", decidedBy: "u-sara" });
  });

  it("fungerar också med kommunens version av avtalet (utan taket – som contracts_public i produktionen)", async () => {
    const contract = rt.raw().get("contracts", "c-bot")!;
    rt.store.updateRow("contracts", "c-bot", { config: customerSafeConfig(contract.config) });
    expect(await q(bonusPortal, { claimId: SENT3 }, maria())).toMatchObject({ canDecide: true });
    expect(await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria())).toMatchObject({ ok: true });
    expect(await cmd(bonusUnderlag, { claimId: SENT3, purpose: "download" }, maria())).toMatchObject({ ok: true, filename: "redovisningsunderlag-progression-och-resultat-BOT-26-0027-steg3.pdf" });
  });
});

describe("redovisningsunderlaget", () => {
  it("bara godkända uppgifter: inga belopp, ingen nivå, inga taggar, inga gruppaktiviteter eller gruppmål, inga personnummer", async () => {
    await cmd(bonusSubmit, { claimId: S3, ...FIELDS }, erik());
    const u = rt.raw().get("bonus_claims", S3)!.snapshot as unknown as BonusUnderlag;
    const text = JSON.stringify(u) + underlagSections(u, "Deltagaren").map((s) => JSON.stringify(s)).join("");
    expect(text).not.toMatch(MONEY);
    expect(text).not.toMatch(/\b(nivå [1-5]|Nivå [1-5]|tagg|gruppmål|grupp[a-z]*aktivitet)/i);
    expect(text).not.toMatch(/\b\d{6,8}[-+]?\d{4}\b/);
    const groupNames = rows("group_activities").map((g) => g.name).filter((n) => n.length > 4);
    for (const n of groupNames) expect(u.activities.map((a) => a.label)).not.toContain(n);
    const goals = rows("group_activities").map((g) => g.goal).filter((g): g is string => !!g);
    for (const g of goals) expect(text).not.toContain(g);
    const tags = rows("groupings").map((g) => g.name);
    for (const t of tags) expect(u.activities.map((a) => a.label)).not.toContain(t);
    // Visningen och nedladdningen loggas (tyst – räknar inte om något).
    expect(await cmd(bonusUnderlag, { claimId: S3, purpose: "view" }, maria())).toMatchObject({ ok: true });
    expect(rows("audit_log").filter((l) => l.entityId === S3).map((l) => l.action).slice(-1)).toEqual(["bonus_claim.underlag_viewed"]);
  });
});

describe("ekonomen: bonusfakturan", () => {
  it("godkänt i februari blir en rad på februaris bonusfaktura – aldrig på månadens faktura", async () => {
    await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria());
    await cmd(bonusDecide, { claimId: SENT5, decision: "approved" }, maria());
    const v = await q(ekoBonus, { month: "2027-02" }, lars());
    expect(v.on).toBe(true);
    expect(v.invoices).toHaveLength(1);
    const inv = v.invoices[0];
    expect(inv.title).toBe("Bonusfaktura februari 2027");
    expect(inv.lines.map((l) => [l.caseNumber, l.bonusStep, l.articleNo, l.amountOre])).toEqual([["BOT-26-0027", 3, "BOT-BONUS-3", 600000], ["BOT-26-0027", 5, "BOT-BONUS-5", 200000]]);
    const run = await q(ekoRun, { month: "2027-02" }, lars());
    expect(run.invoices.flatMap((x) => x.lines).some((l) => l.articleNo.startsWith("BOT-BONUS") || "bonusStep" in l)).toBe(false);
    // Januari: BOT-26-0008 steg 3 och 5 (steg 2 i december) – 11 000 kr av taket.
    const jan = await q(ekoBonus, { month: "2027-01" }, lars());
    expect(jan.invoices[0].lines.map((l) => [l.bonusStep, l.amountOre])).toEqual([[3, 600000], [5, 200000]]);
    // Bara ekonomen.
    for (const who of [erik(), sara(), maria()]) await expect(q(ekoBonus, {}, who), who.role).rejects.toBeInstanceOf(ApiError);
  });

  it("taket: steg 4 för BOT-26-0008 godkänt blir 1 000 kr (12 000 − 11 000) med en anmärkning", async () => {
    const K4 = "bonus-case-260008-4-1";
    rt.store.updateRow("bonus_claims", K4, {
      status: "approved", verificationKind: "anställningsbevis", verificationOn: "2027-01-20", snapshot: { v: 1 }, submittedAt: "2027-01-25T10:00", submittedBy: "u-amira",
      customerDecision: "approved", decidedBy: "k-maria", decidedAt: "2027-02-01T08:00",
    });
    const v = await q(ekoBonus, { month: "2027-02" }, lars());
    const line = v.invoices[0].lines.find((l) => l.bonusStep === 4)!;
    expect([line.caseNumber, line.amountOre]).toEqual(["BOT-26-0008", 100000]);
    expect(line.checks.map((c) => c.kind)).toContain("bonus_cap");
  });
});

describe("förslagen från regeln (jobbet)", () => {
  it("inget när testdatat lästes in; efter nästa veckogräns skapas förslagen en gång – en andra körning skapar inget", async () => {
    const clock = demoClock(DEMO_START);
    const r = createMemoryRuntime({ data: structuredClone(SEED), clock, reportFloor: DEMO_START });
    const auto = () => r.store.rows("bonus_claims").filter((k) => k.source === "auto" && k.createdAt > DEMO_START);
    await r.run("query", "session.ping", {}, as("u-amira", "coach"));
    expect(auto()).toEqual([]);
    // Minnesläget kör jobbets steg när klockan passerat nästa vecko- eller månadsgräns (som rapportutkasten).
    clock.set("2027-02-08T06:00");
    await r.run("query", "session.ping", {}, as("u-amira", "coach"));
    const first = auto();
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((k) => k.status === "suggested" && k.createdBy === "system" && k.amountOre === null && k.snapshot === null)).toBe(true);
    // Högst ett anspråk som räknas per ärende och steg.
    const active = r.store.rows("bonus_claims").filter((k) => ["suggested", "submitted", "approved"].includes(k.status));
    expect(new Set(active.map((k) => `${k.caseId}:${k.step}`)).size).toBe(active.length);
    // Steg 4 och 5 bygger alltid på ett steg 3 i samma ärende.
    for (const k of first.filter((x) => x.step === 4 || x.step === 5)) expect(r.store.rows("bonus_claims").find((y) => y.id === k.followsClaimId)).toMatchObject({ step: 3, caseId: k.caseId });
    clock.set("2027-02-15T06:00");
    await r.run("query", "session.ping", {}, as("u-amira", "coach"));
    expect(auto()).toHaveLength(first.length);
    expect(r.store.rows("audit_log").filter((l) => l.action === "bonus_claim.suggested" && l.occurredAt > DEMO_START)).toHaveLength(first.length);
  });
});

// ================================================================ Granskningsrunda 1
describe("avslag av bonussteg 3 (A1): steg 4 och 5 som bygger på det står aldrig kvar", () => {
  it("kommunen avslår steg 3: steg 5 återtas i samma steg och loggas – försvinner hos kommunen och hindrar inget nytt anspråk", async () => {
    expect(await cmd(bonusDecide, { claimId: SENT3, decision: "rejected", note: "För få timmar i veckan." }, maria())).toMatchObject({ ok: true });
    expect(rt.raw().get("bonus_claims", SENT5)).toMatchObject({ status: "withdrawn", withdrawnBy: "system", withdrawnAt: expect.any(String) });
    const log = rows("audit_log").filter((l) => l.entityId === SENT5 && l.action === "bonus_claim.withdrawn");
    expect(log).toHaveLength(1);
    expect(log[0].details).toMatchObject({ caseId: "case-260027", step: 5, wasSubmitted: true, reason: "step3_rejected" });
    // Kommunen: inget kvar att besluta om, och anspråket syns inte längre (återtaget).
    const st = await q(kommunStart, {}, maria());
    expect(st.bonus.map((b) => b.claimId)).toEqual([]);
    expect(await q(bonusPortal, { claimId: SENT5 }, maria())).toBeNull();
    // Miljonbemanning kan skapa nya anspråk för steg 3 och 5 (inget räknas längre för stegen).
    expect(await cmd(bonusCreate, { caseId: "case-260027", step: 3 }, erik())).toMatchObject({ ok: true });
    expect(await cmd(bonusCreate, { caseId: "case-260027", step: 5 }, erik())).toMatchObject({ ok: true });
  });

  it("steg 5 som väntar på steg 3 räknas inte i Att göra – det kommer med när steg 3 är godkänt", async () => {
    expect((await q(kommunStart, {}, maria())).bonus.map((b) => [b.claimId, b.canDecide])).toEqual([[SENT3, true]]);
    expect(await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria())).toMatchObject({ ok: true });
    expect((await q(kommunStart, {}, maria())).bonus.map((b) => [b.claimId, b.canDecide])).toEqual([[SENT5, true]]);
  });

  it("ett godkänt steg 3 rör inte steg 5; ett avslag av steg 5 rör inte steg 3", async () => {
    await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria());
    expect(rt.raw().get("bonus_claims", SENT5)?.status).toBe("submitted");
    await cmd(bonusDecide, { claimId: SENT5, decision: "rejected" }, maria());
    expect([SENT3, SENT5].map((id) => rt.raw().get("bonus_claims", id)?.status)).toEqual(["approved", "rejected"]);
  });
});

describe("taket och priserna på bonusfakturan (A2, A3)", () => {
  const K4 = "bonus-case-260008-4-1";
  const approveDirect = (id: string, decidedAt: string) =>
    rt.store.updateRow("bonus_claims", id, {
      status: "approved", verificationKind: "anställningsbevis", verificationOn: "2027-01-20", snapshot: { v: 1, claimId: id, step: rt.raw().get("bonus_claims", id)?.step },
      submittedAt: "2027-01-25T10:00", submittedBy: "u-amira", customerDecision: "approved", decidedBy: "k-maria", decidedAt,
    });

  it("ett anspråk på en skapad faktura räknas med det fakturerade beloppet – en ändrad prislista ger aldrig mer än taket", async () => {
    const jan = (await q(ekoBonus, { month: "2027-01" }, lars())).invoices[0];
    if (!jan.buyerReference) expect(await cmd(invoiceSetBuyerRef, { month: "2027-01", invoiceId: jan.id, reference: "55102938" }, lars())).toMatchObject({ ok: true });
    expect(await cmd(billingMarkManual, { month: "2027-01", invoiceId: jan.id, invoiceNo: "20270199" }, lars())).toMatchObject({ ok: true });
    // Priset för bonussteg 3 ändras efteråt (6 000 → 5 000 kr) och bonussteg 4 godkänns i februari.
    rt.store.updateRow("price_items", "pi-bonus-3", { priceOre: 500000 });
    approveDirect(K4, "2027-02-01T08:00");
    const feb = (await q(ekoBonus, { month: "2027-02" }, lars())).invoices[0];
    const line = feb.lines.find((l) => l.bonusStep === 4)!;
    // 3 000 (december) + 6 000 + 2 000 (januari, fakturerat) = 11 000 kr – 1 000 kr kvar till taket.
    expect(line.amountOre).toBe(100000);
    const frozen = rows("invoice_lines").filter((l) => l.bonusClaimId && l.caseId === "case-260008").reduce((n, l) => n + l.unitPriceOre * l.quantity, 0);
    expect(frozen + line.amountOre).toBe(1200000);
  });

  it("ett anspråk utan pris stoppar fakturan – och de senare anspråken i ärendet räknas inte som om det vore 0 kr", async () => {
    rt.store.updateRow("price_items", "pi-bonus-3", { validTo: "2027-01-31" });
    await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria());
    await cmd(bonusDecide, { claimId: SENT5, decision: "approved" }, maria());
    const feb = (await q(ekoBonus, { month: "2027-02" }, lars())).invoices[0];
    expect(feb.blocked).toBe(true);
    expect(feb.lines.map((l) => [l.bonusStep, l.amountOre, l.checks.find((c) => c.kind === "price")?.label])).toEqual([
      [3, 0, "Pris saknas"], [5, 0, "Taket kan inte räknas"],
    ]);
    expect(feb.capped).toEqual([]);
  });

  it("priset 0 kr är ett prisfel som stoppar fakturan – inte \"Taket är nått\"", async () => {
    rt.store.updateRow("price_items", "pi-bonus-3", { priceOre: 0 });
    await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria());
    const feb = (await q(ekoBonus, { month: "2027-02" }, lars())).invoices[0];
    expect(feb.blocked).toBe(true);
    expect(feb.lines.map((l) => [l.bonusStep, l.checks.find((c) => c.kind === "price")?.label])).toEqual([[3, "Pris 0 kr"]]);
    expect(feb.capped).toEqual([]);
  });
});

describe("begränsade testare ser inga bonusnotiser (A4)", () => {
  it("kommunens beslut syns inte i Min vecka, notiserna eller menyns siffra för en begränsad testare – men för Karim", async () => {
    await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, maria());
    const t = (testerId: string) => ({ ...erik(), testerId });
    const limited = t("tester-sara");
    const full = t("tester-karim");
    const kinds = async (a: Actor) => ({
      week: (await q(minVecka, {}, a)).unread.items.map((n) => n.kind),
      list: (await q(notifList, {}, a)).items.map((n) => n.kind),
      count: (await q(navCounts, {}, a)).notifications,
    });
    const l = await kinds(limited);
    const k = await kinds(full);
    expect(k.list).toContain("bonus_decision");
    expect(k.week).toContain("bonus_decision");
    expect(l.list).not.toContain("bonus_decision");
    expect(l.week).not.toContain("bonus_decision");
    expect(l.count).toBe(k.count - 1);
  });
});

describe("en returnerad bonusfaktura görs om (A5)", () => {
  it("står bland de returnerade på Fakturering och krediteras och görs om med samma bonussteg", async () => {
    const DEC = "inv-c-bot-2026-12-bonus";
    rt.store.updateRow("invoice_drafts", DEC, { status: "returned" });
    const st = await q(ekoStart, {}, lars());
    const r = st.returned.find((x) => x.invoiceId === DEC)!;
    expect(r).toMatchObject({ bonus: true, title: "Bonusfaktura december 2026", lines: 1 });
    const res = await cmd(ekoReissue, { month: "2026-12", invoiceId: DEC }, lars());
    expect(res).toMatchObject({ ok: true, reissued: true });
    const dec = await q(ekoBonus, { month: "2026-12" }, lars());
    // Samma faktura med en kreditfaktura och en ny skapelse (som månadens faktura) – samma bonussteg och belopp.
    const again = dec.invoices.find((i) => i.id === DEC)!;
    expect(again).toMatchObject({ status: "fortnox_created", created: true });
    expect(again.lines.map((l) => [l.caseNumber, l.bonusStep, l.amountOre])).toEqual([["BOT-26-0008", 2, 300000]]);
    expect(rows("invoice_credits").filter((c) => c.invoiceDraftId === DEC)).toHaveLength(1);
  });
});

describe("resultatdatum och förhandsvisningen (A6, A7)", () => {
  it("steg 4 och 5 har inget eget resultatdatum: ett datum från klienten ignoreras och underlaget visar steg 3:s", async () => {
    const before = rt.raw().get("bonus_claims", S5)!.reachedOn;
    expect(await cmd(bonusSave, { claimId: S5, ...FIELDS, reachedOn: "2020-01-01" }, erik())).toMatchObject({ ok: true });
    expect(rt.raw().get("bonus_claims", S5)!.reachedOn).toBe(before);
    // Steg 3:s resultatdatum ändras – steg 5:s underlag följer det levande datumet.
    await cmd(bonusSave, { claimId: S3, ...FIELDS, reachedOn: "2026-12-20" }, erik());
    const r = await q(bonusReview, { claimId: S5 }, erik());
    expect(r!.underlag.reachedOn).toBe("2026-12-20");
  });

  it("förhandsvisningen av ett anspråk som inte är skickat är ett utkast – inget \"Skickat … av …\"", async () => {
    const r = await q(bonusReview, { claimId: S3 }, erik());
    expect(r!.underlag).toMatchObject({ draft: true, sentByName: null });
    const text = JSON.stringify(underlagSections(r!.underlag, "Deltagaren"));
    expect(text).toContain("Utkast – inte skickat");
    expect(text).not.toContain("Skickat");
    const dl = await cmd(bonusUnderlag, { claimId: S3, purpose: "download" }, erik());
    expect(dl).toMatchObject({ ok: true, filename: "redovisningsunderlag-progression-och-resultat-BOT-26-0043-steg3-utkast.pdf", underlag: { draft: true } });
    // Skickat: underlaget har den som skickade och inget utkast.
    await cmd(bonusSubmit, { claimId: S3, ...FIELDS }, erik());
    const sent = rt.raw().get("bonus_claims", S3)!.snapshot as unknown as BonusUnderlag;
    expect(sent).toMatchObject({ draft: false, sentByName: "Erik Sjöberg" });
    expect(JSON.stringify(underlagSections(sent, "Deltagaren"))).toContain("Skickat");
  });
});

describe("bara handläggaren som beställde beslutar (D3)", () => {
  it("med vidare synlighet ser en annan handläggare anspråket men kan inte besluta", async () => {
    const contract = rt.raw().get("contracts", "c-bot")!;
    const cfg = contract.config as { customerVisibility: Record<string, unknown> };
    rt.store.updateRow("contracts", "c-bot", { config: { ...contract.config, customerVisibility: { ...cfg.customerVisibility, scope: "all" } } as never });
    const other = listPersonas(rt.raw()).find((p) => p.actor.role === "kommun_handlaggare" && p.actor.userId !== "k-maria")!.actor;
    const v = await q(bonusPortal, { claimId: SENT3 }, other);
    expect(v).toMatchObject({ status: "submitted", canDecide: false });
    expect(await cmd(bonusDecide, { claimId: SENT3, decision: "approved" }, other)).toMatchObject({ ok: false, error: "not_found" });
    expect((await q(kommunStart, {}, other)).bonus).toEqual([]);
    expect(rt.raw().get("bonus_claims", SENT3)?.status).toBe("submitted");
  });
});

describe("ekonomen läser anspråken utan innehållet (D7)", () => {
  it("minnet speglar bonus_claims_public, och ekonomens frågor och export lämnar aldrig ut innehållet", async () => {
    const SECRET = "HEMLIGT-UNDERLAG";
    for (const k of rows("bonus_claims")) rt.store.updateRow("bonus_claims", k.id, { basis: SECRET, decisionNote: k.decidedAt ? SECRET : null, verificationKind: k.verificationKind ? SECRET : null });
    const repo = new MemoryRepo<Tables>(rt.store, lars(), POLICIES);
    const k = (await repo.table("bonus_claims").get("bonus-case-260008-3-1"))!;
    expect({ basis: k.basis, snapshot: k.snapshot, checklist: k.checklist, verificationKind: k.verificationKind, decisionNote: k.decisionNote })
      .toEqual({ basis: "", snapshot: null, checklist: {}, verificationKind: null, decisionNote: null });
    expect(k).toMatchObject({ step: 3, status: "approved", decidedAt: expect.any(String) });
    // Den som arbetar i ärendet läser innehållet.
    expect((await new MemoryRepo<Tables>(rt.store, amira(), POLICIES).table("bonus_claims").get("bonus-case-260008-3-1"))!.basis).toBe(SECRET);
    // Ekonomen läser inte kommunens beslut alls.
    expect(await repo.table("bonus_claim_decisions").list()).toEqual([]);
    const out = JSON.stringify([
      await q(ekoStart, {}, lars()), await q(ekoBonus, { month: "2027-01" }, lars()), await q(ekoBonus, { month: "2026-12" }, lars()), await q(ekoRun, { month: "2027-01" }, lars()),
    ]);
    expect(out).not.toContain(SECRET);
    expect(out).not.toMatch(/"snapshot"|"basis"|"checklist"|"decisionNote"/);
    const x = await cmd(billingExportXlsx, { month: "2027-01" }, lars());
    const zip = await readZip(base64ToBytes(x.content));
    expect(zip.map((e) => new TextDecoder().decode(e.data)).join("\n")).not.toContain(SECRET);
  });
});
