// Filer på deltagarkortet (Karims beslut 2026-10-29): CV, personligt brev, betyg och intyg – bara Miljonbemanning. Samma steg
// mot prototypen och appen (minnesläget – innehållet skickas med kommandot, ingen lagring att ladda upp till): coachen ser
// testdatats filer under sina typer, laddar upp ett CV (typen krävs, fel filtyp stoppas), öppnar det och tar bort det efter en
// fråga. Kommunens portal visar aldrig filerna, och chefen (läsläge) ser inte kortet. Bara påhittade filer.
import fs from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const COACH = { userId: "u-amira", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const CHEF = { userId: "u-karin", role: "chef" };
const NADIA = "case-260143";
const NADIA_NO = "BOT-26-0143";
const YUSUF = "case-260148"; // pågående, inga filer
const WAITING = "case-270050"; // ordererkänd – väntar på beslut
const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";
const PDF = Buffer.from("%PDF-1.7\n% påhittat cv för testet\n");

const main = (page: Page) => page.locator("#main");
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const filesCard = (page: Page) => main(page).locator("section#deltagarfiler");
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

/** Samma testperson, en annan sida (prototypen: hashen; appen: ny sida – testdatat ligger kvar på servern). */
async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, to);
  else await page.goto(to);
  await expect(main(page)).toBeVisible();
  await expect(main(page)).not.toContainText("Hämtar…", { timeout: 15_000 });
}

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

