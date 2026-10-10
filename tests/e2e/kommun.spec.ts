// Kommunens portal – port av den gamla prototypens tools/test-kommun.mjs (inloggning, startsida, beställning, deltagare,
// rapporter och meddelanden, uppgifter). Ändrat efter synpunkterna från 2026-10-06 (beslut 2026-10-07): självregistrering,
// beställningen med omfattning i månader och bakgrundsinformation med bifogad fil, inga belopp, månadsrapportens närvaro och
// ingen kommunens chef (beställarrapporten och resultatfilen lämnas av Miljonbemanning). Coachmötet 2026-10-09 ("Vi behöver
// inte visa så mycket till kommunens handläggare"): testerna kontrollerar också att det borttagna INTE syns och att
// rapporterna, orderbekräftelsen, ärendets status och meddelandena finns kvar.
// Samma test körs mot prototypen (projekt "demo") och appen (projekt "app"). Data läses via skärmen. Steg som görs i andra
// områden (Miljonbemanning avböjer, accepterar, byter coach, kallar kommunen) körs som kommandon – i prototypen via
// kommandologgen som spelas upp vid omladdning, i appen via /api/rpc. Det som inte syns på skärmen (revisionslogg,
// senaste inloggning, rollkontroller) testas i src/features/kommun/handlers.test.ts.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { allowLeaveWarnings, isDemo, open, switchPersona } from "./helpers";

type As = { userId: string; role: string };
const MARIA: As = { userId: "k-maria", role: "kommun_handlaggare" };
const SARA: As = { userId: "u-sara", role: "samordnare" };
const AMIRA: As = { userId: "u-amira", role: "coach" };
const SOFIA: As = { userId: "u-sofia", role: "coach" };

// Testdatat (samma id:n som i den gamla prototypen, prototypens S.script)
const SC = { nadia: "case-260143", yusuf: "case-260148", elif: "case-270003", mall: "case-270050", closed: "case-260094" };
const NADIA_DEC = "rep-16008"; // månadsrapport december, levererad till Maria Ekdahl
const ACTOR_EXTRA: Record<string, { contractIds: string[]; customerUnit: string | null }> = {
  "k-maria": { contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" },
  "u-johan": { contractIds: ["c-bot"], customerUnit: null },
};

// ---------------------------------------------------------------- Hjälpare
const main = (page: Page) => page.locator("#main");
const mainText = (page: Page) => main(page).innerText();
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });
const link = (page: Page, name: string | RegExp) => page.getByRole("link", { name, exact: typeof name === "string" });
const linkOrBtn = (page: Page, name: string | RegExp) => link(page, name).or(btn(page, name));
const card = (page: Page, title: string) => main(page).locator("section").filter({ has: page.getByRole("heading", { name: title }) });
const LOG_KEY = "miljonmatch-prototyp-v2-logg";
const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";

/** Visa en sökväg som en annan testperson utan att nollställa det som gjorts i testet. */
async function go(page: Page, info: TestInfo, to: string, as: As) {
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
  await settle(page);
}
async function settle(page: Page) {
  await expect(main(page)).not.toContainText("Hämtar…", { timeout: 15_000 });
  await page.waitForTimeout(250);
}

type Cmd = { key: string; input: unknown; as: As };
/** Kör kommandon (andra områdens steg) som testpersonen. Prototypen: via kommandologgen; appen: via /api/rpc. */
async function commands(page: Page, info: TestInfo, cmds: Cmd[]) {
  if (isDemo(info)) {
    await page.evaluate(({ key, cmds, extra }) => {
      const log = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
      for (const c of cmds) {
        const x = extra[c.as.userId] ?? { contractIds: ["c-bot"], customerUnit: null };
        log.push({ key: c.key, input: c.input, actor: { userId: c.as.userId, role: c.as.role, ...x } });
      }
      localStorage.setItem(key, JSON.stringify(log));
    }, { key: LOG_KEY, cmds, extra: ACTOR_EXTRA });
    await page.reload();
    await settle(page);
    return;
  }
  for (const c of cmds) {
    await switchPersona(page, c.as);
    const res = await page.request.post("/api/rpc", { data: { kind: "command", key: c.key, input: c.input } });
    expect(res.ok()).toBeTruthy();
  }
}

