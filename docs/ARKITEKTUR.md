# Arkitektur – en kodbas, två körlägen

**Målet:** när någon testar prototypen ska den vara som riktiga sidan. Därför är prototypen inte en egen app. Den är riktiga appen byggd till en HTML-fil med påhittade testdata.

| | Riktiga appen (Next.js) | Prototypen (artefakt) |
|---|---|---|
| Skärmar, layouter, rutter | `src/features/*`, `src/shell/*`, `src/ui/*` | **samma** |
| API-hanterare och domänlogik | `src/features/*/handlers.ts`, `src/core/*` | **samma** |
| Var hanterarna körs | Servern (`POST /api/rpc`) | I webbläsaren |
| Datalager | Supabase + RLS (efter godkänd plan). Tills dess `MemoryRepo` med testdata (`MM_BACKEND=memory`) | `MemoryRepo` med testdata |
| Behörighet | RLS i Postgres + rollkontroll i `execute()` | `src/data/policy.ts` (speglar RLS) + samma rollkontroll |
| Inloggning | Microsoft (MB) och e-postkod (kommunen). Utvecklingsläget: välj testperson | Rollväljaren i prototypfältet |
| Navigering | Riktiga URL:er (`/arenden/case-1`), grunda byten med `history.pushState/replaceState` – inget serveranrop per sida | Hash-URL:er (`#/arenden/case-1`) |
| Klocka | Stockholms tid. Minnesläget: demoklockan | Demoklockan: 1 februari 2027 kl. 09.12, +1 minut per kommando |
| Bara i prototypen | – | Prototypfältet (perspektiv, roll, scenarier, feedback, återställ) och `<DemoOnly>`-förklaringar |

## Mappar

```
src/
  core/        Ren domänlogik utan React och utan I/O: tid, helgdagar, format, validering, avtalskonfiguration (zod),
               fakturering, KPI:er, SLA, progression, närvaro. Enhetstestas med Vitest (*.test.ts bredvid filen).
  data/        schema.ts (typer per tabell, SPEC §6.1) · repo.ts (Repo-gränssnittet) · memory.ts (MemoryRepo)
               policy.ts (läsregler per tabell = RLS-spegel) · actors.ts (användare -> Actor, testpersoner)
               seed/ (påhittade testdata, deterministiska) · memory-runtime.ts (kör API:t mot minnet)
  api/         contract.ts (query/command-kontrakt) · server.ts (register, Ctx, execute) · roles.ts · handlers.ts (registrerar alla)
  features/<område>/            (vecka = Min vecka för alla MB-roller, väljer rollens skärm i respektive område)
               api.ts        kontrakt: frågor och kommandon med zod-scheman och resultattyper (importeras av skärmar)
               handlers.ts   hanterare (importeras ALDRIG av skärmar – bara av src/api/handlers.ts)
               screens/*.tsx skärmar ("use client")
               routes.ts     rutter för området
  shell/       app.tsx (väljer rutt och layout) · nav.tsx · session.tsx · backend.tsx (useQuery/useCommand)
               routes.ts · route-table.ts · layouts.tsx · runtime.tsx (DemoOnly)
  ui/          MB:s komponentbibliotek (se src/ui/README.md)
  app/         Next.js: layout, catch-all-sidan som renderar src/shell/app.tsx, /api/rpc, /api/dev-session
               (/api/dev-session bara i minnesläget: välj testperson; med testerId simuleras en testare i testmiljön för
               e2e och utveckling – då sätts Actor.testerId, raden Testmiljö med "Lämna synpunkt" och "Alla synpunkter"
               visas (src/server/memory-session-view.ts, session.isTester) och src/api/tester-access.ts gäller)
  server/      Serverns datalager och session (import "server-only")
  demo/        Prototypens startpunkt, backend i webbläsaren, prototypfält, scenarier och feedback
tests/e2e/     Playwright – varje test körs mot både prototypen (projekt "demo") och appen (projekt "app")
```

## Dataflödet

```
Skärm ── useQuery(inboxList, params) ──► Backend ──► execute("query", key, input, ctx) ──► hanterare(ctx, params)
                                          │                                                   │
               prototypen: i webbläsaren ─┘                                  ctx.repo.table("cases").list({ status: "active" })
               riktiga appen: POST /api/rpc                                                    │
                                                                MemoryRepo (policy.ts)  eller  SupabaseRepo (RLS)
```

- `execute()` validerar indata med zod och kontrollerar rollen innan hanteraren körs.
- Efter ett lyckat kommando räknar `useCommand` om **exakt de frågor kommandot anger**: `command(key, schema, { invalidates })` är obligatoriskt – prefix på frågornas nycklar med de namngivna grupperna i `src/api/invalidation.ts` (`CARD` = kortet och alla flikar, `CASES`, `COACH`, `PORTAL`, `REPORTS`, `MGMT`, `START`, `INBOX`, `BILLING`, `NAV`, `LOG`, `CASE_FACTS` = allt som räknar KPI:er, flaggor, deadlines och fakturering), `"none"` för kommandon som bara loggar eller lämnar ut (`session.auditView`, `rost.notesSeen`, visa personnummer, nedladdningar, förhandsvisningar) och `"all"` bara med motivering i en kommentar (`admin.runJob` – bakgrundsjobbets följder är inte kända i förväg). Mängden bestäms av vilka tabeller kommandot skriver, inte av vad som råkar vara aktivt på skärmen: prototypen (`staleTime` oändlig) hämtar aldrig om en fråga som inte räknas om. Kontrollen `src/api/invalidation.test.ts` spårar vilka tabeller varje fråga läser och kräver att varje kommando räknar om de frågor som listar en tabell det skriver (uppslag med `get(id)`, namn- och konfigurationstabeller och andra användares notiser undantagna, med orsak). En skärm kan välja en egen mängd: `useCommand(auditView, { invalidate: ["admin."] })`.
- `useQuery(def, params, { keepPrevious: true })` visar föregående svar medan nästa hämtas (filter och månad på samma ärende – aldrig vid byte av ärende). `usePrefetch()` förhämtar med samma nyckel som `useQuery` (flikar vid pekning/fokus, mejl i inkorgen).
- Resultat serialiseras som JSON i båda körlägena, så prototypen beter sig exakt som över HTTP.

## Så bygger du ett område

### 1. Kontrakt – `src/features/<område>/api.ts`

```ts
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";

export type InboxRow = { emailId: string; caseId: string | null; caseNumber: string | null; receivedAt: string; subject: string; status: string; slaDueAt: string | null };
export const inboxList = query("inkorg.list", z.object({ filter: z.enum(["att_hantera", "alla"]) })).returns<InboxRow[]>();

export const caseAccept = command("arende.acceptera", z.object({
  caseId: z.string(), leadCoachId: z.string(), firstMeetingAt: z.string(), plannedWeeks: z.number().int().min(1), buyerReference: z.string(),
})).returns<Result<{ reportId: string }, "buyer_ref" | "not_found" | "wrong_status">>();
```

- Nyckeln är `"<område>.<namn>"`, unik i hela appen.
- Resultatet är en **vy-modell**: bara de fält skärmen behöver och rollen får se. Skicka aldrig hela rader "för säkerhets skull".
- Affärsfel returneras som `fail("buyer_ref", "Text till användaren")`, inte som undantag.

### 2. Hanterare – `src/features/<område>/handlers.ts`

```ts
import { handleCommand, handleQuery } from "@/api/server";
import { fail, ok } from "@/api/contract";
import { inboxList, caseAccept } from "./api";

handleQuery(inboxList, { roles: ["samordnare", "avtalsansvarig"] }, async (ctx, p) => {
  const emails = await ctx.repo.table("inbound_emails").list({ status: { neq: "archived" } }, { orderBy: "receivedAt", desc: true });
  return emails.map((e) => ({ ... }));
});

handleCommand(caseAccept, { roles: ["samordnare", "avtalsansvarig"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found");
  ...
  await ctx.repo.table("cases").update(c.id, { status: "confirmed", confirmedAt: ctx.now() });
  await ctx.audit({ action: "case.accept", entity: "case", entityId: c.id, contractId: c.contractId });
  await ctx.notify({ channel: "email", to: referrer.email, template: "orderbekraftelse", body: `Ärende ${c.caseNumber} är bekräftat. Logga in för att läsa.`, caseId: c.id });
  return ok({ reportId });
});
```

Regler för hanterare:

