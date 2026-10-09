// Röstinspelningen (docs/PLAN-ROST.md): coachens inspelade avstämning, deltagarens länk, coachens granskning och länk,
// kommunens "Tala in" och AI-utkast till månadsbedömningen. Samma steg mot båda projekten:
//   demo  prototypen – mikrofon saknas (sidan är inte https), inspelningen simuleras ("Simulera en inspelning")
//   app   appen i minnesläge – riktig inspelning med Chromiums falska mikrofon, simulerad AI och ljud i minnet
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { allowLeaveWarnings, isDemo, open, switchPersona } from "./helpers";

const chromium = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
// Falsk mikrofon (ljudton) och automatiskt ja till mikrofonen – gäller appen på localhost.
test.use({
  launchOptions: { executablePath: chromium, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
});

const COACH = { userId: "u-amira", role: "coach" };
const MARIA = { userId: "k-maria", role: "kommun_handlaggare" };
const JOHAN = { userId: "u-johan", role: "avtalsansvarig" };
const KARIN = { userId: "u-karin", role: "chef" };
const DELTAGARE = { userId: "deltagare", role: "deltagare" };
const SC = { nadia: "case-260143", amal: "case-270012", skyddad: "case-260120" };
const DICTATION = /Deltagaren har arbetat på lager i två år|Deltagaren har läst svenska för invandrare|Jag vill boka ett uppföljningsmöte/;

const main = (page: Page) => page.locator("#main");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" }).first();
const card = (page: Page, title: string | RegExp) => page.locator("section").filter({ has: page.locator("h2", { hasText: title }) });
const aiGroup = (page: Page, field: string) => page.getByRole("group", { name: `AI-förslag för ${field}`, exact: true });
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

/** Deltagarkortet: röstmeddelandena ligger under fliken Meddelanden (sedan 2026-10-09) – fäll ut rutan ("Läs" eller "Visa"). */
async function openVoice(page: Page) {
  await page.getByRole("tab", { name: /^Meddelanden/ }).click();
  await page.getByRole("group", { name: "Röstmeddelanden:" }).getByRole("button", { name: /^(Läs|Visa)$/ }).click();
}

async function go(page: Page, info: TestInfo, to: string) {
  if (isDemo(info)) await page.evaluate((p) => { window.location.hash = p; }, to);
  else await page.goto(to);
  await expect(main(page)).toBeVisible();
}
async function switchUser(page: Page, info: TestInfo, as: { userId: string; role: string }, to: string) {
  if (isDemo(info)) {
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), as);
    await page.evaluate((p) => { window.location.hash = p; }, to);
    await page.reload();
  } else {
    await switchPersona(page, as);
    await page.goto(to);
  }
  await expect(main(page)).toBeVisible();
}

/** Starta inspelningen: prototypen simulerar (ingen mikrofon), appen spelar in med den falska mikrofonen. */
async function startRecording(scope: Page | Locator, info: TestInfo, startLabel: string) {
  await btn(scope, isDemo(info) ? "Simulera en inspelning" : startLabel).click();
}

