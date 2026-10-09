# Resultatfil från Miljonmatch – fältbeskrivning

**Till:** Botkyrka kommun, avtal 332026110
**Från:** Miljonbemanning AB
**Gäller:** version 2 av resultatfilen (schemaversion 2) · bygger på utkastet inför mötet 1 oktober 2026

Alla exempel i det här dokumentet är påhittade.

> **Ändrat 2026-10-08 (version 2):** närvaron redovisas bara som antal veckor och närvarograd, precis som i månadsrapporten och
> slutrapporten. Kolumnerna `tillfallen_planerade`, `narvarande`, `sen_ankomst`, `franvaro_giltig`, `franvaro_ogiltig` och
> `ej_registrerade` finns inte längre i tabell 1. Övriga kolumner är oförändrade och har samma namn och ordning som förut.
> Filens version står på fliken Om filen och i fältbeskrivningen.
>
> **Ändrat 2026-10-07:** kommunen hämtar inte längre filen själv i portalen. Miljonbemanning tar fram filen för hela avtalet och
> lämnar den till er (avsnitt 2).

> För utvecklare: kolumnerna, beskrivningarna, möjliga värden och exemplen i tabellerna nedan kommer från kolumnregistret
> (`src/features/rapporter/export-columns.ts`, `exportColumns(cfg, areas)` med Botkyrkas konfiguration). Testet
> `src/features/rapporter/export-columns.test.ts` kontrollerar att varje kolumn i registret finns här med samma text –
> ändras registret måste dokumentet ändras i samma ändring (och tvärtom). Texterna i filen byggs av avtalets konfiguration.

---

## 1. Vad är resultatfilen?

Resultatfilen innehåller uppgifterna från månadsrapporterna som ni redan får i portalen, men i en form som går att räkna på.
Ni kan öppna den i Excel och göra egna sammanställningar, diagram och presentationer.

- Filen har **en rad per deltagare och månad**. Avsluten står dessutom i en egen tabell, en rad per avslutad insats
  (avsnitt 10).
- Bara **levererade** månads- och slutrapporter kommer med. Utkast och rapporter som inte är klara kommer aldrig med.
- Siffrorna är **desamma som i rapporten när den lämnades** till er. Hämtar ni filen igen senare får ni samma siffror för samma
  månad – om inte rapporten har rättats (se avsnitt 6).
- För rapporter som lämnades innan resultatfilen fanns kan uppgifterna om själva insatsen (avtalsområde, yrkesspår, datum och
  fas) visa hur de såg ut när filen skapades första gången, om de har ändrats efter att rapporten lämnades.

## 2. Hur får ni filen?

- **Miljonbemanning tar fram filen och lämnar den till er** (beslut 2026-10-07). Kommunen har bara handläggare i portalen, och
  sidan "Hämta resultat" finns inte längre.
- Filen gäller **hela avtalet** – alla deltagare, inte bara en enhet.
- Ni säger vilken period ni vill ha (högst 12 månader i taget) och vilken filtyp. Vi lämnar filen på det sätt vi kommer överens om
  – inte som bilaga i vanlig e-post (avsnitt 13).
- **Varje gång filen tas fram sparas det i Miljonbemannings logg**: vem, när, vilken period och hur många rader. Loggen innehåller
  inga namn eller ärendenummer på deltagare.

## 3. Två filtyper

| Filtyp | Innehåll | Passar för |
|---|---|---|
| **Excel** (rekommenderas) | En fil med fem flikar: Resultat, Progression, Händelser, Avslut och Om filen | Excel, presentationer |
| **CSV** | Fem separata filer: resultat, progression, händelser, avslut och fältbeskrivning | Statistikprogram, Power BI |

Filnamnen innehåller bara avtal och period, aldrig namn. Exempel: `resultat_bot_hela-avtalet_2026-10_2026-12.xlsx`.

## 4. Så läser du filen

