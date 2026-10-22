// Byt yrkesområde (Karims beslut 2026-10-22): kommandot arenden.bytYrkesomrade och raden på deltagarkortet mot testdatat i
// minnet (MemoryRuntime, samma hanterare som appen). Ordningen: anteckningen, bytet, ärendets yrkesområde, revisionsloggen och
// sist afterCaseAreaChanged – grupp och inbjudningar följer direkt (syncAudienceInvites, yrkesområdet är deltagarens grupp).
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { billingLines } from "@/core/billing";
import { requireOperational } from "@/core/config";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { SYSTEM_ACTOR } from "@/api/roles";
import { monthlyDraftInput } from "@/features/_shared/voice-jobs";
import { assessmentPage, assessmentSave } from "@/features/coach/api";
import { ekoCase } from "@/features/ekonomi/api";
import { caseAreaView, caseChangeArea } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const change = (input: ParamsOf<typeof caseChangeArea>, actor: Actor) => rt.run("command", caseChangeArea.key, input, actor) as Promise<ResultOf<typeof caseChangeArea>>;

const NADIA = "case-260143";
const amira = () => as("u-amira", "coach");
const erik = () => as("u-erik", "coach");
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const karin = () => as("u-karin", "chef");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");
const WHY = "Kartläggningen visade erfarenhet från bygg och ett tydligt mål att arbeta där.";

describe("Byt yrkesområde (arenden.bytYrkesomrade)", () => {
  it("huvudcoachen byter: anteckning, byte, ärendets yrkesområde, revisionslogg – fakturan från månaden efter", async () => {
    const before = rt.raw().get("cases", NADIA)!;
    expect(before.primaryAreaCode).toBe("G");
    const res = await change({ caseId: NADIA, toArea: "C", motivation: `  ${WHY}  ` }, amira());
    expect(res).toMatchObject({ ok: true, effectiveMonth: "2027-03" });
    if (!res.ok) return;
    const raw = rt.raw();
    expect(raw.get("cases", NADIA)?.primaryAreaCode).toBe("C");
    const note = raw.get("case_notes", res.noteId)!;
    expect(note).toMatchObject({ caseId: NADIA, authorId: "u-amira", kind: "other", audience: "team" });
    expect(note.body).toBe(`Byte av yrkesområde: G Lager och logistik → C Bygg och anläggning. ${WHY}`);
    expect(raw.get("case_area_changes", res.changeId)).toMatchObject({
      contractId: "c-bot", caseId: NADIA, fromArea: "G", toArea: "C", effectiveMonth: "2027-03", changedBy: "u-amira", noteId: res.noteId,
    });
    const log = raw.all("audit_log").filter((l) => l.action === "case.area_changed");
    expect(log).toHaveLength(1);
    expect(log[0].details).toEqual({ caseId: NADIA, fromArea: "G", toArea: "C", effectiveMonth: "2027-03", changeId: res.changeId, noteId: res.noteId, seq: 1 });
    // Revisionsloggen har aldrig motiveringen.
    expect(JSON.stringify(raw.all("audit_log"))).not.toContain("Kartläggningen visade");
  });

  it("samordnare, avtalsansvarig och en annan coach i avtalet får byta – chef, admin och ekonom nekas av rollkontrollen", async () => {
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY }, erik())).toMatchObject({ ok: true });
    expect(await change({ caseId: NADIA, toArea: "E", motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(await change({ caseId: NADIA, toArea: "G", motivation: WHY }, johan())).toMatchObject({ ok: true });
    for (const a of [karin(), robin(), lars()]) await expect(change({ caseId: NADIA, toArea: "C", motivation: WHY }, a), a.role).rejects.toBeInstanceOf(ApiError);
    expect(rt.raw().all("case_area_changes").filter((x) => x.caseId === NADIA).map((x) => [x.fromArea, x.toArea])).toEqual([["G", "C"], ["C", "E"], ["E", "G"]]);
  });

  it("nekas: samma eller okänt yrkesområde, för kort eller för lång motivering, personnummer, avslutat ärende – inget skrivs", async () => {
    const closed = rt.raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot")!;
    const cases: [ParamsOf<typeof caseChangeArea>, string][] = [
      [{ caseId: NADIA, toArea: "G", motivation: WHY }, "same"],
      [{ caseId: NADIA, toArea: "Z", motivation: WHY }, "area"],
      [{ caseId: NADIA, toArea: "C", motivation: "  kort  " }, "motivation"],
      [{ caseId: NADIA, toArea: "C", motivation: "x".repeat(301) }, "motivation"],
      [{ caseId: NADIA, toArea: "C", motivation: "Enligt kommunen gäller 19730216-9545 numera." }, "pnr"],
      [{ caseId: closed.id, toArea: closed.primaryAreaCode === "C" ? "E" : "C", motivation: WHY }, "closed"],
      [{ caseId: "case-finns-inte", toArea: "C", motivation: WHY }, "not_found"],
    ];
    const notes = rt.raw().all("case_notes").length;
    for (const [input, code] of cases) expect(await change(input, amira()), code).toMatchObject({ ok: false, error: code });
    expect(rt.raw().all("case_area_changes")).toHaveLength(1); // bara testdatats byte
    expect(rt.raw().all("case_notes")).toHaveLength(notes);
    expect(rt.raw().get("cases", NADIA)?.primaryAreaCode).toBe("G");
  });

  it("ett alternativt yrkesområde som blir det nya tas bort som alternativ", async () => {
    const c = rt.raw().all("cases").find((x) => x.status === "active" && x.secondaryAreaCode && x.secondaryAreaCode !== x.primaryAreaCode)!;
    const second = c.secondaryAreaCode!;
    expect(await change({ caseId: c.id, toArea: second, motivation: WHY }, sara())).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", c.id)).toMatchObject({ primaryAreaCode: second, secondaryAreaCode: null });
  });

  it("fakturan: bytesmånaden på det gamla yrkesområdet, månaden efter på det nya", async () => {
    const res = await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira());
    expect(res).toMatchObject({ ok: true, effectiveMonth: "2027-03" });
    const raw = rt.raw();
    const cfg = requireOperational(raw.get("contracts", "c-bot")!.config);
    const db = {
      cases: raw.all("cases").filter((c) => c.id === NADIA), activities: [...raw.all("activities")], attendance: [...raw.all("attendance")], price_items: [...raw.all("price_items")],
      billing_week_approvals: [], case_area_changes: [...raw.all("case_area_changes")],
    };
    const [feb] = billingLines(db, "2027-02", { now: "2027-03-20T09:00", cfg });
    expect(feb.areaCode).toBe("G");
    expect(feb.unitPriceOre).toBe(raw.all("price_items").find((p) => p.areaCode === "G")!.priceOre);
  });
});

