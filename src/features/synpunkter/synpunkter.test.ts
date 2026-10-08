// Synpunkter i testmiljön genom samma execute() som appen (minnesläget med testmiljöns data: testdatat + testarna).
// Testaren (Actor.testerId, som servern sätter när databasen säger mm.auth_is_tester()) lämnar synpunkter som den testperson
// hen agerar som. Alla andra – och produktion, minnesläget och prototypen, där testerId aldrig finns – får 404.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { ApiError } from "@/api/server";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { canReadRow, canWriteRow } from "@/data/policy";
import type { Feedback, Tables } from "@/data/schema";
import { DEMO_START } from "@/data/seed";
import { seedData } from "@/data/supabase/seed-rows";
import "@/api/handlers";
import { feedbackList, feedbackReply, feedbackSetStatus, feedbackSubmit } from "./api";
import { readFileSync } from "node:fs";
import { csvCell, FEEDBACK_PATH_PATTERN, feedbackCsv, PATH_MASK, sanitizeFeedbackPath, sanitizeViewTitle } from "./model";

const SEED = seedData();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const persona = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
/** Testaren som agerar som en testperson (som servern bygger aktören i testmiljön). */
const asTester = (testerId: string, userId: string, role?: Role): Actor => ({ ...persona(userId, role), testerId });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends keyof Tables & string>(n: N) => rt.store.rows(n) as Tables[N][];

const KARIM_AS_COACH = () => asTester("tester-karim", "u-amira", "coach");
const ALI_AS_KOMMUN = () => asTester("tester-ali", "k-maria", "kommun_handlaggare");
const NEW = { type: "fel" as const, priority: "maste" as const, text: "  Knappen Spara syns inte på mobilen.  ", path: "/arenden/case-260143?flik=narvaro&q=Anna%20Svensson", viewTitle: "Deltagarkort" };

describe("bara testare i testmiljön", () => {
  it("utan testerId (produktion, minnesläget, prototypen, vanliga användare): 404 och ingenting sparas", async () => {
    for (const actor of [persona("u-amira", "coach"), persona("tester-karim", "admin"), persona("u-robin", "admin"), persona("deltagare")]) {
      for (const run of [
        () => q(feedbackList, {}, actor),
        () => cmd(feedbackSubmit, NEW, actor),
        () => cmd(feedbackReply, { feedbackId: "fb-x", text: "Hej" }, actor),
        () => cmd(feedbackSetStatus, { feedbackId: "fb-x", status: "klar" }, actor),
      ]) {
        const e = await run().catch((x: unknown) => x);
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(404);
      }
    }
    expect(rows("feedback")).toHaveLength(0);
    expect(rows("audit_log").filter((x) => x.action.startsWith("feedback."))).toHaveLength(0);
  });

  it("policy.ts: bara testare läser; nya rader bara i eget namn; i en synpunkt ändras bara statusen", () => {
    const raw = rt.raw();
    const row: Feedback = {
      id: "fb-1", type: "fel", priority: "bor", text: "Text", status: "ny", role: "coach", path: "/min-vecka", viewTitle: "Min vecka", createdAt: DEMO_START,
      authorId: "tester-karim", statusChangedAt: null, statusChangedBy: null, submittedAt: null,
    };
    rt.store.insertRow("feedback", row);
    const karim = KARIM_AS_COACH();
    const ali = ALI_AS_KOMMUN();
    expect(canReadRow("feedback", row, karim, raw)).toBe(true);
    expect(canReadRow("feedback", row, ali, raw)).toBe(true);
    expect(canReadRow("feedback", row, persona("tester-karim", "admin"), raw)).toBe(false);
    expect(canWriteRow("feedback", { ...row, id: "fb-2" }, karim, raw)).toBe(true);
    expect(canWriteRow("feedback", { ...row, id: "fb-2" }, ali, raw)).toBe(false); // i Karims namn
    expect(canWriteRow("feedback", { ...row, status: "klar", statusChangedAt: DEMO_START, statusChangedBy: "tester-ali" }, ali, raw)).toBe(true);
    expect(canWriteRow("feedback", { ...row, status: "klar", statusChangedBy: "tester-karim" }, ali, raw)).toBe(false);
    expect(canWriteRow("feedback", { ...row, text: "Ändrad" }, karim, raw)).toBe(false);
    expect(canWriteRow("feedback", { ...row, role: "admin" }, karim, raw)).toBe(false);
    const reply = { id: "fbr-1", feedbackId: "fb-1", text: "Svar", createdAt: DEMO_START, authorId: "tester-ali", submittedAt: null };
    expect(canWriteRow("feedback_replies", reply, ali, raw)).toBe(true);
    expect(canWriteRow("feedback_replies", reply, karim, raw)).toBe(false);
    expect(canWriteRow("feedback_replies", { ...reply, feedbackId: "fb-finns-inte" }, ali, raw)).toBe(false);
    expect(canReadRow("feedback_replies", reply, persona("u-sara"), raw)).toBe(false);
  });
});

