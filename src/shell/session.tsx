"use client";
// Inloggad användare. Riktiga appen: från inloggningen (Microsoft för MB, e-postkod för kommunen).
// Prototypen: från rollväljaren. Skärmarna läser bara useSession().
import { createContext, useContext, type ReactNode } from "react";
import type { Actor, Role } from "@/api/roles";
import type { FeedbackPort } from "@/features/synpunkter/api";

export type SessionUser = {
  id: string;
  name: string;
  title: string;
  email: string;
  orgName: string;
  unit?: string | null;
};
/** Valbar testperson (prototypen och utvecklingsläget). */
export type PersonaOption = { userId: string; role: Role; name: string; title: string; isDefaultForRole?: boolean };

/** Resultat av inloggningssteg. Felkoderna visas med text till användaren (aldrig om adressen finns eller inte). */
export type AuthResult =
  | { ok: true }
  | { ok: false; error: "invalid_email" | "not_invited" | "invalid_code" | "expired" | "too_many_attempts" | "rate_limited" | "error"; message: string };

/**
 * Inloggning med e-post och sexsiffrig kod (SPEC §4). Riktiga appen: Supabase Auth via /api/auth/*.
 * Prototypen: simulerad – koden visas i en förklaring och inloggningen byter testperson.
 * Microsoft-inloggning för MB-personal läggs till som ett eget steg (Entra) när appregistreringen finns.
 */
export type AuthPort = {
  kind: "demo" | "supabase";
  sendCode(email: string): Promise<AuthResult>;
  verifyCode(email: string, code: string): Promise<AuthResult>;
  signOut(): Promise<void>;
};

export type Session = {
  /** false = inte inloggad. Då finns bara publika sidor (inloggning och pulslänk); actor är en tom platshållare. */
  authenticated?: boolean;
  actor: Actor;
  user: SessionUser;
  auth?: AuthPort;
  /** Staging: den inloggade testaren får agera som testpersoner (aldrig i produktion). */
  isTester?: boolean;
  /** Var appen körs: "memory" = prototypen och utvecklingsläget, "staging" = testmiljön, "production" = drift. */
  environment?: "memory" | "staging" | "production";
  /**
   * Bara testare i testmiljön: läs in testdatat på nytt (allt som testats nollställs, sidan laddas om när det är klart).
   * Löses bara vid fel – annars laddas sidan om.
   */
  reloadTestData?: () => Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * Bara testare i testmiljön: "Lämna synpunkt" och listan "Alla synpunkter" (src/features/synpunkter). Saknas för alla
   * andra, i produktion och i prototypen (prototypen har sin egen feedback i claude.ai).
   */
  feedback?: FeedbackPort;
  /**
   * Begränsad testare i testmiljön (src/api/tester-access.ts – räknas på servern): inga priser, belopp, fakturaunderlag,
   * interna mål eller avtalssidan. Menyn döljer Avtal och Ekonomi, startsidan byts och skärmarna visar "Visas inte för testare".
   * Saknas (false) för alla andra, i produktion och i prototypen.
   */
  hidesCommercial?: boolean;
  /** Bara prototypen och utvecklingsläget: testpersoner att välja mellan. */
  personas?: PersonaOption[];
  /** Bara prototypen: byt roll/persona. */
  switchRole?: (role: Role, userId?: string) => void;
  signOut?: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("SessionProvider saknas");
  return s;
}
export const useRole = (): Role => useSession().actor.role;
export const useAuth = (): AuthPort | undefined => useSession().auth;
export const isAuthenticated = (s: Session): boolean => s.authenticated !== false;

/** Platshållare för en besökare som inte är inloggad. Rollen "deltagare" når bara publika sidor. */
export const ANONYMOUS: Pick<Session, "authenticated" | "actor" | "user"> = {
  authenticated: false,
  actor: { userId: "", role: "deltagare", contractIds: [] },
  user: { id: "", name: "", title: "", email: "", orgName: "" },
};
