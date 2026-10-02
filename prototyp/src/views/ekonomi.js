// views/ekonomi.js – ekonomens vyer (SPEC §3, §4, §7.0 och §7.15).
// eko.start · eko.korning {month, caseId?, filter?} · eko.faktura {month, caseId} · eko.arende {caseId}
// Ekonomen ser ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag – inga namn, anteckningar eller rapporter.
// Egna åtgärder har prefixet "eko." (Fortnox-logg med idempotens, simulerad statussynk, kreditering, uppgifter, stängning av körning).
(() => {
  const { html, useState, d, fmt } = MM;
  const ui = MM.ui; const I = ui.Icon; const sel = MM.sel;
  const S = () => MM.store.state;
  const ROLES = ['ekonom', 'chef'];
  const BILLED = ['fortnox_created', 'booked', 'sent', 'paid', 'manual'];
  const IN_FORTNOX = ['fortnox_created', 'booked', 'sent', 'paid'];
  const PAGE_SIZE = 20;
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const monthLabel = (mk) => cap(d.monthName(mk));
  const canAct = () => MM.role() === 'ekonom';
  const plural = (n, one, many) => `${fmt.num(n)} ${n === 1 ? one : many}`;
  /** Böjer bara ordet (utan talet): pl(1, 'är godkänd', 'är godkända'). */
  const pl = (n, one, many) => (n === 1 ? one : many);

  // ---- Avtalsvärden som text (läses från MM.cfg(), hårdkodas inte)
  const refLen = () => MM.valid.buyerRefLengthText() || '8–10';
  /** "9 siffror som börjar med 99" ur mönstret för inköpsordernummer. */
  const poText = () => {
    const p = ((MM.cfg().billing || {}).purchaseOrderNumber || {}).pattern || '';
    const m = p.match(/^\^?(\d*)\[0-9\]\{(\d+)\}\$?$/);
    return m ? `${m[1].length + Number(m[2])} siffror${m[1] ? ` som börjar med ${m[1]}` : ''}` : 'kommunens format';
  };
  const NUMWORD = ['noll', 'en', 'två', 'tre', 'fyra', 'fem', 'sex'];
  /** Faktureringspreskription (SPEC §3: två månader efter utfört arbete). */
  const prescMonths = () => (MM.cfg().billing || {}).prescriptionMonths || 2;
  const prescText = () => { const n = prescMonths(); return `${NUMWORD[n] || n} ${pl(n, 'månad', 'månader')}`; };
  /** Prisspannet i prislistan som gäller i dag, t.ex. "1 323–1 668 kr". */
  const priceSpan = () => {
    const today = d.today();
    const ps = (S().priceItems || []).filter((p) => p.validFrom <= today && (!p.validTo || p.validTo >= today)).map((p) => p.priceOre);
    if (!ps.length) return null;
    const lo = Math.min(...ps); const hi = Math.max(...ps);
    return lo === hi ? fmt.kr(lo) : `${fmt.num(Math.round(lo / 100))}–${fmt.kr(hi)}`;
  };

  // ------------------------------------------------------------ Layout (bara MB-tokens, inga egna färger)
  const CSS = `
.eko-kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.eko-kpis .kpi{padding:14px 16px;container-type:inline-size}
@media (max-width:620px){.eko-kpis .kpi{padding:12px}}
.eko-kpis .kpi-label{overflow-wrap:break-word;hyphens:manual}
.eko-kpis .kpi-value{font-size:1.625rem;font-size:clamp(1.125rem,14cqi,1.75rem);white-space:nowrap}
.eko-kpis .kpi-state{font-size:.8125rem}
.eko-ledger{display:flex;flex-direction:column;width:100%}
.eko-ledger>div{display:flex;justify-content:space-between;align-items:baseline;gap:6px 16px;padding:8px 0;border-bottom:1px solid var(--ljusgra);font-variant-numeric:tabular-nums;flex-wrap:wrap}
.eko-ledger>div>span:first-child{flex:1 1 200px;min-width:0}
.eko-ledger>div>span:last-child{text-align:right;margin-left:auto}
.eko-ledger>div.sum{font-weight:800;border-bottom:2px solid var(--antracit)}
.eko-ledger .sub{display:block;font-weight:400;font-size:.8125rem;color:var(--fg-muted)}
.eko-check{display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-top:1px solid var(--line)}
.eko-check:first-child{border-top:0;padding-top:4px}
.eko-fix{padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-sub);display:flex;flex-direction:column;gap:12px}
.eko-quote{border-left:3px solid var(--bla);padding:4px 0 4px 12px;display:flex;flex-direction:column;gap:4px}
.eko-steps{display:flex;flex-direction:column;gap:10px}
.eko-step{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border:1.5px solid var(--line);border-radius:var(--radius-lg);min-width:0}
.eko-step .btn{white-space:normal;text-align:left}
.eko-step.done{background:var(--surface-sub)}
.eko-step .n{width:30px;height:30px;border-radius:50%;border:2px solid var(--antracit);display:grid;place-items:center;font-weight:800;font-size:.875rem;flex:none}
.eko-step.done .n{background:var(--bla);border-color:var(--bla)}
.eko-step .body{display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center;min-width:0;flex:1}
.eko-step .txt{display:flex;flex-direction:column;gap:4px;min-width:min(100%,280px);flex:1}
.eko-tbl .table th,.eko-tbl .table td{padding-left:8px;padding-right:8px}
.eko-tbl .table th:first-child,.eko-tbl .table td:first-child{padding-left:16px}
.eko-tbl .table th{white-space:normal;vertical-align:bottom}
.eko-tbl .table .eko-ic-row{flex-direction:column;align-items:flex-start}
.eko .btn{white-space:normal}
.eko-mlist{display:none}
.eko-mlist .eko-alert{box-shadow:inset 4px 0 0 var(--rod)}
@media (max-width:620px){.eko-tbl .table-wrap{display:none}.eko-mlist{display:flex}}
.eko-scroll{overflow-x:auto;max-width:100%}
.eko-sums{margin-left:auto;width:min(100%,340px);display:flex;flex-direction:column}
.eko-sums>div{display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px solid var(--ljusgra);font-variant-numeric:tabular-nums}
.eko-sums>div.total{font-weight:800;border-bottom:2px solid var(--antracit)}
.eko-party{display:flex;flex-direction:column;gap:2px;font-size:.875rem}
.eko-ic-row{display:inline-flex;gap:4px 6px;align-items:center;flex-wrap:wrap}
.eko-task{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.eko-task:last-child{border-bottom:0}
.eko-task.done{background:var(--surface-sub)}
.eko-rule{display:flex;flex-direction:column;gap:8px;min-width:0}
.eko-weeks{display:flex;flex-wrap:wrap;gap:6px}
.eko-searchrow{max-width:460px}
`;
  try { if (!document.getElementById('eko-style')) { const s = document.createElement('style'); s.id = 'eko-style'; s.textContent = CSS; document.head.appendChild(s); } } catch (e) { /* */ }

  // ------------------------------------------------------------ Beräkningar (cachade per tillstånd – billingForMonth är tung)
  let memoState = null; let memoLen = -1; const memoMap = new Map();
  const memo = (key, fn) => {
    const st = S(); const len = MM.store.log.length;
    if (st !== memoState || len !== memoLen) { memoMap.clear(); memoState = st; memoLen = len; }
    if (!memoMap.has(key)) memoMap.set(key, fn());
    return memoMap.get(key);
  };
  const billing = (mk) => memo(`b:${mk}`, () => sel.billingForMonth(mk));
  const unbilled = () => memo('unbilled', () => sel.unbilledOld());
  const fxState = () => S().ekoFortnox || { runs: [], keys: {}, credits: [] };
  const runsSorted = () => S().billingRuns.slice().sort(MM.by('month', -1));
  const openRun = () => runsSorted().find((r) => r.status === 'draft') || null;

  /** Internt mål för när fakturorna ska vara i Fortnox (MB:s regel, inte avtalskrav). */
  const fortnoxDays = () => ((S().orgConfig || {}).billing || {}).fortnoxWithinWorkingDays || 3;
  const fortnoxDue = (mk) => `${d.nthWorkingDay(d.addMonths(mk, 1), fortnoxDays())}T16:00`;

  const remarks = (inv) => inv.checks.filter((c) => c.severity === 'needs_approval' || c.severity === 'warning');
  /** blocked = stoppad · review = kräver godkännande (eller åtgärd) · ready = klar (godkänd eller fakturerad) */
  const bucket = (inv) => (inv.blocked && !BILLED.includes(inv.status) ? 'blocked' : ['draft', 'returned', 'blocked'].includes(inv.status) ? 'review' : 'ready');
  const ORDER = { blocked: 0, review: 1, ready: 2 };

  const addMonthsDate = (s, n) => { const mk = d.addMonths(s.slice(0, 7), n); const day = Math.min(Number(s.slice(8, 10)), Number(d.monthEnd(mk).slice(8, 10))); return `${mk}-${String(day).padStart(2, '0')}`; };
  /** "v. 1–4 2027" – tar hänsyn till luckor (pausade veckor): "v. 1, 3–4 2027". */
  const weekText = (weeks, noYear) => {
    if (!weeks || !weeks.length) return '–';
    const groups = []; let cur = null;
    for (const w of weeks) { if (cur && d.diffDays(cur.last.monday, w.monday) === 7) cur.last = w; else { cur = { first: w, last: w }; groups.push(cur); } }
    return `v. ${groups.map((g) => (g.first.key === g.last.key ? `${g.first.week}` : `${g.first.week}–${g.last.week}`)).join(', ')}${noYear ? '' : ` ${weeks[weeks.length - 1].year}`}`;
  };
  const periodOf = (weeks) => (weeks.length ? [weeks[0].monday, d.addDays(weeks[weeks.length - 1].monday, 6)] : [null, null]);

  // ---- Ärendets veckor per månad – samma begrepp i alla ekonomivyer:
  //   Upparbetat   = debiterbara veckor (pausade veckor räknas inte)
  //   Fakturerat   = veckor på fakturor som är skapade i Fortnox, bokförda, skickade, betalda eller manuellt fakturerade
  //   Faktureras om = veckor på en faktura som kommunen har returnerat (krediteras och faktureras på nytt)
  //   Ej fakturerat = underlag, godkänd men inte skapad, stoppad eller pågående månad
  //   Upparbetat = fakturerat + faktureras om + ej fakturerat. Återstår = beställda veckor − upparbetade veckor.
  const KIND_OF = (status) => (BILLED.includes(status) ? 'billed' : status === 'returned' ? 'returned' : 'unbilled');
  const ledger = (c) => memo(`l:${c.id}`, () => {
    const weeks = sel.billableWeeks(c).filter((w) => !w.paused);
    const runMonths = S().billingRuns.map((r) => r.month);
    return MM.uniq(weeks.map((w) => w.monthKey)).sort().map((mk) => {
      const ws = weeks.filter((w) => w.monthKey === mk);
      const inv = runMonths.includes(mk) ? billing(mk).invoices.find((x) => x.caseId === c.id) || null : null;
      const status = inv ? inv.status : null;
      return { mk, weeks: ws, qty: ws.length, amountOre: inv ? inv.amountOre : ws.length * sel.priceFor(c.primaryArea, ws[0].monday), inv, status, kind: KIND_OF(status) };
    });
  });
  const tally = (rows) => ({ qty: MM.sum(rows, (r) => r.qty), amountOre: MM.sum(rows, (r) => r.amountOre), rows });
  const qtyKr = (t) => `${plural(t.qty, 'vecka', 'veckor')}, ${fmt.kr(t.amountOre)}`;
  /** Upparbetat och återstående för en faktura (till och med fakturans månad). */
  const invoiceSummary = (inv) => {
    const c = sel.caseById(inv.caseId);
    const upto = ledger(c).filter((r) => r.mk <= inv.month);
    const earlier = upto.filter((r) => r.mk < inv.month);
    const accrued = tally(upto);
    const billed = tally(earlier.filter((r) => r.kind === 'billed'));
    const returned = tally(earlier.filter((r) => r.kind === 'returned'));
    const pending = tally(earlier.filter((r) => r.kind === 'unbilled'));
    const current = { qty: inv.quantity, amountOre: inv.amountOre };
    const orderWeeks = inv.orderWeeks || 0;
    const remaining = { qty: Math.max(0, orderWeeks - accrued.qty), amountOre: Math.max(0, orderWeeks - accrued.qty) * inv.unitPriceOre };
    const over = Math.max(0, accrued.qty - orderWeeks);
    const order = { qty: orderWeeks, amountOre: inv.orderValueOre };
    const monthsText = (t) => t.rows.map((r) => `${d.monthName(r.mk)} (${weekText(r.weeks)})`).join(', ');
    const sentences = [
      `Beställning ${inv.number}: ${qtyKr(order)}.`,
      `Denna faktura: ${plural(current.qty, 'vecka', 'veckor')} (${weekText(inv.weeks)}), ${fmt.kr(current.amountOre)}.`,
      `Tidigare fakturerat: ${qtyKr(billed)}.`,
      returned.qty > 0 && `${pl(returned.rows.length, 'Returnerad faktura', 'Returnerade fakturor')} för ${monthsText(returned)}: ${qtyKr(returned)}. ${pl(returned.rows.length, 'Fakturan krediteras', 'Fakturorna krediteras')} och ${pl(returned.qty, 'veckan', 'veckorna')} faktureras om på en ny faktura.`,
      pending.qty > 0 && `Ännu inte fakturerat från ${monthsText(pending)}: ${qtyKr(pending)}. Faktureras på en egen faktura per månad.`,
      `Upparbetat inklusive denna faktura: ${qtyKr(accrued)}.`,
      over > 0 ? `Upparbetat är ${plural(over, 'vecka', 'veckor')} mer än beställningen.` : `Återstår av beställningen: ${qtyKr(remaining)}.`,
    ].filter(Boolean);
    return { order, current, billed, returned, pending, accrued, remaining, over, text: sentences.join(' ') };
  };
  /** Kärnans kontrolltext för "fler veckor än beställningen" säger "fakturerade" om upparbetade veckor – visa samma begrepp som fakturatexten. */
  const checkText = (ch, inv) => (ch.kind === 'over_order' && inv ? `Beställningen gäller ${plural(inv.orderWeeks, 'vecka', 'veckor')} men ${plural(inv.accruedWeeks, 'vecka', 'veckor')} är upparbetade inklusive denna faktura.` : noteText(ch.text));

  // ---- Beställarreferens
  /** Anteckning från referensregistret med datum i läsbar form (2027-01-12 → 12 jan 2027). */
  //  Kärnans valideringstext för saknad referens är skriven till kommunen – skriv om den för ekonomen.
  const noteText = (s) => String(s || '').trim().replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (m) => d.fmtDate(m)).replace('Den får ni av kommunens ekonomi eller er chef.', 'Kommunen lämnar den när de beställer.');
  const refInfo = (ref) => {
    const v = String(ref || '').trim();
    const known = S().buyerReferences.find((b) => b.reference === v);
    if (!v) return { ok: false, label: 'Saknas', text: 'Beställarreferens saknas. Ingen faktura kan skapas utan den.' };
    const err = MM.valid.buyerRefError(v);
    if (err) return { ok: false, label: 'Fel format', text: noteText(err) };
    if (known && !known.active) return { ok: false, label: 'Spärrad', text: noteText(known.note) || 'Referensen finns inte hos kommunen.', unit: known.unit };
    return { ok: true, label: 'Giltig', unit: known ? known.unit : null, text: known ? `Tillhör ${known.unit}.` : 'Rätt format. Kontrollera mot kommunens beställning.' };
  };
  const refError = (v, current) => {
    const e = MM.valid.buyerRefError(v); if (e) return noteText(e);
    const r = refInfo(v);
    if (!r.ok) return `Referensen ${String(v).trim()} är spärrad hos kommunen. Använd referensen som kommunen har bekräftat.`;
    if (current && String(v).trim() === current) return 'Det är samma referens som ärendet redan har.';
    return null;
  };
  const ekoTasks = () => S().tasks.filter((t) => t.toRole === 'ekonom');
  const taskFor = (caseId) => ekoTasks().find((t) => t.status === 'open' && (t.caseIds || []).includes(caseId)) || null;
  /** Referens som avtalsansvarig har skrivit i uppgiften (människan bekräftar – fylls aldrig i automatiskt). */
  const refFromTask = (t, current) => (t ? (t.text.match(/\b\d{8,10}\b/g) || []).find((x) => x !== current && refInfo(x).ok) || null : null);

  // ------------------------------------------------------------ Egna åtgärder (deterministiska – spelas upp igen vid omladdning)
  const A = MM.defineAction;
  const fx = (st) => { st.ekoFortnox = st.ekoFortnox || { runs: [], keys: {}, credits: [] }; return st.ekoFortnox; };
  /** Loggar en Fortnox-körning och sparar idempotensnycklar (månad:ärende). Själva skapandet görs av billing.sendFortnox. */
  A('eko.fortnoxLog', (st, p, ctx) => {
    const f = fx(st);
    for (const id of p.created || []) { const k = `${p.month}:${id}`; if (!f.keys[k]) f.keys[k] = ctx.now; }
    const run = { id: ctx.id('fxrun'), month: p.month, at: ctx.now, by: ctx.actorId, created: (p.created || []).length, skipped: p.skipped || 0, notReady: p.notReady || 0, blocked: p.blocked || 0 };
    f.runs.push(run);
    ctx.audit('billing.fortnox_run', 'billing_run', p.month, { created: run.created, skippedDuplicates: run.skipped, blocked: run.blocked, notApproved: run.notReady, idempotencyKey: 'månad:ärende' });
    return { runId: run.id };
  });
  /** Simulerad statussynk från Fortnox: varje hämtning flyttar fakturan ett steg (skapad → bokförd → skickad → betald). */
  const NEXT = { fortnox_created: 'booked', booked: 'sent', sent: 'paid' };
  A('eko.fortnoxSync', (st, p, ctx) => {
    const m = (st.invoiceStatus[p.month] = st.invoiceStatus[p.month] || {}); let n = 0;
    for (const id of p.caseIds || []) { const cur = m[id] || m.default; if (NEXT[cur]) { m[id] = NEXT[cur]; n++; } }
    fx(st).lastSync = { month: p.month, at: ctx.now, changed: n };
    ctx.audit('billing.fortnox_status_synced', 'billing_run', p.month, { changed: n });
    return { changed: n };
  });
  /** Returnerad faktura: kreditera och skapa en ny med rätt beställarreferens. */
  A('eko.reissue', (st, p, ctx) => {
    const c = st.cases.find((x) => x.id === p.caseId); if (!c) return { error: 'not_found' };
    if (sel.buyerRefProblem(c)) return { error: 'buyer_ref' };
    const m = (st.invoiceStatus[p.month] = st.invoiceStatus[p.month] || {});
    if ((m[p.caseId] || m.default) !== 'returned') return { error: 'not_returned' };
    fx(st).credits.push({ id: ctx.id('kredit'), month: p.month, caseId: p.caseId, at: ctx.now, by: ctx.actorId, reference: c.buyerReference });
    m[p.caseId] = 'fortnox_created';
    fx(st).keys[`${p.month}:${p.caseId}:ny`] = ctx.now;
    ctx.audit('billing.credited_and_reissued', 'case', p.caseId, { month: p.month, buyerReference: c.buyerReference });
    return {};
  });
  A('eko.taskDone', (st, p, ctx) => {
    const t = st.tasks.find((x) => x.id === p.taskId); if (!t) return { error: 'not_found' };
    t.status = 'done'; t.doneAt = ctx.now; t.doneBy = ctx.actorId; t.doneNote = p.note || '';
    ctx.audit('task.done', 'task', t.id, {}); return {};
  });
  /** Fråga till samordnaren (t.ex. överlapp). Bara ärendenummer – inga namn. */
  A('eko.askCoordinator', (st, p, ctx) => {
    const t = { id: ctx.id('task'), toRole: 'samordnare', fromId: ctx.actorId, createdAt: ctx.now, status: 'open', caseIds: p.caseIds || [], month: p.month, kind: 'billing_question', text: p.text };
    st.tasks.push(t); ctx.audit('task.created', 'task', t.id, { toRole: 'samordnare', caseIds: t.caseIds }); return { taskId: t.id };
  });
  A('eko.closeRun', (st, p, ctx) => {
    const r = st.billingRuns.find((x) => x.month === p.month); if (!r) return { error: 'not_found' };
    r.status = 'closed'; r.closedAt = ctx.now; r.closedBy = ctx.actorId;
    ctx.audit('billing.run_closed', 'billing_run', r.id, { month: p.month }); return {};
  });

  // ------------------------------------------------------------ Små komponenter
  const STATUS = {
    draft: { tone: 'grey', icon: 'file' }, approved: { tone: 'outline', icon: 'check' }, fortnox_created: { tone: 'bluetone', icon: 'upload' },
    booked: { tone: 'bluetone', icon: 'book' }, sent: { tone: 'bluetone', icon: 'send' }, paid: { tone: 'blue', icon: 'check-circle' },
    returned: { tone: 'red', icon: 'reply' }, manual: { tone: 'dark', icon: 'edit' }, blocked: { tone: 'red', icon: 'x-circle' },
  };
  const STATUS_ONE = { draft: 'underlag', approved: 'godkänd', fortnox_created: 'skapad i Fortnox', booked: 'bokförd', sent: 'skickad', paid: 'betald', returned: 'returnerad', manual: 'manuellt fakturerad', blocked: 'stoppad' };
  const STATUS_PLURAL = { draft: 'underlag', approved: 'godkända', fortnox_created: 'skapade i Fortnox', booked: 'bokförda', sent: 'skickade', paid: 'betalda', returned: 'returnerade', manual: 'manuellt fakturerade', blocked: 'stoppade' };
  const InvStatus = ({ status }) => { const m = STATUS[status] || STATUS.draft; return html`<${ui.Badge} tone=${m.tone} icon=${m.icon}>${sel.invoiceStatusLabel(status)}<//>`; };
  const CHECK = {
    blocking: { tone: 'red', icon: 'x-circle', word: 'Stoppar fakturan' }, needs_approval: { tone: 'grey', icon: 'clock', word: 'Kräver godkännande' },
    approved: { tone: 'bluetone', icon: 'check', word: 'Godkänd' }, warning: { tone: 'outline', icon: 'alert-circle', word: 'Kontrollera' }, info: { tone: 'outline', icon: 'info', word: 'Information' },
  };
  const SHORT = { buyer_ref: 'Referens', po: 'Inköpsordernummer', zero_week: 'Ingen närvaro', missing_reg: 'Närvaro saknas', too_many: 'Fler än 5 veckor', over_order: 'Över beställningen', overlap: 'Överlapp', paused: 'Pausad vecka', partial: 'Delvis vecka' };
  const CheckIcons = ({ inv }) => {
    if (!inv.checks.length) return html`<span class="row-sm small nowrap"><${I} name="check" />Inga</span>`;
    const main = inv.checks.filter((c) => c.severity !== 'info'); const info = inv.checks.filter((c) => c.severity === 'info');
    return html`<div class="eko-ic-row">
      ${main.map((c) => html`<${ui.Badge} tone=${CHECK[c.severity].tone} icon=${CHECK[c.severity].icon} title=${`${c.label}. ${checkText(c, inv)}`}>${c.severity === 'approved' ? 'Vecka godkänd' : SHORT[c.kind] || c.label}<//>`)}
      ${info.map((c) => html`<span class="muted" title=${c.label}><${I} name=${c.kind === 'paused' ? 'pause' : 'info'} label=${c.label} /></span>`)}
    </div>`;
  };
  const RefCell = ({ value }) => {
    const r = refInfo(value);
    return html`<div class="stack-sm" style="gap:2px"><span class="mono strong nowrap">${value || '–'}</span><span class="row-sm small nowrap"><${I} name=${r.ok ? 'check' : 'x-circle'} cls=${r.ok ? '' : 'ic-red'} />${r.label}</span></div>`;
  };
  const RefBadge = ({ value }) => { const r = refInfo(value); return html`<${ui.Badge} tone=${r.ok ? 'bluetone' : 'red'} icon=${r.ok ? 'check' : 'x-circle'}>${value || 'Saknas'} · ${r.label}<//>`; };
  const Pager = ({ page, total, onPage }) => {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (total <= PAGE_SIZE) return html`<span class="small muted">Visar ${plural(total, 'faktura', 'fakturor')}</span>`;
    return html`<div class="row-between" style="width:100%">
      <span class="small muted">Visar ${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} av ${total}</span>
      <div class="row-sm">
        <${ui.Btn} kind="secondary" icon="chevron-left" disabled=${page === 0} onClick=${() => onPage(page - 1)}>Föregående<//>
        <span class="small strong nowrap" aria-live="polite">Sida ${page + 1} av ${pages}</span>
        <${ui.Btn} kind="secondary" iconRight="chevron-right" disabled=${page >= pages - 1} onClick=${() => onPage(page + 1)}>Nästa<//>
      </div></div>`;
  };
  const RoleNotice = () => (canAct()
    ? html`<${ui.Notice} tone="info" title="Du ser inga namn">Som ekonom ser du ärendenummer, perioder, avtalsområde, referenser och fakturaunderlag. Namn, anteckningar och rapporter visas inte för din roll – deltagaren visas som ”${sel.displayName(S().cases[0])}”. Ärendenumret är faktureringsobjektet.<//>`
    : html`<${ui.Notice} tone="warn" title="Läsläge">Du ser fakturaunderlaget i läsläge. Ekonomen godkänner, skapar fakturor och rättar referenser.<//>`);

  // ------------------------------------------------------------ Formulär: rätta beställarreferens (ett eller flera ärenden)
  const RefForm = ({ cases, task, onDone, idSuffix }) => {
    MM.useStore();
    const t = task || taskFor(cases[0].id);
    const current = cases.length === 1 ? cases[0].buyerReference : null;
    const suggestion = refFromTask(t, cases[0].buyerReference);
    const [val, setVal] = useState(''); const [tried, setTried] = useState(false);
    const id = `eko-ref-${idSuffix || cases[0].id}`;
    const err = refError(val, current);
    const info = !err && val ? refInfo(val) : null;
    if (!canAct()) return html`<div class="small muted">Ekonomen rättar referensen när kommunen har bekräftat den rätta.</div>`;
    const save = () => {
      setTried(true); if (err) return;
      const ref = val.trim();
      for (const c of cases) { const res = MM.dispatch('case.setBuyerRef', { caseId: c.id, reference: ref, source: t ? t.id : 'ekonom' }); if (res && res.error) { MM.toast('Beställarreferensen kunde inte sparas. Kontrollera siffrorna.', 'red'); return; } }
      MM.toast(cases.length === 1 ? `Beställarreferensen för ${cases[0].number} är nu ${ref}. Fakturan är inte längre stoppad.` : `Beställarreferensen är nu ${ref} för ${cases.map((c) => c.number).join(' och ')}.`, 'blue');
      if (onDone) onDone(ref);
    };
    return html`<div class="eko-fix">
      ${t && html`<div class="eko-quote"><span class="small muted">Uppgift från ${MM.personName(t.fromId)} (${d.fmtDateTime(t.createdAt)})</span><span>${t.text}</span></div>`}
      <${ui.Field} id=${id} label="Rätt beställarreferens" required error=${tried ? err : null}
        help=${info && info.unit ? `${refLen()} siffror. Referensen tillhör ${info.unit}.` : `${refLen()} siffror, bara siffror. Referensen kommer från kommunens beställning – hitta aldrig på en egen.`}>
        <${ui.Input} id=${id} value=${val} onInput=${setVal} inputMode="numeric" maxLength=${10} invalid=${tried && !!err} />
      <//>
      <div class="row-sm">
        ${suggestion && val !== suggestion && html`<${ui.Btn} kind="secondary" icon="copy" onClick=${() => setVal(suggestion)}>Använd ${suggestion} från uppgiften<//>`}
        <${ui.Btn} kind="primary" icon="check" onClick=${save}>${cases.length === 1 ? 'Spara referensen' : `Spara för ${cases.length} ärenden`}<//>
      </div>
    </div>`;
  };
  const RefModal = ({ cases, task, onClose }) => html`<${ui.Modal} title="Rätta beställarreferens" onClose=${onClose}>
    <p>${cases.length === 1 ? `Ärende ${cases[0].number}` : `Ärendena ${cases.map((c) => c.number).join(' och ')}`} har referensen <b class="mono">${cases[0].buyerReference || 'saknas'}</b>. ${refInfo(cases[0].buyerReference).text}</p>
    <${RefForm} cases=${cases} task=${task} idSuffix=${`modal-${cases[0].id}`} onDone=${onClose} />
    <${ui.DemoNote}>Ändringen loggas i revisionsloggen med gammal och ny referens. Kommunen får ingen notis – referensen är deras egen.<//>
  <//>`;

  // ------------------------------------------------------------ Detalj: en faktura i körningen
  const ZeroWeek = ({ inv, ch, month }) => {
    const w = inv.weeks.find((x) => x.key === ch.weekKey);
    const [note, setNote] = useState(''); const [tried, setTried] = useState(false);
    const id = `eko-zero-${inv.caseId}-${ch.weekKey}`;
    const err = note.trim().length < 5 ? 'Skriv en kort kommentar (minst 5 tecken). Den sparas i revisionsloggen.' : null;
    const facts = w ? html`<div class="small">${d.fmtWeekRange(w.key)}: ${plural(w.planned, 'planerat tillfälle', 'planerade tillfällen')}, ${w.registered} ${pl(w.registered, 'registrerat', 'registrerade')}, ${w.attended} med närvaro. Inskriven ${w.enrolledDays} av 7 dagar.</div>` : null;
    if (ch.severity === 'approved') {
      const a = ch.approval || {};
      return html`<div class="eko-quote">${facts}<span class="small"><b>Godkänd</b> av ${MM.personName(a.by)} ${d.fmtDateTime(a.at)}: ”${a.note}”</span></div>`;
    }
    if (!canAct()) return facts;
    return html`<div class="eko-fix">${facts}
      <${ui.Field} id=${id} label="Kommentar till godkännandet" required error=${tried ? err : null}
        help="Varför ska veckan faktureras? Skriv inga uppgifter om deltagarens hälsa eller frånvaroskäl. Exempel: Kontrollerat med samordnaren – inskriven hela veckan enligt beställningen.">
        <${ui.TextArea} id=${id} rows=${2} value=${note} onInput=${setNote} invalid=${tried && !!err} />
      <//>
      <div><${ui.Btn} kind="primary" icon="check" onClick=${() => { setTried(true); if (err) return; MM.dispatch('billing.approveZeroWeek', { month, caseId: inv.caseId, weekKey: ch.weekKey, note: note.trim() }); MM.toast(`${d.fmtWeekKey(ch.weekKey)} för ${inv.number} är godkänd för fakturering.`, 'blue'); }}>Godkänn veckan för fakturering<//></div>
    </div>`;
  };
  const OverlapInfo = ({ inv, ch, month, onOpen }) => {
    MM.useStore();
    const num = ((ch.label || '').match(/[A-Z]+-\d{2}-\d{4}/) || [])[0];
    const other = num ? sel.caseByNumber(num) : null;
    if (!other) return null;
    const oInv = billing(month).invoices.find((x) => x.caseId === other.id);
    const asked = S().tasks.find((t) => t.kind === 'billing_question' && t.month === month && (t.caseIds || []).includes(inv.caseId) && (t.caseIds || []).includes(other.id));
    const weeks = ((ch.text || '').match(/\(([^)]*)\)/) || [])[1] || '';
    const ask = () => MM.dispatch('eko.askCoordinator', { month, caseIds: [inv.caseId, other.id], text: `Faktureringskontroll ${d.monthName(month)}: ${inv.number} och ${other.number} gäller samma deltagare och överlappar (${weeks}). Samma vecka får bara faktureras en gång. Vilket ärende ska faktureras för veckan? Behöver start- eller slutdatum rättas?` });
    return html`<div class="eko-fix">
      <div class="row-sm small"><span>Det andra ärendet:</span><span class="strong mono">${other.number}</span>${oInv && html`<${InvStatus} status=${oInv.status} />`}<span class="muted">${other.endDate ? `avslutat ${d.fmtDate(other.endDate)}` : `start ${d.fmtDate(other.startDate)}`}</span></div>
      <div class="small">Godkänn bara den faktura som ska ta med veckan. Är du osäker – fråga samordnaren, som ser båda ärendena.</div>
      <div class="row-sm">
        ${onOpen && oInv && html`<${ui.Btn} kind="secondary" icon="arrow-right" onClick=${() => onOpen(other.id)}>Visa ${other.number}<//>`}
        ${canAct() && (asked ? html`<${ui.Badge} tone="bluetone" icon="send">Fråga skickad till samordnaren ${d.fmtDateTime(asked.createdAt)}<//>` : html`<${ui.Btn} kind="secondary" icon="message" onClick=${() => { ask(); MM.toast('Frågan är skickad till samordnaren. Den innehåller bara ärendenummer.', 'blue'); }}>Fråga samordnaren<//>`)}
      </div>
    </div>`;
  };
  const CheckRow = ({ inv, ch, month, c, onOpen }) => {
    const m = CHECK[ch.severity] || CHECK.info;
    return html`<div class="eko-check">
      <${I} name=${m.icon} size="lg" cls=${ch.severity === 'blocking' ? 'ic-red' : ''} />
      <div class="stack-sm" style="gap:8px;min-width:0;flex:1">
        <div class="row-sm"><span class="strong">${ch.label}</span><${ui.Badge} tone=${m.tone}>${m.word}<//></div>
        <div class="small">${checkText(ch, inv)}</div>
        ${ch.kind === 'buyer_ref' && html`<${RefForm} cases=${[c]} idSuffix=${`detail-${c.id}`} />`}
        ${ch.kind === 'zero_week' && html`<${ZeroWeek} inv=${inv} ch=${ch} month=${month} />`}
        ${ch.kind === 'overlap' && html`<${OverlapInfo} inv=${inv} ch=${ch} month=${month} onOpen=${onOpen} />`}
        ${ch.kind === 'paused' && html`<div class="small muted">Orsaken till uppehållet visas inte för ekonom. Fakturan tar bara med de veckor som inte är pausade: ${weekText(inv.weeks)}.</div>`}
      </div>
    </div>`;
  };
  /** Upparbetat och återstående för en faktura – samma siffror och ord som fakturatexten. */
  const SummaryList = ({ inv }) => {
    const sm = invoiceSummary(inv);
    const months = (t) => t.rows.map((r) => d.monthName(r.mk)).join(', ');
    return html`<div class="eko-ledger">
      <div><span>Tidigare fakturerat<span class="sub">Skapat i Fortnox eller manuellt fakturerat</span></span><span class="num">${qtyKr(sm.billed)}</span></div>
      ${sm.returned.qty > 0 && html`<div><span><span class="strong">Faktureras om</span><span class="sub">${pl(sm.returned.rows.length, 'Returnerad faktura', 'Returnerade fakturor')} för ${months(sm.returned)}. Krediteras och faktureras på en ny faktura.</span></span><span class="num strong">${qtyKr(sm.returned)}</span></div>`}
      ${sm.pending.qty > 0 && html`<div><span>Ännu inte fakturerat<span class="sub">Från ${months(sm.pending)} – faktureras på en egen faktura per månad</span></span><span class="num">${qtyKr(sm.pending)}</span></div>`}
      <div><span>Denna faktura<span class="sub">${weekText(inv.weeks)}</span></span><span class="num">${qtyKr(sm.current)}</span></div>
      <div class="sum"><span>Upparbetat inklusive denna faktura</span><span class="num">${qtyKr(sm.accrued)}</span></div>
      <div><span>Beställning</span><span class="num">${qtyKr(sm.order)}</span></div>
      <div><span class="strong">${sm.over ? 'Över beställningen' : 'Återstår av beställningen'}</span><span class="num strong">${sm.over ? plural(sm.over, 'vecka', 'veckor') : qtyKr(sm.remaining)}</span></div>
    </div>`;
  };
  const InvoiceDetail = ({ inv, month, onClose, onOpen, onManual }) => {
    MM.useStore();
    const c = sel.caseById(inv.caseId);
    const [checked, setChecked] = useState(false);
    const act = canAct();
    const rem = remarks(inv);
    const pendingZero = inv.checks.filter((x) => x.kind === 'zero_week' && x.severity === 'needs_approval');
    const isDraft = inv.status === 'draft';
    const canApprove = act && isDraft && !inv.blocked && !pendingZero.length && (!rem.length || checked);
    const credit = fxState().credits.find((x) => x.month === month && x.caseId === inv.caseId);
    const approve = () => { MM.dispatch('billing.approveInvoice', { month, caseIds: [inv.caseId] }); MM.toast(`Fakturan för ${inv.number} är godkänd och klar för Fortnox.`, 'blue'); };
    const reissue = () => { const r = MM.dispatch('eko.reissue', { month, caseId: inv.caseId }); if (r && r.error) MM.toast('Rätta beställarreferensen innan du skapar en ny faktura.', 'red'); else MM.toast(`Den returnerade fakturan för ${inv.number} är krediterad och en ny faktura är skapad i Fortnox (simulerat).`, 'blue'); };
    const why = inv.blocked ? 'Fakturan är stoppad. Rätta beställarreferensen först.' : pendingZero.length ? 'Godkänn veckan utan närvaro först.' : rem.length && !checked ? 'Bekräfta att du har kontrollerat anmärkningarna.' : '';
    const footer = html`
      <${ui.Btn} kind="ghost" icon="file" onClick=${() => MM.nav('eko.faktura', { month, caseId: inv.caseId })}>Förhandsgranska faktura<//>
      <${ui.Btn} kind="ghost" icon="briefcase" onClick=${() => MM.nav('eko.arende', { caseId: inv.caseId })}>Öppna ärendet<//>
      ${act && !inv.blocked && !BILLED.includes(inv.status) && inv.status !== 'returned' && html`<${ui.Btn} kind="secondary" icon="edit" onClick=${() => onManual(inv.caseId)}>Markera som manuellt fakturerad<//>`}
      ${act && isDraft && html`<${ui.Btn} kind="primary" icon="check" disabled=${!canApprove} title=${why || undefined} onClick=${approve}>Godkänn fakturan<//>`}`;
    return html`<${ui.Modal} wide title=${`Faktura ${inv.number}`} onClose=${onClose} footer=${footer}>
      <div class="row-sm"><${InvStatus} status=${inv.status} /><span class="small muted">${monthLabel(month)} · en faktura per ärende och månad</span></div>
      <${ui.Kv} items=${[
        ['Avtalsområde', `${sel.areaName(inv.area)} (artikel ${inv.articleNo || '–'})`],
        ['Veckor', html`${weekText(inv.weeks)} <span class="muted">(${d.fmtDateShort(periodOf(inv.weeks)[0])}–${d.fmtDate(periodOf(inv.weeks)[1])})</span>`],
        ['Belopp', html`<span class="num">${inv.quantity} × ${fmt.krExact(inv.unitPriceOre)} = <b>${fmt.krExact(inv.amountOre)}</b> exkl. moms</span>`],
        ['Beställarreferens', html`<${RefBadge} value=${inv.buyerReference} />`],
        inv.fortnoxNo && ['Fakturanummer i Fortnox', inv.fortnoxNo],
        inv.manualInvoiceNo && ['Manuellt fakturanummer', inv.manualInvoiceNo],
      ]} />
      <div class="section-title"><span class="dot" aria-hidden="true"></span>Kontroller</div>
      ${inv.checks.length === 0 ? html`<${ui.Notice} tone="ok" title="Inga anmärkningar">Referensen är giltig och alla veckor har närvaro.<//>`
        : html`<div>${inv.checks.map((ch) => html`<${CheckRow} inv=${inv} ch=${ch} month=${month} c=${c} onOpen=${onOpen} />`)}</div>`}
      ${inv.status === 'returned' && html`<${ui.Notice} tone=${inv.blocked ? 'critical' : 'warn'} title="Fakturan är returnerad av kommunen">
        <div class="stack-sm">${inv.blocked ? 'Rätta beställarreferensen ovan. Sedan krediterar du den returnerade fakturan och skapar en ny.' : 'Referensen är rättad. Kreditera den returnerade fakturan och skapa en ny med rätt referens.'}
        ${act && !inv.blocked && html`<div class="row-sm"><${ui.Btn} kind="primary" icon="refresh" onClick=${reissue}>Kreditera och skapa ny faktura<//><${ui.BuildPhase} fas=${2} /></div>`}</div><//>`}
      ${credit && html`<${ui.Notice} tone="ok" title="Krediterad och fakturerad på nytt">Kreditfaktura och ny faktura skapades ${d.fmtDateTime(credit.at)} med referens ${credit.reference}.<//>`}
      ${act && isDraft && !inv.blocked && !pendingZero.length && rem.length > 0 && html`<${ui.Check} id=${`eko-rem-${inv.caseId}`} checked=${checked} onChange=${setChecked}>Jag har kontrollerat anmärkningarna. Fakturan ska skickas som den är.<//>`}
      ${act && why && isDraft && html`<p class="small muted">${why}</p>`}
      <div class="section-title"><span class="dot" aria-hidden="true"></span>Upparbetat och återstående</div>
      <${SummaryList} inv=${inv} />
    <//>`;
  };

  // ---- Reservväg: markera som manuellt fakturerad
  const ManualModal = ({ month, invoices, presetId, onClose }) => {
    const options = invoices.filter((x) => !x.blocked && !BILLED.includes(x.status) && x.status !== 'returned');
    const [caseId, setCaseId] = useState(presetId && options.some((o) => o.caseId === presetId) ? presetId : '');
    const [no, setNo] = useState(''); const [tried, setTried] = useState(false);
    const errCase = !caseId ? 'Välj vilket ärende fakturan gäller.' : null;
    const errNo = !/^\d{3,10}$/.test(no.trim()) ? 'Skriv fakturanumret med 3–10 siffror, utan mellanslag.' : null;
    const save = () => {
      setTried(true); if (errCase || errNo) return;
      const inv = options.find((o) => o.caseId === caseId);
      MM.dispatch('billing.markManual', { month, caseId, invoiceNo: no.trim() });
      MM.toast(`${inv.number} är markerad som manuellt fakturerad med fakturanummer ${no.trim()}. Den skapas inte i Fortnox igen.`, 'blue');
      onClose();
    };
    return html`<${ui.Modal} title="Markera som manuellt fakturerad" onClose=${onClose} footer=${html`<${ui.Btn} kind="ghost" onClick=${onClose}>Avbryt<//><${ui.Btn} kind="primary" icon="check" onClick=${save}>Spara<//>`}>
      <p>Använd reservvägen när fakturan har registrerats för hand i Fortnox eller i kommunens kostnadsfria fakturaportal. Fakturanumret sparas så att samma vecka inte faktureras två gånger.</p>
      <${ui.Field} id="eko-manual-case" label="Ärende" required help="Stoppade och redan fakturerade ärenden går inte att välja." error=${tried ? errCase : null}>
        <${ui.Select} id="eko-manual-case" value=${caseId} onChange=${setCaseId} placeholder="Välj ärende" invalid=${tried && !!errCase} options=${options.map((o) => ({ value: o.caseId, label: `${o.number} · ${weekText(o.weeks)} · ${fmt.kr(o.amountOre)}` }))} />
      <//>
      <${ui.Field} id="eko-manual-no" label="Fakturanummer" required help="Numret från Fortnox eller från kommunens fakturaportal." error=${tried ? errNo : null}>
        <${ui.Input} id="eko-manual-no" value=${no} onInput=${setNo} inputMode="numeric" maxLength=${10} invalid=${tried && !!errNo} />
      <//>
    <//>`;
  };

  // ---- CSV-export (fakturaunderlag, inga namn)
  const csvCell = (v) => { const s = String(v == null ? '' : v); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const krCsv = (ore) => (ore / 100).toFixed(2).replace('.', ',');
  const toCsv = (b) => {
    const head = ['Ärendenummer (faktureringsobjekt)', 'Avtalsområde', 'Artikel', 'Veckor', 'Antal veckor', 'À-pris exkl. moms (kr)', 'Belopp exkl. moms (kr)', 'Moms (%)', 'Beställarreferens', 'Inköpsordernummer', 'Radtext', 'Fakturatext', 'Status', 'Kontroller'];
    const rows = b.invoices.map((x) => [x.number, sel.areaName(x.area), x.articleNo, x.weeks.map((w) => w.week).join(' '), x.quantity, krCsv(x.unitPriceOre), krCsv(x.amountOre), x.vatRate, x.buyerReference || '', x.purchaseOrderNumber || '',
      `${x.number} · ${weekText(x.weeks)}`, invoiceSummary(x).text, sel.invoiceStatusLabel(x.status), x.checks.map((c) => c.label).join(', ')]);
    return [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  };

  // ---- Förklaring: månadstillhörighet och samlingsfakturor
  const MonthRules = ({ mk }) => {
    const weeks = d.weeksOfMonth(mk);
    const first = `${mk}-01`; const last = d.monthEnd(mk);
    const notes = [];
    const wf = d.isoWeek(first); const thF = d.thursday(first);
    if (d.weekMonthKey(first) !== mk) notes.push(`${cap(d.fmtWeekKey(wf.key))} (${d.fmtWeekRange(wf.key)}) har sin torsdag ${d.fmtDate(thF)} och hör därför till ${d.monthName(d.monthKey(thF))}.`);
    else if (d.monday(first) < first) notes.push(`${cap(d.fmtWeekKey(wf.key))} (${d.fmtWeekRange(wf.key)}) börjar i ${d.monthName(d.monthKey(d.monday(first)))}, men torsdagen ${d.fmtDate(thF)} infaller i ${d.monthName(mk)}. Veckan faktureras nu.`);
    const wl = d.isoWeek(last); const thL = d.thursday(last);
    if (d.weekMonthKey(last) !== mk) notes.push(`${cap(d.fmtWeekKey(wl.key))} (${d.fmtWeekRange(wl.key)}) har sin torsdag ${d.fmtDate(thL)} och faktureras i ${d.monthName(d.monthKey(thL))}.`);
    const coll = MM.cfg().billing.collectiveInvoiceAllowed;
    return html`<${ui.Card} title="Regler för körningen" icon="info">
      <div class="grid-2">
        <div class="eko-rule">
          <div class="strong">Veckan faktureras i den månad där torsdagen infaller</div>
          <div class="eko-weeks">${weeks.map((w) => html`<${ui.Badge} tone="outline" icon="calendar">${d.fmtWeekKey(w.key)} · ${d.fmtWeekRange(w.key)}<//>`)}</div>
          ${notes.map((n) => html`<div class="small">${n}</div>`)}
          <div class="small muted">Varje vecka faktureras exakt en gång. Debiterbar vecka är varje vecka deltagaren är inskriven, utom pausade veckor.</div>
        </div>
        <div class="eko-rule">
          <div class="strong">${coll ? 'Samlingsfaktura per beställarreferens är tillåten' : 'En faktura per ärende och månad'}</div>
          <div class="small">${coll ? 'Kommunen har skriftligt godkänt samlingsfakturor per beställarreferens.' : 'Samlingsfakturor är inte tillåtna enligt avtalet med Botkyrka kommun. Varje ärende får en egen faktura med ärendenumret som faktureringsobjekt.'}</div>
          <div class="small">Utan giltig beställarreferens (${refLen()} siffror) kan ingen faktura skapas. Inköpsordernummer används bara om kommunen beställer via sin e-handel.</div>
        </div>
      </div>
    <//>`;
  };

  // ============================================================ eko.korning
  const KorningView = ({ params }) => {
    const st = MM.useStore();
    const [filter, setFilter] = useState(['alla', 'stoppade', 'godkannande', 'klara'].includes(params.filter) ? params.filter : 'alla');
    const [q, setQ] = useState('');
    const [page, setPage] = useState(0);
    const [openId, setOpenId] = useState(params.caseId || null);
    const [manual, setManual] = useState(null);
    const runs = runsSorted();
    const mk = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : ((openRun() || runs[0] || {}).month || null);
    const crumbs = [{ label: 'Fakturering', view: 'eko.start' }, { label: mk ? monthLabel(mk) : 'Fakturakörning' }];
    if (!mk) return html`<${ui.Page} title="Fakturakörning" crumbs=${crumbs}><${ui.Empty} icon="file" title="Ingen fakturakörning ännu">Underlaget räknas fram efter varje månadsskifte.<//><//>`;
    const act = canAct();
    const run = runs.find((r) => r.month === mk) || null;
    const b = billing(mk);
    const rows = b.invoices.map((inv) => ({ ...inv, bucket: bucket(inv), rem: remarks(inv) }));
    const counts = { alla: rows.length, stoppade: rows.filter((r) => r.bucket === 'blocked').length, godkannande: rows.filter((r) => r.bucket === 'review').length, klara: rows.filter((r) => r.bucket === 'ready').length };
    const withRemarks = rows.filter((r) => r.bucket === 'review' && r.rem.length).length;
    const clean = rows.filter((r) => r.status === 'draft' && !r.blocked && !r.needsApproval && !r.rem.length);
    const approved = rows.filter((r) => r.status === 'approved' && !r.blocked && !r.needsApproval);
    const already = rows.filter((r) => BILLED.includes(r.status));
    const keys = fxState().keys;
    const fresh = approved.filter((r) => !keys[`${mk}:${r.caseId}`]);
    const toSync = rows.filter((r) => ['fortnox_created', 'booked', 'sent'].includes(r.status));
    const allDone = rows.length > 0 && rows.every((r) => BILLED.includes(r.status));
    const vatTotal = MM.sum(rows, (r) => Math.round((r.amountOre * r.vatRate) / 100));

    const needle = q.trim().toUpperCase();
    const list = rows.filter((r) => (filter === 'alla' || (filter === 'stoppade' && r.bucket === 'blocked') || (filter === 'godkannande' && r.bucket === 'review') || (filter === 'klara' && r.bucket === 'ready')) && (!needle || r.number.includes(needle)))
      .sort((a, x) => (ORDER[a.bucket] - ORDER[x.bucket]) || ((x.rem.length ? 1 : 0) - (a.rem.length ? 1 : 0)) || (a.number < x.number ? -1 : 1));
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE)); const pg = Math.min(page, pages - 1);
    const shown = list.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);
    const openInv = openId ? rows.find((r) => r.caseId === openId) : null;
    const setF = (f) => { setFilter(f); setPage(0); };

    const approveAll = async () => {
      const ok = await MM.confirm({ title: 'Godkänn fakturor utan anmärkning', confirmLabel: `Godkänn ${plural(clean.length, 'faktura', 'fakturor')}`,
        body: html`<div class="stack-sm"><p>${plural(clean.length, 'faktura', 'fakturor')} har giltig beställarreferens och inga anmärkningar. De blir klara att skapa i Fortnox.</p><p class="small muted">${plural(withRemarks, 'faktura', 'fakturor')} med anmärkning och ${plural(counts.stoppade, 'stoppad faktura', 'stoppade fakturor')} tas inte med. Dem granskar du var för sig.</p></div>` });
      if (!ok) return;
      MM.dispatch('billing.approveInvoice', { month: mk, caseIds: clean.map((r) => r.caseId) });
      MM.toast(`${plural(clean.length, 'faktura', 'fakturor')} ${pl(clean.length, 'är godkänd', 'är godkända')}. ${plural(withRemarks, 'faktura', 'fakturor')} med anmärkning återstår.`, 'blue');
    };
    const sendFortnox = async () => {
      const notReady = counts.godkannande;
      const ok = await MM.confirm({ title: 'Skapa fakturor i Fortnox', confirmLabel: fresh.length ? `Skapa ${plural(fresh.length, 'faktura', 'fakturor')}` : 'Kör ändå',
        body: html`<div class="stack-sm">
          <p>${fresh.length ? `${plural(fresh.length, 'godkänd faktura', 'godkända fakturor')} skapas som ${pl(fresh.length, 'ej bokfört utkast', 'ej bokförda utkast')} i Fortnox.` : 'Det finns inga nya godkända fakturor att skapa.'}</p>
          <ul class="small" style="margin:0;padding-left:20px">
            <li>${plural(already.length, 'faktura finns', 'fakturor finns')} redan i Fortnox eller är ${pl(already.length, 'manuellt fakturerad', 'manuellt fakturerade')} och hoppas över. En omkörning skapar inga dubbletter.</li>
            <li>${plural(counts.stoppade, 'stoppad faktura', 'stoppade fakturor')} kan inte skapas.</li>
            <li>${plural(notReady, 'faktura som inte är godkänd', 'fakturor som inte är godkända')} tas inte med.</li>
          </ul>
          <p class="small muted">I den riktiga tjänsten skickas anropen i takt med Fortnox gräns (25 anrop per 5 sekunder) och varje faktura får idempotensnyckeln månad + ärendenummer.</p></div>` });
      if (!ok) return;
      if (fresh.length) MM.dispatch('billing.sendFortnox', { month: mk, caseIds: fresh.map((r) => r.caseId) });
      MM.dispatch('eko.fortnoxLog', { month: mk, created: fresh.map((r) => r.caseId), skipped: already.length, notReady, blocked: counts.stoppade });
      MM.toast(fresh.length ? `${plural(fresh.length, 'faktura', 'fakturor')} skapades i Fortnox som ${pl(fresh.length, 'ej bokfört utkast', 'ej bokförda utkast')} (simulerat). Inga dubbletter.` : `Inga nya fakturor. ${plural(already.length, 'faktura', 'fakturor')} fanns redan – inga dubbletter skapades.`, 'blue');
    };
    const sync = () => {
      const r = MM.dispatch('eko.fortnoxSync', { month: mk, caseIds: toSync.map((x) => x.caseId) });
      MM.toast(`Status hämtad från Fortnox (simulerat): ${plural((r && r.changed) || 0, 'faktura', 'fakturor')} gick vidare ett steg.`, 'blue');
    };
    const exportCsv = async () => { MM.dispatch('billing.export', { month: mk, format: 'csv' }); await MM.download(`fakturaunderlag-${mk}.csv`, toCsv(b)); };
    const closeRun = async () => {
      const ok = await MM.confirm({ title: `Stäng körningen för ${d.monthName(mk)}`, confirmLabel: 'Stäng körningen', body: 'Alla fakturor är skapade eller manuellt fakturerade. När körningen är stängd försvinner den från listan över sådant som förfaller.' });
      if (ok) { MM.dispatch('eko.closeRun', { month: mk }); MM.toast(`Fakturakörningen för ${d.monthName(mk)} är stängd.`, 'blue'); }
    };

    const columns = [
      { key: 'number', label: 'Ärende', nowrap: true, render: (r) => html`<span class="strong mono">${r.number}</span>` },
      { key: 'area', label: 'Område', render: (r) => html`<span class="strong">${r.area}</span> <span class="cell-sub">${(sel.area(r.area) || {}).name || ''}</span>` },
      { key: 'weeks', label: 'Veckor', nowrap: true, render: (r) => weekText(r.weeks, true) },
      { key: 'quantity', label: 'Antal', num: true },
      { key: 'price', label: 'À-pris', num: true, nowrap: true, render: (r) => fmt.kr(r.unitPriceOre) },
      { key: 'amount', label: 'Belopp', num: true, nowrap: true, render: (r) => html`<span class="strong">${fmt.kr(r.amountOre)}</span>` },
      { key: 'ref', label: 'Beställar\u00ADreferens', render: (r) => html`<${RefCell} value=${r.buyerReference} />` },
      { key: 'status', label: 'Status', render: (r) => html`<${InvStatus} status=${r.status} />` },
      { key: 'checks', label: 'Kontroller', render: (r) => html`<${CheckIcons} inv=${r} />` },
    ];
    const step1Done = counts.stoppade === 0; const step2Done = counts.godkannande === 0; const step3Done = allDone;
    const monthOptions = runs.map((r) => ({ value: r.month, label: `${monthLabel(r.month)}${r.status === 'draft' ? ' (pågår)' : ''}` }));

    return html`<${ui.Page} title=${`Fakturakörning ${d.monthName(mk)}`} eyebrow="Fakturering · Botkyrka kommun" crumbs=${crumbs}
      lead="Underlaget räknas fram per ärende och månad efter månadsskiftet. Granska stoppade fakturor och anmärkningar, godkänn och skapa fakturorna i Fortnox."
      actions=${html`<div class="row-sm"><label for="eko-month" class="small strong">Månad</label><div style="width:210px;max-width:100%"><${ui.Select} id="eko-month" value=${mk} options=${monthOptions} onChange=${(v) => MM.nav('eko.korning', { month: v }, { replace: true })} /></div></div>`}>
      <div class="row-sm">
        ${run ? html`<${ui.Badge} tone=${run.status === 'draft' ? 'dark' : 'outline'} icon=${run.status === 'draft' ? 'clock' : 'check'}>${run.status === 'draft' ? 'Körningen pågår' : 'Körningen är stängd'}<//>` : html`<${ui.Badge} tone="outline">Preliminärt underlag<//>`}
        ${run && run.status === 'draft' && html`<span class="small strong">Ska vara i Fortnox:</span><${ui.SlaBadge} dueAt=${fortnoxDue(mk)} /><span class="small muted">Internt mål – ${fortnoxDays()} arbetsdagar efter månadsskiftet.</span>`}
      </div>
      ${!act && html`<${RoleNotice} />`}
      <div class="eko-kpis">
        <${ui.Kpi} label="Fakturor" value=${fmt.num(b.count)} sub=${`${plural(b.weeks, 'vecka', 'veckor')} · en per ärende`} />
        <${ui.Kpi} label="Belopp exkl. moms" value=${fmt.kr(b.totalOre)} sub=${`Inkl. moms ${fmt.kr(b.totalOre + vatTotal)}`} />
        <${ui.Kpi} label="Veckor" value=${fmt.num(b.weeks)} sub=${`${plural(d.weeksOfMonth(mk).length, 'kalendervecka', 'kalenderveckor')} i månaden`} />
        <${ui.Kpi} label="Stoppade" value=${fmt.num(counts.stoppade)} tone=${counts.stoppade ? 'alert' : ''} statusText="Rätta först" sub=${counts.stoppade ? 'Kan inte skapas utan giltig beställarreferens' : 'Inga stoppade'} />
        <${ui.Kpi} label=${'Kräver godkän\u00ADnande'} value=${fmt.num(counts.godkannande)} tone=${withRemarks ? 'watch' : ''} statusText="Granska" sub=${`Varav ${withRemarks} med anmärkning`} />
      </div>
      <${MonthRules} mk=${mk} />
      <${ui.Card} title="Gör körningen" icon="list" foot=${html`
          <span class="strong small">Reservväg:</span>
          <${ui.Btn} kind="secondary" icon="download" onClick=${exportCsv}>Exportera underlag (CSV)<//>
          ${act && html`<${ui.Btn} kind="secondary" icon="edit" onClick=${() => setManual({ presetId: null })}>Markera som manuellt fakturerad<//>`}
          <span class="small muted">Registrera för hand i Fortnox eller i kommunens kostnadsfria fakturaportal.</span>`}>
        <div class="eko-steps">
          <div class=${MM.cls('eko-step', step1Done && 'done')}><span class="n">${step1Done ? html`<${I} name="check" />` : '1'}</span><div class="body">
            <div class="txt"><div class="strong">Rätta stoppade</div>
            <div class="small">${counts.stoppade ? `${plural(counts.stoppade, 'faktura saknar', 'fakturor saknar')} giltig beställarreferens och kan inte skapas.` : 'Alla fakturor har giltig beställarreferens.'}</div></div>
            ${counts.stoppade > 0 && html`<div class="row-sm"><${ui.Btn} kind="secondary" icon="filter" onClick=${() => setF('stoppade')}>Visa stoppade (${counts.stoppade})<//></div>`}
          </div></div>
          <div class=${MM.cls('eko-step', step2Done && 'done')}><span class="n">${step2Done ? html`<${I} name="check" />` : '2'}</span><div class="body">
            <div class="txt"><div class="strong">Granska och godkänn</div>
            <div class="small">${clean.length ? `${plural(clean.length, 'faktura', 'fakturor')} utan anmärkning kan godkännas på en gång.` : 'Inga fakturor utan anmärkning väntar.'} ${withRemarks ? `${plural(withRemarks, 'faktura', 'fakturor')} med anmärkning godkänner du var för sig.` : ''}</div></div>
            <div class="row-sm">
              ${act && html`<${ui.Btn} kind="primary" icon="check" disabled=${!clean.length} onClick=${approveAll}>Godkänn alla utan anmärkning (${clean.length})<//>`}
              ${withRemarks > 0 && html`<${ui.Btn} kind="secondary" icon="filter" onClick=${() => setF('godkannande')}>Visa de som kräver godkännande<//>`}
            </div>
          </div></div>
          <div class=${MM.cls('eko-step', step3Done && 'done')}><span class="n">${step3Done ? html`<${I} name="check" />` : '3'}</span><div class="body">
            <div class="txt"><div class="row-sm"><span class="strong">Skapa i Fortnox</span><${ui.BuildPhase} fas=${2} /></div>
            <div class="small">${fresh.length ? `${plural(fresh.length, 'godkänd faktura väntar', 'godkända fakturor väntar')}.` : 'Inga nya godkända fakturor väntar.'} ${already.length ? `${plural(already.length, 'faktura är redan skapad eller manuellt fakturerad', 'fakturor är redan skapade eller manuellt fakturerade')}.` : ''} Stoppade fakturor kan inte skapas.</div>
            <div class="eko-ic-row small"><${InvStatus} status="fortnox_created" /><${I} name="arrow-right" /><${InvStatus} status="booked" /><${I} name="arrow-right" /><${InvStatus} status="sent" /><${I} name="arrow-right" /><${InvStatus} status="paid" /></div></div>
            <div class="row-sm">
              ${act && html`<${ui.Btn} kind="primary" icon="upload" disabled=${!fresh.length && !already.length} onClick=${sendFortnox}>Skapa i Fortnox (${fresh.length})<//>`}
              ${act && toSync.length > 0 && html`<${ui.Btn} kind="secondary" icon="refresh" onClick=${sync}>Hämta status från Fortnox<//>`}
              ${act && allDone && run && run.status === 'draft' && html`<${ui.Btn} kind="secondary" icon="check-square" onClick=${closeRun}>Stäng körningen<//>`}
            </div>
          </div></div>
        </div>
      <//>
      <div class="eko-tbl"><${ui.Card} title=${`Fakturor ${d.monthName(mk)}`} icon="file" flush foot=${html`<${Pager} page=${pg} total=${list.length} onPage=${setPage} />`}>
        <div class="stack" style="padding:14px 18px 4px">
          <${ui.Tabs} ariaLabel="Filter för fakturor" active=${filter} onChange=${setF} tabs=${[{ id: 'alla', label: 'Alla', count: counts.alla }, { id: 'stoppade', label: 'Stoppade', count: counts.stoppade, icon: 'x-circle' }, { id: 'godkannande', label: 'Kräver godkännande', count: counts.godkannande, icon: 'clock' }, { id: 'klara', label: 'Klara', count: counts.klara, icon: 'check' }]} />
          <div class="eko-searchrow">
            <${ui.Field} id="eko-search" label="Sök ärendenummer" help="Till exempel 0143 eller BOT-26-0143. Klicka på en rad för kontroller och åtgärder.">
              <${ui.Input} id="eko-search" type="search" value=${q} onInput=${(v) => { setQ(v); setPage(0); }} />
            <//>
          </div>
        </div>
        <${ui.Table} caption=${`Fakturor ${d.monthName(mk)}`} columns=${columns} rows=${shown} onRowClick=${(r) => setOpenId(r.caseId)}
          rowClass=${(r) => MM.cls(r.bucket === 'blocked' && 'row-alert', openId === r.caseId && 'selected')}
          empty=${filter === 'stoppade' ? 'Inga stoppade fakturor.' : filter === 'godkannande' ? 'Inga fakturor väntar på godkännande.' : filter === 'klara' ? 'Inga fakturor är klara ännu. Godkänn fakturor i steg 2.' : 'Inga fakturor matchar sökningen.'}
          footer=${list.length > 0 && html`<tr><td colspan="3">Summa (${plural(list.length, 'faktura', 'fakturor')})</td><td class="num">${MM.sum(list, (x) => x.quantity)}</td><td></td><td class="num nowrap">${fmt.kr(MM.sum(list, (x) => x.amountOre))}</td><td colspan="3"></td></tr>`} />
        <div class="eko-mlist list" style="border-top:2px solid var(--antracit)">
          ${shown.length === 0 && html`<div class="list-item muted">Inga fakturor att visa.</div>`}
          ${shown.map((r) => html`<button type="button" class=${MM.cls('list-item clickable', r.bucket === 'blocked' && 'eko-alert')} key=${r.id} onClick=${() => setOpenId(r.caseId)}>
            <span class="li-main">
              <span class="row-sm"><span class="li-title mono">${r.number}</span><${InvStatus} status=${r.status} /></span>
              <span class="small">${sel.areaName(r.area)} · ${weekText(r.weeks)}</span>
              <span class="small">${r.quantity} × ${fmt.kr(r.unitPriceOre)} = <b>${fmt.kr(r.amountOre)}</b></span>
              <span class="row-sm small">Beställarreferens <${RefBadge} value=${r.buyerReference} /></span>
              ${r.checks.some((x) => x.severity !== 'info') && html`<${CheckIcons} inv=${r} />`}
            </span>
            <${I} name="chevron-right" />
          </button>`)}
          ${list.length > 0 && html`<div class="list-item"><span class="li-main strong">Summa (${plural(list.length, 'faktura', 'fakturor')})</span><span class="strong nowrap">${fmt.kr(MM.sum(list, (x) => x.amountOre))}</span></div>`}
        </div>
      <//></div>
      ${fxState().runs.filter((r) => r.month === mk).length > 0 && html`<${ui.Card} title="Fortnox-körningar" icon="refresh" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
        <div class="stack-sm">${fxState().runs.filter((r) => r.month === mk).slice().reverse().map((r) => html`<div class="row-sm" key=${r.id}>
          <${I} name="upload" /><span class="strong">${d.fmtDateTime(r.at)}</span><span class="muted">${MM.personName(r.by)}</span>
          <${ui.Badge} tone="bluetone" icon="check">${plural(r.created, 'skapad', 'skapade')}<//><${ui.Badge} tone="outline" icon="copy">${plural(r.skipped, 'dubblett hoppades över', 'dubbletter hoppades över')}<//>
          ${r.blocked > 0 && html`<${ui.Badge} tone="red" icon="x-circle">${plural(r.blocked, 'stoppad', 'stoppade')}<//>`}</div>`)}
          <div class="small muted">Idempotensnyckel: månad + ärendenummer (till exempel ${mk}:${(rows[0] || {}).number || 'BOT-26-0001'}). Samma nyckel skapar aldrig en ny faktura.</div>
        </div>
      <//>`}
      <${ui.DemoNote}>Fortnox är simulerat. ”Skapa i Fortnox” sätter status ”Skapad i Fortnox (ej bokförd)” och ”Hämta status” flyttar fakturorna ett steg i taget. Priserna är exempel${priceSpan() ? ` inom prislistans spann (${priceSpan()} per vecka)` : ''}.<//>
      ${openInv && html`<${InvoiceDetail} inv=${openInv} month=${mk} onClose=${() => setOpenId(null)} onOpen=${(id) => setOpenId(id)} onManual=${(id) => { setOpenId(null); setManual({ presetId: id }); }} />`}
      ${manual && html`<${ManualModal} month=${mk} invoices=${rows} presetId=${manual.presetId} onClose=${() => setManual(null)} />`}
    <//>`;
  };

  // ============================================================ eko.start
  const StartView = () => {
    const st = MM.useStore();
    const [refModal, setRefModal] = useState(null);
    const act = canAct();
    const runs = runsSorted();
    const cur = openRun() || runs[0] || null;
    const mk = cur ? cur.month : null;
    const b = mk ? billing(mk) : null;
    const ub = unbilled();
    const limit = MM.cfg().billing.unbilledWarningDays;
    const openRuns = runs.filter((r) => r.status === 'draft');
    const credits = fxState().credits;

    // Beställarreferens saknas eller är fel
    const refCases = st.cases.filter((c) => !['declined'].includes(c.status) && sel.buyerRefProblem(c));
    // Veckor utan närvaro (öppna körningar)
    const zero = openRuns.flatMap((r) => billing(r.month).invoices.flatMap((inv) => inv.checks.filter((ch) => ch.kind === 'zero_week').map((ch) => ({ id: `${r.month}:${inv.caseId}:${ch.weekKey}`, month: r.month, inv, ch, w: inv.weeks.find((w) => w.key === ch.weekKey) }))));
    // Ofakturerade veckor äldre än varningsgränsen (unbilledWarningDays), per ärende
    const ubRows = Object.entries(MM.groupBy(ub, (x) => x.case.id)).map(([caseId, xs]) => {
      const sorted = xs.slice().sort((a, x) => (a.week.key < x.week.key ? -1 : 1)); const oldest = sorted[0];
      const presc = addMonthsDate(d.addDays(oldest.week.monday, 6), prescMonths());
      return { id: caseId, c: xs[0].case, weeks: sorted.map((x) => x.week), age: Math.max(...xs.map((x) => x.age)), amount: MM.sum(xs, (x) => x.amountOre), presc, left: d.diffDays(d.today(), presc), status: oldest.status };
    }).sort(MM.by('presc'));
    // Returnerade fakturor (och de som krediterats i prototypen)
    const returned = runs.flatMap((r) => billing(r.month).invoices.filter((inv) => inv.status === 'returned' || credits.some((x) => x.month === r.month && x.caseId === inv.caseId)).map((inv) => ({ ...inv, id: `${r.month}:${inv.caseId}`, month: r.month })));
    const tasks = ekoTasks().slice().sort((a, x) => (a.status === x.status ? (a.createdAt < x.createdAt ? 1 : -1) : a.status === 'open' ? -1 : 1));
    const openTasks = tasks.filter((t) => t.status === 'open');
    const due = mk ? fortnoxDue(mk) : null;
    const rows = b ? b.invoices.map((inv) => ({ ...inv, bucket: bucket(inv) })) : [];
    const stepNow = !rows.length ? 0 : rows.some((r) => r.bucket !== 'ready') ? 1 : rows.some((r) => r.status === 'approved') ? 2 : rows.some((r) => ['fortnox_created', 'booked'].includes(r.status)) ? 3 : 4;
    const reissue = (inv) => { const r = MM.dispatch('eko.reissue', { month: inv.month, caseId: inv.caseId }); if (r && r.error) MM.toast('Rätta beställarreferensen innan du skapar en ny faktura.', 'red'); else MM.toast(`Den returnerade fakturan för ${inv.number} är krediterad och en ny är skapad (simulerat).`, 'blue'); };
    const taskDone = async (t) => {
      const cs = (t.caseIds || []).map(sel.caseById).filter(Boolean);
      if (cs.some((c) => sel.buyerRefProblem(c))) { const ok = await MM.confirm({ title: 'Markera uppgiften som klar?', body: 'Minst ett ärende har fortfarande fel beställarreferens. Vill du ändå markera uppgiften som klar?', confirmLabel: 'Markera som klar' }); if (!ok) return; }
      MM.dispatch('eko.taskDone', { taskId: t.id }); MM.toast('Uppgiften är markerad som klar.', 'blue');
    };

    const runRows = runs.map((r) => {
      const bb = billing(r.month); const by = MM.groupBy(bb.invoices, (x) => x.status);
      const entries = Object.entries(by).sort((a, x) => x[1].length - a[1].length);
      const todo = bb.invoices.filter((x) => bucket(x) !== 'ready').length;
      return { id: r.id, run: r, bb, entries, todo };
    });

    return html`<${ui.Page} title="Fakturering" eyebrow=${MM.persona() ? `${MM.persona().name} · ${MM.roleDef(MM.role()).label}` : 'Ekonomi'}
      lead="Fakturaunderlag per ärende och månad för avtalet med Botkyrka kommun. Peppol-faktura via Fortnox, en faktura per ärende och månad.">
      <${RoleNotice} />
      ${b && html`<div class="eko-kpis">
        <${ui.Kpi} label=${`${cap(d.monthName(mk).split(' ')[0])} att fakturera`} value=${fmt.kr(b.totalOre)} sub=${`${plural(b.count, 'faktura', 'fakturor')} · ${plural(b.weeks, 'vecka', 'veckor')} · exkl. moms`} />
        <${ui.Kpi} label="Stoppade fakturor" value=${fmt.num(b.blocked)} tone=${b.blocked ? 'alert' : ''} statusText="Rätta referensen" sub=${b.blocked ? 'Fel eller saknad beställarreferens' : 'Inga stoppade'} />
        <${ui.Kpi} label=${'Preskriptions\u00ADrisk'} value=${fmt.kr(MM.sum(ub, (x) => x.amountOre))} tone=${ub.length ? 'alert' : ''} statusText="Fakturera nu" sub=${ub.length ? `${plural(ub.length, 'vecka ofakturerad', 'veckor ofakturerade')} i mer än ${limit} dagar` : `Inga veckor äldre än ${limit} dagar`} />
        ${cur && cur.status === 'draft' ? html`<${ui.Kpi} label="Senast i Fortnox" value=${d.fmtDateShort(due)} tone="watch" statusText="Bevaka tiden" sub=${`${cap(d.relative(due))} kl. ${d.fmtTime(due)} · internt mål ${fortnoxDays()} arbetsdagar efter månadsskiftet`} />`
          : html`<${ui.Kpi} label="Öppna uppgifter" value=${fmt.num(openTasks.length)} sub="Från avtalsansvarig" />`}
      </div>`}
      <div class="split">
        ${b && html`<${ui.Card} title=${`Fakturakörning ${d.monthName(mk)}`} icon="file" tone=${cur.status === 'draft' ? 'blue' : undefined}
            actions=${html`<${ui.Btn} kind="primary" iconRight="arrow-right" onClick=${() => MM.nav('eko.korning', { month: mk })}>Öppna körningen<//>`}>
          <div class="stack">
            <${ui.Stepper} steps=${['Underlag framräknat', 'Granska och godkänn', 'Skapa i Fortnox', 'Bokför och skicka']} current=${stepNow} />
            <div class="list" style="border:1px solid var(--line);border-radius:var(--radius)">
              ${[
                ['x-circle', 'Stoppade – beställarreferens', rows.filter((r) => r.bucket === 'blocked').length, 'stoppade', true],
                ['clock', 'Veckor utan närvaro att godkänna', zero.filter((z) => z.month === mk && z.ch.severity === 'needs_approval').length, 'godkannande', true],
                ['alert-circle', 'Kräver godkännande', rows.filter((r) => r.bucket === 'review').length, 'godkannande', false],
                ['check', 'Klara (godkända eller fakturerade)', rows.filter((r) => r.bucket === 'ready').length, 'klara', false],
              ].map(([icon, label, n, f, hot]) => html`<button type="button" class="list-item clickable" onClick=${() => MM.nav('eko.korning', { month: mk, filter: f })}>
                <${I} name=${icon} cls=${hot && n > 0 ? 'ic-red' : ''} /><span class="li-main"><span class=${n > 0 && hot ? 'strong' : ''}>${label}</span></span><span class="strong num">${n}</span><${I} name="chevron-right" /></button>`)}
            </div>
            <div class="small muted">Veckorna faktureras i den månad där torsdagen infaller. Samlingsfakturor är ${MM.cfg().billing.collectiveInvoiceAllowed ? 'tillåtna per beställarreferens' : 'inte tillåtna'}.</div>
          </div>
        <//>`}
        <${ui.Card} title="Uppgifter till dig" icon="inbox" flush actions=${openTasks.length > 0 && html`<${ui.Badge} tone="dark">${plural(openTasks.length, 'öppen', 'öppna')}<//>`}>
          ${tasks.length === 0 ? html`<${ui.Empty} icon="inbox" title="Inga uppgifter">Avtalsansvarig skickar uppgifter hit, till exempel rätt beställarreferens från kommunen.<//>`
            : tasks.map((t) => { const cs = (t.caseIds || []).map(sel.caseById).filter(Boolean); const fixed = cs.every((c) => !sel.buyerRefProblem(c));
              return html`<div class=${MM.cls('eko-task', t.status !== 'open' && 'done')} key=${t.id}>
                <div class="row-sm"><${ui.Badge} tone=${t.status === 'open' ? 'dark' : 'outline'} icon=${t.status === 'open' ? 'clock' : 'check'}>${t.status === 'open' ? 'Öppen' : 'Klar'}<//><span class="small muted">Från ${MM.personName(t.fromId)} · ${d.fmtDateTime(t.createdAt)}</span></div>
                <div>${t.text}</div>
                ${cs.length > 0 && html`<div class="eko-ic-row">${cs.map((c) => html`<span class="row-sm"><${ui.CaseLink} caseId=${c.id} /><${RefBadge} value=${c.buyerReference} /></span>`)}</div>`}
                ${act && t.status === 'open' && html`<div class="row-sm">
                  ${!fixed && html`<${ui.Btn} kind="primary" icon="edit" onClick=${() => setRefModal({ cases: cs.filter((c) => sel.buyerRefProblem(c)), task: t })}>Rätta referensen<//>`}
                  <${ui.Btn} kind=${fixed ? 'primary' : 'secondary'} icon="check" onClick=${() => taskDone(t)}>Markera som klar<//></div>`}
                ${t.status !== 'open' && t.doneAt && html`<div class="small muted">Klar ${d.fmtDateTime(t.doneAt)} (${MM.personName(t.doneBy)}).</div>`}
              </div>`; })}
        <//>
      </div>
      <div class="grid-2">
        <${ui.Card} title=${`Ofakturerade veckor äldre än ${limit} dagar`} icon="alert" tone=${ubRows.length ? 'red' : undefined} flush>
          ${ubRows.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inga gamla ofakturerade veckor">Alla debiterbara veckor äldre än ${limit} dagar är fakturerade.<//>` : html`
            <div style="padding:14px 18px 0"><${ui.Notice} tone="critical" title="Risk för preskription">Faktureringen preskriberas ${prescText()} efter utfört arbete. Rätta referensen och fakturera veckorna nu.<//></div>
            <div class="list">${ubRows.map((r) => html`<div class="list-item" key=${r.id}>
              <div class="li-main">
                <div class="row-sm"><${ui.CaseLink} caseId=${r.c.id} /><${InvStatus} status=${r.status} /></div>
                <span class="small">${plural(r.weeks.length, 'vecka', 'veckor')} (${weekText(r.weeks)}) · ${fmt.kr(r.amount)} · äldsta veckan ${plural(r.age, 'dag', 'dagar')}</span>
              </div>
              <div class="li-side"><span class="small muted">Preskriberas</span><span class="strong nowrap">${d.fmtDate(r.presc)}</span><span class="small nowrap">${r.left >= 0 ? `om ${plural(r.left, 'dag', 'dagar')}` : 'passerat'}</span></div>
            </div>`)}</div>`}
        <//>
        <${ui.Card} title="Returnerade fakturor" icon="reply" flush>
          ${returned.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inga returnerade fakturor">Kommunen har inte returnerat någon faktura.<//>` : html`<div class="list">${returned.map((inv) => {
            const c = sel.caseById(inv.caseId); const cr = credits.find((x) => x.month === inv.month && x.caseId === inv.caseId); const refOk = !sel.buyerRefProblem(c);
            return html`<div class="list-item" key=${inv.id}>
              <${I} name=${cr ? 'check-circle' : 'reply'} size="lg" cls=${cr ? '' : 'ic-red'} />
              <div class="li-main">
                <div class="row-sm"><span class="li-title mono">${inv.number}</span><${InvStatus} status=${inv.status} /></div>
                <span class="small">${monthLabel(inv.month)} · ${weekText(inv.weeks)} · ${fmt.kr(inv.amountOre)}</span>
                <div class="row-sm"><span class="small">Beställarreferens:</span><${RefBadge} value=${c.buyerReference} /></div>
                <div class="small">${cr ? `Krediterad och fakturerad på nytt ${d.fmtDateTime(cr.at)} med referens ${cr.reference}. ${pl(inv.quantity, 'Veckan', 'Veckorna')} räknas nu som ${pl(inv.quantity, 'fakturerad', 'fakturerade')}.`
                  : `${plural(inv.quantity, 'vecka faktureras', 'veckor faktureras')} om på en ny faktura. ${refOk ? 'Referensen är rättad. Kreditera den returnerade fakturan och skapa en ny.' : 'Fakturan returnerades eftersom beställarreferensen inte finns hos kommunen. Rätta referensen först.'}`}</div>
                ${act && !cr && html`<div class="row-sm">${refOk
                  ? html`<${ui.Btn} kind="primary" icon="refresh" onClick=${() => reissue(inv)}>Kreditera och skapa ny<//><${ui.BuildPhase} fas=${2} />`
                  : html`<${ui.Btn} kind="secondary" icon="edit" onClick=${() => setRefModal({ cases: [c], task: taskFor(c.id) })}>Rätta referensen<//>`}</div>`}
              </div>
            </div>`; })}</div>`}
        <//>
      </div>
      <div class="grid-2">
        <${ui.Card} title="Beställarreferens saknas eller är fel" icon="hash" flush>
          ${refCases.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Alla referenser är giltiga" />` : html`<div class="list">${refCases.map((c) => html`<div class="list-item" key=${c.id}>
            <div class="li-main">
              <div class="row-sm"><${ui.CaseLink} caseId=${c.id} /><${RefBadge} value=${c.buyerReference} /></div>
              <div class="small">${noteText(sel.buyerRefProblem(c))}</div>
              ${!c.startDate && html`<div class="small muted">Insatsen har inte startat. Ingen faktura ännu – samordnaren tar in referensen från kommunen.</div>`}
              ${act && c.startDate && html`<div><${ui.Btn} kind="secondary" icon="edit" onClick=${() => setRefModal({ cases: [c], task: taskFor(c.id) })}>Rätta referensen<//></div>`}
            </div>
          </div>`)}</div>`}
          <div class="card-foot"><span class="small muted">Kommunen anger referensen när de beställer.</span><${ui.PerspectiveSwitch} role="kommun_handlaggare" view="kom.bestall" label="Se var kommunen anger den" /></div>
        <//>
        <${ui.Card} title="Veckor utan närvaro att kontrollera" icon="clock" flush>
          ${zero.length === 0 ? html`<${ui.Empty} icon="check-circle" title="Inga veckor att kontrollera" />` : html`<div class="list">${zero.map((z) => html`<button type="button" class="list-item clickable" key=${z.id} onClick=${() => MM.nav('eko.korning', { month: z.month, caseId: z.inv.caseId })}>
            <${I} name=${z.ch.severity === 'approved' ? 'check' : 'clock'} />
            <span class="li-main"><span class="li-title mono">${z.inv.number}</span><span class="li-sub">${d.fmtWeekKey(z.ch.weekKey)} (${d.fmtWeekRange(z.ch.weekKey)}) · ${z.w ? `0 av ${plural(z.w.planned, 'tillfälle', 'tillfällen')} med närvaro` : ''}</span></span>
            <span class="li-side"><${ui.Badge} tone=${z.ch.severity === 'approved' ? 'bluetone' : 'grey'} icon=${z.ch.severity === 'approved' ? 'check' : 'clock'}>${z.ch.severity === 'approved' ? 'Godkänd' : 'Kontrollera'}<//></span>
          </button>`)}</div>`}
        <//>
      </div>
      <${ui.Card} title="Fakturakörningar per månad" icon="calendar" flush>
        <${ui.Table} caption="Fakturakörningar per månad" rows=${runRows} onRowClick=${(r) => MM.nav('eko.korning', { month: r.run.month })} columns=${[
          { key: 'm', label: 'Månad', nowrap: true, render: (r) => html`<span class="strong">${monthLabel(r.run.month)}</span>` },
          { key: 'run', label: 'Körning', render: (r) => (r.run.status === 'draft' ? html`<${ui.Badge} tone="dark" icon="clock">Pågår<//>` : html`<${ui.Badge} tone="outline" icon="check">Stängd<//>`) },
          { key: 'count', label: 'Fakturor', num: true, render: (r) => fmt.num(r.bb.count) },
          { key: 'weeks', label: 'Veckor', num: true, render: (r) => fmt.num(r.bb.weeks) },
          { key: 'total', label: 'Belopp exkl. moms', num: true, nowrap: true, render: (r) => fmt.kr(r.bb.totalOre) },
          { key: 'status', label: 'Fakturastatus', render: (r) => html`<div class="stack-sm" style="gap:4px"><span><${InvStatus} status=${r.entries[0] ? r.entries[0][0] : 'draft'} /></span>${r.entries.length > 1 && html`<span class="small">${r.entries.slice(1).map(([s, xs]) => `${xs.length} ${(xs.length === 1 ? STATUS_ONE : STATUS_PLURAL)[s] || s}`).join(' · ')}</span>`}</div>` },
          { key: 'todo', label: 'Att åtgärda', render: (r) => (r.todo ? html`<span class="row-sm nowrap"><${I} name="alert-circle" />${r.todo}</span>` : html`<span class="row-sm nowrap"><${I} name="check" />Inget</span>`) },
        ]} />
      <//>
      <${ui.Card} title="Fortnox-synk" icon="refresh" actions=${html`<${ui.BuildPhase} fas=${2} />`}>
        <div class="split">
          <${ui.Kv} items=${[
            ['Koppling', 'Simulerad i prototypen. I fas 1 används export och manuell registrering i Fortnox.'],
            ['Inloggning', 'Via OAuth 2.0 – Fortnox godkänner kopplingen. Nycklarna sparas krypterade.'],
            ['Hastighetsgräns', '25 anrop per 5 sekunder. Körningen köar anropen.'],
            ['Dubbletter', 'Idempotensnyckel månad + ärendenummer. En omkörning skapar inga dubbletter.'],
          ]} />
          <${ui.Kv} items=${[
            ['Status tillbaka', 'Skapad → bokförd → skickad → betald'],
            ['Senaste körning', (() => { const r = fxState().runs[fxState().runs.length - 1]; return r ? `${d.fmtDateTime(r.at)}: ${plural(r.created, 'faktura skapad', 'fakturor skapade')}, ${plural(r.skipped, 'dubblett', 'dubbletter')} hoppades över` : 'Ingen körning i prototypen ännu'; })()],
            ['Senaste statushämtning', fxState().lastSync ? `${d.fmtDateTime(fxState().lastSync.at)} (${plural(fxState().lastSync.changed, 'faktura uppdaterad', 'fakturor uppdaterade')})` : 'Ingen ännu'],
            ['Att kontrollera', 'Licenser för Fortnox Integration och Fortnox e-faktura, samt Botkyrkas Peppol-id.'],
          ]} />
        </div>
      <//>
      <${ui.DemoNote}>Fortnox, kreditering och statushämtning är simulerade. Allt du gör sparas i revisionsloggen. Priserna är exempel${priceSpan() ? ` inom prislistans spann (${priceSpan()} per vecka)` : ''}.<//>
      ${refModal && html`<${RefModal} cases=${refModal.cases} task=${refModal.task} onClose=${() => setRefModal(null)} />`}
    <//>`;
  };

  // ============================================================ eko.faktura
  const STEPS = ['draft', 'approved', 'fortnox_created', 'booked', 'sent', 'paid'];
  const STEP_LABEL = ['Underlag', 'Godkänd', 'Skapad i Fortnox', 'Bokförd', 'Skickad (Peppol)', 'Betald'];
  const FakturaView = ({ params }) => {
    const st = MM.useStore();
    const mk = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month : null;
    const c = params.caseId ? sel.caseById(params.caseId) : null;
    const inv = mk && c ? billing(mk).invoices.find((x) => x.caseId === c.id) : null;
    const crumbs = [{ label: 'Fakturering', view: 'eko.start' }, mk ? { label: monthLabel(mk), view: 'eko.korning', params: { month: mk } } : null, { label: c ? c.number : 'Faktura' }].filter(Boolean);
    if (!inv) {
      return html`<${ui.Page} title="Faktura" crumbs=${crumbs}>
        <${ui.Empty} icon="file" title="Ingen faktura att visa" action=${html`<${ui.Btn} kind="primary" onClick=${() => MM.nav('eko.korning', mk ? { month: mk } : {})}>Till fakturakörningen<//>`}>
          ${c && mk ? `${c.number} har inga debiterbara veckor i ${d.monthName(mk)}.` : 'Välj en faktura i fakturakörningen.'}<//>
      <//>`;
    }
    const cfgB = MM.cfg().billing; const k = MM.contract();
    const run = st.billingRuns.find((r) => r.month === mk);
    const keyAt = fxState().keys[`${mk}:${c.id}`];
    const isOut = BILLED.includes(inv.status) || inv.status === 'returned';
    const invoiceDate = (keyAt || (isOut && run ? run.createdAt : d.now())).slice(0, 10);
    const dueDate = d.addDays(invoiceDate, cfgB.paymentTermsDays);
    const vat = Math.round((inv.amountOre * inv.vatRate) / 100); const gross = inv.amountOre + vat;
    const grossRounded = Math.round(gross / 100) * 100; const rounding = grossRounded - gross;
    const po = c.purchaseOrderNumber && MM.valid.poNumber(c.purchaseOrderNumber) ? c.purchaseOrderNumber : '';
    const [pStart, pEnd] = periodOf(inv.weeks);
    const ref = refInfo(inv.buyerReference);
    const areaName = (sel.area(inv.area) || {}).name || '';
    const desc = `${inv.number} · ${weekText(inv.weeks)}`;
    const stepIdx = STEPS.indexOf(inv.status);
    const custRole = c.referrerId === 'k-maria' ? 'kommun_handlaggare' : 'kommun_chef';
    const summary = invoiceSummary(inv);
    const vatNo = `SE${String(k.supplierOrgNr).replace(/\D/g, '')}01`;
    const mapping = [
      { id: 'm1', f: 'Er referens', p: 'BuyerReference (BT-10)', v: inv.buyerReference || '–', note: `Kommunens beställarreferens, ${refLen()} siffror. Krävs – utan den kan fakturan inte skapas.` },
      { id: 'm2', f: 'Ert ordernummer', p: 'OrderReference (BT-13)', v: po || 'Tomt', note: `Bara kommunens inköpsordernummer (${poText()}). Aldrig ärendenumret eller andra egna nummer.` },
      { id: 'm3', f: 'Artikel och benämning', p: 'Item (BT-153, BT-155)', v: `${inv.articleNo} · ${areaName}`, note: 'En artikel per avtalsområde, pris per deltagarvecka.' },
      { id: 'm4', f: 'Radtext', p: 'InvoiceLine Note (BT-127)', v: desc, note: 'Ärendenummer och veckor på varje rad. Inga namn.' },
      { id: 'm5', f: 'Fakturatext', p: 'Note (BT-22)', v: 'Upparbetat och återstående', note: 'Beställningen, denna faktura, tidigare fakturerat, veckor som faktureras om efter returnerad faktura, upparbetat och återstående.' },
      { id: 'm6', f: 'Faktureringsobjekt', p: 'InvoicedObjectIdentifier (BT-18)', v: inv.number, note: 'Ärendenumret. Hur fältet fylls från Fortnox ska bekräftas.' },
      { id: 'm7', f: 'Betalningsvillkor', p: 'PaymentTerms (BT-20)', v: `${cfgB.paymentTermsDays} dagar`, note: 'Enligt avtalet.' },
      { id: 'm8', f: 'Bankgiro', p: 'PaymentMeans (BG-16)', v: 'Hämtas från Fortnox', note: 'Anges inte i Miljonmatch.' },
    ];
    return html`<${ui.Page} title=${`Faktura ${inv.number}`} eyebrow=${`Förhandsvisning · Peppol BIS Billing 3 via Fortnox · ${d.monthName(mk)}`} crumbs=${crumbs}
      lead="Så här blir fakturan när den skapas i Fortnox och skickas till Botkyrka kommun. Fakturan innehåller inga namn eller personnummer."
      actions=${html`<${ui.Btn} kind="secondary" icon="arrow-left" onClick=${() => MM.nav('eko.korning', { month: mk, caseId: c.id })}>Tillbaka till körningen<//><${ui.Btn} kind="ghost" icon="briefcase" onClick=${() => MM.nav('eko.arende', { caseId: c.id })}>Öppna ärendet<//>`}>
      <div class="stack-sm">
        <div class="row-sm"><${InvStatus} status=${inv.status} />${inv.fortnoxNo && html`<span class="small">Fakturanummer i Fortnox: <b class="mono">${inv.fortnoxNo}</b></span>`}${inv.manualInvoiceNo && html`<span class="small">Manuellt fakturanummer: <b class="mono">${inv.manualInvoiceNo}</b></span>`}
          <span class="small strong" style="margin-left:8px">Kontroller:</span>${inv.checks.filter((x) => x.severity !== 'info').length === 0 ? html`<span class="row-sm small"><${I} name="check-circle" />Inga anmärkningar</span>`
            : inv.checks.filter((x) => x.severity !== 'info').map((ch) => html`<${ui.Badge} tone=${CHECK[ch.severity].tone} icon=${CHECK[ch.severity].icon} title=${checkText(ch, inv)}>${ch.label}<//>`)}</div>
        ${stepIdx >= 0 && html`<${ui.Stepper} steps=${STEP_LABEL} current=${inv.status === 'paid' ? STEPS.length : stepIdx} />`}
      </div>
      ${inv.blocked && html`<${ui.Notice} tone="critical" title="Fakturan kan inte skapas">${ref.text} Rätta beställarreferensen i fakturakörningen.<//>`}
      ${inv.status === 'returned' && html`<${ui.Notice} tone="warn" title="Returnerad av kommunen">Fakturan returnerades. Kreditera den och skapa en ny med rätt beställarreferens.<//>`}
      <div class="split">
        <${ui.Card} title="Peppol-fält" icon="layers">
          <${ui.Kv} items=${[
            ['BuyerReference', html`<span class="mono strong">${inv.buyerReference || 'Saknas'}</span> <span class="small">(${ref.label.toLowerCase()})</span>`],
            ['OrderReference', po ? html`<span class="mono">${po}</span>` : html`<span>Tomt <span class="small muted">– kommunen beställer utanför e-handeln</span></span>`],
            ['Faktureringsobjekt', html`<span class="mono strong">${inv.number}</span>`],
            ['Moms per artikel', `${inv.vatRate} % (${inv.articleNo})`],
            ['Format', 'Peppol BIS Billing 3 via Fortnox e-faktura'],
          ]} />
        <//>
        <${ui.Card} title="Så tar kommunen emot fakturan" icon="building">
          <div class="stack-sm">
            <p class="small">Fakturan kommer som Peppol-faktura till kommunens e-fakturasystem. Kommunen använder beställarreferensen ${inv.buyerReference ? html`<b class="mono">${inv.buyerReference}</b>` : ''} för att skicka den till rätt enhet${ref.unit ? ` (${ref.unit})` : ''}.</p>
            <p class="small">Ärendenumret kopplar fakturan till beställningen. Handläggaren ser samma ärendenummer i portalen – men ingen faktura där.</p>
            <div><${ui.PerspectiveSwitch} role=${custRole} view="kom.deltagare" params=${{ caseId: c.id }} label="Se ärendet från kundens håll" /></div>
          </div>
        <//>
      </div>
      <${ui.Paper} title="Faktura" draft=${!IN_FORTNOX.includes(inv.status) && inv.status !== 'manual' ? 'Förhandsvisning – inte skapad i Fortnox' : null}
        info=${[['Fakturanummer', inv.fortnoxNo || inv.manualInvoiceNo || 'Sätts av Fortnox'], ['Fakturadatum', d.fmtDate(invoiceDate)], ['Förfallodatum', d.fmtDate(dueDate)], ['Er referens', inv.buyerReference || '–'], ['Ert ordernummer', po || '–'], ['Faktureringsobjekt', inv.number]]}>
        <div class="grid-2">
          <div class="eko-party"><span class="label-caps">Säljare</span><b>${k.supplierName}</b><span>Org.nr ${k.supplierOrgNr}</span><span>Momsreg.nr ${vatNo}</span><span class="muted">Adress och bankgiro hämtas från Fortnox</span></div>
          <div class="eko-party"><span class="label-caps">Köpare</span><b>${k.customerName}</b><span>Org.nr ${k.customerOrgNr}</span><span>${ref.unit || 'Enhet enligt beställarreferensen'}</span><span class="muted">Peppol-id ska bekräftas med kommunens e-handel</span></div>
        </div>
        <div class="kv" style="font-size:.875rem">
          <dt>Avtal</dt><dd>${k.contractNumber} (dnr ${k.dnr})</dd>
          <dt>Period</dt><dd>${d.fmtDate(pStart)} – ${d.fmtDate(pEnd)} (${weekText(inv.weeks)})</dd>
        </div>
        <h2>Fakturarader</h2>
        <div class="eko-scroll"><table>
          <thead><tr><th>Artikel</th><th>Beskrivning</th><th class="right">Antal</th><th class="right">À-pris</th><th class="right">Moms</th><th class="right">Belopp</th></tr></thead>
          <tbody><tr><td><b class="nowrap">${inv.articleNo}</b><div class="small">${areaName}, deltagarvecka</div></td><td>${desc}</td>
            <td class="right num nowrap">${plural(inv.quantity, 'vecka', 'veckor')}</td><td class="right num nowrap">${fmt.krExact(inv.unitPriceOre)}</td><td class="right num nowrap">${inv.vatRate} %</td><td class="right num nowrap">${fmt.krExact(inv.amountOre)}</td></tr></tbody>
        </table></div>
        <div class="eko-sums">
          <div><span>Summa exkl. moms</span><span>${fmt.krExact(inv.amountOre)}</span></div>
          <div><span>Moms ${inv.vatRate} %</span><span>${fmt.krExact(vat)}</span></div>
          <div><span>Öresavrundning</span><span>${fmt.krExact(rounding)}</span></div>
          <div class="total"><span>Att betala</span><span>${fmt.krExact(grossRounded)}</span></div>
        </div>
        <h2>Fakturatext</h2>
        <p>${summary.text}</p>
        <h2>Betalning</h2>
        <p>Betalningsvillkor ${cfgB.paymentTermsDays} dagar efter godkänd leverans och korrekt faktura. Bankgiro hämtas från Fortnox. Ange fakturanumret vid betalning.</p>
        <p class="fixed-text">Periodisk fakturering, månadsvis i efterskott, en faktura per ärende och månad. Ärendenumret ${inv.number} är faktureringsobjekt. Fakturan skickas som Peppol BIS Billing 3 – inte som e-post eller papper.</p>
      <//>
      <${ui.Card} title="Upparbetat och återstående" icon="layers">
        <div class="split">
          <${SummaryList} inv=${inv} />
          <div class="stack-sm small">
            <p><b>Upparbetat</b> är alla debiterbara veckor till och med ${d.monthName(mk)}. Pausade veckor räknas inte.</p>
            <p><b>Tidigare fakturerat</b> är veckor på fakturor som är skapade i Fortnox eller manuellt fakturerade.</p>
            ${summary.returned.qty > 0
              ? html`<p><b>Faktureras om</b>: kommunen returnerade fakturan för ${summary.returned.rows.map((r) => d.monthName(r.mk)).join(', ')}. ${pl(summary.returned.qty, 'Veckan', 'Veckorna')} räknas som ${pl(summary.returned.qty, 'upparbetad', 'upparbetade')} men inte som ${pl(summary.returned.qty, 'fakturerad', 'fakturerade')} förrän den returnerade fakturan är krediterad och en ny faktura är skapad.</p>`
              : html`<p><b>Faktureras om</b>: veckor på en faktura som kommunen har returnerat. De räknas inte som fakturerade förrän en ny faktura är skapad.</p>`}
            <p>Samma siffror står i fakturatexten och i ärendets vy.</p>
          </div>
        </div>
      <//>
      <${ui.Card} title="Fältmappning Fortnox → Peppol" icon="link" flush>
        <${ui.Table} caption="Fältmappning Fortnox till Peppol" rows=${mapping} columns=${[
          { key: 'f', label: 'Fält i Fortnox', render: (r) => html`<span class="strong">${r.f}</span>` },
          { key: 'p', label: 'Peppol BIS Billing 3', nowrap: true },
          { key: 'v', label: 'Värde på den här fakturan', render: (r) => html`<span class="mono">${r.v}</span>` },
          { key: 'note', label: 'Regel', render: (r) => html`<span class="small">${r.note}</span>` },
        ]} />
        <div style="padding:14px 18px"><${ui.Notice} tone="warn" title="Bekräftas innan skarp drift">Skicka en testfaktura och kontrollera med Botkyrkas e-handel (e-handel@botkyrka.se) att ”Er referens” hamnar i BuyerReference och att ”Ert ordernummer” ger ett tomt OrderReference.<//></div>
      <//>
      <${ui.DemoNote}>Förhandsvisningen är byggd av fakturaunderlaget i prototypen. Fakturanummer, bankgiro och adresser sätts av Fortnox i den riktiga tjänsten. Priserna är exempel.<//>
    <//>`;
  };

  // ============================================================ eko.arende
  const CasePicker = () => {
    const st = MM.useStore();
    const [q, setQ] = useState(''); const needle = q.trim().toUpperCase();
    const list = st.cases.filter((c) => c.startDate && (!needle || c.number.includes(needle))).sort(MM.by('number', -1));
    return html`<${ui.Page} title="Ärende" crumbs=${[{ label: 'Fakturering', view: 'eko.start' }, { label: 'Ärende' }]} lead="Sök på ärendenumret för att se debiterbara veckor, fakturastatus och beställningens värde.">
      <${RoleNotice} />
      <${ui.Card} flush>
        <div style="padding:14px 18px"><${ui.Field} id="eko-case-search" label="Sök ärendenummer" help="Till exempel 0143 eller BOT-26-0143."><${ui.Input} id="eko-case-search" type="search" value=${q} onInput=${setQ} /><//></div>
        <${ui.Table} caption="Ärenden" rows=${list.slice(0, 25)} onRowClick=${(c) => MM.nav('eko.arende', { caseId: c.id })} empty="Inget ärende matchar sökningen." columns=${[
          { key: 'number', label: 'Ärende', nowrap: true, render: (c) => html`<span class="strong mono">${c.number}</span>` },
          { key: 'area', label: 'Område', render: (c) => sel.areaName(c.primaryArea) },
          { key: 'start', label: 'Start', nowrap: true, render: (c) => d.fmtDate(c.startDate) },
          { key: 'status', label: 'Status', render: (c) => html`<${ui.CaseStatus} status=${c.status} />` },
          { key: 'ref', label: 'Beställarreferens', render: (c) => html`<${RefCell} value=${c.buyerReference} />` },
        ]} footer=${list.length > 25 && html`<tr><td colspan="5" class="small muted">Visar 25 av ${list.length}. Sök för att hitta fler.</td></tr>`} />
      <//>
    <//>`;
  };
  const ArendeView = ({ params }) => {
    const st = MM.useStore();
    const [allWeeks, setAllWeeks] = useState(false);
    const [refModal, setRefModal] = useState(false);
    const c = params.caseId ? sel.caseById(params.caseId) : null;
    if (!c) return html`<${CasePicker} />`;
    const act = canAct();
    const weeks = sel.billableWeeks(c);
    const price = sel.priceFor(c.primaryArea, c.startDate || d.today());
    const orderWeeks = c.orderValueWeeks || c.plannedWeeks || 0;
    const orderValue = sel.orderValueOre(c);
    const curMk = d.monthKey(d.today());
    const led = ledger(c);
    const months = MM.uniq(weeks.map((w) => w.monthKey)).sort();
    const rows = months.map((mk) => {
      const ws = weeks.filter((w) => w.monthKey === mk); const l = led.find((x) => x.mk === mk) || null; const inv = l ? l.inv : null;
      return { id: mk, mk, bill: l ? l.weeks : [], paused: ws.filter((w) => w.paused), qty: l ? l.qty : 0, amount: l ? l.amountOre : 0, inv, status: inv ? inv.status : mk >= curMk ? 'open' : null };
    });
    // Samma begrepp som fakturatexten: upparbetat = fakturerat + faktureras om + ej fakturerat.
    const accrued = tally(led);
    const billed = tally(led.filter((x) => x.kind === 'billed'));
    const returned = tally(led.filter((x) => x.kind === 'returned'));
    const pending = tally(led.filter((x) => x.kind === 'unbilled'));
    const notBilled = { qty: returned.qty + pending.qty, amountOre: returned.amountOre + pending.amountOre };
    const remaining = Math.max(0, orderWeeks - accrued.qty); const over = Math.max(0, accrued.qty - orderWeeks);
    const r = refInfo(c.buyerReference);
    const custRole = c.referrerId === 'k-maria' ? 'kommun_handlaggare' : 'kommun_chef';
    const paused = (c.pausedWeeks || []);
    const name = sel.displayName(c);
    return html`<${ui.Page} title=${`Ärende ${c.number}`} eyebrow="Fakturering · ärendets underlag" crumbs=${[{ label: 'Fakturering', view: 'eko.start' }, { label: 'Ärende', view: 'eko.arende' }, { label: c.number }]}
      lead="Debiterbara veckor, fakturastatus och beställningens värde. Ärendenumret är faktureringsobjekt på varje faktura."
      actions=${html`<${ui.PerspectiveSwitch} role=${custRole} view="kom.deltagare" params=${{ caseId: c.id }} label="Se ärendet från kundens håll" />`}>
      <${RoleNotice} />
      <div class="eko-kpis">
        <${ui.Kpi} label="Beställning" value=${fmt.kr(orderValue)} sub=${`${plural(orderWeeks, 'vecka', 'veckor')} × ${fmt.kr(price)}`} />
        <${ui.Kpi} label="Upparbetat" value=${fmt.kr(accrued.amountOre)} sub=${`${plural(accrued.qty, 'debiterbar vecka', 'debiterbara veckor')} hittills`} />
        <${ui.Kpi} label="Fakturerat" value=${fmt.kr(billed.amountOre)} sub=${`${plural(billed.qty, 'vecka', 'veckor')} i Fortnox eller manuellt fakturerade`} />
        <${ui.Kpi} label="Ej fakturerat" value=${fmt.kr(notBilled.amountOre)} tone=${returned.qty > 0 ? 'watch' : ''} statusText="Faktureras om"
          sub=${returned.qty > 0 ? `${plural(notBilled.qty, 'vecka', 'veckor')}, varav ${plural(returned.qty, 'vecka', 'veckor')} på returnerad faktura` : `${plural(notBilled.qty, 'vecka', 'veckor')} – underlag eller pågående månad`} />
        <${ui.Kpi} label="Återstående" value=${fmt.kr(remaining * price)} tone=${over > 0 ? 'alert' : ''} statusText="Över beställningen" sub=${over > 0 ? `${plural(over, 'vecka', 'veckor')} över beställningen` : `${plural(remaining, 'vecka', 'veckor')} kvar av beställningen`} />
      </div>
      ${orderWeeks > 0 && html`<${ui.Meter} value=${Math.min(accrued.qty, orderWeeks)} max=${orderWeeks} tone="blue" label=${`Upparbetat: ${accrued.qty} av ${plural(orderWeeks, 'beställd vecka', 'beställda veckor')}`} markers=${[{ value: billed.qty, label: `Fakturerat: ${plural(billed.qty, 'vecka', 'veckor')}` }]} />`}
      <p class="small muted">Upparbetat ${plural(accrued.qty, 'vecka', 'veckor')} = fakturerat ${billed.qty} + faktureras om efter returnerad faktura ${returned.qty} + ännu inte fakturerat ${pending.qty}. Pausade veckor räknas inte.</p>
      <div class="split">
        <${ui.Card} title="Ärendet" icon="briefcase">
          <${ui.Kv} items=${[
            ['Ärendenummer', html`<span class="mono strong">${c.number}</span> <span class="small muted">(faktureringsobjekt)</span>`],
            ['Deltagare', html`${name}${act ? html` <span class="small muted">(namn visas inte för ekonom)</span>` : ''}`],
            ['Avtalsområde', `${sel.areaName(c.primaryArea)} · artikel ${(sel.priceItem(c.primaryArea, c.startDate || d.today()) || {}).fortnoxArticleNo || '–'} · ${fmt.kr(price)} per vecka`],
            ['Status', html`<${ui.CaseStatus} status=${c.status} />`],
            ['Start', d.fmtDate(c.startDate)],
            ['Slut', c.endDate ? d.fmtDate(c.endDate) : c.plannedEnd ? `Planerat ${d.fmtDate(c.plannedEnd)}` : '–'],
            ['Pausade veckor', paused.length ? html`<div class="eko-weeks">${paused.map((k) => html`<${ui.Badge} tone="grey" icon="pause">${d.fmtWeekKey(k)} (${d.fmtWeekRange(k)})<//>`)}</div><div class="small muted">Debiteras inte. Orsaken visas inte för ekonom.</div>` : 'Inga'],
          ]} />
        <//>
        <${ui.Card} title="Referenser" icon="hash">
          <${ui.Kv} items=${[
            ['Beställarreferens', html`<${RefBadge} value=${c.buyerReference} /><div class="small" style="margin-top:4px">${r.text}</div>`],
            ['Inköpsordernummer', c.purchaseOrderNumber ? html`<span class="mono">${c.purchaseOrderNumber}</span>` : 'Används inte – kommunen beställer utanför e-handeln'],
            ['Beställning mottagen', d.fmtDate(c.referredAt)],
            ['Beställda veckor', plural(orderWeeks, 'vecka', 'veckor')],
          ]} />
          ${act && !r.ok && c.startDate && html`<div style="margin-top:12px"><${ui.Btn} kind="primary" icon="edit" onClick=${() => setRefModal(true)}>Rätta beställarreferensen<//></div>`}
        <//>
      </div>
      <${ui.Card} title="Debiterbara veckor per månad" icon="calendar" flush actions=${html`<${ui.Btn} kind="ghost" icon=${allWeeks ? 'chevron-up' : 'chevron-down'} ariaPressed=${allWeeks ? 'true' : 'false'} onClick=${() => setAllWeeks(!allWeeks)}>${allWeeks ? 'Dölj veckorna' : 'Visa alla veckor'}<//>`}>
        ${rows.length === 0 ? html`<${ui.Empty} icon="calendar" title="Inga debiterbara veckor ännu">Insatsen har inte startat.<//>` : html`<${ui.Table} caption="Debiterbara veckor per månad" rows=${rows}
          onRowClick=${(x) => { if (x.inv) MM.nav('eko.faktura', { month: x.mk, caseId: c.id }); }} rowClass=${(x) => (x.inv ? '' : 'row-muted')} columns=${[
          { key: 'mk', label: 'Månad', nowrap: true, render: (x) => html`<span class="strong">${monthLabel(x.mk)}</span>` },
          { key: 'weeks', label: 'Veckor', render: (x) => html`<span class="nowrap">${weekText(x.bill)}</span>${x.paused.length > 0 && html`<div class="cell-sub">Pausad ${x.paused.map((w) => d.fmtWeekKey(w.key)).join(', ')}</div>`}` },
          { key: 'qty', label: 'Antal', num: true },
          { key: 'amount', label: 'Belopp', num: true, nowrap: true, render: (x) => fmt.kr(x.amount) },
          { key: 'status', label: 'Fakturastatus', render: (x) => (x.status === 'open' ? html`<${ui.Badge} tone="outline" icon="clock">Faktureras efter månadsskiftet<//>` : x.status ? html`<${InvStatus} status=${x.status} />${x.status === 'returned' && html`<div class="cell-sub">${pl(x.qty, 'Veckan', 'Veckorna')} faktureras om på en ny faktura</div>`}` : '–') },
          { key: 'no', label: 'Fakturanummer', nowrap: true, render: (x) => (x.inv && (x.inv.fortnoxNo || x.inv.manualInvoiceNo)) || '–' },
          { key: 'go', label: '', render: (x) => x.inv && html`<span class="row-sm small nowrap"><${I} name="file" />Förhandsgranska</span>` },
        ]} />`}
        ${allWeeks && weeks.length > 0 && html`<div style="border-top:1px solid var(--line)"><${ui.Table} caption="Alla veckor" rows=${weeks.map((w) => ({ ...w, id: w.key }))} columns=${[
          { key: 'key', label: 'Vecka', nowrap: true, render: (w) => html`<span class="strong">${d.fmtWeekKey(w.key)}</span>` },
          { key: 'range', label: 'Period', nowrap: true, render: (w) => d.fmtWeekRange(w.key) },
          { key: 'month', label: 'Faktureras i', nowrap: true, render: (w) => monthLabel(w.monthKey) },
          { key: 'days', label: 'Inskrivna dagar', num: true, render: (w) => w.enrolledDays },
          { key: 'att', label: 'Närvaro', nowrap: true, render: (w) => (w.planned ? `${w.attended} av ${plural(w.planned, 'tillfälle', 'tillfällen')}` : 'Inga tillfällen än') },
          { key: 'note', label: 'Anmärkning', render: (w) => html`<div class="eko-ic-row">${w.paused && html`<${ui.Badge} tone="grey" icon="pause">Pausad – debiteras inte<//>`}${w.partial && !w.paused && html`<${ui.Badge} tone="outline" icon="info">Delvis vecka<//>`}${w.zeroAttendance && html`<${ui.Badge} tone="grey" icon="clock">Ingen närvaro<//>`}${w.missingRegistration && !w.paused && w.monday < d.monday(d.today()) && html`<${ui.Badge} tone="outline" icon="alert-circle">Närvaro saknas<//>`}</div>` },
        ]} /></div>`}
      <//>
      <${ui.DemoNote}>Upparbetat räknas som alla debiterbara veckor till och med innevarande vecka. Fakturerat är veckor på fakturor som är skapade i Fortnox eller manuellt fakturerade. Veckor på en returnerad faktura räknas som ej fakturerade tills en ny faktura är skapad. Fakturastatus och Fortnox är simulerade.<//>
      ${refModal && html`<${RefModal} cases=${[c]} task=${taskFor(c.id)} onClose=${() => setRefModal(false)} />`}
    <//>`;
  };

  // ------------------------------------------------------------ Registrering
  const wrap = (C) => (props) => html`<div class="eko"><${C} ...${props} /></div>`;
  MM.registerView('eko.start', { title: 'Fakturering', roles: ROLES, component: wrap(StartView) });
  MM.registerView('eko.korning', { title: (p) => (p && p.month ? `Fakturakörning ${d.monthName(p.month)}` : 'Fakturakörning'), roles: ROLES, component: wrap(KorningView) });
  MM.registerView('eko.faktura', { title: 'Faktura', roles: ROLES, component: wrap(FakturaView) });
  MM.registerView('eko.arende', { title: 'Ärende (ekonomi)', roles: ROLES, component: wrap(ArendeView) });
})();
