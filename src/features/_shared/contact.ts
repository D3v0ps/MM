// Kontaktuppgifter som får stå i utskick till deltagare (kallelse, pulsmätning). Inga påhittade nummer: är numret inte
// bestämt är värdet null och meningen "Frågor? Ring …" utelämnas helt. Växeln 08-400 22 750 (Karim 2026-10-09, bekräftat mot miljonbemanning.se).
export const CONTACT_PHONE: string | null = "08-400 22 750";
/**
 * Brevlådan för beställningar och ärenden via mejl (avrop@, beslut 4c 2026-10-08). Kommunen avbryter en insats genom att
 * mejla hit med ärendenumret (beslut 2026-10-09). Svaren på notiserna går också hit i produktion (MM_EMAIL_REPLY_TO).
 */
export const ORDER_EMAIL = "avrop@miljonbemanning.se";
