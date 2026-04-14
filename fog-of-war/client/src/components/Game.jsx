import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { sendMove, sendAttack, collectLoot } from '../socket';
import { createPhaserGame } from '../game/index.js';
import { isWalkable } from '../game/tileMap.js';
import HUD from './HUD';
import MobileControls from './MobileControls';
import './Game.css';

const GRID_W      = 128;
const GRID_H      = 128;
const SPAWN_X     = 64;
const SPAWN_Y     = 64;
const BOT_COUNT   = 7;
const BOT_TICK_MS = 500;
const TREASURE_DESPAWN_DIST = 20;
const TREASURE_DESPAWN_TIME = 5000;
const BOT_DESPAWN_TIME = 15000;

// Treasures: cluster some near spawn so player sees them immediately
function genLocalTreasures() {
  const out = [];
  for (let i = 0; i < 15; i++) {
    out.push({
      id: `tn${i}`,
      x: Math.max(1, Math.min(GRID_W - 2, SPAWN_X + Math.round((Math.random() - 0.5) * 20))),
      y: Math.max(1, Math.min(GRID_H - 2, SPAWN_Y + Math.round((Math.random() - 0.5) * 20))),
    });
  }
  for (let i = 0; i < 35; i++) {
    out.push({
      id: `tr${i}`,
      x: 4 + Math.floor(Math.random() * (GRID_W - 8)),
      y: 4 + Math.floor(Math.random() * (GRID_H - 8)),
    });
  }
  return out;
}

function makeBot(i) {
  // Spawn bots in opposite quadrant from player (spawn=64,64) so they
  // don't immediately swarm. Spread across the far half of the map.
  const quadrant = i % 4;
  const baseX = quadrant < 2 ? 10 : 90;
  const baseY = quadrant % 2 === 0 ? 10 : 90;
  return {
    id: `bot_${i}`,
    x: baseX + Math.floor(Math.random() * 20),
    y: baseY + Math.floor(Math.random() * 20),
    hp: 100,
    status: 'alive',
    killCount: 0,
  };
}

function respawnBot(bot) {
  return {
    ...bot,
    x: 10 + Math.floor(Math.random() * 108),
    y: 10 + Math.floor(Math.random() * 108),
    hp: 100,
    status: 'alive',
  };
}

function respawnTreasure() {
  return {
    id: `tr_${Date.now()}_${Math.random()}`,
    x: 4 + Math.floor(Math.random() * (GRID_W - 8)),
    y: 4 + Math.floor(Math.random() * (GRID_H - 8)),
  };
}

