// PLATSHÅLLARE – ersätts av typerna för alla tabeller i SPEC §6.1 (se docs/ARKITEKTUR.md).
import type { Repo } from "./repo";

export type Tables = {
  notifications_demo: { id: string };
};
export type TableName = keyof Tables & string;
export type AppRepo = Repo<Tables>;
