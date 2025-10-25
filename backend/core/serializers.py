# core/serializers.py
from rest_framework import serializers
from .models import GameSession, PlayerSession, LootItem, GameEvent, Transaction
from users.serializers import UserSerializer


class GameSessionSerializer(serializers.ModelSerializer):
    current_players = serializers.SerializerMethodField()
    
    class Meta:
        model = GameSession
        fields = ['id', 'name', 'map_type', 'status', 'max_players', 'current_players',
                 'entry_fee', 'prize_pool', 'duration_minutes', 'start_time', 'created_at']
    
    def get_current_players(self, obj):
        return obj.players.count()

class PlayerSessionSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    
    class Meta:
        model = PlayerSession
        fields = ['id', 'user', 'status', 'position_x', 'position_y', 'health', 'kills', 'final_payout']

class LootItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = LootItem
        fields = ['id', 'item_type', 'sol_value', 'collected_by', 'collected_at']

class GameEventSerializer(serializers.ModelSerializer):
    player_username = serializers.CharField(source='player.user.username', read_only=True)
    target_username = serializers.CharField(source='target_player.user.username', read_only=True)
    
    class Meta:
        model = GameEvent
        fields = ['id', 'event_type', 'player_username', 'target_username', 'data', 'created_at']

class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'transaction_type', 'sol_amount', 'transaction_hash', 'status', 'created_at']