// KINGDOMS RTS — main orchestration (Core loop + UI + Meta).
import * as THREE from 'three';
import { makeState, addEntity, byId, alive, reseedUID, saveGame, loadGame, wipeSave, getProfile, setProfile, popCap, ownerPop, canAfford, pay, WORLD, CELL, GRID } from './core/engine.js';
import { genMap, updateFog } from './world/world.js';
import { tick, spawnBase, orderMove, orderAttack, orderGather, findResource } from './sim/sim.js';
import { aiTick } from './ai/ai.js';
import { FACTIONS, factionMult } from './factions/factions.js';
import { BUILDINGS, UNITS, trainableAt } from './buildings/data.js';
import { Renderer } from './presentation/renderer.js';
import { bindInput } from './presentation/input.js';
import { sfx, setSound } from './presentation/audio.js';

const $=id=>document.getElementById(id);
const view=$('view'), gl=$('gl');

let renderer=null, st=null, map=null, sel=new Set(), running=false, paused=false;
let lastT=0, acc=0, aiAcc=0, saveAcc=0, buildGhost=null;
const AI_ORDER=['undead','goblin','demon','wilde','elf','dwarf','fae'];

// ---- menu ----
function renderFactions(){
  const box=$('factions'); box.innerHTML=''; let cur='human';
  for(const [k,f] of Object.entries(FACTIONS)){
    const d=document.createElement('div'); d.className='faction'+(k===cur?' sel':''); d.innerHTML=`<b>${f.icon} ${f.name}</b>${f.desc}`;
    d.onclick=()=>{ box.querySelectorAll('.faction').forEach(x=>x.classList.remove('sel')); d.classList.add('sel'); box.dataset.sel=k; sfx.select(); };
    box.appendChild(d);
  }
  box.dataset.sel='human';
  const prof=getProfile();
  $('profileLine').textContent=`🏆 Wins ${prof.wins} · Losses ${prof.losses}`+(prof.best?` · Fastest win ${prof.best}`:'')+(prof.ach.length?` · ${prof.ach.join(' ')}`:'');
  $('continueBtn').disabled=!loadGame();
  $('continueBtn').onclick=()=>{ const s=loadGame(); if(s) startFromSave(s); };
  $('wipeBtn').onclick=()=>{ wipeSave(); $('continueBtn').disabled=true; toast('Save wiped'); };
  $('helpBtn').onclick=()=>toast('🧑‍🌾 Peasants gather + build. 🌾 Farm=+6 pop. ⚒️ Barracks=army. Tap enemy=attack. Destroy enemy 🏰!');
  $('startBtn').onclick=()=>startNew(box.dataset.sel||'human');
}
function toast(msg,ms=2600){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display='none',ms); }

// ---- game start ----
function startNew(faction){
  const aiF=AI_ORDER[(Math.random()*AI_ORDER.length)|0];
  st=makeState({faction,aiFaction:aiF,ai:$('ai').value,fog:$('fog').value,speed:$('speed').value});
  setSound($('sound').value);
  map=genMap(st.seed);
  spawnBase(st,map,0,-30,-30,faction);
  spawnBase(st,map,1,30,30,aiF);
  // starting resources near bases already in map; give peasant orders
  updateFog(st,map);
  begin();
  toast(`${FACTIONS[faction].icon} Your kingdom vs ${FACTIONS[aiF].icon} ${FACTIONS[aiF].name} (${st.aiPersona}) — raze their Town Hall!`,4200);
}
function startFromSave(s){
  setSound($('sound').value);
  st=s.st; st.events=[]; st.over=null; reseedUID(st); map={trees:s.map.trees,gold:s.map.gold,explored:[new Uint8Array(GRID*GRID),new Uint8Array(GRID*GRID)],visible:[new Uint8Array(GRID*GRID),new Uint8Array(GRID*GRID)]};
  // rebuild explored approx: mark all explored (simple)
  begin();
}
function begin(){
  $('menu').style.display='none'; $('endcard').style.display='none';
  if(!renderer){ renderer=new Renderer(gl); }
  if(!renderer._bound){ renderer._bound=true; bindInput(view,renderer,game); }
  renderer.buildStatic(map);
  renderer.target.set(-20,0,-20);
  sel=new Set(); running=true; paused=false; lastT=performance.now();
  requestAnimationFrame(loop);
}

