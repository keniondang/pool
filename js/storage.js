if(typeof window.storage==='undefined'){
  const P='pool:';
  window.storage={
    get(k){return new Promise((res,rej)=>{const v=localStorage.getItem(P+k);
      v===null?rej(new Error('not found')):res({key:k,value:v});});},
    set(k,v){return new Promise(res=>{localStorage.setItem(P+k,v);res({key:k,value:v});});},
    delete(k){return new Promise(res=>{localStorage.removeItem(P+k);res({key:k,deleted:true});});},
    list(prefix){return new Promise(res=>{const keys=[];
      for(let i=0;i<localStorage.length;i++){const kk=localStorage.key(i);
        if(kk.indexOf(P)===0){const b=kk.slice(P.length);
          if(!prefix||b.indexOf(prefix)===0)keys.push(b);}}
      res({keys:keys});});}
  };
}

export async function sGet(k){
  try{ const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; }
  catch(e){ return null; }
}
export async function sSet(k,v){
  try{ await window.storage.set(k, JSON.stringify(v)); }catch(e){}
}
export async function sDel(k){
  try{ await window.storage.delete(k); }catch(e){}
}
export async function sList(){
  try{ const r = await window.storage.list(''); return r && r.keys ? r.keys : []; }
  catch(e){ return []; }
}
