import { S } from '../state.js';
import { MONTHS, MSHORT, CATS, fmt, short, money, iso, parseKey, key, nowKey,
         catColor, catTint, catIcon, catLabel, catOf } from '../utils.js';
import { md, calc, pushEntry, pushDraw, saveMeta, ensureDay, shiftDay } from '../data.js';
import { paintIcons } from '../icons.js';
import { render } from '../app.js';
import { formModal, confirmDialog, toast, openSheet } from '../ui.js';

// Today answers one question: what can I spend right now. Logging lives in
// a sheet so the number, the meter and the Log button all sit above the
// fold on a phone.

let autoOpened = false;
let noteOpen = false;

export function todayView() {
  ensureDay();
  const k = S.viewMonth, c = calc(k, S.curDay), { y, m } = parseKey(k);
  const real = new Date();
  const dnum = curSafe(c);
  const tIso = iso(y, m, dnum);
  const d = md(k);
  const dayEntries = d.entries.filter(e => e.date === tIso);
  const spentToday = dayEntries.reduce((s, e) => s + e.amount, 0);
  const pct = c.perDay > 0 ? Math.min(100, spentToday / c.perDay * 100) : 0;
  const over = spentToday > c.perDay;
  const dObj = new Date(y, m, dnum);
  const isToday = (nowKey() === k && real.getDate() === dnum);
  const prevBlocked = dnum === 1 && (() => {
    const p = new Date(y, m - 1, 1);
    return key(p.getFullYear(), p.getMonth()) < S.config.startMonth;
  })();

  let banner = '';
  if (c.drawn > 0) {
    banner = '<div class="banner warn"><i class="ti ti-arrow-down-right"></i>You pulled ' +
      fmt(c.drawn) + ' from savings this month. Bills and this month\'s target are still covered.</div>';
  } else if (isToday && real.getHours() >= 21 && spentToday === 0) {
    banner = '<div class="banner warn"><i class="ti ti-moon"></i>Nothing logged today. ' +
      'Add what you spent before you sleep.</div>';
  }

  return '<div class="wrap">' +
    // date and the day arrows share one row, so the old nav card is gone
    '<div class="topbar"><div><div class="eyebrow">Pool</div>' +
    '<h1>' + (isToday ? 'Today' : MONTHS[m] + ' ' + y) + '</h1></div>' +
    '<div style="display:flex;align-items:center;gap:6px;">' +
      '<button class="navbtn" id="dPrev"' + (prevBlocked ? ' disabled' : '') + '>' +
      '<i class="ti ti-chevron-left"></i></button>' +
      '<div class="meta" style="min-width:88px;">' +
      dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
      '<br><span style="color:var(--ink3);">' + c.daysLeft + ' days left</span></div>' +
      '<button class="navbtn" id="dNext"><i class="ti ti-chevron-right"></i></button>' +
    '</div></div>' +

    '<div class="hero"><div class="hero-label">Safe to spend today</div>' +
    '<div class="hero-num">' + fmt(c.perDay) + '<span class="cur">VND</span></div>' +
    '<div class="hero-sub">' + fmt(c.available) + ' left in the pool</div>' +
    '<div class="meter' + (over ? ' over' : '') + '"><span style="width:' + pct + '%"></span></div>' +
    '<div class="meter-legend"><span>' + fmt(spentToday) + ' spent</span><span>' +
    (over ? 'over by ' + fmt(spentToday - c.perDay) : fmt(c.perDay - spentToday) + ' to go') +
    '</span></div></div>' +

    '<button class="btn solid logcta" id="openLog" style="background:' + catColor(S.selCat) + ';">' +
    '<i class="ti ti-pencil-plus"></i>Log a spend</button>' +

    banner +

    (dayEntries.length
      ? '<div class="card" style="margin-top:12px;"><div class="card-head">' +
        '<div class="lhs"><i class="ti ti-list"></i>Logged this day</div>' +
        '<span style="font-variant-numeric:tabular-nums;">' + fmt(spentToday) + '</span></div>' +
        entryRows(dayEntries) + '</div>'
      : '') +

    '<div class="card"><div class="card-head"><div class="lhs">' +
    '<i class="ti ti-shield-check"></i>Savings</div></div>' +
    '<div class="kv" style="padding-top:0;"><span>Balance</span>' +
    '<span class="v serif" style="font-size:17px;">' + fmt(S.meta.savingsBalance) + '</span></div>' +
    '<div class="kv"><span>Adding this month</span><span class="v">' +
    fmt(S.config.savingsTarget - c.drawn) + '</span></div>' +
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
  noteOpen = false;

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

    const nl = q('#noteLink');
    if (nl) nl.onclick = () => { noteOpen = true; refresh(api); };

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
      noteOpen = false;
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
  return '<div class="sheet-top"><div>' +
    '<div class="sheet-label">Safe to spend today</div>' +
    '<div class="sheet-num">' + fmt(c.perDay) + '<span class="cur">VND</span></div>' +
    '<div class="sheet-sub">' + c.daysLeft + ' days left · ' +
    dObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
    '</div></div>' +
    '<button class="sheet-x"><i class="ti ti-x"></i></button></div>';
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

    (noteOpen
      ? '<input id="note" type="text" placeholder="Note" style="margin-top:12px;" />'
      : '<button class="notelink" id="noteLink">Add a note</button>') +

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
