package services

import (
	"context"
	"fmt"
	"os"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

type SolanaService struct {
	RPCClient      *rpc.Client
	PrivateKey     solana.PrivateKey
	SanctumPool    solana.PublicKey
	IsMock         bool
}

func NewSolanaService() *SolanaService {
	rpcURL := os.Getenv("SOLANA_RPC_URL")
	if rpcURL == "" {
		rpcURL = rpc.DevNet_RPC
	}

	isMock := os.Getenv("USE_MOCK_SERVICES") != "false"
	
	s := &SolanaService{
		RPCClient: rpc.New(rpcURL),
		IsMock:    isMock,
	}

	// In production, load private key and pool address from environment
	return s
}

func (s *SolanaService) VerifyTransaction(ctx context.Context, txHash string, expectedAmount float64) (bool, error) {
	if s.IsMock {
		fmt.Printf("Mock Solana: Verifying transaction %s for %f SOL\n", txHash, expectedAmount)
		return true, nil
	}

	sig, err := solana.SignatureFromBase58(txHash)
	if err != nil {
		return false, err
	}

	out, err := s.RPCClient.GetTransaction(
		ctx,
		sig,
		&rpc.GetTransactionOpts{
			Encoding: solana.EncodingBase64,
		},
	)
	if err != nil {
		return false, err
	}

	if out == nil || out.Meta == nil {
		return false, fmt.Errorf("transaction not found")
	}

	return out.Meta.Err == nil, nil
}

func (s *SolanaService) SendPayout(ctx context.Context, recipient string, amount float64) (string, error) {
	if s.IsMock {
		return fmt.Sprintf("mock_payout_tx_%s", recipient), nil
	}

	// In production, implement actual transaction signing and sending
	// This would involve creating a Transfer instruction and signing it with s.PrivateKey
	return "tx_hash", nil
}

func (s *SolanaService) GetBalance(ctx context.Context, publicKey string) (float64, error) {
	if s.IsMock {
		return 1.0, nil
	}

	pub, err := solana.PublicKeyFromBase58(publicKey)
	if err != nil {
		return 0, err
	}

	out, err := s.RPCClient.GetBalance(ctx, pub, rpc.CommitmentFinalized)
	if err != nil {
		return 0, err
	}

	return float64(out.Value) / 1e9, nil
}
