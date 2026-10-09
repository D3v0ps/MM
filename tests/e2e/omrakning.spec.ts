// Exakt omräkning per kommando (D2 punkt 5, mb-vardag-9): efter ett kommando hämtas bara de frågor om som kommandot
// påverkar (CommandDef.invalidates) – och inget blir inaktuellt: räknaren i sidopanelen, listorna och kortet stämmer.
// Räknar anrop till /api/rpc, så testerna körs bara i projektet "app" (prototypen kör hanterarna i webbläsaren).
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isDemo, loaded, open } from "./helpers";

const AMIRA = { userId: "u-amira", role: "coach" };
const NADIA = "case-260143"; // BOT-26-0143
const main = (page: Page) => page.locator("#main");
const sideLink = (page: Page, name: RegExp) => page.locator("aside nav").getByRole("link", { name }).first();

/** Anropen till /api/rpc från och med nu: frågor (nyckel) och kommandon ("cmd nyckel"). */
function watchRpc(page: Page) {
  const keys: string[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/rpc")) return;
    try {
      const b = JSON.parse(r.postData() || "{}") as { kind?: string; key?: string };
      keys.push(`${b.kind === "command" ? "cmd " : ""}${b.key}`);
    } catch {
      /* ignoreras */
    }
  });
  return {
    /** Frågorna som hämtats efter det senaste kommandot (unika, sorterade). */
    afterCommand: () => {
      const i = keys.map((k) => k.startsWith("cmd ")).lastIndexOf(true);
      return [...new Set(keys.slice(i + 1))].sort();
    },
    all: () => keys.slice(),
    reset: () => keys.splice(0),
  };
}
/** Vänta tills nätet varit tyst en stund efter kommandot. */
async function quiet(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(700);
}
const onlyApp = (info: TestInfo) => test.skip(isDemo(info), "räknar serveranrop – bara appen");

test("registrera närvaro: bara närvarosidan och sidopanelens räknare hämtas om – räknaren går från 6 till 5", async ({ page }, info) => {
  onlyApp(info);
  const errors = await open(page, info, "/narvaro?vecka=forra", AMIRA);
  await expect(sideLink(page, /^Närvaro/)).toContainText("6");
  const rpc = watchRpc(page);
  const first = page.getByRole("group", { name: /^Närvaro för / }).first();
  await first.getByRole("button", { name: "Närvarande" }).click();
  await expect(first.getByRole("button", { name: "Närvarande" })).toHaveAttribute("aria-pressed", "true");
  await quiet(page);
  // Båda berörs: närvarosidan (raden) och räknaren "Närvaro att registrera".
  expect(rpc.afterCommand()).toEqual(["coach.narvaro", "session.navCounts"]);
  await expect(sideLink(page, /^Närvaro/)).toContainText("5");
  await expect(main(page)).toContainText("5 kvar");
  expect(errors).toEqual([]);
});

test("spara avstämning som utkast: närvaron, AI-läget och rösten hämtas inte om – kortets flik Avstämningar visar utkastet", async ({ page }, info) => {
  onlyApp(info);
  const errors = await open(page, info, `/avstamning/${NADIA}`, AMIRA);
  await expect(main(page).getByRole("heading", { level: 1, name: "Möte" })).toBeVisible();
  const rpc = watchRpc(page);
  await page.locator("#ci-note").fill("Ringde två arbetsgivare i lager. Uppföljning på torsdag.");
  await page.getByRole("button", { name: "Spara utkast" }).click();
  await expect(page.getByText("Utkastet är sparat. Du kan fortsätta senare.")).toBeVisible();
  await quiet(page);
  const after = rpc.afterCommand();
  expect(after).not.toContain("coach.checkInAttendance");
  expect(after).not.toContain("rost.caseVoice");
  expect(after).not.toContain("coach.aiRunInfo");
  expect(after).toContain("coach.checkInPage");
  expect(after.length).toBeLessThanOrEqual(3);
  // Kortet (grunt via brödsmulan): fliken Avstämningar hämtas på nytt och visar utkastet.
  await page.getByRole("link", { name: "BOT-26-0143" }).first().click();
  await loaded(page);
  await page.getByRole("tab", { name: /^Möten/ }).click();
  await expect(main(page)).toContainText("1 utkast väntar på granskning");
  expect(errors).toEqual([]);
});

test("skicka meddelande: bara kortet och tråden hämtas om – inte räknarna och inte rösten – och tråden visar meddelandet", async ({ page }, info) => {
  onlyApp(info);
  const errors = await open(page, info, `/arenden/${NADIA}?flik=meddelanden`, AMIRA);
  await expect(page.locator("#arn-msg-body")).toBeVisible();
  const rpc = watchRpc(page);
  const TEXT = "Hej Maria, vi ses tisdag vecka 6 kl. 10.";
  await page.locator("#arn-msg-body").fill(TEXT);
  await page.getByRole("button", { name: "Skicka säkert meddelande" }).click();
  await expect(main(page).locator("[data-mal^='msg:']").filter({ hasText: TEXT })).toBeVisible();
  await quiet(page);
  expect(rpc.afterCommand()).toEqual(["arenden.kort", "arenden.kortMeddelanden"]);
  expect(errors).toEqual([]);
});

test("kvittera flagga: Min vecka och sidopanelens räknare hämtas om (chefens deadlines läser kvitteringarna) – inte rösten; flaggan borta, och ärendelistan (grunt byte) visar Amal utan flaggan", async ({ page }, info) => {
  onlyApp(info);
  const errors = await open(page, info, "/min-vecka", AMIRA);
  const flag = page.locator("#flagga-stuck-case-270012-1");
  await expect(flag).toBeVisible();
  const rpc = watchRpc(page);
  await flag.getByRole("button", { name: "Kvittera" }).click();
  await page.locator("#ack-stuck-case-270012-1").fill("Bokar kartläggningen i veckan.");
  await page.getByRole("button", { name: "Spara kvittering" }).click();
  await expect(page.getByText("Flaggan är kvitterad.")).toBeVisible();
  await quiet(page);
  expect(rpc.afterCommand()).toEqual(["coach.minVecka", "session.navCounts"]);
  await expect(flag).toHaveCount(0);
  // Listan räknades om (arenden.lista) och hämtas när den visas: Amal utan flaggan Fastnat.
  rpc.reset();
  await sideLink(page, /^Mina ärenden/).click();
  await loaded(page);
  await expect(page.getByRole("table", { name: "Ärenden" })).toBeVisible();
  expect(rpc.all().filter((k) => k === "arenden.lista")).toHaveLength(1);
  const amal = page.getByRole("table", { name: "Ärenden" }).locator("tbody tr").filter({ hasText: "BOT-27-0012" });
  await expect(amal).toHaveCount(1);
  await expect(amal.locator("[title*='Fastnat']")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("öppna kortet direkt: högst 8 anrop, varje fråga en gång, och röstmeddelandenas visning loggas inte vid laddning", async ({ page }, info) => {
  onlyApp(info);
  const rpc = watchRpc(page);
  const errors = await open(page, info, `/arenden/${NADIA}?flik=meddelanden`, AMIRA);
  await expect(page.getByRole("group", { name: "Röstmeddelanden:" })).toBeVisible();
  await quiet(page);
  const all = rpc.all();
  expect(all.length).toBeLessThanOrEqual(8);
  const counts = new Map<string, number>();
  for (const k of all) counts.set(k, (counts.get(k) ?? 0) + 1);
  expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
  expect(all).toContain("cmd session.auditView");
  expect(all).not.toContain("cmd rost.notesSeen");
  expect(errors).toEqual([]);
});
