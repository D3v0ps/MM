// Tester för arbetsgivarregistret och praktikplatserna (prototypens praktik.arbetsgivare, employer.add, employer.setRight och
// employer.addFollowUp – prototyp/tools/test-admin.mjs): samma siffror som den gamla prototypen, namn bara för ärenden man
// har åtkomst till och de fyra rätten bara för teamet i ärendet.
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/api/server";
import { testRuntime } from "../admin/test-runtime";
import "./handlers";
import { praktikAddFollowUp, praktikEmployer, praktikEmployerAdd, praktikList, praktikSetRight, type EmployerDetailView } from "./api";

let rt: ReturnType<typeof testRuntime>;
beforeEach(() => {
  rt = testRuntime();
});
const sara = () => rt.as("u-sara", "samordnare");
const amira = () => rt.as("u-amira", "coach");
const petra = () => rt.as("u-petra", "handledare");
const nadiaPlacement = () => rt.rows("placements").find((p) => p.caseId === "case-260143" && p.status === "ongoing")!;

describe("registret", () => {
  it("samordnaren: 12 arbetsgivare, 31 pågående av 157, 27 uppföljningar, 30 av 31 med alla fyra rätt", async () => {
    const d = await rt.query(praktikList, {}, sara());
    expect(d.mineOnly).toBe(false);
    // Den gamla prototypen räknade 32 av 158 (31 av 32): praktikplatsen för personen med skyddade personuppgifter
    // räknas inte längre för samordnaren (CLAUDE.md punkt 8).
    expect(d.kpis).toEqual({ employers: 12, ongoing: 31, total: 157, upcoming: 27, full: 30 });
    expect(d.upcoming.map((u) => [u.date, u.employerName, u.who, u.rightsDone])).toEqual([
      ["2027-02-01", "Hallunda Lagerservice AB", "Nadia Warsame · BOT-26-0143", 3],
      ["2027-02-02", "Fittja Handel AB", "Idris Mohamed · BOT-26-0146", 4],
      ["2027-02-02", "Restaurang Kryddgården", "Yusuf Abdi · BOT-26-0148", 4],
      ["2027-02-02", "Tullinge Industri AB", "Rasha Hassan · BOT-26-0157", 4],
      ["2027-02-02", "Hallunda Lagerservice AB", "Maryam Karlsson · BOT-26-0160", 4],
      ["2027-02-03", "Fittja Handel AB", "Dilan Kebede · BOT-26-0152", 4],
    ]);
    expect(d.employers.slice(0, 3).map((e) => [e.name, e.ongoing, e.total, e.next])).toEqual([
      ["Hallunda Lagerservice AB", 13, 56, "2027-02-01"],
      ["Tumba Städ & Fastighet AB", 5, 33, "2027-02-05"], // prototypen: 6 och 34 (med den skyddade personens praktikplats)
      ["Fittja Handel AB", 4, 17, "2027-02-02"],
    ]);
    expect(d.employers[0].areas).toEqual([{ code: "G", name: "Lager och logistik" }, { code: "J", name: "Parti- och detaljhandel" }]);
    expect(d.areas).toHaveLength(12);
    expect(d.demoCaseId).toBe("case-260143");
  });

  it("coach och handledare ser uppföljningar bara i sina egna ärenden", async () => {
    const c = await rt.query(praktikList, {}, amira());
    expect(c.mineOnly).toBe(true);
    expect(c.kpis.upcoming).toBe(4);
    expect(c.upcoming.map((u) => u.who)).toEqual(["Nadia Warsame · BOT-26-0143", "Yusuf Abdi · BOT-26-0148", "Jonna Osman · BOT-26-0133", "Nadia Warsame · BOT-26-0143"]);
    const h = await rt.query(praktikList, {}, petra());
    expect(h.kpis.upcoming).toBe(8);
    await expect(rt.query(praktikList, {}, rt.as("u-lars", "ekonom"))).rejects.toBeInstanceOf(ApiError);
  });
});

