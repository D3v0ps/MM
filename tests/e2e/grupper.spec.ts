// Nivåer, yrkesområden och taggar, filter och massanteckningar (coachmötet 2026-10-09, Karims beslut 3 och 4; Karims beslut
// 2026-10-22: grupperna är yrkesområdena, nivån krävs i kartläggningen och kan höjas). Samma steg mot prototypen och appen:
// coachen (Adam kartlägger – här som coachen Amira) sätter nivå och Vill arbeta i kartläggningen; deltagarkortet visar dem med
// yrkesområdet och Höj nivå; ärendelistan filtrerar på yrkesområde, nivå och tagg; Grupper och nivåer; massanteckningar för ett
// yrkesområde; kommunen ser inget av det.
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

test("kartläggningen: coachen sätter nivå och Vill arbeta – gruppen är yrkesområdet; sparas direkt och syns i deltagarkortet", async ({ page }, info) => {
  const errors = await open(page, info, `/kartlaggning/${SC.amal}`, COACH);
  const c = card(page, "Nivå och yrkesområde");
  await expect(c).toContainText("Kommunen ser dem aldrig");
  await expect(c).toContainText("Välj nivå innan du godkänner kartläggningen");
  // Gruppen följer yrkesområdet – den väljs inte här, och fria grupper finns inte längre.
  await expect(c).toContainText("L – Övrigt");
  await expect(c.getByRole("button", { name: "Ny grupp" })).toHaveCount(0);
  const status = c.locator("[data-grouping-status]");
  await btn(c, "Nivå 2 – Behöver stöd för att komma igång").click();
  await expect(btn(c, "Nivå 2 – Behöver stöd för att komma igång")).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText(/Sparat \d\d\.\d\d/);
  // Nivån tas inte bort – "Ingen nivå än" finns inte längre som val.
  await expect(c.getByRole("button", { name: "Ingen nivå än" })).toHaveCount(0);
  await btn(c.getByRole("group", { name: "Vill arbeta" }), "Deltid").click();
  await expect(btn(c.getByRole("group", { name: "Vill arbeta" }), "Deltid")).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText(/Sparat \d\d\.\d\d/);
  await expect(c.getByTestId("nivahistorik")).toContainText("Nivå 2 från");
  // En rad till coacherna blir en anteckning.
  await c.getByLabel("En rad till coacherna (valfritt)").fill("Vill börja med lager. Behöver stöd med CV.");
  await btn(c, "Spara raden").click();
  await expect(page.getByText("Raden är sparad som en anteckning i deltagarkortet.")).toBeVisible();

  await go(page, info, `/arenden/${SC.amal}`);
  const row = page.locator("[data-grouping-row]");
  await expect(row).toContainText("Nivå 2 – Behöver stöd för att komma igång");
  await expect(row).toContainText("Vill arbeta: Deltid");
  // Yrkesområdet står på raden under, med Byt yrkesområde (Karims beslut 2026-10-22).
  await expect(page.locator("[data-area-row]")).toContainText("L – Övrigt");
  expect(relevant(errors)).toEqual([]);
});

test("deltagarkortet: Höj nivå ett steg och Ändra öppnar samma val; ärendelistan filtrerar på yrkesområde, nivå och tagg", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, COACH);
  const row = page.locator("[data-grouping-row]");
  await expect(row).toContainText("Nivå 4 – Nära arbete");
  await expect(page.locator("[data-area-row]")).toContainText("G – Lager och logistik");
  await btn(row, /^Höj nivå/).click();
  await expect(page.getByText(/Nivån är höjd till Nivå 5 – Redo för arbete\./)).toBeVisible();
  await expect(row).toContainText("Nivå 5 – Redo för arbete");
  // Nivå 5 är den högsta – ingen Höj nivå.
  await expect(row.getByRole("button", { name: /^Höj nivå/ })).toHaveCount(0);
  await btn(row, /^Ändra/).click();
  const dialog = page.getByRole("dialog", { name: "Nivå och yrkesområde" });
  await expect(btn(dialog, "Nivå 5 – Redo för arbete")).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByTestId("nivahistorik")).toContainText("Nivå 3 från");
  await expect(dialog.getByTestId("nivahistorik")).toContainText("Nivå 4 från");
  // En osparad rad till coacherna kastas inte tyst: Klar frågar först.
  await dialog.getByLabel("En rad till coacherna (valfritt)").fill("Vill prova lagerjobb.");
  await btn(dialog, "Klar").click();
  const ask = page.getByRole("dialog", { name: "Vill du slänga det du skrivit?" });
  await expect(ask).toContainText("Det du har skrivit i rutan sparas inte.");
  await btn(ask, "Fortsätt skriva").click();
  await expect(ask).toHaveCount(0);
  await expect(dialog.getByLabel("En rad till coacherna (valfritt)")).toHaveValue("Vill prova lagerjobb.");
  await btn(dialog, "Spara raden").click();
  await expect(page.getByText("Raden är sparad som en anteckning i deltagarkortet.")).toBeVisible();
  await btn(dialog, "Klar").click();
  await expect(dialog).toHaveCount(0);

  await go(page, info, "/arenden?vilka=alla");
  await expect(page.getByRole("columnheader", { name: "Nivå" })).toBeVisible();
  await page.getByLabel("Nivå", { exact: true }).selectOption({ label: "Nivå 5 – Redo för arbete" });
  await expect(main(page)).toContainText("BOT-26-0143");
  await page.getByLabel("Yrkesområde", { exact: true }).selectOption("F");
  await expect(main(page)).not.toContainText("BOT-26-0143");
  await page.getByLabel("Yrkesområde", { exact: true }).selectOption("G");
  await page.getByLabel("Tagg", { exact: true }).selectOption({ label: "Vill arbeta: Heltid" });
  await expect(main(page)).toContainText("BOT-26-0143");
  // Bara id:n och koder i adressen – aldrig namnen.
  expect(page.url()).toMatch(/niva=grp-c-bot-niva-5/);
  expect(page.url()).toMatch(/omrade=G/);
  expect(decodeURIComponent(page.url())).not.toMatch(/Lager|Heltid|Nivå/);
  await expect(page.getByLabel("Grupp", { exact: true })).toHaveCount(0);

  // Coachens Närvaro: samma filter (Nadia har yrkesområde G, inte F).
  await go(page, info, "/narvaro?vecka=forra");
  await page.getByRole("button", { name: /^Alla \(\d+\)$/ }).click();
  await expect(main(page)).toContainText("Nadia Warsame");
  await page.getByLabel("Yrkesområde", { exact: true }).selectOption("F");
  await expect(main(page)).not.toContainText("Nadia Warsame");
  await expect(page.getByTestId("narvaro-rad").first()).toBeVisible();
  expect(relevant(errors)).toEqual([]);
});

