// Coachens flöden: Min vecka, närvaro, veckoavstämning (manuellt, AI-utkast, anteckningar, inspelning med samtycke),
// månadsbedömning, kartläggning, händelse och avslut. Port av prototyp/tools/test-coach.mjs – samma steg och värden,
// men allt läses från skärmen. Varje test öppnar en nollställd prototyp (projektet "demo"); mot appen körs samma steg.
// Id:n är testdatats (prototyp/tools/data-samples.json -> script_tags).
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { isDemo, loaded, open, switchPersona } from "./helpers";

// Falsk mikrofon för inspelningen i appen (Chromium på localhost). Påverkar inga andra tester.
test.use({
  launchOptions: {
    executablePath: fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["microphone"],
});

const COACH = { userId: "u-amira", role: "coach" };
/** Petra Ek – var handledare, är coach sedan rollen handledare togs bort (Karims beslut 2026-10-09). Inga egna ärenden. */
const PETRA = { userId: "u-petra", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const KARIN = { userId: "u-karin", role: "chef" };
const SC = { nadia: "case-260143", yusuf: "case-260148", elif: "case-270003", hodan: "case-260119", mehmet: "case-260130", amal: "case-270012", skyddad: "case-260120" };

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
    await switchPersona(page, as);
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
  // "Förslag/ej fastställt" står en gång på sidan: brickan i månadsavsnittet (förklaringen som verktygstips), inte i tre till rader.
  await expect(page.getByText(/^Förslag: senast /).first()).toBeVisible();
  await expect(page.getByTitle("Sista dag ej fastställd – förslag 5:e arbetsdagen")).toHaveCount(1);
  await expect(page.getByText("Förslag – ej fastställt")).toHaveCount(0);
  const text = await main(page).innerText();
  expect(text).not.toMatch(/deadline/i);
  expect(text).not.toMatch(/\b1 (godkända|granskade|tillfällen|olästa)\b/);
  await expect(main(page)).toContainText(/Månads\u00adbedömningar januari\s*4 av 15/i);
  await expect(page.getByRole("link", { name: "Bedöm", exact: true })).toHaveCount(5);
  // Marias olästa meddelande från 1 februari 08.15 syns (samma räkning som deltagarkortets olästa) – överst på sidan.
  const msgs = card(page, "Meddelanden från kommunen");
  await expect(msgs).toContainText("Kan vi ses på ett uppföljningsmöte vecka 6?");
  await expect(msgs).toContainText("Från Maria Ekdahl");
  await expect(msgs.getByRole("link", { name: /Nadia Warsame/ })).toHaveAttribute("href", isDemo(info) ? `#/arenden/${SC.nadia}` : `/arenden/${SC.nadia}`);

  await page.setViewportSize({ width: 400, height: 860 });
  const bb = await page.getByRole("link", { name: "Bedöm", exact: true }).first().boundingBox();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(bb && bb.x >= 0 && bb.x + bb.width <= 400).toBeTruthy();
  expect(over).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(page.getByTestId("kalender-dag")).toHaveCount(5);
  await expect(page.getByRole("link", { name: "Granska" })).toHaveCount(1);
  await expect(card(page, "Mötesrapporter att granska")).toContainText("Mehmet Kaya");
  await expect(page.getByRole("link", { name: "Öppna notiser" })).toBeVisible();
  await expect(card(page, "Egna flaggor")).toContainText("Fastnat i fas 1");
  await expect(card(page, "Egna flaggor")).toContainText("Upprepad ogiltig frånvaro");
  await expect(card(page, "Påminnelser")).toContainText("Ingen progression 3 veckor i rad: inget möte dokumenterat (v. 4 2027).");
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

test("Närvaro: rollen handledare finns inte – Petra (coach utan egna ärenden) ser coachens vy utan teamärenden", async ({ page }, info) => {
  const errors = await open(page, info, "/narvaro?vecka=forra", PETRA);
  await expect(main(page)).toContainText("Snabbregistrering");
  await expect(main(page)).not.toContainText("Handledare – dina teamärenden");
  await expect(main(page)).not.toContainText("där du ingår i teamet");
  await expect(page.getByTestId("narvaro-rad")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Närvaro: 'Markera alla som närvarande' per dag – bekräftelse med namnen, ett kommando, enskilda rättas efteråt och chefen ser loggraden", async ({ page }, info) => {
  const errors = await open(page, info, "/narvaro?vecka=forra", COACH);
  await expect(page.getByTestId("narvaro-raknare")).toContainText("6 tillfällen kvar – senast måndag 10.00");
  // Smal skärm (390 px): knappen är minst 44 px hög och sidan skrollar inte i sidled.
  await page.setViewportSize({ width: 390, height: 844 });
  const wedButton = page.getByRole("button", { name: "Markera alla som närvarande (3)" }).first();
  await expect(wedButton).toBeVisible();
  expect((await wedButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Appen: ett kommando för hela dagen (inte ett per tillfälle).
  const commands: string[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/rpc")) return;
    try {
      const b = JSON.parse(r.postData() || "{}") as { kind?: string; key?: string };
      if (b.kind === "command" && b.key) commands.push(b.key);
    } catch {
      /* ignoreras */
    }
  });
  // Onsdag: bekräftelsen räknar upp de tre och vad som inte ändras.
  await page.getByRole("button", { name: "Markera alla som närvarande (3)" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Markera 3 som närvarande?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Närvarande registreras ons 27 jan för:");
  await expect(dialog).toContainText("Nadia Warsame (BOT-26-0143)");
  await expect(dialog).toContainText("Elif Yilmaz (BOT-27-0003)");
  await expect(dialog).toContainText("Amal Hassan (BOT-27-0012)");
  await expect(dialog).toContainText("Tillfällen som redan är registrerade ändras inte.");
  await dialog.getByRole("button", { name: "Markera 3 som närvarande" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("3 tillfällen markerade som närvarande.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "3 av 3 tillfällen ons 27 jan markerade som närvarande" })).toBeVisible();
  await expect(page.getByTestId("narvaro-raknare")).toContainText("3 tillfällen kvar – senast måndag 10.00");
  // De tre raderna står kvar med sina knappar: Närvarande valt – rättas med samma knappar som förut.
  const rows = page.getByTestId("narvaro-rad");
  await expect(rows).toHaveCount(6);
  for (let i = 0; i < 3; i++) await expect(btn(rows.nth(i), "Närvarande")).toHaveAttribute("aria-pressed", "true");
  if (!isDemo(info)) expect(commands).toEqual(["coach.attendanceSetAll"]);
  // Torsdag: allt registrerat – veckorapporterna publiceras som vid enskild registrering.
  await page.getByRole("button", { name: "Markera alla som närvarande (3)" }).click();
  await page.getByRole("dialog", { name: "Markera 3 som närvarande?" }).getByRole("button", { name: "Markera 3 som närvarande" }).click();
  await expect(page.getByTestId("narvaro-raknare")).toContainText("Alla passerade tillfällen vecka 4 är registrerade");
  await expect(page.getByText("Veckorapporten för v. 4 2027 till Linda Karlsson publicerades automatiskt.")).toBeVisible();
  await expect(page.getByText("Veckorapporten för v. 4 2027 till Maria Ekdahl publicerades automatiskt.")).toBeVisible();
  const reports = card(page, "Veckorapporter – vecka 4");
  await expect(reports).toContainText(/Maria Ekdahl[\s\S]*?Publicerad 1 feb/);
  await expect(reports).toContainText(/Linda Karlsson[\s\S]*?Publicerad 1 feb/);
  await expect(page.getByRole("button", { name: /^Markera alla som närvarande/ })).toHaveCount(0);
  // Rätta en enskild: Elif onsdag blir ogiltig frånvaro med radens knappar.
  const elif = rows.filter({ hasText: "BOT-27-0003" }).first();
  await registerRow(elif, "Ogiltig frånvaro");
  await expect(elif).toContainText("Ogiltig frånvaro");
  await expect(btn(rows.nth(0), "Närvarande")).toHaveAttribute("aria-pressed", "true");
  // Omladdning: allt kvar (prototypen spelar upp loggen igen).
  await page.reload();
  if (!isDemo(info)) await loaded(page);
  await expect(page.getByTestId("narvaro-raknare")).toContainText("Alla passerade tillfällen vecka 4 är registrerade");
  await page.getByRole("button", { name: /^Alla \(/ }).click();
  await expect(page.getByTestId("narvaro-rad").filter({ hasText: "BOT-27-0003" }).filter({ hasText: "ons" })).toContainText("Ogiltig frånvaro");
  await expect(page.getByTestId("narvaro-rad").filter({ hasText: "BOT-26-0143" }).filter({ hasText: "ons" })).toContainText("Närvarande");
  await expect(page.getByTestId("narvaro-rad").filter({ hasText: "BOT-27-0012" }).filter({ hasText: "tor" })).toContainText("Närvarande");
  // Chefen: kortets Historik visar en loggrad per dag med antalet – inga namn i raden.
  await switchUser(page, info, KARIN, `/arenden/${SC.nadia}?flik=historik`);
  const table = page.getByRole("table", { name: "Revisionslogg" });
  await expect(table).toBeVisible();
  const more = page.getByRole("button", { name: "Visa alla" });
  if (await more.count()) await more.click();
  const bulkRows = table.locator("tbody tr").filter({ hasText: "Närvaro registrerades för flera tillfällen samma dag" });
  await expect(bulkRows).toHaveCount(2);
  await expect(bulkRows.first()).toContainText("3 tillfällen");
  await expect(bulkRows.first()).toContainText("Amira Haddad");
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
  await btn(page, "Godkänn mötesrapporten").click();
  await expect(page.getByText("Stopp: röd status kräver en avvikelse")).toBeVisible();
  // Varje fel står vid fältet och som länk i felsammanfattningen överst (länken flyttar fokus till fältet).
  const summary = page.getByRole("alert").filter({ hasText: "Mötesrapporten kan inte godkännas ännu" });
  for (const t of ["Beskriv avvikelsen.", "Skriv vilken åtgärd som ska göras.", "Välj ansvarig.", "Välj datum för uppföljning."]) {
    await expect(page.locator("[id$='-error']").getByText(t)).toBeVisible();
    await expect(summary.getByRole("link", { name: t })).toBeVisible();
  }
  await expect(page.locator("#dev-desc"), "fokus på första fältet med fel").toBeFocused();
  // Ingen avstämning sparades: formuläret står kvar
  await expect(page.getByRole("heading", { level: 1, name: "Möte" })).toBeVisible();
  await btn(page, "Använd förslaget från flaggan").click();
  await expect(page.locator("#dev-desc")).toHaveValue(/Upprepad ogiltig frånvaro/);
  expect((await page.locator("#dev-action").inputValue()).length).toBeGreaterThan(10);
  await page.locator("#dev-desc").fill("Upprepad ogiltig frånvaro två onsdagar i rad");
  await page.selectOption("#dev-owner", "u-amira");
  await page.getByRole("button", { name: /^Om en vecka/ }).click();
  await expect(page.locator("#dev-follow")).toHaveValue("2027-02-08");
  await btn(group(page, "Behöver beslut från kommunen"), "Ja").click();
  await expect(page.getByText("Stopp: röd status kräver en avvikelse")).toHaveCount(0);
  await btn(page, "Godkänn mötesrapporten").click();

  await expect(page.getByRole("heading", { level: 1, name: "Mötesrapporten är godkänd" })).toBeVisible();
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

test("Mötesrapport utan starttid: dagen är förifylld och klockslaget tas från dagens planerade möte (Nadia, coachmötet 2026-10-09)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.nadia}`, COACH);
  await expect(page.getByRole("heading", { level: 1, name: "Möte" })).toBeVisible();
  // Bara datumet – ingen tid att fylla i.
  await expect(page.locator("#ci-date")).toHaveValue("2027-02-01");
  await expect(page.locator("#ci-time")).toHaveCount(0);
  await expect(page.getByText("Starttid", { exact: true })).toHaveCount(0);
  await btn(group(page, "Veckomål uppnått"), "Ja").click();
  await page.getByRole("group", { name: "Förslag på veckomål" }).getByRole("button").first().click();
  await btn(group(page, "Antal arbetsgivarkontakter"), "0").click();
  await group(page, "Samlad status").getByRole("button", { name: /Grön/ }).click();
  await btn(page, "Godkänn mötesrapporten").click();
  await expect(page.getByRole("heading", { level: 1, name: "Mötesrapporten är godkänd" })).toBeVisible();
  // Möten-fliken: mötet står på dagen med klockslaget från kalendern (Nadias coachträff kl. 10.00), inte när rapporten sparades.
  await go(page, info, `/arenden/${SC.nadia}?flik=avstamningar`);
  const first = page.getByRole("table", { name: "Möten" }).locator("tbody tr").first();
  await expect(first).toContainText("kl. 10.00");
  await expect(first).toContainText("v. 5");
  expect(errors).toEqual([]);
});

test("Veckoavstämning med AI-utkast: varje förslag bedöms och loggas (Mehmet)", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", COACH);
  const granska = page.getByRole("link", { name: "Granska" });
  const href = (await granska.getAttribute("href")) ?? "";
  expect(href).toContain(`/avstamning/${SC.mehmet}?avstamning=`);
  await granska.click();
  await expect(page.getByRole("heading", { level: 1, name: "Möte" })).toBeVisible();
  await noBadText(page);
  await expect(page.getByRole("group", { name: /^AI-förslag för / })).toHaveCount(8);
  expect(await page.getByText(/^Tidpunkt \d\d:\d\d$/).count()).toBeGreaterThanOrEqual(8);
  // Närvarokommentaren föreslås som text med citat – närvarostatusen föreslås aldrig
  await expect(aiGroup(page, "kommentar om närvaron").getByTestId("ai-forslag-varde")).toHaveText(/^Närvarande måndag, tisdag och torsdag\./);
  await expect(aiGroup(page, "kommentar om närvaron")).toContainText("Tidpunkt 02:30");
  await expect(group(page, "Samlad status").locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByText("Ljudet är raderat")).toBeVisible();
  await btn(page, "Visa råtranskriptet").click();
  await expect(page.getByTestId("ratranskript")).toBeVisible();
  await expect(page.getByText("Visningen loggas i revisionsloggen. Rapporter byggs aldrig från råtranskriptet.")).toBeVisible();
  await group(page, "Samlad status").getByRole("button", { name: /Grön/ }).click();
  await btn(page, "Godkänn mötesrapporten").click();
  await expect(page.getByText(/Ta ställning till alla AI-förslag/)).toBeVisible();
  for (const f of ["kommentar om närvaron", "veckomål uppnått", "fas", "arbetsgivarkontakter", "anteckning"]) await btn(aiGroup(page, f), "Acceptera").click();
  await expect(page.locator("#ci-attc")).toHaveValue(/^Närvarande måndag, tisdag och torsdag\./);
  // Ändra men behåll värdet -> loggas som accepterat, och det syns
  await btn(aiGroup(page, "genomförda aktiviteter"), "Ändra").click();
  await expect(aiGroup(page, "genomförda aktiviteter").getByText("Oförändrat – loggas som accepterat")).toBeVisible();
  await btn(aiGroup(page, "nytt veckomål"), "Ändra").click();
  await expect(page.locator("#ci-nextgoal")).toBeFocused();
  await page.locator("#ci-nextgoal").fill("Köra hela distributionsrundan själv på tisdag");
  await expect(aiGroup(page, "nytt veckomål").getByText("Ändrat – loggas som ändrat")).toBeVisible();
  await btn(aiGroup(page, "hinder"), "Avvisa").click();
  await btn(page, "Godkänn mötesrapporten").click();

  await expect(page.getByRole("heading", { level: 1, name: "Mötesrapporten är godkänd" })).toBeVisible();
  await expect(main(page)).toContainText(/AI-förslag\s*6 \/ 1 \/ 1/i);
  await expect(main(page)).toContainText(/Samlad status\s*Grön\s*Fas 3 · Yrkesspecifika moment/i);
  const log = card(page, "Loggade AI-beslut");
  await expect(log.getByText("Du valde Ändra men behöll förslaget")).toBeVisible();
  await expect(log).toContainText(/Kommentar om närvaron\s*Förslag: Närvarande måndag, tisdag och torsdag\..*\s*Accepterat/);
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
  await expect(aiGroup(page, "kommentar om närvaron")).toContainText("sjuk hela veckan");
  for (const f of ["kommentar om närvaron", "veckomål uppnått", "genomförda aktiviteter", "arbetsgivarkontakter", "anteckning"]) await btn(aiGroup(page, f), "Acceptera").click();
  await page.locator("#ci-nextgoal").fill("Komma tillbaka och gå igenom ansökningarna");
  await group(page, "Samlad status").getByRole("button", { name: /Gul/ }).click();
  await btn(page, "Godkänn mötesrapporten").click();
  await expect(page.getByRole("heading", { level: 1, name: "Mötesrapporten är godkänd" })).toBeVisible();
  // Bara förslag med belägg loggas som AI-beslut – och de sparade värdena är förslagen (Nej, 0)
  await expect(main(page)).toContainText(/AI-förslag\s*5 \/ 0 \/ 0/i);
  const log = card(page, "Loggade AI-beslut");
  await expect(log.locator("div.font-bold")).toHaveText(["Kommentar om närvaron", "Veckomål uppnått", "Genomförda aktiviteter", "Arbetsgivarkontakter", "Anteckning"]);
  await expect(log).toContainText(/Veckomål uppnått\s*Förslag: Nej\s*Accepterat/);
  await expect(log).toContainText(/Arbetsgivarkontakter\s*Förslag: 0\s*Accepterat/);
  await expect(card(page, "Dataminimering")).toContainText("Inget ljud användes");
  expect(errors).toEqual([]);
});

// Röstinspelningen (docs/PLAN-ROST.md): prototypen simulerar inspelningen (sidan saknar mikrofon), appen spelar in med
// Chromiums falska mikrofon (test.use överst i filen). Transkriberingen går via ctx.ai (simulerad AI) – fasen nämns inte i
// samtalet ("Framgår inte").
test("Veckoavstämning: samtycke och inspelning (Elif)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.elif}`, COACH);
  await btn(page, "Med AI-stöd").click();
  await expect(page.getByText("Samtycke saknas")).toBeVisible();
  await expect(btn(page, "Deltagaren säger ja")).toBeDisabled();
  await page.locator("#cons-informed").check();
  await btn(page, "Deltagaren säger ja").click();
  await expect(page.getByText("Samtycke registrerat 1 feb 2027")).toBeVisible();
  await expect(page.getByText(/^Version v1\.0 \(2026-10-01\), informerad av Amira Haddad på [a-zåäö ]+\.$/)).toBeVisible();
  await btn(page, isDemo(info) ? "Simulera en inspelning" : "Starta inspelning").click();
  await expect(page.getByRole("timer").filter({ hasText: /^Spelar in \d\d:\d\d$/ })).toBeVisible();
  await btn(page, "Pausa").click();
  await expect(page.getByText(/^Inspelningen är pausad · \d\d:\d\d$/)).toBeVisible();
  await btn(page, "Fortsätt").click();
  await page.waitForTimeout(1200);
  await btn(page, "Stoppa och tolka").click();
  await expect(page.getByText("Transkriberar …")).toBeVisible();
  await page.getByText("Ljudet är raderat").waitFor({ timeout: 15_000 });
  await expect(page.getByRole("group", { name: /^AI-förslag för / })).toHaveCount(8);
  // AI-körningen är loggad och ljudet raderat direkt. Fasen framgår inte av samtalet – inget förslag att acceptera.
  // Leverantör och modell står inte i formuläret (bara i revisionsloggen); den simulerade AI:n märks med testmiljönotisen.
  await expect(page.getByRole("note").filter({ hasText: "Testmiljö: AI:n är simulerad" }).first()).toBeVisible();
  await expect(page.getByText("Simulerad AI (testdata)")).toHaveCount(0);
  await expect(page.getByText(/^måndag 1 feb 2027 kl\. \d\d\.\d\d – direkt efter transkriberingen$/)).toBeVisible();
  await expect(aiGroup(page, "fas")).toContainText("Framgår inte");
  for (const f of ["kommentar om närvaron", "veckomål uppnått", "nytt veckomål", "genomförda aktiviteter", "arbetsgivarkontakter", "hinder", "anteckning"]) await btn(aiGroup(page, f), "Acceptera").click();
  await group(page, "Samlad status").getByRole("button", { name: /Gul/ }).click();
  await btn(page, "Godkänn mötesrapporten").click();
  await expect(page.getByRole("heading", { level: 1, name: "Mötesrapporten är godkänd" })).toBeVisible();
  await expect(main(page)).toContainText(/AI-förslag\s*7 \/ 0 \/ 0/i);
  await expect(main(page)).toContainText(/Samlad status\s*Gul/i);
  await expect(page.getByText("Ljudet raderades direkt efter transkriberingen", { exact: true })).toBeVisible();
  await expect(page.getByText("Råtranskriptet raderades vid godkännandet", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Veckoavstämning: nekat samtycke; kollegans ärende öppnas (beslut 2026-10-09)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.yusuf}`, COACH);
  await btn(page, "Med AI-stöd").click();
  await expect(page.getByText(/Deltagaren sa nej/)).toBeVisible();
  await expect(btn(page, "Starta inspelning")).toHaveCount(0);
  // Eriks ärende: Amira når avstämningen (alla på Miljonbemanning arbetar i alla ärenden i avtalet).
  await go(page, info, `/avstamning/${SC.skyddad}`);
  await expect(page.getByText("Du saknar åtkomst till ärendet")).toHaveCount(0);
  await expect(page.getByText("Inte ditt ärende")).toHaveCount(0);
  await expect(page.getByText(/BOT-26-0120/).first()).toBeVisible();
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

// ================================================================ Månadsbedömning: anteckningar från månaden (rapporter steg 2)
test("Månadsbedömning januari: 'Lägg till i sammanfattningen' lägger in anteckningen, och den finns kvar efter sparning (Nadia)", async ({ page }, info) => {
  const errors = await open(page, info, `/manadsbedomning/${SC.nadia}?manad=2027-01`, COACH);
  await expect(page.getByRole("heading", { level: 1, name: "Månadsbedömning januari 2027" })).toBeVisible();
  await expect(main(page)).toContainText("Anteckningar från januari. De kommer inte med i rapporten av sig själva.");
  const note = "Handläggaren ringde och frågade om det planerade slutdatumet.";
  await expect(main(page)).toContainText(note);
  await expect(main(page)).toContainText("0 av 4000 tecken");
  await btn(page, "Lägg till i sammanfattningen").first().click();
  // Knappen byter till "Tillagd" utan att tappa fokus, och kvittensen läses upp.
  await expect(btn(page, "Tillagd i sammanfattningen")).toHaveAttribute("aria-disabled", "true");
  await expect(btn(page, "Tillagd i sammanfattningen")).toBeFocused();
  await expect(page.getByText("Anteckningen är tillagd i sammanfattningen.", { exact: false })).toBeVisible();
  await expect(page.locator("#cm-summary")).toHaveValue(new RegExp(`^${note}`));
  await btn(page, "Spara utkast").click();
  await expect(page.getByText("Utkastet är sparat.")).toBeVisible();
  await page.reload();
  if (!isDemo(info)) await loaded(page);
  await expect(page.locator("#cm-summary")).toHaveValue(new RegExp(`^${note}`));
  // Efter omladdning: texten finns i sammanfattningen – samma anteckning kan inte läggas in en gång till.
  await expect(btn(page, "Tillagd i sammanfattningen")).toHaveCount(1);
  await expect(btn(page, "Lägg till i sammanfattningen")).toHaveCount(2);
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
  // Bonus är avstängd: en rad med en bricka, inget eget kort (kortet visas bara när bonus är aktiv i avtalet).
  await expect(page.getByText("Bonus avstängd – modellen ej fastställd")).toBeVisible();
  await expect(card(page, "Bonus")).toHaveCount(0);
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
  await expect(main(page)).toContainText("1 händelse i ärendet är markerad som möjligt bonusunderlag.");

  // Lägesväxlaren säger "Avslut" – "Avsluta insatsen" är bara den riktiga knappen i kortet.
  await btn(group(page, "Välj uppgift"), "Avslut").click();
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

// ================================================================ Mötet (beslut 2026-10-09): Spela in mötet från deltagarkortet
test("Deltagarkortet: Spela in mötet öppnar sidan MÖTE med inspelningsläget valt (Nadia)", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, COACH);
  const actions = page.getByRole("group", { name: "Åtgärder" });
  await expect(actions.getByRole("link", { name: "Nytt möte utan inspelning", exact: true })).toBeVisible();
  await actions.getByRole("link", { name: "Spela in mötet", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Möte" })).toBeVisible();
  expect(currentPath(page, info)).toBe(`/avstamning/${SC.nadia}?spela=1`);
  // AI-stöd med inspelning är förvalt – coachen trycker bara på inspelningsknappen. Bedömningsfälten är tomma tills coachen väljer.
  await expect(btn(page, "Med AI-stöd")).toHaveAttribute("aria-pressed", "true");
  const src = page.getByRole("group", { name: "Källa" });
  await expect(btn(src, "Spela in mötet")).toHaveAttribute("aria-pressed", "true");
  await expect(btn(page, isDemo(info) ? "Simulera en inspelning" : "Starta inspelning")).toBeVisible();
  await expect(main(page)).toContainText("Spela in mötet eller fyll i mötesrapporten själv.");
  // Yusuf har sagt nej till inspelning: huvudknappen är Nytt möte och ingen inspelningsknapp visas (kortet och fliken Möten).
  await go(page, info, `/arenden/${SC.yusuf}`);
  const yusuf = page.getByRole("group", { name: "Åtgärder" });
  await expect(yusuf.getByRole("link", { name: "Nytt möte", exact: true })).toBeVisible();
  await expect(yusuf.getByRole("link", { name: "Spela in mötet", exact: true })).toHaveCount(0);
  await expect(yusuf.getByRole("link", { name: "Nytt möte utan inspelning", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /^Möten/ }).click();
  await expect(page.getByRole("link", { name: "Spela in mötet", exact: true })).toHaveCount(0);
  await expect(card(page, /^Möten/).getByRole("link", { name: "Nytt möte", exact: true })).toHaveCount(1);
  await noBadText(page);
  expect(errors).toEqual([]);
});
