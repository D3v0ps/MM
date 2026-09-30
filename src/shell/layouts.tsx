"use client";
// PLATSHÅLLARE – ersätts av riktiga layouter (MB:s arbetsyta med sidopanel, kommunens portal, deltagarens mobilvy, prototypens sidor).
import type { ReactNode } from "react";
import type { RouteMatch } from "./routes";

export function LayoutFor({ children }: { match: RouteMatch; children: ReactNode }) {
  return <main id="main">{children}</main>;
}
