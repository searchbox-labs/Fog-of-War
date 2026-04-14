import { TILE, DEPTH_PARTICLE, DEPTH_UI } from '../constants.js';

/**
 * ParticleSystem — visual feedback events:
 *   combatHit(x, y)     — red spark burst at target tile
 *   lootPickup(x, y)    — gold sparkle + floating text
 *   entityDeath(x, y)   — large blood burst
 *   chestSpawn(x, y)    — shimmer burst
 */
export default class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this._floatTexts = [];
  }

  // Guard: returns false if the scene was destroyed (e.g. React StrictMode remount)
  _ok() {
    return this.scene?.sys?.isActive();
  }

  // ── Combat hit — red sparks ────────────────────────────────────────────

  muzzleFlash(x, y, angle) {
    if (!this._ok()) return;
    const em = this.scene.add.particles(x, y, 'pfx_spark', {
      lifespan: 100,
      alpha: { start: 1, end: 0 },
      scale: { start: 0.5, end: 0.1 },
      speed: { min: 50, max: 150 },
      angle: { min: angle - 20, max: angle + 20 },
      blendMode: 'ADD',
      depth: DEPTH_PARTICLE + 1,
      emitting: false,
    });
    em.explode(5);
    this.scene.time.delayedCall(150, () => em.destroy());
  }

  fireBullet(sx, sy, tx, ty) {
    if (!this._ok()) return;
    const bullet = this.scene.add.image(sx, sy, 'bullet')
      .setDisplaySize(12, 6)
      .setDepth(DEPTH_PARTICLE)
      .setAlpha(1);

    const angle = Phaser.Math.Angle.Between(sx, sy, tx, ty);
    bullet.setRotation(angle);

    // Muzzle flash at start
    this.muzzleFlash(sx, sy, Phaser.Math.RadToDeg(angle));

    this.scene.tweens.add({
      targets: bullet,
      x: tx,
      y: ty,
      duration: 150,
      ease: 'Linear',
      onComplete: () => {
        bullet.destroy();
        this.combatHit(tx / TILE, ty / TILE);
      }
    });
  }

  combatHit(tileX, tileY) {
    if (!this._ok()) return;
    const cx = (tileX + 0.5) * TILE;
    const cy = (tileY + 0.5) * TILE;
    const em = this.scene.add.particles(cx, cy, 'blood', {
      lifespan: 280,
      alpha: { start: 1, end: 0 },
      scale: { start: 0.9, end: 0.3 },
      speed: { min: 30, max: 80 },
      angle: { min: 0, max: 360 },
      gravityY: 60,
      blendMode: 'ADD',
      depth: DEPTH_PARTICLE,
      emitting: false,
    });
    em.explode(10);
    this.scene.time.delayedCall(350, () => em.destroy());
  }

  // ── Entity death — bigger burst ───────────────────────────────────────

  entityDeath(tileX, tileY) {
    if (!this._ok()) return;
    const cx = (tileX + 0.5) * TILE;
    const cy = (tileY + 0.5) * TILE;
    const em = this.scene.add.particles(cx, cy, 'blood', {
      lifespan: 600,
      alpha: { start: 1, end: 0 },
      scale: { start: 1.2, end: 0.1 },
      speed: { min: 40, max: 120 },
      angle: { min: 0, max: 360 },
      gravityY: 80,
      blendMode: 'ADD',
      depth: DEPTH_PARTICLE,
      emitting: false,
    });
    em.explode(24);
    this.scene.time.delayedCall(700, () => em.destroy());
  }

  // ── Loot pickup — gold sparkle ────────────────────────────────────────

  lootPickup(tileX, tileY, amount = 1) {
    if (!this._ok()) return;
    const cx = (tileX + 0.5) * TILE;
    const cy = (tileY + 0.5) * TILE;

    const em = this.scene.add.particles(cx, cy, 'gold_spark', {
      lifespan: 500,
      alpha: { start: 1, end: 0 },
      scale: { start: 0.9, end: 0.2 },
      speed: { min: 20, max: 60 },
      angle: { min: 0, max: 360 },
      gravityY: -20,
      blendMode: 'ADD',
      depth: DEPTH_PARTICLE,
      emitting: false,
    });
    em.explode(14);
    this.scene.time.delayedCall(600, () => em.destroy());

    // Floating "+N treasure" text
    const txt = this.scene.add.text(cx, cy - 4, `+${amount}◆`, {
      fontFamily: 'monospace',
      fontSize: '7px',
      color: '#d4af37',
    }).setOrigin(0.5, 1).setDepth(DEPTH_UI);

    this.scene.tweens.add({
      targets: txt,
      y: cy - TILE * 2,
      alpha: 0,
      duration: 900,
      ease: 'Power2',
      onComplete: () => txt.destroy(),
    });
  }

  // ── Chest spawn shimmer ────────────────────────────────────────────────

  chestSpawn(tileX, tileY) {
    if (!this._ok()) return;
    const cx = (tileX + 0.5) * TILE;
    const cy = (tileY + 0.5) * TILE;
    const em = this.scene.add.particles(cx, cy, 'gold_spark', {
      lifespan: 400,
      alpha: { start: 0.8, end: 0 },
      scale: { start: 0.7, end: 0.1 },
      speed: { min: 10, max: 40 },
      angle: { min: 0, max: 360 },
      blendMode: 'ADD',
      depth: DEPTH_PARTICLE,
      emitting: false,
    });
    em.explode(8);
    this.scene.time.delayedCall(500, () => em.destroy());
  }

  // ── Player combat flash (tint) ────────────────────────────────────────

  flashSprite(sprite) {
    if (!sprite?.active || !this._ok()) return;
    sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(150, () => {
      if (sprite?.active) sprite.clearTint();
    });
  }

  destroy() {
    this._floatTexts.forEach(t => t.destroy());
  }
}
