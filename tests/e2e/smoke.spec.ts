import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("diagnossidan svarar i både prototypen och appen", async ({ page }, info) => {
  const errors = await open(page, info, "/diagnos");
  await expect(page.getByTestId("diagnos")).toContainText("2027-02-01T09:12");
  expect(errors).toEqual([]);
});
