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
