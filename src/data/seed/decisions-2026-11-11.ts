// Steg efter mappningen: granskningen 2026-11-11 i testdatat (påhittade uppgifter). Prototypens tillstånd (createProtoState) och
// generatorerna ändras inte, så slumpen och ordningen ligger kvar – paritetstestet mot den gamla prototypen jämför dem.
//
//   Veckorapportens mejl   Botkyrkaavtalet lämnar inte veckorapporten (närvaro) med e-post – reportDelivery.weekly_attendance har
//                     ingen e-post (reportDeliveryEmail i src/core/config.ts). Prototypens utskick "Veckorapporten för vecka 4 finns
//                     i portalen" (mallen ny_rapport) tas därför bort: inget skickas som avtalet inte säger.
import type { Db } from "../schema";

/** Utskicket om veckorapporten i testdatat (mallen ny_rapport, utan ärende). */
const isWeeklyReportMail = (n: Db["outbound_messages"][number]): boolean =>
  n.template === "ny_rapport" && n.channel === "email" && n.caseId === null && n.body.startsWith("Veckorapporten för vecka");

/** Granskningen 2026-11-11: inget mejl om veckorapporten när avtalet inte lämnar den med e-post. */
export function applyDecisions20261111(db: Db): void {
  db.outbound_messages = db.outbound_messages.filter((n) => !isWeeklyReportMail(n));
}
