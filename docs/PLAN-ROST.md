# Röstinspelning och transkribering – plan

*Utifrån Alis återkoppling 2026-09-30. Bygger på SPEC §8 (AI-stöd, fas 2). Väntar på beslut – se sist.*

## Önskemålet

1. **Våra coacher** spelar in samtalet med deltagaren medan det pågår och får allt transkriberat, dokumenterat och sammanställt till en rapport.
2. **Kommunens handläggare** kan tala in information direkt i systemet. Informationen blir skriftlig dokumentation och underlag.
3. **Deltagaren** kan tala in information som blir dokumentation och underlag.

## Det som redan finns

Punkt 1 är planerad i SPEC §8. Botkyrka har godkänt inspelning av avstämningar (2026-09-29). Prototypen visar redan flödet, men AI-delen är simulerad: "Spela in" i veckoavstämningen, AI-förslag med belägg, coachens godkännande, och AI-utkast i månadsbedömningen.

## Regler som styr utformningen (CLAUDE.md och SPEC §8)

- **Samtycke först.** Deltagarens samtycke registreras innan något spelas in och kan återkallas. Den manuella vägen är lika bra och ett nej får inga följder.
- **Aldrig för skyddade personuppgifter.**
- **Ljud raderas direkt efter transkriberingen** (senast efter 24 timmar vid fel). Råtranskriptet raderas när dokumentationen godkänts, senast efter 30 dagar.
- **AI föreslår – människan bedömer.** Nivåer, samlad status, avslutsorsak och resultat sätts aldrig av AI.
- **Rapporter byggs bara av godkända uppgifter**, aldrig direkt från ett transkript. En "färdig rapport" betyder alltså att AI skriver ett utkast från godkänd dokumentation och att coachen läser och godkänner det, gärna med ett klick.
- **Bara Sverige/EU.** Leverantören har personuppgiftsbiträdesavtal, tränar inte på datan och lagrar den inte.

## Förslag per användare

| | Hur det fungerar | Vad som sparas | Förutsättning |
|---|---|---|---|
| **1. Vår coach** | Spela in i veckoavstämningen (fysiskt möte), ladda upp en ljudfil eller hämta Teams-transkript. AI fyller i formuläret med belägg (citat + tidpunkt). Coachen ändrar och godkänner på under fem minuter. Varje månad skriver AI utkast till observationer, plan och sammanfattning från de godkända avstämningarna. Coachen godkänner, och sedan skapas månadsrapporten. | Godkända uppgifter. Ljud och råtranskript raderas enligt reglerna ovan. | Botkyrka har godkänt inspelning. AI-leverantör behöver väljas. |
| **2. Kommunens handläggare** | Knappen "Tala in" vid beställningens bakgrund och i meddelanden. Talet blir text i fältet, och handläggaren läser och rättar innan hon skickar. | Bara den text handläggaren skickar. Inget ljud sparas. | Behandlingen ska in i PUB-avtalets instruktioner (skriftligt OK från Botkyrka). |
| **3. Deltagaren** | En länk utan inloggning, som pulsmätningen, eller en knapp i deltagarens vy i fas 4. Deltagaren spelar in på sitt språk, och coachen får texten som ett underlag att granska. | Texten efter coachens granskning. Inget ljud sparas. | Botkyrkas godkännande, tillägg i konsekvensbedömningen, samtyckestext på lättläst svenska och översättningar som människor har granskat (engelska, arabiska, somaliska). Aldrig för skyddade ärenden. |

## Teknik

- **Inspelning:** i webbläsaren med MediaRecorder (cirka 7 MB per 30 minuter). Uppladdning i bitar till en privat bucket i Supabase Stockholm. Den lokala kopian raderas när uppladdningen är bekräftad. Inspelningsindikatorn syns hela tiden och inspelningen går att pausa.
- **AI-adaptern** `lib/ai` (SPEC §8.3) har tre steg: `transcribe` → `extract` (formulärets zod-schema med belägg) → `draft` (bara från godkända uppgifter). Allt körs som bakgrundsjobb. Varje körning sparas i `ai_runs` och varje beslut i `ai_field_decisions`.
- **Leverantör:** Berget AI (Sverige, KB-Whisper) eller Gemini via Vertex AI med EU-endpoint. Kostnaden är ungefär 1 kr per 30-minuterssamtal (SPEC §8.6). Leverantören väljs per avtal i konfigurationen.
- **Innan leverantören är vald:** testmiljön kan köra en *simulerad* leverantör. Då går hela flödet att testa live, med riktig inspelning, uppladdning, samtycke och radering, men transkriptet är påhittat.

## Beslut (2026-09-30)

1. **AI-leverantör: Gemini Flash via Google Cloud Vertex AI, EU multi-region-endpoint** (`aiplatform.eu.rep.googleapis.com`, location `eu`). Aldrig AI Studio-nyckel eller global endpoint (CLAUDE.md). Kräver ett Google Cloud-projekt med Vertex AI API påslaget, ett tjänstekonto med rollen *Vertex AI User* och Google Clouds personuppgiftsbiträdesvillkor (CDPA).
2. **Alla tre byggs nu.** Botkyrka har skriftligen godkänt inspelning för coacher, kommunens handläggare och deltagare inom projektet (SPEC §3.1). Varje del kan ändå slås av per avtal i konfigurationen.
3. **Byggs nu med simulerad leverantör** i testmiljön; Vertex AI kopplas in när kontot finns.
