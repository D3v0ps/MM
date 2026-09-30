// Gemensamma hjälpare: samma test körs mot prototypen och mot riktiga appen.
import { expect, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Agenter som bygger parallellt pekar ut sitt eget prototypbygge med MM_DEMO_HTML.
const DEMO_HTML = path.resolve(process.env.MM_DEMO_HTML ?? "dist-demo/index.html");

export const isDemo = (info: TestInfo) => info.project.name === "demo";

/**
 * Öppna en sökväg som en viss användare/roll. Prototypen: hash-URL och rollväljare. Appen: nytt testdata
 * (POST /api/dev-session/reset) och testperson-cookie. Projektet "app" kör ett test i taget (playwright.config.ts).
 */
export async function open(page: Page, info: TestInfo, to: string, as?: { userId: string; role: string }) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  if (isDemo(info)) {
    const html = fs.readFileSync(DEMO_HTML, "utf8");
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("http://proto.test/")) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
      if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
      return route.abort();
    });
    await page.goto("http://proto.test/index.html");
    await page.evaluate((a) => {
      localStorage.clear();
      if (a) localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a));
    }, as ?? null);
    await page.goto(`http://proto.test/index.html#${to}`);
    await page.reload();
  } else {
    // Minnesläget behåller data mellan anropen: börja om från samma testdata och demoklocka som prototypen.
    const reset = await page.request.post("/api/dev-session/reset");
    expect(reset.ok()).toBeTruthy();
    if (as) {
      const res = await page.request.post("/api/dev-session", { data: as });
      expect(res.ok()).toBeTruthy();
    }
    await page.goto(to);
    // Appen hämtar sessionen och frågorna över HTTP (prototypen svarar direkt i webbläsaren): vänta tills sidan har laddat klart.
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page
      .waitForFunction(() => !(document.querySelector("#main")?.textContent ?? "").includes("Hämtar…"), null, { timeout: 15_000 })
      .catch(() => undefined);
  }
  return errors;
}
