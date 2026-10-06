// Området inkorg: samordnarens och avtalsansvarigs Min vecka (/min-vecka – /start leder dit), avropsinkorgen (/inkorg/:emailId?)
// och förfaller (/forfaller).
// Port av alla steg i den gamla prototypens prototyp/tools/test-inkorg.mjs. Data läses via skärmen.
// Varje test börjar med nollställda testdata; steg som byggde på varandra i det gamla testet gör förarbetet själva
// (samma åtgärder i gränssnittet), och flödet i sin helhet körs i testet "hela flödet".
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, open, switchPersona } from "./helpers";

type Who = { userId: string; role: string };
const SARA: Who = { userId: "u-sara", role: "samordnare" };
const JOHAN: Who = { userId: "u-johan", role: "avtalsansvarig" };
const KARIN: Who = { userId: "u-karin", role: "chef" };
/** Kommunens handläggare som beställer i portalen (aktören i prototypens kommandologg). */
const MARIA = { userId: "k-maria", role: "kommun_handlaggare", contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" };

const PERSONA_KEY = "miljonmatch-prototyp-v2-persona";
const LOG_KEY = "miljonmatch-prototyp-v2-logg";

const main = (page: Page) => page.locator("#main");
const dialog = (page: Page) => page.getByRole("dialog");
const toastWith = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** Byt testperson och sida utan att nollställa det som gjorts (prototypen: kommandologgen spelas upp igen). */
async function goAs(page: Page, info: TestInfo, who: Who, to: string) {
  if (isDemo(info)) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [PERSONA_KEY, JSON.stringify(who)] as const);
    await page.goto(`http://proto.test/index.html#${to}`);
    await page.reload();
  } else {
    await switchPersona(page, who);
    await page.goto(to);
  }
}

/** Förarbete som en annan användare gör (t.ex. en beställning i portalen): körs via API:t som den användaren. */
async function commandAs(page: Page, info: TestInfo, actor: typeof MARIA, key: string, input: unknown, back: Who, to: string) {
  if (isDemo(info)) {
    await page.evaluate(([k, entry]) => {
      const log = JSON.parse(localStorage.getItem(k) ?? "[]");
      log.push(JSON.parse(entry));
      localStorage.setItem(k, JSON.stringify(log));
    }, [LOG_KEY, JSON.stringify({ key, input, actor })] as const);
  } else {
    await switchPersona(page, { userId: actor.userId, role: actor.role });
    const res = await page.request.post("/api/rpc", { data: { kind: "command", key, input } });
    expect(res.ok()).toBeTruthy();
  }
  await goAs(page, info, back, to);
}