- **Ärendenummer + månad** är nyckeln. Den är densamma i alla tabeller och över tid. Använd den om ni vill koppla ihop tabellerna
  eller filer från olika hämtningar.
- **Tom cell** betyder att uppgiften saknas eller inte är bedömd. **0** betyder noll. Exempel: en tom nivå betyder "inte bedömd",
  nivå 0 betyder "ingen progression / för tidigt att bedöma".
- **Ja och nej** skrivs som **1** och **0**, så att det går att summera.
- **Koder och text** står i par, till exempel `avtalsomrade_kod` = G och `avtalsomrade` = Lager och logistik. Räkna gärna på
  koden – den ändras inte.
- **Datum** skrivs ÅÅÅÅ-MM-DD och **månad** ÅÅÅÅ-MM. Decimaltal har decimalkomma i CSV-filen.
- **Kolumnnamnen** är skrivna utan å, ä och ö och ändras aldrig. Nya kolumner läggs bara till sist, så att era formler och
  rapporter fortsätter att fungera. Tas en kolumn bort (som närvaroantalen 2026-10-08) höjs filens version. Filens version står
  på fliken Om filen och i fältbeskrivningen.
- CSV-filen använder **semikolon** mellan kolumnerna och är sparad i UTF-8, så att å, ä och ö visas rätt i Excel.

## 5. Hur ofta uppdateras uppgifterna?

- En månad kommer med i filen när **månadsrapporten är levererad** till er i portalen. Säg till när ni vill ha en ny fil.
- Datumet för månadsrapporten är ännu inte bestämt i avtalet. Vårt förslag är senast den femte arbetsdagen i månaden efter.
- Avslutsorsak och resultat kommer med när **slutrapporten** är levererad. De står i tabell 4 (Avslut), en rad per avslutad
  insats. Finns det en levererad månadsrapport för den månad då insatsen avslutades står de också på den raden i tabell 1.
- Filen visar om resultatet är verifierat **så som det stod i slutrapporten**. Kommer underlaget (till exempel anställningsbeviset)
  efter att slutrapporten lämnats, rättar vi slutrapporten. När rättelsen är levererad syns verifieringen i en ny fil. Fram till
  dess kan resultatgraden som ni räknar fram ur filen vara lägre än i beställarrapporten, som räknar verifieringen direkt.

## 6. Rättelser

- Om vi rättar en månadsrapport skapas en ny version. Filen har alltid den **senast levererade** versionen.
- Så länge rättelsen inte är levererad har filen den gamla versionen, och kolumnen `rattelse_pagar` är **1**.
- När rättelsen är levererad har filen den nya versionen, och `rapport_version` är 2 (eller högre).
- Rättas slutrapporten syns det på samma sätt i tabell 4 (Avslut), med kolumnerna `rapport_version` och `rattelse_pagar`.
- En fil som ni redan har hämtat ändras inte. Hämta en ny fil för att få med rättelsen.

---

## 7. Tabell 1: Resultat (en rad per deltagare och månad)

I Excel: fliken **Resultat**. I CSV: filen som slutar på period, till exempel `resultat_bot_2026-10_2026-12.csv`.

### Deltagare och rapport

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `arendenummer` | Ärendenumret, samma som i beställningen och på fakturan | BOT-26-0001 | BOT-ÅÅ-löpnummer |
| `namn` | Deltagarens namn | Alex Exempelsson | Text |
| `manad` | Månaden som raden gäller | 2026-10 | ÅÅÅÅ-MM |
| `bestallare_enhet` | Enheten som beställde insatsen | Arbetsmarknadsenheten | Text |
| `rapport_version` | Månadsrapportens version | 1 | 1, 2, 3 … |
| `rapport_levererad` | Dagen då rapporten lämnades i portalen | 2026-11-06 | Datum |
| `rattelse_pagar` | En rättelse av rapporten är på väg | 0 | 1 = ja, 0 = nej |

