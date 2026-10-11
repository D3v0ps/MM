"use client";
// Filtret Nivå, Grupp och Tagg för coachens listor (coachmötet 2026-10-09) – samma val som i ärendelistan. Valen ligger i
// adressen (?niva=, ?grupp=, ?tagg= – bara id:n, aldrig namnen) och kombineras med listans egna filter. Visas inte för den
// som inte får läsa grupperingarna (frågan nekas – då finns inget att filtrera på).
import type { ReactNode } from "react";
import { matchesGroupingFilter } from "@/core/groupings";
import { useQuery } from "@/shell/backend";
import { useSession } from "@/shell/session";
import { useQueryPatch } from "@/shell/url-state";
import { Field, Select } from "@/ui";
import { GROUPING_READERS } from "@/core/groupings";
import { groupingFilterData } from "../api";

export type GroupingFilterState = {
  /** De tre valen (eller null när det inte finns några grupperingar att välja). */
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
  const level = pickId("niva", d?.levels);
  const group = pickId("grupp", d?.groups);
  const tag = pickId("tagg", d?.tags);
  const active = !!(level || group || tag);
  const matches = (caseId: string) => !active || matchesGroupingFilter(new Set(d?.byCase[caseId] ?? []), { level, group, tag });
  const fields =
    d && (d.levels.length || d.groups.length || d.tags.length) ? (
      <>
        {d.levels.length > 0 && (
          <Field label="Nivå" id="gf-niva">
            <Select value={level} onValueChange={(v) => patch({ niva: v || null })} placeholder="Alla nivåer" options={d.levels.map((g) => ({ value: g.id, label: g.name }))} />
          </Field>
        )}
        {d.groups.length > 0 && (
          <Field label="Grupp" id="gf-grupp">
            <Select value={group} onValueChange={(v) => patch({ grupp: v || null })} placeholder="Alla grupper" options={d.groups.map((g) => ({ value: g.id, label: g.name }))} />
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
