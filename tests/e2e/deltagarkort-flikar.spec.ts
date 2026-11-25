// Deltagarkortets flikar (Karims beslut 2026-11-25): sex flikar i raden – Översikt · Närvaro · Möten · Anteckningar · Delmål ·
// Progression och resultat – och resten under menyknappen Mer. Samma test mot prototypen och appen. Bara påhittade uppgifter.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { cardMore, CARD_MORE_TABS, expectCardTab, isDemo, loaded, open, openCardTab } from "./helpers";

const AMIRA = { userId: "u-amira", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const NADIA = "case-260143"; // BOT-26-0143, huvudcoach Amira – har delmål (Tränar automatiskt) och ett oläst meddelande från Maria

const main = (page: Page) => page.locator("#main");
const here = (page: Page, info: TestInfo) =>
  page.evaluate((demo) => (demo ? decodeURIComponent(window.location.hash.slice(1)) : window.location.pathname + window.location.search), isDemo(info));
async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, to);
  else {
    await page.goto(to);
    await loaded(page);
  }
  await expect(main(page)).toBeVisible();
}

test("sex flikar och Mer: Mer med tangentbordet, Mer → Kartläggning, Delmål visar delmålen, djuplänk visar 'Mer: Historik'", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${NADIA}`, AMIRA);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nadia Warsame");

  // 1. Raden: sex flikar i beslutets ordning och Mer sist. Siffran på Mer är det olästa meddelandet.
  await expect(page.getByRole("tablist", { name: "Delar av deltagarkortet" }).getByRole("tab")).toHaveText(
    ["Översikt", "Närvaro", "Möten", "Anteckningar", "Delmål", "Progression och resultat"].map((x) => new RegExp(`^${x}`)),
  );
  const mer = cardMore(page);
  await expect(mer).toHaveAttribute("aria-haspopup", "menu");
  await expect(mer).toHaveAttribute("aria-expanded", "false");
  await expect(mer).toHaveText(/^Mer\s*1/);
  expect(await mer.evaluate((el) => el.closest("[role=tablist]")), "Mer står utanför flikraden").toBeNull();
  const box = (await mer.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  // 2. Tangentbordet: Enter öppnar menyn med fokus på första valet, pil ned går vidare, Esc stänger och fokus går tillbaka till Mer.
  await mer.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(mer).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitemradio")).toHaveText(CARD_MORE_TABS.map((t) => new RegExp(`^${t}`)));
  await expect(menu.getByRole("menuitemradio", { name: /^Meddelanden/ })).toContainText("1");
  await expect(menu.getByRole("menuitemradio", { name: /^Tidslinje/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: /^Kartläggning/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(mer).toBeFocused();
  await expect(mer).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}`);

  // 3. Mer → Kartläggning (med tangentbordet): fliken öppnas, Mer visar var man är, fokus tillbaka på Mer.
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}?flik=kartlaggning`);
  await expect(page.getByRole("button", { name: /^Mer: Kartläggning/ })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Kartläggning" })).toContainText("Kartläggning");
  await expect(page.getByRole("tablist").getByRole("tab", { selected: true })).toHaveCount(0);
  // Den valda står markerad i menyn.
  await cardMore(page).click();
  await expect(menu.getByRole("menuitemradio", { name: /^Kartläggning/ })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: /^Tidslinje/ })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  // 4. Delmål är en egen flik: delmålen per område med läget i text.
  await page.getByRole("tab", { name: /^Delmål/ }).click();
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}?flik=delmal`);
  await expect(cardMore(page)).toHaveText(/^Mer\s*1/);
  const goals = page.getByRole("tabpanel", { name: "Delmål" });
  await expect(goals.locator("[data-delmal]").first()).toBeVisible();
  await expect(goals).toContainText("Tränar (automatiskt)");
  await expect(goals.getByRole("button", { name: /^Markera uppnått/ }).first()).toBeVisible();

  // 5. Progression och resultat (nyckeln handelser är kvar) – delmålen står inte längre där.
  await page.getByRole("tab", { name: /^Progression och resultat/ }).click();
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}?flik=handelser`);
  const events = page.getByRole("tabpanel", { name: "Progression och resultat" });
  await expect(events).toContainText("Utfall");
  await expect(events.locator("[data-delmal]")).toHaveCount(0);

  // 6. Djuplänkar: ?flik=historik visar "Mer: Historik", ?flik=delmal öppnar Delmål.
  await go(page, info, `/arenden/${NADIA}?flik=historik`);
  await expect(page.getByRole("button", { name: /^Mer: Historik/ })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Historik" })).toBeVisible();
  await go(page, info, `/arenden/${NADIA}?flik=delmal`);
  await expectCardTab(page, "Delmål");
  await expect(page.getByRole("tabpanel", { name: "Delmål" }).locator("[data-delmal]").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("390 px: sex flikar och Mer utan sidledsscroll – flikraden skrollar i sin egen ruta, Mer står kvar och fungerar", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, info, `/arenden/${NADIA}?flik=manad`, AMIRA);
  await expectCardTab(page, "Månadsunderlag");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), "ingen sidledsscroll").toBeLessThanOrEqual(0);
  const mer = page.getByRole("button", { name: /^Mer: Månadsunderlag/ });
  await expect(mer).toBeInViewport({ ratio: 1 });
  const box = (await mer.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await mer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "texten på Mer klipps inte").toBe(true);
  // Flikraden rullar i sin egen ruta.
  const strip = await page.getByRole("tablist", { name: "Delar av deltagarkortet" }).evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(strip[0]).toBeGreaterThan(strip[1]);
  await openCardTab(page, "Praktik");
  await expectCardTab(page, "Praktik");
  await page.getByRole("tab", { name: /^Delmål/ }).click();
  await expectCardTab(page, "Delmål");
  expect(await overflow(), "ingen sidledsscroll").toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("kommunens deltagarsida är oförändrad: ingen Mer och ingen flik Delmål", async ({ page }, info) => {
  const errors = await open(page, info, `/portal/deltagare/${NADIA}`, MARIA);
  await expect(main(page)).toContainText("BOT-26-0143");
  await expect(page.getByRole("tab").first()).toBeVisible();
  await expect(cardMore(page)).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Delmål|Progression och resultat/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
