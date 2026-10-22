// Testscenarierna – exakt port av den gamla prototypens MM.scenarios() (prototyp/src/90-feedback.js), plus scenario s14
// "Röstinspelning" (nytt, beslut 2026-09-30) och sist s15 "Byt yrkesområde" och s16 "Fem nivåer och nivåaktiviteter" (Karims
// beslut 2026-10-22).
// Varje steg byter roll och öppnar en vy. Vyn anges som i den gamla prototypen (vy-id + parametrar) och översätts
// till sökväg med pathForView (src/demo/paths.ts). Ärenden refereras med taggar i testdatat (demo_tags),
// som slås upp med frågan demo.refs när steget öppnas – så att t.ex. Nadias januarirapport hittas även om den
// skapats under scenariot.
import type { Role } from "@/api/roles";
import { uniq } from "@/core/util";
import { perspectiveOf, type Perspective } from "@/api/roles";
import type { DemoRefs } from "./api";
import { pathForView, type ViewParams } from "./paths";

export type ScenarioStep = {
  role: Role;
  view: string;
  /** Parametrar som i den gamla prototypen. En funktion när de beror på testdatat (taggade ärenden, rapporter). */
  params: ViewParams | ((r: DemoRefs) => ViewParams);
  text: string;
};
export type Scenario = { id: string; title: string; lead: string; steps: ScenarioStep[] };

const sc = (r: DemoRefs, tag: string): string | undefined => r.cases[tag];
const aiDraftId = (r: DemoRefs): string | null => {
  const caseId = sc(r, "mehmet");
  return (caseId && r.aiDraftCheckIns[caseId]) || null;
};
const reportOf = (r: DemoRefs, tag: string, kind: string, month?: string): string | null =>
  r.reports.find((x) => x.caseId === sc(r, tag) && x.kind === kind && (!month || x.month === month))?.id ?? null;

