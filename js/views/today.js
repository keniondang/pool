import { S } from '../state.js';
import { MONTHS, MSHORT, CATS, fmt, short, money, iso, parseKey, key, nowKey, catColor, catTint, catIcon, catLabel, catOf, now } from '../utils.js';
import { md, calc, pushEntry, pushDraw, saveMeta, ensureDay, shiftDay, plannedFor,
         monthState, saveMonthState, incomePending, savingsFor, isLocked,
         balanceNow, heldBack, billsPaidOn, savingsMovedYet } from '../data.js';
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
  if (!c.pool || !c.cycleDays) return 0;
  const elapsed = c.ref - c.cycleStart + 1;
  return (c.spent / (c.pool / c.cycleDays)) - elapsed;
}

function paceLine(c, k) {
  const p = pace(c);
  const pending = incomePending(k);
  const spentPct = Math.min(100, Math.max(0, c.spent / c.pool * 100));
  const elapsed = c.ref - c.cycleStart + 1;
  const monthPct = Math.min(100, elapsed / c.cycleDays * 100);
  const facts = Math.round(spentPct) + '% of the pool gone, ' +
                Math.round(monthPct) + '% through ' +
                (c.cycleStart > 1 ? 'your ' + c.cycleDays + ' days' : 'the month') + '. ';

  if (c.available <= 0 && pending.length) {
    // Not spent, just not arrived. Different problem, different sentence.
    const owed = pending.reduce((s, x) => s + x.amount, 0);
    return { over: true, spentPct, monthPct,
      text: '<b>Waiting on ' + fmt(owed) + '</b> before there is anything to spend.' };
  }
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
      '<i class="ti ti-calendar-plus"></i><span>' + p.name + ', <b>' + fmt(p.amount) +
      '</b>, set aside for the ' + ordinal(+p.due.slice(8, 10)) + '</span></div>');
  });
  (S.config.wishlist || []).forEach(w => {
    if (daysSince(w.added) >= 30) {
      out.push('<div class="banner safe" style="margin-bottom:8px;">' +
        '<i class="ti ti-bookmark"></i><span>' + w.name +
        ' has waited 30 days. Still want it?</span></div>');
    }
  });
  return out.join('');
}

/** Only appears while something has not landed. Marking it received is
 *  one tap and the daily number jumps immediately. */
function pendingIncomeCard(k) {
  const pending = incomePending(k);
  if (!pending.length) return '';
  const total = pending.reduce((s, x) => s + x.amount, 0);
  return '<div class="card pending"><div class="card-head">' +
    '<div class="lhs"><i class="ti ti-clock-hour-4"></i>Not in yet</div>' +
    '<span style="font-variant-numeric:tabular-nums;">' + fmt(total) + '</span></div>' +
    pending.map(src =>
      '<div class="srcrow"><span class="srcname">' + src.name + '</span>' +
      '<span class="v">' + fmt(src.amount) + '</span>' +
      '<button class="btn outline gotit" data-src="' + src.id + '">Got it</button></div>'
    ).join('') +
    '<div class="fhint">Your daily number is working from what has actually landed.</div>' +
    '</div>';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function daysSince(isoDate) {
  const then = new Date(isoDate + 'T00:00:00');
  const now = now();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now - then) / 86400000));
}

