// Vardagen (D0, omgång 2): osparad text skyddas, tabellrader är riktiga länkar, mobilmenyn går att stänga med Esc och
// valt mejl i inkorgen står i adressen. Samma test körs mot prototypen (hash-navigering) och appen.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { isDemo, leaveWarnings, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const MARIA: Who = { userId: "k-maria", role: "kommun_handlaggare" };
const NADIA = "case-260143"; // BOT-26-0143, Amira

const main = (page: Page) => page.locator("#main");
/** Sökväg + query som appen ser den (prototypen: efter #). */
const here = (page: Page, info: TestInfo) =>
  page.evaluate((demo) => (demo ? window.location.hash.slice(1) : window.location.pathname + window.location.search), isDemo(info));

async function settle(page: Page, info: TestInfo) {
  if (!isDemo(info)) await loaded(page);
  await page.waitForTimeout(150);
}

/** Ladda om sidan (prototypen: samma hash, testdatat spelas upp igen). */
async function reload(page: Page, info: TestInfo) {
  await page.reload();
  await settle(page, info);
}

// ------------------------------------------------------------ 1. Vakten och automatisk utkastsparning (D2 punkt 2)
// Utkastet sparas automatiskt 2 s efter senaste ändringen (useAutosave). Vakten frågar bara när det inte går att spara.
const AMAL = "case-270012"; // BOT-27-0012, Amira
const HODAN = "case-260119"; // BOT-26-0119, Amira
const KARIN: Who = { userId: "u-karin", role: "chef" };
/** Statusraden för automatisk utkastsparning (role=status, aria-live=polite). */
const autosave = (page: Page) => page.locator("[data-autosave]");
const SAVED = /^Utkast sparat \d\d\.\d\d$/;
const menuLink = (page: Page, name: RegExp) => page.locator("aside nav").getByRole("link", { name }).first();
const askDialog = (page: Page) => page.getByRole("dialog", { name: "Du har inte sparat" });
async function switchUser(page: Page, info: TestInfo, as: Who, to: string) {
  if (isDemo(info)) {
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), as);
    await page.evaluate((p) => {
      window.location.hash = p;
    }, to);
    await page.reload();
  } else {
    await switchPersona(page, as);
    await page.goto(to);
  }
  await settle(page, info);
}
/** Rader i kortets revisionslogg (chefens flik Historik) med en viss text av en viss person. */
async function logRows(page: Page, text: string, who = "Amira Haddad"): Promise<number> {
  const table = page.getByRole("table", { name: "Revisionslogg" });
  await expect(table).toBeVisible();
  const more = page.getByRole("button", { name: "Visa alla" });
  if (await more.count()) await more.click();
  return table.locator("tbody tr").filter({ hasText: text }).filter({ hasText: who }).count();
}

