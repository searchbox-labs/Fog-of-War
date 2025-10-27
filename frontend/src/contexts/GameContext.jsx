import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { gameAPI, websocketAPI } from '../services/api';
import { useAuth } from './AuthContext';

const GameContext = createContext();

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};

export const GameProvider = ({ children }) => {
  const { user } = useAuth();
  const [games, setGames] = useState([]);
  const [currentGame, setCurrentGame] = useState(null);
  const [playerSession, setPlayerSession] = useState(null);
  const [gameEvents, setGameEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [players, setPlayers] = useState([]); // Real-time player positions
  const [npcs, setNpcs] = useState([]); // Real-time NPC positions
  const [hazards, setHazards] = useState([]); // Real-time hazard states
  const [gameTime, setGameTime] = useState(0); // Game timer in seconds
  const socketRef = useRef(null);

  // Fetch active games
  const fetchGames = useCallback(async (status = 'waiting') => {
    try {
      setLoading(true);
      const response = await gameAPI.getGames({ status });
      setGames(response.data.results || response.data);
    } catch (err) {
      console.error('Failed to fetch games:', err);
      setError('Failed to load games');
    } finally {
      setLoading(false);
    }
  }, []);

  // Create new game
  const createGame = async (gameData) => {
    try {
      setLoading(true);
      const response = await gameAPI.createGame(gameData);
      setGames(prev => [response.data, ...prev]);
      return { success: true, game: response.data };
    } catch (err) {
      console.error('Failed to create game:', err);
      setError('Failed to create game');
      return { success: false, error: err.response?.data || err.message };
    } finally {
      setLoading(false);
    }
  };

  // Join game
  const joinGame = async (gameId) => {
    try {
      setLoading(true);
      const response = await gameAPI.joinGame(gameId);
      setPlayerSession(response.data);

      // Refresh games list to update player count
      await fetchGames();

      return { success: true, playerSession: response.data };
    } catch (err) {
      console.error('Failed to join game:', err);
      setError('Failed to join game');
      return { success: false, error: err.response?.data?.error || err.message };
    } finally {
      setLoading(false);
    }
  };

  // Start game
  const startGame = async (gameId) => {
    try {
      setLoading(true);
      await gameAPI.startGame(gameId);

      // Refresh current game
      if (currentGame?.id === gameId) {
        const response = await gameAPI.getGame(gameId);
        setCurrentGame(response.data);
      }

      return { success: true };
    } catch (err) {
      console.error('Failed to start game:', err);
      setError('Failed to start game');
      return { success: false, error: err.response?.data || err.message };
    } finally {
      setLoading(false);
    }
  };

  // Update player position
  const updatePlayerPosition = async (positionX, positionY) => {
    if (!playerSession) return;

    try {
      await gameAPI.updatePlayerPosition(playerSession.id, {
        position_x: positionX,
        position_y: positionY,
      });

      // Send position update via WebSocket
      if (socketRef.current) {
        socketRef.current.emit('player_move', {
          type: 'player_move',
          position_x: positionX,
          position_y: positionY,
        });
      }
    } catch (err) {
      console.error('Failed to update position:', err);
    }
  };

  // Collect loot
  const collectLoot = async (positionX, positionY) => {
    if (!playerSession) return { success: false };

    try {
      const response = await gameAPI.collectLoot({
        player_session_id: playerSession.id,
        position_x: positionX,
        position_y: positionY,
      });

      // Update player session with new loot balance
      setPlayerSession(prev => ({
        ...prev,
        // Note: encrypted balance update would come from backend
      }));

      return { success: true, data: response.data };
    } catch (err) {
      console.error('Failed to collect loot:', err);
      return { success: false, error: err.response?.data?.error || err.message };
    }
  };

  // Extract loot
  const extractLoot = async () => {
    if (!playerSession) return { success: false };

    try {
      const response = await gameAPI.extractLoot({
        player_session_id: playerSession.id,
      });

      return { success: true, data: response.data };
    } catch (err) {
      console.error('Failed to extract loot:', err);
      return { success: false, error: err.response?.data?.error || err.message };
    }
  };

  // Fetch game events
  const fetchGameEvents = useCallback(async (gameSessionId) => {
    if (!gameSessionId) return;

    try {
      const response = await gameAPI.getGameEvents(gameSessionId);
      setGameEvents(response.data.results || response.data);
    } catch (err) {
      console.error('Failed to fetch game events:', err);
    }
  }, []);

  // Get leaderboard
  const getLeaderboard = async (type = 'extracted') => {
    try {
      const response = await gameAPI.getLeaderboard(type);
      return response.data;
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
      return [];
    }
  };

  // Set current game
  const selectGame = async (game) => {
    setCurrentGame(game);
    if (game) {
      await fetchGameEvents(game.id);

      // Connect to WebSocket for real-time updates
      if (user && playerSession) {
        connectWebSocket(game.id);
      }
    }
  };

  // Clear current game
  const clearGame = () => {
    setCurrentGame(null);
    setPlayerSession(null);
    setGameEvents([]);
    setPlayers([]);
    setNpcs([]);
    setHazards([]);
    setGameTime(0);

    // Disconnect WebSocket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  // WebSocket connection
  const connectWebSocket = (gameSessionId) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const token = localStorage.getItem('access_token');
    socketRef.current = websocketAPI.connectToGame(gameSessionId, token);

    socketRef.current.on('connect', () => {
      console.log('Connected to game WebSocket');
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from game WebSocket');
    });

    socketRef.current.on('initial_state', (data) => {
      setPlayers(data.game_state.players || []);
      setNpcs(data.game_state.npcs || []);
      setHazards(data.game_state.hazards || []);
    });

    socketRef.current.on('player_position_update', (data) => {
      setPlayers(prevPlayers =>
        prevPlayers.map(player =>
          player.id === data.player_id
            ? { ...player, position_x: data.position_x, position_y: data.position_y }
            : player
        )
      );
    });

    socketRef.current.on('player_attack_result', (data) => {
      setPlayers(prevPlayers =>
        prevPlayers.map(player =>
          player.id === data.target_id
            ? { ...player, health: data.target_health, status: data.target_status }
            : player.id === data.attacker_id
            ? { ...player, kills: (player.kills || 0) + (data.target_status === 'eliminated' ? 1 : 0) }
            : player
        )
      );
    });

    socketRef.current.on('loot_collected', (data) => {
      // Handle loot collection updates if needed
      console.log('Loot collected:', data);
    });

    socketRef.current.on('timer_update', (data) => {
      setGameTime(data.remaining_seconds);
      if (currentGame && data.game_status === 'completed') {
        setCurrentGame(prev => ({ ...prev, status: 'completed' }));
      }
    });

    socketRef.current.on('threat_update', (data) => {
      setNpcs(data.npcs || []);
      setHazards(data.hazards || []);
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });
  };

  // Auto-refresh game events for active games (keep for events, but remove polling for positions)
  useEffect(() => {
    if (currentGame?.status === 'active') {
      const interval = setInterval(() => {
        fetchGameEvents(currentGame.id);
      }, 5000); // Refresh events less frequently since we have WebSockets for real-time data

      return () => clearInterval(interval);
    }
  }, [currentGame, fetchGameEvents]);

  // Load games on mount
  useEffect(() => {
    if (user) {
      fetchGames();
    }
  }, [user, fetchGames]);

  const value = {
    games,
    currentGame,
    playerSession,
    gameEvents,
    players,
    npcs,
    hazards,
    gameTime,
    loading,
    error,
    fetchGames,
    createGame,
    joinGame,
    startGame,
    updatePlayerPosition,
    collectLoot,
    extractLoot,
    fetchGameEvents,
    getLeaderboard,
    selectGame,
    clearGame,
  };

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
};
