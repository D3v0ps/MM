// ctx.attachments på servern (bucketen "bilagor") med fejkad lagring och testdatat i minnet som ctx.system: signerad
// uppladdningsadress, bekräftelse med storleken från lagringen och filsignaturen, nedladdning utan filnamn i adressen,
// radering och Supabase-klientens felkoder (utan sökvägar i felmeddelandena). Bara påhittade filer.
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { LocalDateTime } from "@/core/time";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import type { AppRepo, Tables } from "@/data/schema";
import type { Ctx } from "@/api/server";
import { ATTACHMENT_MAX_BYTES } from "@/features/_shared/attachment-port";
import { runAttachmentRetention } from "@/features/_shared/attachment-retention";
import { AttachmentStorageError, createStorageAttachments, emptyAttachmentBucket, supabaseAttachmentStorage, type AttachmentBucketLike, type AttachmentStorage } from "./storage";

const PDF = new TextEncoder().encode("%PDF-1.7\n%påhittad\n");

function fakeStorage() {
  const files = new Map<string, Uint8Array>();
  const removed: string[] = [];
  const signedFor: [string, number][] = [];
  const storage: AttachmentStorage = {
    async createSignedUploadUrl(path) {
      return { signedUrl: `https://ref.supabase.co/storage/v1/object/upload/sign/bilagor/${path}?token=t1`, token: "t1" };
    },
    async size(path) {
      return files.get(path)?.byteLength ?? null;
    },
    async head(path) {
      return files.get(path)?.slice(0, 16) ?? null;
    },
    async createSignedUrl(path, seconds) {
      signedFor.push([path, seconds]);
      return `https://ref.supabase.co/storage/v1/object/sign/bilagor/${path}?token=d1`;
    },
    async remove(path) {
      removed.push(path);
      files.delete(path);
    },
    async list() {
      return [...files.keys()].sort();
    },
  };
  return { storage, files, removed, signedFor };
}

function setup() {
  const store = new MemoryStore<Tables>(createSeed());
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const clock: LocalDateTime = DEMO_START;
  let seq = 0;
  const f = fakeStorage();
  const port = createStorageAttachments({ system, storage: f.storage, now: () => clock, newId: (p) => `${p}-${++seq}` });
  return { store, port, ...f };
}
const META = { contractId: "c-bot", caseId: null, ownerId: "k-maria", fileName: "Kartläggning Samira Testsson.pdf", mimeType: "application/pdf", bytes: PDF.byteLength };

