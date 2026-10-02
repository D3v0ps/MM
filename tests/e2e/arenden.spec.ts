// Ärenden: ärendelistan (/arenden), deltagarkortet (/arenden/:caseId) och handledarens startsida (/handledare).
// Port av den gamla prototypens interaktionstest prototyp/tools/test-arenden.mjs (avsnitt 1–17). Samma test körs mot
// prototypen (projekt "demo") och riktiga appen (projekt "app"). Allt läses via skärmen – inte via internt tillstånd.
// Id:n och antal är testdatats (samma som den gamla prototypen: prototyp/tools/data-samples.json).
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

const SC = {
  nadia: "case-260143", // BOT-26-0143, Amira, praktik, olästa meddelandet msg-3 från Maria
  yusuf: "case-260148", // BOT-26-0148, upprepad ogiltig frånvaro, eskalerad till chef
  elif: "case-270003", // BOT-27-0003, samtycke inte tillfrågat, beställd av annan handläggare än Maria
  skyddad: "case-260120", // BOT-26-0120, skyddade personuppgifter (Sanna Lindgren), coach Erik
  ingetmote: "case-270039", // BOT-27-0039, första mötet inte bokat
  coachbyte: "case-260135", // BOT-26-0135, byte av huvudcoach
  annanCoach: "case-260117", // BOT-26-0117, Mats ärende – Amira har ingen åtkomst
};
const NADIA_DEC_REPORT = "rep-16008"; // Nadias levererade månadsrapport december 2026

type Who = { userId: string; role: string };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const JOHAN: Who = { userId: "u-johan", role: "avtalsansvarig" };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const LEILA: Who = { userId: "u-leila", role: "coach" };
const PETRA: Who = { userId: "u-petra", role: "handledare" };
const KARIN: Who = { userId: "u-karin", role: "chef" };

const main = (page: Page) => page.locator("#main");
const btn = (page: Page | Locator, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });
/** Knapp eller länk med knappens utseende (navigering är länkar i den nya appen). */
const action = (page: Page | Locator, name: string) => page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true }));
const table = (page: Page, name = "Ärenden") => page.getByRole("table", { name });
const rows = (page: Page) => table(page).locator("tbody tr");
const dialog = (page: Page) => page.getByRole("dialog");
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });

/**
 * Byt testperson utan att nollställa det man gjort (motsvarar att logga in som en annan person).
 * Prototypen: en tom sida på samma adress så att prototypen inte körs under bytet, sedan ny testperson och sökväg.
 */
async function switchTo(page: Page, info: TestInfo, to: string, who: Who) {
  if (isDemo(info)) {
    await page.route("http://proto.test/blank.html", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Byter testperson</title>" }));
    await page.goto("http://proto.test/blank.html");
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), who);
    await page.goto(`http://proto.test/index.html#${to}`);
  } else {
    await switchPersona(page, who);
    await page.goto(to);
  }
  await expect(main(page)).toBeVisible();
}