/** Aktuell sökväg med query (prototypen: hash-adressen). */
const currentPath = (page: Page, info: TestInfo) => {
  const u = new URL(page.url());
  return isDemo(info) ? decodeURIComponent(u.hash.replace(/^#/, "")) : u.pathname + u.search;
};
/** Rollen i prototypfältet (bara prototypen). */
const roleSelect = (page: Page) => page.getByLabel("Roll", { exact: true });
/** Prototypfältet visar kundens perspektiv. Kommunen har bara en roll (beslut 2026-10-07), så fältet har ingen rollväljare då. */
async function expectCustomerPerspective(page: Page) {
  await expect(page.getByRole("group", { name: "Perspektiv" }).getByRole("button", { name: "Kund" })).toHaveAttribute("aria-pressed", "true");
  await expect(roleSelect(page)).toHaveCount(0);
}

/** Ingen horisontell scroll i sidans innehåll på 400 px (prototypfältet överst räknas inte). */
async function noHScroll(page: Page, label: string) {
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(120);
  const over = await page.evaluate(() => {
    const m = document.querySelector("#main");
    return m ? Math.max(m.scrollWidth - m.clientWidth, m.getBoundingClientRect().right - window.innerWidth) : 0;
  });
  expect(over, `${label}: ingen horisontell scroll på 400 px`).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(60);
}

/** Id:t i en länk till deltagarens sida. */
async function caseIdFromLink(page: Page, name: string | RegExp): Promise<string> {
  const href = (await link(page, name).first().getAttribute("href")) ?? "";
  const m = decodeURIComponent(href).match(/\/portal\/deltagare\/([^?#/]+)/);
  expect(m, `länken ${String(name)} leder till en deltagare`).not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

// ================================================================ 1. Inloggning
test("1. inloggning med e-post och engångskod (neutralt svar, kod, självregistrering, annan domän, mobil)", async ({ page }, info) => {
  const errors = await open(page, info, "/portal/logga-in", MARIA);
  await expect(page.locator("#kom-login-email")).toHaveValue("maria.ekdahl@botkyrka.se");
  let t = await mainText(page);
  // Beslut 2026-10-09: inget kort om varför en kod och ingen lista om utloggning och konto – bara formuläret.
  expect(t, "inget kort om varför en kod").not.toMatch(/Safe Links|Varför en kod/);
  expect(t, "ingen lista om utloggning").not.toMatch(/minuter utan aktivitet/);
  expect(t, "ingen lista om kontot").not.toMatch(/Första gången du loggar in skapas ditt konto/);
  await expect(btn(page, "Skicka kod")).toHaveCount(1);
  // Portalen påminner inte om mejlbeställning (synpunkt #1, rättelse 2026-10-07).
  expect(t).not.toMatch(/avrop@|beställa med mejl/i);
  // Avvikelse från prototypen: svaret är alltid neutralt – skärmen avslöjar inte vilka domäner eller adresser som finns.
  await page.fill("#kom-login-email", "maria.ekdahl@gmail.com");
  await btn(page, "Skicka kod").click();
  await expect(main(page)).toContainText("Om adressen maria.ekdahl@gmail.com finns hos oss har vi skickat en kod dit.");
  await btn(page, "Byt e-postadress").click();
  await page.fill("#kom-login-email", "maria.ekdahl");
  await btn(page, "Skicka kod").click();
  await expect(main(page)).toContainText("Adressen är inte komplett.");
  await page.fill("#kom-login-email", "maria.ekdahl@botkyrka.se");
  await btn(page, "Skicka kod").click();
  t = await mainText(page);
  expect(t, "steg 2 visar giltighetstid och antal försök").toMatch(/Koden gäller i 10 minuter/);
  expect(t).toMatch(/Du har 5 försök/);
  // E-postadressen stannar inne i rutan på mobil
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(80);
  const mailOverflow = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("#main b")).find((x) => x.textContent?.includes("@"));
    const n = b?.closest("div.rounded-mb");
    return b && n ? b.getBoundingClientRect().right - n.getBoundingClientRect().right : 99;
  });
  expect(mailOverflow, "e-postadressen stannar inne i rutan på 400 px").toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.fill("#kom-login-code", "123");
  await btn(page, "Logga in").click();
  await expect(main(page), "för kort kod ger tydligt fel").toContainText("Koden har 6 siffror. Du har skrivit 3.");
  await page.fill("#kom-login-code", "482913");
  await btn(page, "Logga in").click();
  await expect.poll(() => currentPath(page, info), { timeout: 15_000 }).toBe("/portal");
  await settle(page);
  await expect(main(page), "handläggaren hamnar på startsidan").toContainText(/Välkommen, Maria/i);
  if (isDemo(info)) await expectCustomerPerspective(page);

  // Självregistrering (beslut 2026-10-07, synpunkt #2): en ny adress på kommunens domän får ett konto som handläggare och
  // kommer till Mina uppgifter. Namnet är förifyllt ur adressen; telefon och enhet fylls i.
  await go(page, info, "/portal/logga-in", MARIA);
  await page.fill("#kom-login-email", "kim.testsson@botkyrka.se");
  await btn(page, "Skicka kod").click();
  await expect(main(page)).toContainText("Om adressen kim.testsson@botkyrka.se finns hos oss har vi skickat en kod dit.");
  await page.fill("#kom-login-code", "000000");
  await btn(page, "Logga in").click();
  await expect.poll(() => currentPath(page, info), { timeout: 15_000 }).toBe("/portal/mina-uppgifter?forsta=1");
  await settle(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Välkommen till Miljonmatch/i);
  if (isDemo(info)) await expectCustomerPerspective(page);
  await expect(page.locator("#kom-p-name")).toHaveValue("Kim Testsson");
  await expect(main(page)).toContainText("Här beställer du insatser, följer dina deltagare och läser rapporter från Miljonbemanning.");
  await btn(page, "Spara").click();
  await expect(main(page), "telefon och enhet krävs").toContainText("Skriv vilken enhet du arbetar på.");
  await page.fill("#kom-p-phone", "08-000 12 34");
  await page.fill("#kom-p-unit", "Arbetsmarknadsenheten Tumba");
  await btn(page, "Spara").click();
  await expect.poll(() => currentPath(page, info), { timeout: 15_000 }).toBe("/portal");
  await settle(page);
  await expect(main(page)).toContainText(/Välkommen, Kim/i);
  await expect(main(page)).toContainText("Arbetsmarknadsenheten Tumba");
  // Det nya kontot har inga deltagare än (bara egna beställningar syns).
  await linkOrBtn(page, /Mina deltagare/).first().click();
  await settle(page);
  await expect(main(page)).not.toContainText("Nadia Warsame");

  // En annan domän: samma neutrala svar, och koden godtas inte – inget konto, ingen inloggning
  await go(page, info, "/portal/logga-in", MARIA);
  await page.fill("#kom-login-email", "okand.person@gmail.com");
  await btn(page, "Skicka kod").click();
  await expect(main(page)).toContainText("Om adressen okand.person@gmail.com finns hos oss");
  await page.fill("#kom-login-code", "123456");
  await btn(page, "Logga in").click();
  await expect(main(page), "annan domän loggas inte in").toContainText("Koden stämmer inte eller har gått ut.");
  expect(currentPath(page, info)).toBe("/portal/logga-in");
  expect(errors).toEqual([]);
});

// ================================================================ 2. Startsida
test("2. startsidan för handläggaren: tre stora knappar utan siffror, sedan olästa och Visa alla olästa – inga händelser", async ({ page }, info) => {
  const errors = await open(page, info, "/portal", MARIA);
  await settle(page);
  const big = main(page).getByRole("navigation", { name: "Vad vill du göra?" }).getByRole("link");
  await expect(big, "tre stora knappar").toHaveCount(3);
  const texts = await big.allInnerTexts();
  expect(texts[0]).toMatch(/Beställ ny insats/);
  // Beslut 2026-10-09: inga siffror under knapparna.
  expect(texts[1].trim()).toBe("Mina deltagare");
  expect(texts[2].trim()).toBe("Rapporter och meddelanden");
  let t = await mainText(page);
  expect(t, "inga händelser på startsidan").not.toMatch(/Händelser i dina ärenden/i);
  expect(t).not.toMatch(/pågår · \d+ väntar på start|\d+ olästa\b/);
  expect(t, "olästa (4)").toMatch(/Olästa rapporter och meddelanden \(4\)/i);
  expect(t).toMatch(/Tre korta steg och en granskning/);
  expect(t, "listan visar tre – resten bakom Visa alla olästa").toMatch(/Visa alla olästa \(4\)/);
  if (isDemo(info)) await expect(btn(page, "Se startsidan hos Miljonbemanning")).toHaveCount(1);
  // Fler olästa än listan rymmer: coachen skriver i tre av Marias ärenden
  await commands(page, info, [SC.nadia, SC.yusuf, "case-260119"].map((caseId) => ({ key: "arenden.messageSend", input: { caseId, body: "Testmeddelande från coachen." }, as: AMIRA })));
  await go(page, info, "/portal", MARIA);
  t = await mainText(page);
  expect(t).toMatch(/Olästa rapporter och meddelanden \(7\)/i);
  expect(t).toMatch(/Nytt meddelande om BOT-26-0143/);
  await linkOrBtn(page, "Visa alla olästa (7)").click();
  await expect.poll(() => currentPath(page, info)).toBe("/portal/rapporter?filter=olasta");
  await settle(page);
  await expect(page.getByRole("group", { name: "Visa rapporter" }).getByRole("button", { name: /^Olästa/ }), "filtret Olästa är valt").toHaveAttribute("aria-pressed", "true");
  await go(page, info, "/portal", MARIA);
  const unreadCard = await main(page).locator("section").filter({ hasText: /Olästa rapporter och meddelanden/ }).first().boundingBox();
  const firstBig = await big.first().boundingBox();
  expect(unreadCard && firstBig && firstBig.y < unreadCard.y, "huvudhandlingen (knapparna) visas ovanför de olästa").toBeTruthy();
  await big.first().click();
  await expect.poll(() => currentPath(page, info), { message: "knappen öppnar beställningen" }).toBe("/portal/bestall");
  expect(errors).toEqual([]);
});

// ================================================================ 3. Beställning
test("3. beställning i tre steg och en granskning: omfattning i månader, yrkesområde, kartläggning ja eller nej med bifogad fil, inga belopp", async ({ page }, info) => {
  // Nadias personnummer (för dubblettkontrollen) läses via "Visa" – visningen loggas.
  const errors = await open(page, info, `/portal/deltagare/${SC.nadia}`, MARIA);
  await settle(page);
  await card(page, "Uppgifter om deltagaren").getByRole("button", { name: "Visa" }).click();
  await expect(card(page, "Uppgifter om deltagaren")).toContainText("(visning loggad)");
  const nadiaPnr = ((await card(page, "Uppgifter om deltagaren").innerText()).match(/\d{8}-\d{4}/) ?? [""])[0];
  expect(nadiaPnr).toMatch(/^\d{8}-\d{4}$/);

  await go(page, info, "/portal/bestall", MARIA);
  // Beslut 2026-10-09: kontaktuppgifterna från kontot visas som en sammanfattning med Ändra – fälten finns bakom Ändra.
  for (const id of ["#kom-o-name", "#kom-o-unit", "#kom-o-phone", "#kom-o-email"]) await expect(page.locator(id), `${id} bakom Ändra`).toHaveCount(0);
  await expect(main(page)).toContainText(/Kontaktperson/i);
  await expect(main(page)).toContainText("Maria Ekdahl");
  await expect(main(page)).toContainText("maria.ekdahl@botkyrka.se");
  await expect(main(page)).toContainText("Arbetsmarknadsenheten Alby");
  await btn(page, "Ändra kontaktperson").click();
  await expect(page.locator("#kom-o-name"), "Ändra öppnar fälten med fokus på det första").toBeFocused();
  await expect(page.locator("#kom-o-name")).toHaveValue("Maria Ekdahl");
  await expect(page.locator("#kom-o-email")).toHaveValue("maria.ekdahl@botkyrka.se");
  await expect(page.locator("#kom-o-unit"), "enheten är fritext och förifylld").toHaveValue("Arbetsmarknadsenheten Alby");
  let t = await mainText(page);
  expect(t).toMatch(/Steg 1 av 3/i);
  expect(t).toMatch(/tre korta steg och granska innan du skickar/);
  const stepper = main(page).getByRole("list", { name: "Steg i beställningen" });
  await expect(stepper.getByRole("listitem")).toHaveCount(4);
  await expect(stepper.getByRole("listitem").last().locator("svg"), "granskningen visas utan stegnummer").toHaveCount(1);
  // Borttaget 2026-10-07: beställarreferens, planerat slutdatum, skyddade personuppgifter, anpassning, yrkesspår och värde.
  for (const id of ["#kom-o-ref", "#kom-o-end", "#kom-o-track", "#kom-o-needs"]) await expect(page.locator(id), id).toHaveCount(0);
  expect(t).not.toMatch(/Beställarreferens|Skyddade personuppgifter|Önskat yrkes/i);
  if (isDemo(info)) await expect(btn(page, "Se hur beställningar tas emot hos Miljonbemanning")).toHaveCount(1);
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Beställning och kontakt" }), "omfattningen krävs").toHaveCount(1);
  await expect(main(page)).toContainText("Välj hur länge insatsen ska pågå.");
  const period = page.getByRole("group", { name: "Omfattning" });
  await expect(period.getByRole("button"), "6 månader, 12 månader och annan tidsperiod (avtalets alternativ)").toHaveText(["6 månader", "12 månader", "Annan tidsperiod"]);
  // Annan tidsperiod kräver slutdatum och motivering.
  await period.getByRole("button", { name: "Annan tidsperiod" }).click();
  await page.fill("#kom-o-start", "2027-02-15");
  await btn(page, /^Nästa/).click();
  await expect(main(page)).toContainText("Välj ett slutdatum.");
  await expect(main(page)).toContainText("Skriv varför insatsen behöver en annan längd.");
  // 6 månader: planerat slut räknas fram från startdatumet.
  await period.getByRole("button", { name: "6 månader", exact: true }).click();
  await expect(page.locator("#kom-o-end"), "inget slutdatum att fylla i vid 6 månader").toHaveCount(0);
  await expect(main(page)).toContainText(/Planerat slut: 14 augusti 2027/);
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Deltagare", exact: true })).toHaveCount(1);
  await expect(main(page), "mallens text om dataminimering").toContainText("Lämna bara de uppgifter som behövs");
  await page.fill("#kom-o-fn", "Test");
  await page.fill("#kom-o-ln", "Dubblett");
  await page.fill("#kom-o-pnr", nadiaPnr);
  await expect(main(page), "dubblettkontrollen visar pågående insats").toContainText("Personen har redan en pågående insats");
  await expect(main(page)).toContainText("BOT-26-0143");
  await page.fill("#kom-o-pnr", "1988041");
  await btn(page, /^Nästa/).click();
  await expect(main(page), "felaktigt personnummer får formatfel").toContainText("ÅÅÅÅMMDD-NNNN");
  await page.fill("#kom-o-fn", "Samira");
  await page.fill("#kom-o-ln", "Testsson");
  await page.fill("#kom-o-pnr", "19880412-3456");
  // Beslut 2026-10-09: ingen bostadsort, ingen fråga om kontaktväg och ingen adress – yrkesområdet är obligatoriskt.
  for (const id of ["#kom-o-city", "#kom-o-contact", "#kom-o-addr"]) await expect(page.locator(id), id).toHaveCount(0);
  t = await mainText(page);
  expect(t).not.toMatch(/Bostadsort|Hur vill deltagaren bli kontaktad|Fullständig adress/);
  await btn(page, /^Nästa/).click();
  await expect(main(page), "telefon eller e-post krävs för kallelsen").toContainText("Skriv deltagarens telefonnummer. Har deltagaren ingen telefon? Skriv e-postadressen i stället.");
  await expect(main(page), "yrkesområdet krävs").toContainText("Välj ett yrkesområde.");
  // Listan är avtalets avtalsområden (samma källa som acceptdialogen) – hjälptexten nämner Övrigt.
  await expect(page.locator("#kom-o-area option"), "Välj yrkesområde och avtalets tolv avtalsområden").toHaveCount(13);
  await expect(page.locator("#kom-o-area option").nth(7)).toHaveText("Lager och logistik");
  await expect(main(page)).toContainText("Det yrkesområde deltagaren ska arbeta mot. Välj Övrigt om inget passar.");
  await page.fill("#kom-o-dphone", "070-000 1");
  await page.selectOption("#kom-o-area", "G");
  await btn(page, /^Nästa/).click();
  await expect(main(page), "ett för kort telefonnummer").toContainText("Skriv hela telefonnumret");
  await page.fill("#kom-o-dphone", "070-000 11 22");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Bakgrundsinformation om deltagaren" })).toHaveCount(1);
  await expect(main(page)).toContainText("Var så detaljerad som möjligt – det är en bra utgångspunkt för oss.");
  await btn(page, /^Nästa/).click();
  await expect(main(page), "frågan om kartläggning krävs").toContainText("Svara om en kartläggning har genomförts.");
  const prior = page.getByRole("group", { name: "Har en kartläggning genomförts?" });
  await expect(prior.getByRole("button"), "bara Ja och Nej (Vet inte borttaget 2026-10-09)").toHaveText(["Ja", "Nej"]);
  await expect(page.locator("#kom-o-files"), "Bifoga fil visas bara när Ja är valt").toHaveCount(0);
  await prior.getByRole("button", { name: "Nej" }).click();
  await expect(page.locator("#kom-o-files"), "inte vid Nej").toHaveCount(0);
  await prior.getByRole("button", { name: "Ja" }).click();
  // Bifoga fil: en påhittad PDF. En fil av fel typ tas inte emot.
  await page.locator("#kom-o-files").setInputFiles({ name: "skript.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ påhittad") });
  await expect(main(page)).toContainText(/skript\.exe/);
  await page.locator("#kom-o-files").setInputFiles({ name: "kartlaggning-test.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n% påhittad kartläggning\n") });
  const files = main(page).getByRole("list", { name: "Bilagor" });
  await expect(files).toContainText("kartlaggning-test.pdf", { timeout: 15_000 });
  // Byts svaret till Nej frågar vi först – sedan tas filen bort och Bifoga fil döljs.
  await prior.getByRole("button", { name: "Nej" }).click();
  const remove = page.getByRole("dialog", { name: "Ta bort den bifogade filen?" });
  await expect(remove).toContainText("Du har svarat nej på frågan om kartläggning.");
  await remove.getByRole("button", { name: "Behåll svaret ja" }).click();
  await expect(files, "Behåll svaret ja: filen finns kvar").toContainText("kartlaggning-test.pdf");
  await prior.getByRole("button", { name: "Nej" }).click();
  await page.getByRole("dialog", { name: "Ta bort den bifogade filen?" }).getByRole("button", { name: "Ta bort filen" }).click();
  await expect(page.locator("#kom-o-files"), "Bifoga fil döljs vid Nej").toHaveCount(0);
  await expect(main(page).getByRole("list", { name: "Bilagor" })).toHaveCount(0);
  await expect(prior.getByRole("button", { name: "Nej" })).toHaveAttribute("aria-pressed", "true");
  // Tillbaka till Ja: filen är borttagen och bifogas på nytt.
  await prior.getByRole("button", { name: "Ja" }).click();
  await expect(page.locator("#kom-o-files")).toHaveCount(1);
  await expect(main(page).getByRole("list", { name: "Bilagor" }), "den borttagna filen kommer inte tillbaka").toHaveCount(0);
  await page.locator("#kom-o-files").setInputFiles({ name: "kartlaggning-test.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n% påhittad kartläggning\n") });
  await expect(files).toContainText("kartlaggning-test.pdf", { timeout: 15_000 });
  await page.fill("#kom-o-bg", "Har arbetat på lager i två år. Vill ta truckkort.");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Granska och skicka" })).toHaveCount(1);
  t = await mainText(page);
  expect(t, "granskningen räknas inte som ett fjärde steg").toMatch(/Granska innan du skickar/i);
  expect(t).not.toMatch(/Steg 4 av/i);
  expect(t, "personnumret maskerat i granskningen").toMatch(/•+-?3456/);
  expect(t).not.toMatch(/19880412-3456/);
  expect(t).toMatch(/Omfattning\s+6 månader/);
  expect(t).toMatch(/Yrkesområde\s+Lager och logistik/);
  expect(t, "inga borttagna fält i granskningen").not.toMatch(/Bostadsort|Kontaktväg|Adress/);
  expect(t).toMatch(/Kartläggning genomförd\s+Ja/);
  expect(t).toMatch(/Bifogade filer\s+1 fil/);
  expect(t, "inga belopp i granskningen (synpunkt #10)").not.toMatch(/\d\s?kr\b|kronor|värde|pris/i);
  await btn(page, "Skicka beställningen").click();
  await expect(main(page)).toContainText("Tack! Beställningen är skickad", { timeout: 15_000 });
  t = await mainText(page);
  expect(t, "ärendenummer (nästa i avtalets serie)").toMatch(/BOT-27-0051/);
  // Beslut 2026-10-09: kvittot har bara ärendenumret och en mening om orderbekräftelsen – inget mejl och ingen tidslinje.
  // Mejlet innehåller bara ärendenumret och en länk (CLAUDE.md punkt 9): orderbekräftelsen läses i portalen.
  expect(t).toMatch(/Senast \S+ \d+ \S+ \d{4} klockan \d{2}\.\d{2} får du ett mejl om att orderbekräftelsen finns i portalen\./);
  expect(t, "orderbekräftelsen kommer inte med mejl").not.toMatch(/orderbekräftelsen med mejl/);
  await expect(card(page, "Mejlet du får"), "inget kort Mejlet du får").toHaveCount(0);
  await expect(card(page, "Så här går det vidare"), "ingen tidslinje").toHaveCount(0);
  expect(t).not.toMatch(/Mejlet du får|Så här går det vidare|Tack! Vi har tagit emot er beställning|Yrkesområde:|kallelse/);
  expect(t, "inga personuppgifter på kvittot").not.toMatch(/Samira|Testsson|3456/);
  expect(t, "kvittot skriver datum utan förkortningar").not.toMatch(/\bkl\.|\b(jan|feb|dec)\b/);
  await noHScroll(page, "Ordererkännande");
  const newId = await caseIdFromLink(page, "Se beställningen");
  // Perspektivbyte till avropsinkorgen (bara prototypen)
  if (isDemo(info)) {
    await btn(page, "Se hur beställningen landar hos Miljonbemanning").click();
    await expect.poll(() => currentPath(page, info)).toBe(`/inkorg?arende=${newId}`);
    await expect(roleSelect(page), "perspektivbytet öppnar ärendet i avropsinkorgen som samordnare").toHaveValue("samordnare");
    await settle(page);
    await expect(main(page)).toContainText("BOT-27-0051");
  }

  // Beställningen hos kommunen: väntar på bekräftelse och yrkesområdet från beställningen. Beslut 2026-10-09: ingen
  // kontaktväg, bostadsort eller bakgrundsinformation (med bilagorna) på deltagarens sida.
  await go(page, info, `/portal/deltagare/${newId}`, MARIA);
  t = await mainText(page);
  expect(t).toMatch(/Väntar på bekräftelse/);
  expect(t).toMatch(/Beställningen kom in via portalen/);
  expect(t).toMatch(/Yrkesområde\s+G Lager och logistik/);
  expect(t).not.toMatch(/Kontaktväg|Bostadsort|Yrkesspår|Bakgrundsinformation från beställningen|Kartläggning genomförd/);
  await expect(main(page).getByRole("list", { name: "Bilagor" }), "bilagorna visas inte i portalen").toHaveCount(0);
  // Avbrott görs med mejl (beslut 2026-10-09) – adressen och ärendenumret står på sidan.
  expect(t).toMatch(/Vill du avbryta insatsen\? Mejla avrop@miljonbemanning\.se med ärendenumret BOT-27-0051\./);
  await expect(main(page).getByRole("link", { name: "avrop@miljonbemanning.se" })).toHaveAttribute("href", "mailto:avrop@miljonbemanning.se?subject=Avbryta%20insatsen%20BOT-27-0051");
  // … och hos Miljonbemanning: omfattningen och bakgrunden med filen på deltagarkortet
  await go(page, info, `/arenden/${newId}`, SARA);
  await expect(main(page)).toContainText("Bakgrund från beställningen");
  t = await mainText(page);
  expect(t).toMatch(/6 månader/);
  await expect(main(page).getByRole("list", { name: "Bilagor" })).toContainText("kartlaggning-test.pdf");
  expect(errors).toEqual([]);
});

