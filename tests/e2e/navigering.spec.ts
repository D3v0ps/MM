// Navigeringen (D0, omgång 1): sidbyten och flikbyten utan omladdning, utan att sidan hoppar och med Tillbaka som leder rätt.
// Samma test körs mot prototypen (hash-navigering) och appen (grunda history-anrop). Nätverkskontrollerna – inget
// serveranrop för sidan (RSC) och ingen ny hämtning av sessionen – gäller bara appen.
import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open } from "./helpers";

type Who = { userId: string; role: string };
const AMIRA: Who = { userId: "u-amira", role: "coach" };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const MARIA: Who = { userId: "k-maria", role: "kommun_handlaggare" };
const NADIA = "case-260143"; // BOT-26-0143, Amira
const TITLE = "Deltagarkort BOT-26-0143 – Miljonmatch";

const main = (page: Page) => page.locator("#main");
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
/** Sökväg + query som appen ser den (prototypen: efter #). */
const here = (page: Page, info: TestInfo) =>
  page.evaluate((demo) => (demo ? window.location.hash.slice(1) : window.location.pathname + window.location.search), isDemo(info));

/** Räknar serveranrop för sidan (RSC och dokument) och sessionshämtningar från och med nu. */
function watchServer(page: Page) {
  const seen = { rsc: 0, doc: 0, session: 0 };
  const on = (r: Request) => {
    const u = r.url();
    if (r.resourceType() === "document") seen.doc++;
    else if (r.headers()["rsc"] === "1" || u.includes("_rsc=")) seen.rsc++;
    else if (u.includes("/api/session")) seen.session++;
  };
  page.on("request", on);
  return {
    seen,
    stop: () => page.off("request", on),
  };
}

/** Lägg flikraden mitt på skärmen (som när man läst en bit ner i kortet). */
async function tabsMidScreen(page: Page) {
  await page.locator("#main [role=tablist]").first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 450));
  await page.waitForTimeout(100);
}

async function settle(page: Page, info: TestInfo) {
  if (!isDemo(info)) await loaded(page);
  await page.waitForTimeout(150);
}

// ------------------------------------------------------------ 1. Flikbyte utan hopp och utan serveranrop
test("flikbyte på deltagarkortet: sidan står kvar, adressen och titeln stämmer, inget serveranrop för sidan", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${NADIA}`, AMIRA);
  await expect(page).toHaveTitle(TITLE);
  // Det kompakta huvudet: flikraden syns utan att skrolla (900 px hög skärm).
  const top = await page.locator("#main [role=tablist]").first().evaluate((el) => el.getBoundingClientRect().top);
  expect(top, "flikraden syns utan att skrolla").toBeLessThan(800);
  await tabsMidScreen(page);
  const server = watchServer(page);
  for (const [name, flik] of [["Tidslinje", "tidslinje"], ["Närvaro", "narvaro"], ["Månadsunderlag", "manad"]] as const) {
    const y0 = await scrollY(page);
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
    await settle(page, info);
    expect(Math.abs((await scrollY(page)) - y0), `${name}: sidan hoppar inte`).toBeLessThanOrEqual(2);
    expect(await here(page, info)).toBe(`/arenden/${NADIA}?flik=${flik}`);
    await expect(page).toHaveTitle(TITLE);
  }
  // Tangentbordet: pil höger byter flik, fokus stannar på flikraden och sidan står kvar.
  const y1 = await scrollY(page);
  await tab(page, "Månadsunderlag").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Händelser")).toBeFocused();
  await settle(page, info);
  expect(Math.abs((await scrollY(page)) - y1)).toBeLessThanOrEqual(2);
  server.stop();
  if (!isDemo(info)) {
    expect(server.seen.rsc, "inget RSC-anrop för sidan").toBe(0);
    expect(server.seen.doc, "ingen omladdning").toBe(0);
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 2. Länk inne i kortet byter flik
test("länk i kortet ('Visa närvaro per vecka'): fliken byts, flikraden ligger överst och panelen börjar direkt under", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${NADIA}`, AMIRA);
  const link = page.getByRole("button", { name: "Visa närvaro per vecka" });
  await expect(link).toBeVisible();
  // Läs en bit ner i Översikt: flikraden har fastnat överst och länken ligger under den.
  await link.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 260));
  await page.waitForTimeout(100);
  const server = watchServer(page);
  await link.click();
  await expect(tab(page, "Närvaro")).toHaveAttribute("aria-selected", "true");
  await settle(page, info);
  expect(await here(page, info)).toBe(`/arenden/${NADIA}?flik=narvaro`);
  const pos = await page.evaluate(() => {
    const list = document.querySelector("#main [role=tablist]")!.getBoundingClientRect();
    const panel = document.getElementById("arende-panel")!.getBoundingClientRect();
    return { listTop: Math.round(list.top), listBottom: Math.round(list.bottom), panelTop: Math.round(panel.top), y: Math.round(window.scrollY) };
  });
  expect(pos.y, "sidan hoppar inte till toppen").toBeGreaterThan(0);
  expect(pos.listTop, "flikraden överst").toBeGreaterThanOrEqual(-1);
  expect(pos.listTop).toBeLessThanOrEqual(4);
  expect(Math.abs(pos.panelTop - pos.listBottom), "panelen börjar under flikraden").toBeLessThanOrEqual(6);
  await expect(main(page).getByRole("heading", { name: /Närvaro per ISO-vecka/i })).toBeVisible();
  server.stop();
  if (!isDemo(info)) expect(server.seen.rsc).toBe(0);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 3. Tillbaka efter flikbyte
