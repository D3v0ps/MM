// Deltagarkortet som löpande underlag (rapporter steg 2): tidslinjen, de fria anteckningarna, månadsunderlaget och
// anteckningarna i coachens månadsbedömning – mot testdatat i minnet (MemoryRuntime, samma hanterare som appen).
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { attendanceStats } from "@/core/attendance";
import { DEFAULT_ORG_SETTINGS, requireOperational } from "@/core/config";
import { customerSummary } from "@/core/customer-summary";
import { domainEnv } from "@/core/env";
import { eventLabel } from "@/core/labels";
import { addDays, monday, weekMonday } from "@/core/time";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, PolicyError, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { ACTIVITY_TYPES } from "@/data/seed/constants";
import { emptyDb, type Db, type Tables } from "@/data/schema";
import { appendToSummary, assessmentPage, assessmentSave, canAppendToSummary, ASSESSMENT_SUMMARY_MAX, noteInSummary } from "@/features/coach/api";
import { canonicalJson, reportModel, type ReportEnv } from "@/features/rapporter/model";
import { isDelivered } from "@/features/rapporter/report-helpers";
import {
  caseCard, caseMessages, caseMonthBasis, caseNoteRemove, caseNoteSave, caseTimeline, caseTimelineText, checkInsApprovedGap, type CaseCard, type CaseTimeline, type TimelineCat, type TimelineEntry,
} from "./api";
import { monthReportState, monthReportStateLabel, monthReportStatusLabel } from "./timeline";
import { reportCorrect } from "@/features/rapporter/api";

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
type Res = { ok: boolean; error?: string; message?: string; noteId?: string };
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<Res>;
const amira = () => as("u-amira", "coach");
const petra = () => as("u-petra", "handledare");
const david = () => as("u-david", "handledare");
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const karin = () => as("u-karin", "chef");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");
const leila = () => as("u-leila", "coach");

const NADIA = "case-260143";
const YUSUF = "case-260148";
const MEHMET = "case-260130";
const SKYDDAD = "case-260120";
/** Den vilande spärren (beslut 2026-10-07): personen i SKYDDAD får skyddade personuppgifter – testdatat har inga. */
const protect = () => rt.store.updateRow("persons", rt.raw().get("cases", SKYDDAD)!.personId, { protectedIdentity: true });
/** Amiras avslutade ärende från september (för sidindelningen). */
const SEPT = "case-260013";

/** Alla sidor av tidslinjen (fore = den äldsta månaden på föregående sida). */
async function allPages(caseId: string, actor: Actor, visa?: TimelineCat): Promise<CaseTimeline[]> {
  const pages: CaseTimeline[] = [];
  let fore: string | undefined;
  for (let i = 0; i < 12; i++) {
    const t = (await q(caseTimeline, { caseId, visa, fore }, actor))!;
    pages.push(t);
    if (!t.more) break;
    fore = t.months[t.months.length - 1].month;
  }
  return pages;
}
const entriesOf = (pages: CaseTimeline[]): TimelineEntry[] => pages.flatMap((p) => p.months.flatMap((m) => m.entries));
/** Lägg en coach i Nadias team (testdatat har ingen coach i ett annat ärendes team). */
const leilaInTeam = () => rt.store.insertRow("case_team", { id: "ct-x-leila", caseId: NADIA, userId: "u-leila", role: "employer_matcher" });

