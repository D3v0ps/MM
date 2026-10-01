// Rutt-tabellen: varje område registreras på ett ställe (src/shell/route-table.ts, src/api/handlers.ts), och de publika
// sidorna (ingen inloggning) är exakt de som proxyn och servern släpper igenom (isPublicPagePath).
import { describe, expect, it } from "vitest";
import { registeredKeys } from "@/api/handlers";
import { routes as coachRoutes } from "@/features/coach/routes";
import { isPublicPagePath } from "@/server/session-policy";
import { notFoundMatch } from "./app";
import { APP_ROUTES } from "./route-table";
import { resolveRoute } from "./routes";

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

  it("röstområdets hanterare är registrerade via src/api/handlers.ts", () => {
    const keys = registeredKeys();
    for (const k of ["rost.link", "rost.send", "rost.sendStatus", "rost.uploadStart", "rost.caseVoice", "rost.linkSend", "rost.noteReview", "rost.notesSeen", "rost.pendingNotes"]) {
      expect(keys, k).toContain(k);
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
