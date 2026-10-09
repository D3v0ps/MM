// Nivåer, grupper och taggar, filter och massanteckningar (coachmötet 2026-10-09, Karims beslut 3 och 4). Samma steg mot
// prototypen och appen: coachen (Adam kartlägger – här som coachen Amira) sätter nivå, grupp och Vill arbeta i
// kartläggningen; deltagarkortet visar dem; ärendelistan filtrerar; massanteckningar för en grupp; kommunen ser inget av det.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const COACH = { userId: "u-amira", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const SC = { nadia: "case-260143", amal: "case-270012" };

const main = (page: Page) => page.locator("#main");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const card = (page: Page, title: string | RegExp) => page.locator("section").filter({ has: page.locator("h2", { hasText: title }) });
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, to);
  else await page.goto(to);
  await expect(main(page)).toBeVisible();
}

test("kartläggningen: coachen sätter nivå, grupp (också en ny) och Vill arbeta – sparas direkt och syns i deltagarkortet", async ({ page }, info) => {
  const errors = await open(page, info, `/kartlaggning/${SC.amal}`, COACH);
  const c = card(page, "Nivå och grupp");
  await expect(c).toContainText("Kommunen ser dem aldrig");
  const status = c.locator("[data-grouping-status]");
  await btn(c, "Nivå 2 – Behöver stöd för att komma igång").click();
  await expect(btn(c, "Nivå 2 – Behöver stöd för att komma igång")).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText(/Sparat \d\d\.\d\d/);
  await btn(c, "Måndagsgruppen").click();
  await expect(btn(c, "Måndagsgruppen")).toHaveAttribute("aria-pressed", "true");
  // Ny grupp: skapas och väljs direkt.
  await btn(c, "Ny grupp").click();
  await c.getByLabel("Namn på den nya gruppen").fill("Tisdagsgruppen");
  await btn(c, "Skapa och välj").click();
  await expect(btn(c, "Tisdagsgruppen")).toHaveAttribute("aria-pressed", "true");
  await btn(c.getByRole("group", { name: "Vill arbeta" }), "Deltid").click();
  await expect(btn(c.getByRole("group", { name: "Vill arbeta" }), "Deltid")).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText(/Sparat \d\d\.\d\d/);
  // En rad till coacherna blir en anteckning.
  await c.getByLabel("En rad till coacherna (valfritt)").fill("Vill börja med lager. Behöver stöd med CV.");
  await btn(c, "Spara raden").click();
  await expect(page.getByText("Raden är sparad som en anteckning i deltagarkortet.")).toBeVisible();

  await go(page, info, `/arenden/${SC.amal}`);
  const row = page.locator("[data-grouping-row]");
  await expect(row).toContainText("Nivå 2 – Behöver stöd för att komma igång");
  await expect(row).toContainText("Måndagsgruppen");
  await expect(row).toContainText("Tisdagsgruppen");
  await expect(row).toContainText("Vill arbeta: Deltid");
  expect(relevant(errors)).toEqual([]);
});

