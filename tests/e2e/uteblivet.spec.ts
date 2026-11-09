// Deltagaren kom inte till första mötet (Karims beslut 2026-11-09, SPEC §7.4) – samma test mot prototypen och appen. BOT-27-0043
// (huvudcoach Erik, handläggare Omar) är bekräftat och första mötet var fredag 29 januari kl. 14.00 (demoklockan: måndag 1 februari
// kl. 09.12).
//   1. Erik: Deltagaren kom inte → Uteblev utan att meddela → Spara. Rutan "Kom inte till första mötet …" ersätter "starta
//      insatsen", med Boka nytt första möte och Avsluta – deltagaren kom aldrig. Starta insatsen finns inte längre.
//   2. Erik bokar ett nytt första möte (samma tid som förut och en lördag nekas; ingen varning om sen tid). Starta insatsen kommer
//      tillbaka, från det nya mötets dag. Tidslinjen visar fortfarande att deltagaren inte kom till det första.
//   3. Omar (kommunens handläggare): deltagarens sida i portalen visar ingenting om det.
// Bara påhittade uppgifter.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const ERIK = { userId: "u-erik", role: "coach" };
const OMAR = { userId: "k-omar", role: "kommun_handlaggare" };
const CASE = "case-270043";
const CASE_NO = "BOT-27-0043";
const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";
/** Inget av det här får synas för kommunen. */
const NO_SHOW_TEXT = /kom inte till första mötet|uteblev|giltig frånvaro|deltagaren kom inte/i;

const main = (page: Page) => page.locator("#main");
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

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

test("deltagaren kom inte: coachen registrerar uteblev, bokar ett nytt första möte – och kommunen ser ingenting", async ({ page }, info) => {
  // 1. Erik på deltagarkortet: första mötet har varit – Starta insatsen och Deltagaren kom inte.
  const errors = await open(page, info, `/arenden/${CASE}`, ERIK);
  const m = main(page);
  await expect(m).toContainText("Första mötet har hållits – starta insatsen");
  await btn(m, "Deltagaren kom inte").click();
  const d = page.getByRole("dialog", { name: "Deltagaren kom inte" });
  await expect(d).toContainText("Kommunen får inget besked och ser det inte.");
  await expect(d).toContainText("Det räknas inte som närvaro och faktureras inte.");
  // Inget val gjort: Spara säger vad som saknas.
  await btn(d, "Spara").click();
  await expect(d).toContainText("Välj vad som gäller.");
  // Giltig frånvaro kräver en orsak.
  await d.getByLabel("Giltig frånvaro").check();
  await btn(d, "Spara").click();
  await expect(d).toContainText("Skriv orsaken till den giltiga frånvaron.");
  await d.getByLabel("Uteblev utan att meddela").check();
  await btn(d, "Spara").click();
  await expect(toasts(page)).toContainText("Sparat: deltagaren kom inte till första mötet (uteblev utan att meddela).");
  await expect(d).toHaveCount(0);

  // Rutan på Översikt ersätter "starta insatsen" – med Boka nytt första möte och Avsluta.
  await expect(m).toContainText("Kom inte till första mötet 29 jan kl. 14.00 – uteblev utan att meddela.");
  await expect(m).not.toContainText("Första mötet har hållits – starta insatsen");
  await expect(m.getByRole("button", { name: "Deltagaren kom inte", exact: true })).toHaveCount(0);
  await expect(m.getByRole("link", { name: "Avsluta – deltagaren kom aldrig" })).toHaveAttribute("href", /\/handelse\/case-270043\?lage=avslut$/);
  // Starta insatsen finns inte längre – nästa steg är ett nytt första möte eller Avsluta.
  await expect(m.getByRole("button", { name: "Starta insatsen", exact: true })).toHaveCount(0);

  // 2. Boka nytt första möte (samma bokning som förut).
  await btn(m, "Boka nytt första möte").click();
  const bd = page.getByRole("dialog", { name: "Boka nytt första möte" });
  await expect(bd).toContainText("Kom inte till");
  // Samma regel som servern: en lördag och mötet som deltagaren inte kom till nekas.
  await bd.getByLabel("Datum och tid").fill("2027-02-06T10:00");
  await btn(bd, "Boka det nya mötet").click();
  await expect(bd).toContainText("Dagen är inte en arbetsdag. Välj en vardag.");
  await bd.getByLabel("Datum och tid").fill("2027-01-29T14:00");
  await btn(bd, "Boka det nya mötet").click();
  await expect(bd).toContainText("Tiden har redan passerat. Välj en senare tid.");
  // En tid efter avtalets gräns: ingen varning om sen tid – nyckeltalet räknar det första bokade mötet.
  await bd.getByLabel("Datum och tid").fill("2027-02-15T10:00");
  await expect(bd).not.toContainText("Senare än avtalets gräns");
  await expect(bd).toContainText("Uppföljningen av nyckeltalet räknar det första bokade mötet");
  await bd.getByLabel("Datum och tid").fill("2027-02-03T10:00");
  await btn(bd, "Boka det nya mötet").click();
  await expect(toasts(page)).toContainText("Det nya första mötet är bokat onsdag 3 feb 2027 kl. 10.00.");
  await expect(bd).toHaveCount(0);
  await expect(m).not.toContainText("Kom inte till första mötet 29 jan kl. 14.00 – uteblev");
  await expect(m).toContainText("Nästa steg efter första mötet: starta insatsen");
  await expect(m.getByRole("button", { name: "Starta insatsen", exact: true }).first()).toBeVisible();

  // Tidslinjen: registreringen står kvar.
  await page.getByRole("tab", { name: /^Tidslinje/ }).click();
  await expect(m).toContainText("Kom inte till första mötet 29 jan kl. 14.00");
  await expect(m).toContainText("Uteblev utan att meddela");

  // 3. Omar i portalen: deltagarens sida – ingenting om att deltagaren inte kom.
  await goAs(page, info, `/portal/deltagare/${CASE}`, OMAR);
  await expect(m).toContainText(CASE_NO);
  await expect(m).not.toContainText(NO_SHOW_TEXT);
  expect(relevant(errors)).toEqual([]);
});
