// Fasta listor för testdata – exakt den gamla prototypens (prototyp/src/01-seed.js, MM.seedConstants).
// Bara påhittade namn och orter. Ordningen i listorna styr slumpen och får inte ändras.
import type { AreaCode } from "../schema";

/** Demoklockans starttid: måndag 1 februari 2027 kl. 09.12 (ISO-vecka 5), fem månader in i piloten. */
export const NOW = "2027-02-01T09:12";
export const TODAY = NOW.slice(0, 10);

/** Avtalsområden A–L i Botkyrka med exempelpris per deltagarvecka (öre, exkl. moms). */
export const AREAS: readonly (readonly [AreaCode, string, number])[] = [
  ["A", "Administration", 152300], ["B", "Hälsa och sjukvård", 166800], ["C", "Bygg och anläggning", 159800],
  ["D", "Kök, restaurang och måltidsservice", 144500], ["E", "Transport och åkeri", 156200], ["F", "Lokalvård", 132300],
  ["G", "Lager och logistik", 139800], ["H", "Serviceyrken", 141200], ["I", "Fastighet, mark och park", 147600],
  ["J", "Parti- och detaljhandel", 138900], ["K", "Industri", 153400], ["L", "Övrigt", 145000],
];

/** Yrkesspår per avtalsområde. */
export const TRACKS: Readonly<Record<AreaCode, readonly string[]>> = {
  A: ["Kontor och reception", "Administrativ assistent"], B: ["Vård- och omsorgsassistent", "Service i vården"],
  C: ["Bygg – grund och arbetsmiljö"], D: ["Restaurangbiträde", "Kallskänka och disk"],
  E: ["Budbil och distribution", "Förberedelse för C-körkort"], F: ["Lokalvårdare med certifiering"],
  G: ["Truckförare A+B", "Lagerarbetare – plock och pack"], H: ["Butik och kundservice", "Hotell och konferens"],
  I: ["Fastighetsskötsel", "Park och grönyta"], J: ["Butikssäljare", "E-handelslager"], K: ["Industrioperatör"], L: ["Individuellt spår"],
};

export const AREA_WEIGHTS: readonly (readonly [AreaCode, number])[] = [
  ["G", 25], ["F", 15], ["D", 12], ["H", 10], ["J", 10], ["B", 8], ["E", 6], ["A", 5], ["C", 4], ["I", 3], ["K", 1], ["L", 1],
];

export const FIRST = ["Amal", "Yusuf", "Fatima", "Mohamed", "Hodan", "Abdi", "Sara", "Johan", "Elif", "Mehmet", "Nour", "Leyla", "Dalia", "Ali", "Hassan", "Maryam",
  "Ismail", "Asha", "Filsan", "Emma", "Anders", "Nikola", "Ana", "Joanna", "Tomasz", "Roza", "Dilan", "Aram", "Shirin", "Reza", "Samira", "Habiba", "Idris",
  "Zainab", "Yonas", "Selam", "Tesfaye", "Rahel", "Lina", "Rami", "Bashir", "Hawa", "Kevin", "Linnea", "Oscar", "Viktor", "Maja", "Ebba", "Ahmad", "Rasha",
  "Wael", "Dana", "Muna", "Sahra", "Guled", "Liban", "Jamal", "Carlos", "Lucia", "Diego", "Ines", "Mirela", "Emir", "Amina", "Senad", "Nadia", "Tariq", "Hiba",
  "Mustafa", "Salma", "Daniel", "Patrik", "Jonna", "Sofia", "Mikael", "Arjin", "Berivan", "Hamza", "Ilhan", "Kawsar"] as const;
export const LAST = ["Ali", "Hassan", "Mohamed", "Yilmaz", "Demir", "Kaya", "Warsame", "Abdi", "Farah", "Jama", "Nilsson", "Johansson", "Andersson", "Karlsson",
  "Petrović", "Kowalski", "Nowak", "Haile", "Tesfay", "Gebremedhin", "Rahimi", "Hosseini", "Ahmadi", "Khalaf", "Saleh", "Ibrahim", "Osman", "Aden",
  "Svensson", "Lindberg", "Öztürk", "Aydın", "Rodríguez", "Morales", "Hodžić", "Begić", "Nguyen", "Tran", "Lindström", "Eriksson", "Musa", "Jawad",
  "Karimi", "Suleiman", "Nur", "Dahir", "Mahmoud", "Berhane", "Kebede", "Olsson"] as const;
