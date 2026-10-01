// Hanterare för synpunkter i testmiljön. Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
//
// Bara den inloggade testaren i testmiljön (ctx.actor.testerId, som servern sätter när databasen säger
// mm.auth_is_tester()) – oavsett vilken testperson testaren agerar som. Alla andra får 404: i produktion, i minnesläget och i
// prototypen finns funktionen inte. RLS (0017_synpunkter.sql) och policy.ts kontrollerar samma sak en gång till.
// Synpunkten sparas med rollen testaren agerar som och sidan (bara sökväg och id:n – sanitizeFeedbackPath igen här, servern
// litar aldrig på webbläsaren). Tid via ctx.now() (testtid i testmiljön), id via ctx.newId. Inga utskick. Revisionslogg
// utan text.
import { fail, ok } from "@/api/contract";
import { ApiError, handleCommand, handleQuery, type Ctx } from "@/api/server";
import { perspectiveOf } from "@/api/roles";
import { uniq } from "@/core/util";
import type { Feedback, FeedbackReply } from "@/data/schema";
import { feedbackList, feedbackReply, feedbackSetStatus, feedbackSubmit, type FeedbackView } from "./api";
import { perspectiveLabelOf, roleLabelOf, sanitizeFeedbackPath, sanitizeViewTitle } from "./model";

const NOT_AVAILABLE = "Synpunkter finns bara i testmiljön, för testare.";
const NOT_FOUND = "Synpunkten finns inte.";

/** Testarens egen profil – annars finns funktionen inte (404). */
function testerOf(ctx: Ctx): string {
  const id = ctx.actor.testerId;
  if (!id) throw new ApiError(404, "not_found", NOT_AVAILABLE);
  return id;
}

const newestFirst = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

handleQuery(feedbackList, {}, async (ctx): Promise<FeedbackView[]> => {
  const me = testerOf(ctx);
  const [items, replies] = await Promise.all([ctx.repo.table("feedback").list(), ctx.repo.table("feedback_replies").list()]);
  // ctx.system: namnen på testarna som skrivit (bara författarnas profiler). Testpersonen som testaren agerar som får inte
  // alltid läsa testarnas profiler (t.ex. deltagaren), men synpunkterna är testarnas egna.
  const authorIds = uniq([...items.map((x) => x.authorId), ...replies.map((r) => r.authorId)]);
  const profiles = authorIds.length ? await ctx.system.table("profiles").list({ id: { in: authorIds } }) : [];
  const names = new Map(profiles.map((p) => [p.id, p.fullName]));
  const nameOf = (id: string) => (id === me ? "Du" : names.get(id) || "En testare");
  const byFeedback = new Map<string, FeedbackReply[]>();
  for (const r of replies) byFeedback.set(r.feedbackId, [...(byFeedback.get(r.feedbackId) ?? []), r]);
  return [...items].sort(newestFirst).map((x) => ({
    id: x.id,
    type: x.type,
    priority: x.priority,
    text: x.text,
    status: x.status,
    role: x.role,
    roleLabel: roleLabelOf(x.role),
    perspective: perspectiveOf(x.role),
    perspectiveLabel: perspectiveLabelOf(x.role),
    path: x.path,
    viewTitle: x.viewTitle,
    createdAt: x.createdAt,
    authorName: nameOf(x.authorId),
    mine: x.authorId === me,
    replies: (byFeedback.get(x.id) ?? [])
      .sort((a, b) => -newestFirst(a, b))
      .map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, authorName: nameOf(r.authorId), mine: r.authorId === me })),
  }));
});

handleCommand(feedbackSubmit, {}, async (ctx, p) => {
  const me = testerOf(ctx);
  const path = sanitizeFeedbackPath(p.path);
  const row: Feedback = {
    id: ctx.newId("fb"),
    type: p.type,
    priority: p.priority,
    text: p.text,
    status: "ny",
    role: ctx.actor.role,
    path,
    viewTitle: path ? sanitizeViewTitle(p.viewTitle) : null,
    createdAt: ctx.now(),
    authorId: me,
    statusChangedAt: null,
    statusChangedBy: null,
  };
  await ctx.repo.table("feedback").insert(row);
  await ctx.audit({ action: "feedback.created", entity: "feedback", entityId: row.id, contractId: null, details: { type: row.type, priority: row.priority } });
  return ok({ id: row.id });
});

handleCommand(feedbackReply, {}, async (ctx, p) => {
  const me = testerOf(ctx);
  const fb = await ctx.repo.table("feedback").get(p.feedbackId);
  if (!fb) return fail("not_found", NOT_FOUND);
  const reply: FeedbackReply = { id: ctx.newId("fbr"), feedbackId: fb.id, text: p.text, createdAt: ctx.now(), authorId: me };
  await ctx.repo.table("feedback_replies").insert(reply);
  await ctx.audit({ action: "feedback.replied", entity: "feedback", entityId: fb.id, contractId: null, details: { replyId: reply.id } });
  return ok({ id: reply.id });
});

handleCommand(feedbackSetStatus, {}, async (ctx, p) => {
  const me = testerOf(ctx);
  const fb = await ctx.repo.table("feedback").get(p.feedbackId);
  if (!fb) return fail("not_found", NOT_FOUND);
  if (fb.status === p.status) return ok({});
  await ctx.repo.table("feedback").update(fb.id, { status: p.status, statusChangedAt: ctx.now(), statusChangedBy: me });
  await ctx.audit({ action: "feedback.status_changed", entity: "feedback", entityId: fb.id, contractId: null, details: { from: fb.status, to: p.status } });
  return ok({});
});
