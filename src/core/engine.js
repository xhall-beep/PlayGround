// Core engine: fixed-tick sim, entities, spatial hash, save/load.
import { BUILDINGS, UNITS } from '../buildings/data.js';
import { factionMult } from '../factions/factions.js';

let UID = 1;
export function reseedUID(st){ let m=0; for(const e of st.entities) if(typeof e.id==='number'&&e.id>m)m=e.id; UID=Math.max(UID,m+1); }
export function makeState(opts){
  return {
    t:0, tick:0, over:null, speed:Number(opts.speed||1), bells:0,
    fog: opts.fog!=='off',
    playerFaction: opts.faction||'human', aiFaction: opts.aiFaction||'undead',
    aiPersona: opts.ai||'expander',
    seed: (Math.random()*1e9)|0,
    entities:[], // {id,owner,kind,type,x,z,hp,maxHp,state,...}
    res:[ {gold:220,wood:160,food:2,popCap:5},{gold:220,wood:160,food:2,popCap:5} ],
    stats:{ kills:[0,0], razes:[0,0] },
    firstBlood:false,
    achievements:[],
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
  const pierce = src?.armorPierce||0;
  let d = Math.max(1, baseDmg - armor*(1-pierce));
  if(src?.buff?.rally>0) d *= 1.4;
  if(tgt.buff?.rally>0) d = Math.max(1, d-2);
  tgt.hp -= d; tgt.flash=0.25;
  if(tgt.hp<=0){ tgt.hp=0; tgt.dead=true; tgt.deathT=0.6;
    if(tgt.cat==='unit') st.stats.kills[src.owner===0?0:1]+=0; // kills counted by killer below
    if(src&&src.owner!==undefined&&tgt.cat==='unit'){ st.stats.kills[src.owner]+=1; if(!st.firstBlood){st.firstBlood=true; st.events.push({t:'toast',msg:`🩸 First blood — ${src.owner===0?'you strike!':'enemy strikes!'}`});} }
    if(tgt.cat==='bld'&&tgt.done){ st.events.push({t:'toast',msg:`${tgt.owner===0?'😱 Your':'🔥 Enemy'} ${BUILDINGS[tgt.type]?.name||tgt.type} destroyed!`}); }
    if(tgt.type==='townhall'){ checkGameOver(st); }
    // Faction signatures: Undead raise the slain, Demon strikes leave a burn.
    if(src&&src.owner!==undefined&&tgt.cat==='unit'){
      const kf=factionMult(src.owner===0?st.playerFaction:st.aiFaction);
      if(kf.burn) tgt.burn={t:3,dps:2,owner:src.owner};
      if(kf.raise&&Math.random()<kf.raise){
        const u=UNITS.skeleton;
        addEntity(st,{cat:'unit',type:'skeleton',owner:src.owner,x:tgt.x+(Math.random()*2-1),z:tgt.z+(Math.random()*2-1),hp:u.hp*kf.hp,maxHp:u.hp*kf.hp,dmg:u.dmg*kf.dmg,armor:u.armor,range:u.range,speed:u.speed*kf.speed,sight:u.sight,armorPierce:u.armorPierce||0,order:null,carry:null,carryAmt:0,cool:0});
        st.events.push({t:'toast',msg:'💀 A skeleton rises!'});
      }
    }
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
export function getProfile(){ try{return JSON.parse(localStorage.getItem(PKEY)||'{"wins":0,"losses":0,"best":"","ach":[]}');}catch{return{wins:0,losses:0,best:'',ach:[]};} }
export function setProfile(p){ try{localStorage.setItem(PKEY,JSON.stringify(p));}catch{} }