test("Tillbaka efter flikbyte: tillbaka till listan med samma filter och samma skrollposition", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden", AMIRA);
  await page.selectOption("#arn-status", "active");
  await expect.poll(() => here(page, info)).toBe("/arenden?status=active");
  await page.evaluate(() => window.scrollTo(0, 320));
  const row = page.getByRole("table", { name: "Ärenden" }).locator("tbody tr").filter({ hasText: "BOT-26-0143" });
  // Raden i bild före mätningen (klicket skulle annars skrolla dit själv) – platsen man lämnar är den som ska återställas.
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const y0 = await scrollY(page);
  expect(y0).toBeGreaterThan(250);
  await row.click();
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}`);
  await settle(page, info);
  expect(await scrollY(page), "nytt kort börjar överst").toBe(0);
  await tab(page, "Tidslinje").click();
  await settle(page, info);
  await tab(page, "Närvaro").click();
  await settle(page, info);
  expect(await here(page, info)).toBe(`/arenden/${NADIA}?flik=narvaro`);
  // Flikbyten lägger inga egna historikposter: ett steg tillbaka leder till listan.
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe("/arenden?status=active");
  await settle(page, info);
  await expect(page.locator("#arn-status")).toHaveValue("active");
  await expect.poll(() => scrollY(page), { timeout: 4000 }).toBeGreaterThanOrEqual(y0 - 20);
  expect(Math.abs((await scrollY(page)) - y0), "skrollen är återställd").toBeLessThanOrEqual(20);
  // Framåt: kortet igen, på fliken Närvaro.
  await page.goForward();
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}?flik=narvaro`);
  await expect(tab(page, "Närvaro")).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 4. Sidbyte via sidopanelen
