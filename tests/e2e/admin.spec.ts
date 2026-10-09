// Interaktionstest för området admin (/admin/avtal, /admin/anvandare, /admin/integrationer, /admin/mallar, /admin/logg).
// Port av den gamla prototypens prototyp/tools/test-admin.mjs (stegen för admin.*). Pulsmätningen och arbetsgivarregistret
// finns i puls.spec.ts och praktik.spec.ts. Varje test börjar med nollställda testdata; data läses via skärmen.
// Det som prototypen kontrollerade i sitt interna tillstånd (MM.store) kontrolleras här i vyerna (t.ex. revisionsloggen).
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const ROBIN: Who = { userId: "u-robin", role: "admin" };
const JOHAN: Who = { userId: "u-johan", role: "avtalsansvarig" };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const KARIN: Who = { userId: "u-karin", role: "chef" };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const MARIA: Who = { userId: "k-maria", role: "kommun_handlaggare" };
/** Aktörerna som prototypens kommandologg sparar (avtal och enhet som i testdatat). */
const ACTOR: Record<string, object> = {
  "u-robin": { userId: "u-robin", role: "admin", contractIds: ["c-bot"], customerUnit: null },
  "k-maria": { userId: "k-maria", role: "kommun_handlaggare", contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" },
  deltagare: { userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null },
};

const main = (page: Page) => page.locator("#main");
/** textContent (inte innerText) så att CSS-versaler inte påverkar jämförelserna; hårda mellanslag som vanliga. */
const text = (page: Page) => main(page).evaluate((el) => (el.textContent ?? "").replace(/ /g, " "));
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).first();

/** Byt testperson utan att nollställa testdata. */
async function switchTo(page: Page, info: TestInfo, to: string, who: Who) {
  if (isDemo(info)) {
    await page.route("http://proto.test/blank.html", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Byter testperson</title>" }));
    await page.goto("http://proto.test/blank.html");
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), who);
    await page.goto(`http://proto.test/index.html#${to}`);
  } else {
    await switchPersona(page, who);
    await page.goto(to);
    await loaded(page);
  }
  await expect(main(page)).toBeVisible();
}

/**
 * Kör ett kommando som en annan användare gjort (motsvarar prototypens MM.dispatch i det gamla testet).
 * Prototypen: läggs i kommandologgen och spelas upp vid nästa laddning. Appen: POST /api/rpc som den användaren.
 * Anroparen byter sedan till den testperson som ska se resultatet (switchTo).
 */
async function runAs(page: Page, info: TestInfo, who: Who, key: string, input: unknown) {
  if (isDemo(info)) {
    await page.evaluate(
      ({ key, input, actor }) => {
        const k = "miljonmatch-prototyp-v2-logg";
        const log = JSON.parse(localStorage.getItem(k) ?? "[]");
        log.push({ key, input, actor });
        localStorage.setItem(k, JSON.stringify(log));
      },
      { key, input, actor: ACTOR[who.userId] },
    );
  } else {
    await switchPersona(page, who);
    const res = await page.request.post("/api/rpc", { data: { kind: "command", key, input } });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).result.ok).toBe(true);
  }
}

/** "Vyn renderar utan problem": rubrik och inga undefined/NaN i texten. */
async function rendersOk(page: Page) {
  await expect(main(page).locator("h1").first()).toBeVisible();
  expect(await text(page)).not.toMatch(/undefined|NaN|\[object Object\]/);
}