### Insatsen (månadsrapporten avsnitt 1)

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `avtalsomrade_kod` | Avtalsområde | G | A–L |
| `avtalsomrade` | Avtalsområdets namn (utan bokstaven) | Lager och logistik | Text |
| `avtalsomrade2_kod` | Ett andra avtalsområde, om insatsen har det | | A–L eller tom |
| `yrkesspar` | Yrkesspåret | Truckförare A+B | Text |
| `insats_start` | Dagen då insatsen startade | 2026-09-21 | Datum |
| `insats_planerat_slut` | Planerat slutdatum | 2026-11-27 | Datum eller tom |
| `insats_slut` | Dagen då insatsen avslutades | | Datum eller tom (pågår) |
| `fas_nr` | Fasens nummer vid månadens slut | 3 | 1–5 |
| `fas` | Fasens namn | Yrkesspecifika moment | Kartläggning, Yrkesförberedande grund, Yrkesspecifika moment, Praktik (arbetsplatsförlagt lärande), Matchning och slutrapport |

### Närvaro (avsnitt 2)

Närvaron redovisas som antal veckor och närvarograd – inga antal per tillfälle (version 2, 2026-10-08).

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `veckor` | Antal veckor (måndag–söndag) som helt eller delvis ligger i månaden och då deltagaren var inskriven, veckor med uppehåll inräknade. En vecka som delas mellan två månader räknas i båda månaderna. Summera därför inte veckor över flera månader, och jämför inte med antalet veckor på fakturan | 5 | Heltal |
| `veckor_uppehall` | Antal av veckorna med uppehåll | 0 | Heltal |
| `narvaro_procent` | Andel av de registrerade tillfällena då deltagaren var på plats (i tid eller sent) | 88,9 | 0–100 med en decimal, tom om inget är registrerat |
| `upprepad_franvaro` | Upprepad ogiltig frånvaro enligt avtalets regel (två gånger inom 14 dagar) | 0 | 1 = ja, 0 = nej |

### Aktiviteter (avsnitt 3)

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `avstamningar_godkanda` | Godkända veckoavstämningar under månaden | 4 | Heltal |
| `arbetsgivarkontakter` | Arbetsgivarkontakter enligt de godkända veckoavstämningarna. Coachen svarar 0, 1 eller "2 eller fler" varje vecka, och svaret "2 eller fler" räknas som 2 – talet är alltså ett minsta antal. Det är inte samma sak som händelsen "Anställningsintervju eller konkret arbetsgivarkontakt" i tabell 3, som registreras en gång per kontakt | 3 | Heltal |
| `veckomal_uppnatt` | Veckor då veckomålet uppnåddes | 2 | Heltal |
| `veckomal_delvis` | Veckor då veckomålet uppnåddes delvis | 1 | Heltal |
| `veckomal_ej_uppnatt` | Veckor då veckomålet inte uppnåddes | 1 | Heltal |

### Progression (avsnitt 4)

Nivåerna kommer från coachens månadsbedömning. Skalan är **0** = ingen / för tidigt att bedöma, **1** = liten, **2** = tydlig,
**3** = uppnått delmål. Är månadsbedömningen inte godkänd är kolumnerna tomma.

