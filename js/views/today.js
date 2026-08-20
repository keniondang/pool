import { S } from '../state.js';
import { MONTHS, MSHORT, CATS, fmt, short, money, iso, parseKey, key, nowKey,
         catColor, catTint, catIcon, catLabel, catOf } from '../utils.js';
import { md, calc, saveMonth, ensureDay, shiftDay } from '../data.js';
import { render } from '../app.js';

export function todayView(){
  ensureDay();
  const k=S.viewMonth,c=calc(k,S.curDay),{y,m}=parseKey(k);
  const real=new Date();
  const dnum=S.curDay;
  const tIso=iso(y,m,dnum);
  const d=md(k);
  const dayEntries=d.entries.filter(e=>e.date===tIso);
  const spentToday=dayEntries.reduce((s,e)=>s+e.amount,0);
  const pct=c.perDay>0?Math.min(100,spentToday/c.perDay*100):0;
  const over=spentToday>c.perDay;
  const dObj=new Date(y,m,dnum);
  const full=dObj.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const isToday=(nowKey()===k&&real.getDate()===dnum);
  const prevBlocked=(dnum===1&&(()=>{const p=new Date(y,m-1,1);return key(p.getFullYear(),p.getMonth())<S.config.startMonth;})());

  let banner='';
  if(c.drawn>0) banner='<div class="banner warn"><i class="ti ti-arrow-down-right"></i>You pulled '+fmt(c.drawn)+' from savings this month. Bills and this month\'s target are still covered.</div>';
  else if(isToday&&real.getHours()>=21&&spentToday===0) banner='<div class="banner warn"><i class="ti ti-moon"></i>Nothing logged today. Add what you spent before you sleep.</div>';

  return '<div class="wrap">'+
  '<div class="topbar"><div><div class="eyebrow">Pool</div><h1>'+(isToday?'Today':MONTHS[m]+' '+y)+'</h1></div>'+
  '<div class="meta">'+full+'<br><span style="color:var(--ink3);">'+c.daysLeft+' days left in '+MSHORT[m]+'</span></div></div>'+

  '<div class="daynav">'+
    '<button class="navbtn" id="dPrev"'+(prevBlocked?' disabled':'')+'><i class="ti ti-chevron-left"></i></button>'+
    '<div class="daynav-mid"><span class="dn">'+dObj.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+'</span>'+
    '<span class="ds">'+(spentToday>0?fmt(spentToday)+' logged':'nothing logged')+'</span></div>'+
    '<button class="navbtn" id="dNext"><i class="ti ti-chevron-right"></i></button>'+
  '</div>'+

  '<div class="hero"><div class="hero-label">Safe to spend today</div>'+
  '<div class="hero-num">'+fmt(c.perDay)+'<span class="cur">VND</span></div>'+
  '<div class="hero-sub">'+fmt(c.available)+' left in the pool</div>'+
  '<div class="meter'+(over?' over':'')+'"><span style="width:'+pct+'%"></span></div>'+
  '<div class="meter-legend"><span>'+fmt(spentToday)+' spent</span><span>'+(over?'over by '+fmt(spentToday-c.perDay):fmt(c.perDay-spentToday)+' to go')+'</span></div></div>'+

  banner+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-pencil-plus"></i>Log a spend</div>'+
  '<span style="font-size:12.5px;color:var(--ink3);">'+dObj.toLocaleDateString('en-GB',{day:'numeric',month:'short'})+'</span></div>'+

  '<div class="steplabel">What for</div>'+
  '<div class="catrow">'+CATS.map(ct=>'<button class="catchip'+(S.selCat===ct.id?' on':'')+'" data-c="'+ct.id+
    '" style="--cc:'+ct.c+';--ct:'+ct.t+'"><i class="ti '+ct.icon+'"></i>'+ct.label+'</button>').join('')+'</div>'+

  '<div class="steplabel">How much</div>'+
  '<div class="amtbox" id="amtBox" style="border-color:'+catColor(S.selCat)+'"><input id="amt" class="money" type="text" placeholder="0" />'+
  '<span class="cur">VND</span><button class="clr" id="clrAmt"><i class="ti ti-x"></i></button></div>'+

  '<div class="chips">'+[1000,2000,5000,10000,20000,50000,100000,200000].map(v=>'<button class="chip" data-v="'+v+'">+'+short(v)+'</button>').join('')+'</div>'+

  '<input id="note" type="text" placeholder="Note, optional" style="margin-top:12px;" />'+
  '<button class="btn solid" id="logBtn" style="width:100%;margin-top:10px;background:'+catColor(S.selCat)+';">Log '+catLabel(S.selCat).toLowerCase()+'</button>'+
  '</div>'+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-list"></i>Logged this day</div>'+
  '<span style="font-variant-numeric:tabular-nums;">'+fmt(spentToday)+'</span></div>'+
  (dayEntries.length?dayEntries.map(e=>'<div class="entry"><span class="amt">'+fmt(e.amount)+'</span>'+
    '<span class="cat" style="background:'+catTint(catOf(e))+';color:'+catColor(catOf(e))+'"><i class="ti '+catIcon(catOf(e))+'"></i>'+catLabel(catOf(e))+'</span>'+
    '<span class="note">'+(e.note||'')+'</span>'+
    '<button class="iconbtn del" data-id="'+e.id+'"><i class="ti ti-trash"></i></button></div>').join('')
    :'<div class="empty">Nothing yet. Pick a category, tap an amount, hit Log.</div>')+
  '</div>'+

  '<div class="card flush"><div class="stats">'+
  '<div class="stat"><div class="l">Spent this month</div><div class="v">'+fmt(c.spent)+'</div></div>'+
  '<div class="stat"><div class="l">Daily average'+(c.elapsed>0?' &middot; '+c.elapsed+'d':'')+'</div><div class="v">'+fmt(c.avg)+'</div></div>'+
  '<div class="stat"><div class="l">Under days</div><div class="v sage">'+c.under+'</div></div>'+
  '<div class="stat"><div class="l">Big days</div><div class="v brass">'+c.big+'</div></div>'+
  '</div></div>'+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-shield-check"></i>Savings</div></div>'+
  '<div class="kv" style="padding-top:0;"><span>Balance</span><span class="v serif" style="font-size:17px;">'+fmt(S.meta.savingsBalance)+'</span></div>'+
  '<div class="kv"><span>Adding this month</span><span class="v">'+fmt(S.config.savingsTarget-c.drawn)+'</span></div>'+
  '<div style="margin-top:10px;"><button class="btn quiet" id="drawT">Use savings this month</button></div>'+
  '<div class="confirm" id="drawBox"><div class="logrow" style="margin-top:8px;">'+
  '<input id="drawAmt" class="money" type="text" placeholder="Amount" /><button class="btn solid" id="drawGo">Add</button></div>'+
  '<div class="fhint">This moves money into your pool and lowers what you save this month. It is your call, not the app\'s.</div></div>'+
  '</div></div>';
}

