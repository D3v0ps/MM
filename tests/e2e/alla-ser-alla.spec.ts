// Alla coacher ser alla deltagare (Karims beslut 2026-11-11: "Alla ser alla"): Erik ser Amiras deltagare Nadia (BOT-26-0143) på
// Min vecka och i Närvaro, med huvudcoachen på raden, och registrerar hennes närvaro. Körs mot både prototypen och appen.
// Påhittade testdata.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { open } from "./helpers";

const ERIK = { userId: "u-erik", role: "coach" };
const main = (page: Page) => page.locator("#main");
const btn = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name, exact: typeof name === "string" });

test("coach B ser coach A:s deltagare på Min vecka och i Närvaro och registrerar närvaron", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", ERIK);
  // Min vecka: Nadias oregistrerade närvaro står med (hon är Amiras deltagare).
  await expect(main(page)).toContainText("Närvaro att registrera – vecka 4");
  await expect(main(page)).toContainText("Nadia Warsame");

  await open(page, info, "/narvaro", ERIK);
  const rows = page.getByTestId("narvaro-rad").filter({ hasText: "BOT-26-0143" });
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText("huvudcoach Amira");
  const before = await rows.count();
  await btn(rows.first(), "Närvarande").click();
  await expect(btn(rows.first(), "Närvarande")).toHaveAttribute("aria-pressed", "true");
  expect(before).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
