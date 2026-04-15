package services

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/programs/system"
	"github.com/gagliardetto/solana-go/rpc"
)

const lamportsPerSOL = 1_000_000_000

type SolanaService struct {
	RPCClient   *rpc.Client
	HouseKey    solana.PrivateKey   // server-controlled wallet — holds the prize pool
	HousePubkey solana.PublicKey
	IsMock      bool
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

	// Load house wallet private key (base58-encoded)
	pkBase58 := os.Getenv("SOLANA_HOUSE_PRIVATE_KEY")
	if pkBase58 == "" {
		// Fallback: try reading from a local JSON file (common for Solana CLI wallets)
		data, err := os.ReadFile("house-wallet.json")
		if err == nil {
			var key solana.PrivateKey
			err = json.Unmarshal(data, &key)
			if err == nil {
				s.HouseKey = key
				s.HousePubkey = key.PublicKey()
				s.IsMock = false
			}
		}
	} else {
		pk, err := solana.PrivateKeyFromBase58(pkBase58)
		if err == nil {
			s.HouseKey    = pk
			s.HousePubkey = pk.PublicKey()
			s.IsMock      = false
		}
	}

	if s.HouseKey != nil {
		fmt.Printf("SOLANA PRODUCTION MODE: House wallet = %s\n", s.HousePubkey.String())
	} else if !isMock {
		fmt.Println("CRITICAL ERROR: USE_MOCK_SERVICES is false but no house key found!")
	}

	return s
}

// HouseWalletAddress returns the public key of the house wallet.
func (s *SolanaService) HouseWalletAddress() string {
	if s.IsMock {
		return "MOCK_HOUSE_WALLET_ADDRESS"
	}
	return s.HousePubkey.String()
}

// VerifyDeposit checks that a Solana transaction on devnet:
//   - is confirmed
//   - transferred at least `requiredLamports` to the house wallet
//
// Returns the actual amount transferred in lamports.
func (s *SolanaService) VerifyDeposit(ctx context.Context, txSig string, requiredSOL float64) (bool, uint64, error) {
	if s.IsMock {
		lamports := uint64(requiredSOL * lamportsPerSOL)
		fmt.Printf("Mock Solana: VerifyDeposit sig=%s required=%.4f SOL → OK\n", txSig, requiredSOL)
		return true, lamports, nil
	}

	sig, err := solana.SignatureFromBase58(txSig)
	if err != nil {
		return false, 0, fmt.Errorf("invalid signature: %w", err)
	}

	// Poll up to 30 seconds for confirmation
	deadline := time.Now().Add(30 * time.Second)
	var tx *rpc.GetTransactionResult
	for time.Now().Before(deadline) {
		tx, err = s.RPCClient.GetTransaction(ctx, sig, &rpc.GetTransactionOpts{
			Encoding:   solana.EncodingBase64,
			Commitment: rpc.CommitmentConfirmed,
		})
		if err == nil && tx != nil {
			break
		}
		time.Sleep(2 * time.Second)
	}

	if tx == nil {
		return false, 0, fmt.Errorf("transaction not found after 30s: %s", txSig)
	}
	if tx.Meta == nil || tx.Meta.Err != nil {
		return false, 0, fmt.Errorf("transaction failed on-chain: %v", tx.Meta.Err)
	}

	// Check post-balance of house wallet increased by at least requiredLamports
	requiredLamports := uint64(requiredSOL * lamportsPerSOL)

	// Decode account keys to find house wallet index
	parsed, err := tx.Transaction.GetTransaction()
	if err != nil {
		return false, 0, fmt.Errorf("failed to parse transaction: %w", err)
	}

	houseIdx := -1
	for i, key := range parsed.Message.AccountKeys {
		if key.Equals(s.HousePubkey) {
			houseIdx = i
			break
		}
	}
	if houseIdx < 0 {
		return false, 0, fmt.Errorf("house wallet not found in transaction accounts")
	}

	if houseIdx >= len(tx.Meta.PostBalances) || houseIdx >= len(tx.Meta.PreBalances) {
		return false, 0, fmt.Errorf("balance index out of range")
	}

	received := tx.Meta.PostBalances[houseIdx] - tx.Meta.PreBalances[houseIdx]
	if received < requiredLamports {
		return false, received, fmt.Errorf(
			"insufficient deposit: got %d lamports, need %d",
			received, requiredLamports,
		)
	}

	return true, received, nil
}

