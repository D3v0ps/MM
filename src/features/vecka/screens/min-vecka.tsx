"use client";
// Min vecka (/min-vecka) – startsidan för alla MB-roller (beslut 2026-10-06): samma upplägg som coachens Min vecka (förebilden),
// med rollens egna uppgifter. Varje roll använder bara frågor den redan har. Rollskärmarna ligger i sina egna områden och delar
// kitet i src/ui/vecka.tsx.
//
// Alla roller samtidigt (Karims beslut 7, 2026-10-09): den som har flera roller ser alla rollernas uppgifter på samma sida –
// en rolldel per roll (samordnare och avtalsansvarig delar en), i ordning efter vad som brådskar: delen med flest nyckeltal som
// kräver åtgärd (eller bevakas) överst, vid lika i den fasta ordningen nedan. Sidans rubrik, ögonbryn och ingress står en gång;
// varje del har rollens rubrik och knappar (src/ui/week-part.ts). Notiskortet står en gång, efter delarna.
import { useMemo, useState, type ComponentType } from "react";
import type { Role } from "@/api/roles";
import { AdminMinVeckaScreen } from "@/features/admin/screens/min-vecka";
import { MinVeckaScreen as CoachMinVeckaScreen } from "@/features/coach/screens/min-vecka";
import { EkonomMinVeckaScreen } from "@/features/ekonomi/screens/min-vecka";
import { SamMinVeckaScreen } from "@/features/inkorg/screens/min-vecka";
import { ChefMinVeckaScreen } from "@/features/ledning/screens/min-vecka";
import { UnreadNotices } from "@/features/notiser/screens/olasta";
import { useSession } from "@/shell/session";
import { Page, WeekPartContext, weekEyebrow, weekLead, type WeekPart } from "@/ui";
import { useWeekToday } from "../today";

type PartDef = { key: string; roles: readonly Role[]; label: (roles: readonly Role[]) => string; Screen: ComponentType };

/** Rolldelarna i fast ordning (vid lika brådska): det dagliga arbetet med deltagarna först. */
export const WEEK_PARTS: readonly PartDef[] = [
  { key: "coach", roles: ["coach"], label: () => "Huvudcoach", Screen: CoachMinVeckaScreen },
  {
    key: "samordning", roles: ["samordnare", "avtalsansvarig"], Screen: SamMinVeckaScreen,
    label: (rs) => (rs.includes("samordnare") && rs.includes("avtalsansvarig") ? "Samordning och avtalet" : rs.includes("avtalsansvarig") ? "Avtalet" : "Samordning"),
  },
  { key: "ledning", roles: ["chef"], label: () => "Ledning", Screen: ChefMinVeckaScreen },
  { key: "ekonomi", roles: ["ekonom"], label: () => "Ekonomi", Screen: EkonomMinVeckaScreen },
  { key: "admin", roles: ["admin"], label: () => "Administratör", Screen: AdminMinVeckaScreen },
];

/** Rolldelarna för rollerna (rollen handledare är vilande och har ingen). */
export const weekPartsFor = (roles: readonly Role[]): readonly PartDef[] => WEEK_PARTS.filter((p) => p.roles.some((r) => roles.includes(r)));

export function MinVeckaScreen() {
  const { actor } = useSession();
  const parts = weekPartsFor(actor.roles);
  // Rutten släpper bara in kollegornas roller (STAFF_ROLES) – rollen handledare är vilande (beslut 2026-10-09).
  if (!parts.length) return null;
  if (parts.length === 1) {
    const Only = parts[0].Screen;
    return <Only />;
  }
  return <CombinedWeek rolesKey={actor.roles.join(",")} />;
}

/** Brådskan per rolldel: summan av nyckeltalsrutornas brådska (src/ui/week-part.ts). */
type Urgency = Record<string, Record<string, number>>;
const scoreOf = (u: Urgency, key: string) => Object.values(u[key] ?? {}).reduce((a, b) => a + b, 0);

/** rolesKey = rollerna som text ("chef,coach"), så att delarna och deras sammanhang är stabila mellan renderingarna. */
function CombinedWeek({ rolesKey }: { rolesKey: string }) {
  const { user } = useSession();
  const today = useWeekToday();
  const [urgency, setUrgency] = useState<Urgency>({});
  const roles = useMemo(() => rolesKey.split(",") as Role[], [rolesKey]);
  const parts = useMemo(() => weekPartsFor(roles), [roles]);
  // Ett stabilt sammanhang per del (ändras det byts rapporteringen ut och rutorna rapporterar på nytt).
  const contexts = useMemo(
    () =>
      Object.fromEntries(
        parts.map((p): [string, WeekPart] => [
          p.key,
          {
            label: p.label(roles),
            idPrefix: p.key,
            report: (tile, weight) =>
              setUrgency((u) => {
                if ((u[p.key]?.[tile] ?? 0) === weight) return u;
                const own = { ...(u[p.key] ?? {}) };
                if (weight) own[tile] = weight;
                else delete own[tile];
                return { ...u, [p.key]: own };
              }),
          },
        ]),
      ),
    [parts, roles],
  );
  // Mest brådskande först, vid lika i den fasta ordningen. Delarna flyttas (key) – de laddas inte om.
  const ordered = parts.map((p, i) => ({ p, i })).sort((a, b) => scoreOf(urgency, b.p.key) - scoreOf(urgency, a.p.key) || a.i - b.i);
  return (
    <Page title="Min vecka" eyebrow={weekEyebrow(user, roles)} lead={weekLead(today)}>
      {ordered.map(({ p }) => (
        <WeekPartContext.Provider key={p.key} value={contexts[p.key]}>
          <p.Screen />
        </WeekPartContext.Provider>
      ))}
      <UnreadNotices />
    </Page>
  );
}
