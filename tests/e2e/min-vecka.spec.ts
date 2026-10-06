// Min vecka för alla MB-roller (beslut 2026-10-06): samma upplägg som coachens Min vecka, med rollens egna uppgifter. Varje
// roll börjar där, menyn har Min vardag och högst en rollflik, /start leder vidare och de gamla startsidorna finns kvar.
// Körs mot både prototypen och appen.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const JOHAN: Who = { userId: "u-johan", role: "avtalsansvarig" };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const PETRA: Who = { userId: "u-petra", role: "handledare" };
const KARIN: Who = { userId: "u-karin", role: "chef" };
const LARS: Who = { userId: "u-lars", role: "ekonom" };
const ROBIN: Who = { userId: "u-robin", role: "admin" };

const main = (page: Page) => page.locator("#main");
const menu = (page: Page) => page.getByRole("navigation", { name: "Meny" });
const here = (page: Page, info: TestInfo) =>
  page.evaluate((demo) => (demo ? window.location.hash.slice(1) : window.location.pathname + window.location.search), isDemo(info));

/** Byt testperson utan att nollställa testdatat och öppna sidan. */
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

/** Per roll: rutornas etiketter, ett avsnitt som ska finnas och menyns grupper. */
const ROLES: [Who, string[], string, string[]][] = [
  [SARA, ["Att hantera i inkorgen", "Första möten ej bokade", "Förfaller i dag", "Flaggor att kvittera"], "Flaggor (12)", ["Min vardag", "Samordning"]],
  [JOHAN, ["Att hantera i inkorgen", "Första möten ej bokade", "Förfaller i dag", "Flaggor att kvittera"], "Skyddade avrop", ["Min vardag", "Avtalet"]],
  [AMIRA, ["Närvaro att registrera", "Aktiviteter i dag", "AI-utkast att granska", "Månads­bedömningar januari"], "Påminnelser", ["Min vardag"]],
  [PETRA, ["Närvaro att registrera", "Tillfällen i dag", "Yrkesmoment den här veckan", "Praktik som saknar något av de fyra rätten"], "Kommande sju dagar", ["Min vardag"]],
  [KARIN, ["Flaggor att hantera", "Förfaller i dag", "Resultatgrad, rullande 6 mån", "Rapporter försenade"], "Tidig uppmärksamhet", ["Min vardag", "Ledning"]],
  [LARS, ["Januari att fakturera", "Stoppade fakturor", "Preskriptions­risk", "Senast i Fortnox"], "Uppgifter till dig", ["Min vardag", "Ekonomi"]],
  [ROBIN, ["Bakgrundsjobb", "Utskick som inte gick iväg", "Användare", "Avrop@ senast läst"], "Bakgrundsjobb", ["Min vardag", "Administratör"]],
];

/** Rutornas etiketter (första raden i varje klickbar ruta i nyckeltalsraden – knapp eller länk). */
const kpiLabels = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector("#main h1")?.closest("div.mx-auto")?.querySelector(":scope > div.grid");
    return [...(grid?.querySelectorAll(":scope > button > div:first-child, :scope > a > div:first-child") ?? [])].map((d) => (d.textContent ?? "").trim());
  });
/** Menyns grupprubriker (versala etiketter i sidopanelen). */
const groupLabels = (page: Page) => menu(page).locator(":scope > div > div:first-child").allInnerTexts();

test("Min vecka för varje MB-roll: rubrik, fyra rutor, rollens avsnitt och menyn med Min vardag och rollfliken", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = await open(page, info, "/min-vecka", SARA);
  for (const [who, kpis, section, groups] of ROLES) {
    await switchTo(page, info, "/min-vecka", who);
    await expect(main(page).getByRole("heading", { level: 1, name: "Min vecka" }), who.role).toBeVisible();
    await expect(main(page).getByRole("heading", { name: section }).first(), `${who.role}: ${section}`).toBeVisible();
    expect(await kpiLabels(page), who.role).toEqual(kpis);
    expect((await groupLabels(page)).map((g) => g.toUpperCase()), who.role).toEqual(groups.map((g) => g.toUpperCase()));
    await expect(menu(page).getByRole("link", { name: "Min vecka" }), who.role).toHaveAttribute("aria-current", "page");
    await expect(main(page)).not.toContainText("Den här sidan visas inte");
    await expect(main(page)).not.toContainText("Du har inte behörighet");
  }
  expect(errors).toEqual([]);
});

test("ordmärket leder till Min vecka för alla MB-roller", async ({ page }, info) => {
  const errors = await open(page, info, "/notiser", KARIN);
  for (const who of [KARIN, LARS, ROBIN, PETRA]) {
    await switchTo(page, info, "/notiser", who);
    await page.getByRole("link", { name: /till startsidan/ }).first().click();
    await expect.poll(() => here(page, info), who.role).toBe("/min-vecka");
  }
  expect(errors).toEqual([]);
});