// ================================================================ 3b. Kontaktuppgifter som saknas i kontot
test("3b. kontaktuppgifter som saknas i kontot: fälten är öppna och stannar öppna med fokus medan handläggaren skriver", async ({ page }, info) => {
  // En självregistrerad handläggare som inte har fyllt i Mina uppgifter: enhet och telefon saknas i kontot.
  const errors = await open(page, info, "/portal/logga-in", MARIA);
  await page.fill("#kom-login-email", "lo.provsson@botkyrka.se");
  await btn(page, "Skicka kod").click();
  await expect(main(page)).toContainText("Om adressen lo.provsson@botkyrka.se finns hos oss har vi skickat en kod dit.");
  await page.fill("#kom-login-code", "000000");
  await btn(page, "Logga in").click();
  await expect.poll(() => currentPath(page, info), { timeout: 15_000 }).toBe("/portal/mina-uppgifter?forsta=1");
  await settle(page);
  await page.getByRole("navigation").getByRole("link", { name: "Beställ ny insats" }).first().click();
  await expect.poll(() => currentPath(page, info)).toBe("/portal/bestall");
  await settle(page);
  // Fälten är öppna från början (uppgifter saknas) – ingen sammanfattning med Ändra.
  await expect(page.locator("#kom-o-unit")).toHaveValue("");
  await expect(page.locator("#kom-o-phone")).toHaveValue("");
  await expect(page.locator("#kom-o-name")).toHaveValue("Lo Provsson");
  await expect(btn(page, "Ändra kontaktperson")).toHaveCount(0);
  // Första tecknet rättar felet i enheten – fältet ska finnas kvar med fokus, och resten av texten hamnar i det.
  await page.locator("#kom-o-unit").click();
  await page.keyboard.type("A");
  await expect(page.locator("#kom-o-unit"), "enheten finns kvar efter första tecknet").toBeFocused();
  await page.keyboard.type("rbetsmarknadsenheten Tumba");
  await expect(page.locator("#kom-o-unit")).toHaveValue("Arbetsmarknadsenheten Tumba");
  // Sjunde siffran gör telefonnumret giltigt – och det sista felet är rättat. Fälten fälls inte ihop.
  await page.locator("#kom-o-phone").click();
  await page.keyboard.type("08-530 610 00");
  await expect(page.locator("#kom-o-phone"), "telefonfältet har kvar fokus efter sjunde siffran").toBeFocused();
  await expect(page.locator("#kom-o-phone"), "hela numret").toHaveValue("08-530 610 00");
  for (const id of ["#kom-o-name", "#kom-o-unit", "#kom-o-phone", "#kom-o-email"]) await expect(page.locator(id), `${id} finns kvar`).toHaveCount(1);
  await expect(btn(page, "Ändra kontaktperson"), "ingen sammanfattning medan handläggaren skriver").toHaveCount(0);
  // Uppgifterna följer med till granskningen.
  await page.getByRole("group", { name: "Omfattning" }).getByRole("button", { name: "6 månader", exact: true }).click();
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Deltagare", exact: true })).toHaveCount(1);
  await btn(page, "Tillbaka").click();
  await expect(page.locator("#kom-o-unit"), "fälten är kvar när handläggaren går tillbaka").toHaveValue("Arbetsmarknadsenheten Tumba");
  await expect(page.locator("#kom-o-phone")).toHaveValue("08-530 610 00");
  expect(errors).toEqual([]);
});

