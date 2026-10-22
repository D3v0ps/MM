// Byt yrkesområde (Karims beslut 2026-10-22): kommandot arenden.bytYrkesomrade och raden på deltagarkortet mot testdatat i
// minnet (MemoryRuntime, samma hanterare som appen). Ordningen: anteckningen, bytet (som ändrar ärendets yrkesområde och
// yrkesspår i samma steg – triggern case_area_changes_apply), kartläggningens valda spår, revisionsloggen och sist
// afterCaseAreaChanged – grupp och inbjudningar följer direkt (syncAudienceInvites, yrkesområdet är deltagarens grupp).
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { areaForMonth } from "@/core/area-changes";
import { billingLines } from "@/core/billing";
import { requireOperational } from "@/core/config";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { SYSTEM_ACTOR } from "@/api/roles";
import { monthlyDraftInput } from "@/features/_shared/voice-jobs";
import { assessmentPage, assessmentSave, intakePage, intakeSave } from "@/features/coach/api";
import { rebaseStaleDraft } from "@/shell/guard";
import { ekoCase } from "@/features/ekonomi/api";
import { monthlyPreview, reportModel, type ReportDb, type ReportEnv, type SummaryModel } from "@/features/rapporter/model";
import { newReport } from "@/features/_shared/rows";
import { caseAreaView, caseChangeArea, caseNoteRemove, caseNoteSave, caseTimeline } from "./api";

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
/** Rapportunderlaget och rapportmiljön ur minnet (samma tabeller som rapporternas läsning). */
const REPORT_TABLES = ["cases", "activities", "attendance", "check_ins", "monthly_assessments", "monthly_plans", "outcome_events", "deviations", "tasks", "audit_log",
  "contract_deviations", "pulse_responses", "contract_areas", "profiles", "price_items", "reports", "case_area_changes"] as const;
const reportDb = (): ReportDb => Object.fromEntries(REPORT_TABLES.map((n) => [n, [...rt.raw().all(n)]])) as unknown as ReportDb;
const reportEnv = (): ReportEnv => {
  const contract = rt.raw().get("contracts", "c-bot")!;
  return { cfg: requireOperational(contract.config), contract: { id: contract.id, startsOn: contract.startsOn, supplierName: "" }, now: rt.clock.now(), activityTypes: [] };
};

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
    // trackChanged: det gamla yrkesspåret (G) följde inte med – bara en flagga, aldrig spåret.
    expect(log[0].details).toEqual({ caseId: NADIA, fromArea: "G", toArea: "C", effectiveMonth: "2027-03", changeId: res.changeId, noteId: res.noteId, seq: 1, trackChanged: true });
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
    expect(v.history).toEqual([{
      id: "cac-seed-linnea", changedAt: "2027-01-27T14:10", fromArea: "G", toArea: "D", fromName: "G Lager och logistik", toName: "D Kök, restaurang och måltidsservice",
      byName: "Amira Haddad", effectiveMonth: "2027-02", motivation: "Kartläggningen visade erfarenhet från storkök och ett tydligt mål att arbeta i kök.",
    }]);
    // Yrkesspåren att välja bland i det nya yrkesområdet.
    expect(v.options.find((a) => a.code === "F")?.tracks).toEqual(["Lokalvårdare med certifiering"]);
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

  it("en kollega hann byta (G → E) mellan att jag läste ärendet och skrev mitt byte (G → C): conflict, anteckningen tas bort igen", async () => {
    // Kollegans byte skrivs precis före mitt (två samtidiga anrop läste samma nummer) – med ärendet i samma steg, som triggern.
    const orig = rt.store.insertRow.bind(rt.store);
    let raced = false;
    (rt.store as unknown as { insertRow: typeof orig }).insertRow = ((name: string, row: { id: string }) => {
      if (!raced && name === "case_area_changes") {
        raced = true;
        orig("case_notes", {
          id: "note-kollega", contractId: "c-bot", caseId: NADIA, authorId: "u-erik", occurredOn: "2027-02-01", kind: "other", audience: "team",
          body: "Byte av yrkesområde: G Lager och logistik → E Transport. Kollegans motivering.", createdAt: "2027-02-01T09:12", updatedAt: null, removedAt: null, removedBy: null,
        });
        orig("case_area_changes", {
          id: "cac-kollega", contractId: "c-bot", caseId: NADIA, fromArea: "G", toArea: "E", effectiveMonth: "2027-03", changedBy: "u-erik", changedAt: "2027-02-01T09:12",
          noteId: "note-kollega", seq: 1, fromTrack: "Truckförare A+B", toTrack: "", fromSecondaryArea: null,
        });
        rt.store.updateRow("cases", NADIA, { primaryAreaCode: "E", vocationalTrack: "" });
      }
      return orig(name as never, row as never);
    }) as typeof orig;
    const res = await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, amira());
    expect(res).toMatchObject({ ok: false, error: "conflict" });
    expect(rt.raw().all("case_area_changes").filter((x) => x.caseId === NADIA).map((x) => x.id)).toEqual(["cac-kollega"]);
    expect(rt.raw().get("cases", NADIA)?.primaryAreaCode).toBe("E");
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

  it("vid start = den första debiterbara veckans månad (torsdagsregeln), som fakturan – inte startdagens kalendermånad", async () => {
    // Start fredag 1 januari 2027: första veckan (28 dec–3 jan, torsdag 31 dec) hör till december. Bytet G → D gäller från januari.
    rt.store.updateRow("cases", "case-260163", { startDate: "2027-01-01" });
    rt.store.updateRow("case_area_changes", "cac-seed-linnea", { changedAt: "2026-12-20T10:00", effectiveMonth: "2027-01" });
    const v = (await q(ekoCase, { caseId: "case-260163" }, lars()))!;
    expect(v.weeks[0]).toMatchObject({ monday: "2026-12-28", monthKey: "2026-12" });
    expect(v.areaName).toMatch(/^G /);
    expect(v.currentArea!.areaName).toMatch(/^D /);
  });
});

