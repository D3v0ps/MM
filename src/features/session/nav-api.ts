// Kontrakt: räknare i sidopanelen (avrop att hantera, förfaller, oregistrerad närvaro, olästa notiser).
import { z } from "zod";
import { query } from "@/api/contract";

export type NavCounts = { inbox: number; deadlines: number; unregistered: number; notifications: number };
export const navCounts = query("session.navCounts", z.object({})).returns<NavCounts>();