/** Knappar, text och klickytor på smal skärm: inget utanför korten, inga klippta knappar, klickytor minst 44 × 44 px. */
async function probe(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const out: string[] = [];
    const all = [...document.querySelectorAll("#main *"), ...document.querySelectorAll("[role=dialog] *")];
    for (const el of all) {
      if (!vis(el) || el.closest(".overflow-x-auto, [role=tablist], svg, .sr-only")) continue;
      const b = el.getBoundingClientRect();
      const box = el.parentElement && el.parentElement.closest("section, [role=dialog]");
      const text = ((el as HTMLElement).innerText || "").slice(0, 30);
      if (box) {
        const cb = box.getBoundingClientRect();
        if (b.right > cb.right + 1.5 || b.left < cb.left - 1.5) out.push(`${el.tagName} "${text}" utanför kortet`);
      }
      if (el.matches("button, a[class*='min-h-11']") && el.scrollWidth > el.clientWidth + 1) out.push(`knapp "${text}" klipps`);
      if (el.matches("button, [role=tab], select, a[class*='min-h-11']") && (b.height < 43.5 || b.width < 43.5)) out.push(`klickyta "${text}" ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return [...new Set(out)];
  });
}
const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ------------------------------------------------------------ 1. Ärendelistan som samordnare
test("1. ärendelistan: sidor om 50, sök, filter och skyddade ärenden utan namn", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden", SARA);
  await expect(rows(page)).toHaveCount(50);
  await expect(main(page)).toContainText("Visar 50 av 231");
  await btn(page, "Visa 50 till").click();
  await expect(rows(page)).toHaveCount(100);
  await page.fill("#arn-q", "0143");
  await expect(rows(page)).toHaveCount(1);
  await expect(table(page).locator("tbody")).toContainText("Nadia Warsame");
  await page.fill("#arn-q", "nadia warsame");
  await expect(rows(page)).toHaveCount(1);
  await btn(page, "Rensa filter").click();
  await page.selectOption("#arn-status", "closed");
  await expect(main(page)).toContainText(/134 ärenden/i);
  await page.selectOption("#arn-status", "alla");
  await page.selectOption("#arn-phase", "4");
  await expect(rows(page).first()).toBeVisible();
  const allPhase4 = await rows(page).evaluateAll((trs) => trs.every((tr) => (tr as HTMLElement).innerText.includes("Fas 4")));
  expect(allPhase4, "Fasfilter visar bara fas 4").toBe(true);
  await btn(page, "Rensa filter").first().click();
  await page.check("#arn-onlyprot");
  await expect(rows(page)).toHaveCount(1);
  const protText = await table(page).locator("tbody").innerText();
  expect(protText).toContain("Skyddade personuppgifter – ingen åtkomst");
  expect(protText).not.toContain("Sanna");
  await rows(page).first().click();
  await expect(page, "Skyddad rad går inte att öppna för samordnaren").toHaveURL(/\/arenden$/);
  await page.check("#arn-onlyflags");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 2. Skyddade som avtalsansvarig (scenario 10)
test("2. avtalsansvarig ser namn och deltagarkort i skyddat ärende – ingen AI och säker kontaktväg", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden?filter=skyddade", JOHAN);
  await expect(main(page)).toContainText("vem ser vad");
  await expect(table(page).locator("tbody")).toContainText("Sanna Lindgren");
  await rows(page).first().click();
  await expect(page).toHaveURL(new RegExp(`/arenden/${SC.skyddad}$`));
  await expect(main(page)).toContainText("Ej tillämpligt");
  await expect(btn(page, "Registrera samtycke")).toHaveCount(0);
  await expect(main(page)).toContainText("Telefon enligt den säkra rutinen");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 3. Coachens lista och åtkomst
test("3. coachen ser bara egna ärenden och får en tydlig ingen-åtkomst-ruta; nekade försök loggas", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden?filter=skyddade", AMIRA);
  await expect(main(page)).toContainText("Du har inga ärenden med skyddade personuppgifter");
  // Coachens synliga ärenden är bara egna och teamets (29 i testdatat, samma som prototypens sel.visibleCases).
  await btn(page, "Rensa filter").first().click();
  await expect(main(page)).toContainText("29 ärenden");
  await switchTo(page, info, `/arenden/${SC.skyddad}`, AMIRA);
  await expect(main(page)).toContainText("Du saknar åtkomst");
  await expect(main(page)).not.toContainText("Sanna");
  // Nekat försök loggas: coachen försöker öppna ett ärende utanför sitt team, chefen ser försöket i ärendets revisionslogg.
  await switchTo(page, info, `/arenden/${SC.annanCoach}`, AMIRA);
  await expect(main(page)).toContainText("Försöket att öppna kortet är loggat i revisionsloggen.");
  await switchTo(page, info, `/arenden/${SC.annanCoach}?flik=historik`, KARIN);
  const log = table(page, "Revisionslogg");
  await expect(log).toContainText("Försökte öppna deltagarkortet utan behörighet");
  await expect(log).toContainText("Amira Haddad");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 14. Olästa meddelanden från kommunen markeras i ärendelistan
// Körs före avsnitt 4: där läser Amira samma meddelande (riktiga appen behåller ändringar mellan testerna).
test("14. olästa meddelanden från kommunen markeras i listan och försvinner när de lästs", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden", AMIRA);
  await page.check("#arn-onlyunread");
  const body = table(page).locator("tbody");
  await expect(body).toContainText("BOT-26-0143");
  await expect(body.locator("tr", { hasText: "BOT-26-0143" })).toContainText("Nytt meddelande");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=meddelanden`, AMIRA);
  await expect(page.locator('[aria-label="Meddelanden"]')).toContainText("Läst av Amira Haddad");
  await switchTo(page, info, "/arenden", AMIRA);
  await page.fill("#arn-q", "0143");
  await expect(rows(page)).toHaveCount(1);
  await expect(body).not.toContainText("Nytt meddelande");
  await switchTo(page, info, "/arenden", KARIN);
  await expect(main(page)).toContainText("Läsläge – inga ändringar");
  await expect(page.locator("#arn-onlyunread")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 4. Deltagarkort, visning loggas, meddelanden
test("4. deltagarkortet: visningen loggas, olästa meddelanden markeras som lästa, personnummer stoppas", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, AMIRA);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nadia Warsame");
  await tab(page, /Meddelanden/).click();
  const thread = page.locator('[aria-label="Meddelanden"]');
  // msg-3 från Maria var oläst för Amira – läses när fliken öppnas.
  await expect(thread).toContainText("Tack! Kan vi ses på ett uppföljningsmöte vecka 6?");
  await expect(thread.locator("div", { hasText: /^Maria Ekdahl.*1 feb kl\. 08\.15/ }).first()).toContainText("Läst av Amira Haddad");
  const before = await thread.locator(":scope > div").count();
  await page.fill("#arn-msg-body", "Deltagaren 19730216-9545 har frågat om resor.");
  await btn(page, "Skicka säkert meddelande").click();
  await expect(main(page)).toContainText("Ta bort personnumret");
  await expect(thread.locator(":scope > div")).toHaveCount(before);
  await page.fill("#arn-msg-body", "Hej Maria! Tisdag vecka 6 kl. 10 passar bra för uppföljningsmötet.");
  await btn(page, "Skicka säkert meddelande").click();
  await expect(thread.locator(":scope > div")).toHaveCount(before + 1);
  await expect(thread.locator(":scope > div").last()).toContainText("Amira Haddad");
  await expect(thread.locator(":scope > div").last()).toContainText("Tisdag vecka 6 kl. 10 passar bra");
  // Mejlet till kommunen innehåller bara ärendenumret (utskicket kontrolleras i enhetstesterna för message.send).
  await expect(page.getByText("Meddelandet är skickat. Maria Ekdahl får ett mejl utan personuppgifter.")).toBeVisible();
  await expect(main(page)).toContainText("Du har ett nytt meddelande om ärende BOT-26-0143 – logga in för att läsa.");
  // Visningen av deltagarkortet är loggad: chefen ser den i ärendets revisionslogg.
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=historik`, KARIN);
  const log = table(page, "Revisionslogg");
  await expect(log.locator("tr", { hasText: "Amira Haddad" }).filter({ hasText: "Öppnade deltagarkortet" }).first()).toBeVisible();
  await expect(log).toContainText("Säkert meddelande skickades");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 5. Avvikelse och kallelse (scenario 5)
test("5. avvikelse med åtgärd och kallelse till kommunen som säkert meddelande", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.yusuf}?flik=avvikelser`, AMIRA);
  await expect(main(page)).toContainText("Upprepad ogiltig frånvaro");
  await expect(main(page)).not.toContainText(/eskaler/i);
  await btn(page, "Ny avvikelse").click();
  await btn(page, "Spara avvikelsen").click();
  await expect(main(page)).toContainText("En avvikelse ska alltid ha en åtgärd");
  await btn(page, "Upprepad ogiltig frånvaro").click();
  await page.fill("#arn-dev-assess", "Risk att insatsen avbryts om frånvaron fortsätter.");
  await page.fill("#arn-dev-action", "Samtal om hinder, ny veckoplan och uppföljningsmöte med handläggaren.");
  await page.fill("#arn-dev-follow", "2027-02-08");
  await page.check("#arn-dev-cust");
  await btn(page, "Spara avvikelsen").click();
  // Kräver kommunens beslut → kallelsen öppnas direkt.
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page)).toContainText(/Kalla kommunen till uppföljning/i);
  await btn(dialog(page), "Avbryt").click();
  await expect(dialog(page)).toHaveCount(0);
  const dev = main(page).locator("section", { hasText: "Öppen avvikelse" }).first();
  await expect(dev).toContainText("Samtal om hinder");
  await expect(dev).toContainText("Amira Haddad");
  await expect(dev).toContainText("8 feb 2027");
  await expect(dev).toContainText("Behövs");
  await btn(page, "Kalla kommunen till uppföljning").click();
  const body = await page.inputValue("#arn-call-body");
  expect(body).toContain("BOT-26-0148");
  expect(body).toContain("Upprepad ogiltig frånvaro");
  expect(body).not.toMatch(/19\d{6}-?\d{4}/);
  await expect(dialog(page)).toContainText("logga in för att läsa");
  await expect(dialog(page)).toContainText("maria.ekdahl@botkyrka.se");
  await page.fill("#arn-call-at", "2027-02-03T10:00");
  await btn(page, "Skicka kallelsen").click();
  await expect(main(page)).toContainText("Kallelsen är skickad");
  await expect(main(page)).toContainText("ett mejl utan personuppgifter");
  await expect(dev).toContainText("Föreslaget onsdag 3 feb 2027 kl. 10.00");
  await tab(page, /Meddelanden/).click();
  const last = page.locator('[aria-label="Meddelanden"]').locator(":scope > div").last();
  await expect(last).toContainText("Kallelse till uppföljning");
  await expect(last).toContainText("Vi vill kalla till ett uppföljningsmöte om ärende BOT-26-0148.");
  await tab(page, /Översikt/).click();
  await expect(main(page)).toContainText("Flaggor för ärendet");
  await expect(main(page)).not.toContainText(/eskaler/i);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 6. Chefen: läsläge och eskalering syns