test("coachen spelar in avstämningen: paus, stopp, transkribering, ljudet raderas och förslagen har belägg (Nadia)", async ({ page }, info) => {
  const errors = await open(page, info, `/avstamning/${SC.nadia}`, COACH);
  await btn(page, "Med AI-stöd").click();
  await expect(page.getByText(/^Samtycke registrerat/).first()).toBeVisible();
  const src = page.getByRole("group", { name: "Källa" });
  await expect(btn(src, "Spela in mötet")).toHaveAttribute("aria-pressed", "true");
  await expect(btn(src, "Ladda upp ljudfil")).toBeVisible();
  await expect(main(page)).toContainText("Högst 60 minuter.");
  if (isDemo(info)) await expect(main(page)).toContainText("Webbläsaren i prototypen har ofta ingen mikrofon");
  else await expect(main(page)).not.toContainText("Simulera en inspelning");
  await startRecording(page, info, "Starta inspelning");
  const timer = page.getByRole("timer").filter({ hasText: /^Spelar in \d\d:\d\d$/ });
  await expect(timer).toBeVisible();
  // Källan kan inte bytas medan inspelningen pågår
  await expect(btn(src, "Teams-transkript")).toBeDisabled();
  await btn(page, "Pausa").click();
  await expect(page.getByText(/^Inspelningen är pausad · \d\d:\d\d$/)).toBeVisible();
  await btn(page, "Fortsätt").click();
  await expect(timer).toBeVisible();
  await page.waitForTimeout(1200);
  await btn(page, "Stoppa och tolka").click();
  await expect(page.getByText(/Laddar upp inspelningen|Transkriberar/).first()).toBeVisible();
  await page.getByText("Ljudet är raderat").waitFor({ timeout: 20_000 });
  await expect(page.getByRole("group", { name: /^AI-förslag för / })).toHaveCount(7);
  // Fasen nämns inte i samtalet: "Framgår inte" och inget förslag att acceptera. Samlad status föreslås aldrig.
  await expect(aiGroup(page, "fas")).toContainText("Framgår inte");
  await expect(btn(aiGroup(page, "fas"), "Acceptera")).toHaveCount(0);
  // Leverantör och modell står inte i formuläret (bara i revisionsloggen); den simulerade AI:n märks med testmiljönotisen.
  await expect(page.getByRole("note").filter({ hasText: "Testmiljö: AI:n är simulerad" }).first()).toBeVisible();
  await expect(page.getByText("Simulerad AI (testdata)")).toHaveCount(0);
  await expect(page.getByText(/^måndag 1 feb 2027 kl\. \d\d\.\d\d – direkt efter transkriberingen$/)).toBeVisible();
  for (const f of ["veckomål uppnått", "nytt veckomål", "genomförda aktiviteter", "arbetsgivarkontakter", "hinder", "anteckning"]) await btn(aiGroup(page, f), "Acceptera").click();
  await page.getByRole("group", { name: "Samlad status", exact: true }).getByRole("button", { name: /Gul/ }).click();
  await btn(page, "Godkänn mötesrapporten").click();
  await expect(page.getByRole("heading", { level: 1, name: "Mötesrapporten är godkänd" })).toBeVisible();
  await expect(main(page)).toContainText(/AI-förslag\s*6 \/ 0 \/ 0/i);
  await expect(page.getByText("Ljudet raderades direkt efter transkriberingen", { exact: true })).toBeVisible();
  await expect(page.getByText("Råtranskriptet raderades vid godkännandet", { exact: true })).toBeVisible();
  expect(relevant(errors)).toEqual([]);
});

test("utan samtycke spelas inget in – förklaring och länk till samtycket (Elif)", async ({ page }, info) => {
  const errors = await open(page, info, "/avstamning/case-270003", COACH);
  await btn(page, "Med AI-stöd").click();
  await expect(page.getByText("Samtycke saknas")).toBeVisible();
  await expect(main(page).getByRole("link", { name: "deltagarkortet" })).toBeVisible();
  await expect(btn(page, "Starta inspelning")).toHaveCount(0);
  await expect(btn(page, "Simulera en inspelning")).toHaveCount(0);
  expect(relevant(errors)).toEqual([]);
});

