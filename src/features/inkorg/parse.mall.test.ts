// Mallen för mejlavrop (docs/lathund/mall-mejlavrop.md) ska alltid tolkas av parsern: den tomma mallen (första kodblocket)
// ifylld med påhittade testuppgifter och det ifyllda exemplet (andra kodblocket) ger alla obligatoriska fält och ett ärende
// som kan skapas automatiskt. Ändras parserns etiketter eller mallen måste de ändras tillsammans. Mallen följer portalens
// formulär (beslut 2026-10-09): yrkesområde i stället för bostadsort, ingen kontaktväg och kartläggning ja eller nej.
// Listan med yrkesområden står inte i filen: hjälpsidan fyller i avtalets aktiva avtalsområden (contract_areas) där
// platshållaren står (src/features/hjalp/areas.ts) – testet läser dem ur avtalet, inte ur testdatats konstanter.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { AREA_LIST_PLACEHOLDER, withAreaList } from "@/features/hjalp/areas";
import { kommunOrderForm } from "@/features/kommun/api";
import type { KomOrderForm } from "@/features/kommun/api";
import { canCreateCase, parseArea, parseInboundMail, REQUIRED_ORDER_FIELDS, type AreaRef } from "./parse";

const MALL_PATH = fileURLToPath(new URL("../../../docs/lathund/mall-mejlavrop.md", import.meta.url));
/** Avtalets aktiva avtalsområden som kommunens handläggare ser dem (samma fråga som formuläret och hjälpsidan). */
let FORM: KomOrderForm;
let AREA_REFS: AreaRef[];
const prefix = () => ({ casePrefix: "BOT", areas: AREA_REFS });
beforeAll(async () => {
  const rt = createMemoryRuntime({ data: createSeed(), clock: demoClock(DEMO_START) });
  const maria = listPersonas(rt.raw()).find((p) => p.actor.userId === "k-maria")!.actor;
  FORM = (await rt.run("query", kommunOrderForm.key, {}, maria)) as KomOrderForm;
  AREA_REFS = FORM.areas.map((a) => ({ code: a.value, name: a.label }));
});

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
  "Yrkesområde": "Kök, restaurang och måltidsservice",
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
    // Samma fält som portalen: yrkesområde, ingen bostadsort, ingen kontaktväg och inget "vet inte".
    expect(blank).toMatch(/^Yrkesområde[^\n]*:$/m);
    expect(md).not.toMatch(/Bostadsort|Föredragen kontaktväg|vet inte/i);
  });

  it("den tomma mallen tolkas inte som en beställning av misstag – men blir det när den fylls i", () => {
    const empty = parseInboundMail({ subject: "Avrop – ny insats", bodyText: blank }, prefix());
    expect(empty.kind).toBe("order");
    expect(empty.extracted).toEqual({});
    expect(empty.missingFields).toEqual([...REQUIRED_ORDER_FIELDS]);
    expect(canCreateCase(empty.extracted)).toBe(false);

    const filled = parseInboundMail({ subject: "Avrop – ny insats", bodyText: `Hej!\n\n${fillIn(blank, TEST_VALUES)}\n\nMed vänlig hälsning\nTest Handläggarsson` }, prefix());
    expect(filled.kind).toBe("order");
    expect(filled.parseMethod).toBe("template");
    expect(filled.caseNumber).toBeNull();
    expect(filled.missingFields).toEqual([]);
    expect(filled.extracted).toEqual({
      referrerName: "Test Handläggarsson", referrerUnit: "Arbetsmarknadsenheten Testby", referrerPhone: "08-123 45 67", referrerEmail: "test.handlaggarsson@kommun.example",
      desiredStart: "2027-03-01", orderPeriod: "12", firstName: "Test", lastName: "Testsson", pnr: "19900101-1234", phone: "070-000 00 00",
      email: "test.testsson@example.invalid", primaryArea: "D", priorAssessment: "nej", background: "Har arbetat i restaurang.",
    });
    for (const k of REQUIRED_ORDER_FIELDS) expect(filled.confidence[k], k).toBe(1);
    expect(canCreateCase(filled.extracted)).toBe(true);
  });

  it("annan tidsperiod med slutdatum och motivering tolkas", () => {
    const r = parseInboundMail(
      { subject: "Beställning", bodyText: fillIn(blank, { ...TEST_VALUES, Omfattning: "annan tidsperiod", Slutdatum: "2027-06-30", Motivering: "Deltagaren har en anställning som börjar i juli." }) },
      prefix(),
    );
    expect(r.extracted).toMatchObject({ orderPeriod: "annan", plannedEnd: "2027-06-30", orderPeriodReason: "Deltagaren har en anställning som börjar i juli." });
    expect(r.missingFields).toEqual([]);
  });

  it("det ifyllda exemplet i filen tolkas med alla obligatoriska fält och kan bli ett ärende", () => {
    const r = parseInboundMail({ subject: "Avrop – ny insats", bodyText: example }, prefix());
    expect(r.kind).toBe("order");
    expect(r.parseMethod).toBe("template");
    expect(r.missingFields).toEqual([]);
    expect(r.extracted).toMatchObject({
      referrerName: "Test Handläggarsson", referrerUnit: "Arbetsmarknadsenheten Testby", referrerPhone: "08-123 45 67", desiredStart: "2027-03-01", orderPeriod: "6",
      firstName: "Test", lastName: "Testsson", pnr: "19900101-1234", primaryArea: "G", priorAssessment: "ja",
      background: "Har arbetat i butik och lager i tre år.\nVill gärna arbeta med logistik. Talar svenska och arabiska.",
    });
    expect(r.extracted).not.toHaveProperty("city");
    expect(r.extracted).not.toHaveProperty("preferredContact");
    // Hälsningsfrasen efter den tomma raden hör inte till bakgrunden.
    expect(r.extracted.background).not.toMatch(/hälsning/);
    expect(canCreateCase(r.extracted)).toBe(true);
  });

  it("listan med yrkesområden står inte i filen – platshållaren fylls i från avtalets contract_areas", () => {
    const section = md.split(/^## /m).find((x) => x.startsWith("Yrkesområden"));
    expect(section, "avsnittet Yrkesområden").toBeTruthy();
    // Inga hårdkodade avtalsområden (CLAUDE.md punkt 4) och ingen hårdkodad "Övrigt".
    expect(section!.split("\n").filter((l) => l.includes(AREA_LIST_PLACEHOLDER))).toHaveLength(1);
    expect(section).not.toMatch(/^- \*\*[A-Z]\*\* /m);
    expect(md).not.toMatch(/Övrigt/);
    // Hjälpsidan: listan byggs av avtalets aktiva avtalsområden – varje rad tolkas till samma kod (namn och bokstav).
    expect(AREA_REFS.length).toBeGreaterThan(0);
    const filled = withAreaList(md, AREA_REFS, FORM.otherAreaName);
    const listed = [...filled.matchAll(/^- \*\*(\S+)\*\* (.+)$/gm)].map((m) => ({ code: m[1], name: m[2].trim() }));
    expect(listed).toEqual(AREA_REFS);
    for (const a of listed) {
      expect(parseArea(a.name, AREA_REFS), a.name).toEqual({ code: a.code, exact: true });
      expect(parseArea(a.code, AREA_REFS), a.code).toEqual({ code: a.code, exact: true });
    }
    expect(filled).not.toContain(AREA_LIST_PLACEHOLDER);
    if (FORM.otherAreaName) expect(filled).toContain(`Skriv **${FORM.otherAreaName}** om inget passar.`);
  });

  it("ett annat avtal får sin egen lista – och utan områden en text i stället för listan", () => {
    const other = [{ code: "A", name: "Testområde ett" }, { code: "B", name: "Testområde två" }];
    const filled = withAreaList(md, other, null);
    expect(filled).toContain("- **A** Testområde ett\n- **B** Testområde två");
    expect(filled).not.toMatch(/om inget passar/);
    expect(withAreaList(md, [], null)).toContain("Listan med yrkesområden kunde inte visas.");
    // Medan listan hämtas tas platshållaren bort.
    expect(withAreaList(md, null)).not.toContain(AREA_LIST_PLACEHOLDER);
  });
});
