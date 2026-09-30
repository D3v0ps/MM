import { it } from "vitest";
import "./handlers";
import "../praktik/handlers";
import "../puls/handlers";
import { adminAuditLog } from "./api";
import { praktikEmployer, praktikList } from "../praktik/api";
import { pulseLink } from "../puls/api";
import { testRuntime } from "./test-runtime";
it("explore", async () => {
  const rt = testRuntime();
  const l = await rt.query(adminAuditLog, {}, rt.as("u-karin", "chef"));
  console.log(JSON.stringify(l.logCheck));
  for (const [u, r] of [["u-sara", "samordnare"], ["u-amira", "coach"], ["u-petra", "handledare"]] as const) {
    const p = await rt.query(praktikList, {}, rt.as(u, r));
    console.log(r, JSON.stringify(p.kpis), JSON.stringify(p.upcoming.map((x) => [x.date, x.employerName, x.who, x.rightsDone])), p.employers.length, p.demoCaseId);
  }
  const p = await rt.query(praktikList, {}, rt.as("u-sara", "samordnare"));
  console.log(JSON.stringify(p.employers.slice(0, 3)));
  const d = await rt.query(praktikEmployer, { employerId: "emp-1" }, rt.as("u-amira", "coach"));
  if (d.found) console.log(d.scopeLabel, d.ongoingCount, d.doneCount, d.ongoing.mine.map((x) => [x.who, x.caseNumber, x.rightsDone]), d.ongoing.others.length, JSON.stringify(d.ongoing.others.slice(0, 2)), JSON.stringify(d.employer));
  console.log(JSON.stringify(await rt.query(pulseLink, {}, rt.as("deltagare", "deltagare"))));
});
