import {
  TILE, GRID_W, GRID_H, WORLD_W, WORLD_H,
  FOG_RADIUS, DEPTH_FOG,
} from '../constants.js';

const REVEAL_RADIUS = FOG_RADIUS * TILE * 1.3;

/**
 * FogSystem — fog-of-war using a Graphics mask.
 *
 * Each frame: fill fogRT dark, then erase a white circle at the
 * player position using a Graphics object. Avoids all texture-erase
 * edge cases in Phaser 3.90 WebGL.
 */
export default class FogSystem {
  constructor(scene) {
    this.scene = scene;
    this.explored = new Uint8Array(GRID_W * GRID_H);

    this.fogRT = scene.add.renderTexture(0, 0, WORLD_W, WORLD_H)
      .setDepth(DEPTH_FOG)
      .setOrigin(0, 0);

    // Reusable graphics circle for erase — drawn once, repositioned
    this._eraseGfx = scene.make.graphics({ add: false });
    this._eraseGfx.fillStyle(0xffffff, 1);
    this._eraseGfx.fillCircle(0, 0, REVEAL_RADIUS);

  }

  update(playerTileX, playerTileY) {
    const wx = (playerTileX + 0.5) * TILE;
    const wy = (playerTileY + 0.5) * TILE;

    // Update explored bitmask
    for (let dy = -FOG_RADIUS; dy <= FOG_RADIUS; dy++) {
      for (let dx = -FOG_RADIUS; dx <= FOG_RADIUS; dx++) {
        if (dx * dx + dy * dy <= FOG_RADIUS * FOG_RADIUS) {
          const tx = playerTileX + dx;
          const ty = playerTileY + dy;
          if (tx >= 0 && tx < GRID_W && ty >= 0 && ty < GRID_H) {
            this.explored[ty * GRID_W + tx] = 1;
          }
        }
      }
    }

    // Move erase circle to player world position
    this._eraseGfx.setPosition(wx, wy);

    // Fill fog, then punch a hole at the player position
    this.fogRT.clear();
    this.fogRT.fill(0x050508, 0.95);
    this.fogRT.erase(this._eraseGfx);

  }

  destroy() {
    this.fogRT?.destroy();
    this._eraseGfx?.destroy();
  }
}
