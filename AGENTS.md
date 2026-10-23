# AGENTS.md — KINGDOMS RTS (PlayGround)

Mobile-first chibi-3D RTS. Static site: no build step, no package.json, no test runner.
`index.html` + ES modules in `src/`, Three.js r160 via CDN importmap (`unpkg.com`) — **no npm install, no node_modules, no bundler**. Deployment serves the repo root as-is.

`Agents.md` already holds process lifecycle + SwiftShader/playwright capture rules; this file is the code-level playbook. Note: `Agents.md` and `AGENTS.md` differ only by case — they collide on macOS/Windows checkouts, so on a case-insensitive FS edit the existing `Agents.md` instead of adding this file.

## Commands

```bash
find src -name '*.js' -exec node --check {} \;   # syntax gate; run on every touched file
./start.sh                                      # static server; PORT env overrides default 3000
PORT=3109 node "$RUNTIME_DIR/scripts/default-start.mjs"   # what start.sh runs
./capture.sh                                    # OMGithub GPU/SwiftShader capture (see Agents.md)
```

`src/**/*.js` under plain bash has `globstar` off, so it **silently skips `src/main.js`**. Use the `find` form.

Headless sim — the fastest way to test balance and logic (no browser, seconds not minutes):

```bash
node --input-type=module -e "
const E=await import('./src/core/engine.js'),W=await import('./src/world/world.js'),
      S=await import('./src/sim/sim.js'),A=await import('./src/ai/ai.js');
const st=E.makeState({faction:'human',aiFaction:'undead',ai:'expander',fog:'on',speed:1});
const map=W.genMap(42);
S.spawnBase(st,map,0,-30,-30,'human'); S.spawnBase(st,map,1,30,30,'undead'); W.updateFog(st,map);
for(let i=0;i<3000;i++){S.tick(st,map,0.1); if(i%20===0)A.aiTick(st,map); if(st.over)break;}
console.log('over',st.over,'t',st.t.toFixed(0));"
```

AI-vs-AI balance harness (deterministic, self-checks reproducibility, prints per-faction win rates):

```bash
node balance.mjs [seedsPerMatchup=1] [maxMinutes=20]
```

`aiTick(st,map,owner)` takes the owner now (default 1), so the harness drives both sides. Deterministic replays require `resetUID(1)` per run (module-level UID is global) — the harness does this.

Node-importable (no DOM/three at import time): `src/core`, `src/world`, `src/sim`, `src/ai`, `src/missions`, `src/buildings/data.js`, `src/factions/factions.js`. `src/presentation/*` imports `three` — browser only.

Adding a root `package.json` flips the deploy path to Vite and `start.sh` will run `vite build`; don't add one casually.

## Architecture (non-obvious)

