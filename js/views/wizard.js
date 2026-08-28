import { S } from '../state.js';
import * as DB from '../db.js';
import { MONTHS, MSHORT, fmt, money, key, nowKey, parseKey, dim, wireMoney, now } from '../utils.js';
import { paintIcons } from '../icons.js';
import { render } from '../app.js';
import { monthState, saveMonthState, maybeAutoMoveSavings } from '../data.js';

// Four steps. Nobody opens a budgeting app on the 1st of the month, so a
// mid-month start is a first-class path here rather than a repair job.

const blank = () => ({
  startMonth: nowKey(),
  useBalance: null,          // true = state what is left, false = derive from income
  balance: 0,
  incomeSources: [{ id: 'src-' + Date.now(), name: '', amount: 0 }],
  lockedBills: [
    { name: 'Rent and utilities', amount: 0, times: 1 },
    { name: 'Transport', amount: 0, times: 1 }
  ],
  planned: [],
  billsPaid: false,
  savingsTarget: 0,
  savingsThisMonth: null,    // null = same as target
  startingSavings: 0,
  dailyFloor: 0
});

function fromConfig() {
  const k = S.viewMonth || nowKey();
  const st = monthState(k);
  return {
    startMonth: S.config.startMonth,
    useBalance: st.balanceOverride !== null,
    balance: st.balanceOverride === null ? 0 : st.balanceOverride,
    incomeSources: (S.config.incomeSources || []).map(x => Object.assign({}, x)),
    lockedBills: (S.config.lockedBills || []).map(b => ({ name: b.name, amount: b.amount, times: b.times || 1 })),
    planned: (S.config.planned || []).map(p => Object.assign({}, p)),
    billsPaid: Object.keys(st.billsPaid || {}).length > 0,
    savingsTarget: S.config.savingsTarget,
    savingsThisMonth: st.savingsOverride,
    startingSavings: S.meta.savingsBalance,
    dailyFloor: S.config.dailyFloor || 0
  };
}

export function renderWizard(mode) {
  document.getElementById('tabbar').style.display = 'none';
  if (!S.wiz.draft) {
    S.wiz.mode = mode || 'create';
    S.wiz.draft = S.wiz.mode === 'edit' ? fromConfig() : blank();
    S.wiz.step = 1;
    S.wiz.year = parseKey(S.wiz.draft.startMonth).y;
  }
  const d = S.wiz.draft, step = S.wiz.step;

  document.getElementById('app').innerHTML =
    '<div class="wrap">' +
    '<div class="eyebrow">' + (S.wiz.mode === 'edit' ? 'Set up again' : 'Set up once') + '</div>' +
    '<h1 style="margin-bottom:14px;">' +
      (S.wiz.mode === 'edit' ? 'Adjust your pool' : 'Build your pool') + '</h1>' +
    '<div class="steps">' +
      [1, 2, 3, 4, 5].map(n => '<div class="' + (step >= n ? 'on' : '') + '"></div>').join('') +
    '</div>' +
    (step === 1 ? step1(d) : step === 2 ? step2(d) : step === 3 ? step3(d)
      : step === 4 ? step4(d) : step5(d)) +
    '</div>';

  wire();
  wireMoney();
  paintIcons();
}

// ---------------------------------------------------------------- step 1

function midMonth(d) {
  return d.startMonth === nowKey() && now().getDate() > 1;
}

