// Listan med yrkesområden i mallen för mejlavrop (docs/lathund/mall-mejlavrop.md). Listan står aldrig i markdownfilen: avtalets
// aktiva avtalsområden (contract_areas) fylls i där platshållaren står när hjälpsidan visas (CLAUDE.md punkt 4 – avtalet är
// konfiguration, och ett nytt kommunavtal kan ha andra områden). Ren funktion utan I/O.

/** Raden i markdownfilen som ersätts med listan. En HTML-kommentar syns inte när filen läses som markdown. */
export const AREA_LIST_PLACEHOLDER = "<!-- yrkesområden: listan fylls i från avtalets avtalsområden när hjälpsidan visas -->";

/** Ett avtalsområde: bokstaven (koden) och namnet. */
export type HelpArea = { code: string; name: string };

/** Texten när listan inte kunde hämtas (eller avtalet saknar avtalsområden). */
export const AREA_LIST_MISSING = "Listan med yrkesområden kunde inte visas. Du ser yrkesområdena i formuläret Beställ ny insats.";

/**
 * Mallen med listan ifylld: en rad per avtalsområde ("- **G** Lager och logistik") och – om avtalet har ett område för det som
 * inte passar någon annanstans – en mening om det. areas null = listan hämtas fortfarande (platshållaren tas bort).
 */
export function withAreaList(md: string, areas: readonly HelpArea[] | null, otherAreaName: string | null = null): string {
  if (areas === null) return md.replace(`${AREA_LIST_PLACEHOLDER}\n`, "");
  const lines = areas.length
    ? [...areas.map((a) => `- **${a.code}** ${a.name}`), ...(otherAreaName ? ["", `Skriv **${otherAreaName}** om inget passar.`] : [])]
    : [AREA_LIST_MISSING];
  return md.replace(AREA_LIST_PLACEHOLDER, lines.join("\n"));
}