describe("lämna synpunkt, lista, svara och ändra status", () => {
  it("synpunkten sparas med testpersonens roll, testarens id, sidan utan fritext och testklockans tid – revisionsloggen utan text", async () => {
    const res = await cmd(feedbackSubmit, NEW, KARIM_AS_COACH());
    expect(res.ok).toBe(true);
    const [row] = rows("feedback");
    expect(row).toEqual({
      id: res.ok ? res.id : "", type: "fel", priority: "maste", text: "Knappen Spara syns inte på mobilen.", status: "ny", role: "coach",
      path: "/arenden/case-260143?flik=narvaro", viewTitle: "Deltagarkort", createdAt: "2027-02-01T09:13", authorId: "tester-karim",
      statusChangedAt: null, statusChangedBy: null, submittedAt: null,
    });
    const log = rows("audit_log").filter((x) => x.action === "feedback.created");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ entity: "feedback", entityId: row.id, actorId: "u-amira", details: { type: "fel", priority: "maste" } });
    expect(JSON.stringify(log[0])).not.toContain("Knappen");
    // Inga utskick om synpunkter.
    expect(rows("outbound_messages").filter((m) => m.createdAt >= DEMO_START)).toHaveLength(0);
  });

  it("hela Miljonmatch: ingen sida; tom text och okänd typ stoppas av valideringen", async () => {
    const res = await cmd(feedbackSubmit, { ...NEW, path: null, viewTitle: "Deltagarkort" }, KARIM_AS_COACH());
    expect(res.ok).toBe(true);
    expect(rows("feedback")[0]).toMatchObject({ path: null, viewTitle: null });
    for (const bad of [{ ...NEW, text: "   " }, { ...NEW, type: "klagomal" }, { ...NEW, priority: "akut" }, { ...NEW, text: "x".repeat(4001) }]) {
      const e = await cmd(feedbackSubmit, bad as never, KARIM_AS_COACH()).catch((x: unknown) => x);
      expect((e as ApiError).status).toBe(400);
    }
    expect(rows("feedback")).toHaveLength(1);
  });

  it("alla testare ser alla synpunkter, nyast först, med hela namnet, roll, perspektiv och svar", async () => {
    const a = await cmd(feedbackSubmit, NEW, KARIM_AS_COACH());
    const b = await cmd(feedbackSubmit, { type: "fraga", priority: "kan", text: "Var ser jag beställningen?", path: "/portal", viewTitle: "Start" }, ALI_AS_KOMMUN());
    if (!a.ok || !b.ok) throw new Error("sparades inte");
    expect(await cmd(feedbackReply, { feedbackId: a.id, text: "Vi tittar på det." }, ALI_AS_KOMMUN())).toMatchObject({ ok: true });
    expect(await cmd(feedbackReply, { feedbackId: a.id, text: "Tack!" }, KARIM_AS_COACH())).toMatchObject({ ok: true });
    const list = await q(feedbackList, {}, KARIM_AS_COACH());
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(list[0]).toMatchObject({ type: "fraga", role: "kommun_handlaggare", roleLabel: "Kommunens handläggare", perspective: "kund", perspectiveLabel: "Kund", authorName: "Ali Khalil", mine: false, replies: [] });
    // Hela namnet även för den inloggade (CSV-filen delas) – "Du" visar dialogen med hjälp av mine.
    expect(list[1]).toMatchObject({ role: "coach", roleLabel: "Huvudcoach", perspectiveLabel: "Leverantör", authorName: "Karim Khalil", mine: true });
    expect(list[1].replies.map((r) => [r.authorName, r.mine, r.text])).toEqual([["Ali Khalil", false, "Vi tittar på det."], ["Karim Khalil", true, "Tack!"]]);
    // Samma lista för Ali (som agerar som en annan testperson) – samma namn, bara mine skiljer.
    const ali = await q(feedbackList, {}, asTester("tester-ali", "deltagare"));
    expect(ali.map((x) => [x.id, x.authorName, x.mine])).toEqual([[b.id, "Ali Khalil", true], [a.id, "Karim Khalil", false]]);
    expect(rows("audit_log").filter((x) => x.action === "feedback.replied").map((x) => x.entityId)).toEqual([a.id, a.id]);
  });

  it("status: ändras i testarens namn och loggas; samma status igen gör ingenting; okänd synpunkt ger not_found", async () => {
    const a = await cmd(feedbackSubmit, NEW, KARIM_AS_COACH());
    if (!a.ok) throw new Error("sparades inte");
    expect(await cmd(feedbackSetStatus, { feedbackId: a.id, status: "andras" }, ALI_AS_KOMMUN())).toEqual({ ok: true });
    expect(rows("feedback")[0]).toMatchObject({ status: "andras", statusChangedBy: "tester-ali", statusChangedAt: "2027-02-01T09:14" });
    expect(await cmd(feedbackSetStatus, { feedbackId: a.id, status: "andras" }, ALI_AS_KOMMUN())).toEqual({ ok: true });
    expect(rows("audit_log").filter((x) => x.action === "feedback.status_changed").map((x) => x.details)).toEqual([{ from: "ny", to: "andras" }]);
    expect(await cmd(feedbackSetStatus, { feedbackId: "fb-finns-inte", status: "klar" }, ALI_AS_KOMMUN())).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(feedbackReply, { feedbackId: "fb-finns-inte", text: "Hej" }, ALI_AS_KOMMUN())).toMatchObject({ ok: false, error: "not_found" });
    const e = await cmd(feedbackSetStatus, { feedbackId: a.id, status: "borttagen" as never }, ALI_AS_KOMMUN()).catch((x: unknown) => x);
    expect((e as ApiError).status).toBe(400);
  });
});