describe("Byt yrkesområde: grupp och inbjudningar följer direkt (Karims beslut 2026-10-22)", () => {
  // Testdatats yrkesområdesträffar: G den 17 februari, F den 24 februari (vanliga aktiviteter med ett yrkesområde som målgrupp).
  const G_MEETING = "ga-traff-c-bot-g-2027-02";
  const F_MEETING = "ga-traff-c-bot-f-2027-02";
  const rowsOf = (caseId: string) => rt.raw().all("activities").filter((a) => a.caseId === caseId && a.groupActivityId);

  it("deltagaren tas bort ur det gamla yrkesområdets träff och bjuds in till det nyas – loggen har bara id:n, koder och antal", async () => {
    expect(rowsOf(NADIA).filter((a) => a.groupActivityId === G_MEETING)).toEqual([expect.objectContaining({ inviteSource: "audience" })]);
    expect(rowsOf(NADIA).some((a) => a.groupActivityId === F_MEETING)).toBe(false);
    const res = await change({ caseId: NADIA, toArea: "F", motivation: WHY }, amira());
    expect(res).toMatchObject({ ok: true, groups: { invited: 1, removed: 1 } });
    expect(rowsOf(NADIA).some((a) => a.groupActivityId === G_MEETING)).toBe(false);
    expect(rowsOf(NADIA).filter((a) => a.groupActivityId === F_MEETING)).toEqual([expect.objectContaining({ inviteSource: "audience", caseId: NADIA })]);
    const synced = rt.raw().all("audit_log").filter((l) => l.action === "group_activity.audience_synced");
    expect(synced.map((l) => l.entityId).sort()).toEqual([F_MEETING, G_MEETING]);
    const text = JSON.stringify(synced);
    expect(text).not.toContain("Nadia");
    expect(text).not.toContain("Kartläggningen visade");
    // Nivåaktiviteterna följer nivån, inte yrkesområdet – de rörs inte.
    const levelRows = (caseId: string) => rowsOf(caseId).filter((a) => rt.raw().get("group_activities", a.groupActivityId!)?.audience === "level").map((a) => a.id).sort();
    const before = levelRows(NADIA);
    expect(await change({ caseId: NADIA, toArea: "G", motivation: WHY }, amira())).toMatchObject({ ok: true, groups: { invited: 1, removed: 1 } });
    expect(levelRows(NADIA)).toEqual(before);
  });

  it("manuellt inbjudna och rader med närvaro rörs aldrig; meddelandet skickas bara när aktiviteten har det påslaget", async () => {
    const raw = () => rt.raw();
    const gRow = rowsOf(NADIA).find((a) => a.groupActivityId === G_MEETING)!;
    // Inbjuden för hand i stället för av målgruppen (som om coachen bjudit in henne själv).
    rt.store.updateRow("activities", gRow.id, { inviteSource: "manual" });
    const out = raw().all("outbound_messages").length;
    expect(await change({ caseId: NADIA, toArea: "F", motivation: WHY }, amira())).toMatchObject({ ok: true, groups: { invited: 1, removed: 0 } });
    expect(raw().get("activities", gRow.id)).toMatchObject({ caseId: NADIA, inviteSource: "manual" });
    // Träffarna i testdatat har meddelandet av: inga utskick.
    expect(raw().all("outbound_messages")).toHaveLength(out);
  });

  it("motiveringen skickas aldrig till AI: underlaget till månadens AI-utkast har andra anteckningar men inte den", async () => {
    const c = rt.raw().all("cases").find((x) => x.aiConsentStatus === "given" && x.status === "active" && x.contractId === "c-bot" && x.primaryAreaCode)!;
    expect(c).toBeDefined();
    const res = await change({ caseId: c.id, toArea: c.primaryAreaCode === "C" ? "E" : "C", motivation: WHY }, sara());
    if (!res.ok) throw new Error(res.error);
    rt.store.insertRow("case_notes", {
      id: "note-t-vanlig", contractId: c.contractId, caseId: c.id, authorId: "u-sara", occurredOn: "2027-02-01", kind: "conversation", audience: "full",
      body: "Pratade om CV.", createdAt: "2027-02-01T10:00", updatedAt: null, removedAt: null, removedBy: null,
    });
    const input = await monthlyDraftInput(rt.ctxFor(SYSTEM_ACTOR), c.id, "2027-02");
    expect(input.notes.map((n) => n.id)).toContain("note-t-vanlig");
    expect(input.notes.map((n) => n.id)).not.toContain(res.noteId);
    expect(JSON.stringify(input)).not.toContain("Kartläggningen visade");
  });

  it("ett bekräftat ärende som inte har startat byter yrkesområde utan inbjudningar (insatsen pågår inte än)", async () => {
    const confirmed = rt.raw().all("cases").find((c) => c.status === "confirmed" && c.contractId === "c-bot" && c.primaryAreaCode)!;
    expect(confirmed).toBeDefined();
    const to = confirmed.primaryAreaCode === "F" ? "G" : "F";
    const rows = rowsOf(confirmed.id).length;
    expect(await change({ caseId: confirmed.id, toArea: to, motivation: WHY }, sara())).toMatchObject({ ok: true, groups: { invited: 0, removed: 0 } });
    expect(rowsOf(confirmed.id)).toHaveLength(rows);
  });
});

