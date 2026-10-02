// Artefaktens förmågor i claude.ai (window.claude.use). Bara prototypen: delad feedback (db), vem som tittar (user),
// nedladdning (downloads) och kommentarer (comments). Utanför claude.ai finns inget window.claude – då används
// reserverna (lokal feedback, textdialog att kopiera från).
//
// Artefakten publiceras med förmågorna:
//   { db: {}, user: { scopes: ["profile"] }, downloads: true, comments: { composer_only: true } }
// Typerna nedan är det lilla urval av anropskontraktet (runtime 0.2.x) som prototypen använder.

export type DbError = { code: string; message?: string };
export type DocSnap = { id: string; data(): Record<string, unknown> | undefined };
export type QuerySnap = { docs: DocSnap[] };
export type Unsubscribe = () => void;
export type DbQuery = {
  orderBy(field: string, dir?: "asc" | "desc"): DbQuery;
  limit(n: number): DbQuery;
  onSnapshot(next: (snap: QuerySnap) => void, error?: (e: DbError) => void): Unsubscribe;
};
export type DbCollection = DbQuery & { add(data: Record<string, unknown>): Promise<unknown> };
export type DbDoc = {
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
};
export type ClaudeDb = { collection(path: string): DbCollection; doc(path: string): DbDoc };
export type ClaudeUser = {
  id(): Promise<string | null>;
  can(capability: string): Promise<boolean | null>;
  profiles(ids: readonly string[]): Promise<Record<string, { name: string }>>;
};
export type ClaudeDownloads = { save(req: { filename: string; data: string | Blob }): Promise<unknown> };
export type ClaudeComments = { openComposer(target: { element: Element }): Promise<{ opened: boolean }> };

type CapabilityMap = { db: ClaudeDb; user: ClaudeUser; downloads: ClaudeDownloads; comments: ClaudeComments };
type ClaudeGlobal = { use(name: string): Promise<unknown> };

/** Förmågan, eller null när den inte finns här (utanför claude.ai, inte beviljad eller inte laddad). */
export async function getCapability<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null> {
  const c = typeof window === "undefined" ? undefined : (window as unknown as { claude?: ClaudeGlobal }).claude;
  if (!c || typeof c.use !== "function") return null;
  try {
    return ((await c.use(name)) as CapabilityMap[K] | null) ?? null;
  } catch {
    return null;
  }
}
