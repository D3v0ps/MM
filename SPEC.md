# Miljonmatch – kravspecifikation v0.2

*Produktnamn: Miljonmatch. Repo: `miljonmatch`. Ägare: Miljonbemanning AB (556959-9318). Version 2026-09-29.*

| | |
|---|---|
| Avtal nr 1 (pilot) | Botkyrka kommun – Yrkesförberedande och yrkesinriktade insatser. Avtal 332026110, dnr AVN/2026:00048 |
| Fler avtal | Miljonmatch är kommunernas plattform – fler kommunavtal kan läggas till som konfiguration (§6.3). Kammarkollegiet får en egen plattform (beslut 2026-10-06) och blandas aldrig ihop med Miljonmatch |
| Underlag | Avtalet, Administrativa föreskrifter och krav (AFK), bilagorna Botkyrka e-handel och Fakturerings- och betalningsvillkor, Frågor och svar, 01 Avropsmall, 02 Månadsrapport individ, uppstartspresentationen |

**Beslut 2026-10-06:** Kammarkollegiet får en egen plattform och blandas aldrig ihop med Miljonmatch. Det som fanns här för Kammarkollegiet – avtal nr 2, skissen av deras konfiguration (§6.3), fas 4 "KK-redo" (§12) och vad piloten skulle bevisa för dem (§14) – är borttaget ur kravspecen, koden och testdatat. Miljonmatch är kommunernas plattform: Botkyrka nu, fler kommunavtal senare.

**Beslut 2026-10-07 (Karim, synpunkterna från genomgången 2026-10-06):**

1. **Kommunen har bara rollen handläggare.** Alla med e-postadress på avtalets kommundomän (Botkyrka `@botkyrka.se`, `contracts.config.selfRegistration` – dubbel nyckel med beställarens tillåtna domäner) skapar ett konto själva vid första inloggningen med kod och blir kommunens handläggare. Rollen kommunens chef är borttagen ur portalen (beställarrapport, Hämta resultat, delade rapporter, chefens läsläge). Beställarrapporten och resultatfilen tas fram internt av avtalsansvarig och lämnas till kommunen av Miljonbemanning utanför Miljonmatch. Avtalsansvarig kan spärra ett konto.
2. **Skyddade personuppgifter är borttagna ur appen** – frågan ställs inte i beställningen och alla deltagare hanteras lika. Juridisk risk – stäms av med Botkyrka. Spärren i databasen (RLS och `src/data/policy.ts` för `protected_identity`) ligger kvar vilande – kolumnen är alltid false – så att skyddet kan slås på igen utan ny migration (CLAUDE.md punkt 8 ska ändras i samma anda – se §10).
3. **Fakturering:** en faktura per avtal och månad med ett ärende per rad, och Miljonbemanning (ekonomen) fyller i beställarreferensen – en per faktura. Referensen tas bort ur kommunens formulär. Kontrollen av referensen före fakturan finns kvar (CLAUDE.md punkt 11). Byggt i omgång B (§7.15, migration 0023). En faktura per avtal är en samlingsfaktura, som Botkyrkas villkor bara accepterar om den avtalats särskilt (§3, §13 fråga 5).
4. **Bilagor till beställningen:** "Bakgrundsinformation om deltagaren" med frågan om en kartläggning har genomförts, bifogade filer (PDF, Word, bild, högst 10 MB per fil) och fritext. Filerna lagras i en privat bucket i Stockholm med samma behörighet som ärendet (§6.1 `case_attachments`, migration 0024).
5. **Övrigt:** omfattningen är 6 månader, 12 månader eller annan tidsperiod med motivering (alternativen ur `contracts.config.orderPeriods`); planerat slut räknas fram. Enhet är fritext. Inget önskat yrkesområde i beställningen – Miljonbemanning sätter avtalsområde och yrkesspår när beställningen bekräftas. Inga belopp eller ordervärden i något kommunen ser (portalen, orderbekräftelsen, mejl). Månadsrapportens närvaroavsnitt visar bara närvarograden. Portalen påminner inte om mejlavrop (rättelse från Karim) – mejlavropet via avrop@ fungerar fullt ut som förut (CLAUDE.md punkt 10). I testmiljön är AI:n simulerad och märks så. Inget ordervärde någonstans, inte heller internt: beställningen anges i veckor.
6. **Pengar syns bara för ekonomen** (Karim, beslut 5 samma dag): bara rollen ekonom ser belopp i kronor – fakturorna, fakturaunderlaget och prislistan (flyttad från avtalssidan till Ekonomi, `/ekonomi/prislista`). Alla andra roller – samordnare, avtalsansvarig, coach, handledare, chef, systemadministratör och kommunen – ser inga belopp, priser, prisartiklar, ordervärden, viten i kronor, bonusbelopp, ofakturerat i kronor eller AI-kostnader. I stället visas antal (veckor, ärenden) eller ingenting. Spärren ligger på servern med samma mekanism som testarspärren (`hidesMoney` i `src/api/tester-access.ts`), och Ekonomi är bara öppen för ekonomen (§4).

**Granskningen 2026-10-07 (efter omgång A och B):** självregistreringen kräver synligheten "own" och avvisar plusadresser, enheten för synligheten "unit" tas bara från medlemskapet, och taket för nya konton räknas på unika adresser och per IP (§4). Kommunen läser inte avtalets viten, bonusanspråken eller beställarrapporten (0026). Bilagor i avböjda beställningar gallras och lagringen stäms av mot bilagorna (§7.2). En returnerad faktura görs om från dagens underlag, en avbruten skapelse kan köras om, och reservläget en faktura per ärende använder ärendets referens (§7.15, 0023). Migrationens konvertering av gamla fakturor räknar som den gamla modellen. CLAUDE.md punkt 8 ändras av Karim.

**Nytt i v0.2:** namnet är fastställt, upphandlingsdokumenten är inlästa och Botkyrkas besked är inarbetade. Det viktigaste som ändrats: beställningar sker formellt via mejl, närvarorapport ska lämnas varje vecka, fakturor kräver kommunens beställarreferens och samlingsfakturor accepteras inte utan särskild överenskommelse.

---

## 1. Sammanfattning

Botkyrka-avtalet gäller 70–100 årsplatser med insatser på typiskt 4–10 veckor (utvärderingspriset byggde på 4 och 10 veckor). Sedan 2026-10-07 beställer kommunen 6 eller 12 månader eller en annan tidsperiod med motivering (§7.2). Med 7 veckor i snitt blir det 40–60 nya avrop i månaden, alltså 2–3 per arbetsdag, och varje avrop ska besvaras inom en arbetsdag. Beställningar sker via mejl. MB ska lämna närvarorapport varje vecka, progressionsrapport varje månad och slutrapport efter varje insats. Vite är 25 000 kr per tillfälle vid avvikelse eller bristfällig information, och kommunen har två leverantörer per område – obesvarade avrop kan flytta ner MB i rangordningen.

Miljonmatch samlar hela kedjan i ett system: kommunen beställer (mejl eller portal), MB:s coacher dokumenterar (manuellt eller med AI-stöd), rapporter genereras från godkända uppgifter, KPI:er och deadlines bevakas, och fakturaunderlag går till Fortnox. Den byggs för flera kommunavtal från dag 1: Botkyrka är avtal nr 1, och fler kommunavtal kan läggas till med samma kod och ny konfiguration (§6.3).

**Designprincip (från Miljonmatch-bilden i uppstartspresentationen):** automatisera informationsinsamling, dokumentation och påminnelser – håll utveckling, coachning, bedömning, matchning och uppföljning mänskligt. Det är också den juridiskt säkra linjen för AI-stödet (§8).

---

## 2. Mål, icke-mål och framgångsmått

| Mål | Mått | Målvärde |
|---|---|---|
| Inga missade avtalskrav | Avrop besvarade inom en arbetsdag · veckorapporter i tid · månadsrapporter i tid | 100 % · 100 % · 100 % |
| Snabb avropshantering | Samordnarens tid per avrop från mejl till orderbekräftelse | ≤ 2 min |
| Mindre dokumentationstid | Median minuter från avstämningens slut till godkänd dokumentation (baslinje mäts i fas 1 utan AI) | ≤ 5 min |
| Resultatstyrning | Resultatgrad aktuell varje vecka; flagga under internt mål (35 %) och avtalsmål (32 %) | Alltid aktuell |
| Snabb och korrekt fakturering | Arbetsdagar från månadsskifte till fakturor i Fortnox · ofakturerade veckor äldre än 45 dagar · fakturor som returneras av kommunen | ≤ 3 · 0 · 0 |
| Deltagarens röst | Svarsfrekvens i pulsmätningen | ≥ 60 % |

**Icke-mål i v1 (med skäl):**

- Ingen inloggning för deltagare – pulsmätningen använder engångslänk. Deltagarinloggning kan byggas senare (fas 4).
- AI fattar inga beslut och sätter inga bedömningar – den föreslår text med belägg (§8).
- Ingen egen e-fakturasändning – Fortnox skickar Peppol-fakturan.
- Ingen BankID i piloten – Microsoft-inloggning för MB och e-postkod för kommunen räcker.
- Inget eget videomötesverktyg – distansmöten sker i Teams och transkriptet hämtas därifrån (§8.2).
- Ingen lön eller tidrapportering för personal – det sköts i befintliga system.

---

## 3. Avtalsfakta som systemet måste hantera (Botkyrka)

- **Parter och period:** Botkyrka kommun – Miljonbemanning AB, 2026-09-10 – 2030-09-10. Uppsägning utan skäl tidigast två år efter start, tre månaders uppsägningstid. Uppskattat värde 24 Mkr, tak 30 Mkr (alla områden).
- **Omfattning:** kapacitet för minst 70 årsplatser, behov upp till 100 per år. Deltagarna är personer inom aktivitetskravet och anvisas av kommunen. Två leverantörer per område i rangordning; MB är rangordnad 1 i alla tolv. Språkfrämjande insatser och gruppaktiviteter ingår inte.
- **Avtalsområden:** A Administration · B Hälsa och sjukvård · C Bygg och anläggning · D Kök/restaurang/måltidsservice · E Transport/åkeri · F Lokalvård · G Lager/logistik · H Serviceyrken · I Fastighet/mark/park · J Parti-/detaljhandel · K Industri · L Övrigt.
- **Beställning (AFK 7.9):** sker via mejl. Avropsförfrågan besvaras inom en arbetsdag. Möten ska bokas in inom en vecka.
- **Rapportering (AFK 7.2 och 7.8):** närvarorapport på deltagarnivå **varje vecka** · progressionsrapport på deltagarnivå varje månad · slutrapport efter genomförd insats · närvaro, progression och avvikelser dokumenteras på deltagarnivå · uppföljningsmöte kallas vid avvikelser · rutin för frånvaro, avvikelser och risker.
- **Insatsens innehåll:** individuell kartläggning, matchning, träning/stöd, uppföljning, validering och arbetsplatsanpassning i en strukturerad process; praktik och rekryteringsvägar (särskilt lager/logistik); kontinuitet med samma utbildare/handledare; anpassning för NPF, språkliga hinder och fysiska/psykiska begränsningar; handledare med yrkeskompetens inom insatsen; en kundansvarig som kan avtalet.
- **Validering (Frågor och svar):** vägleda till formell validering för betyg, kartlägga och dokumentera individens reella kompetens och utfärda yrkeskompetensbevis/diplom.
- **Progression (AFK 7.8):** utvecklingen ska delas upp i tydliga områden – kommunen nämner som exempel fysisk och psykisk hälsa, språk, livskvalitet och självständighet – så att förändring syns, inte bara slutresultat.
- **Resultatmål:** minst 32 % av deltagarna ska ha gått vidare till arbete eller studier efter avslutad insats. Internt styrmål 35 %. Den exakta definitionen ska fastställas gemensamt (§13).
- **Bonus:** möjlig när deltagaren går ut i arbete i anslutning till genomförd insats eller har gjort progression enligt en incitamentsmodell (MB lämnade förslag i anbudet; ingår inte i det signerade avtalet). Bonus begärs med redovisningsunderlag, och kommunen avgör om en anställning är sammanhållen.
- **Pris:** per deltagare och vecka, 1 323–1 668 kr exkl. moms beroende på område. Fast i 12 månader; därefter högst 80 % av förändringen i AKI tjänstemän näringsgren O, högst en gång per tolvmånadersperiod, skriftlig begäran senast två månader före, aldrig retroaktivt.
- **Fakturering (fakturerings- och betalningsvillkoren):** Peppol BIS Billing 3 – e-post- och pappersfakturor accepteras inte (kommunen erbjuder en kostnadsfri fakturaportal som reserv). Månadsvis i efterskott; betalning 30 dagar efter godkänd leverans och korrekt faktura. Fakturan ska innehålla antingen ett **inköpsordernummer** (nio siffror som börjar med 99, vid köp via kommunens e-handel eller rekvisition) eller en korrekt **beställarreferens** (8–10 siffror, bara siffror, lämnas av kommunen vid varje inköp). Periodisk fakturering ska ange faktureringsobjektet och hållas isär från annan fakturering. Upparbetat och återstående belopp på beställningen ska anges där det är tillämpligt. **Samlingsfakturor accepteras inte** om det inte särskilt avtalats (beslutet 2026-10-07 om en faktura per avtal och månad förutsätter Botkyrkas skriftliga godkännande – §13 fråga 5). Fel pris eller fel/saknad information på fakturan räknas som ekonomisk avvikelse. Faktureringspreskription två månader efter utfört arbete.
- **E-handel:** kommunen använder Visma Proceedo. SFTI-format ska vara överenskomna och etablerade inom tre månader från avtalsstart (senast 2026-12-10) eller vid första leverans om den kommer tidigare.
- **Dataskydd och sekretess:** MB är personuppgiftsbiträde; separat PUB-avtal enligt SKR:s mall. Ingen behandling eller överföring utanför EU/EES utan kommunens särskilda skriftliga förhandsgodkännande. Sekretess gäller även efter avtalet. Vid uppsägning ska kommunens data återlämnas inom en kalendermånad och sedan inte behållas. Dokumenterade rutiner för informationssäkerhet krävs: policy, utbildning, skydd mot skadlig kod och incidenthantering.
- **Uppföljning och sanktioner:** avvikelser är kvalitets-, process-, avtals- eller ekonomiska avvikelser på tre nivåer (mindre, större, allvarlig) och hanteras i en eskaleringstrappa. Åtgärdsplaner godkänns av kommunen. Tre skriftliga varningar kan leda till uppsägning. Kommunen kan hålla inne betalning, ta ut vite (25 000 kr per tillfälle vid avvikelse och vid bristfällig löpande information), besluta om avropsstopp och flytta MB sist i rangordningen vid upprepade fel, förseningar, obesvarade avropsförfrågningar eller frekventa nej.
- **Statistik och insyn:** statistik lämnas kostnadsfritt på begäran, högst två gånger per år och även ett år efter avtalsslut. Vid avtalsuppföljning har kommunen rätt till all relevant information utan extra kostnad. Allt material ska vara på svenska.
- **Löften i uppstartspresentationen:** avropet tas emot dag 0 · svar inom en arbetsdag med bokad start och ansvarig resurs · första möte med kartläggning, veckomål och valt yrkesspår vecka 1 · löpande närvarorapport · månadsvis progressionsrapport · slutrapport vid avslut. Röd tråd: samma coach, veckovis närvaro, månadsvis progression, avvikelse = åtgärd.
- **Deltagarresan i fem faser:** 1 Kartläggning · 2 Yrkesförberedande grund · 3 Yrkesspecifika moment · 4 Praktik/APL (när deltagaren är redo) · 5 Matchning och slutrapport.
- **Team per yrkesspår:** huvudcoach, arbetsgivarmatchare, SYV/metodstöd och yrkesspecifik handledare. **Praktik – "fyra rätt":** rätt arbetsuppgift, rätt handledning, rätt timing, rätt uppföljning.

### 3.1 Besked från Botkyrka (2026-09-29)

- **Inspelning av avstämningar och MB:s underleverantörer är godkända.** Beskedet ska in skriftligt i PUB-avtalets bilagor (instruktioner och förteckning över underbiträden), inklusive eventuell åtkomst från tredje land (§10).
- **Kommunen har inget inköpsordersystem för detta.** MB bygger beställningsflödet i Miljonmatch (§7.1–7.4). Fakturan behöver ändå kommunens beställarreferens, eftersom köpet sker utanför kommunens e-handelssystem (§7.15).
- **Debiterbar vecka = alla veckor deltagaren är inskriven hos MB** (§7.15).
- **Tillägg 2026-09-30 (enligt MB):** Botkyrka har skriftligen godkänt röstinspelning och transkribering även för **kommunens handläggare** (inspelad information direkt i systemet) och **deltagaren** (egna inspelningar), inom det här projektet. Godkännandet ska in i PUB-avtalets instruktioner tillsammans med beskedet från 2026-09-29. Reglerna i §8.1 gäller för alla tre: samtycke, aldrig skyddade ärenden, ljud raderas efter transkribering och rapporter byggs bara av godkända uppgifter.

