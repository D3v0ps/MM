"use client";
// Min vecka (/min-vecka) – startsidan för alla MB-roller (beslut 2026-10-06): samma upplägg som coachens Min vecka (förebilden),
// med rollens egna uppgifter. Varje roll använder bara frågor den redan har. Rollskärmarna ligger i sina egna områden och delar
// kitet i src/ui/vecka.tsx.
//
// Alla roller samtidigt (Karims beslut 7, 2026-10-09): den som har flera roller ser alla rollernas uppgifter på samma sida –
// en rolldel per roll (samordnare och avtalsansvarig delar en), i ordning efter vad som brådskar: delen med flest nyckeltal som
// kräver åtgärd (eller bevakas) överst, vid lika i den fasta ordningen nedan. Ordningen bestäms en gång per besök och står
// sedan kvar medan man arbetar (CombinedWeek). Sidans rubrik, ögonbryn och ingress står en gång;
// varje del har rollens rubrik och knappar (src/ui/week-part.ts). Notiskortet står en gång, efter delarna.
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
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

export type PartDef = { key: string; roles: readonly Role[]; label: (roles: readonly Role[]) => string; Screen: ComponentType };

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
export type Urgency = Record<string, Record<string, number>>;
const scoreOf = (u: Urgency, key: string) => Object.values(u[key] ?? {}).reduce((a, b) => a + b, 0);
/** Delarnas ordning: mest brådskande först, vid lika i den fasta ordningen (delarnas ordning i listan). */
export const orderParts = (keys: readonly string[], u: Urgency): string[] =>
  keys.map((k, i) => ({ k, i })).sort((a, b) => scoreOf(u, b.k) - scoreOf(u, a.k) || a.i - b.i).map((x) => x.k);

/**
 * Hur länge sidan väntar på att alla delar har rapporterat sin brådska innan ordningen bestäms ändå (en del utan nyckeltal,
 * en fråga som dröjer).
 */
export const ORDER_WAIT_MS = 3000;

/**
 * rolesKey = rollerna som text ("chef,coach"), så att delarna och deras sammanhang är stabila mellan renderingarna.
 * defs = rolldelarna (standard WEEK_PARTS – testerna skickar in egna).
 *
 * Ordningen bestäms EN gång per besök: när alla delar har rapporterat sin första brådska (deras nyckeltal har laddats), vid
 * den första handlingen på sidan (tangent eller klick) eller efter ORDER_WAIT_MS – det som kommer först. Sedan står den kvar,
 * också när brådskan ändras av det man gör (en kvitterad flagga, en registrerad närvaro): annars flyttade sidan avsnittet man
 * arbetar i, och fokus som sätts efter en handling (t.ex. nästa flagga) kunde hamna i en del som just flyttats. Innan ordningen
 * är bestämd står delarna i den fasta ordningen.
 */
export function CombinedWeek({ rolesKey, defs = WEEK_PARTS }: { rolesKey: string; defs?: readonly PartDef[] }) {
  const { user } = useSession();
  const today = useWeekToday();
  const roles = useMemo(() => rolesKey.split(",") as Role[], [rolesKey]);
  const parts = useMemo(() => defs.filter((p) => p.roles.some((r) => roles.includes(r))), [defs, roles]);
  const keys = useMemo(() => parts.map((p) => p.key), [parts]);
  const [state, setState] = useState<OrderState>({ urgency: {}, reported: [], frozen: null });
  // Bestäm ordningen (en gång): efter brådskan som den är nu.
  const freeze = useCallback(() => setState((s) => (s.frozen ? s : { ...s, frozen: orderParts(keys, s.urgency) })), [keys]);
  // Ett stabilt sammanhang per del (ändras det byts rapporteringen ut och rutorna rapporterar på nytt).
  const contexts = useMemo(
    () =>
      Object.fromEntries(
        parts.map((p): [string, WeekPart] => [
          p.key,
          {
            label: p.label(roles),
            idPrefix: p.key,
            report: (tile, weight) => {
              setState((s) => {
                const reported = s.reported.includes(p.key) ? s.reported : [...s.reported, p.key];
                if ((s.urgency[p.key]?.[tile] ?? 0) === weight) return reported === s.reported ? s : { ...s, reported };
                const own = { ...(s.urgency[p.key] ?? {}) };
                if (weight) own[tile] = weight;
                else delete own[tile];
                return { ...s, reported, urgency: { ...s.urgency, [p.key]: own } };
              });
              // När alla delar har rapporterat: ordningen bestäms när delens alla rutor har rapporterat (de gör det i samma
              // omgång, före nästa makrouppgift).
              window.setTimeout(() => setState((s) => (!s.frozen && keys.every((k) => s.reported.includes(k)) ? { ...s, frozen: orderParts(keys, s.urgency) } : s)), 0);
            },
          },
        ]),
      ),
    [parts, roles, keys],
  );
  useEffect(() => {
    const t = window.setTimeout(freeze, ORDER_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [freeze]);
  const { frozen } = state;
  // Delar som inte finns i den bestämda ordningen (rollerna ändrades under besöket) står sist, i den fasta ordningen.
  const order = frozen ? [...frozen.filter((k) => keys.includes(k)), ...keys.filter((k) => !frozen.includes(k))] : keys;
  const byKey = new Map(parts.map((p) => [p.key, p]));
  return (
    <div className="contents" onKeyDownCapture={freeze} onPointerDownCapture={freeze} data-week-order={frozen ? "fixed" : "pending"}>
      <Page title="Min vecka" eyebrow={weekEyebrow(user, roles)} lead={weekLead(today)}>
        {order.map((k) => {
          const p = byKey.get(k)!;
          return (
            <WeekPartContext.Provider key={p.key} value={contexts[p.key]}>
              <p.Screen />
            </WeekPartContext.Provider>
          );
        })}
        <UnreadNotices />
      </Page>
    </div>
  );
}

/** Brådskan per del och ruta, delarna som har rapporterat och den bestämda ordningen (null = inte bestämd än). */
type OrderState = { urgency: Urgency; reported: readonly string[]; frozen: readonly string[] | null };
