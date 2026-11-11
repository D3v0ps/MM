// Redovisningsunderlagets avsnitt i klarspråk – samma text i HTML-vyn (screens/underlag.tsx) och i PDF:en (pdf.tsx). Isomorf och
// ren: bara underlaget (BonusUnderlag) och deltagarens namn in, avsnitt med rader ut. Aldrig belopp (underlaget har inga).
import { fmtDate, fmtDateTime, monthName, type MonthKey } from "@/core/time";
import type { BonusUnderlag } from "./api";

export type UnderlagSection = { title: string; rows: (readonly [string, string])[]; table?: { cols: string[]; rows: string[][] }; text?: string[] };

const date = (d: string | null | undefined) => (d ? fmtDate(d) : "–");
const month = (m: MonthKey) => monthName(m).replace(/^./, (c) => c.toUpperCase());
const pct = (v: number | null) => (v == null ? "Inget registrerat" : `${String(v).replace(".", ",")} procent`);

/** Märkningen på en förhandsvisning av ett anspråk som inte är skickat (HTML och PDF). */
export const DRAFT_LABEL = "Utkast – inte skickat";

/** Rubriken: "Redovisningsunderlag – progression och resultat, steg 3" (Karims beslut 2026-11-11). */
export const underlagTitle = (u: Pick<BonusUnderlag, "step">) => `Redovisningsunderlag – progression och resultat, steg ${u.step}`;

/** Avsnitten i ordning: bonussteget, insatsen, närvaro och aktiviteter, progression, resultatet och verifieringen, coachens kommentar. */
export function underlagSections(u: BonusUnderlag, participantName: string): UnderlagSection[] {
  const out: UnderlagSection[] = [];
  out.push({
    title: "Steg",
    rows: [
      ["Steg", `${u.step} · ${u.stepLabel}`],
      ["Deltagare", participantName],
      ["Ärendenummer", u.caseNumber],
      u.draft ? ["Läge", DRAFT_LABEL] : ["Skickat", `${fmtDateTime(u.createdAt)}${u.sentByName ? ` av ${u.sentByName}` : ""}`],
    ],
    text: [u.rule],
  });
  out.push({
    title: "Insatsen",
    rows: [
      ["Startdatum", date(u.period.start)],
      ["Slutdatum", u.period.ongoing ? `Pågår (planerat slut ${date(u.period.plannedEnd)})` : date(u.period.end)],
      ["Yrkesområde", u.area],
      ["Yrkesspår", u.track ?? "Framgår inte"],
      ["Huvudcoach", u.coachName ?? "–"],
      ["Mål", u.goals.length ? u.goals.join(" · ") : "Framgår inte"],
    ],
  });
  out.push({
    title: "Närvaro och aktiviteter",
    rows: [
      ["Närvarograd", `${pct(u.attendance.percent)} (${u.attendance.attended} av ${u.attendance.registered} registrerade tillfällen${u.attendance.from ? `, ${date(u.attendance.from)} – ${date(u.attendance.to)}` : ""})`],
      ...(u.step === 1 ? [["Gräns för steg 1", `Minst ${u.attendance.minPercent} procent`] as const] : []),
      ["Aktiviteter", u.activities.length ? u.activities.map((a) => `${a.label} ${a.count}`).join(", ") : "Inga registrerade"],
    ],
  });
  if (u.progression) {
    out.push({
      title: "Progression före och efter",
      rows: [
        [`Samlad status ${month(u.progression.first.month).toLowerCase()}`, u.progression.first.overall ?? "Framgår inte"],
        [`Samlad status ${month(u.progression.latest.month).toLowerCase()}`, u.progression.latest.overall ?? "Framgår inte"],
      ],
      table: {
        cols: ["Område", month(u.progression.first.month), month(u.progression.latest.month)],
        rows: u.progression.rows.map((r) => [r.label, r.first == null ? "–" : String(r.first), r.latest == null ? "–" : String(r.latest)]),
      },
      text: [`Skala: ${u.progression.scale}. Bara godkända månadsbedömningar.`],
    });
  } else {
    out.push({ title: "Progression före och efter", rows: [["Månadsbedömningar", "Det finns inte två godkända månadsbedömningar att jämföra."]] });
  }
  const result: (readonly [string, string])[] = [];
  if (u.reachedOn) result.push([u.step >= 3 ? "Resultatdatum" : "Datum", date(u.reachedOn)]);
  if (u.event) result.push(["Händelse", `${u.event.label} ${date(u.event.date)}`]);
  if (u.speed) result.push(["Senast för snabbhetspremie", `${date(u.speed.deadline)} (${u.speed.weeks} veckor från start)`]);
  if (u.sustain) result.push(["Hållbart resultat", `Från ${date(u.sustain.since)} till ${date(u.sustain.until)} (${u.sustain.months} månader)`]);
  result.push(["Verifiering", u.verification ? `${u.verification.kind}${u.verification.on ? `, daterad ${date(u.verification.on)}` : ""}` : "Framgår inte"]);
  if (u.actor) {
    result.push(["Arbetsgivare eller skola", u.actor.name]);
    const contact = [u.actor.contactName, u.actor.phone, u.actor.email].filter(Boolean).join(", ");
    if (contact) result.push(["Kontaktperson", contact]);
  }
  out.push({
    title: u.step === 1 ? "Underlaget för steget" : "Resultat och verifiering",
    rows: [...result, ...u.checklist.map((c) => [c.label, c.where ? `Klar – underlaget finns: ${c.where}` : "Klar"] as const)],
    text: ["Intyg och andra dokument finns inte i Miljonmatch – de skickas till kommunen på annat sätt."],
  });
  out.push({ title: "Coachens kommentar", rows: [], text: [u.comment || "Ingen kommentar."] });
  return out;
}
