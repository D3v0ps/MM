// Skriver supabase/bootstrap-staging.sql: startdatat för en ny testmiljö (organisationer, avtal, avtalsområden, prislistor,
// helgdagar, testarnas profiler och medlemskap, app_settings). Resten av testdatat läses in i appen av testaren.
// Kör: npx tsx scripts/db/generate-bootstrap.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bootstrapSql } from "./seed-sql";

const target = fileURLToPath(new URL("../../supabase/bootstrap-staging.sql", import.meta.url));
const sql = bootstrapSql();
writeFileSync(target, sql);
console.log(`Skrev ${target}: ${(sql.length / 1024).toFixed(0)} kB`);
