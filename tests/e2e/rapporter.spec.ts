// Rapporter: listan, rapportsidan och kommunportalens rapportsida – port av den gamla prototypens tools/test-rapporter.mjs.
// Samma test körs mot prototypen (projekt "demo") och appen (projekt "app"). Data läses via skärmen.
// Steg som bygger på andra områdens skärmar (godkänn månadsbedömningen, registrera närvaro, avsluta ärendet) körs som
// kommandon – i prototypen via kommandologgen som spelas upp vid omladdning, i appen via /api/rpc.
// Det som inte syns på skärmen (utskickets text, revisionsloggen, ögonblicksbilden) testas i src/features/rapporter/handlers.test.ts.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

type As = { userId: string; role: string };
const SAMORDNARE: As = { userId: "u-sara", role: "samordnare" };
const AVTALSANSVARIG: As = { userId: "u-johan", role: "avtalsansvarig" };
const COACH: As = { userId: "u-amira", role: "coach" };
const HANDLEDARE: As = { userId: "u-petra", role: "handledare" };
const HANDLAGGARE: As = { userId: "k-maria", role: "kommun_handlaggare" };

// Testdatat (samma id:n som i den gamla prototypen)
const NADIA = "case-260143";
const NADIA_JAN = "rep-16011";
const NADIA_DEC = "rep-16008";
const APPROVED_JAN = "rep-15642";
const CS_JAN = "rep-16699";
const CS_DEC = "rep-16698";
const WEEKLY_WAIT = "rep-16692";
const WEEKLY_MISSING = ["a-12496", "a-12497", "a-14070", "a-14071"]; // Amiras oregistrerade tillfällen vecka 4
const FIN_DEL = "rep-16258";
const UNDELIVERED = "rep-15879"; // månadsrapport (utkast) till Maria Ekdahl
const UNOPENED = "rep-15828"; // levererad till Maria Ekdahl, inte öppnad
const DEC_ACT = "a-12459"; // Nadias närvaro i december
const JAN_ACT = "a-12477"; // Nadias närvaro i januari
const AMIRA_ACTIVE = { id: "case-260119", number: "BOT-26-0119" };
// Ärendet som var skyddat före 2026-10-07 (Omar Farahs beställning) – nu ett vanligt ärende.
const PROT_JAN = "rep-15885";
const PROT_DEL = "rep-15882";
const PETRA_FINAL = "rep-16265";
const DRAFT_FINAL = { id: "rep-16356", lead: "u-leila" };

// ---------------------------------------------------------------- Hjälpare
const main = (page: Page) => page.locator("#main");
const mainText = (page: Page) => main(page).innerText();
const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const linkOrBtn = (page: Page, name: string) => page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
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
  await expect(main(page)).not.toContainText("Hämtar…", { timeout: 15_000 });
  await page.waitForTimeout(300);
}

type Cmd = { key: string; input: unknown; as: As };
/** Kör kommandon (andra områdens steg) som testpersonen. Prototypen: via kommandologgen; appen: via /api/rpc. */
async function commands(page: Page, info: TestInfo, cmds: Cmd[]) {
  if (isDemo(info)) {
    await page.evaluate(({ key, cmds }) => {
      const log = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
      for (const c of cmds) log.push({ key: c.key, input: c.input, actor: { userId: c.as.userId, role: c.as.role, contractIds: ["c-bot"], customerUnit: null } });
      localStorage.setItem(key, JSON.stringify(log));
    }, { key: LOG_KEY, cmds });
    await page.reload();
    return;
  }
  for (const c of cmds) {
    await switchPersona(page, c.as);
    const res = await page.request.post("/api/rpc", { data: { kind: "command", key: c.key, input: c.input } });
    expect(res.ok()).toBeTruthy();
  }
}

