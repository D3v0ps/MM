// views/rapporter.js – rapportlista (MB) och rapportvisning som PDF-förhandsvisning för båda perspektiven.
// Vyer: rapporter.lista {filter?} · rapport.visa {reportId}. Exporterar MM.reports = { ReportDocument, ... }.
// Regler: rapporter byggs bara av godkända uppgifter, leverans sker i portalen (mejlet är bara en notis),
// rättelse skapar ny version, kommunen ser bara levererade rapporter och aldrig det interna målet.
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

  const reportTitle = (r) => ({
    monthly: `Månadsrapport ${d.monthName(r.month || d.monthKey(r.periodStart))}`,
    final: 'Slutrapport',
    weekly_attendance: `Veckorapport närvaro ${r.week ? d.fmtWeekKey(r.week) : ''}`.trim(),
    order_confirmation: 'Orderbekräftelse',
    customer_summary: `Beställarrapport ${d.monthName(r.month || d.monthKey(r.periodStart))}`,
  }[r.kind] || sel.reportKindLabel(r.kind));
  const periodText = (r) => {
    if (r.kind === 'weekly_attendance' && r.week) return `${d.fmtWeekKey(r.week)} (${d.fmtWeekRange(r.week)})`;
    if (r.month) return d.monthName(r.month);
    if (r.kind === 'order_confirmation') return d.fmtDate(r.periodStart);
    return `${d.fmtDate(r.periodStart)} – ${d.fmtDate(r.periodEnd)}`;
  };
  /** Förklaring till en förfallotid som inte är fastställd med kommunen (läses från avtalskonfigurationen). */
  const provisionalText = (r) => {
    const key = { monthly: 'manadsrapport', final: 'slutrapport' }[r.kind];
    const rule = key && (MM.cfg().sla || []).find((s) => s.key === key);
    const raw = rule ? String(rule.due || rule.within || '') : '';
    const m = raw.match(/\(([^)]*)\)/);
    const base = 'Deadline är inte fastställd med Botkyrka kommun.';
    return m ? `${base} Tills vidare gäller ${m[1]}.` : `${base} Förfallotiden är ett förslag.`;
  };
  const approvedCheckIns = (caseId, from, to) => sel.checkInsOf(caseId).filter((x) => x.status === 'approved' && x.heldAt.slice(0, 10) >= from && x.heldAt.slice(0, 10) <= to).sort(MM.by('heldAt'));
  const approvedAssessments = (caseId, fromMonth, toMonth) => sel.assessmentsOf(caseId).filter((m) => m.status === 'approved' && m.month >= fromMonth && m.month <= toMonth).sort(MM.by('month'));

  /** Vad är nästa steg för rapporten? { key, label } */
  const nextStep = (r) => {
    if (r.superseded) return { key: 'superseded', label: 'Ersatt av en rättad version' };
    const s = effStatus(r);
    if (s === 'opened') return { key: 'done', label: 'Mottagaren har öppnat rapporten' };
    if (s === 'delivered') return { key: 'unopened', label: 'Levererad – inte öppnad än' };
    if (s === 'approved') return { key: 'deliver', label: 'Väntar på leverans till kommunen' };
    if (s === 'waiting') return { key: 'registration', label: 'Väntar på närvaroregistrering' };
    if (r.kind === 'monthly') {
      const ma = sel.assessment(r.caseId, r.month);
      if (!ma || ma.status !== 'approved') return { key: 'blocked', label: 'Månadsbedömningen ska godkännas först' };
      return { key: 'approval', label: 'Väntar på coachens godkännande' };
    }
    if (r.kind === 'final') {
      if (!(r.finalText && String(r.finalText.recommendation || '').trim())) return { key: 'blocked', label: 'Coachen skriver rekommenderad fortsättning' };
      return { key: 'approval', label: 'Väntar på coachens godkännande' };
    }
    if (r.kind === 'customer_summary') return { key: 'approval', label: 'Väntar på avtalsansvarigs godkännande' };
    return { key: 'approval', label: 'Väntar på godkännande' };
  };

  /** Får rollen se rapporten? { ok, reason?, partial?, access? } */
  const reportAccess = (r, role = MM.role(), pid = MM.currentPersonaId()) => {
    const c = caseOf(r);
    if (MM.perspectiveOf(role) === 'kund') {
      const mine = role === 'kommun_chef' || recipientOf(r) === pid || (c && c.referrerId === pid) || (r.deliveredTo || []).includes(pid);
      if (!mine) return { ok: false, reason: 'not_yours' };
      if (!isDelivered(r)) return { ok: false, reason: 'not_delivered' };
      return { ok: true, access: 'customer' };
    }
    if (!VIEW_ROLES.includes(role)) return { ok: false, reason: 'role' };
    if (r.kind === 'customer_summary') return ['samordnare', 'avtalsansvarig', 'chef'].includes(role) ? { ok: true, access: 'full' } : { ok: false, reason: 'role' };
    if (r.kind === 'weekly_attendance') return ['samordnare', 'avtalsansvarig', 'chef'].includes(role) ? { ok: true, access: 'full' } : { ok: true, partial: true, access: 'team' };
    if (!c) return { ok: false, reason: 'missing' };
    const a = sel.access(c, role, pid);
    if (a === 'none') return { ok: false, reason: 'not_assigned' };
    if (a === 'restricted') return { ok: false, reason: 'protected' };
    return { ok: true, access: a };
  };

  const StatusBadge = ({ r }) => { const s = effStatus(r); const [tone, icon] = STATUS_UI[s] || ['grey', 'circle']; return html`<${ui.Badge} tone=${tone} icon=${icon}>${statusLabel(r)}<//>`; };
  const ProvisionalBadge = ({ r }) => isProvisional(r) && html`<${ui.Badge} tone="outline" icon="help" title=${provisionalText(r)}>Ej fastställd deadline<//>`;
  const lifecycleIndex = (r) => ({ draft: 0, waiting: 0, reviewed: 1, approved: 2, delivered: 3, opened: 5 }[effStatus(r)] ?? 0);

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
  const reasonsText = (reasons) => { const xs = Object.entries(reasons || {}).map(([k, v]) => `${lcfirst(k)} ${v}`); return xs.length ? xs.join(', ') : 'inga'; };
  /** Två eller fler ogiltiga frånvarotillfällen inom avtalets fönster (standard 14 dagar) under perioden. */
  const repeatedInPeriod = (caseId, from, to) => {
    const rule = MM.cfg().attendance.repeatedAbsenceRule;
    const dates = sel.activitiesOf(caseId).filter((a) => a.startsAt.slice(0, 10) >= from && a.startsAt.slice(0, 10) <= to && a.startsAt < d.now())
      .filter((a) => { const at = sel.attendanceFor(a.id); return at && at.status === 'absent_invalid'; }).map((a) => a.startsAt.slice(0, 10));
    const n = rule.absentInvalid;
    const hit = dates.some((x, i) => i + n - 1 < dates.length && d.diffDays(x, dates[i + n - 1]) <= rule.withinDays);
    return { hit, count: dates.length, rule };
  };

  const ActivityChecklist = ({ cis }) => {
    const done = new Set(cis.flatMap((x) => (Array.isArray(x.activitiesDone) ? x.activitiesDone : [])));
    const types = (MM.seedConstants && MM.seedConstants.ACTIVITY_TYPES) || [...done];
    return html`<ul style="list-style:none;margin:0;padding:0;display:grid;gap:6px 18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))">
      ${types.map((t) => html`<li key=${t} style="display:flex;align-items:flex-start;gap:2px"><span class="xbox" aria-hidden="true">${done.has(t) ? 'X' : ''}</span><span><span class="sr-only">${done.has(t) ? 'Genomförd: ' : 'Inte genomförd: '}</span>${t}</span></li>`)}
    </ul>`;
  };

  const EventsTable = ({ evs }) => evs.length === 0 ? html`<p>Inga händelser registrerade under perioden.</p>` : html`<${TWrap} min=${520}>
    <thead><tr><th>Datum</th><th>Händelse</th><th>Arbetsgivare eller anordnare</th><th>Underlag</th></tr></thead>
    <tbody>${evs.map((e) => html`<tr key=${e.id}><td class="nowrap">${d.fmtDate(e.occurredOn)}</td><td>${sel.eventLabel(e.kind)}</td><td>${e.actor || '–'}</td><td>${e.verificationKind ? ucfirst(e.verificationKind) : (e.note || 'Inte verifierat')}</td></tr>`)}</tbody>
  <//>`;

  const DeviationsBlock = ({ devs, repeated }) => {
    const needs = devs.some((x) => x.needsCustomerDecision);
    return html`<div class="stack-sm">
      ${devs.length === 0 ? html`<p>Inga avvikelser under perioden.</p>` : devs.map((x) => html`<div key=${x.id} style="border-left:3px solid var(--antracit);padding:2px 0 2px 10px" class="stack-sm">
        <div><b>${x.description}</b> <span class="small muted">(${d.fmtDate(x.createdAt)} · ${x.status === 'open' ? 'Pågår' : 'Avslutad'})</span></div>
        ${x.assessment && html`<div><b>Risk och bedömning:</b> ${x.assessment}</div>`}
        <div><b>Åtgärd:</b> ${x.action || 'Framgår inte'}</div>
        <div class="small">Ansvarig: ${MM.personName(x.ownerId)}${x.followUpOn ? ` · Uppföljning ${d.fmtDate(x.followUpOn)}` : ''}${x.followUpMeetingAt ? ` · Möte med kommunen ${d.fmtDateTime(x.followUpMeetingAt)}` : ''}</div>
      </div>`)}
      ${repeated && repeated.hit && html`<p><b>Risk:</b> Upprepad ogiltig frånvaro (${repeated.count} tillfällen, regel: minst ${repeated.rule.absentInvalid} inom ${repeated.rule.withinDays} dagar).</p>`}
      <p><b>Behöver beslut eller stöd från kommunen?</b> ${needs ? 'Ja – handläggaren har fått en notis och en uppgift i portalen.' : 'Nej.'}</p>
    </div>`;
  };

  const ProgressionTable = ({ ma }) => {
    const cfg = MM.cfg().progression;
    const keys = [...cfg.areas, ...(cfg.optionalAreas || []).filter((k) => ma.areas[k] && ma.areas[k].level != null)];
    return html`<div class="stack-sm">
      <p class="small muted">Skala: ${Object.entries(cfg.scale).map(([k, v]) => `${k} = ${lcfirst(v)}`).join(' · ')}.</p>
      <${TWrap} min=${600}>
        <thead><tr><th style="width:26%">Område</th><th style="width:16%">Nivå</th><th>Observation</th><th style="width:24%">Nästa steg</th></tr></thead>
        <tbody>${keys.map((k) => { const a = ma.areas[k] || {}; return html`<tr key=${k}><td>${cfg.areaLabels[k] || k}</td><td>${a.level != null ? `${a.level} – ${lcfirst(cfg.scale[a.level])}` : 'Ej bedömd'}</td><td>${a.observation || '–'}</td><td>${a.nextStep || '–'}</td></tr>`; })}</tbody>
      <//>
    </div>`;
  };

  const baseInfo = (r, c, extra = []) => {
    const k = MM.contract();
    return [['Beställare', k.customerName], ['Avtal', `${k.contractNumber} (dnr ${k.dnr})`], ...(c ? [['Ärende', c.number]] : []), ...extra, ['Version', String(r.version || 1)],
      ['Upprättad', r.approvedAt ? d.fmtDate(r.approvedAt) : 'Utkast – ej godkänd']];
  };
  const isDraftDoc = (r) => ['draft', 'reviewed', 'waiting'].includes(r.status);
  const Superseded = ({ r }) => r.superseded && html`<div class="watermark-draft">Ersatt av en rättad version</div>`;

  // ------------------------------------------------------------ Månadsrapport individ (mall 02, avsnitt 1–8)
  const MonthlyDoc = ({ r, role }) => {
    const c = caseOf(r); if (!c) return html`<${ui.Empty} icon="file" title="Ärendet finns inte" />`;
    const cfg = MM.cfg(); const mk = r.month; const from = `${mk}-01`; const to = d.monthEnd(mk);
    const ma = sel.assessment(c.id, mk); const ok = !!ma && ma.status === 'approved';
    const cis = approvedCheckIns(c.id, from, to);
    const weeks = [];
    for (let mon = d.monday(from); mon <= to; mon = d.addDays(mon, 7)) {
      const wFrom = maxS(mon, from); const wTo = minS(d.addDays(mon, 6), to);
      if (c.startDate && wTo < c.startDate) continue; if (c.endDate && wFrom > c.endDate) continue;
      const wk = d.isoWeek(mon);
      weeks.push({ key: wk.key, label: `v. ${wk.week}`, sub: wFrom === wTo ? d.fmtDateShort(wFrom) : `${d.fmtDateShort(wFrom)}–${d.fmtDateShort(wTo)}`, st: sel.attendanceStats(c.id, wFrom, wTo), paused: (c.pausedWeeks || []).includes(wk.key) });
    }
    const total = sel.attendanceStats(c.id, from, to);
    const rep = repeatedInPeriod(c.id, from, to);
    const evs = sel.eventsOf(c.id).filter((e) => e.occurredOn >= from && e.occurredOn <= to).sort(MM.by('occurredOn'));
    const devs = sel.deviationsOf(c.id).filter((x) => x.createdAt.slice(0, 10) <= to && (x.createdAt.slice(0, 10) >= from || x.status === 'open'));
    const plan = sel.planOf(c.id, mk); const next = d.addMonths(mk, 1);
    const lastCi = cis[cis.length - 1]; const phase = lastCi && lastCi.phase ? Number(lastCi.phase) : c.phase;
    const draft = !ok || isDraftDoc(r);
    return html`<${ui.Paper} title="Månadsrapport individ" draft=${draft ? 'Utkast' : null} info=${baseInfo(r, c, [['Period', d.monthName(mk)]])}>
      <${Superseded} r=${r} />
      ${!ok && html`<p class="small"><b>Utkast.</b> Månadsbedömningen för ${d.monthName(mk)} är inte godkänd. Avsnitt 4, 7 och 8 visas först när coachen har godkänt den.</p>`}
      <${Sec} n="1" title="Grunduppgifter">
        <${ui.Kv} items=${[['Deltagare', sel.displayName(c, role)], ['Ärendenummer', c.number], ['Avtalsområde', sel.areaName(c.primaryArea)], ['Yrkesspår', c.vocationalTrack || 'Framgår inte'],
          ['Insatsen startade', d.fmtDate(c.startDate)], [c.endDate ? 'Insatsen avslutades' : 'Planerat slut', d.fmtDate(c.endDate || c.plannedEnd)], ['Fas vid månadens slut', sel.phaseLabel(phase)],
          ['Huvudcoach', MM.personName(c.leadCoachId)], ['Beställare', `${MM.personName(c.referrerId)}${unitOf(c.referrerId) ? `, ${unitOf(c.referrerId)}` : ''}`]]} />
        <p class="small muted">Personnummer skrivs inte ut. Ärendenumret identifierar deltagaren.</p>
      <//>
      <${Sec} n="2" title="Närvaro och frånvaro">
        <${AttendanceTable} rows=${weeks} total=${total} firstCol="Vecka" />
        <p><b>Giltig frånvaro per orsak:</b> ${reasonsText(total.reasons)}.</p>
        <p><b>Upprepad ogiltig frånvaro:</b> ${rep.hit ? `Ja – ${rep.count} tillfällen. Åtgärdsplan: se avsnitt 6.` : 'Nej.'}</p>
      <//>
      <${Sec} n="3" title="Genomförda aktiviteter">
        <p class="small muted">Aktivitetstyperna är exempel – de stäms av mot mall 02. Kryss betyder minst en registrerad aktivitet av typen i en godkänd avstämning.</p>
        <${ActivityChecklist} cis=${cis} />
        <p><b>Dokumentation:</b> ${docText(cis, d.monthName(mk))}</p>
      <//>
      <${Sec} n="4" title="Progression">
        ${ok ? html`<${ProgressionTable} ma=${ma} />` : html`<${Wait}>Visas när coachen har godkänt månadsbedömningen.<//>`}
      <//>
      <${Sec} n="5" title="Resultat och utfall"><${EventsTable} evs=${evs} /><//>
      <${Sec} n="6" title="Avvikelse, risk och åtgärd"><${DeviationsBlock} devs=${devs} repeated=${rep} /><//>
      <${Sec} n="7" title=${`Plan för nästa månad (${d.monthName(next)})`}>
        ${!ok ? html`<${Wait}>Visas när coachen har godkänt månadsbedömningen.<//>` : plan ? html`<${ui.Kv} items=${[['Mål 1', plan.goal1 || 'Framgår inte'], ['Mål 2', plan.goal2 || 'Framgår inte'], ['Planerade aktiviteter', plan.plannedActivities || 'Framgår inte'],
          ['Planerad arbetsgivarkontakt', plan.plannedEmployerContact || 'Inget planerat'], ['Anpassning', plan.plannedAdaptation || 'Ingen särskild anpassning'], ['Nästa uppföljning med kommunen', plan.nextCustomerMeeting ? d.fmtDate(plan.nextCustomerMeeting) : 'Inte bokad']]} />` : html`<p>Framgår inte.</p>`}
      <//>
      <${Sec} n="8" title="Coachens sammanfattande bedömning">
        ${ok ? html`<${ui.Kv} items=${[['Samlad status', html`<${ui.Status} value=${ma.overallStatus} />`], ['Sammanfattning', ma.summary || 'Framgår inte.'], ['Ansvarig coach', MM.personName(ma.decidedBy || c.leadCoachId)], ['Datum', d.fmtDate(ma.decidedAt)]]} />`
          : html`<${Wait}>Visas när coachen har godkänt månadsbedömningen.<//>`}
        <p class="fixed-text">${PRINCIPLE}</p>
      <//>
    <//>`;
  };

  // ------------------------------------------------------------ Slutrapport (hela perioden)
  const defaultRecommendation = (c, plan) => {
    if (c.endReason === 'arbete') return 'Deltagaren har påbörjat arbete. Ingen fortsatt insats rekommenderas.';
    if (c.endReason === 'studier') return 'Deltagaren har påbörjat studier. Ingen fortsatt insats rekommenderas.';
    if (plan && (plan.goal1 || plan.goal2)) return `Fortsatt arbete mot målen i den senaste planen: ${joinSv([plan.goal1, plan.goal2].filter(Boolean).map(lcfirst))}. Kommunen avgör om en ny insats ska beställas.`;
    return 'Framgår inte.';
  };
  const FinalDoc = ({ r, role }) => {
    const c = caseOf(r); if (!c) return html`<${ui.Empty} icon="file" title="Ärendet finns inte" />`;
    const from = r.periodStart || c.startDate; const to = r.periodEnd || c.endDate || d.today();
    const months = [];
    for (let mk = d.monthKey(from); mk <= d.monthKey(to); mk = d.addMonths(mk, 1)) {
      const mFrom = maxS(`${mk}-01`, from); const mTo = minS(d.monthEnd(mk), to);
      months.push({ key: mk, label: ucfirst(d.monthName(mk)), st: sel.attendanceStats(c.id, mFrom, mTo), paused: false });
    }
    const total = sel.attendanceStats(c.id, from, to);
    const rep = repeatedInPeriod(c.id, from, to);
    const cis = approvedCheckIns(c.id, from, to);
    const mas = approvedAssessments(c.id, d.monthKey(from), d.monthKey(to));
    const first = mas[0]; const last = mas[mas.length - 1];
    const evs = sel.eventsOf(c.id).filter((e) => e.occurredOn >= from && e.occurredOn <= to).sort(MM.by('occurredOn'));
    const devs = sel.deviationsOf(c.id).filter((x) => x.createdAt.slice(0, 10) <= to);
    const lastCi = cis[cis.length - 1];
    const plan = last ? sel.planOf(c.id, last.month) : null;
    const ft = r.finalText || {};
    const obstacles = ft.obstacles != null && ft.obstacles !== '' ? ft.obstacles : (lastCi && (lastCi.obstacles || []).length ? `${ucfirst(joinSv(lastCi.obstacles.map(lcfirst)))}.` : 'Inga hinder noterade i den senaste godkända avstämningen.');
    const rec = String(ft.recommendation || '').trim() || (isDelivered(r) || r.status === 'approved' ? defaultRecommendation(c, plan) : '');
    const cfgProg = MM.cfg().progression;
    const resultText = c.resultClass === 'result' ? (c.resultVerifiedAt ? `Arbete eller studier – verifierat ${d.fmtDate(c.resultVerifiedAt)}.` : 'Arbete eller studier – väntar på verifiering. Räknas inte som resultat förrän underlaget är verifierat.')
      : c.resultClass === 'excluded' ? 'Avslutet räknas inte i resultatgraden (avbrott som inte beror på insatsen).' : c.resultClass === 'no_result' ? 'Inget resultat enligt resultatdefinitionen.' : 'Framgår inte.';
    return html`<${ui.Paper} title="Slutrapport" draft=${isDraftDoc(r) ? 'Utkast' : null} info=${baseInfo(r, c, [['Period', `${d.fmtDate(from)} – ${d.fmtDate(to)}`]])}>
      <${Superseded} r=${r} />
      <${Sec} n="1" title="Grunduppgifter">
        <${ui.Kv} items=${[['Deltagare', sel.displayName(c, role)], ['Ärendenummer', c.number], ['Avtalsområde', sel.areaName(c.primaryArea)], ['Yrkesspår', c.vocationalTrack || 'Framgår inte'],
          ['Insatsen startade', d.fmtDate(c.startDate)], ['Insatsen avslutades', d.fmtDate(c.endDate)], ['Avslutsorsak', sel.endReasonLabel(c.endReason)], ['Huvudcoach', MM.personName(c.leadCoachId)],
          ['Beställare', `${MM.personName(c.referrerId)}${unitOf(c.referrerId) ? `, ${unitOf(c.referrerId)}` : ''}`]]} />
        <p class="small muted">Personnummer skrivs inte ut. Ärendenumret identifierar deltagaren.</p>
      <//>
      <${Sec} n="2" title="Närvaro och frånvaro under hela perioden">
        <${AttendanceTable} rows=${months} total=${total} firstCol="Månad" />
        <p><b>Giltig frånvaro per orsak:</b> ${reasonsText(total.reasons)}.</p>
        <p><b>Upprepad ogiltig frånvaro:</b> ${rep.hit ? `Ja – ${rep.count} tillfällen under perioden. Se avsnitt 6.` : 'Nej.'}</p>
      <//>
      <${Sec} n="3" title="Genomförda aktiviteter">
        <p class="small muted">Aktivitetstyperna är exempel – de stäms av mot mall 02.</p>
        <${ActivityChecklist} cis=${cis} />
        <p><b>Dokumentation:</b> ${docText(cis, 'insatsen')}</p>
      <//>
      <${Sec} n="4" title="Progression">
        ${!last ? html`<p>Ingen godkänd månadsbedömning finns för perioden.</p>` : html`<div class="stack-sm">
          <p class="small muted">Jämförelse mellan första (${d.monthName(first.month)}) och senaste (${d.monthName(last.month)}) godkända månadsbedömning. Skala 0–3.</p>
          <${TWrap} min=${560}>
            <thead><tr><th style="width:30%">Område</th><th class="num">Första</th><th class="num">Senaste</th><th>Senaste observation</th></tr></thead>
            <tbody>${cfgProg.areas.map((k) => { const a0 = first.areas[k] || {}; const a1 = last.areas[k] || {}; return html`<tr key=${k}><td>${cfgProg.areaLabels[k]}</td><td class="num">${a0.level ?? '–'}</td><td class="num">${a1.level ?? '–'}</td><td>${a1.observation || '–'}</td></tr>`; })}</tbody>
          <//>
        </div>`}
      <//>
      <${Sec} n="5" title="Resultat och utfall">
        <p><b>Resultat:</b> ${resultText}</p>
        <${EventsTable} evs=${evs} />
      <//>
      <${Sec} n="6" title="Avvikelse, risk och åtgärd"><${DeviationsBlock} devs=${devs} repeated=${rep} /><//>
      <${Sec} n="7" title="Kvarstående hinder och rekommenderad fortsättning">
        <p><b>Kvarstående hinder:</b> ${obstacles}</p>
        ${rec ? html`<p><b>Rekommenderad fortsättning:</b> ${rec}</p>` : html`<${Wait}>Coachen skriver rekommenderad fortsättning innan rapporten godkänns.<//>`}
      <//>
      <${Sec} n="8" title="Coachens sammanfattande bedömning">
        ${last ? html`<${ui.Kv} items=${[['Samlad status', html`<${ui.Status} value=${last.overallStatus} />`], ['Sammanfattning', last.summary || 'Framgår inte.'], ['Ansvarig coach', MM.personName(c.leadCoachId)], ['Datum', d.fmtDate(r.approvedAt || last.decidedAt)]]} />`
          : html`<${Wait}>Ingen godkänd bedömning finns ännu.<//>`}
        <p class="fixed-text">${PRINCIPLE}</p>
      <//>
    <//>`;
  };

  // ------------------------------------------------------------ Veckorapport närvaro (en per handläggare och vecka)
  const actionForInvalid = (s) => { const acts = s.deviations.map((x) => x.action).filter(Boolean); return acts.length ? acts.join(' ') : 'Coachen följer upp frånvaron med deltagaren i nästa veckoavstämning.'; };
  const WeeklyDoc = ({ r, role }) => {
    if (!r.week || !r.recipientUserId) return html`<${ui.Empty} icon="file" title="Rapporten saknar vecka eller mottagare" />`;
    const wr = sel.weeklyReport(r.recipientUserId, r.week);
    const all = wr.sections.map((s) => ({ ...s, acc: sel.access(s.case, role) }));
    const secs = all.filter((s) => s.acc !== 'none');
    const open = secs.filter((s) => s.acc !== 'restricted');
    const sum = (k) => MM.sum(open, (s) => s.stats[k]);
    const reg = sum('planned') - sum('unregistered');
    const rate = reg ? (sum('present') + sum('late')) / reg : null;
    const now = d.now();
    return html`<${ui.Paper} title="Veckorapport närvaro" draft=${r.status === 'waiting' ? 'Väntar på närvaro' : isDraftDoc(r) ? 'Utkast' : null}
      info=${[['Beställare', MM.contract().customerName], ['Avtal', MM.contract().contractNumber], ['Mottagare', `${MM.personName(r.recipientUserId)}${unitOf(r.recipientUserId) ? `, ${unitOf(r.recipientUserId)}` : ''}`], ['Vecka', `${d.fmtWeekKey(r.week)} (${d.fmtWeekRange(r.week)})`], ['Version', String(r.version || 1)], ['Publicerad', r.deliveredAt ? d.fmtDateTime(r.deliveredAt) : 'Inte publicerad']]}>
      <${Superseded} r=${r} />
      ${secs.length < all.length && html`<p class="small"><b>Du ser ${secs.length} av ${all.length} deltagare</b> – bara de ärenden du är tilldelad.</p>`}
      <${Sec} title="Sammanfattning">
        <${ui.Kv} items=${[['Deltagare', String(secs.length)], ['Planerade tillfällen', String(sum('planned'))], ['Närvarograd', fmt.pct(rate, 0)], ['Giltig frånvaro', String(sum('absentValid'))], ['Ogiltig frånvaro', String(sum('absentInvalid'))],
          sum('unregistered') > 0 && ['Ej registrerade', String(sum('unregistered'))]]} />
        <p class="small muted">Närvarograd = närvarotillfällen delat med registrerade planerade tillfällen. Giltig frånvaro redovisas separat. Bara orsakskategori anges.</p>
        ${open.length > 0 && html`<${TWrap} min=${480}>
          <thead><tr><th>Deltagare</th><th class="num">Närvaro</th><th class="num">Giltig frånvaro</th><th class="num">Ogiltig frånvaro</th><th>Risk</th></tr></thead>
          <tbody>${open.map((s) => html`<tr key=${s.case.id}><td>${sel.displayName(s.case, role)}<div class="small muted">${s.case.number}</div></td>
            <td class="num">${s.paused ? 'Uppehåll' : `${s.stats.present + s.stats.late} av ${s.stats.planned}`}${s.stats.unregistered > 0 ? html`<div class="small"><b>${s.stats.unregistered} ej registrerade</b></div>` : ''}</td>
            <td class="num">${s.stats.absentValid}</td><td class="num">${s.stats.absentInvalid > 0 ? html`<b>${s.stats.absentInvalid}</b>` : '0'}</td><td>${s.risk}</td></tr>`)}</tbody>
        <//>`}
      <//>
      <${Sec} title="Deltagare – tillfällen och åtgärder">
        ${secs.length === 0 ? html`<p>Inga deltagare att visa för din roll.</p>` : secs.map((s) => s.acc === 'restricted'
          ? html`<div key=${s.case.id} class="stack-sm" style="border-top:1px solid var(--ljusgra);padding-top:12px"><h3 style="font-size:1rem">${s.case.number} · Skyddade personuppgifter</h3><p class="small">Visas bara för namngiven coach och avtalsansvarig.</p></div>`
          : html`<div key=${s.case.id} class="stack-sm" style="border-top:1px solid var(--ljusgra);padding-top:12px">
            <h3 style="font-size:1rem">${sel.displayName(s.case, role)} · ${s.case.number}</h3>
            ${s.paused ? html`<p>Uppehåll denna vecka. Ingen närvaro planerad.</p>` : s.rows.length === 0 ? html`<p>Inga tillfällen planerade denna vecka.</p>` : html`<${TWrap} min=${440}>
              <thead><tr><th>Tillfälle</th><th>Aktivitet</th><th>Närvaro</th><th>Orsak</th></tr></thead>
              <tbody>${s.rows.map(({ activity: a, att }) => html`<tr key=${a.id}><td class="nowrap">${ucfirst(d.WD_SHORT[d.weekday(a.startsAt)])} ${d.fmtDateShort(a.startsAt)} kl. ${d.fmtTime(a.startsAt)}</td><td>${ucfirst(a.kind)}</td>
                <td>${att ? sel.attLabel(att.status) : a.startsAt > now ? 'Planerat' : html`<b>Ej registrerad</b>`}</td><td>${att && att.status === 'absent_valid' ? (att.reason || 'Giltigt skäl') : '–'}</td></tr>`)}</tbody>
            <//>`}
            <div class="small">Planerade tillfällen ${s.stats.planned} · närvaro ${s.stats.present + s.stats.late} · giltig frånvaro ${s.stats.absentValid} · ogiltig frånvaro ${s.stats.absentInvalid}</div>
            ${s.stats.absentInvalid > 0 && html`<p><b>Åtgärd vid ogiltig frånvaro:</b> ${actionForInvalid(s)}</p>`}
            <p><b>Risk:</b> ${s.risk}</p>
          </div>`)}
      <//>
      <p class="fixed-text">Veckorapporten skapas automatiskt från coachernas närvaroregistrering. Den publiceras när alla deltagare är registrerade, senast måndag kl. ${d.fmtTime(`2000-01-01T${(MM.cfg().sla.find((x) => x.key === 'veckorapport_publicering') || {}).time || '16:00'}`)} för föregående vecka.</p>
    <//>`;
  };

  // ------------------------------------------------------------ Orderbekräftelse
  const OrderDoc = ({ r, role }) => {
    const c = caseOf(r); if (!c) return html`<${ui.Empty} icon="file" title="Ärendet finns inte" />`;
    const start = c.startDate || c.plannedStart || c.desiredStart;
    const weeks = c.orderValueWeeks || c.plannedWeeks || null;
    const price = sel.priceFor(c.primaryArea, start || d.today());
    const coach = MM.personById(c.leadCoachId);
    return html`<${ui.Paper} title="Orderbekräftelse" draft=${isDraftDoc(r) ? 'Utkast' : null} info=${baseInfo(r, c, [['Beställarreferens', c.buyerReference || 'Saknas']])}>
      <${Superseded} r=${r} />
      <p>Miljonbemanning bekräftar beställningen med ärendenummer <b>${c.number}</b>. Ärendenumret är också ordernummer och står på fakturorna. Använd det i stället för personnummer när ni kontaktar oss.</p>
      <${Sec} title="Insatsen">
        <${ui.Kv} items=${[['Deltagare', sel.displayName(c, role)], ['Ärendenummer', c.number], ['Avtalsområde', sel.areaName(c.primaryArea)], ['Yrkesspår', c.vocationalTrack || 'Bestäms vid kartläggningen'],
          ['Startdatum', start ? d.fmtDate(start) : 'Inte bestämt'], ['Huvudcoach', coach ? `${coach.name}${coach.phone ? `, telefon ${coach.phone}` : ''}` : 'Inte utsedd'],
          ['Första mötet', c.firstMeetingAt ? `${ucfirst(d.fmtDateTimeLong(c.firstMeetingAt))}, ${c.location || 'Alby'}` : 'Bokas inom en vecka'], ['Planerad omfattning', weeks ? `${weeks} veckor${c.plannedEnd ? ` (till och med ${d.fmtDate(c.plannedEnd)})` : ''}` : 'Ej angiven']]} />
      <//>
      <${Sec} title="Beställningens värde">
        ${weeks ? html`<${ui.Kv} items=${[['Planerad omfattning', `${weeks} veckor`], ['Veckopris exkl. moms', `${fmt.kr(price)} (${sel.areaName(c.primaryArea)})`],
          ['Beställningens värde exkl. moms', html`<b>${fmt.kr(weeks * price)}</b> <span class="small muted nowrap">(${weeks} × ${fmt.kr(price)})</span>`]]} />` : html`<p>Värdet beräknas när omfattningen är bestämd.</p>`}
        <p class="small">Värdet är planerade veckor gånger veckopriset för avtalsområdet. Det används för att visa upparbetat och återstående belopp på varje faktura. Fakturering sker per deltagarvecka.</p>
      <//>
      <${Sec} title="Fakturering">
        <${ui.Kv} items=${[['Beställarreferens', c.buyerReference || 'Saknas – måste kompletteras'], ['Kommunens inköpsordernummer', c.purchaseOrderNumber || 'Inget angivet'], ['Faktureringsobjekt', `Ärende ${c.number}`]]} />
      <//>
      <p class="fixed-text">Frågor om beställningen? Skicka ett meddelande i portalen och ange ärendenumret. Skriv inte personnummer i e-post.</p>
    <//>`;
  };

  // ------------------------------------------------------------ Beställarrapport (kommunens chef)
  const summaryFromNumbers = (s) => {
    const m = s.result.month;
    return `Under ${d.monthName(s.month)} var ${s.small(s.active)} deltagare aktiva och ${s.small(s.started)} nya insatser startade. ${ucfirst(s.small(s.closed))} insatser avslutades, varav ${s.small(m.num)} till arbete eller studier. Närvarograden var ${fmt.pct(s.attendanceRate, 0)}. ${s.deviations > 0 ? `${ucfirst(s.small(s.deviations))} avvikelser på deltagarnivå har hanterats med åtgärd.` : 'Inga avvikelser på deltagarnivå registrerades.'}`;
  };
  const CustomerSummaryDoc = ({ r }) => {
    const mk = r.month || d.monthKey(r.periodStart);
    const s = sel.customerSummary(mk);
    const target = s.result.contractTarget;
    const minN = MM.cfg().kpis.find((k) => k.key === 'resultatgrad').minN;
    const resRow = (label, x) => {
      const hidden = x.den > 0 && x.den < s.minN;
      const numTxt = x.num > 0 && x.num < s.minN ? 'färre än 5' : String(x.num);
      const share = x.den === 0 ? '–' : hidden || (x.num > 0 && x.num < s.minN) ? 'Redovisas inte' : fmt.pct(x.value);
      const vs = x.den === 0 || hidden ? '–' : x.den < minN ? 'För få avslut för att bedöma' : x.value >= target ? 'I nivå med eller över avtalsmålet' : 'Under avtalsmålet';
      return html`<tr><td>${label}</td><td class="num">${numTxt}</td><td class="num">${hidden ? 'färre än 5' : x.den}</td><td class="num">${share}</td><td>${vs}</td></tr>`;
    };
    const roll = s.result.rolling;
    const summary = r.summary || (isDelivered(r) ? summaryFromNumbers(s) : '');
    const pulseOk = s.pulse.enough;
    const tracks = s.byTrack.slice(0, 8); const restTracks = s.byTrack.slice(8);
    return html`<${ui.Paper} title="Beställarrapport" draft=${isDraftDoc(r) ? 'Utkast' : null} info=${baseInfo(r, null, [['Månad', d.monthName(mk)], ['Mottagare', `${MM.personName(r.recipientUserId)}${unitOf(r.recipientUserId) ? `, ${unitOf(r.recipientUserId)}` : ''}`]])}>
      <${Superseded} r=${r} />
      <p class="small">Uppgifter per grupp med färre än ${s.minN} personer redovisas som "färre än ${s.minN}". Rapporten innehåller inga namn.</p>
      <${Sec} n="1" title="Deltagare">
        <${ui.Kv} items=${[['Aktiva under månaden', s.small(s.active)], ['Nya insatser', s.small(s.started)], ['Avslutade insatser', s.small(s.closed)]]} />
        <${TWrap} min=${360}>
          <thead><tr><th>Avtalsområde</th><th class="num">Aktiva</th><th class="num">Nya</th><th class="num">Avslutade</th></tr></thead>
          <tbody>${s.byArea.map((a) => html`<tr key=${a.code}><td>${a.name}</td><td class="num">${s.small(a.active)}</td><td class="num">${s.small(a.started)}</td><td class="num">${s.small(a.closed)}</td></tr>`)}</tbody>
        <//>
        <${TWrap} min=${260}>
          <thead><tr><th>Yrkesspår</th><th class="num">Aktiva</th></tr></thead>
          <tbody>${tracks.map((t) => html`<tr key=${t.track}><td>${t.track || 'Inte valt än'}</td><td class="num">${s.small(t.active)}</td></tr>`)}
            ${restTracks.length > 0 && html`<tr><td>Övriga ${restTracks.length} yrkesspår</td><td class="num">${s.small(MM.sum(restTracks, (t) => t.active))}</td></tr>`}</tbody>
        <//>
      <//>
      <${Sec} n="2" title="Resultat – arbete eller studier">
        <${TWrap} min=${560}>
          <thead><tr><th>Period</th><th class="num">Resultat</th><th class="num">Avslut som räknas</th><th class="num">Andel</th><th>Jämfört med avtalsmålet ${fmt.pct(target, 0)}</th></tr></thead>
          <tbody>${resRow(ucfirst(d.monthName(mk)), s.result.month)}${resRow('Rullande 6 månader', roll)}${resRow('Sedan avtalets start', s.result.sinceStart)}</tbody>
        <//>
        ${roll.den >= minN && roll.value != null && html`<${ui.Meter} value=${roll.value} max=${0.6} tone="blue" label=${`Resultatgrad rullande 6 månader ${fmt.pct(roll.value)}`} markers=${[{ value: target, label: `Avtalsmål ${fmt.pct(target, 0)}`, tone: 'red' }]} />`}
        <p class="small">${roll.prelim > 0 ? `${ucfirst(s.small(roll.prelim))} avslut till arbete eller studier väntar på verifiering och räknas inte ännu. ` : ''}Resultatdefinitionen är inte fastställd. ${MM.cfg().result.prototypeDefinition || ''}</p>
      <//>
      <${Sec} n="3" title="Progression">
        <p>${s.progression.assessed >= s.minN ? html`<b>${fmt.pct(s.progression.clear / s.progression.assessed, 0)}</b> av deltagarna med godkänd månadsbedömning visade tydlig progression (nivå 2 eller högre i minst ett område). Underlag: ${s.progression.assessed} bedömningar.` : `Färre än ${s.minN} godkända månadsbedömningar – andelen redovisas inte.`}</p>
        ${s.progression.assessed >= s.minN && html`<${TWrap} min=${420}>
          <thead><tr><th>Område</th><th class="num">Tydlig progression</th><th class="num">Andel</th></tr></thead>
          <tbody>${s.progression.areaDist.map((a) => html`<tr key=${a.key}><td>${a.label}</td><td class="num">${s.small(a.clear)}</td><td class="num">${a.clear > 0 && a.clear < s.minN ? 'Redovisas inte' : fmt.pct(a.n ? a.clear / a.n : null, 0)}</td></tr>`)}</tbody>
        <//>`}
      <//>
      <${Sec} n="4" title="Närvaro">
        <${ui.Kv} items=${[['Närvarograd', fmt.pct(s.attendanceRate, 0)], ['Planerade tillfällen', fmt.num(s.attendance.planned)], ['Giltig frånvaro', s.small(s.attendance.absentValid)], ['Ogiltig frånvaro', s.small(s.attendance.absentInvalid)]]} />
      <//>
      <${Sec} n="5" title="Avvikelser">
        <${ui.Kv} items=${[['Avvikelser på deltagarnivå', s.small(s.deviations)], ['Avtalsavvikelser', s.small(s.contractDeviations)]]} />
      <//>
      <${Sec} n="6" title="Nöjdhet">
        <p>${pulseOk ? html`<b>${fmt.pct(s.pulse.satisfaction, 0)}</b> svarade 4 eller 5 på frågan om hur nöjda de är (${s.pulse.responses} svar under de senaste tre månaderna).` : `Färre än ${s.minN} svar – resultatet redovisas inte.`}</p>
      <//>
      ${s.seesSlaStats && html`<${Sec} n="7" title="Svarstider">
        <${ui.Kv} items=${['avrop_besvarade_i_tid', 'forsta_mote_inom_en_vecka', 'veckorapporter_i_tid'].map((k) => { const v = sel.kpiValue(k, { month: mk }); return v && [v.label, v.den ? `${fmt.pct(v.value, 0)} (${v.num} av ${v.den})` : '–']; })} />
      <//>`}
      <${Sec} n=${s.seesSlaStats ? '8' : '7'} title="Sammanfattning">
        ${summary ? html`<p>${summary}</p><p class="small muted">Godkänd av ${MM.personName(r.approvedBy || MM.contract().contractManagerId)}${r.approvedAt ? `, ${d.fmtDate(r.approvedAt)}` : ''}.</p>` : html`<${Wait}>Sammanfattningen skrivs när avtalsansvarig godkänner rapporten.<//>`}
      <//>
    <//>`;
  };

  // Kommunportalens rubrikregler (.portal h1/h2) får inte ändra rapportpapprets typografi.
  const DOC_CSS = '.portal .rap-doc .paper h1{font-size:1.25rem;letter-spacing:.05em;display:block}.portal .rap-doc .paper h2{font-size:.875rem;letter-spacing:.08em;font-weight:800}.rap-doc .paper h3{font-size:1rem;font-weight:800}';
  /** Återanvändbar rendering av en rapport som PDF-förhandsvisning. props: { report } eller { reportId }, valfritt role. */
  const ReportDocument = ({ report, reportId, role }) => {
    const rl = role || MM.role();
    const r = report || S().reports.find((x) => x.id === reportId);
    if (!r) return html`<${ui.Empty} icon="file" title="Rapporten finns inte" />`;
    const C = { monthly: MonthlyDoc, final: FinalDoc, weekly_attendance: WeeklyDoc, order_confirmation: OrderDoc, customer_summary: CustomerSummaryDoc }[r.kind];
    if (!C) return html`<${ui.Empty} icon="file" title=${sel.reportKindLabel(r.kind)}>Den här rapporttypen visas inte i prototypen.<//>`;
    return html`<div class="rap-doc"><style>${DOC_CSS}</style><${C} r=${r} role=${rl} /></div>`;
  };

  // ------------------------------------------------------------ Egna åtgärder (prefix rap.)
  const findRep = (st, id) => st.reports.find((x) => x.id === id);
  /** Samordnarens valfria kvalitetsgranskning. */
  MM.defineAction('rap.qualityReview', (st, p, ctx) => { const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' }; r.qualityReviewedBy = ctx.actorId; r.qualityReviewedAt = ctx.now; ctx.audit('report.quality_reviewed', 'report', r.id, { kind: r.kind }); return {}; });
  /** Slutrapportens kvarstående hinder och rekommenderade fortsättning (coachens text). */
  MM.defineAction('rap.saveFinal', (st, p, ctx) => {
    const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' };
    const rec = String(p.recommendation || '').trim(); if (!rec) return { error: 'recommendation' };
    r.finalText = { obstacles: String(p.obstacles || '').trim(), recommendation: rec };
    if (r.status === 'draft') r.status = 'reviewed';
    ctx.audit('report.final_text_saved', 'report', r.id, { kind: r.kind });
    return {};
  });
  /** Beställarrapportens sammanfattning (avtalsansvarig). Innehållet loggas inte – bara att det sparats. */
  MM.defineAction('rap.saveSummary', (st, p, ctx) => {
    const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' };
    const text = String(p.summary || '').trim(); if (!text) return { error: 'summary' };
    r.summary = text; r.summaryAiUsed = !!p.aiUsed;
    ctx.audit('report.summary_saved', 'report', r.id, { aiUsed: !!p.aiUsed });
    return {};
  });
  /** Orsak till rättelse på den nya versionen. Nollställer kvalitetsgranskningen. */
  MM.defineAction('rap.correctionNote', (st, p, ctx) => {
    const r = findRep(st, p.reportId); if (!r) return { error: 'not_found' };
    r.correctionReason = String(p.reason || '').trim(); r.correctedBy = ctx.actorId; r.correctedAt = ctx.now; r.qualityReviewedBy = null; r.qualityReviewedAt = null;
    ctx.audit('report.correction_reason', 'report', r.id, { previous: r.previousId || null });
    return {};
  });

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

  const ProvisionalNote = ({ r }) => isProvisional(r) && html`<span class="small muted row-sm" style="gap:4px;flex-wrap:nowrap" title=${provisionalText(r)}><${I} name="help" />Ej fastställd deadline</span>`;
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
      { key: 'version', label: 'Version', num: true, render: (x) => html`<span class="nowrap">v. ${x.r.version || 1}</span>` },
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
            <li>Rättelse skapar en ny version. Den gamla versionen sparas.</li>
          </ul>
        </div>
      <//>
      <${ui.DemoNote}>Listan räknas fram ur demodata. Förfallotider för månads-, slut- och beställarrapporter är förslag tills Botkyrka har fastställt dem ("Ej fastställd deadline").<//>
    <//>`;
  };

  // ------------------------------------------------------------ Rapportvisning – leverantörens sida
  const DENIED = {
    not_assigned: ['Rapporten gäller ett ärende du inte är tilldelad', 'Du ser bara rapporter för dina egna ärenden. Så fungerar behörigheten i den riktiga tjänsten också.'],
    protected: ['Skyddade personuppgifter', 'Rapporten gäller ett ärende med skyddade personuppgifter. Den visas bara för namngiven coach och avtalsansvarig.'],
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

  const idleText = (r, role, step) => {
    if (role === 'chef' || role === 'handledare') return 'Du kan läsa rapporten. Coach, samordnare och avtalsansvarig hanterar godkännande och leverans.';
    if (step.key === 'blocked') return null;
    if (step.key === 'registration') return 'Rapporten publiceras automatiskt när coacherna har registrerat närvaron.';
    if (step.key === 'approval') { const c = caseOf(r); return r.kind === 'customer_summary' ? 'Avtalsansvarig godkänner beställarrapporten nedan.' : ['monthly', 'final'].includes(r.kind) ? `Huvudcoachen${c ? ` ${MM.personName(c.leadCoachId)}` : ''} godkänner rapporten.` : 'Samordnaren eller avtalsansvarig godkänner rapporten.'; }
    if (step.key === 'deliver') return 'Coach, samordnare eller avtalsansvarig levererar rapporten till kommunen.';
    return 'Inga åtgärder behövs just nu.';
  };
  const StatusCard = ({ r, role, acc, onDeliver, onCorrect }) => {
    const c = caseOf(r); const s = effStatus(r); const step = nextStep(r);
    const lead = acc.access === 'full';
    const ma = r.kind === 'monthly' ? sel.assessment(r.caseId, r.month) : null;
    const approvedStates = ['draft', 'reviewed'].includes(r.status) && !r.superseded;
    const canApprove = approvedStates && step.key === 'approval' && (
      (['monthly', 'final'].includes(r.kind) && role === 'coach' && lead) ||
      (['order_confirmation', 'weekly_attendance'].includes(r.kind) && ['samordnare', 'avtalsansvarig'].includes(role)));
    const deliverRoles = r.kind === 'customer_summary' ? ['avtalsansvarig', 'samordnare'] : ['coach', 'samordnare', 'avtalsansvarig'];
    const roleOk = deliverRoles.includes(role) && (role !== 'coach' || lead);
    const weeklyReady = r.kind === 'weekly_attendance' && r.status === 'waiting' && sel.weeklyReport(r.recipientUserId, r.week).complete;
    const canDeliver = roleOk && !r.superseded && (r.status === 'approved' || weeklyReady);
    const canCorrect = roleOk && !r.superseded && ['approved', 'delivered', 'opened'].includes(r.status);
    const canQuality = role === 'samordnare' && !r.superseded && ['reviewed', 'approved'].includes(r.status) && !r.qualityReviewedAt;
    const approve = () => { MM.dispatch('report.approve', { reportId: r.id }); MM.toast(`${reportTitle(r)} är godkänd. Nästa steg: leverera till kommunen.`, 'blue'); };
    const quality = () => { MM.dispatch('rap.qualityReview', { reportId: r.id }); MM.toast('Rapporten är markerad som kvalitetsgranskad.', 'blue'); };
    const dueRow = r.dueAt && ['Förfaller', html`<div class="row-sm">${isDelivered(r) ? html`<${ui.SlaBadge} dueAt=${r.dueAt} metAt=${r.deliveredAt} />` : html`<${ui.SlaBadge} dueAt=${r.dueAt} />`}<span class="small">${d.fmtDateTimeLong(r.dueAt)}</span></div>`];
    return html`<${ui.Card} title="Status och nästa steg" icon="activity" tone=${isOverdue(r) ? 'red' : undefined}>
      <div class="stack">
        <div class="row-sm"><${StatusBadge} r=${r} />${isOverdue(r) && html`<${ui.Badge} tone="red" icon="alert">Försenad<//>`}<${ui.Badge} tone="outline" icon="layers">Version ${r.version || 1}<//><${ProvisionalBadge} r=${r} />
          ${r.qualityReviewedAt && html`<${ui.Badge} tone="bluetone" icon="shield">Kvalitetsgranskad<//>`}</div>
        <${ui.Stepper} steps=${LIFECYCLE} current=${lifecycleIndex(r)} />
        <div class="split">
          <${ui.Kv} items=${[
            ['Nästa steg', step.label],
            dueRow,
            isProvisional(r) && ['Deadline', provisionalText(r)],
            r.approvedAt && ['Godkänd', `${d.fmtDateTime(r.approvedAt)} av ${MM.personName(r.approvedBy)}`],
            r.qualityReviewedAt && ['Kvalitetsgranskad', `${d.fmtDateTime(r.qualityReviewedAt)} av ${MM.personName(r.qualityReviewedBy)}`],
          ]} />
          <${ui.Kv} items=${[
            ['Mottagare', `${MM.personName(recipientOf(r))}${unitOf(recipientOf(r)) ? `, ${unitOf(recipientOf(r))}` : ''}`],
            ['Levererad', r.deliveredAt ? `${d.fmtDateTime(r.deliveredAt)} i portalen` : 'Inte levererad'],
            ['Kvitterad', r.openedAt ? `${d.fmtDateTime(r.openedAt)} – mottagaren har öppnat rapporten` : isDelivered(r) ? 'Inte öppnad än' : '–'],
            r.correctionReason && ['Rättelse', `${r.correctionReason} (${MM.personName(r.correctedBy)}, ${d.fmtDateTime(r.correctedAt)})`],
          ]} />
        </div>
        ${r.kind === 'monthly' && step.key === 'blocked' && html`<${ui.Notice} tone="warn" title="Rapporten kan inte godkännas ännu">
          <div class="stack-sm"><span>Månadsbedömningen för ${d.monthName(r.month)} ${ma ? 'är inte godkänd' : 'saknas'}. Rapporten byggs bara av godkända uppgifter.</span>
          ${sel.access(c) === 'full' || sel.access(c) === 'team' ? html`<div><${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => MM.nav('coach.manad', { caseId: r.caseId, month: r.month })}>Öppna bedömningen<//></div>` : null}</div>
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

  const FinalTextCard = ({ r, role, acc }) => {
    const c = caseOf(r);
    const lastCi = c ? approvedCheckIns(c.id, r.periodStart || c.startDate, r.periodEnd || d.today()).pop() : null;
    const [obs, setObs] = useState((r.finalText && r.finalText.obstacles) || (lastCi && (lastCi.obstacles || []).length ? `${ucfirst(joinSv(lastCi.obstacles.map(lcfirst)))}.` : '') || '');
    const [rec, setRec] = useState((r.finalText && r.finalText.recommendation) || '');
    const [err, setErr] = useState(null);
    const canEdit = (role === 'coach' && acc.access === 'full') || role === 'samordnare';
    if (!['draft', 'reviewed'].includes(r.status) || r.superseded) return null;
    const save = () => {
      const res = MM.dispatch('rap.saveFinal', { reportId: r.id, obstacles: obs, recommendation: rec });
      if (res && res.error) { setErr('Skriv en rekommenderad fortsättning. Den behövs innan rapporten kan godkännas.'); return; }
      setErr(null); MM.toast('Texten är sparad i slutrapporten.', 'blue');
    };
    return html`<${ui.Card} title="Coachens text till slutrapporten" icon="edit">
      ${canEdit ? html`<div class="stack">
        <${ui.Field} label="Kvarstående hinder" id="rap-final-obs" help="Beskriv funktionellt, till exempel språk, digital vana eller resor. Inga diagnoser.">
          <${ui.TextArea} id="rap-final-obs" rows=${2} value=${obs} onInput=${setObs} maxLength=${400} />
        <//>
        <${ui.Field} label="Rekommenderad fortsättning" id="rap-final-rec" required error=${err} help="Vad rekommenderar du efter insatsen? Skriv kort och sakligt. Kommunen läser texten.">
          <${ui.TextArea} id="rap-final-rec" rows=${3} value=${rec} onInput=${(v) => { setRec(v); if (err) setErr(null); }} invalid=${!!err} maxLength=${600} />
        <//>
        <div class="row"><${ui.Btn} kind="primary" icon="check" onClick=${save}>Spara texten<//><span class="small muted">Rapporten blir granskad när texten är sparad. Därefter kan coachen godkänna.</span></div>
      </div>` : html`<p>Huvudcoachen skriver kvarstående hinder och rekommenderad fortsättning innan slutrapporten godkänns.</p>`}
    <//>`;
  };

  const SummaryApprovalCard = ({ r, role }) => {
    const mk = r.month || d.monthKey(r.periodStart);
    const s = useMemo(() => sel.customerSummary(mk), [mk, MM.store.version]);
    const suggestion = summaryFromNumbers(s);
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
          <div class="row"><${ui.Btn} kind="primary" icon="check" onClick=${approve}>Godkänn beställarrapporten<//><span class="small muted">Sammanfattningen är tom tills du väljer. AI föreslår – du bedömer.</span></div>`
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
          <span class="li-sub">${v.deliveredAt ? `Levererad ${d.fmtDateTime(v.deliveredAt)}` : v.approvedAt ? `Godkänd ${d.fmtDateTime(v.approvedAt)}` : 'Inte godkänd'}${v.superseded ? ' · ersatt' : ''}</span></div>
        <div class="li-side"><${StatusBadge} r=${v} />${v.id !== r.id && html`<${ui.Btn} kind="ghost" onClick=${() => MM.nav('rapport.visa', { reportId: v.id })}>Öppna<//>`}</div>
      </div>`)}</div>
      <div class="card-body small muted" style="border-top:1px solid var(--line)">Rättelse skapar en ny version. Den gamla sparas och syns här.</div>
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
      <p>En rättelse skapar version ${(r.version || 1) + 1} som utkast. Version ${r.version || 1} sparas och syns i versionshistoriken.${isDelivered(r) ? ' Kommunen får den nya versionen när den har godkänts och levererats.' : ''}</p>
      <${ui.Field} label="Varför rättas rapporten?" id="rap-correct-reason" required error=${err} help="Till exempel: fel datum för praktikstart. Skriv inga personuppgifter.">
        <${ui.TextArea} id="rap-correct-reason" rows=${3} value=${reason} onInput=${(v) => { setReason(v); if (err) setErr(null); }} invalid=${!!err} maxLength=${300} />
      <//>
    <//>`;
  };

  const MbReport = ({ r, role, acc }) => {
    const [correcting, setCorrecting] = useState(false);
    const c = caseOf(r);
    const crumbs = LIST_ROLES.includes(role) ? [{ label: 'Rapporter', view: 'rapporter.lista', params: {} }, { label: reportTitle(r) }] : c ? [{ label: c.number, view: 'arende.kort', params: { caseId: c.id } }, { label: reportTitle(r) }] : null;
    const eyebrow = c ? `${c.number}${acc.ok ? ` · ${sel.displayName(c, role)}` : ''}` : r.kind === 'weekly_attendance' ? `Till ${MM.personName(r.recipientUserId)}` : `Till ${MM.personName(r.recipientUserId)}`;
    const persp = html`<${ui.PerspectiveSwitch} role=${customerRoleFor(r)} view="rapport.visa" params=${{ reportId: r.id }} label="Se som kommunen" />`;
    if (!acc.ok) {
      const [t, b] = DENIED[acc.reason] || DENIED.role;
      return html`<${ui.Page} title=${reportTitle(r)} eyebrow=${c ? c.number : ''} crumbs=${crumbs}>
        <${ui.Card}><${ui.Empty} icon=${acc.reason === 'protected' ? 'lock' : 'eye-off'} title=${t}>${b}<//><//>
      <//>`;
    }
    const deliver = async () => {
      const to = recipientOf(r); const u = MM.personById(to);
      const ok = await MM.confirm({ title: 'Leverera till kommunen', confirmLabel: 'Leverera i portalen', body: html`<div class="stack-sm">
        <p><b>${reportTitle(r)}</b> publiceras i kommunens portal för ${u ? u.name : 'mottagaren'}.</p>
        <p>${u ? u.name : 'Mottagaren'} får ett mejl som bara innehåller en notis:</p>
        <div class="demo-note" style="border-style:solid"><${I} name="mail" /><div>"${noticeText(r)}"</div></div>
        <p class="small">${MM.cfg().reportDelivery.emailAttachmentAllowed ? 'Rapporten skickas även som bilaga enligt kommunens skriftliga instruktion.' : 'Rapporten skickas inte som bilaga i e-post. Det är avstängt i avtalskonfigurationen.'}</p>
      </div>` });
      if (!ok) return;
      const res = MM.dispatch('report.deliver', { reportId: r.id });
      if (res && res.error) { MM.toast('Rapporten måste vara godkänd innan den levereras.', 'red'); return; }
      MM.toast(`Levererad i portalen till ${u ? u.name : 'kommunen'}. Mejlet innehåller bara en notis utan personuppgifter.`, 'blue');
    };
    return html`<${ui.Page} title=${reportTitle(r)} eyebrow=${eyebrow} crumbs=${crumbs} actions=${persp}
      lead=${r.kind === 'customer_summary' ? 'Månadsrapport till kommunens chef. Den visar bara avtalets mål – aldrig Miljonbemannings interna mål.' : r.kind === 'weekly_attendance' ? 'En rapport per handläggare och vecka, med en sektion per deltagare. Skapas automatiskt från närvaroregistreringen.' : 'Förhandsvisning av rapporten som kommunen får. Den byggs bara av godkända uppgifter.'}>
      <${StatusCard} r=${r} role=${role} acc=${acc} onDeliver=${deliver} onCorrect=${() => setCorrecting(true)} />
      <${WaitingCard} r=${r} role=${role} />
      ${r.kind === 'final' && html`<${FinalTextCard} r=${r} role=${role} acc=${acc} />`}
      ${r.kind === 'customer_summary' && html`<${SummaryApprovalCard} r=${r} role=${role} />`}
      ${r.kind === 'customer_summary' && !MM.cfg().customerVisibility.seesSlaStats && html`<${ui.Notice} tone="info" title="SLA-statistik visas inte för kommunen">Ledningen har inte beslutat att kommunen ska se svarstider och SLA-uppfyllnad. Det styrs i avtalskonfigurationen. Den interna ledningsvyn finns under Ledningsvy.<//>`}
      <section aria-label="Förhandsvisning av rapporten" class="stack-sm">
        <div class="row-between"><h2 class="section-title"><span class="dot" aria-hidden="true"></span>Förhandsvisning</h2><span class="small muted">Så ser dokumentet ut för mottagaren</span></div>
        <${ReportDocument} report=${r} role=${role} />
      </section>
      <div class="grid-2">
        <${DeliveryCard} r=${r} />
        <${VersionsCard} r=${r} />
      </div>
      <${ui.DemoNote}>PDF-nedladdning finns inte i prototypen. I den riktiga tjänsten skapas PDF:en med react-pdf (@react-pdf/renderer) i Miljonbemannings grafiska profil och sparas i portalen. Varje visning av rapporten loggas i revisionsloggen.<//>
      ${correcting && html`<${CorrectModal} r=${r} onClose=${() => setCorrecting(false)} />`}
    <//>`;
  };

  // ------------------------------------------------------------ Rapportvisning – kundens sida (portalen)
  const PortalReport = ({ r, role, acc }) => {
    const c = caseOf(r);
    const back = () => (MM.views['kom.rapporter'] ? MM.nav('kom.rapporter', {}) : MM.back());
    const persp = html`<${ui.PerspectiveSwitch} role=${supplierRoleFor(r)} view="rapport.visa" params=${{ reportId: r.id }} label="Se från leverantörens håll" />`;
    const backBtn = html`<div><${ui.Btn} kind="ghost" icon="arrow-left" onClick=${back}>Tillbaka till rapporter<//></div>`;
    if (!acc.ok) {
      const [t, b] = DENIED[acc.reason] || DENIED.not_yours;
      return html`<div class="stack-lg">${backBtn}<${ui.Empty} icon="file" title=${t}>${b}<//><div class="row">${persp}</div></div>`;
    }
    const newer = r.superseded ? versionsOf(r).filter((v) => v.version > r.version && isDelivered(v)).pop() : null;
    return html`<div class="stack-lg">
      ${backBtn}
      <div class="stack-sm">
        <h1><span class="dot" aria-hidden="true"></span>${reportTitle(r)}</h1>
        <p>${c && html`Gäller ${sel.displayName(c, role)}, ärende <span class="nowrap">${c.number}</span>. `}Levererad av Miljonbemanning ${d.fmtDateTimeLong(r.deliveredAt)}.</p>
      </div>
      ${r.openedAt && html`<${ui.Notice} tone="ok" title="Rapporten är kvitterad">Du öppnade rapporten första gången ${d.fmtDateTime(r.openedAt)}. Miljonbemanning ser att du har läst den.<//>`}
      ${r.superseded && html`<${ui.Notice} tone="warn" title="Rapporten har rättats">Miljonbemanning har rättat rapporten. ${newer ? 'Den rättade versionen finns nedan.' : 'Den rättade versionen visas här när den är levererad.'}
        ${newer && html`<div style="margin-top:8px"><${ui.Btn} kind="primary" onClick=${() => MM.nav('rapport.visa', { reportId: newer.id })}>Visa den rättade versionen<//></div>`}<//>`}
      <${ReportDocument} report=${r} role=${role} />
      <${ui.Card} title="Har du frågor om rapporten?" icon="message">
        <div class="stack">
          <p>Skicka ett meddelande till coachen i portalen. Skriv inte personnummer i e-post.</p>
          ${c && MM.views['kom.deltagare'] && html`<div><${ui.Btn} kind="primary" icon="message" onClick=${() => MM.nav('kom.deltagare', { caseId: c.id })}>Skriv till coachen<//></div>`}
        </div>
      <//>
      <${ui.DemoNote}>Här finns en knapp för att ladda ner rapporten som PDF i den riktiga tjänsten. PDF:en skapas med react-pdf. I prototypen visas bara förhandsvisningen.<//>
      <div class="row">${persp}</div>
    </div>`;
  };

  const ReportView = ({ params, role }) => {
    const st = MM.useStore();
    const reportId = params && params.reportId;
    const r = reportId ? st.reports.find((x) => x.id === reportId) : null;
    const kund = MM.perspectiveOf(role) === 'kund';
    const acc = r ? reportAccess(r, role) : { ok: false, reason: 'missing' };
    ui.useAuditView('report', acc.ok ? reportId : null, 'report.view');
    useEffect(() => { if (r && kund && acc.ok && !r.openedAt) MM.dispatch('report.open', { reportId: r.id }, { silent: true }); }, [reportId, role]);
    if (!r) {
      const toList = kund ? (MM.views['kom.rapporter'] ? () => MM.nav('kom.rapporter', {}) : null) : LIST_ROLES.includes(role) ? () => MM.nav('rapporter.lista', {}) : null;
      const body = html`<${ui.Empty} icon="file" title=${reportId ? 'Rapporten finns inte' : 'Ingen rapport vald'} action=${toList && html`<${ui.Btn} kind="primary" onClick=${toList}>Visa rapporter<//>`}>Välj en rapport i listan.<//>`;
      return kund ? html`<div class="stack-lg">${body}</div>` : html`<${ui.Page} title="Rapport">${body}<//>`;
    }
    return kund ? html`<${PortalReport} r=${r} role=${role} acc=${acc} />` : html`<${MbReport} r=${r} role=${role} acc=${acc} />`;
  };

  // ------------------------------------------------------------ Registrering och export
  MM.registerView('rapporter.lista', { title: 'Rapporter', roles: LIST_ROLES, component: ListView });
  MM.registerView('rapport.visa', {
    title: (params) => { const r = params && params.reportId && MM.store.state ? MM.store.state.reports.find((x) => x.id === params.reportId) : null; return r ? reportTitle(r) : 'Rapport'; },
    roles: VIEW_ROLES, component: ReportView,
  });
  MM.reports = { ReportDocument, StatusBadge, reportTitle, periodText, effStatus, statusLabel, nextStep, isDelivered, isOverdue, reportAccess };
})();
