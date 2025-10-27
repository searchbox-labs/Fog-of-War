import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function JoinGameModal({ isOpen, onClose, game, onJoinGame }) {
  const [loading, setLoading] = useState(false);
  const { user, connectWallet } = useAuth();

  const handleJoinGame = async () => {
    setLoading(true);

    try {
      // Ensure wallet is connected - use AuthContext user state
      if (!user?.wallet_address) {
        alert('Please connect your wallet first using the Connect Wallet button');
        setLoading(false);
        return;
      }

      await onJoinGame(game);
    } catch (error) {
      console.error('Error joining game:', error);
      alert('Failed to join game');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !game) return null;

  const progressPercentage = (game.current_players / game.max_players) * 100;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bgDark border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">Join Game</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Game Info */}
          <div className="bg-gray-800 p-4 rounded-md">
            <h3 className="text-lg font-bold text-white mb-2">{game.name}</h3>
            <div className="space-y-2 text-sm text-gray-300">
              <div>Map: <span className="text-accentGreen">{game.map_type.replace('_', ' ').toUpperCase()}</span></div>
              <div>Players: {game.current_players}/{game.max_players}</div>
              <div>Entry Fee: {game.entry_fee} SOL</div>
              <div>Prize Pool: {game.prize_pool} SOL</div>
              <div>Duration: {game.duration_minutes} minutes</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex justify-between text-sm text-gray-400 mb-1">
              <span>Players Joined</span>
              <span>{game.current_players}/{game.max_players}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-accentGreen h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Wallet Connection Status */}
          <div className="bg-gray-800 p-3 rounded-md">
            <div className="text-sm text-gray-300">
              Wallet: {user?.wallet_address ?
                <span className="text-accentGreen">
                  {user.wallet_address.slice(0, 8)}...{user.wallet_address.slice(-8)}
                </span> :
                <span className="text-red-400">Not connected</span>
              }
            </div>
          </div>

          {/* Warning */}
          <div className="bg-yellow-900/20 border border-yellow-600/30 p-3 rounded-md">
            <div className="flex items-start space-x-2">
              <span className="text-yellow-500 text-sm">⚠️</span>
              <div className="text-sm text-yellow-200">
                Joining this game will require payment of {game.entry_fee} SOL from your wallet.
                Make sure you have sufficient funds.
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleJoinGame}
              disabled={loading || game.current_players >= game.max_players}
              className="flex-1 px-4 py-2 bg-accentGreen text-black font-bold rounded-md hover:bg-accentGreen/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Joining...' :
               game.current_players >= game.max_players ? 'Game Full' :
               'Join Game'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
