-- 0012 Inloggningens hastighetsbegränsning utan kapplöpning (SPEC §4: högst 5 försök per kod, 5 koder per adress och
-- 20 per IP under 15 minuter, högst 30 misslyckade försök per IP).
--
-- Förut räknade servern försöken i login_attempts och registrerade ett nytt försök först efter svaret från Supabase Auth.
-- Anrop som kom samtidigt passerade då alla kontrollen innan något av dem hade registrerats. Nu görs kontrollen och
-- registreringen i samma transaktion, med lås per adress och per IP, och försöket registreras innan koden prövas:
--   * kind 'code'   – räknar koderna och registrerar en ny kod (om gränsen inte nåtts)
--   * kind 'verify' – räknar de misslyckade försöken och registrerar försöket som verify_failed. Lyckas inloggningen
--                     ändrar servern raden till verify_ok (samma id).
-- Samma regler som src/server/auth/rate-limit.ts (checkCodeRequest, checkVerify); gränserna skickas med från LIMITS där.
-- Bara service role får anropa funktionen.
create function mm.login_attempt_gate(p_kind text, p_email_hash text, p_ip_hash text, p_at timestamptz, p_limits jsonb)
returns jsonb
language plpgsql security definer set search_path = public, mm
as $$
declare
  v_window timestamptz := p_at - make_interval(mins => (p_limits ->> 'windowMinutes')::integer);
  v_last_code timestamptz;
  v_since timestamptz;
  v_by_email integer;
  v_by_ip integer;
  v_id bigint;
begin
  if p_kind not in ('code', 'verify') or coalesce(p_email_hash, '') = '' then
    raise exception 'Ogiltigt inloggningsförsök' using errcode = '22023';
  end if;
  -- Ett försök i taget per adress och per IP. Låsen tas alltid i samma ordning (adress, sedan IP), så två anrop kan
  -- inte vänta på varandra. De släpps när transaktionen är klar – då ser nästa anrop det registrerade försöket.
  perform pg_advisory_xact_lock(hashtextextended('mm.login.email:' || p_email_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('mm.login.ip:' || coalesce(p_ip_hash, ''), 0));

  if p_kind = 'code' then
    select count(*) into v_by_email from public.login_attempts
      where kind = 'code' and email_hash = p_email_hash and attempted_at >= v_window;
    select count(*) into v_by_ip from public.login_attempts
      where kind = 'code' and ip_hash = p_ip_hash and attempted_at >= v_window;
    if v_by_email >= (p_limits ->> 'codesPerEmail')::integer or v_by_ip >= (p_limits ->> 'codesPerIp')::integer then
      return jsonb_build_object('verdict', 'rate_limited', 'id', null);
    end if;
    insert into public.login_attempts (kind, email_hash, ip_hash, attempted_at)
      values ('code', p_email_hash, p_ip_hash, p_at) returning id into v_id;
    return jsonb_build_object('verdict', 'ok', 'id', v_id);
  end if;

  -- Försöken räknas sedan den senaste koden skickades – högst 10 minuter bakåt (äldre koder har gått ut).
  select max(attempted_at) into v_last_code from public.login_attempts where kind = 'code' and email_hash = p_email_hash;
  v_since := greatest(coalesce(v_last_code, '-infinity'::timestamptz), p_at - interval '10 minutes');
  select count(*) into v_by_email from public.login_attempts
    where kind = 'verify_failed' and email_hash = p_email_hash and attempted_at >= v_since;
  select count(*) into v_by_ip from public.login_attempts
    where kind = 'verify_failed' and ip_hash = p_ip_hash and attempted_at >= v_window;
  if v_by_ip >= (p_limits ->> 'failedPerIp')::integer then
    return jsonb_build_object('verdict', 'rate_limited', 'id', null);
  end if;
  if v_by_email >= (p_limits ->> 'attemptsPerCode')::integer then
    return jsonb_build_object('verdict', 'too_many_attempts', 'id', null);
  end if;
  insert into public.login_attempts (kind, email_hash, ip_hash, attempted_at)
    values ('verify_failed', p_email_hash, p_ip_hash, p_at) returning id into v_id;
  return jsonb_build_object('verdict', 'ok', 'id', v_id);
end
$$;
revoke all on function mm.login_attempt_gate(text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function mm.login_attempt_gate(text, text, text, timestamptz, jsonb) to service_role;

-- Samma funktion i public, så att servern kan anropa den via supabase-js (.rpc("login_attempt_gate")). Bara service role.
create function public.login_attempt_gate(p_kind text, p_email_hash text, p_ip_hash text, p_at timestamptz, p_limits jsonb)
returns jsonb
language sql security definer set search_path = public, mm
as $$ select mm.login_attempt_gate(p_kind, p_email_hash, p_ip_hash, p_at, p_limits) $$;
revoke all on function public.login_attempt_gate(text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.login_attempt_gate(text, text, text, timestamptz, jsonb) to service_role;
