package api

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/koded/fog-of-war/server/internal/auth"
	"github.com/koded/fog-of-war/server/internal/engine"
	pb "github.com/koded/fog-of-war/server/proto"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// walletFromCtx extracts the Solana wallet pubkey from gRPC metadata (optional header).
func walletFromCtx(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	vals := md.Get("x-wallet-pubkey")
	if len(vals) == 0 {
		return ""
	}
	return vals[0]
}

type GameServer struct {
	pb.UnimplementedGameServiceServer
	Manager *engine.GameManager
}

// ─── Escrow / Payments ────────────────────────────────────────────────────────

func (s *GameServer) GetHouseWallet(ctx context.Context, req *pb.GetHouseWalletRequest) (*pb.GetHouseWalletResponse, error) {
	addr := ""
	if s.Manager.Solana != nil {
		addr = s.Manager.Solana.HouseWalletAddress()
	}
	return &pb.GetHouseWalletResponse{HouseWallet: addr}, nil
}

func (s *GameServer) ConfirmDeposit(ctx context.Context, req *pb.ConfirmDepositRequest) (*pb.ConfirmDepositResponse, error) {
	playerID, err := playerIDFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return &pb.ConfirmDepositResponse{Success: false, Error: "invalid session ID"}, nil
	}

	walletPubkey := walletFromCtx(ctx)

	if err := s.Manager.ConfirmDeposit(ctx, sessionID, playerID, walletPubkey, req.TxSig); err != nil {
		return &pb.ConfirmDepositResponse{Success: false, Error: err.Error()}, nil
	}

	// Also join the session after confirming payment
	if err := s.Manager.JoinSession(sessionID, playerID, walletPubkey); err != nil {
		// Already in session is not a fatal error
		fmt.Printf("JoinSession after deposit (possibly already joined): %v\n", err)
	}

	return &pb.ConfirmDepositResponse{
		Success:  true,
		PlayerId: playerID.String(),
	}, nil
}

type AuthServer struct {
	pb.UnimplementedAuthServiceServer
}

// ─── Auth ─────────────────────────────────────────────────────────────────

func (s *AuthServer) Login(ctx context.Context, req *pb.LoginRequest) (*pb.LoginResponse, error) {
	fmt.Printf("Login: %s\n", req.PublicKey)
	playerID := uuid.New()
	token, err := auth.GenerateToken(playerID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to generate token: %v", err)
	}
	return &pb.LoginResponse{
		AccessToken: token,
		PlayerId:    playerID.String(),
	}, nil
}

// ─── Session Management ───────────────────────────────────────────────────

func (s *GameServer) CreateSession(ctx context.Context, req *pb.CreateSessionRequest) (*pb.CreateSessionResponse, error) {
	playerID, err := playerIDFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	meta, err := s.Manager.CreateSession(
		playerID,
		int(req.MaxPlayers),
		float64(req.EntryFee),
		int(req.DurationSeconds),
		int(req.BotCount),
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create session failed: %v", err)
	}

	return &pb.CreateSessionResponse{SessionId: meta.ID.String()}, nil
}

func (s *GameServer) ListSessions(ctx context.Context, req *pb.ListSessionsRequest) (*pb.ListSessionsResponse, error) {
	sessions := s.Manager.ListWaitingSessions()
	infos := make([]*pb.SessionInfo, 0, len(sessions))
	for _, sess := range sessions {
		infos = append(infos, sess.ToInfo())
	}
	return &pb.ListSessionsResponse{Sessions: infos}, nil
}

func (s *GameServer) JoinSession(ctx context.Context, req *pb.JoinSessionRequest) (*pb.JoinSessionResponse, error) {
	playerID, err := playerIDFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return &pb.JoinSessionResponse{Success: false, Error: "invalid session ID"}, nil
	}

	walletPubkey := walletFromCtx(ctx)

	if err := s.Manager.JoinSession(sessionID, playerID, walletPubkey); err != nil {
		return &pb.JoinSessionResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.JoinSessionResponse{Success: true}, nil
}

func (s *GameServer) StartGame(ctx context.Context, req *pb.StartGameRequest) (*pb.StartGameResponse, error) {
	playerID, err := playerIDFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return &pb.StartGameResponse{Success: false, Error: "invalid session ID"}, nil
	}

	if _, err := s.Manager.StartGameSession(ctx, sessionID, playerID); err != nil {
		return &pb.StartGameResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.StartGameResponse{Success: true}, nil
}

