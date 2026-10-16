// Mission 1 — "First Harvest". A playable tutorial: no enemies, no fail state.
//
// A step is data: one line of instruction, an optional world-space coach mark,
// and a `done` predicate evaluated against live sim state. Steps auto-advance
// and the last one ends the mission with a reward. Nothing here mutates the
// Core Engine — it only reads it and calls order helpers.

import { UNITS, BUILDINGS } from '../buildings/data.js';

export const MISSION1 = {
  id: 'mission1',
  index: 1,
  name: 'First Harvest',
  blurb: 'Learn to gather, build, and train. Nobody will attack you here.',
  reward: { gold: 150, wood: 100, achievement: '🌾' },
  steps: [
    {
      id: 'gather',
      title: 'Chop wood',
      coach: 'Tap the glowing peasant, then a tree.',
      hint: 'Tap your peasant (it pulses), then tap a tree.',
      mark: 'peasant',
      done: (c) => c.woodGained >= 120,
      progress: (c) => Math.min(1, c.woodGained / 120),
      progressText: (c) => `${Math.min(120, c.woodGained | 0)}/120 wood`,
    },
    {
      id: 'build-farm',
      title: 'Build a Farm',
      coach: 'With the peasant selected, tap 🔨 Build, then 🌾 Farm.',
      hint: 'Peasant selected → Build → Farm.',
      mark: 'peasant',
      done: (c) => c.built('farm') >= 1 && c.structures('farm').every((f) => f.done),
      progress: (c) => {
        const fs = c.structures('farm');
        if (!fs.length) return 0;
        return fs.reduce((s, f) => s + (f.prog || 0), 0) / fs.length;
      },
      progressText: (c) => {
        const fs = c.structures('farm');
        if (!fs.length) return 'no farm placed';
        return fs[0].done ? 'built' : `${((fs[0].prog || 0) * 100) | 0}% built`;
      },
    },
    {
      id: 'train-peasant',
      title: 'Train a Peasant',
      coach: 'Tap the Town Hall, then 🧑‍🌾 Peasant.',
      hint: 'Tap your Town Hall, then train a Peasant.',
      mark: 'townhall',
      done: (c) => c.units('peasant').length >= 3,
      progress: (c) => {
        const queued = c.queued('townhall', 'peasant');
        return Math.min(1, Math.max(0, c.units('peasant').length - 2) + queued * 0.5);
      },
      progressText: (c) => `${Math.min(3, c.units('peasant').length)}/3 peasants`,
    },
    {
      id: 'build-barracks',
      title: 'Build a Barracks',
      coach: 'Select a peasant → 🔨 Build → ⚒️ Barracks.',
      hint: 'Peasant selected → Build → Barracks (150 wood).',
      mark: 'barracks-site',
      done: (c) => c.built('barracks') >= 1 && c.structures('barracks').every((b) => b.done),
      progress: (c) => {
        const bs = c.structures('barracks');
        if (!bs.length) return 0;
        return bs.reduce((s, b) => s + (b.prog || 0), 0) / bs.length;
      },
      progressText: (c) => {
        const bs = c.structures('barracks');
        if (!bs.length) return 'no barracks placed';
        return bs[0].done ? 'built' : `${((bs[0].prog || 0) * 100) | 0}% built`;
      },
    },
    {
      id: 'train-warrior',
      title: 'Train a Warrior',
      coach: 'Tap the Barracks, then 🛡️ Warrior.',
      hint: 'Barracks selected → train a Warrior.',
      mark: 'barracks',
      done: (c) => c.units('warrior').length >= 1,
      progress: (c) => Math.min(1, c.units('warrior').length + c.queued('barracks', 'warrior') * 0.5),
      progressText: (c) => {
        const n = c.units('warrior').length + c.queued('barracks', 'warrior');
        return n ? (c.units('warrior').length ? 'trained' : 'training…') : '0/1 warriors';
      },
    },
    {
      id: 'move-army',
      title: 'Move your army',
      coach: 'Tap the warrior, then tap anywhere in the clearing.',
      hint: 'Select the warrior and tap the ground to give a move order.',
      mark: 'warrior',
      done: (c) => c.movedFar('warrior', 6),
      progress: (c) => Math.min(1, c.movedFar('warrior', 6) ? 1 : 0.5),
      progressText: (c) => (c.movedFar('warrior', 6) ? 'order given' : 'give a move order'),
    },
  ],
};

