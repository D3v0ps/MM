// "Lämna synpunkt" finns bara för testare: i testmiljön (supabase-läget, app_settings.environment = staging) och i
// minnesläget när en testare simuleras (POST /api/dev-session med testerId – e2e och utveckling, beslut 2026-10-02 punkt 6).
// Vanliga användare, produktion och prototypen: knapparna syns aldrig och API:t (feedback.*) svarar 404. Dialogerna prövas
// här mot appen med den grunda navigeringen: sidan och rollen i synpunkten är den man står på, fokus och Esc, "Gå till
// sidan" utan omladdning. Komponenttestet src/features/synpunkter/panel.test.tsx prövar samma dialoger mot hanterarna i jsdom.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open } from "./helpers";

type Who = { userId: string; role: string };
const JOHAN: Who = { userId: "u-johan", role: "avtalsansvarig" };
const ROBIN: Who = { userId: "u-robin", role: "admin" };
const KARIM = "tester-karim";
const SARA = "tester-sara";

const bar = (page: Page) => page.getByRole("region", { name: "Testmiljö" });
const listDialog = (page: Page) => page.getByRole("dialog", { name: "Alla synpunkter" });
/** Konsolens "Failed to load resource" (nätverksfel som webbläsaren loggar själv) räknas inte som fel i appen. */
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

/** Appen: nytt testdata och en testare som agerar som testpersonen (kakan sätts före open, som behåller den). */
async function asTester(page: Page, info: TestInfo, to: string, who: Who, testerId: string) {
  expect((await page.request.post("/api/dev-session", { data: { ...who, testerId } })).ok()).toBeTruthy();
  return open(page, info, to);
}

/** Räknar dokumentladdningar (omladdningar) från och med nu. */
function watchDocs(page: Page) {
  const seen = { doc: 0 };
  const on = (r: { resourceType(): string }) => {
    if (r.resourceType() === "document") seen.doc++;
  };
  page.on("request", on);
  return { seen, stop: () => page.off("request", on) };
}

