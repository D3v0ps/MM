// 04-ui.js – gemensamma komponenter. Använd dessa i alla vyer så att utseende och tillgänglighet blir enhetliga.
(() => {
  const { html, useState, useEffect, useRef, d, fmt } = MM;
  const ui = (MM.ui = {});
  const cls = MM.cls;

  ui.Icon = ({ name, size, cls: c = '', label }) => {
    const klass = cls('ic', size === 'lg' && 'ic-lg', size === 'xl' && 'ic-xl', c);
    return html`<span style="display:inline-flex" role=${label ? 'img' : undefined} aria-label=${label || undefined} dangerouslySetInnerHTML=${{ __html: MM.iconSvg(name, klass) }}></span>`;
  };
  const I = ui.Icon;

  /** Sidhuvud med versal rubrik och röd punkt. */
  ui.Page = ({ title, eyebrow, lead, actions, crumbs, children }) => html`
    <div class="page">
      <div class="page-head">
        <div class="titles">
          ${crumbs && html`<nav class="crumbs" aria-label="Brödsmulor">${crumbs.map((c, i) => html`${i > 0 && html`<span aria-hidden="true">/</span>`}${c.view ? html`<button type="button" onClick=${() => MM.nav(c.view, c.params || {})}>${c.label}</button>` : html`<span>${c.label}</span>`}`)}</nav>`}
          ${eyebrow && html`<div class="eyebrow">${eyebrow}</div>`}
          <h1 class="page-title"><span class="dot" aria-hidden="true"></span>${title}</h1>
          ${lead && html`<p class="page-lead">${lead}</p>`}
        </div>
        ${actions && html`<div class="row">${actions}</div>`}
      </div>
      ${children}
    </div>`;

  ui.Card = ({ title, icon, actions, tone, children, foot, flush, id }) => html`
    <section class=${cls('card', tone && `tone-${tone}`)} id=${id}>
      ${(title || actions) && html`<div class="card-head">${title && html`<h2 class="card-title">${icon && html`<${I} name=${icon} />`}${title}</h2>`}<span class="spacer"></span>${actions}</div>`}
      <div class=${cls('card-body', flush && 'flush')}>${children}</div>
      ${foot && html`<div class="card-foot">${foot}</div>`}
    </section>`;

  ui.Section = ({ title, actions, children }) => html`<section class="section"><div class="row-between"><h2 class="section-title"><span class="dot" aria-hidden="true"></span>${title}</h2>${actions}</div>${children}</section>`;

  /** kind: primary | secondary | ghost | danger | red (stor fet text) | blue */
  ui.Btn = ({ kind = 'secondary', icon, iconRight, onClick, disabled, children, type = 'button', title, size, block, ariaLabel, id, ariaPressed }) => html`
    <button id=${id} type=${type} class=${cls('btn', `btn-${kind}`, size === 'lg' && 'btn-lg', block && 'btn-block', !children && 'btn-icon')} onClick=${onClick} disabled=${disabled} title=${title} aria-label=${ariaLabel || (!children ? title : undefined)} aria-pressed=${ariaPressed}>
      ${icon && html`<${I} name=${icon} />`}${children}${iconRight && html`<${I} name=${iconRight} />`}
    </button>`;

  /** tone: blue | bluetone | grey | red | redfill | dark | outline | plan */
  ui.Badge = ({ tone = 'grey', icon, children, title }) => html`<span class=${cls('badge', `badge-${tone}`)} title=${title}>${icon && html`<${I} name=${icon} />`}${children}</span>`;

  /** Samlad status – alltid text + ikon. Grön → blå, Gul → ljusgrå, Röd → röd. */
  ui.STATUS_TEXT = { green: 'Grön – enligt plan', yellow: 'Gul – risk eller extra åtgärd', red: 'Röd – kräver omplanering eller dialog' };
  ui.STATUS_SHORT = { green: 'Grön', yellow: 'Gul', red: 'Röd' };
  ui.STATUS_ICON = { green: 'check-circle', yellow: 'alert-circle', red: 'alert' };
  ui.Status = ({ value, short }) => value
    ? html`<span class=${cls('status', `status-${value}`)}><${I} name=${ui.STATUS_ICON[value]} />${short ? ui.STATUS_SHORT[value] : ui.STATUS_TEXT[value]}</span>`
    : html`<span class="status status-none"><${I} name="minus-circle" />Ej bedömd</span>`;

  ui.CaseStatus = ({ status }) => {
    const map = { received: ['grey', 'inbox'], acknowledged: ['outline', 'mail'], confirmed: ['bluetone', 'check'], active: ['blue', 'activity'], paused: ['grey', 'pause'], closed: ['dark', 'check-square'], declined: ['red', 'x-circle'] };
    const [tone, icon] = map[status] || ['grey', 'circle'];
    return html`<${ui.Badge} tone=${tone} icon=${icon}>${MM.sel.statusLabel(status)}<//>`;
  };

  /** columns: [{ key, label, render(row), num, width, nowrap }]; rows: array. */
  ui.Table = ({ columns, rows, onRowClick, rowKey = 'id', empty = 'Inget att visa.', rowClass, footer, caption }) => html`
    <div class="table-wrap">
      <table class="table">
        ${caption && html`<caption class="sr-only">${caption}</caption>`}
        <thead><tr>${columns.map((c) => html`<th class=${c.num ? 'num' : ''} style=${c.width ? `width:${c.width}` : ''} scope="col">${c.label}</th>`)}</tr></thead>
        <tbody>
          ${rows.length === 0 && html`<tr><td colspan=${columns.length} class="muted">${empty}</td></tr>`}
          ${rows.map((r) => html`<tr key=${r[rowKey]} class=${cls(onRowClick && 'clickable', rowClass && rowClass(r))} onClick=${onRowClick ? () => onRowClick(r) : undefined}
              tabIndex=${onRowClick ? 0 : undefined} onKeyDown=${onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r); } } : undefined}>
            ${columns.map((c) => html`<td class=${cls(c.num && 'num', c.nowrap && 'nowrap')}>${c.render ? c.render(r) : r[c.key]}</td>`)}
          </tr>`)}
        </tbody>
        ${footer && html`<tfoot>${footer}</tfoot>`}
      </table>
    </div>`;

  /** Fält med etikett, hjälptext och felmeddelande. Barnet ska vara kontrollen (med samma id). */
  ui.Field = ({ label, help, error, required, id, children, full }) => html`
    <div class=${cls('field', error && 'invalid', full && 'full')}>
      ${label && html`<label for=${id}>${label}${required && html`<span class="req"><span class="sr-only">(obligatoriskt)</span></span>`}</label>`}
      ${help && html`<div class="help" id=${id ? `${id}-help` : undefined}>${help}</div>`}
      ${children}
      ${error && html`<div class="error-text" role="alert"><${I} name="alert-circle" />${error}</div>`}
    </div>`;
  ui.Input = ({ id, value, onInput, type = 'text', placeholder, invalid, disabled, inputMode, maxLength, autoComplete = 'off' }) => html`
    <input id=${id} type=${type} value=${value ?? ''} onInput=${(e) => onInput && onInput(e.target.value)} placeholder=${placeholder} class=${invalid ? 'invalid' : ''} disabled=${disabled}
      inputMode=${inputMode} maxLength=${maxLength} autoComplete=${autoComplete} aria-invalid=${invalid ? 'true' : undefined} aria-describedby=${id ? `${id}-help` : undefined} />`;
  ui.Select = ({ id, value, onChange, options, placeholder, invalid, disabled }) => html`
    <select id=${id} value=${value ?? ''} onChange=${(e) => onChange && onChange(e.target.value)} class=${invalid ? 'invalid' : ''} disabled=${disabled} aria-invalid=${invalid ? 'true' : undefined}>
      ${placeholder !== undefined && html`<option value="">${placeholder}</option>`}
      ${options.map((o) => (typeof o === 'string' ? html`<option value=${o}>${o}</option>` : html`<option value=${o.value} disabled=${o.disabled}>${o.label}</option>`))}
    </select>`;
  ui.TextArea = ({ id, value, onInput, placeholder, rows = 3, invalid, maxLength }) => html`<textarea id=${id} rows=${rows} value=${value ?? ''} onInput=${(e) => onInput && onInput(e.target.value)} placeholder=${placeholder} class=${invalid ? 'invalid' : ''} maxLength=${maxLength} aria-invalid=${invalid ? 'true' : undefined}></textarea>`;
  ui.Check = ({ id, checked, onChange, children, disabled }) => html`<label class="check" for=${id}><input type="checkbox" id=${id} checked=${!!checked} disabled=${disabled} onChange=${(e) => onChange && onChange(e.target.checked)} /><span>${children}</span></label>`;
  /** Knappgrupp för snabba val (ett klick). options: [{ value, label, icon, tone: green|yellow|red }]. multi = flerval (value är array). */
  ui.Seg = ({ value, onChange, options, multi, ariaLabel, id }) => html`
    <div class="seg" role="group" aria-label=${ariaLabel} id=${id}>
      ${options.map((o) => { const v = typeof o === 'string' ? o : o.value; const lab = typeof o === 'string' ? o : o.label; const on = multi ? (value || []).includes(v) : value === v;
        return html`<button type="button" aria-pressed=${on ? 'true' : 'false'} class=${o.tone ? `tone-${o.tone}` : ''} onClick=${() => onChange(multi ? (on ? value.filter((x) => x !== v) : [...(value || []), v]) : v)}>${o.icon && html`<${I} name=${o.icon} />`}${lab}</button>`; })}
    </div>`;

  ui.Tabs = ({ tabs, active, onChange, ariaLabel = 'Flikar' }) => {
    const onKey = (e) => {
      const i = tabs.findIndex((t) => t.id === active); let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length; if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0; if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return; e.preventDefault(); onChange(tabs[j].id);
      setTimeout(() => { const b = e.currentTarget && e.currentTarget.querySelectorAll('[role=tab]')[j]; if (b) b.focus(); }, 0);
    };
    return html`
    <div class="tabs" role="tablist" aria-label=${ariaLabel} onKeyDown=${onKey}>
      ${tabs.map((t) => html`<button type="button" role="tab" class="tab" tabIndex=${active === t.id ? 0 : -1} aria-selected=${active === t.id ? 'true' : 'false'} onClick=${() => onChange(t.id)}>${t.icon && html`<${I} name=${t.icon} />`}${t.label}${t.count != null && t.count !== 0 && html`<span class="count">${t.count}</span>`}</button>`)}
    </div>`;
  };

  ui.Modal = ({ title, onClose, children, footer, wide }) => {
    const ref = useRef(null);
    useEffect(() => {
      const prev = document.activeElement; const el = ref.current; if (el) { const f = el.querySelector('input, select, textarea, button:not(.modal-x)'); (f || el).focus(); }
      const onKey = (e) => {
        if (e.key === 'Escape') { onClose && onClose(); return; }
        if (e.key === 'Tab' && el) { // håll fokus inne i dialogen
          const f = [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
          if (!f.length) return; const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', onKey); return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
    }, []);
    return html`<div class="modal-backdrop" onClick=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div class=${cls('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label=${title} ref=${ref} tabIndex="-1">
        <div class="modal-head"><h2 class="modal-title">${title}</h2>${onClose && html`<button type="button" class="btn btn-ghost btn-icon modal-x" aria-label="Stäng" title="Stäng" onClick=${onClose}><${I} name="x" /></button>`}</div>
        <div class="modal-body">${children}</div>
        ${footer && html`<div class="modal-foot">${footer}</div>`}
      </div></div>`;
  };

  /** tone: info | warn | critical | ok */
  ui.Notice = ({ tone = 'info', title, children, icon }) => html`
    <div class=${cls('notice', `notice-${tone}`)} role=${tone === 'critical' ? 'alert' : undefined}>
      <${I} name=${icon || ({ info: 'info', warn: 'alert-circle', critical: 'alert', ok: 'check-circle' })[tone]} />
      <div class="stack-sm" style="gap:4px;min-width:0">${title && html`<div class="notice-title">${title}</div>`}<div>${children}</div></div>
    </div>`;
  /** Förklaring som bara gäller prototypen (streckad ram). */
  ui.DemoNote = ({ children }) => html`<div class="demo-note"><${I} name="info" /><div><b>Prototyp:</b> ${children}</div></div>`;
  ui.Empty = ({ icon = 'inbox', title, children, action }) => html`<div class="empty"><${I} name=${icon} /><div class="empty-title">${title}</div>${children && html`<div>${children}</div>`}${action}</div>`;

  /** tone 'alert' = under mål (kräver åtgärd), 'watch' = bevaka. Status visas alltid med text och ikon, aldrig bara med ramfärg. */
  ui.Kpi = ({ label, value, sub, tone, statusText, children }) => html`<div class=${cls('kpi', tone)}><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>
    ${tone && (tone === 'alert' || tone === 'watch') && html`<div class="kpi-state"><${I} name=${tone === 'alert' ? 'alert' : 'eye'} />${statusText || (tone === 'alert' ? 'Kräver åtgärd' : 'Bevaka')}</div>`}
    ${sub && html`<div class="kpi-sub">${sub}</div>`}${children}</div>`;
  /** Mätare 0–max med målmarkeringar. markers: [{ value, label, tone: 'red'|'dark' }] */
  ui.Meter = ({ value, max = 1, markers = [], tone, label }) => html`
    <div class="stack-sm" style="gap:6px">
      <div class="meter" role="img" aria-label=${label || `${Math.round((value / max) * 100)} procent`}>
        <div class=${cls('fill', tone)} style=${`width:${Math.max(0, Math.min(100, (value / max) * 100))}%`}></div>
        ${markers.map((m) => html`<div class=${cls('mark', m.tone === 'red' && 'red')} style=${`left:calc(${(m.value / max) * 100}% - 1px)`} title=${m.label}></div>`)}
      </div>
      ${markers.length > 0 && html`<div class="meter-legend">${markers.map((m) => html`<span><span aria-hidden="true" style=${`display:inline-block;width:10px;height:3px;vertical-align:middle;margin-right:4px;background:${m.tone === 'red' ? 'var(--rod)' : 'var(--antracit)'}`}></span>${m.label}</span>`)}</div>`}
    </div>`;

  ui.SlaBadge = ({ dueAt, metAt, prefix }) => {
    const s = MM.sel.slaStatus(dueAt, metAt);
    const icon = s.tone === 'met' ? 'check' : s.tone === 'over' ? 'alert' : 'clock';
    return html`<span class=${cls('sla', `sla-${s.tone}`)} title=${`Förfaller ${d.fmtDateTimeLong(dueAt)}`}><${I} name=${icon} />${prefix ? `${prefix} ` : ''}${s.label}</span>`;
  };

  ui.Kv = ({ items }) => html`<dl class="kv">${items.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v ?? '–'}</dd>`)}</dl>`;
  ui.Avatar = ({ name, size }) => html`<span class=${cls('avatar', size)} aria-hidden="true">${MM.initials(name)}</span>`;
  ui.UserName = ({ id, withAvatar = true }) => { const n = MM.personName(id); return html`<span class="row-sm" style="flex-wrap:nowrap">${withAvatar && html`<${ui.Avatar} name=${n} size="sm" />`}<span>${n}</span></span>`; };

  /** Maskerat personnummer. "Visa" loggas i revisionsloggen. Skyddade/ekonom/utan behörighet: aldrig. */
  ui.MaskedPnr = ({ caseId }) => {
    const [show, setShow] = useState(false);
    const c = MM.sel.caseById(caseId); const p = MM.sel.person(c); const a = MM.sel.access(c);
    if (!p || !['full', 'team', 'customer'].includes(a)) return html`<span class="muted">Visas inte för din roll</span>`;
    if (!p.pnr) return html`<span class="muted">–</span>`;
    const masked = `${p.pnr.slice(0, p.pnr.length - 4).replace(/\d/g, '•')}${p.pnrLast4}`;
    return html`<span class="row-sm"><span class="mono">${show ? p.pnr : masked}</span>
      ${!show ? html`<button type="button" class="btn btn-ghost" style="min-height:44px;padding:4px 8px" onClick=${() => { setShow(true); MM.dispatch('audit.view', { action: 'pnr.revealed', entity: 'person', entityId: p.id, details: { caseId } }, { silent: true }); }}><${I} name="eye" />Visa</button>`
        : html`<span class="small muted">(visning loggad)</span>`}</span>`;
  };

  ui.PhaseBar = ({ phase }) => html`<div class="phasebar" role="img" aria-label=${`Fas ${phase} av 5`}>${[1, 2, 3, 4, 5].map((n) => html`<div class=${cls('ph', n < phase && 'done', n === phase && 'now')}></div>`)}</div>`;
  ui.PhaseTag = ({ phase }) => html`<${ui.Badge} tone="outline">Fas ${phase} · ${MM.sel.phaseName(phase)}<//>`;
  /** Markerar funktion som byggs i en senare utvecklingsfas enligt SPEC §12. */
  ui.BuildPhase = ({ fas }) => html`<${ui.Badge} tone="plan" icon="layers" title=${`Byggs i utvecklingsfas ${fas} enligt SPEC §12`}>Byggs i fas ${fas}<//>`;
  ui.AiTag = ({ children = 'AI-förslag' }) => html`<span class="ai-tag"><${I} name="sparkles" />${children}</span>`;
  ui.Evidence = ({ quote, t }) => html`<div class="evidence"><q>${quote}</q>${t != null && html`<span class="t">Tidpunkt ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</span>`}</div>`;
  ui.Timeline = ({ items }) => html`<div class="timeline">${items.map((it) => html`<div class="tl-item"><span class=${cls('tl-dot', it.filled && 'filled', it.tone === 'red' && 'red')}>${it.icon && html`<${I} name=${it.icon} />`}</span><div class="stack-sm" style="gap:2px;min-width:0"><div class="strong">${it.title}</div>${it.sub && html`<div class="small muted">${it.sub}</div>`}${it.body}</div></div>`)}</div>`;
  ui.Stepper = ({ steps, current }) => html`<ol class="stepper">${steps.map((s, i) => html`<li class=${cls(i < current && 'done', i === current && 'current')} aria-current=${i === current ? 'step' : undefined}><span class="n">${i < current ? html`<${I} name="check" />` : i + 1}</span>${s}</li>`)}</ol>`;

  /** PDF-lik rapportvy i MB:s profil: logotyp överst, avtals- och ärendeinformation i högerställt block. */
  ui.Paper = ({ title, info = [], draft, children }) => html`
    <div class="paper-wrap"><article class="paper">
      <div class="paper-head">
        <div class="paper-logo"><div class="brand">Miljonbemanning<span class="dot" aria-hidden="true"></span></div><div class="small muted">Miljonmatch</div></div>
        <div class="paper-info">${info.map(([k, v]) => html`<div><b>${k}:</b> ${v}</div>`)}</div>
      </div>
      ${draft && html`<div class="watermark-draft">${draft}</div>`}
      <h1>${title}</h1>
      ${children}
    </article></div>`;

  /** Prototyplänk som byter perspektiv (leverantör ↔ kund) och visar samma sak från andra sidan. */
  ui.PerspectiveSwitch = ({ role, view, params, label }) => {
    const toCustomer = MM.perspectiveOf(role) === 'kund';
    return html`<button type="button" class="btn btn-secondary" style="border-style:dashed" onClick=${() => MM.switchPerspective(role, view, params)} title="Prototypfunktion – finns inte i den riktiga tjänsten">
      <${I} name="refresh" />${label || (toCustomer ? 'Se samma sak från kundens håll' : 'Se samma sak från leverantörens håll')}</button>`;
  };

  /** Ärendenummer som länk till rätt vy för rollen. */
  ui.CaseLink = ({ caseId, children }) => {
    const c = MM.sel.caseById(caseId); if (!c) return html`<span>–</span>`;
    const persp = MM.perspective();
    const view = persp === 'kund' ? 'kom.deltagare' : MM.role() === 'ekonom' ? 'eko.arende' : 'arende.kort';
    const canOpen = MM.sel.access(c) !== 'none' && MM.views[view];
    return canOpen ? html`<button type="button" class="btn btn-ghost" style="min-height:44px;padding:2px 6px;font-weight:700" onClick=${(e) => { e.stopPropagation(); MM.nav(view, { caseId }); }}>${children || c.number}</button>` : html`<span class="strong mono">${children || c.number}</span>`;
  };

  /** Loggar visning en gång per sidladdning (deltagarkort, rapport, transkript). */
  const seen = new Set();
  ui.useAuditView = (entity, entityId, action = `${entity}.view`) => {
    useEffect(() => {
      if (!entityId) return; const k = `${MM.currentPersonaId()}:${action}:${entityId}`; if (seen.has(k)) return; seen.add(k);
      MM.dispatch('audit.view', { action, entity, entityId }, { silent: true });
    }, [entityId, MM.currentPersonaId()]);
  };

  /** Liten stapel-/linjediagramhjälpare är inte gemensam – rita SVG i vyn och använd klassen .chart. */
})();