test("deltagaren spelar in via länken: språk, samtycke, inspelning och kvitto – coachen granskar texten", async ({ page }, info) => {
  const errors = await open(page, info, "/rost", DELTAGARE);
  const phone = page.locator(".rost-phone");
  // Exempellänken har arabiska som förval
  await expect(phone).toHaveAttribute("dir", "rtl");
  await expect(main(page)).toContainText("Översättning – granskas av människa");
  await btn(phone, "Soomaali").click();
  await expect(phone).toHaveAttribute("lang", "so");
  await btn(phone, "Svenska").click();
  await expect(phone).toContainText("Berätta för din coach");
  await expect(phone).toContainText("Du kan prata i högst 5 minuter.");
  await expect(phone).toContainText("Länken gäller i 7 dagar och kan bara användas en gång.");
  await expect(phone).toContainText("Ljudet raderas direkt efter det.");
  // Samtycket först
  await expect(btn(phone, "Börja spela in")).toBeDisabled();
  await expect(phone).toContainText("Kryssa i rutan ovan för att kunna spela in.");
  await page.locator("#rost-consent").check();
  await expect(btn(phone, "Börja spela in")).toBeEnabled();
  await startRecording(phone, info, "Börja spela in");
  await expect(phone.getByRole("timer")).toContainText(/^Spelar in \d\d:\d\d$/);
  await page.waitForTimeout(isDemo(info) ? 1200 : 4000);
  await btn(phone, "Klar").click();
  await expect(phone).toContainText("Din inspelning är klar");
  if (!isDemo(info)) await expect(phone.locator("audio")).toHaveCount(1);
  await btn(phone, "Skicka till min coach").click();
  await expect(phone).toContainText("Tack! Ditt meddelande är skickat.", { timeout: 20_000 });
  await expect(phone).toContainText("Din coach läser det. Ljudet är raderat.");
  // Länken fungerar en gång
  await page.reload();
  await expect(phone).toContainText("Länken är redan använd");
  await expect(btn(phone, "Börja spela in")).toHaveCount(0);

  // Coachen: nytt röstmeddelande på Min vecka och i deltagarkortet
  await switchUser(page, info, COACH, "/min-vecka");
  const inbox = card(page, "Deltagarnas röstmeddelanden");
  await expect(inbox).toContainText("Amal Hassan");
  await expect(inbox).toContainText("Nadia Warsame");
  await expect(inbox).toContainText("talat på somaliska, AI-översättning");
  await go(page, info, `/arenden/${SC.amal}`);
  await openVoice(page);
  const voice = card(page, "Deltagarens röstmeddelanden");
  await expect(voice).toContainText("Nytt – att granska");
  await expect(voice).toContainText("AI-transkribering");
  // Testmiljön: AI:n är simulerad och märks så (synpunkt #8, beslut 2026-10-07).
  await expect(voice).toContainText("Testmiljö: AI:n är simulerad – texten är påhittad och inte det deltagaren sa.");
  await expect(voice).toContainText(/Samtycke i länken 1 feb kl\. \d\d\.\d\d, textversion röst-v1\.0 \(2026-09-30\)\./);
  await btn(voice, "Markera som granskat").click();
  await expect(voice).toContainText("Granskat 1 feb av Amira Haddad");
  expect(relevant(errors)).toEqual([]);
});

test("coachen skickar inspelningslänk utan personuppgifter och granskar Nadias meddelande på somaliska", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, COACH);
  await openVoice(page);
  const voice = card(page, "Deltagarens röstmeddelanden");
  await expect(voice).toContainText("Praktiken har börjat bra");
  await expect(voice).toContainText("AI-översättning");
  await expect(voice).toContainText("Talat på somaliska");
  await expect(voice).toContainText(/Senaste länk: 28 jan kl\. 15\.10 med SMS på somaliska/);
  await btn(voice, "Visa originaltexten (somaliska)").click();
  await expect(voice.locator('blockquote[lang="so"]')).toContainText("Tababarka shaqadu");
  await btn(voice, "Skicka inspelningslänk till deltagaren").click();
  const dialog = page.getByRole("dialog", { name: "Skicka inspelningslänk" });
  await expect(dialog).toContainText("SMS till deltagarens telefonnummer");
  await expect(dialog).toContainText("Inga personuppgifter – inget namn och inget ärendenummer.");
  await expect(dialog.locator("#vl-lang")).toHaveValue("so");
  await btn(dialog, "Skicka länken").click();
  await expect(page.getByText(/^Länken är skickad med SMS\. Den gäller till /)).toBeVisible();
  await expect(voice).toContainText("Inte använd ännu");
  if (isDemo(info)) await expect(voice.getByRole("button", { name: "Öppna länken som deltagaren" })).toBeVisible();
  // Använd texten som underlag i avstämningen
  await voice.getByRole("link", { name: "Använd i mötet" }).click();
  await expect(main(page)).toContainText("Deltagarens röstmeddelanden – underlag");
  await btn(page, "Lägg till i anteckningen").click();
  await expect(page.locator("#ci-note")).toHaveValue(/^Deltagarens röstmeddelande 28 jan: Hej, det är jag\./);

  // Ärendet som var skyddat är ett vanligt ärende sedan 2026-10-07 (skyddet borttaget ur appen, spärren vilande): länken kan
  // skickas som till alla andra. Avstämningen sparas inte – sidan lämnas med text i anteckningen, och webbläsaren varnar.
  allowLeaveWarnings(page);
  await switchUser(page, info, JOHAN, `/arenden/${SC.skyddad}`);
  await openVoice(page);
  const prot = card(page, "Deltagarens röstmeddelanden");
  await expect(prot).not.toContainText("skyddade personuppgifter");
  await expect(btn(prot, "Skicka inspelningslänk till deltagaren")).toHaveCount(1);
  expect(relevant(errors)).toEqual([]);
});

