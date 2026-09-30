// Coachens flöden: Min vecka, närvaro, veckoavstämning (manuellt, AI-utkast, anteckningar, inspelning med samtycke),
// månadsbedömning, kartläggning, händelse och avslut. Port av prototyp/tools/test-coach.mjs – samma steg och värden,
// men allt läses från skärmen. Varje test öppnar en nollställd prototyp (projektet "demo"); mot appen körs samma steg.
// Id:n är testdatats (prototyp/tools/data-samples.json -> script_tags).
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open } from "./helpers";

const COACH = { userId: "u-amira", role: "coach" };
const HANDLEDARE = { userId: "u-petra", role: "handledare" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const SC = { nadia: "case-260143", yusuf: "case-260148", elif: "case-270003", hodan: "case-260119", mehmet: "case-260130", amal: "case-270012", skyddad: "case-260120" };
/** Petras teamärenden i testdatat (case_team). Handledaren ser bara dessa. */
const PETRA_CASES = new Set(
  (
    "BOT-26-0008,BOT-26-0009,BOT-26-0013,BOT-26-0015,BOT-26-0019,BOT-26-0021,BOT-26-0027,BOT-26-0031,BOT-26-0036,BOT-26-0041,BOT-26-0043,BOT-26-0052,BOT-26-0053,BOT-26-0054," +
    "BOT-26-0059,BOT-26-0070,BOT-26-0072,BOT-26-0073,BOT-26-0075,BOT-26-0076,BOT-26-0077,BOT-26-0082,BOT-26-0086,BOT-26-0087,BOT-26-0088,BOT-26-0095,BOT-26-0098,BOT-26-0099," +
    "BOT-26-0102,BOT-26-0103,BOT-26-0106,BOT-26-0107,BOT-26-0117,BOT-26-0124,BOT-26-0126,BOT-26-0127,BOT-26-0130,BOT-26-0132,BOT-26-0143,BOT-26-0156,BOT-26-0157,BOT-26-0159," +
    "BOT-26-0160,BOT-26-0163,BOT-26-0165,BOT-26-0166,BOT-26-0167,BOT-26-0169,BOT-26-0176,BOT-26-0181,BOT-27-0004,BOT-27-0008,BOT-27-0009,BOT-27-0013,BOT-27-0016,BOT-27-0021," +
    "BOT-27-0028,BOT-27-0030,BOT-27-0034,BOT-27-0035,BOT-27-0036,BOT-27-0042,BOT-27-0046"
  ).split(","),
);

// ---------------------------------------------------------------- Hjälpare
const main = (page: Page) => page.locator("main");
/** Ingen undefined/NaN i texten och inga eskaleringar som coachen inte ska se. */
async function noBadText(page: Page) {
  const t = await main(page).innerText();
  expect(t).not.toMatch(/undefined|NaN|\[object Object\]/);
  expect(t).not.toMatch(/eskaler/i);
}
/** Kort med rubriken (Card är en section med en h2). */
const card = (page: Page | Locator, title: string | RegExp) => page.locator("section").filter({ has: page.locator("h2", { hasText: title }) });
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" });
const group = (scope: Page | Locator, name: string) => scope.getByRole("group", { name, exact: true });
const aiGroup = (page: Page, field: string) => page.getByRole("group", { name: `AI-förslag för ${field}`, exact: true });
/** Aktuell sökväg med query (prototypen: hash-URL, appen: riktig URL). */
function currentPath(page: Page, info: TestInfo): string {
  const u = new URL(page.url());
  return isDemo(info) ? decodeURIComponent(u.hash.replace(/^#/, "")) : `${u.pathname}${u.search}`;
}
/** Navigera utan att nollställa prototypen. */
async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, to);
  else await page.goto(to);
}
/** Byt testperson utan att nollställa det man gjort (prototypen: rollvalet sparas och sidan laddas om – loggen spelas upp igen). */
async function switchUser(page: Page, info: TestInfo, as: { userId: string; role: string }, to: string) {
  if (isDemo(info)) {
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), as);
    await page.evaluate((p) => { window.location.hash = p; }, to);
    await page.reload();
  } else {
    const res = await page.request.post("/api/dev-session", { data: as });
    expect(res.ok()).toBeTruthy();
    await page.goto(to);
  }
}
/** Registrera närvaro för en rad och vänta tills valet syns som sparat. */
async function registerRow(row: Locator, label: string) {
  await btn(row, label).click();
  await expect(btn(row, label)).toHaveAttribute("aria-pressed", "true");
}
/** Registrera förra veckans sex tillfällen (som i det gamla testet). */
async function registerWeek4(page: Page) {
  const rows = page.getByTestId("narvaro-rad");
  await expect(rows).toHaveCount(6);
  await btn(rows.nth(0), "Giltig frånvaro").click();
  await btn(page.getByRole("group", { name: "Orsak till giltig frånvaro" }), "Sjukdom").click();
  await expect(rows.nth(0)).toContainText("Giltig frånvaro · Sjukdom");
  await registerRow(rows.nth(1), "Ogiltig frånvaro");
  for (let i = 2; i < 6; i++) await registerRow(rows.nth(i), i === 2 ? "Sen" : "Närvarande");
}

