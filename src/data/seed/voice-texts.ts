// PÅHITTADE texter för röstinspelningen (testdata och den simulerade AI:n, src/features/_shared/ai-sim.ts).
// Inga riktiga personer. Texterna är sakliga och funktionella: inga diagnoser, inga omdömen om personlighet (CLAUDE.md).
// Översättningarna är gjorda för testdatat och ska granskas av en människa innan de används i skarp drift.

/** Språken som deltagarens inspelning finns på i testdatat (ISO 639-1). */
export const VOICE_LANGUAGES = ["sv", "en", "ar", "so"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

/** Språkens namn på svenska (för texter som "Översatt från somaliska"). */
export const LANGUAGE_NAME_SV: Readonly<Record<string, string>> = { sv: "svenska", en: "engelska", ar: "arabiska", so: "somaliska" };

/**
 * Deltagarens röstmeddelanden: samma meddelande på alla språk, mening för mening (index = mening), så att den simulerade
 * översättningen kan slå upp den svenska meningen. Variant 0 = praktiken (Nadia i testdatat), variant 1 = tider (Yusuf).
 */
export const PARTICIPANT_MESSAGES: readonly Readonly<Record<VoiceLanguage, readonly string[]>>[] = [
  {
    sv: [
      "Hej, det är jag.",
      "Praktiken har börjat bra och jag trivs med arbetsuppgifterna.",
      "Det hjälper mig när instruktionerna är skrivna, för då kan jag läsa dem igen.",
      "Jag vill gärna prata om vad som händer efter praktiken.",
    ],
    en: [
      "Hi, it's me.",
      "The work placement has started well and I like the tasks.",
      "It helps me when the instructions are written down, because then I can read them again.",
      "I would like to talk about what happens after the placement.",
    ],
    ar: [
      "مرحباً، أنا هنا.",
      "بدأ التدريب العملي بشكل جيد وأنا مرتاح في مهام العمل.",
      "يساعدني أن تكون التعليمات مكتوبة، لأنني أستطيع قراءتها مرة أخرى.",
      "أود أن نتحدث عما سيحدث بعد التدريب العملي.",
    ],
    so: [
      "Haye, waa aniga.",
      "Tababarka shaqadu si fiican ayuu u bilaabmay, waxaana ku faraxsanahay hawlaha.",
      "Waxaa i caawiya marka tilmaamaha la qoro, sababtoo ah markaas mar kale ayaan akhrin karaa.",
      "Waxaan jeclaan lahaa inaan ka wada hadalno waxa dhacaya tababarka kadib.",
    ],
  },
  {
    sv: [
      "Hej.",
      "Jag har haft svårt att komma i tid på morgonen eftersom bussen går sällan.",
      "Jag vill fortsätta, jag tycker om arbetet.",
      "Kan vi prata om att börja en halvtimme senare?",
    ],
    en: [
      "Hi.",
      "It has been hard for me to arrive on time in the mornings because the bus runs rarely.",
      "I want to continue, I like the work.",
      "Can we talk about starting half an hour later?",
    ],
    ar: [
      "مرحباً.",
      "كان من الصعب علي أن أصل في الوقت المحدد صباحاً لأن الحافلة لا تأتي إلا نادراً.",
      "أريد أن أستمر، فأنا أحب العمل.",
      "هل يمكننا أن نتحدث عن البدء بعد نصف ساعة؟",
    ],
    so: [
      "Haye.",
      "Way igu adkaatay inaan waqtiga ku imaado subaxdii sababtoo ah basku si dhif ah ayuu u yimaadaa.",
      "Waxaan rabaa inaan sii wado, shaqada waan jeclahay.",
      "Ma ka wada hadli karnaa inaan bilaabo nus saac ka dib?",
    ],
  },
];

/** Meddelandet som en text (meningarna med mellanslag). */
export const participantMessage = (variant: number, lang: VoiceLanguage): string => PARTICIPANT_MESSAGES[variant][lang].join(" ");

/** Kommunens handläggare talar in: beställningens bakgrund eller ett meddelande (svenska). */
export const DICTATIONS: readonly (readonly string[])[] = [
  [
    "Deltagaren har arbetat på lager i två år och vill tillbaka till logistik.",
    "Hon har B-körkort men inget truckkort.",
    "Hon behöver stöd med ansökningar på datorn och kan börja om två veckor.",
  ],
  [
    "Deltagaren har läst svenska för invandrare och är nu på nivå D.",
    "Han har arbetat med städning och vill ha ett arbete inom lokalvård.",
    "Han vill helst bli kontaktad med sms.",
  ],
  [
    "Hej!",
    "Jag vill boka ett uppföljningsmöte nästa vecka.",
    "Passar tisdag eller torsdag förmiddag?",
  ],
];

/**
 * Veckoavstämningar (coach och deltagare, svenska). t = sekunder in i ett samtal på 25 minuter (1 500 sekunder); den
 * simulerade transkriberingen skalar tiderna till inspelningens längd. Innehållet är valt så att förslagen får belägg för
 * veckomål, aktiviteter, arbetsgivarkontakter, hinder och nästa veckomål – men inte för fasen (den nämns inte, "Framgår inte").
 */
export const CHECK_IN_CONVERSATIONS: readonly (readonly { t: number; who: "Coach" | "Deltagare"; text: string }[])[] = [
  [
    { t: 40, who: "Coach", text: "Hur har veckan gått?" },
    { t: 96, who: "Deltagare", text: "I veckan har vi jobbat med yrkesspecifika moment och truck på lagret." },
    { t: 184, who: "Deltagare", text: "Jag nådde delvis veckomålet, en dag hann jag inte." },
    { t: 742, who: "Deltagare", text: "I onsdags var vi på ett studiebesök hos en arbetsgivare i Tumba." },
    { t: 1034, who: "Deltagare", text: "Ibland är det svårt att förstå orden i instruktionerna." },
    { t: 1320, who: "Deltagare", text: "Nästa vecka vill jag plocka en hel order själv." },
    { t: 1485, who: "Coach", text: "Bra, då sammanfattar vi veckan." },
  ],
  [
    { t: 30, who: "Coach", text: "Hur har veckan varit?" },
    { t: 88, who: "Deltagare", text: "Jag var på praktik i köket tre dagar den här veckan." },
    { t: 210, who: "Deltagare", text: "Jag klarade veckomålet." },
    { t: 655, who: "Deltagare", text: "Jag har inte haft kontakt med någon arbetsgivare utöver praktikplatsen." },
    { t: 980, who: "Deltagare", text: "Det var svårt att hinna lämna barnen på förskolan och komma i tid." },
    { t: 1290, who: "Deltagare", text: "Nästa vecka ska jag laga lunch till tjugo personer med stöd av handledaren." },
    { t: 1450, who: "Coach", text: "Då fortsätter vi så." },
  ],
  [
    { t: 45, who: "Coach", text: "Vad har du jobbat med i veckan?" },
    { t: 120, who: "Deltagare", text: "Vi har skrivit om mitt CV och jag skickade två ansökningar." },
    { t: 260, who: "Deltagare", text: "Jag nådde inte veckomålet, för jag hann inte öva så mycket som jag ville." },
    { t: 900, who: "Deltagare", text: "Jag behöver hjälp när jag ska söka jobb på datorn." },
    { t: 1250, who: "Deltagare", text: "Nästa vecka vill jag skicka tre ansökningar till." },
    { t: 1470, who: "Coach", text: "Då bestämmer vi det." },
  ],
];
/** Samtalens längd i sekunder som tiderna ovan bygger på. */
export const CHECK_IN_CONVERSATION_SECONDS = 1500;
