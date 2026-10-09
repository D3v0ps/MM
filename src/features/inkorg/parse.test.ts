// Tolkningen av mejl till avrop@ (beslut 4c): Word-mallens etiketter, fritext, svar med ärendenummer och övrigt.
import { describe, expect, it } from "vitest";
import { canCreateCase, extractLabelled, findCaseNumber, ownText, parseInboundMail, parseOrderPeriod, parsePnr, parseSvDate, REQUIRED_ORDER_FIELDS } from "./parse";

const PREFIX = { casePrefix: "BOT" };

const TEMPLATE = `Hej!

Här kommer ett avrop enligt mallen.

1. Beställning och kontakt
Handläggare: Maria Ekdahl
Enhet: Arbetsmarknadsenheten Alby
Telefon: 08-530 610 00
E-post: maria.ekdahl@botkyrka.se
Önskat startdatum: 15 februari 2027
Omfattning: 6 månader

2. Deltagare
Förnamn: Diego
Efternamn: Morales
Personnummer: 19910412–1234
Telefon: 070-123 45 67
E-post: diego@example.invalid
Bostadsort: Alby
Föredragen kontaktväg: SMS

3. Bakgrundsinformation om deltagaren
Kartläggning genomförd: Ja
Bakgrundsinformation: Har arbetat i butik i Chile.
Vill gärna börja snart.

Med vänlig hälsning
Maria`;

describe("parseInboundMail – Word-mallens etiketter", () => {
  it("tolkar alla fält utan AI, med avsnitt för handläggare och deltagare", () => {
    const r = parseInboundMail({ subject: "Avrop – yrkesinriktad insats", bodyText: TEMPLATE }, PREFIX);
    expect(r.kind).toBe("order");
    expect(r.parseMethod).toBe("template");
    expect(r.caseNumber).toBeNull();
    expect(r.extracted).toEqual({
      referrerName: "Maria Ekdahl", referrerUnit: "Arbetsmarknadsenheten Alby", referrerPhone: "08-530 610 00", referrerEmail: "maria.ekdahl@botkyrka.se",
      desiredStart: "2027-02-15", orderPeriod: "6", firstName: "Diego", lastName: "Morales", pnr: "19910412-1234", phone: "070-123 45 67",
      email: "diego@example.invalid", city: "Alby", preferredContact: "sms", priorAssessment: "ja", background: "Har arbetat i butik i Chile.\nVill gärna börja snart.",
    });
    expect(r.confidence.desiredStart).toBe(0.9);
    expect(r.confidence.firstName).toBe(1);
    expect(r.missingFields).toEqual([]);
    expect(canCreateCase(r.extracted)).toBe(true);
  });

  it("saknade uppgifter listas (startdatum och omfattning) och tabellceller 'Etikett<tab>värde' fungerar", () => {
    const r = parseInboundMail({ subject: "Beställning", bodyText: "Deltagare\nNamn\tAnna Berg\nPersonnummer\t950505-1111\nOrt\tTumba\n" }, PREFIX);
    expect(r.kind).toBe("order");
    expect(r.extracted).toMatchObject({ firstName: "Anna", lastName: "Berg", pnr: "950505-1111", city: "Tumba" });
    expect(r.missingFields).toEqual(["desiredStart", "orderPeriod"]);
    expect(REQUIRED_ORDER_FIELDS).toContain("pnr");
  });

  it("texten ur en bifogad Word-mall väger som brödtexten", () => {
    const r = parseInboundMail({ subject: "Avrop", bodyText: "Hej!\nSe bifogat avrop.\n/Linda", attachmentText: "Förnamn: Tesfaye\nEfternamn: Haile\nPersonnummer: 19880101-2222\nÖnskat startdatum: 2027-02-08\nOmfattning: 12 månader" }, PREFIX);
    expect(r.parseMethod).toBe("template");
    expect(r.extracted).toMatchObject({ firstName: "Tesfaye", lastName: "Haile", pnr: "19880101-2222", desiredStart: "2027-02-08", orderPeriod: "12" });
    expect(r.missingFields).toEqual([]);
  });

  it("ett datum som inte går att tolka blir tomt och saknas", () => {
    const r = parseInboundMail({ subject: "Avrop", bodyText: "Förnamn: A\nEfternamn: B\nPersonnummer: 19880101-2222\nÖnskat startdatum: så snart som möjligt\nOmfattning: 6" }, PREFIX);
    expect(r.extracted.desiredStart).toBe("");
    expect(r.confidence.desiredStart).toBe(0);
    expect(r.missingFields).toEqual(["desiredStart"]);
  });
});

