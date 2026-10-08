// Kärnan i kommunens resultatfil (rapporter steg 3, Del B och C): raderna i tabellerna Resultat, Progression, Händelser och
// Avslut byggda av de frysta fakta i testdatats levererade rapporter, och filerna (CSV och Excel) – inklusive storleken för
// 2 000 rader.
import { describe, expect, it } from "vitest";
import { requireOperational } from "@/core/config";
import { base64ToBytes, bytesToBase64 } from "@/core/export/base64";
import { entryText, readZip } from "@/core/export/read-zip.test-helper";
import { END_REASON_LABEL, RESULT_CLASS_LABEL } from "@/core/labels";
import { looksLikePnr } from "@/core/validation";
import { createSeed, TEST_PNR_CRYPTO } from "@/data/seed";
import { ACTIVITY_TYPES } from "@/data/seed/constants";
import { emptyDb, type Db, type Report } from "@/data/schema";
import {
  buildResultExport, latestVersions, monthsInPeriod, periodError, periodLabel, resultCsv, resultFilename, resultXlsx, type ExportFinal, type ExportMonthly, type ResultExportInput,
} from "./export";
import type { FinalFacts, MonthlyFacts } from "./facts";
import { frozenFacts, type ReportEnv } from "./model";
import { isDelivered } from "./report-helpers";

const db = { ...emptyDb(), ...(createSeed() as unknown as Partial<Db>) } as Db;
// Skyddade personuppgifter är vilande sedan 2026-10-07 och testdatat har inga – spärren slås på för ärendet "skyddad" så att
// urvalet utan skyddade ärenden (selection.ts) prövas som förut: 270 rader.
const SKYDDAD_CASE = db.cases.find((c) => c.id === db.demo_tags.find((t) => t.tag === "skyddad")!.entityIds[0])!;
db.persons.find((p) => p.id === SKYDDAD_CASE.personId)!.protectedIdentity = true;
const contract = db.contracts.find((c) => c.id === "c-bot")!;
const cfg = requireOperational(contract.config);
const env: ReportEnv = { cfg, contract: { id: contract.id, startsOn: contract.startsOn, supplierName: "Miljonbemanning AB" }, now: "2027-02-01T09:12", activityTypes: ACTIVITY_TYPES };
const areas = db.contract_areas.filter((a) => a.contractId === "c-bot");
const prot = new Set(db.persons.filter((p) => p.protectedIdentity).map((p) => p.id));
const caseOf = (id: string | null) => db.cases.find((c) => c.id === id)!;
const nameOf = (caseId: string) => {
  const p = db.persons.find((x) => x.id === caseOf(caseId).personId)!;
  return `${p.firstName} ${p.lastName}`;
};
const ok = (r: Report) => isDelivered(r) && !r.superseded && !prot.has(caseOf(r.caseId).personId);
const monthlyReports = db.reports.filter((r) => r.kind === "monthly" && ok(r));
const finalReports = db.reports.filter((r) => r.kind === "final" && ok(r));
const monthly: ExportMonthly[] = monthlyReports.map((r) => ({ report: r, correctionPending: false, facts: frozenFacts(db, r, env) as MonthlyFacts }));
const finals: ExportFinal[] = finalReports.map((r) => ({ report: r, correctionPending: false, facts: frozenFacts(db, r, env) as FinalFacts }));
const names = new Map(db.cases.map((c) => [c.id, nameOf(c.id)]));
const input = (over: Partial<ResultExportInput> = {}): ResultExportInput => ({ cfg, areas, monthly, finals, names, from: "2026-09", to: "2027-01", now: "2027-02-01T09:12", ...over });