test("avstämning som inte kan sparas automatiskt (röd status utan avvikelse): menyn frågar – Stanna kvar behåller texten, Lämna sidan går vidare och utkastet finns kvar", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Veckoavstämning" })).toBeVisible();
  const note = "Ringde två arbetsgivare i lager. Uppföljning på torsdag.";
  await page.locator("#ci-note").fill(note);
  await page.getByRole("group", { name: "Samlad status" }).getByRole("button", { name: /Röd/ }).click();
  await expect(autosave(page)).toHaveText("Sparas inte automatiskt förrän avvikelsen är ifylld", { timeout: 6000 });
  await expect(page.getByText("Utkastet är sparat. Du kan fortsätta senare.")).toHaveCount(0);

  // Stanna kvar: ingenting händer, texten finns kvar.
  await menuLink(page, /^Min vecka/).click();
  await expect(askDialog(page)).toBeVisible();
  await expect(askDialog(page)).toContainText("Det du har skrivit sparas inte om du lämnar sidan.");
  await askDialog(page).getByRole("button", { name: "Stanna kvar" }).click();
  await expect(askDialog(page)).toBeHidden();
  expect(await here(page, info)).toBe(`/avstamning/${NADIA}`);
  await expect(page.locator("#ci-note")).toHaveValue(note);

  // Lämna sidan: Min vecka visas.
  await menuLink(page, /^Min vecka/).click();
  await askDialog(page).getByRole("button", { name: "Lämna sidan" }).click();
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await settle(page, info);
  await expect(main(page).locator("h1").first()).toBeVisible();

  // Tillbaka: utkastet visas igen med en upplysning – och kan kastas.
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe(`/avstamning/${NADIA}`);
  await settle(page, info);
  await expect(page.getByText("Ditt osparade utkast är återställt")).toBeVisible();
  await expect(page.locator("#ci-note")).toHaveValue(note);
  await page.getByRole("button", { name: "Börja om" }).click();
  await expect(page.locator("#ci-note")).toHaveValue("");
  // Utan osparad text frågar menyn inte.
  await menuLink(page, /^Min vecka/).click();
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await expect(askDialog(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** Räknar kommandon mot /api/rpc per nyckel från och med nu (bara appen). */
function countCommands(page: Page): Record<string, number> {
  const out: Record<string, number> = {};
  page.on("request", (r) => {
    if (!r.url().includes("/api/rpc")) return;
    try {
      const b = JSON.parse(r.postData() || "{}") as { kind?: string; key?: string };
      if (b.kind === "command" && b.key) out[b.key] = (out[b.key] ?? 0) + 1;
    } catch {
      /* ignoreras */
    }
  });
  return out;
}

test("avstämningen sparas automatiskt: ingen fråga, ingen toast, utkastet finns efter Tillbaka och efter omladdning – och loggen får en rad per besök", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Veckoavstämning" })).toBeVisible();
  await expect(autosave(page)).toHaveText("");
  const commands = countCommands(page);
  const goal = "Ringa två arbetsgivare i lager";
  await page.locator("#ci-nextgoal").fill(goal);
  await page.locator("#ci-note").fill("Ringde en arbetsgivare.");
  // Första autosparningen: autosparningar flyttar inte demoklockan (09.12). Diskret statusrad – ingen toast.
  await expect(autosave(page)).toHaveText("Utkast sparat 09.12", { timeout: 6000 });
  await expect(page.getByText("Utkastet är sparat. Du kan fortsätta senare.")).toHaveCount(0);
  // Flera ändringar i samma besök: ny sparning 2 s efter varje paus (prototypen sparar så snabbt att "Sparar utkast…"
  // inte hinner synas – därför väntetid i stället), fortfarande samma utkast och samma tid.
  await page.locator("#ci-note").fill("Ringde två arbetsgivare i lager. Uppföljning på torsdag.");
  await page.waitForTimeout(2600);
  await expect(autosave(page)).toHaveText("Utkast sparat 09.12");
  await page.locator("#ci-note").fill("Ringde två arbetsgivare i lager. Uppföljning på torsdag. Praktik från vecka 7.");
  await page.waitForTimeout(2600);
  await expect(autosave(page)).toHaveText("Utkast sparat 09.12");
  if (!isDemo(info)) expect(commands["coach.checkinSave"], "tre autosparningar").toBe(3);

  // Allt är sparat: menyn frågar inte.
  await menuLink(page, /^Min vecka/).click();
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await expect(askDialog(page)).toHaveCount(0);
  await settle(page, info);
  // Tillbaka: fälten kvar, utkastet står som sparat (ingen upplysning om osparat).
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe(`/avstamning/${NADIA}`);
  await settle(page, info);
  await expect(page.locator("#ci-nextgoal")).toHaveValue(goal);
  await expect(page.locator("#ci-note")).toHaveValue("Ringde två arbetsgivare i lager. Uppföljning på torsdag. Praktik från vecka 7.");
  await expect(page.getByText("Ditt osparade utkast är återställt")).toHaveCount(0);
  await expect(autosave(page)).toHaveText("Utkast sparat 09.12");
  // Omladdning utan varning: utkastet finns på servern – "Det finns ett sparat utkast".
  await reload(page, info);
  expect(leaveWarnings(page)).toBe(0);
  await expect(page.getByText("Det finns ett sparat utkast")).toBeVisible();
  await page.getByRole("link", { name: "Öppna utkastet" }).click();
  await settle(page, info);
  await expect(page.locator("#ci-nextgoal")).toHaveValue(goal);
  await expect(page.locator("#ci-note")).toHaveValue("Ringde två arbetsgivare i lager. Uppföljning på torsdag. Praktik från vecka 7.");
  // Kortet: fliken Avstämningar visar utkastet.
  await switchUser(page, info, AMIRA, `/arenden/${NADIA}?flik=avstamningar`);
  await expect(main(page)).toContainText("1 utkast väntar på granskning");
  // Chefen: tre autosparningar i ett besök = exakt en rad "Avstämning sparades som utkast" (Sparades automatiskt).
  await switchUser(page, info, KARIN, `/arenden/${NADIA}?flik=historik`);
  expect(await logRows(page, "Avstämning sparades som utkast")).toBe(1);
  await expect(page.getByRole("table", { name: "Revisionslogg" }).locator("tbody tr").filter({ hasText: "Avstämning sparades som utkast" })).toContainText("Sparades automatiskt");
  expect(errors).toEqual([]);
});

test("ett sparat utkast som inte öppnas: att skriva i det tomma formuläret skapar inte ett andra utkast (granskning 2026-10-03)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await page.locator("#ci-note").fill("Första utkastet, sparat automatiskt.");
  await expect(autosave(page)).toHaveText(SAVED, { timeout: 6000 });
  await reload(page, info);
  await expect(page.getByText("Det finns ett sparat utkast")).toBeVisible();
  await expect(main(page)).toContainText("Det du skriver här sparas inte automatiskt förrän du har öppnat utkastet eller sparat det här som ett nytt utkast.");
  // Skriver i det tomma formuläret utan att öppna utkastet: autosparningen stoppar och säger varför.
  await page.locator("#ci-note").fill("Text i det tomma formuläret.");
  await expect(autosave(page)).toHaveText("Sparas inte automatiskt – det finns redan ett sparat utkast. Öppna utkastet, eller spara det här som ett nytt med Spara utkast.", { timeout: 6000 });
  await page.waitForTimeout(2500);
  // Vakten frågar (texten är osparad) – lämna sidan: kortet visar fortfarande ett utkast, inte två.
  await menuLink(page, /^Mina ärenden/).click();
  await expect(askDialog(page)).toBeVisible();
  await askDialog(page).getByRole("button", { name: "Lämna sidan" }).click();
  await expect.poll(() => here(page, info)).toBe("/arenden");
  await settle(page, info);
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, `/arenden/${NADIA}?flik=avstamningar`);
  else await page.goto(`/arenden/${NADIA}?flik=avstamningar`);
  await settle(page, info);
  await expect(main(page)).toContainText("1 utkast väntar på granskning");
  await expect(main(page)).not.toContainText("2 utkast");
  expect(errors).toEqual([]);
});