const AREAS = ["narvaro_rutiner", "yrkesfardigheter", "arbetskapacitet", "sjalvstandighet", "digital_sjalvstandighet", "instruktioner", "arbetsgivarkontakter", "beredskap", "sprak_kommunikation", "ovrigt"];
const approveAssessment: Cmd = {
  key: "coach.assessmentSave",
  input: { caseId: NADIA, month: "2027-01", areas: Object.fromEntries(AREAS.map((k) => [k, { level: 1, observation: "Följer instruktionen utan stöd.", nextStep: "Fortsätta öva." }])), summary: "Deltagaren följer planen.", overallStatus: "green", approve: true },
  as: COACH,
};
/** Steg 2 som kommandon: månadsbedömningen godkänns, rapporten godkänns, levereras och fryses. */
const deliverNadiaJan: Cmd[] = [
  approveAssessment,
  { key: "rapporter.reportApprove", input: { reportId: NADIA_JAN }, as: COACH },
  { key: "rapporter.reportDeliver", input: { reportId: NADIA_JAN }, as: COACH },
  { key: "rapporter.snapshot", input: { reportIds: [NADIA_JAN] }, as: COACH },
];
/** Närvarograden i månadsrapportens avsnitt 2 (bara graden sedan 2026-10-07). */
const rateOf = async (page: Page) => ((await mainText(page)).match(/Närvarograd\s*(\d+\s?%|–)/) || [])[1];

// ================================================================ 1. Listan
test("1. rapportlistan (samordnare): sammanfattning, snabbfilter, filter, sök och öppna", async ({ page }, info) => {
  const errors = await open(page, info, "/rapporter", SAMORDNARE);
  await expect(main(page)).toContainText("794 rapporter");
  let t = await mainText(page);
  expect(t).toMatch(/FÖRSENADE/i);
  expect(t).toMatch(/FÖRFALLER DENNA VECKA/i);
  expect(t).toMatch(/VÄNTAR PÅ GODKÄNNANDE/i);
  // Förklaringen till en förfallotid som inte är fastställd ligger som verktygstips på märket – inte som en egen rad per rapport
  // (prototypens DemoNote längst ned nämner fortfarande "Sista dag ej fastställd", därför kontrolleras raderna i tabellen).
  await expect(main(page).locator("[title*='inte fastställd med']").first()).toBeAttached();
  await expect(main(page).getByRole("table", { name: "Rapporter" }).getByText("Sista dag ej fastställd")).toHaveCount(0);
  expect(t).not.toMatch(/deadline/i);
  const tile = page.getByRole("button", { name: /^Försenade/ });
  const overdue = Number((await tile.innerText()).match(/\d+/)?.[0]);
  await tile.click();
  await expect(main(page)).toContainText(new RegExp(`${overdue} rapporte?r? · försenade`, "i"));
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await tile.click();
  await page.selectOption("#rap-kind", "customer_summary");
  await expect(main(page)).toContainText("4 rapporter");
  await expect(main(page)).toContainText("Beställarrapport januari 2027");
  await page.fill("#rap-q", "december");
  t = await mainText(page);
  expect(t).toMatch(/(^|\n)1 rapport\b/i);
  await btn(page, "Rensa filter").click();
  await expect(main(page)).toContainText("794 rapporter");
  await page.locator("table tbody tr").first().click();
  await expect(page).toHaveURL(/\/rapporter\/rep-/);
  expect(errors).toEqual([]);
});

test("1b. coachen ser bara egna ärenden", async ({ page }, info) => {
  const errors = await open(page, info, "/rapporter", COACH);
  await expect(main(page)).toContainText("Dina ärenden");
  expect(await mainText(page)).not.toContain("BOT-26-0117");
  expect(errors).toEqual([]);
});

test("1c. smal skärm: listan visas som kort", async ({ page }, info) => {
  await page.setViewportSize({ width: 400, height: 900 });
  const errors = await open(page, info, "/rapporter", SAMORDNARE);
  await expect(main(page)).toContainText("794 rapporter");
  await expect(main(page).locator("table")).toHaveCount(0);
  // Korten är riktiga länkar (öppna i ny flik, högerklick): omgång 2 av UI/UX-arbetet.
  await main(page).getByRole("link", { name: /^Slutrapport/ }).first().click();
  await expect(page).toHaveURL(/\/rapporter\/rep-/);
  expect(errors).toEqual([]);
});

