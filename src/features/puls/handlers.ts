// Hanterare för området puls (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
// Källa: prototyp/src/views/admin.js (puls.svar och pulse.submit).
//
// Deltagaren har ingen användare – engångslänken är behörigheten. Länken slås upp med ctx.system (systemsteg: pulslänkens
// token, se src/data/policy.ts), och bara länkens läge lämnas ut. I supabase-läget är deltagaren databasrollen anon, som
// inte har några rättigheter alls. Därför skriver hanteraren allt som svaret ger upphov till (svaret, att länken är använd,
// uppgiften till samordnaren och revisionsloggen) via ctx.system – ett systemsteg som motsvarar en security definer-funktion
// och som bara körs efter att token kontrollerats (hash, giltighet, oanvänd, inte skyddat ärende). Lågt betyg till chefen är
// en härledd flagga (src/core/alerts.ts) som chefen läser ur pulse_responses med sin egen behörighet.
// Coachen ser aldrig enskilda svar (bara aggregat från avtalets minsta antal).
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { diffDays, fmtDate } from "@/core/time";
import { PULSE_PRIORITIES, type PulseInvite, type PulsePriority, type PulseScore } from "@/data/schema";
import { sha256Hex } from "@/features/rost/sha256";
import { pulseLink, pulseSubmit, type PulseLinkState } from "./api";
import { PULSE_LANGS, type PulseLang } from "./texts";

/**
 * SHA-256 av token (hex) – samma som pulse_invites.tokenHash. Web Crypto när det finns, annars samma beräkning i ren
 * TypeScript (sha256Hex, som röstlänken i voiceTokenHash) – prototypen kan öppnas från en sida utan https, där Web Crypto
 * saknas, och länken ska ändå fungera.
 */
export async function pulseTokenHash(token: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Hex(token);
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Länken som besöket gäller. ctx.system: deltagaren saknar läsbehörighet till pulse_invites – token (hash) är behörigheten.
 * Utan token: prototypens exempellänk (demo_tags "pi-demo", bara testdata). Länkar till ärenden med skyddade
 * personuppgifter räknas som saknade – de ska aldrig finnas (CLAUDE.md punkt 8).
 */
async function inviteFor(ctx: Ctx, token: string | undefined): Promise<(PulseInvite & { location: string }) | null> {
  let inv: PulseInvite | null = null;
  if (token !== undefined) {
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(token)) return null;
    inv = await ctx.system.table("pulse_invites").first({ tokenHash: await pulseTokenHash(token) });
  } else {
    const tag = await ctx.system.table("demo_tags").get("pi-demo");
    const id = tag?.entity === "pulse_invites" ? tag.entityIds[0] : null;
    inv = id ? await ctx.system.table("pulse_invites").get(id) : null;
  }
  if (!inv) return null;
  const c = await ctx.system.table("cases").get(inv.caseId);
  const person = c ? await ctx.system.table("persons").get(c.personId) : null;
  if (!c || !person || person.protectedIdentity) return null;
  return { ...inv, location: c.location };
}

const stateOf = (inv: PulseInvite | null, now: string): PulseLinkState => (!inv ? "missing" : inv.usedAt ? "used" : now > inv.expiresAt ? "expired" : "open");
const langOf = (l: string | null | undefined): PulseLang => ((PULSE_LANGS as readonly string[]).includes(l ?? "") ? (l as PulseLang) : "sv");

handleQuery(pulseLink, { roles: ["deltagare"] }, async (ctx, p) => {
  const inv = await inviteFor(ctx, p.token);
  return { state: stateOf(inv, ctx.now()), language: langOf(inv?.language), days: inv ? diffDays(inv.sentAt, inv.expiresAt) : 7, location: inv?.location || "Alby" };
});

const isScore = (v: unknown): v is PulseScore => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;

/** Pulssvar via engångslänk. "Ja" på fråga 5 blir en uppgift till samordnaren. */
handleCommand(pulseSubmit, { roles: ["deltagare"] }, async (ctx, p) => {
  const inv = await inviteFor(ctx, p.token);
  if (!inv) return fail("not_found", "Länken fungerar inte.");
  if (inv.usedAt) return fail("used", "Länken är redan använd.");
  const now = ctx.now();
  if (now > inv.expiresAt) return fail("expired", "Länken har gått ut.");
  const a = p.answers;
  if (!isScore(a.q1) || !isScore(a.q2) || !isScore(a.q3) || !(PULSE_PRIORITIES as readonly string[]).includes(a.q4 ?? "") || (a.q5 !== "ja" && a.q5 !== "nej")) {
    return fail("incomplete", "Svara på alla frågor.");
  }
  // ctx.system: ärendets coach och nummer behövs för svaret och uppgiften – inget av det visas för deltagaren.
  const c = await ctx.system.table("cases").get(inv.caseId);
  const contact = a.q5 === "ja";
  const id = ctx.newId("pr");
  // ctx.system: systemsteg, motsvarar en security definer-funktion. Deltagaren har ingen inloggning (databasrollen anon
  // har inga rättigheter alls) – behörigheten är engångslänken, och den är kontrollerad ovan: tokenhashen finns, länken
  // är oanvänd och har inte gått ut, och ärendet har inte skyddade personuppgifter (inviteFor). Svaret skrivs bara på
  // den länkens ärende, med värden som kontrollerats här – deltagaren kan inte välja ärende, coach eller tidpunkt.
  try {
    await ctx.system.table("pulse_responses").insert({
      id, inviteId: inv.id, caseId: inv.caseId, coachId: c?.leadCoachId ?? null, occasion: inv.occasion, language: p.language,
      answers: { q1: a.q1, q2: a.q2, q3: a.q3, q4: a.q4 as PulsePriority, q5: a.q5 }, text: String(p.text || "").trim().slice(0, 500), contactRequested: contact, submittedAt: now,
    });
  } catch (e) {
    // Ett svar per länk (unik nyckel på invite_id, migration 0016): två samtidiga svar på samma länk – det andra stoppas
    // av databasen (23505) och inget mer skrivs.
    if ((e as { code?: unknown } | null)?.code === "23505") return fail("used", "Länken är redan använd.");
    throw e;
  }
  // ctx.system: länken förbrukas (systemsteg – deltagaren får inte ändra utskicket). Därefter svarar puls.link "used"
  // och ett nytt svar stoppas av kontrollen ovan.
  await ctx.system.table("pulse_invites").update(inv.id, { usedAt: now, language: p.language });
  if (contact) {
    // ctx.system: uppgiften går till samordnaren (en annan roll) – bara ärendenumret, inga svar och inga namn.
    await ctx.system.table("tasks").insert({
      id: ctx.newId("task"), toRole: "samordnare", toId: null, fromId: "system", createdAt: now, status: "open", kind: "pulse_contact", caseIds: [inv.caseId],
      deviationId: null, emailId: null, responseId: id, month: null, doneAt: null, doneBy: null, doneNote: null,
      text: `En deltagare vill bli kontaktad (pulsmätning ${fmtDate(now)}, ärende ${c ? c.caseNumber : "–"}). Avgör vem som tar kontakten.`,
    });
  }
  await ctx.audit({ action: "pulse.submitted", entity: "pulse_response", entityId: id, contractId: c?.contractId ?? null, details: { caseId: inv.caseId, language: p.language, contactRequested: contact } });
  return ok({});
});
