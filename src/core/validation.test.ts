import { describe, expect, it } from "vitest";
import { BOTKYRKA_CONFIG } from "./config";
import { cfgWith } from "./test-data";
import {
  buyerRefError, buyerRefValid, emailValid, looksLikePnr, luhn, normalizePnr, pnrFormatValid, pnrLast4, pnrValid, PNR_SCRUBBED, poNumberError, poNumberFormatText, poNumberValid, scrubPnr,
} from "./validation";

const cfg = BOTKYRKA_CONFIG;

describe("beställarreferens (8–10 siffror enligt Botkyrkas konfiguration)", () => {
  it("godtar 8, 9 och 10 siffror och tar bort mellanslag runt om", () => {
    expect(buyerRefValid("55102938", cfg)).toBe(true);
    expect(buyerRefValid("551029381", cfg)).toBe(true);
    expect(buyerRefValid("4410023817", cfg)).toBe(true);
    expect(buyerRefValid(" 55102938 ", cfg)).toBe(true);
  });
  it("underkänner för få, för många och annat än siffror", () => {
    expect(buyerRefValid("5510293", cfg)).toBe(false);
    expect(buyerRefValid("44100238170", cfg)).toBe(false);
    expect(buyerRefValid("5510-2938", cfg)).toBe(false);
    expect(buyerRefValid("", cfg)).toBe(false);
    expect(buyerRefValid(null, cfg)).toBe(false);
  });
  it("ger prototypens felmeddelanden", () => {
    expect(buyerRefError("", cfg)).toBe("Beställarreferens saknas. Den får ni av kommunens ekonomi eller er chef.");
    expect(buyerRefError(null, cfg)).toBe("Beställarreferens saknas. Den får ni av kommunens ekonomi eller er chef.");
    expect(buyerRefError("5510 2938", cfg)).toBe("Beställarreferensen får bara innehålla siffror – inga mellanslag, bindestreck eller bokstäver.");
    expect(buyerRefError("BOT-27-0049", cfg)).toBe("Beställarreferensen får bara innehålla siffror – inga mellanslag, bindestreck eller bokstäver.");
    expect(buyerRefError("1234567", cfg)).toBe("Beställarreferensen ska vara 8–10 siffror. Du har skrivit 7.");
    expect(buyerRefError("12345678901", cfg)).toBe("Beställarreferensen ska vara 8–10 siffror. Du har skrivit 11.");
    expect(buyerRefError("55102938", cfg)).toBeNull();
  });
  it("läser antalet siffror ur konfigurationen", () => {
    const six = cfgWith((c) => { c.billing.buyerReference.pattern = "^[0-9]{6}$"; });
    expect(buyerRefValid("123456", six)).toBe(true);
    expect(buyerRefValid("55102938", six)).toBe(false);
    expect(buyerRefError("12345", six)).toBe("Beställarreferensen ska vara 6 siffror. Du har skrivit 5.");
  });
});

describe("inköpsordernummer (kommunens, nio siffror som börjar med 99)", () => {
  it("godtar bara kommunens format", () => {
    expect(poNumberValid("991234567", cfg)).toBe(true);
    expect(poNumberValid("981234567", cfg)).toBe(false);
    expect(poNumberValid("99123456", cfg)).toBe(false);
    expect(poNumberValid("9912345678", cfg)).toBe(false);
  });
  it("våra egna nummer (ärendenummer) godtas aldrig som inköpsordernummer", () => {
    expect(poNumberValid("BOT-27-0049", cfg)).toBe(false);
    expect(poNumberValid("270049", cfg)).toBe(false);
  });
  it("beskriver formatet ur mönstret och ger prototypens text", () => {
    expect(poNumberFormatText(cfg)).toBe("nio siffror som börjar med 99");
    expect(poNumberError("", cfg)).toBeNull();
    expect(poNumberError("991234567", cfg)).toBeNull();
    expect(poNumberError("12345", cfg)).toBe("Inköpsordernummer ska vara nio siffror som börjar med 99.");
  });
});

