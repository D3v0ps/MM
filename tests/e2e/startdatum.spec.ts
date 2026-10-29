// Ändra startdatum (Karims beslut 2026-10-29). Samma steg mot prototypen och appen: samordnaren flyttar starten för
// BOT-27-0041 (startade 1 februari, inga registrerade tillfällen) till 3 februari med en motivering i deltagarkortet – dagens
// tillfälle tas bort och ändringen står under startdatumet. Kommunens portal visar det nya startdatumet, aldrig motiveringen.
// En fakturerad månad (december) och ett tillfälle med registrerad närvaro stoppar ändringen – felet står vid datumfältet.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const SARA = { userId: "u-sara", role: "samordnare" };
const COACH = { userId: "u-amira", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const NEW = "case-270041";
const NEW_NO = "BOT-27-0041";
const WHY = "Deltagaren kunde inte komma första dagen och började på onsdagen i stället.";
const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";

const main = (page: Page) => page.locator("#main");
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const startFact = (page: Page) => page.locator("[data-start-fact]");

/** En annan testperson utan att nollställa det som gjorts i testet (prototypen spelar upp kommandologgen igen). */
async function goAs(page: Page, info: TestInfo, to: string, as: { userId: string; role: string }) {
  if (isDemo(info)) {
    await page.evaluate(({ key, as, to }) => {
      localStorage.setItem(key, JSON.stringify(as));
      window.location.hash = to;
    }, { key: PERSONA_KEY, as, to });
    await page.reload();
  } else {
    await switchPersona(page, as);
    await page.goto(to);
  }
  await expect(main(page)).not.toContainText("Hämtar…", { timeout: 15_000 });
}

test("ändra startdatum: motivering krävs, tillfället före det nya datumet tas bort och kommunen ser bara det nya startdatumet", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${NEW}`, SARA);
  await expect(main(page)).toContainText(NEW_NO);
  await expect(startFact(page)).toContainText("Start:1 feb 2027");
  await expect(page.getByRole("list", { name: "Ändringar av startdatum" })).toHaveCount(0);
  await btn(startFact(page), "Ändra startdatum").click();
  const dialog = page.getByRole("dialog", { name: "Ändra startdatum" });
  await expect(dialog).toContainText("Tillfällen före det nya datumet utan närvaro tas bort. Inga tillfällen skapas bakåt – lägg till dem som hände och registrera närvaron. Planerat slut ändras inte.");
  await expect(dialog).toContainText("Kommunen ser det nya startdatumet i portalen men får inget meddelande.");
  // Utan nytt datum och motivering: felen står vid fälten och inget sparas.
  await btn(dialog, "Ändra startdatum").click();
  await expect(dialog).toContainText("Det är redan insatsens startdatum. Välj ett annat datum.");
  await expect(dialog).toContainText("Skriv en kort motivering, 10–300 tecken.");
  await dialog.getByLabel("Nytt startdatum").fill("2027-02-03");
  await dialog.getByLabel("Motivering").fill(WHY);
  await btn(dialog, "Ändra startdatum").click();
  await expect(toasts(page)).toContainText("Startdatumet är ändrat till 3 feb 2027. 1 tillfälle före det nya datumet togs bort.");
  await expect(dialog).toHaveCount(0);
  await expect(startFact(page)).toContainText("Start:3 feb 2027");
  const history = page.getByRole("list", { name: "Ändringar av startdatum" });
  await expect(history).toContainText("startdatum 1 feb 2027 → 3 feb 2027 (Sara Lindqvist)");
  await expect(history).toContainText(`Motivering: ${WHY}`);

  // Kommunen: det nya startdatumet – aldrig motiveringen, ändringen eller knappen.
  await goAs(page, info, `/portal/deltagare/${NEW}`, MARIA);
  await expect(main(page)).toContainText(NEW_NO);
  await expect(main(page)).toContainText("Start 3 februari 2027");
  for (const word of ["Ändra startdatum", "kunde inte komma", "Ändrat startdatum", "Ändringar av startdatum"]) await expect(main(page)).not.toContainText(word);
  expect(relevant(errors)).toEqual([]);
});

test("ändra startdatum stoppas: fakturerad månad och registrerad närvaro – felet står vid datumfältet och inget ändras", async ({ page }, info) => {
  // BOT-26-0126 startade 1 december – december är fakturerad i testdatat.
  const errors = await open(page, info, "/arenden/case-260126", COACH);
  await expect(startFact(page)).toContainText("Start:1 dec 2026");
  await btn(startFact(page), "Ändra startdatum").click();
  let dialog = page.getByRole("dialog", { name: "Ändra startdatum" });
  await dialog.getByLabel("Nytt startdatum").fill("2026-12-08");
  await dialog.getByLabel("Motivering").fill(WHY);
  await btn(dialog, "Ändra startdatum").click();
  await expect(dialog.getByRole("alert")).toContainText("December 2026 är redan fakturerad. Ekonomen behöver kreditera fakturan innan startdatumet kan ändras.");
  await expect(dialog.getByLabel("Nytt startdatum")).toHaveAttribute("aria-invalid", "true");
  // Avbryt: dialogen frågar om det ifyllda ska slängas.
  await btn(dialog, "Avbryt").click();
  await btn(page.getByRole("dialog", { name: "Vill du slänga det du skrivit?" }), /Släng/).click();
  await expect(dialog).toHaveCount(0);
  await expect(startFact(page)).toContainText("Start:1 dec 2026");

  // BOT-27-0031: testdatats ändring står under startdatumet; närvaron 26–28 januari är registrerad.
  await goAs(page, info, "/arenden/case-270031", COACH);
  const history = page.getByRole("list", { name: "Ändringar av startdatum" });
  await expect(history).toContainText("startdatum 1 feb 2027 → 26 jan 2027 (Amira Haddad)");
  await expect(history).toContainText("Motivering: Deltagaren började redan vid första mötet den 26 januari.");
  await btn(startFact(page), "Ändra startdatum").click();
  dialog = page.getByRole("dialog", { name: "Ändra startdatum" });
  await dialog.getByLabel("Nytt startdatum").fill("2027-02-02");
  await dialog.getByLabel("Motivering").fill(WHY);
  await btn(dialog, "Ändra startdatum").click();
  await expect(dialog.getByRole("alert")).toContainText("3 tillfällen före det nya startdatumet har registrerad närvaro. Ett tillfälle med registrerad närvaro tas aldrig bort, så startdatumet kan vara senast 26 jan 2027.");
  expect(relevant(errors)).toEqual([]);
});
