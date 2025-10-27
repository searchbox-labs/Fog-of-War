// src/components/GameEntities.jsx
import { useGame } from '../contexts/GameContext';

export default function GameEntities() {
    const { players, playerSession, npcs, hazards } = useGame();

    return (
      <div className="absolute inset-0">
        {/* Render players dynamically from WebSocket data */}
        {players.map((player) => {
          const isCurrentPlayer = playerSession && player.id === playerSession.id;
          const isEnemy = !isCurrentPlayer;

          // Convert position coordinates to CSS (assuming 100x100 grid)
          const leftPercent = (player.position_x / 100) * 100;
          const topPercent = (player.position_y / 100) * 100;

          return (
            <div
              key={player.id}
              className="absolute"
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              <Player
                name={isCurrentPlayer ? "You" : player.username}
                isEnemy={isEnemy}
                health={player.health}
                position={{}}
              />
            </div>
          );
        })}

        {/* Render NPCs */}
        {npcs && npcs.map((npc) => {
          const leftPercent = (npc.position_x / 100) * 100;
          const topPercent = (npc.position_y / 100) * 100;

          return (
            <div
              key={npc.id}
              className="absolute"
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              <NPC
                name={npc.name}
                npcType={npc.npc_type}
                health={npc.health}
                detectionRange={npc.detection_range}
              />
            </div>
          );
        })}

        {/* Render Hazards */}
        {hazards && hazards.map((hazard) => {
          const leftPercent = (hazard.position_x / 100) * 100;
          const topPercent = (hazard.position_y / 100) * 100;

          return (
            <div
              key={hazard.id}
              className="absolute"
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              <Hazard
                hazardType={hazard.hazard_type}
                radius={hazard.radius}
                isActive={hazard.is_active}
              />
            </div>
          );
        })}

        {/* Loot Collection Effect */}
        <div className="absolute top-[45%] left-[55%] animate-float-up opacity-0">
          <p className="text-lg font-bold text-[#FFD700] drop-shadow-[0_0_10px_#000]">+1.25 SOL</p>
        </div>

      </div>
    );
  }
  
  // Reusable Player Component
  function Player({ name, isEnemy, health, position }) {
    const playerClass = isEnemy
      ? "bg-gradient-to-b from-[#8b0000] to-[#660000] border-[#ff4444]"
      : "bg-gradient-to-b from-[#228b22] to-[#006400] border-[#ffd700] shadow-[0_0_20px_#ffd700] animate-pulse";

    const healthBarColor = isEnemy ? "bg-red-500" : "bg-green-500";

    return (
      <div className={`flex flex-col items-center ${position.top} ${position.bottom} ${position.left} ${position.right}`}>
        <p className="text-xs text-white bg-black/50 px-2 py-1 rounded mb-1">{name}</p>
        <div className={`w-12 h-12 rounded-full border-2 shadow-lg flex items-center justify-center ${playerClass}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isEnemy
              ? "bg-gradient-to-br from-[#ff6b6b] to-[#ee5a52]"
              : "bg-gradient-to-br from-[#32cd32] to-[#228b22]"
          }`}>
            <span className="material-icons text-white text-lg">person</span>
          </div>
        </div>
        <div className="w-16 h-1 bg-gray-600 rounded-full mt-1">
          <div
            className={`h-full rounded-full ${healthBarColor}`}
            style={{ width: `${health}%` }}
          ></div>
        </div>
      </div>
    );
  }

  // NPC Component
  function NPC({ name, npcType, health, detectionRange }) {
    const npcColors = {
      guard: "from-[#8b4513] to-[#654321] border-[#daa520]",
      patrol: "from-[#4169e1] to-[#000080] border-[#00bfff]",
      sentinel: "from-[#800080] to-[#4b0082] border-[#da70d6]"
    };

    const npcClass = npcColors[npcType] || npcColors.guard;

    return (
      <div className="flex flex-col items-center">
        <p className="text-xs text-white bg-black/50 px-2 py-1 rounded mb-1">{name}</p>
        <div className={`w-10 h-10 rounded-full border-2 shadow-lg flex items-center justify-center bg-gradient-to-b ${npcClass}`}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-gradient-to-br from-[#ff8c00] to-[#ff6347]">
            <span className="material-icons text-white text-sm">security</span>
          </div>
        </div>
        <div className="w-12 h-1 bg-gray-600 rounded-full mt-1">
          <div
            className="h-full rounded-full bg-orange-500"
            style={{ width: `${health}%` }}
          ></div>
        </div>
        {/* Detection range indicator */}
        <div
          className="absolute border-2 border-red-500/30 rounded-full pointer-events-none"
          style={{
            width: `${detectionRange * 2}px`,
            height: `${detectionRange * 2}px`,
            transform: 'translate(-50%, -50%)'
          }}
        ></div>
      </div>
    );
  }

  // Hazard Component
  function Hazard({ hazardType, radius, isActive }) {
    const hazardIcons = {
      spike_trap: "trap",
      poison_gas: "cloud",
      laser_grid: "grid_on",
      explosive_barrel: "local_fire_department"
    };

    const hazardColors = {
      spike_trap: "from-[#696969] to-[#2f2f2f] border-[#ff0000]",
      poison_gas: "from-[#006400] to-[#004400] border-[#00ff00]",
      laser_grid: "from-[#ff1493] to-[#8b008b] border-[#ff69b4]",
      explosive_barrel: "from-[#8b0000] to-[#4b0000] border-[#ff4500]"
    };

    const icon = hazardIcons[hazardType] || "warning";
    const hazardClass = hazardColors[hazardType] || hazardColors.spike_trap;
    const opacity = isActive ? 1 : 0.5;

    return (
      <div className="flex flex-col items-center" style={{ opacity }}>
        <div className={`w-8 h-8 rounded-full border-2 shadow-lg flex items-center justify-center bg-gradient-to-b ${hazardClass}`}>
          <span className="material-icons text-white text-sm">{icon}</span>
        </div>
        {/* Hazard radius indicator */}
        <div
          className="absolute border-2 border-yellow-500/30 rounded-full pointer-events-none animate-pulse"
          style={{
            width: `${radius * 2}px`,
            height: `${radius * 2}px`,
            transform: 'translate(-50%, -50%)'
          }}
        ></div>
      </div>
    );
  }
