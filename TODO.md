# TODO: Implement Advanced Game Features

## Backend Changes
- [x] Install Django Channels and add to requirements.txt
- [x] Update backend/backend/settings.py to configure Channels
- [x] Update backend/backend/asgi.py for Channels routing
- [x] Create backend/core/consumers.py for WebSocket consumers (game room management)
- [x] Update backend/core/views.py PlayerMovementView to broadcast position updates via WebSockets
- [x] Add real-time combat/health management in consumers.py

## Frontend Changes
- [x] Update frontend/package.json to add WebSocket library (e.g., socket.io-client)
- [x] Update frontend/src/services/api.js to include WebSocket connection setup
- [x] Update frontend/src/contexts/GameContext.jsx to replace polling with WebSocket listeners
- [x] Modify frontend/src/components/GameEntities.jsx to dynamically render player positions from WebSocket data

## Testing
- [x] Test WebSocket connections and real-time updates
- [x] Verify player position synchronization
- [x] Test combat/health real-time updates
- [x] Ensure no breaking changes to existing functionality

## New Features Implementation
- [x] Add NPC and Hazard models to backend/core/models.py
- [x] Implement timer system in backend/core/consumers.py with broadcasts
- [x] Add threat events (NPC patrols, hazards) to consumers.py
- [x] Enhance loot collection with Arcium position verification in views.py
- [x] Implement extraction zone verification with Arcium in views.py
- [x] Update frontend/src/components/GameEntities.jsx to render NPCs and hazards
- [x] Integrate Timer component with game state in GameContext.jsx
- [x] Add threat state management to GameContext.jsx
- [x] Test Arcium verification, timer accuracy, and threat mechanics