// Interaktionstest för området notiser (/notiser, den gamla prototypens vy notiser i prototyp/src/05-notiser.js).
// Den gamla prototypen hade inget eget interaktionstest för notiser – stegen här kontrollerar dess beteende och behörighetsregeln:
// varje notis har exakt en mottagare, och coachen ser aldrig att ett ärende eskalerats till chefen.
import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers";

const main = (page: Page) => page.locator("#main");
const items = (page: Page) => main(page).locator("[data-notif-list] > *");
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

test("notiser: coachen ser tilldelningar och påminnelser men inga eskaleringar", async ({ page }, info) => {
  const errors = await open(page, info, "/notiser", { userId: "u-amira", role: "coach" });
  await expect(main(page).getByRole("heading", { name: /notiser/i })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Alla (8)" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Olästa (4)" })).toBeVisible();
  await expect(main(page)).toContainText("Så fungerar påminnelserna");
  await expect(main(page)).toContainText("Påminnelsen skickas måndag 08.00 för föregående vecka.");
  await expect(items(page)).toHaveCount(8);
  const t = await main(page).innerText();
  expect(t).not.toMatch(/eskaler/i);
  expect(t).not.toMatch(/Tidig uppmärksamhet/);
  await expect(main(page).getByRole("button", { name: "Eskalering" })).toHaveCount(0);
  await expect(main(page).getByRole("button", { name: "Tilldelning" })).toBeVisible();
  // Påminnelsen om BOT-26-0148 (tre veckor i rad) – samma text som den gamla prototypen
  const first = items(page).first();
  await expect(first).toContainText("Påminnelse: ingen progression 3 veckor i rad");
  await expect(first).toContainText("BOT-26-0148: Inget möte dokumenterat (v. 4 2027). Planera nästa steg och dokumentera i mötet.");
  // E-postens text innehåller bara ärendenumret – inga personuppgifter
  await first.getByRole("button", { name: "Visa e-postens text" }).click();
  await expect(first).toContainText(
    "E-post (utan personuppgifter): Påminnelse från Miljonmatch: ett av dina ärenden (BOT-26-0148) saknar dokumenterad progression. Logga in för att se vilket steg som behövs.",
  );
  expect(await first.innerText()).not.toMatch(/Yusuf|Abdi/);
  await expect(first.getByRole("button", { name: "Visa e-postens text" })).toHaveAttribute("aria-expanded", "true");

  // Filter
  await main(page).getByRole("button", { name: "Påminnelse" }).click();
  await expect(items(page)).toHaveCount(4);
  await main(page).getByRole("button", { name: "Tilldelning" }).click();
  await expect(items(page)).toHaveCount(4);
  await expect(items(page).first()).toContainText("Du är huvudcoach för BOT-27-0031 (Kök, restaurang och måltidsservice). Första möte 26 jan kl. 11.00.");
  await main(page).getByRole("button", { name: "Alla (8)" }).click();

  // Läst en i taget, sedan alla
  await items(page).first().getByRole("button", { name: "Läst" }).click();
  await expect(main(page).getByRole("button", { name: "Olästa (3)" })).toBeVisible();
  await main(page).getByRole("button", { name: "Markera alla som lästa" }).click();
  await expect(main(page).getByRole("button", { name: "Olästa (0)" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Markera alla som lästa" })).toHaveCount(0);
  await main(page).getByRole("button", { name: "Olästa (0)" }).click();
  await expect(main(page)).toContainText("Inga notiser");
  // Läsmarkeringarna finns kvar efter omladdning
  await page.reload();
  await expect(main(page).getByRole("button", { name: "Olästa (0)" })).toBeVisible();

  // Gör avstämning leder till avstämningen för ärendet
  await items(page).first().getByRole("link", { name: "Öppna mötet" }).click();
  await expect(page).toHaveURL(/\/avstamning\/case-260148/);
  expect(relevant(errors)).toEqual([]);
});

test("notiser: chefen ser eskaleringarna med coach och orsak per vecka", async ({ page }, info) => {
  const errors = await open(page, info, "/notiser", { userId: "u-karin", role: "chef" });
  await expect(main(page).getByRole("button", { name: "Alla (3)" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Olästa (3)" })).toBeVisible();
  await expect(main(page)).toContainText("Tidig uppmärksamhet");
  await expect(main(page)).toContainText("Coachen ser sina påminnelser men inte att ärendet har eskalerats");
  await expect(items(page)).toHaveCount(3);
  const first = items(page).first();
  await expect(first).toContainText("Eskalering: 3 veckor i rad utan progression");
  await expect(first).toContainText(
    "BOT-26-0148 · coach Amira Haddad · v. 2 2027: Veckomålet inte uppnått · v. 3 2027: Veckomålet inte uppnått · v. 4 2027: Inget möte dokumenterat.",
  );
  await first.getByRole("button", { name: "Visa e-postens text" }).click();
  await expect(first).toContainText("Eskalering i Miljonmatch: ett ärende (BOT-26-0148) har 3 veckor i rad utan progression. Logga in för att se detaljerna.");
  await expect(main(page)).toContainText("Eskalering: 2 veckor i rad utan progression");
  await expect(main(page)).toContainText("coach Leila Nouri");
  await expect(main(page)).toContainText("coach Mats Holm");
  await first.getByRole("link", { name: "Öppna ärendet" }).click();
  await expect(page).toHaveURL(/\/arenden\/case-260148/);
  expect(relevant(errors)).toEqual([]);
});

test("notiser: handledaren får inga eskaleringar och kommunen har ingen åtkomst", async ({ page }, info) => {
  const errors = await open(page, info, "/notiser", { userId: "u-petra", role: "handledare" });
  await expect(main(page).getByRole("heading", { name: /notiser/i })).toBeVisible();
  await expect(main(page).getByRole("button", { name: /^Alla \(\d+\)$/ })).toBeVisible();
  const t = await main(page).innerText();
  expect(t).not.toMatch(/eskaler/i);
  // Kommunen (bara handläggare sedan 2026-10-07) har inga notiser i appen.
  await open(page, info, "/notiser", { userId: "k-maria", role: "kommun_handlaggare" });
  // Inom sidans innehåll: Next.js har en egen role="alert" för att läsa upp sidbyten (__next-route-announcer__).
  await expect(main(page).getByRole("alert")).toContainText("Du har inte behörighet till den här sidan");
  expect(relevant(errors)).toEqual([]);
});
