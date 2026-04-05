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

type GameServer struct {
	pb.UnimplementedGameServiceServer
	Manager *engine.GameManager
}

type AuthServer struct {
	pb.UnimplementedAuthServiceServer
}

func (s *AuthServer) Login(ctx context.Context, req *pb.LoginRequest) (*pb.LoginResponse, error) {
	// 1. Verify wallet signature (Mock for now)
	fmt.Printf("Mock Login: %s\n", req.PublicKey)
	
	// 2. Generate Player ID (Mock for now, would be from DB)
	playerID := uuid.New()
	
	// 3. Generate JWT
	token, err := auth.GenerateToken(playerID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "Failed to generate token: %v", err)
	}

	return &pb.LoginResponse{
		AccessToken: token,
		PlayerId:    playerID.String(),
	}, nil
}

func (s *GameServer) Connect(req *pb.ConnectRequest, stream pb.GameService_ConnectServer) error {
	playerID, err := getPlayerIDFromMetadata(stream.Context())
	if err != nil {
		return err
	}

	gameID, err := uuid.Parse(req.GameId)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "Invalid game ID: %v", err)
	}

	// Get or create engine + on-chain session
	e, ok := s.Manager.GetEngine(gameID)
	if !ok {
		e, err = s.Manager.CreateEngine(stream.Context(), gameID, 50, 300) // 50 players, 5 min
		if err != nil {
			return status.Errorf(codes.Internal, "Failed to create game session: %v", err)
		}
	}

	// Join on-chain — player's wallet pays entry fee
	txHash, err := s.Manager.JoinSession(stream.Context(), gameID)
	if err != nil {
		return status.Errorf(codes.Internal, "Failed to join on-chain session: %v", err)
	}

	fmt.Printf("Player %s joined on-chain, tx: %s\n", playerID, txHash)

	// Start engine if not already running
	if e.Ticker == nil {
		if err := s.Manager.StartEngine(stream.Context(), gameID); err != nil {
			return status.Errorf(codes.Internal, "Failed to start engine: %v", err)
		}
	}

	e.AddPlayer(playerID, "Player_"+playerID.String()[:4], 50.0, 50.0)

	// Stream state updates
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case update := <-e.Broadcast:
			if err := stream.Send(update); err != nil {
				return err
			}
		}
	}
}

func (s *GameServer) Move(ctx context.Context, req *pb.MoveRequest) (*pb.MoveResponse, error) {
	playerID, err := getPlayerIDFromMetadata(ctx)
	if err != nil {
		return nil, err
	}

	gameID, err := uuid.Parse(req.GameId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid game ID: %v", err)
	}

	e, ok := s.Manager.GetEngine(gameID)
	if !ok {
		return nil, status.Errorf(codes.NotFound, "Game session not found")
	}

	e.SetTarget(playerID, float64(req.TargetX), float64(req.TargetY))

	return &pb.MoveResponse{Success: true}, nil
}

func (s *GameServer) CollectLoot(ctx context.Context, req *pb.CollectLootRequest) (*pb.CollectLootResponse, error) {
	playerID, err := getPlayerIDFromMetadata(ctx)
	if err != nil {
		return nil, err
	}

	gameID, err := uuid.Parse(req.GameId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid game ID: %v", err)
	}

	lootID, err := uuid.Parse(req.LootId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Invalid loot ID: %v", err)
	}

	e, ok := s.Manager.GetEngine(gameID)
	if !ok {
		return nil, status.Errorf(codes.NotFound, "Game session not found")
	}

	// Confidential verification with Arcium (via engine)
	success, newBalance, err := e.CollectLoot(playerID, lootID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "Loot collection failed: %v", err)
	}

	return &pb.CollectLootResponse{
		Success:              success,
		NewEncryptedBalance: newBalance,
	}, nil
}

func getPlayerIDFromMetadata(ctx context.Context) (uuid.UUID, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return uuid.Nil, status.Errorf(codes.Unauthenticated, "Metadata missing")
	}

	tokens := md.Get("authorization")
	if len(tokens) == 0 {
		return uuid.Nil, status.Errorf(codes.Unauthenticated, "Token missing")
	}

	claims, err := auth.ValidateToken(tokens[0])
	if err != nil {
		return uuid.Nil, status.Errorf(codes.Unauthenticated, "Invalid token: %v", err)
	}

	return claims.PlayerID, nil
}
