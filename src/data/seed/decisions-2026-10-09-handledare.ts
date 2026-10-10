// Steg efter mappningen: rollen handledare bort ur testdatat (Karims beslut 2026-10-09). Rollen finns inte i verkligheten –
// två jobbcoacher har rollen coach. Rollen ligger kvar vilande i databasen och i src/core, men ingen kan få den.
// Prototypens tillstånd (createProtoState) och generatorerna ändras inte, så slumpen och ordningen i den gamla prototypen
// ligger kvar och paritetstestet jämför samma värden (src/core/parity/sections.ts normaliserar det som skiljer).
//
//   Petra Ek, David Olsson och Hanna Strand   hade rollen handledare – får rollen coach.
//   Petra Ek                                   titeln blir jobbcoach och teamrollen yrkesspecifik handledare tas bort:
//                                              hennes platser i teamen (vocational_supervisor) tas bort, eftersom teamvalet
//                                              Handledare inte längre finns. Hennes anteckning och tidigare notiser ligger kvar.
//   David och Hanna                            behåller sina platser i teamen (arbetsgivarmatchare och SYV/metodstöd).
import type { Db } from "../schema";

/** De tre i testdatat som hade rollen handledare. */
export const FORMER_SUPERVISORS = ["u-petra", "u-david", "u-hanna"] as const;

export function applyNoSupervisorRole(db: Db): void {
  // Medlemskapets id är <användare>:<avtal> (map.ts) – bara rollen byts.
  for (const m of db.memberships) if (m.role === "handledare") m.role = "coach";
  const petra = db.profiles.find((p) => p.id === "u-petra");
  if (petra) Object.assign(petra, { title: "Jobbcoach – lager, logistik och transport", teamRole: null });
  db.case_team = db.case_team.filter((t) => t.role !== "vocational_supervisor");
}