// ================================================================ Min vecka
test("Min vecka: nyckeltal, månadsbedömningar, kalender och länk till närvaron", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", COACH);
  await expect(page.getByRole("heading", { level: 1, name: "Min vecka" })).toBeVisible();
  await noBadText(page);
  await expect(main(page)).toContainText(/Närvaro att registrera\s*6\s*Kräver åtgärd/i);
  await expect(page.getByText("Sista dag ej fastställd – förslag 5:e arbetsdagen").first()).toBeVisible();
  const text = await main(page).innerText();
  expect(text).not.toMatch(/deadline/i);
  expect(text).not.toMatch(/\b1 (godkända|granskade|tillfällen|olästa)\b/);
  await expect(main(page)).toContainText(/Månads\u00adbedömningar januari\s*4 av 15/i);
  await expect(page.getByRole("link", { name: "Bedöm", exact: true })).toHaveCount(5);
  await expect(card(page, "Meddelanden från kommunen").getByText("Inga olästa meddelanden")).toBeVisible();

  await page.setViewportSize({ width: 400, height: 860 });
  const bb = await page.getByRole("link", { name: "Bedöm", exact: true }).first().boundingBox();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(bb && bb.x >= 0 && bb.x + bb.width <= 400).toBeTruthy();
  expect(over).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(page.getByTestId("kalender-dag")).toHaveCount(5);
  await expect(page.getByRole("link", { name: "Granska" })).toHaveCount(1);
  await expect(card(page, "AI-utkast att granska")).toContainText("Mehmet Kaya");
  await expect(page.getByRole("link", { name: "Öppna notiser" })).toBeVisible();
  await expect(card(page, "Egna flaggor")).toContainText("Fastnat i fas 1");
  await expect(card(page, "Egna flaggor")).toContainText("Upprepad ogiltig frånvaro");
  await expect(card(page, "Påminnelser")).toContainText("Ingen progression 3 veckor i rad: ingen avstämning dokumenterad (v. 4 2027).");
  await expect(card(page, "Rapporter som förfaller")).toContainText("Månadsrapporter januari 2027: 14 st");
  await expect(card(page, "Rapporter som förfaller")).toContainText("Väntar på din bedömning: 11 · Godkända, ska levereras: 3");
  await page.getByRole("link", { name: "Registrera närvaro för vecka 4" }).click();
  await expect.poll(() => currentPath(page, info)).toBe("/narvaro?vecka=forra");
  await expect(page.getByRole("heading", { level: 1, name: "Närvaro" })).toBeVisible();
  expect(errors).toEqual([]);
});

