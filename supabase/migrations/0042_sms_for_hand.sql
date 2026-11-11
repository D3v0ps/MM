-- 0042 SMS att skicka – coachen skickar SMS till deltagaren själv (Karims beslut 2026-11-11, SPEC §9).
--
-- SMS till deltagare är inte kopplat i produktionen (46elks, docs/DRIFT.md avsnitt 13) och e-post till deltagare stoppas av
-- spärrlistan. Coachens Min vecka har därför sektionen "SMS att skicka": veckans tider (från fredag för nästa ISO-vecka) och
-- meddelanden till deltagaren som inte kunde skickas automatiskt (kallelse, inbjudan, ändrad och inställd aktivitet). Coachen
-- kopierar numret och texten, skickar SMS:et från sin telefon och trycker Markera som skickat. Raderna räknas fram av servern
-- varje gång (aktiviteterna, utskicksloggen och samordnarens uppgifter) – inget genererat sparas.
--
-- Markera som skickat sparar en rad i utskicksloggen (public.outbound_messages): kanalen sms, status sent_manually (ny status –
-- kolumnen är text utan check, 0006), mottagaren "deltagare (SMS)" och texten som skickades (bara tid, plats och Miljonbemannings
-- telefonnummer – CLAUDE.md punkt 9). Aldrig deltagarens nummer eller adress. Radens id bestäms av vad som skickades (veckan och
-- ärendet, eller samordnarens uppgift), så att två coacher som trycker samtidigt ger en rad – den andra skrivningen stoppas av
-- primärnyckeln (23505) och hanteraren svarar att SMS:et redan är markerat.
--
-- Den här migrationen: kolumnen sent_by – vem som markerade SMS:et som skickat (profiles.id). Null för allt som servern skickar
-- (e-post, SMS och samtal via leverantören, brev). Ingen främmande nyckel: utskicksloggen töms och läses in på nytt i testmiljön
-- (mm.reset_test_data) i samma ordning som förut, och raden ska finnas kvar om profilen tas bort.
--
-- Behörigheten är oförändrad (0006, speglas i src/data/policy.ts outbound_messages): systemadministratören och samordnaren läser
-- utskicksloggen, ingen inloggad skriver – raden skrivs av servern (service role) efter att hanteraren prövat att coachen får se
-- ärendet och personen. Rättigheten select på tabellen (0006) gäller också den nya kolumnen. Prövas i
-- src/data/supabase/sms-for-hand.test.ts.
--
-- Idempotent (if not exists) – tål att köras igen i SQL Editor. Lås: ett kort lås på public.outbound_messages när kolumnen läggs
-- till (ingen omskrivning av tabellen – kolumnen har inget standardvärde). Väntar satsen längre än 5 sekunder på låset avbryts
-- körningen (felkod 55P03) i stället för att utskicken köar bakom den – kör då filen igen. Inställningen återställs sist i filen.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table public.outbound_messages add column if not exists sent_by text;

comment on column public.outbound_messages.sent_by is
  'Vem som markerade ett SMS som skickat för hand (status sent_manually, profiles.id). Null för utskick som servern skickar. Aldrig nummer eller adresser.';

reset lock_timeout;
reset statement_timeout;
