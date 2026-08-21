import { S } from '../state.js';
import { MONTHS, DOW, CATS, fmt, short, parseKey, key, nowKey, dim, firstDow,
         catColor, catTint, catIcon, catLabel, catOf } from '../utils.js';
import { md, calc, isLocked } from '../data.js';
import { render } from '../app.js';

export function calView(){
  const k=S.viewMonth,c=calc(k,S.curDay),{y,m}=parseKey(k);
  const off=firstDow(y,m),real=new Date();
  const todayN=(nowKey()===k)?real.getDate():-1;
  let cells='';
  for(let i=0;i<off;i++)cells+='<div class="cell blank"></div>';
  for(let d=1;d<=c.days;d++){
    const info=c.byDay[d];let cls='cell';
    if(info)cls+=info.total>info.snap?' big':' under';
    if(d===todayN)cls+=' today';
    if(S.selDay===d)cls+=' sel';
    if(todayN>0&&d>todayN)cls+=' future';
    cells+='<div class="'+cls+'" data-d="'+d+'"><span class="d">'+d+'</span>'+
      (info?'<span class="a">'+short(info.total)+'</span>':'')+'</div>';
  }
  const prevK=(()=>{const p=new Date(y,m-1,1);return key(p.getFullYear(),p.getMonth());})();
  const nextK=(()=>{const p=new Date(y,m+1,1);return key(p.getFullYear(),p.getMonth());})();

  return '<div class="wrap">'+
  '<div class="topbar"><div><div class="eyebrow">Pool</div><h1>Calendar</h1></div></div>'+
  '<div class="card">'+
  '<div class="monthnav"><button class="navbtn" id="pm"'+(prevK<S.config.startMonth?' disabled':'')+'><i class="ti ti-chevron-left"></i></button>'+
  '<span class="name">'+MONTHS[m]+' '+y+'</span>'+
  '<button class="navbtn" id="nm"'+(nextK>nowKey()?' disabled':'')+'><i class="ti ti-chevron-right"></i></button></div>'+
  '<div class="dow">'+DOW.map(d=>'<div>'+d[0]+'</div>').join('')+'</div>'+
  '<div class="cal">'+cells+'</div>'+
  '<div class="legend">'+
  '<span><span class="dot" style="background:var(--sage-mid);"></span>Under the number</span>'+
  '<span><span class="dot" style="background:var(--brass-mid);"></span>Big day</span></div>'+
  (S.selDay?dayPanel(k,c,S.selDay):'')+
  '</div>'+

  '<div class="card flush"><div class="stats">'+
  '<div class="stat"><div class="l">Spent this month</div><div class="v">'+fmt(c.spent)+'</div></div>'+
  '<div class="stat"><div class="l">Left in pool</div><div class="v sage">'+fmt(c.available)+'</div></div>'+
  '<div class="stat"><div class="l">Daily average'+(c.elapsed>0?' &middot; '+c.elapsed+'d':'')+'</div><div class="v">'+fmt(c.avg)+'</div></div>'+
  '<div class="stat"><div class="l">Pool this month</div><div class="v">'+fmt(c.pool)+'</div></div>'+
  '<div class="stat"><div class="l">Under days</div><div class="v sage">'+c.under+'</div></div>'+
  '<div class="stat"><div class="l">Big days</div><div class="v brass">'+c.big+'</div></div>'+
  '</div></div>'+

  breakdownCard(k)+

  '</div>';
}

export function breakdownCard(k){
  const d=md(k);
  if(!d.entries.length) return '';
  const tot=d.entries.reduce((s,e)=>s+e.amount,0);
  const by={};
  d.entries.forEach(e=>{const c=catOf(e);by[c]=(by[c]||0)+e.amount;});
  const rows=CATS.filter(ct=>by[ct.id]).sort((a,b)=>by[b.id]-by[a.id]).map(ct=>{
    const v=by[ct.id],p=Math.round(v/tot*100);
    return '<div class="brow"><span class="bl"><i class="ti '+ct.icon+'" style="color:'+ct.c+'"></i>'+ct.label+'</span>'+
      '<span class="bbar"><span style="width:'+p+'%;background:'+ct.c+'"></span></span>'+
      '<span class="bv">'+fmt(v)+'</span></div>';
  }).join('');
  return '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-chart-donut"></i>Where it went</div>'+
    '<span style="font-variant-numeric:tabular-nums;">'+fmt(tot)+'</span></div>'+rows+'</div>';
}

export function dayPanel(k,c,d){
  const {y,m}=parseKey(k),info=c.byDay[d];
  const dt=new Date(y,m,d);
  const label=dt.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  const items=info?info.items:[];
  return '<div class="daypanel"><div class="dh"><span class="t">'+label+'</span>'+
    '<span class="s">'+(info?fmt(info.total)+' spent':'nothing logged')+'</span></div>'+
    (items.length?items.map(e=>'<div class="entry"><span class="amt">'+fmt(e.amount)+'</span>'+
      '<span class="cat" style="background:'+catTint(catOf(e))+';color:'+catColor(catOf(e))+'"><i class="ti '+catIcon(catOf(e))+'"></i>'+catLabel(catOf(e))+'</span>'+
      '<span class="note">'+(e.note||'')+'</span>'+
      (isLocked(k)?'':'<button class="iconbtn del" data-id="'+e.id+'"><i class="ti ti-trash"></i></button>')+
      '</div>').join('')
      :'<div class="empty">Nothing logged on this day.</div>')+
    '</div>';
}

export function wireCal(){
  const $=id=>document.getElementById(id);
  const k=S.viewMonth,{y,m}=parseKey(k);
  $('pm').onclick=()=>{const p=new Date(y,m-1,1);S.viewMonth=key(p.getFullYear(),p.getMonth());S.selDay=null;render();};
  $('nm').onclick=()=>{const p=new Date(y,m+1,1);
    const nk=key(p.getFullYear(),p.getMonth());
    if(nk>nowKey()) return;
    S.viewMonth=nk;S.selDay=null;render();};
  document.querySelectorAll('.cell[data-d]').forEach(c=>c.onclick=()=>{
    const d=+c.dataset.d;S.selDay=(S.selDay===d)?null:d;
    if(S.selDay)S.curDay=S.selDay;
    render();
    if(S.selDay){const el=document.querySelector('.daypanel');if(el)el.scrollIntoView({behavior:'smooth',block:'center'});}
  });
}
