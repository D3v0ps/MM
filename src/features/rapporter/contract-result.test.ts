// Resultatfilen för hela avtalet (rapportbyggarens färdigrapport). Beslut 2026-10-07: kommunen hämtar inte längre filen själv –
// Miljonbemanning tar fram den och avtalsansvarig lämnar den till kommunen. Testerna från kommunens resultatfil (rapporter steg 3)
// gäller nu den här filen: behörigheten (byggrollerna, avtalet), bara levererade rapporter, rättelser, frysningen, verifiering
// efter leveransen (sätt a), kolumnspärren (också mot kommunens tidigare hämtningar) och revisionsloggen (export.results_mb).
// Skyddade personuppgifter är vilande: testdatat har inga, men sätts de på en person kommer ärendet aldrig med.
// Körs genom execute() mot testdatat i minnet som testpersonerna i rollväljaren (behörighet via policy.ts).
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { execute } from "@/api/handlers";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { ApiError, type Ctx } from "@/api/server";
import { BOTKYRKA_CONFIG, type ContractConfig } from "@/core/config";
import { base64ToBytes } from "@/core/export/base64";
import { entryText, readZip } from "@/core/export/read-zip.test-helper";
import { looksLikePnr } from "@/core/validation";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import type { AppRepo, TableName, Tables } from "@/data/schema";
import { adminAuditDetail, adminAuditLog } from "@/features/admin/api";
import { caseClose } from "@/features/arenden/api";
import { assessmentSave, deviationSave, resultVerify } from "@/features/coach/api";
import { contractResultExport, contractResultPreview, reportApprove, reportCorrect, reportDeliver, reportSaveFinal } from "./api";

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
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const row = <N extends TableName>(name: N, id: string): Tables[N] | undefined => rt.raw().get(name, id);

const johan = () => as("u-johan", "avtalsansvarig");
const sara = () => as("u-sara", "samordnare");
const amira = () => as("u-amira", "coach");
const ALL = { contractId: "c-bot", from: "2026-09", to: "2027-01" };
/** Ärendet som tidigare hade skyddade personuppgifter (Omars beställning) – i dag ett vanligt ärende i testdatat. */
const PROT_CASE = "case-260120";
const PROT_NO = "BOT-26-0120";
const NADIA = "case-260143";
const NADIA_JAN = "rep-16011";

/** Levererade (inte ersatta) månadsrapporter i perioden – det filen ska innehålla. */
const deliveredMonthly = (from = ALL.from, to = ALL.to) =>
  rows("reports").filter((r) => r.kind === "monthly" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.month! >= from && r.month! <= to);

/** Kör exporten och returnera filen (kastar om den inte lämnades ut). */
async function exportCsv(actor: Actor, table: "resultat" | "progression" | "handelser" | "avslut" | "faltbeskrivning" = "resultat", period = ALL) {
  const res = await run(contractResultExport, { ...period, format: "csv", table }, actor);
  if (!res.ok) throw new Error(`Ingen fil: ${res.error} ${res.message ?? ""}`);
  return res;
}
const csvRows = (content: string) => {
  const [head, ...lines] = content.trimEnd().split("\r\n");
  const keys = head.split(";");
  return lines.map((l) => Object.fromEntries(l.split(";").map((v, i) => [keys[i], v])));
};
const caseByNo = (no: string) => rows("cases").find((c) => c.caseNumber === no)!;
const exportLogs = () => rows("audit_log").filter((l) => l.action === "export.results_mb");
const setConfig = (patch: (c: ContractConfig) => void) => {
  const c = row("contracts", "c-bot")!;
  const cfg = JSON.parse(JSON.stringify(c.config)) as ContractConfig;
  patch(cfg);
  rt.store.updateRow("contracts", "c-bot", { config: cfg });
};
const swapFirstAreas = () =>
  setConfig((c) => {
    const a = c.progression!.areas;
    [a[0], a[1]] = [a[1], a[0]];
  });