describe("Byt yrkesområde: granskningen, andra rundan", () => {
  it("ett fel mitt i bytet (ärendet kunde inte ändras): inget halvt byte – varken bytet eller ärendet, anteckningen döljs och bytet kan göras igen", async () => {
    // Ärendet ändras – och sedan går något fel i samma steg (som när transaktionen avbryts i Postgres): allt rullas tillbaka.
    const orig = rt.store.updateRow.bind(rt.store);
    let broken = true;
    (rt.store as unknown as { updateRow: typeof orig }).updateRow = ((name: string, id: string, patch: object) => {
      const r = orig(name as never, id, patch as never);
      if (broken && name === "cases" && id === NADIA && "primaryAreaCode" in patch) throw new Error("ECONNRESET");
      return r;
    }) as typeof orig;
    await expect(change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira())).rejects.toThrow();
    broken = false;
    const raw = rt.raw();
    // Inget halvt byte: fakturan räknas inte på C, ärendet har kvar G och sitt spår, och nästa byte stoppas inte av kedjan.
    expect(raw.all("case_area_changes").filter((x) => x.caseId === NADIA)).toEqual([]);
    expect(raw.get("cases", NADIA)).toMatchObject({ primaryAreaCode: "G", vocationalTrack: "Truckförare A+B" });
    const notes = raw.all("case_notes").filter((n) => n.caseId === NADIA && n.body.startsWith("Byte av yrkesområde:"));
    expect(notes).toHaveLength(1);
    expect(notes[0].removedAt).not.toBeNull();
    const again = await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira());
    expect(again).toMatchObject({ ok: true });
    expect(rt.raw().all("case_area_changes").filter((x) => x.caseId === NADIA).map((x) => [x.seq, x.fromArea, x.toArea])).toEqual([[1, "G", "C"]]);
  });

  it("svaret kom inte fram efter att bytet skrevs (granskningen, tredje rundan): bytet står kvar, ärendet har bytt, loggen och grupperna görs", async () => {
    // Bytet och ärendet skrivs (en transaktion) – sedan tappas svaret (nätverksfel efter commit). Ingen ångring.
    const proto = MemoryRepo.prototype as unknown as { table: (name: string) => Record<string, unknown> };
    const origTable = proto.table;
    let lost = true;
    proto.table = function (this: unknown, name: string) {
      const t = origTable.call(this, name);
      if (name !== "case_area_changes") return t;
      const insert = t.insert as (row: unknown) => Promise<unknown>;
      return { ...t, insert: async (row: unknown) => { await insert(row); if (lost) { lost = false; throw new Error("fetch failed"); } return row; } };
    };
    try {
      const res = await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira());
      expect(res).toMatchObject({ ok: true, groups: { invited: expect.any(Number), removed: expect.any(Number) } });
      const raw = rt.raw();
      expect(raw.get("cases", NADIA)?.primaryAreaCode).toBe("C");
      expect(raw.all("case_area_changes").filter((x) => x.caseId === NADIA).map((x) => [x.fromArea, x.toArea])).toEqual([["G", "C"]]);
      const note = raw.all("case_notes").find((n) => n.caseId === NADIA && n.body.startsWith("Byte av yrkesområde: G"))!;
      expect(note.removedAt).toBeNull();
      expect(raw.all("audit_log").filter((l) => l.action === "case.area_changed")).toHaveLength(1);
      // Fakturan: februari på G, mars på C – som ett vanligt byte.
      const changes = raw.all("case_area_changes");
      expect([areaForMonth(raw.get("cases", NADIA)!, changes, "2027-02"), areaForMonth(raw.get("cases", NADIA)!, changes, "2027-03")]).toEqual(["G", "C"]);
    } finally {
      proto.table = origTable;
    }
  });

  it("motiveringen är låst: den ändras och tas aldrig bort, och tidslinjen visar den som Byte av yrkesområde utan knappar", async () => {
    const res = await change({ caseId: NADIA, toArea: "F", motivation: WHY }, amira());
    if (!res.ok) throw new Error(res.message);
    const note = rt.raw().get("case_notes", res.noteId)!;
    const edit = { caseId: NADIA, noteId: res.noteId, occurredOn: note.occurredOn, kind: note.kind, audience: note.audience, body: "Ändrad motivering." };
    expect(await rt.run("command", caseNoteSave.key, edit, amira())).toMatchObject({ ok: false, error: "locked" });
    for (const a of [amira(), sara(), johan()]) expect(await rt.run("command", caseNoteRemove.key, { caseId: NADIA, noteId: res.noteId }, a), a.role).toMatchObject({ ok: false, error: "locked" });
    expect(rt.raw().get("case_notes", res.noteId)).toMatchObject({ body: note.body, removedAt: null });
    const pages: { months: { entries: { note?: { id: string; canEdit: boolean; canRemove: boolean } | null; title: string }[] }[]; more?: boolean }[] = [];
    pages.push((await q(caseTimeline, { caseId: NADIA, visa: "anteckningar" }, amira()))!);
    const entry = pages.flatMap((p) => p.months.flatMap((m) => m.entries)).find((e) => e.note?.id === res.noteId)!;
    expect(entry).toMatchObject({ title: "Byte av yrkesområde", note: { canEdit: false, canRemove: false } });
    // Historiken på kortet: yrkesområdenas namn och motiveringen.
    const v = (await q(caseAreaView, { caseId: NADIA }, amira()))!;
    expect(v.history[0]).toMatchObject({ fromName: "G Lager och logistik", toName: "F Lokalvård", motivation: WHY });
  });

  it("yrkesspåret följer aldrig med till det nya yrkesområdet: det valda spåret, annars väljs det i kartläggningen", async () => {
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).not.toBe("");
    expect(await change({ caseId: NADIA, toArea: "F", motivation: WHY }, amira())).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).toBe("");
    expect(await change({ caseId: NADIA, toArea: "G", motivation: WHY, vocationalTrack: "Lagerarbetare – plock och pack" }, amira())).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).toBe("Lagerarbetare – plock och pack");
    // Bara ett av det nya yrkesområdets spår (listan i dialogen) – inte ett personnummer, fritext eller ett annat yrkesområdes spår.
    for (const vocationalTrack of ["19730216-9545", "Något helt annat", "Truckförare A+B", "x".repeat(200)]) {
      expect(await change({ caseId: NADIA, toArea: "F", motivation: WHY, vocationalTrack }, amira()), vocationalTrack).toMatchObject({ ok: false, error: "track" });
    }
  });

  it("utan spår frågar kartläggningen igen: det valda spåret töms, och spåret som väljs i den godkända kartläggningen blir ärendets och syns i nästa månadsrapport", async () => {
    const ia = rt.raw().all("intake_assessments").find((x) => x.caseId === NADIA)!;
    expect(ia).toMatchObject({ status: "approved", chosenTrack: "Truckförare A+B" });
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira())).toMatchObject({ ok: true });
    const after = rt.raw().get("intake_assessments", ia.id)!;
    expect(after.chosenTrack).toBe("");
    // Coachen väljer spåret i kartläggningen och sparar (utan att godkänna igen – den är redan godkänd).
    const saved = await rt.run("command", intakeSave.key, { caseId: NADIA, data: { chosenTrack: "Bygg – grund och arbetsmiljö" }, expectedVersion: after.version }, amira());
    expect(saved).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).toBe("Bygg – grund och arbetsmiljö");
    const db = reportDb();
    const env = reportEnv();
    expect(Object.fromEntries(monthlyPreview(db, NADIA, "2027-03", env)!.basics)).toMatchObject({ Avtalsområde: "C Bygg och anläggning", Yrkesspår: "Bygg – grund och arbetsmiljö" });
    // Månaderna före bytet: det gamla yrkesområdet och spåret, som fakturan.
    expect(Object.fromEntries(monthlyPreview(db, NADIA, "2027-02", env)!.basics)).toMatchObject({ Avtalsområde: "G Lager och logistik", Yrkesspår: "Truckförare A+B" });
  });

  it("månadsrapporten: avtalsområdet och yrkesspåret som gällde månaden (samma som fakturan) – ett byte i februari ändrar inte januari", async () => {
    expect(await change({ caseId: NADIA, toArea: "F", motivation: WHY }, amira())).toMatchObject({ ok: true });
    const db = reportDb();
    const env = reportEnv();
    const jan = monthlyPreview(db, NADIA, "2027-01", env)!;
    // Spåret var känt i januari – det sparades på bytet (fromTrack) och visas, inte "Framgår inte".
    expect(Object.fromEntries(jan.basics)).toMatchObject({ Avtalsområde: "G Lager och logistik", Yrkesspår: "Truckförare A+B" });
    // Utan bytet: ärendets yrkesområde som förut.
    const without = monthlyPreview({ ...db, case_area_changes: [] }, NADIA, "2027-01", env)!;
    expect(Object.fromEntries(without.basics)).toMatchObject({ Avtalsområde: "F Lokalvård" });
  });

  it("kommunens dokument följer samma regel: beställarrapporten och slutrapporten visar yrkesområdet som gällde månaden (granskningen, tredje rundan)", async () => {
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira())).toMatchObject({ ok: true });
    const env = reportEnv();
    const db = reportDb();
    const summary = (d: ReportDb) => reportModel(d, newReport({
      id: "rep-t-sum", contractId: "c-bot", kind: "customer_summary", status: "draft", periodStart: "2027-01-01", periodEnd: "2027-01-31", dueAt: "2027-02-10T12:00", month: "2027-01",
    }), env) as SummaryModel;
    // Januaris beställarrapport räknar Nadia under G, som januaris månadsrapport och faktura – exakt som om hon inte hade bytt.
    const unchanged: ReportDb = {
      ...db,
      cases: db.cases.map((c) => (c.id === NADIA ? { ...c, primaryAreaCode: "G", vocationalTrack: "Truckförare A+B" } : c)),
      case_area_changes: db.case_area_changes.filter((x) => x.caseId !== NADIA),
    };
    expect(summary(db).byArea).toEqual(summary(unchanged).byArea);
    expect(summary(db).byTrack).toEqual(summary(unchanged).byTrack);
    // Slutrapporten: insatsen avslutas 20 februari, innan bytet gäller (mars) – G och det gamla spåret, som februaris
    // månadsrapport och faktura. Ett yrkesområde som aldrig fakturerades eller rapporterades syns inte.
    const final = (to: string) => reportModel(db, newReport({
      id: "rep-t-fin", contractId: "c-bot", kind: "final", caseId: NADIA, status: "draft", periodStart: null, periodEnd: to, dueAt: "2027-03-01T12:00",
    }), env) as { basics: [string, string][] };
    expect(Object.fromEntries(final("2027-02-20").basics)).toMatchObject({ Avtalsområde: "G Lager och logistik", Yrkesspår: "Truckförare A+B" });
    expect(Object.fromEntries(final("2027-03-20").basics)).toMatchObject({ Avtalsområde: "C Bygg och anläggning", Yrkesspår: "Framgår inte" });
  });
});

