import { describe, expect, it } from "vitest";
import { massNotePnrRows, massNoteRowsToSave } from "./mass-notes";

describe("massanteckningar – en rad per deltagare", () => {
  const rows = [{ caseId: "a" }, { caseId: "b" }, { caseId: "c" }, { caseId: "d" }];
  it("tomma rader och rader med bara mellanslag hoppas över; texten trimmas; datumet följer med", () => {
    expect(massNoteRowsToSave(rows, { a: " Var med på träffen. ", b: "", c: "   \n ", d: "Kom sent." }, "2027-02-01")).toEqual([
      { caseId: "a", occurredOn: "2027-02-01", body: "Var med på träffen." },
      { caseId: "d", occurredOn: "2027-02-01", body: "Kom sent." },
    ]);
    expect(massNoteRowsToSave(rows, {}, "2027-02-01")).toEqual([]);
  });
  it("personnummer stoppas per rad (också med tankstreck och mellanslag)", () => {
    const save = massNoteRowsToSave(rows, { a: "Pratade om CV.", b: "Pnr 850101-1234 stod på lappen", d: "19850101 – 1234" }, "2027-02-01");
    expect(massNotePnrRows(save)).toEqual(["b", "d"]);
  });
});
