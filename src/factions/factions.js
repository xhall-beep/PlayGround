// KINGDOMS RTS — factions (8). Human is baseline; each also owns one signature hook.
export const FACTIONS = {
  human:   { name:'Human',   icon:'⚔️', desc:'Balanced. +10% build, +10% gather.', hp:1.0, dmg:1.0, cost:1.0, speed:1.0, build:1.1, gather:1.1 },
  elf:     { name:'Elf',     icon:'🏹', desc:'Archers +25% range/dmg, -10% HP.', hp:0.9, dmg:1.0, archer:1.25, range:1.25, cost:1.05, speed:1.05, build:1.0 },
  dwarf:   { name:'Dwarf',   icon:'⛏️', desc:'+25% HP, +20% gold, buildings +15% HP, -10% speed.', hp:1.25, dmg:1.05, gold:1.2, bldHp:1.15, cost:1.05, speed:0.9, build:1.0 },
  goblin:  { name:'Goblinoid',icon:'👺', desc:'Cheap spam: -20% cost, -15% HP, +15% production.', hp:0.85, dmg:0.95, cost:0.8, speed:1.1, produce:1.15, build:1.0 },
  fae:     { name:'Fae',     icon:'🧚', desc:'Fast: +15% speed, +10% dmg, regenerate out of combat.', hp:0.9, dmg:1.1, cost:1.0, speed:1.15, regen:1.4, build:1.0 },
  undead:  { name:'Undead',  icon:'💀', desc:'Slow horde: +15% dmg, cheap towers, slain foes rise.', hp:1.1, dmg:1.15, cost:0.95, speed:0.9, raise:0.3, build:0.9 },
  wilde:   { name:'Wilde',   icon:'🐗', desc:'Wood beasts: +25% wood, +10% HP, forests regrow.', hp:1.1, dmg:1.0, wood:1.25, regrow:1, cost:1.0, speed:1.0, build:1.0 },
  demon:   { name:'Demon',   icon:'🔥', desc:'Elite: +20% dmg/cost, attacks burn.', hp:1.15, dmg:1.2, cost:1.2, speed:1.0, burn:1, build:1.0 },
};
export function factionMult(key){ return FACTIONS[key] || FACTIONS.human; }
