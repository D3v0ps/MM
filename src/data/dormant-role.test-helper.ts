// Bara för testerna: rollen handledare – borttagen ur appen, Karims beslut 2026-10-09; vilande så att den kan slås på igen utan
// migration. Ingen har rollen i testdatat (Petra, David och Hanna är coacher) och appen kan inte ge den, så testpersonerna
// (listPersonas) har den inte. Aktören byggs här när ett test prövar att reglerna för den vilande rollen ligger kvar
// (policy.ts, RLS och hanterarnas rollkontroller) – samma form som actorFor() skulle ge med ett medlemskap i avtalet.
import type { Actor } from "@/api/roles";

export const dormantSupervisor = (userId = "u-petra", contractIds: string[] = ["c-bot"]): Actor => ({ userId, role: "handledare", contractIds, customerUnit: null });
