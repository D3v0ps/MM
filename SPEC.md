# Miljonmatch – kravspecifikation v0.2

*Produktnamn: Miljonmatch. Repo: `miljonmatch`. Ägare: Miljonbemanning AB (556959-9318). Version 2026-09-29.*

| | |
|---|---|
| Avtal nr 1 (pilot) | Botkyrka kommun – Yrkesförberedande och yrkesinriktade insatser. Avtal 332026110, dnr AVN/2026:00048 |
| Avtal nr 2 | Kammarkollegiet – Grundläggande omställnings- och kompetensstöd och yttrande, ref. 2.7.5-4201-2026, start 2027-03-13 |
| Underlag | Avtalet, Administrativa föreskrifter och krav (AFK), bilagorna Botkyrka e-handel och Fakturerings- och betalningsvillkor, Frågor och svar, 01 Avropsmall, 02 Månadsrapport individ, uppstartspresentationen |

**Nytt i v0.2:** namnet är fastställt, upphandlingsdokumenten är inlästa och Botkyrkas besked är inarbetade. Det viktigaste som ändrats: beställningar sker formellt via mejl, närvarorapport ska lämnas varje vecka, fakturor kräver kommunens beställarreferens och samlingsfakturor accepteras inte utan särskild överenskommelse.

---

## 1. Sammanfattning

Botkyrka-avtalet gäller 70–100 årsplatser med insatser på typiskt 4–10 veckor (utvärderingspriset byggde på 4 och 10 veckor). Med 7 veckor i snitt blir det 40–60 nya avrop i månaden, alltså 2–3 per arbetsdag, och varje avrop ska besvaras inom en arbetsdag. Beställningar sker via mejl. MB ska lämna närvarorapport varje vecka, progressionsrapport varje månad och slutrapport efter varje insats. Vite är 25 000 kr per tillfälle vid avvikelse eller bristfällig information, och kommunen har två leverantörer per område – obesvarade avrop kan flytta ner MB i rangordningen.

Miljonmatch samlar hela kedjan i ett system: kommunen beställer (mejl eller portal), MB:s coacher dokumenterar (manuellt eller med AI-stöd), rapporter genereras från godkända uppgifter, KPI:er och deadlines bevakas, och fakturaunderlag går till Fortnox. Den byggs för flera avtal från dag 1: Botkyrka är avtal nr 1 och Kammarkollegiet (KK) avtal nr 2 – samma kod, ny konfiguration.

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

- Ingen inloggning för deltagare – pulsmätningen använder engångslänk. Deltagarinloggning byggs inför KK (fas 4).
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
- **Fakturering (fakturerings- och betalningsvillkoren):** Peppol BIS Billing 3 – e-post- och pappersfakturor accepteras inte (kommunen erbjuder en kostnadsfri fakturaportal som reserv). Månadsvis i efterskott; betalning 30 dagar efter godkänd leverans och korrekt faktura. Fakturan ska innehålla antingen ett **inköpsordernummer** (nio siffror som börjar med 99, vid köp via kommunens e-handel eller rekvisition) eller en korrekt **beställarreferens** (8–10 siffror, bara siffror, lämnas av kommunen vid varje inköp). Periodisk fakturering ska ange faktureringsobjektet och hållas isär från annan fakturering. Upparbetat och återstående belopp på beställningen ska anges där det är tillämpligt. **Samlingsfakturor accepteras inte** om det inte särskilt avtalats. Fel pris eller fel/saknad information på fakturan räknas som ekonomisk avvikelse. Faktureringspreskription två månader efter utfört arbete.
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
| Systemadmin | MB | Allt inklusive konfiguration och logg | Användare, avtal, integrationer | Microsoft (Entra ID) |
| Avtalsansvarig / kundansvarig | MB | Allt inom sina avtal | Accepterar/avböjer avrop, godkänner beställarrapport, hanterar avtalsavvikelser, bjuder in kommunanvändare | Microsoft |
| Operativ samordnare | MB | Alla ärenden i avtalet | Avropsinkorg, tilldelar coach, bokar start | Microsoft |
| Huvudcoach | MB | Egna ärenden | Kartläggning, avstämningar, närvaro, bedömningar, utfall, rapporter | Microsoft |
| Handledare / arbetsgivarmatchare / SYV | MB | Tilldelade ärenden | Moment, praktik, arbetsgivarkontakter, närvaro, validering | Microsoft |
| Chef / controller | MB | Allt i läsläge, KPI:er, flaggor, revisionslogg | Kvitterar flaggor, åtgärdsplaner, loggkontroll | Microsoft |
| Ekonom | MB | Ärendenummer, perioder, avtalsområde, referenser, fakturaunderlag – inga anteckningar eller rapporter | Fakturakörning, Fortnox, export | Microsoft |
| Kommunens handläggare/coach | Beställare | Egna anvisade ärenden (eller hela enheten, styrs av avtalskonfigurationen) | Beställer, läser rapporter, skickar meddelanden, kvitterar, beslutar om bonusanspråk | E-post + engångskod |
| Kommunens chef | Beställare | Beställarrapport + enhetens ärenden | Läser, laddar ner, godkänner åtgärdsplaner | E-post + engångskod |
| Deltagare (fas 4) | – | Egen plan och bokningar | Bokar, svarar på puls | BankID (senare) |

**Inloggning:**

- MB-personal loggar in med Microsoft Entra ID via Supabase Auth (Azure-leverantören). MFA styrs av M365. Ingen självregistrering – bara inbjudna konton.
- Kommunanvändare loggar in med **e-post + sexsiffrig engångskod**, inte magisk länk: e-postskydd som Microsoft Safe Links öppnar länkar i förväg och förbrukar engångslänkar. Koden gäller 10 minuter, max 5 försök, hastighetsbegränsning per adress och IP. Session: utloggning efter 60 minuters inaktivitet, max 12 timmar. Inbjudan görs av avtalsansvarig; tillåtna e-postdomäner per beställare (t.ex. `botkyrka.se`).
- Supabase Auth måste konfigureras med egen SMTP (den inbyggda är bara för test).

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

**Underbiträden** – godkända av Botkyrka 2026-09-29; förs in i PUB-avtalets förteckning och visas i adminvyn. Håll listan kort.

