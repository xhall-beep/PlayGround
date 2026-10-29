// AI: economy + scouting + expansion + army composition + attacks + defense + personality.
import { alive, canAfford, pay, popCap, g2w, GRID } from '../core/engine.js';
import { BUILDINGS, UNITS } from '../buildings/data.js';
import { factionMult } from '../factions/factions.js';
import { orderMove, orderAttack, orderGather, orderBuild, findResource, nearestHall, spawnBase } from '../sim/sim.js';
import { addEntity } from '../core/engine.js';

export const PERSONAS={
  aggressor:{name:'Aggressor',barracksAt:1,warriors:5,attackAt:180,desc:'early pressure'},
  turtle:{name:'Defender',barracksAt:3,towers:3,warriors:6,attackAt:420,desc:'turtles then pushes'},
  expander:{name:'Expander',barracksAt:2,farms:3,warriors:10,attackAt:300,desc:'booms economy'},
};

export function aiTick(st,map){
  const O=1; if(st.over) return;
  const fm=factionMult(st.aiFaction);
  const peasants=st.entities.filter(e=>e.owner===O&&e.type==='peasant'&&alive(e));
  const army=st.entities.filter(e=>e.owner===O&&(e.type==='warrior'||e.type==='archer'||e.type==='knight'||e.type==='skeleton'||e.type==='hero')&&alive(e));
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
    if(p.order&&(p.order.kind==='gather'||p.order.kind==='build'||p.order.kind==='move'))return;
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
  let wish=null;
  if(wantFarm)wish='farm'; else if(wantRax)wish='barracks'; else if(wantTower)wish='tower'; else if(wantArch)wish='archery'; else if(wantSmith)wish='blacksmith'; else if(nb('farm')<4&&st.t>240)wish='farm';
  if(wish&&inQueue()<2&&canAfford(st,O,BUILDINGS[wish].cost,fm)){
    pay(st,O,BUILDINGS[wish].cost,fm);
    const a=Math.random()*6.28,dd=7+Math.random()*4;
    const b=addEntity(st,{cat:'bld',type:wish,owner:O,faction:st.aiFaction,x:clamp(hall.x+Math.cos(a)*dd),z:clamp(hall.z+Math.sin(a)*dd),hp:1,maxHp:BUILDINGS[wish].hp*fm.hp*(fm.bldHp??1),done:false,prog:0,time:BUILDINGS[wish].time,builder:false,size:BUILDINGS[wish].size,sight:BUILDINGS[wish].sight,armor:1,queue:[],cool:0});
    const builder=peasants.find(p=>!p.building);
    if(builder) orderBuild(st,builder,b.id); else b.builder=true;
  }
  // send builders to unfinished
  for(const b of st.entities.filter(e=>e.owner===O&&e.cat==='bld'&&!e.done&&alive(e)&&!e.builder)){
    const free=peasants.find(p=>!p.building&&(!p.order||p.order.kind!=='build'));
    if(free) orderBuild(st,free,b.id);
  }

  // 4) train army
  const rax=st.entities.find(e=>e.owner===O&&e.type==='barracks'&&e.done&&alive(e));
  if(rax&&rax.queue.length<2){
    const comp = st.t>360&&Math.random()<0.3?'archer':'warrior';
    if(usedPop(st,O)+(UNITS[comp].pop||1)<=popCap(st,O)&&canAfford(st,O,UNITS[comp].cost,fm)&&army.length<14){pay(st,O,UNITS[comp].cost,fm);rax.queue.push(comp);}
  }
  const arch=st.entities.find(e=>e.owner===O&&e.type==='archery'&&e.done&&alive(e));
  if(arch&&arch.queue.length<1&&army.length>6&&canAfford(st,O,UNITS.knight.cost,fm)){pay(st,O,UNITS.knight.cost,fm);arch.queue.push('knight');}

  // 5) attack waves
  const atkAt=P.attackAt||300;
  if((st.t>atkAt&&army.length>=(P.warriors||8))||army.length>=12){
    const foe=st.entities.find(e=>e.owner===0&&e.cat==='bld'&&alive(e));
    if(foe) army.forEach((u,i)=>{ u.order={kind:'attackmove',x:foe.x+(i%4)*2,z:foe.z+Math.floor(i/4)*2,path:null,pi:0}; });
  }
  // 6) defense: if enemy near base, pull half army back
  const invader=st.entities.find(e=>(e.owner===0||e.owner===2)&&e.cat==='unit'&&alive(e)&&Math.hypot(e.x-hall.x,e.z-hall.z)<18);
  if(invader){ army.slice(0,Math.ceil(army.length/2)).forEach(u=>{u.order={kind:'attack',id:invader.id};}); }

  // 7) scouting: a spare body walks into the fog every ~45s
  if(st.t-(st._scoutT??0)>45){
    st._scoutT=st.t;
    const spot=unexploredSpot(map,O);
    if(spot){
      const scout=army.find(u=>!u.order||u.order.kind==='idle')||peasants.find(p=>!p.order||p.order.kind==='idle');
      if(scout) orderMove(st,scout,spot.x,spot.z,false);
    }
  }
}
function unexploredSpot(map,owner){
  for(let i=0;i<60;i++){
    const gx=(Math.random()*GRID)|0, gz=(Math.random()*GRID)|0;
    if(!map.explored?.[owner]?.[gz*GRID+gx]) return {x:g2w(gx),z:g2w(gz)};
  }
  return null;
}
function usedPop(st,O){ return st.entities.filter(e=>e.owner===O&&e.cat==='unit'&&!e.dead).reduce((s,e)=>s+(UNITS[e.type].pop||1),0); }
function clamp(v){ return Math.max(-44,Math.min(44,v)); }
