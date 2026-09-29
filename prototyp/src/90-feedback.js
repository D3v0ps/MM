// 90-feedback.js – feedback (delad databas), testscenarier, startsida och öppna frågor.
(() => {
  const { html, useState, useEffect, useMemo, d } = MM;
  const ui = MM.ui; const I = ui.Icon;

  // ============================================================ Feedbacklager
  const LS_FB = 'miljonmatch-prototyp-feedback-lokal';
  const LS_PROG = 'miljonmatch-prototyp-scenarier';
  const fb = (MM.fb = { mode: 'loading', db: null, user: null, myId: null, items: [], replies: {}, profiles: {}, progress: {}, allProgress: [], listeners: new Set(), canWrite: null, error: null });
  const emit = () => fb.listeners.forEach((f) => f());
  MM.useFb = () => { const [, set] = useState(0); useEffect(() => { const f = () => set((x) => x + 1); fb.listeners.add(f); return () => fb.listeners.delete(f); }, []); return fb; };
  const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } };

  fb.TYPES = [{ value: 'fel', label: 'Fel', icon: 'alert' }, { value: 'forbattring', label: 'Förbättring', icon: 'edit' }, { value: 'fraga', label: 'Fråga', icon: 'help' }, { value: 'bra', label: 'Bra som det är', icon: 'check-circle' }];
  fb.PRIOS = [{ value: 'maste', label: 'Måste ändras' }, { value: 'bor', label: 'Bör ändras' }, { value: 'kan', label: 'Kan vänta' }];
  fb.STATUSES = [{ value: 'ny', label: 'Ny' }, { value: 'diskutera', label: 'Att diskutera' }, { value: 'andras', label: 'Ska ändras' }, { value: 'klar', label: 'Klar' }, { value: 'avfardad', label: 'Avfärdad' }];
  fb.typeLabel = (v) => (fb.TYPES.find((t) => t.value === v) || {}).label || v;
  fb.prioLabel = (v) => (fb.PRIOS.find((t) => t.value === v) || {}).label || v;
  fb.statusLabel = (v) => (fb.STATUSES.find((t) => t.value === v) || {}).label || v;

  const resolveNames = async () => {
    if (!fb.user) return;
    const ids = MM.uniq([...fb.items.map((x) => x.authorId), ...Object.values(fb.replies).flat().map((x) => x.authorId), ...fb.allProgress.map((x) => x.id)].filter(Boolean));
    if (!ids.length) return;
    try { fb.profiles = await fb.user.profiles(ids); emit(); } catch (e) { /* */ }
  };
  fb.nameOf = (id) => { if (!id) return 'Okänd'; if (id === fb.myId) return 'Du'; const p = fb.profiles[id]; return (p && p.name) || 'En testare'; };

  fb.init = async () => {
    fb.progress = lsGet(LS_PROG, {});
    let db = null, user = null;
    try { if (window.claude && window.claude.use) { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } } catch (e) { db = null; }
    fb.user = user;
    if (!db) { fb.mode = 'local'; fb.items = lsGet(LS_FB, []); emit(); return; }
    fb.db = db; fb.mode = 'shared';
    try { fb.myId = user ? await user.id() : null; } catch (e) { fb.myId = null; }
    try { fb.canWrite = user ? await user.can('data.write') : null; } catch (e) { fb.canWrite = null; }
    db.collection('feedback').orderBy('createdAt', 'desc').limit(500).onSnapshot((snap) => {
      fb.items = snap.docs.map((x) => ({ id: x.id, ...x.data() })); fb.error = null; emit(); resolveNames();
    }, (err) => { fb.error = err.code; emit(); });
    db.collection('progress').onSnapshot((snap) => {
      fb.allProgress = snap.docs.map((x) => ({ id: x.id, ...x.data() }));
      const mine = fb.allProgress.find((x) => x.id === fb.myId); if (mine && mine.done) { fb.progress = { ...mine.done, ...fb.progress }; }
      emit(); resolveNames();
    }, () => { /* läsning av framsteg är valfri */ });
    emit();
  };

  fb.add = async (entry) => {
    const doc = { ...entry, status: 'ny', createdAt: new Date().toISOString(), authorId: fb.myId || null, replyCount: 0 };
    if (fb.mode !== 'shared') { const it = { id: `lokal-${Date.now()}`, ...doc }; fb.items = [it, ...fb.items]; lsSet(LS_FB, fb.items); emit(); return { ok: true, local: true }; }
    try { await fb.db.collection('feedback').add(doc); return { ok: true }; }
    catch (e) {
      if (e && e.code === 'invalid_argument') { fb.canWrite = false; emit(); return { ok: false, code: 'no_write' }; }
      if (e && e.code === 'quota_exceeded') return { ok: false, code: 'quota' };
      return { ok: false, code: (e && e.code) || 'unknown' };
    }
  };
  fb.setStatus = async (id, status) => {
    if (fb.mode !== 'shared') { fb.items = fb.items.map((x) => (x.id === id ? { ...x, status } : x)); lsSet(LS_FB, fb.items); emit(); return; }
    try { await fb.db.doc(`feedback/${id}`).update({ status, statusChangedAt: new Date().toISOString(), statusChangedBy: fb.myId || null }); } catch (e) { MM.toast('Kunde inte ändra status. Du kanske bara har läsbehörighet.', 'red'); }
  };
  fb.remove = async (id) => {
    if (fb.mode !== 'shared') { fb.items = fb.items.filter((x) => x.id !== id); lsSet(LS_FB, fb.items); emit(); return; }
    try { await fb.db.doc(`feedback/${id}`).delete(); } catch (e) { MM.toast('Kunde inte ta bort.', 'red'); }
  };
  const replySubs = {};
  fb.watchReplies = (id) => {
    if (fb.mode !== 'shared' || replySubs[id]) return () => {};
    replySubs[id] = fb.db.collection(`feedback/${id}/replies`).orderBy('createdAt').limit(100).onSnapshot((snap) => { fb.replies[id] = snap.docs.map((x) => ({ id: x.id, ...x.data() })); emit(); resolveNames(); }, () => {});
    return () => { if (replySubs[id]) { replySubs[id](); delete replySubs[id]; } };
  };
  fb.reply = async (id, text) => {
    if (fb.mode !== 'shared') { fb.items = fb.items.map((x) => (x.id === id ? { ...x, localReplies: [...(x.localReplies || []), { id: `r${Date.now()}`, text, createdAt: new Date().toISOString(), authorId: null }] } : x)); lsSet(LS_FB, fb.items); emit(); return true; }
    try {
      await fb.db.collection(`feedback/${id}/replies`).add({ text, createdAt: new Date().toISOString(), authorId: fb.myId || null });
      const cur = fb.items.find((x) => x.id === id); await fb.db.doc(`feedback/${id}`).update({ replyCount: ((cur && cur.replyCount) || 0) + 1, lastReplyAt: new Date().toISOString() });
      return true;
    } catch (e) { MM.toast('Svaret kunde inte sparas.', 'red'); return false; }
  };
  fb.markStep = async (scenarioId, stepIdx, done) => {
    const key = `${scenarioId}:${stepIdx}`; fb.progress = { ...fb.progress, [key]: done }; if (!done) delete fb.progress[key];
    lsSet(LS_PROG, fb.progress); emit();
    if (fb.mode === 'shared' && fb.myId) { try { await fb.db.doc(`progress/${fb.myId}`).set({ done: fb.progress, updatedAt: new Date().toISOString() }); } catch (e) { /* valfritt */ } }
  };
  fb.asMarkdown = (items) => items.map((x) => `- [${fb.statusLabel(x.status)}] ${fb.typeLabel(x.type)} · ${fb.prioLabel(x.priority)} · ${x.perspectiveLabel || ''} · ${x.viewTitle || 'Hela prototypen'}${x.scenarioTitle ? ` · Scenario: ${x.scenarioTitle}` : ''}\n  ${String(x.text || '').replace(/\n/g, '\n  ')} (${fb.nameOf(x.authorId)}, ${new Date(x.createdAt).toLocaleDateString('sv-SE')})`).join('\n');

  // ============================================================ Scenarier
  const sc = (tag) => MM.store.state.script[tag];
  const aiDraftId = () => { const ci = MM.store.state.checkIns.find((x) => x.caseId === sc('mehmet') && x.ai); return ci ? ci.id : null; };
  const reportOf = (tag, kind, month) => { const r = MM.store.state.reports.find((x) => x.caseId === sc(tag) && x.kind === kind && (!month || x.month === month)); return r ? r.id : null; };
  MM.scenarios = () => [
    { id: 's1', title: 'Från mejl till orderbekräftelse', lead: 'Kommunens formella beställningskanal är mejl. Följ ett avrop från inkorgen till kommunens portal.', steps: [
      { role: 'samordnare', view: 'sam.inkorg', params: { emailId: 'em-101' }, text: 'Öppna avropsinkorgen. Mejlet från Maria Ekdahl kom 08.41 med Word-mallen. Det har redan fått ärendenummer och ett automatiskt ordererkännande.' },
      { role: 'samordnare', view: 'sam.inkorg', params: { emailId: 'em-101' }, text: 'Jämför originalmejlet med det tolkade formuläret. Välj huvudcoach och första möte. Klicka Acceptera och se orderbekräftelsen.' },
      { role: 'kommun_handlaggare', view: 'kom.deltagare', params: { caseId: sc('inkorg-mall') }, text: 'Byt till kundens perspektiv. Så här ser Maria ordererkännandet och orderbekräftelsen i portalen.' },
    ] },
    { id: 's2', title: 'Fritextmejl utan beställarreferens', lead: 'AI tolkar fritext. Utan giltig beställarreferens kan ärendet inte bekräftas – och ingen faktura skapas.', steps: [
      { role: 'samordnare', view: 'sam.inkorg', params: { emailId: 'em-102' }, text: 'Öppna mejlet från Ahmed Yusuf (fredag 15.20). AI har tolkat texten. Titta på konfidensen per fält och de saknade uppgifterna.' },
      { role: 'samordnare', view: 'sam.inkorg', params: { emailId: 'em-102' }, text: 'Försök acceptera. Det stoppas eftersom beställarreferensen (8–10 siffror) saknas.' },
      { role: 'samordnare', view: 'sam.inkorg', params: { emailId: 'em-103' }, text: 'Öppna kompletteringen från i morse. Den kopplades automatiskt via ärendenumret i ämnesraden. För in uppgifterna och acceptera.' },
      { role: 'admin', view: 'admin.mallar', params: { tab: 'logg' }, text: 'Se utskicksloggen: mejl och SMS innehåller bara ärendenummer och länk, aldrig personuppgifter.' },
    ] },
    { id: 's3', title: 'Kommunen beställer i portalen', lead: 'För den som hellre beställer i portalen än via mejl. Skrivet för ovana användare: en sak per skärm.', steps: [
      { role: 'kommun_handlaggare', view: 'kom.login', params: {}, text: 'Logga in med e-post och sexsiffrig engångskod (ingen magisk länk – Safe Links förbrukar dem).' },
      { role: 'kommun_handlaggare', view: 'kom.bestall', params: {}, text: 'Beställ en ny insats i tre steg. Testa gärna en felaktig beställarreferens och se hjälptexten.' },
      { role: 'kommun_handlaggare', view: 'kom.bestall', params: {}, text: 'Se ordererkännandet med ärendenummer direkt på skärmen.' },
      { role: 'samordnare', view: 'sam.inkorg', params: {}, text: 'Byt till leverantörens perspektiv. Beställningen ligger i inkorgen med SLA-klocka (en arbetsdag).' },
    ] },
    { id: 's4', title: 'Coachens måndag och veckorapporten', lead: 'Närvaro ska vara registrerad senast måndag 10.00. Veckorapporten publiceras när allt är klart.', steps: [
      { role: 'coach', view: 'coach.minvecka', params: {}, text: 'Min vecka: tre tillfällen från förra veckan saknar närvaro. Nedräkningen visar tiden till 10.00.' },
      { role: 'coach', view: 'coach.narvaro', params: { week: 'last' }, text: 'Registrera närvaron med ett klick per tillfälle. När allt är klart publiceras veckorapporten till Maria automatiskt.' },
      { role: 'kommun_handlaggare', view: 'kom.rapporter', params: {}, text: 'Byt till kundens perspektiv och öppna veckorapporten för vecka 4.' },
    ] },
    { id: 's5', title: 'Röd status blir en avvikelse', lead: 'Avvikelse = åtgärd. Röd status kräver åtgärd, ansvarig och uppföljningsdatum.', steps: [
      { role: 'coach', view: 'coach.avstamning', params: { caseId: sc('yusuf') }, text: 'Gör veckoavstämningen för Yusuf Abdi, som har upprepad ogiltig frånvaro.' },
      { role: 'coach', view: 'coach.avstamning', params: { caseId: sc('yusuf') }, text: 'Välj samlad status Röd. Systemet kräver en avvikelse med åtgärd, ansvarig och uppföljningsdatum.' },
      { role: 'coach', view: 'arende.kort', params: { caseId: sc('yusuf'), tab: 'avvikelser' }, text: 'Klicka "Kalla kommunen till uppföljning".' },
      { role: 'kommun_handlaggare', view: 'kom.deltagare', params: { caseId: sc('yusuf') }, text: 'Byt till kundens perspektiv och se mötesförfrågan som ett säkert meddelande.' },
    ] },
    { id: 's6', title: 'AI-stöd: granska ett utkast', lead: 'Byggs i fas 2. AI föreslår – coachen bedömer. Belägg med citat och tidpunkt.', steps: [
      { role: 'coach', view: 'coach.avstamning', params: { caseId: sc('mehmet'), checkInId: aiDraftId() }, text: 'Öppna AI-utkastet från Mehmet Kayas avstämning i fredags.' },
      { role: 'coach', view: 'coach.avstamning', params: { caseId: sc('mehmet'), checkInId: aiDraftId() }, text: 'Visa beläggen. Samlad status är tom – den väljer du själv. Acceptera, ändra eller avvisa varje förslag.' },
      { role: 'coach', view: 'coach.avstamning', params: { caseId: sc('mehmet'), checkInId: aiDraftId() }, text: 'Godkänn. Råtranskriptet raderas och varje beslut loggas.' },
    ] },
    { id: 's7', title: 'Månadsbedömning till kommunen', lead: 'Progression per område enligt mall 02. Rapporten byggs bara av godkända uppgifter.', steps: [
      { role: 'coach', view: 'coach.manad', params: { caseId: sc('nadia'), month: '2027-01' }, text: 'Öppna januaribedömningen för Nadia Warsame. AI:s nivåförslag visas bredvid, men rullgardinen är tom tills du väljer.' },
      { role: 'coach', view: 'coach.manad', params: { caseId: sc('nadia'), month: '2027-01' }, text: 'Försök godkänna med nivå 1 eller högre utan observation. Det stoppas – mallen kräver alltid belägg.' },
      { role: 'coach', view: 'rapport.visa', params: { reportId: reportOf('nadia', 'monthly', '2027-01') }, text: 'Förhandsgranska månadsrapporten (avsnitt 1–8). Godkänn och leverera.' },
      { role: 'kommun_handlaggare', view: 'kom.rapporter', params: {}, text: 'Byt till kundens perspektiv och öppna rapporten. Den kvitteras som läst.' },
    ] },
    { id: 's8', title: 'Fakturering januari', lead: 'En faktura per ärende och månad. Beställarreferens krävs. Veckor utan närvaro kontrolleras.', steps: [
      { role: 'ekonom', view: 'eko.korning', params: { month: '2027-01' }, text: 'Öppna januarikörningen. Veckorna följer torsdagsregeln (v. 53 hör till december).' },
      { role: 'ekonom', view: 'eko.korning', params: { month: '2027-01' }, text: 'Två ärenden är stoppade: beställarreferensen är fel. Rätta med referensen från kommunens meddelande.' },
      { role: 'ekonom', view: 'eko.korning', params: { month: '2027-01' }, text: 'Godkänn veckor utan närvaro. Förhandsgranska en faktura med upparbetat och återstående belopp.' },
      { role: 'ekonom', view: 'eko.korning', params: { month: '2027-01' }, text: 'Skicka till Fortnox (simulerat) eller använd reservvägen: export och markera som manuellt fakturerad.' },
    ] },
    { id: 's9', title: 'Ledningens vy och kundens vy', lead: 'Samma resultat – olika perspektiv. Det interna målet visas aldrig för kommunen.', steps: [
      { role: 'chef', view: 'chef.oversikt', params: {}, text: 'Resultatgraden ligger under det interna målet 35 % men över avtalets 32 %. Titta på prognosen.' },
      { role: 'chef', view: 'chef.oversikt', params: {}, text: 'Kvittera flaggan med en kort åtgärdsplan.' },
      { role: 'chef', view: 'chef.avvikelser', params: {}, text: 'Titta på avtalsavvikelser, åtgärdsplaner och varningar (0 av 3).' },
      { role: 'kommun_chef', view: 'kom.chef', params: {}, text: 'Byt till kundens perspektiv: kommunens chef ser beställarrapporten med bara avtalsmålet 32 %.' },
    ] },
    { id: 's10', title: 'Behörigheter och dataskydd', lead: 'Behörighet = avtal + roll + tilldelning. Testa samma data från olika roller.', steps: [
      { role: 'ekonom', view: 'eko.start', params: {}, text: 'Som ekonom: ärendenummer, perioder och referenser – inga namn, anteckningar eller rapporter.' },
      { role: 'handledare', view: 'hand.start', params: {}, text: 'Som handledare: Petra ser bara de ärenden hon är tilldelad.' },
      { role: 'avtalsansvarig', view: 'arenden.lista', params: { filter: 'skyddade' }, text: 'Det skyddade ärendet syns bara för namngiven coach och avtalsansvarig. Byt sedan till samordnare och jämför.' },
      { role: 'admin', view: 'admin.logg', params: {}, text: 'Revisionsloggen visar allt du gjort i prototypen, inklusive visningar av deltagarkort och personnummer.' },
    ] },
    { id: 's11', title: 'Deltagarens röst', lead: 'Pulsmätning via engångslänk, utan inloggning. Coachen ser inte enskilda svar.', steps: [
      { role: 'deltagare', view: 'puls.svar', params: {}, text: 'Svara på pulsmätningen. Byt gärna språk (svenska, engelska, arabiska, somaliska).' },
      { role: 'chef', view: 'chef.oversikt', params: { tab: 'puls' }, text: 'Byt till ledningens vy. Aggregat visas först vid minst 5 svar. Lågt betyg på stödet går till chef, inte coach.' },
    ] },
    { id: 's13', title: 'Notiser, påminnelser och tidig eskalering', lead: 'Coachen får notis vid tilldelning och påminnelse när progression uteblir. Två veckor i rad eskaleras till chef/controller – utan att coachen ser det.', steps: [
      { role: 'samordnare', view: 'sam.inkorg', params: { emailId: 'em-106' }, text: 'Acceptera avropet från Linda Karlsson och välj Amira Haddad som huvudcoach. Hon får en notis i appen och ett mejl utan personuppgifter.' },
      { role: 'coach', view: 'notiser', params: {}, text: 'Byt till coachen. Under Notiser finns tilldelningen och påminnelser om ärenden utan progression förra veckan. Inget visar att chefen fått en eskalering.' },
      { role: 'chef', view: 'notiser', params: {}, text: 'Byt till chef/controller. Här syns eskaleringarna, till exempel Yusuf Abdi som har flera veckor i rad utan progression.' },
      { role: 'chef', view: 'chef.oversikt', params: {}, text: 'I ledningsvyn syns tidig uppmärksamhet per coach. Kvittera med en kort åtgärd.' },
      { role: 'admin', view: 'admin.avtal', params: { tab: 'interna' }, text: 'Reglerna (antal veckor, mottagare, kanaler) är interna regler för Miljonbemanning och kan ändras i adminvyn.' },
    ] },
    { id: 's12', title: 'Avtalet är konfiguration', lead: 'Samma kod för Botkyrka och Kammarkollegiet. Inga avtalsvärden är hårdkodade.', steps: [
      { role: 'admin', view: 'admin.avtal', params: {}, text: 'Se Botkyrkas avtalskonfiguration. Värden som ska fastställas är markerade och aktiveras inte.' },
      { role: 'admin', view: 'admin.avtal', params: { contract: 'c-kk' }, text: 'Jämför med skissen för Kammarkollegiet: paketpriser, andra KPI:er och SLA.' },
      { role: 'admin', view: 'om.fragor', params: {}, text: 'Gå igenom de öppna frågorna till Botkyrka.' },
    ] },
  ];
  const scen = { active: null, step: 0, listeners: new Set() };
  MM.scen = scen;
  const semit = () => scen.listeners.forEach((f) => f());
  MM.useScen = () => { const [, set] = useState(0); useEffect(() => { const f = () => set((x) => x + 1); scen.listeners.add(f); return () => scen.listeners.delete(f); }, []); return scen; };
  MM.startScenario = (id, step = 0) => { scen.active = id; scen.step = step; semit(); const s = MM.scenarios().find((x) => x.id === id); const st = s.steps[step]; MM.nav(st.view, st.params, { role: st.role }); };
  MM.gotoStep = (i) => { const s = MM.scenarios().find((x) => x.id === scen.active); if (!s) return; scen.step = Math.max(0, Math.min(s.steps.length - 1, i)); semit(); const st = s.steps[scen.step]; if (st.role !== MM.route.role || st.view !== MM.route.view || JSON.stringify(st.params) !== JSON.stringify(MM.route.params)) MM.nav(st.view, st.params, { role: st.role }); };
  MM.stopScenario = () => { scen.active = null; semit(); };

  const perspLabel = (role) => ({ leverantor: 'Leverantör', kund: 'Kund', deltagare: 'Deltagare' })[MM.perspectiveOf(role)];
  const perspTone = (role) => (MM.perspectiveOf(role) === 'kund' ? 'blue' : MM.perspectiveOf(role) === 'deltagare' ? 'grey' : 'dark');

  /** Scenariofältet under prototypfältet. */
  MM.ScenarioBar = () => {
    const s = MM.useScen(); const f = MM.useFb(); MM.useRoute();
    if (!s.active) return null;
    const def = MM.scenarios().find((x) => x.id === s.active); if (!def) return null;
    const st = def.steps[s.step]; const done = !!f.progress[`${def.id}:${s.step}`];
    const n = MM.scenarios().findIndex((x) => x.id === def.id) + 1;
    return html`<div class="scenbar" role="region" aria-label="Pågående testscenario" style="background:var(--antracit);color:var(--vit);padding:10px 16px;--focus:var(--vit)">
      <div class="row" style="max-width:1240px;margin:0 auto;gap:10px 16px">
        <div class="stack-sm" style="gap:2px;flex:1;min-width:min(100%,280px)">
          <div class="small" style="font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.8)">Scenario ${n}: ${def.title} · steg ${s.step + 1} av ${def.steps.length} · <span class=${`badge badge-${perspTone(st.role)}`} style="border-color:var(--vit)">${perspLabel(st.role)}: ${MM.roleDef(st.role).label}</span></div>
          <div style="font-size:.9375rem">${st.text}</div>
        </div>
        <div class="row-sm">
          <button type="button" class="btn btn-secondary" style="background:transparent;color:var(--vit);border-color:var(--vit);min-height:40px" disabled=${s.step === 0} onClick=${() => MM.gotoStep(s.step - 1)}><${I} name="chevron-left" />Föregående</button>
          <button type="button" class="btn" style="background:${done ? 'var(--bla)' : 'var(--vit)'};color:var(--antracit);min-height:40px" onClick=${() => fb.markStep(def.id, s.step, !done)} aria-pressed=${done ? 'true' : 'false'}><${I} name=${done ? 'check-square' : 'square'} />Testat</button>
          ${s.step < def.steps.length - 1
            ? html`<button type="button" class="btn" style="background:var(--vit);color:var(--antracit);min-height:40px" onClick=${() => MM.gotoStep(s.step + 1)}>Nästa steg<${I} name="chevron-right" /></button>`
            : html`<button type="button" class="btn" style="background:var(--vit);color:var(--antracit);min-height:40px" onClick=${() => { MM.openFeedback({ scenarioId: def.id }); }}><${I} name="message-circle" />Feedback på scenariot</button>`}
          <button type="button" class="btn btn-ghost" style="color:var(--vit);min-height:40px" onClick=${MM.stopScenario} title="Avsluta scenariot"><${I} name="x" /><span class="sr-only">Avsluta scenariot</span></button>
        </div>
      </div></div>`;
  };

  // ============================================================ Feedbacklåda
  const drawer = { open: false, tab: 'ny', preset: {}, listeners: new Set() };
  const demit = () => drawer.listeners.forEach((f) => f());
  MM.openFeedback = (preset = {}) => { drawer.open = true; drawer.tab = preset.tab || 'ny'; drawer.preset = preset; demit(); };
  MM.closeFeedback = () => { drawer.open = false; demit(); };
  const useDrawer = () => { const [, set] = useState(0); useEffect(() => { const f = () => set((x) => x + 1); drawer.listeners.add(f); return () => drawer.listeners.delete(f); }, []); return drawer; };

  const FeedbackItem = ({ it }) => {
    const f = MM.useFb(); const [open, setOpen] = useState(false); const [reply, setReply] = useState(''); const [confirmDel, setConfirmDel] = useState(false);
    useEffect(() => (open ? fb.watchReplies(it.id) : undefined), [open]);
    const replies = f.mode === 'shared' ? (f.replies[it.id] || []) : (it.localReplies || []);
    const canNav = it.viewId && MM.views[it.viewId];
    return html`<article class=${MM.cls('fb-item', it.status === 'ny' && 'is-new')}>
      <div class="fb-meta">
        <${ui.Badge} tone=${it.type === 'fel' ? 'red' : it.type === 'bra' ? 'blue' : 'grey'} icon=${(fb.TYPES.find((t) => t.value === it.type) || {}).icon}>${fb.typeLabel(it.type)}<//>
        <span class="strong">${fb.prioLabel(it.priority)}</span>
        ${it.perspectiveLabel && html`<${ui.Badge} tone=${it.perspective === 'kund' ? 'bluetone' : 'outline'}>${it.perspectiveLabel}<//>`}
        <span>${fb.nameOf(it.authorId)} · ${new Date(it.createdAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      <div class="small muted">${it.roleLabel ? `${it.roleLabel} · ` : ''}${it.viewTitle || 'Hela prototypen'}${it.scenarioTitle ? ` · Scenario: ${it.scenarioTitle}` : ''}</div>
      <div class="fb-text">${it.text}</div>
      <div class="row-sm">
        <label class="sr-only" for=${`st-${it.id}`}>Status</label>
        <select id=${`st-${it.id}`} value=${it.status} onChange=${(e) => fb.setStatus(it.id, e.target.value)} style="min-height:40px;width:auto;padding:6px 10px;font-size:.875rem">${fb.STATUSES.map((s) => html`<option value=${s.value}>${s.label}</option>`)}</select>
        ${canNav && html`<button type="button" class="btn btn-ghost" style="min-height:40px" onClick=${() => { MM.closeFeedback(); MM.nav(it.viewId, it.viewParams || {}, { role: it.role }); }}><${I} name="arrow-right" />Gå till vyn</button>`}
        <button type="button" class="btn btn-ghost" style="min-height:40px" onClick=${() => setOpen(!open)} aria-expanded=${open ? 'true' : 'false'}><${I} name="reply" />Svar${(it.replyCount || (it.localReplies || []).length) ? ` (${it.replyCount || (it.localReplies || []).length})` : ''}</button>
        ${(it.authorId === f.myId || f.mode !== 'shared') && (confirmDel
          ? html`<span class="row-sm"><span class="small">Ta bort?</span><button type="button" class="btn btn-danger" style="min-height:40px" onClick=${() => fb.remove(it.id)}>Ja, ta bort</button><button type="button" class="btn btn-ghost" style="min-height:40px" onClick=${() => setConfirmDel(false)}>Avbryt</button></span>`
          : html`<button type="button" class="btn btn-ghost" style="min-height:40px" onClick=${() => setConfirmDel(true)}><${I} name="trash" /><span class="sr-only">Ta bort</span></button>`)}
      </div>
      ${open && html`<div class="stack-sm">
        ${replies.map((r) => html`<div class="fb-reply"><div class="small muted">${fb.nameOf(r.authorId)} · ${new Date(r.createdAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</div><div class="fb-text">${r.text}</div></div>`)}
        <form class="row-sm" onSubmit=${async (e) => { e.preventDefault(); if (!reply.trim()) return; if (await fb.reply(it.id, reply.trim())) setReply(''); }}>
          <label class="sr-only" for=${`rep-${it.id}`}>Svara</label>
          <input id=${`rep-${it.id}`} type="text" value=${reply} onInput=${(e) => setReply(e.target.value)} placeholder="Skriv ett svar" style="flex:1;min-width:0" />
          <button type="submit" class="btn btn-primary"><${I} name="send" />Svara</button>
        </form></div>`}
    </article>`;
  };

  MM.FeedbackDrawer = () => {
    const dr = useDrawer(); const f = MM.useFb(); const route = MM.useRoute();
    const [type, setType] = useState('forbattring'); const [prio, setPrio] = useState('bor'); const [text, setText] = useState(''); const [scope, setScope] = useState('view');
    const [filter, setFilter] = useState('alla'); const [sent, setSent] = useState(null); const [err, setErr] = useState(null);
    useEffect(() => { if (dr.open) { setSent(null); setErr(null); if (dr.preset.scenarioId) setScope('scenario'); else setScope('view'); } }, [dr.open, dr.preset]);
    if (!dr.open) return null;
    const view = MM.views[route.view] || {}; const scenDef = MM.scenarios().find((x) => x.id === (dr.preset.scenarioId || MM.scen.active));
    const persp = MM.perspective();
    const submit = async (e) => {
      e.preventDefault(); setErr(null);
      if (!text.trim()) { setErr('Skriv vad du tycker innan du sparar.'); return; }
      const entry = { type, priority: prio, text: text.trim(), role: route.role, roleLabel: MM.roleDef(route.role).label, perspective: persp, perspectiveLabel: MM.PERSPECTIVES.find((p) => p.key === persp).label,
        viewId: scope === 'all' ? null : route.view, viewTitle: scope === 'all' ? null : (typeof view.title === 'function' ? view.title(route.params) : view.title) || route.view, viewParams: scope === 'all' ? null : route.params,
        scenarioId: scope === 'scenario' && scenDef ? scenDef.id : null, scenarioTitle: scope === 'scenario' && scenDef ? scenDef.title : null, prototypeVersion: MM.PROTOTYPE_VERSION };
      const res = await fb.add(entry);
      if (res.ok) { setText(''); setSent(res.local ? 'local' : 'shared'); } else setErr(res.code === 'no_write' ? 'Du har bara läsbehörighet till den här prototypen, så feedbacken kunde inte sparas. Be den som delade länken att bjuda in dig via e-post med behörigheten Redigerare (Editor). Du kan också kopiera texten nedan.' : res.code === 'quota' ? 'Databasen är full. Säg till den som delade länken.' : 'Feedbacken kunde inte sparas just nu. Försök igen om en stund.');
    };
    const items = f.items.filter((x) => filter === 'alla' || (filter === 'vy' && x.viewId === route.view) || (filter === 'nya' && x.status === 'ny') || (filter === 'kund' && x.perspective === 'kund') || (filter === 'leverantor' && x.perspective === 'leverantor') || (filter === 'oppna' && !['klar', 'avfardad'].includes(x.status)));
    const counts = { alla: f.items.length, nya: f.items.filter((x) => x.status === 'ny').length };
    const tryComments = async () => {
      try { const c = window.claude && (await window.claude.use('comments')); if (!c) { MM.toast('Kommentarer är inte tillgängliga här.', 'red'); return; } const el = document.getElementById('main'); const r = await c.openComposer({ element: el }); if (!r.opened) MM.toast('Klicka i prototypen först och försök igen.', 'red'); } catch (e2) { MM.toast('Kommentarer är inte tillgängliga här.', 'red'); }
    };
    return html`<div class="drawer-backdrop" onClick=${MM.closeFeedback}></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="Feedback">
        <div class="drawer-head"><h2 class="modal-title" style="font-size:1.0625rem">Feedback</h2><${ui.Btn} kind="ghost" icon="x" title="Stäng" onClick=${MM.closeFeedback} /></div>
        <div style="padding:0 18px"><${ui.Tabs} tabs=${[{ id: 'ny', label: 'Lämna feedback', icon: 'edit' }, { id: 'lista', label: 'All feedback', count: counts.alla, icon: 'list' }]} active=${dr.tab} onChange=${(t) => { drawer.tab = t; demit(); }} /></div>
        <div class="drawer-body">
          ${f.mode === 'local' && html`<${ui.Notice} tone="warn" title="Sparas bara i din webbläsare">Den delade feedbackloggen är inte tillgänglig här. Öppna länken i claude.ai för att dela feedbacken, eller kopiera listan.<//>`}
          ${f.mode === 'shared' && f.canWrite === false && html`<${ui.Notice} tone="warn" title="Du kan läsa men inte skriva">Be den som delade länken att bjuda in dig via e-post med behörigheten Redigerare (Editor). Tills dess kan du kommentera med knappen längst ned.<//>`}
          ${dr.tab === 'ny' ? html`
            <form class="stack" onSubmit=${submit}>
              <div class="notice notice-info" style="font-size:.9375rem"><${I} name="map-pin" /><div><div class="strong">${MM.PERSPECTIVES.find((p) => p.key === persp).long}</div><div>${MM.roleDef(route.role).label} · ${(typeof view.title === 'function' ? view.title(route.params) : view.title) || route.view}</div></div></div>
              <${ui.Field} label="Gäller" id="fb-scope"><${ui.Seg} id="fb-scope" value=${scope} onChange=${setScope} ariaLabel="Gäller" options=${[{ value: 'view', label: 'Den här vyn' }, ...(scenDef ? [{ value: 'scenario', label: `Scenariot: ${scenDef.title}` }] : []), { value: 'all', label: 'Hela prototypen' }]} /><//>
              <${ui.Field} label="Typ" id="fb-type"><${ui.Seg} id="fb-type" value=${type} onChange=${setType} ariaLabel="Typ" options=${fb.TYPES} /><//>
              <${ui.Field} label="Hur viktigt?" id="fb-prio"><${ui.Seg} id="fb-prio" value=${prio} onChange=${setPrio} ariaLabel="Hur viktigt" options=${fb.PRIOS} /><//>
              <${ui.Field} label="Vad tycker du?" id="fb-text" required help="Skriv fritt. Beskriv gärna vad du förväntade dig och vad som hände." error=${err}>
                <${ui.TextArea} id="fb-text" value=${text} onInput=${setText} rows="5" placeholder="Till exempel: Samordnaren behöver se handläggarens telefonnummer direkt i inkorgen." maxLength="4000" />
              <//>
              <div class="row"><${ui.Btn} kind="primary" type="submit" icon="send">Spara feedback<//>${err && text && html`<${ui.Btn} kind="ghost" icon="copy" onClick=${() => MM.copy(`${fb.typeLabel(type)} · ${fb.prioLabel(prio)} · ${MM.roleDef(route.role).label} · ${view.title || route.view}\n${text}`)}>Kopiera texten<//>`}</div>
              ${sent && html`<${ui.Notice} tone="ok" title="Tack! Feedbacken är sparad.">${sent === 'shared' ? 'Alla som har länken ser den under All feedback, och vi går igenom den tillsammans.' : 'Den sparas i din webbläsare.'} <button type="button" class="btn btn-ghost" style="min-height:32px;padding:2px 6px" onClick=${() => { drawer.tab = 'lista'; demit(); }}>Visa all feedback</button><//>`}
            </form>
            <hr class="divider" />
            <div class="stack-sm"><div class="small muted">Vill du hellre peka på en exakt plats på sidan?</div><div><${ui.Btn} kind="secondary" icon="message-circle" onClick=${tryComments}>Kommentera i marginalen<//></div></div>`
          : html`
            <div class="row-sm">
              <label class="sr-only" for="fb-filter">Filter</label>
              <select id="fb-filter" value=${filter} onChange=${(e) => setFilter(e.target.value)} style="width:auto;flex:1">
                <option value="alla">Alla (${counts.alla})</option><option value="nya">Nya (${counts.nya})</option><option value="oppna">Inte klara</option>
                <option value="leverantor">Leverantörens perspektiv</option><option value="kund">Kundens perspektiv</option><option value="vy">Den här vyn</option>
              </select>
              <${ui.Btn} kind="secondary" icon="copy" onClick=${() => MM.copy(fb.asMarkdown(items))} disabled=${!items.length}>Kopiera lista<//>
            </div>
            <div><button type="button" class="btn btn-ghost" style="min-height:36px;padding:4px 6px" onClick=${() => { MM.closeFeedback(); MM.nav('om.feedback', {}); }}><${I} name="external" />Öppna som helsida för genomgång</button></div>
            ${f.mode === 'loading' && html`<div class="muted">Hämtar feedback …</div>`}
            ${items.length === 0 && f.mode !== 'loading' && html`<${ui.Empty} icon="message-circle" title="Ingen feedback här ännu">Välj Lämna feedback för att skriva den första. Den hamnar här för alla som har länken.<//>`}
            ${items.map((it) => html`<${FeedbackItem} key=${it.id} it=${it} />`)}`}
        </div>
      </aside>`;
  };

  // ============================================================ Startsida (om.start)
  const RoleCard = ({ r }) => html`<button type="button" class="rolecard" onClick=${() => MM.setRole(r.key)}>
    <span class="rc-title"><${I} name=${({ samordnare: 'inbox', avtalsansvarig: 'briefcase', coach: 'calendar', handledare: 'tool', chef: 'chart', ekonom: 'card', admin: 'settings', kommun_handlaggare: 'building', kommun_chef: 'bar-chart', deltagare: 'smile' })[r.key] || 'user'} />${r.label}</span>
    <span class="rc-sub">${r.personaId ? `${MM.personName(r.personaId)} · ` : ''}${r.desc}</span>
  </button>`;

  const ScenarioList = () => {
    const f = MM.useFb();
    return html`<div class="grid">${MM.scenarios().map((s, i) => {
      const done = s.steps.filter((_, j) => f.progress[`${s.id}:${j}`]).length;
      const perspectives = MM.uniq(s.steps.map((st) => MM.perspectiveOf(st.role)));
      return html`<div class="card"><div class="card-body stack-sm">
        <div class="row-between"><span class="eyebrow">Scenario ${i + 1} · ${s.steps.length} steg</span>${done > 0 && html`<${ui.Badge} tone=${done === s.steps.length ? 'blue' : 'outline'} icon="check">${done}/${s.steps.length} testade<//>`}</div>
        <h3 style="font-size:1.0625rem">${s.title}</h3>
        <p class="small muted">${s.lead}</p>
        <div class="row-sm">${perspectives.map((p) => html`<${ui.Badge} tone=${p === 'kund' ? 'bluetone' : p === 'deltagare' ? 'grey' : 'outline'}>${({ leverantor: 'Leverantör', kund: 'Kund', deltagare: 'Deltagare' })[p]}<//>`)}</div>
        <div><${ui.Btn} kind="primary" icon="play" onClick=${() => MM.startScenario(s.id)}>Starta<//></div>
      </div></div>`; })}</div>`;
  };

  MM.registerView('om.start', {
    title: 'Om prototypen', roles: 'all',
    component: () => {
      const f = MM.useFb(); MM.useStore();
      const supplier = MM.ROLES.filter((r) => r.org === 'mb'); const customer = MM.ROLES.filter((r) => r.org === 'customer'); const participant = MM.ROLES.filter((r) => r.org === 'participant');
      const totalSteps = MM.sum(MM.scenarios(), (s) => s.steps.length); const doneSteps = Object.values(f.progress).filter(Boolean).length;
      return html`<div class="page">
        <section class="hero">
          <div class="eyebrow" style="color:rgba(255,255,255,.8)">Klickbar prototyp · påhittade testdata</div>
          <h1><span class="dot" style="background:var(--rod-logo)" aria-hidden="true"></span>Miljonmatch</h1>
          <p>Plattform för arbetsmarknadsinsatser. Avtal nr 1 är Botkyrka kommun (yrkesförberedande och yrkesinriktade insatser). Prototypen visar samma ärenden från två håll: <b>leverantören Miljonbemanning</b> och <b>kunden Botkyrka kommun</b>.</p>
          <p class="small">Demodatum: måndag 1 februari 2027 kl. 09.12 – fem månader in i piloten, så att det finns rapporter, fakturor och nyckeltal att titta på. Inga riktiga personer eller personnummer finns i prototypen.</p>
          <div class="row"><${ui.Btn} kind="primary" size="lg" icon="play" onClick=${() => MM.startScenario('s1')}>Starta första testscenariot<//><${ui.Btn} kind="secondary" size="lg" icon="message-circle" onClick=${() => MM.openFeedback()}>Lämna feedback<//></div>
        </section>

        <div class="split">
          <${ui.Card} title="Leverantörens perspektiv – Miljonbemanning" icon="briefcase">
            <p class="muted" style="margin-bottom:12px">Så arbetar vi: avrop, coachning, rapporter, uppföljning och fakturering.</p>
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))">${supplier.map((r) => html`<${RoleCard} r=${r} />`)}</div>
          <//>
          <${ui.Card} title="Kundens perspektiv – Botkyrka kommun" icon="building">
            <p class="muted" style="margin-bottom:12px">Så upplever kommunen tjänsten: beställning, rapporter, meddelanden och uppföljning. Portalen är skriven för ovana användare.</p>
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))">${customer.map((r) => html`<${RoleCard} r=${r} />`)}</div>
            <hr class="divider" style="margin:16px 0" />
            <div class="eyebrow" style="margin-bottom:8px">Deltagarens perspektiv</div>
            <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))">${participant.map((r) => html`<${RoleCard} r=${r} />`)}</div>
          <//>
        </div>

        <${ui.Card} title="Nytt sedan SPEC v0.2" icon="bell" tone="blue">
          <ul class="stack-sm" style="margin:0;padding-left:20px">
            <li><b>Notis vid tilldelning:</b> coach och team får notis i appen och e-post (utan personuppgifter) när ett ärende tilldelas eller coach byts.</li>
            <li><b>Automatisk påminnelse:</b> en vecka utan progression (veckomålet inte uppnått eller ingen godkänd avstämning) ger påminnelse till coachen.</li>
            <li><b>Tidig eskalering:</b> två veckor i rad utan progression eskaleras till chef/controller.</li>
            <li><b>Behörighet:</b> varje notis har en mottagare. Coachen ser inte att en eskalering gått till chefen.</li>
          </ul>
          <div class="row" style="margin-top:12px"><${ui.Btn} kind="secondary" icon="play" onClick=${() => MM.startScenario('s13')}>Testa scenariot<//></div>
        <//>

        <${ui.Section} title="Så lämnar du feedback">
          <div class="grid-3">
            <div class="card"><div class="card-body stack-sm"><span class="eyebrow">1</span><div class="strong">Testa ett scenario eller klicka runt fritt</div><div class="small muted">Byt roll och perspektiv i fältet högst upp. Allt du gör sparas i din webbläsare och kan återställas.</div></div></div>
            <div class="card"><div class="card-body stack-sm"><span class="eyebrow">2</span><div class="strong">Klicka på Feedback</div><div class="small muted">Knappen finns alltid nere till höger. Vyn, rollen och perspektivet fylls i automatiskt.</div></div></div>
            <div class="card"><div class="card-body stack-sm"><span class="eyebrow">3</span><div class="strong">Vi går igenom listan tillsammans</div><div class="small muted">All feedback samlas på ett ställe med status: Ny, Att diskutera, Ska ändras, Klar eller Avfärdad.</div></div></div>
          </div>
          <div class="row-sm"><span class="small muted">${f.mode === 'shared' ? `${f.items.length} feedbackpunkter hittills` : 'Feedbacken sparas lokalt i den här förhandsvisningen'}</span><${ui.Btn} kind="ghost" icon="list" onClick=${() => MM.nav('om.feedback', {})}>Öppna genomgången av feedback<//></div>
        <//>

        <${ui.Section} title=${`Testscenarier (${doneSteps} av ${totalSteps} steg testade)`}>
          <p class="muted">Varje scenario guidar dig steg för steg och byter roll åt dig. Flera av dem följer samma ärende från leverantören till kunden och tillbaka.</p>
          <${ScenarioList} />
        <//>

        <${ui.Section} title="Vad byggs när (SPEC §12)">
          <div class="grid-4">
            ${[['1', 'Leverera avtalet', 'Inloggning och roller, mejlavrop och portal, ärendenummer, närvaro och veckorapport, avstämningar, månadsbedömning, rapporter, fakturaunderlag, deadlines, revisionslogg.'],
              ['2', 'AI och automatisk fakturering', 'Inspelning med samtycke, AI-förslag med belägg, Fortnox-API, pulsmätning, resultatflaggor, register för avtalsavvikelser.'],
              ['3', 'Mervärde', 'Bonusanspråk, yrkeskompetensbevis, arbetsgivarregister och praktik med de fyra rätten, statistik och dataexport.'],
              ['4', 'KK-redo', 'Kammarkollegiets avtal som konfiguration, kapacitetsvy, statistikexport, yttranden, deltagarinloggning.']].map(([n, t, x]) => html`<div class="card"><div class="card-body stack-sm"><${ui.Badge} tone=${n === '1' ? 'dark' : 'plan'}>Fas ${n}<//><div class="strong">${t}</div><div class="small muted">${x}</div></div></div>`)}
          </div>
          <p class="small muted">Funktioner som byggs efter fas 1 är märkta med en streckad etikett "Byggs i fas 2" osv. i prototypen.</p>
          <div><${ui.Btn} kind="secondary" icon="help" onClick=${() => MM.nav('om.fragor', {})}>Öppna frågor till Botkyrka<//></div>
        <//>
      </div>`;
    },
  });

  // ============================================================ Genomgång av feedback (helsida för mötet)
  MM.registerView('om.feedback', {
    title: 'Genomgång av feedback', roles: 'all',
    component: () => {
      const f = MM.useFb();
      const [persp, setPersp] = useState('alla'); const [status, setStatus] = useState('oppna'); const [group, setGroup] = useState('vy');
      const items = f.items.filter((x) => (persp === 'alla' || x.perspective === persp) && (status === 'alla' || (status === 'oppna' && !['klar', 'avfardad'].includes(x.status)) || x.status === status));
      const byStatus = Object.fromEntries(fb.STATUSES.map((s) => [s.value, f.items.filter((x) => x.status === s.value).length]));
      const keyOf = (x) => (group === 'vy' ? `${x.perspectiveLabel || '–'} · ${x.viewTitle || 'Hela prototypen'}` : group === 'typ' ? fb.typeLabel(x.type) : group === 'prio' ? fb.prioLabel(x.priority) : fb.nameOf(x.authorId));
      const groups = Object.entries(MM.groupBy(items, keyOf)).sort((a, b) => b[1].length - a[1].length);
      return html`<${ui.Page} title="Genomgång av feedback" eyebrow="För mötet" lead="All feedback som lämnats i prototypen, samlad för genomgång. Ändra status allteftersom ni går igenom punkterna – alla med länken ser samma lista."
        actions=${html`<${ui.Btn} kind="secondary" icon="copy" disabled=${!items.length} onClick=${() => MM.copy(fb.asMarkdown(items))}>Kopiera som lista<//><${ui.Btn} kind="primary" icon="edit" onClick=${() => MM.openFeedback()}>Lämna feedback<//>`}>
        <div class="grid-4">
          <${ui.Kpi} label="Totalt" value=${f.items.length} sub=${`${f.items.filter((x) => x.perspective === 'leverantor').length} leverantör · ${f.items.filter((x) => x.perspective === 'kund').length} kund`} />
          <${ui.Kpi} label="Nya" value=${byStatus.ny || 0} sub="Inte gått igenom ännu" tone=${byStatus.ny ? 'watch' : ''} />
          <${ui.Kpi} label="Ska ändras" value=${byStatus.andras || 0} sub=${`${byStatus.diskutera || 0} att diskutera`} />
          <${ui.Kpi} label="Klara" value=${byStatus.klar || 0} sub=${`${byStatus.avfardad || 0} avfärdade`} />
        </div>
        <div class="row">
          <${ui.Field} label="Perspektiv" id="fbg-p"><${ui.Seg} id="fbg-p" value=${persp} onChange=${setPersp} ariaLabel="Perspektiv" options=${[{ value: 'alla', label: 'Alla' }, { value: 'leverantor', label: 'Leverantör' }, { value: 'kund', label: 'Kund' }, { value: 'deltagare', label: 'Deltagare' }]} /><//>
          <${ui.Field} label="Status" id="fbg-s"><${ui.Select} id="fbg-s" value=${status} onChange=${setStatus} options=${[{ value: 'oppna', label: 'Inte klara' }, { value: 'alla', label: 'Alla' }, ...fb.STATUSES]} /><//>
          <${ui.Field} label="Gruppera efter" id="fbg-g"><${ui.Select} id="fbg-g" value=${group} onChange=${setGroup} options=${[{ value: 'vy', label: 'Perspektiv och vy' }, { value: 'typ', label: 'Typ' }, { value: 'prio', label: 'Hur viktigt' }, { value: 'person', label: 'Person' }]} /><//>
        </div>
        ${f.mode === 'local' && html`<${ui.Notice} tone="warn" title="Visar bara feedback från den här webbläsaren">Öppna prototypen via länken i claude.ai för att se den delade listan.<//>`}
        ${items.length === 0 ? html`<${ui.Card}><${ui.Empty} icon="message-circle" title="Ingen feedback att visa">Ändra filtret, eller lämna feedback med knappen Feedback nere till höger.<//><//>`
          : groups.map(([k, list]) => html`<${ui.Section} title=${`${k} (${list.length})`}><div class="stack-sm">${list.map((it) => html`<${FeedbackItem} key=${it.id} it=${it} />`)}</div><//>`)}
      <//>`;
    },
  });

  // ============================================================ Öppna frågor (SPEC §13)
  MM.OPEN_QUESTIONS = [
    [1, 'Inspelning och underbiträden', 'Botkyrka', 'Godkänt 2026-09-29 – ska in skriftligt i PUB-avtalet, inklusive eventuell åtkomst från tredje land', 'done'],
    [2, 'Inköpsordersystem', 'Botkyrka', 'Besvarad: kommunen har inget – Miljonmatch är beställningssystemet', 'done'],
    [3, 'Vilken beställarreferens ska stå på fakturorna – per handläggare, per enhet eller en för hela avtalet? Bekräfta skriftligt att mejlbeställning + beställarreferens + Peppol uppfyller e-handelsbilagan.', 'Botkyrka (e-handel)', 'Öppen – blockerar fakturering', 'blocking'],
    [4, 'Debiterbar vecka', 'Botkyrka', 'Besvarad: alla veckor deltagaren är inskriven. Delvisa start- och slutveckor räknas, pausade veckor räknas inte', 'done'],
    [5, 'En faktura per deltagare och månad, eller skriftligt godkänd samlingsfaktura per beställarreferens?', 'Botkyrka', 'Öppen', 'open'],
    [6, 'Resultatdefinition: vilka anställningar och studier räknas, när mäts det, vilka avslut exkluderas?', 'Botkyrka', 'Öppen – blockerar resultatflaggor', 'blocking'],
    [7, 'Vill kommunen ha frånvaronotis samma dag, utöver veckorapporten?', 'Botkyrka', 'Öppen', 'open'],
    [8, 'Deadline för månads- och slutrapport; räcker portalen som kanal eller krävs e-post?', 'Botkyrka', 'Öppen', 'open'],
    [9, 'Räcker e-postkod som inloggning för kommunens personal? Ska handläggare se hela enhetens ärenden?', 'Botkyrka (IT)', 'Öppen', 'open'],
    [10, 'Vad är den avtalade säkra rutinen för skyddade personuppgifter?', 'Botkyrka', 'Öppen', 'open'],
    [11, 'Gallring under avtalstiden', 'Botkyrka', 'Öppen', 'open'],
    [12, 'Progressionsområden: räcker tillägget språk, eller vill kommunen också följa hälsa och livskvalitet?', 'Botkyrka + MB', 'Öppen', 'open'],
    [13, 'Incitamentsmodell: vilken modell gäller och när kan bonus begäras?', 'Botkyrka + MB', 'Öppen', 'open'],
    [14, 'Beställarrapportens innehåll och frekvens', 'Botkyrka', 'Öppen', 'open'],
    [15, 'Ingår Fortnox Integration och e-faktura i vårt paket? Vem godkänner API-kopplingen?', 'MB ekonomi', 'Öppen', 'open'],
    [16, 'Vem är systemägare och vem administrerar DNS hos one.com?', 'MB', 'Öppen', 'open'],
    [17, 'Ska SLA-statistik visas för kommunen?', 'MB ledning', 'Öppen', 'open'],
    [18, 'Val av SMS- och e-postleverantör', 'MB', 'Öppen', 'open'],
  ];
  MM.registerView('om.fragor', {
    title: 'Öppna frågor', roles: 'all',
    component: () => html`<${ui.Page} title="Öppna frågor" eyebrow="SPEC §13" lead="Frågor som måste besvaras av Botkyrka eller Miljonbemanning. Där prototypen har gjort ett antagande står det i vyn.">
      <${ui.Card} flush>
        <${ui.Table} columns=${[
          { key: 'n', label: '#', render: (r) => html`<span class="strong">${r[0]}</span>`, width: '48px' },
          { key: 'q', label: 'Fråga', render: (r) => r[1] },
          { key: 'who', label: 'Svarar', render: (r) => html`<span class="nowrap">${r[2]}</span>` },
          { key: 's', label: 'Status', render: (r) => html`<${ui.Badge} tone=${r[4] === 'done' ? 'blue' : r[4] === 'blocking' ? 'red' : 'outline'} icon=${r[4] === 'done' ? 'check' : r[4] === 'blocking' ? 'alert' : 'help'}>${r[3]}<//>` },
          { key: 'fb', label: '', render: (r) => html`<button type="button" class="btn btn-ghost" style="min-height:36px" onClick=${() => MM.openFeedback()}><${I} name="message-circle" /><span class="sr-only">Feedback på fråga ${r[0]}</span></button>` },
        ]} rows=${MM.OPEN_QUESTIONS.map((q) => ({ ...q, id: q[0] }))} />
      <//>
    <//>`,
  });
})();