// ================================================================ Tidslinjen
describe("tidslinjen (arenden.kortTidslinje)", () => {
  it("huvudcoachen ser alla kategorier och både 'full' och 'team'-anteckningar; månadsrubriken visar rapportens status", async () => {
    const pages = await allPages(NADIA, amira());
    const all = entriesOf(pages);
    expect(new Set(all.map((e) => e.cat))).toEqual(new Set(["insatser", "narvaro", "progression", "resultat", "anteckningar", "ovrigt"]));
    expect(all.filter((e) => e.note).map((e) => [e.note!.id, e.note!.audience])).toEqual([
      ["note-nadia-borttagen", "team"], ["note-nadia-praktiskt", "team"], ["note-nadia-samtal", "full"], ["note-nadia-kommun", "full"],
    ]);
    expect(pages[0].months.map((m) => [m.month, m.report?.statusLabel])).toEqual([
      ["2027-02", "Månadsrapport: Inte skapad än"], ["2027-01", "Månadsrapport: Utkast"], ["2026-12", "Månadsrapport: Levererad 8 januari 2027"],
    ]);
    expect(pages[0]).toMatchObject({ canWrite: true, more: false, empty: false });
    const samtal = all.find((e) => e.note?.id === "note-nadia-samtal")!;
    expect(samtal).toMatchObject({ title: "Samtal med deltagaren", sub: "Skriven av Amira Haddad · Huvudcoach, samordnare, avtalsansvarig, chef och systemadministratör · Ändrad 28 jan" });
    expect(samtal.note).toMatchObject({ canEdit: true, canRemove: true, removed: null });
    expect(samtal.note!.body).toContain("\n\nVi bokar");
    // Saras anteckning: Amira får inte ändra eller ta bort den.
    expect(all.find((e) => e.note?.id === "note-nadia-kommun")!.note).toMatchObject({ canEdit: false, canRemove: false });
    // Amira ser att Sara tog bort hennes anteckning.
    expect(all.find((e) => e.note?.id === "note-nadia-borttagen")).toMatchObject({ sub: "Borttagen av Sara Lindqvist 29 jan", note: { canEdit: false, canRemove: false, removed: { byName: "Sara Lindqvist" } } });
    expect(all.find((e) => e.id === "ma:ma-16006")).toMatchObject({ title: "Månadsbedömning december godkänd", sub: "Samlad status: Grön · Tydlig progression i 3 områden", light: "green", tab: "manad", month: "2026-12" });
    expect(all.find((e) => e.id === "rep:rep-16008")).toMatchObject({ title: "Månadsrapport december levererad", tab: "rapporter" });
    expect(all.find((e) => e.id === "ci:ci-12498")).toMatchObject({ title: "Veckoavstämning vecka 4 godkänd", sub: "Fas 4 · Praktik/APL", tab: "avstamningar" });
    expect(all.filter((e) => e.title.startsWith("Meddelande")).map((e) => e.title)).toEqual(["Meddelande från kommunen", "Meddelande till kommunen", "Meddelande från kommunen"]);
  });

  it("handledaren: bara teamets kategorier, bara 'team'-anteckningar, bara arbetsgivarkontakter – och ingen rapportstatus", async () => {
    const pages = await allPages(NADIA, petra());
    const all = entriesOf(pages);
    expect(all.filter((e) => e.note).map((e) => e.note!.id)).toEqual(["note-nadia-praktiskt"]);
    expect(all.some((e) => /^(ci|ia|ma|dev|cons|rep|msg|close):/.test(e.id))).toBe(false);
    expect(all.filter((e) => e.cat === "resultat").map((e) => e.title)).toEqual(["Anställningsintervju eller konkret arbetsgivarkontakt", "Praktik/arbetsplatsförlagt moment startat"]);
    expect(pages[0].months.every((m) => m.report === null)).toBe(true);
    expect(pages[0].canWrite).toBe(true);
    // Petras anteckning i Mehmets ärende: hon får ändra den.
    const mehmet = entriesOf(await allPages(MEHMET, petra())).find((e) => e.note)!;
    expect(mehmet.note).toMatchObject({ id: "note-mehmet-handledare", canEdit: true, canRemove: true });
    expect(mehmet.sub).toBe("Skriven av Petra Ek · Även teamet");
  });

  it("chefen läser men skriver inte; ekonomen nekas av rollkontrollen; skyddat ärende (vilande spärr påslagen): samordnaren null, avtalsansvarig ser", async () => {
    const chef = (await q(caseTimeline, { caseId: NADIA }, karin()))!;
    expect(chef.canWrite).toBe(false);
    expect(chef.months.flatMap((m) => m.entries).filter((e) => e.note).every((e) => !e.note!.canEdit && !e.note!.canRemove)).toBe(true);
    await expect(q(caseTimeline, { caseId: NADIA }, lars())).rejects.toBeInstanceOf(ApiError);
    expect(await q(caseTimeline, { caseId: SKYDDAD }, sara())).not.toBeNull();
    protect();
    expect(await q(caseTimeline, { caseId: SKYDDAD }, sara())).toBeNull();
    const j = entriesOf(await allPages(SKYDDAD, johan()));
    expect(j.find((e) => e.note)).toMatchObject({ title: "Samtal med deltagaren", sub: "Skriven av Erik Sjöberg · Bara namngiven huvudcoach och avtalsansvarig", note: { canEdit: false, canRemove: true } });
    expect(entriesOf(await allPages(SKYDDAD, as("u-erik", "coach"))).find((e) => e.note)!.note).toMatchObject({ canEdit: true, canRemove: true });
  });

  it("ingen fritext läcker: avstämningarnas text och hinder, transkript, AI-utkast, meddelanden, avvikelser, händelser och statusorsaker", async () => {
    const db = rt.store.data as unknown as Db;
    const texts = (caseId: string): string[] => {
      const out: string[] = [];
      const add = (v: unknown) => {
        if (typeof v === "string" && v.trim().length >= 12) out.push(v.trim());
        else if (Array.isArray(v)) v.forEach(add);
        else if (v && typeof v === "object") Object.values(v).forEach(add);
      };
      // Avstämningens fritext och AI-utkastets transkript och citat (inte strukturerade val som kontakttyper, som är samma ord som etiketter).
      for (const ci of db.check_ins.filter((x) => x.caseId === caseId)) {
        add([ci.note, ci.obstacles, ci.nextGoal, ci.ai?.transcript.map((l) => l.text), ci.ai?.note?.value, ci.ai?.nextGoal?.value]);
        add(Object.values(ci.ai ?? {}).map((v) => (v && typeof v === "object" && "quote" in v ? (v as { quote?: unknown }).quote : null)));
      }
      for (const m of db.monthly_assessments.filter((x) => x.caseId === caseId)) add([m.summary, m.aiSummaryDraft, Object.values(m.areas).map((a) => [a.observation, a.nextStep, a.aiObservationDraft])]);
      for (const m of db.messages.filter((x) => x.caseId === caseId)) add(m.body);
      for (const d of db.deviations.filter((x) => x.caseId === caseId)) add([d.description, d.assessment, d.action]);
      // Händelsens anteckning (utom när den bara upprepar händelsens etikett, t.ex. "Anställningsintervju").
      for (const e of db.outcome_events.filter((x) => x.caseId === caseId)) add(eventLabel(e.kind).includes(e.note) ? null : e.note);
      for (const h of db.case_status_history.filter((x) => x.caseId === caseId)) add(h.reason);
      for (const a of db.activities.filter((x) => x.caseId === caseId)) add(a.note);
      for (const v of db.participant_voice_notes.filter((x) => x.caseId === caseId)) add([v.textSv, v.textOriginal]);
      return [...new Set(out)];
    };
    for (const caseId of [NADIA, YUSUF, MEHMET, "case-270003"]) {
      const forbidden = texts(caseId);
      expect(forbidden.length, caseId).toBeGreaterThan(0);
      const json = JSON.stringify(await allPages(caseId, amira()));
      for (const t of forbidden) expect(json.includes(t), `${caseId}: ${t.slice(0, 40)}`).toBe(false);
    }
    // Mehmets avstämning med AI-utkast: visas som utkast utan text.
    const draft = entriesOf(await allPages(MEHMET, amira())).find((e) => e.state === "utkast")!;
    expect(draft.title).toMatch(/^Veckoavstämning vecka \d+ · Utkast – granskas av coachen$/);
    expect(draft.sub).toBeUndefined();
  });

  it("en post per ISO-vecka för aktiviteter och för närvaro – siffrorna är attendanceStats för veckan", async () => {
    const db = rt.store.data as unknown as Db;
    const now = rt.clock.now();
    for (const caseId of [NADIA, YUSUF]) {
      const all = entriesOf(await allPages(caseId, amira()));
      const att = all.filter((e) => e.id.startsWith("att:"));
      const act = all.filter((e) => e.id.startsWith("act:"));
      expect(new Set(att.map((e) => e.id)).size).toBe(att.length);
      expect(new Set(act.map((e) => e.id)).size).toBe(act.length);
      const weeksWithActs = new Set(db.activities.filter((a) => a.caseId === caseId && a.startsAt < now).map((a) => monday(a.startsAt)));
      expect(act.length).toBe(weeksWithActs.size);
      for (const e of att) {
        const mon = weekMonday(e.id.slice(4));
        const s = attendanceStats(db, caseId, mon, addDays(mon, 6), { now });
        if (e.title.endsWith("uppehåll")) continue;
        expect(e.title, e.id).toBe(`${e.weekLabel}: närvarande ${s.present + s.late} av ${s.planned} ${s.planned === 1 ? "tillfälle" : "tillfällen"}`);
        if (s.unregistered) expect(e.sub, e.id).toContain(s.unregistered === 1 ? "1 tillfälle är inte registrerat" : `${s.unregistered} tillfällen är inte registrerade`);
        if (s.absentInvalid) expect(e.sub, e.id).toContain(`${s.absentInvalid} ogiltig frånvaro`);
      }
    }
    // Yusuf: upprepad ogiltig frånvaro enligt avtalets regel (2 inom 14 dagar) – röd ikon och text.
    const rep = entriesOf(await allPages(YUSUF, amira())).filter((e) => e.state === "varning");
    expect(rep.length).toBeGreaterThan(0);
    expect(rep.every((e) => e.icon === "alert" && e.sub!.startsWith("Upprepad ogiltig frånvaro"))).toBe(true);
    // Veckan 2026-W53 (28 dec–3 jan) får söndagens datum och hamnar i januari.
    expect(entriesOf(await allPages(NADIA, amira())).find((e) => e.id === "att:2026-W53")?.at).toBe("2027-01-03");
  });

  it("sidindelning: tre månader per svar, fore ger de tre före, more när det finns äldre poster; filtret", async () => {
    const p1 = (await q(caseTimeline, { caseId: SEPT }, amira()))!;
    expect(p1.months.map((m) => m.month)).toEqual(["2026-12", "2026-11", "2026-10"]);
    expect(p1.more).toBe(true);
    const p2 = (await q(caseTimeline, { caseId: SEPT, fore: "2026-10" }, amira()))!;
    expect(p2.months.map((m) => m.month)).toEqual(["2026-09"]);
    expect(p2.more).toBe(false);
    expect(p2.months[0].entries.length).toBeGreaterThan(0);
    // Avslutat ärende: "Insatsen avslutades" i slutmånaden.
    expect(p1.months[0].entries.find((e) => e.title === "Insatsen avslutades")).toMatchObject({ at: "2026-12-04", sub: expect.stringMatching(/^Avslutsorsak: /) });
    const notes = (await q(caseTimeline, { caseId: NADIA, visa: "anteckningar" }, amira()))!;
    expect(notes.months.flatMap((m) => m.entries).every((e) => e.cat === "anteckningar")).toBe(true);
    const none = (await q(caseTimeline, { caseId: SEPT, visa: "anteckningar" }, amira()))!;
    expect(none).toMatchObject({ empty: false, more: false });
    expect(none.months.every((m) => m.entries.length === 0)).toBe(true);
  });

  it("månadsrubrikens status: en text per rapportstatus", () => {
    expect(monthReportStatusLabel(null)).toBe("Månadsrapport: Inte skapad än");
    expect(monthReportStatusLabel({ status: "draft", deliveredAt: null })).toBe("Månadsrapport: Utkast");
    expect(monthReportStatusLabel({ status: "waiting", deliveredAt: null })).toBe("Månadsrapport: Utkast");
    expect(monthReportStatusLabel({ status: "reviewed", deliveredAt: null })).toBe("Månadsrapport: Granskad av coach");
    expect(monthReportStatusLabel({ status: "approved", deliveredAt: null })).toBe("Månadsrapport: Godkänd");
    expect(monthReportStatusLabel({ status: "delivered", deliveredAt: "2026-10-03T10:00" })).toBe("Månadsrapport: Levererad 3 oktober 2026");
    expect(monthReportStatusLabel({ status: "opened", deliveredAt: "2026-10-03T10:00" })).toBe("Månadsrapport: Levererad 3 oktober 2026");
  });

  it("pågående rättelse: månadsrubriken och månadsunderlaget säger båda att månaden är levererad", async () => {
    // Nadias decemberrapport (rep-16008) rättas: version 1 är fortfarande levererad, version 2 är ett utkast.
    const cor = (await cmd(reportCorrect.key, { reportId: "rep-16008" }, amira())) as Res & { reportId?: string };
    expect(cor).toMatchObject({ ok: true });
    const dec = (await q(caseTimeline, { caseId: NADIA }, amira()))!.months.find((m) => m.month === "2026-12")!;
    expect(dec.report).toEqual({ id: cor.reportId, statusLabel: "Månadsrapport: Levererad 8 januari 2027 · rättelse (version 2) är ett utkast" });
    const b = (await q(caseMonthBasis, { caseId: NADIA, manad: "2026-12" }, amira()))!;
    expect(b).toMatchObject({ doc: null, gaps: null, delivered: { reportId: "rep-16008", deliveredAt: "2027-01-08T14:25", version: 1, correctionDraft: 2 } });
    expect(b.months.find((m) => m.month === "2026-12")).toMatchObject({ delivered: true });
    // Den rena funktionen: ett ställe för båda vyerna.
    const db = rt.store.data as unknown as Db;
    const st = monthReportState(db.reports, NADIA, "2026-12");
    expect([st.latest?.id, st.delivered?.id, st.correction?.id]).toEqual([cor.reportId, "rep-16008", cor.reportId]);
    expect(monthReportStateLabel({ latest: null, delivered: null, correction: null })).toBe("Månadsrapport: Inte skapad än");
    expect(monthReportStateLabel({ ...st, correction: null })).toBe("Månadsrapport: Levererad 8 januari 2027");
  });
});

