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

// Karims beslut 2026-10-22: bjud in en nivå eller ett yrkesområde (målgruppen – servern bjuder in och håller listan aktuell),
// inbjudan till deltagarna (kryssrutan) och återkommande nivåaktiviteter (Upprepa varje vecka).
test("Bjud in en nivå: antalet och vilka visas, servern hoppar över den som har en annan aktivitet – fler bjuds in en och en", async ({ page }, info) => {
  const errors = await open(page, info, "/aktiviteter/ny", COACH);
  await expect(page.getByRole("heading", { level: 1, name: "Ny aktivitet" })).toBeVisible();
  await page.locator("#ny-akt-namn").fill("Truckteori");
  await page.locator("#ny-akt-datum").fill("2027-02-03");
  await page.locator("#ny-akt-tid").fill("13:00");

  // Nivå: Nivå 3 har 17 aktiva deltagare – namnen visas innan man skapar.
  await page.getByRole("tab", { name: "Nivå" }).click();
  await page.getByLabel("Nivå", { exact: true }).selectOption("grp-c-bot-niva-3");
  await expect(main(page).getByRole("status").filter({ hasText: "just nu" })).toHaveText("17 deltagare just nu. De som tillkommer bjuds in automatiskt fram till aktiviteten.");
  await expect(page.getByTestId("bjud-in-lista")).toContainText("BOT-26-0130");
  await expect(page.getByTestId("bjud-in-lista")).toContainText("BOT-26-0142");
  await expect(page.getByTestId("bjud-in-lista")).toContainText("BOT-26-0163");
  // Kryssrutan för inbjudan är förvald – också de som tillkommer senare får inbjudan.
  const notify = page.locator("#ny-meddela");
  await expect(notify).toBeChecked();
  await expect(main(page)).toContainText("De som tillkommer senare får också inbjudan.");
  await btn(page, "Skapa aktiviteten med 17 deltagare").click();
  // BOT-27-0019 har ett eget tillfälle vid samma tid i testdatat – servern hoppar över och säger det.
  await expect(toasts(page)).toContainText("Aktiviteten är skapad med 16 deltagare. 1 deltagare hoppades över: BOT-27-0019 (har en annan aktivitet vid samma tid).");
  await expect.poll(() => currentPath(page, info)).toMatch(/^\/aktiviteter\/[^/]+$/);
  await expect(page.getByTestId("aktivitet-deltagare")).toHaveCount(16);
  await expect(main(page)).toContainText("Nivå 3 – På väg – de som tillkommer bjuds in automatiskt fram till aktiviteten");

  // Aktiviteten har en målgrupp: fler bjuds in en och en (fliken Enskilda).
  await btn(page, "Bjud in deltagare").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Målgrupp: Nivå 3 – På väg");
  await expect(dialog.getByRole("tab")).toHaveCount(0);
  await dialog.locator("#akt-bjud-sok").fill("Nadia");
  await dialog.locator(`#akt-bjud-${SC.nadia}`).check();
  await expect(dialog.locator("#akt-bjud-meddela")).toBeChecked();
  await btn(dialog, "Bjud in 1 deltagare").click();
  await expect(toasts(page)).toContainText("1 deltagare inbjuden.");
  await expect(page.getByTestId("aktivitet-deltagare")).toHaveCount(17);
  await noBadText(page);

  // Utskicksloggen: inbjudningar med e-post – mottagaren är bara "deltagare (e-post)", aldrig ett namn.
  await switchUser(page, info, ADMIN, "/admin/mallar?flik=logg");
  const log = main(page);
  await expect(log).toContainText("Inbjudan till aktivitet");
  expect(await log.innerText()).not.toMatch(/Truckteori|Mehmet|Linnea/);
  expect(errors).toEqual([]);
});