// ------------------------------------------------------------------ admin.avtal
test("avtal: konfiguration och ej fastställda värden – ett avtal, ingen väljare, ingen jämförelse och inga belopp (beslut 5)", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/avtal", ROBIN);
  await rendersOk(page);
  // AI-leverantören är fastställd sedan 2026-09-30 (Gemini Flash via Vertex AI EU). Gallringen av bilagor till beställningen
  // togs bort 2026-10-08 (beslut 5: bilagor gallras inte automatiskt) – därför 10.
  await expect(main(page)).toContainText("10 värden är inte fastställda – reglerna aktiveras inte");
  let t = await text(page);
  expect(t).not.toContain("Gallring av bilagor");
  expect((t.match(/Ej fastställt – regeln aktiveras inte/g) ?? []).length).toBeGreaterThanOrEqual(9);
  expect(!/\b35 %/.test(t) || t.includes("Internt mål")).toBe(true);
  expect(t).not.toMatch(/deadline/i);
  // Bara kommunavtal i Miljonmatch (beslut 2026-10-06): ett avtal i testdatat – ingen avtalsväljare, ingen jämförelse.
  await expect(page.getByRole("group", { name: "Välj avtal" })).toHaveCount(0);
  // Beslut 5 (2026-10-07): belopp syns bara för ekonomen – prislistan finns under Ekonomi, inte här.
  await expect(page.getByRole("tab")).toHaveText([/Avtal och regler/, /Interna regler \(Miljonbemanning\)/]);
  expect(t).toContain("Per tillfälle enligt avtalet. Beloppet visas bara för ekonomen.");
  expect(t).not.toMatch(/\d[\u00a0 ]kr(?![a-zåäö])/i);
  expect(t).not.toMatch(/Kammarkollegiet|Jämför avtalen|Mötesminimum|Startpaket|Personuppgiftsansvarig –/);
  expect(t).toContain("Personuppgiftsbiträde – kommunen är personuppgiftsansvarig");
  await page.locator("summary", { hasText: "Visa JSON (contracts.config)" }).click();
  expect(await text(page)).toContain('"casePrefix": "BOT"');
  await expect(page.locator("summary", { hasText: "Dölj JSON (contracts.config)" })).toHaveCount(1);
  if (isDemo(info)) {
    await btn(page, "Öppna frågor till Botkyrka").click();
    await expect(page).toHaveURL(/#\/om\/fragor/);
  } else {
    // Frågorna till Botkyrka är en sida i prototypen – knappen finns inte i appen.
    await expect(page.getByRole("button", { name: "Öppna frågor till Botkyrka" })).toHaveCount(0);
  }

  // Den gamla adressen till prislistan visar avtalet.
  await switchTo(page, info, "/admin/avtal?flik=prislista", ROBIN);
  await expect(page.getByRole("tab", { name: /Avtal och regler/ })).toHaveAttribute("aria-selected", "true");
  t = await text(page);
  expect(t).not.toContain("Prislista – pris per deltagare och vecka");
  expect(relevant(errors)).toEqual([]);
});

test("avtal: inte i menyn – nås från Användare och roller; gamla adresser till jämförelsen visar avtalet", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/anvandare", ROBIN);
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Användare och roller");
  await expect(page.getByRole("link", { name: "Avtal och konfiguration" })).toHaveCount(1);
  await main(page).getByRole("link", { name: "Avtal och konfiguration" }).click();
  await expect(page).toHaveURL(isDemo(info) ? /#\/admin\/avtal$/ : /\/admin\/avtal$/);
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Avtal och konfiguration");
  // Brödsmulan leder tillbaka.
  await expect(page.getByRole("navigation", { name: "Brödsmulor" }).getByRole("link", { name: "Användare och roller" })).toBeVisible();

  for (const to of ["/admin/avtal?avtal=c-finns-inte&flik=jamfor", "/admin/avtal?flik=jamforelse"]) {
    await switchTo(page, info, to, ROBIN);
    await expect(page.getByRole("tab", { name: /Avtal och regler/ })).toHaveAttribute("aria-selected", "true");
    await expect(main(page)).toContainText("Botkyrka kommun (212000-2882)");
    await expect(page).toHaveTitle(/Avtal och konfiguration/);
  }
  await switchTo(page, info, "/admin/avtal", ROBIN);
  // Eskaleringstrappans text räknas fram ur konfigurationen (steg med "skriftlig varning")
  await expect(main(page)).toContainText("Skriftliga varningar kan ges på steg 1–3. 3 varningar kan leda till uppsägning.");
  expect(relevant(errors)).toEqual([]);
});

