// Simulation tick: economy (gather/build/produce), military (combat/projectiles), orders, navigation.
import { addEntity, byId, alive, dist, eachNear, dealDamage, popCap, pay, canAfford, w2g, WORLD } from '../core/engine.js';
import { BUILDINGS, UNITS, trainableAt } from '../buildings/data.js';
import { factionMult, coreFaction } from '../factions/factions.js';
import { findPath, buildBlocked, updateFog } from '../world/world.js';

export function spawnBase(st,map,owner,fx,fz,faction){
  const fm=factionMult(faction);
  const th=addEntity(st,{cat:'bld',type:'townhall',owner,f:faction,x:fx,z:fz,hp:1600*fm.hp,maxHp:1600*fm.hp,done:true,size:3.4,sight:12,armor:2,queue:[],prog:0});
  for(let i=0;i<2;i++) addEntity(st,{cat:'unit',type:'peasant',owner,f:faction,x:fx+4+i*2.5,z:fz+4,hp:70*fm.hp,maxHp:70*fm.hp,dmg:4,armor:0,speed:5.2,sight:9,order:null,carry:null,carryAmt:0,cool:0});
  return th;
}

export function castSpecial(st,map,owner){
  const fkey=coreFaction(owner===0?st.playerFaction:st.aiFaction);
  const sp=factionMult(fkey).special;
  if(!sp) return 'No special for this faction';
  const cd=st.specialCd||(st.specialCd=[0,0]);
  if(cd[owner]>0) return `${sp.name} recharging (${Math.ceil(cd[owner])}s)`;
  if(st.res[owner].gold<(sp.cost.gold||0)) return `Need ${sp.cost.gold}🪙 for ${sp.name}`;
  st.res[owner].gold-=sp.cost.gold||0; cd[owner]=sp.cd||60;
  const mine=st.entities.filter(e=>!e.dead&&e.owner===owner&&e.cat==='unit');
  const heal=n=>{ for(const u of mine) u.hp=Math.min(u.maxHp,u.hp+n); };
  if(fkey==='human'){ heal(40); return `🛡️ ${sp.name}! Army rallied (+40 HP).`; }
  if(fkey==='orc'){ for(const u of mine){ if(u.type!=='peasant')u.dmg+=3; } heal(25); return `🩸 ${sp.name}! +3 damage, +25 HP.`; }
  if(fkey==='undead'){
    const anchor=nearestHall(st,owner,0,0)||mine[0]||{x:0,z:0};
    const f=fmOf(st,owner);
    for(let i=0;i<2;i++) addEntity(st,{cat:'unit',type:'warrior',owner,f:fkey,x:anchor.x+2+i*2,z:anchor.z+2,hp:UNITS.warrior.hp*f.hp*0.6,maxHp:UNITS.warrior.hp*f.hp*0.6,dmg:UNITS.warrior.dmg*f.dmg,armor:0,speed:UNITS.warrior.speed,sight:9,order:null,carry:null,carryAmt:0,cool:0});
    return `💀 ${sp.name}! Two skeletons rise.`;
  }
  heal(60); return `🌙 ${sp.name}! +60 HP to your army.`;
}
function fmOf(st,owner){ return factionMult(owner===0?st.playerFaction:st.aiFaction); }

