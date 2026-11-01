// Kontrakt: räknare i sidopanelen (avrop att hantera, förfaller, oregistrerad närvaro, öppna uppgifter, olästa notiser).
import { z } from "zod";
import { query } from "@/api/contract";

/** tasks = öppna uppgifter till rollen eller personen (paket 2, S2) – siffran vid Min vecka, där uppgifterna står. */
export type NavCounts = { inbox: number; deadlines: number; unregistered: number; tasks: number; notifications: number };
export const navCounts = query("session.navCounts", z.object({})).returns<NavCounts>();