const game={
  onTap(e){
    if(!st||st.over)return;
    const r=renderer.renderer.domElement.getBoundingClientRect();
    const nx=((e.clientX-r.left)/r.width)*2-1, ny=-((e.clientY-r.top)/r.height)*2+1;
    const pt=renderer.pick(nx,ny);
    // find entity near tap (player-visible)
    let best=null,bd=2.2;
    for(const en of st.entities){ if(en.dead||en.cat==='proj')continue;
      if(st.fog&&en.owner===1){ const gx=Math.max(0,Math.min(GRID-1,Math.floor(en.x/CELL+GRID/2))),gz=Math.max(0,Math.min(GRID-1,Math.floor(en.z/CELL+GRID/2))); if(!map.visible[0][gz*GRID+gx]&&en.cat!=='bld') continue; }
      const d=Math.hypot(en.x-pt.x,en.z-pt.z)-(en.cat==='bld'?(en.size||2):0);
      if(d<bd){bd=d;best=en;} }
    const mine=[...sel].map(id=>byId(st,id)).filter(u=>u&&!u.dead&&u.owner===0);
    if(best&&best.owner===0){ // select
      sel=new Set([best.id]); sfx.select(); renderSel();
    } else if(best&&best.owner===1){ // attack / target
      if(mine.length){ mine.forEach((u,i)=>{ if(u.cat==='unit'){ if(u.type==='peasant'&&best.cat==='bld')return; orderAttack(st,u,best.id);} }); sfx.move(); toast('⚔️ Attack!'); }
      else { sel=new Set([best.id]); renderSel(); }
    } else if(best&&best.owner===2){ /* resource handled below */ }
    else {
      // resource node near tap?
      let node=null,nk=null,ni=-1;
      const all=[['tree',map.trees],['gold',map.gold]];
      for(const [k,arr] of all) arr.forEach((n,i)=>{ if(n.amount>0&&Math.hypot(n.x-pt.x,n.z-pt.z)<2.5){node=n;nk=k;ni=i;} });
      const peas=mine.filter(u=>u.type==='peasant');
      if(node&&peas.length){ peas.forEach(p=>orderGather(st,map,p,nk==='gold'?'gold':'tree',ni)); sfx.move(); toast(nk==='gold'?'⛏️ Mine gold!':'🪓 Chop wood!'); }
      else if(mine.length&&mine.some(u=>u.cat==='unit')){ // move with formation
        mine.filter(u=>u.cat==='unit').forEach((u,i)=>{ const ox=(i%3-1)*1.8,oz=Math.floor(i/3)*1.8; orderMove(st,u,pt.x+ox,pt.z+oz,false); });
        sfx.move();
      } else if(!best){ sel.clear(); renderSel(); }
    }
  },
  onLongPress(){ // open build menu for selected peasant / show build card
    const mine=[...sel].map(id=>byId(st,id)).filter(u=>u&&!u.dead&&u.owner===0);
    if(mine.some(u=>u.type==='peasant')){ renderSel(true); toast('🔨 Choose a building below'); }
    else toast('Select a Peasant (long-press = build menu)');
  }
};

