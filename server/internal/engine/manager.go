package engine

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
	pb "github.com/koded/fog-of-war/server/proto"
	"github.com/koded/fog-of-war/server/internal/services"
)

// SessionMeta holds lobby-phase state before a game starts.
type SessionMeta struct {
	ID           uuid.UUID
	HostID       uuid.UUID
	MaxPlayers   int
	EntryFee     float64
	DurationSecs int
	BotCount     int
	Status       string // "waiting" | "in_progress" | "ended"
	Players      map[uuid.UUID]bool
	PaidPlayers  map[uuid.UUID]string // playerID → deposit tx sig
	PlayerWallets map[uuid.UUID]string // playerID → Solana pubkey
	WinnerPubkey string               // Solana pubkey of winner (set at game end)
	PayoutTxSig  string               // tx sig of winner payout
	Watchers     []chan *pb.LobbyUpdate
	Mu           sync.RWMutex
}

func (s *SessionMeta) ToInfo() *pb.SessionInfo {
	s.Mu.RLock()
	defer s.Mu.RUnlock()
	return &pb.SessionInfo{
		SessionId:       s.ID.String(),
		HostId:          s.HostID.String(),
		MaxPlayers:      uint32(s.MaxPlayers),
		CurrentPlayers:  uint32(len(s.Players)),
		EntryFee:        float32(s.EntryFee),
		DurationSeconds: uint32(s.DurationSecs),
		Status:          s.Status,
	}
}

func (s *SessionMeta) LobbyUpdate() *pb.LobbyUpdate {
	s.Mu.RLock()
	defer s.Mu.RUnlock()
	players := make([]*pb.LobbyPlayer, 0, len(s.Players))
	for id := range s.Players {
		players = append(players, &pb.LobbyPlayer{
			PlayerId: id.String(),
			IsHost:   id == s.HostID,
		})
	}
	return &pb.LobbyUpdate{
		SessionId:       s.ID.String(),
		Players:         players,
		MaxPlayers:      uint32(s.MaxPlayers),
		EntryFee:        float32(s.EntryFee),
		DurationSeconds: uint32(s.DurationSecs),
		Status:          s.Status,
		HostId:          s.HostID.String(),
	}
}

func (s *SessionMeta) Broadcast() {
	update := s.LobbyUpdate()
	s.Mu.RLock()
	defer s.Mu.RUnlock()
	for _, ch := range s.Watchers {
		select {
		case ch <- update:
		default:
		}
	}
}

func (s *SessionMeta) AddWatcher(ch chan *pb.LobbyUpdate) {
	s.Mu.Lock()
	s.Watchers = append(s.Watchers, ch)
	s.Mu.Unlock()
}

func (s *SessionMeta) RemoveWatcher(ch chan *pb.LobbyUpdate) {
	s.Mu.Lock()
	defer s.Mu.Unlock()
	out := s.Watchers[:0]
	for _, w := range s.Watchers {
		if w != ch {
			out = append(out, w)
		}
	}
	s.Watchers = out
}

// ─── GameManager ──────────────────────────────────────────────────────────

type GameManager struct {
	Sessions         map[uuid.UUID]*SessionMeta
	Engines          map[uuid.UUID]*GameEngine
	OnChainSessionID map[uuid.UUID]uint64
	Mu               sync.RWMutex
	Arbitrum         *services.ArbitrumService
	Solana           *services.SolanaService
}

func NewGameManager(arbitrum *services.ArbitrumService, solana *services.SolanaService) *GameManager {
	return &GameManager{
		Sessions:         make(map[uuid.UUID]*SessionMeta),
		Engines:          make(map[uuid.UUID]*GameEngine),
		OnChainSessionID: make(map[uuid.UUID]uint64),
		Arbitrum:         arbitrum,
		Solana:           solana,
	}
}