test("kommunen talar in ett meddelande och beställningens bakgrund – inget ljud sparas", async ({ page }, info) => {
  const errors = await open(page, info, `/portal/deltagare/${SC.nadia}?flik=meddelanden`, MARIA);
  await btn(page, "Tala in").click();
  const tala = page.getByRole("region", { name: "Tala in" });
  await expect(tala).toContainText("Tala in i stället för att skriva. Du kan ändra texten innan du skickar.");
  await expect(tala).toContainText("Inget ljud sparas.");
  await startRecording(tala, info, "Börja tala in");
  await expect(tala.getByRole("timer")).toBeVisible();
  await page.waitForTimeout(isDemo(info) ? 1000 : 4000);
  await btn(tala, "Klar").click();
  await expect(page.locator("#kom-msg")).toHaveValue(DICTATION, { timeout: 20_000 });
  await expect(main(page)).toContainText("Texten står nu i fältet. Läs den och rätta det som blev fel innan du skickar.");
  // Testmiljön: AI:n är simulerad och märks så (synpunkt #8 "Tal till text fungerar ej", beslut 2026-10-07).
  await expect(main(page).getByRole("note").first()).toContainText("Testmiljö: AI:n är simulerad – texten är påhittad och inte det du sa.");
  await page.locator("#kom-msg").fill(`${await page.locator("#kom-msg").inputValue()} (rättat)`);
  await btn(page, "Skicka meddelandet").click();
  await expect(page.getByRole("log", { name: "Meddelanden" })).toContainText("(rättat)");

  // Ny beställning: Tala in vid bakgrunden (steg 3)
  await go(page, info, "/portal/bestall");
  await page.fill("#kom-o-start", "2027-02-15");
  await page.getByRole("group", { name: "Omfattning" }).getByRole("button", { name: "6 månader" }).click();
  await btn(page, /^Nästa/).click();
  await page.fill("#kom-o-fn", "Samira");
  await page.fill("#kom-o-ln", "Testsson");
  await page.fill("#kom-o-pnr", "19880412-3456");
  await page.fill("#kom-o-dphone", "070-000 11 22");
  await page.fill("#kom-o-city", "Tumba");
  await btn(page, /^Nästa/).click();
  await expect(main(page).getByRole("heading", { level: 2, name: "Bakgrundsinformation om deltagaren" })).toHaveCount(1);
  await page.fill("#kom-o-bg", "Har arbetat på lager.");
  await btn(page, "Tala in").click();
  const tala2 = page.getByRole("region", { name: "Tala in" });
  await startRecording(tala2, info, "Börja tala in");
  await page.waitForTimeout(isDemo(info) ? 1000 : 4000);
  await btn(tala2, "Klar").click();
  await expect(page.locator("#kom-o-bg")).toHaveValue(/^Har arbetat på lager\. \S/, { timeout: 20_000 });
  await expect(main(page).getByRole("note").first()).toContainText("Testmiljö: AI:n är simulerad – texten är påhittad och inte det du sa.");
  // Sidan lämnas med ett påbörjat formulär (webbläsaren varnar, som den ska).
  allowLeaveWarnings(page);
  expect(relevant(errors)).toEqual([]);
});

test("månadsbedömningen: AI-utkast från godkända mötesrapporter – nivåerna väljer coachen", async ({ page }, info) => {
  const errors = await open(page, info, `/manadsbedomning/${SC.nadia}?manad=2027-01`, COACH);
  const draft = card(page, "AI-utkast från godkända mötesrapporter");
  await expect(draft).toContainText("aldrig råtranskript");
  // Testdatat har redan AI-utkast i områdena – då säger knappen "Skapa nya AI-utkast" redan från början (fynd B24).
  await btn(draft, /^Skapa (nya )?AI-utkast/).click();
  await expect(draft).toContainText(/Skapade 1 feb kl\. \d\d\.\d\d/, { timeout: 20_000 });
  await expect(btn(draft, "Skapa nya AI-utkast")).toBeVisible();
  const selects = page.getByTestId("progressionsomraden").locator("select");
  expect(await selects.evaluateAll((els) => els.every((s) => (s as HTMLSelectElement).value === ""))).toBeTruthy();
  await expect(page.getByTestId("progressionsomraden")).toContainText("Källa: Närvaroregistrering");
  expect(relevant(errors)).toEqual([]);
});