`omraden_bedomda`, `progression_tydlig` och `progression_nagon` räknas bara på de tio områdena i tabellen nedan – inte på de
frivilliga områdena hälsa och livskvalitet, som inte finns i filen. Beställarrapporten räknar på samma sätt, så andelen med
tydlig eller någon progression som ni räknar fram ur filen stämmer med beställarrapportens.

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `bedomning_godkand` | Månadsbedömningen är godkänd | 1 | 1 = ja, 0 = nej |
| `omraden_bedomda` | Antal av de tio obligatoriska områdena (kolumnerna `niva_…` nedan) som har en nivå | 9 | 0–10 eller tom |
| `progression_tydlig` | Tydlig progression: minst ett av de tio områdena på nivå 2 eller högre | 1 | 1, 0 eller tom |
| `progression_nagon` | Någon progression: minst ett av de tio områdena på nivå 1 eller högre | 1 | 1, 0 eller tom |
| `niva_narvaro_rutiner` | Närvaro, punktlighet och rutiner | 2 | 0–3 eller tom |
| `niva_yrkesfardigheter` | Yrkesfärdigheter/praktisk förmåga | 2 | 0–3 eller tom |
| `niva_arbetskapacitet` | Arbetskapacitet och uthållighet | 1 | 0–3 eller tom |
| `niva_sjalvstandighet` | Självständighet och ansvarstagande | 1 | 0–3 eller tom |
| `niva_digital_sjalvstandighet` | Digital självständighet | 0 | 0–3 eller tom |
| `niva_instruktioner` | Förmåga att förstå och följa yrkesrelaterade instruktioner | 2 | 0–3 eller tom |
| `niva_arbetsgivarkontakter` | Arbetsgivarkontakter/nätverk | 1 | 0–3 eller tom |
| `niva_beredskap` | Beredskap för praktik, arbete eller studier | 1 | 0–3 eller tom |
| `niva_sprak_kommunikation` | Språk och kommunikation | 1 | 0–3 eller tom |
| `niva_ovrigt` | Övrig relevant progression | | 0–3 eller tom |

### Resultat och utfall (avsnitt 5)

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `handelser` | Antal registrerade händelser under månaden | 2 | Heltal |
| `handelser_verifierade` | Av dem: antal med underlag (till exempel anställningsbevis) | 1 | Heltal |
| `praktik_startad` | Praktik eller arbetsplatsförlagt moment startade under månaden | 1 | 1 = ja, 0 = nej |
| `arbete_paborjat` | Arbete påbörjades under månaden | 0 | 1 = ja, 0 = nej |
| `studier_paborjade` | Studier påbörjades eller deltagaren blev antagen | 0 | 1 = ja, 0 = nej |

### Avvikelse och samlad bedömning (avsnitt 6 och 8)

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `avvikelser_nya` | Avvikelser som registrerades under månaden | 0 | Heltal |
| `avvikelser_oppna` | Avvikelser som var öppna vid månadens slut | 0 | Heltal |
| `kommunens_beslut_behovs` | Någon avvikelse behöver beslut eller stöd från kommunen | 0 | 1 = ja, 0 = nej |
| `samlad_status_kod` | Coachens samlade status (kod) | green | green, yellow, red eller tom |
| `samlad_status` | Coachens samlade status | Grön | Grön, Gul, Röd eller tom |
| `bedomning_datum` | Dagen då månadsbedömningen godkändes | 2026-11-02 | Datum eller tom |

### Avslut och resultat (från slutrapporten)

Fylls bara i på raden för den månad då insatsen avslutades, och bara när slutrapporten är levererad. Övriga rader är tomma.
Slutar insatsen tidigt i en månad finns det ofta ingen månadsrapport för den månaden, och då finns det ingen sådan rad.
**Alla avslut finns i tabell 4 (Avslut) – räkna resultatgraden där.** Exemplen i den här tabellen gäller en annan rad än
exemplen ovan: en deltagare vars insats avslutades 2026-11-20 (raden för månaden 2026-11).

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `avslut_datum` | Dagen då insatsen avslutades | 2026-11-20 | Datum eller tom |
| `avslutsorsak_kod` | Avslutsorsak (kod) | arbete | arbete, studier, avbrott_flytt, avbrott_kommunens_beslut, avbrott_deltagarens_val, avbrott_ovriga_skal, planerat_utan_resultat |
| `avslutsorsak` | Avslutsorsak | Arbete | Arbete, Studier, Avbrott: flytt, Avbrott: kommunens beslut, Avbrott: deltagarens val, Avbrott: övriga skäl, Planerat avslut utan resultat |
| `resultat_kod` | Hur avslutet räknas (kod) | result | result, no_result, excluded |
| `resultat` | Hur avslutet räknas | Resultat | Resultat, Inget resultat, Räknas inte i resultatgraden |
| `resultat_verifierat` | Resultatet har underlag (till exempel anställningsbevis eller antagningsbesked) enligt slutrapporten | 1 | 1 = ja, 0 = nej |