// SendPayout sends `amountSOL` from the house wallet to `recipientPubkey`.
// Returns the transaction signature.
func (s *SolanaService) SendPayout(ctx context.Context, recipientPubkeyStr string, amountSOL float64) (string, error) {
	if s.IsMock {
		fmt.Printf("Mock Solana: SendPayout → %s %.4f SOL\n", recipientPubkeyStr, amountSOL)
		return fmt.Sprintf("mock_payout_tx_%s", recipientPubkeyStr[:8]), nil
	}

	if s.HouseKey == nil {
		return "", fmt.Errorf("house wallet not configured")
	}

	recipient, err := solana.PublicKeyFromBase58(recipientPubkeyStr)
	if err != nil {
		return "", fmt.Errorf("invalid recipient pubkey: %w", err)
	}

	lamports := uint64(amountSOL * lamportsPerSOL)

	// Get recent blockhash
	recent, err := s.RPCClient.GetLatestBlockhash(ctx, rpc.CommitmentFinalized)
	if err != nil {
		return "", fmt.Errorf("get blockhash failed: %w", err)
	}

	// Build transfer transaction
	tx, err := solana.NewTransaction(
		[]solana.Instruction{
			system.NewTransferInstruction(
				lamports,
				s.HousePubkey,
				recipient,
			).Build(),
		},
		recent.Value.Blockhash,
		solana.TransactionPayer(s.HousePubkey),
	)
	if err != nil {
		return "", fmt.Errorf("build tx failed: %w", err)
	}

	// Sign with house key
	_, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		if key.Equals(s.HousePubkey) {
			return &s.HouseKey
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("sign tx failed: %w", err)
	}

	sig, err := s.RPCClient.SendTransactionWithOpts(ctx, tx, rpc.TransactionOpts{
		SkipPreflight: false,
	})
	if err != nil {
		return "", fmt.Errorf("send tx failed: %w", err)
	}

	fmt.Printf("Solana payout sent: %s → %s (%.4f SOL)\n", sig.String(), recipientPubkeyStr, amountSOL)
	return sig.String(), nil
}

// GetBalance returns the SOL balance of a wallet on devnet.
func (s *SolanaService) GetBalance(ctx context.Context, publicKey string) (float64, error) {
	if s.IsMock {
		return 5.0, nil
	}

	pub, err := solana.PublicKeyFromBase58(publicKey)
	if err != nil {
		return 0, err
	}

	out, err := s.RPCClient.GetBalance(ctx, pub, rpc.CommitmentFinalized)
	if err != nil {
		return 0, err
	}

	return float64(out.Value) / lamportsPerSOL, nil
}

// AirdropIfLow requests a devnet airdrop to the house wallet when balance is low.
// Only useful on devnet — safe to call at startup.
func (s *SolanaService) AirdropIfLow(ctx context.Context) {
	if s.IsMock || s.HouseKey == nil {
		return
	}

	bal, err := s.GetBalance(ctx, s.HousePubkey.String())
	if err != nil || bal >= 1.0 {
		return
	}

	fmt.Printf("House wallet balance low (%.4f SOL) — requesting devnet airdrop\n", bal)
	sig, err := s.RPCClient.RequestAirdrop(ctx, s.HousePubkey, 2*lamportsPerSOL, rpc.CommitmentFinalized)
	if err != nil {
		fmt.Printf("Airdrop failed: %v\n", err)
		return
	}
	fmt.Printf("Airdrop requested: %s\n", sig.String())
}
