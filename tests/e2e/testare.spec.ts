// Testare utan priser (beslut 2026-10-02): kollegorna som testar ser inga priser, belopp i kronor, fakturaunderlag, interna
// mål eller avtalssidan – vilken testperson de än agerar som. Karim och Ali ser allt.
// Beslut 5 (2026-10-07): belopp syns bara för rollen ekonom – också för Karim och Ali, och i prototypen och utvecklingsläget.
//   app  – minnesläget simulerar en begränsad testare (POST /api/dev-session med testerId, bara i minnesläget).
//   demo – prototypen har inga testare: samma sidor visar priserna som förut (prototypen påverkas inte).
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open } from "./helpers";

type Who = { userId: string; role: string };
const ROBIN: Who = { userId: "u-robin", role: "admin" };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const JOHAN: Who = { userId: "u-johan", role: "avtalsansvarig" };
const KARIN: Who = { userId: "u-karin", role: "chef" };
const LARS: Who = { userId: "u-lars", role: "ekonom" };
const MARIA: Who = { userId: "k-maria", role: "kommun_handlaggare" };
const LIMITED = "tester-sara";

const main = (page: Page) => page.locator("#main");
/** Sidans synliga text (innerText – utan skript), hårda mellanslag som vanliga. */
const pageText = (page: Page) => page.locator("body").evaluate((el) => (el as HTMLElement).innerText.replace(/\u00a0/g, " "));
/** Ett belopp i kronor ("13 980 kr", "1 398 kr") – inte ord som börjar på kr ("10 krävs"). */
const AMOUNT = /\d\s?kr(?![a-zåäö])/i;
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

/** Appen: nytt testdata och en begränsad testare som agerar som testpersonen. */
async function asTester(page: Page, to: string, who: Who, testerId = LIMITED) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  expect((await page.request.post("/api/dev-session/reset")).ok()).toBeTruthy();
  expect((await page.request.post("/api/dev-session", { data: { ...who, testerId } })).ok()).toBeTruthy();
  await page.goto(to);
  await loaded(page);
  await expect(main(page)).toBeVisible();
  return errors;
}

/** Deltagarkortets huvud är kompakt: beställningen (omfattningen i veckor) ligger under "Visa alla uppgifter". */
async function showFacts(page: Page) {
  await main(page).getByRole("button", { name: "Visa alla uppgifter" }).click();
  await expect(main(page).getByRole("button", { name: "Dölj uppgifterna" })).toHaveAttribute("aria-expanded", "true");
}

/** Byt sida utan att nollställa testdatat. */
async function go(page: Page, to: string) {
  await page.goto(to);
  await loaded(page);
  await expect(main(page)).toBeVisible();
}

