// Kallelsen till deltagaren (beslut 2026-10-09, notifyParticipant i src/features/_shared/participant-notify.ts): e-post när
// deltagaren har en e-postadress. SMS och utringning (46elks) är inte kopplade i testmiljön – de sparas i utskicksloggen som
// stoppade med orsak, och integrationskorten säger "Inte kopplad" med variablerna som saknas (bara namnen).
// Körs mot både prototypen och appen. Påhittade testdata.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const ROBIN: Who = { userId: "u-robin", role: "admin" };

const main = (page: Page) => page.locator("#main");
const dialog = (page: Page) => page.getByRole("dialog");
const toastWith = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
/** Kortet med rubriken (närmaste section – avsnittet Integrationer runt korten är också en section). */
const card = (page: Page, title: string) => main(page).getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::section[1]");

/** Byt testperson utan att nollställa testdata (som i admin.spec.ts). */
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

test("kallelsen går med e-post när deltagaren har e-post – SMS och utringning stoppas med orsak (inte kopplade)", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  const m = main(page);
  await expect(m.getByRole("link", { name: "BOT-27-0039" })).toBeVisible();
  await m.getByRole("button", { name: "Boka första mötet för BOT-27-0039" }).click();
  await expect(dialog(page)).toContainText("Deltagaren får kallelsen med e-post och SMS när det går. Går det inte får samordnaren en uppgift att ringa deltagaren.");
  await dialog(page).getByRole("button", { name: "Boka mötet" }).click();
  await expect(dialog(page)).toHaveCount(0);
  // Deltagaren har e-post (och har valt brev): e-posten går, brevet skickas för hand. SMS är inte kopplat.
  await expect(toastWith(page, "Kallelsen skickas med e-post. Ett brev skickas också för hand.")).toBeVisible();

  // Utskicksloggen: samma text i alla kanaler – bara tid, plats och telefonnummer; SMS och samtal stoppade med orsak.
  await switchTo(page, info, "/admin/mallar?flik=logg", ROBIN);
  const items = main(page).locator("[data-send-item]").filter({ hasText: "Kallelse till första möte" }).filter({ hasText: "ärende BOT-27-0039" });
  await expect(items).toHaveCount(4);
  const mail = items.filter({ hasText: "Till deltagare (e-post)" });
  await expect(mail).toContainText("Välkommen till Miljonbemanning! Ditt första möte är tisdag 2 februari klockan 10.00 i Alby.");
  await expect(mail).toContainText("Skickat");
  await expect(mail).toContainText("Inga personuppgifter");
  await expect(items.filter({ hasText: "Till deltagare (brev)" })).toContainText("Skickas manuellt (brev)");
  await expect(items.filter({ hasText: "Till deltagare (SMS)" })).toContainText("Stoppat – SMS-leverantör inte vald");
  const call = items.filter({ hasText: "Till deltagare (samtal)" });
  await expect(call).toContainText("Stoppat – Utringning inte kopplad");
  await expect(call).toContainText("Inspelat meddelande: Hej, det här är Miljonbemanning.");
  // Filtret Utringning finns när det finns samtal i loggen.
  await main(page).getByRole("button", { name: "Utringning", exact: true }).click();
  await expect(main(page).locator("[data-send-item]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("uppgiften att ringa deltagaren i att göra-listan (paket 2, S2): sista tid, numret att kopiera (ingen tel:-länk), Systemet, Boka om och Ringt – kallad", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = await open(page, info, "/inkorg/registrera", SARA);
  const m = main(page);
  // En beställning per telefon för en deltagare med telefonnummer men utan e-postadress (SMS är inte kopplat i testmiljön).
  await page.fill("#reg-ref-name", "Anna Ny");
  await page.fill("#reg-ref-email", "anna.ny@botkyrka.se");
  await page.fill("#reg-ref-unit", "Arbetsmarknadsenheten Tumba");
  await page.fill("#reg-start", "2027-02-15");
  await page.locator("#reg-period").getByRole("button", { name: "6 månader" }).click();
  await page.fill("#reg-fn", "Test");
  await page.fill("#reg-ln", "Telefonsson");
  await page.fill("#reg-pnr", "19930303-1111");
  await page.fill("#reg-phone", "070-000 00 00");
  await page.fill("#reg-city", "Tumba");
  await page.selectOption("#reg-area", "G");
  await page.locator("#reg-prior").getByRole("button", { name: "Nej" }).click();
  await m.getByRole("button", { name: "Registrera beställningen" }).click();
  await expect(toastWith(page, "Beställningen är registrerad. Ärendenummer BOT-27-0051.")).toBeVisible();
  await m.getByRole("button", { name: "Acceptera", exact: true }).click();
  await page.check("#ink-coach-u-amira");
  await page.fill("#ink-fm-date", "2027-02-03");
  await page.fill("#ink-fm-time", "10:00");
  await dialog(page).getByRole("button", { name: "Acceptera avropet" }).click();
  await dialog(page).getByRole("button", { name: "Klart" }).click();

  // Min vecka: uppgiften med första mötets tid som sista tid, numret som markerbar text med Kopiera numret och avsändaren Systemet.
  await switchTo(page, info, "/min-vecka", SARA);
  const row = main(page).getByRole("list", { name: "Att göra", exact: true }).locator(":scope > li").filter({ hasText: "Ring deltagaren och kalla till första mötet" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("BOT-27-0051");
  await expect(row).toContainText("Senast ons 3 feb kl. 10.00");
  await expect(row).toContainText("Från Systemet");
  // Numret är markerbar text – ingen tel:-länk (inga personuppgifter i URL:er). Kopiera numret lägger det i urklippet;
  // går det inte markeras numret i stället.
  await expect(row.locator("[data-phone]")).toHaveText("070-000 00 00");
  await expect(main(page).locator('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')).toHaveCount(0);
  if (isDemo(info)) {
    // Prototypen körs här på http://proto.test (ingen säker sida – urklippet finns inte): reservläget markerar numret.
    await row.getByRole("button", { name: "Kopiera numret till deltagaren i BOT-27-0051" }).click();
    await expect(toastWith(page, "Numret kunde inte kopieras automatiskt. Det är markerat")).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("070-000 00 00");
  } else {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await row.getByRole("button", { name: "Kopiera numret till deltagaren i BOT-27-0051" }).click();
    await expect(toastWith(page, "Numret är kopierat.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("070-000 00 00");
  }
  await expect(page.getByRole("navigation", { name: "Meny" }).getByRole("link", { name: /Min vecka/ })).toContainText("1");
  // Boka om: samma bokning som första mötet.
  await row.getByRole("button", { name: "Boka om första mötet för BOT-27-0051" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Boka om första mötet – BOT-27-0051" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Avbryt" }).click();
  // Ringt – kallad stänger uppgiften (samma kommando som Markera som klar).
  await row.getByRole("button", { name: "Ringt – kallad BOT-27-0051" }).click();
  await expect(toastWith(page, "Uppgiften är klar – deltagaren är kallad.")).toBeVisible();
  await expect(main(page).getByRole("list", { name: "Att göra", exact: true }).locator(":scope > li").filter({ hasText: "Ring deltagaren" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Meny" }).getByRole("link", { name: /Min vecka/ })).not.toContainText(/\d/);
  expect(errors).toEqual([]);
});

test("integrationskorten SMS (46elks) och Utringning (46elks) visar Inte kopplad och vilka variabler som saknas", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/integrationer", ROBIN);
  const sms = card(page, "SMS (46elks)");
  await expect(sms).toContainText("Inte kopplad");
  await expect(sms).toContainText("MM_SMS_PROVIDER, ELKS_API_USERNAME, ELKS_API_PASSWORD");
  await expect(sms).toContainText("Bara tid, plats och telefonnummer");
  const call = card(page, "Utringning (46elks)");
  await expect(call).toContainText("Inte kopplad");
  await expect(call).toContainText("MM_CALL_FROM, MM_CALL_AUDIO_URL");
  // Underbiträdet: 46elks är valt och väntar på kommunens godkännande.
  await expect(main(page)).toContainText("46elks (SMS och utringning)");
  // Inga värden – bara namnen (inga lösenord eller nummer i sidan).
  expect(await main(page).textContent()).not.toMatch(/\+46\d|ELKS_API_PASSWORD=/);
  expect(errors).toEqual([]);
});