1. **Deterministiska.** Tid bara via `ctx.now()`, id bara via `ctx.newId("prefix")`. Aldrig `Date.now()`, `new Date()` eller `Math.random()`. Prototypen spelar upp kommandon igen vid omladdning.
2. **Läs och skriv via `ctx.repo`**, som filtreras av behörigheten (RLS i produktion, `policy.ts` i minnet). `ctx.system` (utan filter, motsvarar service role) bara för systemsteg: löpnummer, revisionslogg, notiser till andra användare, bakgrundsjobb. Skriv en kommentar när du använder den.
3. **Rollkontroll** i `roles` på varje hanterare. Åtkomsten till ärendet sköter policyn (avtal + roll; alla på Miljonbemanning ser alla ärenden i avtalet sedan 2026-10-09, kommunen bara sina egna), men kommandon ska ändå kontrollera att ärendet finns via `ctx.repo`. Tilldelningen (huvudcoach och team) styr inte åtkomsten – bara notiser, påminnelser och listorna Mina ärenden, Min vecka, Närvaro och Mina tilldelade ärenden (hanterarna filtrerar på `leadCoachId` respektive `case_team` själva).
4. **Revisionslogg** (`ctx.audit`) för visning av deltagarkort, rapport och transkript, alla ändringar, exporter och AI-körningar.
5. **Utskick** bara via `ctx.notify`. Texten innehåller aldrig personuppgifter – bara ärendenummer och "logga in för att läsa".
6. **Avtalsvärden från konfigurationen** (`contracts.config`, zod-validerad i `src/core/config.ts`). Hårdkoda aldrig 32 %, 35 %, BOT, priser eller deadlines. Värden `ATT_FASTSTÄLLA` visas som "Ej fastställt".
7. **AI föreslår – människan bedömer.** Bedömningsfält är tomma tills coachen valt. Aldrig AI för skyddade ärenden (vilande spärr, se 8).
8. **Skyddade personuppgifter – vilande spärr (beslut 2026-10-07, Karim).** Skyddet är borttaget ur appen: frågan ställs inte, testdatat har inga skyddade ärenden och inget i gränssnittet visar eller hanterar skyddad identitet. Spärren ligger kvar vilande i databasen och i koden – RLS och `src/data/policy.ts` för `protected_identity`, `Viewer.isProtected`, kontrollerna i hanterarna (ingen adress, inga SMS/mejl till deltagaren, ingen AI, bara namngiven coach och avtalsansvarig). Kolumnen är alltid false. Ta inte bort kontrollerna: om Botkyrka kräver skyddet slås det på igen utan ny migration. Testerna (`policy.test.ts`, `rls-parity.test.ts` och hanterartesterna) slår på spärren för en person i testet och kontrollerar att den fortfarande fungerar.
8b. **Personnummer bara via `ctx.crypto`** (`encryptPnr`, `decryptPnr`, `hashPnr`) – hjälparna i `src/features/_shared/pnr.ts` (`protectPnr(ctx.crypto, pnr)`, `pnrSearchHash(ctx.crypto, pnr)`, `revealPnr(ctx.crypto, person)`). Minnesläget: testdatats ersättning (`TEST_PNR_CRYPTO`); servern: AES-256-GCM + HMAC-SHA256 (`src/server/crypto.ts`). Importera aldrig `encodeTestPnr`/`decodeTestPnr`/`testPnrHash` i en hanterare.
9. Beräkningar hör hemma i `src/core` (rena funktioner med tester). Hanteraren hämtar data och anropar dem.

### 3. Skärmar – `src/features/<område>/screens/*.tsx`

```tsx
"use client";
import { useQuery, useCommand } from "@/shell/backend";
import { Link, useNav } from "@/shell/nav";
import { DemoOnly } from "@/shell/runtime";
import { Page, Card, Button, Table, Notice } from "@/ui";
import { inboxList } from "../api";

export function InkorgScreen({ params, query }: ScreenProps) {
  const q = useQuery(inboxList, { filter: "att_hantera" });
  ...
}
```

Regler för skärmar:

- Importera bara `api.ts` (kontrakt), aldrig `handlers.ts`, `src/data/*` eller `src/server/*`.
- Ingen `next/*`-import i skärmar, `src/ui` eller `src/shell` (utom `src/app/**`). Länkar med `<Link to>`, navigering med `useNav()`.
- Ingen `alert/confirm/prompt`, ingen `<a download>`, ingen `window.print()` – använd komponenterna i `src/ui` (dialog, nedladdning, förhandsvisning).
- Förklaringar av vad som är simulerat och genvägar mellan perspektiv ligger i `<DemoOnly>` – allt annat är likadant i appen.
- Laddning: visa `<Loading />` medan `isLoading`, och `<ErrorNotice />` vid fel.
- Svenska i klarspråk. Kommunportalen: korta meningar, inga förkortningar, hjälptext vid varje fält, en sak per skärm, 18 px text.
- Tillgänglighet: varje fält har `id` + `label`, klickytor minst 44 × 44 px, allt fungerar med tangentbord, status alltid text + ikon.
- Visningslogg (`useAuditView` i `src/ui/case.tsx`): deltagarkort, rapport och transkript loggas **en gång per sidbesök** – minnet (`src/shell/audit-views.ts`) töms av skalet när en annan sida visas, inte vid flikbyte. Röstmeddelandenas text loggas vid **varje utfällning** (`rost.notesSeen` körs när "Läs" trycks eller när `?visa=rost` fäller ut raden – inte när kortet laddas); "nytt" räknas bort först när coachen markerar som granskat. Beslut 2026-10-02.
- Färger bara via temat (`antracit`, `rod`, `ljusgra`, `bla`, `vit` och `-ton`-varianterna). Inget grönt.

### Navigering och sidbyten (samma i appen och prototypen)

- **Grunda byten.** `nav.push`/`nav.replace` byter adress utan att ladda om och utan serveranrop: appen med `history.pushState/replaceState` (Next synkar `usePathname`/`useSearchParams`, se `node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md`), prototypen med hashen. Skalet (`ClientRoot`) ligger i `src/app/(app)/layout.tsx` och ligger kvar mellan sidbyten; sidan själv är tom. Ingen `next/link` och ingen `useRouter` (de hämtar sidan från servern). `<Link to>` fångar vanliga klick; ctrl/cmd-klick och mittenklick lämnas till webbläsaren (ny flik).
- **Historikposter.** Varje post har en nyckel (`nav.entry`: `load`, `push`, `replace` eller `pop`). Flikbyte och filter = `replace` (samma post, Tillbaka lämnar sidan). Att öppna något annat = `push`. Vakter före navigering: `onBeforeNavigate` i `src/shell/nav.tsx`. Tillbaka/framåt mellan poster från samma dokument görs utan serveranrop. Poster från ett tidigare dokument (före en omladdning, eller efter ett besök på en annan webbplats som inte låg kvar i webbläsarens sidcache) bär det dokumentets interna Next-tillstånd, som Next inte kan visa rätt – appen laddar då om sidan på postens adress, och skrollen återställs efter omladdningen. Kontrollen ligger i ett skript som körs före hydreringen (`src/app/_shell/pop-guard.ts`, `next/script` `beforeInteractive` i `src/app/layout.tsx`): lyssnare på `window` körs i den ordning de lades till, och Next lägger sin vid hydreringen. `next-nav.tsx` för listan över det egna dokumentets nycklar. Prototypen (hash) behöver inte det.
- **Utloggad under tiden** (appen, `src/app/_shell/session-refresh.ts`): 401 från `/api/rpc` (sessionen gick ut – 60 minuters inaktivitet eller 12 timmar, `src/proxy.ts`) → sessionen hämtas om **en gång** (inte en per misslyckad fråga; frågorna försöker inte igen på 401 eller 403, `src/shell/backend.tsx`) → `App` leder grunt till inloggningen med `?till=<sökväg>` (bara sökvägen, aldrig query – `loginPathFor`: portalens sökvägar till `/portal/logga-in`) och `&utloggad=inaktiv|maxtid|session` (orsaken ur 401-svarets `reason`, `Session.loggedOut`; samma koder som proxyn sätter vid en omladdning) – båda inloggningssidorna säger varför och att man kommer tillbaka till sidan man var på. Skärmen med osparad text avmonteras innan omdirigeringen, så vakten frågar inte – den automatiska utkastsparningen har redan sparat det som skrivits 2 s tidigare (utom i formulär som inte kan autosparas, se "Automatisk utkastsparning"). Efter inloggningen laddas sidan om på `till` (`safeReturnPath`: bara egna sökvägar, annars startsidan).
- **Skalet gör det Next annars gör** (`src/shell/page-effects.tsx`, körs i `App`): ny sida → skroll till toppen, fokus på sidans rubrik (`h1[data-page-title]`) och sidans titel uppläst i `#mm-route-status`; bara query ändrad → ingenting; tillbaka/framåt och omladdning → skrollen som sparats för posten (sessionStorage, bara siffror); vid tillbaka/framåt till en annan sida dessutom fokus på sidans rubrik (utan att skrolla) och titeln uppläst. Titeln: ruttens titel eller skärmens egen via `usePageTitle("Deltagarkort BOT-26-0143")` – skriv aldrig `document.title` direkt.
- **Flikar** (`src/ui/tabs.tsx`): byter utan att sidan hoppar – flikraden står kvar där den var på skärmen (också när webbläsarens skrollförankring annars skulle flytta sidan); ligger flikraden ovanför skärmen läggs den överst. `onIntent` anropas också för grannflikarna när en flik får fokus (piltangenterna byter flik direkt). `sticky` (deltagarkortet) och `onIntent` (förhämtning). `--mm-sticky-top` = höjden på fasta element överst.
- **Listornas val i adressen** (`src/shell/url-state.tsx`): `useQueryPatch`, `pick`, `pickInt`. Söktext kan vara ett namn och ligger bara i minnet (`useMemoryState`) – aldrig i adressen eller webblagring.
- `RouteDef.keepMounted`: skärmen ligger kvar när parametrarna byts (samma sida för skalet – ingen skroll till toppen, inget fokusbyte). Används av inkorgen (`/inkorg/<id>`).
- **Smal skärm (≤ 900 px):** toppraden (ordmärket och Meny) och portalens huvud ligger fast överst; `globals.css` sätter `--mm-sticky-top` till deras höjd i px (efter layoutens `data-shell`). `html` har `scroll-padding-top` = de fasta radernas höjd (toppraden och, på deltagarkortet, den fasta flikraden – `--mm-tabs-sticky-h`, som `Tabs sticky` sätter), så att det som får fokus med tangentbordet aldrig hamnar bakom dem. Menyn är ett lager under toppraden: Esc stänger och ger fokus till Meny, klick utanför stänger, menyn stängs vid sidbyte.