// ================================================================ 4. Mina deltagare
test("4. mina deltagare: lista, sök, deltagarens sida, meddelanden och mötesförfrågan – inga belopp och ingen chefsvy", async ({ page }, info) => {
  const errors = await open(page, info, "/portal/deltagare", MARIA);
  await settle(page);
  let t = await mainText(page);
  expect(t, "listan använder begreppet deltagare").toMatch(/De deltagare som du har beställt en insats för/);
  expect(t).toMatch(/29 deltagare/i);
  // Beslut 2026-10-09: två urval, Pågår och Alla, och inget yrkesområde i raden.
  await expect(page.getByRole("group", { name: "Visa deltagare" }).getByRole("button")).toHaveText([/^Pågår \(29\)$/, /^Alla \(71\)$/]);
  expect(t).not.toMatch(/Yrkesområde inte valt än/);
  await page.fill("#kom-sok", "BOT-26-0143");
  const rows = main(page).locator("section").filter({ hasText: /deltagare/i }).getByRole("link", { name: /BOT-26-0143|Nadia/ });
  await expect(rows, "sök på ärendenummer").toHaveCount(1);
  await expect(main(page)).toContainText("Nadia Warsame");
  const rowText = await rows.first().innerText();
  await rows.first().click();
  await expect.poll(() => currentPath(page, info)).toBe(`/portal/deltagare/${SC.nadia}`);
  await settle(page);
  const area = ((await card(page, "Uppgifter om deltagaren").innerText()).match(/Yrkesområde\s+([^\n]+)/) ?? [])[1];
  expect(area, "deltagarens sida visar yrkesområdet").toBeTruthy();
  expect(rowText, "listans rad visar inte yrkesområdet").not.toContain(area as string);
  t = await mainText(page);
  expect(t, "tidslinje Mottagen → Avslutad").toMatch(/Ordererkänd[\s\S]*Bekräftad[\s\S]*Pågår[\s\S]*Avslutad/);
  expect(t, "orderbekräftelsens innehåll").toMatch(/Ansvarig coach\s+Amira Haddad/);
  // Orderbekräftelsen utan belopp och utan beställarreferens (synpunkt #10 och #11) – omfattningen visas.
  expect(t).toMatch(/Omfattning\s+10 veckor, till 19 februari 2027/);
  expect(t).not.toMatch(/Beställningens värde|Beställarreferens|\d\s?kr\b/);
  expect(t).toMatch(/Första mötet\s+måndag 14 december 2026 klockan 10\.00, Alby/);
  // Beslut 2026-10-09: närvaron är en rad – närvarograden senaste månaden och länken till rapporterna (där veckorapporterna
  // finns). Nadia 3 januari–1 februari: 8 närvarande och 1 sen av 9 registrerade tillfällen = 100 %.
  expect(t, "närvarograden senaste månaden").toMatch(/Närvarograd senaste månaden: 100\s%/);
  await expect(card(page, "Närvaro").getByRole("link", { name: "Till rapporterna" })).toHaveCount(1);
  expect(t, "ingen uppdelning i giltig och ogiltig frånvaro").not.toMatch(/Giltig frånvaro|Ogiltig frånvaro|Närvarande \d+ av/);
  // Ingen fasstapel och inget fasnamn, inget team, inget ordererkännande att visa och inga uppgifter som tagits bort.
  expect(t).not.toMatch(/Fas \d+ av \d+|fas \d+ av/);
  await expect(main(page).getByRole("progressbar")).toHaveCount(0);
  expect(t).not.toMatch(/Team:|Visa ordererkännandet|Kontaktväg|Bostadsort|Yrkesspår|Bakgrundsinformation från beställningen/);
  // Kvar: ärendets status, orderbekräftelsen och avbrott via mejl.
  expect(t).toMatch(/Insatsen pågår\./);
  await expect(linkOrBtn(page, "Öppna orderbekräftelsen")).toHaveCount(1);
  expect(t).toMatch(/Vill du avbryta insatsen\? Mejla avrop@miljonbemanning\.se/);
  expect(t.replace("Coachens egna anteckningar visas inte för beställaren", ""), "inga coachanteckningar").not.toMatch(/anteckning/i);
  await noHScroll(page, "Deltagarens översikt");
  await page.getByRole("tab", { name: /Rapporter/ }).click();
  await expect(main(page).getByRole("link", { name: /Månadsrapport december 2026/ }), "levererade rapporter listas").toHaveCount(1);
  await expect(main(page).getByRole("link", { name: /Orderbekräftelse/ })).toHaveCount(1);
  await page.getByRole("tab", { name: /Meddelanden/ }).click();
  await expect.poll(() => currentPath(page, info)).toBe(`/portal/deltagare/${SC.nadia}?flik=meddelanden`);
  await page.fill("#kom-msg", "Hej! Deltagaren har personnummer 19730216-9545.");
  await btn(page, "Skicka meddelandet").click();
  await expect(main(page), "personnummer i meddelandet stoppas").toContainText("ser ut som ett personnummer");
  await page.fill("#kom-msg", "Hej Amira! Tisdag förmiddag vecka 6 passar bra för uppföljningen.");
  await btn(page, "Skicka meddelandet").click();
  await expect(main(page).getByRole("log", { name: "Meddelanden" }), "meddelandet skickas").toContainText("Tisdag förmiddag vecka 6");
  await expect(page.locator("#kom-msg")).toHaveValue("");
  // Coachen får en notis utan meddelandets text
  await go(page, info, "/notiser", AMIRA);
  t = await mainText(page);
  expect(t).toMatch(/Nytt säkert meddelande om BOT-26-0143/);
  expect(t, "notisen innehåller inte meddelandets text").not.toMatch(/Tisdag förmiddag/);

  // Mötesförfrågan från coachen (scenario 5)
  await commands(page, info, [
    { key: "coach.deviationCallCustomer", input: { caseId: SC.yusuf, body: "Hej Maria! Jag vill boka ett uppföljningsmöte om frånvaron. Passar torsdag 4/2 kl. 13?", proposedAt: "2027-02-04T13:00" }, as: AMIRA },
  ]);
  await go(page, info, "/portal", MARIA);
  await expect(main(page), "mötesförfrågan syns bland olästa på startsidan").toContainText("Mötesförfrågan om BOT-26-0148");
  await go(page, info, `/portal/deltagare/${SC.yusuf}`, MARIA);
  await expect(main(page), "nytt meddelande lyfts fram i översikten").toContainText("Du har ett nytt meddelande");
  await go(page, info, `/portal/deltagare/${SC.yusuf}`, MARIA);
  await expect(main(page), "inte markerat som läst förrän det öppnas").toContainText("Du har ett nytt meddelande");
  await btn(page, "Läs och svara").click();
  await expect(main(page).getByRole("log", { name: "Meddelanden" }), "mötesförfrågan visas i tråden").toContainText("Mötesförfrågan");
  await expect(main(page).getByRole("log", { name: "Meddelanden" })).toContainText("Nytt");
  await btn(page, "Tiden passar").click();
  await expect(page.locator("#kom-msg"), "snabbsvar fyller i meddelandet").toHaveValue(/^Tack! Tiden passar/);
  // Svaret skickas inte här: sidan lämnas med text i fältet, och webbläsaren varnar (som den ska).
  allowLeaveWarnings(page);
  await go(page, info, `/portal/deltagare/${SC.yusuf}`, MARIA);
  await expect(main(page), "meddelandet är markerat som läst").not.toContainText("Du har ett nytt meddelande");
  await expect(card(page, "Mötesförfrågan från coachen"), "obesvarad mötesförfrågan finns kvar i översikten").toHaveCount(1);

  // Ärende som en annan handläggare beställt
  await go(page, info, `/portal/deltagare/${SC.elif}`, MARIA);
  await expect(main(page), "handläggaren ser inte andras ärenden").toContainText(/Du har inte tillgång/i);

  // Kommunens chef finns inte längre (beslut 2026-10-07): chefens gamla adresser leder till startsidan.
  for (const old of ["/portal/bestallarrapport", "/portal/resultat"]) {
    await go(page, info, old, MARIA);
    await expect.poll(() => currentPath(page, info), { message: old }).toBe("/portal");
  }
  expect(errors).toEqual([]);
});

