import { S } from '../state.js';
import { MONTHS, MSHORT, CATS, fmt, short, money, iso, parseKey, key, nowKey,
         catColor, catTint, catIcon, catLabel, catOf } from '../utils.js';
import { md, calc, pushEntry, pushDraw, saveMeta, ensureDay, shiftDay, plannedFor } from '../data.js';
import { paintIcons } from '../icons.js';
import { render } from '../app.js';
import { formModal, confirmDialog, toast, openSheet } from '../ui.js';

// Today answers one question: what can I spend right now. Logging lives in
// a sheet so the number, the meter and the Log button all sit above the
// fold on a phone.

let autoOpened = false;

/** Days ahead of or behind an even spend across the month.
 *  Positive means over pace. The divisor is the daily number you
 *  started the month with, so it reads in the same unit as everything else. */
function pace(c) {
  if (!c.pool || !c.days) return 0;
  return (c.spent / (c.pool / c.days)) - c.ref;
}

function paceLine(c) {
  const p = pace(c);
  const spentPct = Math.min(100, Math.max(0, c.spent / c.pool * 100));
  const monthPct = Math.min(100, c.ref / c.days * 100);
  const facts = Math.round(spentPct) + '% of the pool gone, ' +
                Math.round(monthPct) + '% through the month. ';

  if (c.available <= 0) {
    return { over: true, spentPct, monthPct,
      text: '<b>Pool is spent, ' + c.daysLeft + ' days to go.</b>' };
  }
  if (Math.abs(p) < 0.5) {
    return { over: false, spentPct, monthPct, text: facts + '<b>Right on pace.</b>' };
  }
  if (p < 0) {
    return { over: false, spentPct, monthPct,
      text: facts + '<b>About ' + Math.round(-p) + ' days under pace.</b>' };
  }
  return { over: true, spentPct, monthPct,
    text: facts + '<b>About ' + Math.round(p) + ' days over pace.</b> ' +
          'Your number dropped to ' + fmt(c.perDay) + ' to cover it.' };
}

/** Up to fourteen days ending on the day you are viewing. */
function stripCard(k, c) {
  const from = Math.max(1, c.ref - 13);
  const days = [];
  for (let dd = from; dd <= c.ref; dd++) {
    const info = c.byDay[dd];
    days.push({ d: dd, total: info ? info.total : 0, snap: info ? info.snap : 0 });
  }
  if (!days.some(x => x.total > 0)) return '';

  const max = Math.max.apply(null, days.map(x => x.total)) || 1;
  const bars = days.map(x => {
    const h = x.total ? Math.max(8, (x.total / max) * 100) : 4;
    const colour = !x.total ? 'var(--line)'
      : x.total > x.snap ? 'var(--brass)'
      : x.d === c.ref ? 'var(--sage)' : 'var(--sage-mid)';
    return '<div class="sbar" style="height:' + h + '%;background:' + colour + '"></div>';
  }).join('');

  const big = days.filter(x => x.total && x.total > x.snap).length;
  const firstWeek = days.filter(x => x.d <= 7 && x.total && x.total > x.snap).length;
  const note = big === 0
    ? 'Every day under your number.'
    : big + ' big day' + (big === 1 ? '' : 's') +
      (firstWeek >= 2 ? ', ' + firstWeek + ' of them in your first week.' : '.');

  return '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-chart-bar"></i>' +
    (days.length < 14 ? 'This month so far' : 'Last 14 days') + '</div></div>' +
    '<div class="strip">' + bars + '</div>' +
    '<div class="strip-note">' + note + '</div></div>';
}

/** Only rendered when something is actually waiting. */
function upcomingCard(k, c) {
  const out = [];
  plannedFor(k).forEach(p => {
    out.push('<div class="banner warn" style="margin-bottom:8px;">' +
      '<i class="ti ti-calendar-plus"></i>' + p.name + ', <b>' + fmt(p.amount) +
      '</b>, set aside for the ' + ordinal(+p.due.slice(8, 10)) + '</div>');
  });
  (S.config.wishlist || []).forEach(w => {
    if (daysSince(w.added) >= 30) {
      out.push('<div class="banner safe" style="margin-bottom:8px;">' +
        '<i class="ti ti-bookmark"></i>' + w.name + ' has waited 30 days. Still want it?</div>');
    }
  });
  return out.join('');
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function daysSince(isoDate) {
  const then = new Date(isoDate + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now - then) / 86400000));
}