### Osparad inmatning, fokus och fel (samma i appen och prototypen)

- **Vakten** (`src/shell/guard.ts`): `useUnsavedGuard(dirty, text?)` frågar ("Du har inte sparat" – Stanna kvar / Lämna sidan) innan appen byter till en annan sida, och låter webbläsaren varna vid omladdning. Byte av bara query frågar inte. Webbläsarens Tillbaka kan inte stoppas – därför `useDraft(nyckel, startvärde)`: utkastminne per användare och nyckel (skärm + ärende), bara i minnet, rensas med `clear()` när det sparats. `leaveWithoutAsking(() => nav.push(…))` när skärmen redan har frågat (t.ex. Avbryt beställningen). När appen själv laddar om sidan (byte av testperson, utloggning) frågar den först med `confirmLeaveDocument()` och byter sedan – stannar man kvar är ingenting bytt. Efter bytet visas samma sida bara om det är en lista eller översikt som den nya rollen får se (`stayOrStart`); sidor för en enskild post (deltagarkortet, avstämningen, rapporten …) och sidor som är stängda för testaren leder till startsidan. Används i avstämningen (också under inspelning – den pausas medan frågan visas), månadsbedömningen, meddelandefälten, lärdomarna, mallarna, beställningen i portalen och rapportbyggaren (där sparas definitionen – bara koder och siffror – också i sessionStorage, titeln bara i minnet).
- **Automatisk utkastsparning** (`src/shell/autosave.ts`, beslut 2026-10-02): veckoavstämningen, månadsbedömningen och kartläggningen sparas som utkast på servern 2 s efter senaste ändringen, när sidan lämnas (vaktens `trySave` → `flush()`) och när den döljs eller stängs (`pagehide`/`visibilitychange`, appen med `fetch keepalive`) – med samma kommando som "Spara utkast" (`autosave: true`, `editSession`) och en smalare omräkning (`AUTOSAVE_*` i `src/api/invalidation.ts`: utkastlistor och kortet, aldrig sidan själv eller sidopanelens räknare). Bara när något ändrats sedan senaste sparningen, aldrig två sparningar samtidigt, aldrig för godkända formulär. "Kan inte sparas" (röd status utan avvikelse, AI utan samtycke, för lång sammanfattning, diagnos i texten) visas i statusraden och stoppar tills nästa ändring. Läget visas med `<AutosaveStatus>` (`role=status`, "Utkast sparat 09.41" med serverns tid) – aldrig en toast per autosparning. **Vakten frågar inte när allt är sparat.** Revisionsloggen får **en** rad per sida och besök: hanteraren (`auditSave` i `coach/handlers.ts`) slår upp i loggen (`ctx.system`, indexet `audit_log_entity_idx`) om samma `editSession` redan loggat en automatisk sparning av raden – då loggas ingen ny; händelsenamnen är de befintliga (`check_in.saved`, `assessment.saved`, `intake.saved`) med `details.autosave`. Manuell sparning och godkännande loggas som förut. Utkastets id, version, sparade läge och senaste sparningstid ligger i utkastminnet, så Tillbaka visar formuläret som sparat och fortsatta ändringar sparas i samma utkast. Adressen får inte det nya utkastets id (det skulle byta formulärets nyckel) – efter en omladdning visas "Det finns ett sparat utkast – Öppna utkastet". **Aldrig ett andra utkast** (granskning 2026-10-03): ett sparat utkast som inte är öppnat stoppar autosparningen med en förklaring (coachen öppnar det, eller sparar själv som nytt med "Spara utkast"); "Börja om" nollställer formuläret men behåller utkastets id, så nästa sparning skriver över samma utkast; "Spara utkast" behåller id och version i minnet. **Röd status med avvikelse:** avvikelsen hör till avstämningen (`deviations.checkInId`) och uppdateras vid varje sparning – aldrig en ny per sparning; uppgiften till kommunen och mejlet skapas bara vid manuell sparning eller godkännande (aldrig medan texten skrivs), en gång per avvikelse. **Godkända rader ändras inte:** `coach.checkinSave` och `coach.assessmentSave` svarar `approved` när raden redan är godkänd (också för en autosparning från en annan flik) – skärmen stoppar och säger "redan godkänd – ladda om". **Radversion** (kolumnen `version` på `check_ins`, `monthly_assessments`, `intake_assessments`, migration 0022): skärmen skickar `expectedVersion` (den version den senast såg eller sparade), hanteraren uppdaterar bara när versionen stämmer (`updateIf` – kontroll och skrivning i ett steg) och ökar den; annars `conflict`, inget skrivs över, och statusraden säger "ändrats i en annan flik eller på en annan enhet – ladda om sidan". Autosparningar flyttar inte demoklockan (`memory-runtime.ts`). **Formulär som inte kan autosparas** (röd status utan ifylld avvikelse, AI utan samtycke, för lång sammanfattning, diagnos i kartläggningstexten, ett oöppnat sparat utkast) skyddas bara av vakten och utkastminnet: går sessionen ut (401) just då går texten förlorad med omladdningen – statusraden säger varför det inte sparas.
- **Dialoger** (`src/ui/dialog.tsx`): `Modal dirty` frågar "Vill du slänga det du skrivit?" vid Esc, klick utanför, krysset och `ModalCancelButton`; `useModalDirty(flagga)` för ett fält längre ned i dialogen. Fokus efter stängning: `returnFocusTo` (om den anger ett element), annars elementet som öppnade dialogen, annars senaste fokus utanför dialoger, annars sidans rubrik.
- **Knappar som arbetar** (`Button pending`): `aria-disabled` och `aria-busy`, inte `disabled` – fokus stannar på knappen. Försvinner knappen efter åtgärden flyttar skärmen fokus (`focusSoon(id)`, `focusSectionOf(el)`, `focusSection(id)` i `src/ui/page.tsx`): nästa rad, avsnittets rubrik eller sidans rubrik.
- **Formulärfel** (`src/ui/form.tsx`): `ErrorSummary` (role=alert, länkar som flyttar fokus till fälten) och `focusFirstError(container)`.
- **Tabellrader som leder till en sida**: `Table rowHref` – en cell (`linkKey`) blir en riktig länk (tabbstopp, länkmeny, ny flik med ctrl/cmd eller mittenklick); klick i resten av raden gör samma sak (`rowNavigate`).
- **Utvecklingsfas** (`BuildPhase`): "Byggs i fas N" bara i prototypen. I appen märks bara det som verkligen är avstängt (`off`: bonus, Fortnox, kapacitetstak) med "Kommer senare". Text ur konfigurationen som nämner prototypen visas med `ProtoText`/`withoutPrototypeWords`.

