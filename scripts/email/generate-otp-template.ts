// Skriver supabase/templates/otp.html: Supabase Auths mall för inloggningskoden, genererad från appens kodmejl
// (renderLoginCodeHtml i src/server/notify/render.ts) med {{ .Token }} i stället för koden – så att de ser exakt likadana ut.
// Mallen är bara en reserv: appen skickar koden själv (src/server/auth/code-mail.ts) och Supabase Auth skickar inga mejl.
// Testet i src/server/notify/notify.test.ts kontrollerar att filen stämmer med appens kodmejl.
// Kör: npx tsx scripts/email/generate-otp-template.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderLoginCodeHtml } from "../../src/server/notify/render";

const root = fileURLToPath(new URL("../../", import.meta.url));

const HEADER = `<!--
  RESERV – används inte. Appen skickar inloggningskoden själv via Resend (src/server/auth/code-mail.ts, beslut 2026-10-02):
  servern tar fram koden med auth.admin.generateLink och Supabase Auth skickar inga mejl. Mallen behövs bara om någon
  återgår till att låta Supabase Auth skicka koden (signInWithOtp) – klistra då in hela filen under Authentication -> Emails ->
  Templates i BÅDE "Magic link" och "Confirm signup", med ämnet: Din inloggningskod till Miljonmatch
  GENERERAD FIL – ändra inte för hand. Den ser exakt ut som appens kodmejl: npx tsx scripts/email/generate-otp-template.ts
  Mallen visar BARA koden ({{ .Token }}) – ingen länk. E-postskydd som Microsoft Safe Links öppnar länkar och förbrukar dem.
  Inga personuppgifter, inga bilder, inga spårningspixlar, inga externa typsnitt (Montserrat om det finns, annars Arial).
  MB:s färger: antracit #1E252B, röd #FF0C01 (linjen och punkterna), ljusgrå #D1D3D3, blå #6BA2B9 (bara som kantlinje), vitt.
  Lokalt (Supabase CLI): supabase/config.toml [auth.email.template.magic_link] content_path = "./supabase/templates/otp.html"
-->`;

const html = renderLoginCodeHtml("{{ .Token }}", { testEnvironment: false });
if (!html.startsWith("<!doctype html>\n")) throw new Error("Oväntad början på mallen");
writeFileSync(`${root}supabase/templates/otp.html`, html.replace("<!doctype html>\n", `<!doctype html>\n${HEADER}\n`));
console.log("Skrev supabase/templates/otp.html");
