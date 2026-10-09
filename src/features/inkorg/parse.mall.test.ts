// Mallen för mejlavrop (docs/lathund/mall-mejlavrop.md) ska alltid tolkas av parsern: den tomma mallen (första kodblocket)
// ifylld med påhittade testuppgifter och det ifyllda exemplet (andra kodblocket) ger alla obligatoriska fält och ett ärende
// som kan skapas automatiskt. Ändras parserns etiketter eller mallen måste de ändras tillsammans.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canCreateCase, parseInboundMail, REQUIRED_ORDER_FIELDS } from "./parse";

const MALL_PATH = fileURLToPath(new URL("../../../docs/lathund/mall-mejlavrop.md", import.meta.url));
const PREFIX = { casePrefix: "BOT" };

/** Kodblocken (```…```) i markdownfilen, i ordning. */
function codeBlocks(md: string): string[] {
  return [...md.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/** Fyll i den tomma mallen: värdet efter kolonet på raden vars etikett börjar med texten. */
function fillIn(template: string, values: Record<string, string>): string {
  return template
    .split("\n")
    .map((line) => {
      const hit = Object.entries(values).find(([label]) => line.startsWith(label));
      return hit ? `${line.replace(/\s*$/, "")} ${hit[1]}` : line;
    })
    .join("\n");
}

// Påhittade testuppgifter – personnumret har fel kontrollsiffra och tillhör ingen person.
const TEST_VALUES: Record<string, string> = {
  "Handläggarens namn": "Test Handläggarsson",
  "Enhet": "Arbetsmarknadsenheten Testby",
  "Handläggarens telefon": "08-123 45 67",
  "Handläggarens e-post": "test.handlaggarsson@kommun.example",
  "Önskat startdatum": "2027-03-01",
  "Omfattning": "12 månader",
  "Förnamn": "Test",
  "Efternamn": "Testsson",
  "Personnummer": "19900101-1234",
  "Deltagarens telefonnummer": "070-000 00 00",
  "Deltagarens e-postadress": "test.testsson@example.invalid",
  "Bostadsort": "Testby",
  "Föredragen kontaktväg": "telefon",
  "Kartläggning genomförd": "Nej",
  "Bakgrundsinformation:": "Har arbetat i restaurang.",
};

describe("mallen för mejlavrop (docs/lathund/mall-mejlavrop.md)", () => {
  const md = readFileSync(MALL_PATH, "utf8");
  const [blank, example] = codeBlocks(md);

  it("filen har en tom mall och ett ifyllt exempel", () => {
    expect(blank).toBeTruthy();
    expect(example).toBeTruthy();
    // Den tomma mallen har inga värden – bara etiketter och avsnittsrubriker.
    for (const line of blank.split("\n").filter((l) => l.includes(":"))) expect(line.trim().endsWith(":"), line).toBe(true);
  });

  it("den tomma mallen tolkas inte som en beställning av misstag – men blir det när den fylls i", () => {
    const empty = parseInboundMail({ subject: "Avrop – ny insats", bodyText: blank }, PREFIX);
    expect(empty.kind).toBe("order");
    expect(empty.extracted).toEqual({});
    expect(empty.missingFields).toEqual([...REQUIRED_ORDER_FIELDS]);
    expect(canCreateCase(empty.extracted)).toBe(false);

    const filled = parseInboundMail({ subject: "Avrop – ny insats", bodyText: `Hej!\n\n${fillIn(blank, TEST_VALUES)}\n\nMed vänlig hälsning\nTest Handläggarsson` }, PREFIX);
    expect(filled.kind).toBe("order");
    expect(filled.parseMethod).toBe("template");
    expect(filled.caseNumber).toBeNull();
    expect(filled.missingFields).toEqual([]);
    expect(filled.extracted).toEqual({
      referrerName: "Test Handläggarsson", referrerUnit: "Arbetsmarknadsenheten Testby", referrerPhone: "08-123 45 67", referrerEmail: "test.handlaggarsson@kommun.example",
      desiredStart: "2027-03-01", orderPeriod: "12", firstName: "Test", lastName: "Testsson", pnr: "19900101-1234", phone: "070-000 00 00",
      email: "test.testsson@example.invalid", city: "Testby", preferredContact: "phone", priorAssessment: "nej", background: "Har arbetat i restaurang.",
    });
    for (const k of REQUIRED_ORDER_FIELDS) expect(filled.confidence[k], k).toBe(1);
    expect(canCreateCase(filled.extracted)).toBe(true);
  });

  it("annan tidsperiod med slutdatum och motivering tolkas", () => {
    const r = parseInboundMail(
      { subject: "Beställning", bodyText: fillIn(blank, { ...TEST_VALUES, Omfattning: "annan tidsperiod", Slutdatum: "2027-06-30", Motivering: "Deltagaren har en anställning som börjar i juli." }) },
      PREFIX,
    );
    expect(r.extracted).toMatchObject({ orderPeriod: "annan", plannedEnd: "2027-06-30", orderPeriodReason: "Deltagaren har en anställning som börjar i juli." });
    expect(r.missingFields).toEqual([]);
  });

  it("det ifyllda exemplet i filen tolkas med alla obligatoriska fält och kan bli ett ärende", () => {
    const r = parseInboundMail({ subject: "Avrop – ny insats", bodyText: example }, PREFIX);
    expect(r.kind).toBe("order");
    expect(r.parseMethod).toBe("template");
    expect(r.missingFields).toEqual([]);
    expect(r.extracted).toMatchObject({
      referrerName: "Test Handläggarsson", referrerUnit: "Arbetsmarknadsenheten Testby", referrerPhone: "08-123 45 67", desiredStart: "2027-03-01", orderPeriod: "6",
      firstName: "Test", lastName: "Testsson", pnr: "19900101-1234", city: "Testby", preferredContact: "sms", priorAssessment: "ja",
      background: "Har arbetat i butik och lager i tre år.\nVill gärna arbeta med logistik. Talar svenska och arabiska.",
    });
    // Hälsningsfrasen efter den tomma raden hör inte till bakgrunden.
    expect(r.extracted.background).not.toMatch(/hälsning/);
    expect(canCreateCase(r.extracted)).toBe(true);
  });
});
