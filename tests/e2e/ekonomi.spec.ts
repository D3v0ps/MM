// Ekonomins skärmar (port av prototyp/tools/test-ekonomi.mjs): startsidan, fakturakörningen, fakturans förhandsvisning och
// ärendets underlag. Samma test körs mot prototypen och appen. Allt läses från skärmen – inte från intern state.
// Varje test börjar från nollställt testdata och gör själv de steg det bygger på.
// Id:n och namn är testdatats (påhittade): case-260117/0121 har spärrad referens, case-260157 en vecka utan närvaro,
// case-260131 överlappar BOT-27-0004, case-260132 har en pausad vecka, case-260143 är "Nadia Warsame".
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open } from "./helpers";

const EKONOM = { userId: "u-lars", role: "ekonom" };
const CHEF = { userId: "u-karin", role: "chef" };
const REFFEL1 = "case-260117";
const REFFEL2 = "case-260121";
const NADIA = "case-260143";

const main = (page: Page) => page.locator("#main");
/** innerText följer text-transform (versala rubriker) – jämför därför utan hänsyn till skiftläge där det behövs. */
const mainText = async (page: Page) => (await main(page).innerText()).replace(/ /g, " ");
const dialog = (page: Page) => page.getByRole("dialog").last();
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
/** Kortet med rubriken (Card är en section med en h2). */
const card = (page: Page, name: string | RegExp) => main(page).locator("section").filter({ has: page.getByRole("heading", { level: 2, name }) });
const invoices = (page: Page) => page.getByRole("table", { name: "Fakturor januari 2027" });
const kpiOverflow = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".eko-kpis > div > *")].filter((el) => el.scrollWidth > el.clientWidth + 1).length);

