// Portarna ctx.ai och ctx.audio i minnesläget: den simulerade AI:n (ai-sim.ts) och ljudet i minnet (audio-port.ts).
// Kontrollerar svarens form mot samma zod-scheman som den riktiga leverantören, att utkasten ger exakt testdatats
// (prototypens) AI-texter, reglerna för när inspelning får användas och ljudets livscykel (raderas efter transkribering).
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/server";
import { SYSTEM_ACTOR } from "@/api/roles";
import { BOTKYRKA_CONFIG, parseContractConfig } from "@/core/config";
import { demoClock, createMemoryRuntime } from "@/data/memory-runtime";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { participantMessage, PARTICIPANT_MESSAGES } from "@/data/seed/voice-texts";
import type { AppRepo, CaseNote, CheckIn, Tables } from "@/data/schema";
import { PNR_SCRUBBED } from "@/core/validation";
import {
  AI_CORE_INSTRUCTIONS, aiRunRow, approvedCheckIns, assertApprovedInput, CheckInExtractSchema, DRAFT_INPUT_KEYS, draftNotes, DraftTextSchema, EXTRACT_INSTRUCTIONS, EXTRACT_SCHEMAS, mmss,
  recordingBlock, requireAi, sumRuns, transcriptLines, TranscriptSchema, TranslationSchema, type AiRunMeta, type DraftInput,
} from "./ai-port";
import { checkInSuggestionsFromTranscript, createSimulatedAi, SIMULATED_MODEL, SIMULATED_PROVIDER, simulatedDraft } from "./ai-sim";
import { AUDIO_MAX_BYTES, audioOverdue, audioStoragePath, createMemoryAudio, normalizeAudioMime, requireAudio } from "./audio-port";

const ai = createSimulatedAi();
const ref = (uploadId: string, purpose: "checkin" | "dictation" | "participant", durationSec: number | null = null) => ({ uploadId, purpose, mimeType: "audio/webm", durationSec, caseId: "case-1" });

describe("transcribe (simulerad)", () => {
  it("avstämningen: svenskt samtal med talare och tider, skalat till inspelningens längd – samma ljud ger samma transkript", async () => {
    const a = await ai.transcribe(ref("aud-1", "checkin", 3000), { language: "sv" });
    expect(TranscriptSchema.parse(a.value)).toEqual(a.value);
    expect(a.value.language).toBe("sv");
    expect(a.value.segments.map((s) => s.speaker)).toContain("Coach");
    expect(a.value.segments.map((s) => s.speaker)).toContain("Deltagare");
    expect(Math.max(...a.value.segments.map((s) => s.end))).toBeLessThanOrEqual(3000);
    expect(a.value.segments.at(-1)!.start).toBeGreaterThan(1500); // skalat från 25 till 50 minuter
    expect(await ai.transcribe(ref("aud-1", "checkin", 3000), { language: "sv" })).toEqual(a);
    expect(a.run).toMatchObject({ provider: SIMULATED_PROVIDER, model: SIMULATED_MODEL, audioSeconds: 3000, tokensIn: 3000 * 32 });
    // ≈ 1,70 kr per 30 minuter
    expect(a.run.costOre).toBe(283);
  });
  it("deltagaren: på sitt språk, översättningen till svenska är testdatats svenska text", async () => {
    for (const lang of ["so", "ar", "en", "sv"] as const) {
      const t = await ai.transcribe(ref("aud-p", "participant", 50), { language: lang });
      expect(t.value.language).toBe(lang);
      const v = PARTICIPANT_MESSAGES.findIndex((m) => m[lang].join(" ") === t.value.text);
      expect(v).toBeGreaterThanOrEqual(0);
      const sv = await ai.translate(t.value.text, lang, "sv");
      expect(sv.value).toEqual({ text: participantMessage(v, "sv"), from: lang, to: "sv" });
      expect(TranslationSchema.parse(sv.value)).toEqual(sv.value);
    }
    // Ett språk som inte finns i avtalet transkriberas som svenska
    expect((await ai.transcribe(ref("aud-p", "participant"), { language: "fi" })).value.language).toBe("sv");
  });
  it("översättning av okänd text märks som simulerad; samma språk lämnas orört", async () => {
    expect((await ai.translate("Hej då.", "sv", "sv")).value.text).toBe("Hej då.");
    expect((await ai.translate("Nabad gelyo.", "so", "sv")).value.text).toBe("(Simulerad översättning från somaliska) Nabad gelyo.");
  });
  it("kommunens handläggare: svensk text utan talare", async () => {
    const d = await ai.transcribe(ref("aud-d", "dictation", 18), { language: "sv" });
    expect(d.value.language).toBe("sv");
    expect(d.value.text.length).toBeGreaterThan(20);
    expect(d.value.segments.every((s) => s.speaker == null && s.end <= 18)).toBe(true);
  });
  it("kort ljud (1–2 sekunder): inget segment slutar före det börjar – transkriptet klarar schemat för alla syften och ljud", async () => {
    for (const sec of [1, 2]) {
      for (const purpose of ["checkin", "dictation", "participant"] as const) {
        for (let i = 0; i < 8; i++) {
          const t = await ai.transcribe(ref(`aud-kort-${i}`, purpose, sec), { language: purpose === "participant" ? "so" : "sv" });
          expect(TranscriptSchema.safeParse(t.value).success, `${purpose} ${sec} s`).toBe(true);
          for (const s of t.value.segments) expect(s.end).toBeGreaterThanOrEqual(s.start);
        }
      }
    }
  });
});

