// Starta insatsen, veckoplan, praktik och team (beslut 2026-10-08, skarp drift). Hela kedjan som i skarp drift saknades:
// acceptera avropet → coachens Min vecka visar Insatser att starta → Starta insatsen (veckoplan) → tillfällen i Närvaro →
// registrera närvaro → dagens tillfälle på Min vecka → veckan i ekonomens underlag. Samma test mot prototypen (projekt "demo")
// och appen (projekt "app"). Demoklockan: måndag 1 februari 2027 kl. 09.12 – första mötet bokas i dag 09.00 så att det har hållits.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
/** Petra Ek – coach sedan rollen handledare togs bort (Karims beslut 2026-10-09). */
const PETRA: Who = { userId: "u-petra", role: "coach" };
const LARS: Who = { userId: "u-lars", role: "ekonom" };
/** Marias avrop em-101 (Word-mallen) blir BOT-27-0050 när det accepteras; Diego Morales är deltagaren i testdatat. */
const CASE = "case-270050";
const CASE_NO = "BOT-27-0050";
/** Bekräftat ärende utan Petra i teamet (första mötet inte bokat). */
const TEAM_CASE = "case-270039";

const main = (page: Page) => page.locator("#main");
const dialog = (page: Page, name?: string | RegExp) => page.getByRole("dialog", name ? { name } : undefined);
const toastWith = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** Byt testperson utan att nollställa det man gjort. */
async function switchTo(page: Page, info: TestInfo, to: string, who: Who) {
  if (isDemo(info)) {
    await page.route("http://proto.test/blank.html", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Byter testperson</title>" }));
    await page.goto("http://proto.test/blank.html");
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), who);
    await page.goto(`http://proto.test/index.html#${to}`);
  } else {
    await switchPersona(page, who);
    await page.goto(to);
    await loaded(page);
  }
  await expect(main(page)).toBeVisible();
}
async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) await page.goto(`http://proto.test/index.html#${to}`);
  else {
    await page.goto(to);
    await loaded(page);
  }
}

