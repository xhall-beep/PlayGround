// Simulation tick: economy (gather/build/produce), military (combat/projectiles), orders, navigation.
import { addEntity, byId, alive, dist, eachNear, dealDamage, popCap, pay, canAfford, w2g, WORLD } from '../core/engine.js';
import { BUILDINGS, UNITS, trainableAt } from '../buildings/data.js';
import { factionMult } from '../factions/factions.js';
import { findPath, buildBlocked, updateFog } from '../world/world.js';
import { useAbility } from './abilities.js';
import { heroFor } from '../factions/heroes.js';

export function spawnBase(st,map,owner,fx,fz,faction){
  const fm=factionMult(faction);
  const thHp=1600*fm.hp*(fm.bldHp??1);
  const th=addEntity(st,{cat:'bld',type:'townhall',owner,faction,x:fx,z:fz,hp:thHp,maxHp:thHp,done:true,size:3.4,sight:12,armor:2,queue:[],prog:0});
  for(let i=0;i<2;i++) addEntity(st,{cat:'unit',type:'peasant',owner,faction,x:fx+4+i*2.5,z:fz+4,hp:70*fm.hp,maxHp:70*fm.hp,dmg:4,armor:0,speed:5.2,sight:9,armorPierce:0,order:null,carry:null,carryAmt:0,cool:0});
  return th;
}

