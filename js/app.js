import { S } from './state.js';
import { wireMoney } from './utils.js';
import { paintIcons } from './icons.js';
import { md, dropEntry, pushEntry, boot } from './data.js';
import { fmt, catLabel } from './utils.js';
import { toast } from './ui.js';
import { todayView, wireToday, maybeAutoOpen } from './views/today.js';
import { calView, wireCal } from './views/calendar.js';
import { setView, wireSet } from './views/settings.js';
import { trendsView, wireTrends } from './views/trends.js';

export function render(){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.s===S.screen));
  const a=document.getElementById('app');
  if(S.screen==='today'){a.innerHTML=todayView();wireToday();}
  if(S.screen==='calendar'){a.innerHTML=calView();wireCal();}
  if(S.screen==='trends'){a.innerHTML=trendsView();wireTrends();}
  if(S.screen==='settings'){a.innerHTML=setView();wireSet();}
  wireMoney();
  paintIcons();
  window.scrollTo(0,0);
}

document.addEventListener('click', async function(e){
  const t=e.target;
  if(!t||!t.closest) return;
  const del=t.closest('.del');
  if(del){
    const id=del.getAttribute('data-id'), k=S.viewMonth;
    if(!k||!id) return;
    const list=md(k).entries;
    const idx=list.findIndex(en=>en.id===id);
    if(idx<0) return;
    const removed=list[idx];
    await dropEntry(k, removed);
    render();
    // undo rather than a confirm: deleting a typo entry is frequent enough
    // that a dialog every time would be tapped through without reading
    toast('Removed '+fmt(removed.amount)+' · '+catLabel(removed.cat||'others'), async ()=>{
      delete removed.rowId;
      await pushEntry(k, removed);
      render();
    });
    return;
  }
});

document.getElementById('tabbar').onclick = e => {
  const b = e.target.closest('.tab');
  if(!b) return;
  S.screen = b.dataset.s;
  S.selDay = null;
  render();
};

paintIcons();
boot().then(() => maybeAutoOpen());
