import { TILE_FLOOR, TILE_FLOOR2 } from './constants.js';

/**
 * Module-level singleton for the procedurally-generated tile map.
 * GameScene writes it once after _buildDungeon(); Game.jsx reads it for
 * client-side collision so the player can't walk into walls or voids.
 */
let _tileMap = null;

/** Called by GameScene after the dungeon is built. */
export function setTileMap(map) {
  _tileMap = map;
}

/** Returns true if tile (tx, ty) can be walked on. */
export function isWalkable(tx, ty) {
  if (!_tileMap) return true; // map not ready yet — allow movement
  const row = _tileMap[ty];
  if (!row) return false;
  const tile = row[tx];
  return tile === TILE_FLOOR || tile === TILE_FLOOR2;
}
