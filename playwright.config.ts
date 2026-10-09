// E2E-tester. Tre projekt:
//   demo – prototypbygget (dist-demo/index.html, byggs med npm run demo:build)
//   app  – riktiga appen i Next.js (minnesläge med påhittade testdata och demoklockan)
//   tom  – riktiga appen med tomt testdata och riktig tid (MM_SEED=empty, beslut 2026-10-08): bara tests/e2e/tom.spec.ts
import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const chromium = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
// Porten för appens Next-server. Agenter som kör parallellt väljer egen port (MM_E2E_PORT=3200) så att de inte delar server.
// Servern med tomt testdata (projektet tom) använder porten efter.
const port = Number(process.env.MM_E2E_PORT) || 3100;
const emptyPort = port + 1;
const TOM = /tom\.spec\.ts$/;
const onlyDemo = process.argv.some((a) => a === "--project=demo" || a === "demo");

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
    { name: "demo", use: { baseURL: "http://proto.test" }, metadata: { kind: "demo" }, testIgnore: TOM },
    // En arbetare: varje test börjar med att nollställa serverns testdata (tests/e2e/helpers.ts), så två tester får inte köra samtidigt.
    { name: "app", use: { baseURL: `http://localhost:${port}` }, metadata: { kind: "app" }, workers: 1, testIgnore: TOM },
    // Tomt testdata och riktig tid: egen server, egen port, bara tom.spec.ts (en arbetare – testerna nollställer servern).
    { name: "tom", use: { baseURL: `http://localhost:${emptyPort}` }, metadata: { kind: "app" }, workers: 1, testMatch: TOM },
  ],
  // Next-servrarna behövs bara för projekten "app" och "tom" (kör t.ex. `npx playwright test --project=demo` utan dem).
  webServer: onlyDemo
    ? undefined
    : [
        {
          command: `npx next start -p ${port}`,
          url: `http://localhost:${port}/api/dev-session`,
          reuseExistingServer: true,
          timeout: 120_000,
          env: { MM_BACKEND: "memory" },
        },
        {
          command: `npx next start -p ${emptyPort}`,
          url: `http://localhost:${emptyPort}/api/dev-session`,
          reuseExistingServer: true,
          timeout: 120_000,
          env: { MM_BACKEND: "memory", MM_SEED: "empty" },
        },
      ],
});
