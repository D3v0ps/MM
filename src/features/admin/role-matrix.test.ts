// Behörighetsmatrisen på Användare och roller ska stämma med verkligheten (UX-genomgången, paket 1, A1): varje rad låses mot
// hanterarnas roller (rolesOf), rutterna och policyn. Ändras en roll i en hanterare utan att matrisen ändras – eller tvärtom –
// går testet sönder.
import { describe, expect, it } from "vitest";
import { rolesOf } from "@/api/handlers";
import type { Role } from "@/api/roles";
import { canSeeNotes, caseAccess } from "@/core/access";
import { APP_ROUTES } from "@/shell/route-table";
import { resolveRoute } from "@/shell/routes";
import { MATRIX_ROLES, ROLE_DESCRIPTIONS, roleMatrix, type MatrixCell, type MatrixRole } from "./role-matrix";

const matrix = roleMatrix(["chef"], (r) => r);
const rowOf = (key: string) => {
  const r = matrix.flatMap((g) => g.rows).find((x) => x.key === key);
  if (!r) throw new Error(`Raden ${key} saknas`);
  return r;
};
const has = (key: string, role: Role) => {
  const roles = rolesOf(key);
  if (!roles) throw new Error(`Hanteraren ${key} finns inte`);
  return roles.includes(role);
};
const withCell = (key: string, cell: MatrixCell = "ja") => MATRIX_ROLES.filter((r) => rowOf(key).cells[r] === cell);
const handlerRoles = (key: string) => MATRIX_ROLES.filter((r) => has(key, r));
const routeRoles = (path: string) => {
  const m = resolveRoute(APP_ROUTES, path);
  if (!m) throw new Error(`Rutten ${path} finns inte`);
  return MATRIX_ROLES.filter((r) => m.route.roles.includes(r));
};

