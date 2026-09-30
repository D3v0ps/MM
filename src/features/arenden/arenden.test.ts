// Tester för områdets frågor (ärendelistan, deltagarkortet och handledarens start) mot testdatat i minnet.
// Värdena jämförs med den gamla prototypen (prototyp/src/views/arenden.js och MM.sel på samma testdata).
import { beforeAll, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import {
  caseAssessments, caseAttendance, caseCard, caseCheckIns, caseDeviations, caseEvents, caseHistory, caseIntake, caseList, caseMessages, caseOverview, casePlacements,
  caseReports, caseRevealPnr, supervisorStart,
} from "./api";

let rt: MemoryRuntime;
beforeAll(() => {
  rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const amira = () => as("u-amira", "coach");
const petra = () => as("u-petra", "handledare");
const karin = () => as("u-karin", "chef");

const NADIA = "case-260143";
const YUSUF = "case-260148";
const SKYDDAD = "case-260120";

describe("dump", () => {
  it("skriver ut", async () => {
    const l = await q(caseList, {}, sara());
    console.log(l.rows.length, l.rows.filter((r) => r.restricted).length, l.rows.filter((r) => r.flagged && !r.restricted).length);
    console.log(JSON.stringify(l.rows.find((r) => r.id === NADIA), null, 1));
    const card = await q(caseCard, { caseId: NADIA }, amira());
    console.log(JSON.stringify(card, null, 1));
    for (const def of [caseOverview, caseIntake, caseCheckIns, caseAttendance, caseAssessments, caseEvents, caseDeviations, casePlacements, caseReports, caseMessages, caseHistory]) {
      const r = await q(def, { caseId: YUSUF }, amira());
      console.log(def.key, JSON.stringify(r).slice(0, 600));
    }
    console.log(JSON.stringify(await q(caseCard, { caseId: SKYDDAD }, amira())));
    console.log(JSON.stringify(await q(caseCard, { caseId: SKYDDAD }, sara())));
    console.log(JSON.stringify(await rt.run("command", caseRevealPnr.key, { caseId: NADIA }, amira())));
    const h = await q(supervisorStart, {}, petra());
    console.log(h.groups.pagaende.length, h.practiceDays, h.vocationalMoments, h.missingFour.length, h.upcoming.length);
    void johan; void karin;
  });
});