| Leverantör | Behandling | Plats |
|---|---|---|
| Supabase | Databas, inloggning, fillagring | Stockholm (eu-north-1) |
| Vercel | Applikation och serverfunktioner | Funktioner i Stockholm (arn1) |
| AI-leverantör (en av två, §8.4) | Transkribering och textutkast | Berget AI: Sverige · Google: EU multi-region |
| SMS-leverantör | Påminnelser och pulslänkar | Väljs – helst svensk |
| E-postleverantör | Notiser och inloggningskoder | Väljs – helst EU |
| Microsoft | Inloggning (Entra) och avrop@-brevlådan (Graph) | Befintligt M365 |

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
| inbound_emails | Beställningar via mejl | graph_message_id (unik), received_at, from_address, subject, body_text, attachment_paths[], parse_method (template/ai/manual), classification, extracted (jsonb), confidence (jsonb), missing_fields[], status, case_id, handled_by, handled_at |
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
| reports | Alla rapporter och intyg | contract_id, case_id?, recipient_user_id?, kind (weekly_attendance/monthly/final/order_confirmation/customer_summary/skills_certificate/statistics), period_start, period_end, status, snapshot (jsonb), pdf_path, version, due_at, approved_by, approved_at, delivered_at, delivered_to[], opened_at |
| pulse_invites | Pulsutskick | case_id, token_hash, channel, language, occasion (week2/exit/periodic), sent_at, expires_at, used_at |
| pulse_responses | Pulssvar | invite_id, answers (jsonb), language, contact_requested, submitted_at |
| bonus_claims | Bonusanspråk (fas 3) | case_id, kind (work/progression), basis, evidence_paths[], submitted_at, customer_decision, decided_by, decided_at, amount_ore, invoice_draft_id |
| kpi_snapshots | Beräknade KPI:er | contract_id, kpi_key, window, value, numerator, denominator, computed_at |
| alerts | Flaggor | contract_id, case_id?, kind, severity, message, recipient_roles[], created_at, acknowledged_by, acknowledged_at, action_plan |
| deadlines | SLA-bevakning | contract_id, case_id?, report_id?, kind, due_at, met_at, status |
| billing_runs | Fakturakörning per månad | contract_id, month, status, created_by |
| invoice_drafts | En faktura per ärende och månad (standard) | billing_run_id, kind (periodic/bonus), case_id?, grouping_key, buyer_reference, purchase_order_number?, invoiced_object (ärendenummer), accrued_ore, remaining_ore, status, fortnox_document_number, fortnox_status, synced_at |
| invoice_lines | Fakturarader | invoice_draft_id, case_id, price_item_id, quantity, unit_price_ore, description, iso_weeks[], zero_attendance_weeks[] |
| integrations | Fortnox, Graph, SMS, e-post | kind, status, config, secrets_enc, token_expires_at |
| jobs | Bakgrundsjobb | kind, payload, status, attempts, run_after, last_error |
| ai_runs | Varje AI-anrop | case_id?, kind, provider, model, input_ref, status, audio_seconds, tokens_in, tokens_out, cost_ore, latency_ms, output (jsonb), evidence (jsonb), input_deleted_at |
| ai_field_decisions | Coachens beslut per förslag | ai_run_id, field, suggested, final, decision (accepted/edited/rejected), decided_by, decided_at |
| consents | Samtycke till inspelning/AI | person_id, case_id, kind, text_version, given_at, informed_by, revoked_at |
| messages | Säkra meddelanden per ärende | case_id, sender_id, body, created_at, read_by, read_at |
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
    "statDefinition": { "clear": "minst ett område på nivå >= 2", "any": "minst ett område på nivå >= 1" }
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
    "invoicePer": "case_and_month",
    "collectiveInvoiceAllowed": false,
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
  "retention": "ATT_FASTSTÄLLA enligt PUB-avtalet"
}
```

### 6.3 Avtalskonfiguration – skiss Kammarkollegiet (visar att modellen räcker)

```json
{
  "casePrefix": "KK",
  "dataRole": "controller",
  "customerVisibility": { "seesIndividualReports": false, "seesCoachNotes": false },
  "priceItems": [
    { "code": "startpaket", "unit": "package", "packageMonths": 4, "price": 4120 },
    { "code": "forlangt_stod", "unit": "month", "price": 1200 },
    { "code": "forstarkt_stod", "unit": "month", "price": 1350 },
    { "code": "arbetstagarstod_startpaket", "unit": "package", "packageMonths": 4, "price": 4080 },
    { "code": "csn_yttrande", "unit": "each", "price": 699 }
  ],
  "kpis": [
    { "key": "placeringsgrad", "contractTarget": 0.60 },
    { "key": "yttranden_i_tid", "contractTarget": 0.80 },
    { "key": "nojdhet", "contractTarget": 0.70 }
  ],
  "sla": [
    { "key": "forsta_kontakt", "from": "bestallning", "within": { "days": 5 } },
    { "key": "forsta_mote", "from": "bestallning", "within": { "days": 10 } }
  ],
  "meetingMinimums": [
    { "service": "startpaket", "minMeetings": 4, "minMinutesEach": 60, "periodMonths": 4 },
    { "service": "forlangt_stod", "minMeetingsPerMonth": 1 }
  ],
  "exports": [ { "key": "kk_manadsstatistik", "format": "xlsx", "fieldsPerCustomer": 8 } ]
}
```

Kontrollera i KK-avtalet om dagarna är kalender- eller arbetsdagar och vilka de åtta statistikfälten är.

---

## 7. Funktioner och flöden

### 7.0 Startsidor per roll

- **Kommunens handläggare:** tre stora knappar – "Beställ ny insats", "Mina deltagare", "Rapporter och meddelanden". Olästa rapporter och meddelanden överst. Ingen annan navigation på startsidan.
- **Coach ("Min vecka"):** dagens och veckans möten, närvaro att registrera (med nedräkning till måndag 10:00), AI-utkast att granska, rapporter som förfaller, egna flaggor.
- **Samordnare/avtalsansvarig:** avropsinkorg med SLA-klocka, ärenden utan coach, första möten som inte är bokade, deadlines inom 7 dagar, avtalsavvikelser, flaggor.
- **Chef/controller:** KPI:er mot mål, flaggor, prognos, avtalsavvikelser och varningar, per coach och per avtalsområde.
- **Ekonom:** fakturakörningar per månad och status, ärenden som saknar beställarreferens, veckor utan närvaro att kontrollera, ofakturerade veckor, Fortnox-synk.

### 7.1 Beställning via mejl – kommunens formella kanal

Enligt AFK 7.9 sker beställningar via mejl, och kommunen har inget eget inköpsordersystem. Mejlflödet är därför huvudvägen och Miljonmatch är beställningssystemet. Det ska fungera fullt ut i fas 1.

- **Inläsning:** avrop@miljonbemanning.se läses via Microsoft Graph med en egen appregistrering som bara får läsa just den brevlådan (applikationsbehörighet begränsad med Exchange Online RBAC för applikationer). Cron var 2–5 minut. Mejlet flyttas till mappen "Inläst" men ligger kvar som reserv. Körs i plattformen – inte på Mac mini/Miljonbot, eftersom flödet är kontraktskritiskt.
- **Tolkning:** mejl och bilagor sparas i en privat bucket. Word-mallen (01) tolkas deterministiskt via de fasta etiketterna i tabellcellerna. Fritextmejl och avvikande mallar tolkas med AI. Samma zod-schema som portalformuläret, med konfidens per fält.
- **Ordererkännande inom 5 minuter (automatiskt):**
  > Tack! Vi har tagit emot er beställning och gett den ärendenummer BOT-26-0042. Ni får besked om startdatum och ansvarig coach senast [datum och tid]. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.

  Saknas obligatoriska uppgifter – framför allt **beställarreferens (8–10 siffror)** eller avtalsområde – listas de i samma svar: "Svara på det här mejlet med …". Svaret innehåller aldrig personuppgifter.
- **Avropsinkorg:** originalet bredvid det tolkade formuläret, saknade fält markerade. Samordnaren rättar och väljer Acceptera eller Avböj (§7.4). Mål: under 2 minuter per avrop, eftersom volymen är 2–3 avrop per arbetsdag.
- **Kompletteringar:** svar på ordererkännandet kopplas automatiskt till rätt ärende via ärendenumret i ämnesraden.
- **Skyddade personuppgifter:** bara en generisk mottagningsbekräftelse, ingen automatik, flagga direkt till avtalsansvarig.
- **Övrigt:** mejl som inte är beställningar klassas "Övrigt" och lämnas till människa, kopplade till ärendet om ett ärendenummer nämns.
- SLA-klockan startar vid mejlets mottagningstid.

### 7.2 Beställning via portalen (för den som vill)

Samma tre steg som avropsmallen (01): **1) beställning och kontakt** (förifyllt med handläggarens namn, enhet, telefon, e-post och sparad beställarreferens; önskat startdatum, planerat slutdatum, planerad omfattning i veckor) · **2) deltagare** (namn, personnummer/samordningsnummer, telefon, e-post, bostadsort – fullständig adress bara om kallelse ska ske per brev – föredragen kontaktväg, skyddade personuppgifter, anpassningsbehov; mallens text om dataminimering visas vid fälten) · **3) avtalsområde** (primärt och alternativt A–L), önskat yrkesspår och bakgrund.

- **Beställarreferens** valideras direkt (8–10 siffror, bara siffror). Handläggarens senast använda referens förifylls.
- **Skyddade personuppgifter = ja:** bara namn, personnummer och handläggare sparas, och formuläret visar: "Ring oss på [nummer] så tar vi resten enligt den säkra rutinen."
- **Dubblettkontroll** på personnummer-hash inom avtalet. En person kan ha flera ärenden över tid, men inte två aktiva samtidigt.
- Ordererkännandet visas direkt på skärmen och skickas som mejl utan personuppgifter.

### 7.3 Ärendenummer = ordernummer och faktureringsobjekt

- Format `{prefix}-{ÅÅ}-{NNNN}`, t.ex. `BOT-26-0001`. Prefix per avtal, löpnummer per avtal och år.
- Genereras i samma databastransaktion som ärendet (radlås på `case_counters`). Återanvänds aldrig, innehåller inga personuppgifter.
- Ärendenumret är MB:s ordernummer och fakturans faktureringsobjekt. Det visas på alla rapporter och fakturor, och kommunen uppmuntras använda det i stället för personnummer.
- Word-mallen uppdateras: ärendenummerfältet får texten "Lämnas tomt – tilldelas av Miljonbemanning" och beställarreferens blir ett eget obligatoriskt fält.

### 7.4 Orderbekräftelse, första möte och kartläggning

- **Acceptera** (huvudcoach, team, startdatum) eller **Avböj** (orsak obligatorisk och loggad – obesvarade och frekvent avböjda avrop kan flytta ner MB i rangordningen). Senast en arbetsdag efter mottagandet.
- **Orderbekräftelse** i portalen och som notis: startdatum, huvudcoach, första mötet, planerad omfattning i veckor och beställningens värde (veckor × veckopris). Värdet används för upparbetat och återstående belopp på fakturan.
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

### 7.6 Närvaro och veckorapport

- Närvaro registreras per tillfälle: närvarande / sen / frånvaro giltig (orsak: sjukdom, vård av barn, myndighetsbesök, annat giltigt skäl) / frånvaro ogiltig. Inga detaljer utöver orsakskategorin.
- **Snabbregistrering:** dagens lista per coach eller lokal, ett klick per deltagare.
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

Statistik: "tydlig progression" = minst ett område på nivå 2 eller högre; "någon progression" = minst ett område på nivå 1 eller högre (konfigurerbart).

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
- **Nöjdhet** = andel 4–5 på fråga 1. Samma mått används senare för KK:s nöjdhetskrav.
- Deltagandet är frivilligt och påverkar ingenting i insatsen – det står i utskicket.

### 7.11 Rapporter och intyg

**Gemensamma regler:** byggs bara av godkända uppgifter. Livscykel: utkast → granskad av coach → (valfri kvalitetsgranskning av samordnare) → godkänd → levererad (tid, mottagare, kanal) → kvitterad (när mottagaren öppnat). Rättelse skapar ny version, den gamla sparas. PDF i MB:s grafiska profil. Leverans i portalen; mottagaren får en notis utan personuppgifter. Rapporter skickas bara som bilaga i vanlig e-post om kommunen skriftligt instruerat det (`reportDelivery`).

**a) Ordererkännande och orderbekräftelse** – §7.1 och §7.4.

**b) Veckorapport närvaro** – §7.6. En per handläggare och vecka, med en sektion per deltagare.

**c) Månadsrapport individ – mappning mot mall 02**

| Avsnitt | Källa |
|---|---|
| 1 Grunduppgifter | Ärendet. Deltagaren anges med namn och ärendenummer; personnummer skrivs inte ut (mallen tillåter "personnummer / ärendenummer") |
| 2 Närvaro och frånvaro | Närvaro per ISO-vecka i månaden, totalt och %, upprepad frånvaro, åtgärdsplan |
| 3 Genomförda aktiviteter | Kryss om minst en registrerad aktivitet av typen + dokumentationstext (AI-utkast i fas 2) |
| 4 Progression | Månadsbedömningen |
| 5 Resultat/utfall | Händelser under månaden |
| 6 Avvikelse, risk och åtgärd | Avvikelser. "Behöver beslut/stöd från kommunen?" skapar en notis och en uppgift hos handläggaren |
| 7 Plan för nästa månad | Månadsplanen (AI-utkast från senaste avstämningen i fas 2) |
| 8 Coachens sammanfattande bedömning | Samlad status (coachens val), kort sammanfattning (AI-utkast, coachen godkänner), ansvarig coach och datum, rapporteringsprincipen som fast text |

Påminnelser: coach 3 arbetsdagar före förfall, samordnare 1 dag före, chef vid förfall (vitesrisk).

**d) Slutrapport** – vid avslut. Samma struktur plus hela perioden: resultat, kvarstående hinder och rekommenderad fortsättning. Rapportstatus "Slutrapport".

**e) Beställarrapport till kommunens chef (månadsvis)** – antal deltagare (aktiva, nya, avslutade) per avtalsområde och yrkesspår · resultat (antal och andel arbete/studier, rullande och sedan start, mot 32 %) · progression (andel med tydlig progression, fördelning per område) · närvarograd · antal avvikelser · nöjdhet (antal svar, andel 4–5) · kort sammanfattning (AI-utkast, godkänns av avtalsansvarig). **Det interna målet 35 % visas aldrig här.** SLA-statistik visas bara om ledningen beslutat det (`seesSlaStats`). Grupper med färre än 5 personer redovisas som "färre än 5".

**f) Intern ledningsvy** – allt i e) plus 35 %-målet, per coach och per bolag, prognos, SLA-uppfyllnad, ofakturerat, avtalsavvikelser och flaggor.

**g) Yrkeskompetensbevis/diplom** – PDF i MB:s profil med genomförda yrkesmoment och bedömda färdigheter, undertecknad av handledaren. Utfärdas vid avslut när momenten är godkända (fas 3).

**h) Statistik på begäran** – export för valfri period (högst två begäranden per år enligt avtalet, även ett år efter avtalsslut).

**i) Dataexport vid avtalsslut** – allt som tillhör kommunen exporteras inom en kalendermånad, därefter raderas det (med logg).

**j) Exportmallar per avtal** – t.ex. KK:s månatliga statistikfil. Byggs som konfigurerbara exporter, inte specialkod.

### 7.12 KPI:er och flaggor

- KPI-motorn läser `contracts.config.kpis`: nyckel, definition (täljare/nämnare), fönster (månad, rullande 3/6/12 månader, sedan start), avtalsmål, internt mål, minsta antal (minN) och vilka roller som ska aviseras.
- **Botkyrka – resultatgrad** = avslut med resultat / avslut som räknas enligt resultatdefinitionen, rullande 6 månader och sedan start.
  - Under 35 % → flagga "Bevaka" till chef och controller (i appen + veckosammanfattning via e-post).
  - Under 32 % → flagga "Åtgärd krävs" till chef, controller och avtalsansvarig direkt.
  - **Minsta antal:** flagga inte förrän minN (10 avslut) är uppnått i fönstret; visa antalet bredvid procenten. Med 40–60 avslut i månaden nås det snabbt, men en enskild vecka kan svänga kraftigt.
- Övriga Botkyrka-KPI:er: avrop besvarade i tid, första möte inom en vecka, veckorapporter i tid, månadsrapporter i tid, närvarograd, nöjdhet.
- **Prognos:** "om deltagarna med arbetserbjudande eller i fas 5 når resultat blir resultatgraden X %".
- Flaggor kvitteras med en kort åtgärdsplan. Samma mekanism används för KK:s tre kvalitetskrav.

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

**Fakturans utformning (Botkyrkas villkor):**

- **En faktura per ärende och månad.** Samlingsfakturor accepteras inte om det inte särskilt avtalats. Med 70–100 årsplatser blir det ungefär 100–150 fakturor i månaden – därför är Fortnox-API:t ett måste tidigt. Samlingsfaktura per beställarreferens kan slås på i konfigurationen om kommunen skriftligt godkänner det.
- **Beställarreferens:** kommunens referens på 8–10 siffror krävs, eftersom köpet sker utanför kommunens e-handelssystem. MB kan inte hitta på den – den kommer från beställningen (§7.1–7.2). Utan giltig referens kan ingen faktura skapas. Den ska hamna i Peppol-fältet för köparens referens (BuyerReference).
- **Inköpsordernummer:** bara om kommunen någon gång beställer via Proceedo (nio siffror som börjar med 99). Fältet för köparens ordernummer (OrderReference) lämnas annars tomt – MB:s egna nummer får aldrig ligga där.
- **Faktureringsobjekt:** ärendenumret, i fakturatexten och på varje rad.
- **Upparbetat och återstående:** i fakturatexten, t.ex. "Beställning BOT-26-0042: planerat 10 veckor, 16 680 kr. Fakturerat inklusive denna faktura: 6 veckor, 10 008 kr. Återstår: 4 veckor, 6 672 kr."
- **Rader:** artikel per avtalsområde, antal veckor, beskrivning "BOT-26-0042 · v. 40–43 2026". Inga namn eller personnummer.
- **Periodiska fakturor hålls isär** från annan fakturering till kommunen (t.ex. bonus, §7.17).
- Bankgiro och övriga obligatoriska uppgifter hämtas från Fortnox.

**Flöde:**

1. Efter månadsskiftet räknar systemet fram underlaget per ärende. Ekonomen granskar avvikelser (saknad beställarreferens, veckor utan närvaro, överlappande ärenden, fler än 5 veckor i månaden, ändring mot förra månaden) och godkänner.
2. **Fortnox API** (fas 2): OAuth 2.0 authorization code flow, tokens krypterade. Fakturor skapas som ej bokförda utkast. Respektera Fortnox hastighetsgräns (25 anrop per 5 sekunder) och använd en idempotensnyckel så att en omkörning aldrig skapar dubbletter.
3. **Verifiera fältmappningen innan skarp drift:** skicka en testfaktura och kontrollera med Botkyrkas e-handel (e-handel@botkyrka.se) att beställarreferensen hamnar i BuyerReference och att OrderReference är tomt. I Fortnox motsvarar det normalt "Er referens" respektive "Ert ordernummer", men det ska bekräftas.
4. Ekonomen bokför och skickar i Fortnox, som distribuerar Peppol-fakturan (kräver Fortnox e-fakturatjänst och Botkyrkas Peppol-id). Plattformen hämtar status tillbaka: skapad → bokförd → skickad → betald.
5. **Reservvägar:** Excel-export av underlaget + PDF-specifikation för manuell registrering i Fortnox, eller kommunens kostnadsfria fakturaportal. Knappen "Markera som manuellt fakturerad" sparar fakturanumret.
6. **Bevakning:** varning när en debiterbar vecka är äldre än 45 dagar utan faktura (preskription två månader efter utfört arbete).

**E-handel:** e-handelsbilagan kräver att formerna är överenskomna inom tre månader. Be Botkyrka bekräfta skriftligt att mejlbeställning + beställarreferens + Peppol-faktura är den överenskomna formen (§13), så att det inte kan tolkas som en avvikelse. Fältet för inköpsordernummer finns kvar om Proceedo-order införs senare.

Licenser att kontrollera: Fortnox Integration (om den inte ingår i ert paket) och Fortnox e-faktura.

### 7.16 Avtalsavvikelser, varningar och kvalitetsärenden

- Register (`contract_deviations`) för avvikelser som kommunen påtalar eller som MB själv upptäcker: typ (kvalitet, process, avtal, ekonomi), nivå (mindre, större, allvarlig), beskrivning, datum, åtgärdsplan med tidsplan, kommunens godkännande av planen, skriftliga varningar (räknas mot tre), vite och eventuell avräkning på faktura, avropsstopp.
- Klagomål och reklamationer från deltagare, arbetsgivare eller kommun registreras i samma register (typ "klagomål") – det stödjer avtalets krav på dokumenterat kvalitetsarbete.
- Månadssammanställning för APT/kvalitetsmöte: nya och öppna ärenden, åtgärder och lärdomar.
- Chefsvyn visar antal varningar och öppna åtgärdsplaner med förfallodatum.

### 7.17 Bonusanspråk (fas 3)

- När arbete påbörjas i anslutning till genomförd insats (verifierat), eller progression når nivån i incitamentsmodellen, skapas ett förslag till bonusanspråk med redovisningsunderlag (verifiering och relevanta rapportutdrag).
- Anspråket skickas till kommunen i portalen, som godkänner eller avslår – kommunen avgör om en anställning är sammanhållen.
- Godkänt anspråk ger en separat bonusfaktura, åtskild från periodfakturorna.
- Reglerna läggs i `contracts.config.bonus` när incitamentsmodellen är fastställd (§13). Tills dess är funktionen avstängd, men underlaget samlas in från dag 1.

---

## 8. AI-stöd: transkribering och textutkast

### 8.1 Principer

1. **AI dokumenterar – människan bedömer.** AI får transkribera, sammanfatta, föreslå text och peka ut belägg. AI får aldrig sätta progressionsnivå, samlad status, avslutsorsak, resultat eller fatta beslut om en deltagare. Bedömningsfält är tomma tills coachen valt.
2. **Kommunen har godkänt inspelning (2026-09-29) – deltagaren måste ändå säga ja.** Godkännandet dokumenteras som instruktion i PUB-avtalet. Varje deltagare informeras på lättläst svenska (med översättning vid behov) och samtycket registreras (textversion, datum, vem som informerade). Det kan återkallas när som helst. Den manuella vägen är fullt likvärdig och ett nej får inga konsekvenser.
3. **Inte för skyddade ärenden.** Coachen kan pausa eller stoppa inspelningen när samtalet går in på sådant som inte behövs för uppdraget.
4. **Dataminimering.** Ljud raderas direkt efter lyckad transkribering (senast 24 h vid fel). Råtranskript raderas när avstämningen godkänts, senast efter 30 dagar. Kvar blir bara godkända, strukturerade uppgifter enligt avtalets gallringsregler.
5. **Bara Sverige/EU.** Avtalet förbjuder behandling utanför EU/EES utan kommunens särskilda skriftliga förhandsgodkännande. Leverantören ska ha personuppgiftsbiträdesavtal, inte träna på datan och inte lagra den.
6. **Öppenhet.** Synlig inspelningsindikator. Utkast märks "AI-utkast" tills de godkänts. Varje godkännande loggas med vem och när.
7. **AI Act.** Högriskkraven för bilaga III gäller från 2027-12-02 – mitt i KK-avtalet. Med designen ovan är AI ett förberedande dokumentationsstöd där människan gör bedömningen, men klassningen ska dokumenteras. Byggs en deltagarassistent senare ("Jason" på Miljonmatch-bilden) ska deltagaren få veta att hen talar med en AI.

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

### 8.5 Mätning – siffran KK-kalkylen behöver

Per avstämning mäts minuter från mötets slut till godkänd dokumentation, andel förslag som accepteras, ändras eller avvisas per fält, och antal "felaktigt förslag"-rapporter från coacher. Baslinjen mäts i fas 1 utan AI. Den uppmätta tidsvinsten per möte är det värde som ska in i KK:s kapacitetsmodell per rådgivare.

### 8.6 Kostnad

| Alternativ | Per 30-min samtal | Per månad (≈ 433 samtal) | Kommentar |
|---|---|---|---|
| A: Berget – KB-Whisper + öppen språkmodell | ≈ 1 kr | ≈ 450–500 kr | Data stannar i Sverige |
| B: Gemini 3.8 Flash, EU-endpoint, introduktionspris t.o.m. 2026-12-31 | ≈ 0,85 kr | ≈ 370 kr | 10 % EU-påslag inräknat |
| B: samma från 2027-01-01 | ≈ 1,70 kr | ≈ 740 kr | Googles ordinarie pris |
| Rapportutkast och mejltolkning | – | < 100 kr | Oavsett leverantör |

Antaganden: 100 deltagare × en avstämning per vecka × 52/12 ≈ 433 samtal/månad; ljud räknas som 32 token per sekund (57 600 token per 30 minuter); cirka 10 000 utdatatoken per samtal (transkript + JSON); 1 USD ≈ 9,6 kr och 1 EUR ≈ 11 kr. I praktiken blir det lägre eftersom inte alla samtal spelas in. Ett KK-möte på 60 minuter kostar ungefär 2–3,50 kr.

Fasta driftkostnader för piloten, ungefärligt: Supabase Pro ca 25 USD/månad inklusive 10 USD compute-kredit (större databas och point-in-time-återställning, ca 100 USD/månad, inför KK) · Vercel Pro 20 USD per utvecklarplats · Fortnox Integration-licens från ca 189 kr/månad om den inte ingår i ert paket, plus e-fakturatjänsten · SMS per meddelande. Totalt ungefär 1 000–1 500 kr/månad.

---

## 9. Notiser: e-post och SMS

- Avsändare på huvuddomänen, t.ex. `notis@miljonbemanning.se`. **En domän får bara ha en SPF-post** – lägg till leverantörens include i den befintliga M365-posten i stället för att skapa en ny. DKIM och DMARC konfigureras.
- Ordererkännanden och andra svar på mejlbeställningar skickas från avrop@ (via Graph) så att tråden hålls ihop hos kommunen.
- E-postleverantör för övriga notiser: EU-baserad transaktionell tjänst med SMTP (behövs för Supabase Auth). Alternativ: Graph sendMail från en egen brevlåda i M365.
- SMS: svensk SMS-leverantör via API. Minimalt innehåll: "Påminnelse: möte i morgon kl. 10.00 hos Miljonbemanning i Alby. Frågor? Ring [nummer]."
- Alla mallar redigeras i adminvyn och versioneras. Innehåller aldrig personuppgifter utöver ärendenummer.

---

## 10. Säkerhet och dataskydd

- **Roll per avtal.** Botkyrka: MB är personuppgiftsbiträde (avtalet punkt 8.1); PUB-avtal enligt SKR:s mall styr instruktioner, underbiträden, gallring och incidentrapportering till kommunen. KK: MB bär personuppgiftsansvar (obegränsat GDPR-ansvar enligt avtalet) och behöver egen konsekvensbedömning och registerförteckning.
- **Skriftligt godkännande.** Botkyrkas besked om inspelning och underbiträden ska in i PUB-avtalets bilagor. Vercel och Supabase är amerikanska bolag trots drift i Stockholm – be om ett uttryckligt godkännande även av eventuell åtkomst från tredje land (t.ex. leverantörens support), eftersom avtalet kräver särskilt skriftligt förhandsgodkännande för det.
- **Konsekvensbedömning** för AI-delen dokumenteras (kommunen som personuppgiftsansvarig; MB bidrar med underlag).
- **Behörighet:** RLS enligt §4, need-to-know. Ekonom ser inga anteckningar. Handledare ser bara tilldelade ärenden.
- **Kryptering:** TLS överallt; personnummer krypteras på applikationsnivå; hemligheter i miljövariabler; Supabase krypterar lagrad data.
- **Revisionslogg** och månatlig loggkontroll (stickprov) av chef.
- **Skyddade personuppgifter:** se CLAUDE.md punkt 8.
- **Säkerhetskopior:** Supabase dagliga säkerhetskopior i piloten; point-in-time-återställning inför KK. Återläsning testas minst en gång före produktion.
- **Gallring:** automatiska jobb enligt avtalets regler, med logg över vad som raderats. Vid avtalsslut: export till kommunen inom en kalendermånad, därefter radering (§7.11 i).
- **Informationssäkerhetsrutiner** (avtalet punkt 6.3): policy, utbildning av personal, skydd mot skadlig kod och incidenthantering ska finnas dokumenterade. Plattformen bidrar med behörighetsstyrning, logg och incidentrutin; för Botkyrka meddelas kommunen enligt PUB-avtalet.
- **Informationstexter** till deltagare på lättläst svenska och de vanligaste språken.
- **Tillgänglighet:** WCAG 2.1 AA.
- **Säkerhetsgranskning/penetrationstest** före KK-start.

---

## 11. Hosting, domän, repo och miljöer

- **Repo:** `miljonmatch`, privat, under Miljonbemannings organisation på GitHub (inte ett personligt konto).
- **Domän (beslut 2026-10-01):** appen körs på MB:s produktdomän **miljonmatch.se** (DNS hos one.com). Den gamla webbsidan på miljonmatch.se/www ersätts av appen; `www.miljonmatch.se` skickas vidare till `miljonmatch.se`. Just nu är det testmiljön (bara påhittade testdata) som ligger där; när produktionen startar flyttar testmiljön till `test.miljonmatch.se` och produktionen tar över `miljonmatch.se` i ett eget Vercel- och Supabase-projekt. **E-post skickas från `notis@miljonbemanning.se`** (via Resend, verifierad 2026-09-30) – kommunen känner igen avsändaren från avrop@, och miljonmatch.se har null-MX (tar inte emot e-post). DNS för miljonbemanning.se ligger i Google Cloud DNS och styrs av Terraform – Resend-posterna där ska in i Terraform-koden. `portal.miljonbemanning.se` är upptagen (CNAME till Office 365). Använd inte miljon.io för kommunvända tjänster.
- **Konton** (GitHub, Vercel, Supabase, AI-leverantör, SMS, e-post, Fortnox-utvecklarkonto) ägs av Miljonbemanning AB via funktionsadress, minst två administratörer, MFA överallt och fakturering på bolaget – PUB- och underbiträdesavtal tecknas av bolaget.
- **Miljöer:** produktion + staging (separata Supabase-projekt, båda i Stockholm). Staging har bara testdata. Preview-deployer pekar aldrig mot produktionsdatabasen.
- **Övervakning:** drifttidskontroll och felrapportering utan personuppgifter. Används ett externt verktyg (t.ex. Sentry i EU-region) läggs det till i underbiträdesförteckningen.
- **Portabilitet:** standard-Postgres + Next.js utan Vercel-specifika lagringstjänster. Supabase är öppen källkod, så databasen kan flyttas till svensk drift om kommunen eller KK kräver det.

---

## 12. Faser och acceptanskriterier

### Fas 0 – Förberedelser (nu, parallellt med bygget)

- [ ] Botkyrkas godkännande av inspelning och underbiträden skriftligt i PUB-avtalets bilagor, inklusive eventuell åtkomst från tredje land.
- [ ] Svar från Botkyrka om beställarreferensen (§13 punkt 3) och skriftlig bekräftelse att mejlbeställning + beställarreferens + Peppol-faktura uppfyller e-handelsbilagan.
- [ ] Besked om en faktura per deltagare och månad eller skriftligt godkänd samlingsfaktura.
- [ ] Word-mallarna uppdaterade: beställarreferens (8–10 siffror) som obligatoriskt fält, "Lämnas tomt – tilldelas av Miljonbemanning" i ärendenummerfältet, rubriken "4." och området språk i månadsrapporten, MB:s grafiska profil (mallarna har i dag petrolblå rubrikrader och Office-standardtypsnitt).
- [ ] Repo, konton och regioner uppsatta (Supabase Stockholm, Vercel arn1).

### Fas 1 – Leverera avtalet

Auth och roller, avtalskonfiguration, mejlbeställning och portal, ärendenummer, ordererkännande och orderbekräftelse, kartläggning, närvaro och veckorapport, veckoavstämning, månadsbedömning, utfall, avvikelser, månads- och slutrapport, fakturaunderlag, deadline-vy, revisionslogg.

- [ ] Ett mejl till avrop@ med ifylld Word-mall blir ett ärende utan manuell inmatning; ett fritextmejl tolkas med AI; ordererkännande med ärendenummer skickas inom 5 minuter och saknade uppgifter efterfrågas automatiskt.
- [ ] Samordnaren accepterar eller avböjer ett avrop på under 2 minuter; SLA-klockan (en arbetsdag, svenska helgdagar) syns och eskalerar.
- [ ] Ett ärende kan inte bekräftas utan giltig beställarreferens (8–10 siffror).
- [ ] En kommunanvändare loggar in med e-postkod, kan beställa i portalen och läsa rapporter, och ser bara sina ärenden (RLS-test).
- [ ] Ärenden utan bokat första möte flaggas efter tre dagar; möten som ligger mer än 7 dagar efter avropet markeras.
- [ ] Kartläggningen kan registreras och godkännas vecka 1.
- [ ] Coachen registrerar dagens närvaro på under en minut; veckorapporten per handläggare publiceras automatiskt senast måndag 16:00, och saknad registrering eskaleras 10:00.
- [ ] Veckoavstämning med rullgardiner; röd status skapar en avvikelse som kräver åtgärd.
- [ ] Månadsbedömningen kan inte godkännas om observation saknas vid nivå 1 eller högre.
- [ ] Månads- och slutrapport-PDF följer mall 02 (avsnitt 1–8), MB:s profil, och byggs bara av godkända uppgifter.
- [ ] Fakturaunderlag per ärende och månad enligt §7.15, med Excel/PDF-export; veckor utan närvaro markeras för kontroll.
- [ ] Revisionslogg vid visning av deltagarkort och rapporter; deadline-vyn visar allt som förfaller inom 7 dagar; baslinje för dokumentationstid mäts.

### Fas 2 – AI och automatisk fakturering

- [ ] Inspelning kan bara startas om deltagarens samtycke finns registrerat; samtycke kan återkallas.
- [ ] Ljudfilen raderas automatiskt efter transkribering (verifierat i test).
- [ ] Förslag visas med belägg; bedömningsfält är tomma tills coachen valt.
- [ ] AI-utkast till observationer, aktivitetsdokumentation, plan och sammanfattning från godkända uppgifter, med källhänvisning.
- [ ] A/B-jämförelsen mellan leverantörerna är dokumenterad; tidsvinst och acceptansgrad visas per månad.
- [ ] Fortnox-API: en faktura per ärende och månad med beställarreferens, ärendenummer som faktureringsobjekt och upparbetat/återstående belopp; testfakturan är verifierad med Botkyrkas e-handel; omkörning skapar inga dubbletter; status synkas tillbaka.
- [ ] Pulsmätning vid vecka 2 och vid avslut; aggregat först vid 5 svar.
- [ ] Resultatflaggor under 35 % och 32 % till rätt roller; minN respekteras; beställarrapporten genereras månadsvis utan internt mål.
- [ ] Register för avtalsavvikelser, åtgärdsplaner, varningar och klagomål.

### Fas 3 – Mervärde

- [ ] Bonusanspråk med redovisningsunderlag, kommunens beslut i portalen och separata bonusfakturor.
- [ ] Yrkeskompetensbevis/diplom som PDF.
- [ ] Arbetsgivarregister och praktikplatser med de fyra rätten.
- [ ] Statistik på begäran och fullständig dataexport + radering vid avtalsslut.

### Fas 4 – KK-redo (före 2027-03-13)

- [ ] KK-avtalet kan konfigureras utan kodändring i kärnflödena: paket-, månads- och styckpriser, KPI:er 60/80/70 %, SLA 5/10 dagar, mötesminimum.
- [ ] Kapacitetsvy per rådgivare (aktiva ärenden mot tak).
- [ ] Månatlig statistikexport i KK:s format.
- [ ] Yttrande (CSN) som dokumenttyp med deadline och "i tid"-KPI.
- [ ] Synlighetspolicy: beställaren ser statistik men inte coachanteckningar.
- [ ] Deltagarinloggning och bokning, säkerhetsgranskning, point-in-time-återställning.

---

## 13. Öppna frågor

| # | Fråga | Svarar | Status |
|---|---|---|---|
| 1 | Inspelning och underbiträden | Botkyrka | **Godkänt 2026-09-29**, utökat 2026-09-30 till kommunens handläggare och deltagare – ska in skriftligt i PUB-avtalet, inklusive eventuell åtkomst från tredje land (Google/Vertex AI) |
| 2 | Inköpsordersystem | Botkyrka | **Besvarad:** kommunen har inget – Miljonmatch är beställningssystemet |
| 3 | Vilken beställarreferens (8–10 siffror) ska stå på fakturorna – en per handläggare, per enhet eller en för hela avtalet? Bekräfta skriftligt att mejlbeställning + beställarreferens + Peppol uppfyller e-handelsbilagan | Botkyrka (e-handel@botkyrka.se) | Öppen – **blockerar fakturering** |
| 4 | Debiterbar vecka | Botkyrka | **Besvarad:** alla veckor deltagaren är inskriven. Tolkning: delvisa start- och slutveckor räknas, pausade veckor räknas inte |
| 5 | En faktura per deltagare och månad, eller skriftligt godkänd samlingsfaktura per beställarreferens? | Botkyrka | Öppen |
| 6 | Resultatdefinition: vilka anställningar och studier räknas (omfattning, varaktighet, subventionerade anställningar), när mäts det, vilka avslut exkluderas? | Botkyrka | Öppen – blockerar resultatflaggor |
| 7 | Vill kommunen ha frånvaronotis samma dag, utöver veckorapporten? | Botkyrka | Öppen |
| 8 | Deadline för månads- och slutrapport; räcker portalen som kanal eller krävs e-post? | Botkyrka | Öppen |
| 9 | Räcker e-postkod som inloggning för kommunens personal? Ska handläggare se hela enhetens ärenden? | Botkyrka (IT) | Öppen |
| 10 | Vad är den "avtalade säkra rutinen" för skyddade personuppgifter? | Botkyrka | Öppen |
| 11 | Gallring under avtalstiden (vid avtalsslut gäller återlämning inom en månad) | Botkyrka | Öppen |
| 12 | Progressionsområden: räcker tillägget språk, eller vill kommunen också följa hälsa och livskvalitet (AFK 7.8)? | Botkyrka + MB | Öppen |
| 13 | Incitamentsmodell: vilken modell gäller och när kan bonus begäras? | Botkyrka + MB | Öppen |
| 14 | Beställarrapportens innehåll och frekvens | Botkyrka | Öppen |
| 15 | Ingår Fortnox Integration och e-faktura i ert paket? Vem godkänner API-kopplingen? | MB ekonomi | Öppen |
| 16 | Vem är systemägare, och vem sköter Terraform-koden för DNS (Google Cloud DNS)? | MB | Öppen – Resend-posterna är inlagda 2026-09-30 och behöver in i Terraform |
| 17 | Ska SLA-statistik visas för kommunen? | MB ledning | Öppen |
| 18 | Val av SMS- och e-postleverantör | MB | Öppen |

---

## 14. Kammarkollegiet – vad piloten ska bevisa

| KK-krav | Mekanism i plattformen | Prövas i piloten |
|---|---|---|
| Rang 1 av 5 i kaskad – beställningar ni inte tar går permanent vidare | Kapacitetsvy per rådgivare och varning innan kapaciteten tar slut | Delvis (Botkyrka har samma logik med två leverantörer per område) |
| Tunn marginal: break-even ca 67 ärenden, tak ca 72 per rådgivare | Mätning av dokumentationstid per möte (§8.5) | Ja – huvudsyftet med AI-delen |
| Första kontakt ≤ 5 dagar, första möte ≤ 10 dagar | SLA-motorn (§7.13) | Ja (Botkyrkas en arbetsdag / en vecka) |
| Mötesminimum (≥ 4 möten à ≥ 60 min under 4 månader; ≥ 1 möte/månad i förlängt stöd) | Mötesloggning med längd + prognos per ärende | Delvis |
| Kvalitetströsklar 60 % placering, 80 % yttranden i tid, 70 % nöjdhet – miss utan godkänd åtgärdsplan ger rang 3 | KPI-motor, flaggor, åtgärdsplan (§7.12, §7.16) | Ja (32/35 %) |
| Månadsstatistik, 8 fält per kund till KK:s e-tjänst; vite 25 000 kr/vecka vid brister | Exportmallar per avtal | Nej – fas 4 |
| CSN-yttranden | Dokumenttyp med deadline | Nej – fas 4 |
| Paket-, månads- och styckpriser | `price_items.unit` | Modellen, med Botkyrkas veckopris |
| Rikstäckande, rådgivare på distans | Teams-transkript som ljudkälla | Delvis |
| KK gör intag och kartläggning | Import av KK:s beställning (format ej känt) | Mejl- och portalbeställningen prövas |
| Personuppgiftsansvar med obegränsat GDPR-ansvar | Egen konsekvensbedömning, loggkontroll | Rutinerna |
| Nöjdhet ≥ 70 % | Pulsmätningen (§7.10) | Ja |

---

## 15. Avvägningar och vad som omprövas vid KK-skala

- **Vercel + Supabase eller svensk drift:** snabbast att bygga och välkänt för Claude Code, data i Stockholm – men leverantörerna är amerikanska. Mildras med regionlåsning, skriftligt godkännande och portabilitet (§11). Omprövas om Botkyrka eller KK kräver svenskägd drift.
- **Deterministisk tolkning av Word-mallen före AI:** färre fel och ingen AI på beställningar i normalfallet.
- **En faktura per ärende:** fler fakturor men enligt kommunens villkor; blir billigt med API. Omprövas om kommunen godkänner samlingsfaktura.
- **En app för alla roller:** enklare drift och säkerhet. Omprövas om en beställare kräver egen domän eller egen inloggning (SSO).
- **Jobb i Postgres-tabell:** räcker för pilotens volymer. Vid KK-volym (tusentals möten i månaden) – dedikerad kö och separat worker.
- **PDF i serverfunktion:** räcker nu; vid KK-volym genereras rapporter i batch nattetid.
- **Omprövas inför KK:** databasstorlek och point-in-time-återställning, BankID, rumsbokning i 71 regioner, API för beställare, lasttest och penetrationstest.

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
