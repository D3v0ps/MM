// Tester för notiser: varje notis har exakt en mottagare, coachen får påminnelser men aldrig eskaleringar,
// chefen/controllern får eskaleringarna, e-posttexten saknar personuppgifter och läsmarkeringen gäller bara den inloggade.
import { beforeEach, describe, expect, it } from "vitest";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import { ApiError } from "@/api/server";
import { decodeTestPnr, normalizePnr } from "@/data/seed";
import { testRuntime } from "../ledning/test-runtime";
import "./handlers";
import { notifList, notifRead } from "./api";

let rt: ReturnType<typeof testRuntime>;
beforeEach(() => {
  rt = testRuntime();
});
const amira = () => rt.as("u-amira", "coach");
const karin = () => rt.as("u-karin", "chef");

describe("notiser", () => {
  it("coachen: tilldelningar och påminnelser, aldrig eskaleringar", async () => {
    const d = await rt.query(notifList, {}, amira());
    expect(d.items).toHaveLength(8);
    expect(d.items.filter((n) => !n.readAt)).toHaveLength(4);
    expect(d.items.map((n) => n.kind)).not.toContain("progress_escalation");
    expect(d.items.slice(0, 4).map((n) => n.id)).toEqual(["nprog:case-260148:2027-W04", "nprog:case-260126:2027-W04", "nprog:case-260130:2027-W04", "nprog:case-270003:2027-W04"]);
    expect(d.items[0]).toMatchObject({
      kind: "progress_reminder", caseId: "case-260148", createdAt: "2027-02-01T08:00", channels: ["app", "email"],
      title: "Påminnelse: ingen progression 3 veckor i rad",
      body: "BOT-26-0148: Inget möte dokumenterat (v. 4 2027). Planera nästa steg och dokumentera i mötet.",
    });
    expect([d.isCoach, d.isEscalationRole, d.reminderSchedule, d.escalateAfterWeeks]).toEqual([true, false, "måndag 08.00 för föregående vecka", 2]);
    expect(JSON.stringify(d)).not.toMatch(/eskaler/i);
  });

  it("chefen: eskaleringarna med coach och orsak, e-post utan personuppgifter", async () => {
    const d = await rt.query(notifList, {}, karin());
    expect(d.items.map((n) => [n.kind, n.title])).toEqual([
      ["progress_escalation", "Eskalering: 3 veckor i rad utan progression"],
      ["progress_escalation", "Eskalering: 2 veckor i rad utan progression"],
      ["progress_escalation", "Eskalering: 2 veckor i rad utan progression"],
    ]);
    expect(d.items[0].body).toBe("BOT-26-0148 · coach Amira Haddad · v. 2 2027: Veckomålet inte uppnått · v. 3 2027: Veckomålet inte uppnått · v. 4 2027: Inget möte dokumenterat.");
    expect(d.isEscalationRole).toBe(true);
    const pii = rt.rows("persons").flatMap((p) => [p.firstName, p.lastName, normalizePnr(decodeTestPnr(p.personnummerEnc))]).filter((x) => x && x.length >= 4);
    for (const n of [...d.items, ...(await rt.query(notifList, {}, amira())).items]) for (const x of pii) expect(n.emailBody).not.toContain(x);
  });

  it("handledaren och ekonomen får inga påminnelser om andras ärenden eller eskaleringar; kommunen har ingen åtkomst", async () => {
    const petra = await rt.query(notifList, {}, dormantSupervisor());
    expect(petra.items.map((n) => n.kind)).not.toContain("progress_escalation");
    expect(petra.items.map((n) => n.kind)).not.toContain("progress_reminder");
    const lars = await rt.query(notifList, {}, rt.as("u-lars", "ekonom"));
    expect(lars.items.filter((n) => n.kind === "progress_escalation" || n.kind === "progress_reminder")).toEqual([]);
    await expect(rt.query(notifList, {}, rt.as("k-maria", "kommun_handlaggare"))).rejects.toBeInstanceOf(ApiError);
  });

  it("läsmarkeringen gäller bara den inloggade och flyttar inte klockan", async () => {
    const first = (await rt.query(notifList, {}, amira())).items[0];
    expect(await rt.command(notifRead, { ids: [first.id, first.id] }, amira())).toEqual({ ok: true, marked: 1 });
    expect(rt.now()).toBe("2027-02-01T09:12");
    const d = await rt.query(notifList, {}, amira());
    expect(d.items[0].readAt).toBe("2027-02-01T09:12");
    expect(d.items.filter((n) => !n.readAt)).toHaveLength(3);
    // Samma nyckel hos en annan användare påverkas inte
    expect((await rt.query(notifList, {}, karin())).items.every((n) => !n.readAt)).toBe(true);
  });
});