export function todayView() {
  ensureDay();
  const k = S.viewMonth, c = calc(k, S.curDay), { y, m } = parseKey(k);
  const real = new Date();
  const dnum = S.curDay;
  const tIso = iso(y, m, dnum);
  const dayEntries = md(k).entries.filter(e => e.date === tIso);
  const spentToday = dayEntries.reduce((s, e) => s + e.amount, 0);
  const dObj = new Date(y, m, dnum);
  const isToday = (nowKey() === k && real.getDate() === dnum);
  const prevBlocked = dnum === 1 && (() => {
    const p = new Date(y, m - 1, 1);
    return key(p.getFullYear(), p.getMonth()) < S.config.startMonth;
  })();
  const pl = paceLine(c);

  let banner = '';
  if (c.drawn > 0) {
    banner = '<div class="banner warn"><i class="ti ti-arrow-down-right"></i>You pulled ' +
      fmt(c.drawn) + ' from savings this month. Bills and this month\'s target are still covered.</div>';
  } else if (isToday && real.getHours() >= 21 && spentToday === 0) {
    banner = '<div class="banner warn"><i class="ti ti-moon"></i>Nothing logged today. ' +
      'Add what you spent before you sleep.</div>';
  }

  return '<div class="wrap">' +
    '<div class="topbar"><div><div class="eyebrow">Pool</div>' +
    '<h1>' + (isToday ? 'Today' : MONTHS[m] + ' ' + y) + '</h1></div>' +
    '<div class="meta">' +
    dObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
    '<br><span style="color:var(--ink3);">' + c.daysLeft + ' days left in ' + MSHORT[m] +
    '</span></div></div>' +

    '<div class="daynav">' +
      '<button class="navbtn" id="dPrev"' + (prevBlocked ? ' disabled' : '') + '>' +
      '<i class="ti ti-chevron-left"></i></button>' +
      '<div class="daynav-mid"><span class="dn">' +
      dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
      '</span><span class="ds">' +
      (spentToday > 0 ? fmt(spentToday) + ' logged' : 'nothing logged') + '</span></div>' +
      '<button class="navbtn" id="dNext"><i class="ti ti-chevron-right"></i></button>' +
    '</div>' +

    // Tinted fill and a month-length bar, so it cannot be mistaken for the
    // white sheet header that measures the day.
    '<div class="hero tint' + (pl.over ? ' warn' : '') + '">' +
    '<div class="hero-label">Safe to spend today</div>' +
    '<div class="hero-num">' + fmt(c.perDay) + '<span class="cur">VND</span></div>' +
    '<div class="mb-head"><span>Month spent</span><span>day ' + c.ref + ' of ' + c.days + '</span></div>' +
    '<div class="monthbar"><span class="mb-fill" style="width:' + pl.spentPct + '%"></span>' +
    '<span class="mb-tick" style="left:' + pl.monthPct + '%"></span></div>' +
    '<div class="pace">' + pl.text + '</div>' +
    '</div>' +

    '<button class="btn solid logcta" id="openLog" style="background:' + catColor(S.selCat) + ';">' +
    '<i class="ti ti-pencil-plus"></i>Log a spend</button>' +

    banner +
    upcomingCard(k, c) +

    (dayEntries.length
      ? '<div class="card"><div class="card-head">' +
        '<div class="lhs"><i class="ti ti-list"></i>Logged this day</div>' +
        '<span style="font-variant-numeric:tabular-nums;">' + fmt(spentToday) + '</span></div>' +
        entryRows(dayEntries) + '</div>'
      : '') +

    stripCard(k, c) +

    '<div class="handled"><i class="ti ti-lock"></i><span><b>' +
    fmt(c.locked + S.config.savingsTarget) + '</b> in bills and savings already covered</span></div>' +

    '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-shield-check"></i>Savings</div></div>' +
    '<div class="kv" style="padding-top:0;"><span>Balance</span>' +
    '<span class="v serif" style="font-size:17px;">' + fmt(S.meta.savingsBalance) + '</span></div>' +
    '<div class="kv"><span>Adding this month</span><span class="v">' +
    fmt(S.config.savingsTarget - c.drawn) + '</span></div>' +
    (c.available <= 0
      ? '<div class="banner warn" style="margin:12px 0 0;"><i class="ti ti-arrow-down-right"></i>' +
        'The pool is empty with ' + c.daysLeft + ' days to go. This is the moment to use savings.</div>'
      : '') +
    '<div style="margin-top:10px;"><button class="btn quiet" id="drawT">Use savings this month</button></div>' +
    '</div></div>';
}

