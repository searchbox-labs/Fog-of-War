package services

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"math/big"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Minimal ABI — only the functions we need
const fogSessionABI = `[
  {
    "inputs": [
      {"internalType": "uint256", "name": "maxPlayers", "type": "uint256"},
      {"internalType": "uint256", "name": "durationSeconds", "type": "uint256"}
    ],
    "name": "createSession",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "sessionId", "type": "uint256"}],
    "name": "joinSession",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "sessionId", "type": "uint256"}],
    "name": "startSession",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "sessionId", "type": "uint256"},
      {"internalType": "address", "name": "winner", "type": "address"}
    ],
    "name": "endSession",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "uint256", "name": "sessionId", "type": "uint256"},
      {"indexed": true, "internalType": "address", "name": "creator", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "maxPlayers", "type": "uint256"}
    ],
    "name": "SessionCreated",
    "type": "event"
  }
]`

type ArbitrumService struct {
	client          *ethclient.Client
	contractAddress common.Address
	parsedABI       abi.ABI
	privateKey      *ecdsa.PrivateKey
	fromAddress     common.Address
	chainID         *big.Int
	IsMock          bool
}

func NewArbitrumService() (*ArbitrumService, error) {
	isMock := os.Getenv("USE_MOCK_SERVICES") != "false"

	if isMock {
		return &ArbitrumService{IsMock: true}, nil
	}

	rpcURL := os.Getenv("ARBITRUM_RPC_URL")
	if rpcURL == "" {
		rpcURL = "https://sepolia-rollup.arbitrum.io/rpc"
	}

	contractAddr := os.Getenv("FOG_SESSION_CONTRACT")
	if contractAddr == "" {
		return nil, fmt.Errorf("FOG_SESSION_CONTRACT env var not set")
	}

	privateKeyHex := os.Getenv("ARBITRUM_PRIVATE_KEY")
	if privateKeyHex == "" {
		return nil, fmt.Errorf("ARBITRUM_PRIVATE_KEY env var not set")
	}

	// Strip 0x prefix if present
	privateKeyHex = strings.TrimPrefix(privateKeyHex, "0x")

	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Arbitrum: %w", err)
	}

	parsedABI, err := abi.JSON(strings.NewReader(fogSessionABI))
	if err != nil {
		return nil, fmt.Errorf("failed to parse ABI: %w", err)
	}

	privKey, err := crypto.HexToECDSA(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	publicKey := privKey.Public().(*ecdsa.PublicKey)
	fromAddress := crypto.PubkeyToAddress(*publicKey)

	chainID, err := client.ChainID(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get chain ID: %w", err)
	}

	return &ArbitrumService{
		client:          client,
		contractAddress: common.HexToAddress(contractAddr),
		parsedABI:       parsedABI,
		privateKey:      privKey,
		fromAddress:     fromAddress,
		chainID:         chainID,
		IsMock:          false,
	}, nil
}

// getTransactOpts builds a signed transaction options object
func (s *ArbitrumService) getTransactOpts(ctx context.Context, valueEth float64) (*bind.TransactOpts, error) {
	nonce, err := s.client.PendingNonceAt(ctx, s.fromAddress)
	if err != nil {
		return nil, fmt.Errorf("failed to get nonce: %w", err)
	}

	gasPrice, err := s.client.SuggestGasPrice(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get gas price: %w", err)
	}

	auth, err := bind.NewKeyedTransactorWithChainID(s.privateKey, s.chainID)
	if err != nil {
		return nil, fmt.Errorf("failed to create transactor: %w", err)
	}

	auth.Nonce = big.NewInt(int64(nonce))
	auth.GasPrice = gasPrice
	auth.GasLimit = uint64(300000)
	auth.Context = ctx

	if valueEth > 0 {
		// Convert ETH float to wei
		weiValue := new(big.Float).Mul(
			big.NewFloat(valueEth),
			new(big.Float).SetFloat64(1e18),
		)
		weiInt, _ := weiValue.Int(nil)
		auth.Value = weiInt
	}

	return auth, nil
}