---

## 4. Roller och behörigheter

| Roll | Org | Ser | Gör | Inloggning |
|---|---|---|---|---|
| Systemadmin | MB | Allt inklusive konfiguration och logg – utom priser och belopp | Användare, avtal, integrationer | Microsoft (Entra ID) |
| Avtalsansvarig / kundansvarig | MB | Allt inom sina avtal utom belopp | Accepterar/avböjer avrop, godkänner beställarrapporten och lämnar den och resultatfilen till kommunen, hanterar avtalsavvikelser och registrerar kommunens godkännande av åtgärdsplaner, bjuder in och spärrar kommunanvändare | Microsoft |
| Operativ samordnare | MB | Alla ärenden i avtalet | Avropsinkorg, tilldelar coach, bokar start | Microsoft |
| Huvudcoach | MB | Egna ärenden | Kartläggning, avstämningar, närvaro, bedömningar, utfall, rapporter | Microsoft |
| Handledare / arbetsgivarmatchare / SYV | MB | Tilldelade ärenden | Moment, praktik, arbetsgivarkontakter, närvaro, validering | Microsoft |
| Chef / controller | MB | Allt i läsläge utom belopp (ofakturerat och viten visas som antal), KPI:er, flaggor, revisionslogg | Kvitterar flaggor, åtgärdsplaner, loggkontroll. Får ändå spara, dela inom Miljonbemanning och arkivera egna rapporter i rapportbyggaren (§7.11 k, beslut 2026-10-02) | Microsoft |
| Ekonom | MB | Ärendenummer, perioder, avtalsområde, referenser, fakturaunderlaget, fakturorna med belopp och prislistan – inga anteckningar eller rapporter. Den enda rollen som ser belopp (beslut 2026-10-07) | Fakturakörning, beställarreferens och inköpsordernummer per faktura, Fortnox, kreditering, export | Microsoft |
| Kommunens handläggare | Beställare | Egna beställda ärenden (självregistrering kräver `customerVisibility: own` – kontrolleras i koden när kontot skapas). Inga belopp: inte avtalets viten och inte bonusanspråken (0026) | Beställer, bifogar filer, läser rapporter, skickar meddelanden, kvitterar, beslutar om bonusanspråk (fas 3, i en vy utan belopp), fyller i Mina uppgifter | E-post + engångskod; kontot skapas själv på avtalets kommundomän (beslut 2026-10-07) |
| Deltagare (fas 4) | – | Egen plan och bokningar | Bokar, svarar på puls | BankID (senare) |

**Inloggning:**

- **Belopp bara för ekonomen (beslut 2026-10-07):** belopp i kronor, priser, prisartiklar, viten i kronor, bonusbelopp, ofakturerat i kronor och AI-kostnader lämnas bara ut när aktören har rollen ekonom och inte är en begränsad testare. Servern tar bort beloppsfälten i svaren till alla andra roller och nekar Ekonomis frågor och kommandon för dem (`hidesMoney`, `src/api/tester-access.ts`). Chefen ser ofakturerade veckor som antal veckor och ärenden, avtalsavvikelserna visar om kommunen tagit ut vite men inte beloppet, och avtalssidan visar inte prislistan. Behörigheten i databasen (RLS) för fakturatabellerna är oförändrad (§13).
- **Kommunens chef är borttagen som roll (beslut 2026-10-07).** Beställarrapporten och resultatfilen lämnas av Miljonbemanning (avtalsansvarig) utanför Miljonmatch. Befintliga chefskonton görs om till handläggare (migration 0026).
- MB-personal loggar in med Microsoft Entra ID via Supabase Auth (Azure-leverantören). MFA styrs av M365. Ingen självregistrering – bara inbjudna konton.
- Kommunanvändare loggar in med **e-post + sexsiffrig engångskod**, inte magisk länk: e-postskydd som Microsoft Safe Links öppnar länkar i förväg och förbrukar engångslänkar. Koden gäller 10 minuter, max 5 försök, hastighetsbegränsning per adress och IP och ett tak för hela appen (högst 30 kodmejl per timme). Session: utloggning efter 60 minuters inaktivitet, max 12 timmar. Tillåtna e-postdomäner per beställare (t.ex. `botkyrka.se`). **Självregistrering (beslut 2026-10-07):** en adress på avtalets kommundomän (`contracts.config.selfRegistration.emailDomains` och beställarens domäner – båda måste stämma, aldrig en underdomän eller Miljonbemannings domän) som saknar profil får ett konto som kommunens handläggare när koden verifierats: profil och medlemskap, namnet förifyllt ur adressen, enheten tom. Handläggaren hamnar på Mina uppgifter (`/portal/mina-uppgifter`) och fyller i namn, telefon och enhet (fritext). Revisionsloggen får `profile.self_registered` med id och domän – aldrig adressen. En befintlig eller spärrad adress registreras aldrig om, och adresser med plustecken (`namn+1@…`, ofta samma brevlåda) får inget konto – annars kunde ett spärrat konto kringgås. Självregistreringen kräver att avtalets konfiguration klarar zod-schemat och att handläggarna bara ser sina egna beställningar (`customerVisibility` "own") – det kontrolleras i koden när kontot skapas, eftersom enheten är fritext som handläggaren skriver själv. Av samma skäl tas enheten för synligheten "unit" bara från medlemskapet (som Miljonbemanning sätter), aldrig från profilen (`actorFor`, `mm.current_unit`, 0026). Taket för nya konton räknas på unika adresser: högst 20 per timme i hela appen och högst 3 per timme från samma IP (hashat i `login_attempts`), så att påhittade adresser från en avsändare inte stänger självregistreringen för andra. Samma spärrar för kodmejlen som förut, och i testmiljön gäller `MM_EMAIL_ALLOWLIST`. Avtalsansvarig kan fortfarande bjuda in och spärra konton.
- **Appen skickar inloggningskoden själv (beslut 2026-10-02).** Servern tar fram koden hos Supabase Auth med `auth.admin.generateLink({ type: "magiclink" })` (service role – Supabase skickar då inget mejl) och skickar den direkt via Resend från `notis@miljonmatch.se`, bara till en behörig adress (aktiv profil med roll, tillåten domän och – i staging – `MM_EMAIL_ALLOWLIST`), aldrig omdirigerad. Koden verifieras med `verifyOtp({ type: "email" })` som tidigare. Mejlet visar bara koden – ingen länk – i MB:s profil. Koden sparas aldrig i appens databas, jobbkö, loggar eller revisionslogg: utskicksloggen får en rad (`inloggningskod`) med texten utan koden. Koden finns bara i mottagarens brevlåda och i Resends sändlogg (därför har bara administratörer åtkomst till Resend). Supabase Auth har ingen spärr på `generateLink` och skickar inget mejl, så appens spärrar (per adress och IP) och taket för hela appen (30 kodmejl per timme, beslut 2026-10-02) är de enda för utskicken. Skäl: Supabases eget utskick krävde en mall som klistras in för hand, och i staging kom dess engelska standardmall med en länk som Microsofts länkskanner förbrukade. Supabase Auths SMTP och e-postmallar behövs därför inte (SMTP-inställningen får ligga kvar som reserv, mallen `supabase/templates/otp.html` ser likadan ut som appens kodmejl). `docs/DRIFT.md` avsnitt 2.1, `docs/UTSKICK.md`.

---

## 5. Arkitektur

```
 Kommunens handläggare ─┐                        ┌─► Microsoft Graph (avrop@-brevlådan, Entra-inloggning)
 MB:s personal ─────────┼─► Next.js på Vercel ───┼─► AI-adapter ─► Berget AI (Sverige) | Vertex AI EU-endpoint
 Deltagare (pulslänk) ──┘   (funktioner i arn1,   ├─► Fortnox API (fakturor → Peppol)
                             Stockholm)           ├─► SMS-leverantör
                                  │               └─► E-post (transaktionell, SPF/DKIM/DMARC)
                                  ▼
                 Supabase eu-north-1 (Stockholm)
                 Postgres + RLS · Auth · Storage (privata buckets) · cron
```

**Underbiträden** – godkända av Botkyrka 2026-09-29, utom Resend (e-post), som valdes senare och väntar på kommunens godkännande; förs in i PUB-avtalets förteckning och visas i adminvyn. Håll listan kort.

| Leverantör | Behandling | Plats |
|---|---|---|
| Supabase | Databas, inloggning, fillagring | Stockholm (eu-north-1) |
| Vercel | Applikation och serverfunktioner | Funktioner i Stockholm (arn1) |
| AI-leverantör (en av två, §8.4) | Transkribering och textutkast | Berget AI: Sverige · Google: EU multi-region |
| SMS-leverantör | Påminnelser och pulslänkar | Väljs – helst svensk |
| E-postleverantör: Resend (vald – väntar på kommunens godkännande; ska in i PUB-avtalets förteckning) | Notiser och inloggningskoder från `notis@miljonmatch.se` (§11) | EU (Irland, eu-west-1) |
| Microsoft | Inloggning (Entra) och avrop@-brevlådan (Graph – applikationsbehörighet `Mail.ReadWrite` begränsad till brevlådan avrop@ med en ApplicationAccessPolicy; data stannar i M365:s EU-tenant, appen kör i arn1) | Befintligt M365 |

---

## 6. Datamodell

### 6.1 Tabeller

| Tabell | Syfte | Viktiga fält |
|---|---|---|
| organizations | Leverantörer och beställare | name, org_nr, kind (supplier/customer), email_domains[] |
| contracts | Avtal = konfiguration | supplier_id, customer_id, name, contract_number, dnr, starts_on, ends_on, case_prefix, data_role (processor/controller), config (jsonb, zod-validerad), status |
| contract_areas | Avtalsområden | contract_id, code (A–L), name, active |
| price_items | Prislista med giltighet | contract_id, area_id?, code, unit (participant_week/month/package/each), package_months?, price_ore, vat_rate, valid_from, valid_to, fortnox_article_no |
| profiles | Användare | id (= auth.users), organization_id, full_name, email, phone, title, active |
| memberships | Roll per avtal | user_id, contract_id, role, customer_unit? |
| buyer_references | Kommunens beställarreferenser | customer_id, reference (8–10 siffror), unit, default_for_user_id?, active |
| persons | Individen | personnummer_enc, personnummer_hash, first_name, last_name, phone, email, city, preferred_contact, protected_identity, accessibility_needs, language |
| cases | Ärende = beställning (en anvisning i ett avtal) | contract_id, person_id, case_number (unik), status (received/acknowledged/confirmed/active/paused/closed/declined), source (email/portal/phone), referred_at, referrer_name/unit/phone/email, buyer_reference, purchase_order_number?, primary_area_id, secondary_area_id, vocational_track, desired_start, planned_end, planned_weeks, acknowledged_at, confirmed_at, start_date, end_date, end_reason, result_class, result_verified_at, phase (1–5), lead_coach_id, background_info, ai_consent_status |
| case_status_history | Status- och coachbyten | case_id, from_status, to_status, from_coach, to_coach, reason, changed_by, changed_at |
| case_counters | Löpnummer för ärendenummer | contract_id, year, last_value (radlås vid ökning) |
| case_team | Team per ärende | case_id, user_id, role |
| inbound_emails | Beställningar via mejl – och beställningar som Miljonbemanning registrerade efter mejl, telefon eller annan väg (beslut 4a, 2026-10-08: `parse_method manual`, `registered_by`, `registered_at`, `graph_message_id = manual:<id>`) | graph_message_id (unik – Message-ID ur mejlet), received_at, from_address, subject, body_text, attachments (jsonb: namn, typ, sökväg till ärendets bilaga), parse_method (template/ai/manual), classification, extracted (jsonb), confidence (jsonb), missing_fields[], status, case_id, linked_by, registered_by, registered_at, handled_by, handled_at |
| intake_assessments | Kartläggning vecka 1 | case_id, work_experience, education, language_notes, digital_skills, driving_licence, work_goals, chosen_track, adaptations (funktionellt), first_week_goal, approved_by, approved_at |
| activities | Planerade tillfällen | case_id, kind (möte, yrkesmoment, praktikdag, arbetsgivarbesök, annat), starts_at, duration_min, location, note |
| attendance | Närvaro per tillfälle | activity_id, case_id, status (present, late, absent_valid, absent_invalid), reason, customer_notified_at |
| check_ins | Veckoavstämning | case_id, held_at, duration_min, mode (fysiskt/telefon/video), input_method, goal_status, next_goal, phase, activities_done[], employer_contacts, overall_status, obstacles[], note, ai_run_id, status (draft/approved), approved_by, approved_at |
| monthly_assessments | Progression per område och månad | case_id, month, area_key, level (0–3), observation, next_step, ai_level_suggestion, ai_observation_draft, decided_by, decided_at – unik (case_id, month, area_key) |
| monthly_plans | Plan för nästa månad (mall 02 avsnitt 7) | case_id, month, goal_1, goal_2, planned_activities, planned_employer_contact, planned_adaptation, next_customer_meeting |
| outcome_events | Händelser och utfall | case_id, kind, occurred_on, actor, verification_kind, verification_path, note |
| deviations | Avvikelse, risk och åtgärd på deltagarnivå | case_id, description, assessment, action, owner_id, follow_up_on, needs_customer_decision, follow_up_meeting_at, status |
| contract_deviations | Avtalsavvikelser, varningar, klagomål | contract_id, source (beställare/deltagare/arbetsgivare/intern), type (kvalitet/process/avtal/ekonomi/klagomål), level (mindre/större/allvarlig), description, raised_at, action_plan, action_plan_due, customer_approved_at, warning_issued, penalty_ore, status |
| employers | Arbetsgivarregister | name, org_nr, contact_name, phone, email, areas[] |
| placements | Praktik/APL | case_id, employer_id, starts_on, ends_on, tasks, supervisor_name, goals, follow_up_dates[], status |
| reports | Alla rapporter och intyg | contract_id, case_id?, recipient_user_id?, kind (weekly_attendance/monthly/final/order_confirmation/customer_summary/skills_certificate/statistics), period_start, period_end, status, snapshot (jsonb: den frysta vy-modellen och, för månads- och slutrapporter, fakta för kommunens resultatfil), pdf_path, version, due_at, approved_by, approved_at, delivered_at, delivered_to[], opened_at |
| pulse_invites | Pulsutskick | case_id, token_hash, channel, language, occasion (week2/exit/periodic), sent_at, expires_at, used_at |
| pulse_responses | Pulssvar | invite_id (unik – ett svar per länk), answers (jsonb), language, contact_requested, submitted_at |
| bonus_claims | Bonusanspråk (fas 3) | case_id, kind (work/progression), basis, evidence_paths[], submitted_at, customer_decision, decided_by, decided_at, amount_ore, invoice_draft_id |
| kpi_snapshots | Beräknade KPI:er | contract_id, kpi_key, window, value, numerator, denominator, computed_at |
| alerts | Flaggor | contract_id, case_id?, kind, severity, message, recipient_roles[], created_at, acknowledged_by, acknowledged_at, action_plan |
| deadlines | SLA-bevakning | contract_id, case_id?, report_id?, kind, due_at, met_at, status |
| billing_runs | Fakturakörning per månad | contract_id, month, status, created_by |
| invoice_drafts | En faktura per avtal och månad (Botkyrka, `billing.invoicePer: contract_and_month`) eller per ärende och månad (`case_and_month`) – migration 0023 | billing_run_id, contract_id, month, kind (periodic/bonus), case_id? (bara vid en faktura per ärende), grouping_key (`avtal`; tilläggsfakturor `avtal-tillagg-2` …), buyer_reference (en per faktura, fylls i av ekonomen), purchase_order_number? (bara kommunens 99-nummer; tomt = inget), invoiced_object (avtalsnumret – ärendenumret står på varje rad), accrued_ore, remaining_ore, status, approved_by/at, manual_invoice_no, fortnox_document_number, fortnox_idempotency_key (unik), fortnox_created_at, synced_at. Unikt: avtal + månad + grupp för periodiska fakturor |
| invoice_lines | Fakturans rader, en per ärende (unikt per faktura). Frysta när fakturan skapas i Fortnox eller markeras som manuellt fakturerad – en skapad faktura ändras aldrig (0023) | invoice_draft_id, case_id, price_item_id, quantity, unit_price_ore, vat_rate, description, iso_weeks[], zero_attendance_weeks[], note (upparbetat och återstående, Peppol BT-127) |
| invoice_credits | Kreditering av en returnerad faktura som görs om (0023) | contract_id, month, invoice_draft_id (fakturan som krediterades; case_id bara i äldre rader), credited_at, credited_by, buyer_reference |
| integrations | Fortnox, Graph, SMS, e-post | kind, status, config, secrets_enc, token_expires_at |
| jobs | Bakgrundsjobb | kind, payload, status, attempts, run_after, last_error |
| ai_runs | Varje AI-anrop | case_id?, kind, provider, model, input_ref, status, audio_seconds, tokens_in, tokens_out, cost_ore, latency_ms, output (jsonb), evidence (jsonb), input_deleted_at |
| ai_field_decisions | Coachens beslut per förslag | ai_run_id, field, suggested, final, decision (accepted/edited/rejected), decided_by, decided_at |
| consents | Samtycke till inspelning/AI | person_id, case_id, kind, text_version, given_at, informed_by, revoked_at |
| messages | Säkra meddelanden per ärende | case_id, sender_id, body, created_at, read_by, read_at |
| case_notes | Fria anteckningar i deltagarkortet (§7.18) | contract_id, case_id, author_id, occurred_on, kind (conversation/customer_contact/practical/other), audience (full/team), body (1–2000 tecken), created_at, updated_at, removed_at, removed_by – raderas aldrig av användare |
| saved_reports | Rapportbyggarens sparade rapporter (§7.11 k, 0021) | contract_id, owner_id, title (3–80 tecken, inga personnummer eller ärendenummer), template_key?, definition (jsonb, zod-validerad, `v: 1`), visibility (private/mb/customer), created_at, updated_at/updated_by, shared_at/shared_by, archived_at/archived_by – raderas aldrig, arkiveras |
| audit_log | Revisionslogg, append-only | occurred_at, actor_id, action, entity, entity_id, contract_id, details (jsonb) |
| holidays | Svenska helgdagar | date, name |