function step1(d) {
  const y = S.wiz.year;
  const today = now();
  const dayNow = today.getDate();
  const { m } = parseKey(d.startMonth);

  return '<p class="setup-lead">Pick the month you want to start tracking. ' +
    'Today is ' + today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
    '.</p>' +

    '<div class="card">' +
      '<div class="yearnav"><button class="navbtn" id="yPrev"><i class="ti ti-chevron-left"></i></button>' +
      '<span class="y">' + y + '</span>' +
      '<button class="navbtn" id="yNext"' + (y >= parseKey(nowKey()).y ? ' disabled' : '') + '>' +
      '<i class="ti ti-chevron-right"></i></button></div>' +
      '<div class="mgrid">' + MSHORT.map((n, i) => {
        const kk = key(y, i);
        const future = kk > nowKey();
        return '<button class="mtile' + (d.startMonth === kk ? ' on' : '') + '"' +
          (future ? ' disabled' : '') + ' data-k="' + kk + '">' + n + '</button>';
      }).join('') + '</div>' +
    '</div>' +

    (midMonth(d)
      ? '<div class="card"><div class="card-head"><div class="lhs">' +
        '<i class="ti ti-calendar-stats"></i>You are starting on the ' + ordinal(dayNow) + '</div></div>' +
        '<div style="font-size:13.5px;color:var(--ink2);line-height:1.6;margin-bottom:12px;">' +
        MONTHS[m] + ' is already ' + Math.round(dayNow / dim(parseKey(d.startMonth).y, m) * 100) +
        '% gone, so working the pool out from a full month\'s income would overstate it. ' +
        'What is actually in your account right now?</div>' +

        '<button class="pick' + (d.useBalance === true ? ' on' : '') + '" data-pick="balance">' +
        '<span class="pt">I will tell you what is left</span>' +
        '<span class="ps">Most accurate mid-month. Only bills you have not paid come off it.</span>' +
        '</button>' +
        '<button class="pick' + (d.useBalance === false ? ' on' : '') + '" data-pick="derive">' +
        '<span class="pt">Work it out from my income</span>' +
        '<span class="ps">Right if the month\'s money is still untouched.</span>' +
        '</button>' +

        (d.useBalance === true
          ? '<label class="flabel">Money left right now</label>' +
            '<input id="wBalance" class="money" type="text" placeholder="0" value="' +
            (d.balance ? fmt(d.balance) : '') + '" />'
          : '') +
        '<div class="err" id="e1">Enter what you have left.</div>' +
        '</div>'
      : '<div class="err" id="e1">Pick a month.</div>') +

    '<div class="navbtns"><button class="btn solid" id="next1" style="flex:1;">Continue</button></div>' +
    '';
}

// ---------------------------------------------------------------- step 2

function step2(d) {
  return '<p class="setup-lead">Everything that lands in your account each month. ' +
    'Add one per person, so you can tick them off separately when the dates differ.</p>' +
    '<div class="card">' +
      '<div id="srcs">' + d.incomeSources.map(rowHTML('src')).join('') + '</div>' +
      '<button class="addbill" id="addSrc"><i class="ti ti-plus"></i>Add another</button>' +
      '<div class="kv total"><span>Each month</span><span class="v" id="srcTotal">' +
      fmt(d.incomeSources.reduce((s, x) => s + x.amount, 0)) + '</span></div>' +
    '</div>' +
    '<div class="err" id="e2">Give at least one source a name and an amount.</div>' +
    '<div class="navbtns"><button class="btn outline" id="back">Back</button>' +
    '<button class="btn solid" id="next2">Continue</button></div>';
}

// ---------------------------------------------------------------- step 3

function step3(d) {
  const { m } = parseKey(d.startMonth);
  return '<p class="setup-lead">These come off the top and never enter your daily number. ' +
    'That is what makes the end of the month safe.</p>' +
    '<div class="card">' +
      '<div id="bills">' + d.lockedBills.map(rowHTML('bill')).join('') + '</div>' +
      '<button class="addbill" id="addBill"><i class="ti ti-plus"></i>Add a bill</button>' +
      '<div class="kv total"><span>Locked each month</span><span class="v" id="billTotal">' +
      fmt(d.lockedBills.reduce((s, b) => s + b.amount * (b.times || 1), 0)) + '</span></div>' +
    '</div>' +
    '<div class="fhint">Put anything predictable here, including fun money like date nights. ' +
    'Use ×2 for things you pay twice a month, like a haircut at 180.000 each time.</div>' +

    (d.useBalance
      ? '<div class="card" style="margin-top:12px;"><div class="card-head"><div class="lhs">' +
        '<i class="ti ti-check"></i>Paid already?</div></div>' +
        '<button class="pick' + (d.billsPaid ? ' on' : '') + '" data-paid="1">' +
        '<span class="pt">Yes, this month\'s bills are paid</span>' +
        '<span class="ps">They came out of the balance you just told me, so they will not be deducted again.</span>' +
        '</button>' +
        '<button class="pick' + (!d.billsPaid ? ' on' : '') + '" data-paid="0">' +
        '<span class="pt">No, still to come out</span>' +
        '<span class="ps">They will be held back from your daily number.</span>' +
        '</button></div>'
      : '') +

    '<div class="navbtns"><button class="btn outline" id="back">Back</button>' +
    '<button class="btn solid" id="next3">Continue</button></div>';
}

