// Deltagaren kom före det bokade första mötet (Karims beslut 2026-11-09, SPEC §7.4) – samma test mot prototypen och appen.
// Demoklockan: måndag 1 februari 2027 kl. 09.12. Marias avrop em-101 (BOT-27-0050, sex månader) accepteras med första möte nästa
// måndag 8 februari kl. 10.00 – planerat slut 7 augusti. Deltagaren kommer redan i dag:
//   1. Sara (samordnare) accepterar avropet med Amira som huvudcoach.
//   2. Amira (coach) öppnar deltagarkortet och trycker Starta insatsen. En kommande dag före mötet nekas (boka om mötet i stället).
//      Med dagens datum visar dialogen klockslaget för mötet och säger vad som händer: första mötet flyttas, planerat slut räknas
//      om och kommunen får en uppdaterad orderbekräftelse. Veckoplanen följer det flyttade mötet.
//   3. Efter starten: ärendet pågår, kortet visar det flyttade första mötet och det nya planerade slutet.
//   4. Maria (kommunens handläggare) ser det flyttade mötet i portalen.
// Bara påhittade uppgifter.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const MARIA: Who = { userId: "k-maria", role: "kommun_handlaggare" };
const CASE = "case-270050";
const CASE_NO = "BOT-27-0050";

const main = (page: Page) => page.locator("#main");
const dialog = (page: Page, name?: string | RegExp) => page.getByRole("dialog", name ? { name } : undefined);
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

/** Byt testperson utan att nollställa det man gjort (prototypen spelar upp kommandologgen igen). */
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
  await expect(main(page)).not.toContainText("Hämtar…", { timeout: 15_000 });
}

test("deltagaren kom före det bokade mötet: coachen startar insatsen i dag, första mötet flyttas och planerat slut räknas om", async ({ page }, info) => {
  test.setTimeout(120_000);
  // 1. Samordnaren accepterar avropet med första möte nästa måndag kl. 10.00.
  const errors = await open(page, info, "/inkorg/em-101", SARA);
  await main(page).getByRole("button", { name: "Acceptera", exact: true }).click();
  const ad = dialog(page);
  await page.check("#ink-coach-u-amira");
  await page.fill("#ink-fm-date", "2027-02-08");
  await page.fill("#ink-fm-time", "10:00");
  await ad.getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(ad.getByText("Amira Haddad har fått en notis om tilldelningen")).toBeVisible();
  await ad.getByRole("button", { name: "Klart" }).click();

  // 2. Coachen på deltagarkortet: mötet är bokat nästa vecka, planerat slut 7 augusti.
  await switchTo(page, info, `/arenden/${CASE}`, AMIRA);
  const m = main(page);
  await expect(m).toContainText(CASE_NO);
  await expect(m).toContainText("Nästa steg efter första mötet: starta insatsen");
  await expect(m).toContainText("Kom deltagaren före det bokade mötet? Starta insatsen och välj dagen hen kom.");
  await expect(m).toContainText("7 aug 2027");
  await btn(m, "Starta insatsen").click();
  const d = dialog(page, "Starta insatsen");
  await expect(d).toBeVisible();
  await expect(d.locator("#arn-start-date")).toHaveValue("2027-02-08");
  await expect(d).toContainText("Tidigast beställningens dag. Kom deltagaren före det bokade mötet? Välj dagen hen kom.");
  // Mötets dag: en vanlig start – inget klockslag och ingen ruta om att mötet flyttas.
  await expect(d.locator("#arn-start-time")).toHaveCount(0);
  await expect(d).not.toContainText("Första mötet flyttas till");
  await expect(d.locator("#arn-plan-t0")).toHaveValue("10:00");

  // En kommande dag före mötet går inte – då bokas mötet om.
  await d.locator("#arn-start-date").fill("2027-02-03");
  await expect(d).toContainText("Startdatumet ligger före första mötet 8 feb 2027 men har inte varit än.");
  await btn(d, "Starta insatsen").click();
  await expect(d).toContainText("Ska mötet hållas tidigare? Boka om första mötet.");
  await expect(d).toBeVisible();
  // En dag före beställningen går inte heller.
  await d.locator("#arn-start-date").fill("2027-01-29");
  await expect(d).toContainText("Startdatumet kan inte vara före beställningen 1 feb 2027.");

  // I dag: deltagaren kom före det bokade mötet. Dialogen säger vad som händer.
  await d.locator("#arn-start-date").fill("2027-02-01");
  await expect(d.locator("#arn-start-time")).toHaveValue("10:00");
  await expect(d).toContainText("Deltagaren kom före det bokade mötet. Första mötet flyttas till måndag 1 feb 2027 kl. 10.00 och planerat slut räknas om till 31 juli 2027. Kommunen får en uppdaterad orderbekräftelse.");
  await expect(d).toContainText("Deltagaren får ingen kallelse – hen har redan kommit.");
  // Klockslaget för mötet: rutan och veckoplanens coachträff följer med (planen är inte ändrad för hand).
  await d.locator("#arn-start-time").fill("09:00");
  await expect(d).toContainText("Första mötet flyttas till måndag 1 feb 2027 kl. 09.00");
  await expect(d.locator("#arn-plan-d0")).toBeChecked();
  await expect(d.locator("#arn-plan-k0")).toHaveValue("möte");
  await expect(d.locator("#arn-plan-t0")).toHaveValue("09:00");
  await expect(d).toContainText("3 tillfällen per vecka till och med 31 juli 2027");
  await btn(d, "Starta insatsen").click();
  await expect(toasts(page)).toContainText(/Insatsen är startad\. \d+ tillfällen är inplanerade till och med 31 juli 2027\. Första mötet är flyttat till måndag 1 feb 2027 kl\. 09\.00 och kommunen har fått en uppdaterad orderbekräftelse\./);
  await expect(d).toHaveCount(0);

  // 3. Ärendet pågår: startdatumet, det nya planerade slutet och det flyttade första mötet står på kortet.
  await expect(m.getByText("Pågår", { exact: true }).first()).toBeVisible();
  await expect(m.getByRole("button", { name: "Starta insatsen", exact: true })).toHaveCount(0);
  await expect(m).toContainText("31 juli 2027");
  await expect(m).not.toContainText("7 aug 2027");
  await btn(m, "Visa alla uppgifter").click();
  const facts = m.locator("#arende-uppgifter");
  await expect(facts).toContainText("måndag 1 feb 2027 kl. 09.00");
  await expect(facts).toContainText("1 feb 2027");
  // Närvaro: dagens tillfälle är det flyttade mötet.
  await page.getByRole("tab", { name: /^Närvaro/ }).click();
  await expect(m).toContainText(/måndag 1 feb 2027 kl\. 09\.00/i);

  // 4. Kommunens handläggare ser det flyttade mötet i orderbekräftelsen på deltagarens sida.
  await switchTo(page, info, `/portal/deltagare/${CASE}`, MARIA);
  await expect(m).toContainText(CASE_NO);
  await expect(m).toContainText("Första mötetmåndag 1 februari 2027 klockan 09.00, Alby");
  await expect(m).toContainText("Planerat slut 31 juli 2027");
  await expect(m).toContainText("6 månader, till 31 juli 2027");
  await expect(m).not.toContainText("8 februari 2027");
  expect(relevant(errors)).toEqual([]);
});