### 6.2 Avtalskonfiguration – Botkyrka

`ATT_FASTSTÄLLA` = värdet ska bekräftas (§13). Systemet ska vägra aktivera en regel som fortfarande har det värdet och i stället visa en varning i adminvyn.

```json
{
  "casePrefix": "BOT",
  "dataRole": "processor",
  "thirdCountryProcessing": "forbidden_without_written_approval",
  "orderChannels": ["email", "portal", "phone"],
  "customerVisibility": { "scope": "ATT_FASTSTÄLLA (own | unit | all)", "seesIndividualReports": true, "seesCoachNotes": false, "seesSlaStats": false },
  "reportDelivery": { "channel": "portal", "emailAttachmentAllowed": false },
  "phases": [
    { "no": 1, "name": "Kartläggning" },
    { "no": 2, "name": "Yrkesförberedande grund" },
    { "no": 3, "name": "Yrkesspecifika moment" },
    { "no": 4, "name": "Praktik/APL" },
    { "no": 5, "name": "Matchning och slutrapport" }
  ],
  "stuckRules": [ { "phase": 1, "maxDays": 10 }, { "phase": 3, "maxDays": 35, "unlessPlacementPlanned": true } ],
  "progression": {
    "scale": { "0": "Ingen / för tidigt att bedöma", "1": "Liten", "2": "Tydlig", "3": "Uppnått delmål" },
    "areas": ["narvaro_rutiner", "yrkesfardigheter", "arbetskapacitet", "sjalvstandighet", "digital_sjalvstandighet", "instruktioner", "arbetsgivarkontakter", "beredskap", "sprak_kommunikation", "ovrigt"],
    "optionalAreas": ["halsa_funktionellt", "livskvalitet_sjalvskattad"],
    "observationRequiredFromLevel": 1,
    "clearFromLevel": 2,
    "anyFromLevel": 1
  },
  "result": {
    "definition": "ATT_FASTSTÄLLA",
    "countsAsResult": ["arbete", "studier"],
    "excludedFromDenominator": "ATT_FASTSTÄLLA",
    "requiresVerification": true
  },
  "kpis": [
    { "key": "resultatgrad", "windows": ["rolling_6m", "since_start"], "contractTarget": 0.32, "internalTarget": 0.35, "minN": 10,
      "notify": { "belowInternal": ["chef", "controller"], "belowContract": ["chef", "controller", "avtalsansvarig"] } },
    { "key": "avrop_besvarade_i_tid", "windows": ["month"], "internalTarget": 1.0 },
    { "key": "forsta_mote_inom_en_vecka", "windows": ["month"], "internalTarget": 1.0 },
    { "key": "veckorapporter_i_tid", "windows": ["month"], "internalTarget": 1.0 },
    { "key": "manadsrapporter_i_tid", "windows": ["month"], "internalTarget": 1.0 },
    { "key": "narvarograd", "windows": ["month"], "internalTarget": "ATT_FASTSTÄLLA" },
    { "key": "nojdhet", "windows": ["rolling_3m"], "internalTarget": "ATT_FASTSTÄLLA" }
  ],
  "sla": [
    { "key": "ordererkannande", "from": "avrop_mottaget", "within": { "minutes": 5 }, "automatic": true },
    { "key": "avrop_svar", "from": "avrop_mottaget", "within": { "workingDays": 1 } },
    { "key": "forsta_mote", "from": "avrop_mottaget", "within": { "days": 7 } },
    { "key": "veckorapport_registrering", "due": "måndag 10:00 för föregående vecka" },
    { "key": "veckorapport_publicering", "due": "måndag 16:00 för föregående vecka" },
    { "key": "manadsrapport", "due": "ATT_FASTSTÄLLA (förslag: 5:e arbetsdagen efter månadsskiftet)" },
    { "key": "slutrapport", "from": "avslutsdatum", "within": "ATT_FASTSTÄLLA (förslag: 5 arbetsdagar)" }
  ],
  "attendance": { "sameDayNoticeOnInvalidAbsence": "ATT_FASTSTÄLLA", "repeatedAbsenceRule": { "absentInvalid": 2, "withinDays": 14 } },
  "billing": {
    "unit": "participant_week",
    "billableWeekRule": "every_iso_week_with_at_least_one_enrolled_day_excluding_paused_weeks",
    "flagZeroAttendanceWeeks": true,
    "weekToMonthRule": "iso_thursday",
    "invoicePer": "contract_and_month",
    "collectiveInvoiceAllowed": true,
    "buyerReference": { "required": true, "pattern": "^[0-9]{8,10}$" },
    "purchaseOrderNumber": { "required": false, "pattern": "^99[0-9]{7}$" },
    "invoicedObject": "case_number",
    "showAccruedAndRemaining": true,
    "separatePeriodicFromOther": true,
    "paymentTermsDays": 30,
    "unbilledWarningDays": 45,
    "format": "peppol_bis_3_via_fortnox",
    "fallback": ["export_xlsx_pdf", "botkyrka_fakturaportal"]
  },
  "bonus": { "enabled": false, "model": "ATT_FASTSTÄLLA enligt incitamentsmodellen", "separateInvoice": true },
  "pulse": { "occasions": ["week2", "exit"], "periodicEveryDays": 30, "languages": ["sv", "en", "ar", "so"], "minNForAggregate": 5 },
  "statistics": { "onRequestMaxPerYear": 2, "free": true },
  "termination": { "returnDataWithinDays": 31, "deleteAfterReturn": true },
  "retention": "ATT_FASTSTÄLLA enligt PUB-avtalet",
  "reportSchedule": { "automatic": ["weekly_attendance", "monthly", "customer_summary"], "monthly": { "minEnrolledDays": 11 }, "customerSummaryDue": { "nthWorkingDay": 8, "time": "16:00" } }
}
```

`progression.clearFromLevel` och `progression.anyFromLevel` (beslut 2026-10-01): tydlig progression = minst ett område på nivå `clearFromLevel` eller högre, någon progression = minst ett område på nivå `anyFromLevel` eller högre (heltal 0–3, `anyFromLevel` ≤ `clearFromLevel`, Botkyrka 2 och 1). Texterna i appen och rapporterna byggs av talen. Den äldre fritexten `statDefinition` läses inte längre (fältet får finnas kvar).

### 6.3 Fler kommunavtal

Ett nytt kommunavtal läggs till som en rad i `contracts` med en egen konfiguration enligt samma schema som Botkyrkas ovan (zod-validerat i `src/core/config.ts`), egna avtalsområden (`contract_areas`) och en egen prislista per avtalsområde (`price_items`) – utan kodändring i kärnflödena. Ett avtal i utkast behöver bara `casePrefix` och `dataRole`; ärenden kan hanteras först när alla driftavsnitt finns (`OperationalConfigSchema`). I kommunavtalen är kommunen personuppgiftsansvarig och MB personuppgiftsbiträde (`dataRole: "processor"`), och priserna gäller per deltagare och vecka (`participant_week`). Behörigheten följer avtalet (medlemskap per avtal, SPEC §4), och adminvyn visar en avtalsväljare först när det finns fler än ett avtal.

Kammarkollegiet ingår inte – de får en egen plattform (beslut 2026-10-06, §14). Paket-, månads- och styckpriser, mötesminimum, statistikexport i deras format och MB som personuppgiftsansvarig finns därför inte i konfigurationen.

---

## 7. Funktioner och flöden

### 7.0 Startsidor per roll

**Beslut 2026-10-06: alla MB-roller börjar på Min vecka (`/min-vecka`) – samma upplägg, egna uppgifter.** Coachens Min vecka är förebilden: sidrubriken MIN VECKA, "Namn · Titel", ingressen med veckodag och vecka, en primär knapp, fyra rutor och två kolumner – det som ska göras i brådskeordning till vänster, påminnelser, flaggor, notiser och "i korthet" till höger. Varje roll ser bara det den redan har behörighet till; behörigheterna ändras inte. De gamla startsidorna finns kvar som sidor under rollens flik i menyn, och gamla adresser fungerar (`/start` leder till `/min-vecka`).

- **Kommunens handläggare:** tre stora knappar – "Beställ ny insats", "Mina deltagare", "Rapporter och meddelanden". Olästa rapporter och meddelanden överst. Ingen annan navigation på startsidan. Saknas namn, telefon eller enhet (självregistrerat konto) visas Mina uppgifter först.
- **Kommunens chef:** borttagen (beslut 2026-10-07).
- **Coach (Min vecka – förebilden):** dagens och veckans möten, närvaro att registrera (med nedräkning till måndag 10:00), AI-utkast att granska, månadsbedömningar, meddelanden från kommunen, påminnelser, egna flaggor, rapporter som förfaller och veckokalendern.
- **Samordnare och avtalsansvarig (Min vecka):** rutorna Att hantera i inkorgen (SLA-klocka), Första möten ej bokade, Förfaller i dag och Flaggor att kvittera; avropsinkorgen, flaggor, första möten som inte är bokade, ärenden utan coach och öppna uppgifter; i högerkolumnen förfaller snart, avtalsavvikelser, nyckeltalen för svar och första möte, tilldelningsnotisen och olästa notiser. Avtalsansvarig dessutom beställarrapport att godkänna och lämna till kommunen och skriftliga varningar (Skyddade avrop visas inte sedan 2026-10-07).
- **Handledare (Min vecka):** närvaro att registrera (förra veckan), dagens yrkesmoment och praktikdagar, kommande sju dagar, praktikplatser som saknar något av de fyra rätten och antalet tilldelade ärenden. Listan Mina tilldelade ärenden (`/handledare`) finns i menyn.
- **Chef/controller (Min vecka):** flaggor att kvittera, tidig uppmärksamhet, det som förfaller, rapporter att granska och nyckeltalen i korthet (resultatgrad, sedan avtalsstart, prognos, försenat, ofakturerat som antal veckor och ärenden – inga kronor sedan 2026-10-07). Ledningsvyn (`/ledning`) med KPI:er mot mål, prognos, trend, per coach och per avtalsområde ligger under fliken Ledning.
- **Ekonom (Min vecka):** fakturakörningen för månaden, uppgifter, fakturor som saknar beställarreferens, preskriptionsrisk, returnerade fakturor och veckor utan närvaro att kontrollera – med belopp (den enda rollen som ser belopp, beslut 2026-10-07). Fakturering (`/ekonomi`) med körningar per månad, Fortnox-synk och prislistan (`/ekonomi/prislista`) ligger under fliken Ekonomi.
- **Systemadministratör (Min vecka):** bakgrundsjobben, utskick som inte gick iväg de senaste sju dagarna (äldre fel finns i utskicksloggen), användarna, när avrop@ senast lästes och – bara för testare i testmiljön – synpunkterna. Avtal och konfiguration ligger inte i menyn; länken finns på Användare och roller och Min vecka.

**Menyn (beslut 2026-10-06):** Notiser överst, sedan den gemensamma gruppen **Min vardag** (Min vecka, Närvaro, Ärenden – coachen "Mina ärenden", handledaren "Mina tilldelade ärenden" – Rapporter och Arbetsgivare och praktik; ett val visas bara när rollen har sidan) och högst **en rollflik**: samordnare **Samordning** (Avropsinkorg, Förfaller, Bygg rapport), avtalsansvarig **Avtalet** (Avropsinkorg, Förfaller, Avtalsavvikelser, Kommunanvändare, Bygg rapport), chef **Ledning** (Ledningsvy, Avtalsavvikelser, Förfaller, Bygg rapport, Revisionslogg), ekonom **Ekonomi** (Fakturering, Fakturakörning för förra månaden, Prislista – bara ekonomen, beslut 2026-10-07) och systemadministratör **Administratör** (Användare och roller, Underbiträden och integrationer, Mallar och utskick, Revisionslogg). Coach och handledare har ingen rollflik. En begränsad testare ser aldrig en stängd sida i menyn och börjar på Notiser om hen agerar i en roll som är dold för testare.

### 7.1 Beställning via mejl – kommunens formella kanal

Enligt AFK 7.9 sker beställningar via mejl, och kommunen har inget eget inköpsordersystem. Mejlflödet är därför huvudvägen och Miljonmatch är beställningssystemet. Det ska fungera fullt ut i fas 1.

- **Inläsning (byggd 2026-10-08, beslut 4c):** avrop@miljonbemanning.se läses via Microsoft Graph med en egen appregistrering som bara får nå just den brevlådan (applikationsbehörigheten `Mail.ReadWrite`, begränsad med en ApplicationAccessPolicy i Exchange Online – `docs/DRIFT.md` avsnitt 12). Jobbet `inbox_import` (`src/server/jobs/inbox.ts`, `src/server/inbox/*`) körs **varannan minut** av jobbkörningen, hämtar olästa mejl i Inkorgen (text och filbilagor), sparar dem idempotent i `inbound_emails` (Message-ID) och flyttar dem till mappen "Inläst", där de ligger kvar som reserv. Saknas inställningarna gör jobbet ingenting och `/admin/integrationer` visar "Inte kopplad – så här kopplar du". Körs i plattformen (arn1) – inte på Mac mini/Miljonbot, eftersom flödet är kontraktskritiskt. Klientuppgifterna bara i Vercel; inga adresser eller ämnesrader i felorsaker eller loggar.
- **Tolkning** (`src/features/inkorg/parse.ts`, samma fält som avropsinkorgen visar): Word-mallen (01) och mejl med mallens etiketter ("Förnamn: …", tabellceller) tolkas deterministiskt utan AI (`parse_method template`, konfidens per fält). Finns deltagarens namn och personnummer skapas personen, ärendet och ordererkännandet automatiskt – saknade uppgifter (startdatum, omfattning, deltagarens uppgifter) listas i ordererkännandet. Fritextmejl som ser ut som ett avrop sparas utan tolkning (`manual`): en människa registrerar dem i inkorgen (nedan); AI-tolkning av fritext hör till fas 2 och är av i produktion. Har personen redan en pågående insats skapas inget ärende – samordnaren avgör.
- **Registrera beställning (beslut 4a, 2026-10-08):** samordnaren och avtalsansvarig registrerar i avropsinkorgen ett avrop som kom med mejl som inte kunde tolkas, per telefon eller på annat sätt (`/inkorg/registrera`, `inkorg.register`): samma fält som kommunens formulär plus hur och när det kom och kommunens handläggare (namn, e-post på kommunens domän, enhet, telefon). Ingen profil skapas av Miljonbemanning – finns ett konto med adressen kopplas ärendet direkt, annars sparas uppgifterna på ärendet och ärendet kopplas när handläggaren själv skapar konto med samma adress. Raden i `inbound_emails` får `parse_method manual`, `registered_by` och `registered_at`; sedan vanligt flöde (ordererkännande till handläggarens adress, svarstiden från mottagandet, Acceptera/Avböj, orderbekräftelse). Bilagor kan bifogas; mejlets egna bilagor följer med. Revisionslogg `email.registered` (id:n och kanal). Personnummer krypteras som förut och finns aldrig i adresser, loggar eller svar – personnumret i ett inläst mejl lämnas inte ut till formuläret utan används när fältet lämnas tomt.
- **Ordererkännande inom 5 minuter (automatiskt):**
  > Tack! Vi har tagit emot er beställning och gett den ärendenummer BOT-26-0042. Ni får besked om startdatum och ansvarig coach senast [datum och tid]. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.

  Saknas obligatoriska uppgifter – önskat startdatum, omfattningen (6 eller 12 månader eller annan tidsperiod med motivering) och deltagarens uppgifter – listas de i samma svar: "Svara på det här mejlet med …". Beställarreferens och avtalsområde efterfrågas inte längre (beslut 2026-10-07 – Miljonbemanning fyller i referensen och väljer avtalsområde och yrkesspår när beställningen bekräftas). Svaret innehåller aldrig personuppgifter.
