import { S } from './state.js';
import * as DB from './db.js';
import { parseKey, dim, key, nowKey, now, iso, simDate, setSim } from './utils.js';
import { render } from './app.js';
import { renderWizard } from './views/wizard.js';

export function md(k){ if(!S.months[k]) S.months[k]={entries:[],draws:[]}; return S.months[k]; }

/** Adds one row rather than rewriting the month, so simultaneous
 *  logging from two phones cannot clobber. */
export async function pushEntry(k, entry){
  md(k).entries.push(entry);
  const { rowId } = await DB.addEntry(S.config.poolId, entry);
  entry.rowId = rowId;
}

export async function dropEntry(k, entry){
  const list=md(k).entries;
  const i=list.indexOf(entry);
  if(i>=0) list.splice(i,1);
  await DB.removeEntry(S.config.poolId, entry);
  return i;
}

export async function pushDraw(k, draw){
  md(k).draws.push(draw);
  S.meta.savingsBalance -= draw.amount;
  const { rowId } = await DB.addDraw(S.config.poolId, draw);
  draw.rowId = rowId;
  await saveMeta();
}

export async function saveConfig(){ await DB.saveConfig(S.config); }
export async function saveMeta(){ await DB.saveMeta(S.config.poolId, S.meta); }

/** One-off costs you know are coming. Set aside like a bill, so the
 *  money is already there when the day arrives instead of cratering
 *  the daily number on the spot. */
/** Per-month state. Defaults mean an untouched month behaves exactly as
 *  before: all income in, no bills ticked off, savings from config. */
/** Whole months before this one are read-only. You can still fix any day
 *  inside the current month, which is where "I forgot to log Tuesday"
 *  actually happens. */
export function isLocked(k){ return k < nowKey(); }

/** The real calendar day, which is what "today" must always mean no
 *  matter which day you are looking at. */
export function realDay(k){
  const {y,m}=parseKey(k);
  return nowKey()===k ? now().getDate() : dim(y,m);
}

export function monthState(k){
  if(!S.monthStates[k]){
    S.monthStates[k] = {
      balanceOverride: null,
      savingsOverride: null,
      incomeReceived: {},
      billsPaid: {},
      savingsMoved: null,
      startDay: 1
    };
  }
  return S.monthStates[k];
}

export async function saveMonthState(k){
  await DB.saveMonthState(S.config.poolId, k, monthState(k));
}

/** Received unless explicitly marked otherwise, so a month where the
 *  money has landed needs no taps at all. */
export function incomeIn(k){
  const st = monthState(k);
  return (S.config.incomeSources || [])
    .filter(src => st.incomeReceived[src.id] !== false);
}

/** Next month's salary, and whether any of it has landed yet. Salary
 *  arrives at the end of the month, so this is the normal case rather
 *  than an exception. */
export function nextMonthKey(k){
  const {y,m} = parseKey(k);
  const n = new Date(y, m + 1, 1);
  return key(n.getFullYear(), n.getMonth());
}

export function nextIncomeIn(k){
  const nk = nextMonthKey(k);
  if (nk <= nowKey()) return [];
  const nst = monthState(nk);
  return (S.config.incomeSources || [])
    .filter(src => nst.incomeReceived[src.id] === true);
}

export function incomePending(k){
  const st = monthState(k);
  // A stated starting balance already has this month's income folded in,
  // so the sources marked unreceived here are not actually waiting on
  // anything — ticking one "in" would count it a second time.
  if (st.balanceOverride !== null) return [];
  return (S.config.incomeSources || [])
    .filter(src => st.incomeReceived[src.id] === false);
}

export function billCost(b){ return b.amount * (b.times || 1); }

export function billsUnpaid(k){
  const st = monthState(k);
  return S.config.lockedBills.filter(b => !st.billsPaid[b.id]);
}

export function billsPaidOn(k, isoDate){
  const st = monthState(k);
  const out = [];
  S.config.lockedBills.forEach(b => {
    const rec = st.billsPaid[b.id];
    if (rec && rec.on === isoDate) out.push({ bill: b, amount: rec.amount });
  });
  const sm = st.savingsMoved;
  if (sm && sm.on === isoDate) out.push({ bill: { name: 'Savings' }, amount: sm.amount });
  return out;
}

export function savingsFor(k){
  const st = monthState(k);
  return st.savingsOverride === null ? S.config.savingsTarget : st.savingsOverride;
}

export function savingsMovedYet(k){ return !!monthState(k).savingsMoved; }

/** Savings is not a separate chore: once every income source for the month
 *  is actually in, the target amount is already spoken for, so it moves
 *  on its own rather than waiting on a second tap. Run this after anything
 *  that can change a month's incomeReceived. */
export async function maybeAutoMoveSavings(k){
  if (savingsMovedYet(k) || incomePending(k).length) return;
  const amount = savingsFor(k);
  if (amount <= 0) return;
  const st = monthState(k);
  const { y, m } = parseKey(k);
  const day = nowKey() === k ? now().getDate() : dim(y, m);
  st.savingsMoved = { amount, on: iso(y, m, day) };
  S.meta.savingsBalance += amount;
  await saveMonthState(k);
  await saveMeta();
}

