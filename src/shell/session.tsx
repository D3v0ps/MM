"use client";
// Inloggad användare. Riktiga appen: från inloggningen (Microsoft för MB, e-postkod för kommunen).
// Prototypen: från rollväljaren. Skärmarna läser bara useSession().
import { createContext, useContext, type ReactNode } from "react";
import type { Actor, Role } from "@/api/roles";

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

export type Session = {
  actor: Actor;
  user: SessionUser;
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
