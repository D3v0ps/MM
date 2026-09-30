// Testmiljön (MM_EMAIL_REDIRECT_TO): mejl till testpersoner går i stället till testarens adress, med en rad överst om vem
// mejlet skulle ha gått till. Raden innehåller roll och organisation – aldrig adressen eller namnet (testpersonernas adresser
// är påhittade men ligger på riktiga domäner). Deltagaren beskrivs bara som "deltagaren" (med ärendenumret).
import { ROLE_LABEL, type Role } from "@/api/roles";
import { domainOf, normalizeEmail } from "../auth/email";
import { templateInfo } from "./templates";
import type { NotifyRepo, OutboundRow } from "./types";

export const REDIRECT_PREFIX = "Testmiljö – det här mejlet skulle ha gått till";

/** Rollens etikett mitt i en mening: "Kommunens handläggare" -> "kommunens handläggare". */
const lower = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Vem mejlet egentligen var till: roll och organisation, "deltagaren" eller en allmän beskrivning. */
export async function intendedRecipient(repo: NotifyRepo, row: Pick<OutboundRow, "to" | "template" | "caseId">): Promise<string> {
  if (templateInfo(row.template)?.audience === "deltagare") {
    // service role: bara ärendenumret läses (det står redan i mejlet).
    const c = row.caseId ? await repo.table("cases").get(row.caseId) : null;
    return c ? `deltagaren i ärende ${c.caseNumber}` : "deltagaren";
  }
  const email = normalizeEmail(row.to);
  const profile = email ? await repo.table("profiles").first({ email }) : null;
  if (profile) {
    const [org, membership] = await Promise.all([
      repo.table("organizations").get(profile.organizationId),
      repo.table("memberships").first({ userId: profile.id }, { orderBy: "id" }),
    ]);
    const role = membership ? ROLE_LABEL[membership.role as Role] : undefined;
    if (role && org) return `${lower(role)} på ${org.name}`;
    if (role) return lower(role);
    if (org) return `en användare på ${org.name}`;
  }
  const domain = email.includes("@") ? domainOf(email) : "";
  if (domain) {
    const orgs = await repo.table("organizations").list();
    const org = orgs.find((o) => o.emailDomains.map((d) => d.toLowerCase().replace(/^@/, "")).includes(domain));
    if (org) return `en mottagare på ${org.name}`;
  }
  return "en mottagare som inte är testare";
}

/** Raden överst i mejlet. */
export const redirectNote = (who: string): string => `${REDIRECT_PREFIX} ${who}.`;
