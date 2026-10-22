// Bjud in per yrkesområde, nivå eller enskilda (spår G; Karims beslut 2026-10-22): urvalet – rätt deltagare, en gång var, och de som
// hoppas över med orsaken.
import { describe, expect, it } from "vitest";
import { ALREADY_INVITED_TEXT, INVITE_BLOCK_TEXT, selectByGroupings, skipCounts, skipLabel, skipSummary, type InviteGrouping, type SelectableCase, type UninvitableMember } from "./group-activities";

const DAY = "2027-02-04";
const cand = (n: number, o: Partial<SelectableCase> = {}): SelectableCase => ({
  caseId: `case-${n}`, caseNumber: `BOT-27-00${n}`, name: `Deltagare ${n}`, status: "active", startDate: "2027-01-04", endDate: null, pausedWeeks: [], ...o,
});
const CANDIDATES = [cand(10), cand(11), cand(12, { status: "paused" }), cand(13, { startDate: "2027-02-10" }), cand(14, { pausedWeeks: ["2027-W05"] }), cand(15), cand(16)];
const OTHERS: UninvitableMember[] = [{ caseId: "case-20", caseNumber: "BOT-27-0020", name: "Avslutad Deltagare", reason: INVITE_BLOCK_TEXT.closed }];
const GROUPINGS: InviteGrouping[] = [
  { id: "niva-2", kind: "level", name: "Nivå 2", caseIds: ["case-10", "case-12", "case-20"] },
  { id: "niva-3", kind: "level", name: "Nivå 3", caseIds: ["case-11", "case-13"] },
  { id: "G", kind: "area", name: "G – Lager och logistik", caseIds: ["case-11", "case-14", "case-15", "case-16"] },
];

describe("selectByGroupings – inbjudan per grupp eller nivå", () => {
  it("en nivå: pågående deltagare bjuds in; pausade och avslutade hoppas över med orsaken", () => {
    const r = selectByGroupings(["niva-2"], GROUPINGS, CANDIDATES, OTHERS, DAY, new Set());
    expect(r.invite.map((c) => c.caseId)).toEqual(["case-10"]);
    expect(r.skipped).toEqual([
      { caseId: "case-12", caseNumber: "BOT-27-0012", name: "Deltagare 12", reason: "Insatsen är pausad" },
      { caseId: "case-20", caseNumber: "BOT-27-0020", name: "Avslutad Deltagare", reason: "Insatsen är avslutad" },
    ]);
  });

  it("flera grupperingar: varje deltagare en gång, i ärendenummerordning; redan inbjudna, före start och uppehåll hoppas över", () => {
    const r = selectByGroupings(["niva-3", "G"], GROUPINGS, CANDIDATES, OTHERS, DAY, new Set(["case-16"]));
    expect(r.invite.map((c) => c.caseId)).toEqual(["case-11", "case-15"]);
    expect(r.skipped.map((s) => [s.caseId, s.reason])).toEqual([
      ["case-13", "Insatsen har inte startat den dagen"],
      ["case-14", "Uppehåll den veckan"],
      ["case-16", ALREADY_INVITED_TEXT],
    ]);
    expect(skipCounts(r.skipped)).toEqual([
      { reason: "Insatsen har inte startat den dagen", count: 1 }, { reason: ALREADY_INVITED_TEXT, count: 1 }, { reason: "Uppehåll den veckan", count: 1 },
    ]);
  });

  it("ingen grupp vald eller inget datum: ingen bjuds in", () => {
    expect(selectByGroupings([], GROUPINGS, CANDIDATES, OTHERS, DAY, new Set())).toEqual({ invite: [], skipped: [] });
    const noDay = selectByGroupings(["G"], GROUPINGS, CANDIDATES, OTHERS, null, new Set());
    expect(noDay.invite).toEqual([]);
    expect(noDay.skipped.every((s) => s.reason === "Välj datum först")).toBe(true);
  });

  it("deltagare som rollen inte ser (finns varken bland kandidaterna eller de överhoppade) räknas inte alls", () => {
    const r = selectByGroupings(["niva-2"], [{ id: "niva-2", kind: "level", name: "Nivå 2", caseIds: ["case-10", "case-99"] }], CANDIDATES, [], DAY, new Set());
    expect(r).toEqual({ invite: [CANDIDATES[0]], skipped: [] });
  });

  it("skipSummary: en etikett per orsak med antalet – aldrig en mening för en deltagare med ett antal framför", () => {
    const skipped = [
      { reason: ALREADY_INVITED_TEXT }, { reason: ALREADY_INVITED_TEXT }, { reason: INVITE_BLOCK_TEXT.paused }, { reason: INVITE_BLOCK_TEXT.paused_week },
      { reason: INVITE_BLOCK_TEXT.not_started }, { reason: "Insatsen har inte startat" }, { reason: "Skyddade personuppgifter – bara huvudcoachen och avtalsansvarig kan bjuda in deltagaren" },
    ];
    expect(skipSummary(skipped)).toBe("insatsen har inte startat (2), redan inbjudna (2), insatsen pausad (1), skyddade personuppgifter (1), uppehåll den veckan (1)");
    expect(skipSummary([])).toBe("");
    expect(skipLabel(INVITE_BLOCK_TEXT.closed)).toBe("insatsen avslutad");
    expect(skipLabel("Okänd orsak")).toBe("okänd orsak");
  });

  it("skipCounts: flest först, sedan orsaken i bokstavsordning", () => {
    expect(skipCounts([{ reason: "B" }, { reason: "A" }, { reason: "B" }])).toEqual([{ reason: "B", count: 2 }, { reason: "A", count: 1 }]);
  });
});
