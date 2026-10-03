// Deltagarkortets tidslinje (rapporter steg 2, SPEC §7.18): allt som hänt i ärendet per månad, med det senaste först.
// Ren funktion utan I/O och utan Date.now() – hanteraren (arenden.kortTidslinje) läser datat via ctx.repo och skickar in
// klockan. Bara för hanterare och tester – importeras aldrig av skärmar.
//
// Grundregel: tidslinjen upprepar ingen fritext i grundvyn. Varje post har datum, typ, rubrik och status och leder till
// rätt flik. Undantaget är fria anteckningar (case_notes), där texten är innehållet. Meddelandets text och avstämningens
// anteckning och hinder kan fällas ut på begäran av den som får läsa dem på fliken (posten märks text: "message" |
// "check_in"; texten hämtas av arenden.kortTidslinjeText först vid utfällning – beslut 2026-10-02, Karim). Visas aldrig:
// råtranskript, AI-utkast, pulsmätningar, revisionsloggen, röstmeddelanden, aktiviteternas anteckningar, händelsernas
// anteckningar, avvikelsetexter och orsaker i statushistoriken.
//
// Behörighet: hanteraren läser bara de tabeller rollen ska se (teamet: inga avstämningar, bedömningar, avvikelser,
// rapporter, samtycken eller meddelanden). Funktionen kontrollerar dessutom själv åtkomsten per kategori.
import type { Role } from "@/api/roles";
import { progressionFlags, phaseLabel, type OperationalConfig } from "@/core/config";
import { attendanceStats } from "@/core/attendance";
import {
  CASE_NOTE_AUDIENCE_LABEL, CASE_NOTE_PROTECTED_AUDIENCE, CASE_STATUS_LABEL, caseNoteKindLabel, endReasonLabel, eventLabel, personName,
} from "@/core/labels";
import { addDays, addMonths, dayOf, diffDays, fmtDate, fmtDateFull, fmtDateShort, isoWeek, monday, monthEnd, monthKey, MONTHS, type LocalDate, type LocalDateTime, type MonthKey } from "@/core/time";
import type { ActivityKind, Case, Db, OutcomeEventKind, Report, TrafficLight } from "@/data/schema";
import type { CaseTimeline, CaseTimelineMonth, TimelineCat, TimelineEntry } from "./api";

/** Tabellerna tidslinjen byggs av (bara ärendets rader). Tabeller rollen inte får läsa skickas tomma. */
export type TimelineDb = Pick<
  Db,
  | "cases" | "persons" | "activities" | "attendance" | "check_ins" | "intake_assessments" | "monthly_assessments" | "outcome_events" | "placements" | "employers"
  | "case_status_history" | "deviations" | "consents" | "reports" | "messages" | "case_notes" | "profiles" | "organizations"
>;
export type TimelineViewer = { access: "full" | "team"; role: Role; userId: string };
export type TimelineOpts = {
  caseId: string;
  viewer: TimelineViewer;
  cfg: OperationalConfig;
  now: LocalDateTime;
  visa?: TimelineCat;
  /** Visa de tre månaderna före den här (sidindelning). */
  fore?: MonthKey;
};

/** Månader per svar. */
export const TIMELINE_PAGE_MONTHS = 3;
/** Händelser som räknas som arbetsgivarkontakter – teamet ser bara dem (samma som fliken Händelser). */
export const TEAM_EVENT_KINDS: readonly OutcomeEventKind[] = ["intervju_arbetsgivarkontakt", "arbetserbjudande", "praktik_startad", "arbete_paborjat"];
/** Arbetar i ärendet och får skriva anteckningar (policyns CASE_WORKERS). Chef och systemadministratör läser bara. */
const WRITERS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach", "handledare"];
/** Döljer andras anteckningar (beslut 2026-10-01). */
const NOTE_REMOVERS: readonly Role[] = ["samordnare", "avtalsansvarig"];

