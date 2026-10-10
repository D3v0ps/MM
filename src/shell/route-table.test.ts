// Rutt-tabellen: varje område registreras på ett ställe (src/shell/route-table.ts, src/api/handlers.ts), och de publika
// sidorna (ingen inloggning) är exakt de som proxyn och servern släpper igenom (isPublicPagePath).
import { describe, expect, it } from "vitest";
import { registeredKeys } from "@/api/handlers";
import { ROLES, STAFF_ROLES, SUPPLIER_ROLES } from "@/api/roles";
import { routes as coachRoutes } from "@/features/coach/routes";
import { isPublicPagePath } from "@/server/session-policy";
import { notFoundMatch } from "./app";
import { COMMON_NAV, navFor, NOTIFICATIONS_ITEM } from "./nav-config";
import { APP_ROUTES } from "./route-table";
import { resolveRoute, START_PATH } from "./routes";

/** Exempelsökväg för ett mönster: "/rost/:token?" -> "/rost/abc12345". */
const sample = (pattern: string) => pattern.replace(/:[A-Za-z]+\??/g, "abc12345");

describe("rutt-tabellen", () => {
  it("deltagarens inspelningslänk /rost/:token? är publik, i pulslayouten och registrerad en gång (inte via coachområdet)", () => {
    const rost = APP_ROUTES.filter((r) => r.path === "/rost/:token?");
    expect(rost).toHaveLength(1);
    expect(rost[0]).toMatchObject({ public: true, area: "puls", roles: ["deltagare"] });
    expect(coachRoutes.some((r) => r.path.startsWith("/rost"))).toBe(false);
    expect(resolveRoute(APP_ROUTES, "/rost/rost-abc123")?.route.path).toBe("/rost/:token?");
    expect(resolveRoute(APP_ROUTES, "/rost")?.route.path).toBe("/rost/:token?");
  });

  it("alla publika rutter släpps igenom utan inloggning (isPublicPagePath) – och inga andra", () => {
    const pub = APP_ROUTES.filter((r) => r.public);
    expect(pub.map((r) => r.path).sort()).toEqual(["/logga-in", "/portal/logga-in", "/puls/:token?", "/rost/:token?"].sort());
    for (const r of pub) {
      expect(isPublicPagePath(sample(r.path)), r.path).toBe(true);
      expect(isPublicPagePath(r.path.replace(/\/:[A-Za-z]+\?$/, "")), r.path).toBe(true);
    }
    for (const r of APP_ROUTES.filter((x) => !x.public)) expect(isPublicPagePath(sample(r.path)), r.path).toBe(false);
  });

  it("rapportbyggaren: ny och resultatfil före :savedReportId; kommunens chefsadresser leder till startsidan (beslut 2026-10-07)", () => {
    expect(resolveRoute(APP_ROUTES, "/rapportbyggare")?.route.title).toBe("Rapportbyggare");
    expect(resolveRoute(APP_ROUTES, "/rapportbyggare/ny")?.route.path).toBe("/rapportbyggare/ny");
    expect(resolveRoute(APP_ROUTES, "/rapportbyggare/resultatfil")?.route.path).toBe("/rapportbyggare/resultatfil");
    expect(resolveRoute(APP_ROUTES, "/rapportbyggare/sr-seed-mb")?.route).toMatchObject({ path: "/rapportbyggare/:savedReportId", roles: ["samordnare", "avtalsansvarig", "chef"], area: "mb" });
    // De gamla adresserna för kommunens chef finns kvar som omdirigeringar till /portal (gamla mejl och bokmärken).
    for (const old of ["/portal/resultat", "/portal/resultat/rapporter", "/portal/resultat/rapporter/sr-seed-kommun", "/portal/bestallarrapport"]) {
      const r = resolveRoute(APP_ROUTES, old)?.route;
      expect(r?.roles, old).toEqual(["kommun_handlaggare"]);
      expect(String((r?.screen as { displayName?: string } | undefined)?.displayName), old).toBe("Redirect(/portal)");
    }
    expect(resolveRoute(APP_ROUTES, "/portal/mina-uppgifter")?.route.title).toBe("Mina uppgifter");
    const keys = registeredKeys();
    for (const k of ["rapporter.byggKatalog", "rapporter.byggForhandsvisning", "rapporter.byggExport", "rapporter.sparadeLista", "rapporter.sparad", "rapporter.sparadSpara", "rapporter.sparadDela", "rapporter.sparadArkivera", "rapporter.resultatfilForhandsvisning", "rapporter.resultatfilExport"]) {
      expect(keys, k).toContain(k);
    }
    for (const k of ["kommun.delade", "kommun.delad", "kommun.deladExport", "kommun.chef", "kommun.resultatExport", "kommun.resultatForhandsvisning", "inkorg.phoneForm", "inkorg.linkPhoneOrder"]) {
      expect(keys, k).not.toContain(k);
    }
  });

  it("röstområdets hanterare är registrerade via src/api/handlers.ts", () => {
    const keys = registeredKeys();
    for (const k of ["rost.link", "rost.send", "rost.sendStatus", "rost.uploadStart", "rost.caseVoice", "rost.linkSend", "rost.noteReview", "rost.notesSeen", "rost.pendingNotes"]) {
      expect(keys, k).toContain(k);
    }
  });
});