function curSafe(c) {
  return S.curDay || (c.isNow ? new Date().getDate() : 1);
}

function entryRows(list) {
  return list.map(e =>
    '<div class="entry">' +
    '<span class="amt">' + fmt(e.amount) + '</span>' +
    '<span class="cat" style="background:' + catTint(catOf(e)) + ';color:' + catColor(catOf(e)) + '">' +
    '<i class="ti ' + catIcon(catOf(e)) + '"></i>' + catLabel(catOf(e)) + '</span>' +
    '<span class="note">' + (e.note || '') + '</span>' +
    '<button class="iconbtn del" data-id="' + e.id + '"><i class="ti ti-trash"></i></button></div>'
  ).join('');
}

export function wireToday() {
  const $ = id => document.getElementById(id);
  $('dPrev').onclick = () => shiftDay(-1);
  $('dNext').onclick = () => shiftDay(1);
  $('openLog').onclick = () => openLogSheet();
  $('drawT').onclick = () => openDraw(S.viewMonth);
}

/** Opens once per page load, then only when the Log button is pressed. */
export function maybeAutoOpen() {
  if (autoOpened || !S.config) return;
  autoOpened = true;
  openLogSheet();
}

// ---------------------------------------------------------------- log sheet

export function openLogSheet() {
  const k = S.viewMonth;
  ensureDay();
  const { y, m } = parseKey(k);

  const sheet = openSheet({
    header: sheetHeader(k),
    body: sheetBody(k),
    onMount(wrap, api) { wire(wrap, api); }
  });

  function refresh(api) {
    api.setHeader(sheetHeader(k));
    api.setBody(sheetBody(k));
  }

  function wire(wrap, api) {
    paintIcons();
    const q = sel => wrap.querySelector(sel);

    const x = q('.sheet-x');
    if (x) x.onclick = () => api.close();

    wrap.querySelectorAll('.catchip').forEach(ch => {
      ch.onclick = () => {
        S.selCat = ch.dataset.c;
        refresh(api);
      };
    });

    const amt = q('#amt');
    if (amt) {
      amt.addEventListener('input', () => {
        const dg = amt.value.replace(/[^\d]/g, '');
        amt.value = dg ? parseInt(dg, 10).toLocaleString('de-DE') : '';
      });
      setTimeout(() => amt.focus(), 120);
    }

    wrap.querySelectorAll('.chip').forEach(ch => {
      ch.onclick = () => {
        amt.value = (money(amt.value) + parseInt(ch.dataset.v, 10)).toLocaleString('de-DE');
      };
    });

    const clr = q('#clrAmt');
    if (clr) clr.onclick = () => { amt.value = ''; amt.focus(); };

    const log = q('#logBtn');
    if (log) log.onclick = async () => {
      const raw = money(amt.value);
      if (raw <= 0) return;
      const c = calc(k, S.curDay);
      const noteEl = q('#note');
      const entry = {
        id: 'e' + Date.now(), amount: raw,
        note: noteEl ? noteEl.value.trim() : '',
        cat: S.selCat, date: iso(y, m, S.curDay), snap: Math.round(c.perDay)
      };
      await pushEntry(k, entry);
      S.meta.lastAmounts = S.meta.lastAmounts || {};
      S.meta.lastAmounts[S.selCat] = raw;
      await saveMeta();
      // The sheet stays open on purpose: three purchases at a till
      // become one sheet and three taps instead of three round trips.
      refresh(api);
      render();
      toast('Logged ' + fmt(raw) + ' · ' + catLabel(entry.cat));
    };

  }
}

