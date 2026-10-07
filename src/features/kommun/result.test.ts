// Kommunens resultatfil (rapporter steg 3, Del D): behörigheten (roll, avtal, enhet, skyddade personuppgifter), bara
// levererade rapporter, rättelser, frysningen, verifiering efter leveransen (sätt a), kolumnspärren och revisionsloggen.
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
import { caseClose } from "@/features/arenden/api";
import { assessmentSave, deviationSave, resultVerify } from "@/features/coach/api";
import { reportApprove, reportCorrect, reportDeliver, reportSaveFinal } from "@/features/rapporter/api";
import { adminAuditDetail, adminAuditLog } from "@/features/admin/api";
import { resultExport, resultExportPreview } from "./api";

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

const eva = () => as("k-eva", "kommun_chef");
const maria = () => as("k-maria", "kommun_handlaggare");
const amira = () => as("u-amira", "coach");
/** Testaktör: kommunens chef för en underenhet (Alby) – testdatat har bara en chef, för hela Arbetsmarknadsenheten. */
const albyChef = (): Actor => ({ userId: "k-chef-alby", role: "kommun_chef", contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" });
const ALL = { contractId: "c-bot", from: "2026-09", to: "2027-01" };
const PROT_CASE = "case-260120";
const NADIA = "case-260143";
const NADIA_JAN = "rep-16011";

/** Kör exporten och returnera filen (kastar om den inte lämnades ut). */
async function exportCsv(actor: Actor, table: "resultat" | "progression" | "handelser" | "avslut" | "faltbeskrivning" = "resultat", period = ALL) {
  const res = await run(resultExport, { ...period, format: "csv", table }, actor);
  if (!res.ok) throw new Error(`Ingen fil: ${res.error} ${res.message ?? ""}`);
  return res;
}
const csvRows = (content: string) => {
  const [head, ...lines] = content.trimEnd().split("\r\n");
  const keys = head.split(";");
  return lines.map((l) => Object.fromEntries(l.split(";").map((v, i) => [keys[i], v])));
};
const unitOf = (caseId: string) => {
  const c = row("cases", caseId)!;
  return (c.referrerId ? row("profiles", c.referrerId)?.customerUnit : null) ?? c.referrerUnit;
};
const caseByNo = (no: string) => rows("cases").find((c) => c.caseNumber === no)!;
const exportLogs = () => rows("audit_log").filter((l) => l.action === "export.results");
const setConfig = (patch: (c: ContractConfig) => void) => {
  const c = row("contracts", "c-bot")!;
  const cfg = JSON.parse(JSON.stringify(c.config)) as ContractConfig;
  patch(cfg);
  rt.store.updateRow("contracts", "c-bot", { config: cfg });
};

describe("kommunens chef får sin enhets icke skyddade ärenden", () => {
  it("k-eva (hela Arbetsmarknadsenheten): alla levererade månadsrapporter utom det skyddade ärendet – inga personnummer", async () => {
    const pre = await ask(resultExportPreview, { from: "2026-09", to: "2027-01" }, eva());
    expect(pre).toMatchObject({ allowed: true, contractId: "c-bot", from: "2026-09", to: "2027-01", periodError: null, maxMonths: 12, reports: 270, participants: 169 });
    expect(pre.months[0]).toEqual({ value: "2027-02", label: "februari 2027" });
    expect(pre.months.at(-1)).toEqual({ value: "2026-09", label: "september 2026" });
    const res = await exportCsv(eva());
    expect(res).toMatchObject({ filename: "resultat_bot_2026-09_2027-01.csv", mime: "text/csv;charset=utf-8", encoding: "text", rows: 270, cases: 169 });
    const delivered = rows("reports").filter((r) => r.kind === "monthly" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.caseId !== PROT_CASE);
    expect(csvRows(res.content)).toHaveLength(delivered.length);
    expect(res.content).not.toContain("BOT-26-0120");
    expect(res.content).not.toContain("Skyddade personuppgifter");
    expect(looksLikePnr(res.content)).toBe(false);
    expect(res.content.startsWith("arendenummer;namn;manad;")).toBe(true);
    expect(res.content.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("enhetsspärren: en chef för Alby får bara ärenden som beställts i Alby – samma antal i fil och förhandsvisning", async () => {
    const pre = await ask(resultExportPreview, { from: "2026-09", to: "2027-01" }, albyChef());
    const res = await exportCsv(albyChef());
    const got = csvRows(res.content);
    expect(got).toHaveLength(pre.reports);
    expect(new Set(got.map((r) => r.arendenummer)).size).toBe(pre.participants);
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThan(270);
    for (const r of got) expect(unitOf(caseByNo(r.arendenummer).id)).toBe("Arbetsmarknadsenheten Alby");
    const others = rows("cases").filter((c) => ["Arbetsmarknadsenheten Tumba", "Arbetsmarknadsenheten Hallunda–Fittja"].includes(unitOf(c.id) ?? "")).map((c) => c.caseNumber);
    expect(others.length).toBeGreaterThan(0);
    for (const no of others) expect(res.content).not.toContain(`${no};`);
    // Det skyddade ärendet beställdes i Alby (k-omar) – det kommer ändå aldrig med.
    expect(unitOf(PROT_CASE)).toBe("Arbetsmarknadsenheten Alby");
    expect(res.content).not.toContain("BOT-26-0120");
  });
});

describe("nekas", () => {
  it("kommunens handläggare, ekonom och MB-roller nekas av rollkontrollen", async () => {
    for (const a of [maria(), as("u-lars", "ekonom"), as("u-sara", "samordnare"), as("u-johan", "avtalsansvarig"), as("u-robin", "admin")]) {
      await expect(run(resultExport, { ...ALL, format: "xlsx" }, a)).rejects.toBeInstanceOf(ApiError);
      await expect(ask(resultExportPreview, {}, a)).rejects.toBeInstanceOf(ApiError);
    }
  });
  it("ett avtal utan individrapporter (seesIndividualReports: false) och ett annat avtal än chefens", async () => {
    expect(await run(resultExport, { ...ALL, contractId: "c-ny", format: "xlsx" }, eva())).toMatchObject({ ok: false, error: "forbidden", message: "Ert avtal har inte resultatfilen." });
    setConfig((c) => {
      c.customerVisibility!.seesIndividualReports = false;
    });
    expect(await run(resultExport, { ...ALL, format: "xlsx" }, eva())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await ask(resultExportPreview, {}, eva())).toMatchObject({ allowed: false, reports: 0 });
    expect(exportLogs()).toEqual([]);
  });
  it("perioden: fel ordning, mer än 12 månader, före avtalets start, efter innevarande månad", async () => {
    expect(await run(resultExport, { ...ALL, from: "2026-12", to: "2026-10", format: "csv" }, eva())).toMatchObject({ ok: false, error: "period", message: "Till-månaden kan inte vara före från-månaden." });
    expect(await run(resultExport, { ...ALL, from: "2026-08", to: "2026-10", format: "csv" }, eva())).toMatchObject({ ok: false, error: "period" });
    expect(await run(resultExport, { ...ALL, from: "2027-01", to: "2027-03", format: "csv" }, eva())).toMatchObject({ ok: false, error: "period" });
    rt.clock.set("2028-02-01T09:00");
    expect(await run(resultExport, { ...ALL, from: "2026-09", to: "2027-09", format: "csv" }, eva())).toMatchObject({ ok: false, error: "period", message: "Välj högst 12 månader." });
    expect((await ask(resultExportPreview, { from: "2026-12", to: "2026-10" }, eva())).periodError).toBe("Till-månaden kan inte vara före från-månaden.");
    expect(await run(resultExport, { ...ALL, from: "2027-02", to: "2027-02", format: "csv" }, eva())).toMatchObject({ ok: false, error: "empty" });
    expect(exportLogs()).toEqual([]);
  });
});

describe("bara levererade rapporter – och rättelser", () => {
  it("utkast och godkända men inte levererade månadsrapporter kommer inte med", async () => {
    const notDelivered = rows("reports").filter((r) => r.kind === "monthly" && !["delivered", "opened"].includes(r.status));
    expect(notDelivered.some((r) => r.status === "approved")).toBe(true);
    const res = await exportCsv(eva());
    const keys = new Set(csvRows(res.content).map((r) => `${r.arendenummer}|${r.manad}`));
    for (const r of notDelivered) expect(keys.has(`${row("cases", r.caseId!)!.caseNumber}|${r.month}`)).toBe(false);
  });

  it("rättelse av en rättelse som inte levererats (v1 → v2 godkänd → v3): exakt en rad per ärende och månad, version 3", async () => {
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
    const lines = csvRows((await exportCsv(eva())).content).filter((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2026-12");
    expect(lines).toEqual([expect.objectContaining({ rapport_version: "3", rattelse_pagar: "0" })]);
    const pre = await ask(resultExportPreview, { from: "2026-09", to: "2027-01" }, eva());
    expect(pre.reports).toBe(270);
  });

  it("två levererade versioner som inte ersatts (data före rättningen): bara den högsta versionen kommer med", async () => {
    const dec = row("reports", "rep-16008")!;
    rt.store.insertRow("reports", { ...dec, id: "rep-v3-gammal-data", version: 3, previousId: "rep-x", deliveredAt: "2027-01-20T10:00", snapshot: null });
    const err = console.error;
    const logged: unknown[][] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      const res = await exportCsv(eva());
      const lines = csvRows(res.content).filter((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2026-12");
      expect(lines).toEqual([expect.objectContaining({ rapport_version: "3" })]);
      expect(res.rows).toBe(270);
    } finally {
      console.error = err;
    }
    // Bara id:n i loggen (aldrig namn eller ärendenummer).
    expect(logged).toEqual([["resultatfil: äldre versioner var levererade och inte ersatta – bara den senaste kom med", ["rep-16008"]]]);
    expect((await ask(resultExportPreview, { from: "2026-09", to: "2027-01" }, eva())).reports).toBe(270);
  });

  it("rättelse pågår: den gamla versionen med rattelse_pagar = 1; rättelsen levererad: bara version 2", async () => {
    const dec = "rep-16008"; // NADIA december
    const cor = await run(reportCorrect, { reportId: dec }, amira());
    if (!cor.ok) throw new Error("ingen rättelse");
    const line = async () => csvRows((await exportCsv(eva())).content).filter((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2026-12");
    expect(await line()).toEqual([expect.objectContaining({ rapport_version: "1", rattelse_pagar: "1" })]);
    expect(await run(reportApprove, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(await run(reportDeliver, { reportId: cor.reportId }, amira())).toMatchObject({ ok: true });
    expect(await line()).toEqual([expect.objectContaining({ rapport_version: "2", rattelse_pagar: "0", rapport_levererad: "2027-02-01" })]);
  });
});

describe("frysningen", () => {
  it("rapporter utan ögonblicksbild fryses med fakta under exporten; en andra export ger samma innehåll", async () => {
    expect(rows("reports").filter((r) => r.snapshot).length).toBe(0);
    const a = await run(resultExport, { ...ALL, format: "xlsx" }, eva());
    if (!a.ok) throw new Error("ingen fil");
    const frozen = rows("reports").filter((r) => r.snapshot);
    expect(frozen.length).toBeGreaterThanOrEqual(270);
    for (const r of frozen) expect((r.snapshot as { facts?: { kind: string } }).facts?.kind).toBe(r.kind);
    rt.clock.set("2027-02-01T11:00");
    const b = await run(resultExport, { ...ALL, format: "xlsx" }, eva());
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
    console.info(`resultatfil hela testdatat (september 2026 – januari 2027, ${a.rows} rader i alla flikar, ${a.cases} deltagare): base64 ${a.content.length} byte, xlsx ${base64ToBytes(a.content).length} byte`);
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
    const jan = async () => csvRows((await exportCsv(eva())).content).find((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2027-01")!;
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
    const jan = csvRows((await exportCsv(eva(), "resultat", { contractId: "c-bot", from: "2027-01", to: "2027-01" })).content).find((r) => r.arendenummer === "BOT-26-0143")!;
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
    const res = await exportCsv(eva(), "avslut", { contractId: "c-bot", from: "2026-10", to: "2026-12" });
    expect(res.filename).toBe("resultat_bot_2026-10_2026-12_avslut.csv");
    const got = csvRows(res.content);
    expect(res.content.startsWith("arendenummer;manad;avslut_datum;avslutsorsak_kod;avslutsorsak;resultat_kod;resultat;resultat_verifierat;rapport_version;rapport_levererad;rattelse_pagar\r\n")).toBe(true);
    const finals = rows("reports").filter((r) => r.kind === "final" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.caseId !== PROT_CASE && r.periodEnd! >= "2026-10-01" && r.periodEnd! <= "2026-12-31");
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
    expect(res.content).not.toContain("BOT-26-0120");
    expect(looksLikePnr(res.content)).toBe(false);
    // Alby-chefen får bara Albys avslut.
    const alby = csvRows((await exportCsv(albyChef(), "avslut", { contractId: "c-bot", from: "2026-10", to: "2026-12" })).content);
    expect(alby.length).toBeGreaterThan(0);
    expect(alby.length).toBeLessThan(got.length);
    for (const r of alby) expect(unitOf(caseByNo(r.arendenummer).id)).toBe("Arbetsmarknadsenheten Alby");
  });
});

describe("förhandsvisningen läser inte ögonblicksbilderna", () => {
  it("förhandsvisningen använder bara pick (inga hela rapportrader), exporten läser hela raderna för de valda rapporterna", async () => {
    const store = rt.store;
    const actor = eva();
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
    const pre = (await execute("query", resultExportPreview.key, { from: "2026-09", to: "2027-01" }, ctx)) as { reports: number };
    expect(pre.reports).toBe(270);
    expect(fullReads).toEqual([]);
    await execute("command", resultExport.key, { ...ALL, format: "csv", table: "resultat" }, ctx);
    // Exporten: en läsning av hela raderna, bara för de valda rapporternas id:n.
    expect(fullReads).toHaveLength(1);
    expect(fullReads[0]).toMatch(/^\{"id":\{"in":\[/);
  });
});

describe("kolumnspärren", () => {
  it("letar bakåt i loggen förbi många nyare hämtningar (flera sidor och samma minut) – utan att läsa hela loggen", async () => {
    expect((await run(resultExport, { ...ALL, format: "xlsx" }, eva())).ok).toBe(true);
    // Nyare hämtningar av händelsetabellen: tolv i samma minut (fler än en sida) och tolv i var sin minut. Den senaste raden
    // med kolumnerna för Resultat är Excel-filen, längst bak.
    rt.clock.set("2027-02-01T09:13");
    for (let i = 0; i < 12; i++) await exportCsv(eva(), "handelser");
    for (let i = 0; i < 12; i++) {
      rt.clock.set(`2027-02-01T09:${String(14 + i).padStart(2, "0")}`);
      await exportCsv(eva(), "handelser");
    }
    setConfig((c) => {
      const a = c.progression!.areas;
      [a[0], a[1]] = [a[1], a[0]];
    });
    expect(await run(resultExport, { ...ALL, format: "csv", table: "resultat" }, eva())).toMatchObject({ ok: false, error: "schema" });
    expect((await run(resultExport, { ...ALL, format: "csv", table: "handelser" }, eva())).ok).toBe(true);
  });

  it("samma minut: raden med kolumnerna kan hamna utanför den första sidan – hela minuten läses", async () => {
    for (let i = 0; i < 12; i++) await exportCsv(eva(), "handelser");
    // Excel-filen i samma minut, skriven sist (i Postgres är ordningen inom en minut efter id, alltså godtycklig).
    expect((await run(resultExport, { ...ALL, format: "xlsx" }, eva())).ok).toBe(true);
    expect(new Set(exportLogs().map((l) => l.occurredAt)).size).toBe(1);
    setConfig((c) => {
      const a = c.progression!.areas;
      [a[0], a[1]] = [a[1], a[0]];
    });
    expect(await run(resultExport, { ...ALL, format: "csv", table: "resultat" }, eva())).toMatchObject({ ok: false, error: "schema" });
  });

  it("ändrad ordning på progressionsområdena utan höjd schemaversion: ingen fil och en loggrad utan personuppgifter", async () => {
    expect((await run(resultExport, { ...ALL, format: "xlsx" }, eva())).ok).toBe(true);
    setConfig((c) => {
      const a = c.progression!.areas;
      [a[0], a[1]] = [a[1], a[0]];
    });
    const n = exportLogs().length;
    expect(await run(resultExport, { ...ALL, format: "xlsx" }, eva())).toMatchObject({ ok: false, error: "schema", message: "Filen kan inte skapas just nu. Kontakta Miljonbemanning." });
    expect(await run(resultExport, { ...ALL, format: "csv", table: "resultat" }, eva())).toMatchObject({ ok: false, error: "schema" });
    // Progressionstabellen har samma kolumner – den går fortfarande att hämta.
    expect((await run(resultExport, { ...ALL, format: "csv", table: "progression" }, eva())).ok).toBe(true);
    expect(exportLogs().length).toBe(n + 1);
    const blocked = rows("audit_log").filter((l) => l.action === "export.results_blocked");
    expect(blocked).toHaveLength(2);
    expect(blocked[0]).toMatchObject({ entity: "contract", entityId: "c-bot", contractId: "c-bot", details: { schema: 1, table: "resultat", reason: "columns_changed" } });
    expect(JSON.stringify(blocked)).not.toMatch(/BOT-\d|Nadia|Warsame|\d{6}-\d{4}/);
  });
  it("ett nytt område sist i areas hamnar före handelser – också stopp", async () => {
    expect((await exportCsv(eva())).rows).toBe(270);
    setConfig((c) => {
      c.progression!.areas = [...c.progression!.areas, "halsa_funktionellt"];
      c.progression!.optionalAreas = ["livskvalitet_sjalvskattad"];
    });
    expect(await run(resultExport, { ...ALL, format: "csv", table: "resultat" }, eva())).toMatchObject({ ok: false, error: "schema" });
  });
  it("första filen låser listan – ingen tidigare loggrad, ingen spärr", async () => {
    setConfig((c) => {
      const a = c.progression!.areas;
      [a[0], a[1]] = [a[1], a[0]];
    });
    expect((await run(resultExport, { ...ALL, format: "xlsx" }, eva())).ok).toBe(true);
  });
});

describe("revisionsloggen", () => {
  it("exakt en export.results per hämtning, utan namn, ärendenummer eller personnummer", async () => {
    await exportCsv(eva());
    await exportCsv(eva(), "progression");
    const x = await run(resultExport, { ...ALL, format: "xlsx" }, eva());
    expect(x).toMatchObject({ ok: true, filename: "resultat_bot_2026-09_2027-01.xlsx", encoding: "base64", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (!x.ok) return;
    expect(String.fromCharCode(...base64ToBytes(x.content).slice(0, 2))).toBe("PK");
    const logs = exportLogs();
    expect(logs).toHaveLength(3);
    expect(logs.map((l) => l.details.table)).toEqual(["resultat", "progression", "alla"]);
    expect(logs[0]).toMatchObject({ actorId: "k-eva", entity: "contract", entityId: "c-bot", contractId: "c-bot", details: { from: "2026-09", to: "2027-01", format: "csv", rows: 270, cases: 169, schema: 1 } });
    expect((logs[0].details.columns as string[])[0]).toBe("resultat.arendenummer");
    expect((logs[2].details.columns as string[]).some((c) => c.startsWith("handelser."))).toBe(true);
    expect((logs[0].details.reportIds as string[]).length).toBeGreaterThanOrEqual(270);
    // Progressionsfilen har bara månadsrapporternas uppgifter; Excel-filen alla rapporter i filen (också slutrapporterna).
    expect(logs[1].details.reportIds as string[]).toHaveLength(270);
    expect((logs[2].details.reportIds as string[]).length).toBeGreaterThan((logs[0].details.reportIds as string[]).length);
    const text = JSON.stringify(logs);
    expect(text).not.toMatch(/BOT-\d{2}-\d{4}/);
    for (const p of rows("persons").slice(0, 200)) expect(text).not.toContain(`${p.firstName} ${p.lastName}`);
    expect(looksLikePnr(text)).toBe(false);
  });

  it("kastar loggningen lämnas ingen fil ut", async () => {
    const store = rt.store;
    const actor = eva();
    const ctx: Ctx = {
      actor, now: () => DEMO_START, repo: new MemoryRepo<Tables>(store, actor, POLICIES) as unknown as AppRepo,
      system: new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
      newId: (p) => `${p}-x`, audit: async () => { throw new Error("loggen är inte tillgänglig"); }, notify: async () => undefined, crypto: TEST_PNR_CRYPTO,
    };
    await expect(execute("command", resultExport.key, { ...ALL, format: "csv", table: "resultat" }, ctx)).rejects.toThrow("loggen är inte tillgänglig");
  });

  it("admin ser loggposten som Exporterade resultat med antal i tabellen och hela listan i detaljvyn", async () => {
    await exportCsv(eva());
    const log = await ask(adminAuditLog, {}, as("u-robin", "admin"));
    const r = log.rows.find((x) => x.action === "export.results")!;
    expect(r.actionLabel).toBe("Exporterade resultat");
    expect(r.detailText).toMatch(/^Från: september 2026 · Till: januari 2027 · Format: CSV · Tabell: resultat · Rader: 270 · Antal deltagare: 169 · Schemaversion: 1 · Kolumner: 62 kolumner · Rapporter: \d+ rapporter$/);
    // Hela listan skickas inte med i loggen – den hämtas när den visas.
    expect(r.hasFull).toBe(true);
    expect(JSON.stringify(r)).not.toContain("resultat.namn");
    const full = await ask(adminAuditDetail, { id: r.id }, as("u-robin", "admin"));
    expect(full.text).toContain("resultat.arendenummer, resultat.namn");
    expect(full.text).toMatch(/Rapporter: rep-/);
    expect(log.exports).toBeGreaterThanOrEqual(1);
    // Kommunen och coachen når inte detaljen.
    await expect(ask(adminAuditDetail, { id: r.id }, eva())).rejects.toBeInstanceOf(ApiError);
    await expect(ask(adminAuditDetail, { id: r.id }, amira())).rejects.toBeInstanceOf(ApiError);
    expect(await ask(adminAuditDetail, { id: "log-finns-inte" }, as("u-robin", "admin"))).toEqual({ text: null });
  });

  it("fältbeskrivningen loggas utan rapport-id:n (den innehåller inga uppgifter ur rapporterna)", async () => {
    const fd = await exportCsv(eva(), "faltbeskrivning");
    expect(fd.content.startsWith("tabell;kolumn;beskrivning;format;mojliga_varden;kalla;schemaversion")).toBe(true);
    const l = exportLogs().at(-1)!;
    expect(l.details).toMatchObject({ table: "faltbeskrivning", format: "csv" });
    expect(l.details).not.toHaveProperty("reportIds");
  });
});
