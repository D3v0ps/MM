// Prototypfältet, testscenarierna och feedbacken – finns bara i prototypen (projektet "demo").
// Kontrollerar att varje scenariosteg öppnar rätt sökväg som rätt roll, utan konsolfel.
// Id:n är testdatats (samma som den gamla prototypen: prototyp/tools/data-samples.json -> script_tags).
import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "demo", "Prototypfältet och scenarierna finns bara i prototypen.");
});

const bar = (page: Page) => page.getByRole("region", { name: "Pågående testscenario" });
const hashOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace(/^#/, ""));

async function expectAt(page: Page, path: string, role: string | null, perspective: "Leverantör" | "Kund" | "Deltagare") {
  await expect.poll(() => hashOf(page)).toBe(path);
  const persp = page.getByRole("group", { name: "Perspektiv" });
  await expect(persp.getByRole("button", { name: perspective })).toHaveAttribute("aria-pressed", "true");
  if (role) await expect(page.getByLabel("Roll", { exact: true })).toHaveValue(role);
  else await expect(page.getByLabel("Roll", { exact: true })).toHaveCount(0);
}

async function startScenario(page: Page, n: number) {
  await page.getByRole("button", { name: new RegExp(`^Starta scenario ${n}:`) }).click();
}
const next = (page: Page) => bar(page).getByRole("button", { name: "Nästa steg" }).click();

test("startsidan: prototypfält, demodatum, roller och 14 scenarier", async ({ page }, info) => {
  const errors = await open(page, info, "/om");
  await expect(page.getByRole("heading", { level: 1, name: "Miljonmatch" })).toBeVisible();
  await expect(page.getByRole("banner", { name: "Prototypens verktyg" })).toContainText("Demodatum måndag 1 februari 2027 kl. 09.12 · v. 5");
  await expectAt(page, "/om", "samordnare", "Leverantör");
  await expect(page.getByLabel("Roll", { exact: true }).locator("option")).toHaveText([
    "Samordnare – Sara Lindqvist",
    "Avtalsansvarig – Johan Berg",
    "Huvudcoach – Amira Haddad",
    "Handledare – Petra Ek",
    "Chef och controller – Karin Wallin",
    "Ekonom – Lars Nyström",
    "Systemadmin – Robin Åberg",
  ]);
  await expect(page.getByRole("button", { name: /^Starta scenario \d+:/ })).toHaveCount(14);
  await expect(page.getByText("Testscenarier (0 av 53 steg testade)")).toBeVisible();
  await expect(page).toHaveTitle("Om prototypen – Miljonmatch");
  expect(errors).toEqual([]);
});

test("scenario 1: från mejl till kundens portal", async ({ page }, info) => {
  const errors = await open(page, info, "/om");
  await startScenario(page, 1);
  await expect(bar(page)).toContainText("Scenario 1: Från mejl till orderbekräftelse · steg 1 av 3");
  await expect(bar(page)).toContainText("Leverantör: Samordnare");
  await expectAt(page, "/inkorg/em-101", "samordnare", "Leverantör");
  await next(page);
  await expect(bar(page)).toContainText("steg 2 av 3");
  await expectAt(page, "/inkorg/em-101", "samordnare", "Leverantör");
  await next(page);
  await expect(bar(page)).toContainText("steg 3 av 3");
  await expect(bar(page)).toContainText("Kund: Kommunens handläggare");
  await expectAt(page, "/portal/deltagare/case-270050", "kommun_handlaggare", "Kund");
  // Sista steget: feedback på scenariot i stället för Nästa steg.
  await expect(bar(page).getByRole("button", { name: "Nästa steg" })).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Feedback på scenariot" }).click();
  const drawer = page.getByRole("dialog", { name: "Feedback" });
  await expect(drawer.getByRole("button", { name: "Scenariot: Från mejl till orderbekräftelse" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  // Föregående går tillbaka till leverantörens perspektiv.
  await bar(page).getByRole("button", { name: "Föregående" }).click();
  await expectAt(page, "/inkorg/em-101", "samordnare", "Leverantör");
  expect(errors).toEqual([]);
});

test("scenario 5: röd status från coachen till kommunen", async ({ page }, info) => {
  const errors = await open(page, info, "/om");
  await startScenario(page, 5);
  await expectAt(page, "/avstamning/case-260148", "coach", "Leverantör");
  await next(page);
  await expectAt(page, "/avstamning/case-260148", "coach", "Leverantör");
  await next(page);
  await expectAt(page, "/arenden/case-260148?flik=avvikelser", "coach", "Leverantör");
  await next(page);
  await expectAt(page, "/portal/deltagare/case-260148", "kommun_handlaggare", "Kund");
  expect(errors).toEqual([]);
});

test("scenario 11 och 13: deltagaren, ledningen och avtalet som konfiguration", async ({ page }, info) => {
  const errors = await open(page, info, "/om");
  await startScenario(page, 11);
  await expectAt(page, "/puls", null, "Deltagare");
  await expect(bar(page)).toContainText("Deltagare: Deltagare (pulslänk)");
  await next(page);
  await expectAt(page, "/ledning?flik=puls", "chef", "Leverantör");

  await page.getByRole("button", { name: "Start och scenarier" }).click();
  await startScenario(page, 13);
  await expect(bar(page)).toContainText("Scenario 13: Avtalet är konfiguration · steg 1 av 3");
  await expectAt(page, "/admin/avtal", "admin", "Leverantör");
  await next(page);
  await expectAt(page, "/admin/avtal?avtal=c-kk&flik=jamfor", "admin", "Leverantör");
  await next(page);
  await expectAt(page, "/om/fragor", "admin", "Leverantör");
  await expect(page.getByRole("heading", { level: 1, name: "Öppna frågor" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Öppna frågor" }).getByRole("row")).toHaveCount(19);
  expect(errors).toEqual([]);
});

test("steg markeras som testade, scenariot sparas vid omladdning och kan avslutas", async ({ page }, info) => {
  const errors = await open(page, info, "/om");
  await startScenario(page, 8);
  await expectAt(page, "/ekonomi/2027-01", "ekonom", "Leverantör");
  const tested = bar(page).getByRole("button", { name: "Testat" });
  await expect(tested).toHaveAttribute("aria-pressed", "false");
  await tested.click();
  await expect(tested).toHaveAttribute("aria-pressed", "true");
  await next(page);
  await expect(bar(page)).toContainText("steg 2 av 4");
  await page.reload();
  await expect(bar(page)).toContainText("Scenario 8: Fakturering januari · steg 2 av 4");
  await expectAt(page, "/ekonomi/2027-01", "ekonom", "Leverantör");
  await bar(page).getByRole("button", { name: "Avsluta scenariot" }).click();
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Start och scenarier" }).click();
  await expect(page.getByText("Testscenarier (1 av 53 steg testade)")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Starta scenario 8:/ }).locator("xpath=ancestor::section[1]")).toContainText("1/4 testade");
  expect(errors).toEqual([]);
});

test("perspektiv, roll och återställning i prototypfältet", async ({ page }, info) => {
  const errors = await open(page, info, "/om");
  await page.getByRole("group", { name: "Perspektiv" }).getByRole("button", { name: "Kund" }).click();
  await expectAt(page, "/portal", "kommun_handlaggare", "Kund");
  await page.getByLabel("Roll", { exact: true }).selectOption("kommun_chef");
  await expectAt(page, "/portal/bestallarrapport", "kommun_chef", "Kund");
  await page.getByRole("group", { name: "Perspektiv" }).getByRole("button", { name: "Leverantör" }).click();
  await expectAt(page, "/start", "samordnare", "Leverantör");
  await page.getByLabel("Roll", { exact: true }).selectOption("coach");
  await expectAt(page, "/min-vecka", "coach", "Leverantör");

  await page.getByRole("button", { name: "Återställ demodata" }).click();
  await expect(page.getByText("Ta bort allt du gjort?")).toBeVisible();
  await page.getByRole("button", { name: "Avbryt" }).click();
  await expect(page.getByText("Ta bort allt du gjort?")).toHaveCount(0);
  await page.getByRole("button", { name: "Återställ demodata" }).click();
  await page.getByRole("button", { name: "Ja, återställ" }).click();
  await expectAt(page, "/om", "samordnare", "Leverantör");
  await expect(page.getByText("Demodata återställd. Allt du gjort i prototypen är borttaget.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("feedback: lådan fyller i roll och vy, sparas lokalt och syns i genomgången", async ({ page }, info) => {
  const errors = await open(page, info, "/om/fragor", { userId: "u-karin", role: "chef" });
  const fab = page.getByRole("button", { name: "Lämna feedback" });
  await fab.click();
  const drawer = page.getByRole("dialog", { name: "Feedback" });
  await expect(drawer).toContainText("Leverantörens perspektiv – Miljonbemanning");
  await expect(drawer).toContainText("Chef och controller · Öppna frågor");
  await expect(drawer.getByLabel(/Vad tycker du/)).toBeFocused();
  await expect(drawer.getByText("Sparas bara i din webbläsare")).toBeVisible();
  // Tom text stoppas med ett fel.
  await drawer.getByRole("button", { name: "Spara feedback" }).click();
  await expect(drawer.getByText("Skriv vad du tycker innan du sparar.")).toBeVisible();
  await drawer.getByRole("button", { name: "Fel" }).click();
  await drawer.getByRole("button", { name: "Måste ändras" }).click();
  await drawer.getByLabel(/Vad tycker du/).fill("Fråga 3 borde stå överst.");
  await drawer.getByRole("button", { name: "Spara feedback" }).click();
  await expect(drawer.getByText("Tack! Feedbacken är sparad.")).toBeVisible();
  await drawer.getByRole("button", { name: "Visa all feedback" }).click();
  await expect(drawer.getByRole("tab", { name: /All feedback/ })).toHaveAttribute("aria-selected", "true");
  const item = drawer.locator("article").first();
  await expect(item).toContainText("Måste ändras");
  await expect(item).toContainText("Chef och controller · Öppna frågor");
  await expect(item).toContainText("Fråga 3 borde stå överst.");
  // Escape stänger och fokus går tillbaka till knappen.
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(fab).toBeFocused();
  await expect(page.getByRole("button", { name: "Genomgång (1 nya)" })).toBeVisible();

  await page.getByRole("button", { name: "Genomgång (1 nya)" }).click();
  await expect.poll(() => hashOf(page)).toBe("/om/genomgang");
  await expect(page.getByRole("heading", { name: "Leverantör · Öppna frågor (1)" })).toBeVisible();
  // Statusen sparas först med "Spara status" (piltangenterna i listan sparar inte varje steg).
  await page.getByLabel("Status", { exact: true }).last().selectOption("klar");
  await expect(page.locator("article")).toContainText("Fråga 3 borde stå överst.");
  await page.getByRole("button", { name: "Spara status" }).click();
  await expect(page.getByText("Ingen feedback att visa")).toBeVisible();
  // Feedbacken finns kvar efter omladdning (lokalt läge).
  await page.reload();
  await page.getByLabel("Status", { exact: true }).first().selectOption("alla");
  await expect(page.locator("article")).toContainText("Fråga 3 borde stå överst.");
  await page.getByRole("button", { name: "Gå till vyn" }).click();
  await expectAt(page, "/om/fragor", "chef", "Leverantör");
  expect(errors).toEqual([]);
});

/** Påhittad artefaktmiljö (window.claude) med en delad databas i minnet – samma anrop som claude.ai:s db-förmåga. */
function fakeClaude() {
  type Doc = { path: string; data: Record<string, unknown> };
  const docs = new Map<string, Doc>();
  const subs = new Set<() => void>();
  const w = window as unknown as { __db: Map<string, Doc>; claude: unknown };
  w.__db = docs;
  const put = (path: string, data: Record<string, unknown>) => {
    docs.set(path, { path, data: JSON.parse(JSON.stringify(data)) });
    subs.forEach((f) => f());
  };
  put("feedback/f-gammal", {
    type: "fel", priority: "maste", text: "Gammal punkt från v1", status: "ny", createdAt: "2026-09-29T10:00:00.000Z", authorId: "user-2", replyCount: 1,
    role: "samordnare", roleLabel: "Samordnare", perspective: "leverantor", perspectiveLabel: "Leverantör", viewId: "sam.inkorg", viewTitle: "Avropsinkorg",
    viewParams: { emailId: "em-101" }, scenarioId: null, scenarioTitle: null, prototypeVersion: "v1 · 2026-09-29",
  });
  put("feedback/f-gammal/replies/r1", { text: "Håller med", createdAt: "2026-09-29T11:00:00.000Z", authorId: "user-1" });
  let seq = 0;
  const query = (coll: string, order?: [string, string], lim?: number) => ({
    orderBy: (f: string, d = "asc") => query(coll, [f, d], lim),
    limit: (n: number) => query(coll, order, n),
    add: async (data: Record<string, unknown>) => put(`${coll}/n${++seq}`, data),
    onSnapshot: (next: (s: unknown) => void) => {
      const emit = () => {
        let list = [...docs.values()].filter((d) => d.path.slice(0, d.path.lastIndexOf("/")) === coll);
        if (order) list = list.sort((a, b) => (String(a.data[order[0]]) < String(b.data[order[0]]) ? -1 : 1) * (order[1] === "desc" ? -1 : 1));
        if (lim) list = list.slice(0, lim);
        next({ docs: list.map((d) => ({ id: d.path.split("/").pop(), data: () => d.data })) });
      };
      subs.add(emit);
      setTimeout(emit, 0);
      return () => subs.delete(emit);
    },
  });
  const db = {
    collection: (p: string) => query(p),
    doc: (p: string) => ({
      set: async (data: Record<string, unknown>) => put(p, data),
      update: async (data: Record<string, unknown>) => put(p, { ...(docs.get(p)?.data ?? {}), ...data }),
      delete: async () => {
        docs.delete(p);
        subs.forEach((f) => f());
      },
    }),
  };
  const user = { id: async () => "user-1", can: async () => true, profiles: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { name: id === "user-2" ? "Karim Testare" : "" }])) };
  w.claude = { use: async (name: string) => (name === "db" ? db : name === "user" ? user : null) };
}

test("delad feedback i claude.ai: samma samlingar och fält som den gamla prototypen", async ({ page }, info) => {
  await page.addInitScript(fakeClaude);
  const errors = await open(page, info, "/om/genomgang");
  const old = page.locator("article", { hasText: "Gammal punkt från v1" });
  await expect(old).toContainText("Karim Testare");
  await expect(old).toContainText("Samordnare · Avropsinkorg");
  await expect(page.getByText("Visar bara feedback från den här webbläsaren")).toHaveCount(0);
  await old.getByRole("button", { name: "Svar (1)" }).click();
  await expect(old).toContainText("Håller med");
  await expect(old).toContainText("Du ·");
  await old.getByLabel("Svara").fill("Vi tar det på mötet");
  await old.getByRole("button", { name: "Svara" }).click();
  await expect(old).toContainText("Vi tar det på mötet");
  await expect(old.getByRole("button", { name: "Svar (2)" })).toBeVisible();

  // Ny feedback hamnar i samlingen feedback med samma fält (plus sökvägen).
  await page.getByRole("button", { name: "Lämna feedback" }).first().click();
  const drawer = page.getByRole("dialog", { name: "Feedback" });
  await drawer.getByLabel(/Vad tycker du/).fill("Ny punkt från v2");
  await drawer.getByRole("button", { name: "Spara feedback" }).click();
  await expect(drawer.getByText("Alla som har länken ser den under All feedback")).toBeVisible();
  await page.keyboard.press("Escape");
  const saved = await page.evaluate(() => {
    const db = (window as unknown as { __db: Map<string, { path: string; data: Record<string, unknown> }> }).__db;
    return [...db.values()].find((d) => d.data.text === "Ny punkt från v2");
  });
  expect(saved?.path).toMatch(/^feedback\/[^/]+$/);
  expect(saved?.data).toMatchObject({
    type: "forbattring", priority: "bor", status: "ny", authorId: "user-1", replyCount: 0, role: "samordnare", roleLabel: "Samordnare",
    perspective: "leverantor", perspectiveLabel: "Leverantör", viewId: "om.feedback", viewTitle: "Genomgång av feedback", path: "/om/genomgang",
    scenarioId: null, scenarioTitle: null, prototypeVersion: "v2 · 2026-09-30",
  });

  // Äldre feedback har vy-id från den gamla prototypen – "Gå till vyn" öppnar motsvarande sökväg.
  await old.getByRole("button", { name: "Gå till vyn" }).click();
  await expectAt(page, "/inkorg/em-101", "samordnare", "Leverantör");

  // Testade steg sparas under progress/{användare}.
  await page.getByRole("button", { name: "Start och scenarier" }).click();
  await startScenario(page, 2);
  await bar(page).getByRole("button", { name: "Testat" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __db: Map<string, { data: Record<string, unknown> }> }).__db.get("progress/user-1")?.data.done))
    .toEqual({ "s2:0": true });
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- 400 px: prototypfältet ger ingen sidledsscroll
test("400 px: ingen sidledsscroll med prototypfältet – varje roll, portalen och sidan utan behörighet", async ({ page }, info) => {
  const pages: [string, string, string][] = [
    ["u-sara", "samordnare", "/start"],
    ["u-amira", "coach", "/min-vecka"],
    ["u-karin", "chef", "/ledning"],
    ["u-robin", "admin", "/admin/avtal"],
    ["k-maria", "kommun_handlaggare", "/portal"],
    ["k-maria", "kommun_handlaggare", "/portal/deltagare/case-260143?flik=meddelanden"],
    ["k-eva", "kommun_chef", "/portal/bestallarrapport"],
    // Kommunens chef har inte behörighet till handläggarens startsida: knappen "Visa som kommunens handläggare" ska radbrytas.
    ["k-eva", "kommun_chef", "/portal"],
    ["deltagare", "deltagare", "/puls"],
  ];
  await page.setViewportSize({ width: 400, height: 860 });
  const errors = await open(page, info, "/om");
  for (const [userId, role, to] of pages) {
    await page.evaluate((a) => localStorage.setItem("miljonmatch-prototyp-v2-persona", JSON.stringify(a)), { userId, role });
    await page.goto(`http://proto.test/index.html#${to}`);
    await page.reload();
    await expect(page.getByRole("banner", { name: "Prototypens verktyg" })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${role} ${to}: ingen sidledsscroll på 400 px`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