// ================================================================ Anteckningar
describe("tidslinjens utfällda text (arenden.kortTidslinjeText – beslut 2026-10-02)", () => {
  const entries = async (caseId: string, actor: Actor) => (await allPages(caseId, actor)).flatMap((p) => p.months.flatMap((m) => m.entries));
  const draftCheckIn = () => rt.store.rows("check_ins").find((x) => x.caseId === MEHMET && x.status === "draft")!;

  it("grundfrågan märker posterna (text) men bär aldrig texten; teamet får inga sådana poster", async () => {
    const all = await entries(NADIA, amira());
    const msgs = all.filter((e) => e.id.startsWith("msg:"));
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((e) => e.text === "message")).toBe(true);
    const cis = all.filter((e) => e.id.startsWith("ci:"));
    expect(cis.length).toBeGreaterThan(0);
    for (const e of cis) {
      const ci = rt.store.getRow("check_ins", e.id.slice(3))!;
      const expected = ci.status === "approved" ? !!(ci.note.trim() || ci.obstacles.length || (ci.attendanceComment ?? "").trim()) : ci.obstacles.length > 0;
      expect(e.text, e.id).toBe(expected ? "check_in" : undefined);
    }
    // Ingen post har själva texten – inte som body, note eller message.
    const json = JSON.stringify(all.filter((e) => e.text));
    expect(json).not.toMatch(/"body"|"obstacles"|Tack! Kan vi ses/);
    // Handledaren (teamåtkomst): inga meddelande- eller avstämningsposter alls.
    const team = await entries("case-260167", petra());
    expect(team.filter((e) => e.text || e.id.startsWith("msg:") || e.id.startsWith("ci:"))).toEqual([]);
  });

  it("meddelandet: samma rad som fliken Meddelanden; avstämningen: anteckningen bara när den är godkänd; fel ärende och teamet får null; ingen loggrad", async () => {
    const before = rt.store.rows("audit_log").length;
    const tab = (await q(caseMessages, { caseId: NADIA }, amira()))!.messages.find((m) => m.id === "msg-3")!;
    const t = await q(caseTimelineText, { caseId: NADIA, id: "msg:msg-3" }, amira());
    // unreadByMe: Marias meddelande är oläst av Amira (skärmen markerar det som läst när texten fälls ut).
    expect(t).toEqual({ kind: "message", senderName: tab.senderName, orgName: tab.orgName, createdAt: tab.createdAt, meetingRequest: tab.meetingRequest, body: tab.body, readText: tab.readText, unreadByMe: true });
    expect(t && t.kind === "message" && t.body).toMatch(/^Tack! Kan vi ses/);
    // Godkänd avstämning: anteckning, hinder och närvarokommentar som raden i fliken.
    const approved = rt.store.rows("check_ins").find((x) => x.caseId === NADIA && x.status === "approved" && x.note.trim())!;
    expect(await q(caseTimelineText, { caseId: NADIA, id: `ci:${approved.id}` }, amira())).toEqual({
      kind: "check_in", heldAt: approved.heldAt, approved: true, note: approved.note, obstacles: approved.obstacles, attendanceComment: approved.attendanceComment ?? "",
    });
    // Utkast: "Granskas av coachen" – anteckningen lämnas inte ut, hindren visas.
    const draft = draftCheckIn();
    expect(await q(caseTimelineText, { caseId: MEHMET, id: `ci:${draft.id}` }, amira())).toEqual({ kind: "check_in", heldAt: draft.heldAt, approved: false, note: "", obstacles: draft.obstacles, attendanceComment: "" });
    // Fel ärende i id, okänt id: null. Handledaren i ett teamärende: null (samma spärr som fliken). Chefen läser.
    expect(await q(caseTimelineText, { caseId: NADIA, id: `ci:${draft.id}` }, amira())).toBeNull();
    expect(await q(caseTimelineText, { caseId: NADIA, id: "msg:finns-inte" }, amira())).toBeNull();
    const teamMsg = rt.store.rows("messages").find((m) => m.caseId === "case-260167");
    expect(await q(caseTimelineText, { caseId: "case-260167", id: `msg:${teamMsg ? teamMsg.id : "msg-3"}` }, petra())).toBeNull();
    expect(await q(caseTimelineText, { caseId: NADIA, id: "msg:msg-3" }, karin())).toMatchObject({ kind: "message", body: tab.body });
    // Ekonomen nekas av rollkontrollen. Inga rader i revisionsloggen av någon av visningarna (som fliken).
    await expect(q(caseTimelineText, { caseId: NADIA, id: "msg:msg-3" }, lars())).rejects.toBeInstanceOf(ApiError);
    expect(rt.store.rows("audit_log").length).toBe(before);
  });
});