func (s *GameServer) WatchLobby(req *pb.WatchLobbyRequest, stream pb.GameService_WatchLobbyServer) error {
	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid session ID")
	}

	sess, ok := s.Manager.GetSession(sessionID)
	if !ok {
		return status.Errorf(codes.NotFound, "session not found")
	}

	ch := make(chan *pb.LobbyUpdate, 16)
	sess.AddWatcher(ch)
	defer sess.RemoveWatcher(ch)

	// Send current state immediately
	if err := stream.Send(sess.LobbyUpdate()); err != nil {
		return err
	}

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case update, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(update); err != nil {
				return err
			}
		}
	}
}

// ─── In-game ──────────────────────────────────────────────────────────────

func (s *GameServer) Connect(req *pb.ConnectRequest, stream pb.GameService_ConnectServer) error {
	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid session ID")
	}

	e, ok := s.Manager.GetEngine(sessionID)
	if !ok {
		return status.Errorf(codes.NotFound, "game not started yet for session %s", req.SessionId)
	}

	// Read wallet pubkey from metadata (sent by frontend as x-wallet-pubkey header)
	walletPubkey := walletFromCtx(stream.Context())
	playerID, _ := playerIDFromCtx(stream.Context())

	ch := e.Subscribe()
	defer e.Unsubscribe(ch)

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case update, ok := <-ch:
			if !ok {
				return nil
			}

			// On game_over: trigger payout if this connection's player is the winner
			for _, ev := range update.Events {
				if ev.EventType == "game_over" && ev.PlayerId != "" {
					winnerID := ev.PlayerId
					// Only one connection should trigger payout (the winner's or any connection once)
					if walletPubkey != "" && playerID.String() == winnerID {
						go s.Manager.PayoutWinner(
							context.Background(),
							sessionID,
							playerID,
							walletPubkey,
						)
					}
				}
			}

			if err := stream.Send(update); err != nil {
				return err
			}
		}
	}
}

func (s *GameServer) Move(ctx context.Context, req *pb.MoveRequest) (*pb.MoveResponse, error) {
	playerID, err := playerIDFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid session ID")
	}

	e, ok := s.Manager.GetEngine(sessionID)
	if !ok {
		return nil, status.Errorf(codes.NotFound, "game session not found")
	}

	e.SetTarget(playerID, float64(req.TargetX), float64(req.TargetY))
	return &pb.MoveResponse{Success: true}, nil
}

func (s *GameServer) CollectLoot(ctx context.Context, req *pb.CollectLootRequest) (*pb.CollectLootResponse, error) {
	playerID, err := playerIDFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid session ID")
	}

	lootID, err := uuid.Parse(req.LootId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid loot ID")
	}

	e, ok := s.Manager.GetEngine(sessionID)
	if !ok {
		return nil, status.Errorf(codes.NotFound, "game session not found")
	}

	success, newBalance, err := e.CollectLoot(playerID, lootID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "loot collection failed: %v", err)
	}

	return &pb.CollectLootResponse{
		Success:             success,
		NewEncryptedBalance: newBalance,
	}, nil
}

func (s *GameServer) Attack(ctx context.Context, req *pb.AttackRequest) (*pb.AttackResponse, error) {
	playerID, err := playerIDFromCtx(ctx)
	if err != nil {
		return nil, err
	}

	sessionID, err := uuid.Parse(req.SessionId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid session ID")
	}

	targetPlayerID, err := uuid.Parse(req.TargetPlayerId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid target player ID")
	}

	e, ok := s.Manager.GetEngine(sessionID)
	if !ok {
		return nil, status.Errorf(codes.NotFound, "game session not found")
	}

	success, err := e.AttackPlayer(playerID, targetPlayerID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "attack failed: %v", err)
	}

	return &pb.AttackResponse{Success: success}, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────

func playerIDFromCtx(ctx context.Context) (uuid.UUID, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return uuid.Nil, status.Errorf(codes.Unauthenticated, "metadata missing")
	}

	tokens := md.Get("authorization")
	if len(tokens) == 0 {
		return uuid.Nil, status.Errorf(codes.Unauthenticated, "token missing")
	}

	tokenStr := tokens[0]
	if len(tokenStr) > 7 && tokenStr[:7] == "Bearer " {
		tokenStr = tokenStr[7:]
	}

	claims, err := auth.ValidateToken(tokenStr)
	if err != nil {
		return uuid.Nil, status.Errorf(codes.Unauthenticated, "invalid token: %v", err)
	}

	return claims.PlayerID, nil
}