/** Rader i kortets revisionslogg (chefens flik Historik) med en viss text av en viss person. */
async function logRows(page: Page, text: string, who = "Amira Haddad"): Promise<number> {
  const table = page.getByRole("table", { name: "Revisionslogg" });
  await expect(table).toBeVisible();
  const more = page.getByRole("button", { name: "Visa alla" });
  if (await more.count()) await more.click();
  return table.locator("tbody tr").filter({ hasText: text }).filter({ hasText: who }).count();
}

test("visningen av röstmeddelanden loggas när texten fälls ut – inte när kortet laddas – och kortets öppning loggas en gång per besök", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${SC.nadia}`, COACH);
  // Kortet laddat, två flikbyten – texten inte utfälld: ingen visning loggad. Öppningen loggad en gång.
  await page.getByRole("tab", { name: /^Tidslinje/ }).click();
  await page.getByRole("tab", { name: /^Närvaro/ }).click();
  await expect(main(page)).toContainText("Närvaro");
  await switchUser(page, info, KARIN, `/arenden/${SC.nadia}?flik=historik`);
  expect(await logRows(page, "Visade röstmeddelanden")).toBe(0);
  const opened0 = await logRows(page, "Öppnade deltagarkortet");
  expect(opened0).toBe(1);

  // Läs → Dölj → Läs: två utfällningar = två visningar.
  await switchUser(page, info, COACH, `/arenden/${SC.nadia}`);
  await page.getByRole("tab", { name: /^Meddelanden/ }).click();
  const group = page.getByRole("group", { name: "Röstmeddelanden:" });
  await btn(group, "Läs").click();
  await expect(card(page, "Deltagarens röstmeddelanden")).toContainText("Praktiken har börjat bra");
  await btn(group, "Dölj").click();
  await expect(card(page, "Deltagarens röstmeddelanden")).toHaveCount(0);
  await btn(group, "Läs").click();
  await expect(card(page, "Deltagarens röstmeddelanden")).toContainText("Praktiken har börjat bra");
  await switchUser(page, info, KARIN, `/arenden/${SC.nadia}?flik=historik`);
  expect(await logRows(page, "Visade röstmeddelanden")).toBe(2);
  expect(await logRows(page, "Öppnade deltagarkortet")).toBe(opened0 + 1);

  // Min vecka → "Läs röstmeddelandet" (?visa=rost): utfälld från början = en visning.
  await switchUser(page, info, COACH, "/min-vecka");
  await card(page, "Deltagarnas röstmeddelanden").getByRole("link", { name: "Läs röstmeddelandet" }).first().click();
  await expect(card(page, "Deltagarens röstmeddelanden")).toContainText("Praktiken har börjat bra");
  // Nytt sidbesök på kortet: Min vecka och tillbaka → öppningen loggas igen (en gång per besök, inte per session), och
  // eftersom Tillbaka leder till ?visa=rost fälls texten ut igen = en ny visning av transkriptet (loggas).
  await page.locator("aside nav").getByRole("link", { name: /^Min vecka/ }).click();
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Min vecka");
  await page.goBack();
  await expect(card(page, "Deltagarens röstmeddelanden")).toContainText("Praktiken har börjat bra");
  await switchUser(page, info, KARIN, `/arenden/${SC.nadia}?flik=historik`);
  expect(await logRows(page, "Visade röstmeddelanden")).toBe(4);
  expect(await logRows(page, "Öppnade deltagarkortet")).toBe(opened0 + 3);

  // Avstämningen visar texten direkt som underlag: en visning per besök, inte en per omrendering.
  await switchUser(page, info, COACH, `/avstamning/${SC.nadia}`);
  await expect(main(page)).toContainText("Deltagarens röstmeddelanden – underlag");
  // Sidan ritas om flera gånger medan frågorna kommer in – fortfarande en visning.
  await page.waitForTimeout(500);
  await switchUser(page, info, KARIN, `/arenden/${SC.nadia}?flik=historik`);
  expect(await logRows(page, "Visade röstmeddelanden")).toBe(5);
  expect(relevant(errors)).toEqual([]);
});