describe("fria anteckningar (arenden.noteSave, arenden.noteRemove)", () => {
  const input = (p: Partial<{ caseId: string; noteId: string; occurredOn: string; kind: string; audience: string; body: string }> = {}) => ({
    caseId: NADIA, occurredOn: "2027-01-29", kind: "conversation", audience: "full", body: "Samtal om nästa vecka. Deltagaren kommer till yrkesmomentet på tisdag.", ...p,
  });
  const logs = (from: number) => rt.store.rows("audit_log").slice(from);

  it("skapa (full och team), loggen har bara id:n – aldrig texten eller typen", async () => {
    const before = rt.store.rows("audit_log").length;
    const a = await cmd(caseNoteSave.key, input(), amira());
    expect(a).toMatchObject({ ok: true });
    const row = rt.store.getRow("case_notes", a.noteId!)!;
    expect(row).toMatchObject({ authorId: "u-amira", contractId: "c-bot", audience: "full", updatedAt: null, removedAt: null, removedBy: null, createdAt: rt.clock.now() });
    const p = await cmd(caseNoteSave.key, input({ audience: "team", kind: "practical", body: "Ny tid för praktiken." }), petra());
    expect(p).toMatchObject({ ok: true });
    const l = logs(before);
    expect(l.map((x) => [x.action, x.entity, x.entityId, x.details])).toEqual([
      ["case_note.created", "case_note", a.noteId, { caseId: NADIA }], ["case_note.created", "case_note", p.noteId, { caseId: NADIA }],
    ]);
    expect(JSON.stringify(l)).not.toMatch(/Samtal om|Ny tid|conversation|practical/);
  });

  it("handledaren nekas 'full'; chef, admin och ekonom nekas av rollkontrollen", async () => {
    expect(await cmd(caseNoteSave.key, input(), petra())).toMatchObject({ ok: false, error: "forbidden" });
    for (const a of [karin(), robin(), lars()]) await expect(cmd(caseNoteSave.key, input({ audience: "team" }), a), a.userId).rejects.toBeInstanceOf(ApiError);
    for (const a of [karin(), robin(), lars()]) await expect(cmd(caseNoteRemove.key, { caseId: NADIA, noteId: "note-nadia-samtal" }, a), a.userId).rejects.toBeInstanceOf(ApiError);
  });

  it("personnummerlik text, framtida datum och datum före beställningen nekas", async () => {
    expect(await cmd(caseNoteSave.key, input({ body: "Ring om 19730216-9545 i morgon." }), amira())).toMatchObject({ ok: false, error: "pnr", message: "Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker." });
    // Inklistrat från Word eller Outlook (tankstreck), andra streck och mellanslag runt strecket – också vid ändring.
    for (const body of ["Handläggaren bekräftade 850101–1234 i går.", "19850101–1234", "850101‐1234", "850101 - 1234"]) {
      expect(await cmd(caseNoteSave.key, input({ body }), amira()), body).toMatchObject({ ok: false, error: "pnr" });
      expect(await cmd(caseNoteSave.key, input({ noteId: "note-nadia-samtal", body }), amira()), body).toMatchObject({ ok: false, error: "pnr" });
    }
    expect(rt.store.getRow("case_notes", "note-nadia-samtal")!.body).toMatch(/^Samtal om praktiken/);
    expect(await cmd(caseNoteSave.key, input({ occurredOn: "2027-02-02" }), amira())).toMatchObject({ ok: false, error: "date", message: "Datumet kan inte vara senare än i dag." });
    expect(await cmd(caseNoteSave.key, input({ occurredOn: "2026-12-01" }), amira())).toMatchObject({ ok: false, error: "date" });
  });

  it("skyddat ärende (vilande spärr påslagen): sparas alltid för full åtkomst", async () => {
    protect();
    const r = await cmd(caseNoteSave.key, input({ caseId: SKYDDAD, audience: "team", occurredOn: "2027-01-29" }), as("u-erik", "coach"));
    expect(r.ok).toBe(true);
    expect(rt.store.getRow("case_notes", r.noteId!)!.audience).toBe("full");
  });

  it("bara författaren ändrar; dölja: författaren eller samordnare/avtalsansvarig – inte handledare eller coach i teamet", async () => {
    expect(await cmd(caseNoteSave.key, input({ noteId: "note-nadia-samtal" }), sara())).toMatchObject({ ok: false, error: "not_author" });
    const before = rt.store.rows("audit_log").length;
    expect(await cmd(caseNoteSave.key, input({ noteId: "note-nadia-samtal", body: "Rättad text." }), amira())).toMatchObject({ ok: true, noteId: "note-nadia-samtal" });
    expect(rt.store.getRow("case_notes", "note-nadia-samtal")).toMatchObject({ body: "Rättad text.", updatedAt: rt.clock.now() });
    expect(logs(before).map((x) => x.action)).toEqual(["case_note.updated"]);
    expect(await cmd(caseNoteRemove.key, { caseId: NADIA, noteId: "note-nadia-praktiskt" }, david())).toMatchObject({ ok: false, error: "not_author" });
    leilaInTeam();
    expect(await cmd(caseNoteRemove.key, { caseId: NADIA, noteId: "note-nadia-praktiskt" }, leila())).toMatchObject({ ok: false, error: "not_author" });
    // Samordnaren döljer Amiras anteckning: Amira ser "Borttagen av …", handledaren ser den inte längre.
    const b2 = rt.store.rows("audit_log").length;
    expect(await cmd(caseNoteRemove.key, { caseId: NADIA, noteId: "note-nadia-praktiskt" }, sara())).toMatchObject({ ok: true });
    expect(rt.store.getRow("case_notes", "note-nadia-praktiskt")).toMatchObject({ removedBy: "u-sara", removedAt: rt.clock.now() });
    const log = logs(b2);
    expect(log.map((x) => [x.action, x.actorId, x.details])).toEqual([["case_note.removed", "u-sara", { caseId: NADIA, authorId: "u-amira" }]]);
    expect(JSON.stringify(log)).not.toMatch(/Praktikplatsen/);
    expect(entriesOf(await allPages(NADIA, petra())).some((e) => e.note?.id === "note-nadia-praktiskt")).toBe(false);
    expect(entriesOf(await allPages(NADIA, amira())).find((e) => e.note?.id === "note-nadia-praktiskt")?.sub).toMatch(/^Borttagen av Sara Lindqvist /);
    // Författaren döljer sin egen: den visas inte längre, inte heller för författaren.
    expect(await cmd(caseNoteRemove.key, { caseId: NADIA, noteId: "note-nadia-samtal" }, amira())).toMatchObject({ ok: true });
    expect(entriesOf(await allPages(NADIA, amira())).some((e) => e.note?.id === "note-nadia-samtal")).toBe(false);
    expect(entriesOf(await allPages(NADIA, sara())).some((e) => e.note?.id === "note-nadia-samtal")).toBe(false);
  });

  it("en borttagen anteckning: kommandona ger not_found och direkt via ctx.repo nekas ändring, återställning och radering", async () => {
    expect(await cmd(caseNoteSave.key, input({ noteId: "note-nadia-borttagen", audience: "team" }), amira())).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(caseNoteRemove.key, { caseId: NADIA, noteId: "note-nadia-borttagen" }, amira())).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(caseNoteRemove.key, { caseId: YUSUF, noteId: "note-nadia-samtal" }, amira())).toMatchObject({ ok: false, error: "not_found" });
    const repo = new MemoryRepo<Tables>(rt.store, amira(), POLICIES);
    await expect(repo.table("case_notes").update("note-nadia-borttagen", { body: "Ny" })).rejects.toBeInstanceOf(PolicyError);
    await expect(repo.table("case_notes").update("note-nadia-borttagen", { removedAt: null, removedBy: null })).rejects.toBeInstanceOf(PolicyError);
    await expect(repo.table("case_notes").remove("note-nadia-samtal")).rejects.toBeInstanceOf(PolicyError);
    await expect(repo.table("case_notes").remove("note-nadia-borttagen")).rejects.toBeInstanceOf(PolicyError);
    expect(rt.store.getRow("case_notes", "note-nadia-samtal")).toBeTruthy();
  });

  it("länken 'Registrera händelse' i dialogen: kortets edit är sant för huvudcoachen men falskt för en coach i teamet", async () => {
    leilaInTeam();
    const lc = (await q(caseCard, { caseId: NADIA }, leila())) as CaseCard;
    expect(lc).toMatchObject({ kind: "ok", access: "team", edit: false });
    expect(((await q(caseCard, { caseId: NADIA }, amira())) as CaseCard).edit).toBe(true);
    // Coachen i teamet skriver bara för teamet och får inte dölja andras.
    expect(await cmd(caseNoteSave.key, input(), leila())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await cmd(caseNoteSave.key, input({ audience: "team" }), leila())).toMatchObject({ ok: true });
  });
});

