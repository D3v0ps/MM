import { describe, expect, it } from "vitest";
import { absoluteLinks, appBaseUrl, maskLinkTokens, TOKEN_MASK } from "./link-tokens";

const TOKEN = "rost-0f3c2a9e-7b1d-4c55-9a2e-5d6f7a8b9c0d";
const BODY = `Hej! Spela in ett kort meddelande. Länken gäller i 7 dagar och kan bara användas en gång: /rost/${TOKEN}`;

describe("engångslänkar i utskick", () => {
  it("sökvägen blir en fullständig adress med MM_APP_URL (snedstreck på slutet tas bort)", () => {
    expect(absoluteLinks(BODY, "https://www.miljonmatch.se/")).toBe(BODY.replace(`/rost/${TOKEN}`, `https://www.miljonmatch.se/rost/${TOKEN}`));
    expect(absoluteLinks(`/puls/${TOKEN}`, "https://www.miljonmatch.se")).toBe(`https://www.miljonmatch.se/puls/${TOKEN}`);
    // Redan fullständig adress, för kort token, annan sökväg eller ingen giltig adress: ingen ändring
    const full = `Länk: https://www.miljonmatch.se/rost/${TOKEN}`;
    expect(absoluteLinks(full, "https://www.miljonmatch.se")).toBe(full);
    expect(absoluteLinks("Se /rost/kort", "https://www.miljonmatch.se")).toBe("Se /rost/kort");
    expect(absoluteLinks("Logga in på /portal/rapporter", "https://www.miljonmatch.se")).toBe("Logga in på /portal/rapporter");
    for (const bad of [null, "", "www.miljonmatch.se", "javascript:alert(1)", "https://"]) expect(absoluteLinks(BODY, bad)).toBe(BODY);
    expect(appBaseUrl(" https://www.miljonmatch.se// ")).toBe("https://www.miljonmatch.se");
  });

  it("token maskeras – med och utan adress, och bara i engångslänkarna", () => {
    expect(maskLinkTokens(BODY)).toBe(BODY.replace(TOKEN, TOKEN_MASK));
    expect(maskLinkTokens(`https://www.miljonmatch.se/rost/${TOKEN}.`)).toBe(`https://www.miljonmatch.se/rost/${TOKEN_MASK}.`);
    expect(maskLinkTokens(`/puls/${TOKEN} och /rost/${TOKEN}`)).toBe(`/puls/${TOKEN_MASK} och /rost/${TOKEN_MASK}`);
    expect(maskLinkTokens(absoluteLinks(BODY, "https://www.miljonmatch.se"))).not.toContain(TOKEN);
    const other = "Ärende BOT-27-0048 finns i portalen – logga in för att läsa. https://www.miljonmatch.se/portal";
    expect(maskLinkTokens(other)).toBe(other);
  });
});
