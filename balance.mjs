// AI-vs-AI balance harness (no browser, no deps).
// Usage: node balance.mjs [seedsPerMatchup=1] [maxMinutes=20]
// Every match is seeded, so results are reproducible and diffable.
import { makeState, resetUID } from './src/core/engine.js';
import { genMap } from './src/world/world.js';
import { tick, spawnBase } from './src/sim/sim.js';
import { aiTick, PERSONAS } from './src/ai/ai.js';
import { CORE_FACTIONS } from './src/factions/factions.js';

const seeds=Math.max(1,Number(process.argv[2]||1));
const maxT=Math.max(2,Number(process.argv[3]||20))*60;
const personas=Object.keys(PERSONAS);

function digest(st){
  let h=2166136261;
  const mix=(v)=>{ h^=v; h=Math.imul(h,16777619)>>>0; };
  mix(st.tick); mix(Math.round(st.res[0].gold)); mix(Math.round(st.res[1].gold));
  for(const e of st.entities){ mix(e.id); mix(Math.round(e.x*100)); mix(Math.round(e.z*100)); mix(e.hp|0); }
  return h>>>0;
}

function runMatch(fA,fB,seed,persona){
  resetUID(1);
  const st=makeState({faction:fA,aiFaction:fB,ai:persona,fog:'on',speed:1,seed});
  const map=genMap((seed^0x9e37)>>>0);
  spawnBase(st,map,0,-30,-30,fA); spawnBase(st,map,1,30,30,fB);
  let n=0;
  while(!st.over&&st.t<maxT){ tick(st,map,0.1); if(n%20===0){ aiTick(st,map,0); aiTick(st,map,1); } n++; }
  return st;
}

// 1) determinism self-check: identical seeds must produce identical states
const a=runMatch('human','orc',4242,'expander');
const b=runMatch('human','orc',4242,'expander');
const det=digest(a)===digest(b);
console.log(`determinism (same seed => same state): ${det?'PASS':'FAIL'}  [${digest(a).toString(16)} vs ${digest(b).toString(16)}]`);
if(!det) process.exitCode=1;

// 2) round robin
console.log(`\n${CORE_FACTIONS.length*(CORE_FACTIONS.length-1)} matchups x ${seeds} seed(s), cap ${maxT}s\n`);
console.log('A       vs B        W-L-D        avg end');
const agg={}; for(const f of CORE_FACTIONS) agg[f]={w:0,l:0,d:0};
for(const fA of CORE_FACTIONS){ for(const fB of CORE_FACTIONS){ if(fA===fB) continue;
  let w=0,l=0,d=0,t=0;
  for(let i=0;i<seeds;i++){
    const seed=(1000+i*7919)>>>0;
    const st=runMatch(fA,fB,seed,personas[i%personas.length]);
    if(!st.over) d++; else if(st.over.win) w++; else l++;
    t+=Math.min(st.t,maxT);
  }
  agg[fA].w+=w; agg[fA].l+=l; agg[fA].d+=d;
  console.log(`${fA.padEnd(7)} vs ${fB.padEnd(8)} ${`${w}-${l}-${d}`.padEnd(12)} ${(t/seeds).toFixed(0)}s`);
}}
console.log('\nfaction    W-L-D       win rate');
for(const f of CORE_FACTIONS){ const {w,l,d}=agg[f]; const n=w+l+d;
  console.log(`${f.padEnd(10)} ${`${w}-${l}-${d}`.padEnd(11)} ${n?((w/n)*100).toFixed(0)+'%':'–'}`); }