describe("extract (simulerad): förslag med belägg ur transkriptet", () => {
  it("varje påhittat samtal ger giltiga förslag – citat ur samtalet med tidpunkt, aldrig samlad status, fasen Framgår inte", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const t = (await ai.transcribe(ref(`aud-${i}`, "checkin"), { language: "sv" })).value;
      if (seen.has(t.text)) continue;
      seen.add(t.text);
      const { value } = await ai.extract(t, "check_in");
      expect(EXTRACT_SCHEMAS.check_in.parse(value)).toEqual(value);
      expect(Object.keys(value)).not.toContain("overallStatus");
      expect(value.phase).toEqual({ value: null, quote: "Framgår inte av samtalet. Fasen ändras inte.", t: null, noEvidence: true });
      for (const f of ["attendanceComment", "goalStatus", "nextGoal", "activitiesDone", "employerContacts", "obstacles"] as const) {
        const s = value[f];
        expect(s.noEvidence, f).toBeFalsy();
        const seg = t.segments.find((x) => x.text === s.quote);
        expect(seg, `${f}: citatet finns i transkriptet`).toBeTruthy();
        expect(s.t).toBe(seg!.start);
      }
      expect(value.note.quote).toMatch(/^Sammanfattning av samtalet \d\d:\d\d–\d\d:\d\d$/);
    }
    expect(seen.size).toBe(3);
  });
  it("lagerveckan: delvis nått, yrkesspecifika moment och studiebesök, språk som hinder, nästa veckas mål", () => {
    const t = { text: "", language: "sv", segments: [
      { start: 96, end: 183, text: "I veckan har vi jobbat med yrkesspecifika moment och truck på lagret.", speaker: "Deltagare" },
      { start: 184, end: 741, text: "Jag nådde delvis veckomålet, en dag hann jag inte.", speaker: "Deltagare" },
      { start: 742, end: 1033, text: "I onsdags var vi på ett studiebesök hos en arbetsgivare i Tumba.", speaker: "Deltagare" },
      { start: 1034, end: 1319, text: "Ibland är det svårt att förstå orden i instruktionerna.", speaker: "Deltagare" },
      { start: 1320, end: 1484, text: "Nästa vecka vill jag plocka en hel order själv.", speaker: "Deltagare" },
    ] };
    const s = checkInSuggestionsFromTranscript(t);
    expect(s.goalStatus).toEqual({ value: "partly", quote: "Jag nådde delvis veckomålet, en dag hann jag inte.", t: 184 });
    expect(s.activitiesDone).toMatchObject({ value: ["Yrkesspecifika moment", "Studiebesök och arbetsplatsbesök"], t: 96 });
    expect(s.employerContacts).toMatchObject({ value: { count: "1", types: ["studiebesök"] }, t: 742 });
    expect(s.obstacles).toMatchObject({ value: ["Språk"], t: 1034 });
    expect(s.nextGoal).toMatchObject({ value: "Nästa vecka vill jag plocka en hel order själv", t: 1320 });
    expect(s.note).toEqual({
      value: "I veckan har vi jobbat med yrkesspecifika moment och truck på lagret. Jag nådde delvis veckomålet, en dag hann jag inte.",
      quote: "Sammanfattning av samtalet 01:36–03:04", t: 96,
    });
    expect(transcriptLines(t)[0]).toEqual({ t: 96, who: "Deltagare", text: t.segments[0].text });
  });
  it("närvaron (Karims test 2026-10-09): coachens rader om närvaron blir ett förslag till kommentar med citat och tidpunkt – aldrig närvarostatus", () => {
    const t = { text: "", language: "sv", segments: [
      { start: 60, end: 90, text: "Närvaro den här veckan: måndag, tisdag och torsdag.", speaker: "Coach" },
      { start: 91, end: 130, text: "Onsdag var han frånvarande med giltigt skäl – möte på kommunen, meddelat i förväg.", speaker: "Coach" },
      { start: 184, end: 741, text: "Jag nådde delvis veckomålet, en dag hann jag inte.", speaker: "Deltagare" },
    ] };
    const s = checkInSuggestionsFromTranscript(t);
    expect(s.attendanceComment).toEqual({
      value: "Närvaro den här veckan: måndag, tisdag och torsdag. Onsdag var han frånvarande med giltigt skäl – möte på kommunen, meddelat i förväg.",
      quote: "Närvaro den här veckan: måndag, tisdag och torsdag.", t: 60,
    });
    expect(s.attendanceComment.value!.length).toBeLessThanOrEqual(200);
    expect(Object.keys(s)).not.toContain("attendanceStatus");
    expect(CheckInExtractSchema.safeParse(s).success).toBe(true);
    // Säger samtalet inget om närvaron: Framgår inte
    const none = checkInSuggestionsFromTranscript({ text: "", segments: [t.segments[2]], language: "sv" });
    expect(none.attendanceComment).toEqual({ value: null, quote: "Framgår inte av samtalet. Fyll i själv.", t: null, noEvidence: true });
    // Schemat kräver fältet
    const { attendanceComment: _a, ...without } = s;
    void _a;
    expect(CheckInExtractSchema.safeParse(without).success).toBe(false);
    expect(Object.keys(EXTRACT_SCHEMAS.check_in.parse(s))).toContain("attendanceComment");
  });
  it("tomt samtal: allt Framgår inte", () => {
    const s = checkInSuggestionsFromTranscript({ text: "", segments: [], language: "sv" });
    expect(Object.values(s).every((x) => x.noEvidence && x.value === null)).toBe(true);
    expect(CheckInExtractSchema.safeParse(s).success).toBe(true);
  });
  it("schemat underkänner samlad status, förslag utan belägg och värde utan belägg", () => {
    const ok = checkInSuggestionsFromTranscript({ text: "", segments: [{ start: 5, end: 9, text: "Jag klarade veckomålet.", speaker: "Deltagare" }], language: "sv" });
    expect(CheckInExtractSchema.safeParse(ok).success).toBe(true);
    expect(CheckInExtractSchema.safeParse({ ...ok, overallStatus: { value: "green", quote: "Bra vecka", t: 1 } }).success).toBe(false);
    expect(CheckInExtractSchema.safeParse({ ...ok, goalStatus: { value: "yes", quote: "", t: 5 } }).success).toBe(false);
    expect(CheckInExtractSchema.safeParse({ ...ok, goalStatus: { value: "yes", quote: "Framgår inte", t: null, noEvidence: true } }).success).toBe(false);
    expect(CheckInExtractSchema.safeParse({ ...ok, goalStatus: { value: "kanske", quote: "x", t: 5 } }).success).toBe(false);
  });
  it("instruktionerna är SPEC §8.3:s kärna – inga beslut, belägg, Framgår inte, aldrig samlad status", () => {
    expect(AI_CORE_INSTRUCTIONS).toContain("Du fattar inga beslut och bedömer inte personen.");
    expect(AI_CORE_INSTRUCTIONS).toContain("Finns inget belägg skriver du \"Framgår inte\".");
    expect(EXTRACT_INSTRUCTIONS.check_in).toContain("Föreslå aldrig samlad status");
  });
});