// ---- selection card / build / train ----
function renderSel(forceBuild=false){
  const card=$('selcard');
  const ents=[...sel].map(id=>byId(st,id)).filter(Boolean).filter(e=>!e.dead);
  if(!ents.length){card.style.display='none';return;}
  card.style.display='block';
  const e=ents[0];
  const fm=factionMult(st.playerFaction);
  let html='';
  if(e.cat==='unit'){
    const U=UNITS[e.type];
    html=`<h3>${U.icon} ${U.name} ${e.owner===1?'(enemy)':''}</h3><p>❤️ ${e.hp|0}/${e.maxHp|0} · 🗡️ ${e.dmg} · ${e.order?('• '+e.order.kind):''}${e.carryAmt?` · carrying ${e.carryAmt} ${e.carry}`:''}</p>`;
    if(e.owner===0){
      html+=`<div class="btnrow">`;
      if(e.type==='peasant') html+=`<button data-a="build">🔨 Build</button><button data-a="wood">🪓 Wood</button><button data-a="gold">⛏️ Gold</button>`;
      html+=`<button data-a="stop">⏹ Stop</button></div><div class="btnrow" data-pane="build" style="display:${forceBuild?'flex':'none'}">`;
      for(const [k,b] of Object.entries(BUILDINGS)){ if(k==='townhall')continue; const c=`${Math.ceil((b.cost.gold||0)*fm.cost)}🪙 ${Math.ceil((b.cost.wood||0)*fm.cost)}🪵`; html+=`<button data-b="${k}">${b.icon} ${b.name}<br><small>${c} · ${b.time}s</small></button>`; }
      html+=`</div>`;
    }
  } else {
    const B=BUILDINGS[e.type];
    html=`<h3>${B.icon} ${B.name} ${e.done?'':`(building ${((e.prog||0)*100)|0}%)`} ${e.owner===1?'(enemy)':''}</h3><p>❤️ ${e.hp|0}/${e.maxHp|0}</p>`;
    if(e.owner===0&&e.done){
      const opts=trainableAt(e.type);
      if(opts.length){ html+=`<div class="btnrow">`; for(const u of opts){ const U=UNITS[u]; const locked=u==='knight'&&!st.entities.some(x=>x.owner===0&&x.type==='blacksmith'&&x.done); html+=`<button data-u="${u}" ${locked?'disabled':''}>${U.icon} ${U.name}<br><small>${Math.ceil(U.cost.gold*fm.cost)}🪙 ${Math.ceil(U.cost.wood*fm.cost)}🪵 ${U.time}s</small></button>`; } html+=`</div>`;
        if(e.queue.length) html+=`<p>Training: ${e.queue.map(q=>UNITS[q].icon).join(' ')} ${(e.prog*100)|0}%</p>`; }
      if(e.type==='townhall') html+=`<p>Train Peasants to boom. Farms raise pop cap.</p>`;
    }
  }
  html+=`<div class="btnrow"><button data-a="pause">${paused?'▶ Resume':'⏸ Pause'}</button><button data-a="save">💾 Save</button><button data-a="menu">Menu</button></div>`;
  card.innerHTML=html;
  card.querySelectorAll('button').forEach(b=>b.onclick=()=>onCardBtn(b,e,forceBuild));
}
function onCardBtn(b,e,forceBuild){
  const fm=factionMult(st.playerFaction);
  const a=b.dataset.a, u=b.dataset.u, bb=b.dataset.b;
  if(a==='stop'){ [...sel].forEach(id=>{const x=byId(st,id); if(x&&x.cat==='unit')x.order={kind:'idle'};}); }
  if(a==='build'){ const p=cardPane(); if(p)p.style.display=p.style.display==='none'?'flex':'none'; }
  if(a==='wood'||a==='gold'){ const kind2=a==='gold'?'gold':'tree'; [...sel].forEach(id=>{const x=byId(st,id); if(x&&x.type==='peasant'){const i=findResource(map,x.x,x.z,kind2,st); if(i>=0)orderGather(st,map,x,kind2,i);}}); sfx.move(); }
  if(a==='pause'){ paused=!paused; toast(paused?'⏸ Paused — SP safe. Tap Resume to continue.':'▶ Resumed'); renderSel(); }
  if(a==='save'){ saveGame(st,map); toast('💾 Saved to device'); }
  if(a==='menu'){ running=false; $('menu').style.display='flex'; renderFactions(); }
  if(u){ const RA=trainableAt(e.type).includes(u); if(!RA)return;
    if(ownerPop(st,0)+UNITS[u].pop>popCap(st,0)){toast('🏠 Build Farms for +pop!');return;}
    if(e.queue.length>=5){toast('Queue full (5)');return;}
    if(!canAfford(st,0,UNITS[u].cost,fm)){toast('Not enough resources');return;}
    pay(st,0,UNITS[u].cost,fm); e.queue.push(u); sfx.build(); }
  if(bb){ // place near selected peasant
    const peas=[...sel].map(id=>byId(st,id)).find(x=>x&&x.type==='peasant'&&x.owner===0);
    if(!peas){toast('Select a Peasant first');return;}
    if(!canAfford(st,0,BUILDINGS[bb].cost,fm)){toast('Not enough resources');return;}
    pay(st,0,BUILDINGS[bb].cost,fm);
    const px=Math.max(-42,Math.min(42,peas.x+4+Math.random()*2)),pz=Math.max(-42,Math.min(42,peas.z+4));
    const nb=addEntity(st,{cat:'bld',type:bb,owner:0,x:px,z:pz,hp:1,maxHp:BUILDINGS[bb].hp*fm.hp,done:false,prog:0,time:BUILDINGS[bb].time/fm.build,builder:false,size:BUILDINGS[bb].size,sight:BUILDINGS[bb].sight,armor:1,queue:[],cool:0});
    const {orderBuild}=window.__k||{};
    peas.order={kind:'build',id:nb.id};
    sfx.build(); toast(`${BUILDINGS[bb].icon} ${BUILDINGS[bb].name} placed — peasant on the way!`);
    sel=new Set([nb.id]);
  }
  renderSel();
}
function cardPane(){ return document.querySelector('#selcard [data-pane="build"]'); }

