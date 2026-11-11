// SMS att skicka (Karims beslut 2026-11-11): SMS till deltagare är inte kopplat, så coachen skickar SMS:et själv. Erik ser raden
// med veckans tider för Amiras deltagare Nadia (BOT-26-0143) – raden från i fredags för den här veckan står kvar måndag morgon –,
// kopierar texten och markerar SMS:et som skickat; raden försvinner. Numret och texten är markerbar text – inga tel:- eller
// sms:-länkar. Körs mot både prototypen och appen. Påhittade testdata.
import { expect, test, type Page } from "@playwright/test";
import { isDemo, open } from "./helpers";

const ERIK = { userId: "u-erik", role: "coach" };
const main = (page: Page) => page.locator("#main");
const toastWith = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

test("coachen ser veckans tider, kopierar texten och markerar SMS:et som skickat – raden försvinner", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", ERIK);
  await expect(main(page).getByRole("heading", { name: /^SMS att skicka \(\d+\)$/ })).toBeVisible();
  const rows = page.getByTestId("sms-rad").filter({ hasText: "BOT-26-0143" });
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText("Nadia Warsame");
  await expect(row).toContainText("Veckans tider – vecka 5 · huvudcoach Amira");
  // Texten: bara veckodag, datum, klockslag, plats och Miljonbemannings telefonnummer – aldrig namnet eller ärendenumret.
  const text = row.locator("[data-sms-text]");
  await expect(text).toHaveText(/^Hej! Dina tider hos Miljonbemanning den här veckan: mån 1 feb kl\. 10\.00, .+ Frågor\? Ring 08-400 22 750\.$/);
  const sms = (await text.textContent()) ?? "";
  expect(sms).not.toMatch(/Nadia|Warsame|BOT-26-0143/);
  await expect(row.locator("[data-phone]")).toHaveText(/^0\d{2}-\d{3} \d{2} \d{2}$/);
  await expect(main(page).locator('a[href^="tel:"], a[href^="sms:"]')).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Kopiera numret till deltagaren i BOT-26-0143" })).toBeVisible();
  const copyText = row.getByRole("button", { name: "Kopiera texten till deltagaren i BOT-26-0143" });
  await expect(copyText).toBeVisible();
  if (isDemo(info)) {
    // Prototypen körs på http://proto.test (ingen säker sida – urklippet finns inte): reservläget markerar texten.
    await copyText.click();
    await expect(toastWith(page, "Texten kunde inte kopieras automatiskt. Den är markerad")).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(sms);
  } else {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await copyText.click();
    await expect(toastWith(page, "Texten är kopierad.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sms);
  }
  await row.getByRole("button", { name: /^Markera som skickat/ }).click();
  await expect(toastWith(page, "SMS:et är markerat som skickat.")).toBeVisible();
  await expect(page.getByTestId("sms-rad").filter({ hasText: "BOT-26-0143" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