- **Avropsinkorg:** originalet bredvid det tolkade formuläret, saknade fält markerade. Samordnaren rättar och väljer Acceptera eller Avböj (§7.4). Mål: under 2 minuter per avrop, eftersom volymen är 2–3 avrop per arbetsdag.
- **Kompletteringar:** svar på ordererkännandet kopplas automatiskt till rätt ärende via ärendenumret i ämnesraden.
- **Skyddade personuppgifter:** borttaget ur appen (beslut 2026-10-07) – alla beställningar hanteras lika. Den generiska mottagningsbekräftelsen skickas inte längre. Spärren i databasen ligger kvar vilande (§10).
- **Bilagor i mejlet** (t.ex. en kartläggning): filbilagor av tillåten typ (PDF, Word, bild, högst 10 MB) sparas av inläsningen som ärendets bilagor (`case_attachments`, uppladdade av systemet) och kopplas till ärendet när det skapas – automatiskt eller vid registreringen. Word-bilagor läses också för tolkningen.
- **Övrigt:** mejl som inte är beställningar klassas "Övrigt" och lämnas till människa, kopplade till ärendet om ett ärendenummer nämns.
- SLA-klockan startar vid mejlets mottagningstid.

### 7.2 Beställning via portalen (för den som vill)

Tre steg och en granskning (beslut 2026-10-07): **1) beställning och kontakt** (förifyllt med handläggarens namn, enhet som fritext, telefon och e-post; önskat startdatum och omfattningen – **6 månader**, **12 månader** eller **annan tidsperiod** med slutdatum och obligatorisk motivering; alternativen läses ur `contracts.config.orderPeriods`, och vid 6 eller 12 månader räknas planerat slut fram från önskat startdatum. När beställningen accepteras räknas slutdatumet om från första mötet och står i orderbekräftelsen – portalen säger det vid fältet; vilken dag som ska gälla är en öppen fråga, §13 fråga 32) · **2) deltagare** (namn, personnummer/samordningsnummer, telefon, e-post, bostadsort – fullständig adress bara om kallelse ska ske per brev – och föredragen kontaktväg; mallens text om dataminimering visas vid fälten) · **3) bakgrundsinformation om deltagaren** (har en kartläggning genomförts – ja, nej eller vet inte –, bifogade filer och fritext med hjälptexten "Var så detaljerad som möjligt – det är en bra utgångspunkt för oss." och "Tala in"). Granskningen visar allt innan beställningen skickas – inga belopp.

- **Borttaget 2026-10-07:** beställarreferens (Miljonbemanning fyller i den), planerat slutdatum (räknas fram), frågan om skyddade personuppgifter, anpassningsbehov, det gamla bakgrundsfältet, avtalsområde och önskat yrkesspår (Miljonbemanning väljer dem när beställningen bekräftas) och beställningens värde. Portalen nämner inte mejlavrop.
- **Bilagor:** PDF, Word (.docx, .doc) och bild (JPEG, PNG, HEIC), högst 10 MB per fil, flera filer. Filen laddas upp direkt till lagringen med en signerad adress; servern kontrollerar storleken och filens första byte innan den tas emot. En uppladdning som aldrig kopplas till en beställning raderas efter 24 timmar. Bilagor i avslutade och avböjda beställningar gallras enligt avtalets regel (`retentionRules.attachmentsAfterCloseDays`, räknat från avslutet respektive avböjandet). Gallringen stämmer också av lagringen mot bilagorna varje timme och raderar filer utan levande bilaga – den signerade uppladdningsadressen gäller i två timmar och kan inte återkallas. Filnamnet visas bara i appen – aldrig i adresser eller loggar.
- **Dubblettkontroll** på personnummer-hash inom avtalet. En person kan ha flera ärenden över tid, men inte två aktiva samtidigt.
- Ordererkännandet visas direkt på skärmen och skickas som mejl utan personuppgifter.

### 7.3 Ärendenummer = ordernummer och faktureringsobjekt

- Format `{prefix}-{ÅÅ}-{NNNN}`, t.ex. `BOT-26-0001`. Prefix per avtal, löpnummer per avtal och år.
- Genereras i samma databastransaktion som ärendet (radlås på `case_counters`). Återanvänds aldrig, innehåller inga personuppgifter.
- Ärendenumret är MB:s ordernummer och fakturans faktureringsobjekt. Det visas på alla rapporter och fakturor, och kommunen uppmuntras använda det i stället för personnummer.
- Word-mallen uppdateras: ärendenummerfältet får texten "Lämnas tomt – tilldelas av Miljonbemanning", omfattningen blir 6 månader, 12 månader eller annan tidsperiod med motivering, och frågan om kartläggning och bakgrundsinformationen läggs till (bilagor i mejlet följer med). Beställarreferensen tas bort ur mallen (beslut 2026-10-07 – tidigare: eget obligatoriskt fält).

### 7.4 Orderbekräftelse, första möte och kartläggning

- **Acceptera** (huvudcoach, team, startdatum; avtalsområde och yrkesspår väljs här sedan 2026-10-07, beställarreferensen är valfri och kan fyllas i senare) eller **Avböj** (orsak obligatorisk och loggad – obesvarade och frekvent avböjda avrop kan flytta ner MB i rangordningen). Senast en arbetsdag efter mottagandet.
- **Orderbekräftelse** i portalen och som notis: startdatum, huvudcoach, första mötet och planerad omfattning (t.ex. "6 månader (till och med 7 augusti 2027)"). **Inget pris och inget ordervärde** (beslut 2026-10-07) – inte heller i PDF:en eller i frysta orderbekräftelser från före beslutet (priset tas bort i vyn). Beställarreferensen står som "Fylls i av Miljonbemanning före faktureringen" tills den finns.
- **Första mötet ska vara bokat inom en vecka** (AFK 7.9). Ärenden utan bokat möte efter tre dagar flaggas. Kallelse via föredragen kontaktväg och SMS-påminnelse dagen före.
- **Kartläggning (vecka 1)** – strukturerat formulär: arbetslivserfarenhet, utbildning, språk, digital vana, körkort, yrkesmål och valt yrkesspår, behov av anpassning (funktionellt beskrivet), första veckomål. Dokumenterar den reella kompetensen som underlag för validering, matchning och CV.
- **Kontinuitet:** samma coach genom hela insatsen. Byte av huvudcoach kräver orsak, loggas i `case_status_history` och handläggaren får en notis.
- **Faser 1–5** registreras i avstämningarna. Flagga "fastnat" enligt `stuckRules` (anpassat för insatser på 4–10 veckor).

### 7.5 Veckoavstämning

Kärnan i coachens vardag. Mål: under 5 minuters dokumentation. Allt utom en kort anteckning är rullgardiner eller knappar.

| Fält | Typ |
|---|---|
| Datum, längd, sätt | Förifyllt från kalendern (fysiskt / telefon / video) |
| Närvaro senaste veckan | Hämtas från närvaroregistreringen, kan kommenteras |
| Veckomål uppnått | Ja / Delvis / Nej |
| Nytt veckomål | Kort text, med förslag per fas |
| Fas | 1–5 |
| Genomförda aktiviteter | Flerval – mall 02:s nio aktivitetstyper |
| Arbetsgivarkontakter | 0 / 1 / 2+ och typ (ansökan, intervju, praktikkontakt, studiebesök) |
| Samlad status | Grön – enligt plan / Gul – risk eller extra åtgärd / Röd – kräver omplanering eller dialog |
| Hinder | Flerval, funktionella kategorier: språk, digital vana, praktiska förutsättningar (t.ex. barnomsorg, resor), behov av anpassning, motivation, annat |
| Anteckning | Kort fri text |

- **Röd status skapar automatiskt en avvikelse** som kräver åtgärd, ansvarig och uppföljningsdatum ("avvikelse = åtgärd"). Knappen "Kalla kommunen till uppföljning" skickar en mötesförfrågan till handläggaren (AFK 7.8).
- **Indatasätt:** manuellt, eller med AI-förslag från inspelning, uppladdad ljudfil, Teams-transkript eller inklistrade anteckningar (fas 2, §8). AI fyller samma formulär – det finns ingen separat AI-väg.
- **Utkastet sparas automatiskt** (beslut 2026-10-02, gäller också månadsbedömningen §7.7 och kartläggningen §7.4): 2 s efter senaste ändringen och när sidan lämnas, med samma utkaststatus som "Spara utkast". Diskret statusrad "Utkast sparat 09.41" (ingen toast). Går det inte att spara (röd status utan avvikelse, AI utan samtycke, ett sparat utkast som inte är öppnat) visas varför, och frågan "Du har inte sparat" visas bara då. Revisionsloggen får en post per sida och besök (första autosparningen), inte en per tangenttryck. Tillägg 2026-10-03 (granskning): aldrig ett andra utkast för samma ärende (ett oöppnat sparat utkast stoppar autosparningen; "Börja om" och "Spara utkast" fortsätter på samma utkast); röd status skapar en avvikelse per avstämning som uppdateras vid varje sparning, och uppgiften till kommunen skickas bara när coachen själv sparar eller godkänner; en godkänd avstämning eller bedömning ändras aldrig – inte heller av en autosparning från en annan flik; samma utkast i två flikar: den som sparar med en inaktuell version får "ändrats i en annan flik – ladda om", inget skrivs över (radversion, migration 0022).

### 7.6 Närvaro och veckorapport

- Närvaro registreras per tillfälle: närvarande / sen / frånvaro giltig (orsak: sjukdom, vård av barn, myndighetsbesök, annat giltigt skäl) / frånvaro ogiltig. Inga detaljer utöver orsakskategorin.
- **Snabbregistrering:** dagens lista per coach eller lokal, ett klick per deltagare.
- **Markera alla som närvarande (per dag):** en knapp per dag markerar alla passerade tillfällen som ännu saknar registrering som närvarande, efter en bekräftelse som räknar upp namnen. Redan registrerad närvaro eller frånvaro ändras aldrig; enskilda rättas efteråt med radens knappar. Ett kommando (`coach.attendanceSetAll`, samma regler som enskild registrering: roll, tilldelning, skyddade ärenden bara för namngiven coach), en loggrad per avtal med antal och id:n, och samma följder som enskild registrering – veckorapporten publiceras när veckan är komplett (beslut 2026-10-02). Högst en närvarorad per tillfälle (unik nyckel, migration 0022): två samtidiga registreringar av samma tillfälle blir en rad, och veckorapporten publiceras bara en gång (granskning 2026-10-03).
- **Veckorapport (AFK-krav: närvarorapport på deltagarnivå varje vecka):** genereras automatiskt för föregående vecka – en rapport per handläggare med en sektion per deltagare: planerade tillfällen, närvaro, frånvaro med orsak, åtgärd vid ogiltig frånvaro och risk. Coachen ska ha registrerat närvaron senast måndag 10:00 (påminnelse fredag eftermiddag och måndag morgon; saknad registrering eskaleras till samordnaren 10:00). Rapporten publiceras när handläggarens alla deltagare är registrerade, senast måndag 16:00. Tiderna ligger i avtalskonfigurationen.
- **Frånvaronotis samma dag** vid ogiltig frånvaro: tillval per avtal (§13).
- **Upprepad frånvaro** (standard: minst två ogiltiga inom 14 dagar) → flagga och förslag på åtgärdsplan.
- Närvarograd = närvarotillfällen / planerade tillfällen, per vecka och månad. Giltig frånvaro redovisas separat.

### 7.7 Månadsbedömning (progression)

Följer mall 02 avsnitt 4. Obs: rubriken "4." saknas i dagens Word-fil – ta med den i PDF:en.

**Skala** (förändring jämfört med föregående månad): 0 = ingen / för tidigt att bedöma · 1 = liten · 2 = tydlig · 3 = uppnått delmål.

**Progressionsområden:** närvaro, punktlighet och rutiner · yrkesfärdigheter/praktisk förmåga · arbetskapacitet och uthållighet · självständighet och ansvarstagande · digital självständighet · förmåga att förstå och följa yrkesrelaterade instruktioner · arbetsgivarkontakter/nätverk · beredskap för praktik, arbete eller studier · **språk och kommunikation** (tillagt eftersom AFK 7.8 nämner språk) · övrig relevant progression.

Tillval om Botkyrka vill (§13): hälsa (bara funktionellt beskrivet) och livskvalitet (deltagarens egen skattning). Båda är känsliga och läggs inte till utan kommunens besked.

Per område: nivå (rullgardin), **konkret observation (obligatorisk från nivå 1 – mallen kräver alltid bevis eller exempel)**, nästa steg.

AI (fas 2) skriver utkast till den konkreta observationen per område utifrån månadens godkända avstämningar, med hänvisning till källorna. AI får visa ett nivåförslag bredvid rullgardinen, men rullgardinen är tom tills coachen själv väljer.

Statistik: "tydlig progression" = minst ett område på nivå 2 eller högre; "någon progression" = minst ett område på nivå 1 eller högre (konfigurerbart: `progression.clearFromLevel` och `anyFromLevel`, §6.2). Bara de obligatoriska områdena räknas – de valfria (hälsa, livskvalitet) räknas aldrig i statistiken (beslut 2026-10-01).

### 7.8 Händelser, utfall och avslut

- **Händelsetyper** (mall 02 avsnitt 5): praktik/arbetsplatsförlagt moment startat · anställningsintervju eller konkret arbetsgivarkontakt · arbetserbjudande · arbete påbörjat · studier påbörjade/antagen · validering/certifiering uppnådd · annat konkret resultat. Lägg till för validering: reell kompetens dokumenterad · vägledning till formell validering · yrkeskompetensbevis/diplom utfärdat. Fält: datum, aktör (arbetsgivare/skola), verifiering (typ + ev. fil), kommentar.
- **Avslut:** datum + avslutsorsak – arbete · studier · avbrott: flytt · avbrott: kommunens beslut · avbrott: deltagarens val · avbrott: övriga skäl · planerat avslut utan resultat.
- **Resultatklassning** (resultat / ej resultat / exkluderas ur nämnaren) styrs av avtalets resultatdefinition. Arbete och studier räknas som resultat först när verifiering registrerats; innan dess visas de som "preliminärt". Arbete som börjar i anslutning till insatsen markeras som möjligt bonusunderlag (§7.17).
- Avslut skapar automatiskt ett utkast till slutrapport och en exit-pulsmätning.

### 7.9 Praktik och arbetsgivare

- Arbetsgivarregister (företag, kontaktperson, avtalsområden) som alla coacher delar.
- Praktikplats med de fyra rätten: **arbetsuppgifter** kopplade till yrkesspåret · **handledning** (handledare hos arbetsgivaren, mål, ansvar) · **timing** (coachens redo-bedömning: krav, tempo, rutiner) · **uppföljning** (planerade datum, återkoppling dokumenteras och leder till nästa steg).
- Arbetsgivarkontakter räknas i statistiken och i veckoavstämningen.

### 7.10 Pulsmätning

- **Tillfällen:** vecka 2 och vid avslut (exit), plus var 30:e dag för insatser som är längre än åtta veckor. Med insatser på 4–10 veckor fångar en månadsrytm annars för få deltagare.
- **Kanal:** SMS eller e-post enligt föredragen kontaktväg, plus QR-kod på kontoret. Ingen inloggning: signerad engångslänk som gäller 7 dagar. Aldrig till skyddade ärenden.
- **Frågor** (lättläst svenska med smileys 1–5, språkval: svenska, engelska, arabiska, somaliska – översättningar granskas av människa):
  1. Hur trivs du hos oss?
  2. Känner du att du kommer närmare jobb eller studier?
  3. Får du det stöd du behöver av din coach?
  4. Vad är viktigast för dig just nu? (Hitta jobb / Praktik / Utbildning / Bli säkrare på svenska / Annat)
  5. Vill du att någon kontaktar dig? (Ja / Nej) + valfri fri text.
- **Synlighet:** coachen ser inte enskilda svar. Svarar deltagaren "Ja" på fråga 5 skapas en uppgift till samordnaren, som avgör vem som tar kontakten. Lågt betyg (1–2) på fråga 3 går till chef, inte till coachen. Aggregat visas först vid minst 5 svar.
- **Nöjdhet** = andel 4–5 på fråga 1.
- Deltagandet är frivilligt och påverkar ingenting i insatsen – det står i utskicket.

### 7.11 Rapporter och intyg

