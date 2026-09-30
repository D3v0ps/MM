import { describe, expect, it } from "vitest";
import { seedGuard, type SeedGuardInput } from "./guard";

const OK: SeedGuardInput = { backend: "supabase", confirm: true, authenticated: true, isTester: true, environment: "staging" };

describe("POST /api/staging/seed – behörighet", () => {
  it("testare i testmiljön med bekräftelse får läsa in testdata", () => {
    expect(seedGuard(OK)).toBeNull();
  });
  it("nekas i alla andra fall", () => {
    expect(seedGuard({ ...OK, backend: "memory" })?.status).toBe(404);
    expect(seedGuard({ ...OK, confirm: undefined })?.status).toBe(400);
    expect(seedGuard({ ...OK, confirm: "true" })?.status).toBe(400);
    expect(seedGuard({ ...OK, authenticated: false })?.status).toBe(401);
    expect(seedGuard({ ...OK, isTester: false })).toMatchObject({ status: 403, message: "Bara testare i testmiljön kan läsa in testdata." });
    expect(seedGuard({ ...OK, environment: "production" })?.status).toBe(403);
  });
});
