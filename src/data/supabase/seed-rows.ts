// Testmiljöns data i databasen: prototypens påhittade testdata (createSeed()) plus testarna (TESTERS nedan), i samma
// ordning och med samma extra kolumner som supabase/seed.sql. Används av
//   scripts/db/seed-sql.ts          seed.sql (lokal Postgres, RLS-testerna) och bootstrap-staging.sql (startdata)
//   src/server/staging/load.ts      "Läs in testdata på nytt" i testmiljön (via PostgREST, service role)
// Bara påhittade uppgifter. Används aldrig i produktion.
import { createHash } from "node:crypto";
import type { MemoryData } from "../memory";
import { createSeed } from "../seed";
import { TABLE_NAMES, type Membership, type Profile, type TableName, type Tables } from "../schema";

// ---------------------------------------------------------------- Deterministiska auth-id:n
/** Namnrymd för uuid v5 av profil-id (fast värde – samma id vid varje körning). */
export const AUTH_UUID_NAMESPACE = "6f1d3c2a-8b7e-4f5a-9c0d-2e4b6a8c0f1e";

/** uuid v5 (RFC 4122, SHA-1) av ett namn i en namnrymd. */
export function uuidV5(name: string, namespace: string = AUTH_UUID_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * auth_user_id för en påhittad profil i seeden. Det finns inget konto i auth.users för dem – ingen kan logga in som
 * dem; testarna agerar som dem via tester_sessions, och RLS-testerna använder id:t som JWT-claim (sub).
 */
export const authUserIdFor = (profileId: string): string => uuidV5(`profile:${profileId}`);

// ---------------------------------------------------------------- Testarna i testmiljön
/**
 * Riktiga användare som testar i testmiljön: admin i båda avtalen och testare (kan agera som testpersoner och lämna
 * synpunkter). Kollegorna på Miljonbemanning bjöds in 2026-10-01 för att ge synpunkter på processen och plattformen.
 * Varje adress ska också finnas i MM_EMAIL_ALLOWLIST i Vercel – annars får testaren ingen inloggningskod (TESTER_ALLOWLIST).
 */
export const TESTERS: readonly { id: string; fullName: string; email: string }[] = [
  { id: "tester-karim", fullName: "Karim Khalil", email: "karim.khalil@miljonbemanning.se" },
  { id: "tester-ali", fullName: "Ali Khalil", email: "ali.khalil@miljonbemanning.se" },
  { id: "tester-sara", fullName: "Sara Salah", email: "sara.salah@miljonbemanning.se" },
  { id: "tester-adam", fullName: "Adam Abdalla", email: "adam.abdalla@miljonbemanning.se" },
  { id: "tester-shafik", fullName: "Shafik Muwanga", email: "shafik.muwanga@miljonbemanning.se" },
  { id: "tester-moda", fullName: "Moda Habib", email: "moda.habib@miljonbemanning.se" },
];
/**
 * Värdet för MM_EMAIL_ALLOWLIST i testmiljön: testarnas hela adresser, kommatecken emellan. Aldrig "@miljonbemanning.se" –
 * testdatat har påhittade adresser på den domänen (t.ex. sara.lindqvist@) som aldrig får få mejl.
 */
export const TESTER_ALLOWLIST = TESTERS.map((t) => t.email).join(",");
export const TESTER_CONTRACTS = ["c-bot", "c-kk"] as const;
export const TESTER_ORG = "org-mb";
export const TESTER_IDS: ReadonlySet<string> = new Set(TESTERS.map((t) => t.id));

export function testerProfiles(): Profile[] {
  return TESTERS.map((t) => ({
    id: t.id, organizationId: TESTER_ORG, fullName: t.fullName, email: t.email, phone: "", title: "Testare (systemadministratör)", active: true,
    lastLoginAt: null, customerUnit: null, buyerReferenceId: null, teamRole: null, invitedAt: null, invitedBy: null,
  }));
}
export function testerMemberships(): Membership[] {
  return TESTERS.flatMap((t) => TESTER_CONTRACTS.map((contractId) => ({ id: `${t.id}:${contractId}`, userId: t.id, contractId, role: "admin" as const, customerUnit: null })));
}

/** Testmiljöns data: prototypens testdata plus testarna. */
export function seedData(): MemoryData<Tables> {
  const data = createSeed();
  data.profiles.push(...testerProfiles());
  data.memberships.push(...testerMemberships());
  return data;
}

/**
 * Tabeller som inte hör till testdatat: testarnas synpunkter (0017). Seeden (seed.sql) och "Läs in testdata på nytt"
 * (mm.reset_test_data) tömmer dem aldrig – synpunkterna finns kvar när testdatat läses in på nytt.
 */
export const TESTER_TABLES: readonly TableName[] = ["feedback", "feedback_replies"];

/** Tabellerna i den ordning raderna läses in (främmande nycklar: beställarreferenser före profiler). Utan TESTER_TABLES. */
export const SEED_TABLE_ORDER: readonly TableName[] = (() => {
  const order: TableName[] = TABLE_NAMES.filter((t) => t !== "buyer_references" && !TESTER_TABLES.includes(t));
  order.splice(order.indexOf("profiles"), 0, "buyer_references");
  return order;
})();

/**
 * Startdatat för en ny testmiljö (supabase/bootstrap-staging.sql): det som testarnas inloggning och medlemskap behöver.
 * Resten läses in av testaren i appen ("Läs in testdata på nytt").
 */
export const BOOTSTRAP_TABLES: readonly TableName[] = ["holidays", "organizations", "contracts", "contract_areas", "price_items"];

/** Extra kolumner för profiler i databasen: deterministiskt auth_user_id för testpersonerna, testarna kopplas vid inloggning. */
export function profileExtras(profileId: string): { authUserId: string | null; isTester: boolean } {
  const tester = TESTER_IDS.has(profileId);
  return { authUserId: tester ? null : authUserIdFor(profileId), isTester: tester };
}