- **Engine owns state, presentation owns pixels.** `core/engine.js` holds a plain-object `st` + entity list; `sim/sim.js:tick()` is the only mutator; `main.js:loop()` is a fixed 10 Hz accumulator (`STEP=0.1`, max 5 substeps/frame) decoupled from `requestAnimationFrame`.
- **Resource keys are `gold` / `wood` only.** Never write `st.res[o][kind]` with a raw kind string — `gather` carries `kind2:'gold'|'tree'` and must map `tree → wood` in the deposit branch. This exact bug shipped once.
- **Faction scaling** goes through `factionMult(owner)` → keys `hp/dmg/cost/speed/build/archer/wood/gold`; missing keys must fall back (`?? 1`). Four core factions only (`CORE_FACTIONS`: human/orc/undead/elf); the rest are locked legacy entries — use `coreFaction()` to normalize, and `applyFactionTheme()` (`data-faction` + `.cnr` SVG corners) whenever the selection changes. Entities carry `f` (faction tag) for faction-colored meshes; specials go through `castSpecial(st,map,owner)` with `st.specialCd` cooldowns.
- **Determinism**: `srand(st)` (`engine.js`, mulberry32 seeded from `st.seed`, state serialized as `st.rngState`) is the only RNG allowed in `sim/` or `ai/` — never `Math.random`; projectile ids, AI build spots, unit picks all use it so replays/balance runs reproduce. The crowd-separation tiebreak reads `a.id+b.id`, hence `resetUID(n)` for fresh runs.
- **Instanced trees**: `renderer.treeIM` holds 3 `InstancedMesh` layers (trunk/top/tip); per-instance color = leaf palette, fog/`amount<=0` visibility = zero-scale matrices in `sync()`. Gold stays per-mesh in `resMeshes`. Whole forest ≈ 3 draw calls (battle total ~35).
- **Battle QoL**: double-tap a unit (380 ms window, `lastPat` in `main.js`) selects same-type units within 16; tapping ground with only production buildings selected sets `b.rally` and production spawns walk there (`sim.js` queue branch). The unit dock has an **Attack Move** toggle (`amove`, label flips to `⚔️ Tap target…`) that issues `orderMove(...,true)`; `attackmove` units engage within 7, store `e.am` and resume the march after the kill. Tapping the **minimap** jumps `renderer.target` (ignored in tutorial / `renderer.fixed`). AI pushes are telegraphed via a throttled `⚔️ Enemy army is marching!` toast (`st._pushAt`) and prefer the enemy Town Hall.
- **Mage line**: `BUILDINGS.mage` (Mage Tower, in the More pane) trains `UNITS.mage` (splash 2.4, range 9.5). `fireProjectile(st,src,tgt,dmg,splash=0)` copies splash onto the projectile; on impact it deals full damage to the primary target and 60 % to hostile units in radius (never allies/`proj`/`res`). Building type `'mage'` and unit type `'mage'` intentionally share a string — always disambiguate with `e.cat` (see trap 13).
- **Save/load fog**: `saveGame` persists `map.explored0` (2304 entries, ~5 KB); `startFromSave` restores it then calls `updateFog` to rebuild current sight. Without `explored0` (legacy saves) the base area is simply re-explored. Draws no longer count as losses (`endGame(win,draw)`).
- **AI composition/expansion**: once its Mage Tower stands the AI reserves two army slots for Mages (barracks cap drops 14 → 12); from ~7 min with 3+ farms and 300 gold it pays for a second Town Hall next to a neutral gold vein at least 20 units from the enemy hall. `BUILDINGS.townhall` therefore has a real cost/time (starting halls are spawned directly by `spawnBase` and never pay).
- **Crash/perf surfaces**: `#errbox` overlay wires `error`/`unhandledrejection` in `main.js`; `BUILD` tag renders into `#buildTag`; sandbox `#perf` line shows fps + `renderer.info.render.calls`.
- **Mission layer (`src/missions/`)** is strictly a *reader* of engine state: steps expose `done(ctx)`, `progress(ctx)`, `progressText(ctx)`, `mark`; `MissionRunner.tick()` returns `step-done` / `step-start` / `mission-done` events. It must not mutate the sim — assists go through the exported `order*` functions.
- **Camera**: `renderer.setFixedCamera(on,x,z,dist)` locks framing; `camDistFor`/`fovFor(aspect)` size it per orientation. Input no-ops pan/pinch when `game.isCameraLocked()`.
- **Save/load**: `localStorage` keys `kingdoms-rts-save-v1` (game) and `kingdoms-rts-profile-v1` (meta: wins/losses/achievements/missions).

## Capability entrypoints

| Capability | Where it plugs in |
|---|---|
| **Force inject** | `sim.js` exports `orderMove/orderAttack/orderGather/orderBuild/fireProjectile`; `addEntity`/`pay` for raw state pokes. For a deterministic command layer, copy `kingdoms-rts/src/session/commands.ts` (`Command` union + `CommandLog`) — that AI emits into a sink instead of mutating. |
| **Copycat** | `kingdoms-rts/` is an untracked clone of `xhall-beep/kingdoms-rts` and the reference architecture: deterministic ECS in `src/core`, one-file-per-system `src/systems/`, `src/ai/nav-grid.ts` flow fields, `src/net/` lockstep + snapshots, 20 factions with signature mechanics. Port patterns, don't copy file layout. It is a separate npm/vite project — `npm test` there needs its own `npm install`. |
| **Hyper scale** | Headless loop above (3000 ticks ≈ seconds); `balance.mjs` runs the full 4×3 AI-vs-AI matrix with per-faction win rates; in-browser `window.__game.st.speed = 6` fast-forwards the accumulator. Batch harness patterns: `kingdoms-rts/src/tests/match-runner.ts:runMatch`, `perf.ts:benchmark`. |
| **Auto-all** | `playwright-cli` drives a real browser: `open` → `eval` (inject JS) → `screenshot` → `close`. Output lands in `$HOME/.local/share/omgithub-playwright/output/`, not the repo (`screenshots/` is gitignored too). |
| **Access-all** | `window.__game` = `{st, map, sel, renderer, mission, paused, running}` live getters (`main.js`). It is non-null **on the menu too** — the boot demo scene owns a state, so `__game.st` existing does not mean a match is running. |
| **Fix-it** | Traps below are the recurring classes; headless sim → browser re-verify is the standard loop. |