describe("buildResultExport", () => {
  const exp = buildResultExport(input());
  const R = exp.tables.resultat;

  it("en rad per levererad månadsrapport, sorterad på ärendenummer och månad", () => {
    expect(R).toHaveLength(270);
    expect(exp.meta.rows).toEqual({ resultat: 270, progression: exp.tables.progression.length, handelser: exp.tables.handelser.length, avslut: exp.tables.avslut.length });
    const keys = R.map((r) => `${r.arendenummer}|${r.manad}`);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
    expect(exp.meta.cases).toBe(new Set(R.map((r) => r.arendenummer)).size);
  });

  it("tom cell vs 0: ingen cell är '–' eller 'Framgår inte'; sanningsvärden är 1/0", () => {
    for (const t of Object.values(exp.tables)) for (const row of t) for (const v of Object.values(row)) expect(["–", "Framgår inte", ""]).not.toContain(v);
    for (const r of R) {
      for (const k of ["rattelse_pagar", "upprepad_franvaro", "bedomning_godkand", "praktik_startad", "arbete_paborjat", "studier_paborjade", "kommunens_beslut_behovs"]) expect([0, 1]).toContain(r[k]);
      expect(typeof r.veckor).toBe("number");
      expect(r.tillfallen_planerade).toBe((r.narvarande as number) + (r.sen_ankomst as number) + (r.franvaro_giltig as number) + (r.franvaro_ogiltig as number) + (r.ej_registrerade as number));
      const reg = (r.tillfallen_planerade as number) - (r.ej_registrerade as number);
      expect(r.narvaro_procent).toBe(reg ? Math.round((((r.narvarande as number) + (r.sen_ankomst as number)) / reg) * 1000) / 10 : null);
    }
  });

  it("progressionen: tom när bedömningen inte är godkänd; flaggorna enligt gränserna och bara de obligatoriska områdena", () => {
    const niva = cfg.progression.areas.map((k) => `niva_${k}`);
    for (const r of R) {
      if (r.bedomning_godkand === 0) {
        for (const k of ["omraden_bedomda", "progression_tydlig", "progression_nagon", "samlad_status_kod", "samlad_status", "bedomning_datum", ...niva]) expect(r[k]).toBeNull();
        continue;
      }
      const levels = niva.map((k) => r[k]).filter((v): v is number => typeof v === "number");
      expect(r.omraden_bedomda).toBe(levels.length);
      expect(r.progression_tydlig).toBe(levels.some((v) => v >= cfg.progression.clearFromLevel) ? 1 : 0);
      expect(r.progression_nagon).toBe(levels.some((v) => v >= cfg.progression.anyFromLevel) ? 1 : 0);
      expect(r.samlad_status).toBe({ green: "Grön", yellow: "Gul", red: "Röd" }[r.samlad_status_kod as "green"]);
    }
    // Alla levererade rapporter i testdatat har godkänd bedömning – pröva en som inte har det.
    const m0 = monthly[0];
    const notApproved = buildResultExport(input({ monthly: [{ ...m0, facts: { ...m0.facts, assessmentApproved: false, levels: {}, areasAssessed: null, progressionClear: null, progressionAny: null, overallStatus: null, assessmentDate: null } }] }));
    const r0 = notApproved.tables.resultat[0];
    expect(r0.bedomning_godkand).toBe(0);
    for (const k of ["omraden_bedomda", "progression_tydlig", "progression_nagon", "samlad_status_kod", "samlad_status", "bedomning_datum", ...niva]) expect(r0[k]).toBeNull();
    expect(notApproved.tables.progression).toEqual([]);
    expect(Object.keys(R[0]).some((k) => /halsa|livskvalitet/.test(k))).toBe(false);
    // Progressionstabellen: en rad per obligatoriskt område och godkänd månad
    expect(exp.tables.progression).toHaveLength(R.filter((r) => r.bedomning_godkand === 1).length * cfg.progression.areas.length);
    expect(new Set(exp.tables.progression.map((p) => p.omrade_kod))).toEqual(new Set(cfg.progression.areas));
    const p = exp.tables.progression.find((x) => x.niva === 2)!;
    expect(p.niva_text).toBe("Tydlig");
  });

  it("avtalsområdet utan bokstaven, fasen utan förkortning, resultatet med RESULT_CLASS_LABEL", () => {
    for (const r of R) {
      if (r.avtalsomrade_kod) expect(r.avtalsomrade).toBe(areas.find((a) => a.code === r.avtalsomrade_kod)!.name);
      expect(String(r.avtalsomrade ?? "")).not.toMatch(/^[A-L] /);
      expect(String(r.fas ?? "")).not.toContain("/APL");
    }
    expect(R.some((r) => r.fas === "Praktik (arbetsplatsförlagt lärande)")).toBe(true);
    const closing = R.filter((r) => r.avslut_datum);
    expect(closing.length).toBeGreaterThan(0);
    for (const r of closing) {
      expect(r.resultat).toBe(RESULT_CLASS_LABEL[r.resultat_kod as "result"]);
      expect(r.avslutsorsak).toBe(END_REASON_LABEL[r.avslutsorsak_kod as "arbete"]);
      expect([0, 1]).toContain(r.resultat_verifierat);
    }
  });

  it("avslutet står bara på raden för slutmånaden – övriga rader är tomma", () => {
    const finalsByNo = new Map(finals.map((f) => [f.facts.caseNumber, f.facts]));
    for (const r of R) {
      const f = finalsByNo.get(r.arendenummer as string);
      const end = f?.endDate && f.endDate.slice(0, 7) === r.manad;
      for (const k of ["avslut_datum", "avslutsorsak_kod", "avslutsorsak", "resultat_kod", "resultat", "resultat_verifierat"]) {
        if (end) expect(r[k]).not.toBeNull();
        else expect(r[k]).toBeNull();
      }
    }
    // Många slutmånader saknar levererad månadsrapport (insatsen slutar tidigt i månaden) – de avsluten finns bara i tabellen Avslut.
    const withRow = new Set(R.filter((r) => r.avslut_datum).map((r) => r.arendenummer));
    expect(finals.filter((f) => f.facts.endDate && f.facts.endDate <= "2027-01-31" && !withRow.has(f.facts.caseNumber)).length).toBeGreaterThan(30);
  });

  it("tabellen Avslut: varje levererad slutrapport för en insats som avslutades i perioden – också utan månadsrapport för slutmånaden", () => {
    const A = exp.tables.avslut;
    const inPeriod = finals.filter((f) => f.facts.endDate && f.facts.endDate >= "2026-09-01" && f.facts.endDate <= "2027-01-31");
    expect(A).toHaveLength(inPeriod.length);
    expect(A.length).toBeGreaterThan(100);
    expect(A.map((r) => r.arendenummer)).toEqual(inPeriod.map((f) => f.facts.caseNumber).sort());
    for (const r of A) {
      const f = inPeriod.find((x) => x.facts.caseNumber === r.arendenummer)!;
      expect(r).toEqual({
        arendenummer: f.facts.caseNumber, manad: f.facts.endDate!.slice(0, 7), avslut_datum: f.facts.endDate, avslutsorsak_kod: f.facts.endReason,
        avslutsorsak: f.facts.endReason ? END_REASON_LABEL[f.facts.endReason] : null, resultat_kod: f.facts.resultClass,
        resultat: f.facts.resultClass ? RESULT_CLASS_LABEL[f.facts.resultClass] : null, resultat_verifierat: f.facts.resultVerified ? 1 : 0,
        rapport_version: f.report.version, rapport_levererad: f.report.deliveredAt!.slice(0, 10), rattelse_pagar: 0,
      });
      // Samma avslut som på raden för slutmånaden i tabell 1, när den raden finns.
      const row = R.find((x) => x.arendenummer === r.arendenummer && x.manad === r.manad);
      if (row) for (const k of ["avslut_datum", "avslutsorsak_kod", "avslutsorsak", "resultat_kod", "resultat", "resultat_verifierat"]) expect(row[k]).toEqual(r[k]);
    }
    // Avslut utan rad i tabell 1 (slutmånaden saknar levererad månadsrapport) finns med – bland dem avslut till arbete.
    const noRow = A.filter((r) => !R.some((x) => x.arendenummer === r.arendenummer && x.manad === r.manad));
    expect(noRow.length).toBeGreaterThan(30);
    expect(noRow.some((r) => r.resultat_kod === "result")).toBe(true);
    // Rapport-id:na i loggen: månadsrapporterna och slutrapporterna i tabellen Avslut – och per tabell (en CSV-fil).
    expect(exp.meta.reportIds.filter((id) => finalReports.some((r) => r.id === id)).sort()).toEqual(inPeriod.map((f) => f.report.id).sort());
    const monthlyIds = monthly.map((m) => m.report.id).sort();
    expect([...exp.meta.tableReportIds.avslut].sort()).toEqual(inPeriod.map((f) => f.report.id).sort());
    expect([...exp.meta.tableReportIds.progression].sort()).toEqual(monthlyIds);
    expect([...exp.meta.tableReportIds.handelser].sort()).toEqual(monthlyIds);
    const onRowIds = finals.filter((f) => R.some((x) => x.arendenummer === f.facts.caseNumber && x.avslut_datum != null)).map((f) => f.report.id);
    expect([...exp.meta.tableReportIds.resultat].sort()).toEqual([...monthlyIds, ...onRowIds].sort());
    // Perioden: bara avslut i perioden. Inget namn i tabellen.
    const dec = buildResultExport(input({ from: "2026-12", to: "2026-12" }));
    expect(new Set(dec.tables.avslut.map((r) => r.manad))).toEqual(new Set(["2026-12"]));
    expect(Object.keys(A[0])).not.toContain("namn");
  });

  it("bara den senaste versionen: två levererade versioner av samma rapport ger en rad (den högsta versionen)", () => {
    const m = monthly.find((x) => x.report.caseId === "case-260143" && x.facts.month === "2026-12")!;
    const old = { ...m, report: { ...m.report, id: "rep-gammal", version: 1 }, facts: { ...m.facts, attendance: { ...m.facts.attendance, present: 0 } } };
    const v3 = { ...m, report: { ...m.report, id: "rep-v3", version: 3 } };
    const e = buildResultExport(input({ monthly: [old, ...monthly.filter((x) => x !== m), v3] }));
    const rows = e.tables.resultat.filter((r) => r.arendenummer === "BOT-26-0143" && r.manad === "2026-12");
    expect(rows).toHaveLength(1);
    expect(rows[0].rapport_version).toBe(3);
    expect(e.meta.reportIds).toContain("rep-v3");
    expect(e.meta.reportIds).not.toContain("rep-gammal");
    // Slutrapporten: den högsta versionen vinner oavsett ordningen i listan.
    const f = finals.find((x) => x.facts.endDate && x.facts.endDate >= "2026-10-01")!;
    const f2 = { ...f, report: { ...f.report, id: "rep-f2", version: 2 }, facts: { ...f.facts, resultVerified: true } };
    for (const order of [[f2, f], [f, f2]]) {
      const x = buildResultExport(input({ finals: [...finals.filter((y) => y !== f), ...order] }));
      expect(x.tables.avslut.filter((r) => r.arendenummer === f.facts.caseNumber)).toEqual([expect.objectContaining({ rapport_version: 2, resultat_verifierat: 1 })]);
    }
    // latestVersions (urvalet i hanteraren): per ärende, typ och månad – slutrapporten per ärende.
    const r = (id: string, kind: "monthly" | "final", version: number, month: string | null = "2026-12") => ({ id, caseId: "c1", kind, month, version });
    const lv = latestVersions([r("a", "monthly", 1), r("b", "monthly", 3), r("c", "monthly", 1, "2026-11"), r("d", "final", 1, null), r("e", "final", 2, null)]);
    expect(lv.kept.map((x) => x.id)).toEqual(["b", "c", "e"]);
    expect(lv.dropped.map((x) => x.id).sort()).toEqual(["a", "d"]);
  });

  it("rattelse_pagar följer indata; namnet bara i tabellen Resultat", () => {
    const e = buildResultExport(input({ monthly: monthly.map((m, i) => ({ ...m, correctionPending: i === 0 })), finals: finals.map((f, i) => ({ ...f, correctionPending: i === 0 })) }));
    expect(e.tables.resultat.filter((r) => r.rattelse_pagar === 1)).toHaveLength(1);
    expect(e.tables.avslut.filter((r) => r.rattelse_pagar === 1)).toHaveLength(finals[0].facts.endDate! <= "2027-01-31" ? 1 : 0);
    expect(Object.keys(e.tables.progression[0])).not.toContain("namn");
    expect(Object.keys(e.tables.handelser[0])).not.toContain("namn");
    expect(Object.keys(e.tables.avslut[0])).not.toContain("namn");
  });

  it("ingen fritext, inga frånvaroorsaker, inga personnummer och inga skyddade ärenden i filen", async () => {
    // Datatabellerna (fältbeskrivningen och fliken Om filen har fasta texter, t.ex. "Upprepad ogiltig frånvaro enligt avtalets regel").
    const csv = (["resultat", "progression", "handelser", "avslut"] as const).map((t) => resultCsv(exp, t)).join("\n");
    const xlsx = await readZip(await resultXlsx(exp, cfg, { contractNumber: contract.contractNumber, customerName: "Botkyrka kommun" }));
    const xml = [1, 2, 3, 4].map((n) => entryText(xlsx, `xl/worksheets/sheet${n}.xml`)).join("\n");
    const all = xlsx.map((e) => new TextDecoder().decode(e.data)).join("\n") + resultCsv(exp, "faltbeskrivning");
    expect(all).not.toContain("Skyddade personuppgifter");
    expect(all).not.toContain("BOT-26-0120");
    // Fritext: ingen cell i datatabellerna är (eller innehåller) testdatats observationer, sammanfattningar, avvikelsetexter,
    // händelsernas anteckningar och aktörer eller planens mål. (Kort fritext som "Anställningsintervju" kan råka vara en del av
    // en fast etikett – därför jämförs hela celler, och längre texter även som delsträng.)
    const cells = Object.values(exp.tables).flatMap((t) => t.flatMap((row) => Object.values(row))).filter((v): v is string => typeof v === "string");
    const cellSet = new Set(cells);
    const free = [
      ...db.monthly_assessments.flatMap((m) => [m.summary, ...Object.values(m.areas).flatMap((a) => [a.observation, a.nextStep])]),
      ...db.deviations.flatMap((d) => [d.description, d.action, d.assessment]),
      ...db.outcome_events.flatMap((e) => [e.note, e.actor, e.verificationKind]),
      ...db.monthly_plans.flatMap((p) => [p.goal1, p.goal2, p.plannedActivities]),
      ...db.check_ins.flatMap((c) => [c.note, ...c.obstacles]),
    ].filter((t): t is string => !!t && t.trim().length > 3);
    const long = [...new Set(free)].filter((t) => t.length > 25);
    const offenders = [...new Set(free)].filter((t) => cellSet.has(t));
    const joined = cells.join("\u0001");
    for (const t of long) if (joined.includes(t)) offenders.push(t);
    expect(offenders).toEqual([]);
    expect(free.length).toBeGreaterThan(500);
    for (const text of [csv, xml]) {
      for (const reason of ["Sjukdom", "Vård av barn", "Myndighetsbesök"]) expect(text).not.toContain(reason);
      expect(text).not.toContain("Skyddade personuppgifter");
      expect(text).not.toContain("BOT-26-0120");
      expect(looksLikePnr(text)).toBe(false);
      for (const p of db.persons) if (p.personnummerEnc) expect(text).not.toContain(TEST_PNR_CRYPTO.decryptPnr(p.personnummerEnc).replace(/\D/g, "").slice(-10));
    }
  });

  it("rollneutral: hela avtalet ger samma rader som en chef vars enhet täcker allt (samma rapporter in)", () => {
    const whole = buildResultExport(input());
    expect(whole.tables).toEqual(exp.tables);
    // Perioden: bara rapporter i perioden
    const dec = buildResultExport(input({ from: "2026-12", to: "2026-12" }));
    expect(new Set(dec.tables.resultat.map((r) => r.manad))).toEqual(new Set(["2026-12"]));
  });

  it("ett dolt eller saknat namn är ett programfel", () => {
    const m = monthly[0];
    expect(() => buildResultExport(input({ names: new Map([[m.report.caseId!, "Skyddade personuppgifter"]]) }))).toThrow();
    expect(() => buildResultExport(input({ names: new Map() }))).toThrow();
  });
});