async function openEko(page: Page, info: Parameters<typeof open>[1], path: string, as = EKONOM, ready = "Fakturering") {
  const errors = await open(page, info, path, as);
  await expect(main(page).getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(main(page)).toContainText(ready);
  await expect(main(page).getByText("Hämtar…")).toHaveCount(0);
  return errors;
}

/** Öppna en faktura i januarikörningen via sökfältet (klicka på raden). */
async function openInvoice(page: Page, number: string) {
  await page.getByRole("tab", { name: /^Alla/ }).click();
  await page.locator("#eko-search").fill(number.slice(-4));
  await invoices(page).getByRole("row").filter({ hasText: number }).first().click();
  await expect(dialog(page).getByRole("heading", { name: `Faktura ${number}` })).toBeVisible();
  await expect(dialog(page)).toContainText("Upparbetat och återstående");
}
const closeDialog = async (page: Page) => {
  await dialog(page).getByRole("button", { name: "Stäng" }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};

/** Steg 2 i den gamla testen: rätta den spärrade referensen för BOT-26-0117 i fakturans detalj. */
async function fixRef1(page: Page) {
  await openInvoice(page, "BOT-26-0117");
  const d = dialog(page);
  await d.getByRole("button", { name: /Använd 55102938 från uppgiften/ }).click();
  await d.getByRole("button", { name: "Spara referensen" }).click();
  await expect(d).toContainText("55102938 · Giltig");
  await closeDialog(page);
  await page.locator("#eko-search").fill("");
}

/**
 * Gå till en annan sida utan att nollställa det testet gjort. Prototypen: hash-adressen (kommandologgen finns kvar i
 * webbläsaren). Appen: riktig adress (testdatat finns kvar på servern) och vänta tills sidan laddat klart.
 */
async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) {
    await page.goto(page.url().replace(/#.*$/, `#${to}`));
    return;
  }
  await page.goto(to);
  await loaded(page);
}

const count = async (tab: Locator) => Number((await tab.innerText()).replace(/\D/g, "") || "0");

test("1. startsidan som ekonom", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi", EKONOM, "511 332 kr");
  const t = await mainText(page);
  expect(t).toMatch(/511 332 kr/);
  expect(t.toLowerCase()).toContain("ofakturerade veckor äldre än 45 dagar");
  expect(t).toContain("Risk för preskription");
  expect(t.toLowerCase()).toContain("returnerade fakturor");
  expect(t).toContain("BOT-26-0117");
  expect(t.toLowerCase()).toContain("uppgifter till dig");
  expect(t).toContain("55102938");
  expect(t).toContain("Byggs i fas 2");
  expect(t.toLowerCase()).toContain("fortnox-synk");
  expect(t).not.toMatch(/authorization code flow/i);
  expect(t).toContain("Fortnox godkänner kopplingen");
  // KPI-rutor med röd ram har statustext (inte bara färg)
  expect(t).toContain("Rätta referensen");
  expect(t).toContain("Fakturera nu");
  expect(t).toContain("5 veckor faktureras om på en ny faktura");
  expect(t).not.toMatch(/\b1 (veckor|fakturor|öppna|stoppade|returnerade|godkända)\b/);
  expect(await kpiOverflow(page)).toBe(0);
  await page.setViewportSize({ width: 400, height: 900 });
  await page.waitForTimeout(120);
  expect(await kpiOverflow(page)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
  expect(errors).toEqual([]);
});

test("2. körningen januari: regler och rätta stoppad faktura i radens detalj", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, "Regler för körningen");
  const t = await mainText(page);
  expect(t).toMatch(/torsdag/);
  expect(t).toMatch(/v\. 53 2026/i);
  expect(t).toMatch(/december 2026/);
  expect(t).toContain("Samlingsfakturor är inte tillåtna");
  expect(t).toContain("(8–10 siffror)");
  // Prototypens förklaring (DemoNote) att priserna är exempel – visas inte i appen.
  if (isDemo(info)) expect(t).toContain("prislistans spann (1 323–1 668 kr per vecka)");
  else expect(t).not.toContain("prislistans spann");
  expect(await kpiOverflow(page)).toBe(0);

  await page.getByRole("tab", { name: /Stoppade/ }).click();
  await expect(invoices(page).locator("tbody tr")).toHaveCount(2);
  await invoices(page).getByRole("row").filter({ hasText: "BOT-26-0117" }).click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  const refInput = d.locator(`#eko-ref-detail-${REFFEL1}`);
  await refInput.fill("55102983");
  await d.getByRole("button", { name: "Spara referensen" }).click();
  await expect(d).toContainText("spärrad");
  await expect(d).toContainText("55102983 · Spärrad"); // oförändrat efter fel
  await refInput.fill("12 34");
  await d.getByRole("button", { name: "Spara referensen" }).click();
  await expect(d).toContainText("bara innehålla siffror");
  await d.getByRole("button", { name: /Använd 55102938 från uppgiften/ }).click();
  await expect(refInput).toHaveValue("55102938");
  await d.getByRole("button", { name: "Spara referensen" }).click();
  await expect(toasts(page)).toContainText("Beställarreferensen för BOT-26-0117 är nu 55102938. Fakturan är inte längre stoppad.");
  await expect(d).toContainText("55102938 · Giltig");
  await expect(d.getByText("Underlag", { exact: true })).toBeVisible(); // inte längre stoppad
  await closeDialog(page);
  await expect(page.getByRole("tab", { name: /Stoppade/ })).toContainText("1");
  expect(errors).toEqual([]);
});

test("3. godkänn vecka utan närvaro med kommentar", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, "Fakturor januari 2027");
  await openInvoice(page, "BOT-26-0157");
  const d = dialog(page);
  await d.getByRole("button", { name: "Godkänn veckan för fakturering" }).click();
  await expect(d).toContainText("Skriv en kort kommentar");
  await d.locator("textarea").first().fill("Kontrollerat med samordnaren – inskriven hela veckan enligt beställningen.");
  await d.getByRole("button", { name: "Godkänn veckan för fakturering" }).click();
  await expect(toasts(page)).toContainText("v. 3 2027 för BOT-26-0157 är godkänd för fakturering.");
  await expect(d).toContainText("Godkänd av Lars Nyström");
  await expect(d).toContainText("”Kontrollerat med samordnaren – inskriven hela veckan enligt beställningen.”");
  await d.getByRole("button", { name: "Godkänn fakturan" }).click();
  await expect(toasts(page)).toContainText("Fakturan för BOT-26-0157 är godkänd och klar för Fortnox.");
  await expect(d.getByRole("button", { name: "Godkänn fakturan" })).toHaveCount(0);
  await expect(d.getByText("Godkänd", { exact: true }).first()).toBeVisible();
  await closeDialog(page);
  expect(errors).toEqual([]);
});

