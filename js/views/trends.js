import { S } from '../state.js';
import { MONTHS, MSHORT, fmt, short, parseKey, dim, nowKey } from '../utils.js';
import { md, calc } from '../data.js';

// Everything here spans more than one month. Today logs, Calendar is this
// month, Trends is whether you are actually getting better.

const DOW_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Months that have at least one entry, oldest first. */
function loggedMonths() {
  return Object.keys(S.months)
    .filter(k => (S.months[k].entries || []).length > 0)
    .sort();
}

/** Share of a month's spending that landed in the first seven days. */
function frontLoad(k) {
  const entries = md(k).entries;
  const total = entries.reduce((s, e) => s + e.amount, 0);
  if (!total) return null;
  const first = entries
    .filter(e => +e.date.slice(8, 10) <= 7)
    .reduce((s, e) => s + e.amount, 0);
  return { total, first, pct: Math.round((first / total) * 100) };
}

// ---------------------------------------------------------------- charts

function svg(inner, w, h, extra = '') {
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="chart" ' +
    'preserveAspectRatio="none" role="img" ' + extra + '>' + inner + '</svg>';
}

/** Cumulative spend against the even-pace line. The bend is the diagnosis. */
function curveChart(k) {
  const c = calc(k, S.curDay);
  const entries = md(k).entries;
  if (!entries.length) return '';

  const W = 300, H = 120, PAD = 6;
  const lastDay = c.isNow ? c.today : c.days;

  const perDay = {};
  entries.forEach(e => {
    const d = +e.date.slice(8, 10);
    perDay[d] = (perDay[d] || 0) + e.amount;
  });

  const maxY = Math.max(c.pool, c.spent) || 1;
  const x = d => PAD + ((d - 1) / (c.days - 1)) * (W - PAD * 2);
  const y = v => H - PAD - (v / maxY) * (H - PAD * 2);

  let run = 0;
  const pts = [];
  for (let d = 1; d <= lastDay; d++) {
    run += perDay[d] || 0;
    pts.push(x(d).toFixed(1) + ',' + y(run).toFixed(1));
  }

  const paceLine = '<line x1="' + x(1) + '" y1="' + y(0) + '" x2="' + x(c.days) +
    '" y2="' + y(c.pool) + '" stroke="var(--line2)" stroke-width="1.5" stroke-dasharray="4 4"/>';

  const area = '<polygon points="' + x(1) + ',' + y(0) + ' ' + pts.join(' ') + ' ' +
    x(lastDay) + ',' + y(0) + '" fill="var(--sage-bg)"/>';

  const line = '<polyline points="' + pts.join(' ') + '" fill="none" ' +
    'stroke="var(--sage)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

  const ahead = run > (c.pool / c.days) * lastDay;
  const verdict = ahead
    ? 'Above the even pace by ' + fmt(run - (c.pool / c.days) * lastDay)
    : 'Below the even pace by ' + fmt((c.pool / c.days) * lastDay - run);

  return '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-chart-line"></i>Spending curve</div>' +
    '<span style="font-size:12px;color:var(--ink3);">' + MSHORT[c.m] + '</span></div>' +
    svg(paceLine + area + line, W, H, 'style="height:120px"') +
    '<div class="chart-note">' + verdict +
    '. The dashed line is spending evenly every day.</div></div>';
}

/** How the daily number moved. Each drop is a big day. */
function sawtoothChart(k) {
  const c = calc(k, S.curDay);
  if (!md(k).entries.length) return '';

  const W = 300, H = 90, PAD = 6;
  const lastDay = c.isNow ? c.today : c.days;

  const vals = [];
  for (let d = 1; d <= lastDay; d++) vals.push(calc(k, d).perDay);

  const maxY = Math.max(...vals) || 1;
  const minY = Math.min(...vals);
  const span = Math.max(maxY - minY, 1);
  const x = d => PAD + ((d - 1) / Math.max(c.days - 1, 1)) * (W - PAD * 2);
  const y = v => H - PAD - ((v - minY) / span) * (H - PAD * 2);

  const pts = vals.map((v, i) => x(i + 1).toFixed(1) + ',' + y(v).toFixed(1));
  const line = '<polyline points="' + pts.join(' ') + '" fill="none" ' +
    'stroke="var(--brass)" stroke-width="2.5" stroke-linejoin="round"/>';

  const delta = vals[vals.length - 1] - vals[0];
  const note = delta >= 0
    ? 'Up ' + fmt(delta) + ' since day one, so you have been spending under it.'
    : 'Down ' + fmt(Math.abs(delta)) + ' since day one. Every big day pushes this lower.';

  return '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-activity"></i>Your daily number</div>' +
    '<span style="font-variant-numeric:tabular-nums;font-size:12px;color:var(--ink3);">' +
    fmt(vals[0]) + ' → ' + fmt(vals[vals.length - 1]) + '</span></div>' +
    svg(line, W, H, 'style="height:90px"') +
    '<div class="chart-note">' + note + '</div></div>';
}

