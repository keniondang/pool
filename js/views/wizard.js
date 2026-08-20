import { S } from '../state.js';
import { sSet } from '../storage.js';
import { MSHORT, SEED, fmt, money, key, nowKey, parseKey, dim, billRow, syncBills, wireMoney } from '../utils.js';
import { paintIcons } from '../icons.js';
import { render } from '../app.js';

export function renderWizard(){
  document.getElementById('tabbar').style.display='none';
  if(!S.wiz.draft) S.wiz.draft=JSON.parse(JSON.stringify(SEED));
  const a=document.getElementById('app');
  a.innerHTML='<div class="wrap">'+
    '<div class="eyebrow">Set up once</div>'+
    '<h1 style="margin-bottom:14px;">Build your pool</h1>'+
    '<div class="steps"><div class="'+(S.wiz.step>=1?'on':'')+'"></div><div class="'+(S.wiz.step>=2?'on':'')+'"></div><div class="'+(S.wiz.step>=3?'on':'')+'"></div></div>'+
    (S.wiz.step===1?step1():S.wiz.step===2?step2():step3())+
  '</div>';
  wireWizard();
  wireMoney();
  paintIcons();
}

export function step1(){
  const y=S.wiz.year;
  return '<p class="setup-lead">Pick the month you want to start tracking, then tell me what lands in your account each month.</p>'+
  '<div class="card">'+
    '<div class="yearnav"><button class="navbtn" id="yPrev"><i class="ti ti-chevron-left"></i></button>'+
    '<span class="y">'+y+'</span>'+
    '<button class="navbtn" id="yNext"><i class="ti ti-chevron-right"></i></button></div>'+
    '<div class="mgrid">'+MSHORT.map((n,i)=>
      '<button class="mtile'+(S.wiz.month===key(y,i)?' on':'')+'" data-k="'+key(y,i)+'">'+n+'</button>').join('')+'</div>'+
  '</div>'+
  '<label class="flabel">Money in each month, both of you together</label>'+
  '<input id="wIncome" class="money" type="text" value="'+fmt(S.wiz.draft.income)+'" />'+
  '<div class="fhint">VND. Salary, side income, anything you can actually spend.</div>'+
  '<div class="err" id="e1">Pick a starting month and enter an amount above zero.</div>'+
  '<div class="navbtns"><button class="btn solid" id="next1" style="flex:1;">Continue</button></div>';
}

export function step2(){
  const t=S.wiz.draft.lockedBills.reduce((s,b)=>s+(b.amount||0),0);
  return '<p class="setup-lead">These come off the top and never enter your daily number. That is what makes the end of the month safe.</p>'+
  '<div class="card">'+
    '<div id="bills">'+S.wiz.draft.lockedBills.map((b,i)=>billRow(b,i)).join('')+'</div>'+
    '<button class="addbill" id="addBill"><i class="ti ti-plus"></i>Add a bill</button>'+
    '<div class="kv total"><span>Locked each month</span><span class="v" id="billTotal">'+fmt(t)+'</span></div>'+
  '</div>'+
  '<div class="fhint">Put anything predictable here, including fun money like date nights. Pre-committing it means you never skip it because the month went badly.</div>'+
  '<div class="navbtns"><button class="btn outline" id="back2">Back</button><button class="btn solid" id="next2">Continue</button></div>';
}

export function step3(){
  return '<p class="setup-lead">Savings is your cushion. It is locked by default, but you can choose to pull from it in a hard month.</p>'+
  '<label class="flabel">Savings target each month</label>'+
  '<input id="wSav" class="money" type="text" value="'+fmt(S.wiz.draft.savingsTarget)+'" />'+
  '<label class="flabel">Savings you already have</label>'+
  '<input id="wStart" class="money" type="text" value="'+fmt(S.wiz.draft.startingSavings)+'" />'+
  '<div class="fhint">Whatever you do not spend gets swept in here when the month closes, so this grows on its own.</div>'+
  '<div class="err" id="e3">Your bills and savings add up to more than you earn. Lower one of them.</div>'+
  '<div class="preview" id="prev"><span class="l">Your daily number</span><span class="v" id="prevV">0</span></div>'+
  '<div class="navbtns"><button class="btn outline" id="back3">Back</button><button class="btn solid" id="done3">Start</button></div>';
}

export function wireWizard(){
  const $=id=>document.getElementById(id);
  if(S.wiz.step===1){
    $('yPrev').onclick=()=>{S.wiz.year--;renderWizard();};
    $('yNext').onclick=()=>{S.wiz.year++;renderWizard();};
    document.querySelectorAll('.mtile').forEach(t=>t.onclick=()=>{S.wiz.month=t.dataset.k;renderWizard();});
    $('next1').onclick=()=>{
      const inc=money($('wIncome').value);
      if(!S.wiz.month||inc<=0){$('e1').classList.add('show');return;}
      S.wiz.draft.income=inc;S.wiz.step=2;renderWizard();
    };
  }
  if(S.wiz.step===2){
    const sync=syncBills;
    document.querySelectorAll('.billrow input').forEach(i=>i.addEventListener('input',sync));
    $('addBill').onclick=()=>{sync();S.wiz.draft.lockedBills.push({name:'',amount:0});renderWizard();};
    $('back2').onclick=()=>{sync();S.wiz.step=1;renderWizard();};
    $('next2').onclick=()=>{sync();S.wiz.draft.lockedBills=S.wiz.draft.lockedBills.filter(b=>b.amount>0);S.wiz.step=3;renderWizard();};
  }
  if(S.wiz.step===3){
    const upd=()=>{
      const sav=money($('wSav').value);
      const locked=S.wiz.draft.lockedBills.reduce((s,b)=>s+b.amount,0);
      const pool=S.wiz.draft.income-locked-sav;
      const {y,m}=parseKey(S.wiz.month);
      const per=pool/dim(y,m);
      const p=$('prev');
      if(pool<=0){p.classList.add('bad');$('prevV').textContent='Does not fit';}
      else{p.classList.remove('bad');$('prevV').textContent=fmt(per);}
    };
    $('wSav').oninput=upd;upd();
    $('back3').onclick=()=>{S.wiz.step=2;renderWizard();};
    $('done3').onclick=async()=>{
      const sav=money($('wSav').value);
      const start=money($('wStart').value);
      const locked=S.wiz.draft.lockedBills.reduce((s,b)=>s+b.amount,0);
      if(S.wiz.draft.income-locked-sav<=0){$('e3').classList.add('show');return;}
      S.config={income:S.wiz.draft.income,savingsTarget:sav,startingSavings:start,
        lockedBills:S.wiz.draft.lockedBills,startMonth:S.wiz.month};
      S.meta={savingsBalance:start,closed:[]};
      await sSet('config',S.config);await sSet('meta',S.meta);
      S.months={};S.viewMonth=(nowKey()>=S.wiz.month)?nowKey():S.wiz.month;
      document.getElementById('tabbar').style.display='flex';
      S.screen='today';render();
    };
  }
}

/* ---------- main ---------- */