// CreateSession — called when game manager spins up a new game
// Returns the on-chain session ID from the event log
func (s *ArbitrumService) CreateSession(ctx context.Context, maxPlayers int, durationSeconds int) (uint64, string, error) {
	if s.IsMock {
		fmt.Printf("Mock Arbitrum: CreateSession maxPlayers=%d duration=%ds\n", maxPlayers, durationSeconds)
		return 0, "mock_create_tx", nil
	}

	// Creation fee is 0.5 ETH
	auth, err := s.getTransactOpts(ctx, 0.5)
	if err != nil {
		return 0, "", err
	}

	contract := bind.NewBoundContract(
		s.contractAddress,
		s.parsedABI,
		s.client,
		s.client,
		s.client,
	)

	tx, err := contract.Transact(auth, "createSession",
		big.NewInt(int64(maxPlayers)),
		big.NewInt(int64(durationSeconds)),
	)
	if err != nil {
		return 0, "", fmt.Errorf("createSession tx failed: %w", err)
	}

	fmt.Printf("Arbitrum: CreateSession tx sent: %s\n", tx.Hash().Hex())

	// Wait for receipt to get session ID from event
	receipt, err := bind.WaitMined(ctx, s.client, tx)
	if err != nil {
		return 0, "", fmt.Errorf("waiting for receipt failed: %w", err)
	}

	// Parse SessionCreated event to get session ID
	for _, log := range receipt.Logs {
		event := struct {
			SessionId  *big.Int
			MaxPlayers *big.Int
		}{}
		err := s.parsedABI.UnpackIntoInterface(&event, "SessionCreated", log.Data)
		if err == nil && len(log.Topics) > 1 {
			sessionID := new(big.Int).SetBytes(log.Topics[1].Bytes())
			return sessionID.Uint64(), tx.Hash().Hex(), nil
		}
	}

	return 0, tx.Hash().Hex(), fmt.Errorf("SessionCreated event not found in logs")
}

// JoinSession — called when a player connects to a game
func (s *ArbitrumService) JoinSession(ctx context.Context, onChainSessionID uint64) (string, error) {
	if s.IsMock {
		fmt.Printf("Mock Arbitrum: JoinSession sessionId=%d\n", onChainSessionID)
		return "mock_join_tx", nil
	}

	// Entry fee is 1 ETH
	auth, err := s.getTransactOpts(ctx, 1.0)
	if err != nil {
		return "", err
	}

	contract := bind.NewBoundContract(
		s.contractAddress,
		s.parsedABI,
		s.client,
		s.client,
		s.client,
	)

	tx, err := contract.Transact(auth, "joinSession", big.NewInt(int64(onChainSessionID)))
	if err != nil {
		return "", fmt.Errorf("joinSession tx failed: %w", err)
	}

	fmt.Printf("Arbitrum: JoinSession tx sent: %s\n", tx.Hash().Hex())
	return tx.Hash().Hex(), nil
}

// StartSession — called when creator starts the game
func (s *ArbitrumService) StartSession(ctx context.Context, onChainSessionID uint64) (string, error) {
	if s.IsMock {
		fmt.Printf("Mock Arbitrum: StartSession sessionId=%d\n", onChainSessionID)
		return "mock_start_tx", nil
	}

	auth, err := s.getTransactOpts(ctx, 0)
	if err != nil {
		return "", err
	}

	contract := bind.NewBoundContract(
		s.contractAddress,
		s.parsedABI,
		s.client,
		s.client,
		s.client,
	)

	tx, err := contract.Transact(auth, "startSession", big.NewInt(int64(onChainSessionID)))
	if err != nil {
		return "", fmt.Errorf("startSession tx failed: %w", err)
	}

	fmt.Printf("Arbitrum: StartSession tx sent: %s\n", tx.Hash().Hex())
	return tx.Hash().Hex(), nil
}

// EndSession — called when game ends, triggers on-chain payout to winner
func (s *ArbitrumService) EndSession(ctx context.Context, onChainSessionID uint64, winnerAddress string) (string, error) {
	if s.IsMock {
		fmt.Printf("Mock Arbitrum: EndSession sessionId=%d winner=%s\n", onChainSessionID, winnerAddress)
		return "mock_end_tx", nil
	}

	auth, err := s.getTransactOpts(ctx, 0)
	if err != nil {
		return "", err
	}

	contract := bind.NewBoundContract(
		s.contractAddress,
		s.parsedABI,
		s.client,
		s.client,
		s.client,
	)

	winner := common.HexToAddress(winnerAddress)
	tx, err := contract.Transact(auth, "endSession",
		big.NewInt(int64(onChainSessionID)),
		winner,
	)
	if err != nil {
		return "", fmt.Errorf("endSession tx failed: %w", err)
	}

	fmt.Printf("Arbitrum: EndSession tx sent: %s\n", tx.Hash().Hex())
	return tx.Hash().Hex(), nil
}