**Gemensamma regler:** byggs bara av godkända uppgifter. Livscykel: utkast → granskad av coach → (valfri kvalitetsgranskning av samordnare) → godkänd → levererad (tid, mottagare, kanal) → kvitterad (när mottagaren öppnat). Rättelse skapar ny version, den gamla sparas. När en rättelse levereras ersätts alla tidigare versioner i kedjan (också en levererad version 1 när en ej levererad rättelse har rättats igen). PDF i MB:s grafiska profil. Leverans i portalen; mottagaren får en notis utan personuppgifter. Rapporter skickas bara som bilaga i vanlig e-post om kommunen skriftligt instruerat det (`reportDelivery`).

**PDF** (beslut 2026-10-01): varje rapport med ett dokument (orderbekräftelse, vecko-, månads-, slut- och beställarrapport) kan laddas ned som PDF i MB:s grafiska profil (react-pdf, Montserrat inbäddat). PDF:en byggs av samma vy-modell som rapporten på skärmen – för en levererad rapport av den frysta ögonblicksbilden (`reports.snapshot`), så att en levererad rapport alltid ger samma innehåll. Den byggs när någon laddar ned den och sparas inte (`reports.pdf_path` används inte). Servern kontrollerar behörigheten med samma regler som för att visa rapporten och loggar nedladdningen (`report.downloaded`: id, typ, version, period – inga namn). Filnamnet innehåller bara rapporttyp, ärendenummer eller avtalsnummer, period och version. Rapporter som inte är levererade får vattenstämpeln "Utkast – inte levererad".

**Rapportutkast skapas automatiskt** (beslut 2026-10-01, `contracts.config.reportSchedule`): veckorapport per handläggare och ISO-vecka med minst ett inskrivet ärende (när veckan är slut, väntar på närvaron och publiceras som i dag), månadsrapport per ärende och månad där ärendet varit inskrivet minst `reportSchedule.monthly.minEnrolledDays` kalenderdagar – Botkyrka 11, start- och slutdatum räknas med (när månaden är slut, utkast; se §13 fråga 19) – och beställarrapport per avtal och månad (när månaden är slut, utkast – en rapport för hela avtalet utan mottagare i portalen sedan 2026-10-07; avtalsansvarig godkänner den och lämnar den till kommunen utanför Miljonmatch och registrerar det). Mottagarna av vecko-, månads- och slutrapporter är handläggare med aktivt konto. Sista dagarna kommer från konfigurationen (`sla` och `reportSchedule.customerSummaryDue`); zod-schemat stoppar en konfiguration där en rapporttyp skapas automatiskt men sista dagen saknas. Ett bakgrundsjobb högst var tionde minut prövar perioderna från avtalets högvattenmärke (`app_settings`: tiden för den senaste körningen där hela avtalet gicks igenom) och alltid minst de senaste 62 dagarna; utan märke prövas allt från avtalets start, så inget hoppas över efter ett driftstopp. I testmiljön skapas inget för perioder som slutade före testklockans start (testdatat har de raderna). Varje skapad rad loggas (`report.created`). Unika index i databasen hindrar dubbletter. Ett inskrivet ärende utan handläggare med aktivt konto kommer inte med i någon veckorapport – samordnaren och avtalsansvarig får en flagga om det.

**Resultatfil till kommunen** (beslut 2026-10-01, rapporter steg 3; ändrat 2026-10-07): avtalsansvarig tar fram filen i rapportbyggaren ("Resultatfil för hela avtalet") och Miljonbemanning lämnar den till kommunen utanför Miljonmatch – kommunen hämtar den inte längre själv, och "Hämta resultat" i portalen är borttaget. Filen innehåller hela avtalet. Excel (flikarna Resultat, Progression, Händelser, Avslut och Om filen) eller CSV (en fil per tabell plus fältbeskrivningen), högst 12 månader per fil. En rad per deltagare och levererad månadsrapport; deltagaren anges med ärendenummer och namn, aldrig personnummer. (Ärenden med skyddade personuppgifter kom tidigare aldrig med – skyddet är vilande sedan 2026-10-07.) Ingen fritext (observationer, sammanfattning, avvikelsetexter, händelsernas anteckningar och aktör, planen), inga frånvaroorsaker och inte de valfria områdena hälsa och livskvalitet. Filen byggs bara av levererade, inte ersatta rapporter och deras frysta fakta – aldrig av levande data i ärendet – och bara den senaste levererade versionen per ärende och månad. Avslutet (avslutsorsak, resultatklass, verifiering) kommer från den levererade slutrapporten: i tabellen Avslut (en rad per slutrapport för insatser som avslutades i perioden, också när slutmånaden saknar månadsrapport – resultatgraden räknas där) och på raden för slutmånaden när den har en månadsrapport. Varje hämtning loggas på servern innan filen lämnas ut (`export.results_mb`: id:n, period, antal, kolumnnamn – aldrig namn eller ärendenummer); misslyckas loggningen lämnas ingen fil ut. Kolumnspärren läser både kommunens tidigare hämtningar (`export.results`) och Miljonbemannings (`export.results_mb`). Filnamnet har bara avtalets prefix, "hela-avtalet" och perioden (`resultat_bot_hela-avtalet_2026-10_2026-12.xlsx`). Fältbeskrivningen för kommunen: `docs/RESULTATFIL.md`. Om filen räknas som "statistik på begäran" (h) är inte beslutat (§13).

**a) Ordererkännande och orderbekräftelse** – §7.1 och §7.4.

**b) Veckorapport närvaro** – §7.6. En per handläggare och vecka, med en sektion per deltagare.

**c) Månadsrapport individ – mappning mot mall 02**

| Avsnitt | Källa |
|---|---|
| 1 Grunduppgifter | Ärendet. Deltagaren anges med namn och ärendenummer; personnummer skrivs inte ut (mallen tillåter "personnummer / ärendenummer") |
| 2 Närvaro | Bara perioden och närvarograden, med regeln i en rad (beslut 2026-10-07, synpunkt #12). Veckorna, frånvaroorsakerna och upprepad frånvaro finns internt (deltagarkortets flik Närvaro, `/narvaro`, veckorapporten och resultatfilens fakta). Modellen och de frysta ögonblicksbilderna är oförändrade – bara visningen ändras, också för redan levererade rapporter |
| 3 Genomförda aktiviteter | Kryss om minst en registrerad aktivitet av typen + dokumentationstext (AI-utkast i fas 2) |
| 4 Progression | Månadsbedömningen |
| 5 Resultat/utfall | Händelser under månaden |
| 6 Avvikelse, risk och åtgärd | Avvikelser. "Behöver beslut/stöd från kommunen?" skapar en notis och en uppgift hos handläggaren |
| 7 Plan för nästa månad | Månadsplanen (AI-utkast från senaste avstämningen i fas 2) |
| 8 Coachens sammanfattande bedömning | Samlad status (coachens val), kort sammanfattning (AI-utkast, coachen godkänner), ansvarig coach och datum, rapporteringsprincipen som fast text |

Påminnelser: coach 3 arbetsdagar före förfall, samordnare 1 dag före, chef vid förfall (vitesrisk).

Fliken Månadsunderlag visar samma innehåll som rapporten, byggt med samma funktion (§7.18).

Fakta för kommunens resultatfil (bara koder, tal, sanningsvärden och datum) fryses med rapporten när den levereras, i samma pass och av samma underlag som rapporten (`reports.snapshot.facts`). Rapporter som frystes tidigare får fakta första gången filen hämtas; ärendefälten (avtalsområde, yrkesspår, datum, fas, uppehåll) och siffrorna (närvaro, avstämningar, veckomål, bedömningen och nivåerna, samlad status, händelser, avvikelser) tas då ur den frysta rapporten, och det som inte går att föra tillbaka loggas (`report.facts_drift`, bara fältnamn). Misslyckas frysningen vid leveransen är rapporten ändå levererad och loggad; den fryses när den öppnas första gången eller när filen hämtas. En verifiering av resultatet som registreras efter att slutrapporten levererats kommer med i filen först när en rättad slutrapport har levererats (beslut 2026-10-01, sätt a) – `result.verify` säger till när slutrapporten redan är levererad.

**d) Slutrapport** – vid avslut. Samma struktur plus hela perioden: resultat, kvarstående hinder och rekommenderad fortsättning. Rapportstatus "Slutrapport". Slutrapportens närvaroavsnitt visar fortfarande hela närvaron (ändras inte av beslutet 2026-10-07 – §13).

**e) Beställarrapport till kommunen (månadsvis)** – en per avtal och månad, godkänns av avtalsansvarig och lämnas till kommunen av Miljonbemanning utanför Miljonmatch (beslut 2026-10-07; status "Lämnad till kommunen", inget mejl) – antal deltagare (aktiva, nya, avslutade) per avtalsområde och yrkesspår · resultat (antal och andel arbete/studier, rullande och sedan start, mot 32 %) · progression (andel med tydlig progression, fördelning per område) · närvarograd · antal avvikelser · nöjdhet (antal svar, andel 4–5) · kort sammanfattning (AI-utkast, godkänns av avtalsansvarig). **Det interna målet 35 % visas aldrig här.** SLA-statistik visas bara om ledningen beslutat det (`seesSlaStats`). Grupper med färre än 5 personer redovisas som "färre än 5". Andelen med tydlig/någon progression och fördelningen per område räknas bara på de obligatoriska områdena; de valfria (hälsa, livskvalitet) räknas aldrig i statistik till kommunen (beslut 2026-10-01). Texten till kommunen säger vilka områden som inte räknas, med namnen ur konfigurationen ("Hälsa (funktionellt beskrivet) och livskvalitet (deltagarens egen skattning) är valfria områden och räknas inte.").

**f) Intern ledningsvy** – allt i e) plus 35 %-målet, per coach och per bolag, prognos, SLA-uppfyllnad, ofakturerat (antal veckor och ärenden, inga kronor – beslut 2026-10-07), avtalsavvikelser och flaggor.

**g) Yrkeskompetensbevis/diplom** – PDF i MB:s profil med genomförda yrkesmoment och bedömda färdigheter, undertecknad av handledaren. Utfärdas vid avslut när momenten är godkända (fas 3).

**h) Statistik på begäran** – export för valfri period (högst två begäranden per år enligt avtalet, även ett år efter avtalsslut).

**i) Dataexport vid avtalsslut** – allt som tillhör kommunen exporteras inom en kalendermånad, därefter raderas det (med logg).

**j) Exportmallar per avtal** – t.ex. en kommuns egen statistikfil. Byggs som konfigurerbara exporter, inte specialkod. Version 1 (kommunens resultatfil, rapporter steg 3) har ett kolumnregister med schemaversion (`EXPORT_SCHEMA_VERSION`), texter som byggs av avtalets konfiguration (prefix, faser, progressionsområden och gränser, regeln för upprepad frånvaro, avslutsorsaker) och en kolumnspärr: kolumner läggs bara till sist, och ändras ordningen (t.ex. progressionsområdena i avtalet) stoppas filen tills schemaversionen höjts. Rapportbyggarens mallar ligger i koden (v1). Exportmallar per avtal kommer senare och kan peka på en sparad definition.

**k) Rapportbyggaren** (beslut 2026-10-02, rapporter steg 4) – Miljonbemanning bygger egna rapporter av samma underlag som kommunens resultatfil. Kommunen bygger inte själv.

- **Vem:** samordnare, avtalsansvarig och chef i avtalet (menyn "Bygg rapport", `/rapportbyggare`). Inte admin, coach, handledare eller ekonom. Kommunen ser inga sparade rapporter (beslut 2026-10-07).
- **Underlag:** bara levererade, inte ersatta månads- och slutrapporter och deras frysta fakta (`reports.snapshot.facts`) – aldrig levande data i ärendet och aldrig råtranskript. Samma kolumnregister som resultatfilen (`EXPORT_SCHEMA_VERSION` oförändrad). Alla ärenden i avtalet ingår (skyddade personuppgifter är borttagna ur appen 2026-10-07; tidigare ingick de aldrig).
- **Datamängder i v1:** Deltagarmånader (en rad per levererad månadsrapport), Avslut (en rad per levererad slutrapport för insatser som avslutades i perioden; avtalsområde, yrkesspår och enhet från ärendets senaste levererade månadsrapport – finns ingen heter gruppen "Uppgift saknas"), Händelser och Progression (bara godkända bedömningar på obligatoriska områden).
- **Mått i v1:** deltagarmånader, närvarograd (viktad), tydlig och någon progression, godkända avstämningar, arbetsgivarkontakter (minst), månader med upprepad frånvaro, nya avvikelser, praktik startad; avslut, avslut som räknas, med verifierat resultat, preliminära resultat, resultatgrad (samma räkning som KPI:n – en slutrapport utan resultatklass räknas som avslut utan resultat, med en not); händelser och verifierade händelser; fördelning per nivå (nivåerna 0–3 bara som fördelning, aldrig medelvärde). Tomma celler räknas inte i andelar och antalet står i en not. Andelar med en decimal. Notisen om litet underlag för resultatgraden läser gränsen ur `kpis` (Botkyrka 10).
- **Visas som** sammanställning (en gruppering, uppdelning per tid: ingen, månad, kvartal eller halvår, högst fyra mått, ett liggande stapeldiagram med ett mått – tabellen visas alltid) eller lista med en rad per deltagare (raderna bara i filen; på skärmen bara antal och kolumnnamn). Ärendenummer och namn kan aldrig vara urval eller gruppering. Perioden är de senaste N hela månaderna eller valda månader, högst 12.
- **Filer:** Excel (flikarna Rapport och Om rapporten), CSV och – för sammanställningar – PDF utan diagram. Filnamnet har bara avtalets prefix, mallen eller datamängden och perioden (`rapport_bot_narvaro-per-manad_2026-10_2026-12.xlsx`), aldrig rapportens namn. Högst 3,5 miljoner tecken per fil. Färdigrapporten **"Resultatfil för hela avtalet"**: samma kolumner och filer som resultatfilen, för hela avtalet (`export.results_mb`) – det är filen som Miljonbemanning lämnar till kommunen.
- **Sparade rapporter och delning** (`saved_reports`, §6.1): sex mallar i koden eller en egen definition. Namnet kontrolleras på servern (inga personnummer eller ärendenummer). Delning: bara ägaren eller alla på Miljonbemanning i avtalet (delning med kommunens chef är borttagen 2026-10-07; rapporter som var delade med kommunen blir delade inom Miljonbemanning, migration 0026). Bara ägaren ändrar innehållet (namn och definition); avtalsansvarig arkiverar andras delade rapporter, men gör dem aldrig privata. Rapporter arkiveras och raderas aldrig.
- **Kommunens regler:** borttagna 2026-10-07 – kommunen ser inga sparade rapporter. Det som lämnas till kommunen tas fram internt och lämnas av Miljonbemanning.
- **Loggning** (`audit_log`, bara id:n – aldrig namn eller rapportens titel): varje visning av en sparad rapport (`saved_report.viewed`, med vem den visas för), varje fil (`export.saved_report`, stoppad fil `saved_report.export_blocked`), varje ändring av delningen (`saved_report.shared`) och när en rapport skapas, ändras eller arkiveras. Förhandsvisningen av en rapport som inte är sparad loggas inte.

### 7.12 KPI:er och flaggor

- KPI-motorn läser `contracts.config.kpis`: nyckel, definition (täljare/nämnare), fönster (månad, rullande 3/6/12 månader, sedan start), avtalsmål, internt mål, minsta antal (minN) och vilka roller som ska aviseras.
- **Botkyrka – resultatgrad** = avslut med resultat / avslut som räknas enligt resultatdefinitionen, rullande 6 månader och sedan start.
  - Under 35 % → flagga "Bevaka" till chef och controller (i appen + veckosammanfattning via e-post).
  - Under 32 % → flagga "Åtgärd krävs" till chef, controller och avtalsansvarig direkt.
  - **Minsta antal:** flagga inte förrän minN (10 avslut) är uppnått i fönstret; visa antalet bredvid procenten. Med 40–60 avslut i månaden nås det snabbt, men en enskild vecka kan svänga kraftigt.
- Övriga Botkyrka-KPI:er: avrop besvarade i tid, första möte inom en vecka, veckorapporter i tid, månadsrapporter i tid, närvarograd, nöjdhet.
- **Prognos:** "om deltagarna med arbetserbjudande eller i fas 5 når resultat blir resultatgraden X %".
- Flaggor kvitteras med en kort åtgärdsplan.

### 7.13 Deadlines och SLA (skydd mot vite och rangordning)

- Regler per avtal i `contracts.config.sla`; varje regel skapar rader i `deadlines` med förfallotid.
- Arbetsdagar räknas med svenska helgdagar.
- Vy "Förfaller idag / denna vecka" för samordnare och chef; passerad deadline blir röd och eskaleras (coach → samordnare → chef).
- Allt loggas så att ni kan visa vad som levererades och när, om kommunen skulle hävda en avvikelse.

### 7.14 Meddelanden