// ================================================================ 2. Månadsrapport: blockerad → godkänn → leverera
test("2. månadsrapport januari (Nadia): bara godkända uppgifter, godkänn och leverera", async ({ page }, info) => {
  const errors = await open(page, info, `/rapporter/${NADIA_JAN}`, COACH);
  let t = await mainText(page);
  expect(t).toMatch(/Rapporten kan inte godkännas ännu/);
  expect(t).toMatch(/UTKAST/i);
  expect(t).toMatch(/4\. PROGRESSION/i);
  expect(t).toMatch(/Visas när coachen har godkänt månadsbedömningen/);
  await expect(btn(page, "Godkänn")).toHaveCount(0);
  expect(t).not.toMatch(/\d{6,8}-\d{4}/);
  expect(t).toMatch(/exempel – de stäms av mot mall 02/);
  await linkOrBtn(page, "Öppna bedömningen").click();
  await expect(page).toHaveURL(new RegExp(`/manadsbedomning/${NADIA}\\?manad=2027-01`));

  // Månadsbedömningen godkänns (coachens skärm i området coach)
  await commands(page, info, [approveAssessment]);
  await go(page, info, `/rapporter/${NADIA_JAN}`, COACH);
  t = await mainText(page);
  expect(t).toMatch(/Granskad av coach/);
  expect(t).toMatch(/Grön – enligt plan/);
  expect(t).toMatch(/Deltagaren följer planen\./);
  await btn(page, "Godkänn").click();
  await expect(main(page)).toContainText("av Amira Haddad");
  await expect(main(page).getByText("Godkänd", { exact: true }).first()).toBeVisible();
  await btn(page, "Leverera till kommunen").click();
  const dialog = page.getByRole("dialog");
  const dt = await dialog.innerText();
  expect(dt).toMatch(/bara innehåller en notis/);
  expect(dt).toMatch(/inte som bilaga/);
  expect(dt.split("notis")[1] || "").not.toMatch(/Nadia|Warsame/);
  expect(dt).toMatch(/BOT-26-0143/);
  await btn(page, "Leverera i portalen").click();
  await expect(page.getByText("Levererad i portalen till Maria Ekdahl. Mejlet innehåller bara en notis utan personuppgifter.")).toBeVisible();
  await expect(main(page)).toContainText("i portalen");
  await expect(main(page)).toContainText(/Levererad version – låst sedan/);
  expect(errors).toEqual([]);
});

// ================================================================ 3. Kommunens perspektiv och kvittens
test("3. kommunens handläggare öppnar och kvitterar; inga interna knappar; behörighet", async ({ page }, info) => {
  const errors = await open(page, info, "/om", COACH);
  await commands(page, info, deliverNadiaJan);
  await go(page, info, `/rapporter/${NADIA_JAN}`, COACH);
  if (isDemo(info)) {
    await btn(page, "Se som kommunen").click();
    await expect(page).toHaveURL(new RegExp(`/portal/rapporter/${NADIA_JAN}`));
    // Kommunen har bara rollen handläggare (beslut 2026-10-07): kundens perspektiv utan rollväljare.
    await expect(page.getByRole("group", { name: "Perspektiv" }).getByRole("button", { name: "Kund" })).toHaveAttribute("aria-pressed", "true");
  } else {
    await go(page, info, `/portal/rapporter/${NADIA_JAN}`, HANDLAGGARE);
  }
  await expect(main(page)).toContainText("Rapporten är kvitterad");
  await expect(btn(page, "Godkänn")).toHaveCount(0);
  await expect(btn(page, "Rätta")).toHaveCount(0);
  await expect(btn(page, "Leverera till kommunen")).toHaveCount(0);

  await go(page, info, `/portal/rapporter/${CS_JAN}`, HANDLAGGARE);
  await expect(main(page)).toContainText("inte tillgänglig för dig");
  await go(page, info, `/portal/rapporter/${UNDELIVERED}`, HANDLAGGARE);
  await expect(main(page)).toContainText("inte klar ännu");
  if (isDemo(info)) {
    await btn(page, "Se från leverantörens håll").click();
    await expect(page.getByRole("group", { name: "Perspektiv" }).getByRole("button", { name: "Leverantör" })).toHaveAttribute("aria-pressed", "true");
  }
  // Utkastet kvitterades inte: coachen ser att det inte är levererat
  await go(page, info, `/rapporter/${UNDELIVERED}`, SAMORDNARE);
  await expect(main(page)).toContainText("Inte levererad");
  expect(errors).toEqual([]);
});

