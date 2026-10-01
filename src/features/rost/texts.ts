// Deltagarens inspelningssida (/rost/:token) på svenska, engelska, arabiska och somaliska. Lättläst svenska, korta meningar.
// Översättningarna ska granskas av en människa innan de används skarpt (märks i vyn, samma som pulsmätningen).
// Isomorf: används av skärmen (texterna) och av hanterarna (samtyckestextens version).
import type { RecorderTexts } from "@/ui/recorder";
import type { RostLang } from "./api";

/** Samtyckestextens version (deltagarens samtycke i länken). Ändras texten nedan ska versionen ändras. */
export const VOICE_CONSENT_VERSION = "röst-v1.0 (2026-09-30)";

export const ROST_LANG_LABEL: Record<RostLang, string> = { sv: "Svenska", en: "English", ar: "العربية", so: "Soomaali" };
/** Språkens namn på svenska (för coachen). */
export const LANGUAGE_NAME: Readonly<Record<string, string>> = { sv: "svenska", en: "engelska", ar: "arabiska", so: "somaliska" };
export const languageName = (code: string): string => LANGUAGE_NAME[code] ?? code;
/** Deltagarens språk i ärendet ("somaliska") som språkkod, om sidan har texter för det. */
export function languageCodeOf(name: string | null | undefined): RostLang | null {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("somali")) return "so";
  if (n.includes("arabisk")) return "ar";
  if (n.includes("engelsk")) return "en";
  if (n.includes("svensk")) return "sv";
  return null;
}

export type RostTexts = {
  language: string;
  title: string;
  intro: string;
  bullets: string[];
  consentTitle: string;
  consentText: string;
  consentCheck: string;
  consentNeeded: string;
  tip: string;
  recorder: Partial<RecorderTexts>;
  doneTitle: string;
  length: string;
  listen: string;
  send: string;
  redo: string;
  sending: string;
  processing: string;
  thanks: string;
  thanksText: string;
  close: string;
  sendError: string;
  used: string;
  usedText: string;
  expired: string;
  expiredText: string;
  missing: string;
  missingText: string;
  disabled: string;
  disabledText: string;
};

