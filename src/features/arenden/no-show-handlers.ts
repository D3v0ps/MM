// Hanterare: Deltagaren kom inte till första mötet (Karims beslut 2026-11-09, migration 0040). Registreras via ./handlers.ts.
//   Vem:        coach, samordnare och avtalsansvarig med full åtkomst (canEditCase – personen läses via behörigheten), samma som
//               Starta insatsen. Kommunen och ekonomen nekas av rollkontrollen och ser aldrig registreringen.
//   Regler:     noShowProblem i src/core/first-meeting.ts: ett bekräftat ärende utan startdatum, första mötet är bokat och har
//               varit (Stockholms tid), mötet är det som dialogen visade och är inte redan registrerat, orsaken krävs vid giltig
//               frånvaro (högst 300 tecken, inga personnummer).
//   Skrivning:  via ctx.repo (RLS): raden i first_meeting_no_shows. Databasen prövar ärendet, mötet och tiden igen (triggern
//               first_meeting_no_shows_check) och tillåter ett möte en gång (unikt index) – två samtidiga registreringar ger en rad.
//   Utskick:    inga. Ingen notifyReferrer, ingen notifyParticipant, inga notiser – kommunen får inget besked (Karims beslut).
//   Följder:    inga tillfällen och ingen närvaro skapas, inget faktureras och ingenting i närvarograden, rapporterna, resultatfilen,
//               bonusen, den automatiska närvaron eller spärren för Ändra startdatum ändras. Insatsen startas först när ett nytt
//               första möte är bokat (arenden.caseBookFirstMeeting – coachen också, efter registreringen; arenden.caseStart nekar
//               annars), och startdatumet ligger alltid efter dagen då deltagaren inte kom. Nyckeltalet Första möte inom en vecka
//               räknar det första bokade mötet (Karims beslut 2026-11-09) – registreringen ändrar det inte.
//   Logg:       case.first_meeting_no_show med id:n och slaget – aldrig orsaken (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import { handleCommand } from "@/api/server";
import { currentNoShow, NO_SHOW_REGISTRARS, noShowProblem } from "@/core/first-meeting";
import { fmtDateTime } from "@/core/time";
import { PolicyError, UniqueError } from "@/data/repo";
import type { FirstMeetingNoShow } from "@/data/schema";
import { canEditCase } from "../_shared/context";
import { caseFirstMeetingNoShow } from "./api";

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const code = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? "");
/** Databasen nekade raden: någon annan hann före (samma möte), ärendet ändrades under tiden eller behörigheten nekade. */
const refused = (e: unknown): boolean => e instanceof UniqueError || e instanceof PolicyError || ["23505", "23514", "42501"].includes(code(e));

handleCommand(caseFirstMeetingNoShow, { roles: NO_SHOW_REGISTRARS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", "Du kan inte registrera det i det här ärendet.");
  const table = ctx.repo.table("first_meeting_no_shows");
  const rows = await table.list({ caseId: c.id });
  const reason = (p.reason ?? "").trim();
  // Samma registrering igen (dubbelklick, svaret kom inte fram): egen, samma möte, samma slag och samma orsak – svaret som första
  // gången. Allt annat för ett registrerat möte stoppas av kontrollen (already).
  const cur = currentNoShow(c, rows);
  if (cur && cur.meetingAt === p.meetingAt && cur.registeredBy === ctx.actor.userId && cur.kind === p.kind && (cur.reason ?? "") === reason) {
    return ok({ noShowId: cur.id, kind: cur.kind });
  }
  const now = ctx.now();
  const problem = noShowProblem({ c, now, meetingAt: p.meetingAt, kind: p.kind, reason, rows });
  if (problem) return fail(problem.code, problem.text);
  const row: FirstMeetingNoShow = {
    id: ctx.newId("fmns"), caseId: c.id, contractId: c.contractId, meetingAt: p.meetingAt, kind: p.kind, reason: reason || null,
    registeredBy: ctx.actor.userId, registeredAt: now,
  };
  try {
    await table.insert(row);
  } catch (e) {
    if (!refused(e)) throw e;
    // Läs om: hann någon annan registrera mötet, eller ändrades ärendet (bokat om, startat)?
    const after = await ctx.repo.table("cases").get(c.id);
    const again = after ? currentNoShow(after, await table.list({ caseId: c.id })) : null;
    if (again) return fail("already", `Det är redan registrerat att deltagaren inte kom till mötet ${fmtDateTime(again.meetingAt)}.`);
    return fail("conflict", "Ärendet har ändrats under tiden, kanske av en kollega. Ladda om sidan och försök igen – inget har sparats.");
  }
  await ctx.audit({ action: "case.first_meeting_no_show", entity: "case", entityId: c.id, contractId: c.contractId, details: { caseId: c.id, noShowId: row.id, kind: row.kind } });
  return ok({ noShowId: row.id, kind: row.kind });
});
