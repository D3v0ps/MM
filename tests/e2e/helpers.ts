// Gemensamma hjälpare: samma test körs mot prototypen och mot riktiga appen.
import { expect, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const DEMO_HTML = path.resolve("dist-demo/index.html");

export const isDemo = (info: TestInfo) => info.project.name === "demo";

/** Öppna en sökväg som en viss användare/roll. Prototypen: hash-URL och rollväljare. Appen: testperson-cookie. */
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
    if (as) {
      const res = await page.request.post("/api/dev-session", { data: as });
      expect(res.ok()).toBeTruthy();
    }
    await page.goto(to);
  }
  return errors;
}
