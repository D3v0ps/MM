// Den interna månadsrapporten (Karims beslut 2026-11-18) – samma test mot prototypen och appen. Bara för Miljonbemanning:
// samordnaren öppnar rapporten från menyn, fäller ut en deltagare, byter månad och yrkesområde (adressen har bara koder) och laddar
// ned PDF:en. Coachen ser rapporten utan resultatgraden. Ekonomen och kommunen har ingen åtkomst.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers";

const SARA = { userId: "u-sara", role: "samordnare" };
const AMIRA = { userId: "u-amira", role: "coach" };
const LARS = { userId: "u-lars", role: "ekonom" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const main = (page: Page) => page.locator("#main");
const hash = (page: Page) => decodeURIComponent(new URL(page.url()).hash || new URL(page.url()).search);

test("samordnaren öppnar rapporten, byter månad och yrkesområde och laddar ned PDF:en", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  await page.locator("aside nav").getByRole("link", { name: "Intern månadsrapport" }).click();
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Intern månadsrapport");
  // Förra månaden är förvald (demoklockan 1 februari 2027).
  const month = main(page).getByLabel("Månad", { exact: true });
  await expect(month).toHaveValue("2027-01");
  for (const h of ["Start och slut per yrkesområde", "Närvarograd", "Progression", "Aktiviteter", "Resultat"]) {
    await expect(main(page).getByRole("heading", { level: 2, name: h, exact: true })).toBeVisible();
  }
  // Diagrammen har ett tillgängligt namn med värdena, och tabellerna har samma tal.
  await expect(main(page).getByRole("img", { name: /Startade och avslutade insatser per yrkesområde, januari 2027\. A Administration: 3 startade, 0 avslutade/ })).toBeVisible();
  await expect(main(page).getByRole("img", { name: /^Närvarograd per yrkesområde, januari 2027/ })).toBeVisible();
  await expect(main(page).getByRole("table", { name: "Start och slut per yrkesområde, januari 2027" })).toContainText("G Lager och logistik");
  await expect(main(page).getByRole("heading", { level: 2, name: /Per deltagare \(134\)/ })).toBeVisible();
  // Samordnaren ser resultatgraden.
  await expect(main(page).getByText(/^Resultatgrad januari 2027$/)).toBeVisible();
  // Raden fälls ut med frånvaron uppdelad och nivåerna per progressionsområde.
  const people = main(page).getByRole("table", { name: "Deltagare i januari 2027" });
  const more = people.getByRole("button", { name: /^Mer om BOT-/ }).first();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const detail = page.locator(`#${await more.getAttribute("aria-controls")}`);
  await expect(detail).toContainText("Ej registrerade");
  await expect(detail).toContainText("Progressionsområden");
  await more.click();
  await expect(detail).toHaveCount(0);

  // Byt månad: februari pågår.
  await month.selectOption("2027-02");
  await expect(main(page).getByText("Månaden pågår")).toBeVisible();
  expect(hash(page)).toContain("manad=2027-02");
  // Byt yrkesområde: bara G – adressen har bara koden.
  await main(page).getByLabel("Yrkesområde", { exact: true }).selectOption("G");
  const flow = main(page).getByRole("table", { name: "Start och slut per yrkesområde, februari 2027" });
  await expect(flow.locator("tbody tr")).toHaveCount(1);
  await expect(flow).toContainText("G Lager och logistik");
  expect(hash(page)).toContain("omrade=G");
  expect(hash(page)).not.toMatch(/Lager|BOT-/);
  const rows = main(page).getByRole("table", { name: "Deltagare i februari 2027" }).locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(5);
  // Raden leder till deltagarkortet.
  await expect(rows.first().getByRole("link")).toHaveAttribute("href", /arenden\/case-/);

  // PDF:en: filnamnet har bara avtalets prefix, rapportens slag och månaden.
  const button = main(page).getByRole("button", { name: "Ladda ner PDF", exact: true });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), button.click()]);
  expect(download.suggestedFilename()).toBe("rapport_bot_manadsrapport_2027-02.pdf");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test("coachen har rapporten i menyn; ekonomen och kommunen har ingen åtkomst", async ({ page }, info) => {
  await open(page, info, "/manadsrapport?manad=2027-01&sortera=narvaro", AMIRA);
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Intern månadsrapport");
  await expect(main(page).getByLabel("Sortera", { exact: true })).toHaveValue("narvaro");
  // Coachen får inte resultatgraden (Karims beslut 2026-11-24) – resten av avsnittet Resultat finns.
  await expect(main(page).getByRole("heading", { level: 2, name: "Resultat", exact: true })).toBeVisible();
  await expect(main(page).getByText("Verifierade resultat")).toBeVisible();
  await expect(main(page)).not.toContainText("Resultatgrad");
  await expect(page.locator("aside nav").getByRole("link", { name: "Intern månadsrapport" })).toBeVisible();
  await open(page, info, "/manadsrapport", LARS);
  await expect(main(page).getByRole("alert")).toContainText("Du har inte behörighet till den här sidan");
  await expect(page.locator("aside nav").getByRole("link", { name: "Intern månadsrapport" })).toHaveCount(0);
  await open(page, info, "/manadsrapport", MARIA);
  await expect(page.getByText("Du har inte behörighet till den här sidan")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Start och slut per yrkesområde");
});
