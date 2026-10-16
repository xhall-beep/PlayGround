// Core engine: fixed-tick sim, entities, spatial hash, save/load.
import { BUILDINGS, UNITS } from '../buildings/data.js';
import { factionMult } from '../factions/factions.js';

let UID = 1;
export function reseedUID(st){ let m=0; for(const e of st.entities) if(typeof e.id==='number'&&e.id>m)m=e.id; UID=Math.max(UID,m+1); }
export function resetUID(v=1){ UID=v; }
// Deterministic RNG (mulberry32). State lives in the save as a plain number,
// so replays, balance runs and lockstep-style state hashing all agree.
export function srand(st){
  if(!Number.isFinite(st.rngState)) st.rngState=(st.seed|0)>>>0;
  let a=(st.rngState=(st.rngState+0x6D2B79F5)>>>0);
  let t=a;
  t=Math.imul(t^(t>>>15),t|1);
  t^=t+Math.imul(t^(t>>>7),t|61);
  return ((t^(t>>>14))>>>0)/4294967296;
}
export function makeState(opts){
  const seed=(opts.seed??((Math.random()*1e9)|0))>>>0;
  return {
    t:0, tick:0, over:null, speed:Number(opts.speed||1),
    fog: opts.fog!=='off',
    playerFaction: opts.faction||'human', aiFaction: opts.aiFaction||'undead',
    aiPersona: opts.ai||'expander',
    seed,
    rngState: seed,
    entities:[], // {id,owner,kind,type,x,z,hp,maxHp,state,...}
    res:[ {gold:220,wood:160,food:2,popCap:5},{gold:220,wood:160,food:2,popCap:5} ],
    stats:{ kills:[0,0], razes:[0,0] },
    firstBlood:false,
    achievements:[],
    specialCd:[0,0],
  };
}

// grid helpers — world 96x96 units, cell 2
export const WORLD=96, CELL=2, GRID=48;
export const g2w=(g)=>(g-GRID/2)*CELL+CELL/2;
export const w2g=(w)=>Math.max(0,Math.min(GRID-1,Math.floor(w/CELL+GRID/2)));
export function dist(a,b){ const dx=a.x-b.x,dz=a.z-b.z; return Math.hypot(dx,dz); }

export function addEntity(st,e){ e.id=UID++; st.entities.push(e); return e; }
export function byId(st,id){ return st.entities.find(e=>e.id===id); }
export function alive(e){ return e.hp>0 && !e.dead; }
export function ownerPop(st,owner){ return st.entities.filter(e=>e.owner===owner&&e.cat==='unit'&&alive(e)).reduce((s,e)=>s+(UNITS[e.type].pop||1),0); }
export function popCap(st,owner){
  let cap=5;
  for(const e of st.entities){ if(e.owner===owner&&e.cat==='bld'&&alive(e)&&e.done){ if(e.type==='farm')cap+=BUILDINGS.farm.pop; if(e.type==='townhall')cap+=5; } }
  return cap;
}

export function canAfford(st,owner,cost,fm){
  const r=st.res[owner];
  return r.gold>=(cost.gold||0)*(fm?.cost??1)-1e-6 && r.wood>=(cost.wood||0)*(fm?.cost??1)-1e-6;
}
export function pay(st,owner,cost,fm){
  const r=st.res[owner], m=fm?.cost??1;
  r.gold-= (cost.gold||0)*m; r.wood-=(cost.wood||0)*m;
}

// --- spatial hash for queries
export function eachNear(st,x,z,rad,fn){
  for(const e of st.entities){ if(e.dead)continue; const dx=e.x-x,dz=e.z-z; if(dx*dx+dz*dz<=rad*rad) fn(e); }
}

// --- damage with armor + faction mults
export function dealDamage(st,src,tgt,baseDmg){
  if(!alive(tgt)||st.over) return;
  const armor = tgt.armor||0;
  let d = Math.max(1, baseDmg - armor);
  tgt.hp -= d; tgt.flash=0.25;
  if(tgt.hp<=0){ tgt.hp=0; tgt.dead=true; tgt.deathT=0.6;
    if(tgt.cat==='unit') st.stats.kills[src.owner===0?0:1]+=0; // kills counted by killer below
    if(src&&src.owner!==undefined&&tgt.cat==='unit'){ st.stats.kills[src.owner]+=1; if(!st.firstBlood){st.firstBlood=true; st.events.push({t:'toast',msg:`🩸 First blood — ${src.owner===0?'you strike!':'enemy strikes!'}`});} }
    if(tgt.cat==='bld'&&tgt.done){ st.events.push({t:'toast',msg:`${tgt.owner===0?'😱 Your':'🔥 Enemy'} ${BUILDINGS[tgt.type]?.name||tgt.type} destroyed!`}); }
    if(tgt.type==='townhall'){ checkGameOver(st); }
  }
}
export function checkGameOver(st){
  const th0=st.entities.some(e=>e.owner===0&&e.type==='townhall'&&alive(e));
  const th1=st.entities.some(e=>e.owner===1&&e.type==='townhall'&&alive(e));
  if(!th0&&!th1) st.over={win:false,draw:true};
  else if(!th1) st.over={win:true};
  else if(!th0) st.over={win:false};
}

// --- save/load (Save State system)
const KEY='kingdoms-rts-save-v1';
export function saveGame(st,map){ try{ localStorage.setItem(KEY, JSON.stringify({st:{...st,events:[]},map:{trees:map.trees.map(t=>({x:t.x,z:t.z,amount:t.amount})),gold:map.gold.map(t=>({x:t.x,z:t.z,amount:t.amount}))}})); return true;}catch{return false;} }
export function loadGame(){ try{ const s=localStorage.getItem(KEY); return s?JSON.parse(s):null;}catch{return null;} }
export function wipeSave(){ try{localStorage.removeItem(KEY);}catch{} }
const PKEY='kingdoms-rts-profile-v1';
export function getProfile(){ try{return JSON.parse(localStorage.getItem(PKEY)||'{"wins":0,"losses":0,"best":"","ach":[],"missions":[]}');}catch{return{wins:0,losses:0,best:'',ach:[],missions:[]};} }
export function setProfile(p){ try{localStorage.setItem(PKEY,JSON.stringify(p));}catch{} }
