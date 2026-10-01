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
import { csvCell, feedbackCsv, PATH_MASK, sanitizeFeedbackPath, sanitizeViewTitle } from "./model";

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
      authorId: "tester-karim", statusChangedAt: null, statusChangedBy: null,
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
    const reply = { id: "fbr-1", feedbackId: "fb-1", text: "Svar", createdAt: DEMO_START, authorId: "tester-ali" };
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
      statusChangedAt: null, statusChangedBy: null,
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

  it("alla testare ser alla synpunkter, nyast först, med namn, roll, perspektiv och svar", async () => {
    const a = await cmd(feedbackSubmit, NEW, KARIM_AS_COACH());
    const b = await cmd(feedbackSubmit, { type: "fraga", priority: "kan", text: "Var ser jag beställningen?", path: "/portal", viewTitle: "Start" }, ALI_AS_KOMMUN());
    if (!a.ok || !b.ok) throw new Error("sparades inte");
    expect(await cmd(feedbackReply, { feedbackId: a.id, text: "Vi tittar på det." }, ALI_AS_KOMMUN())).toMatchObject({ ok: true });
    expect(await cmd(feedbackReply, { feedbackId: a.id, text: "Tack!" }, KARIM_AS_COACH())).toMatchObject({ ok: true });
    const list = await q(feedbackList, {}, KARIM_AS_COACH());
    expect(list.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(list[0]).toMatchObject({ type: "fraga", role: "kommun_handlaggare", roleLabel: "Kommunens handläggare", perspective: "kund", perspectiveLabel: "Kund", authorName: "Ali Khalil", mine: false, replies: [] });
    expect(list[1]).toMatchObject({ role: "coach", roleLabel: "Huvudcoach", perspectiveLabel: "Leverantör", authorName: "Du", mine: true });
    expect(list[1].replies.map((r) => [r.authorName, r.text])).toEqual([["Ali Khalil", "Vi tittar på det."], ["Du", "Tack!"]]);
    // Samma lista för Ali (som agerar som en annan testperson) – med hans "Du".
    const ali = await q(feedbackList, {}, asTester("tester-ali", "deltagare"));
    expect(ali.map((x) => [x.id, x.authorName])).toEqual([[b.id, "Du"], [a.id, "Karim Khalil"]]);
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
    // Samma tecken som databasens kontroll (0017_synpunkter.sql).
    for (const p of ["/arenden/case-260143?flik=narvaro", `/rost/${PATH_MASK}`, "/a/b/c/d/e/f/g/h/i/j"]) expect(sanitizeFeedbackPath(p)).toMatch(/^\/[A-Za-z0-9/_.?=&•-]*$/);
    expect(sanitizeViewTitle(" Deltagarkort\n– Närvaro ")).toBe("Deltagarkort – Närvaro");
    expect(sanitizeViewTitle("   ")).toBeNull();
    expect(sanitizeViewTitle("x".repeat(500))).toHaveLength(120);
  });

  it("CSV: semikolon, svenska rubriker, citattecken vid behov och skydd mot formler", () => {
    expect([csvCell("=SUMMA(A1)"), csvCell("+46"), csvCell("-1"), csvCell("@x"), csvCell("vanlig"), csvCell('a;"b"')]).toEqual(["'=SUMMA(A1)", "'+46", "'-1", "'@x", "vanlig", '"a;""b"""']);
    const csv = feedbackCsv([
      {
        createdAt: "2027-02-01T09:13", type: "fel", priority: "maste", status: "ny", role: "coach", viewTitle: "Deltagarkort", path: "/arenden/case-260143",
        text: "=HYPERLINK(\"x\")", authorName: "Karim Khalil", replies: [{ createdAt: "2027-02-01T09:20", authorName: "Ali Khalil", text: "Ok; vi fixar" }],
      },
      { createdAt: "2027-02-01T10:00", type: "bra", priority: "kan", status: "klar", role: "kommun_chef", viewTitle: null, path: null, text: "Bra", authorName: "Du", replies: [] },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Tid;Typ;Hur viktigt;Status;Roll;Sida;Sökväg;Synpunkt;Lämnad av;Antal svar;Svar");
    expect(lines[1]).toBe(`2027-02-01 09:13;Fel;Måste ändras;Ny;Huvudcoach;Deltagarkort;/arenden/case-260143;"'=HYPERLINK(""x"")";Karim Khalil;1;"Ali Khalil (2027-02-01 09:20): Ok; vi fixar"`);
    expect(lines[2]).toBe("2027-02-01 10:00;Bra som det är;Kan vänta;Klar;Kommunens chef;Hela Miljonmatch;;Bra;Du;0;");
    expect(lines).toHaveLength(3);
  });
});
