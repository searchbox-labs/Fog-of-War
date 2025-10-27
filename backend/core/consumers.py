import json
import asyncio
from datetime import datetime, timedelta
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from .models import GameSession, PlayerSession, GameEvent, NPC, Hazard
from .serializers import PlayerSessionSerializer


class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.game_session_id = self.scope['url_route']['kwargs']['game_session_id']
        self.room_group_name = f'game_{self.game_session_id}'

        # Check if user is authenticated
        user = self.scope.get('user', AnonymousUser())
        if user.is_anonymous:
            await self.close()
            return

        # Check if user is part of this game session
        is_player = await self.is_player_in_game(user, self.game_session_id)
        if not is_player:
            await self.close()
            return

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

        # Send initial game state
        await self.send_initial_state()

        # Start game timer if game is active
        game_status = await self.get_game_status(self.game_session_id)
        if game_status == 'active':
            asyncio.create_task(self.start_game_timer())
            asyncio.create_task(self.start_threat_updates())

    async def disconnect(self, close_code):
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'player_move':
                await self.handle_player_move(data)
            elif message_type == 'player_attack':
                await self.handle_player_attack(data)
            elif message_type == 'collect_loot':
                await self.handle_collect_loot(data)

        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'error': 'Invalid JSON'
            }))

    async def handle_player_move(self, data):
        user = self.scope['user']
        position_x = data.get('position_x')
        position_y = data.get('position_y')

        if position_x is None or position_y is None:
            return

        # Update player position
        player_session = await self.update_player_position(user, self.game_session_id, position_x, position_y)

        if player_session:
            # Broadcast position update to all players in the game
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'player_position_update',
                    'player_id': str(player_session.id),
                    'position_x': position_x,
                    'position_y': position_y,
                }
            )

    async def handle_player_attack(self, data):
        user = self.scope['user']
        target_player_id = data.get('target_player_id')

        if not target_player_id:
            return

        # Process attack
        attack_result = await self.process_attack(user, self.game_session_id, target_player_id)

        if attack_result:
            # Broadcast attack result to all players
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'player_attack_result',
                    'attacker_id': str(attack_result['attacker_id']),
                    'target_id': str(attack_result['target_id']),
                    'damage': attack_result['damage'],
                    'target_health': attack_result['target_health'],
                    'target_status': attack_result['target_status'],
                }
            )

    async def handle_collect_loot(self, data):
        user = self.scope['user']
        position_x = data.get('position_x')
        position_y = data.get('position_y')

        # Process loot collection with Arcium verification
        loot_result = await self.process_loot_collection(user, self.game_session_id, position_x, position_y)

        if loot_result:
            # Broadcast loot collection to all players
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'loot_collected',
                    'player_id': str(loot_result['player_id']),
                    'loot_amount': loot_result['loot_amount'],
                    'position_x': position_x,
                    'position_y': position_y,
                }
            )

    async def handle_start_game(self, data):
        # Start the game timer and threat updates
        await self.start_game_timer()
        await self.start_threat_updates()

    # Handler for broadcasting player position updates
    async def player_position_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'player_position_update',
            'player_id': event['player_id'],
            'position_x': event['position_x'],
            'position_y': event['position_y'],
        }))

    # Handler for broadcasting attack results
    async def player_attack_result(self, event):
        await self.send(text_data=json.dumps({
            'type': 'player_attack_result',
            'attacker_id': event['attacker_id'],
            'target_id': event['target_id'],
            'damage': event['damage'],
            'target_health': event['target_health'],
            'target_status': event['target_status'],
        }))

    # Handler for broadcasting loot collection
    async def loot_collected(self, event):
        await self.send(text_data=json.dumps({
            'type': 'loot_collected',
            'player_id': event['player_id'],
            'loot_amount': event['loot_amount'],
            'position_x': event['position_x'],
            'position_y': event['position_y'],
        }))

    # Handler for timer updates
    async def timer_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'timer_update',
            'remaining_seconds': event['remaining_seconds'],
            'game_status': event['game_status'],
        }))

    # Handler for threat updates
    async def threat_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'threat_update',
            'npcs': event['npcs'],
            'hazards': event['hazards'],
        }))

    async def send_initial_state(self):
        # Send current game state to the newly connected player
        game_state = await self.get_game_state(self.game_session_id)

        await self.send(text_data=json.dumps({
            'type': 'initial_state',
            'game_state': game_state,
        }))

    @database_sync_to_async
    def is_player_in_game(self, user, game_session_id):
        try:
            game_session = GameSession.objects.get(id=game_session_id)
            return PlayerSession.objects.filter(
                user=user,
                game_session=game_session
            ).exists()
        except GameSession.DoesNotExist:
            return False

    @database_sync_to_async
    def update_player_position(self, user, game_session_id, position_x, position_y):
        try:
            player_session = PlayerSession.objects.get(
                user=user,
                game_session_id=game_session_id,
                status='alive'
            )
            player_session.position_x = position_x
            player_session.position_y = position_y
            player_session.save()
            return player_session
        except PlayerSession.DoesNotExist:
            return None

    @database_sync_to_async
    def process_attack(self, user, game_session_id, target_player_id):
        try:
            attacker = PlayerSession.objects.get(
                user=user,
                game_session_id=game_session_id,
                status='alive'
            )
            target = PlayerSession.objects.get(
                id=target_player_id,
                game_session_id=game_session_id,
                status='alive'
            )

            # Simple damage calculation (can be made more complex)
            damage = 20
            target.health = max(0, target.health - damage)

            if target.health <= 0:
                target.status = 'eliminated'
                attacker.kills += 1

            attacker.save()
            target.save()

            # Create game event
            GameEvent.objects.create(
                game_session_id=game_session_id,
                event_type='player_eliminated' if target.health <= 0 else 'player_attacked',
                player=attacker,
                target_player=target,
                data={'damage': damage, 'target_health': target.health}
            )

            return {
                'attacker_id': attacker.id,
                'target_id': target.id,
                'damage': damage,
                'target_health': target.health,
                'target_status': target.status,
            }

        except (PlayerSession.DoesNotExist, ValueError):
            return None

    @database_sync_to_async
    def process_loot_collection(self, user, game_session_id, position_x, position_y):
        # Simplified loot collection - in production, use Arcium for encrypted position verification
        try:
            player_session = PlayerSession.objects.get(
                user=user,
                game_session_id=game_session_id,
                status='alive'
            )

            # Find nearby loot (simplified - should use Arcium in production)
            from .models import LootItem
            loot_items = LootItem.objects.filter(
                game_session_id=game_session_id,
                collected_by__isnull=True
            )

            collected_loot = None
            for loot in loot_items:
                # In production, decrypt and verify position match
                distance = ((loot.encrypted_position_x - position_x)**2 + (loot.encrypted_position_y - position_y)**2)**0.5
                if distance <= 2.0:  # Within collection range
                    collected_loot = loot
                    break

            if collected_loot:
                collected_loot.collected_by = player_session
                collected_loot.save()

                # Update player's encrypted loot balance (simplified)
                # In production, use Arcium to add to encrypted balance

                # Create game event
                GameEvent.objects.create(
                    game_session_id=game_session_id,
                    event_type='loot_collected',
                    player=player_session,
                    loot_item=collected_loot,
                    data={'amount': str(collected_loot.sol_value)}
                )

                return {
                    'player_id': player_session.id,
                    'loot_amount': str(collected_loot.sol_value),
                }

        except PlayerSession.DoesNotExist:
            return None

    @database_sync_to_async
    def get_game_state(self, game_session_id):
        try:
            game_session = GameSession.objects.get(id=game_session_id)
            players = PlayerSession.objects.filter(game_session=game_session)
            npcs = NPC.objects.filter(game_session=game_session, is_active=True)
            hazards = Hazard.objects.filter(game_session=game_session, is_active=True)

            player_data = []
            for player in players:
                player_data.append({
                    'id': str(player.id),
                    'user_id': player.user.id,
                    'username': player.user.username,
                    'position_x': player.position_x,
                    'position_y': player.position_y,
                    'health': player.health,
                    'status': player.status,
                    'kills': player.kills,
                })

            npc_data = []
            for npc in npcs:
                npc_data.append({
                    'id': str(npc.id),
                    'npc_type': npc.npc_type,
                    'name': npc.name,
                    'position_x': npc.position_x,
                    'position_y': npc.position_y,
                    'health': npc.health,
                    'detection_range': npc.detection_range,
                    'attack_range': npc.attack_range,
                })

            hazard_data = []
            for hazard in hazards:
                hazard_data.append({
                    'id': str(hazard.id),
                    'hazard_type': hazard.hazard_type,
                    'position_x': hazard.position_x,
                    'position_y': hazard.position_y,
                    'radius': hazard.radius,
                    'damage': hazard.damage,
                    'is_active': hazard.is_active,
                })

            return {
                'game_session_id': str(game_session.id),
                'status': game_session.status,
                'players': player_data,
                'npcs': npc_data,
                'hazards': hazard_data,
            }

        except GameSession.DoesNotExist:
            return None

    @database_sync_to_async
    def get_game_status(self, game_session_id):
        try:
            game_session = GameSession.objects.get(id=game_session_id)
            return game_session.status
        except GameSession.DoesNotExist:
            return None

    async def start_game_timer(self):
        """Start the game timer and broadcast updates"""
        try:
            game_session = await database_sync_to_async(GameSession.objects.get)(id=self.game_session_id)
            duration_minutes = game_session.duration_minutes
            total_seconds = duration_minutes * 60

            # Set start time if not set
            if not game_session.start_time:
                game_session.start_time = timezone.now()
                await database_sync_to_async(game_session.save)()

            start_time = game_session.start_time

            while True:
                now = timezone.now()
                elapsed = (now - start_time).total_seconds()
                remaining_seconds = max(0, total_seconds - elapsed)

                # Broadcast timer update
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'timer_update',
                        'remaining_seconds': int(remaining_seconds),
                        'game_status': 'active' if remaining_seconds > 0 else 'completed',
                    }
                )

                if remaining_seconds <= 0:
                    # Game ended
                    await self.end_game_session()
                    break

                await asyncio.sleep(1)  # Update every second

        except Exception as e:
            print(f"Timer error: {e}")

    async def start_threat_updates(self):
        """Update NPC positions and hazard states"""
        while True:
            try:
                # Update NPC positions
                await self.update_npcs()

                # Update hazard states
                await self.update_hazards()

                # Get current threat state
                threat_state = await self.get_threat_state()

                # Broadcast threat updates
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'threat_update',
                        'npcs': threat_state['npcs'],
                        'hazards': threat_state['hazards'],
                    }
                )

                await asyncio.sleep(2)  # Update every 2 seconds

            except Exception as e:
                print(f"Threat update error: {e}")
                break

    @database_sync_to_async
    def update_npcs(self):
        """Update NPC positions and AI behavior"""
        npcs = NPC.objects.filter(game_session_id=self.game_session_id, is_active=True)

        for npc in npcs:
            # Simple patrol AI - move along patrol path
            if npc.patrol_path and len(npc.patrol_path) > 0:
                current_target = npc.patrol_path[npc.patrol_index]
                target_x, target_y = current_target

                # Move towards target
                dx = target_x - npc.position_x
                dy = target_y - npc.position_y
                distance = (dx**2 + dy**2)**0.5

                if distance > 0.5:  # Not at target yet
                    move_x = (dx / distance) * npc.speed * 0.1  # Small movement increment
                    move_y = (dy / distance) * npc.speed * 0.1
                    npc.position_x += move_x
                    npc.position_y += move_y
                else:
                    # Reached target, move to next patrol point
                    npc.patrol_index = (npc.patrol_index + 1) % len(npc.patrol_path)

            npc.save()

    @database_sync_to_async
    def update_hazards(self):
        """Update hazard states"""
        hazards = Hazard.objects.filter(game_session_id=self.game_session_id, is_active=True)

        for hazard in hazards:
            # Check if hazard should activate/deactivate
            now = timezone.now()

            if hazard.activation_time and now >= hazard.activation_time:
                if (now - hazard.activation_time).seconds >= hazard.duration:
                    hazard.is_active = False
                    hazard.save()

    @database_sync_to_async
    def get_threat_state(self):
        """Get current NPC and hazard states"""
        npcs = NPC.objects.filter(game_session_id=self.game_session_id, is_active=True)
        hazards = Hazard.objects.filter(game_session_id=self.game_session_id, is_active=True)

        npc_data = []
        for npc in npcs:
            npc_data.append({
                'id': str(npc.id),
                'npc_type': npc.npc_type,
                'name': npc.name,
                'position_x': npc.position_x,
                'position_y': npc.position_y,
                'health': npc.health,
                'detection_range': npc.detection_range,
                'attack_range': npc.attack_range,
            })

        hazard_data = []
        for hazard in hazards:
            hazard_data.append({
                'id': str(hazard.id),
                'hazard_type': hazard.hazard_type,
                'position_x': hazard.position_x,
                'position_y': hazard.position_y,
                'radius': hazard.radius,
                'damage': hazard.damage,
                'is_active': hazard.is_active,
            })

        return {
            'npcs': npc_data,
            'hazards': hazard_data,
        }

    @database_sync_to_async
    def end_game_session(self):
        """End the game session"""
        try:
            game_session = GameSession.objects.get(id=self.game_session_id)
            game_session.status = 'completed'
            game_session.end_time = timezone.now()
            game_session.save()

            # Create game ended event
            GameEvent.objects.create(
                game_session=game_session,
                event_type='game_ended'
            )

        except GameSession.DoesNotExist:
            pass
