// Military: data-driven active abilities with cooldowns.
// Pure sim helpers — they mutate entity state through the engine's damage helper.
import { alive, dealDamage } from '../core/engine.js';

export const ABILITIES = {
  warrior: { id:'rally',  name:'Rally',  icon:'⚡', cd:22, desc:'+40% damage and +2 armor to nearby allies for 6s.' },
  archer:  { id:'volley', name:'Volley', icon:'🎯', cd:18, desc:'12 damage to every foe in a 4-unit blast.' },
  knight:  { id:'charge', name:'Charge', icon:'💨', cd:20, desc:'+120% speed for 3s; next strike +50%.' },
  peasant: { id:'repair', name:'Repair', icon:'🔧', cd:15, desc:'Restore 15% HP to the nearest damaged building.' },
};

export function abilityFor(e){ return ABILITIES[e.type] || null; }
export function abilityReady(e){ return !!abilityFor(e) && (e.abilityCd || 0) <= 0; }

export function useAbility(st, e){
  const a = abilityFor(e);
  if(!a || !alive(e)) return false;
  if((e.abilityCd || 0) > 0) return false;
  const foes = st.entities.filter(o => !o.dead && o.owner !== e.owner && o.owner !== 2 && o.cat !== 'proj');
  if(a.id === 'rally'){
    let any = false;
    for(const o of st.entities){
      if(o.dead || o.owner !== e.owner || o.cat !== 'unit') continue;
      if(Math.hypot(o.x - e.x, o.z - e.z) > 7) continue;
      o.buff = o.buff || {}; o.buff.rally = 6; any = true;
    }
    if(!any) return false;
    st.events.push({ t:'hit', x:e.x, z:e.z });
  } else if(a.id === 'volley'){
    const near = foes.filter(o => Math.hypot(o.x - e.x, o.z - e.z) <= 10)
      .sort((p, q) => Math.hypot(p.x - e.x, p.z - e.z) - Math.hypot(q.x - e.x, q.z - e.z))[0];
    if(!near) return false;
    for(const o of foes){
      if(o.dead) continue;
      if(Math.hypot(o.x - near.x, o.z - near.z) <= 4) dealDamage(st, { owner:e.owner }, o, 12);
    }
    st.events.push({ t:'hit', x:near.x, z:near.z });
  } else if(a.id === 'charge'){
    e.buff = e.buff || {}; e.buff.charge = 3; e.chargeHit = true;
    st.events.push({ t:'hit', x:e.x, z:e.z });
  } else if(a.id === 'repair'){
    const b = st.entities.filter(o => !o.dead && o.owner === e.owner && o.cat === 'bld' && o.hp < o.maxHp)
      .sort((p, q) => Math.hypot(p.x - e.x, p.z - e.z) - Math.hypot(q.x - e.x, q.z - e.z))[0];
    if(!b) return false;
    b.repair = 4; b.repairRate = b.maxHp * 0.15 / 4;
    st.events.push({ t:'hit', x:b.x, z:b.z });
  }
  e.abilityCd = a.cd;
  return true;
}
