import React, { useState, useEffect } from "react";
import { useAppKit, useAppKitAccount, useAppKitBalance } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

function WalletConnectButton() {
  const { open } = useAppKit();
  const { address, isConnected, status } = useAppKitAccount();
  const { fetchBalance } = useAppKitBalance();
  const { connectWallet } = useAuth();

  const [balance, setBalance] = useState(null);
  const [isConnectingToBackend, setIsConnectingToBackend] = useState(false);

  useEffect(() => {
    if (isConnected && address) {
      fetchBalance().then((result) => {
        setBalance(result.data);
      });

      // Connect to backend when wallet is connected
      handleBackendConnection(address);
    }
  }, [isConnected, address, fetchBalance]);

  const handleBackendConnection = async (walletAddress) => {
    setIsConnectingToBackend(true);
    try {
      // Use AuthContext connectWallet method to handle user creation/authentication
      const result = await connectWallet(walletAddress);
      if (result.success) {
        console.log('Wallet connected and user created/authenticated successfully');
      } else {
        console.error('Failed to connect wallet:', result.error);
      }
    } catch (error) {
      console.error('Failed to connect wallet to backend:', error);
    } finally {
      setIsConnectingToBackend(false);
    }
  };

  const formatAddress = (addr) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const handleWalletClick = () => {
    if (isConnected) {
      open({ view: "Account" });
    } else {
      open({ view: "Connect", namespace: "eip155" });
    }
  };

  return (
    <div className="flex items-center space-x-3">
      <button
        onClick={handleWalletClick}
        disabled={isConnectingToBackend}
        className={`
          px-4 py-2 rounded-lg text-sm font-medium border transition-colors
          flex items-center space-x-2 cursor-pointer
          ${isConnected
            ? 'bg-green-50 hover:bg-green-100 text-green-700 border-green-200 hover:border-green-300'
            : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 hover:border-blue-300'
          }
          ${isConnectingToBackend ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <Wallet className="w-4 h-4" />
        <span>
          {isConnectingToBackend
            ? 'Connecting...'
            : status === 'connecting'
              ? 'Connecting...'
              : isConnected && address
                ? formatAddress(address)
                : 'Connect Wallet'
          }
        </span>
        {isConnected && !isConnectingToBackend && (
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
      </button>

      {isConnected && balance && (
        <div className="bg-gray-50 px-4 py-2 rounded-lg border border-gray-200">
          <div className="flex items-center space-x-2">
            <Wallet className="w-4 h-4 text-blue-600" />
            <span className="text-gray-900 font-semibold">
              {balance?.balance || '0'} {balance?.symbol || 'OG'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default WalletConnectButton;