test("Upprepa varje vecka: en nivåaktivitet tisdag och torsdag – tillfällena två veckor framåt, inget meddelande som standard", async ({ page }, info) => {
  const errors = await open(page, info, "/aktiviteter/ny", COACH);
  await page.locator("#ny-akt-namn").fill("Studiebesök");
  await page.locator("#ny-akt-datum").fill("2027-02-02");
  await page.locator("#ny-akt-tid").fill("15:00");
  await page.locator("#ny-upprepa").check();
  await page.locator("#ny-dag-2").check();
  await page.locator("#ny-dag-4").check();
  // En återkommande aktivitet har alltid en målgrupp: Yrkesområde eller Nivå – inte Enskilda.
  await expect(page.getByRole("tab", { name: "Enskilda" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Nivå" }).click();
  await page.getByLabel("Nivå", { exact: true }).selectOption("grp-c-bot-niva-3");
  await expect(page.locator("#ny-meddela-serie")).not.toBeChecked();
  await expect(main(page)).toContainText("Deltagarna får tiderna av sin coach. Slå på om de ska få ett meddelande inför varje tillfälle.");
  await btn(page, "Skapa den återkommande aktiviteten").click();
  await expect(toasts(page)).toContainText("Den återkommande aktiviteten är skapad. 4 tillfällen de närmaste två veckorna");
  await expect.poll(() => currentPath(page, info)).toMatch(/^\/aktiviteter\/[^/]+$/);
  await expect(main(page)).toContainText("Del av återkommande aktivitet: tis och tor 15.00");
  await expect(btn(page, "Ställ in bara det här tillfället")).toBeVisible();
  await expect(btn(page, "Avsluta hela serien")).toBeVisible();
  // Listan: Återkommande med dagarna och tiden.
  await go(page, info, "/aktiviteter");
  const rec = card(page, "Återkommande");
  await expect(rec).toContainText("Studiebesök");
  await expect(rec).toContainText("tis och tor 15.00");
  await noBadText(page);
  expect(errors).toEqual([]);
});

test("Enskilda: en vald deltagare som inte kan vara med den dagen stoppar inbjudan och går att kryssa ur", async ({ page }, info) => {
  const errors = await open(page, info, "/aktiviteter/ny", COACH);
  await page.locator("#ny-akt-namn").fill("CV-verkstad");
  await page.locator("#ny-akt-datum").fill("2027-02-03");
  await page.locator("#ny-akt-tid").fill("13:00");
  await invite(page, "Nadia", SC.nadia);
  await invite(page, "Elif", SC.elif);
  // Datumet ändras till före Elifs start: raden är fortfarande vald, med orsaken, och går att kryssa ur.
  await page.locator("#ny-akt-datum").fill("2027-01-05");
  const elif = page.locator(`#ny-bjud-${SC.elif}`);
  await expect(elif).toBeChecked();
  await expect(elif).toBeEnabled();
  await expect(page.getByTestId("bjud-in-sparrade")).toContainText("Elif Yilmaz (BOT-27-0003): Insatsen har inte startat den dagen");
  // Skapa: servern nekar och räknar upp Elif – ingen aktivitet skapas utan henne.
  await btn(page, "Skapa aktiviteten med 2 deltagare").click();
  await expect(main(page)).toContainText("Några deltagare kan inte bjudas in");
  await expect(main(page)).toContainText("BOT-27-0003: Insatsen har inte startat den dagen");
  expect(currentPath(page, info)).toBe("/aktiviteter/ny");
  // Elif kryssas ur: en deltagare kvar, och raden kan inte väljas igen den dagen.
  await elif.uncheck();
  await expect(elif).not.toBeChecked();
  await expect(elif).toBeDisabled();
  await expect(page.getByTestId("bjud-in-sparrade")).toHaveCount(0);
  await expect(btn(page, "Skapa aktiviteten med 1 deltagare")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Gruppmål: alla klarar automatiskt, coachen markerar en som Klarade inte och ändrar tillbaka – kommunen ser inget", async ({ page }, info) => {
  const errors = await open(page, info, "/aktiviteter/ny", COACH);
  await page.locator("#ny-akt-namn").fill("CV-verkstad");
  await page.locator("#ny-akt-datum").fill("2027-02-01");
  await page.locator("#ny-akt-tid").fill("08:00");
  await page.locator("#ny-akt-mal").fill("Alla skriver ett CV");
  await invite(page, "Nadia", SC.nadia);
  await invite(page, "Elif", SC.elif);
  // Aktiviteten har börjat: ingen inbjudan skickas.
  await expect(main(page)).toContainText("Aktiviteten har redan börjat. Inget meddelande skickas till deltagarna.");
  await btn(page, "Skapa aktiviteten med 2 deltagare").click();
  await expect(toasts(page)).toContainText("Aktiviteten är skapad med 2 deltagare.");
  await expect.poll(() => currentPath(page, info)).toMatch(/^\/aktiviteter\/[^/]+$/);

  await expect(main(page)).toContainText("Alla skriver ett CV");
  const summary = page.getByTestId("gruppmal-summa");
  await expect(summary).toContainText("Gruppmål: 2 av 2 klarade.");
  const row = (name: string) => page.getByTestId("aktivitet-deltagare").filter({ hasText: name });
  const goal = (name: string) => row(name).getByRole("group", { name: `Gruppmål för ${name}` });
  for (const n of ["Nadia Warsame", "Elif Yilmaz"]) {
    await expect(btn(goal(n), "Klarade")).toHaveAttribute("aria-pressed", "true");
    await expect(row(n).getByTestId("gruppmal")).toContainText("Automatiskt");
  }
  // Elif klarade inte målet.
  await btn(goal("Elif Yilmaz"), "Klarade inte").click();
  await expect(btn(goal("Elif Yilmaz"), "Klarade inte")).toHaveAttribute("aria-pressed", "true");
  await expect(row("Elif Yilmaz").getByTestId("gruppmal")).not.toContainText("Automatiskt");
  await expect(summary).toContainText("Gruppmål: 1 av 2 klarade.");
  await expect(row("Nadia Warsame").getByTestId("gruppmal")).toContainText("Automatiskt");
  // Efter omladdning ligger valet kvar; sedan ändras det tillbaka.
  await page.reload();
  await loaded(page);
  await expect(btn(goal("Elif Yilmaz"), "Klarade inte")).toHaveAttribute("aria-pressed", "true");
  await btn(goal("Elif Yilmaz"), "Klarade").click();
  await expect(summary).toContainText("Gruppmål: 2 av 2 klarade.");
  await expect(row("Elif Yilmaz").getByTestId("gruppmal")).not.toContainText("Automatiskt");
  // Nadia uteblev: hon står ändå som Klarade (automatiskt) och räknas med – alla klarar målet tills coachen markerar annat.
  await btn(row("Nadia Warsame").getByRole("group", { name: "Närvaro för Nadia Warsame" }), "Ogiltig frånvaro").click();
  await expect(row("Nadia Warsame")).toContainText("Ogiltig frånvaro");
  await expect(btn(goal("Nadia Warsame"), "Klarade")).toHaveAttribute("aria-pressed", "true");
  await expect(row("Nadia Warsame").getByTestId("gruppmal")).toContainText("Automatiskt");
  await expect(summary).toContainText("Gruppmål: 2 av 2 klarade.");
  await noBadText(page);

  // Kommunen: varken målet eller valet syns i portalen.
  await switchUser(page, info, { userId: "k-maria", role: "kommun_handlaggare" }, `/portal/deltagare/${SC.nadia}`);
  await expect(main(page)).toContainText("BOT-26-0143");
  expect(await main(page).innerText()).not.toMatch(/Alla skriver ett CV|Gruppmål|Klarade inte/);
  expect(errors).toEqual([]);
});