describe("läsningen: riktig tid och rensad sökväg", () => {
  const stored = (id: string, createdAt: string, submittedAt: string | null, path: string | null, authorId = "tester-karim"): Feedback => ({
    id, type: "fel", priority: "bor", text: `Text ${id}`, status: "ny", role: "coach", path, viewTitle: "Min vecka", createdAt, authorId,
    statusChangedAt: null, statusChangedBy: null, submittedAt,
  });

  it("nyast först efter riktig tid (databasen) – testklockan börjar om när testdatat läses in på nytt", async () => {
    // fb-gammal lämnades på testdag 4 (2027-02-04); efter omladdningen står testklockan på 2027-02-01 igen.
    rt.store.insertRow("feedback", stored("fb-gammal", "2027-02-04T15:00", "2026-10-01T10:00", "/min-vecka"));
    rt.store.insertRow("feedback", stored("fb-ny", "2027-02-01T09:15", "2026-10-02T08:30", "/min-vecka"));
    rt.store.insertRow("feedback_replies", { id: "fbr-b", feedbackId: "fb-gammal", text: "Efter omladdningen", createdAt: "2027-02-01T09:20", authorId: "tester-ali", submittedAt: "2026-10-02T08:40" });
    rt.store.insertRow("feedback_replies", { id: "fbr-a", feedbackId: "fb-gammal", text: "Före omladdningen", createdAt: "2027-02-04T15:10", authorId: "tester-ali", submittedAt: "2026-10-01T10:10" });
    const list = await q(feedbackList, {}, KARIM_AS_COACH());
    expect(list.map((x) => [x.id, x.submittedAt])).toEqual([["fb-ny", "2026-10-02T08:30"], ["fb-gammal", "2026-10-01T10:00"]]);
    expect(list[1].replies.map((r) => r.text)).toEqual(["Före omladdningen", "Efter omladdningen"]);
    // CSV: Tid = riktig tid, Testdatum = testklockan.
    expect(feedbackCsv(list).split("\r\n")[1]).toMatch(/^2026-10-02 08:30;2027-02-01 09:15;Fel;/);
  });

  it("sökvägen rensas igen när listan läses – en rad som skrivits förbi hanteraren når aldrig webbläsaren som en annan webbplats", async () => {
    rt.store.insertRow("feedback", stored("fb-1", "2027-02-01T09:15", null, "//evil.example/logga-in"));
    rt.store.insertRow("feedback", stored("fb-2", "2027-02-01T09:16", null, "/arenden/Anna Svensson?q=Anna"));
    rt.store.insertRow("feedback", stored("fb-3", "2027-02-01T09:17", null, "/arenden/case-260143?flik=narvaro"));
    const list = await q(feedbackList, {}, KARIM_AS_COACH());
    expect(list.map((x) => [x.id, x.path])).toEqual([["fb-3", "/arenden/case-260143?flik=narvaro"], ["fb-2", `/arenden/${PATH_MASK}`], ["fb-1", null]]);
  });
});