describe("behörighetsmatrisen stämmer med hanterarna, rutterna och policyn (paket 1, A1)", () => {
  it("Gör: varje rad är exakt de roller som kommandot tar emot", () => {
    const commands: Record<string, string[]> = {
      // Ta emot (Karims beslut 2026-11-09): coachen bara som avtalets intagsansvarige – hanteraren och databasen prövar det.
      accept: ["arenden.caseAccept", "arenden.acceptForm"],
      decline: ["arenden.caseDecline"],
      customers: ["admin.inviteCustomer", "admin.setCustomerActive"],
      staff: ["admin.inviteStaff", "admin.setStaffRoles"],
      admin: ["admin.setContractManager", "admin.setIntakeCoach", "admin.setOrgRule", "admin.runJob"],
      alerts: ["ledning.alertAck"],
      deviations: ["ledning.cdevSave"],
      invoicing: ["ekonomi.billingSendFortnox", "ekonomi.billingApproveInvoice"],
      logcheck: ["admin.logCheck"],
    };
    const doRows = matrix.find((g) => g.title === "Gör")?.rows.map((r) => r.key);
    expect(doRows?.sort()).toEqual(Object.keys(commands).sort());
    for (const [row, keys] of Object.entries(commands)) {
      for (const key of keys) expect(withCell(row), `${row}: ${key}`).toEqual(handlerRoles(key));
      // Bara Ja eller Nej i Gör.
      expect(MATRIX_ROLES.every((r) => ["ja", "nej"].includes(rowOf(row).cells[r])), row).toBe(true);
    }
    // Coachen tar emot bara som avtalets intagsansvarige (raden säger det) och avböjer aldrig; inkorgen är inte coachens.
    expect(rowOf("accept").label).toMatch(/coachen bara som avtalets intagsansvarige/);
    expect(rowOf("decline").cells.coach).toBe("nej");
    for (const key of ["inkorg.list", "inkorg.item", "inkorg.decisionForm", "inkorg.confirmation", "inkorg.register", "inkorg.emailSetStatus", "inkorg.emailApplySupplement"]) {
      expect(has(key, "coach"), key).toBe(false);
    }
    // Chefen kvitterar flaggor och signerar loggkontrollen.
    expect(rowOf("alerts").cells.chef).toBe("ja");
    expect(withCell("logcheck")).toEqual(["chef"]);
  });

  it("Ser: fakturaunderlag och belopp bara för ekonomen (beslut 2026-10-07)", () => {
    expect(withCell("billing")).toEqual(["ekonom"]);
    expect(MATRIX_ROLES.filter((r) => rowOf("billing").cells[r] !== "nej")).toEqual(["ekonom"]);
    expect(handlerRoles("ekonomi.start")).toEqual(["ekonom"]);
    expect(handlerRoles("ekonomi.case")).toEqual(["ekonom"]);
    expect(routeRoles("/ekonomi")).toEqual(["ekonom"]);
  });

  it("Ser: revisionsloggen och avtalskonfigurationen som rutterna och frågorna", () => {
    expect(withCell("audit")).toEqual(handlerRoles("admin.auditLog"));
    expect(withCell("audit")).toEqual(routeRoles("/admin/logg"));
    expect(withCell("config")).toEqual(handlerRoles("admin.contract"));
    expect(withCell("config")).toEqual(routeRoles("/admin/avtal"));
  });

  it("Ser: ärendena – coachen alla i avtalet (beslut 2026-10-09), chef och admin läser, ekonomen bara nummer, kommunen egna", () => {
    const cells = rowOf("cases").cells;
    for (const r of MATRIX_ROLES) {
      if (has("arenden.lista", r)) expect(cells[r], r).toBe(has("arenden.noteSave", r) ? "alla" : "las");
    }
    expect(cells.coach).toBe("alla");
    expect(cells.ekonom).toBe("nummer");
    expect(has("arenden.lista", "ekonom")).toBe(false);
    expect(has("ekonomi.case", "ekonom")).toBe(true);
    expect(cells.kommun_handlaggare).toBe("egna");
    expect(has("kommun.deltagareLista", "kommun_handlaggare")).toBe(true);
    // Policyn: en coach som inte är huvudcoach har full åtkomst i avtalets ärenden.
    const c = { contractId: "c-bot", leadCoachId: "u-annan", referrerId: "k-maria" };
    const coach = { userId: "u-amira", role: "coach" as const, contractIds: ["c-bot"] };
    expect(caseAccess(c, coach, { protectedIdentity: false, teamUserIds: [] })).toBe("full");
    expect(caseAccess(c, { userId: "u-eko", role: "ekonom", contractIds: ["c-bot"] }, { protectedIdentity: false, teamUserIds: [] })).toBe("billing");
  });

  it("Ser: coachanteckningar – de som skriver, de som läser och aldrig ekonomen eller kommunen", () => {
    for (const r of MATRIX_ROLES) {
      const expected: MatrixCell = has("arenden.noteSave", r) ? "ja" : has("arenden.kortTidslinje", r) ? "las" : "nej";
      expect(rowOf("notes").cells[r], r).toBe(expected);
    }
    expect(canSeeNotes("billing", "ekonom")).toBe(false);
    expect(rowOf("notes").cells.ekonom).toBe("nej");
  });

  it("Ser: rapporter – de som godkänner, de som läser och kommunens egna", () => {
    for (const r of MATRIX_ROLES) {
      const expected: MatrixCell =
        r === "kommun_handlaggare" ? (has("rapporter.reportOpen", r) ? "egna" : "nej") : has("rapporter.reportApprove", r) ? "ja" : has("rapporter.visa", r) ? "las" : "nej";
      expect(rowOf("reports").cells[r], r).toBe(expected);
    }
  });

  it("rollbeskrivningarna säger samma sak: bara ekonomen ser belopp, coachen alla ärenden, chefen kvitterar flaggor och signerar loggkontrollen", () => {
    const d = (k: MatrixRole) => ROLE_DESCRIPTIONS.find((x) => x.key === k);
    for (const x of ROLE_DESCRIPTIONS) {
      // "belopp" nämns bara som "inga belopp" – utom för ekonomen.
      const mentions = x.sees.toLowerCase().replace(/inga belopp/g, "").includes("belopp");
      expect(mentions, x.role).toBe(x.key === "ekonom");
    }
    expect(d("coach")?.sees).toMatch(/^Alla ärenden i avtalet/);
    expect(d("chef")?.does).toMatch(/Kvitterar flaggor/);
    expect(d("chef")?.does).toMatch(/signerar den månatliga loggkontrollen/);
    // Den som kvitterar flaggor enligt matrisen säger det i beskrivningen – och tvärtom.
    for (const r of MATRIX_ROLES) {
      const text = `${d(r)?.does ?? ""}`.toLowerCase();
      expect(text.includes("kvitterar flaggor"), r).toBe(rowOf("alerts").cells[r] === "ja");
    }
  });
});