// ---------------------------------------------------------------- Flöden i gränssnittet (används av flera tester)
/** em-101 (Word-mall): acceptera med Amira som huvudcoach och Petra i teamet. */
async function acceptEm101(page: Page) {
  const m = main(page);
  await m.getByRole("button", { name: "Acceptera", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(dialog(page).getByText("Välj huvudcoach.")).toBeVisible();
  await page.check("#ink-coach-u-amira");
  await page.check("#ink-team-u-petra");
  await dialog(page).getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(dialog(page).getByText("Amira Haddad har fått en notis om tilldelningen")).toBeVisible();
}

/** em-103: för in kompletteringen och acceptera avropet BOT-27-0049 med Leila. */
async function supplementAndAccept(page: Page) {
  const m = main(page);
  await expect(m.getByText(/Kopplad automatiskt till BOT-27-0049/)).toBeVisible();
  await m.getByRole("button", { name: "För in uppgifterna" }).click();
  await expect(toastWith(page, "Uppgifterna är införda i BOT-27-0049. Nu kan avropet accepteras.")).toBeVisible();
  await expect(m.getByText("Uppgifterna är införda")).toBeVisible();
  await m.getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(dialog(page).getByLabel("Beställarreferens")).toHaveValue("55102938");
  await page.check("#ink-coach-u-leila");
  await dialog(page).getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(dialog(page).getByText("Leila Nouri har fått en notis om tilldelningen")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Klart" }).click();
}

/** em-104 som avtalsansvarig: registrera efter telefonsamtal (skyddade personuppgifter). */
async function registerByPhone(page: Page) {
  const m = main(page);
  await m.getByRole("button", { name: "Registrera efter telefonsamtal" }).click();
  await dialog(page).getByRole("button", { name: "Registrera ärendet" }).click();
  await expect(dialog(page).getByText("Skriv förnamnet.")).toBeVisible();
  await page.fill("#ink-p-first", "Samir");
  await page.fill("#ink-p-last", "Lindqvist-Test");
  await page.fill("#ink-p-pnr", "19880412-1234");
  await page.selectOption("#ink-p-area", "G");
  await page.fill("#ink-p-weeks", "8");
  await page.check("#ink-p-confirm");
  await dialog(page).getByRole("button", { name: "Registrera ärendet" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toastWith(page, "BOT-27-0051 är registrerat med skyddade personuppgifter. Acceptera och tilldela en namngiven coach.")).toBeVisible();
}

/** Acceptera det skyddade ärendet med Sofia – ingen kallelse till deltagaren. */
async function acceptProtected(page: Page) {
  const m = main(page);
  await m.getByRole("button", { name: "Acceptera", exact: true }).click();
  await expect(dialog(page).getByText("Deltagaren får ingen kallelse via SMS eller e-post", { exact: false })).toBeVisible();
  await page.check("#ink-coach-u-sofia");
  await dialog(page).getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(dialog(page).getByText("Sofia Grahn har fått en notis om tilldelningen")).toBeVisible();
  await expect(dialog(page).getByText("ingen kallelse via SMS eller e-post (skyddade personuppgifter)", { exact: false })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Klart" }).click();
}

/** em-105 (Övrigt): svara med säkert meddelande och markera som hanterat. */
async function answerOther(page: Page) {
  const m = main(page);
  await expect(m.getByText("Klassat som Övrigt – inte en beställning")).toBeVisible();
  await m.getByRole("button", { name: "Svara med säkert meddelande" }).click();
  await expect(m.getByText(/Svar skickat .* som säkert meddelande/)).toBeVisible();
  await m.getByRole("button", { name: "Markera som hanterad" }).click();
  await expect(m.getByText(/^Hanterad av Sara Lindqvist i dag kl\. \d\d\.\d\d$/)).toBeVisible();
}

/** em-106: avböj kräver orsak (och beskrivning vid Annat skäl). */
async function declineEm106(page: Page, total = 231) {
  const m = main(page);
  await m.getByRole("button", { name: "Avböj", exact: true }).click();
  await expect(dialog(page).getByText(/rangordning/)).toBeVisible();
  await expect(dialog(page).getByText(`Hittills i avtalet: 0 av ${total} avrop avböjda.`, { exact: false })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Avböj avropet" }).click();
  await expect(dialog(page).getByText("Välj en orsak.")).toBeVisible();
  await page.selectOption("#ink-decline-reason", "Annat skäl");
  await dialog(page).getByRole("button", { name: "Avböj avropet" }).click();
  await expect(dialog(page).getByText("Beskriv orsaken.")).toBeVisible();
  await page.fill("#ink-decline-text", "Deltagaren behöver en insats på annat språk än vi kan erbjuda.");
  await dialog(page).getByRole("button", { name: "Avböj avropet" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toastWith(page, "BOT-27-0048 är avböjt. Kommunen har fått besked.")).toBeVisible();
  await expect(m.getByText("Avropet är avböjt")).toBeVisible();
  await expect(m.getByText("Annat skäl: Deltagaren behöver en insats på annat språk än vi kan erbjuda.")).toBeVisible();
}

// ---------------------------------------------------------------- Förfaller
test("förfaller: grupper, filter per typ och sammanslagna månadsrapporter", async ({ page }, info) => {
  const errors = await open(page, info, "/forfaller", KARIN);
  const m = main(page);
  for (const t of ["Försenat (1)", "I dag (5)", "Denna vecka (90)"]) await expect(m.getByRole("heading", { name: t })).toBeVisible();
  await expect(m.getByText("Ej fastställd med Botkyrka").first()).toBeVisible();
  await expect(m.getByText("81 ärenden")).toBeVisible();
  await expect(m.getByText("Leila Nouri 20 · Erik Sjöberg 17 · Sofia Grahn 16 · Mats Holm 14 · Amira Haddad 14")).toBeVisible();
  await expect(m.getByRole("button", { name: "Alla (96)" })).toBeVisible();
  await m.getByRole("button", { name: /^Svar på avrop \(3\)/ }).click();
  await expect(m).not.toContainText("Månadsrapport januari");
  await expect(m.locator("tbody tr").filter({ hasText: "Svar på avrop" })).toHaveCount(3);
  await expect(m).toContainText(/Samordnare(\s|\S)*Chef/);
  // Chefen kan inte öppna inkorgen – ingen knapp för avropen.
  await expect(m.locator("tbody tr").filter({ hasText: "Svar på avrop" }).getByRole("link", { name: "Öppna" })).toHaveCount(0);
  await m.getByRole("button", { name: /^Alla \(/ }).click();
  await expect(m.locator("tbody tr").first()).toContainText("Försenad 2 dagar");
  await expect(m.locator("tbody tr").first()).toContainText("Chef (eskalerat)");
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Min vecka (samordnarens och avtalsansvarigs startsida)
test("inkorgens antal: menyn, rutan Att hantera, fliken och startsidan visar samma tal", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg", SARA);
  const m = main(page);
  const n = "6"; // prototypens MM.sel.inboxToHandle().length vid demostart
  await expect(page.getByRole("navigation", { name: "Meny" }).getByRole("link", { name: /Avropsinkorg/ })).toContainText(n);
  await expect(m.locator("[data-summary-total]")).toHaveText(n);
  await expect(m.getByRole("tab", { name: /Att hantera/ })).toContainText(n);
  const parts = await m.locator("[data-summary-part]").allInnerTexts();
  expect(parts.map(Number).reduce((a, b) => a + b, 0)).toBe(Number(n));
  expect(parts).toEqual(["3", "1", "1", "1"]);
  await goAs(page, info, SARA, "/min-vecka");
  await expect(m.locator("[data-inkorg-tile]").first()).toContainText(new RegExp(`Att hantera i inkorgen\\s*${n}(?!\\d)`, "i"));
  expect(errors).toEqual([]);
});

test("startsidan: SLA-märket överlappar inte rubriken (1280 och 1024 px), status med text i rutor", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  for (const [who, w] of [[SARA, 1280], [JOHAN, 1280], [SARA, 1024]] as const) {
    await page.setViewportSize({ width: w, height: 900 });
    await goAs(page, info, who, "/min-vecka");
    await expect(main(page).getByRole("heading", { level: 1, name: "Min vecka" })).toBeVisible();
    await expect(main(page).locator("[data-mini-row]").first()).toBeVisible();
    const over = await page.evaluate(() =>
      [...document.querySelectorAll("[data-mini-row]")].map((r) => {
        const l = r.querySelector("[data-mini-left]");
        const m = r.querySelector("[data-mini-main]");
        if (!l || !m) return null;
        const a = (l.firstElementChild ?? l).getBoundingClientRect();
        const b = m.getBoundingClientRect();
        return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1 ? `${(l as HTMLElement).innerText.trim()} / ${(m as HTMLElement).innerText.split("\n")[0]}` : null;
      }).filter(Boolean));
    expect(over, `${who.role} ${w}: överlapp`).toEqual([]);
    const noState = await page.evaluate(() => [...document.querySelectorAll("#main [data-inkorg-tile][data-tone]")].filter((k) => !k.querySelector("[data-tile-state]")).length);
    expect(noState, "Rutor med röd/mörk ram ska ha statustext med ikon").toBe(0);
    if (isDemo(info)) {
      const inside = await page.evaluate(() => {
        const b = [...document.querySelectorAll("#main button")].find((x) => /notiser/.test((x as HTMLElement).innerText) && x.closest("section"));
        const c = b?.closest("section");
        return !!b && !!c && Math.round(b.getBoundingClientRect().right) <= Math.round(c.getBoundingClientRect().right);
      });
      expect(inside, "Knappen till coachens notiser ska ligga inom kortet").toBe(true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(main(page)).not.toContainText(/deadline/i);
  expect(errors).toEqual([]);
});

test("startsidan (avtalsansvarig): uppgiften om det skyddade avropet ligger hos avtalsansvarig", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", JOHAN);
  const m = main(page);
  await expect(m.getByRole("heading", { name: "Öppna uppgifter (1)" })).toBeVisible();
  await expect(m.getByText("Avrop med skyddade personuppgifter från Omar Farah", { exact: false }).first()).toBeVisible();
  await expect(m.getByText("Skapad automatiskt", { exact: false }).first()).toBeVisible();
  await expect(m.getByRole("heading", { name: "Skyddade avrop" })).toBeVisible();
  await expect(m.getByText("Omar Farah · i dag kl. 07.55 · väntar på telefonsamtal")).toBeVisible();
  await expect(m.getByText("3 varningar kan leda till uppsägning.", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test("startsidan: översikt, kvittera flagga med åtgärdsplan", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  const m = main(page);
  for (const t of ["Att hantera i inkorgen", "Första möten ej bokade", "Förfaller i dag", "Flaggor att kvittera", "Avrop besvarade inom en arbetsdag", "Första möte inom en vecka", "Tilldelning ger notis", "Öppna uppgifter (0)", "hanteras av avtalsansvarig"]) {
    await expect(m.getByText(t, { exact: false }).first()).toBeVisible();
  }
  await expect(m.getByRole("heading", { name: "Flaggor (12)" })).toBeVisible();
  await m.getByRole("button", { name: "Kvittera", exact: true }).first().click();
  await dialog(page).getByRole("button", { name: "Kvittera", exact: true }).click();
  await expect(dialog(page).getByText("Skriv en kort åtgärdsplan")).toBeVisible();
  await page.fill("#ink-ack-plan", "Sara ringer handläggaren i dag före kl. 12 enligt den säkra rutinen.");
  await dialog(page).getByRole("button", { name: "Kvittera", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toastWith(page, "Flaggan är kvitterad. Åtgärdsplanen är sparad i revisionsloggen.")).toBeVisible();
  await expect(m.getByRole("heading", { name: "Flaggor (11)" })).toBeVisible();
  await m.getByRole("button", { name: "Visa kvitterade (1)" }).click();
  await expect(m.getByText(/Kvitterad av Sara Lindqvist i dag kl\. \d\d\.\d\d\. Åtgärd: Sara ringer handläggaren/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("startsidan: boka första möte för ärende utan bokat möte", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  const m = main(page);
  await expect(m.getByRole("link", { name: "BOT-27-0039" })).toBeVisible();
  await m.getByRole("button", { name: "Boka", exact: true }).first().click();
  await expect(dialog(page).getByText("Huvudcoach: Sofia Grahn. Mötet ska vara bokat senast tisdag 2 februari (inom en vecka från avropet).")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Boka mötet" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toastWith(page, "Första mötet för BOT-27-0039 är bokat tisdag 2 februari kl. 10.00. Kallelse skickad.")).toBeVisible();
  await expect(m.getByText("Alla första möten är bokade")).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Inkorgen: Word-mall (em-101) → acceptera
test("em-101: acceptera med coach och team → orderbekräftelse och notis till coachen", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-101", SARA);
  const m = main(page);
  await expect(m.getByText("Originalmejlet")).toBeVisible();
  await expect(m.getByText("Tolkat formulär")).toBeVisible();
  await expect(m.getByText("Ordererkännande", { exact: true }).first()).toBeVisible();
  await expect(m.getByText("Dubblettkontroll")).toBeVisible();
  if (isDemo(info)) await expect(m.getByRole("button", { name: "Se vad kommunen fick" }).first()).toBeVisible();
  await acceptEm101(page);
  const d = dialog(page);
  await expect(toastWith(page, "BOT-27-0050 är accepterat. Orderbekräftelsen är skickad till kommunen.")).toBeVisible();
  await expect(d.getByText("Deltagaren fick kallelse via e-post, sin föredragna kontaktväg", { exact: false })).toBeVisible();
  await expect(d.getByText("Även Petra Ek har fått en notis.", { exact: false })).toBeVisible();
  await expect(d.getByText("Petra Ek (yrkesspecifik handledare)")).toBeVisible();
  await expect(d.getByText("Amira Haddad", { exact: true })).toBeVisible();
  // Orderbekräftelsen till kommunen innehåller bara ärendenumret – inga personuppgifter.
  const custMail = d.getByText("Kommunen fick:").locator("..");
  await expect(custMail).toContainText("Orderbekräftelse för ärende BOT-27-0050 finns i portalen – logga in för att läsa.");
  await d.getByRole("button", { name: "Klart" }).click();
  await expect(m.getByText("Orderbekräftelse skickad")).toBeVisible();
  await expect(m.getByText("Accepterad", { exact: true }).first()).toBeVisible();
  await expect(m.getByRole("tab", { name: /Att hantera/ })).toContainText("5");
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Fritext (em-102)
test("em-102: acceptera stoppas – felet syns direkt (överst, toast, fokus i fältet)", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-102", SARA);
  const m = main(page);
  await expect(m.getByText("Tolkat med AI")).toBeVisible();
  await expect(m.getByText(/Osäker \d+/).first()).toBeVisible();
  if (isDemo(info)) await expect(m.getByRole("button", { name: /Se vad kommunen fick \(kommunens chef\)/ })).toBeVisible();
  await m.getByRole("button", { name: "Acceptera", exact: true }).click();
  const d = dialog(page);
  await expect(d.getByText("Beställarreferens saknas – avropet kan inte bekräftas").first()).toBeVisible(); // överst redan när dialogen öppnas
  await page.check("#ink-coach-u-erik");
  await d.getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(toastWith(page, "Beställarreferens saknas").first()).toBeVisible();
  await expect(page.locator("#ink-ref")).toHaveAttribute("aria-invalid", "true");
  await expect(d.getByText(/Beställarreferens saknas\. Kommunen har inte angett någon/).first()).toBeVisible();
  await expect(page.locator("#ink-ref")).toBeFocused();
  await expect(page.locator("#ink-ref")).toBeInViewport();
  await expect(d.getByText("Det finns en komplettering att föra in först")).toBeVisible();
  await d.getByRole("button", { name: "Avbryt" }).click();
  await expect(m.getByText("Väntar på beslut", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("em-102: rätta planerad omfattning – loggas som rättad, övrigt som kontrollerat", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-102", SARA);
  const m = main(page);
  await m.getByRole("button", { name: "Rätta uppgifter" }).click();
  await page.fill("#ink-c-weeks", "8");
  await dialog(page).getByRole("button", { name: /Spara och markera/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toastWith(page, "Rättat: planerad omfattning. Ändringen är loggad.")).toBeVisible();
  await expect(m.getByText("Rättad", { exact: true }).first()).toBeVisible();
  await expect(m.getByText("Kontrollerad", { exact: true }).first()).toBeVisible();
  await expect(m.getByText("8 veckor")).toBeVisible();
  // Planerad omfattning är rättad (ärendet och beställningens värde), avtalsområdet bara kontrollerat.
  await m.getByRole("button", { name: "Acceptera", exact: true }).click();
  await expect(page.locator("#ink-weeks")).toHaveValue("8");
  await dialog(page).getByRole("button", { name: "Avbryt" }).click();
  expect(errors).toEqual([]);
});

test("em-103: för in kompletteringen och acceptera", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-103", SARA);
  await supplementAndAccept(page);
  const m = main(page);
  await expect(m.getByText("Nu kan avropet accepteras.")).toHaveCount(0);
  await m.getByRole("button", { name: "Visa avropet" }).click();
  await expect(m.getByRole("heading", { name: "Ny deltagare till er – kök" })).toBeVisible();
  await expect(m.getByText("Accepterad", { exact: true }).first()).toBeVisible();
  await expect(m.getByText("Orderbekräftelse skickad")).toBeVisible();
  await expect(m.getByText("Från komplettering").first()).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Skyddade personuppgifter (em-104)
test("em-104 som samordnare: ingen registrering – förklaring och perspektivbyte till avtalsansvarig", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-104", SARA);
  const m = main(page);
  await expect(m.getByText("Avtalsansvarig hanterar skyddade avrop enligt den säkra rutinen").first()).toBeVisible();
  await expect(m.getByRole("button", { name: "Registrera efter telefonsamtal" })).toHaveCount(0);
  await expect(m.getByRole("button", { name: "Acceptera", exact: true })).toHaveCount(0);
  if (isDemo(info)) {
    await m.getByRole("button", { name: "Se avtalsansvarigs vy" }).click();
    await expect(page.getByLabel("Roll", { exact: true })).toHaveValue("avtalsansvarig");
    await expect(m.getByRole("button", { name: "Registrera efter telefonsamtal" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("em-104: registrera efter telefonsamtal och acceptera – ingen kallelse till deltagaren", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-104", JOHAN);
  const m = main(page);
  await expect(m.getByText("Skyddade personuppgifter – ingen automatik")).toBeVisible();
  await expect(m.getByText("Generisk mottagningsbekräftelse", { exact: true })).toBeVisible();
  await registerByPhone(page);
  // Mejlet är kopplat, SLA räknas från mejlets mottagning och den säkra rutinen visar vem som registrerade.
  await expect(m.getByText("Väntar på beslut", { exact: true }).first()).toBeVisible();
  await expect(m.getByText(/Klart – registrerat i dag kl\. \d\d\.\d\d av Johan Berg/)).toBeVisible();
  await expect(m.getByText("Registrerat efter samtalet")).toBeVisible();
  await expect(m.getByText("Ja – bara namn och personnummer sparas")).toBeVisible();
  await expect(m.getByText("Svar på avropet", { exact: true })).toBeVisible();
  await expect(m.getByText("Senast 2 feb kl. 07.55").first()).toBeVisible();
  await acceptProtected(page);
  await expect(m.getByText("Orderbekräftelse skickad")).toBeVisible();
  await expect(m.getByText("Deltagaren:", { exact: true }).locator("..")).toContainText("ingen kallelse via SMS eller e-post (skyddade personuppgifter)");
  // Uppgiften och flaggan till avtalsansvarig är stängda.
  await goAs(page, info, JOHAN, "/min-vecka");
  await expect(m.getByRole("heading", { name: "Öppna uppgifter (0)" })).toBeVisible();
  await expect(m.getByText("Avrop med skyddade personuppgifter", { exact: true })).toHaveCount(0);
  // Samordnaren ser bara ärendenumret och "Skyddade personuppgifter".
  await goAs(page, info, SARA, "/inkorg/em-104");
  await expect(m.getByText("Skyddade personuppgifter", { exact: false }).first()).toBeVisible();
  await expect(m.getByText("Orderbekräftelse skickad")).toBeVisible();
  const txt = await m.innerText();
  expect(txt.includes("Lindqvist-Test") || txt.includes("Samir"), "Samordnaren får inte se namnet").toBe(false);
  await expect(m.getByRole("button", { name: "Registrera efter telefonsamtal" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Övrigt (em-105)
test("em-105: svara med säkert meddelande och markera som hanterad", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-105", SARA);
  await expect(page.locator("#ink-reply")).toHaveValue(/^Hej Maria!\n\nTack för ditt mejl om BOT-26-0143\. Den här veckan \(v\. 5\) är deltagaren schemalagd måndag, onsdag och torsdag\./);
  await answerOther(page);
  const m = main(page);
  await expect(toastWith(page, "Mejlet är markerat som hanterat.")).toBeVisible();
  // Kommunen får ett mejl utan innehåll och utan personuppgifter.
  const mail = m.getByText("Kommunen fick ett mejl utan innehåll:").locator("..");
  await expect(mail).toContainText("Du har ett nytt meddelande om ärende BOT-26-0143 – logga in för att läsa.");
  await expect(mail).not.toContainText(/Nadia|Warsame/);
  await expect(m.getByText("Hanterad", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Avböj (em-106)
test("em-106: avböj kräver orsak", async ({ page }, info) => {
  const errors = await open(page, info, "/inkorg/em-106", SARA);
  await declineEm106(page);
  await expect(main(page).getByText("Avböjd", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Portalbeställning
test("portalbeställning från kommunen syns i inkorgen och kan accepteras", async ({ page }, info) => {
  const errors = await open(page, info, "/min-vecka", SARA);
  await commandAs(page, info, MARIA, "arenden.caseCreate", {
    source: "portal", referrerId: "k-maria", firstName: "Lina", lastName: "Portaltest", pnr: "19950505-1111", buyerReference: "4410023817", primaryArea: "F",
    plannedWeeks: 6, desiredStart: "2027-02-10", vocationalTrack: "Lokalvårdare med certifiering",
  }, SARA, "/inkorg?senaste=1");
  const m = main(page);
  await expect(m.getByRole("heading", { name: "Beställning i portalen" })).toBeVisible(); // ?senaste=1 väljer den senast mottagna (scenario 3 steg 4)
  await expect(m.locator("[data-inkorg-detail]").getByText("BOT-27-0051").first()).toBeVisible();
  await expect(m.getByText("Ordererkännande", { exact: true })).toBeVisible();
  await expect(m.getByText("Handläggaren fyllde i beställningen själv.", { exact: false })).toBeVisible();
  await m.getByRole("button", { name: "Acceptera", exact: true }).click();
  await page.check("#ink-coach-u-mats");
  await dialog(page).getByRole("button", { name: "Acceptera avropet" }).click();
  await expect(dialog(page).getByText("Mats Holm har fått en notis om tilldelningen")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Klart" }).click();
  await expect(m.getByText("Orderbekräftelse skickad")).toBeVisible();
  await expect(m.getByText("Accepterad", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- Hela flödet
test("hela flödet: alla avrop hanteras – flikar, ?arende=, tom startsida och omladdning", async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await open(page, info, "/inkorg/em-101", SARA);
  const m = main(page);
  await acceptEm101(page);
  await dialog(page).getByRole("button", { name: "Klart" }).click();
  await goAs(page, info, SARA, "/inkorg/em-103");
  await supplementAndAccept(page);
  await goAs(page, info, JOHAN, "/inkorg/em-104");
  await registerByPhone(page);
  await acceptProtected(page);
  await goAs(page, info, SARA, "/inkorg/em-105");
  await answerOther(page);
  await goAs(page, info, SARA, "/inkorg/em-106");
  await declineEm106(page, 232);

  // Flikar och ?arende=
  await goAs(page, info, SARA, "/inkorg");
  await expect(m.getByText("Inget att hantera")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Meny" }).getByRole("link", { name: /Avropsinkorg/ })).not.toContainText(/\d/);
  await m.getByRole("tab", { name: /Hanterade/ }).click();
  await expect(m.locator("[data-inkorg-row]").first()).toBeVisible();
  expect(await m.locator("[data-inkorg-row]").count()).toBeGreaterThanOrEqual(6);
  await goAs(page, info, SARA, "/inkorg?arende=case-270049");
  await expect(m.getByRole("heading", { name: "Ny deltagare till er – kök" })).toBeVisible();
  await expect(m.getByRole("tab", { name: "Alla" })).toHaveAttribute("aria-selected", "true");

  // Startsidan efter flödena: inkorgen tom, uppgiften klar.
  await goAs(page, info, SARA, "/min-vecka");
  await expect(m.getByText("Inkorgen är tom")).toBeVisible();
  await expect(m.getByText("Inga öppna uppgifter")).toBeVisible();

  // Åtgärderna spelas upp igen efter omladdning (deterministiska): samma inkorg och samma klocka.
  await goAs(page, info, SARA, "/inkorg");
  await m.getByRole("tab", { name: "Alla" }).click();
  const snap = async () => [await m.locator("nav[aria-label='Mejl i inkorgen']").innerText(), isDemo(info) ? await page.getByRole("banner", { name: "Prototypens verktyg" }).innerText() : ""];
  const before = await snap();
  await page.reload();
  await m.getByRole("tab", { name: "Alla" }).click();
  expect(await snap()).toEqual(before);
  expect(errors).toEqual([]);
});
