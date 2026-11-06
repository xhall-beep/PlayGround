// Wave-defense scenario layered on the shared RTS simulation.
import { addEntity, alive } from '../core/engine.js';
import { UNITS } from '../buildings/data.js';
import { factionMult } from '../factions/factions.js';
import { orderAttack } from '../sim/sim.js';

export const DEFENSE_MAX_WAVES = 8;
export const DEFENSE_BUILD_SECONDS = 30;

export function setupDefense(st, map, faction) {
  st.gameMode = 'defense';
  st.defense = { phase: 'build', wave: 0, maxWaves: DEFENSE_MAX_WAVES, phaseLeft: DEFENSE_BUILD_SECONDS, enemiesRemaining: 0 };
  st.res[0].gold = 500;
  st.res[0].wood = 360;
  return st.defense;
}

function spawnWave(st, map) {
  const d = st.defense;
  const wave = d.wave;
  const hall = st.entities.find(e => e.owner === 0 && e.type === 'townhall' && alive(e));
  if (!hall) { d.phase = 'defeat'; st.over = { win: false, defense: true }; return; }
  const faction = st.aiFaction || 'undead';
  const fm = factionMult(faction);
  const meleeCount = 2 + wave * 2;
  const rangedCount = wave >= 3 ? Math.floor(wave / 2) : 0;
  const types = ['warrior', 'archer'];
  for (let i = 0; i < meleeCount + rangedCount; i++) {
    const type = i < meleeCount ? types[0] : types[1];
    const u = UNITS[type];
    // Spread spawns across the four map edges, keeping all coordinates in-world.
    const edge = (i + wave * 3) % 4;
    const offset = (((i * 17 + wave * 11) % 55) - 27);
    const x = edge < 2 ? offset : (edge === 2 ? -43 : 43);
    const z = edge < 2 ? (edge === 0 ? -43 : 43) : offset;
    const enemy = addEntity(st, {
      cat: 'unit', type, owner: 1, faction,
      x, z, hp: u.hp * fm.hp, maxHp: u.hp * fm.hp,
      dmg: u.dmg * (type === 'archer' ? (fm.archer ?? fm.dmg) : fm.dmg),
      armor: u.armor, range: u.range, speed: u.speed * fm.speed,
      sight: u.sight, armorPierce: u.armorPierce || 0,
      order: null, carry: null, carryAmt: 0, cool: 0, defenseAttacker: true,
    });
    orderAttack(st, enemy, hall.id);
  }
  d.enemiesRemaining = meleeCount + rangedCount;
  d.phase = 'wave';
  d.phaseLeft = 0;
  st.events.push({ t: 'toast', msg: `🌑 Wave ${wave} incoming — ${d.enemiesRemaining} enemies!` });
}

// Called after each ordinary sim tick; the engine remains the sole combat/economy authority.
export function updateDefense(st, map, dt) {
  const d = st.defense;
  if (!d || st.over) return;
  const hallAlive = st.entities.some(e => e.owner === 0 && e.type === 'townhall' && alive(e));
  if (!hallAlive) {
    d.phase = 'defeat';
    st.over = { win: false, defense: true };
    return;
  }
  if (d.phase === 'build') {
    d.phaseLeft = Math.max(0, d.phaseLeft - dt);
    if (d.phaseLeft <= 0) {
      d.wave++;
      spawnWave(st, map);
    }
  } else if (d.phase === 'wave') {
    d.enemiesRemaining = st.entities.filter(e => e.owner === 1 && e.cat === 'unit' && alive(e)).length;
    if (d.enemiesRemaining === 0) {
      if (d.wave >= d.maxWaves) {
        d.phase = 'victory';
        st.over = { win: true, defense: true };
        st.events.push({ t: 'toast', msg: '🏆 The kingdom is safe! All waves defeated.' });
      } else {
        d.phase = 'build';
        d.phaseLeft = DEFENSE_BUILD_SECONDS;
        const gold = 100 + d.wave * 20;
        const wood = 70 + d.wave * 15;
        st.res[0].gold += gold;
        st.res[0].wood += wood;
        st.events.push({ t: 'toast', msg: `✅ Wave ${d.wave} cleared! +${gold} gold, +${wood} wood. Next wave in 30s.` });
      }
    }
  }
}

export function startDefenseWave(st, map) {
  const d = st.defense;
  if (!d || d.phase !== 'build' || d.wave >= d.maxWaves) return false;
  d.phaseLeft = 0;
  d.wave++;
  spawnWave(st, map);
  return true;
}