export const CITIES = ["Alby", "Fittja", "Hallunda", "Norsborg", "Tumba", "Tullinge", "Vårsta", "Storvreten", "Eriksberg"] as const;
export const LANGS: readonly (readonly [string, number])[] = [
  ["svenska", 44], ["arabiska", 12], ["somaliska", 12], ["tigrinja", 6], ["turkiska", 6], ["dari", 5], ["engelska", 5], ["polska", 3], ["spanska", 3], ["bosniska", 4],
];
export const NEEDS = ["Behöver skriftliga instruktioner", "Behöver korta arbetspass med pauser", "Kan inte lyfta tungt – anpassade arbetsmoment",
  "Behöver extra tid vid nya uppgifter", "Hör dåligt – skriftlig sammanfattning efter möten", "Behöver tydlig struktur och schema i förväg"] as const;

/** Bakgrundstext i beställningen per avtalsområde. */
export const BACKGROUND: Readonly<Record<AreaCode, string>> = {
  G: "Har arbetat på lager i tidigare hemland. Vill ta truckkort och arbeta inom logistik.",
  F: "Har städat privat och i föreningslokal. Vill ha anställning inom lokalvård.",
  D: "Har arbetat i restaurangkök under två somrar. Vill arbeta i storkök.",
  H: "Har arbetat extra i butik. Vill arbeta med kundservice.",
  J: "Har erfarenhet av försäljning på marknad. Vill arbeta i butik.",
  B: "Har tagit hand om anhörig i flera år. Intresserad av vård och omsorg.",
  E: "Har B-körkort. Vill arbeta med distribution.",
  A: "Har gymnasieutbildning och vill arbeta på kontor eller reception.",
  C: "Har arbetat inom bygg utan formell utbildning. Vill få dokumenterad kompetens.",
  I: "Intresserad av utearbete och fastighetsskötsel.",
  K: "Har arbetat i fabrik. Vill arbeta i produktion.",
  L: "Behöver kartläggning innan val av yrkesspår.",
};

/** [id, namn, avtalsområden, kontaktperson] */
export const EMPLOYERS: readonly (readonly [string, string, readonly AreaCode[], string])[] = [
  ["emp-1", "Hallunda Lagerservice AB", ["G", "J"], "Peter Lund"], ["emp-2", "Tumba Städ & Fastighet AB", ["F", "I"], "Anneli Rask"],
  ["emp-3", "Restaurang Kryddgården", ["D"], "Goran Ilić"], ["emp-4", "Södertörns Distribution AB", ["E", "G"], "Mikaela Fors"],
  ["emp-5", "Fittja Handel AB", ["J", "H"], "Rashid Omar"], ["emp-6", "Norsborg Fastighetsservice AB", ["I", "F"], "Ulf Berg"],
  ["emp-7", "Kvarnen Bageri och Café", ["D", "H"], "Lena Pihl"], ["emp-8", "Vårsta Omsorg AB", ["B"], "Maria Jonsson"],
  ["emp-9", "Alby Bygg & Mark AB", ["C", "I"], "Stefan Ek"], ["emp-10", "Mälardalens Transport AB", ["E"], "Kristina Hall"],
  ["emp-11", "Storvreten Hotell & Konferens", ["H"], "Sanna Blom"], ["emp-12", "Tullinge Industri AB", ["K"], "Jonas Rydell"],
];

/** Aktivitetstyper i avstämningen (mall 02). */
export const ACTIVITY_TYPES = ["Kartläggning och individuell planering", "Yrkesförberedande träning", "Yrkesspecifika moment", "Studiebesök och arbetsplatsbesök",
  "Praktik/APL", "CV och ansökningar", "Intervjuträning", "Matchning mot arbetsgivare", "Vägledning om studier och validering"] as const;
