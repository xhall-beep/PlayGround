// Heroes: one champion per faction, with a signature active ability.
// Pure data — sim and UI read it, nothing here mutates state.
export const HEROES = {
  human:  { name: 'Oathkeeper',  icon: '🛡️', ability: 'aegis' },
  elf:    { name: 'Thornblade',  icon: '🗡️', ability: 'briar' },
  undead: { name: 'Gravelord',   icon: '💀', ability: 'deathnova' },
  dwarf:  { name: 'Runelord',    icon: '🔨', ability: 'aegis' },
  goblin: { name: 'Warchief',    icon: '👺', ability: 'bladestorm' },
  fae:    { name: 'Dreamweaver', icon: '🧚', ability: 'aegis' },
  wilde:  { name: 'Beastlord',   icon: '🐗', ability: 'bladestorm' },
  demon:  { name: 'Infernal',    icon: '🔥', ability: 'bladestorm' },
};

export const HERO_ABILITIES = {
  aegis:      { id: 'aegis',      name: 'Aegis',       icon: '✨', cd: 24, desc: 'Heal nearby allies for 35% of their max HP.' },
  bladestorm: { id: 'bladestorm', name: 'Bladestorm',  icon: '🌀', cd: 20, desc: '24 damage to every foe within 5 units.' },
  briar:      { id: 'briar',      name: 'Briar Prison', icon: '🌿', cd: 22, desc: 'Root foes within 8 units for 2.5s and deal 8 damage.' },
  deathnova:  { id: 'deathnova',  name: 'Death Nova',  icon: '☠️', cd: 22, desc: '18 damage around you; heal for half the damage dealt.' },
};

export function heroFor(faction) { return HEROES[faction] || HEROES.human; }
export function heroAbility(faction) { return HERO_ABILITIES[heroFor(faction).ability]; }
