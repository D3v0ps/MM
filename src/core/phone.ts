// Telefonnummer till E.164 (+46…) för SMS och utringning (46elks). Rena funktioner, isomorfa.
// Svenska nummer skrivs ofta "070-123 45 67", "08-123 456 78", "+46 70 123 45 67", "0046701234567" eller "+46 (0)70-123 45 67".
// Allt sådant blir "+46701234567". Andra länders nummer måste skrivas med + eller 00 först.
// Numret loggas aldrig – felorsakerna säger bara "fel format" (CLAUDE.md punkt 2).

/** E.164: plus, landsnummer och högst 15 siffror totalt. */
const E164 = /^\+[1-9]\d{6,14}$/;

/** Svenskt nationellt nummer efter +46: 7–9 siffror och första siffran inte 0. */
const SE_NATIONAL = /^[1-9]\d{6,8}$/;

/**
 * Telefonnumret i E.164-format, eller null om det inte går att tolka säkert.
 *   "070-123 45 67" → "+46701234567" · "+46 (0)70 123 45 67" → "+46701234567" · "0046701234567" → "+46701234567"
 *   "+4520123456" (Danmark) → "+4520123456" · "123" → null · "" → null
 */
export function toE164(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Bara siffror, mellanslag, bindestreck, punkter, snedstreck, parenteser och ett inledande plus.
  if (!/^\+?[\d\s\-./()]+$/.test(s)) return null;
  // "+46 (0)70 …": nollan inom parentes är riktnummerprefixet och ska bort.
  const compact = s.replace(/\(0\)/g, "").replace(/[\s\-./()]/g, "");
  let intl: string;
  if (compact.startsWith("+")) intl = compact;
  else if (compact.startsWith("00")) intl = `+${compact.slice(2)}`;
  else if (compact.startsWith("0")) intl = `+46${compact.slice(1)}`;
  else return null;
  if (intl.startsWith("+46")) {
    // "+460701234567": en extra nolla efter landsnumret är ett vanligt skrivfel.
    const national = intl.slice(3).replace(/^0/, "");
    return SE_NATIONAL.test(national) ? `+46${national}` : null;
  }
  return E164.test(intl) ? intl : null;
}

/** Har personen ett telefonnummer som går att skicka SMS eller ringa till? */
export const hasPhone = (raw: string | null | undefined): boolean => toE164(raw) !== null;

// ---------------------------------------------------------------- Svenska nummer (kommunens avtalsansvarig, Karims beslut 2026-11-27)
/** Ett svenskt nummer som det sparas: +46 och det nationella numret utan inledande nolla, t.ex. "+46701234567". */
export const SWEDISH_E164 = /^\+46[1-9]\d{6,8}$/;

/**
 * Ett svenskt nummer som användaren skrivit, sparat som E.164 ("+46…"), eller null. Bara siffror, mellanslag och bindestreck,
 * och numret börjar med 0 eller +46: "070-123 45 67", "0701234567", "+46 70 123 45 67" → "+46701234567". Utländska nummer,
 * "0046…", parenteser och punkter godtas inte här (toE164 ovan är friare – den gäller deltagarnas nummer för SMS).
 */
export function swedishPhoneE164(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!/^(\+46|0(?!0))[\d\s-]+$/.test(s)) return null;
  const e = toE164(s);
  return e && SWEDISH_E164.test(e) ? e : null;
}

/** Riktnummer med tre siffror (utöver 07x, som alltid har tre). 08 har två och alla andra fyra. */
const AREA_3 = new Set(["010", "011", "013", "016", "018", "019", "020", "021", "023", "026", "031", "033", "035", "036", "040", "042", "044", "046", "054", "060", "063", "090"]);

/** Abonnentnumret i grupper som i svensk standard: 5 → "123 45", 6 → "12 34 56", 7 → "123 45 67", 8 → "123 456 78". */
function subscriberGroups(d: string): string {
  const sizes: Record<number, number[]> = { 5: [3, 2], 6: [2, 2, 2], 7: [3, 2, 2], 8: [3, 3, 2] };
  const plan = sizes[d.length];
  if (!plan) return d.replace(/(\d{2})(?=\d)/g, "$1 ");
  const out: string[] = [];
  let i = 0;
  for (const n of plan) {
    out.push(d.slice(i, i + n));
    i += n;
  }
  return out.join(" ");
}

/**
 * Ett svenskt nummer som text med riktnummer och grupper: "+46701234567" → "070-123 45 67", "+46812345678" → "08-123 456 78".
 * Ett nummer som inte går att tolka som svenskt visas som det står.
 */
export function swedishPhoneText(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  const e = toE164(s);
  if (!e || !SWEDISH_E164.test(e)) return s;
  const national = `0${e.slice(3)}`;
  const areaLen = national.startsWith("08") ? 2 : national.startsWith("07") || AREA_3.has(national.slice(0, 3)) ? 3 : 4;
  return `${national.slice(0, areaLen)}-${subscriberGroups(national.slice(areaLen))}`;
}
