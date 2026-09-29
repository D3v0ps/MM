// views/inkorg.js – samordnarens och avtalsansvarigs arbetsytor:
//   sam.start      Startsida (SPEC §7.0)
//   sam.inkorg     Avropsinkorg: original bredvid tolkat formulär, ordererkännande, dubblettkontroll, acceptera/avböj (§7.1–7.4)
//   sam.deadlines  Förfaller i dag och denna vecka (§7.13)
// Egna åtgärder har prefixet "ink." och är deterministiska (spelas upp igen vid omladdning).
(() => {
  const { html, useState, useEffect, useMemo, useRef, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel; const cls = MM.cls;
  const S = () => MM.store.state;

  // ------------------------------------------------------------ Layout (bara struktur – färger via profilens tokens)
  const CSS = `
  .ink-md { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  @media (min-width: 1100px) { .ink-md { grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); } }
  .ink-tabs .tab { padding: 10px 12px; gap: 6px; }
  .ink-detail { container-type: inline-size; min-width: 0; scroll-margin-top: 110px; }
  .ink-pair { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  @container (min-width: 720px) { .ink-pair { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); } .ink-pair.even { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
  .ink-row { gap: 10px; }
  .ink-row.is-active { background: var(--bla-ton); box-shadow: inset 4px 0 0 var(--antracit); }
  .ink-row .li-main { gap: 4px; }
  .ink-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0; }
  .ink-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .ink-subj { font-size: 0.9375rem; overflow-wrap: anywhere; }
  .ink-h { font-size: var(--fs-h2); font-weight: 800; overflow-wrap: anywhere; }
  .ink-summary { display: flex; flex-wrap: wrap; align-items: stretch; gap: 0; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--vit); }
  .ink-sum { display: flex; flex-direction: column; gap: 2px; padding: 12px 18px; border-right: 1px solid var(--line); min-width: 0; }
  .ink-sum:last-child { border-right: 0; }
  .ink-sum-n { font-size: 1.5rem; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .ink-sum.grow { flex: 1 1 260px; justify-content: center; }
  @media (max-width: 620px) { .ink-sum { flex: 1 1 45%; border-right: 0; border-bottom: 1px solid var(--line); } .ink-sum.grow { flex-basis: 100%; border-bottom: 0; } }
  .ink-mail { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-sub); border-radius: var(--radius); padding: 12px 14px; margin: 0; font: inherit; line-height: 1.55; }
  .ink-quote { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: 10px 14px; border-left: 3px solid var(--antracit); background: var(--surface-sub); border-radius: 0 var(--radius) var(--radius) 0; }
  .ink-groupt { font-size: var(--fs-label); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; padding: 14px 18px 6px; }
  .ink-fields { container-type: inline-size; }
  @container (min-width: 520px) { .ink-f { grid-template-columns: 190px minmax(0, 1fr) auto; } .ink-fl { grid-column: auto; } }
  .ink-meta { display: grid; gap: 6px; margin: 0; }
  .ink-meta > div { display: flex; flex-wrap: wrap; gap: 0 10px; min-width: 0; }
  .ink-meta dt { font-weight: 600; color: var(--fg-muted); min-width: 72px; }
  .ink-meta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .ink-f { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 8px 18px; border-bottom: 1px solid var(--line); align-items: center; }
  .ink-f:last-child { border-bottom: 0; }
  .ink-fl { grid-column: 1 / -1; font-size: 0.8125rem; font-weight: 600; color: var(--fg-muted); }
  .ink-fv { min-width: 0; overflow-wrap: anywhere; }
  .ink-fc { justify-self: end; }
  .ink-f.is-low { background: var(--surface-sub); }
  .ink-f.is-missing { background: var(--rod-ton); box-shadow: inset 4px 0 0 var(--rod); }
  .ink-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 12px 18px; border-bottom: 1px solid var(--line); font-size: var(--fs-small); color: var(--fg-muted); }
  .ink-fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .ink-fieldset legend { font-weight: 700; font-size: 0.9375rem; padding: 0; margin-bottom: 2px; }
  .ink-radios { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); }
  .ink-radio { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 8px 12px; border: 1.5px solid var(--line-strong); border-radius: var(--radius); cursor: pointer; }
  .ink-radio input { width: 20px; height: 20px; accent-color: var(--antracit); flex: none; margin: 0; }
  .ink-radio.on { border: 2px solid var(--antracit); background: var(--bla-ton); }
  .ink-radio .ink-grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .ink-tile { text-align: left; font: inherit; color: inherit; cursor: pointer; width: 100%; }
  .ink-tile:hover { border-color: var(--antracit); }
  .ink-tile .kpi-sub { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .ink-esc { display: inline-flex; flex-wrap: wrap; gap: 2px 6px; align-items: center; font-size: var(--fs-small); color: var(--fg-muted); }
  .ink-esc b { color: var(--antracit); }
  .ink-mini { display: flex; flex-direction: column; container-type: inline-size; }
  .ink-mini-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "l r" "m r"; gap: 6px 12px; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--line); }
  .ink-mini-row:last-child { border-bottom: 0; }
  .ink-mini-row > .ink-l { grid-area: l; justify-self: start; min-width: 0; }
  .ink-mini-row > .ink-m { grid-area: m; min-width: 0; }
  .ink-mini-row > .ink-r { grid-area: r; }
  .ink-mini-row > .ink-l:empty { display: none; }
  @container (min-width: 560px) { .ink-mini-row { grid-template-columns: 170px minmax(0, 1fr) auto; grid-template-areas: "l m r"; } }
  `;
  try { if (!document.getElementById('ink-css')) { const el = document.createElement('style'); el.id = 'ink-css'; el.textContent = CSS; document.head.appendChild(el); } } catch (e) { /* */ }

  // ------------------------------------------------------------ Hjälpare
  const NUMWORD = { 1: 'en', 2: 'två', 3: 'tre', 4: 'fyra', 5: 'fem', 6: 'sex', 7: 'sju' };
  const slaRule = (key) => MM.cfg().sla.find((s) => s.key === key) || {};
  const answerDays = () => (slaRule('avrop_svar').within || {}).workingDays || 1;
  const answerText = () => { const n = answerDays(); return `${NUMWORD[n] || n} arbetsdag${n === 1 ? '' : 'ar'}`; };
  const ackMinutes = () => (slaRule('ordererkannande').within || {}).minutes || 5;
  const meetingDays = () => (slaRule('forsta_mote').within || {}).days || 7;
  const canOpen = (view, role = MM.role()) => { const v = MM.views[view]; return !!v && (!Array.isArray(v.roles) || v.roles.includes(role)); };
  const go = (link) => { if (link && canOpen(link.view)) MM.nav(link.view, link.params || {}); };
  const when = (s) => {
    if (!s) return '–';
    const day = d.dayOf(s); const t = s.includes('T') ? ` kl. ${d.fmtTime(s)}` : '';
    if (day === d.today()) return `i dag${t}`;
    if (day === d.addDays(d.today(), -1)) return `i går${t}`;
    if (day === d.addDays(d.today(), 1)) return `i morgon${t}`;
    return `${d.WD_SHORT[d.weekday(s)]} ${d.fmtDateShort(s)}${t}`;
  };
  const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} och ${xs[xs.length - 1]}`);
  const customerUser = (id) => S().customerUsers.find((u) => u.id === id) || null;
  const userById = (id) => S().users.find((u) => u.id === id) || null;
  const firstNameOf = (id) => String(MM.personName(id)).split(' ')[0];
  const activeCount = (uid) => S().cases.filter((c) => c.leadCoachId === uid && ['confirmed', 'active', 'paused'].includes(c.status)).length;
  const isProtected = (c) => !!(c && (sel.person(c) || {}).protectedIdentity);
  const pct = (v) => fmt.pct(v, 0);
  const LOW = 0.8; // konfidens under detta markeras

  // ------------------------------------------------------------ Egna åtgärder (prefix ink.)
  /** Acceptera avrop för en person med skyddade personuppgifter: som case.accept men utan kallelse via SMS/e-post till deltagaren. */
  MM.defineAction('ink.acceptProtected', (st, p, ctx) => {
    const before = st.notifications.length;
    const res = MM.actions['case.accept'](st, p, ctx);
    if (!res || res.error) return res;
    const c = st.cases.find((x) => x.id === p.caseId); const pers = c && st.persons.find((x) => x.id === c.personId);
    if (pers && pers.protectedIdentity) {
      for (let i = st.notifications.length - 1; i >= before; i--) { const n = st.notifications[i]; if (n.template === 'kallelse' && n.caseId === p.caseId) st.notifications.splice(i, 1); }
      ctx.audit('notify.suppressed', 'case', p.caseId, { reason: 'Skyddade personuppgifter – ingen kallelse via SMS eller e-post till deltagaren' });
    }
    return res;
  });
  /** Koppla mejlet med skyddade personuppgifter till ärendet som registrerats efter telefonsamtal. SLA räknas från mejlets mottagning. */
  MM.defineAction('ink.linkPhoneOrder', (st, p, ctx) => {
    const e = st.inboundEmails.find((x) => x.id === p.emailId); const c = st.cases.find((x) => x.id === p.caseId);
    if (!e || !c) return { error: 'not_found' };
    e.caseId = c.id; e.status = 'received'; e.registeredBy = ctx.actorId; e.registeredAt = ctx.now; e.linkedBy = 'registrerat efter telefonsamtal';
    c.referredAt = e.receivedAt; c.sourceEmailId = e.id;
    for (const t of (st.tasks || []).filter((x) => x.emailId === e.id && x.status === 'open')) { t.status = 'done'; t.doneBy = ctx.actorId; t.doneAt = ctx.now; }
    ctx.audit('email.registered_by_phone', 'inbound_email', e.id, { caseId: c.id });
    return {};
  });
  /** Samordnaren rättar eller bekräftar tolkade beställningsuppgifter. p = { caseId, emailId?, patch, checked: [fält] } */
  MM.defineAction('ink.correct', (st, p, ctx) => {
    const c = st.cases.find((x) => x.id === p.caseId); if (!c) return { error: 'not_found' };
    const cfg = st.contracts.find((x) => x.id === c.contractId).config;
    const patch = p.patch || {};
    if (patch.buyerReference && !new RegExp(cfg.billing.buyerReference.pattern).test(patch.buyerReference)) return { error: 'buyer_ref' };
    const e = p.emailId ? st.inboundEmails.find((x) => x.id === p.emailId) : null;
    const changed = [];
    for (const k of MM.uniq([...Object.keys(patch), ...(p.checked || [])])) {
      const has = Object.prototype.hasOwnProperty.call(patch, k);
      const v = has ? patch[k] : c[k];
      const was = c[k] == null ? '' : String(c[k]);
      const isChange = has && was !== String(v == null ? '' : v);
      if (isChange) { c[k] = v === '' ? null : v; changed.push(k); if (k === 'plannedWeeks') c.orderValueWeeks = v; }
      if (e) {
        e.corrections = e.corrections || {};
        const prevEx = e.extracted[k];
        if (isChange || e.extracted[k] == null || e.extracted[k] === '') e.extracted[k] = v == null ? '' : v;
        e.confidence[k] = 1;
        e.corrections[k] = { by: ctx.actorId, at: ctx.now, changed: isChange || String(prevEx == null ? '' : prevEx) !== String(v == null ? '' : v), from: prevEx == null ? '' : prevEx };
        if (v != null && v !== '') e.missingFields = (e.missingFields || []).filter((f) => f !== k);
      }
    }
    ctx.audit('case.order_details_corrected', 'case', c.id, { fields: changed, checked: p.checked || [], emailId: p.emailId || null });
    return { changed };
  });
  /** Uppgift klar (st.tasks). */
  MM.defineAction('ink.taskDone', (st, p, ctx) => {
    const t = (st.tasks || []).find((x) => x.id === p.taskId); if (!t) return { error: 'not_found' };
    t.status = 'done'; t.doneBy = ctx.actorId; t.doneAt = ctx.now;
    ctx.audit('task.done', 'task', t.id, {});
    return {};
  });

  // ------------------------------------------------------------ Inkorgens poster (mejl + beställningar via portal/telefon)
  const PENDING = ['acknowledged', 'protected', 'other', 'linked', 'received'];
  const METHOD = {
    template: { label: 'Word-mall', icon: 'file', help: 'Word-mallen (01) tolkas utan AI, via de fasta etiketterna i tabellcellerna. Samma resultat varje gång.' },
    ai: { label: 'AI – fritext', icon: 'sparkles', help: 'Fritext och avvikande mallar tolkas med AI. AI föreslår – samordnaren kontrollerar mot originalet.' },
    manual: { label: 'Ingen tolkning', icon: 'lock', help: 'Ingen automatisk tolkning. Hanteras enligt den säkra rutinen.' },
    portal: { label: 'Portalen', icon: 'globe', help: 'Handläggaren fyllde i beställningen själv. Fälten validerades direkt i formuläret.' },
    phone: { label: 'Telefon', icon: 'phone', help: 'Registrerad efter telefonsamtal enligt den säkra rutinen.' },
  };
  const CLASSIFICATION = { order: 'Beställning', supplement: 'Komplettering', order_protected: 'Skyddade personuppgifter', other: 'Övrigt' };
  const CLASS_ICON = { supplement: 'link', other: 'message-circle' };
  const STATUS = {
    acknowledged: ['Väntar på beslut', 'outline', 'clock'], received: ['Väntar på beslut', 'outline', 'clock'], protected: ['Säker rutin', 'red', 'lock'],
    linked: ['Att föra in', 'outline', 'link'], other: ['Att besvara', 'outline', 'message'], accepted: ['Accepterad', 'blue', 'check'],
    declined: ['Avböjd', 'dark', 'x-circle'], applied: ['Införd i ärendet', 'bluetone', 'check'], handled: ['Hanterad', 'bluetone', 'check'],
  };

  const itemSla = (it) => {
    const c = it.case;
    if (it.cls === 'other') return null;
    if (it.cls === 'supplement') return c ? { dueAt: sel.avropDue(c), metAt: c.confirmedAt || c.declinedAt || null } : null;
    return { dueAt: d.addWorkingDays(it.receivedAt, answerDays()), metAt: c ? (c.confirmedAt || c.declinedAt || null) : null };
  };
  const buildItems = (st) => {
    const items = st.inboundEmails.map((e) => {
      const c = e.caseId ? sel.caseById(e.caseId) : null;
      return { id: e.id, kind: 'email', email: e, case: c, receivedAt: e.receivedAt, from: e.fromName, subject: e.subject, method: e.parseMethod, cls: e.classification, status: e.status, pending: PENDING.includes(e.status), handledAt: e.handledAt || null };
    });
    const withEmail = new Set(st.inboundEmails.map((e) => e.caseId).filter(Boolean));
    for (const c of st.cases) {
      if (withEmail.has(c.id) || c.source === 'email') continue;
      const open = ['acknowledged', 'received'].includes(c.status);
      if (!open && !c.createdInDemo) continue;
      const phone = c.source === 'phone';
      items.push({ id: `case:${c.id}`, kind: 'case', email: null, case: c, receivedAt: c.referredAt, from: MM.personName(c.referrerId), subject: phone ? 'Beställning per telefon' : 'Beställning i portalen',
        method: phone ? 'phone' : 'portal', cls: 'order', status: open ? c.status : c.status === 'declined' ? 'declined' : 'accepted', pending: open, handledAt: c.confirmedAt || c.declinedAt || null });
    }
    for (const it of items) it.sla = itemSla(it);
    return items;
  };
  const sortPending = (a, b) => {
    const ad = a.sla ? a.sla.dueAt : '9999'; const bd = b.sla ? b.sla.dueAt : '9999';
    return ad < bd ? -1 : ad > bd ? 1 : a.receivedAt < b.receivedAt ? -1 : 1;
  };
  const ackFor = (it) => {
    const st = S(); const e = it.email;
    if (e && e.classification === 'order_protected') return st.notifications.find((n) => n.template === 'generisk_mottagningsbekraftelse' && n.to === e.fromAddress && n.at >= e.receivedAt) || null;
    if (it.case && ['order'].includes(it.cls)) return st.notifications.find((n) => n.caseId === it.case.id && n.template === 'ordererkannande') || null;
    return null;
  };

  // ------------------------------------------------------------ Fält i det tolkade formuläret
  const FIELD_LABEL = {
    referrerName: 'Handläggare', referrerUnit: 'Enhet', referrerPhone: 'Handläggarens telefon', referrerEmail: 'Handläggarens e-post',
    buyerReference: 'Beställarreferens', desiredStart: 'Önskat startdatum', plannedEnd: 'Planerat slutdatum', plannedWeeks: 'Planerad omfattning',
    firstName: 'Förnamn', lastName: 'Efternamn', pnr: 'Personnummer', phone: 'Telefon', email: 'E-post', city: 'Bostadsort',
    preferredContact: 'Föredragen kontaktväg', protectedIdentity: 'Skyddade personuppgifter', accessibilityNeeds: 'Behov av anpassning',
    primaryArea: 'Avtalsområde (primärt)', secondaryArea: 'Avtalsområde (alternativt)', vocationalTrack: 'Önskat yrkesspår', background: 'Bakgrund',
  };
  const FIELD_GROUPS = [
    ['1. Beställning och kontakt', ['referrerName', 'referrerUnit', 'referrerPhone', 'referrerEmail', 'buyerReference', 'desiredStart', 'plannedEnd', 'plannedWeeks']],
    ['2. Deltagare', ['firstName', 'lastName', 'pnr', 'phone', 'email', 'city', 'preferredContact', 'protectedIdentity', 'accessibilityNeeds']],
    ['3. Avtalsområde och yrkesspår', ['primaryArea', 'secondaryArea', 'vocationalTrack', 'background']],
  ];
  const ORDER_FIELDS = ['buyerReference', 'desiredStart', 'plannedEnd', 'plannedWeeks', 'primaryArea', 'secondaryArea', 'vocationalTrack'];
  const fmtField = (k, v, c) => {
    if (v == null || v === '') return null;
    if (['desiredStart', 'plannedEnd'].includes(k)) return d.fmtDate(v);
    if (k === 'plannedWeeks') return `${v} veckor`;
    if (['primaryArea', 'secondaryArea'].includes(k)) return sel.areaName(v);
    if (k === 'preferredContact') return sel.contactLabel(v);
    if (k === 'protectedIdentity') return v ? 'Ja' : 'Nej';
    if (k === 'pnr') return c ? html`<${ui.MaskedPnr} caseId=${c.id} />` : '••••••••-••••';
    return String(v);
  };
  const FieldRow = ({ label, value, state, note }) => html`<div class=${cls('ink-f', state === 'missing' && 'is-missing', state === 'low' && 'is-low')}>
    <div class="ink-fl">${label}</div>
    <div class="ink-fv">${value != null ? value : state === 'missing' ? html`<span class="strong">Saknas</span>` : html`<span class="muted">Framgår inte</span>`}</div>
    <div class="ink-fc">${note}</div>
  </div>`;

  const maskPnr = (text) => String(text || '').replace(/\b((?:19|20)\d{6}|\d{6})([-+])(\d{4})\b/g, (m, a, sep, b) => `${'•'.repeat(a.length)}${sep}${b}`);
  const hasPnr = (text) => /\b((?:19|20)\d{6}|\d{6})[-+]\d{4}\b/.test(String(text || ''));

  // ------------------------------------------------------------ Kort i detaljvyn
  const OriginalCard = ({ e, c }) => {
    const [reveal, setReveal] = useState(false);
    const pnrInText = hasPnr(e.bodyText);
    const mayReveal = !c || sel.access(c) === 'full';
    return html`<${ui.Card} title="Originalmejlet" icon="mail">
      <div class="stack">
        <dl class="ink-meta">${[['Från', `${e.fromName} <${e.fromAddress}>`], ['Till', 'avrop@miljonbemanning.se'], ['Mottaget', d.fmtDateTimeLong(e.receivedAt)], ['Ämne', e.subject]].map(([k, v]) => html`<div key=${k}><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
        <pre class="ink-mail">${reveal ? e.bodyText : maskPnr(e.bodyText)}</pre>
        ${pnrInText && html`<div class="row-sm small muted"><${I} name="eye-off" /><span>Personnummer i mejltexten visas maskerat.</span>
          ${!reveal && mayReveal && html`<button type="button" class="btn btn-ghost" style="min-height:36px;padding:4px 8px" onClick=${() => { setReveal(true); MM.dispatch('audit.view', { action: 'pnr.revealed', entity: 'inbound_email', entityId: e.id, details: { caseId: c ? c.id : null } }, { silent: true }); }}><${I} name="eye" />Visa</button>`}
          ${reveal && html`<span>(visning loggad)</span>`}</div>`}
        ${(e.attachments || []).length > 0 ? html`<div class="stack-sm" style="gap:6px"><div class="label-caps">Bilagor</div><div class="row-sm">${e.attachments.map((a) => html`<${ui.Badge} tone="outline" icon="paperclip">${a.name}<//>`)}</div></div>`
          : html`<div class="small muted">Inga bilagor.</div>`}
      </div>
    <//>`;
  };

  const ParsedCard = ({ e, c }) => {
    const ex = e.extracted || {}; const conf = e.confidence || {}; const missing = e.missingFields || []; const corr = e.corrections || {};
    const st = S();
    const applied = c ? st.inboundEmails.filter((x) => x.caseId === c.id && x.classification === 'supplement' && x.status === 'applied') : [];
    const fromSup = (k) => applied.find((x) => x.extracted && x.extracted[k] != null && x.extracted[k] !== '');
    const stateOf = (k) => {
      const v = ex[k]; const empty = v == null || v === '';
      if (missing.includes(k) && empty) return 'missing';
      if (corr[k] || fromSup(k)) return 'ok';
      if (!empty && conf[k] != null && conf[k] < LOW) return 'low';
      return 'ok';
    };
    const all = FIELD_GROUPS.flatMap(([, ks]) => ks);
    const nMissing = all.filter((k) => stateOf(k) === 'missing').length; const nLow = all.filter((k) => stateOf(k) === 'low').length;
    const run = e.aiRunId ? (st.aiRuns || []).find((r) => r.id === e.aiRunId) : null;
    const note = (k) => {
      const s = stateOf(k);
      if (s === 'missing') return html`<${ui.Badge} tone="red" icon="alert">Saknas<//>`;
      if (corr[k]) return html`<${ui.Badge} tone="bluetone" icon="check" title=${`${MM.personName(corr[k].by)} ${when(corr[k].at)}`}>${corr[k].changed ? 'Rättad' : 'Kontrollerad'}<//>`;
      const sup = fromSup(k); if (sup) return html`<${ui.Badge} tone="bluetone" icon="link" title=${`Införd ${when(sup.handledAt)}`}>Från komplettering<//>`;
      if (s === 'low') return html`<${ui.Badge} tone="grey" icon="alert-circle">Osäker ${pct(conf[k])}<//>`;
      return conf[k] != null && ex[k] !== '' && ex[k] != null ? html`<span class="small muted">${pct(conf[k])}</span>` : null;
    };
    const head = e.parseMethod === 'ai' ? html`<${ui.AiTag}>Tolkat med AI<//>` : html`<${ui.Badge} tone="outline" icon="file">Word-mall · utan AI<//>`;
    return html`<${ui.Card} title="Tolkat formulär" icon="clipboard" actions=${head} flush>
      <div class="ink-legend">
        <span>${METHOD[e.parseMethod] ? METHOD[e.parseMethod].help : ''}</span>
        <span class="row-sm"><${I} name="alert" /><b>${nMissing}</b> saknas</span>
        <span class="row-sm"><${I} name="alert-circle" /><b>${nLow}</b> osäkra (under ${pct(LOW)})</span>
        ${run && html`<span>Tolkat av ${run.provider} på ${Math.max(1, Math.round((run.latencyMs || 0) / 1000))} s.</span>`}
      </div>
      <div class="ink-fields">${FIELD_GROUPS.map(([title, keys]) => html`<div><div class="ink-groupt">${title}</div>
        ${keys.map((k) => html`<${FieldRow} key=${k} label=${FIELD_LABEL[k]} value=${fmtField(k, ex[k], c)} state=${stateOf(k)} note=${note(k)} />`)}</div>`)}</div>
    <//>`;
  };

  /** Beställning utan mejl (portal eller telefon) – samma tre steg som mallen, utan konfidens. */
  const CaseFieldsCard = ({ c, title = 'Beställningen' }) => {
    MM.useStore();
    const a = sel.access(c); const p = sel.person(c) || {}; const k = customerUser(c.referrerId) || {};
    const full = ['full', 'team'].includes(a) && !p.protectedIdentity;
    const groups = [
      ['1. Beställning och kontakt', [['Handläggare', k.name || null], ['Enhet', k.unit || null], ['Beställarreferens', c.buyerReference || null, !c.buyerReference && 'missing'],
        ['Önskat startdatum', c.desiredStart ? d.fmtDate(c.desiredStart) : null], ['Planerat slutdatum', c.plannedEnd ? d.fmtDate(c.plannedEnd) : null], ['Planerad omfattning', c.plannedWeeks ? `${c.plannedWeeks} veckor` : null]]],
      ['2. Deltagare', [['Namn', sel.displayName(c)], ['Personnummer', html`<${ui.MaskedPnr} caseId=${c.id} />`],
        ...(full ? [['Telefon', p.phone || null], ['E-post', p.email || null], ['Bostadsort', p.city || null], ['Föredragen kontaktväg', p.preferredContact ? sel.contactLabel(p.preferredContact) : null], ['Behov av anpassning', p.accessibilityNeeds || null]] : []),
        ['Skyddade personuppgifter', p.protectedIdentity ? 'Ja – bara namn och personnummer sparas' : 'Nej']]],
      ['3. Avtalsområde och yrkesspår', [['Avtalsområde (primärt)', c.primaryArea ? sel.areaName(c.primaryArea) : null, !c.primaryArea && 'missing'], ['Avtalsområde (alternativt)', c.secondaryArea ? sel.areaName(c.secondaryArea) : null],
        ['Önskat yrkesspår', c.vocationalTrack || null], ...(full ? [['Bakgrund', c.backgroundInfo || null]] : [])]],
    ];
    const m = METHOD[c.source === 'phone' ? 'phone' : 'portal'];
    return html`<${ui.Card} title=${title} icon="clipboard" actions=${html`<${ui.Badge} tone="outline" icon=${m.icon}>${m.label}<//>`} flush>
      <div class="ink-legend"><span>${m.help}</span></div>
      <div class="ink-fields">${groups.map(([t, rows]) => html`<div><div class="ink-groupt">${t}</div>${rows.map(([label, value, state]) => html`<${FieldRow} key=${label} label=${label} value=${value} state=${state || 'ok'} note=${state === 'missing' ? html`<${ui.Badge} tone="red" icon="alert">Saknas<//>` : null} />`)}</div>`)}</div>
    <//>`;
  };

  const AckCard = ({ it }) => {
    MM.useStore();
    const n = ackFor(it); const c = it.case;
    const kommunSwitch = c && c.referrerId === 'k-maria' ? html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.deltagare" params=${{ caseId: c.id }} label="Se vad kommunen fick" />` : null;
    if (!n) {
      return html`<${ui.Card} title="Automatiskt svar" icon="mail" foot=${kommunSwitch}>
        <p class="muted">${it.cls === 'other' ? 'Inget automatiskt svar. Mejl som klassas som Övrigt lämnas till en människa.' : it.kind === 'case' ? 'Ordererkännandet visades direkt på skärmen för handläggaren.' : 'Inget automatiskt svar hittades.'}</p>
      <//>`;
    }
    const generic = n.template === 'generisk_mottagningsbekraftelse';
    const mins = Math.max(0, d.diffMinutes(it.receivedAt, n.at)); const limit = ackMinutes(); const ok = mins <= limit;
    const pers = c ? sel.person(c) : null;
    const leak = !!(pers && [pers.firstName, pers.lastName, pers.pnr].some((x) => x && String(n.body).includes(x)));
    return html`<${ui.Card} title=${generic ? 'Generisk mottagningsbekräftelse' : 'Ordererkännande'} icon="mail" foot=${kommunSwitch}>
      <div class="stack-sm">
        <div class="row-sm"><${ui.Badge} tone=${ok ? 'blue' : 'red'} icon=${ok ? 'check' : 'alert'}>${ok ? `Skickat automatiskt efter ${mins} min` : `Sent – ${mins} min`}<//>
          <span class="small muted">${when(n.at)} · krav: inom ${limit} minuter</span></div>
        <div class="small muted">Till ${n.to}</div>
        <blockquote class="ink-quote">${n.body}</blockquote>
        ${leak ? html`<${ui.Notice} tone="critical" title="Personuppgifter i utskicket">Texten innehåller namn eller personnummer. Det får aldrig hända – anmäl till systemadministratören.<//>`
          : html`<div class="row-sm small" style="align-items:flex-start;flex-wrap:nowrap"><${I} name="shield" /><span><b>Inga personuppgifter.</b> ${generic ? 'Svaret nämner varken deltagaren eller något ärendenummer, eftersom inget ärende skapas automatiskt.' : 'Svaret innehåller bara ärendenumret. Kommunen uppmanas använda det i stället för personnummer.'}</span></div>`}
      </div>
    <//>`;
  };

  const DuplicateCard = ({ c }) => {
    MM.useStore();
    if (!c) return null;
    const p = sel.person(c);
    const dups = p && p.pnr ? sel.duplicateActive(p.pnr).filter((x) => x.id !== c.id) : [];
    return html`<${ui.Card} title="Dubblettkontroll" icon="users">
      ${dups.length > 0
        ? html`<${ui.Notice} tone="warn" title="Personen har redan en aktiv insats">
            <div class="stack-sm"><span>${dups.map((x) => html`<span class="row-sm"><${ui.CaseLink} caseId=${x.id} /><${ui.CaseStatus} status=${x.status} /></span>`)}</span>
            <span>En person får inte ha två aktiva ärenden samtidigt. Avböj med orsaken dubblett, eller kontakta handläggaren.</span></div><//>`
        : html`<${ui.Notice} tone="ok" title="Ingen annan aktiv insats">Kontrollerat mot personnumret inom avtalet. En person kan ha flera ärenden över tid, men inte två aktiva samtidigt.<//>`}
      <div class="small muted" style="margin-top:10px">Sökningen görs på en krypterad kontrollsumma av personnumret, aldrig i klartext.</div>
    <//>`;
  };

  const ConfirmationCard = ({ c }) => {
    const st = MM.useStore();
    const rep = st.reports.find((r) => r.caseId === c.id && r.kind === 'order_confirmation');
    const hist = st.caseStatusHistory.filter((h) => h.caseId === c.id && h.toStatus === 'confirmed').slice(-1)[0];
    const by = hist ? hist.changedBy : null;
    const notifs = st.userNotifications.filter((n) => n.caseId === c.id && n.kind === 'assignment');
    const leadNotif = notifs.find((n) => n.recipientId === c.leadCoachId);
    const others = notifs.filter((n) => n.recipientId !== c.leadCoachId).map((n) => MM.personName(n.recipientId));
    const custMail = st.notifications.filter((n) => n.caseId === c.id && n.template === 'orderbekraftelse').slice(-1)[0];
    const sms = st.notifications.filter((n) => n.caseId === c.id && n.template === 'kallelse').slice(-1)[0];
    const team = (c.team || []).filter((t) => t.role !== 'lead_coach');
    const weeks = c.orderValueWeeks || c.plannedWeeks; const price = sel.priceFor(c.primaryArea, c.startDate || c.plannedStart || d.today());
    const prot = isProtected(c);
    const coachPid = MM.roleDef('coach').personaId;
    return html`<${ui.Card} tone="blue" title="Orderbekräftelse skickad" icon="check-circle"
        actions=${rep && canOpen('rapport.visa') ? html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('rapport.visa', { reportId: rep.id })}>Öppna<//>` : null}
        foot=${(c.referrerId === 'k-maria' || c.leadCoachId === coachPid) ? html`${c.referrerId === 'k-maria' && html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.deltagare" params=${{ caseId: c.id }} label="Se vad kommunen fick" />`}
          ${c.leadCoachId === coachPid && html`<${ui.PerspectiveSwitch} role="coach" view="notiser" label=${`Se ${firstNameOf(coachPid)}s notis`} />`}` : null}>
      <div class="stack">
        <${ui.Kv} items=${[
          ['Ärendenummer', html`<span class="strong mono">${c.number}</span>`],
          ['Bekräftad', `${when(c.confirmedAt)}${by ? ` av ${MM.personName(by)}` : ''}`],
          ['Huvudcoach', MM.personName(c.leadCoachId)],
          ['Team', team.length ? team.map((t) => `${MM.personName(t.userId)} (${sel.teamLabel(t.role).toLowerCase()})`).join(', ') : 'Bara huvudcoach'],
          ['Första möte', c.firstMeetingAt ? d.fmtDateTimeLong(c.firstMeetingAt) : 'Inte bokat ännu'],
          ['Planerad omfattning', weeks ? `${weeks} veckor${c.plannedEnd ? `, till och med ${d.fmtDate(c.plannedEnd)}` : ''}` : '–'],
          ['Beställningens värde', weeks && price ? `${fmt.kr(weeks * price)} (${weeks} veckor × ${fmt.kr(price)})` : '–'],
          ['Beställarreferens', c.buyerReference || '–'],
        ]} />
        ${leadNotif && html`<${ui.Notice} tone="ok" icon="bell" title=${`${MM.personName(c.leadCoachId)} har fått en notis om tilldelningen`}>
          I appen och som e-post utan personuppgifter: <q>${leadNotif.emailBody}</q>${others.length > 0 ? ` Även ${listJoin(others)} har fått en notis.` : ''}<//>`}
        <div class="stack-sm small">
          ${custMail && html`<div class="row-sm" style="align-items:flex-start;flex-wrap:nowrap"><${I} name="mail" /><span><b>Kommunen fick:</b> ${custMail.body}</span></div>`}
          ${prot ? html`<div class="row-sm" style="align-items:flex-start;flex-wrap:nowrap"><${I} name="lock" /><span><b>Deltagaren:</b> ingen kallelse via SMS eller e-post (skyddade personuppgifter). Coachen ringer enligt den säkra rutinen.</span></div>`
            : sms && html`<div class="row-sm" style="align-items:flex-start;flex-wrap:nowrap"><${I} name="phone" /><span><b>Deltagaren fick kallelse (SMS):</b> ${sms.body}</span></div>`}
        </div>
      </div>
    <//>`;
  };

  const DeclinedCard = ({ c }) => {
    const st = MM.useStore();
    const mail = st.notifications.filter((n) => n.caseId === c.id && n.template === 'avbojt').slice(-1)[0];
    const hist = st.caseStatusHistory.filter((h) => h.caseId === c.id && h.toStatus === 'declined').slice(-1)[0];
    return html`<${ui.Card} tone="red" title="Avropet är avböjt" icon="x-circle">
      <div class="stack">
        <${ui.Kv} items=${[['Avböjt', `${when(c.declinedAt)}${hist ? ` av ${MM.personName(hist.changedBy)}` : ''}`], ['Orsak', c.declineReason || '–']]} />
        ${mail && html`<div class="row-sm small" style="align-items:flex-start;flex-wrap:nowrap"><${I} name="mail" /><span><b>Kommunen fick:</b> ${mail.body}</span></div>`}
        <div class="small muted">Orsaken är loggad och syns för kommunen i portalen. Avböjda avrop följs upp i avtalsuppföljningen.</div>
      </div>
    <//>`;
  };

  // ------------------------------------------------------------ Modaler
  const AcceptModal = ({ c, onClose, onShowEmail }) => {
    const st = MM.useStore();
    const prot = isProtected(c);
    const coaches = sel.coaches().map((u) => ({ id: u.id, name: u.name, active: activeCount(u.id) }));
    const minActive = Math.min(...coaches.map((x) => x.active));
    const helpers = st.users.filter((u) => u.role === 'handledare' && u.active !== false);
    const due = sel.firstMeetingDue(c);
    const pendingSup = st.inboundEmails.find((x) => x.caseId === c.id && x.classification === 'supplement' && x.status === 'linked');
    const [coach, setCoach] = useState('');
    const [team, setTeam] = useState([]);
    const [date, setDate] = useState(d.addWorkingDays(d.today(), 2));
    const [time, setTime] = useState('10:00');
    const [weeks, setWeeks] = useState(c.plannedWeeks ? String(c.plannedWeeks) : '');
    const [ref, setRef] = useState(c.buyerReference || '');
    const [tried, setTried] = useState(false);
    const [refServerErr, setRefServerErr] = useState(null);
    const [done, setDone] = useState(null);

    const w = Number(weeks);
    const errs = {
      coach: !coach ? 'Välj huvudcoach.' : null,
      date: !date ? 'Välj datum för första mötet.' : date < d.today() ? 'Datumet har redan passerat.' : null,
      time: !time ? 'Välj tid för första mötet.' : null,
      weeks: !(Number.isInteger(w) && w >= 1 && w <= 52) ? 'Ange planerad omfattning i hela veckor (1–52).' : null,
    };
    const refErr = refServerErr || ((tried || ref) ? MM.valid.buyerRefError(ref) : null);
    const late = date && date > d.dayOf(due);
    const daysAfter = date ? d.diffDays(c.referredAt, date) : 0;
    const price = sel.priceFor(c.primaryArea, date || d.today());
    const submit = () => {
      setTried(true);
      if (Object.values(errs).some(Boolean)) return;
      const payload = { caseId: c.id, leadCoachId: coach, firstMeetingAt: `${date}T${time}`, plannedWeeks: w, buyerReference: ref.trim(),
        team: team.map((id) => ({ userId: id, role: (userById(id) || {}).teamRole || 'vocational_supervisor' })) };
      const res = MM.dispatch(prot ? 'ink.acceptProtected' : 'case.accept', payload);
      if (!res) return;
      if (res.error === 'buyer_ref') { setRefServerErr(MM.valid.buyerRefError(ref) || 'Beställarreferensen godkändes inte. Den ska vara 8–10 siffror.'); return; }
      if (res.error) { MM.toast('Avropet kunde inte accepteras. Försök igen.', 'red'); return; }
      MM.toast(`${c.number} är accepterat. Orderbekräftelsen är skickad till kommunen.`, 'blue');
      setDone({ reportId: res.reportId });
    };

    if (done) {
      return html`<${ui.Modal} title="Avropet är accepterat" onClose=${onClose} wide
        footer=${html`${c.referrerId === 'k-maria' && html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.deltagare" params=${{ caseId: c.id }} label="Se vad kommunen fick" />`}<${ui.Btn} kind="primary" onClick=${onClose}>Klart<//>`}>
        <${ui.Notice} tone="ok" title=${`Orderbekräftelsen för ${c.number} är publicerad i portalen`}>Kommunen har fått ett mejl utan personuppgifter om att bekräftelsen finns att läsa.<//>
        <${ConfirmationCard} c=${sel.caseById(c.id)} />
      <//>`;
    }

    return html`<${ui.Modal} title=${`Acceptera ${c.number}`} onClose=${onClose} wide
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${submit}>Acceptera avropet<//>`}>
      <div class="row-between"><span class="small muted">Från ${MM.personName(c.referrerId)} · ${sel.areaName(c.primaryArea)} · ${sel.displayName(c)}</span>
        <${ui.SlaBadge} dueAt=${sel.avropDue(c)} prefix="Svar:" /></div>
      ${prot && html`<${ui.Notice} tone="critical" icon="lock" title="Skyddade personuppgifter">Deltagaren får ingen kallelse via SMS eller e-post. Den namngivna coachen ringer enligt den säkra rutinen. Bara coachen och avtalsansvarig ser namn och personnummer.<//>`}
      ${pendingSup && html`<${ui.Notice} tone="info" icon="link" title="Det finns en komplettering att föra in först">${pendingSup.fromName} svarade ${when(pendingSup.receivedAt)} med uppgifter som saknas i avropet.
        ${onShowEmail && html`<div style="margin-top:8px"><${ui.Btn} kind="secondary" icon="arrow-right" onClick=${() => onShowEmail(pendingSup.id)}>Visa kompletteringen<//></div>`}<//>`}

      <fieldset class="ink-fieldset">
        <legend>Huvudcoach<span aria-hidden="true" style="color:var(--rod);margin-left:2px">*</span><span class="sr-only">(obligatoriskt)</span></legend>
        <div class="help">Samma coach genom hela insatsen. Antal aktiva ärenden visas för att fördela jämnt.</div>
        <div class="ink-radios">
          ${coaches.map((u) => html`<label key=${u.id} class=${cls('ink-radio', coach === u.id && 'on')}>
            <input type="radio" name="ink-coach" id=${`ink-coach-${u.id}`} value=${u.id} checked=${coach === u.id} onChange=${() => setCoach(u.id)} />
            <span class="ink-grow"><span class="strong">${u.name}</span><span class="small muted">${u.active} aktiva ärenden</span></span>
            ${u.active === minActive && html`<${ui.Badge} tone="bluetone">Lägst<//>`}
          </label>`)}
        </div>
        ${tried && errs.coach && html`<div class="error-text" role="alert"><${I} name="alert-circle" />${errs.coach}</div>`}
        <div class="row-sm small muted"><${ui.BuildPhase} fas=${4} /><span>Kapacitetstak per coach (aktiva ärenden mot tak).</span></div>
      </fieldset>

      <fieldset class="ink-fieldset">
        <legend>Team (valfritt)</legend>
        <div class="help">Handledare, arbetsgivarmatchare och SYV. De får också en notis om tilldelningen.</div>
        ${helpers.map((u) => html`<${ui.Check} key=${u.id} id=${`ink-team-${u.id}`} checked=${team.includes(u.id)} onChange=${(on) => setTeam(on ? [...team, u.id] : team.filter((x) => x !== u.id))}>${u.name} – ${sel.teamLabel(u.teamRole).toLowerCase()}<//>`)}
      </fieldset>

      <div class="form-grid">
        <${ui.Field} id="ink-fm-date" label="Första möte – datum" required help=${`Ska vara inom en vecka från avropet: senast ${d.fmtWeekday(due)}.${c.desiredStart ? ` Kommunen önskar start ${d.fmtDate(c.desiredStart)}.` : ''}`} error=${tried ? errs.date : null}>
          <${ui.Input} id="ink-fm-date" type="date" value=${date} onInput=${setDate} invalid=${tried && !!errs.date} /><//>
        <${ui.Field} id="ink-fm-time" label="Första möte – tid" required help="Mötet hålls i Alby om inget annat bokas." error=${tried ? errs.time : null}>
          <${ui.Input} id="ink-fm-time" type="time" value=${time} onInput=${setTime} invalid=${tried && !!errs.time} /><//>
        ${late && html`<div class="full"><${ui.Notice} tone="warn" title=${`Mötet ligger ${daysAfter} dagar efter avropet`}>Avtalet kräver att första mötet sker inom ${meetingDays()} dagar (senast ${d.fmtDate(due)}). Ärendet markeras i uppföljningen av nyckeltalet Första möte inom en vecka.<//></div>`}
        ${date && !d.isWorkingDay(date) && html`<div class="full"><${ui.Notice} tone="warn" title="Inte en arbetsdag">${d.fmtWeekday(date)} är ${d.holidayName(date) ? d.holidayName(date).toLowerCase() : 'en helgdag'}. Välj en vardag.<//></div>`}
        <${ui.Field} id="ink-weeks" label="Planerad omfattning (veckor)" required help=${price && w > 0 ? `Beställningens värde: ${w} veckor × ${fmt.kr(price)} = ${fmt.kr(w * price)} (exempelpris i prototypen).` : 'Används för orderns värde och för upparbetat och återstående belopp på fakturan.'} error=${tried ? errs.weeks : null}>
          <${ui.Input} id="ink-weeks" type="number" inputMode="numeric" value=${weeks} onInput=${setWeeks} invalid=${tried && !!errs.weeks} /><//>
        <${ui.Field} id="ink-ref" label="Beställarreferens" required help=${c.buyerReference ? 'Från avropet. 8–10 siffror, bara siffror. Krävs för att fakturan ska godkännas.' : 'Kommunen har inte angett någon. Ordererkännandet bad om den. Utan giltig referens kan ärendet inte bekräftas.'} error=${refErr}>
          <${ui.Input} id="ink-ref" value=${ref} inputMode="numeric" maxLength=${12} onInput=${(v) => { setRef(v); setRefServerErr(null); }} invalid=${!!refErr} /><//>
      </div>

      <div class="demo-note"><${I} name="bell" /><div><b>Det här händer när du accepterar:</b> orderbekräftelsen publiceras i portalen och kommunen får ett mejl utan personuppgifter. Huvudcoachen och teamet får automatiskt en notis i appen och via e-post (bara ärendenummer). ${prot ? 'Ingen kallelse skickas till deltagaren.' : 'Deltagaren får kallelse via sin föredragna kontaktväg.'}</div></div>
    <//>`;
  };

  const DECLINE_REASONS = ['Vi har inte kapacitet under önskad period', 'Avtalsområdet kan inte erbjudas just nu', 'Deltagaren har redan en aktiv insats hos oss', 'Beställningen ligger utanför avtalets omfattning', 'Annat skäl'];
  const DeclineModal = ({ c, onClose }) => {
    const st = MM.useStore();
    const [reason, setReason] = useState(''); const [text, setText] = useState(''); const [tried, setTried] = useState(false);
    const declined = st.cases.filter((x) => x.status === 'declined').length; const total = st.cases.filter((x) => x.contractId === c.contractId).length;
    const errs = { reason: !reason ? 'Välj en orsak.' : null, text: reason === 'Annat skäl' && !text.trim() ? 'Beskriv orsaken.' : null };
    const submit = () => {
      setTried(true); if (errs.reason || errs.text) return;
      const full = text.trim() ? `${reason}: ${text.trim()}` : reason;
      const res = MM.dispatch('case.decline', { caseId: c.id, reason: full });
      if (!res || res.error) { MM.toast('Avropet kunde inte avböjas.', 'red'); return; }
      MM.toast(`${c.number} är avböjt. Kommunen har fått besked.`, 'blue'); onClose();
    };
    return html`<${ui.Modal} title=${`Avböj ${c.number}`} onClose=${onClose}
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="danger" icon="x-circle" onClick=${submit}>Avböj avropet<//>`}>
      <${ui.Notice} tone="warn" title="Avböj bara om vi verkligen inte kan ta uppdraget">Obesvarade och ofta avböjda avrop kan flytta ned Miljonbemanning i kommunens rangordning. Hittills i avtalet: ${declined} av ${total} avrop avböjda.<//>
      <${ui.Field} id="ink-decline-reason" label="Orsak" required help="Orsaken loggas och syns för kommunen i portalen." error=${tried ? errs.reason : null}>
        <${ui.Select} id="ink-decline-reason" value=${reason} onChange=${setReason} placeholder="Välj orsak" options=${DECLINE_REASONS.map((r) => ({ value: r, label: r }))} invalid=${tried && !!errs.reason} /><//>
      <${ui.Field} id="ink-decline-text" label=${reason === 'Annat skäl' ? 'Beskrivning' : 'Beskrivning (valfritt)'} required=${reason === 'Annat skäl'} help="Skriv kort och sakligt. Inga uppgifter om deltagarens hälsa eller andra känsliga uppgifter." error=${tried ? errs.text : null}>
        <${ui.TextArea} id="ink-decline-text" value=${text} onInput=${setText} rows=${3} maxLength=${400} invalid=${tried && !!errs.text} /><//>
      <div class="small muted">Kommunen får ett mejl utan personuppgifter: <q>Vi kan tyvärr inte ta emot beställning ${c.number}. Logga in i portalen för att läsa orsaken.</q></div>
    <//>`;
  };

  const CorrectModal = ({ c, e, onClose }) => {
    MM.useStore();
    const ex = e ? e.extracted || {} : {}; const conf = e ? e.confidence || {} : {};
    const init = () => ({ buyerReference: c.buyerReference || '', desiredStart: c.desiredStart || '', plannedEnd: c.plannedEnd || ex.plannedEnd || '', plannedWeeks: c.plannedWeeks ? String(c.plannedWeeks) : '',
      primaryArea: c.primaryArea || '', secondaryArea: c.secondaryArea || '', vocationalTrack: c.vocationalTrack || '' });
    const [v, setV] = useState(init); const [tried, setTried] = useState(false);
    const set = (k) => (val) => setV({ ...v, [k]: val });
    const areas = S().areas.filter((a) => a.contractId === c.contractId && a.active).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }));
    const lowNote = (k) => (e && conf[k] != null && conf[k] < LOW && ex[k] !== '' && ex[k] != null ? ` AI var osäker (${pct(conf[k])}) – kontrollera mot originalet.` : '');
    const w = Number(v.plannedWeeks);
    const errs = {
      buyerReference: v.buyerReference ? MM.valid.buyerRefError(v.buyerReference) : null,
      plannedWeeks: v.plannedWeeks && !(Number.isInteger(w) && w >= 1 && w <= 52) ? 'Ange hela veckor (1–52).' : null,
      primaryArea: !v.primaryArea ? 'Välj avtalsområde.' : null,
      plannedEnd: v.plannedEnd && v.desiredStart && v.plannedEnd < v.desiredStart ? 'Slutdatum kan inte vara före startdatum.' : null,
    };
    const save = () => {
      setTried(true); if (Object.values(errs).some(Boolean)) return;
      const next = { ...v, plannedWeeks: v.plannedWeeks ? w : null, secondaryArea: v.secondaryArea || null };
      const patch = {}; for (const k of ORDER_FIELDS) { const cur = c[k] == null ? '' : String(c[k]); const nv = next[k] == null ? '' : String(next[k]); if (cur !== nv) patch[k] = next[k]; }
      const checked = ORDER_FIELDS.filter((k) => next[k] != null && next[k] !== '');
      const res = MM.dispatch('ink.correct', { caseId: c.id, emailId: e ? e.id : null, patch, checked });
      if (!res || res.error) { MM.toast('Uppgifterna kunde inte sparas.', 'red'); return; }
      const start = init(); const edited = ORDER_FIELDS.filter((k) => String(start[k] == null ? '' : start[k]) !== String(v[k] == null ? '' : v[k]));
      MM.toast(edited.length ? `Rättat: ${edited.map((k) => FIELD_LABEL[k].toLowerCase()).join(', ')}. Ändringen är loggad.` : 'Uppgifterna är markerade som kontrollerade. Kontrollen är loggad.', 'blue');
      onClose();
    };
    return html`<${ui.Modal} title="Rätta beställningsuppgifter" onClose=${onClose} wide
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${save}>Spara och markera som kontrollerat<//>`}>
      <p class="muted">Jämför med originalmejlet. Det du sparar markeras som kontrollerat av dig och loggas. Uppgifter om deltagaren rättas i deltagarkortet.</p>
      <div class="form-grid">
        <${ui.Field} id="ink-c-ref" label="Beställarreferens" help=${`8–10 siffror, bara siffror.${lowNote('buyerReference')}`} error=${tried ? errs.buyerReference : null}>
          <${ui.Input} id="ink-c-ref" value=${v.buyerReference} inputMode="numeric" maxLength=${12} onInput=${set('buyerReference')} invalid=${tried && !!errs.buyerReference} /><//>
        <${ui.Field} id="ink-c-weeks" label="Planerad omfattning (veckor)" help=${`Hela veckor.${lowNote('plannedWeeks')}`} error=${tried ? errs.plannedWeeks : null}>
          <${ui.Input} id="ink-c-weeks" type="number" inputMode="numeric" value=${v.plannedWeeks} onInput=${set('plannedWeeks')} invalid=${tried && !!errs.plannedWeeks} /><//>
        <${ui.Field} id="ink-c-start" label="Önskat startdatum" help=${`Kommunens önskemål.${lowNote('desiredStart')}`}>
          <${ui.Input} id="ink-c-start" type="date" value=${v.desiredStart} onInput=${set('desiredStart')} /><//>
        <${ui.Field} id="ink-c-end" label="Planerat slutdatum" help=${`Om kommunen angett det.${lowNote('plannedEnd')}`} error=${tried ? errs.plannedEnd : null}>
          <${ui.Input} id="ink-c-end" type="date" value=${v.plannedEnd} onInput=${set('plannedEnd')} invalid=${tried && !!errs.plannedEnd} /><//>
        <${ui.Field} id="ink-c-area" label="Avtalsområde (primärt)" required help=${`Styr pris och yrkesspår.${lowNote('primaryArea')}`} error=${tried ? errs.primaryArea : null}>
          <${ui.Select} id="ink-c-area" value=${v.primaryArea} onChange=${set('primaryArea')} placeholder="Välj område" options=${areas} invalid=${tried && !!errs.primaryArea} /><//>
        <${ui.Field} id="ink-c-area2" label="Avtalsområde (alternativt)" help="Om det primära inte fungerar.">
          <${ui.Select} id="ink-c-area2" value=${v.secondaryArea} onChange=${set('secondaryArea')} placeholder="Inget" options=${areas} /><//>
        <${ui.Field} id="ink-c-track" label="Önskat yrkesspår" help="Kan ändras efter kartläggningen." full>
          <${ui.Input} id="ink-c-track" value=${v.vocationalTrack} onInput=${set('vocationalTrack')} /><//>
      </div>
    <//>`;
  };

  const PhoneModal = ({ e, onClose }) => {
    const st = MM.useStore();
    const k = st.customerUsers.find((u) => u.email === e.fromAddress) || customerUser('k-omar') || {};
    const br = st.buyerReferences.find((b) => b.id === k.buyerReferenceId && b.active);
    const [v, setV] = useState({ firstName: '', lastName: '', pnr: '', buyerReference: br ? br.reference : '', primaryArea: '', plannedWeeks: '', confirmed: false });
    const [tried, setTried] = useState(false);
    const set = (key) => (val) => setV({ ...v, [key]: val });
    const areas = st.areas.filter((a) => a.contractId === 'c-bot' && a.active).map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }));
    const pnrOk = MM.valid.pnrFormat(v.pnr);
    const dups = pnrOk ? sel.duplicateActive(v.pnr) : [];
    const w = Number(v.plannedWeeks);
    const errs = {
      firstName: !v.firstName.trim() ? 'Skriv förnamnet.' : null, lastName: !v.lastName.trim() ? 'Skriv efternamnet.' : null,
      pnr: !v.pnr.trim() ? 'Skriv personnummer eller samordningsnummer.' : !pnrOk ? 'Skriv som ÅÅÅÅMMDD-NNNN.' : dups.length ? 'Personen har redan en aktiv insats. Två aktiva ärenden samtidigt är inte tillåtet.' : null,
      buyerReference: MM.valid.buyerRefError(v.buyerReference), primaryArea: !v.primaryArea ? 'Välj avtalsområde.' : null,
      plannedWeeks: !(Number.isInteger(w) && w >= 1 && w <= 52) ? 'Ange hela veckor (1–52).' : null, confirmed: !v.confirmed ? 'Bekräfta att uppgifterna togs per telefon.' : null,
    };
    const submit = () => {
      setTried(true); if (Object.values(errs).some(Boolean)) return;
      const res = MM.dispatch('case.create', { protectedIdentity: true, source: 'phone', referrerId: k.id || 'k-omar', firstName: v.firstName.trim(), lastName: v.lastName.trim(), pnr: v.pnr.trim(),
        buyerReference: v.buyerReference.trim(), primaryArea: v.primaryArea, plannedWeeks: w });
      if (!res || res.error) { MM.toast('Ärendet kunde inte registreras.', 'red'); return; }
      MM.dispatch('ink.linkPhoneOrder', { emailId: e.id, caseId: res.caseId });
      MM.toast(`${res.number} är registrerat med skyddade personuppgifter. Acceptera och tilldela en namngiven coach.`, 'blue');
      onClose();
    };
    const E = (key) => (tried ? errs[key] : null);
    return html`<${ui.Modal} title="Registrera efter telefonsamtal" onClose=${onClose} wide
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="lock" onClick=${submit}>Registrera ärendet<//>`}>
      <${ui.Notice} tone="critical" icon="lock" title="Spara bara det som behövs">Namn, personnummer och handläggare. Ingen adress, telefon eller e-post till deltagaren. Ingen AI och inga automatiska utskick till deltagaren.<//>
      <p>Ring ${k.name || 'handläggaren'} på <b>${k.phone || '–'}</b> och fyll i uppgifterna under samtalet.</p>
      <div class="form-grid">
        <${ui.Field} id="ink-p-first" label="Förnamn" required help="Som i folkbokföringen." error=${E('firstName')}><${ui.Input} id="ink-p-first" value=${v.firstName} onInput=${set('firstName')} autoComplete="off" invalid=${!!E('firstName')} /><//>
        <${ui.Field} id="ink-p-last" label="Efternamn" required help="Som i folkbokföringen." error=${E('lastName')}><${ui.Input} id="ink-p-last" value=${v.lastName} onInput=${set('lastName')} invalid=${!!E('lastName')} /><//>
        <${ui.Field} id="ink-p-pnr" label="Personnummer" required help="ÅÅÅÅMMDD-NNNN. Kontrolleras mot aktiva ärenden i avtalet." error=${E('pnr') || (dups.length ? errs.pnr : null)}>
          <${ui.Input} id="ink-p-pnr" value=${v.pnr} onInput=${set('pnr')} inputMode="numeric" maxLength=${13} invalid=${!!E('pnr')} /><//>
        <${ui.Field} id="ink-p-ref" label="Beställarreferens" required help=${br ? `${k.unit} har referensen ${br.reference}. Stäm av i samtalet.` : '8–10 siffror, bara siffror.'} error=${E('buyerReference')}>
          <${ui.Input} id="ink-p-ref" value=${v.buyerReference} onInput=${set('buyerReference')} inputMode="numeric" maxLength=${12} invalid=${!!E('buyerReference')} /><//>
        <${ui.Field} id="ink-p-area" label="Avtalsområde (primärt)" required help="Enligt handläggarens önskemål." error=${E('primaryArea')}>
          <${ui.Select} id="ink-p-area" value=${v.primaryArea} onChange=${set('primaryArea')} placeholder="Välj område" options=${areas} invalid=${!!E('primaryArea')} /><//>
        <${ui.Field} id="ink-p-weeks" label="Planerad omfattning (veckor)" required help="Hela veckor." error=${E('plannedWeeks')}>
          <${ui.Input} id="ink-p-weeks" type="number" inputMode="numeric" value=${v.plannedWeeks} onInput=${set('plannedWeeks')} invalid=${!!E('plannedWeeks')} /><//>
      </div>
      <div class=${cls('field', E('confirmed') && 'invalid')}>
        <${ui.Check} id="ink-p-confirm" checked=${v.confirmed} onChange=${set('confirmed')}>Jag har ringt ${k.name || 'handläggaren'} och tagit uppgifterna enligt den säkra rutinen.<//>
        ${E('confirmed') && html`<div class="error-text" role="alert"><${I} name="alert-circle" />${errs.confirmed}</div>`}
      </div>
      <div class="small muted">Nästa ärendenummer blir ${sel.previewNextCaseNumber()}. Efter registreringen ser bara avtalsansvarig och den namngivna coachen namn och personnummer.</div>
    <//>`;
  };

  // ------------------------------------------------------------ Detaljvy
  const DetailHead = ({ it, onAccept, onDecline, onCorrect }) => {
    const c = it.case; const m = METHOD[it.method] || METHOD.manual;
    const [stLabel, stTone, stIcon] = STATUS[it.status] || [it.status, 'grey', 'circle'];
    const sla = it.sla;
    const decision = c && ['acknowledged', 'received'].includes(c.status) && ['order', 'order_protected'].includes(it.cls);
    let steps = null; let current = 0;
    if (it.cls === 'order') {
      if (c && c.status === 'declined') { steps = ['Mottaget', 'Ordererkännande', 'Avböjt']; current = 3; }
      else { steps = ['Mottaget', 'Ordererkännande', 'Beslut', 'Orderbekräftelse']; current = !c ? 1 : ['acknowledged', 'received'].includes(c.status) ? 2 : 4; }
    }
    if (it.cls === 'order_protected') {
      steps = ['Mottaget', 'Generisk bekräftelse', 'Telefonsamtal', 'Beslut', 'Orderbekräftelse'];
      current = !c ? 2 : ['acknowledged', 'received'].includes(c.status) ? 3 : 5;
      if (c && c.status === 'declined') { steps = ['Mottaget', 'Generisk bekräftelse', 'Telefonsamtal', 'Avböjt']; current = 4; }
    }
    return html`<${ui.Card}>
      <div class="stack">
        <div class="row-between" style="align-items:flex-start">
          <div class="stack-sm" style="gap:4px;min-width:0;flex:1 1 260px">
            <div class="eyebrow">${CLASSIFICATION[it.cls] || 'Mejl'}${c ? ` · ${c.number}` : ''}</div>
            <h2 class="ink-h">${it.subject}</h2>
            <div class="small muted">Från ${it.from}${it.email ? ` (${it.email.fromAddress})` : ''} · mottaget ${when(it.receivedAt)}</div>
          </div>
          ${sla && html`<div class="stack-sm" style="gap:4px;align-items:flex-start"><span class="small muted">${sla.metAt ? `Besvarat ${when(sla.metAt)}` : sel.slaStatus(sla.dueAt).tone === 'ok' ? 'Svar på avropet' : `Svar senast ${when(sla.dueAt)}`}</span><${ui.SlaBadge} dueAt=${sla.dueAt} metAt=${sla.metAt} /></div>`}
          ${!sla && it.cls === 'other' && html`<${ui.Badge} tone="outline" icon="message">Inget avtals-SLA – svara samma dag<//>`}
        </div>
        <div class="row-sm">
          <${ui.Badge} tone=${stTone} icon=${stIcon}>${stLabel}<//>
          <${ui.Badge} tone="outline" icon=${m.icon}>${m.label}<//>
          ${c && html`<span class="row-sm small">Ärende <${ui.CaseLink} caseId=${c.id} /></span>`}
          ${it.email && it.email.handledBy && html`<span class="small muted">Hanterat av ${MM.personName(it.email.handledBy)} ${when(it.email.handledAt)}</span>`}
        </div>
        ${steps && html`<${ui.Stepper} steps=${steps} current=${current} />`}
        ${decision && html`<div class="row">
          <${ui.Btn} kind="primary" icon="check" onClick=${onAccept}>Acceptera<//>
          <${ui.Btn} kind="danger" icon="x-circle" onClick=${onDecline}>Avböj<//>
          ${onCorrect && html`<${ui.Btn} kind="ghost" icon="edit" onClick=${onCorrect}>Rätta uppgifter<//>`}
        </div>`}
      </div>
    <//>`;
  };

  const OrderBody = ({ it, onPick }) => {
    const st = MM.useStore();
    const c = it.case; const e = it.email;
    const decided = c && ['confirmed', 'active', 'paused', 'closed'].includes(c.status);
    const pendingDecision = c && ['acknowledged', 'received'].includes(c.status);
    const missing = e ? (e.missingFields || []).filter((k) => { const v = (e.extracted || {})[k]; return v == null || v === ''; }) : [];
    const pendingSup = c ? st.inboundEmails.filter((x) => x.caseId === c.id && x.classification === 'supplement' && x.status === 'linked') : [];
    const ack = ackFor(it);
    const refMissing = c && pendingDecision && MM.valid.buyerRefError(c.buyerReference || '');
    return html`
      ${decided && html`<${ConfirmationCard} c=${c} />`}
      ${c && c.status === 'declined' && html`<${DeclinedCard} c=${c} />`}
      ${pendingSup.map((s) => html`<${ui.Notice} key=${s.id} tone="info" icon="link" title="En komplettering har kommit">
        <div class="stack-sm">${s.fromName} svarade ${when(s.receivedAt)}. Svaret kopplades automatiskt via ärendenumret i ämnesraden.
        <div><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => onPick(s.id)}>Öppna kompletteringen<//></div></div><//>`)}
      ${pendingDecision && missing.length > 0 && html`<${ui.Notice} tone=${missing.includes('buyerReference') ? 'critical' : 'warn'} title=${`Saknas: ${missing.map((k) => FIELD_LABEL[k].toLowerCase()).join(', ')}`}>
        ${ack && ack.body.includes('saknar') ? `Ordererkännandet bad kommunen svara med uppgifterna (${when(ack.at)}). ` : ''}${missing.includes('buyerReference') ? 'Ärendet kan inte bekräftas utan giltig beställarreferens.' : ''}<//>`}
      ${pendingDecision && !missing.length && refMissing && html`<${ui.Notice} tone="critical" title="Beställarreferens saknas eller är fel">${refMissing}<//>`}
      <div class="ink-pair">
        ${e ? html`<${OriginalCard} e=${e} c=${c} />` : html`<${AckCard} it=${it} />`}
        ${e ? html`<${ParsedCard} e=${e} c=${c} />` : html`<${CaseFieldsCard} c=${c} />`}
      </div>
      <div class="ink-pair even">
        ${e && html`<${AckCard} it=${it} />`}
        <${DuplicateCard} c=${c} />
      </div>`;
  };

  const SupplementBody = ({ it, onPick, onAccept }) => {
    const st = MM.useStore();
    const e = it.email; const c = it.case;
    if (!c) return html`<${ui.Notice} tone="warn" title="Inte kopplad">Kompletteringen kunde inte kopplas till något ärende. Koppla den manuellt.<//>`;
    const orig = st.inboundEmails.find((x) => x.caseId === c.id && x.classification === 'order');
    const applied = e.status === 'applied';
    const keys = Object.keys(e.extracted || {});
    const refErr = e.extracted.buyerReference ? MM.valid.buyerRefError(e.extracted.buyerReference) : null;
    const rows = keys.map((k) => ({ id: k, k }));
    const apply = () => {
      const res = MM.dispatch('email.applySupplement', { emailId: e.id });
      if (!res) return;
      MM.toast(`Uppgifterna är införda i ${c.number}. Nu kan avropet accepteras.`, 'blue');
    };
    const canAccept = ['acknowledged', 'received'].includes(c.status);
    return html`
      <${ui.Notice} tone="info" icon="link" title=${`Kopplad automatiskt till ${c.number}`}>Svaret på ordererkännandet kopplades via ärendenumret i ämnesraden. Ingen manuell sortering behövs.<//>
      <${ui.Card} title=${applied ? 'Uppgifterna är införda' : 'Uppgifter att föra in'} icon=${applied ? 'check-circle' : 'file-plus'} tone=${applied ? 'blue' : undefined}
        foot=${html`${!applied && html`<${ui.Btn} kind="primary" icon="check" disabled=${!!refErr} onClick=${apply}>För in uppgifterna<//>`}
          ${applied && canAccept && html`<${ui.Btn} kind="primary" icon="check" onClick=${onAccept}>Acceptera avropet<//>`}
          ${orig && html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => onPick(orig.id)}>Visa avropet<//>`}`}>
        <div class="stack">
          ${applied && html`<p>Införda ${when(e.handledAt)} av ${MM.personName(e.handledBy)}. ${canAccept ? 'Nu kan avropet accepteras.' : ''}</p>`}
          <${ui.Table} caption="Uppgifter i kompletteringen" rows=${rows} rowKey="id" columns=${[
            { key: 'f', label: 'Fält', render: (r) => html`<span class="strong">${FIELD_LABEL[r.k] || r.k}</span>` },
            { key: 'now', label: 'I ärendet nu', render: (r) => fmtField(r.k, c[r.k], c) || html`<span class="strong">Saknas</span>` },
            { key: 'new', label: 'I kompletteringen', render: (r) => html`<span class="strong">${fmtField(r.k, e.extracted[r.k], c)}</span>` },
            { key: 'conf', label: 'Säkerhet', render: (r) => (e.confidence[r.k] < LOW ? html`<${ui.Badge} tone="grey" icon="alert-circle">Osäker ${pct(e.confidence[r.k])}<//>` : html`<span class="small muted">${pct(e.confidence[r.k])}</span>`) },
          ]} />
          ${refErr && html`<${ui.Notice} tone="critical" title="Beställarreferensen har fel format">${refErr}<//>`}
        </div>
      <//>
      <div class="ink-pair">
        <${OriginalCard} e=${e} c=${c} />
        <${ui.Card} title="Ärendet" icon="briefcase">
          <${ui.Kv} items=${[['Ärendenummer', html`<${ui.CaseLink} caseId=${c.id} />`], ['Status', html`<${ui.CaseStatus} status=${c.status} />`], ['Deltagare', sel.displayName(c)],
            ['Avtalsområde', sel.areaName(c.primaryArea)], ['Beställarreferens', c.buyerReference || 'Saknas'], ['Svar på avropet', html`<${ui.SlaBadge} dueAt=${sel.avropDue(c)} metAt=${c.confirmedAt || c.declinedAt} />`]]} />
        <//>
      </div>`;
  };

  const replyDraft = (c) => {
    const mon = d.monday(d.today()); const end = d.addDays(mon, 7);
    const acts = sel.activitiesOf(c.id).filter((a) => a.startsAt >= mon && a.startsAt < end);
    const days = MM.uniq(acts.map((a) => d.WD[d.weekday(a.startsAt)]));
    const k = customerUser(c.referrerId);
    const me = MM.persona();
    const sched = days.length ? `Den här veckan (${d.fmtWeek(d.today())}) är deltagaren schemalagd ${listJoin(days)}.` : 'Veckans schema är inte klart ännu.';
    return `${k ? `Hej ${k.name.split(' ')[0]}!` : 'Hej!'}\n\nTack för ditt mejl om ${c.number}. ${sched} ${c.leadCoachId ? `${MM.personName(c.leadCoachId)} återkommer i dag med förslag på tid för uppföljningsmötet.` : ''}\n\nVänliga hälsningar\n${me ? me.name : ''}\nMiljonbemanning`;
  };

  const OtherBody = ({ it }) => {
    const st = MM.useStore();
    const e = it.email; const c = it.case;
    const [draft, setDraft] = useState(() => (c ? replyDraft(c) : ''));
    const [err, setErr] = useState(null);
    const replies = c ? sel.messagesOf(c.id).filter((m) => m.createdAt >= e.receivedAt && !String(m.senderId).startsWith('k-')) : [];
    const custMsgs = c ? sel.messagesOf(c.id).filter((m) => String(m.senderId).startsWith('k-')).slice(-2) : [];
    const lastReply = replies[replies.length - 1];
    const replyMail = lastReply ? st.notifications.filter((n) => n.caseId === c.id && n.template === 'nytt_meddelande' && n.at >= lastReply.createdAt)[0] : null;
    const handled = e.status === 'handled';
    const send = () => {
      if (!draft.trim()) { setErr('Skriv ett svar.'); return; }
      const res = MM.dispatch('message.send', { caseId: c.id, body: draft.trim() });
      if (!res) return;
      MM.toast('Svaret är skickat som säkert meddelande. Kommunen fick ett mejl utan innehåll.', 'blue');
    };
    const markHandled = () => { MM.dispatch('email.setStatus', { emailId: e.id, status: 'handled', caseId: c ? c.id : undefined }); MM.toast('Mejlet är markerat som hanterat.', 'blue'); };
    return html`
      <${ui.Notice} tone="info" title="Klassat som Övrigt – inte en beställning">Mejl som inte är beställningar lämnas till en människa.${c ? ` Det kopplades till ${c.number} via ärendenumret i texten.` : ' Inget ärendenummer hittades.'}<//>
      <div class="ink-pair">
        <${OriginalCard} e=${e} c=${c} />
        ${c ? html`<${ui.Card} title="Ärendet" icon="briefcase">
          <div class="stack">
            <${ui.Kv} items=${[['Ärendenummer', html`<${ui.CaseLink} caseId=${c.id} />`], ['Deltagare', sel.displayName(c)], ['Huvudcoach', MM.personName(c.leadCoachId)], ['Status', html`<${ui.CaseStatus} status=${c.status} />`], ['Fas', sel.phaseLabel(c.phase)]]} />
            ${custMsgs.length > 0 && html`<div class="stack-sm"><div class="label-caps">Senaste säkra meddelanden från kommunen</div>
              ${custMsgs.map((m) => html`<div key=${m.id} class="stack-sm" style="gap:2px"><span class="small muted">${MM.personName(m.senderId)} · ${when(m.createdAt)}${m.readBy.length === 0 ? ' · oläst' : ''}</span><blockquote class="ink-quote">${m.body}</blockquote></div>`)}</div>`}
          </div>
        <//>` : html`<${ui.Card} title="Ärendet"><p class="muted">Inget ärende kopplat.</p><//>`}
      </div>
      ${c && html`<${ui.Card} title="Svara" icon="send" foot=${html`
          ${!lastReply && html`<${ui.Btn} kind="primary" icon="send" onClick=${send}>Svara med säkert meddelande<//>`}
          ${!handled ? html`<${ui.Btn} kind=${lastReply ? 'primary' : 'secondary'} icon="check" onClick=${markHandled}>Markera som hanterad<//>` : html`<${ui.Badge} tone="bluetone" icon="check">Hanterad av ${MM.personName(e.handledBy)} ${when(e.handledAt)}<//>`}
          ${c.referrerId === 'k-maria' && html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.deltagare" params=${{ caseId: c.id }} label="Se vad kommunen fick" />`}`}>
        ${lastReply ? html`<div class="stack-sm">
            <${ui.Notice} tone="ok" title=${`Svar skickat ${when(lastReply.createdAt)} som säkert meddelande`}>Svaret ligger i ärendet i portalen. Svara inte med vanligt mejl när det gäller en deltagare.<//>
            <blockquote class="ink-quote">${lastReply.body}</blockquote>
            ${replyMail && html`<div class="row-sm small" style="align-items:flex-start;flex-wrap:nowrap"><${I} name="mail" /><span><b>Kommunen fick ett mejl utan innehåll:</b> ${replyMail.body}</span></div>`}
          </div>`
          : html`<${ui.Field} id="ink-reply" label="Svar till kommunen" required help=${`Skickas som säkert meddelande i ärendet. Kommunen får bara ett mejl: ”Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.” Förslaget bygger på schemat i ärendet – ändra fritt.`} error=${err}>
            <${ui.TextArea} id="ink-reply" value=${draft} onInput=${(x) => { setDraft(x); setErr(null); }} rows=${8} maxLength=${2000} invalid=${!!err} /><//>`}
      <//>`}`;
  };

  const ProtectedBody = ({ it, role, onPhone }) => {
    const st = MM.useStore();
    const e = it.email; const c = it.case;
    const k = st.customerUsers.find((u) => u.email === e.fromAddress) || {};
    const managerId = MM.contract().contractManagerId;
    const tl = [
      { icon: 'mail', filled: true, title: 'Generisk mottagningsbekräftelse skickad', sub: e.ackSentAt ? when(e.ackSentAt) : '' },
      { icon: 'flag', filled: true, tone: 'red', title: `Flagga till avtalsansvarig ${MM.personName(managerId)}`, sub: `${when(e.receivedAt)}${role === 'avtalsansvarig' ? ' · gäller dig' : ''}` },
      { icon: 'phone', filled: !!c, title: `Ring ${k.name || 'handläggaren'} på ${k.phone || '–'}`, sub: c ? `Klart – registrerat ${when(e.registeredAt)} av ${MM.personName(e.registeredBy)}` : 'Ta uppgifterna muntligt enligt den säkra rutinen' },
      { icon: 'lock', filled: !!c, title: 'Registrera minimala uppgifter', sub: 'Namn, personnummer och handläggare. Ingen adress, inga kontaktuppgifter till deltagaren.' },
      { icon: 'user', filled: !!(c && !['acknowledged', 'received'].includes(c.status)), title: 'Acceptera och tilldela en namngiven coach', sub: 'Bara coachen och avtalsansvarig får se namn och personnummer.' },
    ];
    return html`
      ${c && ['confirmed', 'active', 'paused', 'closed'].includes(c.status) && html`<${ConfirmationCard} c=${c} />`}
      ${c && c.status === 'declined' && html`<${DeclinedCard} c=${c} />`}
      <${ui.Notice} tone="critical" icon="lock" title="Skyddade personuppgifter – ingen automatik">Mejlet tolkas inte och inget ärende skapas automatiskt. Bara en generisk mottagningsbekräftelse skickas. Ingen adress sparas, inga SMS eller mejl går till deltagaren och ingen AI används.<//>
      <div class="ink-pair">
        <${OriginalCard} e=${e} c=${c} />
        <${ui.Card} title="Säker rutin" icon="shield" foot=${!c ? html`<${ui.Btn} kind="primary" icon="phone" onClick=${onPhone}>Registrera efter telefonsamtal<//>` : null}>
          <div class="stack">
            <${ui.Timeline} items=${tl} />
            ${role === 'samordnare' && html`<div class="small muted">Du kan ta samtalet. Efter registreringen ser du bara ärendenumret och texten ”Skyddade personuppgifter”.</div>`}
          </div>
        <//>
      </div>
      <div class="ink-pair even">
        <${AckCard} it=${it} />
        ${c ? html`<${CaseFieldsCard} c=${c} title="Registrerat efter samtalet" />` : html`<${ui.Card} title="Behörighet" icon="lock"><p>Ärenden med skyddade personuppgifter syns med namn bara för avtalsansvarig och den namngivna coachen. Samordnare och chef ser ärendenumret.</p><//>`}
      </div>`;
  };

  const Detail = ({ it, role, onPick }) => {
    MM.useStore();
    const [modal, setModal] = useState(null);
    const c = it.case;
    const close = () => setModal(null);
    const showEmail = (id) => { setModal(null); onPick(id); };
    let body;
    if (it.cls === 'order_protected') body = html`<${ProtectedBody} it=${it} role=${role} onPhone=${() => setModal('phone')} />`;
    else if (it.cls === 'supplement') body = html`<${SupplementBody} it=${it} onPick=${onPick} onAccept=${() => setModal('accept')} />`;
    else if (it.cls === 'other') body = html`<${OtherBody} it=${it} />`;
    else body = html`<${OrderBody} it=${it} onPick=${onPick} />`;
    return html`<div class="stack">
      <${DetailHead} it=${it} onAccept=${() => setModal('accept')} onDecline=${() => setModal('decline')} onCorrect=${c && !isProtected(c) ? () => setModal('correct') : null} />
      ${body}
      ${modal === 'accept' && c && html`<${AcceptModal} c=${c} onClose=${close} onShowEmail=${showEmail} />`}
      ${modal === 'decline' && c && html`<${DeclineModal} c=${c} onClose=${close} />`}
      ${modal === 'correct' && c && html`<${CorrectModal} c=${c} e=${it.cls === 'order' ? it.email : null} onClose=${close} />`}
      ${modal === 'phone' && it.email && html`<${PhoneModal} e=${it.email} onClose=${close} />`}
    </div>`;
  };

  // ------------------------------------------------------------ sam.inkorg
  const InboxRow = ({ it, active, onPick }) => {
    const m = METHOD[it.method] || METHOD.manual; const [stLabel, stTone, stIcon] = STATUS[it.status] || [it.status, 'grey', 'circle'];
    return html`<button type="button" class=${cls('list-item clickable ink-row', active && 'is-active')} aria-current=${active ? 'true' : undefined} onClick=${() => onPick(it.id)}>
      <div class="li-main">
        <div class="ink-row-top"><span class="strong ink-ellipsis">${it.from}</span><span class="small muted nowrap">${when(it.receivedAt)}</span></div>
        <div class="ink-subj">${it.subject}</div>
        <div class="row-sm">
          ${it.pending && it.sla ? html`<${ui.SlaBadge} dueAt=${it.sla.dueAt} metAt=${it.sla.metAt} />` : html`<${ui.Badge} tone=${stTone} icon=${stIcon}>${stLabel}<//>`}
          ${it.cls === 'order' || it.cls === 'order_protected' ? html`<${ui.Badge} tone="outline" icon=${m.icon}>${m.label}<//>` : html`<${ui.Badge} tone="outline" icon=${CLASS_ICON[it.cls] || 'mail'}>${CLASSIFICATION[it.cls]}<//>`}
          ${it.case && html`<span class="small mono strong">${it.case.number}</span>`}
        </div>
      </div>
    </button>`;
  };

  const InboxSummary = ({ pending, onPick }) => {
    const orders = pending.filter((x) => ['order', 'order_protected'].includes(x.cls));
    const urgent = pending.filter((x) => x.sla && !x.sla.metAt).sort(sortPending)[0];
    const n = (kind) => pending.filter((x) => x.cls === kind).length;
    return html`<div class="ink-summary" role="group" aria-label="Sammanfattning av inkorgen">
      <div class="ink-sum"><span class="label-caps">Avrop att besvara</span><span class="ink-sum-n">${orders.length}</span></div>
      <div class="ink-sum"><span class="label-caps">Kompletteringar</span><span class="ink-sum-n">${n('supplement')}</span></div>
      <div class="ink-sum"><span class="label-caps">Skyddade</span><span class="ink-sum-n">${n('order_protected')}</span></div>
      <div class="ink-sum"><span class="label-caps">Övrigt</span><span class="ink-sum-n">${n('other')}</span></div>
      <div class="ink-sum grow">${urgent ? html`<span class="label-caps">Mest brådskande</span>
        <span class="row-sm"><${ui.SlaBadge} dueAt=${urgent.sla.dueAt} /><span class="strong">${urgent.case ? urgent.case.number : urgent.subject}</span><span class="small muted">${urgent.from}</span>
          <${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => onPick(urgent.id)}>Öppna<//></span>` : html`<span class="label-caps">Mest brådskande</span><span class="muted">Inget väntar på svar.</span>`}</div>
    </div>`;
  };

  const InboxView = ({ params = {}, role }) => {
    const st = MM.useStore();
    const items = buildItems(st);
    const pending = items.filter((x) => x.pending).sort(sortPending);
    const handled = items.filter((x) => !x.pending).sort(MM.by((x) => x.handledAt || x.receivedAt, -1));
    const all = items.slice().sort(MM.by('receivedAt', -1));
    const initial = useMemo(() => {
      if (params.emailId && items.some((x) => x.id === params.emailId)) return params.emailId;
      if (params.caseId) {
        const byCase = items.filter((x) => x.case && x.case.id === params.caseId);
        const pick = byCase.find((x) => ['order', 'order_protected'].includes(x.cls)) || byCase[0];
        if (pick) return pick.id;
      }
      return pending[0] ? pending[0].id : all[0] ? all[0].id : null;
    }, []);
    const initItem = items.find((x) => x.id === initial);
    const [selId, setSelId] = useState(initial);
    const [tab, setTab] = useState(initItem && !initItem.pending ? 'alla' : 'att');
    const [showAll, setShowAll] = useState(false);
    const detailRef = useRef(null); const userPick = useRef(false);
    useEffect(() => {
      if (!userPick.current) return; userPick.current = false;
      try { if (window.matchMedia('(max-width: 1099px)').matches && detailRef.current) detailRef.current.scrollIntoView({ block: 'start' }); } catch (e) { /* */ }
    }, [selId]);
    const pick = (id) => { userPick.current = true; setSelId(id); };
    const list = tab === 'att' ? pending : tab === 'hanterade' ? handled : all;
    const LIMIT = 12;
    const shown = showAll ? list : list.slice(0, LIMIT);
    const item = items.find((x) => x.id === selId) || null;
    return html`<${ui.Page} title="Avropsinkorg" eyebrow="avrop@miljonbemanning.se"
      lead=${`Mejl till avrop@ läses in automatiskt och får ärendenummer och ordererkännande inom ${ackMinutes()} minuter. Svara med Acceptera eller Avböj senast ${answerText()} efter mottagandet.`}
      actions=${html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.bestall" label="Se hur kommunen beställer" />`}>
      <${InboxSummary} pending=${pending} onPick=${pick} />
      <div class="ink-md">
        <div class="stack-sm ink-tabs" style="min-width:0">
          <${ui.Tabs} ariaLabel="Filtrera inkorgen" active=${tab} onChange=${(t) => { setTab(t); setShowAll(false); }}
            tabs=${[{ id: 'att', label: 'Att hantera', count: pending.length }, { id: 'hanterade', label: 'Hanterade' }, { id: 'alla', label: 'Alla' }]} />
          <span class="small muted">${tab === 'att' ? `${list.length} att hantera, mest brådskande först` : tab === 'hanterade' ? `${list.length} hanterade, senaste först` : `${list.length} mejl och beställningar, senaste först`}</span>
          <${ui.Card} flush foot=${list.length > shown.length ? html`<${ui.Btn} kind="ghost" onClick=${() => setShowAll(true)}>Visa alla ${list.length}<//>` : null}>
            ${shown.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inget att hantera">Alla avrop är besvarade.<//>`
              : html`<nav aria-label="Mejl i inkorgen" class="list">${shown.map((it) => html`<${InboxRow} key=${it.id} it=${it} active=${it.id === selId} onPick=${pick} />`)}</nav>`}
          <//>
        </div>
        <div class="ink-detail" ref=${detailRef}>
          ${item ? html`<${Detail} key=${item.id} it=${item} role=${role} onPick=${pick} />`
            : html`<${ui.Card}><${ui.Empty} icon="inbox" title="Välj ett mejl">Klicka på ett mejl i listan för att se originalet och det tolkade formuläret.<//><//>`}
        </div>
      </div>
      <${ui.DemoNote}>Inläsningen är simulerad. I tjänsten hämtas mejlen från avrop@ via Microsoft Graph var 2–5 minut och flyttas till mappen Inläst, där de ligger kvar som reserv. Inga mejl eller SMS skickas på riktigt – de syns i utskicksloggen. Demoklockan går en minut framåt för varje åtgärd.<//>
    <//>`;
  };

  // ------------------------------------------------------------ Deadlines (delas av startsidan och sam.deadlines)
  const DL_KIND = {
    avrop_svar: { label: 'Svar på avrop', icon: 'inbox', chain: 'samordnare' },
    forsta_mote: { label: 'Första möte', icon: 'calendar', chain: 'samordnare' },
    veckorapport_registrering: { label: 'Närvaroregistrering', icon: 'check-square', chain: 'coach' },
    veckorapport_publicering: { label: 'Veckorapport', icon: 'file', chain: 'samordnare' },
    manadsrapport: { label: 'Månadsrapport', icon: 'file', chain: 'coach' },
    slutrapport: { label: 'Slutrapport', icon: 'file', chain: 'coach' },
    bestallarrapport: { label: 'Beställarrapport', icon: 'chart', chain: 'avtalsansvarig' },
    atgardsplan: { label: 'Åtgärdsplan', icon: 'flag', chain: 'avtalsansvarig' },
    fakturering: { label: 'Fakturering', icon: 'card', chain: 'ekonom' },
    avvikelse_uppfoljning: { label: 'Uppföljning av avvikelse', icon: 'alert-circle', chain: 'coach' },
  };
  const CHAIN = { coach: ['Coach', 'Samordnare', 'Chef'], samordnare: ['Samordnare', 'Chef'], avtalsansvarig: ['Avtalsansvarig', 'Chef'], ekonom: ['Ekonom', 'Chef'] };
  const kindLabel = (k) => (DL_KIND[k] || { label: k }).label;
  const dlSub = (x) => {
    const num = x.caseId && !x.aggregate ? (sel.caseById(x.caseId) || {}).number : null;
    const lab = x.label === kindLabel(x.kind) ? null : x.label;
    return [num, lab].filter(Boolean).join(' · ') || null;
  };
  /** Månadsrapporter med samma förfallotid slås ihop till en rad per förfallotid (annars ~80 rader). */
  const groupDeadlines = (list) => {
    const out = []; const agg = {};
    for (const x of list) {
      if (x.kind === 'manadsrapport') {
        const key = `${x.kind}:${x.dueAt}`;
        if (!agg[key]) { agg[key] = { ...x, id: `agg:${key}`, items: [], aggregate: true, link: canOpen('rapporter.lista') ? { view: 'rapporter.lista', params: {} } : null }; out.push(agg[key]); }
        agg[key].items.push(x);
      } else out.push(x);
    }
    for (const g of Object.values(agg)) if (g.items.length === 1) { const i = out.indexOf(g); out[i] = g.items[0]; }
    return out;
  };
  const ownerOf = (x) => {
    if (x.aggregate) return { name: 'Respektive huvudcoach', chain: 'coach' };
    if (x.ownerId) { const u = userById(x.ownerId); return { name: MM.personName(x.ownerId), chain: u && CHAIN[u.role] ? u.role : 'coach' }; }
    if (x.caseId && ['manadsrapport', 'slutrapport'].includes(x.kind)) { const c = sel.caseById(x.caseId); if (c && c.leadCoachId) return { name: MM.personName(c.leadCoachId), chain: 'coach' }; }
    if (x.owner) { const def = MM.roleDef(x.owner); return { name: `${def.label}${def.personaId ? ` · ${MM.personName(def.personaId)}` : ''}`, chain: CHAIN[x.owner] ? x.owner : 'samordnare' }; }
    return { name: '–', chain: (DL_KIND[x.kind] || {}).chain || 'samordnare' };
  };
  /** Eskaleringssteg: i tid = ägaren; passerad = nästa steg; mer än ett dygn = sista steget. */
  const escalationStep = (x, chain) => {
    if (x.bucket !== 'overdue') return 0;
    const hours = -d.diffMinutes(d.now(), x.dueAt) / 60;
    return Math.min(chain.length - 1, hours > 24 ? 2 : 1);
  };
  const EscPath = ({ x, chainKey }) => {
    const chain = CHAIN[chainKey] || CHAIN.samordnare; const step = escalationStep(x, chain);
    return html`<span class="ink-esc" aria-label=${`Eskaleringsväg: ${chain.join(', ')}. Ligger nu hos ${chain[step]}.`}>
      ${chain.map((s, i) => html`${i > 0 && html`<span aria-hidden="true">→</span>`}${i === step ? html`<b>${s}${step > 0 ? ' (eskalerat)' : ''}</b>` : html`<span>${s}</span>`}`)}</span>`;
  };
  const ProvBadge = () => html`<${ui.Badge} tone="outline" icon="help" title="Regeln är ett förslag i avtalskonfigurationen och ska fastställas med Botkyrka.">Ej fastställd med Botkyrka<//>`;

  const AggDetail = ({ x }) => {
    const byCoach = Object.entries(MM.groupBy(x.items, (i) => { const c = sel.caseById(i.caseId); return c && c.leadCoachId ? c.leadCoachId : '–'; }))
      .map(([id, xs]) => ({ id, name: id === '–' ? 'Utan coach' : MM.personName(id), n: xs.length })).sort(MM.by('n', -1));
    return html`<span class="small muted">${byCoach.map((b) => `${b.name} ${b.n}`).join(' · ')}</span>`;
  };

  const DeadlineTable = ({ rows }) => html`<${ui.Table} caption="Deadlines" rows=${rows} empty="Inget förfaller här." rowClass=${(x) => (x.bucket === 'overdue' ? 'row-alert' : '')} columns=${[
    { key: 'due', label: 'Förfaller', render: (x) => html`<div class="stack-sm" style="gap:4px;align-items:flex-start"><${ui.SlaBadge} dueAt=${x.dueAt} /><span class="cell-sub">${when(x.dueAt)}</span></div>` },
    { key: 'what', label: 'Vad', render: (x) => html`<div class="stack-sm" style="gap:3px;min-width:200px">
        <span class="row-sm"><${I} name=${(DL_KIND[x.kind] || {}).icon || 'clock'} /><span class="strong">${kindLabel(x.kind)}</span>${x.aggregate && html`<${ui.Badge} tone="grey">${x.items.length} ärenden<//>`}</span>
        <span class="cell-sub">${x.label}</span>${x.aggregate && html`<${AggDetail} x=${x} />`}${x.provisional && html`<span><${ProvBadge} /></span>`}</div>` },
    { key: 'case', label: 'Ärende', nowrap: true, render: (x) => (x.caseId && !x.aggregate ? html`<${ui.CaseLink} caseId=${x.caseId} />` : html`<span class="muted">${x.aggregate ? 'Flera' : '–'}</span>`) },
    { key: 'owner', label: 'Ansvarig och eskalering', render: (x) => { const o = ownerOf(x); return html`<div class="stack-sm" style="gap:3px;min-width:180px"><span>${o.name}</span><${EscPath} x=${x} chainKey=${o.chain} /></div>`; } },
    { key: 'go', label: 'Öppna', render: (x) => (x.link && canOpen(x.link.view) ? html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => go(x.link)}>Öppna<//>` : html`<span class="small muted">–</span>`) },
  ]} />`;

  const DeadlinesView = ({ role }) => {
    MM.useStore();
    const [kind, setKind] = useState('alla');
    const all = sel.deadlines({ days: 7 });
    const counts = MM.groupBy(all, (x) => x.kind);
    const filtered = all.filter((x) => kind === 'alla' || x.kind === kind);
    const buckets = [
      ['overdue', 'Försenat', 'alert', 'red', 'Passerad deadline eskaleras: coach → samordnare → chef.'],
      ['today', 'I dag', 'clock', undefined, null],
      ['week', 'Denna vecka', 'calendar', undefined, null],
    ];
    const n = (b) => all.filter((x) => x.bucket === b).length;
    const prov = all.filter((x) => x.provisional).length;
    const unset = MM.cfg().sla.filter((s) => MM.isUnset(s.due) || MM.isUnset(s.within));
    const options = [{ value: 'alla', label: `Alla (${all.length})` }, ...Object.keys(DL_KIND).filter((k) => counts[k]).map((k) => ({ value: k, label: `${kindLabel(k)} (${counts[k].length})` }))];
    return html`<${ui.Page} title="Förfaller i dag och denna vecka" eyebrow=${`${d.fmtWeekday(d.now())} · ${d.fmtWeek(d.now())}`}
      lead="Allt som förfaller inom 7 dagar enligt avtalets SLA-regler, räknat i arbetsdagar med svenska helgdagar. Passerad deadline blir röd och eskaleras: coach → samordnare → chef."
      actions=${html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.rapporter" label="Se vad kommunen får levererat" />`}>
      <div class="grid-4">
        <${ui.Kpi} label="Försenat" value=${n('overdue')} tone=${n('overdue') > 0 ? 'alert' : undefined} sub="Eskaleras automatiskt" />
        <${ui.Kpi} label="I dag" value=${n('today')} sub=${`Senast ${d.fmtWeekday(d.today())}`} />
        <${ui.Kpi} label="Denna vecka" value=${n('week')} sub="Inom 7 dagar" />
        <${ui.Kpi} label="Ej fastställda" value=${prov} sub="Regeln ska bekräftas med Botkyrka" />
      </div>
      <div class="stack-sm">
        <span class="label-caps" id="ink-dl-filter">Visa typ</span>
        <${ui.Seg} ariaLabel="Filtrera på typ" value=${kind} onChange=${setKind} options=${options} />
      </div>
      ${buckets.map(([b, title, icon, tone, sub]) => { const rows = groupDeadlines(filtered.filter((x) => x.bucket === b));
        return html`<${ui.Card} key=${b} title=${`${title} (${filtered.filter((x) => x.bucket === b).length})`} icon=${icon} tone=${rows.length > 0 ? tone : undefined} flush
          actions=${sub && rows.length > 0 ? html`<span class="small muted">${sub}</span>` : null}>
          <${DeadlineTable} rows=${rows} />
        <//>`; })}
      ${unset.length > 0 && html`<${ui.Notice} tone="info" title="Märkningen Ej fastställd med Botkyrka">
        Förfallotiderna bygger på förslag i avtalskonfigurationen tills Botkyrka bekräftat: ${unset.map((s) => `${s.label.toLowerCase()} – ${String(s.due || s.within).replace(/^ATT_FASTSTÄLLA\s*\(?/, '').replace(/\)$/, '')}`).join('; ')}.<//>`}
      <${ui.Notice} tone="info" icon="eye-off" title="Kommunen ser inte den här listan">Avtalskonfigurationen visar inte SLA-statistik för kommunen. Kommunen ser det som levereras i portalen.<//>
      <${ui.DemoNote}>Deadlines räknas fram av SLA-reglerna och demoklockan. I tjänsten sparas de som rader med förfallotid och tidpunkt för leverans, så att ni kan visa vad som levererades och när om kommunen skulle hävda en avvikelse.<//>
    <//>`;
  };

  // ------------------------------------------------------------ sam.start
  const SEV = { critical: ['Kritisk', 'red', 'alert'], warning: ['Bevaka', 'grey', 'alert-circle'], info: ['Info', 'outline', 'info'] };
  const alertPhase = (a) => (['pulse_contact', 'pulse_low'].includes(a.kind) || String(a.key).startsWith('kpi:resultatgrad') ? 2 : null);

  const AckModal = ({ a, onClose }) => {
    const [plan, setPlan] = useState(''); const [tried, setTried] = useState(false);
    const err = plan.trim().length < 10 ? 'Skriv en kort åtgärdsplan – vad görs, av vem och när.' : null;
    const submit = () => {
      setTried(true); if (err) return;
      MM.dispatch('alert.ack', { key: a.key, plan: plan.trim() });
      MM.toast('Flaggan är kvitterad. Åtgärdsplanen är sparad i revisionsloggen.', 'blue'); onClose();
    };
    return html`<${ui.Modal} title="Kvittera flagga" onClose=${onClose}
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${submit}>Kvittera<//>`}>
      <div class="stack-sm"><span class="strong">${a.title}</span><span>${a.text}</span></div>
      <${ui.Field} id="ink-ack-plan" label="Kort åtgärdsplan" required help="Vad görs, av vem och när? Till exempel: Sara ringer handläggaren i dag före kl. 12 och bokar mötet." error=${tried ? err : null}>
        <${ui.TextArea} id="ink-ack-plan" value=${plan} onInput=${setPlan} rows=${3} maxLength=${500} invalid=${tried && !!err} /><//>
      <div class="small muted">Kvitteringen sparas med namn och tid. Flaggan kommer tillbaka om läget ändras.</div>
    <//>`;
  };

  const BookModal = ({ c, onClose }) => {
    const [date, setDate] = useState(d.addWorkingDays(d.today(), 1)); const [time, setTime] = useState('10:00'); const [tried, setTried] = useState(false);
    const due = sel.firstMeetingDue(c);
    const err = !date ? 'Välj datum.' : date < d.today() ? 'Datumet har redan passerat.' : null;
    const submit = () => {
      setTried(true); if (err || !time) return;
      MM.dispatch('case.bookFirstMeeting', { caseId: c.id, at: `${date}T${time}` });
      MM.toast(`Första mötet för ${c.number} är bokat ${d.fmtWeekday(date)} kl. ${d.fmtTime(`${date}T${time}`)}. Kallelse skickad.`, 'blue'); onClose();
    };
    return html`<${ui.Modal} title=${`Boka första möte – ${c.number}`} onClose=${onClose}
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="calendar" onClick=${submit}>Boka mötet<//>`}>
      <p>Huvudcoach: <b>${MM.personName(c.leadCoachId)}</b>. Mötet ska vara bokat senast ${d.fmtWeekday(due)} (inom en vecka från avropet).</p>
      <div class="form-grid">
        <${ui.Field} id="ink-b-date" label="Datum" required help="En vardag." error=${tried ? err : null}><${ui.Input} id="ink-b-date" type="date" value=${date} onInput=${setDate} invalid=${tried && !!err} /><//>
        <${ui.Field} id="ink-b-time" label="Tid" required help="Mötet hålls i Alby."><${ui.Input} id="ink-b-time" type="time" value=${time} onInput=${setTime} /><//>
      </div>
      ${date > d.dayOf(due) && html`<${ui.Notice} tone="warn" title="Senare än en vecka efter avropet">Mötet markeras i uppföljningen av nyckeltalet Första möte inom en vecka.<//>`}
      <div class="small muted">Deltagaren får kallelse via sin föredragna kontaktväg och en SMS-påminnelse dagen före. Inga personuppgifter i utskicket.</div>
    <//>`;
  };

  const Tile = ({ label, value, sub, tone, onClick }) => html`<button type="button" class=${cls('kpi ink-tile', tone)} onClick=${onClick}>
    <span class="kpi-label">${label}</span><span class="kpi-value">${value}</span>${sub && html`<span class="kpi-sub">${sub}</span>`}</button>`;

  const KpiCard = ({ keyName }) => {
    const v = sel.kpiValue(keyName);
    const month = d.addMonths(d.monthKey(d.today()), -1);
    if (!v) return null;
    const below = v.status === 'below_internal';
    return html`<${ui.Kpi} label=${v.label} value=${v.value == null ? '–' : fmt.pct(v.value)} tone=${below ? 'watch' : undefined}
      sub=${`${v.num} av ${v.den} · ${d.monthName(month)}${v.targetUnset ? ' · mål ej fastställt' : ''}`}>
      ${v.value != null && html`<${ui.Meter} value=${v.value} max=${1} tone="blue" label=${`${fmt.pct(v.value)} av målet`} markers=${v.target != null ? [{ value: v.target, label: `Internt mål ${fmt.pct(v.target, 0)}`, tone: 'dark' }] : []} />`}
      ${(v.late || []).length > 0 && html`<div class="stack-sm" style="gap:0"><span class="small muted">Inte i tid:</span><span class="row-sm small" style="gap:0 4px">${v.late.map((c) => html`<${ui.CaseLink} key=${c.id} caseId=${c.id} />`)}</span></div>`}
    <//>`;
  };

  const MiniRow = ({ left, main, sub, right }) => html`<div class="ink-mini-row">${left && html`<div class="ink-l">${left}</div>`}<div class="ink-m stack-sm" style="gap:2px"><span class="strong" style="overflow-wrap:anywhere">${main}</span>${sub && html`<span class="small muted" style="overflow-wrap:anywhere">${sub}</span>`}</div><div class="ink-r">${right}</div></div>`;

  const StartView = ({ role }) => {
    const st = MM.useStore();
    const persona = MM.persona();
    const [ackFor_, setAckFor] = useState(null); const [book, setBook] = useState(null);
    const [showAllAlerts, setShowAllAlerts] = useState(false); const [showAcked, setShowAcked] = useState(false);
    const items = buildItems(st).filter((x) => x.pending).sort(sortPending);
    const orders = items.filter((x) => x.sla && ['order', 'order_protected', 'supplement'].includes(x.cls) && !x.sla.metAt);
    const answerOrders = items.filter((x) => ['order', 'order_protected'].includes(x.cls));
    const urgent = orders[0];
    const noCoach = st.cases.filter((c) => !c.leadCoachId && ['received', 'acknowledged', 'confirmed', 'active', 'paused'].includes(c.status)).sort(MM.by('referredAt'));
    const alerts = sel.alerts({ role });
    const acked = sel.alerts({ role, includeAcked: true }).filter((a) => a.ack);
    const fmFlags = new Set(alerts.filter((a) => a.kind === 'first_meeting').map((a) => a.caseId));
    const fmCases = st.cases.filter((c) => c.status === 'confirmed' && !c.firstMeetingAt).sort(MM.by('referredAt'));
    const dls = sel.deadlines({ days: 7 });
    const dlSoon = groupDeadlines(dls.filter((x) => x.bucket !== 'week'));
    const dlWeek = groupDeadlines(dls.filter((x) => x.bucket === 'week'));
    const tasks = (st.tasks || []).filter((t) => t.toRole === role && t.status === 'open').sort(MM.by('createdAt', -1));
    const cds = st.contractDeviations.filter((x) => x.status !== 'closed').sort(MM.by('actionPlanDue'));
    const cfg = MM.cfg();
    const warnings = st.contractDeviations.filter((x) => x.warningIssued).length;
    const assignNotifs = st.userNotifications.filter((n) => n.kind === 'assignment').sort(MM.by('createdAt', -1)).slice(0, 3);
    const rule = sel.orgRules().onAssignment;
    const protectedItems = items.filter((x) => x.cls === 'order_protected' || (x.case && isProtected(x.case)));
    const summaryReport = st.reports.filter((r) => r.kind === 'customer_summary' && !['delivered', 'opened'].includes(r.status)).sort(MM.by('dueAt'))[0];
    const crit = alerts.filter((a) => a.severity === 'critical').length;
    const shownAlerts = showAllAlerts ? alerts : alerts.slice(0, 5);
    const coachPid = MM.roleDef('coach').personaId;
    const hour = Number(d.timeOf(d.now()).slice(0, 2));
    const greet = hour < 10 ? 'God morgon' : hour < 17 ? 'Hej' : 'God kväll';

    return html`<${ui.Page} title="Startsida" eyebrow=${`${MM.roleDef(role).label} · ${persona ? persona.name : ''}`}
      lead=${`${greet}${persona ? `, ${persona.name.split(' ')[0]}` : ''}! ${d.fmtWeekday(d.now()).replace(/^./, (x) => x.toUpperCase())}, ${d.fmtWeek(d.now())}. Det mest brådskande står först.`}>
      <div class="grid-4">
        <${Tile} label="Avrop att besvara" value=${answerOrders.length} tone=${urgent && ['urgent', 'over'].includes(sel.slaStatus(urgent.sla.dueAt).tone) ? 'alert' : undefined} onClick=${() => MM.nav('sam.inkorg', !urgent ? {} : urgent.email ? { emailId: urgent.id } : { caseId: urgent.case.id })}
          sub=${urgent ? html`<span>Närmast:</span><${ui.SlaBadge} dueAt=${urgent.sla.dueAt} />` : 'Inget väntar'} />
        <${Tile} label="Första möten ej bokade" value=${fmCases.length} tone=${fmFlags.size > 0 ? 'watch' : undefined} onClick=${() => { const el = document.getElementById('ink-fm'); if (el) el.scrollIntoView({ block: 'start' }); }}
          sub=${fmFlags.size > 0 ? `${fmFlags.size} ${fmFlags.size === 1 ? 'flaggat' : 'flaggade'} efter tre dagar` : `Ska bokas inom ${meetingDays()} dagar`} />
        <${Tile} label="Förfaller i dag" value=${dls.filter((x) => x.bucket !== 'week').length} tone=${dls.some((x) => x.bucket === 'overdue') ? 'alert' : undefined} onClick=${() => MM.nav('sam.deadlines', {})}
          sub=${(() => { const o = dls.filter((x) => x.bucket === 'overdue').length; return `${o} ${o === 1 ? 'försenad' : 'försenade'} · ${dls.filter((x) => x.bucket === 'week').length} till denna vecka`; })()} />
        <${Tile} label="Flaggor att kvittera" value=${alerts.length} tone=${crit > 0 ? 'watch' : undefined} onClick=${() => { const el = document.getElementById('ink-flags'); if (el) el.scrollIntoView({ block: 'start' }); }}
          sub=${`${crit} ${crit === 1 ? 'kritisk' : 'kritiska'} · kvitteras med kort åtgärdsplan`} />
      </div>

      ${role === 'avtalsansvarig' && protectedItems.length > 0 && html`<${ui.Card} tone="red" title="Skyddade avrop" icon="lock">
        <div class="stack-sm">${protectedItems.map((x) => html`<div key=${x.id} class="row-between">
          <div class="stack-sm" style="gap:2px"><span class="strong">${x.subject}</span><span class="small muted">${x.from} · ${when(x.receivedAt)} · ${x.case ? `registrerat som ${x.case.number}` : 'väntar på telefonsamtal'}</span></div>
          <span class="row-sm">${x.sla && html`<${ui.SlaBadge} dueAt=${x.sla.dueAt} metAt=${x.sla.metAt} />`}<${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => MM.nav('sam.inkorg', x.email ? { emailId: x.id } : { caseId: x.case.id })}>Öppna<//></span>
        </div>`)}
        <div class="small muted">Flaggas direkt till dig som avtalsansvarig. Bara du och den namngivna coachen ser namn och personnummer.</div></div>
      <//>`}

      <div class="split-wide">
        <${ui.Card} title="Avropsinkorg" icon="inbox" flush actions=${html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav('sam.inkorg', {})}>Öppna inkorgen<//>`}
          foot=${html`<div class="row-sm small" style="align-items:flex-start;flex-wrap:nowrap"><${I} name="bell" /><span>När du accepterar får huvudcoachen och teamet <b>automatiskt en notis</b> – ${rule.channels.includes('email') ? 'i appen och som e-post utan personuppgifter' : 'i appen'}.</span></div>`}>
          ${items.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inkorgen är tom">Alla avrop är besvarade.<//>` : html`<div class="ink-mini">
            ${items.map((x) => html`<${MiniRow} key=${x.id}
              left=${x.sla ? html`<${ui.SlaBadge} dueAt=${x.sla.dueAt} metAt=${x.sla.metAt} />` : html`<${ui.Badge} tone="outline" icon="message">Övrigt<//>`}
              main=${html`${x.case && !x.subject.includes(x.case.number) ? html`<span class="mono">${x.case.number}</span> · ` : ''}${x.subject}`}
              sub=${`${x.from} · ${CLASSIFICATION[x.cls]} · ${(METHOD[x.method] || METHOD.manual).label}${x.email && (x.email.missingFields || []).length ? ` · saknar ${x.email.missingFields.map((k) => FIELD_LABEL[k].toLowerCase()).join(' och ')}` : ''}`}
              right=${html`<${ui.Btn} kind="secondary" onClick=${() => MM.nav('sam.inkorg', x.email ? { emailId: x.id } : { caseId: x.case.id })}>Öppna<//>`} />`)}
          </div>`}
        <//>
        <div class="stack">
          <${KpiCard} keyName="avrop_besvarade_i_tid" />
          <${KpiCard} keyName="forsta_mote_inom_en_vecka" />
          <${ui.Card} title="Tilldelning ger notis" icon="bell" foot=${html`<${ui.PerspectiveSwitch} role="coach" view="notiser" label=${`Se coachens notiser (${MM.personName(coachPid)})`} />`}>
            <div class="stack-sm">
              <p>Huvudcoach och team får en notis direkt när ett avrop accepteras eller coachen byts. E-posten innehåller bara ärendenumret.</p>
              <blockquote class="ink-quote">${assignNotifs[0] ? assignNotifs[0].emailBody : `Du har fått ett nytt ärende i Miljonmatch: ${sel.previewNextCaseNumber()}. Logga in för att se detaljerna.`}</blockquote>
              ${assignNotifs.length > 0 && html`<div class="label-caps" style="margin-top:6px">Senast skickade</div>
                ${assignNotifs.map((n) => html`<div key=${n.id} class="row-sm small"><${I} name="user" /><span><b>${MM.personName(n.recipientId)}</b> · ${(sel.caseById(n.caseId) || {}).number || ''} · ${when(n.createdAt)}</span></div>`)}`}
            </div>
          <//>
        </div>
      </div>

      <div class="split-wide">
        <div id="ink-flags" style="scroll-margin-top:110px">
        <${ui.Card} title=${`Flaggor (${alerts.length})`} icon="flag" flush
          actions=${acked.length > 0 ? html`<${ui.Btn} kind="ghost" onClick=${() => setShowAcked(!showAcked)}>${showAcked ? 'Dölj kvitterade' : `Visa kvitterade (${acked.length})`}<//>` : null}
          foot=${alerts.length > 5 ? html`<${ui.Btn} kind="ghost" onClick=${() => setShowAllAlerts(!showAllAlerts)}>${showAllAlerts ? 'Visa färre' : `Visa alla ${alerts.length}`}<//>` : null}>
          ${alerts.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inga öppna flaggor">Allt är kvitterat.<//>` : html`<div class="list">
            ${shownAlerts.map((a) => { const [sl, stone, sicon] = SEV[a.severity] || SEV.info; const ph = alertPhase(a);
              return html`<div class="list-item" key=${a.key}>
                <div class="li-main">
                  <div class="row-sm"><${ui.Badge} tone=${stone} icon=${sicon}>${sl}<//>${ph && html`<${ui.BuildPhase} fas=${ph} />`}<span class="small muted">${when(a.createdAt)}</span></div>
                  <span class="li-title">${a.title}</span>
                  <span class="li-sub">${a.text}</span>
                  <div class="row-sm">
                    <${ui.Btn} kind="secondary" icon="check" onClick=${() => setAckFor(a)}>Kvittera<//>
                    ${a.link && canOpen(a.link.view) && html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => go(a.link)}>Öppna<//>`}
                  </div>
                </div>
              </div>`; })}
          </div>`}
          ${showAcked && html`<div class="list" style="border-top:2px solid var(--line)">${acked.map((a) => html`<div class="list-item" key=${`ack-${a.key}`}>
            <${I} name="check-circle" /><div class="li-main"><span class="li-title">${a.title}</span><span class="li-sub">Kvitterad av ${MM.personName(a.ack.by)} ${when(a.ack.at)}. Åtgärd: ${a.ack.plan}</span></div></div>`)}</div>`}
        <//>
        </div>
        <${ui.Card} title="Förfaller snart" icon="clock" flush actions=${html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav('sam.deadlines', {})}>Visa alla<//>`}>
          <div class="ink-mini">
            ${dlSoon.map((x) => html`<${MiniRow} key=${x.id} left=${html`<${ui.SlaBadge} dueAt=${x.dueAt} />`} main=${kindLabel(x.kind)} sub=${dlSub(x)}
              right=${x.link && canOpen(x.link.view) ? html`<${ui.Btn} kind="ghost" title=${`Öppna: ${kindLabel(x.kind)}`} icon="arrow-right" onClick=${() => go(x.link)} />` : null} />`)}
            ${dlWeek.slice(0, 3).map((x) => html`<${MiniRow} key=${x.id} left=${html`<${ui.SlaBadge} dueAt=${x.dueAt} />`} main=${`${kindLabel(x.kind)}${x.aggregate ? ` · ${x.items.length} ärenden` : ''}`}
              sub=${dlSub(x)}
              right=${x.provisional ? html`<${ProvBadge} />` : null} />`)}
            ${dlWeek.length > 3 && html`<div class="ink-mini-row"><span class="ink-m small muted">+ ${dlWeek.length - 3} till denna vecka (${dls.filter((x) => x.bucket === 'week').length} deadlines)</span></div>`}
          </div>
        <//>
      </div>

      <div class="grid-2">
        <div id="ink-fm" style="scroll-margin-top:110px">
        <${ui.Card} title="Första möten som inte är bokade" icon="calendar" flush>
          ${fmCases.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Alla första möten är bokade" />` : html`<div class="ink-mini">${fmCases.map((c) => html`<${MiniRow} key=${c.id}
            left=${html`<${ui.SlaBadge} dueAt=${sel.firstMeetingDue(c)} />`}
            main=${html`<${ui.CaseLink} caseId=${c.id} />`}
            sub=${`Coach ${MM.personName(c.leadCoachId)} · mottaget ${d.fmtDate(c.referredAt)}${fmFlags.has(c.id) ? ' · flaggat efter tre dagar' : ''}`}
            right=${isProtected(c) ? html`<span class="small muted">Coachen ringer</span>` : html`<${ui.Btn} kind="secondary" icon="calendar" onClick=${() => setBook(c)}>Boka<//>`} />`)}</div>`}
        <//>
        </div>
        <${ui.Card} title="Ärenden utan coach" icon="user" flush>
          ${noCoach.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Alla ärenden har en coach" />` : html`<div class="ink-mini">${noCoach.map((c) => html`<${MiniRow} key=${c.id}
            left=${html`<${ui.SlaBadge} dueAt=${sel.avropDue(c)} />`}
            main=${html`<span class="mono">${c.number}</span>`}
            sub=${`${sel.areaName(c.primaryArea)} · ${MM.personName(c.referrerId)}`}
            right=${html`<${ui.Btn} kind="secondary" onClick=${() => MM.nav('sam.inkorg', { caseId: c.id })}>Tilldela<//>`} />`)}</div>`}
          <div class="small muted" style="padding:10px 18px">Coach tilldelas när avropet accepteras.</div>
        <//>
      </div>

      <div class="grid-2">
        <${ui.Card} title=${`Öppna uppgifter (${tasks.length})`} icon="check-square" flush>
          ${tasks.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inga öppna uppgifter">Uppgifter till din roll visas här.<//>` : html`<div class="list">${tasks.map((t) => html`<div class="list-item" key=${t.id}>
            <div class="li-main"><span class="li-title">${t.text}</span><span class="li-sub">Från ${MM.personName(t.fromId)} · ${when(t.createdAt)}</span>
              <div class="row-sm">
                ${t.emailId && html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('sam.inkorg', { emailId: t.emailId })}>Öppna mejlet<//>`}
                <${ui.Btn} kind="ghost" icon="check" onClick=${() => { MM.dispatch('ink.taskDone', { taskId: t.id }); MM.toast('Uppgiften är markerad som klar.', 'blue'); }}>Markera som klar<//>
              </div></div></div>`)}</div>`}
        <//>
        <${ui.Card} title=${role === 'avtalsansvarig' ? 'Avtalet: avvikelser och frågor' : 'Avtalsavvikelser'} icon="flag" actions=${html`<${ui.BuildPhase} fas=${2} />`} flush
          foot=${canOpen('chef.avvikelser') ? html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav('chef.avvikelser', {})}>Alla avtalsavvikelser<//>` : null}>
          <div class="ink-mini">
            ${cds.length === 0 && html`<div class="ink-mini-row"><span class="ink-m muted">Inga öppna avtalsavvikelser.</span></div>`}
            ${cds.map((x) => { const step = (cfg.escalationLadder || []).find((s) => s.step === x.escalationStep);
              return html`<${MiniRow} key=${x.id} left=${x.actionPlanDue ? html`<${ui.SlaBadge} dueAt=${`${x.actionPlanDue}T16:00`} prefix="Åtgärdsplan" />` : null}
                main=${x.description} sub=${`${x.source === 'beställare' ? 'Från kommunen' : x.source === 'deltagare' ? 'Från deltagare' : 'Intern'} · ${x.level}${step ? ` · steg ${step.step} i eskaleringstrappan` : ''} · ${x.status === 'action_plan' ? 'åtgärdsplan godkänd av kommunen' : 'öppen'}`}
                right=${canOpen('chef.avvikelser') ? html`<${ui.Btn} kind="ghost" title="Öppna avvikelsen" icon="arrow-right" onClick=${() => MM.nav('chef.avvikelser', { id: x.id })} />` : null} />`; })}
            ${role === 'avtalsansvarig' && html`
              ${summaryReport && html`<${MiniRow} left=${html`<${ui.SlaBadge} dueAt=${summaryReport.dueAt} />`} main=${`Beställarrapport ${d.monthName(summaryReport.month)} att godkänna`}
                sub="Till kommunens chef. Byggs bara av godkända uppgifter." right=${canOpen('rapport.visa') ? html`<${ui.Btn} kind="secondary" onClick=${() => MM.nav('rapport.visa', { reportId: summaryReport.id })}>Granska<//>` : null} />`}
              <${MiniRow} left=${html`<${ui.Badge} tone=${warnings > 0 ? 'red' : 'outline'} icon="alert-circle">${warnings} av ${cfg.warningsBeforeTermination}<//>`} main="Skriftliga varningar"
                sub=${`${cfg.warningsBeforeTermination} varningar kan leda till uppsägning. Vite ${fmt.kr(cfg.penalties.deviationOre)} per tillfälle vid avvikelse.`} right=${null} />`}
          </div>
        <//>
      </div>

      <${ui.DemoNote}>Siffrorna räknas fram ur demodata och demoklockan. Flaggor och deadlines följer reglerna i avtalskonfigurationen och de interna reglerna för notiser.<//>
      ${ackFor_ && html`<${AckModal} a=${ackFor_} onClose=${() => setAckFor(null)} />`}
      ${book && html`<${BookModal} c=${book} onClose=${() => setBook(null)} />`}
    <//>`;
  };

  // ------------------------------------------------------------ Registrering
  MM.registerView('sam.start', { title: 'Startsida', roles: ['samordnare', 'avtalsansvarig'], component: StartView });
  MM.registerView('sam.inkorg', { title: 'Avropsinkorg', roles: ['samordnare', 'avtalsansvarig'], component: InboxView });
  MM.registerView('sam.deadlines', { title: 'Förfaller i dag och denna vecka', roles: ['samordnare', 'avtalsansvarig', 'chef'], component: DeadlinesView });
})();
