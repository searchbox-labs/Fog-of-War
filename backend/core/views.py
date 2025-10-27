# core/views.py
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from datetime import timezone
from decimal import Decimal
import json
from .models import GameSession, PlayerSession, LootItem, GameEvent, Transaction
from .services.solana_service import SolanaService
from .services.arcium_service import ArciumService
from .serializers import GameSessionSerializer, PlayerSessionSerializer

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q
from .models import GameSession, PlayerSession, LootItem, GameEvent, Transaction
from .serializers import (
    GameSessionSerializer, PlayerSessionSerializer,
    LootItemSerializer, GameEventSerializer, TransactionSerializer
)

class GameSessionViewSet(viewsets.ModelViewSet):
    queryset = GameSession.objects.all()
    serializer_class = GameSessionSerializer
    
    def get_queryset(self):
        queryset = GameSession.objects.all()
        status_filter = self.request.query_params.get('status', None)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        return queryset
    
    @action(detail=True, methods=['post'])
    def join(self, request, pk=None):
        game_session = self.get_object()
        user = request.user
        
        # Check if game is joinable
        if game_session.status != 'waiting':
            return Response({'error': 'Game is not accepting players'}, status=status.HTTP_400_BAD_REQUEST)
        
        if game_session.players.count() >= game_session.max_players:
            return Response({'error': 'Game is full'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if player already joined
        if PlayerSession.objects.filter(user=user, game_session=game_session).exists():
            return Response({'error': 'Already joined this game'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Create player session
        player_session = PlayerSession.objects.create(
            user=user,
            game_session=game_session
        )
        
        # Create game event
        GameEvent.objects.create(
            game_session=game_session,
            event_type='player_joined',
            player=player_session
        )
        
        serializer = PlayerSessionSerializer(player_session)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        game_session = self.get_object()
        
        if game_session.status != 'waiting':
            return Response({'error': 'Game cannot be started'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Initialize game (distribute loot, etc.)
        game_session.status = 'active'
        game_session.save()
        
        # Create game start event
        GameEvent.objects.create(
            game_session=game_session,
            event_type='game_started'
        )
        
        return Response({'status': 'Game started'})

class PlayerSessionViewSet(viewsets.ModelViewSet):
    queryset = PlayerSession.objects.all()
    serializer_class = PlayerSessionSerializer

class GameEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = GameEvent.objects.all()
    serializer_class = GameEventSerializer
    
    def get_queryset(self):
        queryset = GameEvent.objects.all()
        game_session_id = self.request.query_params.get('game_session', None)
        if game_session_id:
            queryset = queryset.filter(game_session_id=game_session_id)
        return queryset

class WalletConnectView(APIView):
    permission_classes = []  # Allow unauthenticated access for wallet connection

    def post(self, request):
        wallet_address = request.data.get('wallet_address')
        if not wallet_address:
            return Response({'error': 'Wallet address required'}, status=status.HTTP_400_BAD_REQUEST)

        # For now, we'll create or get a user based on wallet address
        # In production, you'd want proper authentication flow
        from users.models import User
        user, created = User.objects.get_or_create(
            wallet_address=wallet_address,
            defaults={'username': f'user_{wallet_address[:8]}'}
        )

        return Response({
            'status': 'Wallet connected',
            'wallet_address': wallet_address,
            'user_created': created
        })

class EncryptLootView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        game_session_id = request.data.get('game_session_id')
        loot_distribution = request.data.get('loot_distribution')
        
        try:
            game_session = GameSession.objects.get(id=game_session_id)
            arcium_service = ArciumService()
            
            # Encrypt loot distribution
            encrypted_data = arcium_service.encrypt_loot_distribution(
                str(game_session.id),
                loot_distribution
            )
            
            game_session.encrypted_loot_data = encrypted_data
            game_session.save()
            
            return Response({'status': 'Loot encrypted', 'encrypted_data': encrypted_data})
            
        except GameSession.DoesNotExist:
            return Response({'error': 'Game session not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class DecryptLootView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        encrypted_balance = request.data.get('encrypted_balance')
        
        try:
            arcium_service = ArciumService()
            decrypted_data = arcium_service.decrypt_loot_balance(encrypted_balance)
            
            return Response({'decrypted_data': decrypted_data})
            
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class TransferLootView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        killer_id = request.data.get('killer_id')
        victim_id = request.data.get('victim_id')
        game_session_id = request.data.get('game_session_id')
        
        try:
            killer = PlayerSession.objects.get(id=killer_id, game_session_id=game_session_id)
            victim = PlayerSession.objects.get(id=victim_id, game_session_id=game_session_id)
            
            if victim.status != 'alive':
                return Response({'error': 'Victim is not alive'}, status=status.HTTP_400_BAD_REQUEST)
            
            arcium_service = ArciumService()
            
            # Transfer loot using Arcium's private computation
            transfer_result = arcium_service.transfer_loot_on_kill(
                killer.encrypted_loot_balance,
                victim.encrypted_loot_balance
            )
            
            # Update player balances
            killer.encrypted_loot_balance = transfer_result['killer_new_balance']
            victim.encrypted_loot_balance = transfer_result['victim_new_balance']
            victim.status = 'eliminated'
            
            killer.kills += 1
            killer.save()
            victim.save()
            
            # Create elimination event
            GameEvent.objects.create(
                game_session=killer.game_session,
                event_type='player_eliminated',
                player=killer,
                target_player=victim,
                data={'loot_transferred': True}
            )
            
            return Response({'status': 'Loot transferred', 'kills': killer.kills})
            
        except PlayerSession.DoesNotExist:
            return Response({'error': 'Player session not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class LeaderboardView(APIView):
    def get(self, request):
        from users.models import User
        leaderboard_type = request.GET.get('type', 'extracted')
        
        if leaderboard_type == 'extracted':
            users = User.objects.order_by('-total_sol_extracted')[:100]
        elif leaderboard_type == 'eliminations':
            users = User.objects.order_by('-eliminations')[:100]
        elif leaderboard_type == 'extractions':
            users = User.objects.order_by('-successful_extractions')[:100]
        else:
            users = User.objects.order_by('-total_sol_extracted')[:100]
        
        from users.serializers import UserSerializer
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)

class ExtractLootView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        player_session_id = request.data.get('player_session_id')
        
        try:
            player_session = PlayerSession.objects.get(
                id=player_session_id,
                user=request.user
            )
            
            if player_session.status != 'alive':
                return Response({'error': 'Player cannot extract'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Verify player is in extraction zone (simplified)
            in_extraction_zone = self._check_extraction_zone(
                player_session.position_x,
                player_session.position_y
            )
            
            if not in_extraction_zone:
                return Response({'error': 'Not in extraction zone'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Decrypt loot balance
            arcium_service = ArciumService()
            decrypted_loot = arcium_service.decrypt_loot_balance(
                player_session.encrypted_loot_balance
            )
            
            loot_amount = Decimal(decrypted_loot['amount'])
            
            # Process payout
            solana_service = SolanaService()
            payout_hash = solana_service.send_payout(
                request.user.wallet_address,
                loot_amount
            )
            
            if payout_hash:
                # Update player stats
                player_session.status = 'extracted'
                player_session.final_payout = loot_amount
                player_session.payout_transaction_hash = payout_hash
                player_session.save()
                
                # Update user stats
                request.user.total_sol_extracted += loot_amount
                request.user.successful_extractions += 1
                request.user.save()
                
                # Create extraction event
                GameEvent.objects.create(
                    game_session=player_session.game_session,
                    event_type='extraction_success',
                    player=player_session,
                    data={'amount': str(loot_amount), 'transaction_hash': payout_hash}
                )
                
                return Response({
                    'status': 'Extraction successful',
                    'amount': loot_amount,
                    'transaction_hash': payout_hash
                })
            else:
                return Response({'error': 'Payout failed'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                
        except PlayerSession.DoesNotExist:
            return Response({'error': 'Player session not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _check_extraction_zone(self, x, y):
        # Use Arcium to verify extraction zone access
        from .services.arcium_service import ArciumService
        arcium_service = ArciumService()

        # Define encrypted extraction zones
        extraction_zones = [
            {'encrypted_x': 'encrypted_90', 'encrypted_y': 'encrypted_90', 'radius': 10},  # Top-right corner
            {'encrypted_x': 'encrypted_10', 'encrypted_y': 'encrypted_90', 'radius': 10},  # Top-left corner
        ]

        for zone in extraction_zones:
            try:
                # Verify position match with encrypted zone coordinates
                x_match = arcium_service.verify_position_match(
                    zone['encrypted_x'], x, zone['radius']
                )
                y_match = arcium_service.verify_position_match(
                    zone['encrypted_y'], y, zone['radius']
                )

                if x_match and y_match:
                    return True
            except Exception as e:
                print(f"Arcium extraction zone verification failed: {e}")
                continue

        return False

class CollectLootView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        player_session_id = request.data.get('player_session_id')
        position_x = request.data.get('position_x')
        position_y = request.data.get('position_y')
        
        try:
            player_session = PlayerSession.objects.get(
                id=player_session_id,
                user=request.user,
                status='alive'
            )
            
            # Check for loot at position (simplified)
            # In production, use Arcium to verify encrypted position matches
            loot_items = LootItem.objects.filter(
                game_session=player_session.game_session,
                collected_by__isnull=True
            )
            
            collected_loot = None
            for loot in loot_items:
                # In production, this would use Arcium to decrypt and verify position
                if self._is_near_position(loot, position_x, position_y):
                    collected_loot = loot
                    break
            
            if collected_loot:
                # Update loot item
                collected_loot.collected_by = player_session
                collected_loot.collected_at = timezone.now()
                collected_loot.save()
                
                # Update player's encrypted loot balance using Arcium
                arcium_service = ArciumService()
                new_balance = arcium_service.add_to_encrypted_balance(
                    player_session.encrypted_loot_balance,
                    collected_loot.sol_value
                )
                
                player_session.encrypted_loot_balance = new_balance
                player_session.save()
                
                # Create loot collected event
                GameEvent.objects.create(
                    game_session=player_session.game_session,
                    event_type='loot_collected',
                    player=player_session,
                    loot_item=collected_loot,
                    data={'amount': str(collected_loot.sol_value)}
                )
                
                return Response({
                    'status': 'Loot collected',
                    'amount': collected_loot.sol_value,
                    'item_type': collected_loot.item_type
                })
            else:
                return Response({'error': 'No loot found at position'}, status=status.HTTP_400_BAD_REQUEST)
                
        except PlayerSession.DoesNotExist:
            return Response({'error': 'Player session not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _is_near_position(self, loot_item, x, y, threshold=2.0):
        # Use Arcium to verify position match without revealing exact coordinates
        from .services.arcium_service import ArciumService
        arcium_service = ArciumService()

        # Decrypt the loot position and verify player is within range
        try:
            decrypted_x = arcium_service.decrypt_loot_balance(loot_item.encrypted_position_x)
            decrypted_y = arcium_service.decrypt_loot_balance(loot_item.encrypted_position_y)

            loot_x = float(decrypted_x.get('amount', '0'))
            loot_y = float(decrypted_y.get('amount', '0'))

            distance = ((loot_x - x)**2 + (loot_y - y)**2)**0.5
            return distance <= threshold
        except Exception as e:
            print(f"Arcium position verification failed: {e}")
            return False  # Fail securely if verification fails
    

# Add to core/views.py
class CreateGameView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        serializer = GameSessionSerializer(data=request.data)
        if serializer.is_valid():
            game = serializer.save()
            
            # Initialize game with mock loot distribution
            from .services.game_initializer import GameInitializer
            initializer = GameInitializer()
            initializer.initialize_game_session(game)
            
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class PlayerMovementView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        player_session_id = request.data.get('player_session_id')
        new_x = request.data.get('position_x')
        new_y = request.data.get('position_y')

        try:
            player = PlayerSession.objects.get(
                id=player_session_id,
                user=request.user,
                status='alive'
            )
            player.position_x = new_x
            player.position_y = new_y
            player.save()

            # Broadcast position update via WebSocket
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync

            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'game_{player.game_session.id}',
                {
                    'type': 'player_position_update',
                    'player_id': str(player.id),
                    'position_x': new_x,
                    'position_y': new_y,
                }
            )

            return Response({'status': 'Position updated'})
        except PlayerSession.DoesNotExist:
            return Response({'error': 'Player not found'}, status=404)
