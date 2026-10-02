// POST /api/session/impersonate { userId, role } – testaren väljer testperson. Bara testare, bara i testmiljön.
// Valet sparas i tester_sessions; RLS (mm.current_profile_id()) och hanterarna ser sedan testpersonen.
// Egen persona = sluta agera som testperson.
import { z } from "zod";
import { appRepo } from "@/data/supabase";
import { mayImpersonate } from "@/server/identity";
import { liveSession } from "@/server/live";
import { BACKEND } from "@/server/runtime";

const Body = z.object({ userId: z.string().min(1).max(100), role: z.string().min(1).max(40) });

export async function POST(request: Request) {
  if (BACKEND !== "supabase") return Response.json({ code: "not_found" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ code: "invalid_request", message: "Ogiltig begäran." }, { status: 400 });
  const { userId, role } = parsed.data;
  try {
    const s = await liveSession();
    const id = s.identity;
    if (!id || !s.authUserId) return Response.json({ code: "unauthenticated", message: "Du är inte inloggad." }, { status: 401 });
    if (!id.isTester) return Response.json({ code: "forbidden", message: "Bara testare i testmiljön kan byta testperson." }, { status: 403 });

    const self = id.personas.find((p) => p.userId === id.self.id);
    const backToSelf = userId === id.self.id && (!self || role === self.role);
    if (!backToSelf && !mayImpersonate(id, { userId, role })) {
      return Response.json({ code: "invalid_request", message: "Testpersonen finns inte." }, { status: 400 });
    }
    // Service role: tabellen är bara till för servern. Ta bort det gamla valet och spara det nya.
    const del = await s.service.from("tester_sessions").delete().eq("auth_user_id", s.authUserId);
    if (del.error) throw new Error(`tester_sessions (${del.error.code})`);
    if (!backToSelf) {
      const ins = await s.service.from("tester_sessions").insert({ auth_user_id: s.authUserId, profile_id: userId, role });
      if (ins.error) throw new Error(`tester_sessions (${ins.error.code})`);
    }
    await appRepo(s.service)
      .table("audit_log")
      .insert({
        id: `log-${crypto.randomUUID()}`,
        occurredAt: s.now,
        actorId: id.self.id,
        action: backToSelf ? "tester.impersonate_end" : "tester.impersonate",
        entity: "profile",
        entityId: backToSelf ? id.self.id : userId,
        contractId: null,
        details: backToSelf ? {} : { role },
      });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("testperson-fel", e instanceof Error ? e.message.replace(/[^\w ()_-]/g, "") : "okänt");
    return Response.json({ code: "server_error", message: "Testpersonen kunde inte väljas. Försök igen." }, { status: 500 });
  }
}