- Säkra meddelanden per ärende mellan kommunens handläggare och MB. Ersätter mejl med personuppgifter i den löpande dialogen (bristfällig löpande information kan ge vite).
- Notis via e-post: "Du har ett nytt meddelande om ärende BOT-26-0042 – logga in för att läsa." Inget innehåll i mejlet.

### 7.15 Fakturering och Fortnox

**Debitering:**

- **Enhet:** deltagarvecka × veckopris för ärendets avtalsområde enligt prislistan som gällde veckan.
- **Debiterbar vecka** (Botkyrkas besked): alla veckor deltagaren är inskriven hos MB. Tolkning i systemet: varje ISO-vecka med minst en inskriven dag mellan startdatum och avslutsdatum räknas, även om start- eller slutveckan bara är delvis. Veckor då ärendet är pausat räknas inte.
- **Kontroll före fakturering:** veckor utan någon registrerad närvaro markeras och måste godkännas av ekonom eller samordnare. Kommunen räknar debitering som inte stämmer med utfört uppdrag som ekonomisk avvikelse.
- **Månadstillhörighet:** en vecka faktureras i den månad där veckans torsdag infaller (ISO-regeln). Varje vecka faktureras exakt en gång.

**Fakturans utformning (Botkyrkas villkor och beslutet 2026-10-07):**

- **En faktura per avtal och månad med en rad per ärende** (`billing.invoicePer: "contract_and_month"`). Botkyrkas villkor: samlingsfakturor accepteras inte om det inte särskilt avtalats – därför kräver konfigurationen `collectiveInvoiceAllowed: true` (zod-kontroll), och beslutet ska bekräftas skriftligt av Botkyrka (§13 fråga 5). En faktura per ärende och månad (`case_and_month`) finns kvar som konfiguration för avtal som kräver det. Fakturan identifieras med avtal, månad och grupp (`inv-<avtal>-<månad>-avtal`).
- **Beställarreferens per faktura:** kommunens referens på 8–10 siffror krävs, eftersom köpet sker utanför kommunens e-handelssystem. Ekonomen fyller i den på fakturan (kommunen anger den inte i beställningen sedan 2026-10-07). Förslag visas: förra månadens faktura, uppgifter från avtalsansvarig och referenserna från ärendenas beställningar. Utan giltig referens – mönstret ur konfigurationen och inte spärrad i referensregistret – kan fakturan varken skapas i Fortnox eller markeras som manuellt fakturerad (CLAUDE.md punkt 11). Den ska hamna i Peppol-fältet för köparens referens (BuyerReference).
- **Inköpsordernummer per faktura:** bara kommunens nummer – nio siffror som börjar med 99 – om kommunen någon gång beställer via Proceedo. Fältet nekar allt annat, också våra ärendenummer. Tomt = inget; fältet för köparens ordernummer (OrderReference) lämnas då tomt. Har ärendenas beställningar olika inköpsordernummer stoppas fakturan.
- **Faktureringsobjekt:** ärendenumret på varje rad (radtext "BOT-26-0042 · v. 40–43 2026"). Fakturans text anger avtalet, antalet ärenden och deltagarveckor.
- **Upparbetat och återstående** på varje rad (radens anmärkning, Peppol BT-127), t.ex. "Beställning BOT-26-0042: 10 veckor. Denna faktura: 4 veckor (v. 40–43 2026), 6 672 kr. Tidigare fakturerat: 2 veckor, 3 336 kr. Upparbetat inklusive denna faktura: 6 veckor, 10 008 kr. Återstår av beställningen: 4 veckor, 6 672 kr." Beställningen anges i veckor – inget ordervärde (beslut 2026-10-07). Om Botkyrka kräver kronor för upparbetat och återstående är en öppen fråga (§13).
- **Rader:** artikel per avtalsområde, antal veckor, à-pris och moms per rad; momsen summeras per sats. Inga namn eller personnummer.
- **Frysta rader och tilläggsfaktura:** när fakturan skapas i Fortnox eller markeras som manuellt fakturerad sparas raderna med veckorna (`invoice_lines`). En skapad faktura ändras aldrig: veckor som tillkommer i månaden efteråt (t.ex. sen närvaroregistrering) hamnar på en tilläggsfaktura för samma månad ("Tilläggsfaktura 2 · december 2026"). Raderna skrivs med fasta id:n och fakturans status ändras sist och villkorat, så att en skapelse som avbröts (nätverksfel, tidsgräns) kan köras om utan att fakturan fastnar och utan dubbletter. En fryst vecka som inte längre är debiterbar (uppehåll eller ändrade datum i efterhand) markeras på raden: "Inte längre debiterbar – behöver krediteras".
- **Kreditering:** en returnerad faktura (t.ex. spärrad referens) krediteras och görs om med rätt referens (`invoice_credits`, en kreditering per returnerad faktura och omgång). Raderna fryses på nytt från dagens underlag – bara de veckor som fortfarande är debiterbara, så att rättelser följer med (veckor som tillkommit står på månadens öppna faktura). Den nya fakturan får en ny idempotensnyckel (tillägget ":ny", sedan ":ny2" …). Återstår ingen debiterbar vecka krediteras fakturan utan ny faktura (status "Krediterad").
- **En faktura per ärende** (`case_and_month`): ärendets beställarreferens (som Miljonbemanning fyllde i när beställningen togs emot) gäller som fakturans referens tills ekonomen anger en annan – kontrollerad som alla referenser.
- **Periodiska fakturor hålls isär** från annan fakturering till kommunen (t.ex. bonus, §7.17).
- Bankgiro och övriga obligatoriska uppgifter hämtas från Fortnox.

**Flöde:**

1. Efter månadsskiftet räknar systemet fram månadens faktura med en rad per ärende. Ekonomen fyller i beställarreferensen, granskar raderna med anmärkningar (veckor utan närvaro, överlappande ärenden, fler än 5 veckor i månaden, ändring mot förra månaden, delvis vecka) och godkänner fakturan. Veckor utan närvaro godkänns först.
2. **Fortnox API** (fas 2): OAuth 2.0 authorization code flow, tokens krypterade. Fakturor skapas som ej bokförda utkast. Respektera Fortnox hastighetsgräns (25 anrop per 5 sekunder) och använd en idempotensnyckel per faktura (avtal, månad och grupp) så att en omkörning aldrig skapar dubbletter. Knapparna "Skapa i Fortnox" och "Hämta status från Fortnox" finns bara när Fortnox är kopplat (`ctx.fortnox`; minnesläget har en simulerad port) – tills dess visar körningen "Fortnox är inte kopplat ännu", inget markeras som skapat i Fortnox och fakturan skapas i Fortnox för hand och markeras som manuellt fakturerad (beslut 2026-10-08).
3. **Verifiera fältmappningen innan skarp drift:** skicka en testfaktura och kontrollera med Botkyrkas e-handel (e-handel@botkyrka.se) att beställarreferensen hamnar i BuyerReference och att OrderReference är tomt. I Fortnox motsvarar det normalt "Er referens" respektive "Ert ordernummer", men det ska bekräftas.
4. Ekonomen bokför och skickar i Fortnox, som distribuerar Peppol-fakturan (kräver Fortnox e-fakturatjänst och Botkyrkas Peppol-id). Plattformen hämtar status tillbaka: skapad → bokförd → skickad → betald.
5. **Reservvägar:** Excel-export av underlaget + PDF-specifikation för manuell registrering i Fortnox, eller kommunens kostnadsfria fakturaportal. Knappen "Markera som manuellt fakturerad" sparar fakturanumret (kräver giltig referens).
6. **Bevakning:** varning när en debiterbar vecka är äldre än 45 dagar utan faktura (preskription två månader efter utfört arbete). Ekonomen ser beloppet; chefen ser antal veckor och ärenden.
7. **Belopp bara för ekonomen** (beslut 2026-10-07): Ekonomi (fakturering, fakturakörning, faktura, ärendets fakturaunderlag och prislistan) är bara öppen för ekonomen.

**E-handel:** e-handelsbilagan kräver att formerna är överenskomna inom tre månader. Be Botkyrka bekräfta skriftligt att mejlbeställning + beställarreferens + Peppol-faktura är den överenskomna formen (§13), så att det inte kan tolkas som en avvikelse. Fältet för inköpsordernummer finns kvar om Proceedo-order införs senare.

Licenser att kontrollera: Fortnox Integration (om den inte ingår i ert paket) och Fortnox e-faktura.

### 7.16 Avtalsavvikelser, varningar och kvalitetsärenden

- Register (`contract_deviations`) för avvikelser som kommunen påtalar eller som MB själv upptäcker: typ (kvalitet, process, avtal, ekonomi), nivå (mindre, större, allvarlig), beskrivning, datum, åtgärdsplan med tidsplan, kommunens godkännande av planen, skriftliga varningar (räknas mot tre), vite och eventuell avräkning på faktura, avropsstopp.
- Klagomål och reklamationer från deltagare, arbetsgivare eller kommun registreras i samma register (typ "klagomål") – det stödjer avtalets krav på dokumenterat kvalitetsarbete.
- Månadssammanställning för APT/kvalitetsmöte: nya och öppna ärenden, åtgärder och lärdomar.
- Chefsvyn visar antal varningar och öppna åtgärdsplaner med förfallodatum.
- **Kommunens godkännande av åtgärdsplanen** registreras av avtalsansvarig (beslut 2026-10-07 – kommunens chef finns inte längre i portalen). Inget mejl till kommunen om planen.

### 7.17 Bonusanspråk (fas 3)

- När arbete påbörjas i anslutning till genomförd insats (verifierat), eller progression når nivån i incitamentsmodellen, skapas ett förslag till bonusanspråk med redovisningsunderlag (verifiering och relevanta rapportutdrag).
- Anspråket skickas till kommunen i portalen, som godkänner eller avslår – kommunen avgör om en anställning är sammanhållen.
- Godkänt anspråk ger en separat bonusfaktura, åtskild från periodfakturorna.
- Reglerna läggs i `contracts.config.bonus` när incitamentsmodellen är fastställd (§13). Tills dess är funktionen avstängd, men underlaget samlas in från dag 1.

### 7.18 Deltagarkortet: tidslinje, anteckningar och månadsunderlag

Beslut 2026-10-01 (rapportarbetet steg 2). Deltagarkortet är MB:s löpande underlag till månadsrapporten.

- **Tidslinje** (flik 2): allt som hänt i ärendet per månad, med det senaste först – aktiviteter och närvaro (en post per ISO-vecka, siffrorna som närvarostatistiken), avstämningar (godkända och utkast, utan text), kartläggning och godkända månadsbedömningar (samlad status och antal områden med tydlig progression), händelser och avslut, anteckningar, status- och coachbyten, avvikelser, samtycken, levererade rapporter och meddelanden. **Tidslinjen upprepar ingen fritext i grundvyn** – varje post har datum, typ, rubrik och status och en knapp till rätt flik. Undantaget är de fria anteckningarna, där texten är innehållet. Meddelandets text och avstämningens anteckning och hinder kan fällas ut på begäran ("Visa text", ihopfällt som standard) av den som får läsa dem på fliken – samma åtkomstregel som flikarna Meddelanden och Avstämningar (teamet ser inga sådana poster, kommunen ser aldrig tidslinjen); texten hämtas med en egen fråga först vid utfällningen (`arenden.kortTidslinjeText`) och loggas som på fliken, inte oftare (beslut 2026-10-02, Karim). Visas aldrig: råtranskript, AI-utkast, pulsmätningar, revisionsloggen, röstmeddelanden, aktiviteternas och händelsernas anteckningar, avvikelsetexter och orsaker i statushistoriken. Teamet (handledare) ser bara aktiviteter, närvaro, praktik, arbetsgivarkontakter, statusbyten och anteckningar skrivna för teamet. Månadsrubriken visar månadsrapportens status vid full åtkomst – under en rättelse den levererade versionen och att rättelsen är ett utkast, samma läge som i Månadsunderlaget.
- **Fria anteckningar** (`case_notes`): skrivs av den som arbetar i ärendet (samordnare, avtalsansvarig, coach, handledare) och gäller en dag. Vem ser: "Huvudcoach, samordnare, avtalsansvarig, chef och systemadministratör" eller "Även teamet"; i ärenden med skyddade personuppgifter bara namngiven huvudcoach och avtalsansvarig. **Kommunen läser aldrig anteckningar** – inte heller när avtalet har `seesCoachNotes`. Text som liknar ett personnummer stoppas – även med tankstreck eller mellanslag runt strecket (inklistrat från Word eller Outlook). Bara författaren ändrar texten. Ta bort = dölja (`removed_at`, `removed_by`), aldrig radera: författaren, och samordnare och avtalsansvarig inom sin åtkomst; författaren ser "Borttagen av {namn} {datum}" när någon annan tagit bort anteckningen. Revisionsloggen får bara id:n (`case_note.created`, `updated`, `removed`, `used_in_summary`) – aldrig texten. Anteckningar skickas aldrig till AI, utskick eller export.
- **Vägen in i månadsrapporten:** en anteckning kommer aldrig med av sig själv. I månadsbedömningen visas månadens anteckningar; huvudcoachen lägger till det som behövs i sammanfattningen, skriver om texten för kommunen och godkänner bedömningen. Bara det godkända kommer med (§7.11, regel 6).
- **Månadsunderlag** (fliken som tidigare hette Månadsbedömning): progression över tid (bara godkända bedömningar), vad som saknas innan rapporten kan godkännas (godkända veckoavstämningar under månaden och utkast, oregistrerad närvaro, månadsbedömningen, antal anteckningar – bara antal; antalet avstämningar jämförs inte med antalet veckor, eftersom en vecka över månadsskiftet hör till båda månaderna men avstämningen bara till den månad den hölls) och exakt det som kommer i månadsrapporten, byggt med samma funktion och samma dokument som rapporten – alltså bara närvarograden i avsnitt 2 (beslut 2026-10-07); veckorna och orsakerna finns på fliken Närvaro. En levererad månad visas på rapportsidan.
- **Bakgrundsinformationen från beställningen** (omfattningen, kartläggning genomförd, fritexten och bilagorna) visas på deltagarkortet för samordnare, avtalsansvarig och ärendets huvudcoach (beslut 2026-10-07). Bilagorna öppnas med en signerad adress som gäller i 60 sekunder; varje visning loggas (`attachment.viewed`). Samordnare och avtalsansvarig kan lägga till och ta bort bilagor.

---

## 8. AI-stöd: transkribering och textutkast

### 8.1 Principer

1. **AI dokumenterar – människan bedömer.** AI får transkribera, sammanfatta, föreslå text och peka ut belägg. AI får aldrig sätta progressionsnivå, samlad status, avslutsorsak, resultat eller fatta beslut om en deltagare. Bedömningsfält är tomma tills coachen valt.
2. **Kommunen har godkänt inspelning (2026-09-29) – deltagaren måste ändå säga ja.** Godkännandet dokumenteras som instruktion i PUB-avtalet. Varje deltagare informeras på lättläst svenska (med översättning vid behov) och samtycket registreras (textversion, datum, vem som informerade). Det kan återkallas när som helst. Den manuella vägen är fullt likvärdig och ett nej får inga konsekvenser.
3. **Inte för skyddade ärenden** (vilande sedan 2026-10-07 – skyddet är borttaget ur appen, spärren ligger kvar i databasen). Coachen kan pausa eller stoppa inspelningen när samtalet går in på sådant som inte behövs för uppdraget.
4. **Dataminimering.** Ljud raderas direkt efter lyckad transkribering (senast 24 h vid fel). Råtranskript raderas när avstämningen godkänts, senast efter 30 dagar. Kvar blir bara godkända, strukturerade uppgifter enligt avtalets gallringsregler.
5. **Bara Sverige/EU.** Avtalet förbjuder behandling utanför EU/EES utan kommunens särskilda skriftliga förhandsgodkännande. Leverantören ska ha personuppgiftsbiträdesavtal, inte träna på datan och inte lagra den.
6. **Öppenhet.** Synlig inspelningsindikator. Utkast märks "AI-utkast" tills de godkänts. Varje godkännande loggas med vem och när.
7. **AI Act.** Högriskkraven för bilaga III gäller från 2027-12-02 – under Botkyrka-avtalets löptid. Med designen ovan är AI ett förberedande dokumentationsstöd där människan gör bedömningen, men klassningen ska dokumenteras. Byggs en deltagarassistent senare ("Jason" på Miljonmatch-bilden) ska deltagaren få veta att hen talar med en AI.

### 8.2 Ljudkällor

- **Fysiskt möte:** inspelning i webbläsaren (MediaRecorder; webm/opus i Chrome/Edge, mp4 i Safari) på cirka 32 kbit/s ≈ 7 MB per 30 minuter. Uppladdning i bitar som kan återupptas, till en privat bucket. Den lokala kopian i webbläsaren raderas så fort uppladdningen bekräftats.
- **Uppladdad fil:** m4a, mp3, wav, webm.
- **Distansmöte i Teams:** transkriptet (.vtt) hämtas via Graph eller laddas upp. Då behövs ingen ljudbehandling och inget nytt underbiträde för själva transkriberingen.
- **Inklistrade anteckningar.**

