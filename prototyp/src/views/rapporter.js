// views/rapporter.js – rapportlista (MB) och rapportvisning som PDF-förhandsvisning för båda perspektiven.
// Vyer: rapporter.lista {filter?} · rapport.visa {reportId}. Exporterar MM.reports = { ReportDocument, modelFor, ... }.
// Regler: rapporter byggs bara av godkända uppgifter, leverans sker i portalen (mejlet är bara en notis),
// rättelse skapar ny version, kommunen ser bara levererade rapporter och aldrig det interna målet.
// Levererade rapporter är frysta: innehållet sparas som en ögonblicksbild (r.snapshot) direkt efter leveransen
// och visas därifrån. Seedade levererade rapporter byggs av de uppgifter som fanns vid leveransen.
(() => {
  const { html, useState, useEffect, useMemo, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const S = () => MM.store.state;

  const LIST_ROLES = ['samordnare', 'avtalsansvarig', 'coach', 'chef'];
  const VIEW_ROLES = ['samordnare', 'avtalsansvarig', 'coach', 'handledare', 'chef', 'kommun_handlaggare', 'kommun_chef'];
  const KINDS = ['monthly', 'final', 'weekly_attendance', 'order_confirmation', 'customer_summary'];
  const STATUSES = ['draft', 'reviewed', 'approved', 'waiting', 'delivered', 'opened'];
  const QUICK = { overdue: 'Försenade', week: 'Förfaller denna vecka', approval: 'Väntar på godkännande', deliver: 'Väntar på leverans' };
  const PAGE_SIZE = 30;
  const STATUS_UI = { draft: ['grey', 'edit'], reviewed: ['outline', 'eye'], approved: ['bluetone', 'check'], waiting: ['grey', 'clock'], delivered: ['blue', 'send'], opened: ['dark', 'check-circle'] };
  const LIFECYCLE = ['Utkast', 'Granskad', 'Godkänd', 'Levererad', 'Kvitterad'];
  const GOAL = { yes: 'uppnått', partly: 'delvis uppnått', no: 'inte uppnått' };
  const PRINCIPLE = 'Rapporteringsprincip: Rapporten beskriver vad deltagaren har gjort och vad coachen har observerat under perioden. Den bygger bara på godkända uppgifter – registrerad närvaro, godkända veckoavstämningar och coachens godkända månadsbedömning. Bedömningarna är coachens egna. Rapporten innehåller inga diagnoser, inga spekulationer och inga omdömen om personlighet. Det som inte är känt skrivs "Framgår inte". Personnummer skrivs inte ut – ärendenumret identifierar deltagaren.';
  const NO_DUE = 'Sista dag ej fastställd';

  // ------------------------------------------------------------ Hjälpare
  const caseOf = (r) => (r && r.caseId ? sel.caseById(r.caseId) : null);
  const recipientOf = (r) => r.recipientUserId || (caseOf(r) || {}).referrerId || (r.deliveredTo || [])[0] || null;
  const isDelivered = (r) => r.status === 'delivered' || r.status === 'opened';
  const effStatus = (r) => (r.status === 'delivered' && r.openedAt ? 'opened' : r.status);
  const statusLabel = (r) => { const s = effStatus(r); if (s === 'reviewed' && !['monthly', 'final'].includes(r.kind)) return 'Granskad'; return sel.reportStatusLabel(s); };
  const isOverdue = (r) => !isDelivered(r) && !r.superseded && !!r.dueAt && r.dueAt < d.now();
  const weekEnd = () => `${d.addDays(d.monday(d.today()), 6)}T23:59`;
  const dueThisWeek = (r) => !isDelivered(r) && !r.superseded && !!r.dueAt && r.dueAt >= d.now() && r.dueAt <= weekEnd();
  const isProvisional = (r) => !!r.provisionalDue || r.kind === 'customer_summary';
  const ucfirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const lcfirst = (s) => (s && !(s.length > 1 && s.charAt(1) === s.charAt(1).toUpperCase() && /[A-ZÅÄÖ]/.test(s.charAt(1))) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const joinSv = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} och ${xs[xs.length - 1]}`);
  const unitOf = (id) => { const p = MM.personById(id); return p && p.unit ? p.unit : ''; };
  const maxS = (a, b) => (a > b ? a : b);
  const minS = (a, b) => (a < b ? a : b);
  const hasSnapshot = (r) => !!(r && r.snapshot && r.snapshot.reportId === r.id);
  const hasRecommendation = (r) => !!(r.finalText && String(r.finalText.recommendation || '').trim());

  // Datum utan förkortningar (dokumenten visas också i kommunportalen).
  const dayMonth = (s) => { if (!s) return '–'; const [, m, dd] = s.slice(0, 10).split('-').map(Number); return `${dd} ${d.MON[m - 1]}`; };
  const dFull = (s) => (s ? d.fmtDateFull(s) : '–');
  const dtFull = (s) => (s ? d.fmtDateTimeFull(s) : '–');
  const wdFull = (s) => (s ? `${d.WD[d.weekday(s)]} ${d.fmtDateTimeFull(s)}` : '–');
  const weekText = (key) => { const m = String(key || '').match(/^(\d{4})-W(\d{2})$/); return m ? `vecka ${+m[2]} ${m[1]}` : ''; };
  const weekRange = (key) => { const mon = d.weekMonday(key); const sun = d.addDays(mon, 6); return mon.slice(0, 4) === sun.slice(0, 4) ? `${dayMonth(mon)} – ${dayMonth(sun)} ${sun.slice(0, 4)}` : `${dFull(mon)} – ${dFull(sun)}`; };
  const phaseText = (n) => `Fas ${n} · ${sel.phaseName(n)}`.replace(/\/APL\b/, ' (arbetsplatsförlagt lärande)');
  const personWithUnit = (id) => `${MM.personName(id)}${unitOf(id) ? `, ${unitOf(id)}` : ''}`;

  const reportTitle = (r) => ({
    monthly: `Månadsrapport ${d.monthName(r.month || d.monthKey(r.periodStart))}`,
    final: 'Slutrapport',
    weekly_attendance: `Veckorapport närvaro ${r.week ? weekText(r.week) : ''}`.trim(),
    order_confirmation: 'Orderbekräftelse',
    customer_summary: `Beställarrapport ${d.monthName(r.month || d.monthKey(r.periodStart))}`,
  }[r.kind] || sel.reportKindLabel(r.kind));
  const periodText = (r) => {
    if (r.kind === 'weekly_attendance' && r.week) return `${weekText(r.week)} (${weekRange(r.week)})`;
    if (r.month) return d.monthName(r.month);
    if (r.kind === 'order_confirmation') return dFull(r.periodStart);
    return `${dFull(r.periodStart)} – ${dFull(r.periodEnd)}`;
  };
  /** Förklaring till en förfallotid som inte är fastställd med kommunen (läses från avtalskonfigurationen). */
  const provisionalText = (r) => {
    const key = { monthly: 'manadsrapport', final: 'slutrapport' }[r.kind];
    const rule = key && (MM.cfg().sla || []).find((s) => s.key === key);
    const raw = rule ? String(rule.due || rule.within || '') : '';
    const m = raw.match(/\(([^)]*)\)/);
    const base = `Sista dagen är inte fastställd med ${MM.contract().customerName}.`;
    return m ? `${base} Tills vidare gäller ${m[1]}.` : `${base} Förfallotiden är ett förslag.`;
  };

  /** En pågående rättelse (ny version som inte är levererad än), annars null. */
  const pendingCorrection = (r) => { if (!r || !r.correctionPending) return null; const nx = S().reports.find((x) => x.id === r.correctionPending); return nx && !isDelivered(nx) && !nx.superseded ? nx : null; };

  /** Vad är nästa steg för rapporten? { key, label } */
  const nextStep = (r) => {
    if (r.superseded) return { key: 'superseded', label: 'Ersatt av en rättad version' };
    const s = effStatus(r);
    const pend = isDelivered(r) ? pendingCorrection(r) : null;
    if (pend) return { key: 'correcting', label: `Rättas – version ${pend.version} är ett utkast` };
    if (s === 'opened') return { key: 'done', label: 'Mottagaren har öppnat rapporten' };
    if (s === 'delivered') return { key: 'unopened', label: 'Levererad – inte öppnad än' };
    if (r.kind === 'final' && !hasRecommendation(r)) return { key: 'blocked', label: 'Coachen skriver rekommenderad fortsättning' };
    if (s === 'approved') return { key: 'deliver', label: 'Väntar på leverans till kommunen' };
    if (s === 'waiting') return { key: 'registration', label: 'Väntar på närvaroregistrering' };
    if (r.kind === 'monthly') {
      const ma = sel.assessment(r.caseId, r.month);
      if (!ma || ma.status !== 'approved') return { key: 'blocked', label: 'Månadsbedömningen ska godkännas först' };
      return { key: 'approval', label: 'Väntar på coachens godkännande' };
    }
    if (r.kind === 'final') return { key: 'approval', label: 'Väntar på coachens godkännande' };
    if (r.kind === 'customer_summary') return { key: 'approval', label: 'Väntar på avtalsansvarigs godkännande' };
    return { key: 'approval', label: 'Väntar på godkännande' };
  };

  /** Får rollen se rapporten? { ok, reason?, partial?, access?, recipient? } */
  const reportAccess = (r, role = MM.role(), pid = MM.currentPersonaId()) => {
    const c = caseOf(r);
    if (MM.perspectiveOf(role) === 'kund') {
      const recipient = (r.deliveredTo || []).includes(pid);
      const mine = recipient || recipientOf(r) === pid || (c && c.referrerId === pid);
      // Kommunens chef ser individrapporter bara om avtalet säger det (customerVisibility.seesIndividualReports).
      const chefOk = role === 'kommun_chef' && (r.kind === 'customer_summary' || MM.cfg().customerVisibility.seesIndividualReports !== false);
      if (!mine && !chefOk) return { ok: false, reason: 'not_yours' };
      if (!isDelivered(r)) return { ok: false, reason: 'not_delivered' };
      return { ok: true, access: 'customer', recipient };
    }
    if (!VIEW_ROLES.includes(role)) return { ok: false, reason: 'role' };
    // Handledare ser bara veckorapporten (närvaro). Månads- och slutrapporter innehåller coachens bedömningar.
    if (role === 'handledare' && r.kind !== 'weekly_attendance') return { ok: false, reason: r.kind === 'order_confirmation' ? 'handledare_order' : r.kind === 'customer_summary' ? 'role' : 'handledare' };
    if (r.kind === 'customer_summary') return ['samordnare', 'avtalsansvarig', 'chef'].includes(role) ? { ok: true, access: 'full' } : { ok: false, reason: 'role' };
    if (r.kind === 'weekly_attendance') return ['samordnare', 'avtalsansvarig', 'chef'].includes(role) ? { ok: true, access: 'full' } : { ok: true, partial: true, access: 'team' };
    if (!c) return { ok: false, reason: 'missing' };
    const a = sel.access(c, role, pid);
    if (a === 'none') return { ok: false, reason: 'not_assigned' };
    if (a === 'restricted') return { ok: false, reason: 'protected' };
    return { ok: true, access: a };
  };

  const StatusBadge = ({ r }) => { const s = effStatus(r); const [tone, icon] = STATUS_UI[s] || ['grey', 'circle']; return html`<${ui.Badge} tone=${tone} icon=${icon}>${statusLabel(r)}<//>`; };
  const ProvisionalBadge = ({ r }) => isProvisional(r) && html`<${ui.Badge} tone="outline" icon="help" title=${provisionalText(r)}>${NO_DUE}<//>`;
  const lifecycleIndex = (r) => ({ draft: 0, waiting: 0, reviewed: 1, approved: 2, delivered: 3, opened: 5 }[effStatus(r)] ?? 0);

  // ------------------------------------------------------------ Datakällor: levande data eller data som vid leveransen
  // Rapportens innehåll byggs som en modell (ren data). Utkast byggs ur levande data. Levererade rapporter visas från
  // ögonblicksbilden. Saknas den (seedade rapporter) byggs modellen av uppgifter som fanns vid leveransen:
  // närvaro med registeredAt <= deliveredAt, avstämningar med approvedAt <= deliveredAt, bedömningar med decidedAt <= deliveredAt osv.
  // För seedade rapporter används seedens ursprungliga data, så att en senare ändring av en post inte ändrar version 1.
  const SEED_NOW = (MM.seedConstants && MM.seedConstants.NOW) || '2027-02-01T09:12';
  const buildIdx = (st) => {
    const by = (xs) => { const m = {}; for (const x of xs) (m[x.caseId] || (m[x.caseId] = [])).push(x); return m; };
    const act = by(st.activities); Object.values(act).forEach((xs) => xs.sort(MM.by('startsAt')));
    const att = {}; for (const x of st.attendance) att[x.activityId] = x;
    const added = {}; for (const l of st.auditLog || []) if (l.action === 'event.added') added[l.entityId] = l.occurredAt;
    const plans = {}; for (const p of st.monthlyPlans) plans[`${p.caseId}:${p.month}`] = p;
    const cases = {}; for (const c of st.cases) cases[c.id] = c;
    const tasks = {}; for (const t of st.tasks || []) if (t.deviationId) tasks[t.deviationId] = t;
    return { act, att, ci: by(st.checkIns), ma: by(st.monthlyAssessments), ev: by(st.outcomeEvents), dev: by(st.deviations), added, plans, cases, tasks };
  };
  let liveCache = { key: null, st: null, idx: null };
  const liveIdx = () => {
    const st = S();
    const key = `${MM.store.mut}:${st.activities.length}:${st.attendance.length}:${st.checkIns.length}:${st.monthlyAssessments.length}:${st.outcomeEvents.length}:${st.deviations.length}:${st.monthlyPlans.length}:${st.cases.length}:${(st.tasks || []).length}`;
    if (liveCache.key !== key || liveCache.st !== st) liveCache = { key, st, idx: buildIdx(st) };
    return liveCache.idx;
  };
  // Seedens data (för seedade levererade rapporter). Så länge inget har ändrats i demon är det samma som det levande tillståndet.
  const READONLY = new Set(['audit.view', 'report.open', 'message.read', 'rap.snapshot', 'rap.qualityReview', 'alert.ack']);
  let seedCache = null;
  const seedBase = () => {
    if (seedCache) return seedCache;
    if ((MM.store.log || []).every((e) => READONLY.has(e.type))) return { st: S(), idx: liveIdx() };
    const st = MM.seed(); seedCache = { st, idx: buildIdx(st) };
    return seedCache;
  };
  /** demoToo: räkna också med ändringar som gjorts i demon (används för att upptäcka att underlaget ändrats efter leveransen). */
  const makeSrc = (st, idx, asOf, demoToo = false) => {
    const ok = (t) => !asOf || !t || t <= asOf || (demoToo && t >= SEED_NOW);
    const src = {
      st, asOf, now: asOf || d.now(), ok,
      caseById: (id) => idx.cases[id] || null,
      /** Slutdatum som var känt vid tidpunkten (ett senare avslut räknas inte). */
      endOf: (c) => (c.endDate && (!asOf || !c.closedAt || c.closedAt <= asOf) ? c.endDate : null),
      closed: (c) => c.status === 'closed' && ok(c.closedAt),
      activitiesOf: (cid) => idx.act[cid] || [],
      att: (aid) => { const x = idx.att[aid]; return x && ok(x.registeredAt) ? x : null; },
      checkIns: (cid, from, to) => (idx.ci[cid] || []).filter((x) => x.status === 'approved' && ok(x.approvedAt) && x.heldAt.slice(0, 10) >= from && x.heldAt.slice(0, 10) <= to).sort(MM.by('heldAt')),
      assessment: (cid, mk) => (idx.ma[cid] || []).find((x) => x.month === mk) || null,
      approved: (m) => !!m && m.status === 'approved' && ok(m.decidedAt),
      assessments: (cid) => (idx.ma[cid] || []).filter((m) => m.status === 'approved' && ok(m.decidedAt)).sort(MM.by('month')),
      plan: (cid, mk) => idx.plans[`${cid}:${mk}`] || null,
      events: (cid, from, to) => (idx.ev[cid] || []).filter((e) => e.occurredOn >= from && e.occurredOn <= to && ok(e.occurredOn) && ok(idx.added[e.id])).sort(MM.by('occurredOn')),
      deviations: (cid) => (idx.dev[cid] || []).filter((x) => ok(x.createdAt)).sort(MM.by('createdAt', -1)),
      taskFor: (devId) => { const t = idx.tasks[devId]; return t && ok(t.createdAt) ? t : null; },
    };
    return src;
  };
  const liveSrc = () => makeSrc(S(), liveIdx(), null);

  /** Närvarostatistik (samma regler som sel.attendanceStats, men mot vald datakälla). */
  const attStats = (src, caseId, from, to) => {
    const acts = (caseId ? src.activitiesOf(caseId) : src.st.activities).filter((a) => a.startsAt.slice(0, 10) >= from && a.startsAt.slice(0, 10) <= to && a.startsAt < src.now);
    const r = { planned: acts.length, present: 0, late: 0, absentValid: 0, absentInvalid: 0, unregistered: 0, reasons: {} };
    for (const a of acts) {
      const at = src.att(a.id);
      if (!at) { r.unregistered++; continue; }
      if (at.status === 'present') r.present++; else if (at.status === 'late') r.late++;
      else if (at.status === 'absent_valid') { r.absentValid++; r.reasons[at.reason] = (r.reasons[at.reason] || 0) + 1; } else r.absentInvalid++;
    }
    const registered = r.planned - r.unregistered;
    r.rate = registered ? (r.present + r.late) / registered : null;
    return r;
  };
  /** Två eller fler ogiltiga frånvarotillfällen inom avtalets fönster (standard 14 dagar) under perioden. */
  const repeatedIn = (src, caseId, from, to) => {
    const rule = MM.cfg().attendance.repeatedAbsenceRule;
    const dates = src.activitiesOf(caseId).filter((a) => a.startsAt.slice(0, 10) >= from && a.startsAt.slice(0, 10) <= to && a.startsAt < src.now)
      .filter((a) => { const at = src.att(a.id); return at && at.status === 'absent_invalid'; }).map((a) => a.startsAt.slice(0, 10));
    const n = rule.absentInvalid;
    const hit = dates.some((x, i) => i + n - 1 < dates.length && d.diffDays(x, dates[i + n - 1]) <= rule.withinDays);
    return { hit, count: dates.length, absentInvalid: rule.absentInvalid, withinDays: rule.withinDays };
  };

  /** Textbeskrivning av aktiviteterna från godkända avstämningar (i fas 2 ett AI-utkast som coachen godkänner). */
  const docText = (cis, label) => {
    if (!cis.length) return `Inga godkända veckoavstämningar finns för ${label}.`;
    const acts = MM.uniq(cis.flatMap((x) => (Array.isArray(x.activitiesDone) ? x.activitiesDone : [])));
    const contacts = MM.sum(cis, (x) => parseInt((x.employerContacts || {}).count, 10) || 0);
    const types = MM.uniq(cis.flatMap((x) => ((x.employerContacts || {}).types || [])));
    const g = { yes: 0, partly: 0, no: 0 }; cis.forEach((x) => { if (typeof x.goalStatus === 'string' && g[x.goalStatus] != null) g[x.goalStatus]++; });
    const times = (n) => `${n} ${n === 1 ? 'gång' : 'gånger'}`;
    return [
      `Under ${label} genomfördes ${cis.length} godkända veckoavstämningar.`,
      acts.length ? `Deltagaren har arbetat med ${joinSv(acts.map(lcfirst))}.` : '',
      `Arbetsgivarkontakter: ${contacts}${types.length ? ` (${types.join(', ')})` : ''}.`,
      `Veckomålet uppnåddes ${times(g.yes)}, delvis ${times(g.partly)} och inte ${times(g.no)}.`,
    ].filter(Boolean).join(' ');
  };
  const reasonsText = (reasons) => { const xs = Object.entries(reasons || {}).map(([k, v]) => `${lcfirst(k)} ${v}`); return xs.length ? xs.join(', ') : 'inga'; };
  const activityModel = (cis) => {
    const done = MM.uniq(cis.flatMap((x) => (Array.isArray(x.activitiesDone) ? x.activitiesDone : [])));
    return { types: [...((MM.seedConstants && MM.seedConstants.ACTIVITY_TYPES) || done)], done };
  };
  const eventRows = (evs) => evs.map((e) => ({ id: e.id, date: dFull(e.occurredOn), label: sel.eventLabel(e.kind), actor: e.actor || '–', basis: e.verificationKind ? ucfirst(e.verificationKind) : (e.note || 'Inte verifierat') }));
  const deviationModel = (src, devs, rep) => {
    const needs = devs.filter((x) => x.needsCustomerDecision);
    const decision = needs.length === 0 ? 'Nej.' : needs.every((x) => src.taskFor(x.id))
      ? 'Ja – handläggaren har fått en uppgift i portalen och ett mejl utan personuppgifter om att logga in.'
      : 'Ja – Miljonbemanning kontaktar handläggaren.';
    return {
      items: devs.map((x) => ({ id: x.id, description: x.description, date: dFull(x.createdAt), status: x.status === 'open' ? 'Pågår' : 'Avslutad', assessment: x.assessment || '', action: x.action || 'Framgår inte',
        follow: `Ansvarig: ${MM.personName(x.ownerId)}${x.followUpOn ? ` · Uppföljning ${dFull(x.followUpOn)}` : ''}${x.followUpMeetingAt ? ` · Möte med kommunen ${dtFull(x.followUpMeetingAt)}` : ''}` })),
      repeated: rep, decision,
    };
  };
  const progressionModel = (ma) => {
    const cfg = MM.cfg().progression;
    const keys = [...cfg.areas, ...(cfg.optionalAreas || []).filter((k) => ma.areas[k] && ma.areas[k].level != null)];
    return {
      scale: Object.entries(cfg.scale).map(([k, v]) => `${k} = ${lcfirst(v)}`).join(' · '),
      rows: keys.map((k) => { const a = ma.areas[k] || {}; return { key: k, label: cfg.areaLabels[k] || k, level: a.level != null ? `${a.level} – ${lcfirst(cfg.scale[a.level])}` : 'Ej bedömd', observation: a.observation || '–', nextStep: a.nextStep || '–' }; }),
    };
  };
  const planModel = (plan) => (plan ? [['Mål 1', plan.goal1 || 'Framgår inte'], ['Mål 2', plan.goal2 || 'Framgår inte'], ['Planerade aktiviteter', plan.plannedActivities || 'Framgår inte'],
    ['Planerad arbetsgivarkontakt', plan.plannedEmployerContact || 'Inget planerat'], ['Anpassning', plan.plannedAdaptation || 'Ingen särskild anpassning'], ['Nästa uppföljning med kommunen', plan.nextCustomerMeeting ? dFull(plan.nextCustomerMeeting) : 'Inte bokad']] : null);

  // ------------------------------------------------------------ Modeller per rapporttyp. frozen = texter som ska sparas i en levererad rapport.
  const buildMonthly = (src, r) => {
    const c = src.caseById(r.caseId); if (!c) return null;
    const mk = r.month; const from = `${mk}-01`; const to = d.monthEnd(mk); const end = src.endOf(c);
    const maRaw = src.assessment(c.id, mk); const ok = src.approved(maRaw);
    const cis = src.checkIns(c.id, from, to);
    const weeks = [];
    for (let mon = d.monday(from); mon <= to; mon = d.addDays(mon, 7)) {
      const wFrom = maxS(mon, from); const wTo = minS(d.addDays(mon, 6), to);
      if (c.startDate && wTo < c.startDate) continue; if (end && wFrom > end) continue;
      const wk = d.isoWeek(mon);
      weeks.push({ key: wk.key, label: `Vecka ${wk.week}`, sub: wFrom === wTo ? dayMonth(wFrom) : `${dayMonth(wFrom)} – ${dayMonth(wTo)}`, st: attStats(src, c.id, wFrom, wTo), paused: (c.pausedWeeks || []).includes(wk.key) });
    }
    const total = attStats(src, c.id, from, to);
    const rep = repeatedIn(src, c.id, from, to);
    const lastCi = cis[cis.length - 1]; const phase = lastCi && lastCi.phase ? Number(lastCi.phase) : c.phase;
    const devs = src.deviations(c.id).filter((x) => x.createdAt.slice(0, 10) <= to && (x.createdAt.slice(0, 10) >= from || x.status === 'open'));
    return {
      kind: 'monthly', caseId: c.id, number: c.number, month: mk, approved: ok,
      basics: [['Ärendenummer', c.number], ['Avtalsområde', sel.areaName(c.primaryArea)], ['Yrkesspår', c.vocationalTrack || 'Framgår inte'], ['Insatsen startade', dFull(c.startDate)],
        [end ? 'Insatsen avslutades' : 'Planerat slut', dFull(end || c.plannedEnd)], ['Fas vid månadens slut', phaseText(phase)], ['Huvudcoach', MM.personName(c.leadCoachId)], ['Beställare', personWithUnit(c.referrerId)]],
      weeks, total, reasons: reasonsText(total.reasons), repeated: rep,
      activities: activityModel(cis), docText: docText(cis, d.monthName(mk)),
      progression: ok ? progressionModel(maRaw) : null,
      events: eventRows(src.events(c.id, from, to)),
      deviations: deviationModel(src, devs, rep),
      nextMonth: d.monthName(d.addMonths(mk, 1)), plan: ok ? planModel(src.plan(c.id, mk)) : null,
      assessment: ok ? { overallStatus: maRaw.overallStatus, summary: maRaw.summary || 'Framgår inte.', coach: MM.personName(maRaw.decidedBy || c.leadCoachId), date: dFull(maRaw.decidedAt) } : null,
    };
  };

  const defaultRecommendation = (c, plan) => {
    if (c.endReason === 'arbete') return 'Deltagaren har påbörjat arbete. Ingen fortsatt insats rekommenderas.';
    if (c.endReason === 'studier') return 'Deltagaren har påbörjat studier. Ingen fortsatt insats rekommenderas.';
    if (plan && (plan.goal1 || plan.goal2)) return `Fortsatt arbete mot målen i den senaste planen: ${joinSv([plan.goal1, plan.goal2].filter(Boolean).map(lcfirst))}. Kommunen avgör om en ny insats ska beställas.`;
    return 'Framgår inte.';
  };
  const buildFinal = (src, r, frozen) => {
    const c = src.caseById(r.caseId); if (!c) return null;
    const end = src.endOf(c);
    const from = r.periodStart || c.startDate; const to = r.periodEnd || end || src.now.slice(0, 10);
    const months = [];
    for (let mk = d.monthKey(from); mk <= d.monthKey(to); mk = d.addMonths(mk, 1)) {
      const mFrom = maxS(`${mk}-01`, from); const mTo = minS(d.monthEnd(mk), to);
      months.push({ key: mk, label: ucfirst(d.monthName(mk)), st: attStats(src, c.id, mFrom, mTo), paused: false });
    }
    const total = attStats(src, c.id, from, to);
    const rep = repeatedIn(src, c.id, from, to);
    const cis = src.checkIns(c.id, from, to);
    const mas = src.assessments(c.id).filter((m) => m.month >= d.monthKey(from) && m.month <= d.monthKey(to));
    const first = mas[0]; const last = mas[mas.length - 1];
    const lastCi = cis[cis.length - 1];
    const plan = last ? src.plan(c.id, last.month) : null;
    const ft = r.finalText || {};
    const obstacles = ft.obstacles != null && ft.obstacles !== '' ? ft.obstacles : (lastCi && (lastCi.obstacles || []).length ? `${ucfirst(joinSv(lastCi.obstacles.map(lcfirst)))}.` : 'Inga hinder noterade i den senaste godkända avstämningen.');
    // Rekommendationen är coachens text. En levererad rapport utan sparad text (seedade) får texten fryst vid leveransen.
    const recommendation = String(ft.recommendation || '').trim() || (frozen ? defaultRecommendation(c, plan) : '');
    const verified = !!c.resultVerifiedAt && src.ok(c.resultVerifiedAt);
    const resultText = c.resultClass === 'result' ? (verified ? `Arbete eller studier – verifierat ${dFull(c.resultVerifiedAt)}.` : 'Arbete eller studier – väntar på verifiering. Räknas inte som resultat förrän underlaget är verifierat.')
      : c.resultClass === 'excluded' ? 'Avslutet räknas inte i resultatgraden (avbrott som inte beror på insatsen).' : c.resultClass === 'no_result' ? 'Inget resultat enligt resultatdefinitionen.' : 'Framgår inte.';
    const cfgProg = MM.cfg().progression;
    return {
      kind: 'final', caseId: c.id, number: c.number, period: `${dFull(from)} – ${dFull(to)}`,
      basics: [['Ärendenummer', c.number], ['Avtalsområde', sel.areaName(c.primaryArea)], ['Yrkesspår', c.vocationalTrack || 'Framgår inte'], ['Insatsen startade', dFull(c.startDate)], ['Insatsen avslutades', dFull(end)],
        ['Avslutsorsak', sel.endReasonLabel(c.endReason)], ['Huvudcoach', MM.personName(c.leadCoachId)], ['Beställare', personWithUnit(c.referrerId)]],
      months, total, reasons: reasonsText(total.reasons), repeated: rep,
      activities: activityModel(cis), docText: docText(cis, 'insatsen'),
      progression: last ? { firstMonth: d.monthName(first.month), lastMonth: d.monthName(last.month), rows: cfgProg.areas.map((k) => { const a0 = first.areas[k] || {}; const a1 = last.areas[k] || {}; return { key: k, label: cfgProg.areaLabels[k], first: a0.level ?? '–', last: a1.level ?? '–', observation: a1.observation || '–' }; }) } : null,
      resultText, events: eventRows(src.events(c.id, from, to)),
      deviations: deviationModel(src, src.deviations(c.id).filter((x) => x.createdAt.slice(0, 10) <= to), rep),
      obstacles, recommendation,
      assessment: last ? { overallStatus: last.overallStatus, summary: last.summary || 'Framgår inte.', coach: MM.personName(c.leadCoachId), date: dFull(r.approvedAt || last.decidedAt) } : null,
    };
  };

  const buildWeekly = (src, r) => {
    if (!r.week || !r.recipientUserId) return null;
    const mon = d.weekMonday(r.week); const sun = d.addDays(mon, 6);
    const cases = src.st.cases.filter((c) => c.referrerId === r.recipientUserId && c.startDate && c.startDate <= sun && (!src.endOf(c) || src.endOf(c) >= mon));
    return {
      kind: 'weekly_attendance', week: r.week, recipientUserId: r.recipientUserId, now: src.now,
      sections: cases.map((c) => {
        const acts = src.activitiesOf(c.id).filter((a) => a.startsAt >= mon && a.startsAt <= `${sun}T23:59`);
        const stats = attStats(src, c.id, mon, sun);
        const devs = src.deviations(c.id).filter((x) => x.createdAt.slice(0, 10) >= mon && x.createdAt.slice(0, 10) <= sun);
        return {
          caseId: c.id, number: c.number, stats, paused: (c.pausedWeeks || []).includes(r.week),
          rows: acts.map((a) => { const at = src.att(a.id); return { id: a.id, startsAt: a.startsAt, kind: a.kind, status: at ? at.status : null, reason: at ? at.reason || '' : '' }; }),
          actions: devs.map((x) => x.action).filter(Boolean),
          risk: stats.absentInvalid >= 2 ? 'Risk för avbrott – uppföljningsmöte föreslås' : stats.absentInvalid === 1 ? 'Bevakas' : 'Ingen risk noterad',
        };
      }),
    };
  };

  const buildOrder = (src, r) => {
    const c = src.caseById(r.caseId); if (!c) return null;
    const start = c.startDate || c.plannedStart || c.desiredStart;
    const weeks = c.orderValueWeeks || c.plannedWeeks || null;
    const coach = MM.personById(c.leadCoachId);
    return {
      kind: 'order_confirmation', caseId: c.id, number: c.number, area: sel.areaName(c.primaryArea), track: c.vocationalTrack || 'Bestäms vid kartläggningen',
      start: start ? dFull(start) : 'Inte bestämt', coach: coach ? `${coach.name}${coach.phone ? `, telefon ${coach.phone}` : ''}` : 'Inte utsedd',
      firstMeeting: c.firstMeetingAt ? `${ucfirst(wdFull(c.firstMeetingAt))}, ${c.location || 'Alby'}` : 'Bokas inom en vecka',
      weeks, plannedEnd: c.plannedEnd ? dFull(c.plannedEnd) : null, price: sel.priceFor(c.primaryArea, start || d.today()),
      buyerReference: c.buyerReference || null, purchaseOrderNumber: c.purchaseOrderNumber || null,
    };
  };

  const small = (m, n) => (n > 0 && n < m.minN ? `färre än ${m.minN}` : String(n));
  const summaryFromNumbers = (m) => {
    const sm = (n) => small(m, n);
    return `Under ${d.monthName(m.month)} var ${sm(m.active)} deltagare aktiva och ${sm(m.started)} nya insatser startade. ${ucfirst(sm(m.closed))} insatser avslutades, varav ${sm(m.result.month.num)} till arbete eller studier. Närvarograden var ${fmt.pct(m.attendanceRate)}. ${m.deviations > 0 ? `${ucfirst(sm(m.deviations))} avvikelser på deltagarnivå har hanterats med åtgärd.` : 'Inga avvikelser på deltagarnivå registrerades.'}`;
  };
  /** Beställarrapporten (samma regler som sel.customerSummary, mot vald datakälla). Innehåller aldrig det interna målet. */
  const buildSummary = (src, r, frozen) => {
    const cfg = MM.cfg(); const mk = r.month || d.monthKey(r.periodStart);
    const minN = cfg.pulse.minNForAggregate;
    const start = `${mk}-01`; const end = d.monthEnd(mk);
    const all = src.st.cases.filter((c) => c.startDate);
    const active = all.filter((c) => c.startDate <= end && (!src.endOf(c) || src.endOf(c) >= start));
    const started = all.filter((c) => c.startDate >= start && c.startDate <= end);
    const closed = all.filter((c) => src.closed(c) && c.endDate >= start && c.endDate <= end);
    const byArea = Object.entries(MM.groupBy(active, (c) => c.primaryArea)).map(([code, cs]) => ({ code, name: sel.areaName(code), active: cs.length, started: cs.filter((c) => started.includes(c)).length, closed: cs.filter((c) => closed.includes(c)).length })).sort(MM.by('code'));
    const byTrack = Object.entries(MM.groupBy(active, (c) => c.vocationalTrack)).map(([t, cs]) => ({ track: t === 'undefined' || t === 'null' ? '' : t, active: cs.length })).sort(MM.by('active', -1));
    const mas = src.st.monthlyAssessments.filter((m) => m.month === mk && src.approved(m));
    const clear = mas.filter((m) => Object.values(m.areas).some((a) => a.level >= 2)).length;
    const areaDist = cfg.progression.areas.map((key) => ({ key, label: cfg.progression.areaLabels[key], clear: mas.filter((m) => (m.areas[key] || {}).level >= 2).length, n: mas.length }));
    const att = attStats(src, null, start, end);
    const pFrom = maxS(`${d.addMonths(mk, -2)}-01`, `${d.monthKey(MM.contract().startsOn)}-01`);
    const rs = src.st.pulseResponses.filter((x) => x.submittedAt >= pFrom && x.submittedAt <= `${end}T23:59` && src.ok(x.submittedAt));
    const k = cfg.kpis.find((x) => x.key === 'resultatgrad');
    const rate = (from, to) => {
      const cs = src.st.cases.filter((c) => src.closed(c) && c.endDate >= from && c.endDate <= to);
      const counted = cs.filter((c) => c.resultClass !== 'excluded');
      const isVer = (c) => c.resultClass === 'result' && !!c.resultVerifiedAt && src.ok(c.resultVerifiedAt);
      const num = counted.filter(isVer).length;
      return { value: counted.length ? num / counted.length : null, num, den: counted.length, prelim: counted.filter((c) => c.resultClass === 'result' && !isVer(c)).length };
    };
    const pm = d.monthKey(pFrom);
    const m = {
      kind: 'customer_summary', month: mk, minN, resultMinN: k.minN, active: active.length, started: started.length, closed: closed.length, byArea, byTrack,
      result: { month: rate(start, end), rolling: rate(`${d.addMonths(mk, -5)}-01`, end), sinceStart: rate(MM.contract().startsOn, end), contractTarget: k.contractTarget },
      progression: { assessed: mas.length, clear, areaDist }, attendance: att, attendanceRate: att.rate,
      deviations: src.st.deviations.filter((x) => x.createdAt.slice(0, 10) >= start && x.createdAt.slice(0, 10) <= end && src.ok(x.createdAt)).length,
      contractDeviations: src.st.contractDeviations.filter((x) => x.raisedAt.slice(0, 10) >= start && x.raisedAt.slice(0, 10) <= end && src.ok(x.raisedAt)).length,
      pulse: { responses: rs.length, satisfaction: rs.length ? rs.filter((x) => x.answers.q1 >= 4).length / rs.length : null, enough: rs.length >= minN,
        period: pm === mk ? d.monthName(mk) : pm.slice(0, 4) === mk.slice(0, 4) ? `${d.MON[Number(pm.slice(5)) - 1]}–${d.monthName(mk)}` : `${d.monthName(pm)} – ${d.monthName(mk)}` },
      contractorName: MM.contract().supplierName,
      sla: cfg.customerVisibility.seesSlaStats ? ['avrop_besvarade_i_tid', 'forsta_mote_inom_en_vecka', 'veckorapporter_i_tid'].map((key) => { const v = sel.kpiValue(key, { month: mk }); return v ? [v.label, v.den ? `${fmt.pct(v.value, 0)} (${v.num} av ${v.den})` : '–'] : null; }).filter(Boolean) : null,
    };
    // Sammanfattningen är avtalsansvarigs godkända text. En levererad rapport utan sparad text (seedade) får texten fryst vid leveransen.
    m.summary = r.summary || (frozen ? summaryFromNumbers(m) : null);
    return m;
  };

  const BUILD = { monthly: buildMonthly, final: buildFinal, weekly_attendance: buildWeekly, order_confirmation: buildOrder, customer_summary: buildSummary };
  let baseCache = { st: null, models: {} };
  /** Rapportens innehåll. Utkast: levande data. Levererad: ögonblicksbilden, annars uppgifter som fanns vid leveransen.
   *  opts.live = true bygger levererade rapporter ur dagens data (för att upptäcka att underlaget har ändrats). */
  const modelFor = (r, opts = {}) => {
    const build = r && BUILD[r.kind]; if (!build) return null;
    if (!isDelivered(r)) return build(liveSrc(), r, false);
    if (opts.live) return build(liveSrc(), r, true);
    if (hasSnapshot(r)) return r.snapshot.model;
    if (baseCache.st !== S()) baseCache = { st: S(), models: {} };
    const key = `${r.id}:${r.deliveredAt}`;
    if (!(key in baseCache.models)) {
      const base = r.deliveredAt && r.deliveredAt < SEED_NOW ? seedBase() : { st: S(), idx: liveIdx() };
      baseCache.models[key] = build(makeSrc(base.st, base.idx, r.deliveredAt || null), r, true);
    }
    return baseCache.models[key];
  };
  /** Har underlaget för den rapporterade perioden ändrats efter leveransen? Jämför den frysta versionen med samma uppgifter
   *  plus allt som ändrats i demon. Uppgifter som tillkom i seedens historik efter leveransen räknas inte. */
  const driftedSinceDelivery = (r) => {
    if (!isDelivered(r) || r.superseded || !BUILD[r.kind]) return false;
    const a = modelFor(r); const b = BUILD[r.kind](makeSrc(S(), liveIdx(), r.deliveredAt || null, true), r, true); if (!a || !b) return false;
    const norm = (m) => JSON.stringify({ ...m, now: null, summary: null, recommendation: null, sla: null, basics: null });
    return norm(a) !== norm(b);
  };

  // ------------------------------------------------------------ Gemensamma dokumentdelar
  const Sec = ({ n, title, children, extra }) => html`<section class="stack-sm"><h2>${n ? `${n}. ` : ''}${title}${extra}</h2>${children}</section>`;
  const Wait = ({ children }) => html`<p class="muted" style="font-style:italic">${children}</p>`;
  const TWrap = ({ children, min = 520 }) => html`<div class="table-wrap"><table style=${`min-width:${min}px`}>${children}</table></div>`;

  const AttendanceTable = ({ rows, total, firstCol }) => {
    const showUnreg = total.unregistered > 0;
    const cell = (st) => html`<td class="num">${st.planned}</td><td class="num">${st.present + st.late}${st.late > 0 ? ` (${st.late} sen)` : ''}</td><td class="num">${st.absentValid}</td><td class="num">${st.absentInvalid}</td>${showUnreg && html`<td class="num">${st.unregistered}</td>`}<td class="num">${fmt.pct(st.rate, 0)}</td>`;
    return html`<${TWrap} min=${560}>
      <thead><tr><th>${firstCol}</th><th class="num">Planerade tillfällen</th><th class="num">Närvaro</th><th class="num">Giltig frånvaro</th><th class="num">Ogiltig frånvaro</th>${showUnreg && html`<th class="num">Ej registrerade</th>`}<th class="num">Närvarograd</th></tr></thead>
      <tbody>${rows.map((w) => html`<tr key=${w.key}><td class="nowrap">${w.label}${w.sub && html`<div class="small muted">${w.sub}</div>`}${w.paused ? html`<div class="small muted">Uppehåll</div>` : ''}</td>${cell(w.st)}</tr>`)}</tbody>
      <tfoot><tr><td><b>Totalt</b></td>${cell(total)}</tr></tfoot>
    <//>`;
  };

  const ActivityChecklist = ({ a }) => {
    const done = new Set(a.done);
    return html`<ul style="list-style:none;margin:0;padding:0;display:grid;gap:6px 18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))">
      ${a.types.map((t) => html`<li key=${t} style="display:flex;align-items:flex-start;gap:2px"><span class="xbox" aria-hidden="true">${done.has(t) ? 'X' : ''}</span><span><span class="sr-only">${done.has(t) ? 'Genomförd: ' : 'Inte genomförd: '}</span>${String(t).replace(/\/APL\b/, ' (arbetsplatsförlagt lärande)')}</span></li>`)}
    </ul>`;
  };

  const EventsTable = ({ evs }) => evs.length === 0 ? html`<p>Inga händelser registrerade under perioden.</p>` : html`<${TWrap} min=${520}>
    <thead><tr><th>Datum</th><th>Händelse</th><th>Arbetsgivare eller anordnare</th><th>Underlag</th></tr></thead>
    <tbody>${evs.map((e) => html`<tr key=${e.id}><td class="nowrap">${e.date}</td><td>${e.label}</td><td>${e.actor}</td><td>${e.basis}</td></tr>`)}</tbody>
  <//>`;

  const DeviationsBlock = ({ dv }) => html`<div class="stack-sm">
    ${dv.items.length === 0 ? html`<p>Inga avvikelser under perioden.</p>` : dv.items.map((x) => html`<div key=${x.id} style="border-left:3px solid var(--antracit);padding:2px 0 2px 10px" class="stack-sm">
      <div><b>${x.description}</b> <span class="small muted">(${x.date} · ${x.status})</span></div>
      ${x.assessment && html`<div><b>Risk och bedömning:</b> ${x.assessment}</div>`}
      <div><b>Åtgärd:</b> ${x.action}</div>
      <div class="small">${x.follow}</div>
    </div>`)}
    ${dv.repeated && dv.repeated.hit && html`<p><b>Risk:</b> Upprepad ogiltig frånvaro (${dv.repeated.count} tillfällen, regel: minst ${dv.repeated.absentInvalid} inom ${dv.repeated.withinDays} dagar).</p>`}
    <p><b>Behöver beslut eller stöd från kommunen?</b> ${dv.decision}</p>
  </div>`;

  const ProgressionTable = ({ p }) => html`<div class="stack-sm">
    <p class="small muted">Skala: ${p.scale}.</p>
    <${TWrap} min=${600}>
      <thead><tr><th style="width:26%">Område</th><th style="width:16%">Nivå</th><th>Observation</th><th style="width:24%">Nästa steg</th></tr></thead>
      <tbody>${p.rows.map((a) => html`<tr key=${a.key}><td>${a.label}</td><td>${a.level}</td><td>${a.observation}</td><td>${a.nextStep}</td></tr>`)}</tbody>
    <//>
  </div>`;

  const baseInfo = (r, number, extra = []) => {
    const k = MM.contract();
    return [['Beställare', k.customerName], ['Avtal', `${k.contractNumber} (diarienummer ${k.dnr})`], ...(number ? [['Ärende', number]] : []), ...extra, ['Version', String(r.version || 1)],
      ['Upprättad', r.approvedAt ? dFull(r.approvedAt) : 'Utkast – ej godkänd']];
  };
  const isDraftDoc = (r) => ['draft', 'reviewed', 'waiting'].includes(r.status);
  const Superseded = ({ r }) => r.superseded && html`<div class="watermark-draft">Ersatt av en rättad version</div>`;
  const nameOf = (caseId, role) => { const c = sel.caseById(caseId); return c ? sel.displayName(c, role) : '–'; };

  // ------------------------------------------------------------ Månadsrapport individ (mall 02, avsnitt 1–8)
  const MonthlyDoc = ({ r, m, role }) => {
    const draft = !m.approved || isDraftDoc(r);
    return html`<${ui.Paper} title="Månadsrapport individ" draft=${draft ? 'Utkast' : null} info=${baseInfo(r, m.number, [['Period', d.monthName(m.month)]])}>
      <${Superseded} r=${r} />
      ${!m.approved && html`<p class="small"><b>Utkast.</b> Månadsbedömningen för ${d.monthName(m.month)} är inte godkänd. Avsnitt 4, 7 och 8 visas först när coachen har godkänt den.</p>`}
      <${Sec} n="1" title="Grunduppgifter">
        <${ui.Kv} items=${[['Deltagare', nameOf(m.caseId, role)], ...m.basics]} />
        <p class="small muted">Personnummer skrivs inte ut. Ärendenumret identifierar deltagaren.</p>
      <//>
      <${Sec} n="2" title="Närvaro och frånvaro">
        <${AttendanceTable} rows=${m.weeks} total=${m.total} firstCol="Vecka" />
        <p><b>Giltig frånvaro per orsak:</b> ${m.reasons}.</p>
        <p><b>Upprepad ogiltig frånvaro:</b> ${m.repeated.hit ? `Ja – ${m.repeated.count} tillfällen. Åtgärdsplan: se avsnitt 6.` : 'Nej.'}</p>
      <//>
      <${Sec} n="3" title="Genomförda aktiviteter">
        <p class="small muted">Aktivitetstyperna är exempel – de stäms av mot mall 02. Kryss betyder minst en registrerad aktivitet av typen i en godkänd avstämning.</p>
        <${ActivityChecklist} a=${m.activities} />
        <p><b>Dokumentation:</b> ${m.docText}</p>
      <//>
      <${Sec} n="4" title="Progression">
        ${m.progression ? html`<${ProgressionTable} p=${m.progression} />` : html`<${Wait}>Visas när coachen har godkänt månadsbedömningen.<//>`}
      <//>
      <${Sec} n="5" title="Resultat och utfall"><${EventsTable} evs=${m.events} /><//>
      <${Sec} n="6" title="Avvikelse, risk och åtgärd"><${DeviationsBlock} dv=${m.deviations} /><//>
      <${Sec} n="7" title=${`Plan för nästa månad (${m.nextMonth})`}>
        ${!m.approved ? html`<${Wait}>Visas när coachen har godkänt månadsbedömningen.<//>` : m.plan ? html`<${ui.Kv} items=${m.plan} />` : html`<p>Framgår inte.</p>`}
      <//>
      <${Sec} n="8" title="Coachens sammanfattande bedömning">
        ${m.assessment ? html`<${ui.Kv} items=${[['Samlad status', html`<${ui.Status} value=${m.assessment.overallStatus} />`], ['Sammanfattning', m.assessment.summary], ['Ansvarig coach', m.assessment.coach], ['Datum', m.assessment.date]]} />`
          : html`<${Wait}>Visas när coachen har godkänt månadsbedömningen.<//>`}
        <p class="fixed-text">${PRINCIPLE}</p>
      <//>
    <//>`;
  };

  // ------------------------------------------------------------ Slutrapport (hela perioden)
  const FinalDoc = ({ r, m, role }) => html`<${ui.Paper} title="Slutrapport" draft=${isDraftDoc(r) ? 'Utkast' : null} info=${baseInfo(r, m.number, [['Period', m.period]])}>
      <${Superseded} r=${r} />
      <${Sec} n="1" title="Grunduppgifter">
        <${ui.Kv} items=${[['Deltagare', nameOf(m.caseId, role)], ...m.basics]} />
        <p class="small muted">Personnummer skrivs inte ut. Ärendenumret identifierar deltagaren.</p>
      <//>
      <${Sec} n="2" title="Närvaro och frånvaro under hela perioden">
        <${AttendanceTable} rows=${m.months} total=${m.total} firstCol="Månad" />
        <p><b>Giltig frånvaro per orsak:</b> ${m.reasons}.</p>
        <p><b>Upprepad ogiltig frånvaro:</b> ${m.repeated.hit ? `Ja – ${m.repeated.count} tillfällen under perioden. Se avsnitt 6.` : 'Nej.'}</p>
      <//>
      <${Sec} n="3" title="Genomförda aktiviteter">
        <p class="small muted">Aktivitetstyperna är exempel – de stäms av mot mall 02.</p>
        <${ActivityChecklist} a=${m.activities} />
        <p><b>Dokumentation:</b> ${m.docText}</p>
      <//>
      <${Sec} n="4" title="Progression">
        ${!m.progression ? html`<p>Ingen godkänd månadsbedömning finns för perioden.</p>` : html`<div class="stack-sm">
          <p class="small muted">Jämförelse mellan första (${m.progression.firstMonth}) och senaste (${m.progression.lastMonth}) godkända månadsbedömning. Skala 0–3.</p>
          <${TWrap} min=${560}>
            <thead><tr><th style="width:30%">Område</th><th class="num">Första</th><th class="num">Senaste</th><th>Senaste observation</th></tr></thead>
            <tbody>${m.progression.rows.map((a) => html`<tr key=${a.key}><td>${a.label}</td><td class="num">${a.first}</td><td class="num">${a.last}</td><td>${a.observation}</td></tr>`)}</tbody>
          <//>
        </div>`}
      <//>
      <${Sec} n="5" title="Resultat och utfall">
        <p><b>Resultat:</b> ${m.resultText}</p>
        <${EventsTable} evs=${m.events} />
      <//>
      <${Sec} n="6" title="Avvikelse, risk och åtgärd"><${DeviationsBlock} dv=${m.deviations} /><//>
      <${Sec} n="7" title="Kvarstående hinder och rekommenderad fortsättning">
        <p><b>Kvarstående hinder:</b> ${m.obstacles}</p>
        ${m.recommendation ? html`<p><b>Rekommenderad fortsättning:</b> ${m.recommendation}</p>` : html`<${Wait}>Coachen skriver rekommenderad fortsättning innan rapporten godkänns.<//>`}
      <//>
      <${Sec} n="8" title="Coachens sammanfattande bedömning">
        ${m.assessment ? html`<${ui.Kv} items=${[['Samlad status', html`<${ui.Status} value=${m.assessment.overallStatus} />`], ['Sammanfattning', m.assessment.summary], ['Ansvarig coach', m.assessment.coach], ['Datum', m.assessment.date]]} />`
          : html`<${Wait}>Ingen godkänd bedömning finns ännu.<//>`}
        <p class="fixed-text">${PRINCIPLE}</p>
      <//>
    <//>`;

  // ------------------------------------------------------------ Veckorapport närvaro (en per handläggare och vecka)
  const WeeklyDoc = ({ r, m, role }) => {
    const kund = MM.perspectiveOf(role) === 'kund';
    const all = m.sections.map((s) => { const c = sel.caseById(s.caseId); return { ...s, acc: c ? sel.access(c, role) : 'none' }; });
    const secs = all.filter((s) => s.acc !== 'none');
    const open = secs.filter((s) => s.acc !== 'restricted');
    const hiddenProt = secs.length - open.length;
    const sum = (k) => MM.sum(open, (s) => s.stats[k]);
    const reg = sum('planned') - sum('unregistered');
    const rate = reg ? (sum('present') + sum('late')) / reg : null;
    const protText = kund ? 'Namn och närvaro visas bara för handläggaren som beställde insatsen.' : 'Visas bara för namngiven coach och avtalsansvarig.';
    const pubTime = (MM.cfg().sla.find((x) => x.key === 'veckorapport_publicering') || {}).time || '16:00';
    return html`<${ui.Paper} title="Veckorapport närvaro" draft=${r.status === 'waiting' ? 'Väntar på närvaro' : isDraftDoc(r) ? 'Utkast' : null}
      info=${[['Beställare', MM.contract().customerName], ['Avtal', MM.contract().contractNumber], ['Mottagare', personWithUnit(m.recipientUserId)], ['Vecka', `${ucfirst(weekText(m.week))} (${weekRange(m.week)})`], ['Version', String(r.version || 1)], ['Publicerad', r.deliveredAt ? dtFull(r.deliveredAt) : 'Inte publicerad']]}>
      <${Superseded} r=${r} />
      ${secs.length < all.length && html`<p class="small"><b>Du ser ${secs.length} av ${all.length} deltagare</b> – bara de ärenden du är tilldelad.</p>`}
      <${Sec} title="Sammanfattning">
        <${ui.Kv} items=${[['Deltagare', String(secs.length)], ['Planerade tillfällen', String(sum('planned'))], ['Närvarograd', fmt.pct(rate, 0)], ['Giltig frånvaro', String(sum('absentValid'))], ['Ogiltig frånvaro', String(sum('absentInvalid'))],
          sum('unregistered') > 0 && ['Ej registrerade', String(sum('unregistered'))]]} />
        <p class="small muted">Närvarograd = närvarotillfällen delat med registrerade planerade tillfällen. Giltig frånvaro redovisas separat. Bara orsakskategori anges.${hiddenProt > 0 ? ` Siffrorna räknar inte med ${hiddenProt === 1 ? 'deltagaren' : 'deltagarna'} med skyddade personuppgifter.` : ''}</p>
        ${open.length > 0 && html`<${TWrap} min=${480}>
          <thead><tr><th>Deltagare</th><th class="num">Närvaro</th><th class="num">Giltig frånvaro</th><th class="num">Ogiltig frånvaro</th><th>Risk</th></tr></thead>
          <tbody>${open.map((s) => html`<tr key=${s.caseId}><td>${nameOf(s.caseId, role)}<div class="small muted">${s.number}</div></td>
            <td class="num">${s.paused ? 'Uppehåll' : `${s.stats.present + s.stats.late} av ${s.stats.planned}`}${s.stats.unregistered > 0 ? html`<div class="small"><b>${s.stats.unregistered} ej registrerade</b></div>` : ''}</td>
            <td class="num">${s.stats.absentValid}</td><td class="num">${s.stats.absentInvalid > 0 ? html`<b>${s.stats.absentInvalid}</b>` : '0'}</td><td>${s.risk}</td></tr>`)}</tbody>
        <//>`}
      <//>
      <${Sec} title="Deltagare – tillfällen och åtgärder">
        ${secs.length === 0 ? html`<p>Inga deltagare att visa för din roll.</p>` : secs.map((s) => s.acc === 'restricted'
          ? html`<div key=${s.caseId} class="stack-sm" style="border-top:1px solid var(--ljusgra);padding-top:12px"><h3 style="font-size:1rem">${s.number} · Skyddade personuppgifter</h3><p class="small">${protText}</p></div>`
          : html`<div key=${s.caseId} class="stack-sm" style="border-top:1px solid var(--ljusgra);padding-top:12px">
            <h3 style="font-size:1rem">${nameOf(s.caseId, role)} · ${s.number}</h3>
            ${s.paused ? html`<p>Uppehåll denna vecka. Ingen närvaro planerad.</p>` : s.rows.length === 0 ? html`<p>Inga tillfällen planerade denna vecka.</p>` : html`<${TWrap} min=${440}>
              <thead><tr><th>Tillfälle</th><th>Aktivitet</th><th>Närvaro</th><th>Orsak</th></tr></thead>
              <tbody>${s.rows.map((a) => html`<tr key=${a.id}><td>${ucfirst(d.WD[d.weekday(a.startsAt)])} ${dayMonth(a.startsAt)} klockan ${d.fmtTime(a.startsAt)}</td><td>${ucfirst(a.kind)}</td>
                <td>${a.status ? sel.attLabel(a.status) : a.startsAt > m.now ? 'Planerat' : html`<b>Ej registrerad</b>`}</td><td>${a.status === 'absent_valid' ? (a.reason || 'Giltigt skäl') : '–'}</td></tr>`)}</tbody>
            <//>`}
            <div class="small">Planerade tillfällen ${s.stats.planned} · närvaro ${s.stats.present + s.stats.late} · giltig frånvaro ${s.stats.absentValid} · ogiltig frånvaro ${s.stats.absentInvalid}</div>
            ${s.stats.absentInvalid > 0 && html`<p><b>Åtgärd vid ogiltig frånvaro:</b> ${s.actions.length ? s.actions.join(' ') : 'Coachen följer upp frånvaron med deltagaren i nästa veckoavstämning.'}</p>`}
            <p><b>Risk:</b> ${s.risk}</p>
          </div>`)}
      <//>
      <p class="fixed-text">Veckorapporten skapas automatiskt från coachernas närvaroregistrering. Den publiceras när alla deltagare är registrerade, senast måndag klockan ${d.fmtTime(`2000-01-01T${pubTime}`)} för föregående vecka.</p>
    <//>`;
  };

  // ------------------------------------------------------------ Orderbekräftelse
  const OrderDoc = ({ r, m, role }) => html`<${ui.Paper} title="Orderbekräftelse" draft=${isDraftDoc(r) ? 'Utkast' : null} info=${baseInfo(r, m.number, [['Beställarreferens', m.buyerReference || 'Saknas']])}>
      <${Superseded} r=${r} />
      <p>Miljonbemanning bekräftar beställningen med ärendenummer <b>${m.number}</b>. Ärendenumret är också ordernummer och står på fakturorna. Använd det i stället för personnummer när ni kontaktar oss.</p>
      <${Sec} title="Insatsen">
        <${ui.Kv} items=${[['Deltagare', nameOf(m.caseId, role)], ['Ärendenummer', m.number], ['Avtalsområde', m.area], ['Yrkesspår', m.track], ['Startdatum', m.start], ['Huvudcoach', m.coach],
          ['Första mötet', m.firstMeeting], ['Planerad omfattning', m.weeks ? `${m.weeks} veckor${m.plannedEnd ? ` (till och med ${m.plannedEnd})` : ''}` : 'Ej angiven']]} />
      <//>
      <${Sec} title="Beställningens värde">
        ${m.weeks ? html`<${ui.Kv} items=${[['Planerad omfattning', `${m.weeks} veckor`], ['Veckopris exklusive moms', `${fmt.kr(m.price)} (${m.area})`],
          ['Beställningens värde exklusive moms', html`<b>${fmt.kr(m.weeks * m.price)}</b> <span class="small muted nowrap">(${m.weeks} × ${fmt.kr(m.price)})</span>`]]} />` : html`<p>Värdet beräknas när omfattningen är bestämd.</p>`}
        <p class="small">Värdet är planerade veckor gånger veckopriset för avtalsområdet. Det används för att visa upparbetat och återstående belopp på varje faktura. Fakturering sker per deltagarvecka.</p>
      <//>
      <${Sec} title="Fakturering">
        <${ui.Kv} items=${[['Beställarreferens', m.buyerReference || 'Saknas – måste kompletteras'], ['Kommunens inköpsordernummer', m.purchaseOrderNumber || 'Inget angivet'], ['Faktureringsobjekt', `Ärende ${m.number}`]]} />
      <//>
      <p class="fixed-text">Frågor om beställningen? Skicka ett meddelande i portalen och ange ärendenumret. Skriv inte personnummer i e-post.</p>
    <//>`;

  // ------------------------------------------------------------ Beställarrapport (kommunens chef)
  const CustomerSummaryDoc = ({ r, m }) => {
    const target = m.result.contractTarget;
    const numSmall = (x) => x.num > 0 && x.num < m.minN;
    const resRow = (label, x) => {
      const hidden = x.den > 0 && x.den < m.minN;
      const share = x.den === 0 ? '–' : hidden || numSmall(x) ? 'Redovisas inte' : fmt.pct(x.value);
      const vs = x.den === 0 || hidden ? '–' : x.den < m.resultMinN ? 'För få avslut för att bedöma' : x.value >= target ? 'I nivå med eller över avtalsmålet' : 'Under avtalsmålet';
      return html`<tr><td>${label}</td><td class="num">${small(m, x.num)}</td><td class="num">${hidden ? `färre än ${m.minN}` : x.den}</td><td class="num">${share}</td><td>${vs}</td></tr>`;
    };
    const roll = m.result.rolling;
    const tracks = m.byTrack.slice(0, 8); const restTracks = m.byTrack.slice(8);
    return html`<${ui.Paper} title="Beställarrapport" draft=${isDraftDoc(r) ? 'Utkast' : null} info=${baseInfo(r, null, [['Månad', d.monthName(m.month)], ['Mottagare', personWithUnit(r.recipientUserId)]])}>
      <${Superseded} r=${r} />
      <p class="small">Uppgifter per grupp med färre än ${m.minN} personer redovisas som "färre än ${m.minN}". Rapporten innehåller inga namn.</p>
      <${Sec} n="1" title="Deltagare">
        <${ui.Kv} items=${[['Aktiva under månaden', small(m, m.active)], ['Nya insatser', small(m, m.started)], ['Avslutade insatser', small(m, m.closed)]]} />
        <${TWrap} min=${360}>
          <thead><tr><th>Avtalsområde</th><th class="num">Aktiva</th><th class="num">Nya</th><th class="num">Avslutade</th></tr></thead>
          <tbody>${m.byArea.map((a) => html`<tr key=${a.code}><td>${a.name}</td><td class="num">${small(m, a.active)}</td><td class="num">${small(m, a.started)}</td><td class="num">${small(m, a.closed)}</td></tr>`)}</tbody>
        <//>
        <${TWrap} min=${260}>
          <thead><tr><th>Yrkesspår</th><th class="num">Aktiva</th></tr></thead>
          <tbody>${tracks.map((t) => html`<tr key=${t.track || '-'}><td>${t.track || 'Inte valt än'}</td><td class="num">${small(m, t.active)}</td></tr>`)}
            ${restTracks.length > 0 && html`<tr><td>Övriga ${restTracks.length} yrkesspår</td><td class="num">${small(m, MM.sum(restTracks, (t) => t.active))}</td></tr>`}</tbody>
        <//>
      <//>
      <${Sec} n="2" title="Resultat – arbete eller studier">
        <${TWrap} min=${560}>
          <thead><tr><th>Period</th><th class="num">Resultat</th><th class="num">Avslut som räknas</th><th class="num">Andel</th><th>Jämfört med avtalsmålet ${fmt.pct(target, 0)}</th></tr></thead>
          <tbody>${resRow(ucfirst(d.monthName(m.month)), m.result.month)}${resRow('Rullande 6 månader', roll)}${resRow('Sedan avtalets start', m.result.sinceStart)}</tbody>
        <//>
        ${roll.den >= m.resultMinN && roll.value != null && !numSmall(roll) && html`<${ui.Meter} value=${roll.value} max=${0.6} tone="blue" label=${`Resultatgrad rullande 6 månader ${fmt.pct(roll.value)}`} markers=${[{ value: target, label: `Avtalsmål ${fmt.pct(target, 0)}`, tone: 'red' }]} />`}
        <p class="small">${roll.prelim > 0 ? `${ucfirst(small(m, roll.prelim))} avslut till arbete eller studier väntar på verifiering och räknas inte ännu. ` : ''}Resultatdefinitionen är inte fastställd. ${MM.cfg().result.prototypeDefinition || ''}</p>
      <//>
      <${Sec} n="3" title="Progression">
        <p>${m.progression.assessed >= m.minN ? html`<b>${fmt.pct(m.progression.clear / m.progression.assessed, 0)}</b> av deltagarna med godkänd månadsbedömning visade tydlig progression (nivå 2 eller högre i minst ett område). Underlag: ${m.progression.assessed} bedömningar.` : `Färre än ${m.minN} godkända månadsbedömningar – andelen redovisas inte.`}</p>
        ${m.progression.assessed >= m.minN && html`<${TWrap} min=${420}>
          <thead><tr><th>Område</th><th class="num">Tydlig progression</th><th class="num">Andel</th></tr></thead>
          <tbody>${m.progression.areaDist.map((a) => html`<tr key=${a.key}><td>${a.label}</td><td class="num">${small(m, a.clear)}</td><td class="num">${a.clear > 0 && a.clear < m.minN ? 'Redovisas inte' : fmt.pct(a.n ? a.clear / a.n : null, 0)}</td></tr>`)}</tbody>
        <//>`}
      <//>
      <${Sec} n="4" title="Närvaro">
        <${ui.Kv} items=${[['Närvarograd', fmt.pct(m.attendanceRate)], ['Planerade tillfällen', fmt.num(m.attendance.planned)], ['Giltig frånvaro', small(m, m.attendance.absentValid)], ['Ogiltig frånvaro', small(m, m.attendance.absentInvalid)]]} />
      <//>
      <${Sec} n="5" title="Avvikelser">
        <${ui.Kv} items=${[['Avvikelser på deltagarnivå', small(m, m.deviations)], ['Avtalsavvikelser', small(m, m.contractDeviations)]]} />
      <//>
      <${Sec} n="6" title="Nöjdhet">
        <p>${m.pulse.enough ? html`<b>${fmt.pct(m.pulse.satisfaction, 0)}</b> av deltagarna som svarade gav 4 eller 5 på en skala från 1 till 5 på frågan om hur nöjda de är (${m.pulse.responses} svar under ${m.pulse.period}).` : `Färre än ${m.minN} svar under ${m.pulse.period} – resultatet redovisas inte.`}</p>
      <//>
      ${m.sla && html`<${Sec} n="7" title="Svarstider"><${ui.Kv} items=${m.sla} /><//>`}
      <${Sec} n=${m.sla ? '8' : '7'} title="Sammanfattning">
        ${m.summary ? html`<p>${m.summary}</p><p class="small muted">Godkänd av ${MM.personName(r.approvedBy || MM.contract().contractManagerId)}${r.approvedAt ? `, ${dFull(r.approvedAt)}` : ''}.</p>` : html`<${Wait}>Sammanfattningen skrivs när avtalsansvarig godkänner rapporten.<//>`}
      <//>
    <//>`;
  };

  // Kommunportalens rubrikregler (.portal h1/h2) får inte ändra rapportpapprets typografi.
  const DOC_CSS = '.portal .rap-doc .paper h1{font-size:1.25rem;letter-spacing:.05em;display:block}.portal .rap-doc .paper h2{font-size:.875rem;letter-spacing:.08em;font-weight:800}.rap-doc .paper h3{font-size:1rem;font-weight:800}';
  const DOCS = { monthly: MonthlyDoc, final: FinalDoc, weekly_attendance: WeeklyDoc, order_confirmation: OrderDoc, customer_summary: CustomerSummaryDoc };
  /** Återanvändbar rendering av en rapport som PDF-förhandsvisning. props: { report } eller { reportId }, valfritt role.
   *  Levererade rapporter visas från ögonblicksbilden (frysta). */
  const ReportDocument = ({ report, reportId, role }) => {
    const rl = role || MM.role();
    const r = report || S().reports.find((x) => x.id === reportId);
    if (!r) return html`<${ui.Empty} icon="file" title="Rapporten finns inte" />`;
    const C = DOCS[r.kind];
    if (!C) return html`<${ui.Empty} icon="file" title=${sel.reportKindLabel(r.kind)}>Den här rapporttypen visas inte i prototypen.<//>`;
    const m = modelFor(r);
    if (!m) return html`<${ui.Empty} icon="file" title=${r.kind === 'weekly_attendance' ? 'Rapporten saknar vecka eller mottagare' : 'Ärendet finns inte'} />`;
    return html`<div class="rap-doc"><style>${DOC_CSS}</style><${C} r=${r} m=${m} role=${rl} /></div>`;
  };

  // ------------------------------------------------------------ Egna åtgärder (prefix rap.)
  const findRep = (st, id) => st.reports.find((x) => x.id === id);
  /** Ögonblicksbild av en levererad rapport. Körs direkt efter report.deliver (och efter automatisk publicering).
   *  Innehållet (siffror, texter, bedömningar) fryses – en senare ändring av underlaget ändrar inte den levererade versionen. */
  MM.defineAction('rap.snapshot', (st, p, ctx) => {
    const ids = p.reportIds || [p.reportId]; const done = [];
    for (const id of ids) {
      const r = findRep(st, id); if (!r || !isDelivered(r) || !BUILD[r.kind] || hasSnapshot(r)) continue;
      const m = BUILD[r.kind](liveSrc(), r, true); if (!m) continue;
      r.snapshot = { reportId: r.id, takenAt: ctx.now, deliveredAt: r.deliveredAt, model: JSON.parse(JSON.stringify(m)) };
      done.push(r.id);
    }
    return { reportIds: done };
  });
  /** Samordnarens valfria kvalitetsgranskning. */
  MM.defineAction('rap.qualityReview', (st, p, ctx) => { const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' }; r.qualityReviewedBy = ctx.actorId; r.qualityReviewedAt = ctx.now; ctx.audit('report.quality_reviewed', 'report', r.id, { kind: r.kind }); return {}; });
  /** Slutrapportens kvarstående hinder och rekommenderade fortsättning (coachens text). Ändrad text måste godkännas igen. */
  MM.defineAction('rap.saveFinal', (st, p, ctx) => {
    const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' };
    if (isDelivered(r) || r.superseded) return { error: 'delivered' };
    const rec = String(p.recommendation || '').trim(); if (!rec) return { error: 'recommendation' };
    r.finalText = { obstacles: String(p.obstacles || '').trim(), recommendation: rec };
    if (r.status === 'draft') r.status = 'reviewed';
    if (r.status === 'approved') { r.status = 'reviewed'; r.approvedAt = null; r.approvedBy = null; }
    ctx.audit('report.final_text_saved', 'report', r.id, { kind: r.kind });
    return {};
  });
  /** Beställarrapportens sammanfattning (avtalsansvarig). Innehållet loggas inte – bara att det sparats. */
  MM.defineAction('rap.saveSummary', (st, p, ctx) => {
    const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' };
    if (isDelivered(r) || r.superseded) return { error: 'delivered' };
    const text = String(p.summary || '').trim(); if (!text) return { error: 'summary' };
    r.summary = text; r.summaryAiUsed = !!p.aiUsed;
    ctx.audit('report.summary_saved', 'report', r.id, { aiUsed: !!p.aiUsed });
    return {};
  });
  /** Orsak till rättelse på den nya versionen. Nollställer kvalitetsgranskningen och den kopierade ögonblicksbilden. */
  MM.defineAction('rap.correctionNote', (st, p, ctx) => {
    const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' };
    r.correctionReason = String(p.reason || '').trim(); r.correctedBy = ctx.actorId; r.correctedAt = ctx.now; r.qualityReviewedBy = null; r.qualityReviewedAt = null;
    delete r.snapshot;
    ctx.audit('report.correction_reason', 'report', r.id, { previous: r.previousId || null });
    return {};
  });
  /** Rapporter som levereras någon annanstans (t.ex. veckorapporten som publiceras automatiskt vid närvaroregistrering)
   *  får sin ögonblicksbild direkt efter åtgärden som levererade dem. */
  const autoSnapshot = () => {
    const st = S(); if (!st || MM.store.replaying) return;
    const now = MM.clock();
    const ids = st.reports.filter((r) => r.deliveredAt === now && isDelivered(r) && BUILD[r.kind] && !hasSnapshot(r)).map((r) => r.id);
    if (ids.length) MM.dispatch('rap.snapshot', { reportIds: ids }, { silent: true });
  };
  if (MM.store && MM.store.listeners) MM.store.listeners.add(autoSnapshot);

  // ------------------------------------------------------------ Rapportlista
  const parseFilter = (f) => {
    const x = String(f || '');
    const alias = { forsenade: 'overdue', 'denna-vecka': 'week', godkannande: 'approval', leverans: 'deliver' };
    if (KINDS.includes(x)) return { kind: x };
    if (STATUSES.includes(x)) return { status: x };
    if (QUICK[x] || alias[x]) return { quick: QUICK[x] ? x : alias[x] };
    if (/^\d{4}-\d{2}$/.test(x)) return { period: x };
    return {};
  };

  const buildRows = (role, pid) => {
    const st = S();
    const caseMap = {}; for (const c of st.cases) caseMap[c.id] = c;
    const myCases = role === 'coach' ? st.cases.filter((c) => c.leadCoachId === pid) : [];
    const hasCaseIn = (r) => myCases.some((c) => c.referrerId === r.recipientUserId && c.startDate && c.startDate <= r.periodEnd && (!c.endDate || c.endDate >= r.periodStart));
    const out = [];
    for (const r of st.reports) {
      if (r.superseded || !KINDS.includes(r.kind)) continue;
      const c = r.caseId ? caseMap[r.caseId] : null;
      if (role === 'coach') {
        if (c ? c.leadCoachId !== pid : !(r.kind === 'weekly_attendance' && hasCaseIn(r))) continue;
      }
      const name = c ? sel.displayName(c, role) : '';
      const who = c ? `${c.number} · ${name}` : `Till ${MM.personName(r.recipientUserId)}`;
      const sub = r.kind === 'final' ? `${who} · ${periodText(r)}` : r.kind === 'order_confirmation' ? `${who} · ${periodText(r)}` : r.kind === 'weekly_attendance' ? `${who} · ${d.fmtWeekRange(r.week)}` : who;
      out.push({ id: r.id, r, c, title: reportTitle(r), sub, eff: effStatus(r), next: nextStep(r), overdue: isOverdue(r), week: dueThisWeek(r), search: `${reportTitle(r)} ${sub}`.toLowerCase() });
    }
    return out;
  };
  const sortRows = (rows) => {
    const open = rows.filter((x) => !isDelivered(x.r)).sort((a, b) => ((a.r.dueAt || '9999') < (b.r.dueAt || '9999') ? -1 : 1));
    const done = rows.filter((x) => isDelivered(x.r)).sort((a, b) => ((a.r.deliveredAt || a.r.periodEnd || '') > (b.r.deliveredAt || b.r.periodEnd || '') ? -1 : 1));
    return [...open, ...done];
  };

  const ProvisionalNote = ({ r }) => isProvisional(r) && html`<span class="small muted row-sm" style="gap:4px;flex-wrap:nowrap" title=${provisionalText(r)}><${I} name="help" />${NO_DUE}</span>`;
  const DueCell = ({ r }) => {
    if (!r.dueAt) return html`<span class="muted">–</span>`;
    const tone = sel.slaStatus(r.dueAt, isDelivered(r) ? r.deliveredAt : null).tone;
    return html`<div class="stack-sm" style="gap:4px;align-items:flex-start;min-width:150px">
      ${isDelivered(r) ? html`<${ui.SlaBadge} dueAt=${r.dueAt} metAt=${r.deliveredAt} />` : html`<${ui.SlaBadge} dueAt=${r.dueAt} />`}
      ${isDelivered(r) ? html`<span class="small muted nowrap">Levererad ${d.fmtDateTime(r.deliveredAt)}</span>` : tone !== 'ok' ? html`<span class="small muted nowrap">Förfaller ${d.fmtDateTime(r.dueAt)}</span>` : null}
      ${!isDelivered(r) && html`<${ProvisionalNote} r=${r} />`}
    </div>`;
  };

  const Tile = ({ label, value, sub, alert, active, onClick }) => html`<button type="button" aria-pressed=${active ? 'true' : 'false'} onClick=${onClick}
      style="background:none;border:0;padding:0;text-align:left;font:inherit;color:inherit;cursor:pointer;display:grid;width:100%;min-height:44px;border-radius:10px">
      <${ui.Kpi} label=${label} value=${String(value)} sub=${sub} tone=${alert ? 'alert' : active ? 'watch' : undefined}>
        <span class="small strong row-sm" style="gap:4px;margin-top:auto"><${I} name=${active ? 'check' : 'filter'} />${active ? 'Filtret är på' : 'Visa i listan'}</span>
      <//>
    </button>`;
  /** Smal skärm (mobil): listan visas som kort i stället för tabell. */
  const useNarrow = (px = 620) => {
    const q = () => { try { return window.matchMedia(`(max-width: ${px}px)`).matches; } catch (e) { return false; } };
    const [narrow, setNarrow] = useState(q());
    useEffect(() => { const on = () => setNarrow(q()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
    return narrow;
  };
  const MobileRows = ({ rows }) => html`<div class="list">${rows.length === 0 ? html`<div class="list-item muted">Inga rapporter matchar filtret.</div>` : rows.map((x) => html`
    <button type="button" key=${x.id} class="list-item clickable" style=${x.overdue ? 'box-shadow:inset 4px 0 0 var(--rod)' : ''} onClick=${() => MM.nav('rapport.visa', { reportId: x.id })}>
      <div class="li-main">
        <span class="li-title">${x.title}</span>
        <span class="li-sub">${x.sub}</span>
        <div class="row-sm" style="margin-top:4px"><${StatusBadge} r=${x.r} />${x.r.dueAt && (isDelivered(x.r) ? html`<${ui.SlaBadge} dueAt=${x.r.dueAt} metAt=${x.r.deliveredAt} />` : html`<${ui.SlaBadge} dueAt=${x.r.dueAt} />`)}</div>
        <span class="li-sub">${x.next.label}${x.r.version > 1 ? ` · version ${x.r.version}` : ''}</span>
        ${!isDelivered(x.r) && html`<${ProvisionalNote} r=${x.r} />`}
      </div>
      <${I} name="chevron-right" />
    </button>`)}</div>`;
  const TILES_STYLE = 'display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,165px),1fr))';

  const ListView = ({ params, role }) => {
    MM.useStore();
    const pid = MM.currentPersonaId();
    const init = useMemo(() => parseFilter(params && params.filter), []);
    const [kind, setKind] = useState(init.kind || 'all');
    const [status, setStatus] = useState(init.status || 'all');
    const [period, setPeriod] = useState(init.period || 'all');
    const [quick, setQuick] = useState(init.quick || null);
    const [q, setQ] = useState('');
    const [limit, setLimit] = useState(PAGE_SIZE);
    const narrow = useNarrow();
    const all = useMemo(() => buildRows(role, pid), [MM.store.version, role, pid]);
    const counts = { overdue: all.filter((x) => x.overdue).length, week: all.filter((x) => x.week).length, approval: all.filter((x) => x.next.key === 'approval').length, deliver: all.filter((x) => x.next.key === 'deliver').length };
    const blockedWeek = all.filter((x) => (x.week || x.overdue) && x.next.key === 'blocked').length;
    const months = []; for (let mk = d.monthKey(d.today()); mk >= d.monthKey(MM.contract().startsOn); mk = d.addMonths(mk, -1)) months.push(mk);
    const query = q.trim().toLowerCase();
    const rows = sortRows(all.filter((x) => (kind === 'all' || x.r.kind === kind) && (status === 'all' || x.eff === status)
      && (period === 'all' || ((x.r.periodStart || '') <= d.monthEnd(period) && (x.r.periodEnd || x.r.periodStart || '') >= `${period}-01`))
      && (!quick || (quick === 'overdue' ? x.overdue : quick === 'week' ? x.week : x.next.key === quick))
      && (!query || x.search.includes(query))));
    const shown = rows.slice(0, limit);
    const anyFilter = kind !== 'all' || status !== 'all' || period !== 'all' || quick || query;
    const reset = () => { setKind('all'); setStatus('all'); setPeriod('all'); setQuick(null); setQ(''); setLimit(PAGE_SIZE); };
    const toggleQuick = (k) => { setQuick(quick === k ? null : k); setLimit(PAGE_SIZE); };
    const coach = role === 'coach';
    const columns = [
      { key: 'title', label: 'Rapport', render: (x) => html`<div class="stack-sm" style="gap:2px;min-width:200px"><span class="strong">${x.title}</span><span class="small muted">${x.sub}</span></div>` },
      { key: 'status', label: 'Status', render: (x) => html`<div class="stack-sm" style="gap:4px;align-items:flex-start;min-width:170px"><div class="row-sm"><${StatusBadge} r=${x.r} />${x.overdue && html`<${ui.Badge} tone="red" icon="alert">Försenad<//>`}</div><span class="small muted">${x.next.label}</span></div>` },
      { key: 'due', label: 'Förfaller', render: (x) => html`<${DueCell} r=${x.r} />` },
      { key: 'version', label: 'Version', num: true, render: (x) => html`<span class="nowrap">${x.r.version || 1}</span>` },
    ];
    return html`<${ui.Page} title="Rapporter" eyebrow=${coach ? 'Dina ärenden' : `${MM.contract().customerName} · avtal ${MM.contract().contractNumber}`}
      lead=${coach ? 'Månadsrapporter, slutrapporter och orderbekräftelser för dina ärenden, och veckorapporter där du har deltagare. Rapporterna byggs bara av godkända uppgifter.' : 'Alla rapporter till kommunen: veckorapporter, månadsrapporter, slutrapporter, orderbekräftelser och beställarrapporter. Rapporterna byggs bara av godkända uppgifter och levereras i portalen.'}
      actions=${html`<${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.rapporter" params=${{}} label="Se kommunens rapportsida" />`}>
      <div style=${TILES_STYLE}>
        <${Tile} label="Försenade" value=${counts.overdue} alert=${counts.overdue > 0} active=${quick === 'overdue'} onClick=${() => toggleQuick('overdue')}
          sub=${counts.overdue > 0 ? 'Förfallotiden har passerat. Vitesrisk.' : 'Inga försenade rapporter.'} />
        <${Tile} label="Förfaller denna vecka" value=${counts.week} active=${quick === 'week'} onClick=${() => toggleQuick('week')}
          sub=${`Till och med ${d.fmtDateShort(weekEnd())}.${blockedWeek > 0 ? ` ${blockedWeek} väntar på underlag.` : ''}`} />
        <${Tile} label="Väntar på godkännande" value=${counts.approval} active=${quick === 'approval'} onClick=${() => toggleQuick('approval')}
          sub="Underlaget är godkänt." />
        <${Tile} label="Väntar på leverans" value=${counts.deliver} active=${quick === 'deliver'} onClick=${() => toggleQuick('deliver')}
          sub="Godkända men inte levererade." />
      </div>
      <${ui.Card} title="Filter" icon="filter" actions=${anyFilter && html`<${ui.Btn} kind="ghost" icon="x" onClick=${reset}>Rensa filter<//>`}>
        <div class="grid-4">
          <${ui.Field} label="Typ" id="rap-kind"><${ui.Select} id="rap-kind" value=${kind} onChange=${(v) => { setKind(v); setLimit(PAGE_SIZE); }} options=${[{ value: 'all', label: 'Alla typer' }, ...KINDS.map((k) => ({ value: k, label: sel.reportKindLabel(k) }))]} /><//>
          <${ui.Field} label="Status" id="rap-status"><${ui.Select} id="rap-status" value=${status} onChange=${(v) => { setStatus(v); setLimit(PAGE_SIZE); }} options=${[{ value: 'all', label: 'Alla statusar' }, ...STATUSES.map((s) => ({ value: s, label: sel.reportStatusLabel(s) }))]} /><//>
          <${ui.Field} label="Period" id="rap-period"><${ui.Select} id="rap-period" value=${period} onChange=${(v) => { setPeriod(v); setLimit(PAGE_SIZE); }} options=${[{ value: 'all', label: 'Hela avtalsperioden' }, ...months.map((mk) => ({ value: mk, label: ucfirst(d.monthName(mk)) }))]} /><//>
          <${ui.Field} label="Sök" id="rap-q"><${ui.Input} id="rap-q" value=${q} onInput=${(v) => { setQ(v); setLimit(PAGE_SIZE); }} placeholder="Ärendenummer eller namn" /><//>
        </div>
      <//>
      <${ui.Card} flush title=${`${fmt.num(rows.length)} ${rows.length === 1 ? 'rapport' : 'rapporter'}${quick ? ` · ${QUICK[quick].toLowerCase()}` : ''}`}
        actions=${html`<span class="small muted">Mest brådskande först</span>`}
        foot=${rows.length > limit ? html`<${ui.Btn} kind="secondary" icon="chevron-down" onClick=${() => setLimit(limit + PAGE_SIZE)}>Visa ${Math.min(PAGE_SIZE, rows.length - limit)} till<//><span class="small muted">Visar ${shown.length} av ${fmt.num(rows.length)}</span>` : null}>
        ${narrow ? html`<${MobileRows} rows=${shown} />` : html`<${ui.Table} columns=${columns} rows=${shown} caption="Rapporter" empty="Inga rapporter matchar filtret." rowClass=${(x) => (x.overdue ? 'row-alert' : '')} onRowClick=${(x) => MM.nav('rapport.visa', { reportId: x.id })} />`}
      <//>
      <${ui.Card} title="Så fungerar rapporterna" icon="info">
        <div class="stack">
          <${ui.Stepper} steps=${LIFECYCLE} current=${-1} />
          <ul style="margin:0;padding-left:20px" class="stack-sm">
            <li>Rapporter byggs bara av godkända uppgifter: registrerad närvaro, godkända avstämningar och godkända månadsbedömningar.</li>
            <li>Coachen granskar och godkänner. Samordnaren kan kvalitetsgranska innan leverans (valfritt).</li>
            <li>Leveransen sker i kommunens portal. Mejlet innehåller bara en notis utan personuppgifter.${MM.cfg().reportDelivery.emailAttachmentAllowed ? '' : ' Bilaga i e-post är avstängd.'}</li>
            <li>När mottagaren öppnar rapporten första gången blir den kvitterad.</li>
            <li>Rättelse skapar en ny version. Den gamla versionen sparas, och kommunen ser den tills den nya versionen är levererad.</li>
            <li>En levererad rapport är låst. Den visas som den såg ut vid leveransen, även om underlaget ändras senare.</li>
          </ul>
        </div>
      <//>
      <${ui.DemoNote}>Listan räknas fram ur demodata. Förfallotider för månads-, slut- och beställarrapporter är förslag tills ${MM.contract().customerName} har fastställt dem ("${NO_DUE}").<//>
    <//>`;
  };

  // ------------------------------------------------------------ Rapportvisning – leverantörens sida
  const DENIED = {
    not_assigned: ['Rapporten gäller ett ärende du inte är tilldelad', 'Du ser bara rapporter för dina egna ärenden. Så fungerar behörigheten i den riktiga tjänsten också.'],
    protected: ['Skyddade personuppgifter', 'Rapporten gäller ett ärende med skyddade personuppgifter. Den visas bara för namngiven coach och avtalsansvarig.'],
    handledare: ['Månads- och slutrapporter visas inte för handledare', 'Rapporten innehåller coachens bedömningar och samlad status. Den är till för huvudcoachen, samordnaren, avtalsansvarig och kommunen. Som handledare ser du närvaron och veckorapporterna för dina tilldelade ärenden. Fråga huvudcoachen om du behöver veta hur det går för deltagaren.'],
    handledare_order: ['Orderbekräftelsen visas inte för handledare', 'Orderbekräftelsen innehåller beställningens värde och fakturauppgifter. Som handledare ser du närvaron och veckorapporterna för dina tilldelade ärenden.'],
    role: ['Rapporten är inte tillgänglig för din roll', 'Beställarrapporten är till för avtalsansvarig, samordnare, ledningen och kommunens chef.'],
    missing: ['Rapporten saknar ärende', 'Rapporten kan inte visas.'],
    not_yours: ['Rapporten är inte tillgänglig för dig', 'Du ser bara rapporter om dina egna deltagare.'],
    not_delivered: ['Rapporten är inte klar ännu', 'Du ser rapporten här när Miljonbemanning har levererat den. Du får ett mejl när den finns i portalen.'],
  };
  const customerRoleFor = (r) => (recipientOf(r) === 'k-maria' ? 'kommun_handlaggare' : 'kommun_chef');
  const supplierRoleFor = (r) => { const c = caseOf(r); return c && c.leadCoachId === MM.roleDef('coach').personaId ? 'coach' : 'avtalsansvarig'; };
  const noticeText = (r) => { const c = caseOf(r); return `${sel.reportKindLabel(r.kind)}${c ? ` för ärende ${c.number}` : ''} finns i portalen – logga in för att läsa.`; };
  const versionsOf = (r) => {
    const reps = S().reports; const chain = [r]; let cur = r;
    while (cur && cur.previousId) { cur = reps.find((x) => x.id === cur.previousId); if (cur) chain.unshift(cur); }
    cur = r; for (let i = 0; i < 20; i++) { const nx = reps.find((x) => x.previousId === cur.id); if (!nx) break; chain.push(nx); cur = nx; }
    return chain;
  };
  /** Senast levererade versionen i rapportens versionskedja (det kommunen ser medan en rättelse är ett utkast). */
  const latestDelivered = (r) => versionsOf(r).filter(isDelivered).pop() || null;

  const idleText = (r, role, step) => {
    if (role === 'chef' || role === 'handledare') return 'Du kan läsa rapporten. Coach, samordnare och avtalsansvarig hanterar godkännande och leverans.';
    if (step.key === 'blocked' || step.key === 'correcting') return null;
    if (step.key === 'registration') return 'Rapporten publiceras automatiskt när coacherna har registrerat närvaron.';
    if (step.key === 'approval') { const c = caseOf(r); return r.kind === 'customer_summary' ? 'Avtalsansvarig godkänner beställarrapporten nedan.' : ['monthly', 'final'].includes(r.kind) ? `Huvudcoachen${c ? ` ${MM.personName(c.leadCoachId)}` : ''} godkänner rapporten.` : 'Samordnaren eller avtalsansvarig godkänner rapporten.'; }
    if (step.key === 'deliver') return 'Coach, samordnare eller avtalsansvarig levererar rapporten till kommunen.';
    return 'Inga åtgärder behövs just nu.';
  };
  const StatusCard = ({ r, role, acc, onDeliver, onCorrect }) => {
    const c = caseOf(r); const step = nextStep(r);
    const lead = acc.access === 'full';
    const ma = r.kind === 'monthly' ? sel.assessment(r.caseId, r.month) : null;
    const pend = isDelivered(r) ? pendingCorrection(r) : null;
    const approvedStates = ['draft', 'reviewed'].includes(r.status) && !r.superseded;
    const canApprove = approvedStates && step.key === 'approval' && (
      (['monthly', 'final'].includes(r.kind) && role === 'coach' && lead) ||
      (['order_confirmation', 'weekly_attendance'].includes(r.kind) && ['samordnare', 'avtalsansvarig'].includes(role)));
    const deliverRoles = r.kind === 'customer_summary' ? ['avtalsansvarig', 'samordnare'] : ['coach', 'samordnare', 'avtalsansvarig'];
    const roleOk = deliverRoles.includes(role) && (role !== 'coach' || lead);
    const weeklyReady = r.kind === 'weekly_attendance' && r.status === 'waiting' && sel.weeklyReport(r.recipientUserId, r.week).complete;
    const textOk = r.kind !== 'final' || hasRecommendation(r);
    const canDeliver = roleOk && !r.superseded && textOk && (r.status === 'approved' || weeklyReady);
    const canCorrect = roleOk && !r.superseded && !pend && ['approved', 'delivered', 'opened'].includes(r.status);
    const canQuality = role === 'samordnare' && !r.superseded && ['reviewed', 'approved'].includes(r.status) && !r.qualityReviewedAt;
    const approve = () => { MM.dispatch('report.approve', { reportId: r.id }); MM.toast(`${reportTitle(r)} är godkänd. Nästa steg: leverera till kommunen.`, 'blue'); };
    const quality = () => { MM.dispatch('rap.qualityReview', { reportId: r.id }); MM.toast('Rapporten är markerad som kvalitetsgranskad.', 'blue'); };
    const dueRow = r.dueAt && ['Förfaller', html`<div class="row-sm">${isDelivered(r) ? html`<${ui.SlaBadge} dueAt=${r.dueAt} metAt=${r.deliveredAt} />` : html`<${ui.SlaBadge} dueAt=${r.dueAt} />`}<span class="small">${d.fmtDateTimeLong(r.dueAt)}</span></div>`];
    return html`<${ui.Card} title="Status och nästa steg" icon="activity" tone=${isOverdue(r) ? 'red' : undefined}>
      <div class="stack">
        <div class="row-sm"><${StatusBadge} r=${r} />${isOverdue(r) && html`<${ui.Badge} tone="red" icon="alert">Försenad<//>`}<${ui.Badge} tone="outline" icon="layers">Version ${r.version || 1}<//><${ProvisionalBadge} r=${r} />
          ${r.qualityReviewedAt && html`<${ui.Badge} tone="bluetone" icon="shield">Kvalitetsgranskad<//>`}${pend && html`<${ui.Badge} tone="outline" icon="edit">Rättas – ny version kommer<//>`}</div>
        <${ui.Stepper} steps=${LIFECYCLE} current=${lifecycleIndex(r)} />
        <div class="split">
          <${ui.Kv} items=${[
            ['Nästa steg', step.label],
            dueRow,
            isProvisional(r) && ['Sista dag', provisionalText(r)],
            r.approvedAt && ['Godkänd', `${d.fmtDateTime(r.approvedAt)} av ${MM.personName(r.approvedBy)}`],
            r.qualityReviewedAt && ['Kvalitetsgranskad', `${d.fmtDateTime(r.qualityReviewedAt)} av ${MM.personName(r.qualityReviewedBy)}`],
          ]} />
          <${ui.Kv} items=${[
            ['Mottagare', personWithUnit(recipientOf(r))],
            ['Levererad', r.deliveredAt ? `${d.fmtDateTime(r.deliveredAt)} i portalen` : 'Inte levererad'],
            ['Kvitterad', r.openedAt ? `${d.fmtDateTime(r.openedAt)} – mottagaren har öppnat rapporten` : isDelivered(r) ? 'Inte öppnad än. Bara mottagaren kan kvittera.' : '–'],
            r.correctionReason && ['Rättelse', `${r.correctionReason} (${MM.personName(r.correctedBy)}, ${d.fmtDateTime(r.correctedAt)})`],
          ]} />
        </div>
        ${r.kind === 'monthly' && step.key === 'blocked' && html`<${ui.Notice} tone="warn" title="Rapporten kan inte godkännas ännu">
          <div class="stack-sm"><span>Månadsbedömningen för ${d.monthName(r.month)} ${ma ? 'är inte godkänd' : 'saknas'}. Rapporten byggs bara av godkända uppgifter.</span>
          ${sel.access(c) === 'full' || sel.access(c) === 'team' ? html`<div><${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => MM.nav('coach.manad', { caseId: r.caseId, month: r.month })}>Öppna bedömningen<//></div>` : null}</div>
        <//>`}
        ${r.kind === 'final' && r.status === 'approved' && !hasRecommendation(r) && html`<${ui.Notice} tone="warn" title="Rekommenderad fortsättning saknas">Rapporten kan inte levereras förrän coachen har skrivit rekommenderad fortsättning och godkänt texten. Texten skapas inte automatiskt.<//>`}
        ${pend && html`<${ui.Notice} tone="info" title=${`Rättelse pågår – version ${pend.version} är ett utkast`}>
          <div class="stack-sm"><span>Kommunen ser version ${r.version || 1} tills version ${pend.version} har godkänts och levererats.</span>
          <div><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('rapport.visa', { reportId: pend.id })}>Öppna version ${pend.version}<//></div></div>
        <//>`}
        ${r.superseded && html`<${ui.Notice} tone="info" title="Den här versionen är ersatt">En rättad version finns. Den här versionen sparas men ska inte användas.<//>`}
        ${(canApprove || canDeliver || canCorrect || canQuality) ? html`<div class="row">
          ${canApprove && html`<${ui.Btn} kind="primary" icon="check" onClick=${approve}>Godkänn<//>`}
          ${canQuality && html`<${ui.Btn} kind="secondary" icon="shield" onClick=${quality}>Markera som kvalitetsgranskad<//>`}
          ${canDeliver && html`<${ui.Btn} kind="primary" icon="send" onClick=${onDeliver}>Leverera till kommunen<//>`}
          ${canCorrect && html`<${ui.Btn} kind="secondary" icon="edit" onClick=${onCorrect}>Rätta<//>`}
          <${ui.Btn} kind="ghost" icon="download" disabled title="PDF skapas med react-pdf i den riktiga tjänsten">Ladda ner PDF<//>
        </div>` : idleText(r, role, step) && html`<p class="small muted">${idleText(r, role, step)}</p>`}
      </div>
    <//>`;
  };

  /** Varning när underlaget har ändrats efter leveransen. Den levererade versionen är låst – ändringen kräver rättelse. */
  const DriftNotice = ({ r, role }) => {
    const drift = useMemo(() => driftedSinceDelivery(r), [r.id, MM.store.version]);
    if (!drift) return null;
    const can = ['coach', 'samordnare', 'avtalsansvarig'].includes(role);
    return html`<${ui.Notice} tone="warn" title="Underlaget har ändrats efter leveransen">Uppgifter som rapporten bygger på har ändrats sedan rapporten levererades${r.deliveredAt ? ` ${d.fmtDateTime(r.deliveredAt)}` : ''}. Kommunen ser fortfarande den levererade versionen – den ändras aldrig i efterhand.${can ? ' Rätta rapporten om ändringen ska redovisas för kommunen. Då skapas en ny version.' : ''}<//>`;
  };

  const FinalTextCard = ({ r, role, acc }) => {
    const c = caseOf(r);
    const lastCi = c ? liveSrc().checkIns(c.id, r.periodStart || c.startDate, r.periodEnd || d.today()).pop() : null;
    const [obs, setObs] = useState((r.finalText && r.finalText.obstacles) || (lastCi && (lastCi.obstacles || []).length ? `${ucfirst(joinSv(lastCi.obstacles.map(lcfirst)))}.` : '') || '');
    const [rec, setRec] = useState((r.finalText && r.finalText.recommendation) || '');
    const [err, setErr] = useState(null);
    const canEdit = (role === 'coach' && acc.access === 'full') || role === 'samordnare';
    if (!['draft', 'reviewed', 'approved'].includes(r.status) || r.superseded) return null;
    if (r.status === 'approved' && hasRecommendation(r)) return null;
    const save = () => {
      const res = MM.dispatch('rap.saveFinal', { reportId: r.id, obstacles: obs, recommendation: rec });
      if (res && res.error) { setErr('Skriv en rekommenderad fortsättning. Den behövs innan rapporten kan godkännas.'); return; }
      setErr(null); MM.toast('Texten är sparad i slutrapporten. Nästa steg: godkänn rapporten.', 'blue');
    };
    return html`<${ui.Card} title="Coachens text till slutrapporten" icon="edit">
      ${canEdit ? html`<div class="stack">
        <${ui.Field} label="Kvarstående hinder" id="rap-final-obs" help="Beskriv funktionellt, till exempel språk, digital vana eller resor. Inga diagnoser.">
          <${ui.TextArea} id="rap-final-obs" rows=${2} value=${obs} onInput=${setObs} maxLength=${400} />
        <//>
        <${ui.Field} label="Rekommenderad fortsättning" id="rap-final-rec" required error=${err} help="Vad rekommenderar du efter insatsen? Skriv kort och sakligt. Kommunen läser texten.">
          <${ui.TextArea} id="rap-final-rec" rows=${3} value=${rec} onInput=${(v) => { setRec(v); if (err) setErr(null); }} invalid=${!!err} maxLength=${600} />
        <//>
        <div class="row"><${ui.Btn} kind="primary" icon="check" onClick=${save}>Spara texten<//><span class="small muted">Rapporten blir granskad när texten är sparad. Därefter godkänner coachen rapporten. Texten sparas i den levererade rapporten och ändras inte i efterhand.</span></div>
      </div>` : html`<p>Huvudcoachen skriver kvarstående hinder och rekommenderad fortsättning innan slutrapporten godkänns.</p>`}
    <//>`;
  };

  const SummaryApprovalCard = ({ r, role }) => {
    const m = modelFor(r);
    const suggestion = m ? summaryFromNumbers(m) : '';
    const [text, setText] = useState(r.summary || '');
    const [aiUsed, setAiUsed] = useState(false);
    const [err, setErr] = useState(null);
    if (!['draft', 'reviewed'].includes(r.status) || r.superseded) return null;
    const k = MM.cfg().kpis.find((x) => x.key === 'resultatgrad');
    const internalPct = Math.round((k.internalTarget || 0) * 100);
    const mentionsInternal = (t) => /internt? mål/i.test(t) || (internalPct > 0 && new RegExp(`(^|\\D)${internalPct}\\s?(%|procent)`, 'i').test(t));
    const approve = () => {
      const t = text.trim();
      if (!t) { setErr('Skriv en sammanfattning eller använd förslaget. Den behövs innan rapporten kan godkännas.'); return; }
      if (mentionsInternal(t)) { setErr('Texten nämner Miljonbemannings interna mål. Det får aldrig stå i beställarrapporten. Ta bort det.'); return; }
      MM.dispatch('rap.saveSummary', { reportId: r.id, summary: t, aiUsed });
      MM.dispatch('report.approve', { reportId: r.id });
      setErr(null); MM.toast('Beställarrapporten är godkänd. Nästa steg: leverera till kommunens chef.', 'blue');
    };
    const canApprove = role === 'avtalsansvarig';
    return html`<${ui.Card} title="Sammanfattning – avtalsansvarig godkänner" icon="check-square" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
      <div class="stack">
        <div class="ai-box">
          <div class="row-sm"><${ui.AiTag} /><span class="small muted">Utkast från rapportens siffror (avsnitt 1–6). Kontrollera innan du använder det.</span></div>
          <p class="ai-text">${suggestion}</p>
          ${canApprove && html`<div><${ui.Btn} kind="secondary" icon="copy" onClick=${() => { setText(suggestion); setAiUsed(true); setErr(null); }}>Använd förslaget<//></div>`}
        </div>
        ${canApprove ? html`<${ui.Field} label="Sammanfattning till kommunen" id="rap-summary" required error=${err} help="Kort och sakligt. Inga namn. Skriv aldrig det interna målet – kommunen ser bara avtalsmålet.">
            <${ui.TextArea} id="rap-summary" rows=${4} value=${text} onInput=${(v) => { setText(v); if (err) setErr(null); }} invalid=${!!err} maxLength=${900} />
          <//>
          <div class="row"><${ui.Btn} kind="primary" icon="check" onClick=${approve}>Godkänn beställarrapporten<//><span class="small muted">Sammanfattningen är tom tills du väljer. AI föreslår – du bedömer. Texten sparas i rapporten och ändras inte efter leveransen.</span></div>`
          : html`<p>Avtalsansvarig (${MM.personName(MM.contract().contractManagerId)}) skriver och godkänner sammanfattningen.</p>`}
      </div>
    <//>`;
  };

  const WaitingCard = ({ r, role }) => {
    if (r.kind !== 'weekly_attendance' || r.status !== 'waiting') return null;
    const wr = sel.weeklyReport(r.recipientUserId, r.week);
    const missing = [];
    for (const s of wr.sections) for (const row of s.rows) if (!row.att && row.activity.startsAt < d.now()) missing.push({ c: s.case, a: row.activity });
    const byCoach = Object.entries(MM.groupBy(missing, (x) => x.c.leadCoachId));
    const pubTime = (MM.cfg().sla.find((x) => x.key === 'veckorapport_publicering') || {}).time || '16:00';
    const regTime = (MM.cfg().sla.find((x) => x.key === 'veckorapport_registrering') || {}).time || '10:00';
    return html`<${ui.Card} title="Väntar på närvaroregistrering" icon="clock" tone="red">
      <div class="stack">
        <p>Rapporten publiceras automatiskt när alla deltagare är registrerade. Närvaron ska vara registrerad senast måndag kl. ${regTime.replace(':', '.')}. Rapporten ska vara publicerad senast måndag kl. ${pubTime.replace(':', '.')}.</p>
        ${missing.length === 0 ? html`<p>Alla tillfällen är registrerade.</p>` : html`<div class="stack-sm">${byCoach.map(([coachId, xs]) => html`<div key=${coachId} class="stack-sm" style="gap:2px">
          <div class="strong">${MM.personName(coachId)}: ${xs.length} ${xs.length === 1 ? 'tillfälle' : 'tillfällen'} saknas</div>
          <ul style="margin:0;padding-left:20px" class="small">${xs.map((x) => html`<li key=${x.a.id}>${x.c.number}${sel.access(x.c, role) !== 'restricted' ? ` · ${sel.displayName(x.c, role)}` : ''} – ${ucfirst(d.fmtWeekday(x.a.startsAt))} kl. ${d.fmtTime(x.a.startsAt)}</li>`)}</ul>
        </div>`)}</div>`}
        ${role === 'coach' && html`<div><${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => MM.nav('coach.narvaro', { week: 'last' })}>Registrera närvaro<//></div>`}
      </div>
    <//>`;
  };

  const DeliveryCard = ({ r }) => {
    const cfg = MM.cfg().reportDelivery; const to = recipientOf(r); const u = MM.personById(to);
    return html`<${ui.Card} title="Så levereras rapporten" icon="send">
      <div class="stack">
        <${ui.Kv} items=${[['Kanal', cfg.channel === 'portal' ? 'Kommunens portal (inloggning med e-postkod)' : cfg.channel], ['Mottagare', u ? `${u.name}${u.unit ? `, ${u.unit}` : ''}` : '–'],
          ['Kvittens', 'Bara mottagaren kvitterar. Andra i kommunen kan läsa rapporten utan att den blir kvitterad.'],
          ['Bilaga i e-post', cfg.emailAttachmentAllowed ? 'Tillåten – kommunen har gett skriftlig instruktion' : 'Avstängd. Kommunen har inte skriftligt begärt rapporter som bilaga.']]} />
        <div class="demo-note" style="border-style:solid"><${I} name="mail" /><div><b>Mejlet till ${u ? u.name : 'mottagaren'} innehåller bara:</b> "${noticeText(r)}" Inga namn eller personnummer.</div></div>
        <div><${ui.PerspectiveSwitch} role=${customerRoleFor(r)} view="rapport.visa" params=${{ reportId: r.id }} label="Öppna kommunens vy" /></div>
      </div>
    <//>`;
  };

  const VersionsCard = ({ r }) => {
    const vs = versionsOf(r);
    return html`<${ui.Card} title="Versioner" icon="layers" flush>
      <div class="list">${vs.map((v) => html`<div class="list-item" key=${v.id}>
        <div class="li-main"><span class="li-title">Version ${v.version || 1}${v.id === r.id ? ' (visas nu)' : ''}</span>
          <span class="li-sub">${v.deliveredAt ? `Levererad ${d.fmtDateTime(v.deliveredAt)}` : v.approvedAt ? `Godkänd ${d.fmtDateTime(v.approvedAt)}` : 'Inte godkänd'}${v.superseded ? ' · ersatt' : isDelivered(v) && pendingCorrection(v) ? ' · kommunen ser den här versionen tills rättelsen är levererad' : ''}</span></div>
        <div class="li-side"><${StatusBadge} r=${v} />${v.id !== r.id && html`<${ui.Btn} kind="ghost" onClick=${() => MM.nav('rapport.visa', { reportId: v.id })}>Öppna<//>`}</div>
      </div>`)}</div>
      <div class="card-body small muted" style="border-top:1px solid var(--line)">Rättelse skapar en ny version. Den gamla sparas och syns här. Kommunen ser den senast levererade versionen.</div>
    <//>`;
  };

  const CorrectModal = ({ r, onClose }) => {
    const [reason, setReason] = useState(''); const [err, setErr] = useState(null);
    const go = () => {
      if (!reason.trim()) { setErr('Skriv varför rapporten rättas. Orsaken sparas i revisionsloggen.'); return; }
      const res = MM.dispatch('report.correct', { reportId: r.id });
      if (!res || !res.reportId) { MM.toast('Rättelsen kunde inte skapas.', 'red'); return; }
      MM.dispatch('rap.correctionNote', { reportId: res.reportId, reason });
      onClose();
      MM.toast(`Version ${(r.version || 1) + 1} är skapad som utkast. Version ${r.version || 1} sparas.`, 'blue');
      MM.nav('rapport.visa', { reportId: res.reportId });
    };
    return html`<${ui.Modal} title="Rätta rapporten" onClose=${onClose} footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="edit" onClick=${go}>Skapa ny version<//>`}>
      <p>En rättelse skapar version ${(r.version || 1) + 1} som utkast. Version ${r.version || 1} sparas och syns i versionshistoriken.${isDelivered(r) ? ` Kommunen ser version ${r.version || 1} tills den nya versionen har godkänts och levererats.` : ''}</p>
      <${ui.Field} label="Varför rättas rapporten?" id="rap-correct-reason" required error=${err} help="Till exempel: fel datum för praktikstart. Skriv inga personuppgifter.">
        <${ui.TextArea} id="rap-correct-reason" rows=${3} value=${reason} onInput=${(v) => { setReason(v); if (err) setErr(null); }} invalid=${!!err} maxLength=${300} />
      <//>
    <//>`;
  };

  const MbReport = ({ r, role, acc }) => {
    const [correcting, setCorrecting] = useState(false);
    const c = caseOf(r);
    const crumbs = LIST_ROLES.includes(role) ? [{ label: 'Rapporter', view: 'rapporter.lista', params: {} }, { label: reportTitle(r) }] : c ? [{ label: c.number, view: 'arende.kort', params: { caseId: c.id } }, { label: reportTitle(r) }] : null;
    const eyebrow = c ? `${c.number}${acc.ok ? ` · ${sel.displayName(c, role)}` : ''}` : `Till ${MM.personName(r.recipientUserId)}`;
    const persp = html`<${ui.PerspectiveSwitch} role=${customerRoleFor(r)} view="rapport.visa" params=${{ reportId: r.id }} label="Se som kommunen" />`;
    if (!acc.ok) {
      const [t, b] = DENIED[acc.reason] || DENIED.role;
      const toCase = c && ['handledare', 'handledare_order'].includes(acc.reason);
      return html`<${ui.Page} title=${reportTitle(r)} eyebrow=${c ? c.number : ''} crumbs=${crumbs}>
        <${ui.Card}><${ui.Empty} icon=${acc.reason === 'protected' ? 'lock' : 'eye-off'} title=${t} action=${toCase && html`<${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => MM.nav('arende.kort', { caseId: c.id, tab: 'narvaro' })}>Till närvaron i ärendet<//>`}>${b}<//><//>
      <//>`;
    }
    const deliver = async () => {
      const to = recipientOf(r); const u = MM.personById(to);
      const ok = await MM.confirm({ title: 'Leverera till kommunen', confirmLabel: 'Leverera i portalen', body: html`<div class="stack-sm">
        <p><b>${reportTitle(r)}</b> publiceras i kommunens portal för ${u ? u.name : 'mottagaren'}.</p>
        <p>${u ? u.name : 'Mottagaren'} får ett mejl som bara innehåller en notis:</p>
        <div class="demo-note" style="border-style:solid"><${I} name="mail" /><div>"${noticeText(r)}"</div></div>
        <p class="small">${MM.cfg().reportDelivery.emailAttachmentAllowed ? 'Rapporten skickas även som bilaga enligt kommunens skriftliga instruktion.' : 'Rapporten skickas inte som bilaga i e-post. Det är avstängt i avtalskonfigurationen.'}</p>
        <p class="small">Innehållet låses vid leveransen. Senare ändringar kräver en rättelse (ny version).</p>
      </div>` });
      if (!ok) return;
      const res = MM.dispatch('report.deliver', { reportId: r.id });
      if (res && res.error) { MM.toast('Rapporten måste vara godkänd innan den levereras.', 'red'); return; }
      // Frys innehållet direkt efter leveransen (om det inte redan gjorts automatiskt).
      if (!hasSnapshot(S().reports.find((x) => x.id === r.id))) MM.dispatch('rap.snapshot', { reportId: r.id }, { silent: true });
      MM.toast(`Levererad i portalen till ${u ? u.name : 'kommunen'}. Mejlet innehåller bara en notis utan personuppgifter.`, 'blue');
    };
    return html`<${ui.Page} title=${reportTitle(r)} eyebrow=${eyebrow} crumbs=${crumbs} actions=${persp}
      lead=${r.kind === 'customer_summary' ? 'Månadsrapport till kommunens chef. Den visar bara avtalets mål – aldrig Miljonbemannings interna mål.' : r.kind === 'weekly_attendance' ? 'En rapport per handläggare och vecka, med en sektion per deltagare. Skapas automatiskt från närvaroregistreringen.' : 'Förhandsvisning av rapporten som kommunen får. Den byggs bara av godkända uppgifter.'}>
      <${StatusCard} r=${r} role=${role} acc=${acc} onDeliver=${deliver} onCorrect=${() => setCorrecting(true)} />
      <${DriftNotice} r=${r} role=${role} />
      <${WaitingCard} r=${r} role=${role} />
      ${r.kind === 'final' && html`<${FinalTextCard} r=${r} role=${role} acc=${acc} />`}
      ${r.kind === 'customer_summary' && html`<${SummaryApprovalCard} r=${r} role=${role} />`}
      ${r.kind === 'customer_summary' && !MM.cfg().customerVisibility.seesSlaStats && html`<${ui.Notice} tone="info" title="SLA-statistik visas inte för kommunen">Ledningen har inte beslutat att kommunen ska se svarstider och SLA-uppfyllnad. Det styrs i avtalskonfigurationen. Den interna ledningsvyn finns under Ledningsvy.<//>`}
      <section aria-label="Förhandsvisning av rapporten" class="stack-sm">
        <div class="row-between"><h2 class="section-title"><span class="dot" aria-hidden="true"></span>Förhandsvisning</h2><span class="small muted">${isDelivered(r) ? `Levererad version – låst sedan ${d.fmtDateTime(r.deliveredAt)}` : 'Så ser dokumentet ut för mottagaren'}</span></div>
        <${ReportDocument} report=${r} role=${role} />
      </section>
      <div class="grid-2">
        <${DeliveryCard} r=${r} />
        <${VersionsCard} r=${r} />
      </div>
      <${ui.DemoNote}>PDF-nedladdning finns inte i prototypen. I den riktiga tjänsten skapas PDF:en med react-pdf (@react-pdf/renderer) i Miljonbemannings grafiska profil och sparas i portalen när rapporten levereras. Varje visning av rapporten loggas i revisionsloggen.<//>
      ${correcting && html`<${CorrectModal} r=${r} onClose=${() => setCorrecting(false)} />`}
    <//>`;
  };

  // ------------------------------------------------------------ Rapportvisning – kundens sida (portalen)
  const BACK_LABELS = { 'kom.rapporter': 'Tillbaka till rapporterna', 'kom.deltagare': 'Tillbaka till deltagaren', 'kom.chef': 'Tillbaka till beställarrapporten', 'kom.start': 'Tillbaka till start' };
  const PortalReport = ({ r, role, acc, requested }) => {
    const c = caseOf(r);
    const pid = MM.currentPersonaId();
    const prev = MM.history[MM.history.length - 1];
    const canBack = !!prev && prev.role === role && prev.view !== 'rapport.visa';
    const back = () => (canBack ? MM.back() : MM.nav('kom.rapporter', {}));
    const backBtn = html`<div><${ui.Btn} kind="ghost" icon="arrow-left" onClick=${back}>${canBack ? (BACK_LABELS[prev.view] || 'Tillbaka') : 'Till rapporterna'}<//></div>`;
    const persp = html`<${ui.PerspectiveSwitch} role=${supplierRoleFor(r)} view="rapport.visa" params=${{ reportId: (requested || r).id }} label="Se från leverantörens håll" />`;
    if (!acc.ok) {
      const [t, b] = DENIED[acc.reason] || DENIED.not_yours;
      return html`<div class="stack-lg">${backBtn}<${ui.Empty} icon="file" title=${t}>${b}<//><div class="row">${persp}</div></div>`;
    }
    const recipientId = (r.deliveredTo || [])[0] || recipientOf(r);
    const isRecipient = (r.deliveredTo || []).includes(pid);
    const rName = MM.personName(recipientId);
    const pend = pendingCorrection(r);
    const newer = r.superseded ? versionsOf(r).filter((v) => v.version > r.version && isDelivered(v)).pop() : null;
    return html`<div class="stack-lg">
      ${backBtn}
      <div class="stack-sm">
        <h1><span class="dot" aria-hidden="true"></span>${reportTitle(r)}</h1>
        <p>${c && (sel.access(c, role) === 'restricted'
          ? html`Gäller ärende <span class="nowrap">${c.number}</span>. Deltagaren har skyddade personuppgifter, så namnet visas inte. `
          : html`Gäller ${sel.displayName(c, role)}, ärende <span class="nowrap">${c.number}</span>. `)}Levererad av Miljonbemanning ${wdFull(r.deliveredAt)}.${(r.version || 1) > 1 ? ` Det här är version ${r.version}, som ersätter en tidigare version.` : ''}</p>
      </div>
      ${isRecipient && r.openedAt && html`<${ui.Notice} tone="ok" title="Rapporten är kvitterad">Du öppnade rapporten första gången ${dtFull(r.openedAt)}. Miljonbemanning ser att du har läst den.<//>`}
      ${!isRecipient && html`<${ui.Notice} tone="info" title="Kvitteras bara av mottagaren">Rapporten skickades till ${rName}. Den blir kvitterad först när ${rName} öppnar den – inte när du läser den. ${r.openedAt ? `${rName} öppnade rapporten ${dtFull(r.openedAt)}.` : `${rName} har inte öppnat rapporten än.`}<//>`}
      ${pend && html`<${ui.Notice} tone="info" title="Rapporten rättas">Miljonbemanning håller på att rätta rapporten. Du ser den senast levererade versionen (version ${r.version || 1}) tills den rättade versionen är levererad. Du får ett mejl när den finns här.<//>`}
      ${r.superseded && html`<${ui.Notice} tone="warn" title="Rapporten har rättats">Miljonbemanning har rättat rapporten. ${newer ? 'Den rättade versionen finns nedan.' : 'Den rättade versionen visas här när den är levererad.'}
        ${newer && html`<div style="margin-top:8px"><${ui.Btn} kind="primary" onClick=${() => MM.nav('rapport.visa', { reportId: newer.id })}>Visa den rättade versionen<//></div>`}<//>`}
      <${ReportDocument} report=${r} role=${role} />
      <${ui.Card} title="Har du frågor om rapporten?" icon="message">
        <div class="stack">
          <p>Skicka ett meddelande till coachen i portalen. Skriv inte personnummer i e-post.</p>
          ${c && MM.views['kom.deltagare'] && sel.access(c, role) === 'customer' && html`<div><${ui.Btn} kind="primary" icon="message" onClick=${() => MM.nav('kom.deltagare', { caseId: c.id, tab: 'meddelanden' })}>Skriv till coachen<//></div>`}
        </div>
      <//>
      <${ui.DemoNote}>Här finns en knapp för att ladda ner rapporten som PDF i den riktiga tjänsten. PDF:en skapas med react-pdf. I prototypen visas bara förhandsvisningen.<//>
      <div class="row">${persp}</div>
    </div>`;
  };

  const ReportView = ({ params, role }) => {
    const st = MM.useStore();
    const reportId = params && params.reportId;
    const req = reportId ? st.reports.find((x) => x.id === reportId) : null;
    const kund = MM.perspectiveOf(role) === 'kund';
    // Kunden ser den senast levererade versionen medan en rättelse är ett utkast.
    const r = kund && req && !isDelivered(req) ? (latestDelivered(req) || req) : req;
    const acc = r ? reportAccess(r, role) : { ok: false, reason: 'missing' };
    const pid = MM.currentPersonaId();
    ui.useAuditView('report', acc.ok ? r.id : null, 'report.view');
    // Kvittens: bara mottagaren kvitterar. Andra kommunanvändare loggas som visning (useAuditView) utan kvittens.
    useEffect(() => { if (r && kund && acc.ok && !r.openedAt && (r.deliveredTo || []).includes(pid)) MM.dispatch('report.open', { reportId: r.id }, { silent: true }); }, [r && r.id, role]);
    if (!r) {
      const toList = kund ? (MM.views['kom.rapporter'] ? () => MM.nav('kom.rapporter', {}) : null) : LIST_ROLES.includes(role) ? () => MM.nav('rapporter.lista', {}) : null;
      const body = html`<${ui.Empty} icon="file" title=${reportId ? 'Rapporten finns inte' : 'Ingen rapport vald'} action=${toList && html`<${ui.Btn} kind="primary" onClick=${toList}>Visa rapporter<//>`}>Välj en rapport i listan.<//>`;
      return kund ? html`<div class="stack-lg">${body}</div>` : html`<${ui.Page} title="Rapport">${body}<//>`;
    }
    return kund ? html`<${PortalReport} r=${r} role=${role} acc=${acc} requested=${req} />` : html`<${MbReport} r=${r} role=${role} acc=${acc} />`;
  };

  // ------------------------------------------------------------ Registrering och export
  MM.registerView('rapporter.lista', { title: 'Rapporter', roles: LIST_ROLES, component: ListView });
  MM.registerView('rapport.visa', {
    title: (params) => { const r = params && params.reportId && MM.store.state ? MM.store.state.reports.find((x) => x.id === params.reportId) : null; return r ? reportTitle(r) : 'Rapport'; },
    roles: VIEW_ROLES, component: ReportView,
  });
  MM.reports = { ReportDocument, StatusBadge, reportTitle, periodText, effStatus, statusLabel, nextStep, isDelivered, isOverdue, reportAccess, modelFor, latestDelivered, pendingCorrection, driftedSinceDelivery };
})();
