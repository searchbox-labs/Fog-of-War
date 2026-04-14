import Phaser from 'phaser';

const FRAMES = '/assets/0x72_DungeonTilesetII_v1.7/frames/';
const KENNEY = '/assets/kenney_particle-pack/PNG (Transparent)/';

/**
 * Character slot → sprite name in the 0x72 tileset.
 * Slots 0-4 are player-selectable heroes; slot 5 = enemy bots; 6-7 extra heroes.
 */
export const CHAR_NAMES = [
  'knight_m',    // 0 — male knight  (player default)
  'elf_m',       // 1 — male elf
  'lizard_m',    // 2 — lizard man
  'wizzard_m',   // 3 — male wizard
  'dwarf_m',     // 4 — male dwarf
  'orc_warrior', // 5 — orc warrior  (bots / NPCs)
  'knight_f',    // 6 — female knight
  'elf_f',       // 7 — female elf
];

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload() {
    this._buildLoadingBar();

    // ── Floor tiles (16×16) ────────────────────────────────────────────
    for (let i = 1; i <= 8; i++) {
      this.load.image(`floor_${i}`, `${FRAMES}floor_${i}.png`);
    }

    // ── Wall tiles (16×16) ────────────────────────────────────────────
    const wallFrames = [
      'wall_mid', 'wall_left', 'wall_right',
      'wall_top_mid', 'wall_top_left', 'wall_top_right',
      'wall_outer_mid_left', 'wall_outer_mid_right',
      'wall_outer_front_left', 'wall_outer_front_right',
    ];
    wallFrames.forEach(k => this.load.image(k, `${FRAMES}${k}.png`));

    // ── Decor tiles ────────────────────────────────────────────────────
    ['crate', 'skull', 'column', 'hole', 'wall_banner_red', 'wall_banner_blue'].forEach(
      k => this.load.image(k, `${FRAMES}${k}.png`),
    );

    // ── Character sprites (16×N, individual frames) ────────────────────
    CHAR_NAMES.forEach(name => {
      // Idle animation: 4 frames
      [0, 1, 2, 3].forEach(f => {
        this.load.image(`${name}_idle_f${f}`, `${FRAMES}${name}_idle_anim_f${f}.png`);
      });
      // Run animation: 4 frames
      [0, 1, 2, 3].forEach(f => {
        this.load.image(`${name}_run_f${f}`, `${FRAMES}${name}_run_anim_f${f}.png`);
      });
      // Hit frame — only chars that actually have the asset (orc_warrior doesn't)
      if (name !== 'orc_warrior') {
        this.load.image(`${name}_hit_f0`, `${FRAMES}${name}_hit_anim_f0.png`);
      }
    });

    // ── Chest (16×16) ─────────────────────────────────────────────────
    [0, 1, 2].forEach(f => {
      this.load.image(`chest_f${f}`, `${FRAMES}chest_full_open_anim_f${f}.png`);
    });
    [0, 1, 2].forEach(f => {
      this.load.image(`chest_empty_f${f}`, `${FRAMES}chest_empty_open_anim_f${f}.png`);
    });
    this.load.image('coin_f0', `${FRAMES}coin_anim_f0.png`);

    // ── Particle FX ────────────────────────────────────────────────────
    this.load.image('pfx_spark',   `${KENNEY}flare_01.png`);
    this.load.image('blood',       `${KENNEY}fire_01.png`);
    this.load.image('gold_spark',  `${KENNEY}magic_04.png`);
    this.load.image('pfx_fog',     `${KENNEY}circle_05.png`);
    this.load.image('pfx_circle',  `${KENNEY}circle_01.png`);

    // Suppress 404s for missing hit frames (not every char has one)
    this.load.on('loaderror', (file) => {
      if (file.key.includes('_hit_f')) {
        // Silently ignore — fall back to idle_f0 in GameScene
      }
    });
  }

  create() {
    this._createAnimations();
    this._generateFogRevealTexture();
    this.scene.start('GameScene');
  }

  // ── Animations ────────────────────────────────────────────────────────

  _createAnimations() {
    CHAR_NAMES.forEach((name, slot) => {
      // Guard: don't create duplicates if scene restarts
      if (this.anims.exists(`${slot}_idle`)) return;

      this.anims.create({
        key: `${slot}_idle`,
        frames: [0, 1, 2, 3].map(f => ({ key: `${name}_idle_f${f}` })),
        frameRate: 8,
        repeat: -1,
      });

      this.anims.create({
        key: `${slot}_run`,
        frames: [0, 1, 2, 3].map(f => ({ key: `${name}_run_f${f}` })),
        frameRate: 10,
        repeat: -1,
      });
    });

    // Chest open animation
    if (!this.anims.exists('chest_open')) {
      this.anims.create({
        key: 'chest_open',
        frames: [0, 1, 2].map(f => ({ key: `chest_f${f}` })),
        frameRate: 6,
        repeat: 0,
      });
      this.anims.create({
        key: 'chest_idle',
        frames: [{ key: 'chest_f0' }],
        frameRate: 1,
        repeat: -1,
      });
    }
  }

  // ── Fog reveal gradient texture (stays procedural — no real asset needed) ──

  _generateFogRevealTexture() {
    if (this.textures.exists('fog_reveal')) return;
    const size = 512;
    const tex = this.textures.createCanvas('fog_reveal', size, size);
    const ctx = tex.getContext();
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0,    'rgba(0,0,0,1)');
    grad.addColorStop(0.5,  'rgba(0,0,0,0.97)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0.7)');
    grad.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  // ── Loading bar ────────────────────────────────────────────────────────

  _buildLoadingBar() {
    const { width, height } = this.cameras.main;
    const cx = width / 2, cy = height / 2;

    this.add.rectangle(cx, cy, width, height, 0x050508);
    this.add.text(cx, cy - 70, 'FOG  OF  WAR', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#c0392b',
      letterSpacing: 10,
    }).setOrigin(0.5);

    const barBg   = this.add.rectangle(cx, cy, 320, 8, 0x2a1520);
    const barFill = this.add.rectangle(cx - 160, cy, 0, 6, 0xc0392b).setOrigin(0, 0.5);

    this.add.text(cx, cy + 22, 'LOADING DUNGEON...', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#6b5a5e',
      letterSpacing: 3,
    }).setOrigin(0.5);

    this.load.on('progress', v => { barFill.width = 320 * v; });
  }
}