describe("sidan och CSV", () => {
  it("sidan: bara sökväg och id:n – fritext, återhoppsadresser, token och långa sifferföljder tas bort", () => {
    expect(sanitizeFeedbackPath("/arenden/case-260143?flik=narvaro&q=Anna%20Svensson#topp")).toBe("/arenden/case-260143?flik=narvaro");
    expect(sanitizeFeedbackPath("/manadsbedomning/case-1?manad=2027-01&till=/portal")).toBe("/manadsbedomning/case-1?manad=2027-01");
    expect(sanitizeFeedbackPath("/rost/rost-abc123def456")).toBe(`/rost/${PATH_MASK}`);
    expect(sanitizeFeedbackPath("/puls/abcdefgh12345678")).toBe(`/puls/${PATH_MASK}`);
    expect(sanitizeFeedbackPath("/arenden/Anna Svensson")).toBe(`/arenden/${PATH_MASK}`);
    expect(sanitizeFeedbackPath("/arenden/199001011234")).toBe(`/arenden/${PATH_MASK}`);
    expect(sanitizeFeedbackPath("/arenden?filter=900101-1234")).toBe("/arenden");
    expect(sanitizeFeedbackPath("/ekonomi/2027-01/faktura/case-1")).toBe("/ekonomi/2027-01/faktura/case-1");
    expect(sanitizeFeedbackPath("/")).toBe("/");
    expect(sanitizeFeedbackPath("https://example.com/x")).toBeNull();
    expect(sanitizeFeedbackPath("//example.com/x")).toBeNull();
    expect(sanitizeFeedbackPath(null)).toBeNull();
    // Samma mönster som databasens kontroll (0017_synpunkter.sql har exakt FEEDBACK_PATH_PATTERN).
    const sql = readFileSync(new URL("../../../supabase/migrations/0017_synpunkter.sql", import.meta.url), "utf8");
    expect(sql).toContain(`path ~ '${FEEDBACK_PATH_PATTERN}'`);
    const db = new RegExp(FEEDBACK_PATH_PATTERN);
    for (const p of ["/arenden/case-260143?flik=narvaro", `/rost/${PATH_MASK}`, "/a/b/c/d/e/f/g/h/i/j", "/", "/?flik=narvaro", `/x/${"a".repeat(80)}/${"b".repeat(80)}/${"c".repeat(80)}/${"d".repeat(80)}`]) {
      expect(sanitizeFeedbackPath(p), p).toMatch(db);
    }
    // Aldrig en adress till en annan webbplats ('//värd/…' tolkas av webbläsaren som https://värd/…), inga mellanslag.
    for (const bad of ["//evil.example/logga-in", "///evil.example", "/arenden/Anna Svensson", "https://evil.example", "/\\evil.example", "arenden"]) expect(db.test(bad), bad).toBe(false);
    expect(sanitizeViewTitle(" Deltagarkort\n– Närvaro ")).toBe("Deltagarkort – Närvaro");
    expect(sanitizeViewTitle("   ")).toBeNull();
    expect(sanitizeViewTitle("x".repeat(500))).toHaveLength(120);
  });

  it("CSV: semikolon, svenska rubriker, citattecken vid behov och skydd mot formler", () => {
    expect([csvCell("=SUMMA(A1)"), csvCell("+46"), csvCell("-1"), csvCell("@x"), csvCell("vanlig"), csvCell('a;"b"')]).toEqual(["'=SUMMA(A1)", "'+46", "'-1", "'@x", "vanlig", '"a;""b"""']);
    const csv = feedbackCsv([
      {
        createdAt: "2027-02-01T09:13", submittedAt: "2026-10-01T14:03", type: "fel", priority: "maste", status: "ny", role: "coach", viewTitle: "Deltagarkort", path: "/arenden/case-260143",
        text: "=HYPERLINK(\"x\")", authorName: "Karim Khalil", replies: [{ createdAt: "2027-02-01T09:20", submittedAt: "2026-10-01T14:10", authorName: "Ali Khalil", text: "Ok; vi fixar" }],
      },
      { createdAt: "2027-02-01T10:00", type: "bra", priority: "kan", status: "klar", role: "kommun_chef", viewTitle: null, path: null, text: "Bra", authorName: "Sara Salah", replies: [] },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Tid;Testdatum;Typ;Hur viktigt;Status;Roll;Sida;Sökväg;Synpunkt;Lämnad av;Antal svar;Svar");
    expect(lines[1]).toBe(
      `2026-10-01 14:03;2027-02-01 09:13;Fel;Måste ändras;Ny;Huvudcoach;Deltagarkort;/arenden/case-260143;"'=HYPERLINK(""x"")";Karim Khalil;1;"Ali Khalil (2026-10-01 14:10): Ok; vi fixar"`,
    );
    // Utan riktig tid (minnesläget): testtiden i båda kolumnerna.
    // En äldre synpunkt från rollen kommunens chef (borttagen 2026-10-07) behåller en läsbar roll.
    expect(lines[2]).toBe("2027-02-01 10:00;2027-02-01 10:00;Bra som det är;Kan vänta;Klar;Kommunens chef (borttagen roll);Hela Miljonmatch;;Bra;Sara Salah;0;");
    expect(lines).toHaveLength(3);
  });
});
