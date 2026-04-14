package engine

import (
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/google/uuid"
	pb "github.com/koded/fog-of-war/server/proto"
)

const (
	GridW        = 128
	GridH        = 128
	TickMs       = 100    // 10 Hz
	AttackRange  = 2.0    // Manhattan distance for melee attack
	AttackDamage = 15     // HP per attack
	NPCDamage    = 8      // HP per NPC hit
	NPCSpeed     = 0.6    // tiles per tick
	PlayerSpeed  = 1.0    // tiles per tick
	LootPerMap   = 40     // loot items spawned on map
	NpcChaseP    = 0.70   // probability NPC chases nearest player
	BloodHuntPct = 0.10   // blood hunt activates in last 10% of session time
)

// ─── Player State ─────────────────────────────────────────────────────────────

type PlayerState struct {
	ID           uuid.UUID
	Username     string
	CharacterIdx uint32 // 0-7: which character sprite
	X, Y         float64
	TargetX      float64
	TargetY      float64
	HP           int32
	Kills        int32
	Treasure     int32
	Status       string // "alive" | "eliminated"
	Mu           sync.RWMutex
}

func (p *PlayerState) ToProto() *pb.Player {
	p.Mu.RLock()
	defer p.Mu.RUnlock()
	return &pb.Player{
		Id:           p.ID.String(),
		Username:     p.Username,
		X:            float32(p.X),
		Y:            float32(p.Y),
		Health:       p.HP,
		Status:       p.Status,
		Kills:        p.Kills,
		Treasure:     p.Treasure,
		CharacterIdx: p.CharacterIdx,
	}
}

// ─── Loot State ───────────────────────────────────────────────────────────────

type LootState struct {
	ID     uuid.UUID
	X, Y   float64
	Status string // "available" | "collected"
}

func (l *LootState) ToProto() *pb.LootItem {
	return &pb.LootItem{
		Id:       l.ID.String(),
		ItemType: "treasure",
		X:        float32(l.X),
		Y:        float32(l.Y),
		Status:   l.Status,
	}
}

// ─── NPC State ────────────────────────────────────────────────────────────────

type NPCState struct {
	ID      uuid.UUID
	X, Y    float64
	HP      int32
	Status  string // "alive" | "eliminated"
	PatrolX float64
	PatrolY float64
}

func (n *NPCState) ToProto() *pb.NPC {
	return &pb.NPC{
		Id:      n.ID.String(),
		NpcType: "bot",
		X:       float32(n.X),
		Y:       float32(n.Y),
		Health:  n.HP,
	}
}

// ─── GameEngine ───────────────────────────────────────────────────────────────

type GameEngine struct {
	SessionID    uuid.UUID
	DurationSecs int
	StartTime    time.Time

	Players  map[uuid.UUID]*PlayerState
	Loot     []*LootState
	NPCs     []*NPCState
	Events   []*pb.GameEvent

	Done      chan struct{}
	subs      []chan *pb.GameStateUpdate
	mu        sync.RWMutex
	eventsMu  sync.Mutex
}

func NewGameEngine(sessionID uuid.UUID, durationSecs int) *GameEngine {
	e := &GameEngine{
		SessionID:    sessionID,
		DurationSecs: durationSecs,
		Players:      make(map[uuid.UUID]*PlayerState),
		Done:         make(chan struct{}),
	}
	e.spawnLoot()
	return e
}

// spawnLoot generates loot items across the map (8 near center, rest scattered).
func (e *GameEngine) spawnLoot() {
	e.Loot = make([]*LootState, 0, LootPerMap)
	cx, cy := float64(GridW/2), float64(GridH/2)

	// 8 near center (integer positions so client walk-over detection aligns)
	for i := 0; i < 8; i++ {
		e.Loot = append(e.Loot, &LootState{
			ID:     uuid.New(),
			X:      math.Round(clamp(cx+randRange(-10, 10), 2, GridW-3)),
			Y:      math.Round(clamp(cy+randRange(-10, 10), 2, GridH-3)),
			Status: "available",
		})
	}
	// rest scattered
	for i := 0; i < LootPerMap-8; i++ {
		e.Loot = append(e.Loot, &LootState{
			ID:     uuid.New(),
			X:      float64(4 + rand.Intn(GridW-8)),
			Y:      float64(4 + rand.Intn(GridH-8)),
			Status: "available",
		})
	}
}

// SpawnNPCs adds bot NPCs to the map. Called by GameManager after Start().
func (e *GameEngine) SpawnNPCs(count int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i := 0; i < count; i++ {
		px := 10 + rand.Float64()*float64(GridW-20)
		py := 10 + rand.Float64()*float64(GridH-20)
		e.NPCs = append(e.NPCs, &NPCState{
			ID:      uuid.New(),
			X:       px,
			Y:       py,
			HP:      100,
			Status:  "alive",
			PatrolX: px + randRange(-20, 20),
			PatrolY: py + randRange(-20, 20),
		})
	}
}