// ---- HUD + minimap ----
const mm=$('minimap').getContext('2d');
function hud(){
  const r=st.res[0];
  $('r-gold').textContent=`${r.gold|0}`; $('r-wood').textContent=`${r.wood|0}`; $('r-food').textContent=`${r.food|0}`;
  $('r-pop').textContent=`${ownerPop(st,0)}/${popCap(st,0)}`;
  $('r-army').textContent=`${st.entities.filter(e=>e.owner===0&&e.cat==='unit'&&e.type!=='peasant'&&!e.dead).length}`;
  const m=(st.t/60)|0,s=(st.t%60)|0; $('timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} · ${st.aiPersona}`;
  // minimap
  mm.fillStyle='#0c0a06'; mm.fillRect(0,0,132,132);
  const px=v=>((v+48)/96)*132;
  mm.fillStyle='#3a5f2a'; for(let i=0;i<map.trees.length;i+=3){const t=map.trees[i]; if(t.amount>0){mm.fillStyle='#2c6e31'; mm.fillRect(px(t.x),px(t.z),2,2);}}
  mm.fillStyle='#f5c542'; for(const g of map.gold){ if(g.amount>0)mm.fillRect(px(g.x)-1,px(g.z)-1,3,3); }
  for(const e of st.entities){ if(e.dead)continue; if(st.fog&&e.owner===1){const gx=Math.floor(e.x/CELL+GRID/2),gz=Math.floor(e.z/CELL+GRID/2); if(gx<0||gz<0||gx>=GRID||gz>=GRID||!map.visible[0][gz*GRID+gx])continue;}
    mm.fillStyle=e.owner===0?(e.cat==='bld'?'#4da3ff':'#9fd0ff'):(e.cat==='bld'?'#ff5b5b':'#ffb09f');
    mm.fillRect(px(e.x)-1,px(e.z)-1,e.cat==='bld'?4:2,e.cat==='bld'?4:2); }
  mm.strokeStyle='#fff6'; mm.strokeRect(0.5,0.5,131,131);
}

// ---- main loop: fixed 10Hz sim + render ----
function loop(now){
  if(!running)return;
  requestAnimationFrame(loop);
  let dt=(now-lastT)/1000; lastT=now; dt=Math.min(dt,0.1);
  const time=now/1000;
  if(!paused&&!st.over){
    acc+=dt*st.speed;
    const STEP=0.1; let n=0;
    while(acc>=STEP&&n<5){ tick(st,map,STEP); st.events.forEach(ev=>{ if(ev.t==='hit')renderer.hit(ev.x,ev.z); if(ev.t==='gather'){ if(ev.kind==='gold')sfx.coin(); else sfx.chop(); } if(ev.t==='toast')toast(ev.msg); }); acc-=STEP; n++;
      aiAcc+=STEP; if(aiAcc>2){aiAcc=0; try{aiTick(st,map);}catch(err){console.warn(err);} }
    }
    saveAcc+=dt; if(saveAcc>15){saveAcc=0; saveGame(st,map);}
  }
  renderer.sync(st,map,sel,time);
  hud();
  if(st.tick%10===0) renderSelLive();
  if(st.over&&!st._end){ st._end=true; endGame(st.over.win,st.over.draw); }
}
let selLive=0, lastSig='';
function renderSelLive(){ // rebuild at ~1Hz only when something visible changed (never steal a tap)
  if(++selLive%10!==0)return;
  if($('selcard').style.display==='none'||!sel.size) return;
  const e=[...sel].map(id=>byId(st,id)).find(x=>x&&!x.dead);
  if(!e) return;
  const sig=[e.id,e.hp|0,(e.prog||0).toFixed(1),(e.queue||[]).length,(e.done?1:0),st.res[0].gold|0,st.res[0].wood|0,paused?'p':''].join('|');
  if(sig===lastSig) return; lastSig=sig;
  const paneOpen=!!document.querySelector('#selcard [data-pane="build"]')&&document.querySelector('#selcard [data-pane="build"]').style.display!=='none';
  renderSel(paneOpen);
}
function endGame(win,draw){
  const prof=getProfile();
  if(win){prof.wins++; sfx.win(); if(!prof.best||st.t<parseT(prof.best))prof.best=fmt(st.t); addAch(prof,'👑');}
  else {prof.losses++; sfx.lose();}
  if(st.firstBlood) addAch(prof,'🩸');
  if(st.stats.kills[0]>=20) addAch(prof,'⚔️20');
  setProfile(prof);
  $('endTitle').textContent=draw?'Draw!':win?'🏆 Victory!':'💀 Defeat';
  $('endSub').textContent=draw?'Both halls fell.':win?`Enemy Town Hall razed in ${fmt(st.t)}! Kills ${st.stats.kills[0]}–${st.stats.kills[1]}.`:`Your Town Hall fell at ${fmt(st.t)}. Kills ${st.stats.kills[0]}–${st.stats.kills[1]}. Try ${st.aiPersona==='aggressor'?'turtling with Towers':'scouting earlier'}!`;
  $('endcard').style.display='flex';
  $('againBtn').onclick=()=>{location.reload();};
  $('menuBtn').onclick=()=>{ $('endcard').style.display='none'; $('menu').style.display='flex'; running=false; renderFactions(); };
}
function fmt(t){return `${String((t/60)|0).padStart(2,'0')}:${String((t%60)|0).padStart(2,'0')}`;}
function parseT(s){const[a,b]=s.split(':').map(Number);return a*60+b;}
function addAch(p,a){if(!p.ach.includes(a))p.ach.push(a);}

// expose for build-order helper
window.__k={};
// debug/testing handle
window.__game={ get st(){return st;}, get map(){return map;}, get sel(){return sel;}, get renderer(){return renderer;} };

// ---- boot ----
$('againBtn').onclick=()=>location.reload();
renderFactions();
// Ambient demo scene behind menu so first paint is never black
try{
  st=makeState({faction:'human',aiFaction:'undead',ai:'expander',fog:'off',speed:1});
  map=genMap(12345);
  spawnBase(st,map,0,-30,-30,'human');
  spawnBase(st,map,1,30,30,'undead');
  updateFog(st,map);
  renderer=new Renderer(gl); renderer.buildStatic(map);
  renderer.target.set(0,0,0); renderer.dist=85;
  const demoT0=performance.now();
  (function paint(){ if(!running){ const t=(performance.now()-demoT0)/1000;
    try{ renderer.target.x=Math.sin(t*0.1)*10; renderer.target.z=Math.cos(t*0.08)*10;
    renderer.sync(st,map,new Set(),t); }catch{} requestAnimationFrame(paint); } })();
}catch(e){ console.warn('demo bg failed',e); }