test("Grupper och nivåer: yrkesområdena med månadens träff eller Planera, nivåerna med deltagare och återkommande aktiviteter, de utan nivå", async ({ page }, info) => {
  const errors = await open(page, info, "/grupper", COACH);
  await expect(page.getByRole("heading", { level: 1, name: "Grupper och nivåer" })).toBeVisible();
  const areas = card(page, "Yrkesområden");
  const g = areas.getByTestId("yrkesomrade").filter({ hasText: "G – Lager och logistik" });
  await expect(g).toContainText("aktiva deltagare");
  await expect(g).toContainText("Yrkesområdesträff: lager och logistik");
  const e = areas.getByTestId("yrkesomrade").filter({ hasText: "E – Transport och åkeri" });
  await expect(e).toContainText("Ingen träff planerad i februari");
  const levels = card(page, "Nivåer");
  const n4 = levels.getByTestId("niva").filter({ hasText: "Nivå 4 – Nära arbete" });
  await expect(n4).toContainText("Jobbsök och CV – mån och ons 13.30");
  await expect(n4.getByRole("link", { name: /Nadia Warsame/ })).toBeVisible();
  await expect(card(page, "Utan nivå – att kartlägga").getByTestId("utan-niva").filter({ hasText: "BOT-27-0012" })).toHaveCount(1);
  for (const word of ["Måndagsgruppen", "Lagergruppen", "Höstgruppen", "Ny grupp"]) await expect(main(page)).not.toContainText(word);
  // Planera: Ny aktivitet med yrkesområdet förvalt – deltagarna räknas direkt.
  await btn(e, /^Planera/).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ny aktivitet" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Yrkesområde" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Yrkesområde", { exact: true })).toHaveValue("E");
  await expect(main(page).getByRole("status").filter({ hasText: "just nu" })).toHaveText("4 deltagare just nu. De som tillkommer bjuds in automatiskt fram till aktiviteten.");
  expect(relevant(errors)).toEqual([]);
});

test("massanteckningar för ett yrkesområde: en anteckning per ifylld rad, tomma hoppas över, personnummer stoppas vid raden", async ({ page }, info) => {
  const errors = await open(page, info, "/anteckningar", COACH);
  await page.getByLabel("Visa", { exact: true }).selectOption({ label: "Ett yrkesområde" });
  await page.getByLabel("Yrkesområde", { exact: true }).selectOption("G");
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

test("kommunen ser inget av nivåer och taggar", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, COACH);
  await expect(page.locator("[data-grouping-row]")).toContainText("Nivå 4 – Nära arbete");
  if (isDemo(info)) await open(page, info, `/portal/deltagare/${SC.nadia}`, MARIA);
  else {
    await switchPersona(page, MARIA);
    await page.goto(`/portal/deltagare/${SC.nadia}`);
  }
  await expect(main(page)).toContainText("BOT-26-0143");
  for (const word of ["Nivå 4", "Nära arbete", "Vill arbeta", "Heltid", "Nivå och yrkesområde", "Nivå och taggar", "Byt yrkesområde", "Jobbsök och CV"]) await expect(main(page)).not.toContainText(word);
  await go(page, info, "/portal/deltagare");
  await expect(main(page)).toContainText("Mina deltagare");
  await expect(main(page)).toContainText("Nadia Öztürk");
  for (const word of ["Nivå 4", "Vill arbeta"]) await expect(main(page)).not.toContainText(word);
  expect(relevant(errors)).toEqual([]);
});
