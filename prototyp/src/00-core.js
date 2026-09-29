// 00-core.js – namnrymd, datum, formatering, validering, ikoner.
// Alla datum/tider är "naiva" Europe/Stockholm-strängar ('YYYY-MM-DD' eller 'YYYY-MM-DDTHH:MM').
// Internt räknas de som UTC så att tittarens tidszon aldrig påverkar resultatet.
(() => {
  const HP = window.htmPreact;
  const MM = (window.MM = window.MM || {});
  Object.assign(MM, {
    html: HP.html, h: HP.h, render: HP.render,
    useState: HP.useState, useEffect: HP.useEffect, useMemo: HP.useMemo, useRef: HP.useRef,
    useCallback: HP.useCallback, useReducer: HP.useReducer, useLayoutEffect: HP.useLayoutEffect,
    useErrorBoundary: HP.useErrorBoundary, createContext: HP.createContext, useContext: HP.useContext,
  });
  MM.views = MM.views || {};
  MM.actions = MM.actions || {};

  // ---------------------------------------------------------------- Datum
  const DAY = 864e5;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const WD = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
  const WD_SHORT = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];
  const MON = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  const MON_SHORT = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];

  // Svenska helgdagar + dagar som i praktiken är lediga (afton) – används för arbetsdagar/SLA.
  const HOLIDAYS = {
    '2026-01-01': 'Nyårsdagen', '2026-01-06': 'Trettondedag jul', '2026-04-03': 'Långfredagen', '2026-04-05': 'Påskdagen',
    '2026-04-06': 'Annandag påsk', '2026-05-01': 'Första maj', '2026-05-14': 'Kristi himmelsfärdsdag', '2026-05-24': 'Pingstdagen',
    '2026-06-06': 'Sveriges nationaldag', '2026-06-19': 'Midsommarafton', '2026-06-20': 'Midsommardagen', '2026-10-31': 'Alla helgons dag',
    '2026-12-24': 'Julafton', '2026-12-25': 'Juldagen', '2026-12-26': 'Annandag jul', '2026-12-31': 'Nyårsafton',
    '2027-01-01': 'Nyårsdagen', '2027-01-06': 'Trettondedag jul', '2027-03-26': 'Långfredagen', '2027-03-28': 'Påskdagen',
    '2027-03-29': 'Annandag påsk', '2027-05-01': 'Första maj', '2027-05-06': 'Kristi himmelsfärdsdag', '2027-05-16': 'Pingstdagen',
    '2027-06-06': 'Sveriges nationaldag', '2027-06-25': 'Midsommarafton', '2027-06-26': 'Midsommardagen', '2027-11-06': 'Alla helgons dag',
    '2027-12-24': 'Julafton', '2027-12-25': 'Juldagen', '2027-12-26': 'Annandag jul', '2027-12-31': 'Nyårsafton',
  };

  const d = {
    DAY, WD, WD_SHORT, MON, MON_SHORT, HOLIDAYS,
    /** 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM' -> ms (UTC-behandlat) */
    ms(s) {
      if (typeof s === 'number') return s;
      const [date, time = '00:00'] = String(s).split('T');
      const [y, m, dd] = date.split('-').map(Number);
      const [hh, mi] = time.split(':').map(Number);
      return Date.UTC(y, m - 1, dd, hh || 0, mi || 0);
    },
    date(ms) { const x = new Date(ms); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; },
    dt(ms) { const x = new Date(ms); return `${d.date(ms)}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`; },
    /** Demo-klockan (sätts av store). */
    now() { return MM.clock ? MM.clock() : '2027-02-01T09:12'; },
    today() { return d.now().slice(0, 10); },
    addDays(s, n) { const hasT = String(s).includes('T'); const v = d.ms(s) + n * DAY; return hasT ? d.dt(v) : d.date(v); },
    addMinutes(s, n) { return d.dt(d.ms(s) + n * 60000); },
    diffDays(a, b) { return Math.round((d.ms(d.dayOf(b)) - d.ms(d.dayOf(a))) / DAY); }, // b - a i hela dagar
    diffMinutes(a, b) { return Math.round((d.ms(b) - d.ms(a)) / 60000); },
    dayOf(s) { return String(s).slice(0, 10); },
    timeOf(s) { return String(s).slice(11, 16); },
    weekday(s) { return (new Date(d.ms(s)).getUTCDay() + 6) % 7; }, // 0 = måndag
    isWeekend(s) { return d.weekday(s) >= 5; },
    holidayName(s) { return HOLIDAYS[d.dayOf(s)] || null; },
    isWorkingDay(s) { return !d.isWeekend(s) && !HOLIDAYS[d.dayOf(s)]; },
    /** Lägg till n arbetsdagar och behåll klockslaget (SLA "inom en arbetsdag"). */
    addWorkingDays(s, n) {
      let cur = s; let left = n;
      while (left > 0) { cur = d.addDays(cur, 1); if (d.isWorkingDay(cur)) left--; }
      return cur;
    },
    /** n:e arbetsdagen i en månad ('YYYY-MM', n>=1) */
    nthWorkingDay(monthKey, n) {
      let cur = `${monthKey}-01`; let count = d.isWorkingDay(cur) ? 1 : 0;
      while (count < n) { cur = d.addDays(cur, 1); if (d.isWorkingDay(cur)) count++; }
      return cur;
    },
    workingDaysBetween(a, b) { // antal arbetsdagar i (a, b]
      let n = 0; let cur = d.dayOf(a); const end = d.dayOf(b);
      while (cur < end) { cur = d.addDays(cur, 1); if (d.isWorkingDay(cur)) n++; }
      return n;
    },
    monday(s) { return d.addDays(d.dayOf(s), -d.weekday(s)); },
    thursday(s) { return d.addDays(d.monday(s), 3); },
    /** ISO 8601-vecka: { year, week, key: '2027-W04' } */
    isoWeek(s) {
      const th = d.thursday(s); const y = Number(th.slice(0, 4));
      const week = Math.ceil(((d.ms(th) - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
      return { year: y, week, key: `${y}-W${pad(week)}` };
    },
    /** Måndag för en ISO-vecka ('2027-W04' eller (year, week)) */
    weekMonday(yearOrKey, week) {
      let y = yearOrKey, w = week;
      if (typeof yearOrKey === 'string') { const m = yearOrKey.match(/^(\d{4})-W(\d{2})$/); y = +m[1]; w = +m[2]; }
      const jan4 = `${y}-01-04`;
      return d.addDays(d.monday(jan4), (w - 1) * 7);
    },
    /** Månad som veckan faktureras i: den månad där veckans torsdag infaller (ISO-regeln). */
    weekMonthKey(s) { return d.thursday(s).slice(0, 7); },
    /** ISO-veckor vars torsdag ligger i månaden. */
    weeksOfMonth(monthKey) {
      const out = []; let th = d.thursday(`${monthKey}-01`);
      if (th.slice(0, 7) < monthKey) th = d.addDays(th, 7);
      while (th.slice(0, 7) === monthKey) { out.push(d.isoWeek(th)); th = d.addDays(th, 7); }
      return out;
    },
    monthKey(s) { return String(s).slice(0, 7); },
    addMonths(monthKey, n) { let [y, m] = monthKey.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; },
    monthName(monthKey) { const [y, m] = monthKey.split('-').map(Number); return `${MON[m - 1]} ${y}`; },
    monthEnd(monthKey) { return d.addDays(`${d.addMonths(monthKey, 1)}-01`, -1); },

    // ---- Formatering (svenska) ----
    fmtDate(s) { if (!s) return '–'; const x = new Date(d.ms(s)); return `${x.getUTCDate()} ${MON_SHORT[x.getUTCMonth()]} ${x.getUTCFullYear()}`; },
    fmtDateShort(s) { if (!s) return '–'; const x = new Date(d.ms(s)); return `${x.getUTCDate()} ${MON_SHORT[x.getUTCMonth()]}`; },
    fmtDateNum(s) { return s ? d.dayOf(s) : '–'; },
    fmtTime(s) { return s ? d.timeOf(s).replace(':', '.') : '–'; },
    fmtDateTime(s) { if (!s) return '–'; return `${d.fmtDateShort(s)} kl. ${d.fmtTime(s)}`; },
    /** Utan förkortningar – för kommunportalen: "1 februari 2027" och "1 februari 2027 klockan 09.12". */
    fmtDateFull(s) { if (!s) return '–'; const x = new Date(d.ms(s)); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]} ${x.getUTCFullYear()}`; },
    fmtDateTimeFull(s) { if (!s) return '–'; return `${d.fmtDateFull(s)} klockan ${d.fmtTime(s)}`; },
    fmtDateTimeLong(s) { if (!s) return '–'; return `${WD[d.weekday(s)]} ${d.fmtDate(s)} kl. ${d.fmtTime(s)}`; },
    fmtWeekday(s) { const x = new Date(d.ms(s)); return `${WD[d.weekday(s)]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; },
    fmtWeek(s) { const w = d.isoWeek(s); return `v. ${w.week}`; },
    fmtWeekKey(key) { const m = key.match(/^(\d{4})-W(\d{2})$/); return `v. ${+m[2]} ${m[1]}`; },
    fmtWeekRange(key) { const mon = d.weekMonday(key); return `${d.fmtDateShort(mon)}–${d.fmtDateShort(d.addDays(mon, 6))}`; },
    /** "om 48 min", "om 2 tim", "i morgon 15.20", "för 3 dagar sedan" */
    relative(s, from) {
      const now = from || d.now(); const mins = d.diffMinutes(now, s); const abs = Math.abs(mins);
      let txt;
      if (abs < 60) txt = `${abs} min`;
      else if (abs < 60 * 24) { const h = Math.floor(abs / 60), m = abs % 60; txt = m && h < 5 ? `${h} tim ${m} min` : `${h} tim`; }
      else { const days = Math.round(abs / 1440); txt = days === 1 ? '1 dag' : `${days} dagar`; }
      return mins >= 0 ? `om ${txt}` : `för ${txt} sedan`;
    },
  };
  MM.d = d;

  // ---------------------------------------------------------------- Formatering
  const nbsp = ' ';
  const group = (n) => String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  MM.fmt = {
    /** öre -> "1 523 kr" (heltal kronor om jämnt, annars med ören) */
    kr(ore) { if (ore == null) return '–'; const neg = ore < 0; const kr = Math.abs(ore) / 100; const s = Number.isInteger(kr) ? group(kr) : `${group(Math.floor(kr))},${pad(Math.round((kr % 1) * 100))}`; return `${neg ? '−' : ''}${s}${nbsp}kr`; },
    krExact(ore) { if (ore == null) return '–'; const neg = ore < 0; const a = Math.abs(ore); return `${neg ? '−' : ''}${group(Math.floor(a / 100))},${pad(a % 100)}${nbsp}kr`; },
    pct(v, dec = 1) { if (v == null || Number.isNaN(v)) return '–'; return `${(v * 100).toFixed(dec).replace('.', ',')}${nbsp}%`; },
    num(n) { return n == null ? '–' : group(n); },
    plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; },
  };

  // ---------------------------------------------------------------- Validering
  MM.valid = {
    /** Beställarreferens: mönster läses från avtalskonfigurationen. */
    buyerRef(s, cfg) { const p = (cfg || MM.cfg()).billing.buyerReference.pattern; return new RegExp(p).test(String(s || '').trim()); },
    poNumber(s, cfg) { const p = (cfg || MM.cfg()).billing.purchaseOrderNumber.pattern; return new RegExp(p).test(String(s || '').trim()); },
    buyerRefError(s, cfg) {
      const v = String(s || '').trim();
      if (!v) return 'Beställarreferens saknas. Den får ni av kommunens ekonomi eller er chef.';
      if (/\D/.test(v)) return 'Beställarreferensen får bara innehålla siffror – inga mellanslag, bindestreck eller bokstäver.';
      if (!MM.valid.buyerRef(v, cfg)) return `Beställarreferensen ska vara 8–10 siffror. Du har skrivit ${v.length}.`;
      return null;
    },
    /** Personnummer/samordningsnummer – bara format (ÅÅÅÅMMDD-NNNN eller ÅÅMMDD-NNNN). */
    pnrFormat(s) { return /^(\d{6}|\d{8})[-+]?\d{4}$/.test(String(s || '').trim()); },
    luhn(digits) { let sum = 0; for (let i = 0; i < digits.length; i++) { let v = +digits[i] * (i % 2 === 0 ? 2 : 1); if (v > 9) v -= 9; sum += v; } return sum % 10 === 0; },
    email(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); },
    /** "8–10" ur mönstret för beställarreferens i konfigurationen. */
    buyerRefLengthText(cfg) { const m = (cfg || MM.cfg()).billing.buyerReference.pattern.match(/\{(\d+),(\d+)\}/); return m ? `${m[1]}–${m[2]}` : ''; },
  };

  // ---------------------------------------------------------------- Slump (deterministisk)
  MM.rng = (seed) => {
    let a = seed >>> 0;
    const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return {
      next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
      weighted: (pairs) => { const tot = pairs.reduce((s, p) => s + p[1], 0); let r = next() * tot; for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs[pairs.length - 1][0]; },
      shuffle: (arr) => { const a2 = arr.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; },
    };
  };

  // ---------------------------------------------------------------- Småhjälpare
  MM.cls = (...xs) => xs.filter(Boolean).join(' ');
  MM.by = (key, dir = 1) => (a, b) => { const x = typeof key === 'function' ? key(a) : a[key]; const y = typeof key === 'function' ? key(b) : b[key]; return x < y ? -dir : x > y ? dir : 0; };
  MM.groupBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); (m[k] = m[k] || []).push(x); return m; }, {});
  MM.sum = (arr, fn = (x) => x) => arr.reduce((s, x) => s + fn(x), 0);
  MM.uniq = (arr) => [...new Set(arr)];
  MM.initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  // ---------------------------------------------------------------- Ikoner (24×24, streck)
  const P = {
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
    'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
    'chevron-up': '<polyline points="18 15 12 9 6 15"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    stop: '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    reset: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
    'map-pin': '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="1"/><line x1="9" y1="6" x2="9.01" y2="6"/><line x1="15" y1="6" x2="15.01" y2="6"/><line x1="9" y1="10" x2="9.01" y2="10"/><line x1="15" y1="10" x2="15.01" y2="10"/><line x1="9" y1="14" x2="9.01" y2="14"/><line x1="15" y1="14" x2="15.01" y2="14"/><path d="M10 22v-4h4v4"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    'minus-circle': '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    reply: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
    key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    frown: '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    meh: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
    'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    square: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    'file-plus': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
  };
  MM.iconNames = Object.keys(P);
  /** Returnerar SVG-sträng – används via MM.ui.Icon. */
  MM.iconSvg = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.circle}</svg>`;
})();