describe("hela avtalet: alla levererade månadsrapporter", () => {
  it("avtalsansvarig får alla ärenden i avtalet – inga personnummer, samma antal i fil och förhandsvisning", async () => {
    const delivered = deliveredMonthly();
    const pre = await ask(contractResultPreview, { from: "2026-09", to: "2027-01" }, johan());
    expect(pre).toMatchObject({ allowed: true, contractId: "c-bot", from: "2026-09", to: "2027-01", periodError: null, maxMonths: 12, reports: delivered.length, participants: new Set(delivered.map((r) => r.caseId)).size });
    // 271: kommunens tidigare fil hade 270 rapporter – ärendet som hade skyddade personuppgifter är ett vanligt ärende i dag.
    expect(pre.reports).toBe(271);
    expect(pre.months[0]).toEqual({ value: "2027-02", label: "februari 2027" });
    expect(pre.months.at(-1)).toEqual({ value: "2026-09", label: "september 2026" });
    const res = await exportCsv(johan());
    expect(res).toMatchObject({ filename: "resultat_bot_hela-avtalet_2026-09_2027-01.csv", mime: "text/csv;charset=utf-8", encoding: "text", rows: pre.reports, cases: pre.participants });
    expect(csvRows(res.content)).toHaveLength(delivered.length);
    // Ärendet som tidigare hade skyddade personuppgifter är ett vanligt ärende i dag och kommer med.
    expect(res.content).toContain(`${PROT_NO};`);
    expect(looksLikePnr(res.content)).toBe(false);
    expect(res.content.startsWith("arendenummer;namn;manad;")).toBe(true);
    expect(res.content.charCodeAt(0)).not.toBe(0xfeff);
    // Samordnaren och chefen (byggrollerna) får samma fil.
    expect((await exportCsv(sara())).content).toBe(res.content);
    expect((await exportCsv(as("u-karin", "chef"))).rows).toBe(res.rows);
  });

  it("den vilande spärren: sätts skyddade personuppgifter på personen kommer ärendet aldrig med – inte heller för avtalsansvarig", async () => {
    const c = row("cases", PROT_CASE)!;
    rt.store.updateRow("persons", c.personId, { protectedIdentity: true });
    const res = await exportCsv(johan());
    expect(res.content).not.toContain(PROT_NO);
    expect(res.rows).toBe(deliveredMonthly().filter((r) => r.caseId !== PROT_CASE).length);
    const fin = await exportCsv(johan(), "avslut", { contractId: "c-bot", from: "2026-10", to: "2026-12" });
    expect(fin.content).not.toContain(PROT_NO);
    expect((await ask(contractResultPreview, { from: "2026-09", to: "2027-01" }, johan())).reports).toBe(res.rows);
  });
});

describe("nekas", () => {
  it("kommunens handläggare, coach, handledare, ekonom och admin nekas av rollkontrollen", async () => {
    for (const a of [as("k-maria", "kommun_handlaggare"), amira(), as("u-petra", "handledare"), as("u-lars", "ekonom"), as("u-robin", "admin")]) {
      await expect(run(contractResultExport, { ...ALL, format: "xlsx" }, a)).rejects.toBeInstanceOf(ApiError);
      await expect(ask(contractResultPreview, {}, a)).rejects.toBeInstanceOf(ApiError);
    }
  });
  it("ett avtal som läsaren inte är medlem i", async () => {
    expect(await run(contractResultExport, { ...ALL, contractId: "c-ny", format: "xlsx" }, johan())).toMatchObject({ ok: false, error: "forbidden" });
    expect(exportLogs()).toEqual([]);
  });
  it("perioden: fel ordning, mer än 12 månader, före avtalets start, efter innevarande månad", async () => {
    expect(await run(contractResultExport, { ...ALL, from: "2026-12", to: "2026-10", format: "csv" }, johan())).toMatchObject({ ok: false, error: "period", message: "Till-månaden kan inte vara före från-månaden." });
    expect(await run(contractResultExport, { ...ALL, from: "2026-08", to: "2026-10", format: "csv" }, johan())).toMatchObject({ ok: false, error: "period" });
    expect(await run(contractResultExport, { ...ALL, from: "2027-01", to: "2027-03", format: "csv" }, johan())).toMatchObject({ ok: false, error: "period" });
    rt.clock.set("2028-02-01T09:00");
    expect(await run(contractResultExport, { ...ALL, from: "2026-09", to: "2027-09", format: "csv" }, johan())).toMatchObject({ ok: false, error: "period", message: "Välj högst 12 månader." });
    expect((await ask(contractResultPreview, { from: "2026-12", to: "2026-10" }, johan())).periodError).toBe("Till-månaden kan inte vara före från-månaden.");
    expect(await run(contractResultExport, { ...ALL, from: "2027-02", to: "2027-02", format: "csv" }, johan())).toMatchObject({ ok: false, error: "empty" });
    expect(exportLogs()).toEqual([]);
  });
});

