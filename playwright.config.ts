// E2E-tester. Två projekt kör samma scenarier:
//   demo – prototypbygget (dist-demo/index.html, byggs med npm run demo:build)
//   app  – riktiga appen i Next.js (minnesläge med påhittade testdata)
import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const chromium = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;

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
    { name: "app", use: { baseURL: "http://localhost:3100" }, metadata: { kind: "app" } },
  ],
  webServer: {
    command: "npx next start -p 3100",
    url: "http://localhost:3100/api/dev-session",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { MM_BACKEND: "memory" },
  },
});
