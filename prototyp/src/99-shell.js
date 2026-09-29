// 99-shell.js – appskal: prototypfält, perspektiv/roll, navigering, layouter och uppstart.
(() => {
  const { html, useState, useEffect, d } = MM;
  const ui = MM.ui; const I = ui.Icon;
  MM.PROTOTYPE_VERSION = 'v1 · 2026-09-29';

  // ------------------------------------------------------------ Navigering per roll (vy-id:n implementeras i src/views/*)
  const NAV = {
    samordnare: [['Arbete', [['sam.start', 'Startsida', 'home'], ['sam.inkorg', 'Avropsinkorg', 'inbox', 'inbox'], ['sam.deadlines', 'Förfaller', 'clock', 'deadlines'], ['arenden.lista', 'Ärenden', 'list']]],
      ['Uppföljning', [['rapporter.lista', 'Rapporter', 'file'], ['praktik.arbetsgivare', 'Arbetsgivare och praktik', 'briefcase']]]],
    avtalsansvarig: [['Arbete', [['sam.start', 'Startsida', 'home'], ['sam.inkorg', 'Avropsinkorg', 'inbox', 'inbox'], ['sam.deadlines', 'Förfaller', 'clock', 'deadlines'], ['arenden.lista', 'Ärenden', 'list']]],
      ['Avtalet', [['rapporter.lista', 'Rapporter', 'file'], ['chef.avvikelser', 'Avtalsavvikelser', 'flag'], ['admin.anvandare', 'Kommunanvändare', 'users']]]],
    coach: [['Min vardag', [['coach.minvecka', 'Min vecka', 'calendar'], ['coach.narvaro', 'Närvaro', 'check-square', 'unregistered'], ['arenden.lista', 'Mina ärenden', 'list']]],
      ['Uppföljning', [['rapporter.lista', 'Rapporter', 'file'], ['praktik.arbetsgivare', 'Arbetsgivare och praktik', 'briefcase']]]],
    handledare: [['Min vardag', [['hand.start', 'Mina tilldelade ärenden', 'list'], ['coach.narvaro', 'Närvaro', 'check-square'], ['praktik.arbetsgivare', 'Arbetsgivare och praktik', 'briefcase']]]],
    chef: [['Ledning', [['chef.oversikt', 'Ledningsvy', 'chart'], ['chef.avvikelser', 'Avtalsavvikelser', 'flag'], ['sam.deadlines', 'Förfaller', 'clock', 'deadlines']]],
      ['Insyn', [['arenden.lista', 'Ärenden', 'list'], ['rapporter.lista', 'Rapporter', 'file'], ['admin.logg', 'Revisionslogg', 'book']]]],
    ekonom: [['Ekonomi', [['eko.start', 'Fakturering', 'card'], ['eko.korning', 'Fakturakörning januari', 'file', null, { month: '2027-01' }]]]],
    admin: [['Administration', [['admin.avtal', 'Avtal och konfiguration', 'settings'], ['admin.anvandare', 'Användare och roller', 'users'], ['admin.integrationer', 'Underbiträden och integrationer', 'database'], ['admin.mallar', 'Mallar och utskick', 'mail'], ['admin.logg', 'Revisionslogg', 'book']]]],
  };
  const KOM_NAV = {
    kommun_handlaggare: [['kom.start', 'Start'], ['kom.bestall', 'Beställ ny insats'], ['kom.deltagare', 'Mina deltagare'], ['kom.rapporter', 'Rapporter och meddelanden']],
    kommun_chef: [['kom.chef', 'Beställarrapport'], ['kom.deltagare', 'Enhetens ärenden'], ['kom.rapporter', 'Rapporter']],
  };
  MM.NAV = NAV; MM.KOM_NAV = KOM_NAV;

  const navCount = (kind) => {
    try {
      if (kind === 'inbox') return MM.sel.inbox().filter((e) => e.status !== 'linked' || true).length;
      if (kind === 'deadlines') { const xs = MM.sel.deadlines({ days: 0 }); return xs.filter((x) => x.bucket !== 'week').length; }
      if (kind === 'unregistered') { const lastMon = d.addDays(d.monday(d.today()), -7); return MM.sel.unregistered(MM.currentPersonaId(), lastMon, d.today()).length; }
    } catch (e) { return 0; }
    return 0;
  };

  // ------------------------------------------------------------ Prototypfältet
  const ProtoBar = () => {
    const route = MM.useRoute(); const f = MM.useFb(); MM.useStore();
    const persp = MM.perspectiveOf(route.role);
    const pDef = MM.PERSPECTIVES.find((p) => p.key === persp);
    const [confirmReset, setConfirmReset] = useState(false);
    const open = f.items.filter((x) => x.status === 'ny').length;
    return html`<header class="protobar" aria-label="Prototypens verktyg">
      <span class="proto-tag"><span class="dot" aria-hidden="true"></span>Prototyp</span>
      <div class="seg" role="group" aria-label="Perspektiv">
        ${MM.PERSPECTIVES.map((p) => html`<button type="button" aria-pressed=${p.key === persp ? 'true' : 'false'} style="min-height:40px" onClick=${() => { if (p.key !== persp) MM.switchPerspective(p.defaultRole); }}>
          <${I} name=${p.key === 'kund' ? 'building' : p.key === 'deltagare' ? 'smile' : 'briefcase'} />${p.key === 'leverantor' ? 'Leverantör' : p.key === 'kund' ? 'Kund' : 'Deltagare'}</button>`)}
      </div>
      ${pDef.roles.length > 1 && html`<div class="role-pick"><label for="role-select">Roll</label>
        <select id="role-select" value=${route.role} onChange=${(e) => MM.setRole(e.target.value)}>${pDef.roles.map((r) => html`<option value=${r}>${MM.roleDef(r).label}${MM.roleDef(r).personaId ? ` – ${MM.personName(MM.roleDef(r).personaId)}` : ''}</option>`)}</select></div>`}
      <span class="proto-clock"><${I} name="clock" /> Demodatum ${d.fmtWeekday(d.now())} ${d.now().slice(0, 4)} kl. ${d.fmtTime(d.now())} · ${d.fmtWeek(d.now())}</span>
      <span class="spacer"></span>
      <${ui.Btn} kind="ghost" icon="home" onClick=${() => MM.nav('om.start', {})}><span class="hide-narrow">Start och scenarier</span><//>
      <${ui.Btn} kind="secondary" icon="message-circle" onClick=${() => MM.nav('om.feedback', {})}>Genomgång${open ? ` (${open} nya)` : ''}<//>
      ${confirmReset
        ? html`<span class="row-sm"><span class="small strong">Ta bort allt du gjort?</span><${ui.Btn} kind="danger" icon="reset" onClick=${() => { setConfirmReset(false); MM.resetDemo(); }}>Ja, återställ<//><${ui.Btn} kind="ghost" onClick=${() => setConfirmReset(false)}>Avbryt<//></span>`
        : html`<${ui.Btn} kind="ghost" icon="reset" title="Återställ demodata" onClick=${() => setConfirmReset(true)}><span class="hide-narrow">Återställ</span><//>`}
    </header>`;
  };

  // ------------------------------------------------------------ Sidopanel (MB)
  const Sidebar = () => {
    const route = MM.useRoute(); MM.useStore(); const [open, setOpen] = useState(false);
    const persona = MM.persona(); const role = MM.roleDef(route.role);
    const groups = NAV[route.role] || [];
    return html`<aside class=${MM.cls('sidebar', open && 'open')} aria-label="Huvudmeny">
      <div class="brand">Miljonmatch<span class="dot" aria-hidden="true"></span></div>
      <div class="brand-sub">Miljonbemanning · Botkyrka</div>
      <button type="button" class="btn btn-ghost mobile-nav-toggle" style="color:var(--vit)" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}><${I} name="menu" />Meny</button>
      ${persona && html`<div class="persona"><${ui.Avatar} name=${persona.name} /><div><div class="who">${persona.name}</div><div class="what">${role.label}</div></div></div>`}
      <nav class="nav">
        ${(() => { const n = MM.sel.unreadNotifications(MM.currentPersonaId(), route.role); const active = route.view === 'notiser';
          return html`<button type="button" class=${MM.cls('nav-item', active && 'active')} aria-current=${active ? 'page' : undefined} onClick=${() => { setOpen(false); MM.nav('notiser', {}); }}><${I} name="bell" />Notiser${n > 0 && html`<span class="count hot">${n}<span class="sr-only"> olästa</span></span>`}</button>`; })()}
        ${groups.map(([g, items]) => html`<div class="nav-group">${g}</div>
          ${items.map(([view, label, icon, countKind, params]) => { const n = countKind ? navCount(countKind) : 0; const active = route.view === view || (view === 'arenden.lista' && route.view === 'arende.kort');
            return html`<button type="button" class=${MM.cls('nav-item', active && 'active')} aria-current=${active ? 'page' : undefined} onClick=${() => { setOpen(false); MM.nav(view, params || {}); }}>
              <${I} name=${icon} />${label}${n > 0 && html`<span class=${MM.cls('count', countKind !== 'inbox' && 'hot')}>${n}</span>`}</button>`; })}`)}
      </nav>
      <div class="sidebar-foot">Påhittade testdata. Avtal 332026110 · dnr AVN/2026:00048</div>
    </aside>`;
  };

  // ------------------------------------------------------------ Kommunportal (enkel layout, 18 px)
  const PortalHeader = () => {
    const route = MM.useRoute(); const persona = MM.persona(); const items = KOM_NAV[route.role] || [];
    if (route.view === 'kom.login') return html`<header class="portal-header"><div class="brand">Miljonbemanning<span class="dot" aria-hidden="true"></span></div><span class="who">Portal för beställare</span></header>`;
    return html`<header class="portal-header">
      <div class="brand">Miljonbemanning<span class="dot" aria-hidden="true"></span></div>
      <nav aria-label="Portalmeny" class="row-sm" style="flex:1;gap:4px">${items.map(([v, label]) => html`<button type="button" class=${MM.cls('btn', route.view === v ? 'btn-primary' : 'btn-ghost')} style="min-height:44px;font-size:1rem;text-decoration:none" aria-current=${route.view === v ? 'page' : undefined} onClick=${() => MM.nav(v, {})}>${label}</button>`)}</nav>
      <span class="who">${persona ? `${persona.name}, ${persona.unit}` : ''}</span>
      <button type="button" class="btn btn-ghost" style="font-size:1rem" onClick=${() => MM.nav('kom.login', {})}><${I} name="logout" />Logga ut</button>
    </header>`;
  };

  // ------------------------------------------------------------ Vyvärd med felgräns
  const Missing = ({ id }) => html`<div class="page"><${ui.Empty} icon="layers" title="Vyn finns inte ännu">${id}<//></div>`;
  const NoAccess = ({ view }) => {
    const roles = Array.isArray(view.roles) ? view.roles : [];
    return html`<${ui.Page} title="Ingen åtkomst" lead="Din roll har inte tillgång till den här vyn. Så fungerar behörigheten i den riktiga tjänsten också.">
      <div class="row">${roles.map((r) => html`<${ui.Btn} kind="secondary" onClick=${() => MM.setRole(r, { view: view.id, params: MM.route.params })}>Visa som ${MM.roleDef(r).label.toLowerCase()}<//>`)}</div>
    <//>`;
  };
  const ViewHost = () => {
    const route = MM.useRoute(); MM.useStore();
    const [err, reset] = MM.useErrorBoundary((e) => console.error('Vyfel', route.view, e));
    useEffect(() => { if (err) reset(); }, [route.view, JSON.stringify(route.params), route.role]);
    const view = MM.views[route.view];
    if (!view) return html`<${Missing} id=${route.view} />`;
    if (err) return html`<div class="page"><${ui.Notice} tone="critical" title="Den här vyn kunde inte visas">Det är ett fel i prototypen. Beskriv gärna vad du gjorde i feedbacken. (${String(err && err.message || err)})<//><div class="row"><${ui.Btn} onClick=${() => { reset(); MM.back(); }} icon="arrow-left">Tillbaka<//><${ui.Btn} kind="primary" icon="message-circle" onClick=${() => MM.openFeedback()}>Lämna feedback<//></div></div>`;
    if (Array.isArray(view.roles) && !view.roles.includes(route.role)) return html`<${NoAccess} view=${view} />`;
    const C = view.component;
    return html`<${C} key=${route.view + JSON.stringify(route.params)} params=${route.params || {}} role=${route.role} />`;
  };

  // ------------------------------------------------------------ Globala värdar (toast, dialog, text)
  const Toasts = () => { const list = MM.useToasts(); return html`<div class="toasts" role="status" aria-live="polite">${list.map((t) => html`<div class=${MM.cls('toast', t.tone)} key=${t.id}><${I} name=${t.tone === 'red' ? 'alert-circle' : 'check-circle'} /><span>${t.text}</span></div>`)}</div>`; };
  const DialogHost = () => {
    const dl = MM.useDialog(); const c = dl.current; if (!c) return null;
    return html`<${ui.Modal} title=${c.title || 'Bekräfta'} onClose=${() => MM.closeDialog(false)} footer=${html`<${ui.Btn} kind="ghost" onClick=${() => MM.closeDialog(false)}>${c.cancelLabel || 'Avbryt'}<//><${ui.Btn} kind=${c.tone === 'danger' ? 'danger' : 'primary'} onClick=${() => MM.closeDialog(true)}>${c.confirmLabel || 'Bekräfta'}<//>`}>${c.body}<//>`;
  };
  const TextHost = () => {
    const tm = MM.useTextModal(); const c = tm.current; if (!c) return null;
    return html`<${ui.Modal} wide title=${c.title} onClose=${MM.closeText} footer=${html`<${ui.Btn} kind="primary" icon="copy" onClick=${() => MM.copy(c.text)}>Kopiera<//><${ui.Btn} onClick=${MM.closeText}>Stäng<//>`}>
      <${ui.DemoNote}>Filen kunde inte sparas direkt här. Kopiera innehållet i stället.<//>
      <label class="sr-only" for="text-modal-area">Innehåll</label><textarea id="text-modal-area" rows="14" readOnly style="font-family:ui-monospace,Consolas,monospace;font-size:.8125rem">${c.text}</textarea><//>`;
  };

  // ------------------------------------------------------------ App
  const App = () => {
    const route = MM.useRoute(); MM.useStore();
    const persp = MM.perspectiveOf(route.role);
    const isMeta = route.view.startsWith('om.');
    let body;
    if (isMeta) body = html`<main id="main" tabIndex="-1" class="main" style="min-height:calc(100vh - 58px)"><${ViewHost} /></main>`;
    else if (persp === 'kund') body = html`<div class="portal"><${PortalHeader} /><main id="main" tabIndex="-1"><div class="portal-main"><${ViewHost} /></div></main></div>`;
    else if (persp === 'deltagare') body = html`<main id="main" tabIndex="-1" class="pulse-stage"><${ViewHost} /></main>`;
    else body = html`<div class="app"><${Sidebar} /><main id="main" tabIndex="-1" class="main"><${ViewHost} /></main></div>`;
    return html`<a href="#main" class="sr-only" onClick=${(e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); }}>Hoppa till innehållet</a>
      <div class="topbars"><${ProtoBar} /><${MM.ScenarioBar} /></div>${body}
      <button type="button" class="btn btn-primary fb-fab" onClick=${() => MM.openFeedback()}><${I} name="message-circle" />Feedback</button>
      <${MM.FeedbackDrawer} /><${DialogHost} /><${TextHost} /><${Toasts} />`;
  };

  // ------------------------------------------------------------ Uppstart
  const start = (hotData) => {
    try { MM.initState(hotData || null); }
    catch (e) { console.error('Kunde inte läsa sparat läge – startar om', e); try { localStorage.removeItem('miljonmatch-prototyp-v1'); } catch (e2) { /* */ } MM.initState(null); }
    if (!MM.views[MM.route.view]) MM.route = { role: 'samordnare', view: 'om.start', params: {} };
    const root = document.getElementById('app');
    MM.render(html`<${App} />`, root);
    MM.fb.init();
    try { if (window.claude && window.claude.hot && window.claude.hot.snapshot) window.claude.hot.snapshot(() => MM.snapshot()); } catch (e) { /* */ }
  };
  MM.boot = () => {
    const hot = window.claude && window.claude.hot;
    if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || null);
  };
})();
