// Punkterna i steg 1–2 kryssas i direkt på kortet Progression och resultat (Karims beslut 2026-11-25). Samma test mot prototypen och
// appen: coachen öppnar BOT-26-0130 (Mehmet, huvudcoach Amira, inga uppnådda delmål) → Progression och resultat → Förbättrade
// ansökningshandlingar (med tangentbordet) → kryssar i två delmål → Spara: punkten är uppfylld och fliken Delmål visar båda som
// Uppnått. Påbörjat praktik eller arbetsträning ger förslaget till steg 2 direkt. Chefen läser punkterna utan att kunna kryssa i.
// Bara påhittade uppgifter.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open } from "./helpers";

const AMIRA = { userId: "u-amira", role: "coach" };
const KARIN = { userId: "u-karin", role: "chef" };
const MEHMET = "case-260130";
const ANS = "Förbättrade ansökningshandlingar";
const CV = "Har ett uppdaterat CV";
const BREV = "Har ett personligt brev";
const PRAKTIK = "Påbörjat praktik eller arbetsträning";

const main = (page: Page) => page.locator("#main");
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const card = (page: Page, title: string) => main(page).locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).first();
const item = (scope: Locator, label: string) => scope.getByRole("button", { name: new RegExp(`^${label}:`) });
function currentPath(page: Page, info: TestInfo): string {
  const u = new URL(page.url());
  return isDemo(info) ? decodeURIComponent(u.hash.replace(/^#/, "")) : `${u.pathname}${u.search}`;
}

test("coachen kryssar i två delmål under Förbättrade ansökningshandlingar – punkten är uppfylld och fliken Delmål visar Uppnått", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${MEHMET}?flik=handelser`, AMIRA);
  await expect(page.getByRole("tab", { name: /^Progression och resultat/ })).toHaveAttribute("aria-selected", "true");
  const steps = card(page, "Progression och resultat");
  await expect(steps).toContainText("Steg 1 · Dokumenterad progression");
  // Ingen knapp i kortets huvud och ingen förklaring av stegen – bara stegen med sitt läge.
  await expect(steps.getByRole("button", { name: /^Skapa underlag/ })).toHaveCount(0);
  await expect(steps).not.toContainText("Så fungerar stegen");
  await expect(steps).not.toContainText("Skapa anspråket för steg 3 först");
  await expect(steps).not.toContainText("Inget anspråk än");

  // 1. Punkten är en knapp (minst 44 × 44 px) med läget i text – öppnas med tangentbordet.
  const ans = item(steps, ANS);
  await expect(ans).toHaveText(`${ANS}: Inte uppfyllt (0 av 2)`);
  await expect(ans).toHaveAttribute("aria-haspopup", "dialog");
  const box = (await ans.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await ans.focus();
  await page.keyboard.press("Enter");

  // 2. Dialogen: rubriken är punkten, delmålen med läget, datum i dag.
  const dlg = page.getByRole("dialog", { name: ANS });
  await expect(dlg).toBeVisible();
  const goals = dlg.getByTestId("punkt-delmal");
  await expect(goals.locator("[data-punkt-delmal]")).toHaveCount(4);
  await expect(goals.locator("[data-punkt-delmal]").filter({ hasText: CV })).toContainText("Inte påbörjat");
  await expect(dlg.getByLabel("Datum")).toHaveValue("2027-02-01");
  await dlg.getByLabel(CV).check();
  await dlg.getByLabel(BREV).check();
  await dlg.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  await expect(toasts(page)).toContainText(`${ANS}: sparat.`);

  // 3. Punkten är uppfylld direkt.
  await expect(item(steps, ANS)).toHaveText(`${ANS}: Uppfyllt – ${CV}, ${BREV}`);

  // 4. Påbörjat praktik eller arbetsträning: punkten i steg 2 uppfylls och reglerna skapar förslaget till steg 2.
  await item(steps, "Praktik eller arbetsträning").click();
  const dlg2 = page.getByRole("dialog", { name: "Praktik eller arbetsträning" });
  await dlg2.getByLabel(PRAKTIK).check();
  await dlg2.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dlg2).toHaveCount(0);
  await expect(toasts(page)).toContainText("Ett nytt förslag finns att granska.");
  await expect(steps).toContainText("Förslag att granska");
  await expect(steps.getByRole("link", { name: /^Granska och skicka\s+steg 2/ })).toBeVisible();
  await expect(item(steps, "Praktik eller arbetsträning")).toHaveText(`Praktik eller arbetsträning: Uppfyllt – ${PRAKTIK}`);

  // 5. Fliken Delmål visar samma: båda uppnådda i dag.
  await page.getByRole("tab", { name: /^Delmål/ }).click();
  await expect.poll(() => currentPath(page, info)).toBe(`/arenden/${MEHMET}?flik=delmal`);
  const tab = card(page, "Delmål");
  for (const g of [CV, BREV, PRAKTIK]) await expect(tab.locator("[data-delmal]").filter({ hasText: g })).toContainText("Uppnått 1 feb 2027");
  expect(await main(page).innerText()).not.toMatch(/undefined|NaN|\[object Object\]/);
  expect(errors).toEqual([]);
});

test("chefen läser punkterna utan att kunna kryssa i", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${MEHMET}?flik=handelser`, KARIN);
  const steps = card(page, "Progression och resultat");
  await expect(steps.getByTestId("steg-punkter").first()).toContainText(`${ANS}: Inte uppfyllt (0 av 2)`);
  await expect(steps.getByTestId("steg-punkter").getByRole("button")).toHaveCount(0);
  await expect(steps.getByRole("button", { name: /^Skapa underlag/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
