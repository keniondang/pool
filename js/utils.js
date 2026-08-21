import { S } from './state.js';

export const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const MSHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export const CATS=[
  {id:'foods',label:'Foods',icon:'ti-bowl',c:'#C4552F',t:'#FAEDE7'},
  {id:'groceries',label:'Groceries',icon:'ti-shopping-cart',c:'#55832F',t:'#EDF3E6'},
  {id:'shopping',label:'Shopping',icon:'ti-shopping-bag',c:'#7A5AA6',t:'#F1ECF7'},
  {id:'parking',label:'Parking',icon:'ti-parking',c:'#37699B',t:'#E8F0F7'},
  {id:'fuel',label:'Fuel',icon:'ti-gas-station',c:'#B07A22',t:'#F8F0E0'},
  {id:'others',label:'Others',icon:'ti-dots',c:'#6B726C',t:'#EFF1EF'}
];
export const catColor=id=>{const c=CATS.find(x=>x.id===id);return c?c.c:'#6B726C';};
export const catTint=id=>{const c=CATS.find(x=>x.id===id);return c?c.t:'#EFF1EF';};
export const catOf=e=>e.cat||'others';
export const catLabel=id=>{const c=CATS.find(x=>x.id===id);return c?c.label:'Others';};
export const catIcon=id=>{const c=CATS.find(x=>x.id===id);return c?c.icon:'ti-dots';};

export const digits=s=>String(s).replace(/[^\d]/g,'');
export const money=s=>{const d=digits(s);return d?parseInt(d,10):0;};
export function wireMoney(){
  document.querySelectorAll('input.money').forEach(el=>{
    if(el.dataset.mw)return;el.dataset.mw='1';
    el.setAttribute('inputmode','numeric');
    el.addEventListener('input',()=>{
      const d=digits(el.value);
      el.value=d?parseInt(d,10).toLocaleString('de-DE'):'';
    });
  });
}

export const SEED={income:24500000,savingsTarget:6000000,startingSavings:0,
  lockedBills:[
    {name:'Rent and utilities',amount:5000000},
    {name:'Fuel',amount:840000},
    {name:'Formal dates',amount:1200000},
    {name:'Parking',amount:450000},
    {name:'Haircut',amount:180000},
    {name:'Data',amount:125000}
  ]};

let SIM=null;
try{ SIM=localStorage.getItem('pool:sim')||null; }catch(e){}

/** Every "what is today" question goes through this, so the test jump
 *  moves the whole app rather than one screen. */
export function now(){ return SIM ? new Date(SIM+'T12:00:00') : new Date(); }
export function simDate(){ return SIM; }
export function setSim(v){
  SIM=v;
  try{ v ? localStorage.setItem('pool:sim',v) : localStorage.removeItem('pool:sim'); }catch(e){}
}

export const fmt=n=>Math.round(n).toLocaleString('de-DE');
export const short=n=>{n=Math.round(n);return n>=1000000?(n/1000000).toFixed(n%1000000===0?0:1)+'m':n>=1000?Math.round(n/1000)+'k':String(n);};
export const key=(y,m)=>y+'-'+String(m+1).padStart(2,'0');
export const nowKey=()=>{const d=now();return key(d.getFullYear(),d.getMonth());};
export const parseKey=k=>{const[a,b]=k.split('-').map(Number);return{y:a,m:b-1};};
export const dim=(y,m)=>new Date(y,m+1,0).getDate();
export const firstDow=(y,m)=>(new Date(y,m,1).getDay()+6)%7;
export const iso=(y,m,d)=>y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');

export function billRow(b,i){
  return '<div class="billrow" data-i="'+i+'">'+
    '<input class="bn" type="text" value="'+(b.name||'')+'" placeholder="Name" />'+
    '<input class="ba money" type="text" value="'+(b.amount?fmt(b.amount):'')+'" placeholder="0" />'+
    '<button class="iconbtn rm"><i class="ti ti-x"></i></button></div>';
}

export function syncBills(){
  const rows=[].slice.call(document.querySelectorAll('.billrow'));
  const bills=rows.map(r=>({name:r.querySelector('.bn').value.trim()||'Untitled',
                            amount:money(r.querySelector('.ba').value)}));
  const el=document.getElementById('billTotal');
  if(el) el.textContent=fmt(bills.reduce((s,b)=>s+b.amount,0));
  if(S.wiz&&S.wiz.draft) S.wiz.draft.lockedBills=bills;
  return bills;
}