export default function Game() {
  const containerRef  = useRef(null);
  const stateRef      = useRef({});
  const trailRef      = useRef([]);
  const treasureRef   = useRef(genLocalTreasures());
  const treasureTimerRef = useRef({});
  const botsRef       = useRef([]);
  const botCombatTimerRef = useRef({});
  const flashRef      = useRef(0);
  const store         = useGameStore();
  const movePlayerRef = useRef(null);
  const hasMoved      = useRef(false);

  const [showSpawnPrompt, setShowSpawnPrompt] = useState(!store.localMode);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // ── Reload lock ────────────────────────────────────────────────────────
  useEffect(() => {
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Game in progress — leaving will forfeit your entry fee!';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ── Mobile detection ───────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  // ── Sync store → ref every render ─────────────────────────────────────
  useEffect(() => {
    stateRef.current = {
      players:         store.players,
      npcs:            store.npcs,
      myId:            store.myId,
      myPos:           store.myPos,
      myHp:            store.myHp,
      footprints:      store.footprints,
      treasures:       store.localMode ? treasureRef.current : store.treasures,
      bloodHuntActive: store.bloodHuntActive,
      bloodHuntTarget: store.bloodHuntTarget,
      localMode:       store.localMode,
      sessionId:       store.sessionId,
    };
  });

  // ── Local countdown ────────────────────────────────────────────────────
  useEffect(() => {
    if (!store.localMode) return;
    const id = setInterval(() => {
      store.setTimeLeft(Math.max(0, useGameStore.getState().timeLeft - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [store.localMode]);

  // ── Mount Phaser game ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const game = createPhaserGame(containerRef.current);
    return () => game.destroy(true);
  }, []);

  // ── Local-mode bot AI ──────────────────────────────────────────────────
  useEffect(() => {
    if (!store.localMode) return;

    botsRef.current = Array.from({ length: BOT_COUNT }, (_, i) => makeBot(i));
    const now = Date.now();
    botsRef.current.forEach(bot => {
      botCombatTimerRef.current[bot.id] = now;
    });

    // Push initial state to store so Phaser can render it
    useGameStore.setState({
      npcs:      botsRef.current,
      treasures: treasureRef.current,
    });

    const id = setInterval(() => {
      const { myPos } = useGameStore.getState();
      if (!myPos) return;

      let myHp       = useGameStore.getState().myHp;
      let myTreasure = useGameStore.getState().myTreasure;
      let hitThisTick = false;
      const tick = Date.now();

      botsRef.current = botsRef.current.map(bot => {
        if (bot.status !== 'alive') return bot;

        const dx = myPos.x - bot.x;
        const dy = myPos.y - bot.y;
        let nx = bot.x, ny = bot.y;

        if (Math.random() < 0.85) {
          if (Math.abs(dx) >= Math.abs(dy)) nx += Math.sign(dx);
          else                              ny += Math.sign(dy);
        } else {
          const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
          const [rdx, rdy] = dirs[Math.floor(Math.random() * 4)];
          nx += rdx; ny += rdy;
        }
        nx = Math.max(0, Math.min(GRID_W - 1, nx));
        ny = Math.max(0, Math.min(GRID_H - 1, ny));
        // Don't let bots walk into walls either
        if (!isWalkable(nx, ny)) { nx = bot.x; ny = bot.y; }

        const dist = Math.abs(nx - myPos.x) + Math.abs(ny - myPos.y);
        let botHp = bot.hp;
        if (dist <= 1) {
          myHp       = Math.max(0, myHp - 5);
          botHp      = Math.max(0, botHp - 5);
          hitThisTick = true;
          botCombatTimerRef.current[bot.id] = tick;
          if (botHp <= 0) myTreasure += 1;
        }

        const timeSinceCombat = tick - (botCombatTimerRef.current[bot.id] || tick);
        if (timeSinceCombat > BOT_DESPAWN_TIME) {
          botCombatTimerRef.current[bot.id] = tick;
          return respawnBot(bot);
        }

        return { ...bot, x: nx, y: ny, hp: botHp, status: botHp <= 0 ? 'eliminated' : 'alive' };
      });

      if (hitThisTick) {
        flashRef.current = Date.now();
        window.dispatchEvent(new CustomEvent('fog:combat_flash'));
        useGameStore.setState({ myHp, myTreasure });
        if (myHp <= 0) useGameStore.setState({ screen: 'results' });
      }

      // Sync bots to store so Phaser can render them
      useGameStore.setState({ npcs: botsRef.current });
    }, BOT_TICK_MS);

    return () => {
      clearInterval(id);
      botsRef.current = [];
      botCombatTimerRef.current = {};
    };
  }, [store.localMode]);

  // ── Keyboard movement + attack ─────────────────────────────────────────
  useEffect(() => {
    const DELTA = {
      ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0],
      w:[0,-1], s:[0,1], a:[-1,0], d:[1,0],
    };

    const onKey = (e) => {
      if ((e.key === ' ' || e.key === 'f' || e.key === 'F') && !stateRef.current.localMode) {
        e.preventDefault();
        const { players, myId, myPos } = stateRef.current;
        if (!myPos || !players) return;
        let nearest = null, nearestDist = Infinity;
        Object.entries(players).forEach(([id, p]) => {
          if (id === myId || p.status === 'eliminated') return;
          const d = Math.abs(p.pos.x - myPos.x) + Math.abs(p.pos.y - myPos.y);
          if (d <= 2 && d < nearestDist) { nearest = id; nearestDist = d; }
        });
        if (nearest) {
          flashRef.current = Date.now();
          window.dispatchEvent(new CustomEvent('fog:combat_flash'));
          sendAttack(nearest);
        }
        return;
      }

      if (!DELTA[e.key]) return;
      e.preventDefault();
      if (!stateRef.current.myPos) return;

      if (!hasMoved.current) {
        hasMoved.current = true;
        setShowSpawnPrompt(false);
      }

      const [dx, dy] = DELTA[e.key];
      movePlayerRef.current?.(dx, dy);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Move player (keyboard + mobile controls) ───────────────────────────
  useEffect(() => {
    movePlayerRef.current = (dx, dy) => {
      const { localMode, myPos } = stateRef.current;
      if (!myPos) return;

      if (!hasMoved.current) {
        hasMoved.current = true;
        setShowSpawnPrompt(false);
      }

      const nx = Math.max(0, Math.min(GRID_W - 1, myPos.x + dx));
      const ny = Math.max(0, Math.min(GRID_H - 1, myPos.y + dy));

      // Block movement into walls / void tiles
      if (!isWalkable(nx, ny)) return;

      trailRef.current.push({ x: myPos.x, y: myPos.y, ts: Date.now() });

      // Keep trail to last 200 entries
      if (trailRef.current.length > 200) trailRef.current.shift();

      store.setMyPos({ x: nx, y: ny });

      if (!localMode) {
        sendMove(nx, ny);
      }

      // Treasure pickup
      const treasures = localMode ? treasureRef.current : useGameStore.getState().treasures;
      const picked = treasures?.find(t => t.x === nx && t.y === ny);
      if (picked) {
        if (localMode) {
          treasureRef.current = treasureRef.current.filter(t => t.id !== picked.id);
          delete treasureTimerRef.current[picked.id];
          const newCount = useGameStore.getState().myTreasure + 1;
          useGameStore.setState({
            myTreasure: newCount,
            treasures: treasureRef.current,
          });
          // Fire loot particle at pickup location
          window.dispatchEvent(new CustomEvent('fog:loot_pickup', { detail: { x: nx, y: ny } }));
        } else {
          collectLoot(picked.id);
        }
      }
    };
  }, []);

  // ── Treasure despawn/respawn (local mode) ──────────────────────────────
  useEffect(() => {
    if (!store.localMode) return;

    const id = setInterval(() => {
      const { myPos } = useGameStore.getState();
      if (!myPos) return;

      const now = Date.now();
      const toRespawn = [];

      treasureRef.current.forEach(treasure => {
        const dist = Math.abs(treasure.x - myPos.x) + Math.abs(treasure.y - myPos.y);
        if (dist > TREASURE_DESPAWN_DIST) {
          if (!treasureTimerRef.current[treasure.id]) {
            treasureTimerRef.current[treasure.id] = now;
          } else if (now - treasureTimerRef.current[treasure.id] > TREASURE_DESPAWN_TIME) {
            toRespawn.push(treasure.id);
          }
        } else {
          delete treasureTimerRef.current[treasure.id];
        }
      });

      if (toRespawn.length > 0) {
        treasureRef.current = treasureRef.current.filter(t => !toRespawn.includes(t.id));
        toRespawn.forEach(tid => {
          delete treasureTimerRef.current[tid];
          treasureRef.current.push(respawnTreasure());
        });
        // Sync to store so Phaser sees updated list
        useGameStore.setState({ treasures: [...treasureRef.current] });
      }
    }, 1000);

    return () => {
      clearInterval(id);
      treasureTimerRef.current = {};
    };
  }, [store.localMode]);

  return (
    <div className="game">
      <HUD />

      {/* Phaser canvas container — Phaser injects its <canvas> here */}
      <div ref={containerRef} className="game__phaser" />

      {/* Spawn movement prompt */}
      {showSpawnPrompt && (
        <div className="game__spawn-prompt">
          <div className="spawn-prompt__box">
            <div className="spawn-prompt__icon">⚔</div>
            <div className="spawn-prompt__title">YOU HAVE SPAWNED</div>
            <div className="spawn-prompt__sub">
              {isMobile ? (
                <>
                  Use the <strong>D-pad</strong> to move<br />
                  Tap <strong>ATK</strong> to attack when adjacent to an enemy
                </>
              ) : (
                <>
                  Press <kbd>WASD</kbd> or <kbd>ARROW KEYS</kbd> to move<br />
                  Press <kbd>SPACE</kbd> or <kbd>F</kbd> to attack when adjacent to an enemy
                </>
              )}
            </div>
            <button className="spawn-prompt__btn" onClick={() => {
              hasMoved.current = true;
              setShowSpawnPrompt(false);
            }}>
              ENTER THE FOG
            </button>
          </div>
        </div>
      )}

      <div className="game__controls-hint">
        {isMobile ? (
          <>D-PAD — MOVE &nbsp;|&nbsp; ATK — ATTACK</>
        ) : (
          <>WASD / ARROWS — MOVE &nbsp;|&nbsp; SPACE / F — ATTACK</>
        )}
      </div>

      {isMobile && (
        <MobileControls
          onMove={movePlayerRef.current ? (dx, dy) => movePlayerRef.current(dx, dy) : () => {}}
          onAttack={() => {
            if (stateRef.current.localMode) {
              const { myPos } = stateRef.current;
              if (!myPos) return;
              const nearestBot = botsRef.current.find(bot => {
                if (bot.status !== 'alive') return false;
                return Math.abs(bot.x - myPos.x) + Math.abs(bot.y - myPos.y) <= 1;
              });
              if (nearestBot) {
                flashRef.current = Date.now();
                window.dispatchEvent(new CustomEvent('fog:combat_flash'));
              }
            } else {
              const { players, myId, myPos } = stateRef.current;
              if (!myPos || !players) return;
              let nearest = null, nearestDist = Infinity;
              Object.entries(players).forEach(([id, p]) => {
                if (id === myId || p.status === 'eliminated') return;
                const d = Math.abs(p.pos.x - myPos.x) + Math.abs(p.pos.y - myPos.y);
                if (d <= 2 && d < nearestDist) { nearest = id; nearestDist = d; }
              });
              if (nearest) {
                flashRef.current = Date.now();
                window.dispatchEvent(new CustomEvent('fog:combat_flash'));
                sendAttack(nearest);
              }
            }
          }}
        />
      )}
    </div>
  );
}