describe("Min vecka och menyn (beslut 2026-10-06)", () => {
  const now = "2027-02-01T09:12";

  it("/min-vecka finns för alla MB-roller och är startsidan för dem", () => {
    const m = resolveRoute(APP_ROUTES, "/min-vecka");
    expect(m?.route).toMatchObject({ path: "/min-vecka", title: "Min vecka", area: "mb" });
    expect([...(m?.route.roles ?? [])].sort()).toEqual([...STAFF_ROLES].sort());
    expect(APP_ROUTES.filter((r) => r.path === "/min-vecka")).toHaveLength(1);
    for (const role of SUPPLIER_ROLES) expect(START_PATH[role], role).toBe("/min-vecka");
  });

  it("/start leder vidare till Min vecka – för alla MB-roller (skarp drift 2026-10-08: en gammal länk ger aldrig 'ingen behörighet')", () => {
    const m = resolveRoute(APP_ROUTES, "/start");
    expect(m?.route).toMatchObject({ path: "/start", title: "Min vecka", area: "mb" });
    expect([...(m?.route.roles ?? [])].sort()).toEqual([...STAFF_ROLES].sort());
  });

  it("de gamla startsidorna finns kvar – handledarens lista är borttagen med rollen (Karims beslut 2026-10-09)", () => {
    for (const [to, role] of [["/ledning", "chef"], ["/ekonomi", "ekonom"], ["/admin/anvandare", "admin"]] as const) {
      expect(resolveRoute(APP_ROUTES, to)?.route.roles, to).toContain(role);
    }
    expect(resolveRoute(APP_ROUTES, "/handledare")).toBeNull();
  });

  it("den vilande rollen handledare når ingen sida och ingen kollega kan få den (STAFF_ROLES)", () => {
    expect(STAFF_ROLES).not.toContain("handledare");
    expect(SUPPLIER_ROLES).toContain("handledare");
    // Sidor för alla roller (publika sidor och /diagnos) undantagna.
    for (const r of APP_ROUTES.filter((x) => !x.public && x.roles.length < ROLES.length)) expect(r.roles, r.path).not.toContain("handledare");
    expect(navFor("handledare", { now })).toEqual([]);
  });

  it("menyn visar aldrig något som rollen inte når: varje menyval finns i rollens rutter", () => {
    for (const role of STAFF_ROLES) {
      const items = [NOTIFICATIONS_ITEM, ...navFor(role, { now }).flatMap((g) => g.items)];
      for (const it of items) {
        const m = resolveRoute(APP_ROUTES, it.to);
        expect(m, `${role}: ${it.to} saknar rutt`).not.toBeNull();
        expect(m?.route.roles, `${role}: ${it.to}`).toContain(role);
      }
    }
  });

  it("den gemensamma gruppen: ett val visas för exakt de roller som når sidan", () => {
    for (const c of COMMON_NAV) {
      for (const role of STAFF_ROLES) {
        const it = c.item(role);
        const reaches = !!resolveRoute(APP_ROUTES, it.to)?.route.roles.includes(role);
        expect(c.roles.includes(role), `${it.to} för ${role}`).toBe(reaches);
        const shown = navFor(role, { now })[0].items.some((x) => x.to === it.to);
        expect(shown, `${it.to} i menyn för ${role}`).toBe(reaches);
      }
    }
  });
});

describe("Sidan finns inte", () => {
  it("visas i rätt layout: publika länkar (puls och /rost) i pulslayouten, portalen i portalen, resten i MB", () => {
    expect(notFoundMatch("/rost/a/b").route.area).toBe("puls");
    expect(notFoundMatch("/rost").route.area).toBe("puls");
    expect(notFoundMatch("/puls/a/b").route.area).toBe("puls");
    expect(notFoundMatch("/portal/okand").route.area).toBe("portal");
    expect(notFoundMatch("/rostx").route.area).toBe("mb");
    expect(notFoundMatch("/okand").route.area).toBe("mb");
  });
});
