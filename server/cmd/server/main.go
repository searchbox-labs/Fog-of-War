package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/improbable-eng/grpc-web/go/grpcweb"
	"github.com/koded/fog-of-war/server/internal/api"
	"github.com/koded/fog-of-war/server/internal/engine"
	"github.com/koded/fog-of-war/server/internal/services"
	pb "github.com/koded/fog-of-war/server/proto"
	"github.com/rs/cors"
	"google.golang.org/grpc"
)

func main() {
	// 1. Initialize services
	arbitrum, err := services.NewArbitrumService()
	if err != nil {
		log.Fatalf("Failed to init Arbitrum service: %v", err)
	}

	solana := services.NewSolanaService()
	solana.AirdropIfLow(context.Background())

	manager := engine.NewGameManager(arbitrum, solana)

	// 2. Setup gRPC Server
	grpcServer := grpc.NewServer()
	pb.RegisterGameServiceServer(grpcServer, &api.GameServer{Manager: manager})
	pb.RegisterAuthServiceServer(grpcServer, &api.AuthServer{})

	// 3. Setup gRPC-Web Wrapper
	wrappedGrpc := grpcweb.WrapServer(grpcServer, grpcweb.WithOriginFunc(func(origin string) bool {
		return true // Allow all origins for development
	}))

	// 4. Start gRPC Listener
	grpcPort := 50051
	grpcLis, err := net.Listen("tcp", fmt.Sprintf(":%d", grpcPort))
	if err != nil {
		log.Fatalf("failed to listen on gRPC port: %v", err)
	}

	fmt.Printf("gRPC server listening on https://localhost:%d\n", grpcPort)
	go func() {
		if err := grpcServer.Serve(grpcLis); err != nil {
			log.Fatalf("failed to serve gRPC: %v", err)
		}
	}()

	// 5. Start gRPC-Web Listener
	webPort := 8080
	allowedOrigins := os.Getenv("ALLOWED_ORIGINS")
	if allowedOrigins == "" {
		allowedOrigins = "*"
	}
	originsList := strings.Split(allowedOrigins, ",")

	// Add CORS for web clients
	corsHandler := cors.New(cors.Options{
		AllowedOrigins: originsList,
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"*"},
		ExposedHeaders: []string{"grpc-status", "grpc-message"},
	}).Handler(wrappedGrpc)

	// 6. Setup health check endpoint (for cron job keep-alive)
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ok","timestamp":%d}`, time.Now().Unix())
	})
	mux.Handle("/", corsHandler)

	fmt.Printf("gRPC-Web server listening on http://localhost:%d\n", webPort)
	fmt.Printf("Health check endpoint: http://localhost:%d/health\n", webPort)
	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", webPort),
		Handler: mux,
	}

	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatalf("failed to serve gRPC-Web: %v", err)
	}
}