// ================================================================ 5. Rapporter och meddelanden
test("5. rapporter och meddelanden: olästa först, filtren Olästa och Alla, trådar – inga rapporter på väg och ingen sökning", async ({ page }, info) => {
  const errors = await open(page, info, "/portal/rapporter", MARIA);
  await settle(page);
  const items = main(page).locator("section").last().getByRole("link");
  await expect(items.first(), "olästa rapporter först").toContainText("Ny");
  // Beslut 2026-10-09: inga rutor om rapporter på väg, ingen sökning och bara filtren Olästa och Alla.
  await expect(main(page)).not.toContainText("är på väg");
  await expect(page.locator("#kom-rap-q"), "ingen sökning").toHaveCount(0);
  const filters = page.getByRole("group", { name: "Visa rapporter" }).getByRole("button");
  await expect(filters).toHaveText([/^Olästa \(4\)$/, /^Alla \(\d+\)$/]);
  // Veckorapporterna, månadsrapporterna, slutrapporterna och orderbekräftelserna finns kvar i listan.
  const all = await main(page).locator("section").last().innerText();
  expect(all).toMatch(/Veckorapport närvaro/);
  expect(all).toMatch(/Månadsrapport/);
  expect(all).toMatch(/Slutrapport/);
  expect(all).toMatch(/Orderbekräftelse/);
  await filters.first().click();
  await expect.poll(() => currentPath(page, info)).toBe("/portal/rapporter?filter=olasta");
  const href = decodeURIComponent((await items.first().getAttribute("href")) ?? "");
  const repId = (href.match(/\/portal\/rapporter\/([^?#/]+)/) ?? [])[1];
  expect(repId).toBeTruthy();
  await items.first().click();
  // Listans val följer med (bara koder), så att tillbakaknappen visar samma lista.
  await expect
    .poll(() => currentPath(page, info), { message: "rapporten öppnas i portalens rapportsida" })
    .toMatch(new RegExp(`^/portal/rapporter/${repId}\\?fran=rapporter&lista=filter(=|%3D)olasta$`));
  await settle(page);
  await main(page).getByRole("link", { name: "Tillbaka till rapporterna" }).first().click();
  await expect.poll(() => currentPath(page, info), { message: "tillbaka till samma filter" }).toBe("/portal/rapporter?filter=olasta");
  await expect(filters.first()).toHaveAttribute("aria-pressed", "true");
  await expect(filters.first(), "rapporten räknas som läst").toHaveText(/^Olästa \(3\)$/);
  // Rapportsidan: ingen notis om att rapporten är kvitterad (beslut 2026-10-09).
  await go(page, info, `/portal/rapporter/${repId}`, MARIA);
  await expect(main(page)).not.toContainText("Rapporten är kvitterad");
  await go(page, info, "/portal/rapporter", MARIA);
  await page.getByRole("tab", { name: /Meddelanden/ }).click();
  await expect.poll(() => currentPath(page, info)).toBe("/portal/rapporter?flik=meddelanden");
  const t = await mainText(page);
  expect(t, "meddelanden per ärende").toMatch(/BOT-26-0148/);
  expect(t).toMatch(/BOT-26-0143/);
  await main(page).locator("section").first().getByRole("link").first().click();
  await expect.poll(() => currentPath(page, info), { message: "tråden öppnas i deltagarens meddelandeflik" }).toMatch(/^\/portal\/deltagare\/[^?]+\?flik=meddelanden$/);

  // En avslutad insats (BOT-26-0094, avslutad 18 december 2026): närvarograden för den sista månaden i insatsen – inte
  // "inte registrerad än" – och slutrapporten går att öppna från deltagarens flik Rapporter.
  await go(page, info, `/portal/deltagare/${SC.closed}`, MARIA);
  const closed = await mainText(page);
  expect(closed).toMatch(/Insatsen avslutades 18 december 2026/);
  expect(closed, "närvaron för den sista månaden i insatsen").toMatch(/Närvarograd den sista månaden i insatsen: 100\s%/);
  expect(closed).not.toMatch(/inte registrerad än/);
  await page.getByRole("tab", { name: /Rapporter/ }).click();
  await main(page).getByRole("link", { name: /Slutrapport/ }).click();
  await expect.poll(() => currentPath(page, info), { message: "slutrapporten öppnas i portalens rapportsida" }).toMatch(/^\/portal\/rapporter\/[^?]+/);
  await settle(page);
  await expect(main(page)).toContainText("Slutrapport");
  await expect(main(page)).toContainText("BOT-26-0094");
  expect(errors).toEqual([]);
});

// ================================================================ 5b. Uppgifter, avböjd beställning, orderbekräftelse och rättelser
test("5b. uppgift från Miljonbemanning, avböjd beställning, orderbekräftelsen bland olästa och rättad rapport – inga händelser på startsidan", async ({ page }, info) => {
  const errors = await open(page, info, "/portal", MARIA);
  await settle(page);
  // En portalbeställning som Miljonbemanning sedan accepterar
  await commands(page, info, [
    {
      key: "arenden.caseCreate",
      input: {
        source: "portal", firstName: "Samira", lastName: "Testsson", pnr: "19880412-3456", phone: "070-000 11 22", primaryArea: "G",
        referrerUnit: "Arbetsmarknadsenheten Alby", desiredStart: "2027-02-15", orderPeriodMonths: 6, priorAssessment: "yes",
      },
      as: MARIA,
    },
  ]);
  await go(page, info, "/portal/deltagare", MARIA);
  await page.fill("#kom-sok", "Testsson");
  const samira = await caseIdFromLink(page, /Samira Testsson/);
  await commands(page, info, [
    { key: "arenden.caseDecline", input: { caseId: SC.mall, reason: "Vi har ingen ledig plats inom avtalsområdet den önskade veckan." }, as: SARA },
    { key: "arenden.caseAccept", input: { caseId: samira, leadCoachId: "u-amira", firstMeetingAt: "2027-02-08T10:00", primaryArea: "G", vocationalTrack: "Truckförare A+B", orderPeriodMonths: 6 }, as: SARA },
    { key: "arenden.caseChangeCoach", input: { caseId: SC.nadia, toCoachId: "u-sofia", reason: "Amira är föräldraledig." }, as: SARA },
    { key: "coach.deviationSave", input: { caseId: SC.yusuf, data: { description: "Upprepad ogiltig frånvaro", action: "Möte med deltagaren", needsCustomerDecision: true } }, as: AMIRA },
  ]);
  await go(page, info, "/portal", MARIA);
  const t = await mainText(page);
  // Beslut 2026-10-09: inga händelser på startsidan – orderbekräftelsen kommer bland de olästa rapporterna.
  expect(t).not.toMatch(/Händelser i dina ärenden|kunde inte tas emot|Ny ansvarig coach/i);
  const unread = await main(page).locator("section").filter({ hasText: /Olästa rapporter och meddelanden/ }).first().innerText();
  expect(unread, "ny orderbekräftelse bland de olästa").toMatch(/Orderbekräftelse[\s\S]*BOT-27-0051/);
  expect(t, "uppgiften customer_decision").toMatch(/Att göra \(1\)/i);
  expect(t).toMatch(/Miljonbemanning behöver ditt beslut om BOT-26-0148/);
  expect(t, "inga förkortningar i datum").not.toMatch(/ kl\. |\b(jan|feb|dec)\b/);
  await noHScroll(page, "Startsidan med uppgift och olästa");
  // Avböjd syns i standardfiltret Pågår en tid – det finns inget eget filter för avböjda.
  await go(page, info, "/portal/deltagare", MARIA);
  await expect(main(page), "avböjd beställning i standardfiltret").toContainText("BOT-27-0050");
  await expect(page.getByRole("group", { name: "Visa deltagare" }).getByRole("button", { name: /^Avböjda/ })).toHaveCount(0);
  await main(page).getByRole("link").filter({ hasText: "BOT-27-0050" }).first().click();
  await settle(page);
  await expect(main(page), "orsaken visas i ärendet").toContainText("Vi har ingen ledig plats");
  // Uppgiften visas i ärendet och kan markeras som klar
  await go(page, info, `/portal/deltagare/${SC.yusuf}`, MARIA);
  await expect(main(page)).toContainText("Miljonbemanning behöver ditt beslut");
  await btn(page, "Markera som klar").first().click();
  await expect(main(page)).not.toContainText("Miljonbemanning behöver ditt beslut", { timeout: 10_000 });
  await go(page, info, "/portal", MARIA);
  await expect(main(page), "uppgiften är klar").not.toContainText(/Att göra \(/);

  // Rättelse: den levererade rapporten finns kvar tills den nya versionen är levererad (Sofia är Nadias coach efter bytet)
  await go(page, info, `/rapporter/${NADIA_DEC}`, SOFIA);
  await btn(page, "Rätta").click();
  await btn(page, "Skapa ny version").click();
  await page.fill("#rap-correct-reason", "Fel datum för praktikstart.");
  await btn(page, "Skapa ny version").click();
  await expect(page).not.toHaveURL(new RegExp(`/rapporter/${NADIA_DEC}$`));
  await expect(main(page), "den nya versionen öppnas").toContainText("Version 2 (visas nu)");
  const newRep = decodeURIComponent(page.url().split("/rapporter/")[1]);
  await go(page, info, `/portal/deltagare/${SC.nadia}?flik=rapporter`, MARIA);
  await expect(main(page), "rapporten som rättas finns kvar med märket").toContainText("Rättas – en ny version kommer");
  await expect(main(page).getByRole("link", { name: /Månadsrapport december 2026/ })).toHaveCount(1);
  await go(page, info, `/rapporter/${newRep}`, SOFIA);
  await btn(page, "Godkänn").click();
  await btn(page, "Leverera till kommunen").click();
  await btn(page, "Leverera i portalen").click();
  await expect(main(page)).toContainText(/Levererad version – låst sedan/);
  await go(page, info, `/portal/deltagare/${SC.nadia}?flik=rapporter`, MARIA);
  await expect(main(page).getByRole("link", { name: /Månadsrapport december 2026/ }), "bara den nya versionen visas").toHaveCount(1);
  await expect(main(page)).toContainText("version 2");
  await expect(main(page)).not.toContainText("Rättas – en ny version kommer");
  expect(errors).toEqual([]);
});

// ================================================================ 6. Månadsrapporten och orderbekräftelsen (beslut 2026-10-07)
test("6. månadsrapporten visar bara närvarograden i avsnitt 2 och orderbekräftelsen har inga belopp", async ({ page }, info) => {
  const errors = await open(page, info, `/portal/rapporter/${NADIA_DEC}`, MARIA);
  await settle(page);
  await expect(main(page)).toContainText(/Månadsrapport individ/i);
  const sec2 = main(page).locator("section").filter({ has: page.getByRole("heading", { name: /^2\. Närvaro$/ }) });
  await expect(sec2, "avsnitt 2 heter Närvaro").toHaveCount(1);
  await expect(sec2.locator("dt")).toHaveText(["Period", "Närvarograd"]);
  await expect(sec2.locator("dd").first()).toHaveText("1–31 december 2026");
  await expect(sec2.locator("dd").last()).toHaveText(/^86\s%$/);
  await expect(sec2).toContainText("Närvarograd = ");
  const t = await mainText(page);
  expect(t, "veckotabellen, orsakerna och upprepad frånvaro visas inte").not.toMatch(/Giltig frånvaro per orsak|Upprepad ogiltig frånvaro:|Planerade tillfällen|Närvaro och frånvaro/);
  // Orderbekräftelsen (dokumentet) – omfattningen, inga belopp.
  await go(page, info, `/portal/deltagare/${SC.nadia}`, MARIA);
  await linkOrBtn(page, "Öppna orderbekräftelsen").first().click();
  await settle(page);
  await expect(main(page)).toContainText(/Orderbekräftelse/);
  const oc = await mainText(page);
  expect(oc).toMatch(/Planerad omfattning\s+10 veckor \(till och med 19 februari 2027\)/);
  expect(oc, "inget pris, inget ordervärde").not.toMatch(/\d\s?kr\b|kronor|värde|pris/i);
  expect(oc).not.toMatch(/Saknas – måste kompletteras/);
  expect(errors).toEqual([]);
});

// ================================================================ 7. Inga belopp någonstans i portalen (synpunkt #10 och #11)
test("7. inga belopp, priser eller ordervärden på någon sida i portalen", async ({ page }, info) => {
  const MONEY = /\d\s?kr\b|kronor|värde|pris/i;
  const errors = await open(page, info, "/portal", MARIA);
  await settle(page);
  const pages = ["/portal", "/portal/deltagare", `/portal/deltagare/${SC.nadia}`, `/portal/deltagare/${SC.nadia}?flik=rapporter`, "/portal/rapporter", `/portal/rapporter/${NADIA_DEC}`, "/portal/mina-uppgifter"];
  for (const p of pages) {
    await go(page, info, p, MARIA);
    expect(await mainText(page), p).not.toMatch(MONEY);
  }
  // Beställningens fyra delar (tre steg och granskningen).
  await go(page, info, "/portal/bestall", MARIA);
  expect(await mainText(page), "steg 1").not.toMatch(MONEY);
  await page.getByRole("group", { name: "Omfattning" }).getByRole("button", { name: "12 månader" }).click();
  await btn(page, /^Nästa/).click();
  expect(await mainText(page), "steg 2").not.toMatch(MONEY);
  await page.fill("#kom-o-fn", "Pengar");
  await page.fill("#kom-o-ln", "Testsson");
  await page.fill("#kom-o-pnr", "19900101-1234");
  await page.fill("#kom-o-dphone", "070-000 22 33");
  await page.selectOption("#kom-o-area", "F");
  await btn(page, /^Nästa/).click();
  expect(await mainText(page), "steg 3").not.toMatch(MONEY);
  await page.getByRole("group", { name: "Har en kartläggning genomförts?" }).getByRole("button", { name: "Nej" }).click();
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Granska och skicka" })).toHaveCount(1);
  expect(await mainText(page), "granskningen").not.toMatch(MONEY);
  // Sidan lämnas med ett påbörjat formulär (webbläsaren varnar, som den ska).
  allowLeaveWarnings(page);
  expect(errors).toEqual([]);
});
