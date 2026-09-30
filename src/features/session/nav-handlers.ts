// Hanterare: räknare i sidopanelen. PLATSHÅLLARE – räknas fram av områdena inkorg, coach och notiser i nästa våg.
import { handleQuery } from "@/api/server";
import { navCounts } from "./nav-api";

handleQuery(navCounts, {}, () => ({ inbox: 0, deadlines: 0, unregistered: 0, notifications: 0 }));
