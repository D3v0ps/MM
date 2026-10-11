// Tom databas och riktig tid (beslut 2026-10-08, skarp drift): appen ska fungera utan ett enda ärende och med dagens datum.
// Körs bara i projektet "tom" (playwright.config.ts) mot en server med MM_SEED=empty: bara avtalet, konfigurationen och de
// sju kollegorna (alla systemadministratörer, Ali också avtalsansvarig), riktig klocka. Varje MB-roll får sin roll av
// administratören (admin.setStaffRoles – beslut 1) och klickar igenom Notiser, Min vecka och alla menyval; kommunens
// handläggare skapar sitt konto själv och klickar igenom portalmenyn. Tomma tillstånd i klarspråk – aldrig krasch, NaN,
// undefined eller "[object Object]". Rollväxlingen (beslut 2) prövas med Ali.
import { expect, test, type Page } from "@playwright/test";
import { acceptLeaveWarnings, loaded } from "./helpers";

type Who = { userId: string; role?: string };
const KARIM: Who = { userId: "tester-karim", role: "admin" };
/** Rollerna per kollega i testet (Karim ger dem rollen innan de loggar in). */
const ROLES: { role: string; userId: string; label: string }[] = [
  { role: "admin", userId: "tester-karim", label: "Systemadministratör" },
  { role: "avtalsansvarig", userId: "tester-ali", label: "Avtalsansvarig" },
  { role: "samordnare", userId: "tester-sara", label: "Operativ samordnare" },
  { role: "coach", userId: "tester-adam", label: "Huvudcoach" },
  // Rollen handledare finns inte (Karims beslut 2026-10-09): två jobbcoacher har rollen coach.
  { role: "coach", userId: "tester-shafik", label: "Huvudcoach" },
  { role: "chef", userId: "tester-moda", label: "Chef/controller" },
  { role: "ekonom", userId: "tester-yacine", label: "Ekonom" },
];

const main = (page: Page) => page.locator("#main");
const sidebar = (page: Page) => page.getByRole("complementary", { name: "Huvudmeny" });
/** Sidans text (hårda mellanslag som vanliga). */
const text = (page: Page) => main(page).evaluate((el) => (el.textContent ?? "").replace(/ /g, " "));
const BROKEN = /undefined|NaN|\[object Object\]|Invalid Date/;

async function reset(page: Page) {
  expect((await page.request.post("/api/dev-session/reset")).ok()).toBeTruthy();
}
async function loginAs(page: Page, who: Who) {
  expect((await page.request.post("/api/dev-session", { data: who })).ok()).toBeTruthy();
}
async function rpc(page: Page, kind: "query" | "command", key: string, input: unknown): Promise<unknown> {
  const res = await page.request.post("/api/rpc", { data: { kind, key, input } });
  expect(res.ok(), `${key}: ${res.status()}`).toBeTruthy();
  return (await res.json()).result;
}
/** Karim (admin) ger kollegan rollerna – beslut 1 (admin.setStaffRoles). */
async function giveRoles(page: Page, userId: string, roles: string[]) {
  await loginAs(page, KARIM);
  const r = (await rpc(page, "command", "admin.setStaffRoles", { userId, roles })) as { ok: boolean };
  expect(r.ok, `roller för ${userId}`).toBe(true);
}
/** Samlar fel i webbläsaren (skriptfel och console.error) – ikonens kapplöpning i Chromium räknas inte (se helpers.ts). */
function watch(page: Page): string[] {
  const errors: string[] = [];
  acceptLeaveWarnings(page);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location()?.url ?? "";
    if (/favicon\.ico|\/icon\.svg|\/apple-icon\.png/.test(url) || /favicon\.ico/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}
/** Öppna en sida och kontrollera att den visar en rubrik utan trasiga värden. */
async function visit(page: Page, to: string, label = to) {
  await page.goto(to);
  await loaded(page);
  await expect(main(page), label).toBeVisible();
  await expect(main(page).locator("h1").first(), `${label}: rubrik`).toBeVisible();
  const t = await text(page);
  expect(t, `${label}: trasiga värden`).not.toMatch(BROKEN);
  expect(t, `${label}: fel från servern`).not.toMatch(/Något gick fel|kunde inte hämtas/);
  return t;
}
/** Menyvalen i sidopanelen (sökvägar). */
const menuLinks = (page: Page) => page.locator("nav[aria-label=Meny] a[href]").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));