// Start launches the game tick loop.
func (e *GameEngine) Start() {
	e.StartTime = time.Now()
	go e.tickLoop()
}

// AddPlayer adds a player at the given spawn position.
func (e *GameEngine) AddPlayer(playerID uuid.UUID, username string, x, y float64, charIdx uint32) {
	// Spread players across the map corners/edges to avoid instant stacking
	spawnPositions := [][2]float64{
		{20, 20}, {108, 20}, {20, 108}, {108, 108},
		{64, 10}, {64, 118}, {10, 64}, {118, 64},
	}

	e.mu.Lock()
	idx := len(e.Players)
	e.mu.Unlock()

	spawnX := x
	spawnY := y
	if idx < len(spawnPositions) {
		spawnX = spawnPositions[idx][0]
		spawnY = spawnPositions[idx][1]
	} else {
		// Random position far from center for extra players
		spawnX = 5 + rand.Float64()*float64(GridW-10)
		spawnY = 5 + rand.Float64()*float64(GridH-10)
	}

	// Clamp character index to valid range
	if charIdx > 7 {
		charIdx = charIdx % 8
	}

	p := &PlayerState{
		ID:           playerID,
		Username:     username,
		CharacterIdx: charIdx,
		X:            spawnX,
		Y:            spawnY,
		TargetX:      spawnX,
		TargetY:      spawnY,
		HP:           100,
		Status:       "alive",
	}

	e.mu.Lock()
	e.Players[playerID] = p
	e.mu.Unlock()

	e.pushEvent("spawn", playerID.String(), "", fmt.Sprintf("%.0f,%.0f", spawnX, spawnY))
}

// SetTarget updates the player's movement destination.
func (e *GameEngine) SetTarget(playerID uuid.UUID, x, y float64) {
	e.mu.RLock()
	p, ok := e.Players[playerID]
	e.mu.RUnlock()
	if !ok {
		return
	}
	p.Mu.Lock()
	p.TargetX = clamp(x, 0, GridW-1)
	p.TargetY = clamp(y, 0, GridH-1)
	p.Mu.Unlock()
}

// CollectLoot attempts to collect a loot item if the player is close enough.
func (e *GameEngine) CollectLoot(playerID, lootID uuid.UUID) (bool, string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	p, ok := e.Players[playerID]
	if !ok {
		return false, "", fmt.Errorf("player not found")
	}
	if p.Status != "alive" {
		return false, "", nil
	}

	for _, l := range e.Loot {
		if l.ID != lootID || l.Status != "available" {
			continue
		}
		dist := math.Abs(p.X-l.X) + math.Abs(p.Y-l.Y)
		if dist > 3.0 {
			return false, "", nil // too far
		}
		l.Status = "collected"
		p.Mu.Lock()
		p.Treasure++
		p.Mu.Unlock()
		e.pushEventLocked("loot", playerID.String(), lootID.String(), "")
		return true, fmt.Sprintf("%d", p.Treasure), nil
	}
	return false, "", nil
}

// AttackPlayer applies damage between two players if they are in range.
func (e *GameEngine) AttackPlayer(attackerID, targetID uuid.UUID) (bool, error) {
	e.mu.RLock()
	attacker, aOK := e.Players[attackerID]
	target, tOK := e.Players[targetID]
	e.mu.RUnlock()

	if !aOK || !tOK {
		return false, fmt.Errorf("player not found")
	}

	attacker.Mu.RLock()
	ax, ay, aStatus := attacker.X, attacker.Y, attacker.Status
	attacker.Mu.RUnlock()

	target.Mu.RLock()
	tx, ty, tStatus := target.X, target.Y, target.Status
	target.Mu.RUnlock()

	if aStatus != "alive" || tStatus != "alive" {
		return false, nil
	}

	dist := math.Abs(ax-tx) + math.Abs(ay-ty)
	if dist > AttackRange {
		return false, nil // out of range
	}

	target.Mu.Lock()
	target.HP -= AttackDamage
	died := target.HP <= 0
	if died {
		target.HP = 0
		target.Status = "eliminated"
	}
	target.Mu.Unlock()

	if died {
		// Transfer target's treasure to attacker
		target.Mu.RLock()
		loot := target.Treasure
		target.Mu.RUnlock()

		attacker.Mu.Lock()
		attacker.Kills++
		attacker.Treasure += loot
		attacker.Mu.Unlock()

		e.pushEvent("kill", attackerID.String(), targetID.String(), "")
	} else {
		e.pushEvent("hit", attackerID.String(), targetID.String(), fmt.Sprintf("%d", AttackDamage))
	}

	return true, nil
}

