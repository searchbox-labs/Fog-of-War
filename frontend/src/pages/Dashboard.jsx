// src/pages/Dashboard.jsx
import { useState, useEffect } from 'react';
import Header from '../components/Header';
import GameCard from '../components/GameCard';
import CreateGameModal from '../components/CreateGameModal';
import JoinGameModal from '../components/JoinGameModal';
import { useGame } from '../contexts/GameContext';
import { useAuth } from '../contexts/AuthContext';

export default function Dashboard() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);

  const { games, loading, error, fetchGames, createGame, joinGame } = useGame();
  const { user } = useAuth();

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const hasGames = games.length > 0;

  const handleCreateGame = async (gameData) => {
    const result = await createGame(gameData);
    if (result.success) {
      setIsCreateModalOpen(false);
    } else {
      alert('Failed to create game: ' + JSON.stringify(result.error));
    }
  };

  const handleJoinGameClick = (game) => {
    setSelectedGame(game);
    setIsJoinModalOpen(true);
  };

  const handleConfirmJoin = async (game) => {
    const result = await joinGame(game.id);
    if (result.success) {
      setIsJoinModalOpen(false);
      setSelectedGame(null);
      // Navigate to game page or update UI
      alert('Successfully joined game! Game will start soon.');
    } else {
      alert('Failed to join game: ' + result.error);
    }
  };

  if (loading) {
    return (
      <div className="dark min-h-screen bg-bgDark text-textPrimary font-display flex items-center justify-center">
        <div className="text-xl">Loading games...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dark min-h-screen bg-bgDark text-textPrimary font-display flex items-center justify-center">
        <div className="text-xl text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-bgDark text-textPrimary font-display">
      <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden">
        <div className="flex h-full grow flex-col">
          <Header />

          <main className="px-4 sm:px-8 md:px-16 lg:px-24 xl:px-40 flex flex-1 justify-center py-5">
            <div className="flex flex-col w-full max-w-7xl flex-1">
              {/* Page Header */}
              <div className="flex flex-wrap justify-between items-center gap-3 p-4 md:p-6 lg:p-8">
                <div className="flex min-w-72 flex-col gap-1">
                  <p className="text-white text-3xl font-bold tracking-[-0.033em]">Active Games</p>
                  <p className="text-textSecondary">Welcome back, {user?.username || 'Player'}</p>
                </div>
                {hasGames && (
                  <button
                    className="flex min-w-[120px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-11 px-6 bg-accentGreen text-black text-base font-bold tracking-[0.015em] hover:bg-accentGreen/80 transition-colors"
                    onClick={() => setIsCreateModalOpen(true)}
                  >
                    <span className="truncate">Create Game</span>
                  </button>
                )}
              </div>

              {/* Games Grid */}
              {hasGames ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 p-4 md:p-6 lg:p-8">
                  {games.map(game => (
                    <GameCard
                      key={game.id}
                      game={game}
                      onJoinGame={handleJoinGameClick}
                    />
                  ))}
                </div>
              ) : (
                /* Empty State */
                <div className="flex flex-col items-center justify-center gap-6 p-8 text-center">
                  <svg className="w-16 h-16 text-textSecondary/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-2xl font-bold text-white">No active games</h3>
                    <p className="text-textSecondary">Check back soon or create a new game to get started.</p>
                  </div>
                  <button
                    className="flex min-w-[120px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-11 px-6 bg-accentGreen text-black text-base font-bold tracking-[0.015em] hover:bg-accentGreen/80 transition-colors"
                    onClick={() => setIsCreateModalOpen(true)}
                  >
                    <span className="truncate">Create Game</span>
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      {/* Create Game Modal */}
      <CreateGameModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateGame={handleCreateGame}
      />

      {/* Join Game Modal */}
      <JoinGameModal
        isOpen={isJoinModalOpen}
        onClose={() => {
          setIsJoinModalOpen(false);
          setSelectedGame(null);
        }}
        game={selectedGame}
        onJoinGame={handleConfirmJoin}
      />
    </div>
  );
}
