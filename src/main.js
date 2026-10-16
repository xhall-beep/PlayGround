// KINGDOMS RTS — main orchestration (Core loop + UI + Meta).
import * as THREE from 'three';
import { makeState, addEntity, byId, alive, reseedUID, saveGame, loadGame, wipeSave, getProfile, setProfile, popCap, ownerPop, canAfford, pay, WORLD, CELL, GRID } from './core/engine.js';
import { genMap, updateFog } from './world/world.js';
import { tick, spawnBase, orderMove, orderAttack, orderGather, findResource, castSpecial } from './sim/sim.js';
import { aiTick } from './ai/ai.js';
import { FACTIONS, factionMult, CORE_FACTIONS, EXPANSION_FACTIONS, coreFaction } from './factions/factions.js';
import { BUILDINGS, UNITS, trainableAt } from './buildings/data.js';
import { Renderer } from './presentation/renderer.js';
import { bindInput } from './presentation/input.js';
import { sfx, setSound } from './presentation/audio.js';
import { MISSION1, MissionRunner, makeCtx, scenarioForMission1, markMissionComplete } from './missions/mission1.js';
import { TutorialUI } from './missions/tutorial-ui.js';

const $=id=>document.getElementById(id);
const view=$('view'), gl=$('gl');
const BUILD='v0.5.0';

// ---- crash visibility: never let a phone die silently ----
function showErr(msg){ const b=$('errbox'); if(!b)return; $('errmsg').textContent=String(msg); b.style.display='block'; }
addEventListener('error',e=>showErr(`${e.message||e.error||'error'}${e.filename?`\n${e.filename}:${e.lineno||0}`:''}`));
addEventListener('unhandledrejection',e=>showErr(`Unhandled promise: ${(e.reason&&e.reason.message)||e.reason}`));
$('errclose').onclick=()=>{ $('errbox').style.display='none'; };

let renderer=null, st=null, map=null, sel=new Set(), running=false, paused=false;
let lastT=0, acc=0, aiAcc=0, saveAcc=0, uiAcc=0, selAcc=0, buildGhost=null;
let lastPat=null, perfFrames=0, perfT=0;
let mission=null, tut=null, tutUI=null;
const AI_ORDER=['orc','undead','elf','human'];

// ---- faction-reactive UI skin: data-faction theme + procedural SVG corners ----
const FACTION_CORNERS={
human:`<svg viewBox="0 0 32 32" fill="none"><path d="M2 30V10Q2 2 10 2h20" stroke="#e2e8f0" stroke-width="3"/><path d="M7 30V12Q7 7 12 7h18" stroke="#1d4ed8" stroke-width="1.6"/><rect x="4" y="4" width="7" height="7" transform="rotate(45 7.5 7.5)" fill="#e2e8f0"/></svg>`,
orc:`<svg viewBox="0 0 32 32" fill="none"><path d="M2 30V20l6 1-2-8 6 2-2-7 6 1-1-7h15" stroke="#dc2626" stroke-width="2.6"/><path d="M7 30v-6l5 1-1-6 5 1-1-5 4 1V7h11" stroke="#78350f" stroke-width="1.4"/></svg>`,
undead:`<svg viewBox="0 0 32 32" fill="none"><path d="M30 4A26 26 0 0 1 4 30M30 4A18 18 0 0 1 12 30M30 4A10 10 0 0 1 20 30" stroke="#d6d3d1" stroke-width="1.5"/><path d="M4 4l26 0M4 4l18 18M4 4l0 26" stroke="#d6d3d1" stroke-width="1.2"/><path d="M30 4A22 22 0 0 1 8 30" stroke="#a855f7" stroke-width="1.6"/></svg>`,
elf:`<svg viewBox="0 0 32 32" fill="none"><path d="M3 29Q5 10 29 5" stroke="#065f46" stroke-width="2.6"/><ellipse cx="11" cy="19" rx="4.5" ry="2.2" transform="rotate(-38 11 19)" fill="#fbbf24"/><ellipse cx="19" cy="11" rx="4.5" ry="2.2" transform="rotate(-38 19 11)" fill="#8fd694"/><circle cx="24" cy="7" r="1.8" fill="#fbbf24"/></svg>`};
function applyFactionTheme(f){
  const key=coreFaction(f);
  document.documentElement.dataset.faction=key;
  document.body.dataset.faction=key;
  const art=FACTION_CORNERS[key]||'';
  document.querySelectorAll('.cnr').forEach(el=>{ el.innerHTML=art; });
  return key;
}