export function todayView() {
  ensureDay();
  const k = S.viewMonth;
  const { y, m } = parseKey(k);
  const locked = isLocked(k);

  // The hero always speaks for the real day. Walking back to yesterday
  // must not change what is safe to spend now.
  const c = calc(k);
  const real = now();
  const isCurrent = nowKey() === k;

  const dnum = S.curDay;
  const tIso = iso(y, m, dnum);
  const dayEntries = md(k).entries.filter(e => e.date === tIso);
  const dayTotal = dayEntries.reduce((s, e) => s + e.amount, 0);
  const todayTotal = md(k).entries
    .filter(e => e.date === iso(y, m, c.ref))
    .reduce((s, e) => s + e.amount, 0);

  const dObj = new Date(y, m, dnum);
  const viewingToday = isCurrent && dnum === real.getDate();
  const prevBlocked = dnum === 1 && (() => {
    const p = new Date(y, m - 1, 1);
    return key(p.getFullYear(), p.getMonth()) < S.config.startMonth;
  })();
  const nextBlocked = isCurrent
    ? dnum >= real.getDate()
    : (() => { const n = new Date(y, m + 1, 1);
               return key(n.getFullYear(), n.getMonth()) > nowKey() && dnum >= c.days; })();

  const pl = paceLine(c, k);
  const over = todayTotal > c.perDay;
  const pct = c.perDay > 0 ? Math.min(100, todayTotal / c.perDay * 100) : 0;

  let banner = '';
  if (locked) {
    banner = '<div class="banner lockbar"><i class="ti ti-lock"></i><span>' +
      MONTHS[m] + ' is closed. You can look, but not change anything.</span></div>';
  } else if (c.drawn > 0) {
    banner = '<div class="banner warn"><i class="ti ti-arrow-down-right"></i><span>You pulled ' +
      fmt(c.drawn) + ' from savings this month. Bills and this month\'s target are still covered.</span></div>';
  } else if (viewingToday && real.getHours() >= 21 && todayTotal === 0) {
    banner = '<div class="banner warn"><i class="ti ti-moon"></i><span>Nothing logged today. ' +
      'Add what you spent before you sleep.</span></div>';
  }

  const header =
    '<div class="topbar"><div><div class="eyebrow">Pool</div>' +
    '<h1>' + (isCurrent ? 'Today' : MONTHS[m] + ' ' + y) + '</h1></div>' +
    '<div class="meta">' +
    (isCurrent
      ? real.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
        '<br><span style="color:var(--ink3);">' + c.daysLeft + ' days left in ' + MSHORT[m] + '</span>'
      : 'closed month<br><span style="color:var(--ink3);">' + c.days + ' days</span>') +
    '</div></div>';

  const daynav =
    '<div class="daynav">' +
      '<button class="navbtn" id="dPrev"' + (prevBlocked ? ' disabled' : '') + '>' +
      '<i class="ti ti-chevron-left"></i></button>' +
      '<div class="daynav-mid"><span class="dn">' +
      dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
      (viewingToday ? '' : ' <span class="viewonly">' + (locked ? 'closed' : 'past day') + '</span>') +
      '</span><span class="ds">' +
      (dayTotal > 0 ? fmt(dayTotal) + ' logged' : 'nothing logged') + '</span></div>' +
      '<button class="navbtn" id="dNext"' + (nextBlocked ? ' disabled' : '') + '>' +
      '<i class="ti ti-chevron-right"></i></button>' +
    '</div>';

  // A closed month gets a summary instead of a daily number, because
  // "safe to spend today" is meaningless once the month is over.
  const hero = locked
    ? '<div class="hero closed"><div class="hero-label">' + MONTHS[m] + ' finished</div>' +
      '<div class="hero-num">' + fmt(c.spent) + '<span class="cur">spent</span></div>' +
      '<div class="herostats">' +
        '<div><span class="l">Pool was</span><span class="v">' + fmt(c.pool) + '</span></div>' +
        '<div><span class="l">' + (c.available >= 0 ? 'Left over' : 'Over by') + '</span>' +
        '<span class="v">' + fmt(Math.abs(c.available)) + '</span></div>' +
        '<div><span class="l">Big days</span><span class="v">' + c.big + '</span></div>' +
      '</div></div>'
    : '<div class="hero tint' + (pl.over ? ' warn' : '') + '">' +
      '<div class="hero-label">Safe to spend today</div>' +
      '<div class="hero-num">' + fmt(c.perDay) + '<span class="cur">VND</span></div>' +
      '<div class="herostats">' +
        '<div><span class="l">In the account</span><span class="v">' + fmt(c.balance) + '</span></div>' +
        '<div><span class="l">Held back</span><span class="v">' + fmt(c.held) + '</span></div>' +
        '<div><span class="l">' + (c.available < 0 ? 'Overspent' : 'Free to spend') + '</span>' +
        '<span class="v">' + fmt(Math.abs(c.available)) + '</span></div>' +
      '</div>' +
      '<div class="mb-head"><span>Pool spent</span><span>day ' +
      (c.ref - c.cycleStart + 1) + ' of ' + c.cycleDays + '</span></div>' +
      '<div class="monthbar"><span class="mb-fill" style="width:' + pl.spentPct + '%"></span>' +
      '<span class="mb-tick" style="left:' + pl.monthPct + '%"></span></div>' +
      '<div class="pace">' + pl.text + '</div></div>';

  return '<div class="wrap">' + header + daynav + hero +

    (locked ? '' :
      '<button class="btn solid logcta" id="openLog" style="background:' + catColor(S.selCat) + ';">' +
      '<i class="ti ti-pencil-plus"></i>Log a spend' +
      (viewingToday ? '' : ' for ' + dObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) +
      '</button>') +

    banner +
    (locked ? '' : pendingIncomeCard(k)) +
    (locked || !c.early ? '' :
      '<div class="banner safe"><i class="ti ti-coin"></i><span><b>' + fmt(c.early) +
      '</b> arrived early and is in this pool. It will not be counted again next month.</span></div>') +
    (locked ? '' : upcomingCard(k, c)) +

    (function () {
      const paid = billsPaidOn(k, tIso);
      if (!dayEntries.length && !paid.length) return '';
      return '<div class="card"><div class="card-head">' +
        '<div class="lhs"><i class="ti ti-list"></i>Logged ' +
        (viewingToday ? 'today' : 'this day') + '</div>' +
        '<span style="font-variant-numeric:tabular-nums;">' + fmt(dayTotal) + '</span></div>' +
        entryRows(dayEntries, locked) +
        // Grey, and outside the day's spending total, so paying rent does
        // not turn the day amber or distort your first-week share.
        paid.map(p => '<div class="entry billpay"><span class="amt">' + fmt(p.amount) + '</span>' +
          '<span class="cat"><i class="ti ti-lock"></i>bill</span>' +
          '<span class="note">' + p.bill.name + '</span></div>').join('') +
        '</div>';
    })() +

    stripCard(k, c) +

    '<div class="handled"><i class="ti ti-lock"></i><span><b>' + fmt(c.held) +
    '</b> held back for bills and savings, still in the account</span></div>' +

    '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-shield-check"></i>Savings</div></div>' +
    '<div class="kv" style="padding-top:0;"><span>Balance</span>' +
    '<span class="v serif" style="font-size:17px;">' + fmt(S.meta.savingsBalance) + '</span></div>' +
    '<div class="kv"><span>' + (locked ? 'Added that month' : 'Adding this month') + '</span>' +
    '<span class="v">' + fmt(c.savings - c.drawn) + '</span></div>' +
    savedRow(k, c, locked) +
    (!locked && c.available <= 0 && !incomePending(k).length
      ? '<div class="banner warn" style="margin:12px 0 0;"><i class="ti ti-arrow-down-right"></i>' +
        '<span>The pool is empty with ' + c.daysLeft +
        ' days to go. This is the moment to use savings.</span></div>'
      : '') +
    (locked ? '' :
      '<div style="margin-top:10px;"><button class="btn quiet" id="drawT">Use savings this month</button></div>') +
    '</div></div>';
}

