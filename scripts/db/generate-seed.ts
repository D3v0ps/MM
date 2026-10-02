// Skriver supabase/seed.sql från samma påhittade testdata som prototypen (src/data/seed) plus testarna.
// Kör: npx tsx scripts/db/generate-seed.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seedData, seedSql } from "./seed-sql";

const target = fileURLToPath(new URL("../../supabase/seed.sql", import.meta.url));
const data = seedData();
const sql = seedSql(data);
writeFileSync(target, sql);
const rows = Object.values(data).reduce((n, rows) => n + (rows as unknown[]).length, 0);
console.log(`Skrev ${target}: ${rows} rader, ${(sql.length / 1024 / 1024).toFixed(1)} MB`);
