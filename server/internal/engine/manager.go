package engine

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/koded/fog-of-war/server/internal/services"
)

type GameManager struct {
	Engines          map[uuid.UUID]*GameEngine
	OnChainSessionID map[uuid.UUID]uint64   // gameID → on-chain session ID
	Mu               sync.RWMutex
	Arbitrum         *services.ArbitrumService
}

func NewGameManager(arbitrum *services.ArbitrumService) *GameManager {
	return &GameManager{
		Engines:          make(map[uuid.UUID]*GameEngine),
		OnChainSessionID: make(map[uuid.UUID]uint64),
		Arbitrum:         arbitrum,
	}
}

func (m *GameManager) GetEngine(gameID uuid.UUID) (*GameEngine, bool) {
	m.Mu.RLock()
	defer m.Mu.RUnlock()
	e, ok := m.Engines[gameID]
	return e, ok
}

// CreateEngine spins up a game engine AND creates the session on-chain
func (m *GameManager) CreateEngine(ctx context.Context, gameID uuid.UUID, maxPlayers int, durationSeconds int) (*GameEngine, error) {
	m.Mu.Lock()
	defer m.Mu.Unlock()

	if e, ok := m.Engines[gameID]; ok {
		return e, nil
	}

	// Create session on-chain
	onChainID, txHash, err := m.Arbitrum.CreateSession(ctx, maxPlayers, durationSeconds)
	if err != nil {
		return nil, fmt.Errorf("failed to create on-chain session: %w", err)
	}

	fmt.Printf("On-chain session created: id=%d tx=%s\n", onChainID, txHash)

	e := NewGameEngine(gameID)
	m.Engines[gameID] = e
	m.OnChainSessionID[gameID] = onChainID

	return e, nil
}

func (m *GameManager) StartEngine(ctx context.Context, gameID uuid.UUID) error {
	e, ok := m.GetEngine(gameID)
	if !ok {
		return fmt.Errorf("engine not found for game %s", gameID)
	}

	// Start on-chain session
	m.Mu.RLock()
	onChainID := m.OnChainSessionID[gameID]
	m.Mu.RUnlock()

	txHash, err := m.Arbitrum.StartSession(ctx, onChainID)
	if err != nil {
		return fmt.Errorf("failed to start on-chain session: %w", err)
	}

	fmt.Printf("On-chain session started: tx=%s\n", txHash)

	e.Start(ctx)
	return nil
}

// JoinSession registers the player on-chain
func (m *GameManager) JoinSession(ctx context.Context, gameID uuid.UUID) (string, error) {
	m.Mu.RLock()
	onChainID, ok := m.OnChainSessionID[gameID]
	m.Mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("no on-chain session found for game %s", gameID)
	}

	txHash, err := m.Arbitrum.JoinSession(ctx, onChainID)
	if err != nil {
		return "", fmt.Errorf("on-chain join failed: %w", err)
	}

	return txHash, nil
}

// StopEngine ends the game and triggers on-chain payout
func (m *GameManager) StopEngine(ctx context.Context, gameID uuid.UUID, winnerAddress string) error {
	m.Mu.Lock()
	defer m.Mu.Unlock()

	e, ok := m.Engines[gameID]
	if !ok {
		return fmt.Errorf("engine not found for game %s", gameID)
	}

	onChainID := m.OnChainSessionID[gameID]

	// Trigger on-chain payout
	txHash, err := m.Arbitrum.EndSession(ctx, onChainID, winnerAddress)
	if err != nil {
		return fmt.Errorf("on-chain end session failed: %w", err)
	}

	fmt.Printf("On-chain session ended: tx=%s winner=%s\n", txHash, winnerAddress)

	close(e.Done)
	delete(m.Engines, gameID)
	delete(m.OnChainSessionID, gameID)

	return nil
}