// 01-seed.js – påhittade testdata (deterministiska). Inga riktiga personer eller personnummer.
// Demodatum: måndag 1 februari 2027 kl. 09.12 (ISO-vecka 5). Avtalet startade 2026-09-10.
(() => {
  const { d } = MM;
  const NOW = '2027-02-01T09:12';
  const TODAY = NOW.slice(0, 10);

  // ------------------------------------------------------------ Avtalskonfiguration (SPEC §6.2)
  // Värden som ska bekräftas med Botkyrka är markerade "ATT_FASTSTÄLLA ...".
  const CONFIG_BOT = {
    casePrefix: 'BOT',
    dataRole: 'processor',
    thirdCountryProcessing: 'forbidden_without_written_approval',
    orderChannels: ['email', 'portal', 'phone'],
    customerVisibility: { scope: 'ATT_FASTSTÄLLA (own | unit | all)', prototypeScope: 'own', seesIndividualReports: true, seesCoachNotes: false, seesSlaStats: false },
    reportDelivery: { channel: 'portal', emailAttachmentAllowed: false },
    phases: [
      { no: 1, name: 'Kartläggning' },
      { no: 2, name: 'Yrkesförberedande grund' },
      { no: 3, name: 'Yrkesspecifika moment' },
      { no: 4, name: 'Praktik/APL' },
      { no: 5, name: 'Matchning och slutrapport' },
    ],
    stuckRules: [{ phase: 1, maxDays: 10 }, { phase: 3, maxDays: 35, unlessPlacementPlanned: true }],
    progression: {
      scale: { 0: 'Ingen / för tidigt att bedöma', 1: 'Liten', 2: 'Tydlig', 3: 'Uppnått delmål' },
      areas: ['narvaro_rutiner', 'yrkesfardigheter', 'arbetskapacitet', 'sjalvstandighet', 'digital_sjalvstandighet', 'instruktioner', 'arbetsgivarkontakter', 'beredskap', 'sprak_kommunikation', 'ovrigt'],
      optionalAreas: ['halsa_funktionellt', 'livskvalitet_sjalvskattad'],
      areaLabels: {
        narvaro_rutiner: 'Närvaro, punktlighet och rutiner',
        yrkesfardigheter: 'Yrkesfärdigheter/praktisk förmåga',
        arbetskapacitet: 'Arbetskapacitet och uthållighet',
        sjalvstandighet: 'Självständighet och ansvarstagande',
        digital_sjalvstandighet: 'Digital självständighet',
        instruktioner: 'Förmåga att förstå och följa yrkesrelaterade instruktioner',
        arbetsgivarkontakter: 'Arbetsgivarkontakter/nätverk',
        beredskap: 'Beredskap för praktik, arbete eller studier',
        sprak_kommunikation: 'Språk och kommunikation',
        ovrigt: 'Övrig relevant progression',
        halsa_funktionellt: 'Hälsa (funktionellt beskrivet)',
        livskvalitet_sjalvskattad: 'Livskvalitet (deltagarens egen skattning)',
      },
      observationRequiredFromLevel: 1,
      statDefinition: { clear: 'minst ett område på nivå >= 2', any: 'minst ett område på nivå >= 1' },
    },
    result: {
      definition: 'ATT_FASTSTÄLLA',
      prototypeDefinition: 'Preliminärt i prototypen: avslut till arbete eller studier som är verifierade räknas som resultat. Avbrott på grund av flytt eller kommunens beslut räknas inte i nämnaren.',
      countsAsResult: ['arbete', 'studier'],
      excludedFromDenominator: 'ATT_FASTSTÄLLA',
      prototypeExcluded: ['avbrott_flytt', 'avbrott_kommunens_beslut'],
      requiresVerification: true,
    },
    kpis: [
      { key: 'resultatgrad', label: 'Resultatgrad (arbete eller studier)', windows: ['rolling_6m', 'since_start'], contractTarget: 0.32, internalTarget: 0.35, minN: 10,
        notify: { belowInternal: ['chef', 'controller'], belowContract: ['chef', 'controller', 'avtalsansvarig'] } },
      { key: 'avrop_besvarade_i_tid', label: 'Avrop besvarade inom en arbetsdag', windows: ['month'], internalTarget: 1.0 },
      { key: 'forsta_mote_inom_en_vecka', label: 'Första möte inom en vecka', windows: ['month'], internalTarget: 1.0 },
      { key: 'veckorapporter_i_tid', label: 'Veckorapporter i tid', windows: ['month'], internalTarget: 1.0 },
      { key: 'manadsrapporter_i_tid', label: 'Månadsrapporter i tid', windows: ['month'], internalTarget: 1.0 },
      { key: 'narvarograd', label: 'Närvarograd', windows: ['month'], internalTarget: 'ATT_FASTSTÄLLA' },
      { key: 'nojdhet', label: 'Nöjdhet (andel 4–5)', windows: ['rolling_3m'], internalTarget: 'ATT_FASTSTÄLLA' },
    ],
    sla: [
      { key: 'ordererkannande', label: 'Ordererkännande', from: 'avrop_mottaget', within: { minutes: 5 }, automatic: true },
      { key: 'avrop_svar', label: 'Svar på avrop', from: 'avrop_mottaget', within: { workingDays: 1 } },
      { key: 'forsta_mote', label: 'Första möte', from: 'avrop_mottaget', within: { days: 7 } },
      { key: 'veckorapport_registrering', label: 'Närvaro registrerad', due: 'måndag 10:00 för föregående vecka', weekday: 0, time: '10:00' },
      { key: 'veckorapport_publicering', label: 'Veckorapport publicerad', due: 'måndag 16:00 för föregående vecka', weekday: 0, time: '16:00' },
      { key: 'manadsrapport', label: 'Månadsrapport', due: 'ATT_FASTSTÄLLA (förslag: 5:e arbetsdagen efter månadsskiftet)', proposal: { nthWorkingDay: 5 } },
      { key: 'slutrapport', label: 'Slutrapport', from: 'avslutsdatum', within: 'ATT_FASTSTÄLLA (förslag: 5 arbetsdagar)', proposal: { workingDays: 5 } },
    ],
    attendance: { sameDayNoticeOnInvalidAbsence: 'ATT_FASTSTÄLLA', repeatedAbsenceRule: { absentInvalid: 2, withinDays: 14 } },
    billing: {
      unit: 'participant_week',
      billableWeekRule: 'every_iso_week_with_at_least_one_enrolled_day_excluding_paused_weeks',
      flagZeroAttendanceWeeks: true,
      weekToMonthRule: 'iso_thursday',
      invoicePer: 'case_and_month',
      collectiveInvoiceAllowed: false,
      buyerReference: { required: true, pattern: '^[0-9]{8,10}$' },
      purchaseOrderNumber: { required: false, pattern: '^99[0-9]{7}$' },
      invoicedObject: 'case_number',
      showAccruedAndRemaining: true,
      separatePeriodicFromOther: true,
      paymentTermsDays: 30,
      unbilledWarningDays: 45,
      format: 'peppol_bis_3_via_fortnox',
      fallback: ['export_xlsx_pdf', 'botkyrka_fakturaportal'],
    },
    bonus: { enabled: false, model: 'ATT_FASTSTÄLLA enligt incitamentsmodellen', separateInvoice: true },
    pulse: { occasions: ['week2', 'exit'], periodicEveryDays: 30, languages: ['sv', 'en', 'ar', 'so'], minNForAggregate: 5 },
    statistics: { onRequestMaxPerYear: 2, free: true },
    termination: { returnDataWithinDays: 31, deleteAfterReturn: true },
    retention: 'ATT_FASTSTÄLLA enligt PUB-avtalet',
    escalationLadder: [
      { step: 0, level: 'mindre', text: 'Mindre avvikelse – påverkar inte kärnverksamheten och kan åtgärdas enkelt och snabbt.' },
      { step: 1, level: 'större', text: 'Större avvikelse – flera återkommande mindre avvikelser eller en avvikelse som kännbart påverkar kärnverksamheten. Skriftlig varning kan ges.' },
      { step: 2, level: 'allvarlig', text: 'Allvarlig avvikelse – flera återkommande större avvikelser eller avbrott i kärnverksamheten. Skriftlig varning kan ges.' },
      { step: 3, level: 'allvarlig', text: 'Upprepade allvarliga avvikelser. Skriftlig varning kan ges. Tre varningar kan leda till uppsägning.' },
      { step: 4, level: 'hävning', text: 'Risk för hävning av avtalet.' },
    ],
    warningsBeforeTermination: 3,
    penalties: { deviationOre: 2500000, insufficientInformationOre: 2500000 },
    economicDeviation: 'Kostnader avviker från anbud, timmar stämmer inte med utfört uppdrag, fel pris eller fel/saknad information på fakturan.',
    keyPersonnelChangeRequiresApproval: true,
    ai: { provider: 'ATT_FASTSTÄLLA (Berget AI eller Gemini via Vertex AI EU – väljs genom test)', recordingApprovedByCustomer: '2026-09-29' },
  };

  const CONFIG_KK = {
    casePrefix: 'KK',
    dataRole: 'controller',
    customerVisibility: { seesIndividualReports: false, seesCoachNotes: false },
    priceItems: [
      { code: 'startpaket', unit: 'package', packageMonths: 4, price: 4120 },
      { code: 'forlangt_stod', unit: 'month', price: 1200 },
      { code: 'forstarkt_stod', unit: 'month', price: 1350 },
      { code: 'arbetstagarstod_startpaket', unit: 'package', packageMonths: 4, price: 4080 },
      { code: 'csn_yttrande', unit: 'each', price: 699 },
    ],
    kpis: [
      { key: 'placeringsgrad', contractTarget: 0.60 },
      { key: 'yttranden_i_tid', contractTarget: 0.80 },
      { key: 'nojdhet', contractTarget: 0.70 },
    ],
    sla: [
      { key: 'forsta_kontakt', from: 'bestallning', within: { days: 5 } },
      { key: 'forsta_mote', from: 'bestallning', within: { days: 10 } },
    ],
    meetingMinimums: [
      { service: 'startpaket', minMeetings: 4, minMinutesEach: 60, periodMonths: 4 },
      { service: 'forlangt_stod', minMeetingsPerMonth: 1 },
    ],
    exports: [{ key: 'kk_manadsstatistik', format: 'xlsx', fieldsPerCustomer: 8 }],
  };

  const AREAS = [
    ['A', 'Administration', 152300], ['B', 'Hälsa och sjukvård', 166800], ['C', 'Bygg och anläggning', 159800],
    ['D', 'Kök, restaurang och måltidsservice', 144500], ['E', 'Transport och åkeri', 156200], ['F', 'Lokalvård', 132300],
    ['G', 'Lager och logistik', 139800], ['H', 'Serviceyrken', 141200], ['I', 'Fastighet, mark och park', 147600],
    ['J', 'Parti- och detaljhandel', 138900], ['K', 'Industri', 153400], ['L', 'Övrigt', 145000],
  ];
  const TRACKS = {
    A: ['Kontor och reception', 'Administrativ assistent'], B: ['Vård- och omsorgsassistent', 'Service i vården'],
    C: ['Bygg – grund och arbetsmiljö'], D: ['Restaurangbiträde', 'Kallskänka och disk'],
    E: ['Budbil och distribution', 'Förberedelse för C-körkort'], F: ['Lokalvårdare med certifiering'],
    G: ['Truckförare A+B', 'Lagerarbetare – plock och pack'], H: ['Butik och kundservice', 'Hotell och konferens'],
    I: ['Fastighetsskötsel', 'Park och grönyta'], J: ['Butikssäljare', 'E-handelslager'], K: ['Industrioperatör'], L: ['Individuellt spår'],
  };
  const AREA_WEIGHTS = [['G', 25], ['F', 15], ['D', 12], ['H', 10], ['J', 10], ['B', 8], ['E', 6], ['A', 5], ['C', 4], ['I', 3], ['K', 1], ['L', 1]];

  const FIRST = ['Amal', 'Yusuf', 'Fatima', 'Mohamed', 'Hodan', 'Abdi', 'Sara', 'Johan', 'Elif', 'Mehmet', 'Nour', 'Leyla', 'Dalia', 'Ali', 'Hassan', 'Maryam',
    'Ismail', 'Asha', 'Filsan', 'Emma', 'Anders', 'Nikola', 'Ana', 'Joanna', 'Tomasz', 'Roza', 'Dilan', 'Aram', 'Shirin', 'Reza', 'Samira', 'Habiba', 'Idris',
    'Zainab', 'Yonas', 'Selam', 'Tesfaye', 'Rahel', 'Lina', 'Rami', 'Bashir', 'Hawa', 'Kevin', 'Linnea', 'Oscar', 'Viktor', 'Maja', 'Ebba', 'Ahmad', 'Rasha',
    'Wael', 'Dana', 'Muna', 'Sahra', 'Guled', 'Liban', 'Jamal', 'Carlos', 'Lucia', 'Diego', 'Ines', 'Mirela', 'Emir', 'Amina', 'Senad', 'Nadia', 'Tariq', 'Hiba',
    'Mustafa', 'Salma', 'Daniel', 'Patrik', 'Jonna', 'Sofia', 'Mikael', 'Arjin', 'Berivan', 'Hamza', 'Ilhan', 'Kawsar'];
  const LAST = ['Ali', 'Hassan', 'Mohamed', 'Yilmaz', 'Demir', 'Kaya', 'Warsame', 'Abdi', 'Farah', 'Jama', 'Nilsson', 'Johansson', 'Andersson', 'Karlsson',
    'Petrović', 'Kowalski', 'Nowak', 'Haile', 'Tesfay', 'Gebremedhin', 'Rahimi', 'Hosseini', 'Ahmadi', 'Khalaf', 'Saleh', 'Ibrahim', 'Osman', 'Aden',
    'Svensson', 'Lindberg', 'Öztürk', 'Aydın', 'Rodríguez', 'Morales', 'Hodžić', 'Begić', 'Nguyen', 'Tran', 'Lindström', 'Eriksson', 'Musa', 'Jawad',
    'Karimi', 'Suleiman', 'Nur', 'Dahir', 'Mahmoud', 'Berhane', 'Kebede', 'Olsson'];
  const CITIES = ['Alby', 'Fittja', 'Hallunda', 'Norsborg', 'Tumba', 'Tullinge', 'Vårsta', 'Storvreten', 'Eriksberg'];
  const LANGS = [['svenska', 44], ['arabiska', 12], ['somaliska', 12], ['tigrinja', 6], ['turkiska', 6], ['dari', 5], ['engelska', 5], ['polska', 3], ['spanska', 3], ['bosniska', 4]];
  const NEEDS = ['Behöver skriftliga instruktioner', 'Behöver korta arbetspass med pauser', 'Kan inte lyfta tungt – anpassade arbetsmoment',
    'Behöver extra tid vid nya uppgifter', 'Hör dåligt – skriftlig sammanfattning efter möten', 'Behöver tydlig struktur och schema i förväg'];
  const BACKGROUND = {
    G: 'Har arbetat på lager i tidigare hemland. Vill ta truckkort och arbeta inom logistik.',
    F: 'Har städat privat och i föreningslokal. Vill ha anställning inom lokalvård.',
    D: 'Har arbetat i restaurangkök under två somrar. Vill arbeta i storkök.',
    H: 'Har arbetat extra i butik. Vill arbeta med kundservice.',
    J: 'Har erfarenhet av försäljning på marknad. Vill arbeta i butik.',
    B: 'Har tagit hand om anhörig i flera år. Intresserad av vård och omsorg.',
    E: 'Har B-körkort. Vill arbeta med distribution.',
    A: 'Har gymnasieutbildning och vill arbeta på kontor eller reception.',
    C: 'Har arbetat inom bygg utan formell utbildning. Vill få dokumenterad kompetens.',
    I: 'Intresserad av utearbete och fastighetsskötsel.',
    K: 'Har arbetat i fabrik. Vill arbeta i produktion.',
    L: 'Behöver kartläggning innan val av yrkesspår.',
  };

  const EMPLOYERS = [
    ['emp-1', 'Hallunda Lagerservice AB', ['G', 'J'], 'Peter Lund'], ['emp-2', 'Tumba Städ & Fastighet AB', ['F', 'I'], 'Anneli Rask'],
    ['emp-3', 'Restaurang Kryddgården', ['D'], 'Goran Ilić'], ['emp-4', 'Södertörns Distribution AB', ['E', 'G'], 'Mikaela Fors'],
    ['emp-5', 'Fittja Handel AB', ['J', 'H'], 'Rashid Omar'], ['emp-6', 'Norsborg Fastighetsservice AB', ['I', 'F'], 'Ulf Berg'],
    ['emp-7', 'Kvarnen Bageri och Café', ['D', 'H'], 'Lena Pihl'], ['emp-8', 'Vårsta Omsorg AB', ['B'], 'Maria Jonsson'],
    ['emp-9', 'Alby Bygg & Mark AB', ['C', 'I'], 'Stefan Ek'], ['emp-10', 'Mälardalens Transport AB', ['E'], 'Kristina Hall'],
    ['emp-11', 'Storvreten Hotell & Konferens', ['H'], 'Sanna Blom'], ['emp-12', 'Tullinge Industri AB', ['K'], 'Jonas Rydell'],
  ];

  const ACTIVITY_TYPES = ['Kartläggning och individuell planering', 'Yrkesförberedande träning', 'Yrkesspecifika moment', 'Studiebesök och arbetsplatsbesök',
    'Praktik/APL', 'CV och ansökningar', 'Intervjuträning', 'Matchning mot arbetsgivare', 'Vägledning om studier och validering'];
  const OBSTACLES = ['Språk', 'Digital vana', 'Praktiska förutsättningar (t.ex. barnomsorg, resor)', 'Behov av anpassning', 'Motivation', 'Annat'];
  const GOALS = {
    1: ['Slutföra kartläggningen och välja yrkesspår', 'Ta fram underlag till CV', 'Komma i tid till alla tillfällen denna vecka'],
    2: ['Öva på att följa arbetsinstruktioner i skrift', 'Skapa konto på Platsbanken och spara tre annonser', 'Komma i tid till alla tillfällen denna vecka'],
    3: ['Klara momentet säker hantering av pall', 'Genomföra första delen av certifieringen', 'Öva arbetsmomenten i rätt tempo'],
    4: ['Genomföra praktikveckan enligt schema', 'Be handledaren om återkoppling på tempo och kvalitet', 'Ta egna initiativ till arbetsuppgifter på praktiken'],
    5: ['Skicka tre ansökningar', 'Förbereda anställningsintervjun', 'Följa upp arbetserbjudandet med arbetsgivaren'],
  };
  const NOTES = {
    green: ['Följde planen. Klarade veckans moment utan stöd.', 'Kom i tid alla dagar. Arbetade med CV och skickade en ansökan.', 'Bra vecka. Tog egna initiativ under yrkesmomentet.', 'Genomförde veckans moment. Behöver fortsatt öva på tempo.'],
    yellow: ['Missade ett tillfälle på grund av barnomsorg. Vi planerade om veckan.', 'Behöver mer stöd med digitala ansökningar. Extra pass bokat.', 'Kom sent två gånger. Vi har gått igenom resvägen tillsammans.'],
    red: ['Uteblev två gånger utan att höra av sig. Behöver dialog med handläggaren om planen.', 'Planen håller inte. Behöver omplanering tillsammans med kommunen.'],
  };
  const OBS = {
    narvaro_rutiner: ['Kom i tid till samtliga tillfällen under månaden (12 av 12).', 'Har själv meddelat frånvaro i förväg vid två tillfällen.'],
    yrkesfardigheter: ['Utför plock och pack enligt instruktion utan stöd.', 'Har klarat tre av fem yrkesmoment i momentlistan.'],
    arbetskapacitet: ['Klarar fyra timmars pass med en paus.', 'Har ökat från halvdag till heldag på praktiken.'],
    sjalvstandighet: ['Planerar själv sin vecka i kalendern.', 'Tar egna initiativ till nästa arbetsuppgift.'],
    digital_sjalvstandighet: ['Loggar själv in på Platsbanken och sparar annonser.', 'Skickade en ansökan digitalt utan hjälp.'],
    instruktioner: ['Följer skriftliga arbetsinstruktioner i rätt ordning.', 'Ställer frågor när en instruktion är oklar.'],
    arbetsgivarkontakter: ['Har haft två arbetsgivarkontakter (studiebesök och intervju).', 'Har själv kontaktat en arbetsgivare per telefon.'],
    beredskap: ['Bedöms redo för praktik – kraven, tempot och rutinerna fungerar.', 'Har förberett sig inför anställningsintervju.'],
    sprak_kommunikation: ['Använder yrkesord på svenska i samtal med handledaren.', 'Beskriver själv sina arbetsuppgifter på svenska.'],
    ovrigt: ['Har tagit fram ett uppdaterat CV.', 'Har börjat ta sig till praktiken på egen hand.'],
  };
  const NEXT = {
    narvaro_rutiner: 'Fortsätta meddela frånvaro före kl. 08.', yrkesfardigheter: 'Öva de två återstående momenten.', arbetskapacitet: 'Öka till heldag två dagar i veckan.',
    sjalvstandighet: 'Planera nästa vecka själv.', digital_sjalvstandighet: 'Skicka en ansökan helt själv.', instruktioner: 'Öva på muntliga instruktioner.',
    arbetsgivarkontakter: 'Boka ett studiebesök.', beredskap: 'Starta praktik enligt plan.', sprak_kommunikation: 'Öva yrkesord inför praktiken.', ovrigt: '–',
  };

  MM.seedConstants = { CONFIG_BOT, CONFIG_KK, AREAS, TRACKS, ACTIVITY_TYPES, OBSTACLES, GOALS, NOTES, OBS, NEXT, NOW, TODAY };

  // ------------------------------------------------------------ Generator
  MM.seed = function seed() {
    const r = MM.rng(20270201);
    const S = {
      version: 1, seq: 5000, now: NOW,
      contracts: [], areas: [], priceItems: [], users: [], customerUsers: [], buyerReferences: [], persons: [], cases: [],
      caseCounters: {}, caseStatusHistory: [], inboundEmails: [], intakeAssessments: [], activities: [], attendance: [], checkIns: [],
      monthlyAssessments: [], monthlyPlans: [], outcomeEvents: [], deviations: [], contractDeviations: [], employers: [], placements: [],
      reports: [], pulseInvites: [], pulseResponses: [], alertAcks: {}, messages: [], invoiceStatus: {}, billingRuns: [], consents: [],
      aiRuns: [], auditLog: [], notifications: [], deadlineOverrides: {}, tasks: [], userNotifications: [], notifRead: {},
    };
    // Interna regler för Miljonbemanning (inte avtalskrav) – styr notiser, påminnelser och eskalering.
    S.orgConfig = {
      billing: { fortnoxWithinWorkingDays: 3, internalGoal: true },
      alerts: { firstMeetingNotBookedAfterDays: 3 },
      notifications: {
        onAssignment: { to: ['lead_coach', 'team'], channels: ['app', 'email'], emailContainsPersonalData: false },
        progressionWatch: {
          internalRule: true,
          noProgressSignals: ['weekly_goal_not_met', 'no_approved_check_in'],
          remindCoachAfterWeeks: 1,
          escalateAfterConsecutiveWeeks: 2,
          escalateTo: ['chef'],
          escalationVisibleToCoach: false,
          reminderSchedule: 'måndag 08.00 för föregående vecka',
          channels: ['app', 'email'],
        },
      },
    };
    const nid = (p) => `${p}-${++S.seq}`;

    // ---- Avtal
    S.contracts.push({ id: 'c-bot', name: 'Yrkesförberedande och yrkesinriktade insatser', customerName: 'Botkyrka kommun', customerOrgNr: '212000-2882',
      supplierName: 'Miljonbemanning AB', supplierOrgNr: '556959-9318', contractNumber: '332026110', dnr: 'AVN/2026:00048',
      startsOn: '2026-09-10', endsOn: '2030-09-10', casePrefix: 'BOT', dataRole: 'processor', status: 'active', config: CONFIG_BOT,
      emailDomains: ['botkyrka.se'], contractManagerId: 'u-johan' });
    S.contracts.push({ id: 'c-kk', name: 'Grundläggande omställnings- och kompetensstöd och yttrande', customerName: 'Kammarkollegiet', customerOrgNr: '202100-0829',
      supplierName: 'Miljonbemanning AB', supplierOrgNr: '556959-9318', contractNumber: '2.7.5-4201-2026', dnr: '2.7.5-4201-2026',
      startsOn: '2027-03-13', endsOn: null, casePrefix: 'KK', dataRole: 'controller', status: 'draft', config: CONFIG_KK, emailDomains: [], contractManagerId: 'u-johan' });
    for (const [code, name, price] of AREAS) {
      S.areas.push({ contractId: 'c-bot', code, name, active: true });
      S.priceItems.push({ id: `pi-${code}`, contractId: 'c-bot', areaCode: code, code: `vecka-${code}`, unit: 'participant_week', priceOre: price, vatRate: 25,
        validFrom: '2026-09-10', validTo: '2027-09-09', fortnoxArticleNo: `BOT-${code}`, exampleOnly: true });
    }

    // ---- Användare
    const U = (id, name, title, role, extra = {}) => ({ id, name, title, role, org: 'mb', email: `${name.split(' ')[0].toLowerCase()}.${name.split(' ')[1].toLowerCase().replace('å', 'a').replace('ö', 'o').replace('ä', 'a')}@miljonbemanning.se`, phone: '08-000 00 ' + String(10 + (U.n = (U.n || 0) + 1)), active: true, ...extra });
    S.users.push(
      U('u-sara', 'Sara Lindqvist', 'Operativ samordnare', 'samordnare'),
      U('u-johan', 'Johan Berg', 'Avtalsansvarig (kundansvarig Botkyrka)', 'avtalsansvarig'),
      U('u-amira', 'Amira Haddad', 'Huvudcoach', 'coach'),
      U('u-erik', 'Erik Sjöberg', 'Huvudcoach', 'coach'),
      U('u-leila', 'Leila Nouri', 'Huvudcoach', 'coach'),
      U('u-mats', 'Mats Holm', 'Huvudcoach', 'coach'),
      U('u-sofia', 'Sofia Grahn', 'Huvudcoach', 'coach'),
      U('u-petra', 'Petra Ek', 'Yrkesspecifik handledare – lager, logistik och transport', 'handledare', { teamRole: 'vocational_supervisor' }),
      U('u-david', 'David Olsson', 'Arbetsgivarmatchare', 'handledare', { teamRole: 'employer_matcher' }),
      U('u-hanna', 'Hanna Strand', 'SYV/metodstöd', 'handledare', { teamRole: 'guidance_counselor' }),
      U('u-karin', 'Karin Wallin', 'Verksamhetschef och controller', 'chef'),
      U('u-lars', 'Lars Nyström', 'Ekonom', 'ekonom'),
      U('u-robin', 'Robin Åberg', 'Systemadministratör', 'admin'),
    );
    S.buyerReferences.push(
      { id: 'br-alby', customer: 'Botkyrka kommun', reference: '4410023817', unit: 'Arbetsmarknadsenheten Alby', active: true },
      { id: 'br-tumba', customer: 'Botkyrka kommun', reference: '55102938', unit: 'Arbetsmarknadsenheten Tumba', active: true },
      { id: 'br-hallunda', customer: 'Botkyrka kommun', reference: '7730045120', unit: 'Arbetsmarknadsenheten Hallunda–Fittja', active: true },
      { id: 'br-tumba-fel', customer: 'Botkyrka kommun', reference: '55102983', unit: 'Arbetsmarknadsenheten Tumba', active: false, note: 'Finns inte hos kommunen. Decemberfakturorna returnerades 2027-01-12.' },
    );
    const K = (id, name, title, unit, brId, role = 'handlaggare') => ({ id, name, title, unit, buyerReferenceId: brId, role, org: 'customer', email: `${name.split(' ')[0].toLowerCase()}.${name.split(' ')[1].toLowerCase().replace('ö', 'o').replace('ä', 'a').replace('å', 'a')}@botkyrka.se`, phone: '08-530 000 ' + String(10 + (K.n = (K.n || 0) + 1)), active: true, lastLoginAt: null });
    S.customerUsers.push(
      K('k-maria', 'Maria Ekdahl', 'Handläggare', 'Arbetsmarknadsenheten Alby', 'br-alby'),
      K('k-ahmed', 'Ahmed Yusuf', 'Handläggare', 'Arbetsmarknadsenheten Tumba', 'br-tumba'),
      K('k-linda', 'Linda Karlsson', 'Handläggare', 'Arbetsmarknadsenheten Hallunda–Fittja', 'br-hallunda'),
      K('k-omar', 'Omar Farah', 'Arbetsmarknadscoach', 'Arbetsmarknadsenheten Alby', 'br-alby'),
      K('k-eva', 'Eva Bergström', 'Enhetschef', 'Arbetsmarknadsenheten', null, 'chef'),
    );
    S.customerUsers[0].lastLoginAt = '2027-01-27T13:40';
    for (const [id, name, areas, contact] of EMPLOYERS) S.employers.push({ id, name, orgNr: `55${String(6000000 + S.employers.length * 7331).slice(0, 4)}-${String(1000 + S.employers.length * 37)}`, contactName: contact, phone: '08-000 11 ' + String(20 + S.employers.length), email: 'kontakt@example.com', areas });

    // ---- Avropstillfällen (referrals) per arbetsdag
    const perDay = (day) => { const m = day.slice(0, 7); return m === '2026-09' ? r.weighted([[1, 5], [2, 4]]) : m === '2026-10' ? r.weighted([[2, 5], [3, 4]]) : r.weighted([[2, 5], [3, 5]]); };
    const slots = [];
    for (let day = '2026-09-14'; day < TODAY; day = d.addDays(day, 1)) {
      if (!d.isWorkingDay(day)) continue;
      const n = perDay(day);
      const times = Array.from({ length: n }, () => `${String(r.int(8, 16)).padStart(2, '0')}:${String(r.int(0, 11) * 5).padStart(2, '0')}`).sort();
      for (const t of times) slots.push(`${day}T${t}`);
    }

    // ---- Hjälpare
    const coachWeights = [['u-amira', 11], ['u-erik', 23], ['u-leila', 22], ['u-mats', 22], ['u-sofia', 22]];
    const referrerWeights = [['k-maria', 30], ['k-ahmed', 25], ['k-linda', 25], ['k-omar', 20]];
    const brFor = (kid) => S.buyerReferences.find((b) => b.id === S.customerUsers.find((u) => u.id === kid).buyerReferenceId).reference;
    const makePnr = (birthYear) => {
      const mm = String(r.int(1, 12)).padStart(2, '0'); const dd = String(r.int(1, 28)).padStart(2, '0'); const nnn = String(r.int(100, 999));
      const base = `${String(birthYear).slice(2)}${mm}${dd}${nnn}`;
      let check = 0; for (let c = 0; c <= 9; c++) { if (MM.valid.luhn(base + c)) { check = c; break; } }
      const wrong = (check + 1 + r.int(0, 7)) % 10; // medvetet fel kontrollsiffra – kan inte tillhöra en verklig person
      return { full: `${birthYear}${mm}${dd}-${nnn}${wrong}`, last4: `${nnn}${wrong}` };
    };
    const makePerson = (over = {}) => {
      const first = over.firstName || r.pick(FIRST); const last = over.lastName || r.pick(LAST); const by = r.int(1968, 2004); const p = makePnr(by);
      const pc = r.weighted([['sms', 55], ['phone', 25], ['email', 15], ['letter', 5]]);
      const person = {
        id: nid('p'), firstName: first, lastName: last, pnr: p.full, pnrLast4: p.last4, birthYear: by,
        phone: `070-${r.int(100, 999)} ${r.int(10, 99)} ${r.int(10, 99)}`,
        email: `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z.]/g, '') + '@example.com',
        city: r.pick(CITIES), address: pc === 'letter' ? `Exempelvägen ${r.int(1, 60)}, 147 00 Tumba` : null, preferredContact: pc,
        protectedIdentity: false, accessibilityNeeds: r.chance(0.22) ? r.pick(NEEDS) : '', language: r.weighted(LANGS), needsInterpreter: false, ...over,
      };
      if (person.language !== 'svenska' && r.chance(0.25)) person.needsInterpreter = true;
      S.persons.push(person); return person;
    };
    const fridayOfWeek = (mondayStr) => d.addDays(mondayStr, 4);
    const nextWorking = (day) => { let x = day; while (!d.isWorkingDay(x)) x = d.addDays(x, 1); return x; };

    // ---- Skapa ärenden
    const counters = { 2026: 0, 2027: 0 };
    const cases = [];
    for (const refAt of slots) {
      const year = Number(refAt.slice(0, 4)); counters[year]++;
      const number = `BOT-${String(year).slice(2)}-${String(counters[year]).padStart(4, '0')}`;
      const area = r.weighted(AREA_WEIGHTS);
      const referrerId = r.weighted(referrerWeights);
      const plannedWeeks = r.weighted([[4, 14], [5, 8], [6, 15], [7, 12], [8, 16], [10, 35]]);
      const source = r.weighted([['email', 80], ['portal', 15], ['phone', 5]]);
      const ackAt = d.addMinutes(refAt, r.int(1, 4));
      const due = d.addWorkingDays(refAt, 1);
      let confirmedAt = d.addMinutes(refAt, r.int(20, 260));
      if (d.timeOf(confirmedAt) > '16:45') confirmedAt = `${nextWorking(d.addDays(refAt.slice(0, 10), 1))}T08:${String(r.int(10, 55)).padStart(2, '0')}`;
      if (confirmedAt > due) confirmedAt = d.addMinutes(due, -r.int(5, 60));
      if (r.chance(0.022)) confirmedAt = d.addMinutes(due, r.int(20, 95)); // enstaka sena svar (syns i KPI)
      let fm = d.addDays(refAt.slice(0, 10), r.chance(0.03) ? r.int(8, 9) : r.int(2, 6)); fm = nextWorking(fm);
      const meetTime = r.pick(['09:00', '10:00', '11:00', '13:00', '14:00', '15:00']);
      const firstMeetingAt = `${fm}T${meetTime}`;
      const startDate = fm;
      const plannedEnd = fridayOfWeek(d.addDays(d.monday(startDate), (plannedWeeks - 1) * 7));
      const c = {
        id: `case-${number.slice(4).replace('-', '')}`, number, contractId: 'c-bot', personId: null, status: 'active', source,
        referredAt: refAt, referrerId, buyerReference: brFor(referrerId), purchaseOrderNumber: null, primaryArea: area,
        secondaryArea: r.chance(0.5) ? r.pick(['G', 'F', 'H', 'J', 'D'].filter((x) => x !== area)) : null, vocationalTrack: r.pick(TRACKS[area]),
        desiredStart: d.addDays(refAt.slice(0, 10), 7), plannedWeeks, plannedEnd, acknowledgedAt: source === 'phone' ? refAt : ackAt, confirmedAt,
        firstMeetingAt, startDate, endDate: null, endReason: null, resultClass: null, resultVerifiedAt: null, phase: 1,
        leadCoachId: r.weighted(coachWeights), team: [], backgroundInfo: BACKGROUND[area], aiConsent: r.weighted([['given', 55], ['declined', 12], ['not_asked', 33]]),
        meetingDay: d.weekday(startDate), meetingTime: meetTime, location: r.pick(['Alby', 'Alby', 'Tumba', 'Hallunda']), pausedWeeks: [], tags: [],
        declineReason: null, orderValueWeeks: plannedWeeks, closedAt: null,
      };
      cases.push(c);
    }
    S.caseCounters = { 'c-bot:2026': counters[2026], 'c-bot:2027': counters[2027] };

    // Scriptade ärenden – väljs som det ärende vars avropsdatum ligger närmast måldatumet.
    const used = new Set();
    const pickCase = (targetDay, filter = () => true) => {
      let best = null, bestD = 1e9;
      for (const c of cases) { if (used.has(c.id) || !filter(c)) continue; const dd = Math.abs(d.diffDays(targetDay, c.referredAt)); if (dd < bestD) { best = c; bestD = dd; } }
      used.add(best.id); return best;
    };
    const setStart = (c, startDate, weeks, time) => {
      c.startDate = startDate; c.plannedWeeks = weeks; c.orderValueWeeks = weeks; c.meetingDay = d.weekday(startDate); if (time) c.meetingTime = time;
      c.firstMeetingAt = `${startDate}T${c.meetingTime}`; c.plannedEnd = fridayOfWeek(d.addDays(d.monday(startDate), (weeks - 1) * 7));
    };
    const script = {};
    const S1 = (tag, day, fn, filter) => { const c = pickCase(day, filter); c.tags.push(tag); script[tag] = c; fn(c); return c; };
    S1('nadia', '2026-12-08', (c) => { c.leadCoachId = 'u-amira'; c.primaryArea = 'G'; c.vocationalTrack = 'Truckförare A+B'; c.referrerId = 'k-maria'; c.buyerReference = brFor('k-maria'); c.aiConsent = 'given'; setStart(c, '2026-12-14', 10, '10:00'); c.location = 'Alby'; c.backgroundInfo = BACKGROUND.G; c.source = 'email'; });
    S1('yusuf', '2026-12-10', (c) => { c.leadCoachId = 'u-amira'; c.primaryArea = 'D'; c.vocationalTrack = 'Restaurangbiträde'; c.referrerId = 'k-maria'; c.buyerReference = brFor('k-maria'); c.aiConsent = 'declined'; setStart(c, '2026-12-14', 8, '11:00'); c.backgroundInfo = BACKGROUND.D; });
    S1('elif', '2027-01-05', (c) => { c.leadCoachId = 'u-amira'; c.primaryArea = 'A'; c.vocationalTrack = 'Kontor och reception'; c.referrerId = 'k-linda'; c.buyerReference = brFor('k-linda'); c.aiConsent = 'not_asked'; setStart(c, '2027-01-11', 6, '13:00'); c.backgroundInfo = BACKGROUND.A; });
    S1('hodan', '2026-11-24', (c) => { c.leadCoachId = 'u-amira'; c.primaryArea = 'F'; c.vocationalTrack = 'Lokalvårdare med certifiering'; c.referrerId = 'k-maria'; c.buyerReference = brFor('k-maria'); c.aiConsent = 'given'; setStart(c, '2026-11-30', 10, '15:00'); c.backgroundInfo = BACKGROUND.F; });
    S1('mehmet', '2026-12-01', (c) => { c.forcePhase = 3; c.phaseSince = '2027-01-04'; c.leadCoachId = 'u-amira'; c.primaryArea = 'E'; c.vocationalTrack = 'Budbil och distribution'; c.referrerId = 'k-omar'; c.buyerReference = brFor('k-omar'); c.aiConsent = 'given'; setStart(c, '2026-12-11', 10, '13:00'); c.backgroundInfo = BACKGROUND.E; });
    S1('amal', '2027-01-12', (c) => { c.leadCoachId = 'u-amira'; c.primaryArea = 'H'; c.vocationalTrack = 'Butik och kundservice'; c.referrerId = 'k-maria'; c.buyerReference = brFor('k-maria'); c.aiConsent = 'not_asked'; setStart(c, '2027-01-18', 8, '14:00'); c.backgroundInfo = BACKGROUND.L; c.primaryArea = 'L'; c.vocationalTrack = 'Individuellt spår'; });
    S1('skyddad', '2026-11-24', (c) => { c.leadCoachId = 'u-erik'; c.source = 'phone'; c.primaryArea = 'F'; c.vocationalTrack = 'Lokalvårdare med certifiering'; c.referrerId = 'k-omar'; c.buyerReference = brFor('k-omar'); c.aiConsent = 'not_applicable'; setStart(c, '2026-12-01', 10, '09:00'); });
    S1('reffel1', '2026-11-23', (c) => { c.referrerId = 'k-ahmed'; c.buyerReference = '55102983'; c.leadCoachId = 'u-mats'; setStart(c, '2026-11-30', 10); c.primaryArea = 'G'; c.vocationalTrack = 'Lagerarbetare – plock och pack'; });
    S1('reffel2', '2026-11-25', (c) => { c.referrerId = 'k-ahmed'; c.buyerReference = '55102983'; c.leadCoachId = 'u-sofia'; setStart(c, '2026-12-01', 10); c.primaryArea = 'J'; c.vocationalTrack = 'Butikssäljare'; });
    S1('overlapGammal', '2026-12-01', (c) => { c.leadCoachId = 'u-leila'; setStart(c, '2026-12-07', 8); c.forcedEnd = { date: '2027-01-12', reason: 'avbrott_deltagarens_val' }; });
    S1('overlapNy', '2027-01-05', (c) => { c.leadCoachId = 'u-leila'; setStart(c, '2027-01-11', 7); c.primaryArea = 'G'; c.vocationalTrack = 'Lagerarbetare – plock och pack'; });
    S1('noll1', '2026-12-15', (c) => { c.leadCoachId = 'u-erik'; setStart(c, '2026-12-21', 8); });
    S1('noll2', '2026-12-16', (c) => { c.leadCoachId = 'u-mats'; setStart(c, '2026-12-21', 10); });
    S1('pausad', '2026-12-02', (c) => { c.leadCoachId = 'u-sofia'; setStart(c, '2026-12-07', 10); c.pausedWeeks = ['2027-W02']; c.pauseReason = 'Sjukhusvistelse – uppehåll beslutat av kommunen'; });
    S1('slutsen', '2026-11-12', (c) => { c.leadCoachId = 'u-leila'; setStart(c, '2026-11-23', 9); });
    S1('prelim', '2026-11-26', (c) => { c.leadCoachId = 'u-mats'; setStart(c, '2026-12-01', 9); c.forcedEnd = { date: '2027-01-29', reason: 'arbete', verified: false }; c.primaryArea = 'G'; c.vocationalTrack = 'Truckförare A+B'; });
    S1('fastnat3', '2026-11-30', (c) => { c.leadCoachId = 'u-erik'; setStart(c, '2026-12-07', 10); c.primaryArea = 'B'; c.vocationalTrack = 'Vård- och omsorgsassistent'; c.forcePhase = 3; c.phaseSince = '2026-12-21'; });
    S1('ingetmote', '2027-01-26', (c) => { c.leadCoachId = 'u-sofia'; c.referredAt = '2027-01-26T10:40'; c.confirmedAt = '2027-01-27T09:10'; c.acknowledgedAt = '2027-01-26T10:42'; c.firstMeetingAt = null; c.startDate = null; c.noMeeting = true; }, (c) => c.referredAt.startsWith('2027-01-2'));
    S1('coachbyte', '2026-12-03', (c) => { c.leadCoachId = 'u-sofia'; setStart(c, '2026-12-09', 10); c.coachChange = { from: 'u-erik', at: '2027-01-11T09:30', reason: 'Föräldraledighet – ny huvudcoach från vecka 2' }; });

    // Amira ska ha ungefär 14 aktiva ärenden – flytta några från andra coacher.
    // (Görs efter livscykeln nedan.)

    // ---- Livscykel per ärende
    const phaseAt = (c, day) => {
      if (c.forcePhase && day >= (c.phaseSince || c.startDate)) return c.forcePhase;
      const w = Math.floor(d.diffDays(c.startDate, day) / 7) + 1; const f = w / c.plannedWeeks;
      if (c.tags.includes('amal')) return 1;
      if (c.tags.includes('nadia')) return w >= 7 ? 4 : w >= 4 ? 3 : w >= 2 ? 2 : 1;
      if (c.tags.includes('hodan')) return w >= 9 ? 5 : w >= 6 ? 4 : w >= 3 ? 3 : w >= 2 ? 2 : 1;
      return f <= 0.15 ? 1 : f <= 0.4 ? 2 : f <= 0.65 ? 3 : f <= 0.85 ? 4 : 5;
    };
    const closed = [];
    for (const c of cases) {
      if (c.noMeeting) { c.status = 'confirmed'; continue; }
      if (c.forcedEnd) { c.endDate = c.forcedEnd.date; c.status = 'closed'; closed.push(c); continue; }
      if (c.startDate > TODAY) { c.status = 'confirmed'; continue; }
      if (c.plannedEnd < TODAY) {
        c.status = 'closed';
        if (r.chance(0.15)) { const span = d.diffDays(c.startDate, c.plannedEnd); c.endDate = nextWorking(d.addDays(c.startDate, r.int(7, Math.max(8, span - 3)))); if (c.endDate > c.plannedEnd) c.endDate = c.plannedEnd; c.interrupted = true; }
        else c.endDate = c.plannedEnd;
        if (c.tags.includes('slutsen')) { c.endDate = '2027-01-22'; c.interrupted = false; }
        closed.push(c);
      } else c.status = 'active';
    }
    // Avslutsorsaker: styr så att resultatgraden hamnar strax över 32 % men under 35 %.
    const excluded = []; const counted = [];
    for (const c of closed) {
      if (c.forcedEnd) continue;
      if (c.interrupted && r.chance(0.45)) { c.endReason = r.pick(['avbrott_flytt', 'avbrott_kommunens_beslut']); excluded.push(c); } else counted.push(c);
    }
    const scriptedCounted = closed.filter((c) => c.forcedEnd);
    const den = counted.length + scriptedCounted.filter((c) => !['avbrott_flytt', 'avbrott_kommunens_beslut'].includes(c.forcedEnd.reason)).length;
    const targetVerified = Math.round(0.339 * den);
    const ordered = r.shuffle(counted).sort((a, b) => (b.interrupted ? 0 : 1) - (a.interrupted ? 0 : 1));
    let assigned = 0;
    for (const c of ordered) {
      if (assigned < targetVerified && !c.tags.includes('slutsen')) {
        c.endReason = r.chance(0.7) ? 'arbete' : 'studier'; c.resultClass = 'result'; c.resultVerifiedAt = d.addDays(c.endDate, r.int(1, 6)) + 'T10:00'; assigned++;
        if (c.resultVerifiedAt.slice(0, 10) > TODAY) c.resultVerifiedAt = `${TODAY}T08:30`;
      } else {
        c.endReason = c.interrupted ? r.pick(['avbrott_deltagarens_val', 'avbrott_ovriga_skal', 'avbrott_deltagarens_val']) : 'planerat_utan_resultat';
        c.resultClass = 'no_result';
      }
    }
    for (const c of excluded) c.resultClass = 'excluded';
    for (const c of scriptedCounted) {
      c.endReason = c.forcedEnd.reason;
      if (['arbete', 'studier'].includes(c.endReason)) { c.resultClass = 'result'; c.resultVerifiedAt = c.forcedEnd.verified === false ? null : `${d.addDays(c.endDate, 2)}T10:00`; }
      else c.resultClass = ['avbrott_flytt', 'avbrott_kommunens_beslut'].includes(c.endReason) ? 'excluded' : 'no_result';
    }
    // En extra preliminär (ej verifierad) avslut till studier i slutet av januari
    const lateClosed = counted.filter((c) => c.endDate >= '2027-01-25' && c.resultClass === 'no_result');
    if (lateClosed[0]) { const c = lateClosed[0]; c.endReason = 'studier'; c.resultClass = 'result'; c.resultVerifiedAt = null; c.tags.push('prelim2'); }
    for (const c of closed) c.closedAt = `${c.endDate}T16:${String(r.int(0, 50)).padStart(2, '0')}`;

    // Fas för aktiva/avslutade
    for (const c of cases) {
      if (!c.startDate) { c.phase = 1; continue; }
      const ref = c.status === 'closed' ? c.endDate : TODAY;
      c.phase = c.status === 'closed' ? Math.max(phaseAt(c, ref), c.resultClass === 'result' ? 5 : 1) : phaseAt(c, ref);
    }
    // Amira: fyll på till ca 14 aktiva
    const amiraActive = () => cases.filter((c) => c.leadCoachId === 'u-amira' && c.status === 'active').length;
    for (const c of cases) { if (amiraActive() >= 14) break; if (c.status === 'active' && !c.tags.length && c.leadCoachId !== 'u-amira') c.leadCoachId = 'u-amira'; }
    // Möten för Amira i dag: sprid tiderna
    const amiraToday = cases.filter((c) => c.leadCoachId === 'u-amira' && c.status === 'active');
    // Team
    for (const c of cases) {
      c.team = [{ userId: c.leadCoachId, role: 'lead_coach' }];
      if (['G', 'E', 'K'].includes(c.primaryArea)) c.team.push({ userId: 'u-petra', role: 'vocational_supervisor' });
      if (c.phase >= 4) c.team.push({ userId: 'u-david', role: 'employer_matcher' });
      if (r.chance(0.3) || c.tags.includes('amal')) c.team.push({ userId: 'u-hanna', role: 'guidance_counselor' });
    }
    // Personer
    for (const c of cases) {
      if (c.tags.includes('overlapNy')) continue;
      let over = {};
      if (c.tags.includes('nadia')) over = { firstName: 'Nadia', lastName: 'Warsame', language: 'somaliska', city: 'Alby', preferredContact: 'sms', accessibilityNeeds: 'Behöver skriftliga instruktioner' };
      if (c.tags.includes('yusuf')) over = { firstName: 'Yusuf', lastName: 'Abdi', language: 'somaliska', city: 'Fittja', preferredContact: 'phone', accessibilityNeeds: '' };
      if (c.tags.includes('elif')) over = { firstName: 'Elif', lastName: 'Yilmaz', language: 'turkiska', city: 'Hallunda', preferredContact: 'email', accessibilityNeeds: '' };
      if (c.tags.includes('hodan')) over = { firstName: 'Hodan', lastName: 'Farah', language: 'somaliska', city: 'Norsborg', preferredContact: 'sms', accessibilityNeeds: '' };
      if (c.tags.includes('mehmet')) over = { firstName: 'Mehmet', lastName: 'Kaya', language: 'turkiska', city: 'Tumba', preferredContact: 'sms', accessibilityNeeds: 'Hör dåligt – skriftlig sammanfattning efter möten' };
      if (c.tags.includes('amal')) over = { firstName: 'Amal', lastName: 'Hassan', language: 'arabiska', city: 'Alby', preferredContact: 'sms', accessibilityNeeds: 'Behöver tydlig struktur och schema i förväg', needsInterpreter: true };
      if (c.tags.includes('skyddad')) over = { firstName: 'Sanna', lastName: 'Lindgren', protectedIdentity: true, address: null, city: '', email: '', phone: '', preferredContact: 'phone', language: 'svenska', accessibilityNeeds: '' };
      const p = makePerson(over); c.personId = p.id;
      if (c.tags.includes('overlapGammal')) script.overlapNy.personId = p.id;
    }
    if (!script.overlapNy.personId) script.overlapNy.personId = script.overlapGammal.personId;

    // Coachbyte i historiken
    for (const c of cases) {
      S.caseStatusHistory.push({ id: nid('csh'), caseId: c.id, fromStatus: null, toStatus: 'acknowledged', changedBy: 'system', changedAt: c.acknowledgedAt, reason: 'Ordererkännande skickat automatiskt' });
      if (c.confirmedAt) S.caseStatusHistory.push({ id: nid('csh'), caseId: c.id, fromStatus: 'acknowledged', toStatus: 'confirmed', toCoach: c.coachChange ? c.coachChange.from : c.leadCoachId, changedBy: r.pick(['u-sara', 'u-sara', 'u-johan']), changedAt: c.confirmedAt, reason: 'Avrop accepterat' });
      if (c.coachChange) S.caseStatusHistory.push({ id: nid('csh'), caseId: c.id, fromStatus: 'active', toStatus: 'active', fromCoach: c.coachChange.from, toCoach: c.leadCoachId, changedBy: 'u-sara', changedAt: c.coachChange.at, reason: c.coachChange.reason, customerNotifiedAt: c.coachChange.at });
      if (c.status === 'closed') S.caseStatusHistory.push({ id: nid('csh'), caseId: c.id, fromStatus: 'active', toStatus: 'closed', changedBy: c.leadCoachId, changedAt: c.closedAt, reason: c.endReason });
    }

    // ---- Aktiviteter, närvaro, avstämningar
    const ABS_VALID = ['Sjukdom', 'Vård av barn', 'Myndighetsbesök', 'Annat giltigt skäl'];
    const w4Missing = new Set(); // Amiras oregistrerade tillfällen vecka 4
    for (const c of cases) {
      if (!c.startDate || c.startDate > d.addDays(TODAY, 6)) continue;
      const until = c.status === 'closed' ? c.endDate : d.addDays(d.monday(TODAY), 4);
      for (let mon = d.monday(c.startDate); mon <= until; mon = d.addDays(mon, 7)) {
        const wk = d.isoWeek(mon).key; const paused = c.pausedWeeks.includes(wk);
        const ph = phaseAt(c, mon);
        const mDay = d.addDays(mon, c.meetingDay);
        const plan = [
          { kind: 'möte', day: mDay, time: c.meetingTime, dur: 60, loc: `Miljonbemanning ${c.location}` },
          { kind: 'yrkesmoment', day: d.addDays(mon, c.meetingDay === 2 ? 1 : 2), time: '09:00', dur: 180, loc: `Miljonbemanning ${c.location}` },
          ph >= 4 ? { kind: 'praktikdag', day: d.addDays(mon, 3), time: '08:00', dur: 420, loc: 'Praktikplats' } : { kind: 'yrkesmoment', day: d.addDays(mon, c.meetingDay === 3 ? 4 : 3), time: '09:00', dur: 180, loc: `Miljonbemanning ${c.location}` },
        ];
        if (paused) continue;
        const zeroWeek = (c.tags.includes('noll1') && wk === '2027-W03') ? 'valid' : (c.tags.includes('noll2') && wk === '2027-W02') ? 'invalid' : null;
        let weekAtt = [];
        for (const p of plan) {
          if (p.day < c.startDate || (c.endDate && p.day > c.endDate) || !d.isWorkingDay(p.day)) continue;
          const startsAt = `${p.day}T${p.time}`;
          const act = { id: nid('a'), caseId: c.id, kind: p.kind, startsAt, durationMin: p.dur, location: p.loc, note: '' };
          S.activities.push(act);
          if (startsAt >= NOW) continue;
          if (c.leadCoachId === 'u-amira' && wk === '2027-W04' && (c.tags.includes('nadia') || c.tags.includes('elif') || c.tags.includes('amal')) && p.kind !== 'möte') { w4Missing.add(act.id); continue; }
          let status = r.weighted([['present', 85], ['late', 4], ['absent_valid', 7], ['absent_invalid', 4]]);
          if (zeroWeek === 'valid') status = 'absent_valid'; if (zeroWeek === 'invalid') status = 'absent_invalid';
          if (c.tags.includes('yusuf') && (p.day === '2027-01-20' || p.day === '2027-01-27')) status = 'absent_invalid';
          if (c.tags.includes('yusuf') && wk >= '2027-W03' && status === 'absent_invalid' && !(p.day === '2027-01-20' || p.day === '2027-01-27')) status = 'present';
          const reason = status === 'absent_valid' ? r.pick(ABS_VALID) : status === 'absent_invalid' ? 'Uteblev utan att meddela' : '';
          const regAt = `${p.day}T${String(Math.min(17, Number(p.time.slice(0, 2)) + Math.ceil(p.dur / 60))).padStart(2, '0')}:${String(r.int(0, 50)).padStart(2, '0')}`;
          const att = { id: nid('at'), activityId: act.id, caseId: c.id, status, reason, registeredBy: p.kind === 'praktikdag' ? 'u-david' : c.leadCoachId, registeredAt: regAt, customerNotifiedAt: null };
          S.attendance.push(att); weekAtt.push({ act, att });
        }
        // Veckoavstämning (knuten till mötet)
        const meet = weekAtt.find((x) => x.act.kind === 'möte');
        if (meet && ['present', 'late'].includes(meet.att.status) && meet.act.startsAt < NOW) {
          const invalids = weekAtt.filter((x) => x.att.status === 'absent_invalid').length;
          let overall = invalids >= 2 ? 'red' : invalids === 1 || r.chance(0.12) ? 'yellow' : 'green';
          if (r.chance(0.02)) overall = 'red';
          if (c.tags.includes('yusuf') && wk === '2027-W04') overall = 'red';
          const obstacles = overall === 'green' ? (r.chance(0.2) ? [r.pick(OBSTACLES.slice(0, 2))] : []) : [r.pick(OBSTACLES), ...(r.chance(0.4) ? [r.pick(OBSTACLES)] : [])];
          const ec = ph >= 4 ? r.pick(['1', '2+']) : ph >= 3 ? r.pick(['0', '1']) : '0';
          S.checkIns.push({
            id: nid('ci'), caseId: c.id, heldAt: meet.act.startsAt, durationMin: r.pick([30, 45, 45, 60]), mode: r.weighted([['fysiskt', 80], ['telefon', 12], ['video', 8]]),
            inputMethod: c.aiConsent === 'given' && mon >= '2027-01-04' && r.chance(0.5) ? r.pick(['ai_recording', 'teams', 'notes']) : 'manual',
            goalStatus: overall === 'green' ? r.pick(['yes', 'yes', 'partly']) : overall === 'yellow' ? r.pick(['partly', 'no']) : 'no',
            nextGoal: r.pick(GOALS[ph]), phase: ph, activitiesDone: ACTIVITY_TYPES.filter((_, i) => (ph === 1 ? [0] : ph === 2 ? [1, 5] : ph === 3 ? [1, 2, 5] : ph === 4 ? [2, 4, 7] : [5, 6, 7]).includes(i)),
            employerContacts: { count: ec, types: ec === '0' ? [] : [r.pick(['ansökan', 'intervju', 'praktikkontakt', 'studiebesök'])] },
            overallStatus: overall, obstacles: MM.uniq(obstacles), note: r.pick(NOTES[overall]), status: 'approved', approvedBy: c.leadCoachId,
            approvedAt: d.addMinutes(meet.act.startsAt, r.int(65, 180)), aiRunId: null, docMinutes: null,
          });
          { const ci = S.checkIns[S.checkIns.length - 1]; ci.docMinutes = ci.inputMethod === 'manual' ? r.int(5, 11) : r.int(2, 5); }
          if (overall === 'red') {
            S.deviations.push({ id: nid('dev'), caseId: c.id, createdAt: d.addMinutes(meet.act.startsAt, 70), description: invalids >= 2 ? 'Upprepad ogiltig frånvaro' : 'Planen håller inte – behöver omplanering', assessment: invalids >= 2 ? 'Risk att insatsen avbryts om frånvaron fortsätter.' : 'Deltagaren behöver annan uppläggning.',
              action: invalids >= 2 ? 'Samtal om hinder, ny veckoplan och uppföljningsmöte med handläggaren.' : 'Uppföljningsmöte med handläggaren och ny plan.', ownerId: c.leadCoachId, followUpOn: d.addDays(meet.act.startsAt.slice(0, 10), 7),
              needsCustomerDecision: invalids >= 2, followUpMeetingAt: null, status: (c.status === 'closed' || mon < '2027-01-18') ? 'closed' : 'open' });
          }
        }
      }
    }
    S.meta = { w4MissingActivityIds: [...w4Missing] };

    // Nadia: AI-granskat utkast finns inte; Mehmet: AI-utkast från fredagens möte väntar på granskning
    const mehmet = script.mehmet;
    const mehFri = S.checkIns.filter((x) => x.caseId === mehmet.id).sort(MM.by('heldAt')).pop();
    if (mehFri) {
      mehFri.status = 'draft'; mehFri.approvedAt = null; mehFri.approvedBy = null; mehFri.inputMethod = 'ai_recording';
      const run = { id: 'ai-run-mehmet', caseId: mehmet.id, kind: 'transcribe_extract', provider: 'Berget AI (test)', model: 'KB-Whisper large + öppen språkmodell', status: 'succeeded',
        createdAt: d.addMinutes(mehFri.heldAt, 48), audioSeconds: 2460, costOre: 82, latencyMs: 71000, inputDeletedAt: d.addMinutes(mehFri.heldAt, 49) };
      S.aiRuns.push(run); mehFri.aiRunId = run.id;
      mehFri.ai = {
        // Förslag med belägg (citat + tidpunkt i sekunder). Bedömningsfält (samlad status) föreslås aldrig.
        goalStatus: { value: 'partly', quote: 'Jag hann två leveranser själv, men den tredje åkte jag med Kristina.', t: 312 },
        nextGoal: { value: 'Köra hela distributionsrundan själv en dag', quote: 'Nästa vecka vill jag köra hela rundan själv på tisdag.', t: 1510 },
        phase: { value: 3, quote: 'Vi fortsätter med ruttplaneringen och lastsäkringen.', t: 1622 },
        activitiesDone: { value: ['Yrkesspecifika moment', 'CV och ansökningar'], quote: 'I onsdags gjorde vi lastsäkring, och så skrev vi om CV:t.', t: 205 },
        employerContacts: { value: { count: '1', types: ['praktikkontakt'] }, quote: 'Södertörns Distribution ringde och frågade om praktik i mars.', t: 948 },
        obstacles: { value: ['Språk'], quote: 'Ibland förstår jag inte ruttlappen, orden är svåra.', t: 1133 },
        note: { value: 'Har kört två leveranser på egen hand. Behöver stöd med yrkesord på ruttlappen. Intresse för praktik hos Södertörns Distribution i mars.', quote: 'Framgår av samtalet 03:25–18:53', t: 205 },
        transcript: [
          { t: 205, who: 'Coach', text: 'Vad gjorde ni i onsdags?' }, { t: 212, who: 'Deltagare', text: 'I onsdags gjorde vi lastsäkring, och så skrev vi om CV:t.' },
          { t: 312, who: 'Deltagare', text: 'Jag hann två leveranser själv, men den tredje åkte jag med Kristina.' },
          { t: 948, who: 'Deltagare', text: 'Södertörns Distribution ringde och frågade om praktik i mars.' },
          { t: 1133, who: 'Deltagare', text: 'Ibland förstår jag inte ruttlappen, orden är svåra.' },
          { t: 1510, who: 'Deltagare', text: 'Nästa vecka vill jag köra hela rundan själv på tisdag.' },
          { t: 1622, who: 'Coach', text: 'Vi fortsätter med ruttplaneringen och lastsäkringen.' },
        ],
        audioDeletedAt: run.inputDeletedAt, rawTranscriptDeleteBy: d.addDays(mehFri.heldAt, 30),
      };
      mehFri.goalStatus = null; mehFri.overallStatus = null; mehFri.nextGoal = ''; mehFri.note = ''; mehFri.activitiesDone = []; mehFri.obstacles = []; mehFri.employerContacts = { count: null, types: [] };
      mehFri.tags = ['ai-draft'];
    }

    // ---- Progression: Yusuf utan progression v. 3 och v. 4 (eskaleras), Elif utan progression bara v. 4 (påminnelse)
    for (const ci of S.checkIns.filter((x) => x.caseId === script.yusuf.id && x.heldAt >= '2027-01-18' && x.heldAt < '2027-02-01')) { ci.goalStatus = 'no'; if (ci.overallStatus === 'green') ci.overallStatus = 'yellow'; }
    for (const ci of S.checkIns.filter((x) => x.caseId === script.elif.id)) { ci.goalStatus = ci.heldAt >= '2027-01-25' ? 'no' : 'yes'; if (ci.heldAt >= '2027-01-25' && ci.overallStatus === 'green') { ci.overallStatus = 'yellow'; ci.obstacles = ['Digital vana']; ci.note = 'Hann inte klart med CV:t. Behöver mer tid vid datorn.'; } }
    for (const ci of S.checkIns.filter((x) => x.caseId === script.nadia.id || x.caseId === script.hodan.id)) { if (ci.goalStatus === 'no') ci.goalStatus = 'partly'; }

    // ---- Kartläggning
    for (const c of cases) {
      if (!c.startDate || c.startDate > TODAY) continue;
      const p = S.persons.find((x) => x.id === c.personId);
      const approved = !c.tags.includes('amal') && d.diffDays(c.startDate, TODAY) >= 4;
      S.intakeAssessments.push({
        id: nid('ia'), caseId: c.id,
        workExperience: (c.backgroundInfo || '').split('.')[0] + '.', education: r.pick(['Grundskola i hemlandet', 'Gymnasieutbildning', 'SFI kurs C', 'SFI kurs D', 'Påbörjad gymnasieutbildning']),
        languageNotes: p && p.language !== 'svenska' ? `Förstår vardagssvenska. Modersmål: ${p.language}.` : 'Svenska som modersmål.', digitalSkills: r.pick(['Van vid mobil, ovan vid dator', 'Använder e-post och BankID själv', 'Behöver stöd med digitala tjänster']),
        drivingLicence: r.pick(['B-körkort', 'Inget körkort', 'Inget körkort', 'Övningskör']), workGoals: `Arbete inom ${AREAS.find((a) => a[0] === c.primaryArea)[1].toLowerCase()}`,
        chosenTrack: c.tags.includes('amal') ? '' : c.vocationalTrack, adaptations: p ? p.accessibilityNeeds : '', firstWeekGoal: GOALS[1][0],
        status: approved ? 'approved' : 'draft', approvedBy: approved ? c.leadCoachId : null, approvedAt: approved ? `${d.addDays(c.startDate, r.int(1, 4))}T15:30` : null,
      });
    }

    // ---- Samtycken
    for (const c of cases) {
      if (c.aiConsent === 'given') S.consents.push({ id: nid('cons'), personId: c.personId, caseId: c.id, kind: 'recording_and_ai', textVersion: 'v1.0 (2026-10-01)', givenAt: c.firstMeetingAt || c.confirmedAt, informedBy: c.leadCoachId, language: 'lättläst svenska', revokedAt: null });
      if (c.aiConsent === 'declined') S.consents.push({ id: nid('cons'), personId: c.personId, caseId: c.id, kind: 'recording_and_ai', textVersion: 'v1.0 (2026-10-01)', givenAt: null, declinedAt: c.firstMeetingAt, informedBy: c.leadCoachId, language: 'lättläst svenska', revokedAt: null });
    }

    // ---- Placeringar (praktik) och händelser
    for (const c of cases) {
      if (!c.startDate || c.startDate > TODAY) continue;
      const reachedFour = c.phase >= 4 || (c.status === 'closed' && c.resultClass === 'result');
      if (reachedFour) {
        const emp = S.employers.find((e) => e.areas.includes(c.primaryArea)) || S.employers[0];
        const empId = c.tags.includes('nadia') ? 'emp-1' : emp.id;
        const start = c.tags.includes('nadia') ? '2027-01-25' : d.addDays(c.startDate, Math.floor(c.plannedWeeks * 7 * 0.66));
        if (start <= (c.endDate || TODAY)) {
          S.placements.push({ id: nid('pl'), caseId: c.id, employerId: empId, startsOn: start, endsOn: c.endDate || c.plannedEnd,
            tasks: c.tags.includes('nadia') ? 'Plock och pack, inleverans, truckkörning under handledning' : `Arbetsuppgifter inom ${c.vocationalTrack.toLowerCase()}`,
            supervisorName: S.employers.find((e) => e.id === empId).contactName, goals: 'Klara arbetsuppgifterna i rätt tempo med stöd av handledaren',
            followUpDates: [d.addDays(start, 7), d.addDays(start, 14)], status: c.status === 'closed' ? 'completed' : 'ongoing',
            fourRights: { uppgift: true, handledning: true, timing: true, uppfoljning: !c.tags.includes('nadia') } });
          S.outcomeEvents.push({ id: nid('oe'), caseId: c.id, kind: 'praktik_startad', occurredOn: start, actor: S.employers.find((e) => e.id === empId).name, verificationKind: 'praktikavtal', verificationFile: 'praktikavtal.pdf', note: '' });
        }
      }
      if (c.status === 'closed' && c.resultClass === 'result') {
        const kind = c.endReason === 'arbete' ? 'arbete_paborjat' : 'studier_paborjade';
        const actor = c.endReason === 'arbete' ? (S.employers.find((e) => e.areas.includes(c.primaryArea)) || S.employers[0]).name : r.pick(['Vuxenutbildningen (Komvux) – yrkesutbildning', 'Yrkeshögskola – logistik', 'Folkhögskola – allmän kurs']);
        S.outcomeEvents.push({ id: nid('oe'), caseId: c.id, kind, occurredOn: d.addDays(c.endDate, r.int(-3, 3)), actor,
          verificationKind: c.resultVerifiedAt ? (c.endReason === 'arbete' ? 'anställningsbevis' : 'antagningsbesked') : null, verificationFile: c.resultVerifiedAt ? (c.endReason === 'arbete' ? 'anstallningsbevis.pdf' : 'antagningsbesked.pdf') : null,
          note: c.resultVerifiedAt ? '' : 'Muntlig uppgift – verifiering begärd', possibleBonus: c.endReason === 'arbete' });
      }
      if (c.status === 'active' && c.phase >= 4 && r.chance(0.5)) S.outcomeEvents.push({ id: nid('oe'), caseId: c.id, kind: 'intervju_arbetsgivarkontakt', occurredOn: d.addDays(TODAY, -r.int(2, 12)), actor: (S.employers.find((e) => e.areas.includes(c.primaryArea)) || S.employers[0]).name, verificationKind: null, verificationFile: null, note: 'Anställningsintervju' });
      if (c.tags.includes('hodan')) S.outcomeEvents.push({ id: nid('oe'), caseId: c.id, kind: 'arbetserbjudande', occurredOn: '2027-01-26', actor: 'Tumba Städ & Fastighet AB', verificationKind: 'e-post från arbetsgivare', verificationFile: 'erbjudande.pdf', note: 'Visstidsanställning 75 % från 8 februari' });
    }
    // Några fler arbetserbjudanden bland aktiva i fas 5 (prognos)
    cases.filter((c) => c.status === 'active' && c.phase === 5 && !c.tags.includes('hodan')).slice(0, 3).forEach((c) => S.outcomeEvents.push({ id: nid('oe'), caseId: c.id, kind: 'arbetserbjudande', occurredOn: d.addDays(TODAY, -r.int(1, 8)), actor: (S.employers.find((e) => e.areas.includes(c.primaryArea)) || S.employers[0]).name, verificationKind: null, verificationFile: null, note: 'Erbjudande om provanställning' }));

    // ---- Månadsbedömningar och månadsrapporter
    const months = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
    const levelFor = (area, idx) => { const base = Math.min(3, Math.max(0, Math.round(idx * 0.8 + r.next() * 1.6 - 0.4))); return area === 'ovrigt' && r.chance(0.6) ? 0 : base; };
    for (const c of cases) {
      if (!c.startDate || c.startDate > TODAY) continue;
      let idx = 0;
      for (const mk of months) {
        const mStart = `${mk}-01`; const mEnd = d.monthEnd(mk);
        const actStart = c.startDate > mStart ? c.startDate : mStart; const actEnd = (c.endDate && c.endDate < mEnd) ? c.endDate : mEnd;
        if (actStart > actEnd || d.diffDays(actStart, actEnd) < 10) continue;
        if (mk === '2027-01' && c.status === 'closed' && c.endDate < '2027-01-25') { /* slutrapport i stället */ }
        idx++;
        const isJan = mk === '2027-01';
        const coachFast = ['u-mats', 'u-sofia'].includes(c.leadCoachId);
        const approved = !isJan || (c.status === 'closed') || (coachFast && r.chance(0.7));
        const areas = {};
        // Underlag för AI-utkast: bara godkända avstämningar och registrerad närvaro i månaden
        const monthCis = S.checkIns.filter((x) => x.caseId === c.id && x.status === 'approved' && x.heldAt.slice(0, 7) === mk).sort((a, b) => (a.heldAt < b.heldAt ? -1 : 1));
        const monthActs = S.activities.filter((a) => a.caseId === c.id && a.startsAt.slice(0, 7) === mk && a.startsAt < NOW);
        const monthAtt = monthActs.map((a) => S.attendance.find((x) => x.activityId === a.id)).filter(Boolean);
        const attended = monthAtt.filter((x) => ['present', 'late'].includes(x.status)).length;
        const contacts = monthCis.filter((x) => x.employerContacts && x.employerContacts.count && x.employerContacts.count !== '0').length;
        const srcLabel = (ci) => `Avstämning ${d.fmtDateShort(ci.heldAt)}`;
        const late = monthAtt.filter((x) => x.status === 'late').length; const invalid = monthAtt.filter((x) => x.status === 'absent_invalid').length;
        const goalsMet = monthCis.filter((x) => ['yes', 'partly'].includes(x.goalStatus));
        const withAct = (t) => monthCis.filter((x) => (x.activitiesDone || []).includes(t));
        const allSrc = monthCis.map(srcLabel);
        /** AI-utkast med belägg ur godkända avstämningar och registrerad närvaro. Saknas belägg: "Framgår inte". */
        const evidenceDraft = (key) => {
          const nf = { text: 'Framgår inte av månadens godkända avstämningar.', sources: [], noEvidence: true };
          if (key === 'narvaro_rutiner') return monthAtt.length ? { text: `Närvarande vid ${attended} av ${monthAtt.length} registrerade tillfällen${late ? `, varav ${late} med sen ankomst` : ''}.${invalid ? ` ${invalid} ogiltig frånvaro.` : ' Ingen ogiltig frånvaro.'}`, sources: ['Närvaroregistrering', ...allSrc.slice(-1)] } : nf;
          if (key === 'arbetsgivarkontakter') return contacts ? { text: `Arbetsgivarkontakt registrerad ${contacts === 1 ? 'en vecka' : `${contacts} veckor`} (${MM.uniq(monthCis.flatMap((x) => (x.employerContacts && x.employerContacts.types) || [])).join(', ')}).`, sources: monthCis.filter((x) => x.employerContacts && x.employerContacts.count && x.employerContacts.count !== '0').map(srcLabel) } : { text: 'Ingen arbetsgivarkontakt framgår av avstämningarna.', sources: allSrc, noEvidence: true };
          if (key === 'yrkesfardigheter' && withAct('Yrkesspecifika moment').length) return { text: `Yrkesspecifika moment genomförda ${withAct('Yrkesspecifika moment').length} av ${monthCis.length} veckor.`, sources: withAct('Yrkesspecifika moment').map(srcLabel) };
          if (key === 'beredskap' && withAct('Praktik/APL').length) return { text: `Har genomfört praktik ${withAct('Praktik/APL').length === 1 ? 'en vecka' : `${withAct('Praktik/APL').length} veckor`} under månaden.`, sources: withAct('Praktik/APL').map(srcLabel) };
          if (key === 'sjalvstandighet' && monthCis.length) return { text: `Veckomålet uppnått helt eller delvis ${goalsMet.length} av ${monthCis.length} veckor.`, sources: allSrc };
          if (key === 'digital_sjalvstandighet' && withAct('CV och ansökningar').length) return { text: `Har arbetat med CV och ansökningar ${withAct('CV och ansökningar').length === 1 ? 'en vecka' : `${withAct('CV och ansökningar').length} veckor`}.`, sources: withAct('CV och ansökningar').map(srcLabel) };
          return nf;
        };
        for (const key of CONFIG_BOT.progression.areas) {
          const lvl = levelFor(key, idx);
          const aiLevel = Math.max(0, Math.min(3, lvl + r.pick([0, 0, 1, -1])));
          areas[key] = approved
            ? { level: lvl, observation: lvl >= 1 ? r.pick(OBS[key]) : '', nextStep: NEXT[key], aiLevelSuggestion: null, aiObservationDraft: null }
            : { level: null, observation: '', nextStep: '', aiLevelSuggestion: c.aiConsent === 'given' ? aiLevel : null,
                aiObservationDraft: c.aiConsent === 'given' && monthCis.length ? evidenceDraft(key) : null };
          if (!approved && areas[key].aiObservationDraft && areas[key].aiObservationDraft.noEvidence) areas[key].aiLevelSuggestion = null;
        }
        const ma = { id: nid('ma'), caseId: c.id, month: mk, areas, status: approved ? 'approved' : 'draft', decidedBy: approved ? c.leadCoachId : null, decidedAt: approved ? `${d.nthWorkingDay(d.addMonths(mk, 1), r.int(1, 4))}T14:00` : null,
          summary: approved ? 'Deltagaren följer planen och har gjort tydlig progression inom yrkesfärdigheter. Fortsatt fokus på tempo och arbetsgivarkontakter.' : '',
          aiSummaryDraft: !approved && c.aiConsent === 'given' && monthCis.length ? `Under ${d.MON[Number(mk.slice(5)) - 1]} deltog deltagaren i ${attended} av ${monthAtt.length} registrerade tillfällen. ${contacts ? `Arbetsgivarkontakter fanns ${contacts === 1 ? 'en vecka' : `${contacts} veckor`}.` : 'Inga arbetsgivarkontakter framgår.'} (Källa: ${monthCis.length} godkända avstämningar, ${monthCis.map((x) => d.fmtDateShort(x.heldAt)).join(', ')}.)` : null,
          overallStatus: approved ? r.weighted([['green', 70], ['yellow', 25], ['red', 5]]) : null };
        if (approved && ma.decidedAt >= NOW) ma.decidedAt = `${d.addDays(TODAY, -r.int(0, 3))}T${String(r.int(8, 8)).padStart(2, '0')}:${String(r.int(0, 55)).padStart(2, '0')}`;
        if (approved && ma.decidedAt >= NOW) ma.decidedAt = `${d.addDays(TODAY, -3)}T15:00`;
        S.monthlyAssessments.push(ma);
        S.monthlyPlans.push({ id: nid('mp'), caseId: c.id, month: mk, goal1: r.pick(GOALS[Math.min(5, c.phase)]), goal2: r.pick(GOALS[Math.min(5, c.phase + 1)] || GOALS[5]),
          plannedActivities: 'Yrkesmoment två dagar i veckan och en coachträff', plannedEmployerContact: c.phase >= 3 ? 'Studiebesök hos arbetsgivare inom spåret' : 'Inget planerat', plannedAdaptation: '', nextCustomerMeeting: approved ? null : '2027-02-15', status: approved ? 'approved' : 'draft' });
        // Rapport
        const dueDay = d.nthWorkingDay(d.addMonths(mk, 1), 5);
        let status = 'draft', deliveredAt = null, approvedAt = null, openedAt = null;
        if (approved) {
          status = 'delivered'; approvedAt = ma.decidedAt; deliveredAt = d.addMinutes(ma.decidedAt, r.int(10, 120)); openedAt = r.chance(0.8) ? d.addDays(deliveredAt, r.int(0, 3)) : null;
          if (isJan && r.chance(0.3)) { status = 'approved'; deliveredAt = null; openedAt = null; }
          if (openedAt && openedAt > NOW) openedAt = null;
          if (deliveredAt && deliveredAt > NOW) { deliveredAt = null; status = 'approved'; }
        }
        S.reports.push({ id: nid('rep'), contractId: 'c-bot', caseId: c.id, kind: 'monthly', periodStart: `${mk}-01`, periodEnd: d.monthEnd(mk), month: mk, status, version: 1,
          dueAt: `${dueDay}T23:59`, approvedBy: approvedAt ? c.leadCoachId : null, approvedAt, deliveredAt, deliveredTo: deliveredAt ? [c.referrerId] : [], openedAt, provisionalDue: true });
      }
    }
    // En decemberrapport levererades sent (för KPI)
    const lateDec = S.reports.find((x) => x.kind === 'monthly' && x.month === '2026-12' && x.status === 'delivered');
    if (lateDec) lateDec.deliveredAt = d.addMinutes(lateDec.dueAt, 60 * 17 + 15);

    // ---- Slutrapporter
    for (const c of cases.filter((x) => x.status === 'closed')) {
      const due = d.addWorkingDays(`${c.endDate}T23:59`, CONFIG_BOT.sla.find((x) => x.key === 'slutrapport').proposal.workingDays);
      let status = 'delivered', delivered = d.addDays(c.closedAt, r.int(1, 4)); if (delivered > due) delivered = d.addMinutes(due, -600);
      if (c.tags.includes('slutsen')) { status = 'draft'; delivered = null; }
      if (delivered && delivered > NOW) { status = c.endDate >= '2027-01-27' ? 'draft' : 'approved'; delivered = null; }
      S.reports.push({ id: nid('rep'), contractId: 'c-bot', caseId: c.id, kind: 'final', periodStart: c.startDate, periodEnd: c.endDate, status, version: 1, dueAt: due, approvedBy: delivered ? c.leadCoachId : null,
        approvedAt: delivered ? d.addMinutes(delivered, -30) : null, deliveredAt: delivered, deliveredTo: delivered ? [c.referrerId] : [], openedAt: delivered && r.chance(0.7) ? d.addDays(delivered, 1) : null, provisionalDue: true });
    }
    // Orderbekräftelser
    for (const c of cases.filter((x) => x.confirmedAt)) {
      S.reports.push({ id: nid('rep'), contractId: 'c-bot', caseId: c.id, kind: 'order_confirmation', periodStart: c.referredAt.slice(0, 10), periodEnd: c.referredAt.slice(0, 10), status: 'delivered', version: 1,
        dueAt: d.addWorkingDays(c.referredAt, 1), approvedBy: 'u-sara', approvedAt: c.confirmedAt, deliveredAt: c.confirmedAt, deliveredTo: [c.referrerId], openedAt: d.addMinutes(c.confirmedAt, r.int(20, 600)) > NOW ? null : d.addMinutes(c.confirmedAt, r.int(20, 600)) });
    }
    // Veckorapporter per handläggare och vecka (måndag 16.00 för föregående vecka)
    for (let mon = d.monday('2026-09-14'); mon < d.monday(TODAY); mon = d.addDays(mon, 7)) {
      const wk = d.isoWeek(mon); const repMon = d.addDays(mon, 7);
      for (const k of S.customerUsers.filter((x) => x.role === 'handlaggare')) {
        const has = cases.some((c) => c.referrerId === k.id && c.startDate && c.startDate <= d.addDays(mon, 6) && (!c.endDate || c.endDate >= mon));
        if (!has) continue;
        const dueAt = `${repMon}T16:00`; let deliveredAt = `${repMon}T${r.pick(['07:00', '09:40', '10:05', '11:20'])}`;
        if (wk.key === '2026-W47' && k.id === 'k-linda') deliveredAt = `${repMon}T16:40`;
        let status = 'delivered';
        if (wk.key === '2027-W04') {
          const waitingFor = new Set(S.activities.filter((a) => w4Missing.has(a.id)).map((a) => (cases.find((x) => x.id === a.caseId) || {}).referrerId));
          const waiting = waitingFor.has(k.id); deliveredAt = waiting ? null : `${repMon}T07:00`; status = waiting ? 'waiting' : 'delivered';
        }
        S.reports.push({ id: nid('rep'), contractId: 'c-bot', caseId: null, recipientUserId: k.id, kind: 'weekly_attendance', week: wk.key, periodStart: mon, periodEnd: d.addDays(mon, 6), status, version: 1,
          dueAt, approvedBy: 'system', approvedAt: deliveredAt, deliveredAt, deliveredTo: deliveredAt ? [k.id] : [], openedAt: deliveredAt && wk.key !== '2027-W04' && r.chance(0.85) ? d.addMinutes(deliveredAt, r.int(30, 2000)) : null });
      }
    }
    // Beställarrapporter (kommunens chef) per månad
    for (const mk of ['2026-10', '2026-11', '2026-12', '2027-01']) {
      const due = d.nthWorkingDay(d.addMonths(mk, 1), 8);
      const done = mk !== '2027-01';
      S.reports.push({ id: nid('rep'), contractId: 'c-bot', caseId: null, recipientUserId: 'k-eva', kind: 'customer_summary', month: mk, periodStart: `${mk}-01`, periodEnd: d.monthEnd(mk), status: done ? 'delivered' : 'draft', version: 1,
        dueAt: `${due}T16:00`, approvedBy: done ? 'u-johan' : null, approvedAt: done ? `${d.addDays(due, -2)}T10:00` : null, deliveredAt: done ? `${d.addDays(due, -2)}T10:05` : null, deliveredTo: done ? ['k-eva'] : [], openedAt: done ? `${d.addDays(due, -1)}T08:30` : null,
        aiSummaryDraft: done ? null : 'I januari var 71 deltagare aktiva och 43 nya ärenden startade. 29 insatser avslutades, varav 10 till arbete eller studier. Närvarograden var 89 procent. En avvikelse har hanterats med åtgärdsplan.' });
    }

    // ---- Avtalsavvikelser
    S.contractDeviations.push(
      { id: 'cd-1', contractId: 'c-bot', source: 'intern', type: 'process', level: 'mindre', escalationStep: 0, description: 'Veckorapporten för vecka 47 till en handläggare publicerades 16.40 i stället för senast 16.00.', raisedAt: '2026-11-23T16:45',
        actionPlan: 'Påminnelse till coacher fredag 14.00 och måndag 08.00. Saknad registrering eskaleras till samordnaren 10.00.', actionPlanDue: '2026-11-30', customerApprovedAt: '2026-11-30T11:00', warningIssued: false, penaltyOre: 0, status: 'closed', lessons: 'Automatisk eskalering infördes.' },
      { id: 'cd-2', contractId: 'c-bot', source: 'beställare', type: 'kvalitet', level: 'större', escalationStep: 1, description: 'Månadsrapport för december saknade konkret observation för två progressionsområden.', raisedAt: '2027-01-08T09:20',
        actionPlan: 'Systemet stoppar godkännande om observation saknas från nivå 1. Genomgång med alla coacher på APT 2027-01-14.', actionPlanDue: '2027-02-05', customerApprovedAt: '2027-01-15T14:10', warningIssued: false, penaltyOre: 0, status: 'action_plan', lessons: '' },
      { id: 'cd-3', contractId: 'c-bot', source: 'deltagare', type: 'klagomål', level: 'mindre', escalationStep: 0, description: 'Deltagare upplevde att praktikplatsen inte var förberedd första dagen.', raisedAt: '2027-01-14T13:05',
        actionPlan: 'Checklista "fyra rätt" gås igenom med arbetsgivaren före varje praktikstart.', actionPlanDue: '2027-02-12', customerApprovedAt: null, warningIssued: false, penaltyOre: 0, status: 'open', lessons: '' },
    );

    // ---- Puls (vecka 2 och avslut)
    let pulseN = 0;
    for (const c of cases) {
      if (!c.startDate || c.startDate > TODAY || c.tags.includes('skyddad')) continue;
      const occ = [];
      if (d.addDays(c.startDate, 8) <= TODAY) occ.push(['week2', d.addDays(c.startDate, 8)]);
      if (c.status === 'closed') occ.push(['exit', d.addDays(c.endDate, 1)]);
      for (const [occasion, sent] of occ) {
        pulseN++;
        const inv = { id: nid('pi'), caseId: c.id, channel: S.persons.find((p) => p.id === c.personId).preferredContact === 'email' ? 'email' : 'sms', language: 'sv', occasion, sentAt: `${sent}T10:00`, expiresAt: `${d.addDays(sent, 7)}T10:00`, usedAt: null };
        S.pulseInvites.push(inv);
        if (r.chance(0.63)) {
          inv.usedAt = `${d.addDays(sent, r.int(0, 3))}T${r.pick(['12:10', '18:40', '20:05'])}`;
          if (inv.usedAt > NOW) { inv.usedAt = null; continue; }
          const q1 = r.weighted([[5, 42], [4, 39], [3, 12], [2, 5], [1, 2]]);
          const q3 = r.weighted([[5, 48], [4, 38], [3, 14]]);
          S.pulseResponses.push({ id: nid('pr'), inviteId: inv.id, caseId: c.id, coachId: c.leadCoachId, occasion, language: r.weighted([['sv', 70], ['so', 12], ['ar', 12], ['en', 6]]),
            answers: { q1, q2: r.weighted([[5, 30], [4, 40], [3, 20], [2, 7], [1, 3]]), q3, q4: r.pick(['jobb', 'praktik', 'utbildning', 'svenska', 'annat']), q5: 'nej' },
            text: '', contactRequested: false, submittedAt: inv.usedAt });
        }
      }
    }
    // Kontaktönskemål och lågt betyg på fråga 3 (senaste veckorna)
    const recentResp = S.pulseResponses.filter((x) => x.submittedAt >= '2027-01-18').slice(0, 5);
    recentResp.slice(0, 3).forEach((x, i) => { x.answers.q5 = 'ja'; x.contactRequested = true; x.text = ['Jag vill prata om min praktik.', '', 'Kan någon ringa mig om schemat?'][i]; });
    const low = recentResp[3] || S.pulseResponses[S.pulseResponses.length - 1]; if (low) { low.answers.q3 = 2; low.text = 'Jag får inte svar när jag ringer.'; }
    // Deltagarens egen länk i demot (Nadia, pulsmätning vid avslut förhandsvisas som vecka 2-länk)
    S.pulseInvites.push({ id: 'pi-demo', caseId: script.nadia.id, channel: 'sms', language: 'sv', occasion: 'periodic', sentAt: '2027-02-01T08:00', expiresAt: '2027-02-08T08:00', usedAt: null, demo: true });

    // ---- Inkorgen (mejl till avrop@) i dag och i fredags
    const lastNo = () => { S.caseCounters['c-bot:2027']++; return `BOT-27-${String(S.caseCounters['c-bot:2027']).padStart(4, '0')}`; };
    const mkInboxCase = (tag, refAt, referrerId, area, track, weeks, source, personOver, extra = {}) => {
      const number = lastNo(); const p = makePerson(personOver);
      const c = { id: `case-${number.slice(4).replace('-', '')}`, number, contractId: 'c-bot', personId: p.id, status: 'acknowledged', source, referredAt: refAt, referrerId,
        buyerReference: extra.buyerReference !== undefined ? extra.buyerReference : brFor(referrerId), purchaseOrderNumber: null, primaryArea: area, secondaryArea: extra.secondaryArea || null,
        vocationalTrack: track, desiredStart: extra.desiredStart || d.addDays(refAt.slice(0, 10), 7), plannedWeeks: weeks, plannedEnd: null, acknowledgedAt: d.addMinutes(refAt, 2),
        confirmedAt: null, firstMeetingAt: null, startDate: null, endDate: null, endReason: null, resultClass: null, resultVerifiedAt: null, phase: 1, leadCoachId: null, team: [],
        backgroundInfo: extra.background || BACKGROUND[area], aiConsent: 'not_asked', meetingDay: null, meetingTime: null, location: 'Alby', pausedWeeks: [], tags: [tag], orderValueWeeks: weeks, declineReason: null };
      cases.push(c); script[tag] = c;
      S.caseStatusHistory.push({ id: nid('csh'), caseId: c.id, fromStatus: null, toStatus: 'acknowledged', changedBy: 'system', changedAt: c.acknowledgedAt, reason: 'Ordererkännande skickat automatiskt' });
      return c;
    };
    const cLinda = mkInboxCase('inkorg-brattom', '2027-01-29T10:05', 'k-linda', 'G', 'Lagerarbetare – plock och pack', 8, 'email', { firstName: 'Tesfaye', lastName: 'Haile', language: 'tigrinja', city: 'Fittja', preferredContact: 'sms' }, { desiredStart: '2027-02-08' });
    const cAhmed = mkInboxCase('inkorg-fritext', '2027-01-29T15:20', 'k-ahmed', 'D', 'Restaurangbiträde', 6, 'email', { firstName: 'Rasha', lastName: 'Khalaf', language: 'arabiska', city: 'Tumba', preferredContact: 'phone' }, { buyerReference: null, desiredStart: '2027-02-08' });
    const cMaria = mkInboxCase('inkorg-mall', '2027-02-01T08:41', 'k-maria', 'J', 'Butikssäljare', 10, 'email', { firstName: 'Diego', lastName: 'Morales', language: 'spanska', city: 'Alby', preferredContact: 'email' }, { desiredStart: '2027-02-15', secondaryArea: 'H' });
    const emailBody = (c, p, fields) => fields;
    const personOf = (c) => S.persons.find((p) => p.id === c.personId);
    const templateExtract = (c, conf = 0.99) => {
      const p = personOf(c); const k = S.customerUsers.find((u) => u.id === c.referrerId);
      const ex = { referrerName: k.name, referrerUnit: k.unit, referrerPhone: k.phone, referrerEmail: k.email, buyerReference: c.buyerReference || '',
        desiredStart: c.desiredStart, plannedEnd: d.addDays(c.desiredStart, c.plannedWeeks * 7 - 3), plannedWeeks: c.plannedWeeks, firstName: p.firstName, lastName: p.lastName,
        pnr: p.pnr, phone: p.phone, email: p.email, city: p.city, preferredContact: p.preferredContact, protectedIdentity: false, accessibilityNeeds: p.accessibilityNeeds || '',
        primaryArea: c.primaryArea, secondaryArea: c.secondaryArea || '', vocationalTrack: c.vocationalTrack, background: c.backgroundInfo };
      const confidence = {}; for (const kk of Object.keys(ex)) confidence[kk] = conf; return { ex, confidence };
    };
    const t1 = templateExtract(cMaria);
    S.inboundEmails.push({ id: 'em-101', graphMessageId: 'AAMk-demo-101', receivedAt: cMaria.referredAt, fromAddress: 'maria.ekdahl@botkyrka.se', fromName: 'Maria Ekdahl',
      subject: 'Avrop – yrkesinriktad insats, handel', bodyText: 'Hej!\n\nHär kommer ett avrop enligt bifogad mall.\n\nMed vänlig hälsning\nMaria Ekdahl\nHandläggare, Arbetsmarknadsenheten Alby\nBotkyrka kommun',
      attachments: [{ name: 'Avropsmall_01_ifylld.docx', kind: 'docx' }], parseMethod: 'template', classification: 'order', extracted: t1.ex, confidence: t1.confidence, missingFields: [],
      status: 'acknowledged', caseId: cMaria.id, ackSentAt: d.addMinutes(cMaria.referredAt, 2), handledBy: null, handledAt: null });
    const t2 = templateExtract(cLinda);
    S.inboundEmails.push({ id: 'em-106', graphMessageId: 'AAMk-demo-106', receivedAt: cLinda.referredAt, fromAddress: 'linda.karlsson@botkyrka.se', fromName: 'Linda Karlsson',
      subject: 'Beställning lager/logistik', bodyText: 'Hej,\nBifogar avrop för en deltagare som vill arbeta inom lager.\n\n/Linda Karlsson\nArbetsmarknadsenheten Hallunda–Fittja',
      attachments: [{ name: 'Avropsmall_01.docx', kind: 'docx' }], parseMethod: 'template', classification: 'order', extracted: t2.ex, confidence: t2.confidence, missingFields: [],
      status: 'acknowledged', caseId: cLinda.id, ackSentAt: d.addMinutes(cLinda.referredAt, 2), handledBy: null, handledAt: null });
    const t3 = templateExtract(cAhmed, 0.9);
    // Fritext: AI får bara föra över det som står i mejlet – resten lämnas tomt ("Framgår inte")
    for (const k0 of ['city', 'vocationalTrack', 'preferredContact', 'secondaryArea', 'email', 'accessibilityNeeds']) { t3.ex[k0] = ''; t3.confidence[k0] = 0; }
    t3.ex.background = 'Har jobbat i kök i Syrien. Vill börja så snart som möjligt.'; t3.confidence.background = 0.86;
    t3.ex.preferredContact = 'phone'; t3.confidence.preferredContact = 0.81; t3.ex.desiredStart = '2027-02-08'; t3.confidence.desiredStart = 0.7;
    t3.ex.buyerReference = ''; t3.confidence.buyerReference = 0; t3.ex.primaryArea = 'D'; t3.confidence.primaryArea = 0.72; t3.ex.secondaryArea = ''; t3.ex.plannedWeeks = 6; t3.confidence.plannedWeeks = 0.64;
    t3.ex.pnr = personOf(cAhmed).pnr; t3.confidence.pnr = 0.97; t3.ex.email = ''; t3.confidence.email = 0; t3.ex.accessibilityNeeds = ''; t3.ex.plannedEnd = ''; t3.confidence.plannedEnd = 0;
    S.inboundEmails.push({ id: 'em-102', graphMessageId: 'AAMk-demo-102', receivedAt: cAhmed.referredAt, fromAddress: 'ahmed.yusuf@botkyrka.se', fromName: 'Ahmed Yusuf',
      subject: 'Ny deltagare till er – kök', bodyText: `Hej!\n\nJag skulle vilja anvisa ${personOf(cAhmed).firstName} ${personOf(cAhmed).lastName} (${personOf(cAhmed).pnr}) till en insats inom kök och restaurang, ungefär sex veckor. Hon har jobbat i kök i Syrien och vill gärna börja så snart som möjligt, helst v. 6. Hon nås på ${personOf(cAhmed).phone}, bäst att ringa.\n\nMvh Ahmed Yusuf\nHandläggare, Arbetsmarknadsenheten Tumba\n${S.customerUsers.find((u) => u.id === 'k-ahmed').phone}`,
      attachments: [], parseMethod: 'ai', classification: 'order', extracted: t3.ex, confidence: t3.confidence, missingFields: ['buyerReference', 'plannedEnd'],
      status: 'acknowledged', caseId: cAhmed.id, ackSentAt: d.addMinutes(cAhmed.referredAt, 3), handledBy: null, handledAt: null, aiRunId: 'ai-run-mail-102' });
    S.aiRuns.push({ id: 'ai-run-mail-102', caseId: cAhmed.id, kind: 'parse_email', provider: 'Berget AI (test)', model: 'öppen språkmodell', status: 'succeeded', createdAt: d.addMinutes(cAhmed.referredAt, 1), costOre: 3, latencyMs: 6200 });
    S.inboundEmails.push({ id: 'em-103', graphMessageId: 'AAMk-demo-103', receivedAt: '2027-02-01T08:02', fromAddress: 'ahmed.yusuf@botkyrka.se', fromName: 'Ahmed Yusuf',
      subject: `SV: Vi har tagit emot er beställning – ${cAhmed.number}`, bodyText: 'Hej,\nBeställarreferens: 55102938\nPlanerat slutdatum: 19 mars.\n\n/Ahmed',
      attachments: [], parseMethod: 'ai', classification: 'supplement', extracted: { buyerReference: '55102938', plannedEnd: '2027-03-19' }, confidence: { buyerReference: 0.98, plannedEnd: 0.9 }, missingFields: [],
      status: 'linked', caseId: cAhmed.id, linkedBy: 'ärendenummer i ämnesraden', ackSentAt: null, handledBy: null, handledAt: null });
    S.inboundEmails.push({ id: 'em-104', graphMessageId: 'AAMk-demo-104', receivedAt: '2027-02-01T07:55', fromAddress: 'omar.farah@botkyrka.se', fromName: 'Omar Farah',
      subject: 'Avrop – skyddade personuppgifter', bodyText: `Hej,\nJag behöver anvisa en person med skyddade personuppgifter. Ring mig på ${S.customerUsers.find((u) => u.id === 'k-omar').phone} så tar vi uppgifterna enligt rutinen.\n\n/Omar Farah`,
      attachments: [], parseMethod: 'manual', classification: 'order_protected', extracted: {}, confidence: {}, missingFields: [], status: 'protected', caseId: null,
      ackSentAt: '2027-02-01T07:57', ackKind: 'generic', handledBy: null, handledAt: null });
    S.inboundEmails.push({ id: 'em-105', graphMessageId: 'AAMk-demo-105', receivedAt: '2027-02-01T08:20', fromAddress: 'maria.ekdahl@botkyrka.se', fromName: 'Maria Ekdahl',
      subject: `Fråga om schema ${script.nadia.number}`, bodyText: `Hej! Gäller ${script.nadia.number}. Vilka dagar är praktiken den här veckan? Jag vill boka ett uppföljningsmöte.\n/Maria`,
      attachments: [], parseMethod: 'ai', classification: 'other', extracted: {}, confidence: {}, missingFields: [], status: 'other', caseId: script.nadia.id, linkedBy: 'ärendenummer i texten', ackSentAt: null, handledBy: null, handledAt: null });
    // Hanterade mejl de senaste två veckorna (historik)
    for (const c of cases.filter((x) => x.source === 'email' && x.referredAt >= '2027-01-18' && x.confirmedAt && !x.tags.some((t) => t.startsWith('inkorg')))) {
      const t = templateExtract(c); const k = S.customerUsers.find((u) => u.id === c.referrerId);
      S.inboundEmails.push({ id: nid('em'), graphMessageId: `AAMk-${c.id}`, receivedAt: c.referredAt, fromAddress: k.email, fromName: k.name, subject: 'Avrop enligt mall',
        bodyText: 'Hej!\nSe bifogat avrop.\n/' + k.name, attachments: [{ name: 'Avropsmall_01.docx', kind: 'docx' }], parseMethod: r.chance(0.8) ? 'template' : 'ai', classification: 'order',
        extracted: t.ex, confidence: t.confidence, missingFields: [], status: 'accepted', caseId: c.id, ackSentAt: c.acknowledgedAt, handledBy: 'u-sara', handledAt: c.confirmedAt });
    }

    // ---- Meddelanden
    const nadia = script.nadia, yusuf = script.yusuf;
    S.messages.push(
      { id: 'msg-1', caseId: nadia.id, senderId: 'k-maria', body: 'Hej! Hur går praktiken? Behöver hon stöd med resorna till Hallunda?', createdAt: '2027-01-27T09:14', readBy: ['u-amira'], readAt: '2027-01-27T10:02' },
      { id: 'msg-2', caseId: nadia.id, senderId: 'u-amira', body: 'Hej Maria! Det går bra. Hon tar bussen själv sedan i måndags. Jag återkommer efter uppföljningen med handledaren på torsdag.', createdAt: '2027-01-27T10:10', readBy: ['k-maria'], readAt: '2027-01-27T13:40' },
      { id: 'msg-3', caseId: nadia.id, senderId: 'k-maria', body: 'Tack! Kan vi ses på ett uppföljningsmöte vecka 6? Jag kan tisdag eller torsdag förmiddag.', createdAt: '2027-02-01T08:15', readBy: [], readAt: null },
      { id: 'msg-4', caseId: yusuf.id, senderId: 'u-amira', body: 'Hej Maria. Deltagaren har varit borta utan att meddela två gånger inom 14 dagar. Jag föreslår ett uppföljningsmöte för att gå igenom planen. Förslag på tider: onsdag 3/2 kl. 10 eller torsdag 4/2 kl. 14.', createdAt: '2027-01-28T11:30', readBy: ['k-maria'], readAt: '2027-01-28T12:05' },
      { id: 'msg-5', caseId: yusuf.id, senderId: 'k-maria', body: 'Onsdag kl. 10 passar. Jag kommer till Alby.', createdAt: '2027-01-29T08:50', readBy: ['u-amira'], readAt: '2027-01-29T09:30' },
      { id: 'msg-6', caseId: script.reffel1.id, senderId: 'u-johan', body: 'Hej Ahmed. Decemberfakturan returnerades eftersom beställarreferensen 55102983 inte finns hos er. Kan du bekräfta rätt referens?', createdAt: '2027-01-13T10:00', readBy: ['k-ahmed'], readAt: '2027-01-13T11:00' },
      { id: 'msg-7', caseId: script.reffel1.id, senderId: 'k-ahmed', body: 'Förlåt, siffrorna blev omkastade. Rätt referens är 55102938. Den gäller båda mina ärenden från november.', createdAt: '2027-01-14T08:40', readBy: ['u-johan'], readAt: '2027-01-14T09:00' },
    );

    // ---- Fakturastatus för tidigare månader (en faktura per ärende och månad)
    S.billingRuns.push(
      { id: 'br-2026-09', month: '2026-09', status: 'closed', createdBy: 'u-lars', createdAt: '2026-10-02T09:00' },
      { id: 'br-2026-10', month: '2026-10', status: 'closed', createdBy: 'u-lars', createdAt: '2026-11-03T09:00' },
      { id: 'br-2026-11', month: '2026-11', status: 'closed', createdBy: 'u-lars', createdAt: '2026-12-02T09:00' },
      { id: 'br-2026-12', month: '2026-12', status: 'closed', createdBy: 'u-lars', createdAt: '2027-01-05T09:00' },
      { id: 'br-2027-01', month: '2027-01', status: 'draft', createdBy: 'system', createdAt: '2027-02-01T06:00' },
    );
    S.invoiceStatus = { '2026-09': { default: 'paid' }, '2026-10': { default: 'paid' }, '2026-11': { default: 'paid' }, '2026-12': { default: 'sent' }, '2027-01': { default: 'draft' } };
    S.invoiceStatus['2026-12'][script.reffel1.id] = 'returned'; S.invoiceStatus['2026-12'][script.reffel2.id] = 'returned';
    S.invoiceStatus['2026-11'][script.reffel1.id] = 'paid'; // november gick igenom manuellt via fakturaportalen
    S.billingApprovals = { '2027-01': { zeroWeeks: {}, approved: {}, manual: {} } };

    // ---- Revisionslogg (urval, senaste dygnen)
    const A = (at, actor, action, entity, entityId, details = {}) => S.auditLog.push({ id: nid('log'), occurredAt: at, actorId: actor, action, entity, entityId, contractId: 'c-bot', details });
    A('2027-01-29T10:05', 'system', 'email.received', 'inbound_email', 'em-106', { parseMethod: 'template' });
    A('2027-01-29T10:07', 'system', 'case.created', 'case', cLinda.id, { number: cLinda.number, source: 'email' });
    A('2027-01-29T10:07', 'system', 'notify.email', 'case', cLinda.id, { template: 'ordererkannande', to: 'handläggare' });
    A('2027-01-29T15:20', 'system', 'email.received', 'inbound_email', 'em-102', { parseMethod: 'ai' });
    A('2027-01-29T15:21', 'system', 'ai.run', 'ai_run', 'ai-run-mail-102', { kind: 'parse_email', provider: 'Berget AI (test)' });
    A('2027-01-29T15:23', 'system', 'case.created', 'case', cAhmed.id, { number: cAhmed.number, source: 'email', missing: ['beställarreferens'] });
    A('2027-01-29T14:02', 'system', 'ai.run', 'ai_run', 'ai-run-mehmet', { kind: 'transcribe_extract', audioDeleted: true });
    A('2027-01-29T14:01', 'system', 'audio.deleted', 'ai_run', 'ai-run-mehmet', { reason: 'Transkribering klar' });
    A('2027-01-29T16:10', 'u-karin', 'report.view', 'report', 'customer_summary-2026-12', {});
    A('2027-02-01T06:00', 'system', 'kpi.computed', 'contract', 'c-bot', { kpi: 'resultatgrad', window: 'rolling_6m' });
    A('2027-02-01T07:00', 'system', 'report.published', 'report', 'weekly-W04', { count: 2, waiting: 1 });
    A('2027-02-01T07:55', 'system', 'email.received', 'inbound_email', 'em-104', { classification: 'skyddade personuppgifter' });
    A('2027-02-01T07:57', 'system', 'notify.email', 'inbound_email', 'em-104', { template: 'generisk_mottagningsbekraftelse' });
    A('2027-02-01T08:02', 'system', 'email.linked', 'inbound_email', 'em-103', { caseId: cAhmed.id, via: 'ärendenummer i ämnesraden' });
    A('2027-02-01T08:15', 'k-maria', 'message.sent', 'case', nadia.id, {});
    A('2027-02-01T08:41', 'system', 'email.received', 'inbound_email', 'em-101', { parseMethod: 'template' });
    A('2027-02-01T08:43', 'system', 'case.created', 'case', cMaria.id, { number: cMaria.number, source: 'email' });
    A('2027-02-01T08:43', 'system', 'notify.email', 'case', cMaria.id, { template: 'ordererkannande', to: 'handläggare' });
    A('2027-02-01T08:50', 'u-sara', 'case.view', 'case', nadia.id, {});
    A('2027-02-01T09:05', 'u-lars', 'billing.view', 'billing_run', 'br-2027-01', {});

    // ---- Utskick (e-post/SMS) – innehåller aldrig personuppgifter
    const N = (at, channel, to, template, body, caseId) => S.notifications.push({ id: nid('ntf'), at, channel, to, template, body, caseId });
    N('2027-01-29T10:07', 'email', 'linda.karlsson@botkyrka.se', 'ordererkannande', `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${cLinda.number}. Ni får besked om startdatum och ansvarig coach senast måndag 1 februari kl. 10.05. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`, cLinda.id);
    N('2027-01-29T15:23', 'email', 'ahmed.yusuf@botkyrka.se', 'ordererkannande', `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${cAhmed.number}. Ni får besked om startdatum och ansvarig coach senast måndag 1 februari kl. 15.20.\n\nVi saknar följande uppgifter. Svara på det här mejlet med:\n• Beställarreferens (8–10 siffror)\n• Planerat slutdatum\n\nAnvänd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`, cAhmed.id);
    N('2027-02-01T07:57', 'email', 'omar.farah@botkyrka.se', 'generisk_mottagningsbekraftelse', 'Tack för ditt mejl. Vi har tagit emot det och ringer dig i dag.', null);
    N('2027-02-01T08:43', 'email', 'maria.ekdahl@botkyrka.se', 'ordererkannande', `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${cMaria.number}. Ni får besked om startdatum och ansvarig coach senast tisdag 2 februari kl. 08.41. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`, cMaria.id);
    N('2027-01-31T18:00', 'sms', '070-*** ** 12', 'motespaminnelse', 'Påminnelse: möte i morgon kl. 10.00 hos Miljonbemanning i Alby. Frågor? Ring 08-000 00 00.', nadia.id);
    N('2027-02-01T08:00', 'sms', '070-*** ** 12', 'pulslank', 'Hej! Hur går det hos oss? Svara på fem korta frågor: portal.miljonbemanning.se/p/••••• Länken gäller i 7 dagar. Det är frivilligt att svara.', nadia.id);
    N('2027-01-29T14:00', 'email', 'maria.ekdahl@botkyrka.se', 'nytt_meddelande', `Du har ett nytt meddelande om ärende ${yusuf.number} – logga in för att läsa.`, yusuf.id);
    N('2027-02-01T07:00', 'email', 'ahmed.yusuf@botkyrka.se', 'ny_rapport', 'Veckorapporten för vecka 4 finns i portalen – logga in för att läsa.', null);

    // ---- Notiser i appen (tilldelning) – lagras per mottagare. Påminnelser och eskaleringar räknas fram av regler.
    for (const c of cases.filter((x) => x.confirmedAt && x.confirmedAt >= '2027-01-11' && x.confirmedAt < NOW)) {
      for (const t of c.team) {
        const lead = t.role === 'lead_coach';
        S.userNotifications.push({ id: nid('un'), recipientId: t.userId, kind: 'assignment', caseId: c.id, createdAt: c.confirmedAt, channels: ['app', 'email'],
          title: lead ? 'Nytt ärende tilldelat dig' : 'Du har lagts till i ett team',
          body: lead ? `Du är huvudcoach för ${c.number} (${AREAS.find((a) => a[0] === c.primaryArea)[1]}). Första möte ${c.firstMeetingAt ? d.fmtDateTime(c.firstMeetingAt) : 'är inte bokat'}.` : `Du är ${({ vocational_supervisor: 'yrkesspecifik handledare', employer_matcher: 'arbetsgivarmatchare', guidance_counselor: 'SYV/metodstöd' })[t.role]} för ${c.number}.`,
          emailBody: `Du har fått ett nytt ärende i Miljonmatch: ${c.number}. Logga in för att se detaljerna.` });
      }
    }
    for (const n of S.userNotifications) if (n.createdAt < '2027-01-29') { S.notifRead[n.recipientId] = S.notifRead[n.recipientId] || {}; S.notifRead[n.recipientId][n.id] = n.createdAt; }

    // Uppgift till ekonom (ekonomen ser inte meddelanden – avtalsansvarig vidarebefordrar referensen som uppgift)
    S.tasks.push({ id: 'task-1', toRole: 'ekonom', fromId: 'u-johan', createdAt: '2027-01-14T09:05', status: 'open', caseIds: [script.reffel1.id, script.reffel2.id],
      text: `Kommunen har bekräftat rätt beställarreferens 55102938 för ${script.reffel1.number} och ${script.reffel2.number}. Decemberfakturorna ska krediteras och göras om, och januari faktureras med rätt referens.` });
    S.tasks.push({ id: 'task-2', toRole: 'avtalsansvarig', fromId: 'system', createdAt: '2027-02-01T07:55', status: 'open', text: 'Avrop med skyddade personuppgifter från Omar Farah. Ring handläggaren enligt den säkra rutinen.', emailId: 'em-104' });
    S.cases = cases;
    // Scriptreferenser för scenarier (id:n)
    S.script = Object.fromEntries(Object.entries(script).map(([k, c]) => [k, c.id]));
    // Städa bort hjälpfält
    for (const c of cases) { delete c.forcedEnd; delete c.interrupted; }
    return S;
  };
})();
