// Pulsmätningens texter på svenska, engelska, arabiska och somaliska – exakt den gamla prototypens (prototyp/src/views/admin.js, PT).
// Översättningarna ska granskas av en människa (märks i vyn). Isomorf: används av skärmen.

export const PULSE_LANGS = ["sv", "en", "ar", "so"] as const;
export type PulseLang = (typeof PULSE_LANGS)[number];
export const LANG_LABEL: Record<PulseLang, string> = { sv: "Svenska", en: "English", ar: "العربية", so: "Soomaali" };

export type PulseTexts = {
  language: string;
  title: string;
  intro: string;
  bullets: string[];
  start: string;
  of: string;
  back: string;
  next: string;
  submit: string;
  chose: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q4o: Record<"jobb" | "praktik" | "utbildning" | "svenska" | "annat", string>;
  q5: string;
  yes: string;
  no: string;
  textLabel: string;
  textHelp: string;
  scale: string[];
  thanks: string;
  thanksContact: string;
  close: string;
  used: string;
  usedText: string;
  expired: string;
  expiredText: string;
  missing: string;
  missingText: string;
};

export const PT: Record<PulseLang, PulseTexts> = {
  sv: {
    language: "Språk",
    title: "Hur går det?",
    intro: "Vi vill veta hur du har det hos oss.",
    bullets: [
      "Fem korta frågor. Det tar ungefär en minut.",
      "Det är frivilligt att svara. Ditt svar påverkar ingenting i din insats.",
      "Din coach ser inte vad du svarar.",
      "Länken gäller i {days} dagar och kan bara användas en gång."
    ],
    start: "Börja",
    of: "Fråga {n} av 5",
    back: "Tillbaka",
    next: "Nästa",
    submit: "Skicka svar",
    chose: "Du valde",
    q1: "Hur trivs du hos oss?",
    q2: "Känner du att du kommer närmare jobb eller studier?",
    q3: "Får du det stöd du behöver av din coach?",
    q4: "Vad är viktigast för dig just nu?",
    q4o: {
      jobb: "Hitta jobb",
      praktik: "Praktik",
      utbildning: "Utbildning",
      svenska: "Bli säkrare på svenska",
      annat: "Annat"
    },
    q5: "Vill du att någon kontaktar dig?",
    yes: "Ja",
    no: "Nej",
    textLabel: "Vill du skriva något? (frivilligt)",
    textHelp: "Skriv inte ditt personnummer.",
    scale: [
      "Mycket dåligt",
      "Dåligt",
      "Okej",
      "Bra",
      "Mycket bra"
    ],
    thanks: "Tack för dina svar!",
    thanksContact: "Någon från Miljonbemanning hör av sig till dig.",
    close: "Du kan stänga sidan nu.",
    used: "Länken är redan använd",
    usedText: "Du har redan svarat. Varje länk kan bara användas en gång. Tack!",
    expired: "Länken har gått ut",
    expiredText: "Länken gällde i {days} dagar. Du behöver inte göra något.",
    missing: "Länken fungerar inte",
    missingText: "Kontrollera att du har hela länken."
  },
  en: {
    language: "Language",
    title: "How are things going?",
    intro: "We want to know how you are doing with us.",
    bullets: [
      "Five short questions. It takes about one minute.",
      "Answering is voluntary. Your answers do not affect your programme.",
      "Your coach does not see what you answer.",
      "The link is valid for {days} days and can only be used once."
    ],
    start: "Start",
    of: "Question {n} of 5",
    back: "Back",
    next: "Next",
    submit: "Send answers",
    chose: "You chose",
    q1: "How do you like it here with us?",
    q2: "Do you feel that you are getting closer to a job or studies?",
    q3: "Do you get the support you need from your coach?",
    q4: "What is most important to you right now?",
    q4o: {
      jobb: "Finding a job",
      praktik: "Work placement",
      utbildning: "Education",
      svenska: "Getting better at Swedish",
      annat: "Something else"
    },
    q5: "Would you like someone to contact you?",
    yes: "Yes",
    no: "No",
    textLabel: "Do you want to write something? (optional)",
    textHelp: "Do not write your personal identity number.",
    scale: [
      "Very bad",
      "Bad",
      "Okay",
      "Good",
      "Very good"
    ],
    thanks: "Thank you for your answers!",
    thanksContact: "Someone from Miljonbemanning will contact you.",
    close: "You can close this page now.",
    used: "The link has already been used",
    usedText: "You have already answered. Each link can only be used once. Thank you!",
    expired: "The link has expired",
    expiredText: "The link was valid for {days} days. You do not need to do anything.",
    missing: "The link does not work",
    missingText: "Check that you have the whole link."
  },
  ar: {
    language: "اللغة",
    title: "كيف تسير الأمور؟",
    intro: "نريد أن نعرف كيف حالك معنا.",
    bullets: [
      "خمسة أسئلة قصيرة. يستغرق ذلك دقيقة واحدة تقريبًا.",
      "الإجابة اختيارية. إجاباتك لا تؤثر على برنامجك.",
      "مدربك لا يرى إجاباتك.",
      "الرابط صالح لمدة {days} أيام ويمكن استخدامه مرة واحدة فقط."
    ],
    start: "ابدأ",
    of: "السؤال {n} من 5",
    back: "رجوع",
    next: "التالي",
    submit: "أرسل الإجابات",
    chose: "اخترت",
    q1: "هل أنت مرتاح معنا؟",
    q2: "هل تشعر أنك تقترب من العمل أو الدراسة؟",
    q3: "هل تحصل على الدعم الذي تحتاجه من مدربك؟",
    q4: "ما هو الأهم بالنسبة لك الآن؟",
    q4o: {
      jobb: "إيجاد عمل",
      praktik: "تدريب عملي",
      utbildning: "تعليم",
      svenska: "تحسين لغتي السويدية",
      annat: "شيء آخر"
    },
    q5: "هل تريد أن يتواصل معك أحد؟",
    yes: "نعم",
    no: "لا",
    textLabel: "هل تريد أن تكتب شيئًا؟ (اختياري)",
    textHelp: "لا تكتب رقمك الشخصي.",
    scale: [
      "سيئ جدًا",
      "سيئ",
      "مقبول",
      "جيد",
      "جيد جدًا"
    ],
    thanks: "شكرًا على إجاباتك!",
    thanksContact: "سيتواصل معك شخص من Miljonbemanning.",
    close: "يمكنك إغلاق هذه الصفحة الآن.",
    used: "تم استخدام الرابط من قبل",
    usedText: "لقد أجبت من قبل. يمكن استخدام كل رابط مرة واحدة فقط. شكرًا لك!",
    expired: "انتهت صلاحية الرابط",
    expiredText: "كان الرابط صالحًا لمدة {days} أيام. لا تحتاج إلى فعل أي شيء.",
    missing: "الرابط لا يعمل",
    missingText: "تأكد من أن لديك الرابط كاملًا."
  },
  so: {
    language: "Luqadda",
    title: "Sidee wax u socdaan?",
    intro: "Waxaan rabnaa inaan ogaanno sida ay kuula tahay joogitaankaaga nala.",
    bullets: [
      "Shan su'aalood oo gaagaaban. Waxay qaadanaysaa qiyaastii hal daqiiqo.",
      "Ka jawaabistu waa ikhtiyaari. Jawaabahaagu waxba kama beddelaan barnaamijkaaga.",
      "Tababarahaagu ma arko waxaad ka jawaabto.",
      "Linkigu wuxuu shaqaynayaa {days} maalmood, hal mar oo keliya ayaana la isticmaali karaa."
    ],
    start: "Bilow",
    of: "Su'aasha {n} ee 5",
    back: "Dib u noqo",
    next: "Xiga",
    submit: "Dir jawaabaha",
    chose: "Waxaad dooratay",
    q1: "Sidee ayay kuula tahay halkan?",
    q2: "Ma dareemaysaa inaad u dhowaanayso shaqo ama waxbarasho?",
    q3: "Ma ka helaysaa tababarahaaga taageerada aad u baahan tahay?",
    q4: "Maxaa hadda kuugu muhiimsan?",
    q4o: {
      jobb: "Helitaanka shaqo",
      praktik: "Tababar shaqo (praktik)",
      utbildning: "Waxbarasho",
      svenska: "Inaan iswiidhishka si fiican u barto",
      annat: "Wax kale"
    },
    q5: "Ma rabtaa in qof kula soo xiriiro?",
    yes: "Haa",
    no: "Maya",
    textLabel: "Ma rabtaa inaad wax qorto? (ikhtiyaari)",
    textHelp: "Ha qorin lambarkaaga shakhsiga.",
    scale: [
      "Aad u xun",
      "Xun",
      "Caadi",
      "Fiican",
      "Aad u fiican"
    ],
    thanks: "Waad ku mahadsan tahay jawaabahaaga!",
    thanksContact: "Qof ka socda Miljonbemanning ayaa kula soo xiriiri doona.",
    close: "Hadda waad xiri kartaa boggan.",
    used: "Linkiga horay ayaa loo isticmaalay",
    usedText: "Horay ayaad uga jawaabtay. Link kasta hal mar oo keliya ayaa la isticmaali karaa. Mahadsanid!",
    expired: "Linkiga wuu dhacay",
    expiredText: "Linkigu wuxuu shaqaynayay {days} maalmood. Waxba uma baahnid inaad samayso.",
    missing: "Linkigu ma shaqaynayo",
    missingText: "Hubi inaad haysato linkiga oo dhan."
  }
};

/** {n} och {days} i texterna. */
export const tr = (s: string, vars: Record<string, string | number>): string => String(s).replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));