test("4. överlapp: fråga samordnaren och godkänn med bekräftelse", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, "Fakturor januari 2027");
  await openInvoice(page, "BOT-26-0131");
  const d = dialog(page);
  await expect(d).toContainText("BOT-27-0004");
  await d.getByRole("button", { name: "Fråga samordnaren" }).click();
  await expect(toasts(page)).toContainText("Frågan är skickad till samordnaren. Den innehåller bara ärendenummer.");
  await expect(d).toContainText("Fråga skickad till samordnaren");
  const approve = d.getByRole("button", { name: "Godkänn fakturan" });
  await expect(approve).toBeDisabled();
  await d.locator("#eko-rem-case-260131").check();
  await approve.click();
  await expect(toasts(page)).toContainText("Fakturan för BOT-26-0131 är godkänd och klar för Fortnox.");
  await closeDialog(page);
  await page.getByRole("tab", { name: /^Klara/ }).click();
  await expect(invoices(page).getByRole("row").filter({ hasText: "BOT-26-0131" })).toContainText("Godkänd");
  expect(errors).toEqual([]);
});

test("5. masshandlingar: godkänn alla, skapa i Fortnox, idempotens och statussynk", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, "Fakturor januari 2027");
  await fixRef1(page);
  const stoppade = page.getByRole("tab", { name: /Stoppade/ });
  expect(await count(stoppade)).toBe(1); // BOT-26-0121 är fortfarande stoppad

  await page.getByRole("button", { name: /Godkänn alla utan anmärkning/ }).click();
  await dialog(page).getByRole("button", { name: /^Godkänn \d+ fakturor$/ }).click();
  await expect(toasts(page)).toContainText(/\d+ fakturor är godkända\./);
  const klara = await count(page.getByRole("tab", { name: /^Klara/ }));
  expect(klara).toBeGreaterThanOrEqual(110);
  expect(await count(stoppade)).toBe(1); // stoppade godkändes inte

  await page.getByRole("button", { name: new RegExp(`Skapa i Fortnox \\(${klara}\\)`) }).click();
  await dialog(page).getByRole("button", { name: `Skapa ${klara} fakturor` }).click();
  await expect(toasts(page)).toContainText(`${klara} fakturor skapades i Fortnox som ej bokförda utkast (simulerat). Inga dubbletter.`);
  await page.getByRole("tab", { name: /Stoppade/ }).click();
  await expect(invoices(page).getByRole("row").filter({ hasText: "BOT-26-0121" })).toContainText("Stoppad"); // skapades aldrig
  await page.getByRole("tab", { name: /^Klara/ }).click();
  await expect(invoices(page).locator("tbody tr").first()).toContainText("Skapad i Fortnox (ej bokförd)");

  // Omkörning: inga dubbletter
  await page.getByRole("button", { name: "Skapa i Fortnox (0)" }).click();
  await dialog(page).getByRole("button", { name: "Kör ändå" }).click();
  await expect(toasts(page)).toContainText(`Inga nya fakturor. ${klara} fakturor fanns redan – inga dubbletter skapades.`);
  const runs = card(page, "Fortnox-körningar");
  await expect(runs).toContainText("0 skapade");
  await expect(runs).toContainText(`${klara} dubbletter hoppades över`);
  await expect(runs).toContainText(`${klara} skapade`);
  expect(await count(page.getByRole("tab", { name: /^Klara/ }))).toBe(klara);

  // Statussynk: skapad → bokförd → skickad → betald
  await page.getByRole("button", { name: "Hämta status från Fortnox" }).click();
  await expect(toasts(page)).toContainText(`${klara} fakturor gick vidare ett steg.`);
  await expect(invoices(page).locator("tbody tr").first()).toContainText("Bokförd");
  await page.getByRole("button", { name: "Hämta status från Fortnox" }).click();
  await expect(invoices(page).locator("tbody tr").first()).toContainText("Skickad (Peppol)");
  await page.getByRole("button", { name: "Hämta status från Fortnox" }).click();
  await expect(invoices(page).locator("tbody tr").first()).toContainText("Betald");
  const t = await mainText(page);
  expect(t.toLowerCase()).toContain("fortnox-körningar");
  expect(t).toMatch(/dubbletter hoppades över/);

  // Tillståndet spelas upp igen efter omladdning (prototypen: kommandologgen i webbläsaren)
  await page.reload();
  await expect(main(page)).toContainText(`${klara} dubbletter hoppades över`);
  expect(await count(page.getByRole("tab", { name: /Stoppade/ }))).toBe(1);
  expect(errors).toEqual([]);
});

