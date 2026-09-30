// Kontrakt: session och diagnos.
import { z } from "zod";
import { query } from "@/api/contract";

export const sessionPing = query("session.ping", z.object({})).returns<{ now: string; role: string; userId: string }>();
