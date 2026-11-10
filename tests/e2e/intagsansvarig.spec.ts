// Intagsansvarig tar emot nya beställningar (Karims beslut 2026-11-09, SPEC §4 och §7.4, migration 0041) – samma test mot
// prototypen och appen. Demoklockan: måndag 1 februari 2027 kl. 09.12. Amira Haddad är intagsansvarig i Botkyrkaavtalet (testdatat).
//   1. Maria (kommunens handläggare) beställer en insats i portalen: BOT-27-0051.
//   2. Amira får notisen "Ny beställning att ta emot – BOT-27-0051" i appen och ser beställningen som en rad på Min vecka.
//   3. Amira trycker Ta emot: samma dialog som samordnarens Acceptera, hon själv är förvald som huvudcoach. Hon bokar första
//      mötet och tar emot. Beställningen är bekräftad och försvinner från hennes lista.
//   4. Sara (samordnare) får notisen "Ny deltagare mottagen – BOT-27-0051" med vem som tog emot, första mötet och huvudcoachen,
//      och öppnar deltagarkortet: bekräftat, huvudcoach Amira.
//   5. Erik (en annan coach) ser ingen rad på Min vecka, ingen notis och ingen knapp Ta emot på en beställning som väntar.
//      Amira har knappen på samma kort – men beställningen (BOT-27-0049) har en komplettering från kommunen som väntar i
//      avropsinkorgen, så dialogen säger det och har ingen knapp Ta emot. Hon tar emot ett annat avrop (BOT-27-0050) från
//      deltagarkortet.
//   6. Maria ser orderbekräftelsen i portalen – och ingenting om vem som är intagsansvarig.
// Det andra testet: systemadministratören byter intagsansvarig på avtalssidan (till exempel vid semester) och väljer sedan ingen –
// den nya personen får raderna direkt, och utan intagsansvarig tar bara samordnaren emot.
// Bara påhittade uppgifter.
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const MARIA: Who = { userId: "k-maria", role: "kommun_handlaggare" };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const ERIK: Who = { userId: "u-erik", role: "coach" };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const ROBIN: Who = { userId: "u-robin", role: "admin" };
const NEW_NO = "BOT-27-0051";
/** En beställning ur testdatat som väntar på svar (Ahmeds avrop). */
const WAITING = "case-270049";
const WAITING_NO = "BOT-27-0049";
/** Marias mejlavrop em-101 ur testdatat – tas emot från deltagarkortet. */
const MAIL_ORDER = "case-270050";
const MAIL_ORDER_NO = "BOT-27-0050";

const main = (page: Page) => page.locator("#main");
const dialog = (page: Page, name?: string | RegExp) => page.getByRole("dialog", name ? { name } : undefined);
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const notices = (page: Page) => main(page).locator("[data-notif-list] > *");
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

/** Byt testperson utan att nollställa det man gjort (prototypen spelar upp kommandologgen igen). */
async function switchTo(page: Page, info: TestInfo, to: string, who: Who) {
  if (isDemo(info)) {
    await page.route("http://proto.test/blank.html", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Byter testperson</title>" }));
    await page.goto("http://proto.test/blank.html");
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), who);
    await page.goto(`http://proto.test/index.html#${to}`);
  } else {
    await switchPersona(page, who);
    await page.goto(to);
    await loaded(page);
  }
  await expect(main(page)).toBeVisible();
  await expect(main(page)).not.toContainText("Hämtar…", { timeout: 15_000 });
}