describe("filerna", () => {
  const exp = buildResultExport(input({ from: "2026-10", to: "2026-12" }));
  it("filnamn utan personuppgifter", () => {
    expect(resultFilename("BOT", "2026-10", "2026-12", "xlsx")).toBe("resultat_bot_2026-10_2026-12.xlsx");
    expect(resultFilename("BOT", "2026-10", "2026-12", "csv")).toBe("resultat_bot_2026-10_2026-12.csv");
    expect(resultFilename("BOT", "2026-10", "2026-12", "csv", "progression")).toBe("resultat_bot_2026-10_2026-12_progression.csv");
    expect(resultFilename("BOT", "2026-10", "2026-12", "csv", "handelser")).toBe("resultat_bot_2026-10_2026-12_handelser.csv");
    expect(resultFilename("BOT", "2026-10", "2026-12", "csv", "avslut")).toBe("resultat_bot_2026-10_2026-12_avslut.csv");
    expect(resultFilename("BOT", "2026-10", "2026-12", "csv", "faltbeskrivning")).toBe("resultat_bot_2026-10_2026-12_faltbeskrivning.csv");
    expect(periodLabel("2026-10", "2026-12")).toBe("oktober 2026 – december 2026");
  });
  it("CSV: rubrikraden och decimalkomma", () => {
    const csv = resultCsv(exp, "resultat");
    expect(csv.startsWith("arendenummer;namn;manad;bestallare_enhet;")).toBe(true);
    expect(csv.split("\r\n")[0]).toMatch(/^[a-z0-9_;]+$/);
    expect(csv).toMatch(/;\d{1,3},\d;/);
    expect(csv).not.toMatch(/;\d{1,3}\.\d;/);
  });
  it("Excel: fem flikar, rubrikraden låst, rätt antal rader och fliken Om filen", async () => {
    const es = await readZip(await resultXlsx(exp, cfg, { contractNumber: "332026110", customerName: "Botkyrka kommun" }));
    const wb = entryText(es, "xl/workbook.xml");
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Resultat", "Progression", "Händelser", "Avslut", "Om filen"]);
    const rowsIn = (n: number) => [...entryText(es, `xl/worksheets/sheet${n}.xml`).matchAll(/<row /g)].length;
    expect([rowsIn(1), rowsIn(2), rowsIn(3), rowsIn(4)]).toEqual([exp.meta.rows.resultat + 1, exp.meta.rows.progression + 1, exp.meta.rows.handelser + 1, exp.meta.rows.avslut + 1]);
    expect(exp.meta.rows.avslut).toBeGreaterThan(0);
    const s1 = entryText(es, "xl/worksheets/sheet1.xml");
    expect(s1).toContain('state="frozen"');
    expect(s1).toContain(`<autoFilter ref="A1:BJ${exp.meta.rows.resultat + 1}"/>`);
    expect(entryText(es, "xl/worksheets/sheet4.xml")).toContain(`<autoFilter ref="A1:K${exp.meta.rows.avslut + 1}"/>`);
    const about = entryText(es, "xl/worksheets/sheet5.xml");
    for (const t of ["Avtal", "332026110, Botkyrka kommun", "Period", "oktober 2026 – december 2026", "Hämtad", "2027-02-01 09:12", "Schemaversion", "Rader",
      "Bara levererade månadsrapporter kommer med. Siffrorna är desamma som när rapporten lämnades.",
      "Avslut och resultat för alla insatser som avslutades under perioden finns på fliken Avslut. Räkna resultatgraden där.",
      "Resultatdefinitionen är inte fastställd. Resultatet är preliminärt.",
      "Ett resultat räknas först när resultat_verifierat = 1. Kommer underlaget efter att slutrapporten lämnats rättar vi slutrapporten – hämta då en ny fil.",
      "Tom cell betyder att uppgiften saknas eller inte är bedömd. 0 betyder noll.",
      "Rättade rapporter: filen har den senast levererade versionen. rattelse_pagar = 1 betyder att en rättelse är på väg.",
      "Fältbeskrivning", "mojliga_varden", "schemaversion"]) {
      expect(about).toContain(t);
    }
    // Fältbeskrivningens rader bryts i cellerna (stil 3: wrapText, överst) – rubrikraden är fet, reglerna ovanför bryts inte.
    expect(entryText(es, "xl/styles.xml")).toContain('<cellXfs count="4">');
    expect(entryText(es, "xl/styles.xml")).toContain('<alignment wrapText="1" vertical="top"/>');
    const cellsOf = (text: string) => [...about.matchAll(/<c r="([A-Z]+)(\d+)"( s="(\d)")? t="inlineStr"><is><t xml:space="preserve">([^<]*)<\/t>/g)].filter((m) => m[5] === text);
    const veckor = [...about.matchAll(/<c r="C(\d+)" s="(\d)" t="inlineStr"><is><t xml:space="preserve">Antal veckor \(måndag–söndag\)/g)];
    expect(veckor).toHaveLength(1);
    expect(veckor[0][2]).toBe("3");
    expect(cellsOf("beskrivning")[0][4]).toBe("1");
    expect(cellsOf("Bara levererade månadsrapporter kommer med. Siffrorna är desamma som när rapporten lämnades.")[0][4]).toBeUndefined();
    // Skyddade personuppgifter nämns inte sedan beslutet 2026-10-07 (borttaget ur appen – spärren är vilande).
    expect(about).not.toMatch(/skyddade personuppgifter/i);
  });
  it(`storleken: 2 000 rader i Resultat (och tillhörande progression och händelser) håller sig under 3 MB som base64`, async () => {
    // 2 000 rader: testdatats rader upprepade med nya ärendenummer (påhittade).
    const many: ExportMonthly[] = [];
    for (let i = 0; many.length < 2000; i++) {
      const m = monthly[i % monthly.length];
      many.push({ ...m, report: { ...m.report, id: `x${i}`, caseId: `x${i}` }, facts: { ...m.facts, caseNumber: `BOT-99-${String(i).padStart(4, "0")}` } });
    }
    const big = buildResultExport(input({ monthly: many, finals: [], names: new Map(many.map((m) => [m.report.caseId!, "Alex Exempelsson"])) }));
    expect(big.meta.rows.resultat).toBe(2000);
    const deflated = await resultXlsx(big, cfg, { contractNumber: "332026110", customerName: "Botkyrka kommun" });
    const b64 = bytesToBase64(deflated);
    expect(base64ToBytes(b64)).toEqual(deflated);
    expect(b64.length).toBeLessThan(3 * 1024 * 1024);
    // Mätning för slutrapporten (Vercels gräns för ett svar är 4,5 MB).
    console.info(`resultatfil 2000 rader: ${big.meta.rows.progression} progressionsrader, ${big.meta.rows.handelser} händelser – xlsx ${deflated.length} byte, base64 ${b64.length} byte`);
  }, 60_000);
  it("perioden", () => {
    const opts = { current: "2027-02", start: "2026-09", maxMonths: 12 };
    expect(monthsInPeriod("2026-10", "2026-12")).toBe(3);
    expect(monthsInPeriod("2026-02", "2027-01")).toBe(12);
    expect(periodError("2026-10", "2026-12", opts)).toBeNull();
    expect(periodError("2026-12", "2026-10", opts)).toBe("Till-månaden kan inte vara före från-månaden.");
    expect(periodError("2026-01", "2027-01", { ...opts, start: "2025-01" })).toBe("Välj högst 12 månader.");
    expect(periodError("2026-08", "2026-10", opts)).toBe("Välj månader från september 2026 till februari 2027.");
    expect(periodError("2026-10", "2027-03", opts)).toBe("Välj månader från september 2026 till februari 2027.");
  });
});