### 4. Rutter – `src/features/<område>/routes.ts`

```ts
export const routes: RouteDef[] = [
  { path: "/inkorg/:emailId?", title: "Avropsinkorg", roles: ["samordnare", "avtalsansvarig"], area: "mb", screen: InkorgScreen },
];
```

URL:er innehåller bara id:n – aldrig namn, personnummer eller andra personuppgifter. Flikar och filter som query (`?flik=meddelanden`).

## Rutter (från prototypens vyer)

| Prototypens vy | Sökväg | Område |
|---|---|---|
| sam.start | `/start` – leder vidare till `/min-vecka` (samordnarens och avtalsansvarigs startsida har gått upp i Min vecka, beslut 2026-10-06) | inkorg |
| sam.inkorg | `/inkorg/:emailId?` | inkorg |
| sam.deadlines | `/forfaller` | inkorg |
| arenden.lista | `/arenden` | arenden |
| arende.kort | `/arenden/:caseId` (`?flik=`) | arenden |
| hand.start | `/handledare` – listan Mina tilldelade ärenden (översikten ligger på handledarens Min vecka) | arenden |
| coach.minvecka | `/min-vecka` – Min vecka för alla MB-roller; coachens skärm är förebilden (beslut 2026-10-06) | vecka |
| coach.narvaro | `/narvaro` | coach |
| coach.avstamning | `/avstamning/:caseId?` | coach |
| coach.manad | `/manadsbedomning/:caseId?` (`?manad=2027-01`) | coach |
| coach.kartlaggning | `/kartlaggning/:caseId?` | coach |
| coach.handelse | `/handelse/:caseId?` (`?lage=avslut`) | coach |
| rapporter.lista | `/rapporter` | rapporter |
| rapport.visa | `/rapporter/:reportId` | rapporter |
| – (rapporter steg 4) | `/rapportbyggare`, `/rapportbyggare/ny` (`?mall=&kopia=&steg=&avtal=`), `/rapportbyggare/resultatfil` (`?fran=&till=&avtal=`), `/rapportbyggare/:savedReportId` (`?steg=&sparad=1`) | rapporter |
| chef.oversikt | `/ledning` | ledning |
| chef.avvikelser | `/avtalsavvikelser/:id?` | ledning |
| eko.start | `/ekonomi` – bara ekonom (beslut 2026-10-07) | ekonomi |
| eko.arende | `/ekonomi/arende/:caseId` | ekonomi |
| eko.prislista | `/ekonomi/prislista` – prislistan (flyttad från avtalssidan, beslut 5) | ekonomi |
| eko.faktura | `/ekonomi/:month/faktura/:caseId?` (`?faktura=<id>` – månadens faktura, en tilläggsfaktura eller ärendets rad markerad) | ekonomi |
| eko.korning | `/ekonomi/:month` (`?filter=anmarkning\|godkannande&arende=<caseId>`) | ekonomi |
| admin.avtal | `/admin/avtal` (`?avtal=&flik=`) – inte i menyn, länk från Användare och roller (beslut 2026-10-06) | admin |
| admin.anvandare | `/admin/anvandare` | admin |
| admin.integrationer | `/admin/integrationer` | admin |
| admin.mallar | `/admin/mallar` (`?flik=logg`) | admin |
| admin.logg | `/admin/logg` | admin |
| praktik.arbetsgivare | `/praktik/:employerId?` | praktik |
| puls.svar | `/puls/:token?` (publik) | puls |
| notiser | `/notiser` | notiser |
| kom.login | `/portal/logga-in` (publik) | kommun |
| kom.start | `/portal` | kommun |
| kom.bestall | `/portal/bestall` | kommun |
| kom.deltagare | `/portal/deltagare/:caseId?` | kommun |
| kom.rapporter | `/portal/rapporter/:reportId?` | kommun |
| – (beslut 2026-10-07) | `/portal/mina-uppgifter` (`?forsta=1` efter första inloggningen) – namn, telefon och enhet | kommun |
| kom.chef (borttagen 2026-10-07) | `/portal/bestallarrapport`, `/portal/resultat`, `/portal/resultat/rapporter/:id?` – leder till `/portal` | kommun |
| – (lathundar 2026-10-09) | `/hjalp` (MB-roller) och `/portal/hjalp` (kommunens handläggare) – lathundarna i `docs/lathund/*.md`, byggda till `src/features/hjalp/content.generated.ts` med `npm run lathund:build` | hjalp |
| om.start / om.feedback / om.fragor | `/om`, `/om/genomgang`, `/om/fragor` | bara prototypen (`src/demo`) |

Startsida per roll finns i `START_PATH` (`src/shell/routes.ts`). **Alla MB-roller börjar på `/min-vecka`** (beslut 2026-10-06, SPEC §7.0); `startPathFor`: en begränsad testare i en roll som är dold för testare (ekonom) – eller vars startsida är stängd – börjar på `/notiser`. De gamla startsidorna finns kvar under rollens flik (`/ledning`, `/ekonomi`, `/handledare`, `/admin/anvandare`), och `/start` leder vidare med `redirectScreen` (`src/shell/redirect.tsx`, `nav.replace`, query följer med – samma i appen och prototypen).

**Min vecka** (området `vecka`): `src/features/vecka/screens/min-vecka.tsx` väljer rollens skärm – coach `coach/screens/min-vecka.tsx` (förebilden), samordnare och avtalsansvarig `inkorg/screens/min-vecka.tsx`, handledare `arenden/screens/min-vecka-handledare.tsx`, chef `ledning/screens/min-vecka.tsx`, ekonom `ekonomi/screens/min-vecka.tsx`, systemadministratör `admin/screens/min-vecka.tsx`. Varje roll använder bara frågor den redan har (`src/features/vecka/vecka.test.tsx` spårar nycklarna). Kitet (sidhuvud, nyckeltalsrad, avslutad rad, länkad radrubrik) ligger i `src/ui/vecka.tsx`; kortet Olästa notiser i `notiser/screens/olasta.tsx`; ekonomens kort delas med Fakturering (`ekonomi/screens/start-cards.tsx`).

**Menyn** (`src/shell/nav-config.ts`, SPEC §7.0): Notiser överst, den gemensamma gruppen Min vardag (`COMMON_NAV` – ett val visas bara för rollerna som når sidan) och högst en rollflik (`ROLE_TAB`). `src/shell/route-table.test.ts` kontrollerar att varje menyval finns i rollens rutter och att den gemensamma gruppen visar exakt de val rollen når – menyn visar aldrig något rollen inte når.

**Frågeparametrar** som scenarierna och länkar använder (områdena ska läsa dem; hela listan och översättningen från prototypens vy-id finns i `src/demo/paths.ts`):
`/inkorg?senaste=1` (senaste avropet som väntar på svar) · `/inkorg?arende=<caseId>` · `/arenden/<id>?flik=` · `/narvaro?vecka=forra|denna` · `/avstamning/<caseId>?avstamning=<checkInId>` · `/manadsbedomning/<id>?manad=2027-01` · `/handelse/<id>?lage=avslut` · `/rapporter?filter=` · `/ledning?flik=kpi|puls|coacher|omraden` · `/portal/deltagare/<caseId>?flik=` · `/admin/avtal?avtal=&flik=` · `/admin/mallar?flik=logg`.

## Rapporter: PDF och rapportutkast