test("en ny beställning går till avtalets intagsansvarige: notis, rad på Min vecka och Ta emot – samordnaren får en notis, en annan coach ser ingenting", async ({ page }, info) => {
  test.setTimeout(150_000);
  const m = main(page);

  // 1. Kommunens handläggare beställer i portalen (tre steg och en granskning).
  const errors = await open(page, info, "/portal/bestall", MARIA);
  await expect(m).not.toContainText("Hämtar…", { timeout: 15_000 });
  await page.getByRole("group", { name: "Omfattning" }).getByRole("button", { name: "6 månader", exact: true }).click();
  await page.fill("#kom-o-start", "2027-02-15");
  await btn(page, /^Nästa/).click();
  await expect(m.getByRole("heading", { level: 2, name: "Deltagare", exact: true })).toHaveCount(1);
  await page.fill("#kom-o-fn", "Samira");
  await page.fill("#kom-o-ln", "Testsson");
  await page.fill("#kom-o-pnr", "19880412-3456");
  await page.fill("#kom-o-dphone", "070-000 11 22");
  await page.selectOption("#kom-o-area", "G");
  await btn(page, /^Nästa/).click();
  await expect(m.getByRole("heading", { level: 2, name: "Bakgrundsinformation om deltagaren" })).toHaveCount(1);
  await page.getByRole("group", { name: "Har en kartläggning genomförts?" }).getByRole("button", { name: "Nej" }).click();
  await page.fill("#kom-o-bg", "Har arbetat på lager i två år. Vill ta truckkort.");
  await btn(page, /^Nästa/).click();
  await expect(m.getByRole("heading", { level: 2, name: "Granska och skicka" })).toHaveCount(1);
  await btn(page, "Skicka beställningen").click();
  await expect(m).toContainText("Tack! Beställningen är skickad", { timeout: 15_000 });
  await expect(m).toContainText(NEW_NO);
  // Kommunen får inget veta om vem som tar emot.
  await expect(m).not.toContainText(/intagsansvarig|Amira/i);

  // 2. Den intagsansvarige: notisen i appen – bara ärendenumret och svarstiden, aldrig deltagarens namn – och ingen e-posttext.
  await switchTo(page, info, "/notiser", AMIRA);
  const notice = notices(page).filter({ hasText: `Ny beställning att ta emot – ${NEW_NO}` });
  await expect(notice).toHaveCount(1);
  // Svarstiden: en arbetsdag efter beställningen (demoklockan går – minuten kan ha hunnit slå om).
  await expect(notice).toContainText(/Boka första mötet och tryck på Ta emot\. Kommunen ska ha svar senast 2 feb kl\. 09\.1\d\./);
  await expect(notice.getByRole("link", { name: "Öppna beställningen" })).toHaveCount(1);
  await expect(notice.getByRole("button", { name: "Visa e-postens text" })).toHaveCount(0);
  expect(await notice.innerText()).not.toMatch(/Samira|Testsson|19880412/);
  // Bara den nya beställningen har en notis – de tre som redan väntade i testdatat står på Min vecka.
  await expect(notices(page).filter({ hasText: "Ny beställning att ta emot" })).toHaveCount(1);

  // Min vecka: en rad per beställning som väntar på svar, med knappen Ta emot.
  await switchTo(page, info, "/min-vecka", AMIRA);
  for (const no of ["BOT-27-0048", WAITING_NO, "BOT-27-0050", NEW_NO]) await expect(m, no).toContainText(`Ny beställning att ta emot – ${no}`);
  await expect(m).toContainText("Boka första mötet och tryck på Ta emot. Kommunen får orderbekräftelsen och samordnarna en notis.");
  // Inga belopp på raderna.
  expect(await m.innerText()).not.toMatch(/\d\s?kr\b|kronor/i);

  // 3. Ta emot: samma dialog som Acceptera – hon själv är förvald som huvudcoach.
  await btn(m, `Ta emot ${NEW_NO}`).click();
  const d = dialog(page, `Ta emot ${NEW_NO}`);
  await expect(d).toBeVisible();
  await expect(d.locator("#ink-coach-u-amira")).toBeChecked();
  await expect(d).toContainText("Du är förvald – välj en annan coach om någon annan ska ha deltagaren.");
  await expect(d).toContainText("Samordnarna får en notis i appen om att deltagaren är mottagen.");
  await expect(d).not.toContainText(/Acceptera/);
  // Första mötet krävs.
  await d.locator("#ink-fm-date").fill("2027-02-08");
  await d.locator("#ink-fm-time").fill("10:00");
  await btn(d, "Ta emot").click();
  const done = dialog(page, "Deltagaren är mottagen");
  await expect(done).toBeVisible();
  await expect(done).toContainText(`${NEW_NO} är mottagen`);
  await expect(done).toContainText("kl. 10.00");
  await expect(done).toContainText("Orderbekräftelsen är publicerad i portalen. Kommunen har fått ett mejl utan personuppgifter.");
  await expect(done).toContainText("Samordnarna har fått en notis i appen om att deltagaren är mottagen.");
  // Kvittensen står kvar tills hon stänger den – också när listan bakom har räknats om och beställningen inte längre väntar.
  await expect(m).not.toContainText(`Ny beställning att ta emot – ${NEW_NO}`);
  await expect(done).toBeVisible();
  await expect(page.getByText("Beställningen kan inte tas emot här")).toHaveCount(0);
  await btn(done, "Klart").click();
  await expect(done).toHaveCount(0);
  // Beställningen är besvarad: raden är borta, de andra står kvar.
  await expect(m).not.toContainText(`Ny beställning att ta emot – ${NEW_NO}`);
  await expect(m).toContainText(`Ny beställning att ta emot – ${WAITING_NO}`);
  // Notisen om beställningen är inte längre oläst (den är besvarad).
  await switchTo(page, info, "/notiser", AMIRA);
  const settled = notices(page).filter({ hasText: `Ny beställning att ta emot – ${NEW_NO}` });
  await expect(settled).toHaveCount(1);
  await expect(settled.getByRole("button", { name: "Läst" })).toHaveCount(0);
  // Den som tog emot får ingen notis om sin egen mottagning.
  await expect(notices(page).filter({ hasText: "Ny deltagare mottagen" })).toHaveCount(0);

  // 4. Samordnaren: notisen i appen med vem som tog emot, första mötet och huvudcoachen – och deltagarkortet är bekräftat.
  await switchTo(page, info, "/notiser", SARA);
  const received = notices(page).filter({ hasText: `Ny deltagare mottagen – ${NEW_NO}` });
  await expect(received).toHaveCount(1);
  await expect(received).toContainText("Mottagen av Amira Haddad. Första mötet måndag 8 feb 2027 kl. 10.00. Huvudcoach: Amira Haddad.");
  await expect(received.getByRole("button", { name: "Visa e-postens text" })).toHaveCount(0);
  expect(await received.innerText()).not.toMatch(/Samira|Testsson|19880412/);
  await received.getByRole("link", { name: "Öppna ärendet" }).click();
  await expect(m).not.toContainText("Hämtar…", { timeout: 15_000 });
  await expect(m).toContainText(NEW_NO);
  await expect(m.getByText("Bekräftad", { exact: true }).first()).toBeVisible();
  await expect(m).toContainText("Amira Haddad");
  await expect(m.getByRole("button", { name: "Ta emot", exact: true })).toHaveCount(0);
  // Beställningen är inte kvar bland avropen att acceptera.
  await switchTo(page, info, "/min-vecka", SARA);
  await expect(m).not.toContainText(`Acceptera ${NEW_NO}`);
  await expect(m).toContainText(`Acceptera ${WAITING_NO}`);

  // 5. En annan coach: ingen rad på Min vecka, ingen notis och ingen knapp på en beställning som väntar.
  await switchTo(page, info, "/min-vecka", ERIK);
  await expect(m).not.toContainText("Ny beställning att ta emot");
  await expect(m.getByRole("button", { name: /^Ta emot/ })).toHaveCount(0);
  await switchTo(page, info, "/notiser", ERIK);
  await expect(notices(page).filter({ hasText: /Ny beställning att ta emot|Ny deltagare mottagen/ })).toHaveCount(0);
  await switchTo(page, info, `/arenden/${WAITING}`, ERIK);
  await expect(m).toContainText(WAITING_NO);
  await expect(m).not.toContainText("Ny beställning att ta emot");
  await expect(m.getByRole("button", { name: "Ta emot", exact: true })).toHaveCount(0);
  // Den intagsansvarige har knappen på samma kort, och länken ?taemot=1 öppnar dialogen.
  await switchTo(page, info, `/arenden/${WAITING}?taemot=1`, AMIRA);
  const waiting = dialog(page, `Ta emot ${WAITING_NO}`);
  await expect(waiting).toBeVisible();
  // Kommunen har skickat en komplettering till den här beställningen som samordnaren inte har fört in än (em-103 i testdatat):
  // den intagsansvarige får veta att den väntar – ingenting ur mejlet – och kan inte ta emot förrän den är införd.
  await expect(waiting).toContainText("En komplettering väntar i inkorgen");
  await expect(waiting).toContainText("Kommunen har skickat en komplettering som väntar i inkorgen. Be samordnaren föra in den innan du tar emot.");
  await expect(waiting.getByRole("button", { name: "Ta emot", exact: true })).toHaveCount(0);
  await expect(waiting).not.toContainText("55102938");
  await btn(waiting, "Stäng").click();
  await expect(waiting).toHaveCount(0);
  await expect(m).toContainText("Ny beställning att ta emot");
  await expect(m.getByRole("button", { name: "Ta emot", exact: true }).first()).toBeVisible();
  // Ta emot från deltagarkortet (Marias mejlavrop BOT-27-0050): kvittensen står kvar, och kortet bakom är bekräftat utan knappen.
  await switchTo(page, info, `/arenden/${MAIL_ORDER}`, AMIRA);
  await btn(m, "Ta emot").click();
  const d2 = dialog(page, `Ta emot ${MAIL_ORDER_NO}`);
  await expect(d2.locator("#ink-coach-u-amira")).toBeChecked();
  await d2.locator("#ink-fm-date").fill("2027-02-09");
  await d2.locator("#ink-fm-time").fill("13:00");
  await btn(d2, "Ta emot").click();
  const done2 = dialog(page, "Deltagaren är mottagen");
  await expect(done2).toContainText(`${MAIL_ORDER_NO} är mottagen`);
  await expect(m.getByText("Bekräftad", { exact: true }).first()).toBeVisible();
  await expect(done2).toBeVisible();
  await btn(done2, "Klart").click();
  await expect(done2).toHaveCount(0);
  await expect(m).not.toContainText("Ny beställning att ta emot");
  await expect(m.getByRole("button", { name: "Ta emot", exact: true })).toHaveCount(0);

  // 6. Kommunens handläggare ser orderbekräftelsen – ingenting om vem som är intagsansvarig.
  await switchTo(page, info, "/portal/deltagare", MARIA);
  await expect(m).toContainText(NEW_NO);
  await m.getByRole("link", { name: new RegExp(NEW_NO) }).first().click();
  await expect(m).not.toContainText("Hämtar…", { timeout: 15_000 });
  await expect(m).toContainText("Första mötetmåndag 8 februari 2027 klockan 10.00");
  await expect(m).not.toContainText(/intagsansvarig/i);
  expect(relevant(errors)).toEqual([]);
});


