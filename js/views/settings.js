import { S } from '../state.js';
import { sGet, sSet, sList } from '../storage.js';
import { fmt, money, wireMoney } from '../utils.js';
import { paintIcons } from '../icons.js';
import { calc, boot } from '../data.js';
import { render } from '../app.js';
import { renderWizard } from './wizard.js';
import { toast, confirmDialog, formModal } from '../ui.js';

/** Bills plus savings must leave something to live on. The only invalid state. */
function validate({ income, savingsTarget, bills }) {
  const inc = income ?? S.config.income;
  const sav = savingsTarget ?? S.config.savingsTarget;
  const bl = bills ?? S.config.lockedBills;
  const locked = bl.reduce((s, b) => s + b.amount, 0);
  if (inc - locked - sav <= 0) {
    return `Bills (${fmt(locked)}) and savings (${fmt(sav)}) would use up everything you earn.`;
  }
  return null;
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

async function persist() {
  await sSet('config', S.config);
}

export function setView() {
  const c = calc(S.viewMonth, S.curDay);
  return '<div class="wrap setup">' +
    '<div class="topbar"><div><div class="eyebrow">Pool</div><h1>Settings</h1></div>' +
    '<div class="meta">' + fmt(c.perDay) + ' / day<br>' +
    '<span style="color:var(--ink3);">changes apply straight away</span></div></div>' +

    '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-coin"></i>Money in</div></div>' +
    '<input id="sIncome" class="money" type="text" value="' + fmt(S.config.income) + '" />' +
    '<div class="field-err" id="incomeErr" style="display:none;"></div></div>' +

    '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-lock"></i>Locked bills</div>' +
    '<span style="font-variant-numeric:tabular-nums;">' + fmt(c.locked) + '</span></div>' +
    (S.config.lockedBills.length
      ? S.config.lockedBills.map((b, i) =>
          '<div class="kv"><span>' + b.name + '</span>' +
          '<span style="display:flex;align-items:center;gap:10px;">' +
          '<span class="v">' + fmt(b.amount) + '</span>' +
          '<button class="iconbtn billdel" data-i="' + i + '"><i class="ti ti-trash"></i></button>' +
          '</span></div>').join('')
      : '<div class="empty">No bills yet.</div>') +
    '<button class="addbill" id="addBill"><i class="ti ti-plus"></i>Add a bill</button></div>' +

    '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-shield-check"></i>Savings</div></div>' +
    '<label class="flabel" style="margin-top:0;">Target each month</label>' +
    '<input id="sSav" class="money" type="text" value="' + fmt(S.config.savingsTarget) + '" />' +
    '<div class="field-err" id="savErr" style="display:none;"></div>' +
    '<label class="flabel">Balance</label>' +
    '<input id="sBal" class="money" type="text" value="' + fmt(S.meta.savingsBalance) + '" /></div>' +

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

  bindNumber('sIncome', 'incomeErr', (v, dry, mode) => {
    if (mode === 'current') return S.config.income;
    if (v <= 0) return 'Income has to be more than zero.';
    const err = validate({ income: v });
    if (err) return err;
    if (!dry) S.config.income = v;
    return null;
  });

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
      await sSet('meta', S.meta);
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
        { id: 'name', label: 'What is it', placeholder: 'Internet' },
        { id: 'amount', label: 'Amount each month', placeholder: '0', money: true }
      ],
      submitLabel: 'Add',
      onSubmit: ({ name, amount }) => {
        if (!name) return 'Give it a name.';
        if (amount <= 0) return 'Enter an amount above zero.';
        const next = S.config.lockedBills.concat([{ name, amount }]);
        const err = validate({ bills: next });
        if (err) return err;
        S.config.lockedBills = next;
        persist().then(() => {
          render();
          toast('Added ' + name + ' · ' + fmt(amount), async () => {
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

  // ---- backup ----
  $('expBtn').onclick = async () => {
    const keys = await sList(), dump = {};
    for (const kk of keys) dump[kk] = await sGet(kk);
    const blob = new Blob(
      [JSON.stringify({ v: 1, exported: new Date().toISOString(), data: dump }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pool-backup-' + new Date().toISOString().slice(0, 10) + '.json';
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
        confirmLabel: 'OK',
        onYes: () => {}
      });
      return;
    }

    const entryCount = Object.keys(parsed.data)
      .filter(k => k.startsWith('month:'))
      .reduce((n, k) => n + ((parsed.data[k] && parsed.data[k].entries) || []).length, 0);
    const mineCount = Object.keys(S.months)
      .reduce((n, k) => n + (S.months[k].entries || []).length, 0);

    confirmDialog({
      title: 'Replace everything with this backup?',
      body: 'Your current data (<b>' + plural(mineCount, 'entry', 'entries') + '</b> and your setup) will be ' +
            'deleted and replaced with the backup (<b>' + plural(entryCount, 'entry', 'entries') + '</b>), ' +
            'exported ' + String(parsed.exported || '').slice(0, 10) + '. This cannot be undone.',
      confirmLabel: 'Replace',
      danger: true,
      onYes: async () => {
        const old = await sList();
        for (const kk of old) { try { await window.storage.delete(kk); } catch (e) {} }
        for (const kk of Object.keys(parsed.data)) await sSet(kk, parsed.data[kk]);
        S.months = {}; S.config = null; S.meta = null;
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
      body: 'This deletes <b>' + plural(entryCount, 'entry', 'entries') + '</b>, your savings balance of ' +
            '<b>' + fmt(S.meta.savingsBalance) + '</b>, and your whole setup. ' +
            'Export a backup first if you might want any of it. This cannot be undone.',
      confirmLabel: 'Erase everything',
      danger: true,
      onYes: async () => {
        const keys = await sList();
        for (const k of keys) { try { await window.storage.delete(k); } catch (e) {} }
        S.config = null; S.meta = null; S.months = {};
        S.wiz = { step: 1, year: 2026, month: null, draft: null };
        document.getElementById('tabbar').style.display = 'none';
        renderWizard();
      }
    });
  };

  wireMoney();
  paintIcons();
}