/** Hinder i avstämningen. */
export const OBSTACLES = ["Språk", "Digital vana", "Praktiska förutsättningar (t.ex. barnomsorg, resor)", "Behov av anpassning", "Motivation", "Annat"] as const;
/** Exempel på veckomål per fas. */
export const GOALS: Readonly<Record<number, readonly string[]>> = {
  1: ["Slutföra kartläggningen och välja yrkesspår", "Ta fram underlag till CV", "Komma i tid till alla tillfällen denna vecka"],
  2: ["Öva på att följa arbetsinstruktioner i skrift", "Skapa konto på Platsbanken och spara tre annonser", "Komma i tid till alla tillfällen denna vecka"],
  3: ["Klara momentet säker hantering av pall", "Genomföra första delen av certifieringen", "Öva arbetsmomenten i rätt tempo"],
  4: ["Genomföra praktikveckan enligt schema", "Be handledaren om återkoppling på tempo och kvalitet", "Ta egna initiativ till arbetsuppgifter på praktiken"],
  5: ["Skicka tre ansökningar", "Förbereda anställningsintervjun", "Följa upp arbetserbjudandet med arbetsgivaren"],
};
/** Exempel på anteckningar per samlad status. */
export const NOTES: Readonly<Record<"green" | "yellow" | "red", readonly string[]>> = {
  green: ["Följde planen. Klarade veckans moment utan stöd.", "Kom i tid alla dagar. Arbetade med CV och skickade en ansökan.", "Bra vecka. Tog egna initiativ under yrkesmomentet.", "Genomförde veckans moment. Behöver fortsatt öva på tempo."],
  yellow: ["Missade ett tillfälle på grund av barnomsorg. Vi planerade om veckan.", "Behöver mer stöd med digitala ansökningar. Extra pass bokat.", "Kom sent två gånger. Vi har gått igenom resvägen tillsammans."],
  red: ["Uteblev två gånger utan att höra av sig. Behöver dialog med handläggaren om planen.", "Planen håller inte. Behöver omplanering tillsammans med kommunen."],
};
/** Exempel på observationer per progressionsområde. */
export const OBS: Readonly<Record<string, readonly string[]>> = {
  narvaro_rutiner: ["Kom i tid till samtliga tillfällen under månaden (12 av 12).", "Har själv meddelat frånvaro i förväg vid två tillfällen."],
  yrkesfardigheter: ["Utför plock och pack enligt instruktion utan stöd.", "Har klarat tre av fem yrkesmoment i momentlistan."],
  arbetskapacitet: ["Klarar fyra timmars pass med en paus.", "Har ökat från halvdag till heldag på praktiken."],
  sjalvstandighet: ["Planerar själv sin vecka i kalendern.", "Tar egna initiativ till nästa arbetsuppgift."],
  digital_sjalvstandighet: ["Loggar själv in på Platsbanken och sparar annonser.", "Skickade en ansökan digitalt utan hjälp."],
  instruktioner: ["Följer skriftliga arbetsinstruktioner i rätt ordning.", "Ställer frågor när en instruktion är oklar."],
  arbetsgivarkontakter: ["Har haft två arbetsgivarkontakter (studiebesök och intervju).", "Har själv kontaktat en arbetsgivare per telefon."],
  beredskap: ["Bedöms redo för praktik – kraven, tempot och rutinerna fungerar.", "Har förberett sig inför anställningsintervju."],
  sprak_kommunikation: ["Använder yrkesord på svenska i samtal med handledaren.", "Beskriver själv sina arbetsuppgifter på svenska."],
  ovrigt: ["Har tagit fram ett uppdaterat CV.", "Har börjat ta sig till praktiken på egen hand."],
};
/** Nästa steg per progressionsområde. */
export const NEXT: Readonly<Record<string, string>> = {
  narvaro_rutiner: "Fortsätta meddela frånvaro före kl. 08.", yrkesfardigheter: "Öva de två återstående momenten.", arbetskapacitet: "Öka till heldag två dagar i veckan.",
  sjalvstandighet: "Planera nästa vecka själv.", digital_sjalvstandighet: "Skicka en ansökan helt själv.", instruktioner: "Öva på muntliga instruktioner.",
  arbetsgivarkontakter: "Boka ett studiebesök.", beredskap: "Starta praktik enligt plan.", sprak_kommunikation: "Öva yrkesord inför praktiken.", ovrigt: "–",
};
/** Orsaker till giltig frånvaro. */
export const ABS_VALID = ["Sjukdom", "Vård av barn", "Myndighetsbesök", "Annat giltigt skäl"] as const;