test("systemadministratören byter intagsansvarig på avtalssidan: den nya personen får beställningarna, den förra inte – och utan intagsansvarig tar samordnaren emot", async ({ page }, info) => {
  test.setTimeout(120_000);
  const m = main(page);
  const errors = await open(page, info, "/admin/avtal", ROBIN);
  await expect(m).not.toContainText("Hämtar…", { timeout: 15_000 });
  // Avtalsfakta: testdatats intagsansvarige.
  await expect(m).toContainText("Avtalsfakta");
  expect(await m.innerText()).toMatch(/Intagsansvarig – tar emot nya deltagare\s*Amira Haddad/);
  await btn(m, "Ändra intagsansvarig").click();
  await expect(m).toContainText("Personen får en notis när en ny beställning kommer in och bokar första mötet. Byt person vid semester.");
  // Listan: Ingen och avtalets coacher – aldrig samordnaren, ekonomen eller kommunens handläggare.
  const options = await page.locator("#avtal-intake option").allInnerTexts();
  expect(options[0]).toBe("Ingen (samordnaren tar emot)");
  expect(options).toContain("Amira Haddad");
  expect(options).toContain("Erik Sjöberg");
  expect(options.join("|")).not.toMatch(/Sara|Maria Ekdahl|Lars/);
  await page.selectOption("#avtal-intake", "u-erik");
  await btn(m, "Spara").click();
  await expect(toasts(page)).toContainText("Erik Sjöberg är nu intagsansvarig.");
  await expect(m.locator("#avtal-intake")).toHaveCount(0);

  // Den nya personen har beställningarna på Min vecka direkt – den förra har dem inte längre.
  await switchTo(page, info, "/min-vecka", ERIK);
  await expect(m).toContainText(`Ny beställning att ta emot – ${WAITING_NO}`);
  await expect(m.getByRole("button", { name: `Ta emot ${WAITING_NO}`, exact: true }).first()).toBeVisible();
  await switchTo(page, info, "/min-vecka", AMIRA);
  await expect(m).not.toContainText("Ny beställning att ta emot");
  await switchTo(page, info, `/arenden/${WAITING}?taemot=1`, AMIRA);
  await expect(m).toContainText(WAITING_NO);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(m.getByRole("button", { name: "Ta emot", exact: true })).toHaveCount(0);

  // Ingen intagsansvarig: som förut – ingen coach har raderna, samordnaren accepterar.
  await switchTo(page, info, "/admin/avtal", ROBIN);
  await btn(m, "Ändra intagsansvarig").click();
  await expect(m.locator("#avtal-intake")).toHaveValue("u-erik");
  await page.selectOption("#avtal-intake", { label: "Ingen (samordnaren tar emot)" });
  await btn(m, "Spara").click();
  await expect(toasts(page)).toContainText("Avtalet har ingen intagsansvarig. Samordnaren tar emot nya beställningar.");
  await expect(m).toContainText("Ingen (samordnaren tar emot)");
  await switchTo(page, info, "/min-vecka", ERIK);
  await expect(m).not.toContainText("Ny beställning att ta emot");
  await switchTo(page, info, "/min-vecka", SARA);
  await expect(m).toContainText(`Acceptera ${WAITING_NO}`);
  expect(relevant(errors)).toEqual([]);
});