// ================================================================ Närvaro
test("Närvaro: snabbregistrering vecka 4 publicerar veckorapporterna automatiskt", async ({ page }, info) => {
  const errors = await open(page, info, "/narvaro?vecka=forra", COACH);
  await noBadText(page);
  await expect(page.getByTestId("narvaro-raknare")).toContainText("6 tillfällen kvar – senast måndag 10.00");
  const rows = page.getByTestId("narvaro-rad");
  await expect(rows).toHaveCount(6);
  // Nadia onsdag: giltig frånvaro kräver orsak
  await btn(rows.nth(0), "Giltig frånvaro").click();
  await expect(page.getByRole("group", { name: "Orsak till giltig frånvaro" })).toBeVisible();
  await btn(page.getByRole("group", { name: "Orsak till giltig frånvaro" }), "Sjukdom").click();
  await expect(rows.nth(0)).toContainText("Giltig frånvaro · Sjukdom");
  // Elif onsdag: ogiltig frånvaro
  await registerRow(rows.nth(1), "Ogiltig frånvaro");
  await expect(rows.nth(1)).toContainText("Frånvaronotis samma dag: tillval som inte är fastställt");
  for (let i = 2; i < 6; i++) await registerRow(rows.nth(i), i === 2 ? "Sen" : "Närvarande");
  await expect(page.getByTestId("narvaro-raknare")).toContainText("Alla passerade tillfällen vecka 4 är registrerade");
  const reports = card(page, "Veckorapporter – vecka 4");
  await expect(reports).toContainText(/Maria Ekdahl[\s\S]*?Publicerad 1 feb/);
  await expect(reports).toContainText(/Linda Karlsson[\s\S]*?Publicerad 1 feb/);
  await expect(page.getByText("Veckorapporten för v. 4 2027 till Linda Karlsson publicerades automatiskt.")).toBeVisible();

  // Efter omladdning finns publiceringen kvar (prototypen spelar upp loggen igen)
  await page.reload();
  await expect(page.getByTestId("narvaro-raknare")).toContainText("Alla passerade tillfällen vecka 4 är registrerade");
  await expect(card(page, "Veckorapporter – vecka 4")).toContainText(/Maria Ekdahl[\s\S]*?Publicerad 1 feb/);
  await expect(page.getByRole("link", { name: "Se veckorapporten" }).first()).toBeVisible();
  if (isDemo(info)) await expect(btn(page, "Se veckorapporten från kundens håll")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Närvaro: handledaren ser bara sina teamärenden", async ({ page }, info) => {
  const errors = await open(page, info, "/narvaro?vecka=forra", HANDLEDARE);
  await expect(page.getByText("Handledare – dina teamärenden")).toBeVisible();
  await expect(page.getByText("Du ser tillfällen för de 63 ärenden där du ingår i teamet.")).toBeVisible();
  await expect(page.getByTestId("narvaro-raknare")).toContainText("2 tillfällen kvar – senast måndag 10.00");
  await btn(page, "Alla (81)").click();
  await expect(page.getByTestId("narvaro-rad")).toHaveCount(81);
  const shown = (await page.getByTestId("arendenummer").allInnerTexts()).map((x) => x.trim());
  expect(shown.length).toBe(81);
  expect(shown.every((n) => PETRA_CASES.has(n))).toBeTruthy();
  expect(shown).not.toContain("BOT-26-0120"); // skyddade personuppgifter
  expect(shown).not.toContain("BOT-27-0003"); // Amiras ärende utan Petra i teamet
  await page.getByRole("button", { name: /^Den här veckan/ }).click();
  await expect(page.getByRole("button", { name: /^Den här veckan/ })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "Veckorapporter – vecka 5")).toContainText("Veckorapporten för vecka 5 skapas måndag 8 februari");
  await expect(page.getByText("Min vecka")).toHaveCount(0); // ingen brödsmula till coachens startsida
  expect(errors).toEqual([]);
});

test("Min vecka visar att vecka 4 är klar när närvaron är registrerad", async ({ page }, info) => {
  const errors = await open(page, info, "/narvaro?vecka=forra", COACH);
  await registerWeek4(page);
  await go(page, info, "/min-vecka");
  await expect(page.getByText("Allt är registrerat för vecka 4")).toBeVisible();
  await expect(main(page)).toContainText(/Närvaro att registrera\s*0/i);
  await noBadText(page);
  expect(errors).toEqual([]);
});

