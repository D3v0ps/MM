// Interaktionstest för området ledning: ledningsvyn (/ledning) och registret över avtalsavvikelser (/avtalsavvikelser).
// Port av den gamla prototypens prototyp/tools/test-ledning.mjs – samma steg, men data läses via skärmen (det finns ingen MM).
// Varje test öppnar en ny sida med nollställd prototyp. Siffrorna är den gamla prototypens för testdatat (1 feb 2027 kl. 09.12).
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const CHEF = { userId: "u-karin", role: "chef" };
const COACH = { userId: "u-amira", role: "coach" };
const SAMORDNARE = { userId: "u-sara", role: "samordnare" };
const KOMMUN_CHEF = { userId: "k-eva", role: "kommun_chef" };
const AVTALSANSVARIG = { userId: "u-johan", role: "avtalsansvarig" };
/** Nadias ärende i testdatat (prototypens tagg "nadia"). */
const NADIA = "BOT-26-0143";

const main = (page: Page) => page.locator("#main");
const card = (page: Page, title: string | RegExp) => page.locator("#main section").filter({ has: page.locator("h2", { hasText: title }) });
const dialog = (page: Page) => page.getByRole("dialog");
/** innerText med vanliga mellanslag (belopp och procent har hårt mellanslag). */
const text = async (l: Locator) => (await l.innerText()).replace(/\u00a0/g, " ");
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

/** Byt användare utan att nollställa data (prototypen: persona i localStorage, appen: testperson-cookie). */
async function switchUser(page: Page, info: TestInfo, to: string, as: { userId: string; role: string }) {
  if (isDemo(info)) {
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), as);
    await page.goto(`http://proto.test/index.html#${to}`);
    await page.reload();
  } else {
    await switchPersona(page, as);
    await page.goto(to);
  }
}

/** Samma kontroll som den gamla prototypens visit(): ingen felgräns, ingen "undefined/NaN" i texten. */
async function problems(page: Page): Promise<string[]> {
  const t = await text(main(page));
  const out: string[] = [];
  if (/Något gick fel när sidan skulle visas/.test(t)) out.push("Felgräns");
  if (/undefined|NaN|\[object Object\]/.test(t)) out.push(`Texten innehåller undefined/NaN: ${(t.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]}`);
  return out;
}

/** Knappar som sticker ut ur sitt kort (eller vars text inte ryms). */
const buttonsOutside = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const b of document.querySelectorAll<HTMLElement>("#main section button, #main section a")) {
      if (!b.offsetParent || b.closest(".overflow-x-auto")) continue;
      const sec = b.closest("section") as HTMLElement;
      const r = b.getBoundingClientRect();
      const c = sec.getBoundingClientRect();
      if (r.right > c.right + 1 || (b.clientWidth > 0 && b.scrollWidth > b.clientWidth + 1)) out.push(b.innerText.trim());
    }
    return out;
  });

async function openLedning(page: Page, info: TestInfo, to = "/ledning") {
  const errors = await open(page, info, to, CHEF);
  await expect(main(page).getByRole("heading", { name: /ledningsvy/i })).toBeVisible();
  return errors;
}
const openRegister = async (page: Page, info: TestInfo, as = CHEF, to = "/avtalsavvikelser") => {
  const errors = await open(page, info, to, as);
  await expect(main(page)).toContainText("Register enligt avtalets uppföljning");
  return errors;
};