test("6. chefen ser kortet i läsläge och eskaleringen, men kan inte ändra", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.yusuf}`, KARIN);
  await expect(main(page)).toContainText("Läsläge");
  await expect(main(page)).toContainText(/veckor i rad utan progression/);
  for (const name of ["Byt huvudcoach", "Återkalla samtycke", "Registrera samtycke", "Ny veckoavstämning"]) {
    await expect(action(page, name), `Chefen har ingen knapp "${name}"`).toHaveCount(0);
  }
  await tab(page, /Avvikelser/).click();
  await expect(main(page)).toContainText("En avvikelse är alltid en åtgärd");
  await expect(btn(page, "Kalla kommunen till uppföljning")).toHaveCount(0);
  await expect(btn(page, "Ny avvikelse")).toHaveCount(0);
  await tab(page, /Meddelanden/).click();
  await expect(main(page)).toContainText("Läsläge – du kan läsa tråden men inte skriva.");
  await expect(page.locator("#arn-msg-body")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 7. Samtycke (coach, Elif – inte tillfrågad)
test("7. samtycke kräver bekräftelse och kan återkallas", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.elif}`, AMIRA);
  await expect(main(page)).toContainText("Inte tillfrågad ännu");
  await btn(page, "Registrera samtycke").click();
  await btn(dialog(page), "Registrera samtycke").click();
  await expect(dialog(page)).toContainText("Bekräfta att deltagaren");
  await page.check("#arn-cons-ok");
  await btn(dialog(page), "Registrera samtycke").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(main(page)).toContainText("Samtycke registrerat");
  await expect(main(page)).toContainText("informerad av Amira Haddad · text v1.0 (2026-10-01) på lättläst svenska");
  await btn(page, "Återkalla samtycke").click();
  await btn(dialog(page), "Återkalla samtycket").click();
  await expect(main(page)).toContainText("Samtycket är återkallat");
  await expect(btn(page, "Registrera nytt samtycke")).toBeVisible();
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 8. Byt huvudcoach (samordnare)
test("8. byte av huvudcoach kräver orsak, loggas i historiken och ger notis", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.coachbyte}`, SARA);
  await btn(page, "Byt huvudcoach").click();
  await expect(dialog(page)).toContainText("kommunens godkännande");
  await btn(dialog(page), "Byt huvudcoach").click();
  await expect(dialog(page)).toContainText("Skriv orsaken");
  await page.selectOption("#arn-coach-to", "u-leila");
  await page.fill("#arn-coach-reason", "Sjukskrivning – Leila tar över från vecka 6.");
  await btn(dialog(page), "Byt huvudcoach").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(main(page).locator('dt:text-is("Huvudcoach") + dd')).toContainText("Leila Nouri");
  await tab(page, /Historik/).click();
  const hist = main(page).locator("section", { hasText: "Status och coachbyten" });
  await expect(hist).toContainText("→ Leila Nouri");
  await expect(hist).toContainText("Orsak: Sjukskrivning – Leila tar över från vecka 6.");
  await expect(hist).toContainText("Handläggaren fick notis");
  // Nya coachen har fått ärendet.
  await switchTo(page, info, "/arenden", LEILA);
  await page.fill("#arn-q", "0135");
  await expect(rows(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 9. Boka första möte (samordnare)
test("9. första mötet: tidsgränsen från avtalet, helgdag stoppas, mötet bokas", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.ingetmote}`, SARA);
  await expect(main(page)).toContainText("Första mötet är inte bokat");
  await expect(main(page)).toContainText("inom en vecka"); // Botkyrka: sju dagar (sla forsta_mote)
  await btn(page, "Boka första möte").first().click();
  await page.fill("#arn-meet-at", "2027-02-06T10:00");
  await btn(dialog(page), "Boka mötet").click();
  await expect(dialog(page)).toContainText("inte en arbetsdag");
  await page.fill("#arn-meet-at", "2027-02-02T13:00");
  await btn(dialog(page), "Boka mötet").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(main(page)).not.toContainText("Första mötet är inte bokat");
  await expect(main(page)).toContainText("Planerad 2 feb 2027");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 10. Handledaren
