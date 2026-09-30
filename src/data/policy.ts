// PLATSHÅLLARE – policyer per tabell som speglar Row Level Security (SPEC §4, CLAUDE.md punkt 1 och 8).
import type { Policies } from "./memory";
import type { Tables } from "./schema";

export const POLICIES: Policies<Tables> = {};
