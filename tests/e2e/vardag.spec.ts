// Vardagen (D0, omgång 2): osparad text skyddas, tabellrader är riktiga länkar, mobilmenyn går att stänga med Esc och
// valt mejl i inkorgen står i adressen. Samma test körs mot prototypen (hash-navigering) och appen.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { isDemo, loaded, open } from "./helpers";

type Who = { userId: string; role: string };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const MARIA: Who = { userId: "k-maria", role: "kommun_handlaggare" };
const NADIA = "case-260143"; // BOT-26-0143, Amira

const main = (page: Page) => page.locator("#main");
/** Sökväg + query som appen ser den (prototypen: efter #). */
const here = (page: Page, info: TestInfo) =>
  page.evaluate((demo) => (demo ? window.location.hash.slice(1) : window.location.pathname + window.location.search), isDemo(info));

async function settle(page: Page, info: TestInfo) {
  if (!isDemo(info)) await loaded(page);
  await page.waitForTimeout(150);
}

/** Ladda om sidan (prototypen: samma hash, testdatat spelas upp igen). */
async function reload(page: Page, info: TestInfo) {
  await page.reload();
  await settle(page, info);
}

// ------------------------------------------------------------ 1. Vakten: osparad avstämning
test("osparad avstämning: menyn frågar först – Stanna kvar behåller texten, Lämna sidan går vidare och utkastet finns kvar", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Veckoavstämning" })).toBeVisible();
  const note = "Ringde två arbetsgivare i lager. Uppföljning på torsdag.";
  await page.locator("#ci-note").fill(note);
  const menuLink = page.locator("aside nav").getByRole("link", { name: /^Min vecka/ });

  // Stanna kvar: ingenting händer, texten finns kvar.
  await menuLink.click();
  const ask = page.getByRole("dialog", { name: "Du har inte sparat" });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Det du har skrivit sparas inte om du lämnar sidan.");
  await ask.getByRole("button", { name: "Stanna kvar" }).click();
  await expect(ask).toBeHidden();
  expect(await here(page, info)).toBe(`/avstamning/${NADIA}`);
  await expect(page.locator("#ci-note")).toHaveValue(note);

  // Lämna sidan: Min vecka visas.
  await menuLink.click();
  await page.getByRole("dialog", { name: "Du har inte sparat" }).getByRole("button", { name: "Lämna sidan" }).click();
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await settle(page, info);
  await expect(main(page).locator("h1").first()).toBeVisible();

  // Tillbaka: utkastet visas igen med en upplysning – och kan kastas.
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe(`/avstamning/${NADIA}`);
  await settle(page, info);
  await expect(page.getByText("Ditt osparade utkast är återställt")).toBeVisible();
  await expect(page.locator("#ci-note")).toHaveValue(note);
  await page.getByRole("button", { name: "Börja om" }).click();
  await expect(page.locator("#ci-note")).toHaveValue("");
  // Utan osparad text frågar menyn inte.
  await menuLink.click();
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await expect(page.getByRole("dialog", { name: "Du har inte sparat" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 2. Radlänken i ärendelistan
test("ärendelistan: ärendenumret är en riktig länk – Ctrl-klick i raden öppnar kortet i en ny flik och listan står kvar", async ({ page, context }, info) => {
  const errors = await open(page, info, "/arenden", AMIRA);
  const table = page.getByRole("table", { name: "Ärenden" });
  const row = table.locator("tbody tr").filter({ hasText: "BOT-26-0143" });
  const link = row.getByRole("link", { name: /BOT-26-0143/ });
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toContain(`/arenden/${NADIA}`);
  // Raden har inget eget tabbstopp: länken är det enda stoppet.
  expect(await row.getAttribute("tabindex")).toBeNull();

  if (isDemo(info)) {
    // Den nya fliken laddar samma prototypfil.
    const html = fs.readFileSync(path.resolve(process.env.MM_DEMO_HTML ?? "dist-demo/index.html"), "utf8");
    await context.route("http://proto.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  }
  const popupP = context.waitForEvent("page");
  await row.locator("td").nth(2).click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupP;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toContain(`/arenden/${NADIA}`);
  if (!isDemo(info)) {
    await loaded(popup);
    await expect(popup.locator("#main h1").first()).toContainText(/Nadia/);
  }
  await popup.close();
  // Listan står kvar i den första fliken.
  expect(await here(page, info)).toBe("/arenden");
  await expect(table).toBeVisible();

  // Vanligt klick i raden öppnar kortet i samma flik.
  await row.locator("td").nth(2).click();
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}`);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 3. Mobilmenyn
test("mobilmenyn (390 px): Meny öppnar, första valet får fokus, Esc stänger och fokus går tillbaka till Meny", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, info, "/arenden", SARA);
  const button = page.getByRole("button", { name: "Meny", exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // Den fasta toppraden ligger kvar överst när man skrollar.
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(100);
  expect(Math.round((await button.boundingBox())!.y)).toBeLessThan(64);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.locator("#huvudmeny");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // Ett menyval byter sida och stänger menyn.
  await button.click();
  await menu.getByRole("link", { name: /^Rapporter/ }).click();
  await expect.poll(() => here(page, info)).toBe("/rapporter");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test("portalens mobilmeny (390 px): samma Meny-knapp och Esc stänger", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, info, "/portal/deltagare", MARIA);
  const button = page.getByRole("button", { name: "Meny", exact: true });
  await expect(button).toBeVisible();
  const header = await page.locator("header").filter({ has: button }).boundingBox();
  expect(header!.height, "portalens huvud är en rad på mobil").toBeLessThanOrEqual(80);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Portalmeny" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 4. Valt mejl i inkorgen står i adressen
test("inkorgen: valt mejl och flik står i adressen – omladdning visar samma mejl, och Tillbaka går inte mejl för mejl", async ({ page }, info) => {
  const errors = await open(page, info, "/start", SARA);
  await page.locator("aside nav").getByRole("link", { name: /^Avropsinkorg/ }).first().click();
  await expect.poll(() => here(page, info)).toMatch(/^\/inkorg/);
  await settle(page, info);
  const rows = page.locator("[data-inkorg-row]");
  await expect(rows.first()).toBeVisible();
  // Välj ett annat mejl än det som visas.
  const other = page.locator("[data-inkorg-row]:not([aria-current])").first();
  const subject = (await other.locator("span.text-ui").first().innerText()).trim();
  await other.click();
  await expect(main(page).locator("h2").filter({ hasText: subject }).first()).toBeVisible();
  const url = await here(page, info);
  expect(url).toMatch(/^\/inkorg\/em-[\w-]+$/);
  // Fliken Alla: i adressen.
  await page.getByRole("tab", { name: /^Alla/ }).click();
  await expect.poll(() => here(page, info)).toBe(`${url}?visa=alla`);

  await reload(page, info);
  expect(await here(page, info)).toBe(`${url}?visa=alla`);
  await expect(page.getByRole("tab", { name: /^Alla/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-inkorg-row][aria-current="true"]')).toContainText(subject);
  await expect(main(page).locator("h2").filter({ hasText: subject }).first()).toBeVisible();

  // Valet byter inte sida (replace): ett steg tillbaka leder till startsidan. Posten är från före omladdningen – appen
  // laddar då om sidan på dess adress (src/app/_shell/pop-guard.ts), så adressen läses medan sidan kan laddas om.
  await page.goBack();
  await expect.poll(() => here(page, info).catch(() => "")).toBe("/start");
  await settle(page, info);
  await expect(page).toHaveTitle("Startsida – Miljonmatch");
  expect(errors).toEqual([]);
});