test("6 och 8. reservväg: CSV-export och manuellt fakturerad, ekonomens ärendevy", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, "Fakturor januari 2027");
  // Prototypen visar filens innehåll i en textruta; appen laddar ner filen.
  let csv = "";
  if (isDemo(info)) {
    await page.getByRole("button", { name: "Exportera underlag (CSV)" }).click();
    const area = page.locator("#text-dialog-area");
    await expect(area).toBeVisible();
    csv = await area.inputValue();
    await closeDialog(page);
  } else {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportera underlag (CSV)" }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.csv$/);
    expect(dl.suggestedFilename()).not.toMatch(/Nadia|Warsame/);
    const fs = await import("node:fs");
    csv = fs.readFileSync((await dl.path())!, "utf8").replace(/^\uFEFF/, "");
  }
  expect(csv.startsWith("Ärendenummer (faktureringsobjekt);")).toBe(true);
  expect(csv).toContain("BOT-26-0143");
  expect(csv).not.toContain("Nadia");
  expect(csv).not.toContain("Warsame");

  await page.getByRole("button", { name: "Markera som manuellt fakturerad" }).click();
  const d = dialog(page);
  await d.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(d).toContainText("Välj vilket ärende");
  await d.locator("#eko-manual-case").selectOption(NADIA);
  await d.locator("#eko-manual-no").fill("12a");
  await d.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(d).toContainText("3–10 siffror");
  await d.locator("#eko-manual-no").fill("20417");
  await d.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(toasts(page)).toContainText("BOT-26-0143 är markerad som manuellt fakturerad med fakturanummer 20417. Den skapas inte i Fortnox igen.");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 8. Ekonomens ärendevy
  await go(page, info, `/ekonomi/arende/${NADIA}`);
  await expect(main(page)).toContainText("Debiterbara veckor per månad");
  const t = await mainText(page);
  expect(t).not.toContain("Nadia");
  expect(t).not.toContain("Warsame");
  for (const x of ["beställning", "upparbetat", "återstående", "debiterbara veckor per månad"]) expect(t.toLowerCase()).toContain(x);
  const jan = page.getByRole("table", { name: "Debiterbara veckor per månad" }).getByRole("row").filter({ hasText: "Januari 2027" });
  await expect(jan).toContainText("Manuellt fakturerad");
  await expect(jan).toContainText("20417");

  await go(page, info, "/ekonomi/arende");
  await expect(main(page)).toContainText("Sök ärendenummer");
  await page.locator("#eko-case-search").fill("0143");
  await expect(page.getByRole("table", { name: "Ärenden" }).locator("tbody tr")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("7. fakturans förhandsvisning (Peppol)", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01/faktura/case-260132", EKONOM, "Fältmappning");
  const t = await mainText(page);
  for (const s of ["BuyerReference", "OrderReference", "Er referens", "Ert ordernummer"]) expect(t).toContain(s);
  expect(t).toContain("BOT-26-0132 · v. 1, 3–4 2027");
  expect(t).toContain("Att betala");
  expect(t).toContain("Moms 25 %");
  expect(t).toContain("Betalningsvillkor 30 dagar");
  expect(t).toContain("Beställning BOT-26-0132: 10 veckor");
  expect(t).toContain("Tidigare fakturerat:");
  expect(t).toContain("Upparbetat inklusive denna faktura:");
  expect(t).toContain("Återstår av beställningen:");
  expect(t).not.toMatch(/\b1 veckor\b/);
  expect(t).toContain("9 siffror som börjar med 99");
  expect(t).toContain("8–10 siffror");
  expect(t).not.toContain("Nikola");
  expect(t).not.toContain("Ahmadi");
  expect(t).not.toContain("Sjukhusvistelse"); // pausorsaken (hälsouppgift) visas inte
  expect(errors).toEqual([]);
});