test("sidbyte i sidopanelen: samma meny, fokus på sidans rubrik, rätt titel och inget serveranrop för sidan", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden", SARA);
  await page.evaluate(() => {
    (window as unknown as { __aside: Element | null }).__aside = document.querySelector("aside");
  });
  const server = watchServer(page);
  for (const [name, title] of [["Rapporter", "Rapporter"], ["Ärenden", "Ärenden"], ["Rapporter", "Rapporter"]] as const) {
    await page.locator("aside nav").getByRole("link", { name: new RegExp(`^${name}`) }).first().click();
    await expect(main(page).locator("h1")).toContainText(title, { ignoreCase: true });
    await settle(page, info);
    await expect(page).toHaveTitle(`${title} – Miljonmatch`);
    await expect(main(page).locator("h1[data-page-title]")).toBeFocused();
    await expect(page.locator("#mm-route-status")).toHaveText(title);
    expect(await page.evaluate(() => (window as unknown as { __aside: Element | null }).__aside === document.querySelector("aside")), "menyn ritas inte om").toBe(true);
  }
  server.stop();
  if (!isDemo(info)) {
    expect(server.seen.rsc, "inget RSC-anrop").toBe(0);
    expect(server.seen.doc, "ingen omladdning").toBe(0);
    expect(server.seen.session, "sessionen hämtas inte igen").toBe(0);
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 5. Ordmärket
for (const [who, from, start] of [
  [AMIRA, "/rapporter", "/min-vecka"],
  [SARA, "/rapporter", "/start"],
  [MARIA, "/portal/deltagare", "/portal"],
] as const) {
  test(`ordmärket leder till startsidan (${who.role} → ${start})`, async ({ page }, info) => {
    const errors = await open(page, info, from, who);
    await page.getByRole("link", { name: /till startsidan/ }).first().click();
    await expect.poll(() => here(page, info)).toBe(start);
    await settle(page, info);
    await expect(main(page).locator("h1").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

// ------------------------------------------------------------ 6. Tidslinjens "Öppna"
test("tidslinjens Öppna visar raden i sin flik – Tillbaka leder tillbaka till tidslinjen", async ({ page }, info) => {
  const errors = await open(page, info, `/arenden/${NADIA}?flik=tidslinje`, AMIRA);
  await expect(main(page)).toContainText("Öppna visar raden i sin flik – med Tillbaka kommer du hit igen.");
  const open4 = page.getByRole("button", { name: /^Öppna: Vecka 4: närvarande/ }).first();
  await open4.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const y0 = await scrollY(page);
  await open4.click();
  await expect(tab(page, "Närvaro")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => here(page, info)).toMatch(new RegExp(`^/arenden/${NADIA}\\?flik=narvaro&mal=(att|act)%3A2027-W04$`));
  // Veckan är fokuserad, i bild och markerad.
  const target = page.locator('#arende-panel [data-mal="att:2027-W04"]').filter({ visible: true }).first();
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await expect(main(page)).toContainText("Du kom hit från tidslinjen.");
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe(`/arenden/${NADIA}?flik=tidslinje`);
  await expect(tab(page, "Tidslinje")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => scrollY(page), { timeout: 4000 }).toBeGreaterThanOrEqual(y0 - 20);
  expect(Math.abs((await scrollY(page)) - y0), "samma plats i tidslinjen").toBeLessThanOrEqual(20);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 7. Ctrl+klick (bara appen – prototypen är en enda fil i en ram)
test("ctrl+klick på en menylänk öppnar en ny flik och sidan står kvar", async ({ page, context }, info) => {
  test.skip(isDemo(info), "Ny flik prövas i appen.");
  const errors = await open(page, info, "/arenden", SARA);
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.locator("aside nav").getByRole("link", { name: /^Rapporter/ }).first().click({ modifiers: ["ControlOrMeta"] }),
  ]);
  await popup.waitForLoadState();
  expect(new URL(popup.url()).pathname).toBe("/rapporter");
  expect(new URL(page.url()).pathname).toBe("/arenden");
  await popup.close();
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 8. Omladdning och sedan Tillbaka
// Posterna från före omladdningen bär det gamla dokumentets interna Next-tillstånd. Appen laddar om på postens adress i
// stället för att låta Next visa fel sida (src/app/_shell/next-nav.tsx). Prototypen (hash) klarar sig utan.
test("omladdning och sedan Tillbaka två gånger: rätt sida, rubrik och titel i varje steg", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", AMIRA);
  const seen: { path: string; h1: string; title: string }[] = [];
  // Adressen medan sidan kanske laddas om (appen laddar om poster från före omladdningen).
  const at = () => here(page, info).catch(() => "");
  const record = async () => {
    await settle(page, info);
    seen.push({ path: await here(page, info), h1: ((await main(page).locator("h1").first().textContent()) ?? "").trim(), title: await page.title() });
  };
  await record();
  for (const name of ["Mina ärenden", "Rapporter"]) {
    await page.locator("aside nav").getByRole("link", { name: new RegExp(`^${name}`) }).first().click();
    await expect.poll(() => here(page, info)).not.toBe(seen[seen.length - 1].path);
    await record();
  }
  await page.reload();
  await settle(page, info);
  expect(await here(page, info)).toBe(seen[2].path);
  const server = watchServer(page);
  for (const i of [1, 0]) {
    await page.goBack();
    await expect.poll(at).toBe(seen[i].path);
    await settle(page, info);
    await expect(main(page).locator("h1").first(), `rubriken efter Tillbaka till ${seen[i].path}`).toHaveText(seen[i].h1);
    await expect(page, `titeln efter Tillbaka till ${seen[i].path}`).toHaveTitle(seen[i].title);
  }
  // Framåt igen: också poster från före omladdningen.
  await page.goForward();
  await expect.poll(at).toBe(seen[1].path);
  await settle(page, info);
  await expect(main(page).locator("h1").first()).toHaveText(seen[1].h1);
  await expect(page).toHaveTitle(seen[1].title);
  server.stop();
  if (!isDemo(info)) expect(server.seen.rsc, "Next hämtar inte sidan från servern (och visar då fel sida)").toBe(0);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 9. Tillbaka: fokus och uppläsning som vid ett sidbyte
test("Tillbaka till en annan sida: fokus på sidans rubrik och sidans titel uppläst", async ({ page }, info) => {
  const errors = await open(page, info, "/arenden", SARA);
  await page.locator("aside nav").getByRole("link", { name: /^Rapporter/ }).first().click();
  await expect.poll(() => here(page, info)).toBe("/rapporter");
  await settle(page, info);
  await page.goBack();
  await expect.poll(() => here(page, info)).toBe("/arenden");
  await settle(page, info);
  await expect(main(page).locator("h1[data-page-title]")).toBeFocused();
  await expect(page.locator("#mm-route-status")).toHaveText("Ärenden");
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 10. Fokus hamnar aldrig bakom de fasta raderna
/** Skift+tabb bakåt genom sidan: varje fokuserat element i #main ska ligga under de fasta raderna (toppraden, flikraden). */
async function shiftTabBelowSticky(page: Page, steps: number) {
  const hidden: string[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Shift+Tab");
    const r = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || !document.getElementById("main")?.contains(a) || a.closest("[role=tablist]")) return null;
      let bottom = 0;
      const bar = document.querySelector("aside");
      if (bar && getComputedStyle(bar).position === "sticky") bottom = Math.max(bottom, bar.getBoundingClientRect().bottom);
      const tabs = document.querySelector<HTMLElement>("[data-tabs-sticky]");
      // Flikraden räknas bara när den har fastnat överst (annars ligger den i sidans flöde).
      if (tabs) {
        const t = tabs.getBoundingClientRect();
        if (t.top <= bottom + 1) bottom = Math.max(bottom, t.bottom);
      }
      const e = a.getBoundingClientRect();
      // Panelen själv (tabbstopp) och annat som är högre än skärmen kan inte ligga helt i bild.
      if (a.getAttribute("role") === "tabpanel" || e.height > window.innerHeight - bottom) return null;
      return { what: `${a.tagName} '${(a.textContent ?? "").trim().slice(0, 40)}'`, top: Math.round(e.top), bottom: Math.round(e.bottom), sticky: Math.round(bottom) };
    });
    if (r && r.top < r.sticky - 1) hidden.push(`${r.what}: överkant ${r.top}, fasta radernas underkant ${r.sticky}`);
  }
  return hidden;
}

test("tangentbordet: fokus bakåt i deltagarkortets flik hamnar under den fasta flikraden (skrivbord)", async ({ page }, info) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const errors = await open(page, info, `/arenden/${NADIA}?flik=tidslinje`, AMIRA);
  await settle(page, info);
  // Sist i panelen, sedan bakåt.
  await page.locator("#arende-panel button, #arende-panel a[href]").last().focus();
  await page.waitForTimeout(100);
  expect(await shiftTabBelowSticky(page, 30)).toEqual([]);
  expect(errors).toEqual([]);
});

test("tangentbordet: fokus bakåt hamnar under toppraden och flikraden på mobil", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, info, `/arenden/${NADIA}?flik=tidslinje`, AMIRA);
  await settle(page, info);
  await page.locator("#arende-panel button, #arende-panel a[href]").last().focus();
  await page.waitForTimeout(100);
  expect(await shiftTabBelowSticky(page, 30)).toEqual([]);
  await open(page, info, "/min-vecka", AMIRA);
  await settle(page, info);
  await page.locator("#main a[href]").last().focus();
  await page.waitForTimeout(100);
  expect(await shiftTabBelowSticky(page, 40)).toEqual([]);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ 11. Byte av testperson (bara appens utvecklingsläge)
test("byte av testperson med osparad text: appen frågar först – Stanna kvar byter ingenting", async ({ page }, info) => {
  test.skip(isDemo(info), "Utvecklingslägets val av testperson finns bara i appen.");
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await page.locator("#ci-note").fill("Osparad anteckning");
  await page.selectOption("#dev-persona", "u-sara|samordnare");
  const ask = page.getByRole("dialog", { name: "Du har inte sparat" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Stanna kvar" }).click();
  await expect(ask).toHaveCount(0);
  // Ingenting är bytt: samma sida, samma text och samma inloggade person på servern.
  expect(new URL(page.url()).pathname).toBe(`/avstamning/${NADIA}`);
  await expect(page.locator("#ci-note")).toHaveValue("Osparad anteckning");
  await expect(page.locator("#dev-persona")).toHaveValue("u-amira|coach");
  const who = await page.evaluate(() => fetch("/api/session").then((r) => r.json() as Promise<{ persona?: { actor: { userId: string } } }>));
  expect(who.persona?.actor.userId).toBe("u-amira");
  // Lämna sidan: bytet görs och sidan laddas om – utan en andra varning från webbläsaren. Avstämningen gäller ett enskilt
  // ärende, så samordnaren hamnar på sin startsida.
  await page.selectOption("#dev-persona", "u-sara|samordnare");
  await page.getByRole("dialog", { name: "Du har inte sparat" }).getByRole("button", { name: "Lämna sidan" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/start");
  await loaded(page);
  await expect(page.locator("#dev-persona")).toHaveValue("u-sara|samordnare");
  expect(errors, "ingen beforeunload-varning efter svaret i appen").toEqual([]);
});

test("byte av testperson: på ett deltagarkort leder bytet till startsidan, på en lista stannar man", async ({ page }, info) => {
  test.skip(isDemo(info), "Utvecklingslägets val av testperson finns bara i appen.");
  const errors = await open(page, info, "/arenden/case-260145", AMIRA);
  await page.selectOption("#dev-persona", "u-petra|handledare");
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/handledare");
  await loaded(page);
  await expect(main(page)).not.toContainText("Åtkomst saknas");
  // En lista som den nya rollen får se: samma sida och samma val.
  await open(page, info, "/arenden?status=active", SARA);
  await page.selectOption("#dev-persona", "u-johan|avtalsansvarig");
  await expect.poll(() => page.locator("#dev-persona").inputValue(), { timeout: 15_000 }).toBe("u-johan|avtalsansvarig");
  await loaded(page);
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/arenden?status=active");
  await expect(page.locator("#arn-status")).toHaveValue("active");
  expect(errors).toEqual([]);
});
