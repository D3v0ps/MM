// "Ladda ner PDF" (rapporter.download): behörigheten kontrolleras på servern med samma regler som för att visa rapporten,
// och varje tillåten nedladdning loggas (report.downloaded – id, typ, version och period, inga namn). Filnamnet saknar
// personuppgifter. Beslut 2026-10-07: kommunens chef är borttagen – beställarrapporten laddas ned av Miljonbemanning och lämnas
// till kommunen utanför portalen.
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandDef, ParamsOf, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { actionLabel } from "@/features/admin/audit-text";
import { reportDownload } from "./api";
import { reportFilename } from "./report-helpers";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role: Role): Actor => listPersonas(rt.raw()).find((p) => p.actor.userId === userId && p.actor.role === role)!.actor;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
const download = (reportId: string, actor: Actor) => run(reportDownload, { reportId }, actor);
const logs = () => rt.store.rows("audit_log").filter((l) => l.action === "report.downloaded");

// Testdatat (samma id:n som i den gamla prototypen)
const NADIA_JAN = "rep-16011"; // månadsrapport, utkast (Amiras ärende, beställd av Maria Ekdahl)
const NADIA_DEC = "rep-16008"; // månadsrapport, levererad till Maria Ekdahl
const CS_DEC = "rep-16698"; // beställarrapport december, lämnad till kommunen (ingen mottagare i portalen)
const CS_JAN = "rep-16699"; // beställarrapport januari, utkast
const WEEKLY_WAIT = "rep-16692"; // veckorapport vecka 4 till Maria Ekdahl, väntar på närvaro
const PROT_JAN = "rep-15885"; // månadsrapport i ärendet som hade skyddade personuppgifter (utkast)
const PROT_DEL = "rep-15882"; // månadsrapport i samma ärende (levererad)
/** Den vilande spärren: personen i ärendet får skyddade personuppgifter (testdatat har inga sedan 2026-10-07). */
const protect = () => rt.store.updateRow("persons", rt.store.getRow("cases", rt.store.getRow("reports", PROT_JAN)!.caseId!)!.personId, { protectedIdentity: true });

