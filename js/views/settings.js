import { S } from '../state.js';
import { fmt, money, wireMoney, parseKey, MONTHS, MSHORT, now, simDate, setSim, key, nowKey } from '../utils.js';
import { paintIcons } from '../icons.js';
import { calc, boot, plannedFor, md, pushEntry, saveConfig, saveMeta,
         monthState, saveMonthState, incomePending, billsUnpaid, savingsFor,
         isLocked } from '../data.js';
import * as DB from '../db.js';
import { render } from '../app.js';
import { toast, confirmDialog, formModal } from '../ui.js';

/** Bills plus savings must leave something to live on. The only invalid state. */
function validate({ income, savingsTarget, bills, planned }) {
  const inc = income ?? (S.config.incomeSources || []).reduce((s, x) => s + x.amount, 0);
  const sav = savingsTarget ?? S.config.savingsTarget;
  const bl = bills ?? S.config.lockedBills;
  const locked = bl.reduce((s, b) => s + b.amount, 0);
  const plan = planned ?? plannedFor(S.viewMonth).reduce((s, p) => s + p.amount, 0);
  if (inc - locked - sav - plan <= 0) {
    return `Bills (${fmt(locked)}), savings (${fmt(sav)})` +
      (plan ? ` and what you have set aside (${fmt(plan)})` : '') +
      ' would use up everything you earn.';
  }
  return null;
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

async function persist() {
  await saveConfig();
}

const COOL_DAYS = 30;

function todayISO() {
  const d = now();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}

function daysSince(iso) {
  const then = new Date(iso + 'T00:00:00');
  const now = new Date(todayISO() + 'T00:00:00');
  return Math.max(0, Math.round((now - then) / 86400000));
}

/** Months you can aim a want at: this one and the next eleven. */
function monthOptions() {
  const out = [];
  const start = parseKey(S.viewMonth);
  for (let i = 0; i < 12; i++) {
    const d = new Date(start.y, start.m + i, 1);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    out.push({ value: k, label: MONTHS[d.getMonth()] + ' ' + d.getFullYear() });
  }
  return out;
}

/**
 * Wants cost nothing until you decide they are real. Promoting one to
 * Coming up is the moment of commitment, and that is when the daily
 * number moves. Prices show in days of your allowance because 450.000 is
 * abstract and "1.3 days" is not.
 */
function wishlistCard() {
  const c = calc(S.viewMonth, S.curDay);
  const per = c.perDay || 1;
  const list = (S.config.wishlist || []).slice()
    .sort((a, b) => daysSince(b.added) - daysSince(a.added));

  const rows = list.map((w, i) => {
    const waited = daysSince(w.added);
    const ready = waited >= COOL_DAYS;
    const left = Math.max(0, COOL_DAYS - waited);
    const days = (w.amount / per).toFixed(1);
    const { m, y } = parseKey(w.target);
    const pct = Math.min(100, (waited / COOL_DAYS) * 100);

    return '<div class="wish' + (ready ? ' ready' : '') + '">' +

      '<div class="wish-top" style="display:flex;justify-content:space-between;' +
        'align-items:flex-start;gap:12px;">' +
        '<span class="wish-name">' + w.name + '</span>' +
        '<span class="wish-amt">' + fmt(w.amount) + '</span>' +
      '</div>' +

      '<div class="wish-sub" style="display:flex;gap:8px;align-items:center;' +
        'flex-wrap:wrap;margin-top:5px;">' +
        '<span class="wish-pill">' + days + ' days of your allowance</span>' +
        '<span>' + MONTHS[m] + ' ' + y + '</span>' +
      '</div>' +

      (ready
        ? '<div class="wish-status">Waited ' + waited + ' days. Still want it?</div>'
        : '<div class="wish-wait" style="display:flex;align-items:center;gap:10px;' +
            'margin-top:10px;">' +
            '<span class="wish-bar" style="flex:1;display:block;"><span style="width:' +
              pct + '%"></span></span>' +
            '<span class="wish-days">' + left + ' day' + (left === 1 ? '' : 's') + ' to go</span>' +
          '</div>') +

      '<div class="wish-acts" style="display:flex;align-items:center;gap:8px;margin-top:12px;">' +
        '<button class="btn outline wishplan" data-i="' + i + '">Set aside</button>' +
        '<button class="btn outline wishbuy" data-i="' + i + '">Bought it</button>' +
        '<button class="iconbtn wishdel" data-i="' + i + '" style="margin-left:auto;">' +
          '<i class="ti ti-trash"></i></button>' +
      '</div></div>';
  }).join('');

  return '<div class="card"><div class="card-head">' +
    '<div class="lhs"><i class="ti ti-bookmark"></i>Wishlist</div>' +
    '<span style="font-size:12px;color:var(--ink3);">' + list.length +
    ' item' + (list.length === 1 ? '' : 's') + '</span></div>' +
    '<div style="font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:12px;">' +
    'Things you might buy. These do not touch your daily number. After ' + COOL_DAYS +
    ' days each one asks whether you still want it, and most of the time you will not.</div>' +
    (list.length ? rows : '<div class="empty">Nothing on the list.</div>') +
    '<button class="addbill" id="addWish"><i class="ti ti-plus"></i>Add something</button></div>';
}

/** Two salaries, a bonus, freelance work. Each is ticked off when it
 *  actually lands, because the dates move around. */
function incomeCard(c) {
  const k = S.viewMonth;
  const st = monthState(k);
  const list = S.config.incomeSources || [];
  const total = list.reduce((s, x) => s + x.amount, 0);

  return '<div class="card"><div class="card-head">' +
    '<div class="lhs"><i class="ti ti-coin"></i>Money in</div>' +
    '<span style="font-variant-numeric:tabular-nums;">' + fmt(c.received) +
    (c.received !== total ? ' of ' + fmt(total) : '') + '</span></div>' +
    (list.length
      ? list.map((src, i) => {
          const inYet = st.incomeReceived[src.id] !== false;
          return '<div class="srcrow">' +
            '<button class="tick' + (inYet ? ' on' : '') + '" data-src="' + src.id + '">' +
            (inYet ? '<i class="ti ti-check"></i>' : '') + '</button>' +
            '<span class="srcname">' + src.name +
            '<span class="srcstate">' + (inYet ? 'received' : 'not in yet') + '</span></span>' +
            '<span class="v">' + fmt(src.amount) + '</span>' +
            '<button class="iconbtn srcdel" data-i="' + i + '"><i class="ti ti-trash"></i></button>' +
            '</div>';
        }).join('')
      : '<div class="empty">No income sources yet.</div>') +
    '<button class="addbill" id="addSrc"><i class="ti ti-plus"></i>Add an income source</button>' +
    '<div class="fhint">Every new month starts with all of these ticked. Untick one when ' +
    'it has not landed yet and the pool drops to what is actually there.</div>' +
    earlyRows(k) +
    '<div class="field-err" id="incomeErr" style="display:none;"></div></div>';
}

/** Next month's salary that lands during this one. It joins this pool
 *  straight away and is excluded from next month, so nothing is counted
 *  twice. Locked once ticked, because the money is already spendable. */
function earlyRows(k) {
  if (isLocked(k)) return '';
  const { y, m } = parseKey(k);
  const n = new Date(y, m + 1, 1);
  const nk = key(n.getFullYear(), n.getMonth());
  const nst = monthState(nk);
  const list = S.config.incomeSources || [];
  if (!list.length) return '';
  return '<div class="earlybox"><div class="earlyhead">Already arrived for ' +
    MONTHS[n.getMonth()] + '</div>' +
    list.map(src => {
      const on = nst.incomeEarly[src.id];
      return '<button class="paidrow early' + (on ? ' locked' : '') + '" data-early="' +
        src.id + '"' + (on ? ' disabled' : '') + '>' +
        '<span class="tick' + (on ? ' on' : '') + '">' +
        (on ? '<i class="ti ti-check"></i>' : '') + '</span>' +
        '<span class="srcname">' + src.name +
        (on ? '<span class="srcstate">in this pool since ' + on +
              ' · locked until ' + MONTHS[n.getMonth()] + '</span>' : '') + '</span>' +
        '<span class="v">' + fmt(src.amount) + '</span></button>';
    }).join('') +
    '<div class="fhint" style="margin-top:8px;">Tick it when next month\'s money lands early. ' +
    'It joins this pool straight away and will not be counted again next month. ' +
    'It cannot be unticked once the money is spendable.</div></div>';
}

/** Testing only. Moves the app's idea of today so a month rollover can be
 *  seen without waiting for one. Delete this card when you are done. */
function testCard() {
  const sim = simDate();
  const d = now();
  const nxt = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return '<div class="card" style="border-style:dashed;">' +
    '<div class="card-head"><div class="lhs"><i class="ti ti-flask"></i>Testing</div>' +
    (sim ? '<span style="font-size:12px;color:var(--brass);">simulated</span>' : '') + '</div>' +
    '<div style="font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:11px;">' +
    'The app currently thinks today is <b>' +
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) +
    '</b>. Jumping forward closes the current month, sweeps savings and opens a fresh pool, ' +
    'exactly as the real rollover will.</div>' +
    '<div style="display:flex;gap:8px;">' +
    '<button class="btn outline" id="jumpNext" style="flex:1;">Jump to 1 ' +
    MONTHS[nxt.getMonth()] + '</button>' +
    (sim ? '<button class="btn outline" id="jumpReal" style="flex:1;">Back to real time</button>' : '') +
    '</div></div>';
}

