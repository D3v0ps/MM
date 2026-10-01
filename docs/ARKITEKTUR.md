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
| Navigering | Riktiga URL:er (`/arenden/case-1`) | Hash-URL:er (`#/arenden/case-1`) |
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
  features/<område>/
               api.ts        kontrakt: frågor och kommandon med zod-scheman och resultattyper (importeras av skärmar)
               handlers.ts   hanterare (importeras ALDRIG av skärmar – bara av src/api/handlers.ts)
               screens/*.tsx skärmar ("use client")
               routes.ts     rutter för området
  shell/       app.tsx (väljer rutt och layout) · nav.tsx · session.tsx · backend.tsx (useQuery/useCommand)
               routes.ts · route-table.ts · layouts.tsx · runtime.tsx (DemoOnly)
  ui/          MB:s komponentbibliotek (se src/ui/README.md)
  app/         Next.js: layout, catch-all-sidan som renderar src/shell/app.tsx, /api/rpc, /api/dev-session
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
- Efter ett lyckat kommando räknas alla frågor om (`useCommand`). Enkelt och korrekt i pilotens volym.
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
3. **Rollkontroll** i `roles` på varje hanterare. Kontrollera dessutom tilldelning (coach ser egna ärenden, handledare tilldelade) – det sköter policyn, men kommandon ska ändå kontrollera att ärendet finns via `ctx.repo`.
4. **Revisionslogg** (`ctx.audit`) för visning av deltagarkort, rapport och transkript, alla ändringar, exporter och AI-körningar.
5. **Utskick** bara via `ctx.notify`. Texten innehåller aldrig personuppgifter – bara ärendenummer och "logga in för att läsa".
6. **Avtalsvärden från konfigurationen** (`contracts.config`, zod-validerad i `src/core/config.ts`). Hårdkoda aldrig 32 %, 35 %, BOT, priser eller deadlines. Värden `ATT_FASTSTÄLLA` visas som "Ej fastställt".
7. **AI föreslår – människan bedömer.** Bedömningsfält är tomma tills coachen valt. Aldrig AI för skyddade ärenden.
8. **Skyddade personuppgifter:** ingen adress, inga SMS/mejl till deltagaren, ingen AI, bara namngiven coach och avtalsansvarig.
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
- Färger bara via temat (`antracit`, `rod`, `ljusgra`, `bla`, `vit` och `-ton`-varianterna). Inget grönt.

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
| sam.start | `/start` | inkorg |
| sam.inkorg | `/inkorg/:emailId?` | inkorg |
| sam.deadlines | `/forfaller` | inkorg |
| arenden.lista | `/arenden` | arenden |
| arende.kort | `/arenden/:caseId` (`?flik=`) | arenden |
| hand.start | `/handledare` | arenden |
| coach.minvecka | `/min-vecka` | coach |
| coach.narvaro | `/narvaro` | coach |
| coach.avstamning | `/avstamning/:caseId?` | coach |
| coach.manad | `/manadsbedomning/:caseId?` (`?manad=2027-01`) | coach |
| coach.kartlaggning | `/kartlaggning/:caseId?` | coach |
| coach.handelse | `/handelse/:caseId?` (`?lage=avslut`) | coach |
| rapporter.lista | `/rapporter` | rapporter |
| rapport.visa | `/rapporter/:reportId` | rapporter |
| chef.oversikt | `/ledning` | ledning |
| chef.avvikelser | `/avtalsavvikelser/:id?` | ledning |
| eko.start | `/ekonomi` | ekonomi |
| eko.arende | `/ekonomi/arende/:caseId` | ekonomi |
| eko.faktura | `/ekonomi/:month/faktura/:caseId` | ekonomi |
| eko.korning | `/ekonomi/:month` | ekonomi |
| admin.avtal | `/admin/avtal` (`?avtal=&flik=`) | admin |
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
| kom.chef | `/portal/bestallarrapport` | kommun |
| om.start / om.feedback / om.fragor | `/om`, `/om/genomgang`, `/om/fragor` | bara prototypen (`src/demo`) |

Startsida per roll finns i `START_PATH` (`src/shell/routes.ts`).

**Frågeparametrar** som scenarierna och länkar använder (områdena ska läsa dem; hela listan och översättningen från prototypens vy-id finns i `src/demo/paths.ts`):
`/inkorg?senaste=1` (senaste avropet som väntar på svar) · `/inkorg?arende=<caseId>` · `/arenden?filter=skyddade` · `/arenden/<id>?flik=` · `/narvaro?vecka=forra|denna` · `/avstamning/<caseId>?avstamning=<checkInId>` · `/manadsbedomning/<id>?manad=2027-01` · `/handelse/<id>?lage=avslut` · `/rapporter?filter=` · `/ledning?flik=kpi|puls|coacher|omraden` · `/portal/deltagare/<caseId>?flik=` · `/admin/avtal?avtal=&flik=` · `/admin/mallar?flik=logg`.

## Rapporter: PDF och rapportutkast

- **PDF** (`src/features/rapporter/pdf/`): samma vy-modell som HTML-pappret (`reportDocument` → `ReportDocView`) ritas med react-pdf – samma avsnitt, ordning och texter (`pdf.test.tsx` jämför dem). Levererade rapporter byggs av den frysta ögonblicksbilden (`reports.snapshot`), så en levererad rapport ger alltid samma PDF-innehåll. PDF:en byggs i webbläsaren när någon klickar "Ladda ner PDF" (dynamisk import, så vanliga sidor inte blir större) och sparas inte – `reports.pdf_path` används inte. Kommandot `rapporter.download` kontrollerar behörigheten på servern och loggar `report.downloaded` först. Montserrat är inbäddat som data-URL:er (`fonts-data.ts`, genereras av `scripts/pdf/generate-fonts.ts`), så det fungerar likadant i Next och i prototypens enda HTML-fil. Logotypen ritas på ett ställe (`pdf/brand.tsx`).
- **Nedladdning**: `useDownload()` tar text eller binärt (Blob/Uint8Array). Appen: webbläsarens nedladdning. Prototypen: claude.ai:s downloads-förmåga, som tar binärt innehåll direkt (ingen base64).
- **Rapportutkast som skapas automatiskt** (`src/core/report-schedule.ts` + `src/features/rapporter/ensure.ts`): reglerna i avtalskonfigurationen (`reportSchedule`). Supabase-läget: jobbet `report_schedule` (`src/server/jobs/reports.ts`) högst var tionde minut. Minnesläget och prototypen: `memory-runtime.ts` kör samma funktion när testdatat läses in och när demoklockan passerar en vecko- eller månadsgräns. Raderna skapas framåt från där rader som inte skapats automatiskt slutar (på nyinläst testdata skapas inget), och varje körning prövar högst 62 dagar bakåt (`LOOKBACK_DAYS`). Unika index (`0018_rapportutkast.sql`) stoppar dubbletter när två körningar krockar.

## Tid, belopp och id

- `LocalDate` = `'YYYY-MM-DD'`, `LocalDateTime` = `'YYYY-MM-DDTHH:mm'`, alltid Europe/Stockholm (`src/core/time.ts`). Datalagret omvandlar till och från `timestamptz`.
- Veckor enligt ISO 8601; en vecka faktureras i månaden där torsdagen infaller. Arbetsdagar med svenska helgdagar (`src/core/holidays.ts`).
- Belopp i öre (heltal), priser exkl. moms, momssats per artikel.
- Id:n är strängar. Ärendenummer `BOT-26-0042` är människornas nummer och används i utskick; id:n i URL:er.

## Det som väntar på godkänd plan (CLAUDE.md: databas, behörigheter, AI, e-post/SMS, fakturering)

Hanterarna anropar redan gränssnitten, men produktionsadaptrarna byggs först när planen i `docs/PLAN-FAS1.md` är godkänd:

- `SupabaseRepo`, migrationer och RLS-policyer (Postgres i eu-north-1) – ersätter `MemoryRepo` i `src/server/runtime.ts`.
- Inloggning: Microsoft Entra för MB, e-post + sexsiffrig kod för kommunen.
- `ctx.notify` → `lib/notify` (e-post och SMS), `avrop@` via Microsoft Graph, AI via `lib/ai`, Fortnox-API.

## Tester

- Enhetstester i `src/core/**/*.test.ts` (Vitest): KPI:er, debiterbara veckor, torsdagsregeln, arbetsdagar/SLA, ärendenummer, beställarreferens och inköpsordernummer.
- Policytester (`src/data/policy.test.ts`): samma fall som RLS-testerna ska täcka – kommunanvändare ser bara sina ärenden, ekonom ser inga coachanteckningar, handledare bara tilldelade, skyddade ärenden bara namngivna.
- E2E (`tests/e2e`): varje test körs mot både prototypen och appen – det är beviset för att prototypen speglar appen.