// ============================================================ Ledningsvyn, flik Resultat och KPI:er
test("ledningsvyn: resultat, prognos, trend, tidig uppmärksamhet och kundens bild", async ({ page }, info) => {
  const errors = await openLedning(page, info);
  await expect(main(page)).toContainText("Resultatgrad, rullande 6 mån", { ignoreCase: true });
  expect(await problems(page)).toEqual([]);
  const t = await text(main(page));
  expect(t).toMatch(/Resultatgrad, rullande 6 mån/i);
  expect(t).toMatch(/Prognos/i);
  // Siffror som i den gamla prototypen
  await expect(main(page).locator("div.rounded-card", { hasText: /Resultatgrad, rullande 6 mån/i })).toContainText("33,9 %");
  await expect(main(page).locator("div.rounded-card", { hasText: /Resultatgrad, rullande 6 mån/i })).toContainText("43 av 127 avslut · minst 10 krävs för flagga");
  await expect(main(page).locator("div.rounded-card", { hasText: /^Prognos/i })).toContainText("45,0 %");
  await expect(main(page).locator("div.rounded-card", { hasText: /Flaggor att hantera/i })).toContainText("11");
  await expect(main(page).locator("div.rounded-card", { hasText: /Flaggor att hantera/i })).toContainText("3 kritiska flaggor");
  expect(t).toMatch(/Resultatdefinitionen är inte fastställd/i);
  expect(t).toMatch(/vilande/);
  expect(await main(page).locator("svg[role=img] rect").count()).toBeGreaterThanOrEqual(3);
  expect(t).toMatch(/Tidig uppmärksamhet/i);
  expect(t).toMatch(/ser inte att ärendet har eskalerats/i);
  expect(t).toMatch(/0 av 3/);

  // "Så ser kommunens chef resultatet" = det kommunens chef ser som standard: senast levererade beställarrapporten
  const cust = card(page, "Så ser kommunens chef resultatet");
  const ct = await text(cust);
  expect(ct).toContain("december 2026");
  expect(ct).toContain("31,2 %");
  expect(ct).toContain("24 av 77");
  expect(ct).toMatch(/Under avtalsmålet/);
  expect(ct).toContain("januari 2027");
  expect(ct).toContain("33,9 %");
  expect(ct).toMatch(/utkast/);
  expect(ct).toMatch(/färre än 5/);
  expect(ct).not.toMatch(/35\s?%/);

  // Status med text och ikon, inte bara färg (SLA-staplar)
  const sla = card(page, "SLA-uppfyllnad");
  const rows = sla.locator("[data-sla-row]");
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(rows.nth(i).locator("span.rounded-full")).toHaveCount(1);
    await expect(rows.nth(i).locator("span.rounded-full svg")).toHaveCount(1);
  }
  const st = await text(sla);
  expect(st).toMatch(/Når målet|Under målet/);
  expect(st).toMatch(/mål 100\s?%/);
  // KPI-rutor med markerad ram har statustext med ikon
  const boxed = main(page).locator("div.rounded-card.border-2");
  const n = await boxed.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(boxed.nth(i).locator("svg").first()).toBeVisible();
  expect(t).not.toMatch(/deadline/i);
  expect(await main(page).locator("details > summary [data-chevron]").count()).toBeGreaterThanOrEqual(1);

  // Knappar ryms i sina kort (1280 och 400 px)
  await expect(main(page).getByRole("link", { name: "Förfaller i dag och denna vecka" })).toBeVisible();
  expect(await buttonsOutside(page)).toEqual([]);
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(200);
  expect(await buttonsOutside(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(relevant(errors)).toEqual([]);
});

// ============================================================ Kvittera flaggor
test("ledningsvyn: kvittera resultatflaggan och en eskalering, kvar efter omladdning", async ({ page }, info) => {
  const errors = await openLedning(page, info);
  const flags = card(page, "Flaggor för chef och controller");
  await expect(flags).toContainText("8 att kvittera");
  // Resultatflaggan finns för chefen
  await expect(flags).toContainText("Bevaka: resultatgrad under internt mål");
  await main(page).getByRole("button", { name: "Kvittera flaggan" }).click();
  await dialog(page).getByRole("button", { name: "Kvittera med åtgärdsplan" }).click();
  await expect(dialog(page).locator("[role=alert]")).toHaveCount(1);
  // Ingen kvittering sparas utan plan
  await expect(flags).toContainText("8 att kvittera");
  await page.fill("#ldg-ack-plan", "Genomgång av fas 5-ärenden med coacherna torsdag. Uppföljning 15 februari.");
  await dialog(page).getByRole("button", { name: "Kvittera med åtgärdsplan" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Flaggan är kvitterad" })).toBeVisible();
  await expect(flags).toContainText("7 att kvittera");
  await expect(card(page, "Resultatgrad mot mål")).toContainText(/Flaggan kvitterad 1 feb kl\. \d\d\.\d\d/);
  await expect(main(page).getByRole("button", { name: "Kvittera flaggan" })).toHaveCount(0);

  // Kvittera en eskalering under Tidig uppmärksamhet med förslagsknappen
  const early = card(page, "Tidig uppmärksamhet");
  const kvittera = early.getByRole("button", { name: "Kvittera", exact: true });
  await expect(kvittera).toHaveCount(3);
  await kvittera.first().click();
  await dialog(page).getByRole("button", { name: /^Avstämning med coachen/ }).click();
  await expect(page.locator("#ldg-ack-plan")).toHaveValue(/Avstämning med coachen denna vecka/);
  await dialog(page).getByRole("button", { name: "Kvittera med åtgärdsplan" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(kvittera).toHaveCount(2);
  await expect(early).toContainText("Kvitterad av Karin Wallin");

  // Kvitterade flaggor syns i den utfällbara listan
  await expect(flags).toContainText(/Kvitterade flaggor \(\d+\)/);
  await flags.getByText(/Kvitterade flaggor \(\d+\)/).click();
  await expect(flags).toContainText(/Kvitterad av Karin Wallin 1 feb kl\. \d\d\.\d\d: Genomgång av fas 5-ärenden med coacherna torsdag\./);

  // Omladdning: kvitteringarna finns kvar (prototypen spelar upp kommandona igen)
  await page.reload();
  await expect(main(page).getByRole("heading", { name: /ledningsvy/i })).toBeVisible();
  await expect(card(page, "Resultatgrad mot mål")).toContainText(/Flaggan kvitterad 1 feb kl\. \d\d\.\d\d/);
  await expect(card(page, "Tidig uppmärksamhet").getByRole("button", { name: "Kvittera", exact: true })).toHaveCount(2);
  expect(relevant(errors)).toEqual([]);
});

// ============================================================ Flikarna
test("ledningsvyn: per coach, per avtalsområde och deltagarnas röst", async ({ page }, info) => {
  const errors = await openLedning(page, info);
  await expect(main(page)).toContainText("Resultatgrad, rullande 6 mån", { ignoreCase: true });
  await page.getByRole("tab", { name: /Per coach/ }).click();
  await expect(page).toHaveURL(/flik=coacher/);
  await expect(main(page).getByRole("table", { name: "Nyckeltal per coach" }).locator("tbody tr")).toHaveCount(5);
  let t = await text(main(page));
  expect(await problems(page)).toEqual([]);
  expect(t).toMatch(/Dokumentationstid/i);
  expect(t).toMatch(/median utan AI/);
  expect(t).toMatch(/Aktiva ärenden just nu/i);
  expect(t).toMatch(/Aktiva nu/i);
  // Samma siffror som den gamla prototypen
  const amira = main(page).getByRole("row", { name: /Amira Haddad/ });
  await expect(amira).toContainText("28,6 %");
  await expect(amira).toContainText("124 av 143");
  await expect(amira).toContainText("39 av 49 veckor");
  expect(t).toMatch(/Påminnelser denna vecka\s*17/i);
  expect(t).toMatch(/3 ärenden eskalerade till dig/);

  await page.getByRole("tab", { name: /Per avtalsområde/ }).click();
  await expect(page).toHaveURL(/flik=omraden/);
  await expect(main(page).getByRole("table", { name: "Deltagare och resultat per avtalsområde" }).locator("tbody tr")).toHaveCount(12);
  t = await text(main(page));
  expect(await problems(page)).toEqual([]);
  expect(t).toMatch(/Litet underlag/);
  expect(t).toMatch(/Aktiva just nu/i);
  expect(t).toMatch(/Aktiva under januari 2027\n134\n/i);
  expect(t).not.toMatch(/^Aktiva deltagare$/im);
  expect(t).toMatch(/91 just nu och 134 under januari 2027/);

  await page.getByRole("tab", { name: /Deltagarnas röst/ }).click();
  await expect(page).toHaveURL(/flik=puls/);
  await expect(main(page)).toContainText("Svarsfrekvens", { ignoreCase: true });
  t = await text(main(page));
  expect(await problems(page)).toEqual([]);
  expect(t).toMatch(/Svarsfrekvens/i);
  expect(t).toMatch(/Nöjdhet/i);
  expect(t).toMatch(/inte till coachen/);
  expect(t).toContain("175 svar på 275 utskick");
  const low = card(page, "Lågt betyg på stödet från coachen");
  await expect(low).toContainText("1 att kvittera");
  await low.getByRole("button", { name: "Kvittera", exact: true }).first().click();
  await page.fill("#ldg-ack-plan", "Samordnaren ringer deltagaren i dag.");
  await dialog(page).getByRole("button", { name: "Kvittera med åtgärdsplan" }).click();
  await expect(low).toContainText("Inget att kvittera");
  await expect(low).toContainText("Kvitterad av Karin Wallin");

  // Direktlänk med fliken i adressen
  await openLedning(page, info, "/ledning?flik=puls");
  await expect(page.getByRole("tab", { name: /Deltagarnas röst/ })).toHaveAttribute("aria-selected", "true");
  expect(relevant(errors)).toEqual([]);
});

// ============================================================ Behörighet
test("ledningsvyn: coachen och kommunens chef har ingen åtkomst", async ({ page }, info) => {
  // Appen har också Next.js ruttannonsör (role="alert") – läs sidans egen ruta i #main.
  await open(page, info, "/ledning", COACH);
  await expect(main(page).getByRole("alert")).toContainText("Du har inte behörighet till den här sidan");
  expect(await text(page.locator("body"))).not.toMatch(/eskaler/i);
  await open(page, info, "/ledning", KOMMUN_CHEF);
  await expect(main(page).getByRole("alert")).toContainText("Du har inte behörighet till den här sidan");
  await open(page, info, "/avtalsavvikelser", COACH);
  await expect(main(page).getByRole("alert")).toContainText("Du har inte behörighet till den här sidan");
});

// ============================================================ Avtalsavvikelser
test("avtalsavvikelser: registrera, ändra plan, varning och vite, markera klar, sammanställning och register", async ({ page }, info) => {
  const errors = await openRegister(page, info);
  expect(await problems(page)).toEqual([]);
  await expect(main(page).locator('ol[aria-label="Eskaleringstrappan"] li')).toHaveCount(5);
  await expect(main(page).getByRole("button", { name: /Alla \(3\)/ })).toBeVisible();

  // Tomt formulär ger fel på de obligatoriska fälten
  await main(page).getByRole("button", { name: "Registrera avvikelse eller klagomål" }).click();
  await dialog(page).getByRole("button", { name: "Registrera", exact: true }).click();
  expect(await dialog(page).locator("[role=alert]").count()).toBeGreaterThanOrEqual(4);
  await dialog(page).locator("#cd-type").getByRole("button", { name: "Klagomål" }).click();
  await page.selectOption("#cd-source", "arbetsgivare");
  await dialog(page).locator("#cd-level").getByRole("button", { name: "Större" }).click();
  await expect(page.locator("#cd-step")).toHaveValue("1");
  await page.fill("#cd-desc", "Arbetsgivaren fick ingen information om ändrade praktiktider vecka 5.");
  await page.fill("#cd-case", "BOT-99-9999");
  await dialog(page).getByRole("button", { name: "Registrera", exact: true }).click();
  await expect(dialog(page)).toContainText("Hittar inget ärende");
  await page.fill("#cd-case", NADIA);
  await page.fill("#cd-plan", "Samordnaren informerar arbetsgivaren skriftligt vid varje ändring. Checklista uppdateras.");
  await page.fill("#cd-due", "2027-02-19");
  await dialog(page).getByRole("button", { name: "Registrera", exact: true }).click();

  // Detaljvyn visas; typ, källa, nivå, steg, ärende och plan som väntar på kommunens godkännande
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/avtalsavvikelser\/cd-(?!2\b)[\w-]+/);
  await expect(page.getByRole("status").filter({ hasText: "Klagomålet är registrerad. Kommunens chef har fått en notis om att åtgärdsplanen väntar på godkännande." })).toBeVisible();
  await expect(main(page).getByRole("heading", { name: /klagomål/i })).toBeVisible();
  const t = await text(main(page));
  expect(await problems(page)).toEqual([]);
  expect(t).toMatch(/Nivå: större/);
  expect(t).toMatch(/Steg 1 · Större/);
  expect(t).toMatch(/Väntar på kommunens godkännande/);
  const desc = card(page, "Beskrivning");
  await expect(desc).toContainText("Arbetsgivare");
  await expect(desc.getByRole("link", { name: NADIA })).toBeVisible();
  const planCard = card(page, "Åtgärdsplan");
  await expect(planCard).toContainText("19 feb 2027");
  await expect(planCard).toContainText("Väntar på kommunens chef");
  // Mejlet till kommunens chef innehåller inga personuppgifter och inget ärendenummer
  await planCard.getByRole("button", { name: "Ändra åtgärdsplan" }).click();
  const mailText = await planCard.getByText("Kommunens chef får:").locator("..").innerText();
  expect(mailText).toContain("Logga in i portalen");
  expect(mailText).not.toContain(NADIA);

  // Uppdatera åtgärdsplanen – skickas för nytt godkännande
  await page.fill("#cd-edit-plan", "Samordnaren informerar arbetsgivaren skriftligt senast dagen innan varje ändring.");
  await page.fill("#cd-edit-due", "2027-02-26");
  await planCard.getByRole("button", { name: "Spara och skicka till kommunen" }).click();
  await expect(planCard).toContainText("dagen innan");
  await expect(planCard).toContainText("26 feb 2027");
  await expect(planCard).toContainText("Väntar på kommunens chef");

  // Skriftlig varning (steg 1) och vite från avtalskonfigurationen
  const sanctions = card(page, "Varning, vite och avropsstopp");
  await sanctions.getByRole("button", { name: "Ändra", exact: true }).click();
  await page.check("#cd-s-warning");
  await page.selectOption("#cd-s-penalty", "deviation");
  await sanctions.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(sanctions).toContainText(/Skriftlig varning\s*Ja/);
  await expect(sanctions).toContainText("25 000 kr");
  await expect(sanctions).toContainText("1 av 3");
  await expect(card(page, "Händelser")).toContainText("Skriftlig varning från kommunen");

  // Markera klar – kräver lärdomar
  const closeCard = card(page, "Markera som klar");
  await closeCard.getByRole("button", { name: "Markera som klar" }).click();
  await expect(closeCard.locator("[role=alert]")).toHaveCount(1);
  await page.fill("#cd-lessons", "Ändringar i praktiktider kommuniceras skriftligt till arbetsgivaren via samordnaren.");
  await closeCard.getByRole("button", { name: "Markera som klar" }).click();
  await expect(card(page, "Lärdomar")).toContainText("kommuniceras skriftligt");
  await expect(main(page).getByRole("button", { name: "Markera som klar" })).toHaveCount(0);
  await expect(card(page, "Händelser")).toContainText("Klar");

  // Registret och månadssammanställningen för APT
  await main(page).getByRole("navigation", { name: "Brödsmulor" }).getByRole("link", { name: "Avtalsavvikelser" }).click();
  await expect(main(page)).toContainText("Register enligt avtalets uppföljning");
  await expect(main(page).locator("div.rounded-card", { hasText: /Skriftliga varningar/i })).toContainText("1 av 3");
  await page.getByRole("tab", { name: /Månadssammanställning/ }).click();
  await page.selectOption("#ldg-apt-month", "2027-02");
  const apt = card(page, /Underlag för APT/);
  await expect(apt).toContainText("Arbetsgivaren fick ingen information");
  await expect(apt).toContainText("kommuniceras skriftligt");
  await page.selectOption("#ldg-apt-month", "2027-01");
  await expect(apt).toContainText("praktikplatsen inte var förberedd");
  if (isDemo(info)) {
    await apt.getByRole("button", { name: "Exportera" }).click();
    await expect(page.locator("#text-dialog-area")).toHaveValue(/Månadssammanställning avtalsavvikelser och klagomål – januari 2027/);
    await dialog(page).getByRole("button", { name: "Stäng", exact: true }).last().click();
  } else {
    const [dl] = await Promise.all([page.waitForEvent("download"), apt.getByRole("button", { name: "Exportera" }).click()]);
    expect(dl.suggestedFilename()).toBe("avvikelser-2027-01.txt");
  }

  // Registret: filter och radklick
  await page.getByRole("tab", { name: /Register/ }).click();
  await main(page).getByRole("button", { name: /Alla \(\d+\)/ }).click();
  const table = main(page).getByRole("table", { name: "Register över avtalsavvikelser" });
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await table.locator("tbody tr", { hasText: "Månadsrapport för december" }).click();
  await expect(page).toHaveURL(/\/avtalsavvikelser\/cd-2$/);
  await expect(main(page)).toContainText("Godkänd av kommunen (Eva Bergström)");

  // Omladdning: avvikelsen finns kvar (uppspelning)
  await page.reload();
  await expect(main(page)).toContainText("Godkänd av kommunen (Eva Bergström)");
  await main(page).getByRole("navigation", { name: "Brödsmulor" }).getByRole("link", { name: "Avtalsavvikelser" }).click();
  await expect(main(page).locator("div.rounded-card", { hasText: /Skriftliga varningar/i })).toContainText("1 av 3");
  await main(page).getByRole("button", { name: /Alla \(\d+\)/ }).click();
  const mine = main(page).getByRole("table", { name: "Register över avtalsavvikelser" }).locator("tbody tr", { hasText: "Arbetsgivaren fick ingen information" });
  await expect(mine).toContainText("Klar");
  await expect(mine).toContainText("Skriftlig varning · vite 25 000 kr");
  await expect(mine).toContainText("Klart 26 feb 2027");
  expect(relevant(errors)).toEqual([]);
});

test("avtalsavvikelser: samordnaren kan registrera men inte sätta varning, vite eller avropsstopp", async ({ page }, info) => {
  const errors = await openRegister(page, info, SAMORDNARE);
  await main(page).getByRole("button", { name: "Registrera avvikelse eller klagomål" }).click();
  await dialog(page).locator("#cd-level").getByRole("button", { name: "Större" }).click();
  await expect(page.locator("#cd-warning")).toBeDisabled();
  await expect(page.locator("#cd-penalty")).toBeDisabled();
  await expect(page.locator("#cd-stop")).toBeDisabled();
  await expect(dialog(page)).toContainText("Varningar, viten och avropsstopp registreras av avtalsansvarig eller chef.");
  await dialog(page).getByRole("button", { name: "Avbryt" }).click();
  await expect(dialog(page)).toHaveCount(0);
  // Detaljvyn: ingen Ändra-knapp för sanktioner
  await open(page, info, "/avtalsavvikelser/cd-2", SAMORDNARE);
  await expect(card(page, "Varning, vite och avropsstopp")).toContainText("Avropsstopp");
  await expect(card(page, "Varning, vite och avropsstopp").getByRole("button", { name: "Ändra", exact: true })).toHaveCount(0);
  expect(relevant(errors)).toEqual([]);
});

test("avtalsavvikelser: okänt id ger ett tydligt meddelande", async ({ page }, info) => {
  await open(page, info, "/avtalsavvikelser/cd-finns-inte", CHEF);
  await expect(main(page)).toContainText("Avvikelsen finns inte");
  await expect(main(page).getByRole("link", { name: "Till registret" })).toBeVisible();
});

// ============================================================ Perspektivbyte (bara prototypen)
test("ledningsvyn: perspektivbyte till kommunens chef visar samma månad och resultat", async ({ page }, info) => {
  test.skip(!isDemo(info), "Perspektivbyte finns bara i prototypen");
  await openLedning(page, info);
  await main(page).getByRole("button", { name: /Så ser kommunens chef resultatet/ }).first().click();
  await expect(page).toHaveURL(/#\/portal\/bestallarrapport/);
  await openLedning(page, info);
  await card(page, "Så ser kommunens chef resultatet").getByRole("button", { name: /som kommunens chef/ }).click();
  await expect(page).toHaveURL(/#\/portal\/bestallarrapport/);
  await expect(page.getByRole("heading", { level: 1, name: "Beställarrapport" })).toBeVisible();
  const kt = await text(page.locator("body"));
  expect(kt).not.toMatch(/Sidan finns inte/);
  expect(kt.toLowerCase()).toContain("december 2026");
  expect(kt).toContain("31,2 %");
  expect(kt).toMatch(/Under avtalsmålet/);
});

test("ledningsvyn: när nästa beställarrapport levereras följer kundkortet med", async ({ page }, info) => {
  await openLedning(page, info);
  const link = card(page, "Så ser kommunens chef resultatet").getByRole("link", { name: /Öppna utkastet för januari 2027/ });
  const href = (await link.getAttribute("href")) ?? "";
  const reportPath = href.replace(/^.*#/, "");
  expect(reportPath).toMatch(/^\/rapporter\//);
  await switchUser(page, info, reportPath, AVTALSANSVARIG);
  // Avtalsansvarig skriver sammanfattningen, godkänner och levererar (rapportområdets flöde)
  const approve = main(page).getByRole("button", { name: "Godkänn beställarrapporten" });
  await expect(approve).toBeVisible({ timeout: 5000 });
  await page.fill("#rap-summary", "Resultatet för januari redovisas mot avtalsmålet.");
  await approve.click();
  await main(page).getByRole("button", { name: "Leverera till kommunen" }).click();
  await dialog(page).getByRole("button", { name: "Leverera i portalen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Levererad i portalen" })).toBeVisible();
  await switchUser(page, info, "/ledning", CHEF);
  const ct = card(page, "Så ser kommunens chef resultatet");
  await expect(ct).toContainText("januari 2027");
  await expect(ct).toContainText("33,9 %");
  await expect(ct).not.toContainText("är ett utkast");
});

// ============================================================ Kommunens chef godkänner åtgärdsplanen (kommunportalen)
test("avtalsavvikelser: kommunens godkännande av åtgärdsplanen syns i detaljvyn", async ({ page }, info) => {
  await openRegister(page, info);
  // cd-3 har en plan som väntar på kommunens godkännande
  await open(page, info, "/avtalsavvikelser/cd-3", CHEF);
  await expect(card(page, "Åtgärdsplan")).toContainText("Väntar på kommunens chef");
  await switchUser(page, info, "/portal/bestallarrapport", KOMMUN_CHEF);
  // Kommunportalen frågar först (som prototypen): "Godkänn åtgärdsplanen?"
  await main(page).getByRole("button", { name: "Godkänn åtgärdsplanen" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Godkänn åtgärdsplanen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await switchUser(page, info, "/avtalsavvikelser/cd-3", CHEF);
  await expect(main(page)).toContainText("Åtgärdsplan godkänd – pågår");
  await expect(main(page)).toContainText("Godkänd av kommunen (Eva Bergström)");
});