test("filer på deltagarkortet: ladda upp ett CV med typ, öppna det och ta bort det – kommunen ser aldrig filerna", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${NADIA}`, COACH);
  const card = filesCard(page);
  await expect(card.getByRole("heading", { level: 2, name: "Filer" })).toBeVisible();
  // Testdatats filer, grupperade efter typ.
  await expect(card.getByRole("list", { name: "CV", exact: true })).toContainText("CV truckförare januari 2027.pdf");
  await expect(card.getByRole("list", { name: "Personligt brev", exact: true })).toContainText("Personligt brev lager.pdf");
  await expect(card.getByRole("list", { name: "Betyg och intyg", exact: true })).toContainText("Intyg truckkort A och B.pdf");
  await expect(card.getByRole("list", { name: "Betyg och intyg", exact: true })).toContainText("av Sara Lindqvist");
  await expect(card.getByRole("list", { name: "Övrigt", exact: true })).toHaveCount(0);
  await expect(card).toContainText("Filerna syns bara för Miljonbemanning – aldrig för kommunen.");
  // Beställningens bilagor ligger kvar i kortet Bakgrund från beställningen – deltagarfilerna står inte där.
  await expect(main(page).getByRole("list", { name: "Bilagor" })).toHaveCount(0);

  // Ladda upp: typen och filen krävs, hjälptexten står vid fältet.
  await btn(card, "Ladda upp fil").click();
  const dialog = page.getByRole("dialog", { name: "Ladda upp fil" });
  await expect(dialog).toContainText("PDF, Word eller bild, högst 10 MB. Filerna syns bara för Miljonbemanning – aldrig för kommunen.");
  await btn(dialog, "Ladda upp").click();
  await expect(dialog).toContainText("Välj vilken typ av fil det är.");
  await expect(dialog).toContainText("Välj en fil.");
  await dialog.locator("#deltagarfil-typ").selectOption({ label: "CV" });
  // Fel filtyp stoppas redan i webbläsaren.
  await dialog.locator("#deltagarfil-fil").setInputFiles({ name: "skript.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ påhittad") });
  await expect(dialog).toContainText("Filtypen tas inte emot. Bifoga en PDF, ett Word-dokument eller en bild.");
  await dialog.locator("#deltagarfil-fil").setInputFiles({ name: "CV-test.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(dialog).not.toContainText("Filtypen tas inte emot");
  await btn(dialog, "Ladda upp").click();
  await expect(toasts(page)).toContainText("CV-test.pdf är uppladdad under CV.", { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);
  const cvList = card.getByRole("list", { name: "CV", exact: true });
  await expect(cvList).toContainText("CV-test.pdf");
  await expect(cvList).toContainText("av Amira Haddad");
  // Nyaste först.
  await expect(cvList.getByRole("listitem").first()).toContainText("CV-test.pdf");

  // Öppna: filen sparas med sitt namn och sitt innehåll (minnesläget – appen hämtar med en signerad adress i 60 sekunder).
  const [dl] = await Promise.all([page.waitForEvent("download"), btn(card, "Öppna CV-test.pdf").click()]);
  expect(dl.suggestedFilename()).toBe("CV-test.pdf");
  expect(fs.readFileSync((await dl.path())!).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // Adressen innehåller aldrig filnamnet.
  expect(page.url()).not.toContain("CV-test");

  // Ta bort – efter en fråga. Avbryt först: filen ligger kvar.
  await btn(card, "Ta bort CV-test.pdf").click();
  let confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Ta bort filen?" }));
  await expect(confirm).toContainText("CV-test.pdf (CV) tas bort från deltagarkortet. Filen går inte att få tillbaka.");
  await page.keyboard.press("Escape");
  await expect(cvList).toContainText("CV-test.pdf");
  await btn(card, "Ta bort CV-test.pdf").click();
  confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Ta bort filen?" }));
  await btn(confirm, "Ta bort filen").click();
  await expect(toasts(page)).toContainText("Filen är borttagen.");
  await expect(cvList).not.toContainText("CV-test.pdf");
  await expect(cvList).toContainText("CV truckförare januari 2027.pdf");
  // Fokus till kortets rubrik när raden försvinner.
  await expect(card.getByRole("heading", { level: 2, name: "Filer" })).toBeFocused();

  // Kommunen (Maria beställde Nadias insats): inga filer, inga filnamn och inget kort Filer i portalen.
  await goAs(page, info, `/portal/deltagare/${NADIA}`, MARIA);
  await expect(main(page)).toContainText(NADIA_NO);
  for (const word of ["CV truckförare", "Personligt brev lager", "Intyg truckkort", "Ladda upp fil", "Filerna syns bara"]) await expect(main(page)).not.toContainText(word);

  // Chefen ser deltagarkortet i läsläge – utan kortet Filer.
  await goAs(page, info, `/arenden/${NADIA}`, CHEF);
  await expect(main(page)).toContainText(NADIA_NO);
  await expect(filesCard(page)).toHaveCount(0);
  await expect(main(page)).not.toContainText("CV truckförare");
  expect(relevant(errors)).toEqual([]);
});

test("filer på deltagarkortet: tomt läge, och ingen uppladdning innan beställningen är bekräftad", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${YUSUF}`, COACH);
  const card = filesCard(page);
  await expect(card).toContainText("Inga filer ännu");
  await expect(card).toContainText("Här sparar ni deltagarens CV, personliga brev, betyg och intyg.");
  await expect(btn(card, "Ladda upp fil")).toBeVisible();
  // Tangentbordet: knappen nås och öppnar dialogen; Esc stänger och fokus går tillbaka till knappen.
  await btn(card, "Ladda upp fil").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Ladda upp fil" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#deltagarfil-typ")).toBeFocused();
  // Etiketterna hör till fälten (skärmläsare).
  await expect(dialog.getByLabel("Typ av fil")).toHaveAttribute("id", "deltagarfil-typ");
  await expect(dialog.locator("label[for=deltagarfil-fil]")).toContainText("Fil");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(btn(card, "Ladda upp fil")).toBeFocused();

  // En ordererkänd beställning: kortet säger varför det inte går att ladda upp ännu.
  await go(page, info, `/arenden/${WAITING}`);
  await expect(filesCard(page)).toContainText("Filer kan laddas upp när beställningen är bekräftad.");
  await expect(btn(filesCard(page), "Ladda upp fil")).toHaveCount(0);
  expect(relevant(errors)).toEqual([]);
});