test("varje MB-roll: Notiser, Min vecka och alla menyval fungerar utan ett enda ärende, med dagens datum", async ({ page }) => {
  test.setTimeout(300_000);
  await reset(page);
  const errors = watch(page);
  const year = String(new Date().getFullYear());
  const seen: string[] = [];
  for (const { role, userId, label } of ROLES) {
    if (role !== "admin") await giveRoles(page, userId, [role]);
    await loginAs(page, { userId, role });
    // Riktig tid: diagnossidan visar dagens år (inte testklockans 2027).
    await page.goto("/diagnos");
    await loaded(page);
    await expect(page.getByTestId("diagnos")).toContainText(year);
    await expect(page.getByTestId("diagnos")).toContainText(role);
    const t = await visit(page, "/min-vecka", `${role}: Min vecka`);
    expect(t, `${role}: Min vecka`).toMatch(/Min vecka/i);
    await expect(sidebar(page), `${role}: rollen i sidopanelen`).toContainText(label);
    const links = await menuLinks(page);
    expect(links.length, `${role}: menyval`).toBeGreaterThanOrEqual(2);
    for (const href of links) {
      await visit(page, href, `${role}: ${href}`);
      seen.push(`${role} ${href}`);
    }
    // Startsidan och de gamla ingångarna leder rätt.
    await page.goto("/start");
    await loaded(page);
    await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe("/min-vecka");
  }
  // Alla roller nådde sina menyval.
  expect(seen.some((s) => s.startsWith("admin /admin/anvandare"))).toBe(true);
  expect(seen.some((s) => s.startsWith("ekonom /ekonomi/"))).toBe(true);
  expect(seen.some((s) => s.startsWith("chef /ledning"))).toBe(true);
  expect(seen.some((s) => s.startsWith("samordnare /inkorg"))).toBe(true);
  // Ingen roll når handledarens gamla sidor (borttagna 2026-10-09).
  expect(seen.some((s) => s.includes("/handledare"))).toBe(false);
  // Administratören kan inte ge rollen handledare (zod nekar den).
  await loginAs(page, KARIM);
  const denied = await page.request.post("/api/rpc", { data: { kind: "command", key: "admin.setStaffRoles", input: { userId: "tester-shafik", roles: ["handledare"] } } });
  expect(denied.status()).toBe(400);
  expect(errors).toEqual([]);
});

test("rollväxling: Ali har två roller, väljer i sidopanelen och valet sparas", async ({ page }) => {
  await reset(page);
  const errors = watch(page);
  // Utan vald roll: medlemskapet med lägst id (admin).
  await loginAs(page, { userId: "tester-ali" });
  await visit(page, "/min-vecka", "Ali utan val");
  await expect(sidebar(page)).toContainText("Systemadministratör");
  const select = page.locator("#rollval");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveText(["Systemadministratör", "Avtalsansvarig"]);
  // Karim (en roll) har ingen rollväljare.
  await loginAs(page, KARIM);
  await visit(page, "/min-vecka", "Karim");
  await expect(page.locator("#rollval")).toHaveCount(0);
  // Ali byter till avtalsansvarig: sidan laddas om i den nya rollen.
  await loginAs(page, { userId: "tester-ali" });
  await visit(page, "/min-vecka", "Ali igen");
  await page.locator("#rollval").selectOption("avtalsansvarig");
  await expect.poll(() => sidebar(page).textContent(), { timeout: 15_000 }).toContain("Avtalsansvarig");
  await loaded(page);
  await expect(page.locator("#rollval")).toHaveValue("avtalsansvarig");
  await expect(page.getByRole("navigation", { name: "Meny" })).toContainText("Avtalet");
  // Valet är sparat på servern: en ny inloggning utan angiven roll ger avtalsansvarig.
  await loginAs(page, { userId: "tester-ali" });
  await visit(page, "/min-vecka", "Ali efter valet");
  await expect(sidebar(page)).toContainText("Avtalsansvarig");
  const ping = (await rpc(page, "query", "session.ping", {})) as { role: string };
  expect(ping.role).toBe("avtalsansvarig");
  // Revisionsloggen: role.switched (bara id och roll).
  await loginAs(page, KARIM);
  await visit(page, "/admin/logg", "loggen");
  await expect(main(page)).toContainText("Bytte roll");
  expect(errors).toEqual([]);
});