### 8.3 Flöde och gränssnitt

1. Coachen väljer indatasätt i veckoavstämningen → ett jobb läggs i `jobs`, status visas i UI.
2. `transcribe` (hoppas över för Teams-transkript och text) → `extract` till veckoformulärets zod-schema, där varje fält har belägg (kort citat + tidpunkt i sekunder).
3. Coachen ser formuläret förifyllt med märkningen "AI-förslag"; klick på belägget visar citatet. Coachen ändrar, godkänner eller avvisar. Varje beslut sparas i `ai_field_decisions`.
4. Månadsvis: `draft` skriver utkast till konkreta observationer, aktivitetsdokumentation, plan och sammanfattning – **enbart från godkända uppgifter**, med hänvisning till källavstämningarna.

```ts
interface AiProvider {
  transcribe(audio: StorageRef, opts: { language: "sv" }): Promise<Transcript>; // { text, segments: [{ start, end, text }] }
  extract<T>(t: Transcript, schema: ZodSchema<T>, instructions: string): Promise<WithEvidence<T>>;
  draft(input: ApprovedCaseData, template: DraftTemplate): Promise<DraftText>;
}
```

Samma adapter används för att tolka fritextmejl i avropsinkorgen (§7.1). Alla svar valideras mot schemat; ogiltiga svar sparas som fel och visas aldrig för coachen. Varje körning sparar leverantör, modell, version, tidsåtgång och kostnad i `ai_runs`. Använd lägsta rimliga resonemangsnivå – uppgiften är extraktion, inte problemlösning.

**Instruktioner till modellen (kärna, svenska):**

- Du är ett dokumentationsstöd åt en jobbcoach. Du fattar inga beslut och bedömer inte personen.
- Skriv sakligt, respektfullt och funktionellt. Inga diagnoser, inga gissningar, inga värderande ord om personlighet.
- Varje uppgift ska ha ett belägg: kort citat och tidpunkt. Finns inget belägg skriver du "Framgår inte".
- Hälsa och liknande återges bara funktionellt och bara när det behövs för uppdraget ("behöver instruktioner i skrift", inte diagnosen).
- Svara endast med JSON enligt schemat.

### 8.4 Leverantörer och val

| | A: Berget AI | B: Gemini via Google Cloud |
|---|---|---|
| Bolag och drift | Svenskt bolag, drift i Sverige | Amerikanskt bolag, EU multi-region-endpoint (`aiplatform.eu.rep.googleapis.com`) |
| Transkribering | KB-Whisper (KB:s svenska modell) eller Klang Pianissimo | Ljud in → JSON ut i ett anrop |
| Styrka | Bäst på svenska enligt KB:s mätningar; ingen fråga om tredjeland | Stark på blandade språk; ett anrop i stället för två |
| Att tänka på | Textsteget körs med en öppen språkmodell – kvaliteten på svenska ska testas | Aldrig AI Studio/Gemini API-nyckel eller `global`-endpointen – de saknar garanti för var datan behandlas. EU-endpointen kostar 10 % extra |

**Beslut 2026-09-30:** MB väljer **B – Gemini Flash via Vertex AI med EU multi-region-endpoint** (`aiplatform.eu.rep.googleapis.com`, location `eu`). Aldrig AI Studio-nyckel eller global endpoint – adaptern vägrar andra endpoints. Tills kontot i Google Cloud är klart körs en simulerad leverantör i testmiljön. Plan för inspelning från coach, kommunens handläggare och deltagare: `docs/PLAN-ROST.md`.

**Val genom test (kvar som möjlighet):** samma 10–20 samtyckta testinspelningar (varav flera med deltagare som har svenska som andraspråk) körs genom båda. Två coacher bedömer blint: korrekta uppgifter, saknade uppgifter, påhittade uppgifter (måste vara noll) och tid till godkännande. Leverantören väljs per avtal i konfigurationen och kan bytas utan kodändring.

### 8.5 Mätning av dokumentationstiden

Per avstämning mäts minuter från mötets slut till godkänd dokumentation, andel förslag som accepteras, ändras eller avvisas per fält, och antal "felaktigt förslag"-rapporter från coacher. Baslinjen mäts i fas 1 utan AI. Den uppmätta tidsvinsten per möte visar vad AI-stödet ger och används för att planera kapaciteten per coach.

### 8.6 Kostnad

| Alternativ | Per 30-min samtal | Per månad (≈ 433 samtal) | Kommentar |
|---|---|---|---|
| A: Berget – KB-Whisper + öppen språkmodell | ≈ 1 kr | ≈ 450–500 kr | Data stannar i Sverige |
| B: Gemini 3.8 Flash, EU-endpoint, introduktionspris t.o.m. 2026-12-31 | ≈ 0,85 kr | ≈ 370 kr | 10 % EU-påslag inräknat |
| B: samma från 2027-01-01 | ≈ 1,70 kr | ≈ 740 kr | Googles ordinarie pris |
| Rapportutkast och mejltolkning | – | < 100 kr | Oavsett leverantör |

Antaganden: 100 deltagare × en avstämning per vecka × 52/12 ≈ 433 samtal/månad; ljud räknas som 32 token per sekund (57 600 token per 30 minuter); cirka 10 000 utdatatoken per samtal (transkript + JSON); 1 USD ≈ 9,6 kr och 1 EUR ≈ 11 kr. I praktiken blir det lägre eftersom inte alla samtal spelas in. Ett samtal på 60 minuter kostar ungefär 2–3,50 kr.

Fasta driftkostnader för piloten, ungefärligt: Supabase Pro ca 25 USD/månad inklusive 10 USD compute-kredit (större databas och point-in-time-återställning, ca 100 USD/månad, när fler kommunavtal ansluts) · Vercel Pro 20 USD per utvecklarplats · Fortnox Integration-licens från ca 189 kr/månad om den inte ingår i ert paket, plus e-fakturatjänsten · SMS per meddelande. Totalt ungefär 1 000–1 500 kr/månad.

---

## 9. Notiser: e-post och SMS

- Avsändare för notiser och inloggningskoder: **`notis@miljonmatch.se`** (visningsnamn "Miljonmatch", beslut 2026-10-01 – §11). Leverantörens SPF och MX för studsar ligger på underdomänen `send.miljonmatch.se` (en CNAME till Resend – inga andra poster får läggas på `send`) och DKIM på `resend._domainkey`, så domänens övriga poster påverkas inte (**en domän får bara ha en SPF-post**; `docs/DRIFT.md` avsnitt 4.2). DMARC för miljonmatch.se läggs in (`_dmarc`, börja med `p=none`). Svarsadressen i produktion är `avrop@miljonbemanning.se`, så att svar hamnar i avropsflödet.
- Ordererkännanden och andra svar på mejlbeställningar skickas från avrop@ (via Graph) så att tråden hålls ihop hos kommunen.
- E-postleverantör för övriga notiser och inloggningskoden: Resend (EU), via API. SMTP behövs inte längre – appen skickar inloggningskoden själv (§4, beslut 2026-10-02). Alternativ: Graph sendMail från en egen brevlåda i M365.
- **Alla mejl har samma layout i MB:s profil** (beslut 2026-10-02, `src/server/notify/render.ts`): ljusgrå bakgrund, vitt kort med röd linje överst, ordmärket "Miljonbemanning." med MILJONMATCH under, rubrik och brödtext i antracit, knapp till portalen eller appen (antracit med vit text, minst 44 px hög) med länken som text under, antracit fot. Alltid HTML och ren text, förtext, inga bilder, inga externa typsnitt och inga spårningspixlar. Inloggningskoden visas stort i en ljusgrå ruta med en trygghetsruta under – och utan länk. I staging står testmiljöns banderoll (och vem mejlet skulle ha gått till) överst.
- SMS: svensk SMS-leverantör via API. Minimalt innehåll: "Påminnelse: möte i morgon kl. 10.00 hos Miljonbemanning i Alby. Frågor? Ring [nummer]."
- Alla mallar redigeras i adminvyn och versioneras. Innehåller aldrig personuppgifter utöver ärendenummer.

---

## 10. Säkerhet och dataskydd

- **Roll per avtal.** Botkyrka: MB är personuppgiftsbiträde (avtalet punkt 8.1); PUB-avtal enligt SKR:s mall styr instruktioner, underbiträden, gallring och incidentrapportering till kommunen. Fler kommunavtal: samma roll – kommunen är personuppgiftsansvarig, MB biträde med eget PUB-avtal per kommun.
- **Skriftligt godkännande.** Botkyrkas besked om inspelning och underbiträden ska in i PUB-avtalets bilagor. Vercel och Supabase är amerikanska bolag trots drift i Stockholm – be om ett uttryckligt godkännande även av eventuell åtkomst från tredje land (t.ex. leverantörens support), eftersom avtalet kräver särskilt skriftligt förhandsgodkännande för det.
- **Konsekvensbedömning** för AI-delen dokumenteras (kommunen som personuppgiftsansvarig; MB bidrar med underlag).
- **Behörighet:** RLS enligt §4, need-to-know. Ekonom ser inga anteckningar. Handledare ser bara tilldelade ärenden.
- **Kryptering:** TLS överallt; personnummer krypteras på applikationsnivå; hemligheter i miljövariabler; Supabase krypterar lagrad data.
- **Revisionslogg** och månatlig loggkontroll (stickprov) av chef.
- **Skyddade personuppgifter:** borttagna ur appen (beslut 2026-10-07, Karim – juridisk risk, stäms av med Botkyrka). Frågan ställs inte och inget i gränssnittet visar eller hanterar skyddad identitet. Spärren i databasen (RLS och `src/data/policy.ts` för `protected_identity`) ligger kvar vilande – kolumnen är alltid false – så att skyddet kan slås på igen utan ny migration. RLS-testerna slår på den för en person i testet. CLAUDE.md punkt 8 beskriver fortfarande det gamla skyddet och behöver ändras av Karim.
- **Bilagor** (beslut 2026-10-07): privat bucket `bilagor` i Supabase Storage (Stockholm), sökvägen har bara avtal och id, nedladdning via signerad adress från servern (60 sekunder), samma behörighet som ärendet (handläggaren som beställde, samordnare, avtalsansvarig, huvudcoach – inte handledare, ekonom eller chef), varje visning i revisionsloggen. Ingen virusskanning ännu (§13).
- **Säkerhetskopior:** Supabase dagliga säkerhetskopior i piloten; point-in-time-återställning när fler kommunavtal ansluts. Återläsning testas minst en gång före produktion.
- **Gallring:** automatiska jobb enligt avtalets regler, med logg över vad som raderats. Vid avtalsslut: export till kommunen inom en kalendermånad, därefter radering (§7.11 i).
- **Informationssäkerhetsrutiner** (avtalet punkt 6.3): policy, utbildning av personal, skydd mot skadlig kod och incidenthantering ska finnas dokumenterade. Plattformen bidrar med behörighetsstyrning, logg och incidentrutin; för Botkyrka meddelas kommunen enligt PUB-avtalet.
- **Informationstexter** till deltagare på lättläst svenska och de vanligaste språken.
- **Tillgänglighet:** WCAG 2.1 AA.
- **Säkerhetsgranskning/penetrationstest** innan fler kommunavtal ansluts.

---

## 11. Hosting, domän, repo och miljöer

- **Repo:** `miljonmatch`, privat, under Miljonbemannings organisation på GitHub (inte ett personligt konto).
- **Domän (beslut 2026-10-01):** appen körs på MB:s produktdomän **miljonmatch.se** (DNS hos one.com). Den gamla webbsidan på miljonmatch.se/www ersätts av appen. Just nu skickas `miljonmatch.se` vidare till `www.miljonmatch.se` (inställt i Vercel), så appens adress – `MM_APP_URL` och *Site URL* i Supabase Auth – är **`https://www.miljonmatch.se`**: alltid den adress som inte skickas vidare. Båda adresserna och förhandsadresserna (`https://*-ai-projekts-projects.vercel.app`) finns bland *Redirect URLs* (`docs/DRIFT.md` avsnitt 2.2). Just nu är det testmiljön (bara påhittade testdata) som ligger där; när produktionen startar flyttar testmiljön till `test.miljonmatch.se` och produktionen tar över `miljonmatch.se` i ett eget Vercel- och Supabase-projekt. **E-post skickas från `notis@miljonmatch.se` (beslut 2026-10-01).** Domänen miljonmatch.se är verifierad i Resend med DNS-posterna hos one.com. Regionen är EU: Irland (`eu-west-1`) enligt Karims beslut 2026-10-02 (underbiträdeslistan, §3.1) – den syns inte i DNS utan i Resend (*Domains → miljonmatch.se*), `docs/DRIFT.md` avsnitt 4.2. Skäl: DNS för miljonbemanning.se styrs av Terraform (Google Cloud DNS), och Resends poster där skulle försvinna vid nästa `terraform apply` om de inte också låg i Terraform-koden – med miljonmatch.se finns inte den risken, och appen och avsändaren har samma domän. Resends poster i miljonbemanning.se-zonen (inlagda 2026-09-30) behövs inte längre av appen. Svarsadressen i produktion är oförändrad: `avrop@miljonbemanning.se` (kommunens formella beställningskanal, CLAUDE.md punkt 10); miljonmatch.se har null-MX och tar inte emot e-post. Ordererkännanden och andra svar på mejlavrop skickas fortfarande från avrop@ (Microsoft Graph). `portal.miljonbemanning.se` är upptagen (CNAME till Office 365). Använd inte miljon.io för kommunvända tjänster.
- **Konton** (GitHub, Vercel, Supabase, AI-leverantör, SMS, e-post, Fortnox-utvecklarkonto) ägs av Miljonbemanning AB via funktionsadress, minst två administratörer, MFA överallt och fakturering på bolaget – PUB- och underbiträdesavtal tecknas av bolaget.
- **Miljöer:** produktion + staging (separata Supabase-projekt, båda i Stockholm). Staging har bara testdata. Preview-deployer pekar aldrig mot produktionsdatabasen. **Skarp drift sedan 2026-10-08 (beslut Karim):** miljön på www.miljonmatch.se (projektet `blxupsebzzhmjitaywev`) är produktion – testdatat togs bort, `environment = production`, riktig tid, kollegorna är vanliga användare som administratören lägger till och ger roller i appen (Användare och roller → Lägg till kollega, ändra roller, spärra; en person kan ha flera roller och väljer roll i sidopanelen – migration 0027 `role_choices`), avtalsansvarig är Ali, AI är av tills Google Cloud är kopplat (klartext "Tal till text är inte kopplat ännu – skriv själv så länge", aldrig simulerad text i produktion). Testmiljön på `test.miljonmatch.se` sätts upp senare i ett eget projekt. Appen ska fungera med en tom databas (`MM_SEED=empty` lokalt och e2e-projektet `tom`). Se `docs/DRIFT.md`.
- **Testare i staging (beslut 2026-10-01 – gäller testmiljön, inte produktionen):** Karim och Ali samt kollegorna Sara Salah, Adam Abdalla, Shafik Muwanga och Moda Habib (Miljonbemanning) loggar in som sig själva, agerar som testpersoner och lämnar synpunkter med knappen **Lämna synpunkt** (sparas med sida och roll, listan går att ladda ner som CSV). Bara testare i staging – funktionen finns inte i produktion. Synpunkterna finns kvar när testdatat läses in på nytt. Inloggningskoder och mejl går i staging bara till adresserna i `MM_EMAIL_ALLOWLIST` (`docs/DRIFT.md` avsnitt 11). **Beslut 2026-10-02:** bara Karim och Ali ser priser, belopp, fakturaunderlag, viten, bonus, interna mål, avtalssidan och Ekonomi (sedan 2026-10-07 ser också de belopp bara när de agerar som ekonom). Övriga testare (neka som standard, `src/api/tester-access.ts`) ser "Visas inte för testare" i stället, kan inte agera som ekonom och ser inte underbiträdena – servern lämnar inte ut uppgifterna. Avtalsmålet visas för alla.
- **Övervakning:** drifttidskontroll och felrapportering utan personuppgifter. Används ett externt verktyg (t.ex. Sentry i EU-region) läggs det till i underbiträdesförteckningen.
- **Portabilitet:** standard-Postgres + Next.js utan Vercel-specifika lagringstjänster. Supabase är öppen källkod, så databasen kan flyttas till svensk drift om en kommun kräver det.

---

## 12. Faser och acceptanskriterier

### Fas 0 – Förberedelser (nu, parallellt med bygget)