/** The scoreboard. Is the front-loading actually shrinking? */
function scoreboard() {
  const months = loggedMonths();
  if (!months.length) return '';

  const rows = months.slice(-6).map(k => {
    const f = frontLoad(k);
    if (!f) return '';
    const { y, m } = parseKey(k);
    const heavy = f.pct > 30;
    return '<div class="brow">' +
      '<span class="bl" style="min-width:74px;">' + MSHORT[m] + ' ' + String(y).slice(2) + '</span>' +
      '<span class="bbar"><span style="width:' + Math.min(100, f.pct) + '%;background:' +
      (heavy ? 'var(--brass)' : 'var(--sage)') + '"></span></span>' +
      '<span class="bv">' + f.pct + '%</span></div>';
  }).join('');

  const withData = months.filter(k => frontLoad(k));
  let note;
  if (withData.length < 2) {
    note = 'One month of data. Come back next month and this becomes a comparison.';
  } else {
    const first = frontLoad(withData[0]).pct;
    const last = frontLoad(withData[withData.length - 1]).pct;
    const diff = first - last;
    note = diff > 2
      ? 'Down ' + diff + ' points since you started. The front-loading is easing.'
      : diff < -2
        ? 'Up ' + Math.abs(diff) + ' points since you started. Still front-loading harder.'
        : 'Roughly flat since you started.';
  }

  return '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-target"></i>First-week share</div>' +
    '<span style="font-size:12px;color:var(--ink3);">23% is even</span></div>' +
    rows +
    '<div class="chart-note">' + note + '</div></div>';
}

/** Average spend by weekday, across everything logged. */
function weekdayChart() {
  const buckets = Array.from({ length: 7 }, () => ({ sum: 0, days: 0 }));
  const seen = new Set();
  let any = false;

  loggedMonths().forEach(k => {
    const { y, m } = parseKey(k);
    const c = calc(k, S.curDay);
    const lastDay = c.isNow ? c.today : dim(y, m);
    const byDay = {};
    md(k).entries.forEach(e => {
      const d = +e.date.slice(8, 10);
      byDay[d] = (byDay[d] || 0) + e.amount;
      any = true;
    });
    for (let d = 1; d <= lastDay; d++) {
      const idx = (new Date(y, m, d).getDay() + 6) % 7;
      const id = k + '-' + d;
      if (seen.has(id)) continue;
      seen.add(id);
      buckets[idx].sum += byDay[d] || 0;
      buckets[idx].days += 1;
    }
  });

  if (!any) return '';

  const avgs = buckets.map(b => (b.days ? b.sum / b.days : 0));
  const max = Math.max(...avgs) || 1;
  const peak = avgs.indexOf(max);

  const bars = avgs.map((v, i) =>
    '<div class="wcol">' +
    '<div class="wbar-wrap"><div class="wbar" style="height:' +
    Math.max(3, (v / max) * 100) + '%;background:' +
    (i === peak ? 'var(--brass)' : 'var(--sage-mid)') + '"></div></div>' +
    '<div class="wlab">' + DOW_LABEL[i][0] + '</div>' +
    '<div class="wval">' + short(v) + '</div></div>'
  ).join('');

  return '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-calendar-month"></i>By day of the week</div></div>' +
    '<div class="weekgrid">' + bars + '</div>' +
    '<div class="chart-note">' + DOW_LABEL[peak] + ' is your heaviest day at ' +
    fmt(avgs[peak]) + ' on average. Averaged over every day since you started, ' +
    'including days you spent nothing.</div></div>';
}

/** Closed months, with what got swept into savings. */
function historyCard() {
  const months = loggedMonths().filter(k => k < nowKey());
  if (!months.length) return '';
  const rows = months.slice(-8).reverse().map(k => {
    const { y, m } = parseKey(k);
    const c = calc(k, dim(y, m));
    const left = c.available;
    return '<div class="kv"><span>' + MONTHS[m] + ' ' + y + '</span>' +
      '<span style="display:flex;gap:12px;align-items:baseline;">' +
      '<span class="v" style="color:var(--ink3);font-size:12.5px;">' + fmt(c.spent) + ' spent</span>' +
      '<span class="v" style="color:' + (left >= 0 ? 'var(--sage)' : 'var(--brass)') + ';">' +
      (left >= 0 ? '+' : '') + fmt(left) + '</span></span></div>';
  }).join('');
  return '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-archive"></i>Closed months</div>' +
    '<span style="font-size:12px;color:var(--ink3);">swept to savings</span></div>' +
    rows + '</div>';
}

// ---------------------------------------------------------------- view

export function trendsView() {
  const k = S.viewMonth;
  const months = loggedMonths();

  if (!months.length) {
    return '<div class="wrap">' +
      '<div class="topbar"><div><div class="eyebrow">Pool</div><h1>Trends</h1></div></div>' +
      '<div class="card"><div class="empty" style="padding:20px 0;">' +
      'Nothing to compare yet. Log a few days and the charts fill in.' +
      '</div></div></div>';
  }

  return '<div class="wrap">' +
    '<div class="topbar"><div><div class="eyebrow">Pool</div><h1>Trends</h1></div>' +
    '<div class="meta">' + months.length + ' month' + (months.length === 1 ? '' : 's') +
    ' logged</div></div>' +
    scoreboard() +
    curveChart(k) +
    sawtoothChart(k) +
    weekdayChart() +
    historyCard() +
    '</div>';
}

export function wireTrends() {
  // Charts are static SVG. Nothing to wire.
}
