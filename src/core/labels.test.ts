import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "./config";
import { activitiesOf, attendanceFor, checkInsOf } from "./db-index";
import {
  ABSENCE_REASONS, END_REASONS, EVENT_KINDS, areaName, attLabel, contactLabel, endReasonLabel, eventLabel, invoiceStatusLabel, outboundReasonLabel, outboundStatusLabel,
  personName, phaseLabel, phaseName, reportKindLabel, reportStatusLabel, statusLabel, teamLabel,
} from "./labels";
import { OUTBOUND_STATUSES } from "@/data/schema";
import { linkHref } from "./links";
import { scopeToContract } from "./scope";
import { mkActivity, mkAttendance, mkCase, mkCheckIn, mkProfile, testDb } from "./test-data";

describe("etiketter (prototypens texter)", () => {
  it("status, avslutsorsak, händelse och närvaro", () => {
    expect(statusLabel("acknowledged")).toBe("Ordererkänd");
    expect(statusLabel("okänd")).toBe("okänd");
    expect(END_REASONS).toHaveLength(7);
    expect(endReasonLabel("avbrott_kommunens_beslut")).toBe("Avbrott: kommunens beslut");
    expect(endReasonLabel(null)).toBe("–");
    expect(EVENT_KINDS).toHaveLength(10);
    expect(eventLabel("studier_paborjade")).toBe("Studier påbörjade/antagen");
    expect(attLabel("absent_valid")).toBe("Frånvaro, giltig");
    expect(attLabel(null)).toBe("Ej registrerad");
    expect(ABSENCE_REASONS).toEqual(["Sjukdom", "Vård av barn", "Myndighetsbesök", "Annat giltigt skäl"]);
  });
  it("rapporter, kontaktväg, team och fakturastatus", () => {
    expect(reportKindLabel("monthly")).toBe("Månadsrapport individ");
    expect(reportStatusLabel("opened")).toBe("Kvitterad");
    expect(contactLabel("letter")).toBe("Brev");
    expect(teamLabel("guidance_counselor")).toBe("SYV/metodstöd");
    expect(invoiceStatusLabel("fortnox_created")).toBe("Skapad i Fortnox (ej bokförd)");
    expect(invoiceStatusLabel("blocked")).toBe("Stoppad");
  });
  it("fas, område och namn", () => {
    expect(phaseName(BOTKYRKA_CONFIG, 4)).toBe("Praktik/APL");
    expect(phaseLabel(BOTKYRKA_CONFIG, 1)).toBe("Fas 1 · Kartläggning");
    expect(areaName([{ code: "G", name: "Lager och logistik" }], "G")).toBe("G Lager och logistik");
    expect(areaName([], null)).toBe("–");
    const profiles = [mkProfile({ id: "u-amira", fullName: "Amira Haddad" })];
    expect(personName(profiles, "u-amira")).toBe("Amira Haddad");
    expect(personName(profiles, "system")).toBe("Miljonmatch (automatiskt)");
    expect(personName(profiles, "u-x")).toBe("–");
    expect(personName(profiles, null)).toBe("–");
  });
});