// Subscribe returns a channel that receives game state snapshots at ~10Hz.
func (e *GameEngine) Subscribe() chan *pb.GameStateUpdate {
	ch := make(chan *pb.GameStateUpdate, 32)
	e.mu.Lock()
	e.subs = append(e.subs, ch)
	e.mu.Unlock()
	return ch
}

// BroadcastEvent sends a one-off event to all current subscribers (e.g. payout confirmation).
func (e *GameEngine) BroadcastEvent(eventType, playerID, data string) {
	update := &pb.GameStateUpdate{
		SessionId:  e.SessionID.String(),
		ServerTime: time.Now().UnixMilli(),
		Events: []*pb.GameEvent{
			{EventType: eventType, PlayerId: playerID, Data: data},
		},
	}
	e.broadcast(update)
}

// Unsubscribe removes a subscriber channel.
func (e *GameEngine) Unsubscribe(ch chan *pb.GameStateUpdate) {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := e.subs[:0]
	for _, s := range e.subs {
		if s != ch {
			out = append(out, s)
		}
	}
	e.subs = out
}

// ─── Tick Loop ────────────────────────────────────────────────────────────────

func (e *GameEngine) tickLoop() {
	ticker := time.NewTicker(TickMs * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-e.Done:
			return
		case <-ticker.C:
			e.tick()
		}
	}
}