// ================================================================ Månadsbedömningen: anteckningar in i sammanfattningen
describe("månadsbedömningen: anteckningar från månaden", () => {
  it("assessmentPage visar månadens anteckningar (inte borttagna) och avtalets gränser", async () => {
    const v = await q(assessmentPage, { caseId: NADIA, month: "2027-01" }, amira());
    if (v.kind !== "ok") throw new Error("gate");
    expect(v.notes.map((n) => [n.id, n.kindLabel, n.authorName])).toEqual([
      ["note-nadia-kommun", "Kontakt med kommunen", "Sara Lindqvist"], ["note-nadia-samtal", "Samtal med deltagaren", "Amira Haddad"], ["note-nadia-praktiskt", "Praktiskt", "Amira Haddad"],
    ]);
    expect(v.progressionRule).toEqual({ clearFromLevel: 2, anyFromLevel: 1, clear: "Minst ett område på nivå 2 eller högre", any: "Minst ett område på nivå 1 eller högre", excluded: "Hälsa (funktionellt beskrivet) och livskvalitet (deltagarens egen skattning) är valfria områden och räknas inte." });
  });

  it("usedNoteIds: en loggrad per anteckning med bara id:n och månad; främmande och borttagna nekas", async () => {
    const before = rt.store.rows("audit_log").length;
    const res = await cmd(assessmentSave.key, { caseId: NADIA, month: "2027-01", summary: "Sammanfattning.", usedNoteIds: ["note-nadia-samtal", "note-nadia-praktiskt"] }, amira());
    expect(res).toMatchObject({ ok: true });
    const l = rt.store.rows("audit_log").slice(before).filter((x) => x.action === "case_note.used_in_summary");
    expect(l.map((x) => [x.entity, x.entityId, x.details])).toEqual([
      ["case_note", "note-nadia-samtal", { caseId: NADIA, month: "2027-01" }], ["case_note", "note-nadia-praktiskt", { caseId: NADIA, month: "2027-01" }],
    ]);
    expect(JSON.stringify(l)).not.toMatch(/Samtal om|Praktikplatsen/);
    for (const bad of ["note-mehmet-handledare", "note-nadia-borttagen", "finns-inte"]) {
      expect(await cmd(assessmentSave.key, { caseId: NADIA, month: "2027-01", usedNoteIds: [bad] }, amira()), bad).toMatchObject({ ok: false, error: "bad_note" });
    }
    expect(await cmd(assessmentSave.key, { caseId: NADIA, month: "2026-12", usedNoteIds: ["note-nadia-samtal"] }, amira())).toMatchObject({ ok: false, error: "bad_note" });
  });

  it("'Lägg till i sammanfattningen': exakt 4000 tecken med den tomma raden är aktiv, 4001 inaktiv", () => {
    expect(ASSESSMENT_SUMMARY_MAX).toBe(4000);
    expect(appendToSummary("", "Ny")).toBe("Ny");
    expect(appendToSummary("Första.\n", "Andra.")).toBe("Första.\n\nAndra.");
    const note = "b".repeat(2000);
    expect(canAppendToSummary("a".repeat(4000 - 2 - 2000), note)).toBe(true);
    expect(canAppendToSummary("a".repeat(4001 - 2 - 2000), note)).toBe(false);
    expect(canAppendToSummary("", "c".repeat(4000))).toBe(true);
    expect(canAppendToSummary("", "c".repeat(4001))).toBe(false);
  });

  it("'Tillagd i sammanfattningen' även efter omladdning: anteckningens text finns redan i den sparade sammanfattningen", async () => {
    const body = rt.store.getRow("case_notes", "note-nadia-kommun")!.body;
    const summary = appendToSummary("Nadia har följt planen.", body);
    expect(noteInSummary(summary, body)).toBe(true);
    expect(noteInSummary(summary, `  ${body}\n`)).toBe(true);
    expect(noteInSummary("Handläggaren frågade om slutdatumet.", body)).toBe(false); // omskriven text går att lägga till igen
    expect(noteInSummary(summary, "   ")).toBe(false);
    expect(await cmd(assessmentSave.key, { caseId: NADIA, month: "2027-01", summary, usedNoteIds: ["note-nadia-kommun"] }, amira())).toMatchObject({ ok: true });
    const v = await q(assessmentPage, { caseId: NADIA, month: "2027-01" }, amira());
    if (v.kind !== "ok") throw new Error("ingen bedömning");
    expect(v.notes.filter((n) => noteInSummary(v.assessment?.summary ?? "", n.body)).map((n) => n.id)).toEqual(["note-nadia-kommun"]);
  });
});