test("10. handledaren ser bara tilldelade ärenden och fyra flikar utan coachens anteckningar", async ({ page }, info) => {
  const errors = await open(page, info, "/handledare", PETRA);
  await expect(main(page)).toContainText("Du ser bara ärenden du är tilldelad");
  await expect(main(page)).toContainText("Pågående (26)");
  const cards = page.getByTestId("handledare-arenden").locator(":scope > section");
  await expect(cards).toHaveCount(12);
  await btn(page, "Visa fler").click();
  await expect(cards).toHaveCount(24);
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=avstamningar`, PETRA);
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(main(page)).toContainText("Den delen visas inte för din roll");
  await expect(main(page)).not.toContainText(/eskaler/i);
  await expect(main(page)).not.toContainText("Följde planen");
  await switchTo(page, info, `/arenden/${SC.yusuf}`, PETRA);
  await expect(main(page)).toContainText("Du ser bara ärenden du är tilldelad");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 11. Mobil: ingen horisontell scroll
test("11. 400 px: ingen horisontell scroll i listan, kortet och handledarens start", async ({ page }, info) => {
  await page.setViewportSize({ width: 400, height: 860 });
  const errors = await open(page, info, "/arenden", SARA);
  await expect(main(page)).toContainText("231 ärenden");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=narvaro`, AMIRA);
  await expect(main(page)).toContainText("Närvaro per ISO-vecka");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await switchTo(page, info, "/handledare", PETRA);
  await expect(main(page)).toContainText("Pågående (26)");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 12. Historik: coachen ser aldrig andras visningar
test("12. historiken: coachen ser status och egna åtgärder – aldrig chefens visningar eller eskaleringar", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.yusuf}`, KARIN);
  await expect(main(page)).toContainText("Läsläge");
  await switchTo(page, info, `/arenden/${SC.yusuf}?flik=historik`, AMIRA);
  await expect(main(page)).toContainText(/Dina åtgärder i ärendet/i);
  await expect(main(page)).toContainText(/Status och coachbyten/i);
  await expect(main(page)).toContainText("Avstämning godkändes");
  await expect(main(page)).not.toContainText("Karin Wallin");
  await expect(main(page)).not.toContainText(/Öppnade deltagarkortet/);
  await expect(main(page)).not.toContainText(/eskaler/i);
  expect(await table(page, "Dina åtgärder").locator("tbody tr").count()).toBeGreaterThan(0);
  await switchTo(page, info, `/arenden/${SC.yusuf}?flik=historik`, KARIN);
  await expect(main(page)).toContainText(/Revisionslogg för ärendet/i);
  await expect(table(page, "Revisionslogg")).toContainText("Karin Wallin");
  for (const [who, to] of [[AMIRA, "/arenden"], [AMIRA, "/arenden?filter=flaggor"], [PETRA, "/handledare"], [PETRA, "/arenden"]] as const) {
    await switchTo(page, info, to, who);
    await expect(main(page)).toContainText(/ärenden/i);
    await expect(main(page), `${who.role} ${to}: ingen text om eskalering`).not.toContainText(/eskaler/i);
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 13. Perspektivbyten (bara i prototypen)
test("13. perspektivbyten går till rätt roll och flik och döljs för skyddade ärenden", async ({ page }, info) => {
  test.skip(!isDemo(info), "Perspektivbytena finns bara i prototypen.");
  const role = page.getByLabel("Roll", { exact: true });
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=rapporter`, SARA);
  await btn(page, "Så ser kommunen rapporterna").click();
  await expect(page).toHaveURL(new RegExp(`/portal/deltagare/${SC.nadia}\\?flik=rapporter$`));
  await expect(role).toHaveValue("kommun_handlaggare");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=meddelanden`, SARA);
  await btn(page, "Se tråden som kommunen").click();
  await expect(page).toHaveURL(new RegExp(`/portal/deltagare/${SC.nadia}\\?flik=meddelanden$`));
  await expect(role).toHaveValue("kommun_handlaggare");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=meddelanden`, SARA);
  await btn(page, "Se ärendet som kommunen").click();
  await expect(page, "Huvudets perspektivbyte behåller fliken Meddelanden").toHaveURL(/\?flik=meddelanden$/);
  // Ärende från en annan handläggare: bytet går till kommunens chef och säger det.
  await switchTo(page, info, `/arenden/${SC.elif}?flik=avvikelser`, AMIRA);
  await expect(btn(page, "Se ärendet som kommunens chef")).toHaveCount(1);
  await btn(page, "Kalla kommunen till uppföljning").first().click();
  await btn(page, "Skicka kallelsen").click();
  await expect(main(page)).toContainText("finns inte som roll i prototypen");
  await btn(page, "Se kallelsen som kommunens chef").click();
  await expect(page).toHaveURL(new RegExp(`/portal/deltagare/${SC.elif}\\?flik=meddelanden$`));
  await expect(role).toHaveValue("kommun_chef");
  await expect(page.locator("body")).toContainText(/uppföljningsmöte/i);
  // Skyddat ärende: inget perspektivbyte till kund utan åtkomst, och en förklaring varför.
  for (const t of ["oversikt", "rapporter", "meddelanden", "avvikelser"]) {
    await switchTo(page, info, `/arenden/${SC.skyddad}?flik=${t}`, JOHAN);
    await expect(page.getByRole("tab", { selected: true })).toBeVisible();
    await expect(main(page).getByRole("button", { name: /som kommunen|kommunens chef|Så ser/ })).toHaveCount(0);
  }
  await expect(main(page)).toContainText("bara beställande handläggare");
  await switchTo(page, info, `/arenden/${SC.skyddad}`, KARIN);
  await expect(main(page)).toContainText("Du saknar åtkomst");
  await expect(main(page)).not.toContainText("Sanna");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 15. Texter på svenska och från avtalet