describe("Yrkesområdet på deltagarkortet (arenden.yrkesomrade)", () => {
  it("nuvarande yrkesområde, de andra aktiva att byta till, och bytena – nyast först", async () => {
    const v = (await q(caseAreaView, { caseId: "case-260163" }, amira()))!;
    expect(v.current).toEqual({ code: "D", name: "Kök, restaurang och måltidsservice" });
    expect(v.canChange).toBe(true);
    expect(v.options.map((a) => a.code)).not.toContain("D");
    expect(v.options).toHaveLength(11);
    expect(v.effectiveMonth).toBe("2027-03");
    expect(v.history).toEqual([{ id: "cac-seed-linnea", changedAt: "2027-01-27T14:10", fromArea: "G", toArea: "D", byName: "Amira Haddad", effectiveMonth: "2027-02" }]);
  });

  it("chef och systemadministratör ser raden i läsläge; kommunen och ekonomen får inget", async () => {
    for (const a of [karin(), robin()]) expect(await q(caseAreaView, { caseId: "case-260163" }, a), a.role).toMatchObject({ canChange: false, blockedText: null });
    await expect(q(caseAreaView, { caseId: "case-260163" }, lars())).rejects.toBeInstanceOf(ApiError);
    const kommun = as(rt.raw().get("cases", "case-260163")!.referrerId!, "kommun_handlaggare");
    await expect(q(caseAreaView, { caseId: "case-260163" }, kommun)).rejects.toBeInstanceOf(ApiError);
  });

  it("avslutat ärende: kan inte bytas och raden säger varför", async () => {
    const closed = rt.raw().all("cases").find((c) => c.status === "closed" && c.contractId === "c-bot")!;
    expect(await q(caseAreaView, { caseId: closed.id }, sara())).toMatchObject({ canChange: false, blockedText: "Insatsen är avslutad. Yrkesområdet kan inte bytas." });
  });
});