- **PDF** (`src/features/rapporter/pdf/`): samma vy-modell som HTML-pappret (`reportDocument` → `ReportDocView`) ritas med react-pdf – samma avsnitt, ordning och texter (`pdf.test.tsx` jämför dem). Levererade rapporter byggs av den frysta ögonblicksbilden (`reports.snapshot`), så en levererad rapport ger alltid samma PDF-innehåll. PDF:en byggs i webbläsaren när någon klickar "Ladda ner PDF" (dynamisk import, så vanliga sidor inte blir större) och sparas inte – `reports.pdf_path` används inte. Kommandot `rapporter.download` kontrollerar behörigheten på servern och loggar `report.downloaded` först. Montserrat är inbäddat som data-URL:er (`fonts-data.ts`, genereras av `scripts/pdf/generate-fonts.ts`), så det fungerar likadant i Next och i prototypens enda HTML-fil. Logotypen ritas på ett ställe (`pdf/brand.tsx`).
- **Nedladdning**: `useDownload()` tar text eller binärt (Blob/Uint8Array). Appen: webbläsarens nedladdning. Prototypen: claude.ai:s downloads-förmåga, som tar binärt innehåll direkt (ingen base64).
- **Rapportutkast som skapas automatiskt** (`src/core/report-schedule.ts` + `src/features/rapporter/ensure.ts`): reglerna i avtalskonfigurationen (`reportSchedule`, t.ex. `monthly.minEnrolledDays`). Supabase-läget: jobbet `report_schedule` (`src/server/jobs/reports.ts`) högst var tionde minut. Minnesläget och prototypen: `memory-runtime.ts` kör samma funktion när testdatat läses in och när demoklockan passerar en vecko- eller månadsgräns. Vilka perioder som prövas (`scheduleFrom`): från avtalets högvattenmärke – tiden för den senaste körningen där hela avtalet gicks igenom – och alltid minst de senaste 62 dagarna (`LOOKBACK_DAYS`); utan märke från avtalets start. Märket flyttas bara när avtalet gåtts igenom utan fel, så en avbruten körning tas om. Det sparas i `app_settings` (`report_schedule_checked:<avtal>`, läses utan cache när jobbet körs) respektive i minnet. Golvet: testdatat är komplett till testklockans start (`clock_demo_epoch` i testmiljön, klockan när runtime skapas i minnesläget) – perioder som slutade före den skapas aldrig, så inget skapas på nyinläst testdata, inte heller medan "Läs in testdata på nytt" pågår. Unika index (`0018_rapportutkast.sql`) stoppar dubbletter när två körningar krockar.

## Kommunens resultatfil (CSV och Excel)

- **Frysta fakta** (`src/features/rapporter/facts.ts`): bara koder, tal, sanningsvärden och datum – inga namn och ingen fritext. Byggs i samma pass och med samma datakälla som rapportens modell (`buildMonthlyFacts`/`buildFinalFacts` i `model.ts`) och fryses i `reports.snapshot.facts` när rapporten levereras (`report.deliver` → `freezeReport`). Rapporter som frystes tidigare får fakta med `ensureFacts`/`ensureFactsMany` (`freeze.ts`); ärendefälten och siffrorna tas då ur den frysta modellen (`reconcileMonthlyFacts`), och det som inte går att föra tillbaka loggas som `report.facts_drift` (bara fältnamn). `report.deliver` skriver `report.delivered` i loggen före frysningen; misslyckas frysningen fryses rapporten senare med samma underlag.
- **Kolumnregistret** (`src/features/rapporter/export-columns.ts`): `exportColumns(cfg, areas)` – en post per kolumn med typ, beskrivning, möjliga värden, källa (klarspråk) och exempel. Texterna byggs av avtalets konfiguration. `EXPORT_SCHEMA_VERSION` och kolumnspärren (`columnsStillCompatible`): den första utlämnade filen låser kolumnlistan per avtal och schemaversion (den senaste loggraden `export.results` per tabell – loggen läses bakåt en sida i taget, en hel minut åt gången, inte i sin helhet). `docs/RESULTATFIL.md` kontrolleras mot registret av ett test.
- **Kärnan** (`src/features/rapporter/export.ts`): `buildResultExport` är ren och rollneutral (rapportbyggaren i steg 4 använder den för hela avtalet); `resultCsv`/`resultXlsx` bygger filerna. Filformaten i `src/core/export/` (CSV med formelskydd, zip och xlsx utan beroenden, DEFLATE med `CompressionStream`) fungerar likadant i Next, i prototypen och i testerna.
- **Kommandot** (beslut 2026-10-07: kommunens chef och "Hämta resultat" i portalen är borttagna – `kommun.resultatExport` och `result-handlers.ts` finns inte längre). Filen tas fram av avtalsansvarig i rapportbyggaren ("Resultatfil för hela avtalet", `rapporter.resultatfilExport` i `src/features/rapporter/result-file.ts`) och lämnas till kommunen av Miljonbemanning: urval via `ctx.repo` (regeln `"mb"`, bara den senaste levererade versionen per ärende och månad) → frysning → **kolumnspärr** (läser både `export.results` – kommunens tidigare hämtningar – och `export.results_mb`) → bygg → logga `export.results_mb` → svara (CSV som text, Excel som base64). Filnamnet: `resultat_<prefix>_hela-avtalet_<från>_<till>`. Revisionsloggen (`admin.auditLog`) visar långa listor som antal; hela listan hämtas med `admin.auditDetail` när den öppnas.

## Kommunens konton, bilagor och beställningen (beslut 2026-10-07)

- **Bara handläggare.** Kommunen har en roll, `kommun_handlaggare` (`CUSTOMER_ROLES`). Rollen `kommun_chef` finns inte längre i koden; migration 0026 gör befintliga chefskonton och medlemskap till handläggare, beställarrapporterna till en per avtal och månad utan mottagare, och sparade rapporter som var delade med kommunen till `contract`. Gamla synpunkter med rollen visas som "Kommunens chef (borttagen roll)".
- **Självregistrering** (`src/core/self-registration.ts`, `src/features/session/self-register.ts`): `selfRegistrationContracts(email, contracts, orgs)` – domänen måste finnas både i `contracts.config.selfRegistration.emailDomains` och bland beställarens domäner, aldrig en underdomän och aldrig Miljonbemannings domän, avtalet aktivt. Kontrolleras i koden (appen validerar inte `contracts.config` när avtalet läses): konfigurationen måste klara `ContractConfigSchema`, synligheten måste vara "own" (`effectiveVisibilityScope`) och adresser med plustecken får inget konto. Synligheten "unit" använder bara medlemskapets enhet (`actorFor` i `src/data/actors.ts`, `mm.current_unit` i 0026) – profilens enhet skriver handläggaren själv. Taket för nya konton (`checkSelfRegistration` i `src/server/auth/rate-limit.ts`): unika adresser i `login_attempts` (kind `self_registration`, hashat), högst 20 per timme i hela appen och 3 per IP. Servern (`src/server/auth/service.ts`) skickar koden till en sådan adress utan profil (samma spärrar och `MM_EMAIL_ALLOWLIST`) och skapar profil + medlemskap (`kommun_handlaggare`) med service role först när koden verifierats; revisionsloggen får `profile.self_registered` med id och domän – aldrig adressen. Minnesläget och prototypen: `rt.selfRegister(email)` (`createMemoryRuntime`) kör samma funktion. Jobbet `auth_cleanup` tar bort Auth-användare som skapades när koden skickades men aldrig verifierades. Ett nytt konto hamnar på `/portal/mina-uppgifter?forsta=1` (`PORTAL_FIRST_LOGIN_PATH`).
- **Beställningen** (`kommun/screens/bestall.tsx`, kommandot `arenden.caseCreate`): omfattningen ur `contracts.config.orderPeriods` (6/12 månader eller annan tidsperiod med motivering – `orderPeriodMonths`, `orderPeriodReason`, planerat slut räknas med `orderPeriodEnd` i `src/core/time.ts`), enhet som fritext, `priorAssessment`, bakgrund och `attachmentIds`. Portalen skickar aldrig beställarreferens eller avtalsområde – hanteraren ignorerar dem från kommunen. Acceptdialogen i inkorgen sätter avtalsområde och yrkesspår; referensen är valfri.
- **Bilagor** (`src/features/_shared/attachment-port.ts`, `ctx.attachments`; hanterarna i `arenden/attachment-handlers.ts`; bakgrunden i `arenden/background.ts`; komponenterna i `arenden/screens/attachments.tsx`): tabellen `case_attachments` och den privata bucketen `bilagor` (0024). Porten äger raderna (skrivs bara med service role); hanteraren kontrollerar alltid behörigheten först. Flödet: `arenden.bilagaStart` (rad `pending` + signerad uppladdningsadress – webbläsaren laddar upp direkt till lagringen, eftersom Vercels funktioner tar högst 4,5 MB) → `arenden.bilagaKlar` (storleken från lagringen och filsignaturen kontrolleras, annars raderas filen) → `caseCreate` kopplar filerna till ärendet → `arenden.bilagaHamta` (signerad adress i 60 sekunder, utan filnamn; loggas `attachment.viewed`) → `arenden.bilagaTaBort`. Sökvägen är `<avtal>/<id>.<ändelse>` – filnamnet finns bara i tabellen och visas bara i appen, aldrig i adresser eller loggar. Minnesläget och prototypen: `createMemoryAttachments` (innehållet i minnet, aldrig i kommandologgen). Bilagor i ett ärende gallras aldrig automatiskt (beslut 5, 2026-10-08): `arenden.bilagaTaBort` tillåter samordnare/avtalsansvarig bara när ärendet är avslutat eller avböjt (`attachmentsRemovable` i `arenden/background.ts`; `canRemove` på raden styr knappen, annars hjälptexten "Bilagor tas bort av Miljonbemanning när insatsen är avslutad"). Städningen: jobbet `attachments_retention` (varje timme) raderar uppladdningar som aldrig kopplades efter 24 timmar (utom mejlets bilagor som väntar på registrering) och – avstämningen – filer i lagringen utan levande rad (`listStoredPaths`/`removeStoredFile`; lagringen listas före raderna läses). Den signerade uppladdningsadressen gäller i två timmar och kan inte återkallas, så en fil som laddas upp igen efter "Ta bort" eller en avvisad fil fångas där. Behörighet: handläggaren som beställde, samordnare, avtalsansvarig och ärendets huvudcoach – inte handledare, ekonom eller chef.
- **Inga belopp mot kommunen:** portalens frågor har inga nycklar för pris, värde eller referens (`kommun/handlers.test.ts` söker rekursivt). Orderbekräftelsens modell har `period` (omfattningen i text) i stället för `price`; vyn (`orderDocModel` i `rapporter/view-handlers.ts`) tar bort ett pris ur frysta rapporter från före beslutet. Kommunen läser inte `price_items`, inte bonusanspråken (`bonus_claims`, belopp) och inte beställarrapporten eller statistiken – inte heller en tidigare chef vars id står kvar i `delivered_to` (0026 och `policy.ts`). I `contracts_public` tömmer `mm.customer_safe_config` avtalets viten (`penalties: {}`) för kommunen.
- **Månadsrapportens avsnitt 2** visar bara perioden och närvarograden (`report-document.tsx` och `pdf/documents.tsx`). Modellen och ögonblicksbilderna är oförändrade – bara visningen.
- **Simulerad AI** (`src/ui` `SimulatedAiNotice`): där transkriberad text visas och körningens leverantör är `simulated` (bara testmiljön) visas "Testmiljö: AI:n är simulerad – texten är påhittad …".

