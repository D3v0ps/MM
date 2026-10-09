import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // Klockan i testerna ska aldrig bero på maskinens tidszon.
    env: { TZ: "UTC" },
    // Paritets- och RLS-testerna tar 5–8 s när maskinen är upptagen (parallella körningar, CI) – inte fel i koden.
    testTimeout: 20000,
  },
});