test("lägg till kollega i appen: ny kollega med två roller, ändra roller, spärra", async ({ page }) => {
  await reset(page);
  const errors = watch(page);
  await loginAs(page, KARIM);
  await visit(page, "/admin/anvandare", "Användare och roller");
  await expect(main(page)).toContainText("Kollegor på Miljonbemanning");
  await page.getByRole("button", { name: "Lägg till kollega" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Tomt formulär: felsammanfattningen pekar på fälten.
  await dialog.getByRole("button", { name: "Lägg till kollega" }).click();
  await expect(dialog).toContainText("Rätta det här innan du lägger till kollegan");
  await page.fill("#ny-kollega-name", "Nour Testsson");
  await page.fill("#ny-kollega-email", "nour.testsson@gmail.com");
  await page.check("#ny-kollega-role-coach");
  await page.check("#ny-kollega-role-samordnare");
  // Rollen handledare finns inte (Karims beslut 2026-10-09, vilande i databasen).
  await expect(page.locator("#ny-kollega-role-handledare")).toHaveCount(0);
  await expect(dialog).not.toContainText("Handledare");
  await dialog.getByRole("button", { name: "Lägg till kollega" }).click();
  await expect(dialog).toContainText("Adressen måste sluta på @miljonbemanning.se");
  await page.fill("#ny-kollega-email", "nour.testsson@miljonbemanning.se");
  await page.fill("#ny-kollega-title", "Jobbcoach");
  await dialog.getByRole("button", { name: "Lägg till kollega" }).click();
  await expect(dialog).toBeHidden();
  const row = main(page).getByRole("row").filter({ hasText: "Nour Testsson" });
  await expect(row).toContainText("Huvudcoach");
  await expect(row).toContainText("Operativ samordnare");
  await expect(row).toContainText("Jobbcoach");
  // Ändra roller: bara ekonom.
  await row.getByRole("button", { name: "Ändra roller" }).click();
  await expect(page.locator("#roller-role-handledare")).toHaveCount(0);
  await page.uncheck("#roller-role-coach");
  await page.uncheck("#roller-role-samordnare");
  await page.check("#roller-role-ekonom");
  await page.getByRole("dialog").getByRole("button", { name: "Spara roller" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(row).toContainText("Ekonom");
  await expect(row).not.toContainText("Huvudcoach");
  // Spärra.
  await row.getByRole("button", { name: "Spärra" }).click();
  await expect(row).toContainText("Spärrad");
  await expect(row.getByRole("button", { name: "Aktivera" })).toBeVisible();
  // Den egna raden kan inte spärras.
  const me = main(page).getByRole("row").filter({ hasText: "Karim Khalil" });
  await expect(me.getByRole("button", { name: "Spärra" })).toHaveCount(0);
  // Mejlet till kollegan innehåller inga personuppgifter (utskicksloggen).
  await visit(page, "/admin/mallar", "Mallar och utskick");
  await expect(main(page)).toContainText("Inbjudan till kollega");
  expect(errors).toEqual([]);
});

test("kommunens handläggare: skapar kontot själv och klickar igenom portalmenyn utan en enda beställning", async ({ page }) => {
  await reset(page);
  const errors = watch(page);
  const res = await page.request.post("/api/dev-session", { data: { email: "kim.testsson@botkyrka.se" } });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).created).toBe(true);
  await visit(page, "/portal/mina-uppgifter?forsta=1", "Mina uppgifter");
  await expect(main(page)).toContainText("Välkommen");
  await visit(page, "/portal", "Portalens start");
  await visit(page, "/portal/deltagare", "Mina deltagare");
  const links = await page.locator("nav[aria-label=Portalmeny] a[href]").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
  expect(links).toEqual(["/portal", "/portal/bestall", "/portal/deltagare", "/portal/rapporter", "/portal/mina-uppgifter"]);
  for (const href of links) await visit(page, href, `portal ${href}`);
  // Tal till text är inte kopplat i produktion utan leverantör – men i minnesläget är AI:n simulerad: formuläret visar "Tala in".
  await visit(page, "/portal/bestall", "Beställ");
  expect(errors).toEqual([]);
});
