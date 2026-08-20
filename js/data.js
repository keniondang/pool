import { S } from './state.js';
import { sGet, sSet, sList } from './storage.js';
import { parseKey, dim, key, nowKey } from './utils.js';
import { render } from './app.js';
import { renderWizard } from './views/wizard.js';

export function md(k){ if(!S.months[k]) S.months[k]={entries:[],draws:[]}; return S.months[k]; }
export async function saveMonth(k){ await sSet('month:'+k,S.months[k]); }

export function calc(k,forDay){
  const {y,m}=parseKey(k), days=dim(y,m), d=md(k);
  const locked=S.config.lockedBills.reduce((s,b)=>s+b.amount,0);
  const pool=S.config.income-locked-S.config.savingsTarget;
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
  return{y,m,days,ref,locked,pool,spent,drawn,available,perDay,daysLeft,daysGone,elapsed,avg,byDay,big,under,isNow,today};
}

export async function boot(){
  S.config=await sGet('config');
  if(!S.config){renderWizard();return;}
  S.meta=await sGet('meta')||{savingsBalance:S.config.startingSavings||0,closed:[]};
  const keys=await sList();
  for(const k of keys){ if(k.indexOf('month:')===0){ S.months[k.slice(6)]=await sGet(k)||{entries:[],draws:[]}; } }
  const cur=nowKey();
  S.viewMonth = (cur>=S.config.startMonth)?cur:S.config.startMonth;
  await sweepClosed();
  document.getElementById('tabbar').style.display='flex';
  render();
}

export async function sweepClosed(){
  const cur=nowKey();
  let changed=false;
  for(const k of Object.keys(S.months)){
    if(k<cur && S.meta.closed.indexOf(k)<0){
      const c=calc(k);
      S.meta.savingsBalance+=S.config.savingsTarget-c.drawn+c.available;
      S.meta.closed.push(k);changed=true;
    }
  }
  if(changed) await sSet('meta',S.meta);
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
