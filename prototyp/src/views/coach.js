// views/coach.js – coachens vardag: Min vecka, närvaro, veckoavstämning (manuellt eller med AI-stöd),
// månadsbedömning, kartläggning vecka 1 samt händelser och avslut.
// Roll: coach (Amira Haddad). Närvaro även för handledare (teamärenden).
// Regler: coachen ser bara sina ärenden och aldrig eskaleringar till chef. AI föreslår – människan bedömer.
(() => {
  const { html, useState, useEffect, useRef, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const SC = MM.seedConstants;
  const S = () => MM.store.state;
  const cls = MM.cls;

  // ------------------------------------------------------------ Stilar för coachvyerna (bara MB-tokens)
  const CSS = `
  .co-kpis .kpi { min-height: 100%; }
  @media (max-width: 620px) { .co-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .co-kpis .kpi { padding: 12px; } .co-kpis .kpi-value { font-size: 1.625rem; } }
  .co-wrap { flex-wrap: wrap; }
  @media (max-width: 620px) { .co-wrap > .li-side { flex-basis: 100%; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-start; } .co-wrap.co-list-item > .li-side { padding-left: 76px; } }
  .co-pair { display: grid; gap: 12px 20px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  @media (min-width: 1100px) { .co-pair { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
  .co-list-time { flex: none; width: 64px; display: flex; flex-direction: column; gap: 2px; }
  .co-list-time .t { font-weight: 800; font-size: 1.0625rem; font-variant-numeric: tabular-nums; }
  .co-list-item.is-past { background: var(--surface-sub); }
  .co-list-item.is-next { box-shadow: inset 4px 0 0 var(--rod); }
  .co-cal { display: grid; gap: 10px; grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .co-day { border: 1px solid var(--line); border-radius: var(--radius); display: flex; flex-direction: column; min-width: 0; background: var(--vit); }
  .co-day.today { border-color: var(--antracit); box-shadow: inset 0 4px 0 var(--rod); }
  .co-day-head { padding: 10px 10px 8px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 4px 6px; }
  .co-day-head .wd { font-size: var(--fs-label); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
  .co-day-body { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
  .co-ev { display: flex; flex-direction: column; gap: 1px; text-align: left; border: 1px solid var(--line); border-left: 4px solid var(--antracit); border-radius: 4px;
    padding: 6px 8px; background: var(--vit); font: inherit; font-size: 0.8125rem; line-height: 1.35; color: var(--antracit); cursor: pointer; min-height: 44px; width: 100%; min-width: 0; }
  .co-ev:hover { background: var(--surface-sub); }
  .co-ev .ev-top { display: flex; align-items: center; gap: 4px; font-weight: 700; }
  .co-ev .ev-top .ic { width: 14px; height: 14px; margin-left: auto; }
  .co-ev .ev-names { color: var(--fg-muted); overflow-wrap: anywhere; }
  .co-ev.k-yrke { border-left-color: var(--bla); }
  .co-ev.k-praktik { border-left: 4px dashed var(--antracit); }
  .co-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: var(--fs-small); color: var(--fg-muted); }
  .co-legend span.sw { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
  @media (max-width: 1100px) {
    .co-cal { grid-template-columns: minmax(0, 1fr); }
    .co-day-body { flex-direction: row; flex-wrap: wrap; }
    .co-ev { width: auto; flex: 1 1 170px; }
  }
  .co-att { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 10px 18px; align-items: start; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  .co-att:last-child { border-bottom: 0; }
  .co-att.is-done { background: var(--surface-sub); }
  .co-att-when { flex: none; width: 58px; }
  .co-att-when .t { font-weight: 800; font-size: 1.0625rem; font-variant-numeric: tabular-nums; }
  .co-att-info { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .co-att-act { grid-column: 2; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  @media (max-width: 560px) { .co-att-act { grid-column: 1 / -1; } }
  .co-att-reason { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1.5px solid var(--antracit); border-radius: var(--radius); }
  .co-dayhead { padding: 10px 18px; background: var(--surface-sub2); font-size: var(--fs-label); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .co-counter { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; }
  .co-counter .big { font-size: 2.5rem; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .co-casehead { display: flex; gap: 12px; align-items: center; min-width: 0; }
  .co-section { display: flex; flex-direction: column; gap: 10px; padding: 16px 0; border-bottom: 1px solid var(--line); }
  .co-section:first-child { padding-top: 0; }
  .co-section:last-child { border-bottom: 0; padding-bottom: 0; }
  .co-section-title { font-weight: 800; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 1rem; }
  .co-section-title .n { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--antracit); font-size: 0.8125rem; flex: none; }
  .co-section.is-ok .co-section-title .n { background: var(--bla); border-color: var(--bla); }
  .co-timer { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; padding: 6px 12px; border-radius: 999px; background: var(--bla-ton2); color: var(--antracit); font-variant-numeric: tabular-nums; }
  .co-timer.over { background: var(--vit); border: 2px solid var(--rod); }
  .co-proc { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1.5px solid var(--bla); border-radius: var(--radius); background: var(--bla-ton); }
  .co-proc .step { display: flex; align-items: center; gap: 8px; }
  .co-proc .step.todo { color: var(--fg-muted); }
  .co-proc .step.now { font-weight: 800; }
  .co-transcript { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 0.9375rem; }
  .co-transcript .seg-t { font-variant-numeric: tabular-nums; font-weight: 700; margin-right: 8px; }
  .co-consent-text { border-left: 4px solid var(--bla); padding: 10px 14px; background: var(--vit); display: flex; flex-direction: column; gap: 6px; }
  .co-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .co-chip { border: 1.5px dashed var(--line-strong); background: var(--vit); border-radius: 999px; padding: 6px 12px; min-height: 44px; font: inherit; font-size: 0.875rem; cursor: pointer; color: var(--antracit); text-align: left; }
  .co-chip:hover { border-color: var(--antracit); }
  .cm-area { font-weight: 700; min-width: 150px; }
  .cm-table td { min-width: 0; }
  .cm-table td.cm-obs { min-width: 260px; }
  .cm-table select { min-width: 150px; }
  .cm-table tr.row-alert td:first-child { box-shadow: inset 4px 0 0 var(--rod); }
  @media (max-width: 760px) {
    .cm-table thead { display: none; }
    .cm-table, .cm-table tbody, .cm-table tr, .cm-table td { display: block; width: 100%; }
    .cm-table tr { border-bottom: 2px solid var(--line); padding: 8px 0; }
    .cm-table td { border-bottom: 0; padding: 6px 4px; }
    .cm-table td.cm-obs, .cm-table select { min-width: 0; }
    .cm-table td[data-label]::before { content: attr(data-label); display: block; font-size: var(--fs-label); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-muted); margin-bottom: 4px; }
    .cm-table tr.row-alert td:first-child { box-shadow: none; }
    .cm-table tr.row-alert { box-shadow: inset 4px 0 0 var(--rod); padding-left: 8px; }
  }
  `;
  if (typeof document !== 'undefined' && !document.getElementById('coach-view-css')) {
    const el = document.createElement('style'); el.id = 'coach-view-css'; el.textContent = CSS; document.head.appendChild(el);
  }

  // ------------------------------------------------------------ Hjälpare
  const KIND = {
    'möte': { label: 'Coachträff', icon: 'message-circle', cls: 'k-mote' },
    yrkesmoment: { label: 'Yrkesmoment', icon: 'tool', cls: 'k-yrke' },
    praktikdag: { label: 'Praktikdag', icon: 'briefcase', cls: 'k-praktik' },
  };
  const kindOf = (k) => KIND[k] || { label: k || 'Aktivitet', icon: 'calendar', cls: '' };
  const ATT = {
    present: { label: 'Närvarande', icon: 'check-circle', tone: 'blue', seg: 'green' },
    late: { label: 'Sen', icon: 'clock', tone: 'grey', seg: 'yellow' },
    absent_valid: { label: 'Giltig frånvaro', icon: 'minus-circle', tone: 'outline' },
    absent_invalid: { label: 'Ogiltig frånvaro', icon: 'x-circle', tone: 'red', seg: 'red' },
  };
  const ATT_OPTIONS = ['present', 'late', 'absent_valid', 'absent_invalid'].map((k) => ({ value: k, label: ATT[k].label, icon: ATT[k].icon, tone: ATT[k].seg }));
  const AttBadge = ({ at }) => {
    if (!at) return html`<${ui.Badge} tone="outline" icon="circle">Ej registrerad<//>`;
    const a = ATT[at.status] || ATT.present;
    return html`<${ui.Badge} tone=${a.tone} icon=${a.icon}>${a.label}${at.status === 'absent_valid' && at.reason ? ` · ${at.reason}` : ''}<//>`;
  };
  const me = () => MM.currentPersonaId();
  /** Coachen: bara ärenden där hen är huvudcoach. Handledare: ärenden där hen ingår i teamet. */
  const myCases = (role = MM.role(), pid = me()) => S().cases.filter((c) => (role === 'coach' ? c.leadCoachId === pid : sel.access(c, role, pid) === 'team'));
  const nameOf = (c) => sel.displayName(c);
  const shortName = (c) => {
    const p = sel.person(c); const a = sel.access(c);
    if (!p || !['full', 'team'].includes(a) || p.protectedIdentity) return nameOf(c);
    return `${p.firstName} ${p.lastName.charAt(0)}.`;
  };
  const isProtected = (c) => !!((sel.person(c) || {}).protectedIdentity);
  const prevMonth = () => d.addMonths(d.monthKey(d.today()), -1);
  const monShort = (mk) => d.MON[Number(mk.slice(5, 7)) - 1];
  const slaCfg = (key) => MM.cfg().sla.find((s) => s.key === key) || {};
  const regTime = () => slaCfg('veckorapport_registrering').time || '10:00';
  const regDueFor = (weekMonday) => { const s = slaCfg('veckorapport_registrering'); return `${d.addDays(weekMonday, 7 + (s.weekday || 0))}T${regTime()}`; };
  const regDueText = () => `${d.WD[slaCfg('veckorapport_registrering').weekday || 0]} ${regTime().replace(':', '.')}`;
  const pubTimeText = () => `${d.WD[slaCfg('veckorapport_publicering').weekday || 0]} ${(slaCfg('veckorapport_publicering').time || '16:00').replace(':', '.')}`;
  const monthNth = () => ((slaCfg('manadsrapport').proposal || {}).nthWorkingDay) || 5;
  const monthDueFor = (mk) => `${d.nthWorkingDay(d.addMonths(mk, 1), monthNth())}T23:59`;
  const monthDueNote = () => (MM.isUnset(slaCfg('manadsrapport').due) ? `Ej fastställd deadline – förslag ${monthNth()}:e arbetsdagen` : 'Deadline enligt avtalet');
  /** Visa länk till en annan vy om den inte uttryckligen stänger ute rollen. */
  const canOpen = (view, role = MM.role()) => { const v = MM.views[view]; return !v || !Array.isArray(v.roles) || v.roles.includes(role); };
  const go = (view, params = {}) => MM.nav(view, params);
  const referrerOf = (c) => (c ? S().customerUsers.find((u) => u.id === c.referrerId) || null : null);
  const customerRoleFor = (c) => (c && c.referrerId === MM.roleDef('kommun_handlaggare').personaId ? 'kommun_handlaggare' : 'kommun_chef');
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const dayLabel = (day) => `${d.WD_SHORT[d.weekday(day)]} ${d.fmtDateShort(day)}`;
  const GOAL_TEXT = { yes: 'Ja', partly: 'Delvis', no: 'Nej' };
  const GOAL_OPTIONS = [{ value: 'yes', label: 'Ja', icon: 'check' }, { value: 'partly', label: 'Delvis', icon: 'minus' }, { value: 'no', label: 'Nej', icon: 'x' }];
  const MODE_OPTIONS = [{ value: 'fysiskt', label: 'Fysiskt', icon: 'users' }, { value: 'telefon', label: 'Telefon', icon: 'phone' }, { value: 'video', label: 'Video', icon: 'video' }];
  const EC_TYPES = ['ansökan', 'intervju', 'praktikkontakt', 'studiebesök'];
  const STATUS_OPTIONS = ['green', 'yellow', 'red'].map((v) => ({ value: v, label: ui.STATUS_TEXT[v], icon: ui.STATUS_ICON[v], tone: v }));
  const phaseOptions = () => MM.cfg().phases.map((p) => ({ value: p.no, label: `${p.no} ${p.name}` }));
  const bonusOn = () => !!(MM.cfg().bonus && MM.cfg().bonus.enabled === true);

  /** Deltagarhuvud i ärendevyerna. */
  const CaseHead = ({ c }) => html`<div class="co-casehead">
    <${ui.Avatar} name=${nameOf(c)} />
    <div class="stack-sm" style="gap:4px;min-width:0">
      <div class="row-sm"><span class="strong">${nameOf(c)}</span><span class="mono small muted nowrap">${c.number}</span>${isProtected(c) && html`<${ui.Badge} tone="dark" icon="lock">Skyddade personuppgifter<//>`}</div>
      <div class="row-sm"><${ui.PhaseTag} phase=${c.phase} /><${ui.CaseStatus} status=${c.status} /><span class="small muted">${sel.areaName(c.primaryArea)} · ${c.vocationalTrack || 'Yrkesspår inte valt'}</span></div>
    </div>
  </div>`;

  /** Kontroll att rollen får arbeta i ärendet. Returnerar null om det är ok. */
  const gate = (c, role = MM.role()) => {
    if (!c) return { title: 'Ärendet finns inte', text: 'Välj ett av dina ärenden i listan.' };
    const a = sel.access(c, role);
    if (role === 'coach' && a !== 'full') return { title: 'Inte ditt ärende', text: 'Coachen ser bara de ärenden där hen är huvudcoach. Kontakta samordnaren om du behöver åtkomst.' };
    if (a === 'none') return { title: 'Ingen åtkomst', text: 'Du har inte behörighet till ärendet.' };
    return null;
  };
  const GateView = ({ g, title, view }) => html`<${ui.Page} title=${title} crumbs=${[{ label: 'Min vecka', view: 'coach.minvecka' }, { label: title }]}>
    <${ui.Notice} tone="warn" title=${g.title}>${g.text}<//>
    <div class="row"><${ui.Btn} kind="primary" icon="list" onClick=${() => go(view, {})}>Välj bland dina ärenden<//></div>
  <//>`;

  /** Lista över coachens ärenden när vyn öppnas utan ärende. */
  const CasePicker = ({ view, title, lead, extra = {}, statusOf, actionLabel = 'Öppna', filter }) => {
    MM.useStore();
    const cases = myCases().filter((c) => (filter ? filter(c) : c.status === 'active')).sort(MM.by('number'));
    return html`<${ui.Page} title=${title} lead=${lead} crumbs=${[{ label: 'Min vecka', view: 'coach.minvecka' }, { label: title }]}>
      <${ui.Card} title="Välj deltagare" icon="users" flush>
        ${cases.length === 0 ? html`<${ui.Empty} icon="users" title="Inga ärenden">Du har inga aktiva ärenden just nu.<//>`
          : html`<div class="list">${cases.map((c) => html`<div class="list-item" key=${c.id}>
            <${ui.Avatar} name=${nameOf(c)} />
            <div class="li-main"><div class="li-title">${nameOf(c)}</div><div class="li-sub">${c.number} · ${sel.phaseLabel(c.phase)}</div>${statusOf && html`<div class="row-sm">${statusOf(c)}</div>`}</div>
            <div class="li-side"><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => go(view, { caseId: c.id, ...extra })}>${actionLabel}<//></div>
          </div>`)}</div>`}
      <//>
    <//>`;
  };

  /** Dokumentationstid (mål under 5 minuter, SPEC §7.5 och §8.5). Egen komponent så att bara klockan ritas om. */
  const DocTimer = ({ start, stopped }) => {
    const [, setTick] = useState(0);
    useEffect(() => { if (stopped != null) return undefined; const id = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(id); }, [stopped]);
    const secs = Math.max(0, Math.round(((stopped != null ? stopped : Date.now()) - start) / 1000));
    const m = Math.floor(secs / 60); const s = secs % 60;
    const over = m >= 5;
    return html`<span class=${cls('co-timer', over && 'over')} role="timer" aria-live="off"><${I} name=${over ? 'alert-circle' : 'clock'} />Dokumentationstid: ${m} min ${String(s).padStart(2, '0')} s<span class="small" style="font-weight:600">· mål under 5 min</span></span>`;
  };

  // ============================================================ MIN VECKA
  /** Slår ihop tillfällen med samma tid och typ (t.ex. gemensamt yrkesmoment) till en rad i kalendern. */
  const groupSlots = (list) => { const out = []; const idx = {}; for (const a of list) { const k = `${a.startsAt}|${a.kind}`; if (idx[k] == null) { idx[k] = out.length; out.push([]); } out[idx[k]].push(a); } return out; };
  const WeekCalendar = ({ cases, mon }) => {
    const st = S(); const ids = new Set(cases.map((c) => c.id)); const now = d.now(); const today = d.today();
    const end = d.addDays(mon, 5);
    const acts = st.activities.filter((a) => ids.has(a.caseId) && a.startsAt >= mon && a.startsAt < end).sort(MM.by('startsAt'));
    const byDay = MM.groupBy(acts, (a) => a.startsAt.slice(0, 10));
    const caseOf = (id) => cases.find((c) => c.id === id);
    return html`<div class="stack-sm" style="gap:12px">
      <div class="co-cal">
        ${[0, 1, 2, 3, 4].map((i) => { const day = d.addDays(mon, i); const list = byDay[day] || []; const hol = d.holidayName(day);
          return html`<div class=${cls('co-day', day === today && 'today')} key=${day}>
            <div class="co-day-head"><span class="wd">${d.WD[i]} ${d.fmtDateShort(day)}</span>${day === today ? html`<${ui.Badge} tone="dark">I dag<//>` : html`<span class="small muted">${list.length} tillfällen</span>`}</div>
            <div class="co-day-body">
              ${hol && html`<span class="small muted">${hol}</span>`}
              ${list.length === 0 && !hol && html`<span class="small muted">Inga aktiviteter</span>`}
              ${groupSlots(list).map((grp) => { const a = grp[0]; const k = kindOf(a.kind); const past = a.startsAt < now;
                const regd = grp.filter((x) => sel.attendanceFor(x.id)).length; const open = past ? grp.length - regd : 0;
                const names = grp.map((x) => shortName(caseOf(x.caseId)));
                const single = grp.length === 1; const at = single ? sel.attendanceFor(a.id) : null;
                const target = single && a.kind === 'möte' ? ['coach.avstamning', { caseId: a.caseId }] : ['coach.narvaro', { week: mon === d.monday(today) ? 'this' : 'last' }];
                const icon = single ? (at ? ATT[at.status].icon : past ? 'circle' : null) : past ? (open ? 'circle' : 'check-circle') : null;
                return html`<button type="button" key=${a.id} class=${cls('co-ev', k.cls)} onClick=${() => go(target[0], target[1])}
                  aria-label=${`${d.fmtTime(a.startsAt)} ${k.label} med ${names.join(', ')}${past ? (open ? `, ${open} ej registrerade` : ', närvaro registrerad') : ''}`}>
                  <span class="ev-top">${d.fmtTime(a.startsAt)} · ${k.label}${!single ? ` (${grp.length})` : ''}${icon && html`<${I} name=${icon} />`}</span>
                  <span class="ev-names">${single ? names[0] : names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ')}</span>
                </button>`; })}
            </div>
          </div>`; })}
      </div>
      <div class="co-legend" aria-hidden="true">
        <span><span class="sw" style="background:var(--antracit)"></span>Coachträff</span>
        <span><span class="sw" style="background:var(--bla)"></span>Yrkesmoment</span>
        <span><span class="sw" style="border:2px dashed var(--antracit)"></span>Praktikdag</span>
        <span class="row-sm" style="gap:4px"><${I} name="check-circle" />närvaro registrerad</span>
        <span class="row-sm" style="gap:4px"><${I} name="circle" />passerat, något ej registrerat</span>
        <span>(3) = antal deltagare vid gemensamt tillfälle</span>
      </div>
    </div>`;
  };

  const FlagItem = ({ a }) => {
    const [open, setOpen] = useState(false); const [plan, setPlan] = useState('');
    const primary = a.kind === 'stuck' && a.caseId ? ['coach.kartlaggning', { caseId: a.caseId }, 'Slutför kartläggningen']
      : a.kind === 'absence' && a.caseId ? ['coach.avstamning', { caseId: a.caseId }, 'Gör avstämning']
        : a.link ? [a.link.view, a.link.params, 'Öppna'] : null;
    const id = `ack-${a.key.replace(/[^a-z0-9]/gi, '-')}`;
    return html`<div class="list-item">
      <${I} name=${a.severity === 'critical' ? 'alert' : 'flag'} size="lg" cls=${a.severity === 'critical' ? 'ic-red' : ''} />
      <div class="li-main">
        <div class="row-sm"><${ui.Badge} tone=${a.severity === 'critical' ? 'red' : 'grey'} icon=${a.severity === 'critical' ? 'alert' : 'flag'}>${a.severity === 'critical' ? 'Åtgärd krävs' : 'Bevaka'}<//></div>
        <div class="li-title">${a.title}</div>
        <div class="small">${a.text}</div>
        <div class="row-sm">
          ${primary && html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => go(primary[0], primary[1])}>${primary[2]}<//>`}
          ${!open && html`<${ui.Btn} kind="ghost" icon="check" onClick=${() => setOpen(true)}>Kvittera<//>`}
        </div>
        ${open && html`<div class="stack-sm" style="margin-top:6px">
          <${ui.Field} label="Kort åtgärd" id=${id} help="Skriv vad du gör åt flaggan. Kvitteringen loggas.">
            <${ui.Input} id=${id} value=${plan} onInput=${setPlan} maxLength=${160} />
          <//>
          <div class="row-sm"><${ui.Btn} kind="primary" icon="check" disabled=${!plan.trim()} onClick=${() => { MM.dispatch('alert.ack', { key: a.key, plan: plan.trim() }); MM.toast('Flaggan är kvitterad.', 'blue'); }}>Spara kvittering<//>
            <${ui.Btn} kind="ghost" onClick=${() => setOpen(false)}>Avbryt<//></div>
        </div>`}
      </div>
    </div>`;
  };

  const MinVecka = () => {
    const st = MM.useStore();
    const pid = me(); const role = MM.role();
    const now = d.now(); const today = d.today(); const mon = d.monday(today); const lastMon = d.addDays(mon, -7);
    const wLast = d.isoWeek(lastMon).week;
    const cases = myCases(); const active = cases.filter((c) => c.status === 'active');
    const caseIds = new Set(cases.map((c) => c.id));
    const caseOf = (id) => cases.find((c) => c.id === id);
    const [showAllMa, setShowAllMa] = useState(false);

    const unreg = sel.unregistered(pid, lastMon, d.addDays(lastMon, 6));
    const regDue = regDueFor(lastMon); const regSla = sel.slaStatus(regDue);
    const unregByCase = MM.groupBy(unreg, (x) => x.case.id);
    const waitingReports = st.reports.filter((r) => r.kind === 'weekly_attendance' && r.week === d.isoWeek(lastMon).key && r.status === 'waiting' && cases.some((c) => c.referrerId === r.recipientUserId));

    const todays = st.activities.filter((a) => a.startsAt.slice(0, 10) === today && active.some((c) => c.id === a.caseId)).sort(MM.by('startsAt'));
    const next = todays.find((a) => a.startsAt >= now);
    const drafts = st.checkIns.filter((x) => x.status === 'draft' && x.ai && caseIds.has(x.caseId)).sort(MM.by('heldAt'));
    const pm = prevMonth();
    const assessments = cases.map((c) => ({ c, ma: sel.assessment(c.id, pm) })).filter((x) => x.ma);
    const maOpen = assessments.filter((x) => x.ma.status !== 'approved').sort((a, b) => (a.c.number < b.c.number ? -1 : 1));
    const maDone = assessments.length - maOpen.length;
    const maDue = monthDueFor(pm);
    const reminders = sel.progressionWatch({ coachId: pid });
    const flags = sel.alerts({ role: 'coach', personaId: pid }).filter((a) => !['no_progress', 'ai_draft'].includes(a.kind) && !/escalat/i.test(a.kind));
    const unread = sel.notificationsFor(pid, role).filter((n) => !n.readAt && n.kind !== 'progress_escalation');
    const due = sel.deadlines({ days: 7, coachId: pid }).filter((x) => x.kind !== 'veckorapport_registrering');
    const dueMonthly = due.filter((x) => x.kind === 'manadsrapport');
    const dueOther = due.filter((x) => x.kind !== 'manadsrapport');
    const repStatus = (x) => (st.reports.find((r) => r.id === x.reportId) || {}).status;
    const monthlyByStatus = MM.groupBy(dueMonthly, repStatus);
    const ciToday = (caseId) => sel.checkInsOf(caseId).find((x) => x.heldAt.slice(0, 10) === today);
    const persona = MM.persona();
    const maRows = showAllMa ? maOpen : maOpen.slice(0, 5);

    return html`<${ui.Page} title="Min vecka" eyebrow=${persona ? `${persona.name} · ${persona.title}` : ''}
      lead=${`${cap(d.fmtWeekday(today))} · vecka ${d.isoWeek(today).week}. Det här behöver du göra i dag och under veckan – det mest brådskande överst.`}
      actions=${html`<${ui.Btn} kind="primary" icon="check-square" onClick=${() => go('coach.narvaro', { week: unreg.length ? 'last' : 'this' })}>Registrera närvaro<//>`}>

      <div class="grid-4 co-kpis">
        <${ui.Kpi} label="Närvaro att registrera" value=${String(unreg.length)} tone=${unreg.length > 0 && ['urgent', 'over'].includes(regSla.tone) ? 'alert' : undefined}
          sub=${unreg.length > 0 ? `Vecka ${wLast} · senast ${regDueText()} · ${regSla.label.toLowerCase()}` : `Vecka ${wLast} är klar`} />
        <${ui.Kpi} label="Aktiviteter i dag" value=${String(todays.length)} sub=${next ? `Nästa ${d.fmtTime(next.startsAt)}: ${kindOf(next.kind).label.toLowerCase()} med ${shortName(caseOf(next.caseId))}` : 'Inga fler aktiviteter i dag'} />
        <${ui.Kpi} label="AI-utkast att granska" value=${String(drafts.length)} sub=${drafts.length > 0 ? 'Råtranskript raderas när du godkänner' : 'Inget väntar'} />
        <${ui.Kpi} label=${`Månadsbedömningar ${monShort(pm)}`} value=${`${maDone} av ${assessments.length}`} sub=${`klara · förslag senast ${d.fmtDateShort(maDue)}`} />
      </div>

      <div class="split-wide">
        <div class="stack">
          <${ui.Card} title=${`Närvaro att registrera – vecka ${wLast}`} icon="check-square" tone=${unreg.length > 0 ? 'red' : undefined}
            actions=${unreg.length > 0 ? html`<${ui.SlaBadge} dueAt=${regDue} prefix="Registrera" />` : html`<${ui.Badge} tone="blue" icon="check">Klart<//>`}>
            ${unreg.length > 0 ? html`<div class="stack">
              <p><b>${unreg.length} tillfällen</b> från förra veckan saknar närvaro. Registrera senast <b>${regDueText()}</b>. Veckorapporten till varje handläggare publiceras automatiskt när alla handläggarens deltagare är registrerade, senast ${pubTimeText()}.</p>
              <div class="list" style="border:1px solid var(--line);border-radius:var(--radius)">
                ${Object.entries(unregByCase).map(([cid, rows]) => { const c = caseOf(cid); return html`<div class="list-item" key=${cid}>
                  <div class="li-main"><div class="li-title">${nameOf(c)} <span class="mono small muted nowrap">${c.number}</span></div>
                    <div class="li-sub">${rows.map((x) => `${dayLabel(x.activity.startsAt)} ${lc(kindOf(x.activity.kind).label)}`).join(' · ')}</div></div>
                  <div class="li-side"><${ui.Badge} tone="outline">${rows.length} kvar<//></div>
                </div>`; })}
              </div>
              ${waitingReports.length > 0 && html`<${ui.Notice} tone="warn" title="Väntar på dig">${waitingReports.map((r) => `Veckorapporten till ${MM.personName(r.recipientUserId)}`).join(', ')} publiceras när dina tillfällen är registrerade.<//>`}
              <div class="row">
                <${ui.Btn} kind="primary" icon="check-square" onClick=${() => go('coach.narvaro', { week: 'last' })}>Registrera närvaro för vecka ${wLast}<//>
                <${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.rapporter" label="Se vad handläggaren får" />
              </div>
            </div>` : html`<${ui.Notice} tone="ok" title=${`Allt är registrerat för vecka ${wLast}`}>Veckorapporterna till handläggarna publiceras automatiskt.<//>`}
          <//>

          <${ui.Card} title=${`I dag – ${d.fmtWeekday(today)}`} icon="calendar" flush>
            ${todays.length === 0 ? html`<${ui.Empty} icon="calendar" title="Inga aktiviteter i dag" />` : html`<div class="list">
              ${todays.map((a) => { const c = caseOf(a.caseId); const k = kindOf(a.kind); const past = a.startsAt < now; const at = sel.attendanceFor(a.id); const ci = a.kind === 'möte' ? ciToday(c.id) : null;
                return html`<div key=${a.id} class=${cls('list-item co-list-item co-wrap', past && 'is-past', next && next.id === a.id && 'is-next')}>
                  <div class="co-list-time"><span class="t">${d.fmtTime(a.startsAt)}</span><span class="small muted">${a.durationMin} min</span></div>
                  <div class="li-main">
                    <div class="li-title">${nameOf(c)}</div>
                    <div class="li-sub">${k.label} · ${a.location} · <span class="nowrap">${c.number}</span></div>
                    <div class="row-sm">
                      ${next && next.id === a.id && html`<${ui.Badge} tone="dark" icon="clock">Nästa · ${d.relative(a.startsAt)}<//>`}
                      ${past && html`<${AttBadge} at=${at} />`}
                      ${ci && html`<${ui.Badge} tone=${ci.status === 'approved' ? 'blue' : 'outline'} icon=${ci.status === 'approved' ? 'check' : 'edit'}>${ci.status === 'approved' ? 'Avstämning godkänd' : 'Avstämning påbörjad'}<//>`}
                    </div>
                  </div>
                  <div class="li-side">
                    ${a.kind === 'möte' && !(ci && ci.status === 'approved') && html`<${ui.Btn} kind="secondary" icon="edit" onClick=${() => go('coach.avstamning', ci ? { caseId: c.id, checkInId: ci.id } : { caseId: c.id })}>Avstämning<//>`}
                    ${past && !at && html`<${ui.Btn} kind="ghost" onClick=${() => go('coach.narvaro', { week: 'this' })}>Registrera<//>`}
                  </div>
                </div>`; })}
            </div>`}
          <//>

          <${ui.Card} title="AI-utkast att granska" icon="sparkles" actions=${html`<${ui.BuildPhase} fas=${2} />`} flush>
            ${drafts.length === 0 ? html`<${ui.Empty} icon="sparkles" title="Inga AI-utkast väntar">När du spelar in en avstämning med samtycke hamnar utkastet här.<//>` : html`<div class="list">
              ${drafts.map((ci) => { const c = caseOf(ci.caseId); return html`<div class="list-item co-wrap" key=${ci.id}>
                <${ui.AiTag}>AI-utkast<//>
                <div class="li-main">
                  <div class="li-title">${nameOf(c)} <span class="mono small muted nowrap">${c.number}</span></div>
                  <div class="li-sub">Avstämning ${d.fmtDateTimeLong(ci.heldAt)} · ${ci.inputMethod === 'teams' ? 'Teams-transkript' : ci.inputMethod === 'notes' ? 'inklistrade anteckningar' : 'inspelning'}</div>
                  <div class="small">${ci.ai.audioDeletedAt ? `Ljudet raderades ${d.fmtDateTime(ci.ai.audioDeletedAt)}. ` : ''}Råtranskriptet raderas när du godkänner, senast ${d.fmtDate(ci.ai.rawTranscriptDeleteBy)}.</div>
                </div>
                <div class="li-side"><${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => go('coach.avstamning', { caseId: c.id, checkInId: ci.id })}>Granska<//></div>
              </div>`; })}
            </div>`}
          <//>

          <${ui.Card} title=${`Månadsbedömningar – ${d.monthName(pm)}`} icon="clipboard"
            actions=${html`<${ui.Badge} tone="plan" icon="clock" title=${monthDueNote()}>Förslag: senast ${d.fmtWeekday(maDue)}<//>`}>
            <div class="stack">
              <div class="stack-sm">
                <${ui.Meter} value=${maDone} max=${Math.max(1, assessments.length)} tone="blue" label=${`${maDone} av ${assessments.length} bedömningar godkända`} />
                <div class="row-between small"><span><b>${maDone} av ${assessments.length}</b> godkända · ${maOpen.length} utkast kvar</span><span class="muted">${monthDueNote()}</span></div>
              </div>
              ${maOpen.length === 0 ? html`<${ui.Notice} tone="ok" title="Alla bedömningar är godkända">Månadsrapporterna kan godkännas och levereras.<//>` : html`
                <${ui.Table} caption="Månadsbedömningar som återstår" rowKey="key" onRowClick=${(r) => go('coach.manad', { caseId: r.c.id, month: pm })}
                  rows=${maRows.map((x) => ({ ...x, key: x.c.id }))}
                  columns=${[
                    { key: 'n', label: 'Deltagare', render: (r) => html`<div class="strong">${nameOf(r.c)}</div><div class="cell-sub mono">${r.c.number}</div>` },
                    { key: 'u', label: 'Underlag', render: (r) => { const hasAi = r.ma.aiSummaryDraft || Object.values(r.ma.areas || {}).some((x) => x && x.aiObservationDraft);
                      return hasAi ? html`<${ui.AiTag}>AI-utkast finns<//>` : html`<span class="small muted">Manuellt</span>`; } },
                    { key: 's', label: 'Status', render: () => html`<${ui.Badge} tone="outline" icon="edit">Utkast<//>` },
                    { key: 'a', label: '', render: (r) => html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${(e) => { e.stopPropagation(); go('coach.manad', { caseId: r.c.id, month: pm }); }}>Bedöm<//>` },
                  ]} />
                ${maOpen.length > 5 && html`<div><${ui.Btn} kind="ghost" icon=${showAllMa ? 'chevron-up' : 'chevron-down'} onClick=${() => setShowAllMa(!showAllMa)}>${showAllMa ? 'Visa färre' : `Visa alla ${maOpen.length}`}<//></div>`}`}
            </div>
          <//>
        </div>

        <div class="stack">
          <${ui.Card} title="Påminnelser" icon="bell" flush>
            ${reminders.length === 0 ? html`<${ui.Empty} icon="bell" title="Inga påminnelser">Alla dina ärenden har dokumenterad progression.<//>` : html`<div class="list">
              ${reminders.map((w) => { const last = w.weeks[w.weeks.length - 1]; return html`<div class="list-item" key=${w.case.id}>
                <${I} name="bell" />
                <div class="li-main">
                  <div class="li-title">${nameOf(w.case)} <span class="mono small muted nowrap">${w.case.number}</span></div>
                  <div class="small">Ingen progression ${w.streak === 1 ? 'förra veckan' : `${w.streak} veckor i rad`}: ${lc(last.reason)} (${d.fmtWeekKey(last.key)}).</div>
                  <div><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => go('coach.avstamning', { caseId: w.case.id })}>Gör avstämning<//></div>
                </div>
              </div>`; })}
            </div>`}
            <div class="card-foot small muted">Påminnelsen kommer när veckomålet inte nåtts eller när en godkänd avstämning saknas. Planera nästa steg tillsammans med deltagaren.</div>
          <//>

          <${ui.Card} title="Egna flaggor" icon="flag" flush>
            ${flags.length === 0 ? html`<${ui.Empty} icon="flag" title="Inga flaggor" />` : html`<div class="list">${flags.map((a) => html`<${FlagItem} key=${a.key} a=${a} />`)}</div>`}
          <//>

          <${ui.Card} title="Olästa notiser" icon="bell" actions=${html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => go('notiser', {})}>Öppna notiser<//>`}>
            ${unread.length === 0 ? html`<p class="muted">Du har inga olästa notiser.</p>` : html`<div class="stack-sm">
              <p><b>${unread.length} olästa.</b> De senaste:</p>
              <ul class="stack-sm" style="margin:0;padding-left:20px">${unread.slice(0, 3).map((n) => html`<li key=${n.id}><span class="strong">${n.title}</span><div class="small muted">${n.body}</div></li>`)}</ul>
            </div>`}
          <//>

          <${ui.Card} title="Rapporter som förfaller" icon="file" flush>
            ${due.length === 0 ? html`<${ui.Empty} icon="file" title="Inga rapporter förfaller inom 7 dagar" />` : html`<div class="list">
              ${dueMonthly.length > 0 && html`<div class="list-item">
                <div class="li-main">
                  <div class="li-title">Månadsrapporter ${d.monthName(pm)}: ${dueMonthly.length} st</div>
                  <div class="small">${[['draft', 'väntar på din bedömning'], ['reviewed', 'granskade, ska godkännas'], ['approved', 'godkända, ska levereras']].filter(([k]) => (monthlyByStatus[k] || []).length > 0).map(([k, t]) => `${monthlyByStatus[k].length} ${t}`).join(' · ')}</div>
                  <div class="row-sm"><${ui.SlaBadge} dueAt=${dueMonthly[0].dueAt} /><${ui.Badge} tone="plan">Förslag – ej fastställt<//></div>
                </div>
                <div class="li-side">${canOpen('rapporter.lista') && html`<${ui.Btn} kind="ghost" onClick=${() => go('rapporter.lista', {})}>Visa<//>`}</div>
              </div>`}
              ${dueOther.map((x) => { const c = x.caseId ? caseOf(x.caseId) : null; return html`<div class="list-item" key=${x.id}>
                <div class="li-main">
                  <div class="li-title">${x.label}</div>
                  ${c && html`<div class="li-sub">${nameOf(c)} · ${c.number}</div>`}
                  <div class="row-sm"><${ui.SlaBadge} dueAt=${x.dueAt} />${x.provisional && html`<${ui.Badge} tone="plan">Förslag – ej fastställt<//>`}</div>
                </div>
                <div class="li-side">${x.link && canOpen(x.link.view) && html`<${ui.Btn} kind="ghost" onClick=${() => go(x.link.view, x.link.params)}>Öppna<//>`}</div>
              </div>`; })}
            </div>`}
          <//>
        </div>
      </div>

      <${ui.Card} title=${`Veckokalender – vecka ${d.isoWeek(today).week}`} icon="calendar">
        <${WeekCalendar} cases=${active} mon=${mon} />
      <//>
      <${ui.DemoNote}>Kalendern visar aktiviteterna i dina aktiva ärenden. I den riktiga tjänsten kan den synkas med Outlook. Påminnelser om progression är interna regler för Miljonbemanning och går bara till dig.<//>
    <//>`;
  };

  // ============================================================ NÄRVARO
  const Narvaro = ({ params }) => {
    const st = MM.useStore(); const role = MM.role(); const pid = me();
    const now = d.now(); const today = d.today(); const thisMon = d.monday(today); const lastMon = d.addDays(thisMon, -7);
    const cases = myCases(role, pid).filter((c) => c.startDate);
    const ids = new Set(cases.map((c) => c.id));
    const caseOf = (id) => cases.find((c) => c.id === id);
    const actsOf = (mon) => st.activities.filter((a) => ids.has(a.caseId) && a.startsAt >= mon && a.startsAt < d.addDays(mon, 7)).sort(MM.by('startsAt'));
    const openOf = (mon) => actsOf(mon).filter((a) => a.startsAt < now && !sel.attendanceFor(a.id));
    const [week, setWeekRaw] = useState(params.week === 'last' || params.week === 'this' ? params.week : openOf(lastMon).length ? 'last' : 'this');
    const mon = week === 'last' ? lastMon : thisMon;
    const defaultDay = (w) => (w === 'this' && d.isWorkingDay(today) ? today : 'all');
    const [day, setDay] = useState(defaultDay(week));
    const [show, setShow] = useState(() => (openOf(week === 'last' ? lastMon : thisMon).length > 0 ? 'open' : 'all'));
    const [pending, setPending] = useState(null);
    const [touched, setTouched] = useState({});
    const setWeek = (w) => { setWeekRaw(w); setDay(defaultDay(w)); setPending(null); setShow(openOf(w === 'last' ? lastMon : thisMon).length > 0 ? 'open' : 'all'); };

    const all = actsOf(mon);
    const open = all.filter((a) => a.startsAt < now && !sel.attendanceFor(a.id));
    const passed = all.filter((a) => a.startsAt < now);
    const due = regDueFor(mon); const wk = d.isoWeek(mon);
    const visible = all.filter((a) => (day === 'all' || a.startsAt.slice(0, 10) === day) && (show === 'all' || (a.startsAt < now && !sel.attendanceFor(a.id)) || touched[a.id]));
    const byDay = MM.groupBy(visible, (a) => a.startsAt.slice(0, 10));
    const sameDay = MM.cfg().attendance.sameDayNoticeOnInvalidAbsence;

    const register = (a, status, reason = '') => {
      MM.dispatch('attendance.set', { activityId: a.id, status, reason });
      setTouched((t) => ({ ...t, [a.id]: true })); setPending(null);
    };
    const pick = (a, v) => { if (v === 'absent_valid') setPending(a.id); else register(a, v); };

    // Veckorapporter per handläggare för veckan
    const recipients = MM.uniq(cases.filter((c) => all.some((a) => a.caseId === c.id)).map((c) => c.referrerId)).filter(Boolean);
    const reports = recipients.map((rid) => {
      const rep = st.reports.find((r) => r.kind === 'weekly_attendance' && r.week === wk.key && r.recipientUserId === rid);
      const wr = sel.weeklyReport(rid, wk.key);
      const left = MM.sum(wr.sections, (s) => s.stats.unregistered);
      const mine = open.filter((a) => (caseOf(a.caseId) || {}).referrerId === rid).length;
      return { rid, rep, left, mine, user: S().customerUsers.find((u) => u.id === rid) };
    }).sort((a, b) => b.mine - a.mine);
    const customerRole = recipients.includes(MM.roleDef('kommun_handlaggare').personaId) ? 'kommun_handlaggare' : 'kommun_chef';

    const dayOptions = [{ value: 'all', label: `Hela veckan${open.length ? ` (${open.length} kvar)` : ''}` },
      ...[0, 1, 2, 3, 4].map((i) => { const x = d.addDays(mon, i); const n = open.filter((a) => a.startsAt.slice(0, 10) === x).length; return { value: x, label: `${dayLabel(x)}${n ? ` (${n})` : ''}` }; })];

    const renderRow = (a) => {
      const c = caseOf(a.caseId); const k = kindOf(a.kind); const at = sel.attendanceFor(a.id); const future = a.startsAt >= now;
      const rep = at && at.status === 'absent_invalid' ? sel.repeatedAbsence(c.id) : null;
      const isPending = pending === a.id;
      return html`<div class=${cls('co-att', at && 'is-done')} key=${a.id}>
        <div class="co-att-when"><div class="t">${d.fmtTime(a.startsAt)}</div><div class="small muted">${d.WD_SHORT[d.weekday(a.startsAt)]}</div></div>
        <div class="co-att-info">
          <div class="strong">${nameOf(c)}</div>
          <div class="small muted">${k.label} · ${a.location} · ${a.durationMin} min · <span class="mono">${c.number}</span></div>
          <div class="row-sm">${at ? html`<${AttBadge} at=${at} />` : future ? html`<${ui.Badge} tone="outline" icon="clock">Planerat<//>` : html`<${ui.Badge} tone="redfill" icon="alert">Ej registrerad<//>`}
            ${rep && html`<${ui.Badge} tone="red" icon="flag">Upprepad ogiltig frånvaro – föreslå åtgärdsplan<//>`}</div>
          ${at && at.status === 'absent_invalid' && html`<div class="small muted">Frånvaronotis samma dag: ${MM.isUnset(sameDay) ? 'tillval som inte är fastställt – ingen notis skickas.' : sameDay ? 'skickas till handläggaren.' : 'används inte.'}</div>`}
        </div>
        <div class="co-att-act">
          ${future ? html`<span class="small muted">Registreras när tillfället har startat.</span>` : html`
            <${ui.Seg} ariaLabel=${`Närvaro för ${nameOf(c)} ${dayLabel(a.startsAt)} ${d.fmtTime(a.startsAt)}`} value=${isPending ? 'absent_valid' : at ? at.status : null} onChange=${(v) => pick(a, v)} options=${ATT_OPTIONS} />
            ${isPending && html`<div class="co-att-reason" role="group" aria-label="Orsak till giltig frånvaro">
              <span class="small strong">Välj orsak (inga andra detaljer):</span>
              <${ui.Seg} ariaLabel="Orsak" value=${at && at.status === 'absent_valid' ? at.reason : null} onChange=${(r) => register(a, 'absent_valid', r)} options=${sel.ABSENCE_REASONS.map((r) => ({ value: r, label: r }))} />
              <div><${ui.Btn} kind="ghost" onClick=${() => setPending(null)}>Avbryt<//></div>
            </div>`}`}
        </div>
      </div>`;
    };

    return html`<${ui.Page} title="Närvaro" eyebrow=${role === 'handledare' ? 'Handledare – dina teamärenden' : 'Snabbregistrering'}
      lead=${`Ett klick per tillfälle. Förra veckans närvaro ska vara registrerad senast ${regDueText()}. När alla tillfällen för en handläggares deltagare är registrerade publiceras veckorapporten automatiskt.`}
      crumbs=${role === 'coach' ? [{ label: 'Min vecka', view: 'coach.minvecka' }, { label: 'Närvaro' }] : undefined}>

      <div class="row-between">
        <${ui.Seg} ariaLabel="Vecka" value=${week} onChange=${setWeek} options=${[
          { value: 'last', label: `Förra veckan (v. ${d.isoWeek(lastMon).week})${openOf(lastMon).length ? ` · ${openOf(lastMon).length} kvar` : ''}` },
          { value: 'this', label: `Den här veckan (v. ${d.isoWeek(thisMon).week})` }]} />
        <${ui.Seg} ariaLabel="Visa" value=${show} onChange=${setShow} options=${[{ value: 'open', label: `Ej registrerade (${open.length})` }, { value: 'all', label: `Alla (${all.length})` }]} />
      </div>

      <${ui.Card} tone=${open.length > 0 ? 'red' : 'blue'}>
        <div class="co-counter">
          <span class="big" aria-hidden="true">${open.length}</span>
          <div class="stack-sm" style="gap:4px;flex:1 1 240px">
            <div class="strong" style="font-size:1.125rem">${open.length === 0 ? `Alla passerade tillfällen vecka ${wk.week} är registrerade` : `${open.length} tillfällen kvar – senast ${regDueText()}`}</div>
            <div class="small muted">${passed.length - open.length} av ${passed.length} passerade tillfällen registrerade${all.length > passed.length ? ` · ${all.length - passed.length} planerade senare i veckan` : ''}. Registrera senast ${d.fmtDateTimeLong(due)}.</div>
          </div>
          ${open.length > 0 ? html`<${ui.SlaBadge} dueAt=${due} />` : html`<${ui.Badge} tone="blue" icon="check">Klart<//>`}
        </div>
      <//>

      ${role === 'handledare' && html`<${ui.Notice} tone="info" title="Dina teamärenden">Du ser tillfällen för de ${cases.length} ärenden där du ingår i teamet. Ärenden med skyddade personuppgifter visas bara för namngiven coach.<//>`}

      <div class="stack-sm">
        <span class="eyebrow">Dag</span>
        <${ui.Seg} ariaLabel="Dag" value=${day} onChange=${(v) => { setDay(v); setPending(null); }} options=${dayOptions} />
      </div>

      <${ui.Card} flush title=${day === 'all' ? `Tillfällen vecka ${wk.week}` : `Tillfällen ${d.fmtWeekday(day)}`} icon="list"
        actions=${html`<span class="small muted">${visible.length} visas</span>`}>
        ${visible.length === 0 ? html`<${ui.Empty} icon="check-square" title=${show === 'open' ? 'Inget kvar att registrera här' : 'Inga tillfällen'}>
            ${show === 'open' && html`<${ui.Btn} kind="ghost" onClick=${() => setShow('all')}>Visa alla tillfällen<//>`}<//>`
          : Object.entries(byDay).map(([dayKey, list]) => html`<div key=${dayKey}>
            ${day === 'all' && html`<div class="co-dayhead"><span>${d.fmtWeekday(dayKey)}</span><span>${list.filter((a) => a.startsAt < now && !sel.attendanceFor(a.id)).length} kvar</span></div>`}
            ${list.map((a) => renderRow(a))}
          </div>`)}
      <//>

      <div class="split">
        <${ui.Card} title=${`Veckorapporter – vecka ${wk.week}`} icon="file" foot=${role === 'coach' ? html`<${ui.PerspectiveSwitch} role=${customerRole} view="kom.rapporter" label="Se veckorapporten från kundens håll" />` : undefined}>
          ${week === 'this' ? html`<p>Veckorapporten för vecka ${wk.week} skapas ${d.fmtWeekday(d.addDays(thisMon, 7))} och publiceras när allt är registrerat, senast ${pubTimeText()}.</p>`
            : reports.length === 0 ? html`<p class="muted">Inga veckorapporter berörs.</p>` : html`<div class="stack-sm">
              ${reports.map((x) => html`<div class="row-between" key=${x.rid} style="padding:8px 0;border-bottom:1px solid var(--line)">
                <div class="stack-sm" style="gap:2px;min-width:0">
                  <span class="strong">${x.user ? x.user.name : MM.personName(x.rid)}</span>
                  <span class="small muted">${x.user ? x.user.unit : ''}${x.mine > 0 ? ` · ${x.mine} av dina tillfällen kvar` : ''}</span>
                </div>
                <div class="row-sm">
                  ${x.rep && ['delivered', 'opened'].includes(x.rep.status) ? html`<${ui.Badge} tone="blue" icon="check">Publicerad ${d.fmtDateTime(x.rep.deliveredAt)}<//>`
                    : html`<${ui.Badge} tone="outline" icon="clock">Väntar på närvaro${x.left > 0 ? ` (${x.left} kvar)` : ''}<//>`}
                  ${x.rep && role === 'coach' && canOpen('rapport.visa') && html`<${ui.Btn} kind="ghost" onClick=${() => go('rapport.visa', { reportId: x.rep.id })}>Se veckorapporten<//>`}
                </div>
              </div>`)}
            </div>`}
          <p class="small muted" style="margin-top:10px">Rapporten har en sektion per deltagare: planerade tillfällen, närvaro, frånvaro med orsak och risk. Handläggaren får ett mejl utan personuppgifter: ”Veckorapporten finns i portalen – logga in för att läsa.”</p>
        <//>
        <${ui.Card} title="Så fungerar registreringen" icon="info">
          <ul class="stack-sm" style="margin:0;padding-left:20px">
            <li><b>Närvarande</b> eller <b>Sen</b> räknas som närvaro.</li>
            <li><b>Giltig frånvaro</b> kräver en orsak: ${sel.ABSENCE_REASONS.map((r) => r.toLowerCase()).join(', ')}. Inga andra detaljer.</li>
            <li><b>Ogiltig frånvaro</b> ${MM.cfg().attendance.repeatedAbsenceRule.absentInvalid} gånger inom ${MM.cfg().attendance.repeatedAbsenceRule.withinDays} dagar ger en flagga och förslag på åtgärdsplan.</li>
            <li>Påminnelse fredag eftermiddag och måndag morgon. Saknas registreringen ${regDueText()} går en påminnelse till samordnaren.</li>
          </ul>
          <${ui.Notice} tone="info" title="Frånvaronotis samma dag – ej fastställd">En notis till handläggaren samma dag vid ogiltig frånvaro är ett tillval i avtalet som inte är beslutat. Den är avstängd i prototypen.<//>
        <//>
      </div>
    <//>`;
  };

  // ============================================================ VECKOAVSTÄMNING
  const AI_FIELDS = ['goalStatus', 'nextGoal', 'phase', 'activitiesDone', 'employerContacts', 'obstacles', 'note'];
  const FIELD_ID = { goalStatus: 'ci-goal', nextGoal: 'ci-nextgoal', phase: 'ci-phase', activitiesDone: 'ci-acts', employerContacts: 'ci-ec', obstacles: 'ci-obst', note: 'ci-note' };
  const FIELD_LABEL = { goalStatus: 'Veckomål uppnått', nextGoal: 'Nytt veckomål', phase: 'Fas', activitiesDone: 'Genomförda aktiviteter', employerContacts: 'Arbetsgivarkontakter', obstacles: 'Hinder', note: 'Anteckning' };
  const DEC_LABEL = { accepted: 'Accepterat', changed: 'Ändrat', rejected: 'Avvisat', pending: 'Ej granskat' };
  const SOURCE = {
    recording: { label: 'Inspelning i rummet', icon: 'mic', method: 'ai_recording', audio: true },
    upload: { label: 'Uppladdad ljudfil', icon: 'upload', method: 'ai_upload', audio: true },
    teams: { label: 'Teams-transkript', icon: 'video', method: 'teams', audio: false },
    notes: { label: 'Inklistrade anteckningar', icon: 'clipboard', method: 'notes', audio: false },
  };
  const OBST_QUOTE = {
    'Språk': 'Ibland är det svårt att förstå orden i instruktionerna.',
    'Digital vana': 'Jag behöver hjälp när jag ska söka jobb på datorn.',
    'Praktiska förutsättningar (t.ex. barnomsorg, resor)': 'Det var svårt att hinna lämna barnen och komma i tid.',
    'Behov av anpassning': 'Det går bättre när jag får instruktionerna på papper.',
    'Motivation': 'Jag var trött i början av veckan och ville inte komma.',
    'Annat': 'Det hände en sak hemma som tog mycket tid.',
  };
  const PHASE_QUOTE = { 1: 'Vi fortsätter kartläggningen och pratar om vilket yrke som passar.', 2: 'Vi övar mer på grunderna innan de yrkesspecifika momenten.', 3: 'Vi fortsätter med de yrkesspecifika momenten.', 4: 'Praktiken fortsätter som planerat.', 5: 'Nu fokuserar vi på ansökningar och matchning.' };
  const actsForPhase = (ph) => SC.ACTIVITY_TYPES.filter((_, i) => ({ 1: [0], 2: [1, 5], 3: [1, 2, 5], 4: [2, 4, 7], 5: [5, 6, 7] }[ph] || [0]).includes(i));

  /** Simulerade AI-förslag för ärenden utan färdigt utkast. Samlad status föreslås aldrig. */
  const makeSuggestions = (c, source, text) => {
    const ph = c.phase || 1; const last = sel.latestCheckIn(c.id);
    const goals = SC.GOALS[ph] || SC.GOALS[1];
    const goal = goals.find((g) => !last || g !== last.nextGoal) || goals[0];
    const acts = actsForPhase(ph);
    const ec = ph >= 4 ? { count: '1', types: ['intervju'] } : ph >= 3 ? { count: '1', types: ['studiebesök'] } : { count: '0', types: [] };
    const obst = last && last.obstacles && last.obstacles.length ? [last.obstacles[0]] : [];
    const s = {
      goalStatus: { value: 'partly', quote: 'Jag har gjort det mesta av målet, men en dag hann jag inte.', t: 184 },
      nextGoal: { value: goal, quote: `Nästa vecka ska jag försöka ${lc(goal)}.`, t: 1320 },
      phase: { value: ph, quote: PHASE_QUOTE[ph], t: 1485 },
      activitiesDone: { value: acts, quote: `I veckan har vi jobbat med ${acts.map(lc).join(' och ')}.`, t: 96 },
      employerContacts: { value: ec, quote: ec.count === '0' ? 'Jag har inte haft kontakt med någon arbetsgivare den här veckan.' : ph >= 4 ? 'Jag var på en intervju hos en arbetsgivare i torsdags.' : 'Vi gjorde ett studiebesök på en arbetsplats i onsdags.', t: 742 },
      obstacles: { value: obst, quote: obst.length ? OBST_QUOTE[obst[0]] || 'Det har varit lite svårt den här veckan.' : 'Det har inte varit några problem den här veckan.', t: 1034 },
      note: { value: `Har arbetat med ${lc(acts[0])}. Veckomålet nåddes delvis. Nästa steg: ${lc(goal)}.`, quote: 'Sammanfattning av samtalet 01:36–24:45', t: 96 },
    };
    if (source === 'notes') {
      const sentences = String(text || '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 3);
      AI_FIELDS.forEach((f, i) => { s[f] = { ...s[f], quote: sentences.length ? sentences[i % sentences.length] : 'Framgår inte', t: null }; });
      s.note = { value: sentences.slice(0, 2).join(' ') || s.note.value, quote: 'Sammanfattning av de inklistrade anteckningarna', t: null };
    }
    return s;
  };
  const suggestionText = (field, v) => {
    if (v == null) return 'Framgår inte';
    if (field === 'goalStatus') return GOAL_TEXT[v] || v;
    if (field === 'phase') return sel.phaseLabel(Number(v));
    if (field === 'activitiesDone' || field === 'obstacles') return v.length ? v.join(', ') : 'Inga';
    if (field === 'employerContacts') return `${v.count}${v.types && v.types.length ? ` (${v.types.join(', ')})` : ''}`;
    return String(v);
  };

  const AiSuggestion = ({ field, s, decision, onDecide }) => {
    if (!s) return null;
    const dec = decision || 'pending';
    return html`<div class="ai-box" role="group" aria-label=${`AI-förslag för ${FIELD_LABEL[field].toLowerCase()}`}>
      <div class="row-sm"><${ui.AiTag} />${dec !== 'pending' ? html`<${ui.Badge} tone=${dec === 'rejected' ? 'outline' : 'bluetone'} icon=${dec === 'rejected' ? 'x' : dec === 'changed' ? 'edit' : 'check'}>${DEC_LABEL[dec]}<//>` : html`<span class="small muted">Ta ställning till förslaget</span>`}</div>
      <div class="strong">${suggestionText(field, s.value)}</div>
      <${ui.Evidence} quote=${s.quote} t=${s.t} />
      <div class="row-sm">
        <${ui.Btn} kind=${dec === 'accepted' ? 'primary' : 'secondary'} icon="check" ariaPressed=${dec === 'accepted' ? 'true' : 'false'} onClick=${() => onDecide(field, 'accepted')}>Acceptera<//>
        <${ui.Btn} kind=${dec === 'changed' ? 'primary' : 'secondary'} icon="edit" ariaPressed=${dec === 'changed' ? 'true' : 'false'} onClick=${() => onDecide(field, 'changed')}>Ändra<//>
        <${ui.Btn} kind=${dec === 'rejected' ? 'primary' : 'ghost'} icon="x" ariaPressed=${dec === 'rejected' ? 'true' : 'false'} onClick=${() => onDecide(field, 'rejected')}>Avvisa<//>
      </div>
    </div>`;
  };

  const TranscriptPanel = ({ ciId, transcript }) => {
    ui.useAuditView('check_in', ciId || 'ny', 'transcript.view');
    return html`<div class="co-transcript" tabIndex="0" aria-label="Råtranskript">
      ${transcript.map((x, i) => html`<div key=${i}><span class="seg-t">${String(Math.floor(x.t / 60)).padStart(2, '0')}:${String(x.t % 60).padStart(2, '0')}</span><b>${x.who}:</b> ${x.text}</div>`)}
    </div>`;
  };

  const Section = ({ n, title, ok, extra, children }) => html`<div class=${cls('co-section', ok && 'is-ok')}>
    <div class="co-section-title"><span class="n" aria-hidden="true">${ok ? html`<${I} name="check" />` : n}</span><span>${title}</span>${extra}</div>
    ${children}
  </div>`;

  const CheckInReadOnly = ({ c, ci }) => html`<${ui.Page} title="Veckoavstämning" eyebrow=${`${nameOf(c)} · ${c.number}`}
    crumbs=${[{ label: 'Min vecka', view: 'coach.minvecka' }, { label: 'Veckoavstämning' }]}>
    <${ui.Notice} tone="ok" title=${`Godkänd ${d.fmtDateTime(ci.approvedAt)} av ${MM.personName(ci.approvedBy)}`}>En godkänd avstämning ändras inte. Behöver något rättas gör du en ny avstämning.<//>
    <${ui.Card} title=${`Avstämning ${d.fmtDateTimeLong(ci.heldAt)}`} icon="clipboard">
      <${ui.Kv} items=${[
        ['Sätt och längd', `${cap(ci.mode || 'fysiskt')}, ${ci.durationMin || '–'} min`],
        ['Veckomål uppnått', GOAL_TEXT[ci.goalStatus] || '–'], ['Nytt veckomål', ci.nextGoal || '–'], ['Fas', ci.phase ? sel.phaseLabel(ci.phase) : '–'],
        ['Aktiviteter', (ci.activitiesDone || []).join(', ') || '–'], ['Arbetsgivarkontakter', ci.employerContacts ? suggestionText('employerContacts', ci.employerContacts) : '–'],
        ['Samlad status', html`<${ui.Status} value=${ci.overallStatus} />`], ['Hinder', (ci.obstacles || []).join(', ') || 'Inga'], ['Anteckning', ci.note || '–'],
        ['Dokumentationstid', ci.docMinutes != null ? `${ci.docMinutes} min` : '–'],
      ]} />
    <//>
    <div class="row"><${ui.Btn} kind="primary" icon="plus" onClick=${() => go('coach.avstamning', { caseId: c.id })}>Ny avstämning<//><${ui.Btn} kind="ghost" onClick=${() => go('coach.minvecka', {})}>Till Min vecka<//></div>
  <//>`;

  const Avstamning = ({ params }) => {
    MM.useStore();
    // Om avstämningen redan var godkänd när vyn öppnades visas den skrivskyddat. Godkänns den här behålls kvittot.
    const [wasApproved] = useState(() => { const x = params.checkInId ? S().checkIns.find((y) => y.id === params.checkInId) : null; return !!(x && x.status === 'approved'); });
    const c = params.caseId ? sel.caseById(params.caseId) : null;
    if (!params.caseId) {
      return html`<${CasePicker} view="coach.avstamning" title="Veckoavstämning" lead="Välj den deltagare du har träffat. Dokumentationen tar under fem minuter." actionLabel="Gör avstämning"
        statusOf=${(x) => { const l = sel.latestCheckIn(x.id); const dr = sel.checkInsOf(x.id).find((y) => y.status === 'draft');
          return html`${dr && html`<${ui.Badge} tone="outline" icon="edit">${dr.ai ? 'AI-utkast att granska' : 'Utkast sparat'}<//>`}${l ? html`<span class="small muted">Senast godkänd ${d.fmtDate(l.heldAt)}</span>` : html`<span class="small muted">Ingen godkänd avstämning</span>`}`; }} />`;
    }
    const g = gate(c); if (g) return html`<${GateView} g=${g} title="Veckoavstämning" view="coach.avstamning" />`;
    const ci0 = params.checkInId ? S().checkIns.find((x) => x.id === params.checkInId && x.caseId === c.id) : null;
    if (ci0 && wasApproved) return html`<${CheckInReadOnly} c=${c} ci=${ci0} />`;
    return html`<${CheckInForm} c=${c} ci0=${ci0} />`;
  };

  const CheckInForm = ({ c, ci0 }) => {
    const st = MM.useStore(); const pid = me();
    ui.useAuditView('case', c.id, 'case.view');
    const today = d.today();
    const todayMeeting = sel.activitiesOf(c.id).find((a) => a.kind === 'möte' && a.startsAt.slice(0, 10) === today);
    const lastApproved = sel.latestCheckIn(c.id);
    const held0 = ci0 ? ci0.heldAt : todayMeeting ? todayMeeting.startsAt : d.now();
    const blank = { goalStatus: null, nextGoal: '', phase: c.phase || 1, activitiesDone: [], ecCount: null, ecTypes: [], obstacles: [], note: '' };
    const [form, setForm] = useState(() => ({
      date: held0.slice(0, 10), time: held0.slice(11, 16), durationMin: (ci0 && ci0.durationMin) || (lastApproved && lastApproved.durationMin) || 45,
      mode: (ci0 && ci0.mode) || (lastApproved && lastApproved.mode) || 'fysiskt', attendanceComment: (ci0 && ci0.attendanceComment) || '',
      goalStatus: (ci0 && ci0.goalStatus) || null, nextGoal: (ci0 && ci0.nextGoal) || '', phase: (ci0 && ci0.phase) || c.phase || 1,
      activitiesDone: (ci0 && ci0.activitiesDone) || [], ecCount: ci0 && ci0.employerContacts ? ci0.employerContacts.count : null, ecTypes: (ci0 && ci0.employerContacts && ci0.employerContacts.types) || [],
      overallStatus: (ci0 && ci0.overallStatus) || null, obstacles: (ci0 && ci0.obstacles) || [], note: (ci0 && ci0.note) || '',
    }));
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const prot = isProtected(c);
    const [method, setMethod] = useState(ci0 && ci0.ai ? 'ai' : 'manual');
    const [source, setSource] = useState(ci0 && ci0.ai ? (ci0.inputMethod === 'teams' ? 'teams' : ci0.inputMethod === 'notes' ? 'notes' : ci0.inputMethod === 'ai_upload' ? 'upload' : 'recording') : 'recording');
    const [sugg, setSugg] = useState(ci0 && ci0.ai ? ci0.ai : null);
    const [aiMeta, setAiMeta] = useState(ci0 && ci0.ai ? { runId: ci0.aiRunId, audioDeletedAt: ci0.ai.audioDeletedAt, deleteBy: ci0.ai.rawTranscriptDeleteBy, transcript: ci0.ai.transcript || [], fromSeed: true } : null);
    const [decisions, setDecisions] = useState({});
    const [rec, setRec] = useState({ status: 'idle', seconds: 0 });
    const [proc, setProc] = useState(null);
    const [notesText, setNotesText] = useState('');
    const [fileName, setFileName] = useState('');
    const [showTranscript, setShowTranscript] = useState(false);
    const [consentInformed, setConsentInformed] = useState(false);
    const person = sel.person(c) || {};
    const [consentLang, setConsentLang] = useState(['arabiska', 'somaliska', 'tigrinja', 'engelska', 'turkiska'].includes(person.language) ? person.language : 'lättläst svenska');
    const repeated = sel.repeatedAbsence(c.id);
    const [dev, setDev] = useState(() => ({ description: repeated ? `Upprepad ogiltig frånvaro (${repeated.length} tillfällen inom ${MM.cfg().attendance.repeatedAbsenceRule.withinDays} dagar)` : '',
      action: repeated ? 'Samtal om hinder, ny veckoplan och uppföljningsmöte med handläggaren.' : '', ownerId: pid, followUpOn: d.addDays(today, 7), needsCustomerDecision: repeated ? 'yes' : 'no' }));
    const [errors, setErrors] = useState({});
    const [ciId, setCiId] = useState(ci0 ? ci0.id : null);
    const [done, setDone] = useState(null);
    const startRef = useRef(Date.now());
    const timers = useRef([]);
    useEffect(() => () => timers.current.forEach((t) => clearTimeout(t) || clearInterval(t)), []);
    useEffect(() => {
      if (rec.status !== 'recording') return undefined;
      const id = setInterval(() => setRec((r) => ({ ...r, seconds: r.seconds + 1 })), 1000); timers.current.push(id);
      return () => clearInterval(id);
    }, [rec.status]);

    const consentOk = c.aiConsent === 'given';
    const consent = sel.consentOf(c.id);
    const watch = sel.progressionWatch({ coachId: pid }).find((w) => w.case.id === c.id);
    const lastWeekFrom = d.addDays(form.date, -6);
    const att = sel.attendanceStats(c.id, lastWeekFrom, form.date);
    const draftElsewhere = !ci0 ? sel.checkInsOf(c.id).find((x) => x.status === 'draft' && x.id !== ciId) : null;
    const owners = MM.uniq([pid, ...(c.team || []).map((t) => t.userId), 'u-sara']).map((id) => ({ value: id, label: `${MM.personName(id)}${id === pid ? ' (du)' : ''}` }));

    // ---- AI
    const decide = (field, dec) => {
      const s = sugg && sugg[field]; if (!s) return;
      setDecisions((x) => ({ ...x, [field]: dec }));
      const apply = (v) => {
        if (field === 'employerContacts') setForm((f) => ({ ...f, ecCount: v ? v.count : null, ecTypes: v ? v.types || [] : [] }));
        else setForm((f) => ({ ...f, [field]: Array.isArray(v) ? v.slice() : v }));
      };
      if (dec === 'rejected') apply(field === 'employerContacts' ? null : blank[field]);
      else apply(s.value);
      if (dec === 'changed') setTimeout(() => { const el = document.getElementById(FIELD_ID[field]); if (!el) return; const f = el.matches('input,textarea,select') ? el : el.querySelector('input,textarea,button'); if (f) f.focus(); try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* */ } }, 40);
    };
    const runSteps = (steps, then) => {
      let i = 0; setProc({ steps, i: 0 });
      const step = () => { i++; if (i >= steps.length) { setProc(null); then(); return; } setProc({ steps, i }); timers.current.push(setTimeout(step, 650)); };
      timers.current.push(setTimeout(step, 650));
    };
    const finishAi = (src) => {
      const audio = SOURCE[src].audio; const secs = audio ? Math.max(60, form.durationMin * 60) : 0;
      const res = MM.dispatch('ai.run', { caseId: c.id, kind: src === 'notes' ? 'extract_notes' : src === 'teams' ? 'extract_teams' : 'transcribe_extract', audioSeconds: secs, costOre: audio ? 80 : 4 }) || {};
      const s = makeSuggestions(c, src, notesText);
      const transcript = src === 'notes' ? [] : AI_FIELDS.map((f) => s[f]).filter((x) => x.t != null).sort(MM.by('t')).map((x) => ({ t: x.t, who: 'Deltagare', text: x.quote }));
      setSugg(s); setDecisions({});
      setAiMeta({ runId: res.runId || null, audioDeletedAt: audio ? d.now() : null, deleteBy: d.addDays(d.now(), 30), transcript, source: src });
      MM.toast(audio ? 'Förslagen är klara. Ljudet raderades direkt efter transkriberingen.' : 'Förslagen är klara. Granska varje förslag.', 'blue');
    };
    const startProcessing = (src) => {
      const steps = src === 'recording' ? ['Laddar upp inspelningen …', 'Transkriberar …', 'Tolkar till formuläret …', 'Raderar ljudet …']
        : src === 'upload' ? ['Laddar upp ljudfilen …', 'Transkriberar …', 'Tolkar till formuläret …', 'Raderar ljudet …']
          : src === 'teams' ? ['Hämtar transkriptet från Teams …', 'Tolkar till formuläret …'] : ['Tolkar anteckningarna …'];
      runSteps(steps, () => finishAi(src));
    };
    const pendingAi = sugg ? AI_FIELDS.filter((f) => sugg[f] && !decisions[f]) : [];

    // ---- Spara
    const buildData = () => {
      const data = {
        heldAt: `${form.date}T${form.time || '09:00'}`, durationMin: Number(form.durationMin), mode: form.mode,
        inputMethod: method === 'manual' ? 'manual' : SOURCE[source].method, goalStatus: form.goalStatus, nextGoal: form.nextGoal.trim(), phase: Number(form.phase),
        activitiesDone: form.activitiesDone, employerContacts: { count: form.ecCount, types: form.ecCount && form.ecCount !== '0' ? form.ecTypes : [] },
        overallStatus: form.overallStatus, obstacles: form.obstacles, note: form.note.trim(), attendanceComment: form.attendanceComment.trim(),
        docMinutes: Math.max(1, Math.round((Date.now() - startRef.current) / 60000)),
      };
      if (sugg && aiMeta && !aiMeta.fromSeed) Object.assign(data, { aiRunId: aiMeta.runId, ai: { ...sugg, transcript: aiMeta.transcript, audioDeletedAt: aiMeta.audioDeletedAt, rawTranscriptDeleteBy: aiMeta.deleteBy } });
      return data;
    };
    const aiDecisionList = () => (sugg ? AI_FIELDS.filter((f) => sugg[f] && decisions[f]).map((f) => {
      const final = buildData()[f === 'employerContacts' ? 'employerContacts' : f];
      const same = JSON.stringify(final) === JSON.stringify(f === 'employerContacts' ? { count: sugg[f].value.count, types: sugg[f].value.count !== '0' ? sugg[f].value.types : [] } : sugg[f].value);
      const decision = decisions[f] === 'rejected' ? 'rejected' : same ? 'accepted' : 'changed';
      return { field: f, decision, suggested: sugg[f].value, final: decision === 'rejected' ? null : final };
    }) : []);
    const validate = (approve) => {
      const e = {};
      if (approve) {
        if (!form.goalStatus) e.goalStatus = 'Välj om veckomålet är uppnått.';
        if (!form.nextGoal.trim()) e.nextGoal = 'Skriv ett nytt veckomål.';
        if (form.ecCount == null) e.ec = 'Välj antal arbetsgivarkontakter.';
        if (!form.overallStatus) e.overallStatus = 'Välj samlad status. Den väljer du själv – AI föreslår den aldrig.';
        if (pendingAi.length) e.ai = `Ta ställning till alla AI-förslag innan du godkänner: ${pendingAi.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ')}.`;
      }
      if (form.overallStatus === 'red') {
        if (!dev.description.trim()) e.devDescription = 'Beskriv avvikelsen.';
        if (!dev.action.trim()) e.devAction = 'Skriv vilken åtgärd som ska göras.';
        if (!dev.ownerId) e.devOwner = 'Välj ansvarig.';
        if (!dev.followUpOn) e.devFollow = 'Välj datum för uppföljning.';
      }
      return e;
    };
    const save = (approve) => {
      const e = validate(approve); setErrors(e);
      if (Object.keys(e).length) { MM.toast(approve ? 'Avstämningen kan inte godkännas ännu. Se markerade fält.' : 'Fyll i avvikelsen innan du sparar.', 'red'); return; }
      const payload = { caseId: c.id, checkInId: ciId || undefined, data: buildData(), approve };
      if (form.overallStatus === 'red') payload.deviation = { description: dev.description.trim(), action: dev.action.trim(), ownerId: dev.ownerId, followUpOn: dev.followUpOn, needsCustomerDecision: dev.needsCustomerDecision === 'yes' };
      if (approve && sugg) payload.aiDecisions = aiDecisionList();
      const res = MM.dispatch('checkin.save', payload);
      if (!res) return;
      if (res.error === 'deviation_required') { setErrors({ devDescription: 'Röd status kräver en avvikelse med åtgärd, ansvarig och uppföljningsdatum.' }); MM.toast('Röd status kräver en avvikelse.', 'red'); return; }
      setCiId(res.checkInId);
      if (!approve) { MM.toast('Utkastet är sparat. Du kan fortsätta senare.', 'blue'); return; }
      const ci = S().checkIns.find((x) => x.id === res.checkInId);
      setDone({ checkInId: res.checkInId, deviationId: res.deviationId, decisions: payload.aiDecisions || [], docSecs: Math.round((Date.now() - startRef.current) / 1000), rawDeletedAt: ci && ci.ai ? ci.ai.rawTranscriptDeletedAt : null, audioDeletedAt: aiMeta ? aiMeta.audioDeletedAt : null, stopped: Date.now() });
      MM.toast('Avstämningen är godkänd.', 'blue');
      try { window.scrollTo({ top: 0 }); } catch (err) { /* */ }
    };

    if (done) return html`<${CheckInDone} c=${c} done=${done} start=${startRef.current} />`;

    const ecOn = form.ecCount && form.ecCount !== '0';
    const aiBox = (f) => (method === 'ai' && sugg ? html`<${AiSuggestion} field=${f} s=${sugg[f]} decision=${decisions[f]} onDecide=${decide} />` : null);
    /** AI-förslaget till vänster och coachens fält till höger (på bred skärm), annars under varandra. */
    const pair = (f, control) => (method === 'ai' && sugg && sugg[f] ? html`<div class="co-pair">${aiBox(f)}<div class="stack-sm">${control}</div></div>` : control);
    const goalSuggestions = (SC.GOALS[Number(form.phase)] || []).filter((x) => x !== form.nextGoal);
    const prevGoal = lastApproved && lastApproved.nextGoal;

    return html`<${ui.Page} title="Veckoavstämning" eyebrow=${`${nameOf(c)} · ${c.number}`}
      lead="Allt utom anteckningen är knappar. Förifyllt från kalendern och närvaron. Mål: under 5 minuters dokumentation."
      crumbs=${[{ label: 'Min vecka', view: 'coach.minvecka' }, { label: 'Veckoavstämning' }]}
      actions=${html`<${DocTimer} start=${startRef.current} />`}>

      <${ui.Card}><${CaseHead} c=${c} /><//>

      ${watch && html`<${ui.Notice} tone="info" icon="bell" title=${`Påminnelse: ingen dokumenterad progression ${watch.streak === 1 ? 'förra veckan' : `${watch.streak} veckor i rad`}`}>
        Orsak: ${lc(watch.weeks[watch.weeks.length - 1].reason)} (${d.fmtWeekKey(watch.lastWeek)}). Sätt ett konkret och nåbart veckomål tillsammans med deltagaren och dokumentera det här.<//>`}
      ${draftElsewhere && html`<${ui.Notice} tone="warn" title=${draftElsewhere.ai ? 'Det finns ett AI-utkast att granska' : 'Det finns ett sparat utkast'}>
        Avstämning ${d.fmtDateTimeLong(draftElsewhere.heldAt)}. <${ui.Btn} kind="ghost" onClick=${() => go('coach.avstamning', { caseId: c.id, checkInId: draftElsewhere.id })}>Öppna utkastet<//><//>`}

      <${ui.Card} title="Indatasätt" icon="layers" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
        <div class="stack">
          <${ui.Seg} ariaLabel="Indatasätt" value=${method} onChange=${(v) => setMethod(v)} options=${[{ value: 'manual', label: 'Manuellt', icon: 'edit' }, { value: 'ai', label: 'Med AI-stöd', icon: 'sparkles' }]} />
          ${method === 'manual' && html`<p class="small muted">Manuell dokumentation är standard och fullt likvärdig. AI fyller samma formulär – det finns ingen separat AI-väg.</p>`}
          ${method === 'ai' && prot && html`<${ui.Notice} tone="critical" title="AI används inte för det här ärendet">Deltagaren har skyddade personuppgifter. Då spelas inget in och ingen AI används. Dokumentera manuellt.<//>`}
          ${method === 'ai' && !prot && !consentOk && html`<${ConsentPanel} c=${c} consent=${consent} informed=${consentInformed} setInformed=${setConsentInformed} lang=${consentLang} setLang=${setConsentLang} />`}
          ${method === 'ai' && !prot && consentOk && html`<div class="stack">
            <div class="row-sm small">
              <${ui.Badge} tone="bluetone" icon="shield">Samtycke registrerat${consent && consent.givenAt ? ` ${d.fmtDate(consent.givenAt)}` : ''}<//>
              <span class="muted">${consent ? `Version ${consent.textVersion}, informerad av ${MM.personName(consent.informedBy)} på ${consent.language || 'lättläst svenska'}.` : ''}</span>
              ${!sugg && html`<${ui.Btn} kind="ghost" onClick=${() => { MM.dispatch('consent.set', { caseId: c.id, value: 'revoked' }); MM.toast('Samtycket är återkallat. Dokumentera manuellt.', 'blue'); setMethod('manual'); }}>Deltagaren återkallar<//>`}
            </div>
            ${sugg ? html`<${AiSourceSummary} c=${c} ci0=${ci0} source=${source} aiMeta=${aiMeta} pending=${pendingAi.length} showTranscript=${showTranscript} setShowTranscript=${setShowTranscript} ciId=${ciId} />`
              : html`<${AiCapture} source=${source} setSource=${setSource} rec=${rec} setRec=${setRec} proc=${proc} start=${startProcessing}
                  notesText=${notesText} setNotesText=${setNotesText} fileName=${fileName} setFileName=${setFileName} durationMin=${form.durationMin} />`}
          </div>`}
        </div>
      <//>

      <${ui.Card} title="Avstämningen" icon="clipboard">
        ${sugg && method === 'ai' && html`<div style="margin-bottom:16px"><${ui.Notice} tone="info" title="AI-förslag – du bedömer">Varje förslag visas med citat och tidpunkt. Acceptera, ändra eller avvisa. <b>Samlad status föreslås aldrig</b> – den väljer du själv.<//></div>`}
        <div>
          <${Section} n="1" title="Datum, längd och sätt" ok=${!!form.date} extra=${html`<span class="small muted" style="font-weight:500">Förifyllt från kalendern</span>`}>
            <div class="form-grid">
              <${ui.Field} label="Datum" id="ci-date" help="Dagen för mötet."><${ui.Input} id="ci-date" type="date" value=${form.date} onInput=${(v) => set('date', v)} /><//>
              <${ui.Field} label="Starttid" id="ci-time" help="När mötet började."><${ui.Input} id="ci-time" type="time" value=${form.time} onInput=${(v) => set('time', v)} /><//>
              <${ui.Field} label="Längd" id="ci-dur" help="Ungefärlig längd på samtalet."><${ui.Seg} id="ci-dur" ariaLabel="Längd" value=${Number(form.durationMin)} onChange=${(v) => set('durationMin', v)} options=${[30, 45, 60, 90].map((v) => ({ value: v, label: `${v} min` }))} /><//>
              <${ui.Field} label="Sätt" id="ci-mode" help="Hur ni träffades."><${ui.Seg} id="ci-mode" ariaLabel="Sätt" value=${form.mode} onChange=${(v) => set('mode', v)} options=${MODE_OPTIONS} /><//>
            </div>
          <//>

          <${Section} n="2" title="Närvaro senaste veckan" ok=${att.unregistered === 0} extra=${html`<span class="small muted" style="font-weight:500">${d.fmtDateShort(lastWeekFrom)}–${d.fmtDateShort(form.date)} · från närvaroregistreringen</span>`}>
            <div class="row-sm">
              <${ui.Badge} tone="blue" icon="check-circle">${att.present} närvarande<//>
              <${ui.Badge} tone="grey" icon="clock">${att.late} sen<//>
              <${ui.Badge} tone="outline" icon="minus-circle">${att.absentValid} giltig frånvaro<//>
              <${ui.Badge} tone=${att.absentInvalid > 0 ? 'red' : 'outline'} icon="x-circle">${att.absentInvalid} ogiltig frånvaro<//>
              ${att.unregistered > 0 && html`<${ui.Badge} tone="redfill" icon="alert">${att.unregistered} ej registrerade<//>`}
              <span class="small muted">${att.rate != null ? `Närvarograd ${fmt.pct(att.rate, 0)} av ${att.planned} planerade` : 'Inga passerade tillfällen'}</span>
            </div>
            ${att.unregistered > 0 && html`<div><${ui.Btn} kind="ghost" icon="check-square" onClick=${() => go('coach.narvaro', { week: d.monday(form.date) === d.monday(today) ? 'this' : 'last' })}>Registrera närvaron först<//></div>`}
            ${repeated && html`<${ui.Notice} tone="warn" title="Upprepad ogiltig frånvaro">${repeated.length} ogiltiga frånvarotillfällen inom ${MM.cfg().attendance.repeatedAbsenceRule.withinDays} dagar. Överväg samlad status Röd med en åtgärdsplan.<//>`}
            <${ui.Field} label="Kommentar om närvaron" id="ci-attc" help="Valfritt. Till exempel vad ni kom överens om efter en frånvaro."><${ui.Input} id="ci-attc" value=${form.attendanceComment} onInput=${(v) => set('attendanceComment', v)} maxLength=${200} /><//>
          <//>

          <${Section} n="3" title="Veckomål" ok=${!!form.goalStatus && !!form.nextGoal.trim()}>
            ${pair('goalStatus', html`<${ui.Field} label="Veckomål uppnått" id="ci-goal" required error=${errors.goalStatus} help=${prevGoal ? `Förra veckans mål: ”${prevGoal}”` : 'Stäm av målet från förra veckan.'}>
              <${ui.Seg} id="ci-goal" ariaLabel="Veckomål uppnått" value=${form.goalStatus} onChange=${(v) => set('goalStatus', v)} options=${GOAL_OPTIONS} />
            <//>`)}
            ${pair('nextGoal', html`<${ui.Field} label="Nytt veckomål" id="ci-nextgoal" required error=${errors.nextGoal} help="Kort och konkret. Välj ett förslag för fasen eller skriv eget.">
              <${ui.Input} id="ci-nextgoal" value=${form.nextGoal} onInput=${(v) => set('nextGoal', v)} maxLength=${140} />
            <//>
            ${goalSuggestions.length > 0 && html`<div class="co-chips" role="group" aria-label="Förslag på veckomål">${goalSuggestions.map((gl) => html`<button type="button" class="co-chip" key=${gl} onClick=${() => set('nextGoal', gl)}>${gl}</button>`)}</div>`}`)}
          <//>

          <${Section} n="4" title="Fas" ok=${!!form.phase}>
            ${pair('phase', html`<${ui.Field} label="Fas" id="ci-phase" required help=${`Ärendet är i fas ${c.phase} sedan ${d.fmtDate(sel.phaseSince(c))}. Byte registreras när du godkänner.`}>
              <${ui.Seg} id="ci-phase" ariaLabel="Fas" value=${Number(form.phase)} onChange=${(v) => set('phase', v)} options=${phaseOptions()} />
            <//>`)}
          <//>

          <${Section} n="5" title="Genomförda aktiviteter" ok=${form.activitiesDone.length > 0} extra=${html`<${ui.Badge} tone="plan" title="Mall 02 finns inte i underlaget">Exempel – stäms av mot mall 02<//>`}>
            ${pair('activitiesDone', html`<${ui.Field} label="Aktiviteter under veckan" id="ci-acts" help="Välj alla som stämmer.">
              <${ui.Seg} id="ci-acts" multi ariaLabel="Genomförda aktiviteter" value=${form.activitiesDone} onChange=${(v) => set('activitiesDone', v)} options=${SC.ACTIVITY_TYPES.map((x) => ({ value: x, label: x }))} />
            <//>`)}
          <//>

          <${Section} n="6" title="Arbetsgivarkontakter" ok=${form.ecCount != null}>
            ${pair('employerContacts', html`<div class="stack">
              <${ui.Field} label="Antal" id="ci-ec" required error=${errors.ec} help="Konkreta kontakter under veckan.">
                <${ui.Seg} id="ci-ec" ariaLabel="Antal arbetsgivarkontakter" value=${form.ecCount} onChange=${(v) => set('ecCount', v)} options=${['0', '1', '2+'].map((v) => ({ value: v, label: v }))} />
              <//>
              ${ecOn && html`<${ui.Field} label="Typ" id="ci-ectype" help="Välj en eller flera.">
                <${ui.Seg} id="ci-ectype" multi ariaLabel="Typ av arbetsgivarkontakt" value=${form.ecTypes} onChange=${(v) => set('ecTypes', v)} options=${EC_TYPES.map((v) => ({ value: v, label: cap(v) }))} />
              <//>`}
            </div>`)}
          <//>

          <${Section} n="7" title="Samlad status" ok=${!!form.overallStatus} extra=${html`<span class="small muted" style="font-weight:500">Ditt val – föreslås aldrig av AI</span>`}>
            <${ui.Field} label="Samlad status" id="ci-status" required error=${errors.overallStatus} help="Grön = enligt plan. Gul = risk eller extra åtgärd. Röd = kräver omplanering eller dialog med kommunen.">
              <${ui.Seg} id="ci-status" ariaLabel="Samlad status" value=${form.overallStatus} onChange=${(v) => set('overallStatus', v)} options=${STATUS_OPTIONS} />
            <//>
            ${form.overallStatus === 'red' && html`<${ui.Card} tone="red" title="Avvikelse – krävs vid röd status" icon="alert">
              <div class="stack">
                <p>Avvikelse = åtgärd. Beskriv vad som hänt, vad som ska göras, vem som ansvarar och när ni följer upp.</p>
                <${ui.Field} label="Beskrivning" id="dev-desc" required error=${errors.devDescription} help="Sakligt och funktionellt. Inga diagnoser."><${ui.TextArea} id="dev-desc" rows=${2} value=${dev.description} onInput=${(v) => setDev({ ...dev, description: v })} maxLength=${300} /><//>
                <${ui.Field} label="Åtgärd" id="dev-action" required error=${errors.devAction} help="Vad görs för att planen ska hålla?"><${ui.TextArea} id="dev-action" rows=${2} value=${dev.action} onInput=${(v) => setDev({ ...dev, action: v })} maxLength=${300} /><//>
                <div class="form-grid">
                  <${ui.Field} label="Ansvarig" id="dev-owner" required error=${errors.devOwner} help="Den som ser till att åtgärden blir gjord."><${ui.Select} id="dev-owner" value=${dev.ownerId} onChange=${(v) => setDev({ ...dev, ownerId: v })} options=${owners} /><//>
                  <${ui.Field} label="Uppföljningsdatum" id="dev-follow" required error=${errors.devFollow} help="Förslag: om en vecka."><${ui.Input} id="dev-follow" type="date" value=${dev.followUpOn} onInput=${(v) => setDev({ ...dev, followUpOn: v })} /><//>
                </div>
                <${ui.Field} label="Behöver beslut från kommunen" id="dev-cust" help="Till exempel om planen, omfattningen eller ett avbrott."><${ui.Seg} id="dev-cust" ariaLabel="Behöver beslut från kommunen" value=${dev.needsCustomerDecision} onChange=${(v) => setDev({ ...dev, needsCustomerDecision: v })} options=${[{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nej' }]} /><//>
                <p class="small muted">När avstämningen är sparad kan du kalla kommunen till ett uppföljningsmöte.</p>
              </div>
            <//>`}
          <//>

          <${Section} n="8" title="Hinder" ok=${true}>
            ${pair('obstacles', html`<${ui.Field} label="Hinder" id="ci-obst" help="Funktionella kategorier. Välj inga om inget hindrar.">
              <${ui.Seg} id="ci-obst" multi ariaLabel="Hinder" value=${form.obstacles} onChange=${(v) => set('obstacles', v)} options=${SC.OBSTACLES.map((x) => ({ value: x, label: x }))} />
            <//>`)}
          <//>

          <${Section} n="9" title="Kort anteckning" ok=${!!form.note.trim()}>
            ${pair('note', html`<${ui.Field} label="Anteckning" id="ci-note" help=${`Kort och saklig. Inga diagnoser eller omdömen om personen. ${MM.cfg().customerVisibility.seesCoachNotes ? 'Kommunen kan läsa anteckningen.' : 'Kommunen ser inte anteckningen.'}`}>
              <${ui.TextArea} id="ci-note" rows=${3} value=${form.note} onInput=${(v) => set('note', v)} maxLength=${500} />
            <//>`)}
            <div class="small muted right">${form.note.length} av 500 tecken</div>
          <//>
        </div>
      <//>

      ${errors.ai && html`<${ui.Notice} tone="critical" title="AI-förslag väntar på ditt beslut">${errors.ai}<//>`}
      <div class="row-between">
        <div class="row">
          <${ui.Btn} kind="primary" size="lg" icon="check" onClick=${() => save(true)}>Godkänn avstämningen<//>
          <${ui.Btn} kind="secondary" icon="file" onClick=${() => save(false)}>Spara utkast<//>
        </div>
        <${DocTimer} start=${startRef.current} />
      </div>
      <${ui.DemoNote}>Dokumentationstiden mäts från att formuläret öppnas till godkännandet. Måttet används för att jämföra manuell dokumentation med AI-stöd (SPEC §8.5).<//>
    <//>`;
  };

  /** Information och registrering av samtycke till inspelning och AI (SPEC §8.1 punkt 2). */
  const ConsentPanel = ({ c, consent, informed, setInformed, lang, setLang }) => {
    const status = c.aiConsent;
    return html`<div class="stack">
      <${ui.Notice} tone="warn" title="Samtycke saknas">
        ${status === 'declined' ? `Deltagaren sa nej ${consent && consent.declinedAt ? d.fmtDate(consent.declinedAt) : ''}. Ett nej får inga konsekvenser. Fråga bara igen om deltagaren själv tar upp det.`
          : status === 'revoked' ? 'Deltagaren har återkallat sitt samtycke. Dokumentera manuellt eller informera på nytt om deltagaren själv vill.'
            : 'Deltagaren har inte fått frågan ännu. Inget får spelas in innan samtycket är registrerat.'}
      <//>
      <div class="co-consent-text">
        <span class="eyebrow">Information till deltagaren (läs upp eller ge i skrift)</span>
        <p>Vi vill spela in samtalet. Då kan din coach skriva anteckningarna snabbare.</p>
        <p>Ljudet raderas direkt när det har skrivits ut. Texten raderas när din coach har godkänt anteckningarna.</p>
        <p>Det är frivilligt. Du kan säga nej eller ändra dig när du vill. Ett nej påverkar inte ditt stöd.</p>
      </div>
      <${ui.Field} label="Språk för informationen" id="cons-lang" help="Översättning finns på de vanligaste språken.">
        <${ui.Seg} id="cons-lang" ariaLabel="Språk för informationen" value=${lang} onChange=${setLang} options=${['lättläst svenska', 'arabiska', 'somaliska', 'tigrinja', 'turkiska', 'engelska'].map((x) => ({ value: x, label: cap(x) }))} />
      <//>
      <${ui.Check} id="cons-informed" checked=${informed} onChange=${setInformed}>Jag har informerat deltagaren och deltagaren har förstått informationen.<//>
      <div class="row">
        <${ui.Btn} kind="primary" icon="check" disabled=${!informed} onClick=${() => { MM.dispatch('consent.set', { caseId: c.id, value: 'given', language: lang }); MM.toast(`Samtycket är registrerat (textversion v1.0, ${d.fmtDate(d.today())}, informerad av ${MM.persona() ? MM.persona().name : 'coachen'}).`, 'blue'); }}>Deltagaren säger ja<//>
        <${ui.Btn} kind="secondary" icon="x" disabled=${!informed} onClick=${() => { MM.dispatch('consent.set', { caseId: c.id, value: 'declined' }); MM.toast('Nejet är registrerat. Dokumentera manuellt.', 'blue'); }}>Deltagaren säger nej<//>
      </div>
    </div>`;
  };

  /** Val av ljudkälla, simulerad inspelning och bearbetning. */
  const AiCapture = ({ source, setSource, rec, setRec, proc, start, notesText, setNotesText, fileName, setFileName, durationMin }) => {
    const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (proc) return html`<div class="co-proc" role="status" aria-live="polite">
      ${proc.steps.map((s, i) => html`<div key=${i} class=${cls('step', i < proc.i ? 'done' : i === proc.i ? 'now' : 'todo')}><${I} name=${i < proc.i ? 'check' : i === proc.i ? 'refresh' : 'circle'} />${s}</div>`)}
      <span class="small muted">Bearbetas i Sverige/EU. Ingenting används för att träna modellen.</span>
    </div>`;
    return html`<div class="stack">
      <${ui.Field} label="Källa" id="ai-src" help="AI fyller samma formulär som den manuella vägen.">
        <${ui.Seg} id="ai-src" ariaLabel="Källa" value=${source} onChange=${(v) => { if (rec.status === 'idle' || rec.status === 'stopped') setSource(v); }} options=${Object.entries(SOURCE).map(([k, v]) => ({ value: k, label: v.label, icon: v.icon }))} />
      <//>
      ${source === 'recording' && html`<div class="stack-sm">
        <${ui.DemoNote}>Mikrofonen används inte i prototypen. Inspelningen simuleras och förslagen bygger på ett påhittat samtal på ${durationMin} minuter. I tjänsten spelas det in i webbläsaren och laddas upp i bitar till en privat lagring i Sverige.<//>
        ${rec.status === 'idle' && html`<div><${ui.Btn} kind="primary" icon="mic" onClick=${() => setRec({ status: 'recording', seconds: 0 })}>Starta inspelning<//></div>`}
        ${(rec.status === 'recording' || rec.status === 'paused') && html`<div class="row">
          ${rec.status === 'recording' ? html`<span class="rec-indicator" role="status"><span class="blink" aria-hidden="true"></span>Spelar in ${mmss(rec.seconds)}</span>`
            : html`<${ui.Badge} tone="grey" icon="pause">Inspelningen är pausad · ${mmss(rec.seconds)}<//>`}
          ${rec.status === 'recording' ? html`<${ui.Btn} kind="secondary" icon="pause" onClick=${() => setRec({ ...rec, status: 'paused' })}>Pausa<//>` : html`<${ui.Btn} kind="secondary" icon="play" onClick=${() => setRec({ ...rec, status: 'recording' })}>Fortsätt<//>`}
          <${ui.Btn} kind="danger" icon="stop" onClick=${() => { setRec({ ...rec, status: 'stopped' }); start('recording'); }}>Stoppa och tolka<//>
        </div>`}
        ${(rec.status === 'recording' || rec.status === 'paused') && html`<p class="small muted">Pausa när samtalet går in på sådant som inte behövs för uppdraget.</p>`}
      </div>`}
      ${source === 'upload' && html`<div class="stack-sm">
        <${ui.Field} label="Ljudfil" id="ai-file" help="Filformat: m4a, mp3, wav eller webm.">
          <input id="ai-file" type="file" accept=".m4a,.mp3,.wav,.webm,audio/*" onChange=${(e) => setFileName(e.target.files && e.target.files[0] ? e.target.files[0].name : '')} />
        <//>
        <div class="row-sm"><${ui.Btn} kind="ghost" icon="paperclip" onClick=${() => setFileName(`avstamning_${d.today()}.m4a`)}>Använd exempelfil<//>${fileName && html`<${ui.Badge} tone="outline" icon="file">${fileName}<//>`}</div>
        <${ui.DemoNote}>Filen laddas inte upp i prototypen – bara namnet används.<//>
        <div><${ui.Btn} kind="primary" icon="upload" disabled=${!fileName} onClick=${() => start('upload')}>Ladda upp och tolka<//></div>
      </div>`}
      ${source === 'teams' && html`<div class="stack-sm">
        <p>Transkriptet (.vtt) hämtas från Teams-mötet. Ingen ljudbehandling behövs.</p>
        <${ui.DemoNote}>Kopplingen till Microsoft Graph är simulerad.<//>
        <div><${ui.Btn} kind="primary" icon="video" onClick=${() => start('teams')}>Hämta transkript från Teams<//></div>
      </div>`}
      ${source === 'notes' && html`<div class="stack-sm">
        <${ui.Field} label="Dina anteckningar" id="ai-notes" help="Klistra in stödord eller anteckningar från mötet. Minst 20 tecken.">
          <${ui.TextArea} id="ai-notes" rows=${4} value=${notesText} onInput=${setNotesText} maxLength=${3000} />
        <//>
        <div><${ui.Btn} kind="primary" icon="sparkles" disabled=${notesText.trim().length < 20} onClick=${() => start('notes')}>Tolka anteckningarna<//></div>
      </div>`}
    </div>`;
  };

  /** Sammanfattning av AI-körningen och dataminimeringen (ljud och råtranskript). */
  const AiSourceSummary = ({ c, ci0, source, aiMeta, pending, showTranscript, setShowTranscript, ciId }) => {
    const src = SOURCE[source] || SOURCE.recording;
    const run = aiMeta && aiMeta.runId ? S().aiRuns.find((r) => r.id === aiMeta.runId) : null;
    const transcript = (aiMeta && aiMeta.transcript) || [];
    return html`<div class="stack">
      <div class="row-sm"><${ui.AiTag}>AI-utkast<//><span class="strong">${src.label}${ci0 && ci0.ai ? ` · ${d.fmtDateTimeLong(ci0.heldAt)}` : ''}</span>
        ${run && html`<span class="small muted">${run.provider} · ${run.model}</span>`}</div>
      <${ui.Timeline} items=${[
        src.audio ? { icon: 'trash', filled: true, title: 'Ljudet är raderat', sub: aiMeta && aiMeta.audioDeletedAt ? `${d.fmtDateTimeLong(aiMeta.audioDeletedAt)} – direkt efter transkriberingen` : 'Direkt efter transkriberingen' }
          : { icon: 'info', title: 'Inget ljud', sub: source === 'teams' ? 'Transkriptet hämtades från Teams.' : 'Förslagen bygger på dina anteckningar.' },
        { icon: 'file', title: 'Råtranskriptet raderas när du godkänner', sub: aiMeta && aiMeta.deleteBy ? `Senast ${d.fmtDate(aiMeta.deleteBy)} om avstämningen inte godkänns.` : '' },
        { icon: 'check', title: pending > 0 ? `${pending} förslag väntar på ditt beslut` : 'Alla förslag är granskade', sub: 'Varje beslut sparas och loggas.' },
      ]} />
      ${transcript.length > 0 && html`<div class="stack-sm">
        <div><${ui.Btn} kind="ghost" icon=${showTranscript ? 'eye-off' : 'eye'} ariaPressed=${showTranscript ? 'true' : 'false'} onClick=${() => setShowTranscript(!showTranscript)}>${showTranscript ? 'Dölj råtranskriptet' : 'Visa råtranskriptet'}<//></div>
        ${showTranscript && html`<${TranscriptPanel} ciId=${ciId || (ci0 && ci0.id)} transcript=${transcript} />`}
        ${showTranscript && html`<span class="small muted">Visningen loggas i revisionsloggen. Rapporter byggs aldrig från råtranskriptet.</span>`}
      </div>`}
    </div>`;
  };

  /** Efter godkännande: sammanfattning, dataminimering och "Kalla kommunen till uppföljning". */
  const CheckInDone = ({ c, done }) => {
    const st = MM.useStore();
    const ci = st.checkIns.find((x) => x.id === done.checkInId) || {};
    const dv = done.deviationId ? st.deviations.find((x) => x.id === done.deviationId) : null;
    const ref = referrerOf(c);
    const [proposed, setProposed] = useState(() => `${d.addWorkingDays(d.today(), 2)}T10:00`);
    const [body, setBody] = useState(() => `Hej${ref ? ` ${ref.name.split(' ')[0]}` : ''}! Veckoavstämningen för ärende ${c.number} visar att planen behöver ses över. Jag föreslår ett uppföljningsmöte ${d.fmtDateTimeLong(`${d.addWorkingDays(d.today(), 2)}T10:00`)} hos oss i ${c.location || 'Alby'}. Svara gärna här om tiden passar eller föreslå en annan. Hälsningar ${MM.persona() ? MM.persona().name : ''}, Miljonbemanning`);
    const [sent, setSent] = useState(false);
    const count = (k) => done.decisions.filter((x) => x.decision === k).length;
    const m = Math.floor(done.docSecs / 60); const s = done.docSecs % 60;
    return html`<${ui.Page} title="Avstämningen är godkänd" eyebrow=${`${nameOf(c)} · ${c.number}`}
      crumbs=${[{ label: 'Min vecka', view: 'coach.minvecka' }, { label: 'Veckoavstämning' }]}>
      <div class="grid-3">
        <${ui.Kpi} label="Dokumentationstid" value=${`${m} min ${String(s).padStart(2, '0')} s`} sub=${m < 5 ? 'Under målet 5 min' : 'Över målet 5 min'} tone=${m < 5 ? undefined : 'watch'} />
        <${ui.Kpi} label="Samlad status" value=${html`<${ui.Status} value=${ci.overallStatus} short />`} sub=${ci.phase ? sel.phaseLabel(ci.phase) : ''} />
        <${ui.Kpi} label="AI-förslag" value=${done.decisions.length ? `${count('accepted')} / ${count('changed')} / ${count('rejected')}` : '–'} sub=${done.decisions.length ? 'accepterade / ändrade / avvisade' : 'Manuell dokumentation'} />
      </div>
      ${ci.ai && html`<${ui.Card} title="Dataminimering" icon="shield">
        <${ui.Timeline} items=${[
          ci.ai.audioDeletedAt ? { icon: 'trash', filled: true, title: 'Ljudet raderades direkt efter transkriberingen', sub: d.fmtDateTimeLong(ci.ai.audioDeletedAt) } : { icon: 'info', title: 'Inget ljud användes' },
          { icon: 'trash', filled: true, title: 'Råtranskriptet raderades vid godkännandet', sub: ci.ai.rawTranscriptDeletedAt ? d.fmtDateTimeLong(ci.ai.rawTranscriptDeletedAt) : '' },
          { icon: 'check', filled: true, title: 'Kvar finns bara godkända, strukturerade uppgifter', sub: 'Det är dem månadsrapporten byggs av.' },
        ]} />
      <//>`}
      ${dv && html`<${ui.Card} tone="red" title="Avvikelse skapad" icon="alert">
        <div class="stack">
          <${ui.Kv} items=${[['Beskrivning', dv.description], ['Åtgärd', dv.action], ['Ansvarig', MM.personName(dv.ownerId)], ['Uppföljning', d.fmtDate(dv.followUpOn)], ['Beslut från kommunen', dv.needsCustomerDecision ? 'Behövs' : 'Behövs inte']]} />
          ${!sent ? html`<div class="stack">
            <span class="section-title"><span class="dot" aria-hidden="true"></span>Kalla kommunen till uppföljning</span>
            <p class="small">Mötesförfrågan skickas som ett säkert meddelande i portalen till ${ref ? `${ref.name}, ${ref.unit}` : 'handläggaren'}. Mejlet till handläggaren innehåller bara ärendenumret.</p>
            <div class="form-grid">
              <${ui.Field} label="Föreslagen tid" id="call-at" help="Förslag: om två arbetsdagar."><${ui.Input} id="call-at" type="datetime-local" value=${proposed} onInput=${setProposed} /><//>
            </div>
            <${ui.Field} label="Meddelande" id="call-body" help="Skrivs i portalen. Skriv inga känsliga detaljer."><${ui.TextArea} id="call-body" rows=${4} value=${body} onInput=${setBody} maxLength=${800} /><//>
            <div class="row"><${ui.Btn} kind="primary" icon="send" disabled=${!body.trim() || !proposed} onClick=${() => { MM.dispatch('deviation.callCustomer', { caseId: c.id, deviationId: dv.id, body: body.trim(), proposedAt: proposed }); setSent(true); MM.toast('Mötesförfrågan är skickad till kommunen.', 'blue'); }}>Kalla kommunen till uppföljning<//></div>
          </div>` : html`<div class="stack">
            <${ui.Notice} tone="ok" title="Mötesförfrågan är skickad">Föreslagen tid: ${d.fmtDateTimeLong(proposed)}. Handläggaren fick mejlet: ”Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.”<//>
            <div class="row"><${ui.PerspectiveSwitch} role=${customerRoleFor(c)} view="kom.deltagare" params=${{ caseId: c.id }} label="Se mötesförfrågan som kommunen" /></div>
          </div>`}
        </div>
      <//>`}
      <div class="row">
        <${ui.Btn} kind="primary" icon="calendar" onClick=${() => go('coach.minvecka', {})}>Till Min vecka<//>
        ${canOpen('arende.kort') && html`<${ui.Btn} kind="secondary" onClick=${() => go('arende.kort', { caseId: c.id, tab: 'avstamningar' })}>Öppna deltagarkortet<//>`}
      </div>
    <//>`;
  };

  // ============================================================ MÅNADSBEDÖMNING
  const Manad = ({ params }) => {
    MM.useStore();
    const month = params.month || prevMonth();
    if (!params.caseId) {
      return html`<${CasePicker} view="coach.manad" extra=${{ month }} title=${`Månadsbedömning ${d.monthName(month)}`} actionLabel="Bedöm"
        lead=${`Välj deltagare. ${monthDueNote()}: senast ${d.fmtWeekday(monthDueFor(month))}.`}
        filter=${(c) => !!sel.assessment(c.id, month)}
        statusOf=${(c) => { const ma = sel.assessment(c.id, month); return ma.status === 'approved' ? html`<${ui.Badge} tone="blue" icon="check">Godkänd<//>` : html`<${ui.Badge} tone="outline" icon="edit">Utkast<//>`; }} />`;
    }
    const c = sel.caseById(params.caseId);
    const g = gate(c); if (g) return html`<${GateView} g=${g} title="Månadsbedömning" view="coach.manad" />`;
    return html`<${ManadForm} c=${c} month=${month} />`;
  };

  const ManadForm = ({ c, month }) => {
    const st = MM.useStore();
    ui.useAuditView('case', c.id, 'case.view');
    const cfg = MM.cfg(); const prog = cfg.progression; const scale = prog.scale; const reqFrom = prog.observationRequiredFromLevel;
    const ma0 = sel.assessment(c.id, month);
    const plan0 = sel.planOf(c.id, month) || {};
    const aiOk = c.aiConsent === 'given' && !isProtected(c);
    const [areas, setAreas] = useState(() => Object.fromEntries(prog.areas.map((k) => { const a = (ma0 && ma0.areas && ma0.areas[k]) || {}; return [k, { level: a.level == null ? null : a.level, observation: a.observation || '', nextStep: a.nextStep || '' }]; })));
    const [overall, setOverall] = useState((ma0 && ma0.overallStatus) || null);
    const [summary, setSummary] = useState((ma0 && ma0.summary) || '');
    const [plan, setPlan] = useState(() => ({ goal1: plan0.goal1 || '', goal2: plan0.goal2 || '', plannedActivities: plan0.plannedActivities || '', plannedEmployerContact: plan0.plannedEmployerContact || '', plannedAdaptation: plan0.plannedAdaptation || '', nextCustomerMeeting: plan0.nextCustomerMeeting || '' }));
    const [errors, setErrors] = useState({});
    const [approvedNow, setApprovedNow] = useState(false);
    const setArea = (k, patch) => { setAreas((x) => ({ ...x, [k]: { ...x[k], ...patch } })); if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
    const setP = (k, v) => setPlan((p) => ({ ...p, [k]: v }));
    const mStart = `${month}-01`; const mEnd = d.monthEnd(month);
    const cis = sel.checkInsOf(c.id).filter((x) => x.status === 'approved' && x.heldAt >= mStart && x.heldAt <= `${mEnd}T23:59`).sort(MM.by('heldAt'));
    const att = sel.attendanceStats(c.id, mStart, mEnd);
    const events = sel.eventsOf(c.id).filter((e) => e.occurredOn >= mStart && e.occurredOn <= mEnd);
    const rep = st.reports.find((r) => r.kind === 'monthly' && r.caseId === c.id && r.month === month);
    const dueAt = (rep && rep.dueAt) || monthDueFor(month);
    const levels = Object.values(areas).map((a) => a.level).filter((x) => x != null);
    const clear = levels.some((x) => x >= 2); const any = levels.some((x) => x >= 1);
    const nextMonth = d.addMonths(month, 1);
    const approved = ma0 && ma0.status === 'approved';
    const goalsFor = SC.GOALS[Math.min(5, c.phase)] || [];

    const save = (approve) => {
      const payload = { caseId: c.id, month, areas: Object.fromEntries(Object.entries(areas).map(([k, a]) => [k, { level: a.level, observation: a.observation.trim(), nextStep: a.nextStep.trim() }])),
        summary: summary.trim(), overallStatus: overall, approve, plan: { ...plan, status: approve ? 'approved' : 'draft' } };
      const res = MM.dispatch('assessment.save', payload);
      if (!res) return;
      if (res.error === 'incomplete') {
        const e = {};
        for (const k of res.missing || []) e[k] = areas[k].level == null ? 'Välj nivå.' : `Skriv en konkret observation. Mallen kräver belägg från nivå ${reqFrom}.`;
        if (!overall) e.overall = 'Välj samlad status.';
        setErrors(e);
        MM.toast(`Bedömningen kan inte godkännas: ${(res.missing || []).length} områden saknar uppgifter${!overall ? ' och samlad status saknas' : ''}.`, 'red');
        setTimeout(() => { const first = document.querySelector('.cm-table tr.row-alert select, #cm-overall'); if (first) { try { first.scrollIntoView({ block: 'center' }); } catch (err) { /* */ } first.focus && first.focus(); } }, 40);
        return;
      }
      setErrors({});
      if (approve) { setApprovedNow(true); MM.toast('Månadsbedömningen är godkänd. Månadsrapporten är granskad och kan godkännas och levereras.', 'blue'); try { window.scrollTo({ top: 0 }); } catch (err) { /* */ } }
      else MM.toast('Utkastet är sparat.', 'blue');
    };

    const crumbs = [{ label: 'Min vecka', view: 'coach.minvecka' }, { label: `Månadsbedömning ${monShort(month)}` }];
    if (approved) {
      return html`<${ui.Page} title=${`Månadsbedömning ${d.monthName(month)}`} eyebrow=${`${nameOf(c)} · ${c.number}`} crumbs=${crumbs}>
        <${ui.Notice} tone="ok" title=${approvedNow ? 'Bedömningen är godkänd' : `Godkänd ${ma0.decidedAt ? d.fmtDateTime(ma0.decidedAt) : ''}`}>
          Månadsrapporten byggs av den godkända bedömningen. ${rep ? `Rapportens status: ${sel.reportStatusLabel(rep.status).toLowerCase()}.` : ''} En godkänd bedömning ändras genom en rättad rapportversion.<//>
        <div class="row">
          ${rep && html`<${ui.Btn} kind="primary" icon="file" onClick=${() => go('rapport.visa', { reportId: rep.id })}>Förhandsgranska månadsrapporten<//>`}
          <${ui.Btn} kind="secondary" onClick=${() => go('coach.minvecka', {})}>Till Min vecka<//>
          <${ui.PerspectiveSwitch} role=${customerRoleFor(c)} view="kom.rapporter" label="Se kommunens rapportlista" />
        </div>
        <${ui.Card} title="Progressionsområden" icon="chart" flush>
          <${ui.Table} caption="Godkänd bedömning" rowKey="key" rows=${prog.areas.map((k) => ({ key: k, ...(ma0.areas[k] || {}) }))} columns=${[
            { key: 'a', label: 'Område', render: (r) => html`<span class="strong">${prog.areaLabels[r.key]}</span>` },
            { key: 'l', label: 'Nivå', nowrap: true, render: (r) => (r.level != null ? `${r.level} – ${scale[r.level]}` : '–') },
            { key: 'o', label: 'Konkret observation', render: (r) => r.observation || html`<span class="muted">–</span>` },
            { key: 'n', label: 'Nästa steg', render: (r) => r.nextStep || '–' },
          ]} />
        <//>
        <${ui.Card} title="Samlad status och sammanfattning" icon="clipboard"><div class="stack-sm"><${ui.Status} value=${ma0.overallStatus} /><p>${ma0.summary || '–'}</p></div><//>
      <//>`;
    }

    return html`<${ui.Page} title=${`Månadsbedömning ${d.monthName(month)}`} eyebrow=${`${nameOf(c)} · ${c.number}`} crumbs=${crumbs}
      lead=${`Bedöm förändringen jämfört med föregående månad. Nivån är tom tills du väljer. Konkret observation krävs från nivå ${reqFrom}.`}
      actions=${html`<${ui.Badge} tone="plan" icon="clock" title=${monthDueNote()}>Förslag: senast ${d.fmtWeekday(dueAt)}<//>`}>

      <div class="split-wide">
        <${ui.Card} title="Underlag för månaden" icon="book">
          <div class="stack">
            <${CaseHead} c=${c} />
            <div class="grid-3">
              <${ui.Kpi} label="Godkända avstämningar" value=${String(cis.length)} sub=${cis.length ? cis.map((x) => d.fmtDateShort(x.heldAt)).join(', ') : 'Inga i månaden'} />
              <${ui.Kpi} label="Närvarograd" value=${att.rate != null ? fmt.pct(att.rate, 0) : '–'} sub=${`${att.present + att.late} av ${att.planned - att.unregistered} tillfällen`} />
              <${ui.Kpi} label="Händelser" value=${String(events.length)} sub=${events.length ? events.map((e) => sel.eventLabel(e.kind)).join(', ') : 'Inga registrerade'} />
            </div>
            <p class="small muted">${monthDueNote()}. Rapporten byggs bara av godkända uppgifter – aldrig av råtranskript.</p>
          </div>
        <//>
        <${ui.Card} title="Skala och statistik" icon="info">
          <div class="stack-sm">
            <${ui.Kv} items=${[0, 1, 2, 3].map((n) => [`Nivå ${n}`, scale[n]])} />
            <div class="divider"></div>
            <p class="small"><b>Tydlig progression</b> = minst ett område på nivå 2 eller högre. <b>Någon progression</b> = minst ett område på nivå 1 eller högre. Definitionen är konfigurerbar.</p>
            <div class="row-sm"><${ui.Badge} tone=${clear ? 'blue' : 'outline'} icon=${clear ? 'check' : 'minus'}>Tydlig: ${clear ? 'ja' : 'nej'}<//><${ui.Badge} tone=${any ? 'bluetone' : 'outline'} icon=${any ? 'check' : 'minus'}>Någon: ${any ? 'ja' : 'nej'}<//><span class="small muted">med dina val hittills</span></div>
          </div>
        <//>
      </div>

      ${aiOk ? html`<${ui.Notice} tone="info" title="AI-stöd">AI har skrivit utkast till observationer utifrån månadens godkända avstämningar, med källor. Nivåförslaget visas bredvid rullgardinen men fylls aldrig i. <${ui.BuildPhase} fas=${2} /><//>`
        : html`<p class="small muted">AI-stöd används inte i det här ärendet${isProtected(c) ? ' (skyddade personuppgifter)' : ' eftersom deltagaren inte har samtyckt'}. Dokumentera manuellt.</p>`}

      <${ui.Card} title="Progressionsområden" icon="chart" flush actions=${html`<span class="small muted">${levels.length} av ${prog.areas.length} bedömda</span>`}>
        <div class="table-wrap">
          <table class="table cm-table">
            <caption class="sr-only">Progressionsområden med nivå, observation och nästa steg</caption>
            <thead><tr><th scope="col">Område</th><th scope="col">Nivå 0–3</th><th scope="col">Konkret observation</th><th scope="col">Nästa steg</th></tr></thead>
            <tbody>
              ${prog.areas.map((k) => { const a = areas[k]; const src = (ma0 && ma0.areas && ma0.areas[k]) || {}; const err = errors[k]; const lab = prog.areaLabels[k];
                const needObs = a.level != null && a.level >= reqFrom;
                const aiLvl = aiOk ? src.aiLevelSuggestion : null; const aiObs = aiOk ? src.aiObservationDraft : null;
                return html`<tr key=${k} class=${err ? 'row-alert' : ''}>
                  <td class="cm-area">${lab}</td>
                  <td data-label="Nivå 0–3">
                    <div class="stack-sm">
                      <label class="sr-only" for=${`lvl-${k}`}>Nivå för ${lab}</label>
                      <${ui.Select} id=${`lvl-${k}`} value=${a.level == null ? '' : String(a.level)} invalid=${!!(err && a.level == null)} placeholder="Välj nivå"
                        onChange=${(v) => setArea(k, { level: v === '' ? null : Number(v) })} options=${[0, 1, 2, 3].map((n) => ({ value: String(n), label: `${n} – ${scale[n]}` }))} />
                      ${aiLvl != null && html`<span><${ui.AiTag}>Förslag: ${aiLvl} – ${scale[aiLvl]}<//></span>`}
                    </div>
                  </td>
                  <td data-label="Konkret observation" class="cm-obs">
                    <div class="stack-sm">
                      <label class="sr-only" for=${`obs-${k}`}>Konkret observation för ${lab}</label>
                      <${ui.TextArea} id=${`obs-${k}`} rows=${2} value=${a.observation} invalid=${!!(err && a.level != null)} onInput=${(v) => setArea(k, { observation: v })} maxLength=${400} />
                      ${needObs && !a.observation.trim() && !err && html`<span class="small muted">Obligatorisk från nivå ${reqFrom}.</span>`}
                      ${err && html`<div class="error-text" role="alert"><${I} name="alert-circle" />${err}</div>`}
                      ${aiObs && html`<div class="ai-box">
                        <div class="row-sm"><${ui.AiTag}>AI-utkast<//><span class="small muted">Källa: ${(aiObs.sources || []).join(', ')}</span></div>
                        <div>${aiObs.text}</div>
                        <div><${ui.Btn} kind="secondary" icon="copy" onClick=${() => setArea(k, { observation: aiObs.text })}>Använd utkastet<//></div>
                      </div>`}
                    </div>
                  </td>
                  <td data-label="Nästa steg">
                    <label class="sr-only" for=${`next-${k}`}>Nästa steg för ${lab}</label>
                    <${ui.Input} id=${`next-${k}`} value=${a.nextStep} onInput=${(v) => setArea(k, { nextStep: v })} maxLength=${160} />
                  </td>
                </tr>`; })}
            </tbody>
          </table>
        </div>
      <//>

      <div class="split">
        <${ui.Card} title="Samlad status och sammanfattning" icon="clipboard">
          <div class="stack">
            <${ui.Field} label="Samlad status" id="cm-overall" required error=${errors.overall} help="Ditt val. Föreslås aldrig av AI.">
              <${ui.Seg} id="cm-overall" ariaLabel="Samlad status" value=${overall} onChange=${(v) => { setOverall(v); setErrors((e) => { const n = { ...e }; delete n.overall; return n; }); }} options=${STATUS_OPTIONS} />
            <//>
            <${ui.Field} label="Kort sammanfattning" id="cm-summary" help="Två till fyra meningar om månaden. Sakligt och funktionellt.">
              <${ui.TextArea} id="cm-summary" rows=${4} value=${summary} onInput=${setSummary} maxLength=${800} />
            <//>
            ${aiOk && ma0 && ma0.aiSummaryDraft && html`<div class="ai-box">
              <div class="row-sm"><${ui.AiTag}>AI-utkast<//><span class="small muted">Bygger bara på godkända avstämningar</span></div>
              <div>${ma0.aiSummaryDraft}</div>
              <div><${ui.Btn} kind="secondary" icon="copy" onClick=${() => setSummary(ma0.aiSummaryDraft)}>Använd utkastet<//></div>
            </div>`}
          </div>
        <//>
        <${ui.Card} title=${`Plan för ${d.monthName(nextMonth)}`} icon="target">
          <div class="stack">
            <${ui.Field} label="Mål 1" id="pl-g1" help="Det viktigaste målet nästa månad."><${ui.Input} id="pl-g1" value=${plan.goal1} onInput=${(v) => setP('goal1', v)} maxLength=${140} /><//>
            <${ui.Field} label="Mål 2" id="pl-g2" help="Ett andra mål, gärna kopplat till yrkesspåret."><${ui.Input} id="pl-g2" value=${plan.goal2} onInput=${(v) => setP('goal2', v)} maxLength=${140} /><//>
            ${goalsFor.length > 0 && html`<div class="co-chips" role="group" aria-label="Förslag på mål">${goalsFor.map((gl) => html`<button type="button" key=${gl} class="co-chip" onClick=${() => setP(plan.goal1 ? 'goal2' : 'goal1', gl)}>${gl}</button>`)}</div>`}
            <${ui.Field} label="Planerade aktiviteter" id="pl-act" help="Vad deltagaren ska göra och hur ofta."><${ui.Input} id="pl-act" value=${plan.plannedActivities} onInput=${(v) => setP('plannedActivities', v)} maxLength=${200} /><//>
            <${ui.Field} label="Planerad arbetsgivarkontakt" id="pl-emp" help="Till exempel studiebesök, intervju eller praktikstart."><${ui.Input} id="pl-emp" value=${plan.plannedEmployerContact} onInput=${(v) => setP('plannedEmployerContact', v)} maxLength=${200} /><//>
            <${ui.Field} label="Planerad anpassning" id="pl-adapt" help="Beskriv funktionellt, aldrig diagnos. Lämna tomt om ingen behövs."><${ui.Input} id="pl-adapt" value=${plan.plannedAdaptation} onInput=${(v) => setP('plannedAdaptation', v)} maxLength=${200} /><//>
            <${ui.Field} label="Nästa möte med kommunen" id="pl-meet" help="Datum för uppföljning med handläggaren, om det är bokat."><${ui.Input} id="pl-meet" type="date" value=${plan.nextCustomerMeeting} onInput=${(v) => setP('nextCustomerMeeting', v)} /><//>
          </div>
        <//>
      </div>

      ${Object.keys(errors).length > 0 && html`<${ui.Notice} tone="critical" title="Bedömningen är inte komplett">${Object.keys(errors).filter((k) => k !== 'overall').length} områden är markerade${errors.overall ? ' och samlad status saknas' : ''}. Mallen kräver alltid belägg eller exempel från nivå ${reqFrom}.<//>`}
      <div class="row">
        <${ui.Btn} kind="primary" size="lg" icon="check" onClick=${() => save(true)}>Godkänn bedömningen<//>
        <${ui.Btn} kind="secondary" icon="file" onClick=${() => save(false)}>Spara utkast<//>
      </div>
    <//>`;
  };

  // ============================================================ KARTLÄGGNING
  const DIGITAL = ['Van vid mobil, ovan vid dator', 'Använder e-post och BankID själv', 'Behöver stöd med digitala tjänster', 'Van datoranvändare'];
  const LICENCE = ['Inget körkort', 'Övningskör', 'B-körkort', 'C-körkort eller högre', 'Truckkort'];
  const DIAGNOSIS = /(^|[^a-zåäö0-9])(diagnos|adhd|autism|asperger|depression|ptsd|bipolär|schizofren|diabetes|epilepsi|dyslexi|utmattningssyndrom|ångestsyndrom)/i;

  const Kartlaggning = ({ params }) => {
    MM.useStore();
    if (!params.caseId) {
      return html`<${CasePicker} view="coach.kartlaggning" title="Kartläggning" actionLabel="Öppna" lead="Kartläggningen görs vecka 1 och dokumenterar deltagarens reella kompetens."
        statusOf=${(c) => { const ia = sel.intakeOf(c.id); return !ia ? html`<${ui.Badge} tone="outline">Inte påbörjad<//>` : ia.status === 'approved' ? html`<${ui.Badge} tone="blue" icon="check">Godkänd<//>` : html`<${ui.Badge} tone="outline" icon="edit">Utkast<//>`; }} />`;
    }
    const c = sel.caseById(params.caseId);
    const g = gate(c); if (g) return html`<${GateView} g=${g} title="Kartläggning" view="coach.kartlaggning" />`;
    return html`<${IntakeForm} c=${c} />`;
  };

  const IntakeForm = ({ c }) => {
    MM.useStore();
    ui.useAuditView('case', c.id, 'case.view');
    const ia = sel.intakeOf(c.id);
    const [f, setF] = useState(() => ({ workExperience: (ia && ia.workExperience) || '', education: (ia && ia.education) || '', languageNotes: (ia && ia.languageNotes) || '', digitalSkills: (ia && ia.digitalSkills) || '',
      drivingLicence: (ia && ia.drivingLicence) || '', workGoals: (ia && ia.workGoals) || '', chosenTrack: (ia && ia.chosenTrack) || '', adaptations: (ia && ia.adaptations) || '', firstWeekGoal: (ia && ia.firstWeekGoal) || '' }));
    const [allTracks, setAllTracks] = useState(false);
    const [errors, setErrors] = useState({});
    const [savedNow, setSavedNow] = useState(null);
    const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };
    const stuck = sel.stuck(c);
    const areaTracks = MM.uniq([...(SC.TRACKS[c.primaryArea] || []), ...(c.secondaryArea ? SC.TRACKS[c.secondaryArea] || [] : [])]);
    const allOptions = S().areas.flatMap((a) => (SC.TRACKS[a.code] || []).map((t) => ({ value: t, label: `${a.code} ${a.name} – ${t}` })));
    const diag = DIAGNOSIS.test(f.adaptations);
    const approved = ia && ia.status === 'approved';
    const REQUIRED = { workExperience: 'Beskriv arbetslivserfarenheten.', education: 'Fyll i utbildning.', languageNotes: 'Beskriv språket.', digitalSkills: 'Välj digital vana.', drivingLicence: 'Välj körkort.', workGoals: 'Skriv yrkesmålet.', chosenTrack: 'Välj yrkesspår.', firstWeekGoal: 'Skriv första veckomålet.' };
    const save = (approve) => {
      const e = {};
      if (approve) for (const [k, msg] of Object.entries(REQUIRED)) if (!String(f[k] || '').trim()) e[k] = msg;
      if (diag) e.adaptations = 'Texten ser ut att innehålla en diagnos. Beskriv i stället vad deltagaren behöver i arbetet.';
      setErrors(e);
      if (Object.keys(e).length) { MM.toast(approve ? 'Kartläggningen kan inte godkännas ännu. Se markerade fält.' : 'Ta bort diagnosen innan du sparar.', 'red'); return; }
      const data = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v).trim()]));
      MM.dispatch('intake.save', { caseId: c.id, data, approve });
      setSavedNow(approve ? 'approved' : 'draft');
      MM.toast(approve ? 'Kartläggningen är godkänd. Yrkesspåret är sparat på ärendet.' : 'Utkastet är sparat.', 'blue');
    };
    const req = (k) => !approved;
    return html`<${ui.Page} title="Kartläggning vecka 1" eyebrow=${`${nameOf(c)} · ${c.number}`}
      lead="Dokumentera deltagarens reella kompetens. Underlaget används för validering, matchning och CV."
      crumbs=${[{ label: 'Min vecka', view: 'coach.minvecka' }, { label: 'Kartläggning' }]}
      actions=${html`${approved ? html`<${ui.Badge} tone="blue" icon="check">Godkänd ${ia.approvedAt ? d.fmtDate(ia.approvedAt) : ''}<//>` : html`<${ui.Badge} tone="outline" icon="edit">${ia ? 'Utkast' : 'Ny'}<//>`}`}>
      <${ui.Card}><div class="row-between"><${CaseHead} c=${c} /><${ui.PerspectiveSwitch} role=${customerRoleFor(c)} view="kom.deltagare" params=${{ caseId: c.id }} label="Se deltagaren från kommunens håll" /></div><//>
      ${stuck && html`<${ui.Notice} tone="warn" title=${`Fastnat i fas ${stuck.phase}`}>Ärendet har varit i fas ${stuck.phase} (${sel.phaseName(stuck.phase)}) i ${stuck.days} dagar. Gränsen är ${stuck.maxDays} dagar. Slutför kartläggningen och välj yrkesspår så att deltagaren kan gå vidare.<//>`}
      ${c.backgroundInfo && html`<${ui.Notice} tone="info" title="Från beställningen">${c.backgroundInfo}${(sel.person(c) || {}).needsInterpreter ? ' Deltagaren behöver tolk.' : ''}<//>`}
      ${savedNow === 'approved' && html`<${ui.Notice} tone="ok" title="Kartläggningen är godkänd">Nästa steg: sätt veckomålet i veckoavstämningen och flytta ärendet till fas 2 när deltagaren är redo.
        <div class="row" style="margin-top:8px"><${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => go('coach.avstamning', { caseId: c.id })}>Gör veckoavstämning<//></div><//>`}

      <${ui.Card} title="Erfarenhet och utbildning" icon="briefcase">
        <div class="form-grid">
          <${ui.Field} full label="Arbetslivserfarenhet" id="ia-work" required=${req()} error=${errors.workExperience} help="Vad har deltagaren arbetat med, var och hur länge? Även oavlönat arbete och arbete i andra länder räknas.">
            <${ui.TextArea} id="ia-work" rows=${3} value=${f.workExperience} onInput=${(v) => set('workExperience', v)} maxLength=${800} /><//>
          <${ui.Field} label="Utbildning" id="ia-edu" required=${req()} error=${errors.education} help="Högsta avslutade utbildning, även från andra länder. Pågående SFI räknas.">
            <${ui.Input} id="ia-edu" value=${f.education} onInput=${(v) => set('education', v)} maxLength=${160} /><//>
          <${ui.Field} label="Språk" id="ia-lang" required=${req()} error=${errors.languageNotes} help="Modersmål och hur väl deltagaren förstår och talar svenska i arbetet.">
            <${ui.Input} id="ia-lang" value=${f.languageNotes} onInput=${(v) => set('languageNotes', v)} maxLength=${200} /><//>
          <${ui.Field} full label="Digital vana" id="ia-dig" required=${req()} error=${errors.digitalSkills} help="Välj det som stämmer bäst.">
            <${ui.Seg} id="ia-dig" ariaLabel="Digital vana" value=${f.digitalSkills} onChange=${(v) => set('digitalSkills', v)} options=${MM.uniq([...DIGITAL, ...(f.digitalSkills && !DIGITAL.includes(f.digitalSkills) ? [f.digitalSkills] : [])]).map((x) => ({ value: x, label: x }))} /><//>
          <${ui.Field} full label="Körkort" id="ia-lic" required=${req()} error=${errors.drivingLicence} help="Behörighet som är relevant för arbete.">
            <${ui.Seg} id="ia-lic" ariaLabel="Körkort" value=${f.drivingLicence} onChange=${(v) => set('drivingLicence', v)} options=${MM.uniq([...LICENCE, ...(f.drivingLicence && !LICENCE.includes(f.drivingLicence) ? [f.drivingLicence] : [])]).map((x) => ({ value: x, label: x }))} /><//>
        </div>
      <//>

      <${ui.Card} title="Mål och yrkesspår" icon="target">
        <div class="stack">
          <${ui.Field} label="Yrkesmål" id="ia-goal" required=${req()} error=${errors.workGoals} help="Med deltagarens egna ord: vilket arbete vill hen ha?">
            <${ui.Input} id="ia-goal" value=${f.workGoals} onInput=${(v) => set('workGoals', v)} maxLength=${200} /><//>
          <${ui.Field} label="Valt yrkesspår" id="ia-track" required=${req()} error=${errors.chosenTrack} help=${`Spår inom ${sel.areaName(c.primaryArea)}${c.secondaryArea ? ` och ${sel.areaName(c.secondaryArea)}` : ''}. Spåret sparas på ärendet när du godkänner.`}>
            ${allTracks ? html`<${ui.Select} id="ia-track" value=${f.chosenTrack} placeholder="Välj yrkesspår" onChange=${(v) => set('chosenTrack', v)} options=${allOptions} />`
              : html`<${ui.Seg} id="ia-track" ariaLabel="Valt yrkesspår" value=${f.chosenTrack} onChange=${(v) => set('chosenTrack', v)} options=${MM.uniq([...areaTracks, ...(f.chosenTrack && !areaTracks.includes(f.chosenTrack) ? [f.chosenTrack] : [])]).map((x) => ({ value: x, label: x }))} />`}
          <//>
          <div><${ui.Btn} kind="ghost" icon=${allTracks ? 'chevron-up' : 'chevron-down'} onClick=${() => setAllTracks(!allTracks)}>${allTracks ? 'Visa bara spår i avtalsområdet' : 'Visa spår i alla avtalsområden'}<//></div>
          <${ui.Field} label="Behov av anpassning" id="ia-adapt" error=${errors.adaptations} help="Beskriv funktionellt vad som behövs, till exempel ”behöver instruktioner i skrift”. Skriv aldrig diagnos. Lämna tomt om inget behövs.">
            <${ui.TextArea} id="ia-adapt" rows=${2} value=${f.adaptations} invalid=${diag} onInput=${(v) => set('adaptations', v)} maxLength=${300} /><//>
          ${diag && !errors.adaptations && html`<${ui.Notice} tone="warn" title="Det ser ut som en diagnos">Beskriv i stället vad deltagaren behöver i arbetet. Diagnoser dokumenteras aldrig i Miljonmatch.<//>`}
          <${ui.Field} label="Första veckomål" id="ia-first" required=${req()} error=${errors.firstWeekGoal} help="Kort och konkret. Följs upp i första veckoavstämningen.">
            <${ui.Input} id="ia-first" value=${f.firstWeekGoal} onInput=${(v) => set('firstWeekGoal', v)} maxLength=${140} /><//>
          <div class="co-chips" role="group" aria-label="Förslag på första veckomål">${(SC.GOALS[1] || []).filter((x) => x !== f.firstWeekGoal).map((gl) => html`<button type="button" key=${gl} class="co-chip" onClick=${() => set('firstWeekGoal', gl)}>${gl}</button>`)}</div>
        </div>
      <//>

      <div class="row">
        ${approved ? html`<${ui.Btn} kind="primary" icon="check" onClick=${() => save(false)}>Spara ändringar<//>`
          : html`<${ui.Btn} kind="primary" size="lg" icon="check" onClick=${() => save(true)}>Godkänn kartläggningen<//><${ui.Btn} kind="secondary" icon="file" onClick=${() => save(false)}>Spara utkast<//>`}
      </div>
      <${ui.DemoNote}>I tjänsten används kartläggningen som underlag för CV, matchning mot arbetsgivare och validering av reell kompetens. Kommunen ser den i månadsrapporten, inte som egen handling.<//>
    <//>`;
  };

  // ============================================================ HÄNDELSER OCH AVSLUT
  const VERIFICATION = ['Anställningsbevis', 'Antagningsbesked', 'Praktikavtal', 'Intyg eller diplom', 'E-post från arbetsgivare', 'Ingen verifiering ännu'];
  const fileFor = (v) => ({ 'Anställningsbevis': 'anstallningsbevis.pdf', 'Antagningsbesked': 'antagningsbesked.pdf', 'Praktikavtal': 'praktikavtal.pdf', 'Intyg eller diplom': 'intyg.pdf', 'E-post från arbetsgivare': 'e-post.pdf' }[v] || 'underlag.pdf');
  const resultPreview = (reason, verified) => {
    const r = MM.cfg().result;
    if (!reason) return null;
    if (r.countsAsResult.includes(reason)) return verified ? { tone: 'blue', icon: 'check-circle', label: 'Resultat – verifierat', text: 'Räknas som resultat i resultatgraden.' } : { tone: 'outline', icon: 'clock', label: 'Resultat – preliminärt', text: 'Räknas som resultat först när verifiering (anställningsbevis eller antagningsbesked) är registrerad.' };
    if ((r.prototypeExcluded || []).includes(reason)) return { tone: 'grey', icon: 'minus-circle', label: 'Exkluderas ur nämnaren', text: 'Räknas varken som resultat eller i nämnaren (preliminär regel).' };
    return { tone: 'outline', icon: 'x-circle', label: 'Ej resultat', text: 'Räknas i nämnaren men inte som resultat.' };
  };

  const Handelse = ({ params }) => {
    MM.useStore();
    if (!params.caseId) {
      return html`<${CasePicker} view="coach.handelse" extra=${params.mode ? { mode: params.mode } : {}} title=${params.mode === 'close' ? 'Avsluta insatsen' : 'Registrera händelse'} actionLabel="Välj"
        lead="Välj deltagare." statusOf=${(c) => html`<span class="small muted">${sel.eventsOf(c.id).length} händelser registrerade</span>`} />`;
    }
    const c = sel.caseById(params.caseId);
    const g = gate(c); if (g) return html`<${GateView} g=${g} title="Händelser" view="coach.handelse" />`;
    return html`<${EventForm} c=${c} mode0=${params.mode === 'close' ? 'close' : 'event'} />`;
  };

  const EventForm = ({ c, mode0 }) => {
    const st = MM.useStore();
    ui.useAuditView('case', c.id, 'case.view');
    const [mode, setMode] = useState(mode0);
    const employers = st.employers.filter((e) => e.areas.includes(c.primaryArea) || (c.secondaryArea && e.areas.includes(c.secondaryArea)));
    const [ev, setEv] = useState({ kind: null, occurredOn: d.today(), actor: '', verificationKind: null, file: '', note: '' });
    const [evErr, setEvErr] = useState({});
    const [cl, setCl] = useState({ endDate: d.today(), endReason: null, verified: 'no', verificationKind: null, file: '' });
    const [clErr, setClErr] = useState({});
    const [closed, setClosed] = useState(null);
    const events = sel.eventsOf(c.id);
    const setE = (k, v) => { setEv((x) => ({ ...x, [k]: v })); setEvErr((e) => { const n = { ...e }; delete n[k]; return n; }); };
    const setC = (k, v) => { setCl((x) => ({ ...x, [k]: v })); setClErr((e) => { const n = { ...e }; delete n[k]; return n; }); };
    const possibleBonus = ev.kind === 'arbete_paborjat';
    const addEvent = () => {
      const e = {};
      if (!ev.kind) e.kind = 'Välj typ av händelse.';
      if (!ev.occurredOn) e.occurredOn = 'Välj datum.';
      if (!ev.actor.trim()) e.actor = 'Skriv arbetsgivare, skola eller annan aktör.';
      setEvErr(e); if (Object.keys(e).length) { MM.toast('Händelsen kan inte sparas. Se markerade fält.', 'red'); return; }
      const verified = ev.verificationKind && ev.verificationKind !== 'Ingen verifiering ännu';
      MM.dispatch('event.add', { caseId: c.id, kind: ev.kind, occurredOn: ev.occurredOn, actor: ev.actor.trim(), verificationKind: verified ? lc(ev.verificationKind) : null, verificationFile: verified ? ev.file || null : null, note: ev.note.trim() });
      MM.toast(`Händelsen ”${sel.eventLabel(ev.kind)}” är registrerad.${possibleBonus ? ' Den är markerad som möjligt bonusunderlag.' : ''}`, 'blue');
      setEv({ kind: null, occurredOn: d.today(), actor: '', verificationKind: null, file: '', note: '' });
    };
    const needsVer = cl.endReason && MM.cfg().result.countsAsResult.includes(cl.endReason);
    const preview = resultPreview(cl.endReason, needsVer && cl.verified === 'yes');
    const closeCase = async () => {
      const e = {};
      if (!cl.endDate) e.endDate = 'Välj avslutsdatum.';
      if (!cl.endReason) e.endReason = 'Välj avslutsorsak.';
      if (needsVer && cl.verified === 'yes' && !cl.verificationKind) e.verificationKind = 'Välj typ av verifiering.';
      setClErr(e); if (Object.keys(e).length) { MM.toast('Insatsen kan inte avslutas ännu. Se markerade fält.', 'red'); return; }
      const ok = await MM.confirm({ title: 'Avsluta insatsen?', body: html`<p>Insatsen för <b>${nameOf(c)}</b> (${c.number}) avslutas ${d.fmtDate(cl.endDate)} med orsaken <b>${sel.endReasonLabel(cl.endReason).toLowerCase()}</b>. Ett utkast till slutrapport och en pulsmätning skapas automatiskt.</p>`, confirmLabel: 'Avsluta insatsen' });
      if (!ok) return;
      const verified = needsVer && cl.verified === 'yes';
      if (verified && !events.some((x) => ['arbete_paborjat', 'studier_paborjade'].includes(x.kind))) {
        MM.dispatch('event.add', { caseId: c.id, kind: cl.endReason === 'arbete' ? 'arbete_paborjat' : 'studier_paborjade', occurredOn: cl.endDate, actor: '', verificationKind: lc(cl.verificationKind), verificationFile: cl.file || fileFor(cl.verificationKind), note: 'Registrerad vid avslut' });
      }
      const res = MM.dispatch('case.close', { caseId: c.id, endDate: cl.endDate, endReason: cl.endReason, verified });
      if (!res || res.error) { MM.toast('Insatsen kunde inte avslutas.', 'red'); return; }
      setClosed(res); MM.toast('Insatsen är avslutad. Utkast till slutrapport och pulsmätning är skapade.', 'blue');
      try { window.scrollTo({ top: 0 }); } catch (err) { /* */ }
    };

    const crumbs = [{ label: 'Min vecka', view: 'coach.minvecka' }, { label: mode === 'close' ? 'Avsluta insatsen' : 'Händelser' }];
    const finalRep = closed ? st.reports.find((r) => r.id === closed.reportId) : null;
    const pulse = st.pulseInvites.filter((x) => x.caseId === c.id && x.occasion === 'exit').sort(MM.by('sentAt', -1))[0];
    const bonusCard = html`<${ui.Card} title="Bonus" icon="award" actions=${html`<${ui.BuildPhase} fas=${3} />`}>
      <div class="stack-sm">
        <div class="row-sm"><${ui.Badge} tone="grey" icon="minus-circle">${bonusOn() ? 'Aktiv' : 'Avstängd – modellen ej fastställd'}<//></div>
        <p class="small">Arbete som börjar i anslutning till insatsen markeras som möjligt bonusunderlag. Underlaget samlas in redan nu, men inget bonusanspråk skapas förrän incitamentsmodellen är beslutad.</p>
        <p class="small muted">${events.filter((x) => x.possibleBonus).length} händelser i ärendet är markerade som möjligt bonusunderlag.</p>
      </div>
    <//>`;

    return html`<${ui.Page} title=${mode === 'close' ? 'Avsluta insatsen' : 'Händelser och utfall'} eyebrow=${`${nameOf(c)} · ${c.number}`} crumbs=${crumbs}
      lead=${mode === 'close' ? 'Avslutsorsak och resultat väljer du själv. Arbete och studier räknas som resultat först när verifiering finns.' : 'Registrera det som hänt i insatsen enligt mall 02 avsnitt 5. Händelserna syns i månadsrapporten och slutrapporten.'}>
      <${ui.Card}><${CaseHead} c=${c} /><//>
      ${!closed && c.status !== 'closed' && html`<${ui.Seg} ariaLabel="Välj uppgift" value=${mode} onChange=${setMode} options=${[{ value: 'event', label: 'Registrera händelse', icon: 'plus' }, { value: 'close', label: 'Avsluta insatsen', icon: 'check-square' }]} />`}

      ${closed ? html`<div class="stack">
        <${ui.Notice} tone="ok" title="Insatsen är avslutad">${sel.endReasonLabel(c.endReason)} · ${d.fmtDate(c.endDate)}. Resultatklass: ${c.resultClass === 'result' ? (c.resultVerifiedAt ? 'resultat (verifierat)' : 'resultat (preliminärt tills verifierat)') : c.resultClass === 'excluded' ? 'exkluderas ur nämnaren' : 'ej resultat'}.<//>
        <div class="split">
          <${ui.Card} title="Utkast till slutrapport" icon="file">
            <div class="stack-sm">
              <p>Slutrapporten är skapad som utkast och byggs av godkända uppgifter.</p>
              ${finalRep && html`<div class="row-sm"><${ui.SlaBadge} dueAt=${finalRep.dueAt} /><${ui.Badge} tone="plan">Förslag 5 arbetsdagar – ej fastställt<//></div>`}
              ${finalRep && html`<div><${ui.Btn} kind="primary" icon="file" onClick=${() => go('rapport.visa', { reportId: finalRep.id })}>Öppna slutrapportutkastet<//></div>`}
            </div>
          <//>
          <${ui.Card} title="Pulsmätning vid avslut" icon="smile">
            ${pulse ? html`<div class="stack-sm">
              <p>Skickad ${d.fmtDateTime(pulse.sentAt)} via ${pulse.channel === 'email' ? 'e-post' : 'SMS'}. Länken gäller till ${d.fmtDate(pulse.expiresAt)}.</p>
              <div class="demo-note"><${I} name="message" /><div><b>Utskicket (utan personuppgifter):</b> Hej! Din tid hos Miljonbemanning är avslutad. Svara gärna på fem korta frågor: portal.miljonbemanning.se/p/••••• Det är frivilligt.</div></div>
              <div><${ui.PerspectiveSwitch} role="deltagare" view="puls.svar" label="Se pulsmätningen som deltagaren" /></div>
            </div>` : html`<p class="muted">Ingen pulsmätning skickas – deltagaren har skyddade personuppgifter.</p>`}
          <//>
        </div>
        <div class="row"><${ui.Btn} kind="secondary" icon="calendar" onClick=${() => go('coach.minvecka', {})}>Till Min vecka<//>
          <${ui.PerspectiveSwitch} role=${customerRoleFor(c)} view="kom.deltagare" params=${{ caseId: c.id }} label="Se avslutet från kommunens håll" /></div>
      </div>` : c.status === 'closed' ? html`<${ui.Notice} tone="info" title="Insatsen är avslutad">${sel.endReasonLabel(c.endReason)} · ${d.fmtDate(c.endDate)}.<//>`
        : mode === 'event' ? html`<div class="split-wide">
          <${ui.Card} title="Ny händelse" icon="plus">
            <div class="stack">
              <${ui.Field} label="Typ av händelse" id="ev-kind" required error=${evErr.kind} help="Mall 02 avsnitt 5, plus händelser för validering.">
                <${ui.Seg} id="ev-kind" ariaLabel="Typ av händelse" value=${ev.kind} onChange=${(v) => setE('kind', v)} options=${sel.EVENT_KINDS.map((k) => ({ value: k, label: sel.eventLabel(k) }))} />
              <//>
              <div class="form-grid">
                <${ui.Field} label="Datum" id="ev-date" required error=${evErr.occurredOn} help="När det hände."><${ui.Input} id="ev-date" type="date" value=${ev.occurredOn} onInput=${(v) => setE('occurredOn', v)} /><//>
                <${ui.Field} label="Aktör" id="ev-actor" required error=${evErr.actor} help="Arbetsgivare, skola eller annan aktör."><${ui.Input} id="ev-actor" value=${ev.actor} onInput=${(v) => setE('actor', v)} maxLength=${120} /><//>
              </div>
              ${employers.length > 0 && html`<div class="co-chips" role="group" aria-label="Arbetsgivare i registret">${employers.map((e) => html`<button type="button" key=${e.id} class="co-chip" onClick=${() => setE('actor', e.name)}>${e.name}</button>`)}</div>`}
              <${ui.Field} label="Verifiering" id="ev-ver" help="Vilket underlag som styrker händelsen.">
                <${ui.Seg} id="ev-ver" ariaLabel="Verifiering" value=${ev.verificationKind} onChange=${(v) => setE('verificationKind', v)} options=${VERIFICATION.map((x) => ({ value: x, label: x }))} />
              <//>
              ${ev.verificationKind && ev.verificationKind !== 'Ingen verifiering ännu' && html`<div class="row-sm">
                <${ui.Btn} kind="secondary" icon="paperclip" onClick=${() => setE('file', fileFor(ev.verificationKind))}>Bifoga fil<//>${ev.file && html`<${ui.Badge} tone="outline" icon="file">${ev.file}<//>`}
                <span class="small muted">Simulerad – ingen fil laddas upp i prototypen.</span>
              </div>`}
              <${ui.Field} label="Kommentar" id="ev-note" help="Kort och saklig. Till exempel omfattning eller startdatum."><${ui.TextArea} id="ev-note" rows=${2} value=${ev.note} onInput=${(v) => setE('note', v)} maxLength=${300} /><//>
              ${possibleBonus && html`<${ui.Notice} tone="info" icon="award" title="Möjligt bonusunderlag">Arbete som påbörjas i anslutning till insatsen markeras automatiskt. Bonus är avstängd tills incitamentsmodellen är fastställd. <${ui.BuildPhase} fas=${3} /><//>`}
              <div class="row"><${ui.Btn} kind="primary" icon="check" onClick=${addEvent}>Registrera händelsen<//></div>
            </div>
          <//>
          ${bonusCard}
        </div>` : html`<div class="split-wide">
          <${ui.Card} title="Avslut" icon="check-square">
            <div class="stack">
              <${ui.Field} label="Avslutsdatum" id="cl-date" required error=${clErr.endDate} help="Sista dagen i insatsen."><${ui.Input} id="cl-date" type="date" value=${cl.endDate} onInput=${(v) => setC('endDate', v)} /><//>
              <${ui.Field} label="Avslutsorsak" id="cl-reason" required error=${clErr.endReason} help="Tom tills du väljer.">
                <${ui.Seg} id="cl-reason" ariaLabel="Avslutsorsak" value=${cl.endReason} onChange=${(v) => setC('endReason', v)} options=${sel.END_REASONS.map((r) => ({ value: r, label: sel.endReasonLabel(r) }))} />
              <//>
              ${needsVer && html`<div class="stack">
                <${ui.Field} label="Finns verifiering?" id="cl-ver" help="Anställningsbevis eller antagningsbesked. Utan verifiering räknas resultatet som preliminärt.">
                  <${ui.Seg} id="cl-ver" ariaLabel="Finns verifiering" value=${cl.verified} onChange=${(v) => setC('verified', v)} options=${[{ value: 'yes', label: 'Ja, registrera nu' }, { value: 'no', label: 'Nej, inte ännu' }]} />
                <//>
                ${cl.verified === 'yes' && html`<${ui.Field} label="Typ av verifiering" id="cl-vkind" required error=${clErr.verificationKind} help="Välj underlag och bifoga filen.">
                  <${ui.Seg} id="cl-vkind" ariaLabel="Typ av verifiering" value=${cl.verificationKind} onChange=${(v) => { setC('verificationKind', v); setC('file', fileFor(v)); }} options=${VERIFICATION.slice(0, 5).map((x) => ({ value: x, label: x }))} />
                <//>`}
                ${cl.verified === 'yes' && cl.file && html`<div class="row-sm"><${ui.Badge} tone="outline" icon="paperclip">${cl.file}<//><span class="small muted">Simulerad fil.</span></div>`}
              </div>`}
              <div class="row"><${ui.Btn} kind="primary" icon="check-square" onClick=${closeCase}>Avsluta insatsen<//></div>
            </div>
          <//>
          <div class="stack">
            <${ui.Card} title="Förhandsvisning av resultatklass" icon="chart">
              ${preview ? html`<div class="stack-sm"><div><${ui.Badge} tone=${preview.tone} icon=${preview.icon}>${preview.label}<//></div><p>${preview.text}</p></div>` : html`<p class="muted">Välj avslutsorsak för att se hur avslutet räknas.</p>`}
              <p class="small muted" style="margin-top:10px">${MM.isUnset(MM.cfg().result.definition) ? `Resultatdefinitionen är inte fastställd i avtalet. ${MM.cfg().result.prototypeDefinition}` : MM.cfg().result.definition}</p>
            <//>
            <${ui.Card} title="Det här händer vid avslut" icon="info">
              <ul class="stack-sm" style="margin:0;padding-left:20px">
                <li>Ett utkast till slutrapport skapas (förslag: klar inom 5 arbetsdagar).</li>
                <li>En pulsmätning skickas till deltagaren via SMS eller e-post, utan personuppgifter.</li>
                <li>Kommunen ser avslutet i portalen när slutrapporten är levererad.</li>
              </ul>
            <//>
          </div>
        </div>`}

      ${mode === 'event' && !closed && html`<${ui.Card} title="Registrerade händelser" icon="list" flush>
        <${ui.Table} caption="Registrerade händelser" empty="Inga händelser registrerade ännu." rows=${events} columns=${[
          { key: 'occurredOn', label: 'Datum', nowrap: true, render: (e) => d.fmtDate(e.occurredOn) },
          { key: 'kind', label: 'Händelse', render: (e) => html`<span class="strong">${sel.eventLabel(e.kind)}</span>${e.note && html`<div class="cell-sub">${e.note}</div>`}` },
          { key: 'actor', label: 'Aktör', render: (e) => e.actor || '–' },
          { key: 'ver', label: 'Verifiering', render: (e) => (e.verificationKind ? html`<${ui.Badge} tone="blue" icon="check">${cap(e.verificationKind)}<//>` : html`<${ui.Badge} tone="outline" icon="clock">Saknas<//>`) },
          { key: 'bonus', label: 'Bonusunderlag', render: (e) => (e.possibleBonus ? html`<${ui.Badge} tone="plan" icon="award">Möjligt<//>` : '–') },
        ]} />
      <//>`}
    <//>`;
  };

  // ============================================================ Registrering
  MM.registerView('coach.minvecka', { title: 'Min vecka', roles: ['coach'], component: MinVecka });
  MM.registerView('coach.narvaro', { title: 'Närvaro', roles: ['coach', 'handledare'], component: Narvaro });
  MM.registerView('coach.avstamning', { title: 'Veckoavstämning', roles: ['coach'], component: Avstamning });
  MM.registerView('coach.manad', { title: (p) => (p && p.month ? `Månadsbedömning ${d.monthName(p.month)}` : 'Månadsbedömning'), roles: ['coach'], component: Manad });
  MM.registerView('coach.kartlaggning', { title: 'Kartläggning', roles: ['coach'], component: Kartlaggning });
  MM.registerView('coach.handelse', { title: (p) => (p && p.mode === 'close' ? 'Avsluta insatsen' : 'Registrera händelse'), roles: ['coach'], component: Handelse });
})();