describe("draft (simulerad): bara godkända uppgifter, samma texter som testdatats AI-utkast", () => {
  const seed = createSeed();
  const NOW = DEMO_START;
  /** Underlaget som testdatat byggde månadsutkasten av: godkända avstämningar och registrerad närvaro i månaden. */
  function inputFor(caseId: string, month: string): DraftInput {
    const cis = seed.check_ins.filter((x) => x.caseId === caseId && x.heldAt.slice(0, 7) === month);
    const acts = seed.activities.filter((a) => a.caseId === caseId && a.startsAt.slice(0, 7) === month && a.startsAt < NOW);
    const att = acts.map((a) => seed.attendance.find((x) => x.activityId === a.id)).filter((x) => !!x);
    return { caseId, month, checkIns: approvedCheckIns(cis), attendance: att.map((x) => ({ status: x!.status })), notes: [] };
  }
  const drafts = seed.monthly_assessments.filter((m) => m.status === "draft" && Object.values(m.areas).some((a) => a.aiObservationDraft));

  it("observation per område och sammanfattning = testdatats (prototypens) utkast, för varje månadsbedömning med AI-utkast", () => {
    expect(drafts.length).toBeGreaterThan(5);
    let compared = 0;
    for (const ma of drafts) {
      const input = inputFor(ma.caseId, ma.month);
      for (const [key, area] of Object.entries(ma.areas)) {
        if (!area.aiObservationDraft) continue;
        const d = simulatedDraft(input, `monthly_area:${key}`);
        expect(DraftTextSchema.parse(d)).toEqual(d);
        expect({ key, text: d.text, sources: d.sources, noEvidence: d.noEvidence }).toEqual({
          key, text: area.aiObservationDraft.text, sources: area.aiObservationDraft.sources, noEvidence: !!area.aiObservationDraft.noEvidence,
        });
        compared++;
      }
      expect(simulatedDraft(input, "monthly_summary").text).toBe(ma.aiSummaryDraft);
    }
    expect(compared).toBeGreaterThan(50);
  });
  it("källorna pekar på avstämningarna (id) och utkastet saknar underlag när inget är godkänt", async () => {
    const ma = drafts[0];
    const input = inputFor(ma.caseId, ma.month);
    const d = (await ai.draft(input, "monthly_area:sjalvstandighet")).value;
    expect(d.sourceIds).toEqual(input.checkIns.map((c) => c.id));
    expect(d.sources).toEqual(input.checkIns.map((c) => `Avstämning ${c.heldAt.slice(8, 10).replace(/^0/, "")} ${["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"][Number(c.heldAt.slice(5, 7)) - 1]}`));
    const empty = { ...input, checkIns: [], attendance: [] };
    for (const key of ["monthly_summary", "monthly_plan", "monthly_area:narvaro_rutiner", "monthly_area:finns_inte"] as const) {
      const x = simulatedDraft(empty, key);
      expect([key, x.noEvidence, x.text.startsWith("Framgår inte")]).toEqual([key, true, true]);
    }
    const plan = simulatedDraft(input, "monthly_plan");
    expect(plan.sourceIds).toEqual([input.checkIns.at(-1)!.id]);
  });
  it("vägrar underlag som inte är godkänt (rapporter byggs aldrig av råtranskript)", async () => {
    const ci = seed.check_ins.find((x) => x.status === "draft")!;
    const bad = { caseId: ci.caseId, month: ci.heldAt.slice(0, 7), checkIns: [{ ...(ci as CheckIn), status: "draft" } as never], attendance: [], notes: [] } satisfies DraftInput;
    await expect(ai.draft(bad, "monthly_summary")).rejects.toThrow("godkända");
    expect(approvedCheckIns([ci, { ...ci, id: "x", status: "approved" }]).map((c) => c.id)).toEqual(["x"]);
  });
});