let blockedCache=null, blockedTick=-1;
export function tick(st,map,dt){
  st.events=[];
  st.t+=dt; st.tick++;
  if(st.specialCd) for(let o=0;o<2;o++) if(st.specialCd[o]>0) st.specialCd[o]=Math.max(0,st.specialCd[o]-dt);
  const fm=[factionMult(st.playerFaction),factionMult(st.aiFaction)];
  if(st.tick%20===0) updateFog(st,map);
  if(blockedTick!==st.tick){ blockedCache=buildBlocked(st,map); blockedTick=st.tick; }

  // economy trickle: farms give food
  if(st.tick%50===0){ for(let o=0;o<2;o++){ const farms=st.entities.filter(e=>e.owner===o&&e.type==='farm'&&e.done&&alive(e)).length; st.res[o].food+=farms*1; } }

  for(const e of st.entities){
    if(e.dead) continue;
    if(e.flash>0)e.flash-=dt;
    if(e.cat==='bld'){
      // construction progress
      if(!e.done){ e.prog+=(dt/e.time)*(e.builder?1:0.15); if(e.prog>=1){e.done=true;e.prog=1;e.hp=e.maxHp;st.events.push({t:'toast',msg:`${e.owner===0?'✅':'🏗️'} ${BUILDINGS[e.type].name} ${e.owner===0?'ready!':'built by enemy!'}`});} continue; }
      // production queue
      if(e.queue&&e.queue.length){
        const u=e.queue[0]; e.prog+=dt/UNITS[u].time;
        if(e.prog>=1){ e.queue.shift(); e.prog=0;
          const f=fm[e.owner];
          const nu=addEntity(st,{cat:'unit',type:u,owner:e.owner,f:e.owner===0?st.playerFaction:st.aiFaction,x:e.x+2.5,z:e.z+2.5,hp:UNITS[u].hp*f.hp,maxHp:UNITS[u].hp*f.hp,dmg:UNITS[u].dmg*(u==='archer'?(f.archer??f.dmg):f.dmg)*(e.buffDmg||1),armor:UNITS[u].armor,speed:UNITS[u].speed*f.speed,sight:UNITS[u].sight,order:null,carry:null,carryAmt:0,cool:0});
          if(e.rally) orderMove(st,nu,e.rally.x,e.rally.z,false);
        }
      }
      // tower shooting
      if(e.type==='tower'){ e.cool=(e.cool||0)-dt; if(e.cool<=0){ const tgt=nearestEnemy(st,e,BUILDINGS.tower.range,e.owner); if(tgt){ e.cool=1.4; fireProjectile(st,e,tgt,BUILDINGS.tower.dmg*fm[e.owner].dmg);} } }
      // blacksmith instant buff
      if(e.type==='blacksmith'&&!e.applied){ e.applied=true; for(const u of st.entities) if(u.owner===e.owner&&u.cat==='unit'){u.dmg+=2;u.maxHp+=20;u.hp+=20;} }
    } else {
      // unit AI
      e.cool-=dt;
      updateUnit(st,map,e,dt,fm[e.owner],blockedCache);
      // QoL: idle player peasants auto-seek wood after 6s (classic RTS behavior).
      // In Mission 1 they stay inside the clearing so the fixed camera keeps them
      // on screen and tappable.
      if(e.owner===0&&e.type==='peasant'&&e.order&&e.order.kind==='idle'){
        e.idleT=(e.idleT||0)+dt;
        if(e.idleT>6){ e.idleT=0; const i=findResource(map,e.x,e.z,'tree',st,st.tutorial?15:Infinity); if(i>=0) orderGather(st,map,e,'tree',i); }
      } else e.idleT=0;
    }
  }
  // crowd separation: nudge stacked units apart so armies never share one pixel.
  // Pushes are accumulated then capped per unit per tick, otherwise a dense blob
  // cancels its own advance and melee armies jam just out of range forever.
  const crowd=st.entities.filter(e=>!e.dead&&e.cat==='unit');
  const push=new Map();
  for(let i=0;i<crowd.length;i++){ const a=crowd[i];
    for(let j=i+1;j<crowd.length;j++){ const b=crowd[j];
      const dx=b.x-a.x,dz=b.z-a.z,d2=dx*dx+dz*dz;
      if(d2<0.81){ let nx,nz,d;
        if(d2>1e-6){ d=Math.sqrt(d2); nx=dx/d; nz=dz/d; }
        else { const s=((a.id+b.id)%2?1:-1); nx=s; nz=0; d=0; }
        const f=(0.9-d)*0.5;
        const pa=push.get(a.id)||{x:0,z:0}, pb=push.get(b.id)||{x:0,z:0};
        pa.x-=nx*f; pa.z-=nz*f; pb.x+=nx*f; pb.z+=nz*f;
        push.set(a.id,pa); push.set(b.id,pb); }
    }
  }
  const CAP=0.22;
  for(const e of crowd){ const p=push.get(e.id); if(!p)continue;
    const m=Math.hypot(p.x,p.z); const s=m>CAP?CAP/m:1;
    e.x+=p.x*s; e.z+=p.z*s; }
  // projectiles
  for(const e of st.entities){
    if(e.cat!=='proj'||e.dead)continue;
    e.life-=dt;
    const tgt=byId(st,e.tgt);
    if(!tgt||tgt.dead||e.life<=0){e.dead=true;continue;}
    const dx=tgt.x-e.x,dz=tgt.z-e.z,d=Math.hypot(dx,dz);
    const sp=22*dt;
    if(d<0.8){ dealDamage(st,e,tgt,e.dmg); spawnHit(st,tgt.x,tgt.z);
      if(e.splash>0){ for(const u of st.entities){ if(u.dead||u===tgt||u.owner===e.owner||u.cat==='proj'||u.cat==='res')continue;
        if(Math.hypot(u.x-tgt.x,u.z-tgt.z)<=e.splash) dealDamage(st,e,u,Math.round(e.dmg*0.6)); } }
      e.dead=true; }
    else { e.x+=dx/d*sp; e.z+=dz/d*sp; }
  }
  st.entities=st.entities.filter(e=>!e.dead||(e.deathT??0)>0);
  for(const e of st.entities) if(e.dead&&e.deathT!==undefined) e.deathT-=dt;
  st.entities=st.entities.filter(e=>!(e.dead&&e.cat==='proj')&&!(e.dead&&e.cat==='unit'&&(e.deathT??0)<=0));
  // keep rubble of buildings briefly? remove dead buildings except townhall rubble
  st.entities=st.entities.filter(e=>!(e.dead&&e.cat==='bld'&&e.type!=='townhall'));
}