/** Tutorial-safe scenario: single clearing, no enemy base, resources you can afford. */
export function scenarioForMission1(baseSeed) {
  return { seed: baseSeed, clearRadius: 30, spawn: { x: 0, z: 0 }, noEnemies: true };
}

/** Build the read-only context steps query. Kept tiny and allocation-free per call. */
export function makeCtx(st, map, sel, history, baseline = 0) {
  return {
    st,
    map,
    sel,
    wood: st.res[0].wood,
    gold: st.res[0].gold,
    /** Wood actually gathered during the mission (overwritten by the runner). */
    woodGained: Math.max(0, st.res[0].wood - baseline),
    units: (type) => st.entities.filter((e) => !e.dead && e.owner === 0 && e.cat === 'unit' && e.type === type),
    structures: (type) => st.entities.filter((e) => !e.dead && e.owner === 0 && e.cat === 'bld' && e.type === type),
    built: (type) => st.entities.filter((e) => e.owner === 0 && e.cat === 'bld' && e.type === type && e.done).length,
    queued: (bld, type) => {
      const b = st.entities.find((e) => !e.dead && e.owner === 0 && e.cat === 'bld' && e.type === bld);
      return b && (b.queue || []).filter((q) => q === type).length ? 1 : 0;
    },
    movedFar: (type, dist) => {
      const u = st.entities.find((e) => !e.dead && e.owner === 0 && e.cat === 'unit' && e.type === type);
      if (!u) return false;
      const from = history.get(u.id);
      return from ? Math.hypot(u.x - from.x, u.z - from.z) >= dist : false;
    },
  };
}

/** Tutorial run-state machine. Returns transition events for the UI layer. */
export class MissionRunner {
  constructor(def = MISSION1) {
    this.def = def;
    this.step = 0;
    this.done = false;
    this.completedAt = 0;
    this.history = new Map(); // entity id -> first observed position (movement goals)
    this.lastWood = null;     // last seen wood bank, for monotonic gain tracking
    this.gainedWood = 0;      // wood actually gathered (spending never lowers it)
    this.events = [];
  }

  get current() {
    return this.done ? null : this.def.steps[this.step];
  }

  /** Called every sim tick from the game loop. Returns an event list. */
  tick(st, ctx, t) {
    this.events.length = 0;
    if (this.done) return this.events;
    const step = this.current;
    if (!step) return this.events;
    // Monotonic gather tracking: only positive bank changes count as income, so
    // buying a farm mid-objective can never un-complete "gather 120 wood".
    // Non-finite readings are ignored rather than poisoning the counter.
    const wood = Number.isFinite(ctx.wood) ? ctx.wood : this.lastWood;
    if (this.lastWood === null || !Number.isFinite(this.lastWood)) this.lastWood = wood;
    else {
      const d = wood - this.lastWood;
      if (d > 0) this.gainedWood += d;
      this.lastWood = wood;
    }
    ctx.woodGained = this.gainedWood;

    for (const e of st.entities) {
      if (e.dead || e.owner !== 0 || e.cat !== 'unit') continue;
      if (!this.history.has(e.id)) this.history.set(e.id, { x: e.x, z: e.z });
    }

    if (step.done(ctx)) {
      this.events.push({ type: 'step-done', step });
      this.step += 1;
      if (this.step >= this.def.steps.length) {
        this.done = true;
        this.completedAt = t;
        this.events.push({ type: 'mission-done', reward: this.def.reward });
      } else {
        this.events.push({ type: 'step-start', step: this.current });
      }
    }
    return this.events;
  }

  progress(ctx) {
    if (this.done) return 1;
    const s = this.current;
    return s ? Math.max(0, Math.min(1, s.progress(ctx))) : 1;
  }

  progressText(ctx) {
    if (this.done) return 'complete';
    const s = this.current;
    return s ? s.progressText(ctx) : '';
  }
}

/** Missions are unlock-gated on completion; nothing is locked behind money. */
export function missionUnlocked(profile, id) {
  if (id === 'mission1') return true;
  const done = profile.missions || [];
  return done.includes(id);
}
export function markMissionComplete(profile, id) {
  const done = profile.missions || [];
  if (done.includes(id)) return profile;
  return { ...profile, missions: [...done, id] };
}