function curSafe(c) {
  return S.curDay || (c.isNow ? now().getDate() : 1);
}

function entryRows(list, locked) {
  return list.map(e =>
    '<div class="entry">' +
    '<span class="amt">' + fmt(e.amount) + '</span>' +
    '<span class="cat" style="background:' + catTint(catOf(e)) + ';color:' + catColor(catOf(e)) + '">' +
    '<i class="ti ' + catIcon(catOf(e)) + '"></i>' + catLabel(catOf(e)) + '</span>' +
    '<span class="note">' + (e.note || '') + '</span>' +
    (locked ? '' : '<button class="iconbtn del" data-id="' + e.id + '"><i class="ti ti-trash"></i></button>') +
    '</div>'
  ).join('');
}

/** A savings balance that grows whether or not you moved the money is
 *  fiction, so the sweep waits for this tick. */
function savedRow(k, c, locked) {
  if (locked || c.savings <= 0) return '';
  const done = savingsMovedYet(k);
  return '<button class="paidrow savedone" style="margin-top:4px;">' +
    '<span class="tick' + (done ? ' on' : '') + '">' +
    (done ? '<i class="ti ti-check"></i>' : '') + '</span>' +
    '<span class="srcname">' + (done ? 'Money moved across' : 'Not moved across yet') +
    '<span class="srcstate">' +
    (done ? 'moved out of the account, no longer held back'
          : 'held back from your daily number until it moves') +
    '</span></span></button>';
}

export function wireToday() {
  const $ = id => document.getElementById(id);
  $('dPrev').onclick = () => shiftDay(-1);
  $('dNext').onclick = () => shiftDay(1);
  if ($('openLog')) $('openLog').onclick = () => openLogSheet();
  if ($('drawT')) $('drawT').onclick = () => openDraw(S.viewMonth);

  const sd = document.querySelector('.savedone');
  if (sd) sd.onclick = async () => {
    const k = S.viewMonth;
    const st = monthState(k);
    if (st.savingsMoved) {
      st.savingsMoved = null;
    } else {
      const { y, m } = parseKey(k);
      const day = nowKey() === k ? now().getDate() : (S.curDay || 1);
      st.savingsMoved = { amount: savingsFor(k), on: iso(y, m, day) };
      S.meta.savingsBalance += savingsFor(k);
      await saveMeta();
    }
    await saveMonthState(k);
    render();
    toast(st.savingsMoved ? 'Savings moved' : 'Marked as not moved');
  };

  document.querySelectorAll('.gotit').forEach(btn => {
    btn.onclick = async () => {
      const st = monthState(S.viewMonth);
      delete st.incomeReceived[btn.dataset.src];
      await saveMonthState(S.viewMonth);
      render();
      toast('Marked as received');
    };
  });
}

/** Opens once per page load, then only when the Log button is pressed. */
export function maybeAutoOpen() {
  if (autoOpened || !S.config || isLocked(S.viewMonth)) return;
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
      const c = calc(k);
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
  const c = calc(k);
  const { y, m } = parseKey(k);
  const dObj = new Date(y, m, S.curDay);
  const spentToday = md(k).entries
    .filter(e => e.date === iso(y, m, c.ref))
    .reduce((s, e) => s + e.amount, 0);
  const pct = c.perDay > 0 ? Math.min(100, spentToday / c.perDay * 100) : 0;
  const over = spentToday > c.perDay;

  return '<div class="sheet-top"><div style="flex:1;min-width:0;">' +
      '<div class="sheet-label">Safe to spend today</div>' +
      '<div class="sheet-num">' + fmt(c.perDay) + '<span class="cur">VND</span></div>' +
      '<div class="sheet-sub">' + fmt(c.available) + ' left in the pool · ' +
        c.daysLeft + ' days left' +
        (S.curDay === c.ref ? '' :
          ' · <b>logging ' + dObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</b>') +
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