describe("Byt yrkesområde: samtidiga byten och motiveringen (granskningen)", () => {
  it("dialogen visade ett annat yrkesområde än ärendet har nu: conflict – inget skrivs", async () => {
    const notes = rt.raw().all("case_notes").length;
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "E" }, amira())).toMatchObject({ ok: false, error: "conflict" });
    expect(rt.raw().all("case_notes")).toHaveLength(notes);
    expect(rt.raw().get("cases", NADIA)?.primaryAreaCode).toBe("G");
  });

  it("en kollega hann skriva sitt byte (G → E) innan ärendet ändrades: mitt byte (G → C) får conflict och anteckningen tas bort igen", async () => {
    // Kollegans byte är skrivet men ärendet har ännu inte fått det nya yrkesområdet (två samtidiga anrop).
    rt.store.insertRow("case_area_changes", {
      id: "cac-kollega", contractId: "c-bot", caseId: NADIA, fromArea: "G", toArea: "E", effectiveMonth: "2027-03", changedBy: "u-erik", changedAt: "2027-02-01T09:12",
      noteId: "note-nadia-samtal", seq: 1,
    });
    const res = await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, amira());
    expect(res).toMatchObject({ ok: false, error: "conflict" });
    expect(rt.raw().all("case_area_changes").filter((x) => x.caseId === NADIA).map((x) => x.id)).toEqual(["cac-kollega"]);
    expect(rt.raw().get("cases", NADIA)?.primaryAreaCode).toBe("G");
    // Motiveringen ligger inte kvar som en anteckning om ett byte som aldrig blev av.
    const orphan = rt.raw().all("case_notes").filter((n) => n.caseId === NADIA && n.body.startsWith("Byte av yrkesområde: G Lager och logistik → C"));
    expect(orphan).toHaveLength(1);
    expect(orphan[0].removedAt).not.toBeNull();
  });

  it("två byten samma minut: numreras 1 och 2, och fakturan följer det sista – oavsett id", async () => {
    expect(await change({ caseId: NADIA, toArea: "D", motivation: WHY }, amira())).toMatchObject({ ok: true });
    expect(await change({ caseId: NADIA, toArea: "H", motivation: WHY }, amira())).toMatchObject({ ok: true });
    const own = rt.raw().all("case_area_changes").filter((x) => x.caseId === NADIA);
    expect(own.map((x) => [x.seq, x.fromArea, x.toArea])).toEqual([[1, "G", "D"], [2, "D", "H"]]);
  });

  it("motiveringen är intern: den visas inte bland månadens anteckningar i månadsbedömningen och kan inte läggas i sammanfattningen", async () => {
    const res = await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira());
    if (!res.ok) throw new Error(res.message);
    const page = await q(assessmentPage, { caseId: NADIA, month: "2027-02" }, amira());
    expect(page.kind === "ok" && page.notes.map((n) => n.id)).not.toContain(res.noteId);
    const linnea = await q(assessmentPage, { caseId: "case-260163", month: "2027-01" }, amira());
    expect(linnea.kind === "ok" && linnea.notes.map((n) => n.id)).not.toContain("note-byte-linnea");
    const saved = await rt.run("command", assessmentSave.key, { caseId: NADIA, month: "2027-02", summary: "Sammanfattning.", usedNoteIds: [res.noteId] }, amira());
    expect(saved).toMatchObject({ ok: false, error: "bad_note" });
  });
});

describe("Ekonomen: avtalsområdet vid start och det som faktureras nu", () => {
  it("Linnea bytte G → D: raden vid start visar G, och D med sin artikel och sitt pris faktureras från februari", async () => {
    const v = await q(ekoCase, { caseId: "case-260163" }, lars());
    expect(v).not.toBeNull();
    expect(v!.areaName).toMatch(/^G /);
    expect(v!.currentArea).toMatchObject({ month: "2027-02" });
    expect(v!.currentArea!.areaName).toMatch(/^D /);
    const priceD = rt.raw().all("price_items").find((p) => p.areaCode === "D")!;
    expect(v!.currentArea!.priceOre).toBe(priceD.priceOre);
    // Ett ärende utan byte: ingen extra rad.
    expect((await q(ekoCase, { caseId: NADIA }, lars()))!.currentArea).toBeNull();
  });
});
