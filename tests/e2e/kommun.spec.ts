// Kommunens portal – port av den gamla prototypens tools/test-kommun.mjs (inloggning, startsida, beställning, deltagare,
// rapporter och meddelanden, händelser och uppgifter, beställarrapporten).
// Samma test körs mot prototypen (projekt "demo") och appen (projekt "app"). Data läses via skärmen. Steg som görs i andra
// områden (Miljonbemanning avböjer, accepterar, byter coach, kallar kommunen) körs som kommandon – i prototypen via
// kommandologgen som spelas upp vid omladdning, i appen via /api/rpc. Det som inte syns på skärmen (revisionslogg,
// senaste inloggning, rollkontroller) testas i src/features/kommun/handlers.test.ts.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

type As = { userId: string; role: string };
const MARIA: As = { userId: "k-maria", role: "kommun_handlaggare" };
const EVA: As = { userId: "k-eva", role: "kommun_chef" };
const SARA: As = { userId: "u-sara", role: "samordnare" };
const JOHAN: As = { userId: "u-johan", role: "avtalsansvarig" };
const AMIRA: As = { userId: "u-amira", role: "coach" };
const SOFIA: As = { userId: "u-sofia", role: "coach" };

// Testdatat (samma id:n som i den gamla prototypen, prototypens S.script)
const SC = { nadia: "case-260143", yusuf: "case-260148", elif: "case-270003", skyddad: "case-260120", mall: "case-270050" };
const NADIA_DEC = "rep-16008"; // månadsrapport december, levererad till Maria Ekdahl
const ACTOR_EXTRA: Record<string, { contractIds: string[]; customerUnit: string | null }> = {
  "k-maria": { contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" },
  "u-johan": { contractIds: ["c-bot", "c-kk"], customerUnit: null },
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
test("1. inloggning med e-post och engångskod (neutralt svar, kod, chefen, okänd adress, mobil)", async ({ page }, info) => {
  const errors = await open(page, info, "/portal/logga-in", MARIA);
  await expect(page.locator("#kom-login-email")).toHaveValue("maria.ekdahl@botkyrka.se");
  let t = await mainText(page);
  expect(t, "förklarar varför kod i stället för länk").toMatch(/Safe Links/);
  expect(t, "nämner utloggning efter 60 minuters inaktivitet").toMatch(/60 minuter utan aktivitet/);
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
  if (isDemo(info)) await expect(roleSelect(page)).toHaveValue("kommun_handlaggare");

  // Chefen loggar in med sin adress och hamnar på beställarrapporten
  await go(page, info, "/portal/logga-in", MARIA);
  if (isDemo(info)) await btn(page, /Fyll i Eva Bergström/).click();
  else await page.fill("#kom-login-email", "eva.bergstrom@botkyrka.se");
  await expect(page.locator("#kom-login-email")).toHaveValue("eva.bergstrom@botkyrka.se");
  await btn(page, "Skicka kod").click();
  await page.fill("#kom-login-code", "000000");
  await btn(page, "Logga in").click();
  await expect.poll(() => currentPath(page, info), { timeout: 15_000 }).toBe("/portal/bestallarrapport");
  await settle(page);
  await expect(page.getByRole("heading", { level: 1 }), "chefens adress loggar in som kommunens chef").toHaveText(/Beställarrapport/i);
  if (isDemo(info)) await expect(roleSelect(page)).toHaveValue("kommun_chef");

  // Okänd adress: samma neutrala svar, och koden godtas inte – ingen inloggning
  await go(page, info, "/portal/logga-in", MARIA);
  await page.fill("#kom-login-email", "okand.person@botkyrka.se");
  await btn(page, "Skicka kod").click();
  await expect(main(page)).toContainText("Om adressen okand.person@botkyrka.se finns hos oss");
  await page.fill("#kom-login-code", "123456");
  await btn(page, "Logga in").click();
  await expect(main(page), "okänd adress loggas inte in").toContainText("Koden stämmer inte eller har gått ut.");
  expect(currentPath(page, info)).toBe("/portal/logga-in");
  expect(errors).toEqual([]);
});

// ================================================================ 2. Startsida
test("2. startsidan för handläggaren: olästa överst, tre stora knappar och Visa alla olästa", async ({ page }, info) => {
  const errors = await open(page, info, "/portal", MARIA);
  await settle(page);
  const big = main(page).getByRole("navigation", { name: "Vad vill du göra?" }).getByRole("link");
  await expect(big, "tre stora knappar").toHaveCount(3);
  const texts = await big.allInnerTexts();
  expect(texts[0]).toMatch(/Beställ ny insats/);
  expect(texts[1]).toMatch(/Mina deltagare/);
  expect(texts[1]).toMatch(/27 pågår · 2 väntar på start/);
  expect(texts[2]).toMatch(/Rapporter och meddelanden/);
  expect(texts[2]).toMatch(/4 olästa/);
  let t = await mainText(page);
  expect(t, "olästa överst (4)").toMatch(/Olästa rapporter och meddelanden \(4\)/i);
  expect(t).toMatch(/Tre korta steg och en granskning/);
  expect(t).not.toMatch(/Visa alla olästa/);
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
  const firstNew = await main(page).locator("section").first().boundingBox();
  const firstBig = await big.first().boundingBox();
  expect(firstNew && firstBig && firstNew.y < firstBig.y, "olästa visas ovanför knapparna").toBeTruthy();
  await big.first().click();
  await expect.poll(() => currentPath(page, info), { message: "knappen öppnar beställningen" }).toBe("/portal/bestall");
  expect(errors).toEqual([]);
});

// ================================================================ 3. Beställning
test("3. beställning i tre steg och en granskning, kvittot och en beställning med skyddade personuppgifter", async ({ page }, info) => {
  // Nadias personnummer (för dubblettkontrollen) läses via "Visa" – visningen loggas.
  const errors = await open(page, info, `/portal/deltagare/${SC.nadia}`, MARIA);
  await settle(page);
  await card(page, "Uppgifter om deltagaren").getByRole("button", { name: "Visa" }).click();
  await expect(card(page, "Uppgifter om deltagaren")).toContainText("(visning loggad)");
  const nadiaPnr = ((await card(page, "Uppgifter om deltagaren").innerText()).match(/\d{8}-\d{4}/) ?? [""])[0];
  expect(nadiaPnr).toMatch(/^\d{8}-\d{4}$/);

  await go(page, info, "/portal/bestall", MARIA);
  await expect(page.locator("#kom-o-name")).toHaveValue("Maria Ekdahl");
  await expect(page.locator("#kom-o-email")).toHaveValue("maria.ekdahl@botkyrka.se");
  let t = await mainText(page);
  expect(t).toMatch(/Steg 1 av 3/i);
  expect(t).toMatch(/tre korta steg och en granskning/);
  const stepper = main(page).getByRole("list", { name: "Steg i beställningen" });
  await expect(stepper.getByRole("listitem")).toHaveCount(4);
  await expect(stepper.getByRole("listitem").last().locator("svg"), "granskningen visas utan stegnummer").toHaveCount(1);
  expect(t, "hjälptexten för referensen läses från avtalet").toMatch(/8–10 siffror, bara siffror/);
  if (isDemo(info)) await expect(btn(page, "Se hur beställningar tas emot hos Miljonbemanning")).toHaveCount(1);
  await expect(page.locator("#kom-o-ref"), "sparad beställarreferens förifylld").toHaveValue("4410023817");
  await page.fill("#kom-o-ref", "44100");
  await expect(main(page)).toContainText("ska vara 8–10 siffror. Du har skrivit 5");
  await page.fill("#kom-o-ref", "4410-0238");
  await expect(main(page)).toContainText("bara innehålla siffror");
  await page.fill("#kom-o-ref", "55102983");
  await expect(main(page), "spärrad referens upptäcks").toContainText("spärrad");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Beställning och kontakt" }), "kan inte gå vidare med fel referens").toHaveCount(1);
  await expect(main(page), "omfattning i veckor krävs").toContainText("Välj hur många veckor");
  await page.fill("#kom-o-ref", "4410023817");
  await expect(main(page)).toContainText("rätt format");
  await page.fill("#kom-o-start", "2027-02-15");
  await page.getByRole("group", { name: "Planerad omfattning i veckor" }).getByRole("button", { name: "8", exact: true }).click();
  await expect(page.locator("#kom-o-end"), "slutdatum räknas fram").toHaveValue("2027-04-09");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Deltagare", exact: true })).toHaveCount(1);
  await expect(main(page), "mallens text om dataminimering").toContainText("Lämna bara de uppgifter som behövs");
  await page.getByRole("group", { name: "Skyddade personuppgifter" }).getByRole("button", { name: "Nej" }).click();
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
  await page.fill("#kom-o-dphone", "070-000 11 22");
  await page.fill("#kom-o-city", "Tumba");
  await page.getByRole("group", { name: "Föredragen kontaktväg" }).getByRole("button", { name: "Brev" }).click();
  await expect(page.locator("#kom-o-addr"), "adressfält bara vid kallelse per brev").toBeVisible();
  await btn(page, /^Nästa/).click();
  await expect(main(page), "adress krävs vid brev").toContainText("Skriv hela adressen");
  await page.fill("#kom-o-addr", "Testgatan 1, 147 30 Tumba");
  await page.fill("#kom-o-needs", "Behöver skriftliga instruktioner.");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Avtalsområde" })).toHaveCount(1);
  await btn(page, /^Nästa/).click();
  await expect(main(page), "avtalsområde krävs").toContainText("Välj ett avtalsområde");
  await expect(page.locator("#kom-o-area option"), "A–L finns att välja").toHaveCount(13);
  await page.selectOption("#kom-o-area", "G");
  await page.selectOption("#kom-o-area2", "J");
  await page.getByRole("group", { name: "Förslag på yrkesspår" }).getByRole("button", { name: "Truckförare A+B" }).click();
  await expect(page.locator("#kom-o-track")).toHaveValue("Truckförare A+B");
  await page.fill("#kom-o-bg", "Har arbetat på lager i två år. Vill ta truckkort.");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Granska och skicka" })).toHaveCount(1);
  t = await mainText(page);
  expect(t, "granskningen räknas inte som ett fjärde steg").toMatch(/Granska innan du skickar/i);
  expect(t).not.toMatch(/Steg 4 av/i);
  expect(t, "personnumret maskerat i granskningen").toMatch(/•+-?3456/);
  expect(t).not.toMatch(/19880412-3456/);
  expect(t, "beställningens värde").toMatch(/Beställningens värde/i);
  expect(t).toMatch(/8 veckor ×/);
  await btn(page, "Skicka beställningen").click();
  await expect(main(page)).toContainText("Tack! Beställningen är skickad", { timeout: 15_000 });
  t = await mainText(page);
  expect(t, "ärendenummer (nästa i avtalets serie)").toMatch(/BOT-27-0051/);
  expect(t, "ordererkännandet visas direkt").toMatch(/Tack! Vi har tagit emot er beställning/);
  expect(t).toMatch(/Mejlet innehåller bara ärendenumret/);
  const mail = await card(page, "Mejlet du får").innerText();
  expect(mail, "mejlet innehåller ärendenumret men inga personuppgifter").toContain("BOT-27-0051");
  expect(mail).not.toMatch(/Samira|Testsson|3456|Tumba/);
  expect(t, "kvittot skriver datum utan förkortningar").not.toMatch(/\bkl\.|\b(jan|feb|dec)\b/);
  expect(t).toMatch(/klockan/);
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

  // Beställningen hos kommunen: portalen, väntar på bekräftelse, område och kontaktväg
  await go(page, info, `/portal/deltagare/${newId}`, MARIA);
  t = await mainText(page);
  expect(t).toMatch(/Väntar på bekräftelse/);
  expect(t).toMatch(/Beställningen kom in via portalen/);
  expect(t).toMatch(/G Lager och logistik \(alternativt J Parti- och detaljhandel\)/);
  expect(t).toMatch(/Kontaktväg\s+Brev/);
  // … och hos Miljonbemanning: beställarreferens och omfattning sparade
  await go(page, info, `/arenden/${newId}`, SARA);
  t = await mainText(page);
  expect(t).toContain("4410023817");
  expect(t).toMatch(/8 veckor/);

  // Beställ en till: senast använda referensen är förifylld
  await go(page, info, "/portal/bestall", MARIA);
  await expect(page.locator("#kom-o-ref")).toHaveValue("4410023817");

  // 3b. Skyddade personuppgifter
  await page.getByRole("group", { name: "Planerad omfattning i veckor" }).getByRole("button", { name: "6", exact: true }).click();
  await btn(page, /^Nästa/).click();
  await page.getByRole("group", { name: "Skyddade personuppgifter" }).getByRole("button", { name: "Ja" }).click();
  await expect(main(page)).toContainText("Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.");
  await expect(page.locator("#kom-o-dphone"), "telefon efterfrågas inte").toHaveCount(0);
  await expect(page.locator("#kom-o-city"), "ort efterfrågas inte").toHaveCount(0);
  await page.fill("#kom-o-fn", "Skyddad");
  await page.fill("#kom-o-ln", "Person");
  await page.fill("#kom-o-pnr", "19790101-1111");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Granska och skicka" }), "steg 3 hoppas över").toHaveCount(1);
  await expect(main(page)).toContainText("Avtalsområde (tas per telefon)");
  await btn(page, "Skicka beställningen").click();
  await expect(main(page)).toContainText("Tack! Beställningen är skickad", { timeout: 15_000 });
  t = await mainText(page);
  expect(t).toMatch(/BOT-27-0052/);
  expect(t, "kvittot beskriver den generiska bekräftelsen").toMatch(/utan ärendenummer och utan personuppgifter/);
  expect(t).not.toMatch(/Mejlet innehåller bara ärendenumret/);
  expect(t, "kvittot lovar ingen kallelse enligt vald kontaktväg").not.toMatch(/på det sätt du valde/);
  expect(t).toMatch(/säkra rutinen/);
  const protMail = await card(page, "Mejlet du får").innerText();
  expect(protMail, "bara generisk mottagningsbekräftelse i mejlet").not.toContain("BOT-27-0052");
  expect(protMail).toMatch(/Tack\. Vi har tagit emot beställningen\./);
  const protId = await caseIdFromLink(page, "Se beställningen");
  if (isDemo(info)) {
    await btn(page, "Se hur beställningen landar hos Miljonbemanning").click();
    await expect.poll(() => currentPath(page, info)).toBe(`/inkorg?arende=${protId}`);
    await expect(roleSelect(page), "skyddad beställning öppnas som avtalsansvarig").toHaveValue("avtalsansvarig");
  }
  // Avtalsansvarig har fått beställningen (en uppgift att ringa handläggaren)
  await go(page, info, `/inkorg?arende=${protId}`, JOHAN);
  await expect(main(page)).toContainText("BOT-27-0052");
  // Hos kommunen: bara namn och personnummer – inget avtalsområde, status Mottagen
  await go(page, info, `/portal/deltagare/${protId}`, MARIA);
  t = await mainText(page);
  expect(t).toMatch(/Mottagen/);
  expect(t).toMatch(/Avtalsområde\s+–/);
  expect(t).toMatch(/Om deltagaren sparar vi bara namn och personnummer/);
  expect(errors).toEqual([]);
});

// ================================================================ 4. Mina deltagare
test("4. mina deltagare: lista, sök, deltagarens sida, meddelanden, mötesförfrågan och chefens läsläge", async ({ page }, info) => {
  const errors = await open(page, info, "/portal/deltagare", MARIA);
  await settle(page);
  let t = await mainText(page);
  expect(t, "listan använder begreppet deltagare").toMatch(/De deltagare som du har beställt en insats för/);
  expect(t).toMatch(/29 deltagare/i);
  expect(t).toMatch(/Pågår och på väg \(29\)/);
  await page.fill("#kom-sok", "BOT-26-0143");
  const rows = main(page).locator("section").filter({ hasText: /deltagare/i }).getByRole("link", { name: /BOT-26-0143|Nadia/ });
  await expect(rows, "sök på ärendenummer").toHaveCount(1);
  await expect(main(page)).toContainText("Nadia Warsame");
  await rows.first().click();
  await expect.poll(() => currentPath(page, info)).toBe(`/portal/deltagare/${SC.nadia}`);
  await settle(page);
  t = await mainText(page);
  expect(t, "tidslinje Mottagen → Avslutad").toMatch(/Ordererkänd[\s\S]*Bekräftad[\s\S]*Pågår[\s\S]*Avslutad/);
  expect(t, "orderbekräftelsens innehåll").toMatch(/Ansvarig coach\s+Amira Haddad/);
  expect(t).toMatch(/Beställningens värde\s+13\s980\skr/);
  expect(t).toMatch(/Första mötet\s+måndag 14 december 2026 klockan 10\.00, Alby/);
  expect(t, "närvaron sammanfattad").toMatch(/Närvarande 9 av 9 tillfällen · 2 inte registrerade än/);
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
  await go(page, info, `/portal/deltagare/${SC.yusuf}`, MARIA);
  await expect(main(page), "meddelandet är markerat som läst").not.toContainText("Du har ett nytt meddelande");
  await expect(card(page, "Mötesförfrågan från coachen"), "obesvarad mötesförfrågan finns kvar i översikten").toHaveCount(1);

  // Ärende som en annan handläggare beställt
  await go(page, info, `/portal/deltagare/${SC.elif}`, MARIA);
  await expect(main(page), "handläggaren ser inte andras ärenden").toContainText(/Du har inte tillgång/i);

  // Chefen ser enhetens deltagare, men skyddade namn döljs
  await go(page, info, "/portal/deltagare", EVA);
  await expect(main(page)).toContainText(/Enhetens deltagare/i);
  await expect(page.locator("#kom-who"), "filter per handläggare").toHaveCount(1);
  await go(page, info, `/portal/deltagare/${SC.skyddad}`, EVA);
  t = await mainText(page);
  await expect(page.getByRole("heading", { level: 1 }), "skyddat namn visas inte för chefen").toHaveText(/Skyddade personuppgifter/i);
  expect(t).not.toMatch(/Lindgren/);
  await expect(page.locator("#kom-msg"), "chefen kan inte skriva meddelanden").toHaveCount(0);
  expect(t).toMatch(/Bara handläggaren som beställde/);
  await page.getByRole("tab", { name: /Meddelanden/ }).click();
  await expect(main(page)).toContainText("Meddelandena visas bara för handläggaren");
  if (isDemo(info)) {
    await btn(page, "Se samma deltagare hos Miljonbemanning").click();
    await expect.poll(() => currentPath(page, info)).toBe(`/arenden/${SC.skyddad}?flik=meddelanden`);
    await expect(roleSelect(page), "skyddat ärende byter till avtalsansvarig på samma flik").toHaveValue("avtalsansvarig");
    await settle(page);
    await expect(main(page), "bytet landar i en roll med åtkomst").not.toContainText(/Du saknar åtkomst|Ingen åtkomst|inte behörighet/);
  }

  // Chefen: texter i tredje person, mötesförfrågan i läsläge
  await commands(page, info, [{ key: "coach.deviationCallCustomer", input: { caseId: SC.elif, body: "Hej Linda! Kan vi ses om Elifs närvaro?", proposedAt: "2027-02-05T10:00" }, as: AMIRA }]);
  await go(page, info, `/portal/deltagare/${SC.elif}`, EVA);
  t = await mainText(page);
  expect(t, "chefen ser mötesförfrågan i läsläge").toMatch(/Mötesförfrågan till handläggaren/i);
  expect(t).toMatch(/Skickad till Linda Karlsson/);
  expect(t, "chefen får texter i tredje person").toMatch(/Handläggaren \(Linda Karlsson\) fick ärendenummer/);
  expect(t).not.toMatch(/Du fick ärendenummer/);
  expect(errors).toEqual([]);
});

// ================================================================ 5. Rapporter och meddelanden
test("5. rapporter och meddelanden: olästa först, väntande veckorapport, filter och trådar", async ({ page }, info) => {
  const errors = await open(page, info, "/portal/rapporter", MARIA);
  await settle(page);
  const items = main(page).locator("section").last().getByRole("link");
  await expect(items.first(), "olästa rapporter först").toContainText("Ny");
  await expect(main(page), "väntande veckorapport för vecka 4 förklaras").toContainText("Veckorapport närvaro, vecka 4 är på väg");
  await page.getByRole("group", { name: "Visa rapporter" }).getByRole("button", { name: /^Veckorapporter/ }).click();
  await expect(items.first(), "filter på veckorapporter").toContainText("Veckorapport närvaro");
  const href = decodeURIComponent((await items.first().getAttribute("href")) ?? "");
  const repId = (href.match(/\/portal\/rapporter\/([^?#/]+)/) ?? [])[1];
  expect(repId).toBeTruthy();
  await items.first().click();
  await expect.poll(() => currentPath(page, info), { message: "rapporten öppnas i portalens rapportsida" }).toBe(`/portal/rapporter/${repId}?fran=rapporter`);
  await settle(page);
  await expect(main(page)).toContainText(/Veckorapport närvaro/i);
  await go(page, info, "/portal/rapporter", MARIA);
  await page.getByRole("tab", { name: /Meddelanden/ }).click();
  await expect.poll(() => currentPath(page, info)).toBe("/portal/rapporter?flik=meddelanden");
  const t = await mainText(page);
  expect(t, "meddelanden per ärende").toMatch(/BOT-26-0148/);
  expect(t).toMatch(/BOT-26-0143/);
  await main(page).locator("section").first().getByRole("link").first().click();
  await expect.poll(() => currentPath(page, info), { message: "tråden öppnas i deltagarens meddelandeflik" }).toMatch(/^\/portal\/deltagare\/[^?]+\?flik=meddelanden$/);
  expect(errors).toEqual([]);
});

// ================================================================ 5b. Händelser, uppgifter och rättelser
test("5b. händelser i dina ärenden, uppgift från Miljonbemanning och rättad rapport", async ({ page }, info) => {
  const errors = await open(page, info, "/portal", MARIA);
  await settle(page);
  // En portalbeställning som Miljonbemanning sedan accepterar
  await commands(page, info, [
    {
      key: "arenden.caseCreate",
      input: {
        source: "portal", protectedIdentity: false, firstName: "Samira", lastName: "Testsson", pnr: "19880412-3456", phone: "070-000 11 22", city: "Tumba", preferredContact: "sms",
        buyerReference: "4410023817", primaryArea: "G", desiredStart: "2027-02-15", plannedWeeks: 8,
      },
      as: MARIA,
    },
  ]);
  await go(page, info, "/portal/deltagare", MARIA);
  await page.fill("#kom-sok", "Testsson");
  const samira = await caseIdFromLink(page, /Samira Testsson/);
  await commands(page, info, [
    { key: "arenden.caseDecline", input: { caseId: SC.mall, reason: "Vi har ingen ledig plats inom avtalsområdet den önskade veckan." }, as: SARA },
    { key: "arenden.caseAccept", input: { caseId: samira, leadCoachId: "u-amira", firstMeetingAt: "2027-02-08T10:00", plannedWeeks: 8, buyerReference: "4410023817" }, as: SARA },
    { key: "arenden.caseChangeCoach", input: { caseId: SC.nadia, toCoachId: "u-sofia", reason: "Amira är föräldraledig." }, as: SARA },
    { key: "coach.deviationSave", input: { caseId: SC.yusuf, data: { description: "Upprepad ogiltig frånvaro", action: "Möte med deltagaren", needsCustomerDecision: true } }, as: AMIRA },
  ]);
  await go(page, info, "/portal", MARIA);
  let t = await mainText(page);
  expect(t, "startsidan visar tre händelser").toMatch(/Händelser i dina ärenden \(3\)/i);
  expect(t, "avböjd beställning").toMatch(/Beställning BOT-27-0050 kunde inte tas emot/);
  expect(t, "byte av coach").toMatch(/Ny ansvarig coach för BOT-26-0143/);
  expect(t).toMatch(/Sofia Grahn har tagit över efter Amira Haddad\./);
  expect(t, "ny orderbekräftelse").toMatch(/Orderbekräftelse för BOT-27-0051/);
  expect(t, "uppgiften customer_decision").toMatch(/Att göra \(1\)/i);
  expect(t).toMatch(/Miljonbemanning behöver ditt beslut om BOT-26-0148/);
  expect(t, "inga förkortningar i datum").not.toMatch(/ kl\. |\b(jan|feb|dec)\b/);
  await noHScroll(page, "Startsidan med händelser");
  // Avböjd syns i standardfiltret och har ett eget filter
  await go(page, info, "/portal/deltagare", MARIA);
  await expect(main(page), "avböjd beställning i standardfiltret").toContainText("BOT-27-0050");
  await expect(page.getByRole("group", { name: "Visa deltagare" }).getByRole("button", { name: /^Avböjda/ })).toHaveCount(1);
  // Öppna den avböjda från startsidan – händelsen räknas som läst
  await go(page, info, "/portal", MARIA);
  await link(page, /Beställning BOT-27-0050 kunde inte tas emot/).click();
  await settle(page);
  await expect(main(page), "orsaken visas i ärendet").toContainText("Vi har ingen ledig plats");
  await go(page, info, "/portal", MARIA);
  t = await mainText(page);
  expect(t, "händelsen försvinner när ärendet har öppnats").not.toMatch(/BOT-27-0050 kunde inte tas emot/);
  expect(t).toMatch(/Händelser i dina ärenden \(2\)/i);
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

// ================================================================ 6. Beställarrapporten
test("6. beställarrapport för kommunens chef: avtalsmålet, små grupper, utkast och åtgärdsplan", async ({ page }, info) => {
  const errors = await open(page, info, "/portal/bestallarrapport", EVA);
  await settle(page);
  let t = await mainText(page);
  expect(t, "december visas som standard med förklaring").toMatch(/December 2026/);
  expect(t).toMatch(/senaste rapporten som har levererats/);
  expect(t, "avtalsmålet visas").toMatch(/Avtalsmålet är 32\s%/);
  expect(t).toMatch(/avtalsmål 32\s%/i);
  expect(t).toMatch(/31,2\s%/);
  expect(t, "internt mål visas aldrig").not.toMatch(/35\s%|internt/i);
  for (const tabName of ["Deltagare", "Progression", "Närvaro och nöjdhet"]) {
    await page.getByRole("tab", { name: tabName }).click();
    t = await mainText(page);
    expect(t, `fliken ${tabName}: inget internt mål`).not.toMatch(/35\s%|internt/i);
  }
  await page.getByRole("tab", { name: "Deltagare" }).click();
  t = await mainText(page);
  expect(t, "små grupper redovisas som färre än 5").toMatch(/färre än 5/);
  expect(t, "etiketter utan förkortningar").toMatch(/Aktiva under månaden/i);
  expect(t).toMatch(/Andel som svarat 4 eller 5 på en skala 1–5/);
  await expect(main(page).getByText("Under avtalsmålet").first(), "resultatrutan har statustext").toBeVisible();
  const kpi = await main(page).getByText(/Resultat, 6 månader/i).locator("..").innerText();
  expect(kpi, "resultatrutan har statustext och inte bara färg").toMatch(/Under avtalsmålet/);
  await noHScroll(page, "Beställarrapport");
  // Oktober: 4 av 6 avslut – täljaren är färre än 5 och andelen redovisas inte (samma regel som dokumentet)
  await page.getByRole("group", { name: "Välj månad" }).getByRole("button", { name: /Oktober 2026/ }).click();
  await expect(main(page)).toContainText("Sammanfattning oktober 2026");
  await page.getByRole("tab", { name: "Resultat" }).click();
  t = await mainText(page);
  expect(t, "små resultatgrupper döljs i oktober").toMatch(/färre än 5 av 6 avslut/);
  expect(t).toMatch(/Redovisas inte/);
  expect(t).not.toMatch(/66,7\s%/);
  expect(t).not.toMatch(/\b4 av 6\b/);
  await page.getByRole("group", { name: "Välj månad" }).getByRole("button", { name: /Januari 2027/ }).click();
  await expect(main(page)).toContainText("inte klar än");
  t = await mainText(page);
  expect(t, "januari är ett utkast utan siffror").toMatch(/Du ser inga siffror förrän rapporten är godkänd/);
  await expect(main(page).getByText(/Resultat, 6 månader/i), "inga nyckeltal för utkastet").toHaveCount(0);
  // Åtgärdsplan: godkänn i dialogen
  await expect(main(page)).toContainText("Väntar på ditt godkännande (1)");
  await expect(main(page)).toContainText("Visa (2)");
  await btn(page, "Godkänn åtgärdsplanen").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Godkänn åtgärdsplanen" }).click();
  await expect(main(page), "inget kvar att godkänna").not.toContainText("Väntar på ditt godkännande", { timeout: 10_000 });
  await expect(main(page), "planen är godkänd").toContainText("Visa (3)");
  await btn(page, "Visa (3)").click();
  await expect(main(page)).toContainText("Deltagare upplevde att praktikplatsen inte var förberedd första dagen.");
  // Miljonbemanning ser godkännandet med namn
  await go(page, info, "/avtalsavvikelser/cd-3", { userId: "u-karin", role: "chef" });
  await expect(main(page)).toContainText("Eva Bergström");
  if (isDemo(info)) {
    await go(page, info, "/portal/bestallarrapport", EVA);
    await btn(page, "Se samma resultat i Miljonbemannings ledningsvy").click();
    await expect.poll(() => currentPath(page, info)).toBe("/ledning");
    await expect(roleSelect(page)).toHaveValue("chef");
  }
  expect(errors).toEqual([]);
});
