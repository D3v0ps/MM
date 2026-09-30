// PLATSHÅLLARE – påhittade testdata (porteras från prototypens 01-seed.js).
import type { MemoryData } from "../memory";
import type { Tables } from "../schema";

/** Demoklockans starttid: måndag 1 februari 2027 kl. 09.12, fem månader in i piloten. */
export const DEMO_START = "2027-02-01T09:12";

export function createSeed(): MemoryData<Tables> {
  return { notifications_demo: [] };
}
