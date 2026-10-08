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
  skyddad: "case-260120", // BOT-26-0120 (Sanna Lindgren), coach Erik – var skyddat före 2026-10-07, nu ett vanligt ärende
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
const ROBIN: Who = { userId: "u-robin", role: "admin" };

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
test("1. ärendelistan: sidor om 50, sök och filter – inga skyddade ärenden (beslut 2026-10-07)", async ({ page }, info) => {
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
  // Skyddade personuppgifter är borttagna ur appen: inget filter, och ärendet som var skyddat är ett vanligt ärende.
  await expect(page.locator("#arn-onlyprot")).toHaveCount(0);
  await page.fill("#arn-q", "0120");
  await expect(rows(page)).toHaveCount(1);
  await expect(table(page).locator("tbody")).toContainText("Sanna Lindgren");
  await expect(table(page).locator("tbody")).not.toContainText("Skyddade personuppgifter");
  await btn(page, "Rensa filter").first().click();
  await page.check("#arn-onlyflags");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 2. Inga skyddade ärenden i gränssnittet (beslut 2026-10-07)
test("2. avtalsansvarig: ärendet som var skyddat öppnas som alla andra – ingen skyddsmarkering och ingen säker rutin", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.skyddad}`, JOHAN);
  await expect(main(page)).toContainText("Sanna Lindgren");
  await expect(main(page)).not.toContainText(/Skyddade personuppgifter|säkra rutinen/);
  // Det gamla filtret i adressen gör ingenting – listan visar alla ärenden.
  await switchTo(page, info, "/arenden?filter=skyddade", JOHAN);
  await expect(rows(page)).toHaveCount(50);
  await expect(main(page)).not.toContainText("Skyddade personuppgifter");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 3. Coachens lista och åtkomst
test("3. coachen ser bara egna ärenden och får en tydlig ingen-åtkomst-ruta; nekade försök loggas", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden", AMIRA);
  // Coachens synliga ärenden är bara egna och teamets (29 i testdatat, samma som prototypens sel.visibleCases).
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
test("10. handledaren ser bara tilldelade ärenden och fem flikar utan coachens anteckningar", async ({ page }, info) => {
  const errors = await open(page, info, "/handledare", PETRA);
  await expect(main(page)).toContainText("Du ser bara ärenden du är tilldelad");
  await expect(main(page)).toContainText("Pågående (26)");
  const cards = page.getByTestId("handledare-arenden").locator(":scope > section");
  await expect(cards).toHaveCount(12);
  await btn(page, "Visa fler").click();
  await expect(cards).toHaveCount(24);
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=avstamningar`, PETRA);
  await expect(page.getByRole("tab")).toHaveCount(5);
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
test("13. perspektivbyten går till rätt roll och flik – bara till handläggaren som beställde", async ({ page }, info) => {
  test.skip(!isDemo(info), "Perspektivbytena finns bara i prototypen.");
  // Kommunen har bara rollen handläggare (beslut 2026-10-07): prototypfältet visar kundens perspektiv utan rollväljare.
  const kund = page.getByRole("group", { name: "Perspektiv" }).getByRole("button", { name: "Kund" });
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=rapporter`, SARA);
  await btn(page, "Så ser kommunen rapporterna").click();
  await expect(page).toHaveURL(new RegExp(`/portal/deltagare/${SC.nadia}\\?flik=rapporter$`));
  await expect(kund).toHaveAttribute("aria-pressed", "true");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=meddelanden`, SARA);
  await btn(page, "Se tråden som kommunen").click();
  await expect(page).toHaveURL(new RegExp(`/portal/deltagare/${SC.nadia}\\?flik=meddelanden$`));
  await expect(kund).toHaveAttribute("aria-pressed", "true");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=meddelanden`, SARA);
  await btn(page, "Se ärendet som kommunen").click();
  await expect(page, "Huvudets perspektivbyte behåller fliken Meddelanden").toHaveURL(/\?flik=meddelanden$/);
  // Ärende från en annan handläggare än prototypens: inget perspektivbyte (kommunens chef finns inte sedan 2026-10-07).
  await switchTo(page, info, `/arenden/${SC.elif}?flik=avvikelser`, AMIRA);
  await expect(main(page).getByRole("button", { name: /som kommunen|kommunens chef/ })).toHaveCount(0);
  await btn(page, "Kalla kommunen till uppföljning").first().click();
  await btn(page, "Skicka kallelsen").click();
  await expect(main(page)).toContainText("Kallelsen är skickad");
  await expect(main(page).getByRole("button", { name: /Se kallelsen som/ })).toHaveCount(0);
  // Ärendet som var skyddat (en annan handläggare): inget perspektivbyte på någon flik. Chefen läser det som andra ärenden.
  for (const t of ["oversikt", "rapporter", "meddelanden", "avvikelser"]) {
    await switchTo(page, info, `/arenden/${SC.skyddad}?flik=${t}`, JOHAN);
    await expect(page.getByRole("tab", { selected: true })).toBeVisible();
    await expect(main(page).getByRole("button", { name: /som kommunen|kommunens chef|Så ser/ })).toHaveCount(0);
  }
  await switchTo(page, info, `/arenden/${SC.skyddad}`, KARIN);
  await expect(main(page)).toContainText("Sanna Lindgren");
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

// ------------------------------------------------------------ 18–22. Deltagarkortet som underlag (rapporter steg 2)
const NOTE_FULL = "Samtal om praktiken. Deltagaren vill öva mer på plockning.";
const NOTE_TEAM = "Praktikplatsen har ny starttid från måndag.";

/** Skriv en anteckning i tidslinjen (dialogen "Skriv anteckning"). */
async function writeNote(page: Page, body: string, opts: { team?: boolean } = {}) {
  await btn(page, "Skriv anteckning").click();
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Skriv anteckning" })).toBeVisible();
  await d.locator("#note-kind").selectOption("conversation");
  await d.locator("#note-body").fill(body);
  if (opts.team) await d.getByRole("radio", { name: "Även teamet (till exempel handledare)" }).check();
  await btn(d, "Spara anteckningen").click();
}

test("18. tidslinjen: huvudcoachen skriver en anteckning som syns med 'Skriven av'", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, AMIRA);
  await tab(page, /^Tidslinje/).click();
  await expect(main(page)).toContainText("Allt som hänt i insatsen, med det senaste först. Visa text fäller ut meddelandet eller avstämningens anteckning här. Öppna visar raden i sin flik – med Tillbaka kommer du hit igen.");
  await expect(page.getByRole("group", { name: "Visa" }).getByRole("button", { name: "Allt" })).toHaveAttribute("aria-pressed", "true");
  await expect(main(page)).toContainText("Månadsrapport: Levererad 8 januari 2027");
  await writeNote(page, NOTE_FULL);
  await expect(page.getByText("Anteckningen är sparad.")).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(main(page)).toContainText(NOTE_FULL);
  await expect(main(page)).toContainText("Skriven av Amira Haddad · Huvudcoach, samordnare, avtalsansvarig, chef och systemadministratör");
  // Filtret Anteckningar visar bara anteckningar.
  await page.getByRole("group", { name: "Visa" }).getByRole("button", { name: "Anteckningar" }).click();
  await expect(main(page)).toContainText(NOTE_FULL);
  await expect(main(page)).not.toContainText("Veckoavstämning vecka");
  expect(errors).toEqual([]);
});

test("19. anteckningen stoppas om texten liknar ett personnummer", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, AMIRA);
  await btn(page, "Skriv anteckning").click();
  const d = dialog(page);
  await d.locator("#note-kind").selectOption("practical");
  await d.locator("#note-body").fill("Ring deltagaren, 850101-1234, om tiden.");
  await btn(d, "Spara anteckningen").click();
  await expect(d).toContainText("Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.");
  await expect(d).toContainText("Kommunen ser aldrig anteckningar.");
  expect(errors).toEqual([]);
});

test("20. handledaren ser tidslinjen med teamets anteckning – inte den andra och inga avstämningar", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, AMIRA);
  await writeNote(page, NOTE_FULL);
  await expect(main(page)).toContainText(NOTE_FULL);
  await writeNote(page, NOTE_TEAM, { team: true });
  await expect(main(page)).toContainText(NOTE_TEAM);
  await expect(main(page)).toContainText("Skriven av Amira Haddad · Även teamet");
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, PETRA);
  await expect(tab(page, /^Tidslinje/)).toHaveAttribute("aria-selected", "true");
  await expect(main(page)).toContainText(NOTE_TEAM);
  await expect(main(page)).not.toContainText(NOTE_FULL);
  await expect(main(page)).not.toContainText("Veckoavstämning");
  await expect(main(page)).not.toContainText("Månadsrapport:");
  await expect(main(page)).toContainText("tidslinjen med anteckningar som är skrivna för teamet");
  expect(errors).toEqual([]);
});

test("21. månadsunderlaget visar rapportens avsnitt 1–8 och vad som saknas innan rapporten kan godkännas", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=manad`, AMIRA);
  await expect(tab(page, /^Månadsunderlag/)).toHaveAttribute("aria-selected", "true");
  await expect(main(page)).toContainText("Det här är samma innehåll som kommer i månadsrapporten till kommunen. Bara godkända uppgifter kommer med.");
  await expect(main(page)).toContainText("Innan rapporten kan godkännas");
  // Antalet godkända avstämningar under månaden – jämförs inte med antalet veckor (vecka 53 hör till både december och januari).
  await expect(main(page)).toContainText("4 veckoavstämningar är godkända.");
  await expect(main(page)).not.toContainText(/\d+ av \d+ veckoavstämning/);
  await expect(main(page)).toContainText("2 närvarotillfällen är inte registrerade.");
  await expect(main(page)).toContainText("Månadsbedömningen är inte godkänd. Avsnitt 4, 7 och 8 blir tomma.");
  await expect(main(page)).toContainText("3 anteckningar från januari kan användas i sammanfattningen.");
  await expect(page.getByRole("link", { name: "Gör månadsbedömningen" })).toBeVisible();
  for (const h of ["1. Grunduppgifter", "2. Närvaro", "3. Genomförda aktiviteter", "4. Progression", "5. Resultat och utfall", "6. Avvikelse, risk och åtgärd", "7. Plan för nästa månad", "8. Coachens sammanfattande bedömning"]) {
    await expect(main(page).getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(main(page)).toContainText("Progression över tid");
  // Levererad månad: länk till rapporten i stället för förhandsvisningen.
  await page.locator("#manad-val").selectOption("2026-12");
  await expect(main(page)).toContainText("Månadsrapporten för december är levererad till kommunen 8 januari 2027 (version 1).");
  await expect(page.getByRole("link", { name: "Öppna rapporten" })).toBeVisible();
  await expect(main(page)).not.toContainText("Innan rapporten kan godkännas");
  expect(errors).toEqual([]);
});

test("23. 400 px: tidslinjen, dialogen och månadsunderlaget – inget utanför korten, klickytor minst 44 px, ingen sidledsscroll", async ({ page }, info) => {
  await page.setViewportSize({ width: 400, height: 860 });
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, AMIRA);
  const check = async (name: string) => {
    await page.waitForTimeout(150);
    const r = await probe(page);
    expect(r, `400 px ${name}: ${r.slice(0, 3).join("; ")}`).toEqual([]);
    expect(await horizontalOverflow(page), `400 px ${name}: sidledsscroll`).toBeLessThanOrEqual(1);
  };
  await expect(main(page)).toContainText("Samtal med deltagaren");
  await check("tidslinjen");
  await btn(page, "Skriv anteckning").click();
  await expect(dialog(page)).toBeVisible();
  await check("skriv anteckning");
  await btn(dialog(page), "Avbryt").click();
  // Månadsunderlaget: matrisen och rapportens tabeller får rulla i sidled i sin egen ruta – sidan får inte.
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=manad`, AMIRA);
  await expect(main(page)).toContainText("Innan rapporten kan godkännas");
  await check("månadsunderlaget");
  expect(errors).toEqual([]);
});

test("22. chefen ser tidslinjen och månadsunderlaget utan knappar som ändrar något", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, KARIN);
  await expect(tab(page, /^Tidslinje/)).toHaveAttribute("aria-selected", "true");
  await expect(main(page)).toContainText("Samtal med deltagaren");
  await expect(btn(page, "Skriv anteckning")).toHaveCount(0);
  await expect(main(page).getByRole("button", { name: /^Ändra|^Ta bort/ })).toHaveCount(0);
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=manad`, KARIN);
  await expect(main(page)).toContainText("Huvudcoachen gör månadsbedömningen.");
  await expect(page.getByRole("link", { name: "Gör månadsbedömningen" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("24. ta bort en anteckning: samordnaren döljer coachens anteckning, Esc behåller den, författaren ser vem som tog bort den; admin läser bara", async ({ page }, info) => {
  const SAMTAL = "Samtal om praktiken på lagret.";
  const EGEN = "Praktikplatsen flyttar starttiden till 07.30";
  const note = (text: string) => main(page).getByRole("listitem").filter({ hasText: text });
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, SARA);
  // Samordnaren: "Ta bort" på huvudcoachens anteckning, men inte "Ändra".
  await expect(note(SAMTAL)).toHaveCount(1);
  await expect(note(SAMTAL).getByRole("button", { name: /^Ändra/ })).toHaveCount(0);
  await note(SAMTAL).getByRole("button", { name: /^Ta bort/ }).click();
  const d = dialog(page);
  await expect(d.getByRole("heading", { name: "Ta bort anteckningen?" })).toBeVisible();
  await expect(d).toContainText("Anteckningen visas inte längre i deltagarkortet. Amira Haddad ser att du har tagit bort den.");
  // Esc avbryter – anteckningen finns kvar.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(note(SAMTAL)).toHaveCount(1);
  await note(SAMTAL).getByRole("button", { name: /^Ta bort/ }).click();
  await btn(dialog(page), "Ta bort").click();
  await expect(page.getByText("Anteckningen är borttagen.")).toBeVisible();
  await expect(main(page)).not.toContainText(SAMTAL);
  // Knappen finns inte längre: fokus hamnar på månadens rubrik, inte högst upp på sidan.
  await expect(page.locator("#tl-2027-01")).toBeFocused();

  // Författaren ser att samordnaren tog bort den – utan knappar.
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, AMIRA);
  await expect(note(SAMTAL)).toContainText(/Borttagen av Sara Lindqvist 1 feb/);
  await expect(note(SAMTAL).getByRole("button")).toHaveCount(0);
  // Sin egen anteckning: standardtexten. Avbryt behåller den.
  await note(EGEN).getByRole("button", { name: /^Ta bort/ }).click();
  await expect(dialog(page)).toContainText("Anteckningen visas inte längre i deltagarkortet. Den sparas till dess att den gallras och kan inte tas tillbaka här.");
  await expect(dialog(page)).not.toContainText("ser att du har tagit bort den");
  await btn(dialog(page), "Avbryt").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(note(EGEN)).toHaveCount(1);

  // Systemadministratören läser anteckningarna men skriver, ändrar och tar inte bort.
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, ROBIN);
  await expect(note(EGEN)).toHaveCount(1);
  await expect(main(page)).not.toContainText(SAMTAL);
  await expect(btn(page, "Skriv anteckning")).toHaveCount(0);
  await expect(main(page).getByRole("button", { name: /^Ändra|^Ta bort/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("25. Anteckningsdialogen: skriven text försvinner inte utan att coachen får frågan (Esc och Registrera händelse)", async ({ page }, info) => {
  const TEXT = "Arbetsgivaren på lagret vill träffa Nadia nästa vecka.";
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, AMIRA);
  await btn(page, "Skriv anteckning").click();
  const note = page.getByRole("dialog", { name: "Skriv anteckning" });
  await note.locator("#note-body").fill(TEXT);
  // Samma fråga överallt när det finns skriven text: Esc, Avbryt och länken Registrera händelse.
  const ask = page.getByRole("dialog", { name: "Vill du slänga det du skrivit?" });
  await page.keyboard.press("Escape");
  await expect(ask).toContainText("Det du har skrivit i rutan sparas inte.");
  await btn(ask, "Fortsätt skriva").click();
  await expect(ask).toHaveCount(0);
  await expect(note.locator("#note-body")).toHaveValue(TEXT);
  await note.getByRole("link", { name: "Registrera händelse" }).click();
  await expect(ask).toBeVisible();
  await btn(ask, "Fortsätt skriva").click();
  await expect(ask).toHaveCount(0);
  await expect(note.locator("#note-body")).toHaveValue(TEXT);
  await note.getByRole("link", { name: "Registrera händelse" }).click();
  await btn(ask, "Släng").click();
  await expect(page).toHaveURL(new RegExp(`/handelse/${SC.nadia}`));
  expect(errors).toEqual([]);
});

test("26. tidslinjen: Visa text fäller ut meddelandet och avstämningens anteckning på plats – ihopfällt som standard, hämtat först då, bara för den som får läsa", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=tidslinje`, AMIRA);
  const rpc: string[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/rpc")) return;
    try {
      rpc.push(String(JSON.parse(r.postData() || "{}").key));
    } catch {
      /* ignoreras */
    }
  });
  const textRpc = () => rpc.filter((k) => k === "arenden.kortTidslinjeText").length;
  const MSG = "Tack! Kan vi ses på ett uppföljningsmöte vecka 6?";
  const row = main(page).getByRole("listitem").filter({ hasText: "Meddelande från kommunen" }).first();
  await expect(row).toBeVisible();
  // Ihopfällt som standard: grundvyn upprepar ingen fritext, knappen säger att texten kan fällas ut.
  await expect(main(page)).not.toContainText(MSG);
  const show = row.getByRole("button", { name: "Visa text" });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  expect(await show.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect(tab(page, /^Meddelanden/)).toContainText("1");
  await show.click();
  const region = row.getByRole("region", { name: "Meddelande från kommunen" });
  await expect(region).toContainText(MSG);
  await expect(region).toContainText("Maria Ekdahl");
  // Texten visades: meddelandet markeras som läst (bara det), som på fliken Meddelanden (granskning 2026-10-03).
  await expect(region).toContainText("Läst av Amira Haddad");
  await expect(tab(page, /^Meddelanden/)).not.toContainText(/\d/);
  const hide = row.getByRole("button", { name: "Dölj text" });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  expect(await hide.getAttribute("aria-controls")).toBe(await region.getAttribute("id"));
  if (!isDemo(info)) expect(textRpc(), "texten hämtas med en egen fråga när den fälls ut – och en gång till efter läskvittot").toBe(2);
  await hide.click();
  await expect(region).toHaveCount(0);
  await expect(main(page)).not.toContainText(MSG);
  await row.getByRole("button", { name: "Visa text" }).click();
  await expect(row.getByRole("region", { name: "Meddelande från kommunen" })).toContainText(MSG);
  if (!isDemo(info)) expect(textRpc(), "andra utfällningen hämtar inte igen").toBe(2);
  // "Öppna" finns kvar som sekundär väg till fliken.
  await expect(row.getByRole("button", { name: "Öppna: Meddelande från kommunen" })).toBeVisible();

  // En godkänd veckoavstämning: anteckning och hinder – samma text som fliken Avstämningar visar. Raden låses på sin
  // rubrik (ett filter på knappen "Visa text" skulle lösas om när knappen byter namn till "Dölj text").
  const firstCi = main(page).getByRole("listitem").filter({ hasText: /Veckoavstämning vecka \d+ godkänd/ }).filter({ has: page.getByRole("button", { name: "Visa text" }) }).first();
  const ciTitle = (await firstCi.innerText()).match(/Veckoavstämning vecka \d+ godkänd/)?.[0] ?? "";
  expect(ciTitle).not.toBe("");
  const ci = main(page).getByRole("listitem").filter({ hasText: ciTitle }).first();
  await ci.getByRole("button", { name: "Visa text" }).click();
  const ciRegion = ci.getByRole("region", { name: ciTitle });
  await expect(ciRegion).toContainText("Anteckning:");
  await expect(ciRegion).toContainText("Hinder:");
  const note = (await ciRegion.innerText()).split("Anteckning:")[1]?.split("\n")[0]?.trim() ?? "";
  expect(note.length).toBeGreaterThan(10);
  await tab(page, /^Avstämningar/).click();
  await expect(main(page)).toContainText(note.slice(0, 40));
  expect(errors).toEqual([]);
});

test("27. tidslinjens text: handledaren får inga sådana poster, chefen fäller ut utan att något loggas", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}?flik=historik`, KARIN);
  const logTable = page.getByRole("table", { name: "Revisionslogg" });
  await expect(logTable).toBeVisible();
  const rowsBefore = await logTable.locator("tbody tr").count();
  await tab(page, /^Tidslinje/).click();
  const row = main(page).getByRole("listitem").filter({ hasText: "Meddelande från kommunen" }).first();
  await row.getByRole("button", { name: "Visa text" }).click();
  await expect(row.getByRole("region", { name: "Meddelande från kommunen" })).toContainText("Tack! Kan vi ses");
  // Samma loggning som på fliken Meddelanden: ingen extra rad för utfällningen (kortets öppning loggades redan).
  await switchTo(page, info, `/arenden/${SC.nadia}?flik=historik`, KARIN);
  await expect(page.getByRole("table", { name: "Revisionslogg" })).toBeVisible();
  // Karins egen nya öppning av kortet ger högst en ny rad – ingen rad om text eller meddelande.
  const after = page.getByRole("table", { name: "Revisionslogg" }).locator("tbody tr");
  expect((await after.count()) - rowsBefore).toBeLessThanOrEqual(1);
  await expect(page.getByRole("table", { name: "Revisionslogg" })).not.toContainText(/Visade meddelande|Visade text|Visade avstämning/);
  // Handledaren i ett teamärende: inga meddelande- eller avstämningsposter alls, alltså inga "Visa text".
  await switchTo(page, info, "/arenden/case-260167?flik=tidslinje", PETRA);
  await expect(main(page)).toContainText("Allt som hänt i insatsen");
  await expect(main(page).getByRole("button", { name: "Visa text" })).toHaveCount(0);
  await expect(main(page)).not.toContainText("Meddelande från kommunen");
  expect(errors).toEqual([]);
});