describe("bara levererade rapporter – och rättelser", () => {
  it("utkast och godkända men inte levererade månadsrapporter kommer inte med", async () => {
    const notDelivered = rows("reports").filter((r) => r.kind === "monthly" && !["delivered", "opened"].includes(r.status));
    expect(notDelivered.some((r) => r.status === "approved")).toBe(true);
    const res = await exportCsv(johan());
    const keys = new Set(csvRows(res.content).map((r) => `${r.arendenummer}|${r.manad}`));
    for (const r of notDelivered) expect(keys.has(`${row("cases", r.caseId!)!.caseNumber}|${r.month}`)).toBe(false);
  });

  it("rättelse av en rättelse som inte levererats (v1 → v2 godkänd → v3): exakt en rad per ärende och månad, version 3", async () => {
    const before = deliveredMonthly().length;
    const dec = "rep-16008"; // NADIA december, version 1 levererad
    const v2 = await run(reportCorrect, { reportId: dec }, amira());
    if (!v2.ok) throw new Error("ingen rättelse");
    expect(await run(reportApprove, { reportId: v2.reportId }, amira())).toMatchObject({ ok: true });
    // Den godkända (inte levererade) rättelsen rättas igen.
    const v3 = await run(reportCorrect, { reportId: v2.reportId }, amira());
    if (!v3.ok) throw new Error("ingen andra rättelse");
    expect(v3.version).toBe(3);
    expect(await run(reportApprove, { reportId: v3.reportId }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: v3.reportId }, amira())).toMatchObject({ ok: true });
    // Alla tidigare versioner är ersatta av version 3 – också version 1, som var den levererade.
    expect(row("reports", dec)).toMatchObject({ superseded: true, supersededBy: v3.reportId });
    expect(row("reports", v2.reportId)).toMatchObject({ superseded: true, supersededBy: v3.reportId });
    const lines = csvRows((await exportCsv(johan())).content).filter((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2026-12");
    expect(lines).toEqual([expect.objectContaining({ rapport_version: "3", rattelse_pagar: "0" })]);
    const pre = await ask(contractResultPreview, { from: "2026-09", to: "2027-01" }, johan());
    expect(pre.reports).toBe(before);
  });

  it("två levererade versioner som inte ersatts (data före rättningen): bara den högsta versionen kommer med", async () => {
    const before = deliveredMonthly().length;
    const dec = row("reports", "rep-16008")!;
    rt.store.insertRow("reports", { ...dec, id: "rep-v3-gammal-data", version: 3, previousId: "rep-x", deliveredAt: "2027-01-20T10:00", snapshot: null });
    const err = console.error;
    const logged: unknown[][] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const res = await exportCsv(johan());
      const lines = csvRows(res.content).filter((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2026-12");
      expect(lines).toEqual([expect.objectContaining({ rapport_version: "3" })]);
      expect(res.rows).toBe(before);
    } finally {
      console.error = err;
    }
    // Bara id:n i loggen (aldrig namn eller ärendenummer).
    expect(logged).toEqual([["resultatfil: äldre versioner var levererade och inte ersatta – bara den senaste kom med", ["rep-16008"]]]);
    expect((await ask(contractResultPreview, { from: "2026-09", to: "2027-01" }, johan())).reports).toBe(before);
  });

  it("rättelse pågår: den gamla versionen med rattelse_pagar = 1; rättelsen levererad: bara version 2", async () => {
    const dec = "rep-16008"; // NADIA december
    const cor = await run(reportCorrect, { reportId: dec }, amira());
    if (!cor.ok) throw new Error("ingen rättelse");
    const line = async () => csvRows((await exportCsv(johan())).content).filter((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2026-12");
    expect(await line()).toEqual([expect.objectContaining({ rapport_version: "1", rattelse_pagar: "1" })]);
    expect(await run(reportApprove, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(await line()).toEqual([expect.objectContaining({ rapport_version: "2", rattelse_pagar: "0", rapport_levererad: "2027-02-01" })]);
  });
});

describe("frysningen", () => {
  it("rapporter utan ögonblicksbild fryses med fakta under exporten; en andra export ger samma innehåll", async () => {
    expect(rows("reports").filter((r) => r.snapshot).length).toBe(0);
    const a = await run(contractResultExport, { ...ALL, format: "xlsx" }, johan());
    if (!a.ok) throw new Error("ingen fil");
    const frozen = rows("reports").filter((r) => r.snapshot);
    expect(frozen.length).toBeGreaterThanOrEqual(deliveredMonthly().length);
    for (const r of frozen) expect((r.snapshot as { facts?: { kind: string } }).facts?.kind).toBe(r.kind);
    rt.clock.set("2027-02-01T11:00");
    const b = await run(contractResultExport, { ...ALL, format: "xlsx" }, johan());
    if (!b.ok) throw new Error("ingen fil");
    const sheets = async (content: string) => {
      const es = await readZip(base64ToBytes(content));
      return [1, 2, 3, 4, 5].map((n) => entryText(es, `xl/worksheets/sheet${n}.xml`));
    };
    const [sa, sb] = [await sheets(a.content), await sheets(b.content)];
    expect(sb.slice(0, 4)).toEqual(sa.slice(0, 4));
    // Fliken Om filen: bara "Hämtad" skiljer sig.
    expect(sb[4].replace(/2027-02-01 \d{2}:\d{2}/, "X")).toEqual(sa[4].replace(/2027-02-01 \d{2}:\d{2}/, "X"));
    expect(sa[4]).toContain("2027-02-01 09:12");
    expect(sb[4]).toContain("2027-02-01 11:00");
  });
});

describe("verifiering efter leveransen (beslut sätt a)", () => {
  it("arbete utan verifiering → 0; verifiering efter leveransen → fortfarande 0; rättad slutrapport levererad → 1", async () => {
    // NADIA: januarirapporten levereras och insatsen avslutas till arbete den 29 januari, utan verifiering.
    const areas = Object.fromEntries(BOTKYRKA_CONFIG.progression.areas.map((k) => [k, { level: 2 as const, observation: "Följer instruktionen utan stöd.", nextStep: "Fortsätta öva." }]));
    expect(await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, summary: "Deltagaren följer planen.", overallStatus: "green", approve: true }, amira())).toMatchObject({ ok: true });
    expect(await run(reportApprove, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
    const closed = await run(caseClose, { caseId: NADIA, endDate: "2027-01-29", endReason: "arbete" }, amira());
    if (!closed.ok) throw new Error("inte avslutad");
    expect(closed.resultClass).toBe("result");
    expect(await run(reportSaveFinal, { reportId: closed.reportId, obstacles: "", recommendation: "Ingen fortsatt insats rekommenderas." }, amira())).toMatchObject({ ok: true });
    expect(await run(reportApprove, { reportId: closed.reportId }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: closed.reportId }, amira())).toMatchObject({ ok: true });
    const jan = async () => csvRows((await exportCsv(johan())).content).find((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2027-01")!;
    expect(await jan()).toMatchObject({ avslut_datum: "2027-01-29", avslutsorsak_kod: "arbete", avslutsorsak: "Arbete", resultat_kod: "result", resultat: "Resultat", resultat_verifierat: "0" });
    // Verifieringen registreras efter leveransen – svaret säger att slutrapporten redan är levererad.
    rt.clock.set("2027-02-02T10:00");
    expect(await run(resultVerify, { caseId: NADIA, verificationKind: "anställningsbevis" }, amira())).toEqual({ ok: true, finalDelivered: true, finalReportId: closed.reportId });
    expect((await jan()).resultat_verifierat).toBe("0");
    // Rätta slutrapporten och leverera version 2 – nu kommer verifieringen med.
    const cor = await run(reportCorrect, { reportId: closed.reportId }, amira());
    if (!cor.ok) throw new Error("ingen rättelse");
    expect(await run(reportApprove, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(await jan()).toMatchObject({ resultat_kod: "result", resultat_verifierat: "1" });
    // Den rättade slutrapporten frystes vid leveransen – med verifieringen.
    expect(row("reports", cor.reportId)!.snapshot).toMatchObject({ facts: { kind: "final", resultVerified: true, resultVerifiedAt: "2027-02-02" } });
  });
  it("result.verify utan levererad slutrapport svarar finalDelivered: false", async () => {
    expect(await run(resultVerify, { caseId: NADIA, verificationKind: "anställningsbevis" }, amira())).toEqual({ ok: true, finalDelivered: false, finalReportId: null });
  });
});

describe("avvikelser_oppna: öppna vid månadens slut", () => {
  it("en avvikelse som var öppen den 31 januari men stängdes före leveransen räknas som öppen; stängningen sparar tiden", async () => {
    // Avvikelsen registrerades 30 januari (öppen). Den 1 februari stänger coachen den och januarirapporten levereras samma dag.
    rt.store.insertRow("deviations", {
      id: "dev-jan30", caseId: NADIA, createdAt: "2027-01-30T10:00", description: "Uteblev två gånger.", assessment: "", action: "Samtal.", ownerId: "u-amira",
      followUpOn: null, needsCustomerDecision: false, followUpMeetingAt: null, status: "open", checkInId: null,
    });
    /** Tidpunkten då avvikelsen sparades (hanterarens ctx.now() – samma som i revisionsloggen). */
    const savedAt = (id: string) => rows("audit_log").filter((l) => l.action === "deviation.saved" && l.entityId === id).at(-1)!.occurredAt;
    expect(await run(deviationSave, { id: "dev-jan30", caseId: NADIA, data: { status: "closed" } }, amira())).toMatchObject({ ok: true });
    expect(row("deviations", "dev-jan30")).toMatchObject({ status: "closed", closedAt: savedAt("dev-jan30") });
    expect(row("deviations", "dev-jan30")!.closedAt!.startsWith("2027-02-01")).toBe(true);
    const areas = Object.fromEntries(BOTKYRKA_CONFIG.progression.areas.map((k) => [k, { level: 2 as const, observation: "Följer instruktionen.", nextStep: "Fortsätta." }]));
    expect(await run(assessmentSave, { caseId: NADIA, month: "2027-01", areas, summary: "Följer planen.", overallStatus: "green", approve: true }, amira())).toMatchObject({ ok: true });
    expect(await run(reportApprove, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: NADIA_JAN }, amira())).toMatchObject({ ok: true });
    const jan = csvRows((await exportCsv(johan(), "resultat", { contractId: "c-bot", from: "2027-01", to: "2027-01" })).content).find((r) => r.arendenummer === "BOT-26-0143")!;
    expect(jan).toMatchObject({ avvikelser_nya: "1", avvikelser_oppna: "1" });
    // Öppnas avvikelsen igen nollställs stängningstiden; en ny avvikelse som sparas som stängd får tiden direkt.
    expect(await run(deviationSave, { id: "dev-jan30", caseId: NADIA, data: { status: "open" } }, amira())).toMatchObject({ ok: true });
    expect(row("deviations", "dev-jan30")).toMatchObject({ status: "open", closedAt: null });
    const created = await run(deviationSave, { caseId: NADIA, data: { description: "Ny.", action: "Samtal.", status: "closed" } }, amira());
    if (!created.ok) throw new Error("ingen avvikelse");
    const t2 = savedAt(created.deviationId);
    expect(row("deviations", created.deviationId)).toMatchObject({ status: "closed", closedAt: t2 });
    // Att spara en redan stängd avvikelse igen ändrar inte stängningstiden.
    rt.clock.set("2027-02-02T08:00");
    expect(await run(deviationSave, { id: created.deviationId, caseId: NADIA, data: { action: "Samtal och plan.", status: "closed" } }, amira())).toMatchObject({ ok: true });
    expect(row("deviations", created.deviationId)!.closedAt).toBe(t2);
  });
});

describe("tabellen Avslut", () => {
  it("varje levererad slutrapport för en insats som avslutades i perioden – också utan månadsrapport för slutmånaden", async () => {
    const res = await exportCsv(johan(), "avslut", { contractId: "c-bot", from: "2026-10", to: "2026-12" });
    expect(res.filename).toBe("resultat_bot_hela-avtalet_2026-10_2026-12_avslut.csv");
    const got = csvRows(res.content);
    expect(res.content.startsWith("arendenummer;manad;avslut_datum;avslutsorsak_kod;avslutsorsak;resultat_kod;resultat;resultat_verifierat;rapport_version;rapport_levererad;rattelse_pagar\r\n")).toBe(true);
    const finals = rows("reports").filter((r) => r.kind === "final" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.periodEnd! >= "2026-10-01" && r.periodEnd! <= "2026-12-31");
    expect(got.map((r) => r.arendenummer).sort()).toEqual(finals.map((r) => row("cases", r.caseId!)!.caseNumber).sort());
    // Loggen: bara slutrapporternas id:n (filen har inga uppgifter ur månadsrapporterna).
    expect([...(exportLogs().at(-1)!.details.reportIds as string[])].sort()).toEqual(finals.map((r) => r.id).sort());
    expect(got.length).toBeGreaterThan(50);
    // Granskarens exempel: avslut utan månadsrapport för slutmånaden finns med.
    for (const no of ["BOT-26-0040", "BOT-26-0082"]) {
      const c = caseByNo(no);
      expect(rows("reports").some((r) => r.kind === "monthly" && r.caseId === c.id && r.month === c.endDate!.slice(0, 7))).toBe(false);
      expect(got.find((r) => r.arendenummer === no)).toMatchObject({ avslut_datum: c.endDate, avslutsorsak_kod: c.endReason, resultat_kod: c.resultClass });
    }
    expect(looksLikePnr(res.content)).toBe(false);
  });
});

describe("förhandsvisningen läser inte ögonblicksbilderna", () => {
  it("förhandsvisningen använder bara pick (inga hela rapportrader), exporten läser hela raderna för de valda rapporterna", async () => {
    const store = rt.store;
    const actor = johan();
    const repo = new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo;
    const fullReads: string[] = [];
    let seq = 0;
    const watched = {
      table: ((name: TableName) => {
        const t = repo.table(name as never) as unknown as Record<string, unknown>;
        if (name !== "reports") return t;
        return { ...t, list: async (...a: unknown[]) => { fullReads.push(JSON.stringify(a[0] ?? {})); return (t.list as (...x: unknown[]) => unknown)(...a); } };
      }) as unknown as AppRepo["table"],
    } as AppRepo;
    const ctx: Ctx = {
      actor, now: () => DEMO_START, repo: watched, system: new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
      newId: (p) => `${p}-x${++seq}`, audit: async () => undefined, notify: async () => undefined, crypto: TEST_PNR_CRYPTO,
    };
    const pre = (await execute("query", contractResultPreview.key, { from: "2026-09", to: "2027-01" }, ctx)) as { reports: number };
    expect(pre.reports).toBe(deliveredMonthly().length);
    expect(fullReads).toEqual([]);
    await execute("command", contractResultExport.key, { ...ALL, format: "csv", table: "resultat" }, ctx);
    // Exporten: en läsning av hela raderna, bara för de valda rapporternas id:n.
    expect(fullReads).toHaveLength(1);
    expect(fullReads[0]).toMatch(/^\{"id":\{"in":\[/);
  });
});

describe("kolumnspärren", () => {
  it("letar bakåt i loggen förbi många nyare hämtningar (flera sidor och samma minut) – utan att läsa hela loggen", async () => {
    expect((await run(contractResultExport, { ...ALL, format: "xlsx" }, johan())).ok).toBe(true);
    // Nyare hämtningar av händelsetabellen: tolv i samma minut (fler än en sida) och tolv i var sin minut. Den senaste raden
    // med kolumnerna för Resultat är Excel-filen, längst bak.
    rt.clock.set("2027-02-01T09:13");
    for (let i = 0; i < 12; i++) await exportCsv(johan(), "handelser");
    for (let i = 0; i < 12; i++) {
      rt.clock.set(`2027-02-01T09:${String(14 + i).padStart(2, "0")}`);
      await exportCsv(johan(), "handelser");
    }
    swapFirstAreas();
    expect(await run(contractResultExport, { ...ALL, format: "csv", table: "resultat" }, johan())).toMatchObject({ ok: false, error: "schema" });
    expect((await run(contractResultExport, { ...ALL, format: "csv", table: "handelser" }, johan())).ok).toBe(true);
  });

  it("samma minut: raden med kolumnerna kan hamna utanför den första sidan – hela minuten läses", async () => {
    for (let i = 0; i < 12; i++) await exportCsv(johan(), "handelser");
    // Excel-filen i samma minut, skriven sist (i Postgres är ordningen inom en minut efter id, alltså godtycklig).
    expect((await run(contractResultExport, { ...ALL, format: "xlsx" }, johan())).ok).toBe(true);
    expect(new Set(exportLogs().map((l) => l.occurredAt)).size).toBe(1);
    swapFirstAreas();
    expect(await run(contractResultExport, { ...ALL, format: "csv", table: "resultat" }, johan())).toMatchObject({ ok: false, error: "schema" });
  });

  it("ändrad ordning på progressionsområdena utan höjd schemaversion: ingen fil och en loggrad utan personuppgifter", async () => {
    expect((await run(contractResultExport, { ...ALL, format: "xlsx" }, johan())).ok).toBe(true);
    swapFirstAreas();
    const n = exportLogs().length;
    expect(await run(contractResultExport, { ...ALL, format: "xlsx" }, johan())).toMatchObject({
      ok: false, error: "schema", message: "Filen kan inte skapas, eftersom kolumnerna har ändrats sedan den förra filen lämnades ut. Kontakta den som ansvarar för Miljonmatch.",
    });
    expect(await run(contractResultExport, { ...ALL, format: "csv", table: "resultat" }, johan())).toMatchObject({ ok: false, error: "schema" });
    // Progressionstabellen har samma kolumner – den går fortfarande att hämta.
    expect((await run(contractResultExport, { ...ALL, format: "csv", table: "progression" }, johan())).ok).toBe(true);
    expect(exportLogs().length).toBe(n + 1);
    const blocked = rows("audit_log").filter((l) => l.action === "export.results_blocked");
    expect(blocked).toHaveLength(2);
    expect(blocked[0]).toMatchObject({ entity: "contract", entityId: "c-bot", contractId: "c-bot", details: { schema: 1, table: "resultat", reason: "columns_changed" } });
    expect(JSON.stringify(blocked)).not.toMatch(/BOT-\d|Nadia|Warsame|\d{6}-\d{4}/);
  });

  it("ett nytt område sist i areas hamnar före handelser – också stopp", async () => {
    expect((await exportCsv(johan())).rows).toBe(deliveredMonthly().length);
    setConfig((c) => {
      c.progression!.areas = [...c.progression!.areas, "halsa_funktionellt"];
      c.progression!.optionalAreas = ["livskvalitet_sjalvskattad"];
    });
    expect(await run(contractResultExport, { ...ALL, format: "csv", table: "resultat" }, johan())).toMatchObject({ ok: false, error: "schema" });
  });

  it("första filen låser listan – ingen tidigare loggrad, ingen spärr", async () => {
    swapFirstAreas();
    expect((await run(contractResultExport, { ...ALL, format: "xlsx" }, johan())).ok).toBe(true);
  });

  it("kommunens tidigare hämtningar (export.results, före 2026-10-07) låser också kolumnerna", async () => {
    // En loggrad från när kommunen hämtade filen själv: samma kolumner som MB:s fil i dag.
    const first = await exportCsv(johan());
    const columns = exportLogs()[0].details.columns as string[];
    rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
    rt.store.insertRow("audit_log", {
      id: "log-kommun-export", occurredAt: "2027-01-15T10:00", actorId: "k-maria", action: "export.results", entity: "contract", entityId: "c-bot", contractId: "c-bot",
      details: { from: "2026-09", to: "2026-12", format: "csv", table: "resultat", rows: 1, cases: 1, schema: 1, columns },
    });
    expect(first.ok).toBe(true);
    swapFirstAreas();
    expect(await run(contractResultExport, { ...ALL, format: "csv", table: "resultat" }, johan())).toMatchObject({ ok: false, error: "schema" });
  });
});

describe("revisionsloggen", () => {
  it("exakt en export.results_mb per hämtning, utan namn, ärendenummer eller personnummer", async () => {
    const total = deliveredMonthly().length;
    await exportCsv(johan());
    await exportCsv(johan(), "progression");
    const x = await run(contractResultExport, { ...ALL, format: "xlsx" }, johan());
    expect(x).toMatchObject({ ok: true, filename: "resultat_bot_hela-avtalet_2026-09_2027-01.xlsx", encoding: "base64", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (!x.ok) return;
    expect(String.fromCharCode(...base64ToBytes(x.content).slice(0, 2))).toBe("PK");
    const logs = exportLogs();
    expect(logs).toHaveLength(3);
    expect(logs.map((l) => l.details.table)).toEqual(["resultat", "progression", "alla"]);
    expect(logs[0]).toMatchObject({ actorId: "u-johan", entity: "contract", entityId: "c-bot", contractId: "c-bot", details: { from: "2026-09", to: "2027-01", format: "csv", rows: total, schema: 1 } });
    expect((logs[0].details.columns as string[])[0]).toBe("resultat.arendenummer");
    expect((logs[2].details.columns as string[]).some((c) => c.startsWith("handelser."))).toBe(true);
    expect((logs[0].details.reportIds as string[]).length).toBeGreaterThanOrEqual(total);
    // Progressionsfilen har bara månadsrapporternas uppgifter; Excel-filen alla rapporter i filen (också slutrapporterna).
    expect(logs[1].details.reportIds as string[]).toHaveLength(total);
    expect((logs[2].details.reportIds as string[]).length).toBeGreaterThan((logs[0].details.reportIds as string[]).length);
    const text = JSON.stringify(logs);
    expect(text).not.toMatch(/BOT-\d{2}-\d{4}/);
    for (const p of rows("persons").slice(0, 200)) expect(text).not.toContain(`${p.firstName} ${p.lastName}`);
    expect(looksLikePnr(text)).toBe(false);
    // Kommunens gamla loggåtgärd används inte längre.
    expect(rows("audit_log").filter((l) => l.action === "export.results")).toEqual([]);
  });

  it("kastar loggningen lämnas ingen fil ut", async () => {
    const store = rt.store;
    const actor = johan();
    const ctx: Ctx = {
      actor, now: () => DEMO_START, repo: new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo,
      system: new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
      newId: (p) => `${p}-x`, audit: async () => { throw new Error("loggen är inte tillgänglig"); }, notify: async () => undefined, crypto: TEST_PNR_CRYPTO,
    };
    await expect(execute("command", contractResultExport.key, { ...ALL, format: "csv", table: "resultat" }, ctx)).rejects.toThrow("loggen är inte tillgänglig");
  });

  it("admin ser loggposten som Exporterade resultat för hela avtalet med antal i tabellen och hela listan i detaljvyn", async () => {
    await exportCsv(johan());
    const log = await ask(adminAuditLog, {}, as("u-robin", "admin"));
    const r = log.rows.find((x) => x.action === "export.results_mb")!;
    expect(r.actionLabel).toBe("Exporterade resultat för hela avtalet");
    expect(r.detailText).toMatch(/^Från: september 2026 · Till: januari 2027 · Format: CSV · Tabell: resultat · Rader: \d+ · Antal deltagare: \d+ · Schemaversion: 1 · Kolumner: 62 kolumner · Rapporter: \d+ rapporter$/);
    // Hela listan skickas inte med i loggen – den hämtas när den visas.
    expect(r.hasFull).toBe(true);
    expect(JSON.stringify(r)).not.toContain("resultat.namn");
    const full = await ask(adminAuditDetail, { id: r.id }, as("u-robin", "admin"));
    expect(full.text).toContain("resultat.arendenummer, resultat.namn");
    expect(full.text).toMatch(/Rapporter: rep-/);
    // Kommunen och coachen når inte detaljen.
    await expect(ask(adminAuditDetail, { id: r.id }, as("k-maria", "kommun_handlaggare"))).rejects.toBeInstanceOf(ApiError);
    await expect(ask(adminAuditDetail, { id: r.id }, amira())).rejects.toBeInstanceOf(ApiError);
  });

  it("fältbeskrivningen loggas utan rapport-id:n (den innehåller inga uppgifter ur rapporterna)", async () => {
    const fd = await exportCsv(johan(), "faltbeskrivning");
    expect(fd.content.startsWith("tabell;kolumn;beskrivning;format;mojliga_varden;kalla;schemaversion")).toBe(true);
    const l = exportLogs().at(-1)!;
    expect(l.details).toMatchObject({ table: "faltbeskrivning", format: "csv" });
    expect(l.details).not.toHaveProperty("reportIds");
  });
});