describe("rapporter.download – behörighet som för att visa rapporten", () => {
  it("huvudcoachen laddar ned månadsrapporten: loggas med id, typ, version och period – inga namn", async () => {
    const before = rt.clock.now();
    const res = await download(NADIA_DEC, as("u-amira", "coach"));
    expect(res).toEqual({ ok: true, filename: "Manadsrapport_BOT-26-0143_2026-12_v1.pdf" });
    // Tyst kommando: demoklockan flyttas inte (som visningsloggen).
    expect(rt.clock.now()).toBe(before);
    const [l] = logs();
    expect(l).toMatchObject({ actorId: "u-amira", entity: "report", entityId: NADIA_DEC, contractId: "c-bot", details: { kind: "monthly", version: 1, month: "2026-12", format: "pdf" } });
    expect(JSON.stringify(l)).not.toMatch(/Nadia|Warsame|\d{6}-\d{4}/);
    expect(actionLabel("report.downloaded")).toBe("Laddade ner rapport");
  });

  it("utkast kan laddas ned av Miljonbemanning (vattenstämpel i PDF:en), aldrig av kommunen", async () => {
    expect(await download(NADIA_JAN, as("u-amira", "coach"))).toMatchObject({ ok: true, filename: "Manadsrapport_BOT-26-0143_2027-01_v1.pdf" });
    expect(await download(NADIA_JAN, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: false, error: "not_delivered" });
    expect(await download(CS_JAN, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: false });
    expect(logs().map((l) => l.actorId)).toEqual(["u-amira"]);
  });

  it("kommunen: mottagaren laddar ned levererade rapporter; beställarrapporten laddas ned av avtalsansvarig och lämnas utanför portalen", async () => {
    expect(await download(NADIA_DEC, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: true });
    expect(await download(CS_DEC, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: false });
    expect(await download(CS_DEC, as("u-johan", "avtalsansvarig"))).toEqual({ ok: true, filename: "Bestallarrapport_332026110_2026-12.pdf" });
    // En annan handläggare får inte rapporter om andras deltagare.
    expect(await download(NADIA_DEC, as("k-omar", "kommun_handlaggare"))).toMatchObject({ ok: false, error: "not_yours" });
    expect(logs().map((l) => [l.actorId, l.entityId])).toEqual([["k-maria", NADIA_DEC], ["u-johan", CS_DEC]]);
  });

  it("ekonomen nekas (rollen), handledaren nekas månadsrapporter men får veckorapporten", async () => {
    await expect(download(NADIA_DEC, as("u-lars", "ekonom"))).rejects.toBeInstanceOf(ApiError);
    expect(await download(NADIA_DEC, as("u-petra", "handledare"))).toMatchObject({ ok: false, error: "handledare" });
    expect(await download(WEEKLY_WAIT, as("u-petra", "handledare"))).toEqual({ ok: true, filename: "Veckorapport_2027-W04.pdf" });
    expect(logs().map((l) => l.actorId)).toEqual(["u-petra"]);
  });

  it("skyddade personuppgifter (vilande spärr påslagen): bara namngiven coach och avtalsansvarig; en annan handläggare aldrig", async () => {
    // Utan spärren laddar samordnaren ned rapporten som vanligt.
    expect(await download(PROT_JAN, as("u-sara", "samordnare"))).toMatchObject({ ok: true });
    protect();
    const prot = rt.store.getRow("reports", PROT_JAN)!;
    const c = rt.store.getRow("cases", prot.caseId!)!;
    expect(await download(PROT_JAN, as("u-sara", "samordnare"))).toMatchObject({ ok: false, error: "protected" });
    expect(await download(PROT_JAN, as(c.leadCoachId!, "coach"))).toMatchObject({ ok: true });
    expect(await download(PROT_JAN, as("u-johan", "avtalsansvarig"))).toMatchObject({ ok: true });
    expect(await download(PROT_DEL, as("k-maria", "kommun_handlaggare"))).toMatchObject({ ok: false });
  });

  it("finns inte eller saknar dokument: not_found", async () => {
    expect(await download("rep-finns-inte", as("u-sara", "samordnare"))).toMatchObject({ ok: false, error: "not_found" });
    expect(logs()).toEqual([]);
  });
});

describe("filnamnet", () => {
  it("bara rapporttyp, ärendenummer, avtalsnummer, period och version – rättelser får versionen", () => {
    const base = { caseNumber: "BOT-26-0143", contractNumber: "332026110", week: null, month: null };
    expect(reportFilename({ ...base, kind: "monthly", version: 1, month: "2027-01" })).toBe("Manadsrapport_BOT-26-0143_2027-01_v1.pdf");
    expect(reportFilename({ ...base, kind: "final", version: 2 })).toBe("Slutrapport_BOT-26-0143_v2.pdf");
    expect(reportFilename({ ...base, kind: "order_confirmation", version: 1 })).toBe("Orderbekraftelse_BOT-26-0143_v1.pdf");
    expect(reportFilename({ ...base, caseNumber: null, kind: "weekly_attendance", version: 1, week: "2027-W04" })).toBe("Veckorapport_2027-W04.pdf");
    expect(reportFilename({ ...base, caseNumber: null, kind: "weekly_attendance", version: 2, week: "2027-W04" })).toBe("Veckorapport_2027-W04_v2.pdf");
    expect(reportFilename({ ...base, caseNumber: null, kind: "customer_summary", version: 1, month: "2027-01" })).toBe("Bestallarrapport_332026110_2027-01.pdf");
    // Avtalsnummer med snedstreck eller mellanslag blir säkra filnamn.
    expect(reportFilename({ ...base, caseNumber: null, contractNumber: "2.7.5-4201/2026 A", kind: "customer_summary", version: 1, month: "2027-01" })).toBe("Bestallarrapport_2.7.5-4201-2026-A_2027-01.pdf");
  });
});
