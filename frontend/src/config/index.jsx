import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, arbitrum, polygon } from '@reown/appkit/networks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import React from 'react'

// 0. Setup queryClient
const queryClient = new QueryClient()

// 1. Get projectId from https://cloud.reown.com
const projectId = 'YOUR_PROJECT_ID' // Replace with your actual project ID

// 2. Create wagmiConfig
const wagmiAdapter = new WagmiAdapter({
  networks: [mainnet, arbitrum, polygon],
  projectId,
  ssr: true,
})

const config = createConfig({
  chains: [mainnet, arbitrum, polygon],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
  },
})

// 3. Create modal
createAppKit({
  adapters: [wagmiAdapter],
  networks: [mainnet, arbitrum, polygon],
  projectId,
  features: {
    analytics: true // Optional - defaults to your Cloud configuration
  }
})

export function WalletProvider({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
