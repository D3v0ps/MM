// Mejlens layout i en riktig webbläsare (src/server/notify/render.ts): kodmejlet och en notis får plats utan vågrät rullning
// från 320 px bredd (iPhone SE) och uppåt, och knappen är minst 44 px hög. Påhittade värden – ingen riktig kod eller adress.
// Mejlen behöver ingen server, så testet körs bara i projektet "demo".
import { expect, test } from "@playwright/test";
import { renderEmail, renderLoginCodeEmail } from "../../src/server/notify/render";

const APP = "https://www.miljonmatch.se";
const notis = (testEnvironment: boolean) =>
  renderEmail(
    { template: "ordererkannande", to: "handlaggare@exempel.se", subject: "Vi har tagit emot er beställning – BOT-27-0049", body: "Tack! Vi har tagit emot er beställning och gett den ärendenummer BOT-27-0049. Ni får besked om startdatum och ansvarig coach senast tisdag 2 februari 2027 kl. 08.41." },
    { appUrl: APP, staffDomains: ["miljonbemanning.se"], testEnvironment, redirectNote: testEnvironment ? "Testmiljö – det här mejlet skulle ha gått till kommunens handläggare på Botkyrka kommun." : null },
  ).html;

const MAILS: [string, () => string][] = [
  ["kodmejlet (testmiljön)", () => renderLoginCodeEmail("418302", { testEnvironment: true }).html],
  ["kodmejlet (produktion)", () => renderLoginCodeEmail("418302", { testEnvironment: false }).html],
  ["notisen (testmiljön)", () => notis(true)],
  ["notisen (produktion)", () => notis(false)],
];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "demo", "Mejlen renderas utan server – en gång räcker.");
});

for (const [name, html] of MAILS) {
  test(`${name}: ingen vågrät rullning i 320, 360, 380 och 700 px`, async ({ page }) => {
    for (const width of [320, 360, 380, 700]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(html());
      const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(m.scroll, `${name} i ${width} px`).toBe(m.client);
    }
  });
}

test("kodmejlet: koden står på en rad och ryms i den ljusgrå rutan i 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.setContent(renderLoginCodeEmail("418302", { testEnvironment: false }).html);
  const cell = page.locator("td", { hasText: /^418302$/ });
  const box = await cell.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height }));
  expect(box.scroll).toBeLessThanOrEqual(box.client);
  // En rad: 48 px radhöjd + 24 + 8 px utfyllnad.
  expect(box.height).toBe(80);
});

test("notisen: knappen är minst 44 px hög och hela knappen är länken", async ({ page }) => {
  for (const width of [320, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(notis(false));
    const link = page.getByRole("link", { name: "Logga in i portalen" });
    const [a, td] = await Promise.all([link.boundingBox(), link.locator("xpath=..").boundingBox()]);
    expect(a!.height).toBeGreaterThanOrEqual(44);
    expect(a!.width).toBe(td!.width);
    expect(a!.height).toBe(td!.height);
  }
});
