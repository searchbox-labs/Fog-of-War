import { create } from 'zustand';

export const useGameStore = create((set, get) => ({
  // screens: 'landing' | 'lobby' | 'game' | 'results'
  screen:            'landing',
  walletAddress:     null,
  solBalance:        null,
  localMode:         false,
  selectedCharacter: 0,  // 0-7: player's selected character sprite

  // session
  sessionId:    null,
  isHost:       false,
  lobbyPlayers: [],      // [{player_id, is_host}]
  lobbyStatus:  'waiting',
  lobbyFee:     0,
  lobbyMax:     0,
  lobbyDuration: 300,
  sessions:     [],      // list from ListSessions

  // game
  players:         {},
  npcs:            [],
  myId:            null,
  myPos:           { x: 64, y: 64 },
  _posInitialized: false,  // true once server spawn position has been received
  myHp:            100,
  myTreasure:      0,
  footprints:      [],
  treasures:       [],
  timeLeft:        300,
  gameStartTime:   null,      // set when game begins (for "time played" stat)
  bloodHuntActive: false,
  bloodHuntTarget: null,
  leaderboard:     [],

  // results
  winner:    null,
  payout:    0,
  payoutTx:  null,   // Solana tx signature of the payout

  setScreen:            (screen)          => set({ screen }),
  setWallet:            (address, balance) => set({ walletAddress: address, solBalance: balance }),
  setMyId:              (id)              => set({ myId: id }),
  setMyPos:             (pos)             => set({ myPos: pos }),
  setLocalMode:         (v)               => set({ localMode: v }),
  setTimeLeft:          (t)               => set({ timeLeft: t }),
  setSessionId:         (id)              => set({ sessionId: id }),
  setIsHost:            (v)               => set({ isHost: v }),
  setSessions:          (list)            => set({ sessions: list }),
  setSelectedCharacter: (idx)             => set({ selectedCharacter: Math.min(7, Math.max(0, idx)) }),

  setLobbyState: (update) => set({
    lobbyPlayers:  update.players         || [],
    lobbyStatus:   update.status,
    sessionId:     update.session_id,
    lobbyFee:      update.entry_fee       || 0,
    lobbyMax:      update.max_players     || 0,
    lobbyDuration: update.duration_seconds || 300,
  }),

  applyTick: (state) => {
    const cur = get();
    set({
      players:         state.players,
      npcs:            state.npcs            ?? cur.npcs,
      footprints:      state.footprints,
      treasures:       state.treasures,
      timeLeft:        state.timeLeft        ?? cur.timeLeft,
      bloodHuntActive: state.bloodHuntActive ?? cur.bloodHuntActive,
      bloodHuntTarget: state.bloodHuntTarget ?? cur.bloodHuntTarget,
      leaderboard:     state.leaderboard,
      myHp:            state.players?.[cur.myId]?.hp       ?? cur.myHp,
      myTreasure:      state.players?.[cur.myId]?.treasure ?? cur.myTreasure,
      // myPos is client-predicted — never overwrite from server ticks
    });
  },

  setResults:  (winner, payout, payoutTx = null) => set({ winner, payout, payoutTx, screen: 'results' }),
}));