test("3b. bara mottagaren kvitterar; tillbaka till sidan man kom från", async ({ page }, info) => {
  // Kommunens chef finns inte längre (beslut 2026-10-07) – Miljonbemanning ser att rapporten inte är öppnad.
  const errors = await open(page, info, `/rapporter/${UNOPENED}`, SAMORDNARE);
  await expect(main(page)).toContainText("Inte öppnad än. Bara mottagaren kan kvittera.");
  if (isDemo(info)) {
    await btn(page, "Se som kommunen").click();
    await expect(page.getByRole("group", { name: "Perspektiv" }).getByRole("button", { name: "Kund" })).toHaveAttribute("aria-pressed", "true");
    await expect(main(page)).toContainText("Rapporten är kvitterad");
    const t = await mainText(page);
    expect(t.split(/1\. GRUNDUPPGIFTER/i)[0]).not.toMatch(/ kl\. | jan | feb | dec /);
  }
  await go(page, info, `/portal/rapporter/${NADIA_DEC}?fran=deltagare`, HANDLAGGARE);
  await linkOrBtn(page, "Tillbaka till deltagaren").click();
  await expect(page).toHaveURL(new RegExp(`/portal/deltagare/${NADIA}`));
  expect(errors).toEqual([]);
});

test("3c. levererade rapporter är låsta", async ({ page }, info) => {
  const errors = await open(page, info, `/portal/rapporter/${NADIA_DEC}`, HANDLAGGARE);
  const before = await rateOf(page);
  expect(before).toBeTruthy();
  await commands(page, info, [{ key: "coach.attendanceSet", input: { activityId: DEC_ACT, status: "absent_invalid", reason: "" }, as: COACH }]);
  await go(page, info, `/portal/rapporter/${NADIA_DEC}`, HANDLAGGARE);
  expect(await rateOf(page)).toBe(before);
  await go(page, info, `/rapporter/${NADIA_DEC}`, COACH);
  await expect(main(page)).toContainText("Underlaget har ändrats efter leveransen");
  expect(await rateOf(page)).toBe(before);

  await commands(page, info, deliverNadiaJan);
  await go(page, info, `/portal/rapporter/${NADIA_JAN}`, HANDLAGGARE);
  const jan = await rateOf(page);
  await commands(page, info, [{ key: "coach.attendanceSet", input: { activityId: JAN_ACT, status: "absent_invalid", reason: "" }, as: COACH }]);
  await go(page, info, `/portal/rapporter/${NADIA_JAN}`, HANDLAGGARE);
  expect(await rateOf(page)).toBe(jan);

  await go(page, info, `/portal/rapporter/${FIN_DEL}`, HANDLAGGARE);
  expect(await mainText(page)).toMatch(/Rekommenderad fortsättning:\s*\S/);
  // Beställarrapporten lämnas till kommunen utanför Miljonmatch – avtalsansvarig läser den levererade versionen.
  await go(page, info, `/rapporter/${CS_DEC}`, AVTALSANSVARIG);
  const t = await mainText(page);
  expect(t).toMatch(/svar under oktober–december 2026/);
  expect(t).not.toMatch(/senaste tre månaderna/);
  expect(errors).toEqual([]);
});

// ================================================================ 4. Rättelse = ny version
test("4. rätta en levererad rapport: ny version, kommunen ser version 1 tills version 2 är levererad", async ({ page }, info) => {
  const errors = await open(page, info, "/om", COACH);
  await commands(page, info, deliverNadiaJan);
  await go(page, info, `/rapporter/${NADIA_JAN}`, COACH);
  await btn(page, "Rätta").click();
  await btn(page, "Skapa ny version").click();
  await expect(page.getByRole("dialog")).toContainText("Skriv varför rapporten rättas");
  await page.fill("#rap-correct-reason", "Fel datum för praktikstart.");
  await btn(page, "Skapa ny version").click();
  await expect(page).not.toHaveURL(new RegExp(`/rapporter/${NADIA_JAN}$`));
  const newId = decodeURIComponent(page.url().split("/rapporter/")[1]);
  expect(newId).not.toBe(NADIA_JAN);
  await expect(main(page)).toContainText("Version 2 (visas nu)");
  let t = await mainText(page);
  expect(t).toMatch(/Version 1/);
  expect(t).toMatch(/Fel datum för praktikstart\./);
  expect(t).toMatch(/Utkast/);
  await go(page, info, `/rapporter/${NADIA_JAN}`, COACH);
  t = await mainText(page);
  expect(t).toMatch(/Rättelse pågår – version 2 är ett utkast/i);
  await expect(btn(page, "Rätta")).toHaveCount(0);

  // 4b. Kommunen ser den senast levererade versionen medan rättelsen är ett utkast
  await go(page, info, `/portal/rapporter/${NADIA_JAN}`, HANDLAGGARE);
  t = await mainText(page);
  expect(t).toMatch(/Rapporten rättas/i);
  expect(t).toMatch(/1\. GRUNDUPPGIFTER/i);
  await go(page, info, `/portal/rapporter/${newId}`, HANDLAGGARE);
  t = await mainText(page);
  expect(t).toMatch(/1\. GRUNDUPPGIFTER/i);
  expect(t).not.toMatch(/inte klar ännu/);
  expect(t).toMatch(/version 1/i);

  await go(page, info, `/rapporter/${newId}`, COACH);
  await btn(page, "Godkänn").click();
  await expect(btn(page, "Leverera till kommunen")).toBeVisible();
  await btn(page, "Leverera till kommunen").click();
  await btn(page, "Leverera i portalen").click();
  await expect(main(page)).toContainText(/Levererad version – låst sedan/);
  await go(page, info, `/rapporter/${NADIA_JAN}`, COACH);
  await expect(main(page)).toContainText("Den här versionen är ersatt");
  await go(page, info, `/portal/rapporter/${NADIA_JAN}`, HANDLAGGARE);
  await expect(main(page)).toContainText("Rapporten har rättats");
  await expect(linkOrBtn(page, "Visa den rättade versionen")).toHaveCount(1);
  expect(errors).toEqual([]);
});