// ---- menu ----
function renderFactions(){
  const box=$('factions'); box.innerHTML=''; let cur=coreFaction(box.dataset.sel||'human');
  for(const k of CORE_FACTIONS){ const f=FACTIONS[k];
    const d=document.createElement('div'); d.className='faction'+(k===cur?' sel':''); d.innerHTML=`<b>${f.icon} ${f.name}</b><i>${f.title}</i>${f.desc}`;
    d.onclick=()=>{ applyFactionTheme(k); box.querySelectorAll('.faction').forEach(x=>x.classList.remove('sel')); d.classList.add('sel'); box.dataset.sel=k; sfx.select(); };
    box.appendChild(d);
  }
  box.dataset.sel=cur;
  const ex=document.createElement('div'); ex.id='expansionRow';
  ex.innerHTML=`<b>🔒 Expansion Factions — Coming Soon</b><span>${EXPANSION_FACTIONS.map(k=>`${FACTIONS[k].icon} ${FACTIONS[k].name}`).join(' · ')}</span>`;
  ex.onclick=()=>toast('🔒 Expansion factions are coming soon — Human, Orc, Undead and Elf are playable now.');
  box.appendChild(ex);
  applyFactionTheme(cur);
  const prof=getProfile();
  $('profileLine').textContent=`🏆 Wins ${prof.wins} · Losses ${prof.losses}`+(prof.best?` · Fastest win ${prof.best}`:'')+(prof.ach.length?` · ${prof.ach.join(' ')}`:'');
  $('continueBtn').disabled=!loadGame();
  $('continueBtn').onclick=()=>{ const s=loadGame(); if(s) startFromSave(s); };
  $('wipeBtn').onclick=()=>{ wipeSave(); $('continueBtn').disabled=true; toast('Save wiped'); };
  $('helpBtn').onclick=()=>toast('🧑‍🌾 Peasants gather + build. 🌾 Farm=+6 pop. ⚒️ Barracks=army. Tap enemy=attack. Destroy enemy 🏰!');
  $('startBtn').onclick=()=>startNew(box.dataset.sel||'human');
  $('mission1Btn').onclick=()=>startMission1();
}
function toast(msg,ms=2600){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display='none',ms); }