/** Opening month through next month. Next month is included because
 *  salary lands at the end of the month, so its money is often already
 *  in the account. */
function monthsToNow(){
  const out = [];
  const start = S.config.openingMonth || S.config.startMonth;
  let { y, m } = parseKey(start);
  const last = nextMonthKey(nowKey());
  for (let i = 0; i < 240; i++) {
    const kk = key(y, m);
    out.push(kk);
    if (kk >= last) break;
    const d = new Date(y, m + 1, 1);
    y = d.getFullYear(); m = d.getMonth();
  }
  return out;
}

/**
 * Whether a source's money is in the account.
 * A month that has arrived counts unless you say it has not. A month
 * still to come counts only when you say it has landed.
 */
export function incomeCounted(k){
  const st = monthState(k);
  const future = k > nowKey();
  return (S.config.incomeSources || []).filter(src => future
    ? st.incomeReceived[src.id] === true
    : st.incomeReceived[src.id] !== false);
}

/**
 * One running balance: what is actually in the account.
 * Derived rather than stored, so it cannot drift out of step with the
 * rows it is made of.
 */
export function balanceNow(){
  let bal = S.config.openingBalance || 0;

  monthsToNow().forEach(kk => {
    const st = monthState(kk);

    incomeCounted(kk).forEach(src => { bal += src.amount; });

    // `on: null` means it was already paid before you started, so it is
    // baked into the opening balance and must not come off twice.
    Object.keys(st.billsPaid).forEach(id => {
      const rec = st.billsPaid[id];
      if (rec && rec.on) bal -= rec.amount;
    });

    const sm = st.savingsMoved;
    if (sm && sm.on) bal -= sm.amount;
  });

  Object.keys(S.months).forEach(kk => {
    (S.months[kk].entries || []).forEach(e => { bal -= e.amount; });
    // A draw is savings coming back into the account, reversing the
    // subtraction a savingsMoved tick made when it left.
    (S.months[kk].draws || []).forEach(x => { bal += x.amount; });
  });

  return bal;
}

/**
 * What cannot be spent, split so the figure can be explained rather than
 * trusted. Once any of next month's salary is in the balance, next
 * month's obligations join the list: the money is spendable, what it owes
 * is not.
 *
 * Bills are a debt and always come off. Savings is a target, so it only
 * comes off once the income is actually there to cover it. Otherwise a
 * part-arrived salary would read as zero a day while you still had cash
 * in hand.
 */
export function heldBack(k){
  const parts = {
    bills: billsUnpaid(k).reduce((s, b) => s + billCost(b), 0),
    savings: savingsMovedYet(k) ? 0 : savingsFor(k),
    planned: plannedFor(k).reduce((s, p) => s + p.amount, 0),
    nextBills: 0,
    nextSavings: 0,
    stretched: false,
    early: 0
  };

  const early = nextIncomeIn(k);
  if (early.length) {
    const nk = nextMonthKey(k);
    parts.stretched = true;
    parts.early = early.reduce((s, src) => s + src.amount, 0);
    parts.nextBills = billsUnpaid(nk).reduce((s, b) => s + billCost(b), 0);
    parts.nextSavings = savingsMovedYet(nk) ? 0 : savingsFor(nk);

    // Savings is a target, not a debt, so it is only held back once all
    // of next month's income is in. Holding part of it while a salary is
    // still outstanding drops the daily number off a cliff for no good
    // reason.
    const all = (S.config.incomeSources || []).length;
    if (early.length < all) parts.nextSavings = 0;
  }

  parts.total = parts.bills + parts.savings + parts.planned +
                parts.nextBills + parts.nextSavings;
  return parts;
}

export function plannedFor(k){
  return (S.config.planned||[]).filter(p=>p.due && p.due.slice(0,7)===k);
}

