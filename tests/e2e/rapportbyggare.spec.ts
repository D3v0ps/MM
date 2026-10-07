// Rapportbyggaren (rapporter steg 4): Miljonbemanning bygger, sparar, delar (inom Miljonbemanning) och hämtar rapporter;
// resultatfilen för hela avtalet som avtalsansvarig lämnar till kommunen; roller utan behörighet når inte sidorna; revisionsloggen.
// Beslut 2026-10-07: kommunens chef finns inte – ingen delning med kommunen och inga sidor för delade rapporter i portalen.
// Samma test körs mot prototypen (projekt "demo") och appen (projekt "app"). Det som inte syns på skärmen (loggens detaljer,
// RLS, frysningen) testas i src/features/rapporter/builder-handlers.test.ts och rls-parity.test.ts.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { allowLeaveWarnings, isDemo, open, switchPersona } from "./helpers";

type As = { userId: string; role: string };
const SARA: As = { userId: "u-sara", role: "samordnare" };
const JOHAN: As = { userId: "u-johan", role: "avtalsansvarig" };
const MARIA: As = { userId: "k-maria", role: "kommun_handlaggare" };
const ROBIN: As = { userId: "u-robin", role: "admin" };
const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";

// ---------------------------------------------------------------- Hjälpare (som i kommun.spec.ts)
const main = (page: Page) => page.locator("#main");
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });
const link = (page: Page, name: string | RegExp) => page.getByRole("link", { name, exact: typeof name === "string" });
/** En knapp eller en länk som ser ut som en knapp (Button med `to`). */
const action = (page: Page, name: string) => main(page).getByRole("button", { name, exact: true }).or(main(page).getByRole("link", { name, exact: true }));

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
const currentPath = (page: Page, info: TestInfo) => {
  const u = new URL(page.url());
  return isDemo(info) ? decodeURIComponent(u.hash.replace(/^#/, "")) : u.pathname + u.search;
};
/** Ingen horisontell scroll i sidans innehåll på 400 px. */
async function noHScroll(page: Page, label: string) {
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(150);
  const over = await page.evaluate(() => {
    const m = document.querySelector("#main");
    return m ? Math.max(m.scrollWidth - m.clientWidth, m.getBoundingClientRect().right - window.innerWidth) : 0;
  });
  expect(over, `${label}: ingen horisontell scroll på 400 px`).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(60);
}
const section = (page: Page, title: string) => main(page).locator("section").filter({ has: page.getByRole("heading", { name: title }) });
/** CSV-texten: appen via nedladdningen (exakt en BOM), prototypen via textdialogen. */
async function csvFrom(page: Page, info: TestInfo, click: () => Promise<void>, filename: RegExp): Promise<string> {
  if (isDemo(info)) {
    await click();
    const area = page.locator("#text-dialog-area");
    await expect(area).toBeVisible();
    const csv = await area.inputValue();
    await page.getByRole("dialog").getByRole("button", { name: "Stäng" }).first().click();
    return csv;
  }
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  expect(dl.suggestedFilename()).toMatch(filename);
  const csv = fs.readFileSync((await dl.path())!, "utf8");
  expect(csv.charCodeAt(0), "exakt en BOM").toBe(0xfeff);
  expect(csv.charCodeAt(1)).not.toBe(0xfeff);
  return csv.slice(1);
}

// ================================================================ 1. Bygga, spara och hämta
test("1. samordnaren bygger en rapport från en mall, sparar den inom Miljonbemanning och hämtar Excel", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  await settle(page);
  const menu = page.getByRole("navigation", { name: "Meny" });
  await expect(menu.getByRole("link", { name: "Bygg rapport" })).toBeVisible();
  await menu.getByRole("link", { name: "Bygg rapport" }).click();
  await settle(page);
  // Ingen text om skyddade personuppgifter och ingen delning med kommunen (beslut 2026-10-07).
  await expect(main(page)).not.toContainText(/skyddade personuppgifter|Delade med kommunen/i);
  await expect(section(page, "Mina rapporter")).toContainText("Närvaro per månad");
  await expect(section(page, "Delade inom Miljonbemanning")).toContainText("Progression per avtalsområde");
  // Rapporten som var delad med kommunen är delad inom Miljonbemanning (migration 0026).
  await expect(section(page, "Delade inom Miljonbemanning")).toContainText("Resultatgrad per avtalsområde");
  await expect(section(page, "Färdiga rapporter")).toContainText("Resultatfil för hela avtalet");
  await noHScroll(page, "Rapportbyggaren");
  // Ny rapport från mallen "Närvaro per månad"
  await link(page, "Ny rapport").click();
  await settle(page);
  await expect(main(page).getByRole("heading", { name: "Vad vill du se?" })).toBeVisible();
  await page.getByLabel("Närvaro per månad", { exact: true }).check();
  await btn(page, "Nästa").click();
  await expect(main(page).getByRole("heading", { name: "Vilken period och vilka deltagare?" })).toBeVisible();
  await page.getByLabel("Välj månader", { exact: true }).check();
  await page.locator("#bygg-fran").selectOption("2026-10");
  await page.locator("#bygg-till").selectOption("2026-12");
  await btn(page, "Visa förhandsvisning").click();
  await expect(main(page)).toContainText("Förhandsvisning");
  const table = main(page).getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Deltagare" })).toBeVisible();
  await expect(table).toContainText("Totalt");
  await expect(table).toContainText("oktober 2026");
  await noHScroll(page, "Byggaren med förhandsvisning");
  await btn(page, "Nästa").click();
  await expect(main(page).getByRole("heading", { name: "Hur vill du se uppgifterna?" })).toBeVisible();
  await btn(page, "Nästa").click();
  await expect(main(page).getByRole("heading", { name: "Spara och hämta" })).toBeVisible();
  // Namnet kontrolleras: personnummer nekas
  await page.locator("#bygg-namn").fill("123456-7890");
  await btn(page, "Spara rapporten").click();
  await expect(main(page)).toContainText("Det ser ut som ett personnummer. Skriv inga namn, personnummer eller ärendenummer.");
  await page.locator("#bygg-namn").fill("Närvaro hösten");
  await page.getByLabel("Alla på Miljonbemanning i avtalet", { exact: true }).check();
  await btn(page, "Spara rapporten").click();
  await settle(page);
  await expect(main(page)).toContainText("Rapporten är sparad.");
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Närvaro hösten");
  await expect(main(page)).toContainText("Alla på Miljonbemanning i avtalet");
  // Adressen har bara id:n – inga namn. Kvittensen (?sparad=1) tas bort ur adressen när den visats (toast och ruta).
  await expect(page.getByRole("status").filter({ hasText: "Rapporten är sparad." }).first()).toBeAttached();
  await expect.poll(() => currentPath(page, info)).toMatch(/^\/rapportbyggare\/[a-z0-9-]+$/);
  await expect(main(page).getByRole("table")).toContainText("Totalt");
  const [xlsx] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), btn(page, "Hämta som Excel").click()]);
  expect(xlsx.suggestedFilename()).toBe("rapport_bot_narvaro-per-manad_2026-10_2026-12.xlsx");
  const file = fs.readFileSync((await xlsx.path())!);
  expect(file.subarray(0, 2).toString("latin1")).toBe("PK");
  const { readZip, entryText } = await import("../../src/core/export/read-zip.test-helper");
  const workbook = entryText(await readZip(new Uint8Array(file)), "xl/workbook.xml");
  expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Rapport", "Om rapporten"]);
  await expect(main(page)).toContainText("Filen är hämtad: rapport_bot_narvaro-per-manad_2026-10_2026-12.xlsx");
  await noHScroll(page, "Sparad rapport");
  const saved = (await currentPath(page, info)).replace(/\?.*$/, "");
  // "Gör en kopia" behåller definitionen: kopian börjar i steg 2 med den valda perioden (inte i steg 1 utan val).
  await action(page, "Gör en kopia").click();
  await settle(page);
  await expect(main(page).getByRole("heading", { name: "Vilken period och vilka deltagare?" })).toBeVisible();
  await expect(main(page)).toContainText("Kopia av Närvaro hösten");
  await expect(page.getByLabel("Välj månader", { exact: true })).toBeChecked();
  await expect(page.locator("#bygg-fran")).toHaveValue("2026-10");
  await expect(page.locator("#bygg-till")).toHaveValue("2026-12");
  // En ogiltig period stoppas i steg 2: felet står vid fältet och "Nästa" går inte att använda.
  await page.locator("#bygg-fran").selectOption("2027-01");
  await expect(main(page)).toContainText("Till-månaden kan inte vara före från-månaden.");
  await expect(btn(page, "Nästa")).toBeDisabled();
  await page.locator("#bygg-fran").selectOption("2026-10");
  await expect(btn(page, "Nästa")).toBeEnabled();
  // Avtalsansvarig (inte ägaren) ser inga redigeringsknappar på samordnarens rapport men kan dela och arkivera (Tillägg 2026-10-02).
  // Kopian sparas inte: sidan lämnas med ett osparat utkast, och webbläsaren varnar (som den ska).
  allowLeaveWarnings(page);
  await go(page, info, saved, JOHAN);
  await expect(main(page)).toContainText("Bara den som skapade rapporten kan ändra innehållet. Du kan dela, sluta dela eller arkivera den.");
  await expect(action(page, "Ändra rapporten")).toHaveCount(0);
  await expect(action(page, "Gör en kopia")).toBeVisible();
  await expect(action(page, "Dela med kommunen")).toHaveCount(0);
  await btn(page, "Arkivera rapporten").click();
  await expect(page.getByRole("dialog")).toContainText("Arkivera rapporten?");
  await page.getByRole("dialog").getByRole("button", { name: "Arkivera", exact: true }).click();
  await settle(page);
  await expect(main(page)).toContainText("Rapporten är arkiverad.");
  await go(page, info, "/rapportbyggare", SARA);
  await expect(section(page, "Mina rapporter")).not.toContainText("Närvaro hösten");
  expect(errors).toEqual([]);
});