// ---- Mission 1: tutorial mode (no enemies, no fail state) ----
function startMission1(){
  setSound($('sound').value);
  const sc=scenarioForMission1((Math.random()*1e9)|0);
  st=makeState({faction:'human',aiFaction:'undead',ai:'expander',fog:'off',speed:1});
  st.tutorial=true;
  st.res[0].gold=400; st.res[0].wood=320; st.res[0].food=6;
  map=genTutMap(sc.seed);
  spawnBase(st,map,0,sc.spawn.x,sc.spawn.z,'human');
  mission=new MissionRunner(MISSION1);
  tutUI=tutUI||new TutorialUI(document);
  tutUI.onSkip=()=>exitTutorial();
  tutUI.onDone=()=>exitTutorial();
  begin(true);
  renderer.addBaseDecal(sc.spawn.x,sc.spawn.z,'human');
  applyFactionTheme('human');
  tutUI.show();
  tutUI.update(mission,makeCtx(st,map,sel,mission.history,0));
  toast('🌲 Welcome to Greenvale — nobody will attack you here.',3600);
}
function genTutMap(seed){
  // One clearing ringed with trees so gathering is one tap away. Nodes sit close
  // to the hall: the fixed phone camera shows roughly a 20-unit disc.
  const m=genMap(seed);
  m.trees=m.trees.filter(t=>Math.hypot(t.x,t.z)>13);
  const ring=17;
  for(let i=0;i<24;i++){ const a=(i/24)*Math.PI*2+0.2; m.trees.push({x:Math.cos(a)*ring+(i%2?2:-2),z:Math.sin(a)*ring,amount:180,phase:i}); }
  for(let i=0;i<6;i++){ const a=(i/6)*Math.PI*2+0.9; m.gold.push({x:Math.cos(a)*14,z:Math.sin(a)*14,amount:900}); }
  // Start trees sit opposite the camera axis (+x+z) so nothing occludes the base.
  m.trees.push({x:-9,z:7,amount:260},{x:8,z:-8,amount:260},{x:-7,z:-10,amount:260});
  return m;
}
function exitTutorial(){
  if(!tutUI)return;
  document.body.classList.remove('tut');
  tutUI.hide(); renderer&&renderer.setFixedCamera(false); renderer&&renderer.setCoachMark(null);
  mission=null;
  $('menu').style.display='flex'; running=false; renderFactions();
}
// Tutorial assist: when a step starts, select what it needs and pull peasants
// back into the clearing so the fixed camera keeps them reachable by thumb.
function missionAssist(stepId){
  if(!stepId) return;
  const peas=st.entities.filter(e=>!e.dead&&e.owner===0&&e.type==='peasant');
  const hall=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='townhall');
  const near=(a,b)=>({x:a.x+(b.x-a.x)*0.5,z:a.z+(b.z-a.z)*0.5});
  if(stepId==='build-farm'||stepId==='build-barracks'||stepId==='build-barracks-site'){
    const p=peas.sort((a,b)=>Math.hypot(a.x-(hall?.x??0),a.z-(hall?.z??0))-Math.hypot(b.x-(hall?.x??0),b.z-(hall?.z??0)))[0];
    if(p){ const dest=hall?near(p,hall):{x:p.x,z:p.z+4}; orderMove(st,p,dest.x,dest.z,false); sel=new Set([p.id]); renderSel(true); }
  } else if(stepId==='train-peasant'){
    if(hall) sel=new Set([hall.id]);
  } else if(stepId==='train-warrior'){
    const r=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='barracks'&&e.done);
    if(r) sel=new Set([r.id]);
  } else if(stepId==='move-army'){
    const w=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='warrior');
    if(w) sel=new Set([w.id]);
  }
  renderSel();
}
function updateCoachMark(){
  if(!mission||!mission.current||!renderer) return;
  const m=mission.current.mark;
  let target=null;
  const near=(list,r=1e9)=>list.sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
  if(m==='peasant'){ const p=near(st.entities.filter(e=>!e.dead&&e.owner===0&&e.type==='peasant')); if(p)target={x:p.x,z:p.z,radius:1.2,height:4.0}; }
  else if(m==='townhall'){ const b=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='townhall'); if(b)target={x:b.x,z:b.z,radius:2.4,height:6.2}; }
  else if(m==='barracks'){ const b=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='barracks'); if(b)target={x:b.x,z:b.z,radius:2.0,height:5.4}; }
  else if(m==='barracks-site'){ const b=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='barracks'); if(b)target={x:b.x,z:b.z,radius:2.0,height:5.4};
    else { const p=near(st.entities.filter(e=>!e.dead&&e.owner===0&&e.type==='peasant')); if(p)target={x:p.x,z:p.z,radius:1.2,height:4.0}; } }
  else if(m==='warrior'){ const w=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='warrior'); if(w)target={x:w.x,z:w.z,radius:1.2,height:4.0}; }
  if(target) renderer.setCoachMark(target); else renderer.setCoachMark(null);
}