describe("en arbetsgivare", () => {
  it("coachen ser namn i sina ärenden och andra teams praktikplatser utan namn", async () => {
    const d = await rt.query(praktikEmployer, { employerId: "emp-1" }, amira());
    if (!d.found) throw new Error("saknas");
    expect([d.scopeLabel, d.ongoingCount, d.doneCount]).toEqual(["Praktikplatser i dina ärenden", 13, 43]);
    expect(d.ongoing.mine.map((p) => [p.who, p.caseNumber, p.rightsDone, p.canEdit])).toEqual([
      ["Nadia Warsame", "BOT-26-0143", 3, true],
      ["Jonna Osman", "BOT-26-0133", 4, true],
      ["Anders Saleh", "BOT-26-0126", 4, true],
    ]);
    expect(d.ongoing.others).toHaveLength(10);
    expect(d.ongoing.others.every((p) => p.who === "Deltagare i ett annat team")).toBe(true);
    // Inga namn eller ärenden från andra coachers ärenden i svaret
    const own = new Set(d.ongoing.mine.map((p) => p.caseId).concat(d.done.mine.map((p) => p.caseId)));
    const cases = rt.rows("cases").filter((c) => rt.rows("placements").some((p) => p.employerId === "emp-1" && p.caseId === c.id) && !own.has(c.id));
    const names = cases.map((c) => rt.rows("persons").find((p) => p.id === c.personId)!).map((p) => `${p.firstName} ${p.lastName}`);
    const json = JSON.stringify(d);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(json).not.toContain(n);
    for (const c of cases) expect(json).not.toContain(c.caseNumber);
    expect(d.employer).toMatchObject({ name: "Hallunda Lagerservice AB", orgNr: "556000-1000", contactName: "Peter Lund", email: "kontakt@example.com" });
  });

  it("skyddade personuppgifter: praktikplatsen syns bara för den som får se personen – inte ens utan namn", async () => {
    const prot = new Set(rt.rows("persons").filter((p) => p.protectedIdentity).map((p) => p.id));
    const protCase = rt.rows("cases").find((c) => prot.has(c.personId) && rt.rows("placements").some((p) => p.caseId === c.id))!;
    const pl = rt.rows("placements").find((p) => p.caseId === protCase.id)!;
    const ids = (d: EmployerDetailView) =>
      d.found ? [...d.ongoing.mine, ...d.ongoing.others, ...d.done.mine, ...d.done.others].map((x) => x.id) : [];
    for (const actor of [amira(), petra(), sara()]) {
      const d = await rt.query(praktikEmployer, { employerId: pl.employerId }, actor);
      expect(ids(d)).not.toContain(pl.id);
      expect(JSON.stringify(d)).not.toContain("Skyddade personuppgifter");
    }
    // Namngiven huvudcoach och avtalsansvarig ser den som sin egen.
    for (const actor of [rt.as(protCase.leadCoachId!, "coach"), rt.as("u-johan", "avtalsansvarig")]) {
      const d = await rt.query(praktikEmployer, { employerId: pl.employerId }, actor);
      if (!d.found) throw new Error("saknas");
      expect([...d.ongoing.mine, ...d.done.mine].map((x) => x.id)).toContain(pl.id);
    }
  });

  it("andra team: bara period och de fyra rätten – inga arbetsuppgifter (fritext), bara det egna avtalet", async () => {
    const d = await rt.query(praktikEmployer, { employerId: "emp-1" }, amira());
    if (!d.found) throw new Error("saknas");
    const others = [...d.ongoing.others, ...d.done.others];
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(Object.keys(o).sort()).toEqual(["endsOn", "id", "rightsDone", "startsOn", "who"]);
    const tasks = rt.rows("placements").filter((p) => others.some((o) => o.id === p.id)).map((p) => p.tasks).filter(Boolean);
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(JSON.stringify(others)).not.toContain(t);
    // En aktör utan avtalet ser inga praktikplatser alls.
    const outside = await rt.query(praktikList, {}, { ...amira(), contractIds: ["c-kk"] });
    expect(outside.kpis.total).toBe(0);
  });

  it("samordnaren ser alla praktikplatser hos arbetsgivaren", async () => {
    const d = await rt.query(praktikEmployer, { employerId: "emp-1" }, sara());
    if (!d.found) throw new Error("saknas");
    expect(d.scopeLabel).toBe("Praktikplatser");
    expect(d.ongoing.mine).toHaveLength(13);
    expect(await rt.query(praktikEmployer, { employerId: "emp-finns-inte" }, sara())).toEqual({ found: false });
  });
});

