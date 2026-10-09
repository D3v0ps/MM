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
const card = (page: Page, title: string) => main(page).locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

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
  await m.getByRole("button", { name: "Boka", exact: true }).first().click();
  await expect(dialog(page)).toContainText("Deltagaren får kallelsen med e-post och SMS när det går. Går det inte får du en uppgift att ringa deltagaren.");
  await dialog(page).getByRole("button", { name: "Boka mötet" }).click();
  await expect(dialog(page)).toHaveCount(0);
  // Deltagaren har e-post (och har valt brev): e-posten går, brevet skickas för hand. SMS är inte kopplat.
  await expect(toastWith(page, "Kallelsen är skickad med e-post. Ett brev skickas också för hand.")).toBeVisible();

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
