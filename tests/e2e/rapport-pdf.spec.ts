// PDF-nedladdning av rapporter (rapportarbetet steg 1) – samma test mot prototypen och appen.
// Miljonbemanning: en levererad månadsrapport laddas ned från rapportsidan. Kommunen: samma rapport från portalen.
// Filen fångas som en nedladdning: filnamnet saknar personuppgifter och innehållet är en PDF.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers";

const COACH = { userId: "u-amira", role: "coach" };
const HANDLAGGARE = { userId: "k-maria", role: "kommun_handlaggare" };
const NADIA_DEC = "rep-16008"; // Nadia Warsames månadsrapport för december 2026, levererad till Maria Ekdahl

async function downloadPdf(page: Page, opts: { keyboard?: boolean } = {}) {
  const button = page.locator("#main").getByRole("button", { name: "Ladda ner PDF", exact: true });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  const start = async () => {
    if (!opts.keyboard) return button.click();
    await button.focus();
    await page.keyboard.press("Enter");
  };
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), start()]);
  if (opts.keyboard) {
    // Fokus stannar på knappen medan PDF:en skapas och efteråt (knappen är aria-disabled, inte disabled).
    await expect(page.locator("#main").getByRole("button", { name: "Ladda ner PDF", exact: true })).toBeFocused();
  }
  const file = await download.path();
  const bytes = fs.readFileSync(file);
  return { name: download.suggestedFilename(), head: bytes.subarray(0, 5).toString("latin1"), size: bytes.length };
}

test("Miljonbemanning laddar ned en levererad månadsrapport som PDF", async ({ page }, info) => {
  const errors = await open(page, info, `/rapporter/${NADIA_DEC}`, COACH);
  await expect(page.locator("#main")).toContainText("Månadsrapport december 2026");
  await expect(page.locator("#main")).not.toContainText("PDF-nedladdning finns inte i prototypen");
  const pdf = await downloadPdf(page);
  expect(pdf.name).toBe("Manadsrapport_BOT-26-0143_2026-12_v1.pdf");
  expect(pdf.name).not.toMatch(/Nadia|Warsame/);
  expect(pdf.head).toBe("%PDF-");
  expect(pdf.size).toBeGreaterThan(5_000);
  expect(errors).toEqual([]);
});

test("kommunens handläggare laddar ned samma rapport från portalen", async ({ page }, info) => {
  const errors = await open(page, info, `/portal/rapporter/${NADIA_DEC}`, HANDLAGGARE);
  await expect(page.locator("#main")).toContainText("Månadsrapport december 2026");
  await expect(page.locator("#main")).not.toContainText("I prototypen visas bara förhandsvisningen");
  // Med tangentbordet, som en skärmläsaranvändare.
  const pdf = await downloadPdf(page, { keyboard: true });
  expect(pdf.name).toBe("Manadsrapport_BOT-26-0143_2026-12_v1.pdf");
  expect(pdf.head).toBe("%PDF-");
  expect(errors).toEqual([]);
});