describe("parseInboundMail – fritext, svar och övrigt", () => {
  it("fritext som ser ut som ett avrop: ingen tolkning (manual), personnumret som osäkert stöd, allt saknas", () => {
    const body = "Hej!\n\nJag skulle vilja anvisa Rasha Khalaf (19750312-5223) till en insats inom kök, ungefär sex månader.\n\nMvh Ahmed";
    const r = parseInboundMail({ subject: "Ny deltagare till er – kök", bodyText: body }, PREFIX);
    expect(r.kind).toBe("order");
    expect(r.parseMethod).toBe("manual");
    expect(r.extracted).toEqual({ pnr: "19750312-5223" });
    expect(r.confidence.pnr).toBe(0.5);
    expect(r.missingFields).toEqual(["desiredStart", "orderPeriod", "firstName", "lastName"]);
    expect(canCreateCase(r.extracted)).toBe(false);
  });

  it("svar med ärendenumret i ämnesraden: komplettering med de etiketterade uppgifterna, citatet under räknas inte", () => {
    const body = "Hej,\nBeställarreferens: 55102938\nSlutdatum: 19 mars 2027\n\n/Ahmed\n\nFrån: avrop@miljonbemanning.se\nSkickat: fredag\nTack! Vi har tagit emot er beställning och gett den ärendenummer BOT-27-0049.\nFörnamn: Nej";
    const r = parseInboundMail({ subject: "SV: Vi har tagit emot er beställning – BOT-27-0049", bodyText: body }, PREFIX);
    expect(r).toMatchObject({ kind: "reply", caseNumber: "BOT-27-0049", linkedBy: "ärendenummer i ämnesraden", parseMethod: "template" });
    expect(r.extracted).toEqual({ buyerReference: "55102938", plannedEnd: "2027-03-19" });
    expect(r.missingFields).toEqual([]);
  });

  it("ärendenumret i texten (annat prefix än avtalets räknas inte)", () => {
    expect(findCaseNumber("Fråga", "Gäller bot-27-0012. Vilka dagar?", "BOT")).toEqual({ caseNumber: "BOT-27-0012", where: "body" });
    expect(findCaseNumber("Fråga", "Gäller KAM-27-0012.", "BOT")).toBeNull();
    const r = parseInboundMail({ subject: "Fråga om schema", bodyText: "Hej! Gäller BOT-27-0012. Vilka dagar är praktiken?" }, PREFIX);
    expect(r).toMatchObject({ kind: "reply", caseNumber: "BOT-27-0012", linkedBy: "ärendenummer i texten", extracted: {} });
  });

  it("ett mejl som varken är en beställning eller nämner ett ärende är Övrigt", () => {
    const r = parseInboundMail({ subject: "Lunch nästa vecka?", bodyText: "Hej! Ska vi ta en lunch och prata om samarbetet?" }, PREFIX);
    expect(r).toEqual({ kind: "other", parseMethod: "manual", caseNumber: null, linkedBy: null, extracted: {}, confidence: {}, missingFields: [] });
  });
});

describe("värden", () => {
  it("datum i olika skrivsätt", () => {
    expect(parseSvDate("2027-02-08")).toBe("2027-02-08");
    expect(parseSvDate("8 februari 2027")).toBe("2027-02-08");
    expect(parseSvDate("den 8 feb 2027")).toBe("2027-02-08");
    expect(parseSvDate("8/2 2027")).toBe("2027-02-08");
    expect(parseSvDate("8.2.2027")).toBe("2027-02-08");
    expect(parseSvDate("20270208")).toBe("2027-02-08");
    expect(parseSvDate("v. 6")).toBe("");
    expect(parseSvDate("2027-13-01")).toBe("");
  });
  it("omfattning, personnummer och citat", () => {
    expect(parseOrderPeriod("6 månader")).toBe("6");
    expect(parseOrderPeriod("12")).toBe("12");
    expect(parseOrderPeriod("Annan tidsperiod")).toBe("annan");
    expect(parseOrderPeriod("ett halvår")).toBe("");
    expect(parsePnr("19910412–1234")).toBe("19910412-1234");
    expect(parsePnr("910412 1234")).toBe("910412-1234");
    expect(parsePnr("12345")).toBe("");
    expect(ownText("Mitt svar\n\nFrån: någon <a@b.se>\nGammalt")).toBe("Mitt svar\n");
    expect(extractLabelled("Övrigt: inget").length).toBe(0);
  });
});
