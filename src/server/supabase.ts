// Supabase-klienter på servern. Webbläsaren pratar aldrig direkt med Supabase – allt går via Next.js (arn1).
//   userClient()    användarens session från kakorna (@supabase/ssr). RLS gäller. Används för ctx.repo och inloggningen.
//   serviceClient() service role – bara för systemsteg (ctx.system, revisionslogg, inloggningens uppslag). Kringgår RLS.
//   anonClient()    utan session – för att skicka inloggningskoden.
import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { secureCookies, supabaseEnv } from "./config";

/** Supabase-sessionens kakor: httpOnly (webbläsarens JavaScript behöver dem inte), lax, säkra i drift. */
export const authCookieOptions = (): CookieOptions => ({ path: "/", sameSite: "lax", httpOnly: true, secure: secureCookies() });

const noPersist = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

const g = globalThis as unknown as { __mmService?: SupabaseClient; __mmAnon?: SupabaseClient };

export function serviceClient(): SupabaseClient {
  if (g.__mmService) return g.__mmService;
  const { url, serviceKey } = supabaseEnv();
  if (!serviceKey) throw new Error("SUPABASE_SECRET_KEY (eller SUPABASE_SERVICE_ROLE_KEY) saknas");
  return (g.__mmService = createClient(url, serviceKey, noPersist));
}

export function anonClient(): SupabaseClient {
  if (g.__mmAnon) return g.__mmAnon;
  const { url, anonKey } = supabaseEnv();
  return (g.__mmAnon = createClient(url, anonKey, noPersist));
}

/** Ny klient per förfrågan (krav från @supabase/ssr). Kan skriva kakor i rutthanterare. */
export async function userClient(): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseEnv();
  const jar = await cookies();
  return createServerClient(url, anonKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          // Kakor kan inte skrivas under rendering – proxy.ts förnyar sessionen i stället.
        }
      },
    },
  });
}
