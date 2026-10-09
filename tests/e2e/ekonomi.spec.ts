// Ekonomins skärmar: startsidan, fakturakörningen, fakturans förhandsvisning, ärendets underlag och prislistan. Samma test
// körs mot prototypen och appen. Allt läses från skärmen – inte från intern state. Varje test börjar från nollställt testdata
// och gör själv de steg det bygger på.
// Beslut 2026-10-07 (synpunkt #13 och beslut 3): en faktura per avtal och månad med en rad per ärende. Ekonomen fyller i
// beställarreferensen – en per faktura – och kontrollen före fakturan finns kvar. Beslut 5: belopp och Ekonomi bara för ekonomen.
// Id:n och namn är testdatats (påhittade): januarifakturan saknar referens, december har en returnerad tilläggsfaktura för
// case-260117/0121 (spärrad referens 55102983), case-260157/0159 och 270031 har en vecka utan närvaro, case-260131 överlappar
// BOT-27-0004, case-260132 har en pausad vecka, case-260143 är "Nadia Warsame".
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open } from "./helpers";

const EKONOM = { userId: "u-lars", role: "ekonom" };
const CHEF = { userId: "u-karin", role: "chef" };
const ADMIN = { userId: "u-robin", role: "admin" };
const REFFEL2 = "case-260121";
const NADIA = "case-260143";
const JAN = "Faktura januari 2027";

const main = (page: Page) => page.locator("#main");
/** innerText följer text-transform (versala rubriker) – jämför därför utan hänsyn till skiftläge där det behövs. */
const mainText = async (page: Page) => (await main(page).innerText()).replace(/\u00a0/g, " ");
const dialog = (page: Page) => page.getByRole("dialog").last();
const toasts = (page: Page) => page.locator("div[role=status][data-print=hide]");
/** Kortet med rubriken (Card är en section med en h2). */
const card = (page: Page, name: string | RegExp) => main(page).locator("section").filter({ has: page.getByRole("heading", { level: 2, name }) });
/** Januarifakturans kort (det innersta kortet med rubriken – avsnittet Fakturor runt korten har samma rubrik inuti). */
const janCard = (page: Page) => card(page, JAN).last();
/** Raderna på januarifakturan (en rad per ärende). */
const lines = (page: Page) => page.getByRole("table", { name: `Rader – ${JAN}` });
const kpiOverflow = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".eko-kpis > div > *")].filter((el) => el.scrollWidth > el.clientWidth + 1).length);
/** Belopp i kronor (kr() skriver "13 980 kr" med hårt mellanslag). */
const AMOUNT = /\d[  ]kr(?![a-zåäö])/i;

