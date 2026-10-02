// views/kommun.js – kundens perspektiv (Botkyrka kommun): inloggning, startsida, beställning i portalen,
// deltagare, rapporter och meddelanden samt kommunchefens beställarrapport.
// Skrivet för ovana användare: korta meningar, inga förkortningar, hjälptext vid varje fält, en sak per skärm.
(() => {
  const { html, useState, useEffect, useMemo, useRef, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const S = () => MM.store.state;

  // Plattformens inloggningsregler (SPEC §4). Gäller alla beställare – inte ett avtalsvärde.
  const AUTH = { codeDigits: 6, codeMinutes: 10, maxAttempts: 5, idleMinutes: 60, maxHours: 12 };
  const SAFE_PHONE = '08-000 00 00';
  const ORDER_MAILBOX = 'avrop@miljonbemanning.se';
  const NOTIFY_FROM = 'notis@miljonbemanning.se';
  const HANDL = ['kommun_handlaggare'];
  const BOTH = ['kommun_handlaggare', 'kommun_chef'];
  /** Hur länge en oläst händelse (avböjd beställning, ny coach, orderbekräftelse) visas på startsidan. Gränssnittsval, inte ett avtalsvärde. */
  const EVENT_DAYS = 14;
  /** Omfattning i veckor. Läses från avtalskonfigurationen om den finns där (orderWeeks), annars SPEC:s "typiskt 4–10 veckor". */
  const weekRange = () => { const o = MM.cfg().orderWeeks || {}; return { min: o.min || 4, max: o.max || 10 }; };
  const weekOptions = () => { const { min, max } = weekRange(); const out = []; for (let n = min; n <= max; n++) out.push(n); return out; };

  // ------------------------------------------------------------ Stil (bara MB-tokens, gäller bara .kom)
  const CSS = `
.kom { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.kom h1 { font-size: clamp(1.375rem, 4.8vw, 1.75rem); overflow-wrap: anywhere; }
.kom .btn { white-space: normal; text-align: center; }
.kom .card-title { font-size: 1rem; letter-spacing: 0.08em; }
.kom .card-head { padding: 14px 20px; }
.kom .card-body { padding: 18px 20px; }
.kom .kpi .kpi-label { font-size: 1rem; }
.kom .kpi .kpi-state { font-size: 1rem; }
.kom .kv dt { font-size: 1.125rem; }
.kom .table { font-size: 1.125rem; }
.kom .seg button { font-size: 1.0625rem; min-height: 48px; min-width: 48px; }
.kom .badge { font-size: 1rem; }
.kom .demo-note { font-size: 1.125rem; }
.kom .small { font-size: 1rem; }
.kom .list-item { padding: 14px 20px; }
.kom .list-item.clickable { min-height: 68px; align-items: center; }
.kom .list-item .li-sub { font-size: 1.125rem; }
.kom .meter-legend, .kom .tl-item .small { font-size: 1rem; }
.kom .notice > div, .kom-break { overflow-wrap: anywhere; min-width: 0; }
.kom-details > summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; gap: 8px; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; list-style: none; }
.kom-details > summary::-webkit-details-marker { display: none; }
.kom-details > summary .ic { transition: transform 0.15s ease; }
.kom-details[open] > summary .ic { transform: rotate(180deg); }
.kom-stepper li.review .n .ic { width: 16px; height: 16px; }
.kom .tab .count { font-size: 1rem; }
.kom .error-text { font-size: 1rem; }
.kom-narrow .stepper li .n, .kom .stepper li .n { font-size: 1rem; }
.kom-group + .kom-group { border-top: 1px solid var(--line); }
.kom-group-label { padding: 14px 20px 4px; }
.kom-head { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.kom-head > .btn { align-self: flex-start; margin-left: -12px; }
.kom .card-body.flush { padding: 0; }
.kom .bigbtn .arrow { margin-left: auto; display: inline-flex; }
.kom-lead { color: var(--fg-muted); max-width: 62ch; }
.kom-narrow { width: min(580px, 100%); margin: 0 auto; }
.kom-casenum { font-size: clamp(1.75rem, 8vw, 2.5rem); font-weight: 800; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.kom-mail { border: 1.5px solid var(--line-strong); border-radius: var(--radius); background: var(--surface-sub); padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
.kom-mail-meta { font-size: 1rem; color: var(--fg-muted); display: flex; flex-wrap: wrap; gap: 4px 12px; }
.kom-thread { display: flex; flex-direction: column; gap: 12px; }
.kom-msg { max-width: 90%; padding: 12px 14px; border-radius: var(--radius-lg); background: var(--bla-ton); align-self: flex-start; display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
.kom-msg.mine { align-self: flex-end; background: var(--antracit-ton); }
.kom-msg.meeting { background: var(--vit); border: 2px solid var(--antracit); }
.kom-msg-meta { font-size: 1rem; color: var(--fg-muted); display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.kom-chev { color: var(--fg-muted); }
.kom-kpis { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.kom-kpis .kpi { padding: 14px 16px; }
@media (max-width: 760px) { .kom-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 440px) { .kom .kpi .kpi-value { font-size: 1.5rem; } .kom .card-body { padding: 16px; } .kom .card-head { padding: 12px 16px; } .kom .list-item { padding: 12px 16px; } }
.kom-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.kom-actions.between { justify-content: space-between; }
.kom-okline { display: flex; gap: 6px; align-items: flex-start; font-size: 1.125rem; font-weight: 700; }
.kom-okline .ic { color: var(--antracit); margin-top: 2px; }
.kom-section-label { font-size: 1rem; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; color: var(--fg-muted); }
.kom-facts { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.kom-facts li { display: flex; gap: 10px; align-items: flex-start; }
.kom-facts li .ic { margin-top: 3px; }
.kom-review { display: flex; flex-direction: column; gap: 10px; }
.kom-review + .kom-review { border-top: 1px solid var(--line); padding-top: 16px; }
.kom-unread { box-shadow: inset 4px 0 0 var(--rod); }
@media (max-width: 480px) {
  .kom .tabs { flex-wrap: wrap; overflow-x: visible; }
  .kom .tab { padding: 10px; }
  .kom .tab .ic { display: none; }
  .kom .table th, .kom .table td { padding: 8px 6px; }
  .kom .table { font-size: 1rem; }
}
.kom-titlerow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.kom-bigval { font-size: 2rem; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
`;
  try {
    if (!document.getElementById('kom-css')) { const s = document.createElement('style'); s.id = 'kom-css'; s.textContent = CSS; document.head.appendChild(s); }
  } catch (e) { /* stil är valfri */ }

  // ------------------------------------------------------------ Hjälpare och egna selektorer (prefix kom)
  const pidNow = () => MM.currentPersonaId();
  const isChef = () => MM.role() === 'kommun_chef';
  const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1).trimEnd()} …` : t; };
  const firstName = (name) => String(name || '').split(' ')[0];
  const isProtected = (c) => !!((sel.person(c) || {}).protectedIdentity);
  /** Namn för kundens vy via sel.displayName: skyddade personuppgifter visas bara för handläggaren som beställde ('customer'). */
  const nameFor = (c) => (c ? sel.displayName(c) : '–');
  /** Kommunens chef har 'restricted' för skyddade ärenden – inga namn, inga personuppgifter, inga meddelanden. */
  const isRestricted = (c) => sel.access(c) === 'restricted';

  // ---- Datum och texter utan förkortningar (portalen)
  const fD = (s) => d.fmtDateFull(s);
  const fDT = (s) => d.fmtDateTimeFull(s);
  /** "tisdag 2 februari 2027 klockan 09.12" */
  const fDTL = (s) => (s ? `${d.fmtWeekday(s)} ${String(s).slice(0, 4)} klockan ${d.fmtTime(s)}` : '–');
  const dayMonth = (s) => d.fmtDateFull(s).replace(/ \d{4}$/, '');
  const weekRangeText = (key) => { const mon = d.weekMonday(key); return `${dayMonth(mon)}–${dayMonth(d.addDays(mon, 6))}`; };
  const monthCap = (mk) => d.monthName(mk).replace(/^./, (x) => x.toUpperCase());
  const MON_FULL = {}; (d.MON_SHORT || []).forEach((s, i) => { MON_FULL[s] = (d.MON || [])[i] || s; });
  /** Texter från kärnan (t.ex. ordererkännandet) skrivs ut utan "kl." och förkortade månader. */
  const fullText = (t) => String(t || '').replace(/\bkl\. /g, 'klockan ')
    .replace(/(\d{1,2}) (jan|feb|mars|apr|maj|juni|juli|aug|sep|okt|nov|dec)\b/g, (m, dd, mon) => `${dd} ${MON_FULL[mon] || mon}`);
  const nPhases = () => (MM.cfg().phases || []).length;
  /** Fasnamn utan förkortningen APL. */
  const phaseText = (n) => sel.phaseName(n).replace(/^Praktik\s*\/\s*APL$/i, 'Praktik på en arbetsplats').replace(/\s*\/\s*APL\b/i, '');
  const minN = () => MM.cfg().pulse.minNForAggregate;
  /** Små grupper redovisas som "färre än 5" (minN från avtalet) så att ingen deltagare kan pekas ut. */
  const small = (n) => (n > 0 && n < minN() ? `färre än ${minN()}` : String(n));
  const deliveredOk = (r) => !!r.deliveredAt && ['delivered', 'opened'].includes(r.status) && !r.superseded;
  /** Rättelse på gång: den levererade versionen syns tills den nya versionen har levererats. */
  const correctionPending = (r) => { if (!r.correctionPending) return false; const n = S().reports.find((x) => x.id === r.correctionPending); return !!n && !deliveredOk(n); };
  /** Rapporter som levererats till personen (handläggare: egna rapporter, chef: beställarrapporter). */
  sel.komReports = (pid = pidNow()) => S().reports.filter((r) => deliveredOk(r) && (r.deliveredTo || []).includes(pid));
  sel.komUnreadReports = (pid = pidNow()) => sel.komReports(pid).filter((r) => !r.openedAt).sort(MM.by('deliveredAt', -1));
  /** Olästa säkra meddelanden till handläggaren (chefen är inte mottagare av meddelanden om enskilda deltagare). */
  sel.komUnreadMessages = (pid = pidNow(), role = MM.role()) => {
    if (role !== 'kommun_handlaggare') return [];
    const ids = new Set(sel.visibleCases(role, pid).map((c) => c.id));
    return S().messages.filter((m) => ids.has(m.caseId) && m.senderId !== pid && !(m.readBy || []).includes(pid)).sort(MM.by('createdAt', -1));
  };
  /** Senast använda beställarreferens för handläggaren (annars enhetens sparade). */
  sel.komLastBuyerRef = (pid = pidNow()) => {
    const last = S().cases.filter((c) => c.referrerId === pid && c.buyerReference).sort(MM.by('referredAt', -1))[0];
    if (last) return last.buyerReference;
    const u = MM.personById(pid) || {}; const br = S().buyerReferences.find((b) => b.id === u.buyerReferenceId);
    return br ? br.reference : '';
  };
  /** Kommunens åtgärdsplaner som väntar på godkännande. */
  sel.komPendingActionPlans = () => S().contractDeviations.filter((x) => x.contractId === 'c-bot' && x.actionPlan && !x.customerApprovedAt && x.status !== 'closed');
  /** Öppna uppgifter till personen, t.ex. "Miljonbemanning behöver ditt beslut" (customer_decision). */
  sel.komTasks = (pid = pidNow()) => (S().tasks || []).filter((t) => t.toId === pid && t.status === 'open').sort(MM.by('createdAt', -1));
  /** När personen senast öppnade ärendet i portalen (sätts av kom.caseSeen). */
  const seenAt = (pid, caseId) => ((S().komSeen || {})[pid] || {})[caseId] || '';
  /** Händelser i handläggarens ärenden som inte är lästa: avböjd beställning, byte av huvudcoach och ny orderbekräftelse. */
  sel.komEvents = (pid = pidNow(), role = MM.role()) => {
    if (role !== 'kommun_handlaggare') return [];
    const since = `${d.addDays(d.today(), -EVENT_DAYS)}T00:00`;
    const mine = S().cases.filter((c) => c.referrerId === pid); const ids = new Set(mine.map((c) => c.id));
    const out = [];
    for (const c of mine) {
      if (c.status === 'declined' && c.declinedAt) out.push({ key: `declined:${c.id}`, kind: 'declined', at: c.declinedAt, caseId: c.id, icon: 'x-circle', title: `Beställning ${c.number} kunde inte tas emot`, sub: 'Miljonbemanning har avböjt beställningen. Öppna den för att läsa orsaken.' });
    }
    for (const h of S().caseStatusHistory) {
      if (!ids.has(h.caseId) || !h.fromCoach || !h.toCoach || h.fromCoach === h.toCoach) continue;
      const c = sel.caseById(h.caseId);
      out.push({ key: `coach:${h.id}`, kind: 'coach', at: h.changedAt, caseId: c.id, icon: 'users', title: `Ny ansvarig coach för ${c.number}`, sub: `${MM.personName(h.toCoach)} har tagit över efter ${MM.personName(h.fromCoach)}.` });
    }
    for (const r of S().reports) {
      if (r.kind !== 'order_confirmation' || !deliveredOk(r) || r.openedAt || !(r.deliveredTo || []).includes(pid)) continue;
      const c = sel.caseById(r.caseId); if (!c) continue;
      out.push({ key: `oc:${r.id}`, kind: 'confirmed', at: r.deliveredAt, caseId: c.id, report: r, icon: 'check-circle', title: `Orderbekräftelse för ${c.number}`, sub: `Start ${fD(c.plannedStart || c.startDate || c.desiredStart)} med ${MM.personName(c.leadCoachId)} som ansvarig coach.` });
    }
    return out.filter((e) => e.at >= since && (e.kind === 'confirmed' || seenAt(pid, e.caseId) < e.at)).sort(MM.by('at', -1));
  };

  const senderLabel = (id, pid) => (id === pid ? 'Du' : String(id).startsWith('k-') ? `${MM.personName(id)}, Botkyrka kommun` : `${MM.personName(id)}, Miljonbemanning`);
  const KIND_ICON = { weekly_attendance: 'check-square', monthly: 'file', final: 'award', order_confirmation: 'check-circle', customer_summary: 'chart' };
  const reportTitle = (r) => {
    if (r.kind === 'weekly_attendance') return `Veckorapport närvaro, vecka ${Number(String(r.week).slice(-2))}`;
    if (r.kind === 'monthly') return `Månadsrapport ${d.monthName(r.month)}`;
    if (r.kind === 'customer_summary') return `Beställarrapport ${d.monthName(r.month)}`;
    return sel.reportKindLabel(r.kind);
  };
  const reportSub = (r) => {
    if (r.kind === 'weekly_attendance') return `${weekRangeText(r.week)} · ${isChef() ? 'handläggarens deltagare' : 'alla dina deltagare'}`;
    if (r.kind === 'customer_summary') return 'Hela avtalet med Botkyrka kommun';
    const c = sel.caseById(r.caseId); return c ? `${c.number} · ${nameFor(c)}` : '';
  };
  const openReport = (r) => MM.nav('rapport.visa', { reportId: r.id });
  const refError = (v) => {
    const e = MM.valid.buyerRefError(v); if (e) return e;
    const known = S().buyerReferences.find((b) => b.reference === String(v).trim());
    if (known && !known.active) return `Referensen ${known.reference} är spärrad. Kommunens ekonomi känner inte igen den. Kontrollera att inga siffror har blivit omkastade.`;
    return null;
  };
  const endFor = (start, weeks) => (start && weeks ? d.addDays(d.monday(start), (Number(weeks) - 1) * 7 + 4) : '');
  const maskPnr = (p) => { const s = String(p || '').trim(); return s.length > 4 ? `${s.slice(0, -4).replace(/\d/g, '•')}${s.slice(-4)}` : s; };
  const looksLikePnr = (s) => /\b(19|20)?\d{6}[-+ ]?\d{4}\b/.test(String(s || ''));
  const firstMeetingWithin = () => { const x = MM.cfg().sla.find((s) => s.key === 'forsta_mote'); const n = x && x.within && x.within.days; return n === 7 ? 'en vecka' : n ? `${n} dagar` : 'kort tid'; };

  const STATUS = {
    received: { label: 'Mottagen', tone: 'grey', icon: 'inbox' },
    acknowledged: { label: 'Väntar på bekräftelse', tone: 'outline', icon: 'clock' },
    confirmed: { label: 'Start bokad', tone: 'bluetone', icon: 'calendar' },
    active: { label: 'Pågår', tone: 'blue', icon: 'activity' },
    paused: { label: 'Pausad', tone: 'grey', icon: 'pause' },
    closed: { label: 'Avslutad', tone: 'dark', icon: 'check-square' },
    declined: { label: 'Avböjd', tone: 'red', icon: 'x-circle' },
  };
  const KStatus = ({ c }) => {
    const s = STATUS[c.status] || { label: sel.statusLabel(c.status), tone: 'grey', icon: 'circle' };
    const label = c.status === 'confirmed' && !c.firstMeetingAt ? 'Bekräftad' : s.label;
    return html`<${ui.Badge} tone=${s.tone} icon=${s.icon}>${label}<//>`;
  };
  /** Vem texten handlar om: "du" för handläggaren som beställde, "handläggaren (namn)" för kommunens chef. */
  const who = (c) => (isChef() ? `handläggaren (${MM.personName(c.referrerId)})` : 'du');
  const Who = (c) => (isChef() ? `Handläggaren (${MM.personName(c.referrerId)})` : 'Du');
  const statusText = (c) => {
    switch (c.status) {
      case 'received': return isProtected(c) ? `Beställningen är mottagen. Miljonbemanning ringer ${isChef() ? 'handläggaren' : 'dig'} och tar resten enligt den säkra rutinen för skyddade personuppgifter.` : 'Beställningen är mottagen.';
      case 'acknowledged': return `Beställningen är mottagen. ${Who(c)} får besked om startdatum och coach senast ${fDTL(sel.avropDue(c))}.`;
      case 'confirmed': return c.firstMeetingAt ? `Insatsen är bekräftad. Första mötet är ${fDTL(c.firstMeetingAt)} i ${c.location || 'Alby'}.` : `Insatsen är bekräftad. Första mötet bokas senast ${fD(sel.firstMeetingDue(c))}.`;
      case 'active': return `Insatsen pågår. Deltagaren är i fas ${c.phase} av ${nPhases()} (${phaseText(c.phase).toLowerCase()}).`;
      case 'paused': return 'Insatsen är pausad. Pausade veckor faktureras inte.';
      case 'closed': return `Insatsen avslutades ${fD(c.endDate)}.${c.endReason ? ` Orsak: ${sel.endReasonLabel(c.endReason).toLowerCase()}.` : ''}`;
      case 'declined': return `Miljonbemanning kunde inte ta emot beställningen.${c.declineReason ? ` Orsak: ${c.declineReason}` : ''}`;
      default: return '';
    }
  };
  const shortStatus = (c) => {
    if (c.status === 'active') return `Fas ${c.phase} av ${nPhases()} · ${phaseText(c.phase)}`;
    if (c.status === 'acknowledged') return `Besked senast ${fDT(sel.avropDue(c))}`;
    if (c.status === 'confirmed') return c.firstMeetingAt ? `Första mötet ${fDT(c.firstMeetingAt)}` : 'Första mötet bokas';
    if (c.status === 'closed') return `Avslutad ${fD(c.endDate)}${c.endReason ? ` · ${sel.endReasonLabel(c.endReason)}` : ''}`;
    if (c.status === 'declined') return `Avböjd ${fD(c.declinedAt)}`;
    if (c.status === 'received') return isChef() ? 'Miljonbemanning ringer handläggaren' : 'Vi ringer dig';
    return sel.statusLabel(c.status);
  };

  /** Sidhuvud för portalen: tillbaka, överrubrik, rubrik med röd punkt och ingress. */
  const Head = ({ eyebrow, title, lead, back, actions }) => html`<header class="kom-head">
    ${back && html`<${ui.Btn} kind="ghost" icon="arrow-left" onClick=${back.onClick}>${back.label}<//>`}
    ${eyebrow && html`<div class="eyebrow">${eyebrow}</div>`}
    <h1><span class="dot" aria-hidden="true"></span>${title}</h1>
    ${lead && html`<p class="kom-lead">${lead}</p>`}
    ${actions && html`<div class="kom-actions">${actions}</div>`}
  </header>`;

  const OkLine = ({ children }) => html`<div class="kom-okline"><${I} name="check-circle" /><span>${children}</span></div>`;
  const MoreBtn = ({ shown, total, onMore }) => (shown < total
    ? html`<div class="card-foot"><${ui.Btn} kind="secondary" icon="chevron-down" onClick=${onMore}>Visa fler (${total - shown} till)<//></div>` : null);

  // ============================================================ Åtgärder (egna)
  /** Inloggning med e-post och engångskod. Uppdaterar senaste inloggning och loggar i revisionsloggen (utan e-postadress). */
  MM.defineAction('kom.login', (st, p, ctx) => {
    const email = String(p.email || '').trim().toLowerCase();
    const u = st.customerUsers.find((x) => x.email.toLowerCase() === email);
    if (!u) return { error: 'unknown' };
    if (u.active === false) { ctx.audit('auth.login_denied', 'customer_user', u.id, { reason: 'blocked' }); return { error: 'blocked' }; }
    u.lastLoginAt = ctx.now;
    ctx.audit('auth.login', 'customer_user', u.id, { method: 'email_otp' });
    return { userId: u.id };
  });
  /** Handläggaren har öppnat ärendet i portalen – händelser före den tiden räknas som lästa på startsidan. */
  MM.defineAction('kom.caseSeen', (st, p, ctx) => {
    if (!String(ctx.actorId || '').startsWith('k-')) return { error: 'forbidden' };
    st.komSeen = st.komSeen || {}; st.komSeen[ctx.actorId] = st.komSeen[ctx.actorId] || {};
    st.komSeen[ctx.actorId][p.caseId] = ctx.now;
    return {};
  });
  /** Handläggaren markerar en uppgift från Miljonbemanning som klar. */
  MM.defineAction('kom.taskDone', (st, p, ctx) => {
    const t = (st.tasks || []).find((x) => x.id === p.taskId);
    if (!t) return { error: 'not_found' };
    if (t.toId !== ctx.actorId) return { error: 'forbidden' };
    t.status = 'done'; t.doneAt = ctx.now; t.doneBy = ctx.actorId;
    ctx.audit('task.done', 'task', t.id, { by: 'customer' });
    return { ok: true };
  });
  /** Kommunens chef godkänner en åtgärdsplan för en avtalsavvikelse. */
  MM.defineAction('kom.approveActionPlan', (st, p, ctx) => {
    if (ctx.role !== 'kommun_chef') return { error: 'forbidden' };
    const cd = st.contractDeviations.find((x) => x.id === p.id);
    if (!cd) return { error: 'not_found' };
    if (cd.customerApprovedAt) return { error: 'already_approved' };
    cd.customerApprovedAt = ctx.now; cd.customerApprovedBy = ctx.actorId;
    if (cd.status === 'open') cd.status = 'action_plan';
    ctx.audit('contract_deviation.action_plan_approved', 'contract_deviation', cd.id, { by: 'customer' });
    const ctr = st.contracts.find((x) => x.id === cd.contractId) || {}; const mgr = st.users.find((u) => u.id === ctr.contractManagerId);
    if (mgr) ctx.notify('email', mgr.email, 'atgardsplan_godkand', 'Beställaren har godkänt en åtgärdsplan i Miljonmatch. Logga in för att se den.', null);
    return { ok: true };
  });

  // ============================================================ kom.login
  const userForEmail = (email) => S().customerUsers.find((x) => x.email.toLowerCase() === String(email || '').trim().toLowerCase()) || null;
  const roleForUser = (u) => { if (!u) return null; const r = MM.ROLES.find((x) => x.personaId === u.id); return r ? r.key : null; };
  const LoginView = ({ role }) => {
    MM.useStore();
    const domains = MM.contract().emailDomains || [];
    const defEmail = (MM.personById(MM.roleDef(role).personaId) || {}).email || '';
    const [step, setStep] = useState(0);
    const [email, setEmail] = useState(defEmail);
    const [emailErr, setEmailErr] = useState(null);
    const [code, setCode] = useState('');
    const [codeErr, setCodeErr] = useState(null);
    const [sentAt, setSentAt] = useState(null);
    const codeRef = useRef(null);
    const mgrName = MM.personName(MM.contract().contractManagerId);
    useEffect(() => { if (step === 1 && codeRef.current) { const inp = codeRef.current.querySelector('input'); if (inp) inp.focus(); } }, [step]);

    const checkEmail = (v) => {
      const s = String(v || '').trim().toLowerCase();
      if (!s) return 'Skriv din e-postadress.';
      if (!MM.valid.email(s)) return `Adressen är inte komplett. Den ska se ut ungefär så här: fornamn.efternamn@${domains[0] || 'kommun.se'}.`;
      if (!domains.includes(s.split('@')[1])) return `Portalen är bara öppen för adresser som slutar på @${domains.join(' eller @')}. Använd din e-postadress på jobbet.`;
      const u = userForEmail(s);
      if (!u) return `Adressen ${s} är inte inbjuden till portalen. Ingen kan skapa ett konto själv. Be ${mgrName}, avtalsansvarig på Miljonbemanning, att bjuda in dig.`;
      if (u.active === false) return `Kontot för ${s} är spärrat och kan inte logga in. Kontakta ${mgrName}, avtalsansvarig på Miljonbemanning, om du behöver komma åt portalen igen.`;
      if (!roleForUser(u)) return `${u.name} har ett konto, men i prototypen går det bara att logga in som Maria Ekdahl (handläggare) eller Eva Bergström (chef). Använd knapparna längre ned.`;
      return null;
    };
    const sendCode = (e) => {
      if (e) e.preventDefault();
      const err = checkEmail(email); setEmailErr(err); if (err) return;
      setSentAt(d.now()); setCode(''); setCodeErr(null); setStep(1);
    };
    const login = (e) => {
      if (e) e.preventDefault();
      const v = code.replace(/\s/g, '');
      if (!/^\d+$/.test(v)) { setCodeErr('Koden består bara av siffror.'); return; }
      if (v.length !== AUTH.codeDigits) { setCodeErr(`Koden har ${AUTH.codeDigits} siffror. Du har skrivit ${v.length}.`); return; }
      // Kontrollera kontot igen – det kan ha spärrats medan koden skickades.
      const err = checkEmail(email); if (err) { setStep(0); setEmailErr(err); return; }
      const target = roleForUser(userForEmail(email));
      if (target !== MM.role()) MM.setRole(target); else MM.nav(MM.roleDef(target).home, {});
      const res = MM.dispatch('kom.login', { email });
      if (res && res.error) { MM.nav('kom.login', {}); MM.toast('Inloggningen misslyckades. Kontakta avtalsansvarig på Miljonbemanning.', 'red'); return; }
      MM.toast(`Du är inloggad som ${MM.personName(MM.roleDef(target).personaId)}.`, 'blue');
    };
    const quick = (key) => { const u = MM.personById(MM.roleDef(key).personaId); if (u) { setEmail(u.email); setEmailErr(null); setStep(0); } };

    return html`<div class="kom kom-narrow">
      <${Head} eyebrow="Portal för beställare" title="Logga in"
        lead="För dig som beställer insatser från Miljonbemanning inom avtalet med Botkyrka kommun." />
      <${ui.Stepper} steps=${['E-postadress', 'Kod från mejlet']} current=${step} />
      <${ui.Card}>
        ${step === 0 ? html`<form class="stack" onSubmit=${sendCode} noValidate>
            <${ui.Field} id="kom-login-email" label="Din e-postadress" required error=${emailErr}
              help="Använd din e-postadress på jobbet. Vi skickar en kod med sex siffror dit.">
              <${ui.Input} id="kom-login-email" type="email" value=${email} autoComplete="email" invalid=${!!emailErr} onInput=${(v) => { setEmail(v); if (emailErr) setEmailErr(null); }} />
            <//>
            <${ui.Btn} kind="primary" size="lg" block type="submit" iconRight="arrow-right">Skicka kod<//>
          </form>`
        : html`<form class="stack" onSubmit=${login} noValidate>
            <${ui.Notice} tone="info" title="Kolla din e-post">Vi har skickat en kod till <b class="kom-break">${email.trim().toLowerCase()}</b>. Koden gäller i ${AUTH.codeMinutes} minuter, till klockan ${d.fmtTime(d.addMinutes(sentAt || d.now(), AUTH.codeMinutes))}. Du har ${AUTH.maxAttempts} försök.<//>
            <div ref=${codeRef}>
              <${ui.Field} id="kom-login-code" label="Kod" required error=${codeErr}
                help="Sex siffror. Koden står i mejlet från Miljonbemanning. Titta i skräpposten om mejlet inte har kommit.">
                <${ui.Input} id="kom-login-code" value=${code} inputMode="numeric" maxLength=${8} autoComplete="one-time-code" invalid=${!!codeErr} onInput=${(v) => { setCode(v); if (codeErr) setCodeErr(null); }} />
              <//>
            </div>
            <${ui.Btn} kind="primary" size="lg" block type="submit" icon="lock">Logga in<//>
            <div class="kom-actions between">
              <${ui.Btn} kind="ghost" icon="refresh" onClick=${() => { setSentAt(d.now()); setCode(''); setCodeErr(null); MM.toast('Vi har skickat en ny kod. Den gamla koden gäller inte längre.', 'blue'); }}>Skicka en ny kod<//>
              <${ui.Btn} kind="ghost" icon="arrow-left" onClick=${() => { setStep(0); setCodeErr(null); }}>Byt e-postadress<//>
            </div>
          </form>`}
      <//>
      <${ui.DemoNote}>Inget mejl skickas. Alla sex siffror fungerar som kod. I den riktiga tjänsten begränsas antalet försök per adress och per nätverksadress. Om e-postkod räcker för kommunens personal är en öppen fråga till kommunens IT-avdelning.
        <div class="row-sm" style="margin-top:8px">
          <${ui.Btn} kind="secondary" icon="user" onClick=${() => quick('kommun_handlaggare')}>Fyll i Maria Ekdahl (handläggare)<//>
          <${ui.Btn} kind="secondary" icon="user" onClick=${() => quick('kommun_chef')}>Fyll i Eva Bergström (chef)<//>
        </div><//>
      <${ui.Card} title="Varför en kod och inte en länk?" icon="help">
        <p>Kommunens e-postskydd, till exempel Microsoft Safe Links, öppnar länkar i mejl i förväg för att kontrollera dem. Då hinner en inloggningslänk användas upp innan du själv klickar på den. En kod fungerar alltid.</p>
      <//>
      <ul class="kom-facts">
        <li><${I} name="clock" /><span>Du loggas ut automatiskt efter ${AUTH.idleMinutes} minuter utan aktivitet, och alltid efter ${AUTH.maxHours} timmar.</span></li>
        <li><${I} name="users" /><span>Ingen kan skapa ett konto själv. Miljonbemanning bjuder in dig. Saknar du konto? Kontakta ${mgrName}, avtalsansvarig på Miljonbemanning.</span></li>
        <li><${I} name="mail" /><span>Du kan alltid beställa med mejl till ${ORDER_MAILBOX}, även utan att logga in.</span></li>
      </ul>
    </div>`;
  };

  // ============================================================ kom.start (handläggare)
  const taskTitle = (t) => { const c = sel.caseById((t.caseIds || [])[0]); return t.kind === 'customer_decision' ? `Miljonbemanning behöver ditt beslut${c ? ` om ${c.number}` : ''}` : `Uppgift från Miljonbemanning${c ? ` om ${c.number}` : ''}`; };
  const doneTask = (t) => { const res = MM.dispatch('kom.taskDone', { taskId: t.id }); if (res && res.ok) MM.toast('Uppgiften är klar och är borttagen från listan.', 'blue'); else MM.toast('Uppgiften kunde inte markeras som klar.', 'red'); };
  const TaskItem = ({ t }) => {
    const c = sel.caseById((t.caseIds || [])[0]);
    return html`<div class="list-item kom-unread">
      <${I} name="flag" size="lg" />
      <span class="li-main">
        <span class="kom-titlerow"><span class="li-title">${taskTitle(t)}</span><${ui.Badge} tone="dark">Ny<//></span>
        <span class="li-sub">${fullText(t.text)}</span>
        <span class="li-sub">Från Miljonbemanning · ${fDT(t.createdAt)}</span>
        <span class="kom-actions" style="margin-top:8px">
          ${c && html`<${ui.Btn} kind="primary" icon="message" onClick=${() => MM.nav('kom.deltagare', { caseId: c.id, tab: 'meddelanden' })}>Läs och svara<//>`}
          <${ui.Btn} kind="ghost" icon="check" onClick=${() => doneTask(t)}>Markera som klar<//>
        </span>
      </span>
    </div>`;
  };
  const StartView = () => {
    MM.useStore();
    const pid = pidNow(); const me = MM.persona() || {};
    const cases = sel.visibleCases();
    const tasks = sel.komTasks(pid);
    const events = sel.komEvents(pid);
    const unreadM = sel.komUnreadMessages(); const unreadAll = sel.komUnreadReports(pid);
    // Orderbekräftelser visas bland händelserna, övriga olästa rapporter här.
    const unreadR = unreadAll.filter((r) => r.kind !== 'order_confirmation');
    const items = [...unreadM.map((m) => ({ key: m.id, type: 'msg', m })), ...unreadR.map((r) => ({ key: r.id, type: 'rep', r }))];
    const shown = items.slice(0, 4); const shownEv = events.slice(0, 5);
    const active = cases.filter((c) => ['active', 'paused'].includes(c.status)).length;
    const waiting = cases.filter((c) => ['received', 'acknowledged', 'confirmed'].includes(c.status)).length;
    const unreadTotal = unreadAll.length + unreadM.length;
    const nothing = tasks.length + events.length + items.length === 0;
    return html`<div class="kom">
      <${Head} eyebrow=${`${me.unit || ''} · Botkyrka kommun`} title=${`Välkommen, ${firstName(me.name)}`} lead="Vad vill du göra i dag?" />
      ${tasks.length > 0 && html`<${ui.Card} title=${`Att göra (${tasks.length})`} icon="flag" tone="red" flush>
        <div class="list">${tasks.map((t) => html`<${TaskItem} key=${t.id} t=${t} />`)}</div><//>`}
      ${events.length > 0 && html`<${ui.Card} title=${`Händelser i dina ärenden (${events.length})`} icon="bell" flush
          foot=${events.length > shownEv.length ? html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('kom.deltagare', {})}>Mina deltagare<//>` : null}>
        <div class="list">
          ${shownEv.map((ev) => html`<button type="button" key=${ev.key} class="list-item clickable kom-unread" onClick=${() => (ev.report ? openReport(ev.report) : MM.nav('kom.deltagare', { caseId: ev.caseId }))}>
            <${I} name=${ev.icon} size="lg" />
            <span class="li-main"><span class="kom-titlerow"><span class="li-title">${ev.title}</span><${ui.Badge} tone="dark">Ny<//></span>
              <span class="li-sub">${ev.sub}</span><span class="li-sub">${fDT(ev.at)}</span></span>
            <${I} name="chevron-right" cls="kom-chev" />
          </button>`)}
        </div><//>`}
      ${items.length > 0 && html`<${ui.Card} title=${`Olästa rapporter och meddelanden (${items.length})`} icon="mail" flush
          foot=${items.length > shown.length ? html`<${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('kom.rapporter', { filter: 'olasta', tab: unreadR.length === 0 ? 'meddelanden' : 'rapporter' })}>Visa alla olästa (${items.length})<//>` : null}>
          <div class="list">
            ${shown.map((it) => {
              if (it.type === 'msg') {
                const c = sel.caseById(it.m.caseId); const meeting = it.m.kind === 'meeting_request';
                return html`<button type="button" key=${it.key} class="list-item clickable kom-unread" onClick=${() => MM.nav('kom.deltagare', { caseId: c.id, tab: 'meddelanden' })}>
                  <${I} name=${meeting ? 'calendar' : 'message'} size="lg" />
                  <span class="li-main"><span class="kom-titlerow"><span class="li-title">${meeting ? 'Mötesförfrågan' : 'Nytt meddelande'} om ${c.number}</span><${ui.Badge} tone="dark">Ny<//></span>
                    <span class="li-sub">Från ${senderLabel(it.m.senderId, pid)} · ${fDT(it.m.createdAt)}</span></span>
                  <${I} name="chevron-right" cls="kom-chev" />
                </button>`;
              }
              return html`<button type="button" key=${it.key} class="list-item clickable kom-unread" onClick=${() => openReport(it.r)}>
                <${I} name=${KIND_ICON[it.r.kind] || 'file'} size="lg" />
                <span class="li-main"><span class="kom-titlerow"><span class="li-title">${reportTitle(it.r)}</span><${ui.Badge} tone="dark">Ny<//></span><span class="li-sub">${reportSub(it.r)}</span><span class="li-sub">Levererad ${fDT(it.r.deliveredAt)}</span></span>
                <${I} name="chevron-right" cls="kom-chev" />
              </button>`;
            })}
          </div><//>`}
      ${nothing && html`<${ui.Notice} tone="ok" title="Du är uppdaterad">Du har inga uppgifter, inga nya händelser och inga olästa rapporter eller meddelanden.<//>`}
      <nav class="bigbtns" aria-label="Vad vill du göra?">
        <button type="button" class="bigbtn primary" onClick=${() => MM.nav('kom.bestall', {})}>
          <${I} name="file-plus" /><span>Beställ ny insats<span class="bb-sub">Tre korta steg och en granskning. Det tar ungefär fem minuter.</span></span><span class="arrow" aria-hidden="true"><${I} name="arrow-right" /></span>
        </button>
        <button type="button" class="bigbtn" onClick=${() => MM.nav('kom.deltagare', {})}>
          <${I} name="users" /><span>Mina deltagare<span class="bb-sub">${active} pågår · ${waiting} väntar på start</span></span><span class="arrow" aria-hidden="true"><${I} name="arrow-right" /></span>
        </button>
        <button type="button" class="bigbtn" onClick=${() => MM.nav('kom.rapporter', {})}>
          <${I} name="mail" /><span>Rapporter och meddelanden<span class="bb-sub">${unreadTotal > 0 ? `${unreadTotal} olästa` : 'Inga olästa'}</span></span><span class="arrow" aria-hidden="true"><${I} name="arrow-right" /></span>
        </button>
      </nav>
      <p class="kom-lead">Vill du hellre mejla? Skicka beställningen till ${ORDER_MAILBOX}. Har du frågor kan du ringa oss på ${SAFE_PHONE}.</p>
      <div class="kom-actions"><${ui.PerspectiveSwitch} role="samordnare" view="sam.start" label="Se startsidan hos Miljonbemanning" /></div>
    </div>`;
  };

  // ============================================================ kom.bestall
  // Tre steg med uppgifter (som beställningsmallen) och en granskning innan beställningen skickas.
  const STEPS = ['Beställning och kontakt', 'Deltagare', 'Avtalsområde', 'Granska och skicka'];
  const DATA_STEPS = 3;
  /** Stegvisare: steg 1–3 numreras, granskningen visas som ett eget, onumrerat moment. */
  const KomStepper = ({ current, skipped }) => html`<ol class="stepper kom-stepper">${STEPS.map((label, i) => {
    const review = i === DATA_STEPS; const skip = i === skipped;
    return html`<li key=${label} class=${MM.cls(review && 'review', !skip && i < current && 'done', i === current && 'current')} aria-current=${i === current ? 'step' : undefined}>
      <span class="n">${skip ? html`<${I} name="minus" />` : i < current ? html`<${I} name="check" />` : review ? html`<${I} name="eye" />` : i + 1}</span>${skip ? `${label} (tas per telefon)` : label}</li>`;
  })}</ol>`;
  const CONTACTS = [{ value: 'sms', label: 'SMS', icon: 'message' }, { value: 'phone', label: 'Telefon', icon: 'phone' }, { value: 'email', label: 'E-post', icon: 'mail' }, { value: 'letter', label: 'Brev', icon: 'file' }];
  const initialOrder = (keep) => {
    const pid = pidNow(); const me = MM.persona() || {};
    const start = d.addDays(d.monday(d.today()), 14);
    const base = keep || { contactName: me.name || '', unit: me.unit || '', contactPhone: me.phone || '', contactEmail: me.email || '', buyerReference: sel.komLastBuyerRef(pid), desiredStart: start, plannedWeeks: null, plannedEnd: '', endTouched: false };
    return { ...base, protectedIdentity: null, firstName: '', lastName: '', pnr: '', phone: '', email: '', city: '', preferredContact: 'sms', address: '', accessibilityNeeds: '', primaryArea: '', secondaryArea: '', vocationalTrack: '', background: '' };
  };
  const validateStep = (step, f) => {
    const e = {};
    if (step === 0) {
      if (!f.contactName.trim()) e.contactName = 'Skriv ditt namn.';
      if (f.contactPhone.replace(/\D/g, '').length < 7) e.contactPhone = 'Skriv ett telefonnummer där vi når dig.';
      if (!MM.valid.email(f.contactEmail)) e.contactEmail = 'Skriv en hel e-postadress.';
      const re = refError(f.buyerReference); if (re) e.buyerReference = re;
      if (!f.desiredStart) e.desiredStart = 'Välj ett önskat startdatum.';
      else if (f.desiredStart < d.today()) e.desiredStart = 'Datumet har redan passerat. Välj ett senare datum.';
      if (!f.plannedWeeks) e.plannedWeeks = 'Välj hur många veckor insatsen ska pågå.';
      if (f.plannedEnd && f.desiredStart && f.plannedEnd <= f.desiredStart) e.plannedEnd = 'Slutdatumet måste komma efter startdatumet.';
    }
    if (step === 1) {
      if (f.protectedIdentity == null) e.protectedIdentity = 'Svara ja eller nej.';
      if (!f.firstName.trim()) e.firstName = 'Skriv deltagarens förnamn.';
      if (!f.lastName.trim()) e.lastName = 'Skriv deltagarens efternamn.';
      if (!MM.valid.pnrFormat(f.pnr)) e.pnr = 'Skriv tolv siffror så här: ÅÅÅÅMMDD-NNNN.';
      else if (sel.duplicateActive(f.pnr).length) e.pnr = 'Personen har redan en pågående insats. En person kan inte ha två pågående insatser samtidigt.';
      if (f.protectedIdentity === false) {
        if (['sms', 'phone'].includes(f.preferredContact) && f.phone.replace(/\D/g, '').length < 8) e.phone = 'Skriv deltagarens telefonnummer. Vi behöver det för kallelsen.';
        if (f.email.trim() && !MM.valid.email(f.email)) e.email = 'Skriv en hel e-postadress, eller lämna fältet tomt.';
        if (f.preferredContact === 'email' && !f.email.trim()) e.email = 'Skriv deltagarens e-postadress. Du har valt e-post som kontaktväg.';
        if (!f.city.trim()) e.city = 'Skriv deltagarens bostadsort.';
        if (f.preferredContact === 'letter' && f.address.trim().length < 6) e.address = 'Skriv hela adressen. Du har valt att kallelsen ska skickas med brev.';
      }
    }
    if (step === 2) {
      if (!f.primaryArea) e.primaryArea = 'Välj ett avtalsområde.';
      if (f.secondaryArea && f.secondaryArea === f.primaryArea) e.secondaryArea = 'Välj ett annat område än det första, eller inget.';
    }
    return e;
  };

  const OrderView = () => {
    const st = MM.useStore(); const pid = pidNow();
    const [f, setF] = useState(() => initialOrder());
    const [step, setStep] = useState(0);
    const [showErr, setShowErr] = useState(false);
    const [refTouched, setRefTouched] = useState(false);
    const [done, setDone] = useState(null);
    const headRef = useRef(null);
    useEffect(() => { try { window.scrollTo({ top: 0 }); if (headRef.current) headRef.current.focus({ preventScroll: true }); } catch (e) { /* */ } }, [step, !!done]);
    const set = (k) => (v) => setF((x) => {
      const n = { ...x, [k]: v };
      if ((k === 'desiredStart' || k === 'plannedWeeks') && !x.endTouched) n.plannedEnd = endFor(n.desiredStart, n.plannedWeeks);
      if (k === 'plannedEnd') n.endTouched = true;
      if (k === 'primaryArea' && n.secondaryArea === v) n.secondaryArea = '';
      return n;
    });
    const errs = validateStep(step, f);
    const E = (k) => (showErr ? errs[k] : null);
    const refErr = (refTouched || showErr) ? refError(f.buyerReference) : null;
    const dups = MM.valid.pnrFormat(f.pnr) ? sel.duplicateActive(f.pnr) : [];
    const areas = st.areas.filter((a) => a.contractId === 'c-bot' && a.active);
    const price = f.primaryArea ? sel.priceFor(f.primaryArea, f.desiredStart || d.today()) : 0;
    const next = () => {
      if (Object.keys(errs).length) { setShowErr(true); MM.toast('Några uppgifter saknas eller behöver rättas. Se markeringarna.', 'red'); return; }
      setShowErr(false);
      setStep(step === 1 && f.protectedIdentity ? 3 : step + 1);
    };
    const back = () => { setShowErr(false); setStep(step === 3 && f.protectedIdentity ? 1 : Math.max(0, step - 1)); };
    const submit = () => {
      for (const s of (f.protectedIdentity ? [0, 1] : [0, 1, 2])) { if (Object.keys(validateStep(s, f)).length) { setStep(s); setShowErr(true); MM.toast('Några uppgifter behöver rättas innan du kan skicka.', 'red'); return; } }
      const common = { firstName: f.firstName.trim(), lastName: f.lastName.trim(), pnr: f.pnr.trim(), source: 'portal', referrerId: pid };
      // Skyddade personuppgifter: om deltagaren sparas bara namn och personnummer, men beställningens uppgifter från steg 1 följer med.
      const order = { buyerReference: f.buyerReference.trim(), desiredStart: f.desiredStart, plannedWeeks: f.plannedWeeks, plannedEnd: f.plannedEnd || null };
      const payload = f.protectedIdentity ? { ...common, ...order, protectedIdentity: true }
        : { ...common, protectedIdentity: false, phone: f.phone.trim(), email: f.email.trim(), city: f.city.trim(), preferredContact: f.preferredContact,
          address: f.preferredContact === 'letter' ? f.address.trim() : null, accessibilityNeeds: f.accessibilityNeeds.trim(), buyerReference: f.buyerReference.trim(),
          primaryArea: f.primaryArea, secondaryArea: f.secondaryArea || null, vocationalTrack: f.vocationalTrack.trim(), desiredStart: f.desiredStart,
          plannedWeeks: f.plannedWeeks, plannedEnd: f.plannedEnd || null, background: f.background.trim() };
      const res = MM.dispatch('case.create', payload);
      if (!res) return;
      if (res.error === 'buyer_ref') { setStep(0); setShowErr(true); setRefTouched(true); MM.toast('Beställarreferensen behöver rättas.', 'red'); return; }
      const me = MM.persona() || {};
      if (f.contactName !== me.name || f.contactPhone !== me.phone || f.contactEmail !== me.email) {
        MM.dispatch('case.update', { caseId: res.caseId, patch: { ordererContact: { name: f.contactName.trim(), unit: f.unit, phone: f.contactPhone.trim(), email: f.contactEmail.trim() } } }, { silent: true });
      }
      setDone(res);
      MM.toast(`Beställningen är skickad. Ärendenummer ${res.number}.`, 'blue');
    };
    const again = () => { setDone(null); setF(initialOrder({ contactName: f.contactName, unit: f.unit, contactPhone: f.contactPhone, contactEmail: f.contactEmail, buyerReference: f.buyerReference, desiredStart: f.desiredStart, plannedWeeks: null, plannedEnd: '', endTouched: false })); setStep(0); setShowErr(false); };

    if (done) return html`<${OrderDone} res=${done} onAgain=${again} headRef=${headRef} />`;

    const stepHead = html`<div class="stack-sm">
      <div class="eyebrow">${step < DATA_STEPS ? `Steg ${step + 1} av ${DATA_STEPS}` : 'Granska innan du skickar'}</div>
      <h2 tabIndex="-1" ref=${headRef} style="outline:none">${STEPS[step]}</h2>
    </div>`;
    const nav = html`<div class="kom-actions between">
      ${step > 0 ? html`<${ui.Btn} kind="secondary" icon="arrow-left" onClick=${back}>Tillbaka<//>` : html`<${ui.Btn} kind="ghost" icon="x" onClick=${() => MM.nav('kom.start', {})}>Avbryt<//>`}
      ${step < 3 ? html`<${ui.Btn} kind="primary" size="lg" iconRight="arrow-right" onClick=${next}>${step === 1 && f.protectedIdentity ? 'Nästa: granska' : `Nästa: ${STEPS[step + 1].toLowerCase()}`}<//>`
        : html`<${ui.Btn} kind="primary" size="lg" icon="send" onClick=${submit}>Skicka beställningen<//>`}
    </div>`;

    let body = null;
    if (step === 0) body = html`<div class="stack">
      <${ui.Notice} tone="info" title="Uppgifterna kommer från ditt konto">Ändra om någon annan ska vara kontaktperson för den här beställningen.<//>
      <div class="form-grid">
        <${ui.Field} id="kom-o-name" label="Ditt namn" required error=${E('contactName')} help="Den som beställer och är kontaktperson hos kommunen.">
          <${ui.Input} id="kom-o-name" value=${f.contactName} onInput=${set('contactName')} invalid=${!!E('contactName')} autoComplete="name" /><//>
        <${ui.Field} id="kom-o-unit" label="Enhet" help="Hämtas från ditt konto.">
          <${ui.Input} id="kom-o-unit" value=${f.unit} onInput=${set('unit')} /><//>
        <${ui.Field} id="kom-o-phone" label="Ditt telefonnummer" required error=${E('contactPhone')} help="Hit ringer vi om vi har frågor om beställningen.">
          <${ui.Input} id="kom-o-phone" type="tel" value=${f.contactPhone} onInput=${set('contactPhone')} invalid=${!!E('contactPhone')} autoComplete="tel" /><//>
        <${ui.Field} id="kom-o-email" label="Din e-postadress" required error=${E('contactEmail')} help="Hit skickar vi ordererkännandet. Mejlet innehåller bara ärendenumret.">
          <${ui.Input} id="kom-o-email" type="email" value=${f.contactEmail} onInput=${set('contactEmail')} invalid=${!!E('contactEmail')} autoComplete="email" /><//>
      </div>
      <${ui.Field} id="kom-o-ref" label="Beställarreferens" required error=${refErr}
        help=${`${MM.valid.buyerRefLengthText()} siffror, bara siffror. Referensen behövs för att fakturan ska hamna rätt hos kommunen. Den du använde senast är redan ifylld.`}>
        <${ui.Input} id="kom-o-ref" value=${f.buyerReference} inputMode="numeric" maxLength=${14} invalid=${!!refErr} onInput=${(v) => { set('buyerReference')(v); setRefTouched(true); }} /><//>
      ${!refErr && refTouched && html`<${OkLine}>Beställarreferensen har rätt format.<//>`}
      <div class="form-grid">
        <${ui.Field} id="kom-o-start" label="Önskat startdatum" required error=${E('desiredStart')} help=${`Vi bokar första mötet inom ${firstMeetingWithin()} från beställningen. Startdatumet bekräftas i orderbekräftelsen.`}>
          <${ui.Input} id="kom-o-start" type="date" value=${f.desiredStart} onInput=${set('desiredStart')} invalid=${!!E('desiredStart')} /><//>
        <${ui.Field} id="kom-o-end" label="Planerat slutdatum" error=${E('plannedEnd')} help="Räknas fram från startdatum och antal veckor. Du kan ändra det.">
          <${ui.Input} id="kom-o-end" type="date" value=${f.plannedEnd} onInput=${set('plannedEnd')} invalid=${!!E('plannedEnd')} /><//>
      </div>
      <${ui.Field} id="kom-o-weeks" label="Planerad omfattning i veckor" required error=${E('plannedWeeks')} help=${`Insatser är oftast mellan ${weekRange().min} och ${weekRange().max} veckor. Fakturan räknas per vecka som deltagaren är inskriven.`}>
        <${ui.Seg} id="kom-o-weeks" ariaLabel="Planerad omfattning i veckor" value=${f.plannedWeeks} onChange=${set('plannedWeeks')} options=${weekOptions().map((n) => ({ value: n, label: String(n) }))} /><//>
    </div>`;

    if (step === 1) body = html`<div class="stack">
      <${ui.Notice} tone="info" title="Lämna bara de uppgifter som behövs">Vi använder uppgifterna för att kalla deltagaren och planera insatsen. Skriv inga diagnoser, inga uppgifter om hälsa och inga uppgifter om brott. Beskriv i stället vad personen behöver.<//>
      <${ui.Field} id="kom-o-prot" label="Har deltagaren skyddade personuppgifter?" required error=${E('protectedIdentity')} help="Till exempel sekretessmarkering eller skyddad folkbokföring. Är du osäker, välj Ja.">
        <${ui.Seg} id="kom-o-prot" ariaLabel="Skyddade personuppgifter" value=${f.protectedIdentity} onChange=${set('protectedIdentity')} options=${[{ value: false, label: 'Nej' }, { value: true, label: 'Ja', icon: 'lock' }]} /><//>
      ${f.protectedIdentity === true && html`<${ui.Notice} tone="critical" title=${`Ring oss på ${SAFE_PHONE} så tar vi resten enligt den säkra rutinen.`}>
        Fyll bara i namn och personnummer här. Om deltagaren sparar vi bara namn och personnummer. Uppgifterna om beställningen från steg 1, till exempel beställarreferensen, sparas som vanligt. Vi skickar inga mejl eller SMS till deltagaren och använder ingen artificiell intelligens i ärendet.<//>`}
      <div class="form-grid">
        <${ui.Field} id="kom-o-fn" label="Förnamn" required error=${E('firstName')} help="Som i folkbokföringen.">
          <${ui.Input} id="kom-o-fn" value=${f.firstName} onInput=${set('firstName')} invalid=${!!E('firstName')} /><//>
        <${ui.Field} id="kom-o-ln" label="Efternamn" required error=${E('lastName')} help="Som i folkbokföringen.">
          <${ui.Input} id="kom-o-ln" value=${f.lastName} onInput=${set('lastName')} invalid=${!!E('lastName')} /><//>
      </div>
      <${ui.Field} id="kom-o-pnr" label="Personnummer eller samordningsnummer" required error=${E('pnr') || (dups.length ? 'Personen har redan en pågående insats.' : null)}
        help="Tolv siffror: ÅÅÅÅMMDD-NNNN. Samordningsnummer skrivs på samma sätt. Numret visas bara maskerat i tjänsten.">
        <${ui.Input} id="kom-o-pnr" value=${f.pnr} inputMode="numeric" maxLength=${15} onInput=${set('pnr')} invalid=${!!E('pnr') || dups.length > 0} /><//>
      ${dups.length > 0 && html`<${DupNotice} dups=${dups} />`}
      ${f.protectedIdentity === false && html`<div class="stack">
        <div class="form-grid">
          <${ui.Field} id="kom-o-dphone" label="Deltagarens telefonnummer" required=${['sms', 'phone'].includes(f.preferredContact)} error=${E('phone')} help="För kallelse och påminnelser. SMS:en innehåller aldrig personuppgifter.">
            <${ui.Input} id="kom-o-dphone" type="tel" value=${f.phone} onInput=${set('phone')} invalid=${!!E('phone')} /><//>
          <${ui.Field} id="kom-o-demail" label="Deltagarens e-postadress" required=${f.preferredContact === 'email'} error=${E('email')} help="Fyll bara i om deltagaren vill ha kallelsen med e-post.">
            <${ui.Input} id="kom-o-demail" type="email" value=${f.email} onInput=${set('email')} invalid=${!!E('email')} /><//>
        </div>
        <${ui.Field} id="kom-o-city" label="Bostadsort" required error=${E('city')} help="Bara orten, till exempel Alby, Tumba eller Fittja. Vi behöver den för att planera plats och resor.">
          <${ui.Input} id="kom-o-city" value=${f.city} onInput=${set('city')} invalid=${!!E('city')} /><//>
        <${ui.Field} id="kom-o-contact" label="Hur vill deltagaren bli kontaktad?" required help="Vi kallar till första mötet på det sätt du väljer här.">
          <${ui.Seg} id="kom-o-contact" ariaLabel="Föredragen kontaktväg" value=${f.preferredContact} onChange=${set('preferredContact')} options=${CONTACTS} /><//>
        ${f.preferredContact === 'letter' && html`<${ui.Field} id="kom-o-addr" label="Fullständig adress" required error=${E('address')} help="Behövs bara när kallelsen skickas med brev. Annars sparar vi ingen adress.">
          <${ui.TextArea} id="kom-o-addr" rows=${2} value=${f.address} onInput=${set('address')} invalid=${!!E('address')} /><//>`}
        <${ui.Field} id="kom-o-needs" label="Behov av anpassning" help="Beskriv vad som behövs, inte varför. Till exempel: tolk på somaliska, skriftliga instruktioner eller lokal utan trappor. Skriv inga diagnoser.">
          <${ui.TextArea} id="kom-o-needs" rows=${3} maxLength=${500} value=${f.accessibilityNeeds} onInput=${set('accessibilityNeeds')} /><//>
      </div>`}
    </div>`;

    if (step === 2) {
      const tracks = (MM.seedConstants && MM.seedConstants.TRACKS && MM.seedConstants.TRACKS[f.primaryArea]) || [];
      body = html`<div class="stack">
        <${ui.Field} id="kom-o-area" label="Avtalsområde" required error=${E('primaryArea')} help="Välj det område som passar deltagarens mål bäst. Området styr innehållet i insatsen och veckopriset.">
          <${ui.Select} id="kom-o-area" value=${f.primaryArea} onChange=${set('primaryArea')} placeholder="Välj avtalsområde" invalid=${!!E('primaryArea')} options=${areas.map((a) => ({ value: a.code, label: `${a.code} – ${a.name}` }))} /><//>
        <${ui.Field} id="kom-o-area2" label="Alternativt avtalsområde" error=${E('secondaryArea')} help="Om det första området inte passar efter kartläggningen. Du kan lämna det tomt.">
          <${ui.Select} id="kom-o-area2" value=${f.secondaryArea} onChange=${set('secondaryArea')} placeholder="Inget alternativt område" options=${areas.filter((a) => a.code !== f.primaryArea).map((a) => ({ value: a.code, label: `${a.code} – ${a.name}` }))} /><//>
        <${ui.Field} id="kom-o-track" label="Önskat yrkesspår" help=${tracks.length ? 'Välj ett förslag eller skriv ett eget. Coachen stämmer av yrkesspåret under kartläggningen.' : 'Skriv det yrke deltagaren siktar mot, om du vet. Coachen stämmer av yrkesspåret under kartläggningen.'}>
          ${tracks.length > 0 && html`<${ui.Seg} ariaLabel="Förslag på yrkesspår" value=${f.vocationalTrack} onChange=${set('vocationalTrack')} options=${tracks} />`}
          <${ui.Input} id="kom-o-track" value=${f.vocationalTrack} onInput=${set('vocationalTrack')} placeholder="Eget yrkesspår" /><//>
        <${ui.Field} id="kom-o-bg" label="Bakgrund" help="Några meningar om erfarenhet, utbildning och mål. Skriv inga diagnoser eller andra känsliga uppgifter.">
          <${ui.TextArea} id="kom-o-bg" rows=${4} maxLength=${1000} value=${f.background} onInput=${set('background')} /><//>
      </div>`;
    }

    if (step === 3) {
      const due = d.addWorkingDays(d.now(), 1);
      const orderItems = [['Beställare', `${f.contactName}, ${f.unit}`], ['Telefon', f.contactPhone], ['E-post', f.contactEmail], ['Beställarreferens', f.buyerReference],
        ['Önskat startdatum', fD(f.desiredStart)], ['Planerat slutdatum', f.plannedEnd ? fD(f.plannedEnd) : 'Inte angivet'], ['Omfattning', `${f.plannedWeeks} veckor`]];
      const Sec = ({ title, to, items }) => html`<div class="kom-review">
        <div class="row-between"><div class="kom-section-label">${title}</div><${ui.Btn} kind="ghost" icon="edit" onClick=${() => { setShowErr(false); setStep(to); }}>Ändra<//></div>
        <${ui.Kv} items=${items} /></div>`;
      body = f.protectedIdentity ? html`<div class="stack">
          <${ui.Notice} tone="critical" title=${`Ring oss på ${SAFE_PHONE} så tar vi resten enligt den säkra rutinen.`}>Om deltagaren sparar vi bara namn och personnummer. Avtalsområde och övriga uppgifter tar vi i telefon. Mejlet du får är en kort bekräftelse på att vi har tagit emot beställningen – utan ärendenummer och utan personuppgifter.<//>
          <${ui.Card}>
            <div class="stack">
              <${Sec} title="Beställning och kontakt" to=${0} items=${orderItems} />
              <${Sec} title="Deltagare" to=${1} items=${[['Namn', `${f.firstName} ${f.lastName}`], ['Personnummer', maskPnr(f.pnr)], ['Skyddade personuppgifter', 'Ja']]} />
            </div>
          <//>
        </div>`
        : html`<div class="stack">
          <${ui.Card}>
            <div class="stack">
              <${Sec} title="Beställning och kontakt" to=${0} items=${orderItems} />
              <${Sec} title="Deltagare" to=${1} items=${[['Namn', `${f.firstName} ${f.lastName}`], ['Personnummer', maskPnr(f.pnr)], ['Telefon', f.phone || 'Inte angivet'], ['E-post', f.email || 'Inte angivet'],
                ['Bostadsort', f.city], ['Kontaktväg', sel.contactLabel(f.preferredContact)], f.preferredContact === 'letter' && ['Adress', f.address], ['Anpassning', f.accessibilityNeeds || 'Inget angivet'], ['Skyddade personuppgifter', 'Nej']]} />
              <${Sec} title="Avtalsområde" to=${2} items=${[['Avtalsområde', sel.areaName(f.primaryArea)], ['Alternativt område', f.secondaryArea ? sel.areaName(f.secondaryArea) : 'Inget'], ['Yrkesspår', f.vocationalTrack || 'Inte angivet'], ['Bakgrund', f.background || 'Inte angivet']]} />
            </div>
          <//>
          <${ui.Card} title="Beställningens värde" icon="card">
            <div class="stack-sm">
              <div class="kom-bigval">${fmt.kr(price * (f.plannedWeeks || 0))}</div>
              <div class="muted">${f.plannedWeeks} veckor × ${fmt.kr(price)} per vecka, exklusive moms. Fakturan räknas per vecka som deltagaren är inskriven. Pausade veckor faktureras inte.</div>
            </div>
          <//>
          <${ui.Notice} tone="info" title="Det här händer när du skickar">Beställningen får ett ärendenummer direkt. Du ser ordererkännandet här på skärmen och får det i ett mejl. Mejlet innehåller bara ärendenumret – inga personuppgifter. Ärendenumret är beställningens nummer. Senast ${fDTL(due)} får du besked om startdatum och coach.<//>
        </div>`;
    }

    return html`<div class="kom">
      <${Head} eyebrow="Botkyrka kommun · beställning" title="Beställ ny insats"
        lead=${step === 0 ? 'Samma uppgifter som i beställningsmallen, i tre korta steg och en granskning. Du kan gå tillbaka och ändra innan du skickar.' : null} />
      <${KomStepper} current=${step} skipped=${f.protectedIdentity && step === 3 ? 2 : null} />
      <${ui.Card}><div class="stack">${stepHead}${body}</div><//>
      ${nav}
      <${ui.DemoNote}>Beställningen sparas bara i den här webbläsaren. Mejlet skickas inte på riktigt – utskicket syns i utskicksloggen hos Miljonbemanning. Priserna är exempel.<//>
      <div class="kom-actions"><${ui.PerspectiveSwitch} role="samordnare" view="sam.inkorg" label="Se hur beställningar tas emot hos Miljonbemanning" /></div>
    </div>`;
  };

  const DupNotice = ({ dups }) => html`<${ui.Notice} tone="critical" title="Personen har redan en pågående insats">
    <div class="stack-sm">
      <span>En person kan ha flera insatser över tid, men inte två samtidigt.</span>
      ${dups.map((c) => (sel.access(c) !== 'none'
        ? html`<span class="row-sm"><span>Pågående insats: <b>${c.number}</b> (${(STATUS[c.status] || {}).label || sel.statusLabel(c.status)}).</span><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('kom.deltagare', { caseId: c.id })}>Öppna insatsen<//></span>`
        : html`<span>Insatsen är beställd av en annan handläggare. Ring oss på ${SAFE_PHONE} så hjälper vi dig.</span>`))}
    </div><//>`;

  const OrderDone = ({ res, onAgain, headRef }) => {
    const st = MM.useStore(); const c = sel.caseById(res.caseId);
    if (!c) return html`<div class="kom"><${ui.Notice} tone="critical" title="Beställningen hittades inte">Ladda om sidan och försök igen.<//></div>`;
    const prot = isProtected(c);
    const mail = st.notifications.filter((n) => (n.caseId === c.id && n.template === 'ordererkannande') || (prot && n.template === 'generisk_mottagningsbekraftelse')).slice(-1)[0];
    return html`<div class="kom">
      <${Head} eyebrow="Botkyrka kommun · beställning" title="Tack! Beställningen är skickad" />
      <${ui.Card} tone="blue">
        <div class="stack">
          <div class="stack-sm">
            <div class="kom-section-label">Ärendenummer</div>
            <div class="kom-casenum" tabIndex="-1" ref=${headRef} style="outline:none">${c.number}</div>
            <p>Ärendenumret är beställningens nummer. Använd det i stället för personnummer när du kontaktar oss om deltagaren.</p>
          </div>
          ${prot ? html`<${ui.Notice} tone="critical" title=${`Ring oss på ${SAFE_PHONE} så tar vi resten enligt den säkra rutinen.`}>Deltagaren har skyddade personuppgifter. Om deltagaren har vi bara sparat namn och personnummer. Beställarreferensen, startdatumet och omfattningen från steg 1 är sparade. Avtalsansvarig på Miljonbemanning har fått en uppgift att ringa dig.<//>`
            : html`<div class="stack-sm"><div class="kom-section-label">Ordererkännande</div><p>${fullText(sel.ackTextFor(c))}</p></div>`}
        </div>
      <//>
      ${mail && html`<${ui.Card} title="Mejlet du får" icon="mail">
        <div class="stack-sm">
          <div class="kom-mail">
            <div class="kom-mail-meta"><span>Från: ${NOTIFY_FROM}</span><span class="kom-break">Till: ${mail.to}</span><span>${fDT(mail.at)}</span></div>
            <div>${fullText(mail.body)}</div>
          </div>
          <${OkLine}>${prot ? 'Mejlet är en kort bekräftelse utan ärendenummer och utan personuppgifter.' : 'Mejlet innehåller bara ärendenumret – inga personuppgifter.'}<//>
        </div><//>`}
      <${ui.Card} title="Så här går det vidare" icon="list">
        <${ui.Timeline} items=${prot ? [
          { icon: 'check', filled: true, title: 'Beställningen är mottagen', sub: fDTL(c.referredAt), body: html`<span>Den har fått ärendenummer ${c.number}. Ingen automatisk behandling görs.</span>` },
          { icon: 'phone', title: 'Samtal med Miljonbemanning', sub: `Ring ${SAFE_PHONE}`, body: html`<span>Vi går igenom avtalsområde, kontaktväg och övriga uppgifter med dig enligt den säkra rutinen.</span>` },
          { icon: 'calendar', title: 'Orderbekräftelse', sub: 'Efter telefonsamtalet', body: html`<span>Du får startdatum och ansvarig coach i portalen.</span>` },
          { icon: 'users', title: 'Första mötet med deltagaren', sub: 'Bokas efter telefonsamtalet', body: html`<span>Miljonbemanning kallar deltagaren på det sätt ni kommer överens om i samtalet. Inga mejl eller SMS går till deltagaren.</span>` },
        ] : [
          { icon: 'check', filled: true, title: 'Beställningen är mottagen', sub: fDTL(c.referredAt), body: html`<span>Den har fått ärendenummer ${c.number}.</span>` },
          { icon: 'calendar', title: 'Orderbekräftelse', sub: `Senast ${fDTL(sel.avropDue(c))}`, body: html`<span>Du får startdatum, ansvarig coach och tid för första mötet i portalen.</span>` },
          { icon: 'users', title: 'Första mötet med deltagaren', sub: `Senast ${fD(sel.firstMeetingDue(c))}`, body: html`<span>Deltagaren får en kallelse på det sätt du valde (${sel.contactLabel((sel.person(c) || {}).preferredContact).toLowerCase()}).</span>` },
        ]} />
      <//>
      <div class="kom-actions">
        <${ui.Btn} kind="primary" size="lg" icon="plus" onClick=${onAgain}>Beställ en till<//>
        <${ui.Btn} kind="secondary" size="lg" iconRight="arrow-right" onClick=${() => MM.nav('kom.deltagare', { caseId: c.id })}>Se beställningen<//>
      </div>
      <div class="kom-actions">${prot
        ? html`<${ui.PerspectiveSwitch} role="avtalsansvarig" view="sam.inkorg" params=${{ caseId: c.id }} label="Se hur beställningen landar hos Miljonbemanning" />`
        : html`<${ui.PerspectiveSwitch} role="samordnare" view="sam.inkorg" params=${{ caseId: c.id }} label="Se hur beställningen landar hos Miljonbemanning" />`}</div>
    </div>`;
  };

  // ============================================================ kom.deltagare
  // Begrepp: deltagare = personen, insats = det kommunen beställt, ärendenummer = beställningens nummer.
  const DECLINED_VISIBLE_DAYS = 30;
  const recentlyDeclined = (c) => c.status === 'declined' && !!c.declinedAt && d.diffDays(c.declinedAt.slice(0, 10), d.today()) <= DECLINED_VISIBLE_DAYS;
  const LIST_FILTERS = [{ value: 'aktuella', label: 'Pågår och på väg' }, { value: 'avslutade', label: 'Avslutade' }, { value: 'avbojda', label: 'Avböjda' }, { value: 'alla', label: 'Alla' }];
  const ORDER = { declined: -1, received: 0, acknowledged: 1, confirmed: 2, active: 3, paused: 4, closed: 5 };
  const CaseList = () => {
    MM.useStore(); const chef = isChef();
    const [filter, setFilter] = useState('aktuella');
    const [q, setQ] = useState('');
    const [whoId, setWho] = useState('');
    const [limit, setLimit] = useState(20);
    const all = sel.visibleCases();
    const unreadByCase = MM.groupBy(sel.komUnreadMessages(), (m) => m.caseId);
    // Avböjda beställningar syns i standardfiltret en tid, så att handläggaren hittar orsaken.
    const isCur = (c) => !['closed', 'declined'].includes(c.status) || recentlyDeclined(c);
    const match = { aktuella: isCur, avslutade: (c) => c.status === 'closed', avbojda: (c) => c.status === 'declined', alla: () => true };
    const counts = {}; for (const k of Object.keys(match)) counts[k] = all.filter(match[k]).length;
    const term = q.trim().toLowerCase();
    const rows = all.filter((c) => match[filter](c) && (!whoId || c.referrerId === whoId)
      && (!term || c.number.toLowerCase().includes(term) || nameFor(c).toLowerCase().includes(term)))
      .sort((a, b) => (unreadByCase[b.id] ? 1 : 0) - (unreadByCase[a.id] ? 1 : 0) || ORDER[a.status] - ORDER[b.status] || (a.referredAt < b.referredAt ? 1 : -1));
    const referrers = MM.uniq(all.map((c) => c.referrerId)).map((id) => ({ value: id, label: MM.personName(id) })).sort(MM.by('label'));
    const scopeUnset = MM.isUnset(MM.cfg().customerVisibility.scope);
    return html`<div class="kom">
      <${Head} eyebrow=${chef ? 'Botkyrka kommun · Arbetsmarknadsenheten' : 'Botkyrka kommun'} title=${chef ? 'Enhetens deltagare' : 'Mina deltagare'}
        back=${chef ? { label: 'Till beställarrapporten', onClick: () => MM.nav('kom.chef', {}) } : { label: 'Till start', onClick: () => MM.nav('kom.start', {}) }}
        lead=${chef ? 'Alla deltagare som enhetens handläggare har beställt en insats för. Välj en deltagare för att se hur insatsen går.' : 'De deltagare som du har beställt en insats för. Välj en deltagare för att se hur insatsen går, rapporter och meddelanden.'} />
      <div class="stack">
        <${ui.Seg} ariaLabel="Visa deltagare" value=${filter} onChange=${(v) => { setFilter(v); setLimit(20); }} options=${LIST_FILTERS.filter((o) => o.value !== 'avbojda' || counts.avbojda > 0).map((o) => ({ ...o, label: `${o.label} (${counts[o.value]})` }))} />
        <div class="form-grid">
          <${ui.Field} id="kom-sok" label="Sök" help="Skriv ett namn eller ett ärendenummer, till exempel BOT-26-0143. Ärendenumret är beställningens nummer.">
            <${ui.Input} id="kom-sok" type="search" value=${q} onInput=${(v) => { setQ(v); setLimit(20); }} /><//>
          ${chef && html`<${ui.Field} id="kom-who" label="Handläggare" help="Visa deltagare som en viss handläggare har beställt en insats för.">
            <${ui.Select} id="kom-who" value=${whoId} onChange=${(v) => { setWho(v); setLimit(20); }} placeholder="Alla handläggare" options=${referrers} /><//>`}
        </div>
      </div>
      <${ui.Card} flush title=${`${rows.length} deltagare`} icon="users">
        ${rows.length === 0 ? html`<${ui.Empty} icon="search" title="Inga deltagare hittades">Prova ett annat filter eller en annan sökning.<//>` : html`<div class="list">
          ${rows.slice(0, limit).map((c) => { const n = (unreadByCase[c.id] || []).length;
            return html`<button type="button" key=${c.id} class=${MM.cls('list-item clickable', (n > 0 || (c.status === 'declined' && recentlyDeclined(c))) && 'kom-unread')} onClick=${() => MM.nav('kom.deltagare', { caseId: c.id })}>
              <span class="li-main">
                <span class="li-title">${nameFor(c)}</span>
                <span class="row-sm"><${KStatus} c=${c} />${n > 0 && html`<${ui.Badge} tone="dark" icon="message">${n === 1 ? '1 nytt meddelande' : `${n} nya meddelanden`}<//>`}${isProtected(c) && html`<${ui.Badge} tone="outline" icon="lock">Skyddade personuppgifter<//>`}</span>
                <span class="li-sub">${c.number} · ${c.primaryArea ? sel.areaName(c.primaryArea) : 'Avtalsområde inte valt än'}</span>
                <span class="li-sub">${shortStatus(c)}${chef ? ` · ${MM.personName(c.referrerId)}` : ''}</span>
              </span>
              <${I} name="chevron-right" cls="kom-chev" />
            </button>`; })}
        </div>`}
        <${MoreBtn} shown=${Math.min(limit, rows.length)} total=${rows.length} onMore=${() => setLimit(limit + 20)} />
      <//>
      ${scopeUnset && html`<${ui.DemoNote}>Om kommunens användare ska se sina egna deltagare, hela enhetens eller alla är inte bestämt ännu. I prototypen ser handläggaren sina egna och chefen alla.<//>`}
      <div class="kom-actions"><${ui.PerspectiveSwitch} role="samordnare" view="arenden.lista" label="Se listan hos Miljonbemanning" /></div>
    </div>`;
  };

  const TABS = ['oversikt', 'rapporter', 'meddelanden'];
  const CaseDetail = ({ caseId, tab: tab0 }) => {
    MM.useStore(); const pid = pidNow(); const chef = isChef();
    const c = sel.caseById(caseId); const access = c ? sel.access(c) : 'none';
    ui.useAuditView('case', c && access !== 'none' ? c.id : null, 'case.view');
    const [tab, setTab] = useState(TABS.includes(tab0) ? tab0 : 'oversikt');
    useEffect(() => { if (TABS.includes(tab0)) setTab(tab0); }, [tab0, caseId]);
    // Händelser i ärendet (avböjd, ny coach) räknas som lästa när handläggaren har öppnat ärendet.
    const unseenEvents = c && !chef ? sel.komEvents(pid).filter((e) => e.caseId === c.id && e.kind !== 'confirmed').length : 0;
    useEffect(() => { if (unseenEvents > 0) MM.dispatch('kom.caseSeen', { caseId: c.id }, { silent: true }); }, [unseenEvents, caseId]);
    const backBtn = { label: chef ? 'Alla enhetens deltagare' : 'Alla mina deltagare', onClick: () => MM.nav('kom.deltagare', {}) };
    if (!c) return html`<div class="kom"><${Head} title="Deltagaren hittades inte" back=${backBtn} /><${ui.Notice} tone="warn">Vi hittar ingen insats med det ärendenumret. Kontrollera numret.<//></div>`;
    if (access === 'none') return html`<div class="kom"><${Head} title="Du har inte tillgång" back=${backBtn} />
      <${ui.Notice} tone="warn" title="Insatsen är beställd av en annan handläggare">Du ser bara de deltagare som du själv har beställt en insats för. Så fungerar behörigheten i den riktiga tjänsten också.<//></div>`;
    const restricted = access === 'restricted';
    const reps = sel.reportsOf(c.id).filter(deliveredOk).filter((r) => (chef ? MM.cfg().customerVisibility.seesIndividualReports : (r.deliveredTo || []).includes(pid)));
    const unreadReps = chef ? 0 : reps.filter((r) => !r.openedAt).length;
    const msgs = sel.messagesOf(c.id);
    const unreadMsgs = chef ? [] : msgs.filter((m) => m.senderId !== pid && !(m.readBy || []).includes(pid));
    // Perspektivbyte: skyddade ärenden öppnas som avtalsansvarig (samordnaren har inte full åtkomst). Samma flik som här.
    const mbRole = isProtected(c) ? 'avtalsansvarig' : 'samordnare';
    const mbTab = tab === 'meddelanden' ? 'meddelanden' : tab === 'rapporter' ? 'rapporter' : 'oversikt';
    return html`<div class="kom">
      <${Head} back=${backBtn} eyebrow=${`Ärendenummer ${c.number}${c.primaryArea ? ` · ${sel.areaName(c.primaryArea)}` : ''}`} title=${nameFor(c)} lead=${statusText(c)}
        actions=${html`<${KStatus} c=${c} /><${ui.PerspectiveSwitch} role=${mbRole} view="arende.kort" params=${{ caseId: c.id, tab: mbTab }} label="Se samma deltagare hos Miljonbemanning" />`} />
      <${ui.Tabs} ariaLabel="Deltagarens insats" active=${tab} onChange=${setTab} tabs=${[
        { id: 'oversikt', label: 'Översikt', icon: 'home' },
        { id: 'rapporter', label: 'Rapporter', icon: 'file', count: unreadReps },
        { id: 'meddelanden', label: 'Meddelanden', icon: 'message', count: unreadMsgs.length },
      ]} />
      ${tab === 'oversikt' && html`<${CaseOverview} c=${c} unreadMsgs=${unreadMsgs} onTab=${setTab} restricted=${restricted} />`}
      ${tab === 'rapporter' && html`<${CaseReports} c=${c} reps=${reps} />`}
      ${tab === 'meddelanden' && (restricted
        ? html`<${ui.Notice} tone="info" icon="lock" title="Meddelandena visas bara för handläggaren">Deltagaren har skyddade personuppgifter. Meddelanden om deltagaren kan bara läsas av handläggaren som beställde insatsen (${MM.personName(c.referrerId)}).<//>`
        : html`<${CaseMessages} c=${c} />`)}
    </div>`;
  };

  const AttTile = ({ c, label, from, to }) => {
    const s = sel.attendanceStats(c.id, from, to); const reg = s.planned - s.unregistered;
    return html`<${ui.Kpi} label=${label} value=${s.rate == null ? '–' : fmt.pct(s.rate, 0)}
      sub=${reg > 0 ? `Närvarande ${s.present + s.late} av ${reg} tillfällen${s.unregistered > 0 ? ` · ${s.unregistered} inte registrerade än` : ''}` : s.planned > 0 ? 'Närvaron är inte registrerad än' : 'Inga tillfällen ännu'}>
      ${(s.absentValid > 0 || s.absentInvalid > 0) && html`<div class="small">Giltig frånvaro: ${s.absentValid} · Ogiltig frånvaro: ${s.absentInvalid}</div>`}<//>`;
  };

  const CaseOverview = ({ c, unreadMsgs, onTab, restricted }) => {
    const pid = pidNow(); const chef = isChef(); const prot = isProtected(c); const p = sel.person(c) || {};
    const oc = sel.reportsOf(c.id).find((r) => r.kind === 'order_confirmation' && deliveredOk(r));
    const meetingReqs = sel.messagesOf(c.id).filter((m) => m.kind === 'meeting_request');
    const lastReq = meetingReqs[meetingReqs.length - 1];
    const answered = lastReq && sel.messagesOf(c.id).some((m) => m.createdAt > lastReq.createdAt && String(m.senderId).startsWith('k-'));
    const tasks = chef ? [] : sel.komTasks(pid).filter((t) => (t.caseIds || []).includes(c.id));
    const mk = d.monthKey(d.today()); const prevMk = d.addMonths(mk, -1);
    const ra = c.status === 'active' ? sel.repeatedAbsence(c.id) : null;
    const bonusEvent = sel.eventsOf(c.id).find((e) => e.possibleBonus);
    const price = c.primaryArea ? sel.priceFor(c.primaryArea, c.startDate || c.plannedStart || d.today()) : 0;
    const weeks = c.orderValueWeeks || c.plannedWeeks;
    const referrer = MM.personName(c.referrerId);
    const coachChanges = S().caseStatusHistory.filter((h) => h.caseId === c.id && h.fromCoach && h.toCoach && h.fromCoach !== h.toCoach);
    const tl = [
      { icon: 'inbox', title: 'Mottagen', filled: true, sub: fDT(c.referredAt), body: html`<span>Beställningen kom in via ${({ portal: 'portalen', email: 'mejl', phone: 'telefon' })[c.source] || 'portalen'}${chef ? ` från ${referrer}` : ''}.</span>` },
      { icon: 'mail', title: 'Ordererkänd', filled: !!c.acknowledgedAt, sub: c.acknowledgedAt ? fDT(c.acknowledgedAt) : prot ? 'Ingen automatisk bekräftelse vid skyddade personuppgifter' : 'Väntar', body: c.acknowledgedAt ? html`<span>${Who(c)} fick ärendenummer ${c.number}. Det är beställningens nummer.</span>` : null },
    ];
    if (c.status === 'declined') tl.push({ icon: 'x', title: 'Avböjd', filled: true, tone: 'red', sub: fDT(c.declinedAt), body: html`<span>${c.declineReason || ''}</span>` });
    else {
      tl.push({ icon: 'check', title: 'Bekräftad', filled: !!c.confirmedAt, sub: c.confirmedAt ? fDT(c.confirmedAt) : c.acknowledgedAt ? `Senast ${fDT(sel.avropDue(c))}` : 'Efter telefonsamtalet', body: html`<span>Startdatum och coach är klara.</span>` });
      for (const h of coachChanges) tl.push({ icon: 'users', title: 'Ny ansvarig coach', filled: true, sub: fDT(h.changedAt), body: html`<span>${MM.personName(h.toCoach)} tog över efter ${MM.personName(h.fromCoach)}.</span>` });
      tl.push({ icon: 'activity', title: 'Pågår', filled: !!c.startDate && c.startDate <= d.today(), sub: c.startDate ? `Start ${fD(c.startDate)}` : c.plannedStart ? `Planerad start ${fD(c.plannedStart)}` : c.desiredStart ? `Önskad start ${fD(c.desiredStart)}` : '' });
      tl.push({ icon: 'check-square', title: 'Avslutad', filled: c.status === 'closed', sub: c.endDate ? `${fD(c.endDate)}${c.endReason ? ` · ${sel.endReasonLabel(c.endReason)}` : ''}` : c.plannedEnd ? `Planerat slut ${fD(c.plannedEnd)}` : '' });
    }
    return html`<div class="stack-lg">
      ${tasks.map((t) => html`<${ui.Notice} key=${t.id} tone="critical" icon="flag" title=${taskTitle(t)}>
        <div class="stack-sm"><span>${fullText(t.text)}</span><span class="small">Från Miljonbemanning, ${fDT(t.createdAt)}.</span>
          <span class="kom-actions"><${ui.Btn} kind="primary" icon="message" onClick=${() => onTab('meddelanden')}>Svara i meddelanden<//><${ui.Btn} kind="ghost" icon="check" onClick=${() => doneTask(t)}>Markera som klar<//></span></div><//>`)}
      ${unreadMsgs.length > 0 && html`<${ui.Notice} tone="critical" icon=${lastReq && !answered ? 'calendar' : 'message'} title=${unreadMsgs.length === 1 ? 'Du har ett nytt meddelande' : `Du har ${unreadMsgs.length} nya meddelanden`}>
        <div class="stack-sm"><span>Från ${senderLabel(unreadMsgs[unreadMsgs.length - 1].senderId, pid)}, ${fDT(unreadMsgs[unreadMsgs.length - 1].createdAt)}.</span>
          <span><${ui.Btn} kind="primary" icon="message" onClick=${() => onTab('meddelanden')}>Läs och svara<//></span></div><//>`}
      ${lastReq && !answered && unreadMsgs.length === 0 && !chef && html`<${ui.Card} title="Mötesförfrågan från coachen" icon="calendar" tone="blue">
        <div class="stack-sm"><p>${lastReq.body}</p><div class="small muted">${senderLabel(lastReq.senderId, pid)} · ${fDT(lastReq.createdAt)}</div>
          <span><${ui.Btn} kind="primary" icon="reply" onClick=${() => onTab('meddelanden')}>Svara<//></span></div><//>`}
      ${lastReq && !answered && chef && html`<${ui.Card} title="Mötesförfrågan till handläggaren" icon="calendar" tone="blue">
        <div class="stack-sm">
          ${restricted ? html`<p>Coachen har bett handläggaren om ett uppföljningsmöte. Innehållet visas bara för handläggaren eftersom deltagaren har skyddade personuppgifter.</p>` : html`<p>${lastReq.body}</p>`}
          <div class="small muted">Skickad till ${referrer} av ${senderLabel(lastReq.senderId, pid)}, ${fDT(lastReq.createdAt)}. Handläggaren har inte svarat än.</div>
          ${!restricted && html`<span><${ui.Btn} kind="secondary" icon="message" onClick=${() => onTab('meddelanden')}>Läs hela tråden<//></span>`}
        </div><//>`}
      <${ui.Card} title="Så långt har insatsen kommit" icon="list">
        <div class="stack">
          ${c.status === 'active' && html`<div class="stack-sm"><${ui.PhaseBar} phase=${c.phase} /><div class="small muted">Fas ${c.phase} av ${nPhases()} · ${phaseText(c.phase)}</div></div>`}
          <${ui.Timeline} items=${tl} />
        </div>
      <//>
      <div class="stack-lg">
        <${ui.Card} title="Orderbekräftelse" icon="check-circle">
          ${c.confirmedAt ? html`<div class="stack">
              <${ui.Kv} items=${[
                ['Startdatum', fD(c.startDate || c.plannedStart || (c.firstMeetingAt || '').slice(0, 10) || c.desiredStart)],
                ['Ansvarig coach', MM.personName(c.leadCoachId)],
                ['Första mötet', c.firstMeetingAt ? `${fDTL(c.firstMeetingAt)}, ${c.location || 'Alby'}` : `Bokas senast ${fD(sel.firstMeetingDue(c))}`],
                ['Planerad omfattning', `${weeks || '–'} veckor${c.plannedEnd ? `, till ${fD(c.plannedEnd)}` : ''}`],
                ['Beställningens värde', weeks ? html`<span>${fmt.kr(sel.orderValueOre(c))}</span><span class="small muted" style="display:block">${weeks} veckor × ${fmt.kr(price)}, exklusive moms</span>` : '–'],
                ['Beställarreferens', c.buyerReference || '–'],
                ['Bekräftad', fDT(c.confirmedAt)],
              ]} />
              ${(c.team || []).filter((t) => t.role !== 'lead_coach').length > 0 && html`<div class="small muted">Team: ${(c.team || []).filter((t) => t.role !== 'lead_coach').map((t) => `${MM.personName(t.userId)} (${sel.teamLabel(t.role).toLowerCase()})`).join(', ')}</div>`}
              ${oc && html`<span><${ui.Btn} kind="secondary" icon="file" onClick=${() => openReport(oc)}>Öppna orderbekräftelsen<//></span>`}
            </div>`
          : c.status === 'declined' ? html`<p>Beställningen avböjdes. Ingen orderbekräftelse skickas.</p>`
          : html`<div class="stack-sm"><p>${c.acknowledgedAt ? `${Who(c)} får orderbekräftelsen senast ${fDTL(sel.avropDue(c))}.` : `Miljonbemanning ringer ${chef ? 'handläggaren' : 'dig'} för att gå igenom beställningen enligt den säkra rutinen.`}</p>
              <p class="muted">Den innehåller startdatum, ansvarig coach, tid för första mötet, planerad omfattning och beställningens värde.</p></div>`}
          ${c.acknowledgedAt && html`<details class="kom-details" style="margin-top:14px"><summary><${I} name="chevron-down" />Visa ordererkännandet</summary>
            <div class="kom-mail" style="margin-top:8px"><div class="kom-mail-meta"><span>Skickat till ${chef ? referrer : 'dig'} ${fDT(c.acknowledgedAt)}</span></div><div>${fullText(sel.ackTextFor(c))}</div></div></details>`}
        <//>
        <${ui.Card} title="Närvaro" icon="check-square">
          ${c.startDate && c.startDate <= d.today() ? html`<div class="stack">
              <div class="grid-2" style="gap:12px">
                <${AttTile} c=${c} label=${`${d.MON[Number(mk.slice(5)) - 1]} hittills`} from=${`${mk}-01`} to=${d.today()} />
                <${AttTile} c=${c} label=${d.MON[Number(prevMk.slice(5)) - 1]} from=${`${prevMk}-01`} to=${d.monthEnd(prevMk)} />
              </div>
              ${ra && html`<${ui.Notice} tone="warn" title="Upprepad ogiltig frånvaro">${ra.length} gånger de senaste ${MM.cfg().attendance.repeatedAbsenceRule.withinDays} dagarna. Coachen tar kontakt med ${chef ? 'handläggaren' : 'dig'} om ett uppföljningsmöte.<//>`}
              <p class="muted">Närvaron redovisas varje vecka i veckorapporten${chef ? ' till handläggaren' : ''}. Frånvaro visas bara som kategori.</p>
              ${!chef && html`<span><${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav('kom.rapporter', { filter: 'weekly_attendance' })}>Till veckorapporterna<//></span>`}
            </div>`
          : html`<p class="muted">Närvaron visas här när insatsen har startat.</p>`}
        <//>
      </div>
      <${ui.Card} title="Uppgifter om deltagaren" icon="user">
        ${restricted ? html`<p>Deltagaren har skyddade personuppgifter. Bara handläggaren som beställde (${referrer}) ser namn och personnummer.</p>`
          : html`<div class="stack">
            <${ui.Kv} items=${[
              ['Personnummer', html`<${ui.MaskedPnr} caseId=${c.id} />`],
              !prot && ['Kontaktväg', sel.contactLabel(p.preferredContact)],
              !prot && ['Bostadsort', p.city || '–'],
              !prot && ['Anpassning', p.accessibilityNeeds || 'Inget angivet'],
              ['Avtalsområde', c.primaryArea ? `${sel.areaName(c.primaryArea)}${c.secondaryArea ? ` (alternativt ${sel.areaName(c.secondaryArea)})` : ''}` : '–'],
              ['Yrkesspår', c.vocationalTrack || '–'],
              chef && ['Handläggare', referrer],
            ]} />
            ${prot && html`<${ui.Notice} tone="info" icon="lock" title="Skyddade personuppgifter">Om deltagaren sparar vi bara namn och personnummer. Inga mejl eller SMS går till deltagaren.<//>`}
          </div>`}
      <//>
      ${bonusEvent && html`<${ui.Card} title="Bonusanspråk" icon="award" actions=${html`<${ui.BuildPhase} fas=${3} />`}>
        <p>Deltagaren har påbörjat arbete. Enligt avtalet kan det bli aktuellt med ett bonusanspråk som ${chef ? 'kommunen' : 'du'} beslutar om här. Modellen för bonus är inte bestämd än, så funktionen är avstängd.</p><//>`}
      ${!MM.cfg().customerVisibility.seesCoachNotes && html`<p class="muted small"><${I} name="eye-off" /> Coachens egna anteckningar visas inte för beställaren. Så står det i avtalet.</p>`}
    </div>`;
  };

  const ReportRow = ({ r, pid, showSub = true }) => {
    const unread = (r.deliveredTo || []).includes(pid) && !r.openedAt;
    const fixing = correctionPending(r);
    return html`<button type="button" class=${MM.cls('list-item clickable', unread && 'kom-unread')} onClick=${() => openReport(r)}>
      <${I} name=${KIND_ICON[r.kind] || 'file'} size="lg" />
      <span class="li-main">
        <span class="kom-titlerow"><span class="li-title">${reportTitle(r)}</span>${unread && html`<${ui.Badge} tone="dark">Ny<//>`}${fixing && html`<${ui.Badge} tone="outline" icon="edit">Rättas – en ny version kommer<//>`}</span>
        ${showSub && html`<span class="li-sub">${reportSub(r)}</span>`}
        <span class="li-sub">Levererad ${fDT(r.deliveredAt)}${r.version > 1 ? ` · version ${r.version}` : ''}${!unread && r.openedAt ? ` · läst ${fD(r.openedAt)}` : ''}</span>
      </span>
      <${I} name="chevron-right" cls="kom-chev" />
    </button>`;
  };

  const CaseReports = ({ c, reps }) => {
    const pid = pidNow(); const chef = isChef();
    const sorted = reps.slice().sort((a, b) => (!a.openedAt && !chef ? 0 : 1) - (!b.openedAt && !chef ? 0 : 1) || (a.deliveredAt < b.deliveredAt ? 1 : -1));
    return html`<div class="stack">
      <${ui.Card} flush title="Levererade rapporter" icon="file">
        ${sorted.length === 0 ? html`<${ui.Empty} icon="file" title="Inga rapporter än">Rapporterna visas här när Miljonbemanning har levererat dem. ${chef ? 'Handläggaren' : 'Du'} får ett mejl utan personuppgifter när en ny rapport finns.<//>`
          : html`<div class="list">${sorted.map((r) => html`<${ReportRow} key=${r.id} r=${r} pid=${pid} showSub=${false} />`)}</div>`}
      <//>
      ${sorted.some(correctionPending) && html`<p class="muted">En rapport som rättas finns kvar här tills Miljonbemanning har levererat den nya versionen.</p>`}
      <p class="muted">Rapporterna byggs bara av uppgifter som coachen har godkänt. ${chef ? 'Veckorapporterna om närvaro går till handläggaren och samlar alla handläggarens deltagare.' : 'Veckorapporterna om närvaro samlar alla dina deltagare och finns under Rapporter och meddelanden.'}</p>
      ${!chef && html`<span><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('kom.rapporter', {})}>Till alla rapporter<//></span>`}
    </div>`;
  };

  const CaseMessages = ({ c }) => {
    MM.useStore(); const pid = pidNow();
    const canWrite = MM.role() === 'kommun_handlaggare' && c.referrerId === pid;
    const msgs = sel.messagesOf(c.id);
    const unread = msgs.filter((m) => m.senderId !== pid && !(m.readBy || []).includes(pid));
    const [newIds] = useState(() => new Set(unread.map((m) => m.id)));
    const [text, setText] = useState(''); const [err, setErr] = useState(null);
    useEffect(() => { if (canWrite && unread.length > 0) MM.dispatch('message.read', { caseId: c.id }, { silent: true }); }, [unread.length]);
    const lastReq = msgs.filter((m) => m.kind === 'meeting_request').slice(-1)[0];
    const answered = lastReq && msgs.some((m) => m.createdAt > lastReq.createdAt && String(m.senderId).startsWith('k-'));
    const send = () => {
      const body = text.trim();
      if (!body) { setErr('Skriv ett meddelande först.'); return; }
      if (looksLikePnr(body)) { setErr('Det ser ut som ett personnummer i texten. Ta bort det – ärendenumret räcker.'); return; }
      const res = MM.dispatch('message.send', { caseId: c.id, body });
      if (res && res.messageId) { setText(''); setErr(null); MM.toast('Meddelandet är skickat. Miljonbemanning får en notis utan personuppgifter.', 'blue'); }
    };
    return html`<div class="stack">
      <${ui.Card} title="Säkra meddelanden" icon="lock">
        <div class="stack">
          ${msgs.length === 0 ? html`<${ui.Empty} icon="message" title="Inga meddelanden än">${isChef() ? `Här skriver handläggaren och Miljonbemanning till varandra om ärendenummer ${c.number}.` : `Här skriver du och Miljonbemanning till varandra om ärendenummer ${c.number}.`}<//>`
            : html`<div class="kom-thread" role="log" aria-label="Meddelanden">
              ${msgs.map((m) => { const mine = m.senderId === pid; const meeting = m.kind === 'meeting_request';
                return html`<div key=${m.id} class=${MM.cls('kom-msg', mine && 'mine', meeting && 'meeting')}>
                  <div class="kom-msg-meta">${meeting && html`<${ui.Badge} tone="dark" icon="calendar">Mötesförfrågan<//>`}${newIds.has(m.id) && html`<${ui.Badge} tone="red" icon="bell">Nytt<//>`}<span class="strong" style="color:var(--antracit)">${senderLabel(m.senderId, pid)}</span><span>${fDT(m.createdAt)}</span></div>
                  <div>${m.body}</div>
                  ${mine && html`<div class="kom-msg-meta">${(m.readBy || []).length ? `Läst ${m.readAt ? fDT(m.readAt) : ''}` : 'Inte läst än'}</div>`}
                </div>`; })}
            </div>`}
          ${canWrite ? html`<div class="stack">
              ${lastReq && !answered && html`<div class="stack-sm"><div class="kom-section-label">Snabbsvar på mötesförfrågan</div>
                <div class="row-sm">
                  <${ui.Btn} kind="secondary" icon="check" onClick=${() => { setText('Tack! Tiden passar. Jag kommer.'); setErr(null); }}>Tiden passar<//>
                  <${ui.Btn} kind="secondary" icon="calendar" onClick=${() => { setText('Tack! Den tiden passar tyvärr inte. Jag kan i stället '); setErr(null); }}>Föreslå en annan tid<//>
                </div></div>`}
              <${ui.Field} id="kom-msg" label="Nytt meddelande" error=${err}
                help=${`Skriv så lite personuppgifter som möjligt och inga personnummer. Miljonbemanning får ett mejl med texten "Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa." Själva meddelandet skickas aldrig med e-post.`}>
                <${ui.TextArea} id="kom-msg" rows=${4} maxLength=${2000} value=${text} invalid=${!!err} onInput=${(v) => { setText(v); if (err) setErr(null); }} /><//>
              <span><${ui.Btn} kind="primary" size="lg" icon="send" onClick=${send}>Skicka meddelandet<//></span>
            </div>`
          : html`<p class="muted">Meddelanden om deltagaren skickas av handläggaren som beställde insatsen (${MM.personName(c.referrerId)}). Du kan läsa dem här.</p>`}
        </div>
      <//>
      <p class="muted small">Säkra meddelanden ersätter mejl med personuppgifter. Allt sparas under ärendenumret och syns för den ansvariga coachen.</p>
    </div>`;
  };

  const DeltagareView = ({ params }) => (params && params.caseId ? html`<${CaseDetail} caseId=${params.caseId} tab=${params.tab} />` : html`<${CaseList} />`);

  // ============================================================ kom.rapporter
  const REP_FILTERS = [['olasta', 'Olästa'], ['alla', 'Alla'], ['weekly_attendance', 'Veckorapporter'], ['monthly', 'Månadsrapporter'], ['final', 'Slutrapporter'], ['order_confirmation', 'Orderbekräftelser']];
  const RapporterView = ({ params }) => {
    MM.useStore(); const pid = pidNow(); const chef = isChef();
    const p0 = params || {};
    const [tab, setTab] = useState(p0.tab === 'meddelanden' ? 'meddelanden' : 'rapporter');
    const [filter, setFilter] = useState(REP_FILTERS.some(([k]) => k === p0.filter) ? p0.filter : 'alla');
    useEffect(() => { if (p0.tab) setTab(p0.tab === 'meddelanden' ? 'meddelanden' : 'rapporter'); if (REP_FILTERS.some(([k]) => k === p0.filter)) setFilter(p0.filter); }, [p0.tab, p0.filter]);
    const [limit, setLimit] = useState(15);
    const reps = sel.komReports(pid);
    const unreadR = reps.filter((r) => !r.openedAt);
    const unreadM = sel.komUnreadMessages();
    const waiting = S().reports.filter((r) => r.kind === 'weekly_attendance' && r.status === 'waiting' && r.recipientUserId === pid);
    const count = (k) => (k === 'alla' ? reps.length : k === 'olasta' ? unreadR.length : reps.filter((r) => r.kind === k).length);
    const list = reps.filter((r) => filter === 'alla' || (filter === 'olasta' ? !r.openedAt : r.kind === filter))
      .sort((a, b) => (a.openedAt ? 1 : 0) - (b.openedAt ? 1 : 0) || (a.deliveredAt < b.deliveredAt ? 1 : -1));

    if (chef) {
      const pendingSummary = S().reports.filter((r) => r.kind === 'customer_summary' && !deliveredOk(r) && r.recipientUserId === pid);
      return html`<div class="kom">
        <${Head} eyebrow="Botkyrka kommun · Arbetsmarknadsenheten" title="Rapporter" back=${{ label: 'Till beställarrapporten', onClick: () => MM.nav('kom.chef', {}) }}
          lead="Beställarrapporterna som Miljonbemanning har levererat till dig. De kommer en gång i månaden." />
        ${pendingSummary.map((r) => html`<${ui.Notice} key=${r.id} tone="info" title=${`${reportTitle(r)} är på väg`}>Rapporten är ett utkast hos Miljonbemanning. Den levereras när avtalsansvarig har godkänt den, senast ${fDTL(r.dueAt)}.<//>`)}
        <${ui.Card} flush title="Beställarrapporter" icon="chart">
          ${list.length === 0 ? html`<${ui.Empty} icon="file" title="Inga rapporter än" />` : html`<div class="list">${list.map((r) => html`<${ReportRow} key=${r.id} r=${r} pid=${pid} />`)}</div>`}
        <//>
        <p class="muted">Meddelanden om enskilda deltagare går till handläggaren som beställde insatsen. Du kan läsa dem under Enhetens deltagare.</p>
        <div class="kom-actions"><${ui.PerspectiveSwitch} role="avtalsansvarig" view="rapporter.lista" label="Se rapporterna hos Miljonbemanning" /></div>
      </div>`;
    }

    const cases = sel.visibleCases();
    const threads = cases.map((c) => { const ms = sel.messagesOf(c.id); return ms.length ? { c, last: ms[ms.length - 1], unread: ms.filter((m) => m.senderId !== pid && !(m.readBy || []).includes(pid)).length, n: ms.length } : null; })
      .filter(Boolean).sort((a, b) => (b.unread > 0) - (a.unread > 0) || (a.last.createdAt < b.last.createdAt ? 1 : -1));
    return html`<div class="kom">
      <${Head} eyebrow="Botkyrka kommun" title="Rapporter och meddelanden" back=${{ label: 'Till start', onClick: () => MM.nav('kom.start', {}) }}
        lead="Olästa visas först. Du får ett mejl utan personuppgifter när något nytt kommer." />
      <${ui.Tabs} ariaLabel="Rapporter eller meddelanden" active=${tab} onChange=${setTab} tabs=${[{ id: 'rapporter', label: 'Rapporter', icon: 'file', count: unreadR.length }, { id: 'meddelanden', label: 'Meddelanden', icon: 'message', count: unreadM.length }]} />
      ${tab === 'rapporter' ? html`<div class="stack">
          ${waiting.map((r) => html`<${ui.Notice} key=${r.id} tone="info" icon="clock" title=${`${reportTitle(r)} är på väg`}>Den publiceras när coacherna har registrerat all närvaro för veckan, senast ${fDTL(r.dueAt)}.<//>`)}
          <${ui.Seg} ariaLabel="Visa rapporter" value=${filter} onChange=${(v) => { setFilter(v); setLimit(15); }} options=${REP_FILTERS.filter(([k]) => k === 'alla' || count(k) > 0).map(([k, l]) => ({ value: k, label: `${l} (${count(k)})` }))} />
          <${ui.Card} flush>
            ${list.length === 0 ? html`<${ui.Empty} icon="check-circle" title=${filter === 'olasta' ? 'Du har läst alla rapporter' : 'Inga rapporter att visa'} />`
              : html`<div class="list">${list.slice(0, limit).map((r) => html`<${ReportRow} key=${r.id} r=${r} pid=${pid} />`)}</div>`}
            <${MoreBtn} shown=${Math.min(limit, list.length)} total=${list.length} onMore=${() => setLimit(limit + 15)} />
          <//>
          <p class="muted">Rapporterna byggs bara av uppgifter som coachen har godkänt. En rapport räknas som läst när du har öppnat den.</p>
        </div>`
      : html`<div class="stack">
          <${ui.Card} flush title="Meddelanden per deltagare" icon="message">
            ${threads.length === 0 ? html`<${ui.Empty} icon="message" title="Inga meddelanden än">Öppna en deltagare under Mina deltagare för att skriva till Miljonbemanning.<//>`
              : html`<div class="list">${threads.map((t) => html`<button type="button" key=${t.c.id} class=${MM.cls('list-item clickable', t.unread > 0 && 'kom-unread')} onClick=${() => MM.nav('kom.deltagare', { caseId: t.c.id, tab: 'meddelanden' })}>
                  <${I} name=${t.last.kind === 'meeting_request' ? 'calendar' : 'message'} size="lg" />
                  <span class="li-main">
                    <span class="kom-titlerow"><span class="li-title">${t.c.number} · ${nameFor(t.c)}</span>${t.unread > 0 && html`<${ui.Badge} tone="dark">${t.unread} ${t.unread === 1 ? 'ny' : 'nya'}<//>`}</span>
                    <span class="li-sub">${senderLabel(t.last.senderId, pid)}, ${fDT(t.last.createdAt)}: ”${trunc(t.last.body, 90)}”</span>
                    <span class="li-sub">${t.n} ${t.n === 1 ? 'meddelande' : 'meddelanden'} i tråden</span>
                  </span>
                  <${I} name="chevron-right" cls="kom-chev" />
                </button>`)}</div>`}
          <//>
          <p class="muted">Vill du skriva om en deltagare som inte finns i listan? Öppna deltagaren under Mina deltagare.</p>
          <span><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('kom.deltagare', {})}>Mina deltagare<//></span>
        </div>`}
      <div class="kom-actions"><${ui.PerspectiveSwitch} role="samordnare" view="rapporter.lista" label="Se rapporterna hos Miljonbemanning" /></div>
    </div>`;
  };

  // ============================================================ kom.chef
  /** Beställarrapportens siffror. En levererad rapport ska inte räknas om i efterhand, så siffrorna tas från rapportdokumentets
   *  frysta innehåll när rapportvyn finns. Fält som dokumentet saknar (t.ex. "någon progression") tas från sel.customerSummary. */
  const frozenSummary = (rep, month) => {
    const live = sel.customerSummary(month);
    let doc = null;
    try { doc = MM.reports && typeof MM.reports.modelFor === 'function' ? MM.reports.modelFor(rep) : null; } catch (e) { doc = null; }
    if (!doc || doc.kind !== 'customer_summary' || !doc.result || doc.month !== month) return live;
    const res = (a, b) => ({ ...a, ...(b || {}) });
    return {
      ...live, active: doc.active, started: doc.started, closed: doc.closed, byArea: doc.byArea || live.byArea, byTrack: doc.byTrack || live.byTrack,
      result: { ...live.result, rolling: res(live.result.rolling, doc.result.rolling), sinceStart: res(live.result.sinceStart, doc.result.sinceStart), month: res(live.result.month, doc.result.month) },
      attendanceRate: doc.attendanceRate, attendance: doc.attendance || live.attendance,
      pulse: { ...live.pulse, ...(doc.pulse || {}) }, progression: { ...live.progression, ...(doc.progression || {}) },
      deviations: doc.deviations, contractDeviations: doc.contractDeviations,
    };
  };
  const seenSummary = new Set();
  const ChefView = () => {
    const st = MM.useStore(); const pid = pidNow();
    const reps = st.reports.filter((r) => r.kind === 'customer_summary' && !r.superseded && (r.recipientUserId === pid || (r.deliveredTo || []).includes(pid))).sort(MM.by('month'));
    const delivered = reps.filter(deliveredOk);
    const latest = delivered[delivered.length - 1];
    const [month, setMonth] = useState(latest ? latest.month : (reps[reps.length - 1] || {}).month);
    const [tab, setTab] = useState('resultat');
    const [showApproved, setShowApproved] = useState(false);
    const rep = reps.find((r) => r.month === month);
    const ok = !!rep && deliveredOk(rep);
    useEffect(() => {
      if (!rep || !ok || seenSummary.has(rep.id)) return; seenSummary.add(rep.id);
      if (!rep.openedAt) MM.dispatch('report.open', { reportId: rep.id }, { silent: true });
      else MM.dispatch('audit.view', { action: 'report.view', entity: 'report', entityId: rep.id }, { silent: true });
    }, [rep && rep.id, ok]);
    // Levererade siffror: samma frysta innehåll som rapportdokumentet (MM.reports.modelFor) när det finns, annars sel.customerSummary.
    const s = useMemo(() => (ok ? frozenSummary(rep, month) : null), [month, ok, MM.store.version]);
    const pending = sel.komPendingActionPlans();
    const approved = st.contractDeviations.filter((x) => x.contractId === 'c-bot' && x.customerApprovedAt).sort(MM.by('customerApprovedAt', -1));
    const ladder = MM.cfg().escalationLadder || [];
    const warnings = st.contractDeviations.filter((x) => x.warningIssued).length;
    const mgr = MM.personName(MM.contract().contractManagerId);
    const approve = async (cd) => {
      const yes = await MM.confirm({ title: 'Godkänn åtgärdsplanen?', confirmLabel: 'Godkänn åtgärdsplanen',
        body: html`<div class="stack-sm"><p><b>${cd.description}</b></p><p>Åtgärd: ${cd.actionPlan}</p><p class="muted">Miljonbemanning får besked direkt. Godkännandet sparas med datum och ditt namn.</p></div>` });
      if (!yes) return;
      const res = MM.dispatch('kom.approveActionPlan', { id: cd.id });
      if (res && res.ok) MM.toast('Åtgärdsplanen är godkänd. Miljonbemanning har fått besked.', 'blue');
      else MM.toast('Åtgärdsplanen kunde inte godkännas.', 'red');
    };
    const monthLabel = (r) => `${monthCap(r.month)}${deliveredOk(r) ? '' : ' (utkast)'}`;
    const N = minN();
    const k = MM.cfg().kpis.find((x) => x.key === 'resultatgrad');
    const target = s ? s.result.contractTarget : k.contractTarget;
    const rr = s && s.result.rolling;
    // Samma regel som i rapportdokumentet: antal 1–4 visas som "färre än 5" och andelen redovisas inte.
    const hiddenShare = (r) => r.den > 0 && (r.den < N || (r.num > 0 && r.num < N));
    const shareTxt = (r) => (r.den === 0 || r.value == null ? '–' : hiddenShare(r) ? 'Redovisas inte' : fmt.pct(r.value));
    const enough = (r) => r && r.den >= r.minN && !hiddenShare(r);
    const below = rr && enough(rr) && rr.value < target;
    const resultBadge = (r) => (hiddenShare(r) ? html`<${ui.Badge} tone="grey" icon="lock">Redovisas inte – små grupper<//>`
      : !enough(r) ? html`<${ui.Badge} tone="grey" icon="info">För få avslut för att bedöma<//>`
      : r.value >= target ? html`<${ui.Badge} tone="blue" icon="check-circle">Når avtalsmålet<//>` : html`<${ui.Badge} tone="red" icon="alert">Under avtalsmålet<//>`);
    const avslutText = (r) => `${small(r.num)} av ${small(r.den)} avslut`;
    const pctOrHidden = (num, den) => (den === 0 ? '–' : den < N || (num > 0 && num < N) ? 'Redovisas inte' : fmt.pct(num / den, 0));
    // Samma antal decimaler som i rapportdokumentet.
    const attPct = (v) => (v == null ? '–' : fmt.pct(v));
    const satisfactionLabel = 'Andel som svarat 4 eller 5 på en skala 1–5';

    return html`<div class="kom">
      <${Head} eyebrow=${`Botkyrka kommun · ${(MM.persona() || {}).name || ''}, ${((MM.persona() || {}).title || '').toLowerCase()}`} title="Beställarrapport"
        lead="Så går insatserna inom avtalet med Miljonbemanning. Rapporten kommer en gång i månaden och bygger bara på godkända uppgifter."
        actions=${html`<${ui.BuildPhase} fas=${2} />`} />

      ${pending.length > 0 && html`<${ui.Card} title=${`Väntar på ditt godkännande (${pending.length})`} icon="flag" tone="red" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
        <div class="stack">
          ${pending.map((cd) => { const step = ladder.find((x) => x.step === cd.escalationStep);
            return html`<div class="stack-sm" key=${cd.id}>
              <div class="row-sm"><${ui.Badge} tone="outline">${String(cd.type).replace(/^./, (x) => x.toUpperCase())}<//><${ui.Badge} tone="grey">${step ? `Steg ${step.step} · ${step.level} avvikelse` : cd.level}<//><span class="small muted">Registrerad ${fD(cd.raisedAt)} · källa: ${cd.source}</span></div>
              <p class="strong">${cd.description}</p>
              <${ui.Kv} items=${[['Åtgärdsplan', cd.actionPlan], ['Klar senast', fD(cd.actionPlanDue)]]} />
              <div class="kom-actions"><${ui.Btn} kind="primary" size="lg" icon="check" onClick=${() => approve(cd)}>Godkänn åtgärdsplanen<//></div>
              <p class="muted small">Har du synpunkter på planen? Kontakta avtalsansvarig ${mgr} på Miljonbemanning.</p>
            </div>`; })}
        </div><//>`}

      <div class="stack-sm">
        <div class="kom-section-label" id="kom-month-label">Välj månad</div>
        <${ui.Seg} ariaLabel="Välj månad" value=${month} onChange=${setMonth} options=${reps.map((r) => ({ value: r.month, label: monthLabel(r), icon: deliveredOk(r) ? null : 'edit' }))} />
        ${latest && month === latest.month && reps.some((r) => !deliveredOk(r)) && html`<p class="muted">Du ser ${d.monthName(latest.month)} eftersom det är den senaste rapporten som har levererats. Rapporten för ${reps.filter((r) => !deliveredOk(r)).map((r) => d.monthName(r.month)).join(' och ')} är ett utkast hos Miljonbemanning tills avtalsansvarig har godkänt den.</p>`}
      </div>

      ${!ok && rep && html`<${ui.Notice} tone="info" icon="clock" title=${`Rapporten för ${d.monthName(rep.month)} är inte klar än`}>
        Den är ett utkast hos Miljonbemanning. Avtalsansvarig ${mgr} granskar och godkänner den innan den levereras till dig, senast ${fDTL(rep.dueAt)}. Du ser inga siffror förrän rapporten är godkänd.
        <div style="margin-top:10px"><${ui.Btn} kind="secondary" icon="arrow-left" onClick=${() => latest && setMonth(latest.month)}>Visa ${latest ? d.monthName(latest.month) : 'senaste'}<//></div><//>`}

      ${s && html`<div class="stack-lg">
        <div class="kom-kpis">
          <${ui.Kpi} label="Resultat, 6 månader" value=${shareTxt(rr)} tone=${below ? 'alert' : null} statusText=${below ? 'Under avtalsmålet' : null} sub=${`${avslutText(rr)} · avtalsmål ${fmt.pct(target, 0)}`} />
          <${ui.Kpi} label="Aktiva under månaden" value=${small(s.active)} sub=${`${small(s.started)} nya · ${small(s.closed)} avslutade`} />
          <${ui.Kpi} label="Närvarograd" value=${attPct(s.attendanceRate)} sub="Av alla planerade tillfällen" />
          <${ui.Kpi} label="Nöjdhet" value=${s.pulse.enough && s.pulse.satisfaction != null ? fmt.pct(s.pulse.satisfaction, 0) : '–'} sub=${s.pulse.enough ? `${satisfactionLabel} (${s.pulse.responses} svar)` : `Färre än ${N} svar`} />
        </div>
        <${ui.Card} title=${`Sammanfattning ${d.monthName(month)}`} icon="file" foot=${html`<span class="small muted">Godkänd av ${MM.personName(rep.approvedBy)} ${fDT(rep.approvedAt)} · levererad ${fDT(rep.deliveredAt)}</span>`}>
          <div class="stack-sm">
            <p>Under ${d.monthName(month)} var ${small(s.active)} deltagare aktiva. ${small(s.started).replace(/^./, (x) => x.toUpperCase())} nya insatser startade och ${small(s.closed)} avslutades.</p>
            <p>${hiddenShare(rr) ? `Resultatgraden de senaste sex månaderna redovisas inte eftersom grupperna är mindre än ${N} personer.` : enough(rr) ? `Resultatgraden de senaste sex månaderna var ${fmt.pct(rr.value)} (${avslutText(rr)} gick till arbete eller studier). Avtalsmålet är ${fmt.pct(target, 0)}.` : `Det finns för få avslut för att bedöma resultatgraden (minst ${rr.minN} behövs).`}</p>
            <p>Närvarograden var ${s.attendanceRate == null ? 'inte beräkningsbar' : attPct(s.attendanceRate)}. ${s.deviations > 0 ? `${small(s.deviations).replace(/^./, (x) => x.toUpperCase())} avvikelser på deltagarnivå hanterades under månaden.` : 'Inga avvikelser på deltagarnivå registrerades.'}</p>
            <div>${resultBadge(rr)}</div>
          </div>
        <//>
        <${ui.Tabs} ariaLabel="Rapportens delar" active=${tab} onChange=${setTab} tabs=${[{ id: 'resultat', label: 'Resultat', icon: 'target' }, { id: 'deltagare', label: 'Deltagare', icon: 'users' }, { id: 'progression', label: 'Progression', icon: 'trending-up' }, { id: 'narvaro', label: 'Närvaro och nöjdhet', icon: 'check-square' }]} />
        ${tab === 'resultat' && html`<div class="stack">
          ${[['Senaste sex månaderna', rr], ['Sedan avtalet startade', s.result.sinceStart], [`Under ${d.monthName(month)}`, s.result.month]].map(([label, r]) => html`<${ui.Card} key=${label} title=${label}>
            <div class="stack">
              <div class="row-between"><div class="kom-bigval">${shareTxt(r)}</div>${resultBadge(r)}</div>
              ${!hiddenShare(r) && r.den > 0 && html`<${ui.Meter} value=${r.value || 0} max=${1} tone=${enough(r) && r.value >= target ? 'blue' : null} label=${`Resultatgrad ${fmt.pct(r.value || 0)}, avtalsmål ${fmt.pct(target, 0)}`} markers=${[{ value: target, label: `Avtalsmål ${fmt.pct(target, 0)}`, tone: 'red' }]} />`}
              <div class="muted">${avslutText(r)} gick till arbete eller studier.${r.prelim > 0 ? ` Ytterligare ${small(r.prelim)} väntar på verifiering och räknas inte än.` : ''}${r.excluded > 0 ? ` Avslut som inte räknas, till exempel vid flytt: ${small(r.excluded)}.` : ''}</div>
            </div><//>`)}
          <${ui.Notice} tone="info" title="Hur resultatet räknas">Resultat är avslut till arbete eller studier som är verifierade. Exakt vilka anställningar och studier som räknas är inte bestämt än mellan kommunen och Miljonbemanning. När en grupp har färre än ${N} personer redovisas inte andelen.<//>
        </div>`}
        ${tab === 'deltagare' && html`<div class="stack">
          <${ui.Card} title="Per avtalsområde" flush>
            <${ui.Table} caption="Deltagare per avtalsområde" rowKey="code" columns=${[{ key: 'name', label: 'Område' }, { key: 'active', label: 'Aktiva', num: true, render: (r) => small(r.active) }, { key: 'started', label: 'Nya', num: true, render: (r) => small(r.started) }, { key: 'closed', label: 'Avslutade', num: true, render: (r) => small(r.closed) }]} rows=${s.byArea} />
          <//>
          <${ui.Card} title="Per yrkesspår" flush>
            <${ui.Table} caption="Aktiva deltagare per yrkesspår" rowKey="track" columns=${[{ key: 'track', label: 'Yrkesspår', render: (r) => r.track || 'Inte valt än' }, { key: 'active', label: 'Aktiva', num: true, render: (r) => small(r.active) }]} rows=${s.byTrack} />
          <//>
          <p class="muted">Grupper med färre än ${N} personer visas som ”färre än ${N}” så att ingen enskild deltagare kan pekas ut.</p>
        </div>`}
        ${tab === 'progression' && html`<div class="stack">
          <div class="grid-2">
            <${ui.Kpi} label="Tydlig progression" value=${pctOrHidden(s.progression.clear, s.progression.assessed)} sub=${`Minst ett område på nivå 2 eller högre · ${small(s.progression.assessed)} bedömda`} />
            <${ui.Kpi} label="Någon progression" value=${pctOrHidden(s.progression.any, s.progression.assessed)} sub="Minst ett område på nivå 1 eller högre" />
          </div>
          <${ui.Card} title="Tydlig progression per område" flush>
            <${ui.Table} caption="Tydlig progression per progressionsområde" rowKey="key" columns=${[{ key: 'label', label: 'Område' }, { key: 'clear', label: 'Antal', num: true, render: (r) => small(r.clear) }, { key: 'share', label: 'Andel', num: true, render: (r) => pctOrHidden(r.clear, r.n) }]} rows=${s.progression.areaDist} />
          <//>
          <p class="muted">Bygger bara på månadsbedömningar som coachen har godkänt. Andelar redovisas inte när antalet är färre än ${N}.</p>
        </div>`}
        ${tab === 'narvaro' && html`<div class="stack">
          <${ui.Card} title="Närvaro" icon="check-square">
            <${ui.Kv} items=${[['Närvarograd', attPct(s.attendanceRate)], ['Närvarande', small(s.attendance.present)], ['Sen ankomst', small(s.attendance.late)], ['Giltig frånvaro', small(s.attendance.absentValid)], ['Ogiltig frånvaro', small(s.attendance.absentInvalid)]]} />
          <//>
          <${ui.Card} title="Nöjdhet" icon="smile" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
            ${s.pulse.enough ? html`<${ui.Kv} items=${[[satisfactionLabel, s.pulse.satisfaction == null ? '–' : fmt.pct(s.pulse.satisfaction, 0)], ['Känner sig närmare arbete eller studier', s.pulse.closer == null ? '–' : fmt.pct(s.pulse.closer, 0)], ['Antal svar', small(s.pulse.responses)]]} />`
              : html`<p>Resultatet visas när minst ${s.pulse.minN || N} deltagare har svarat.</p>`}
            <p class="muted small" style="margin-top:10px">Deltagarna svarar anonymt efter två veckor och vid avslut. Svaren gäller de tre månaderna till och med ${d.monthName(month)}.</p>
          <//>
          <${ui.Card} title="Avvikelser" icon="flag">
            <${ui.Kv} items=${[['Avvikelser på deltagarnivå', small(s.deviations)], ['Nya avtalsavvikelser', small(s.contractDeviations)], ['Skriftliga varningar hittills', String(warnings)]]} />
          <//>
        </div>`}
        <div class="kom-actions">
          <${ui.Btn} kind="secondary" icon="file" onClick=${() => openReport(rep)}>Öppna rapporten som dokument<//>
          <${ui.Btn} kind="secondary" icon="users" onClick=${() => MM.nav('kom.deltagare', {})}>Enhetens deltagare<//>
        </div>
      </div>`}

      ${approved.length > 0 && html`<${ui.Card} title="Godkända åtgärdsplaner" icon="check-circle"
          actions=${html`<${ui.Btn} kind="ghost" icon=${showApproved ? 'chevron-up' : 'chevron-down'} ariaPressed=${showApproved ? 'true' : 'false'} onClick=${() => setShowApproved(!showApproved)}>${showApproved ? 'Dölj' : `Visa (${approved.length})`}<//>`}>
        ${showApproved ? html`<div class="stack">${approved.map((cd) => html`<div class="stack-sm" key=${cd.id}>
            <p class="strong">${cd.description}</p><div class="muted">${cd.actionPlan}</div>
            <div class="row-sm"><${ui.Badge} tone="blue" icon="check">Godkänd ${fD(cd.customerApprovedAt)}<//>${cd.status === 'closed' && html`<${ui.Badge} tone="dark" icon="check-square">Avslutad<//>`}</div></div>`)}</div>`
          : html`<p class="muted">${approved.length} åtgärdsplaner är godkända. Senast ${fD(approved[0].customerApprovedAt)}.</p>`}
      <//>`}

      <${ui.Card} title="Statistik på begäran" icon="download" actions=${html`<${ui.BuildPhase} fas=${3} />`}>
        <div class="stack-sm">
          <p>Kommunen kan beställa statistik för valfri period, kostnadsfritt upp till ${MM.cfg().statistics.onRequestMaxPerYear} gånger per år.</p>
          <span><${ui.Btn} kind="secondary" icon="download" disabled>Beställ statistik<//></span>
        </div>
      <//>
      <${ui.DemoNote}>Siffrorna räknas fram ur prototypens påhittade data. Vad beställarrapporten ska innehålla och hur ofta den kommer är en öppen fråga till kommunen.<//>
      <div class="kom-actions"><${ui.PerspectiveSwitch} role="chef" view="chef.oversikt" label="Se samma resultat i Miljonbemannings ledningsvy" /></div>
    </div>`;
  };

  // ============================================================ Registrering
  MM.registerView('kom.login', { title: 'Logga in', roles: BOTH, component: LoginView });
  MM.registerView('kom.start', { title: 'Start', roles: HANDL, component: StartView });
  MM.registerView('kom.bestall', { title: 'Beställ ny insats', roles: HANDL, component: OrderView });
  MM.registerView('kom.deltagare', { title: (p) => (p && p.caseId ? 'Deltagare' : MM.role() === 'kommun_chef' ? 'Enhetens deltagare' : 'Mina deltagare'), roles: BOTH, component: DeltagareView });
  MM.registerView('kom.rapporter', { title: 'Rapporter och meddelanden', roles: BOTH, component: RapporterView });
  MM.registerView('kom.chef', { title: 'Beställarrapport', roles: ['kommun_chef'], component: ChefView });
})();
