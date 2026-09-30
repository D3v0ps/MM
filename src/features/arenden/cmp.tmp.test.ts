import { beforeAll, it, expect } from "vitest";
import fs from "node:fs";
import type { Actor, Role } from "@/api/roles";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { caseList, type CaseListModel } from "./api";
let rt: MemoryRuntime;
beforeAll(() => { rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) }); });
const P: Record<string, string> = { samordnare: "u-sara", avtalsansvarig: "u-johan", coach: "u-amira", handledare: "u-petra", chef: "u-karin", admin: "u-robin" };
it("jämför", async () => {
  const old = JSON.parse(fs.readFileSync("/tmp/mm-arenden/old-list.json", "utf8"));
  const diffs: string[] = [];
  for (const role of Object.keys(P)) {
    const actor = listPersonas(rt.raw()).find((x) => x.actor.userId === P[role] && x.actor.role === role)!.actor as Actor;
    const m = (await rt.run("query", caseList.key, {}, actor)) as CaseListModel;
    if (m.rows.length !== old[role].length) diffs.push(`${role}: antal ${m.rows.length} vs ${old[role].length}`);
    const mine = new Map(m.rows.map((r) => [r.id, r]));
    for (const o of old[role]) {
      const r = mine.get(o.id);
      if (!r) { diffs.push(`${role} saknar ${o.id}`); continue; }
      const got = {
        r: r.restricted, name: r.displayName, prot: r.protectedIdentity, flags: (r.detail?.flags ?? []).map((a) => `${a.severity}:${a.title}`), unread: r.detail?.unread ?? 0,
        lc: r.detail?.latest ? [r.detail.latest.overallStatus, r.detail.latest.heldAt] : null,
        st: r.detail ? [r.detail.attendance.planned, r.detail.attendance.present, r.detail.attendance.late, r.detail.attendance.unregistered, r.detail.attendance.rate] : null,
        start: r.detail ? r.detail.start : o.start, end: r.detail ? r.detail.end : o.end, coach: r.detail ? r.detail.leadCoachName : o.coach, area: r.detail ? r.detail.areaName : o.area,
      };
      const exp = { ...o, flags: o.r ? [] : o.flags };
      delete (exp as Record<string, unknown>).id;
      if (JSON.stringify(got) !== JSON.stringify(exp)) diffs.push(`${role} ${o.id}: ${JSON.stringify(got)} != ${JSON.stringify(exp)}`);
    }
  }
  console.log(diffs.slice(0, 30).join("\n"), diffs.length);
  expect(diffs.length).toBe(0);
}, 60000);