function sheetHeader(k) {
  const c = calc(k, S.curDay);
  const { y, m } = parseKey(k);
  const dObj = new Date(y, m, S.curDay);
  const tIso = iso(y, m, S.curDay);
  const spentToday = md(k).entries
    .filter(e => e.date === tIso)
    .reduce((s, e) => s + e.amount, 0);
  const pct = c.perDay > 0 ? Math.min(100, spentToday / c.perDay * 100) : 0;
  const over = spentToday > c.perDay;

  return '<div class="sheet-top"><div style="flex:1;min-width:0;">' +
      '<div class="sheet-label">Safe to spend today</div>' +
      '<div class="sheet-num">' + fmt(c.perDay) + '<span class="cur">VND</span></div>' +
      '<div class="sheet-sub">' + fmt(c.available) + ' left in the pool · ' +
        c.daysLeft + ' days left · ' +
        dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
      '</div>' +
    '</div>' +
    '<button class="sheet-x"><i class="ti ti-x"></i></button></div>' +

    '<div class="meter' + (over ? ' over' : '') + '" style="margin-top:12px;">' +
    '<span style="width:' + pct + '%"></span></div>' +
    '<div class="meter-legend"><span>' + fmt(spentToday) + ' spent today</span><span>' +
    (over ? 'over by ' + fmt(spentToday - c.perDay) : fmt(c.perDay - spentToday) + ' to go') +
    '</span></div>';
}

function sheetBody(k) {

  return '<div class="catrow">' +
    CATS.map(ct => '<button class="catchip' + (S.selCat === ct.id ? ' on' : '') +
      '" data-c="' + ct.id + '" style="--cc:' + ct.c + ';--ct:' + ct.t + '">' +
      '<i class="ti ' + ct.icon + '"></i>' + ct.label + '</button>').join('') +
    '</div>' +

    '<div class="amtbox" style="border-color:' + catColor(S.selCat) + '">' +
    '<input id="amt" type="text" inputmode="numeric" placeholder="0" />' +
    '<span class="cur">VND</span>' +
    '<button class="clr" id="clrAmt"><i class="ti ti-x"></i></button></div>' +

    '<div class="chips">' +
    [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000]
      .map(v => '<button class="chip" data-v="' + v + '">+' + short(v) + '</button>').join('') +
    '</div>' +

    '<input id="note" type="text" placeholder="Note, optional" style="margin-top:12px;" />' +

    '<button class="btn solid" id="logBtn" style="width:100%;margin-top:14px;background:' +
    catColor(S.selCat) + ';">Log ' + catLabel(S.selCat).toLowerCase() + '</button>' +

    '';
}

// ---------------------------------------------------------------- savings draw

function openDraw(k) {
  const before = calc(k, S.curDay);
  const { y, m } = parseKey(k);

  formModal({
    title: 'Use savings this month',
    fields: [{ id: 'amount', label: 'How much to move into the pool', placeholder: '0', money: true }],
    submitLabel: 'Continue',
    onSubmit: ({ amount }) => {
      if (amount <= 0) return 'Enter an amount above zero.';
      if (amount > S.meta.savingsBalance)
        return 'You only have ' + fmt(S.meta.savingsBalance) + ' saved.';

      const after = Math.round((before.available + amount) / Math.max(1, before.daysLeft));

      confirmDialog({
        title: 'Move ' + fmt(amount) + ' from savings?',
        body: 'Savings balance drops to <b>' + fmt(S.meta.savingsBalance - amount) + '</b>.<br><br>' +
              'Your daily number goes from ' + fmt(before.perDay) + ' to <b>' + fmt(after) + '</b> ' +
              'for the ' + before.daysLeft + ' days left. ' +
              'Rent, bills and this month\'s savings target are unaffected either way.',
        confirmLabel: 'Move it',
        onYes: async () => {
          await pushDraw(k, { id: 'd' + Date.now(), amount, date: iso(y, m, S.curDay) });
          render();
          toast('Moved ' + fmt(amount) + ' from savings');
        }
      });
      return null;
    }
  });
}