describe("personnummer", () => {
  it("format ÅÅÅÅMMDD-NNNN eller ÅÅMMDD-NNNN", () => {
    expect(pnrFormatValid("19811218-9876")).toBe(true);
    expect(pnrFormatValid("811218-9876")).toBe(true);
    expect(pnrFormatValid("8112189876")).toBe(true);
    expect(pnrFormatValid("811218+9876")).toBe(true);
    expect(pnrFormatValid("1981-12-18")).toBe(false);
    expect(pnrFormatValid("81121-9876")).toBe(false);
  });
  it("Luhn-kontroll på de tio sista siffrorna", () => {
    expect(luhn("8112189876")).toBe(true);
    expect(luhn("8112189875")).toBe(false);
    expect(pnrValid("19811218-9876")).toBe(true);
    expect(pnrValid("19811218-9875")).toBe(false);
  });
  it("normalisering för sökning och dubbletter", () => {
    expect(normalizePnr("19811218-9876")).toBe("8112189876");
    expect(normalizePnr("811218-9876")).toBe("8112189876");
    expect(pnrLast4("19811218-9876")).toBe("9876");
  });
  // Spärren för fri text (kommunens meddelanden och anteckningar i deltagarkortet).
  it("looksLikePnr: vanliga skrivsätt stoppas – även tankstreck, andra streck och mellanslag runt strecket", () => {
    for (const s of [
      "850101-1234", "19850101-1234", "8501011234", "850101+1234", "850101 1234",
      "Handläggaren bekräftade 850101\u20131234 i går.", // tankstreck (Word/Outlook)
      "19850101\u20131234", "850101\u20101234", "850101\u20111234", "850101\u20141234", "850101\u22121234", // ‐ ‑ — −
      "850101 - 1234", "850101 \u2013 1234", "850101\u00a01234", // mellanslag runt strecket, hårt mellanslag
      "\uff18\uff15\uff10\uff11\uff10\uff11\uff0d\uff11\uff12\uff13\uff14", // helbreddssiffror och helbreddsstreck
    ]) expect(looksLikePnr(s), s).toBe(true);
  });
  it("looksLikePnr: ärendenummer, datum, telefonnummer och id:n är inte personnummer", () => {
    for (const s of ["BOT-26-0143", "case-260143", "rep-16008", "Ring 070-123 45 67", "Mötet 2027-02-01 kl. 10", "Ärende 260143, vecka 1234", "", null, undefined]) {
      expect(looksLikePnr(s), String(s)).toBe(false);
    }
  });
  // Underlaget till AI-utkastet (beslut 4 2026-10-09): coachernas anteckningar tvättas innan de skickas.
  it("scrubPnr: alla skrivsätt ersätts – och efteråt ser texten inte ut att innehålla något personnummer", () => {
    expect(scrubPnr("Handläggaren bekräftade 850101\u20131234 i går och 19850101 1234.")).toBe(`Handläggaren bekräftade ${PNR_SCRUBBED} i går och ${PNR_SCRUBBED}.`);
    for (const s of ["850101-1234", "19850101-1234", "8501011234", "850101 - 1234", "\uff18\uff15\uff10\uff11\uff10\uff11\uff0d\uff11\uff12\uff13\uff14"]) {
      expect(looksLikePnr(scrubPnr(`Text ${s} text`)), s).toBe(false);
    }
    expect(scrubPnr("BOT-26-0143 · Ring 070-123 45 67 · 2027-02-01")).toBe("BOT-26-0143 · Ring 070-123 45 67 · 2027-02-01");
  });
});

describe("e-post", () => {
  it("kräver namn, @ och domän med punkt", () => {
    expect(emailValid("maria.ekdahl@botkyrka.se")).toBe(true);
    expect(emailValid("maria.ekdahl@botkyrka")).toBe(false);
    expect(emailValid("maria ekdahl@botkyrka.se")).toBe(false);
    expect(emailValid("")).toBe(false);
  });
});
