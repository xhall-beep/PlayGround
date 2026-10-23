// AI: economy + scouting + expansion + army composition + attacks + defense + personality.
import { alive, canAfford, pay, popCap, srand } from '../core/engine.js';
import { BUILDINGS, UNITS } from '../buildings/data.js';
import { factionMult } from '../factions/factions.js';
import { orderMove, orderAttack, orderGather, orderBuild, findResource, nearestHall, spawnBase } from '../sim/sim.js';
import { addEntity } from '../core/engine.js';

export const PERSONAS={
  aggressor:{name:'Aggressor',barracksAt:1,warriors:8,attackAt:150,desc:'early pressure'},
  turtle:{name:'Defender',barracksAt:3,towers:3,warriors:6,attackAt:420,desc:'turtles then pushes'},
  expander:{name:'Expander',barracksAt:2,farms:3,warriors:10,attackAt:300,desc:'booms economy'},
};

export function aiTick(st,map,owner=1){
  const O=owner; if(st.over||st.tutorial) return;
  const fm=factionMult(O===0?st.playerFaction:st.aiFaction);
  const peasants=st.entities.filter(e=>e.owner===O&&e.type==='peasant'&&alive(e));
  const army=st.entities.filter(e=>e.owner===O&&(e.type==='warrior'||e.type==='archer'||e.type==='mage'||e.type==='knight')&&alive(e));
  const halls=st.entities.filter(e=>e.owner===O&&e.type==='townhall'&&alive(e));
  if(!halls.length) return;
  const hall=halls[0];
  const P=PERSONAS[st.aiPersona]||PERSONAS.expander;
  const r=st.res[O];
  const nb=(t)=>st.entities.filter(e=>e.owner===O&&e.type===t&&alive(e)).length;
  const inQueue=(t)=>st.entities.filter(e=>e.owner===O&&e.cat==='bld'&&!e.done&&alive(e)).length;

  // 1) keep peasants coming (max 8)
  const th=st.entities.find(e=>e.owner===O&&e.type==='townhall'&&alive(e));
  if(th&&th.done&&peasants.length<8&&th.queue.length<2&&canAfford(st,O,{gold:50},fm)){pay(st,O,{gold:50},fm);th.queue.push('peasant');th.prog=th.prog||0;}

  // 2) assign idle peasants: ~60% wood, 40% gold
  peasants.forEach((p,i)=>{
    if(p.order&&(p.order.kind==='gather'||p.order.kind==='build'))return;
    const kind2=(i%5<2)?'gold':'tree';
    const idx=findResource(map,p.x,p.z,kind2,st);
    if(idx>=0) orderGather(st,map,p,kind2,idx);
  });

  // 3) build order
  const t=st.t;
  const wantFarm=nb('farm')< (P.farms??2) && popCap(st,O)-usedPop(st,O)<3;
  const wantRax=nb('barracks')<1 && peasants.length>=(P.barracksAt+3);
  const wantTower=nb('tower')<(P.towers??(st.aiPersona==='turtle'?3:1)) && nb('barracks')>=1;
  const wantSmith=nb('blacksmith')<1 && st.t>300;
  const wantArch=nb('archery')<1 && st.t>360;
  const wantMage=st.entities.filter(e=>e.owner===O&&e.cat==='bld'&&e.type==='mage'&&alive(e)).length<1 && st.t>420;
  const wantExpand=nb('townhall')<2 && st.t>420 && nb('farm')>=3 && st.res[O].gold>300;
  let wish=null;
  if(wantFarm)wish='farm'; else if(wantRax)wish='barracks'; else if(wantTower)wish='tower'; else if(wantArch)wish='archery'; else if(wantSmith)wish='blacksmith'; else if(wantMage)wish='mage'; else if(wantExpand)wish='townhall'; else if(nb('farm')<4&&st.t>240)wish='farm';
  if(wish&&inQueue()<2&&canAfford(st,O,BUILDINGS[wish].cost,fm)){
    pay(st,O,BUILDINGS[wish].cost,fm);
    let px,pz;
    if(wish==='townhall'){ // expansion: settle a neutral gold vein away from the enemy base
      const eh=st.entities.find(e=>e.owner!==O&&e.cat==='bld'&&e.type==='townhall'&&alive(e));
      let best=null,bd=-1;
      for(const g of map.gold){ if(g.amount<=0)continue; if(eh&&Math.hypot(g.x-eh.x,g.z-eh.z)<20)continue;
        const d=Math.hypot(g.x-hall.x,g.z-hall.z); if(d>bd){bd=d;best=g;} }
      if(best){ px=clamp(best.x+3); pz=clamp(best.z+3); }
    }
    if(px===undefined){ const a=srand(st)*6.28,dd=7+srand(st)*4; px=clamp(hall.x+Math.cos(a)*dd); pz=clamp(hall.z+Math.sin(a)*dd); }
    const b=addEntity(st,{cat:'bld',type:wish,owner:O,f:st.aiFaction,x:px,z:pz,hp:1,maxHp:BUILDINGS[wish].hp*fm.hp,done:false,prog:0,time:BUILDINGS[wish].time,builder:false,size:BUILDINGS[wish].size,sight:BUILDINGS[wish].sight,armor:1,queue:[],cool:0});
    const builder=peasants.find(p=>!p.building);
    if(builder) orderBuild(st,builder,b.id); else b.builder=true;
  }
  // send builders to unfinished
  for(const b of st.entities.filter(e=>e.owner===O&&e.cat==='bld'&&!e.done&&alive(e)&&!e.builder)){
    const free=peasants.find(p=>!p.building&&(!p.order||p.order.kind!=='build'));
    if(free) orderBuild(st,free,b.id);
  }

  // 4) train army — keep 2 slots for mages once the Mage Tower stands
  const mageB=st.entities.find(e=>e.owner===O&&e.cat==='bld'&&e.type==='mage'&&e.done&&alive(e));
  const magi=army.filter(u=>u.type==='mage').length;
  const rax=st.entities.find(e=>e.owner===O&&e.type==='barracks'&&e.done&&alive(e));
  if(rax&&rax.queue.length<2){
    const comp = st.t>360&&srand(st)<0.3?'archer':'warrior';
    const cap = mageB?12:14;
    if(usedPop(st,O)+(UNITS[comp].pop||1)<=popCap(st,O)&&canAfford(st,O,UNITS[comp].cost,fm)&&army.length<cap){pay(st,O,UNITS[comp].cost,fm);rax.queue.push(comp);}
  }
  const arch=st.entities.find(e=>e.owner===O&&e.type==='archery'&&e.done&&alive(e));
  if(arch&&arch.queue.length<1&&army.length>6&&army.length<14&&usedPop(st,O)+(UNITS.knight.pop||1)<=popCap(st,O)&&canAfford(st,O,UNITS.knight.cost,fm)){pay(st,O,UNITS.knight.cost,fm);arch.queue.push('knight');}
  if(mageB&&mageB.queue.length<1&&magi<2&&usedPop(st,O)+(UNITS.mage.pop||1)<=popCap(st,O)&&canAfford(st,O,UNITS.mage.cost,fm)){pay(st,O,UNITS.mage.cost,fm);mageB.queue.push('mage');}

  // 5) attack waves — telegraphed: the player gets a toast before the push lands.
  // Prefer the Town Hall (that's the win condition) and escalate past mid-game:
  // a stale stalemate is the only way an AI-vs-AI match never resolves.
  const FOE=1-O;
  const atkAt=P.attackAt||300;
  const late=Math.max(0,Math.floor((st.t-(atkAt+600))/120));
  const eager=Math.max(4,(P.warriors||8)-late);
  if(st.t>atkAt&&(army.length>=eager||army.length>=12||(st.t>atkAt+300&&army.length>=5))){
    const foe=st.entities.find(e=>e.owner===FOE&&e.type==='townhall'&&alive(e))||st.entities.find(e=>e.owner===FOE&&e.cat==='bld'&&alive(e));
    if(foe){ if(O===1&&st.t-(st._pushAt??-1e9)>90){ st._pushAt=st.t; st.events.push({t:'toast',msg:'⚔️ Enemy army is marching!'}); }
      army.forEach((u,i)=>{ u.order={kind:'attackmove',x:foe.x+(i%4)*2,z:foe.z+Math.floor(i/4)*2,path:null,pi:0}; }); }
  }
  // 6) defense: if enemy near base, pull half army back
  const invader=st.entities.find(e=>e.owner===FOE&&e.cat==='unit'&&alive(e)&&Math.hypot(e.x-hall.x,e.z-hall.z)<18);
  if(invader){ army.slice(0,Math.ceil(army.length/2)).forEach(u=>{u.order={kind:'attack',id:invader.id};}); }
}
function usedPop(st,O){ return st.entities.filter(e=>e.owner===O&&e.cat==='unit'&&!e.dead).reduce((s,e)=>s+(UNITS[e.type].pop||1),0); }
function clamp(v){ return Math.max(-44,Math.min(44,v)); }
