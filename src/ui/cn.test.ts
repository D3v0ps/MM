import { expect, it } from "vitest";
import { cn } from "@/ui/cn";
it("cn", () => {
  expect(cn("text-label text-text-muted", "text-antracit")).toBe("text-label text-antracit");
  expect(cn("text-label", "text-small")).toBe("text-small");
  expect(cn("rounded-card", "rounded-none")).toBe("rounded-none");
  expect(cn("shadow-card", "shadow-pop")).toBe("shadow-pop");
  expect(cn("portal:min-h-[52px]", "portal:min-h-11")).toBe("portal:min-h-11");
  expect(cn("text-h2 portal:text-h3")).toBe("text-h2 portal:text-h3");
});
