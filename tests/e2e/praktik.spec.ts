// Interaktionstest för arbetsgivarregistret och praktikplatserna (/praktik – prototypens praktik.arbetsgivare).
// Port av stegen "praktik.arbetsgivare – register, fyra rätt och behörighet" i prototyp/tools/test-admin.mjs.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const PETRA: Who = { userId: "u-petra", role: "handledare" };
const main = (page: Page) => page.locator("#main");
const text = (page: Page) => main(page).evaluate((el) => (el.textContent ?? "").replace(/ /g, " "));
const relevant = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const btn = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).first();

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

test("praktik: registret och en ny arbetsgivare", async ({ page }, info) => {
  const errors = await open(page, info, "/praktik", SARA);
  // Utvecklingsfasen visas bara i prototypen – praktikregistret fungerar i appen och märks inte.
  if (isDemo(info)) await expect(main(page)).toContainText("Byggs i fas 3");
  else await expect(main(page)).toContainText("Arbetsgivare");
  const t = await text(page);
  if (!isDemo(info)) expect(t).not.toContain("Byggs i fas");
  expect(t).toMatch(/Arbetsgivare\s*12\s*i registret/);
  // Alla praktikplatser räknas sedan 2026-10-07 (testdatat har inga skyddade personuppgifter) – samma som den gamla prototypen.
  expect(t).toMatch(/Pågående praktik\s*32\s*158 praktikplatser totalt/);
  expect(t).toMatch(/Uppföljningar\s*27\s*de närmaste 7 dagarna/);
  expect(t).toMatch(/Alla fyra rätt\s*31 av 32/);
  await expect(main(page)).toContainText("Arbetsgivare (12)");
  await btn(page, "Lägg till arbetsgivare").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Lägg till", exact: true }).click();
  await expect(dialog).toContainText("Skriv företagets namn");
  await expect(dialog).toContainText("Välj minst ett avtalsområde.");
  await page.locator("#emp-name").fill("Botkyrka Bageri AB");
  await page.locator("#emp-org").fill("556777-1234");
  await page.locator("#emp-contact").fill("Lina Berg");
  await page.locator("#emp-email").fill("lina.berg@example.com");
  await page.locator("#emp-area-D").check();
  await page.locator("#emp-area-H").check();
  await dialog.getByRole("button", { name: "Lägg till", exact: true }).click();
  // Vyn visar den nya arbetsgivaren
  await expect(page).toHaveURL(/\/praktik\/emp-/);
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText("Botkyrka Bageri AB");
  await expect(main(page)).toContainText("556777-1234");
  await expect(main(page)).toContainText("D Kök, restaurang och måltidsservice");
  await expect(main(page)).toContainText("H Serviceyrken");
  await expect(main(page)).toContainText("Tillagd1 feb 2027 av Sara Lindqvist");
  await expect(main(page)).toContainText("Ingen pågående praktik");
  // Dubbletter stoppas (samma namn med andra versaler)
  await switchTo(page, info, "/praktik", SARA);
  await expect(main(page)).toContainText("Arbetsgivare (13)");
  await btn(page, "Lägg till arbetsgivare").click();
  await page.locator("#emp-name").fill("botkyrka bageri ab");
  await page.locator("#emp-area-D").check();
  await page.getByRole("dialog").getByRole("button", { name: "Lägg till", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Arbetsgivaren finns redan i registret (samma namn eller organisationsnummer).");
  expect(relevant(errors)).toEqual([]);
});

test("praktik: coachen ser namn bara i egna ärenden och bockar i de fyra rätten", async ({ page }, info) => {
  // Samordnaren ser alla namn hos arbetsgivaren – de som inte är coachens egna får inte synas för coachen
  const errors = await open(page, info, "/praktik/emp-1", SARA);
  await expect(main(page)).toContainText("Praktikplatser (13)");
  while (await page.getByRole("button", { name: /Visa fler/ }).count()) await btn(page, /Visa fler/).click();
  const allNames = await main(page).locator("section h2").allTextContents();
  await switchTo(page, info, "/praktik/emp-1", AMIRA);
  await expect(main(page)).toContainText("Praktikplatser i dina ärenden (3)");
  const t = await text(page);
  expect(t).toContain("Nadia Warsame");
  expect(t).toContain("Praktikplatser i andra team (10)");
  expect(t).toContain("Deltagare i ett annat team");
  const mine = (await main(page).locator("section h2").allTextContents()).map((x) => x.trim());
  const others = allNames.map((x) => x.trim()).filter((n) => n && !mine.includes(n) && !/^(Kontaktuppgifter|Praktikplatser)/i.test(n));
  expect(others.length).toBeGreaterThan(5);
  for (const n of others) expect(t.toLowerCase()).not.toContain(n.toLowerCase());
  expect(t).toContain("Rätt tidpunkt");
  expect(t).not.toContain("Rätt timing");

  const nadia = main(page).locator("section", { has: page.getByRole("heading", { name: "Nadia Warsame" }) }).last();
  await expect(nadia).toContainText("3 av 4 rätt");
  const upp = nadia.locator('input[id$="-uppfoljning"]');
  // Rutan visar det sparade värdet: i appen blir den ikryssad först när svaret från servern kommit (inte check(), som
  // kräver att den ändras direkt vid klicket).
  await upp.click();
  await expect(upp).toBeChecked();
  await expect(nadia).toContainText("De fyra rätten – 4 av 4 uppfyllda");
  const fu = nadia.locator('input[type="date"]');
  await fu.fill("2027-02-10");
  await nadia.getByRole("button", { name: "Lägg till uppföljning" }).click();
  await expect(nadia).toContainText("10 feb 2027 · planerad");
  await page.reload();
  await expect(main(page).locator("section", { has: page.getByRole("heading", { name: "Nadia Warsame" }) }).last().locator('input[id$="-uppfoljning"]')).toBeChecked();

  // Ändringarna loggas
  await switchTo(page, info, "/admin/logg", { userId: "u-robin", role: "admin" });
  await expect(main(page)).toContainText("Ändrade de fyra rätten");
  await expect(main(page)).toContainText("Rätt: rätt uppföljning · Värde: Ja");
  await expect(main(page)).toContainText("Lade till uppföljningsdatum");
  await expect(main(page)).toContainText("Datum: 10 feb 2027");
  expect(relevant(errors)).toEqual([]);
});

test("praktik: handledaren når registret och ser sina uppföljningar", async ({ page }, info) => {
  const errors = await open(page, info, "/praktik", PETRA);
  await expect(main(page)).toContainText("Arbetsgivare (");
  await expect(main(page)).toContainText("Dina uppföljningar de närmaste 7 dagarna");
  expect(await text(page)).toMatch(/Uppföljningar\s*8\s*i dina ärenden de närmaste 7 dagarna/);
  await switchTo(page, info, "/praktik", AMIRA);
  expect(await text(page)).toMatch(/Uppföljningar\s*4\s*i dina ärenden de närmaste 7 dagarna/);
  expect(relevant(errors)).toEqual([]);
});