// ---- game start ----
function startNew(faction){
  faction=coreFaction(faction);
  const foes=AI_ORDER.filter(f=>f!==faction);
  const aiF=foes[(Math.random()*foes.length)|0];
  st=makeState({faction,aiFaction:aiF,ai:$('ai').value,fog:$('fog').value,speed:$('speed').value});
  setSound($('sound').value);
  map=genMap(st.seed);
  spawnBase(st,map,0,-30,-30,faction);
  spawnBase(st,map,1,30,30,aiF);
  // starting resources near bases already in map; give peasant orders
  updateFog(st,map);
  begin();
  renderer.addBaseDecal(-30,-30,faction);
  renderer.addBaseDecal(30,30,aiF);
  applyFactionTheme(faction);
  toast(`${FACTIONS[faction].icon} Your kingdom vs ${FACTIONS[aiF].icon} ${FACTIONS[aiF].name} (${st.aiPersona}) — raze their Town Hall!`,4200);
}
function startFromSave(s){
  setSound($('sound').value);
  st=s.st; st.events=[]; st.over=null; reseedUID(st); map={trees:s.map.trees,gold:s.map.gold,explored:[new Uint8Array(GRID*GRID),new Uint8Array(GRID*GRID)],visible:[new Uint8Array(GRID*GRID),new Uint8Array(GRID*GRID)]};
  // rebuild explored approx: mark all explored (simple)
  begin();
  for(const e of st.entities) if(e.cat==='bld'&&e.type==='townhall'&&!e.dead) renderer.addBaseDecal(e.x,e.z,e.owner===0?st.playerFaction:st.aiFaction);
  applyFactionTheme(st.playerFaction);
}
function begin(isTutorial=false){
  $('menu').style.display='none'; $('endcard').style.display='none';
  document.body.classList.toggle('tut',isTutorial);
  if(!renderer){ renderer=new Renderer(gl); }
  if(!renderer._bound){ renderer._bound=true; bindInput(view,renderer,game); }
  renderer.buildStatic(map);
  if(isTutorial){
    // Fixed framing sized to the device: portrait phones pull in and centre the
    // hall; landscape keeps more of the clearing visible. The camera never moves.
    const aspect=(view.clientWidth||1)/Math.max(1,view.clientHeight||1);
    renderer.setFixedCamera(true,0,0,renderer.camDistFor(aspect));
  } else { renderer.setFixedCamera(false); renderer.target.set(-20,0,-20); }
  sel=new Set(); running=true; paused=false; lastT=performance.now(); acc=0; uiAcc=0; selAcc=0;
  requestAnimationFrame(loop);
}

