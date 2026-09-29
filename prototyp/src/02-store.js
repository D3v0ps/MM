// 02-store.js – tillstånd, åtgärder (actions), revisionslogg, router, roller, notiser.
// Tillståndet = deterministisk seed + upprepning av de åtgärder testaren gjort (sparas i webbläsaren).
(() => {
  const { d } = MM;
  const LS_KEY = 'miljonmatch-prototyp-v1';
  const store = { state: null, version: 0, mut: 0, log: [], listeners: new Set(), replaying: false };
  MM.store = store;

  // ------------------------------------------------------------ Roller och personor
  MM.ROLES = [
    { key: 'samordnare', label: 'Samordnare', org: 'mb', personaId: 'u-sara', home: 'sam.start', desc: 'Avropsinkorg med SLA-klocka, tilldelar coach, bokar start.' },
    { key: 'avtalsansvarig', label: 'Avtalsansvarig', org: 'mb', personaId: 'u-johan', home: 'sam.start', desc: 'Accepterar och avböjer avrop, avtalsavvikelser, godkänner beställarrapport.' },
    { key: 'coach', label: 'Huvudcoach', org: 'mb', personaId: 'u-amira', home: 'coach.minvecka', desc: 'Min vecka: närvaro, avstämningar, månadsbedömningar och rapporter.' },
    { key: 'handledare', label: 'Handledare', org: 'mb', personaId: 'u-petra', home: 'hand.start', desc: 'Ser bara tilldelade ärenden: moment, praktik och närvaro.' },
    { key: 'chef', label: 'Chef och controller', org: 'mb', personaId: 'u-karin', home: 'chef.oversikt', desc: 'KPI:er mot mål, flaggor, prognos, avvikelser och revisionslogg.' },
    { key: 'ekonom', label: 'Ekonom', org: 'mb', personaId: 'u-lars', home: 'eko.start', desc: 'Fakturaunderlag per ärende och månad – inga anteckningar eller rapporter.' },
    { key: 'admin', label: 'Systemadmin', org: 'mb', personaId: 'u-robin', home: 'admin.avtal', desc: 'Avtalskonfiguration, användare, underbiträden och logg.' },
    { key: 'kommun_handlaggare', label: 'Kommunens handläggare', org: 'customer', personaId: 'k-maria', home: 'kom.start', desc: 'Beställer, läser rapporter och skickar meddelanden.' },
    { key: 'kommun_chef', label: 'Kommunens chef', org: 'customer', personaId: 'k-eva', home: 'kom.chef', desc: 'Beställarrapport och enhetens ärenden.' },
    { key: 'deltagare', label: 'Deltagare (pulslänk)', org: 'participant', personaId: null, home: 'puls.svar', desc: 'Svarar på pulsmätningen via engångslänk – ingen inloggning.' },
  ];
  MM.roleDef = (key) => MM.ROLES.find((r) => r.key === key) || MM.ROLES[0];
  /** Perspektiv: leverantören (Miljonbemanning) eller kunden (Botkyrka kommun). Deltagaren räknas till kundens sida av tjänsten men visas separat. */
  MM.PERSPECTIVES = [
    { key: 'leverantor', label: 'Leverantör', long: 'Leverantörens perspektiv – Miljonbemanning', roles: ['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'ekonom', 'admin'], defaultRole: 'samordnare' },
    { key: 'kund', label: 'Kund', long: 'Kundens perspektiv – Botkyrka kommun', roles: ['kommun_handlaggare', 'kommun_chef'], defaultRole: 'kommun_handlaggare' },
    { key: 'deltagare', label: 'Deltagare', long: 'Deltagarens perspektiv', roles: ['deltagare'], defaultRole: 'deltagare' },
  ];
  MM.perspectiveOf = (role) => (MM.PERSPECTIVES.find((p) => p.roles.includes(role)) || MM.PERSPECTIVES[0]).key;
  MM.perspective = () => MM.perspectiveOf(MM.route.role);

  // ------------------------------------------------------------ Actions
  /** Registrera en åtgärd. fn(state, payload, ctx) muterar state och får returnera ett värde.
   *  ctx = { now, actor, actorId, role, audit(action, entity, entityId, details), id(prefix), toast(text, tone), notify(channel, to, template, body, caseId), replay } */
  MM.defineAction = (type, fn) => { MM.actions[type] = fn; };

  const makeCtx = (st, meta) => {
    const role = meta.role; const actorId = meta.actorId;
    return {
      now: MM.clock(), role, actorId, actor: MM.personById(actorId), replay: store.replaying,
      id: (prefix) => `${prefix}-${++st.seq}`,
      audit: (action, entity, entityId, details = {}) => st.auditLog.push({ id: `log-${++st.seq}`, occurredAt: MM.clock(), actorId, action, entity, entityId, contractId: 'c-bot', details, byTester: true }),
      toast: (text, tone) => { if (!store.replaying) MM.toast(text, tone); },
      notify: (channel, to, template, body, caseId = null) => st.notifications.push({ id: `ntf-${++st.seq}`, at: MM.clock(), channel, to, template, body, caseId, byTester: true }),
    };
  };

  /** Kör en åtgärd. Returnerar åtgärdens returvärde (t.ex. nytt id). */
  MM.dispatch = (type, payload = {}, opts = {}) => {
    const fn = MM.actions[type];
    if (!fn) { console.warn('Okänd åtgärd', type); return undefined; }
    const meta = { role: MM.route.role, actorId: MM.currentPersonaId(), silent: !!opts.silent };
    const entry = { type, payload, meta };
    let result;
    try {
      if (!meta.silent) store.state.clockOffset = (store.state.clockOffset || 0) + 1;
      store.mut++;
      result = fn(store.state, payload, makeCtx(store.state, meta));
      store.mut++;
    } catch (e) {
      console.error('Åtgärden misslyckades', type, e);
      MM.toast('Något gick fel i prototypen. Åtgärden sparades inte.', 'red');
      return undefined;
    }
    store.log.push(entry);
    persist();
    bump();
    return result;
  };

  const replay = (log) => {
    store.replaying = true;
    for (const entry of log) {
      const fn = MM.actions[entry.type];
      if (!fn) continue;
      try {
        if (!entry.meta.silent) store.state.clockOffset = (store.state.clockOffset || 0) + 1;
        store.mut++;
        fn(store.state, entry.payload, makeCtx(store.state, entry.meta));
        store.mut++;
        store.log.push(entry);
      } catch (e) { console.warn('Kunde inte spela upp', entry.type, e); }
    }
    store.replaying = false;
  };

  // ------------------------------------------------------------ Klocka
  MM.clock = () => {
    const base = '2027-02-01T09:12';
    const off = (store.state && store.state.clockOffset) || 0;
    return d.addMinutes(base, off);
  };

  // ------------------------------------------------------------ Prenumeration
  const bump = () => { store.version++; store.listeners.forEach((fn) => fn(store.version)); };
  MM.bump = bump;
  MM.useStore = () => {
    const [, set] = MM.useState(0);
    MM.useEffect(() => { const fn = (v) => set(v); store.listeners.add(fn); return () => store.listeners.delete(fn); }, []);
    return store.state;
  };

  // ------------------------------------------------------------ Persistens
  let persistTimer = null;
  const persist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ log: store.log, route: MM.route, visited: MM.visited })); } catch (e) { /* privat läge */ }
    }, 150);
  };
  MM.persist = persist;
  const loadSaved = () => { try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };

  MM.snapshot = () => ({ log: store.log, route: MM.route, visited: MM.visited });

  /** Startar tillståndet. hot = data från förhandsvisningens uppdatering (om någon). */
  MM.initState = (hot) => {
    store.state = MM.seed();
    store.state.clockOffset = 0;
    store.mut++;
    store.log = [];
    const saved = (hot && hot.log) ? hot : loadSaved();
    if (saved && Array.isArray(saved.log)) replay(saved.log);
    if (saved && saved.route && MM.views[saved.route.view]) MM.route = saved.route;
    if (saved && saved.visited) MM.visited = saved.visited;
  };

  MM.resetDemo = () => {
    store.state = MM.seed(); store.state.clockOffset = 0; store.mut++; store.log = []; MM.visited = {};
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* */ }
    MM.setRole('samordnare', { view: 'om.start' });
    bump();
    MM.toast('Demodata återställd. Allt du gjort i prototypen är borttaget.', 'blue');
  };

  // ------------------------------------------------------------ Router
  MM.route = { role: 'samordnare', view: 'om.start', params: {} };
  MM.history = [];
  MM.visited = {};
  const routeListeners = new Set();
  MM.useRoute = () => { const [, set] = MM.useState(0); MM.useEffect(() => { const fn = () => set((x) => x + 1); routeListeners.add(fn); return () => routeListeners.delete(fn); }, []); return MM.route; };

  /** Navigera till en vy. params = t.ex. { caseId, tab }. */
  MM.nav = (view, params = {}, opts = {}) => {
    if (!MM.views[view]) { console.warn('Okänd vy', view); MM.toast('Den här vyn finns inte i prototypen ännu.', 'red'); return; }
    if (!opts.replace) MM.history.push({ ...MM.route });
    if (MM.history.length > 50) MM.history.shift();
    MM.route = { role: opts.role || MM.route.role, view, params };
    MM.visited[view] = true;
    persist();
    routeListeners.forEach((fn) => fn());
    bump();
    try { const main = document.getElementById('main'); if (main) { main.focus({ preventScroll: true }); } window.scrollTo({ top: 0 }); } catch (e) { /* */ }
  };
  MM.back = () => { const prev = MM.history.pop(); if (prev) { MM.route = prev; routeListeners.forEach((fn) => fn()); bump(); persist(); } };
  MM.setRole = (role, opts = {}) => {
    const def = MM.roleDef(role);
    MM.nav(opts.view || def.home, opts.params || {}, { role });
  };
  MM.role = () => MM.route.role;
  /** Byt perspektiv och öppna motsvarande vy (används av "Se samma sak från kundens håll"). */
  MM.switchPerspective = (role, view, params = {}) => {
    MM.nav(view || MM.roleDef(role).home, params, { role });
    MM.toast(`Du ser nu prototypen som ${MM.roleDef(role).label.toLowerCase()} (${MM.perspectiveOf(role) === 'kund' ? 'kundens perspektiv' : MM.perspectiveOf(role) === 'deltagare' ? 'deltagarens perspektiv' : 'leverantörens perspektiv'}).`, 'blue');
  };
  MM.currentPersonaId = () => MM.roleDef(MM.route.role).personaId;
  /** Aktuell persona (MB-användare eller kommunanvändare). Deltagare = null. */
  MM.persona = () => MM.personById(MM.currentPersonaId());
  MM.personById = (id) => {
    if (!id || !store.state) return null;
    if (id === 'system') return { id: 'system', name: 'Miljonmatch (automatiskt)', title: 'System', org: 'system' };
    return store.state.users.find((u) => u.id === id) || store.state.customerUsers.find((u) => u.id === id) || null;
  };
  MM.personName = (id) => { const p = MM.personById(id); return p ? p.name : '–'; };

  /** Registrera en vy. def = { title, roles: [...], component, crumb? } */
  MM.registerView = (id, def) => { MM.views[id] = { id, ...def }; };

  // ------------------------------------------------------------ Konfiguration
  MM.contract = (id = 'c-bot') => store.state.contracts.find((c) => c.id === id);
  MM.cfg = (id = 'c-bot') => MM.contract(id).config;
  MM.isUnset = (v) => typeof v === 'string' && v.startsWith('ATT_FASTSTÄLLA');

  // ------------------------------------------------------------ Toasts
  const toasts = { list: [], listeners: new Set(), n: 0 };
  MM.toast = (text, tone = 'blue') => {
    const id = ++toasts.n; toasts.list = [...toasts.list, { id, text, tone }]; toasts.listeners.forEach((f) => f());
    setTimeout(() => { toasts.list = toasts.list.filter((t) => t.id !== id); toasts.listeners.forEach((f) => f()); }, 5200);
  };
  MM.useToasts = () => { const [, set] = MM.useState(0); MM.useEffect(() => { const f = () => set((x) => x + 1); toasts.listeners.add(f); return () => toasts.listeners.delete(f); }, []); return toasts.list; };

  // ------------------------------------------------------------ Dialoger (confirm i sidan – window.confirm fungerar inte)
  const dialogs = { current: null, listeners: new Set() };
  /** MM.confirm({ title, body, confirmLabel, tone }) -> Promise<boolean> */
  MM.confirm = (opts) => new Promise((resolve) => { dialogs.current = { ...opts, resolve }; dialogs.listeners.forEach((f) => f()); });
  MM.useDialog = () => { const [, set] = MM.useState(0); MM.useEffect(() => { const f = () => set((x) => x + 1); dialogs.listeners.add(f); return () => dialogs.listeners.delete(f); }, []); return dialogs; };
  MM.closeDialog = (val) => { const cur = dialogs.current; dialogs.current = null; dialogs.listeners.forEach((f) => f()); if (cur) cur.resolve(val); };

  // ------------------------------------------------------------ Nedladdning (via artifactens downloads-förmåga, annars kopiera)
  const textModal = { current: null, listeners: new Set() };
  MM.useTextModal = () => { const [, set] = MM.useState(0); MM.useEffect(() => { const f = () => set((x) => x + 1); textModal.listeners.add(f); return () => textModal.listeners.delete(f); }, []); return textModal; };
  MM.showText = (title, text) => { textModal.current = { title, text }; textModal.listeners.forEach((f) => f()); };
  MM.closeText = () => { textModal.current = null; textModal.listeners.forEach((f) => f()); };
  MM.download = async (filename, text, mime = 'text/csv;charset=utf-8') => {
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) {
        const blob = new Blob(['﻿' + text], { type: mime });
        await dl.save({ filename, data: blob });
        MM.toast(`Filen ${filename} är sparad.`, 'blue');
        return true;
      }
    } catch (e) {
      if (e && e.code && /cancel|declin|denied/i.test(e.code)) { MM.toast('Nedladdningen avbröts.', 'red'); return false; }
    }
    MM.showText(`Innehåll i ${filename}`, text);
    return false;
  };
  MM.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); MM.toast('Kopierat.', 'blue'); return true; } catch (e) { MM.toast('Kunde inte kopiera automatiskt. Markera texten och kopiera själv.', 'red'); return false; }
  };

  // ------------------------------------------------------------ Gemensamma åtgärder
  MM.defineAction('audit.view', (st, p, ctx) => { ctx.audit(p.action || 'view', p.entity, p.entityId, p.details || {}); });
})();