function plannedCard() {
  const list = (S.config.planned || []).slice().sort((a, b) => a.due.localeCompare(b.due));
  const total = plannedFor(S.viewMonth).reduce((s, p) => s + p.amount, 0);
  return '<div class="card"><div class="card-head">' +
    '<div class="lhs"><i class="ti ti-calendar-plus"></i>Coming up</div>' +
    '<span style="font-variant-numeric:tabular-nums;">' + fmt(total) + '</span></div>' +
    '<div style="font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:10px;">' +
    'One-off costs you already know about. Set them aside now and the money is ' +
    'there on the day, instead of the daily number cratering when it lands.</div>' +
    (list.length
      ? list.map((p, i) => {
          const { m } = parseKey(p.due.slice(0, 7));
          const day = p.due.slice(8, 10);
          return '<div class="kv"><span>' + p.name +
            '<span style="color:var(--ink3);font-size:12px;"> · ' + day + ' ' + MONTHS[m].slice(0, 3) + '</span></span>' +
            '<span style="display:flex;align-items:center;gap:8px;">' +
            '<span class="v">' + fmt(p.amount) + '</span>' +
            '<button class="btn quiet plandone" data-i="' + i + '">Spent</button>' +
            '<button class="iconbtn plandel" data-i="' + i + '"><i class="ti ti-trash"></i></button>' +
            '</span></div>';
        }).join('')
      : '<div class="empty">Nothing set aside.</div>') +
    '<button class="addbill" id="addPlanned"><i class="ti ti-plus"></i>Set money aside</button></div>';
}