describe("åtgärder", () => {
  it("lägg till arbetsgivare: obligatoriska fält, organisationsnummer, områden och dubbletter", async () => {
    const base = { name: "Botkyrka Bageri AB", orgNr: "556777-1234", contactName: "Lina Berg", phone: "", email: "lina.berg@example.com", areas: ["D", "H"] };
    const t0 = rt.now();
    expect(await rt.command(praktikEmployerAdd, { ...base, name: " " }, sara())).toMatchObject({ ok: false, error: "name" });
    expect(await rt.command(praktikEmployerAdd, { ...base, orgNr: "5567771234" }, sara())).toMatchObject({ ok: false, error: "orgNr" });
    expect(await rt.command(praktikEmployerAdd, { ...base, areas: ["Z"] }, sara())).toMatchObject({ ok: false, error: "areas" });
    expect(rt.now()).toBe(t0);
    const r = await rt.command(praktikEmployerAdd, base, sara());
    expect(r.ok).toBe(true);
    const e = rt.rows("employers").at(-1)!;
    expect(e).toMatchObject({ name: "Botkyrka Bageri AB", orgNr: "556777-1234", areas: ["D", "H"], createdBy: "u-sara", createdAt: "2027-02-01T09:13" });
    expect(r.ok && r.employerId).toBe(e.id);
    expect(rt.rows("audit_log").at(-1)).toMatchObject({ action: "employer.added", entity: "employer", entityId: e.id, details: { areas: ["D", "H"] } });
    expect(await rt.command(praktikEmployerAdd, { ...base, name: "botkyrka bageri ab", orgNr: "", areas: ["D"] }, sara())).toMatchObject({ ok: false, error: "duplicate" });
    const d = await rt.query(praktikEmployer, { employerId: e.id }, sara());
    expect(d.found && d.employer.createdByName).toBe("Sara Lindqvist");
  });

  it("de fyra rätten och uppföljning i egna ärenden – loggas", async () => {
    const pl = nadiaPlacement();
    expect(await rt.command(praktikSetRight, { placementId: pl.id, right: "uppfoljning", value: true }, amira())).toEqual({ ok: true });
    expect(nadiaPlacement().fourRights.uppfoljning).toBe(true);
    expect(rt.rows("audit_log").at(-1)).toMatchObject({ action: "placement.four_rights_updated", entityId: pl.id, details: { caseId: "case-260143", right: "uppfoljning", value: true } });
    expect(await rt.command(praktikAddFollowUp, { placementId: pl.id, date: "2027-02-10" }, amira())).toEqual({ ok: true });
    expect(nadiaPlacement().followUpDates).toContain("2027-02-10");
    expect(rt.rows("audit_log").at(-1)).toMatchObject({ action: "placement.follow_up_added", details: { date: "2027-02-10" } });
  });

  it("andra teams praktikplatser går inte att ändra", async () => {
    const own = new Set(rt.rows("cases").filter((c) => c.leadCoachId === "u-amira").map((c) => c.id));
    const team = new Set(rt.rows("case_team").filter((t) => t.userId === "u-amira").map((t) => t.caseId));
    const other = rt.rows("placements").find((p) => p.employerId === "emp-1" && !own.has(p.caseId) && !team.has(p.caseId))!;
    expect(await rt.command(praktikSetRight, { placementId: other.id, right: "timing", value: false }, amira())).toMatchObject({ ok: false, error: "not_found" });
  });
});