test.describe("begränsad testare (appen)", () => {
  test.beforeEach(({}, info: TestInfo) => {
    test.skip(isDemo(info), "Prototypen har inga testare – se testet för prototypen nedan.");
  });

  test("systemadministratör: ingen avtalssida i menyn, startsidan är Min vecka, bakgrundsjobben syns men inte underbiträdena", async ({ page }) => {
    const errors = await asTester(page, "/", ROBIN);
    await expect(page).toHaveURL(/\/min-vecka$/);
    const menu = page.getByRole("navigation", { name: "Meny" });
    await expect(menu.getByText("Administratör", { exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Användare och roller" })).toBeVisible();
    await expect(menu.getByRole("link", { name: /Avtal och konfiguration/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Fakturering|Fakturakörning/ })).toHaveCount(0);
    // Min vecka: bakgrundsjobben men inga underbiträden, och ingen länk till avtalssidan (stängd för testare).
    await expect(main(page).getByRole("heading", { name: "Bakgrundsjobb", exact: true })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Underbiträden", exact: true })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: /Avtal och konfiguration/ })).toHaveCount(0);
    for (const s of ["Supabase", "Vercel", "Resend", "eu-north-1"]) expect(await pageText(page), s).not.toContain(s);
    // Inte heller länken från Användare och roller (avtalssidan ligger inte i menyn för någon).
    await go(page, "/admin/anvandare");
    await expect(main(page).getByRole("heading", { level: 1, name: "Användare och roller" })).toBeVisible();
    await expect(main(page).getByRole("link", { name: /Avtal och konfiguration/ })).toHaveCount(0);

    // Avtalssidan (alla flikar) är stängd – också via adressen.
    for (const to of ["/admin/avtal", "/admin/avtal?flik=priser", "/admin/avtal?flik=interna"]) {
      await go(page, to);
      await expect(page.getByRole("heading", { name: "Den här sidan visas inte för testare" })).toBeVisible();
      expect(await pageText(page), to).not.toMatch(AMOUNT);
      expect(await pageText(page), to).not.toMatch(/Prislista|Jämför avtalen|35 %/);
    }

    // Servern nekar frågorna bakom avtalssidan.
    for (const key of ["admin.contract", "admin.orgRules"]) {
      const res = await page.request.post("/api/rpc", { data: { kind: "query", key, input: {} } });
      expect(res.status(), key).toBe(403);
      expect(await res.json(), key).toEqual({ code: "tester_hidden", message: "Den här sidan visas inte för testare." });
    }

    await go(page, "/admin/integrationer");
    await expect(page.getByRole("heading", { name: "Bakgrundsjobb", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Kör nu/ }).first()).toBeVisible();
    for (const name of ["Underbiträden", "Regionlåsning", "Så ser kommunen det"]) await expect(page.getByRole("heading", { name, exact: true }), name).toHaveCount(0);
    await expect(page.getByText(/Botkyrka godkände underbiträdena/)).toHaveCount(0);
    await expect(main(page).getByText("Underbiträdena, regionlåsningen och kommunens villkor visas inte för testare.")).toBeVisible();
    // Leverantörerna och regionerna står inte heller i integrationskorten eller i nyckeltalet "Data lagras i".
    const it = await pageText(page);
    for (const s of ["Supabase", "Vercel", "Resend", "resend._domainkey", "Google", "Vertex", "Gemini", "eu-north-1", "eu-west-1", "arn1"]) expect(it, s).not.toContain(s);
    await expect(page.getByRole("heading", { name: "E-postleverantör" })).toBeVisible();
    // Kör nu fungerar för alla testare.
    await page.getByRole("row", { name: /Beräkna nyckeltal/ }).getByRole("button", { name: "Kör nu" }).click();
    await expect(page.getByText("Beräkna nyckeltal kördes (simulerat).")).toBeVisible();
    expect(relevant(errors)).toEqual([]);
  });

  test("deltagarkortet: beställningen i veckor – inget pris och inget ordervärde (för någon sedan 2026-10-07)", async ({ page }) => {
    const errors = await asTester(page, "/arenden/case-260117", SARA);
    await showFacts(page);
    await expect(main(page)).toContainText(/\d+ veckor/);
    await expect(main(page).getByText("Visas inte för testare")).toHaveCount(0);
    expect(await pageText(page)).not.toMatch(AMOUNT);
    expect(relevant(errors)).toEqual([]);
  });

  test("chefens Min vecka: inga belopp och inget internt mål", async ({ page }) => {
    const errors = await asTester(page, "/", KARIN);
    await expect(page).toHaveURL(/\/min-vecka$/);
    await expect(main(page).getByRole("heading", { name: "Nyckeltal i korthet" })).toBeVisible();
    const t = await pageText(page);
    expect(t).not.toMatch(AMOUNT);
    expect(t).not.toMatch(/Internt mål \d|internt mål \d|Internt \d/);
    await expect(main(page).getByText("Visas inte för testare").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Fakturering|Fakturakörning/ })).toHaveCount(0);
    expect(relevant(errors)).toEqual([]);
  });

  test("ledningsvyn och Ekonomi: inget belopp, inget internt mål och ingen faktureringssida", async ({ page }) => {
    const errors = await asTester(page, "/ledning", KARIN);
    await expect(page.getByRole("heading", { name: "Ofakturerat" })).toBeVisible();
    const t = await pageText(page);
    expect(t).not.toMatch(AMOUNT);
    expect(t).not.toMatch(/Internt mål \d|internt mål \d|Internt \d/);
    expect(t).toContain("Visas inte för testare");
    expect(t).toMatch(/Avtalsmål 32/);
    await expect(page.getByRole("link", { name: "Till faktureringen" })).toHaveCount(0);
    // Ofakturerat: fakturaunderlaget lämnas inte ut (inga veckor, ärenden eller belopp).
    expect(t).not.toMatch(/veckor i \d+ ärende|Äldsta veckan/);
    // Per coach och Deltagarnas röst: inga interna mål för dokumentationstid och svarsfrekvens, ingen Bevaka-flagga.
    for (const to of ["/ledning?flik=coacher", "/ledning?flik=puls"]) {
      await go(page, to);
      const tt = await pageText(page);
      expect(tt, to).not.toMatch(/internt mål (högst )?\d|Internt mål: högst|över internt mål|Når målet|Under målet/);
      expect(tt, to).not.toMatch(AMOUNT);
    }
    await expect(main(page).getByText(/internt mål visas inte för testare/).first()).toBeVisible();
    // Ekonomi är bara ekonomens (beslut 5) – chefen nekas redan av rollen.
    for (const to of ["/ekonomi", "/ekonomi/2027-01"]) {
      await go(page, to);
      await expect(main(page)).toContainText("Du har inte behörighet till den här sidan");
      expect(await pageText(page), to).not.toMatch(AMOUNT);
    }
    await go(page, "/avtalsavvikelser");
    expect(await pageText(page)).not.toMatch(AMOUNT);
    await go(page, "/arenden");
    expect(await pageText(page)).not.toMatch(AMOUNT);
    expect(relevant(errors)).toEqual([]);
  });

  test("avtalsansvarig: Min vecka, inkorgen, förfallolistan och orderbekräftelsen utan belopp", async ({ page }) => {
    const errors = await asTester(page, "/min-vecka", JOHAN);
    expect(await pageText(page)).not.toMatch(AMOUNT);
    expect(await pageText(page)).not.toMatch(/Vite \d|Internt mål \d/);
    for (const to of ["/forfaller", "/inkorg", "/rapporter/rep-16392"]) {
      await go(page, to);
      expect(await pageText(page), to).not.toMatch(AMOUNT);
      expect(await pageText(page), to).not.toMatch(/Fakturor för .* i Fortnox/);
    }
    // Orderbekräftelsen har inget pris för någon sedan 2026-10-07 (synpunkt #10) – inget att dölja för testaren.
    await expect(main(page).getByText("Visas inte för testare")).toHaveCount(0);
    expect(await pageText(page)).not.toMatch(/Beställningens värde|Veckopris/);
    expect(relevant(errors)).toEqual([]);
  });

  test("kommunens portal: deltagarsidan utan beställningens värde", async ({ page }) => {
    const errors = await asTester(page, "/portal/deltagare/case-260119", MARIA);
    // Portalen har inga belopp för någon sedan 2026-10-07 (synpunkt #10 och #11) – inget att dölja för testaren.
    await expect(main(page)).toContainText("Orderbekräftelse");
    await expect(main(page).getByText("Visas inte för testare")).toHaveCount(0);
    expect(await pageText(page)).not.toMatch(/Beställningens värde/);
    expect(await pageText(page)).not.toMatch(AMOUNT);
    expect(relevant(errors)).toEqual([]);
  });

  test("Karim (fullständig åtkomst) ser avtalssidan – och beloppen bara som ekonom (beslut 5)", async ({ page }) => {
    await asTester(page, "/arenden/case-260117", SARA, "tester-karim");
    await showFacts(page);
    expect(await pageText(page)).not.toMatch(AMOUNT);
    await expect(main(page).getByText("Visas inte för testare")).toHaveCount(0);
    await asTester(page, "/ekonomi", LARS, "tester-karim");
    await expect(main(page)).toContainText("511 332 kr");
    await go(page, "/ekonomi/prislista");
    expect(await pageText(page)).toMatch(AMOUNT);
    // Avtalssidan ligger inte i menyn (beslut 2026-10-06) – Karim når den från Användare och roller.
    await asTester(page, "/admin/anvandare", ROBIN, "tester-karim");
    await expect(page.getByRole("navigation", { name: "Meny" }).getByRole("link", { name: /Avtal och konfiguration/ })).toHaveCount(0);
    await main(page).getByRole("link", { name: "Avtal och konfiguration" }).click();
    await expect(page).toHaveURL(/\/admin\/avtal$/);
    await expect(main(page).getByRole("heading", { level: 1, name: "Avtal och konfiguration" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Den här sidan visas inte för testare" })).toHaveCount(0);
  });

  test("Agera som: en begränsad testare kan inte välja rollen ekonom", async ({ page }) => {
    await asTester(page, "/", ROBIN);
    const res = await page.request.post("/api/dev-session", { data: { userId: "u-lars", role: "ekonom", testerId: LIMITED } });
    expect(res.status()).toBe(400);
    // Inte heller med tom roll eller annan stavning – kontrollen gäller testpersonen som kakan ger.
    for (const role of ["", "Ekonom"]) {
      expect((await page.request.post("/api/dev-session", { data: { userId: "u-lars", role, testerId: LIMITED } })).status(), role).toBe(400);
    }
    expect((await (await page.request.get("/api/session")).json()).persona.actor.role).toBe("admin");
    const session = await (await page.request.get("/api/session")).json();
    expect(session.hidesCommercial).toBe(true);
    expect(session.personas.some((p: { role: string }) => p.role === "ekonom")).toBe(false);
  });
});

test("prototypen och utvecklingsläget utan testare: inga testarspärrar – belopp bara för ekonomen (beslut 5)", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden/case-260117", SARA);
  await expect(main(page)).toBeVisible();
  await showFacts(page);
  expect(await pageText(page)).not.toMatch(AMOUNT);
  await expect(main(page).getByText("Visas inte för testare")).toHaveCount(0);
  const e2 = await open(page, info, "/ekonomi", LARS);
  await expect(main(page)).toContainText("511 332 kr");
  await expect(main(page).getByText("Visas inte för testare")).toHaveCount(0);
  expect(relevant([...errors, ...e2])).toEqual([]);
});