## Fakturan och beloppen (beslut 2026-10-07, omgång B)

- **En faktura per avtal och månad med en rad per ärende** (`billing.invoicePer: "contract_and_month"`, kräver `collectiveInvoiceAllowed`). Kärnan är `src/core/billing.ts`: `billingLines` räknar debiterbara veckor per ärende och månad som förut; `monthInvoices` grupperar raderna till fakturor. Fakturans id är `inv-<avtal>-<månad>-<grupp>` (`invoiceIdOf`), gruppen `avtal` eller `avtal-tillagg-N` för tilläggsfakturor (vid `case_and_month` är gruppen ärendets id). Idempotensnyckeln mot Fortnox är `<avtal>:<månad>:<grupp>` (`fortnoxKeyOf`, `:ny` efter kreditering).
- **Frysta rader:** när fakturan skapas i Fortnox eller markeras som manuellt fakturerad skrivs raderna till `invoice_lines` (en per ärende och faktura, med veckorna och anmärkningen BT-127). `invoiceLookup` säger vilken faktura som har en viss vecka: en skapad faktura har sina frysta veckor; veckor som tillkommer efteråt hamnar på nästa tilläggsfaktura. En rad utan veckor (migrationens konvertering) täcker ärendets alla veckor i månaden; en skapad faktura utan rader täcker allt som inte står på en annan faktura. En fryst vecka som inte längre är debiterbar får kontrollen `not_billable` (varning, räknas som anmärkning).
- **Skapa en faktura** (`createInvoice` i `ekonomi/handlers.ts`, för `billingSendFortnox` och `billingMarkManual`): raden i `invoice_drafts` skapas först om den saknas, raderna skrivs idempotent med fasta id:n (`<faktura>:<ärende>`, en befintlig rad skrivs över och rader för ärenden som inte längre är med tas bort) och statusen ändras sist med `Table.updateIf` från väntande status. "Redan skapad" avgörs av fakturans status – aldrig av att en rad finns – så en körning som avbröts kan göras om, och två samtidiga körningar skapar aldrig samma faktura två gånger.
- **Göra om en returnerad faktura** (`ekonomi.reissue`): `reissueLines` fryser raderna på nytt från dagens underlag med bara de veckor som fortfarande är debiterbara (rättelser följer med; nya veckor står på den öppna fakturan). Krediteringen har ett fast id per faktura och omgång, nyckeln blir `:ny`, `:ny2` … (`reissueRound`). Återstår inga veckor får fakturan status `credited` (täcker inga veckor, visas inte bland månadens fakturor). Raderna får därför ändras och tas bort medan fakturan är underlag, godkänd eller returnerad (`mm.invoice_editable`, policyn `invoice_lines_delete` i 0023, samma regel i `policy.ts`).
- **Ärendets och radens vyer** (`ekonomi.line`, `ekonomi.case`) räknar fakturan för hela avtalet (`monthCache`) – fakturans status och kontroller (referens, inköpsordernummer) gäller hela fakturan. Reservläget `case_and_month` använder ärendets beställarreferens som fakturans tills ekonomen anger en annan.
- **Referens och inköpsordernummer per faktura** (`ekonomi.invoiceSetBuyerRef`, `ekonomi.invoiceSetPo`): referensen kontrolleras mot mönstret och referensregistret innan fakturan skapas eller markeras manuellt (`invoiceRefProblem`); inköpsordernumret tar bara kommunens 99-nummer och aldrig ett ärendenummer. Kreditering: `ekonomi.reissue` (rad i `invoice_credits` med `invoice_draft_id`).
- **Migration 0023** (`0023_faktura_per_manad.sql`, inte applicerad): `invoice_lines.note` och unikt (faktura, ärende), `invoice_credits.invoice_draft_id`, konvertering av gamla fakturor per ärende (en faktura per skapad status och månad, en rad utan veckor per ärende med den statusen, de gamla fakturanumren i anmärkningen – ofakturerade ärenden blir underlag som i den gamla modellen), borttagen `billing_runs.default_invoice_status`, unikt (avtal, månad, grupp) för periodiska fakturor, `mm.invoice_editable` (underlag, godkänd, returnerad) och borttagning av rader med samma regel (samma regler i `policy.ts`). PGlite-testet `src/data/supabase/migration-0023.test.ts`.
- **Belopp bara för ekonomen** (beslut 5): `hidesMoney(actor)` i `src/api/tester-access.ts` = rollen är inte ekonom eller aktören är en begränsad testare. Samma mekanism som testarspärren: Ekonomis frågor och kommandon har `roles: ["ekonom"]` (och `commercial`), och hanterarna tar bort beloppsfälten för alla andra (`ledning.overview` utan `unbilled.totalOre`, avtalsavvikelserna med `hasPenalty`/`penaltyChoice` i stället för belopp, `admin.contract` utan prislista och viten). Flaggan om ofakturerade veckor (`src/core/alerts.ts`) har kronor och länk till Ekonomi bara för rollen ekonom; chefen får antal veckor och en länk till ärendet. Deltagarkortet och inkorgen har inget ordervärde för någon. Kontrollen: `src/api/tester-access.handlers.test.ts` (varje roll utom ekonom får samma skydd, ekonomen ser beloppen) och e2e `ekonomi.spec.ts` test 10. RLS för fakturatabellerna är oförändrad (SPEC §13 fråga 31).

## Rapportbyggaren (rapporter steg 4)

SPEC §7.11 k. Miljonbemanning (samordnare, avtalsansvarig, chef) bygger, sparar och delar rapporter av samma underlag som resultatfilen. Delning bara inom Miljonbemanning (beslut 2026-10-07 – kommunens chef och delningen med kommunen är borttagna; migration 0026 gör delade rapporter till `contract`). Inga levande data, inga nya kolumner i registret.