describe("länkar enligt rutt-tabellen (bara id:n i URL:en)", () => {
  it("vyer och parametrar", () => {
    expect(linkHref({ view: "arende.kort", params: { caseId: "case-270003", tab: "narvaro" } })).toBe("/arenden/case-270003?flik=narvaro");
    expect(linkHref({ view: "sam.inkorg", params: { emailId: "em-104" } })).toBe("/inkorg/em-104");
    // Samordnarens startsida har gått upp i Min vecka (beslut 2026-10-06).
    expect(linkHref({ view: "sam.start", params: {} })).toBe("/min-vecka");
    expect(linkHref({ view: "sam.inkorg", params: { caseId: "case-270048" } })).toBe("/inkorg?arende=case-270048");
    expect(linkHref({ view: "coach.avstamning", params: { caseId: "case-260130", checkInId: "ci-11916" } })).toBe("/avstamning/case-260130?avstamning=ci-11916");
    expect(linkHref({ view: "coach.narvaro", params: { week: "last" } })).toBe("/narvaro?vecka=forra");
    expect(linkHref({ view: "chef.oversikt", params: { tab: "puls" } })).toBe("/ledning?flik=puls");
    expect(linkHref({ view: "chef.avvikelser", params: { id: "cd-2" } })).toBe("/avtalsavvikelser/cd-2");
    expect(linkHref({ view: "eko.korning", params: { month: "2027-01" } })).toBe("/ekonomi/2027-01");
    expect(linkHref({ view: "eko.faktura", params: { month: "2027-01", caseId: "c1" } })).toBe("/ekonomi/2027-01/faktura/c1");
    expect(linkHref({ view: "rapport.visa", params: { reportId: "rep-1" } })).toBe("/rapporter/rep-1");
    expect(linkHref({ view: "coach.handelse", params: { caseId: "c1", mode: "close" } })).toBe("/handelse/c1?lage=avslut");
    expect(linkHref({ view: "coach.manad", params: { caseId: "c1", month: "2027-01" } })).toBe("/manadsbedomning/c1?manad=2027-01");
    expect(linkHref({ view: "eko.start", params: {} })).toBe("/ekonomi");
  });
});

describe("uppslagsindex", () => {
  it("aktiviteter i tidsordning, avstämningar senaste först, nya rader syns direkt", () => {
    const db = testDb({
      activities: [mkActivity({ id: "a2", caseId: "c1", startsAt: "2027-01-27T10:00" }), mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-25T10:00" })],
      attendance: [mkAttendance({ activityId: "a1", caseId: "c1", status: "present" })],
      check_ins: [mkCheckIn({ id: "ci1", caseId: "c1", heldAt: "2027-01-08T10:00" }), mkCheckIn({ id: "ci2", caseId: "c1", heldAt: "2027-01-15T10:00" })],
    });
    expect(activitiesOf(db, "c1").map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(checkInsOf(db, "c1").map((a) => a.id)).toEqual(["ci2", "ci1"]);
    expect(attendanceFor(db, "a2")).toBeNull();
    db.attendance.push(mkAttendance({ activityId: "a2", caseId: "c1", status: "late" }));
    expect(attendanceFor(db, "a2")?.status).toBe("late");
    expect(activitiesOf(db, "saknas")).toEqual([]);
  });
});

describe("avgränsning till ett avtal", () => {
  it("tar bara med avtalets ärenden och deras rader", () => {
    const db = testDb({
      cases: [mkCase({ id: "c1" }), mkCase({ id: "k1", contractId: "c-ny" })],
      activities: [mkActivity({ id: "a1", caseId: "c1", startsAt: "2027-01-25T10:00" }), mkActivity({ id: "a2", caseId: "k1", startsAt: "2027-01-25T10:00" })],
    });
    const s = scopeToContract(db, "c-bot");
    expect(s.cases.map((c) => c.id)).toEqual(["c1"]);
    expect(s.activities.map((a) => a.id)).toEqual(["a1"]);
    expect(db.cases).toHaveLength(2);
  });
});

describe("utskickens statusar (utskicksloggen)", () => {
  it("har en svensk etikett för varje status som utskicken använder", () => {
    expect([...OUTBOUND_STATUSES]).toEqual(["queued", "sent", "failed", "suppressed", "manual"]);
    expect(OUTBOUND_STATUSES.map(outboundStatusLabel)).toEqual(["Väntar på att skickas", "Skickat", "Kunde inte skickas", "Stoppat", "Skickas manuellt (brev)"]);
    expect(outboundStatusLabel("okänd")).toBe("okänd");
  });
  it("orsaken redirected förklaras, övriga orsaker är redan text", () => {
    expect(outboundReasonLabel("redirected")).toBe("Testmiljön: skickat till testarens adress i stället för till mottagaren");
    expect(outboundReasonLabel("SMS-leverantör inte vald")).toBe("SMS-leverantör inte vald");
    expect(outboundReasonLabel(null)).toBeNull();
  });
});