test("avtal: interna regler – ändra, slå igenom i notiserna och återställ", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/avtal?flik=interna", ROBIN);
  await expect(main(page)).toContainText("Interna regler för Miljonbemanning – inte avtalskrav");
  const escBefore = Number((await text(page)).match(/Eskaleringar(\d+)/)?.[1]);
  expect(escBefore).toBe(3);
  await expect(main(page)).toContainText(/Påminnelser till coacher\s*17/);
  await page.locator("#rule-remind").selectOption("2");
  await expect(main(page)).toContainText("Eskaleringen måste komma efter påminnelsen");
  await expect(btn(page, "Spara reglerna")).toBeDisabled();
  await page.locator("#rule-esc").selectOption("3");
  await page.locator("#rule-to-avtalsansvarig").check();
  await expect(page.locator("#rule-to-coach")).toBeDisabled();
  await expect(main(page)).toContainText("Med de sparade reglerna: 17 påminnelser och 3 eskaleringar.");
  await btn(page, "Spara reglerna").click();
  await expect(main(page)).toContainText("Inga osparade ändringar.");
  await expect(main(page)).toContainText("Påminnelse efter 1 vecka → 2 veckor");
  const escAfter = Number((await text(page)).match(/Eskaleringar(\d+)/)?.[1]);
  expect(escAfter).toBeLessThanOrEqual(escBefore);
  // Reglerna är sparade (även efter omladdning)
  await page.reload();
  await expect(page.locator("#rule-remind")).toHaveValue("2");
  await expect(page.locator("#rule-esc")).toHaveValue("3");
  await expect(page.locator("#rule-to-avtalsansvarig")).toBeChecked();
  await expect(page.locator("#rule-to-chef")).toBeChecked();

  // Avtalsansvarig får eskaleringarna direkt, coachen aldrig
  await switchTo(page, info, "/notiser", JOHAN);
  await expect(main(page)).toContainText("Eskalering:");
  expect(((await text(page)).match(/Eskalering: \d+ veckor i rad utan progression/g) ?? []).length).toBe(escAfter);
  await switchTo(page, info, "/notiser", AMIRA);
  await expect(main(page).locator("h1")).toBeVisible();
  expect(await text(page)).not.toMatch(/Eskalering:/);

  // Ändringen loggas i revisionsloggen
  await switchTo(page, info, "/admin/logg", ROBIN);
  await page.locator("#log-action").selectOption("org_rule.updated");
  await expect(main(page)).toContainText("Poster (1)");

  // Återställ till de ursprungliga reglerna
  await switchTo(page, info, "/admin/avtal?flik=interna", ROBIN);
  await page.locator("#rule-remind").selectOption("1");
  await page.locator("#rule-esc").selectOption("2");
  await page.locator("#rule-to-avtalsansvarig").uncheck();
  await btn(page, "Spara reglerna").click();
  await expect(main(page)).toContainText("Inga osparade ändringar.");
  await page.reload();
  await expect(page.locator("#rule-remind")).toHaveValue("1");
  await expect(page.locator("#rule-esc")).toHaveValue("2");
  await expect(page.locator("#rule-to-avtalsansvarig")).not.toBeChecked();
  expect(relevant(errors)).toEqual([]);
});

