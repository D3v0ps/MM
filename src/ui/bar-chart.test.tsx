// @vitest-environment jsdom
// BarChart (rapportbyggaren): sammanfattning för skärmläsare, mållinjerna ovanpå staplarna med vit kontur, inget internt mål
// utan värde, ingen stapel för en liten grupp och etiketter i antracit (röd bara på linjen).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarChart, barValueText } from "@/ui";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bars = [
  { label: "G Lager och logistik", value: 0.417 },
  { label: "H Serviceyrken", value: 0.2 },
  { label: "K Industri", value: null, small: true },
];

describe("BarChart", () => {
  it("aria-label sammanfattar staplarna och målen", () => {
    const { container } = render(<BarChart title="Resultatgrad per avtalsområde, september 2026 – januari 2027" unit="andel" bars={bars} contractTarget={0.32} internalTarget={0.35} smallText="färre än 5" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(
      "Resultatgrad per avtalsområde, september 2026 – januari 2027. G Lager och logistik: 41,7 %. H Serviceyrken: 20,0 %. K Industri: färre än 5. Avtalets mål 32,0 %. Internt mål 35,0 %.",
    );
    expect(barValueText("antal", 12)).toBe("12");
  });
  it("ingen stapel för en liten grupp – bara texten", () => {
    const { container } = render(<BarChart title="T" unit="andel" bars={bars} smallText="färre än 5" />);
    expect(container.querySelectorAll("rect[data-bar]")).toHaveLength(2);
    expect(container.textContent).toContain("färre än 5");
  });
  it("internt mål ritas inte utan värde (kommunens läge)", () => {
    const { container } = render(<BarChart title="T" unit="andel" bars={bars} contractTarget={0.32} />);
    expect(container.querySelector('[data-target="internal"]')).toBeNull();
    expect(container.textContent).not.toContain("Internt mål");
    expect(container.querySelector('[data-target="contract"]')).not.toBeNull();
  });
  it("mållinjerna kommer efter staplarna och har en vit linje under sig; etiketterna är antracit, aldrig röda", () => {
    const { container } = render(<BarChart title="T" unit="andel" bars={bars} contractTarget={0.32} internalTarget={0.35} />);
    const all = [...container.querySelectorAll("svg *")];
    const lastBar = Math.max(...all.map((e, i) => (e.matches("rect[data-bar]") ? i : -1)));
    for (const kind of ["contract", "internal"]) {
      const g = container.querySelector(`[data-target="${kind}"]`)!;
      expect(all.indexOf(g)).toBeGreaterThan(lastBar);
      const [outline, mark] = [...g.querySelectorAll("line")];
      expect(outline.getAttribute("data-outline")).toBe("true");
      expect(outline.getAttribute("style")).toContain("var(--color-vit)");
      expect(mark.getAttribute("style")).toContain(kind === "contract" ? "var(--color-rod)" : "var(--color-antracit)");
      expect(mark.getAttribute("style")).toContain(kind === "contract" ? "7 4" : "2 3");
      const label = container.querySelector(`[data-target-label="${kind}"]`)!;
      expect(label.getAttribute("style")).toContain("var(--color-antracit)");
      expect(label.getAttribute("style")).not.toContain("rod");
    }
    // Värdena ritas efter mållinjerna (med vit kant), så att linjerna inte skär igenom siffrorna.
    const firstValue = all.findIndex((e) => e.matches("text[data-value]"));
    expect(firstValue).toBeGreaterThan(all.indexOf(container.querySelector('[data-target="contract"]')!));
    expect(container.querySelector("text[data-value]")!.getAttribute("style")).toContain("var(--color-vit)");
    // Staplarna är antracit – inget blått, inget grönt.
    for (const r of container.querySelectorAll("rect[data-bar]")) expect(r.getAttribute("style")).toContain("var(--color-antracit)");
    expect(container.innerHTML).not.toMatch(/bla\b|green|#0f0/i);
  });
  it("large (kommunens portal): 16 px i diagrammet och portalens storlek i förklaringen; på smal skärm står namnet på en egen rad", () => {
    // 26 tecken: kortades till 17 tecken på smal skärm före ändringen.
    const long = [{ label: "Arbetsmarknadsenheten Alby", value: 0.5 }, ...bars];
    const normal = render(<BarChart title="T" unit="andel" bars={long} contractTarget={0.32} />);
    expect(normal.container.querySelector("svg")!.getAttribute("class")).toContain("[&_text]:text-[12px]");
    cleanup();
    // Smal skärm (360 px).
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 360, height: 0, x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 0, toJSON: () => ({}) } as DOMRect);
    const { container } = render(<BarChart title="T" unit="andel" bars={long} contractTarget={0.32} large />);
    const cls = container.querySelector("svg")!.getAttribute("class")!;
    expect(cls).toContain("[&_text]:text-[16px]");
    expect(cls).not.toContain("[&_text]:text-[12px]");
    expect(container.querySelector(".text-portal")?.textContent).toContain("Avtalets mål");
    // Den synliga texten (utan <title>) är hela namnet.
    const visible = [...container.querySelectorAll("text[data-label]")].map((t) => [...t.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""));
    expect(visible[0]).toBe("Arbetsmarknadsenheten Alby");
    expect(visible.join(" ")).not.toContain("…");
    // Namnet står ovanför stapeln (vänsterställt), inte till vänster om den – och ritas efter mållinjen med vit kant.
    const label = container.querySelector("text[data-label]")!;
    expect(label.getAttribute("text-anchor")).toBe("start");
    expect(label.getAttribute("style")).toContain("var(--color-vit)");
    const all = [...container.querySelectorAll("svg *")];
    expect(all.indexOf(label)).toBeGreaterThan(all.indexOf(container.querySelector('[data-target="contract"]')!));
  });
});