func (e *GameEngine) tick() {
	elapsed := time.Since(e.StartTime).Seconds()
	remaining := e.DurationSecs - int(elapsed)
	if remaining < 0 {
		remaining = 0
	}

	// Blood hunt activates in the last 10% of the session
	bloodHuntThreshold := int(float64(e.DurationSecs) * BloodHuntPct)
	bloodHunt := remaining <= bloodHuntThreshold

	e.mu.Lock()

	// ── Move players toward their targets ────────────────────────────────
	for _, p := range e.Players {
		if p.Status != "alive" {
			continue
		}
		p.Mu.Lock()
		dx := p.TargetX - p.X
		dy := p.TargetY - p.Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist > 0.5 {
			step := math.Min(PlayerSpeed, dist)
			p.X += (dx / dist) * step
			p.Y += (dy / dist) * step
			p.X = clamp(p.X, 0, GridW-1)
			p.Y = clamp(p.Y, 0, GridH-1)
		}
		p.Mu.Unlock()
	}

	// ── NPC AI tick ───────────────────────────────────────────────────────
	for _, npc := range e.NPCs {
		if npc.Status != "alive" {
			continue
		}

		var nearestPlayer *PlayerState
		nearestDist := math.MaxFloat64
		for _, p := range e.Players {
			if p.Status != "alive" {
				continue
			}
			p.Mu.RLock()
			d := math.Abs(npc.X-p.X) + math.Abs(npc.Y-p.Y)
			p.Mu.RUnlock()
			if d < nearestDist {
				nearestDist = d
				nearestPlayer = p
			}
		}

		// Move: chase player (70%) or patrol toward patrol point
		var targetX, targetY float64
		if nearestPlayer != nil && rand.Float64() < NpcChaseP {
			nearestPlayer.Mu.RLock()
			targetX, targetY = nearestPlayer.X, nearestPlayer.Y
			nearestPlayer.Mu.RUnlock()
		} else {
			// Patrol — wander toward patrol point, then pick new one
			targetX, targetY = npc.PatrolX, npc.PatrolY
			if math.Abs(npc.X-npc.PatrolX)+math.Abs(npc.Y-npc.PatrolY) < 1.5 {
				npc.PatrolX = 5 + rand.Float64()*float64(GridW-10)
				npc.PatrolY = 5 + rand.Float64()*float64(GridH-10)
			}
		}

		dx := targetX - npc.X
		dy := targetY - npc.Y
		dist := math.Sqrt(dx*dx + dy*dy)
		if dist > 0.5 {
			step := math.Min(NPCSpeed, dist)
			npc.X += (dx / dist) * step
			npc.Y += (dy / dist) * step
			npc.X = clamp(npc.X, 0, GridW-1)
			npc.Y = clamp(npc.Y, 0, GridH-1)
		}

		// NPC combat — attack adjacent players
		if nearestPlayer != nil && nearestDist <= 1.5 {
			nearestPlayer.Mu.Lock()
			nearestPlayer.HP -= NPCDamage
			died := nearestPlayer.HP <= 0
			if died {
				nearestPlayer.HP = 0
				nearestPlayer.Status = "eliminated"
			}
			nearestPlayer.Mu.Unlock()
			if died {
				e.pushEventLocked("npc_kill", npc.ID.String(), nearestPlayer.ID.String(), "")
			}
		}
	}

	// ── Auto-collect loot when player steps on it ─────────────────────────
	for _, p := range e.Players {
		if p.Status != "alive" {
			continue
		}
		p.Mu.RLock()
		px, py := p.X, p.Y
		p.Mu.RUnlock()

		for _, l := range e.Loot {
			if l.Status != "available" {
				continue
			}
			if math.Abs(px-l.X)+math.Abs(py-l.Y) <= 1.0 {
				l.Status = "collected"
				p.Mu.Lock()
				p.Treasure++
				p.Mu.Unlock()
				e.pushEventLocked("loot", p.ID.String(), l.ID.String(), "")
				break
			}
		}
	}

	// ── Determine blood hunt target (richest alive player) ────────────────
	var bloodHuntTarget string
	if bloodHunt {
		var richest *PlayerState
		for _, p := range e.Players {
			if p.Status != "alive" {
				continue
			}
			if richest == nil || p.Treasure > richest.Treasure {
				richest = p
			}
		}
		if richest != nil {
			bloodHuntTarget = richest.ID.String()
		}
	}

	// ── Check for game over conditions ────────────────────────────────────
	aliveCount := 0
	var lastAlive *PlayerState
	for _, p := range e.Players {
		if p.Status == "alive" {
			aliveCount++
			lastAlive = p
		}
	}

	// Build snapshot
	players := make([]*pb.Player, 0, len(e.Players))
	for _, p := range e.Players {
		players = append(players, p.ToProto())
	}

	lootItems := make([]*pb.LootItem, 0, len(e.Loot))
	for _, l := range e.Loot {
		lootItems = append(lootItems, l.ToProto())
	}

	npcs := make([]*pb.NPC, 0, len(e.NPCs))
	for _, n := range e.NPCs {
		if n.Status == "alive" {
			npcs = append(npcs, n.ToProto())
		}
	}

	// Drain pending events
	e.eventsMu.Lock()
	events := e.Events
	e.Events = nil
	e.eventsMu.Unlock()

	// Add blood hunt event if just activated
	if bloodHunt && bloodHuntTarget != "" {
		events = append(events, &pb.GameEvent{
			EventType: "blood_hunt",
			PlayerId:  bloodHuntTarget,
			Data:      fmt.Sprintf("%d", remaining),
		})
	}

	// Game over: time up or only 1 player left
	gameOver := remaining == 0 || (aliveCount <= 1 && len(e.Players) > 1)

	// Determine winner: richest alive player
	var winnerID string
	if gameOver {
		var richest *PlayerState
		for _, p := range e.Players {
			if p.Status != "alive" {
				continue
			}
			if richest == nil || p.Treasure > richest.Treasure {
				richest = p
			}
		}
		if richest != nil {
			winnerID = richest.ID.String()
		} else if lastAlive != nil {
			winnerID = lastAlive.ID.String()
		}
	}

	e.mu.Unlock()

	// Build and broadcast update
	update := &pb.GameStateUpdate{
		SessionId:        e.SessionID.String(),
		ServerTime:       time.Now().UnixMilli(),
		RemainingSeconds: uint32(remaining),
		Players:          players,
		LootItems:        lootItems,
		Npcs:             npcs,
		Events:           events,
	}

	e.broadcast(update)

	if gameOver {
		e.pushEvent("game_over", winnerID, "", fmt.Sprintf("%d", remaining))
		// Signal done so manager can call StopEngine
		select {
		case <-e.Done:
		default:
			close(e.Done)
		}
	}
}

func (e *GameEngine) broadcast(update *pb.GameStateUpdate) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	for _, ch := range e.subs {
		select {
		case ch <- update:
		default:
		}
	}
}

// ─── Event helpers ────────────────────────────────────────────────────────────

func (e *GameEngine) pushEvent(eventType, playerID, targetID, data string) {
	e.eventsMu.Lock()
	e.Events = append(e.Events, &pb.GameEvent{
		EventType: eventType,
		PlayerId:  playerID,
		TargetId:  targetID,
		Data:      data,
	})
	e.eventsMu.Unlock()
}

// pushEventLocked is used when e.mu is already held (no double-lock on eventsMu needed here).
func (e *GameEngine) pushEventLocked(eventType, playerID, targetID, data string) {
	e.eventsMu.Lock()
	e.Events = append(e.Events, &pb.GameEvent{
		EventType: eventType,
		PlayerId:  playerID,
		TargetId:  targetID,
		Data:      data,
	})
	e.eventsMu.Unlock()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func randRange(lo, hi float64) float64 {
	return lo + rand.Float64()*(hi-lo)
}