test("deltagarkortet visar nivån – Ändra öppnar samma val; ärendelistan filtrerar på nivå, grupp och tagg", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, COACH);
  const row = page.locator("[data-grouping-row]");
  await expect(row).toContainText("Nivå 4 – Nära arbete");
  await expect(row).toContainText("Lagergruppen");
  await btn(row, /^Ändra/).click();
  const dialog = page.getByRole("dialog", { name: "Nivå och grupp" });
  await expect(btn(dialog, "Nivå 4 – Nära arbete")).toHaveAttribute("aria-pressed", "true");
  await btn(dialog, "Nivå 5 – Redo för arbete").click();
  await expect(dialog.locator("[data-grouping-status]")).toHaveText(/Sparat \d\d\.\d\d/);
  await btn(dialog, "Klar").click();
  await expect(row).toContainText("Nivå 5 – Redo för arbete");

  await go(page, info, "/arenden?vilka=alla");
  await expect(page.getByRole("columnheader", { name: "Nivå" })).toBeVisible();
  await page.getByLabel("Nivå", { exact: true }).selectOption({ label: "Nivå 5 – Redo för arbete" });
  await expect(main(page)).toContainText("BOT-26-0143");
  await page.getByLabel("Grupp", { exact: true }).selectOption({ label: "Måndagsgruppen" });
  await expect(main(page)).not.toContainText("BOT-26-0143");
  await page.getByLabel("Grupp", { exact: true }).selectOption({ label: "Lagergruppen" });
  await page.getByLabel("Tagg", { exact: true }).selectOption({ label: "Vill arbeta: Heltid" });
  await expect(main(page)).toContainText("BOT-26-0143");
  // Bara id:n i adressen – aldrig namnen.
  expect(page.url()).toMatch(/niva=grp-c-bot-niva-5/);
  expect(decodeURIComponent(page.url())).not.toMatch(/Lager|Heltid|Nivå/);

  // Coachens Närvaro: samma filter (Nadia är i Lagergruppen, inte i Måndagsgruppen).
  await go(page, info, "/narvaro?vecka=forra");
  await page.getByRole("button", { name: /^Alla \(\d+\)$/ }).click();
  await expect(main(page)).toContainText("Nadia Warsame");
  await page.getByLabel("Grupp", { exact: true }).selectOption({ label: "Måndagsgruppen" });
  await expect(main(page)).not.toContainText("Nadia Warsame");
  await expect(page.getByTestId("narvaro-rad").first()).toBeVisible();
  expect(relevant(errors)).toEqual([]);
});

test("massanteckningar för en grupp: en anteckning per ifylld rad, tomma hoppas över, personnummer stoppas vid raden", async ({ page }, info) => {
  const errors = await open(page, info, "/anteckningar", COACH);
  await page.getByLabel("Visa", { exact: true }).selectOption({ label: "En grupp" });
  // Alternativen visar antalet deltagare ("Måndagsgruppen (5)") – välj på id:t.
  await page.getByLabel("Grupp", { exact: true }).selectOption("grp-c-bot-g-mandag");
  const rows = page.locator("[data-mass-note-row]");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(2);
  await expect(page.getByLabel("Datum", { exact: true })).toHaveValue("2027-02-01");
  const save = page.getByRole("button", { name: /^Spara \d+ anteckning/ });
  await expect(save).toHaveText("Spara 0 anteckningar");
  await rows.nth(0).locator("textarea").fill("Var med på gruppträffen och pratade om CV.");
  await rows.nth(1).locator("textarea").fill("Personnummer 850101-1234 stod på lappen.");
  await expect(save).toHaveText("Spara 2 anteckningar");
  await save.click();
  await expect(rows.nth(1)).toContainText("Det ser ut som ett personnummer");
  await expect(main(page)).toContainText("Inget är sparat");
  await rows.nth(1).locator("textarea").fill("Kom sent men deltog.");
  await save.click();
  await expect(page.getByText("2 anteckningar är sparade.")).toBeVisible();
  await expect(save).toHaveText("Spara 0 anteckningar");
  expect(relevant(errors)).toEqual([]);
});

test("kommunen ser inget av nivåer, grupper och taggar", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, COACH);
  await expect(page.locator("[data-grouping-row]")).toContainText("Nivå 4 – Nära arbete");
  if (isDemo(info)) await open(page, info, `/portal/deltagare/${SC.nadia}`, MARIA);
  else {
    await switchPersona(page, MARIA);
    await page.goto(`/portal/deltagare/${SC.nadia}`);
  }
  await expect(main(page)).toContainText("BOT-26-0143");
  for (const word of ["Nivå 4", "Nära arbete", "Lagergruppen", "Vill arbeta", "Heltid", "Nivå och grupp"]) await expect(main(page)).not.toContainText(word);
  await go(page, info, "/portal/deltagare");
  await expect(main(page)).toContainText("Mina deltagare");
  await expect(main(page)).toContainText("Nadia Öztürk");
  for (const word of ["Nivå 4", "Lagergruppen", "Vill arbeta"]) await expect(main(page)).not.toContainText(word);
  expect(relevant(errors)).toEqual([]);
});