const game={
  isCameraLocked(){ return !!(st&&st.tutorial); },
  onTap(e){
    if(!st||st.over)return;
    const r=renderer.renderer.domElement.getBoundingClientRect();
    const nx=((e.clientX-r.left)/r.width)*2-1, ny=-((e.clientY-r.top)/r.height)*2+1;
    const pt=renderer.pick(nx,ny);
    // A tap that projects off the map (edge of screen, skewed aspect) must never
    // become a move order to nowhere.
    if(!pt||!isFinite(pt.x)||!isFinite(pt.z)||Math.abs(pt.x)>WORLD/2||Math.abs(pt.z)>WORLD/2) return;
    // Thumb-friendly pick radius: generous on phones, tighter in battles.
    // Two passes so a unit standing beside a building is still reachable with
    // a fat thumb — buildings only win when nothing else is under the finger.
    const pickR=st.tutorial?3.4:2.2;
    let unit=null,ud=1e9, bld=null,bd=1e9;
    for(const en of st.entities){ if(en.dead||en.cat==='proj')continue;
      if(st.fog&&en.owner===1){ const gx=Math.max(0,Math.min(GRID-1,Math.floor(en.x/CELL+GRID/2))),gz=Math.max(0,Math.min(GRID-1,Math.floor(en.z/CELL+GRID/2))); if(!map.visible[0][gz*GRID+gx]&&en.cat!=='bld') continue; }
      const d=Math.hypot(en.x-pt.x,en.z-pt.z)-(en.cat==='bld'?(en.size||2):0);
      if(d>pickR) continue;
      if(en.cat==='unit'){ if(d<ud){ud=d;unit=en;} } else if(en.cat==='bld'){ if(d<bd){bd=d;bld=en;} }
    }
    let best = st.tutorial ? (unit||bld) : (unit&&ud<bd+1.2 ? unit : (bld||unit));
    const mine=[...sel].map(id=>byId(st,id)).filter(u=>u&&!u.dead&&u.owner===0);
    if(best&&best.owner===0){ // select; double-tap = select all of the same type nearby
      const now=performance.now();
      if(best.cat==='unit'&&lastPat&&lastPat.id===best.id&&now-lastPat.t<380){
        const squad=st.entities.filter(en=>!en.dead&&en.owner===0&&en.cat==='unit'&&en.type===best.type&&Math.hypot(en.x-best.x,en.z-best.z)<16);
        sel=new Set(squad.map(en=>en.id));
        toast(`Selected ${squad.length} ${UNITS[best.type].name}s`);
      } else sel=new Set([best.id]);
      lastPat={id:best.id,t:now};
      sfx.select(); renderSel();
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
      const rBlds=mine.filter(en=>en.cat==='bld'&&en.done&&trainableAt(en.type).length);
      if(node&&peas.length){ peas.forEach(p=>orderGather(st,map,p,nk==='gold'?'gold':'tree',ni)); sfx.move(); toast(nk==='gold'?'⛏️ Mine gold!':'🪓 Chop wood!'); }
      else if(rBlds.length&&!mine.some(en=>en.cat==='unit')){ rBlds.forEach(b=>{b.rally={x:pt.x,z:pt.z};}); sfx.move(); toast('🚩 Rally point set'); renderSel(); }
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
    html=`<h3>${U.icon} ${U.name} ${e.owner===1?'(enemy)':`<span class="fcap">${FACTIONS[coreFaction(st.playerFaction)].name}</span>`}</h3><p>❤️ ${e.hp|0}/${e.maxHp|0} · 🗡️ ${e.dmg} · ${e.order?('• '+e.order.kind):''}${e.carryAmt?` · carrying ${e.carryAmt} ${e.carry}`:''}</p>`;
    if(e.owner===0){
      html+=`<div class="btnrow dock-main">`;
      if(e.type==='peasant'){
        for(const k of ['farm','barracks','tower']){ const b=BUILDINGS[k]; const c=`${Math.ceil((b.cost.gold||0)*fm.cost)}🪙 ${Math.ceil((b.cost.wood||0)*fm.cost)}🪵`;
          html+=`<button data-b="${k}">${b.icon} Build ${b.name}<br><small>${c}</small></button>`; }
        html+=`<button data-a="build">🔨 More</button><button data-a="wood">🪓 Wood</button><button data-a="gold">⛏️ Gold</button>`;
      }
      html+=`<button data-a="stop">⏹ Stop</button>`;
      html+=dockSpecial();
      html+=`</div><div class="btnrow" data-pane="build" style="display:${forceBuild?'flex':'none'}">`;
      for(const [k,b] of Object.entries(BUILDINGS)){ if(k==='townhall'||k==='farm'||k==='barracks'||k==='tower')continue; const c=`${Math.ceil((b.cost.gold||0)*fm.cost)}🪙 ${Math.ceil((b.cost.wood||0)*fm.cost)}🪵`; html+=`<button data-b="${k}">${b.icon} ${b.name}<br><small>${c} · ${b.time}s</small></button>`; }
      html+=`</div>`;
    }
  } else {
    const B=BUILDINGS[e.type];
    html=`<h3>${B.icon} ${B.name} ${e.done?'':`(building ${((e.prog||0)*100)|0}%)`} ${e.owner===1?'(enemy)':`<span class="fcap">${FACTIONS[coreFaction(st.playerFaction)].name}</span>`}</h3><p>❤️ ${e.hp|0}/${e.maxHp|0}</p>`;
    if(e.owner===0&&e.done){
      const opts=trainableAt(e.type);
      if(opts.length){ html+=`<div class="btnrow dock-main">`; for(const u of opts){ const U=UNITS[u]; const lbl=u==='warrior'?'Train Melee':u==='archer'?'Train Ranged':U.name; const locked=u==='knight'&&!st.entities.some(x=>x.owner===0&&x.type==='blacksmith'&&x.done); html+=`<button data-u="${u}" ${locked?'disabled':''}>${U.icon} ${lbl}<br><small>${Math.ceil(U.cost.gold*fm.cost)}🪙 ${Math.ceil(U.cost.wood*fm.cost)}🪵 ${U.time}s</small></button>`; } html+=dockSpecial()+`</div>`;
        if(e.queue.length) html+=`<p>Training: ${e.queue.map(q=>UNITS[q].icon).join(' ')} ${(e.prog*100)|0}%</p>`; }
      if(e.type==='townhall') html+=`<p>Train Peasants to boom. Farms raise pop cap.</p>`;
    }
  }
  html+=`<div class="btnrow"><button data-a="pause">${paused?'▶ Resume':'⏸ Pause'}</button><button data-a="save">💾 Save</button><button data-a="menu">Menu</button></div>`;
  card.innerHTML=html;
  card.querySelectorAll('button').forEach(b=>b.onclick=()=>onCardBtn(b,e,forceBuild));
}
function dockSpecial(){
  const sp=factionMult(coreFaction(st.playerFaction)).special;
  if(!sp) return '';
  const cd=Math.ceil((st.specialCd&&st.specialCd[0])||0);
  const dis=cd>0||st.res[0].gold<(sp.cost.gold||0);
  return `<button data-a="special" ${dis?'disabled':''}>${sp.icon} ${sp.name}<br><small>${cd>0?cd+'s':(sp.cost.gold||0)+'🪙'}</small></button>`;
}
function onCardBtn(b,e,forceBuild){
  const fm=factionMult(st.playerFaction);
  const a=b.dataset.a, u=b.dataset.u, bb=b.dataset.b;
  if(a==='stop'){ [...sel].forEach(id=>{const x=byId(st,id); if(x&&x.cat==='unit')x.order={kind:'idle'};}); }
  if(a==='build'){ const p=cardPane(); if(p)p.style.display=p.style.display==='none'?'flex':'none'; }
  if(a==='wood'||a==='gold'){ const kind2=a==='gold'?'gold':'tree'; [...sel].forEach(id=>{const x=byId(st,id); if(x&&x.type==='peasant'){const i=findResource(map,x.x,x.z,kind2,st); if(i>=0)orderGather(st,map,x,kind2,i);}}); sfx.move(); }
  if(a==='special'){ toast(castSpecial(st,map,0)); sfx.build(); renderSel(); return; }
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
    let px=Math.max(-42,Math.min(42,peas.x+4+Math.random()*2)),pz=Math.max(-42,Math.min(42,peas.z+4));
    if(st.tutorial&&renderer){
      const vw=renderer.renderer.domElement.getBoundingClientRect();
      const inside=(p)=>p.x>=vw.left+28&&p.x<=vw.right-28&&p.y>=vw.top+28&&p.y<=vw.bottom-28;
      for(let i=0;i<24&&Math.hypot(px,pz)>4;i++){
        if(inside(renderer.screenOf(px,1,pz))&&inside(renderer.screenOf(px+2.5,1,pz+2.5))) break;
        px*=0.9; pz*=0.9;
      }
    }
    const nb=addEntity(st,{cat:'bld',type:bb,owner:0,f:st.playerFaction,x:px,z:pz,hp:1,maxHp:BUILDINGS[bb].hp*fm.hp,done:false,prog:0,time:BUILDINGS[bb].time/fm.build,builder:false,size:BUILDINGS[bb].size,sight:BUILDINGS[bb].sight,armor:1,queue:[],cool:0});
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
  const m=(st.t/60)|0,s=(st.t%60)|0; $('timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${st.tutorial?' · tutorial':` · ${st.aiPersona}`}`;
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
    while(acc>=STEP&&n<5){
      tick(st,map,STEP);
      aiAcc+=STEP; if(aiAcc>2){aiAcc=0; if(!st.tutorial){try{aiTick(st,map);}catch(err){console.warn(err);}} }
      st.events.forEach(ev=>{ if(ev.t==='hit')renderer.hit(ev.x,ev.z); if(ev.t==='gather'){ if(ev.kind==='gold')sfx.coin(); else sfx.chop(); } if(ev.t==='toast')toast(ev.msg); });
      acc-=STEP; n++;
    }
    saveAcc+=dt; if(saveAcc>15){saveAcc=0; if(!st.tutorial)saveGame(st,map);}
    if(acc>STEP*5) acc=STEP*5;
  }
  renderer.sync(st,map,sel,time);
  hud();
  perfFrames++; perfT+=dt;
  if(perfT>=0.5){ if($('sandbox').style.display!=='none') $('perf').textContent=`${(perfFrames/perfT)|0} fps · ${renderer.renderer.info.render.calls} draw calls`; perfFrames=0; perfT=0; }
  selAcc+=dt; if(selAcc>=0.5){ selAcc=0; renderSelLive(); }
  // Mission 1 tutorial: evaluated after the sim step, no fail state, no AI.
  // The UI keeps refreshing after completion so the bar settles on "complete".
  if(mission){
    if(!mission.done){
      const ctx=makeCtx(st,map,sel,mission.history,0);
      for(const ev of mission.tick(st,ctx,st.t)){
        if(ev.type==='step-done'){ sfx.coin(); toast(`✅ ${ev.step.title} — done!`,2200); }
        if(ev.type==='step-start') missionAssist(ev.step.id);
        if(ev.type==='mission-done'){ sfx.win(); onMissionComplete(ev.reward); }
      }
    }
    uiAcc+=dt; if(uiAcc>=0.2){ uiAcc=0; updateCoachMark(); tutUI.update(mission,makeCtx(st,map,sel,mission.history,0)); }
  }
  if(st.over&&!st._end&&!st.tutorial){ st._end=true; endGame(st.over.win,st.over.draw); }
}
function onMissionComplete(reward){
  const prof=markMissionComplete(getProfile(),MISSION1.id);
  addAch(prof,reward.achievement);
  setProfile(prof);
  // Reward is real: it lands in the kingdom you carry into the battle.
  st.res[0].gold+=reward.gold; st.res[0].wood+=reward.wood;
  tutUI.celebrate(reward);
}
let selLive=0, lastSig='';
function renderSelLive(){ // rebuild at ~1Hz only when something visible changed (never steal a tap)
  if(++selLive%10!==0)return;
  if($('selcard').style.display==='none'||!sel.size) return;
  const e=[...sel].map(id=>byId(st,id)).find(x=>x&&!x.dead);
  if(!e) return;
  const sig=[e.id,e.hp|0,(e.prog||0).toFixed(1),(e.queue||[]).length,(e.done?1:0),st.res[0].gold|0,st.res[0].wood|0,Math.ceil((st.specialCd&&st.specialCd[0])||0),paused?'p':''].join('|');
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

// debug/testing handle
window.__game={ get st(){return st;}, get map(){return map;}, get sel(){return sel;}, get renderer(){return renderer;}, get mission(){return mission;}, get paused(){return paused;}, get running(){return running;} };

// ---- boot ----
$('againBtn').onclick=()=>location.reload();
$('sandboxBtn').onclick=()=>{ const p=$('sandbox'); p.style.display=p.style.display==='none'?'flex':'none'; };
$('sbRes').onclick=()=>{ if(!st){toast('Start a game first');return;} st.res[0].gold+=500; st.res[0].wood+=500; toast('⚙️ +500🪙 +500🪵'); sfx.coin(); };
$('sbWave').onclick=()=>{ if(!st||!running){toast('Start a game first');return;} const hall=st.entities.find(e=>!e.dead&&e.owner===0&&e.type==='townhall'); const hx=hall?hall.x:0,hz=hall?hall.z:0; const fm=factionMult(st.aiFaction);
  for(let i=0;i<3;i++){ const w=addEntity(st,{cat:'unit',type:'warrior',owner:1,f:st.aiFaction,x:hx+14+i*2,z:hz+14,hp:150*fm.hp,maxHp:150*fm.hp,dmg:12,armor:1,speed:5.6,sight:10,order:null,carry:null,carryAmt:0,cool:0}); if(hall)orderAttack(st,w,hall.id); }
  toast('⚙️ Enemy wave incoming!'); };
$('sbFog').onclick=()=>{ if(!st){toast('Start a game first');return;} st.fog=!st.fog; toast(st.fog?'⚙️ Fog of war on':'⚙️ Fog of war off'); };
$('sbSpeed').onclick=()=>{ if(!st){toast('Start a game first');return;} st.speed=st.speed>=2?1:2; $('sbSpeed').textContent=st.speed>=2?'1× Speed':'2× Speed'; toast(`⚙️ Speed ${st.speed}×`); };
renderFactions();
$('buildTag').textContent=`build ${BUILD}`;
console.log('KINGDOMS RTS',BUILD);
// Ambient demo scene behind menu so first paint is never black
try{
  st=makeState({faction:'human',aiFaction:'undead',ai:'expander',fog:'off',speed:1});
  map=genMap(12345);
  spawnBase(st,map,0,-30,-30,'human');
  spawnBase(st,map,1,30,30,'undead');
  updateFog(st,map);
  renderer=new Renderer(gl); renderer.buildStatic(map);
  renderer.addBaseDecal(-30,-30,'human'); renderer.addBaseDecal(30,30,'undead');
  renderer.target.set(0,0,0); renderer.dist=85;
  const demoT0=performance.now();
  (function paint(){ if(!running){ const t=(performance.now()-demoT0)/1000;
    try{ renderer.target.x=Math.sin(t*0.1)*10; renderer.target.z=Math.cos(t*0.08)*10;
    renderer.sync(st,map,new Set(),t); }catch{} requestAnimationFrame(paint); } })();
}catch(e){ console.warn('demo bg failed',e); }
