// views/arenden.js – ärendelistan (arenden.lista), deltagarkortet (arende.kort) och handledarens startsida (hand.start).
// Behörighet via sel.access/sel.displayName. Chef och systemadmin läser bara. Handledare ser inte coachens anteckningar.
// Inga egna domänåtgärder behövs – allt ändras via de gemensamma åtgärderna i 03-domain.js.
(() => {
  const { html, useState, useEffect, useMemo, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const S = () => MM.store.state;
  const cls = MM.cls;

  // ---------------------------------------------------------------- Stilar (bara MB-tokens)
  (() => {
    try {
      if (document.getElementById('arn-style')) return;
      const el = document.createElement('style'); el.id = 'arn-style';
      el.textContent = `
.arn-narrow{display:none}
@media (max-width:1240px){.arn-wide{display:none}.arn-narrow{display:block}}
.arn-filters{display:grid;gap:12px 16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));align-items:end}
.arn-filters .arn-span{grid-column:1/-1}
.arn-phase{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:118px;max-width:170px}
.arn-phase .phasebar{width:100%;max-width:150px}
.arn-flags{display:flex;flex-wrap:wrap;gap:4px}
.arn-flags .badge{font-size:.75rem;padding:2px 7px}
.arn-restricted td{background:var(--surface-sub)}
.arn-facts{display:grid;gap:14px 20px;grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr));margin:0}
@media (max-width:620px){.arn-facts{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px}}
.arn-facts dt{font-size:.8125rem;font-weight:600;color:var(--fg-muted);line-height:1.3}
.arn-facts dd{margin:3px 0 0;min-width:0;overflow-wrap:anywhere;hyphens:auto;line-height:1.4}
.arn-section+.arn-section{border-top:1px solid var(--line);padding-top:16px}
@media (min-width:621px){.arn-tabs .tabs{flex-wrap:wrap;overflow-x:visible}}
.arn-tabs .tab{padding:10px 12px}
.arn-tabs .table th{white-space:normal;vertical-align:bottom}
.arn-tabs .table td,.arn-tabs .table th{padding:9px 8px}
.arn-tabs .table td:first-child,.arn-tabs .table th:first-child{padding-left:16px}
.arn-label{font-size:var(--fs-label);font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--fg-muted);margin-bottom:8px}
.arn-mini{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.arn-mini li{display:flex;gap:8px;align-items:flex-start;min-width:0}
.arn-mini li .ic{margin-top:2px}
.arn-thread{display:flex;flex-direction:column;gap:12px}
.arn-msg{max-width:min(620px,94%);padding:10px 14px;border-radius:10px;border:1px solid var(--line);display:flex;flex-direction:column;gap:4px;min-width:0}
.arn-msg.mine{align-self:flex-end;background:var(--surface-sub)}
.arn-msg.theirs{align-self:flex-start;background:var(--bla-ton);border-color:var(--bla)}
.arn-msg .arn-body{white-space:pre-wrap;overflow-wrap:anywhere}
.arn-four{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.arn-four-item{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1.5px solid var(--line);border-radius:6px;min-width:0}
.arn-four-item.missing{border:2px solid var(--rod)}
.arn-four-item.missing>span>.ic{color:var(--rod)}
.arn-phasewrap{display:flex;flex-direction:column;gap:6px}
.arn-phasewrap .phasebar .ph{height:10px}
.arn-caselink{background:none;border:0;padding:0;font:inherit;font-weight:800;font-size:1.0625rem;color:var(--antracit);text-align:left;cursor:pointer;text-decoration:underline;text-underline-offset:3px;min-height:var(--tap);display:inline-flex;align-items:center;max-width:100%;overflow-wrap:anywhere}
.arn-kpi-row{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))}
@media (max-width:620px){.arn-kpi-row{grid-template-columns:repeat(2,minmax(0,1fr))}.arn-kpi-row .kpi{padding:12px}.arn-kpi-row .kpi-value{font-size:1.5rem}}
.arn-table th{white-space:normal;vertical-align:bottom}
.arn-table td,.arn-table th{padding:9px 6px}
.arn-table .arn-flags{max-width:150px}
.arn-table td:first-child,.arn-table th:first-child{padding-left:16px}
.arn-sort{display:flex;align-items:center;gap:8px}
.arn-sort select{min-height:var(--tap);padding:6px 10px;width:auto;max-width:100%;font-size:.9375rem}
.arn-suggest{min-height:var(--tap);padding:6px 10px;white-space:normal;text-align:left;height:auto;max-width:100%}
.arn-card-actions{display:flex;flex-wrap:wrap;gap:8px;min-width:0;max-width:100%}
.arn-card-actions .btn,.arn-wrapbtn{white-space:normal;text-align:left;height:auto;max-width:100%}
.arn-root .btn{white-space:normal;max-width:100%;min-width:var(--tap)}
.arn-root .card-head .spacer+*{max-width:100%}
`;
      document.head.appendChild(el);
    } catch (e) { /* ingen head i testmiljö */ }
  })();

  // ---------------------------------------------------------------- Hjälpare
  const PAGE = 50;
  const CASE_ROLES = ['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'admin'];
  const READ_ONLY = ['chef', 'admin'];
  const STATUS_KEYS = ['received', 'acknowledged', 'confirmed', 'active', 'paused', 'closed', 'declined'];
  const WAITING = ['received', 'acknowledged', 'confirmed'];
  const PNR_RE = /\b(\d{6}|\d{8})[-+]?\d{4}\b/;
  const SRC = { email: 'mejl', portal: 'portalen', phone: 'telefon' };
  const GOAL = { yes: 'Ja', partly: 'Delvis', no: 'Nej' };
  const MODE = { fysiskt: 'Fysiskt möte', telefon: 'Telefon', video: 'Video' };
  const RESULT = { result: 'Resultat', no_result: 'Ej resultat', excluded: 'Räknas inte i nämnaren' };
  const PLACEMENT = { ongoing: 'Pågår', completed: 'Avslutad', planned: 'Planerad' };
  const KIND = { möte: ['users', 'Coachmöte'], yrkesmoment: ['tool', 'Yrkesmoment'], praktikdag: ['briefcase', 'Praktikdag'], arbetsgivarbesök: ['building', 'Arbetsgivarbesök'], annat: ['circle', 'Annat'] };
  const CONTACT_KINDS = ['intervju_arbetsgivarkontakt', 'arbetserbjudande', 'praktik_startad', 'arbete_paborjat'];
  const FOUR = [
    ['uppgift', 'Arbetsuppgifter', 'Kopplade till yrkesspåret.'],
    ['handledning', 'Handledning', 'Handledare hos arbetsgivaren med mål och ansvar.'],
    ['timing', 'Tidpunkt', 'Rätt tidpunkt: coachen bedömer att deltagaren är redo för krav, tempo och rutiner.'],
    ['uppfoljning', 'Uppföljning', 'Planerade datum. Återkopplingen dokumenteras och leder till nästa steg.'],
  ];
  const ATT = {
    present: ['blue', 'check', 'Närvarande'], late: ['bluetone', 'clock', 'Sen'], absent_valid: ['grey', 'minus-circle', 'Giltig frånvaro'],
    absent_invalid: ['red', 'x-circle', 'Ogiltig frånvaro'], none: ['outline', 'help', 'Saknar registrering'],
  };
  const AttBadge = ({ status }) => { const [tone, icon, label] = ATT[status] || ATT.none; return html`<${ui.Badge} tone=${tone} icon=${icon}>${label}<//>`; };

  /** Faktarutnät: etikett ovanför värdet (tätare och tydligare än två kolumner i smala kort). */
  const Facts = ({ items }) => html`<dl class="arn-facts">${items.filter(Boolean).map(([k, v]) => html`<div key=${k}><dt>${k}</dt><dd>${v == null || v === '' ? '–' : v}</dd></div>`)}</dl>`;
  const thisYear = () => d.today().slice(0, 4);
  /** Datum utan år om det är innevarande år. */
  const fd = (s) => (!s ? '–' : String(s).slice(0, 4) === thisYear() ? d.fmtDateShort(s) : d.fmtDate(s));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const withDot = (s) => (/[.!?]$/.test(String(s).trim()) ? String(s).trim() : `${String(s).trim()}.`);
  const clip = (s, n = 90) => (!s ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const canOpen = (view, role = MM.role()) => { const v = MM.views[view]; return !!v && (!Array.isArray(v.roles) || v.roles.includes(role)); };
  const isProt = (c) => { const p = sel.person(c); return !!(p && p.protectedIdentity); };
  const custUser = (id) => (S().customerUsers || []).find((u) => u.id === id) || null;
  const firstName = (name) => String(name || '').split(' ')[0];
  const isManager = (role) => role === 'samordnare' || role === 'avtalsansvarig';
  /** Kundens roll som faktiskt har åtkomst till ärendet (för perspektivbytet): beställande handläggare i första hand,
   *  annars kommunens chef. Skyddade ärenden: bara beställande handläggare – finns den inte som roll döljs bytet (null). */
  const CUST_ROLES = ['kommun_handlaggare', 'kommun_chef'];
  const custRole = (c) => CUST_ROLES.find((r) => sel.access(c, r, MM.roleDef(r).personaId) === 'customer') || null;
  const CUST_WHO = { kommun_handlaggare: 'kommunen', kommun_chef: 'kommunens chef' };
  /** Perspektivbyte till kundens ärendesida på rätt flik. label = (vem) => text. Visas inte om ingen kundroll har åtkomst. */
  const CustSwitch = ({ c, tab, label }) => {
    const r = custRole(c); if (!r) return null;
    return html`<${ui.PerspectiveSwitch} role=${r} view="kom.deltagare" params=${tab ? { caseId: c.id, tab } : { caseId: c.id }} label=${label(CUST_WHO[r])} />`;
  };
  /** Avtalets tidsgränser som text (läses från MM.cfg(), inte hårdkodat). */
  const slaCfg = (key) => (MM.cfg().sla || []).find((x) => x.key === key) || {};
  const daysText = (n) => (n % 7 === 0 ? (n === 7 ? 'en vecka' : `${n / 7} veckor`) : `${n} dagar`);
  const firstMeetingText = () => { const w = slaCfg('forsta_mote').within || {}; return w.days ? `inom ${daysText(w.days)} från beställningen` : 'så snart som möjligt efter beställningen'; };
  const regDueText = () => { const x = slaCfg('veckorapport_registrering'); return x.time ? `${d.WD[x.weekday || 0]} ${x.time.replace(':', '.')}` : null; };
  /** Får rollen ändra i ärendet? Chef och systemadmin läser bara. Coachen bara i egna ärenden. */
  const canEditCase = (c, role, access) => access === 'full' && (isManager(role) || (role === 'coach' && c.leadCoachId === MM.currentPersonaId()));
  /** De fyra senaste hela ISO-veckorna. */
  const last4Weeks = () => { const from = d.addDays(d.monday(d.today()), -28); const to = d.addDays(d.monday(d.today()), -1); return { from, to, label: `v. ${d.isoWeek(from).week}–${d.isoWeek(to).week}` }; };
  const nextMeeting = (c) => { const now = d.now(); const a = sel.activitiesOf(c.id).find((x) => x.kind === 'möte' && x.startsAt >= now); return a || (c.firstMeetingAt && c.firstMeetingAt >= now ? { startsAt: c.firstMeetingAt, location: `Miljonbemanning ${c.location || ''}`.trim(), kind: 'möte', first: true } : null); };
  const actLabel = (a) => (KIND[a.kind] || KIND.annat)[1];
  const actIcon = (a) => (KIND[a.kind] || KIND.annat)[0];
  const employer = (id) => S().employers.find((e) => e.id === id) || null;
  const ciContacts = (caseId) => sel.checkInsOf(caseId).filter((x) => x.status === 'approved').reduce((s, x) => { const n = x.employerContacts && x.employerContacts.count; return s + (n === '2+' ? 2 : Number(n) || 0); }, 0);

  // ---- Flaggor (sel.alerts för aktuell roll). Coach och handledare ser aldrig eskaleringar till chef.
  const FLAG = {
    stuck: ['clock', 'Fastnat'], absence: ['x-circle', 'Upprepad frånvaro'], first_meeting: ['calendar', 'Möte ej bokat'], no_progress: ['bell', 'Ingen progression'],
    no_progress_escalated: ['flag', 'Eskalerad'], report_overdue: ['file', 'Rapport försenad'], unbilled: ['card', 'Ofakturerat'], pulse_contact: ['phone', 'Vill bli kontaktad'], ai_draft: ['sparkles', 'AI-utkast'],
  };
  const SEV = { critical: { tone: 'red', label: 'Kritisk', icon: 'alert' }, warning: { tone: 'grey', label: 'Varning', icon: 'alert-circle' }, info: { tone: 'outline', label: 'Information', icon: 'info' } };
  const SEV_RANK = { critical: 0, warning: 1, info: 2 };
  const HIDE_FOR_TEAM = ['no_progress_escalated', 'pulse_low'];
  const alertsFor = (role) => {
    let xs = sel.alerts({ role, personaId: MM.currentPersonaId() });
    if (role === 'coach' || role === 'handledare') xs = xs.filter((a) => !HIDE_FOR_TEAM.includes(a.kind));
    return xs;
  };
  const FlagBadges = ({ list }) => (list && list.length
    ? html`<div class="arn-flags">${list.map((a) => { const f = FLAG[a.kind] || ['flag', a.title]; const s = SEV[a.severity] || SEV.info; return html`<${ui.Badge} tone=${s.tone} icon=${f[0]} title=${`${s.label}: ${a.title}`}>${f[1]}<//>`; })}</div>`
    : html`<span class="small muted">–</span>`);

  const AttCell = ({ st }) => {
    const reg = st.planned - st.unregistered;
    if (reg <= 0) return html`<span class="small muted">${st.unregistered > 0 ? `${st.unregistered} saknar registrering` : 'Inga tillfällen'}</span>`;
    return html`<div><span class="strong">${fmt.pct(st.rate, 0)}</span><div class="cell-sub">${st.present + st.late} av ${reg}${st.unregistered > 0 ? ` · ${st.unregistered} saknas` : ''}</div></div>`;
  };

  // ================================================================= ÄRENDELISTAN
  const ListView = ({ params = {}, role }) => {
    MM.useStore();
    const f0 = params.filter || '';
    const [q, setQ] = useState(params.q || '');
    const [status, setStatus] = useState(params.status || (f0 === 'aktiva' ? 'active' : f0 === 'oppna' ? 'open' : 'alla'));
    const [coach, setCoach] = useState(params.coachId || '');
    const [area, setArea] = useState(params.area || '');
    const [phase, setPhase] = useState(params.phase ? String(params.phase) : '');
    const [onlyFlags, setOnlyFlags] = useState(f0 === 'flaggor');
    const [onlyProt, setOnlyProt] = useState(f0 === 'skyddade');
    const [sort, setSort] = useState(f0 === 'flaggor' ? 'flaggor' : 'nyast');
    const [limit, setLimit] = useState(PAGE);
    const ver = MM.store.version;
    const all = useMemo(() => sel.visibleCases(role), [ver, role]);
    const alerts = useMemo(() => alertsFor(role), [ver, role]);
    const byCase = useMemo(() => MM.groupBy(alerts.filter((a) => a.caseId), (a) => a.caseId), [alerts]);
    // Olästa meddelanden från kommunen till den inloggade (samma regel som fliken Meddelanden). Chef och systemadmin läser bara.
    const me = MM.currentPersonaId();
    const unreadBy = useMemo(() => {
      const m = {}; if (READ_ONLY.includes(role)) return m;
      for (const x of S().messages) if (String(x.senderId).startsWith('k-') && !(x.readBy || []).includes(me)) m[x.caseId] = (m[x.caseId] || 0) + 1;
      return m;
    }, [ver, role, me]);
    const unreadOf = (c) => (sel.access(c, role) === 'full' ? unreadBy[c.id] || 0 : 0);
    const [onlyUnread, setOnlyUnread] = useState(false);
    const w4 = last4Weeks();
    const upd = (fn) => (v) => { fn(v); setLimit(PAGE); };
    const restricted = (c) => sel.access(c, role) === 'restricted';
    const customer = MM.contract().customerName;
    const readOnly = READ_ONLY.includes(role);
    const protCount = all.filter(isProt).length;
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s-]/g, '');
    const needle = norm(q);

    const rows = all.filter((c) => {
      if (status === 'open' && ['closed', 'declined'].includes(c.status)) return false;
      if (!['alla', 'open'].includes(status) && c.status !== status) return false;
      if (onlyProt && !isProt(c)) return false;
      if (onlyFlags && !byCase[c.id]) return false;
      if (onlyUnread && !unreadOf(c)) return false;
      const r = restricted(c);
      if (r && (coach || area || phase)) return false; // skyddade ärenden avslöjar inga detaljer via filter
      if (coach && c.leadCoachId !== coach) return false;
      if (area && c.primaryArea !== area) return false;
      if (phase && String(c.phase) !== phase) return false;
      if (needle && !norm(`${c.number} ${sel.displayName(c, role)}`).includes(needle)) return false;
      return true;
    });
    const sevOf = (id) => Math.min(9, ...(byCase[id] || []).map((a) => SEV_RANK[a.severity] ?? 9));
    const newest = (a, b) => (a.referredAt < b.referredAt ? 1 : a.referredAt > b.referredAt ? -1 : 0);
    const sorters = {
      nyast: newest,
      flaggor: (a, b) => sevOf(a.id) - sevOf(b.id) || newest(a, b),
      slut: (a, b) => { const ka = ['closed', 'declined'].includes(a.status) ? 'z' : (a.plannedEnd || 'y'); const kb = ['closed', 'declined'].includes(b.status) ? 'z' : (b.plannedEnd || 'y'); return ka < kb ? -1 : ka > kb ? 1 : newest(a, b); },
      nummer: (a, b) => (a.number < b.number ? -1 : 1),
    };
    rows.sort(sorters[sort] || newest);
    const shown = rows.slice(0, limit).map((c) => {
      const r = restricted(c);
      return { c, r, lc: r ? null : sel.latestCheckIn(c.id), ast: r ? null : sel.attendanceStats(c.id, w4.from, w4.to), flags: r ? null : byCase[c.id], unread: r ? 0 : unreadOf(c) };
    });
    const anyFilter = q || status !== 'alla' || coach || area || phase || onlyFlags || onlyProt || onlyUnread;
    const clear = () => { setQ(''); setStatus('alla'); setCoach(''); setArea(''); setPhase(''); setOnlyFlags(false); setOnlyProt(false); setOnlyUnread(false); setLimit(PAGE); };
    const nUnread = all.filter((c) => unreadOf(c) > 0).length;
    const UnreadBadge = ({ n }) => (n > 0 ? html`<${ui.Badge} tone="dark" icon="message" title="Olästa meddelanden från kommunen">${n === 1 ? 'Nytt meddelande' : `${n} nya meddelanden`}<//>` : null);

    const nActive = all.filter((c) => c.status === 'active').length;
    const nWaiting = all.filter((c) => WAITING.includes(c.status)).length;
    const nClosed = all.filter((c) => c.status === 'closed').length;
    const nFlag = all.filter((c) => byCase[c.id] && !restricted(c)).length;
    const showCoach = !['coach', 'handledare'].includes(role);
    const title = role === 'coach' ? 'Mina ärenden' : 'Ärenden';
    const lead = {
      coach: 'Ärenden där du är huvudcoach eller ingår i teamet. Klicka på en rad för att öppna deltagarkortet.',
      handledare: 'Du ser bara ärenden du är tilldelad. Klicka på en rad för att öppna deltagarkortet.',
      chef: `Alla ärenden i avtalet med ${customer}. Du ser dem i läsläge.`,
      admin: `Alla ärenden i avtalet med ${customer}. Du ser dem i läsläge.`,
    }[role] || `Alla ärenden i avtalet med ${customer}. Klicka på en rad för att öppna deltagarkortet.`;

    const open = (c) => MM.nav('arende.kort', { caseId: c.id });
    const statusOpts = [{ value: 'alla', label: 'Alla statusar' }, { value: 'open', label: 'Öppna (inte avslutade)' }, ...STATUS_KEYS.map((s) => ({ value: s, label: sel.statusLabel(s) }))];
    const coachOpts = sel.coaches().map((u) => ({ value: u.id, label: u.name }));
    const areaOpts = S().areas.filter((a) => a.contractId === 'c-bot').map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }));
    const phaseOpts = MM.cfg().phases.map((p) => ({ value: String(p.no), label: `Fas ${p.no} · ${p.name}` }));
    const sortOpts = [{ value: 'nyast', label: 'Senast beställda först' }, { value: 'flaggor', label: 'Flaggade först' }, { value: 'slut', label: 'Planerat slut – närmast först' }, { value: 'nummer', label: 'Ärendenummer' }];

    const tableRow = ({ c, r, lc, ast, flags, unread }) => {
      if (r) {
        return html`<tr key=${c.id} class="arn-restricted"><td class="nowrap"><span class="strong mono">${c.number}</span></td>
          <td colspan="7"><span class="row-sm"><${I} name="lock" /><span class="strong">Skyddade personuppgifter – ingen åtkomst</span></span>
          <div class="cell-sub">Bara namngiven huvudcoach och avtalsansvarig kan öppna ärendet.</div></td></tr>`;
      }
      const start = c.startDate || c.firstMeetingAt || c.desiredStart;
      return html`<tr key=${c.id} class="clickable" tabIndex="0" onClick=${() => open(c)} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(c); } }}>
        <td class="nowrap"><span class="strong mono">${c.number}</span></td>
        <td style="min-width:150px"><div class="strong">${sel.displayName(c, role)}</div>
          <div class="cell-sub">${sel.areaName(c.primaryArea)}${c.vocationalTrack ? ` · ${c.vocationalTrack}` : ''}</div>
          ${isProt(c) && html`<div style="margin-top:4px"><${ui.Badge} tone="dark" icon="lock">Skyddade personuppgifter<//></div>`}</td>
        <td title=${sel.phaseLabel(c.phase)}><div class="arn-phase"><${ui.CaseStatus} status=${c.status} /><${ui.PhaseBar} phase=${c.phase} /><span class="cell-sub">Fas ${c.phase} · ${sel.phaseName(c.phase)}</span></div></td>
        <td>${c.leadCoachId ? MM.personName(c.leadCoachId) : html`<span class="muted">Inte tilldelad</span>`}</td>
        <td class="nowrap">${fd(start)} –<br />${fd(c.endDate || c.plannedEnd)}${!c.startDate && html`<div class="cell-sub">${c.firstMeetingAt ? 'planerad start' : 'önskad start'}</div>`}</td>
        <td>${lc ? html`<${ui.Status} value=${lc.overallStatus} short /><div class="cell-sub">${fd(lc.heldAt)}</div>` : html`<span class="small muted">Ingen ännu</span>`}</td>
        <td><${AttCell} st=${ast} /></td>
        <td>${unread > 0 ? html`<div class="arn-flags"><${UnreadBadge} n=${unread} />${flags && flags.length ? html`<${FlagBadges} list=${flags} />` : ''}</div>` : html`<${FlagBadges} list=${flags} />`}</td>
      </tr>`;
    };
    const listItem = ({ c, r, lc, ast, flags, unread }) => (r
      ? html`<div class="list-item" key=${c.id}><${I} name="lock" size="lg" /><div class="li-main"><span class="strong mono">${c.number}</span><div class="li-title">Skyddade personuppgifter – ingen åtkomst</div><div class="li-sub">Bara namngiven huvudcoach och avtalsansvarig kan öppna ärendet.</div></div></div>`
      : html`<button type="button" class="list-item clickable" key=${c.id} onClick=${() => open(c)}>
          <div class="li-main">
            <div class="row-sm"><span class="strong mono">${c.number}</span><${ui.CaseStatus} status=${c.status} />${isProt(c) && html`<${ui.Badge} tone="dark" icon="lock">Skyddad<//>`}</div>
            <div class="li-title">${sel.displayName(c, role)}</div>
            <div class="li-sub">${sel.areaName(c.primaryArea)} · Fas ${c.phase} · ${c.leadCoachId ? MM.personName(c.leadCoachId) : 'Ingen coach ännu'}</div>
            <div class="li-sub">Närvaro ${w4.label}: ${ast.planned - ast.unregistered > 0 ? fmt.pct(ast.rate, 0) : 'inga tillfällen'}</div>
            ${(unread > 0 || flags) && html`<div class="arn-flags"><${UnreadBadge} n=${unread} />${flags && html`<${FlagBadges} list=${flags} />`}</div>`}
          </div>
          <div class="li-side">${lc ? html`<${ui.Status} value=${lc.overallStatus} short />` : html`<span class="small muted">Ej bedömd</span>`}</div>
        </button>`);

    return html`<${ui.Page} title=${title} eyebrow=${readOnly ? 'Läsläge' : MM.roleDef(role).label} lead=${lead}
      actions=${html`${readOnly && html`<${ui.Badge} tone="outline" icon="eye">Läsläge – inga ändringar<//>`}<${ui.PerspectiveSwitch} role="kommun_chef" view="kom.deltagare" params=${{}} label="Se kommunens lista" />`}>
      ${onlyProt && html`<${ui.Notice} tone="info" icon="shield" title="Skyddade personuppgifter – vem ser vad?">
        <div class="stack-sm">
          <div>Ärenden med skyddade personuppgifter visas med namn bara för <b>namngiven huvudcoach</b> och <b>avtalsansvarig</b>. Samordnare, chef och systemadmin ser att ärendet finns – så att det kan planeras och följas upp – men inte vem det gäller, och kan inte öppna deltagarkortet. Övriga coacher och handledare ser inte ärendet alls.</div>
          <div>Ingen adress lagras, inga SMS eller mejl skickas till deltagaren och AI används aldrig.</div>
          <div class="strong">${role === 'avtalsansvarig' ? 'Du är avtalsansvarig och ser därför namn och deltagarkort.' : ['samordnare', 'chef', 'admin'].includes(role) ? 'I din roll ser du bara ärendenumret.' : 'Du är inte namngiven i något sådant ärende och ser därför inga.'}</div>
          <div class="row">${role === 'avtalsansvarig'
            ? html`<${ui.PerspectiveSwitch} role="samordnare" view="arenden.lista" params=${{ filter: 'skyddade' }} label="Jämför som samordnare" />`
            : html`<${ui.PerspectiveSwitch} role="avtalsansvarig" view="arenden.lista" params=${{ filter: 'skyddade' }} label="Jämför som avtalsansvarig" />`}</div>
        </div>
      <//>`}

      <div class="arn-kpi-row">
        <${ui.Kpi} label="Ärenden du ser" value=${fmt.num(all.length)} sub=${protCount > 0 ? `varav ${protCount} med skyddade personuppgifter` : 'enligt din behörighet'} />
        <${ui.Kpi} label="Pågår" value=${fmt.num(nActive)} sub="aktiva insatser" />
        <${ui.Kpi} label="Väntar på start" value=${fmt.num(nWaiting)} sub="mottagna eller bekräftade" />
        <${ui.Kpi} label="Med flaggor" value=${fmt.num(nFlag)} sub=${nFlag > 0 ? 'behöver uppmärksamhet' : 'inga flaggor för din roll'} tone=${nFlag > 0 ? 'watch' : undefined} />
      </div>

      <${ui.Card} title="Sök och filtrera" icon="filter">
        <div class="arn-filters">
          <div class="arn-span"><${ui.Field} label="Sök" id="arn-q" help="Ärendenummer eller namn. Det räcker med en del av numret, till exempel 0143.">
            <${ui.Input} id="arn-q" type="search" value=${q} onInput=${upd(setQ)} placeholder="BOT-26-0143 eller namn" /><//></div>
          <${ui.Field} label="Status" id="arn-status"><${ui.Select} id="arn-status" value=${status} onChange=${upd(setStatus)} options=${statusOpts} /><//>
          ${showCoach && html`<${ui.Field} label="Huvudcoach" id="arn-coach"><${ui.Select} id="arn-coach" value=${coach} onChange=${upd(setCoach)} placeholder="Alla coacher" options=${coachOpts} /><//>`}
          <${ui.Field} label="Avtalsområde" id="arn-area"><${ui.Select} id="arn-area" value=${area} onChange=${upd(setArea)} placeholder="Alla områden" options=${areaOpts} /><//>
          <${ui.Field} label="Fas" id="arn-phase"><${ui.Select} id="arn-phase" value=${phase} onChange=${upd(setPhase)} placeholder="Alla faser" options=${phaseOpts} /><//>
        </div>
        <div class="row" style="margin-top:8px;gap:4px 24px">
          <${ui.Check} id="arn-onlyflags" checked=${onlyFlags} onChange=${upd(setOnlyFlags)}>Bara ärenden med flaggor (${nFlag})<//>
          ${(nUnread > 0 || onlyUnread) && html`<${ui.Check} id="arn-onlyunread" checked=${onlyUnread} onChange=${upd(setOnlyUnread)}>Bara olästa meddelanden från kommunen (${nUnread})<//>`}
          ${(protCount > 0 || onlyProt) && html`<${ui.Check} id="arn-onlyprot" checked=${onlyProt} onChange=${upd(setOnlyProt)}>Bara skyddade personuppgifter (${protCount})<//>`}
          <span class="spacer"></span>
          ${anyFilter && html`<${ui.Btn} kind="ghost" icon="x" onClick=${clear}>Rensa filter<//>`}
        </div>
      <//>


      <${ui.Card} flush title=${`${fmt.num(rows.length)} ${rows.length === 1 ? 'ärende' : 'ärenden'}`} icon="list"
        actions=${rows.length > 1 && html`<div class="arn-sort"><label class="small strong" for="arn-sort">Sortera</label><${ui.Select} id="arn-sort" value=${sort} onChange=${setSort} options=${sortOpts} /></div>`}
        foot=${rows.length > 0 && html`<span class="small muted">Visar ${fmt.num(shown.length)} av ${fmt.num(rows.length)}</span><span class="spacer"></span>
          ${rows.length > limit && html`<${ui.Btn} kind="secondary" icon="chevron-down" onClick=${() => setLimit(limit + PAGE)}>Visa ${Math.min(PAGE, rows.length - limit)} till<//>`}
          ${rows.length > limit + PAGE && html`<${ui.Btn} kind="ghost" onClick=${() => setLimit(rows.length)}>Visa alla<//>`}`}>
        ${rows.length === 0
          ? html`<${ui.Empty} icon=${onlyProt ? 'shield' : 'search'} title=${onlyProt && protCount === 0 ? 'Du har inga ärenden med skyddade personuppgifter' : 'Inga ärenden matchar'}
              action=${anyFilter && html`<${ui.Btn} kind="secondary" icon="x" onClick=${clear}>Rensa filter<//>`}>
              ${onlyProt && protCount === 0 ? 'De syns bara för namngiven huvudcoach och avtalsansvarig.' : 'Ändra sökningen eller filtren.'}<//>`
          : html`<div class="arn-wide"><div class="table-wrap"><table class="table arn-table">
              <caption class="sr-only">Ärenden</caption>
              <thead><tr><th scope="col">Ärende</th><th scope="col">Deltagare och område</th><th scope="col">Status och fas</th><th scope="col">Huvud­coach</th><th scope="col">Start – slut</th><th scope="col">Senaste status</th><th scope="col" title=${`${fd(w4.from)}–${fd(w4.to)}`}>Närvaro ${w4.label}</th><th scope="col">Flaggor och meddelanden</th></tr></thead>
              <tbody>${shown.map(tableRow)}</tbody></table></div></div>
            <div class="arn-narrow"><div class="list">${shown.map(listItem)}</div></div>`}
      <//>
      <${ui.DemoNote}>Listan visar påhittade testdata. Senaste status är den samlade statusen i senaste godkända veckoavstämning. ${['coach', 'handledare'].includes(role) ? 'Flaggorna är de som gäller för din roll.' : 'Flaggorna är de som gäller för din roll – coacher och handledare ser aldrig eskaleringar till chef.'}${!READ_ONLY.includes(role) ? ' Olästa meddelanden från kommunen markeras i listan.' : ''}<//>
    <//>`;
  };

  // ================================================================= DELTAGARKORTET
  const ALL_TABS = ['oversikt', 'kartlaggning', 'avstamningar', 'narvaro', 'manad', 'handelser', 'avvikelser', 'praktik', 'rapporter', 'meddelanden', 'historik'];
  const TEAM_TABS = ['oversikt', 'narvaro', 'praktik', 'handelser'];
  const TAB_LABEL = { oversikt: 'Översikt', kartlaggning: 'Kartläggning', avstamningar: 'Avstämningar', narvaro: 'Närvaro', manad: 'Månadsbedömning', handelser: 'Händelser och utfall', avvikelser: 'Avvikelser', praktik: 'Praktik', rapporter: 'Rapporter', meddelanden: 'Meddelanden', historik: 'Historik' };

  const listCrumbs = (role) => [{ label: role === 'handledare' ? 'Mina tilldelade ärenden' : role === 'coach' ? 'Mina ärenden' : 'Ärenden', view: role === 'handledare' ? 'hand.start' : 'arenden.lista', params: {} }];

  const KortView = ({ params = {}, role }) => {
    MM.useStore();
    const c = params.caseId ? sel.caseById(params.caseId) : null;
    const access = c ? sel.access(c, role) : 'none';
    const ok = !!c && (access === 'full' || access === 'team');
    ui.useAuditView('case', ok ? c.id : null, 'case.view');
    ui.useAuditView('case', c && !ok ? c.id : null, 'case.view_denied');
    const crumbs = listCrumbs(role);
    if (!params.caseId) {
      return html`<${ui.Page} title="Deltagarkort" crumbs=${crumbs} lead="Välj ett ärende för att öppna deltagarkortet.">
        <${ui.Card}><${ui.Empty} icon="user" title="Inget ärende valt" action=${html`<${ui.Btn} kind="primary" icon="list" onClick=${() => MM.nav(crumbs[0].view, {})}>Till ärendelistan<//>`}>Deltagarkortet öppnas från ärendelistan eller från en länk i en notis.<//><//>
      <//>`;
    }
    if (!c) {
      return html`<${ui.Page} title="Ärendet hittades inte" crumbs=${crumbs}>
        <${ui.Card}><${ui.Empty} icon="search" title="Det finns inget ärende med den länken" action=${html`<${ui.Btn} kind="primary" icon="list" onClick=${() => MM.nav(crumbs[0].view, {})}>Till ärendelistan<//>`}>Ärendet kan ha tagits bort i demodatan. Sök i ärendelistan i stället.<//><//>
      <//>`;
    }
    if (!ok) return html`<${NoAccess} c=${c} access=${access} role=${role} crumbs=${crumbs} />`;
    return html`<${CaseView} c=${c} access=${access} role=${role} params=${params} crumbs=${crumbs} />`;
  };

  const NoAccess = ({ c, access, role, crumbs }) => {
    const restricted = access === 'restricted';
    return html`<${ui.Page} eyebrow=${`Ärende ${c.number}`} title=${restricted ? 'Skyddade personuppgifter' : 'Åtkomst saknas'} crumbs=${[...crumbs, { label: c.number }]}>
      <${ui.Card} tone="sub">
        <div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:16px">
          <${I} name=${restricted ? 'shield' : 'lock'} size="xl" />
          <div class="stack-sm" style="min-width:0">
            <h2 style="font-size:var(--fs-h2)">Du saknar åtkomst till det här deltagarkortet</h2>
            ${restricted
              ? html`<p>Ärendet har skyddade personuppgifter. Bara namngiven huvudcoach och avtalsansvarig kan öppna det. Du ser att ärendet finns så att det kan planeras och följas upp, men inte vem det gäller.</p>`
              : html`<p>${role === 'handledare' ? 'Du ser bara ärenden du är tilldelad.' : 'Du ser bara ärenden där du är huvudcoach eller ingår i teamet.'} Behöver du arbeta i ärendet? Be samordnaren lägga till dig i teamet.</p>`}
            ${restricted && html`<${ui.Kv} items=${[['Ärendenummer', html`<span class="mono strong">${c.number}</span>`], ['Status', html`<${ui.CaseStatus} status=${c.status} />`]]} />`}
            <p class="small muted">Försöket att öppna kortet är loggat i revisionsloggen.</p>
          </div>
        </div>
      <//>
      <div class="row"><${ui.Btn} kind="primary" icon="arrow-left" onClick=${() => MM.nav(crumbs[0].view, {})}>Tillbaka till listan<//></div>
      ${restricted && html`<${ui.DemoNote}>Jämför med en roll som har åtkomst. <span style="display:inline-block;margin-top:6px"><${ui.PerspectiveSwitch} role="avtalsansvarig" view="arende.kort" params=${{ caseId: c.id }} label="Visa som avtalsansvarig" /></span><//>`}
    <//>`;
  };

  const CaseView = ({ c, access, role, params, crumbs }) => {
    const me = MM.currentPersonaId();
    const p = sel.person(c) || {};
    const prot = !!p.protectedIdentity;
    const team = access === 'team';
    const edit = canEditCase(c, role, access);
    const manage = isManager(role) && access === 'full';
    const readOnly = READ_ONLY.includes(role);
    const tabIds = team ? TEAM_TABS : ALL_TABS;
    const [tab, setTab] = useState(tabIds.includes(params.tab) ? params.tab : 'oversikt');
    const [modal, setModal] = useState(null);
    const ver = MM.store.version;
    const alerts = useMemo(() => alertsFor(role).filter((a) => a.caseId === c.id), [ver, role, c.id]);
    const k = custUser(c.referrerId);
    // Olästa = meddelanden från kommunen som den inloggade inte har läst. Chef och systemadmin markerar inget som läst (läsläge).
    const unread = readOnly || team ? 0 : sel.messagesOf(c.id).filter((m) => String(m.senderId).startsWith('k-') && !(m.readBy || []).includes(me)).length;
    useEffect(() => { if (tab === 'meddelanden' && unread > 0) MM.dispatch('message.read', { caseId: c.id }, { silent: true }); }, [tab, unread]);
    const openDevs = sel.deviationsOf(c.id).filter((x) => x.status === 'open').length;
    const tabs = tabIds.map((id) => ({ id, label: team && id === 'handelser' ? 'Arbetsgivarkontakter och händelser' : TAB_LABEL[id],
      count: id === 'meddelanden' ? unread : id === 'avvikelser' ? openDevs : id === 'oversikt' ? alerts.length : null }));
    const blockedTab = params.tab && !tabIds.includes(params.tab) && ALL_TABS.includes(params.tab);
    const myTeamRole = (c.team || []).find((t) => t.userId === me);
    const ctx = { c, p, role, access, team, edit, manage, readOnly, prot, alerts, setTab, setModal, k };

    return html`<${ui.Page} eyebrow=${`Deltagarkort · ${c.number}`} title=${sel.displayName(c, role)} crumbs=${[...crumbs, { label: c.number }]}
      lead=${`${sel.areaName(c.primaryArea)}${c.vocationalTrack ? ` · ${c.vocationalTrack}` : ''}`}
      actions=${!team && html`<${CustSwitch} c=${c} tab=${['rapporter', 'meddelanden'].includes(tab) ? tab : null} label=${(who) => `Se ärendet som ${who}`} />`}>
      ${prot && html`<${ui.Notice} tone="warn" icon="shield" title="Skyddade personuppgifter">Ingen adress lagras. Inga SMS eller mejl skickas till deltagaren – kontakt sker per telefon enligt den säkra rutinen. AI och inspelning används aldrig. Bara namngiven huvudcoach och avtalsansvarig ser kortet.<//>`}
      ${readOnly && html`<${ui.Notice} tone="info" icon="eye" title="Läsläge">${role === 'chef' ? 'Som chef och controller ser du allt i ärendet men kan inte ändra något.' : 'Som systemadmin ser du ärendet men arbetar inte i det.'} Visningen är loggad.<//>`}
      ${team && html`<${ui.Notice} tone="info" icon="users" title=${`Du ingår i teamet som ${sel.teamLabel(myTeamRole ? myTeamRole.role : '').toLowerCase()}`}>Du ser moment, närvaro, praktik och arbetsgivarkontakter. Coachens anteckningar och bedömningar, månadsrapporter och slutrapporter visas inte för handledare.<//>`}

      <div class="split-wide">
        <${CaseHeader} ...${ctx} />
        <div class="stack">
          ${!team && html`<${ConsentCard} ...${ctx} />`}
          <${ActionsCard} ...${ctx} />
        </div>
      </div>

      <div class="stack arn-tabs">
        <${ui.Tabs} tabs=${tabs} active=${tab} onChange=${setTab} ariaLabel="Delar av deltagarkortet" />
        ${blockedTab && html`<${ui.Notice} tone="info" title="Den delen visas inte för din roll">${TAB_LABEL[params.tab]} innehåller coachens anteckningar och bedömningar. Du ser översikten i stället.<//>`}
        ${tab === 'oversikt' && html`<${TabOversikt} ...${ctx} />`}
        ${tab === 'kartlaggning' && html`<${TabKartlaggning} ...${ctx} />`}
        ${tab === 'avstamningar' && html`<${TabAvstamningar} ...${ctx} />`}
        ${tab === 'narvaro' && html`<${TabNarvaro} ...${ctx} />`}
        ${tab === 'manad' && html`<${TabManad} ...${ctx} />`}
        ${tab === 'handelser' && html`<${TabHandelser} ...${ctx} />`}
        ${tab === 'avvikelser' && html`<${TabAvvikelser} ...${ctx} />`}
        ${tab === 'praktik' && html`<${TabPraktik} ...${ctx} />`}
        ${tab === 'rapporter' && html`<${TabRapporter} ...${ctx} />`}
        ${tab === 'meddelanden' && html`<${TabMeddelanden} ...${ctx} />`}
        ${tab === 'historik' && html`<${TabHistorik} ...${ctx} />`}
      </div>

      ${modal === 'coach' && html`<${CoachModal} c=${c} k=${k} onClose=${() => setModal(null)} />`}
      ${modal === 'meeting' && html`<${MeetingModal} c=${c} p=${p} onClose=${() => setModal(null)} />`}
      ${modal === 'consent' && html`<${ConsentModal} c=${c} p=${p} onClose=${() => setModal(null)} />`}
    <//>`;
  };

  // ---------------------------------------------------------------- Huvud
  const CaseHeader = ({ c, p, role, team, prot, k, readOnly }) => {
    const since = c.startDate ? sel.phaseSince(c) : null;
    const stuck = sel.stuck(c);
    const weeks = c.orderValueWeeks || c.plannedWeeks;
    const price = sel.priceFor(c.primaryArea, c.startDate || d.today());
    const refProblem = c.buyerReference ? sel.buyerRefProblem(c) : null;
    const lead = (c.team || []).find((t) => t.role === 'lead_coach');
    const others = (c.team || []).filter((t) => t.role !== 'lead_coach');
    const insats = [
      ['Avtalsområde', `${sel.areaName(c.primaryArea)}${c.secondaryArea ? ` (även ${sel.areaName(c.secondaryArea)})` : ''}`],
      ['Yrkesspår', c.vocationalTrack || 'Väljs i kartläggningen'],
      ['Beställd', `${d.fmtDate(c.referredAt)} kl. ${d.fmtTime(c.referredAt)} via ${SRC[c.source] || c.source}`],
      ['Start', c.startDate ? d.fmtDate(c.startDate) : c.firstMeetingAt ? `Planerad ${d.fmtDate(c.firstMeetingAt)}` : 'Inte bestämd'],
      ['Planerat slut', c.plannedEnd ? d.fmtDate(c.plannedEnd) : 'Inte angivet'],
      c.endDate ? ['Avslutad', html`${d.fmtDate(c.endDate)} · ${sel.endReasonLabel(c.endReason)}${c.resultClass === 'result' && !c.resultVerifiedAt ? html`<div style="margin-top:4px"><${ui.Badge} tone="red" icon="alert-circle">Preliminärt – verifiering saknas<//></div>` : ''}`] : null,
      !team ? ['Beställning', weeks ? html`${fmt.plural(weeks, 'vecka', 'veckor')} · <span class="strong">${fmt.kr(weeks * price)}</span><div class="small muted">${weeks} × ${fmt.kr(price)} per deltagarvecka</div>` : 'Omfattning inte angiven'] : null,
    ];
    const deltagare = [
      ['Personnummer', html`<${ui.MaskedPnr} caseId=${c.id} />`],
      ['Kontaktväg', prot ? 'Telefon enligt den säkra rutinen. Inga SMS eller mejl.' : sel.contactLabel(p.preferredContact)],
      ['Språk', `${cap(p.language) || 'Framgår inte'}${p.needsInterpreter ? ' · behöver tolk' : ''}`],
      ['Anpassning', p.accessibilityNeeds || 'Inga behov angivna'],
    ];
    const kommun = [
      ['Handläggare', k ? html`${k.name}<div class="small muted">${k.title}, ${k.unit}</div>` : '–'],
      !team ? ['Beställarreferens', c.buyerReference
        ? html`<span class="mono">${c.buyerReference}</span>${refProblem && html`<div style="margin-top:4px"><${ui.Badge} tone="red" icon="alert-circle">${refProblem}<//></div>`}`
        : html`<${ui.Badge} tone="red" icon="alert-circle">Saknas – krävs för bekräftelse och faktura<//>`] : null,
      !team && c.purchaseOrderNumber ? ['Inköpsorder', html`<span class="mono">${c.purchaseOrderNumber}</span>`] : null,
      ['Huvudcoach', c.leadCoachId ? html`<${ui.UserName} id=${c.leadCoachId} />` : html`<span class="muted">Inte tilldelad</span>`],
      ['Team', others.length ? html`<div class="stack-sm" style="gap:4px">${others.map((t) => html`<div key=${t.userId}>${MM.personName(t.userId)}<div class="small muted">${sel.teamLabel(t.role)}</div></div>`)}</div>` : (lead ? 'Bara huvudcoach' : '–')],
    ];
    return html`<${ui.Card}>
      <div class="stack">
        <div class="row-sm">
          <${ui.CaseStatus} status=${c.status} /><${ui.PhaseTag} phase=${c.phase} />
          ${prot && html`<${ui.Badge} tone="dark" icon="lock">Skyddade personuppgifter<//>`}
          ${readOnly && html`<${ui.Badge} tone="outline" icon="eye">Läsläge<//>`}
          ${stuck && html`<${ui.Badge} tone="grey" icon="clock">Fastnat: ${stuck.days} dagar i fas ${stuck.phase} (gräns ${stuck.maxDays})<//>`}
        </div>
        <div class="arn-phasewrap">
          <${ui.PhaseBar} phase=${c.phase} />
          <div class="small muted">Fas ${c.phase} av ${MM.cfg().phases.length} · ${sel.phaseName(c.phase)}${since && c.status === 'active' ? ` · sedan ${fd(since)}` : ''}${c.status === 'paused' ? ' · pausad' : ''}</div>
        </div>
        <div class="arn-section"><div class="arn-label">Insatsen</div><${Facts} items=${insats} /></div>
        <div class="arn-section"><div class="arn-label">Deltagaren</div><${Facts} items=${deltagare} /></div>
        <div class="arn-section"><div class="arn-label">Kommunen och teamet</div><${Facts} items=${kommun} /></div>
      </div>
    <//>`;
  };

  // ---------------------------------------------------------------- Samtycke (inspelning och AI, fas 2)
  const ConsentCard = ({ c, prot, edit, setModal }) => {
    const cons = sel.consentOf(c.id);
    const v = prot ? 'not_applicable' : c.aiConsent || 'not_asked';
    const revoke = async () => {
      const ok = await MM.confirm({ title: 'Återkalla samtycket?', confirmLabel: 'Återkalla samtycket', tone: 'danger',
        body: html`<p>Inspelning och AI-stöd stängs av direkt för det här ärendet. Redan godkända avstämningar påverkas inte. Deltagaren kan lämna nytt samtycke senare.</p>` });
      if (!ok) return;
      const res = MM.dispatch('consent.set', { caseId: c.id, value: 'revoked' });
      if (res && res.error) { MM.toast('Samtycket kunde inte ändras.', 'red'); return; }
      MM.toast('Samtycket är återkallat. Inspelning och AI är avstängt för ärendet.', 'blue');
    };
    const decline = () => { MM.dispatch('consent.set', { caseId: c.id, value: 'declined' }); MM.toast('Registrerat att deltagaren avböjer. Avstämningar dokumenteras manuellt.', 'blue'); };
    const state = {
      given: ['blue', 'check-circle', 'Samtycke registrerat'], declined: ['grey', 'minus-circle', 'Deltagaren har avböjt'], revoked: ['red', 'x-circle', 'Samtycket är återkallat'],
      not_asked: ['outline', 'help', 'Inte tillfrågad ännu'], not_applicable: ['dark', 'lock', 'Ej tillämpligt'],
    }[v] || ['outline', 'help', 'Inte tillfrågad ännu'];
    return html`<${ui.Card} title="Samtycke till inspelning och AI" icon="mic" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
      <div class="stack-sm">
        <div><${ui.Badge} tone=${state[0]} icon=${state[1]}>${state[2]}<//></div>
        ${v === 'not_applicable' && html`<p class="small">Skyddade personuppgifter: ingen inspelning och ingen AI. Samtycke kan inte registreras.</p>`}
        ${v === 'given' && cons && html`<p class="small muted">Lämnat ${fd(cons.givenAt)} · informerad av ${MM.personName(cons.informedBy)} · text ${cons.textVersion}${cons.language ? ` på ${cons.language}` : ''}.</p>`}
        ${v === 'revoked' && cons && cons.revokedAt && html`<p class="small muted">Återkallat ${d.fmtDateTime(cons.revokedAt)}. Inspelning och AI är avstängt.</p>`}
        ${v === 'declined' && html`<p class="small muted">Avstämningar dokumenteras manuellt. Deltagaren kan ändra sig.</p>`}
        ${v === 'not_asked' && html`<p class="small muted">Inspelning kan bara startas när samtycke är registrerat.</p>`}
        ${edit && v !== 'not_applicable' && !['closed', 'declined'].includes(c.status) && html`<div class="row-sm">
          ${v === 'given' ? html`<${ui.Btn} kind="danger" icon="x-circle" onClick=${revoke}>Återkalla samtycke<//>`
            : html`<${ui.Btn} kind="secondary" icon="check" onClick=${() => setModal('consent')}>${v === 'revoked' ? 'Registrera nytt samtycke' : 'Registrera samtycke'}<//>`}
          ${v === 'not_asked' && html`<${ui.Btn} kind="ghost" onClick=${decline}>Deltagaren avböjer<//>`}
        </div>`}
      </div>
    <//>`;
  };

  const ConsentModal = ({ c, p, onClose }) => {
    const langs = MM.uniq(['lättläst svenska', p.language && p.language !== 'svenska' ? p.language : null, 'engelska', 'arabiska', 'somaliska'].filter(Boolean));
    const [lang, setLang] = useState(langs[0]);
    const [ok, setOk] = useState(false);
    const [err, setErr] = useState(null);
    const save = () => {
      if (!ok) { setErr('Bekräfta att deltagaren har fått informationen och själv har sagt ja.'); return; }
      const res = MM.dispatch('consent.set', { caseId: c.id, value: 'given', language: lang });
      if (res && res.error) { MM.toast('Samtycke kan inte registreras för skyddade personuppgifter.', 'red'); return; }
      MM.toast('Samtycket är registrerat. Inspelning och AI-stöd kan nu användas i avstämningarna.', 'blue'); onClose();
    };
    return html`<${ui.Modal} title="Registrera samtycke" onClose=${onClose} footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${save}>Registrera samtycke<//>`}>
      <p>Samtycket gäller inspelning av avstämningar och AI-stöd för textutkast. AI föreslår – coachen bedömer. Ljudet raderas direkt efter transkribering.</p>
      <${ui.Field} label="Informationen gavs på" id="arn-cons-lang" help="Välj det språk deltagaren fick informationstexten på."><${ui.Select} id="arn-cons-lang" value=${lang} onChange=${setLang} options=${langs.map((x) => ({ value: x, label: cap(x) }))} /><//>
      <${ui.Field} id="arn-cons-ok" error=${err}><${ui.Check} id="arn-cons-ok" checked=${ok} onChange=${(v) => { setOk(v); setErr(null); }}>Deltagaren har fått informationen muntligt och skriftligt och har själv sagt ja. Deltagaren vet att samtycket kan återkallas när som helst.<//><//>
      <${ui.DemoNote}>Textversion v1.0 (2026-10-01) sparas tillsammans med samtycket och vem som informerade.<//>
    <//>`;
  };

  // ---------------------------------------------------------------- Åtgärder
  const ActionsCard = ({ c, role, team, edit, manage, readOnly, setModal, prot, k }) => {
    const btns = [];
    const active = !['closed', 'declined'].includes(c.status);
    if (manage && active && c.leadCoachId) btns.push(html`<${ui.Btn} kind="secondary" icon="users" block onClick=${() => setModal('coach')}>Byt huvudcoach<//>`);
    if (manage && c.status === 'confirmed' && !c.firstMeetingAt) btns.push(html`<${ui.Btn} kind="primary" icon="calendar" block onClick=${() => setModal('meeting')}>Boka första möte<//>`);
    if (manage && ['received', 'acknowledged'].includes(c.status) && canOpen('sam.inkorg', role)) btns.push(html`<${ui.Btn} kind="primary" icon="inbox" block onClick=${() => MM.nav('sam.inkorg', { caseId: c.id })}>Hantera avropet i inkorgen<//>`);
    if (edit && c.status === 'active' && canOpen('coach.avstamning', role)) btns.push(html`<${ui.Btn} kind="secondary" icon="check-square" block onClick=${() => MM.nav('coach.avstamning', { caseId: c.id })}>Ny veckoavstämning<//>`);
    if ((edit || team) && c.status === 'active' && canOpen('coach.narvaro', role)) btns.push(html`<${ui.Btn} kind="secondary" icon="calendar" block onClick=${() => MM.nav('coach.narvaro', {})}>Registrera närvaro<//>`);
    if (edit && ['active', 'closed'].includes(c.status) && canOpen('coach.handelse', role)) btns.push(html`<${ui.Btn} kind="secondary" icon="award" block onClick=${() => MM.nav('coach.handelse', { caseId: c.id, mode: 'event' })}>Registrera händelse<//>`);
    return html`<${ui.Card} title="Åtgärder" icon="tool">
      <div class="stack-sm">
        ${btns.length > 0 ? btns : html`<p class="small muted">${readOnly ? 'Läsläge – du kan inte ändra i ärendet.' : team ? 'Du registrerar närvaro och praktik via Närvaro och Arbetsgivare och praktik.' : 'Inga åtgärder för din roll just nu.'}</p>`}
        ${manage && active && c.leadCoachId && html`<p class="small muted">Byte av huvudcoach kräver orsak. ${k ? k.name : 'Handläggaren'} och nya coachen får notis.${MM.cfg().keyPersonnelChangeRequiresApproval ? ' Avtalet kräver kommunens godkännande vid byte av nyckelpersonal.' : ''}</p>`}
        ${!team && html`<div class="demo-note" style="margin-top:4px"><${I} name="building" /><div><b>Det här ser kommunen:</b> status, fas, huvudcoach, närvaro, levererade rapporter och meddelanden.${MM.cfg().customerVisibility.seesCoachNotes === false ? ' Inte coachens anteckningar.' : ''}${prot && !custRole(c) ? ` Skyddade personuppgifter: i portalen ser bara beställande handläggare (${k ? k.name : 'handläggaren'}) ärendet. Den rollen finns inte i prototypen, så du kan inte byta till kommunens vy här.` : ''}</div></div>`}
      </div>
    <//>`;
  };

  const CoachModal = ({ c, k, onClose }) => {
    const [to, setTo] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState({});
    const load = (id) => S().cases.filter((x) => x.leadCoachId === id && x.status === 'active').length;
    const opts = sel.coaches().filter((u) => u.id !== c.leadCoachId).map((u) => ({ value: u.id, label: `${u.name} – ${load(u.id)} aktiva ärenden` }));
    const approval = MM.cfg().keyPersonnelChangeRequiresApproval;
    const save = () => {
      const e = {};
      if (!to) e.to = 'Välj ny huvudcoach.';
      if (!reason.trim()) e.reason = 'Skriv orsaken till bytet. Den sparas i historiken.';
      setErr(e); if (Object.keys(e).length) return;
      const res = MM.dispatch('case.changeCoach', { caseId: c.id, toCoachId: to, reason: reason.trim() });
      if (!res || res.error) { MM.toast('Bytet sparades inte.', 'red'); return; }
      MM.toast(`${MM.personName(to)} är ny huvudcoach för ${c.number}. ${k ? k.name : 'Handläggaren'} och ${MM.personName(to)} har fått notis.`, 'blue');
      onClose();
    };
    return html`<${ui.Modal} title="Byt huvudcoach" onClose=${onClose} footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${save}>Byt huvudcoach<//>`}>
      ${approval && html`<${ui.Notice} tone="warn" title="Kommunen ska godkänna bytet">Avtalet kräver kommunens godkännande vid byte av nyckelpersonal. Stäm av med ${k ? k.name : 'handläggaren'} innan du sparar, till exempel med ett säkert meddelande i ärendet.<//>`}
      <${ui.Kv} items=${[['Ärende', html`<span class="mono strong">${c.number}</span>`], ['Nuvarande huvudcoach', MM.personName(c.leadCoachId)]]} />
      <${ui.Field} label="Ny huvudcoach" id="arn-coach-to" required error=${err.to} help="Antalet aktiva ärenden hjälper dig att fördela arbetet jämnt.">
        <${ui.Select} id="arn-coach-to" value=${to} onChange=${(v) => { setTo(v); setErr({ ...err, to: null }); }} placeholder="Välj coach" options=${opts} invalid=${!!err.to} /><//>
      <${ui.Field} label="Orsak till bytet" id="arn-coach-reason" required error=${err.reason} help="Obligatorisk. Samma coach genom hela insatsen är huvudregeln, så orsaken loggas och syns i historiken.">
        <${ui.TextArea} id="arn-coach-reason" value=${reason} onInput=${(v) => { setReason(v); if (err.reason) setErr({ ...err, reason: null }); }} rows="3" invalid=${!!err.reason} placeholder="Till exempel: Föräldraledighet från vecka 8." /><//>
      <div class="card tone-sub"><div class="card-body stack-sm">
        <div class="arn-label" style="margin:0">Det här händer när du sparar</div>
        <ul class="arn-mini">
          <li><${I} name="bell" /><span><b>Nya coachen</b> får en notis i appen och ett mejl utan personuppgifter: ”Du har fått ett nytt ärende i Miljonmatch: ${c.number}. Logga in för att se detaljerna.”</span></li>
          <li><${I} name="mail" /><span><b>${k ? k.name : 'Handläggaren'}</b> får ett mejl: ”Ärende ${c.number} har fått ny huvudcoach. Logga in i portalen för att se vem.”</span></li>
          <li><${I} name="book" /><span>Bytet sparas i historiken med orsak, tidpunkt och vem som gjorde det.</span></li>
        </ul>
      </div></div>
    <//>`;
  };

  const MeetingModal = ({ c, p, onClose }) => {
    const due = sel.firstMeetingDue(c);
    const [at, setAt] = useState(`${d.addWorkingDays(d.today(), 1)}T10:00`);
    const [err, setErr] = useState(null);
    const prot = !!p.protectedIdentity;
    const late = at && at > due;
    const save = () => {
      if (!at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)) { setErr('Välj datum och tid för mötet.'); return; }
      if (at < d.now()) { setErr('Tiden har redan passerat. Välj en senare tid.'); return; }
      if (!d.isWorkingDay(at)) { setErr(`${d.holidayName(at) || 'Dagen'} är inte en arbetsdag. Välj en vardag.`); return; }
      MM.dispatch('case.bookFirstMeeting', { caseId: c.id, at });
      MM.toast(`Första mötet är bokat ${d.fmtDateTimeLong(at)}.${prot ? ' Ring deltagaren enligt den säkra rutinen.' : ' Kallelsen skickas via föredragen kontaktväg.'}`, 'blue');
      onClose();
    };
    return html`<${ui.Modal} title="Boka första möte" onClose=${onClose} footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="calendar" onClick=${save}>Boka mötet<//>`}>
      <${ui.Kv} items=${[['Ärende', html`<span class="mono strong">${c.number}</span>`], ['Huvudcoach', MM.personName(c.leadCoachId)], ['Beställt', d.fmtDateTimeLong(c.referredAt)], ['Senast bokat', html`<${ui.SlaBadge} dueAt=${due} />`]]} />
      <${ui.Field} label="Datum och tid" id="arn-meet-at" required error=${err} help=${`Mötet ska hållas ${firstMeetingText()} – senast ${d.fmtDateTimeLong(due)}. Plats: Miljonbemanning ${c.location || ''}.`}>
        <${ui.Input} id="arn-meet-at" type="datetime-local" value=${at} onInput=${(v) => { setAt(v); setErr(null); }} invalid=${!!err} /><//>
      ${late && html`<${ui.Notice} tone="warn" title="Senare än avtalets gräns">Tiden ligger efter ${d.fmtDateTimeLong(due)}. Mötet markeras som sent i uppföljningen.<//>`}
      <p class="small">${prot ? 'Skyddade personuppgifter: inga SMS eller mejl. Coachen ringer deltagaren enligt den säkra rutinen.' : `Deltagaren får en kallelse via ${sel.contactLabel(p.preferredContact).toLowerCase()} och en påminnelse dagen före. Kallelsen innehåller bara tid och plats.`}</p>
    <//>`;
  };

  // ---------------------------------------------------------------- Flik: Översikt
  const shortWhen = (s) => `${cap(d.WD_SHORT[d.weekday(s)])} ${d.fmtDateShort(s)} kl. ${d.fmtTime(s)}`;
  const ActList = ({ acts, empty, short }) => (acts.length === 0 ? html`<p class="small muted">${empty}</p>` : html`<ul class="arn-mini">${acts.map((a) => html`<li key=${a.id}><${I} name=${actIcon(a)} /><span><span class="strong">${short ? shortWhen(a.startsAt) : `${cap(d.fmtWeekday(a.startsAt))} kl. ${d.fmtTime(a.startsAt)}`}</span> · ${actLabel(a)}<span class="small muted"> · ${a.location}</span></span></li>`)}</ul>`);

  const TabOversikt = ({ c, role, team, manage, edit, alerts, setTab, setModal }) => {
    const now = d.now();
    const nm = nextMeeting(c);
    const lc = sel.latestCheckIn(c.id);
    const drafts = sel.checkInsOf(c.id).filter((x) => x.status === 'draft');
    const w4 = last4Weeks(); const ast = sel.attendanceStats(c.id, w4.from, w4.to);
    const upcoming = sel.activitiesOf(c.id).filter((a) => a.startsAt >= now && a.startsAt <= `${d.addDays(d.today(), 14)}T23:59` && (!team || a.kind !== 'möte'));
    const needsMeeting = c.status === 'confirmed' && !c.firstMeetingAt;
    const pl = sel.placementsOf(c.id).find((x) => x.status === 'ongoing');
    const emp = pl && employer(pl.employerId);
    const followLink = (a) => {
      if (!a.link) return null;
      if (a.link.view === 'arende.kort' && a.link.params && a.link.params.caseId === c.id) return a.link.params.tab ? html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => setTab(a.link.params.tab)}>Visa<//>` : null;
      return canOpen(a.link.view, role) ? html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav(a.link.view, a.link.params || {})}>Öppna<//>` : null;
    };
    return html`<div class="stack">
      ${needsMeeting && html`<${ui.Notice} tone="critical" title="Första mötet är inte bokat">
        <div class="stack-sm"><div>Mötet ska hållas ${firstMeetingText()}. <${ui.SlaBadge} dueAt=${sel.firstMeetingDue(c)} /></div>
        ${manage && html`<div><${ui.Btn} kind="primary" icon="calendar" onClick=${() => setModal('meeting')}>Boka första möte<//></div>`}</div><//>`}
      <div class="grid">
        <${ui.Card} title="Nästa möte" icon="calendar">
          ${nm ? html`<div class="stack-sm"><div class="strong" style="font-size:1.0625rem">${d.dayOf(nm.startsAt) === d.today() ? `I dag kl. ${d.fmtTime(nm.startsAt)}` : cap(d.fmtDateTimeLong(nm.startsAt))}</div><div class="small muted">${d.relative(nm.startsAt)} · ${nm.first ? 'Första mötet' : 'Coachmöte'} · ${nm.location}</div></div>`
            : html`<p class="small muted">${['closed', 'declined'].includes(c.status) ? 'Insatsen är avslutad.' : 'Inget möte bokat.'}</p>`}
        <//>
        ${!team && html`<${ui.Card} title="Senaste avstämning" icon="check-square">
          ${lc ? html`<div class="stack-sm">
              <div class="row-sm"><${ui.Status} value=${lc.overallStatus} /></div>
              <div class="small muted">${cap(d.fmtWeekday(lc.heldAt))} · ${MODE[lc.mode] || lc.mode} · veckomål: ${GOAL[lc.goalStatus] || 'Ej angivet'}</div>
              ${lc.nextGoal && html`<div><span class="small muted">Nästa mål:</span> ${lc.nextGoal}</div>`}
              ${lc.note && html`<div class="small">${clip(lc.note, 140)}</div>`}
            </div>` : html`<p class="small muted">Ingen godkänd avstämning ännu.</p>`}
          ${drafts.length > 0 && html`<div style="margin-top:10px" class="row-sm"><${ui.Badge} tone="outline" icon="edit">${fmt.plural(drafts.length, 'utkast', 'utkast')} att granska<//>${drafts.some((x) => x.ai) && html`<${ui.AiTag}>AI-utkast<//>`}</div>`}
        <//>`}
        <${ui.Card} title=${`Närvaro ${w4.label}`} icon="activity">
          ${ast.planned - ast.unregistered > 0 ? html`<div class="stack-sm">
              <div class="kpi-value" style="font-size:1.75rem;font-weight:800">${fmt.pct(ast.rate, 0)}</div>
              <${ui.Meter} value=${ast.rate || 0} max=${1} label=${`Närvarograd ${fmt.pct(ast.rate, 0)}`} />
              <div class="small muted">${ast.present + ast.late} av ${ast.planned - ast.unregistered} tillfällen · ${ast.absentInvalid} ogiltig frånvaro${ast.unregistered > 0 ? ` · ${ast.unregistered} saknar registrering` : ''}</div>
            </div>` : html`<p class="small muted">${ast.unregistered > 0 ? `${ast.unregistered} tillfällen saknar registrering.` : 'Inga tillfällen under perioden.'}</p>`}
          <div style="margin-top:8px"><${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => setTab('narvaro')}>Visa närvaro per vecka<//></div>
        <//>
      </div>
      <div class=${team && alerts.length === 0 ? 'stack' : 'split'}>
        ${(!team || alerts.length > 0) && html`<${ui.Card} title="Flaggor för ärendet" icon="flag" flush>
          ${alerts.length === 0 ? html`<div class="card-body"><p class="small muted">Inga flaggor för din roll just nu.</p></div>` : html`<div class="list">${alerts.map((a) => { const s = SEV[a.severity] || SEV.info; return html`<div class="list-item" key=${a.key}>
              <div class="li-main"><div class="row-sm"><${ui.Badge} tone=${s.tone} icon=${s.icon}>${s.label}<//><span class="li-title">${a.title}</span></div><div class="small">${a.text}</div></div>
              <div class="li-side">${followLink(a)}</div></div>`; })}</div>`}
        <//>`}
        <${ui.Card} title=${team ? 'Kommande moment och praktikdagar' : 'Kommande 14 dagar'} icon="clock">
          <${ActList} acts=${upcoming.slice(0, 8)} empty="Inga planerade tillfällen de närmaste två veckorna." />
          ${upcoming.length > 8 && html`<p class="small muted" style="margin-top:8px">och ${upcoming.length - 8} till.</p>`}
        <//>
      </div>
      ${pl && html`<${ui.Card} title="Pågående praktik" icon="briefcase" actions=${html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => setTab('praktik')}>Visa praktiken<//>`}>
        <div class="row-sm"><span class="strong">${emp ? emp.name : 'Arbetsgivare'}</span><span class="small muted">${fd(pl.startsOn)} – ${fd(pl.endsOn)} · handledare ${pl.supervisorName}</span></div>
        <div class="arn-flags" style="margin-top:8px">${FOUR.map(([key, label]) => { const okk = !pl.fourRights || pl.fourRights[key]; return html`<${ui.Badge} tone=${okk ? 'bluetone' : 'red'} icon=${okk ? 'check' : 'x'}>${label}${okk ? '' : ' saknas'}<//>`; })}</div>
      <//>`}
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Kartläggning
  const TabKartlaggning = ({ c, role, edit }) => {
    const ia = sel.intakeOf(c.id);
    const can = canOpen('coach.kartlaggning', role);
    const link = can && html`<${ui.Btn} kind=${ia && ia.status === 'approved' ? 'secondary' : 'primary'} iconRight="arrow-right" onClick=${() => MM.nav('coach.kartlaggning', { caseId: c.id })}>${!ia ? 'Påbörja kartläggningen' : ia.status === 'approved' || !edit ? 'Öppna kartläggningen' : 'Fortsätt kartläggningen'}<//>`;
    if (!ia) return html`<${ui.Card}><${ui.Empty} icon="clipboard" title="Kartläggningen är inte påbörjad" action=${edit && link}>Kartläggningen görs vecka 1. Den dokumenterar den reella kompetensen och är underlag för validering, matchning och CV.<//><//>`;
    const v = (x) => x || 'Framgår inte';
    const stuck = sel.stuck(c);
    return html`<div class="stack">
      ${ia.status !== 'approved' && html`<${ui.Notice} tone=${stuck && stuck.phase === 1 ? 'warn' : 'info'} title="Kartläggningen är inte godkänd">${stuck && stuck.phase === 1 ? `Ärendet har varit i fas 1 i ${stuck.days} dagar (gräns ${stuck.maxDays}). ` : ''}Uppgifterna används i rapporter först när kartläggningen är godkänd.<//>`}
      <${ui.Card} title="Kartläggning vecka 1" icon="clipboard" actions=${ia.status === 'approved' ? html`<${ui.Badge} tone="blue" icon="check">Godkänd<//>` : html`<${ui.Badge} tone="outline" icon="edit">Utkast<//>`}
        foot=${html`<span class="small muted">${ia.status === 'approved' ? `Godkänd ${d.fmtDateTime(ia.approvedAt)} av ${MM.personName(ia.approvedBy)}` : 'Sparad som utkast'}</span><span class="spacer"></span>${link}`}>
        <${ui.Kv} items=${[
          ['Arbetslivserfarenhet', v(ia.workExperience)], ['Utbildning', v(ia.education)], ['Språk', v(ia.languageNotes)], ['Digital vana', v(ia.digitalSkills)],
          ['Körkort', v(ia.drivingLicence)], ['Yrkesmål', v(ia.workGoals)], ['Valt yrkesspår', ia.chosenTrack || 'Inte valt ännu'],
          ['Behov av anpassning', ia.adaptations || 'Inga behov angivna'], ['Första veckomål', v(ia.firstWeekGoal)],
        ]} />
      <//>
      <p class="small muted">Behov av anpassning beskrivs funktionellt – vad som behövs i vardagen – aldrig som diagnos.</p>
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Avstämningar
  const TabAvstamningar = ({ c, role, edit }) => {
    const [n, setN] = useState(12);
    const list = sel.checkInsOf(c.id);
    const drafts = list.filter((x) => x.status === 'draft');
    const can = canOpen('coach.avstamning', role);
    const cols = [
      { key: 'heldAt', label: 'Datum', nowrap: true, render: (x) => html`<span class="strong">${fd(x.heldAt)}</span><div class="cell-sub">${d.fmtWeek(x.heldAt)} · kl. ${d.fmtTime(x.heldAt)}</div>` },
      { key: 'mode', label: 'Form', render: (x) => MODE[x.mode] || '–' },
      { key: 'goal', label: 'Veckomål', render: (x) => (x.status === 'approved' ? GOAL[x.goalStatus] || '–' : '–') },
      { key: 'phase', label: 'Fas', nowrap: true, render: (x) => (x.status === 'approved' && x.phase ? `Fas ${x.phase}` : '–') },
      { key: 'overall', label: 'Samlad status', render: (x) => (x.status === 'approved' ? html`<${ui.Status} value=${x.overallStatus} short />` : html`<${ui.Status} value=${null} />`) },
      { key: 'obst', label: 'Hinder', render: (x) => (x.obstacles && x.obstacles.length ? x.obstacles.join(', ') : '–') },
      { key: 'note', label: 'Anteckning', render: (x) => (x.status === 'approved' ? html`<span class="small">${clip(x.note, 80) || '–'}</span>` : html`<span class="small muted">Granskas av coachen</span>`) },
      { key: 'st', label: 'Status', render: (x) => html`<div class="row-sm">${x.status === 'approved' ? html`<${ui.Badge} tone="blue" icon="check">Godkänd<//>` : html`<${ui.Badge} tone="outline" icon="edit">Utkast<//>`}${x.ai && x.status !== 'approved' && html`<${ui.AiTag}>AI-utkast<//>`}</div>` },
    ];
    return html`<div class="stack">
      ${drafts.length > 0 && html`<${ui.Notice} tone="info" title=${`${fmt.plural(drafts.length, 'utkast', 'utkast')} väntar på granskning`}>Utkast används inte i rapporter. Rapporter byggs bara av godkända avstämningar. AI-förslag sätter aldrig samlad status – coachen väljer.<//>`}
      <${ui.Card} flush title=${`Veckoavstämningar (${list.length})`} icon="check-square"
        actions=${edit && can && c.status === 'active' && html`<${ui.Btn} kind="primary" icon="plus" onClick=${() => MM.nav('coach.avstamning', { caseId: c.id })}>Ny avstämning<//>`}
        foot=${list.length > n && html`<span class="small muted">Visar ${n} av ${list.length}</span><span class="spacer"></span><${ui.Btn} kind="secondary" icon="chevron-down" onClick=${() => setN(list.length)}>Visa alla<//>`}>
        <${ui.Table} columns=${cols} rows=${list.slice(0, n)} caption="Veckoavstämningar" empty="Inga avstämningar ännu."
          onRowClick=${can ? (x) => MM.nav('coach.avstamning', { caseId: c.id, checkInId: x.id }) : undefined} />
      <//>
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Närvaro
  const TabNarvaro = ({ c, role, edit, team, setTab }) => {
    if (!c.startDate) return html`<${ui.Card}><${ui.Empty} icon="calendar" title="Insatsen har inte startat">Närvaro registreras från första mötet.<//><//>`;
    const today = d.today(); const now = d.now();
    const endDay = c.endDate && c.endDate < today ? c.endDate : today;
    const weeks = [];
    for (let mon = d.monday(c.startDate); mon <= endDay; mon = d.addDays(mon, 7)) {
      const w = d.isoWeek(mon); const sun = d.addDays(mon, 6);
      weeks.push({ id: w.key, key: w.key, mon, sun, paused: (c.pausedWeeks || []).includes(w.key), st: sel.attendanceStats(c.id, mon, sun), future: sel.activitiesOf(c.id).filter((a) => a.startsAt >= now && a.startsAt <= `${sun}T23:59` && a.startsAt >= mon).length });
    }
    weeks.reverse();
    const total = sel.attendanceStats(c.id, c.startDate, endDay);
    const w4 = last4Weeks(); const s4 = sel.attendanceStats(c.id, w4.from, w4.to);
    const rep = sel.repeatedAbsence(c.id); const rule = MM.cfg().attendance.repeatedAbsenceRule;
    const past = sel.activitiesOf(c.id).filter((a) => a.startsAt < now).slice(-10).reverse();
    const reasons = Object.entries(total.reasons || {});
    const canReg = (edit || team) && canOpen('coach.narvaro', role) && c.status === 'active';
    const cols = [
      { key: 'w', label: 'Vecka', nowrap: true, render: (w) => html`<span class="strong">${d.fmtWeekKey(w.key)}</span><div class="cell-sub">${d.fmtWeekRange(w.key)}</div>` },
      { key: 'p', label: 'Tillfällen', num: true, render: (w) => (w.paused ? html`<${ui.Badge} tone="grey" icon="pause">Pausad<//>` : html`${w.st.planned}${w.future > 0 ? html`<div class="cell-sub">+${w.future} kommande</div>` : ''}`) },
      { key: 'n', label: 'Närvarande', num: true, render: (w) => (w.paused ? '–' : w.st.present) },
      { key: 'l', label: 'Sen', num: true, render: (w) => (w.paused ? '–' : w.st.late) },
      { key: 'g', label: 'Giltig frånvaro', num: true, render: (w) => (w.paused ? '–' : w.st.absentValid) },
      { key: 'o', label: 'Ogiltig frånvaro', num: true, render: (w) => (w.paused ? '–' : w.st.absentInvalid > 0 ? html`<span class="strong">${w.st.absentInvalid}</span>` : 0) },
      { key: 'u', label: 'Saknar registrering', num: true, render: (w) => (w.paused ? '–' : w.st.unregistered > 0 ? html`<${ui.Badge} tone="outline" icon="help">${w.st.unregistered}<//>` : 0) },
      { key: 'r', label: 'Närvarograd', num: true, render: (w) => (w.paused ? html`<span class="small muted">Debiteras inte</span>` : w.st.rate == null ? '–' : html`<span class="strong">${fmt.pct(w.st.rate, 0)}</span>`) },
    ];
    return html`<div class="stack">
      ${rep && html`<${ui.Notice} tone="critical" title="Upprepad ogiltig frånvaro">
        <div class="stack-sm"><div>${rep.length} ogiltiga frånvarotillfällen inom ${rule.withinDays} dagar (${rep.map((x) => fd(x.registeredAt)).join(', ')}). Avtalets regel: ${rule.absentInvalid} tillfällen inom ${rule.withinDays} dagar. Förslag: åtgärdsplan och uppföljningsmöte med handläggaren.</div>
        ${!team && html`<div><${ui.Btn} kind="secondary" icon="flag" onClick=${() => setTab('avvikelser')}>Gå till avvikelser<//></div>`}</div><//>`}
      <div class="arn-kpi-row">
        <${ui.Kpi} label="Närvarograd hela insatsen" value=${fmt.pct(total.rate, 0)} sub=${`${total.present + total.late} av ${total.planned - total.unregistered} registrerade tillfällen`} />
        <${ui.Kpi} label=${`Närvarograd ${w4.label}`} value=${fmt.pct(s4.rate, 0)} sub=${`${s4.present + s4.late} av ${s4.planned - s4.unregistered} tillfällen`} />
        <${ui.Kpi} label="Ogiltig frånvaro" value=${total.absentInvalid} sub="tillfällen under insatsen" tone=${rep ? 'alert' : undefined} />
        <${ui.Kpi} label="Saknar registrering" value=${total.unregistered} sub=${total.unregistered > 0 ? (regDueText() ? `registrera senast ${regDueText()}` : 'registrera så snart som möjligt') : 'allt är registrerat'} tone=${total.unregistered > 0 ? 'watch' : undefined} />
      </div>
      ${reasons.length > 0 && html`<p class="small"><span class="strong">Skäl till giltig frånvaro:</span> ${reasons.map(([r, n]) => `${r} (${n})`).join(' · ')}</p>`}
      <${ui.Card} flush title="Närvaro per ISO-vecka" icon="calendar" actions=${canReg && html`<${ui.Btn} kind="primary" icon="check-square" onClick=${() => MM.nav('coach.narvaro', {})}>Registrera närvaro<//>`}>
        <${ui.Table} columns=${cols} rows=${weeks} caption="Närvaro per vecka" empty="Inga veckor ännu." rowClass=${(w) => (w.paused ? 'row-muted' : w.st.absentInvalid > 0 ? 'row-alert' : '')} />
      <//>
      <${ui.Card} flush title="Senaste tillfällen" icon="list">
        <${ui.Table} caption="Senaste tillfällen" empty="Inga tillfällen ännu." rows=${past} columns=${[
          { key: 'd', label: 'Tid', nowrap: true, render: (a) => html`${cap(d.fmtWeekday(a.startsAt))}<div class="cell-sub">kl. ${d.fmtTime(a.startsAt)}</div>` },
          { key: 'k', label: 'Tillfälle', render: (a) => html`<span class="row-sm"><${I} name=${actIcon(a)} />${actLabel(a)}</span><div class="cell-sub">${a.location}</div>` },
          { key: 's', label: 'Närvaro', render: (a) => { const at = sel.attendanceFor(a.id); return html`<${AttBadge} status=${at ? at.status : 'none'} />`; } },
          { key: 'r', label: 'Skäl', render: (a) => { const at = sel.attendanceFor(a.id); return at && at.reason ? at.reason : '–'; } },
        ]} />
      <//>
      <${ui.DemoNote}>Närvarograd = närvarande och sena tillfällen delat med registrerade tillfällen. Pausade veckor debiteras inte. Veckorapporten till kommunen publiceras automatiskt när all närvaro är registrerad.<//>
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Månadsbedömning
  const TabManad = ({ c, role, edit }) => {
    const cfg = MM.cfg().progression;
    const list = sel.assessmentsOf(c.id);
    const lastMonth = d.addMonths(d.monthKey(d.today()), -1);
    const missingLast = c.status === 'active' && c.startDate && c.startDate <= d.monthEnd(lastMonth) && !sel.assessment(c.id, lastMonth);
    const reps = sel.reportsOf(c.id).filter((r) => r.kind === 'monthly' && !r.superseded);
    const can = canOpen('coach.manad', role);
    const canRep = canOpen('rapport.visa', role);
    const nAreas = cfg.areas.length;
    const lv = Object.keys(cfg.scale || {}).map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    const minL = lv.length ? lv[0] : 0; const maxL = lv.length ? lv[lv.length - 1] : 3;
    const clearFrom = Number((String((cfg.statDefinition && cfg.statDefinition.clear) || '').match(/>=\s*(\d+)/) || [])[1] || Math.min(2, maxL));
    const lower = (x) => String(cfg.scale[x] || '').toLowerCase();
    const clearLabel = clearFrom >= maxL ? lower(maxL) : `${lower(clearFrom)} eller ${lower(maxL)}`;
    const clearRange = clearFrom >= maxL ? `nivå ${maxL}` : `nivå ${clearFrom}–${maxL}`;
    return html`<div class="stack">
      <p class="muted">Progression bedöms per område och månad på skalan ${minL}–${maxL}. Coachen väljer nivå. AI kan föreslå, men sätter aldrig nivån. Från nivå ${cfg.observationRequiredFromLevel} krävs en konkret observation.</p>
      ${missingLast && html`<${ui.Notice} tone="warn" title=${`${cap(d.monthName(lastMonth))} är inte påbörjad`}>
        <div class="stack-sm"><div>Månadsbedömningen är underlag för månadsrapporten till kommunen.</div>${edit && can && html`<div><${ui.Btn} kind="primary" icon="edit" onClick=${() => MM.nav('coach.manad', { caseId: c.id, month: lastMonth })}>Påbörja bedömningen<//></div>`}</div><//>`}
      ${list.length === 0 && !missingLast && html`<${ui.Card}><${ui.Empty} icon="chart" title="Inga månadsbedömningar ännu">Den första görs efter insatsens första hela månad.<//><//>`}
      ${list.map((ma) => {
        const approved = ma.status === 'approved';
        const levels = Object.values(ma.areas || {});
        const clear = levels.filter((a) => a.level >= clearFrom).length;
        const plan = sel.planOf(c.id, ma.month);
        const rep = reps.filter((r) => r.month === ma.month).sort((a, b) => (b.version || 1) - (a.version || 1))[0];
        return html`<${ui.Card} key=${ma.id} title=${cap(d.monthName(ma.month))} icon="chart"
          actions=${html`${approved ? html`<${ui.Badge} tone="blue" icon="check">Godkänd<//>` : html`<${ui.Badge} tone="outline" icon="edit">Utkast<//>`}`}
          foot=${html`${rep ? html`<span class="row-sm small"><${I} name="file" />Månadsrapport: <b>${sel.reportStatusLabel(rep.status)}</b>${rep.openedAt ? ' · kvitterad av kommunen' : ''}</span>` : html`<span class="small muted">Ingen månadsrapport</span>`}
            <span class="spacer"></span>
            ${rep && canRep && html`<${ui.Btn} kind="ghost" icon="file" onClick=${() => MM.nav('rapport.visa', { reportId: rep.id })}>Visa rapporten<//>`}
            ${can && html`<${ui.Btn} kind=${!approved && edit ? 'primary' : 'secondary'} iconRight="arrow-right" onClick=${() => MM.nav('coach.manad', { caseId: c.id, month: ma.month })}>${!approved && edit ? 'Fortsätt bedömningen' : 'Öppna bedömningen'}<//>`}`}>
          <div class="stack-sm">
            <div class="row-sm"><span class="small muted">Samlad status:</span><${ui.Status} value=${approved ? ma.overallStatus : null} /></div>
            ${approved
              ? html`<div>Progression ${clearLabel} (${clearRange}) i <b>${clear} av ${nAreas}</b> områden.</div>${ma.summary && html`<div class="small">${ma.summary}</div>`}`
              : html`<div class="small muted">Nivåerna är tomma tills coachen har valt. AI-förslag visas bara i bedömningsvyn.</div>`}
            ${approved && plan && (plan.goal1 || plan.goal2) && html`<div class="small"><span class="strong">Plan för nästa månad:</span> ${[plan.goal1, plan.goal2].filter(Boolean).join(' · ')}</div>`}
          </div>
        <//>`;
      })}
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Händelser och utfall
  const TabHandelser = ({ c, role, edit, team }) => {
    const cfg = MM.cfg();
    const ev = sel.eventsOf(c.id);
    const shown = team ? ev.filter((e) => CONTACT_KINDS.includes(e.kind) || e.kind === 'praktik_startad') : ev;
    const can = canOpen('coach.handelse', role) && edit;
    const prelim = c.resultClass === 'result' && !c.resultVerifiedAt;
    const unset = MM.isUnset(cfg.result.definition);
    return html`<div class="stack">
      ${!team && html`<${ui.Card} title="Utfall" icon="target" actions=${html`<div class="row-sm">
          ${can && ['active', 'closed'].includes(c.status) && html`<${ui.Btn} kind="secondary" icon="plus" onClick=${() => MM.nav('coach.handelse', { caseId: c.id, mode: 'event' })}>Registrera händelse<//>`}
          ${can && c.status === 'active' && html`<${ui.Btn} kind="secondary" icon="check-square" onClick=${() => MM.nav('coach.handelse', { caseId: c.id, mode: 'close' })}>Avsluta insatsen<//>`}</div>`}>
        <div class="stack-sm">
          ${c.status === 'closed'
            ? html`<${ui.Kv} items=${[
                ['Avslutad', d.fmtDate(c.endDate)], ['Avslutsorsak', sel.endReasonLabel(c.endReason)],
                ['Resultatklass', html`<span class="row-sm">${c.resultClass === 'result' ? html`<${ui.Badge} tone="blue" icon="award">${RESULT.result}<//>` : c.resultClass === 'excluded' ? html`<${ui.Badge} tone="grey" icon="minus-circle">${RESULT.excluded}<//>` : html`<${ui.Badge} tone="outline" icon="circle">${RESULT[c.resultClass] || 'Ej klassad'}<//>`}
                  ${prelim && html`<${ui.Badge} tone="red" icon="alert-circle">Preliminärt<//>`}</span>`],
                c.resultClass === 'result' ? ['Verifiering', c.resultVerifiedAt ? `Verifierad ${d.fmtDate(c.resultVerifiedAt)}` : 'Saknas – räknas som resultat först när verifiering har registrerats.'] : null,
              ]} />`
            : html`<p>Insatsen ${c.status === 'active' ? 'pågår' : 'har inte startat'}. Resultatet klassas vid avslut enligt avtalets resultatdefinition. Arbete och studier räknas först när verifiering har registrerats – innan dess visas de som preliminära.</p>`}
          ${unset && html`<div class="demo-note"><${I} name="info" /><div><b>Resultatdefinitionen är ej fastställd i avtalet.</b> ${cfg.result.prototypeDefinition}</div></div>`}
        </div>
      <//>`}
      <${ui.Card} flush title=${team ? `Arbetsgivarkontakter och händelser (${shown.length})` : `Händelser (${shown.length})`} icon="award">
        ${team && html`<div class="card-body" style="padding-bottom:0"><p class="small muted">Arbetsgivarkontakter i godkända avstämningar: <b>${ciContacts(c.id)}</b>. Coachens anteckningar visas inte.</p></div>`}
        ${shown.length === 0 ? html`<${ui.Empty} icon="award" title="Inga händelser ännu">Här registreras praktik, intervjuer, arbetserbjudanden, arbete, studier och validering.<//>`
          : html`<div class="list">${shown.map((e) => {
            const needsVer = ['arbete_paborjat', 'studier_paborjade'].includes(e.kind) && !e.verificationKind;
            return html`<div class="list-item" key=${e.id}><${I} name=${e.kind === 'praktik_startad' ? 'briefcase' : ['arbete_paborjat', 'arbetserbjudande'].includes(e.kind) ? 'award' : e.kind === 'studier_paborjade' ? 'book' : 'target'} size="lg" />
              <div class="li-main">
                <div class="li-title">${sel.eventLabel(e.kind)}</div>
                <div class="li-sub">${d.fmtDate(e.occurredOn)}${e.actor ? ` · ${e.actor}` : ''}</div>
                ${e.note && html`<div class="small">${e.note}</div>`}
                <div class="row-sm">
                  ${e.verificationKind ? html`<${ui.Badge} tone="bluetone" icon="paperclip">Verifierad: ${e.verificationKind}<//>` : html`<${ui.Badge} tone="outline" icon="help">Ingen verifiering<//>`}
                  ${needsVer && html`<${ui.Badge} tone="red" icon="alert-circle">Preliminärt<//>`}
                  ${e.possibleBonus && !team && html`<${ui.Badge} tone="outline" icon="star">Möjligt bonusunderlag<//><${ui.BuildPhase} fas=${3} />`}
                </div>
                ${e.possibleBonus && !team && !cfg.bonus.enabled && html`<div class="small muted">Bonus: avstängd – modellen ej fastställd. Underlaget samlas in.</div>`}
              </div></div>`; })}</div>`}
      <//>
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Avvikelser
  const DEV_SUGGEST = ['Upprepad ogiltig frånvaro', 'Planen håller inte – behöver omplanering', 'Deltagaren har avbrutit praktiken', 'Praktiska hinder påverkar insatsen (till exempel resor eller barnomsorg)'];

  const DeviationForm = ({ c, onDone }) => {
    const owners = S().users.filter((u) => ['coach', 'samordnare', 'avtalsansvarig', 'handledare'].includes(u.role) && u.active !== false);
    const [f, setF] = useState({ description: '', assessment: '', action: '', ownerId: c.leadCoachId || MM.currentPersonaId(), followUpOn: d.addWorkingDays(d.today(), 5), needsCustomerDecision: false });
    const [err, setErr] = useState({});
    const set = (k2) => (v) => { setF({ ...f, [k2]: v }); if (err[k2]) setErr({ ...err, [k2]: null }); };
    const save = (e) => {
      if (e) e.preventDefault();
      const x = {};
      if (!f.description.trim()) x.description = 'Beskriv vad som har hänt.';
      if (!f.action.trim()) x.action = 'En avvikelse ska alltid ha en åtgärd.';
      if (!f.ownerId) x.ownerId = 'Välj vem som ansvarar för åtgärden.';
      if (!f.followUpOn) x.followUpOn = 'Välj datum för uppföljning.';
      else if (f.followUpOn < d.today()) x.followUpOn = 'Datumet har redan passerat.';
      if (PNR_RE.test(`${f.description} ${f.assessment} ${f.action}`)) x.description = 'Ta bort personnumret. Använd ärendenumret i stället.';
      setErr(x); if (Object.values(x).some(Boolean)) return;
      const res = MM.dispatch('deviation.save', { caseId: c.id, data: { description: f.description.trim(), assessment: f.assessment.trim(), action: f.action.trim(), ownerId: f.ownerId, followUpOn: f.followUpOn, needsCustomerDecision: !!f.needsCustomerDecision, followUpMeetingAt: null, status: 'open' } });
      if (!res || !res.deviationId) { MM.toast('Avvikelsen sparades inte.', 'red'); return; }
      MM.toast(`Avvikelsen är sparad. Uppföljning senast ${d.fmtDate(f.followUpOn)}.`, 'blue');
      onDone(res.deviationId, f.needsCustomerDecision);
    };
    return html`<form class="stack" onSubmit=${save} noValidate>
      <div class="row-sm"><span class="small muted">Vanliga avvikelser:</span>${DEV_SUGGEST.map((s) => html`<button type="button" class="btn btn-ghost arn-suggest" onClick=${() => set('description')(s)}>${s}</button>`)}</div>
      <div class="form-grid">
        <${ui.Field} label="Vad har hänt?" id="arn-dev-desc" required full error=${err.description} help="Sakligt och funktionellt. Inga diagnoser eller omdömen om personen.">
          <${ui.TextArea} id="arn-dev-desc" value=${f.description} onInput=${set('description')} rows="2" invalid=${!!err.description} /><//>
        <${ui.Field} label="Bedömning" id="arn-dev-assess" full help="Vad betyder det för insatsen? Till exempel risk för avbrott.">
          <${ui.TextArea} id="arn-dev-assess" value=${f.assessment} onInput=${set('assessment')} rows="2" /><//>
        <${ui.Field} label="Åtgärd" id="arn-dev-action" required full error=${err.action} help="Vad gör vi nu? En avvikelse utan åtgärd kan inte sparas.">
          <${ui.TextArea} id="arn-dev-action" value=${f.action} onInput=${set('action')} rows="2" invalid=${!!err.action} /><//>
        <${ui.Field} label="Ansvarig" id="arn-dev-owner" required error=${err.ownerId} help="Den som ser till att åtgärden blir gjord.">
          <${ui.Select} id="arn-dev-owner" value=${f.ownerId} onChange=${set('ownerId')} placeholder="Välj ansvarig" options=${owners.map((u) => ({ value: u.id, label: `${u.name} – ${u.title}` }))} invalid=${!!err.ownerId} /><//>
        <${ui.Field} label="Följs upp senast" id="arn-dev-follow" required error=${err.followUpOn} help="Uppföljningen syns i Förfaller-listan.">
          <${ui.Input} id="arn-dev-follow" type="date" value=${f.followUpOn} onInput=${set('followUpOn')} invalid=${!!err.followUpOn} /><//>
        <div class="full"><${ui.Check} id="arn-dev-cust" checked=${f.needsCustomerDecision} onChange=${set('needsCustomerDecision')}>Kräver beslut av kommunen (till exempel ändrad plan eller avbrott)<//></div>
      </div>
      <div class="row"><${ui.Btn} kind="primary" type="submit" icon="check">Spara avvikelsen<//><${ui.Btn} kind="ghost" onClick=${() => onDone(null)}>Avbryt<//></div>
    </form>`;
  };

  const CallModal = ({ c, k, devs, initialId, onClose }) => {
    const me = MM.persona() || { name: 'Miljonbemanning', title: '' };
    const defAt = `${d.addWorkingDays(d.today(), 2)}T10:00`;
    const [devId, setDevId] = useState(initialId || (devs[0] ? devs[0].id : ''));
    const [at, setAt] = useState(defAt);
    const makeText = (id, when) => {
      const dv = devs.find((x) => x.id === id);
      return [
        `Hej ${k ? firstName(k.name) : ''}!`.replace(' !', '!'),
        `Vi vill kalla till ett uppföljningsmöte om ärende ${c.number}.`,
        dv ? [`Anledning: ${withDot(dv.description)}`, dv.assessment && `Vår bedömning: ${withDot(dv.assessment)}`, dv.action && `Förslag på åtgärd: ${withDot(dv.action)}`].filter(Boolean).join('\n') : 'Anledning: vi behöver stämma av planen för insatsen tillsammans.',
        `Förslag på tid: ${when && /T\d{2}:\d{2}$/.test(when) ? d.fmtDateTimeLong(when) : '(välj tid)'} hos Miljonbemanning i ${c.location || 'Alby'}. Det går också bra att ses via Teams. Passar tiden? Svara gärna här i portalen.`,
        `Med vänlig hälsning\n${me.name}${me.title ? `, ${me.title.toLowerCase()}` : ''}\nMiljonbemanning`,
      ].join('\n\n');
    };
    const [body, setBody] = useState(makeText(devId, defAt));
    const [edited, setEdited] = useState(false);
    const [err, setErr] = useState({});
    const regen = (id, when) => { if (!edited) setBody(makeText(id, when)); };
    const send = () => {
      const x = {};
      if (!at || !/T\d{2}:\d{2}$/.test(at)) x.at = 'Välj datum och tid att föreslå.';
      else if (at < d.now()) x.at = 'Tiden har redan passerat. Välj en senare tid.';
      if (!body.trim()) x.body = 'Skriv ett meddelande till kommunen.';
      else if (PNR_RE.test(body)) x.body = 'Ta bort personnumret. Använd ärendenumret i stället.';
      setErr(x); if (Object.values(x).some(Boolean)) return;
      MM.dispatch('deviation.callCustomer', { caseId: c.id, deviationId: devId || null, body: body.trim(), proposedAt: at });
      MM.toast(`Kallelsen är skickad till ${k ? k.name : 'kommunen'} som säkert meddelande. Mejlet innehåller bara ärendenumret.`, 'blue');
      onClose(true, at);
    };
    return html`<${ui.Modal} wide title="Kalla kommunen till uppföljning" onClose=${() => onClose(false)} footer=${html`<${ui.Btn} kind="ghost" onClick=${() => onClose(false)}>Avbryt<//><${ui.Btn} kind="primary" icon="send" onClick=${send}>Skicka kallelsen<//>`}>
      <p>Enligt avtalet kallar vi kommunen till uppföljning när en avvikelse kräver dialog eller beslut. Kontrollera texten och skicka.</p>
      <div class="form-grid">
        <${ui.Field} label="Gäller avvikelse" id="arn-call-dev" help="Texten fylls i utifrån avvikelsen du väljer.">
          <${ui.Select} id="arn-call-dev" value=${devId} onChange=${(v) => { setDevId(v); regen(v, at); }} placeholder="Ingen specifik avvikelse" options=${devs.map((x) => ({ value: x.id, label: `${fd(x.createdAt)} – ${clip(x.description, 60)}` }))} /><//>
        <${ui.Field} label="Föreslagen tid" id="arn-call-at" required error=${err.at} help="Kommunen bekräftar eller föreslår en annan tid i svaret.">
          <${ui.Input} id="arn-call-at" type="datetime-local" value=${at} onInput=${(v) => { setAt(v); regen(devId, v); if (err.at) setErr({ ...err, at: null }); }} invalid=${!!err.at} /><//>
        <${ui.Field} label="Meddelande till kommunen" id="arn-call-body" required full error=${err.body} help="Skickas som säkert meddelande i portalen. Du kan ändra texten.">
          <${ui.TextArea} id="arn-call-body" value=${body} onInput=${(v) => { setBody(v); setEdited(true); if (err.body) setErr({ ...err, body: null }); }} rows="11" invalid=${!!err.body} /><//>
      </div>
      <div class="card tone-sub"><div class="card-body stack-sm">
        <div class="arn-label" style="margin:0">Det här får kommunen</div>
        <ul class="arn-mini">
          <li><${I} name="lock" /><span><b>Ett säkert meddelande i portalen</b> med texten ovan. ${k ? k.name : 'Handläggaren'} läser det under ärendet efter inloggning.</span></li>
          <li><${I} name="mail" /><span><b>Ett mejl till ${k ? k.email : 'handläggaren'}</b> utan personuppgifter: ”Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.”</span></li>
        </ul>
      </div></div>
    <//>`;
  };

  const TabAvvikelser = ({ c, role, edit, k, readOnly }) => {
    const devs = sel.deviationsOf(c.id);
    const open = devs.filter((x) => x.status === 'open');
    const rep = sel.repeatedAbsence(c.id);
    const [form, setForm] = useState(false);
    const [call, setCall] = useState(null); // { id }
    const [sent, setSent] = useState(null);
    const ver = MM.store.version;
    const dueOf = useMemo(() => { const m = {}; for (const x of sel.deadlines({ days: 3650, coachId: c.leadCoachId || null })) if (x.kind === 'avvikelse_uppfoljning') m[x.id] = x.dueAt; return m; }, [ver, c.id]);
    const cr = custRole(c);
    const close = async (dv) => {
      const ok = await MM.confirm({ title: 'Markera avvikelsen som åtgärdad?', confirmLabel: 'Markera som åtgärdad', body: html`<p>${dv.description}</p><p class="small muted">Avvikelsen finns kvar i historiken och i rapporterna.</p>` });
      if (!ok) return;
      MM.dispatch('deviation.save', { id: dv.id, caseId: c.id, data: { status: 'closed', closedAt: d.now() } });
      MM.toast('Avvikelsen är markerad som åtgärdad.', 'blue');
    };
    return html`<div class="stack">
      <div class="row-between">
        <p class="muted" style="max-width:70ch">En avvikelse är alltid en åtgärd: vad har hänt, vad gör vi, vem ansvarar och när följer vi upp. Röd samlad status i en avstämning skapar en avvikelse automatiskt.</p>
        ${edit && html`<div class="row-sm">
          <${ui.Btn} kind="primary" icon="calendar" onClick=${() => setCall({ id: open[0] ? open[0].id : '' })}>Kalla kommunen till uppföljning<//>
          ${!form && html`<${ui.Btn} kind="secondary" icon="plus" onClick=${() => setForm(true)}>Ny avvikelse<//>`}</div>`}
      </div>
      ${sent && html`<${ui.Notice} tone="ok" title="Kallelsen är skickad">
        <div class="stack-sm"><div>${k ? k.name : 'Kommunen'} har fått ett säkert meddelande med förslag på tid ${d.fmtDateTimeLong(sent)} och ett mejl utan personuppgifter.</div>
        ${cr === 'kommun_chef' && html`<div class="small">${k ? k.name : 'Handläggaren'} finns inte som roll i prototypen. Kommunens chef kan läsa kallelsen i ärendets meddelanden men svarar inte på den.</div>`}
        ${cr && html`<div><${CustSwitch} c=${c} tab="meddelanden" label=${(who) => `Se kallelsen som ${who}`} /></div>`}</div><//>`}
      ${form && html`<${ui.Card} title="Ny avvikelse" icon="flag"><${DeviationForm} c=${c} onDone=${(id, needsCust) => { setForm(false); if (id && needsCust) setCall({ id }); }} /><//>`}
      ${rep && open.length === 0 && html`<${ui.Notice} tone="warn" title="Upprepad ogiltig frånvaro är flaggad">${rep.length} ogiltiga frånvarotillfällen inom ${MM.cfg().attendance.repeatedAbsenceRule.withinDays} dagar. Registrera en avvikelse med åtgärd och kalla kommunen till uppföljning.<//>`}
      ${devs.length === 0 && !form && html`<${ui.Card}><${ui.Empty} icon="flag" title="Inga avvikelser registrerade">Avvikelser skapas här eller automatiskt när en avstämning får röd samlad status.<//><//>`}
      ${devs.map((dv) => html`<${ui.Card} key=${dv.id} tone=${dv.status === 'open' ? 'red' : undefined}
          title=${dv.status === 'open' ? 'Öppen avvikelse' : 'Åtgärdad avvikelse'} icon=${dv.status === 'open' ? 'alert-circle' : 'check-circle'}
          actions=${html`<span class="small muted">${d.fmtDateTime(dv.createdAt)}${dv.checkInId ? ' · från veckoavstämning' : ''}</span>`}
          foot=${edit && dv.status === 'open' && html`<${ui.Btn} kind="secondary" icon="calendar" onClick=${() => setCall({ id: dv.id })}>Kalla kommunen<//><${ui.Btn} kind="ghost" icon="check" onClick=${() => close(dv)}>Markera som åtgärdad<//>`}>
          <div class="stack-sm">
            <div class="strong" style="font-size:1.0625rem">${dv.description}</div>
            <${ui.Kv} items=${[
              dv.assessment ? ['Bedömning', dv.assessment] : null,
              ['Åtgärd', dv.action || '–'],
              ['Ansvarig', dv.ownerId ? MM.personName(dv.ownerId) : '–'],
              ['Uppföljning', dv.followUpOn ? html`${d.fmtDate(dv.followUpOn)}${dv.status === 'open' ? html` <${ui.SlaBadge} dueAt=${dueOf[`dev:${dv.id}`] || `${dv.followUpOn}T23:59`} />` : ''}` : '–'],
              ['Kommunens beslut', dv.needsCustomerDecision ? 'Behövs' : 'Behövs inte'],
              ['Uppföljningsmöte', dv.followUpMeetingAt ? `Föreslaget ${d.fmtDateTimeLong(dv.followUpMeetingAt)}` : 'Inte föreslaget'],
            ]} />
          </div>
        <//>`)}
      ${readOnly && devs.length > 0 && html`<p class="small muted">Läsläge – avvikelser hanteras av coach och samordnare.</p>`}
      ${call && html`<${CallModal} c=${c} k=${k} devs=${open} initialId=${call.id} onClose=${(ok, at) => { if (ok) setSent(at || d.now()); setCall(null); }} />`}
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Praktik
  const TabPraktik = ({ c, role, team }) => {
    const pls = sel.placementsOf(c.id).slice().sort(MM.by('startsOn', -1));
    const contacts = sel.eventsOf(c.id).filter((e) => CONTACT_KINDS.includes(e.kind));
    const today = d.today();
    return html`<div class="stack">
      <div class="row-between">
        <p class="muted" style="max-width:70ch">Varje praktikplats ska ha de fyra rätten: rätt arbetsuppgifter, rätt handledning, rätt tidpunkt och rätt uppföljning.</p>
        <div class="row-sm"><${ui.BuildPhase} fas=${3} />${canOpen('praktik.arbetsgivare', role) && html`<${ui.Btn} kind="secondary" icon="briefcase" onClick=${() => MM.nav('praktik.arbetsgivare', {})}>Arbetsgivarregistret<//>`}</div>
      </div>
      ${pls.length === 0 && html`<${ui.Card}><${ui.Empty} icon="briefcase" title="Ingen praktik ännu">Praktik planeras oftast i fas ${c.phase < 4 ? '4' : c.phase}. Coachen bedömer när deltagaren är redo (rätt tidpunkt).<//><//>`}
      ${pls.map((pl) => {
        const emp = employer(pl.employerId); const fr = pl.fourRights || {};
        const missing = FOUR.filter(([key]) => !fr[key]);
        return html`<${ui.Card} key=${pl.id} title=${emp ? emp.name : 'Praktikplats'} icon="building" tone=${missing.length && pl.status === 'ongoing' ? 'red' : undefined}
          actions=${html`<${ui.Badge} tone=${pl.status === 'ongoing' ? 'blue' : 'grey'} icon=${pl.status === 'ongoing' ? 'play' : 'check'}>${PLACEMENT[pl.status] || pl.status}<//>`}>
          <div class="stack">
            ${missing.length > 0 && pl.status === 'ongoing' && html`<${ui.Notice} tone="warn" title=${`Saknas: ${missing.map((m) => m[1].toLowerCase()).join(', ')}`}>Komplettera före nästa uppföljningsdatum. Praktikplatsen ska vara förberedd innan deltagaren börjar.<//>`}
            <div class="split">
              <${ui.Kv} items=${[
                ['Period', `${d.fmtDate(pl.startsOn)} – ${d.fmtDate(pl.endsOn)}`],
                ['Arbetsuppgifter', pl.tasks || '–'],
                ['Mål', pl.goals || '–'],
                ['Handledare', pl.supervisorName || '–'],
              ]} />
              <${ui.Kv} items=${[
                ['Kontaktperson', emp ? `${emp.contactName}` : '–'],
                ['Telefon', emp ? emp.phone : '–'],
                ['Uppföljning', (pl.followUpDates || []).length ? html`<ul class="arn-mini">${pl.followUpDates.map((x) => html`<li key=${x}><${I} name=${x < today ? 'check' : 'calendar'} /><span>${d.fmtDate(x)}<span class="small muted"> · ${x < today ? 'genomförd' : x === today ? 'i dag' : 'planerad'}</span></span></li>`)}</ul>` : 'Inga datum planerade'],
              ]} />
            </div>
            <div class="arn-four">${FOUR.map(([key, label, help]) => { const okk = !!fr[key]; return html`<div class=${cls('arn-four-item', !okk && 'missing')} key=${key}>
              <${I} name=${okk ? 'check-circle' : 'x-circle'} /><div><div class="strong">${label} · ${okk ? 'Uppfyllt' : 'Saknas'}</div><div class="small muted">${help}</div></div></div>`; })}</div>
          </div>
        <//>`;
      })}
      <${ui.Card} title="Arbetsgivarkontakter" icon="users" flush>
        <div class="card-body" style="padding-bottom:4px"><p class="small">I godkända veckoavstämningar: <b>${ciContacts(c.id)}</b> kontakter. Registrerade händelser: <b>${contacts.length}</b>.</p></div>
        ${contacts.length === 0 ? html`<div class="card-body"><p class="small muted">Inga registrerade arbetsgivarkontakter ännu.</p></div>` : html`<div class="list">${contacts.map((e) => html`<div class="list-item" key=${e.id}><${I} name="building" /><div class="li-main"><div class="li-title">${e.actor || 'Arbetsgivare'}</div><div class="li-sub">${sel.eventLabel(e.kind)} · ${d.fmtDate(e.occurredOn)}</div></div></div>`)}</div>`}
      <//>
      ${team && html`<${ui.DemoNote}>Som handledare ser du praktik och arbetsgivarkontakter men inte coachens anteckningar.<//>`}
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Rapporter
  const TabRapporter = ({ c, role }) => {
    const reps = sel.reportsOf(c.id).filter((r) => !r.superseded);
    const can = canOpen('rapport.visa', role);
    const cols = [
      { key: 'k', label: 'Rapport', render: (r) => html`<span class="strong">${sel.reportKindLabel(r.kind)}</span><div class="cell-sub">${r.month ? cap(d.monthName(r.month)) : r.kind === 'order_confirmation' ? fd(r.periodStart) : `${fd(r.periodStart)} – ${fd(r.periodEnd)}`}${r.version > 1 ? ` · version ${r.version}` : ''}</div>` },
      { key: 's', label: 'Status', render: (r) => {
        const t = { draft: ['outline', 'edit'], reviewed: ['bluetone', 'eye'], approved: ['bluetone', 'check'], delivered: ['blue', 'send'], opened: ['blue', 'check-circle'], waiting: ['grey', 'clock'] }[r.status] || ['grey', 'circle'];
        const nv = r.correctionPending ? S().reports.find((x) => x.id === r.correctionPending) : null;
        return html`<${ui.Badge} tone=${t[0]} icon=${t[1]}>${sel.reportStatusLabel(r.status)}<//>${nv && !nv.deliveredAt && html`<div class="cell-sub">Rättelse pågår (version ${nv.version}). Kommunen ser den här versionen tills rättelsen levereras.</div>`}`;
      } },
      { key: 'due', label: 'Tidsgräns', render: (r) => (r.dueAt ? html`<${ui.SlaBadge} dueAt=${r.dueAt} metAt=${r.deliveredAt} />${r.provisionalDue && html`<div class="cell-sub">Preliminär – ej fastställd i avtalet</div>`}` : '–') },
      { key: 'del', label: 'Levererad', nowrap: true, render: (r) => (r.deliveredAt ? d.fmtDateTime(r.deliveredAt) : '–') },
      { key: 'op', label: 'Kommunen', render: (r) => (r.openedAt ? html`<span class="row-sm"><${I} name="check" />Läst ${fd(r.openedAt)}</span>` : r.deliveredAt ? html`<span class="small muted">Inte öppnad än</span>` : '–') },
    ];
    return html`<div class="stack">
      <p class="muted" style="max-width:75ch">Rapporter byggs bara av godkända uppgifter – godkända avstämningar och bedömningar. Kommunen ser levererade rapporter i portalen. Mejlet till kommunen innehåller bara ärendenumret.</p>
      <${ui.Card} flush title=${`Rapporter för ${c.number}`} icon="file" actions=${html`<${CustSwitch} c=${c} tab="rapporter" label=${(who) => `Så ser ${who} rapporterna`} />`}>
        <${ui.Table} columns=${cols} rows=${reps} caption="Rapporter" empty="Inga rapporter ännu." onRowClick=${can ? (r) => MM.nav('rapport.visa', { reportId: r.id }) : undefined} />
      <//>
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Meddelanden
  const TabMeddelanden = ({ c, role, edit, readOnly, k }) => {
    const msgs = sel.messagesOf(c.id);
    const [body, setBody] = useState(''); const [err, setErr] = useState(null);
    const supplier = MM.contract().supplierName; const customer = MM.contract().customerName;
    const send = (e) => {
      if (e) e.preventDefault();
      const t = body.trim();
      if (!t) { setErr('Skriv ett meddelande innan du skickar.'); return; }
      if (PNR_RE.test(t)) { setErr('Ta bort personnumret. Använd ärendenumret i stället.'); return; }
      setErr(null);
      MM.dispatch('message.send', { caseId: c.id, body: t });
      setBody('');
      MM.toast(`Meddelandet är skickat. ${k ? k.name : 'Handläggaren'} får ett mejl utan personuppgifter.`, 'blue');
    };
    const readText = (m) => {
      const mine = !String(m.senderId).startsWith('k-');
      const by = (m.readBy || []).filter((id) => (mine ? String(id).startsWith('k-') : !String(id).startsWith('k-')));
      if (mine) return by.length ? `Läst av kommunen ${m.readAt ? d.fmtDateTime(m.readAt) : ''}`.trim() : 'Inte läst av kommunen än';
      return by.length ? `Läst av ${by.map((id) => MM.personName(id)).join(', ')}` : 'Oläst';
    };
    return html`<div class="split-wide">
      <${ui.Card} title="Säker tråd med kommunen" icon="lock">
        <div class="stack">
          ${msgs.length === 0 ? html`<${ui.Empty} icon="message" title="Inga meddelanden ännu">Här skriver ni med kommunens handläggare om ärendet. Det ersätter mejl med personuppgifter.<//>`
            : html`<div class="arn-thread" aria-label="Meddelanden">${msgs.map((m) => { const mine = !String(m.senderId).startsWith('k-'); return html`<div class=${cls('arn-msg', mine ? 'mine' : 'theirs')} key=${m.id}>
                <div class="row-sm small"><span class="strong">${MM.personName(m.senderId)}</span><span class="muted">${mine ? supplier : customer} · ${d.fmtDateTime(m.createdAt)}</span>${m.kind === 'meeting_request' && html`<${ui.Badge} tone="outline" icon="calendar">Kallelse till uppföljning<//>`}</div>
                <div class="arn-body">${m.body}</div>
                <div class="small muted">${readText(m)}</div>
              </div>`; })}</div>`}
          ${edit ? html`<form class="stack-sm" onSubmit=${send} noValidate>
              <${ui.Field} label="Nytt meddelande" id="arn-msg-body" error=${err} help=${`Skriv sakligt och använd ärendenumret i stället för personnummer. ${k ? k.name : 'Handläggaren'} får ett mejl utan innehåll med en uppmaning att logga in.`}>
                <${ui.TextArea} id="arn-msg-body" value=${body} onInput=${(v) => { setBody(v); if (err) setErr(null); }} rows="4" invalid=${!!err} /><//>
              <div class="row"><${ui.Btn} kind="primary" type="submit" icon="send">Skicka säkert meddelande<//></div>
            </form>` : html`<p class="small muted">${readOnly ? 'Läsläge – du kan läsa tråden men inte skriva.' : 'Huvudcoach, samordnare och avtalsansvarig skriver i tråden.'}</p>`}
        </div>
      <//>
      <div class="stack">
        <${ui.Card} title="Så fungerar det" icon="shield" tone="sub">
          <div class="stack-sm small">
            <p>Meddelandena finns bara i portalen. Löpande information till kommunen är ett avtalskrav – bristfällig information kan ge vite.</p>
            <div class="arn-label" style="margin:4px 0 0">Mejlet som skickas</div>
            <div class="demo-note"><${I} name="mail" /><div>Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.</div></div>
            <p class="muted">Inget innehåll och inga personuppgifter i mejlet.</p>
          </div>
        <//>
        <div><${CustSwitch} c=${c} tab="meddelanden" label=${(who) => `Se tråden som ${who}`} /></div>
      </div>
    </div>`;
  };

  // ---------------------------------------------------------------- Flik: Historik
  const AUDIT = {
    'case.view': 'Öppnade deltagarkortet', 'case.view_denied': 'Försökte öppna deltagarkortet utan behörighet', 'pnr.revealed': 'Visade personnumret',
    'case.created': 'Ärendet skapades', 'case.accepted': 'Avropet accepterades', 'case.declined': 'Avropet avböjdes', 'case.updated': 'Uppgifter ändrades',
    'case.buyer_reference_changed': 'Beställarreferensen ändrades', 'case.first_meeting_booked': 'Första mötet bokades', 'case.coach_changed': 'Huvudcoach byttes', 'case.closed': 'Insatsen avslutades',
    'message.sent': 'Säkert meddelande skickades', 'deviation.customer_called': 'Kommunen kallades till uppföljning', 'deviation.saved': 'Avvikelse sparades', 'deviation.created': 'Avvikelse skapades',
    'consent.given': 'Samtycke registrerades', 'consent.declined': 'Deltagaren avböjde samtycke', 'consent.revoked': 'Samtycket återkallades',
    'check_in.saved': 'Avstämning sparades som utkast', 'check_in.approved': 'Avstämning godkändes', 'assessment.saved': 'Månadsbedömning sparades', 'assessment.approved': 'Månadsbedömning godkändes',
    'intake.saved': 'Kartläggning sparades', 'intake.approved': 'Kartläggning godkändes', 'event.added': 'Händelse registrerades', 'result.verified': 'Resultat verifierades',
    'attendance.registered': 'Närvaro registrerades', 'report.approved': 'Rapport godkändes', 'report.delivered': 'Rapport levererades', 'report.corrected': 'Rapport rättades', 'report.view': 'Rapport öppnades', 'report.published': 'Rapport publicerades',
    'transcript.deleted': 'Råtranskript raderades', 'ai.run': 'AI-körning', 'audio.deleted': 'Ljudfil raderades', 'notify.email': 'E-post skickades',
  };
  const detailText = (x) => {
    const dt = x.details || {};
    if (x.action === 'case.coach_changed') return `${MM.personName(dt.from)} → ${MM.personName(dt.to)}. Orsak: ${dt.reason || '–'}`;
    if (dt.reason) return String(dt.reason);
    if (dt.status && x.entity === 'attendance') return sel.attLabel(dt.status);
    if (dt.at) return d.fmtDateTimeLong(dt.at);
    if (dt.kind) return sel.reportKindLabel(dt.kind) !== dt.kind ? sel.reportKindLabel(dt.kind) : sel.eventLabel(dt.kind);
    if (dt.fields) return `Fält: ${dt.fields.join(', ')}`;
    return '';
  };
  /** Rena visningar – egna visningar är brus i coachens logg. */
  const VIEW_ACTIONS = ['case.view', 'case.view_denied', 'report.view', 'transcript.view'];
  /** Coachens och handledarens egna åtgärder: egna poster i revisionsloggen plus det personen själv har godkänt, skickat eller registrerat
   *  (demodatan har ingen revisionslogg för äldre händelser). Dubbletter mot revisionsloggen tas bort. */
  const ownActions = (c, me, auditOwn) => {
    const have = new Set(auditOwn.map((x) => `${x.action}:${x.entityId}`));
    const haveAt = new Set(auditOwn.map((x) => `${x.action}@${x.occurredAt}`));
    const out = [];
    const push = (action, entityId, at, text) => { if (!at || have.has(`${action}:${entityId}`) || haveAt.has(`${action}@${at}`)) return; out.push({ id: `own-${action}-${entityId}`, occurredAt: at, actorId: me, action, entityId, text }); };
    for (const x of sel.checkInsOf(c.id)) if (x.status === 'approved' && x.approvedBy === me) push('check_in.approved', x.id, x.approvedAt, `Avstämningen ${fd(x.heldAt)}`);
    for (const x of sel.assessmentsOf(c.id)) if (x.status === 'approved' && x.decidedBy === me) push('assessment.approved', x.id, x.decidedAt, cap(d.monthName(x.month)));
    const ia = sel.intakeOf(c.id); if (ia && ia.status === 'approved' && ia.approvedBy === me) push('intake.approved', ia.id, ia.approvedAt, '');
    for (const m of sel.messagesOf(c.id)) if (m.senderId === me) push('message.sent', m.id, m.createdAt, m.kind === 'meeting_request' ? 'Kallelse till uppföljning' : clip(m.body, 60));
    const att = MM.groupBy(S().attendance.filter((a) => a.caseId === c.id && a.registeredBy === me && a.registeredAt && !have.has(`attendance.registered:${a.id}`)), (a) => a.registeredAt.slice(0, 10));
    for (const [day, xs] of Object.entries(att)) { const at = xs.map((a) => a.registeredAt).sort().pop(); out.push({ id: `own-att-${day}`, occurredAt: at, actorId: me, action: 'attendance.registered', entityId: null, text: fmt.plural(xs.length, 'tillfälle', 'tillfällen') }); }
    return out;
  };
  const TabHistorik = ({ c, role }) => {
    const [n, setN] = useState(25);
    const me = MM.currentPersonaId();
    // Coach och handledare ser bara statushistoriken och sina egna åtgärder. Andras poster (t.ex. vem som har öppnat kortet)
    // visas inte, så att ingen kan ana vad som följs upp på annat håll.
    const ownOnly = role === 'coach' || role === 'handledare';
    const hist = sel.historyOf(c.id);
    const repIds = new Set(sel.reportsOf(c.id).map((r) => r.id));
    const all = S().auditLog.filter((x) => x.entityId === c.id || (x.details && x.details.caseId === c.id) || (x.entity === 'report' && repIds.has(x.entityId)) || (x.entity === 'person' && x.entityId === c.personId));
    const auditOwn = ownOnly ? all.filter((x) => x.actorId === me && !VIEW_ACTIONS.includes(x.action)) : all;
    const log = (ownOnly ? [...auditOwn, ...ownActions(c, me, auditOwn)] : all).slice().sort(MM.by('occurredAt', -1));
    const items = hist.map((h) => {
      const coachChange = h.fromCoach && h.toCoach && h.fromCoach !== h.toCoach;
      const reason = sel.END_REASONS.includes(h.reason) ? sel.endReasonLabel(h.reason) : h.reason;
      return {
        icon: coachChange ? 'users' : h.toStatus === 'closed' ? 'check-square' : h.toStatus === 'declined' ? 'x-circle' : h.toStatus === 'confirmed' ? 'check' : 'inbox',
        filled: h.toStatus === 'closed', tone: h.toStatus === 'declined' ? 'red' : undefined,
        title: coachChange ? `Huvudcoach bytt: ${MM.personName(h.fromCoach)} → ${MM.personName(h.toCoach)}` : `${h.fromStatus && h.fromStatus !== h.toStatus ? `${sel.statusLabel(h.fromStatus)} → ` : ''}${sel.statusLabel(h.toStatus)}`,
        sub: `${d.fmtDateTime(h.changedAt)} · ${MM.personName(h.changedBy)}`,
        body: html`${reason && html`<div class="small">Orsak: ${reason}</div>`}${h.customerNotifiedAt && html`<div class="small muted">Handläggaren fick notis ${d.fmtDateTime(h.customerNotifiedAt)}</div>`}${!coachChange && h.toCoach && h.toStatus === 'confirmed' && html`<div class="small muted">Huvudcoach: ${MM.personName(h.toCoach)}</div>`}`,
      };
    });
    return html`<div class="split">
      <${ui.Card} title="Status och coachbyten" icon="clock">
        ${items.length ? html`<${ui.Timeline} items=${items} />` : html`<p class="small muted">Ingen historik ännu.</p>`}
      <//>
      <${ui.Card} flush title=${ownOnly ? 'Dina åtgärder i ärendet' : 'Revisionslogg för ärendet'} icon="book"
        foot=${log.length > n && html`<span class="small muted">Visar ${n} av ${log.length}</span><span class="spacer"></span><${ui.Btn} kind="secondary" icon="chevron-down" onClick=${() => setN(log.length)}>Visa alla<//>`}>
        ${ownOnly && html`<div class="card-body" style="padding-bottom:0"><p class="small muted">Här ser du det du själv har gjort i ärendet: godkända avstämningar och bedömningar, meddelanden, närvaro och ändringar. Statusändringar och coachbyten finns i kortet Status och coachbyten.</p></div>`}
        <${ui.Table} caption=${ownOnly ? 'Dina åtgärder' : 'Revisionslogg'} empty=${ownOnly ? 'Du har inte gjort några loggade ändringar i ärendet ännu.' : 'Inga loggade händelser ännu.'} rows=${log.slice(0, n)} columns=${[
          { key: 't', label: 'Tidpunkt', nowrap: true, render: (x) => d.fmtDateTime(x.occurredAt) },
          ...(ownOnly ? [] : [{ key: 'a', label: 'Vem', render: (x) => MM.personName(x.actorId) }]),
          { key: 'h', label: 'Händelse', render: (x) => html`<span>${AUDIT[x.action] || x.action}</span>${x.byTester && html`<div class="cell-sub">Gjort i prototypen</div>`}${(x.text || detailText(x)) && html`<div class="cell-sub">${clip(x.text || detailText(x), 90)}</div>`}` },
        ]} />
      <//>
    </div>`;
  };

  // ================================================================= HANDLEDARENS STARTSIDA
  const HandCard = ({ c, me }) => {
    const now = d.now();
    const myRole = ((c.team || []).find((t) => t.userId === me) || {}).role;
    const acts = sel.activitiesOf(c.id).filter((a) => a.startsAt >= now && a.kind !== 'möte').slice(0, 3);
    const pls = sel.placementsOf(c.id);
    const pl = pls.find((x) => x.status === 'ongoing') || pls.find((x) => x.status === 'planned') || null;
    const emp = pl && employer(pl.employerId);
    const contacts = sel.eventsOf(c.id).filter((e) => CONTACT_KINDS.includes(e.kind));
    const open = (tab) => MM.nav('arende.kort', { caseId: c.id, tab });
    return html`<${ui.Card} title=${c.number} icon="user" actions=${html`<${ui.CaseStatus} status=${c.status} />`}
      foot=${html`${canOpen('coach.narvaro') && c.status === 'active' && html`<${ui.Btn} kind="secondary" icon="check-square" onClick=${() => MM.nav('coach.narvaro', {})}>Närvaro<//>`}<span class="spacer"></span><${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => open('oversikt')}>Öppna<//>`}>
      <div class="stack-sm">
        <button type="button" class="arn-caselink" onClick=${() => open('oversikt')}>${sel.displayName(c)}</button>
        <div class="row-sm"><${ui.Badge} tone="bluetone" icon="user">Din roll: ${sel.teamLabel(myRole)}<//></div>
        <div class="arn-phasewrap"><${ui.PhaseBar} phase=${c.phase} /><div class="small muted">Fas ${c.phase} · ${sel.phaseName(c.phase)}${c.vocationalTrack ? ` · ${c.vocationalTrack}` : ''}</div></div>
        <div><div class="arn-label" style="margin-top:6px">Kommande moment och praktik</div><${ActList} short acts=${acts} empty="Inga planerade moment eller praktikdagar." /></div>
        <div><div class="arn-label" style="margin-top:6px">Praktikplats</div>
          ${pl ? html`<div class="stack-sm" style="gap:6px"><div><span class="strong">${emp ? emp.name : 'Arbetsgivare'}</span> <span class="small muted">· ${fd(pl.startsOn)} – ${fd(pl.endsOn)}</span></div>
              <div class="arn-flags">${FOUR.map(([key, label]) => { const okk = !pl.fourRights || pl.fourRights[key]; return html`<${ui.Badge} tone=${okk ? 'bluetone' : 'red'} icon=${okk ? 'check' : 'x'}>${label}${okk ? '' : ' saknas'}<//>`; })}</div>
              ${emp && html`<div class="small">Kontakt: ${emp.contactName} · ${emp.phone}</div>`}</div>`
            : html`<p class="small muted">${c.phase >= 3 ? 'Ingen praktik planerad ännu.' : 'Praktik planeras senare i insatsen.'}</p>`}
        </div>
        <div><div class="arn-label" style="margin-top:6px">Arbetsgivarkontakter</div>
          ${contacts.length ? html`<p class="small"><b>${fmt.plural(contacts.length, 'kontakt', 'kontakter')}.</b> Senast ${fd(contacts[0].occurredOn)}: ${sel.eventLabel(contacts[0].kind)}${contacts[0].actor ? ` – ${contacts[0].actor}` : ''}.</p>` : html`<p class="small muted">Inga registrerade ännu.</p>`}
        </div>
      </div>
    <//>`;
  };

  const HandView = ({ role }) => {
    MM.useStore();
    const me = MM.currentPersonaId(); const persona = MM.persona();
    const [group, setGroup] = useState('pagaende');
    const [limit, setLimit] = useState(12);
    const all = sel.visibleCases(role).filter((c) => (c.team || []).some((t) => t.userId === me));
    const groups = { pagaende: all.filter((c) => ['active', 'paused'].includes(c.status)), start: all.filter((c) => WAITING.includes(c.status)), avslutade: all.filter((c) => c.status === 'closed') };
    const now = d.now(); const mon = d.monday(d.today()); const sun = d.addDays(mon, 6);
    const weekActs = groups.pagaende.flatMap((c) => sel.activitiesOf(c.id).filter((a) => a.startsAt >= mon && a.startsAt <= `${sun}T23:59`).map((a) => ({ a, c })));
    const nPraktik = weekActs.filter((x) => x.a.kind === 'praktikdag').length;
    const nMoment = weekActs.filter((x) => x.a.kind === 'yrkesmoment').length;
    const missingFour = groups.pagaende.filter((c) => sel.placementsOf(c.id).some((p) => p.status === 'ongoing' && p.fourRights && Object.values(p.fourRights).some((v) => !v)));
    const upcoming = groups.pagaende.flatMap((c) => sel.activitiesOf(c.id).filter((a) => a.startsAt >= now && a.startsAt <= `${d.addDays(d.today(), 6)}T23:59` && a.kind !== 'möte').map((a) => ({ a, c })))
      .sort((x, y) => (x.a.startsAt < y.a.startsAt ? -1 : 1));
    const nextOf = (c) => { const a = sel.activitiesOf(c.id).find((x) => x.startsAt >= now && x.kind !== 'möte'); return a ? a.startsAt : '9999'; };
    const list = groups[group].slice().sort((a, b) => (nextOf(a) < nextOf(b) ? -1 : nextOf(a) > nextOf(b) ? 1 : 0));
    const [showAllUp, setShowAllUp] = useState(false);
    const up = showAllUp ? upcoming : upcoming.slice(0, 8);
    return html`<${ui.Page} title="Mina tilldelade ärenden" eyebrow=${`Handledare · ${persona ? persona.name : ''}`}
      lead="Här planerar du moment och praktik, registrerar närvaro och håller kontakten med arbetsgivarna."
      actions=${canOpen('coach.narvaro', role) && html`<${ui.Btn} kind="primary" icon="check-square" onClick=${() => MM.nav('coach.narvaro', {})}>Registrera närvaro<//>`}>
      <${ui.Notice} tone="info" icon="shield" title="Du ser bara ärenden du är tilldelad">Behörigheten styrs av teamet i varje ärende. Du ser moment, närvaro, praktik och arbetsgivarkontakter – inte coachens anteckningar, bedömningar, månadsrapporter eller slutrapporter. Saknar du ett ärende? Be samordnaren lägga till dig i teamet.<//>
      <div class="arn-kpi-row">
        <${ui.Kpi} label="Pågående ärenden" value=${groups.pagaende.length} sub=${`${groups.start.length} väntar på start`} />
        <${ui.Kpi} label="Praktikdagar" value=${nPraktik} sub=${`den här veckan (${d.fmtWeek(d.today())})`} />
        <${ui.Kpi} label="Yrkesmoment" value=${nMoment} sub=${`den här veckan (${d.fmtWeek(d.today())})`} />
        <${ui.Kpi} label="Praktik som saknar något av de fyra rätten" value=${missingFour.length} sub=${missingFour.length ? 'komplettera före nästa uppföljning' : 'alla praktikplatser är kompletta'} tone=${missingFour.length ? 'watch' : undefined} />
      </div>
      <div class="split">
        <${ui.Card} title="Kommande sju dagar" icon="calendar" flush
          foot=${upcoming.length > 8 && html`<span class="small muted">Visar ${up.length} av ${upcoming.length}</span><span class="spacer"></span><${ui.Btn} kind="ghost" onClick=${() => setShowAllUp(!showAllUp)}>${showAllUp ? 'Visa färre' : 'Visa alla'}<//>`}>
          ${up.length === 0 ? html`<div class="card-body"><p class="small muted">Inga moment eller praktikdagar de närmaste sju dagarna.</p></div>` : html`<div class="list">${up.map(({ a, c }) => html`<button type="button" class="list-item clickable" key=${a.id} onClick=${() => MM.nav('arende.kort', { caseId: c.id })}>
            <${I} name=${actIcon(a)} /><div class="li-main"><div class="li-title">${cap(d.fmtWeekday(a.startsAt))} kl. ${d.fmtTime(a.startsAt)} · ${actLabel(a)}</div><div class="li-sub">${sel.displayName(c)} · ${c.number} · ${a.location}</div></div></button>`)}</div>`}
        <//>
        <${ui.Card} title="Praktikplatser att följa upp" icon="briefcase" flush>
          ${missingFour.length === 0 ? html`<div class="card-body"><p class="small muted">Alla pågående praktikplatser har de fyra rätten.</p></div>` : html`<div class="list">${missingFour.map((c) => { const pl = sel.placementsOf(c.id).find((p) => p.status === 'ongoing'); const emp = pl && employer(pl.employerId); const miss = FOUR.filter(([key]) => pl && pl.fourRights && !pl.fourRights[key]).map((m) => m[1].toLowerCase());
            return html`<button type="button" class="list-item clickable" key=${c.id} onClick=${() => MM.nav('arende.kort', { caseId: c.id, tab: 'praktik' })}><${I} name="alert-circle" cls="ic-red" /><div class="li-main"><div class="li-title">${emp ? emp.name : 'Praktikplats'}</div><div class="li-sub">${sel.displayName(c)} · ${c.number}</div><div class="small">Saknas: ${miss.join(', ')}</div></div></button>`; })}</div>`}
        <//>
      </div>
      <div class="row-between">
        <${ui.Seg} ariaLabel="Visa ärenden" value=${group} onChange=${(v) => { setGroup(v); setLimit(12); }} options=${[{ value: 'pagaende', label: `Pågående (${groups.pagaende.length})` }, { value: 'start', label: `Väntar på start (${groups.start.length})` }, { value: 'avslutade', label: `Avslutade (${groups.avslutade.length})` }]} />
        <span class="small muted">Sorterat efter nästa moment eller praktikdag</span>
      </div>
      ${list.length === 0 ? html`<${ui.Card}><${ui.Empty} icon="users" title="Inga ärenden här">${group === 'pagaende' ? 'Du är inte tilldelad något pågående ärende just nu.' : 'Inga ärenden i den här gruppen.'}<//><//>`
        : html`<div class="grid">${list.slice(0, limit).map((c) => html`<${HandCard} key=${c.id} c=${c} me=${me} />`)}</div>`}
      ${list.length > limit && html`<div class="row"><span class="small muted">Visar ${limit} av ${list.length}</span><${ui.Btn} kind="secondary" icon="chevron-down" onClick=${() => setLimit(limit + 12)}>Visa fler<//></div>`}
      <${ui.DemoNote}>I testdatan är Petra yrkesspecifik handledare för lager, logistik, transport och industri och finns därför i teamet för de ärendena. Kommunen ser inte den här vyn – de ser närvaron i veckorapporten.<//>
    <//>`;
  };

  // ================================================================= Registrering
  /** Omslag med klassen arn-root: gör att filens stilar (t.ex. radbrytning i knappar på smal skärm) bara gäller de här vyerna. */
  const root = (C) => (props) => html`<div class="arn-root"><${C} ...${props} /></div>`;
  MM.registerView('arenden.lista', { title: 'Ärenden', roles: CASE_ROLES, component: root(ListView) });
  MM.registerView('arende.kort', {
    title: (p) => { try { const c = p && p.caseId ? sel.caseById(p.caseId) : null; return c ? `Deltagarkort ${c.number}` : 'Deltagarkort'; } catch (e) { return 'Deltagarkort'; } },
    roles: CASE_ROLES, component: root(KortView),
  });
  MM.registerView('hand.start', { title: 'Mina tilldelade ärenden', roles: ['handledare'], component: root(HandView) });
})();
