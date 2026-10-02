// ctx.audio i supabase-läget: bucketen "ljud" (privat, Stockholm) via service role. Bara på servern.
import "server-only";
import type { LocalDateTime } from "@/core/time";
import type { AppRepo } from "@/data/schema";
import type { AudioPort } from "@/features/_shared/audio-port";
import { serviceClient } from "../supabase";
import { createStorageAudio, supabaseAudioStorage, type StorageClientLike } from "./storage";

/** Porten för en förfrågan eller en jobbkörning. system = service role (ctx.system), now = förfrågans klocka. */
export function serverAudio(o: { system: AppRepo; now: () => LocalDateTime; newId: (prefix: string) => string }): AudioPort {
  return createStorageAudio({ ...o, storage: supabaseAudioStorage(serviceClient() as unknown as StorageClientLike) });
}

export { AudioStorageError } from "./storage";