- **Urvalet** (`src/features/rapporter/selection.ts`): `selectDelivered(ctx, { contractId, cfg, from, to, rule, finals })` är steg 3:s urval utbrutet – levererade, inte ersatta rapporter (`deliveredOk`, `latestVersions`), lätta fält med `Table.pick` (`LIGHT`). `rule` är bara `"mb"` sedan 2026-10-07 (hela avtalet; `Viewer.isProtected` utesluter fortfarande skyddade ärenden – vilande spärr, se regel 8). `joinMonthly` hämtar för avslut den senaste levererade månadsrapporten, också före perioden, för avtalsområde, yrkesspår och enhet. "Resultatfil för hela avtalet" (`result-file.ts`) använder samma urval i samma ordning: urval → frysning → kolumnspärr → bygg.
- **Fakta** (`loadBuilderFacts`): `Table.pickJson(fields, { facts: ["snapshot","facts"], … })` läser bara `snapshot->facts` (PostgREST `alias:kolumn->nyckel`), inte hela ögonblicksbilderna. Bara rapporter som saknar frysta fakta läses helt och fryses med `ensureFactsMany`. Inga fakta räknas i frågor. `pickJson` finns i `Repo` (MemoryRepo: samma policy som `pick`; SupabaseRepo: `select` med `->`), alias och nycklar kontrolleras (`checkJsonPaths`).
- **Definitionen** (`builder/definition.ts`): `ReportDefinitionSchema` (zod, strikt, `v: 1`) – datamängd, period (senaste N hela månader i Stockholms tid eller valda månader, högst 12, klipps vid avtalets start med `resolvePeriod`), urval, sammanställning (gruppering, tidsuppdelning, 1–4 mått, diagram med ett mått) eller lista (kolumner, ärendenummer först). Felen är svenska meningar. `TitleSchema` stoppar personnummer, ärendenummer och formeltecken först. Den sparade definitionen valideras igen varje gång den läses – en ogiltig rapport visas inte, ägaren får ändra den.
- **Katalogen** (`builder/catalog.ts`): varje kolumn i registret har en klass (`identifierande`, `pseudonym`, `datum`, `dimension`, `fakta`); ett test stoppar en ny kolumn utan regel. Bara dimensioner kan vara urval eller gruppering. "Uppgift saknas" för tomma värden.
- **Måtten** (`builder/measures.ts`): ett register per mått (etikett, hjälptext ur konfigurationen, kolumner, `compute`). Resultatgraden räknas med `resultTally` i `src/core/kpi.ts` – samma funktion som `resultRate`. Tomma celler räknas inte i andelar (not), nivåer bara som fördelning.
- **Motorn** (`builder/run.ts`): `runDefinition` → `BuilderView` (tabellen med kolumnen Deltagare först och raden Totalt, staplar, noter, regler, mål). Kommunens läge (`audience: "kommun"`): grupper med färre än `pulse.minNForAggregate` får `cases`, celler och stapelvärde `null` och texten "färre än 5"; inget internt mål (`targetsFor`), inga texter om ledningsvyn. Högst 200 grupper och 20 staplar.
- **Filerna** (`builder/files.ts`): CSV (formelskyddad) och Excel (flikarna "Rapport" och "Om rapporten") med `src/core/export/`; PDF (`pdf/builder-doc.tsx`, bara sammanställningar, utan diagram) byggs i webbläsaren efter att kommandot loggat, som `rapporter.download`. Filnamnet: prefix, mall eller datamängd, period. Högst `MAX_BUILDER_RESPONSE_CHARS` (3 500 000 tecken efter base64) – annars `too_large`.
- **Kedjan** (`builder/pipeline.ts`, `runPipeline`): kontrakt → period → urval → fakta → `buildResultExport` → `runDefinition`. `LIMITS` är en söm för testerna (gränserna går inte att nå med testdatat).
- **Hanterarna** (`rapporter/builder-handlers.ts`): förhandsvisningen (`rapporter.byggForhandsvisning`) är ett **tyst kommando som körs på knapp** – inte en fråga, så den räknas inte om efter varje kommando och flyttar inte demoklockan. Med `savedReportId` loggar den `saved_report.viewed` (en gång per sidvisning och läge); ett osparat utkast loggas inte. Filer: `rapporter.byggExport` loggar `export.saved_report` innan filen lämnas ut (stopp: `saved_report.export_blocked`, utanför prefixet `export.`). "Resultatfil för hela avtalet": `rapporter.resultatfilExport` → `export.results_mb`. Kommunens frågor för delade rapporter (`kommun.delade`, `kommun.delad`, `kommun.deladExport`) är borttagna 2026-10-07.
- **`saved_reports`** (`0021_sparade_rapporter.sql`, samma regler i `policy.ts`: `savedReportRead`/`savedReportWrite`): RLS neka som standard, ingen delete. Läsning: byggrollerna i avtalet ser egna och delade (också arkiverade – hanterarna visar dem inte). Kommunen läser inga sparade rapporter (0026: `visibility` får inte längre vara `customer`). Triggern `saved_reports_protect_columns`: bara ägaren ändrar titel och definition; den som inte är ägare (avtalsansvarig) ändrar bara `visibility`, `shared_*` och `archived_*`; `id`, `contract_id`, `owner_id`, `created_at` ändras aldrig; tidsfälten sätts parvis och i eget namn; en ändring måste ändra något.
- **Fällan med `update … select`**: `SupabaseRepo.update` läser tillbaka raden, och Postgres kräver då att den **nya** raden klarar select-policyn. Därför döljer läsregeln för MB inte arkiverade rader, och avtalsansvarig kan inte göra någon annans rapport privat (raden skulle bli osynlig för den som ändrar).
- **Minutprecisionen i `shared_at`**: `ctx.now()` har minutprecision. Delar och slutar samma person dela inom samma minut blir `shared_at`/`shared_by` oförändrade – triggern kräver därför bara att de är satta i eget namn när `visibility` ändras, inte att de skiljer sig. Hanterarna skriver aldrig en ändring som inte ändrar något (samma delning igen ger `ok` utan skrivning och utan loggrad). I minnesläget flyttas demoklockan en minut före varje kommando som inte är tyst – testerna sätter tillbaka klockan för att pröva samma minut.
- **Skärmarna** (`rapporter/screens/bygg*.tsx`): adressen har bara id:n och val (`?mall=`, `?kopia=`, `?steg=`, `?avtal=`, `?sparad=1`) – aldrig namn eller rapportens titel.

## Deltagarkortet: tidslinje, anteckningar och månadsunderlag

- **Tidslinjen** (`arenden.kortTidslinje`) byggs av den rena funktionen `buildTimeline` (`src/features/arenden/timeline.ts`). Hanteraren läser bara via `ctx.repo` och bara de tabeller rollens åtkomst ska visa (teamet läser inte avstämningar, bedömningar, avvikelser, rapporter, samtycken eller meddelanden). Ingen fritext i grundvyn utom de fria anteckningarna; meddelandets text och avstämningens anteckning och hinder kan fällas ut på begäran av den som får läsa dem på fliken (posten märks `text`, egen fråga `arenden.kortTidslinjeText` som hämtas först vid utfällningen, samma spärr som fliken, ingen extra loggning – beslut 2026-10-02, Karim). Ett oläst meddelande från kommunen som fälls ut markeras som läst (`arenden.messageRead` med `messageId` – bara det meddelandet, samma tysta kommando som fliken Meddelanden; chef och admin får inget kvitto). Knappen "Visa text" har `aria-controls` bara när panelen finns i DOM.
- **Kortets huvud** visar "Fastnat i fas n" med kvitteringen (`stuck.acked`, från `alert_acks` – samma källa som flaggan på Min vecka och i listan), så en kvitterad flagga inte ser okvitterad ut.
- **Fria anteckningar** ligger i `case_notes` (0019). Samma regler i `policy.ts` (`caseNoteWrite`) och i RLS + triggern `case_notes_protect_columns`. Ingen hård radering: en anteckning döljs med `removed_at`/`removed_by`.
- **Månadsunderlaget** (`arenden.kortManad`) visar exakt månadsrapporten: `monthlyPreview` = `build(makeSrc(db, env, null), …)` i `rapporter/model.ts` och samma vy-modell (`rapporter/doc-view.ts`) och dokumentkomponent (`ReportDocument`) som rapportsidan. Månadsrapportens läge (senaste, levererad, rättelse) läses på ett ställe för tidslinjen och månadsunderlaget: `monthReportState` i `timeline.ts`.
- **Tydlig/någon progression** räknas med `progressionFlags`/`levelIsClear` (`src/core/config.ts`) – bara de obligatoriska områdena, gränserna `progression.clearFromLevel`/`anyFromLevel` i avtalet. Texterna kommer från `progressionRuleText` via vy-modellerna, även `excluded` (vilka områden som inte räknas, med namnen ur konfigurationen).

