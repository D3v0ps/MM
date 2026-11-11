// Ändra tid för ett tillfälle (Karims beslut 2026-11-11): coachen flyttar Nadias nästa coachträff från deltagarkortet, och
// deltagaren får meddelandet om ändringen med den nya tiden – bara tid, plats och telefonnummer, inget namn och inget
// ärendenummer (CLAUDE.md punkt 9). Körs mot både prototypen och appen. Påhittade testdata.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const ROBIN: Who = { userId: "u-robin", role: "admin" };
const NADIA = "case-260143";

const main = (page: Page) => page.locator("#main");
const dialog = (page: Page) => page.getByRole("dialog");
const toastWith = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** Byt testperson utan att nollställa testdata (som i kallelse.spec.ts). */
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

test("coachen flyttar en coachträff – meddelandet till deltagaren har den nya tiden och inget namn eller ärendenummer", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${NADIA}?flik=narvaro`, AMIRA);
  const upcoming = main(page).getByRole("heading", { name: "Kommande tillfällen", exact: true }).locator("xpath=ancestor::section[1]");
  const first = upcoming.getByRole("button", { name: /^Ändra tid: Coachmöte/ }).first();
  await expect(first).toBeVisible();
  await first.click();
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Ändra tid" })).toBeVisible();
  await expect(d).toContainText("BOT-26-0143");
  await d.locator("#arn-act-at").fill("2027-02-05T13:30");
  await expect(d.getByLabel("Skicka den nya tiden till deltagaren")).toBeChecked();
  await d.getByRole("button", { name: "Spara ny tid" }).click();
  await expect(d).toHaveCount(0);
  await expect(toastWith(page, /Coachträff för BOT-26-0143 är flyttat till fredag 5 feb 2027 kl\. 13\.30\. Meddelandet om ändringen skickas med/)).toBeVisible();
  await expect(upcoming).toContainText("Fredag 5 feb 2027 kl. 13.30");

  // Utskicksloggen: mallen Ändrad aktivitet med den nya tiden – texten har inget namn och inget ärendenummer.
  await switchTo(page, info, "/admin/mallar?flik=logg", ROBIN);
  const items = main(page).locator("[data-send-item]").filter({ hasText: "ärende BOT-26-0143" }).filter({ hasText: "Nu gäller fredag 5 februari kl. 13.30" });
  await expect(items.first()).toBeVisible();
  const body = items.first().locator("div.whitespace-pre-wrap");
  await expect(body).toContainText(/^Hej! Aktiviteten hos Miljonbemanning .+ är ändrad\. Nu gäller fredag 5 februari kl\. 13\.30, .+\. Frågor\? Ring /);
  await expect(body).not.toContainText("BOT-");
  await expect(body).not.toContainText("Nadia");
  await expect(items.first()).toContainText("Inga personuppgifter");
  expect(errors).toEqual([]);
});