export function calc(k,forDay){
  const {y,m}=parseKey(k), days=dim(y,m), d=md(k);
  const st=monthState(k);
  const real=now();
  const isNow=nowKey()===k;
  const today=isNow?real.getDate():null;

  let ref=forDay;
  if(!ref) ref=isNow?real.getDate():days;
  if(ref<1)ref=1; if(ref>days)ref=days;

  const cycleStart=Math.min(Math.max(1, st.startDay||1), days);
  const cycleDays=days-cycleStart+1;
  const daysLeft=days-ref+1;
  const daysGone=Math.max(0, ref-cycleStart);

  const locked=S.config.lockedBills.reduce((s,b)=>s+billCost(b),0);
  const unpaid=billsUnpaid(k).reduce((s,b)=>s+billCost(b),0);
  const planned=plannedFor(k).reduce((s,p)=>s+p.amount,0);
  const savings=savingsFor(k);
  const received=incomeIn(k).reduce((s,x)=>s+x.amount,0);

  const balance=balanceNow();
  const heldParts=heldBack(k);
  const held=heldParts.total;

  // Once next month's money is in hand, it has to last until the salary
  // after that, not until the 31st.
  let horizon=daysLeft;
  if(heldParts.stretched && isNow){
    const nk=nextMonthKey(k);
    const {y:ny,m:nm}=parseKey(nk);
    horizon=daysLeft+dim(ny,nm);
  }

  const drawn=d.draws.reduce((s,x)=>s+x.amount,0);

  // Spendable now. Bills stay held back even while the cash is sitting
  // in the account, so ticking one paid moves the balance and the
  // hold-back by the same amount and the daily number does not budge.
  // A draw already re-entered `balance` in balanceNow(), so it does not
  // get added again here.
  const available=balance-held;

  const spent=d.entries.reduce((s,e)=>s+e.amount,0);
  const perDay=Math.max(0, available/Math.max(1,horizon));

  // What this month had to spend in total, used for the month bar.
  const pool=Math.max(0, available+spent);

  const byDay={};
  d.entries.forEach(e=>{const dd=+e.date.slice(8,10);
    if(!byDay[dd])byDay[dd]={total:0,snap:e.snap||0,items:[]};
    byDay[dd].total+=e.amount;byDay[dd].items.push(e);});
  const loggedDays=Object.keys(byDay).map(Number);
  const maxLogged=loggedDays.length?Math.max.apply(null,loggedDays):0;
  const elapsed=Math.max(maxLogged-cycleStart+1, ref-cycleStart);
  const avg=elapsed>0?spent/elapsed:0;
  let big=0,under=0;
  Object.keys(byDay).forEach(dd=>{byDay[dd].total>byDay[dd].snap?big++:under++;});

  return{y,m,days,ref,cycleStart,cycleDays,balance,held,heldParts,horizon,locked,unpaid,received,
    savings,planned,pool,spent,drawn,available,perDay,daysLeft,daysGone,elapsed,
    avg,byDay,big,under,isNow,today,early:heldParts.early};
}

export async function boot(){
  let data;
  try{
    data = await DB.loadAll();
  }catch(e){
    renderError(e.message);
    return;
  }
  if(!data){
    // No pool means a genuinely fresh start, so a leftover test jump (from
    // before the erase-everything fix, or a stale cache) must not carry
    // into setup — there is no Settings tab here to clear it from.
    if(simDate()) setSim(null);
    renderWizard();
    return;
  }

  S.config      = data.config;
  S.meta        = data.meta;
  S.months      = data.months;
  S.monthStates = data.monthStates || {};

  // Older pools were created before "today" was pinned to a saved zone —
  // detect once here so every device after this agrees, instead of each
  // one quietly using its own clock forever.
  if (!S.config.timezone) {
    S.config.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await saveConfig();
  }

  const cur = nowKey();
  S.viewMonth = (cur >= S.config.startMonth) ? cur : S.config.startMonth;
  if (cur >= S.config.startMonth) await maybeAutoMoveSavings(cur);
  await sweepClosed();
  document.getElementById('tabbar').style.display = 'flex';
  render();
}

function renderError(msg){
  document.getElementById('tabbar').style.display = 'none';
  document.getElementById('app').innerHTML =
    '<div class="wrap"><div class="eyebrow">Pool</div>' +
    '<h1 style="margin-bottom:12px;">Cannot reach the database</h1>' +
    '<div class="card"><div style="font-size:14px;color:var(--ink2);line-height:1.65;">' +
    'Check your connection, then reload. If this keeps happening the token in ' +
    'your link may have changed.<br><br>' +
    '<code style="font-size:12px;color:var(--ink3);">' + msg + '</code>' +
    '</div></div></div>';
}

export async function sweepClosed(){
  // Nothing to sweep. The balance carries by itself, and savings only
  // moves when you tick that it moved. Closing a month is bookkeeping.
  const cur=nowKey();
  let changed=false;
  for(const k of Object.keys(S.months)){
    if(k<cur && S.meta.closed.indexOf(k)<0){
      S.meta.closed.push(k);
      await DB.markCycleClosed(S.config.poolId,k,0);
      changed=true;
    }
  }
  if(changed) await DB.saveMeta(S.config.poolId,S.meta);
}

export function ensureDay(){
  const {y,m}=parseKey(S.viewMonth);
  const days=dim(y,m);
  if(S.curDay===null||S.curDay<1||S.curDay>days){
    S.curDay=(nowKey()===S.viewMonth)?now().getDate():1;
  }
}

export function shiftDay(delta){
  const {y,m}=parseKey(S.viewMonth);
  const days=dim(y,m);
  let d=S.curDay+delta;
  if(d<1){
    const p=new Date(y,m-1,1);
    const pk=key(p.getFullYear(),p.getMonth());
    S.viewMonth=pk;S.curDay=dim(p.getFullYear(),p.getMonth());
  } else if(d>days){
    const n=new Date(y,m+1,1);
    const nk=key(n.getFullYear(),n.getMonth());
    if(nk>nowKey()) return;          // no wandering into next month
    S.viewMonth=nk;S.curDay=1;
  } else {
    S.curDay=d;
  }
  render();
}