export function setView() {
  const c = calc(S.viewMonth, S.curDay);
  return '<div class="wrap setup">' +
    '<div class="topbar"><div><div class="eyebrow">Pool</div><h1>Settings</h1></div>' +
    '<div class="meta">' + fmt(c.perDay) + ' / day<br>' +
    '<span style="color:var(--ink3);">changes apply straight away</span></div></div>' +

    incomeCard(c) +

    '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-lock"></i>Locked bills</div>' +
    '<span style="font-variant-numeric:tabular-nums;">' + fmt(c.locked) + '</span></div>' +
    (S.config.lockedBills.length
      ? S.config.lockedBills.map((b, i) => {
          const t = b.times || 1;
          return '<div class="kv"><span>' + b.name +
            (t > 1 ? '<span style="color:var(--ink3);font-size:12px;"> · ' +
              fmt(b.amount) + ' × ' + t + ' a month</span>' : '') + '</span>' +
            '<span style="display:flex;align-items:center;gap:10px;">' +
            '<span class="v">' + fmt(b.amount * t) + '</span>' +
            '<button class="iconbtn billdel" data-i="' + i + '"><i class="ti ti-trash"></i></button>' +
            '</span></div>';
        }).join('')
      : '<div class="empty">No bills yet.</div>') +
    '<button class="addbill" id="addBill"><i class="ti ti-plus"></i>Add a bill</button></div>' +

    plannedCard() +
    wishlistCard() +

    '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-shield-check"></i>Savings</div></div>' +
    '<label class="flabel" style="margin-top:0;">Target each month</label>' +
    '<input id="sSav" class="money" type="text" value="' + fmt(S.config.savingsTarget) + '" />' +
    '<div class="field-err" id="savErr" style="display:none;"></div>' +
    '<label class="flabel">Balance</label>' +
    '<input id="sBal" class="money" type="text" value="' + fmt(S.meta.savingsBalance) + '" /></div>' +

    testCard() +

    '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-download"></i>Backup</div></div>' +
    '<div style="font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:11px;">Everything lives in this browser only. Export a file now and then so clearing your browser cannot wipe your history.</div>' +
    '<div style="display:flex;gap:8px;"><button class="btn outline" id="expBtn" style="flex:1;">Export file</button>' +
    '<button class="btn outline" id="impBtn" style="flex:1;">Import file</button></div>' +
    '<input type="file" id="impFile" accept="application/json" style="display:none;" /></div>' +

    '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-trash"></i>Erase everything</div></div>' +
    '<div style="font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:11px;">Deletes every entry, your savings history and your setup, then starts the wizard again.</div>' +
    '<button class="btn danger" id="eraseT" style="width:100%;">Erase everything</button></div>' +
    '</div>';
}

