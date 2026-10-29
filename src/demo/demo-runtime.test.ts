// Prototypens kommandologg (src/demo/demo-runtime.ts) och filerna: innehållet sparas aldrig i loggen, och en fil som avvisades
// (fel filsignatur) kommer inte tillbaka som en godkänd fil när loggen spelas upp efter omladdning (granskningen 2026-10-29).
// Webbläsarens localStorage ersätts av en Map. Bara påhittade filer.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/api/roles";
import { ATTACHMENT_MIME_TYPES, signatureMatches } from "@/core/attachments";
import { base64ToBytes, bytesToBase64 } from "@/core/export/base64";
import { listPersonas } from "@/data/actors";
import { bootDemo, forLog, REJECTED_CONTENT, UNREADABLE_CONTENT, type DemoRuntime } from "./demo-runtime";

const NADIA = "case-260143"; // tre filer i testdatat
const PDF = bytesToBase64(new TextEncoder().encode("%PDF-1.7\n% påhittat cv\n"));
const FAKE = bytesToBase64(new TextEncoder().encode("<html>inte en pdf</html>"));

class MapStorage {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

let storage: MapStorage;
const g = globalThis as unknown as { localStorage?: unknown };
beforeEach(() => {
  storage = new MapStorage();
  g.localStorage = storage;
});
afterEach(() => {
  delete g.localStorage;
});

const amira = (d: DemoRuntime): Actor => listPersonas(d.rt.raw()).find((p) => p.actor.userId === "u-amira" && p.actor.role === "coach")!.actor;
type Start = { ok: true; attachmentId: string } | { ok: false; error: string };
type Files = { count: number; groups: { files: { id: string; fileName: string }[] }[] };

async function uploadVia(d: DemoRuntime, fileName: string, contentBase64: string) {
  const b = d.backend(() => amira(d));
  const s = (await b.command("arenden.deltagarfilStart", { caseId: NADIA, category: "cv", fileName, mimeType: "application/pdf", bytes: 30 })) as Start;
  if (!s.ok) throw new Error(s.error);
  const done = (await b.command("arenden.deltagarfilKlar", { attachmentId: s.attachmentId, contentBase64 })) as { ok: boolean };
  return { id: s.attachmentId, ok: done.ok };
}
const fileNames = async (d: DemoRuntime) => {
  const f = ((await d.backend(() => amira(d)).query("arenden.kortOversikt", { caseId: NADIA })) as { files: Files }).files;
  return f.groups.flatMap((x) => x.files.map((y) => y.fileName)).sort();
};

describe("prototypens kommandologg och filerna", () => {
  it("en avvisad fil kommer inte tillbaka efter omladdning – och innehållet står aldrig i loggen", async () => {
    const live = await bootDemo();
    const rejected = await uploadVia(live, "falsk.pdf", FAKE);
    const accepted = await uploadVia(live, "riktig.pdf", PDF);
    expect([rejected.ok, accepted.ok]).toEqual([false, true]);
    const liveNames = await fileNames(live);
    expect(liveNames).toContain("riktig.pdf");
    expect(liveNames).not.toContain("falsk.pdf");

    // Loggen: inget filinnehåll – den avvisade filen har ersättningen, den godkända inget innehåll alls.
    const raw = [...storage.map.values()].join("\n");
    expect(raw).not.toContain(FAKE);
    expect(raw).not.toContain(PDF);
    const log = JSON.parse(storage.map.get("miljonmatch-prototyp-v2-logg")!) as { key: string; input: Record<string, unknown> }[];
    const klar = log.filter((e) => e.key === "arenden.deltagarfilKlar").map((e) => e.input.contentBase64 ?? null);
    expect(klar).toEqual([REJECTED_CONTENT, null]);

    // Omladdningen spelar upp loggen: samma filer, och den avvisade raden är raderad som när det hände.
    const replay = await bootDemo();
    expect(await fileNames(replay)).toEqual(liveNames);
    expect(replay.rt.raw().get("case_attachments", rejected.id)).toMatchObject({ status: "deleted", deleteReason: "invalid" });
    expect(replay.rt.raw().get("case_attachments", accepted.id)).toMatchObject({ status: "uploaded" });
    // Samma rader och samma revisionslogg som innan omladdningen (id:n och utfall).
    const rows = (d: DemoRuntime) => d.rt.raw().all("case_attachments").map((a) => [a.id, a.status, a.deleteReason]);
    expect(rows(replay)).toEqual(rows(live));
    const audits = (d: DemoRuntime) => d.rt.raw().all("audit_log").filter((l) => l.action.startsWith("attachment.")).map((l) => [l.id, l.action, l.entityId]);
    expect(audits(replay)).toEqual(audits(live));
  });

  it("forLog: ersättningen avvisas av alla filtyper; innehåll som inte är base64 ersätts med något som inte heller är det", () => {
    for (const mime of ATTACHMENT_MIME_TYPES) expect(signatureMatches(mime, base64ToBytes(REJECTED_CONTENT)), mime).toBe(false);
    expect(() => base64ToBytes(UNREADABLE_CONTENT)).toThrow();
    const input = { attachmentId: "att-1", contentBase64: PDF };
    expect(forLog(input, { ok: true })).toEqual({ attachmentId: "att-1" });
    expect(forLog(input, { ok: false, error: "invalid" })).toEqual({ attachmentId: "att-1", contentBase64: REJECTED_CONTENT });
    expect(forLog({ attachmentId: "att-1", contentBase64: "ej base64!" }, { ok: false, error: "invalid" })).toEqual({ attachmentId: "att-1", contentBase64: UNREADABLE_CONTENT });
    // Kommandon utan filinnehåll loggas som de är.
    expect(forLog({ caseId: NADIA }, { ok: false })).toEqual({ caseId: NADIA });
  });
});
