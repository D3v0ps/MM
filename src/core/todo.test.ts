import { describe, expect, it } from "vitest";
import { todoRows, todoSummary, whenText, type TodoPart } from "./todo";

type P = TodoPart & { what: string };
const p = (key: string, dueAt: string | null, weight: number, group: string | null = null): P => ({ key, dueAt, weight, group, what: key });
const keys = (rows: ReturnType<typeof todoRows<P>>) => rows.map((r) => r.main.key);

describe("todoRows – sortering på tid", () => {
  it("sorterar på sista tid, det som saknar tid sist", () => {
    const rows = todoRows([p("utan", null, 1), p("sen", "2027-02-05T23:59", 1), p("tidig", "2027-02-01T10:00", 1), p("mitt", "2027-02-02T08:41", 1)]);
    expect(keys(rows)).toEqual(["tidig", "mitt", "sen", "utan"]);
  });

  it("samma tid och utan tid: lägre vikt först, sedan i den ordning delarna kom (stabil)", () => {
    const rows = todoRows([p("b", "2027-02-01T10:00", 20), p("a", "2027-02-01T10:00", 10), p("c", "2027-02-01T10:00", 20), p("y", null, 50), p("x", null, 40)]);
    expect(keys(rows)).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("passerad tid står först (försenat överst)", () => {
    const rows = todoRows([p("i-dag", "2027-02-01T16:00", 1), p("forsenad", "2027-01-29T23:59", 1)]);
    expect(keys(rows)).toEqual(["forsenad", "i-dag"]);
  });
});

describe("todoRows – samma ärende en gång", () => {
  it("delar med samma grupp blir en rad med den tidigaste tiden och den viktigaste delens åtgärd", () => {
    const rows = todoRows([
      p("flagga", null, 30, "case-39"),
      p("forfaller", "2027-02-02T10:40", 60, "case-39"),
      p("boka", "2027-02-02T10:40", 20, "case-39"),
      p("avrop", "2027-02-01T10:05", 10, "case-48"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key)).toEqual(["grupp:case-48", "grupp:case-39"]);
    const c39 = rows[1];
    expect(c39.main.key).toBe("boka");
    expect(c39.dueAt).toBe("2027-02-02T10:40");
    expect(c39.rest.map((x) => x.key)).toEqual(["forfaller", "flagga"]);
  });

  it("raden får gruppens tidigaste tid även när den viktigaste delen saknar tid", () => {
    const rows = todoRows([p("tidig", "2027-02-03T09:00", 5), p("kvittera", null, 1, "c1"), p("svar", "2027-02-01T12:00", 9, "c1")]);
    expect(keys(rows)).toEqual(["kvittera", "tidig"]);
    expect(rows[0].dueAt).toBe("2027-02-01T12:00");
  });

  it("delar utan grupp slås aldrig ihop", () => {
    const rows = todoRows([p("a", null, 1), p("b", null, 1), p("c", null, 1, null)]);
    expect(rows).toHaveLength(3);
  });

  it("varje ärende står exakt en gång", () => {
    const parts = ["c1", "c2", "c1", "c3", "c2", "c1"].map((g, i) => p(`d${i}`, i % 2 ? `2027-02-0${i}T10:00` : null, i, g));
    const rows = todoRows(parts);
    expect(rows.map((r) => r.key).sort()).toEqual(["grupp:c1", "grupp:c2", "grupp:c3"]);
    expect(rows.reduce((n, r) => n + 1 + r.rest.length, 0)).toBe(parts.length);
  });
});

describe("todoSummary och whenText", () => {
  it("räknar rader och försenade", () => {
    const rows = todoRows([p("a", "2027-01-29T23:59", 1), p("b", "2027-02-01T10:00", 1), p("c", null, 1)]);
    expect(todoSummary(rows, "2027-02-01T09:12")).toEqual({ total: 3, late: 1 });
  });

  it("tiden i klarspråk relativt till i dag", () => {
    const now = "2027-02-01T09:12";
    expect(whenText("2027-02-01T10:00", now)).toBe("i dag kl. 10.00");
    expect(whenText("2027-01-31T16:00", now)).toBe("i går kl. 16.00");
    expect(whenText("2027-02-02T08:41", now)).toBe("i morgon kl. 08.41");
    expect(whenText("2027-02-03T16:00", now)).toBe("ons 3 feb kl. 16.00");
    expect(whenText("2027-02-05", now)).toBe("fre 5 feb");
    expect(whenText(null, now)).toBe("–");
  });
});