describe("Byt yrkesområde: granskningen, fjärde rundan", () => {
  const proto = MemoryRepo.prototype as unknown as { table: (name: string) => Record<string, unknown> };
  const intakeOf = (caseId: string) => rt.raw().all("intake_assessments").find((x) => x.caseId === caseId)!;
  const save = (input: ParamsOf<typeof intakeSave>) => rt.run("command", intakeSave.key, input, amira()) as Promise<ResultOf<typeof intakeSave>>;

  it("kartläggningen för bara över ett spår som coachen väljer: ett gammalt spår i ett återställt utkast eller i kartläggningen följer aldrig med till ärendet", async () => {
    const ia0 = intakeOf(NADIA);
    expect(ia0).toMatchObject({ status: "approved", chosenTrack: "Truckförare A+B" });
    // Formuläret som coachen lämnade osparat (utkastminnet): hela kartläggningen med G-spåret som visades.
    const form = {
      workExperience: ia0.workExperience, education: ia0.education, languageNotes: ia0.languageNotes, digitalSkills: ia0.digitalSkills, drivingLicence: ia0.drivingLicence,
      workGoals: ia0.workGoals, chosenTrack: ia0.chosenTrack, adaptations: "Behöver instruktioner i skrift", firstWeekGoal: ia0.firstWeekGoal,
    };
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY }, amira())).toMatchObject({ ok: true });
    expect(intakeOf(NADIA).chosenTrack).toBe("");
    // a) Det återställda utkastet med G-spåret: spåret hör inte till C – nekas, inget skrivs.
    const v1 = intakeOf(NADIA).version;
    expect(await save({ caseId: NADIA, data: form, expectedVersion: v1 })).toMatchObject({ ok: false, error: "track" });
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).toBe("");
    expect(intakeOf(NADIA)).toMatchObject({ version: v1, chosenTrack: "" });
    // b) Steg 3 i bytet hoppades över (kartläggningen har kvar G-spåret): en sparning som inte väljer spåret för inte över det –
    //    varken bara ett annat fält eller hela formuläret med samma spår som det sparade.
    rt.store.updateRow("intake_assessments", ia0.id, { chosenTrack: "Truckförare A+B" });
    expect(await save({ caseId: NADIA, data: { adaptations: "Behöver instruktioner i skrift" }, expectedVersion: intakeOf(NADIA).version })).toMatchObject({ ok: true });
    expect(await save({ caseId: NADIA, data: { ...form, adaptations: "Behöver korta arbetspass" }, expectedVersion: intakeOf(NADIA).version })).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).toBe("");
    // Att godkänna igen med G-spåret: nekas.
    expect(await save({ caseId: NADIA, data: {}, approve: true, expectedVersion: intakeOf(NADIA).version })).toMatchObject({ ok: false, error: "track" });
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).toBe("");
    // c) Coachen väljer ett spår i C: förs över, och revisionsloggen har ändringen av ärendet (bara fältets namn).
    expect(await save({ caseId: NADIA, data: { chosenTrack: "Bygg – grund och arbetsmiljö" }, expectedVersion: intakeOf(NADIA).version })).toMatchObject({ ok: true });
    expect(rt.raw().get("cases", NADIA)?.vocationalTrack).toBe("Bygg – grund och arbetsmiljö");
    const logged = rt.raw().all("audit_log").filter((l) => l.action === "case.updated" && l.entityId === NADIA);
    expect(logged).toHaveLength(1);
    expect(logged[0].details).toMatchObject({ fields: ["vocationalTrack"], source: "intake" });
  });

  it("bytet sparades men svaret kom inte fram och det gick inte att läsa om: unknown – samma byte igen gör klart loggen, kartläggningen och grupperna", async () => {
    const origTable = proto.table;
    let lost = true;
    let failedReads = 0;
    proto.table = function (this: unknown, name: string) {
      const t = origTable.call(this, name);
      if (name !== "case_area_changes") return t;
      const insert = t.insert as (row: unknown) => Promise<unknown>;
      const get = t.get as (id: string) => Promise<unknown>;
      return {
        ...t,
        insert: async (row: unknown) => { await insert(row); if (lost) { lost = false; throw new Error("fetch failed"); } return row; },
        get: async (id: string) => { if (failedReads < 3) { failedReads++; throw new Error("fetch failed"); } return get(id); },
      };
    };
    let first: ResultOf<typeof caseChangeArea>;
    try {
      first = await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, amira());
    } finally {
      proto.table = origTable;
    }
    expect(first).toMatchObject({ ok: false, error: "unknown" });
    expect(failedReads).toBe(3);
    // Bytet är sparat (ärendet har bytt), men loggen, kartläggningen och grupperna är inte gjorda.
    const raw = rt.raw();
    const saved = raw.all("case_area_changes").filter((x) => x.caseId === NADIA);
    expect(saved).toHaveLength(1);
    expect(raw.get("cases", NADIA)).toMatchObject({ primaryAreaCode: "C", vocationalTrack: "" });
    expect(raw.all("audit_log").filter((l) => l.action === "case.area_changed")).toHaveLength(0);
    expect(intakeOf(NADIA).chosenTrack).toBe("Truckförare A+B");
    // Motiveringen är låst och står kvar.
    expect(raw.get("case_notes", saved[0].noteId)?.removedAt).toBeNull();
    // Samma byte igen från dialogen som fortfarande är öppen: görs klart – inget "inget har sparats".
    const again = await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, amira());
    expect(again).toMatchObject({ ok: true, changeId: saved[0].id, noteId: saved[0].noteId, effectiveMonth: "2027-03", groups: { invited: expect.any(Number), removed: expect.any(Number) } });
    expect(rt.raw().all("case_area_changes").filter((x) => x.caseId === NADIA)).toHaveLength(1);
    const log = rt.raw().all("audit_log").filter((l) => l.action === "case.area_changed");
    expect(log).toHaveLength(1);
    expect(log[0].details).toMatchObject({ changeId: saved[0].id, fromArea: "G", toArea: "C", seq: 1, trackChanged: true });
    expect(intakeOf(NADIA).chosenTrack).toBe("");
    // En tredje gång är bytet redan klart: conflict som förut (dialogen visade G).
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, amira())).toMatchObject({ ok: false, error: "conflict" });
    expect(rt.raw().all("audit_log").filter((l) => l.action === "case.area_changed")).toHaveLength(1);
  });

  it("omläsningen misslyckas en gång men lyckas sedan: bytet görs klart direkt", async () => {
    const origTable = proto.table;
    let lost = true;
    let failedReads = 0;
    proto.table = function (this: unknown, name: string) {
      const t = origTable.call(this, name);
      if (name !== "case_area_changes") return t;
      const insert = t.insert as (row: unknown) => Promise<unknown>;
      const get = t.get as (id: string) => Promise<unknown>;
      return {
        ...t,
        insert: async (row: unknown) => { await insert(row); if (lost) { lost = false; throw new Error("fetch failed"); } return row; },
        get: async (id: string) => { if (failedReads < 1) { failedReads++; throw new Error("fetch failed"); } return get(id); },
      };
    };
    try {
      expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, amira())).toMatchObject({ ok: true });
    } finally {
      proto.table = origTable;
    }
    expect(rt.raw().all("audit_log").filter((l) => l.action === "case.area_changed")).toHaveLength(1);
    expect(intakeOf(NADIA).chosenTrack).toBe("");
  });

  it("ett byte som en kollega gjorde och som saknar loggen görs inte klart av mig: conflict", async () => {
    expect(await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, erik())).toMatchObject({ ok: true });
    // Loggen saknas (som efter ett dubbelfel hos Erik).
    for (const l of rt.raw().all("audit_log").filter((x) => x.action === "case.area_changed")) rt.store.removeRow("audit_log", l.id);
    const res = await change({ caseId: NADIA, toArea: "C", motivation: WHY, fromArea: "G" }, amira());
    expect(res).toMatchObject({ ok: false, error: "conflict" });
  });

  it("kartläggningen i utkast med ett utkast i minnet: efter Byt yrkesområde lyfts utkastet till raden – ingen falsk konflikt, spåret är tomt och coachens osparade text ligger kvar", async () => {
    const AMAL = "case-270012";
    const ia0 = intakeOf(AMAL);
    expect(ia0).toMatchObject({ status: "draft", chosenTrack: "" });
    const key = `kartlaggning|${AMAL}`;
    type F = Record<"workExperience" | "education" | "languageNotes" | "digitalSkills" | "drivingLicence" | "workGoals" | "chosenTrack" | "adaptations" | "firstWeekGoal", string>;
    const formOf = async (): Promise<{ f: F; version: number }> => {
      const v = await q(intakePage, { caseId: AMAL }, amira());
      if (v.kind !== "ok" || !v.intake) throw new Error("gate");
      const i = v.intake;
      return {
        f: { workExperience: i.workExperience, education: i.education, languageNotes: i.languageNotes, digitalSkills: i.digitalSkills, drivingLicence: i.drivingLicence, workGoals: i.workGoals, chosenTrack: i.chosenTrack, adaptations: i.adaptations, firstWeekGoal: i.firstWeekGoal },
        version: i.version,
      };
    };
    // Utkastminnet som formuläret har det (useDraft): fälten, det sparade läget och versionen.
    const m = new Map<string, unknown>();
    const memory = { peek: (k: string) => ({ has: m.has(k), value: m.get(k) }), put: (k: string, value: unknown) => void m.set(k, value) };
    // 1. Coachen väljer spår och yrkesmål – autosparat (version i minnet).
    const start = await formOf();
    const typed: F = { ...start.f, workGoals: "Arbeta inom lager", chosenTrack: "Individuellt spår" };
    const auto = await save({ caseId: AMAL, data: typed, autosave: true, editSession: "esr4amal0001", expectedVersion: start.version });
    if (!auto.ok) throw new Error(auto.message);
    m.set(key, typed).set(`${key}|sparat`, JSON.stringify(typed)).set(`${key}|version`, auto.version);
    // 2. Sedan skriver coachen mer (inte sparat än) och går till deltagarkortet och byter yrkesområde utan spår.
    m.set(key, { ...typed, adaptations: "Behöver skriftliga instruktioner" });
    expect(await change({ caseId: AMAL, toArea: "G", motivation: WHY }, amira())).toMatchObject({ ok: true });
    // Utan lyftet: versionen i minnet är äldre – nästa autosparning skulle få "ändrats i en annan flik".
    expect(await save({ caseId: AMAL, data: m.get(key) as F, autosave: true, editSession: "esr4amal0001", expectedVersion: auto.version })).toMatchObject({ ok: false, error: "conflict" });
    // 3. Tillbaka i kartläggningen: utkastet lyfts till raden (rebaseStaleDraft – samma anrop som formuläret gör).
    const server = await formOf();
    expect(server.f.chosenTrack).toBe("");
    expect(rebaseStaleDraft(memory, { key, saved: `${key}|sparat`, version: `${key}|version`, server: server.f, serverVersion: server.version })).toBe("rebased");
    expect(m.get(key)).toEqual({ ...server.f, adaptations: "Behöver skriftliga instruktioner" });
    expect(m.get(`${key}|version`)).toBe(server.version);
    expect(m.get(`${key}|sparat`)).toBe(JSON.stringify(server.f));
    // Nästa autosparning går igenom med coachens text, och det gamla spåret följer inte med.
    const next = await save({ caseId: AMAL, data: m.get(key) as F, autosave: true, editSession: "esr4amal0001", expectedVersion: server.version });
    expect(next).toMatchObject({ ok: true });
    expect(intakeOf(AMAL)).toMatchObject({ chosenTrack: "", adaptations: "Behöver skriftliga instruktioner", workGoals: "Arbeta inom lager" });
    expect(rt.raw().get("cases", AMAL)).toMatchObject({ primaryAreaCode: "G", vocationalTrack: "" });
  });
});
