// Den genererade modulen (content.generated.ts) ska vara i takt med docs/lathund/*.md – annars visar hjälpsidorna gammal
// text. Bygg om med `npm run lathund:build`. Dessutom: renderaren klarar allt som lathundarna använder.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATHUND_KOLLEGA, LATHUND_KOMMUN, LATHUND_MALL } from "./content.generated";
import { headingId, markdownTitle, parseMarkdown } from "./markdown";

const doc = (file: string) => readFileSync(fileURLToPath(new URL(`../../../docs/lathund/${file}`, import.meta.url)), "utf8");

describe("lathundarna i appen", () => {
  it("content.generated.ts är byggd ur docs/lathund/*.md (npm run lathund:build)", () => {
    expect(LATHUND_KOLLEGA).toBe(doc("kollega.md"));
    expect(LATHUND_KOMMUN).toBe(doc("kommun.md"));
    expect(LATHUND_MALL).toBe(doc("mall-mejlavrop.md"));
  });

  it("varje lathund har en titel och bara block som renderaren förstår", () => {
    for (const md of [LATHUND_KOLLEGA, LATHUND_KOMMUN, LATHUND_MALL]) {
      expect(markdownTitle(md)).toBeTruthy();
      const blocks = parseMarkdown(md);
      expect(blocks.filter((b) => b.kind === "heading" && b.level === 1)).toHaveLength(1);
      // Inga tabeller, citat eller bilder – de renderas inte.
      for (const b of blocks) if (b.kind === "paragraph") expect(b.text, b.text).not.toMatch(/^(\||>|!\[)/);
    }
  });

  it("inga personuppgifter i lathundarna: bara påhittade testnamn och testpersonnummer", () => {
    // Personnumret i exemplet är ett testnummer med fel kontrollsiffra (Luhn) – det tillhör ingen person.
    const pnrs = [...LATHUND_MALL.matchAll(/\b(\d{8})-(\d{4})\b/g)].map((m) => `${m[1]}${m[2]}`);
    expect(pnrs.length).toBeGreaterThan(0);
    for (const p of pnrs) {
      const digits = p.slice(2);
      let sum = 0;
      for (let i = 0; i < digits.length; i++) {
        let v = Number(digits[i]) * (i % 2 === 0 ? 2 : 1);
        if (v > 9) v -= 9;
        sum += v;
      }
      expect(sum % 10, p).not.toBe(0);
    }
    expect(LATHUND_MALL).toMatch(/Förnamn[^\n]*: Test\n/);
    expect(LATHUND_MALL).toMatch(/Efternamn: Testsson/);
  });

  it("parseMarkdown: rubriker, listor, kodblock och stycken", () => {
    const blocks = parseMarkdown("# Titel\n\nEtt stycke\npå två rader.\n\n## Avsnitt\n\n1. Ett\n2. Två\n\n- Punkt\n\n```\nkod: här\n```\n");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Titel" },
      { kind: "paragraph", text: "Ett stycke på två rader." },
      { kind: "heading", level: 2, text: "Avsnitt" },
      { kind: "list", ordered: true, items: ["Ett", "Två"] },
      { kind: "list", ordered: false, items: ["Punkt"] },
      { kind: "code", text: "kod: här" },
    ]);
    expect(headingId("Beställa en insats i portalen")).toBe("bestalla-en-insats-i-portalen");
  });
});