## Traps that cost real debugging time

1. **`renderer` may already exist before `begin()`** — the boot demo scene creates it. Input is bound via the `renderer._bound` flag; never assume `!renderer`.
2. **Entity IDs collide after load** — module-level `UID` resets per page load. `startFromSave` must call `reseedUID(st)`, or restored meshes get hijacked by new entities and buildings teleport.
3. **Taps outside the map** project to garbage world coords; they used to become "move to nowhere" orders. `onTap` rejects `|x|>WORLD/2`.
4. **Selection-card rebuilds steal taps** — `renderSelLive()` is signature-gated (~1 Hz, only on visible change). Keep it; a per-frame `innerHTML` rebuild makes the game unplayable on touch.
5. **Tap window is 22 px / 600 ms.** `playwright-cli click` is slower than that → drive taps via `eval`, dispatching `pointerdown`+`pointerup` in the same JS task. Synthetic ids make `setPointerCapture` throw, so it must stay in `try{}catch{}`.
6. **Tutorial pick prefers units over buildings** (two-pass pick), otherwise the Town Hall eats the tap meant for the peasant standing beside it.
7. **Objectives must count income, not the bank** — `MissionRunner.gainedWood` sums positive deltas only, so buying a farm mid-objective can't un-complete "gather 120 wood". Non-finite readings must be ignored, not accumulated.
8. **Mission UI must keep updating after `done`** — gate the *runner* on `!mission.done`, not the UI update, or the bar freezes on the last step.
9. **Tutorial content must fit the fixed camera.** Portrait widens FOV (`fovFor`) and nodes sit within ~15 units; anything off-screen is unreachable by thumb. Verified reachable: ~65 trees + all gold in portrait.
10. **Reload after editing.** The static server sends `no-cache` without validators, and edited ES modules were observed serving stale — `playwright-cli reload` before re-testing.
11. **Don't `git add -A` blindly**: `kingdoms-rts/` is an (empty) gitlink/submodule pointer, not vendored source — never stage it.
12. **Never gate UI on `st.tick%N===0` in `loop()`** — on slow frames (headless SwiftShader ≈10 fps, `dt` clamps to 0.1) `acc` overshoots the 5-substep cap, `st.tick` advances by a fixed +5 stride per frame, and the residue never reaches 0: mission bar, coach mark, and sel-card refresh all freeze while the sim keeps running. `st.tick%N` is safe *inside* `tick()` (per-tick); frame-level throttles must use wall-clock accumulators (`uiAcc`, `selAcc`) and `acc` must be clamped after the while loop.
13. **`type:'mage'` exists in both tables.** `UNITS.mage` (unit) and `BUILDINGS.mage` (Mage Tower) share the string, and `nb(t)`/`e.type===` filters do not disambiguate. Always add `e.cat==='bld'|'unit'` when querying one of them (the AI does), or you will count/select the wrong entity.

## Browser verification recipe

```bash
playwright-cli install-browser chromium     # first run only; the cache is often missing chrome-linux64/chrome
PORT=3109 node "$RUNTIME_DIR/scripts/default-start.mjs" &
playwright-cli open http://localhost:3109
playwright-cli resize 390 844               # portrait; 844 390 for landscape
playwright-cli eval "() => document.getElementById('tut-step').textContent"
playwright-cli screenshot
```

Verify both orientations for any camera/UI change; `body.tut` (set in tutorial mode) moves toasts to the bottom.