- [ ] Botkyrkas godkännande av inspelning och underbiträden skriftligt i PUB-avtalets bilagor, inklusive eventuell åtkomst från tredje land.
- [ ] Svar från Botkyrka om beställarreferensen (§13 punkt 3) och skriftlig bekräftelse att mejlbeställning + beställarreferens + Peppol-faktura uppfyller e-handelsbilagan.
- [ ] Besked om en faktura per deltagare och månad eller skriftligt godkänd samlingsfaktura.
- [ ] Word-mallarna uppdaterade: omfattningen 6 eller 12 månader eller annan tidsperiod med motivering, kartläggning och bakgrundsinformation (beställarreferensen tas bort ur mallen – beslut 2026-10-07), "Lämnas tomt – tilldelas av Miljonbemanning" i ärendenummerfältet, rubriken "4." och området språk i månadsrapporten, MB:s grafiska profil (mallarna har i dag petrolblå rubrikrader och Office-standardtypsnitt).
- [ ] Repo, konton och regioner uppsatta (Supabase Stockholm, Vercel arn1).

### Fas 1 – Leverera avtalet

Auth och roller, avtalskonfiguration, mejlbeställning och portal, ärendenummer, ordererkännande och orderbekräftelse, kartläggning, närvaro och veckorapport, veckoavstämning, månadsbedömning, utfall, avvikelser, månads- och slutrapport, fakturaunderlag, deadline-vy, revisionslogg.

- [ ] Ett mejl till avrop@ med ifylld Word-mall blir ett ärende utan manuell inmatning; ett fritextmejl tolkas med AI; ordererkännande med ärendenummer skickas inom 5 minuter och saknade uppgifter efterfrågas automatiskt.
- [ ] Samordnaren accepterar eller avböjer ett avrop på under 2 minuter; SLA-klockan (en arbetsdag, svenska helgdagar) syns och eskalerar.
- [ ] En faktura kan inte skapas utan giltig beställarreferens (8–10 siffror). Ett ärende kan bekräftas utan referens – ekonomen fyller i den per faktura före faktureringen (beslut 2026-10-07).
- [ ] En kommunanvändare loggar in med e-postkod (kontot skapas själv på kommundomänen), kan beställa i portalen med bilagor och läsa rapporter, och ser bara sina ärenden (RLS-test).
- [ ] Ärenden utan bokat första möte flaggas efter tre dagar; möten som ligger mer än 7 dagar efter avropet markeras.
- [ ] Kartläggningen kan registreras och godkännas vecka 1.
- [ ] Coachen registrerar dagens närvaro på under en minut; veckorapporten per handläggare publiceras automatiskt senast måndag 16:00, och saknad registrering eskaleras 10:00.
- [ ] Veckoavstämning med rullgardiner; röd status skapar en avvikelse som kräver åtgärd.
- [ ] Månadsbedömningen kan inte godkännas om observation saknas vid nivå 1 eller högre.
- [ ] Månads- och slutrapport-PDF följer mall 02 (avsnitt 1–8), MB:s profil, och byggs bara av godkända uppgifter.
- [ ] En faktura per avtal och månad med en rad per ärende enligt §7.15 (summorna är desamma som med en faktura per ärende), med Excel/PDF-export; veckor utan närvaro markeras för kontroll; en returnerad faktura kan krediteras och göras om.
- [ ] Revisionslogg vid visning av deltagarkort och rapporter; deadline-vyn visar allt som förfaller inom 7 dagar; baslinje för dokumentationstid mäts.

### Fas 2 – AI och automatisk fakturering

- [ ] Inspelning kan bara startas om deltagarens samtycke finns registrerat; samtycke kan återkallas.
- [ ] Ljudfilen raderas automatiskt efter transkribering (verifierat i test).
- [ ] Förslag visas med belägg; bedömningsfält är tomma tills coachen valt.
- [ ] AI-utkast till observationer, aktivitetsdokumentation, plan och sammanfattning från godkända uppgifter, med källhänvisning.
- [ ] A/B-jämförelsen mellan leverantörerna är dokumenterad; tidsvinst och acceptansgrad visas per månad.
- [ ] Fortnox-API: en faktura per ärende och månad med beställarreferens, ärendenummer som faktureringsobjekt och upparbetat/återstående belopp; testfakturan är verifierad med Botkyrkas e-handel; omkörning skapar inga dubbletter; status synkas tillbaka.
- [ ] Pulsmätning vid vecka 2 och vid avslut; aggregat först vid 5 svar.
- [ ] Resultatflaggor under 35 % och 32 % till rätt roller; minN respekteras; beställarrapporten genereras månadsvis utan internt mål och lämnas till kommunen av avtalsansvarig.
- [ ] Register för avtalsavvikelser, åtgärdsplaner, varningar och klagomål.

### Fas 3 – Mervärde

- [ ] Bonusanspråk med redovisningsunderlag, kommunens beslut i portalen och separata bonusfakturor.
- [ ] Yrkeskompetensbevis/diplom som PDF.
- [ ] Arbetsgivarregister och praktikplatser med de fyra rätten.
- [ ] Statistik på begäran och fullständig dataexport + radering vid avtalsslut.

### Fas 4 – Fler kommunavtal

- [ ] Ett nytt kommunavtal kan konfigureras utan kodändring i kärnflödena: egen konfiguration, avtalsområden, prislista, KPI:er och SLA (§6.3).
- [ ] Kapacitetsvy per coach (aktiva ärenden mot tak).
- [ ] Exportmallar per avtal (§7.11 j).
- [ ] Deltagarinloggning och bokning, säkerhetsgranskning, point-in-time-återställning.

Fasen hette tidigare "KK-redo" – Kammarkollegiets krav byggs inte i Miljonmatch (beslut 2026-10-06, §14).

---

## 13. Öppna frågor

| # | Fråga | Svarar | Status |
|---|---|---|---|
| 1 | Inspelning och underbiträden | Botkyrka | **Godkänt 2026-09-29**, utökat 2026-09-30 till kommunens handläggare och deltagare – ska in skriftligt i PUB-avtalet, inklusive eventuell åtkomst från tredje land (Google/Vertex AI) |
| 2 | Inköpsordersystem | Botkyrka | **Besvarad:** kommunen har inget – Miljonmatch är beställningssystemet |
| 3 | Vilken beställarreferens (8–10 siffror) ska stå på fakturorna – en per handläggare, per enhet eller en för hela avtalet? Bekräfta skriftligt att mejlbeställning + beställarreferens + Peppol uppfyller e-handelsbilagan | Botkyrka (e-handel@botkyrka.se) | Öppen – **blockerar fakturering**. Sedan 2026-10-07 fyller ekonomen i en referens per faktura (en faktura per avtal och månad) |
| 4 | Debiterbar vecka | Botkyrka | **Besvarad:** alla veckor deltagaren är inskriven. Tolkning: delvisa start- och slutveckor räknas, pausade veckor räknas inte |
| 5 | En faktura per deltagare och månad, eller skriftligt godkänd samlingsfaktura? | Botkyrka | Öppen – MB har beslutat en faktura per avtal och månad med en rad per ärende (2026-10-07). Det är en samlingsfaktura och kräver Botkyrkas skriftliga godkännande. Till dess kan avtalet ställas om till en faktura per ärende och månad i konfigurationen (`invoicePer`) |
| 6 | Resultatdefinition: vilka anställningar och studier räknas (omfattning, varaktighet, subventionerade anställningar), när mäts det, vilka avslut exkluderas? | Botkyrka | Öppen – blockerar resultatflaggor |
| 7 | Vill kommunen ha frånvaronotis samma dag, utöver veckorapporten? | Botkyrka | Öppen |
| 8 | Deadline för månads- och slutrapport; räcker portalen som kanal eller krävs e-post? | Botkyrka | Öppen |
| 9 | Räcker e-postkod som inloggning för kommunens personal? Ska handläggare se hela enhetens ärenden? | Botkyrka (IT) | Delvis besvarad 2026-10-07: alla på `@botkyrka.se` kan skapa ett konto själva och ser bara sina egna beställningar. E-postkoden som inloggning är inte bekräftad av Botkyrkas IT |
| 10 | Vad är den "avtalade säkra rutinen" för skyddade personuppgifter? | Botkyrka | Stängd av beslutet 2026-10-07 (skyddet borttaget ur appen, spärren vilande). Ny fråga till Botkyrka: godtar kommunen att frågan inte ställs (juridisk risk)? |
| 11 | Gallring under avtalstiden (vid avtalsslut gäller återlämning inom en månad) | Botkyrka | Öppen |
| 12 | Progressionsområden: räcker tillägget språk, eller vill kommunen också följa hälsa och livskvalitet (AFK 7.8)? | Botkyrka + MB | Öppen |
| 13 | Incitamentsmodell: vilken modell gäller och när kan bonus begäras? | Botkyrka + MB | Öppen |
| 14 | Beställarrapportens innehåll och frekvens | Botkyrka | Öppen – sedan 2026-10-07 en rapport per avtal och månad som Miljonbemanning lämnar till kommunen utanför Miljonmatch |
| 15 | Ingår Fortnox Integration och e-faktura i ert paket? Vem godkänner API-kopplingen? | MB ekonomi | Öppen |
| 16 | Vem är systemägare, och vem sköter Terraform-koden för DNS (Google Cloud DNS)? | MB | Öppen – appens e-post använder inte längre miljonbemanning.se (avsändaren är `notis@miljonmatch.se` sedan 2026-10-01, DNS hos one.com), så Resend-posterna i Terraform-zonen behövs inte för appen |
| 17 | Ska SLA-statistik visas för kommunen? | MB ledning | Öppen |
| 18 | Val av SMS-leverantör | MB | Öppen – e-postleverantören är vald: Resend, EU (Irland, eu-west-1), väntar på kommunens godkännande som underbiträde (§3.1) |
| 19 | Ska månadsrapport lämnas för en månad med färre än 11 inskrivna dagar? | Botkyrka | Öppen – förslag: nej. Gäller tills vidare (`reportSchedule.monthly.minEnrolledDays` = 11, beslut 2026-10-01, samma regel som testdatat). Månadsrapporten täcker i dag bara sin kalendermånad, så dagarna i en kort månad kommer **inte** med i nästa månads rapport. De syns i veckorapporterna och i slutrapporten, som täcker hela perioden. Ska de räknas in i nästa månads rapport krävs en ändring i månadsrapporten |
| 20 | Vem tar emot veckorapporten för ett ärende där handläggaren saknar konto i portalen (avrop per mejl eller telefon)? | Botkyrka | Öppen – i dag får ärendet ingen veckorapport (samordnaren får en flagga). Handläggaren kan nu skapa ett konto själv. Beställarrapporten är en för hela avtalet (beslut 2026-10-07) |
| 21 | Räknas resultatfilen som Miljonbemanning lämnar till kommunen som "statistik på begäran" (högst två gånger per år, §3)? | Karim + Botkyrka | Öppen – MB:s förslag är att den inte gör det. Kommunens chef hämtar inte längre själv och MB delar inga rapporter med kommunen (beslut 2026-10-07). Loggen (`export.results_mb`) gör det möjligt att räkna filerna senare |
| 22 | Resultatfilen: räcker kolumnerna för kommunens presentationer och beräkningar, och vill kommunen ha Excel, CSV eller båda (fältbeskrivningen §14)? | Botkyrka | Öppen – båda finns i version 1 |
| 23 | Avslut i en månad utan månadsrapport (färre än `reportSchedule.monthly.minEnrolledDays` inskrivna dagar i slutmånaden): avslutet kan inte stå på raden för slutmånaden. Var ska det stå? | MB + Botkyrka | Beslutat av Karim 2026-10-01, stäms av med Botkyrka: en fjärde tabell "Avslut" (en rad per levererad slutrapport för insatser som avslutades i perioden, sist i filen – inga befintliga kolumner ändrade, schemaversion 1). Resultatgraden räknas där. Avslutskolumnerna i tabell 1 finns kvar på slutmånadens rad när den har en månadsrapport. Fältbeskrivningen är uppdaterad (§1, §3, §5, §6, §7, ny §10, numreringen) |
| 24 | Rapportbyggaren: raden Totalt visar exakta antal även när en grupp redovisas som "färre än 5". Totalt minus de synliga grupperna ger då den dolda gruppens antal. Ska Totalt döljas eller avrundas när någon grupp är liten? | MB + Botkyrka | Öppen – i dag ingen maskering av Totalt. Kommunen ser inga sparade rapporter sedan 2026-10-07, så frågan gäller bara det Miljonbemanning lämnar till kommunen |
| 25 | Ska en rapport som MB delat med kommunens chef automatiskt sluta delas om avtalet slutar tillåta individrapporter? | MB | Stängd 2026-10-07: delning med kommunen är borttagen; delade rapporter blev delade inom Miljonbemanning (migration 0026) |
| 26 | Bilagor: ska Word-filer i det gamla formatet (.doc, kan innehålla makron) tas emot, och behövs virusskanning av uppladdade filer (§10 "skydd mot skadlig kod")? | MB + Botkyrka | Öppen – i dag tas .doc emot och filens första byte kontrolleras, men ingen virusskanning görs |
| 27 | Gallring av bilagor till beställningen (`retentionRules.attachmentsAfterCloseDays`) | Botkyrka (PUB-avtalet) | Öppen – "ATT_FASTSTÄLLA" i konfigurationen; till dess raderas bara uppladdningar som aldrig kopplades (efter 24 timmar) |
| 28 | Slutrapporten och resultatfilen visar fortfarande närvarodetaljerna (veckor/månader, orsaker, upprepad frånvaro). Ska de också bara visa närvarograden som månadsrapporten? | Karim + Botkyrka | Öppen – oförändrade tills vidare |
| 29 | Räcker det att avtalsansvarig registrerar kommunens godkännande av en åtgärdsplan (§7.16)? | MB + Botkyrka | Öppen – så fungerar det sedan 2026-10-07 |
| 30 | Upparbetat och återstående på fakturaraden (§7.15) anges i veckor och kronor. Räcker veckor, eller kräver Botkyrka kronor ("belopp" i villkoren)? Beställningen har inget ordervärde sedan 2026-10-07 | Botkyrka | Öppen – i dag veckor och kronor på fakturan (bara ekonomen ser den) |
| 31 | Belopp bara för ekonomen (beslut 2026-10-07) är en spärr i servern. Ska behörigheten i databasen (RLS) för fakturatabellerna och prislistan också begränsas till ekonomen? Chef, avtalsansvarig och admin kan i dag läsa dem i databasen | MB | Öppen – kräver en ny migration och genomgång av flaggorna som räknar ofakturerade veckor |
| 32 | Planerat slut vid 6 eller 12 månader: ska det räknas från önskat startdatum (som portalen visar när kommunen beställer) eller från första mötet (som orderbekräftelsen visar efter accept)? | Karim + Botkyrka | Öppen – i dag räknas slutdatumet om från första mötet när beställningen accepteras, och portalen säger det vid fältet (granskningen 2026-10-07) |

---

## 14. Kammarkollegiet – egen plattform (beslut 2026-10-06)

Kammarkollegiet får en egen plattform och blandas aldrig ihop med Miljonmatch. Tabellen över vad piloten skulle bevisa för Kammarkollegiet är borttagen, liksom deras konfiguration, prislista och testdata. Miljonmatch är kommunernas plattform: Botkyrka nu, fler kommunavtal som konfiguration (§6.3).

---

## 15. Avvägningar och vad som omprövas när volymen växer

- **Vercel + Supabase eller svensk drift:** snabbast att bygga och välkänt för Claude Code, data i Stockholm – men leverantörerna är amerikanska. Mildras med regionlåsning, skriftligt godkännande och portabilitet (§11). Omprövas om en kommun kräver svenskägd drift.
- **Deterministisk tolkning av Word-mallen före AI:** färre fel och ingen AI på beställningar i normalfallet.
- **En faktura per ärende:** fler fakturor men enligt kommunens villkor; blir billigt med API. Omprövas om kommunen godkänner samlingsfaktura.
- **En app för alla roller:** enklare drift och säkerhet. Omprövas om en beställare kräver egen domän eller egen inloggning (SSO).
- **Jobb i Postgres-tabell:** räcker för pilotens volymer. Vid större volym (tusentals möten i månaden, fler kommunavtal) – dedikerad kö och separat worker.
- **PDF i serverfunktion:** räcker nu; vid större volym genereras rapporter i batch nattetid.
- **Omprövas när fler kommunavtal ansluts:** databasstorlek och point-in-time-återställning, BankID, API för beställare, lasttest och penetrationstest.

---

## 16. Startprompt för Claude Code

```
Läs CLAUDE.md och SPEC.md (v0.2). Vi börjar med fas 1 (SPEC §12).
Gör först en plan: mappstruktur, databasmigrationer för de tabeller i §6 som fas 1 behöver,
RLS-policyer per roll, seed med påhittade testdata och i vilken ordning flödena byggs.
Börja med mejlbeställningen (§7.1–7.4) – den är kommunens formella kanal och har
svarskrav inom en arbetsdag – därefter närvaro och veckorapport (§7.6).
Skriv ingen kod förrän jag godkänt planen.
```
