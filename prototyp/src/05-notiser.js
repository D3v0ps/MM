// 05-notiser.js – personliga notiser (tilldelning, påminnelser, eskaleringar). Varje notis har exakt en mottagare.
(() => {
  const { html, useState, d } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const KIND = {
    assignment: { label: 'Tilldelning', icon: 'user', tone: 'bluetone' },
    progress_reminder: { label: 'Påminnelse', icon: 'bell', tone: 'grey' },
    progress_escalation: { label: 'Eskalering', icon: 'flag', tone: 'red' },
    message: { label: 'Meddelande', icon: 'message', tone: 'outline' },
  };
  const MB_ROLES = ['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'ekonom', 'admin'];

  const NotisView = () => {
    MM.useStore();
    const pid = MM.currentPersonaId(); const role = MM.role();
    const [filter, setFilter] = useState('alla'); const [open, setOpen] = useState(null);
    const all = sel.notificationsFor(pid, role);
    const list = all.filter((n) => filter === 'alla' || (filter === 'olasta' && !n.readAt) || n.kind === filter);
    const unread = all.filter((n) => !n.readAt);
    const rule = sel.orgRules().progressionWatch;
    const isEscalationRole = rule.escalateTo.includes(role);
    return html`<${ui.Page} title="Notiser" eyebrow=${MM.persona() ? MM.persona().name : ''}
      lead="Dina personliga notiser. De skickas i appen och som e-post utan personuppgifter. Ingen annan ser dina notiser."
      actions=${unread.length > 0 && html`<${ui.Btn} kind="secondary" icon="check" onClick=${() => MM.dispatch('notif.read', { ids: unread.map((n) => n.id) }, { silent: true })}>Markera alla som lästa<//>`}>
      ${role === 'coach' && html`<${ui.Notice} tone="info" title="Så fungerar påminnelserna">Du får en påminnelse när ett av dina ärenden saknar progression en vecka – veckomålet inte uppnått eller ingen godkänd avstämning. Påminnelsen skickas ${rule.reminderSchedule}.<//>`}
      ${isEscalationRole && html`<${ui.Notice} tone="warn" title="Tidig uppmärksamhet">Ärenden med ${rule.escalateAfterConsecutiveWeeks} veckor i rad utan progression eskaleras till dig. <b>Coachen ser sina påminnelser men inte att ärendet har eskalerats</b> – det styrs av behörigheten.<//>`}
      <div class="row-between">
        <${ui.Seg} ariaLabel="Filter" value=${filter} onChange=${setFilter} options=${[{ value: 'alla', label: `Alla (${all.length})` }, { value: 'olasta', label: `Olästa (${unread.length})` },
          ...Object.entries(KIND).filter(([k]) => all.some((n) => n.kind === k)).map(([k, v]) => ({ value: k, label: v.label, icon: v.icon }))]} />
        ${isEscalationRole && html`<${ui.PerspectiveSwitch} role="coach" view="notiser" label="Se coachens notiser (Amira)" />`}

      </div>
      <${ui.Card} flush>
        ${list.length === 0 ? html`<${ui.Empty} icon="bell" title="Inga notiser">När du får ett ärende tilldelat eller en påminnelse visas den här.<//>` : html`<div class="list">
          ${list.map((n) => { const k = KIND[n.kind] || KIND.assignment; const c = sel.caseById(n.caseId); const isOpen = open === n.id;
            return html`<div class="list-item" key=${n.id} style=${!n.readAt ? 'box-shadow:inset 4px 0 0 var(--rod)' : ''}>
              <${I} name=${k.icon} size="lg" cls=${n.kind === 'progress_escalation' ? 'ic-red' : ''} />
              <div class="li-main">
                <div class="row-sm"><${ui.Badge} tone=${k.tone}>${k.label}<//>${!n.readAt && html`<${ui.Badge} tone="dark">Oläst<//>`}<span class="small muted">${d.fmtDateTime(n.createdAt)}</span></div>
                <div class="li-title">${n.title}</div>
                <div>${n.body}</div>
                <div class="row-sm small muted"><span>Kanaler:</span>${(n.channels || []).map((ch) => html`<${ui.Badge} tone="outline" icon=${ch === 'email' ? 'mail' : 'bell'}>${ch === 'email' ? 'E-post' : 'I appen'}<//>`)}
                  ${(n.channels || []).includes('email') && html`<button type="button" class="btn btn-ghost" style="min-height:44px;padding:2px 6px" aria-expanded=${isOpen ? 'true' : 'false'} onClick=${() => setOpen(isOpen ? null : n.id)}>Visa e-postens text</button>`}</div>
                ${isOpen && html`<div class="demo-note"><${I} name="mail" /><div><b>E-post (utan personuppgifter):</b> ${n.emailBody}</div></div>`}
              </div>
              <div class="li-side">
                ${c && html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => { MM.dispatch('notif.read', { ids: [n.id] }, { silent: true }); MM.nav(n.kind === 'progress_reminder' ? 'coach.avstamning' : 'arende.kort', n.kind === 'message' ? { caseId: c.id, tab: 'meddelanden' } : { caseId: c.id }); }}>${n.kind === 'progress_reminder' ? 'Gör avstämning' : n.kind === 'message' ? 'Läs meddelandet' : 'Öppna ärendet'}<//>`}
                ${!n.readAt && html`<${ui.Btn} kind="ghost" icon="check" onClick=${() => MM.dispatch('notif.read', { ids: [n.id] }, { silent: true })}>Läst<//>`}
              </div>
            </div>`; })}
        </div>`}
      <//>
      <${ui.DemoNote}>${isEscalationRole || role === 'admin' ? 'Påminnelser och eskaleringar räknas fram av reglerna i Admin → Avtal och konfiguration → Interna regler.' : 'Påminnelser räknas fram av reglerna i adminvyn.'} I den riktiga tjänsten skickas de av ett schemalagt jobb och lagras i en tabell där varje rad bara kan läsas av sin mottagare (radnivåsäkerhet).<//>
    <//>`;
  };
  MM.registerView('notiser', { title: 'Notiser', roles: MB_ROLES, component: NotisView });
})();
