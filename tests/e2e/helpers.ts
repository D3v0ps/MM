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
/**
 * Sidor med osparad text varnar när de lämnas (beforeunload, src/shell/guard.ts). Varningen godkänns (som en användare som
 * väljer "Lämna sidan"), så att testet kan fortsätta – men den räknas: en varning när allt är sparat är ett fel (sidan står
 * kvar som osparad), och open() lägger den i fellistan som testerna kontrollerar. Ett test som med flit lämnar sidan mitt i
 * inmatningen säger det med allowLeaveWarnings(page). Appen använder aldrig alert/confirm/prompt, så övriga dialoger avvisas
 * som Playwright annars gör.
 */
const leaveCount = new WeakMap<Page, number>();
/** Varningar som testet väntar sig (det lämnar sidan med flit mitt i inmatningen). */
const leaveExpected = new WeakMap<Page, number>();
/** Varningar som inte var väntade – open() lägger dem i fellistan. */
const leaveListeners = new WeakMap<Page, ((msg: string) => void)[]>();
export function acceptLeaveWarnings(page: Page) {
  if (leaveCount.has(page)) return;
  leaveCount.set(page, 0);
  page.on("dialog", (d) => {
    if (d.type() === "beforeunload") {
      leaveCount.set(page, (leaveCount.get(page) ?? 0) + 1);
      const expected = leaveExpected.get(page) ?? 0;
      if (expected > 0) leaveExpected.set(page, expected - 1);
      else for (const l of leaveListeners.get(page) ?? []) l(`beforeunload-varning: ${d.message() || "sidan står som osparad"}`);
    }
    void (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => undefined);
  });
}
/** Antalet beforeunload-varningar på sidan hittills (väntade och oväntade). */
export const leaveWarnings = (page: Page): number => leaveCount.get(page) ?? 0;
/**
 * Testet lämnar sidan med flit mitt i inmatningen (count gånger): webbläsarens varning är rätt och räknas inte som fel.
 * Anropa precis före navigeringen.
 */
export function allowLeaveWarnings(page: Page, count = 1) {
  leaveExpected.set(page, (leaveExpected.get(page) ?? 0) + count);
}

export async function open(page: Page, info: TestInfo, to: string, as?: { userId: string; role: string }) {
  acceptLeaveWarnings(page);
  const errors: string[] = [];
  leaveListeners.set(page, [...(leaveListeners.get(page) ?? []), (msg) => errors.push(msg)]);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Chromium hämtar ibland om faviconen mitt i ett sidbyte och tillskriver då anropet ursprunget "null" – då stoppas det
    // av Private Network Access ("blocked by CORS policy … not a secure context … loopback"), följt av "Failed to load
    // resource: net::ERR_FAILED" för samma adress. Det är en kapplöpning inne i webbläsaren (sågs med Chromium 141, både
    // med den gamla och den nya ikonfilen), inte ett fel i appen – ikonen visas ändå. Räknas därför inte som fel.
    const url = m.location()?.url ?? "";
    if (/favicon\.ico|\/icon\.svg|\/apple-icon\.png/.test(url) || /favicon\.ico/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
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
    await loaded(page);
  }
  return errors;
}

/**
 * Appen: byt testperson utan att nollställa testdatat. Lämnar först sidan – annars kan den gamla sidan hinna hämta något
 * (t.ex. frågorna som räknas om efter ett kommando) med den nya testpersonens kaka och få 403 i konsolen för något den
 * nya personen inte får se. Anroparen öppnar sedan sidan som ska visas.
 */
export async function switchPersona(page: Page, as: { userId: string; role: string }) {
  acceptLeaveWarnings(page);
  await page.goto("about:blank");
  const res = await page.request.post("/api/dev-session", { data: as });
  expect(res.ok()).toBeTruthy();
}

/**
 * Appen hämtar sessionen och frågorna över HTTP (prototypen svarar direkt i webbläsaren): vänta tills sidan har laddat
 * klart – sidans innehåll (#main) finns och visar inte längre "Hämtar…". Används efter varje page.goto/reload i appen,
 * innan testet läser sidans text. Tidsgränsen stoppar inte testet – då får testets egna kontroller visa felet.
 */
export async function loaded(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector("#main");
        return !!main && !(main.textContent ?? "").includes("Hämtar…");
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
}
