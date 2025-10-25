# core/services/solana_service.py
import os
import json
from decimal import Decimal

class SolanaService:
    def __init__(self):
        print("Initializing Mock Solana Service - for development only")
        self.wallet = None
    
    def verify_transaction(self, transaction_hash, expected_amount, expected_recipient):
        """Mock transaction verification for development"""
        print(f"Mock: Verifying transaction {transaction_hash}")
        return True  # Always return True in development
    
    def send_payout(self, recipient_address, amount):
        """Mock SOL payout for development"""
        print(f"Mock: Sending {amount} SOL to {recipient_address}")
        return f"mock_tx_{recipient_address[-8:]}_{int(amount)}"
    
    def get_balance(self, public_key):
        """Mock balance check"""
        return 10.0  # Return a mock balance
    
    def verify_wallet_ownership(self, public_key, signature, message):
        """Mock wallet verification"""
        return True