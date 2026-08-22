import { S } from './state.js';
import * as DB from './db.js';
import { parseKey, dim, key, nowKey, now } from './utils.js';
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
  const { rowId } = await DB.addDraw(S.config.poolId, draw);
  draw.rowId = rowId;
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

export function incomePending(k){
  const st = monthState(k);
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

/** Every month from the opening one up to and including the current one. */
function monthsToNow(){
  const out = [];
  const start = S.config.openingMonth || S.config.startMonth;
  let { y, m } = parseKey(start);
  const cur = nowKey();
  for (let i = 0; i < 240; i++) {
    const kk = key(y, m);
    out.push(kk);
    if (kk >= cur) break;
    const d = new Date(y, m + 1, 1);
    y = d.getFullYear(); m = d.getMonth();
  }
  return out;
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

    // Income only counts once its month has arrived. Next month's salary
    // landing early sits in the bank uncounted, which errs safe.
    incomeIn(kk).forEach(src => { bal += src.amount; });

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
  });

  return bal;
}

/** What cannot be spent yet this month, even though it is in the account. */
export function heldBack(k){
  const st = monthState(k);
  const bills = billsUnpaid(k).reduce((s, b) => s + billCost(b), 0);
  const sav = savingsMovedYet(k) ? 0 : savingsFor(k);
  const plan = plannedFor(k).reduce((s, p) => s + p.amount, 0);
  return bills + sav + plan;
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
  const held=heldBack(k);

  // Spendable now. Bills stay held back even while the cash is sitting
  // in the account, so ticking one paid moves the balance and the
  // hold-back by the same amount and the daily number does not budge.
  const available=balance-held;

  const spent=d.entries.reduce((s,e)=>s+e.amount,0);
  const drawn=d.draws.reduce((s,x)=>s+x.amount,0);
  const perDay=Math.max(0, available/Math.max(1,daysLeft));

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

  return{y,m,days,ref,cycleStart,cycleDays,balance,held,locked,unpaid,received,
    savings,planned,pool,spent,drawn,available,perDay,daysLeft,daysGone,elapsed,
    avg,byDay,big,under,isNow,today};
}

export async function boot(){
  let data;
  try{
    data = await DB.loadAll();
  }catch(e){
    renderError(e.message);
    return;
  }
  if(!data){ renderWizard(); return; }

  S.config      = data.config;
  S.meta        = data.meta;
  S.months      = data.months;
  S.monthStates = data.monthStates || {};

  const cur = nowKey();
  S.viewMonth = (cur >= S.config.startMonth) ? cur : S.config.startMonth;
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
    if(S.viewMonth===nowKey() && d>now().getDate()) return;  // nor past today
    S.curDay=d;
  }
  render();
}