function spawnHit(st,x,z){ st.events.push({t:'hit',x,z}); }
function nearestEnemy(st,e,range,owner){
  let best=null,bd=range;
  for(const o of st.entities){ if(o.dead||o.owner===owner||o.owner===2)continue; if(o.cat==='proj')continue; if(o.cat==='res')continue;
    const d=Math.hypot(o.x-e.x,o.z-e.z); if(d<bd){bd=d;best=o;} }
  return best;
}

function updateUnit(st,map,e,dt,fm,blocked){
  const o=e.order;
  // auto-acquire for military
  if((e.type==='warrior'||e.type==='archer'||e.type==='mage'||e.type==='knight')&&(!o||o.kind==='move'||o.kind==='idle')){
    if(e.cool<=0){ const tgt=nearestEnemy(st,e,Math.max(4,UNITS[e.type].range||4),e.owner); if(tgt){ e.order={kind:'attack',id:tgt.id}; } }
  }
  if(!o){ e.order={kind:'idle'}; return; }
  if(o.kind==='idle')return;
  if(o.kind==='move'||o.kind==='attackmove'){
    if(!o.path){ o.path=findPath(w2g(e.x),w2g(e.z),w2g(o.x),w2g(o.z),blocked)||[{x:o.x,z:o.z}]; o.pi=0; }
    const wp=o.path[o.pi];
    if(!wp){e.order={kind:'idle'};return;}
    if(moveToward(e,wp,dt)){ o.pi++; if(o.pi>=o.path.length){e.order={kind:'idle'};} }
    if(o.kind==='attackmove'&&e.cool<=0){ const tgt=nearestEnemy(st,e,7,e.owner); if(tgt){e.am={x:o.x,z:o.z};e.order={kind:'attack',id:tgt.id};return;} }
    return;
  }
  if(o.kind==='attack'){
    const tgt=byId(st,o.id);
    if(!tgt||tgt.dead){ if(e.am){ const {x,z}=e.am; e.am=null; e.order={kind:'attackmove',x,z,path:null,pi:0}; } else e.order={kind:'idle'}; return; }
    const range=(UNITS[e.type].range||1.6);
    const d=Math.hypot(tgt.x-e.x,tgt.z-e.z);
    if(d<=range){
      if(e.cool<=0){
        e.cool=e.type==='archer'?1.3:e.type==='mage'?1.6:1.0;
        if(e.type==='archer') fireProjectile(st,e,tgt,e.dmg);
        else if(e.type==='mage') fireProjectile(st,e,tgt,e.dmg,UNITS.mage.splash);
        else { dealDamage(st,e,tgt,e.dmg); st.events.push({t:'hit',x:tgt.x,z:tgt.z}); }
        e.face=tgt;
      }
    } else {
      const path=findPath(w2g(e.x),w2g(e.z),w2g(tgt.x),w2g(tgt.z),blocked)||[{x:tgt.x,z:tgt.z}];
      const wp=path[0];
      // waypoint reached (usually own cell center) → steer straight at the target,
      // otherwise units park out of range forever
      if(!wp||moveToward(e,wp,dt)) moveToward(e,tgt,dt);
      if(Math.hypot(tgt.x-e.x,tgt.z-e.z)>range+14) e.order={kind:'idle'};
    }
    return;
  }
  if(o.kind==='gather'){
    const node=o.node; // {kind:'tree'|'gold', ref}
    const arr=o.kind2==='gold'?map.gold:map.trees;
    const n=arr[o.idx];
    if(!n||n.amount<=0){ // find another
      const ni=findResource(map,e.x,e.z,o.kind2,st);
      if(ni>=0){o.idx=ni;} else {e.order={kind:'idle'};e.carry=null;return;}
      return;
    }
    const d=Math.hypot(n.x-e.x,n.z-e.z);
    if(e.carryAmt>0){ // return home
      const hall=nearestHall(st,e.owner,e.x,e.z);
      if(!hall){e.order={kind:'idle'};return;}
      if(Math.hypot(hall.x-e.x,hall.z-e.z)<4){
        const rkey=o.kind2==='gold'?'gold':'wood';
        const mult=o.kind2==='gold'?(fm.gold??1):(fm.wood??1);
        st.res[e.owner][rkey]+=e.carryAmt*mult; e.carryAmt=0; e.carry=null;
        st.events.push({t:'gather',x:e.x,z:e.z,kind:o.kind2});
      } else moveToward(e,hall,dt);
      return;
    }
    if(d<2.2){ e.gatherT=(e.gatherT||0)+dt; if(e.gatherT>1.2){e.gatherT=0; const take=Math.min(UNITS.peasant.gather,n.amount); n.amount-=take; e.carryAmt=take; e.carry=o.kind2;} }
    else moveToward(e,n,dt);
    return;
  }
  if(o.kind==='build'){
    const b=byId(st,o.id);
    if(!b||b.dead){e.order={kind:'idle'};return;}
    if(Math.hypot(b.x-e.x,b.z-e.z)<b.size+1.5){ b.builder=true; e.building=true; if(b.done){e.order={kind:'idle'};e.building=false;} }
    else { e.building=false; moveToward(e,b,dt); }
    return;
  }
}

