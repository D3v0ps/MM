// Hanterare: Ändra kontaktväg på deltagarkortet (coachmötet 2026-10-09). Kommunen anger inte längre deltagarens kontaktväg i
// beställningen – Miljonbemanning frågar vid första mötet och för in svaret här. Registreras via ./handlers.ts.
//   Vem:        samordnare, avtalsansvarig, coach och systemadministratör med full åtkomst (personen läses via behörigheten –
//               vid skyddade personuppgifter, vilande spärr, ser bara namngiven huvudcoach och avtalsansvarig personen).
//               Kommunen och ekonomen nekas av rollkontrollen.
//   Regler:     samma som Registrera beställning (contactErrors i src/core/contact.ts).
//   Skrivning:  persons via ctx.repo (RLS persons_update, mm.person_write – 0032 ger admin rätt att ändra bara kontaktuppgifterna).
//   Logg:       person.contact_changed med id:n och vilka fält som ändrades – aldrig värdena (CLAUDE.md punkt 2).
import { fail, ok } from "@/api/contract";
import { handleCommand } from "@/api/server";
import { contactErrors } from "@/core/contact";
import type { Person } from "@/data/schema";
import { CONTACT_EDITORS, caseSetContact } from "./api";

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";

handleCommand(caseSetContact, { roles: CONTACT_EDITORS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  // Personen läses via behörigheten: full åtkomst krävs (aldrig ett skyddat ärende för den som inte är namngiven).
  const person = await ctx.repo.table("persons").get(c.personId);
  if (!person) return fail("forbidden", "Du kan inte ändra kontaktvägen i det här ärendet.");
  const errs = contactErrors(p);
  if (errs.phone) return fail("phone", errs.phone);
  if (errs.email) return fail("email", errs.email);
  // Adressen används bara för brev – den töms när kontaktvägen ändras.
  const next: Pick<Person, "preferredContact" | "phone" | "email" | "address"> = { preferredContact: p.preferredContact, phone: p.phone.trim(), email: p.email.trim(), address: null };
  const fields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (person[k] ?? null) !== (next[k] ?? null));
  if (!fields.length) return ok({ changed: false });
  await ctx.repo.table("persons").update(person.id, Object.fromEntries(fields.map((k) => [k, next[k]])) as Partial<Person>);
  await ctx.audit({ action: "person.contact_changed", entity: "person", entityId: person.id, contractId: c.contractId, details: { caseId: c.id, fields } });
  return ok({ changed: true });
});
