import Phaser from 'phaser';
import PreloadScene from './scenes/PreloadScene.js';
import GameScene   from './scenes/GameScene.js';

/**
 * Create and return a Phaser 3 game instance mounted inside `parent`.
 * Call game.destroy(true) to clean up on React unmount.
 */
export function createPhaserGame(parent) {
  return new Phaser.Game({
    type: Phaser.AUTO,           // WebGL with Canvas fallback
    parent,
    backgroundColor: '#050508',
    pixelArt: true,              // crisp pixel art scaling

    scale: {
      mode: Phaser.Scale.RESIZE,
    },

    scene: [PreloadScene, GameScene],

    // No physics engine needed — server is authoritative for game logic.
    // Only use Arcade physics for world/camera bounds.
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },

    // Disable right-click context menu on canvas
    disableContextMenu: true,

    // Prevent Phaser from hijacking keyboard events we handle in React
    input: {
      keyboard: false,
    },
  });
}