**Obs!** Hur ett resultat ska räknas är ännu inte fastställt i avtalet. Kolumnerna `resultat_kod` och `resultat` följer det
preliminära förslaget: avslut till arbete och studier får `resultat_kod` = result, och avbrott på grund av flytt eller kommunens
beslut får excluded (räknas inte i resultatgraden). **Ett avslut med `resultat_kod` = result räknas som resultat i
resultatgraden först när `resultat_verifierat` = 1.** Se uppgiften som preliminär tills vi har kommit överens.

---

## 8. Tabell 2: Progression (en rad per område och månad)

Samma nivåer som i tabell 1, men i "lång form" – bra för diagram och pivottabeller. Bara månader med godkänd månadsbedömning.

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `arendenummer` | Ärendenumret | BOT-26-0001 | BOT-ÅÅ-löpnummer |
| `manad` | Månaden | 2026-10 | ÅÅÅÅ-MM |
| `omrade_kod` | Områdets kod | yrkesfardigheter | Se kolumnerna `niva_…` i tabell 1 |
| `omrade` | Områdets namn | Yrkesfärdigheter/praktisk förmåga | Text |
| `niva` | Nivån | 2 | 0–3 eller tom (inte bedömd) |
| `niva_text` | Nivån i ord | Tydlig | Ingen / för tidigt att bedöma, Liten, Tydlig, Uppnått delmål |

## 9. Tabell 3: Händelser (en rad per händelse)

Alla händelser från de levererade månadsrapporterna, avsnitt 5.

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `arendenummer` | Ärendenumret | BOT-26-0001 | BOT-ÅÅ-löpnummer |
| `manad` | Månaden | 2026-10 | ÅÅÅÅ-MM |
| `datum` | Dagen då det hände | 2026-10-14 | Datum |
| `handelse_kod` | Typ av händelse (kod) | intervju_arbetsgivarkontakt | praktik_startad, intervju_arbetsgivarkontakt, arbetserbjudande, arbete_paborjat, studier_paborjade, validering_uppnadd, annat_resultat, reell_kompetens, vagledning_validering, yrkesbevis |
| `handelse` | Typ av händelse | Anställningsintervju eller konkret arbetsgivarkontakt | Text |
| `verifierad` | Händelsen har underlag | 0 | 1 = ja, 0 = nej |

## 10. Tabell 4: Avslut (en rad per avslutad insats)

En rad per levererad slutrapport för de insatser som avslutades under perioden – också när det inte finns någon månadsrapport
för den månad då insatsen avslutades. Koderna och texterna är desamma som under "Avslut och resultat" i tabell 1. Räkna
resultatgraden på den här tabellen. Ett avslut med `resultat_kod` = result räknas som resultat först när `resultat_verifierat`
= 1 (se Obs! i avsnitt 7).

| Kolumn | Betydelse | Exempel | Möjliga värden |
|---|---|---|---|
| `arendenummer` | Ärendenumret | BOT-26-0001 | BOT-ÅÅ-löpnummer |
| `manad` | Månaden då insatsen avslutades | 2026-11 | ÅÅÅÅ-MM |
| `avslut_datum` | Dagen då insatsen avslutades | 2026-11-20 | Datum |
| `avslutsorsak_kod` | Avslutsorsak (kod) | arbete | arbete, studier, avbrott_flytt, avbrott_kommunens_beslut, avbrott_deltagarens_val, avbrott_ovriga_skal, planerat_utan_resultat |
| `avslutsorsak` | Avslutsorsak | Arbete | Arbete, Studier, Avbrott: flytt, Avbrott: kommunens beslut, Avbrott: deltagarens val, Avbrott: övriga skäl, Planerat avslut utan resultat |
| `resultat_kod` | Hur avslutet räknas (kod) | result | result, no_result, excluded |
| `resultat` | Hur avslutet räknas | Resultat | Resultat, Inget resultat, Räknas inte i resultatgraden |
| `resultat_verifierat` | Resultatet har underlag (till exempel anställningsbevis eller antagningsbesked) enligt slutrapporten | 1 | 1 = ja, 0 = nej |
| `rapport_version` | Slutrapportens version | 1 | 1, 2, 3 … |
| `rapport_levererad` | Dagen då slutrapporten lämnades i portalen | 2026-11-27 | Datum |
| `rattelse_pagar` | En rättelse av slutrapporten är på väg | 0 | 1 = ja, 0 = nej |