describe("createStorageAttachments", () => {
  it("createUpload: raden (pending) och en signerad adress med bara avtal och id i sökvägen – aldrig filnamnet", async () => {
    const t = setup();
    const ticket = await t.port.createUpload(META);
    expect(ticket).toEqual({ attachmentId: "att-1", uploadUrl: "https://ref.supabase.co/storage/v1/object/upload/sign/bilagor/c-bot/att-1.pdf?token=t1", token: "t1", maxBytes: ATTACHMENT_MAX_BYTES });
    expect(ticket.uploadUrl).not.toMatch(/Kartl|Samira/);
    expect(t.store.getRow("case_attachments", "att-1")).toMatchObject({ status: "pending", storagePath: "c-bot/att-1.pdf", fileName: "Kartläggning Samira Testsson.pdf", uploadedBy: "k-maria" });
    await expect(t.port.createUpload({ ...META, mimeType: "application/zip", fileName: "x.zip" })).rejects.toMatchObject({ code: "attachment_type" });
    await expect(t.port.createUpload({ ...META, bytes: ATTACHMENT_MAX_BYTES + 1 })).rejects.toMatchObject({ code: "attachment_size" });
  });

  it("confirm: storleken från lagringen och filsignaturen – annars raderas filen direkt", async () => {
    const t = setup();
    const a = await t.port.createUpload(META);
    expect(await t.port.confirm(a.attachmentId)).toBeNull(); // ingen fil i lagringen än
    t.files.set("c-bot/att-1.pdf", PDF);
    expect(await t.port.confirm(a.attachmentId)).toMatchObject({ status: "uploaded", bytes: PDF.byteLength });
    // En fil som inte är det den säger sig vara.
    const b = await t.port.createUpload({ ...META, fileName: "falsk.pdf" });
    t.files.set("c-bot/att-2.pdf", new TextEncoder().encode("<html>x</html>"));
    expect(await t.port.confirm(b.attachmentId)).toBeNull();
    expect(t.removed).toEqual(["c-bot/att-2.pdf"]);
    expect(t.store.getRow("case_attachments", "att-2")).toMatchObject({ status: "deleted", deleteReason: "invalid" });
  });

  it("signedDownload: en adress som gäller i 60 sekunder, utan filnamn; remove raderar filen och behåller spåret", async () => {
    const t = setup();
    const a = await t.port.createUpload(META);
    t.files.set("c-bot/att-1.pdf", PDF);
    await t.port.confirm(a.attachmentId);
    await t.port.link([a.attachmentId], "case-260143");
    expect(t.store.getRow("case_attachments", "att-1")).toMatchObject({ caseId: "case-260143", linkedAt: DEMO_START });
    const d = await t.port.signedDownload(a.attachmentId);
    expect(d).toEqual({ url: "https://ref.supabase.co/storage/v1/object/sign/bilagor/c-bot/att-1.pdf?token=d1", content: null });
    expect(t.signedFor).toEqual([["c-bot/att-1.pdf", 60]]);
    expect(d!.url).not.toMatch(/download|Kartl/);
    await t.port.remove(a.attachmentId, "removed", "u-sara");
    expect(t.removed).toEqual(["c-bot/att-1.pdf"]);
    expect(t.store.getRow("case_attachments", "att-1")).toMatchObject({ status: "deleted", deleteReason: "removed", removedBy: "u-sara", deletedAt: DEMO_START });
    expect(await t.port.signedDownload(a.attachmentId)).toBeNull();
    // Idempotent: en andra radering gör inget.
    await t.port.remove(a.attachmentId, "retention");
    expect(t.removed).toHaveLength(1);
  });

  it("avstämningen i gallringen: en fil som laddas upp igen med samma signerade adress efter Ta bort raderas", async () => {
    // Supabase: uppladdningsadressen gäller i 2 timmar och kan inte återkallas – finns ingen fil kan den användas igen.
    const t = setup();
    const a = await t.port.createUpload(META);
    t.files.set("c-bot/att-1.pdf", PDF);
    await t.port.confirm(a.attachmentId);
    await t.port.remove(a.attachmentId, "removed", "k-maria");
    t.files.set("c-bot/att-1.pdf", new TextEncoder().encode("vad som helst")); // samma adress igen, ingen filsignaturkontroll
    // En annan, levande uppladdning ligger kvar.
    const b = await t.port.createUpload({ ...META, fileName: "annan.pdf" });
    t.files.set("c-bot/att-2.pdf", PDF);
    await t.port.confirm(b.attachmentId);
    const audits: unknown[] = [];
    const system = new MemoryRepo<Tables>(t.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
    const ctx = { now: () => DEMO_START, system, attachments: t.port, audit: async (e: unknown) => void audits.push(e) } as unknown as Ctx;
    expect(await runAttachmentRetention(ctx)).toEqual({ unlinked: 0, retention: 0, orphans: 1 });
    expect([...t.files.keys()]).toEqual(["c-bot/att-2.pdf"]);
    expect(t.store.getRow("case_attachments", "att-1")).toMatchObject({ status: "deleted" });
    expect(audits).toEqual([{ action: "attachment.deleted", entity: "case_attachment", entityId: "att-1", contractId: "c-bot", details: { caseId: null, reason: "orphan" } }]);
  });
});

describe("supabaseAttachmentStorage", () => {
  const bucket = (over: Partial<AttachmentBucketLike> = {}): { from: () => AttachmentBucketLike; calls: unknown[][] } => {
    const calls: unknown[][] = [];
    const b: AttachmentBucketLike = {
      createSignedUploadUrl: async (path) => (calls.push(["upload", path]), { data: { signedUrl: `u/${path}`, token: "t", path }, error: null }),
      createSignedUrl: async (...a: unknown[]) => (calls.push(["sign", ...a]), { data: { signedUrl: "s" }, error: null }),
      exists: async () => ({ data: true, error: null }),
      info: async () => ({ data: { size: 1234 }, error: null }),
      download: async () => ({ data: new Blob([PDF]), error: null }),
      remove: async (paths) => (calls.push(["remove", paths]), { data: null, error: null }),
      list: async () => ({ data: [], error: null }),
      ...over,
    };
    return { from: () => b, calls };
  };

  it("nedladdningsadressen skapas utan alternativ (ingen download-parameter med filnamnet)", async () => {
    const b = bucket();
    const s = supabaseAttachmentStorage({ storage: { from: b.from } });
    expect(await s.createSignedUrl("c-bot/att-1.pdf", 60)).toBe("s");
    expect(b.calls).toEqual([["sign", "c-bot/att-1.pdf", 60]]);
    expect(await s.size("c-bot/att-1.pdf")).toBe(1234);
    expect(await s.head("c-bot/att-1.pdf")).toEqual(PDF.slice(0, 16));
    await s.remove("c-bot/att-1.pdf");
    expect(b.calls.at(-1)).toEqual(["remove", ["c-bot/att-1.pdf"]]);
  });

  it("en fil som saknas är null; andra fel blir AttachmentStorageError utan sökväg", async () => {
    const missing = supabaseAttachmentStorage({ storage: { from: bucket({ exists: async () => ({ data: false, error: { statusCode: "404" } }), download: async () => ({ data: null, error: { status: 404 } }) }).from } });
    expect(await missing.size("c-bot/att-1.pdf")).toBeNull();
    expect(await missing.head("c-bot/att-1.pdf")).toBeNull();
    const broken = supabaseAttachmentStorage({ storage: { from: bucket({ createSignedUrl: async () => ({ data: null, error: { statusCode: "500" } }) }).from } });
    const err = await broken.createSignedUrl("c-bot/att-1.pdf", 60).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AttachmentStorageError);
    expect((err as Error).message).toBe("Bilagorna: sign misslyckades (500)");
    expect((err as Error).message).not.toContain("att-1");
  });

  it("list: filerna i avtalsmapparna, sida för sida (1 000 per anrop)", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => `att-${i}.pdf`);
    const asked: [string | undefined, number | undefined][] = [];
    const b = bucket({
      list: async (prefix?: string, o?: { limit?: number; offset?: number }) => {
        asked.push([prefix, o?.offset]);
        if (!prefix) return { data: [{ name: "c-bot", id: null }, { name: "lösfil.pdf", id: "x" }], error: null };
        const off = o?.offset ?? 0;
        return { data: many.slice(off, off + (o?.limit ?? 100)).map((n) => ({ name: n, id: `id-${n}` })), error: null };
      },
    });
    const paths = await supabaseAttachmentStorage({ storage: { from: b.from } }).list();
    expect(paths).toHaveLength(1001);
    expect(paths[0]).toBe("c-bot/att-0.pdf");
    expect(paths.at(-1)).toBe("c-bot/att-1000.pdf");
    expect(asked).toEqual([["", undefined], ["c-bot", 0], ["c-bot", 1000]]);
  });

  it("emptyAttachmentBucket: tömmer avtalsmapparna i omgångar (testmiljöns 'Läs in testdata på nytt')", async () => {
    const files = new Map<string, string[]>([["c-bot", ["att-1.pdf", "att-2.png"]]]);
    const removed: string[][] = [];
    const b = bucket({
      list: async (prefix?: string) =>
        !prefix ? { data: [{ name: "c-bot", id: null }], error: null } : { data: (files.get(prefix) ?? []).map((n) => ({ name: n, id: `id-${n}` })), error: null },
      remove: async (paths) => {
        removed.push(paths);
        files.set("c-bot", []);
        return { data: null, error: null };
      },
    });
    expect(await emptyAttachmentBucket({ storage: { from: b.from } })).toBe(2);
    expect(removed).toEqual([["c-bot/att-1.pdf", "c-bot/att-2.png"]]);
  });
});