const LIGHT_TEXT: Record<TrafficLight, string> = { green: "Grön", yellow: "Gul", red: "Röd" };
const KIND_ORDER: readonly ActivityKind[] = ["möte", "yrkesmoment", "praktikdag", "arbetsgivarbesök", "annat"];
const KIND_TEXT: Record<ActivityKind, [string, string]> = {
  möte: ["möte", "möten"], yrkesmoment: ["yrkesmoment", "yrkesmoment"], praktikdag: ["praktikdag", "praktikdagar"],
  arbetsgivarbesök: ["arbetsgivarbesök", "arbetsgivarbesök"], annat: ["annan aktivitet", "andra aktiviteter"],
};
const joinSv = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`);
const count = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;
/** "28 jan" i år, annars "28 jan 2026". */
const shortDate = (s: string, today: LocalDate) => (s.slice(0, 4) === today.slice(0, 4) ? fmtDateShort(s) : fmtDate(s));
const monthWord = (mk: MonthKey) => MONTHS[Number(mk.slice(5, 7)) - 1];

/**
 * Månadsrubrikens rapportstatus (bara vid full åtkomst). Rapporten = månadens senaste version som inte är ersatt.
 * Inte REPORT_STATUS_LABEL rakt av: "Kvitterad" visas som levererad, och väntande räknas som utkast.
 */
export function monthReportStatusLabel(r: Pick<Report, "status" | "deliveredAt"> | null): string {
  if (!r) return "Månadsrapport: Inte skapad än";
  switch (r.status) {
    case "draft":
    case "waiting":
      return "Månadsrapport: Utkast";
    case "reviewed":
      return "Månadsrapport: Granskad av coach";
    case "approved":
      return "Månadsrapport: Godkänd";
    case "delivered":
    case "opened":
      return `Månadsrapport: Levererad ${fmtDateFull(r.deliveredAt)}`;
  }
}

/** Månadens rapport: senaste version som inte är ersatt. */
export function monthReportOf(reports: readonly Report[], caseId: string, month: MonthKey): Report | null {
  return monthReportState(reports, caseId, month).latest;
}

/**
 * Månadsrapportens läge – ett ställe för tidslinjens månadsrubrik och fliken Månadsunderlag. latest = senaste versionen som
 * inte är ersatt; delivered = den levererade versionen som gäller; correction = en rättelse av den som inte är levererad än.
 * Under en rättelse är version 1 fortfarande levererad (inte ersatt) och version 2 ett utkast – månaden räknas som levererad.
 */
export type MonthReportState = { latest: Report | null; delivered: Report | null; correction: Report | null };
export function monthReportState(reports: readonly Report[], caseId: string, month: MonthKey): MonthReportState {
  const xs = reports
    .filter((r) => r.kind === "monthly" && r.caseId === caseId && r.month === month && !r.superseded)
    .sort((a, b) => (b.version || 1) - (a.version || 1));
  const delivered = xs.find((r) => !!r.deliveredAt) ?? null;
  const correction = delivered?.correctionPending ? (xs.find((r) => r.id === delivered.correctionPending && !r.deliveredAt) ?? null) : null;
  return { latest: xs[0] ?? null, delivered, correction };
}

/** Månadsrubrikens text: den levererade versionen när en rättelse pågår, annars senaste versionen (monthReportStatusLabel). */
export function monthReportStateLabel(s: MonthReportState): string {
  if (!s.delivered) return monthReportStatusLabel(s.latest);
  const base = monthReportStatusLabel(s.delivered);
  return s.correction ? `${base} · rättelse (version ${s.correction.version || 2}) är ett utkast` : base;
}

/** Var ärendet inskrivet någon dag i månaden? */
export const enrolledIn = (c: Pick<Case, "startDate" | "endDate">, month: MonthKey): boolean =>
  !!c.startDate && c.startDate <= monthEnd(month) && (!c.endDate || c.endDate >= `${month}-01`);

type Draft = TimelineEntry & { sort: string };

export function buildTimeline(db: TimelineDb, o: TimelineOpts): CaseTimeline {
  const c = db.cases.find((x) => x.id === o.caseId);
  const empty: CaseTimeline = { months: [], more: false, canWrite: false, empty: true };
  if (!c) return empty;
  const { viewer, cfg, now } = o;
  const full = viewer.access === "full";
  const today = dayOf(now);
  const name = (id: string | null | undefined) => personName(db.profiles, id);
  const protectedCase = !!db.persons.find((p) => p.id === c.personId)?.protectedIdentity;
  const canWrite = WRITERS.includes(viewer.role);
  const out: Draft[] = [];
  const push = (e: Omit<Draft, "sort"> & { sort?: string }) => out.push({ ...e, sort: e.sort ?? e.at });
  const endLimit = c.endDate && c.endDate < today ? c.endDate : today;

  // ---- Insatser och aktiviteter: en post per ISO-vecka (teamet också)
  const started = db.activities.filter((a) => a.caseId === c.id && a.startsAt < now);
  const byWeek = new Map<string, typeof started>();
  for (const a of started) {
    const k = isoWeek(a.startsAt).key;
    byWeek.set(k, [...(byWeek.get(k) ?? []), a]);
  }
  /** Veckopostens datum: söndagen, insatsens slutdatum om det är tidigare, eller i dag om veckan pågår. */
  const weekDate = (mon: LocalDate): LocalDate => {
    const sun = addDays(mon, 6);
    return [sun, c.endDate ?? sun, today].sort()[0];
  };
  for (const [key, acts] of byWeek) {
    const mon = monday(acts[0].startsAt);
    const w = isoWeek(mon).week;
    const parts = KIND_ORDER.map((k) => [k, acts.filter((a) => a.kind === k).length] as const).filter(([, n]) => n > 0).map(([k, n]) => count(n, KIND_TEXT[k]));
    const at = weekDate(mon);
    push({ id: `act:${key}`, at, sort: `${at}T23:58`, weekLabel: `Vecka ${w}`, cat: "insatser", icon: "calendar", title: `Vecka ${w}: ${joinSv(parts)}`, tab: "narvaro" });
  }

  // ---- Närvaro: en post per ISO-vecka under insatsen (teamet också). Siffrorna = attendanceStats för veckan.
  if (c.startDate) {
    const rule = cfg.attendance.repeatedAbsenceRule;
    // Upprepad ogiltig frånvaro enligt avtalets regel (t.ex. 2 tillfällen inom 14 dagar): veckan där regeln slår till.
    const inv = started
      .filter((a) => db.attendance.some((x) => x.activityId === a.id && x.status === "absent_invalid"))
      .map((a) => dayOf(a.startsAt))
      .sort();
    const repeatedWeeks = new Set<string>();
    for (let j = rule.absentInvalid - 1; j < inv.length; j++) {
      if (diffDays(inv[j - rule.absentInvalid + 1], inv[j]) <= rule.withinDays) repeatedWeeks.add(isoWeek(inv[j]).key);
    }
    for (let mon = monday(c.startDate); mon <= endLimit; mon = addDays(mon, 7)) {
      const wk = isoWeek(mon);
      const at = weekDate(mon);
      const base = { id: `att:${wk.key}`, at, sort: `${at}T23:59`, weekLabel: `Vecka ${wk.week}`, cat: "narvaro" as const, tab: "narvaro" as const };
      if (c.pausedWeeks.includes(wk.key)) {
        push({ ...base, icon: "pause", title: `Vecka ${wk.week}: uppehåll` });
        continue;
      }
      const s = attendanceStats(db, c.id, mon, addDays(mon, 6), { now });
      if (!s.planned) continue;
      const repeated = repeatedWeeks.has(wk.key);
      const sub = [
        repeated ? "Upprepad ogiltig frånvaro" : "",
        s.late ? count(s.late, ["sen ankomst", "sena ankomster"]) : "",
        s.absentValid ? `${s.absentValid} giltig frånvaro` : "",
        s.absentInvalid ? `${s.absentInvalid} ogiltig frånvaro` : "",
        s.unregistered ? (s.unregistered === 1 ? "1 tillfälle är inte registrerat" : `${s.unregistered} tillfällen är inte registrerade`) : "",
      ].filter(Boolean);
      push({
        ...base, icon: repeated ? "alert" : "activity", state: repeated ? "varning" : undefined,
        title: `Vecka ${wk.week}: närvarande ${s.present + s.late} av ${count(s.planned, ["tillfälle", "tillfällen"])}`,
        sub: sub.length ? sub.join(" · ") : undefined,
      });
    }
  }

  // ---- Praktik (teamet också)
  for (const pl of db.placements.filter((x) => x.caseId === c.id)) {
    const emp = db.employers.find((e) => e.id === pl.employerId)?.name ?? "arbetsgivaren";
    push({ id: `pl-start:${pl.id}`, at: pl.startsOn, cat: "insatser", icon: "briefcase", title: `Praktik startar hos ${emp}`, tab: "praktik" });
    if (pl.endsOn && pl.endsOn <= today) push({ id: `pl-end:${pl.id}`, at: pl.endsOn, cat: "insatser", icon: "briefcase", title: `Praktik avslutas hos ${emp}`, tab: "praktik" });
  }

  // ---- Resultat: händelser (teamet bara arbetsgivarkontakter)
  for (const e of db.outcome_events.filter((x) => x.caseId === c.id && (full || TEAM_EVENT_KINDS.includes(x.kind)))) {
    const verified = !!e.verificationKind;
    push({
      id: `ev:${e.id}`, at: e.occurredOn, cat: "resultat", icon: "award", title: eventLabel(e.kind), sub: verified ? "Verifierad" : "Inte verifierad",
      state: verified ? undefined : "ej_verifierad", tab: "handelser",
    });
  }

  // ---- Statushistoriken (teamet bara statusbyten – aldrig orsaken)
  for (const h of db.case_status_history.filter((x) => x.caseId === c.id)) {
    const coachChange = !!h.fromCoach && !!h.toCoach && h.fromCoach !== h.toCoach;
    if (coachChange && h.fromStatus === h.toStatus) {
      if (full) push({ id: `csh:${h.id}`, at: h.changedAt, cat: "ovrigt", icon: "users", title: `Ny huvudcoach: ${name(h.toCoach)}` });
      continue;
    }
    if (h.fromStatus === h.toStatus) continue;
    push({ id: `csh:${h.id}`, at: h.changedAt, cat: "ovrigt", icon: "flag", title: `Status: ${CASE_STATUS_LABEL[h.toStatus] ?? h.toStatus}` });
  }

  // ---- Anteckningar: alla med åtkomst – teamet bara audience team (RLS). Borttagna visas bara för författaren, när
  //      någon annan tog bort dem ("Borttagen av …").
  for (const n of db.case_notes.filter((x) => x.caseId === c.id && (x.audience === "team" || full))) {
    const mine = n.authorId === viewer.userId;
    if (n.removedAt && !(mine && n.removedBy && n.removedBy !== n.authorId)) continue;
    const who = protectedCase ? CASE_NOTE_PROTECTED_AUDIENCE : CASE_NOTE_AUDIENCE_LABEL[n.audience];
    const removed = n.removedAt ? { byName: name(n.removedBy), at: n.removedAt } : null;
    const canEdit = !removed && mine && canWrite && (n.audience === "team" || full);
    const canRemove = !removed && (canEdit || (NOTE_REMOVERS.includes(viewer.role) && full));
    const sub = removed
      ? `Borttagen av ${removed.byName} ${shortDate(removed.at, today)}`
      : `Skriven av ${name(n.authorId)} · ${who}${n.updatedAt ? ` · Ändrad ${shortDate(n.updatedAt, today)}` : ""}`;
    push({
      id: `note:${n.id}`, at: n.occurredOn, sort: `${n.occurredOn}T${n.createdAt.slice(11, 16)}`, cat: "anteckningar", icon: "edit", title: caseNoteKindLabel(n.kind), sub,
      note: { id: n.id, kind: n.kind, audience: n.audience, occurredOn: n.occurredOn, body: n.body, canEdit, canRemove, authorName: name(n.authorId), removed },
    });
  }

  if (full) {
    // ---- Veckoavstämningar: godkända och utkast – texten, hindren och närvarokommentaren fälls ut på begäran (text:
    // "check_in" när fliken har något att visa: godkänd med anteckning, hinder eller kommentar; utkast bara hindren).
    // AI-utkasten visas aldrig.
    for (const ci of db.check_ins.filter((x) => x.caseId === c.id && x.heldAt <= now)) {
      const w = isoWeek(ci.heldAt).week;
      if (ci.status === "approved") {
        const text = ci.note.trim() || ci.obstacles.length || (ci.attendanceComment ?? "").trim() ? { text: "check_in" as const } : {};
        push({ id: `ci:${ci.id}`, at: ci.heldAt, cat: "insatser", icon: "check-square", title: `Veckoavstämning vecka ${w} godkänd`, sub: ci.phase ? phaseLabel(cfg, ci.phase) : undefined, tab: "avstamningar", ...text });
      } else {
        const text = ci.obstacles.length ? { text: "check_in" as const } : {};
        push({ id: `ci:${ci.id}`, at: ci.heldAt, cat: "insatser", icon: "edit", title: `Veckoavstämning vecka ${w} · Utkast – granskas av coachen`, state: "utkast", tab: "avstamningar", ...text });
      }
    }
    // ---- Progression: kartläggning och godkända månadsbedömningar
    for (const ia of db.intake_assessments.filter((x) => x.caseId === c.id && x.status === "approved" && x.approvedAt)) {
      push({ id: `ia:${ia.id}`, at: ia.approvedAt as string, cat: "progression", icon: "clipboard", title: "Kartläggning godkänd", tab: "kartlaggning" });
    }
    for (const ma of db.monthly_assessments.filter((x) => x.caseId === c.id && x.status === "approved" && x.decidedAt)) {
      const f = progressionFlags(cfg, ma.areas);
      const prog = f.clearCount ? `Tydlig progression i ${count(f.clearCount, ["område", "områden"])}` : "Ingen tydlig progression";
      push({
        id: `ma:${ma.id}`, at: ma.decidedAt as string, cat: "progression", icon: "chart", title: `Månadsbedömning ${monthWord(ma.month)} godkänd`,
        sub: `Samlad status: ${ma.overallStatus ? LIGHT_TEXT[ma.overallStatus] : "Ej bedömd"} · ${prog}`, light: ma.overallStatus, tab: "manad", month: ma.month,
      });
    }
    // ---- Resultat: avslutet
    if (c.status === "closed" && c.endDate) {
      const result = c.resultClass === "result" ? (c.resultVerifiedAt ? " · Verifierad" : " · Väntar på verifiering") : "";
      push({
        id: `close:${c.id}`, at: c.endDate, sort: `${c.endDate}T23:57`, cat: "resultat", icon: "check-circle", title: "Insatsen avslutades",
        sub: `Avslutsorsak: ${endReasonLabel(c.endReason)}${result}`, state: c.resultClass === "result" && !c.resultVerifiedAt ? "ej_verifierad" : undefined, tab: "oversikt",
      });
    }
    // ---- Övrigt: avvikelser (aldrig texten), samtycken, levererade rapporter, meddelanden (texten fälls ut på begäran)
    for (const d of db.deviations.filter((x) => x.caseId === c.id)) {
      push({ id: `dev:${d.id}`, at: d.createdAt, cat: "ovrigt", icon: "flag", title: "Avvikelse registrerad", tab: "avvikelser" });
      if (d.closedAt) push({ id: `dev-end:${d.id}`, at: d.closedAt, cat: "ovrigt", icon: "check-circle", title: "Avvikelse avslutad", tab: "avvikelser" });
    }
    for (const x of db.consents.filter((k) => k.caseId === c.id)) {
      if (x.givenAt) push({ id: `cons:${x.id}`, at: x.givenAt, cat: "ovrigt", icon: "mic", title: "Samtycke till inspelning och AI registrerat" });
      if (x.revokedAt) push({ id: `cons-rev:${x.id}`, at: x.revokedAt, cat: "ovrigt", icon: "x-circle", title: "Samtycket återkallades" });
      if (x.declinedAt) push({ id: `cons-no:${x.id}`, at: x.declinedAt, cat: "ovrigt", icon: "minus-circle", title: "Deltagaren sa nej till inspelning" });
    }
    if (viewer.role !== "handledare") {
      for (const r of db.reports.filter((x) => x.caseId === c.id && x.deliveredAt && !x.superseded)) {
        const v = (r.version || 1) > 1 ? ` · version ${r.version}` : "";
        const title =
          r.kind === "monthly" && r.month ? `Månadsrapport ${monthWord(r.month)} levererad${v}`
          : r.kind === "final" ? `Slutrapport levererad${v}`
          : r.kind === "order_confirmation" ? `Orderbekräftelse levererad${v}`
          : null;
        if (title) push({ id: `rep:${r.id}`, at: r.deliveredAt as string, cat: "ovrigt", icon: "file", title, tab: "rapporter" });
      }
    }
    const customerOrgs = new Set(db.organizations.filter((x) => x.kind === "customer").map((x) => x.id));
    const fromCustomer = new Set(db.profiles.filter((p) => customerOrgs.has(p.organizationId)).map((p) => p.id));
    for (const m of db.messages.filter((x) => x.caseId === c.id)) {
      push({ id: `msg:${m.id}`, at: m.createdAt, cat: "ovrigt", icon: "message", title: fromCustomer.has(m.senderId) ? "Meddelande från kommunen" : "Meddelande till kommunen", tab: "meddelanden", text: "message" });
    }
  }

  // ---- Månaderna: från den senaste (innevarande månad, eller slutmånaden för ett avslutat ärende) bakåt till beställningen
  const current = monthKey(now);
  const all = out.filter((e) => monthKey(e.at) <= current);
  const latest = all.reduce((m, e) => (monthKey(e.at) > m ? monthKey(e.at) : m), "");
  const top = c.status === "closed" && c.endDate ? [current, [monthKey(c.endDate), latest].sort().pop() as MonthKey].sort()[0] : current;
  const bottom = [monthKey(c.referredAt), ...all.map((e) => monthKey(e.at))].sort()[0];
  const shown = all.filter((e) => monthKey(e.at) <= top && (!o.visa || o.visa === "alla" || e.cat === o.visa));
  const start = o.fore ? addMonths(o.fore, -1) : top;
  const months: CaseTimelineMonth[] = [];
  for (let i = 0, mk = start; i < TIMELINE_PAGE_MONTHS && mk >= bottom; i++, mk = addMonths(mk, -1)) {
    const entries = shown
      .filter((e) => monthKey(e.at) === mk)
      .sort((a, b) => (a.sort === b.sort ? (a.id < b.id ? 1 : -1) : a.sort < b.sort ? 1 : -1))
      .map(({ sort, ...e }) => (void sort, e));
    const st = full && viewer.role !== "handledare" && enrolledIn(c, mk) ? monthReportState(db.reports, c.id, mk) : null;
    months.push({ month: mk, report: st ? { id: st.latest?.id ?? null, statusLabel: monthReportStateLabel(st) } : null, entries });
  }
  const oldest = months.length ? months[months.length - 1].month : start;
  return {
    months,
    more: shown.some((e) => monthKey(e.at) < oldest),
    canWrite,
    empty: all.filter((e) => monthKey(e.at) <= top).length === 0,
  };
}