Tabellerna 2, 3 och 4 har inte deltagarens namn. Använd ärendenumret för att koppla ihop dem med tabell 1.

## 11. Fliken Om filen och fältbeskrivningen

I Excel finns fliken **Om filen** med avtal, period, när filen hämtades, filens version, antal rader per flik, reglerna i avsnitt
4–7 och en fältbeskrivning. I CSV finns fältbeskrivningen som en egen fil (`…_faltbeskrivning.csv`) med kolumnerna tabell,
kolumn, beskrivning, format, möjliga värden, källa och version (kolumnnamnen i filen: `tabell`, `kolumn`, `beskrivning`, `format`,
`mojliga_varden`, `kalla` och `schemaversion`). Källa anger var uppgiften kommer ifrån, till exempel
"Månadsrapporten, avsnitt 2" eller "Slutrapporten". Exemplen i det här dokumentet finns inte med i filens fältbeskrivning.

---

## 12. Det här finns inte med i filen – och varför

| Finns inte med | Varför |
|---|---|
| Personnummer | Behövs inte för att räkna. Ärendenumret räcker som nyckel. |
| Adress, telefon och e-post | Behövs inte för att räkna. |
| Fritext: coachens observationer, sammanfattning, plan, avvikelsetexter och kommentarer till händelser | Texterna kan innehålla känsliga uppgifter och går inte att räkna på. De finns i månadsrapporten i portalen. |
| Orsaker till frånvaro och antal tillfällen (närvaro, sen ankomst, giltig och ogiltig frånvaro) | Orsakerna kan röra hälsa. Sedan version 2 (2026-10-08) redovisas närvaron bara som veckor och närvarograd – som i månadsrapporten och slutrapporten. Om upprepad ogiltig frånvaro förekommit finns med (`upprepad_franvaro`). |
| Områdena "Hälsa (funktionellt beskrivet)" och "Livskvalitet (deltagarens egen skattning)" | De är frivilliga och kan röra hälsa. De finns i månadsrapporten när de är bedömda. |
| Rapporter som inte är levererade | Bara uppgifter som är granskade och lämnade till er kommer med. |
| Rapporter som har ersatts av en rättelse | Filen har bara den senast levererade versionen. |
| Sammanställningar per avtalsområde | De finns i beställarrapporten. Med filen kan ni göra egna. |

## 13. Att tänka på när ni sparar filen

- Filen innehåller **namn**. Spara den bara där kommunen får spara personuppgifter.
- Skicka den inte med vanlig e-post.
- Ta bort gamla filer när ni inte behöver dem längre. Ni kan alltid få en ny.

## 14. Frågor vi gärna stämmer av på mötet

1. Räcker kolumnerna för de presentationer och beräkningar ni vill göra? Saknas något?
2. Vill ni hellre ha Excel eller CSV, eller båda?
3. Hur vill ni att resultat ska räknas (avsnitt 7, "Avslut och resultat", och tabell 4 i avsnitt 10)?
4. Vilken dag i månaden ska månadsrapporten vara levererad?
5. Avtalet ger er "statistik på begäran" högst två gånger per år. Vårt förslag är att resultatfilen inte räknas dit, eftersom den
   är en del av den löpande uppföljningen. Delar ni den bedömningen?
