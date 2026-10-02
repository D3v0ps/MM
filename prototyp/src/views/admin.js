// views/admin.js – Systemadmin: avtal och konfiguration, användare och roller, underbiträden och integrationer,
// mallar och utskick, revisionslogg. Dessutom deltagarens pulsmätning (engångslänk) och det gemensamma arbetsgivarregistret.
// Egna åtgärder: admin.setOrgRule, admin.inviteCustomer, admin.setCustomerActive, admin.saveTemplate, admin.runJob,
// admin.logCheck, pulse.submit, employer.add, employer.setRight, employer.addFollowUp.
(() => {
  const { html, useState, useEffect, useMemo, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const A = MM.defineAction;
  const S = () => MM.store.state;
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const APPROVED_ON = '2026-09-29'; // Botkyrkas besked om underbiträden och inspelning (SPEC §3.1)

  // ============================================================ Mallar för e-post och SMS (versioneras, SPEC §9)
  const GENERIC = 'generisk_mottagningsbekraftelse'; const GENERIC_PORTAL = 'generisk_mottagningsbekraftelse_portal';
  const OCCASION = { week2: 'vecka 2', exit: 'vid avslut' };
  const withinText = (w) => (w.minutes != null ? `${w.minutes} minuter` : w.workingDays != null ? plural(w.workingDays, 'arbetsdag', 'arbetsdagar') : w.days != null ? plural(w.days, 'dag', 'dagar') : '–');
  /** Tidsgräns för en SLA-regel i avtalskonfigurationen, t.ex. "5 minuter". */
  const slaWithin = (key) => { const r = (MM.cfg().sla || []).find((x) => x.key === key); return r && r.within && typeof r.within === 'object' ? withinText(r.within) : 'den tid avtalet anger'; };
  /** Klockslag för en SLA-regel ("16.00"). */
  const slaTime = (key) => { const r = (MM.cfg().sla || []).find((x) => x.key === key); return r && r.time ? r.time.replace(':', '.') : null; };
  const listSv = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} och ${xs[xs.length - 1]}` : xs.join(''));
  /** "Vecka 2, vid avslut och var 30:e dag vid långa insatser" – från avtalets pulskonfiguration. */
  const pulseWhen = () => { const p = MM.cfg().pulse; if (!p) return 'Enligt avtalet'; return cap(listSv([...p.occasions.map((o) => OCCASION[o] || o), ...(p.periodicEveryDays ? [`var ${p.periodicEveryDays}:e dag vid långa insatser`] : [])])); };
  const TEMPLATES = [
    { key: 'ordererkannande', name: 'Ordererkännande', channel: 'email', from: 'avrop@miljonbemanning.se (samma tråd via Microsoft Graph)', to: 'Kommunens handläggare', when: () => `Automatiskt inom ${slaWithin('ordererkannande')} när ett avrop kommit in`, subject: 'Vi har tagit emot er beställning – {arendenummer}', body: 'Tack! Vi har tagit emot er beställning och gett den ärendenummer {arendenummer}. Ni får besked om startdatum och ansvarig coach senast {svar_senast}. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.', version: 3, updatedAt: '2026-12-02T10:14' },
    // Generisk mottagningsbekräftelse finns i två varianter – texterna är exakt de som skickas (01-seed.js för mejl, case.create i 03-domain.js för portalen).
    { key: 'generisk_mottagningsbekraftelse', name: 'Generisk mottagningsbekräftelse – mejl', channel: 'email', from: 'avrop@miljonbemanning.se', to: 'Avsändaren av mejlet', when: 'När ett mejl till avrop@ gäller skyddade personuppgifter eller inte kan tolkas', subject: 'Vi har tagit emot ditt mejl', body: 'Tack för ditt mejl. Vi har tagit emot det och ringer dig i dag.', version: 2, updatedAt: '2026-10-20T13:30', variantOf: GENERIC },
    { key: GENERIC_PORTAL, sendKey: GENERIC, name: 'Generisk mottagningsbekräftelse – portalen', channel: 'email', from: 'avrop@miljonbemanning.se', to: 'Kommunens handläggare som beställde i portalen', when: 'När en beställning i portalen gäller skyddade personuppgifter', subject: 'Vi har tagit emot er beställning', body: 'Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.', version: 1, updatedAt: '2026-10-20T13:30', variantOf: GENERIC },
    { key: 'orderbekraftelse', name: 'Orderbekräftelse', channel: 'email', from: 'avrop@miljonbemanning.se', to: 'Kommunens handläggare', when: 'När avropet accepteras', subject: 'Orderbekräftelse – {arendenummer}', body: 'Orderbekräftelse för ärende {arendenummer} finns i portalen – logga in för att läsa. Startdatum och ansvarig coach framgår där.\n\n{lank}', version: 2, updatedAt: '2026-10-20T13:32' },
    { key: 'ny_rapport', name: 'Ny rapport', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Mottagaren av rapporten', when: 'När en rapport levereras i portalen', subject: 'Ny rapport i portalen', body: '{rapporttyp} för ärende {arendenummer} finns i portalen – logga in för att läsa.\n\n{lank}', version: 2, updatedAt: '2026-11-05T09:00' },
    { key: 'nytt_meddelande', name: 'Nytt meddelande', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Kommunens handläggare eller coachen', when: 'När ett säkert meddelande skickas i ett ärende', subject: 'Nytt meddelande om {arendenummer}', body: 'Du har ett nytt meddelande om ärende {arendenummer} – logga in för att läsa.\n\n{lank}', version: 1, updatedAt: '2026-09-08T11:00' },
    { key: 'kallelse', name: 'Kallelse till första möte', channel: 'sms', alsoVia: ['email', 'brev'], from: 'Miljonbemanning', to: 'Deltagaren – via föredragen kontaktväg (SMS, e-post eller brev)', when: 'När första mötet bokas. Aldrig vid skyddade personuppgifter.', body: 'Välkommen till Miljonbemanning! Ditt första möte är {datum} kl. {tid} i {plats}. Frågor? Ring {telefon}.', version: 2, updatedAt: '2026-10-01T15:10' },
    { key: 'motespaminnelse', name: 'Mötespåminnelse', channel: 'sms', from: 'Miljonbemanning (SMS)', to: 'Deltagaren', when: 'Dagen före ett möte kl. 18.00', body: 'Påminnelse: möte i morgon kl. {tid} hos Miljonbemanning i {plats}. Frågor? Ring {telefon}.', version: 1, updatedAt: '2026-09-08T11:00' },
    { key: 'pulslank', name: 'Pulslänk', channel: 'sms', from: 'Miljonbemanning (SMS)', to: 'Deltagaren (aldrig vid skyddade personuppgifter)', when: () => pulseWhen(), body: 'Hej! Hur går det hos oss? Svara på fem korta frågor: {lank} Länken gäller i 7 dagar. Det är frivilligt att svara.', version: 2, updatedAt: '2026-11-18T10:40' },
    { key: 'tilldelning_coach', name: 'Tilldelning till coach', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Huvudcoach och team', when: 'När ett ärende tilldelas eller coach byts', subject: 'Nytt ärende i Miljonmatch', body: 'Du har fått ett nytt ärende i Miljonmatch: {arendenummer}. Logga in för att se detaljerna.', version: 1, updatedAt: '2027-01-11T08:30' },
    { key: 'paminnelse_progression', name: 'Påminnelse om progression', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Huvudcoachen', when: () => `Enligt interna regler: ${sel.orgRules().progressionWatch.reminderSchedule}`, subject: 'Påminnelse från Miljonmatch', body: 'Påminnelse från Miljonmatch: ett av dina ärenden ({arendenummer}) saknar dokumenterad progression. Logga in för att se vilket steg som behövs.', version: 1, updatedAt: '2027-01-11T08:30' },
    { key: 'eskalering_chef', name: 'Eskalering till chef', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Chef och controller – syns aldrig för coachen', when: () => `När ett ärende saknar progression ${sel.orgRules().progressionWatch.escalateAfterConsecutiveWeeks} veckor i rad`, subject: 'Eskalering i Miljonmatch', body: 'Eskalering i Miljonmatch: ett ärende ({arendenummer}) har {antal_veckor} veckor i rad utan progression. Logga in för att se detaljerna.', version: 1, updatedAt: '2027-01-11T08:30' },
    { key: 'avbojt', name: 'Avböjt avrop', channel: 'email', from: 'avrop@miljonbemanning.se', to: 'Kommunens handläggare', when: 'När ett avrop avböjs', subject: 'Besked om beställning {arendenummer}', body: 'Vi kan tyvärr inte ta emot beställning {arendenummer}. Logga in i portalen för att läsa orsaken.', version: 1, updatedAt: '2026-09-08T11:00' },
    { key: 'coachbyte', name: 'Byte av huvudcoach', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Kommunens handläggare', when: 'När huvudcoachen byts', subject: 'Ny huvudcoach för {arendenummer}', body: 'Ärende {arendenummer} har fått ny huvudcoach. Logga in i portalen för att se vem.', version: 1, updatedAt: '2026-09-08T11:00' },
    { key: 'beslut_behovs', name: 'Beslut behövs från kommunen', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Kommunens handläggare', when: 'När en avvikelse kräver kommunens beslut eller stöd – kommunen får också en uppgift i portalen', subject: 'Ärende {arendenummer} behöver ert beslut', body: 'Ärende {arendenummer} behöver ert beslut eller stöd – logga in för att läsa.', version: 1, updatedAt: '2027-01-11T08:30' },
    { key: 'atgardsplan_godkannande', name: 'Åtgärdsplan att godkänna', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Kommunens chef', when: 'När Miljonbemanning skickar en åtgärdsplan för en avtalsavvikelse till kommunen', subject: 'Åtgärdsplan väntar på ert godkännande', body: 'En åtgärdsplan inom avtalet med Miljonbemanning väntar på ert godkännande. Logga in i portalen för att läsa den.', version: 1, updatedAt: '2027-01-11T08:30' },
    { key: 'atgardsplan_godkand', name: 'Åtgärdsplan godkänd', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Avtalsansvarig på Miljonbemanning', when: 'När kommunen godkänner en åtgärdsplan', subject: 'Åtgärdsplan godkänd', body: 'Beställaren har godkänt en åtgärdsplan i Miljonmatch. Logga in för att se den.', version: 1, updatedAt: '2027-01-11T08:30' },
    { key: 'inbjudan_kommun', name: 'Inbjudan till portalen', channel: 'email', from: 'notis@miljonbemanning.se', to: 'Ny kommunanvändare', when: 'När avtalsansvarig bjuder in en kommunanvändare', subject: 'Inbjudan till Miljonbemannings portal', body: 'Du har bjudits in till Miljonbemannings portal för beställare. Logga in på {lank} med din e-postadress. Du får en sexsiffrig kod i ett separat mejl.', version: 1, updatedAt: '2026-09-08T11:00' },
  ];
  const INVITE_TEXT = 'Du har bjudits in till Miljonbemannings portal för beställare. Logga in på portal.miljonbemanning.se med din e-postadress. Du får en sexsiffrig kod i ett separat mejl.';
  const TPL_NAME = Object.fromEntries(TEMPLATES.map((t) => [t.key, t.name]));
  const PORTAL_GENERIC_BODY = TEMPLATES.find((t) => t.key === GENERIC_PORTAL).body;
  /** Vilken mall ett utskick kommer från. Portalvarianten av den generiska bekräftelsen skickas med samma mallnyckel men har egen text. */
  const tplKeyOf = (n) => (n.template === GENERIC && String(n.body || '').trim() === PORTAL_GENERIC_BODY ? GENERIC_PORTAL : n.template);
  const tplLabel = (key) => TPL_NAME[key] || cap(String(key || 'Utskick').replace(/_/g, ' '));
  const ALLOWED_PH = ['arendenummer', 'lank', 'svar_senast', 'datum', 'tid', 'plats', 'telefon', 'rapporttyp', 'antal_veckor', 'vecka'];
  const EXAMPLE = { arendenummer: 'BOT-27-0049', lank: 'https://portal.miljonbemanning.se', svar_senast: d.fmtDateTimeLong('2027-02-02T08:41'), datum: 'onsdag 3 februari', tid: '10.00', plats: 'Alby', telefon: '08-000 00 00', rapporttyp: 'Månadsrapport individ', antal_veckor: '2', vecka: 'vecka 4' };
  const PII_PH = /\{\s*(namn|förnamn|fornamn|efternamn|fullständigt_namn|deltagare|deltagarens?_namn|deltagarnamn|personnummer|pnr|samordningsnummer|födelsedatum|fodelsedatum|adress|gatuadress|postadress|hemadress|postnummer|telefon_deltagare|mobil_deltagare|mobilnummer|epost_deltagare|e-post_deltagare)\s*\}/gi;
  const PNR_RE = /\b(19|20)\d{6}[-+]?\d{4}\b|\b\d{6}[-+]\d{4}\b/;
  /** Kontroll "Innehåller inga personuppgifter": platshållare för namn/personnummer/adress och personnummer i klartext. */
  const tplCheck = (text) => {
    const s = String(text || '');
    const pii = MM.uniq((s.match(PII_PH) || []).map((x) => x.replace(/\s/g, '')));
    const unknown = MM.uniq((s.match(/\{[^{}]*\}/g) || []).map((x) => x.replace(/\s/g, '')).filter((x) => !pii.includes(x) && !ALLOWED_PH.includes(x.slice(1, -1).toLowerCase())));
    const pnr = PNR_RE.test(s);
    return { pii, unknown, pnr, ok: !pii.length && !pnr };
  };
  const fillExample = (s) => String(s || '').replace(/\{\s*([^{}\s]+)\s*\}/g, (m, k) => (EXAMPLE[k.toLowerCase()] != null ? EXAMPLE[k.toLowerCase()] : m));
  const currentTpl = (st, key) => {
    const base = TEMPLATES.find((t) => t.key === key); const hist = (st.adminTemplates || {})[key] || []; const last = hist[hist.length - 1];
    return last ? { ...base, subject: last.subject, body: last.body, version: last.version, updatedAt: last.savedAt, updatedBy: last.savedBy } : { ...base, updatedBy: 'u-robin' };
  };

  // ============================================================ Åtgärder
  const ESC_ROLES = ['chef', 'avtalsansvarig', 'samordnare'];
  const CHANNELS = ['app', 'email'];
  const ruleSnapshot = (n) => ({ remind: n.progressionWatch.remindCoachAfterWeeks, esc: n.progressionWatch.escalateAfterConsecutiveWeeks, to: [...n.progressionWatch.escalateTo], channels: [...n.progressionWatch.channels], assign: [...n.onAssignment.channels] });
  /** Interna regler för notiser (st.orgConfig.notifications). Slår igenom direkt i sel.progressionWatch, notiser och flaggor. */
  A('admin.setOrgRule', (st, p, ctx) => {
    const n = st.orgConfig.notifications; const pw = n.progressionWatch;
    const remind = Number(p.remindCoachAfterWeeks != null ? p.remindCoachAfterWeeks : pw.remindCoachAfterWeeks);
    const esc = Number(p.escalateAfterConsecutiveWeeks != null ? p.escalateAfterConsecutiveWeeks : pw.escalateAfterConsecutiveWeeks);
    if (!Number.isInteger(remind) || remind < 1 || !Number.isInteger(esc) || esc <= remind) return { error: 'weeks' };
    const to = ESC_ROLES.filter((r) => (p.escalateTo || pw.escalateTo).includes(r));
    if (!to.length) return { error: 'recipients' };
    const channels = CHANNELS.filter((c) => (p.channels || pw.channels).includes(c));
    const assign = CHANNELS.filter((c) => (p.assignmentChannels || n.onAssignment.channels).includes(c));
    if (!channels.length || !assign.length) return { error: 'channels' };
    const before = ruleSnapshot(n);
    pw.remindCoachAfterWeeks = remind; pw.escalateAfterConsecutiveWeeks = esc; pw.escalateTo = to; pw.channels = channels; n.onAssignment.channels = assign;
    pw.escalationVisibleToCoach = false; // låst – styrs av behörigheten, inte av en inställning
    ctx.audit('org_rule.updated', 'org_config', 'notifications', { from: before, to: ruleSnapshot(n) });
    return { ok: true };
  });

  /** Bjud in kommunanvändare. Bara tillåtna e-postdomäner för avtalet, ingen självregistrering. */
  A('admin.inviteCustomer', (st, p, ctx) => {
    const k = st.contracts.find((c) => c.id === (p.contractId || 'c-bot'));
    const email = String(p.email || '').trim().toLowerCase(); const name = String(p.name || '').trim();
    if (!name) return { error: 'name' };
    if (!MM.valid.email(email)) return { error: 'email' };
    const domain = email.split('@')[1];
    if (!(k.emailDomains || []).includes(domain)) return { error: 'domain', allowed: k.emailDomains };
    if (st.customerUsers.some((u) => String(u.email).toLowerCase() === email)) return { error: 'exists' };
    if (!['handlaggare', 'chef'].includes(p.role)) return { error: 'role' };
    if (!p.unit) return { error: 'unit' };
    const br = st.buyerReferences.find((b) => b.unit === p.unit && b.active);
    const u = { id: ctx.id('k'), name, title: p.role === 'chef' ? 'Chef' : 'Handläggare', unit: p.unit, buyerReferenceId: br ? br.id : null, role: p.role, org: 'customer', email, phone: '', active: true, lastLoginAt: null, invitedAt: ctx.now, invitedBy: ctx.actorId };
    st.customerUsers.push(u);
    ctx.notify('email', email, 'inbjudan_kommun', INVITE_TEXT, null);
    ctx.audit('customer_user.invited', 'profile', u.id, { role: p.role, unit: p.unit, domain });
    return { userId: u.id };
  });
  A('admin.setCustomerActive', (st, p, ctx) => {
    const u = st.customerUsers.find((x) => x.id === p.userId); if (!u) return { error: 'not_found' };
    u.active = !!p.active; ctx.audit(p.active ? 'customer_user.reactivated' : 'customer_user.blocked', 'profile', u.id, {});
    return {};
  });

  /** Ny version av en mall. Stoppas om texten innehåller personuppgifter. */
  A('admin.saveTemplate', (st, p, ctx) => {
    const base = TEMPLATES.find((t) => t.key === p.key); if (!base) return { error: 'not_found' };
    const subject = String(p.subject || ''); const body = String(p.body || '');
    if (!body.trim()) return { error: 'empty' };
    const chk = tplCheck(`${subject}\n${body}`); if (!chk.ok) return { error: 'personal_data', found: chk.pii };
    st.adminTemplates = st.adminTemplates || {};
    const hist = (st.adminTemplates[p.key] = st.adminTemplates[p.key] || []);
    const version = (hist.length ? hist[hist.length - 1].version : base.version) + 1;
    hist.push({ version, subject, body, savedAt: ctx.now, savedBy: ctx.actorId, note: String(p.note || '') });
    ctx.audit('template.saved', 'template', p.key, { version });
    return { version };
  });
  A('admin.runJob', (st, p, ctx) => { st.adminJobRuns = st.adminJobRuns || {}; st.adminJobRuns[p.key] = { at: ctx.now, by: ctx.actorId }; ctx.audit('job.run_manual', 'job', p.key, {}); return {}; });
  /** Månatlig loggkontroll (stickprov) av chef/controller, SPEC §10. */
  A('admin.logCheck', (st, p, ctx) => {
    const items = (p.items || []).filter((x) => x.logId && ['ok', 'avvikelse'].includes(x.verdict));
    if (!items.length) return { error: 'empty' };
    if (items.some((x) => x.verdict === 'avvikelse') && !String(p.note || '').trim()) return { error: 'note' };
    st.logChecks = st.logChecks || [];
    const lc = { id: ctx.id('lc'), month: p.month, items, note: String(p.note || '').trim(), signedBy: ctx.actorId, signedAt: ctx.now };
    st.logChecks.push(lc);
    ctx.audit('audit.log_check', 'audit_log', p.month, { checked: items.length, deviations: items.filter((x) => x.verdict === 'avvikelse').length });
    return { id: lc.id };
  });

  /** Pulssvar via engångslänk. Coachen ser inte enskilda svar. "Ja" på fråga 5 blir en uppgift till samordnaren. */
  const Q4_VALUES = ['jobb', 'praktik', 'utbildning', 'svenska', 'annat'];
  A('pulse.submit', (st, p, ctx) => {
    const inv = st.pulseInvites.find((x) => x.id === p.inviteId); if (!inv) return { error: 'not_found' };
    if (inv.usedAt) return { error: 'used' };
    if (ctx.now > inv.expiresAt) return { error: 'expired' };
    const a = p.answers || {}; const okScale = (v) => Number.isInteger(v) && v >= 1 && v <= 5;
    if (!okScale(a.q1) || !okScale(a.q2) || !okScale(a.q3) || !Q4_VALUES.includes(a.q4) || !['ja', 'nej'].includes(a.q5)) return { error: 'incomplete' };
    const c = st.cases.find((x) => x.id === inv.caseId); const contact = a.q5 === 'ja';
    inv.usedAt = ctx.now; inv.language = p.language || inv.language;
    const r = { id: ctx.id('pr'), inviteId: inv.id, caseId: inv.caseId, coachId: c ? c.leadCoachId : null, occasion: inv.occasion, language: p.language || 'sv',
      answers: { q1: a.q1, q2: a.q2, q3: a.q3, q4: a.q4, q5: a.q5 }, text: String(p.text || '').trim().slice(0, 500), contactRequested: contact, submittedAt: ctx.now, byTester: true };
    st.pulseResponses.push(r);
    if (contact) st.tasks.push({ id: ctx.id('task'), toRole: 'samordnare', fromId: 'system', createdAt: ctx.now, status: 'open', kind: 'pulse_contact', caseIds: [inv.caseId], responseId: r.id,
      text: `En deltagare vill bli kontaktad (pulsmätning ${d.fmtDate(ctx.now)}, ärende ${c ? c.number : '–'}). Avgör vem som tar kontakten.` });
    ctx.audit('pulse.submitted', 'pulse_response', r.id, { caseId: inv.caseId, language: r.language, contactRequested: contact });
    return { responseId: r.id };
  });

  /** Arbetsgivarregister (SPEC §7.9) – delas av alla coacher. */
  A('employer.add', (st, p, ctx) => {
    const name = String(p.name || '').trim(); if (!name) return { error: 'name' };
    const orgNr = String(p.orgNr || '').trim(); if (orgNr && !/^\d{6}-\d{4}$/.test(orgNr)) return { error: 'orgNr' };
    if (st.employers.some((e) => e.name.toLowerCase() === name.toLowerCase() || (orgNr && e.orgNr === orgNr))) return { error: 'duplicate' };
    const areas = (p.areas || []).filter((a) => st.areas.some((x) => x.code === a)); if (!areas.length) return { error: 'areas' };
    const e = { id: ctx.id('emp'), name, orgNr, contactName: String(p.contactName || '').trim(), phone: String(p.phone || '').trim(), email: String(p.email || '').trim(), areas, createdAt: ctx.now, createdBy: ctx.actorId };
    st.employers.push(e); ctx.audit('employer.added', 'employer', e.id, { areas });
    return { employerId: e.id };
  });
  A('employer.setRight', (st, p, ctx) => {
    const pl = st.placements.find((x) => x.id === p.placementId); if (!pl) return { error: 'not_found' };
    pl.fourRights = { ...(pl.fourRights || {}), [p.right]: !!p.value };
    ctx.audit('placement.four_rights_updated', 'placement', pl.id, { caseId: pl.caseId, right: p.right, value: !!p.value });
    return {};
  });
  A('employer.addFollowUp', (st, p, ctx) => {
    const pl = st.placements.find((x) => x.id === p.placementId); if (!pl || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) return { error: 'date' };
    pl.followUpDates = MM.uniq([...(pl.followUpDates || []), p.date]).sort();
    ctx.audit('placement.follow_up_added', 'placement', pl.id, { caseId: pl.caseId, date: p.date });
    return {};
  });

  // ============================================================ Små gemensamma komponenter
  const UNSET_TEXT = 'Ej fastställt – regeln aktiveras inte';
  const unsetHint = (v) => {
    const s = String(v).replace(/^ATT_FASTSTÄLLA\s*/, '').trim();
    if (!s) return null;
    if (s.startsWith('(') && s.endsWith(')')) {
      const inner = s.slice(1, -1).trim();
      if (/^förslag:/i.test(inner)) return `Förslag: ${inner.replace(/^förslag:\s*/i, '')}`;
      if (inner === 'own | unit | all') return 'Alternativ: egna ärenden, enhetens ärenden eller alla';
      return cap(inner.replace(/\s*–\s*väljs genom test$/i, ''));
    }
    return `Fastställs ${s}`;
  };
  const Unset = ({ v }) => { const h = unsetHint(v); return html`<span class="stack-sm" style="display:inline-flex;gap:4px;align-items:flex-start"><${ui.Badge} tone="red" icon="alert">${UNSET_TEXT}<//>${h && html`<span class="small muted">${h}</span>`}</span>`; };
  const YesNo = ({ v, yes = 'Ja', no = 'Nej' }) => html`<span class="row-sm" style="flex-wrap:nowrap"><${I} name=${v ? 'check-circle' : 'x-circle'} />${v ? yes : no}</span>`;
  const Val = ({ v, children }) => (MM.isUnset(v) ? html`<${Unset} v=${v} />` : typeof v === 'boolean' ? html`<${YesNo} v=${v} />` : children != null ? children : v == null || v === '' ? '–' : String(v));
  /** Etikett och värde på samma rad när det finns plats, annars under varandra (fungerar i smala kort och på 400 px). */
  const KV = ({ items, label = 170 }) => html`<dl style="margin:0">${items.filter(Boolean).map(([k, v], i) => html`<div key=${i} style=${`display:flex;flex-wrap:wrap;gap:2px 16px;padding:${i ? '9px' : '0'} 0 9px;${i ? 'border-top:1px solid var(--line)' : ''}`}>
      <dt style=${`flex:1 1 ${label}px;max-width:${label + 70}px;font-weight:600;color:var(--fg-muted);font-size:.9375rem`}>${k}</dt>
      <dd style="flex:999 1 200px;margin:0;min-width:0;overflow-wrap:anywhere">${v == null || v === '' ? '–' : v}</dd></div>`)}</dl>`;
  const Masonry = ({ items }) => html`<div style="columns:2 380px;column-gap:16px">${items.filter(Boolean).map((x, i) => html`<div key=${i} style="break-inside:avoid;margin-bottom:16px">${x}</div>`)}</div>`;
  const Group = ({ legend, help, error, children, id }) => html`
    <fieldset class=${MM.cls('field', error && 'invalid')} style="border:0;padding:0;margin:0;min-width:0" aria-describedby=${help && id ? `${id}-help` : undefined}>
      <legend class="flabel" style="padding:0;margin-bottom:6px">${legend}</legend>
      ${help && html`<div class="help" id=${id ? `${id}-help` : undefined} style="margin-bottom:4px">${help}</div>`}
      <div>${children}</div>
      ${error && html`<div class="error-text" role="alert"><${I} name="alert-circle" />${error}</div>`}
    </fieldset>`;
  /** Utfällbart kort. Pilen vänds när det är öppet och texten är understruken, så att det syns att det går att klicka. */
  const Details = ({ summary, children }) => {
    const [open, setOpen] = useState(false);
    return html`<details class="card" onToggle=${(e) => setOpen(e.currentTarget.open)}>
      <summary style="cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;padding:10px 18px;font-weight:700;list-style:none">
        <span style=${`display:inline-flex;transition:transform .15s;transform:rotate(${open ? 180 : 0}deg)`}><${I} name="chevron-down" /></span>
        <span style="text-decoration:underline;text-underline-offset:3px">${open ? 'Dölj' : 'Visa'} ${summary}</span></summary>
      <div class="card-body" style="border-top:1px solid var(--line)">${children}</div></details>`;
  };
  const Pre = ({ text }) => html`<pre style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8125rem;line-height:1.45;background:var(--surface-sub);padding:12px 14px;border-radius:var(--radius);max-height:480px;overflow:auto">${text}</pre>`;

  // ============================================================ admin.avtal – Avtal och konfiguration
  const UNSET_INFO = {
    'customerVisibility.scope': ['Vilka ärenden kommunens användare ser', 9],
    'result.definition': ['Resultatdefinition – vilka anställningar och studier som räknas', 6],
    'result.excludedFromDenominator': ['Vilka avslut som inte räknas i nämnaren', 6],
    'kpis.narvarograd.internalTarget': ['Internt mål för närvarograd', 'internt'],
    'kpis.nojdhet.internalTarget': ['Internt mål för nöjdhet', 'internt'],
    'sla.manadsrapport.due': ['Sista dag för månadsrapport', 8],
    'sla.slutrapport.within': ['Sista dag för slutrapport', 8],
    'attendance.sameDayNoticeOnInvalidAbsence': ['Frånvaronotis till kommunen samma dag', 7],
    'bonus.model': ['Incitamentsmodell för bonus', 13],
    retention: ['Gallring under avtalstiden', 11],
    'ai.provider': ['AI-leverantör', 'test'],
  };
  const findUnset = (obj, path = []) => {
    if (MM.isUnset(obj)) return [{ path: path.join('.'), value: obj }];
    const out = [];
    if (Array.isArray(obj)) obj.forEach((x, i) => out.push(...findUnset(x, [...path, (x && (x.key || x.no || x.code)) || String(i)])));
    else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) out.push(...findUnset(v, [...path, k]));
    return out;
  };
  const whoDecides = (q) => (q === 'internt' ? 'Beslutas internt av Miljonbemanning' : q === 'test' ? 'Väljs genom test i utvecklingsfas 2' : `Fråga ${q} till Botkyrka`);

  const WINDOW = { rolling_6m: 'rullande 6 månader', since_start: 'sedan avtalsstart', month: 'per månad', rolling_3m: 'rullande 3 månader' };
  const KPI_LABEL = { placeringsgrad: 'Placeringsgrad', yttranden_i_tid: 'Yttranden i tid', nojdhet: 'Nöjdhet' };
  const SLA_LABEL = { forsta_kontakt: 'Första kontakt', forsta_mote: 'Första möte' };
  const FROM = { avrop_mottaget: 'från att avropet kommit in', avslutsdatum: 'från avslutsdatum', bestallning: 'från beställning' };
  const UNIT = { participant_week: 'Per deltagare och vecka', month: 'Per månad', package: 'Paket', each: 'Per styck' };
  const PRICE_CODE = { startpaket: 'Startpaket', forlangt_stod: 'Förlängt stöd', forstarkt_stod: 'Förstärkt stöd', arbetstagarstod_startpaket: 'Arbetstagarstöd – startpaket', csn_yttrande: 'Yttrande till CSN' };
  const ROLE_WORD = { chef: 'chef', controller: 'controller', avtalsansvarig: 'avtalsansvarig', samordnare: 'samordnare', coach: 'coach' };
  const DATA_ROLE = { processor: 'Personuppgiftsbiträde – kommunen är personuppgiftsansvarig. PUB-avtal enligt SKR:s mall.', controller: 'Personuppgiftsansvarig – egen konsekvensbedömning och registerförteckning krävs.' };
  const CONTRACT_NOTES = {
    'c-bot': { termination: 'Uppsägning utan skäl tidigast två år efter start. Tre månaders uppsägningstid.', scope: 'Minst 70 och upp till 100 årsplatser i tolv avtalsområden (A–L). Miljonbemanning är rangordnad 1 i alla områden.' },
    'c-kk': { termination: 'Enligt KK-avtalet – kontrolleras före start.', scope: 'Rang 1 av 5 i kaskad. Beställningar som inte tas går vidare till nästa leverantör.' },
  };
  const slaRule = (s) => {
    if (s.within && typeof s.within === 'object') return `Inom ${withinText(s.within)} ${FROM[s.from] || ''}`.trim();
    if (MM.isUnset(s.within)) return html`<${Unset} v=${s.within} />`;
    if (MM.isUnset(s.due)) return html`<${Unset} v=${s.due} />`;
    if (s.due) return cap(String(s.due).replace(/(\d\d):(\d\d)/, '$1.$2'));
    return '–';
  };
  const pctOrUnset = (v) => (v == null ? '–' : MM.isUnset(v) ? html`<${Unset} v=${v} />` : fmt.pct(v, 0));
  const humanPattern = (p) => {
    let m = String(p).match(/^\^\[0-9\]\{(\d+),(\d+)\}\$$/); if (m) return `${m[1]}–${m[2]} siffror`;
    m = String(p).match(/^\^(\d+)\[0-9\]\{(\d+)\}\$$/); if (m) return `${m[1].length + Number(m[2])} siffror som börjar med ${m[1]}`;
    return p;
  };
  const meetingText = (m) => (m.minMeetings ? `${PRICE_CODE[m.service] || m.service}: minst ${m.minMeetings} möten à minst ${m.minMinutesEach} minuter under ${m.periodMonths} månader` : `${PRICE_CODE[m.service] || m.service}: minst ${m.minMeetingsPerMonth} möte per månad`);
  const exportText = (x) => (x.key === 'kk_manadsstatistik' ? `Månadsstatistik i KK:s format (${x.format}, ${x.fieldsPerCustomer} fält per kund)` : `${x.key} (${x.format})`);

  const CFG_SECTIONS = [
    ['Leverans och insyn', ['synlighet', 'faser', 'fastnat', 'progression', 'narvaro', 'moten']],
    ['Mål och uppföljning', ['resultat', 'kpi', 'sla', 'puls', 'statistik']],
    ['Ekonomi och avtalsvillkor', ['fakturering', 'bonus', 'viten', 'eskalering', 'avslut', 'ai', 'exporter']],
  ];
  const CFG_CARDS = {
    synlighet: { title: 'Synlighet för kunden', icon: 'eye', has: (c) => c.customerVisibility, body: (c, x) => {
      const v = c.customerVisibility;
      return html`<div class="stack">
        <${KV} items=${[
          'scope' in v && ['Ärenden kommunens användare ser', html`<${Val} v=${v.scope} />${v.prototypeScope && html`<div class="small muted" style="margin-top:4px">I prototypen: ${({ own: 'egna ärenden', unit: 'enhetens ärenden', all: 'alla ärenden' })[v.prototypeScope]}</div>`}`],
          ['Individrapporter', html`<${YesNo} v=${!!v.seesIndividualReports} />`],
          ['Coachanteckningar', html`<${YesNo} v=${!!v.seesCoachNotes} />`],
          'seesSlaStats' in v && ['SLA-statistik', html`<${YesNo} v=${!!v.seesSlaStats} /><div class="small muted">Öppen fråga 17 till ledningen.</div>`],
          c.reportDelivery && ['Rapporter levereras', c.reportDelivery.channel === 'portal' ? 'I portalen – mottagaren får en notis utan personuppgifter' : c.reportDelivery.channel],
          c.reportDelivery && ['Rapport som bilaga i e-post', html`<${YesNo} v=${!!c.reportDelivery.emailAttachmentAllowed} />`],
          c.orderChannels && ['Beställningskanaler', c.orderChannels.map((o) => ({ email: 'mejl (formell kanal)', portal: 'portal', phone: 'telefon' })[o] || o).join(', ').replace(/^./, (s) => s.toUpperCase())],
          c.thirdCountryProcessing && ['Behandling utanför EU/EES', c.thirdCountryProcessing === 'forbidden_without_written_approval' ? 'Förbjuden utan kommunens skriftliga förhandsgodkännande' : c.thirdCountryProcessing],
        ]} />
        ${x.contractId === 'c-bot' && html`<div class="stack-sm"><p class="small muted">Det interna målet visas aldrig för kommunen – bara avtalsmålet.</p><div><${ui.PerspectiveSwitch} role="kommun_chef" view="kom.chef" label="Se kundens beställarrapport" /></div></div>`}
      </div>`; } },
    faser: { title: 'Faser', icon: 'layers', has: (c) => c.phases, body: (c) => html`<ol class="stack-sm" style="margin:0;padding-left:22px">${c.phases.map((p) => html`<li key=${p.no}><b>Fas ${p.no}</b> · ${p.name}</li>`)}</ol>` },
    fastnat: { title: 'Fastnat i en fas', icon: 'clock', has: (c) => c.stuckRules, body: (c, x) => {
      const n = x.contractId === 'c-bot' ? S().cases.filter((k) => k.status === 'active' && sel.stuck(k)).length : null;
      const pn = (no) => ((c.phases || []).find((p) => p.no === no) || {}).name || '';
      return html`<div class="stack-sm"><ul class="stack-sm" style="margin:0;padding-left:20px">${c.stuckRules.map((r) => html`<li key=${r.phase}>Fas ${r.phase} (${pn(r.phase)}): flaggas efter ${r.maxDays} dagar${r.unlessPlacementPlanned ? ' – utom när praktik är planerad' : ''}.</li>`)}</ul>
        ${n != null && html`<p class="small muted">Just nu flaggas ${plural(n, 'ärende', 'ärenden')}. Flaggan går till coach och samordnare.</p>`}</div>`; } },
    progression: { title: 'Progression', icon: 'trending-up', has: (c) => c.progression, body: (c) => {
      const p = c.progression; const lab = (k) => (p.areaLabels || {})[k] || k;
      return html`<div class="stack">
        <div class="stack-sm"><div class="label-caps">Skala</div><ul class="stack-sm" style="margin:0;padding-left:20px;gap:2px">${Object.entries(p.scale).map(([k, v]) => html`<li key=${k}><b>${k}</b> – ${v}</li>`)}</ul></div>
        <div class="stack-sm"><div class="label-caps">Områden (${p.areas.length})</div><ul style="margin:0;padding-left:20px">${p.areas.map((k) => html`<li key=${k}>${lab(k)}</li>`)}</ul>
          ${(p.optionalAreas || []).length > 0 && html`<p class="small muted">Valfria områden (öppen fråga 12): ${p.optionalAreas.map(lab).join(', ')}.</p>`}</div>
        <${KV} items=${[['Observation krävs', `Från nivå ${p.observationRequiredFromLevel}`], p.statDefinition && ['Tydlig progression', cap(p.statDefinition.clear.replace('>=', '≥'))], p.statDefinition && ['Någon progression', cap(p.statDefinition.any.replace('>=', '≥'))]]} />
      </div>`; } },
    narvaro: { title: 'Närvaro', icon: 'check-square', has: (c) => c.attendance, body: (c) => html`<${KV} items=${[
      ['Frånvaronotis samma dag', html`<${Val} v=${c.attendance.sameDayNoticeOnInvalidAbsence} />`],
      ['Upprepad ogiltig frånvaro', `${c.attendance.repeatedAbsenceRule.absentInvalid} tillfällen inom ${c.attendance.repeatedAbsenceRule.withinDays} dagar ger flagga och förslag på uppföljningsmöte`],
      ['Veckorapport', 'Närvaro på deltagarnivå varje vecka, en rapport per handläggare'],
    ]} />` },
    moten: { title: 'Mötesminimum', icon: 'calendar', has: (c) => c.meetingMinimums, body: (c) => html`<ul class="stack-sm" style="margin:0;padding-left:20px">${c.meetingMinimums.map((m, i) => html`<li key=${i}>${meetingText(m)}</li>`)}</ul>` },
    resultat: { title: 'Resultat', icon: 'target', has: (c) => c.result, body: (c) => { const r = c.result; return html`<${KV} items=${[
      ['Definition', html`<${Val} v=${r.definition} />${r.prototypeDefinition && html`<div class="small muted" style="margin-top:4px">${r.prototypeDefinition}</div>`}`],
      ['Räknas som resultat', r.countsAsResult.map((x) => sel.endReasonLabel(x)).join(', ')],
      ['Räknas inte i nämnaren', html`<${Val} v=${r.excludedFromDenominator} />${r.prototypeExcluded && html`<div class="small muted" style="margin-top:4px">I prototypen: ${r.prototypeExcluded.map((x) => sel.endReasonLabel(x).toLowerCase()).join(', ')}.</div>`}`],
      ['Kräver verifiering', html`<${YesNo} v=${!!r.requiresVerification} /><div class="small muted">Utan verifiering visas resultatet som preliminärt.</div>`],
    ]} />`; } },
    kpi: { title: 'Nyckeltal (KPI:er)', icon: 'chart', flush: true, wide: true, has: (c) => c.kpis, foot: (c) => { const r = c.kpis.find((k) => k.notify); return r ? html`<span class="small muted">Flagga under internt mål: ${r.notify.belowInternal.map((x) => ROLE_WORD[x] || x).join(', ')}. Under avtalsmål: ${r.notify.belowContract.map((x) => ROLE_WORD[x] || x).join(', ')}.</span>` : null; },
      body: (c) => html`<${ui.Table} caption="Nyckeltal och mål" rows=${c.kpis.map((k) => ({ ...k, id: k.key }))} columns=${[
        { key: 'label', label: 'Nyckeltal', render: (k) => html`<div class="strong">${k.label || KPI_LABEL[k.key] || k.key}</div>${k.windows && html`<div class="cell-sub">${cap(k.windows.map((w) => WINDOW[w] || w).join(', '))}</div>`}` },
        { key: 'ct', label: 'Avtalsmål', render: (k) => pctOrUnset(k.contractTarget) },
        { key: 'it', label: 'Internt mål', render: (k) => pctOrUnset(k.internalTarget) },
        c.kpis.some((k) => k.minN != null) && { key: 'n', label: 'Minsta underlag', render: (k) => (k.minN != null ? `${k.minN} avslut` : '–') },
      ].filter(Boolean)} />` },
    sla: { title: 'Svarstider och sista dagar (SLA)', icon: 'clock', flush: true, wide: true, has: (c) => c.sla, body: (c) => html`<${ui.Table} caption="SLA" rows=${c.sla.map((s) => ({ ...s, id: s.key }))} columns=${[
      { key: 'label', label: 'Vad', render: (s) => html`<span class="strong">${s.label || SLA_LABEL[s.key] || s.key}</span>` },
      { key: 'rule', label: 'Regel', render: (s) => slaRule(s) },
      { key: 'auto', label: 'Automatiskt', render: (s) => (s.automatic ? html`<${YesNo} v=${true} />` : '–') },
    ]} />` },
    puls: { title: 'Pulsmätning', icon: 'smile', has: (c) => c.pulse, body: (c) => html`<${KV} items=${[
      ['Tillfällen', cap(c.pulse.occasions.map((o) => ({ week2: 'vecka 2', exit: 'vid avslut' })[o] || o).join(' och '))],
      ['Långa insatser', `Även var ${c.pulse.periodicEveryDays}:e dag`],
      ['Språk', cap(c.pulse.languages.map((l) => ({ sv: 'svenska', en: 'engelska', ar: 'arabiska', so: 'somaliska' })[l] || l).join(', '))],
      ['Sammanställning', `Visas först vid minst ${c.pulse.minNForAggregate} svar`],
      ['Synlighet', 'Coachen ser inte enskilda svar'],
    ]} />` },
    statistik: { title: 'Statistik', icon: 'chart', has: (c) => c.statistics, body: (c) => html`<${KV} items=${[
      ['På begäran', `Högst ${c.statistics.onRequestMaxPerYear} gånger per år, även ett år efter avtalsslut`], ['Kostnadsfritt', html`<${YesNo} v=${!!c.statistics.free} />`]]} />` },
    fakturering: { title: 'Fakturering', icon: 'card', has: (c) => c.billing, body: (c) => { const b = c.billing; return html`<${KV} items=${[
      ['Enhet', UNIT[b.unit] || b.unit],
      ['Debiterbar vecka', b.billableWeekRule === 'every_iso_week_with_at_least_one_enrolled_day_excluding_paused_weeks' ? 'Alla ISO-veckor med minst en inskriven dag, utom pausade veckor' : b.billableWeekRule],
      ['Veckans månad', b.weekToMonthRule === 'iso_thursday' ? 'Den månad där veckans torsdag infaller' : b.weekToMonthRule],
      ['Veckor utan närvaro', b.flagZeroAttendanceWeeks ? 'Flaggas för kontroll före fakturering' : 'Flaggas inte'],
      ['Fakturor', b.invoicePer === 'case_and_month' ? 'En faktura per ärende och månad' : b.invoicePer],
      ['Samlingsfaktura', html`<${YesNo} v=${!!b.collectiveInvoiceAllowed} yes="Tillåten" no="Inte tillåten" />`],
      ['Beställarreferens', `${b.buyerReference.required ? 'Krävs' : 'Frivillig'} – ${humanPattern(b.buyerReference.pattern)}`],
      ['Inköpsordernummer', `${b.purchaseOrderNumber.required ? 'Krävs' : 'Bara om kommunen lämnat ett'} – ${humanPattern(b.purchaseOrderNumber.pattern)}`],
      ['Faktureringsobjekt', b.invoicedObject === 'case_number' ? 'Ärendenumret' : b.invoicedObject],
      ['Upparbetat och återstående', html`<${YesNo} v=${!!b.showAccruedAndRemaining} yes="Anges på fakturan" no="Anges inte" />`],
      ['Betalningsvillkor', `${b.paymentTermsDays} dagar`],
      ['Ofakturerat', `Varning efter ${b.unbilledWarningDays} dagar`],
      ['Format', b.format === 'peppol_bis_3_via_fortnox' ? 'Peppol BIS Billing 3 via Fortnox' : b.format],
      ['Reserv', (b.fallback || []).map((f) => ({ export_xlsx_pdf: 'export till Excel och PDF', botkyrka_fakturaportal: 'Botkyrkas fakturaportal' })[f] || f).join(', ').replace(/^./, (s) => s.toUpperCase())],
    ]} />`; } },
    bonus: { title: 'Bonus', icon: 'award', has: (c) => c.bonus, body: (c) => { const n = S().outcomeEvents.filter((e) => e.possibleBonus).length; return html`<${KV} items=${[
      ['Status', html`<span class="row-sm">${c.bonus.enabled ? 'Aktiv' : 'Avstängd – modellen ej fastställd'}<${ui.BuildPhase} fas=${3} /></span>`],
      ['Modell', html`<${Val} v=${c.bonus.model} />`],
      ['Egen faktura', html`<${YesNo} v=${!!c.bonus.separateInvoice} />`],
      ['Underlag samlas in', `${plural(n, 'händelse', 'händelser')} markerade som möjligt bonusunderlag`],
    ]} />`; } },
    viten: { title: 'Viten och avvikelser', icon: 'alert-circle', has: (c) => c.penalties, body: (c) => html`<${KV} items=${[
      ['Vite vid avvikelse', `${fmt.kr(c.penalties.deviationOre)} per tillfälle`],
      ['Vite vid bristfällig information', `${fmt.kr(c.penalties.insufficientInformationOre)} per tillfälle`],
      c.economicDeviation && ['Ekonomisk avvikelse', c.economicDeviation],
      'keyPersonnelChangeRequiresApproval' in c && ['Byte av nyckelpersonal', c.keyPersonnelChangeRequiresApproval ? 'Kräver kommunens godkännande' : 'Kräver inte godkännande'],
    ]} />` },
    eskalering: { title: 'Eskaleringstrappa', icon: 'flag', flush: true, wide: true, has: (c) => c.escalationLadder, foot: (c) => { const w = c.escalationLadder.filter((x) => /skriftlig varning/i.test(x.text)).map((x) => x.step); return html`<span class="small muted">${w.length ? `Skriftliga varningar kan ges på steg ${w.length > 1 ? `${Math.min(...w)}–${Math.max(...w)}` : w[0]}. ` : ''}${c.warningsBeforeTermination} varningar kan leda till uppsägning.</span>`; },
      body: (c) => html`<${ui.Table} caption="Eskaleringstrappa" rows=${c.escalationLadder.map((s) => ({ ...s, id: s.step }))} columns=${[
        { key: 'step', label: 'Steg', num: true }, { key: 'level', label: 'Nivå', render: (s) => cap(s.level) }, { key: 'text', label: 'Innebörd' }]} />` },
    avslut: { title: 'Avslut och gallring', icon: 'database', has: (c) => c.termination, body: (c) => html`<${KV} items=${[
      ['Återlämning av data', `Inom ${c.termination.returnDataWithinDays} dagar efter avtalsslut`],
      ['Radering efter återlämning', html`<${YesNo} v=${!!c.termination.deleteAfterReturn} />`],
      'retention' in c && ['Gallring under avtalstiden', html`<${Val} v=${c.retention} />`],
    ]} />` },
    ai: { title: 'AI-stöd', icon: 'sparkles', has: (c) => c.ai, body: (c) => html`<${KV} items=${[
      ['Status', html`<span class="row-sm">Test pågår<${ui.BuildPhase} fas=${2} /></span>`],
      ['AI-leverantör', html`<${Val} v=${c.ai.provider} />`],
      ['Inspelning', c.ai.recordingApprovedByCustomer ? `Godkänd av kommunen ${d.fmtDate(c.ai.recordingApprovedByCustomer)} – kräver deltagarens samtycke` : '–'],
    ]} />` },
    exporter: { title: 'Exporter', icon: 'download', has: (c) => c.exports, body: (c) => html`<ul class="stack-sm" style="margin:0;padding-left:20px">${c.exports.map((x) => html`<li key=${x.key}>${exportText(x)}</li>`)}</ul>` },
  };

  const ContractPicker = ({ value, onChange }) => html`<div class="grid-2" role="group" aria-label="Välj avtal">
    ${S().contracts.map((c) => { const on = c.id === value; return html`<button type="button" key=${c.id} class="rolecard" aria-pressed=${on ? 'true' : 'false'} onClick=${() => onChange(c.id)}
        style=${on ? 'border:2px solid var(--antracit);box-shadow:inset 5px 0 0 var(--rod)' : ''}>
      <span class="rc-title"><${I} name=${c.id === 'c-kk' ? 'briefcase' : 'building'} />${c.customerName}</span>
      <span class="rc-sub">${c.name} · ${c.contractNumber}</span>
      <span class="row-sm">${c.status === 'active' ? html`<${ui.Badge} tone="blue" icon="check">Aktivt sedan ${d.fmtDate(c.startsOn)}<//>` : html`<${ui.Badge} tone="outline" icon="clock">Utkast – startar ${d.fmtDate(c.startsOn)}<//><${ui.BuildPhase} fas=${4} />`}</span>
    </button>`; })}
  </div>`;

  const ContractFacts = ({ k }) => {
    const n = CONTRACT_NOTES[k.id] || {}; const mgr = MM.personName(k.contractManagerId);
    return html`<${ui.Card} title="Avtalsfakta" icon="file">
      <div class="grid-2" style="gap:12px 32px">
        <${KV} items=${[
          ['Kund', `${k.customerName} (${k.customerOrgNr})`], ['Leverantör', `${k.supplierName} (${k.supplierOrgNr})`], ['Avtal', k.name],
          ['Avtalsnummer', k.contractNumber], ['Diarienummer', k.dnr], ['Avtalsperiod', k.endsOn ? `${d.fmtDate(k.startsOn)} – ${d.fmtDate(k.endsOn)}` : `Från ${d.fmtDate(k.startsOn)}`],
          ['Uppsägning', n.termination || '–'],
        ]} />
        <${KV} items=${[
          ['Status', k.status === 'active' ? html`<${ui.Badge} tone="blue" icon="check">Aktivt<//>` : html`<${ui.Badge} tone="outline" icon="clock">Utkast<//>`],
          ['Personuppgiftsroll', DATA_ROLE[k.dataRole] || k.dataRole], ['Ärendeprefix', `${k.casePrefix} – till exempel ${k.casePrefix}-${d.today().slice(2, 4)}-0001`],
          ['Tillåtna e-postdomäner', (k.emailDomains || []).length ? k.emailDomains.join(', ') : 'Inga ännu – läggs till före start'], ['Avtalsansvarig', mgr], ['Omfattning', n.scope || '–'],
        ]} />
      </div>
    <//>`;
  };

  const UnsetWarnings = ({ list }) => (list.length === 0 ? null : html`<${ui.Notice} tone="warn" icon="alert" title=${`${plural(list.length, 'värde är', 'värden är')} inte fastställda – reglerna aktiveras inte`}>
    <div class="stack-sm" style="margin-top:4px">
      <p>Systemet vägrar aktivera en regel som fortfarande har värdet ATT_FASTSTÄLLA. Värdena är markerade i korten nedan.</p>
      <ul class="stack-sm" style="margin:0;padding-left:20px;gap:4px">${list.map((u) => { const info = UNSET_INFO[u.path] || [u.path, null]; const hint = unsetHint(u.value);
        return html`<li key=${u.path}><b>${info[0]}</b> – ${info[1] != null ? whoDecides(info[1]) : 'Ska fastställas'}${hint ? html`<span class="muted"> (${/^(Förslag|Alternativ|Fastställs)/.test(hint) ? hint.charAt(0).toLowerCase() + hint.slice(1) : hint})</span>` : ''}</li>`; })}</ul>
      <div><${ui.Btn} kind="secondary" icon="help" onClick=${() => MM.nav('om.fragor', {})}>Öppna frågor till Botkyrka<//></div>
    </div><//>`);

  const ConfigTab = ({ contractId }) => {
    const st = MM.useStore(); const k = st.contracts.find((c) => c.id === contractId); const cfg = k.config;
    const unset = findUnset(cfg);
    const x = { contractId };
    const card = (key) => { const c = CFG_CARDS[key]; if (!c || !c.has(cfg)) return null; return html`<${ui.Card} key=${key} title=${c.title} icon=${c.icon} flush=${c.flush} foot=${c.foot ? c.foot(cfg, x) : null}>${c.body(cfg, x)}<//>`; };
    const present = (keys) => keys.filter((key) => CFG_CARDS[key] && CFG_CARDS[key].has(cfg));
    return html`<div class="stack-lg">
      ${contractId === 'c-bot' ? html`<${UnsetWarnings} list=${unset} />` : html`<${ui.Notice} tone="info" title=${`Utkast – avtalet startar ${d.fmtDate(k.startsOn)}`}>
        Konfigurationen är en skiss som visar att samma kod räcker. Övriga regler (faser, fakturering, puls med mera) läggs in när KK-avtalet konfigureras i utvecklingsfas 4. Kontrollera i KK-avtalet om dagarna är kalender- eller arbetsdagar och vilka de åtta statistikfälten är.<//>`}
      <${ContractFacts} k=${k} />
      ${CFG_SECTIONS.map(([title, keys]) => { const ks = present(keys); const narrow = ks.filter((key) => !CFG_CARDS[key].wide); const wide = ks.filter((key) => CFG_CARDS[key].wide);
        return ks.length > 0 && html`<${ui.Section} title=${title} key=${title}>${wide.map(card)}${narrow.length > 0 && html`<${Masonry} items=${narrow.map(card)} />`}<//>`; })}
      <${Details} summary="JSON (contracts.config)">
        <p class="small muted" style="margin-bottom:10px">Så lagras konfigurationen i databasen. Den valideras med ett zod-schema innan den sparas.</p>
        <${Pre} text=${JSON.stringify(cfg, null, 2)} />
      <//>
    </div>`;
  };

  const PriceTab = ({ contractId }) => {
    const st = MM.useStore(); const k = st.contracts.find((c) => c.id === contractId);
    if (k.config.priceItems) {
      return html`<${ui.Card} title="Prislista – skiss" icon="card" flush actions=${html`<${ui.Badge} tone="plan" icon="alert-circle">Skiss – kontrolleras mot KK-avtalet<//>`}
        foot=${html`<span class="small muted">Paket-, månads- och styckpriser hanteras med samma tabell (price_items.unit) som Botkyrkas veckopriser.</span>`}>
        <${ui.Table} caption="Prislista Kammarkollegiet" rows=${k.config.priceItems.map((p) => ({ ...p, id: p.code }))} columns=${[
          { key: 'code', label: 'Tjänst', render: (p) => html`<span class="strong">${PRICE_CODE[p.code] || p.code}</span>` },
          { key: 'unit', label: 'Enhet', render: (p) => `${UNIT[p.unit] || p.unit}${p.packageMonths ? ` (${p.packageMonths} månader)` : ''}` },
          { key: 'price', label: 'Pris exkl. moms', num: true, render: (p) => fmt.kr(p.price * 100) },
        ]} />
      <//>`;
    }
    const items = st.priceItems.filter((p) => p.contractId === contractId).sort(MM.by('areaCode'));
    const prices = items.map((p) => p.priceOre);
    return html`<div class="stack">
      <${ui.Card} title="Prislista – pris per deltagare och vecka" icon="card" flush actions=${html`<${ui.Badge} tone="plan" icon="alert-circle">Exempelpriser – de riktiga priserna står i avtalet<//>`}
        foot=${html`<span class="small muted">Priserna är fasta i 12 månader. Därefter får de justeras enligt indexklausulen i avtalet, högst en gång per tolvmånadersperiod och aldrig retroaktivt. Vid justering skapas en ny rad med nytt giltighetsdatum – den gamla sparas.</span>`}>
        <div class="card-body row" style="border-bottom:1px solid var(--line)">
          <span><b>${items.length}</b> avtalsområden</span>
          ${items.length > 0 && html`<span><b>${fmt.kr(Math.min(...prices))}–${fmt.kr(Math.max(...prices))}</b> per deltagare och vecka exkl. moms</span>`}
          <span class="muted">Artikelnummer matchar artiklarna i Fortnox</span>
        </div>
        <${ui.Table} caption="Prislista Botkyrka" rows=${items} columns=${[
          { key: 'area', label: 'Avtalsområde', render: (p) => sel.areaName(p.areaCode) },
          { key: 'art', label: 'Artikelnummer', render: (p) => html`<span class="mono">${p.fortnoxArticleNo}</span>` },
          { key: 'unit', label: 'Enhet', render: (p) => UNIT[p.unit] || p.unit },
          { key: 'price', label: 'Pris exkl. moms', num: true, nowrap: true, render: (p) => fmt.kr(p.priceOre) },
          { key: 'vat', label: 'Moms', num: true, render: (p) => `${p.vatRate} %` },
          { key: 'valid', label: 'Giltig', nowrap: true, render: (p) => `${d.fmtDate(p.validFrom)} – ${d.fmtDate(p.validTo)}` },
        ]} />
      <//>
    </div>`;
  };

  /** En pris-rad i klarspråk: "Startpaket – 4 120 kr per paket (4 månader)". */
  const priceLine = (p) => `${PRICE_CODE[p.code] || p.code} – ${fmt.kr(p.price * 100)} ${({ package: 'per paket', month: 'per månad', each: 'per styck', participant_week: 'per deltagare och vecka' })[p.unit] || ''}${p.packageMonths ? ` (${p.packageMonths} månader)` : ''}`.trim();
  const Lines = ({ items }) => (items.length === 0 ? '–' : items.length === 1 ? items[0] : html`<ul class="stack-sm" style="margin:0;padding-left:18px;gap:2px">${items.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>`);
  /** Jämförelsetabellen: tre kolumner på bred skärm, en regel i taget med rubrik per avtal på mobil (ingen sidledsscroll). */
  const STACK_CSS = `.adm-stack tbody th{text-transform:none;letter-spacing:0;font-size:.9375rem;color:var(--antracit);white-space:normal;vertical-align:top;border-bottom:1px solid var(--line)}
@media (max-width:720px){.adm-stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.adm-stack,.adm-stack tbody,.adm-stack tr,.adm-stack th,.adm-stack td{display:block;width:auto}
.adm-stack tr{padding:8px 0;border-bottom:1px solid var(--line)}.adm-stack tbody th,.adm-stack td{border:0 !important;padding:3px 16px}
.adm-stack td[data-label]::before{content:attr(data-label);display:block;font-size:var(--fs-label);font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-muted);margin:4px 0 2px}}`;
  const CompareTab = ({ onShowPrices }) => {
    const st = MM.useStore(); const bot = MM.contract('c-bot'); const kk = MM.contract('c-kk');
    const model = (k) => (k.config.priceItems ? MM.uniq(k.config.priceItems.map((p) => p.unit)) : MM.uniq(st.priceItems.filter((p) => p.contractId === k.id).map((p) => p.unit))).map((u) => (UNIT[u] || u).toLowerCase()).join(', ').replace(/^./, (x) => x.toUpperCase());
    const prices = (k) => {
      if (k.config.priceItems) return html`<${Lines} items=${k.config.priceItems.map(priceLine)} />`;
      const ps = st.priceItems.filter((p) => p.contractId === k.id).map((p) => p.priceOre);
      return ps.length ? `${fmt.kr(Math.min(...ps))}–${fmt.kr(Math.max(...ps))} per deltagare och vecka beroende på avtalsområde (exempelpriser)` : '–';
    };
    const kpis = (k) => html`<${Lines} items=${k.config.kpis.filter((x) => typeof x.contractTarget === 'number').map((x) => `${x.label || KPI_LABEL[x.key] || x.key}: ${fmt.pct(x.contractTarget, 0)}${typeof x.internalTarget === 'number' ? ` (internt mål ${fmt.pct(x.internalTarget, 0)})` : ''}`)} />`;
    const sla = (k) => html`<${Lines} items=${k.config.sla.filter((x) => x.within && typeof x.within === 'object' && !x.automatic).map((x) => `${x.label || SLA_LABEL[x.key] || x.key} inom ${withinText(x.within)} ${FROM[x.from] || ''}`.trim())} />`;
    const meet = (k) => html`<${Lines} items=${(k.config.meetingMinimums || []).map(meetingText)} />`;
    const stats = (k) => html`<${Lines} items=${[k.config.statistics && `På begäran, högst ${k.config.statistics.onRequestMaxPerYear} gånger per år`, ...(k.config.exports || []).map(exportText)].filter(Boolean)} />`;
    const status = (k) => (k.status === 'active' ? `Aktivt sedan ${d.fmtDate(k.startsOn)}` : `Utkast – startar ${d.fmtDate(k.startsOn)}`);
    const rows = [
      ['Status', status], ['Personuppgiftsroll', (k) => (k.dataRole === 'processor' ? 'Personuppgiftsbiträde' : 'Personuppgiftsansvarig')], ['Ärendenummer', (k) => `${k.casePrefix}-${d.today().slice(2, 4)}-0001`],
      ['Prismodell', model], ['Priser exkl. moms', prices], ['Nyckeltal med avtalsmål', kpis], ['Svarstider (SLA)', sla], ['Mötesminimum', (k) => ((k.config.meetingMinimums || []).length ? meet(k) : 'Inget krav')],
      ['Kunden ser individrapporter', (k) => html`<${YesNo} v=${!!k.config.customerVisibility.seesIndividualReports} />`], ['Kunden ser coachanteckningar', (k) => html`<${YesNo} v=${!!k.config.customerVisibility.seesCoachNotes} />`],
      ['Statistik', stats],
    ].map(([label, fn]) => ({ id: label, label, bot: fn(bot), kk: fn(kk) }));
    return html`<div class="stack">
      <${ui.Notice} tone="info" title="Samma kod – ny konfiguration">Kammarkollegiet blir avtal nr 2. Kärnflödena är desamma – det som skiljer läses från avtalets konfiguration. Acceptanskriterium i utvecklingsfas 4: KK-avtalet ska kunna konfigureras utan kodändring.<//>
      <${ui.Card} title="Botkyrka kommun och Kammarkollegiet" icon="layers" flush actions=${html`<${ui.BuildPhase} fas=${4} />`}
        foot=${html`<span class="small muted">Botkyrka betalar per deltagare och vecka, Kammarkollegiet per paket, månad eller styck. Att kontrollera i KK-avtalet: om dagarna i svarstiderna är kalender- eller arbetsdagar, och vilka de åtta statistikfälten är.</span>
          ${onShowPrices && html`<${ui.Btn} kind="secondary" icon="card" onClick=${onShowPrices}>Visa Kammarkollegiets prislista<//>`}`}>
        <style>${STACK_CSS}</style>
        <div class="table-wrap"><table class="table adm-stack">
          <caption class="sr-only">Jämförelse mellan avtalen</caption>
          <thead><tr><th scope="col" style="width:22%">Regel</th><th scope="col">Botkyrka kommun</th><th scope="col">Kammarkollegiet</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr key=${r.id}><th scope="row">${r.label}</th><td data-label="Botkyrka kommun">${r.bot}</td><td data-label="Kammarkollegiet">${r.kk}</td></tr>`)}</tbody>
        </table></div>
      <//>
    </div>`;
  };

  // ---- Interna regler (Miljonbemanning) – st.orgConfig.notifications
  const RECIPIENTS = [['chef', 'Chef och controller'], ['avtalsansvarig', 'Avtalsansvarig'], ['samordnare', 'Samordnare']];
  const CHANNEL_OPTS = [['app', 'I appen (notiser)'], ['email', 'E-post utan personuppgifter']];
  const ESC_WORD = { chef: 'chef/controller', avtalsansvarig: 'avtalsansvarig', samordnare: 'samordnare' };
  const weeksWord = (n) => (n === 1 ? '1 vecka' : `${n} veckor`);
  const ruleDiffText = (a, b) => {
    const parts = [];
    if (a.remind !== b.remind) parts.push(`påminnelse efter ${weeksWord(a.remind)} → ${weeksWord(b.remind)}`);
    if (a.esc !== b.esc) parts.push(`eskalering efter ${weeksWord(a.esc)} → ${weeksWord(b.esc)} i rad`);
    if (a.to.join() !== b.to.join()) parts.push(`mottagare ${a.to.map((r) => ESC_WORD[r] || r).join(', ')} → ${b.to.map((r) => ESC_WORD[r] || r).join(', ')}`);
    if (a.channels.join() !== b.channels.join()) parts.push(`kanaler ${a.channels.map((c) => (c === 'app' ? 'appen' : 'e-post')).join(' och ')} → ${b.channels.map((c) => (c === 'app' ? 'appen' : 'e-post')).join(' och ')}`);
    if ((a.assign || []).join() !== (b.assign || []).join()) parts.push(`kanaler vid tilldelning → ${(b.assign || []).map((c) => (c === 'app' ? 'appen' : 'e-post')).join(' och ')}`);
    return parts.length ? cap(parts.join('; ')) : 'Inga ändringar';
  };
  const InternalRules = () => {
    const st = MM.useStore(); const n = st.orgConfig.notifications; const pw = n.progressionWatch;
    const saved = ruleSnapshot(n);
    const [f, setF] = useState(saved);
    const toggle = (key, v) => setF((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v] }));
    const errs = {};
    if (!(f.esc > f.remind)) errs.esc = 'Eskaleringen måste komma efter påminnelsen. Välj fler veckor.';
    if (!f.to.length) errs.to = 'Välj minst en mottagare.';
    if (!f.channels.length) errs.channels = 'Välj minst en kanal.';
    if (!f.assign.length) errs.assign = 'Välj minst en kanal.';
    const norm = (r) => JSON.stringify({ ...r, to: [...r.to].sort(), channels: [...r.channels].sort(), assign: [...r.assign].sort() });
    const dirty = norm(f) !== norm(saved);
    const streaks = useMemo(() => st.cases.filter((c) => c.status === 'active').map((c) => sel.noProgressStreak(c).streak), [MM.store.version]);
    const count = (w) => streaks.filter((s) => s >= w).length;
    const history = st.auditLog.filter((a) => a.action === 'org_rule.updated').slice().reverse();
    const save = () => {
      const r = MM.dispatch('admin.setOrgRule', { remindCoachAfterWeeks: f.remind, escalateAfterConsecutiveWeeks: f.esc, escalateTo: f.to, channels: f.channels, assignmentChannels: f.assign });
      if (r && r.error) MM.toast('Reglerna kunde inte sparas. Kontrollera fälten.', 'red');
      else { setF(ruleSnapshot(MM.store.state.orgConfig.notifications)); MM.toast('Reglerna är sparade. Notiser och flaggor räknas om direkt.', 'blue'); }
    };
    const toText = f.to.map((r) => ESC_WORD[r] || r).join(', ') || 'ingen mottagare';
    return html`<div class="stack-lg">
      <${ui.Notice} tone="info" title="Interna regler för Miljonbemanning – inte avtalskrav">Reglerna styr hur vi själva följer upp ärenden i alla avtal. Kommunen ser dem inte, och de ändrar inga avtalsvärden.<//>
      <div class="split-wide">
        <${ui.Card} title="Påminnelser och eskalering" icon="bell"
          foot=${html`<${ui.Btn} kind="primary" icon="check" disabled=${!dirty || Object.keys(errs).length > 0} onClick=${save}>Spara reglerna<//>
            ${dirty && html`<${ui.Btn} kind="ghost" icon="reset" onClick=${() => setF(saved)}>Ångra ändringarna<//>`}
            ${!dirty && html`<span class="small muted">Inga osparade ändringar.</span>`}`}>
          <div class="stack">
            <div class="form-grid">
              <${ui.Field} id="rule-remind" label="Påminn coachen efter" help="Veckor utan progression: veckomålet är inte uppnått eller ingen avstämning är godkänd.">
                <${ui.Select} id="rule-remind" value=${String(f.remind)} onChange=${(v) => setF((x) => ({ ...x, remind: Number(v) }))} options=${[1, 2, 3, 4].map((w) => ({ value: String(w), label: weeksWord(w) }))} /><//>
              <${ui.Field} id="rule-esc" label="Eskalera efter" help="Veckor i rad utan progression innan ärendet eskaleras." error=${errs.esc}>
                <${ui.Select} id="rule-esc" value=${String(f.esc)} invalid=${!!errs.esc} onChange=${(v) => setF((x) => ({ ...x, esc: Number(v) }))} options=${[2, 3, 4, 5, 6].map((w) => ({ value: String(w), label: `${w} veckor i rad` }))} /><//>
            </div>
            <${Group} id="rule-to" legend="Mottagare av eskaleringen" help="Varje notis har exakt en mottagare. Coachen kan inte väljas." error=${errs.to}>
              ${RECIPIENTS.map(([r, label]) => html`<${ui.Check} key=${r} id=${`rule-to-${r}`} checked=${f.to.includes(r)} onChange=${() => toggle('to', r)}>${label} <span class="muted">(${MM.personName(MM.roleDef(r).personaId)})</span><//>`)}
              <${ui.Check} id="rule-to-coach" checked=${false} disabled=${true}>Coach <span class="muted">– kan inte väljas</span><//>
            <//>
            <${Group} id="rule-ch" legend="Kanaler för påminnelser och eskaleringar" help="E-posten innehåller bara ärendenumret och en uppmaning att logga in." error=${errs.channels}>
              ${CHANNEL_OPTS.map(([c, label]) => html`<${ui.Check} key=${c} id=${`rule-ch-${c}`} checked=${f.channels.includes(c)} onChange=${() => toggle('channels', c)}>${label}<//>`)}
            <//>
            <${Group} id="rule-as" legend="Kanaler för notis vid tilldelning" help="Huvudcoach och team får notis när ett ärende tilldelas eller coach byts." error=${errs.assign}>
              ${CHANNEL_OPTS.map(([c, label]) => html`<${ui.Check} key=${c} id=${`rule-as-${c}`} checked=${f.assign.includes(c)} onChange=${() => toggle('assign', c)}>${label}<//>`)}
            <//>
            <div class="field">
              <span class="flabel" id="rule-visible-label">Eskalering syns för coachen</span>
              <div class="row-sm" role="note" aria-labelledby="rule-visible-label" style="min-height:44px;padding:8px 12px;border:1.5px dashed var(--line-strong);border-radius:var(--radius);background:var(--surface-sub)">
                <${I} name="lock" /><b>Nej</b><span class="muted">– låst</span></div>
              <div class="help">Styrs av behörigheten, inte av en inställning. En eskalering kan bara läsas av sina mottagare – aldrig av coachen eller handledaren. Coachen ser sina egna påminnelser.</div>
            </div>
          </div>
        <//>
        <div class="stack">
          <${ui.Card} title="Så slår reglerna igenom just nu" icon="activity">
            <div class="stack">
              <div class="stack-sm" style="gap:12px">
                <${ui.Kpi} label="Påminnelser till coacher" value=${count(f.remind)} sub=${`ärenden med minst ${weeksWord(f.remind)} utan progression`} />
                <${ui.Kpi} label="Eskaleringar" value=${f.esc > f.remind ? count(f.esc) : '–'} sub=${`till ${toText} – syns inte för coachen`} tone=${f.esc > f.remind && count(f.esc) > 0 ? 'watch' : ''} />
              </div>
              ${dirty && html`<p class="small muted">Med de sparade reglerna: ${count(saved.remind)} påminnelser och ${count(saved.esc)} eskaleringar.</p>`}
              <p class="small muted">Påminnelsen skickas ${pw.reminderSchedule}. Ändringen slår igenom direkt i notiser och flaggor.</p>
              <div class="row-sm"><${ui.PerspectiveSwitch} role="coach" view="notiser" label="Se coachens notiser" /><${ui.PerspectiveSwitch} role="chef" view="notiser" label="Se chefens notiser" /></div>
            </div>
          <//>
          <${ui.Card} title="Ändringshistorik" icon="book">
            ${history.length === 0 ? html`<p class="muted">Inga ändringar sedan avtalsstart. Varje ändring loggas i revisionsloggen.</p>`
              : html`<div class="stack-sm">${history.map((a) => html`<div key=${a.id} class="stack-sm" style="gap:2px;padding-bottom:8px;border-bottom:1px solid var(--line)">
                  <div class="small muted">${d.fmtDateTime(a.occurredAt)} · ${MM.personName(a.actorId)}${a.byTester ? ' · gjort av dig i prototypen' : ''}</div>
                  <div>${a.details && a.details.from && a.details.to ? ruleDiffText(a.details.from, a.details.to) : 'Reglerna ändrades'}</div></div>`)}</div>`}
          <//>
        </div>
      </div>
      <${Details} summary="JSON (orgConfig.notifications)"><${Pre} text=${JSON.stringify(n, null, 2)} /><//>
      <${ui.DemoNote}>Ändringen slår igenom direkt i prototypens notiser och flaggor. I den riktiga tjänsten sparas reglerna i en egen tabell för Miljonbemannings interna regler, och påminnelserna skickas av ett bakgrundsjobb måndag 08.00.<//>
    </div>`;
  };

  const AvtalView = ({ params }) => {
    const st = MM.useStore();
    const [contractId, setContract] = useState(params.contract === 'c-kk' ? 'c-kk' : 'c-bot');
    const TAB_ALIAS = { jamforelse: 'jamfor', prislista: 'priser' };
    const want = TAB_ALIAS[params.tab] || params.tab;
    const [tab, setTab] = useState(['avtal', 'priser', 'jamfor', 'interna'].includes(want) ? want : 'avtal');
    const k = st.contracts.find((c) => c.id === contractId);
    const unsetN = findUnset(k.config).length;
    // På mobil ryms inte alla flikar – se till att den valda fliken syns när vyn öppnas med tab-param.
    useEffect(() => { const t = setTimeout(() => { const el = document.querySelector('#main [role=tab][aria-selected=true]'); const strip = el && el.closest('[role=tablist]'); if (!strip || strip.scrollWidth <= strip.clientWidth) return; const a = el.getBoundingClientRect(); const b = strip.getBoundingClientRect(); if (a.left < b.left || a.right > b.right) strip.scrollLeft += a.left - b.left - 16; }, 0); return () => clearTimeout(t); }, [tab]);
    return html`<${ui.Page} title="Avtal och konfiguration" eyebrow=${`Systemadmin · ${MM.personName('u-robin')}`}
      lead="Ett avtal är en konfiguration. Samma kod används för Botkyrka och Kammarkollegiet – mål, svarstider, priser och rapportregler läses härifrån och är aldrig hårdkodade.">
      <${ui.Tabs} ariaLabel="Delar av avtalet" active=${tab} onChange=${setTab} tabs=${[
        { id: 'avtal', label: 'Avtal och regler', icon: 'file', count: unsetN },
        { id: 'priser', label: 'Prislista', icon: 'card' },
        { id: 'jamfor', label: 'Jämför avtalen', icon: 'layers' },
        { id: 'interna', label: 'Interna regler (Miljonbemanning)', icon: 'bell' },
      ]} />
      ${['avtal', 'priser'].includes(tab) && html`<${ContractPicker} value=${contractId} onChange=${setContract} />`}
      ${tab === 'avtal' && html`<${ConfigTab} contractId=${contractId} key=${contractId} />`}
      ${tab === 'priser' && html`<${PriceTab} contractId=${contractId} key=${contractId} />`}
      ${tab === 'jamfor' && html`<${CompareTab} onShowPrices=${() => { setContract('c-kk'); setTab('priser'); }} />`}
      ${tab === 'interna' && html`<${InternalRules} />`}
    <//>`;
  };
  MM.registerView('admin.avtal', { title: (p) => (p && ['jamfor', 'jamforelse'].includes(p.tab) ? 'Jämför avtalen' : p && p.tab === 'interna' ? 'Interna regler (Miljonbemanning)' : p && p.contract === 'c-kk' ? 'Avtal: Kammarkollegiet' : 'Avtal och konfiguration'), roles: ['admin'], component: AvtalView });

  // ============================================================ admin.anvandare – Användare och roller
  const ROLE_ORDER = ['admin', 'avtalsansvarig', 'samordnare', 'coach', 'handledare', 'chef', 'ekonom'];
  const ROLE_TABLE = [
    ['Systemadmin', 'Miljonbemanning', 'Allt inklusive konfiguration och logg', 'Användare, avtal, integrationer', 'Microsoft Entra ID'],
    ['Avtalsansvarig och kundansvarig', 'Miljonbemanning', 'Allt inom sina avtal', 'Accepterar och avböjer avrop, godkänner beställarrapport, hanterar avtalsavvikelser, bjuder in kommunanvändare', 'Microsoft Entra ID'],
    ['Operativ samordnare', 'Miljonbemanning', 'Alla ärenden i avtalet', 'Avropsinkorg, tilldelar coach, bokar start', 'Microsoft Entra ID'],
    ['Huvudcoach', 'Miljonbemanning', 'Egna ärenden', 'Kartläggning, avstämningar, närvaro, bedömningar, utfall, rapporter', 'Microsoft Entra ID'],
    ['Handledare, arbetsgivarmatchare och SYV', 'Miljonbemanning', 'Tilldelade ärenden', 'Moment, praktik, arbetsgivarkontakter, närvaro, validering', 'Microsoft Entra ID'],
    ['Chef och controller', 'Miljonbemanning', 'Allt i läsläge, nyckeltal, flaggor, revisionslogg', 'Kvitterar flaggor, åtgärdsplaner, loggkontroll', 'Microsoft Entra ID'],
    ['Ekonom', 'Miljonbemanning', 'Ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag – inga anteckningar eller rapporter', 'Fakturakörning, Fortnox, export', 'Microsoft Entra ID'],
    ['Kommunens handläggare och coach', 'Botkyrka kommun', 'Egna anvisade ärenden – eller hela enheten, om avtalskonfigurationen säger det', 'Beställer, läser rapporter, skickar meddelanden, kvitterar, beslutar om bonusanspråk', 'E-post och engångskod'],
    ['Kommunens chef', 'Botkyrka kommun', 'Beställarrapport och enhetens ärenden', 'Läser, laddar ner, godkänner åtgärdsplaner', 'E-post och engångskod'],
    ['Deltagare', 'Utan inloggning i piloten', 'Egen plan och bokningar (utvecklingsfas 4)', 'Svarar på pulsmätningen via engångslänk', 'Ingen – BankID senare'],
  ];
  const MX_ROLES = [['admin', 'Admin'], ['avtalsansvarig', 'Avtals\u00adansvarig'], ['samordnare', 'Sam\u00adordnare'], ['coach', 'Coach'], ['handledare', 'Hand\u00adledare'], ['chef', 'Chef och con\u00adtroller'], ['ekonom', 'Ekonom'], ['kommun_handlaggare', 'Kommunens hand\u00adläggare'], ['kommun_chef', 'Kommunens chef']];
  const MX_CELL = { ja: ['check', 'Ja'], alla: ['check', 'Alla'], nej: ['minus', 'Nej'], las: ['eye', 'Läsa'], egna: ['user', 'Egna'], tilldelade: ['user', 'Tilldelade'], namngiven: ['user', 'Om namngiven'], nummer: ['hash', 'Bara nummer'], enheten: ['users', 'Enhetens'], mottagare: ['bell', 'Mottagare'], dold: ['eye-off', 'Syns inte'], ser: ['eye', 'Ser att de skickats'] };
  const matrixGroups = () => {
    const pw = sel.orgRules().progressionWatch; const esc = pw.escalateTo;
    const roles = MX_ROLES.map((r) => r[0]);
    return [
      ['Ser', [
        ['Ärenden i avtalet', ['alla', 'alla', 'alla', 'egna', 'tilldelade', 'las', 'nummer', 'egna', 'enheten']],
        ['Skyddade personuppgifter', ['nej', 'ja', 'nej', 'namngiven', 'nej', 'nej', 'nej', 'egna', 'enheten']],
        ['Coachanteckningar', ['ja', 'ja', 'ja', 'egna', 'tilldelade', 'las', 'nej', 'nej', 'nej']],
        ['Rapporter', ['ja', 'ja', 'ja', 'egna', 'tilldelade', 'las', 'nej', 'egna', 'enheten']],
        ['Fakturaunderlag', ['ja', 'ja', 'nej', 'nej', 'nej', 'las', 'ja', 'nej', 'nej']],
        ['Avtalskonfiguration', ['ja', 'las', 'nej', 'nej', 'nej', 'las', 'nej', 'nej', 'nej']],
        ['Revisionslogg', ['ja', 'nej', 'nej', 'nej', 'nej', 'ja', 'nej', 'nej', 'nej']],
      ]],
      ['Gör', [
        ['Acceptera och avböja avrop', ['nej', 'ja', 'ja', 'nej', 'nej', 'nej', 'nej', 'nej', 'nej']],
        ['Bjuda in kommunanvändare', ['ja', 'ja', 'nej', 'nej', 'nej', 'nej', 'nej', 'nej', 'nej']],
        ['Ändra avtal, användare och integrationer', ['ja', 'nej', 'nej', 'nej', 'nej', 'nej', 'nej', 'nej', 'nej']],
        ['Kvittera flaggor och godkänna åtgärdsplaner', ['nej', 'ja', 'nej', 'nej', 'nej', 'ja', 'nej', 'nej', 'ja']],
        ['Fakturakörning och Fortnox', ['nej', 'nej', 'nej', 'nej', 'nej', 'nej', 'ja', 'nej', 'nej']],
        ['Månatlig loggkontroll', ['nej', 'nej', 'nej', 'nej', 'nej', 'ja', 'nej', 'nej', 'nej']],
      ]],
      ['Notiser', [
        ['Notis vid tilldelning: huvudcoach och team', roles.map((r) => (['coach', 'handledare'].includes(r) ? 'mottagare' : 'nej'))],
        ['Påminnelser om utebliven progression: coach', roles.map((r) => (r === 'coach' ? 'mottagare' : r === 'chef' ? 'ser' : 'nej'))],
        [`Eskaleringar: ${esc.map((r) => ESC_WORD[r] || r).join(', ')} – syns inte för coachen`, roles.map((r) => (esc.includes(r) ? 'mottagare' : ['coach', 'handledare'].includes(r) ? 'dold' : 'nej'))],
      ]],
    ];
  };
  const Matrix = () => html`<div class="table-wrap"><table class="table">
    <caption class="sr-only">Behörighetsmatris: vad varje roll ser, gör och får för notiser</caption>
    <thead><tr><th scope="col" style="min-width:150px;position:sticky;left:0;z-index:1;vertical-align:bottom">Behörighet</th>${MX_ROLES.map(([k, l]) => html`<th scope="col" key=${k} style="white-space:normal;vertical-align:bottom;padding:8px 6px;hyphens:manual;font-size:.6875rem;letter-spacing:.05em">${l}</th>`)}</tr></thead>
    <tbody>${matrixGroups().map(([g, rows]) => html`
      <tr key=${g}><th scope="rowgroup" colspan=${MX_ROLES.length + 1} style="background:var(--surface-sub);border-bottom:1px solid var(--line)">${g}</th></tr>
      ${rows.map(([label, cells]) => html`<tr key=${label}>
        <th scope="row" style="text-transform:none;letter-spacing:0;font-size:.875rem;font-weight:700;color:var(--antracit);white-space:normal;vertical-align:top;border-bottom:1px solid var(--line);position:sticky;left:0;z-index:1;background:var(--vit)">${label}</th>
        ${cells.map((c, i) => { const [icon, txt] = MX_CELL[c]; return html`<td key=${i} class=${c === 'nej' ? 'muted' : ''} style="padding:8px 6px;font-size:.8125rem"><span style="display:inline-flex;flex-wrap:wrap;gap:2px 4px;align-items:center"><${I} name=${icon} /><span>${txt}</span></span></td>`; })}
      </tr>`)}`)}</tbody></table></div>`;

  const InviteModal = ({ onClose }) => {
    const st = MM.useStore(); const k = MM.contract('c-bot'); const domains = k.emailDomains || [];
    const units = MM.uniq([...st.buyerReferences.filter((b) => b.active).map((b) => b.unit), ...st.customerUsers.map((u) => u.unit)]).filter(Boolean);
    const [f, setF] = useState({ name: '', email: '', role: 'handlaggare', unit: '' });
    const [tried, setTried] = useState(false); const [serverErr, setServerErr] = useState(null);
    const set = (key) => (v) => { setServerErr(null); setF((x) => ({ ...x, [key]: v })); };
    const email = f.email.trim().toLowerCase();
    const errs = {};
    if (!f.name.trim()) errs.name = 'Skriv personens namn.';
    if (!email) errs.email = 'Skriv e-postadressen.';
    else if (!MM.valid.email(email)) errs.email = 'E-postadressen ser inte ut att stämma. Kontrollera stavningen.';
    else if (!domains.includes(email.split('@')[1])) errs.email = `Adressen måste sluta på @${domains.join(' eller @')}. Andra domäner kan inte bjudas in till det här avtalet.`;
    else if (st.customerUsers.some((u) => String(u.email).toLowerCase() === email)) errs.email = 'Det finns redan en användare med den adressen.';
    if (!f.unit) errs.unit = 'Välj enhet.';
    const br = st.buyerReferences.find((b) => b.unit === f.unit && b.active);
    const show = (key) => (tried ? errs[key] : null);
    const submit = () => {
      setTried(true); if (Object.keys(errs).length) return;
      const r = MM.dispatch('admin.inviteCustomer', { name: f.name, email, role: f.role, unit: f.unit });
      if (r && r.error) { setServerErr(r.error === 'exists' ? 'Det finns redan en användare med den adressen.' : r.error === 'domain' ? 'Adressen har inte en tillåten domän.' : 'Inbjudan kunde inte skickas. Kontrollera fälten.'); return; }
      MM.toast(`Inbjudan skickad till ${email}.`, 'blue'); onClose();
    };
    return html`<${ui.Modal} title="Bjud in kommunanvändare" onClose=${onClose} footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="send" onClick=${submit}>Skicka inbjudan<//>`}>
      <p class="muted">Kommunanvändare kan inte registrera sig själva. De loggar in med sin e-postadress och en sexsiffrig engångskod.</p>
      ${serverErr && html`<${ui.Notice} tone="critical">${serverErr}<//>`}
      <div class="form-grid">
        <${ui.Field} id="inv-name" label="Namn" required help="För- och efternamn." error=${show('name')}><${ui.Input} id="inv-name" value=${f.name} onInput=${set('name')} invalid=${!!show('name')} autoComplete="off" /><//>
        <${ui.Field} id="inv-email" label="E-postadress" required help=${`Bara adresser som slutar på @${domains.join(' eller @')}.`} error=${show('email')}><${ui.Input} id="inv-email" type="email" value=${f.email} onInput=${set('email')} invalid=${!!show('email')} /><//>
        <${ui.Field} id="inv-role" label="Roll" required help="Handläggare beställer och läser rapporter för sina deltagare. Chef ser beställarrapporten och enhetens ärenden.">
          <${ui.Select} id="inv-role" value=${f.role} onChange=${set('role')} options=${[{ value: 'handlaggare', label: 'Handläggare' }, { value: 'chef', label: 'Chef' }]} /><//>
        <${ui.Field} id="inv-unit" label="Enhet" required help=${br ? `Beställarreferens som föreslås: ${br.reference}.` : 'Enheten styr vilken beställarreferens som föreslås vid beställning.'} error=${show('unit')}>
          <${ui.Select} id="inv-unit" value=${f.unit} onChange=${set('unit')} placeholder="Välj enhet" invalid=${!!show('unit')} options=${units.map((u) => ({ value: u, label: u }))} /><//>
      </div>
      <div class="demo-note"><${I} name="mail" /><div><b>Mejlet till den inbjudna (inga personuppgifter):</b> ${INVITE_TEXT}</div></div>
    <//>`;
  };

  const UsersView = ({ role }) => {
    const st = MM.useStore(); const isAdmin = role === 'admin';
    const [tab, setTab] = useState(isAdmin ? 'mb' : 'kommun');
    const [inviting, setInviting] = useState(false);
    const k = MM.contract('c-bot');
    const mb = st.users.slice().sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'sv'));
    const ku = st.customerUsers.slice().sort((a, b) => Number(!a.invitedAt) - Number(!b.invitedAt) || a.name.localeCompare(b.name, 'sv'));
    const loggedIn30 = ku.filter((u) => u.lastLoginAt && d.diffDays(u.lastLoginAt, d.today()) <= 30).length;
    const invited = ku.filter((u) => u.invitedAt && !u.lastLoginAt && u.active).length;
    const brOf = (u) => st.buyerReferences.find((b) => b.id === u.buyerReferenceId);
    const tabs = [isAdmin && { id: 'mb', label: 'Miljonbemanning', count: mb.length, icon: 'briefcase' }, { id: 'kommun', label: 'Botkyrka kommun', count: ku.length, icon: 'building' }, { id: 'matris', label: 'Behörigheter', icon: 'shield' }].filter(Boolean);
    const statusOf = (u) => (!u.active ? html`<${ui.Badge} tone="red" icon="lock">Spärrad<//>` : u.invitedAt && !u.lastLoginAt ? html`<${ui.Badge} tone="outline" icon="mail">Inbjuden ${d.fmtDateShort(u.invitedAt)}<//>` : html`<${ui.Badge} tone="blue" icon="check">Aktiv<//>`);
    return html`<${ui.Page} title=${isAdmin ? 'Användare och roller' : 'Kommunanvändare'} eyebrow=${isAdmin ? 'Systemadmin' : 'Avtalsansvarig · Botkyrka kommun'}
      lead="Bara inbjudna konton – ingen självregistrering. Miljonbemanning loggar in med Microsoft Entra ID, kommunen med e-post och engångskod."
      actions=${html`<${ui.Btn} kind="primary" icon="plus" onClick=${() => { setTab('kommun'); setInviting(true); }}>Bjud in kommunanvändare<//>`}>
      <div class="grid-4">
        <${ui.Kpi} label="Miljonbemanning" value=${mb.filter((u) => u.active).length} sub="aktiva konton · Microsoft Entra ID" />
        <${ui.Kpi} label="Botkyrka kommun" value=${ku.filter((u) => u.active).length} sub=${`aktiva konton i ${MM.uniq(ku.map((u) => u.unit)).length} enheter`} />
        <${ui.Kpi} label="Inloggade senaste 30 dagarna" value=${loggedIn30} sub=${`av ${ku.length} kommunanvändare – mejlbeställning kräver ingen inloggning`} />
        <${ui.Kpi} label="Väntande inbjudningar" value=${invited} sub="har inte loggat in ännu" />
      </div>
      <${ui.Tabs} ariaLabel="Användare" active=${tab} onChange=${setTab} tabs=${tabs} />
      ${tab === 'mb' && isAdmin && html`<${ui.Card} title="Personal på Miljonbemanning" icon="briefcase" flush actions=${html`<${ui.Badge} tone="outline" icon="key">Microsoft Entra ID · MFA via M365<//>`}
          foot=${html`<span class="small muted">Rollen gäller per avtal (tabellen memberships). En person kan ha olika roller i Botkyrka- och KK-avtalet. Lösenord och MFA hanteras av Microsoft – Miljonmatch lagrar inga lösenord.</span>`}>
        <${ui.Table} caption="Användare på Miljonbemanning" rows=${mb} columns=${[
          { key: 'name', label: 'Namn', render: (u) => html`<span class="row-sm" style="flex-wrap:nowrap;align-items:flex-start"><${ui.Avatar} name=${u.name} size="sm" /><span><span class="strong">${u.name}</span><div class="cell-sub">${u.email}</div></span></span>` },
          { key: 'title', label: 'Titel', render: (u) => u.title },
          { key: 'bot', label: 'Roll i Botkyrka-avtalet', render: (u) => html`<${ui.Badge} tone=${u.role === 'admin' ? 'dark' : 'bluetone'}>${MM.roleDef(u.role).label}<//>${u.teamRole && html`<div class="cell-sub">${sel.teamLabel(u.teamRole)}</div>`}` },
          { key: 'kk', label: 'Roll i KK-avtalet', render: () => html`<span class="muted">Tilldelas före start</span>` },
          { key: 'st', label: 'Status', render: (u) => (u.active ? html`<${ui.Badge} tone="blue" icon="check">Aktiv<//>` : html`<${ui.Badge} tone="red" icon="lock">Spärrad<//>`) },
        ]} />
      <//>`}
      ${tab === 'kommun' && html`<${ui.Card} title="Kommunens användare" icon="building" flush
          actions=${html`<span class="small muted">Tillåtna domäner:</span>${(k.emailDomains || []).map((x) => html`<${ui.Badge} tone="outline" key=${x}>@${x}<//>`)}`}
          foot=${html`<div class="stack-sm" style="width:100%"><span class="small muted">Engångskoden gäller i 10 minuter och man har högst 5 försök. Ingen magisk länk – e-postskydd som Safe Links förbrukar sådana länkar i förväg. Mejlbeställning via avrop@ fungerar även för den som aldrig loggar in.</span>
            <div><${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.login" label="Se kundens inloggning" /></div></div>`}>
        <${ui.Table} caption="Kommunens användare" rows=${ku} rowClass=${(u) => (!u.active ? 'row-muted' : '')} columns=${[
          { key: 'name', label: 'Namn', render: (u) => html`<span class="strong">${u.name}</span><div class="cell-sub">${u.email}</div>` },
          { key: 'unit', label: 'Roll och enhet', render: (u) => html`<span class="strong">${u.role === 'chef' ? 'Chef' : 'Handläggare'}</span><div>${u.unit}</div>${brOf(u) && html`<div class="cell-sub">Beställarreferens ${brOf(u).reference}</div>`}` },
          { key: 'login', label: 'Senaste inloggning', nowrap: true, render: (u) => (u.lastLoginAt ? d.fmtDateTime(u.lastLoginAt) : html`<span class="muted">Har inte loggat in</span>`) },
          { key: 'st', label: 'Status', render: statusOf },
          { key: 'act', label: 'Åtgärd', render: (u) => html`<${ui.Btn} kind="ghost" icon=${u.active ? 'lock' : 'refresh'} onClick=${() => { MM.dispatch('admin.setCustomerActive', { userId: u.id, active: !u.active }); MM.toast(u.active ? `${u.name} är spärrad och kan inte logga in.` : `${u.name} kan logga in igen.`, 'blue'); }}>${u.active ? 'Spärra' : 'Aktivera'}<//>` },
        ]} />
      <//>`}
      ${tab === 'matris' && html`<div class="stack-lg">
        <${ui.Card} title="Behörighetsmatris" icon="shield" flush foot=${html`<span class="small muted">Behörighet = avtal + roll + tilldelning. Den upprätthålls i databasen med radnivåsäkerhet (RLS), inte bara i gränssnittet. Byt roll i prototypfältet för att testa.</span>`}>
          <${Matrix} />
        <//>
        <${ui.Card} title="Roller enligt kravspecifikationen (§4)" icon="users" flush>
          <${ui.Table} caption="Roller och behörigheter" rows=${ROLE_TABLE.map((r) => ({ id: r[0], role: r[0], org: r[1], sees: r[2], does: r[3], login: r[4] }))} columns=${[
            { key: 'role', label: 'Roll', render: (r) => html`<span class="strong">${r.role}</span><div class="cell-sub">${r.org}</div>` },
            { key: 'sees', label: 'Ser' }, { key: 'does', label: 'Gör' }, { key: 'login', label: 'Inloggning' },
          ]} />
        <//>
      </div>`}
      ${inviting && html`<${InviteModal} onClose=${() => setInviting(false)} />`}
    <//>`;
  };
  // Nyckel per roll: skalet återanvänder komponenten när bara rollen byts, men flikar och formulär beror på rollen.
  MM.registerView('admin.anvandare', { title: 'Användare och roller', roles: ['admin', 'avtalsansvarig'], component: ({ params, role }) => html`<${UsersView} key=${role} params=${params} role=${role} />` });

  // ============================================================ admin.integrationer – Underbiträden och integrationer
  const SUBPROCESSORS = [
    { id: 'supabase', name: 'Supabase', what: 'Databas, inloggning och fillagring', where: 'Stockholm (eu-north-1)', status: 'approved', us: true },
    { id: 'vercel', name: 'Vercel', what: 'Applikation och serverfunktioner', where: 'Funktioner i Stockholm (arn1)', status: 'approved', us: true },
    { id: 'ai', name: 'AI-leverantör (en av två)', what: 'Transkribering och textutkast', where: 'Berget AI: Sverige · Google: EU multi-region', status: 'approved_test', us: false },
    { id: 'sms', name: 'SMS-leverantör', what: 'Påminnelser och pulslänkar', where: 'Väljs – helst svensk', status: 'not_chosen', us: false },
    { id: 'epost', name: 'E-postleverantör', what: 'Notiser och inloggningskoder', where: 'Väljs – helst inom EU', status: 'not_chosen', us: false },
    { id: 'microsoft', name: 'Microsoft', what: 'Inloggning (Entra ID) och avrop@-brevlådan (Graph)', where: 'Befintligt Microsoft 365', status: 'approved', us: true },
  ];
  const SubStatus = ({ s }) => (s === 'approved' ? html`<${ui.Badge} tone="blue" icon="check">Godkänd<//><div class="cell-sub">${d.fmtDate(APPROVED_ON)}</div>`
    : s === 'approved_test' ? html`<${ui.Badge} tone="bluetone" icon="check">Godkänd – väljs genom test<//>` : html`<${ui.Badge} tone="outline" icon="alert-circle">Ej vald – fråga 18<//>`);
  const IntStatus = ({ s }) => ({ active: html`<${ui.Badge} tone="blue" icon="check-circle">Aktiv<//>`, test: html`<${ui.Badge} tone="bluetone" icon="sparkles">Test<//>`, off: html`<${ui.Badge} tone="grey" icon="minus-circle">Ej ansluten<//>`, notchosen: html`<${ui.Badge} tone="outline" icon="alert-circle">Ej vald<//>` })[s];
  const JobStatus = ({ s }) => ({ ok: html`<${ui.Badge} tone="blue" icon="check">Klar<//>`, waiting: html`<${ui.Badge} tone="grey" icon="clock">Väntar<//>`, disabled: html`<${ui.Badge} tone="outline" icon="minus-circle">Inte aktiverad<//>`, failed: html`<${ui.Badge} tone="red" icon="alert">Fel<//>` })[s];

  const jobRows = (st) => {
    const today = d.today(); const runs = st.adminJobRuns || {};
    const lastWeek = d.isoWeek(d.addDays(d.monday(today), -7)).key;
    const weekly = st.reports.filter((r) => r.kind === 'weekly_attendance' && r.week === lastWeek);
    const waiting = weekly.filter((r) => r.status === 'waiting');
    const lastMon = d.addDays(d.monday(today), -7);
    const coachesMissing = sel.coaches().filter((c) => sel.unregistered(c.id, lastMon, d.addDays(lastMon, 6)).length > 0).length;
    const watch = sel.progressionWatch();
    const audioDel = st.auditLog.filter((a) => a.action === 'audio.deleted');
    const lastAudio = audioDel.map((a) => a.occurredAt).sort().slice(-1)[0] || null;
    const pendingTranscripts = st.checkIns.filter((c) => c.ai && !c.ai.rawTranscriptDeletedAt && c.status !== 'approved');
    const latestMail = st.inboundEmails.map((e) => e.receivedAt).sort().slice(-1)[0];
    const rr = sel.resultRate({ window: 'rolling_6m' });
    const retentionUnset = MM.isUnset(MM.cfg().retention);
    const J = (key, name, schedule, last, status, result, extra = {}) => ({ id: key, key, name, schedule, last: runs[key] ? runs[key].at : last, manual: !!runs[key], status, result, ...extra });
    return [
      J('inbox', 'Läs avrop@-inkorgen', 'Var 2–5 minut', `${today}T09:10`, 'ok', latestMail ? `Senaste mejl kom ${d.fmtDateTime(latestMail)}` : 'Inga mejl'),
      J('weekly', 'Publicera veckorapporter', `Måndag, när närvaron är komplett${slaTime('veckorapport_publicering') ? ` – senast ${slaTime('veckorapport_publicering')} enligt avtalet` : ''}`, `${today}T07:00`, waiting.length ? 'waiting' : 'ok', `${weekly.length - waiting.length} publicerade, ${waiting.length} väntar på närvaro (${d.fmtWeekKey(lastWeek)})`),
      J('att_remind', 'Påminnelser om närvaroregistrering', 'Fredag 14.00 och måndag 08.00', `${today}T08:00`, 'ok', `${plural(coachesMissing, 'coach', 'coacher')} påmind${coachesMissing === 1 ? '' : 'a'} om förra veckan`),
      J('progress', 'Progressionspåminnelser', 'Måndag 08.00', `${today}T08:00`, 'ok', `${watch.length} påminnelser till coacher, ${watch.filter((w) => w.level === 'escalated').length} eskaleringar till chef`),
      J('audio', 'Radera ljud efter transkribering', 'Direkt efter lyckad transkribering – senast efter 24 timmar vid fel', lastAudio, 'ok', `${plural(audioDel.length, 'ljudfil', 'ljudfiler')} raderade`, { phase: 2 }),
      J('transcripts', 'Radera råtranskript', 'Dagligen 02.00 – när avstämningen godkänts, senast efter 30 dagar', `${today}T02:00`, 'ok', pendingTranscripts.length ? `${plural(pendingTranscripts.length, 'råtranskript', 'råtranskript')} väntar på granskning` : 'Inga råtranskript kvar', { phase: 2 }),
      J('kpi', 'Beräkna nyckeltal', 'Dagligen 06.00', `${today}T06:00`, 'ok', `Resultatgrad ${fmt.pct(rr.value)} (rullande 6 månader, ${rr.num} av ${rr.den})`),
      J('retention', 'Gallring enligt PUB-avtalet', 'Dagligen 03.00', null, retentionUnset ? 'disabled' : 'ok', retentionUnset ? 'Regeln är inte fastställd (fråga 11) – jobbet raderar ingenting' : 'Enligt avtalet', { disabled: retentionUnset }),
    ];
  };

  const IntegrationsView = () => {
    const st = MM.useStore(); const today = d.today(); const cfg = MM.cfg();
    const jobs = jobRows(st);
    const latestMail = st.inboundEmails.map((e) => e.receivedAt).sort().slice(-1)[0];
    const INT = [
      { id: 'graph', name: 'avrop@-brevlådan', sub: 'Microsoft Graph', icon: 'inbox', status: 'active', items: [['Läses', 'Var 2–5 minut'], ['Senast läst', `I dag kl. ${d.fmtTime(`${today}T09:10`)}`], ['Senaste mejl', latestMail ? d.fmtDateTime(latestMail) : '–'], ['Svar skickas', 'Från avrop@ i samma tråd, så att kommunen ser hela konversationen']] },
      { id: 'entra', name: 'Microsoft Entra ID', sub: 'Inloggning för Miljonbemanning', icon: 'key', status: 'active', items: [['MFA', 'Styrs av Microsoft 365'], ['Konton', 'Bara inbjudna – ingen självregistrering']] },
      { id: 'fortnox', name: 'Fortnox', sub: 'Fakturor som Peppol BIS Billing 3', icon: 'card', status: 'off', phase: 2, items: [['Reserv i dag', 'Export till Excel och PDF, eller Botkyrkas fakturaportal'], ['Öppen fråga', 'Fråga 15: ingår Fortnox Integration och e-faktura i Miljonbemannings paket?'], ['Krav', 'Omkörning får inte skapa dubbletter. Status synkas tillbaka.']] },
      { id: 'sms', name: 'SMS-leverantör', sub: 'Påminnelser och pulslänkar', icon: 'message', status: 'notchosen', items: [['Öppen fråga', 'Fråga 18: val av SMS- och e-postleverantör'], ['Önskemål', 'Svensk leverantör med API'], ['Innehåll', 'Bara tid, plats och telefonnummer – aldrig personuppgifter']] },
      { id: 'email', name: 'E-postleverantör', sub: 'Notiser och inloggningskoder', icon: 'mail', status: 'notchosen', items: [['Krav', 'EU-baserad, med SMTP för inloggningskoder, SPF, DKIM och DMARC'], ['SPF', 'En domän får bara ha en SPF-post – leverantörens include läggs i den befintliga posten för Microsoft 365'], ['Alternativ', 'Graph sendMail från en egen brevlåda i Microsoft 365']] },
      { id: 'ai', name: 'AI-leverantör', sub: 'Transkribering och textutkast', icon: 'sparkles', status: 'test', phase: 2, items: [['I test', 'Berget AI (Sverige)'], ['Alternativ', 'Gemini via Vertex AI med EU-endpoint'], ['Aldrig', 'AI Studio-nyckel eller global endpoint'], ['Anrop', `Bara via adaptern lib/ai/ – ${plural(st.aiRuns.length, 'körning', 'körningar')} i prototypen`]] },
    ];
    const active = INT.filter((x) => x.status === 'active').length;
    return html`<${ui.Page} title="Underbiträden och integrationer" eyebrow="Systemadmin"
      lead="Var personuppgifterna behandlas, vilka tjänster Miljonmatch är kopplad till och hur bakgrundsjobben går. All data ligger i Stockholm.">
      <div class="grid-4">
        <${ui.Kpi} label="Underbiträden" value=${SUBPROCESSORS.length} sub=${`${SUBPROCESSORS.filter((s) => s.status !== 'not_chosen').length} godkända, ${SUBPROCESSORS.filter((s) => s.status === 'not_chosen').length} ej valda`} />
        <${ui.Kpi} label="Integrationer" value=${`${active} av ${INT.length}`} sub="aktiva" />
        <${ui.Kpi} label="Bakgrundsjobb" value=${jobs.length} sub=${`${jobs.filter((j) => j.status === 'failed').length} fel senaste dygnet`} />
        <${ui.Kpi} label="Data lagras i" value="Stockholm" sub="Supabase eu-north-1 · Vercel arn1" />
      </div>

      <${ui.Notice} tone="warn" title=${`Botkyrka godkände underbiträdena ${d.fmtDate(APPROVED_ON)}`}>
        Beskedet ska in skriftligt i PUB-avtalets bilaga (förteckning över underbiträden), tillsammans med ett uttryckligt godkännande av eventuell åtkomst från tredje land – till exempel leverantörernas support. Det är ett förberedande steg (fas 0) som inte är klart ännu.<//>

      <${ui.Card} title="Underbiträden" icon="shield" flush foot=${html`<span class="small muted">Listan hålls kort. Ett nytt verktyg som behandlar personuppgifter – till exempel felrapportering – läggs till här och godkänns av kommunen först.</span>`}>
        <${ui.Table} caption="Underbiträden" rows=${SUBPROCESSORS} columns=${[
          { key: 'name', label: 'Leverantör', render: (s) => html`<span class="strong">${s.name}</span>` },
          { key: 'what', label: 'Behandling' },
          { key: 'where', label: 'Plats', render: (s) => html`${s.where}${s.us && html`<div class="cell-sub">Amerikanskt bolag – åtkomst från tredje land ska godkännas skriftligt</div>`}` },
          { key: 'status', label: 'Status', render: (s) => html`<${SubStatus} s=${s.status} />` },
        ]} />
      <//>

      <div class="split">
        <${ui.Card} title="Regionlåsning" icon="map-pin">
          <ul class="stack-sm" style="margin:0;padding:0;list-style:none">
            ${[['Supabase-projekten (produktion och staging) ligger i eu-north-1, Stockholm.'], ['Vercel-funktioner körs i arn1, Stockholm. vercel.json innehåller "regions": ["arn1"] – standardregionen iad1 (USA) används inte.'],
              ['Persondata behandlas bara i serverfunktionerna i arn1 – inte i Supabase Edge Functions, som körs närmast anroparen.'], ['Inga Vercel-specifika lagringstjänster (Blob, Edge Config) för persondata. Appen kan flyttas till annan drift.'],
              [cfg.thirdCountryProcessing === 'forbidden_without_written_approval' ? 'Behandling utanför EU/EES är förbjuden utan kommunens skriftliga förhandsgodkännande (avtalskonfigurationen).' : 'Behandling utanför EU/EES enligt avtalet.']].map(([t], i) => html`<li key=${i} class="row-sm" style="flex-wrap:nowrap;align-items:flex-start"><${I} name="check-circle" /><span>${t}</span></li>`)}
          </ul>
        <//>
        <${ui.Card} title="Så ser kommunen det" icon="building">
          <div class="stack-sm">
            <p>Underbiträdesförteckningen och instruktionerna ingår i PUB-avtalet med Botkyrka. Kommunen är personuppgiftsansvarig och Miljonbemanning är personuppgiftsbiträde.</p>
            <p class="small muted">Vid avtalsslut lämnas data tillbaka inom ${cfg.termination.returnDataWithinDays} dagar och raderas sedan. Incidenter rapporteras till kommunen enligt PUB-avtalet.</p>
          </div>
        <//>
      </div>

      <${ui.Section} title="Integrationer">
        <${Masonry} items=${INT.map((x) => html`<${ui.Card} title=${x.name} icon=${x.icon} actions=${html`${x.phase && html`<${ui.BuildPhase} fas=${x.phase} />`}<${IntStatus} s=${x.status} />`}>
          <div class="stack-sm"><p class="muted">${x.sub}</p><${KV} items=${x.items} /></div><//>`)} />
      <//>

      <${ui.Card} title="Bakgrundsjobb (tabellen jobs)" icon="refresh" flush
        foot=${html`<span class="small muted">En skyddad route körs av cron varje minut. Jobben hämtas med FOR UPDATE SKIP LOCKED, är idempotenta, har ett begränsat antal försök och sparar felorsaken.</span>`}>
        <${ui.Table} caption="Bakgrundsjobb" rows=${jobs} columns=${[
          { key: 'name', label: 'Jobb och schema', render: (j) => html`<span class="strong">${j.name}</span><div class="cell-sub">${j.schedule}</div>${j.phase && html`<div style="margin-top:4px"><${ui.BuildPhase} fas=${j.phase} /></div>`}` },
          { key: 'last', label: 'Senaste körning', nowrap: true, render: (j) => (j.last ? html`${d.fmtDateTime(j.last)}${j.manual && html`<div class="cell-sub">Manuellt av dig</div>`}` : '–') },
          { key: 'status', label: 'Status', render: (j) => html`<${JobStatus} s=${j.status} />` },
          { key: 'result', label: 'Resultat', render: (j) => html`<span style="font-size:.875rem">${j.result}</span>` },
          { key: 'run', label: 'Kör', render: (j) => html`<${ui.Btn} kind="ghost" icon="play" disabled=${!!j.disabled} title=${`Kör ${j.name.toLowerCase()} nu`} onClick=${() => { MM.dispatch('admin.runJob', { key: j.key }); MM.toast(`${j.name} kördes (simulerat).`, 'blue'); }}>Kör nu<//>` },
        ]} />
      <//>
      <${ui.DemoNote}>Integrationerna och jobben är simulerade. "Kör nu" loggas i revisionsloggen men läser inga riktiga mejl och raderar ingenting.<//>
    <//>`;
  };
  MM.registerView('admin.integrationer', { title: 'Underbiträden och integrationer', roles: ['admin'], component: IntegrationsView });

  // ============================================================ admin.mallar – Mallar och utskick
  const CH = { sms: ['message', 'SMS'], email: ['mail', 'E-post'], brev: ['file', 'Brev'], letter: ['file', 'Brev'] };
  const ChannelBadge = ({ ch }) => { const [icon, label] = CH[ch] || ['mail', ch]; return html`<${ui.Badge} tone="outline" icon=${icon}>${label}<//>`; };
  const ChannelBadges = ({ t }) => html`${[t.channel, ...(t.alsoVia || [])].map((c) => html`<${ChannelBadge} key=${c} ch=${c} />`)}`;
  const CheckBadge = ({ c }) => (c.ok ? html`<${ui.Badge} tone="outline" icon="check">Inga personuppgifter<//>` : html`<${ui.Badge} tone="red" icon="alert">Innehåller personuppgifter<//>`);

  const TemplateEditor = ({ tpl }) => {
    const st = MM.useStore();
    const [subject, setSubject] = useState(tpl.subject || ''); const [body, setBody] = useState(tpl.body);
    const chk = tplCheck(`${subject}\n${body}`);
    const dirty = subject !== (tpl.subject || '') || body !== tpl.body;
    const hist = ((st.adminTemplates || {})[tpl.key] || []).slice().reverse();
    const when = typeof tpl.when === 'function' ? tpl.when() : tpl.when;
    const toCustomer = /Kommunens|Ny kommunanvändare|Avsändaren/.test(tpl.to);
    const save = () => {
      const r = MM.dispatch('admin.saveTemplate', { key: tpl.key, subject: tpl.channel === 'email' ? subject : '', body });
      if (r && r.error === 'personal_data') { MM.toast('Mallen sparades inte: den innehåller personuppgifter.', 'red'); return; }
      if (r && r.error) { MM.toast('Mallen kunde inte sparas. Texten får inte vara tom.', 'red'); return; }
      MM.toast(`${tpl.name} är sparad som version ${r.version}.`, 'blue');
    };
    const variants = tpl.variantOf ? TEMPLATES.filter((t) => t.variantOf === tpl.variantOf && t.key !== tpl.key) : [];
    return html`<${ui.Card} title=${tpl.name} icon=${tpl.channel === 'sms' ? 'message' : 'mail'} actions=${html`<${ChannelBadges} t=${tpl} /><${ui.Badge} tone="dark">Version ${tpl.version}<//>`}
      foot=${html`<${ui.Btn} kind="primary" icon="check" disabled=${!dirty || !chk.ok || !body.trim()} onClick=${save}>Spara som version ${tpl.version + 1}<//>
        ${dirty && html`<${ui.Btn} kind="ghost" icon="reset" onClick=${() => { setSubject(tpl.subject || ''); setBody(tpl.body); }}>Ångra ändringarna<//>`}`}>
      <div class="stack">
        <${KV} items=${[['Avsändare', tpl.from], ['Mottagare', tpl.to], ['Skickas', when], tpl.alsoVia && ['Kanal', `${listSv([tpl.channel, ...tpl.alsoVia].map((c) => (CH[c] || [0, c])[1]))} – den kontaktväg deltagaren har valt`], ['Senast ändrad', `${d.fmtDate(tpl.updatedAt)} av ${MM.personName(tpl.updatedBy)}`]]} />
        ${variants.length > 0 && html`<${ui.Notice} tone="info" title="Två varianter skickas i dag">
          <div class="stack-sm"><p>Texten här är exakt den som skickas ${tpl.key === GENERIC_PORTAL ? 'när en beställning i portalen gäller skyddade personuppgifter' : 'när ett mejl till avrop@ gäller skyddade personuppgifter eller inte kan tolkas'}. Den andra varianten:</p>
            ${variants.map((v) => { const cv = currentTpl(st, v.key); return html`<div key=${v.key} style="border-left:3px solid var(--line-strong);padding:4px 0 4px 10px"><div class="strong">${v.name}</div><div>${cv.body}</div></div>`; })}
            <p class="small muted">Varianterna lovar olika saker: efter ett mejl ringer vi upp handläggaren, efter en portalbeställning ber vi handläggaren ringa oss. Bestäm vilken formulering som ska gälla innan tjänsten byggs.</p></div><//>`}
        ${tpl.channel === 'email' && html`<${ui.Field} id="tpl-subject" label="Ämnesrad" help="Visas i mottagarens inkorg. Bara ärendenummer – aldrig namn."><${ui.Input} id="tpl-subject" value=${subject} onInput=${setSubject} invalid=${!chk.ok} /><//>`}
        <${ui.Field} id="tpl-body" label="Text" help=${html`Tillåtna platshållare: ${ALLOWED_PH.map((p) => `{${p}}`).join(', ')}.${tpl.channel === 'sms' ? html` <b>${body.length} tecken</b> – ett SMS rymmer 160.` : ''}`}>
          <${ui.TextArea} id="tpl-body" rows=${tpl.channel === 'sms' ? 4 : 7} value=${body} onInput=${setBody} invalid=${!chk.ok} /><//>
        ${chk.ok ? html`<${ui.Notice} tone="ok" title="Innehåller inga personuppgifter">Texten innehåller inga platshållare för namn, personnummer eller adress. Utskicket får bara innehålla ärendenummer och länk till portalen.<//>`
          : html`<${ui.Notice} tone="critical" title="Innehåller personuppgifter – kan inte sparas">${chk.pii.length > 0 ? html`Ta bort ${chk.pii.join(', ')}. ` : ''}${chk.pnr ? 'Texten innehåller något som liknar ett personnummer. ' : ''}E-post och SMS får aldrig innehålla personuppgifter – bara ärendenummer och en uppmaning att logga in.<//>`}
        ${chk.unknown.length > 0 && html`<${ui.Notice} tone="warn" title="Okänd platshållare">${chk.unknown.join(', ')} fylls inte i automatiskt. Använd bara de tillåtna platshållarna.<//>`}
        <div class="stack-sm">
          <div class="label-caps">Förhandsvisning med exempelvärden</div>
          <div style="border:1.5px solid var(--line);border-radius:var(--radius);padding:12px 14px;background:var(--surface-sub)">
            ${tpl.channel === 'email' && html`<div class="strong" style="margin-bottom:6px">${fillExample(subject)}</div>`}
            <div style="white-space:pre-wrap;overflow-wrap:anywhere">${fillExample(body)}</div>
          </div>
        </div>
        ${toCustomer && html`<div><${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.rapporter" label="Se vad kommunen får i portalen" /></div>`}
        ${hist.length > 0 && html`<div class="stack-sm"><div class="label-caps">Tidigare versioner</div>
          <ul class="stack-sm" style="margin:0;padding-left:20px;gap:2px">${hist.map((h) => html`<li key=${h.version} class="small">Version ${h.version} · ${d.fmtDateTime(h.savedAt)} · ${MM.personName(h.savedBy)}</li>`)}<li class="small muted">Version ${TEMPLATES.find((t) => t.key === tpl.key).version} · ${d.fmtDate(TEMPLATES.find((t) => t.key === tpl.key).updatedAt)} · ursprunglig</li></ul></div>`}
      </div>
    <//>`;
  };

  const TemplatesTab = () => {
    const st = MM.useStore();
    const [selKey, setSelKey] = useState(TEMPLATES[0].key);
    const list = TEMPLATES.map((t) => currentTpl(st, t.key));
    const failing = list.filter((t) => !tplCheck(`${t.subject || ''}\n${t.body}`).ok);
    const cur = list.find((t) => t.key === selKey);
    return html`<div class="stack">
      ${failing.length === 0 ? html`<${ui.Notice} tone="ok" title=${`Alla ${list.length} mallar klarar kontrollen`}>Inga mallar innehåller platshållare för namn, personnummer eller adress. Mallarna redigeras här och varje ändring blir en ny version.<//>`
        : html`<${ui.Notice} tone="critical" title="Mallar med personuppgifter">${failing.map((t) => t.name).join(', ')}<//>`}
      <div class="split">
        <${ui.Card} title="Mallar" icon="list" flush>
          <div class="list">${list.map((t) => { const c = tplCheck(`${t.subject || ''}\n${t.body}`); const on = t.key === selKey;
            return html`<button type="button" key=${t.key} class="list-item clickable" aria-current=${on ? 'true' : undefined} onClick=${() => { setSelKey(t.key); setTimeout(() => { const el = document.getElementById('tpl-editor'); if (el) { const r = el.getBoundingClientRect(); if (r.top < 100 || r.top > window.innerHeight - 120) el.scrollIntoView({ block: 'start' }); } }, 30); }}
                style=${on ? 'background:var(--bla-ton);box-shadow:inset 4px 0 0 var(--rod)' : ''}>
              <${I} name=${t.channel === 'sms' ? 'message' : 'mail'} />
              <span class="li-main"><span class="li-title">${t.name}</span><span class="li-sub">${t.to}</span>
                <span class="row-sm"><${ChannelBadges} t=${t} /><${ui.Badge} tone="grey">v${t.version}<//><${CheckBadge} c=${c} /></span></span>
              <${I} name="chevron-right" />
            </button>`; })}</div>
        <//>
        <div id="tpl-editor" style="scroll-margin-top:140px;min-width:0"><${TemplateEditor} tpl=${cur} key=${`${cur.key}:${cur.version}`} /></div>
      </div>
      <${ui.DemoNote}>I prototypen påverkar en ny mallversion bara den här vyn – utskicken i demot använder de ursprungliga texterna. I den riktiga tjänsten skickas all e-post och alla SMS via en gemensam modul som alltid läser senaste versionen.<//>
    </div>`;
  };

  const SendLogTab = () => {
    const st = MM.useStore();
    const [ch, setCh] = useState('alla'); const [mine, setMine] = useState(false);
    const names = useMemo(() => st.persons.map((p) => `${p.firstName} ${p.lastName}`.toLowerCase()), [st.persons.length]);
    const leak = (body) => { const s = String(body || '').toLowerCase(); return PNR_RE.test(String(body || '')) || names.some((n) => s.includes(n)); };
    const all = st.notifications.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const leaks = all.filter((n) => leak(n.body));
    const list = all.filter((n) => (ch === 'alla' || n.channel === ch || (ch === 'brev' && n.channel === 'letter')) && (!mine || n.byTester));
    const letters = all.filter((n) => ['brev', 'letter'].includes(n.channel)).length;
    return html`<div class="stack">
      <div class="grid-4">
        <${ui.Kpi} label="Utskick" value=${all.length} sub=${letters > 0 ? `e-post, SMS och ${plural(letters, 'brev', 'brev')}` : 'e-post och SMS'} />
        <${ui.Kpi} label="E-post" value=${all.filter((n) => n.channel === 'email').length} />
        <${ui.Kpi} label="SMS" value=${all.filter((n) => n.channel === 'sms').length} />
        <${ui.Kpi} label="Orsakade av dig" value=${all.filter((n) => n.byTester).length} sub="i prototypen" />
      </div>
      ${leaks.length === 0 ? html`<${ui.Notice} tone="ok" title="Kontroll: inga utskick innehåller namn eller personnummer">Alla ${all.length} texter har kontrollerats mot deltagarregistret. De innehåller bara ärendenummer och en uppmaning att logga in i portalen.<//>`
        : html`<${ui.Notice} tone="critical" title=${`${leaks.length} utskick kan innehålla personuppgifter`}>Granska utskicken som är markerade nedan.<//>`}
      <div class="row-between">
        <${ui.Seg} ariaLabel="Kanal" value=${ch} onChange=${setCh} options=${[{ value: 'alla', label: 'Alla' }, { value: 'email', label: 'E-post', icon: 'mail' }, { value: 'sms', label: 'SMS', icon: 'message' }, ...(letters > 0 ? [{ value: 'brev', label: 'Brev', icon: 'file' }] : [])]} />
        <${ui.Check} id="log-mine" checked=${mine} onChange=${setMine}>Bara utskick du orsakat<//>
      </div>
      <${ui.Card} title=${`Utskickslogg (${list.length})`} icon="send" flush>
        ${list.length === 0 ? html`<${ui.Empty} icon="send" title="Inga utskick att visa">Ändra filtret, eller gör något i prototypen som skickar e-post eller SMS – till exempel acceptera ett avrop.<//>`
          : html`<div class="list">${list.map((n) => { const c = n.caseId ? sel.caseById(n.caseId) : null; const bad = leak(n.body);
            return html`<div class="list-item" key=${n.id} style=${n.byTester ? 'box-shadow:inset 4px 0 0 var(--bla)' : ''}>
              <${I} name=${(CH[n.channel] || ['mail'])[0]} size="lg" />
              <div class="li-main">
                <div class="row-sm"><span class="strong">${tplLabel(tplKeyOf(n))}</span><${ChannelBadge} ch=${n.channel} />${n.byTester && html`<${ui.Badge} tone="dark" icon="user">Orsakat av dig i prototypen<//>`}</div>
                <div class="li-sub">${d.fmtDateTime(n.at)} · Till ${n.to}${c ? ` · ärende ${c.number}` : ''}</div>
                <div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:8px 10px;border-left:3px solid var(--line);margin-top:4px">${n.body}</div>
                <div>${bad ? html`<${ui.Badge} tone="red" icon="alert">Kan innehålla personuppgifter<//>` : html`<${ui.Badge} tone="blue" icon="check">Inga personuppgifter<//>`}</div>
              </div>
            </div>`; })}</div>`}
      <//>
      <${ui.DemoNote}>SMS-mottagare visas maskerade. I den riktiga tjänsten loggas utskicket med mottagarens id, och texten byggs alltid från en mall utan personuppgifter.<//>
    </div>`;
  };

  const TemplatesView = ({ params }) => {
    MM.useStore();
    const [tab, setTab] = useState(params.tab === 'logg' ? 'logg' : 'mallar');
    return html`<${ui.Page} title="Mallar och utskick" eyebrow="E-post och SMS"
      lead="Alla utskick byggs från versionerade mallar. De innehåller aldrig personuppgifter – bara ärendenummer och en länk till portalen.">
      <${ui.Tabs} ariaLabel="Mallar och utskick" active=${tab} onChange=${setTab} tabs=${[{ id: 'mallar', label: 'Mallar', icon: 'file', count: TEMPLATES.length }, { id: 'logg', label: 'Utskickslogg', icon: 'send', count: MM.store.state.notifications.length }]} />
      ${tab === 'mallar' ? html`<${TemplatesTab} />` : html`<${SendLogTab} />`}
    <//>`;
  };
  MM.registerView('admin.mallar', { title: (p) => (p && p.tab === 'logg' ? 'Utskickslogg' : 'Mallar och utskick'), roles: ['admin', 'samordnare'], component: TemplatesView });

  // ============================================================ admin.logg – Revisionslogg
  const ACTION_LABEL = {
    'case.view': 'Visade deltagarkort', 'pnr.revealed': 'Visade personnummer', 'report.view': 'Visade rapport', 'transcript.view': 'Visade transkript',
    'case.created': 'Skapade ärende', 'case.accepted': 'Accepterade avrop', 'case.declined': 'Avböjde avrop', 'case.updated': 'Ändrade ärende',
    'case.buyer_reference_changed': 'Ändrade beställarreferens', 'case.first_meeting_booked': 'Bokade första möte', 'case.coach_changed': 'Bytte huvudcoach', 'case.closed': 'Avslutade ärende',
    'email.received': 'Tog emot mejl', 'email.handled': 'Hanterade mejl', 'email.linked': 'Kopplade mejl till ärende', 'email.supplement_applied': 'Förde in komplettering',
    'attendance.registered': 'Registrerade närvaro', 'report.published': 'Publicerade veckorapport', 'report.approved': 'Godkände rapport', 'report.delivered': 'Levererade rapport', 'report.corrected': 'Rättade rapport',
    'check_in.saved': 'Sparade avstämning', 'check_in.approved': 'Godkände avstämning', 'deviation.created': 'Skapade avvikelse', 'deviation.saved': 'Sparade avvikelse', 'deviation.customer_called': 'Kallade kommunen till uppföljning',
    'assessment.saved': 'Sparade månadsbedömning', 'assessment.approved': 'Godkände månadsbedömning', 'intake.saved': 'Sparade kartläggning', 'intake.approved': 'Godkände kartläggning',
    'event.added': 'Registrerade händelse', 'result.verified': 'Verifierade resultat', 'message.sent': 'Skickade meddelande', 'alert.acknowledged': 'Kvitterade flagga',
    'consent.given': 'Registrerade samtycke', 'consent.declined': 'Registrerade nej till samtycke', 'consent.revoked': 'Återkallade samtycke',
    'ai.run': 'AI-körning', 'audio.deleted': 'Raderade ljudfil', 'transcript.deleted': 'Raderade råtranskript',
    'billing.view': 'Visade fakturaunderlag', 'billing.zero_week_approved': 'Godkände vecka utan närvaro', 'billing.approved': 'Godkände fakturor', 'billing.fortnox_created': 'Skapade fakturor i Fortnox', 'billing.manual': 'Markerade manuellt fakturerad',
    'export.billing': 'Exporterade fakturaunderlag', 'export.audit_log': 'Exporterade revisionslogg', 'notify.email': 'Skickade e-post', 'kpi.computed': 'Beräknade nyckeltal',
    'org_rule.updated': 'Ändrade interna regler', 'customer_user.invited': 'Bjöd in kommunanvändare', 'customer_user.blocked': 'Spärrade kommunanvändare', 'customer_user.reactivated': 'Aktiverade kommunanvändare',
    'template.saved': 'Sparade ny mallversion', 'job.run_manual': 'Körde bakgrundsjobb manuellt', 'audit.log_check': 'Signerade loggkontroll',
    'pulse.submitted': 'Pulssvar inskickat', 'employer.added': 'Lade till arbetsgivare', 'placement.four_rights_updated': 'Ändrade de fyra rätten', 'placement.follow_up_added': 'Lade till uppföljningsdatum',
    'case.view_denied': 'Nekades att öppna deltagarkort', 'ai.blocked': 'AI stoppades', 'notify.suppressed': 'Stoppade utskick', 'email.registered_by_phone': 'Registrerade avrop per telefon', 'case.order_details_corrected': 'Rättade beställningsuppgifter',
    'billing.fortnox_run': 'Körde överföring till Fortnox', 'billing.fortnox_status_synced': 'Hämtade fakturastatus från Fortnox', 'billing.credited_and_reissued': 'Krediterade och fakturerade på nytt', 'billing.run_closed': 'Stängde fakturakörning',
    'task.created': 'Skapade uppgift', 'task.done': 'Markerade uppgift som klar', 'auth.login': 'Loggade in', 'contract_deviation.created': 'Registrerade avtalsavvikelse', 'contract_deviation.updated': 'Ändrade avtalsavvikelse',
    'contract_deviation.action_plan_approved': 'Godkände åtgärdsplan', 'contract_deviation.closed': 'Stängde avtalsavvikelse', 'report.quality_reviewed': 'Kvalitetsgranskade rapport', 'report.final_text_saved': 'Sparade slutrapportens text',
    'report.summary_saved': 'Sparade sammanfattning i rapport', 'report.correction_reason': 'Angav orsak till rättelse', view: 'Visade',
  };
  /** Okänd åtgärdskod blir läsbar text i stället för kod: "billing.new_thing" → "Billing: new thing". */
  const actionLabel = (code) => ACTION_LABEL[code] || cap(String(code || '').replace(/[._]/g, ' '));
  const ENTITY_LABEL = { customer_user: 'Kommunanvändare', contract_deviation: 'Avtalsavvikelse', task: 'Uppgift', case: 'Ärende', person: 'Person', report: 'Rapport', inbound_email: 'Mejl', ai_run: 'AI-körning', attendance: 'Närvaro', check_in: 'Avstämning', deviation: 'Avvikelse', monthly_assessment: 'Månadsbedömning', intake_assessment: 'Kartläggning', outcome_event: 'Händelse', alert: 'Flagga', consent: 'Samtycke', billing_run: 'Fakturakörning', contract: 'Avtal', org_config: 'Interna regler', profile: 'Användare', template: 'Mall', job: 'Bakgrundsjobb', audit_log: 'Revisionslogg', pulse_response: 'Pulssvar', employer: 'Arbetsgivare', placement: 'Praktikplats' };
  const DETAIL_KEY = { number: 'Ärendenummer', source: 'Kanal', parseMethod: 'Tolkning', template: 'Mall', to: 'Till', from: 'Från', kind: 'Typ', provider: 'Leverantör', reason: 'Orsak', status: 'Status', month: 'Månad', week: 'Vecka', count: 'Antal', format: 'Format', rows: 'Rader', role: 'Roll', unit: 'Enhet', domain: 'Domän', version: 'Version', language: 'Språk', contactRequested: 'Vill bli kontaktad', right: 'Rätt', value: 'Värde', date: 'Datum', areas: 'Områden', checked: 'Kontrollerade poster', deviations: 'Avvikelser', withinSla: 'Inom SLA', leadCoachId: 'Huvudcoach', firstMeetingAt: 'Första möte', fields: 'Fält', missing: 'Saknas', classification: 'Klassning', via: 'Via', kpi: 'Nyckeltal', window: 'Period', audioDeleted: 'Ljud raderat', automatic: 'Automatiskt', waiting: 'Väntar', endReason: 'Avslutsorsak', resultClass: 'Resultatklass', channel: 'Kanal', note: 'Anteckning', plan: 'Åtgärdsplan', filter: 'Filter', aiUsed: 'AI använd', fromCheckIn: 'Från avstämning', deviationId: 'Avvikelse', invoiceNo: 'Fakturanummer', idempotencyKey: 'Idempotensnyckel', idempotencyKeys: 'Idempotensnycklar', by: 'Av', previous: 'Tidigare version',
    at: 'Tidpunkt', created: 'Skapade', skippedAlreadyCreated: 'Redan skapade', skippedDuplicates: 'Dubbletter som hoppades över', blocked: 'Stoppade', notApproved: 'Inte godkända', changed: 'Ändrade',
    buyerReference: 'Beställarreferens', toRole: 'Till roll', caseIds: 'Ärenden', emailId: 'Mejl', method: 'Inloggning', hadCustomerApproval: 'Godkänd av kommunen', type: 'Typ', level: 'Nivå', step: 'Steg',
    sentToCustomer: 'Skickad till kommunen', acknowledged: 'Kvitterad', parse: 'Tolkning' };
  /** Kodvärden i loggen som läsbar svenska (SPEC: klarspråk). Nyckelberoende först, sedan generella ord. */
  const FIELD_WORD = { buyerReference: 'beställarreferens', purchaseOrderNumber: 'inköpsordernummer', primaryArea: 'avtalsområde', secondaryArea: 'andra avtalsområde', vocationalTrack: 'yrkesspår', desiredStart: 'önskad start',
    plannedWeeks: 'antal veckor', plannedEnd: 'planerat slut', plannedEndDate: 'planerat slut', startDate: 'startdatum', endDate: 'slutdatum', backgroundInfo: 'bakgrund', aiConsent: 'AI-samtycke', meetingDay: 'mötesdag', meetingTime: 'mötestid',
    location: 'plats', ordererContact: 'beställarens kontaktuppgifter', referrerId: 'handläggare', leadCoachId: 'huvudcoach', phase: 'fas', tags: 'taggar', pausedWeeks: 'pausade veckor', firstMeetingAt: 'första möte', team: 'team', status: 'status',
    area: 'avtalsområde', unit: 'enhet', contactName: 'kontaktperson', contactPhone: 'telefon', contactEmail: 'e-post', person: 'deltagare' };
  const VALUE_BY_KEY = {
    parseMethod: { template: 'Word-mall', ai: 'AI', manual: 'manuellt', freetext: 'fritext' },
    source: { email: 'e-post', portal: 'portalen', phone: 'telefon', manual: 'manuellt' },
    channel: { email: 'e-post', sms: 'SMS', portal: 'portalen', app: 'appen', brev: 'brev', letter: 'brev' },
    window: WINDOW,
    by: { customer: 'kommunen', coach: 'coachen', system: 'systemet' },
    method: { email_otp: 'e-post och engångskod', entra: 'Microsoft Entra ID' },
    role: { handlaggare: 'handläggare', chef: 'chef', admin: 'systemadmin', avtalsansvarig: 'avtalsansvarig', samordnare: 'samordnare', coach: 'coach', handledare: 'handledare', ekonom: 'ekonom' },
    toRole: { samordnare: 'samordnare', avtalsansvarig: 'avtalsansvarig', chef: 'chef', coach: 'coach', kommun_handlaggare: 'kommunens handläggare' },
    language: { sv: 'svenska', en: 'engelska', ar: 'arabiska', so: 'somaliska' },
    right: { uppgift: 'rätt arbetsuppgift', handledning: 'rätt handledning', timing: 'rätt tidpunkt', uppfoljning: 'rätt uppföljning' },
    format: { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF', sie: 'SIE', peppol: 'Peppol' },
  };
  const AI_KIND = { parse_email: 'tolka mejl', transcribe_extract: 'transkribering och utkast', extract_notes: 'utkast från anteckningar', extract_teams: 'utkast från Teams-transkript', report_summary: 'sammanfattning till rapport', monthly_draft: 'utkast till månadsbedömning' };
  const STATUS_WORD = { open: 'öppen', closed: 'stängd', action_plan: 'åtgärdsplan', handled: 'hanterat', accepted: 'accepterat', declined: 'avböjt', protected: 'skyddade personuppgifter', other: 'övrigt', linked: 'kopplat', received: 'mottaget',
    acknowledged: 'ordererkänt', draft: 'utkast', approved: 'godkänd', delivered: 'levererad', succeeded: 'klar', failed: 'fel', given: 'givet', revoked: 'återkallat', active: 'pågår', paused: 'pausad' };
  const kindWord = (a, s) => {
    if (a.action === 'ai.run' || a.entity === 'ai_run') return AI_KIND[s] || s;
    if (a.action === 'event.added') return sel.eventLabel(s);
    if (String(a.action).startsWith('report.') || a.entity === 'report') return sel.reportKindLabel(s);
    return AI_KIND[s] || (sel.reportKindLabel(s) !== s ? sel.reportKindLabel(s) : sel.eventLabel(s) !== s ? sel.eventLabel(s) : s);
  };
  const actorName = (id) => (id == null ? 'Deltagare (engångslänk)' : MM.personName(id));
  const caseIdOf = (a) => (['case', 'consent'].includes(a.entity) ? a.entityId : (a.details && a.details.caseId) || null);
  const caseNo = (a) => { const id = caseIdOf(a); const c = id ? sel.caseById(id) : null; return c ? c.number : ''; };
  const fmtDetail = (k, v, a = {}) => {
    if (v === true) return 'Ja'; if (v === false) return 'Nej';
    if (Array.isArray(v)) return v.map((x) => fmtDetail(k, x, a)).join(', ');
    if (v && typeof v === 'object') return Object.entries(v).map(([kk, vv]) => `${(DETAIL_KEY[kk] || FIELD_WORD[kk] || kk).toLowerCase()} ${fmtDetail(kk, vv, a)}`).join(', ');
    const s = String(v);
    if (k === 'template') return tplLabel(s);
    if (['fields', 'checked', 'missing'].includes(k)) return FIELD_WORD[s] || s;
    if (k === 'kind') return kindWord(a, s);
    if (k === 'kpi') { const x = (MM.cfg().kpis || []).find((y) => y.key === s); return x ? x.label || KPI_LABEL[s] || s : KPI_LABEL[s] || s; }
    if (k === 'endReason') return sel.endReasonLabel(s);
    if (k === 'status' && a.action === 'attendance.registered') return sel.attLabel(s);
    if (k === 'status') return STATUS_WORD[s] || s;
    if (VALUE_BY_KEY[k] && VALUE_BY_KEY[k][s]) return VALUE_BY_KEY[k][s];
    if (/^(u|k)-[a-z]+$/.test(s)) return MM.personName(s);
    if (/^case-\d+$/.test(s)) { const c = sel.caseById(s); return c ? c.number : s; }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return d.fmtDateTime(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return d.fmtDate(s);
    if (/^\d{4}-W\d{2}$/.test(s)) return d.fmtWeekKey(s);
    if (/^\d{4}-\d{2}$/.test(s) && k === 'month') return d.monthName(s);
    return s;
  };
  const detailText = (a) => {
    const x = a.details || {};
    if (a.action === 'org_rule.updated' && x.from && x.to) return ruleDiffText(x.from, x.to);
    return Object.entries(x).filter(([k, v]) => v != null && v !== '' && k !== 'caseId' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${DETAIL_KEY[k] || cap(FIELD_WORD[k] || k)}: ${fmtDetail(k, v, a)}`).join(' · ');
  };
  const JOB_NAME = { inbox: 'Läs avrop@-inkorgen', weekly: 'Publicera veckorapporter', att_remind: 'Påminnelser om närvaroregistrering', progress: 'Progressionspåminnelser', audio: 'Radera ljud efter transkribering', transcripts: 'Radera råtranskript', kpi: 'Beräkna nyckeltal', retention: 'Gallring enligt PUB-avtalet' };
  /** Objektets id som läsbar text där det går (mall, jobb, månad, avtal, användare). Deltagare visas aldrig med namn. */
  const entityText = (a) => {
    const id = String(a.entityId == null ? '' : a.entityId);
    if (a.entity === 'template') return tplLabel(id);
    if (a.entity === 'job') return JOB_NAME[id] || id;
    if (a.entity === 'contract') { const k = S().contracts.find((c) => c.id === id); return k ? k.customerName : id; }
    if (a.entity === 'org_config' && id === 'notifications') return 'Påminnelser och eskalering';
    if (['profile', 'customer_user'].includes(a.entity) && MM.personById(id)) return MM.personName(id);
    const m = id.match(/(\d{4}-\d{2})$/); if (['billing_run', 'audit_log'].includes(a.entity) && m) return cap(d.monthName(m[1]));
    if (a.entity === 'report') {
      const r = S().reports.find((x) => x.id === id);
      if (r) return `${sel.reportKindLabel(r.kind)}${r.month ? ` ${d.monthName(r.month)}` : r.week ? ` ${d.fmtWeekKey(r.week)}` : ''}${r.version > 1 ? `, version ${r.version}` : ''}`;
      const k = id.match(/^([a-z_]+)-(\d{4}-\d{2})$/); if (k) return `${sel.reportKindLabel(k[1])} ${d.monthName(k[2])}`;
      const w = id.match(/^weekly-W(\d{2})$/); if (w) return `Veckorapporter vecka ${Number(w[1])}`;
    }
    return id;
  };
  const sortLog = (log) => log.map((a, i) => [a, i]).sort((x, y) => (x[0].occurredAt < y[0].occurredAt ? 1 : x[0].occurredAt > y[0].occurredAt ? -1 : y[1] - x[1])).map((x) => x[0]);
  const VIEW_ACTIONS = ['case.view', 'pnr.revealed', 'report.view', 'transcript.view'];
  const pickSample = (log, month) => {
    const inMonth = log.filter((a) => String(a.occurredAt).startsWith(month)).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
    const views = inMonth.filter((a) => VIEW_ACTIONS.includes(a.action) || String(a.action).startsWith('export.'));
    const rest = inMonth.filter((a) => !views.includes(a));
    const step = Math.max(1, Math.floor(rest.length / 5));
    return [...views, ...rest.filter((_, i) => i % step === 0)].slice(0, 5);
  };

  const LogCheck = ({ role }) => {
    const st = MM.useStore();
    const month = d.addMonths(d.monthKey(d.today()), -1);
    const done = (st.logChecks || []).filter((x) => x.month === month).slice(-1)[0] || null;
    const sample = useMemo(() => pickSample(st.auditLog, month), [month]);
    const [verdicts, setVerdicts] = useState({}); const [note, setNote] = useState(''); const [tried, setTried] = useState(false);
    const allSet = sample.length > 0 && sample.every((a) => verdicts[a.id]);
    const anyDev = Object.values(verdicts).includes('avvikelse');
    const noteErr = tried && anyDev && !note.trim() ? 'Beskriv avvikelsen och vad som ska göras.' : null;
    if (done) {
      const devs = done.items.filter((x) => x.verdict === 'avvikelse').length;
      return html`<${ui.Notice} tone=${devs ? 'warn' : 'ok'} title=${`Loggkontrollen för ${d.monthName(month)} är signerad`}>
        ${MM.personName(done.signedBy)} signerade ${d.fmtDateTime(done.signedAt)}. ${plural(done.items.length, 'post', 'poster')} kontrollerade, ${plural(devs, 'avvikelse', 'avvikelser')}.${done.note ? ` Anteckning: ${done.note}` : ''}<//>`;
    }
    if (role !== 'chef') {
      return html`<${ui.Card} title=${`Månatlig loggkontroll – ${d.monthName(month)}`} icon="check-square" tone="sub">
        <div class="row-between"><span><${I} name="clock" /> Inte gjord ännu. Chef och controller gör ett stickprov i loggen varje månad.</span>
          <${ui.PerspectiveSwitch} role="chef" view="admin.logg" label="Gör kontrollen som chef" /></div><//>`;
    }
    const sign = () => {
      setTried(true); if (!allSet || (anyDev && !note.trim())) return;
      const r = MM.dispatch('admin.logCheck', { month, items: sample.map((a) => ({ logId: a.id, verdict: verdicts[a.id] })), note });
      if (r && r.error) MM.toast('Loggkontrollen kunde inte signeras.', 'red'); else MM.toast(`Loggkontrollen för ${d.monthName(month)} är signerad.`, 'blue');
    };
    return html`<${ui.Card} title=${`Månatlig loggkontroll – ${d.monthName(month)}`} icon="check-square" tone="blue"
      foot=${html`<${ui.Btn} kind="primary" icon="check" disabled=${!allSet} onClick=${sign}>Signera loggkontrollen<//><span class="small muted">${Object.keys(verdicts).length} av ${sample.length} poster bedömda</span>`}>
      <div class="stack">
        <p>Stickprov med ${plural(sample.length, 'post', 'poster')} från förra månaden, i första hand visningar och exporter. Bedöm om åtkomsten var motiverad av arbetet.</p>
        ${sample.length === 0 ? html`<p class="muted">Inga poster förra månaden.</p>` : html`<div class="stack-sm">${sample.map((a) => html`<div key=${a.id} class="row-between" style="padding:8px 0;border-bottom:1px solid var(--line)">
          <div class="stack-sm" style="gap:2px;min-width:0;flex:1 1 240px"><span class="strong">${actionLabel(a.action)}</span>
            <span class="small muted">${d.fmtDateTime(a.occurredAt)} · ${actorName(a.actorId)} · ${ENTITY_LABEL[a.entity] || cap(String(a.entity || '').replace(/_/g, ' '))}${caseNo(a) ? ` ${caseNo(a)}` : ''}</span></div>
          <${ui.Seg} ariaLabel=${`Bedömning av ${actionLabel(a.action)} ${d.fmtDateTime(a.occurredAt)}`} value=${verdicts[a.id]} onChange=${(v) => setVerdicts((x) => ({ ...x, [a.id]: v }))}
            options=${[{ value: 'ok', label: 'Motiverad', icon: 'check', tone: 'green' }, { value: 'avvikelse', label: 'Avvikelse', icon: 'alert', tone: 'red' }]} />
        </div>`)}</div>`}
        <${ui.Field} id="logcheck-note" label="Anteckning" help="Krävs om du markerat en avvikelse. Skriv vad som hände och vad som ska göras." error=${noteErr}><${ui.TextArea} id="logcheck-note" rows=${2} value=${note} onInput=${setNote} invalid=${!!noteErr} /><//>
      </div>
    <//>`;
  };

  const LogView = ({ role }) => {
    const st = MM.useStore();
    const [actor, setActor] = useState(''); const [action, setAction] = useState(''); const [q, setQ] = useState(''); const [mine, setMine] = useState(false); const [limit, setLimit] = useState(50);
    const all = useMemo(() => sortLog(st.auditLog), [st.auditLog.length]);
    const actors = MM.uniq(all.map((a) => (a.actorId == null ? '__null' : a.actorId))).map((id) => ({ value: id, label: id === '__null' ? 'Deltagare (engångslänk)' : MM.personName(id) })).sort((a, b) => a.label.localeCompare(b.label, 'sv'));
    const actions = MM.uniq(all.map((a) => a.action)).map((x) => ({ value: x, label: actionLabel(x) })).sort((a, b) => a.label.localeCompare(b.label, 'sv'));
    const rows = all.filter((a) => (!actor || (actor === '__null' ? a.actorId == null : a.actorId === actor)) && (!action || a.action === action) && (!q.trim() || caseNo(a).toLowerCase().includes(q.trim().toLowerCase())) && (!mine || a.byTester));
    const filterDesc = [actor && `aktör ${actor === '__null' ? 'deltagare' : MM.personName(actor)}`, action && `åtgärd ${actionLabel(action)}`, q.trim() && `ärende ${q.trim()}`, mine && 'bara prototypen'].filter(Boolean).join(', ');
    const exportCsv = () => {
      MM.dispatch('audit.view', { action: 'export.audit_log', entity: 'audit_log', entityId: 'c-bot', details: { rows: rows.length, filter: filterDesc || 'inget' } });
      const esc = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
      const head = ['Tidpunkt', 'Aktör', 'Åtgärd', 'Åtgärdskod', 'Objekt', 'Objekt-id', 'Ärendenummer', 'Detaljer', 'Gjort i prototypen'];
      const lines = rows.map((a) => [a.occurredAt.replace('T', ' '), actorName(a.actorId), actionLabel(a.action), a.action, ENTITY_LABEL[a.entity] || a.entity, a.entityId, caseNo(a), detailText(a), a.byTester ? 'Ja' : 'Nej'].map(esc).join(';'));
      MM.download(`revisionslogg-${d.today()}.csv`, [head.map(esc).join(';'), ...lines].join('\n'));
    };
    const views = all.filter((a) => VIEW_ACTIONS.includes(a.action)).length;
    const exportsN = all.filter((a) => String(a.action).startsWith('export.')).length;
    return html`<${ui.Page} title="Revisionslogg" eyebrow=${role === 'chef' ? 'Chef och controller' : 'Systemadmin'}
      lead="Loggen kan inte ändras eller raderas. Visning av deltagarkort, rapporter och transkript loggas, liksom alla ändringar, exporter och AI-körningar. Loggen innehåller id:n – aldrig namn eller personnummer på deltagare."
      actions=${html`<${ui.Btn} kind="secondary" icon="download" onClick=${exportCsv}>Exportera (CSV)<//>`}>
      <div class="grid-4">
        <${ui.Kpi} label="Poster i loggen" value=${fmt.num(all.length)} sub="urval från demodatat" />
        <${ui.Kpi} label="Visningar" value=${views} sub="deltagarkort, personnummer och rapporter" />
        <${ui.Kpi} label="Exporter" value=${exportsN} sub="loggas alltid" />
        <${ui.Kpi} label="Gjort av dig" value=${all.filter((a) => a.byTester).length} sub="i prototypen" />
      </div>
      <${LogCheck} role=${role} />
      <${ui.Card} title="Filter" icon="filter">
        <div class="grid" style="align-items:end">
          <${ui.Field} id="log-actor" label="Aktör"><${ui.Select} id="log-actor" value=${actor} onChange=${(v) => { setActor(v); setLimit(50); }} placeholder="Alla aktörer" options=${actors} /><//>
          <${ui.Field} id="log-action" label="Åtgärd"><${ui.Select} id="log-action" value=${action} onChange=${(v) => { setAction(v); setLimit(50); }} placeholder="Alla åtgärder" options=${actions} /><//>
          <${ui.Field} id="log-case" label="Ärende" help="Skriv hela eller en del av ärendenumret."><${ui.Input} id="log-case" type="search" value=${q} onInput=${(v) => { setQ(v); setLimit(50); }} placeholder="Till exempel BOT-26-0143" /><//>
          <${ui.Check} id="log-mine-only" checked=${mine} onChange=${setMine}>Bara det du gjort i prototypen<//>
        </div>
      <//>
      <${ui.Card} title=${`Poster (${rows.length})`} icon="book" flush
        foot=${rows.length > limit ? html`<${ui.Btn} kind="secondary" icon="chevron-down" onClick=${() => setLimit(limit + 50)}>Visa 50 till<//><span class="small muted">Visar ${limit} av ${rows.length}</span>` : null}>
        <style>${STACK_CSS}</style>
        <div class="table-wrap"><table class="table adm-stack">
          <caption class="sr-only">Revisionslogg, nyast först</caption>
          <thead><tr><th scope="col">Tidpunkt</th><th scope="col">Aktör</th><th scope="col">Åtgärd</th><th scope="col">Objekt</th><th scope="col">Detaljer</th></tr></thead>
          <tbody>
            ${rows.length === 0 && html`<tr><td colspan="5" class="muted">Inga poster matchar filtret.</td></tr>`}
            ${rows.slice(0, limit).map((a) => { const cid = caseIdOf(a); return html`<tr key=${a.id} class=${a.byTester ? 'selected' : ''}>
              <td class="nowrap">${d.fmtDateTime(a.occurredAt)}</td>
              <td data-label="Aktör"><span>${actorName(a.actorId)}</span>${a.byTester && html`<div style="margin-top:4px"><${ui.Badge} tone="dark" icon="user">Gjort av dig i prototypen<//></div>`}</td>
              <td><span class="strong" title=${`Åtgärdskod: ${a.action}`}>${actionLabel(a.action)}</span></td>
              <td data-label="Objekt"><span>${ENTITY_LABEL[a.entity] || cap(String(a.entity || '').replace(/_/g, ' '))}</span><div class="cell-sub">${cid && sel.caseById(cid) ? html`<${ui.CaseLink} caseId=${cid} />` : entityText(a)}</div></td>
              <td data-label="Detaljer"><span class="small">${detailText(a) || '–'}</span></td>
            </tr>`; })}
          </tbody>
        </table></div>
      <//>
      <${ui.DemoNote}>Loggen innehåller ett urval från demodatat plus allt du gör i prototypen. Exporten loggas som en egen post innan filen skapas.<//>
    <//>`;
  };
  MM.registerView('admin.logg', { title: 'Revisionslogg', roles: ['admin', 'chef'], component: ({ params, role }) => html`<${LogView} key=${role} params=${params} role=${role} />` });

  // ============================================================ puls.svar – Pulsmätning (deltagare, engångslänk)
  const PT = {
    sv: { language: 'Språk', title: 'Hur går det?', intro: 'Vi vill veta hur du har det hos oss.', bullets: ['Fem korta frågor. Det tar ungefär en minut.', 'Det är frivilligt att svara. Ditt svar påverkar ingenting i din insats.', 'Din coach ser inte vad du svarar.', 'Länken gäller i {days} dagar och kan bara användas en gång.'],
      start: 'Börja', of: 'Fråga {n} av 5', back: 'Tillbaka', next: 'Nästa', submit: 'Skicka svar', chose: 'Du valde',
      q1: 'Hur trivs du hos oss?', q2: 'Känner du att du kommer närmare jobb eller studier?', q3: 'Får du det stöd du behöver av din coach?', q4: 'Vad är viktigast för dig just nu?',
      q4o: { jobb: 'Hitta jobb', praktik: 'Praktik', utbildning: 'Utbildning', svenska: 'Bli säkrare på svenska', annat: 'Annat' }, q5: 'Vill du att någon kontaktar dig?', yes: 'Ja', no: 'Nej',
      textLabel: 'Vill du skriva något? (frivilligt)', textHelp: 'Skriv inte ditt personnummer.', scale: ['Mycket dåligt', 'Dåligt', 'Okej', 'Bra', 'Mycket bra'],
      thanks: 'Tack för dina svar!', thanksContact: 'Någon från Miljonbemanning hör av sig till dig.', close: 'Du kan stänga sidan nu.',
      used: 'Länken är redan använd', usedText: 'Du har redan svarat. Varje länk kan bara användas en gång. Tack!', expired: 'Länken har gått ut', expiredText: 'Länken gällde i {days} dagar. Du behöver inte göra något.', missing: 'Länken fungerar inte', missingText: 'Kontrollera att du har hela länken.' },
    en: { language: 'Language', title: 'How are things going?', intro: 'We want to know how you are doing with us.', bullets: ['Five short questions. It takes about one minute.', 'Answering is voluntary. Your answers do not affect your programme.', 'Your coach does not see what you answer.', 'The link is valid for {days} days and can only be used once.'],
      start: 'Start', of: 'Question {n} of 5', back: 'Back', next: 'Next', submit: 'Send answers', chose: 'You chose',
      q1: 'How do you like it here with us?', q2: 'Do you feel that you are getting closer to a job or studies?', q3: 'Do you get the support you need from your coach?', q4: 'What is most important to you right now?',
      q4o: { jobb: 'Finding a job', praktik: 'Work placement', utbildning: 'Education', svenska: 'Getting better at Swedish', annat: 'Something else' }, q5: 'Would you like someone to contact you?', yes: 'Yes', no: 'No',
      textLabel: 'Do you want to write something? (optional)', textHelp: 'Do not write your personal identity number.', scale: ['Very bad', 'Bad', 'Okay', 'Good', 'Very good'],
      thanks: 'Thank you for your answers!', thanksContact: 'Someone from Miljonbemanning will contact you.', close: 'You can close this page now.',
      used: 'The link has already been used', usedText: 'You have already answered. Each link can only be used once. Thank you!', expired: 'The link has expired', expiredText: 'The link was valid for {days} days. You do not need to do anything.', missing: 'The link does not work', missingText: 'Check that you have the whole link.' },
    ar: { language: 'اللغة', title: 'كيف تسير الأمور؟', intro: 'نريد أن نعرف كيف حالك معنا.', bullets: ['خمسة أسئلة قصيرة. يستغرق ذلك دقيقة واحدة تقريبًا.', 'الإجابة اختيارية. إجاباتك لا تؤثر على برنامجك.', 'مدربك لا يرى إجاباتك.', 'الرابط صالح لمدة {days} أيام ويمكن استخدامه مرة واحدة فقط.'],
      start: 'ابدأ', of: 'السؤال {n} من 5', back: 'رجوع', next: 'التالي', submit: 'أرسل الإجابات', chose: 'اخترت',
      q1: 'هل أنت مرتاح معنا؟', q2: 'هل تشعر أنك تقترب من العمل أو الدراسة؟', q3: 'هل تحصل على الدعم الذي تحتاجه من مدربك؟', q4: 'ما هو الأهم بالنسبة لك الآن؟',
      q4o: { jobb: 'إيجاد عمل', praktik: 'تدريب عملي', utbildning: 'تعليم', svenska: 'تحسين لغتي السويدية', annat: 'شيء آخر' }, q5: 'هل تريد أن يتواصل معك أحد؟', yes: 'نعم', no: 'لا',
      textLabel: 'هل تريد أن تكتب شيئًا؟ (اختياري)', textHelp: 'لا تكتب رقمك الشخصي.', scale: ['سيئ جدًا', 'سيئ', 'مقبول', 'جيد', 'جيد جدًا'],
      thanks: 'شكرًا على إجاباتك!', thanksContact: 'سيتواصل معك شخص من Miljonbemanning.', close: 'يمكنك إغلاق هذه الصفحة الآن.',
      used: 'تم استخدام الرابط من قبل', usedText: 'لقد أجبت من قبل. يمكن استخدام كل رابط مرة واحدة فقط. شكرًا لك!', expired: 'انتهت صلاحية الرابط', expiredText: 'كان الرابط صالحًا لمدة {days} أيام. لا تحتاج إلى فعل أي شيء.', missing: 'الرابط لا يعمل', missingText: 'تأكد من أن لديك الرابط كاملًا.' },
    so: { language: 'Luqadda', title: 'Sidee wax u socdaan?', intro: 'Waxaan rabnaa inaan ogaanno sida ay kuula tahay joogitaankaaga nala.', bullets: ['Shan su\'aalood oo gaagaaban. Waxay qaadanaysaa qiyaastii hal daqiiqo.', 'Ka jawaabistu waa ikhtiyaari. Jawaabahaagu waxba kama beddelaan barnaamijkaaga.', 'Tababarahaagu ma arko waxaad ka jawaabto.', 'Linkigu wuxuu shaqaynayaa {days} maalmood, hal mar oo keliya ayaana la isticmaali karaa.'],
      start: 'Bilow', of: 'Su\'aasha {n} ee 5', back: 'Dib u noqo', next: 'Xiga', submit: 'Dir jawaabaha', chose: 'Waxaad dooratay',
      q1: 'Sidee ayay kuula tahay halkan?', q2: 'Ma dareemaysaa inaad u dhowaanayso shaqo ama waxbarasho?', q3: 'Ma ka helaysaa tababarahaaga taageerada aad u baahan tahay?', q4: 'Maxaa hadda kuugu muhiimsan?',
      q4o: { jobb: 'Helitaanka shaqo', praktik: 'Tababar shaqo (praktik)', utbildning: 'Waxbarasho', svenska: 'Inaan iswiidhishka si fiican u barto', annat: 'Wax kale' }, q5: 'Ma rabtaa in qof kula soo xiriiro?', yes: 'Haa', no: 'Maya',
      textLabel: 'Ma rabtaa inaad wax qorto? (ikhtiyaari)', textHelp: 'Ha qorin lambarkaaga shakhsiga.', scale: ['Aad u xun', 'Xun', 'Caadi', 'Fiican', 'Aad u fiican'],
      thanks: 'Waad ku mahadsan tahay jawaabahaaga!', thanksContact: 'Qof ka socda Miljonbemanning ayaa kula soo xiriiri doona.', close: 'Hadda waad xiri kartaa boggan.',
      used: 'Linkiga horay ayaa loo isticmaalay', usedText: 'Horay ayaad uga jawaabtay. Link kasta hal mar oo keliya ayaa la isticmaali karaa. Mahadsanid!', expired: 'Linkiga wuu dhacay', expiredText: 'Linkigu wuxuu shaqaynayay {days} maalmood. Waxba uma baahnid inaad samayso.', missing: 'Linkigu ma shaqaynayo', missingText: 'Hubi inaad haysato linkiga oo dhan.' },
  };
  const LANGS = [['sv', 'Svenska'], ['en', 'English'], ['ar', 'العربية'], ['so', 'Soomaali']];
  const MOUTH = { 1: 'M8 17 Q12 13 16 17', 2: 'M8.5 16.5 Q12 14.8 15.5 16.5', 3: 'M8.5 15.5 L15.5 15.5', 4: 'M8.5 14.5 Q12 17 15.5 14.5', 5: 'M7.5 14 Q12 19.5 16.5 14' };
  const Face = ({ v }) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><line x1="9" y1="9.5" x2="9.01" y2="9.5" /><line x1="15" y1="9.5" x2="15.01" y2="9.5" /><path d=${MOUTH[v]} /></svg>`;
  const tr = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  const optBtn = 'min-height:52px;flex-direction:row;justify-content:flex-start;gap:10px;padding:10px 14px;font-size:1rem;text-align:start;width:100%';

  const PulseView = () => {
    const st = MM.useStore();
    const inv = st.pulseInvites.find((x) => x.id === 'pi-demo');
    const [lang, setLang] = useState((inv && PT[inv.language] && inv.language) || 'sv');
    const [step, setStep] = useState(0); // 0 = intro, 1–5 = frågor, 6 = tack
    const [ans, setAns] = useState({ q1: null, q2: null, q3: null, q4: null, q5: null });
    const [text, setText] = useState(''); const [preview, setPreview] = useState('live');
    const t = PT[lang]; const days = inv ? d.diffDays(inv.sentAt, inv.expiresAt) : 7;
    let state = 'open';
    if (!inv) state = 'missing';
    else if (preview === 'used') state = 'used';
    else if (preview === 'expired') state = 'expired';
    else if (step === 6) state = 'thanks';
    else if (inv.usedAt) state = 'used';
    else if (d.now() > inv.expiresAt) state = 'expired';
    const qKey = `q${step}`; const answered = step >= 1 && step <= 5 && ans[qKey] != null;
    const set = (k, v) => setAns((x) => ({ ...x, [k]: v }));
    const submit = () => {
      const r = MM.dispatch('pulse.submit', { inviteId: inv.id, language: lang, answers: ans, text: ans.q5 === 'ja' || text ? text : '' });
      if (r && r.error) { MM.toast(r.error === 'used' ? t.used : r.error === 'expired' ? t.expired : t.missing, 'red'); return; }
      setStep(6);
    };
    const scale = (k) => html`<div class="stack-sm">
      <div class="smileys" role="group" aria-label=${t[k]}>${[1, 2, 3, 4, 5].map((v) => html`<button type="button" key=${v} class="smiley" aria-pressed=${ans[k] === v ? 'true' : 'false'} aria-label=${`${v} – ${t.scale[v - 1]}`} onClick=${() => set(k, v)}><${Face} v=${v} /><span>${v}</span></button>`)}</div>
      <div class="row-between small muted"><span>1 = ${t.scale[0]}</span><span>5 = ${t.scale[4]}</span></div>
      <p aria-live="polite" class="strong" style="min-height:1.5em">${ans[k] != null ? `${t.chose}: ${t.scale[ans[k] - 1]}` : ''}</p>
    </div>`;
    const question = () => {
      if (step <= 3) return scale(qKey);
      if (step === 4) return html`<div class="stack-sm" role="group" aria-label=${t.q4}>${Q4_VALUES.map((v) => html`<button type="button" key=${v} class="smiley" style=${optBtn} aria-pressed=${ans.q4 === v ? 'true' : 'false'} onClick=${() => set('q4', v)}><${I} name=${ans.q4 === v ? 'check-circle' : 'circle'} />${t.q4o[v]}</button>`)}</div>`;
      return html`<div class="stack">
        <div class="grid-2" style="grid-template-columns:repeat(2,minmax(0,1fr))" role="group" aria-label=${t.q5}>${[['ja', t.yes], ['nej', t.no]].map(([v, l]) => html`<button type="button" key=${v} class="smiley" style="min-height:56px;font-size:1.0625rem" aria-pressed=${ans.q5 === v ? 'true' : 'false'} onClick=${() => set('q5', v)}>${l}</button>`)}</div>
        <div class="field"><label for="pulse-text">${t.textLabel}</label><div class="help" id="pulse-text-help">${t.textHelp}</div>
          <textarea id="pulse-text" rows="3" maxLength="500" value=${text} aria-describedby="pulse-text-help" onInput=${(e) => setText(e.target.value)}></textarea></div>
      </div>`;
    };
    const screen = (icon, title, children) => html`<div class="stack" style="align-items:center;text-align:center;padding:12px 0">
      <${I} name=${icon} size="xl" /><h1 style="font-size:1.375rem;font-weight:800">${title}</h1>${children}</div>`;
    let content;
    if (state === 'missing') content = screen('alert-circle', t.missing, html`<p>${t.missingText}</p>`);
    else if (state === 'thanks') content = screen('check-circle', t.thanks, html`${ans.q5 === 'ja' && html`<p>${t.thanksContact}</p>`}<p class="muted">${t.close}</p>`);
    else if (state === 'used') content = screen('lock', t.used, html`<p>${t.usedText}</p>`);
    else if (state === 'expired') content = screen('clock', t.expired, html`<p>${tr(t.expiredText, { days })}</p>`);
    else if (step === 0) content = html`<div class="stack">
      <h1 style="font-size:1.5rem;font-weight:800">${t.title}</h1>
      <p>${t.intro}</p>
      <ul class="stack-sm" style="margin:0;padding:0;list-style:none">${t.bullets.map((b, i) => html`<li key=${i} class="row-sm" style="flex-wrap:nowrap;align-items:flex-start;gap:10px"><${I} name=${['clock', 'check-circle', 'eye-off', 'calendar'][i]} /><span>${tr(b, { days })}</span></li>`)}</ul>
      <${ui.Btn} kind="primary" size="lg" block icon=${lang === 'ar' ? undefined : 'arrow-right'} onClick=${() => setStep(1)}>${t.start}<//>
    </div>`;
    else content = html`<div class="stack">
      <div class="stack-sm"><span class="small muted">${tr(t.of, { n: step })}</span>
        <div class="phasebar" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => html`<div key=${n} class=${MM.cls('ph', n < step && 'done', n === step && 'now')}></div>`)}</div></div>
      <h1 style="font-size:1.3125rem;font-weight:800">${t[qKey]}</h1>
      ${question()}
      <div class="row-between">
        <${ui.Btn} kind="ghost" onClick=${() => setStep(step - 1)}>${t.back}<//>
        ${step < 5 ? html`<${ui.Btn} kind="primary" disabled=${!answered} onClick=${() => setStep(step + 1)}>${t.next}<//>` : html`<${ui.Btn} kind="primary" icon="send" disabled=${!answered} onClick=${submit}>${t.submit}<//>`}
      </div>
    </div>`;
    const showLang = !['thanks'].includes(state);
    return html`<div style="width:min(420px,100%);display:flex;flex-direction:column;gap:16px">
      <div class="pulse-phone" lang=${lang} dir=${lang === 'ar' ? 'rtl' : 'ltr'}>
        <div class="row-between"><span class="brand" style="padding:0;font-size:1rem" dir="ltr">Miljonbemanning<span class="dot" aria-hidden="true"></span></span><span class="small muted" lang="sv">Alby</span></div>
        ${showLang && html`<div class="stack-sm">
          <div class="seg" role="group" aria-label=${t.language}>${LANGS.map(([code, label]) => html`<button type="button" key=${code} lang=${code} dir=${code === 'ar' ? 'rtl' : 'ltr'} aria-pressed=${lang === code ? 'true' : 'false'} onClick=${() => setLang(code)}>${label}</button>`)}</div>
          ${lang !== 'sv' && html`<span lang="sv" dir="ltr"><${ui.Badge} tone="plan" icon="globe">Översättning – granskas av människa<//></span>`}
        </div>`}
        ${content}
      </div>
      <div lang="sv" class="stack-sm">
        <${ui.DemoNote}>Deltagaren öppnar en engångslänk från SMS eller e-post – ingen inloggning. Länken är signerad, gäller i ${days} dagar och fungerar bara en gång. Den skickas aldrig till skyddade ärenden. Coachen ser inte enskilda svar. "Ja" på fråga 5 blir en uppgift till samordnaren, och lågt betyg på fråga 3 går till chefen.<//>
        <div class="stack-sm" style="gap:4px"><span class="small strong">Förhandsvisa länkens lägen</span>
          <${ui.Seg} ariaLabel="Förhandsvisa länkens lägen" value=${preview} onChange=${setPreview} options=${[{ value: 'live', label: 'Aktuell länk' }, { value: 'used', label: 'Redan använd' }, { value: 'expired', label: 'Har gått ut' }]} /></div>
        <div class="row-sm"><${ui.PerspectiveSwitch} role="chef" view="chef.oversikt" params=${{ tab: 'puls' }} label="Se sammanställningen som chef" /><${ui.PerspectiveSwitch} role="samordnare" view="sam.start" label="Se samordnarens uppgift" /></div>
      </div>
    </div>`;
  };
  MM.registerView('puls.svar', { title: 'Pulsmätning', roles: ['deltagare'], component: PulseView });

  // ============================================================ praktik.arbetsgivare – Arbetsgivarregister och praktik (fas 3)
  const RIGHTS = [
    ['uppgift', 'Rätt arbetsuppgift', 'Arbetsuppgifterna är kopplade till yrkesspåret.'],
    ['handledning', 'Rätt handledning', 'Handledare hos arbetsgivaren, mål och ansvar är bestämda.'],
    ['timing', 'Rätt tidpunkt', 'Coachen har bedömt att deltagaren är redo: krav, tempo och rutiner.'],
    ['uppfoljning', 'Rätt uppföljning', 'Uppföljningsdatum är planerade. Återkopplingen dokumenteras och leder till nästa steg.'],
  ];
  const rightsDone = (pl) => RIGHTS.filter(([k]) => (pl.fourRights || {})[k]).length;
  const canSeeCase = (c, role) => !!c && ['full', 'team'].includes(sel.access(c, role));
  const whoLabel = (c, role) => (canSeeCase(c, role) ? sel.displayName(c, role) : c && sel.access(c, role) === 'restricted' ? 'Skyddade personuppgifter' : 'Deltagare i ett annat team');
  const RightsBadge = ({ pl }) => { const n = rightsDone(pl); return html`<${ui.Badge} tone=${n === 4 ? 'blue' : 'outline'} icon=${n === 4 ? 'check' : 'alert-circle'}>${n} av 4 rätt<//>`; };

  const AddEmployer = ({ onClose }) => {
    const st = MM.useStore(); const areas = st.areas.filter((a) => a.contractId === 'c-bot');
    const [f, setF] = useState({ name: '', orgNr: '', contactName: '', phone: '', email: '', areas: [] });
    const [tried, setTried] = useState(false); const [serverErr, setServerErr] = useState(null);
    const set = (k) => (v) => { setServerErr(null); setF((x) => ({ ...x, [k]: v })); };
    const errs = {};
    if (!f.name.trim()) errs.name = 'Skriv företagets namn.';
    if (f.orgNr.trim() && !/^\d{6}-\d{4}$/.test(f.orgNr.trim())) errs.orgNr = 'Skriv organisationsnumret med bindestreck, till exempel 556123-4567.';
    if (f.email.trim() && !MM.valid.email(f.email)) errs.email = 'E-postadressen ser inte ut att stämma.';
    if (!f.areas.length) errs.areas = 'Välj minst ett avtalsområde.';
    const show = (k) => (tried ? errs[k] : null);
    const submit = () => {
      setTried(true); if (Object.keys(errs).length) return;
      const r = MM.dispatch('employer.add', f);
      if (r && r.error) { setServerErr(r.error === 'duplicate' ? 'Arbetsgivaren finns redan i registret (samma namn eller organisationsnummer).' : 'Arbetsgivaren kunde inte sparas. Kontrollera fälten.'); return; }
      MM.toast(`${f.name.trim()} är tillagd i arbetsgivarregistret.`, 'blue'); onClose(); MM.nav('praktik.arbetsgivare', { employerId: r.employerId });
    };
    return html`<${ui.Modal} title="Lägg till arbetsgivare" onClose=${onClose} footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="plus" onClick=${submit}>Lägg till<//>`}>
      <p class="muted">Registret delas av alla coacher, handledare och arbetsgivarmatchare. Skriv inga uppgifter om deltagare här.</p>
      ${serverErr && html`<${ui.Notice} tone="critical">${serverErr}<//>`}
      <div class="form-grid">
        <${ui.Field} id="emp-name" label="Företag" required help="Företagets namn som det står i avtal och på fakturor." error=${show('name')}><${ui.Input} id="emp-name" value=${f.name} onInput=${set('name')} invalid=${!!show('name')} /><//>
        <${ui.Field} id="emp-org" label="Organisationsnummer" help="Tio siffror med bindestreck." error=${show('orgNr')}><${ui.Input} id="emp-org" value=${f.orgNr} onInput=${set('orgNr')} inputMode="numeric" maxLength=${11} placeholder="556123-4567" invalid=${!!show('orgNr')} /><//>
        <${ui.Field} id="emp-contact" label="Kontaktperson" help="Den som tar emot praktikanter, ofta handledaren."><${ui.Input} id="emp-contact" value=${f.contactName} onInput=${set('contactName')} /><//>
        <${ui.Field} id="emp-phone" label="Telefon" help="Kontaktpersonens telefon i arbetet."><${ui.Input} id="emp-phone" type="tel" value=${f.phone} onInput=${set('phone')} /><//>
        <${ui.Field} id="emp-email" label="E-post" help="Kontaktpersonens e-post i arbetet." error=${show('email')} full><${ui.Input} id="emp-email" type="email" value=${f.email} onInput=${set('email')} invalid=${!!show('email')} /><//>
      </div>
      <${Group} id="emp-areas" legend="Avtalsområden" help="Vilka yrkesområden arbetsgivaren kan ta emot praktikanter inom." error=${show('areas')}>
        <div class="grid-2" style="gap:0 16px">${areas.map((a) => html`<${ui.Check} key=${a.code} id=${`emp-area-${a.code}`} checked=${f.areas.includes(a.code)} onChange=${(v) => setF((x) => ({ ...x, areas: v ? [...x.areas, a.code] : x.areas.filter((y) => y !== a.code) }))}>${a.code} ${a.name}<//>`)}</div>
      <//>
    <//>`;
  };

  const EmployerList = ({ role }) => {
    const st = MM.useStore();
    const [q, setQ] = useState(''); const [area, setArea] = useState(''); const [adding, setAdding] = useState(false);
    const today = d.today(); const in7 = d.addDays(today, 7);
    const ongoing = st.placements.filter((p) => p.status === 'ongoing');
    const mineOnly = ['coach', 'handledare'].includes(role);
    const upcoming = ongoing.filter((p) => !mineOnly || canSeeCase(sel.caseById(p.caseId), role)).flatMap((p) => (p.followUpDates || []).filter((x) => x >= today && x <= in7).map((x) => ({ p, x }))).sort((a, b) => (a.x < b.x ? -1 : 1));
    const full = ongoing.filter((p) => rightsDone(p) === 4).length;
    const empName = (id) => (st.employers.find((e) => e.id === id) || {}).name || '–';
    const rows = st.employers.filter((e) => (!q.trim() || `${e.name} ${e.contactName}`.toLowerCase().includes(q.trim().toLowerCase())) && (!area || e.areas.includes(area)))
      .map((e) => { const ps = st.placements.filter((p) => p.employerId === e.id); const on = ps.filter((p) => p.status === 'ongoing'); const next = on.flatMap((p) => p.followUpDates || []).filter((x) => x >= today).sort()[0] || null; return { ...e, total: ps.length, ongoing: on.length, next }; })
      .sort((a, b) => b.ongoing - a.ongoing || a.name.localeCompare(b.name, 'sv'));
    const nadia = st.script && st.script.nadia;
    return html`<${ui.Page} title="Arbetsgivare och praktik" eyebrow=${html`<span class="row-sm">Gemensamt register för alla coacher <${ui.BuildPhase} fas=${3} /></span>`}
      lead="Arbetsgivare som tar emot praktikanter och de fyra rätten för varje praktikplats. Deltagarnas namn visas bara för ärenden du har åtkomst till."
      actions=${html`${nadia && html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.deltagare" params=${{ caseId: nadia }} label="Se praktiken från kundens håll" />`}<${ui.Btn} kind="primary" icon="plus" onClick=${() => setAdding(true)}>Lägg till arbetsgivare<//>`}>
      <div class="grid-4">
        <${ui.Kpi} label="Arbetsgivare" value=${st.employers.length} sub="i registret" />
        <${ui.Kpi} label="Pågående praktik" value=${ongoing.length} sub=${`${st.placements.length} praktikplatser totalt`} />
        <${ui.Kpi} label="Uppföljningar" value=${upcoming.length} sub=${mineOnly ? 'i dina ärenden de närmaste 7 dagarna' : 'de närmaste 7 dagarna'} />
        <${ui.Kpi} label="Alla fyra rätt" value=${`${full} av ${ongoing.length}`} sub="pågående praktikplatser" tone=${full < ongoing.length ? 'watch' : ''} />
      </div>
      ${upcoming.length > 0 && html`<${ui.Card} title=${mineOnly ? 'Dina uppföljningar de närmaste 7 dagarna' : 'Uppföljningar de närmaste 7 dagarna'} icon="calendar" flush>
        <div class="list">${upcoming.slice(0, 6).map(({ p, x }) => { const c = sel.caseById(p.caseId); const ok = canSeeCase(c, role);
          return html`<button type="button" key=${`${p.id}:${x}`} class="list-item clickable" onClick=${() => MM.nav('praktik.arbetsgivare', { employerId: p.employerId })}>
            <${I} name="calendar" /><span class="li-main"><span class="li-title">${d.fmtWeekday(x)} · ${empName(p.employerId)}</span>
            <span class="li-sub">${ok ? `${sel.displayName(c, role)} · ${c.number}` : whoLabel(c, role)}</span></span><${RightsBadge} pl=${p} /></button>`; })}</div>
      <//>`}
      <div class="row" style="align-items:flex-end">
        <div style="flex:1 1 260px"><${ui.Field} id="emp-q" label="Sök arbetsgivare"><${ui.Input} id="emp-q" type="search" value=${q} onInput=${setQ} placeholder="Företag eller kontaktperson" /><//></div>
        <div style="flex:1 1 220px"><${ui.Field} id="emp-area" label="Avtalsområde"><${ui.Select} id="emp-area" value=${area} onChange=${setArea} placeholder="Alla områden" options=${st.areas.filter((a) => a.contractId === 'c-bot').map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))} /><//></div>
      </div>
      <${ui.Card} title=${`Arbetsgivare (${rows.length})`} icon="building" flush>
        <${ui.Table} caption="Arbetsgivarregister" rows=${rows} empty="Inga arbetsgivare matchar sökningen." onRowClick=${(r) => MM.nav('praktik.arbetsgivare', { employerId: r.id })} columns=${[
          { key: 'name', label: 'Företag', render: (r) => html`<span class="strong">${r.name}</span><div class="cell-sub">${r.orgNr || 'Organisationsnummer saknas'}</div>` },
          { key: 'contact', label: 'Kontaktperson', render: (r) => html`${r.contactName || '–'}${r.phone && html`<div class="cell-sub">${r.phone}</div>`}` },
          { key: 'areas', label: 'Avtalsområden', render: (r) => html`<span class="row-sm">${r.areas.map((a) => html`<${ui.Badge} key=${a} tone="outline" title=${sel.areaName(a)}>${a}<//>`)}</span>` },
          { key: 'pl', label: 'Praktik', nowrap: true, render: (r) => html`<span class="strong">${r.ongoing} pågående</span><div class="cell-sub">${r.total} totalt</div>` },
          { key: 'next', label: 'Nästa uppföljning', nowrap: true, render: (r) => (r.next ? d.fmtDate(r.next) : '–') },
          { key: 'go', label: '', render: () => html`<${I} name="chevron-right" />` },
        ]} />
      <//>
      <${ui.DemoNote}>Arbetsgivarregistret och praktikplatserna med de fyra rätten byggs i utvecklingsfas 3. Arbetsgivarkontakter räknas redan i fas 1 i statistiken och i veckoavstämningen.<//>
      ${adding && html`<${AddEmployer} onClose=${() => setAdding(false)} />`}
    <//>`;
  };

  const PlacementCard = ({ pl, role }) => {
    const c = sel.caseById(pl.caseId); const a = c ? sel.access(c, role) : 'none';
    const canEdit = ['full', 'team'].includes(a);
    const [date, setDate] = useState('');
    const today = d.today(); const fr = pl.fourRights || {}; const done = rightsDone(pl);
    const upcoming = (pl.followUpDates || []).filter((x) => x >= today);
    return html`<${ui.Card} title=${whoLabel(c, role)} icon="user" tone=${pl.status === 'ongoing' && done < 4 ? 'red' : undefined}
      actions=${html`<${RightsBadge} pl=${pl} />${pl.status === 'ongoing' ? html`<${ui.Badge} tone="blue" icon="activity">Pågår<//>` : html`<${ui.Badge} tone="grey" icon="check-square">Avslutad<//>`}`}
      foot=${c.referrerId === 'k-maria' ? html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.deltagare" params=${{ caseId: c.id }} label="Se från kundens håll" />` : null}>
      <div class="stack">
        <div class="row-sm small muted"><${ui.CaseLink} caseId=${c.id} /><span aria-hidden="true">·</span><span>${d.fmtDate(pl.startsOn)} – ${d.fmtDate(pl.endsOn)}</span><span aria-hidden="true">·</span><span>Handledare ${pl.supervisorName || '–'}</span></div>
        <${KV} items=${[['Arbetsuppgifter', pl.tasks], ['Mål', pl.goals || '–']]} />
        <${Group} id=${`fr-${pl.id}`} legend=${`De fyra rätten – ${done} av 4 uppfyllda`} help=${canEdit ? 'Bocka i när kravet är uppfyllt. Ändringen loggas.' : 'Bara teamet i ärendet kan ändra.'}>
          <div class="grid-2" style="gap:0 20px">${RIGHTS.map(([k, label, help]) => html`<${ui.Check} key=${k} id=${`fr-${pl.id}-${k}`} checked=${!!fr[k]} disabled=${!canEdit} onChange=${(v) => MM.dispatch('employer.setRight', { placementId: pl.id, right: k, value: v })}>
            <span><span class="strong">${label}</span><br /><span class="small muted">${help}</span></span><//>`)}</div>
        <//>
        <div class="stack-sm">
          <div class="row-sm"><span class="label-caps">Uppföljning</span>
            ${(pl.followUpDates || []).length === 0 ? html`<span class="muted small">Inga datum planerade</span>` : pl.followUpDates.map((x) => html`<${ui.Badge} key=${x} tone=${x < today ? 'grey' : x === today ? 'dark' : 'outline'} icon=${x < today ? 'check' : 'calendar'}>${d.fmtDate(x)} · ${x < today ? 'passerad' : x === today ? 'i dag' : 'planerad'}<//>`)}</div>
          ${pl.status === 'ongoing' && upcoming.length === 0 && html`<p class="small strong"><${I} name="alert-circle" cls="ic-red" /> Ingen kommande uppföljning är planerad.</p>`}
          ${canEdit && pl.status === 'ongoing' && html`<div class="row" style="align-items:flex-end">
            <div style="flex:0 1 220px"><${ui.Field} id=${`fu-${pl.id}`} label="Nytt uppföljningsdatum"><${ui.Input} id=${`fu-${pl.id}`} type="date" value=${date} onInput=${setDate} /><//></div>
            <${ui.Btn} kind="secondary" icon="plus" disabled=${!date} onClick=${() => { const r = MM.dispatch('employer.addFollowUp', { placementId: pl.id, date }); if (!r || !r.error) { MM.toast(`Uppföljning ${d.fmtDate(date)} är planerad.`, 'blue'); setDate(''); } }}>Lägg till uppföljning<//>
          </div>`}
        </div>
      </div>
    <//>`;
  };

  const EmployerDetail = ({ id, role }) => {
    const st = MM.useStore(); const e = st.employers.find((x) => x.id === id);
    const [show, setShow] = useState('ongoing'); const [limit, setLimit] = useState(6);
    if (!e) return html`<${ui.Page} title="Arbetsgivaren finns inte" crumbs=${[{ label: 'Arbetsgivare och praktik', view: 'praktik.arbetsgivare' }]}><${ui.Empty} icon="building" title="Arbetsgivaren finns inte i registret" action=${html`<${ui.Btn} icon="arrow-left" onClick=${() => MM.nav('praktik.arbetsgivare', {})}>Till registret<//>`} /><//>`;
    const ps = st.placements.filter((p) => p.employerId === e.id);
    const on = ps.filter((p) => p.status === 'ongoing'); const done = ps.filter((p) => p.status !== 'ongoing');
    const list = show === 'ongoing' ? on : done;
    const mine = list.filter((p) => canSeeCase(sel.caseById(p.caseId), role)).sort((a, b) => rightsDone(a) - rightsDone(b) || (a.startsOn < b.startsOn ? 1 : -1));
    const others = list.filter((p) => !mine.includes(p)).sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));
    const scope = ['samordnare', 'avtalsansvarig'].includes(role) ? 'Praktikplatser' : 'Praktikplatser i dina ärenden';
    return html`<${ui.Page} title=${e.name} eyebrow=${html`<span class="row-sm">Arbetsgivare <${ui.BuildPhase} fas=${3} /></span>`} crumbs=${[{ label: 'Arbetsgivare och praktik', view: 'praktik.arbetsgivare' }, { label: e.name }]}>
      <${ui.Card} title="Kontaktuppgifter" icon="building">
        <div class="grid-2" style="gap:0 32px">
          <${KV} items=${[['Organisationsnummer', e.orgNr || '–'], ['Kontaktperson', e.contactName || '–'], ['Telefon', e.phone || '–'], ['E-post', e.email || '–']]} />
          <${KV} items=${[['Avtalsområden', html`<span class="row-sm">${e.areas.map((a) => html`<${ui.Badge} key=${a} tone="outline">${sel.areaName(a)}<//>`)}</span>`], ['Praktikplatser', `${on.length} pågående, ${ps.length} totalt`], e.createdAt && ['Tillagd', `${d.fmtDate(e.createdAt)} av ${MM.personName(e.createdBy)}`]]} />
        </div>
      <//>
      <div class="row-between">
        <${ui.Seg} ariaLabel="Visa praktikplatser" value=${show} onChange=${(v) => { setShow(v); setLimit(6); }} options=${[{ value: 'ongoing', label: `Pågående (${on.length})` }, { value: 'done', label: `Avslutade (${done.length})` }]} />
        <span class="small muted">Ofullständiga fyra rätt visas först.</span>
      </div>
      ${list.length === 0 && html`<${ui.Card}><${ui.Empty} icon="briefcase" title=${show === 'ongoing' ? 'Ingen pågående praktik' : 'Inga avslutade praktikplatser'}>Praktikplatser läggs till från deltagarens ärende.<//><//>`}
      ${mine.length > 0 && html`<${ui.Section} title=${`${scope} (${mine.length})`}>
        <div class="stack">${mine.slice(0, limit).map((p) => html`<${PlacementCard} key=${p.id} pl=${p} role=${role} />`)}
          ${mine.length > limit && html`<div><${ui.Btn} kind="secondary" icon="chevron-down" onClick=${() => setLimit(limit + 6)}>Visa fler (${mine.length - limit} till)<//></div>`}</div>
      <//>`}
      ${others.length > 0 && html`<${ui.Section} title=${`Praktikplatser i andra team (${others.length})`}>
        <${ui.Card} flush foot=${html`<span class="small muted">Deltagarnas namn och ärendenummer visas bara för teamet i ärendet.</span>`}>
          <${ui.Table} caption="Praktikplatser i andra team" rows=${others} columns=${[
            { key: 'who', label: 'Deltagare', render: (p) => html`<span class="row-sm" style="flex-wrap:nowrap"><${I} name="lock" /><span>${whoLabel(sel.caseById(p.caseId), role)}</span></span>` },
            { key: 'period', label: 'Period', nowrap: true, render: (p) => `${d.fmtDateShort(p.startsOn)} – ${d.fmtDate(p.endsOn)}` },
            { key: 'tasks', label: 'Arbetsuppgifter', render: (p) => p.tasks },
            { key: 'fr', label: 'Fyra rätt', render: (p) => html`<${RightsBadge} pl=${p} />` },
          ]} />
        <//>
      <//>`}
    <//>`;
  };

  const PraktikView = ({ params, role }) => (params && params.employerId ? html`<${EmployerDetail} key=${role} id=${params.employerId} role=${role} />` : html`<${EmployerList} key=${role} role=${role} />`);
  MM.registerView('praktik.arbetsgivare', { title: (p) => { const e = p && p.employerId ? S().employers.find((x) => x.id === p.employerId) : null; return e ? e.name : 'Arbetsgivare och praktik'; }, roles: ['samordnare', 'avtalsansvarig', 'coach', 'handledare'], component: PraktikView });
})();
