"use client";
// Filtret Yrkesområde, Nivå och Tagg för coachens listor (coachmötet 2026-10-09; Karims beslut 2026-10-22: grupperna är
// yrkesområdena) – samma val som i ärendelistan. Valen ligger i adressen (?omrade=, ?niva=, ?tagg= – bara koder och id:n, aldrig
// namnen) och kombineras med listans egna filter. Visas inte för den som inte får läsa nivåerna (frågan nekas – då finns inget
// att filtrera på).
import type { ReactNode } from "react";
import { GROUPING_READERS, matchesGroupingFilter } from "@/core/groupings";
import { useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import { useQueryPatch } from "@/shell/url-state";
import { Field, Select } from "@/ui";
import { groupingFilterData } from "../api";

export type GroupingFilterState = {
  /** De tre valen (eller null när det inte finns något att välja). */
  fields: ReactNode;
  /** Något val är gjort. */
  active: boolean;
  /** Ärendet stämmer med valen (alltid sant utan val). */
  matches: (caseId: string) => boolean;
};

export function useGroupingFilter(query: URLSearchParams): GroupingFilterState {
  const { actor } = useSession();
  const patch = useQueryPatch();
  const q = useQuery(groupingFilterData, GROUPING_READERS.includes(actor.role) ? {} : null);
  const d = q.data;
  const pickId = (name: string, list: { id: string }[] | undefined) => (list?.some((g) => g.id === query.get(name)) ? (query.get(name) as string) : "");
  const area = d?.areas.some((a) => a.code === query.get("omrade")) ? (query.get("omrade") as string) : "";
  const level = pickId("niva", d?.levels);
  const tag = pickId("tagg", d?.tags);
  const active = !!(area || level || tag);
  const matches = (caseId: string) =>
    !active || ((!area || d?.areaByCase[caseId] === area) && matchesGroupingFilter(new Set(d?.byCase[caseId] ?? []), { level, tag }));
  const fields =
    d && (d.areas.length || d.levels.length || d.tags.length) ? (
      <>
        {d.areas.length > 0 && (
          <Field label="Yrkesområde" id="gf-omrade" help="Deltagarens yrkesområde – det är gruppen.">
            <Select value={area} onValueChange={(v) => patch({ omrade: v || null })} placeholder="Alla yrkesområden" options={d.areas.map((a) => ({ value: a.code, label: a.name }))} />
          </Field>
        )}
        {d.levels.length > 0 && (
          <Field label="Nivå" id="gf-niva">
            <Select value={level} onValueChange={(v) => patch({ niva: v || null })} placeholder="Alla nivåer" options={d.levels.map((g) => ({ value: g.id, label: g.name }))} />
          </Field>
        )}
        {d.tags.length > 0 && (
          <Field label="Tagg" id="gf-tagg">
            <Select value={tag} onValueChange={(v) => patch({ tagg: v || null })} placeholder="Alla taggar" options={d.tags.map((g) => ({ value: g.id, label: g.name }))} />
          </Field>
        )}
      </>
    ) : null;
  return { fields, active, matches };
}