let blockedCache=null, blockedTick=-1;
export function tick(st,map,dt){
  st.events=[];
  st.t+=dt; st.tick++;
  const fm=[factionMult(st.playerFaction),factionMult(st.aiFaction)];
  if(st.tick%20===0) updateFog(st,map);
  if(blockedTick!==st.tick){ blockedCache=buildBlocked(st,map); blockedTick=st.tick; }

  // economy trickle: farms give food (halved in winter)
  if(st.tick%50===0){ for(let o=0;o<2;o++){ const farms=st.entities.filter(e=>e.owner===o&&e.type==='farm'&&e.done&&alive(e)).length; st.res[o].food+=farms*(st.season==='winter'?0.5:1); }
    // Wilde signature: the forest regrows under their care — except in winter.
    if(st.season!=='winter'&&(fm[0].regrow||fm[1].regrow)){ for(const tr of map.trees){ if(tr.amount>0&&tr.amount<180) tr.amount=Math.min(180,tr.amount+2); } }
  }
  // Three Bells pacing: 3:00 raid, 6:00 turn, 9:00 war. Tutorial has no clock.
  const bellAt=st.tutorial?undefined:[180,360,540][st.bells||0];
  if(bellAt!==undefined&&st.t>=bellAt){
    st.bells=(st.bells||0)+1;
    const msg=st.bells===1?'🔔 First Bell — the raid begins!':st.bells===2?'🔔 Second Bell — the map turns.':'🔔 Third Bell — war without end!';
    st.events.push({t:'toast',msg});
    st.events.push({t:'bell',n:st.bells});
    if(st.bells===2){
      st.season='winter';
      st.events.push({t:'season',season:'winter'});
      if(!st.heroSpawned){ st.heroSpawned=true; spawnHero(st,0); spawnHero(st,1); }
    }
  }
  // Wild-wrath decays when the axes rest.
  if(!st.tutorial){ for(let o=0;o<2;o++) st.wrath[o]=Math.max(0,(st.wrath[o]||0)-0.15*dt); }

  for(const e of st.entities){
    if(e.dead) continue;
    if(e.flash>0)e.flash-=dt;
    if(e.cat==='bld'){
      if(e.repair>0){ e.repair-=dt; e.hp=Math.min(e.maxHp,e.hp+e.repairRate*dt); }
      // construction progress
      if(!e.done){ e.prog+=(dt/e.time)*(e.builder?1:0.15); if(e.prog>=1){e.done=true;e.prog=1;e.hp=e.maxHp;st.events.push({t:'toast',msg:`${e.owner===0?'✅':'🏗️'} ${BUILDINGS[e.type].name} ${e.owner===0?'ready!':'built by enemy!'}`});} continue; }
      // production queue
      if(e.queue&&e.queue.length){
        const u=e.queue[0]; e.prog+=dt*(fm[e.owner].produce??1)/UNITS[u].time;
        if(e.prog>=1){ e.queue.shift(); e.prog=0;
          const f=fm[e.owner];
          addEntity(st,{cat:'unit',type:u,owner:e.owner,faction:e.faction,x:e.x+2.5,z:e.z+2.5,hp:UNITS[u].hp*f.hp,maxHp:UNITS[u].hp*f.hp,dmg:UNITS[u].dmg*(u==='archer'?(f.archer??f.dmg):f.dmg)*(e.buffDmg||1),armor:UNITS[u].armor,range:UNITS[u].range,speed:UNITS[u].speed*f.speed,sight:UNITS[u].sight,armorPierce:UNITS[u].armorPierce||0,order:null,carry:null,carryAmt:0,cool:0});
        }
      }
      // tower shooting
      if(e.type==='tower'){ e.cool=(e.cool||0)-dt; if(e.cool<=0){ const tgt=nearestEnemy(st,e,BUILDINGS.tower.range,e.owner); if(tgt){ e.cool=1.4; fireProjectile(st,e,tgt,BUILDINGS.tower.dmg*fm[e.owner].dmg);} } }
      // blacksmith instant buff
      if(e.type==='blacksmith'&&!e.applied){ e.applied=true; for(const u of st.entities) if(u.owner===e.owner&&u.cat==='unit'){u.dmg+=2;u.maxHp+=20;u.hp+=20;} }
    } else {
      // unit AI: abilities, buffs, burn, regen, then movement/combat
      if(e.abilityCd>0) e.abilityCd-=dt;
      if(e.buff){ for(const k in e.buff){ e.buff[k]-=dt; if(e.buff[k]<=0) delete e.buff[k]; } }
      if(e.burn&&e.burn.t>0){
        e.burn.t-=dt; e.hp-=e.burn.dps*dt;
        if(e.hp<=0){ e.hp=0; e.dead=true; e.deathT=0.6; continue; }
      }
      const efm=fm[e.owner]||{};
      if(efm.regen&&e.hp<e.maxHp){
        let threat=false;
        for(const o of st.entities){
          if(o.dead||o.owner===e.owner||o.owner===2||o.cat==='proj') continue;
          if(Math.hypot(o.x-e.x,o.z-e.z)<9){ threat=true; break; }
        }
        if(!threat) e.hp=Math.min(e.maxHp,e.hp+efm.regen*dt);
      }
      if(e.root>0) e.root-=dt;
      if(e.owner===2){
        // Neutral treants punish the kingdom that chopped too much; units first.
        e.retarget=(e.retarget??0)-dt;
        if(e.retarget<=0){
          e.retarget=1.5; let unit=null,ud=20,bld=null,bd=14;
          for(const o of st.entities){
            if(o.dead||(o.owner!==0&&o.owner!==1))continue;
            if(e.wildOwner!==undefined&&o.owner!==e.wildOwner)continue;
            const d=Math.hypot(o.x-e.x,o.z-e.z);
            if(o.cat==='unit'&&d<ud){ud=d;unit=o;}
            else if(o.cat==='bld'&&d<bd){bd=d;bld=o;}
          }
          const best=unit||bld;
          if(best) e.order={kind:'attack',id:best.id};
        }
      }
      if(e.owner===1&&(e.abilityCd||0)<=0&&(e.type==='warrior'||e.type==='archer'||e.type==='knight'||e.type==='hero')){
        if(nearestEnemy(st,e,10,e.owner)) useAbility(st,e);
      }
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
  // projectiles
  for(const e of st.entities){
    if(e.cat!=='proj'||e.dead)continue;
    e.life-=dt;
    const tgt=byId(st,e.tgt);
    if(!tgt||tgt.dead||e.life<=0){e.dead=true;continue;}
    const dx=tgt.x-e.x,dz=tgt.z-e.z,d=Math.hypot(dx,dz);
    const sp=22*dt;
    if(d<0.8){ dealDamage(st,e,tgt,e.dmg); e.dead=true; spawnHit(st,tgt.x,tgt.z); }
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
  for(const o of st.entities){ if(o.dead||o.owner===owner||o.cat==='proj'||o.cat==='res')continue;
    const d=Math.hypot(o.x-e.x,o.z-e.z); if(d<bd){bd=d;best=o;} }
  return best;
}

function updateUnit(st,map,e,dt,fm,blocked){
  const o=e.order;
  // auto-acquire for military
  if((e.type==='warrior'||e.type==='archer'||e.type==='knight'||e.type==='skeleton'||e.type==='hero')&&(!o||o.kind==='move'||o.kind==='idle')){
    if(e.cool<=0){ const tgt=nearestEnemy(st,e,(e.type==='archer'?9:4)*(e.type==='archer'?(fm.range??1):1),e.owner); if(tgt){ e.order={kind:'attack',id:tgt.id}; } }
  }
  if(!o){ e.order={kind:'idle'}; return; }
  if(o.kind==='idle')return;
  if(o.kind==='move'||o.kind==='attackmove'){
    if(!o.path){ o.path=findPath(w2g(e.x),w2g(e.z),w2g(o.x),w2g(o.z),blocked)||[{x:o.x,z:o.z}]; o.pi=0; }
    const wp=o.path[o.pi];
    if(!wp){e.order={kind:'idle'};return;}
    if(moveToward(e,wp,dt)){ o.pi++; if(o.pi>=o.path.length){e.order={kind:'idle'};} }
    if(o.kind==='attackmove'&&e.cool<=0){ const tgt=nearestEnemy(st,e,7,e.owner); if(tgt){e.order={kind:'attack',id:tgt.id};return;} }
    return;
  }
  if(o.kind==='attack'){
    const tgt=byId(st,o.id);
    if(!tgt||tgt.dead){e.order={kind:'idle'};return;}
    const range=(UNITS[e.type].range||1.6)*(e.type==='archer'?(fm.range??1):1);
    const reach=range+(tgt.cat==='bld'?(tgt.size||0):0);
    const d=Math.hypot(tgt.x-e.x,tgt.z-e.z);
    if(d<=reach){
      if(e.cool<=0){
        e.cool=e.type==='archer'?1.3:1.0;
        let dmg=e.dmg;
        if(e.chargeHit){ dmg*=1.5; e.chargeHit=false; }
        if(e.type==='archer') fireProjectile(st,e,tgt,dmg);
        else { dealDamage(st,e,tgt,dmg); st.events.push({t:'hit',x:tgt.x,z:tgt.z}); }
        e.face=tgt;
      }
    } else {
      if(!o.path||(o.chaseT??0)<=0){
        o.path=findPath(w2g(e.x),w2g(e.z),w2g(tgt.x),w2g(tgt.z),blocked)||[{x:tgt.x,z:tgt.z}];
        o.pi=0; o.chaseT=0.5;
      }
      o.chaseT-=dt;
      const wp=o.path[o.pi];
      if(wp&&moveToward(e,wp,dt)){ o.pi++; if(o.pi>=o.path.length){o.path=null;o.chaseT=0;} }
      if(Math.hypot(tgt.x-e.x,tgt.z-e.z)>reach+14) e.order={kind:'idle'};
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
        const mult=(o.kind2==='gold'?(fm.gold??1):(fm.wood??1))*(fm.gather??1);
        st.res[e.owner][rkey]+=e.carryAmt*mult; e.carryAmt=0; e.carry=null;
        st.events.push({t:'gather',x:e.x,z:e.z,kind:o.kind2});
      } else moveToward(e,hall,dt);
      return;
    }
    if(d<2.2){ e.gatherT=(e.gatherT||0)+dt; if(e.gatherT>1.2){e.gatherT=0; const take=Math.min(UNITS.peasant.gather,n.amount); n.amount-=take; e.carryAmt=take; e.carry=o.kind2;
      if(o.kind2==='tree'&&!st.tutorial) addWrath(st,e,take); } }
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
  if(e.root>0) return false;
  const dx=wp.x-e.x,dz=wp.z-e.z,d=Math.hypot(dx,dz);
  if(d<0.4) return true;
  const sp=(e.speed||5)*(e.buff?.charge>0?2.2:1)*dt;
  e.x+=dx/d*Math.min(sp,d); e.z+=dz/d*Math.min(sp,d);
  e.face={x:wp.x,z:wp.z};
  return d<0.6;
}
export function orderMove(st,e,x,z,attack){
  // formation offsets applied by caller
  e.order={kind:attack?'attackmove':'move',x,z,path:null,pi:0}; e.building=false;
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
export function spawnHero(st,owner){
  const th=st.entities.find(e=>!e.dead&&e.owner===owner&&e.type==='townhall');
  if(!th) return null;
  const fac=owner===0?st.playerFaction:st.aiFaction, fm=factionMult(fac), u=UNITS.hero, H=heroFor(fac);
  const hp=u.hp*fm.hp, dmg=u.dmg*fm.dmg;
  const hero=addEntity(st,{cat:'unit',type:'hero',owner,faction:fac,heroName:H.name,x:th.x+4,z:th.z-4,hp,maxHp:hp,dmg,armor:u.armor,range:u.range,speed:u.speed*(fm.speed??1),sight:u.sight,armorPierce:u.armorPierce||0,level:1,xp:0,order:null,carry:null,carryAmt:0,cool:0});
  st.events.push({t:'toast',msg:owner===0?`👑 ${H.name} answers your call!`:`👑 Enemy ${H.name} takes the field!`});
  return hero;
}
export function addWrath(st,e,take){
  const fk=e.owner===0?st.playerFaction:st.aiFaction;
  st.wrath[e.owner]=Math.min(100,(st.wrath[e.owner]||0)+take*(fk==='elf'?0.05:0.1));
  const old=st.wrathTier[e.owner]||0, tier=Math.floor(st.wrath[e.owner]/25);
  if(tier>old){ st.wrathTier[e.owner]=tier; spawnTreants(st,e,tier-old); }
}
export function spawnTreants(st,src,n){
  const live=st.entities.filter(e=>e.owner===2&&e.type==='treant'&&!e.dead).length;
  const u=UNITS.treant;
  for(let i=0;i<n&&live+i<8;i++){
    const a=Math.random()*Math.PI*2, r=3+Math.random()*3;
    addEntity(st,{cat:'unit',type:'treant',owner:2,wildOwner:src.owner,x:src.x+Math.cos(a)*r,z:src.z+Math.sin(a)*r,hp:u.hp,maxHp:u.hp,dmg:u.dmg,armor:u.armor,range:u.range,speed:u.speed,sight:u.sight,armorPierce:0,order:{kind:'attack',id:src.id},carry:null,carryAmt:0,cool:0});
  }
  st.events.push({t:'toast',msg:'🌲 The wild sends treants!'});
}
export function fireProjectile(st,src,tgt,dmg){
  st.entities.push({id:(Math.random()*1e9)|0,cat:'proj',owner:src.owner,x:src.x,z:src.z-0.5,tgt:tgt.id,dmg,life:2,armorPierce:src.armorPierce||0});
}