describe("draft: coachernas anteckningar som underlag (Karims beslut 4, 2026-10-09)", () => {
  const seed = createSeed();
  const note = (id: string, occurredOn: string, body: string, patch: Partial<CaseNote> = {}): CaseNote => ({
    id, contractId: "c-bot", caseId: "case-1", authorId: "u-amira", occurredOn, kind: "conversation", audience: "full", body, createdAt: `${occurredOn}T10:00`,
    updatedAt: null, removedAt: null, removedBy: null, ...patch,
  });
  const notes = [
    note("n-3", "2027-01-29", "Var med på gruppträffen. Ville prata om CV."),
    note("n-1", "2027-01-12", "Ringde och sa att personnumret är 19850101-1234 i ansökan."),
    note("n-borttagen", "2027-01-20", "Fel deltagare.", { removedAt: "2027-01-20T11:00", removedBy: "u-sara" }),
    note("n-feb", "2027-02-01", "Ny månad."),
  ];

  it("draftNotes: månadens anteckningar i tidsordning – borttagna och andra månader utan, personnummer tvättade, aldrig författaren", () => {
    const d = draftNotes(notes, "2027-01");
    expect(d).toEqual([
      { id: "n-1", date: "2027-01-12", kind: "conversation", text: `Ringde och sa att personnumret är ${PNR_SCRUBBED} i ansökan.` },
      { id: "n-3", date: "2027-01-29", kind: "conversation", text: "Var med på gruppträffen. Ville prata om CV." },
    ]);
    expect(JSON.stringify(d)).not.toMatch(/u-amira|authorId|19850101/);
  });

  it("källfiltret: inga andra fält i underlaget (aldrig grupper, nivåer, taggar eller namn) och inga personnummer i anteckningarna", () => {
    const base: DraftInput = { caseId: "case-1", month: "2027-01", checkIns: [], attendance: [], notes: draftNotes(notes, "2027-01") };
    expect(() => assertApprovedInput(base)).not.toThrow();
    expect(Object.keys(base).sort()).toEqual([...DRAFT_INPUT_KEYS].sort());
    for (const extra of [{ groupings: ["Nivå 4 – Nära arbete"] }, { level: "grp-c-bot-niva-4" }, { tags: { "Vill arbeta": "Heltid" } }, { name: "Nadia" }]) {
      expect(() => assertApprovedInput({ ...base, ...extra } as DraftInput), JSON.stringify(extra)).toThrow(/bara innehålla/);
    }
    expect(() => assertApprovedInput({ ...base, notes: [{ ...base.notes[0], text: "Pnr 850101-1234" }] })).toThrow(/personnummer/);
    expect(() => assertApprovedInput({ ...base, notes: [{ ...base.notes[0], authorId: "u-amira" } as never] })).toThrow(/personnummer|anteckningar/);
  });

  it("den simulerade sammanfattningen citerar anteckningarna med datum som källa – utan anteckningar exakt som förut", () => {
    const ma = seed.monthly_assessments.find((m) => m.status === "draft" && m.aiSummaryDraft)!;
    const cis = seed.check_ins.filter((x) => x.caseId === ma.caseId && x.heldAt.slice(0, 7) === ma.month);
    const input: DraftInput = { caseId: ma.caseId, month: ma.month, checkIns: approvedCheckIns(cis), attendance: [], notes: [] };
    const plain = simulatedDraft(input, "monthly_summary");
    const withNotes = simulatedDraft({ ...input, notes: draftNotes(notes, "2027-01") }, "monthly_summary");
    expect(withNotes.text).toBe(`${plain.text} Ur anteckningarna – 12 jan: Ringde och sa att personnumret är ${PNR_SCRUBBED} i ansökan. 29 jan: Var med på gruppträffen.`);
    expect(withNotes.sources).toEqual([...plain.sources, "Anteckning 12 jan", "Anteckning 29 jan"]);
    expect(withNotes.sourceIds).toEqual([...plain.sourceIds, "n-1", "n-3"]);
    expect(DraftTextSchema.parse(withNotes)).toEqual(withNotes);
    // Bara anteckningar: ett utkast med anteckningarna som källa (inte "Framgår inte").
    const only = simulatedDraft({ caseId: "case-1", month: "2027-01", checkIns: [], attendance: [], notes: draftNotes(notes, "2027-01") }, "monthly_summary");
    expect(only).toMatchObject({ noEvidence: false, sources: ["Anteckning 12 jan", "Anteckning 29 jan"] });
    // Observationerna per område och planen påverkas inte (AI sätter aldrig nivåer).
    expect(simulatedDraft({ ...input, notes: draftNotes(notes, "2027-01") }, "monthly_plan")).toEqual(simulatedDraft(input, "monthly_plan"));
  });
});