test("15. klarspråk ('Tidpunkt' i stället för 'Timing') och registreringstiden från avtalet", async ({ page }, info) => {
  const errors = await open(page, info, "/handledare", PETRA);
  await expect(main(page)).toContainText("Tidpunkt");
  await expect(main(page)).not.toContainText(/timing|deadline/i);
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=praktik`, AMIRA);
  await expect(main(page)).toContainText("rätt tidpunkt");
  await expect(main(page)).not.toContainText(/timing|deadline/i);
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=narvaro`, AMIRA);
  // Botkyrka: närvaron registreras senast måndag 10.00 (sla veckorapport_registrering). Nadia har två oregistrerade tillfällen.
  await expect(main(page)).toContainText("registrera senast måndag 10.00");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 16. Rättelse av levererad rapport syns
test("16. rapportfliken visar att en rättelse pågår och att kommunen ser den levererade versionen", async ({ page }, info) => {
  test.skip(!isDemo(info), "Rättelsen läggs in via prototypens kommandologg (riktiga appen: via rapportsidan).");
  // Samordnaren har rättat Nadias levererade decemberrapport (rapporter.reportCorrect) – läggs in som om det gjorts tidigare.
  const errors = await open(page, info, "/om", SARA);
  await page.route("http://proto.test/blank.html", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>–</title>" }));
  await page.goto("http://proto.test/blank.html");
  await page.evaluate(
    ([rid, who]) => {
      localStorage.setItem("miljonmatch-prototyp-v2-logg", JSON.stringify([{ key: "rapporter.reportCorrect", input: { reportId: rid }, actor: { ...who, contractIds: ["c-bot"], customerUnit: null } }]));
      localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(who));
    },
    [NADIA_DEC_REPORT, SARA] as const,
  );
  await page.goto(`http://proto.test/index.html#/arenden/${SC.nadia}?flik=rapporter`);
  await expect(main(page)).toContainText("Rättelse pågår");
  await expect(main(page)).toContainText("Kommunen ser den här versionen tills rättelsen levereras.");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 17. Mobil 400 px: klickytor och inget utanför korten
test("17. 400 px: knappar och text inom korten, klickytor minst 44 px, tabeller blir listor", async ({ page }, info) => {
  await page.setViewportSize({ width: 400, height: 860 });
  const errors = await open(page, info, "/handledare", PETRA);
  const check = async (name: string) => {
    await page.waitForTimeout(150);
    const r = await probe(page);
    expect(r, `400 px ${name}: ${r.slice(0, 3).join("; ")}`).toEqual([]);
  };
  await expect(main(page)).toContainText("Pågående (26)");
  await check("hand.start");
  await switchTo(page, info, "/arenden", AMIRA);
  await expect(main(page)).toContainText("29 ärenden");
  await check("arenden.lista");
  await switchTo(page, info, `/arenden/${SC.nadia}`, SARA);
  await expect(main(page)).toContainText("Kommande 14 dagar");
  await check("deltagarkortet översikt");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=rapporter`, SARA);
  await expect(main(page)).toContainText("Rapporter för BOT-26-0143");
  await check("deltagarkortet rapporter");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=meddelanden`, SARA);
  await expect(main(page)).toContainText("Säker tråd med kommunen");
  await check("deltagarkortet meddelanden");
  await switchTo(page, info, `/arenden/${SC.elif}?flik=avvikelser`, AMIRA);
  await btn(page, "Ny avvikelse").click();
  await check("ny avvikelse");
  await btn(page, "Kalla kommunen till uppföljning").first().click();
  await btn(page, "Skicka kallelsen").click();
  await expect(main(page)).toContainText("Kallelsen är skickad");
  await check("kallelse skickad");
  await switchTo(page, info, `/arenden/${SC.nadia}`, SARA);
  await btn(page, "Byt huvudcoach").click();
  await expect(dialog(page)).toBeVisible();
  await check("byt huvudcoach");
  for (const t of ["avstamningar", "narvaro", "rapporter", "historik"]) {
    await switchTo(page, info, `/arenden/${SC.nadia}?flik=${t}`, SARA);
    await expect(page.getByRole("tab", { selected: true })).toBeVisible();
    await page.waitForTimeout(150);
    const scroll = await page.evaluate(() => [...document.querySelectorAll("#main .overflow-x-auto:not([role=tablist])")].filter((el) => (el as HTMLElement).offsetParent && el.scrollWidth > el.clientWidth + 2).length);
    const r = await probe(page);
    expect(scroll, `400 px fliken ${t}: tabellerna visas som listor utan sidledsscroll`).toBe(0);
    expect(r, `400 px fliken ${t}: ${r.slice(0, 2).join("; ")}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});
