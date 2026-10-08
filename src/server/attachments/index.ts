// ctx.attachments i supabase-läget: bucketen "bilagor" (privat, Stockholm) via service role. Bara på servern.
import "server-only";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo } from "@/data/schema";
import type { AttachmentPort } from "@/features/_shared/attachment-port";
import { serviceClient } from "../supabase";
import { createStorageAttachments, supabaseAttachmentStorage, type AttachmentStorageClientLike } from "./storage";

/** Porten för en förfrågan eller en jobbkörning. system = service role (ctx.system), now = förfrågans klocka. */
export function serverAttachments(o: { system: AppRepo; now: () => LocalDateTime; newId: (prefix: string) => string }): AttachmentPort {
  return createStorageAttachments({ ...o, storage: supabaseAttachmentStorage(serviceClient() as unknown as AttachmentStorageClientLike) });
}

export { AttachmentStorageError, emptyAttachmentBucket } from "./storage";