test("/start leder vidare till Min vecka – valen i adressen följer med", async ({ page }, info) => {
  const errors = await open(page, info, "/start", SARA);
  await expect.poll(() => here(page, info)).toBe("/min-vecka");
  await expect(main(page).getByRole("heading", { level: 1, name: "Min vecka" })).toBeVisible();
  await expect(page).toHaveTitle("Min vecka – Miljonmatch");
  await switchTo(page, info, "/start?x=1", JOHAN);
  await expect.poll(() => here(page, info)).toBe("/min-vecka?x=1");
  await expect(main(page).getByRole("heading", { name: "Skyddade avrop" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("de gamla startsidorna finns kvar under rollens flik", async ({ page }, info) => {
  const errors = await open(page, info, "/handledare", PETRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Mina tilldelade ärenden" })).toBeVisible();
  await expect(main(page)).toContainText("Pågående (26)");
  for (const [who, to, title, item] of [
    [KARIN, "/ledning", "Ledningsvy", "Ledningsvy"],
    [LARS, "/ekonomi", "Fakturering", "Fakturering"],
    [ROBIN, "/admin/anvandare", "Användare och roller", "Användare och roller"],
  ] as const) {
    await switchTo(page, info, to, who);
    await expect(main(page).getByRole("heading", { level: 1, name: title }), to).toBeVisible();
    await expect(menu(page).getByRole("link", { name: item }), to).toHaveAttribute("aria-current", "page");
  }
  expect(errors).toEqual([]);
});

test("Min vecka leder vidare: rutorna, rubrikerna och knappen i sidhuvudet", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", KARIN);
  await main(page).getByRole("link", { name: "Öppna Ledningsvyn" }).click();
  await expect.poll(() => here(page, info)).toBe("/ledning");
  await switchTo(page, info, "/min-vecka", LARS);
  await main(page).getByRole("link", { name: "Öppna körningen januari" }).click();
  await expect.poll(() => here(page, info)).toBe("/ekonomi/2027-01");
  await switchTo(page, info, "/min-vecka", PETRA);
  await main(page).getByRole("link", { name: /Öppna listan/ }).click();
  await expect.poll(() => here(page, info)).toBe("/handledare");
  await switchTo(page, info, "/min-vecka", SARA);
  // Rutan "Första möten ej bokade" leder till avsnittet på sidan (fokus på rubriken).
  await main(page).getByRole("button", { name: /Första möten ej bokade/ }).click();
  await expect(page.locator("#mv-forsta-moten-rubrik")).toBeFocused();
  expect(errors).toEqual([]);
});

/** Knappar, text och klickytor på smal skärm: inget utanför korten, inga klippta knappar, klickytor minst 44 × 44 px. */
async function probe(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const out: string[] = [];
    for (const el of document.querySelectorAll("#main *")) {
      if (!vis(el) || el.closest(".overflow-x-auto, [role=tablist], svg, .sr-only")) continue;
      const b = el.getBoundingClientRect();
      const box = el.parentElement && el.parentElement.closest("section, [role=dialog]");
      const text = ((el as HTMLElement).innerText || "").slice(0, 30);
      if (box) {
        const cb = box.getBoundingClientRect();
        if (b.right > cb.right + 1.5 || b.left < cb.left - 1.5) out.push(`${el.tagName} "${text}" utanför kortet`);
      }
      if (el.matches("button, a[class*='min-h-11']") && el.scrollWidth > el.clientWidth + 1) out.push(`knapp "${text}" klipps`);
      if (el.matches("button, [role=tab], select, a[class*='min-h-11']") && (b.height < 43.5 || b.width < 43.5)) out.push(`klickyta "${text}" ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return [...new Set(out)];
  });
}

test("400 px: ingen sidledsrullning, inget utanför korten och klickytor minst 44 px", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 400, height: 860 });
  const errors = await open(page, info, "/min-vecka", SARA);
  for (const [who] of ROLES) {
    await switchTo(page, info, "/min-vecka", who);
    await expect(main(page).getByRole("heading", { level: 1, name: "Min vecka" })).toBeVisible();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), who.role).toBeLessThanOrEqual(1);
    const r = await probe(page);
    expect(r, `${who.role}: ${r.slice(0, 3).join("; ")}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("ett rött ämne: högst en röd ruta och ett rött kort, och ingen röd text", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = await open(page, info, "/min-vecka", SARA);
  for (const [who] of ROLES) {
    await switchTo(page, info, "/min-vecka", who);
    await expect(main(page).getByRole("heading", { level: 1, name: "Min vecka" })).toBeVisible();
    await page.waitForTimeout(150);
    const red = await page.evaluate(() => {
      const RED = "rgb(255, 12, 1)";
      const isRed = (el: Element) => getComputedStyle(el).borderLeftColor === RED && parseFloat(getComputedStyle(el).borderLeftWidth) >= 1;
      const grid = document.querySelector("#main h1")?.closest("div.mx-auto")?.querySelector(":scope > div.grid");
      const tiles = [...(grid?.querySelectorAll(":scope > button, :scope > a") ?? [])].filter(isRed).length;
      const cards = [...document.querySelectorAll("#main section")].filter(isRed).length;
      // Röd text: element med egen text (inte bara ikoner) i rött.
      const text = [...document.querySelectorAll("#main *")].filter(
        (el) => getComputedStyle(el).color === RED && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim()),
      ).length;
      return { tiles, cards, text };
    });
    expect(red.tiles, `${who.role}: röda rutor`).toBeLessThanOrEqual(1);
    expect(red.cards, `${who.role}: röda kort`).toBeLessThanOrEqual(1);
    expect(red.text, `${who.role}: röd text`).toBe(0);
  }
  expect(errors).toEqual([]);
});
