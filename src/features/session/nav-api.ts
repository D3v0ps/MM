// Kontrakt: räknare i sidopanelen (avrop att hantera, förfaller, oregistrerad närvaro, olästa notiser) och kommunportalens
// menyval som beror på avtalet (resultFile: "Hämta resultat" för kommunens chef när avtalet tillåter individrapporter;
// sharedReports: antal rapporter som Miljonbemanning har delat med kommunens chef – kortet på /portal/resultat).
import { z } from "zod";
import { query } from "@/api/contract";

export type NavCounts = { inbox: number; deadlines: number; unregistered: number; notifications: number; resultFile?: boolean; sharedReports?: number };
export const navCounts = query("session.navCounts", z.object({})).returns<NavCounts>();
