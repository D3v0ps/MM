// Hanterare: Ändra tid för ett tillfälle (Karims beslut 2026-11-11). Registreras via ./handlers.ts.
//   Vem:        de som arbetar i ärendena (coach, samordnare, avtalsansvarig – samma roller som Lägg till tillfälle). Skrivningen går
//               via behörigheten (RLS activities_update, mm.work_on – samma regel i policy.ts). Kommunen, ekonomen, chefen och
//               systemadministratören nekas av rollkontrollen.
//   Regler:     activityMoveProblem i src/core/activity-move.ts. Ett tillfälle i en gruppaktivitet flyttas i aktivitetsvyn.
//   Skrivning:  en villkorad ändring av raden (Table.updateIf på tiden, längden och platsen som dialogen visade): två som flyttar
//               samtidigt – den andra får conflict och ingenting skrivs två gånger (inget andra meddelande). Villkoret läser bara
//               kolumner som inloggade får läsa i activities (USER_FILTER_COLUMNS har ingen gräns för tabellen – prövat i
//               src/data/supabase/villkorade-andringar.test.ts).
//   Deltagaren: notifyParticipant med mallen aktivitet_andrad (tid, plats och Miljonbemannings telefonnummer – aldrig namn,
//               ärendenummer eller aktivitetens namn; CLAUDE.md punkt 9), samma kanalval och samma uppgift till samordnaren när
//               ingen kanal når fram som inbjudningarna. Öppna uppgifter att ringa om den gamla tiden stängs.
//   Logg:       activity.moved med id:n och den gamla och nya tiden och längden – inga namn och ingen plats (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand } from "@/api/server";
import { activityMoveMonths, activityMoveProblem } from "@/core/activity-move";
import { dayOf } from "@/core/time";
import { looksLikePnr } from "@/core/validation";
import { closeActivityTasks, notifyParticipant } from "../_shared/participant-notify";
import { activityMove } from "./api";
import { billingForMonths } from "./start-handlers";

/** De som arbetar i ärendena (samma som arenden.activityAdd och policyns CASE_WORKERS). */
const MOVERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
const NOT_FOUND = "Tillfället finns inte, eller så har du inte behörighet att se det.";
const CONFLICT = "Tillfället har ändrats under tiden, kanske av en kollega. Ladda om sidan – inget har sparats.";
/** Platsen står i meddelandet till deltagaren – samma kontroll i Lägg till tillfälle och veckoplanen. */
export const PLACE_PNR = "Platsen ser ut att innehålla ett personnummer. Skriv bara platsen.";

handleCommand(activityMove, { roles: MOVERS }, async (ctx, p) => {
  const acts = ctx.repo.table("activities");
  const a = await acts.get(p.activityId);
  if (!a) return fail("not_found", NOT_FOUND);
  const c = await ctx.repo.table("cases").get(a.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Ett tillfälle i en gruppaktivitet hör till aktiviteten: tiden ändras för alla deltagare i aktivitetsvyn.
  if (a.groupActivityId) return fail("group_activity", "Tillfället hör till en gruppaktivitet. Öppna aktiviteten och ändra tiden där.");
  if (c.status !== "active" && c.status !== "paused") return fail("wrong_status", "Tiden kan ändras när insatsen pågår.");
  if (a.startsAt !== p.expectedStartsAt) return fail("conflict", CONFLICT);
  const location = p.location === undefined ? a.location : p.location.trim();
  if (!location) return fail("location", "Skriv plats.");
  // Platsen står i SMS:et och mejlet till deltagaren (CLAUDE.md punkt 9): aldrig ett personnummer.
  if (looksLikePnr(location)) return fail("location", PLACE_PNR);
  const to = { startsAt: p.startsAt, durationMin: p.durationMin };
  if (to.startsAt === a.startsAt && to.durationMin === a.durationMin && location === a.location) return ok({ changed: false, notified: null });
  const now = ctx.now();
  const day = dayOf(to.startsAt);
  const [registered, others, billing] = await Promise.all([
    ctx.repo.table("attendance").first({ activityId: a.id }),
    acts.list({ caseId: c.id, startsAt: { gte: `${day}T00:00`, lte: `${day}T23:59` } }),
    // ctx.system i billingForMonths: bara om månaden är fakturerad eller godkänd – inga belopp lämnas ut.
    billingForMonths(ctx, c, activityMoveMonths(a.startsAt, to.startsAt)),
  ]);
  const problem = activityMoveProblem({ c, a, to, now, registered: !!registered, others, billing });
  if (problem) return fail(problem.code, problem.text);
  // Kontroll och skrivning i ett steg: bara om raden fortfarande har tiden, längden och platsen som lästes.
  const moved = await acts.updateIf(a.id, { startsAt: a.startsAt, durationMin: a.durationMin, location: a.location }, { startsAt: to.startsAt, durationMin: to.durationMin, location });
  if (!moved) return fail("conflict", CONFLICT);
  await ctx.audit({
    action: "activity.moved", entity: "activity", entityId: a.id, contractId: c.contractId,
    details: { caseId: c.id, from: a.startsAt, to: to.startsAt, fromDurationMin: a.durationMin, toDurationMin: to.durationMin, ...(location !== a.location ? { locationChanged: true } : {}) },
  });
  // Bara längden ändrad: deltagaren får inget meddelande (tid och plats är desamma) och uppgifterna gäller som förut.
  const slotChanged = to.startsAt !== a.startsAt || location !== a.location;
  if (!slotChanged) return ok({ changed: true, notified: null });
  // Den gamla tiden gäller inte längre: en öppen uppgift att ringa om den (en tidigare ändring) stängs.
  await closeActivityTasks(ctx, c, { when: a.startsAt, place: a.location }, "Tillfället har fått ny tid.");
  if (!p.notify) return ok({ changed: true, notified: null });
  const r = await notifyParticipant(ctx, { caseId: c.id, template: "aktivitet_andrad", when: to.startsAt, place: location, previous: a.startsAt });
  return ok({ changed: true, notified: r.summary });
});