// CreateSession creates a new lobby in "waiting" state.
func (m *GameManager) CreateSession(hostID uuid.UUID, maxPlayers int, entryFee float64, durationSecs int, botCount int) (*SessionMeta, error) {
	if maxPlayers < 2 {
		maxPlayers = 2
	}
	if maxPlayers > 50 {
		maxPlayers = 50
	}
	if durationSecs < 60 {
		durationSecs = 300
	}

	if botCount < 0 {
		botCount = 0
	}
	if botCount > 20 {
		botCount = 20
	}

	id := uuid.New()
	meta := &SessionMeta{
		ID:           id,
		HostID:       hostID,
		MaxPlayers:   maxPlayers,
		EntryFee:     entryFee,
		DurationSecs: durationSecs,
		BotCount:     botCount,
		Status:       "waiting",
		Players:      map[uuid.UUID]bool{hostID: true},
		PaidPlayers:  make(map[uuid.UUID]string),
		PlayerWallets: make(map[uuid.UUID]string),
	}

	m.Mu.Lock()
	m.Sessions[id] = meta
	m.Mu.Unlock()

	fmt.Printf("Session created: %s host=%s max=%d fee=%.2f\n", id, hostID, maxPlayers, entryFee)
	return meta, nil
}

// GetSession retrieves a session by ID.
func (m *GameManager) GetSession(sessionID uuid.UUID) (*SessionMeta, bool) {
	m.Mu.RLock()
	defer m.Mu.RUnlock()
	s, ok := m.Sessions[sessionID]
	return s, ok
}

// ListWaitingSessions returns all sessions with status "waiting".
func (m *GameManager) ListWaitingSessions() []*SessionMeta {
	m.Mu.RLock()
	defer m.Mu.RUnlock()
	var out []*SessionMeta
	for _, s := range m.Sessions {
		s.Mu.RLock()
		if s.Status == "waiting" {
			out = append(out, s)
		}
		s.Mu.RUnlock()
	}
	return out
}

// JoinSession adds a player to a waiting session.
func (m *GameManager) JoinSession(sessionID, playerID uuid.UUID, walletPubkey string) error {
	s, ok := m.GetSession(sessionID)
	if !ok {
		return fmt.Errorf("session not found")
	}
	s.Mu.Lock()
	if s.Status != "waiting" {
		s.Mu.Unlock()
		return fmt.Errorf("session is not accepting players (status: %s)", s.Status)
	}
	if len(s.Players) >= s.MaxPlayers {
		s.Mu.Unlock()
		return fmt.Errorf("session is full (%d/%d)", len(s.Players), s.MaxPlayers)
	}
	s.Players[playerID] = true
	if walletPubkey != "" {
		s.PlayerWallets[playerID] = walletPubkey
	}
	s.Mu.Unlock()
	s.Broadcast()
	return nil
}

// StartGameSession transitions lobby → in_progress and boots the engine.
func (m *GameManager) StartGameSession(ctx context.Context, sessionID, callerID uuid.UUID) (*GameEngine, error) {
	s, ok := m.GetSession(sessionID)
	if !ok {
		return nil, fmt.Errorf("session not found")
	}

	s.Mu.Lock()

	if s.HostID != callerID {
		s.Mu.Unlock()
		return nil, fmt.Errorf("only the host can start the game")
	}
	if s.Status != "waiting" {
		s.Mu.Unlock()
		return nil, fmt.Errorf("session already started (status: %s)", s.Status)
	}
	s.Status = "in_progress"

	players := make([]uuid.UUID, 0, len(s.Players))
	for id := range s.Players {
		players = append(players, id)
	}
	botCount := s.BotCount
	durationSecs := s.DurationSecs

	s.Mu.Unlock() // ← release BEFORE broadcast (avoids deadlock with LobbyUpdate RLock)

	e := NewGameEngine(sessionID, durationSecs)
	m.Mu.Lock()
	m.Engines[sessionID] = e
	m.Mu.Unlock()

	e.Start()

	for idx, pid := range players {
		charIdx := uint32(idx % 8)
		e.AddPlayer(pid, "Player_"+pid.String()[:4], 64, 64, charIdx)
	}

	if botCount > 0 {
		e.SpawnNPCs(botCount)
	}

	// Notify all lobby watchers — now safe, lock is released
	s.Broadcast()

	fmt.Printf("Game started: session=%s players=%d\n", sessionID, len(players))
	return e, nil
}

// GetEngine retrieves a running game engine.
func (m *GameManager) GetEngine(sessionID uuid.UUID) (*GameEngine, bool) {
	m.Mu.RLock()
	defer m.Mu.RUnlock()
	e, ok := m.Engines[sessionID]
	return e, ok
}

