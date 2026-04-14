import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Connection, LAMPORTS_PER_SOL, PublicKey,
  Transaction, SystemProgram,
} from '@solana/web3.js';
import { useGameStore } from '../store';
import {
  loginWithWallet, createSession, listSessions, joinSession, watchLobby,
  getHouseWallet, confirmDeposit,
} from '../socket';
import WalletSelector from './WalletSelector';
import WalletDebug from './WalletDebug';
import './Landing.css';

const CHAR_NAMES = [
  'knight_m', 'elf_m', 'lizard_m', 'wizzard_m',
  'dwarf_m', 'orc_warrior', 'knight_f', 'elf_f',
];
const SPRITE_BASE = '/assets/0x72_DungeonTilesetII_v1.7/frames/';

export default function Landing() {
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const store = useGameStore();
  const { setWallet, setScreen, walletAddress } = store;
  const canvasRef = useRef(null);

  // 'home' | 'host' | 'browse'
  const [mode,    setMode]    = useState('home');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');

  // host form
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [entryFee,   setEntryFee]   = useState(1);
  const [duration,   setDuration]   = useState(300);
  const [botCount,   setBotCount]   = useState(4);

  // browse list
  const [sessions, setSessions] = useState([]);

  // fetch balance
  useEffect(() => {
    if (!connected || !publicKey) return;
    const conn = new Connection('https://api.devnet.solana.com');
    conn.getBalance(publicKey).then(lamports =>
      setWallet(publicKey.toBase58(), (lamports / LAMPORTS_PER_SOL).toFixed(2))
    );
  }, [connected, publicKey]);

  // particle background
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const COLS = 40, ROWS = 25;
    const cells = Array.from({ length: COLS * ROWS }, () => ({
      v: Math.random(), speed: 0.002 + Math.random() * 0.004,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cw = canvas.width / COLS, ch = canvas.height / ROWS;
      cells.forEach((c, i) => {
        c.v = (c.v + c.speed) % 1;
        const a = c.v < 0.5 ? c.v * 0.15 : (1 - c.v) * 0.15;
        ctx.fillStyle = `rgba(255,107,0,${a})`;
        ctx.fillRect((i % COLS) * cw + 1, Math.floor(i / COLS) * ch + 1, cw - 2, ch - 2);
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  const handleSoloPlay = () => {
    store.setLocalMode(true);
    store.setMyId('local');
    store.setWallet('SOLO MODE', 0);
    store.setScreen('game');
  };

  const ensureAuth = async () => {
    if (!connected || !publicKey) throw new Error('Connect your wallet first');
    if (!wallet.signMessage)     throw new Error('Wallet does not support message signing');
    // Always refresh token to avoid expiration errors
    await loginWithWallet(publicKey, wallet.signMessage);
  };

  const handleHost = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await ensureAuth();
      const res = await createSession(maxPlayers, entryFee, duration, botCount);
      if (res.error) throw new Error(res.error);
      store.setSessionId(res.session_id);
      store.setIsHost(true);
      store.setMyId(localStorage.getItem('fog_player_id'));
      watchLobby(res.session_id);
      setScreen('lobby');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleBrowse = async () => {
    setBusy(true); setError('');
    try {
      await ensureAuth();
      const list = await listSessions();
      setSessions(list);
      setMode('browse');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Pay entry fee → confirm on-chain → join session
  const handleJoin = async (sessionData) => {
    const sessionId = typeof sessionData === 'string' ? sessionData : sessionData.session_id;
    const fee       = typeof sessionData === 'object' ? sessionData.entry_fee : 0;

    setBusy(true); setError('');
    try {
      await ensureAuth();

      if (fee > 0) {
        // 1. Fetch house wallet address from server
        const houseWallet = await getHouseWallet();
        const isMock = !houseWallet || houseWallet === 'MOCK_HOUSE_WALLET_ADDRESS';

        if (!isMock) {

        // 2. Build SOL transfer transaction
        const conn = new Connection(DEVNET_RPC, 'confirmed');
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
        const tx = new Transaction({
          recentBlockhash: blockhash,
          feePayer: publicKey,
        });
        tx.add(SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey:   new PublicKey(houseWallet),
          lamports:   Math.round(fee * LAMPORTS_PER_SOL),
        }));

        // 3. Use wallet adapter sendTransaction — routes through Phantom/Solflare correctly
        const txSig = await wallet.sendTransaction(tx, conn);
        await conn.confirmTransaction(
          { signature: txSig, blockhash, lastValidBlockHeight },
          'confirmed',
        );

          // 4. Tell backend to verify + register deposit
          const depositRes = await confirmDeposit(sessionId, txSig);
          if (!depositRes.success) throw new Error(depositRes.error || 'Deposit failed');
          // confirmDeposit already joins session — skip joinSession below
        } else {
          // Mock/dev mode — skip on-chain payment, just join
          const res = await joinSession(sessionId);
          if (!res.success) throw new Error(res.error || 'Join failed');
        }
      } else {
        // Free session — just join normally
        const res = await joinSession(sessionId);
        if (!res.success) throw new Error(res.error || 'Join failed');
      }

      store.setSessionId(sessionId);
      store.setIsHost(false);
      store.setMyId(localStorage.getItem('fog_player_id'));
      watchLobby(sessionId);
      setScreen('lobby');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <canvas ref={canvasRef} className="landing__bg" />

      <div className="landing__content">
        <div className="landing__eyebrow">SOLANA DEVNET · BATTLE ROYALE</div>

        <h1 className="landing__title">
          <span className="landing__title-fog">FOG</span>
          <span className="landing__title-of"> OF </span>
          <span className="landing__title-war">WAR</span>
        </h1>

        <p className="landing__sub">
          Pay. Spawn. Hunt. Extract.<br />
          <span className="accent">90% of the pool</span> goes to the last one standing.
        </p>

        {error && <div className="landing__error">{error}</div>}

        {/* ── Home ───────────────────────────────────────────── */}
        {mode === 'home' && (
          <div className="landing__actions">
            <WalletSelector />
            {connected && (
              <div className="landing__game-btns">
                <button className="enter-btn" onClick={() => setMode('host')} disabled={busy}>
                  <span className="enter-btn__icon">⚔</span>
                  HOST GAME
                </button>
                <button className="enter-btn enter-btn--secondary" onClick={handleBrowse} disabled={busy}>
                  <span className="enter-btn__icon">◎</span>
                  {busy ? 'LOADING...' : 'JOIN GAME'}
                </button>
              </div>
            )}
            <button className="solo-btn" onClick={handleSoloPlay}>
              PLAY SOLO (NO WALLET)
            </button>

            {/* Character Selector */}
            <div className="character-selector">
              <div className="character-selector__label">SELECT YOUR HERO</div>
              <div className="character-selector__grid">
                {CHAR_NAMES.map((name, i) => (
                  <button
                    key={i}
                    className={`char-btn ${store.selectedCharacter === i ? 'char-btn--selected' : ''}`}
                    onClick={() => store.setSelectedCharacter(i)}
                    title={name.replace('_', ' ')}
                  >
                    <img 
                      src={`${SPRITE_BASE}${name}_idle_anim_f0.png`} 
                      alt={name}
                      className="char-btn__img"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Host form ──────────────────────────────────────── */}
        {mode === 'host' && (
          <form className="session-form" onSubmit={handleHost}>
            <div className="session-form__title">CREATE SESSION</div>

            <label className="session-form__field">
              <span>MAX PLAYERS</span>
              <input type="number" min="2" max="50" value={maxPlayers}
                onChange={e => setMaxPlayers(Number(e.target.value))} />
            </label>

            <label className="session-form__field">
              <span>ENTRY FEE (SOL)</span>
              <input type="number" min="0" step="0.1" value={entryFee}
                onChange={e => setEntryFee(Number(e.target.value))} />
            </label>

            <label className="session-form__field">
              <span>DURATION (SEC)</span>
              <input type="number" min="60" step="60" value={duration}
                onChange={e => setDuration(Number(e.target.value))} />
            </label>

            <label className="session-form__field">
              <span>AI BOTS (0–20)</span>
              <input type="number" min="0" max="20" value={botCount}
                onChange={e => setBotCount(Number(e.target.value))} />
            </label>

            <div className="session-form__preview">
              Prize pool: <strong>{(maxPlayers * entryFee * 0.9).toFixed(2)} SOL</strong>
              {botCount > 0 && <span className="session-form__bots"> · {botCount} AI bots</span>}
            </div>

            <div className="session-form__actions">
              <button type="submit" className="enter-btn" disabled={busy}>
                {busy ? 'CREATING...' : 'CREATE & ENTER LOBBY'}
              </button>
              <button type="button" className="solo-btn" onClick={() => { setMode('home'); setError(''); }}>
                BACK
              </button>
            </div>
          </form>
        )}

        {/* ── Browse sessions ────────────────────────────────── */}
        {mode === 'browse' && (
          <div className="session-list">
            <div className="session-list__title">OPEN SESSIONS</div>
            {sessions.length === 0 && (
              <div className="session-list__empty">
                No open sessions. Host one!
              </div>
            )}
            {sessions.map(s => (
              <div key={s.session_id} className="session-row">
                <div className="session-row__info">
                  <span className="session-row__players">
                    {s.current_players}/{s.max_players} PLAYERS
                  </span>
                  <span className="session-row__fee">{s.entry_fee} SOL</span>
                  <span className="session-row__time">
                    {Math.floor(s.duration_seconds / 60)}MIN
                  </span>
                </div>
                <button
                  className="enter-btn enter-btn--sm"
                  onClick={() => handleJoin(s)}
                  disabled={busy}
                >
                  {s.entry_fee > 0 ? `JOIN · ${s.entry_fee} SOL` : 'JOIN FREE'}
                </button>
              </div>
            ))}
            <div className="session-list__footer">
              <button className="solo-btn" onClick={() => { setMode('home'); setError(''); }}>
                BACK
              </button>
              <button className="solo-btn" onClick={handleBrowse} disabled={busy}>
                REFRESH
              </button>
            </div>
          </div>
        )}

        {connected && (
          <div className="landing__wallet-info">
            <span className="dot dot--green" />
            {walletAddress?.slice(0, 4)}...{walletAddress?.slice(-4)} · Devnet
          </div>
        )}
      </div>

      <div className="landing__footer">
        <span>BLOOD HUNT activates at 5 min remaining</span>
        <span>·</span>
        <span>10% house fee</span>
        <span>·</span>
        <span>Powered by Solana</span>
      </div>

      <WalletDebug />
    </div>
  );
}