export const SCENARIOS: readonly Scenario[] = [
  { id: "s1", title: "Från mejl till orderbekräftelse", lead: "Kommunens formella beställningskanal är mejl. Följ ett avrop från inkorgen till kommunens portal.", steps: [
    { role: "samordnare", view: "sam.inkorg", params: { emailId: "em-101" }, text: "Öppna avropsinkorgen. Mejlet från Maria Ekdahl kom 08.41 med Word-mallen. Det har redan fått ärendenummer och ett automatiskt ordererkännande." },
    { role: "samordnare", view: "sam.inkorg", params: { emailId: "em-101" }, text: "Jämför originalmejlet med det tolkade formuläret. Välj huvudcoach och första möte. Klicka Acceptera och se orderbekräftelsen." },
    { role: "kommun_handlaggare", view: "kom.deltagare", params: (r) => ({ caseId: sc(r, "inkorg-mall") }), text: "Byt till kundens perspektiv. Så här ser Maria ordererkännandet och orderbekräftelsen i portalen." },
  ] },
  { id: "s2", title: "Fritextmejl utan beställarreferens", lead: "AI tolkar fritext. Utan giltig beställarreferens kan ärendet inte bekräftas – och ingen faktura skapas.", steps: [
    { role: "samordnare", view: "sam.inkorg", params: { emailId: "em-102" }, text: "Öppna mejlet från Ahmed Yusuf (fredag 15.20). AI har tolkat texten. Titta på konfidensen per fält och de saknade uppgifterna." },
    { role: "samordnare", view: "sam.inkorg", params: { emailId: "em-102" }, text: "Försök acceptera. Det stoppas eftersom beställarreferensen (8–10 siffror) saknas." },
    { role: "samordnare", view: "sam.inkorg", params: { emailId: "em-103" }, text: "Öppna kompletteringen från i morse. Den kopplades automatiskt via ärendenumret i ämnesraden. För in uppgifterna och acceptera." },
    { role: "admin", view: "admin.mallar", params: { tab: "logg" }, text: "Se utskicksloggen: mejl och SMS innehåller bara ärendenummer och länk, aldrig personuppgifter." },
  ] },
  { id: "s3", title: "Kommunen beställer i portalen", lead: "För den som hellre beställer i portalen än via mejl. Skrivet för ovana användare: en sak per skärm.", steps: [
    { role: "kommun_handlaggare", view: "kom.login", params: {}, text: "Logga in med e-post och sexsiffrig engångskod (ingen magisk länk – Safe Links förbrukar dem)." },
    { role: "kommun_handlaggare", view: "kom.bestall", params: {}, text: "Beställ en ny insats i tre steg och granska innan du skickar. Testa gärna en felaktig beställarreferens och se hjälptexten." },
    { role: "kommun_handlaggare", view: "kom.bestall", params: {}, text: "Se ordererkännandet med ärendenummer direkt på skärmen." },
    { role: "samordnare", view: "sam.inkorg", params: { latest: true }, text: "Byt till leverantörens perspektiv. Den senaste beställningen ligger i inkorgen med SLA-klocka (en arbetsdag)." },
  ] },
  { id: "s4", title: "Coachens måndag och veckorapporten", lead: "Närvaro ska vara registrerad senast måndag 10.00. Veckorapporten publiceras när allt är klart.", steps: [
    { role: "coach", view: "coach.minvecka", params: {}, text: "Min vecka: några tillfällen från förra veckan saknar närvaro. Nedräkningen visar tiden till måndag 10.00." },
    { role: "coach", view: "coach.narvaro", params: { week: "last" }, text: "Registrera närvaron med ett klick per tillfälle. När alla tillfällen för en handläggares deltagare är klara publiceras veckorapporten automatiskt (Maria och Linda väntar)." },
    { role: "kommun_handlaggare", view: "kom.rapporter", params: {}, text: "Byt till kundens perspektiv och öppna veckorapporten för vecka 4." },
  ] },
  { id: "s5", title: "Röd status blir en avvikelse", lead: "Avvikelse = åtgärd. Röd status kräver åtgärd, ansvarig och uppföljningsdatum.", steps: [
    { role: "coach", view: "coach.avstamning", params: (r) => ({ caseId: sc(r, "yusuf") }), text: "Dokumentera mötet med Yusuf Abdi, som har upprepad ogiltig frånvaro." },
    { role: "coach", view: "coach.avstamning", params: (r) => ({ caseId: sc(r, "yusuf") }), text: "Välj samlad status Röd. Systemet kräver en avvikelse med åtgärd, ansvarig och uppföljningsdatum." },
    { role: "coach", view: "arende.kort", params: (r) => ({ caseId: sc(r, "yusuf"), tab: "avvikelser" }), text: "Klicka \"Kalla kommunen till uppföljning\"." },
    { role: "kommun_handlaggare", view: "kom.deltagare", params: (r) => ({ caseId: sc(r, "yusuf") }), text: "Byt till kundens perspektiv och se mötesförfrågan som ett säkert meddelande." },
  ] },
  { id: "s6", title: "AI-stöd: granska ett utkast", lead: "Byggs i fas 2. AI föreslår – coachen bedömer. Belägg med citat och tidpunkt.", steps: [
    { role: "coach", view: "coach.avstamning", params: (r) => ({ caseId: sc(r, "mehmet"), checkInId: aiDraftId(r) }), text: "Öppna AI-utkastet från Mehmet Kayas möte i fredags." },
    { role: "coach", view: "coach.avstamning", params: (r) => ({ caseId: sc(r, "mehmet"), checkInId: aiDraftId(r) }), text: "Visa beläggen. Samlad status är tom – den väljer du själv. Acceptera, ändra eller avvisa varje förslag." },
    { role: "coach", view: "coach.avstamning", params: (r) => ({ caseId: sc(r, "mehmet"), checkInId: aiDraftId(r) }), text: "Godkänn. Råtranskriptet raderas och varje beslut loggas." },
  ] },
  { id: "s7", title: "Månadsbedömning till kommunen", lead: "Progression per område enligt mall 02. Rapporten byggs bara av godkända uppgifter.", steps: [
    { role: "coach", view: "coach.manad", params: (r) => ({ caseId: sc(r, "nadia"), month: "2027-01" }), text: "Öppna januaribedömningen för Nadia Warsame. Allt är ifyllt automatiskt: progressionsnivå 0 där inget belägg finns, AI-förslag med citat och källa, samlad status från senaste mötesrapporten, sammanfattning och plan." },
    { role: "coach", view: "coach.manad", params: (r) => ({ caseId: sc(r, "nadia"), month: "2027-01" }), text: "Godta AI-förslagen som stämmer (eller Godta alla) och ändra det som inte stämmer. Utan konkret observation från progressionsnivå 1 stoppas godkännandet – mallen kräver belägg. Kryssa i Jag har gått igenom bedömningen och godkänn." },
    { role: "coach", view: "rapport.visa", params: (r) => ({ reportId: reportOf(r, "nadia", "monthly", "2027-01") }), text: "Förhandsgranska månadsrapporten (avsnitt 1–8). Den bygger bara på godkända uppgifter. Godkänn och leverera till kommunen." },
    { role: "kommun_handlaggare", view: "kom.rapporter", params: {}, text: "Byt till kundens perspektiv och öppna rapporten. Den kvitteras som läst." },
  ] },
  { id: "s8", title: "Fakturering januari", lead: "En faktura per ärende och månad. Beställarreferens krävs. Veckor utan närvaro kontrolleras.", steps: [
    { role: "ekonom", view: "eko.korning", params: { month: "2027-01" }, text: "Öppna januarikörningen. Veckorna följer torsdagsregeln (v. 53 hör till december)." },
    { role: "ekonom", view: "eko.korning", params: { month: "2027-01" }, text: "Två ärenden är stoppade: beställarreferensen är fel. Rätta med referensen från kommunens meddelande." },
    { role: "ekonom", view: "eko.korning", params: { month: "2027-01" }, text: "Godkänn veckor utan närvaro. Förhandsgranska en faktura med upparbetat och återstående belopp." },
    { role: "ekonom", view: "eko.korning", params: { month: "2027-01" }, text: "Skicka till Fortnox (simulerat) eller använd reservvägen: export och markera som manuellt fakturerad." },
  ] },
  { id: "s9", title: "Ledningens vy och kundens vy", lead: "Samma resultat – olika perspektiv. Det interna målet visas aldrig för kommunen.", steps: [
    { role: "chef", view: "chef.oversikt", params: {}, text: "Resultatgraden ligger under det interna målet 35 % men över avtalets 32 %. Titta på prognosen." },
    { role: "chef", view: "chef.oversikt", params: {}, text: "Kvittera flaggan med en kort åtgärdsplan." },
    { role: "chef", view: "chef.avvikelser", params: {}, text: "Titta på avtalsavvikelser, åtgärdsplaner och varningar (0 av 3)." },
    { role: "chef", view: "chef.oversikt", params: {}, text: "Rutan Så ser kommunen resultatet visar beställarrapporten med bara avtalsmålet 32 %. Avtalsansvarig lämnar rapporten till kommunen utanför Miljonmatch." },
  ] },
  { id: "s10", title: "Behörigheter och dataskydd", lead: "Behörighet = avtal + roll. Tilldelningen styr notiser och listorna med egna ärenden. Testa samma data från olika roller.", steps: [
    { role: "ekonom", view: "eko.start", params: {}, text: "Som ekonom: ärendenummer, perioder och referenser – inga namn, anteckningar eller rapporter." },
    { role: "coach", view: "arenden.lista", params: {}, text: "Som coach: alla ärenden i avtalet finns under Ärenden – dina egna är markerade. Kommunen ser bara sina egna." },
    { role: "kommun_handlaggare", view: "kom.deltagare", params: {}, text: "Som kommunens handläggare: bara de deltagare du själv har beställt insatser för. Byt sedan till samordnare och jämför." },
    { role: "admin", view: "admin.logg", params: {}, text: "Revisionsloggen visar allt du gjort i prototypen, inklusive visningar av deltagarkort och personnummer." },
  ] },
  { id: "s11", title: "Deltagarens röst", lead: "Pulsmätning via engångslänk, utan inloggning. Coachen ser inte enskilda svar.", steps: [
    { role: "deltagare", view: "puls.svar", params: {}, text: "Svara på pulsmätningen. Byt gärna språk (svenska, engelska, arabiska, somaliska)." },
    { role: "chef", view: "chef.oversikt", params: { tab: "puls" }, text: "Byt till ledningens vy. Aggregat visas först vid minst 5 svar. Lågt betyg på stödet går till chef, inte coach." },
  ] },
  { id: "s13", title: "Notiser, påminnelser och tidig eskalering", lead: "Coachen får notis vid tilldelning och påminnelse när progression uteblir. Två veckor i rad eskaleras till chef/controller – utan att coachen ser det.", steps: [
    { role: "samordnare", view: "sam.inkorg", params: { emailId: "em-106" }, text: "Acceptera avropet från Linda Karlsson och välj Amira Haddad som huvudcoach. Hon får en notis i appen och ett mejl utan personuppgifter." },
    { role: "coach", view: "notiser", params: {}, text: "Byt till coachen. Under Notiser finns tilldelningen och påminnelser om ärenden utan progression förra veckan. Inget visar att chefen fått en eskalering." },
    { role: "chef", view: "notiser", params: {}, text: "Byt till chef/controller. Här syns eskaleringarna – ärenden med två eller fler veckor i rad utan progression, med coach och orsak per vecka." },
    { role: "chef", view: "chef.oversikt", params: {}, text: "I ledningsvyn syns tidig uppmärksamhet per coach. Kvittera med en kort åtgärd." },
    { role: "admin", view: "admin.avtal", params: { tab: "interna" }, text: "Reglerna (antal veckor, mottagare, kanaler) är interna regler för Miljonbemanning och kan ändras i adminvyn." },
  ] },
  { id: "s12", title: "Avtalet är konfiguration", lead: "Inga avtalsvärden är hårdkodade. Fler kommunavtal kan läggas till som konfiguration, utan kodändring.", steps: [
    { role: "admin", view: "admin.avtal", params: {}, text: "Se Botkyrkas avtalskonfiguration. Värden som ska fastställas är markerade och aktiveras inte." },
    // Beslut 5 (2026-10-07): belopp syns bara för ekonomen – prislistan finns under Ekonomi, inte på avtalssidan.
    { role: "ekonom", view: "eko.prislista", params: {}, text: "Byt till ekonomen. Prislistan per avtalsområde finns under Ekonomi – bara ekonomen ser priser och belopp. Priserna i testdatat är exempelpriser." },
    { role: "admin", view: "om.fragor", params: {}, text: "Gå igenom de öppna frågorna till Botkyrka." },
  ] },
  // Nytt (finns inte i den gamla prototypen): röstinspelningen, beslut 2026-09-30 (docs/PLAN-ROST.md). Deltagarens sida fanns
  // inte i den gamla prototypen och har därför sökvägen som vy ("/rost").
  { id: "s14", title: "Röstinspelning", lead: "Coachen spelar in mötet, kommunen talar in och deltagaren spelar in på sitt språk. AI föreslår – människan bedömer. Inget ljud sparas.", steps: [
    { role: "coach", view: "coach.avstamning", params: (r) => ({ caseId: sc(r, "nadia") }), text: "Välj Med AI-stöd och Spela in mötet (i prototypen: Simulera en inspelning). Pausa, fortsätt och stoppa. Ljudet laddas upp, transkriberas och raderas direkt. Förslagen har belägg – samlad status väljer du själv." },
    { role: "coach", view: "arende.kort", params: (r) => ({ caseId: sc(r, "nadia") }), text: "Nadia har spelat in ett röstmeddelande på somaliska. Läs den svenska översättningen, visa originaltexten och markera det som granskat. Skicka en ny inspelningslänk – utskicket innehåller inga personuppgifter." },
    { role: "deltagare", view: "/rost", params: {}, text: "Byt till deltagarens perspektiv: länken utan inloggning (arabiska som förval). Byt språk, ge samtycke, spela in och skicka." },
    { role: "coach", view: "coach.minvecka", params: {}, text: "Tillbaka som coach: det nya röstmeddelandet väntar på granskning på Min vecka. Använd texten som underlag i nästa möte." },
    { role: "kommun_handlaggare", view: "kom.bestall", params: {}, text: "Som handläggare: beställ en insats och tala in bakgrunden i stället för att skriva (steg 3). Texten hamnar i fältet och inget ljud sparas." },
    { role: "coach", view: "coach.manad", params: (r) => ({ caseId: sc(r, "nadia"), month: "2027-01" }), text: "Skapa nytt AI-utkast från godkända mötesrapporter. Utkasten har källor och bygger aldrig på råtranskript – AI föreslår progressionsnivå bara med ett citat, du godtar eller väljer själv." },
  ] },
  { id: "s15", title: "Byt yrkesområde", lead: "Huvudcoachen byter deltagarens yrkesområde med en kort motivering. Yrkesområdet är deltagarens grupp: inbjudningarna följer direkt. Fakturan räknas på det nya yrkesområdet från månaden efter.", steps: [
    { role: "coach", view: "arende.kort", params: { caseId: "case-260163" }, text: "Öppna Linnea Olssons deltagarkort. Hon bytte från G till D den 27 januari – motiveringen står som anteckning, och hon är inbjuden till D:s yrkesområdesträff i mars. Prova Byt yrkesområde på ett annat ärende: deltagaren bjuds in till det nya yrkesområdets kommande träffar och tas bort ur det gamlas." },
    { role: "coach", view: "/grupper", params: {}, text: "Grupper och nivåer: yrkesområdena räknar deltagarna efter ärendets yrkesområde just nu, med månadens träff. Nivåaktiviteterna följer nivån och påverkas inte av bytet." },
    { role: "ekonom", view: "eko.arende", params: { caseId: "case-260163" }, text: "Byt till ekonomen. Januari faktureras på G och februari på D – bytet gäller från månaden efter." },
  ] },
  // Karims beslut 2026-10-22: fem nivåer, Höj nivå och nivåaktiviteter som återkommer varje vecka.
  { id: "s16", title: "Fem nivåer och nivåaktiviteter", lead: "Varje deltagare är på exakt en av fem nivåer. Nivån väljs i kartläggningen och höjs när deltagaren utvecklas. Nivåaktiviteterna återkommer varje vecka och bjuder in nivåns deltagare automatiskt.", steps: [
    { role: "coach", view: "/grupper", params: {}, text: "Grupper och nivåer: de fem nivåerna med deltagarna och nivåns återkommande aktiviteter. Längst ned står Utan nivå – att kartlägga: de som ännu saknar nivå." },
    { role: "coach", view: "coach.kartlaggning", params: (r) => ({ caseId: sc(r, "amal") }), text: "Amal saknar nivå. Välj nivå i kortet Nivå och yrkesområde längst ned – nivån krävs innan kartläggningen kan godkännas. Hon bjuds in till nivåns kommande aktiviteter direkt." },
    { role: "coach", view: "arende.kort", params: (r) => ({ caseId: sc(r, "mehmet") }), text: "Mehmet är på nivå 3. Tryck Ändra i kortets huvud och sedan Höj nivå: han bjuds in till nivå 4:s kommande aktiviteter och tas bort ur nivå 3:s." },
    { role: "coach", view: "/aktiviteter/ny?niva=grp-c-bot-niva-2&upprepa=1", params: {}, text: "Ny nivåaktivitet med Upprepa varje vecka: välj veckodagar och tid. Tillfällena skapas två veckor framåt och nivåns deltagare bjuds in automatiskt – också den som får nivån senare. Planera på Grupper och nivåer gör samma sak för månadens yrkesområdesträff." },
  ] },
];

export const scenarioById = (id: string | null | undefined): Scenario | undefined => SCENARIOS.find((s) => s.id === id);
/** "Scenario 3" – numret är platsen i listan (s13 visas före s12, som i den gamla prototypen). */
export const scenarioNumber = (id: string): number => SCENARIOS.findIndex((s) => s.id === id) + 1;
export const needsRefs = (step: ScenarioStep): boolean => typeof step.params === "function";
export const stepParams = (step: ScenarioStep, refs: DemoRefs): ViewParams => (typeof step.params === "function" ? step.params(refs) : step.params);
/** Sökvägen för ett steg. Vyer som inte fanns i den gamla prototypen anges med sin sökväg (t.ex. "/rost"). */
export const stepPath = (step: ScenarioStep, refs: DemoRefs): string => pathForView(step.view, stepParams(step, refs)) ?? (step.view.startsWith("/") ? step.view : "/om");
export const scenarioPerspectives = (s: Scenario): Perspective[] => uniq(s.steps.map((st) => perspectiveOf(st.role)));
export const TOTAL_STEPS = SCENARIOS.reduce((n, s) => n + s.steps.length, 0);