describe("recordingBlock: när inspelning och AI får användas", () => {
  const person = { protectedIdentity: false };
  it("coachen: avtalet, inte skyddade personuppgifter och registrerat samtycke", () => {
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "coach", person, consent: "given" })).toBeNull();
    for (const consent of ["declined", "not_asked", "revoked", "not_applicable", null] as const) {
      expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "coach", person, consent })).toBe("no_consent");
    }
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "coach", person: { protectedIdentity: true }, consent: "given" })).toBe("protected");
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "coach", person: null, consent: "given" })).toBe("protected");
    // Ett avtal utan ai-avsnitt (påhittat utkast): inspelning är avstängd.
    expect(recordingBlock({ cfg: parseContractConfig({ casePrefix: "NYK", dataRole: "processor" }), kind: "coach", person, consent: "given" })).toBe("disabled");
  });
  it("deltagaren: samtycket ges i länken – men aldrig för skyddade personuppgifter", () => {
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "participant", person, consent: "declined" })).toBeNull();
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "participant", person: { protectedIdentity: true } })).toBe("protected");
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "participant" })).toBe("protected");
  });
  it("kommunens handläggare: även i en ny beställning, men inte om den gäller skyddade personuppgifter", () => {
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "customer" })).toBeNull();
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "customer", protectedOrder: true })).toBe("protected");
    expect(recordingBlock({ cfg: BOTKYRKA_CONFIG, kind: "customer", person: { protectedIdentity: true } })).toBe("protected");
    const off = { ai: { ...BOTKYRKA_CONFIG.ai, recording: { ...BOTKYRKA_CONFIG.ai.recording, customer: false } } };
    expect(recordingBlock({ cfg: off, kind: "customer" })).toBe("disabled");
  });
});