export function wireSet() {
  const $ = id => document.getElementById(id);

  // ---- numbers commit on blur, not on keystroke ----
  // Saving per keystroke would briefly store "2" while you type "24500000",
  // which makes bills exceed income and zeroes the daily number mid-typing.
  const bindNumber = (id, errId, apply) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('blur', async () => {
      const value = money(el.value);
      const err = apply(value, true);
      const errEl = errId ? $(errId) : null;
      if (err) {
        // Refuse it and put the stored value back, so the field never
        // displays a number the app has not actually accepted.
        el.value = fmt(apply(null, true, 'current'));
        el.classList.remove('invalid');
        if (errEl) { errEl.textContent = err; errEl.style.display = 'block'; }
        return;
      }
      el.classList.remove('invalid');
      if (errEl) errEl.style.display = 'none';
      apply(value, false);
      await persist();
      render();
    });
  };

  // ---- income sources ----
  const k = S.viewMonth;
  const st = monthState(k);

  document.querySelectorAll('.tick[data-src]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.src;
      st.incomeReceived[id] = !(st.incomeReceived[id] !== false);
      if (st.incomeReceived[id] !== false) delete st.incomeReceived[id];
      await saveMonthState(k);
      render();
    };
  });

  document.querySelectorAll('.srcdel').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.i, 10);
      const removed = (S.config.incomeSources || [])[i];
      if (!removed) return;
      const next = S.config.incomeSources.filter((_, j) => j !== i);
      const err = validate({ income: next.reduce((s, x) => s + x.amount, 0) });
      if (err) { toast('Cannot remove it, ' + err.toLowerCase()); return; }
      S.config.incomeSources = next;
      await persist();
      render();
      toast('Removed ' + removed.name, async () => {
        S.config.incomeSources.splice(i, 0, removed);
        await persist();
        render();
      });
    };
  });

  const addSrc = $('addSrc');
  if (addSrc) addSrc.onclick = () => {
    formModal({
      title: 'Add an income source',
      fields: [
        { id: 'name', label: 'Whose, or what', placeholder: 'Keni salary' },
        { id: 'amount', label: 'How much each month', placeholder: '0', money: true }
      ],
      submitLabel: 'Add',
      onSubmit: ({ name, amount }) => {
        if (!name) return 'Give it a name.';
        if (amount <= 0) return 'Enter an amount above zero.';
        S.config.incomeSources = (S.config.incomeSources || [])
          .concat([{ id: 'src-' + Date.now(), name, amount }]);
        persist().then(() => { render(); toast('Added ' + name); });
        return null;
      }
    });
  };

  // ---- this month only ----
  bindNumber('sSav', 'savErr', (v, dry, mode) => {
    if (mode === 'current') return S.config.savingsTarget;
    if (v < 0) return 'Savings cannot be negative.';
    const err = validate({ savingsTarget: v });
    if (err) return err;
    if (!dry) S.config.savingsTarget = v;
    return null;
  });

  const bal = $('sBal');
  if (bal) {
    bal.addEventListener('blur', async () => {
      S.meta.savingsBalance = money(bal.value);
      await saveMeta();
      render();
    });
  }

  // ---- bills: immediate, with undo ----
  document.querySelectorAll('.billdel').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.i, 10);
      const removed = S.config.lockedBills[i];
      if (!removed) return;
      S.config.lockedBills.splice(i, 1);
      await persist();
      render();
      toast('Removed ' + removed.name + ' · ' + fmt(removed.amount), async () => {
        S.config.lockedBills.splice(i, 0, removed);
        await persist();
        render();
      });
    };
  });

  $('addBill').onclick = () => {
    formModal({
      title: 'Add a locked bill',
      fields: [
        { id: 'name', label: 'What is it', placeholder: 'Haircut' },
        { id: 'amount', label: 'Amount each time', placeholder: '0', money: true },
        { id: 'times', label: 'How many times a month', value: '1',
          select: [1,2,3,4,5].map(n => ({ value: n, label: n === 1 ? 'Once' : n + ' times' })) }
      ],
      submitLabel: 'Add',
      onSubmit: ({ name, amount, times }) => {
        if (!name) return 'Give it a name.';
        if (amount <= 0) return 'Enter an amount above zero.';
        const t = parseInt(times, 10) || 1;
        const next = S.config.lockedBills.concat([{ name, amount, times: t }]);
        const err = validate({ bills: next });
        if (err) return err;
        S.config.lockedBills = next;
        persist().then(() => {
          render();
          toast('Added ' + name + ' · ' + fmt(amount * t) + ' a month', async () => {
            S.config.lockedBills = S.config.lockedBills.filter(
              b => !(b.name === name && b.amount === amount)
            );
            await persist();
            render();
          });
        });
        return null;
      }
    });
  };

  document.querySelectorAll('.paidrow.early').forEach(btn => {
    btn.onclick = async () => {
      const { y, m } = parseKey(k);
      const n = new Date(y, m + 1, 1);
      const nk = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
      const nst = monthState(nk);
      const id = btn.dataset.early;
      // Locked once ticked: the money is in the pool and may already be spent,
      // so unticking it would silently take spendable money away.
      if (nst.incomeEarly[id]) return;
      nst.incomeEarly[id] = now().toISOString().slice(0, 10);
      await saveMonthState(nk);
      render();
      toast(fmt((S.config.incomeSources.find(x => x.id === id) || {}).amount || 0) +
            ' added to this pool');
    };
  });

  const jn = $('jumpNext');
  if (jn) jn.onclick = () => {
    const d = now();
    const nxt = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    setSim(nxt.getFullYear() + '-' + String(nxt.getMonth() + 1).padStart(2, '0') + '-01');
    location.reload();
  };
  const jr = $('jumpReal');
  if (jr) jr.onclick = () => { setSim(null); location.reload(); };

  // ---- planned one-off spends ----
  const addPlanned = $('addPlanned');
  if (addPlanned) {
    addPlanned.onclick = () => {
      const { y, m } = parseKey(S.viewMonth);
      const dflt = S.viewMonth + '-' + String(Math.min(28, (S.curDay || 1) + 7)).padStart(2, '0');
      formModal({
        title: 'Set money aside',
        fields: [
          { id: 'name', label: 'What for', placeholder: 'Wedding gift' },
          { id: 'amount', label: 'How much', placeholder: '0', money: true },
          { id: 'due', label: 'When (YYYY-MM-DD)', value: dflt }
        ],
        submitLabel: 'Set aside',
        onSubmit: ({ name, amount, due }) => {
          if (!name) return 'Give it a name.';
          if (amount <= 0) return 'Enter an amount above zero.';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return 'Date needs to look like 2026-09-22.';
          const thisMonth = due.slice(0, 7) === S.viewMonth ? amount : 0;
          const cur = plannedFor(S.viewMonth).reduce((s, p) => s + p.amount, 0);
          const err = validate({ planned: cur + thisMonth });
          if (err) return err;
          S.config.planned = (S.config.planned || []).concat([{ name, amount, due }]);
          persist().then(() => {
            render();
            toast('Set aside ' + fmt(amount) + ' for ' + name);
          });
          return null;
        }
      });
    };
  }

  document.querySelectorAll('.plandel').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.i, 10);
      const list = (S.config.planned || []).slice().sort((a, b) => a.due.localeCompare(b.due));
      const target = list[i];
      if (!target) return;
      S.config.planned = S.config.planned.filter(p => p !== target);
      await persist();
      render();
      toast('Removed ' + target.name, async () => {
        S.config.planned.push(target);
        await persist();
        render();
      });
    };
  });

  // "Spent" turns the set-aside money into a real entry, so it stops
  // being subtracted twice.
  document.querySelectorAll('.plandone').forEach(btn => {
    btn.onclick = async () => {
      const i = parseInt(btn.dataset.i, 10);
      const list = (S.config.planned || []).slice().sort((a, b) => a.due.localeCompare(b.due));
      const target = list[i];
      if (!target) return;
      const k = target.due.slice(0, 7);
      const before = calc(k, S.curDay);
      await pushEntry(k, {
        id: 'e' + Date.now(), amount: target.amount, note: target.name,
        cat: 'others', date: target.due, snap: Math.round(before.perDay)
      });
      S.config.planned = S.config.planned.filter(p => p !== target);
      await persist();
      render();
      toast('Logged ' + fmt(target.amount) + ' · ' + target.name);
    };
  });

  // ---- wishlist ----
  const wishSorted = () => (S.config.wishlist || []).slice()
    .sort((a, b) => daysSince(b.added) - daysSince(a.added));

  const addWish = $('addWish');
  if (addWish) {
    addWish.onclick = () => {
      formModal({
        title: 'Add to wishlist',
        body: 'This will not change your daily number. It sits here for ' +
              COOL_DAYS + ' days first.',
        fields: [
          { id: 'name', label: 'What is it', placeholder: 'Running shoes' },
          { id: 'amount', label: 'Roughly how much', placeholder: '0', money: true },
          { id: 'target', label: 'Aiming for', select: monthOptions(), value: S.viewMonth }
        ],
        submitLabel: 'Add',
        onSubmit: ({ name, amount, target }) => {
          if (!name) return 'Give it a name.';
          if (amount <= 0) return 'Enter an amount above zero.';
          S.config.wishlist = (S.config.wishlist || [])
            .concat([{ name, amount, target, added: todayISO() }]);
          persist().then(() => {
            const per = calc(S.viewMonth, S.curDay).perDay || 1;
            render();
            toast(name + ' · ' + (amount / per).toFixed(1) + ' days of your allowance');
          });
          return null;
        }
      });
    };
  }

  document.querySelectorAll('.wishdel').forEach(btn => {
    btn.onclick = async () => {
      const target = wishSorted()[parseInt(btn.dataset.i, 10)];
      if (!target) return;
      S.config.wishlist = S.config.wishlist.filter(w => w !== target);
      await persist();
      render();
      toast('Removed ' + target.name, async () => {
        S.config.wishlist.push(target);
        await persist();
        render();
      });
    };
  });

  // Promoting is the moment of commitment, so it shows the cost first.
  document.querySelectorAll('.wishplan').forEach(btn => {
    btn.onclick = () => {
      const target = wishSorted()[parseInt(btn.dataset.i, 10)];
      if (!target) return;
      const sameMonth = target.target === S.viewMonth;
      const before = calc(S.viewMonth, S.curDay);
      const cur = plannedFor(S.viewMonth).reduce((s, p) => s + p.amount, 0);
      const err = sameMonth ? validate({ planned: cur + target.amount }) : null;
      const { m, y } = parseKey(target.target);

      const after = sameMonth
        ? Math.round((before.available - target.amount) / Math.max(1, before.daysLeft))
        : before.perDay;

      confirmDialog({
        title: 'Set aside ' + fmt(target.amount) + '?',
        body: err
          ? err
          : (sameMonth
              ? 'Your daily number drops from ' + fmt(before.perDay) + ' to <b>' +
                fmt(after) + '</b> for the ' + before.daysLeft + ' days left, and the money ' +
                'is there when you buy it. '
              : 'It comes out of ' + MONTHS[m] + ' ' + y +
                ', so this month is unaffected.'
            ) +
          (err ? '' : '<br><br>Rent, bills and savings stay covered either way.'),
        confirmLabel: err ? 'OK' : 'Set it aside',
        onYes: async () => {
          if (err) return;
          S.config.planned = (S.config.planned || []).concat([{
            name: target.name, amount: target.amount, due: target.target + '-28'
          }]);
          S.config.wishlist = S.config.wishlist.filter(w => w !== target);
          await persist();
          render();
          toast('Moved ' + target.name + ' to Coming up');
        }
      });
    };
  });

  document.querySelectorAll('.wishbuy').forEach(btn => {
    btn.onclick = async () => {
      const target = wishSorted()[parseInt(btn.dataset.i, 10)];
      if (!target) return;
      const k = S.viewMonth;
      const before = calc(k, S.curDay);
      const { y, m } = parseKey(k);
      const day = String(S.curDay || 1).padStart(2, '0');
      await pushEntry(k, {
        id: 'e' + Date.now(), amount: target.amount, note: target.name,
        cat: 'shopping', date: k + '-' + day, snap: Math.round(before.perDay)
      });
      S.config.wishlist = S.config.wishlist.filter(w => w !== target);
      await persist();
      render();
      toast('Logged ' + fmt(target.amount) + ' · ' + target.name);
    };
  });

  // ---- backup ----
  $('expBtn').onclick = async () => {
    const dump = { config: S.config, meta: S.meta, months: S.months };
    const blob = new Blob(
      [JSON.stringify({ v: 2, exported: now().toISOString(), data: dump }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pool-backup-' + now().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup downloaded');
  };

  $('impBtn').onclick = () => $('impFile').click();

  $('impFile').onchange = async ev => {
    const f = ev.target.files[0];
    if (!f) return;
    let parsed;
    try {
      parsed = JSON.parse(await f.text());
      if (!parsed || !parsed.data) throw new Error('bad file');
    } catch (e) {
      ev.target.value = '';
      confirmDialog({
        title: 'That file could not be read',
        body: 'It does not look like a Pool backup. Nothing has been changed.',
        confirmLabel: 'OK', onYes: () => {}
      });
      return;
    }

    // v1 files came from the localStorage version; v2 from this one.
    const d = parsed.data;
    const inConfig = d.config || d['config'];
    const inMeta = d.meta || d['meta'];
    const inMonths = d.months || Object.keys(d)
      .filter(k => k.startsWith('month:'))
      .reduce((o, k) => (o[k.slice(6)] = d[k], o), {});

    if (!inConfig || !inMonths) {
      ev.target.value = '';
      confirmDialog({
        title: 'That backup is missing data',
        body: 'Nothing has been changed.', confirmLabel: 'OK', onYes: () => {}
      });
      return;
    }

    const incoming = Object.keys(inMonths)
      .reduce((n, k) => n + ((inMonths[k] && inMonths[k].entries) || []).length, 0);
    const mine = Object.keys(S.months)
      .reduce((n, k) => n + (S.months[k].entries || []).length, 0);

    confirmDialog({
      title: 'Replace everything with this backup?',
      body: 'This replaces the shared pool, not just this device. Your current ' +
            'data (<b>' + plural(mine, 'entry', 'entries') + '</b>) will be deleted and ' +
            'replaced with the backup (<b>' + plural(incoming, 'entry', 'entries') + '</b>), ' +
            'exported ' + String(parsed.exported || '').slice(0, 10) + '. ' +
            'Your girlfriend will see this too. It cannot be undone.',
      confirmLabel: 'Replace',
      danger: true,
      onYes: async () => {
        const cfg = Object.assign({}, inConfig, { poolId: S.config.poolId });
        await DB.pushSnapshot(cfg, inMeta || S.meta, inMonths);
        S.config = null; S.meta = null; S.months = {};
        await boot();
        toast('Backup restored');
      }
    });
    ev.target.value = '';
  };

  // ---- erase ----
  $('eraseT').onclick = () => {
    const entryCount = Object.keys(S.months)
      .reduce((n, k) => n + (S.months[k].entries || []).length, 0);
    confirmDialog({
      title: 'Erase everything?',
      body: 'This wipes the <b>shared</b> pool, so it disappears from her phone too, ' +
            'and drops you back into setup. ' +
            plural(entryCount, 'entry', 'entries') + ', your savings balance of ' +
            '<b>' + fmt(S.meta.savingsBalance) + '</b>, your bills, planned spends and ' +
            'wishlist all go. Export a backup first if you might want any of it.',
      confirmLabel: 'Erase everything',
      danger: true,
      onYes: async () => {
        await DB.deletePool(S.config.poolId);
        S.config = null; S.meta = null; S.months = {}; S.monthStates = {};
        S.viewMonth = null; S.curDay = null;
        S.wiz = { step: 1, year: 0, month: null, draft: null, mode: 'create' };
        await boot();   // finds no pool, opens setup
      }
    });
  };

  wireMoney();
  paintIcons();
}