test("acceptera → Insatser att starta → Starta insatsen → tillfällen i Närvaro → närvaro → Min vecka → ekonomens underlag", async ({ page }, info) => {
  test.setTimeout(120_000);
  // 1. Samordnaren accepterar avropet med första möte i dag 09.00.
  const errors = await open(page, info, "/inkorg/em-101", SARA);
  await main(page).getByRole("button", { name: "Acceptera", exact: true }).click();
  const d = dialog(page);
  await page.check("#ink-coach-u-amira");
  await page.fill("#ink-fm-date", "2027-02-01");
  await page.fill("#ink-fm-time", "09:00");
  await d.getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(d.getByText("Amira Haddad har fått en notis om tilldelningen")).toBeVisible();
  await d.getByRole("button", { name: "Klart" }).click();

  // 2. Coachens Min vecka: Insatser att starta med knappen.
  await switchTo(page, info, "/min-vecka", AMIRA);
  const starta = page.locator("#mv-starta");
  await expect(starta).toContainText("Insatser att starta");
  await expect(starta).toContainText("Diego Morales");
  await expect(starta).toContainText(CASE_NO);
  await starta.getByRole("link", { name: "Starta insatsen" }).click();

  // 3. Dialogen öppnas på deltagarkortet med avtalets standardplan: coachträff måndag (första mötets dag), yrkesmoment tisdag och torsdag.
  const sd = dialog(page, "Starta insatsen");
  await expect(sd).toBeVisible();
  await expect(sd.locator("#arn-start-date")).toHaveValue("2027-02-01");
  await expect(sd.locator("#arn-plan-d0")).toBeChecked();
  await expect(sd.locator("#arn-plan-d1")).toBeChecked();
  await expect(sd.locator("#arn-plan-d2")).not.toBeChecked();
  await expect(sd.locator("#arn-plan-d3")).toBeChecked();
  await expect(sd.locator("#arn-plan-d4")).not.toBeChecked();
  await expect(sd.locator("#arn-plan-k0")).toHaveValue("möte");
  await expect(sd.locator("#arn-plan-t0")).toHaveValue("09:00");
  await expect(sd).toContainText("3 tillfällen per vecka");
  await sd.getByRole("button", { name: "Starta insatsen" }).click();
  await expect(toastWith(page, /Insatsen är startad\. \d+ tillfällen är inplanerade till och med/)).toBeVisible();
  await expect(main(page).getByText("Pågår", { exact: true }).first()).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Starta insatsen" })).toHaveCount(0);

  // 4. Fliken Närvaro: kommande tillfällen (kan tas bort) och knapparna Ändra veckoplan och Lägg till tillfälle.
  await page.getByRole("tab", { name: /^Närvaro/ }).click();
  const upcoming = main(page).locator("section").filter({ has: page.locator("h2", { hasText: "Kommande tillfällen" }) });
  await expect(upcoming).toContainText(/tisdag 2 feb 2027 kl\. 09\.00/i);
  await expect(upcoming).toContainText("Yrkesmoment");
  await expect(main(page).getByRole("button", { name: "Ändra veckoplan" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Lägg till tillfälle" })).toBeVisible();

  // 5. Närvaro: dagens coachträff registreras som närvarande.
  await go(page, info, `/narvaro?arende=${CASE}`);
  await expect(main(page)).toContainText(`Visar bara ${CASE_NO}`);
  const row = page.locator("[data-testid=narvaro-rad]").filter({ hasText: "Diego Morales" }).filter({ hasText: "09.00" }).first();
  await expect(row).toContainText("Coachträff");
  await row.getByRole("button", { name: "Närvarande", exact: true }).click();
  await expect(row.getByText("Närvarande", { exact: true }).first()).toBeVisible();
  // Planerade tillfällen senare i veckan kan tas bort tills närvaro registrerats.
  await page.getByRole("button", { name: /^Alla \(/ }).click();
  await page.getByRole("group", { name: "Dag" }).getByRole("button", { name: /^Hela veckan/ }).click();
  await expect(page.locator("[data-testid=narvaro-rad]").filter({ hasText: "Diego Morales" }).filter({ hasText: "Planerat" }).first().getByRole("button", { name: "Ta bort" })).toBeVisible();

  // 6. Min vecka: dagens tillfälle med närvaron, och veckan i kalendern.
  await go(page, info, "/min-vecka");
  await expect(page.locator("#mv-starta")).toHaveCount(0);
  await expect(page.locator("#mv-idag")).toContainText("Diego Morales");
  await expect(page.locator("#mv-idag")).toContainText("Närvarande");

  // 7. Ny praktik från deltagarkortet: placering, praktikdagar och händelsen Praktik startad.
  await go(page, info, `/arenden/${CASE}?flik=praktik`);
  await main(page).getByRole("button", { name: "Ny praktik" }).first().click();
  const pd = dialog(page, "Ny praktik");
  await pd.locator("#pl-emp").selectOption("__ny__");
  await pd.locator("#pl-name").fill("Testföretaget AB");
  await pd.locator("#pl-city").fill("Tumba");
  await pd.locator("#pl-sup").fill("Eva Test");
  await pd.locator("#pl-start").fill("2027-02-08");
  await pd.locator("#pl-end").fill("2027-02-19");
  await pd.getByRole("button", { name: "Spara praktiken" }).click();
  await expect(toastWith(page, "Praktiken hos Testföretaget AB är registrerad. 10 praktikdagar är inplanerade.")).toBeVisible();
  await expect(main(page)).toContainText("Testföretaget AB");
  await expect(main(page).getByText("Planerad", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: /Händelser/ }).click();
  await expect(main(page)).toContainText("Praktik");
  await expect(main(page)).toContainText("Testföretaget AB");

  // 8. Ekonomen ser veckan i ärendets underlag – inga namn.
  await switchTo(page, info, `/ekonomi/arende/${CASE}`, LARS);
  await expect(main(page)).toContainText(CASE_NO);
  await expect(main(page)).not.toContainText("Diego");
  await main(page).getByRole("button", { name: "Visa alla veckor" }).click();
  const weeks = page.getByRole("table", { name: "Alla veckor" });
  await expect(weeks).toContainText("v. 5 2027");
  await expect(weeks).toContainText("1 av 1 tillfälle");
  expect(errors).toEqual([]);
});

test("Ändra team: arbetsgivarmatcharen läggs till och ser sin teamroll direkt – teamvalet Handledare finns inte (beslut 2026-10-09)", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${TEAM_CASE}`, SARA);
  await main(page).getByRole("button", { name: "Ändra team" }).click();
  const td = dialog(page, "Ändra team");
  await expect(td).toContainText("byts med Byt huvudcoach");
  await expect(td).not.toContainText(/handledare/i);
  await expect(td.locator("#arn-team-u-petra")).toHaveCount(0);
  await td.locator("#arn-team-matcher").selectOption("u-petra");
  await td.locator("#arn-team-counselor").selectOption("u-leila");
  await td.getByRole("button", { name: "Spara teamet" }).click();
  await expect(toastWith(page, "Teamet för BOT-27-0039 är sparat. 2 nya medlemmar har fått notis.")).toBeVisible();
  await main(page).getByRole("button", { name: "Visa alla uppgifter" }).click();
  await expect(main(page)).toContainText("Petra Ek");
  await expect(main(page)).toContainText("Leila Nouri");
  await expect(main(page)).toContainText("Arbetsgivarmatchare");

  await switchTo(page, info, `/arenden/${TEAM_CASE}`, PETRA);
  await expect(main(page)).toContainText("Du ingår i teamet som arbetsgivarmatchare");

  // Tas Petra bort har hon ingen teamroll längre – men ärendet nås fortfarande (alla ser alla i avtalet, beslut 2026-10-09).
  await switchTo(page, info, `/arenden/${TEAM_CASE}`, SARA);
  await main(page).getByRole("button", { name: "Ändra team" }).click();
  await dialog(page, "Ändra team").locator("#arn-team-matcher").selectOption("");
  await dialog(page, "Ändra team").getByRole("button", { name: "Spara teamet" }).click();
  await expect(toastWith(page, "Teamet för BOT-27-0039 är sparat.")).toBeVisible();
  await switchTo(page, info, `/arenden/${TEAM_CASE}`, PETRA);
  await expect(main(page)).toContainText("BOT-27-0039");
  await expect(main(page)).not.toContainText("Du ingår i teamet");
  expect(errors).toEqual([]);
});
