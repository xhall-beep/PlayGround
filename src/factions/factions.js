// KINGDOMS RTS — factions. Four core playable factions; the rest are legacy
// entries kept only so old saves/AI personas still resolve. They render in a
// collapsed, locked "Expansion Factions — Coming Soon" row, never in play.
export const CORE_FACTIONS = ['human', 'orc', 'undead', 'elf'];
export const EXPANSION_FACTIONS = ['dwarf', 'fae', 'wilde', 'demon'];

export const FACTIONS = {
  human:  { name:'Human',  icon:'🛡️', title:'Kingdom of Valor', desc:'Balanced. +10% build speed. Special: Valor Stand (heal + rally).', hp:1.0, dmg:1.0, cost:1.0, speed:1.0, build:1.1,
            special:{ name:'Valor Stand', icon:'🛡️', cost:{gold:100}, cd:60, desc:'Heal all your units +40 HP.' } },
  orc:    { name:'Orc',    icon:'🪓', title:'Ironblood Horde', desc:'Brutal melee. +10% dmg, -10% cost. Special: Blood Rage (+3 dmg).', hp:1.05, dmg:1.1, cost:0.9, speed:1.0, build:1.0,
            special:{ name:'Blood Rage', icon:'🩸', cost:{gold:100}, cd:60, desc:'Your army +3 damage, +25 heal.' } },
  undead: { name:'Undead', icon:'💀', title:'Crypt Scourge', desc:'Slow horde: +15% dmg, cheap towers. Special: Raise Dead.', hp:1.1, dmg:1.15, cost:0.95, speed:0.9, build:0.9,
            special:{ name:'Raise Dead', icon:'💀', cost:{gold:100}, cd:75, desc:'Raise 2 skeletal warriors at your Town Hall.' } },
  elf:    { name:'Elf',    icon:'🏹', title:'Sylvan Enclave', desc:'Archers +25% range/dmg, -10% HP. Special: Moonwell (big heal).', hp:0.9, dmg:1.0, archer:1.25, cost:1.05, speed:1.05, build:1.0,
            special:{ name:'Moonwell', icon:'🌙', cost:{gold:100}, cd:60, desc:'Heal all your units +60 HP.' } },
  // --- legacy / expansion (locked, unplayable) ---
  dwarf:  { name:'Dwarf',  icon:'⛏️', desc:'Expansion — Coming Soon.', hp:1.25, dmg:1.05, gold:1.2, cost:1.05, speed:0.9, build:1.0, locked:true },
  fae:    { name:'Fae',    icon:'🧚', desc:'Expansion — Coming Soon.', hp:0.9, dmg:1.1, cost:1.0, speed:1.15, build:1.0, locked:true },
  wilde:  { name:'Wilde',  icon:'🐗', desc:'Expansion — Coming Soon.', hp:1.1, dmg:1.0, wood:1.25, cost:1.0, speed:1.0, build:1.0, locked:true },
  demon:  { name:'Demon',  icon:'🔥', desc:'Expansion — Coming Soon.', hp:1.15, dmg:1.2, cost:1.2, speed:1.0, build:1.0, locked:true },
  goblin: { name:'Goblinoid', icon:'👺', desc:'Legacy — folded into the Orc horde.', hp:0.85, dmg:0.95, cost:0.8, speed:1.1, build:1.0, locked:true },
};
export function factionMult(key){ return FACTIONS[key] || FACTIONS.human; }
export function isCore(key){ return CORE_FACTIONS.includes(key); }
export function coreFaction(key){ return isCore(key) ? key : 'human'; }
