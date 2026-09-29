// views/ledning.js – ledningsvy för chef/controller (chef.oversikt) och register över avtalsavvikelser,
// varningar och klagomål (chef.avvikelser). SPEC §7.0, §7.10, §7.11 f, §7.12, §7.16 och §3 (sanktioner).
// Alla avtalsvärden (mål, minN, trappa, viten, varningar) läses från MM.cfg().
(() => {
  const { html, useState, useEffect, useMemo, useRef, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const S = () => MM.store.state;

  // Interna framgångsmått från SPEC §2 – Miljonbemannings egna mål, inte avtalsvärden.
  const INTERNAL_GOALS = { docMinutes: 5, pulseResponseRate: 0.6 };

  // ------------------------------------------------------------ Stilar (bara för den här filen, MB-tokens)
  const CSS = `
.ldg-tiles { display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(min(100%, 210px), 1fr)); }
.ldg-legend { display:flex; flex-wrap:wrap; gap:6px 18px; font-size:.8125rem; color:var(--fg-muted); }
.ldg-legend > span { display:inline-flex; align-items:center; gap:6px; }
.ldg-sw { display:inline-block; flex:none; }
.ldg-sw-bar { width:12px; height:12px; border-radius:2px; background:var(--bla); }
.ldg-sw-small { width:12px; height:12px; border-radius:2px; background:var(--bla-ton2); border:1.5px dashed var(--bla); }
.ldg-sw-line { width:18px; height:3px; background:var(--antracit); border-radius:2px; }
.ldg-sw-contract { width:20px; height:0; border-top:2px dashed var(--rod); }
.ldg-sw-internal { width:20px; height:0; border-top:2px dotted var(--antracit); }
.ldg-hbar { height:10px; border-radius:999px; background:var(--surface-sub2); position:relative; min-width:56px; }
.ldg-hbar > .f { position:absolute; left:0; top:0; bottom:0; border-radius:999px; background:var(--antracit); }
.ldg-hbar > .f.blue { background:var(--bla); }
.ldg-hbar > .m { position:absolute; top:-4px; bottom:-4px; width:2px; background:var(--antracit); }
.ldg-hbar > .m.red { background:var(--rod); }
.ldg-dist { display:grid; grid-template-columns:minmax(0, 10.5em) minmax(0, 1fr) 6.5em; gap:8px 12px; align-items:center; font-size:.9375rem; }
.ldg-dist .v { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
@media (max-width:520px) { .ldg-dist { grid-template-columns:minmax(0, 1fr) 6em; } .ldg-dist .ldg-hbar { grid-column:1 / -1; order:3; } }
.ldg-ladder { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px; align-items:stretch; }
.ldg-step { border:1.5px solid var(--line-strong); border-radius:var(--radius); padding:10px 10px 12px; display:flex; flex-direction:column; gap:4px; background:var(--vit); font-size:.875rem; min-width:0; }
.ldg-step .n { font-size:var(--fs-label); font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
.ldg-step .t { font-weight:800; font-size:.9375rem; }
.ldg-step.cur { background:var(--antracit); color:var(--vit); border-color:var(--antracit); }
.ldg-step.cur .muted { color:rgba(255,255,255,.86); }
.ldg-step.end { border:2px solid var(--rod); }
.ldg-step.cur.end { box-shadow:inset 0 0 0 2px var(--rod); }
.ldg-ladder.vertical { grid-template-columns:minmax(0, 1fr); }
.ldg-ladder.vertical .ldg-step { margin-top:0 !important; }
@media (max-width:760px) { .ldg-ladder { grid-template-columns:minmax(0, 1fr); } .ldg-step { margin-top:0 !important; } }
.ldg-group { border:1px solid var(--line); border-radius:var(--radius); padding:12px 14px; display:flex; flex-direction:column; gap:10px; min-width:0; }
.ldg-case { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:flex-start; padding-top:10px; border-top:1px solid var(--line); }
.ldg-case:first-of-type { border-top:0; padding-top:0; }
.ldg-case .main { flex:1 1 220px; min-width:0; display:flex; flex-direction:column; gap:6px; }
details.ldg-details > summary { cursor:pointer; font-weight:700; min-height:44px; display:flex; align-items:center; gap:8px; }
.ldg-big { font-size:2.25rem; font-weight:800; line-height:1.05; font-variant-numeric:tabular-nums; }
.ldg-alert { display:grid; grid-template-columns:24px minmax(0, 1fr); gap:6px 12px; align-items:start; padding:12px 0; border-top:1px solid var(--line); }
.ldg-alert:first-child { border-top:0; padding-top:0; }
.ldg-alert .main { min-width:0; display:flex; flex-direction:column; gap:4px; }
.ldg-alert .side { grid-column:2; display:flex; flex-wrap:wrap; gap:6px; }
.ldg-summary h3 { font-size:var(--fs-label); font-weight:800; letter-spacing:.1em; text-transform:uppercase; margin-top:6px; }
.ldg-wrapbtn { display:inline-flex; max-width:100%; min-width:0; }
.ldg-wrapbtn .btn { white-space:normal; text-align:left; max-width:100%; }
.ldg-summary ul { margin:0; padding-left:1.2em; display:flex; flex-direction:column; gap:6px; }
`;
  if (typeof document !== 'undefined' && !document.getElementById('ldg-style')) {
    const el = document.createElement('style'); el.id = 'ldg-style'; el.textContent = CSS; document.head.appendChild(el);
  }

  // ------------------------------------------------------------ Hjälpare
  const pct = (v, dec = 1) => fmt.pct(v, dec);
  const pct0 = (v) => fmt.pct(v, 0);
  const lastMonth = () => d.addMonths(d.monthKey(d.today()), -1);
  const median = (xs) => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const fmtMin = (v) => (v == null ? '–' : `${String(Math.round(v * 10) / 10).replace('.', ',')} min`);
  const canOpen = (view) => { const v = MM.views[view]; return !!v && (!Array.isArray(v.roles) || v.roles.includes(MM.role())); };
  const kpiCfg = (key) => MM.cfg().kpis.find((k) => k.key === key);
  const mbUsers = () => S().users.filter((u) => u.active !== false);
  const customerChef = () => S().customerUsers.find((u) => u.role === 'chef');

  const RR_STATUS = {
    ok: { tone: 'blue', icon: 'check-circle', label: 'Över internt mål' },
    below_internal: { tone: 'grey', icon: 'alert-circle', label: 'Bevaka – under internt mål' },
    below_contract: { tone: 'red', icon: 'alert', label: 'Åtgärd krävs – under avtalsmålet' },
    insufficient: { tone: 'outline', icon: 'minus-circle', label: 'För litet underlag' },
  };
  const RR_SHORT = { ok: 'Över internt mål', below_internal: 'Bevaka', below_contract: 'Åtgärd krävs', insufficient: 'Litet underlag' };
  const RrBadge = ({ status, short }) => { const s = RR_STATUS[status] || RR_STATUS.insufficient; return html`<${ui.Badge} tone=${s.tone} icon=${s.icon} title=${short ? s.label : undefined}>${short ? RR_SHORT[status] || s.label : s.label}<//>`; };
  const KPI_STATUS = {
    ok: { tone: 'blue', icon: 'check-circle', label: 'Når målet' },
    below_internal: { tone: 'grey', icon: 'alert-circle', label: 'Under målet' },
    below_contract: { tone: 'red', icon: 'alert', label: 'Under avtalsmålet' },
    no_target: { tone: 'outline', icon: 'minus-circle', label: 'Mål ej fastställt' },
    no_data: { tone: 'outline', icon: 'minus-circle', label: 'Inget underlag' },
    insufficient: { tone: 'outline', icon: 'minus-circle', label: 'För litet underlag' },
  };
  const SEVERITY = {
    critical: { tone: 'red', icon: 'alert', label: 'Kritisk' },
    warning: { tone: 'grey', icon: 'alert-circle', label: 'Bevaka' },
    info: { tone: 'outline', icon: 'info', label: 'Information' },
  };

  /** Liten stapel med målmarkeringar (ingen förklaringsrad – används i tabeller). */
  const MiniBar = ({ value, max = 1, markers = [], tone, label }) => html`
    <div class="ldg-hbar" role="img" aria-label=${label || pct(value)}>
      <div class=${MM.cls('f', tone)} style=${`width:${Math.max(0, Math.min(100, ((value || 0) / max) * 100))}%`}></div>
      ${markers.map((m) => html`<div class=${MM.cls('m', m.tone === 'red' && 'red')} style=${`left:calc(${(m.value / max) * 100}% - 1px)`} title=${m.label}></div>`)}
    </div>`;

  /** Bredd på en behållare – diagrammet ritas i verkliga pixlar så att etiketterna blir läsbara även på mobil. */
  const useWidth = (init = 640) => {
    const ref = useRef(null); const [w, setW] = useState(init);
    useEffect(() => {
      const el = ref.current; if (!el) return undefined;
      const upd = () => { const x = Math.round(el.getBoundingClientRect().width); if (x > 0) setW((old) => (Math.abs(old - x) > 1 ? x : old)); };
      upd();
      if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', upd); return () => window.removeEventListener('resize', upd); }
      const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect();
    }, []);
    return [ref, w];
  };

  // ------------------------------------------------------------ Kvittera flagga (kort åtgärdsplan)
  const ACK_SUGGESTIONS = {
    kpi: 'Genomgång av ärenden i fas 5 och med arbetserbjudande tillsammans med coacherna på torsdag. Uppföljning om två veckor.',
    no_progress_escalated: 'Avstämning med coachen denna vecka. Nytt veckomål och plan för nästa steg. Följs upp nästa måndag.',
    report_overdue: 'Samordnaren ser till att rapporten levereras i dag. Påminnelserutinen gås igenom på nästa APT.',
    unbilled: 'Ekonomen fakturerar om med rätt beställarreferens denna vecka. Kontroll av referenser före varje körning.',
    pulse_low: 'Samordnaren kontaktar deltagaren. Stödet från coachen tas upp i nästa coachsamtal.',
    default: 'Ansvarig är utsedd. Följs upp på nästa ledningsmöte.',
  };
  const AckModal = ({ alert, onClose }) => {
    const [plan, setPlan] = useState(''); const [err, setErr] = useState(null);
    const suggestion = ACK_SUGGESTIONS[alert.kind] || ACK_SUGGESTIONS.default;
    const save = () => {
      if (plan.trim().length < 5) { setErr('Skriv en kort åtgärdsplan: vad görs, av vem och när.'); return; }
      MM.dispatch('alert.ack', { key: alert.key, plan: plan.trim() });
      MM.toast('Flaggan är kvitterad. Åtgärdsplanen är sparad i revisionsloggen.', 'blue');
      onClose();
    };
    return html`<${ui.Modal} title="Kvittera flagga" onClose=${onClose}
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${save}>Kvittera med åtgärdsplan<//>`}>
      <div class="stack-sm"><div class="strong">${alert.title}</div><div class="muted">${alert.text}</div></div>
      <${ui.Field} label="Kort åtgärdsplan" id="ldg-ack-plan" required error=${err}
        help="Vad görs, av vem och när? Planen sparas med ditt namn och tidpunkt. Flaggan försvinner från listan men finns kvar under Kvitterade flaggor.">
        <${ui.TextArea} id="ldg-ack-plan" value=${plan} rows=${3} invalid=${!!err} onInput=${(v) => { setPlan(v); setErr(null); }} />
      <//>
      <div class="row-sm"><span class="small muted">Förslag:</span><button type="button" class="btn btn-ghost" style="white-space:normal;text-align:left" onClick=${() => { setPlan(suggestion); setErr(null); }}>${suggestion}</button></div>
    <//>`;
  };

  const LINK_LABEL = { 'arende.kort': 'Öppna ärendet', 'rapport.visa': 'Öppna rapporten', 'eko.start': 'Till faktureringen', 'sam.inkorg': 'Till inkorgen' };
  const AlertRow = ({ a, onAck }) => {
    const sv = SEVERITY[a.severity] || SEVERITY.info;
    const link = a.link && a.link.view !== MM.route.view && canOpen(a.link.view) ? a.link : null;
    return html`<div class="ldg-alert">
      <${I} name=${sv.icon} size="lg" cls=${a.severity === 'critical' ? 'ic-red' : ''} />
      <div class="main">
        <div class="row-sm"><${ui.Badge} tone=${sv.tone}>${sv.label}<//><span class="small muted">${d.fmtDateTime(a.createdAt)}</span></div>
        <div class="strong">${a.title}</div>
        <div class="small">${a.text}</div>
        ${a.ack && html`<div class="small muted"><${I} name="check" /> Kvitterad av ${MM.personName(a.ack.by)} ${d.fmtDateTime(a.ack.at)}: ${a.ack.plan}</div>`}
      </div>
      ${(link || (!a.ack && onAck)) && html`<div class="side">
        ${!a.ack && onAck && html`<${ui.Btn} kind="secondary" icon="check" onClick=${() => onAck(a)}>Kvittera<//>`}
        ${link && html`<${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav(link.view, link.params || {})}>${LINK_LABEL[link.view] || 'Öppna'}<//>`}
      </div>`}
    </div>`;
  };

  // ------------------------------------------------------------ Trenddiagram (SVG)
  const TrendChart = ({ rows, contract, internal, minN }) => {
    const [ref, W] = useWidth(640);
    const narrow = W < 480;
    const H = narrow ? 250 : 290;
    const m = { l: 44, r: 12, t: 26, b: 50 };
    const pw = Math.max(120, W - m.l - m.r); const ph = H - m.t - m.b;
    const vals = rows.flatMap((r) => [r.value, r.cumulative]).filter((v) => v != null);
    const yMax = Math.min(1, Math.max(0.5, Math.ceil((Math.max(internal, contract, ...vals) + 0.04) * 10) / 10));
    const y = (v) => m.t + ph - (v / yMax) * ph;
    const n = Math.max(1, rows.length); const slot = pw / n; const bw = Math.min(58, slot * 0.58);
    const x = (i) => m.l + slot * i + slot / 2;
    const ticks = []; for (let t = 0; t <= yMax + 1e-9; t += 0.1) ticks.push(Math.round(t * 10) / 10);
    const cumPts = rows.map((r, i) => (r.cumulative != null ? [x(i), y(r.cumulative)] : null)).filter(Boolean);
    const monthLbl = (mk, i) => { const [yy, mm] = mk.split('-'); return `${d.MON_SHORT[Number(mm) - 1]}${i === 0 || mm === '01' ? ` ${yy}` : ''}`; };
    const last = rows.filter((r) => r.cumulative != null).slice(-1)[0];
    const aria = `Resultatgrad per månad sedan avtalsstart. ${rows.map((r) => `${d.monthName(r.month)}: ${r.value == null ? 'inga avslut' : `${pct0(r.value)} av ${r.den} avslut`}`).join('. ')}. Kumulativt sedan start ${last ? pct(last.cumulative) : '–'}. Avtalsmål ${pct0(contract)}, internt mål ${pct0(internal)}.`;
    return html`<div class="stack-sm" style="gap:10px">
      <div ref=${ref} style="width:100%">
        <svg class="chart" viewBox=${`0 0 ${W} ${H}`} width=${W} height=${H} role="img" aria-label=${aria}>
          ${ticks.map((t) => html`<g key=${`t${t}`}>
            <line class=${t === 0 ? 'axis' : 'grid-line'} x1=${m.l} x2=${W - m.r} y1=${y(t)} y2=${y(t)} />
            <text x=${m.l - 8} y=${y(t) + 4} text-anchor="end" style="fill:var(--fg-muted)">${Math.round(t * 100)} %</text>
          </g>`)}
          ${rows.map((r, i) => {
            if (r.value == null) return html`<text key=${`e${i}`} x=${x(i)} y=${y(0) - 8} text-anchor="middle" style="fill:var(--fg-muted);font-size:11px">inga avslut</text>`;
            const small = r.den < minN; const top = y(r.value); const hgt = Math.max(1, y(0) - top);
            const cum = r.cumulative != null ? y(r.cumulative) : null;
            const inside = cum != null && cum < top && top - cum < 26 && hgt > 22;
            return html`<g key=${`b${i}`}>
              <rect x=${x(i) - bw / 2} y=${top} width=${bw} height=${hgt} rx="2" style=${small ? 'fill:var(--bla-ton2);stroke:var(--bla);stroke-width:1.5;stroke-dasharray:4 3' : 'fill:var(--bla)'}>
                <title>${d.monthName(r.month)}: ${pct(r.value)} (${r.num} av ${r.den} avslut)${small ? ' – litet underlag' : ''}</title>
              </rect>
              <text x=${x(i)} y=${inside ? top + 16 : top - 7} text-anchor="middle" style="font-weight:700">${pct0(r.value)}</text>
            </g>`;
          })}
          <line x1=${m.l} x2=${W - m.r} y1=${y(internal)} y2=${y(internal)} style="stroke:var(--antracit);stroke-width:2;stroke-dasharray:2 3" />
          <line x1=${m.l} x2=${W - m.r} y1=${y(contract)} y2=${y(contract)} style="stroke:var(--rod);stroke-width:2;stroke-dasharray:7 4" />
          ${cumPts.length > 1 && html`<polyline points=${cumPts.map((p) => p.join(',')).join(' ')} style="fill:none;stroke:var(--antracit);stroke-width:2.5;stroke-linejoin:round" />`}
          ${rows.map((r, i) => r.cumulative != null && html`<circle key=${`c${i}`} cx=${x(i)} cy=${y(r.cumulative)} r="4.5" style="fill:var(--vit);stroke:var(--antracit);stroke-width:2.5"><title>Kumulativt t.o.m. ${d.monthName(r.month)}: ${pct(r.cumulative)} (${r.cumulativeN} avslut)</title></circle>`)}
          ${rows.map((r, i) => html`<g key=${`l${i}`}>
            <text x=${x(i)} y=${y(0) + 19} text-anchor="middle" style="font-weight:600">${monthLbl(r.month, i)}</text>
            <text x=${x(i)} y=${y(0) + 36} text-anchor="middle" style="fill:var(--fg-muted);font-size:11px">${r.den > 0 ? `n = ${r.den}` : 'n = 0'}</text>
          </g>`)}
        </svg>
      </div>
      <div class="ldg-legend">
        <span><span class="ldg-sw ldg-sw-bar" aria-hidden="true"></span>Resultatgrad per månad</span>
        <span><span class="ldg-sw ldg-sw-small" aria-hidden="true"></span>Litet underlag (färre än ${minN} avslut)</span>
        <span><span class="ldg-sw ldg-sw-line" aria-hidden="true"></span>Kumulativt sedan start${last ? ` (${pct(last.cumulative)})` : ''}</span>
        <span><span class="ldg-sw ldg-sw-contract" aria-hidden="true"></span>Avtalsmål ${pct0(contract)}</span>
        <span><span class="ldg-sw ldg-sw-internal" aria-hidden="true"></span>Internt mål ${pct0(internal)}</span>
      </div>
      <details class="ldg-details">
        <summary><${I} name="list" />Visa siffrorna som tabell</summary>
        <${ui.Table} rowKey="month" caption="Resultatgrad per månad" rows=${rows} columns=${[
          { key: 'month', label: 'Månad', render: (r) => d.monthName(r.month) },
          { key: 'value', label: 'Resultatgrad', num: true, render: (r) => (r.value == null ? '–' : pct(r.value)) },
          { key: 'n', label: 'Resultat av avslut', num: true, render: (r) => `${r.num} av ${r.den}` },
          { key: 'ex', label: 'Räknas inte', num: true, render: (r) => r.excluded },
          { key: 'cum', label: 'Kumulativt', num: true, render: (r) => (r.cumulative == null ? '–' : `${pct(r.cumulative)} (${r.cumulativeN})`) },
        ]} />
      </details>
    </div>`;
  };

  // ------------------------------------------------------------ Data för ledningsvyn
  const buildOverview = () => {
    const cfg = MM.cfg(); const k = kpiCfg('resultatgrad');
    const rolling = sel.resultRate({ window: 'rolling_6m' });
    const sinceStart = sel.resultRate({ from: MM.contract().startsOn });
    const alerts = sel.alerts({ role: 'chef', personaId: MM.currentPersonaId() });
    const acked = sel.alerts({ role: 'chef', personaId: MM.currentPersonaId(), includeAcked: true }).filter((a) => a.ack);
    const escalated = sel.progressionWatch().filter((w) => w.level === 'escalated');
    const unbilled = sel.unbilledOld();
    const cds = S().contractDeviations;
    return {
      cfg, k, rolling, sinceStart, alerts, acked, escalated, unbilled, cds,
      forecast: sel.resultForecast(), trend: sel.resultTrend(), kpis: sel.kpis(),
      overdue: sel.deadlines({ days: 0 }).filter((x) => x.bucket === 'overdue'),
    };
  };

  // ------------------------------------------------------------ Flik: Resultat och KPI:er
  const KpiTab = ({ data, onAck }) => {
    const { cfg, k, rolling, sinceStart, forecast, trend, kpis, alerts, acked, escalated, unbilled, cds, overdue } = data;
    const isRr = (a) => a.key.startsWith('kpi:resultatgrad');
    const flagAlerts = alerts.filter((a) => a.kind !== 'no_progress_escalated').sort((a, b) => isRr(b) - isRr(a));
    const rrAlert = alerts.find(isRr);
    const rrAck = acked.find(isRr);
    const critical = alerts.filter((a) => a.severity === 'critical').length;
    const openCds = cds.filter((x) => x.status !== 'closed');
    const warnings = cds.filter((x) => x.warningIssued).length;
    const openPlans = openCds.filter((x) => x.actionPlan);
    const meterMax = Math.max(0.6, Math.ceil(((Math.max(rolling.value || 0, forecast.value || 0)) + 0.05) * 10) / 10);
    const markers = [{ value: k.contractTarget, label: `Avtalsmål ${pct0(k.contractTarget)}`, tone: 'red' }, { value: k.internalTarget, label: `Internt mål ${pct0(k.internalTarget)}`, tone: 'dark' }];
    const tone = rolling.status === 'below_contract' ? 'alert' : rolling.status === 'below_internal' ? 'watch' : undefined;
    const slaKeys = ['avrop_besvarade_i_tid', 'forsta_mote_inom_en_vecka', 'veckorapporter_i_tid', 'manadsrapporter_i_tid'];
    const sla = kpis.filter((x) => slaKeys.includes(x.key));
    const other = kpis;
    const unbilledCases = MM.uniq(unbilled.map((x) => x.case.id));
    const byCoach = MM.groupBy(escalated, (w) => w.case.leadCoachId);
    const lm = lastMonth();
    const resultDefUnset = MM.isUnset(cfg.result.definition);
    return html`<div class="stack-lg">
      <div class="ldg-tiles">
        <${ui.Kpi} label="Resultatgrad, rullande 6 mån" value=${rolling.value == null ? '–' : pct(rolling.value)} tone=${tone}
          sub=${`${rolling.num} av ${rolling.den} avslut · minst ${rolling.minN} krävs för flagga`}><${RrBadge} status=${rolling.status} /><//>
        <${ui.Kpi} label="Sedan avtalsstart" value=${sinceStart.value == null ? '–' : pct(sinceStart.value)}
          sub=${`${sinceStart.num} av ${sinceStart.den} avslut sedan ${d.fmtDate(MM.contract().startsOn)}`} />
        <${ui.Kpi} label="Prognos" value=${pct(forecast.value)} sub=${`Om ${forecast.candidates} deltagare med arbetserbjudande eller i fas 5 når resultat`} />
        <${ui.Kpi} label="Flaggor att hantera" value=${String(alerts.length)} tone=${critical > 0 ? 'alert' : undefined}
          sub=${`${critical} kritiska · ${escalated.length} ärenden med tidig uppmärksamhet`} />
      </div>

      <div class="split-wide">
        <${ui.Card} title="Resultatgrad mot mål" icon="target" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
          <div class="stack">
            <div class="row" style="align-items:flex-end;gap:16px 28px">
              <div class="stack-sm" style="gap:2px"><span class="label-caps">Rullande 6 månader</span><span class="ldg-big">${rolling.value == null ? '–' : pct(rolling.value)}</span><span class="small muted">${rolling.num} av ${rolling.den} avslut räknas · ${rolling.excluded} räknas inte · ${rolling.prelim} väntar på verifiering</span></div>
              <div class="stack-sm" style="gap:2px"><span class="label-caps">Sedan start</span><span class="strong" style="font-size:1.5rem">${sinceStart.value == null ? '–' : pct(sinceStart.value)}</span><span class="small muted">n = ${sinceStart.den}</span></div>
              <div class="stack-sm" style="gap:6px"><${RrBadge} status=${rolling.status} />
                ${rrAlert && html`<${ui.Btn} kind="secondary" icon="check" onClick=${() => onAck(rrAlert)}>Kvittera flaggan<//>`}
                ${!rrAlert && rrAck && html`<span class="small muted"><${I} name="check" /> Flaggan kvitterad ${d.fmtDateTime(rrAck.ack.at)}</span>`}</div>
            </div>
            <${ui.Meter} value=${rolling.value || 0} max=${meterMax} markers=${markers} label=${`Resultatgrad ${pct(rolling.value)}. Avtalsmål ${pct0(k.contractTarget)}, internt mål ${pct0(k.internalTarget)}. Skala 0 till ${pct0(meterMax)}.`} />
            <div class="small muted">Skala 0–${pct0(meterMax)}. Under ${pct0(k.internalTarget)} blir flaggan <b>Bevaka</b> (till chef och controller). Under ${pct0(k.contractTarget)} blir den <b>Åtgärd krävs</b> (även till avtalsansvarig). Ingen flagga förrän minst ${k.minN} avslut finns i fönstret.</div>
            ${resultDefUnset && html`<${ui.Notice} tone="warn" title="Resultatdefinitionen är inte fastställd (öppen fråga 6)">
              <div class="stack-sm"><span>${cfg.result.prototypeDefinition}</span>
              <span>I skarp drift är flaggorna Bevaka och Åtgärd krävs <b>vilande</b> tills definitionen är fastställd tillsammans med Botkyrka.</span>
              ${canOpen('om.fragor') && html`<span><${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav('om.fragor', {})}>Se de öppna frågorna<//></span>`}</div>
            <//>`}
            <div class="stack-sm"><h3 class="label-caps">Per månad sedan avtalsstart</h3>
              <${TrendChart} rows=${trend} contract=${k.contractTarget} internal=${k.internalTarget} minN=${k.minN} /></div>
          </div>
        <//>
        <div class="stack">
          <${ui.Card} title="Prognos" icon="trending-up">
            <div class="stack">
              <div class="ldg-big">${pct(forecast.value)}</div>
              <p>Om de <b>${forecast.candidates}</b> deltagarna med arbetserbjudande eller i fas 5 når resultat blir resultatgraden <b>${pct(forecast.value)}</b>.</p>
              <${ui.Meter} value=${forecast.value || 0} max=${meterMax} markers=${markers} label=${`Prognos ${pct(forecast.value)}`} />
              <div class="stack-sm">
                <div><span class="label-caps">Bara de med arbetserbjudande</span><div><b>${pct(forecast.offerOnly)}</b> (${fmt.plural(forecast.withOffer, 'deltagare', 'deltagare')})</div></div>
                <div><span class="label-caps">Väntar på verifiering</span><div>${forecast.prelim} avslut med resultat räknas med i prognosen.</div></div>
              </div>
              <div class="small muted">Prognosen är ett räkneexempel för ledningen. Den visas inte för kommunen.</div>
            </div>
          <//>
          <${ui.Card} title="Så ser kommunens chef resultatet" icon="building" tone="sub">
            <div class="stack-sm">
              <p>Resultatgrad <b>${rolling.value == null ? '–' : pct(rolling.value)}</b> mot avtalsmålet <b>${pct0(k.contractTarget)}</b>, rullande och sedan start.</p>
              <p class="small muted">Kommunen ser inte det interna målet, prognosen, jämförelsen per coach eller flaggorna. Grupper med färre än 5 personer redovisas som "färre än 5".</p>
              <div><span class="ldg-wrapbtn"><${ui.PerspectiveSwitch} role="kommun_chef" view="kom.chef" label="Så ser kommunens chef resultatet – utan internt mål" /></span></div>
            </div>
          <//>
        </div>
      </div>

      <div class="split">
        <${ui.Card} title="Flaggor för chef och controller" icon="flag" actions=${html`<${ui.Badge} tone=${flagAlerts.length ? 'dark' : 'outline'}>${flagAlerts.length} att kvittera<//>`}>
          <div class="stack">
            ${flagAlerts.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inga flaggor att kvittera">Nya flaggor visas här när de uppstår.<//>`
              : html`<div>${flagAlerts.map((a) => html`<${AlertRow} key=${a.key} a=${a} onAck=${onAck} />`)}</div>`}
            <div class="small muted">Eskaleringar om utebliven progression visas under Tidig uppmärksamhet.</div>
            ${acked.length > 0 && html`<details class="ldg-details"><summary><${I} name="check-square" />Kvitterade flaggor (${acked.length})</summary>
              <div>${acked.map((a) => html`<${AlertRow} key=${a.key} a=${a} />`)}</div></details>`}
          </div>
        <//>
        <${ui.Card} title="Tidig uppmärksamhet" icon="bell" actions=${html`<${ui.Badge} tone=${escalated.length ? 'red' : 'outline'} icon=${escalated.length ? 'alert' : undefined}>${escalated.length} ärenden<//>`}>
          <div class="stack">
            <p class="small">Ärenden med ${sel.orgRules().progressionWatch.escalateAfterConsecutiveWeeks} veckor eller fler i rad utan progression, per coach. <b>Coachen har fått påminnelser men ser inte att ärendet har eskalerats till dig.</b></p>
            ${escalated.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inga eskaleringar">Alla ärenden har progression eller bara en vecka utan.<//>`
              : Object.entries(byCoach).map(([coachId, ws]) => {
                const reminders = sel.progressionWatch({ coachId }).length;
                return html`<div class="ldg-group" key=${coachId}>
                  <div class="row-between"><${ui.UserName} id=${coachId} /><span class="small muted">${fmt.plural(reminders, 'påminnelse', 'påminnelser')} till coachen denna vecka</span></div>
                  ${ws.map((w) => {
                    const key = `noprog_esc:${w.case.id}:${w.lastWeek}`; const ack = S().alertAcks[key];
                    const a = alerts.find((x) => x.key === key) || { key, kind: 'no_progress_escalated', title: `${w.streak} veckor i rad utan progression`, text: `${w.case.number}` };
                    return html`<div class="ldg-case" key=${w.case.id}>
                      <div class="main">
                        <div class="row-sm"><${ui.CaseLink} caseId=${w.case.id} /><span>${sel.displayName(w.case)}</span><${ui.Badge} tone="red" icon="alert">${w.streak} veckor i rad<//></div>
                        <div class="row-sm">${w.weeks.map((x) => html`<${ui.Badge} tone="outline" key=${x.key}>${d.fmtWeekKey(x.key)}: ${x.reason}<//>`)}</div>
                        <div class="small muted">Coachen har fått ${fmt.plural(w.streak, 'påminnelse', 'påminnelser')} (en per vecka), men ingen notis om eskaleringen.</div>
                        ${ack && html`<div class="small"><${I} name="check" /> Kvitterad av ${MM.personName(ack.by)} ${d.fmtDateTime(ack.at)}: ${ack.plan}</div>`}
                      </div>
                      ${!ack && html`<${ui.Btn} kind="secondary" icon="check" onClick=${() => onAck(a)}>Kvittera<//>`}
                    </div>`;
                  })}
                </div>`;
              })}
            <div><span class="ldg-wrapbtn"><${ui.PerspectiveSwitch} role="coach" view="notiser" label="Se vad coachen Amira får (bara påminnelser)" /></span></div>
          </div>
        <//>
      </div>

      <div class="grid-3">
        <${ui.Card} title="SLA-uppfyllnad" icon="clock">
          <div class="stack">
            <div class="small muted">${d.monthName(lm)} · mål 100 %</div>
            ${sla.map((x) => html`<div class="stack-sm" style="gap:4px" key=${x.key}>
              <div class="row-between" style="gap:6px"><span class="small strong">${x.label}</span><span class="num strong">${x.value == null ? '–' : pct(x.value)}</span></div>
              <${MiniBar} value=${x.value || 0} tone=${x.status === 'ok' ? 'blue' : undefined} markers=${x.target != null ? [{ value: x.target, label: `Mål ${pct0(x.target)}` }] : []} label=${`${x.label}: ${pct(x.value)}`} />
              <span class="small muted">${x.num} av ${x.den}${x.provisional ? ' · deadline ej fastställd med Botkyrka' : ''}</span>
            </div>`)}
            <div class="row-between"><span class="strong">Försenat just nu</span><${ui.Badge} tone=${overdue.length ? 'red' : 'blue'} icon=${overdue.length ? 'alert' : 'check'}>${overdue.length} ${overdue.length === 1 ? 'deadline' : 'deadlines'}<//></div>
            ${canOpen('sam.deadlines') && html`<div><${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav('sam.deadlines', {})}>Förfaller i dag och denna vecka<//></div>`}
            ${!cfg.customerVisibility.seesSlaStats && html`<div class="small muted">SLA-statistiken visas inte för kommunen (beslut i ledningen, öppen fråga 17).</div>`}
          </div>
        <//>
        <${ui.Card} title="Ofakturerat" icon="card" tone=${unbilled.length ? 'red' : undefined}>
          <div class="stack">
            <div class="ldg-big">${fmt.kr(MM.sum(unbilled, (x) => x.amountOre))}</div>
            <p>${unbilled.length === 0 ? `Inga debiterbara veckor äldre än ${cfg.billing.unbilledWarningDays} dagar är ofakturerade.` : html`<b>${unbilled.length} veckor</b> i ${fmt.plural(unbilledCases.length, 'ärende', 'ärenden')} är äldre än ${cfg.billing.unbilledWarningDays} dagar utan faktura.`}</p>
            ${unbilledCases.length > 0 && html`<div class="row-sm">${unbilledCases.map((id) => html`<${ui.CaseLink} key=${id} caseId=${id} />`)}</div>`}
            <div class="small muted">Mål: 0 veckor. Preskription två månader efter utfört arbete. Äldsta veckan: ${unbilled.length ? `${Math.max(...unbilled.map((x) => x.age))} dagar` : '–'}.</div>
            ${canOpen('eko.start') ? html`<div><${ui.Btn} kind="ghost" iconRight="arrow-right" onClick=${() => MM.nav('eko.start', {})}>Till faktureringen<//></div>` : html`<div class="small muted">Ekonomen hanterar fakturorna. Du ser beloppen här.</div>`}
          </div>
        <//>
        <${ui.Card} title="Avtalsavvikelser och varningar" icon="flag">
          <div class="stack">
            <div class="row" style="gap:20px">
              <div class="stack-sm" style="gap:0"><span class="label-caps">Öppna</span><span class="ldg-big">${openCds.length}</span></div>
              <div class="stack-sm" style="gap:0"><span class="label-caps">Varningar</span><span class="ldg-big">${warnings} av ${cfg.warningsBeforeTermination}</span></div>
            </div>
            <div class="stack-sm">
              <span class="small strong">Öppna åtgärdsplaner</span>
              ${openPlans.length === 0 ? html`<span class="small muted">Inga öppna åtgärdsplaner.</span>` : openPlans.map((x) => html`<div class="row-between" key=${x.id} style="gap:6px">
                <span class="small" style="min-width:0;flex:1 1 140px">${x.description.length > 60 ? `${x.description.slice(0, 58)}…` : x.description}</span>
                ${x.actionPlanDue ? html`<${ui.SlaBadge} dueAt=${`${x.actionPlanDue}T16:00`} />` : html`<span class="small muted">Datum saknas</span>`}
              </div>`)}
            </div>
            <div class="small muted">${cfg.warningsBeforeTermination} skriftliga varningar kan leda till uppsägning av avtalet.</div>
            <div><${ui.Btn} kind="secondary" iconRight="arrow-right" onClick=${() => MM.nav('chef.avvikelser', {})}>Öppna registret<//></div>
          </div>
        <//>
      </div>

      <${ui.Card} title="Övriga KPI:er" icon="chart" flush>
        <${ui.Table} rowKey="key" caption="KPI:er mot mål" rows=${other} columns=${[
          { key: 'label', label: 'KPI', render: (x) => html`<span class="strong">${x.label}</span>` },
          { key: 'period', label: 'Period', render: (x) => (x.key === 'resultatgrad' ? 'Rullande 6 mån' : x.key === 'nojdhet' ? 'Rullande 3 mån' : d.monthName(lm)) },
          { key: 'value', label: 'Utfall', num: true, nowrap: true, render: (x) => html`<span class="strong">${x.value == null ? '–' : pct(x.value)}</span>` },
          { key: 'n', label: 'Underlag', num: true, nowrap: true, render: (x) => `${x.num} av ${x.den}` },
          { key: 'target', label: 'Mål', render: (x) => (x.key === 'resultatgrad' ? `Internt ${pct0(x.target)} · avtal ${pct0(x.contractTarget)}` : x.targetUnset ? html`<${ui.Badge} tone="plan">Ej fastställt<//>` : pct0(x.target)) },
          { key: 'status', label: 'Status', render: (x) => { const s = KPI_STATUS[x.status] || KPI_STATUS.no_data; return html`<${ui.Badge} tone=${s.tone} icon=${s.icon}>${s.label}<//>`; } },
        ]} />
      <//>
      <p class="small muted" style="margin-top:-16px">Mål som inte är fastställda med Botkyrka ger ingen flagga förrän de är fastställda. Månadsrapporternas deadline är ett förslag tills kommunen bekräftat den (öppen fråga 8).</p>
      <${ui.DemoNote}>Siffrorna räknas fram ur påhittade testdata varje gång sidan visas. I den riktiga tjänsten räknar ett schemalagt jobb om resultatgraden varje vecka och skickar veckosammanfattning via e-post till chef och controller.<//>
    </div>`;
  };

  // ------------------------------------------------------------ Flik: Per coach
  const coachRows = () => {
    const mk = lastMonth(); const from = `${mk}-01`; const to = d.monthEnd(mk);
    const weeks = d.weeksOfMonth(mk).map((w) => w.key);
    return sel.coaches().map((u) => {
      const cases = S().cases.filter((c) => c.leadCoachId === u.id);
      const active = cases.filter((c) => c.status === 'active').length;
      const rr = sel.resultRate({ window: 'rolling_6m', coachId: u.id });
      let att = 0; let reg = 0;
      for (const c of cases) { if (!c.startDate) continue; const s = sel.attendanceStats(c.id, from, to); att += s.present + s.late; reg += s.planned - s.unregistered; }
      let wk = 0; let wkOk = 0;
      for (const c of cases) {
        for (const key of weeks) {
          const wp = sel.weekProgress(c, key); if (!wp || wp.progress === null) continue;
          const mon = d.weekMonday(key); const end = `${d.addDays(mon, 6)}T23:59`;
          wk++; if (sel.checkInsOf(c.id).some((x) => x.status === 'approved' && x.heldAt >= mon && x.heldAt <= end)) wkOk++;
        }
      }
      const cis = cases.flatMap((c) => sel.checkInsOf(c.id)).filter((x) => x.status === 'approved' && d.monthKey(x.heldAt) === mk && x.docMinutes != null);
      const manual = cis.filter((x) => (x.inputMethod || 'manual') === 'manual').map((x) => x.docMinutes);
      const watch = sel.progressionWatch({ coachId: u.id });
      return { id: u.id, name: u.name, active, rr, attRate: reg ? att / reg : null, att, reg, ciRate: wk ? wkOk / wk : null, wk, wkOk,
        docMedian: median(manual), docN: manual.length, reminders: watch.length, escalated: watch.filter((w) => w.level === 'escalated').length };
    });
  };
  const CoachTab = () => {
    const rows = useMemo(coachRows, [MM.store.version]);
    const k = kpiCfg('resultatgrad'); const mk = lastMonth();
    const markers = [{ value: k.contractTarget, label: `Avtalsmål ${pct0(k.contractTarget)}`, tone: 'red' }, { value: k.internalTarget, label: `Internt mål ${pct0(k.internalTarget)}` }];
    const tot = { active: MM.sum(rows, (r) => r.active), reminders: MM.sum(rows, (r) => r.reminders), escalated: MM.sum(rows, (r) => r.escalated), att: MM.sum(rows, (r) => r.att), reg: MM.sum(rows, (r) => r.reg), wk: MM.sum(rows, (r) => r.wk), wkOk: MM.sum(rows, (r) => r.wkOk) };
    const allDoc = median(S().checkIns.filter((x) => x.status === 'approved' && d.monthKey(x.heldAt) === mk && x.docMinutes != null && (x.inputMethod || 'manual') === 'manual').map((x) => x.docMinutes));
    const all = sel.resultRate({ window: 'rolling_6m' });
    const docOver = allDoc != null && allDoc > INTERNAL_GOALS.docMinutes;
    return html`<div class="stack-lg">
      <div class="ldg-tiles">
        <${ui.Kpi} label="Aktiva ärenden" value=${String(tot.active)} sub=${`fördelade på ${rows.length} coacher`} />
        <${ui.Kpi} label="Resultatgrad, alla" value=${all.value == null ? '–' : pct(all.value)} sub=${`${rows.filter((r) => r.rr.status === 'below_contract').length} av ${rows.length} coacher under avtalsmålet`} tone=${all.status === 'below_contract' ? 'alert' : all.status === 'below_internal' ? 'watch' : undefined} />
        <${ui.Kpi} label="Dokumentationstid" value=${fmtMin(allDoc)} tone=${docOver ? 'watch' : undefined} sub=${`median utan AI, ${d.monthName(mk)} · internt mål högst ${INTERNAL_GOALS.docMinutes} min`} />
        <${ui.Kpi} label="Påminnelser denna vecka" value=${String(tot.reminders)} sub=${`${tot.escalated} ärenden eskalerade till dig`} />
      </div>
      <${ui.Card} title="Per coach" icon="users" flush actions=${html`<span class="small muted">Resultatgrad rullande 6 mån · övrigt ${d.monthName(mk)}</span>`}>
        <${ui.Table} caption="Nyckeltal per coach" rows=${rows} columns=${[
          { key: 'name', label: 'Coach', nowrap: true, render: (r) => html`<${ui.UserName} id=${r.id} />` },
          { key: 'active', label: 'Aktiva', num: true },
          { key: 'rr', label: 'Resultatgrad', render: (r) => html`<div class="stack-sm" style="gap:5px;min-width:150px">
              <div class="row-between" style="gap:6px"><span class="strong num">${r.rr.value == null ? '–' : pct(r.rr.value)}</span><span class="small muted num">${r.rr.num} av ${r.rr.den}</span></div>
              <${MiniBar} value=${r.rr.value || 0} max=${0.6} markers=${markers} tone=${r.rr.status === 'ok' ? 'blue' : undefined} label=${`Resultatgrad ${pct(r.rr.value)}`} />
              <div><${RrBadge} status=${r.rr.status} short /></div></div>` },
          { key: 'att', label: 'Närvaro', num: true, render: (r) => html`<span class="strong">${r.attRate == null ? '–' : pct(r.attRate)}</span><div class="cell-sub nowrap">${r.att} av ${r.reg}</div>` },
          { key: 'ci', label: 'Avstämningar', num: true, render: (r) => html`<span class="strong">${r.ciRate == null ? '–' : pct(r.ciRate)}</span><div class="cell-sub nowrap">${r.wkOk} av ${r.wk} veckor</div>` },
          { key: 'doc', label: 'Dokumentation', num: true, render: (r) => html`<span class="strong nowrap">${fmtMin(r.docMedian)}</span><div class="cell-sub nowrap">median utan AI</div>` },
          { key: 'rem', label: 'Påminnelser', num: true, render: (r) => html`<span class="strong">${r.reminders}</span><div class="cell-sub nowrap">${r.escalated} eskalerade</div>` },
        ]} footer=${html`<tr><td>Alla coacher</td><td class="num">${tot.active}</td><td>${all.value == null ? '–' : pct(all.value)}<div class="cell-sub nowrap">${all.num} av ${all.den}</div></td><td class="num">${tot.reg ? pct(tot.att / tot.reg) : '–'}</td><td class="num">${tot.wk ? pct(tot.wkOk / tot.wk) : '–'}</td><td class="num">${fmtMin(allDoc)}</td><td class="num">${tot.reminders}<div class="cell-sub nowrap">${tot.escalated} eskalerade</div></td></tr>`} />
      <//>
      <div class="grid-3">
        <${ui.Notice} tone="info" title="Så räknas det">Resultatgrad: avslut med verifierat resultat delat med avslut som räknas. Under ${k.minN} avslut markeras underlaget som för litet och ingen flagga sätts. Närvarograd: närvarande eller sen delat med registrerade tillfällen. Godkända avstämningar: andel veckor med en godkänd veckoavstämning (startveckor och pausade veckor räknas inte).<//>
        <${ui.Notice} tone="info" title="Dokumentationstid – baslinje">Median minuter från avstämningens slut till godkänd dokumentation, för avstämningar gjorda <b>utan AI</b>. Baslinjen mäts i fas 1. Internt mål: högst ${INTERNAL_GOALS.docMinutes} minuter. Tidsvinsten med AI-stöd jämförs mot baslinjen i fas 2.<//>
        <${ui.Notice} tone="warn" title="Påminnelser och eskaleringar">Coachen får en påminnelse när ett ärende saknar progression en vecka. Efter ${sel.orgRules().progressionWatch.escalateAfterConsecutiveWeeks} veckor i rad eskaleras det till dig. Coachen ser bara sina påminnelser – aldrig eskaleringen eller den här jämförelsen.<//>
      </div>
    </div>`;
  };

  // ------------------------------------------------------------ Flik: Per avtalsområde
  const AreaTab = () => {
    const k = kpiCfg('resultatgrad'); const minN = k.minN; const small = MM.cfg().pulse.minNForAggregate;
    const rows = useMemo(() => S().areas.filter((a) => a.contractId === 'c-bot').map((a) => {
      const cs = S().cases.filter((c) => c.primaryArea === a.code);
      const rr = sel.resultRate({ area: a.code, from: MM.contract().startsOn });
      return { id: a.code, code: a.code, name: a.name, active: cs.filter((c) => c.status === 'active').length, closed: cs.filter((c) => c.status === 'closed').length, rr };
    }), [MM.store.version]);
    const maxActive = Math.max(1, ...rows.map((r) => r.active));
    const tot = { active: MM.sum(rows, (r) => r.active), closed: MM.sum(rows, (r) => r.closed) };
    const all = sel.resultRate({ from: MM.contract().startsOn });
    const smallCount = rows.filter((r) => r.rr.den < minN).length;
    return html`<div class="stack-lg">
      <div class="ldg-tiles">
        <${ui.Kpi} label="Aktiva deltagare" value=${String(tot.active)} sub=${`i ${rows.filter((r) => r.active > 0).length} av ${rows.length} avtalsområden`} />
        <${ui.Kpi} label="Avslutade sedan start" value=${String(tot.closed)} sub=${`${all.num} med verifierat resultat`} />
        <${ui.Kpi} label="Områden med litet underlag" value=${String(smallCount)} sub=${`färre än ${minN} avslut som räknas`} />
      </div>
      <${ui.Card} title="Per avtalsområde" icon="grid" flush actions=${html`<span class="small muted">Resultatgrad sedan avtalsstart</span>`}>
        <${ui.Table} caption="Deltagare och resultat per avtalsområde" rows=${rows} columns=${[
          { key: 'name', label: 'Avtalsområde', render: (r) => html`<span class="strong">${r.code}</span> ${r.name}` },
          { key: 'active', label: 'Aktiva', render: (r) => html`<div class="row-sm" style="flex-wrap:nowrap;min-width:110px"><span class="num strong" style="min-width:2ch;text-align:right">${r.active}</span><div style="flex:1"><${MiniBar} value=${r.active} max=${maxActive} tone="blue" label=${`${r.active} aktiva`} /></div></div>` },
          { key: 'closed', label: 'Avslutade', num: true },
          { key: 'rr', label: 'Resultatgrad', num: true, nowrap: true, render: (r) => (r.rr.value == null ? html`<span class="muted">–</span>` : html`<span class=${r.rr.den < minN ? 'muted' : 'strong'}>${pct(r.rr.value)}</span><div class="cell-sub">${r.rr.num} av ${r.rr.den}</div>`) },
          { key: 'n', label: 'Underlag', render: (r) => (r.rr.den >= minN ? html`<${ui.Badge} tone="outline" icon="check">Tillräckligt<//>`
            : html`<div class="stack-sm" style="gap:2px"><${ui.Badge} tone="grey" icon="alert-circle">Litet underlag<//>${r.rr.den > 0 && r.rr.den < small && html`<span class="cell-sub">Kommunen ser "färre än ${small}"</span>`}</div>`) },
        ]} footer=${html`<tr><td>Alla områden</td><td>${tot.active}</td><td class="num">${tot.closed}</td><td class="num">${all.value == null ? '–' : pct(all.value)}</td><td></td></tr>`} />
      <//>
      <${ui.Notice} tone="info" title="Små grupper">Resultatgrad i områden med färre än ${minN} avslut svänger kraftigt och ska inte jämföras rakt av. I beställarrapporten till kommunen redovisas grupper med färre än ${small} personer som "färre än ${small}".<//>
    </div>`;
  };

  // ------------------------------------------------------------ Flik: Deltagarnas röst (puls)
  const PULSE_Q = [
    { key: 'q1', text: 'Hur trivs du hos oss?' },
    { key: 'q2', text: 'Känner du att du kommer närmare jobb eller studier?' },
    { key: 'q3', text: 'Får du det stöd du behöver av din coach?' },
  ];
  const SCALE = ['1 – Mycket dåligt', '2 – Dåligt', '3 – Varken eller', '4 – Bra', '5 – Mycket bra'];
  const PRIORITY = { jobb: 'Hitta jobb', praktik: 'Praktik', utbildning: 'Utbildning', svenska: 'Bli säkrare på svenska', annat: 'Annat' };
  const Dist = ({ counts }) => {
    const total = MM.sum(counts);
    return html`<div class="ldg-dist">${counts.slice().reverse().map((n, ri) => { const i = 4 - ri; return html`
      <span class="small">${SCALE[i]}</span>
      <${MiniBar} value=${total ? n / total : 0} tone=${i >= 3 ? 'blue' : undefined} label=${`${SCALE[i]}: ${n} svar`} />
      <span class="v small">${n} · ${total ? pct0(n / total) : '–'}</span>`; })}</div>`;
  };
  const PulseTab = ({ onAck }) => {
    const st = useMemo(() => sel.pulseStats(), [MM.store.version]);
    const minN = st.minN;
    const lowAlerts = sel.alerts({ role: 'chef', personaId: MM.currentPersonaId(), includeAcked: true }).filter((a) => a.kind === 'pulse_low');
    const contact = S().pulseResponses.filter((p) => p.contactRequested).length;
    const perCoach = useMemo(() => sel.coaches().map((u) => ({ id: u.id, name: u.name, s: sel.pulseStats({ coachId: u.id }) })), [MM.store.version]);
    const prio = Object.entries(st.priorities || {}).sort((a, b) => b[1] - a[1]);
    const prioTotal = MM.sum(prio, (x) => x[1]);
    const rateOk = st.responseRate != null && st.responseRate >= INTERNAL_GOALS.pulseResponseRate;
    return html`<div class="stack-lg">
      <div class="row-between"><div class="row-sm"><${ui.BuildPhase} fas=${2} /><span class="small muted">Rullande 3 månader · vecka 2 och vid avslut, plus var 30:e dag för längre insatser</span></div>
        ${MM.views['puls.svar'] ? html`<span class="ldg-wrapbtn"><${ui.PerspectiveSwitch} role="deltagare" view="puls.svar" label="Se pulsmätningen som deltagaren" /></span>` : null}</div>
      ${!st.enough ? html`<${ui.Notice} tone="info" title=${`Färre än ${minN} svar`}>Aggregat visas först när det finns minst ${minN} svar. Det skyddar deltagarna från att kunna identifieras.<//>` : html`
      <div class="ldg-tiles">
        <${ui.Kpi} label="Svarsfrekvens" value=${pct(st.responseRate)} tone=${rateOk ? undefined : 'watch'} sub=${`${st.responses} svar på ${st.invites} utskick · mål ${pct0(INTERNAL_GOALS.pulseResponseRate)}`}>
          <${ui.Badge} tone=${rateOk ? 'blue' : 'grey'} icon=${rateOk ? 'check-circle' : 'alert-circle'}>${rateOk ? 'Når målet' : 'Under målet'}<//><//>
        <${ui.Kpi} label="Nöjdhet" value=${pct(st.satisfaction)} sub="Andel som svarat 4 eller 5 på fråga 1 (trivsel)" />
        <${ui.Kpi} label="Närmare jobb eller studier" value=${pct(st.closer)} sub="Andel 4 eller 5 på fråga 2" />
        <${ui.Kpi} label="Stöd från coachen" value=${pct(st.support)} sub="Andel 4 eller 5 på fråga 3" />
      </div>
      <div class="split">
        <${ui.Card} title="Fördelning per fråga" icon="chart">
          <div class="stack-lg">${PULSE_Q.map((q, i) => html`<div class="stack-sm" key=${q.key}><div class="strong">${i + 1}. ${q.text}</div><${Dist} counts=${st[q.key]} /></div>`)}</div>
        <//>
        <div class="stack">
          <${ui.Card} title="Vad är viktigast just nu?" icon="compass">
            <div class="ldg-dist">${prio.map(([key, n]) => html`
              <span class="small">${PRIORITY[key] || key}</span>
              <${MiniBar} value=${prioTotal ? n / prioTotal : 0} label=${`${PRIORITY[key] || key}: ${n}`} />
              <span class="v small">${n} · ${prioTotal ? pct0(n / prioTotal) : '–'}</span>`)}</div>
            <div class="small muted" style="margin-top:10px">Fråga 4. Används för att planera praktik, utbildning och språkstöd.</div>
          <//>
          <${ui.Card} title="Lågt betyg på stödet från coachen" icon="frown" tone=${lowAlerts.some((a) => !a.ack) ? 'red' : undefined}>
            <div class="stack">
              <p class="small">Svar med 1 eller 2 på fråga 3 går till dig som chef – <b>inte till coachen</b>. Du ser datum och betyg, inte vem som svarat.</p>
              ${lowAlerts.length === 0 ? html`<span class="small muted">Inga låga betyg de senaste veckorna.</span>` : html`<div>${lowAlerts.map((a) => html`<${AlertRow} key=${a.key} a=${a} onAck=${onAck} />`)}</div>`}
            </div>
          <//>
          <${ui.Card} title="Önskar kontakt" icon="phone">
            <p><b>${fmt.plural(contact, 'deltagare', 'deltagare')}</b> har svarat Ja på fråga 5 (vill bli kontaktad). Det blir en uppgift till samordnaren, som avgör vem som tar kontakten.</p>
          <//>
        </div>
      </div>
      <${ui.Card} title="Per coach" icon="users" flush>
        <${ui.Table} caption="Pulsmätning per coach" rows=${perCoach} columns=${[
          { key: 'name', label: 'Coach', render: (r) => html`<${ui.UserName} id=${r.id} />` },
          { key: 'n', label: 'Svar', num: true, render: (r) => r.s.responses },
          { key: 'sat', label: 'Nöjdhet', num: true, render: (r) => (r.s.enough ? pct(r.s.satisfaction) : html`<span class="muted">Färre än ${minN} svar</span>`) },
          { key: 'sup', label: 'Stöd från coachen', num: true, render: (r) => (r.s.enough ? pct(r.s.support) : html`<span class="muted">–</span>`) },
          { key: 'rate', label: 'Svarsfrekvens', num: true, render: (r) => (r.s.enough && r.s.responseRate != null ? pct(r.s.responseRate) : html`<span class="muted">–</span>`) },
        ]} />
      <//>`}
      <${ui.Notice} tone="info" title="Vem ser vad">
        <ul style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:4px">
          <li>Coachen ser inte enskilda svar – bara samma aggregat som här, och först vid minst ${minN} svar.</li>
          <li>Lågt betyg på stödet från coachen (fråga 3) går till chef, inte till coachen.</li>
          <li>Svarar deltagaren Ja på fråga 5 får samordnaren en uppgift.</li>
          <li>Kommunen ser antal svar och andel nöjda i beställarrapporten.</li>
        </ul>
      <//>
      <${ui.DemoNote}>Svaren är påhittade. I den riktiga tjänsten skickas pulslänken som SMS eller e-post (signerad engångslänk som gäller i 7 dagar), aldrig till deltagare med skyddade personuppgifter. Deltagandet är frivilligt.<//>
    </div>`;
  };

  // ------------------------------------------------------------ Vy: chef.oversikt
  const TABS = [
    { id: 'kpi', label: 'Resultat och KPI:er', icon: 'target' },
    { id: 'coacher', label: 'Per coach', icon: 'users' },
    { id: 'omraden', label: 'Per avtalsområde', icon: 'grid' },
    { id: 'puls', label: 'Deltagarnas röst', icon: 'smile' },
  ];
  const Oversikt = ({ params }) => {
    MM.useStore();
    const tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'kpi';
    const [ackAlert, setAckAlert] = useState(null);
    const data = useMemo(() => (tab === 'kpi' ? buildOverview() : null), [MM.store.version, tab]);
    const alertCount = useMemo(() => sel.alerts({ role: 'chef', personaId: MM.currentPersonaId() }).length, [MM.store.version]);
    return html`<${ui.Page} title="Ledningsvy" eyebrow=${`Chef och controller · ${MM.contract().customerName}, avtal ${MM.contract().contractNumber}`}
      lead="Resultat mot mål, flaggor och tidig uppmärksamhet. Allt är i läsläge – du kvitterar flaggor med en kort åtgärdsplan."
      actions=${html`<span class="ldg-wrapbtn"><${ui.PerspectiveSwitch} role="kommun_chef" view="kom.chef" label="Så ser kommunens chef resultatet – utan internt mål" /></span>`}>
      <${ui.Tabs} ariaLabel="Ledningsvyns flikar" active=${tab} onChange=${(id) => MM.nav('chef.oversikt', id === 'kpi' ? {} : { tab: id }, { replace: true })}
        tabs=${TABS.map((t) => (t.id === 'kpi' ? { ...t, count: alertCount } : t))} />
      ${tab === 'kpi' && html`<${KpiTab} data=${data} onAck=${setAckAlert} />`}
      ${tab === 'coacher' && html`<${CoachTab} />`}
      ${tab === 'omraden' && html`<${AreaTab} />`}
      ${tab === 'puls' && html`<${PulseTab} onAck=${setAckAlert} />`}
      ${ackAlert && html`<${AckModal} alert=${ackAlert} onClose=${() => setAckAlert(null)} />`}
    <//>`;
  };
  MM.registerView('chef.oversikt', { title: 'Ledningsvy', roles: ['chef'], component: Oversikt });

  // ============================================================ Avtalsavvikelser (SPEC §7.16)
  const CD_TYPES = () => [
    { value: 'kvalitet', label: 'Kvalitet', help: 'Insatsen eller rapporteringen håller inte den kvalitet som avtalet kräver.' },
    { value: 'process', label: 'Process', help: 'En rutin eller tidsgräns har inte följts, till exempel en rapport som kom för sent.' },
    { value: 'avtal', label: 'Avtal', help: 'Ett avtalskrav har inte uppfyllts, till exempel kontinuitet eller bemanning.' },
    { value: 'ekonomi', label: 'Ekonomi', help: MM.cfg().economicDeviation },
    { value: 'klagomål', label: 'Klagomål', help: 'Klagomål eller reklamation från deltagare, arbetsgivare eller kommunen. Registreras i samma register.' },
  ];
  const typeLabel = (t) => (CD_TYPES().find((x) => x.value === t) || { label: t || '–' }).label;
  const CD_LEVELS = [
    { value: 'mindre', label: 'Mindre', step: 0, help: 'Påverkar inte kärnverksamheten och kan åtgärdas enkelt och snabbt.' },
    { value: 'större', label: 'Större', step: 1, help: 'Återkommande mindre avvikelser eller något som kännbart påverkar verksamheten.' },
    { value: 'allvarlig', label: 'Allvarlig', step: 2, help: 'Återkommande större avvikelser eller avbrott i kärnverksamheten.' },
  ];
  const levelLabel = (l) => (CD_LEVELS.find((x) => x.value === l) || { label: l || '–' }).label;
  const CD_SOURCES = [
    { value: 'beställare', label: 'Kommunen påtalade' },
    { value: 'intern', label: 'Upptäckt internt' },
    { value: 'deltagare', label: 'Deltagare' },
    { value: 'arbetsgivare', label: 'Arbetsgivare' },
  ];
  const sourceLabel = (s) => (CD_SOURCES.find((x) => x.value === s) || { label: s || '–' }).label;
  const ladder = () => MM.cfg().escalationLadder;
  const stepLabel = (n) => { const s = ladder().find((x) => x.step === n); return s ? `Steg ${n} · ${s.level.charAt(0).toUpperCase()}${s.level.slice(1)}` : `Steg ${n}`; };
  /** Visningsstatus räknas fram ur fälten så att kommunens godkännande (kom.approveActionPlan) slår igenom direkt. */
  const cdStatus = (cd) => {
    if (cd.status === 'closed') return { key: 'closed', label: 'Klar', tone: 'blue', icon: 'check-circle' };
    if (!String(cd.actionPlan || '').trim()) return { key: 'no_plan', label: 'Åtgärdsplan saknas', tone: 'red', icon: 'alert' };
    if (!cd.customerApprovedAt) return { key: 'waiting', label: 'Väntar på kommunens godkännande', tone: 'grey', icon: 'clock' };
    return { key: 'in_progress', label: 'Åtgärdsplan godkänd – pågår', tone: 'bluetone', icon: 'activity' };
  };
  const CdStatus = ({ cd }) => { const s = cdStatus(cd); return html`<${ui.Badge} tone=${s.tone} icon=${s.icon}>${s.label}<//>`; };
  const closedOn = (cd) => (cd.status === 'closed' ? (cd.closedAt || (cd.actionPlanDue ? `${cd.actionPlanDue}T16:00` : cd.raisedAt)) : null);
  const canManage = (role) => ['chef', 'avtalsansvarig'].includes(role);

  // ---- Åtgärder (prefix cdev.)
  const CD_FIELDS = ['type', 'level', 'source', 'escalationStep', 'description', 'caseId', 'actionPlan', 'actionPlanDue', 'ownerId', 'warningIssued', 'penaltyKind', 'penaltyOre', 'penaltyOffsetMonth', 'orderStop', 'lessons'];
  /** Skapa eller uppdatera en avtalsavvikelse/ett klagomål. p = { id?, data: {...} } → { id } eller { error, missing } */
  MM.defineAction('cdev.save', (st, p, ctx) => {
    const data = p.data || {};
    let cd = p.id ? st.contractDeviations.find((x) => x.id === p.id) : null;
    const isNew = !cd;
    if (isNew) {
      const missing = ['type', 'level', 'source', 'description'].filter((k) => !String(data[k] ?? '').trim());
      if (missing.length) return { error: 'missing', missing };
      cd = { id: ctx.id('cd'), contractId: 'c-bot', raisedAt: ctx.now, registeredBy: ctx.actorId, escalationStep: 0, actionPlan: '', actionPlanDue: null, ownerId: null,
        customerApprovedAt: null, warningIssued: false, penaltyOre: 0, orderStop: false, status: 'open', lessons: '', createdInDemo: true };
      st.contractDeviations.push(cd);
    }
    const step = data.escalationStep != null ? Number(data.escalationStep) : cd.escalationStep;
    if (data.warningIssued && !(step >= 1 && step <= 3)) return { error: 'warning_step' };
    const planBefore = String(cd.actionPlan || ''); const changed = [];
    for (const k of CD_FIELDS) if (k in data && cd[k] !== data[k]) { cd[k] = data[k]; changed.push(k); }
    cd.escalationStep = step;
    if (data.raisedOn) cd.raisedAt = `${data.raisedOn}T${String(ctx.now).slice(11, 16)}`;
    if (data.warningIssued && !cd.warningIssuedAt) cd.warningIssuedAt = ctx.now;
    if (data.warningIssued === false) cd.warningIssuedAt = null;
    let sentToCustomer = false;
    if (String(cd.actionPlan || '').trim() && cd.actionPlan !== planBefore) {
      cd.customerApprovedAt = null; cd.planSubmittedAt = ctx.now; if (cd.status !== 'closed') cd.status = 'action_plan';
      const chef = st.customerUsers.find((u) => u.role === 'chef');
      ctx.notify('email', chef ? chef.email : 'kommunens chef', 'atgardsplan_godkannande', 'En åtgärdsplan inom avtalet med Miljonbemanning väntar på ert godkännande. Logga in i portalen för att läsa den.', null);
      sentToCustomer = true;
    }
    ctx.audit(isNew ? 'contract_deviation.created' : 'contract_deviation.updated', 'contract_deviation', cd.id, { type: cd.type, level: cd.level, step: cd.escalationStep, fields: changed, sentToCustomer });
    return { id: cd.id, sentToCustomer };
  });
  /** Markera som klar med lärdomar. p = { id, lessons } */
  MM.defineAction('cdev.close', (st, p, ctx) => {
    const cd = st.contractDeviations.find((x) => x.id === p.id); if (!cd) return { error: 'not_found' };
    if (!String(p.lessons || '').trim()) return { error: 'lessons' };
    cd.status = 'closed'; cd.closedAt = ctx.now; cd.closedBy = ctx.actorId; cd.lessons = String(p.lessons).trim();
    ctx.audit('contract_deviation.closed', 'contract_deviation', cd.id, { hadCustomerApproval: !!cd.customerApprovedAt });
    return { id: cd.id };
  });

  // ---- Eskaleringstrappa
  /** Texten efter tankstrecket ("Mindre avvikelse – påverkar inte …" → "Påverkar inte …"). */
  const shortStepText = (t) => { const i = t.indexOf(' – '); const x = i > 0 ? t.slice(i + 3) : t; return x.charAt(0).toUpperCase() + x.slice(1); };
  const Ladder = ({ current = null, counts = null, vertical }) => html`
    <ol class=${MM.cls('ldg-ladder', vertical && 'vertical')} aria-label="Eskaleringstrappan">
      ${ladder().map((s) => {
        const cur = current === s.step; const n = counts ? counts[s.step] || 0 : 0;
        return html`<li key=${s.step} class=${MM.cls('ldg-step', cur && 'cur', s.step === ladder().length - 1 && 'end')} style=${vertical ? '' : `margin-top:${(ladder().length - 1 - s.step) * 18}px`} aria-current=${cur ? 'step' : undefined}>
          <span class="n">Steg ${s.step}</span>
          <span class="t">${s.level.charAt(0).toUpperCase()}${s.level.slice(1)}</span>
          ${(!vertical || cur) && html`<span class=${cur ? 'small' : 'small muted'}>${shortStepText(s.text)}</span>`}
          ${counts && html`<span class="small strong" style="margin-top:auto">${n > 0 ? fmt.plural(n, 'öppen', 'öppna') : 'Inga öppna'}</span>`}
          ${cur && !counts && html`<span class="small strong" style="margin-top:auto">Här ligger avvikelsen</span>`}
        </li>`;
      })}
    </ol>`;

  // ---- Formulär: ny avvikelse eller klagomål
  const NewDeviationModal = ({ onClose, role }) => {
    const cfg = MM.cfg();
    const [f, setF] = useState({ type: '', source: '', level: '', escalationStep: '', raisedOn: d.today(), description: '', caseNumber: '', actionPlan: '', actionPlanDue: '', ownerId: MM.currentPersonaId() || '', warningIssued: false, penaltyKind: '', penaltyOffsetMonth: '', orderStop: false });
    const [err, setErr] = useState({});
    const [stepTouched, setStepTouched] = useState(false);
    const set = (k) => (v) => {
      if (k === 'escalationStep') setStepTouched(true);
      setF((o) => {
        const n = { ...o, [k]: v };
        if (k === 'level' && !stepTouched) n.escalationStep = String((CD_LEVELS.find((x) => x.value === v) || {}).step ?? 0);
        const s = Number(n.escalationStep);
        if (n.escalationStep === '' || !(s >= 1 && s <= 3)) n.warningIssued = false;
        return n;
      });
      setErr((e) => ({ ...e, [k]: null }));
    };
    const typeHelp = (CD_TYPES().find((x) => x.value === f.type) || {}).help;
    const levelHelp = (CD_LEVELS.find((x) => x.value === f.level) || {}).help;
    const step = f.escalationStep === '' ? null : Number(f.escalationStep);
    const months = []; for (let mk = d.monthKey(d.today()); months.length < 3; mk = d.addMonths(mk, 1)) months.push(mk);
    const save = () => {
      const e = {};
      if (!f.type) e.type = 'Välj typ av avvikelse.';
      if (!f.source) e.source = 'Välj varifrån avvikelsen kommer.';
      if (!f.level) e.level = 'Välj nivå.';
      if (f.description.trim().length < 10) e.description = 'Beskriv vad som hänt med minst en mening.';
      if (!f.raisedOn) e.raisedOn = 'Ange datum.';
      let caseId = null;
      if (f.caseNumber.trim()) { const c = sel.caseByNumber(f.caseNumber.trim().toUpperCase()); if (!c) e.caseNumber = 'Hittar inget ärende med det numret. Skriv till exempel BOT-26-0042.'; else caseId = c.id; }
      if (f.actionPlan.trim() && !f.actionPlanDue) e.actionPlanDue = 'Ange när åtgärderna ska vara klara.';
      if (Object.keys(e).length) { setErr(e); return; }
      const penaltyOre = f.penaltyKind === 'deviation' ? cfg.penalties.deviationOre : f.penaltyKind === 'information' ? cfg.penalties.insufficientInformationOre : 0;
      const res = MM.dispatch('cdev.save', { data: { type: f.type, source: f.source, level: f.level, escalationStep: step ?? 0, raisedOn: f.raisedOn, description: f.description.trim(), caseId,
        actionPlan: f.actionPlan.trim(), actionPlanDue: f.actionPlanDue || null, ownerId: f.ownerId || null, warningIssued: !!f.warningIssued, penaltyKind: f.penaltyKind || null, penaltyOre,
        penaltyOffsetMonth: penaltyOre ? f.penaltyOffsetMonth || null : null, orderStop: !!f.orderStop } });
      if (!res || res.error) { MM.toast(res && res.error === 'warning_step' ? 'Skriftlig varning kan bara ges på steg 1–3.' : 'Avvikelsen kunde inte sparas. Kontrollera fälten.', 'red'); if (res && res.missing) setErr(Object.fromEntries(res.missing.map((k) => [k, 'Obligatoriskt fält.']))); return; }
      MM.toast(`${f.type === 'klagomål' ? 'Klagomålet' : 'Avvikelsen'} är registrerad.${res.sentToCustomer ? ' Kommunens chef har fått en notis om att åtgärdsplanen väntar på godkännande.' : ''}`, 'blue');
      onClose(); MM.nav('chef.avvikelser', { id: res.id });
    };
    return html`<${ui.Modal} wide title="Registrera avvikelse eller klagomål" onClose=${onClose}
      footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${save}>Registrera<//>`}>
      <div class="form-grid">
        <${ui.Field} full label="Typ" id="cd-type" required help=${typeHelp || 'Kvalitet, process, avtal, ekonomi eller klagomål.'} error=${err.type}>
          <${ui.Seg} id="cd-type" ariaLabel="Typ" value=${f.type} onChange=${set('type')} options=${CD_TYPES().map((x) => ({ value: x.value, label: x.label }))} />
        <//>
        <${ui.Field} label="Källa" id="cd-source" required help="Vem påtalade eller upptäckte avvikelsen?" error=${err.source}>
          <${ui.Select} id="cd-source" value=${f.source} onChange=${set('source')} placeholder="Välj källa" options=${CD_SOURCES} invalid=${!!err.source} />
        <//>
        <${ui.Field} label="Datum" id="cd-date" required help="När avvikelsen påtalades eller upptäcktes." error=${err.raisedOn}>
          <${ui.Input} id="cd-date" type="date" value=${f.raisedOn} onInput=${set('raisedOn')} invalid=${!!err.raisedOn} />
        <//>
        <${ui.Field} label="Nivå" id="cd-level" required help=${levelHelp || 'Mindre, större eller allvarlig enligt avtalet.'} error=${err.level}>
          <${ui.Seg} id="cd-level" ariaLabel="Nivå" value=${f.level} onChange=${set('level')} options=${CD_LEVELS.map((x) => ({ value: x.value, label: x.label }))} />
        <//>
        <${ui.Field} label="Steg i eskaleringstrappan" id="cd-step" help="Föreslås utifrån nivån. Ändra om kommunen har angett ett annat steg.">
          <${ui.Select} id="cd-step" value=${f.escalationStep} onChange=${set('escalationStep')} placeholder="Välj steg" options=${ladder().map((s) => ({ value: String(s.step), label: stepLabel(s.step) }))} />
        <//>
        <${ui.Field} full label="Beskrivning" id="cd-desc" required help="Beskriv vad som hänt. Skriv inga namn eller personnummer – använd ärendenummer." error=${err.description}>
          <${ui.TextArea} id="cd-desc" value=${f.description} onInput=${set('description')} rows=${3} invalid=${!!err.description} />
        <//>
        <${ui.Field} label="Ärendenummer (valfritt)" id="cd-case" help="Om avvikelsen gäller ett visst ärende, till exempel BOT-26-0042." error=${err.caseNumber}>
          <${ui.Input} id="cd-case" value=${f.caseNumber} onInput=${set('caseNumber')} invalid=${!!err.caseNumber} />
        <//>
        <${ui.Field} label="Ansvarig hos Miljonbemanning" id="cd-owner" help="Den som driver åtgärderna.">
          <${ui.Select} id="cd-owner" value=${f.ownerId} onChange=${set('ownerId')} options=${mbUsers().map((u) => ({ value: u.id, label: `${u.name} – ${u.title}` }))} />
        <//>
        <${ui.Field} full label="Åtgärdsplan (kan fyllas i senare)" id="cd-plan" help="Vad görs, av vem och när? Planen skickas till kommunens chef för godkännande.">
          <${ui.TextArea} id="cd-plan" value=${f.actionPlan} onInput=${set('actionPlan')} rows=${3} />
        <//>
        <${ui.Field} label="Åtgärderna klara senast" id="cd-due" help="Tidsplan för åtgärdsplanen." error=${err.actionPlanDue}>
          <${ui.Input} id="cd-due" type="date" value=${f.actionPlanDue} onInput=${set('actionPlanDue')} invalid=${!!err.actionPlanDue} />
        <//>
        <div class="full stack-sm">
          <span class="label-caps">Sanktioner från kommunen</span>
          <${ui.Check} id="cd-warning" checked=${f.warningIssued} disabled=${!(step >= 1 && step <= 3) || !canManage(role)} onChange=${set('warningIssued')}>Kommunen har gett en skriftlig varning (räknas mot ${cfg.warningsBeforeTermination}). Kan bara ges på steg 1–3.<//>
          <${ui.Field} label="Vite" id="cd-penalty" help=${`Enligt avtalet ${fmt.kr(cfg.penalties.deviationOre)} per tillfälle vid avvikelse och ${fmt.kr(cfg.penalties.insufficientInformationOre)} vid bristfällig löpande information.`}>
            <${ui.Select} id="cd-penalty" value=${f.penaltyKind} onChange=${set('penaltyKind')} disabled=${!canManage(role)} options=${[{ value: '', label: 'Inget vite' }, { value: 'deviation', label: `Vite för avvikelse – ${fmt.kr(cfg.penalties.deviationOre)}` }, { value: 'information', label: `Vite för bristfällig information – ${fmt.kr(cfg.penalties.insufficientInformationOre)}` }]} />
          <//>
          ${f.penaltyKind && html`<${ui.Field} label="Avräknas på faktura för" id="cd-offset" help="Kommunen kan avräkna vitet på en kommande faktura.">
            <${ui.Select} id="cd-offset" value=${f.penaltyOffsetMonth} onChange=${set('penaltyOffsetMonth')} placeholder="Inte bestämt" options=${months.map((mk) => ({ value: mk, label: d.monthName(mk) }))} />
          <//>`}
          <${ui.Check} id="cd-stop" checked=${f.orderStop} disabled=${!canManage(role)} onChange=${set('orderStop')}>Kommunen har beslutat om avropsstopp<//>
          ${!canManage(role) && html`<span class="small muted">Varningar, viten och avropsstopp registreras av avtalsansvarig eller chef.</span>`}
        </div>
      </div>
    <//>`;
  };

  // ---- Månadssammanställning för APT/kvalitetsmöte
  const monthSummary = (mk) => {
    const start = `${mk}-01`; const end = d.monthEnd(mk);
    const all = S().contractDeviations;
    const inMonth = (s) => s && s.slice(0, 10) >= start && s.slice(0, 10) <= end;
    const created = all.filter((x) => inMonth(x.raisedAt));
    const openAtEnd = all.filter((x) => x.raisedAt.slice(0, 10) <= end && !(closedOn(x) && closedOn(x).slice(0, 10) <= end));
    const closed = all.filter((x) => inMonth(closedOn(x)));
    const actions = all.filter((x) => x.actionPlan && x.raisedAt.slice(0, 10) <= end && (!closedOn(x) || closedOn(x).slice(0, 10) >= start));
    const lessons = all.filter((x) => x.lessons && x.raisedAt.slice(0, 10) <= end);
    const participantDevs = S().deviations.filter((x) => inMonth(x.createdAt));
    const complaints = created.filter((x) => x.type === 'klagomål');
    const warnings = all.filter((x) => x.warningIssued && (x.warningIssuedAt || x.raisedAt).slice(0, 10) <= end).length;
    const penalties = MM.sum(all.filter((x) => x.penaltyOre && x.raisedAt.slice(0, 10) <= end), (x) => x.penaltyOre);
    return { mk, created, openAtEnd, closed, actions, lessons, participantDevs, complaints, warnings, penalties };
  };
  const summaryText = (s) => {
    const cfg = MM.cfg(); const line = (x) => `- ${typeLabel(x.type)}, ${levelLabel(x.level).toLowerCase()} (steg ${x.escalationStep}): ${x.description}`;
    return [
      `Månadssammanställning avtalsavvikelser och klagomål – ${d.monthName(s.mk)}`,
      `Avtal ${MM.contract().contractNumber}, ${MM.contract().customerName}`, '',
      `Nya under månaden: ${s.created.length} (varav klagomål: ${s.complaints.length})`, ...s.created.map(line), '',
      `Öppna vid månadens slut: ${s.openAtEnd.length}`, ...s.openAtEnd.map(line), '',
      'Åtgärder:', ...(s.actions.length ? s.actions.map((x) => `- ${x.actionPlan} (klart senast ${x.actionPlanDue ? d.fmtDate(x.actionPlanDue) : 'datum saknas'}; ${cdStatus(x).label.toLowerCase()})`) : ['- Inga']), '',
      'Lärdomar:', ...(s.lessons.length ? s.lessons.map((x) => `- ${x.lessons}`) : ['- Inga registrerade']), '',
      `Avvikelser på deltagarnivå (från veckoavstämningar): ${s.participantDevs.length}`,
      `Skriftliga varningar hittills: ${s.warnings} av ${cfg.warningsBeforeTermination}`,
      `Viten hittills: ${fmt.kr(s.penalties)}`,
    ].join('\n');
  };
  const MonthSummary = () => {
    const [mk, setMk] = useState(lastMonth());
    const months = []; for (let m = d.monthKey(MM.contract().startsOn); m <= d.monthKey(d.today()); m = d.addMonths(m, 1)) months.push(m);
    const s = useMemo(() => monthSummary(mk), [mk, MM.store.version]);
    const cfg = MM.cfg();
    const Item = ({ x, children }) => html`<li><span class="strong">${typeLabel(x.type)}, ${levelLabel(x.level).toLowerCase()}</span> – ${x.description} ${children}</li>`;
    return html`<${ui.Card} title=${`Underlag för APT och kvalitetsmöte – ${d.monthName(mk)}`} icon="clipboard"
      actions=${html`<${ui.Btn} kind="secondary" icon="copy" onClick=${() => MM.copy(summaryText(s))}>Kopiera text<//><${ui.Btn} kind="ghost" icon="download" onClick=${() => MM.download(`avvikelser-${mk}.txt`, summaryText(s), 'text/plain;charset=utf-8')}>Exportera<//>`}>
      <div class="stack ldg-summary">
        <${ui.Field} label="Månad" id="ldg-apt-month" help="Sammanställningen räknas fram ur registret för vald månad.">
          <${ui.Select} id="ldg-apt-month" value=${mk} onChange=${setMk} options=${months.map((m) => ({ value: m, label: d.monthName(m) }))} />
        <//>
        <div class="ldg-tiles">
          <${ui.Kpi} label="Nya under månaden" value=${String(s.created.length)} sub=${`varav ${s.complaints.length} klagomål`} />
          <${ui.Kpi} label="Öppna vid månadens slut" value=${String(s.openAtEnd.length)} />
          <${ui.Kpi} label="Avslutade" value=${String(s.closed.length)} />
          <${ui.Kpi} label="Avvikelser på deltagarnivå" value=${String(s.participantDevs.length)} sub="Från veckoavstämningar med röd status" />
        </div>
        <h3>Nya och öppna</h3>
        ${s.openAtEnd.length + s.created.length === 0 ? html`<p class="muted">Inga avvikelser eller klagomål.</p>` : html`<ul>
          ${MM.uniq([...s.created, ...s.openAtEnd]).map((x) => html`<${Item} key=${x.id} x=${x}>${s.created.includes(x) ? html`<${ui.Badge} tone="dark">Ny<//>` : ''} <${CdStatus} cd=${x} /><//>`)}</ul>`}
        <h3>Åtgärder</h3>
        ${s.actions.length === 0 ? html`<p class="muted">Inga åtgärdsplaner under månaden.</p>` : html`<ul>${s.actions.map((x) => html`<li key=${x.id}>${x.actionPlan} <span class="small muted">(klart senast ${x.actionPlanDue ? d.fmtDate(x.actionPlanDue) : 'datum saknas'})</span> <${CdStatus} cd=${x} /></li>`)}</ul>`}
        <h3>Lärdomar</h3>
        ${s.lessons.length === 0 ? html`<p class="muted">Inga lärdomar registrerade ännu. Lärdomar skrivs när en avvikelse markeras som klar.</p>` : html`<ul>${s.lessons.map((x) => html`<li key=${x.id}>${x.lessons} <span class="small muted">(${typeLabel(x.type).toLowerCase()}, ${d.fmtDate(x.raisedAt)})</span></li>`)}</ul>`}
        <p class="small muted">Skriftliga varningar hittills: ${s.warnings} av ${cfg.warningsBeforeTermination}. Viten hittills: ${fmt.kr(s.penalties)}.</p>
      </div>
    <//>`;
  };

  // ---- Detaljvy för en avvikelse
  const Detail = ({ cd, role }) => {
    const cfg = MM.cfg();
    const [editPlan, setEditPlan] = useState(false);
    const [plan, setPlan] = useState({ actionPlan: cd.actionPlan || '', actionPlanDue: cd.actionPlanDue || '', ownerId: cd.ownerId || MM.currentPersonaId() || '' });
    const [planErr, setPlanErr] = useState({});
    const [lessons, setLessons] = useState(cd.lessons || ''); const [lessonsErr, setLessonsErr] = useState(null);
    const [editSanction, setEditSanction] = useState(false);
    const [sanc, setSanc] = useState({ escalationStep: String(cd.escalationStep ?? 0), warningIssued: !!cd.warningIssued, penaltyKind: cd.penaltyKind || (cd.penaltyOre ? 'deviation' : ''), penaltyOffsetMonth: cd.penaltyOffsetMonth || '', orderStop: !!cd.orderStop });
    const st = cdStatus(cd); const closed = cd.status === 'closed';
    const totalWarnings = S().contractDeviations.filter((x) => x.warningIssued).length;
    const chef = customerChef();
    const months = []; for (let mk = d.monthKey(d.today()); months.length < 3; mk = d.addMonths(mk, 1)) months.push(mk);
    const savePlan = () => {
      const e = {};
      if (plan.actionPlan.trim().length < 10) e.actionPlan = 'Skriv åtgärdsplanen med minst en mening.';
      if (!plan.actionPlanDue) e.actionPlanDue = 'Ange när åtgärderna ska vara klara.';
      if (Object.keys(e).length) { setPlanErr(e); return; }
      const res = MM.dispatch('cdev.save', { id: cd.id, data: { actionPlan: plan.actionPlan.trim(), actionPlanDue: plan.actionPlanDue, ownerId: plan.ownerId || null } });
      if (!res || res.error) { MM.toast('Åtgärdsplanen kunde inte sparas.', 'red'); return; }
      MM.toast(res.sentToCustomer ? 'Åtgärdsplanen är sparad och skickad till kommunens chef för godkännande. Mejlet innehåller inga personuppgifter.' : 'Åtgärdsplanen är sparad.', 'blue');
      setEditPlan(false);
    };
    const saveSanctions = () => {
      const penaltyOre = sanc.penaltyKind === 'deviation' ? cfg.penalties.deviationOre : sanc.penaltyKind === 'information' ? cfg.penalties.insufficientInformationOre : 0;
      const res = MM.dispatch('cdev.save', { id: cd.id, data: { escalationStep: Number(sanc.escalationStep), warningIssued: !!sanc.warningIssued, penaltyKind: sanc.penaltyKind || null, penaltyOre, penaltyOffsetMonth: penaltyOre ? sanc.penaltyOffsetMonth || null : null, orderStop: !!sanc.orderStop } });
      if (!res || res.error) { MM.toast(res && res.error === 'warning_step' ? 'Skriftlig varning kan bara ges på steg 1–3.' : 'Kunde inte spara.', 'red'); return; }
      MM.toast('Steg, varning och vite är sparade.', 'blue'); setEditSanction(false);
    };
    const close = () => {
      if (lessons.trim().length < 10) { setLessonsErr('Skriv vad ni har lärt er – det används i månadssammanställningen till APT.'); return; }
      MM.dispatch('cdev.close', { id: cd.id, lessons: lessons.trim() });
      MM.toast('Avvikelsen är markerad som klar. Lärdomen finns med i månadssammanställningen.', 'blue');
    };
    const timeline = [
      { icon: 'flag', title: `Registrerad – ${sourceLabel(cd.source).toLowerCase()}`, sub: d.fmtDateTime(cd.raisedAt), filled: true },
      cd.actionPlan && { icon: 'clipboard', title: 'Åtgärdsplan skickad till kommunen', sub: cd.planSubmittedAt ? d.fmtDateTime(cd.planSubmittedAt) : (cd.actionPlanDue ? `Klart senast ${d.fmtDate(cd.actionPlanDue)}` : '') },
      cd.customerApprovedAt && { icon: 'check', title: `Godkänd av kommunen${cd.customerApprovedBy ? ` (${MM.personName(cd.customerApprovedBy)})` : chef ? ` (${chef.name})` : ''}`, sub: d.fmtDateTime(cd.customerApprovedAt), filled: true },
      cd.warningIssued && { icon: 'alert', title: 'Skriftlig varning från kommunen', sub: cd.warningIssuedAt ? d.fmtDateTime(cd.warningIssuedAt) : '', tone: 'red' },
      closed && { icon: 'check-circle', title: 'Klar', sub: closedOn(cd) ? d.fmtDateTime(closedOn(cd)) : '', filled: true },
    ].filter(Boolean);
    return html`<${ui.Page} title=${cd.type === 'klagomål' ? 'Klagomål' : 'Avtalsavvikelse'} eyebrow=${`Registrerad ${d.fmtDate(cd.raisedAt)} · ${sourceLabel(cd.source)}`}
      crumbs=${[{ label: 'Avtalsavvikelser', view: 'chef.avvikelser', params: {} }, { label: `${typeLabel(cd.type)} ${d.fmtDateShort(cd.raisedAt)}` }]}
      actions=${html`<span class="ldg-wrapbtn"><${ui.PerspectiveSwitch} role="kommun_chef" view="kom.chef" label=${cd.actionPlan && !cd.customerApprovedAt && !closed ? 'Godkänn planen som kommunens chef' : 'Se kommunens chefsvy'} /></span>`}>
      <div class="row-sm"><${ui.Badge} tone="dark">${typeLabel(cd.type)}<//><${ui.Badge} tone="outline">Nivå: ${levelLabel(cd.level).toLowerCase()}<//><${ui.Badge} tone="outline" icon="layers">${stepLabel(cd.escalationStep)}<//><${CdStatus} cd=${cd} />
        ${cd.orderStop && html`<${ui.Badge} tone="red" icon="alert">Avropsstopp<//>`}</div>
      <div class="split-wide">
        <div class="stack">
          <${ui.Card} title="Beskrivning" icon="file">
            <div class="stack">
              <p>${cd.description}</p>
              <${ui.Kv} items=${[
                ['Typ', typeLabel(cd.type)], ['Nivå', levelLabel(cd.level)], ['Källa', sourceLabel(cd.source)], ['Datum', d.fmtDateTime(cd.raisedAt)],
                cd.caseId && ['Ärende', html`<${ui.CaseLink} caseId=${cd.caseId} />`],
                ['Ansvarig', cd.ownerId ? MM.personName(cd.ownerId) : 'Ingen utsedd'],
                cd.registeredBy && ['Registrerad av', MM.personName(cd.registeredBy)],
              ]} />
            </div>
          <//>
          <${ui.Card} title="Åtgärdsplan" icon="clipboard" tone=${st.key === 'no_plan' ? 'red' : undefined}
            actions=${!closed && !editPlan && html`<${ui.Btn} kind="secondary" icon="edit" onClick=${() => setEditPlan(true)}>${cd.actionPlan ? 'Ändra åtgärdsplan' : 'Skriv åtgärdsplan'}<//>`}>
            ${editPlan ? html`<div class="stack">
                <${ui.Field} label="Åtgärdsplan" id="cd-edit-plan" required help="Vad görs, av vem och när? En ändrad plan skickas till kommunen för nytt godkännande." error=${planErr.actionPlan}>
                  <${ui.TextArea} id="cd-edit-plan" rows=${4} value=${plan.actionPlan} invalid=${!!planErr.actionPlan} onInput=${(v) => { setPlan({ ...plan, actionPlan: v }); setPlanErr({ ...planErr, actionPlan: null }); }} />
                <//>
                <div class="form-grid">
                  <${ui.Field} label="Klart senast" id="cd-edit-due" required help="Tidsplan för åtgärderna." error=${planErr.actionPlanDue}>
                    <${ui.Input} id="cd-edit-due" type="date" value=${plan.actionPlanDue} invalid=${!!planErr.actionPlanDue} onInput=${(v) => { setPlan({ ...plan, actionPlanDue: v }); setPlanErr({ ...planErr, actionPlanDue: null }); }} />
                  <//>
                  <${ui.Field} label="Ansvarig" id="cd-edit-owner" help="Den som driver åtgärderna.">
                    <${ui.Select} id="cd-edit-owner" value=${plan.ownerId} onChange=${(v) => setPlan({ ...plan, ownerId: v })} options=${mbUsers().map((u) => ({ value: u.id, label: `${u.name} – ${u.title}` }))} />
                  <//>
                </div>
                <div class="demo-note"><${I} name="mail" /><div><b>Kommunens chef får:</b> "En åtgärdsplan inom avtalet med Miljonbemanning väntar på ert godkännande. Logga in i portalen för att läsa den." Inga personuppgifter i mejlet.</div></div>
                <div class="row"><${ui.Btn} kind="primary" icon="send" onClick=${savePlan}>Spara och skicka till kommunen<//><${ui.Btn} kind="ghost" onClick=${() => { setEditPlan(false); setPlanErr({}); }}>Avbryt<//></div>
              </div>`
            : cd.actionPlan ? html`<div class="stack">
                <p>${cd.actionPlan}</p>
                <${ui.Kv} items=${[
                  ['Klart senast', cd.actionPlanDue ? html`<span class="row-sm">${d.fmtDate(cd.actionPlanDue)}${!closed && html`<${ui.SlaBadge} dueAt=${`${cd.actionPlanDue}T16:00`} />`}</span>` : 'Inget datum'],
                  ['Kommunens godkännande', cd.customerApprovedAt ? html`<${ui.Badge} tone="blue" icon="check-circle">Godkänd ${d.fmtDateTime(cd.customerApprovedAt)}<//>` : html`<${ui.Badge} tone="grey" icon="clock">Väntar på kommunens chef<//>`],
                ]} />
                ${!cd.customerApprovedAt && !closed && html`<div class="small muted">Kommunens chef${chef ? `, ${chef.name},` : ''} godkänner planen i sin portal. Byt perspektiv för att se och godkänna den där.</div>`}
              </div>`
            : html`<${ui.Empty} icon="clipboard" title="Ingen åtgärdsplan ännu">Avtalet kräver en åtgärdsplan med tidsplan som kommunen godkänner.<//>`}
          <//>
          ${closed ? html`<${ui.Card} title="Lärdomar" icon="book"><p>${cd.lessons || 'Inga lärdomar registrerade.'}</p><//>`
            : html`<${ui.Card} title="Markera som klar" icon="check-circle">
              <div class="stack">
                ${cd.actionPlan && !cd.customerApprovedAt && html`<${ui.Notice} tone="warn" title="Planen är inte godkänd av kommunen">Du kan markera avvikelsen som klar, men kommunens godkännande saknas. Det syns i registret.<//>`}
                <${ui.Field} label="Lärdomar" id="cd-lessons" required help="Vad ändrar vi i arbetssättet? Texten kommer med i månadssammanställningen till APT och kvalitetsmötet." error=${lessonsErr}>
                  <${ui.TextArea} id="cd-lessons" rows=${3} value=${lessons} invalid=${!!lessonsErr} onInput=${(v) => { setLessons(v); setLessonsErr(null); }} />
                <//>
                <div><${ui.Btn} kind="primary" icon="check" onClick=${close}>Markera som klar<//></div>
              </div>
            <//>`}
        </div>
        <div class="stack">
          <${ui.Card} title="Eskaleringstrappan" icon="layers"><${Ladder} current=${cd.escalationStep} vertical /><//>
          <${ui.Card} title="Varning, vite och avropsstopp" icon="shield"
            actions=${canManage(role) && !editSanction && html`<${ui.Btn} kind="ghost" icon="edit" onClick=${() => setEditSanction(true)}>Ändra<//>`}>
            ${editSanction ? html`<div class="stack">
                <${ui.Field} label="Steg i eskaleringstrappan" id="cd-s-step" help="Skriftlig varning kan ges på steg 1–3.">
                  <${ui.Select} id="cd-s-step" value=${sanc.escalationStep} onChange=${(v) => setSanc({ ...sanc, escalationStep: v, warningIssued: Number(v) >= 1 && Number(v) <= 3 ? sanc.warningIssued : false })} options=${ladder().map((s) => ({ value: String(s.step), label: stepLabel(s.step) }))} />
                <//>
                <${ui.Check} id="cd-s-warning" checked=${sanc.warningIssued} disabled=${!(Number(sanc.escalationStep) >= 1 && Number(sanc.escalationStep) <= 3)} onChange=${(v) => setSanc({ ...sanc, warningIssued: v })}>Skriftlig varning från kommunen (räknas mot ${cfg.warningsBeforeTermination})<//>
                <${ui.Field} label="Vite" id="cd-s-penalty" help=${`${fmt.kr(cfg.penalties.deviationOre)} per tillfälle enligt avtalet.`}>
                  <${ui.Select} id="cd-s-penalty" value=${sanc.penaltyKind} onChange=${(v) => setSanc({ ...sanc, penaltyKind: v })} options=${[{ value: '', label: 'Inget vite' }, { value: 'deviation', label: `Vite för avvikelse – ${fmt.kr(cfg.penalties.deviationOre)}` }, { value: 'information', label: `Vite för bristfällig information – ${fmt.kr(cfg.penalties.insufficientInformationOre)}` }]} />
                <//>
                ${sanc.penaltyKind && html`<${ui.Field} label="Avräknas på faktura för" id="cd-s-offset" help="Kommunen kan avräkna vitet på en kommande faktura.">
                  <${ui.Select} id="cd-s-offset" value=${sanc.penaltyOffsetMonth} onChange=${(v) => setSanc({ ...sanc, penaltyOffsetMonth: v })} placeholder="Inte bestämt" options=${months.map((mk) => ({ value: mk, label: d.monthName(mk) }))} />
                <//>`}
                <${ui.Check} id="cd-s-stop" checked=${sanc.orderStop} onChange=${(v) => setSanc({ ...sanc, orderStop: v })}>Kommunen har beslutat om avropsstopp<//>
                <div class="row"><${ui.Btn} kind="primary" icon="check" onClick=${saveSanctions}>Spara<//><${ui.Btn} kind="ghost" onClick=${() => setEditSanction(false)}>Avbryt<//></div>
              </div>`
            : html`<${ui.Kv} items=${[
                ['Skriftlig varning', cd.warningIssued ? html`<${ui.Badge} tone="red" icon="alert">Ja<//>` : 'Nej'],
                ['Varningar totalt', `${totalWarnings} av ${cfg.warningsBeforeTermination}`],
                ['Vite', cd.penaltyOre ? fmt.kr(cd.penaltyOre) : 'Inget'],
                cd.penaltyOre > 0 && ['Avräkning', cd.penaltyOffsetMonth ? `Faktura för ${d.monthName(cd.penaltyOffsetMonth)}` : 'Inte bestämt'],
                ['Avropsstopp', cd.orderStop ? 'Ja' : 'Nej'],
              ]} />`}
          <//>
          <${ui.Card} title="Händelser" icon="clock"><${ui.Timeline} items=${timeline} /><//>
        </div>
      </div>
    <//>`;
  };

  // ---- Registret
  const Register = ({ role }) => {
    const [filter, setFilter] = useState('open');
    const [tab, setTab] = useState('register');
    const [showNew, setShowNew] = useState(false);
    const cfg = MM.cfg();
    const all = S().contractDeviations.slice().sort((a, b) => ((a.status === 'closed') - (b.status === 'closed')) || (a.raisedAt < b.raisedAt ? 1 : -1));
    const open = all.filter((x) => x.status !== 'closed');
    const rows = filter === 'open' ? open : filter === 'klagomal' ? all.filter((x) => x.type === 'klagomål') : all;
    const waiting = open.filter((x) => x.actionPlan && !x.customerApprovedAt);
    const warnings = all.filter((x) => x.warningIssued).length;
    const penalties = MM.sum(all, (x) => x.penaltyOre || 0);
    const counts = {}; for (const x of open) counts[x.escalationStep] = (counts[x.escalationStep] || 0) + 1;
    const maxStep = open.length ? Math.max(...open.map((x) => x.escalationStep || 0)) : null;
    return html`<${ui.Page} title="Avtalsavvikelser" eyebrow=${`Avvikelser, varningar och klagomål · ${MM.contract().customerName}`}
      lead="Register enligt avtalets uppföljning och sanktioner. Kommunen godkänner åtgärdsplanerna. Klagomål från deltagare, arbetsgivare och kommun registreras här också."
      actions=${html`<span class="ldg-wrapbtn"><${ui.Btn} kind="primary" icon="plus" onClick=${() => setShowNew(true)}>Registrera avvikelse eller klagomål<//></span><span class="ldg-wrapbtn"><${ui.PerspectiveSwitch} role="kommun_chef" view="kom.chef" label="Här godkänner kommunens chef åtgärdsplaner" /></span>`}>
      <div class="ldg-tiles">
        <${ui.Kpi} label="Öppna" value=${String(open.length)} sub=${`varav ${open.filter((x) => x.type === 'klagomål').length} klagomål`} tone=${open.length ? 'watch' : undefined} />
        <${ui.Kpi} label="Väntar på kommunens godkännande" value=${String(waiting.length)} sub="Åtgärdsplaner skickade till kommunens chef" />
        <${ui.Kpi} label="Skriftliga varningar" value=${`${warnings} av ${cfg.warningsBeforeTermination}`} tone=${warnings > 0 ? 'alert' : undefined} sub=${`${cfg.warningsBeforeTermination} varningar kan leda till uppsägning`} />
        <${ui.Kpi} label="Viten" value=${fmt.kr(penalties)} sub=${`${fmt.kr(cfg.penalties.deviationOre)} per tillfälle enligt avtalet`} />
      </div>
      <${ui.Card} title="Eskaleringstrappan" icon="layers" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
        <div class="stack">
          <${Ladder} counts=${counts} current=${maxStep} />
          <div class="small muted">${maxStep == null ? 'Inga öppna avvikelser.' : `Högsta steg bland öppna avvikelser: ${stepLabel(maxStep)}.`} Skriftlig varning kan ges på steg 1–3. Kommunen kan också hålla inne betalning, ta ut vite, besluta om avropsstopp och flytta Miljonbemanning sist i rangordningen vid upprepade fel.</div>
        </div>
      <//>
      <${ui.Tabs} ariaLabel="Avvikelser" active=${tab} onChange=${setTab} tabs=${[{ id: 'register', label: 'Register', icon: 'list', count: open.length }, { id: 'apt', label: 'Månadssammanställning för APT', icon: 'clipboard' }]} />
      ${tab === 'register' ? html`<div class="stack">
          <${ui.Seg} ariaLabel="Filter" value=${filter} onChange=${setFilter} options=${[{ value: 'open', label: `Öppna (${open.length})` }, { value: 'all', label: `Alla (${all.length})` }, { value: 'klagomal', label: 'Klagomål' }]} />
          <${ui.Card} flush>
            <${ui.Table} caption="Register över avtalsavvikelser" rows=${rows} empty="Inga avvikelser i det här urvalet."
              onRowClick=${(x) => MM.nav('chef.avvikelser', { id: x.id })} rowClass=${(x) => (cdStatus(x).key === 'no_plan' ? 'row-alert' : x.status === 'closed' ? 'row-muted' : '')}
              columns=${[
                { key: 'raisedAt', label: 'Datum', nowrap: true, render: (x) => d.fmtDate(x.raisedAt) },
                { key: 'type', label: 'Typ och nivå', render: (x) => html`<div class="stack-sm" style="gap:4px"><span class="strong">${typeLabel(x.type)}</span><span class="cell-sub">${levelLabel(x.level)} · steg ${x.escalationStep}</span></div>` },
                { key: 'description', label: 'Beskrivning', render: (x) => html`<div style="min-width:200px;max-width:40ch">${x.description}<div class="cell-sub">${sourceLabel(x.source)}</div></div>` },
                { key: 'plan', label: 'Åtgärdsplan', render: (x) => (x.actionPlan ? html`<div class="stack-sm" style="gap:2px"><span class="nowrap">Klart ${x.actionPlanDue ? d.fmtDate(x.actionPlanDue) : '–'}</span><span class="cell-sub">${x.customerApprovedAt ? `Godkänd av kommunen ${d.fmtDateShort(x.customerApprovedAt)}` : 'Inte godkänd av kommunen'}</span></div>` : html`<span class="muted">Saknas</span>`) },
                { key: 'status', label: 'Status', render: (x) => html`<div class="stack-sm" style="gap:4px;min-width:150px;max-width:200px"><${CdStatus} cd=${x} />
                  <span class="cell-sub">${x.warningIssued ? 'Skriftlig varning' : 'Ingen varning'} · ${x.penaltyOre ? `vite ${fmt.kr(x.penaltyOre)}` : 'inget vite'}${x.orderStop ? ' · avropsstopp' : ''}</span></div>` },
              ]} />
          <//>
        </div>` : html`<${MonthSummary} />`}
      <${ui.DemoNote}>Registret är förifyllt med påhittade avvikelser. Kommunens chef godkänner åtgärdsplaner i sin portal – byt perspektiv för att prova. Det du registrerar här sparas i din webbläsare och kan återställas med knappen Återställ.<//>
      ${showNew && html`<${NewDeviationModal} role=${role} onClose=${() => setShowNew(false)} />`}
    <//>`;
  };

  const Avvikelser = ({ params, role }) => {
    MM.useStore();
    const cd = params.id ? S().contractDeviations.find((x) => x.id === params.id) : null;
    if (params.id && !cd) return html`<${ui.Page} title="Avtalsavvikelser" crumbs=${[{ label: 'Avtalsavvikelser', view: 'chef.avvikelser', params: {} }]}>
      <${ui.Notice} tone="warn" title="Avvikelsen finns inte">Den kan ha tagits bort när demodatan återställdes.<//>
      <div><${ui.Btn} kind="secondary" icon="arrow-left" onClick=${() => MM.nav('chef.avvikelser', {})}>Till registret<//></div>
    <//>`;
    return cd ? html`<${Detail} key=${cd.id} cd=${cd} role=${role} />` : html`<${Register} role=${role} />`;
  };
  MM.registerView('chef.avvikelser', { title: (p) => (p && p.id ? 'Avtalsavvikelse' : 'Avtalsavvikelser'), roles: ['chef', 'avtalsansvarig', 'samordnare'], component: Avvikelser });
})();