test("vanliga användare ser aldrig Lämna synpunkt, och synpunkterna finns inte utanför testmiljön", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/integrationer", { userId: "u-robin", role: "admin" });
  await expect(page.locator("#main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lämna synpunkt" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Alla synpunkter" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Testmiljö" })).toHaveCount(0);
  if (!isDemo(info)) {
    // 404 från hanterarens spärr för testare (code not_found) – inte unknown_key, som betyder att feedback.* inte är registrerat.
    const list = await page.request.post("/api/rpc", { data: { kind: "query", key: "feedback.list", input: {} } });
    expect(list.status()).toBe(404);
    expect(await list.json()).toMatchObject({ code: "not_found" });
    const submit = await page.request.post("/api/rpc", {
      data: { kind: "command", key: "feedback.submit", input: { type: "fel", priority: "bor", text: "Test", path: "/admin/integrationer", viewTitle: "Underbiträden" } },
    });
    expect(submit.status()).toBe(404);
    expect(await submit.json()).toMatchObject({ code: "not_found" });
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ Simulerad testare i minnesläget (bara appen)
test("simulerad testare: synpunkten får sidan man står på efter ett grunt byte, Esc ger fokus tillbaka, Gå till sidan laddar inte om", async ({ page }, info) => {
  test.skip(isDemo(info), "Prototypen har sin egen feedback i claude.ai – testaren finns bara i appens minnesläge.");
  // Karim (testare, ser allt) agerar som avtalsansvarig Johan och laddar in en rapport.
  const errors = await asTester(page, info, "/rapporter/rep-16107", JOHAN, KARIM);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText("Simulerad testare – påhittade testdata");
  const leave = bar(page).getByRole("button", { name: "Lämna synpunkt" });
  const all = bar(page).getByRole("button", { name: "Alla synpunkter" });
  await expect(leave).toBeVisible();
  await expect(all).toBeVisible();
  // Ingen "Agera som"-lista i minnesläget (testpersonen byts i utvecklingsfältet).
  await expect(bar(page).locator("#test-persona")).toHaveCount(0);

  // Grunt byte till Ärenden – ingen omladdning.
  const docs = watchDocs(page);
  await page.locator("aside nav").getByRole("link", { name: /^Ärenden/ }).first().click();
  await expect(page).toHaveURL(/\/arenden$/);
  await loaded(page);

  // Lämna synpunkt: rollen och sidan man står på nu (Ärenden), inte den man laddade in på. Fokus i textfältet.
  await leave.click();
  const dialog = page.getByRole("dialog", { name: "Lämna synpunkt" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Synpunkten sparas med")).toBeVisible();
  await expect(dialog).toContainText("Avtalsansvarig · Ärenden");
  await expect(dialog).not.toContainText("Rapport");
  await expect(page.locator("#syn-text")).toBeFocused();
  // Esc stänger och ger fokus tillbaka till knappen som öppnade dialogen.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(leave).toBeFocused();

  // Skriv och spara.
  await leave.click();
  await expect(page.locator("#syn-text")).toBeFocused();
  await page.locator("#syn-text").fill("Listan borde visa handläggarens namn direkt.");
  await dialog.getByRole("button", { name: "Spara synpunkt" }).click();
  await expect(dialog.getByText("Tack! Synpunkten är sparad.")).toBeVisible();
  // Sparad med sidan (bara sökvägen), sidans titel och rollen testaren agerade som.
  const saved = await (await page.request.post("/api/rpc", { data: { kind: "query", key: "feedback.list", input: {} } })).json();
  expect(saved.result).toHaveLength(1);
  expect(saved.result[0]).toMatchObject({ path: "/arenden", viewTitle: "Ärenden", role: "avtalsansvarig", mine: true, status: "ny" });

  // Visa alla synpunkter: listan i samma ögonblick, utan omladdning.
  await dialog.getByRole("button", { name: "Visa alla synpunkter" }).click();
  await expect(dialog).toHaveCount(0);
  const list = listDialog(page);
  await expect(list).toBeVisible();
  await expect(list).toContainText("Visar 1 av 1 synpunkter.");
  const card = list.locator("article").filter({ hasText: "Listan borde visa handläggarens namn direkt." });
  await expect(card).toContainText("Du · ");
  await expect(card).toContainText("Avtalsansvarig · Ärenden");
  await expect(list.getByRole("button", { name: "Ladda ner (CSV)" })).toBeEnabled();
  // Stäng med knappen i sidfoten (krysset heter också Stäng).
  await list.getByRole("button", { name: "Stäng", exact: true }).last().click();
  await expect(list).toHaveCount(0);

  // Från en annan sida: "Gå till sidan" leder grunt till Ärenden, och fokus hamnar på sidans rubrik (inte på knappen).
  await page.locator("aside nav").getByRole("link", { name: /^Rapporter/ }).first().click();
  await expect(page).toHaveURL(/\/rapporter$/);
  await loaded(page);
  await all.click();
  await expect(listDialog(page)).toBeVisible();
  await listDialog(page).locator("article").first().getByRole("button", { name: "Gå till sidan" }).click();
  await expect(listDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/arenden$/);
  await loaded(page);
  await expect(page.locator("#main h1[data-page-title]")).toBeFocused();
  await expect(page.locator("#main h1")).toContainText("Ärenden", { ignoreCase: true });
  docs.stop();
  expect(docs.seen.doc, "ingen omladdning").toBe(0);

  // Byt testperson i utvecklingsfältet till Karin (chef): sidan laddas om men Ärenden står kvar, och testaren är kvar.
  await page.selectOption("#dev-persona", "u-karin|chef");
  await expect.poll(() => page.locator("#dev-persona").inputValue(), { timeout: 15_000 }).toBe("u-karin|chef");
  await loaded(page);
  expect(new URL(page.url()).pathname).toBe("/arenden");
  await expect(bar(page)).toBeVisible();
  const docs2 = watchDocs(page);
  await bar(page).getByRole("button", { name: "Alla synpunkter" }).click();
  const list2 = listDialog(page);
  await expect(list2).toContainText("Visar 1 av 1 synpunkter.");
  const card2 = list2.locator("article").filter({ hasText: "Listan borde visa handläggarens namn direkt." });
  await expect(card2).toContainText("Avtalsansvarig · Ärenden");
  await expect(card2).toContainText("Du · ");
  await expect(card2.getByRole("button", { name: "Gå till sidan" })).toBeVisible();

  // Svara och ändra status – listan uppdateras utan omladdning.
  await card2.getByRole("button", { name: "Svar", exact: true }).click();
  await card2.getByLabel("Svara").fill("Vi tar det på genomgången.");
  await card2.getByRole("button", { name: "Svara", exact: true }).click();
  await expect(card2).toContainText("Vi tar det på genomgången.");
  await expect(card2.getByRole("button", { name: "Svar (1)" })).toBeVisible();
  await card2.locator("select[id^=st-]").selectOption("klar");
  await card2.getByRole("button", { name: "Spara status" }).click();
  await expect(list2).toContainText("Visar 0 av 1 synpunkter.");
  await list2.locator("#syn-f-status").selectOption("alla");
  await expect(list2).toContainText("Visar 1 av 1 synpunkter.");
  await expect(list2.locator("article").first().locator("select[id^=st-]")).toHaveValue("klar");
  docs2.stop();
  expect(docs2.seen.doc, "ingen omladdning vid svar och status").toBe(0);
  expect(relevant(errors)).toEqual([]);
});

test("begränsad testare: synpunkter som skrevs på avtalssidan visas inte i listan", async ({ page }, info) => {
  test.skip(isDemo(info), "Testaren finns bara i appens minnesläge.");
  // Karim (ser allt) som systemadministratör: en synpunkt på avtalssidan och en på användarsidan.
  const errors = await asTester(page, info, "/admin/anvandare", ROBIN, KARIM);
  const submit = (path: string, viewTitle: string, text: string) =>
    page.request.post("/api/rpc", { data: { kind: "command", key: "feedback.submit", input: { type: "fel", priority: "bor", text, path, viewTitle } } });
  expect((await submit("/admin/avtal?flik=priser", "Avtal och konfiguration", "Prislistan är svår att läsa.")).ok()).toBeTruthy();
  expect((await submit("/admin/anvandare", "Användare och roller", "Listan över användare saknar sökfält.")).ok()).toBeTruthy();
  await bar(page).getByRole("button", { name: "Alla synpunkter" }).click();
  await expect(listDialog(page)).toContainText("Visar 2 av 2 synpunkter.");
  await page.keyboard.press("Escape");
  await expect(listDialog(page)).toHaveCount(0);

  // Sara (begränsad testare) som samma testperson: avtalssidans synpunkt finns inte i listan.
  expect((await page.request.post("/api/dev-session", { data: { ...ROBIN, testerId: SARA } })).ok()).toBeTruthy();
  await page.goto("/admin/anvandare");
  await loaded(page);
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole("button", { name: "Alla synpunkter" }).click();
  const list = listDialog(page);
  await expect(list).toContainText("Visar 1 av 1 synpunkter.");
  await expect(list).toContainText("Listan över användare saknar sökfält.");
  await expect(list).not.toContainText("Prislistan");
  expect(relevant(errors)).toEqual([]);
});
