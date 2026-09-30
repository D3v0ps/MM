// PLATSHÅLLARE – användare och roller (profiles + memberships) -> Actor och persona-lista.
import type { Actor } from "@/api/roles";
import type { RawAccess } from "./memory";
import type { Tables } from "./schema";
import type { SessionUser } from "@/shell/session";

export type Persona = { actor: Actor; user: SessionUser };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- platshållare
export function listPersonas(_raw: RawAccess<Tables>): Persona[] {
  return [
    {
      actor: { userId: "u-amira", role: "coach", contractIds: ["c-bot"] },
      user: { id: "u-amira", name: "Amira Haddad", title: "Huvudcoach", email: "amira.haddad@miljonbemanning.se", orgName: "Miljonbemanning AB" },
    },
  ];
}
export function personaFor(raw: RawAccess<Tables>, userId: string, role?: Actor["role"]): Persona | null {
  const all = listPersonas(raw);
  return all.find((p) => p.actor.userId === userId && (!role || p.actor.role === role)) ?? all.find((p) => p.actor.userId === userId) ?? null;
}
