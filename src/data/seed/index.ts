// Påhittade testdata (deterministiska) – exakt port av den gamla prototypens prototyp/src/01-seed.js.
// Samma slump (rng(20270201)) och samma ordning på slumpanropen, så att namn, personnummer, datum, id:n,
// ärendenummer och alla siffror blir identiska med prototypen. Inga riktiga personer eller personnummer.
//
// Stegen körs i prototypens ordning:
//   gen-cases.ts     användare, avrop, ärenden, scriptade ärenden, livscykel, team, personer, statushistorik
//   gen-coaching.ts  aktiviteter, närvaro, avstämningar, AI-utkast, kartläggning, samtycken, praktik, händelser
//   gen-reports.ts   månadsbedömningar, månadsplaner och rapporter
//   gen-other.ts     avtalsavvikelser, puls, inkorgen, meddelanden, fakturering, logg, utskick, notiser, uppgifter
//   map.ts           prototypens struktur -> tabellerna i schema.ts (+ demo_tags)
//   gen-voice.ts     röstinspelningen (finns inte i prototypen): länkar, röstmeddelanden och ljudfilernas spår
import type { MemoryData } from "../memory";
import type { Tables } from "../schema";
import { NOW } from "./constants";
import { createGen } from "./context";
import { genCases, genUsers } from "./gen-cases";
import { genActivities, genIntakeConsentsPlacements } from "./gen-coaching";
import { genContractDeviations, genInbox, genPulse, genRest } from "./gen-other";
import { genMonthly, genOtherReports } from "./gen-reports";
import { addVoiceData } from "./gen-voice";
import { toTables } from "./map";

/** Demoklockans starttid: måndag 1 februari 2027 kl. 09.12, fem månader in i piloten. */
export const DEMO_START = NOW;

/** Prototypens tillstånd (före mappningen till tabeller) – för jämförelse med den gamla prototypen i tester. */
export function createProtoState() {
  const g = createGen();
  genUsers(g);
  genCases(g);
  genActivities(g);
  genIntakeConsentsPlacements(g);
  genMonthly(g);
  genOtherReports(g);
  genContractDeviations(g);
  genPulse(g);
  const inbox = genInbox(g);
  genRest(g, inbox);
  // Städa bort hjälpfält (prototypen tar bort forcedEnd och interrupted)
  for (const c of g.cases) { delete c.forcedEnd; delete c.interrupted; }
  return g.S;
}

/** Hela testdatat, en rad per objekt i varje tabell. Körs vid varje start av prototypen och utvecklingsläget. */
export function createSeed(): MemoryData<Tables> {
  const S = createProtoState();
  const checkInTags: Record<string, string[]> = {};
  for (const ci of S.checkIns) for (const t of ci.tags ?? []) (checkInTags[t] ??= []).push(ci.id);
  const pulseDemoIds = S.pulseInvites.filter((i) => i.demo).map((i) => i.id);
  const db = toTables(S, { checkInTags, pulseDemoIds });
  addVoiceData(db);
  return db;
}

export { NOW as SEED_NOW, TODAY as SEED_TODAY } from "./constants";
export { decodeTestPnr, encodeTestPnr, normalizePnr, testPnrHash, TEST_PNR_CRYPTO } from "./pnr";
export { ORG_BOTKYRKA, ORG_KK, ORG_MB } from "./map";
export { TEST_VOICE_CONSENT_VERSION } from "./gen-voice";