// ================================================================ 2. Ingen delning med kommunen (beslut 2026-10-07)
test("2. avtalsansvarig kan inte dela med kommunen – bara inom Miljonbemanning", async ({ page }, info) => {
  const errors = await open(page, info, "/rapportbyggare", JOHAN);
  await settle(page);
  await link(page, "Resultatgrad per avtalsområde").first().click();
  await settle(page);
  await expect(main(page)).toContainText("Alla på Miljonbemanning i avtalet");
  await expect(btn(page, "Dela med kommunen")).toHaveCount(0);
  await expect(btn(page, "Sluta dela med kommunen")).toHaveCount(0);
  await expect(main(page)).not.toContainText("kommunens chef");
  // En ny rapport: bara "Bara jag" och "Alla på Miljonbemanning i avtalet" att välja.
  await go(page, info, "/rapportbyggare/ny?kopia=sr-seed-kommun", JOHAN);
  await expect(main(page).getByRole("heading", { name: "Vilken period och vilka deltagare?" })).toBeVisible();
  await btn(page, "Nästa").click();
  await expect(main(page).getByRole("heading", { name: "Hur vill du se uppgifterna?" })).toBeVisible();
  await btn(page, "Nästa").click();
  await expect(main(page).getByRole("heading", { name: "Spara och hämta" })).toBeVisible();
  await expect(page.getByLabel("Alla på Miljonbemanning i avtalet", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Kommunens chef/)).toHaveCount(0);
  // Kopian sparas inte: sidan lämnas med ett osparat utkast, och webbläsaren varnar (som den ska).
  allowLeaveWarnings(page);
  await go(page, info, "/rapportbyggare", SARA);
  expect(errors).toEqual([]);
});