export function wireToday(){
  const $=id=>document.getElementById(id);
  const k=S.viewMonth,c=calc(k,S.curDay),{y,m}=parseKey(k);
  const dnum=S.curDay;
  $('dPrev').onclick=()=>shiftDay(-1);
  $('dNext').onclick=()=>shiftDay(1);
  document.querySelectorAll('.catchip').forEach(ch=>ch.onclick=()=>{
    S.selCat=ch.dataset.c;
    document.querySelectorAll('.catchip').forEach(x=>x.classList.toggle('on',x.dataset.c===S.selCat));
    const lb=$('logBtn');
    if(lb){lb.style.background=catColor(S.selCat);lb.textContent='Log '+catLabel(S.selCat).toLowerCase();}
    const bx=$('amtBox'); if(bx) bx.style.borderColor=catColor(S.selCat);
  });
  if($('clrAmt'))$('clrAmt').onclick=()=>{$('amt').value='';$('amt').focus();};
  document.querySelectorAll('.chip').forEach(ch=>ch.onclick=()=>{
    const cur=money($('amt').value);
    $('amt').value=(cur+parseInt(ch.dataset.v,10)).toLocaleString('de-DE');
  });
  $('logBtn').onclick=async()=>{
    const raw=money($('amt').value);if(raw<=0)return;
    md(k).entries.push({id:'e'+Date.now(),amount:raw,note:$('note').value.trim(),cat:S.selCat,
      date:iso(y,m,dnum),snap:Math.round(c.perDay)});
    await saveMonth(k);render();
  };
  $('drawT').onclick=()=>$('drawBox').classList.toggle('open');
  $('drawGo').onclick=async()=>{
    const v=money($('drawAmt').value);if(v<=0)return;
    md(k).draws.push({id:'d'+Date.now(),amount:v,date:iso(y,m,dnum)});
    await saveMonth(k);render();
  };
}
