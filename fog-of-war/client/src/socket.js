import { AuthClient, GameClient } from './grpc/client';
import { useGameStore } from './store';

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

export function connectToGame(sessionId) {
  ensureClient();
  const store = useGameStore.getState();
  store.setMyId(localStorage.getItem('fog_player_id'));

  // Reset game state so stale HP/treasure from a previous game don't bleed in
  useGameStore.setState({
    myHp: 100, myTreasure: 0,
    myPos: { x: 64, y: 64 },
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

      // Eliminated: current player's HP hit 0 — go to results immediately
      const myPlayer = players[myId];
      if (myPlayer?.status === 'eliminated' && useGameStore.getState().screen === 'game') {
        const fee   = store.lobbyFee || 0;
        const count = Object.keys(players).length;
        const prize = (count * fee * 0.9).toFixed(2);
        useGameStore.getState().setResults(gameWinner, prize, payoutTx);
      }

      if (gameOver) {
        const fee   = store.lobbyFee || 0;
        const count = Object.keys(players).length;
        const prize = (count * fee * 0.9).toFixed(2);
        useGameStore.getState().setResults(gameWinner, prize, payoutTx);
      }
    },
    (err) => {
      console.error('Game stream error:', err);
      setTimeout(() => connectToGame(sessionId), 2000);
    },
    () => console.log('Game stream ended'),
  );
}

export async function sendMove(tx, ty) {
  if (!gameClient) return;
  const { sessionId } = useGameStore.getState();
  if (!sessionId) return;
  try { await gameClient.move(sessionId, tx, ty); } catch (e) { console.error('Move failed:', e); }
}

export async function sendAttack(targetPlayerId) {
  if (!gameClient) return;
  const { sessionId } = useGameStore.getState();
  if (!sessionId) return;
  try {
    return await gameClient.attack(sessionId, targetPlayerId);
  } catch (e) {
    console.error('Attack failed:', e);
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