// ConfirmDeposit verifies a Solana deposit on-chain and records the player as paid.
func (m *GameManager) ConfirmDeposit(ctx context.Context, sessionID, playerID uuid.UUID, walletPubkey string, txSig string) error {
	s, ok := m.GetSession(sessionID)
	if !ok {
		return fmt.Errorf("session not found")
	}

	s.Mu.RLock()
	entryFee := s.EntryFee
	s.Mu.RUnlock()

	// Skip on-chain verification if no entry fee (free session) or mock mode
	if entryFee > 0 && m.Solana != nil {
		ok, _, err := m.Solana.VerifyDeposit(ctx, txSig, entryFee)
		if err != nil {
			return fmt.Errorf("deposit verification failed: %w", err)
		}
		if !ok {
			return fmt.Errorf("deposit amount insufficient")
		}
	}

	s.Mu.Lock()
	s.PaidPlayers[playerID] = txSig
	if walletPubkey != "" {
		s.PlayerWallets[playerID] = walletPubkey
	}
	s.Mu.Unlock()

	fmt.Printf("Deposit confirmed: session=%s player=%s tx=%s\n", sessionID, playerID, txSig)
	return nil
}

// PayoutWinner sends the prize pool to the winner's Solana wallet.
func (m *GameManager) PayoutWinner(ctx context.Context, sessionID uuid.UUID, winnerPlayerID uuid.UUID, winnerPubkey string) {
	s, ok := m.GetSession(sessionID)
	if !ok {
		return
	}

	s.Mu.RLock()
	// Skip if already paid out
	if s.PayoutTxSig != "" {
		s.Mu.RUnlock()
		return
	}
	entryFee := s.EntryFee
	paidCount := len(s.PaidPlayers)
	// If winnerPubkey is not provided, try to find it in our stored wallets
	if winnerPubkey == "" {
		winnerPubkey = s.PlayerWallets[winnerPlayerID]
	}
	s.Mu.RUnlock()

	prizePool := float64(paidCount) * entryFee * 0.9 // 90% to winner

	if winnerPubkey == "" {
		fmt.Printf("Skipping payout: no wallet address for winner %s in session %s\n", winnerPlayerID, sessionID)
		return
	}

	// Skip payout only if:
	// 1. No Solana service configured, OR
	// 2. Prize pool is 0 AND we're not in mock mode (can't send real payout with 0 SOL)
	if m.Solana == nil || (prizePool <= 0 && !m.Solana.IsMock) {
		fmt.Printf("Skipping payout: prizePool=%.4f isMock=%v\n", prizePool, m.Solana != nil && m.Solana.IsMock)
		return
	}

	txSig, err := m.Solana.SendPayout(ctx, winnerPubkey, prizePool)
	if err != nil {
		fmt.Printf("Payout failed: session=%s winner=%s err=%v\n", sessionID, winnerPubkey, err)
		return
	}

	s.Mu.Lock()
	s.WinnerPubkey = winnerPubkey
	s.PayoutTxSig  = txSig
	s.Mu.Unlock()

	fmt.Printf("Payout sent: %.4f SOL → %s tx=%s\n", prizePool, winnerPubkey, txSig)

	// Broadcast payout confirmation to any still-connected clients
	m.Mu.RLock()
	e, hasEngine := m.Engines[sessionID]
	m.Mu.RUnlock()
	if hasEngine {
		e.BroadcastEvent("payout", winnerPlayerID.String(), txSig)
	}
}

// StopEngine ends the game and marks the session ended.
func (m *GameManager) StopEngine(ctx context.Context, sessionID uuid.UUID, winnerAddress string) error {
	m.Mu.Lock()
	defer m.Mu.Unlock()

	e, ok := m.Engines[sessionID]
	if !ok {
		return fmt.Errorf("engine not found for session %s", sessionID)
	}

	if s, ok := m.Sessions[sessionID]; ok {
		s.Mu.Lock()
		s.Status = "ended"
		s.Mu.Unlock()
		s.Broadcast()
	}

	close(e.Done)
	delete(m.Engines, sessionID)
	return nil
}