// ------------------------------------------------------------------ admin.anvandare
test("användare: avtalsansvarig bjuder in och spärrar en kommunanvändare", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/anvandare", JOHAN);
  await expect(main(page)).toContainText("Kommunens användare");
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Kommunanvändare");
  if (isDemo(info)) {
    await page.setViewportSize({ width: 400, height: 860 });
    const sw = await page.getByRole("button", { name: "Se kundens inloggning" }).evaluate((b) => {
      const card = b.closest("section")!;
      const r = b.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      return { over: r.right - c.right, scroll: b.scrollWidth - b.clientWidth };
    });
    expect(sw.over).toBeLessThanOrEqual(0);
    expect(sw.scroll).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  const table = page.getByRole("table", { name: "Kommunens användare" });
  // Kommunens chef finns inte längre (beslut 2026-10-07): fyra handläggare och rubrikraden.
  await expect(table.getByRole("row")).toHaveCount(5);
  await btn(page, "Bjud in kommunanvändare").click();
  const dialog = page.getByRole("dialog");
  await page.locator("#inv-name").fill("Kim Andersson");
  await page.locator("#inv-email").fill("kim.andersson@gmail.com");
  await page.locator("#inv-unit").fill("Arbetsmarknadsenheten Tumba");
  // Kommunen har bara rollen handläggare och ingen beställarreferens (beslut 2026-10-07). Självregistreringen förklaras.
  await expect(page.locator("#inv-role")).toHaveCount(0);
  await expect(dialog).not.toContainText("Beställarreferens");
  await expect(dialog).toContainText("kan också skapa ett konto själv");
  await dialog.getByRole("button", { name: "Skicka inbjudan" }).click();
  await expect(dialog).toContainText("Adressen måste sluta på @botkyrka.se");
  // Ingen användare skapas med fel domän (tabellen är dold för skärmläsare medan dialogen är öppen)
  await expect(page.getByRole("table", { name: "Kommunens användare", includeHidden: true }).getByRole("row", { includeHidden: true })).toHaveCount(5);
  await page.locator("#inv-email").fill("kim.andersson@botkyrka.se");
  await dialog.getByRole("button", { name: "Skicka inbjudan" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(table.getByRole("row")).toHaveCount(6);
  const row = page.getByRole("row", { name: /Kim Andersson/ });
  await expect(row).toContainText("Handläggare");
  await expect(row).toContainText("Arbetsmarknadsenheten Tumba");
  await expect(row).not.toContainText("Beställarreferens");
  await expect(row).toContainText("Inbjuden 1 feb");
  await expect(main(page)).toContainText(/Väntande inbjudningar\s*1/);
  await row.getByRole("button", { name: "Spärra" }).click();
  await expect(row).toContainText("Spärrad");
  await expect(row.getByRole("button", { name: "Aktivera" })).toBeVisible();
  await page.getByRole("tab", { name: /Behörigheter/ }).click();
  const t = await text(page);
  expect(t).toContain("Påminnelser om utebliven progression: coach");
  expect(t).toContain("Eskaleringar: chef/controller – syns inte för coachen");
  await expect(page.getByRole("tab", { name: /Miljonbemanning/ })).toHaveCount(0);

  // Inbjudan skickas utan personuppgifter i texten och loggas
  await switchTo(page, info, "/admin/mallar?flik=logg", ROBIN);
  const mail = main(page).locator("[data-send-item]", { hasText: "Inbjudan till portalen" });
  await expect(mail).toHaveCount(1);
  await expect(mail).toContainText("Till kim.andersson@botkyrka.se");
  await expect(mail).toContainText("Du har bjudits in till Miljonbemannings portal för beställare.");
  await expect(mail).not.toContainText("Kim Andersson");
  await switchTo(page, info, "/admin/logg", ROBIN);
  await page.locator("#log-action").selectOption("customer_user.invited");
  await expect(main(page)).toContainText("Poster (1)");
  await expect(main(page)).toContainText("Domän: botkyrka.se");
  await switchTo(page, info, "/admin/anvandare", ROBIN);
  await expect(main(page)).toContainText("Kollegor på Miljonbemanning");
  expect(relevant(errors)).toEqual([]);
});

// ------------------------------------------------------------------ admin.integrationer
test("integrationer: underbiträden, regioner och bakgrundsjobb", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/integrationer", ROBIN);
  await rendersOk(page);
  const t = await text(page);
  for (const s of ["eu-north-1", "arn1", "Vertex AI", "Fortnox"]) expect(t).toContain(s);
  expect(t).not.toContain("Berget AI");
  expect(t).toContain("Regeln är inte fastställd (fråga 11)");
  // Veckorapportjobbets tid läses från avtalet (veckorapport_publicering 16:00)
  expect(t).toContain("senast 16.00 enligt avtalet");
  expect(t).toContain("17 påminnelser till coacher, 3 eskaleringar till chef");
  await expect(page.getByRole("row", { name: /Gallring enligt PUB-avtalet/ }).getByRole("button", { name: /Kör nu/ })).toBeDisabled();
  await page.getByRole("row", { name: /Läs avrop@-inkorgen/ }).getByRole("button", { name: /Kör nu/ }).click();
  await expect(page.getByRole("row", { name: /Läs avrop@-inkorgen/ })).toContainText("Manuellt av dig");
  await expect(page.getByRole("row", { name: /Läs avrop@-inkorgen/ })).toContainText("1 feb kl. 09.13");
  await switchTo(page, info, "/admin/logg", ROBIN);
  await page.locator("#log-action").selectOption("job.run_manual");
  await expect(main(page)).toContainText("Poster (1)");
  await expect(main(page)).toContainText("Läs avrop@-inkorgen");
  expect(relevant(errors)).toEqual([]);
});

// ------------------------------------------------------------------ admin.mallar
test("mallar: den generiska bekräftelsen används inte (skyddade personuppgifter borttagna) och tidsgräns från avtalet", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/mallar?flik=logg", ROBIN);
  // Beslut 2026-10-07: skyddet är borttaget ur appen – ingen generisk mottagningsbekräftelse i utskicken.
  await expect(main(page)).toContainText("Utskickslogg (");
  await expect(main(page).locator("[data-send-item]", { hasText: "Generisk mottagningsbekräftelse" })).toHaveCount(0);
  let t = await text(page);
  // Inga mallkoder syns i utskicksloggen
  expect(t.replace(/@[\w.-]+/g, "")).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  // En portalbeställning ger ordererkännandet med ärendenummer (ingen fråga om skydd).
  await runAs(page, info, MARIA, "arenden.caseCreate", {
    source: "portal", referrerUnit: "Arbetsmarknadsenheten Alby", firstName: "Test", lastName: "Mallsson", pnr: "19950505-1111", desiredStart: "2027-02-15", orderPeriodMonths: 6, priorAssessment: "no",
  });
  await switchTo(page, info, "/admin/mallar?flik=logg", ROBIN);
  const first = main(page).locator("[data-send-item]").first();
  await expect(first).toContainText(/Ordererkännande/);
  await expect(first).toContainText("BOT-27-0051");
  await expect(first).not.toContainText("Mallsson");
  if (isDemo(info)) await expect(first).toContainText("Orsakat av dig i prototypen");
  // Mallarna finns kvar för gamla utskick – märkta att de inte används.
  await page.getByRole("tab", { name: /Mallar/ }).click();
  await btn(page, /Generisk mottagningsbekräftelse – mejl/).click();
  await expect(page.locator("#tpl-body")).toHaveValue("Tack för ditt mejl. Vi har tagit emot det och ringer dig i dag.");
  await expect(main(page)).toContainText("Två varianter – används inte sedan 2026-10-07");
  t = await text(page);
  expect(t).toContain("Används inte sedan 2026-10-07");
  await btn(page, /^Ordererkännande/).click();
  // Ordererkännandets tidsgräns läses från avtalet (5 minuter)
  await expect(main(page)).toContainText("Automatiskt inom 5 minuter");
  expect(relevant(errors)).toEqual([]);
});

