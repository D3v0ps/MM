// Byt yrkesområde (Karims beslut 2026-10-22). Samma steg mot prototypen och appen: huvudcoachen byter Nadias yrkesområde från
// G (Lager och logistik) till F (Lokalvård) med en kort motivering i deltagarkortet. Yrkesområdet är deltagarens grupp:
// inbjudningarna följer direkt – hon tas bort ur G:s yrkesområdesträff och bjuds in till F:s. Fakturan räknas på det nya
// yrkesområdet från månaden efter. Kommunen ser bara det nya yrkesområdet, aldrig motiveringen eller knappen.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const COACH = { userId: "u-amira", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const NADIA = "case-260143";
const NADIA_NO = "BOT-26-0143";
// Testdatats yrkesområdesträffar i februari (vanliga aktiviteter med ett yrkesområde som målgrupp).
const G_MEETING = "ga-traff-c-bot-g-2027-02";
const F_MEETING = "ga-traff-c-bot-f-2027-02";
const WHY = "Kartläggningen visade erfarenhet av städning och ett tydligt mål att arbeta med lokalvård.";
const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";

const main = (page: Page) => page.locator("#main");
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
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

test("byt yrkesområde: motivering krävs, inbjudningarna följer direkt och kommunen ser bara det nya yrkesområdet", async ({ page }, info) => {
  // Före bytet: Nadia är inbjuden till G:s träff av målgruppen, inte till F:s.
  const errors = await open(page, info, `/aktiviteter/${G_MEETING}`, COACH);
  await expect(main(page)).toContainText(NADIA_NO);
  // Den som yrkesområdet bjöd in tas inte bort här: raden säger varför (byt yrkesområde, eller frånvaro när träffen har börjat).
  await expect(page.getByTestId("automatisk-hjalp").first()).toContainText("Inbjuden automatiskt via yrkesområdet");
  await go(page, info, `/aktiviteter/${F_MEETING}`);
  await expect(main(page)).toContainText("Yrkesområdesträff: lokalvård");
  await expect(main(page)).not.toContainText(NADIA_NO);

  await go(page, info, `/arenden/${NADIA}`);
  // Raden i kortets huvud: nivå, yrkesområde (deltagarens grupp) och taggar. Inga byten än.
  const row = page.locator("[data-grouping-row]");
  await expect(row).toContainText("G – Lager och logistik");
  await expect(page.getByRole("list", { name: "Byten av yrkesområde" })).toHaveCount(0);
  // Byt yrkesområde finns i dialogen Nivå och yrkesområde (Ändra), vid yrkesområdet.
  await btn(row, /^Ändra/).click();
  const outer = page.getByRole("dialog", { name: "Nivå och yrkesområde" });
  await expect(outer).toContainText("Byter du yrkesområde bjuds deltagaren in till det nya yrkesområdets träffar direkt.");
  await btn(outer, "Byt yrkesområde").click();
  const dialog = page.getByRole("dialog", { name: "Byt yrkesområde" });
  await expect(dialog).toContainText("Grupp och inbjudningar ändras direkt.");
  await expect(dialog).toContainText("Fakturan räknas på det nya yrkesområdet från och med mars 2027.");
  // Utan val och motivering: felen står vid fälten och inget sparas.
  await btn(dialog, "Byt yrkesområde").click();
  await expect(dialog).toContainText("Välj det nya yrkesområdet.");
  await expect(dialog).toContainText("Skriv en kort motivering, 10–300 tecken.");
  await dialog.getByLabel("Nytt yrkesområde").selectOption("F");
  // Yrkesspåret hör till yrkesområdet: det nya yrkesområdets spår erbjuds, det gamla följer inte med.
  await dialog.getByLabel("Yrkesspår i det nya yrkesområdet").selectOption("Lokalvårdare med certifiering");
  await dialog.getByLabel("Motivering").fill(WHY);
  await btn(dialog, "Byt yrkesområde").click();
  await expect(toasts(page)).toContainText("Yrkesområdet är bytt. Fakturan räknas på det nya yrkesområdet från och med mars 2027.");
  await expect(toasts(page)).toContainText("Deltagaren är inbjuden till 1 kommande aktivitet för det nya yrkesområdet.");
  await expect(toasts(page)).toContainText("Deltagaren är borttagen ur 1 kommande aktivitet för det förra yrkesområdet.");
  await expect(dialog).toHaveCount(0);
  // Dialogen Nivå och yrkesområde står kvar med det nya yrkesområdet; Klar stänger.
  await expect(outer).toContainText("F – Lokalvård");
  await btn(outer, "Klar").click();
  await expect(outer).toHaveCount(0);
  await expect(row).toContainText("F – Lokalvård");
  const history = page.getByRole("list", { name: "Byten av yrkesområde" });
  await expect(history).toContainText("G Lager och logistik → F Lokalvård (Amira Haddad) – fakturan från mars");
  await expect(history).toContainText(`Motivering: ${WHY}`);

  // Efter bytet: borta ur G:s träff, inbjuden till F:s.
  await go(page, info, `/aktiviteter/${G_MEETING}`);
  await expect(main(page)).toContainText("Yrkesområdesträff: lager och logistik");
  await expect(main(page)).not.toContainText(NADIA_NO);
  await go(page, info, `/aktiviteter/${F_MEETING}`);
  await expect(main(page)).toContainText(NADIA_NO);

  // Kommunen: det nya yrkesområdet – aldrig motiveringen, bytet eller knappen.
  await goAs(page, info, `/portal/deltagare/${NADIA}`, MARIA);
  await expect(main(page)).toContainText(NADIA_NO);
  await expect(main(page)).toContainText("Lokalvård");
  for (const word of ["Lager och logistik", "Byt yrkesområde", "Kartläggningen visade", "fakturan från"]) await expect(main(page)).not.toContainText(word);
  expect(relevant(errors)).toEqual([]);
});
