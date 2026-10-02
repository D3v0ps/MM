// E2E-tester. Två projekt kör samma scenarier:
//   demo – prototypbygget (dist-demo/index.html, byggs med npm run demo:build)
//   app  – riktiga appen i Next.js (minnesläge med påhittade testdata)
import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const chromium = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
// Porten för appens Next-server. Agenter som kör parallellt väljer egen port (MM_E2E_PORT=3200) så att de inte delar server.
const port = Number(process.env.MM_E2E_PORT) || 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 2,
  reporter: [["list"]],
  use: {
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: chromium },
  },
  projects: [
    { name: "demo", use: { baseURL: "http://proto.test" }, metadata: { kind: "demo" } },
    // En arbetare: varje test börjar med att nollställa serverns testdata (tests/e2e/helpers.ts), så två tester får inte köra samtidigt.
    { name: "app", use: { baseURL: `http://localhost:${port}` }, metadata: { kind: "app" }, workers: 1 },
  ],
  // Next-servern behövs bara för projektet "app" (kör t.ex. `npx playwright test --project=demo` utan den).
  webServer: process.argv.some((a) => a === "--project=demo" || a === "demo") ? undefined : {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}/api/dev-session`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { MM_BACKEND: "memory" },
  },
});
