import { S } from '../state.js';
import { sGet, sSet, sList } from '../storage.js';
import { fmt, money, billRow, syncBills, wireMoney } from '../utils.js';
import { paintIcons } from '../icons.js';
import { calc, boot } from '../data.js';
import { render } from '../app.js';
import { renderWizard } from './wizard.js';

export function setView(){
  const c=calc(S.viewMonth,S.curDay);
  return '<div class="wrap">'+
  '<div class="topbar"><div><div class="eyebrow">Pool</div><h1>Settings</h1></div></div>'+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-coin"></i>Money in</div></div>'+
  '<input id="sIncome" class="money" type="text" value="'+fmt(S.config.income)+'" /></div>'+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-lock"></i>Locked bills</div></div>'+
  '<div id="bills">'+S.config.lockedBills.map((b,i)=>billRow(b,i)).join('')+'</div>'+
  '<button class="addbill" id="addBill"><i class="ti ti-plus"></i>Add a bill</button>'+
  '<div class="kv total"><span>Locked each month</span><span class="v" id="billTotal">'+fmt(c.locked)+'</span></div></div>'+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-shield-check"></i>Savings</div></div>'+
  '<label class="flabel" style="margin-top:0;">Target each month</label>'+
  '<input id="sSav" class="money" type="text" value="'+fmt(S.config.savingsTarget)+'" />'+
  '<label class="flabel">Balance</label>'+
  '<input id="sBal" class="money" type="text" value="'+fmt(S.meta.savingsBalance)+'" /></div>'+

  '<div class="err" id="sErr">Bills and savings add up to more than you earn.</div>'+
  '<button class="btn solid" id="save" style="width:100%;margin-bottom:16px;">Save changes</button>'+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-download"></i>Backup</div></div>'+
  '<div style="font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:11px;">Everything lives in this browser only. Export a file now and then so clearing your browser cannot wipe your history.</div>'+
  '<div style="display:flex;gap:8px;"><button class="btn outline" id="expBtn" style="flex:1;">Export file</button>'+
  '<button class="btn outline" id="impBtn" style="flex:1;">Import file</button></div>'+
  '<input type="file" id="impFile" accept="application/json" style="display:none;" /></div>'+

  '<div class="card"><div class="card-head"><div class="lhs"><i class="ti ti-trash"></i>Erase everything</div></div>'+
  '<div style="font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:11px;">Deletes every entry, your savings history and your setup, then starts the wizard again.</div>'+
  '<button class="btn danger" id="eraseT" style="width:100%;">Erase everything</button>'+
  '<div class="confirm" id="eraseBox"><div class="fhint" style="margin-bottom:9px;">This cannot be undone.</div>'+
  '<button class="btn danger" id="eraseGo" style="width:100%;">Yes, erase everything</button></div></div>'+
  '</div>';
}

export function wireSet(){
  const $=id=>document.getElementById(id);
  const sync=syncBills;
  document.querySelectorAll('.billrow input').forEach(i=>i.addEventListener('input',sync));
  $('addBill').onclick=()=>{
    const l=$('bills'),d=document.createElement('div');
    d.className='billrow';
    d.innerHTML='<input class="bn" type="text" placeholder="Name" /><input class="ba money" type="text" placeholder="0" /><button class="iconbtn rm"><i class="ti ti-x"></i></button>';
    l.appendChild(d);
    wireMoney();
    paintIcons();
    d.querySelectorAll('input').forEach(i=>i.addEventListener('input',sync));
    d.querySelector('.bn').focus();
  };
  $('save').onclick=async()=>{
    const inc=money($('sIncome').value);
    const sav=money($('sSav').value);
    const bal=money($('sBal').value);
    const bills=[...document.querySelectorAll('.billrow')].map(r=>({
      name:r.querySelector('.bn').value.trim()||'Untitled',
      amount:money(r.querySelector('.ba').value)})).filter(b=>b.amount>0);
    const locked=bills.reduce((s,b)=>s+b.amount,0);
    if(inc-locked-sav<=0){$('sErr').classList.add('show');return;}
    S.config.income=inc;S.config.savingsTarget=sav;S.config.lockedBills=bills;
    S.meta.savingsBalance=bal;
    await sSet('config',S.config);await sSet('meta',S.meta);
    S.screen='today';render();
  };
  $('expBtn').onclick=async()=>{
    const keys=await sList(), dump={};
    for(const kk of keys){ dump[kk]=await sGet(kk); }
    const blob=new Blob([JSON.stringify({v:1,exported:new Date().toISOString(),data:dump},null,2)],
      {type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='pool-backup-'+new Date().toISOString().slice(0,10)+'.json';
    a.click();URL.revokeObjectURL(a.href);
  };
  $('impBtn').onclick=()=>$('impFile').click();
  $('impFile').onchange=async(ev)=>{
    const f=ev.target.files[0];if(!f)return;
    try{
      const parsed=JSON.parse(await f.text());
      if(!parsed||!parsed.data) throw new Error('bad file');
      const old=await sList();
      for(const kk of old){try{await window.storage.delete(kk);}catch(e){}}
      for(const kk of Object.keys(parsed.data)){ await sSet(kk,parsed.data[kk]); }
      S.months={};S.config=null;S.meta=null;
      await boot();
    }catch(e){ alert('That file could not be read.'); }
  };
  $('eraseT').onclick=()=>$('eraseBox').classList.toggle('open');
  $('eraseGo').onclick=async()=>{
    const keys=await sList();
    for(const k of keys){try{await window.storage.delete(k);}catch(e){}}
    S.config=null;S.meta=null;S.months={};S.wiz={step:1,year:2026,month:null,draft:null};
    renderWizard();
  };
}
