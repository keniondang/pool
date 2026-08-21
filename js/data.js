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
      savingsDone: false,
      incomeEarly: {},
      startDay: 1
    };
  }
  return S.monthStates[k];
}

export async function saveMonthState(k){
  await DB.saveMonthState(S.config.poolId, k, monthState(k));
}

/** Received unless explicitly marked otherwise, so the normal month
 *  where everything has landed needs no taps at all. */
export function incomeIn(k){
  const st = monthState(k);
  // A source marked as having arrived early went into the previous
  // month's pool, so it must not be counted again here.
  return (S.config.incomeSources || [])
    .filter(src => st.incomeReceived[src.id] !== false && !st.incomeEarly[src.id]);
}

/** Next month's money that landed during this one. It joins this pool. */
export function earlyInflow(k){
  const {y,m}=parseKey(k);
  const n=new Date(y,m+1,1);
  const nk=key(n.getFullYear(),n.getMonth());
  const nst=monthState(nk);
  return (S.config.incomeSources || [])
    .filter(src => nst.incomeEarly[src.id])
    .reduce((s,src)=>s+src.amount,0);
}

export function earlyList(k){
  const {y,m}=parseKey(k);
  const n=new Date(y,m+1,1);
  const nk=key(n.getFullYear(),n.getMonth());
  const nst=monthState(nk);
  return (S.config.incomeSources || [])
    .filter(src => nst.incomeEarly[src.id])
    .map(src => ({ src, on: nst.incomeEarly[src.id], nk }));
}

export function incomePending(k){
  const st = monthState(k);
  return (S.config.incomeSources || [])
    .filter(src => st.incomeReceived[src.id] === false);
}

export function billsUnpaid(k){
  const st = monthState(k);
  return S.config.lockedBills.filter(b => !st.billsPaid[b.id]);
}

export function savingsFor(k){
  const st = monthState(k);
  return st.savingsOverride === null ? S.config.savingsTarget : st.savingsOverride;
}

export function plannedFor(k){
  return (S.config.planned||[]).filter(p=>p.due && p.due.slice(0,7)===k);
}

export function calc(k,forDay){
  const {y,m}=parseKey(k), days=dim(y,m), d=md(k);
  const st=monthState(k);
  const locked=S.config.lockedBills.reduce((s,b)=>s+b.amount*(b.times||1),0);
  const unpaid=billsUnpaid(k).reduce((s,b)=>s+b.amount*(b.times||1),0);
  const planned=plannedFor(k).reduce((s,p)=>s+p.amount,0);
  const savings=savingsFor(k);
  const received=incomeIn(k).reduce((s,x)=>s+x.amount,0);
  const early=earlyInflow(k);

  // A stated balance is already post-bills, so only the bills you have
  // NOT paid yet come off it. Without the paid flags this would
  // double-count them.
  const pool = (st.balanceOverride !== null
    ? st.balanceOverride - unpaid - savings - planned
    : received - locked - savings - planned) + early;
  const spent=d.entries.reduce((s,e)=>s+e.amount,0);
  const drawn=d.draws.reduce((s,x)=>s+x.amount,0);
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
  const available=pool+drawn-spent;
  const perDay=Math.max(0,available/daysLeft);
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
  return{y,m,days,ref,cycleStart,cycleDays,early,locked,unpaid,received,savings,planned,pool,spent,drawn,available,perDay,daysLeft,daysGone,elapsed,avg,byDay,big,under,isNow,today};
}

export async function boot(){
  // No token means a brand new visitor, not a broken one. Mint one and
  // let them set up; the shareable link appears in Settings afterwards.
  DB.ensureToken();
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
  const cur=nowKey();
  let changed=false;
  for(const k of Object.keys(S.months)){
    if(k<cur && S.meta.closed.indexOf(k)<0){
      const c=calc(k);
      const st=monthState(k);
      // Only count the target if it was actually set aside. Otherwise
      // just the leftover pool rolls in.
      const banked=st.savingsDone ? (savingsFor(k)-c.drawn) : 0;
      const swept=banked+c.available;
      S.meta.savingsBalance+=swept;
      S.meta.closed.push(k);
      await DB.markCycleClosed(S.config.poolId,k,swept);
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