// ================================================================ Veckoavstämning
test("Veckoavstämning manuellt: röd status kräver avvikelse (Yusuf)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.yusuf}`, COACH);
  await noBadText(page);
  await expect(page.getByText(/Påminnelse: ingen dokumenterad progression/)).toBeVisible();
  await expect(page.getByText(/Dokumentationstid: \d+ min/).first()).toBeVisible();
  await btn(group(page, "Veckomål uppnått"), "Nej").click();
  await page.getByRole("group", { name: "Förslag på veckomål" }).getByRole("button").first().click();
  await expect(page.locator("#ci-nextgoal")).toHaveValue("Skicka tre ansökningar");
  await btn(group(page, "Antal arbetsgivarkontakter"), "0").click();
  await group(page, "Samlad status").getByRole("button", { name: /Röd/ }).click();
  await expect(page.locator("#dev-desc")).toBeVisible();
  for (const id of ["#dev-desc", "#dev-action", "#dev-owner", "#dev-follow"]) await expect(page.locator(id)).toHaveValue("");
  await expect(page.locator('#dev-cust button[aria-pressed="true"]')).toHaveCount(0);
  await page.locator("#ci-note").fill("Uteblev två onsdagar. Vi har gått igenom schemat och bokat uppföljning med handläggaren.");
  await btn(page, "Godkänn avstämningen").click();
  await expect(page.getByText("Stopp: röd status kräver en avvikelse")).toBeVisible();
  for (const t of ["Beskriv avvikelsen.", "Skriv vilken åtgärd som ska göras.", "Välj ansvarig.", "Välj datum för uppföljning."]) await expect(page.getByText(t)).toBeVisible();
  // Ingen avstämning sparades: formuläret står kvar
  await expect(page.getByRole("heading", { level: 1, name: "Veckoavstämning" })).toBeVisible();
  await btn(page, "Använd förslaget från flaggan").click();
  await expect(page.locator("#dev-desc")).toHaveValue(/Upprepad ogiltig frånvaro/);
  expect((await page.locator("#dev-action").inputValue()).length).toBeGreaterThan(10);
  await page.locator("#dev-desc").fill("Upprepad ogiltig frånvaro två onsdagar i rad");
  await page.selectOption("#dev-owner", "u-amira");
  await page.getByRole("button", { name: /^Om en vecka/ }).click();
  await expect(page.locator("#dev-follow")).toHaveValue("2027-02-08");
  await btn(group(page, "Behöver beslut från kommunen"), "Ja").click();
  await expect(page.getByText("Stopp: röd status kräver en avvikelse")).toHaveCount(0);
  await btn(page, "Godkänn avstämningen").click();

  await expect(page.getByRole("heading", { level: 1, name: "Avstämningen är godkänd" })).toBeVisible();
  await expect(main(page)).toContainText(/Samlad status\s*Röd/i);
  await expect(main(page)).toContainText(/Dokumentationstid\s*\d+ min \d\d s/i);
  const dev = card(page, "Avvikelse skapad");
  await expect(dev).toContainText(/Ansvarig\s*Amira Haddad/);
  await expect(dev).toContainText(/Uppföljning\s*8 feb 2027/);
  await expect(dev).toContainText(/Beslut från kommunen\s*Behövs/);
  await expect(page.getByText(/har fått en uppgift i portalen/)).toBeVisible();
  await btn(page, "Kalla kommunen till uppföljning").click();
  const sent = page.getByText("Mötesförfrågan är skickad", { exact: true });
  await expect(sent).toBeVisible();
  const notice = page.getByText(/^Föreslagen tid:/);
  await expect(notice).toContainText("Föreslagen tid: onsdag 3 feb 2027 kl. 10.00");
  await expect(notice).toContainText("”Du har ett nytt meddelande om ärende BOT-26-0148 – logga in för att läsa.”");
  expect(await notice.innerText()).not.toMatch(/Yusuf|Abdi/);
  if (isDemo(info)) await expect(btn(page, "Se mötesförfrågan som kommunen")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Veckoavstämning med AI-utkast: varje förslag bedöms och loggas (Mehmet)", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", COACH);
  const granska = page.getByRole("link", { name: "Granska" });
  const href = (await granska.getAttribute("href")) ?? "";
  expect(href).toContain(`/avstamning/${SC.mehmet}?avstamning=`);
  await granska.click();
  await expect(page.getByRole("heading", { level: 1, name: "Veckoavstämning" })).toBeVisible();
  await noBadText(page);
  await expect(page.getByRole("group", { name: /^AI-förslag för / })).toHaveCount(7);
  expect(await page.getByText(/^Tidpunkt \d\d:\d\d$/).count()).toBeGreaterThanOrEqual(7);
  await expect(group(page, "Samlad status").locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByText("Ljudet är raderat")).toBeVisible();
  await btn(page, "Visa råtranskriptet").click();
  await expect(page.getByTestId("ratranskript")).toBeVisible();
  await expect(page.getByText("Visningen loggas i revisionsloggen. Rapporter byggs aldrig från råtranskriptet.")).toBeVisible();
  await group(page, "Samlad status").getByRole("button", { name: /Grön/ }).click();
  await btn(page, "Godkänn avstämningen").click();
  await expect(page.getByText(/Ta ställning till alla AI-förslag/)).toBeVisible();
  for (const f of ["veckomål uppnått", "fas", "arbetsgivarkontakter", "anteckning"]) await btn(aiGroup(page, f), "Acceptera").click();
  // Ändra men behåll värdet -> loggas som accepterat, och det syns
  await btn(aiGroup(page, "genomförda aktiviteter"), "Ändra").click();
  await expect(aiGroup(page, "genomförda aktiviteter").getByText("Oförändrat – loggas som accepterat")).toBeVisible();
  await btn(aiGroup(page, "nytt veckomål"), "Ändra").click();
  await expect(page.locator("#ci-nextgoal")).toBeFocused();
  await page.locator("#ci-nextgoal").fill("Köra hela distributionsrundan själv på tisdag");
  await expect(aiGroup(page, "nytt veckomål").getByText("Ändrat – loggas som ändrat")).toBeVisible();
  await btn(aiGroup(page, "hinder"), "Avvisa").click();
  await btn(page, "Godkänn avstämningen").click();

  await expect(page.getByRole("heading", { level: 1, name: "Avstämningen är godkänd" })).toBeVisible();
  await expect(main(page)).toContainText(/AI-förslag\s*5 \/ 1 \/ 1/i);
  await expect(main(page)).toContainText(/Samlad status\s*Grön\s*Fas 3 · Yrkesspecifika moment/i);
  const log = card(page, "Loggade AI-beslut");
  await expect(log.getByText("Du valde Ändra men behöll förslaget")).toBeVisible();
  await expect(log).toContainText(/Veckomål uppnått\s*Förslag: Delvis\s*Accepterat/);
  await expect(log).toContainText(/Nytt veckomål\s*Förslag: .+ · Sparat: Köra hela distributionsrundan själv på tisdag\s*Ändrat/);
  await expect(log).toContainText(/Hinder\s*Förslag: Språk\s*Avvisat/);
  await expect(page.getByText("Råtranskriptet raderades vid godkännandet", { exact: true })).toBeVisible();
  await expect(page.getByText("Ljudet raderades direkt efter transkriberingen", { exact: true })).toBeVisible();
  // Den godkända avstämningen: avvisat förslag är tomt och det ändrade värdet sparat
  await go(page, info, "/min-vecka");
  await go(page, info, href.replace(/^#/, ""));
  await expect(page.getByText(/^Godkänd 1 feb kl\. \d\d\.\d\d av Amira Haddad$/)).toBeVisible();
  await expect(main(page)).toContainText(/Nytt veckomål\s*Köra hela distributionsrundan själv på tisdag/);
  await expect(main(page)).toContainText(/Hinder\s*Inga/);
  await expect(main(page)).toContainText(/Fas\s*Fas 3 · Yrkesspecifika moment/);
  expect(errors).toEqual([]);
});

test("Veckoavstämning: AI-förslag från inklistrade anteckningar (Hodan)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.hodan}`, COACH);
  await btn(page, "Med AI-stöd").click();
  await btn(page, "Inklistrade anteckningar").click();
  await page.locator("#ai-notes").fill("Deltagaren var sjuk hela veckan och deltog inte i något. Ingen arbetsgivarkontakt.");
  await btn(page, "Tolka anteckningarna").click();
  await aiGroup(page, "veckomål uppnått").waitFor({ timeout: 5000 });
  await expect(aiGroup(page, "veckomål uppnått").getByTestId("ai-forslag-varde")).toHaveText("Nej");
  await expect(aiGroup(page, "veckomål uppnått")).toContainText("sjuk hela veckan");
  await expect(aiGroup(page, "arbetsgivarkontakter").getByTestId("ai-forslag-varde")).toHaveText(/^0\b/);
  await expect(aiGroup(page, "arbetsgivarkontakter")).toContainText("Ingen arbetsgivarkontakt");
  for (const f of ["nytt veckomål", "fas", "hinder"]) {
    await expect(aiGroup(page, f)).toContainText("Framgår inte");
    await expect(btn(aiGroup(page, f), "Acceptera")).toHaveCount(0);
  }
  await noBadText(page);
  for (const f of ["veckomål uppnått", "genomförda aktiviteter", "arbetsgivarkontakter", "anteckning"]) await btn(aiGroup(page, f), "Acceptera").click();
  await page.locator("#ci-nextgoal").fill("Komma tillbaka och gå igenom ansökningarna");
  await group(page, "Samlad status").getByRole("button", { name: /Gul/ }).click();
  await btn(page, "Godkänn avstämningen").click();
  await expect(page.getByRole("heading", { level: 1, name: "Avstämningen är godkänd" })).toBeVisible();
  // Bara förslag med belägg loggas som AI-beslut – och de sparade värdena är förslagen (Nej, 0)
  await expect(main(page)).toContainText(/AI-förslag\s*4 \/ 0 \/ 0/i);
  const log = card(page, "Loggade AI-beslut");
  await expect(log.locator("div.font-bold")).toHaveText(["Veckomål uppnått", "Genomförda aktiviteter", "Arbetsgivarkontakter", "Anteckning"]);
  await expect(log).toContainText(/Veckomål uppnått\s*Förslag: Nej\s*Accepterat/);
  await expect(log).toContainText(/Arbetsgivarkontakter\s*Förslag: 0\s*Accepterat/);
  await expect(card(page, "Dataminimering")).toContainText("Inget ljud användes");
  expect(errors).toEqual([]);
});