test("mallar: personuppgiftskontroll, ny version och utskickslogg", async ({ page }, info) => {
  // Samordnaren ser mallarna och kan pröva texten, men bara systemadmin sparar nya versioner (SPEC §9, policyn).
  const errors = await open(page, info, "/admin/mallar", SARA);
  await btn(page, /Pulslänk/).click();
  await page.locator("#tpl-body").fill("Hej {namn}! Svara på fem korta frågor: {lank}");
  await expect(main(page)).toContainText("Innehåller personuppgifter – kan inte sparas");
  await expect(page.getByRole("button", { name: /Spara som version/ })).toHaveCount(0);
  await expect(main(page)).toContainText("Bara systemadmin kan spara en ny version av mallen.");

  await switchTo(page, info, "/admin/mallar", ROBIN);
  await btn(page, /Pulslänk/).click();
  await page.locator("#tpl-body").fill("Hej {namn}! Svara på fem korta frågor: {lank}");
  await expect(main(page)).toContainText("Innehåller personuppgifter – kan inte sparas");
  await expect(page.getByRole("button", { name: /Spara som version/ })).toBeDisabled();
  await page.locator("#tpl-body").fill("Hej! Hur går det hos oss? Svara på fem korta frågor: {lank} Länken gäller i 7 dagar. Det är frivilligt och påverkar inte din insats.");
  await page.getByRole("button", { name: /Spara som version 3/ }).click();
  await expect(main(page)).toContainText("Version 3");
  await expect(main(page)).toContainText("Tidigare versioner");
  await expect(main(page)).toContainText("Version 3 · 1 feb kl. 09.13 · Robin Åberg");
  // Inloggningskoden (beslut 2026-10-02): fast text som servern bygger – visas, men kan inte ändras här.
  await btn(page, /Inloggningskod/).click();
  await expect(main(page)).toContainText("Fast text – mejlet byggs av servern");
  await expect(main(page)).toContainText("Din inloggningskod till Miljonmatch");
  await expect(main(page)).toContainText("418302");
  await expect(page.locator("#tpl-body")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Spara som version/ })).toHaveCount(0);
  await page.getByRole("tab", { name: /Utskickslogg/ }).click();
  await expect(main(page)).toContainText("Kontroll: inga utskick innehåller namn eller personnummer");
  await switchTo(page, info, "/admin/mallar?flik=logg", ROBIN);
  await expect(main(page)).toContainText("Utskickslogg (");
  expect(relevant(errors)).toEqual([]);
});

