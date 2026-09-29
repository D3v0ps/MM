// 03-domain.js – selektorer och domänregler (behörighet, debitering, KPI:er, deadlines, flaggor)
// och gemensamma åtgärder som flera vyer använder. Alla avtalsvärden läses från MM.cfg().
(() => {
  const { d, fmt } = MM;
  const S = () => MM.store.state;
  const sel = (MM.sel = {});

  // ------------------------------------------------------------ Uppslag
  sel.caseById = (id) => S().cases.find((c) => c.id === id) || null;
  sel.caseByNumber = (n) => S().cases.find((c) => c.number === n) || null;
  sel.caseByTag = (tag) => sel.caseById(S().script[tag]);
  sel.person = (caseOrId) => { const c = typeof caseOrId === 'string' ? sel.caseById(caseOrId) : caseOrId; return c ? S().persons.find((p) => p.id === c.personId) : null; };
  sel.area = (code) => S().areas.find((a) => a.code === code);
  sel.areaName = (code) => (code ? `${code} ${(sel.area(code) || {}).name || ''}` : '–');
  sel.phaseName = (n) => { const p = MM.cfg().phases.find((x) => x.no === n); return p ? p.name : '–'; };
  sel.phaseLabel = (n) => `Fas ${n} · ${sel.phaseName(n)}`;
  sel.priceItem = (areaCode, date) => S().priceItems.find((p) => p.areaCode === areaCode && p.validFrom <= date && (!p.validTo || p.validTo >= date));
  sel.priceFor = (areaCode, date) => { const p = sel.priceItem(areaCode, date || d.today()); return p ? p.priceOre : 0; };
  sel.orderValueOre = (c) => (c.orderValueWeeks || c.plannedWeeks || 0) * sel.priceFor(c.primaryArea, c.startDate || d.today());
  sel.coaches = () => S().users.filter((u) => u.role === 'coach');
  sel.teamLabel = (role) => ({ lead_coach: 'Huvudcoach', vocational_supervisor: 'Yrkesspecifik handledare', employer_matcher: 'Arbetsgivarmatchare', guidance_counselor: 'SYV/metodstöd' }[role] || role);
  sel.statusLabel = (s) => ({ received: 'Mottagen', acknowledged: 'Ordererkänd', confirmed: 'Bekräftad', active: 'Pågår', paused: 'Pausad', closed: 'Avslutad', declined: 'Avböjd' }[s] || s);
  sel.endReasonLabel = (r) => ({ arbete: 'Arbete', studier: 'Studier', avbrott_flytt: 'Avbrott: flytt', avbrott_kommunens_beslut: 'Avbrott: kommunens beslut', avbrott_deltagarens_val: 'Avbrott: deltagarens val', avbrott_ovriga_skal: 'Avbrott: övriga skäl', planerat_utan_resultat: 'Planerat avslut utan resultat' }[r] || '–');
  sel.END_REASONS = ['arbete', 'studier', 'avbrott_flytt', 'avbrott_kommunens_beslut', 'avbrott_deltagarens_val', 'avbrott_ovriga_skal', 'planerat_utan_resultat'];
  sel.eventLabel = (k) => ({
    praktik_startad: 'Praktik/arbetsplatsförlagt moment startat', intervju_arbetsgivarkontakt: 'Anställningsintervju eller konkret arbetsgivarkontakt', arbetserbjudande: 'Arbetserbjudande',
    arbete_paborjat: 'Arbete påbörjat', studier_paborjade: 'Studier påbörjade/antagen', validering_uppnadd: 'Validering/certifiering uppnådd', annat_resultat: 'Annat konkret resultat',
    reell_kompetens: 'Reell kompetens dokumenterad', vagledning_validering: 'Vägledning till formell validering', yrkesbevis: 'Yrkeskompetensbevis/diplom utfärdat',
  }[k] || k);
  sel.EVENT_KINDS = ['praktik_startad', 'intervju_arbetsgivarkontakt', 'arbetserbjudande', 'arbete_paborjat', 'studier_paborjade', 'validering_uppnadd', 'annat_resultat', 'reell_kompetens', 'vagledning_validering', 'yrkesbevis'];
  sel.attLabel = (s) => ({ present: 'Närvarande', late: 'Sen', absent_valid: 'Frånvaro, giltig', absent_invalid: 'Frånvaro, ogiltig' }[s] || 'Ej registrerad');
  sel.ABSENCE_REASONS = ['Sjukdom', 'Vård av barn', 'Myndighetsbesök', 'Annat giltigt skäl'];
  sel.reportKindLabel = (k) => ({ weekly_attendance: 'Veckorapport närvaro', monthly: 'Månadsrapport individ', final: 'Slutrapport', order_confirmation: 'Orderbekräftelse', customer_summary: 'Beställarrapport', skills_certificate: 'Yrkeskompetensbevis', statistics: 'Statistik' }[k] || k);
  sel.reportStatusLabel = (s) => ({ draft: 'Utkast', reviewed: 'Granskad av coach', approved: 'Godkänd', delivered: 'Levererad', opened: 'Kvitterad', waiting: 'Väntar på närvaro' }[s] || s);
  sel.contactLabel = (k) => ({ sms: 'SMS', phone: 'Telefon', email: 'E-post', letter: 'Brev' }[k] || k);

  // ------------------------------------------------------------ Behörighet (motsvarar RLS i SPEC §4)
  /** 'full' | 'team' | 'restricted' | 'billing' | 'customer' | 'none' */
  sel.access = (c, role = MM.role(), pid = MM.currentPersonaId()) => {
    if (!c) return 'none';
    const p = sel.person(c); const prot = !!(p && p.protectedIdentity);
    const inTeam = (c.team || []).some((t) => t.userId === pid);
    switch (role) {
      case 'avtalsansvarig': return 'full';
      case 'samordnare': case 'chef': case 'admin': return prot ? 'restricted' : 'full';
      case 'coach': return c.leadCoachId === pid ? 'full' : inTeam && !prot ? 'team' : 'none';
      case 'handledare': return inTeam && !prot ? 'team' : 'none';
      case 'ekonom': return 'billing';
      case 'kommun_handlaggare': return c.referrerId === pid ? 'customer' : 'none';
      case 'kommun_chef': return prot ? 'restricted' : 'customer';
      default: return 'none';
    }
  };
  sel.canSeeNotes = (c, role = MM.role()) => ['full', 'team'].includes(sel.access(c, role)) && role !== 'ekonom';
  sel.visibleCases = (role = MM.role(), pid = MM.currentPersonaId()) => S().cases.filter((c) => sel.access(c, role, pid) !== 'none');
  /** Namn att visa för rollen: skyddade ärenden och ekonom ser aldrig namn. */
  sel.displayName = (c, role = MM.role()) => {
    const a = sel.access(c, role); const p = sel.person(c);
    if (!p || a === 'none') return '–';
    if (a === 'restricted') return 'Skyddade personuppgifter';
    if (a === 'billing') return '–';
    return `${p.firstName} ${p.lastName}`;
  };

  // ------------------------------------------------------------ Aktiviteter, närvaro
  let idx = null; let idxKey = '';
  /** Index över aktiviteter, närvaro m.m. Nyckeln tar med mutationsräknaren och längderna så att nya poster
   *  syns direkt – även inuti samma åtgärd och under uppspelning. */
  const index = () => {
    const st0 = S();
    const key = `${MM.store.mut}:${st0.activities.length}:${st0.attendance.length}:${st0.checkIns.length}:${st0.monthlyAssessments.length}:${st0.reports.length}`;
    if (idx && idxKey === key) return idx;
    const st = S();
    idx = { actByCase: MM.groupBy(st.activities, (a) => a.caseId), attByAct: {}, ciByCase: MM.groupBy(st.checkIns, (x) => x.caseId), maByCase: MM.groupBy(st.monthlyAssessments, (x) => x.caseId), repByCase: MM.groupBy(st.reports.filter((r) => r.caseId), (r) => r.caseId) };
    for (const a of st.attendance) idx.attByAct[a.activityId] = a;
    idxKey = key; return idx;
  };
  sel.activitiesOf = (caseId) => (index().actByCase[caseId] || []).slice().sort(MM.by('startsAt'));
  sel.attendanceFor = (activityId) => index().attByAct[activityId] || null;
  sel.checkInsOf = (caseId) => (index().ciByCase[caseId] || []).slice().sort(MM.by('heldAt', -1));
  sel.latestCheckIn = (caseId) => sel.checkInsOf(caseId).find((x) => x.status === 'approved') || null;
  sel.assessmentsOf = (caseId) => (index().maByCase[caseId] || []).slice().sort(MM.by('month', -1));
  sel.assessment = (caseId, month) => (index().maByCase[caseId] || []).find((x) => x.month === month) || null;
  sel.reportsOf = (caseId) => (index().repByCase[caseId] || []).slice().sort(MM.by((r) => r.periodEnd || '', -1));
  sel.eventsOf = (caseId) => S().outcomeEvents.filter((e) => e.caseId === caseId).sort(MM.by('occurredOn', -1));
  sel.deviationsOf = (caseId) => S().deviations.filter((e) => e.caseId === caseId).sort(MM.by('createdAt', -1));
  sel.placementsOf = (caseId) => S().placements.filter((e) => e.caseId === caseId);
  sel.messagesOf = (caseId) => S().messages.filter((m) => m.caseId === caseId).sort(MM.by('createdAt'));
  sel.intakeOf = (caseId) => S().intakeAssessments.find((x) => x.caseId === caseId) || null;
  sel.consentOf = (caseId) => S().consents.filter((x) => x.caseId === caseId).sort(MM.by((x) => x.givenAt || x.declinedAt || '', -1))[0] || null;
  sel.planOf = (caseId, month) => S().monthlyPlans.find((x) => x.caseId === caseId && x.month === month) || null;
  sel.historyOf = (caseId) => S().caseStatusHistory.filter((x) => x.caseId === caseId).sort(MM.by('changedAt', -1));

  /** Närvarostatistik för ett ärende (eller alla om caseId saknas) mellan två datum (inklusive). */
  sel.attendanceStats = (caseId, from, to) => {
    const acts = (caseId ? sel.activitiesOf(caseId) : S().activities).filter((a) => a.startsAt.slice(0, 10) >= from && a.startsAt.slice(0, 10) <= to && a.startsAt < d.now());
    const r = { planned: acts.length, present: 0, late: 0, absentValid: 0, absentInvalid: 0, unregistered: 0, reasons: {} };
    for (const a of acts) {
      const at = sel.attendanceFor(a.id);
      if (!at) { r.unregistered++; continue; }
      if (at.status === 'present') r.present++; else if (at.status === 'late') r.late++;
      else if (at.status === 'absent_valid') { r.absentValid++; r.reasons[at.reason] = (r.reasons[at.reason] || 0) + 1; } else r.absentInvalid++;
    }
    const registered = r.planned - r.unregistered;
    r.rate = registered ? (r.present + r.late) / registered : null; // närvarograd = närvarotillfällen / planerade (registrerade) tillfällen
    return r;
  };
  /** Oregistrerade tillfällen (passerade) för coachens ärenden. */
  sel.unregistered = (coachId, from, to) => {
    const out = [];
    for (const c of S().cases.filter((x) => x.leadCoachId === coachId && ['active', 'closed'].includes(x.status))) {
      for (const a of sel.activitiesOf(c.id)) {
        const day = a.startsAt.slice(0, 10);
        if (day < from || day > to || a.startsAt >= d.now()) continue;
        if (!sel.attendanceFor(a.id)) out.push({ activity: a, case: c });
      }
    }
    return out.sort((x, y) => MM.by('startsAt')(x.activity, y.activity));
  };
  /** Upprepad ogiltig frånvaro enligt avtalets regel (standard 2 inom 14 dagar). */
  sel.repeatedAbsence = (caseId) => {
    const rule = MM.cfg().attendance.repeatedAbsenceRule;
    const since = d.addDays(d.today(), -rule.withinDays);
    const inv = sel.activitiesOf(caseId).filter((a) => a.startsAt.slice(0, 10) >= since).map((a) => sel.attendanceFor(a.id)).filter((x) => x && x.status === 'absent_invalid');
    return inv.length >= rule.absentInvalid ? inv : null;
  };

  // ------------------------------------------------------------ Fas och "fastnat"
  sel.phaseSince = (c) => {
    const cis = sel.checkInsOf(c.id).filter((x) => x.status === 'approved').sort(MM.by('heldAt'));
    let since = c.startDate; let cur = null;
    for (const ci of cis) { if (ci.phase !== cur) { cur = ci.phase; since = ci.heldAt.slice(0, 10); } }
    if (cur !== c.phase) since = c.phaseSince || since;
    return since || c.startDate;
  };
  sel.stuck = (c) => {
    if (c.status !== 'active') return null;
    const rule = MM.cfg().stuckRules.find((r) => r.phase === c.phase); if (!rule) return null;
    const days = d.diffDays(sel.phaseSince(c), d.today());
    if (days <= rule.maxDays) return null;
    if (rule.unlessPlacementPlanned && sel.placementsOf(c.id).length) return null;
    return { days, maxDays: rule.maxDays, phase: c.phase };
  };

  // ------------------------------------------------------------ Debitering (SPEC §7.15)
  /** Alla debiterbara ISO-veckor för ärendet: minst en inskriven dag mellan start och avslut, utom pausade veckor. */
  sel.billableWeeks = (c) => {
    if (!c.startDate || c.startDate > d.today()) return [];
    const end = c.endDate || d.addDays(d.monday(d.today()), 6);
    const out = [];
    for (let mon = d.monday(c.startDate); mon <= end; mon = d.addDays(mon, 7)) {
      const w = d.isoWeek(mon); const paused = (c.pausedWeeks || []).includes(w.key);
      const firstDay = c.startDate > mon ? c.startDate : mon; const lastDay = c.endDate && c.endDate < d.addDays(mon, 6) ? c.endDate : d.addDays(mon, 6);
      const acts = sel.activitiesOf(c.id).filter((a) => a.startsAt >= mon && a.startsAt < d.addDays(mon, 7) && a.startsAt < d.now());
      const atts = acts.map((a) => sel.attendanceFor(a.id));
      const attended = atts.filter((x) => x && ['present', 'late'].includes(x.status)).length;
      const registered = atts.filter(Boolean).length;
      out.push({ key: w.key, week: w.week, year: w.year, monday: mon, monthKey: d.weekMonthKey(mon), paused, partial: d.diffDays(firstDay, lastDay) < 6,
        enrolledDays: d.diffDays(firstDay, lastDay) + 1, planned: acts.length, attended, registered, zeroAttendance: !paused && acts.length > 0 && registered === acts.length && attended === 0, missingRegistration: registered < acts.length });
    }
    return out;
  };
  const invStatus = (mk, caseId) => { const m = S().invoiceStatus[mk] || {}; return m[caseId] || m.default || 'draft'; };
  sel.invoiceStatus = invStatus;
  sel.invoiceStatusLabel = (s) => ({ draft: 'Underlag', approved: 'Godkänd', fortnox_created: 'Skapad i Fortnox (ej bokförd)', booked: 'Bokförd', sent: 'Skickad (Peppol)', paid: 'Betald', returned: 'Returnerad av kommunen', manual: 'Manuellt fakturerad', blocked: 'Stoppad' }[s] || s);
  sel.buyerRefProblem = (c) => {
    const ref = c.buyerReference;
    const err = MM.valid.buyerRefError(ref);
    if (err) return err;
    const known = S().buyerReferences.find((b) => b.reference === ref);
    if (known && !known.active) return `Beställarreferensen ${ref} är spärrad. ${known.note || ''}`.trim();
    return null;
  };
  /** Fakturaunderlag för en månad: en faktura per ärende och månad (samlingsfakturor ej tillåtna enligt konfigurationen). */
  sel.billingForMonth = (mk) => {
    const cfg = MM.cfg().billing;
    const approvals = (S().billingApprovals && S().billingApprovals[mk]) || { zeroWeeks: {}, approved: {}, manual: {} };
    const invoices = [];
    for (const c of S().cases) {
      if (!c.startDate) continue;
      const all = sel.billableWeeks(c);
      const weeks = all.filter((w) => w.monthKey === mk && !w.paused);
      const pausedInMonth = all.filter((w) => w.monthKey === mk && w.paused);
      if (!weeks.length) continue;
      const price = sel.priceFor(c.primaryArea, weeks[0].monday);
      const amount = weeks.length * price;
      const orderWeeks = c.orderValueWeeks || c.plannedWeeks; const orderValue = orderWeeks * price;
      const accruedWeeks = all.filter((w) => !w.paused && w.monthKey <= mk).length;
      const accrued = accruedWeeks * price; const remainingWeeks = Math.max(0, orderWeeks - accruedWeeks);
      const checks = [];
      const refProblem = sel.buyerRefProblem(c);
      if (cfg.buyerReference.required && refProblem) checks.push({ kind: 'buyer_ref', severity: 'blocking', label: 'Beställarreferens saknas eller är fel', text: refProblem });
      if (c.purchaseOrderNumber && !MM.valid.poNumber(c.purchaseOrderNumber)) checks.push({ kind: 'po', severity: 'blocking', label: 'Inköpsordernumret har fel format', text: 'Inköpsordernummer ska vara nio siffror som börjar med 99.' });
      for (const w of weeks.filter((x) => x.zeroAttendance)) {
        const key = `${c.id}:${w.key}`;
        checks.push({ kind: 'zero_week', severity: approvals.zeroWeeks[key] ? 'approved' : 'needs_approval', label: `Ingen närvaro ${d.fmtWeekKey(w.key)}`, text: 'Veckan är debiterbar men deltagaren har inte varit närvarande något tillfälle. Kontrollera och godkänn innan fakturering.', weekKey: w.key, approval: approvals.zeroWeeks[key] || null });
      }
      for (const w of weeks.filter((x) => x.missingRegistration)) checks.push({ kind: 'missing_reg', severity: 'warning', label: `Närvaro saknas ${d.fmtWeekKey(w.key)}`, text: 'Alla tillfällen är inte registrerade.' });
      if (weeks.length > 5) checks.push({ kind: 'too_many', severity: 'warning', label: 'Fler än 5 veckor i månaden', text: 'Kontrollera veckornas månadstillhörighet.' });
      if (accruedWeeks > orderWeeks) checks.push({ kind: 'over_order', severity: 'warning', label: 'Fler veckor än beställningen', text: `Beställningen gäller ${fmt.plural(orderWeeks, 'vecka', 'veckor')} men ${fmt.plural(accruedWeeks, 'vecka', 'veckor')} är upparbetade inklusive denna faktura.` });
      const others = S().cases.filter((o) => o.id !== c.id && o.personId === c.personId && o.startDate);
      for (const o of others) { const ow = sel.billableWeeks(o).filter((w) => w.monthKey === mk && !w.paused).map((w) => w.key); const overlap = weeks.filter((w) => ow.includes(w.key)); if (overlap.length) checks.push({ kind: 'overlap', severity: 'warning', label: `Överlappar ${o.number}`, text: `Samma deltagare har ett annat ärende samma vecka (${overlap.map((w) => d.fmtWeekKey(w.key)).join(', ')}). Samma vecka får bara faktureras en gång.` }); }
      if (pausedInMonth.length) checks.push({ kind: 'paused', severity: 'info', label: `Pausad ${pausedInMonth.map((w) => d.fmtWeekKey(w.key)).join(', ')}`, text: 'Pausade veckor debiteras inte.' });
      if (weeks.some((w) => w.partial)) checks.push({ kind: 'partial', severity: 'info', label: 'Delvis vecka', text: 'Start- eller slutveckan är bara delvis, men räknas som debiterbar vecka enligt Botkyrkas besked.' });
      let status = invStatus(mk, c.id);
      if (status === 'draft' && approvals.approved[c.id]) status = 'approved';
      const blocked = checks.some((x) => x.severity === 'blocking');
      const needsApproval = checks.some((x) => x.severity === 'needs_approval');
      const first = weeks[0], last = weeks[weeks.length - 1];
      // Veckotext med luckor för pausade veckor, t.ex. "v. 1, 3–4 2027"
      const runs = []; for (const w of weeks) { const prev = runs[runs.length - 1]; if (prev && d.addDays(prev.last.monday, 7) === w.monday) prev.last = w; else runs.push({ first: w, last: w }); }
      const weekText = `v. ${runs.map((x) => (x.first.key === x.last.key ? `${x.first.week}` : `${x.first.week}–${x.last.week}`)).join(', ')} ${last.year}`;
      const areaItem = sel.priceItem(c.primaryArea, first.monday);
      invoices.push({
        id: `inv-${mk}-${c.id}`, month: mk, caseId: c.id, number: c.number, area: c.primaryArea, weeks, quantity: weeks.length, unitPriceOre: price, amountOre: amount,
        vatRate: areaItem ? areaItem.vatRate : 25, articleNo: areaItem ? areaItem.fortnoxArticleNo : '', buyerReference: c.buyerReference, purchaseOrderNumber: c.purchaseOrderNumber || '',
        orderWeeks, orderValueOre: orderValue, accruedWeeks, accruedOre: accrued, remainingWeeks, remainingOre: Math.max(0, orderValue - accrued),
        checks, blocked, needsApproval, status: blocked && status === 'draft' ? 'blocked' : status, manualInvoiceNo: approvals.manual[c.id] || null,
        fortnoxNo: ['fortnox_created', 'booked', 'sent', 'paid', 'returned'].includes(status) ? String(10000 + (parseInt(c.number.slice(-4), 10) * 7 + Number(mk.slice(5)) * 311) % 89999) : null,
        lineText: `${c.number} · ${weekText}`,
        invoiceText: `Beställning ${c.number}: planerat ${fmt.plural(orderWeeks, 'vecka', 'veckor')}, ${fmt.kr(orderValue)}. Upparbetat inklusive denna faktura: ${fmt.plural(accruedWeeks, 'vecka', 'veckor')}, ${fmt.kr(accrued)}. Återstår: ${fmt.plural(remainingWeeks, 'vecka', 'veckor')}, ${fmt.kr(Math.max(0, orderValue - accrued))}.`,
      });
    }
    invoices.sort(MM.by('number'));
    const total = MM.sum(invoices, (x) => x.amountOre);
    return { month: mk, invoices, totalOre: total, count: invoices.length, blocked: invoices.filter((x) => x.blocked).length, needsApproval: invoices.filter((x) => x.needsApproval).length,
      weeks: MM.sum(invoices, (x) => x.quantity), collectiveAllowed: MM.cfg().billing.collectiveInvoiceAllowed };
  };
  /** Ofakturerade debiterbara veckor äldre än varningsgränsen (preskription två månader efter utfört arbete). */
  sel.unbilledOld = () => {
    const limit = MM.cfg().billing.unbilledWarningDays; const out = [];
    const billed = ['fortnox_created', 'booked', 'sent', 'paid', 'manual'];
    for (const c of S().cases) {
      if (!c.startDate) continue;
      for (const w of sel.billableWeeks(c)) {
        if (w.paused || w.monthKey >= d.monthKey(d.today())) continue;
        const st = invStatus(w.monthKey, c.id);
        if (billed.includes(st)) continue;
        const age = d.diffDays(d.addDays(w.monday, 6), d.today());
        if (age > limit) out.push({ case: c, week: w, age, status: st, amountOre: sel.priceFor(c.primaryArea, w.monday) });
      }
    }
    return out;
  };

  // ------------------------------------------------------------ KPI:er (SPEC §7.12)
  const kpiCfg = (key) => MM.cfg().kpis.find((k) => k.key === key);
  const windowStart = (win) => (win === 'rolling_6m' ? `${d.addMonths(d.monthKey(d.today()), -6)}-01` : win === 'rolling_3m' ? `${d.addMonths(d.monthKey(d.today()), -3)}-01` : MM.contract().startsOn);
  /** Resultatgrad = avslut med (verifierat) resultat / avslut som räknas. */
  sel.resultRate = ({ window = 'rolling_6m', coachId = null, area = null, from = null, to = null } = {}) => {
    const start = from || windowStart(window); const end = to || d.today();
    const closed = S().cases.filter((c) => c.status === 'closed' && c.endDate >= start && c.endDate <= end && (!coachId || c.leadCoachId === coachId) && (!area || c.primaryArea === area));
    const counted = closed.filter((c) => c.resultClass !== 'excluded');
    const verified = counted.filter((c) => c.resultClass === 'result' && c.resultVerifiedAt);
    const prelim = counted.filter((c) => c.resultClass === 'result' && !c.resultVerifiedAt);
    const k = kpiCfg('resultatgrad');
    const value = counted.length ? verified.length / counted.length : null;
    let status = 'ok';
    if (counted.length < k.minN) status = 'insufficient';
    else if (value < k.contractTarget) status = 'below_contract';
    else if (value < k.internalTarget) status = 'below_internal';
    return { value, num: verified.length, den: counted.length, prelim: prelim.length, excluded: closed.length - counted.length, closed: closed.length, status, minN: k.minN, contractTarget: k.contractTarget, internalTarget: k.internalTarget };
  };
  /** Prognos: om deltagare med arbetserbjudande eller i fas 5 når resultat. */
  sel.resultForecast = () => {
    const base = sel.resultRate({ window: 'rolling_6m' });
    const candidates = S().cases.filter((c) => c.status === 'active' && (c.phase === 5 || S().outcomeEvents.some((e) => e.caseId === c.id && e.kind === 'arbetserbjudande')));
    const withOffer = candidates.filter((c) => S().outcomeEvents.some((e) => e.caseId === c.id && e.kind === 'arbetserbjudande'));
    const value = (base.num + base.prelim + candidates.length) / (base.den + candidates.length);
    const offerOnly = (base.num + base.prelim + withOffer.length) / (base.den + withOffer.length);
    return { value, candidates: candidates.length, withOffer: withOffer.length, offerOnly, prelim: base.prelim };
  };
  sel.resultTrend = () => {
    const out = [];
    for (let mk = d.monthKey(MM.contract().startsOn); mk < d.monthKey(d.today()); mk = d.addMonths(mk, 1)) {
      const r = sel.resultRate({ from: `${mk}-01`, to: d.monthEnd(mk) });
      const cum = sel.resultRate({ from: MM.contract().startsOn, to: d.monthEnd(mk) });
      out.push({ month: mk, ...r, cumulative: cum.value, cumulativeN: cum.den });
    }
    return out;
  };
  const monthCases = (mk) => S().cases.filter((c) => d.monthKey(c.referredAt) === mk);
  sel.kpiValue = (key, { month = d.addMonths(d.monthKey(d.today()), -1), coachId = null } = {}) => {
    const cfg = MM.cfg();
    const k = kpiCfg(key); const target = k.internalTarget;
    const wrap = (num, den, extra = {}) => { const value = den ? num / den : null; const unset = MM.isUnset(target); return { key, label: k.label, value, num, den, target: unset ? null : target, targetUnset: unset, status: den === 0 ? 'no_data' : unset ? 'no_target' : value < target ? 'below_internal' : 'ok', ...extra }; };
    if (key === 'avrop_besvarade_i_tid') { const cs = monthCases(month).filter((c) => c.confirmedAt || c.declinedAt); return wrap(cs.filter((c) => (c.confirmedAt || c.declinedAt) <= sel.avropDue(c)).length, cs.length, { late: cs.filter((c) => (c.confirmedAt || c.declinedAt) > sel.avropDue(c)) }); }
    if (key === 'forsta_mote_inom_en_vecka') { const days = cfg.sla.find((s) => s.key === 'forsta_mote').within.days; const cs = monthCases(month).filter((c) => c.firstMeetingAt); return wrap(cs.filter((c) => c.firstMeetingAt <= d.addDays(c.referredAt, days)).length, cs.length, { late: cs.filter((c) => c.firstMeetingAt > d.addDays(c.referredAt, days)) }); }
    if (key === 'veckorapporter_i_tid') { const rs = S().reports.filter((r) => r.kind === 'weekly_attendance' && d.monthKey(r.dueAt) === month && r.dueAt < d.now()); return wrap(rs.filter((r) => r.deliveredAt && r.deliveredAt <= r.dueAt).length, rs.length); }
    if (key === 'manadsrapporter_i_tid') { const rs = S().reports.filter((r) => r.kind === 'monthly' && d.monthKey(r.dueAt) === month && r.dueAt < d.now()); return wrap(rs.filter((r) => r.deliveredAt && r.deliveredAt <= r.dueAt).length, rs.length, { provisional: true }); }
    if (key === 'narvarograd') { const st = sel.attendanceStats(null, `${month}-01`, d.monthEnd(month)); return wrap(st.present + st.late, st.planned - st.unregistered, { absentValid: st.absentValid, absentInvalid: st.absentInvalid }); }
    if (key === 'nojdhet') { const from = windowStart('rolling_3m'); const rs = S().pulseResponses.filter((x) => x.submittedAt >= from && (!coachId || x.coachId === coachId)); return wrap(rs.filter((x) => x.answers.q1 >= 4).length, rs.length, { minN: cfg.pulse.minNForAggregate }); }
    if (key === 'resultatgrad') { const r = sel.resultRate({ window: 'rolling_6m', coachId }); return { key, label: k.label, value: r.value, num: r.num, den: r.den, target: k.internalTarget, contractTarget: k.contractTarget, status: r.status, prelim: r.prelim }; }
    return null;
  };
  sel.kpis = (opts = {}) => MM.cfg().kpis.map((k) => sel.kpiValue(k.key, opts)).filter(Boolean);

  // ------------------------------------------------------------ Puls
  sel.pulseStats = ({ from = windowStart('rolling_3m'), to = null, coachId = null } = {}) => {
    const end = to ? `${to}T23:59` : '9999';
    const inv = S().pulseInvites.filter((x) => x.sentAt >= from && x.sentAt <= end && !x.demo && (!coachId || (sel.caseById(x.caseId) || {}).leadCoachId === coachId));
    const rs = S().pulseResponses.filter((x) => x.submittedAt >= from && x.submittedAt <= end && (!coachId || x.coachId === coachId));
    const dist = (q) => [1, 2, 3, 4, 5].map((v) => rs.filter((x) => x.answers[q] === v).length);
    const share45 = (q) => (rs.length ? rs.filter((x) => x.answers[q] >= 4).length / rs.length : null);
    const q4 = MM.groupBy(rs, (x) => x.answers.q4);
    return { invites: inv.length, responses: rs.length, responseRate: inv.length ? rs.filter((x) => inv.some((i) => i.id === x.inviteId)).length / inv.length : null, q1: dist('q1'), q2: dist('q2'), q3: dist('q3'),
      satisfaction: share45('q1'), closer: share45('q2'), support: share45('q3'), priorities: Object.fromEntries(Object.entries(q4).map(([k2, v]) => [k2, v.length])),
      enough: rs.length >= MM.cfg().pulse.minNForAggregate, minN: MM.cfg().pulse.minNForAggregate };
  };

  // ------------------------------------------------------------ SLA och deadlines (SPEC §7.13)
  /** { label, tone: 'ok'|'soon'|'urgent'|'over'|'met', minutes } */
  sel.slaStatus = (dueAt, metAt = null) => {
    if (metAt) return { label: metAt <= dueAt ? 'I tid' : `Sent (${d.relative(metAt, dueAt).replace('om ', '')})`, tone: metAt <= dueAt ? 'met' : 'over', minutes: 0 };
    const mins = d.diffMinutes(d.now(), dueAt);
    if (mins < 0) return { label: `Försenad ${d.relative(dueAt).replace('för ', '').replace(' sedan', '')}`, tone: 'over', minutes: mins };
    if (mins <= 120) return { label: `${d.relative(dueAt).replace('om ', '')} kvar`, tone: 'urgent', minutes: mins };
    if (mins <= 60 * 8) return { label: `${d.relative(dueAt).replace('om ', '')} kvar`, tone: 'soon', minutes: mins };
    return { label: `Senast ${d.fmtDateTime(dueAt)}`, tone: 'ok', minutes: mins };
  };
  sel.avropDue = (c) => d.addWorkingDays(c.referredAt, MM.cfg().sla.find((x) => x.key === 'avrop_svar').within.workingDays);
  sel.finalReportWorkingDays = () => MM.cfg().sla.find((x) => x.key === 'slutrapport').proposal.workingDays;
  sel.firstMeetingDue = (c) => d.addDays(c.referredAt, MM.cfg().sla.find((s) => s.key === 'forsta_mote').within.days);
  /** Ärenden som väntar på svar (acceptera/avböj) oavsett kanal – mejl, portal eller telefon. */
  sel.awaitingAnswer = () => S().cases.filter((c) => ['acknowledged', 'received'].includes(c.status));
  sel.inbox = () => S().inboundEmails.filter((e) => ['acknowledged', 'protected', 'other', 'linked', 'received'].includes(e.status)).sort(MM.by('receivedAt'));

  /** Deadlines inom ett antal dagar. Filtrera med role/personaId för "mina". */
  sel.deadlines = ({ days = 7, coachId = null, includeMet = false } = {}) => {
    const now = d.now(); const limit = `${d.addDays(d.today(), days)}T23:59`; const out = [];
    const push = (x) => { if (x.dueAt <= limit || x.dueAt < now) out.push(x); };
    for (const c of S().cases) {
      if (coachId && c.leadCoachId !== coachId) continue;
      if (['acknowledged', 'received'].includes(c.status)) push({ id: `avrop:${c.id}`, kind: 'avrop_svar', label: 'Svar på avrop (acceptera eller avböj)', dueAt: sel.avropDue(c), caseId: c.id, owner: 'samordnare', link: { view: 'sam.inkorg', params: { caseId: c.id } } });
      if (c.status === 'confirmed' && !c.firstMeetingAt) push({ id: `fm:${c.id}`, kind: 'forsta_mote', label: 'Första möte ska vara bokat', dueAt: `${d.dayOf(sel.firstMeetingDue(c))}T${d.timeOf(c.referredAt)}`, caseId: c.id, owner: 'samordnare', link: { view: 'arende.kort', params: { caseId: c.id } } });
    }
    // Närvaroregistrering för förra veckan – måndag 10.00
    const lastMon = d.addDays(d.monday(d.today()), -7);
    const regDue = `${d.monday(d.today())}T${MM.cfg().sla.find((s) => s.key === 'veckorapport_registrering').time}`;
    for (const coach of sel.coaches()) {
      if (coachId && coach.id !== coachId) continue;
      const missing = sel.unregistered(coach.id, lastMon, d.addDays(lastMon, 6));
      if (missing.length || includeMet) push({ id: `reg:${coach.id}`, kind: 'veckorapport_registrering', label: `Närvaro vecka ${d.isoWeek(lastMon).week}: ${missing.length} tillfällen ej registrerade`, dueAt: regDue, ownerId: coach.id, count: missing.length, link: { view: 'coach.narvaro', params: { week: 'last' } } });
    }
    for (const r of S().reports) {
      if (['delivered', 'opened'].includes(r.status) && !includeMet) continue;
      const c = r.caseId ? sel.caseById(r.caseId) : null;
      if (coachId && (!c || c.leadCoachId !== coachId)) continue;
      if (!r.dueAt) continue;
      if (r.kind === 'weekly_attendance') push({ id: `rep:${r.id}`, kind: 'veckorapport_publicering', label: `Veckorapport ${d.fmtWeekKey(r.week)} till ${MM.personName(r.recipientUserId)}`, dueAt: r.dueAt, reportId: r.id, owner: 'samordnare', link: { view: 'rapport.visa', params: { reportId: r.id } } });
      if (r.kind === 'monthly') push({ id: `rep:${r.id}`, kind: 'manadsrapport', label: `Månadsrapport ${d.monthName(r.month)}`, dueAt: r.dueAt, reportId: r.id, caseId: r.caseId, provisional: true, link: { view: 'rapport.visa', params: { reportId: r.id } } });
      if (r.kind === 'final') push({ id: `rep:${r.id}`, kind: 'slutrapport', label: 'Slutrapport', dueAt: r.dueAt, reportId: r.id, caseId: r.caseId, provisional: true, link: { view: 'rapport.visa', params: { reportId: r.id } } });
      if (r.kind === 'customer_summary') push({ id: `rep:${r.id}`, kind: 'bestallarrapport', label: `Beställarrapport ${d.monthName(r.month)}`, dueAt: r.dueAt, reportId: r.id, owner: 'avtalsansvarig', provisional: true, link: { view: 'rapport.visa', params: { reportId: r.id } } });
    }
    if (!coachId) {
      for (const cd of S().contractDeviations.filter((x) => x.status !== 'closed' && x.actionPlanDue)) push({ id: `cd:${cd.id}`, kind: 'atgardsplan', label: `Åtgärdsplan: ${cd.description.slice(0, 60)}…`, dueAt: `${cd.actionPlanDue}T${S().orgConfig.alerts.followUpDueTime}`, owner: 'avtalsansvarig', link: { view: 'chef.avvikelser', params: { id: cd.id } } });
      const run = S().billingRuns.find((b) => b.status === 'draft');
      if (run) push({ id: `bill:${run.month}`, kind: 'fakturering', label: `Fakturor för ${d.monthName(run.month)} i Fortnox (internt mål: ${S().orgConfig.billing.fortnoxWithinWorkingDays} arbetsdagar)`, dueAt: `${d.nthWorkingDay(d.addMonths(run.month, 1), S().orgConfig.billing.fortnoxWithinWorkingDays)}T16:00`, owner: 'ekonom', link: { view: 'eko.korning', params: { month: run.month } } });
    }
    for (const dv of S().deviations.filter((x) => x.status === 'open' && x.followUpOn)) {
      const c = sel.caseById(dv.caseId); if (coachId && (!c || c.leadCoachId !== coachId)) continue;
      push({ id: `dev:${dv.id}`, kind: 'avvikelse_uppfoljning', label: `Uppföljning av avvikelse: ${dv.description}`, dueAt: `${dv.followUpOn}T${S().orgConfig.alerts.followUpDueTime}`, caseId: dv.caseId, ownerId: dv.ownerId, link: { view: 'arende.kort', params: { caseId: dv.caseId, tab: 'avvikelser' } } });
    }
    for (const x of out) { x.sla = sel.slaStatus(x.dueAt); x.bucket = x.dueAt < now ? 'overdue' : d.dayOf(x.dueAt) === d.today() ? 'today' : 'week'; }
    return out.sort(MM.by('dueAt'));
  };

  // ------------------------------------------------------------ Flaggor (beräknade, kvitteras med kort åtgärdsplan)
  sel.alerts = ({ role = MM.role(), personaId = MM.currentPersonaId(), includeAcked = false } = {}) => {
    const st = S(); const out = [];
    const add = (a) => { const ack = st.alertAcks[a.key] || null; if (!ack || includeAcked) out.push({ ...a, ack }); };
    const rr = sel.resultRate({ window: 'rolling_6m' });
    const k = kpiCfg('resultatgrad');
    if (rr.status === 'below_contract') add({ key: 'kpi:resultatgrad:contract', kind: 'kpi', severity: 'critical', title: 'Åtgärd krävs: resultatgrad under avtalsmålet', text: `Resultatgraden är ${fmt.pct(rr.value)} (rullande 6 mån, ${rr.num} av ${rr.den}). Avtalsmålet är ${fmt.pct(k.contractTarget, 0)}.`, roles: k.notify.belowContract.map((x) => (x === 'controller' ? 'chef' : x)), createdAt: `${d.today()}T06:00`, link: { view: 'chef.oversikt', params: {} } });
    else if (rr.status === 'below_internal') add({ key: 'kpi:resultatgrad:internal', kind: 'kpi', severity: 'warning', title: 'Bevaka: resultatgrad under internt mål', text: `Resultatgraden är ${fmt.pct(rr.value)} (rullande 6 mån, ${rr.num} av ${rr.den}). Internt mål ${fmt.pct(k.internalTarget, 0)}, avtalsmål ${fmt.pct(k.contractTarget, 0)}.`, roles: k.notify.belowInternal.map((x) => (x === 'controller' ? 'chef' : x)), createdAt: `${d.today()}T06:00`, link: { view: 'chef.oversikt', params: {} } });
    const lastMonth = d.addMonths(d.monthKey(d.today()), -1);
    for (const key of ['avrop_besvarade_i_tid', 'forsta_mote_inom_en_vecka', 'veckorapporter_i_tid', 'manadsrapporter_i_tid']) {
      const v = sel.kpiValue(key, { month: lastMonth });
      if (v && v.status === 'below_internal') add({ key: `kpi:${key}:${lastMonth}`, kind: 'kpi', severity: 'warning', title: `Bevaka: ${v.label.toLowerCase()} ${d.monthName(lastMonth)}`, text: `${fmt.pct(v.value)} (${v.num} av ${v.den}). Internt mål ${fmt.pct(v.target, 0)}.`, roles: ['chef', 'samordnare', 'avtalsansvarig'], createdAt: `${d.today()}T06:00`, link: { view: 'chef.oversikt', params: {} } });
    }
    for (const c of st.cases) {
      if (c.status === 'active') {
        const s = sel.stuck(c);
        if (s) add({ key: `stuck:${c.id}:${c.phase}`, kind: 'stuck', severity: 'warning', title: `Fastnat i fas ${c.phase}`, text: `${c.number} har varit i fas ${c.phase} (${sel.phaseName(c.phase)}) i ${s.days} dagar. Gräns: ${s.maxDays} dagar.`, caseId: c.id, roles: ['coach', 'samordnare'], coachId: c.leadCoachId, createdAt: `${d.today()}T06:00`, link: { view: 'arende.kort', params: { caseId: c.id } } });
        const ra = sel.repeatedAbsence(c.id);
        if (ra) add({ key: `absence:${c.id}:${ra[ra.length - 1].id}`, kind: 'absence', severity: 'warning', title: 'Upprepad ogiltig frånvaro', text: `${c.number}: ${ra.length} ogiltiga frånvarotillfällen inom ${MM.cfg().attendance.repeatedAbsenceRule.withinDays} dagar. Förslag: åtgärdsplan och uppföljningsmöte med handläggaren.`, caseId: c.id, roles: ['coach', 'samordnare'], coachId: c.leadCoachId, createdAt: ra[ra.length - 1].registeredAt, link: { view: 'arende.kort', params: { caseId: c.id, tab: 'narvaro' } } });
      }
      if (c.status === 'confirmed' && !c.firstMeetingAt && d.diffDays(c.referredAt, d.today()) >= st.orgConfig.alerts.firstMeetingNotBookedAfterDays) add({ key: `nomeeting:${c.id}`, kind: 'first_meeting', severity: 'critical', title: 'Första möte inte bokat', text: `${c.number} mottogs ${d.fmtDate(c.referredAt)}. Mötet ska vara bokat inom en vecka (senast ${d.fmtDateTime(sel.firstMeetingDue(c))}).`, caseId: c.id, roles: ['samordnare', 'coach'], coachId: c.leadCoachId, createdAt: `${d.addDays(c.referredAt.slice(0, 10), st.orgConfig.alerts.firstMeetingNotBookedAfterDays)}T08:00`, link: { view: 'arende.kort', params: { caseId: c.id } } });
    }
    for (const w of sel.progressionWatch()) {
      const c = w.case;
      if (w.level === 'escalated') add({ key: `noprog_esc:${c.id}:${w.lastWeek}`, kind: 'no_progress_escalated', severity: 'warning', title: `${w.streak} veckor i rad utan progression`, text: `${c.number} (coach ${MM.personName(c.leadCoachId)}): ${w.weeks.filter((x) => !x.progress).map((x) => `${d.fmtWeekKey(x.key)} – ${x.reason}`).join('; ')}. Coachen har fått påminnelser men ser inte att detta har eskalerats.`, caseId: c.id, roles: sel.orgRules().progressionWatch.escalateTo, createdAt: `${d.monday(d.today())}T08:00`, link: { view: 'arende.kort', params: { caseId: c.id } } });
      add({ key: `noprog:${c.id}:${w.lastWeek}`, kind: 'no_progress', severity: 'info', title: 'Påminnelse: ingen progression förra veckan', text: `${c.number}: ${w.weeks[w.weeks.length - 1].reason}. Planera nästa steg och dokumentera i veckoavstämningen.`, caseId: c.id, roles: ['coach'], coachId: c.leadCoachId, createdAt: `${d.monday(d.today())}T08:00`, link: { view: 'coach.avstamning', params: { caseId: c.id } } });
    }
    for (const r of st.reports.filter((x) => ['final', 'monthly'].includes(x.kind) && !['delivered', 'opened'].includes(x.status) && x.dueAt < d.now())) {
      const c = sel.caseById(r.caseId);
      add({ key: `overdue:${r.id}`, kind: 'report_overdue', severity: 'critical', title: `${sel.reportKindLabel(r.kind)} försenad`, text: `${c.number}: förföll ${d.fmtDateTime(r.dueAt)}. Vitesrisk vid bristfällig löpande information.`, caseId: c.id, roles: ['coach', 'samordnare', 'chef'], coachId: c.leadCoachId, createdAt: r.dueAt, link: { view: 'rapport.visa', params: { reportId: r.id } } });
    }
    const ub = sel.unbilledOld();
    for (const [caseId, rows] of Object.entries(MM.groupBy(ub, (x) => x.case.id))) {
      const c = sel.caseById(caseId);
      add({ key: `unbilled:${caseId}`, kind: 'unbilled', severity: 'critical', title: `Ofakturerade veckor äldre än ${MM.cfg().billing.unbilledWarningDays} dagar`, text: `${c.number}: ${rows.length} veckor (${fmt.kr(MM.sum(rows, (x) => x.amountOre))}). Preskription två månader efter utfört arbete.`, caseId, roles: ['ekonom', 'chef'], createdAt: `${d.today()}T06:00`, link: { view: 'eko.start', params: {} } });
    }
    for (const x of st.pulseResponses.filter((p) => p.contactRequested)) add({ key: `pulse_contact:${x.id}`, kind: 'pulse_contact', severity: 'info', title: 'Deltagare vill bli kontaktad', text: `Svar i pulsmätningen ${d.fmtDate(x.submittedAt)} (${(sel.caseById(x.caseId) || {}).number}). Samordnaren avgör vem som tar kontakten.`, caseId: x.caseId, roles: ['samordnare'], createdAt: x.submittedAt, link: { view: 'arende.kort', params: { caseId: x.caseId } } });
    for (const x of st.pulseResponses.filter((p) => p.answers.q3 <= 2 && p.submittedAt >= '2027-01-01')) add({ key: `pulse_low:${x.id}`, kind: 'pulse_low', severity: 'warning', title: 'Lågt betyg på stödet från coachen', text: `Ett svar ${d.fmtDate(x.submittedAt)} gav ${x.answers.q3} av 5 på frågan om stöd från coachen. Går till chef, inte till coachen.`, roles: ['chef'], createdAt: x.submittedAt, link: { view: 'chef.oversikt', params: { tab: 'puls' } } });
    for (const e of st.inboundEmails.filter((m) => m.status === 'protected')) add({ key: `protected:${e.id}`, kind: 'protected_order', severity: 'critical', title: 'Avrop med skyddade personuppgifter', text: `Mejl från ${e.fromName} ${d.fmtDateTime(e.receivedAt)}. Bara generisk mottagningsbekräftelse skickad. Ring handläggaren enligt den säkra rutinen.`, roles: ['avtalsansvarig', 'samordnare'], createdAt: e.receivedAt, link: { view: 'sam.inkorg', params: { emailId: e.id } } });
    for (const ci of st.checkIns.filter((x) => x.status === 'draft' && x.ai)) { const c = sel.caseById(ci.caseId); add({ key: `ai_draft:${ci.id}`, kind: 'ai_draft', severity: 'info', title: 'AI-utkast att granska', text: `Avstämning ${d.fmtDateTime(ci.heldAt)} (${c.number}). Råtranskriptet raderas senast ${d.fmtDate(ci.ai.rawTranscriptDeleteBy)}.`, caseId: c.id, roles: ['coach'], coachId: c.leadCoachId, createdAt: d.addMinutes(ci.heldAt, 48), link: { view: 'coach.avstamning', params: { caseId: c.id, checkInId: ci.id } } }); }
    const roleKey = role === 'avtalsansvarig' ? ['avtalsansvarig', 'samordnare'] : [role];
    return out.filter((a) => a.roles.some((r) => roleKey.includes(r)) && (role !== 'coach' || !a.coachId || a.coachId === personaId))
      .sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]) || (a.createdAt < b.createdAt ? 1 : -1));
  };

  // ------------------------------------------------------------ Veckorapport och beställarrapport
  /** Veckorapport närvaro: en per handläggare och vecka, en sektion per deltagare. */
  sel.weeklyReport = (recipientId, weekKey) => {
    const mon = d.weekMonday(weekKey); const sun = d.addDays(mon, 6);
    const cases = S().cases.filter((c) => c.referrerId === recipientId && c.startDate && c.startDate <= sun && (!c.endDate || c.endDate >= mon));
    const sections = cases.map((c) => {
      const acts = sel.activitiesOf(c.id).filter((a) => a.startsAt >= mon && a.startsAt <= `${sun}T23:59`);
      const rows = acts.map((a) => ({ activity: a, att: sel.attendanceFor(a.id) }));
      const st = sel.attendanceStats(c.id, mon, sun);
      const devs = S().deviations.filter((x) => x.caseId === c.id && x.createdAt.slice(0, 10) >= mon && x.createdAt.slice(0, 10) <= sun);
      return { case: c, rows, stats: st, paused: (c.pausedWeeks || []).includes(weekKey), deviations: devs, risk: st.absentInvalid >= 2 ? 'Risk för avbrott – uppföljningsmöte föreslås' : st.absentInvalid === 1 ? 'Bevakas' : 'Ingen risk noterad' };
    });
    return { recipientId, weekKey, monday: mon, sunday: sun, sections, complete: sections.every((s) => s.stats.unregistered === 0) };
  };
  /** Beställarrapport (kommunens chef): grupper under minN redovisas som "färre än 5". Internt mål visas aldrig. */
  /** Tar bort det interna målet ur resultat som ska till kunden (det får aldrig visas i kundens perspektiv). */
  const strip = (r) => { const { internalTarget, status, ...rest } = r; return { ...rest, status: status === 'below_internal' ? 'ok' : status }; };
  sel.customerSummary = (mk) => {
    const minN = MM.cfg().pulse.minNForAggregate;
    const start = `${mk}-01`, end = d.monthEnd(mk);
    const all = S().cases.filter((c) => c.startDate);
    const active = all.filter((c) => c.startDate <= end && (!c.endDate || c.endDate >= start));
    const started = all.filter((c) => c.startDate >= start && c.startDate <= end);
    const closed = all.filter((c) => c.status === 'closed' && c.endDate >= start && c.endDate <= end);
    const byArea = Object.entries(MM.groupBy(active, (c) => c.primaryArea)).map(([code, cs]) => ({ code, name: sel.areaName(code), active: cs.length, started: cs.filter((c) => started.includes(c)).length, closed: cs.filter((c) => closed.includes(c)).length })).sort(MM.by('code'));
    const byTrack = Object.entries(MM.groupBy(active, (c) => c.vocationalTrack)).map(([t, cs]) => ({ track: t, active: cs.length })).sort(MM.by('active', -1));
    const mas = S().monthlyAssessments.filter((m) => m.month === mk && m.status === 'approved');
    const clear = mas.filter((m) => Object.values(m.areas).some((a) => a.level >= 2)).length;
    const any = mas.filter((m) => Object.values(m.areas).some((a) => a.level >= 1)).length;
    const areaDist = MM.cfg().progression.areas.map((key) => ({ key, label: MM.cfg().progression.areaLabels[key], clear: mas.filter((m) => (m.areas[key] || {}).level >= 2).length, n: mas.length }));
    const att = sel.attendanceStats(null, start, end);
    const pulse = sel.pulseStats({ from: `${d.addMonths(mk, -2)}-01`, to: end });
    const k = kpiCfg('resultatgrad');
    return {
      month: mk, minN, active: active.length, started: started.length, closed: closed.length, byArea, byTrack,
      result: { rolling: strip(sel.resultRate({ window: 'rolling_6m', to: end })), sinceStart: strip(sel.resultRate({ from: MM.contract().startsOn, to: end })), month: strip(sel.resultRate({ from: start, to: end })), contractTarget: k.contractTarget },
      progression: { assessed: mas.length, clear, any, areaDist }, attendanceRate: att.rate, attendance: att,
      deviations: S().deviations.filter((x) => x.createdAt.slice(0, 10) >= start && x.createdAt.slice(0, 10) <= end).length,
      contractDeviations: S().contractDeviations.filter((x) => x.raisedAt.slice(0, 10) >= start && x.raisedAt.slice(0, 10) <= end).length,
      pulse, seesSlaStats: MM.cfg().customerVisibility.seesSlaStats,
      small: (n) => (n > 0 && n < minN ? 'färre än 5' : String(n)),
    };
  };

  // ------------------------------------------------------------ Ärendenummer
  /** Nästa ärendenummer {prefix}-{ÅÅ}-{NNNN}. Löpnummer per avtal och år, återanvänds aldrig. */
  const nextCaseNumber = (st, contractId, day) => {
    const c = st.contracts.find((x) => x.id === contractId); const year = day.slice(0, 4); const key = `${contractId}:${year}`;
    st.caseCounters[key] = (st.caseCounters[key] || 0) + 1;
    return `${c.config.casePrefix}-${year.slice(2)}-${String(st.caseCounters[key]).padStart(4, '0')}`;
  };
  sel.previewNextCaseNumber = () => { const st = S(); const year = d.today().slice(0, 4); return `${MM.cfg().casePrefix}-${year.slice(2)}-${String((st.caseCounters[`c-bot:${year}`] || 0) + 1).padStart(4, '0')}`; };
  sel.duplicateActive = (pnr) => { const p = S().persons.filter((x) => x.pnr.replace(/\D/g, '').slice(-10) === String(pnr || '').replace(/\D/g, '').slice(-10)); return S().cases.filter((c) => p.some((x) => x.id === c.personId) && ['received', 'acknowledged', 'confirmed', 'active', 'paused'].includes(c.status)); };
  sel.ackText = (c) => {
    const due = sel.avropDue(c);
    return `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${c.number}. Ni får besked om startdatum och ansvarig coach senast ${d.fmtDateTimeLong(due)}. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`;
  };

  // ------------------------------------------------------------ Progressionsbevakning och notiser (interna regler, S().orgConfig)
  sel.orgRules = () => S().orgConfig.notifications;
  /** Progression en viss vecka: godkänd avstämning med veckomålet Ja/Delvis. Pausad vecka och startveckan räknas inte. */
  sel.weekProgress = (c, weekKey) => {
    const mon = d.weekMonday(weekKey); const sun = d.addDays(mon, 6);
    if (!c.startDate || c.startDate > sun || (c.endDate && c.endDate < mon)) return null;
    if ((c.pausedWeeks || []).includes(weekKey)) return { key: weekKey, progress: null, reason: 'Pausad' };
    if (d.monday(c.startDate) === mon) return { key: weekKey, progress: null, reason: 'Startvecka' };
    const cis = sel.checkInsOf(c.id).filter((x) => x.heldAt >= mon && x.heldAt <= `${sun}T23:59`);
    const approved = cis.filter((x) => x.status === 'approved');
    if (approved.some((x) => ['yes', 'partly'].includes(x.goalStatus))) return { key: weekKey, progress: true, reason: 'Veckomålet uppnått helt eller delvis' };
    if (approved.some((x) => x.goalStatus === 'no')) return { key: weekKey, progress: false, reason: 'Veckomålet inte uppnått' };
    if (cis.length) return { key: weekKey, progress: false, reason: 'Avstämningen är inte godkänd' };
    return { key: weekKey, progress: false, reason: 'Ingen avstämning dokumenterad' };
  };
  /** Antal veckor i rad utan progression, räknat bakåt från senaste avslutade vecka. */
  sel.noProgressStreak = (c) => {
    const weeks = []; let mon = d.addDays(d.monday(d.today()), -7);
    for (let i = 0; i < 8; i++, mon = d.addDays(mon, -7)) {
      const wp = sel.weekProgress(c, d.isoWeek(mon).key);
      if (!wp || wp.progress === true) break;
      if (wp.progress === null) { if (wp.reason === 'Startvecka') break; continue; }
      weeks.unshift(wp);
    }
    return { streak: weeks.length, weeks };
  };
  /** Ärenden som ska påminnas (coach) eller eskaleras (chef/controller) enligt interna regler. */
  sel.progressionWatch = ({ coachId = null } = {}) => {
    const rule = sel.orgRules().progressionWatch; const out = [];
    for (const c of S().cases.filter((x) => x.status === 'active' && (!coachId || x.leadCoachId === coachId))) {
      const { streak, weeks } = sel.noProgressStreak(c);
      if (streak < rule.remindCoachAfterWeeks) continue;
      out.push({ case: c, streak, weeks, lastWeek: weeks[weeks.length - 1].key, level: streak >= rule.escalateAfterConsecutiveWeeks ? 'escalated' : 'reminder' });
    }
    return out.sort((a, b) => b.streak - a.streak);
  };
  /** Personliga notiser för en mottagare. Varje notis har exakt en mottagare – ingen ser andras notiser.
   *  Coachen får påminnelser. Eskaleringar går bara till rollerna i escalateTo och syns aldrig för coachen. */
  sel.notificationsFor = (personaId = MM.currentPersonaId(), role = MM.role()) => {
    if (!personaId) return [];
    const st = S(); const rule = sel.orgRules().progressionWatch; const read = st.notifRead[personaId] || {};
    const out = st.userNotifications.filter((n) => n.recipientId === personaId).map((n) => ({ ...n }));
    const monday8 = `${d.monday(d.today())}T08:00`;
    if (role === 'coach' || role === 'handledare') {
      for (const w of sel.progressionWatch({ coachId: personaId })) {
        const last = w.weeks[w.weeks.length - 1];
        out.push({ id: `nprog:${w.case.id}:${w.lastWeek}`, recipientId: personaId, kind: 'progress_reminder', caseId: w.case.id, createdAt: monday8, channels: rule.channels, computed: true,
          title: w.streak >= 2 ? `Påminnelse: ingen progression ${w.streak} veckor i rad` : 'Påminnelse: ingen progression förra veckan',
          body: `${w.case.number}: ${last.reason} (${d.fmtWeekKey(last.key)}). Planera nästa steg och dokumentera i veckoavstämningen.`,
          emailBody: `Påminnelse från Miljonmatch: ett av dina ärenden (${w.case.number}) saknar dokumenterad progression. Logga in för att se vilket steg som behövs.` });
      }
    }
    if (rule.escalateTo.includes(role)) {
      for (const w of sel.progressionWatch().filter((x) => x.level === 'escalated')) {
        out.push({ id: `nesc:${w.case.id}:${w.lastWeek}`, recipientId: personaId, kind: 'progress_escalation', caseId: w.case.id, createdAt: monday8, channels: rule.channels, computed: true,
          title: `Eskalering: ${w.streak} veckor i rad utan progression`,
          body: `${w.case.number} · coach ${MM.personName(w.case.leadCoachId)} · ${w.weeks.map((x) => `${d.fmtWeekKey(x.key)}: ${x.reason}`).join(' · ')}.`,
          emailBody: `Eskalering i Miljonmatch: ett ärende (${w.case.number}) har ${w.streak} veckor i rad utan progression. Logga in för att se detaljerna.`, visibleToCoach: rule.escalationVisibleToCoach });
      }
    }
    return out.map((n) => ({ ...n, readAt: read[n.id] || null })).sort(MM.by('createdAt', -1));
  };
  sel.unreadNotifications = (personaId, role) => sel.notificationsFor(personaId, role).filter((n) => !n.readAt).length;

  // ============================================================ Gemensamma åtgärder
  const A = MM.defineAction;
  const findCase = (st, id) => st.cases.find((c) => c.id === id);
  const customerEmail = (st, id) => (st.customerUsers.find((u) => u.id === id) || {}).email || '';
  /** "Behöver beslut/stöd från kommunen" – skapar en uppgift till beställande handläggare och en notis utan personuppgifter. */
  const customerDecisionTask = (st, ctx, dv) => {
    const c = st.cases.find((x) => x.id === dv.caseId); if (!c || st.tasks.some((t) => t.deviationId === dv.id)) return;
    st.tasks.push({ id: ctx.id('task'), toRole: 'kommun_handlaggare', toId: c.referrerId, fromId: ctx.actorId, createdAt: ctx.now, status: 'open', kind: 'customer_decision', caseIds: [c.id], deviationId: dv.id,
      text: `Miljonbemanning behöver ert beslut eller stöd i ärende ${c.number}: ${dv.description}. Läs mer och svara under ärendets meddelanden.` });
    ctx.notify('email', customerEmail(st, c.referrerId), 'beslut_behovs', `Ärende ${c.number} behöver ert beslut eller stöd – logga in för att läsa.`, c.id);
  };
  /** Notis till coach/teammedlem vid tilldelning: i appen + e-post utan personuppgifter (interna regler, orgConfig). */
  const notifyAssignment = (st, ctx, c, userId, role) => {
    const rule = st.orgConfig.notifications.onAssignment; const lead = role === 'lead_coach';
    const u = st.users.find((x) => x.id === userId); if (!u) return;
    st.userNotifications.push({ id: ctx.id('un'), recipientId: userId, kind: 'assignment', caseId: c.id, createdAt: ctx.now, channels: rule.channels,
      title: lead ? 'Nytt ärende tilldelat dig' : 'Du har lagts till i ett team',
      body: lead ? `Du är huvudcoach för ${c.number} (${sel.areaName(c.primaryArea)}). Första möte ${c.firstMeetingAt ? d.fmtDateTime(c.firstMeetingAt) : 'är inte bokat ännu'}.` : `Du är ${sel.teamLabel(role).toLowerCase()} för ${c.number}.`,
      emailBody: `Du har fått ett nytt ärende i Miljonmatch: ${c.number}. Logga in för att se detaljerna.` });
    if (rule.channels.includes('email')) ctx.notify('email', u.email, 'tilldelning_coach', `Du har fått ett nytt ärende i Miljonmatch: ${c.number}. Logga in för att se detaljerna.`, c.id);
  };

  /** Nytt ärende (portal, telefon eller manuellt från mejl). Returnerar { caseId, number } eller { error }. */
  A('case.create', (st, p, ctx) => {
    const cfg = st.contracts.find((c) => c.id === 'c-bot').config;
    const prot = !!p.protectedIdentity;
    if (!prot && cfg.billing.buyerReference.required && p.buyerReference && !new RegExp(cfg.billing.buyerReference.pattern).test(p.buyerReference)) return { error: 'buyer_ref' };
    const person = { id: ctx.id('p'), firstName: p.firstName, lastName: p.lastName, pnr: p.pnr || '', pnrLast4: String(p.pnr || '').replace(/\D/g, '').slice(-4), birthYear: null,
      phone: prot ? '' : p.phone || '', email: prot ? '' : p.email || '', city: prot ? '' : p.city || '', address: prot ? null : p.address || null, preferredContact: prot ? 'phone' : p.preferredContact || 'sms',
      protectedIdentity: prot, accessibilityNeeds: prot ? '' : p.accessibilityNeeds || '', language: p.language || 'svenska', needsInterpreter: !!p.needsInterpreter };
    st.persons.push(person);
    const number = nextCaseNumber(st, 'c-bot', ctx.now.slice(0, 10));
    const c = { id: `case-${number.slice(4).replace('-', '')}`, number, contractId: 'c-bot', personId: person.id, status: prot ? 'received' : 'acknowledged', source: p.source || 'portal',
      referredAt: ctx.now, referrerId: p.referrerId, buyerReference: p.buyerReference || null, purchaseOrderNumber: p.purchaseOrderNumber || null, primaryArea: p.primaryArea || null,
      secondaryArea: p.secondaryArea || null, vocationalTrack: p.vocationalTrack || '', desiredStart: p.desiredStart || null, plannedWeeks: Number(p.plannedWeeks) || null, plannedEnd: p.plannedEnd || null,
      acknowledgedAt: prot ? null : ctx.now, confirmedAt: null, firstMeetingAt: null, startDate: null, endDate: null, endReason: null, resultClass: null, resultVerifiedAt: null, phase: 1, leadCoachId: null,
      team: [], backgroundInfo: prot ? '' : p.background || '', aiConsent: prot ? 'not_applicable' : 'not_asked', meetingDay: null, meetingTime: null, location: 'Alby', pausedWeeks: [], tags: ['ny-i-demo'],
      orderValueWeeks: Number(p.plannedWeeks) || null, declineReason: null, createdInDemo: true };
    st.cases.push(c);
    st.caseStatusHistory.push({ id: ctx.id('csh'), caseId: c.id, fromStatus: null, toStatus: c.status, changedBy: ctx.actorId, changedAt: ctx.now, reason: `Beställning via ${({ portal: 'portalen', email: 'mejl', phone: 'telefon' })[c.source]}` });
    ctx.audit('case.created', 'case', c.id, { number, source: c.source });
    if (prot) st.tasks.push({ id: ctx.id('task'), toRole: 'avtalsansvarig', fromId: 'system', createdAt: ctx.now, status: 'open', kind: 'protected_order', caseIds: [c.id], text: `Beställning ${number} med skyddade personuppgifter. Ring handläggaren enligt den säkra rutinen. Ingen automatik har körts.` });
    if (!prot) ctx.notify('email', customerEmail(st, p.referrerId), 'ordererkannande', sel.ackTextFor(c, st), c.id);
    else ctx.notify('email', customerEmail(st, p.referrerId), 'generisk_mottagningsbekraftelse', 'Tack. Vi har tagit emot beställningen. Ring oss på 08-000 00 00 så tar vi resten enligt den säkra rutinen.', null);
    return { caseId: c.id, number };
  });
  sel.ackTextFor = (c) => `Tack! Vi har tagit emot er beställning och gett den ärendenummer ${c.number}. Ni får besked om startdatum och ansvarig coach senast ${d.WD[d.weekday(sel.avropDue(c))]} ${d.fmtDateTimeFull(sel.avropDue(c))}. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.`;

  /** Acceptera avrop → orderbekräftelse. p = { caseId, leadCoachId, startDate, firstMeetingAt, team, plannedWeeks, buyerReference, emailId } */
  A('case.accept', (st, p, ctx) => {
    const c = findCase(st, p.caseId); if (!c) return { error: 'not_found' };
    const ref = p.buyerReference != null ? String(p.buyerReference).trim() : c.buyerReference;
    const cfg = st.contracts.find((x) => x.id === c.contractId).config;
    if (cfg.billing.buyerReference.required && !new RegExp(cfg.billing.buyerReference.pattern).test(ref || '')) return { error: 'buyer_ref' };
    c.buyerReference = ref; c.leadCoachId = p.leadCoachId; c.status = 'confirmed'; c.confirmedAt = ctx.now;
    if (p.plannedWeeks) { c.plannedWeeks = Number(p.plannedWeeks); c.orderValueWeeks = c.plannedWeeks; }
    c.plannedStart = p.firstMeetingAt ? p.firstMeetingAt.slice(0, 10) : (p.startDate || c.desiredStart);
    if (p.firstMeetingAt) c.firstMeetingAt = p.firstMeetingAt;
    if (c.plannedStart && c.plannedWeeks) c.plannedEnd = d.addDays(d.monday(c.plannedStart), (c.plannedWeeks - 1) * 7 + 4);
    c.team = [{ userId: p.leadCoachId, role: 'lead_coach' }, ...(p.team || []).filter((t) => t.userId !== p.leadCoachId)];
    st.caseStatusHistory.push({ id: ctx.id('csh'), caseId: c.id, fromStatus: 'acknowledged', toStatus: 'confirmed', toCoach: p.leadCoachId, changedBy: ctx.actorId, changedAt: ctx.now, reason: 'Avrop accepterat' });
    const rep = { id: ctx.id('rep'), contractId: c.contractId, caseId: c.id, kind: 'order_confirmation', periodStart: ctx.now.slice(0, 10), periodEnd: ctx.now.slice(0, 10), status: 'delivered', version: 1, dueAt: sel.avropDue(c), approvedBy: ctx.actorId, approvedAt: ctx.now, deliveredAt: ctx.now, deliveredTo: [c.referrerId], openedAt: null, createdInDemo: true };
    st.reports.push(rep);
    const em = st.inboundEmails.find((e) => e.caseId === c.id && ['acknowledged', 'received'].includes(e.status)); if (em) { em.status = 'accepted'; em.handledBy = ctx.actorId; em.handledAt = ctx.now; }
    ctx.audit('case.accepted', 'case', c.id, { leadCoachId: p.leadCoachId, firstMeetingAt: p.firstMeetingAt, withinSla: ctx.now <= sel.avropDue(c) });
    for (const t of c.team) notifyAssignment(st, ctx, c, t.userId, t.role);
    ctx.notify('email', customerEmail(st, c.referrerId), 'orderbekraftelse', `Orderbekräftelse för ärende ${c.number} finns i portalen – logga in för att läsa. Startdatum och ansvarig coach framgår där.`, c.id);
    const protectedPerson = (st.persons.find((x) => x.id === c.personId) || {}).protectedIdentity;
    const pc = (st.persons.find((x) => x.id === c.personId) || {}).preferredContact || 'sms';
    if (p.firstMeetingAt && !protectedPerson) ctx.notify(({ email: 'email', letter: 'brev', phone: 'sms', sms: 'sms' })[pc], `deltagare (${({ email: 'e-post', letter: 'brev', phone: 'SMS (telefon vald – coachen ringer också)', sms: 'SMS' })[pc]})`, 'kallelse', `Välkommen till Miljonbemanning! Ditt första möte är ${d.fmtWeekday(p.firstMeetingAt)} klockan ${d.fmtTime(p.firstMeetingAt)} i ${c.location || 'Alby'}. Frågor? Ring 08-000 00 00.`, c.id);
    return { reportId: rep.id };
  });
  A('case.decline', (st, p, ctx) => {
    const c = findCase(st, p.caseId); if (!c || !p.reason) return { error: 'reason' };
    c.status = 'declined'; c.declineReason = p.reason; c.declinedAt = ctx.now;
    const em = st.inboundEmails.find((e) => e.caseId === c.id); if (em) { em.status = 'declined'; em.handledBy = ctx.actorId; em.handledAt = ctx.now; }
    st.caseStatusHistory.push({ id: ctx.id('csh'), caseId: c.id, fromStatus: 'acknowledged', toStatus: 'declined', changedBy: ctx.actorId, changedAt: ctx.now, reason: p.reason });
    ctx.audit('case.declined', 'case', c.id, { reason: p.reason });
    ctx.notify('email', customerEmail(st, c.referrerId), 'avbojt', `Vi kan tyvärr inte ta emot beställning ${c.number}. Logga in i portalen för att läsa orsaken.`, c.id);
    return {};
  });
  /** Generell uppdatering av ärendefält med revisionslogg. */
  A('case.update', (st, p, ctx) => {
    const c = findCase(st, p.caseId); if (!c) return {};
    const changed = {}; for (const [k, v] of Object.entries(p.patch || {})) { if (c[k] !== v) { changed[k] = { from: c[k], to: v }; c[k] = v; } }
    ctx.audit('case.updated', 'case', c.id, { fields: Object.keys(changed) });
    return { changed };
  });
  A('case.setBuyerRef', (st, p, ctx) => {
    const c = findCase(st, p.caseId); const ref = String(p.reference || '').trim();
    if (MM.valid.buyerRefError(ref, st.contracts[0].config)) return { error: 'buyer_ref' };
    const old = c.buyerReference; c.buyerReference = ref; ctx.audit('case.buyer_reference_changed', 'case', c.id, { from: old, to: ref, source: p.source || '' });
    return {};
  });
  A('case.bookFirstMeeting', (st, p, ctx) => {
    const c = findCase(st, p.caseId); c.firstMeetingAt = p.at; c.plannedStart = p.at.slice(0, 10);
    ctx.audit('case.first_meeting_booked', 'case', c.id, { at: p.at });
    const pers0 = st.persons.find((x) => x.id === c.personId) || {}; const pc0 = pers0.preferredContact || 'sms';
    if (!pers0.protectedIdentity) ctx.notify(({ email: 'email', letter: 'brev', phone: 'sms', sms: 'sms' })[pc0], `deltagare (${({ email: 'e-post', letter: 'brev', phone: 'SMS (telefon vald – coachen ringer också)', sms: 'SMS' })[pc0]})`, 'kallelse', `Välkommen till Miljonbemanning! Ditt första möte är ${d.fmtWeekday(p.at)} klockan ${d.fmtTime(p.at)} i ${c.location || 'Alby'}. Frågor? Ring 08-000 00 00.`, c.id);
    return {};
  });
  A('case.changeCoach', (st, p, ctx) => {
    const c = findCase(st, p.caseId); if (!p.reason) return { error: 'reason' };
    const from = c.leadCoachId; c.leadCoachId = p.toCoachId; c.team = [{ userId: p.toCoachId, role: 'lead_coach' }, ...c.team.filter((t) => t.role !== 'lead_coach' && t.userId !== p.toCoachId)];
    st.caseStatusHistory.push({ id: ctx.id('csh'), caseId: c.id, fromStatus: c.status, toStatus: c.status, fromCoach: from, toCoach: p.toCoachId, changedBy: ctx.actorId, changedAt: ctx.now, reason: p.reason, customerNotifiedAt: ctx.now });
    ctx.audit('case.coach_changed', 'case', c.id, { from, to: p.toCoachId, reason: p.reason });
    notifyAssignment(st, ctx, c, p.toCoachId, 'lead_coach');
    ctx.notify('email', customerEmail(st, c.referrerId), 'coachbyte', `Ärende ${c.number} har fått ny huvudcoach. Logga in i portalen för att se vem.`, c.id);
    return {};
  });
  A('case.close', (st, p, ctx) => {
    const c = findCase(st, p.caseId); if (!p.endDate || !p.endReason) return { error: 'missing' };
    const cfg = st.contracts[0].config;
    c.status = 'closed'; c.endDate = p.endDate; c.endReason = p.endReason; c.closedAt = ctx.now;
    const excluded = (cfg.result.prototypeExcluded || []).includes(p.endReason);
    c.resultClass = cfg.result.countsAsResult.includes(p.endReason) ? 'result' : excluded ? 'excluded' : 'no_result';
    c.resultVerifiedAt = c.resultClass === 'result' && p.verified ? ctx.now : null;
    st.caseStatusHistory.push({ id: ctx.id('csh'), caseId: c.id, fromStatus: 'active', toStatus: 'closed', changedBy: ctx.actorId, changedAt: ctx.now, reason: p.endReason });
    const rep = { id: ctx.id('rep'), contractId: 'c-bot', caseId: c.id, kind: 'final', periodStart: c.startDate, periodEnd: p.endDate, status: 'draft', version: 1, dueAt: d.addWorkingDays(`${p.endDate}T23:59`, cfg.sla.find((x) => x.key === 'slutrapport').proposal.workingDays), approvedBy: null, approvedAt: null, deliveredAt: null, deliveredTo: [], openedAt: null, provisionalDue: true, createdInDemo: true };
    st.reports.push(rep);
    const pers = st.persons.find((x) => x.id === c.personId);
    if (!pers.protectedIdentity) st.pulseInvites.push({ id: ctx.id('pi'), caseId: c.id, channel: pers.preferredContact === 'email' ? 'email' : 'sms', language: 'sv', occasion: 'exit', sentAt: ctx.now, expiresAt: d.addDays(ctx.now, 7), usedAt: null });
    ctx.audit('case.closed', 'case', c.id, { endReason: p.endReason, resultClass: c.resultClass });
    return { reportId: rep.id };
  });

  // ---- Mejl
  A('email.setStatus', (st, p, ctx) => { const e = st.inboundEmails.find((x) => x.id === p.emailId); e.status = p.status; e.handledBy = ctx.actorId; e.handledAt = ctx.now; if (p.caseId) e.caseId = p.caseId; ctx.audit('email.handled', 'inbound_email', e.id, { status: p.status }); return {}; });
  A('email.applySupplement', (st, p, ctx) => {
    const e = st.inboundEmails.find((x) => x.id === p.emailId); const c = findCase(st, e.caseId);
    if (e.extracted.buyerReference) c.buyerReference = e.extracted.buyerReference;
    if (e.extracted.plannedEnd) c.plannedEnd = e.extracted.plannedEnd;
    const orig = st.inboundEmails.find((x) => x.caseId === c.id && x.classification === 'order'); if (orig) { orig.missingFields = orig.missingFields.filter((f) => !Object.keys(e.extracted).includes(f)); Object.assign(orig.extracted, e.extracted); }
    e.status = 'applied'; e.handledBy = ctx.actorId; e.handledAt = ctx.now;
    ctx.audit('email.supplement_applied', 'case', c.id, { fields: Object.keys(e.extracted) });
    return {};
  });

  // ---- Närvaro
  /** p = { activityId, status, reason } */
  A('attendance.set', (st, p, ctx) => {
    const act = st.activities.find((a) => a.id === p.activityId); let at = st.attendance.find((x) => x.activityId === p.activityId);
    if (!at) { at = { id: ctx.id('at'), activityId: act.id, caseId: act.caseId, status: p.status, reason: p.reason || '', registeredBy: ctx.actorId, registeredAt: ctx.now, customerNotifiedAt: null }; st.attendance.push(at); }
    else { at.status = p.status; at.reason = p.reason || ''; at.registeredBy = ctx.actorId; at.registeredAt = ctx.now; }
    ctx.audit('attendance.registered', 'attendance', at.id, { caseId: act.caseId, status: p.status });
    // Publicera veckorapport automatiskt när alla handläggarens deltagare är registrerade
    const wk = d.isoWeek(act.startsAt).key; const c = findCase(st, act.caseId);
    const rep = st.reports.find((r) => r.kind === 'weekly_attendance' && r.week === wk && r.recipientUserId === c.referrerId && r.status === 'waiting');
    if (rep && sel.weeklyReport(c.referrerId, wk).complete) {
      rep.status = 'delivered'; rep.deliveredAt = ctx.now; rep.approvedAt = ctx.now; rep.deliveredTo = [c.referrerId];
      ctx.audit('report.published', 'report', rep.id, { kind: 'weekly_attendance', week: wk, automatic: true });
      ctx.notify('email', customerEmail(st, c.referrerId), 'ny_rapport', `Veckorapporten för ${d.fmtWeekKey(wk)} finns i portalen – logga in för att läsa.`, null);
      ctx.toast(`Veckorapporten för ${d.fmtWeekKey(wk)} till ${MM.personName(c.referrerId)} publicerades automatiskt.`, 'blue');
    }
    return { attendanceId: at.id };
  });

  // ---- Veckoavstämning
  /** p = { caseId, checkInId?, data: {...fält}, approve, deviation?: { description, action, ownerId, followUpOn, needsCustomerDecision }, aiDecisions?: [{ field, decision, suggested, final }] } */
  A('checkin.save', (st, p, ctx) => {
    const c = findCase(st, p.caseId);
    let ci = p.checkInId ? st.checkIns.find((x) => x.id === p.checkInId) : null;
    if (!ci) { ci = { id: ctx.id('ci'), caseId: c.id, heldAt: p.data.heldAt || ctx.now, status: 'draft', approvedBy: null, approvedAt: null, aiRunId: null }; st.checkIns.push(ci); }
    Object.assign(ci, p.data);
    if (p.data.overallStatus === 'red' && !p.deviation) return { error: 'deviation_required' };
    if (p.data.inputMethod && p.data.inputMethod !== 'manual' && !sel.aiAllowed(c)) return { error: 'ai_not_allowed' };
    if (p.approve) { ci.status = 'approved'; ci.approvedBy = ctx.actorId; ci.approvedAt = ctx.now; if (ci.phase) c.phase = Number(ci.phase); }
    if (p.aiDecisions && p.aiDecisions.length) { st.aiFieldDecisions = st.aiFieldDecisions || []; for (const x of p.aiDecisions) st.aiFieldDecisions.push({ id: ctx.id('afd'), aiRunId: ci.aiRunId, ...x, decidedBy: ctx.actorId, decidedAt: ctx.now }); }
    if (p.approve && ci.ai) { ci.ai.rawTranscriptDeletedAt = ctx.now; ci.ai.transcript = []; ctx.audit('transcript.deleted', 'check_in', ci.id, { reason: 'Avstämningen godkänd' }); }
    let devId = null;
    if (p.data.overallStatus === 'red' && p.deviation) {
      const dv = { id: ctx.id('dev'), caseId: c.id, createdAt: ctx.now, description: p.deviation.description, assessment: p.deviation.assessment || '', action: p.deviation.action, ownerId: p.deviation.ownerId, followUpOn: p.deviation.followUpOn, needsCustomerDecision: !!p.deviation.needsCustomerDecision, followUpMeetingAt: null, status: 'open', checkInId: ci.id };
      st.deviations.push(dv); devId = dv.id; ctx.audit('deviation.created', 'deviation', dv.id, { caseId: c.id, fromCheckIn: ci.id });
      if (dv.needsCustomerDecision) customerDecisionTask(st, ctx, dv);
    }
    ctx.audit(p.approve ? 'check_in.approved' : 'check_in.saved', 'check_in', ci.id, { caseId: c.id, aiUsed: !!ci.ai });
    return { checkInId: ci.id, deviationId: devId };
  });
  A('deviation.save', (st, p, ctx) => {
    let dv = p.id ? st.deviations.find((x) => x.id === p.id) : null;
    if (!dv) { dv = { id: ctx.id('dev'), caseId: p.caseId, createdAt: ctx.now, status: 'open' }; st.deviations.push(dv); }
    Object.assign(dv, p.data || {}); ctx.audit('deviation.saved', 'deviation', dv.id, { caseId: dv.caseId, status: dv.status });
    if (dv.needsCustomerDecision) customerDecisionTask(st, ctx, dv);
    return { deviationId: dv.id };
  });
  /** Kalla kommunen till uppföljning (AFK 7.8) – skickar mötesförfrågan som säkert meddelande + notis utan personuppgifter. */
  A('deviation.callCustomer', (st, p, ctx) => {
    const c = findCase(st, p.caseId); const dv = p.deviationId ? st.deviations.find((x) => x.id === p.deviationId) : null;
    if (dv) dv.followUpMeetingAt = p.proposedAt || null;
    st.messages.push({ id: ctx.id('msg'), caseId: c.id, senderId: ctx.actorId, body: p.body, createdAt: ctx.now, readBy: [], readAt: null, kind: 'meeting_request' });
    ctx.notify('email', customerEmail(st, c.referrerId), 'nytt_meddelande', `Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.`, c.id);
    ctx.audit('deviation.customer_called', 'case', c.id, { deviationId: p.deviationId || null });
    return {};
  });

  // ---- Månadsbedömning
  /** p = { caseId, month, areas: {key: {level, observation, nextStep}}, summary, overallStatus, approve, plan? } */
  A('assessment.save', (st, p, ctx) => {
    const cfg = st.contracts[0].config;
    let ma = st.monthlyAssessments.find((x) => x.caseId === p.caseId && x.month === p.month);
    if (!ma) { ma = { id: ctx.id('ma'), caseId: p.caseId, month: p.month, areas: {}, status: 'draft' }; st.monthlyAssessments.push(ma); }
    for (const [k, v] of Object.entries(p.areas || {})) ma.areas[k] = { ...(ma.areas[k] || {}), ...v };
    if (p.summary != null) ma.summary = p.summary;
    if (p.overallStatus != null) ma.overallStatus = p.overallStatus;
    if (p.approve) {
      const missing = cfg.progression.areas.filter((k) => { const a = ma.areas[k] || {}; return a.level == null || (a.level >= cfg.progression.observationRequiredFromLevel && !String(a.observation || '').trim()); });
      if (missing.length || !ma.overallStatus) return { error: 'incomplete', missing };
      ma.status = 'approved'; ma.decidedBy = ctx.actorId; ma.decidedAt = ctx.now;
      const rep = st.reports.find((r) => r.kind === 'monthly' && r.caseId === p.caseId && r.month === p.month);
      if (rep && rep.status === 'draft') rep.status = 'reviewed';
    }
    if (p.plan) { let mp = st.monthlyPlans.find((x) => x.caseId === p.caseId && x.month === p.month); if (!mp) { mp = { id: ctx.id('mp'), caseId: p.caseId, month: p.month }; st.monthlyPlans.push(mp); } Object.assign(mp, p.plan); }
    ctx.audit(p.approve ? 'assessment.approved' : 'assessment.saved', 'monthly_assessment', ma.id, { caseId: p.caseId, month: p.month });
    return { assessmentId: ma.id };
  });

  // ---- Kartläggning
  A('intake.save', (st, p, ctx) => {
    let ia = st.intakeAssessments.find((x) => x.caseId === p.caseId);
    if (!ia) { ia = { id: ctx.id('ia'), caseId: p.caseId, status: 'draft' }; st.intakeAssessments.push(ia); }
    Object.assign(ia, p.data || {});
    if (p.approve) { ia.status = 'approved'; ia.approvedBy = ctx.actorId; ia.approvedAt = ctx.now; const c = findCase(st, p.caseId); if (ia.chosenTrack) c.vocationalTrack = ia.chosenTrack; }
    ctx.audit(p.approve ? 'intake.approved' : 'intake.saved', 'intake_assessment', ia.id, { caseId: p.caseId });
    return { intakeId: ia.id };
  });

  // ---- Händelser
  A('event.add', (st, p, ctx) => {
    const e = { id: ctx.id('oe'), caseId: p.caseId, kind: p.kind, occurredOn: p.occurredOn, actor: p.actor || '', verificationKind: p.verificationKind || null, verificationFile: p.verificationFile || null, note: p.note || '', possibleBonus: p.kind === 'arbete_paborjat' };
    st.outcomeEvents.push(e); ctx.audit('event.added', 'outcome_event', e.id, { caseId: p.caseId, kind: p.kind }); return { eventId: e.id };
  });
  A('result.verify', (st, p, ctx) => { const c = findCase(st, p.caseId); c.resultVerifiedAt = ctx.now; const e = st.outcomeEvents.find((x) => x.caseId === c.id && ['arbete_paborjat', 'studier_paborjade'].includes(x.kind)); if (e) { e.verificationKind = p.verificationKind; e.verificationFile = p.file || 'verifiering.pdf'; } ctx.audit('result.verified', 'case', c.id, { kind: p.verificationKind }); return {}; });

  // ---- Rapporter
  A('report.approve', (st, p, ctx) => { const r = st.reports.find((x) => x.id === p.reportId); r.status = 'approved'; r.approvedBy = ctx.actorId; r.approvedAt = ctx.now; ctx.audit('report.approved', 'report', r.id, { kind: r.kind }); return {}; });
  A('report.deliver', (st, p, ctx) => {
    const r = st.reports.find((x) => x.id === p.reportId); if (!['approved', 'reviewed'].includes(r.status) && r.kind !== 'weekly_attendance') return { error: 'not_approved' };
    const c = r.caseId ? findCase(st, r.caseId) : null; const to = r.recipientUserId || (c && c.referrerId);
    r.status = 'delivered'; r.deliveredAt = ctx.now; r.deliveredTo = [to]; if (!r.approvedAt) { r.approvedAt = ctx.now; r.approvedBy = ctx.actorId; }
    if (r.previousId) { const prev = st.reports.find((x) => x.id === r.previousId); if (prev) { prev.superseded = true; prev.supersededAt = ctx.now; prev.supersededBy = r.id; } }
    ctx.audit('report.delivered', 'report', r.id, { kind: r.kind, channel: 'portal', version: r.version });
    ctx.notify('email', customerEmail(st, to), 'ny_rapport', `${sel.reportKindLabel(r.kind)}${c ? ` för ärende ${c.number}` : ''} finns i portalen – logga in för att läsa.`, r.caseId);
    return {};
  });
  A('report.correct', (st, p, ctx) => { const r = st.reports.find((x) => x.id === p.reportId); const nr = { ...r, id: ctx.id('rep'), version: r.version + 1, status: 'draft', deliveredAt: null, openedAt: null, approvedAt: null, approvedBy: null, previousId: r.id }; r.correctionPending = nr.id; st.reports.push(nr); ctx.audit('report.corrected', 'report', nr.id, { previous: r.id }); return { reportId: nr.id }; });
  /** Kvittens: bara när en mottagare själv öppnar en levererad rapport. Andra kommunanvändare som läser den kvitterar inte. */
  A('report.open', (st, p, ctx) => { const r = st.reports.find((x) => x.id === p.reportId); const isRecipient = r && (r.deliveredTo || []).includes(ctx.actorId); if (r && isRecipient && !r.openedAt && ['delivered'].includes(r.status)) { r.openedAt = ctx.now; r.openedBy = ctx.actorId; } ctx.audit('report.view', 'report', p.reportId, { by: 'customer', acknowledged: !!isRecipient }); return { acknowledged: !!isRecipient }; });

  // ---- Meddelanden
  A('message.send', (st, p, ctx) => {
    const c = findCase(st, p.caseId);
    const m = { id: ctx.id('msg'), caseId: c.id, senderId: ctx.actorId, body: p.body, createdAt: ctx.now, readBy: [], readAt: null };
    st.messages.push(m);
    const toCustomer = !String(ctx.actorId).startsWith('k-');
    if (toCustomer) ctx.notify('email', customerEmail(st, c.referrerId), 'nytt_meddelande', `Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.`, c.id);
    else {
      const coach = st.users.find((u) => u.id === c.leadCoachId);
      if (coach) {
        st.userNotifications.push({ id: ctx.id('un'), recipientId: coach.id, kind: 'message', caseId: c.id, createdAt: ctx.now, channels: ['app', 'email'], title: 'Nytt meddelande från kommunen', body: `Nytt säkert meddelande om ${c.number}. Läs och svara i ärendets flik Meddelanden.`, emailBody: `Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.` });
        ctx.notify('email', coach.email, 'nytt_meddelande', `Du har ett nytt meddelande om ärende ${c.number} – logga in för att läsa.`, c.id);
      }
    }
    ctx.audit('message.sent', 'case', c.id, {});
    return { messageId: m.id };
  });
  A('message.read', (st, p, ctx) => { for (const m of st.messages.filter((x) => x.caseId === p.caseId && x.senderId !== ctx.actorId && !x.readBy.includes(ctx.actorId))) { m.readBy.push(ctx.actorId); m.readAt = m.readAt || ctx.now; } return {}; });

  // ---- Personliga notiser
  A('notif.read', (st, p, ctx) => { const m = (st.notifRead[ctx.actorId] = st.notifRead[ctx.actorId] || {}); for (const id of p.ids || []) if (!m[id]) m[id] = ctx.now; return {}; });

  // ---- Flaggor
  A('alert.ack', (st, p, ctx) => { st.alertAcks[p.key] = { by: ctx.actorId, at: ctx.now, plan: p.plan || '' }; ctx.audit('alert.acknowledged', 'alert', p.key, { plan: p.plan }); return {}; });

  // ---- Samtycke (inspelning och AI)
  A('consent.set', (st, p, ctx) => {
    const c = findCase(st, p.caseId); const pers = st.persons.find((x) => x.id === c.personId);
    if (pers.protectedIdentity) return { error: 'protected' };
    if (p.value === 'given') { st.consents.push({ id: ctx.id('cons'), personId: c.personId, caseId: c.id, kind: 'recording_and_ai', textVersion: 'v1.0 (2026-10-01)', givenAt: ctx.now, informedBy: ctx.actorId, language: p.language || 'lättläst svenska', revokedAt: null }); c.aiConsent = 'given'; }
    if (p.value === 'declined') { st.consents.push({ id: ctx.id('cons'), personId: c.personId, caseId: c.id, kind: 'recording_and_ai', textVersion: 'v1.0 (2026-10-01)', givenAt: null, declinedAt: ctx.now, informedBy: ctx.actorId, revokedAt: null }); c.aiConsent = 'declined'; }
    if (p.value === 'revoked') { const cur = sel.consentOf(c.id); if (cur) cur.revokedAt = ctx.now; c.aiConsent = 'revoked'; }
    ctx.audit(`consent.${p.value}`, 'consent', c.id, { caseId: c.id });
    return {};
  });
  /** AI får bara köras med registrerat samtycke och aldrig för skyddade personuppgifter (regel 5 och 8). */
  sel.aiAllowed = (c) => { const pers = S().persons.find((x) => x.id === c.personId); return !!c && !(pers && pers.protectedIdentity) && c.aiConsent === 'given'; };
  A('ai.run', (st, p, ctx) => { const cc = findCase(st, p.caseId); if (p.caseId && p.kind !== 'parse_email' && !(cc && sel.aiAllowed(cc))) { ctx.audit('ai.blocked', 'case', p.caseId, { reason: 'Samtycke saknas eller skyddade personuppgifter' }); return { error: 'not_allowed' }; } const run = { id: ctx.id('ai'), caseId: p.caseId, kind: p.kind, provider: 'Berget AI (test)', model: p.model || 'KB-Whisper + öppen språkmodell', status: 'succeeded', createdAt: ctx.now, audioSeconds: p.audioSeconds || 0, costOre: p.costOre || 80, latencyMs: 64000, inputDeletedAt: p.audioSeconds ? ctx.now : null }; st.aiRuns.push(run); ctx.audit('ai.run', 'ai_run', run.id, { kind: p.kind, caseId: p.caseId }); if (p.audioSeconds) ctx.audit('audio.deleted', 'ai_run', run.id, { reason: 'Transkribering klar' }); return { runId: run.id }; });

  // ---- Fakturering
  const appr = (st, mk) => { st.billingApprovals = st.billingApprovals || {}; st.billingApprovals[mk] = st.billingApprovals[mk] || { zeroWeeks: {}, approved: {}, manual: {} }; return st.billingApprovals[mk]; };
  A('billing.approveZeroWeek', (st, p, ctx) => { appr(st, p.month).zeroWeeks[`${p.caseId}:${p.weekKey}`] = { by: ctx.actorId, at: ctx.now, note: p.note || '' }; ctx.audit('billing.zero_week_approved', 'case', p.caseId, { week: p.weekKey, note: p.note }); return {}; });
  A('billing.approveInvoice', (st, p, ctx) => { for (const id of p.caseIds) appr(st, p.month).approved[id] = true; ctx.audit('billing.approved', 'billing_run', p.month, { count: p.caseIds.length }); return {}; });
  /** Skapa fakturor i Fortnox (simulerat). Idempotent: en faktura som redan skapats skapas inte igen (nyckel månad:ärende). */
  A('billing.sendFortnox', (st, p, ctx) => {
    st.invoiceStatus[p.month] = st.invoiceStatus[p.month] || {}; const m = st.invoiceStatus[p.month]; const created = []; const skipped = [];
    for (const id of p.caseIds) { const cur = m[id] || m.default || 'draft'; if (['fortnox_created', 'booked', 'sent', 'paid', 'manual'].includes(cur)) { skipped.push(id); continue; } m[id] = 'fortnox_created'; created.push(id); }
    ctx.audit('billing.fortnox_created', 'billing_run', p.month, { created: created.length, skippedAlreadyCreated: skipped.length, idempotencyKeys: created.map((id) => `${p.month}:${id}`) });
    return { created, skipped };
  });
  A('billing.markManual', (st, p, ctx) => { st.invoiceStatus[p.month] = st.invoiceStatus[p.month] || {}; st.invoiceStatus[p.month][p.caseId] = 'manual'; appr(st, p.month).manual[p.caseId] = p.invoiceNo; ctx.audit('billing.manual', 'case', p.caseId, { month: p.month, invoiceNo: p.invoiceNo }); return {}; });
  A('billing.export', (st, p, ctx) => { ctx.audit('export.billing', 'billing_run', p.month, { format: p.format }); return {}; });
})();