function moveToward(e,wp,dt){
  const dx=wp.x-e.x,dz=wp.z-e.z,d=Math.hypot(dx,dz);
  if(d<0.4) return true;
  const sp=(e.speed||5)*dt;
  e.x+=dx/d*Math.min(sp,d); e.z+=dz/d*Math.min(sp,d);
  e.face={x:wp.x,z:wp.z};
  return d<0.6;
}
export function orderMove(st,e,x,z,attack){
  // formation offsets applied by caller
  e.order={kind:attack?'attackmove':'move',x,z,path:null,pi:0}; e.building=false; e.am=null;
}
export function orderAttack(st,e,id){ e.order={kind:'attack',id}; e.building=false; }
export function orderGather(st,map,e,kind2,idx){ e.order={kind:'gather',kind2,idx}; }
export function orderBuild(st,e,id){ e.order={kind:'build',id}; }
export function findResource(map,x,z,kind2,st,maxR=Infinity){
  const arr=kind2==='gold'?map.gold:map.trees;
  let bi=-1,bd=maxR*maxR;
  for(let i=0;i<arr.length;i++){ if(arr[i].amount<=0)continue; const d=(arr[i].x-x)**2+(arr[i].z-z)**2; if(d<bd){bd=d;bi=i;} }
  return bi;
}
export function nearestHall(st,owner,x,z){
  let best=null,bd=1e9;
  for(const e of st.entities){ if(e.dead||e.owner!==owner||e.cat!=='bld')continue; if(e.type!=='townhall'&&e.type!=='farm')continue; if(!e.done)continue; const d=(e.x-x)**2+(e.z-z)**2; if(d<bd){bd=d;best=e;} }
  return best;
}
export function fireProjectile(st,src,tgt,dmg,splash=0){
  addEntity(st,{cat:'proj',owner:src.owner,f:src.f||(src.owner===0?st.playerFaction:st.aiFaction),x:src.x,z:src.z-0.5,tgt:tgt.id,dmg,splash,life:2});
}
