// Gruppaktiviteter och automatisk närvaro (coachmötet 2026-10-09, Karims beslut 1, 4 och 5): coachen skapar en aktivitet med
// tre deltagare från Min vecka, markerar en frånvarande och övriga som närvarande, skriver anteckningsrader (personnummer
// stoppas) och ser aktiviteten på Min vecka. Det automatiska närvarojobbet körs med "Kör nu" på /admin/integrationer (samma väg
// som avrop@-jobbet i admin.spec.ts): förra veckans oregistrerade tillfällen blir Närvarande med märket "Automatiskt
// registrerad", coachen ändrar en till frånvaro, veckorapporterna publiceras och fakturaunderlaget räknar som förut.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

const COACH = { userId: "u-amira", role: "coach" };
const ADMIN = { userId: "u-robin", role: "admin" };
const EKONOM = { userId: "u-lars", role: "ekonom" };
const SC = { nadia: "case-260143", elif: "case-270003", amal: "case-270012" };
const AUTO = "Automatiskt registrerad";

const main = (page: Page) => page.locator("#main");
const card = (page: Page, title: string | RegExp) => main(page).locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title }) });
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" });
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
async function noBadText(page: Page) {
  expect(await main(page).innerText()).not.toMatch(/undefined|NaN|\[object Object\]/);
}
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
}
/** Bjud in en deltagare: sök på namnet och kryssa i rutan. */
async function invite(page: Page, search: string, caseId: string) {
  await page.locator("#ny-bjud-sok").fill(search);
  const box = page.locator(`#ny-bjud-${caseId}`);
  await box.check();
  await expect(box).toBeChecked();
}
/** Raderna i "Debiterbara veckor per månad" som text (ekonomens ärendevy). */
async function billingRows(page: Page): Promise<string[]> {
  const table = page.getByRole("table", { name: "Debiterbara veckor per månad" });
  await expect(table).toBeVisible();
  return (await table.locator("tbody tr").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
}

test("Gruppaktivitet: tre deltagare, en frånvarande, övriga närvarande, anteckningsrader och raden på Min vecka", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", COACH);
  await page.getByRole("link", { name: "Ny aktivitet" }).first().click();
  await expect.poll(() => currentPath(page, info)).toBe("/aktiviteter/ny");
  await expect(page.getByRole("heading", { level: 1, name: "Ny aktivitet" })).toBeVisible();

  // Tom aktivitet: felen står vid fälten och ingenting skapas.
  await btn(page, "Skapa aktiviteten").click();
  await expect(page.getByText("Skriv vad aktiviteten heter.")).toBeVisible();

  await page.locator("#ny-akt-namn").fill("CV-verkstad");
  await page.locator("#ny-akt-datum").fill("2027-02-01");
  await page.locator("#ny-akt-tid").fill("08:00");
  await expect(page.locator("#ny-akt-plats")).not.toHaveValue("");
  await invite(page, "Nadia", SC.nadia);
  await invite(page, "Elif", SC.elif);
  await invite(page, "0012", SC.amal);
  await expect(main(page)).toContainText("3 deltagare valda");
  await btn(page, "Skapa aktiviteten med 3 deltagare").click();
  await expect(toasts(page)).toContainText("Aktiviteten är skapad med 3 deltagare.");
  await expect.poll(() => currentPath(page, info)).toMatch(/^\/aktiviteter\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "CV-verkstad" })).toBeVisible();
  const activityPath = currentPath(page, info);

  const parts = page.getByTestId("aktivitet-deltagare");
  await expect(parts).toHaveCount(3);
  const row = (name: string) => parts.filter({ hasText: name });
  for (const n of ["Nadia Warsame", "Elif Yilmaz", "Amal Hassan"]) await expect(row(n)).toContainText("Ej registrerad");

  // Elif uteblev: ogiltig frånvaro med radens knappar.
  const elif = row("Elif Yilmaz");
  await btn(elif.getByRole("group", { name: "Närvaro för Elif Yilmaz" }), "Ogiltig frånvaro").click();
  await expect(btn(elif.getByRole("group", { name: "Närvaro för Elif Yilmaz" }), "Ogiltig frånvaro")).toHaveAttribute("aria-pressed", "true");

  // Övriga två: bekräftelsen räknar upp namnen och ändrar inte Elif.
  await btn(page, "Markera övriga som närvarande (2)").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Markera 2 som närvarande?");
  await expect(dialog).toContainText("Nadia Warsame (BOT-26-0143)");
  await expect(dialog).toContainText("Amal Hassan (BOT-27-0012)");
  await expect(dialog).not.toContainText("Elif");
  await btn(dialog, "Markera 2 som närvarande").click();
  await expect(main(page)).toContainText("2 av 2 markerade som närvarande.");
  await expect(main(page)).toContainText("Närvaron är registrerad för alla deltagare.");
  await expect(row("Nadia Warsame")).toContainText("Närvarande");
  await expect(row("Amal Hassan")).toContainText("Närvarande");
  await expect(elif).toContainText("Ogiltig frånvaro");
  await expect(btn(page, /^Markera övriga som närvarande/)).toHaveCount(0);

  // Anteckningsrader: ett personnummer stoppar sparningen och pekar ut ärendet (aldrig namnet i felet).
  await page.locator(`#akt-anteckning-${SC.nadia}`).fill("Klar med CV:t, 19850101-1234");
  await page.locator(`#akt-anteckning-${SC.amal}`).fill("Behöver hjälp med det personliga brevet");
  await btn(page, "Spara 2 anteckningar").click();
  await expect(main(page)).toContainText("Ta bort personnummer");
  await expect(main(page)).toContainText("BOT-26-0143: Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.");
  await page.locator(`#akt-anteckning-${SC.nadia}`).fill("Klar med CV:t");
  await btn(page, "Spara 2 anteckningar").click();
  await expect(toasts(page)).toContainText("2 anteckningar sparade i deltagarkorten.");
  await expect(row("Nadia Warsame")).toContainText("Amira Haddad: Klar med CV:t");
  await expect(row("Amal Hassan")).toContainText("Amira Haddad: Behöver hjälp med det personliga brevet");
  await expect(page.locator(`#akt-anteckning-${SC.nadia}`)).toHaveValue("");
  await noBadText(page);

  // Min vecka: aktiviteten är en rad i dagens aktiviteter med antal och att närvaron är registrerad.
  await go(page, info, "/min-vecka");
  const today = page.getByTestId("dagens-gruppaktivitet").filter({ hasText: "CV-verkstad" });
  await expect(today).toHaveCount(1);
  await expect(today).toContainText("3 deltagare");
  await expect(today).toContainText("Närvaron är registrerad");
  await today.getByRole("link", { name: "CV-verkstad" }).click();
  await expect.poll(() => currentPath(page, info)).toBe(activityPath);
  await expect(page.getByRole("heading", { level: 1, name: "CV-verkstad" })).toBeVisible();

  // Listan /aktiviteter har aktiviteten med närvarostatus som text och ikon, och menyn har Aktiviteter.
  await go(page, info, "/aktiviteter");
  await expect(main(page)).toContainText("CV-verkstad");
  const listRow = main(page).getByRole("row", { name: /CV-verkstad/ });
  await expect(listRow).toContainText("3 deltagare");
  await expect(listRow.getByText("Närvaron är registrerad")).toBeVisible();
  await expect(listRow.locator("svg").first()).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Aktiviteter" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Automatisk närvaro: Kör nu registrerar förra veckans oregistrerade tillfällen, coachen ändrar ett till frånvaro – veckorapporterna och fakturaunderlaget räknar som förut", async ({ page }, info) => {
  // Fakturaunderlaget före: ekonomens debiterbara veckor för Nadia.
  const errors = await open(page, info, `/ekonomi/arende/${SC.nadia}`, EKONOM);
  await expect(main(page)).toContainText("Debiterbara veckor per månad");
  const before = await billingRows(page);
  expect(before.length).toBeGreaterThan(0);

  // Admin kör jobbet direkt.
  await switchUser(page, info, ADMIN, "/admin/integrationer");
  const jobRow = page.getByRole("row", { name: /Registrera närvaro automatiskt/ });
  await expect(jobRow).toContainText("Dagligen 18.00");
  await expect(jobRow).toContainText("Inte körd än");
  await btn(jobRow, /Kör nu/).click();
  await expect(toasts(page)).toContainText("Registrera närvaro automatiskt kördes.");
  await expect(jobRow).toContainText("6 tillfällen registrerade automatiskt vid senaste körningen");
  await expect(jobRow).toContainText("Manuellt av dig");

  // Revisionsloggen: en rad för körningen (antal och id:n, inga namn).
  await go(page, info, "/admin/logg");
  await page.locator("#log-action").selectOption("attendance.auto_registered");
  await expect(main(page)).toContainText("Poster (1)");
  const logText = await main(page).innerText();
  for (const n of ["Nadia", "Warsame", "Elif", "Hodan"]) expect(logText).not.toContain(n);

  // Coachen: vecka 4 är komplett, de sex raderna är märkta och veckorapporterna publicerades.
  await switchUser(page, info, COACH, "/narvaro?vecka=forra");
  await expect(page.getByTestId("narvaro-raknare")).toContainText("Alla passerade tillfällen vecka 4 är registrerade");
  const reports = card(page, "Veckorapporter – vecka 4");
  await expect(reports).toContainText(/Maria Ekdahl[\s\S]*?Publicerad 1 feb/);
  await expect(reports).toContainText(/Linda Karlsson[\s\S]*?Publicerad 1 feb/);
  await page.getByRole("button", { name: /^Alla \(\d+\)$/ }).click();
  const rows = page.getByTestId("narvaro-rad");
  await expect(rows.filter({ hasText: AUTO })).toHaveCount(6);
  for (const t of await rows.filter({ hasText: AUTO }).allInnerTexts()) expect(t).toContain("Närvarande");
  const i = (await rows.allInnerTexts()).findIndex((t) => t.includes(AUTO));
  const changed = rows.nth(i);
  await btn(changed, "Giltig frånvaro").click();
  await btn(page.getByRole("group", { name: "Orsak till giltig frånvaro" }), "Sjukdom").click();
  await expect(changed).toContainText("Giltig frånvaro · Sjukdom");
  await expect(changed).not.toContainText(AUTO);
  await expect(rows.filter({ hasText: AUTO })).toHaveCount(5);
  await page.reload();
  await loaded(page);
  await page.getByRole("button", { name: /^Alla \(\d+\)$/ }).click();
  await expect(page.getByTestId("narvaro-rad").filter({ hasText: AUTO })).toHaveCount(5);
  await noBadText(page);

  // Fakturaunderlaget efter: samma debiterbara veckor (närvaron påverkar inte vilka veckor som debiteras).
  await switchUser(page, info, EKONOM, `/ekonomi/arende/${SC.nadia}`);
  await expect(main(page)).toContainText("Debiterbara veckor per månad");
  expect(await billingRows(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("Samma tid: Ny aktivitet frågar om deltagarens eget tillfälle ska ersättas – Närvaro länkar gruppraden till aktivitetsvyn", async ({ page }, info) => {
  const errors = await open(page, info, "/aktiviteter/ny", COACH);
  await expect(page.getByRole("heading", { level: 1, name: "Ny aktivitet" })).toBeVisible();
  // Onsdag 10.00: Nadia har yrkesmoment 09.00–12.00 enligt veckoplanen.
  await page.locator("#ny-akt-namn").fill("Intervjuträning");
  await page.locator("#ny-akt-datum").fill("2027-02-03");
  await page.locator("#ny-akt-tid").fill("10:00");
  await invite(page, "Nadia", SC.nadia);
  await btn(page, "Skapa aktiviteten med 1 deltagare").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Ersätta tillfällen vid samma tid?");
  await expect(dialog).toContainText("BOT-26-0143: Har redan yrkesmoment kl. 09.00–12.00. Det ersätts av aktiviteten");
  // Avbryt: ingenting skapas.
  await btn(dialog, "Avbryt").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => currentPath(page, info)).toBe("/aktiviteter/ny");
  await btn(page, "Skapa aktiviteten med 1 deltagare").click();
  await btn(page.getByRole("dialog"), "Ja, ersätt dem").click();
  await expect(toasts(page)).toContainText("Aktiviteten är skapad med 1 deltagare. 1 tillfälle vid samma tid är ersatt.");
  await expect.poll(() => currentPath(page, info)).toMatch(/^\/aktiviteter\/[^/]+$/);
  const activityPath = currentPath(page, info);

  // Närvaro denna vecka: gruppraden har ingen Ta bort-knapp utan en länk till aktivitetsvyn.
  await go(page, info, `/narvaro?vecka=denna&arende=${SC.nadia}`);
  await page.getByRole("button", { name: /^Alla \(\d+\)$/ }).click();
  await page.getByRole("group", { name: "Dag" }).getByRole("button", { name: /^Hela veckan/ }).click();
  const groupLink = main(page).getByRole("link", { name: "Öppna gruppaktiviteten" });
  await expect(groupLink).toHaveCount(1);
  await groupLink.click();
  await expect.poll(() => currentPath(page, info)).toBe(activityPath);
  await expect(page.getByRole("heading", { level: 1, name: "Intervjuträning" })).toBeVisible();
  await noBadText(page);
  expect(errors).toEqual([]);
});
