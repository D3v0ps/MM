// Jobbet inbox_import: ett jobb per tvåminutersperiod, körningen utan inställningar (inte kopplad), med fejkad Graph och
// läget i integrationsraden – aldrig hemligheter.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { Ctx } from "@/api/server";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import type { AppRepo, Job, Tables } from "@/data/schema";
import type { GraphMail } from "../inbox/graph";
import { JobError } from "./errors";
import { ensureInboxImportJob, GRAPH_INTEGRATION_ID, INBOX_IMPORT_JOB, inboxImportJobId, inboxJobHandler, runInboxImport } from "./inbox";

function setup() {
  const store = new MemoryStore<Tables>(createSeed());
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  let seq = 0;
  const ctx: Ctx = { actor: SYSTEM_ACTOR, now: () => DEMO_START, repo: system, system, newId: (p) => `${p}-j${++seq}`, audit: async () => undefined, notify: async () => undefined, crypto: TEST_PNR_CRYPTO };
  return { store, system, ctx };
}

describe("inbox_import", () => {
  it("läggs en gång per tvåminutersperiod", async () => {
    expect(inboxImportJobId("2027-02-01T09:12")).toBe("job-inbox_import-2027-02-01T09:12");
    expect(inboxImportJobId("2027-02-01T09:13")).toBe("job-inbox_import-2027-02-01T09:12");
    expect(inboxImportJobId("2027-02-01T09:14")).toBe("job-inbox_import-2027-02-01T09:14");
    expect(inboxImportJobId("2027-02-01T09:01")).toBe("job-inbox_import-2027-02-01T09:00");
    const { store, system } = setup();
    expect(await ensureInboxImportJob(system, "2027-02-01T09:12")).toBe(true);
    expect(await ensureInboxImportJob(system, "2027-02-01T09:13")).toBe(false);
    expect(await ensureInboxImportJob(system, "2027-02-01T09:14")).toBe(true);
    expect(store.rows("jobs").filter((j) => j.kind === INBOX_IMPORT_JOB).map((j) => [j.id, j.status])).toEqual([["job-inbox_import-2027-02-01T09:12", "queued"], ["job-inbox_import-2027-02-01T09:14", "queued"]]);
  });

  it("utan inställningar: gör ingenting och integrationsraden säger inte kopplad (inga hemligheter sparas)", async () => {
    const { store, system, ctx } = setup();
    expect(await runInboxImport({ ctx, repo: system, now: DEMO_START, env: {} })).toBe("not_configured");
    const row = store.getRow("integrations", GRAPH_INTEGRATION_ID)!;
    expect(row).toMatchObject({ status: "off", config: { description: "Microsoft Graph", configured: false, lastRunAt: DEMO_START, lastError: null } });
    expect(store.rows("inbound_emails")).toHaveLength(createSeed().inbound_emails.length);
  });

  it("med en fejkad Graph: utfallet och läget sparas; ett fel sparas som felorsak och jobbet försöks igen", async () => {
    const { store, system, ctx } = setup();
    const graph: GraphMail = {
      listUnread: async () => [{ id: "m1", internetMessageId: "<m1@x>", subject: "Lunch?", receivedDateTime: "2027-02-01T07:50:00Z", fromAddress: "a@botkyrka.se", fromName: "A", bodyText: "Ses vi?", hasAttachments: false }],
      listAttachments: async () => [], attachmentBytes: async () => new Uint8Array(), moveToDone: async () => undefined,
    };
    expect(await runInboxImport({ ctx, repo: system, now: DEMO_START, env: {}, graph })).toBe("imported:1");
    expect(store.getRow("integrations", GRAPH_INTEGRATION_ID)).toMatchObject({ status: "active", config: { configured: true, lastRunAt: DEMO_START, lastImportAt: DEMO_START, lastError: null, lastSummary: { imported: 1, other: 1 } } });
    expect(JSON.stringify(store.getRow("integrations", GRAPH_INTEGRATION_ID))).not.toMatch(/hemlig|client_secret|access_token/i);
    const failing: GraphMail = { ...graph, listUnread: async () => { throw new JobError("Microsoft Graph: listningen svarade 503", { retryable: true }); } };
    await expect(runInboxImport({ ctx, repo: system, now: "2027-02-01T09:14", env: {}, graph: failing })).rejects.toMatchObject({ retryable: true });
    expect(store.getRow("integrations", GRAPH_INTEGRATION_ID)).toMatchObject({ config: { lastRunAt: "2027-02-01T09:14", lastImportAt: DEMO_START, lastError: "Microsoft Graph: listningen svarade 503" } });
    // Handlern utan beroende ger upp; med beroende lämnas utfallet vidare.
    const h = inboxJobHandler<{ inboxImport?: () => Promise<string> }>();
    const job = { id: "j", kind: INBOX_IMPORT_JOB } as unknown as Job;
    await expect(h.run(job, {})).rejects.toMatchObject({ retryable: false });
    expect(await h.run(job, { inboxImport: async () => "none" })).toBe("none");
  });
});