test("Veckoavstämning: samtycke och simulerad inspelning (Elif)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.elif}`, COACH);
  await btn(page, "Med AI-stöd").click();
  await expect(page.getByText("Samtycke saknas")).toBeVisible();
  await expect(btn(page, "Deltagaren säger ja")).toBeDisabled();
  await page.locator("#cons-informed").check();
  await btn(page, "Deltagaren säger ja").click();
  await expect(page.getByText("Samtycke registrerat 1 feb 2027")).toBeVisible();
  await expect(page.getByText(/^Version v1\.0 \(2026-10-01\), informerad av Amira Haddad på [a-zåäö ]+\.$/)).toBeVisible();
  await btn(page, "Starta inspelning").click();
  await expect(page.getByRole("status").filter({ hasText: /^Spelar in \d\d:\d\d$/ })).toBeVisible();
  await btn(page, "Pausa").click();
  await expect(page.getByText(/Inspelningen är pausad/)).toBeVisible();
  await btn(page, "Fortsätt").click();
  await btn(page, "Stoppa och tolka").click();
  await expect(page.getByText("Transkriberar …")).toBeVisible();
  await page.getByText("Ljudet är raderat").waitFor({ timeout: 8000 });
  await expect(page.getByRole("group", { name: /^AI-förslag för / })).toHaveCount(7);
  // AI-körningen är loggad och ljudet raderat direkt
  await expect(page.getByText("Berget AI (test) · KB-Whisper + öppen språkmodell")).toBeVisible();
  await expect(page.getByText(/^måndag 1 feb 2027 kl\. \d\d\.\d\d – direkt efter transkriberingen$/)).toBeVisible();
  for (const f of ["veckomål uppnått", "nytt veckomål", "fas", "genomförda aktiviteter", "arbetsgivarkontakter", "hinder", "anteckning"]) await btn(aiGroup(page, f), "Acceptera").click();
  await group(page, "Samlad status").getByRole("button", { name: /Gul/ }).click();
  await btn(page, "Godkänn avstämningen").click();
  await expect(page.getByRole("heading", { level: 1, name: "Avstämningen är godkänd" })).toBeVisible();
  await expect(main(page)).toContainText(/AI-förslag\s*7 \/ 0 \/ 0/i);
  await expect(main(page)).toContainText(/Samlad status\s*Gul/i);
  await expect(page.getByText("Ljudet raderades direkt efter transkriberingen", { exact: true })).toBeVisible();
  await expect(page.getByText("Råtranskriptet raderades vid godkännandet", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Veckoavstämning: nekat samtycke och andras ärenden", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.yusuf}`, COACH);
  await btn(page, "Med AI-stöd").click();
  await expect(page.getByText(/Deltagaren sa nej/)).toBeVisible();
  await expect(btn(page, "Starta inspelning")).toHaveCount(0);
  await go(page, info, `/avstamning/${SC.skyddad}`);
  await expect(page.getByText("Inte ditt ärende")).toBeVisible();
  expect(errors).toEqual([]);
});

// ================================================================ Månadsbedömning
test("Månadsbedömning januari: nivåer är tomma tills coachen väljer (Nadia)", async ({ page }, info) => {
  const errors = await open(page, info, `/manadsbedomning/${SC.nadia}?manad=2027-01`, COACH);
  await expect(page.getByRole("heading", { level: 1, name: "Månadsbedömning januari 2027" })).toBeVisible();
  await noBadText(page);
  const table = page.getByTestId("progressionsomraden");
  const selects = table.locator("select");
  await expect(selects).toHaveCount(10);
  expect(await selects.evaluateAll((els) => els.every((s) => (s as HTMLSelectElement).value === ""))).toBeTruthy();
  await expect(page.getByText(/Förslag:\s\d\s–\s/).first()).toBeVisible();
  const rows = table.locator("tbody tr");
  for (let i = 0; i < 10; i++) {
    const t = await rows.nth(i).innerText();
    if (!/Framgår inte/.test(t)) continue;
    expect(t).not.toMatch(/Förslag:\s\d/);
    await expect(btn(rows.nth(i), "Använd utkastet")).toHaveCount(0);
  }
  const lvl = await page.getByTestId("ai-nivaforslag").first().boundingBox();
  expect(lvl && lvl.height < 50).toBeTruthy();
  await selects.nth(0).selectOption("2");
  await btn(page, "Godkänn bedömningen").click();
  await expect(page.getByText(/Skriv en konkret observation/).first()).toBeVisible();
  await expect(btn(page, "Godkänn bedömningen")).toBeVisible(); // fortfarande utkast
  const levels = [2, 1, 2, 1, 2, 3, 2, 2, 1, 0];
  for (let i = 0; i < 10; i++) {
    await selects.nth(i).selectOption(String(levels[i]));
    if (levels[i] >= 1) {
      const use = btn(rows.nth(i), "Använd utkastet");
      if (await use.count()) await use.click();
      else await rows.nth(i).locator("textarea").fill("Har tagit egna initiativ till nya arbetsuppgifter på praktiken.");
    }
  }
  await group(page, "Samlad status").getByRole("button", { name: /Grön/ }).click();
  await page.locator("#cm-summary").fill("Nadia har tagit tydliga steg under januari och klarar allt fler moment på praktiken.");
  await btn(page, "Godkänn bedömningen").click();
  await expect(page.getByText("Bedömningen är godkänd", { exact: true })).toBeVisible();
  await expect(main(page)).toContainText("Rapportens status: granskad av coach.");
  await expect(main(page)).toContainText(/Förmåga att förstå och följa yrkesrelaterade instruktioner\s*3 – Uppnått delmål/);
  await expect(main(page)).toContainText(/Närvaro, punktlighet och rutiner\s*2 – Tydlig\s*Närvarande vid 9 av 9/);
  await expect(main(page)).toContainText("Grön – enligt plan");
  await expect(page.getByRole("link", { name: "Förhandsgranska månadsrapporten" })).toBeVisible();
  expect(errors).toEqual([]);
});

// ================================================================ Kartläggning
test("Kartläggning: yrkesspår krävs och diagnoser stoppas (Amal)", async ({ page }, info) => {
  const errors = await open(page, info, `/kartlaggning/${SC.amal}`, COACH);
  await noBadText(page);
  await expect(page.getByText(/Fastnat i fas 1/)).toBeVisible();
  await btn(page, "Godkänn kartläggningen").click();
  await expect(page.getByText("Välj yrkesspår.")).toBeVisible();
  await page.locator("#ia-adapt").fill("Har diagnosen ADHD");
  await expect(page.getByText("Det ser ut som en diagnos")).toBeVisible();
  await page.locator("#ia-adapt").fill("Behöver tydlig struktur och schema i förväg");
  await btn(group(page, "Valt yrkesspår"), "Individuellt spår").click();
  await btn(page, "Godkänn kartläggningen").click();
  await expect(page.getByText("Kartläggningen är godkänd", { exact: true })).toBeVisible();
  await expect(main(page)).toContainText("L Övrigt · Individuellt spår");
  await expect(main(page)).toContainText("Godkänd 1 feb 2027");
  await expect(btn(page, "Spara ändringar")).toBeVisible();
  expect(errors).toEqual([]);
});

// ================================================================ Händelse och avslut
test("Händelse och avslut: bonusunderlag, verifierat resultat, slutrapport och puls (Hodan)", async ({ page }, info) => {
  const errors = await open(page, info, `/handelse/${SC.hodan}`, COACH);
  await noBadText(page);
  const events = card(page, "Registrerade händelser").locator("tbody tr");
  await expect(events).toHaveCount(2);
  await btn(group(page, "Typ av händelse"), "Arbete påbörjat").click();
  await expect(main(page).getByText("Möjligt bonusunderlag", { exact: true })).toBeVisible();
  await expect(page.getByText("Avstängd – modellen ej fastställd")).toBeVisible();
  await btn(page, "Tumba Städ & Fastighet AB").click();
  await expect(page.locator("#ev-actor")).toHaveValue("Tumba Städ & Fastighet AB");
  await btn(group(page, "Verifiering"), "Anställningsbevis").click();
  await btn(page, "Bifoga fil").click();
  await expect(page.getByText("anstallningsbevis.pdf")).toBeVisible();
  await btn(page, "Registrera händelsen").click();
  await expect(events).toHaveCount(3);
  const row = events.filter({ hasText: "Arbete påbörjat" });
  await expect(row).toContainText("Tumba Städ & Fastighet AB");
  await expect(row).toContainText("Anställningsbevis");
  await expect(row).toContainText("Möjligt");
  await expect(card(page, "Bonus")).toContainText("1 händelse i ärendet är markerad som möjligt bonusunderlag.");

  await btn(group(page, "Välj uppgift"), "Avsluta insatsen").click();
  await expect(page.getByText("Välj avslutsorsak för att se hur avslutet räknas.")).toBeVisible();
  await btn(group(page, "Avslutsorsak"), "Arbete").click();
  await expect(page.getByText("Resultat – preliminärt")).toBeVisible();
  await btn(group(page, "Finns verifiering"), "Ja, registrera nu").click();
  await btn(group(page, "Typ av verifiering"), "Anställningsbevis").click();
  await expect(page.getByText("Resultat – verifierat")).toBeVisible();
  await btn(card(page, "Avslut"), "Avsluta insatsen").click();
  await btn(page.getByRole("dialog"), "Avsluta insatsen").click();
  await page.getByText("Insatsen är avslutad").first().waitFor({ timeout: 3000 });
  await expect(main(page)).toContainText("Arbete · 1 feb 2027. Resultatklass: resultat (verifierat).");
  await expect(page.getByRole("link", { name: "Öppna slutrapportutkastet" })).toBeVisible();
  await expect(card(page, "Pulsmätning vid avslut")).toContainText(/Skickad 1 feb kl\. \d\d\.\d\d via SMS\. Länken gäller till 8 feb 2027\./);
  await expect(card(page, "Utkast till slutrapport")).toContainText("Förslag 5 arbetsdagar – ej fastställt");
  await expect(group(page, "Välj uppgift")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ================================================================ Vyer utan ärende
test("Vyer utan ärende visar coachens deltagarlista", async ({ page }, info) => {
  const errors = await open(page, info, "/avstamning", COACH);
  for (const p of ["/avstamning", "/manadsbedomning", "/kartlaggning", "/handelse", "/handelse?lage=avslut"]) {
    await go(page, info, p);
    await expect(card(page, "Välj deltagare")).toBeVisible();
    await expect(card(page, "Välj deltagare").getByRole("listitem").or(card(page, "Välj deltagare").locator("a")).first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Avsluta insatsen" })).toBeVisible();
  await go(page, info, "/manadsbedomning");
  await expect(page.getByRole("heading", { level: 1, name: "Månadsbedömning januari 2027" })).toBeVisible();
  await expect(card(page, "Välj deltagare")).toContainText("Hodan Farah");
  expect(errors).toEqual([]);
});

// ================================================================ Meddelande från kommunen
test("Meddelande från kommunen syns i Min vecka och räknas som läst efteråt", async ({ page }, info) => {
  const errors = await open(page, info, `/portal/deltagare/${SC.nadia}?flik=meddelanden`, MARIA);
  // Meddelandet skrivs i kommunportalen (området kommun).
  const field = page.getByLabel("Nytt meddelande");
  await expect(field).toBeVisible({ timeout: 8000 });
  await field.fill("Tiden passar bra. Vi ses på torsdag.");
  await page.getByRole("button", { name: "Skicka meddelandet" }).click();
  await expect(page.getByText("Tiden passar bra. Vi ses på torsdag.").first()).toBeVisible();
  await switchUser(page, info, COACH, "/min-vecka");
  const msgCard = card(page, "Meddelanden från kommunen");
  await expect(msgCard).toContainText("Tiden passar bra");
  await expect(msgCard).toContainText("BOT-26-0143");
  await expect(msgCard).toContainText("Från Maria Ekdahl");
  await btn(msgCard, "Läs och svara").click();
  await expect.poll(() => currentPath(page, info)).toBe(`/arenden/${SC.nadia}?flik=meddelanden`);
  await go(page, info, "/min-vecka");
  await expect(card(page, "Meddelanden från kommunen").getByText("Inga olästa meddelanden")).toBeVisible();
  await noBadText(page);
  expect(errors).toEqual([]);
});
