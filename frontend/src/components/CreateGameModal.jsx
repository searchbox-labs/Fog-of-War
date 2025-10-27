import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function CreateGameModal({ isOpen, onClose, onCreateGame }) {
  const [formData, setFormData] = useState({
    name: '',
    map_type: 'dungeon_alpha',
    max_players: 50,
    entry_fee: 1.0,
    duration_minutes: 5,
  });
  const [loading, setLoading] = useState(false);

  const { connectWallet } = useAuth();

  const mapOptions = [
    { value: 'dungeon_alpha', label: 'Dungeon Alpha' },
    { value: 'sector_7_ruins', label: 'Sector 7 Ruins' },
    { value: 'station_omega', label: 'Station Omega' },
    { value: 'jungle_temple', label: 'Jungle Temple' },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Ensure wallet is connected - use AuthContext user state
      if (!user?.wallet_address) {
        alert('Please connect your wallet first using the Connect Wallet button');
        setLoading(false);
        return;
      }

      await onCreateGame(formData);
      setFormData({
        name: '',
        map_type: 'dungeon_alpha',
        max_players: 50,
        entry_fee: 1.0,
        duration_minutes: 5,
      });
    } catch (error) {
      console.error('Error creating game:', error);
      alert('Failed to create game');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'max_players' || name === 'duration_minutes'
        ? parseInt(value)
        : name === 'entry_fee'
        ? parseFloat(value)
        : value
    }));
  };

  if (!isOpen) return null;

  const prizePool = formData.entry_fee * formData.max_players;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bgDark border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">Create New Game</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Game Name
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter game name"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accentGreen"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Map Type
            </label>
            <select
              name="map_type"
              value={formData.map_type}
              onChange={handleChange}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-accentGreen"
            >
              {mapOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Max Players
            </label>
            <input
              type="number"
              name="max_players"
              value={formData.max_players}
              onChange={handleChange}
              min="2"
              max="100"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-accentGreen"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Entry Fee (SOL)
            </label>
            <input
              type="number"
              name="entry_fee"
              value={formData.entry_fee}
              onChange={handleChange}
              min="0.1"
              step="0.1"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-accentGreen"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              name="duration_minutes"
              value={formData.duration_minutes}
              onChange={handleChange}
              min="1"
              max="60"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-accentGreen"
              required
            />
          </div>

          <div className="bg-gray-800 p-3 rounded-md">
            <div className="text-sm text-gray-300">
              Prize Pool: <span className="text-accentGreen font-bold">{prizePool.toFixed(2)} SOL</span>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-accentGreen text-black font-bold rounded-md hover:bg-accentGreen/80 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Game'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
