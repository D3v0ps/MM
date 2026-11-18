// Delmål för progressionerna (Karims beslut 2026-11-11). Samma steg mot prototypen och appen: avtalsansvarig lägger till ett
// delmål i katalogen (/avtal/delmal) som räknas mot steg 1 – genomförd branschintroduktion; coachen skapar en gruppaktivitet som
// tränar delmålet och registrerar Nadias närvaro; deltagarkortet visar Tränar (automatiskt); coachen markerar delmålet uppnått och
// punkten i steg 1 under Progression och resultat blir uppfylld; kommunen ser inget av det. Bara påhittade uppgifter.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

const JOHAN = { userId: "u-johan", role: "avtalsansvarig" };
const COACH = { userId: "u-amira", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const NADIA = "case-260143";
const GOAL = "Har provat på ett yrkesmoment i köket";
const AREA = "Yrkesfärdigheter/praktisk förmåga";

const main = (page: Page) => page.locator("#main");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" });
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const card = (page: Page, title: string) => main(page).locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).first();
function currentPath(page: Page, info: TestInfo): string {
  const u = new URL(page.url());
  return isDemo(info) ? decodeURIComponent(u.hash.replace(/^#/, "")) : `${u.pathname}${u.search}`;
}
async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, to);
  else {
    await page.goto(to);
    await loaded(page);
  }
  await expect(main(page)).toBeVisible();
}
/** Byt testperson utan att nollställa det man gjort. */
async function switchUser(page: Page, info: TestInfo, as: { userId: string; role: string }, to: string) {
  if (isDemo(info)) {
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), as);
    await page.evaluate((p) => { window.location.hash = p; }, to);
    await page.reload();
  } else {
    await switchPersona(page, as);
    await page.goto(to);
    await loaded(page);
  }
  await expect(main(page)).toBeVisible();
}

test("Delmål: avtalsansvarig lägger till – coachen tränar det i en gruppaktivitet, närvaron ger Tränar, Uppnått uppfyller steg 1 – kommunen ser inget", async ({ page }, info) => {
  // 1. Avtalsansvarig: katalogen per progressionsområde, ett nytt delmål som räknas mot steg 1.
  const errors = await open(page, info, "/avtal/delmal", JOHAN);
  await expect(page.getByRole("heading", { level: 1, name: "Delmål" })).toBeVisible();
  const area = card(page, AREA);
  await expect(area).toContainText("Genomfört branschintroduktion");
  await btn(area, `Lägg till delmål – ${AREA}`).click();
  const add = page.getByRole("dialog", { name: `Lägg till delmål – ${AREA}` });
  await add.getByLabel("Delmål").fill(GOAL);
  await add.getByLabel("Steg 1 · Genomförd branschintroduktion").check();
  await btn(add, "Lägg till").click();
  await expect(add).toHaveCount(0);
  await expect(toasts(page)).toContainText(`${GOAL} är tillagt.`);
  const row = area.locator("[data-delmal]").filter({ hasText: GOAL });
  await expect(row).toContainText("Genomförd branschintroduktion");

  // 2. Coachen: en gruppaktivitet i morse som tränar delmålet, med Nadia.
  await switchUser(page, info, COACH, "/aktiviteter/ny");
  await expect(page.getByRole("heading", { level: 1, name: "Ny aktivitet" })).toBeVisible();
  await page.locator("#ny-akt-namn").fill("Kök och servering");
  await page.locator("#ny-akt-datum").fill("2027-02-01");
  await page.locator("#ny-akt-tid").fill("08:00");
  const picker = page.getByTestId("tranar-delmal");
  await btn(picker, "Välj delmål").click();
  await picker.getByLabel(GOAL).check();
  await expect(picker).toContainText("Tränar delmål (1)");
  await page.locator("#ny-bjud-sok").fill("Nadia");
  await page.locator(`#ny-bjud-${NADIA}`).check();
  await btn(page, "Skapa aktiviteten med 1 deltagare").click();
  await expect(toasts(page)).toContainText("Aktiviteten är skapad med 1 deltagare.");
  await expect.poll(() => currentPath(page, info)).toMatch(/^\/aktiviteter\/[^/]+$/);
  await expect(main(page)).toContainText(GOAL);
  const nadia = page.getByTestId("aktivitet-deltagare").filter({ hasText: "Nadia Warsame" });
  const att = nadia.getByRole("group", { name: "Närvaro för Nadia Warsame" });
  await btn(att, "Närvarande").click();
  await expect(btn(att, "Närvarande")).toHaveAttribute("aria-pressed", "true");

  // 3. Deltagarkortet: Tränar (automatiskt) – coachen markerar delmålet uppnått i dag.
  await go(page, info, `/arenden/${NADIA}?flik=handelser`);
  const goals = card(page, "Delmål");
  const goal = goals.locator("[data-delmal]").filter({ hasText: GOAL });
  await expect(goal).toContainText("Tränar (automatiskt)");
  const steps = card(page, "Progression och resultat");
  await expect(steps.getByTestId("steg-punkter").first()).toContainText("Genomförd branschintroduktion: Inte uppfyllt");
  await btn(goal, `Markera uppnått – ${GOAL}`).click();
  const dlg = page.getByRole("dialog", { name: "Markera uppnått" });
  await expect(dlg).toContainText(GOAL);
  await btn(dlg, "Markera uppnått").click();
  await expect(dlg).toHaveCount(0);
  await expect(toasts(page)).toContainText(`${GOAL}: uppnått.`);
  await expect(goal).toContainText("Uppnått 1 feb 2027");
  await expect(btn(goal, `Ångra – ${GOAL}`)).toBeVisible();
  await expect(steps.getByTestId("steg-punkter").first()).toContainText(`Genomförd branschintroduktion: Uppfyllt – ${GOAL}`);
  expect(await main(page).innerText()).not.toMatch(/undefined|NaN|\[object Object\]/);

  // 4. Kommunen: deltagarens sida i portalen har inga delmål.
  await switchUser(page, info, MARIA, `/portal/deltagare/${NADIA}`);
  await expect(main(page)).toContainText("BOT-26-0143");
  const text = await main(page).innerText();
  expect(text).not.toContain(GOAL);
  expect(text).not.toMatch(/Delmål|Tränar|Genomfört branschintroduktion/);
  expect(errors).toEqual([]);
});
