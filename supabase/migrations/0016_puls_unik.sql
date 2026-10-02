-- 0016 Pulslänken: ett svar per länk.
-- puls.submit kontrollerar att länken är oanvänd innan svaret skrivs, men kontrollen och skrivningen är inte en enda
-- transaktion. Två samtidiga svar på samma länk kunde därför båda sparas. Den unika nyckeln stoppar det andra svaret
-- (felkod 23505) – hanteraren svarar då "Länken är redan använd." (src/features/puls/handlers.ts).
-- Nyckeln ersätter indexet pulse_responses_invite_id_idx från 0007 (den är också index för den främmande nyckeln).
-- Kontroll före i en databas med svar (ska ge noll rader):
--   select invite_id, count(*) from public.pulse_responses group by invite_id having count(*) > 1;

alter table public.pulse_responses add constraint pulse_responses_invite_id_key unique (invite_id);
drop index if exists public.pulse_responses_invite_id_idx;
