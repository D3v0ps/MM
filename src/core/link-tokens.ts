// Engångslänkar i utskick: deltagarens inspelningslänk (/rost/<token>) och pulslänken (/puls/<token>). Token är behörigheten
// (ingen inloggning), så den får aldrig sparas i klartext i utskicksloggen (outbound_messages.body) – där står bara
// "/rost/•••••". Hanterarna skriver sökvägen (de känner inte till appens adress); servern gör den till en fullständig
// adress med MM_APP_URL innan utskicket skickas (src/server/notify/queue.ts). Rena funktioner, används av minnesläget och servern.

const PATHS = ["rost", "puls"] as const;
/** Samma tecken som tokenkontrollen i hanterarna (bokstäver, siffror, - och _). */
const TOKEN = "[A-Za-z0-9_-]{8,200}";
/** Det som står i stället för token i utskicksloggen. */
export const TOKEN_MASK = "•••••";

/** Sökvägen utan adress framför: i början av texten eller efter mellanslag/parentes ("… en gång: /rost/abc…"). */
const RELATIVE = new RegExp(`(^|[\\s(])(/(?:${PATHS.join("|")})/${TOKEN})(?![A-Za-z0-9_-])`, "g");
/** Sökvägen med eller utan adress. */
const ANY = new RegExp(`(/(?:${PATHS.join("|")})/)${TOKEN}(?![A-Za-z0-9_-])`, "g");

/** Appens adress utan snedstreck på slutet, eller null om den saknas eller inte är en http(s)-adress. */
export function appBaseUrl(appUrl: string | null | undefined): string | null {
  const base = String(appUrl ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+$/.test(base) ? base : null;
}

/** "/rost/<token>" -> "https://www.miljonmatch.se/rost/<token>". Utan giltig adress ändras ingenting. */
export function absoluteLinks(body: string, appUrl: string | null | undefined): string {
  const base = appBaseUrl(appUrl);
  if (!base) return body;
  return body.replace(RELATIVE, (_m, pre: string, path: string) => `${pre}${base}${path}`);
}

/** Token i engångslänkarna byts mot "•••••" (adressen och sökvägen står kvar). */
export const maskLinkTokens = (body: string): string => body.replace(ANY, `$1${TOKEN_MASK}`);