// ================================================================ Månadsunderlaget
describe("månadsunderlaget (arenden.kortManad)", () => {
  const envFor = (now: string): ReportEnv => {
    const k = SEED.contracts.find((c) => c.id === "c-bot")!;
    return { cfg: requireOperational(k.config), contract: { id: k.id, startsOn: k.startsOn, supplierName: SEED.organizations.find((o) => o.id === k.supplierId)!.name }, now, activityTypes: ACTIVITY_TYPES };
  };

  it("varje månadsrapport som inte är levererad: förhandsvisningen (ctx.repo som huvudcoachen) = rapportens modell (ctx.system)", async () => {
    const db = { ...emptyDb(), ...(rt.store.data as unknown as Partial<Db>) } as Db;
    const reps = db.reports.filter((r) => r.kind === "monthly" && !isDelivered(r) && !r.superseded && r.caseId && r.month);
    expect(reps.length).toBeGreaterThan(20);
    const env = envFor(rt.clock.now());
    for (const r of reps) {
      const c = db.cases.find((x) => x.id === r.caseId)!;
      const b = (await q(caseMonthBasis, { caseId: c.id, manad: r.month! }, as(c.leadCoachId!, "coach")))!;
      expect(b.delivered, r.id).toBeNull();
      expect(b.doc, r.id).not.toBeNull();
      expect(canonicalJson(b.doc!.m), r.id).toBe(canonicalJson(JSON.parse(JSON.stringify(reportModel(db, r, env)))));
      // Avsnitt 2: veckorna i underlaget är rapportens veckor.
      expect(b.gaps!.weeks, r.id).toBe(b.doc!.m.weeks.length);
      expect(b.gaps!.pausedWeeks, r.id).toBe(b.doc!.m.weeks.filter((w) => w.paused).length);
      expect(b.gaps!.unregistered, r.id).toBe(b.doc!.m.total.unregistered);
      expect(b.reportId, r.id).toBe(r.id);
    }
  });

  it("Nadia januari: kända siffror, matrisen bara med godkända bedömningar och samma dokument som rapporten", async () => {
    const b = (await q(caseMonthBasis, { caseId: NADIA }, amira()))!;
    expect(b.month).toBe("2027-01");
    expect(b.gaps).toEqual({ weeks: 5, pausedWeeks: 0, checkInsApproved: 4, checkInsDraft: 0, unregistered: 2, assessment: "draft", notes: 3 });
    expect(b.matrix.months).toEqual(["2026-12"]);
    expect(b.matrix.rows.map((r) => r.key)).toEqual(requireOperational(SEED.contracts.find((c) => c.id === "c-bot")!.config).progression.areas);
    expect(b.doc).toMatchObject({ kind: "monthly", id: "rep-16011", status: "draft", participant: "Nadia Warsame", recipient: "Maria Ekdahl, Arbetsmarknadsenheten Alby" });
    expect(b.doc!.m.assessment).toBeNull();
  });

  it("godkända veckoavstämningar: ingen falsk varning när en vecka går över månadsskiftet (BOT-26-0133 januari)", async () => {
    // Vecka 53 (28 dec – 3 jan) är en veckorad i både december och januari, men avstämningen hölls 28 december och räknas i
    // december. Raden jämför därför inte antalet avstämningar med antalet veckor.
    const b = (await q(caseMonthBasis, { caseId: "case-260133", manad: "2027-01" }, amira()))!;
    expect(b.delivered).toBeNull();
    expect(b.gaps).toMatchObject({ weeks: 5, pausedWeeks: 0, checkInsApproved: 4, checkInsDraft: 0 });
    expect(b.doc!.m.weeks.map((w) => w.label)).toEqual(["Vecka 53", "Vecka 1", "Vecka 2", "Vecka 3", "Vecka 4"]);
    expect(checkInsApprovedGap(b.gaps!)).toEqual({ kind: "ok", text: "4 veckoavstämningar är godkända." });
    expect(checkInsApprovedGap({ checkInsApproved: 1 })).toEqual({ kind: "ok", text: "1 veckoavstämning är godkänd." });
    expect(checkInsApprovedGap({ checkInsApproved: 0 })).toEqual({ kind: "info", text: "Ingen veckoavstämning är godkänd än." });
  });

  it("levererad månad: inget dokument här – länk till rapporten; före start: texten om att insatsen inte startat", async () => {
    const dec = (await q(caseMonthBasis, { caseId: NADIA, manad: "2026-12" }, amira()))!;
    expect(dec).toMatchObject({ doc: null, gaps: null, delivered: { reportId: "rep-16008", deliveredAt: "2027-01-08T14:25", version: 1, correctionDraft: null } });
    const nov = (await q(caseMonthBasis, { caseId: NADIA, manad: "2026-11" }, amira()))!;
    expect(nov).toMatchObject({ beforeStart: true, doc: null, gaps: null, delivered: null });
    expect(nov.months.map((m) => m.month)).toEqual(["2027-02", "2027-01", "2026-12"]);
  });

  it("canAssess bara för huvudcoachen – inte coach i teamet, samordnare, chef eller admin; teamet når inte fliken", async () => {
    expect((await q(caseMonthBasis, { caseId: NADIA }, amira()))!.canAssess).toBe(true);
    for (const a of [sara(), karin(), robin(), johan()]) expect((await q(caseMonthBasis, { caseId: NADIA }, a))!.canAssess, a.userId).toBe(false);
    leilaInTeam();
    expect(await q(caseMonthBasis, { caseId: NADIA }, leila())).toBeNull();
    expect(await q(caseMonthBasis, { caseId: NADIA }, petra())).toBeNull();
  });
});