// ================================================================ 5. Kvalitetsgranskning
test("5. samordnarens valfria kvalitetsgranskning", async ({ page }, info) => {
  const errors = await open(page, info, `/rapporter/${APPROVED_JAN}`, SAMORDNARE);
  await btn(page, "Markera som kvalitetsgranskad").click();
  await expect(main(page)).toContainText("av Sara Lindqvist");
  await expect(main(page)).toContainText("Kvalitetsgranskad");
  await expect(btn(page, "Markera som kvalitetsgranskad")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ================================================================ 6. Beställarrapport
test("6. beställarrapport januari: bara avtalsmålet, sammanfattning, godkänn och registrera att den är lämnad", async ({ page }, info) => {
  const errors = await open(page, info, `/rapporter/${CS_JAN}`, AVTALSANSVARIG);
  const t = await mainText(page);
  expect((t.split(/FÖRHANDSVISNING/i)[1] ?? t)).not.toMatch(/35\s?%/);
  expect(t).toMatch(/avtalsmål(et)? 32\s%/i);
  expect(t).toMatch(/färre än 5/);
  await btn(page, "Godkänn beställarrapporten").click();
  await expect(main(page)).toContainText("Skriv en sammanfattning");
  await page.fill("#rap-summary", "Resultatgraden ligger under det interna målet 35 %.");
  await btn(page, "Godkänn beställarrapporten").click();
  await expect(main(page)).toContainText("interna mål");
  await expect(main(page)).toContainText("Väntar på avtalsansvarigs godkännande");
  await btn(page, "Använd förslaget").click();
  await btn(page, "Godkänn beställarrapporten").click();
  await expect(main(page)).toContainText("av Johan Berg");
  // Beslut 2026-10-07: avtalsansvarig lämnar rapporten till kommunen utanför Miljonmatch och registrerar det – inget mejl.
  await expect(btn(page, "Leverera till kommunen")).toHaveCount(0);
  await btn(page, "Registrera att rapporten är lämnad").click();
  await expect(page.getByRole("dialog")).toContainText("Ingen får något mejl.");
  await btn(page, "Registrera leveransen").click();
  await expect(main(page)).toContainText(/Levererad version – låst sedan/);
  await expect(main(page)).toContainText("Lämnad till kommunen");
  // Kommunens handläggare ser aldrig beställarrapporten i portalen.
  await go(page, info, `/portal/rapporter/${CS_JAN}`, HANDLAGGARE);
  await expect(main(page)).toContainText("inte tillgänglig för dig");
  await go(page, info, `/rapporter/${CS_DEC}`, COACH);
  await expect(main(page)).toContainText("inte tillgänglig för din roll");
  expect(errors).toEqual([]);
});

// ================================================================ 7. Veckorapport som väntar
test("7. veckorapport som väntar på närvaro publiceras när allt är registrerat", async ({ page }, info) => {
  const errors = await open(page, info, `/rapporter/${WEEKLY_WAIT}`, SAMORDNARE);
  let t = await mainText(page);
  expect(t).toMatch(/Väntar på närvaroregistrering/);
  expect(t).toMatch(/tillfällen? saknas/);
  await go(page, info, `/rapporter/${WEEKLY_WAIT}`, COACH);
  expect(await mainText(page)).toMatch(/Du ser \d+ av \d+ deltagare/);
  await commands(page, info, WEEKLY_MISSING.map((activityId) => ({ key: "coach.attendanceSet", input: { activityId, status: "present", reason: "" }, as: COACH })));
  await go(page, info, `/rapporter/${WEEKLY_WAIT}`, SAMORDNARE);
  t = await mainText(page);
  expect(t).toMatch(/Levererad version – låst sedan/);
  expect(t).not.toMatch(/Väntar på närvaroregistrering/);
  await go(page, info, `/rapporter/${WEEKLY_WAIT}`, HANDLEDARE);
  t = await mainText(page);
  expect(t).toMatch(/VECKORAPPORT NÄRVARO|Veckorapport närvaro/);
  expect(t).not.toMatch(/visas inte för handledare/i);
  expect(errors).toEqual([]);
});

// ================================================================ 8. Slutrapport
test("8. slutrapport efter avslut: coachens text, sedan godkänn", async ({ page }, info) => {
  const errors = await open(page, info, "/om", COACH);
  await commands(page, info, [{ key: "arenden.caseClose", input: { caseId: AMIRA_ACTIVE.id, endDate: "2027-02-01", endReason: "arbete", verified: true }, as: COACH }]);
  await go(page, info, "/rapporter", COACH);
  await page.selectOption("#rap-kind", "final");
  await page.fill("#rap-q", AMIRA_ACTIVE.number);
  await main(page).locator("table tbody tr").first().click();
  await expect(page).toHaveURL(/\/rapporter\/rep-/);
  // Vänta tills rapporten har laddats (appen hämtar den över HTTP).
  await expect(main(page)).toContainText("Coachen skriver rekommenderad fortsättning");
  await expect(btn(page, "Godkänn")).toHaveCount(0);
  await btn(page, "Spara texten").click();
  await expect(main(page)).toContainText("Skriv en rekommenderad fortsättning");
  await page.fill("#rap-final-rec", "Ingen fortsatt insats behövs. Deltagaren har börjat arbeta.");
  await btn(page, "Spara texten").click();
  await expect(main(page)).toContainText("Granskad av coach");
  await btn(page, "Godkänn").click();
  await expect(main(page)).toContainText("av Amira Haddad");
  expect(await mainText(page)).toMatch(/Rekommenderad fortsättning:\s*Ingen fortsatt insats/);
  expect(errors).toEqual([]);
});

// ================================================================ 9. Behörighet
test("9. behörighet: ärendet som var skyddat är ett vanligt ärende, handledare och slutrapport utan text", async ({ page }, info) => {
  // Skyddade personuppgifter är borttagna ur appen (beslut 2026-10-07, spärren vilande): samordnaren ser rapporten.
  const errors = await open(page, info, `/rapporter/${PROT_JAN}`, SAMORDNARE);
  let t = await mainText(page);
  expect(t).toMatch(/1\. GRUNDUPPGIFTER/i);
  expect(t).not.toMatch(/Skyddade personuppgifter/);
  // En annan handläggares deltagare (Omar Farahs beställning) syns inte för Maria.
  await go(page, info, `/portal/rapporter/${PROT_DEL}`, HANDLAGGARE);
  await expect(main(page)).toContainText("inte tillgänglig för dig");

  await go(page, info, `/rapporter/${NADIA_DEC}`, HANDLEDARE);
  t = await mainText(page);
  expect(t).toMatch(/visas inte för handledare/i);
  expect(t).not.toMatch(/4\. PROGRESSION/i);
  expect(t).not.toMatch(/8\. COACHENS SAMMANFATTANDE/i);
  await go(page, info, `/rapporter/${PETRA_FINAL}`, HANDLEDARE);
  expect(await mainText(page)).toMatch(/visas inte för handledare/i);

  // En godkänd slutrapport utan coachens text kan inte levereras (texten skapas inte automatiskt).
  await commands(page, info, [{ key: "rapporter.reportApprove", input: { reportId: DRAFT_FINAL.id }, as: { userId: DRAFT_FINAL.lead, role: "coach" } }]);
  await go(page, info, `/rapporter/${DRAFT_FINAL.id}`, SAMORDNARE);
  await expect(main(page)).toContainText("Rekommenderad fortsättning saknas");
  await expect(btn(page, "Leverera till kommunen")).toHaveCount(0);
  expect(errors).toEqual([]);
});