test("Spara utkast och fortsatt skrivande: samma utkast sparas vidare – kortet visar ett utkast (granskning 2026-10-03)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await page.locator("#ci-note").fill("Sparas manuellt.");
  await page.getByRole("button", { name: "Spara utkast" }).click();
  await expect(page.getByText("Utkastet är sparat. Du kan fortsätta senare.")).toBeVisible();
  // Inget "Det finns ett sparat utkast" för det egna utkastet – formuläret är det utkastet.
  await expect(page.getByText("Det finns ett sparat utkast")).toHaveCount(0);
  await page.locator("#ci-note").fill("Sparas manuellt. Och sedan automatiskt.");
  await expect(autosave(page)).toHaveText(SAVED, { timeout: 6000 });
  await menuLink(page, /^Mina ärenden/).click();
  await expect(askDialog(page)).toHaveCount(0);
  await expect.poll(() => here(page, info)).toBe("/arenden");
  await settle(page, info);
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, `/arenden/${NADIA}?flik=avstamningar`);
  else await page.goto(`/arenden/${NADIA}?flik=avstamningar`);
  await settle(page, info);
  await expect(main(page)).toContainText("1 utkast väntar på granskning");
  expect(errors).toEqual([]);
});

test("en godkänd kartläggning som ändras utan att sparas: vakten frågar (granskning 2026-10-03)", async ({ page }, info) => {
  const errors = await open(page, info, `/kartlaggning/${NADIA}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Kartläggning vecka 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Spara ändringar" })).toBeVisible();
  await page.locator("#ia-work").fill("Ändrad text i en godkänd kartläggning.");
  await page.waitForTimeout(2500);
  // Ingen autosparning för en godkänd kartläggning – och menyn frågar.
  await expect(page.locator("[data-autosave]")).toHaveCount(0);
  await menuLink(page, /^Min vecka/).click();
  await expect(askDialog(page)).toBeVisible();
  await askDialog(page).getByRole("button", { name: "Stanna kvar" }).click();
  await expect(page.locator("#ia-work")).toHaveValue("Ändrad text i en godkänd kartläggning.");
  await page.getByRole("button", { name: "Spara ändringar" }).click();
  await expect(page.getByText("Utkastet är sparat.", { exact: true })).toBeVisible();
  await menuLink(page, /^Min vecka/).click();
  await expect(askDialog(page)).toHaveCount(0);
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  expect(errors).toEqual([]);
});

test("byt sida inom 2 s: vakten sparar utkastet först – ingen fråga, och kortet visar utkastet", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Veckoavstämning" })).toBeVisible();
  await page.locator("#ci-note").fill("Snabb anteckning innan jag byter sida.");
  await menuLink(page, /^Mina ärenden/).click();
  await expect.poll(() => here(page, info)).toBe("/arenden");
  await expect(askDialog(page)).toHaveCount(0);
  await settle(page, info);
  await expect(page.getByRole("table", { name: "Ärenden" })).toBeVisible();
  // Kortets flik Avstämningar: utkastet finns på servern.
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, `/arenden/${NADIA}?flik=avstamningar`);
  else await page.goto(`/arenden/${NADIA}?flik=avstamningar`);
  await settle(page, info);
  await expect(main(page)).toContainText("1 utkast väntar på granskning");
  expect(leaveWarnings(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("månadsbedömningen sparas automatiskt: nivå och observation finns kvar efter Tillbaka och efter omladdning (Hodan)", async ({ page }, info) => {
  const errors = await open(page, info, `/manadsbedomning/${HODAN}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Månadsbedömning januari 2027" })).toBeVisible();
  const table = page.getByTestId("progressionsomraden");
  const selects = table.locator("select");
  await selects.nth(0).selectOption("2");
  const obs = "Kommer i tid varje dag och har egna rutiner för resorna.";
  await table.locator("tbody tr").nth(0).locator("textarea").first().fill(obs);
  await expect(autosave(page)).toHaveText(SAVED, { timeout: 6000 });
  await expect(page.getByText("Utkastet är sparat.", { exact: true })).toHaveCount(0);
  await menuLink(page, /^Min vecka/).click();
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await expect(askDialog(page)).toHaveCount(0);
  await settle(page, info);
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe(`/manadsbedomning/${HODAN}`);
  await settle(page, info);
  await expect(table.locator("select").nth(0)).toHaveValue("2");
  await expect(table.locator("tbody tr").nth(0).locator("textarea").first()).toHaveValue(obs);
  await expect(page.getByText("Ditt osparade utkast är återställt")).toHaveCount(0);
  await reload(page, info);
  expect(leaveWarnings(page)).toBe(0);
  await expect(page.getByTestId("progressionsomraden").locator("select").nth(0)).toHaveValue("2");
  await expect(page.getByTestId("progressionsomraden").locator("tbody tr").nth(0).locator("textarea").first()).toHaveValue(obs);
  // Chefen: en rad "Månadsbedömning sparades" för besöket.
  await switchUser(page, info, KARIN, `/arenden/${HODAN}?flik=historik`);
  expect(await logRows(page, "Månadsbedömning sparades")).toBe(1);
  expect(errors).toEqual([]);
});

test("kartläggningen sparas automatiskt – men inte med en diagnos i texten: då frågar vakten (Amal)", async ({ page }, info) => {
  const errors = await open(page, info, `/kartlaggning/${AMAL}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Kartläggning vecka 1" })).toBeVisible();
  await page.locator("#ia-work").fill("Lager i två år, även truck.");
  await expect(autosave(page)).toHaveText(SAVED, { timeout: 6000 });
  await expect(page.getByText("Utkastet är sparat.", { exact: true })).toHaveCount(0);
  // En diagnos stoppar autosparningen – vakten frågar, Stanna kvar.
  await page.locator("#ia-adapt").fill("Har diagnosen ADHD");
  await expect(autosave(page)).toHaveText("Sparas inte automatiskt förrän diagnosen är borttagen", { timeout: 6000 });
  await menuLink(page, /^Min vecka/).click();
  await expect(askDialog(page)).toBeVisible();
  await askDialog(page).getByRole("button", { name: "Stanna kvar" }).click();
  await expect(askDialog(page)).toBeHidden();
  // Rättad text (testdatat har redan "Behöver tydlig struktur och schema i förväg" – en ny text ger en ny sparning).
  await page.locator("#ia-adapt").fill("Behöver instruktioner i skrift och ett schema i förväg");
  await expect(autosave(page)).toHaveText(SAVED, { timeout: 6000 });
  await menuLink(page, /^Min vecka/).click();
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await expect(askDialog(page)).toHaveCount(0);
  await settle(page, info);
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe(`/kartlaggning/${AMAL}`);
  await settle(page, info);
  await expect(page.locator("#ia-work")).toHaveValue("Lager i två år, även truck.");
  await expect(page.locator("#ia-adapt")).toHaveValue("Behöver instruktioner i skrift och ett schema i förväg");
  await reload(page, info);
  expect(leaveWarnings(page)).toBe(0);
  await expect(page.locator("#ia-work")).toHaveValue("Lager i två år, även truck.");
  await expect(page.locator("#ia-adapt")).toHaveValue("Behöver instruktioner i skrift och ett schema i förväg");
  await expect(main(page)).toContainText("Utkast");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 2. Radlänken i ärendelistan
test("ärendelistan: ärendenumret är en riktig länk – Ctrl-klick i raden öppnar kortet i en ny flik och listan står kvar", async ({ page, context }, info) => {
  const errors = await open(page, info, "/arenden", AMIRA);
  const table = page.getByRole("table", { name: "Ärenden" });
  const row = table.locator("tbody tr").filter({ hasText: "BOT-26-0143" });
  const link = row.getByRole("link", { name: /BOT-26-0143/ });
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toContain(`/arenden/${NADIA}`);
  // Raden har inget eget tabbstopp: länken är det enda stoppet.
  expect(await row.getAttribute("tabindex")).toBeNull();

  if (isDemo(info)) {
    // Den nya fliken laddar samma prototypfil.
    const html = fs.readFileSync(path.resolve(process.env.MM_DEMO_HTML ?? "dist-demo/index.html"), "utf8");
    await context.route("http://proto.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  }
  const popupP = context.waitForEvent("page");
  await row.locator("td").nth(2).click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupP;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toContain(`/arenden/${NADIA}`);
  if (!isDemo(info)) {
    await loaded(popup);
    await expect(popup.locator("#main h1").first()).toContainText(/Nadia/);
  }
  await popup.close();
  // Listan står kvar i den första fliken.
  expect(await here(page, info)).toBe("/arenden");
  await expect(table).toBeVisible();

  // Vanligt klick i raden öppnar kortet i samma flik.
  await row.locator("td").nth(2).click();
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}`);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 3. Mobilmenyn
test("mobilmenyn (390 px): Meny öppnar, första valet får fokus, Esc stänger och fokus går tillbaka till Meny", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, info, "/arenden", SARA);
  const button = page.getByRole("button", { name: "Meny", exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  // Den fasta toppraden ligger kvar överst när man skrollar.
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(100);
  expect(Math.round((await button.boundingBox())!.y)).toBeLessThan(64);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.locator("#huvudmeny");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // Ett menyval byter sida och stänger menyn.
  await button.click();
  await menu.getByRole("link", { name: /^Rapporter/ }).click();
  await expect.poll(() => here(page, info)).toBe("/rapporter");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test("portalens mobilmeny (390 px): samma Meny-knapp och Esc stänger", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, info, "/portal/deltagare", MARIA);
  const button = page.getByRole("button", { name: "Meny", exact: true });
  await expect(button).toBeVisible();
  const header = await page.locator("header").filter({ has: button }).boundingBox();
  expect(header!.height, "portalens huvud är en rad på mobil").toBeLessThanOrEqual(80);
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Portalmeny" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 4. Valt mejl i inkorgen står i adressen
test("inkorgen: valt mejl och flik står i adressen – omladdning visar samma mejl, och Tillbaka går inte mejl för mejl", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  await page.locator("aside nav").getByRole("link", { name: /^Avropsinkorg/ }).first().click();
  await expect.poll(() => here(page, info)).toMatch(/^\/inkorg/);
  await settle(page, info);
  const rows = page.locator("[data-inkorg-row]");
  await expect(rows.first()).toBeVisible();
  // Välj ett annat mejl än det som visas.
  const other = page.locator("[data-inkorg-row]:not([aria-current])").first();
  const subject = (await other.locator("[data-inkorg-subject]").first().innerText()).trim();
  await other.click();
  await expect(main(page).locator("h2").filter({ hasText: subject }).first()).toBeVisible();
  const url = await here(page, info);
  expect(url).toMatch(/^\/inkorg\/em-[\w-]+$/);
  // Fliken Alla: i adressen.
  await page.getByRole("tab", { name: /^Alla/ }).click();
  await expect.poll(() => here(page, info)).toBe(`${url}?visa=alla`);

  await reload(page, info);
  expect(await here(page, info)).toBe(`${url}?visa=alla`);
  await expect(page.getByRole("tab", { name: /^Alla/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-inkorg-row][aria-current="true"]')).toContainText(subject);
  await expect(main(page).locator("h2").filter({ hasText: subject }).first()).toBeVisible();

  // Valet byter inte sida (replace): ett steg tillbaka leder till startsidan (Min vecka). Posten är från före omladdningen –
  // appen laddar då om sidan på dess adress (src/app/_shell/pop-guard.ts), så adressen läses medan sidan kan laddas om.
  await page.goBack();
  await expect.poll(() => here(page, info).catch(() => "")).toBe("/min-vecka");
  await settle(page, info);
  await expect(page).toHaveTitle("Min vecka – Miljonmatch");
  expect(errors).toEqual([]);
});
