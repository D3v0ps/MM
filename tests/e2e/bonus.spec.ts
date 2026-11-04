// Bonusstegen (Karims beslut 2026-11-04, SPEC §7.17) från coachen till kommunen och ekonomen – samma test mot prototypen
// och appen. BOT-26-0043 (Erik, Maria) har förslag till bonussteg 3 och 5 från regeln; verifieringens datum saknas.
//   1. Erik granskar: det som saknas står på sidan, han fyller i datumet, sparar och skickar – inga belopp.
//   2. Maria: bonusanspråket står under Att göra – Läs och besluta, Godkänn, Bekräfta beslutet.
//   3. Lars (ekonom): februaris bonusfaktura har raden för bonussteg 3, skild från månadens faktura.
// Bara påhittade uppgifter.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const ERIK = { userId: "u-erik", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const LARS = { userId: "u-lars", role: "ekonom" };
const CASE = "case-260043";
const CASE_NO = "BOT-26-0043";
const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";

const main = (page: Page) => page.locator("#main");
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
/** Belopp i kronor – får aldrig synas för coachen eller kommunen. */
const AMOUNT = /\d[  ]kr(?![a-zåäö])/i;

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

test("bonussteg 3: coachen skickar, kommunen godkänner i portalen och ekonomen ser bonusfakturan", async ({ page }, info) => {
  // 1. Coachen: kortet Bonus på deltagarkortet och granskningen.
  const errors = await open(page, info, `/arenden/${CASE}?flik=handelser`, ERIK);
  const bonusCard = main(page).locator("section").filter({ has: page.getByRole("heading", { name: "Bonus", exact: true }) }).first();
  await expect(bonusCard).toContainText("Bonussteg 3 · Arbete eller studier");
  await expect(bonusCard).toContainText("Förslag att granska");
  await expect(main(page)).not.toContainText(AMOUNT);
  await bonusCard.getByRole("link", { name: /^Granska och skicka\s+bonussteg 3/ }).click();
  await expect(main(page)).toContainText("Bonussteg 3 · Arbete eller studier");
  await expect(main(page)).toContainText("Fyll i verifieringens datum.");
  await page.getByLabel("Verifieringens datum").fill("2026-12-17");
  await page.getByLabel("Kommentar till kommunen").fill("Tillsvidareanställning som lagerarbetare.");
  await btn(main(page), "Spara").click();
  await expect(toasts(page)).toContainText("Sparat.");
  await expect(main(page)).toContainText("Allt som behövs finns.");
  await expect(main(page)).not.toContainText(AMOUNT);
  await btn(main(page), "Skicka till kommunen").click();
  const dialog = page.getByRole("dialog", { name: "Skicka till kommunen?" });
  await expect(dialog).toContainText("Mejlet har bara ärendenumret.");
  await btn(dialog, "Skicka till kommunen").click();
  await expect(toasts(page)).toContainText("Bonussteg 3 är skickat till kommunen.");
  await expect(main(page)).toContainText(CASE_NO);

  // 2. Kommunen: Att göra – Läs och besluta – Godkänn – Bekräfta beslutet (testdatats två anspråk i BOT-26-0027 och det nya).
  await goAs(page, info, "/portal", MARIA);
  await expect(main(page)).toContainText("Att göra (3)");
  await expect(main(page)).toContainText(`Bonus att besluta om – ${CASE_NO}`);
  await main(page).getByRole("link", { name: new RegExp(`^Läs och besluta\\s+om bonussteg 3 för ${CASE_NO}`) }).click();
  await expect(main(page)).toContainText("Miljonbemanning begär bonus enligt incitamentsmodellen.");
  await expect(main(page)).toContainText("Intyg och andra dokument finns inte i portalen.");
  await expect(main(page)).not.toContainText(AMOUNT);
  await btn(main(page), "Gå vidare till beslut").click();
  await btn(page.getByRole("group", { name: "Godkänner du bonusanspråket?" }), "Godkänn").click();
  await btn(main(page), "Fortsätt").click();
  await expect(main(page)).toContainText(`Du godkänner bonussteg 3 (Arbete eller studier) för ${CASE_NO}.`);
  await btn(main(page), "Bekräfta beslutet").click();
  await expect(main(page)).toContainText("Du har godkänt bonusanspråket");
  await expect(main(page)).not.toContainText(AMOUNT);
  await goAs(page, info, "/portal", MARIA);
  await expect(main(page)).toContainText("Att göra (2)");

  // 3. Ekonomen: februaris bonusfaktura – en rad för bonussteg 3, egen faktura.
  await goAs(page, info, "/ekonomi/bonus/2027-02", LARS);
  await expect(main(page)).toContainText("Bonusfaktura februari 2027");
  await expect(main(page)).toContainText(`${CASE_NO} · Bonussteg 3`);
  await expect(main(page)).toContainText("BOT-BONUS-3");
  await expect(main(page)).toContainText(AMOUNT);
  expect(relevant(errors)).toEqual([]);
});