// ================================================================ 3. Roller utan rapportbyggare
test("3. coach, ekonom och admin har ingen rapportbyggare; kommunens gamla sidor för delade rapporter leder till startsidan", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", { userId: "u-amira", role: "coach" });
  await settle(page);
  for (const as of [{ userId: "u-amira", role: "coach" }, { userId: "u-lars", role: "ekonom" }, ROBIN]) {
    await go(page, info, "/rapportbyggare", as);
    await expect(main(page), as.role).toContainText("Du har inte behörighet till den här sidan");
    await expect(page.getByRole("navigation", { name: "Meny" }).getByRole("link", { name: "Bygg rapport" })).toHaveCount(0);
  }
  for (const old of ["/portal/resultat", "/portal/resultat/rapporter", "/portal/resultat/rapporter/sr-seed-kommun"]) {
    await go(page, info, old, MARIA);
    await expect.poll(() => currentPath(page, info), { message: old }).toBe("/portal");
  }
  expect(errors).toEqual([]);
});

// ================================================================ 5. Resultatfil för hela avtalet och revisionsloggen
test("5. resultatfilen för hela avtalet (lämnas till kommunen av Miljonbemanning); admin ser loggposterna", async ({ page }, info) => {
  const errors = await open(page, info, "/rapportbyggare", SARA);
  await settle(page);
  await link(page, "Hämta resultatfilen").click();
  await settle(page);
  await expect(main(page)).toContainText("Resultatfilen för alla ärenden i avtalet. Avtalsansvarig lämnar den till kommunen utanför Miljonmatch.");
  await page.locator("#mb-res-from").selectOption("2026-10");
  await settle(page);
  await page.locator("#mb-res-to").selectOption("2026-12");
  await settle(page);
  await expect(main(page)).toContainText(/För perioden finns \d+ månadsrapporter för \d+ deltagare\./);
  const [xlsx] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), btn(page, "Hämta filen").click()]);
  expect(xlsx.suggestedFilename()).toBe("resultat_bot_hela-avtalet_2026-10_2026-12.xlsx");
  expect(fs.readFileSync((await xlsx.path())!).subarray(0, 2).toString("latin1")).toBe("PK");
  await noHScroll(page, "Resultatfil för hela avtalet");
  // En sparad rapport: visning och hämtning (CSV)
  await go(page, info, "/rapportbyggare/sr-seed-privat", SARA);
  await expect(main(page).getByRole("table")).toContainText("Totalt");
  await csvFrom(page, info, () => btn(page, "Hämta som CSV").click(), /^rapport_bot_narvaro-per-manad_\d{4}-\d{2}_\d{4}-\d{2}\.csv$/);
  // Avtalsansvarig arkiverar en delad rapport (kan inte göra den privat eller dela med kommunen)
  await go(page, info, "/rapportbyggare/sr-seed-kommun", JOHAN);
  await btn(page, "Arkivera rapporten").click();
  await page.getByRole("dialog").getByRole("button", { name: "Arkivera", exact: true }).click();
  await settle(page);
  await expect(main(page)).toContainText("Rapporten är arkiverad.");
  // Samma fil igen efteråt (kolumnspärren släpper igenom samma kolumner)
  await go(page, info, "/rapportbyggare/resultatfil?fran=2026-10&till=2026-12", JOHAN);
  const [again] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), btn(page, "Hämta filen").click()]);
  expect(again.suggestedFilename()).toBe("resultat_bot_hela-avtalet_2026-10_2026-12.xlsx");
  // Revisionsloggen
  await go(page, info, "/admin/logg", ROBIN);
  for (const t of ["Exporterade rapport", "Exporterade resultat för hela avtalet", "Arkiverade rapport", "Visade sparad rapport"]) await expect(main(page), t).toContainText(t);
  expect(errors).toEqual([]);
});
