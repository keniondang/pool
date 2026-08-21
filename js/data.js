import { S } from './state.js';
import * as DB from './db.js';
import { parseKey, dim, key, nowKey } from './utils.js';
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
export function plannedFor(k){
  return (S.config.planned||[]).filter(p=>p.due && p.due.slice(0,7)===k);
}

export function calc(k,forDay){
  const {y,m}=parseKey(k), days=dim(y,m), d=md(k);
  const locked=S.config.lockedBills.reduce((s,b)=>s+b.amount,0);
  const planned=plannedFor(k).reduce((s,p)=>s+p.amount,0);
  const pool=S.config.income-locked-S.config.savingsTarget-planned;
  const spent=d.entries.reduce((s,e)=>s+e.amount,0);
  const drawn=d.draws.reduce((s,x)=>s+x.amount,0);
  const real=new Date();
  const isNow=nowKey()===k;
  const today=isNow?real.getDate():null;
  let ref=forDay;
  if(!ref) ref=isNow?real.getDate():1;
  if(ref<1)ref=1; if(ref>days)ref=days;
  const daysLeft=days-ref+1;
  const daysGone=ref-1;
  const available=pool+drawn-spent;
  const perDay=Math.max(0,available/daysLeft);
  const byDay={};
  d.entries.forEach(e=>{const dd=+e.date.slice(8,10);
    if(!byDay[dd])byDay[dd]={total:0,snap:e.snap||0,items:[]};
    byDay[dd].total+=e.amount;byDay[dd].items.push(e);});
  const loggedDays=Object.keys(byDay).map(Number);
  const maxLogged=loggedDays.length?Math.max.apply(null,loggedDays):0;
  const elapsed=Math.max(maxLogged,ref-1);
  const avg=elapsed>0?spent/elapsed:0;
  let big=0,under=0;
  Object.keys(byDay).forEach(dd=>{byDay[dd].total>byDay[dd].snap?big++:under++;});
  return{y,m,days,ref,locked,planned,pool,spent,drawn,available,perDay,daysLeft,daysGone,elapsed,avg,byDay,big,under,isNow,today};
}

export async function boot(){
  if(!DB.poolToken()){ renderNoToken(); return; }
  let data;
  try{
    data = await DB.loadAll();
  }catch(e){
    renderError(e.message);
    return;
  }
  if(!data){ renderWizard(); return; }

  S.config = data.config;
  S.meta   = data.meta;
  S.months = data.months;

  const cur = nowKey();
  S.viewMonth = (cur >= S.config.startMonth) ? cur : S.config.startMonth;
  await sweepClosed();
  document.getElementById('tabbar').style.display = 'flex';
  render();
}

function renderNoToken(){
  document.getElementById('tabbar').style.display = 'none';
  document.getElementById('app').innerHTML =
    '<div class="wrap"><div class="eyebrow">Pool</div>' +
    '<h1 style="margin-bottom:12px;">Open your link</h1>' +
    '<div class="card"><div style="font-size:14px;color:var(--ink2);line-height:1.65;">' +
    'This device has not been paired yet. Open the link that ends in ' +
    '<code>?k=…</code> once and it will remember from then on.' +
    '</div></div></div>';
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
      const swept=S.config.savingsTarget-c.drawn+c.available;
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
    S.curDay=(nowKey()===S.viewMonth)?new Date().getDate():1;
  }
}

export function shiftDay(delta){
  const {y,m}=parseKey(S.viewMonth);
  const days=dim(y,m);
  let d=S.curDay+delta;
  if(d<1){
    const p=new Date(y,m-1,1);
    const pk=key(p.getFullYear(),p.getMonth());
    if(pk<S.config.startMonth) return;
    S.viewMonth=pk;S.curDay=dim(p.getFullYear(),p.getMonth());
  } else if(d>days){
    const n=new Date(y,m+1,1);
    S.viewMonth=key(n.getFullYear(),n.getMonth());S.curDay=1;
  } else S.curDay=d;
  render();
}
