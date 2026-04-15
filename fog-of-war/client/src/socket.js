import { AuthClient, GameClient } from './grpc/client';
import { useGameStore } from './store';
import { isWalkable } from './game/tileMap.js';

// BFS outward from (x,y) to find the nearest walkable floor tile.
function nearestWalkable(x, y) {
  if (isWalkable(x, y)) return { x, y };
  const visited = new Set();
  const queue = [[x, y]];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    const key = `${cx},${cy}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (isWalkable(cx, cy)) return { x: cx, y: cy };
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && ny >= 0 && nx < 128 && ny < 128) queue.push([nx, ny]);
    }
    if (visited.size > 2000) break; // safety — should never happen
  }
  return { x, y }; // fallback to original if nothing found
}

let authClient  = new AuthClient();
let gameClient  = null;
let lobbyStream = null;
let gameStream  = null;

// ─── Auth ─────────────────────────────────────────────────────────────────

export async function loginWithWallet(publicKey, signMessageFn) {
  const message = 'Sign this message to login to Fog of War';
  const encoded = new TextEncoder().encode(message);
  const signature = await signMessageFn(encoded);
  const sigB64 = btoa(String.fromCharCode(...signature));

  const pubkeyStr = publicKey.toBase58();
  const res = await authClient.login(pubkeyStr, sigB64, message);
  localStorage.setItem('fog_token', res.access_token);
  localStorage.setItem('fog_player_id', res.player_id);
  localStorage.setItem('fog_wallet_pubkey', pubkeyStr);
  gameClient = new GameClient(res.access_token, pubkeyStr);
  return res;
}

function ensureClient() {
  if (!gameClient) {
    const token  = localStorage.getItem('fog_token');
    const pubkey = localStorage.getItem('fog_wallet_pubkey') || '';
    if (!token) throw new Error('Not authenticated');
    gameClient = new GameClient(token, pubkey);
  }
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

export async function getHouseWallet() {
  ensureClient();
  return gameClient.getHouseWallet();
}

export async function confirmDeposit(sessionId, txSig) {
  ensureClient();
  return gameClient.confirmDeposit(sessionId, txSig);
}

// ─── Session management ───────────────────────────────────────────────────

export async function createSession(maxPlayers, entryFee, durationSeconds, botCount = 0) {
  ensureClient();
  return gameClient.createSession(maxPlayers, entryFee, durationSeconds, botCount);
}

export async function listSessions() {
  ensureClient();
  return gameClient.listSessions();
}

export async function joinSession(sessionId) {
  ensureClient();
  return gameClient.joinSession(sessionId);
}

export async function startGame(sessionId) {
  ensureClient();
  return gameClient.startGame(sessionId);
}

export function watchLobby(sessionId) {
  ensureClient();

  if (lobbyStream) { try { lobbyStream.cancel(); } catch (_) {} lobbyStream = null; }

  lobbyStream = gameClient.watchLobby(
    sessionId,
    (update) => {
      useGameStore.getState().setLobbyState(update);
      // When host starts the game the server pushes status: "in_progress"
      if (update.status === 'in_progress') {
        if (lobbyStream) { try { lobbyStream.cancel(); } catch (_) {} lobbyStream = null; }
        connectToGame(sessionId);
        useGameStore.getState().setScreen('game');
      }
    },
    (err)  => console.error('Lobby stream error:', err),
    ()     => console.log('Lobby stream ended'),
  );
}

// ─── In-game ──────────────────────────────────────────────────────────────

// Throttled tick log — logs once per second regardless of tick rate
let _lastTickLog = 0;

export function connectToGame(sessionId) {
  ensureClient();
  const myId = localStorage.getItem('fog_player_id');
  console.log('[FOG] connectToGame — sessionId:', sessionId, 'myId:', myId);

  useGameStore.getState().setMyId(myId);

  // Reset game state. myPos is intentionally set to null so the first server
  // tick can place us at the correct server-assigned spawn position.
  useGameStore.setState({
    myHp: 100, myTreasure: 0,
    myPos: null,          // will be synced from first server tick
    _posInitialized: false,
    timeLeft: 300,        // reset timer so it doesn't flash stale solo value
    players: {}, npcs: [], treasures: [], footprints: [],
    bloodHuntActive: false, bloodHuntTarget: null,
    leaderboard: [],
  });

  if (gameStream) { try { gameStream.cancel(); } catch (_) {} gameStream = null; }

  gameStream = gameClient.connectStream(
    sessionId,
    (update) => {
      const store = useGameStore.getState();
      const myId  = store.myId;

      // Build players map — treasure is authoritative from server
      const players = {};
      (update.players || []).forEach(p => {
        players[p.id] = {
          id:             p.id,
          username:       p.username || 'Player',
          pos:            { x: p.x, y: p.y },
          hp:             p.health,
          treasure:       p.treasure ?? 0,
          status:         p.status,
          kills:          p.kills ?? 0,
          character_idx:  p.character_idx ?? 0,
        };
      });

      // ── Sync initial position from server ─────────────────────────────
      // The server assigns each player a unique spawn corner. The client
      // resets myPos to null on connect, so the first tick sets the real
      // starting position. After that, myPos is client-predicted only.
      // Because the dungeon is client-generated, the server corner may land
      // on a wall — BFS outward to find the nearest walkable tile.
      const myServerPlayer = players[myId];
      if (myServerPlayer && !store._posInitialized) {
        const rawX = Math.round(myServerPlayer.pos.x);
        const rawY = Math.round(myServerPlayer.pos.y);
        const { x: spawnX, y: spawnY } = nearestWalkable(rawX, rawY);
        console.log(`[FOG] Syncing spawn: server=(${rawX},${rawY}) walkable=(${spawnX},${spawnY})`);
        useGameStore.setState({
          myPos: { x: spawnX, y: spawnY },
          _posInitialized: true,
        });
      }

      // Process NPC positions
      const npcs = (update.npcs || []).map(n => ({
        id: n.id, x: n.x, y: n.y, hp: n.health,
      }));

      const treasures = (update.loot_items || [])
        .filter(l => l.status === 'available')
        .map(l => ({ x: l.x, y: l.y, id: l.id }));

      const footprints = Object.values(players).map(p => ({
        x: Math.floor(p.pos.x), y: Math.floor(p.pos.y), age: 0, playerId: p.id,
      }));

      const leaderboard = Object.values(players)
        .sort((a, b) => (b.treasure || 0) - (a.treasure || 0));

      // Process events
      let gameOver   = false;
      let gameWinner = null;
      let bloodHuntActive = store.bloodHuntActive;
      let bloodHuntTarget = store.bloodHuntTarget;

      let payoutTx = null;
      (update.events || []).forEach(ev => {
        console.log('[FOG] Event:', ev.event_type, 'player:', ev.player_id, 'target:', ev.target_id);
        if (ev.event_type === 'hit') {
          window.dispatchEvent(new CustomEvent('fog:hit', { detail: {
            attackerId: ev.player_id,
            targetId: ev.target_id
          }}));
        }
        if (ev.event_type === 'kill') {
          window.dispatchEvent(new CustomEvent('fog:hit', { detail: {
            attackerId: ev.player_id,
            targetId: ev.target_id,
            isKill: true
          }}));
        }
        if (ev.event_type === 'game_over') {
          gameOver   = true;
          gameWinner = ev.player_id;
        }
        if (ev.event_type === 'payout') {
          payoutTx = ev.data || null;  // Solana tx signature
          // Update results screen with real tx if already showing
          const cur = useGameStore.getState();
          if (cur.screen === 'results') {
            useGameStore.setState({ payoutTx });
          }
        }
        if (ev.event_type === 'blood_hunt') {
          bloodHuntActive = true;
          bloodHuntTarget = ev.player_id;
        }
      });

      const remaining    = update.remaining_seconds ?? store.timeLeft;
      const duration     = store.lobbyDuration || 300;
      const bhThreshold  = Math.floor(duration * 0.10); // last 10% of session
      if (remaining <= bhThreshold) bloodHuntActive = true;

      // Throttled debug log — once per second
      const now = Date.now();
      if (now - _lastTickLog > 1000) {
        _lastTickLog = now;
        const me = players[myId];
        console.log(
          `[FOG] Tick — myId: ${myId}`,
          `| HP: ${me?.hp ?? '?'} status: ${me?.status ?? '?'}`,
          `| serverPos: (${me ? Math.round(me.pos.x) : '?'}, ${me ? Math.round(me.pos.y) : '?'})`,
          `| clientPos: (${store.myPos?.x ?? 'null'}, ${store.myPos?.y ?? 'null'})`,
          `| remaining: ${remaining}s`,
          `| players: ${Object.keys(players).length}`,
          `| npcs: ${npcs.length}`,
        );
      }

      useGameStore.getState().applyTick({
        players,
        npcs,
        footprints,
        treasures,
        timeLeft:        remaining,
        bloodHuntActive,
        bloodHuntTarget: bloodHuntTarget || leaderboard[0]?.id,
        leaderboard:     leaderboard.map(p => ({ id: p.id, treasure: p.treasure || 0, hp: p.hp })),
      });

      // Eliminated or game over — stop the stream then go to results
      const myPlayer = players[myId];
      const shouldEnd = (myPlayer?.status === 'eliminated' && useGameStore.getState().screen === 'game') || gameOver;
      if (shouldEnd) {
        console.log('[FOG] Game ending — cancelling stream. eliminated:', myPlayer?.status === 'eliminated', 'gameOver:', gameOver, 'winner:', gameWinner);
        if (gameStream) { try { gameStream.cancel(); } catch (_) {} gameStream = null; }
        const fee   = store.lobbyFee || 0;
        const count = Object.keys(players).length;
        const prize = (count * fee * 0.9).toFixed(2);
        useGameStore.getState().setResults(gameWinner, prize, payoutTx);
      }
    },
    (err) => {
      console.error('[FOG] Game stream error:', err);
      setTimeout(() => connectToGame(sessionId), 2000);
    },
    () => console.log('[FOG] Game stream ended'),
  );
}

export async function sendMove(tx, ty) {
  if (!gameClient) { console.warn('[FOG] sendMove — no gameClient'); return; }
  const { sessionId } = useGameStore.getState();
  if (!sessionId) { console.warn('[FOG] sendMove — no sessionId'); return; }
  try {
    const res = await gameClient.move(sessionId, tx, ty);
    if (!res.success) console.warn('[FOG] sendMove rejected by server:', res.error_message);
  } catch (e) { console.error('[FOG] Move failed:', e); }
}

export async function sendAttack(targetPlayerId) {
  if (!gameClient) { console.warn('[FOG] sendAttack — no gameClient'); return; }
  const { sessionId } = useGameStore.getState();
  if (!sessionId) { console.warn('[FOG] sendAttack — no sessionId'); return; }
  try {
    console.log('[FOG] sendAttack → target:', targetPlayerId);
    return await gameClient.attack(sessionId, targetPlayerId);
  } catch (e) {
    console.error('[FOG] Attack failed:', e);
  }
}

export async function collectLoot(lootId) {
  if (!gameClient) return;
  const { sessionId } = useGameStore.getState();
  if (!sessionId) return;
  try {
    const res = await gameClient.collectLoot(sessionId, lootId);
    if (res.success) console.log('Loot collected!', res.new_encrypted_balance);
    return res;
  } catch (e) {
    console.error('CollectLoot failed:', e);
  }
}
