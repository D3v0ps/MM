// Scenarierna i prototypen: varje steg ska leda till rätt sökväg med testdatats riktiga id:n
// (samma taggade ärenden som den gamla prototypen, prototyp/tools/data-samples.json -> script_tags).
import { describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import samples from "../../prototyp/tools/data-samples.json";
import type { DemoRefs } from "./api";
import "./handlers";
import { pathForView, viewForPath } from "./paths";
import { SCENARIOS, scenarioNumber, stepPath, TOTAL_STEPS } from "./scenarios";

const EKONOM: Actor = { userId: "u-lars", role: "ekonom", contractIds: ["c-bot"] };
const KOMMUN: Actor = { userId: "k-maria", role: "kommun_handlaggare", contractIds: ["c-bot"], customerUnit: null };

async function refsAs(actor: Actor): Promise<DemoRefs> {
  const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
  return (await rt.run("query", "demo.refs", {}, actor)) as DemoRefs;
}

describe("demo.refs – uppslag av taggade ärenden", () => {
  it("ger samma ärenden som den gamla prototypens S.script, oavsett roll", async () => {
    const script = samples.script_tags as Record<string, string>;
    for (const actor of [EKONOM, KOMMUN]) {
      const refs = await refsAs(actor);
      for (const [tag, caseId] of Object.entries(script)) expect(refs.cases[tag], tag).toBe(caseId);
    }
  });
  it("hittar AI-utkastet från Mehmets avstämning och de taggade ärendenas rapporter", async () => {
    const refs = await refsAs(EKONOM);
    const seed = createSeed();
    const draft = seed.check_ins.find((c) => c.caseId === "case-260130" && c.ai);
    expect(draft?.status).toBe("draft");
    expect(refs.aiDraftCheckIns["case-260130"]).toBe(draft?.id);
    const nadiaJan = seed.reports.filter((r) => r.caseId === "case-260143" && r.kind === "monthly" && r.month === "2027-01").map((r) => r.id);
    expect(refs.reports.filter((r) => r.caseId === "case-260143" && r.kind === "monthly" && r.month === "2027-01").map((r) => r.id)).toEqual(nadiaJan);
    expect(refs.reports.every((r) => Object.values(refs.cases).includes(r.caseId))).toBe(true);
  });
  it("samma id:n som den gamla prototypen ger i dag", async () => {
    // Värden från den gamla prototypen (MM.seed() i prototyp/src). Obs: checkIn_aiDraft i data-samples.json (ci-11917)
    // är från en äldre version – dagens gamla prototyp ger ci-11916, precis som den nya seeden.
    const refs = await refsAs(EKONOM);
    expect(refs.aiDraftCheckIns["case-260130"]).toBe("ci-11916");
    expect(refs.reports.filter((r) => r.caseId === "case-260143" && r.kind === "monthly" && r.month === "2027-01").map((r) => r.id)).toEqual(["rep-16011"]);
  });
});

describe("scenariernas steg -> sökvägar", () => {
  it("den gamla prototypens 13 scenarier (47 steg, s13 före s12) och röstinspelningen (s14, 6 steg) sist", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s13", "s12", "s14"]);
    expect(TOTAL_STEPS).toBe(53);
    expect(scenarioNumber("s12")).toBe(13);
    expect(scenarioNumber("s14")).toBe(14);
  });

  it("varje steg har rätt roll och sökväg", async () => {
    const refs = await refsAs(EKONOM);
    const nadiaJan = refs.reports.find((r) => r.caseId === "case-260143" && r.kind === "monthly" && r.month === "2027-01")?.id;
    const paths = SCENARIOS.map((s) => [s.id, s.steps.map((st) => `${st.role} ${stepPath(st, refs)}`)]);
    expect(Object.fromEntries(paths)).toEqual({
      s1: ["samordnare /inkorg/em-101", "samordnare /inkorg/em-101", "kommun_handlaggare /portal/deltagare/case-270050"],
      s2: ["samordnare /inkorg/em-102", "samordnare /inkorg/em-102", "samordnare /inkorg/em-103", "admin /admin/mallar?flik=logg"],
      s3: ["kommun_handlaggare /portal/logga-in", "kommun_handlaggare /portal/bestall", "kommun_handlaggare /portal/bestall", "samordnare /inkorg?senaste=1"],
      s4: ["coach /min-vecka", "coach /narvaro?vecka=forra", "kommun_handlaggare /portal/rapporter"],
      s5: ["coach /avstamning/case-260148", "coach /avstamning/case-260148", "coach /arenden/case-260148?flik=avvikelser", "kommun_handlaggare /portal/deltagare/case-260148"],
      s6: Array(3).fill(`coach /avstamning/case-260130?avstamning=${refs.aiDraftCheckIns["case-260130"]}`),
      s7: [
        "coach /manadsbedomning/case-260143?manad=2027-01",
        "coach /manadsbedomning/case-260143?manad=2027-01",
        nadiaJan ? `coach /rapporter/${nadiaJan}` : "coach /rapporter",
        "kommun_handlaggare /portal/rapporter",
      ],
      s8: Array(4).fill("ekonom /ekonomi/2027-01"),
      s9: ["chef /ledning", "chef /ledning", "chef /avtalsavvikelser", "kommun_chef /portal/bestallarrapport"],
      s10: ["ekonom /ekonomi", "handledare /handledare", "avtalsansvarig /arenden?filter=skyddade", "admin /admin/logg"],
      s11: ["deltagare /puls", "chef /ledning?flik=puls"],
      s13: ["samordnare /inkorg/em-106", "coach /notiser", "chef /notiser", "chef /ledning", "admin /admin/avtal?flik=interna"],
      s12: ["admin /admin/avtal", "admin /admin/avtal?flik=priser", "admin /om/fragor"],
      s14: [
        "coach /avstamning/case-260143", "coach /arenden/case-260143", "deltagare /rost", "coach /min-vecka", "kommun_handlaggare /portal/bestall",
        "coach /manadsbedomning/case-260143?manad=2027-01",
      ],
    });
  });
});

describe("vy-id <-> sökväg (feedback som redan lämnats har den gamla prototypens vy-id)", () => {
  it("översätter vyer med parametrar", () => {
    expect(pathForView("arende.kort", { caseId: "case-260143", tab: "narvaro" })).toBe("/arenden/case-260143?flik=narvaro");
    expect(pathForView("eko.faktura", { month: "2027-01", caseId: "case-260117" })).toBe("/ekonomi/2027-01/faktura/case-260117");
    expect(pathForView("eko.arende", { caseId: "case-260117" })).toBe("/ekonomi/arende/case-260117");
    expect(pathForView("coach.handelse", { caseId: "case-1", mode: "close" })).toBe("/handelse/case-1?lage=avslut");
    expect(pathForView("rapport.visa", { reportId: null })).toBe("/rapporter");
    expect(pathForView("finns.inte", {})).toBeNull();
  });
  it("känner igen sökvägen som samma vy", () => {
    expect(viewForPath("/ekonomi/arende/case-260117")).toEqual({ view: "eko.arende", params: { caseId: "case-260117" } });
    expect(viewForPath("/ekonomi/2027-01")).toEqual({ view: "eko.korning", params: { month: "2027-01" } });
    expect(viewForPath("/portal")).toEqual({ view: "kom.start", params: {} });
    expect(viewForPath("/inkorg")).toEqual({ view: "sam.inkorg", params: {} });
    expect(viewForPath("/om/genomgang").view).toBe("om.feedback");
    expect(viewForPath("/diagnos")).toEqual({ view: "/diagnos", params: {} });
  });
});
