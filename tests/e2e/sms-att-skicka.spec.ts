// SMS att skicka (Karims beslut 2026-11-11, granskningen 2026-11-11): SMS till deltagare är inte kopplat, så coachen skickar SMS:et
// själv. Amira ser raden med veckans tider för sin deltagare Nadia (BOT-26-0143) – måndag morgon före veckans första tillfälle –
// under Veckans tider att skicka, kopierar numret (då kommer Öppna SMS, en sms:-länk med bara texten – aldrig numret), kopierar
// texten och markerar SMS:et som skickat; raden försvinner och fokus stannar på sidan. Erik ser bara sina egna deltagare – med
// Visa alla också Nadia med huvudcoachens namn. Körs mot både prototypen och appen. Påhittade testdata.
import { expect, test, type Page } from "@playwright/test";
import { isDemo, open } from "./helpers";

const AMIRA = { userId: "u-amira", role: "coach" };
const ERIK = { userId: "u-erik", role: "coach" };
const main = (page: Page) => page.locator("#main");
const toastWith = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

test("coachen ser veckans tider för sin deltagare, kopierar numret och texten, öppnar SMS:et och markerar det som skickat – raden försvinner", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", AMIRA);
  await expect(main(page).getByRole("heading", { name: /^Veckans tider att skicka \(\d+\)$/ })).toBeVisible();
  const rows = page.getByTestId("sms-rad").filter({ hasText: "BOT-26-0143" });
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText("Nadia Warsame");
  await expect(row).toContainText("Veckans tider – vecka 5");
  await expect(row).not.toContainText("huvudcoach");
  // Texten: bara veckodag, datum, klockslag, plats och Miljonbemannings telefonnummer – aldrig namnet eller ärendenumret, och inte
  // torsdagens praktikdag.
  const text = row.locator("[data-sms-text]");
  await expect(text).toHaveText(/^Hej! Dina tider hos Miljonbemanning den här veckan: mån 1 feb kl\. 10\.00, .+ Frågor\? Ring 08-400 22 750\.$/);
  const sms = (await text.textContent()) ?? "";
  expect(sms).not.toMatch(/Nadia|Warsame|BOT-26-0143|tor 4 feb/);
  const phone = (await row.locator("[data-phone]").textContent()) ?? "";
  expect(phone).toMatch(/^0\d{2}-\d{3} \d{2} \d{2}$/);
  await expect(main(page).locator('a[href^="tel:"], a[href^="sms:"]')).toHaveCount(0);

  // Kopiera numret – sedan Öppna SMS med bara texten i länken.
  const copyNumber = row.getByRole("button", { name: "Kopiera numret till deltagaren i BOT-26-0143" });
  if (!isDemo(info)) await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await copyNumber.click();
  await expect(toastWith(page, isDemo(info) ? "Numret kunde inte kopieras automatiskt. Det är markerat" : "Numret är kopierat.")).toBeVisible();
  const open_ = row.getByRole("link", { name: "Öppna SMS till deltagaren i BOT-26-0143" });
  await expect(open_).toBeVisible();
  const href = (await open_.getAttribute("href")) ?? "";
  expect(href).toMatch(/^sms:[?&]body=/);
  expect(decodeURIComponent(href.replace(/^sms:[?&]body=/, ""))).toBe(sms);
  expect(href.replace(/\D/g, "")).not.toContain(phone.replace(/\D/g, ""));
  await expect(main(page).locator('a[href^="tel:"]')).toHaveCount(0);

  const copyText = row.getByRole("button", { name: "Kopiera texten till deltagaren i BOT-26-0143" });
  if (isDemo(info)) {
    // Prototypen körs på http://proto.test (ingen säker sida – urklippet finns inte): reservläget markerar texten.
    await copyText.click();
    await expect(toastWith(page, "Texten kunde inte kopieras automatiskt. Den är markerad")).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(sms);
  } else {
    await copyText.click();
    await expect(toastWith(page, "Texten är kopierad.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sms);
  }
  await row.getByRole("button", { name: /^Markera som skickat/ }).click();
  await expect(toastWith(page, "SMS:et är markerat som skickat.")).toBeVisible();
  await expect(page.getByTestId("sms-rad").filter({ hasText: "BOT-26-0143" })).toHaveCount(0);
  // Fokus: nästa rad eller en rubrik på sidan – aldrig sidans början.
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/^(sms-|mv-)/);
  expect(errors).toEqual([]);
});

test("en annan coach ser först sina egna deltagare – Visa alla visar Nadia med huvudcoachens namn", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", ERIK);
  await expect(page.getByTestId("sms-rad").filter({ hasText: "BOT-26-0143" })).toHaveCount(0);
  await main(page).getByRole("checkbox", { name: "Visa alla" }).check();
  const row = page.getByTestId("sms-rad").filter({ hasText: "BOT-26-0143" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Veckans tider – vecka 5 · huvudcoach Amira");
  expect(errors).toEqual([]);
});