async function openEko(page: Page, info: Parameters<typeof open>[1], path: string, as = EKONOM, ready = "Fakturering") {
  const errors = await open(page, info, path, as);
  await expect(main(page).getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(main(page)).toContainText(ready);
  await expect(main(page).getByText("Hämtar…")).toHaveCount(0);
  return errors;
}

/** Öppna en rad (ett ärende) på januarifakturan via sökfältet. */
async function openLine(page: Page, number: string) {
  await janCard(page).getByRole("tab", { name: /^Alla/ }).click();
  await page.locator("#eko-search-avtal").fill(number.slice(-4));
  await lines(page).getByRole("row").filter({ hasText: number }).first().click();
  await expect(dialog(page).getByRole("heading", { name: `Rad ${number}` })).toBeVisible();
  await expect(dialog(page)).toContainText("Upparbetat och återstående");
}
const closeDialog = async (page: Page) => {
  await dialog(page).getByRole("button", { name: "Stäng" }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};

/** Steg 1 i körningen: fyll i referensen på januarifakturan med förslaget från avtalsansvarigs uppgift. */
async function fillRef(page: Page) {
  await page.getByRole("button", { name: /Använd 55102938 \(uppgift från Johan Berg\)/ }).click();
  await expect(page.locator("#eko-ref-steg-avtal")).toHaveValue("55102938");
  await page.getByRole("button", { name: "Spara referensen" }).click();
  await expect(toasts(page)).toContainText("Beställarreferensen på faktura januari 2027 är nu 55102938.");
  await expect(main(page)).toContainText("Alla fakturor har giltig beställarreferens.");
}

/** Godkänn en vecka utan närvaro i radens detalj (kommentaren krävs). */
async function approveZero(page: Page, number: string, week: string) {
  await openLine(page, number);
  const d = dialog(page);
  await d.locator("textarea").first().fill("Kontrollerat med samordnaren – inskriven hela veckan enligt beställningen.");
  await d.getByRole("button", { name: "Godkänn veckan för fakturering" }).click();
  await expect(toasts(page)).toContainText(`${week} för ${number} är godkänd för fakturering.`);
  await expect(d).toContainText("Godkänd av Lars Nyström");
  await closeDialog(page);
  await page.locator("#eko-search-avtal").fill("");
}
/** Referens och de tre veckorna utan närvaro – det som krävs innan januarifakturan kan godkännas och skapas. */
async function prepareJanuary(page: Page) {
  await fillRef(page);
  await approveZero(page, "BOT-26-0157", "v. 3 2027");
  await approveZero(page, "BOT-26-0159", "v. 2 2027");
  await approveZero(page, "BOT-27-0031", "v. 4 2027");
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

test("1. startsidan som ekonom: en faktura per månad, belopp och referenser per faktura", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi", EKONOM, "511 332 kr");
  const t = await mainText(page);
  expect(t).toMatch(/511 332 kr/);
  expect(t).toContain("1 faktura · 124 rader · 356 veckor");
  expect(t.toLowerCase()).toContain("ofakturerade veckor äldre än 45 dagar");
  expect(t).toContain("Risk för preskription");
  expect(t.toLowerCase()).toContain("returnerade fakturor");
  expect(t).toContain("Tilläggsfaktura 2 · december 2026");
  expect(t).toContain("10 veckor faktureras om på en ny faktura");
  expect(t.toLowerCase()).toContain("fakturor som saknar beställarreferens");
  expect(t).toContain("Miljonbemanning fyller i kommunens referens – en per faktura.");
  expect(t.toLowerCase()).toContain("uppgifter till dig");
  expect(t).toContain("55102938");
  // Utvecklingsfasen visas bara i prototypen. I appen märks det som verkligen är avstängt (Fortnox) med "Kommer senare".
  if (isDemo(info)) expect(t).toContain("Byggs i fas 2");
  else {
    expect(t).toContain("Kommer senare");
    expect(t).not.toContain("Byggs i fas");
    expect(t).not.toMatch(/prototyp/i);
  }
  expect(t.toLowerCase()).toContain("fortnox-synk");
  expect(t).not.toMatch(/authorization code flow/i);
  expect(t).toContain("Fortnox godkänner kopplingen");
  // KPI-rutor med röd ram har statustext (inte bara färg)
  expect(t).toContain("Fyll i referensen");
  expect(t).toContain("Fakturera nu");
  expect(t).not.toMatch(/\b1 (veckor|fakturor|öppna|stoppade|returnerade|godkända)\b/);
  expect(t).not.toContain("Saknas · Saknas");
  expect(await kpiOverflow(page)).toBe(0);
  await page.setViewportSize({ width: 400, height: 900 });
  await page.waitForTimeout(120);
  expect(await kpiOverflow(page)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
  expect(errors).toEqual([]);
});

test("2. körningen januari: regler, beställarreferensen på fakturan och inköpsordernumret (bara 99-nummer)", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, "Regler för körningen");
  const t = await mainText(page);
  expect(t).toMatch(/torsdag/);
  expect(t).toMatch(/v\. 53 2026/i);
  expect(t).toMatch(/december 2026/);
  expect(t).toContain("En faktura per månad med en rad per ärende");
  expect(t).toContain("(8–10 siffror)");
  // Prototypens förklaring (DemoNote) att priserna är exempel – visas inte i appen.
  if (isDemo(info)) expect(t).toContain("prislistans spann (1 323–1 668 kr per vecka)");
  else expect(t).not.toContain("prislistans spann");
  expect(await kpiOverflow(page)).toBe(0);
  // Radtabellen (16 px) får plats utan sidledsrullning vid 1280 px.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(120);
  expect(await lines(page).evaluate((x) => x.parentElement!.scrollWidth - x.parentElement!.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await expect(janCard(page)).toContainText("Stoppad");
  await expect(janCard(page)).toContainText("124 rader · 356 veckor · 511 332 kr exkl. moms");

  // Referenskontrollen: spärrad referens och fel format stoppas – fakturan förblir stoppad.
  const ref = page.locator("#eko-ref-steg-avtal");
  await ref.fill("55102983");
  await page.getByRole("button", { name: "Spara referensen" }).click();
  await expect(main(page)).toContainText("Referensen 55102983 är spärrad hos kommunen.");
  await ref.fill("12 34");
  await page.getByRole("button", { name: "Spara referensen" }).click();
  await expect(main(page)).toContainText("bara innehålla siffror");
  await expect(janCard(page)).toContainText("Stoppad");
  await fillRef(page);
  await expect(janCard(page)).toContainText("55102938 · Giltig");
  await expect(janCard(page)).not.toContainText("Stoppad");

  // Inköpsordernumret: aldrig ärendenumret, bara kommunens nummer (nio siffror som börjar med 99).
  const po = page.locator("#eko-po-avtal");
  await po.fill("BOT-26-0143");
  await page.getByRole("button", { name: "Spara inköpsordernummer" }).click();
  await expect(main(page)).toContainText("Ärendenumret får aldrig stå som inköpsordernummer.");
  await po.fill("123456789");
  await page.getByRole("button", { name: "Spara inköpsordernummer" }).click();
  await expect(main(page)).toContainText(/Inköpsordernummer ska vara .*99/);
  await po.fill("991234567");
  await page.getByRole("button", { name: "Spara inköpsordernummer" }).click();
  await expect(toasts(page)).toContainText("Inköpsordernumret är nu 991234567.");
  await expect(janCard(page).getByText("991234567").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("3. veckor utan närvaro godkänns med kommentar – sedan kan fakturan godkännas", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, JAN);
  await openLine(page, "BOT-26-0157");
  const d = dialog(page);
  await d.getByRole("button", { name: "Godkänn veckan för fakturering" }).click();
  await expect(d).toContainText("Skriv en kort kommentar");
  await closeDialog(page);
  await page.locator("#eko-search-avtal").fill("");
  // Fakturan kan inte godkännas så länge veckor utan närvaro väntar.
  await expect(page.getByRole("button", { name: `Godkänn ${JAN.toLowerCase()}` })).toBeDisabled();
  await approveZero(page, "BOT-26-0157", "v. 3 2027");
  await approveZero(page, "BOT-26-0159", "v. 2 2027");
  await approveZero(page, "BOT-27-0031", "v. 4 2027");
  // Raderna med anmärkning (överlapp, närvaro saknas) bekräftas innan fakturan godkänns.
  const approve = page.getByRole("button", { name: `Godkänn ${JAN.toLowerCase()}` });
  await expect(approve).toBeDisabled();
  await page.locator("#eko-rem-avtal").check();
  await approve.click();
  await expect(toasts(page)).toContainText(`${JAN} är godkänd (124 rader).`);
  await expect(janCard(page)).toContainText("Godkänd");
  await expect(main(page)).toContainText("Inga fakturor väntar på godkännande.");
  expect(errors).toEqual([]);
});

test("4. överlapp: fråga samordnaren och bläddra till det andra ärendet", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, JAN);
  await openLine(page, "BOT-26-0131");
  const d = dialog(page);
  await expect(d).toContainText("BOT-27-0004");
  await expect(d).toContainText(JAN);
  await d.getByRole("button", { name: "Fråga samordnaren" }).click();
  await expect(toasts(page)).toContainText("Frågan är skickad till samordnaren. Den innehåller bara ärendenummer.");
  await expect(d).toContainText("Fråga skickad till samordnaren");
  await d.getByRole("button", { name: "Visa BOT-27-0004" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Rad BOT-27-0004" })).toBeVisible();
  await closeDialog(page);
  expect(errors).toEqual([]);
});

test("5. skapa i Fortnox: en faktura, idempotens, statussynk och stäng körningen", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, JAN);
  await prepareJanuary(page);
  await page.locator("#eko-rem-avtal").check();
  await page.getByRole("button", { name: `Godkänn ${JAN.toLowerCase()}` }).click();
  await expect(toasts(page)).toContainText(`${JAN} är godkänd (124 rader).`);

  await page.getByRole("button", { name: "Skapa i Fortnox (1)" }).click();
  await dialog(page).getByRole("button", { name: "Skapa 1 faktura" }).click();
  // Prototypen säger "simulerat"; appen säger vilken status fakturan fick (ingen utvecklartext).
  await expect(toasts(page)).toContainText(
    isDemo(info) ? "1 faktura skapades i Fortnox som ej bokfört utkast (simulerat). Inga dubbletter." : "1 faktura har fått status ”Skapad i Fortnox (ej bokförd)”. Inga dubbletter.",
  );
  if (!isDemo(info)) await expect(toasts(page)).not.toContainText("simulerat");
  const jan = janCard(page);
  await expect(jan).toContainText("Skapad i Fortnox (ej bokförd)");
  await expect(jan).toContainText("Fakturanummer i Fortnox");
  await expect(lines(page).locator("tbody tr").first()).toContainText("Låst");

  // Omkörning: inga dubbletter
  await page.getByRole("button", { name: "Skapa i Fortnox (0)" }).click();
  await dialog(page).getByRole("button", { name: "Kör ändå" }).click();
  await expect(toasts(page)).toContainText("Inga nya fakturor. 1 faktura fanns redan – inga dubbletter skapades.");
  const runs = card(page, "Fortnox-körningar");
  await expect(runs).toContainText("0 skapade");
  await expect(runs).toContainText("1 dubblett hoppades över");
  await expect(runs).toContainText("1 skapad");

  // Statussynk: skapad → bokförd → skickad → betald
  await page.getByRole("button", { name: "Hämta status från Fortnox" }).click();
  await expect(toasts(page)).toContainText("1 faktura gick vidare ett steg.");
  await expect(jan).toContainText("Bokförd");
  await page.getByRole("button", { name: "Hämta status från Fortnox" }).click();
  await expect(jan).toContainText("Skickad (Peppol)");
  await page.getByRole("button", { name: "Hämta status från Fortnox" }).click();
  await expect(jan).toContainText("Betald");

  // Alla fakturor är skapade: körningen kan stängas.
  await page.getByRole("button", { name: "Stäng körningen" }).click();
  await dialog(page).getByRole("button", { name: "Stäng körningen" }).click();
  await expect(toasts(page)).toContainText("Fakturakörningen för januari 2027 är stängd.");
  await expect(main(page)).toContainText("Körningen är stängd");

  // Tillståndet spelas upp igen efter omladdning (prototypen: kommandologgen i webbläsaren)
  await page.reload();
  await expect(main(page)).toContainText("1 dubblett hoppades över");
  await expect(janCard(page)).toContainText("Betald");
  expect(errors).toEqual([]);
});

test("6 och 8. reservväg: CSV-export och manuellt fakturerad (kräver referens), ekonomens ärendevy", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01", EKONOM, JAN);
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
    csv = fs.readFileSync((await dl.path())!, "utf8").replace(/^﻿/, "");
  }
  expect(csv.startsWith("Faktura;Fakturans status;Beställarreferens;Inköpsordernummer;Ärendenummer (faktureringsobjekt);")).toBe(true);
  expect(csv).toContain(`${JAN};Stoppad;`);
  expect(csv).toContain("BOT-26-0143");
  expect(csv).not.toContain("Nadia");
  expect(csv).not.toContain("Warsame");

  // Utan giltig referens kan fakturan inte heller markeras som manuellt fakturerad.
  await page.getByRole("button", { name: "Markera som manuellt fakturerad" }).click();
  let d = dialog(page);
  await expect(d).toContainText("Ingen faktura kan markeras just nu.");
  // Inga fält som inte går att fylla i: bara beskedet och Stäng.
  await expect(d.getByRole("button", { name: "Spara", exact: true })).toHaveCount(0);
  await expect(d.locator("#eko-manual-no")).toHaveCount(0);
  // Två knappar heter Stäng (krysset och footern) – footerns är den sista.
  await d.getByRole("button", { name: "Stäng", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await prepareJanuary(page);
  await page.getByRole("button", { name: "Markera som manuellt fakturerad" }).click();
  d = dialog(page);
  await d.locator("#eko-manual-no").fill("12a");
  await d.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(d).toContainText("3–10 siffror");
  await d.locator("#eko-manual-no").fill("20417");
  await d.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(toasts(page)).toContainText(`${JAN} är markerad som manuellt fakturerad med fakturanummer 20417. Den skapas inte i Fortnox igen.`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(janCard(page)).toContainText("Manuellt fakturerad");

  // 8. Ekonomens ärendevy: ärendet är en rad på månadens faktura.
  await go(page, info, `/ekonomi/arende/${NADIA}`);
  await expect(main(page)).toContainText("Debiterbara veckor per månad");
  const t = await mainText(page);
  expect(t).not.toContain("Nadia");
  expect(t).not.toContain("Warsame");
  for (const x of ["beställning", "upparbetat", "återstående", "debiterbara veckor per månad"]) expect(t.toLowerCase()).toContain(x);
  const jan = page.getByRole("table", { name: "Debiterbara veckor per månad" }).getByRole("row").filter({ hasText: "Januari 2027" });
  await expect(jan).toContainText("Manuellt fakturerad");
  await expect(jan).toContainText(JAN);
  await expect(jan).toContainText("20417");

  await go(page, info, "/ekonomi/arende");
  await expect(main(page)).toContainText("Sök ärendenummer");
  await page.locator("#eko-case-search").fill("0143");
  await expect(page.getByRole("table", { name: "Ärenden" }).locator("tbody tr")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("7. fakturans förhandsvisning (Peppol): hela månadens faktura med raden markerad", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi/2027-01/faktura/case-260132", EKONOM, "Fältmappning");
  const t = await mainText(page);
  for (const s of ["BuyerReference", "OrderReference", "Er referens", "Ert ordernummer"]) expect(t).toContain(s);
  expect(t).toContain(JAN);
  expect(t).toContain("124 ärenden, 356 deltagarveckor");
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
  expect(t).not.toContain("Saknas (saknas)");
  expect(t).not.toContain("Nikola");
  expect(t).not.toContain("Ahmadi");
  expect(t).not.toContain("Sjukhusvistelse"); // pausorsaken (hälsouppgift) visas inte
  expect(errors).toEqual([]);
});

test("7b. returnerad tilläggsfaktura för december: veckorna räknas och benämns lika i faktura och ärendevy", async ({ page }, info) => {
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
  expect(t).toContain("Tilläggsfaktura 2 · december 2026");
  expect(errors).toEqual([]);
});

test("9. startsidan: uppgiften, referensen på båda fakturorna, kreditera den returnerade och skapa ny", async ({ page }, info) => {
  const errors = await openEko(page, info, "/ekonomi", EKONOM, "Uppgifter till dig");
  const tasks = card(page, "Uppgifter till dig");
  // Uppgiften: fyll i referensen på januarifakturan.
  await tasks.getByRole("button", { name: "Fyll i referensen" }).click();
  let d = dialog(page);
  await expect(d.getByRole("heading", { name: "Beställarreferens på fakturan" })).toBeVisible();
  expect(await d.locator("p").first().innerText()).toContain(`${JAN} har ingen referens.`);
  await d.getByRole("button", { name: /Använd 55102938/ }).click();
  await d.getByRole("button", { name: "Spara referensen" }).click();
  await expect(toasts(page)).toContainText("Beställarreferensen på faktura januari 2027 är nu 55102938.");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Den returnerade tilläggsfakturan: rätt referens först, sedan kreditera och skapa ny.
  const returned = card(page, "Returnerade fakturor");
  const unbilled = card(page, /Ofakturerade veckor äldre än 45 dagar/);
  await expect(unbilled).toContainText("BOT-26-0121");
  await expect(returned.getByRole("button", { name: "Kreditera och skapa ny" })).toHaveCount(0);
  await returned.getByRole("button", { name: "Fyll i rätt referens" }).click();
  d = dialog(page);
  expect(await d.locator("p").first().innerText()).toContain("Tilläggsfaktura 2 · december 2026 har referensen 55102983.");
  await d.getByRole("button", { name: /Använd 55102938/ }).click();
  await d.getByRole("button", { name: "Spara referensen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card(page, "Fakturor som saknar beställarreferens")).toContainText("Alla fakturor har giltig referens");

  await returned.getByRole("button", { name: "Kreditera och skapa ny" }).click();
  await expect(toasts(page)).toContainText(
    isDemo(info) ? "Tilläggsfaktura 2 · december 2026 är krediterad och en ny är skapad (simulerat)." : "Tilläggsfaktura 2 · december 2026 är krediterad och en ny är skapad.",
  );
  // Knappen fungerar – i appen står ingen "Kommer senare" bredvid den (bara prototypen visar utvecklingsfasen).
  if (!isDemo(info)) await expect(returned).not.toContainText("Kommer senare");
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

test("10. beslut 5: prislistan och beloppen bara för ekonomen – chefen och systemadministratören ser inga belopp", async ({ page }, info) => {
  // Ekonomen: prislistan under Ekonomi.
  let errors = await openEko(page, info, "/ekonomi/prislista", EKONOM, "Prislista Botkyrka kommun");
  const p = await mainText(page);
  expect(p).toContain("1 323 kr–1 668 kr per deltagare och vecka exkl. moms");
  await expect(page.getByRole("table", { name: "Prislista Botkyrka kommun" }).locator("tbody tr")).toHaveCount(12);
  expect(errors).toEqual([]);

  // Chefen: ingen Ekonomi (sidan nekas och finns inte i menyn), ofakturerat som antal veckor utan kronor.
  errors = await open(page, info, "/ekonomi/2027-01", CHEF);
  await expect(main(page)).toContainText("Du har inte behörighet till den här sidan");
  await expect(page.getByRole("link", { name: "Fakturering" })).toHaveCount(0);
  await go(page, info, "/ledning");
  const unbilled = card(page, "Ofakturerat");
  await expect(unbilled).toContainText("4 veckor");
  await expect(unbilled).toContainText("Beloppen visas bara för ekonomen.");
  expect(await unbilled.innerText()).not.toMatch(AMOUNT);
  expect(await mainText(page)).not.toMatch(AMOUNT);
  expect(errors).toEqual([]);

  // Systemadministratören: avtalssidan utan prislista och utan vitesbelopp.
  errors = await open(page, info, "/admin/avtal", ADMIN);
  await expect(main(page)).toContainText("Viten och avvikelser");
  await expect(page.getByRole("tab", { name: /Prislista/ })).toHaveCount(0);
  await expect(main(page)).toContainText("Per tillfälle enligt avtalet.");
  expect(await mainText(page)).not.toMatch(AMOUNT);
  expect(errors).toEqual([]);
});
