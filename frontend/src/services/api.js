const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8002';

import axios from 'axios';
import io from 'socket.io-client';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: `${API_BASE_URL}`, // Django backend URL
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired, redirect to login
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/auth/login/', credentials),
  register: (userData) => api.post('/auth/register/', userData),
  refreshToken: (refreshToken) => api.post('/auth/token/refresh/', { refresh: refreshToken }),
  getCurrentUser: () => api.get('/auth/users/me/'),
};

// Game API
export const gameAPI = {
  // Game Sessions
  getGames: (params) => api.get('/games/', { params }),
  createGame: (gameData) => api.post('/games/', gameData),
  getGame: (gameId) => api.get(`/games/${gameId}/`),
  joinGame: (gameId) => api.post(`/games/${gameId}/join/`),
  startGame: (gameId) => api.post(`/games/${gameId}/start/`),

  // Player Sessions
  getPlayerSession: (sessionId) => api.get(`/player-sessions/${sessionId}/`),
  updatePlayerPosition: (sessionId, position) => api.patch(`/player-sessions/${sessionId}/`, position),

  // Loot Operations
  collectLoot: (data) => api.post('/game/collect-loot/', data),
  extractLoot: (data) => api.post('/game/extract/', data),

  // Events
  getGameEvents: (gameSessionId) => api.get('/events/', { params: { game_session: gameSessionId } }),

  // Leaderboard
  getLeaderboard: (type = 'extracted') => api.get('/leaderboard/', { params: { type } }),

  // Wallet
  connectWallet: (walletAddress) => api.post('/wallet/connect/', { wallet_address: walletAddress }),
};

// WebSocket API
export const websocketAPI = {
  connectToGame: (gameSessionId, token) => {
    const socket = io(`${API_BASE_URL}`, {
      auth: {
        token: token
      },
      query: {
        game_session_id: gameSessionId
      }
    });

    return socket;
  }
};

// User API
export const userAPI = {
  getUsers: () => api.get('/users/'),
  getUser: (userId) => api.get(`/users/${userId}/`),
  updateUser: (userId, data) => api.patch(`/users/${userId}/`, data),
  searchUsers: (query) => api.get('/users/search/', { params: { q: query } }),
};

export default api;
