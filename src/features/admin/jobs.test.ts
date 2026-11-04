// Bakgrundsjobbens läge (UX-genomgången, paket 1, A2): ett läge per jobb och samma räkning på Min vecka och integrationssidan.
import { beforeEach, describe, expect, it } from "vitest";
import "./handlers";
import { adminIntegrations } from "./api";
import { jobDisplayStatus, jobHealth } from "./jobs";
import { testRuntime } from "./test-runtime";

let rt: ReturnType<typeof testRuntime>;
beforeEach(() => {
  rt = testRuntime();
});
const robin = () => rt.as("u-robin", "admin");

describe("bakgrundsjobbens läge", () => {
  it("ett läge åt gången: i prototypen Byggs i fas N i stället för Klar, i appen jobbets läge", () => {
    expect(jobDisplayStatus({ status: "ok", phase: 2 }, true)).toBe("phase");
    expect(jobDisplayStatus({ status: "ok", phase: 2 }, false)).toBe("ok");
    expect(jobDisplayStatus({ status: "not_run", phase: null }, true)).toBe("not_run");
  });

  it("x av y: jobben med läget Klar av alla jobb – de andra avviker, fel först", () => {
    const jobs = [
      { key: "a", status: "ok" as const, phase: null },
      { key: "b", status: "disabled" as const, phase: null },
      { key: "c", status: "ok" as const, phase: 2 },
      { key: "d", status: "failed" as const, phase: null },
      { key: "e", status: "not_run" as const, phase: null },
    ];
    expect(jobHealth(jobs, false).ok.map((j) => j.key)).toEqual(["a", "c"]);
    expect(jobHealth(jobs, false).deviating.map((j) => j.key)).toEqual(["d", "e", "b"]);
    expect(jobHealth(jobs, true).ok.map((j) => j.key)).toEqual(["a"]);
    expect(jobHealth(jobs, true).deviating.map((j) => j.key)).toEqual(["d", "e", "b", "c"]);
  });

  it("testdatat: automatisk närvaro är Inte körd än (inte Klar), och räkningen stämmer med listan", async () => {
    const d = await rt.query(adminIntegrations, {}, robin());
    const auto = d.jobs.find((j) => j.key === "auto_attendance");
    expect(auto).toMatchObject({ status: "not_run", result: "Körs första gången kl. 18.00" });
    // Inget jobb är Klar med ett resultat som säger att det inte har körts.
    for (const j of d.jobs) if (j.status === "ok") expect(j.result, j.key).not.toMatch(/inte körd/i);
    const app = jobHealth(d.jobs, false);
    expect(app.ok.length + app.deviating.length).toBe(d.jobs.length);
    expect(app.deviating.map((j) => j.key)).toEqual(["weekly", "auto_attendance", "retention"]);
    // Prototypen: jobben i fas 2 (ljud och råtranskript) är inte Klar.
    expect(jobHealth(d.jobs, true).deviating.map((j) => j.key)).toEqual(["weekly", "auto_attendance", "retention", "audio", "transcripts"]);
  });
});
