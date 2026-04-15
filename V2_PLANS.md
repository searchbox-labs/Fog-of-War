Current Plan
     /Users/koded/.claude/plans/witty-marinating-fog.md

     Fog of War — Peak Frontend Visual Overhaul

     Context

     The current game frontend uses a hand-rolled HTML5 Canvas renderer in
     Game.jsx. It renders flat colors, static minion-ish sprites on a dark grid,
     and a basic fog layer. The result looks rough and unpolished — shared in a group
      chat and noticeably "weird". The goal is a full visual overhaul to achieve a
     Dark Fantasy / Military aesthetic: stone dungeon tilemap, armored soldier
     sprites with animations, blood-red + slate UI, dynamic fog-of-war, and particle
     effects. We're migrating the renderer to Phaser 3 (WebGL-accelerated, full
     game framework) while keeping React for screens/HUD. Priority: game canvas
     first, then UI screens.

     ---
     Architecture

     How Phaser 3 + React Coexist

     - Phaser renders to its own <canvas> element inside Game.jsx
     - React manages all DOM UI: Landing, Lobby, HUD overlay, Results
     - Zustand store remains the single source of truth — Phaser scene subscribes to
     store updates via store.subscribe()
     - No rearchitecting the gRPC layer or state shape

     New Directory Structure

     src/
     ├── game/                         ← NEW: all Phaser code lives here
     │   ├── index.js                  ← Phaser.Game factory + config
     │   ├── scenes/
     │   │   ├── PreloadScene.js       ← asset loading with progress bar
     │   │   └── GameScene.js          ← main game scene (replaces canvas logic)
     │   ├── systems/
     │   │   ├── FogSystem.js          ← fog-of-war render texture + mask
     │   │   ├── ParticleSystem.js     ← hit sparks, footprints, loot glow
     │   │   └── LightSystem.js        ← Phaser PointLight for dynamic lighting
     │   └── constants.js              ← TILE_SIZE, GRID, colors, etc.
     ├── components/
     │   ├── Game.jsx                  ← mounts Phaser canvas, destroys on unmount
     │   ├── HUD.jsx                   ← stays React DOM overlay (minor polish)
     │   └── ... (Landing, Lobby, Results — UI overhaul phase 2)
     └── store.js                      ← unchanged

     ---
     Implementation Plan

     Step 1 — Install Phaser 3

     npm install phaser
     File: package.json

     Step 2 — Phaser Game Factory (src/game/index.js)

     Create Phaser.Game instance with:
     - type: Phaser.AUTO (WebGL with Canvas fallback)
     - scene: [PreloadScene, GameScene]
     - backgroundColor: '#050508'
     - pixelArt: false (we want smooth sprites for dark fantasy)
     - scale: { mode: Phaser.Scale.FIT, autoCenter: CENTER_BOTH }
     - No physics plugin needed (server is authoritative)
     - Light2D pipeline enabled for dynamic lighting

     Step 3 — Game.jsx Refactor

     Replace the entire useEffect canvas logic with:
     useEffect(() => {
       const game = createPhaserGame(containerRef.current)
       return () => game.destroy(true)  // cleanup on unmount
     }, [])
     The Phaser game mounts inside containerRef, keyboard/touch input handled by
     Phaser (forwarded to move() / attack() via store actions).

     Step 4 — PreloadScene (src/game/scenes/PreloadScene.js)

     Load all assets with a styled loading bar (dark slate + orange progress):
     - Tilemap: assets/tilemaps/dungeon.json + tileset image (Kenney Dungeon
     Crawler Redux or custom dark stone tiles)
     - Character spritesheet: assets/sprites/soldiers.png — 8 characters × 4
     directions × 4 walk frames + 2 attack frames (format: Aseprite or LPC-style)
     - Weapon sprites: assets/sprites/weapons.png — sword, axe, bow etc.
     (user-sourced)
     - Chest sprite: assets/sprites/chest.png — animated open/idle (2 frames)
     - Particles: assets/fx/spark.png, assets/fx/blood.png,
     assets/fx/fog_puff.png
     - UI skin: assets/ui/panel_dark.png, assets/ui/hp_bar.png

     Recommended free asset sources:
     - Kenney.nl Dungeon Crawler
     Redux — dark stone
     tiles, perfect for this style
     - LPC (Liberated Pixel Cup) — armored character
     sprites with walk/attack animations
     - itch.io: Dungeon Tileset II —
     extremely polished dark dungeon tiles (free)

     Step 5 — GameScene Core (src/game/scenes/GameScene.js)

     5a. Tilemap Rendering

     - Load Tiled JSON map (or generate procedurally via Phaser's tilemap API)
     - Layers:
       - ground — stone floor tiles (varied for visual noise)
       - walls — impassable dark stone walls around edges + scattered obstacles
       - decor — cracks, moss, bones, torches (Phaser static group)
       - shadows — pre-baked shadow tiles under walls

     5b. Player & NPC Sprites (replacing drawPlayerSprite)

     - this.add.sprite(x, y, 'soldiers') for each player/NPC
     - Phaser Animation Manager:
     anims.create({ key: 'walk-down', frames: frameRange(0, 3), frameRate: 8,
     repeat: -1 })
     anims.create({ key: 'attack-down', frames: frameRange(8, 9), frameRate: 12,
     repeat: 0 })
     - Player sprites in a this.players Map, keyed by player ID
     - Smooth movement: this.tweens.add({ targets: sprite, x, y, duration: 100 })
     (replaces manual interpolation)
     - HP bars: Phaser Graphics objects that follow sprites each tick
     - Combat flash: sprite.setTintFill(0xffffff) then clearTint() after 150ms

     5c. Store Subscription

     // In scene's create():
     useStore.subscribe(state => state.players, this.syncPlayers.bind(this))
     useStore.subscribe(state => state.npcs, this.syncNPCs.bind(this))
     useStore.subscribe(state => state.treasures, this.syncTreasures.bind(this))
     syncPlayers() creates/moves/removes sprites as server state changes.

     5d. Camera

     - Camera follows local player: this.cameras.main.startFollow(playerSprite, true, 0.1, 0.1)
     - World bounds = full tilemap size (128×16 = 2048px)
     - Zoom: camera.setZoom(2) for pixel-perfect feel on desktop; 1.5 on mobile

     Step 6 — Fog of War System (src/game/systems/FogSystem.js)

     Replace the basic fog canvas with a proper layered system:
     1. Fog texture: this.add.renderTexture(0, 0, mapW, mapH) filled solid dark
      (alpha 0.85)
     2. Visibility mask: Each frame, erase a radial gradient around player
     position (5-tile radius)
     3. Explored areas: Keep a persistent "seen" bitmask;
     explored-but-not-visible tiles render at ~40% fog opacity
     4. Fog particle ambient: 20-30 slow-drifting fog_puff.png particles at fog
      edge (ParticleEmitter)
     5. Mist shader (optional stretch): Phaser custom pipeline for animated fog
     distortion

     Step 7 — Particle System (src/game/systems/ParticleSystem.js)

     Events triggered by store state changes or game events:
     - Combat hit: Red spark burst at target position (blood.png, 8 particles,
     200ms)
     - Loot pickup: Gold sparkle ring + floating +N text (TweenChain: scale up
     → fade out)
     - Footprints: Replace heatmap with actual footstep sprites that fade over 3s
     - Death: Large blood burst + sprite fade + disintegrate tween
     - Chest open: Shimmer burst when treasure spawns
     - Blood Hunt: Screen-edge red vignette pulse (DOM overlay, CSS animation)

     Step 8 — Dynamic Lighting (src/game/systems/LightSystem.js)

     Phaser 3 has built-in PointLight objects:
     - Player: warm orange torch light (0xff8844, radius 200px, intensity 2)
     - Treasure chests: soft gold glow (0xffd700, radius 80px, flickering)
     - Torches on walls (decor layer): amber flicker using sine-wave intensity update
      in update()
     - NPCs: dim red glow when in attack range (0xff2244, radius 60px)

     Enabling: set pipeline: 'Light2D' on tilemap layers and sprites.

     Step 9 — Dark Fantasy UI Palette Update

     Update CSS variables in existing components:
     --bg: #0a0608;           /* deep blood-black */
     --surface: #120d10;      /* dark maroon surface */
     --border: #2a1520;       /* dark wine border */
     --accent: #c0392b;       /* blood red (replaces orange) */
     --accent2: #e74c3c;      /* brighter red hover */
     --gold: #d4af37;         /* military gold */
     --safe: #2ecc71;
     --cold: #8b9dc3;         /* slate blue */
     --text: #ddd0c8;         /* warm off-white */
     --muted: #6b5a5e;
     Also update: HUD.jsx HP bars (green→red at low health, slate panel
     background), timer styling, leaderboard.

     Step 10 — Mobile Input via Phaser

     Replace MobileControls.jsx d-pad with:
     - Phaser virtual joystick (or keep React controls but forward touch events via
     store actions)
     - Attack button stays as DOM element (easier styling)

     ---
     Assets Action Plan (Things YOU Need to Source)

     ┌────────────────────────────────────────────────────┬────────────────────────────────────────────────────────┬────────────────┐
     │                       Asset                        │                         Source                         │     Format     │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ Dungeon tileset                                    │ [0x72 Dungeon Tileset                                  │                │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ II](https://0x72.itch.io/dungeontileset-ii) (free) │ PNG + Tiled JSON                                       │                │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ Soldier characters                                 │ LPC Spritesheet Generator (opengameart.org) or Itch.io │                │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ PNG spritesheet, 64×64 per frame                   │                                                        │                │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ Weapon sprites                                     │ User-sourced — any top-down RPG weapon pack            │ PNG or         │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ spritesheet                                        │                                                        │                │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ Chest animated                                     │ Included in Dungeon Tileset II                         │ Spritesheet    │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ Particle FX                                        │ Kenney Particle Pack (free)                            │ PNG frames     │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ UI skin panels                                     │ Kenney UI Pack (dark theme) or custom CSS              │ PNG 9-patch or │
     ├────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────┤
     │ CSS                                                │                                                        │                │
     └────────────────────────────────────────────────────┴────────────────────────────────────────────────────────┴────────────────┘

     ---
     Critical Files Being Modified

     ┌─────────────────────────┬─────────────────────────────────────────────┐
     │          File           │                   Change                    │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ package.json            │ Add phaser dependency                       │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ src/components/Game.jsx │ Replace canvas logic → Phaser mount/unmount │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ src/components/Game.css │ Remove canvas-specific styles, add Phaser   │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ container styles        │                                             │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ src/components/HUD.jsx  │ Minor palette + visual polish               │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ src/components/HUD.css  │ Dark fantasy color updates                  │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ src/store.js            │ No changes                                  │
     ├─────────────────────────┼─────────────────────────────────────────────┤
     │ src/socket.js           │ No changes                                  │
     └─────────────────────────┴─────────────────────────────────────────────┘

     New files:
     - src/game/index.js
     - src/game/scenes/PreloadScene.js
     - src/game/scenes/GameScene.js
     - src/game/systems/FogSystem.js
     - src/game/systems/ParticleSystem.js
     - src/game/systems/LightSystem.js
     - src/game/constants.js
     - public/assets/ — all game assets

     ---
     Verification

     1. npm run dev — game loads, Phaser canvas visible, no console errors
     2. Start solo mode → tilemap renders, player sprite appears with walk animation
     3. Move player → camera follows, fog reveals around player, explored areas dim
     at fog edge
     4. Bot combat → hit particles burst, HP bar updates, death animation plays
     5. Loot pickup → gold sparkle + floating text
     6. Dynamic lighting → torch glow visible on tilemap
     7. Mobile: d-pad controls work, canvas scales correctly
     8. Network game → multiplayer sprites render, sync correctly from gRPC state

     "/plan open" to edit this plan in Vim


     claude --resume faca11cb-8e14-402a-8cea-c9d8d1280f0c

      /plugin install frontend-design@claude-plugins-official





















       BGM (large .mp3) is kicked off last.
  - A _started guard prevents double-firing on React StrictMode remount.

  When Phaser's loader then runs this.load.image(key, url) / this.load.audio(key, url) for those exact same URLs, the browser returns them from cache — the loading bar flies through in under a second instead
  of waiting on the network.

✻ Churned for 3m 8s

❯ revert all the changes you made please                                                                                                                                                                         

⏺ Bash(git diff --stat HEAD)
  ⎿  (No output)

⏺ Bash(git log --oneline -5)
  ⎿  5da86bd (feat): prefetch game utilities for faster loading
     4f910c8 (whip): Safari mobile controls
     87f8e24 (whip): Go build bugs
     … +2 lines (ctrl+o to expand)

⏺ Bash(git show --stat 5da86bd && git show --stat 4f910c8)
  ⎿  commit 5da86bddc8241f07b1535a6996b84e7826f41a9a
     Author: Raufu Abdulraman <coder0214h@gmail.com>
     Date:   Wed Apr 15 01:26:25 2026 +0100
     … +15 lines (ctrl+o to expand)

⏺ Bash(git log --oneline -10)
  ⎿  5da86bd (feat): prefetch game utilities for faster loading
     4f910c8 (whip): Safari mobile controls
     87f8e24 (whip): Go build bugs
     … +7 lines (ctrl+o to expand)

⏺ Let me check what my changes specifically touched across the commits:

⏺ Bash(git log --oneline --all -- fog-of-war/client/src/game/scenes/GameScene.js fog-of-war/client/src/game/scenes/PreloadScene.js fog-of-war/client/src/game/index.js…)
  ⎿  5da86bd (feat): prefetch game utilities for faster loading
     216a094 (feat): weapons
     817366f (feat): Sound Effects
     … +4 lines (ctrl+o to expand)

⏺ The prefetchAssets work is one clean commit (5da86bd). The camera/console.log fixes are spread across earlier commits that the user has since built on top of (weapons, sounds, etc.) — so reverting those
  would affect the user's own work too.

  Let me revert the prefetchAssets commit cleanly first, then figure out if there's more to undo:

⏺ Bash(git revert 5da86bd --no-edit)
  ⎿  [main 8afbb7f] Revert "(feat): prefetch game utilities for faster loading"
      Date: Wed Apr 15 01:31:26 2026 +0100
      2 files changed, 3 insertions(+), 111 deletions(-)
      delete mode 100644 fog-of-war/client/src/game/prefetchAssets.js

⏺ That cleans up prefetchAssets.js and App.jsx.

  For the other changes I made (camera snap fix in GameScene.js, console.log removals in GameScene.js, FogSystem.js, PreloadScene.js, index.js) — those are spread across commits that the user has since built
  on top of (weapons, sounds, Safari mobile controls). Reverting those commits would pull out the user's own work too.

  Which of these do you also want undone?
  - The camera snap fix (moved snap from create() to update())
  - The console.log removals across GameScene / FogSystem / PreloadScene / index.js

  If yes, it's easier for me to manually restore those specific changes in the files rather than reverting whole commits.

✻ Brewed for 1m 31s

─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯                                                                                                                                                                             
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  Press Ctrl-C again to exit             

Resume this session with:
claude --resume 518e3a3a-e290-425e-8905-e629c785ae4d
(base) koded@Kodeds-MacBook-Pro Fog-of-War % 