describe("ljudet i minnet (ctx.audio)", () => {
  function setup() {
    const store = new MemoryStore<Tables>(createSeed());
    const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
    const clock = demoClock(DEMO_START);
    let seq = 0;
    const audio = createMemoryAudio({ system, now: clock.now, newId: (p) => `${p}-t${++seq}` });
    return { store, audio, clock };
  }
  it("skapa -> bekräfta -> läsa -> transkriberad -> raderad; raden finns kvar som spår utan ljud", async () => {
    const { store, audio, clock } = setup();
    const ticket = await audio.createUpload({ caseId: "case-260143", ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm;codecs=opus", durationSec: 1200.4 });
    expect(ticket).toEqual({ uploadId: "aud-t1", storagePath: "checkin/aud-t1.webm", uploadUrl: null, token: null, expiresAt: null, maxBytes: AUDIO_MAX_BYTES });
    expect(store.getRow("audio_uploads", "aud-t1")).toMatchObject({ status: "pending", mimeType: "audio/webm", durationSec: 1200, createdAt: DEMO_START, ownerId: "u-amira" });
    expect(await audio.read("aud-t1")).toBeNull(); // inte bekräftad
    audio.put("aud-t1", new Uint8Array([1, 2, 3]));
    expect(await audio.confirm("aud-t1")).toEqual({ uploadId: "aud-t1", purpose: "checkin", mimeType: "audio/webm", durationSec: 1200, caseId: "case-260143" });
    expect(store.getRow("audio_uploads", "aud-t1")).toMatchObject({ status: "uploaded", bytes: 3 });
    const data = await audio.read("aud-t1");
    expect(data?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    const t = await ai.transcribe(data!, { language: "sv" });
    expect(t.value.segments.length).toBeGreaterThan(3);
    await audio.mark("aud-t1", "transcribed");
    clock.tick();
    expect(await audio.remove("aud-t1")).toEqual({ deletedAt: "2027-02-01T09:13" });
    expect(store.getRow("audio_uploads", "aud-t1")).toMatchObject({ status: "deleted", deletedAt: "2027-02-01T09:13" });
    expect(audio.stored()).toBe(0);
    expect(await audio.read("aud-t1")).toBeNull();
    clock.tick();
    expect(await audio.remove("aud-t1")).toEqual({ deletedAt: "2027-02-01T09:13" }); // idempotent
    expect(await audio.confirm("aud-t1")).toBeNull();
    expect(await audio.remove("finns-inte")).toBeNull();
  });
  it("fel filtyp eller för stor fil stoppas; sökvägen innehåller bara syfte och id", async () => {
    const { audio } = setup();
    await expect(audio.createUpload({ caseId: null, ownerId: "k-maria", purpose: "dictation", mimeType: "video/mp4" })).rejects.toBeInstanceOf(ApiError);
    await expect(audio.createUpload({ caseId: null, ownerId: "k-maria", purpose: "dictation", mimeType: "audio/mpeg", bytes: AUDIO_MAX_BYTES + 1 })).rejects.toMatchObject({ status: 400, code: "audio_size" });
    expect(normalizeAudioMime("Audio/MP4; codecs=mp4a.40.2")).toBe("audio/mp4");
    expect(audioStoragePath("participant", "aud-n00007", "audio/mpeg")).toBe("participant/aud-n00007.mp3");
    expect(audioStoragePath("dictation", "aud-1", "audio/x-m4a")).toBe("dictation/aud-1.m4a");
  });
  it("gallringen: allt som inte raderats inom 24 timmar", () => {
    expect(audioOverdue({ status: "failed", createdAt: "2027-01-31T09:12" }, "2027-02-01T09:12")).toBe(true);
    expect(audioOverdue({ status: "pending", createdAt: "2027-01-31T09:13" }, "2027-02-01T09:12")).toBe(false);
    expect(audioOverdue({ status: "deleted", createdAt: "2027-01-01T09:13" }, "2027-02-01T09:12")).toBe(false);
  });
  it("minnesläget kopplar in simulerad AI och ljud i minnet i Ctx; utan port blir det ett begripligt fel", async () => {
    const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
    expect(rt.ai.provider).toBe(SIMULATED_PROVIDER);
    const t = await rt.audio.createUpload({ caseId: null, ownerId: "k-maria", purpose: "dictation", mimeType: "audio/webm" });
    expect(rt.store.getRow("audio_uploads", t.uploadId)).toMatchObject({ purpose: "dictation", status: "pending" });
    expect(() => requireAi({})).toThrow(ApiError);
    expect(() => requireAudio({})).toThrow("Inspelningen är inte tillgänglig");
    expect(requireAi({ ai: rt.ai })).toBe(rt.ai);
  });
});

describe("hjälpare", () => {
  const meta = (n: number): AiRunMeta => ({ provider: "simulated", model: "simulerad", latencyMs: 100 * n, tokensIn: n, tokensOut: null, audioSeconds: n === 1 ? 30 : null, costOre: n });
  it("sumRuns och aiRunRow ger raden i ai_runs", () => {
    const run = sumRuns([meta(1), meta(2)]);
    expect(run).toEqual({ provider: "simulated", model: "simulerad", latencyMs: 300, tokensIn: 3, tokensOut: null, audioSeconds: 30, costOre: 3 });
    expect(aiRunRow({ id: "ai-1", now: DEMO_START, caseId: "case-1", kind: "transcribe_participant", inputRef: "aud-1", status: "succeeded", run, output: { a: 1 }, inputDeletedAt: DEMO_START })).toEqual({
      id: "ai-1", caseId: "case-1", kind: "transcribe_participant", provider: "simulated", model: "simulerad", inputRef: "aud-1", status: "succeeded", createdAt: DEMO_START,
      audioSeconds: 30, tokensIn: 3, tokensOut: null, costOre: 3, latencyMs: 300, output: { a: 1 }, evidence: null, inputDeletedAt: DEMO_START,
    });
    expect(aiRunRow({ id: "ai-2", now: DEMO_START, caseId: null, kind: "transcribe_dictation", inputRef: null, status: "failed", run: null })).toMatchObject({ provider: "okänd", costOre: 0, output: null });
    expect(mmss(96)).toBe("01:36");
    expect(mmss(3725)).toBe("62:05");
  });
});