## Närvaro: massregistrering per dag

- `/narvaro`: "Markera alla som närvarande (n)" per dag → bekräftelse med namnen → **ett** kommando `coach.attendanceSetAll` (roller och tilldelning som `attendanceSet`; alla tillfällen läses via `ctx.repo`, saknas något skrivs ingenting). Raderna skrivs av samma hjälpare som enskild registrering (`writeAttendance`), så fakturaunderlaget och veckorapporterna blir identiska (`attendance-all.test.ts`). Redan registrerade tillfällen hoppas över (`skipped`). En loggrad `attendance.registered_all` **per avtal** bland dagens tillfällen (vanligen en) med dag, antal och id:n (`details.caseIds` gör att kortets Historik visar raden i varje berört ärende). Veckorapporterna publiceras en gång per handläggare och vecka bland de markerade.
- **En närvarorad per tillfälle** (migration 0022, `UNIQUE_KEYS` i `src/data/schema.ts` speglar den i minnet): två samtidiga kommandon för samma tillfälle (dubbelklick, eller "Markera alla" samtidigt med en radknapp) ger `UniqueError` (23505) för det andra – `writeAttendance` läser då om raden och uppdaterar den. Raderna på `/narvaro` ignorerar klick (`Seg busy`, aria-disabled, fokus kvar) medan radens eller dagens kommando pågår. Veckorapporten publiceras med en villkorad övergång väntar → levererad (`Table.updateIf`), så två kommandon som båda ser veckan komplett publicerar, loggar och mejlar bara en gång.

## Tid, belopp och id

- `LocalDate` = `'YYYY-MM-DD'`, `LocalDateTime` = `'YYYY-MM-DDTHH:mm'`, alltid Europe/Stockholm (`src/core/time.ts`). Datalagret omvandlar till och från `timestamptz`.
- Veckor enligt ISO 8601; en vecka faktureras i månaden där torsdagen infaller. Arbetsdagar med svenska helgdagar (`src/core/holidays.ts`).
- Belopp i öre (heltal), priser exkl. moms, momssats per artikel.
- Id:n är strängar. Ärendenummer `BOT-26-0042` är människornas nummer och används i utskick; id:n i URL:er.

## Det som väntar på godkänd plan (CLAUDE.md: databas, behörigheter, AI, e-post/SMS, fakturering)

Hanterarna anropar redan gränssnitten, men produktionsadaptrarna byggs först när planen i `docs/PLAN-FAS1.md` är godkänd:

- `SupabaseRepo`, migrationer och RLS-policyer (Postgres i eu-north-1) – ersätter `MemoryRepo` i `src/server/runtime.ts`.
- Inloggning: Microsoft Entra för MB, e-post + sexsiffrig kod för kommunen.
- `ctx.notify` → `lib/notify` (e-post och SMS), `avrop@` via Microsoft Graph, AI via `lib/ai` (`ctx.ai`), Fortnox-API via `ctx.fortnox` (`src/features/_shared/fortnox-port.ts` – i dag bara den simulerade porten i minnesläget; supabase-läget sätter ingen tills en riktig klient finns).

## Tester

- Enhetstester i `src/core/**/*.test.ts` (Vitest): KPI:er, debiterbara veckor, torsdagsregeln, arbetsdagar/SLA, ärendenummer, beställarreferens och inköpsordernummer.
- Policytester (`src/data/policy.test.ts`): samma fall som RLS-testerna ska täcka – kommunanvändare ser bara sina ärenden, ekonom ser inga coachanteckningar, coach och handledare alla ärenden i avtalet (beslut 2026-10-09), skyddade ärenden bara namngivna (vilande spärr – testet sätter en person som skyddad), bilagorna (`case_attachments`) bara för dem med åtkomst till ärendet.
- E2E (`tests/e2e`): varje test körs mot både prototypen och appen – det är beviset för att prototypen speglar appen.

## Skarp drift (beslut 2026-10-08)

- **Kollegorna är vanliga användare.** Systemadministratören lägger till kollegor, ändrar roller och spärrar i appen (`admin.inviteStaff`, `admin.setStaffRoles`, `admin.setStaffActive` i `src/features/admin/handlers-users.ts`, dialogerna i `screens/anvandare.tsx`). Adressen måste ha personalens domän (`src/core/staff.ts`: organisationens egna domäner, annars `ctx.staffEmailDomains` = `MM_STAFF_EMAIL_DOMAINS` på servern, standard miljonbemanning.se). Mejlet (`inbjudan_personal`) har inga personuppgifter – knappen till appen läggs till av utskicket. En person kan ha flera roller (`memberships` är unik per användare, avtal och roll). Loggen: `staff_user.added`, `staff_user.roles_changed`, `staff_user.blocked`, `staff_user.reactivated` – bara id:n, roller och domän. Avtalsansvarig väljs på avtalssidan (`admin.setContractManager`, bara bland kollegor med rollen i avtalet).
- **Rollväxling** (migration `0027_rollval.sql`): tabellen `role_choices` (en rad per användare, `id = user_id`, bara den egna raden, bara en roll man har medlemskap för). `mm.current_role()` = coalesce(testpersonens roll, vald roll med medlemskap, medlemskapet med lägst id); samma regel i `defaultRoleFor` (`src/data/actors.ts`) och `policy.ts`. Kommandot `session.vaxlaRoll` skriver valet via `ctx.repo` och loggar `role.switched`; rollväljaren i sidopanelen (`RoleSwitch` i `src/shell/layouts.tsx`) kör kommandot och sedan `Session.chooseRole` – appen laddar om sidan (kakan i minnesläget, `current_actor()` i supabase-läget), prototypen byter persona. `SessionView.ownRoles` är tom när en testare agerar som en testperson (då styr "Agera som").
- **AI av** (`ctx.ai` saknas – produktion utan `MM_AI_PROVIDER`): `aiOff(ctx)` och `AI_OFF_TEXT` i `src/features/_shared/ai-port.ts`. `checkInPage.recording.block = "ai_off"`, `coach.aiRun` svarar `ai_unavailable` (aldrig simulerad text), `assessmentPage.aiOff`, kommunens `dictationOptions` är av med texten, `caseVoice.send` och `rost.linkSend` nekar med `AI_OFF_LINK_TEXT`, och integrationskortet AI visar "Inte kopplad". `src/features/_shared/ai-off.test.ts`.
- **Fortnox av** (`ctx.fortnox` saknas – supabase-läget tills en riktig klient finns; pengasäkerhet 2026-10-08): porten `src/features/_shared/fortnox-port.ts` (`FortnoxPort { provider }`, `createSimulatedFortnox()` i `memory-runtime.ts`, `fortnoxOff(ctx)`, `FORTNOX_OFF_ERROR`/`FORTNOX_OFF_TEXT`). `ekonomi.billingSendFortnox`, `ekonomi.fortnoxSync` och `ekonomi.reissue` svarar `fortnox_off` utan att frysa rader, ändra status, hitta på nummer eller logga `billing.fortnox_created`. `ekoRun.fortnox.connected` och `ekoStart.fortnox.connected` (= `!!ctx.fortnox`) döljer "Skapa i Fortnox", "Hämta status från Fortnox" och kortet Fortnox-körningar och visar i stället rutan "Fortnox är inte kopplat ännu …" (körningen och kortet Fortnox-synk). Fakturanumret i vyerna är bara det lagrade (`fortnoxDocumentNumber`); `fortnoxNumber()` i `src/core/billing.ts` räknar fram ett nummer bara för den simulerade porten och testdatat. `src/features/ekonomi/fortnox-off.test.ts`.
- **Tomt testdata och riktig tid** (`MM_SEED=empty` i minnesläget): `src/data/seed/empty.ts` (avtalet, konfigurationen, helgdagar 2026–2029, integrationerna, de sju kollegorna i `src/data/seed/colleagues.ts` – alla admin, Ali också avtalsansvarig) med `realClock()` (`src/data/memory-runtime.ts`). E2E-projektet `tom` (`playwright.config.ts`, egen server på porten efter appens) kör `tests/e2e/tom.spec.ts`: varje roll klickar igenom alla menyval, rollväxlingen, Lägg till kollega och kommunens portal – aldrig NaN, undefined eller krasch.
