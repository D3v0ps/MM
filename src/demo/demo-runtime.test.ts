// Prototypens logg över kommandon: loggar från tiden före "alla roller samtidigt" (Karims beslut 7, 2026-10-09) spelas upp.
import { describe, expect, it } from "vitest";
import { actorFromLog } from "./demo-runtime";

describe("actorFromLog", () => {
  it("en gammal loggrad med en roll får rollerna som lista – resten av aktören är orörd", () => {
    expect(actorFromLog({ userId: "k-maria", role: "kommun_handlaggare", contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" })).toEqual({
      userId: "k-maria", roles: ["kommun_handlaggare"], contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby",
    });
  });
  it("en ny loggrad lämnas som den är; en trasig rad får inga roller (hanteraren nekar då)", () => {
    const a = { userId: "u-lars", roles: ["coach", "ekonom"], contractIds: ["c-bot"] };
    expect(actorFromLog(a)).toBe(a);
    expect(actorFromLog(null)).toEqual({ roles: [] });
  });
});
