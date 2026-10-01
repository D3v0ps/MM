// "Lämna synpunkt" finns bara för testare i testmiljön (supabase-läget, app_settings.environment = staging). Minnesläget
// och prototypen har inga testare: där syns knapparna aldrig och API:t (feedback.*) svarar 404. Själva flödet – lämna en
// synpunkt och se den i listan, svara, ändra status och ladda ner CSV – prövas i komponenttestet
// src/features/synpunkter/panel.test.tsx genom samma hanterare, eftersom testare inte kan simuleras i minnesläget.
import { expect, test } from "@playwright/test";
import { isDemo, open } from "./helpers";

test("vanliga användare ser aldrig Lämna synpunkt, och synpunkterna finns inte utanför testmiljön", async ({ page }, info) => {
  const errors = await open(page, info, "/admin/integrationer", { userId: "u-robin", role: "admin" });
  await expect(page.locator("#main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lämna synpunkt" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Alla synpunkter" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Testmiljö" })).toHaveCount(0);
  if (!isDemo(info)) {
    const list = await page.request.post("/api/rpc", { data: { kind: "query", key: "feedback.list", input: {} } });
    expect(list.status()).toBe(404);
    const submit = await page.request.post("/api/rpc", {
      data: { kind: "command", key: "feedback.submit", input: { type: "fel", priority: "bor", text: "Test", path: "/admin/integrationer", viewTitle: "Underbiträden" } },
    });
    expect(submit.status()).toBe(404);
  }
  expect(errors).toEqual([]);
});