// ================================================================ Del 0: gränserna är konfiguration
describe("tydlig och någon progression följer avtalets gränser (clearFromLevel: 3)", () => {
  const mk = "2026-12";
  it("beställarrapporten, månadsbedömningen och tidslinjen räknar och skriver med 3 – ingen med 2", async () => {
    const data = structuredClone(SEED);
    const k = data.contracts.find((c) => c.id === "c-bot")!;
    k.config = { ...k.config, progression: { ...k.config.progression!, clearFromLevel: 3, anyFromLevel: 2 } };
    rt = createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
    const db = rt.store.data as unknown as Db;
    const areas = requireOperational(k.config).progression.areas;
    const mas = db.monthly_assessments.filter((m) => m.month === mk && m.status === "approved");
    const at = (n: number) => mas.filter((m) => areas.some((a) => (m.areas[a]?.level ?? -1) >= n)).length;
    expect(at(3)).toBeLessThan(at(2)); // annars prövar testet ingenting

    // Domänfunktionen bakom beställarrapporten och paritetsfacit (customerSummary): tydlig ≥ 3, någon ≥ 2, per område ≥ 3.
    const cs = customerSummary(db, mk, domainEnv(k, DEFAULT_ORG_SETTINGS, rt.clock.now()));
    expect(cs.progression).toMatchObject({ assessed: mas.length, clear: at(3), any: at(2) });
    expect(cs.progression.areaDist.map((d) => d.clear)).toEqual(areas.map((a) => mas.filter((m) => (m.areas[a]?.level ?? -1) >= 3).length));

    // Beställarrapportens dokument (avtalsansvarig): siffrorna och texten.
    const rep = db.reports.find((r) => r.kind === "customer_summary" && r.month === mk)!;
    const { reportDocument } = await import("@/features/rapporter/api");
    const doc = await q(reportDocument, { reportId: rep.id }, johan());
    if (!doc.ok || doc.doc.kind !== "customer_summary") throw new Error("inget dokument");
    expect(doc.doc.progressionRule).toEqual({ clear: "Minst ett område på nivå 3 eller högre", any: "Minst ett område på nivå 2 eller högre", excluded: "Hälsa (funktionellt beskrivet) och livskvalitet (deltagarens egen skattning) är valfria områden och räknas inte." });
    expect(doc.doc.m.progression.clear).toBe(at(3));
    expect(doc.doc.m.progression.areaDist.map((d) => d.clear)).toEqual(areas.map((a) => mas.filter((m) => (m.areas[a]?.level ?? -1) >= 3).length));

    // (Kommunens chefsvy är borttagen med rollen, beslut 2026-10-07 – beställarrapporten ovan är samma texter.)

    // Coachens månadsbedömning: gränserna och texterna.
    const v = await q(assessmentPage, { caseId: NADIA, month: "2027-01" }, amira());
    if (v.kind !== "ok") throw new Error("gate");
    expect(v.progressionRule).toMatchObject({ clearFromLevel: 3, anyFromLevel: 2, clear: "Minst ett område på nivå 3 eller högre" });

    // Tidslinjen: Nadias decemberbedömning (nivå 3 i inget område).
    const ma = db.monthly_assessments.find((m) => m.caseId === NADIA && m.month === mk)!;
    const n3 = areas.filter((a) => (ma.areas[a]?.level ?? -1) >= 3).length;
    const e = entriesOf(await allPages(NADIA, amira())).find((x) => x.id === `ma:${ma.id}`)!;
    expect(e.sub).toBe(`Samlad status: Grön · ${n3 ? `Tydlig progression i ${n3} ${n3 === 1 ? "område" : "områden"}` : "Ingen tydlig progression"}`);
  });
});
