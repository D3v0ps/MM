// Sista kontrollen före utskick: texten får aldrig innehålla ett personnummer (CLAUDE.md punkt 9).
// Hanterarna skriver bara ärendenummer och "logga in" – den här kontrollen fångar misstag.
//
// Känner igen personnummer och samordningsnummer med eller utan sekel och skiljetecken:
//   19750818-8340 · 750818-8340 · 750818+8340 · 7508188340 · 197508188340 · 750878-8340 (samordningsnummer, dag + 60)
// Datumdelen måste vara ett rimligt datum (månad 01–12, dag 01–31 eller 61–91), så att ärendenummer (BOT-26-0042),
// telefonnummer (08-000 00 00) och beställarreferenser som inte ser ut som datum inte stoppas i onödan.
// Kontrollsiffran kontrolleras inte med avsikt: testdatats personnummer har fel kontrollsiffra och ska ändå fångas.

const CANDIDATE = /(?<!\d)((?:19|20)?)(\d{2})(\d{2})(\d{2})[-+ ]?(\d{4})(?!\d)/g;

function plausibleDate(mm: string, dd: string): boolean {
  const m = Number(mm);
  const d = Number(dd);
  if (m < 1 || m > 12) return false;
  return (d >= 1 && d <= 31) || (d >= 61 && d <= 91);
}

/** Innehåller texten något som ser ut som ett personnummer eller samordningsnummer? */
export function containsPersonnummer(text: string | null | undefined): boolean {
  const s = String(text ?? "");
  for (const m of s.matchAll(CANDIDATE)) {
    if (plausibleDate(m[3], m[4])) return true;
  }
  return false;
}