test("7b. returnerad decemberfaktura: veckorna räknas och benämns lika i faktura och ärendevy", async ({ page }, info) => {
  const errors = await openEko(page, info, `/ekonomi/2027-01/faktura/${REFFEL2}`, EKONOM, "Fältmappning");
  let t = await mainText(page);
  const ftext = (t.match(/Beställning BOT-26-0121:[^\n]*/) ?? [""])[0];
  expect(ftext).toContain("Tidigare fakturerat: 0 veckor, 0 kr.");
  expect(ftext).toContain("Returnerad faktura för december 2026");
  expect(ftext).toContain("5 veckor");
  expect(ftext).toContain("faktureras om på en ny faktura");
  expect(ftext).toContain("Upparbetat inklusive denna faktura: 9 veckor"); // 5 i december + 4 i januari
  expect(ftext).not.toContain("Fakturerat inklusive");
  expect(t).toContain("Faktureras om");
  expect(t.toLowerCase()).toContain("upparbetat och återstående");

  await go(page, info, `/ekonomi/arende/${REFFEL2}`);
  await expect(main(page)).toContainText("Debiterbara veckor per månad");
  t = await mainText(page);
  expect(t).toMatch(/Fakturerat\s*0\s*kr/i);
  expect(t).toMatch(/Ej fakturerat/i);
  expect(t).toContain("varav 5 veckor på returnerad faktura");
  expect(t).toContain("faktureras om på en ny faktura");
  expect(errors).toEqual([]);
});

test("9. startsidan: uppgift, rätta i båda ärendena, kreditera returnerade", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, "Fakturor januari 2027");
  await fixRef1(page);
  await go(page, info, "/ekonomi");
  await expect(main(page)).toContainText("Uppgifter till dig");
  const tasks = card(page, "Uppgifter till dig");
  await tasks.getByRole("button", { name: "Rätta referensen" }).click();
  const d = dialog(page);
  await d.getByRole("button", { name: /Använd 55102938/ }).click();
  const lead = await d.locator("p").first().innerText();
  expect(lead).toContain("BOT-26-0121");
  expect(lead).not.toContain("BOT-26-0117");
  await d.getByRole("button", { name: /^Spara/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tasks).not.toContainText("Spärrad");

  const returned = card(page, "Returnerade fakturor");
  const unbilled = card(page, /Ofakturerade veckor äldre än 45 dagar/);
  await expect(unbilled).toContainText("BOT-26-0121");
  await returned.getByRole("button", { name: "Kreditera och skapa ny" }).first().click();
  await expect(toasts(page)).toContainText("är krediterad och en ny är skapad (simulerat).");
  await expect(returned.getByRole("button", { name: "Kreditera och skapa ny" })).toHaveCount(1);
  await returned.getByRole("button", { name: "Kreditera och skapa ny" }).click();
  await expect(returned.getByRole("button", { name: "Kreditera och skapa ny" })).toHaveCount(0);
  await expect(returned).toContainText("räknas nu som fakturerade");
  await expect(unbilled).toContainText("Inga gamla ofakturerade veckor"); // preskriptionsvarningen försvann
  await tasks.getByRole("button", { name: "Markera som klar" }).click();
  await expect(toasts(page)).toContainText("Uppgiften är markerad som klar.");
  await expect(tasks).toContainText("Klar 1 feb");

  // 9b. Efter omfakturering räknas decemberveckorna som fakturerade
  await go(page, info, `/ekonomi/2027-01/faktura/${REFFEL2}`);
  await expect(main(page)).toContainText("Fältmappning");
  const ftext = ((await mainText(page)).match(/Beställning BOT-26-0121:[^\n]*/) ?? [""])[0];
  expect(ftext).toContain("Tidigare fakturerat: 5 veckor");
  expect(ftext).not.toContain("Returnerad faktura");

  // 11. Tillståndet spelas upp igen efter omladdning
  await go(page, info, "/ekonomi");
  await page.reload();
  await expect(card(page, "Uppgifter till dig")).toContainText("Klar 1 feb");
  await expect(card(page, "Returnerade fakturor")).toContainText("räknas nu som fakturerade");
  expect(errors).toEqual([]);
});

test("10. chef ser läsläge", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", CHEF, "Fakturor januari 2027");
  await expect(page.getByRole("button", { name: /Godkänn alla utan anmärkning/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Skapa i Fortnox/ })).toHaveCount(0);
  await expect(main(page)).toContainText("Läsläge");
  expect(errors).toEqual([]);
});