// ---------------------------------------------------------------- step 4

function step4(d) {
  const { m } = parseKey(d.startMonth);
  return '<p class="setup-lead">Savings is your cushion. It is locked by default, ' +
    'but you can choose to pull from it in a hard month.</p>' +

    '<label class="flabel" style="margin-top:0;">Savings target each month</label>' +
    '<input id="wSav" class="money" type="text" value="' + fmt(d.savingsTarget) + '" />' +

    '<label class="flabel">Savings you already have</label>' +
    '<input id="wStart" class="money" type="text" value="' + fmt(d.startingSavings) + '" />' +

    (midMonth(d)
      ? '<label class="flabel">Saving in ' + MONTHS[m] + '</label>' +
        '<input id="wSavMonth" class="money" type="text" placeholder="same as target" value="' +
        (d.savingsThisMonth === null ? '' : fmt(d.savingsThisMonth)) + '" />' +
        '<div class="fhint">Blank keeps your usual target. Put 0 if you are skipping ' +
        MONTHS[m] + ' and starting properly next month.</div>'
      : '') +

    '<label class="flabel">Minimum you can live on per day</label>' +
    '<input id="wFloor" class="money" type="text" placeholder="0" ' +
    'value="' + (d.dailyFloor ? fmt(d.dailyFloor) : '') + '" />' +
    '<div class="fhint">Optional. Later, if spending keeps up and the honest daily ' +
    'number is about to drop below this, you get a warning ahead of time — the ' +
    'number itself is never propped up.</div>' +

    '<div class="err" id="e4">That does not leave anything to live on. Lower one of them.</div>' +
    '<div class="preview" id="prev"><span class="l">Your daily number</span>' +
    '<span class="v" id="prevV">0</span></div>' +
    '<div class="navbtns"><button class="btn outline" id="back">Back</button>' +
    '<button class="btn solid" id="next4">Continue</button></div>';
}

// ---------------------------------------------------------------- step 5

function step5(d) {
  const { m } = parseKey(d.startMonth);
  const p = previewDaily(d);
  return '<p class="setup-lead">Any one-off you already know about, like a wedding gift ' +
    'or a flight. Setting it aside now means the money is there on the day instead of ' +
    'the daily number cratering when it lands.</p>' +
    '<div class="card">' +
      '<div id="plans">' + (d.planned.length
        ? d.planned.map((p2, i) =>
            '<div class="kv"><span>' + p2.name +
            '<span style="color:var(--ink3);font-size:12px;"> · ' + p2.due + '</span></span>' +
            '<span style="display:flex;align-items:center;gap:10px;">' +
            '<span class="v">' + fmt(p2.amount) + '</span>' +
            '<button class="iconbtn planrm" data-i="' + i + '"><i class="ti ti-x"></i></button>' +
            '</span></div>').join('')
        : '<div class="empty">Nothing set aside. Most people skip this.</div>') + '</div>' +
      '<button class="addbill" id="addPlan"><i class="ti ti-plus"></i>Set money aside</button>' +
    '</div>' +
    '<div class="err" id="e4">That does not leave anything to live on. Lower something.</div>' +
    '<div class="preview" id="prev"><span class="l">Your daily number</span>' +
    '<span class="v" id="prevV">' + (p.pool <= 0 ? 'Does not fit' : fmt(p.perDay)) + '</span></div>' +
    '<div class="navbtns"><button class="btn outline" id="back">Back</button>' +
    '<button class="btn solid" id="done">' +
    (S.wiz.mode === 'edit' ? 'Save' : 'Start') + '</button></div>';
}

