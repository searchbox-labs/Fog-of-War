import React, { createContext, useContext, useState, useEffect } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { WalletProvider } from '../config/index'

const WalletContext = createContext()

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

export function WalletContextProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false)
  const [address, setAddress] = useState('')
  const [balance, setBalance] = useState('0')

  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount()
  const { disconnect } = useDisconnect()

  useEffect(() => {
    setIsConnected(wagmiConnected)
    if (wagmiAddress) {
      setAddress(wagmiAddress)
      // TODO: Fetch balance
      setBalance('0.0')
    } else {
      setAddress('')
      setBalance('0')
    }
  }, [wagmiConnected, wagmiAddress])

  const connectWallet = async () => {
    // This will be handled by the AppKit modal
    // The modal will be triggered from the WalletConnectButton
  }

  const disconnectWallet = () => {
    disconnect()
  }

  const value = {
    isConnected,
    address,
    balance,
    connectWallet,
    disconnectWallet
  }

  return (
    <WalletContext.Provider value={value}>
      <WalletProvider>
        {children}
      </WalletProvider>
    </WalletContext.Provider>
  )
}
