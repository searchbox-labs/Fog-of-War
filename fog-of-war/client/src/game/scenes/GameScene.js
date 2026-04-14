import Phaser from 'phaser';
import { useGameStore } from '../../store.js';
import FogSystem   from '../systems/FogSystem.js';
import ParticleSystem from '../systems/ParticleSystem.js';
import LightSystem  from '../systems/LightSystem.js';
import { CHAR_NAMES } from './PreloadScene.js';
import { setTileMap } from '../tileMap.js';
import {
  TILE, GRID_W, GRID_H, WORLD_W, WORLD_H,
  FOG_RADIUS, SPAWN_X, SPAWN_Y,
  TILE_VOID, TILE_FLOOR, TILE_FLOOR2, TILE_WALL,
  CHAR_COLORS,
  DEPTH_GROUND, DEPTH_DECOR, DEPTH_FOOTPRINT,
  DEPTH_TREASURE, DEPTH_ENTITY, DEPTH_FOG,
  DEPTH_BLOODHUNT, DEPTH_UI,
  COLOR_GOLD, COLOR_DANGER, COLOR_SAFE,
} from '../constants.js';

const MOVE_LERP = 0.18;   // sprite interpolation factor
const ANIM_THRESHOLD = 0.5; // distance threshold to trigger run animation
const TORCH_INTERVAL = 40; // place a torch every N wall-adjacent floor tiles (fewer = more GPU load)

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  // ── Phaser lifecycle ──────────────────────────────────────────────────

  create() {
    // Systems
    this.fog        = new FogSystem(this);
    this.particles  = new ParticleSystem(this);
    this.lighting   = new LightSystem(this);

    // State tracking
    this._myId           = null;
    this._myTilePos      = { x: SPAWN_X, y: SPAWN_Y };
    this._myDisplayPos   = { x: (SPAWN_X + 0.5) * TILE, y: (SPAWN_Y + 0.5) * TILE };
    this._mySprite       = null;
    this._myHpBar        = null;
    this._prevMyHp       = 100;

    this._entitySprites  = new Map();
    this._treasureSprites = new Map();
    this._footprints     = [];
    this._bloodHuntGfx   = null;
    this._borderGfx      = null;
    this._tileMap        = null;

    // World bounds
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    // No camera bounds — allows centering player on screen even at map edges
    // this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

    // Procedural dungeon
    this._buildDungeon();

    // Player sprite
    const state = useGameStore.getState();
    this._myId = state.myId;
    
    // Use the store's current position if available, else SPAWN_X/Y.
    const startX = state.myPos?.x ?? SPAWN_X;
    const startY = state.myPos?.y ?? SPAWN_Y;
    this._myTilePos = { x: startX, y: startY };
    this._myDisplayPos = {
      x: (startX + 0.5) * TILE,
      y: (startY + 0.5) * TILE,
    };

    this._createMySprite(state);

    this.cameras.main.setZoom(this._getZoom());
    
    // Explicitly center the camera on the player's initial position.
    this.cameras.main.centerOn(this._myDisplayPos.x, this._myDisplayPos.y);
    
    // Start following the player sprite with smooth lerp (0.1, 0.1).
    if (this._mySprite) {
      this.cameras.main.startFollow(this._mySprite, true, 0.1, 0.1);
    }
    
    this._cameraSnapped = false;

    // Map border (drawn over fog so always visible)
    this._drawBorder();

    // Subscribe to store changes.
    // Zustand v5 dropped the subscribe(selector, callback) overload — the only
    // supported signature is subscribe((state, prevState) => void).
    // One consolidated listener with manual per-field change detection replaces
    // the old selector-per-field approach.
    this._unsubs = [
      useGameStore.subscribe((state, prev) => {
        if (state.myId !== prev.myId) {
          this._myId = state.myId;
        }

        if (state.myPos !== prev.myPos && state.myPos) {
          const isFirstPos = !prev.myPos;
          this._myTilePos = { x: state.myPos.x, y: state.myPos.y };
          this._addFootprint(state.myPos.x, state.myPos.y);

          // On first valid position, snap display pos immediately so the camera 
          // doesn't lerp from the map center (SPAWN_X/Y).
          if (isFirstPos) {
            this._myDisplayPos = {
              x: (state.myPos.x + 0.5) * TILE,
              y: (state.myPos.y + 0.5) * TILE,
            };
            this._cameraSnapped = false; // Re-snap on next update frame
          }
        }

        if (state.myHp !== prev.myHp) {
          this._prevMyHp = state.myHp;
          if (state.myHp < prev.myHp && this._mySprite) {
            this.particles.flashSprite(this._mySprite);
            this.particles.combatHit(this._myTilePos.x, this._myTilePos.y);
          }
        }

        if (state.players   !== prev.players)   this._syncPlayers(state.players);
        if (state.npcs      !== prev.npcs)       this._syncNPCs(state.npcs);
        if (state.treasures !== prev.treasures)  this._syncTreasures(state.treasures);
        if (state.footprints !== prev.footprints) this._syncFootprints(state.footprints);
      }),
    ];

    // Listen for combat flash events from React
    this._onCombatFlash = () => {
      if (this._mySprite) this.particles.flashSprite(this._mySprite);
    };
    this._onLootPickup = (e) => {
      const { x, y } = e.detail;
      this.particles.lootPickup(x, y);
    };
    window.addEventListener('fog:combat_flash', this._onCombatFlash);
    window.addEventListener('fog:loot_pickup', this._onLootPickup);

    // Initial state sync
    const s = useGameStore.getState();
    this._syncPlayers(s.players);
    this._syncNPCs(s.npcs);
    this._syncTreasures(s.treasures);

    // Handle window resize
    this.scale.on('resize', (gameSize) => {
      const { width, height } = gameSize;
      this.cameras.main.setViewport(0, 0, width, height);
      this.cameras.main.setZoom(this._getZoom());
      this._snapCameraToPlayer();
    });
  }

  update(time, delta) {
    const state = useGameStore.getState();

    // ── Smooth-move my sprite ────────────────────────────────────────
    const targetX = this._myTilePos.x * TILE + TILE / 2;
    const targetY = this._myTilePos.y * TILE + TILE / 2;
    
    const dx = targetX - this._myDisplayPos.x;
    const dy = targetY - this._myDisplayPos.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    this._myDisplayPos.x = Phaser.Math.Linear(this._myDisplayPos.x, targetX, MOVE_LERP);
    this._myDisplayPos.y = Phaser.Math.Linear(this._myDisplayPos.y, targetY, MOVE_LERP);

    if (this._mySprite) {
      this._mySprite.setPosition(this._myDisplayPos.x, this._myDisplayPos.y);
      this._updateHpBar(this._myHpBar, this._mySprite.x, this._mySprite.y - 12, state.myHp);
      this.lighting.movePlayerLight(this._mySprite.x, this._mySprite.y);

      // Bright marker ABOVE the fog so the player is always findable
      if (!this._playerMarker) {
        this._playerMarker = this.add.graphics().setDepth(DEPTH_FOG + 5);
      }
      this._playerMarker.clear();
      // Outer ring — bright green
      this._playerMarker.lineStyle(2, 0x00ff88, 0.9);
      this._playerMarker.strokeCircle(this._mySprite.x, this._mySprite.y, 10);
      // Small dot at center
      this._playerMarker.fillStyle(0x00ff88, 1);
      this._playerMarker.fillCircle(this._mySprite.x, this._mySprite.y, 2);

      // Animation switching
      const charIdx = state.selectedCharacter ?? 0;
      if (dist > ANIM_THRESHOLD) {
        this._mySprite.play(`${charIdx}_run`, true);
        if (dx !== 0) this._mySprite.setFlipX(dx < 0);
      } else {
        this._mySprite.play(`${charIdx}_idle`, true);
      }
    }

    // ── Smooth-move other entities ────────────────────────────────────
    this._entitySprites.forEach((ent) => {
      const edx = ent.targetX - ent.displayX;
      const edy = ent.targetY - ent.displayY;
      const edist = Math.sqrt(edx*edx + edy*edy);

      ent.displayX = Phaser.Math.Linear(ent.displayX, ent.targetX, MOVE_LERP);
      ent.displayY = Phaser.Math.Linear(ent.displayY, ent.targetY, MOVE_LERP);
      ent.sprite.setPosition(ent.displayX, ent.displayY);
      this._updateHpBar(ent.hpBar, ent.displayX, ent.displayY - 12, ent.hp);

      // Animation switching
      if (edist > ANIM_THRESHOLD) {
        ent.sprite.play(`${ent.charIdx}_run`, true);
        if (edx !== 0) ent.sprite.setFlipX(edx < 0);
      } else {
        ent.sprite.play(`${ent.charIdx}_idle`, true);
      }
    });

    // ── Camera smooth-follow ─────────────────────────────────────────────
    {
      const cam = this.cameras.main;
      if (!this._cameraSnapped && cam.width > 0) {
        cam.centerOn(this._myDisplayPos.x, this._myDisplayPos.y);
        this._cameraSnapped = true;
      }
    }

    // ── Fog update ────────────────────────────────────────────────────
    this.fog.update(this._myTilePos.x, this._myTilePos.y);

    // ── Lighting flicker ──────────────────────────────────────────────
    this.lighting.update(delta);

    // ── Treasure pulse ────────────────────────────────────────────────
    const pulse = 0.85 + 0.15 * Math.sin(time * 0.003);
    this._treasureSprites.forEach(({ sprite }) => {
      sprite.setScale(pulse * (14 / 16), pulse * (14 / 16));
    });

    // ── Footprint fade ────────────────────────────────────────────────
    const now = Date.now();
    this._footprints = this._footprints.filter(fp => {
      const age = (now - fp.ts) / 1000;
      if (age > 10) { fp.sprite.destroy(); return false; }
      const alpha = age < 2 ? 0.75 : age < 6 ? 0.5 : 0.35;
      fp.sprite.setAlpha(alpha);
      return true;
    });

    // ── Blood Hunt beacon ─────────────────────────────────────────────
    if (state.bloodHuntActive && state.bloodHuntTarget) {
      this._drawBloodHuntBeacon(state, time);
    } else if (this._bloodHuntGfx) {
      this._bloodHuntGfx.setVisible(false);
    }

    // ── Chest bob ─────────────────────────────────────────────────────
    const bob = Math.sin(time * 0.004) * 0.8;
    this._treasureSprites.forEach(({ sprite }) => {
      sprite.y = sprite.getData('baseY') + bob;
    });
  }

  // ── Dungeon generation ────────────────────────────────────────────────

  _buildDungeon() {
    // Generate tile map
    this._tileMap = Array.from({ length: GRID_H }, () => new Uint8Array(GRID_W).fill(TILE_WALL));

    // Carve rooms
    const rooms = [];
    for (let attempt = 0; attempt < 80; attempt++) {
      const rw = 5 + Math.floor(Math.random() * 10);
      const rh = 5 + Math.floor(Math.random() * 10);
      const rx = 2 + Math.floor(Math.random() * (GRID_W - rw - 4));
      const ry = 2 + Math.floor(Math.random() * (GRID_H - rh - 4));

      let overlap = false;
      for (const r of rooms) {
        if (rx < r.x + r.w + 2 && rx + rw > r.x - 2 &&
            ry < r.y + r.h + 2 && ry + rh > r.y - 2) {
          overlap = true; break;
        }
      }
      if (!overlap) rooms.push({ x: rx, y: ry, w: rw, h: rh });
      if (rooms.length >= 30) break;
    }

    // Guarantee spawn room
    rooms.unshift({ x: SPAWN_X - 4, y: SPAWN_Y - 4, w: 9, h: 9 });

    // Carve each room
    rooms.forEach(({ x, y, w, h }) => {
      for (let ty = y; ty < y + h; ty++) {
        for (let tx = x; tx < x + w; tx++) {
          this._tileMap[ty][tx] = Math.random() < 0.08 ? TILE_FLOOR2 : TILE_FLOOR;
        }
      }
    });

    // Connect rooms with L-shaped corridors
    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1];
      const b = rooms[i];
      const ax = Math.floor(a.x + a.w / 2);
      const ay = Math.floor(a.y + a.h / 2);
      const bx = Math.floor(b.x + b.w / 2);
      const by = Math.floor(b.y + b.h / 2);
      const minX = Math.min(ax, bx), maxX = Math.max(ax, bx);
      const minY = Math.min(ay, by), maxY = Math.max(ay, by);
      for (let tx = minX; tx <= maxX; tx++) {
        this._tileMap[ay][tx] = TILE_FLOOR;
        if (ay > 0) this._tileMap[ay - 1][tx] = this._tileMap[ay - 1][tx] === TILE_WALL ? TILE_FLOOR : this._tileMap[ay - 1][tx];
      }
      for (let ty = minY; ty <= maxY; ty++) {
        this._tileMap[ty][bx] = TILE_FLOOR;
      }
    }

    // Render tiles and scatter torches in one pass
    this._renderTiles();

    // Publish the tile map so Game.jsx can do client-side collision checks
    setTileMap(this._tileMap);
  }

  _renderTiles() {
    const keyFor = (t, tx, ty) => {
      if (t === TILE_FLOOR)  return `floor_${1 + Math.floor(Math.random() * 8)}`;
      if (t === TILE_FLOOR2) return 'floor_2';
      if (t === TILE_WALL) {
        // Wall directly above a floor tile: show the lighter "top" face
        const southFloor = ty + 1 < GRID_H &&
          (this._tileMap[ty + 1][tx] === TILE_FLOOR || this._tileMap[ty + 1][tx] === TILE_FLOOR2);
        if (southFloor) {
          const leftFloor  = tx > 0 && (this._tileMap[ty + 1][tx - 1] === TILE_FLOOR || this._tileMap[ty + 1][tx - 1] === TILE_FLOOR2);
          const rightFloor = tx + 1 < GRID_W && (this._tileMap[ty + 1][tx + 1] === TILE_FLOOR || this._tileMap[ty + 1][tx + 1] === TILE_FLOOR2);
          if (!leftFloor && rightFloor)  return 'wall_top_left';
          if (leftFloor  && !rightFloor) return 'wall_top_right';
          return 'wall_top_mid';
        }
        return 'wall_mid';
      }
      return null;
    };

    // Use a RenderTexture to draw the entire map once for performance.
    // Deliberately NOT using Light2D pipeline on the tilemap — applying dynamic
    // lighting shaders to a 2048×2048 texture every frame is a major GPU cost.
    // Sprites still use Light2D so characters glow near torches.
    const rt = this.add.renderTexture(0, 0, WORLD_W, WORLD_H)
      .setOrigin(0, 0)
      .setDepth(DEPTH_GROUND);

    // Batch draw tiles to the RenderTexture
    for (let ty = 0; ty < GRID_H; ty++) {
      for (let tx = 0; tx < GRID_W; tx++) {
        const t = this._tileMap[ty][tx];
        const key = keyFor(t, tx, ty);
        if (key) {
          rt.draw(key, tx * TILE, ty * TILE);
        }
      }
    }

    // Also draw torches into the RenderTexture decor layer
    this._placeTorches(rt);
  }

  _placeTorches(rt) {
    let count = 0;
    for (let ty = 1; ty < GRID_H - 1; ty++) {
      for (let tx = 1; tx < GRID_W - 1; tx++) {
        if (this._tileMap[ty][tx] !== TILE_FLOOR) continue;
        // Is there a wall above?
        if (this._tileMap[ty - 1][tx] === TILE_WALL) {
          count++;
          if (count % TORCH_INTERVAL === 0) {
            const wx = (tx + 0.5) * TILE;
            const wy = ty * TILE;
            this.lighting.addTorchLight(wx, wy);

            // Draw torch visual into the RenderTexture if available
            if (rt) {
              const mount = this.make.graphics({ x: 0, y: 0, add: false });
              mount.fillStyle(0x443322, 1);
              mount.fillRect(wx - 1, wy - 4, 2, 4);
              mount.fillStyle(0xff8844, 1);
              mount.fillCircle(wx, wy - 4, 2);
              rt.draw(mount);
              mount.destroy();
            }
          }
        }
      }
    }
  }

  // ── My player ─────────────────────────────────────────────────────────

  _createMySprite(state) {
    const charIdx = state.selectedCharacter ?? 0;
    const charName = CHAR_NAMES[charIdx];
    const wx = this._myDisplayPos.x;
    const wy = this._myDisplayPos.y;

    const textureKey = `${charName}_idle_f0`;

    this._mySprite = this.add.sprite(wx, wy, textureKey)
      .setDepth(DEPTH_ENTITY + 1)
      .setDisplaySize(18, 18);

    this._mySprite.play(`${charIdx}_idle`);
    this._myHpBar = this._createHpBar();
  }

  // ── HP bars ───────────────────────────────────────────────────────────

  _createHpBar() {
    const g = this.add.graphics().setDepth(DEPTH_ENTITY + 5);
    return g;
  }

  _updateHpBar(gfx, cx, cy, hp) {
    if (!gfx) return;
    gfx.clear();
    const w = 14, h = 2;
    const x = cx - w / 2;
    // Background
    gfx.fillStyle(0x000000, 0.7);
    gfx.fillRect(x, cy, w, h);
    // Fill
    const pct = Math.max(0, Math.min(1, hp / 100));
    const color = hp > 50 ? 0x2ecc71 : hp > 25 ? 0xe67e22 : 0xff2244;
    gfx.fillStyle(color, 1);
    gfx.fillRect(x, cy, w * pct, h);
  }

  // ── Entity sync (players, NPCs/bots) ──────────────────────────────────

  _syncPlayers(players) {
    if (!players) return;
    const myId = this._myId;

    // Remove dead or gone players
    this._entitySprites.forEach((ent, id) => {
      if (id.startsWith('npc_')) return; // managed by syncNPCs
      if (!players[id] || players[id].status === 'eliminated') {
        if (players[id]?.status === 'eliminated') {
          this.particles.entityDeath(
            Math.round(ent.targetX / TILE - 0.5),
            Math.round(ent.targetY / TILE - 0.5),
          );
        }
        this._destroyEntity(id);
      }
    });

    // Create or update
    Object.entries(players).forEach(([id, p]) => {
      if (id === myId) return;
      if (p.status === 'eliminated') return;

      const wx = (p.pos.x + 0.5) * TILE;
      const wy = (p.pos.y + 0.5) * TILE;
      const charIdx = p.character_idx ?? 1;

      if (!this._entitySprites.has(id)) {
        this._spawnEntity(id, wx, wy, charIdx, p.hp ?? 100);
      } else {
        const ent = this._entitySprites.get(id);
        const prevHp = ent.hp;
        ent.targetX = wx;
        ent.targetY = wy;
        if (p.hp < prevHp) {
          this.particles.combatHit(p.pos.x, p.pos.y);
          this.particles.flashSprite(ent.sprite);
        }
        ent.hp = p.hp ?? 100;
        ent.charIdx = charIdx;
      }
    });
  }

  _syncNPCs(npcs) {
    if (!npcs) return;

    // Build set of current NPC ids
    const currentIds = new Set((npcs || []).map((n, i) => n.id ?? `npc_${i}`));

    // Remove gone NPCs
    this._entitySprites.forEach((_, id) => {
      if (id.startsWith('npc_') && !currentIds.has(id)) {
        this._destroyEntity(id);
      }
    });

    // Create/update
    (npcs || []).forEach((npc, i) => {
      const id = npc.id ?? `npc_${i}`;
      if (npc.status === 'eliminated') {
        if (this._entitySprites.has(id)) {
          const ent = this._entitySprites.get(id);
          this.particles.entityDeath(
            Math.round(ent.targetX / TILE - 0.5),
            Math.round(ent.targetY / TILE - 0.5),
          );
          this._destroyEntity(id);
        }
        return;
      }

      const wx = (npc.x + 0.5) * TILE;
      const wy = (npc.y + 0.5) * TILE;
      const charIdx = 5; // red enemy

      if (!this._entitySprites.has(id)) {
        this._spawnEntity(id, wx, wy, charIdx, npc.hp ?? 100);
      } else {
        const ent = this._entitySprites.get(id);
        const prevHp = ent.hp;
        ent.targetX = wx;
        ent.targetY = wy;
        if (npc.hp < prevHp) {
          this.particles.combatHit(npc.x, npc.y);
          this.particles.flashSprite(ent.sprite);
        }
        ent.hp = npc.hp ?? 100;
        ent.charIdx = charIdx;
      }
    });
  }

  _spawnEntity(id, wx, wy, charIdx, hp) {
    const charName = CHAR_NAMES[charIdx % 8];
    const sprite = this.add.sprite(wx, wy, `${charName}_idle_f0`)
      .setDepth(DEPTH_ENTITY)
      .setDisplaySize(16, 16);

    sprite.play(`${charIdx % 8}_idle`);

    const hpBar = this._createHpBar();

    this._entitySprites.set(id, {
      sprite, hpBar,
      targetX: wx, targetY: wy,
      displayX: wx, displayY: wy,
      hp,
      charIdx: charIdx % 8,
    });
  }

  _destroyEntity(id) {
    const ent = this._entitySprites.get(id);
    if (!ent) return;
    ent.sprite.destroy();
    ent.hpBar.destroy();
    this._entitySprites.delete(id);
  }

  // ── Treasure sync ─────────────────────────────────────────────────────

  _syncTreasures(treasures) {
    if (!treasures) return;

    const currentIds = new Set(treasures.map(t => t.id));

    // Remove picked-up treasures
    this._treasureSprites.forEach((obj, id) => {
      if (!currentIds.has(id)) {
        obj.sprite.destroy();
        if (obj.light) this.lighting.removeLight(obj.light);
        this._treasureSprites.delete(id);
      }
    });

    // Add new treasures
    treasures.forEach((t) => {
      if (this._treasureSprites.has(t.id)) return;

      const wx = (t.x + 0.5) * TILE;
      const wy = (t.y + 0.5) * TILE;

      const sprite = this.add.sprite(wx, wy, 'chest_f0')
        .setDepth(DEPTH_TREASURE)
        .setDisplaySize(14, 14)
        .setData('baseY', wy);

      sprite.play('chest_idle');

      const light = this.lighting.addTreasureLight(t.x, t.y);

      this._treasureSprites.set(t.id, { sprite, light });
      this.particles.chestSpawn(t.x, t.y);
    });
  }

  // ── Footprints ────────────────────────────────────────────────────────

  _addFootprint(tileX, tileY) {
    const wx = (tileX + 0.5) * TILE - 1;
    const wy = (tileY + 0.5) * TILE - 1;
    const s = this.add.image(wx, wy, 'pfx_circle')
      .setDepth(DEPTH_FOOTPRINT)
      .setAlpha(0.75)
      .setDisplaySize(4, 4);
    this._footprints.push({ sprite: s, ts: Date.now() });

    // Cap footprint objects to 80 (was 200 — fewer live objects = less per-frame overhead)
    if (this._footprints.length > 80) {
      const old = this._footprints.shift();
      old.sprite.destroy();
    }
  }

  _syncFootprints(fps) {
    // Server footprints (multiplayer) — render as dots
    if (!fps?.length) return;
    const now = Date.now();
    fps.forEach(fp => {
      const wx = (fp.x + 0.5) * TILE - 1;
      const wy = (fp.y + 0.5) * TILE - 1;
      const exists = this._footprints.some(
        f => Math.abs(f.sprite.x - wx) < 1 && Math.abs(f.sprite.y - wy) < 1
          && (now - f.ts) < 200,
      );
      if (!exists) {
        const s = this.add.image(wx, wy, 'pfx_circle')
          .setDepth(DEPTH_FOOTPRINT)
          .setAlpha(0.6)
          .setDisplaySize(3, 3);
        this._footprints.push({ sprite: s, ts: fp.ts ?? now });
      }
    });
  }

  // ── Blood Hunt beacon ─────────────────────────────────────────────────

  _drawBloodHuntBeacon(state, time) {
    if (!this._bloodHuntGfx) {
      this._bloodHuntGfx = this.add.graphics().setDepth(DEPTH_BLOODHUNT);
    }

    const { players, myId, myPos, bloodHuntTarget } = state;
    let btx, bty;
    const targetPlayer = (players || {})[bloodHuntTarget];
    if (targetPlayer?.pos) {
      btx = targetPlayer.pos.x; bty = targetPlayer.pos.y;
    } else if (bloodHuntTarget === myId && myPos) {
      btx = myPos.x; bty = myPos.y;
    }
    if (btx === undefined) return;

    const cx = (btx + 0.5) * TILE;
    const cy = (bty + 0.5) * TILE;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.005);

    const g = this._bloodHuntGfx;
    g.clear().setVisible(true);

    // Outer ring
    g.lineStyle(2, 0xff2828, 0.65 + 0.35 * pulse);
    g.strokeCircle(cx, cy, TILE * 1.5);

    // Crosshair
    g.lineStyle(1, 0xff5050, 0.5 + 0.5 * pulse);
    g.lineBetween(cx - TILE, cy, cx + TILE, cy);
    g.lineBetween(cx, cy - TILE, cx, cy + TILE);

    // Treasure badge
    const treasure = targetPlayer?.treasure ?? 0;
    if (!this._bloodHuntText) {
      this._bloodHuntText = this.add.text(cx, cy - TILE * 2, `◆ ${treasure}`, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#d4af37',
      }).setOrigin(0.5).setDepth(DEPTH_BLOODHUNT);
    }
    this._bloodHuntText.setPosition(cx, cy - TILE * 2).setText(`◆ ${treasure}`).setVisible(true);

    // Direction arrow when target is outside visible radius
    const myWx = this._myDisplayPos.x;
    const myWy = this._myDisplayPos.y;
    const dx = cx - myWx, dy = cy - myWy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > FOG_RADIUS * TILE * 0.8) {
      const angle = Math.atan2(dy, dx);
      const edgeDist = FOG_RADIUS * TILE * 0.7;
      const ax = myWx + Math.cos(angle) * edgeDist;
      const ay = myWy + Math.sin(angle) * edgeDist;
      g.fillStyle(0xff4040, 0.7 + 0.3 * pulse);
      g.fillTriangle(
        ax + Math.cos(angle) * 8,  ay + Math.sin(angle) * 8,
        ax + Math.cos(angle + 2.5) * 5, ay + Math.sin(angle + 2.5) * 5,
        ax + Math.cos(angle - 2.5) * 5, ay + Math.sin(angle - 2.5) * 5,
      );
    }
  }

  // ── Map border ────────────────────────────────────────────────────────

  _drawBorder() {
    if (this._borderGfx) this._borderGfx.destroy();
    this._borderGfx = this.add.graphics().setDepth(DEPTH_BLOODHUNT - 1);
    const g = this._borderGfx;
    // Outer glow lines — blood red to match dark fantasy palette
    g.lineStyle(4, 0xc0392b, 0.85);
    g.strokeRect(2, 2, WORLD_W - 4, WORLD_H - 4);
    g.lineStyle(1, 0x8b1a1a, 0.5);
    g.strokeRect(7, 7, WORLD_W - 14, WORLD_H - 14);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _getZoom() {
    return window.innerWidth < 768 ? 1.5 : 2;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  shutdown() {
    this._unsubs?.forEach(fn => fn());
    window.removeEventListener('fog:combat_flash', this._onCombatFlash);
    window.removeEventListener('fog:loot_pickup', this._onLootPickup);
    this.fog?.destroy();
    this.particles?.destroy();
    this.lighting?.destroy();
    this._bloodHuntText?.destroy();
    this._entitySprites.forEach((_, id) => this._destroyEntity(id));
    this._treasureSprites.forEach((obj) => obj.sprite.destroy());
    this._footprints.forEach(fp => fp.sprite.destroy());
  }
}
