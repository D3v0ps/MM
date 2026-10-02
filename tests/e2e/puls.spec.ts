// Interaktionstest för pulsmätningen (/puls, deltagarens engångslänk – prototypens puls.svar).
// Port av stegen "puls.svar – deltagaren svarar via engångslänk" i prototyp/tools/test-admin.mjs. Det som prototypen
// kontrollerade i sitt tillstånd (svaret, länken, uppgiften, flaggorna) kontrolleras här i vyerna.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const DELTAGARE: Who = { userId: "deltagare", role: "deltagare" };
const main = (page: Page) => page.locator("#main");
const phone = (page: Page) => page.locator(".pulse-phone");
const text = (page: Page) => main(page).evaluate((el) => (el.textContent ?? "").replace(/ /g, " "));
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).first();

async function switchTo(page: Page, info: TestInfo, to: string, who: Who) {
  if (isDemo(info)) {
    await page.route("http://proto.test/blank.html", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Byter testperson</title>" }));
    await page.goto("http://proto.test/blank.html");
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), who);
    await page.goto(`http://proto.test/index.html#${to}`);
  } else {
    await switchPersona(page, who);
    await page.goto(to);
  }
  await expect(main(page)).toBeVisible();
}

test("pulsmätning: språk, fem frågor, svaret sparas och länken kan bara användas en gång", async ({ page }, info) => {
  const errors = await open(page, info, "/puls", DELTAGARE);
  await expect(phone(page)).toContainText("Hur går det?");
  await btn(page, "العربية").click();
  await expect(phone(page)).toHaveAttribute("dir", "rtl");
  await expect(main(page)).toContainText("Översättning – granskas av människa");
  await btn(page, "Soomaali").click();
  await expect(phone(page)).toHaveAttribute("lang", "so");
  await btn(page, "Svenska").click();
  const t = await text(page);
  expect(t).toContain("Din coach ser inte vad du svarar");
  expect(t).toContain("frivilligt");
  expect(t).toContain("Länken gäller i 7 dagar och kan bara användas en gång.");
  await btn(page, "Börja").click();
  await expect(phone(page)).toContainText("Fråga 1 av 5");
  await expect(btn(page, "Nästa")).toBeDisabled();
  await page.getByRole("button", { name: "4 – Bra" }).click();
  await expect(phone(page)).toContainText("Du valde: Bra");
  await btn(page, "Nästa").click();
  await page.getByRole("button", { name: "3 – Okej" }).click();
  await btn(page, "Nästa").click();
  await page.getByRole("button", { name: "2 – Dåligt" }).click();
  await btn(page, "Nästa").click();
  await btn(page, "Praktik").click();
  await btn(page, "Nästa").click();
  await phone(page).getByRole("button", { name: "Ja", exact: true }).click();
  await page.locator("#pulse-text").fill("Jag vill prata om min praktik.");
  await btn(page, "Skicka svar").click();
  await expect(phone(page)).toContainText("Tack för dina svar!");
  await expect(phone(page)).toContainText("Någon från Miljonbemanning hör av sig till dig.");

  // Länken kan bara användas en gång
  await page.reload();
  await expect(phone(page)).toContainText("Länken är redan använd");
  await expect(page.getByRole("button", { name: "Börja" })).toHaveCount(0);
  if (isDemo(info)) {
    await page.getByRole("button", { name: "Har gått ut" }).click();
    await expect(phone(page)).toContainText("Länken har gått ut");
    await expect(phone(page)).toContainText("Länken gällde i 7 dagar. Du behöver inte göra något.");
  }

  // Svaret loggas utan namn; "Ja" på fråga 5 blir en flagga till samordnaren, lågt betyg på fråga 3 går till chefen
  await switchTo(page, info, "/admin/logg", { userId: "u-karin", role: "chef" });
  await expect(main(page)).toContainText("Pulssvar inskickat");
  await expect(main(page)).toContainText("Deltagare (engångslänk)");
  await expect(main(page)).toContainText("Språk: svenska · Vill bli kontaktad: Ja");
  await switchTo(page, info, "/ledning", { userId: "u-karin", role: "chef" });
  await expect(main(page)).toContainText("Ett svar 1 feb 2027 gav 2 av 5 på frågan om stöd från coachen.");
  await switchTo(page, info, "/start", { userId: "u-sara", role: "samordnare" });
  await expect(main(page)).toContainText("En deltagare vill bli kontaktad (pulsmätning 1 feb 2027, ärende BOT-26-0143). Avgör vem som tar kontakten.");
  expect(relevant(errors)).toEqual([]);
});

test("pulsmätning: förhandsvisning av länkens lägen och en länk som inte finns", async ({ page }, info) => {
  const errors = await open(page, info, "/puls/okand-lank-12345", DELTAGARE);
  await expect(phone(page)).toContainText("Länken fungerar inte");
  await expect(phone(page)).toContainText("Kontrollera att du har hela länken.");
  if (isDemo(info)) {
    await switchTo(page, info, "/puls", DELTAGARE);
    await page.getByRole("button", { name: "Redan använd" }).click();
    await expect(phone(page)).toContainText("Du har redan svarat. Varje länk kan bara användas en gång. Tack!");
    await page.getByRole("button", { name: "Aktuell länk" }).click();
    await expect(phone(page)).toContainText("Hur går det?");
  }
  expect(relevant(errors)).toEqual([]);
});