// ---------------------------------------------------------------- shared

function rowHTML(kind) {
  return (item, i) =>
    '<div class="billrow" data-i="' + i + '" data-kind="' + kind + '">' +
      '<input class="bn" type="text" value="' + (item.name || '') + '" placeholder="' +
      (kind === 'src' ? 'Whose' : 'Name') + '" />' +
      '<input class="ba money" type="text" value="' + (item.amount ? fmt(item.amount) : '') +
      '" placeholder="0" />' +
      (kind === 'bill'
        ? '<select class="bt">' + [1,2,3,4,5].map(n =>
            '<option value="' + n + '"' + ((item.times || 1) === n ? ' selected' : '') + '>' +
            (n === 1 ? '×1' : '×' + n) + '</option>').join('') + '</select>'
        : '') +
      '<button class="iconbtn rmrow"><i class="ti ti-x"></i></button>' +
    '</div>';
}

function readRows(sel) {
  return [].slice.call(document.querySelectorAll(sel + ' .billrow')).map(r => {
    const t = r.querySelector('.bt');
    return {
      name: r.querySelector('.bn').value.trim(),
      amount: money(r.querySelector('.ba').value),
      times: t ? parseInt(t.value, 10) : 1
    };
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** What the daily number will actually be, using the same rules as calc(). */
function previewDaily(d) {
  const { y, m } = parseKey(d.startMonth);
  const days = dim(y, m);
  const isNow = d.startMonth === nowKey();
  const refDay = isNow ? now().getDate() : 1;
  const daysLeft = days - refDay + 1;

  const bills = d.lockedBills.reduce((s, b) => s + b.amount * (b.times || 1), 0);
  const income = d.incomeSources.reduce((s, x) => s + x.amount, 0);
  const savings = (midMonth(d) && d.savingsThisMonth !== null) ? d.savingsThisMonth : d.savingsTarget;

  const planned = (d.planned || [])
    .filter(p => p.due && p.due.slice(0, 7) === d.startMonth)
    .reduce((s, p) => s + p.amount, 0);

  const pool = (d.useBalance
    ? d.balance - (d.billsPaid ? 0 : bills) - savings
    : income - bills - savings) - planned;

  return { pool, daysLeft, perDay: pool / Math.max(1, daysLeft) };
}

// ---------------------------------------------------------------- wiring

function wire() {
  const $ = id => document.getElementById(id);
  const d = S.wiz.draft;

  const back = $('back');
  if (back) back.onclick = () => { syncStep(); S.wiz.step--; renderWizard(); };

  if (S.wiz.step === 1) {
    $('yPrev').onclick = () => { S.wiz.year--; renderWizard(); };
    $('yNext').onclick = () => { if (S.wiz.year < parseKey(nowKey()).y) S.wiz.year++; renderWizard(); };
    document.querySelectorAll('.mtile').forEach(t => {
      if (t.disabled) return;
      t.onclick = () => { d.startMonth = t.dataset.k; if (!midMonth(d)) d.useBalance = null; renderWizard(); };
    });
    document.querySelectorAll('.pick[data-pick]').forEach(b => {
      b.onclick = () => { d.useBalance = b.dataset.pick === 'balance'; renderWizard(); };
    });
    $('next1').onclick = () => {
      if (midMonth(d)) {
        if (d.useBalance === null) {
          $('e1').textContent = 'Choose one of the two above.';
          $('e1').classList.add('show'); return;
        }
        if (d.useBalance) {
          const v = money($('wBalance').value);
          if (v <= 0) { $('e1').textContent = 'Enter what you have left.'; $('e1').classList.add('show'); return; }
          d.balance = v;
        }
      }
      S.wiz.step = 2; renderWizard();
    };
  }

  if (S.wiz.step === 2) {
    const sync = () => {
      $('srcTotal').textContent = fmt(readRows('#srcs').reduce((s, x) => s + x.amount, 0));
    };
    document.querySelectorAll('#srcs input').forEach(i => i.addEventListener('input', sync));
    $('addSrc').onclick = () => {
      syncStep();
      d.incomeSources.push({ id: 'src-' + Date.now() + Math.random().toString(36).slice(2, 5), name: '', amount: 0 });
      renderWizard();
    };
    $('next2').onclick = () => {
      syncStep();
      const good = d.incomeSources.filter(x => x.name && x.amount > 0);
      if (!good.length) { $('e2').classList.add('show'); return; }
      d.incomeSources = good;
      S.wiz.step = 3; renderWizard();
    };
  }

  if (S.wiz.step === 3) {
    const sync = () => {
      $('billTotal').textContent =
        fmt(readRows('#bills').reduce((s, b) => s + b.amount * (b.times || 1), 0));
    };
    document.querySelectorAll('#bills input, #bills select')
      .forEach(i => i.addEventListener('input', sync));
    $('addBill').onclick = () => { syncStep(); d.lockedBills.push({ name: '', amount: 0 }); renderWizard(); };
    document.querySelectorAll('.pick[data-paid]').forEach(b => {
      b.onclick = () => { syncStep(); d.billsPaid = b.dataset.paid === '1'; renderWizard(); };
    });
    $('next3').onclick = () => {
      syncStep();
      d.lockedBills = d.lockedBills.filter(b => b.name && b.amount > 0);
      S.wiz.step = 4; renderWizard();
    };
  }

  if (S.wiz.step === 4) {
    const upd = () => {
      syncStep();
      const p = previewDaily(d);
      const box = $('prev');
      if (p.pool <= 0) { box.classList.add('bad'); $('prevV').textContent = 'Does not fit'; }
      else { box.classList.remove('bad'); $('prevV').textContent = fmt(p.perDay); }
    };
    ['wSav', 'wStart', 'wSavMonth'].forEach(id => { if ($(id)) $(id).addEventListener('input', upd); });
    upd();
    $('next4').onclick = () => { syncStep(); S.wiz.step = 5; renderWizard(); };
  }

  if (S.wiz.step === 5) {
    $('addPlan').onclick = () => {
      import('../ui.js').then(({ formModal }) => {
        formModal({
          title: 'Set money aside',
          fields: [
            { id: 'name', label: 'What for', placeholder: 'Wedding gift' },
            { id: 'amount', label: 'How much', placeholder: '0', money: true },
            { id: 'due', label: 'When (YYYY-MM-DD)', value: d.startMonth + '-28' }
          ],
          submitLabel: 'Set aside',
          onSubmit: ({ name, amount, due }) => {
            if (!name) return 'Give it a name.';
            if (amount <= 0) return 'Enter an amount above zero.';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return 'Date needs to look like 2026-09-22.';
            d.planned.push({ name, amount, due });
            renderWizard();
            return null;
          }
        });
      });
    };
    document.querySelectorAll('.planrm').forEach(b => {
      b.onclick = () => { d.planned.splice(parseInt(b.dataset.i, 10), 1); renderWizard(); };
    });
    $('done').onclick = async () => {
      const btn = $('done');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await finish();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = S.wiz.mode === 'edit' ? 'Save' : 'Start';
        const e = $('e4');
        e.textContent = 'Could not save: ' +
          (err && err.message ? err.message : String(err));
        e.classList.add('show');
        console.error('setup failed', err);
      }
    };
  }

  document.querySelectorAll('.rmrow').forEach(btn => {
    btn.onclick = () => {
      const row = btn.closest('.billrow');
      const kind = row.dataset.kind, i = parseInt(row.dataset.i, 10);
      syncStep();
      if (kind === 'src') d.incomeSources.splice(i, 1);
      else d.lockedBills.splice(i, 1);
      renderWizard();
    };
  });
}

/** Pull whatever is on screen back into the draft before re-rendering. */
function syncStep() {
  const d = S.wiz.draft, $ = id => document.getElementById(id);
  if (S.wiz.step === 1 && $('wBalance')) d.balance = money($('wBalance').value);
  if (S.wiz.step === 2 && document.querySelector('#srcs')) {
    const rows = readRows('#srcs');
    d.incomeSources = rows.map((r, i) => ({
      id: (d.incomeSources[i] && d.incomeSources[i].id) || 'src-' + Date.now() + i,
      name: r.name, amount: r.amount
    }));
  }
  if (S.wiz.step === 3 && document.querySelector('#bills')) d.lockedBills = readRows('#bills');
  if (S.wiz.step === 4) {
    if ($('wSav')) d.savingsTarget = money($('wSav').value);
    if ($('wStart')) d.startingSavings = money($('wStart').value);
    if ($('wSavMonth')) {
      const raw = $('wSavMonth').value.trim();
      d.savingsThisMonth = raw === '' ? null : money(raw);
    }
    if ($('wFloor')) d.dailyFloor = money($('wFloor').value);
  }
}

async function finish() {
  const d = S.wiz.draft, $ = id => document.getElementById(id);
  syncStep();

  const p = previewDaily(d);
  if (p.pool <= 0) {
    $('e4').textContent = 'That does not leave anything to live on. Lower something.';
    $('e4').classList.add('show');
    const btn = $('done');
    btn.disabled = false;
    btn.textContent = S.wiz.mode === 'edit' ? 'Save' : 'Start';
    return;
  }
  $('e4').classList.remove('show');

  const creating = S.wiz.mode !== 'edit';

  if (creating) {
    const poolId = await DB.createPool({
      name: 'Our pool',
      income: d.incomeSources.reduce((s, x) => s + x.amount, 0),
      savingsTarget: d.savingsTarget,
      startingSavings: d.startingSavings,
      startMonth: d.startMonth,
      openingBalance: d.useBalance ? d.balance : 0
    });
    S.config = { poolId: poolId, startMonth: d.startMonth };
    S.meta = { savingsBalance: d.startingSavings, closed: [], lastAmounts: {} };
  }

  S.config.incomeSources = d.incomeSources;
  S.config.lockedBills = d.lockedBills;
  S.config.savingsTarget = d.savingsTarget;
  S.config.openingBalance = d.useBalance ? d.balance : 0;
  S.config.openingMonth = d.startMonth;
  S.config.planned = d.planned || [];
  S.config.wishlist = S.config.wishlist || [];
  S.config.dailyFloor = d.dailyFloor || 0;
  S.meta.savingsBalance = d.startingSavings;

  await DB.saveConfig(S.config);
  await DB.saveMeta(S.config.poolId, S.meta);

  // Reload so the bills come back with real ids, which the paid flags need.
  const fresh = await DB.loadAll();
  S.config = Object.assign(fresh.config, { startMonth: d.startMonth });
  S.meta = fresh.meta;
  S.months = fresh.months;
  S.monthStates = fresh.monthStates || {};

  const k = d.startMonth;
  const st = monthState(k);
  st.balanceOverride = (midMonth(d) && d.useBalance) ? d.balance : null;
  // Starting on the 21st means this cycle is 11 days, not 31.
  st.startDay = (midMonth(d) && d.useBalance) ? now().getDate() : 1;
  st.savingsOverride = midMonth(d) ? d.savingsThisMonth : null;
  st.billsPaid = {};
  if (midMonth(d) && d.useBalance && d.billsPaid) {
    // `on: null` means already paid before you started, so it is baked
    // into the opening balance and must not be deducted again.
    S.config.lockedBills.forEach(b => {
      st.billsPaid[b.id] = { amount: b.amount * (b.times || 1), on: null };
    });
  }
  // A stated balance already reflects this month's income.
  st.incomeReceived = {};
  if (midMonth(d) && d.useBalance) {
    (S.config.incomeSources || []).forEach(src => { st.incomeReceived[src.id] = false; });
  }
  await saveMonthState(k);
  await maybeAutoMoveSavings(k);

  S.viewMonth = (nowKey() >= d.startMonth) ? nowKey() : d.startMonth;
  S.curDay = null;
  S.wiz = { step: 1, year: parseKey(nowKey()).y, month: null, draft: null, mode: 'create' };
  document.getElementById('tabbar').style.display = 'flex';
  S.screen = 'today';
  render();
}