export const RT: Record<RostLang, RostTexts> = {
  sv: {
    language: "Språk",
    title: "Berätta för din coach",
    intro: "Här kan du spela in ett kort meddelande till din coach. Du kan prata på ditt eget språk.",
    bullets: [
      "Det är frivilligt. Om du inte spelar in påverkar det ingenting i din insats.",
      "Du kan prata i högst {min} minuter.",
      "Inspelningen blir text. Ljudet raderas direkt efter det.",
      "Din coach läser texten och kan använda den när ni planerar.",
      "Länken gäller i {days} dagar och kan bara användas en gång.",
    ],
    consentTitle: "Samtycke",
    consentText:
      "Jag vill spela in ett meddelande till min coach. Inspelningen görs om till text med hjälp av AI i Sverige eller EU. Om jag pratar ett annat språk översätts texten till svenska. Ljudet raderas direkt efter det. Texten sparas i mitt ärende hos Miljonbemanning. Jag kan låta bli att skicka.",
    consentCheck: "Jag har läst texten och vill spela in",
    consentNeeded: "Kryssa i rutan ovan för att kunna spela in.",
    tip: "Säg inte ditt personnummer. Du behöver inte säga ditt namn.",
    recorder: {
      start: "Börja spela in",
      pause: "Pausa",
      resume: "Fortsätt",
      stop: "Klar",
      recording: "Spelar in",
      paused: "Pausad",
      maxInfo: "Högst {min} minuter.",
      maxReached: "Inspelningen stoppades efter {min} minuter. Det är den längsta tiden.",
      startedSr: "Inspelningen har startat.",
      pausedSr: "Inspelningen är pausad.",
      resumedSr: "Inspelningen fortsätter.",
      stoppedSr: "Inspelningen är klar.",
      starting: "Startar mikrofonen …",
      noSupport: "Inspelning fungerar inte i den här webbläsaren. Prova en annan webbläsare.",
      denied: "Webbläsaren får inte använda mikrofonen. Tillåt mikrofonen i inställningarna och försök igen.",
      noMic: "Ingen mikrofon hittades.",
      micError: "Mikrofonen kunde inte startas. Försök igen.",
      leaveWarning: "Inspelningen pågår. Om du lämnar sidan försvinner den.",
    },
    doneTitle: "Din inspelning är klar",
    length: "Längd: {time}",
    listen: "Lyssna på inspelningen",
    send: "Skicka till min coach",
    redo: "Spela in igen",
    sending: "Skickar …",
    processing: "Gör om inspelningen till text …",
    thanks: "Tack! Ditt meddelande är skickat.",
    thanksText: "Din coach läser det. Ljudet är raderat.",
    close: "Du kan stänga sidan nu.",
    sendError: "Det gick inte att skicka. Försök igen.",
    used: "Länken är redan använd",
    usedText: "Du har redan skickat ett meddelande med den här länken. Tack!",
    expired: "Länken har gått ut",
    expiredText: "Länken gällde i {days} dagar. Be din coach om en ny länk om du vill spela in.",
    missing: "Länken fungerar inte",
    missingText: "Kontrollera att du har hela länken. Du kan också fråga din coach.",
    disabled: "Det går inte att spela in",
    disabledText: "Det går inte att spela in med den här länken just nu. Prata med din coach.",
  },
  en: {
    language: "Language",
    title: "Tell your coach",
    intro: "Here you can record a short message to your coach. You can speak your own language.",
    bullets: [
      "It is voluntary. If you do not record anything, it does not affect your programme.",
      "You can speak for up to {min} minutes.",
      "The recording becomes text. The sound is deleted right after that.",
      "Your coach reads the text and can use it when you plan together.",
      "The link is valid for {days} days and can only be used once.",
    ],
    consentTitle: "Consent",
    consentText:
      "I want to record a message to my coach. The recording is turned into text with the help of AI in Sweden or the EU. If I speak another language, the text is translated into Swedish. The sound is deleted right after that. The text is saved in my file at Miljonbemanning. I can choose not to send it.",
    consentCheck: "I have read the text and want to record",
    consentNeeded: "Tick the box above to be able to record.",
    tip: "Do not say your personal identity number. You do not need to say your name.",
    recorder: {
      start: "Start recording",
      pause: "Pause",
      resume: "Continue",
      stop: "Done",
      recording: "Recording",
      paused: "Paused",
      maxInfo: "Up to {min} minutes.",
      maxReached: "The recording stopped after {min} minutes. That is the longest time.",
      startedSr: "The recording has started.",
      pausedSr: "The recording is paused.",
      resumedSr: "The recording continues.",
      stoppedSr: "The recording is done.",
      starting: "Starting the microphone …",
      noSupport: "Recording does not work in this browser. Try another browser.",
      denied: "The browser is not allowed to use the microphone. Allow the microphone in the settings and try again.",
      noMic: "No microphone was found.",
      micError: "The microphone could not be started. Try again.",
      leaveWarning: "The recording is in progress. If you leave the page, it will be lost.",
    },
    doneTitle: "Your recording is ready",
    length: "Length: {time}",
    listen: "Listen to the recording",
    send: "Send to my coach",
    redo: "Record again",
    sending: "Sending …",
    processing: "Turning the recording into text …",
    thanks: "Thank you! Your message has been sent.",
    thanksText: "Your coach will read it. The sound has been deleted.",
    close: "You can close this page now.",
    sendError: "It could not be sent. Try again.",
    used: "The link has already been used",
    usedText: "You have already sent a message with this link. Thank you!",
    expired: "The link has expired",
    expiredText: "The link was valid for {days} days. Ask your coach for a new link if you want to record.",
    missing: "The link does not work",
    missingText: "Check that you have the whole link. You can also ask your coach.",
    disabled: "Recording is not possible",
    disabledText: "It is not possible to record with this link right now. Talk to your coach.",
  },
  ar: {
    language: "اللغة",
    title: "أخبر مدربك",
    intro: "يمكنك هنا تسجيل رسالة قصيرة إلى مدربك. يمكنك التحدث بلغتك.",
    bullets: [
      "التسجيل اختياري. إذا لم تسجل شيئًا فلن يؤثر ذلك على برنامجك.",
      "يمكنك التحدث لمدة {min} دقائق كحد أقصى.",
      "يتحول التسجيل إلى نص. ثم يُحذف الصوت فورًا.",
      "يقرأ مدربك النص ويمكنه استخدامه عندما تخططان معًا.",
      "الرابط صالح لمدة {days} أيام ويمكن استخدامه مرة واحدة فقط.",
    ],
    consentTitle: "الموافقة",
    consentText:
      "أريد تسجيل رسالة إلى مدربي. يتحول التسجيل إلى نص بمساعدة الذكاء الاصطناعي في السويد أو الاتحاد الأوروبي. إذا تحدثت بلغة أخرى يُترجم النص إلى السويدية. ثم يُحذف الصوت فورًا. يُحفظ النص في ملفي لدى Miljonbemanning. يمكنني أن أختار عدم الإرسال.",
    consentCheck: "قرأت النص وأريد التسجيل",
    consentNeeded: "ضع علامة في المربع أعلاه لتتمكن من التسجيل.",
    tip: "لا تذكر رقمك الشخصي. لا تحتاج إلى ذكر اسمك.",
    recorder: {
      start: "ابدأ التسجيل",
      pause: "إيقاف مؤقت",
      resume: "متابعة",
      stop: "انتهيت",
      recording: "جارٍ التسجيل",
      paused: "متوقف مؤقتًا",
      maxInfo: "{min} دقائق كحد أقصى.",
      maxReached: "توقف التسجيل بعد {min} دقائق. هذه أطول مدة.",
      startedSr: "بدأ التسجيل.",
      pausedSr: "التسجيل متوقف مؤقتًا.",
      resumedSr: "التسجيل مستمر.",
      stoppedSr: "انتهى التسجيل.",
      starting: "جارٍ تشغيل الميكروفون …",
      noSupport: "التسجيل لا يعمل في هذا المتصفح. جرّب متصفحًا آخر.",
      denied: "المتصفح غير مسموح له باستخدام الميكروفون. اسمح بالميكروفون في الإعدادات وحاول مرة أخرى.",
      noMic: "لم يتم العثور على ميكروفون.",
      micError: "تعذّر تشغيل الميكروفون. حاول مرة أخرى.",
      leaveWarning: "التسجيل جارٍ. إذا غادرت الصفحة فسيضيع.",
    },
    doneTitle: "تسجيلك جاهز",
    length: "المدة: {time}",
    listen: "استمع إلى التسجيل",
    send: "أرسل إلى مدربي",
    redo: "سجّل مرة أخرى",
    sending: "جارٍ الإرسال …",
    processing: "جارٍ تحويل التسجيل إلى نص …",
    thanks: "شكرًا! تم إرسال رسالتك.",
    thanksText: "سيقرأها مدربك. تم حذف الصوت.",
    close: "يمكنك إغلاق هذه الصفحة الآن.",
    sendError: "لم يتم الإرسال. حاول مرة أخرى.",
    used: "تم استخدام الرابط من قبل",
    usedText: "لقد أرسلت رسالة بهذا الرابط من قبل. شكرًا لك!",
    expired: "انتهت صلاحية الرابط",
    expiredText: "كان الرابط صالحًا لمدة {days} أيام. اطلب رابطًا جديدًا من مدربك إذا أردت التسجيل.",
    missing: "الرابط لا يعمل",
    missingText: "تأكد من أن لديك الرابط كاملًا. يمكنك أيضًا سؤال مدربك.",
    disabled: "لا يمكن التسجيل",
    disabledText: "لا يمكن التسجيل بهذا الرابط الآن. تحدث مع مدربك.",
  },
  so: {
    language: "Luqadda",
    title: "U sheeg tababarahaaga",
    intro: "Halkan waxaad ku duubi kartaa fariin gaaban oo aad u dirayso tababarahaaga. Waxaad ku hadli kartaa luqaddaada.",
    bullets: [
      "Waa ikhtiyaari. Haddii aadan waxba duubin, waxba kama beddelayso barnaamijkaaga.",
      "Waxaad hadli kartaa ugu badnaan {min} daqiiqo.",
      "Duubistu waxay noqonaysaa qoraal. Codka isla markiiba waa la tirtirayaa.",
      "Tababarahaagu wuu akhriyayaa qoraalka, wuxuuna isticmaali karaa marka aad wax qorsheynaysaan.",
      "Linkigu wuxuu shaqaynayaa {days} maalmood, hal mar oo keliya ayaana la isticmaali karaa.",
    ],
    consentTitle: "Oggolaansho",
    consentText:
      "Waxaan rabaa inaan fariin u duubo tababarahayga. Duubista waxaa qoraal loogu beddelayaa iyadoo la adeegsanayo AI ku taal Iswiidhan ama Midowga Yurub. Haddii aan ku hadlo luqad kale, qoraalka waxaa loo turjumayaa iswiidhish. Codka isla markiiba waa la tirtirayaa. Qoraalka waxaa lagu kaydinayaa kiiskayga Miljonbemanning. Waan ka tagi karaa inaan diro.",
    consentCheck: "Waan akhriyay qoraalka, waxaanan rabaa inaan duubo",
    consentNeeded: "Calaamadee sanduuqa kore si aad u duubi karto.",
    tip: "Ha sheegin lambarkaaga shakhsiga. Uma baahnid inaad magacaaga sheegto.",
    recorder: {
      start: "Bilow duubista",
      pause: "Jooji in yar",
      resume: "Sii wad",
      stop: "Waan dhammeeyay",
      recording: "Waa la duubayaa",
      paused: "Waa la joojiyay",
      maxInfo: "Ugu badnaan {min} daqiiqo.",
      maxReached: "Duubistu waxay istaagtay {min} daqiiqo kadib. Taasi waa waqtiga ugu dheer.",
      startedSr: "Duubistu way bilaabatay.",
      pausedSr: "Duubista waa la joojiyay.",
      resumedSr: "Duubistu way socotaa.",
      stoppedSr: "Duubistu way dhammaatay.",
      starting: "Makarafoonka ayaa la shidayaa …",
      noSupport: "Duubistu kuma shaqayso biraawsarkan. Isku day biraawsar kale.",
      denied: "Biraawsarka looma oggola inuu isticmaalo makarafoonka. Oggolow makarafoonka dejinta, kadibna isku day mar kale.",
      noMic: "Makarafoon lama helin.",
      micError: "Makarafoonka lama shidi karin. Isku day mar kale.",
      leaveWarning: "Duubistu way socotaa. Haddii aad ka baxdo boggan way lumaysaa.",
    },
    doneTitle: "Duubistaadu waa diyaar",
    length: "Dhererka: {time}",
    listen: "Dhageyso duubista",
    send: "U dir tababarahayga",
    redo: "Mar kale duub",
    sending: "Waa la dirayaa …",
    processing: "Duubista waxaa loo beddelayaa qoraal …",
    thanks: "Mahadsanid! Fariintaada waa la diray.",
    thanksText: "Tababarahaagu wuu akhrin doonaa. Codka waa la tirtiray.",
    close: "Hadda waad xiri kartaa boggan.",
    sendError: "Lama diri karin. Isku day mar kale.",
    used: "Linkiga horay ayaa loo isticmaalay",
    usedText: "Horay ayaad fariin ugu dirtay linkigan. Mahadsanid!",
    expired: "Linkiga wuu dhacay",
    expiredText: "Linkigu wuxuu shaqaynayay {days} maalmood. Tababarahaaga ka codso link cusub haddii aad rabto inaad duubto.",
    missing: "Linkigu ma shaqaynayo",
    missingText: "Hubi inaad haysato linkiga oo dhan. Waxaad sidoo kale weydiin kartaa tababarahaaga.",
    disabled: "Lama duubi karo",
    disabledText: "Hadda lagama duubi karo linkigan. La hadal tababarahaaga.",
  },
};

/** {min}, {days} och {time} i texterna. */
export const tr = (s: string, vars: Record<string, string | number>): string => String(s).replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));

/** Utskicket till deltagaren (SMS eller e-post). Inga personuppgifter – bara länken (CLAUDE.md punkt 9). */
export const linkMessageText = (days: number): string =>
  `Hej! Din coach på Miljonbemanning vill gärna höra hur det går. Spela in ett kort meddelande på ditt språk. Det är frivilligt. Länken gäller i ${days} dagar och kan bara användas en gång:`;
