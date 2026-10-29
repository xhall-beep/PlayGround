// Buildings + Units data. Costs {gold,wood}, times in seconds, pop use.
export const BUILDINGS = {
  townhall:{ name:'Town Hall', icon:'🏰', hp:1600, cost:{gold:0,wood:0}, time:0,  pop:0,  size:3.2, sight:12, desc:'Heart. Trains Peasants. Lose it = defeat.' },
  farm:    { name:'Farm',      icon:'🌾', hp:450,  cost:{gold:0,wood:100},time:18, pop:6,  size:2.2, sight:6,  desc:'+6 pop cap, +food trickle.' },
  barracks:{ name:'Barracks',  icon:'⚒️', hp:700,  cost:{gold:50,wood:150},time:28,pop:0,  size:2.6, sight:8,  desc:'Trains Warriors + Archers.' },
  archery: { name:'Archery',   icon:'🎯', hp:550,  cost:{gold:80,wood:120},time:25,pop:0,  size:2.4, sight:9,  desc:'Elite archers, +range research.' },
  tower:   { name:'Tower',     icon:'🗼', hp:600,  cost:{gold:80,wood:100},time:22,pop:0,  size:1.6, sight:14, range:13, dmg:14, desc:'Shoots enemies. Needs no pop.' },
  blacksmith:{name:'Blacksmith',icon:'🔨',hp:600, cost:{gold:100,wood:120},time:30,pop:0, size:2.4, sight:7, desc:'+2 dmg / +20 HP to army (one-time).' },
};
export const UNITS = {
  peasant:{ name:'Peasant', icon:'🧑‍🌾', hp:70,  dmg:4,  armor:0, range:1.4, speed:5.2, sight:9,  cost:{gold:50,wood:0},  time:12, pop:1, gather:6, weapon:'pitchfork', armorPierce:0, desc:'Gathers gold/wood, builds.' },
  warrior:{ name:'Warrior', icon:'🛡️', hp:150, dmg:12, armor:1, range:1.6, speed:5.6, sight:10, cost:{gold:80,wood:20}, time:16, pop:1, weapon:'sword', armorPierce:0, desc:'Sturdy melee.' },
  archer: { name:'Archer',  icon:'🏹', hp:90,  dmg:10, armor:0, range:9,   speed:5.8, sight:12, cost:{gold:70,wood:40}, time:18, pop:1, weapon:'bow', armorPierce:0.6, desc:'Ranged. Fragile.' },
  knight: { name:'Knight',  icon:'🐎', hp:260, dmg:18, armor:2, range:1.7, speed:7.2, sight:11, cost:{gold:140,wood:40},time:26, pop:2, needs:'blacksmith', weapon:'lance', armorPierce:0.25, desc:'Fast cavalry. Needs Blacksmith.' },
  skeleton:{ name:'Skeleton',icon:'💀', hp:60,  dmg:8,  armor:0, range:1.5, speed:5.0, sight:9,  cost:{gold:0,wood:0},  time:8,  pop:1, weapon:'claw', armorPierce:0.1, desc:'Raised from the slain by the Undead.' },
};
export function trainableAt(building){ return { townhall:['peasant'], barracks:['warrior','archer'], archery:['archer','knight'] }[building]||[]; }