// ------------------------------------------------------------------ admin.logg
test("revisionslogg: läsbara värden, filter, export och markering", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/logg", ROBIN);
  // Det testaren gjort: interna regler ändrade två gånger, ett pulssvar och ett manuellt jobb
  await runAs(page, info, ROBIN, "admin.setOrgRule", { remindCoachAfterWeeks: 2, escalateAfterConsecutiveWeeks: 3, escalateTo: ["chef"], channels: ["app", "email"], assignmentChannels: ["app", "email"] });
  await runAs(page, info, ROBIN, "admin.setOrgRule", { remindCoachAfterWeeks: 1, escalateAfterConsecutiveWeeks: 2, escalateTo: ["chef"], channels: ["app", "email"], assignmentChannels: ["app", "email"] });
  await runAs(page, info, { userId: "deltagare", role: "deltagare" }, "puls.submit", { language: "sv", answers: { q1: 4, q2: 3, q3: 2, q4: "praktik", q5: "ja" }, text: "" });
  await switchTo(page, info, "/admin/logg", ROBIN);
  const t = await text(page);
  // Mallen för den generiska bekräftelsen finns inte i loggen sedan 2026-10-07 (em-104 är en vanlig fråga).
  for (const s of ["Tolkning: Word-mall", "Tolkning: AI", "Period: rullande 6 månader", "Typ: tolka mejl", "Typ: transkribering och utkast", "Mall: Ordererkännande"]) expect(t).toContain(s);
  expect(t).not.toMatch(/Tolkning: template|Kanal: email|Typ: parse_email|rolling_6m|Mall: generisk_/);
  expect(t).not.toMatch(/\b(report\.view|case\.view|notify\.email|email\.received)\b/);
  expect(await page.locator('[title="Åtgärdskod: notify.email"]').count()).toBeGreaterThan(0);
  expect(t).toContain("Deltagare (engångslänk)");
  expect(t).toContain("Pulssvar inskickat");
  expect(t).toContain("Påminnelse efter 1 vecka → 2 veckor");
  if (isDemo(info)) expect(t).toContain("Gjort av dig i prototypen");
  await page.locator("#log-action").selectOption("org_rule.updated");
  await expect(main(page)).toContainText("Poster (2)");
  await page.locator("#log-action").selectOption("");
  await page.locator("#log-actor").selectOption("u-robin");
  await expect(main(page)).toContainText("Poster (2)");
  await page.locator("#log-actor").selectOption("__null");
  await expect(main(page)).toContainText("Poster (1)");
  await page.locator("#log-actor").selectOption("");
  // Nadias ärende: visat deltagarkort, meddelande från Maria och pulssvaret
  await page.locator("#log-case").fill("BOT-26-0143");
  await expect(main(page)).toContainText("Poster (3)");
  await page.locator("#log-case").fill("");
  // 22 poster: utskicket av den generiska bekräftelsen till em-104 finns inte sedan 2026-10-07.
  await expect(main(page)).toContainText("Poster (22)");

  // Exporten loggas och innehåller åtgärdskoden
  let csv = "";
  if (isDemo(info)) {
    await btn(page, "Exportera (CSV)").click();
    csv = await page.locator("#text-dialog-area").inputValue();
    await page.keyboard.press("Escape");
  } else {
    const [dl] = await Promise.all([page.waitForEvent("download"), btn(page, "Exportera (CSV)").click()]);
    const fs = await import("node:fs");
    csv = fs.readFileSync((await dl.path())!, "utf8").replace(/^﻿/, "");
  }
  expect(csv.startsWith('"Tidpunkt";"Aktör"')).toBe(true);
  expect(csv).toContain('"Åtgärdskod"');
  expect(csv).toContain('"notify.email"');
  await expect(main(page)).toContainText("Exporterade revisionslogg");
  await expect(main(page)).toContainText(/Exporter\s*1/);
  if (isDemo(info)) await expect(main(page)).toContainText("Gör kontrollen som chef");
  else await expect(main(page)).toContainText("Inte gjord ännu.");
  expect(relevant(errors)).toEqual([]);
});

test("revisionslogg: chefens månatliga loggkontroll", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/logg", KARIN);
  await expect(main(page)).toContainText("Månatlig loggkontroll – januari 2027");
  const verdicts = page.locator('[aria-label^="Bedömning av"]');
  const n = await verdicts.count();
  expect(n).toBe(5);
  for (let i = 0; i < n; i++) await verdicts.nth(i).getByRole("button", { name: i === 0 ? /Avvikelse/ : /Motiverad/ }).click();
  await expect(main(page)).toContainText("5 av 5 poster bedömda");
  await btn(page, "Signera loggkontrollen").click();
  await expect(main(page)).toContainText("Beskriv avvikelsen");
  await page.locator("#logcheck-note").fill("Visningen saknar koppling till ett pågående ärende. Följs upp med samordnaren.");
  await btn(page, "Signera loggkontrollen").click();
  await expect(main(page)).toContainText("Loggkontrollen för januari 2027 är signerad");
  await expect(main(page)).toContainText("Karin Wallin signerade 1 feb kl. 09.13. 5 poster kontrollerade, 1 avvikelse.");
  await page.reload();
  await expect(main(page)).toContainText("är signerad");
  expect(relevant(errors)).toEqual([]);
});
