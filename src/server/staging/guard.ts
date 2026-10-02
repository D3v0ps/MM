// Vem får läsa in testdatat på nytt (POST /api/staging/seed)? Ren funktion – testas utan server.
//   bara supabase-läget · bara med bekräftelse · bara inloggad · bara testare (profilens is_tester, även när testaren
//   agerar som en testperson) · bara i testmiljön (app_settings.environment = 'staging'). Databasen kontrollerar miljön igen.

export type SeedGuardInput = {
  backend: "memory" | "supabase";
  confirm: unknown;
  authenticated: boolean;
  /** identity.isTester: testare OCH testmiljö (canImpersonate i session-policy.ts). */
  isTester: boolean;
  environment: "staging" | "production";
};
export type SeedDenied = { status: 400 | 401 | 403 | 404; code: string; message: string };

export function seedGuard(i: SeedGuardInput): SeedDenied | null {
  if (i.backend !== "supabase") return { status: 404, code: "not_found", message: "Finns bara i testmiljön." };
  if (i.confirm !== true) return { status: 400, code: "invalid_request", message: "Bekräfta att allt som testats ska nollställas." };
  if (!i.authenticated) return { status: 401, code: "unauthenticated", message: "Du är inte inloggad." };
  if (!i.isTester || i.environment !== "staging") return { status: 403, code: "forbidden", message: "Bara testare i testmiljön kan läsa in testdata." };
  return null;
}
