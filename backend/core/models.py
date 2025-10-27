# core/models.py
from django.db import models
from django.core.validators import MinValueValidator
from decimal import Decimal
from django.conf import settings
import uuid

class GameSession(models.Model):
    STATUS_CHOICES = [
        ('waiting', 'Waiting for Players'),
        ('active', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]
    
    MAP_CHOICES = [
        ('dungeon_alpha', 'Dungeon Alpha'),
        ('sector_7_ruins', 'Sector 7 Ruins'),
        ('station_omega', 'Station Omega'),
        ('jungle_temple', 'Jungle Temple'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    map_type = models.CharField(max_length=50, choices=MAP_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='waiting')
    
    # Game configuration
    max_players = models.IntegerField(default=50)
    entry_fee = models.DecimalField(max_digits=18, decimal_places=9, validators=[MinValueValidator(Decimal('0.1'))])
    prize_pool = models.DecimalField(max_digits=18, decimal_places=9, default=0)
    duration_minutes = models.IntegerField(default=5)  # Game duration in minutes
    
    # Game state
    start_time = models.DateTimeField(null=True, blank=True)
    end_time = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Arcium integration
    encrypted_loot_data = models.TextField(blank=True)  # Encrypted loot distribution
    arcium_session_id = models.CharField(max_length=100, blank=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.name} ({self.get_status_display()})"
    
    def save(self, *args, **kwargs):
        if not self.prize_pool and self.entry_fee and self.max_players:
            self.prize_pool = self.entry_fee * self.max_players
        super().save(*args, **kwargs)

class PlayerSession(models.Model):
    STATUS_CHOICES = [
        ('alive', 'Alive'),
        ('extracted', 'Extracted'),
        ('eliminated', 'Eliminated'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    game_session = models.ForeignKey(GameSession, on_delete=models.CASCADE, related_name='players')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='alive')
    
    # Game stats
    position_x = models.FloatField(default=0)  # Player position on map
    position_y = models.FloatField(default=0)
    health = models.IntegerField(default=100)
    encrypted_loot_balance = models.TextField(blank=True)  # Encrypted loot amount
    kills = models.IntegerField(default=0)
    
    # Transaction info
    entry_transaction_hash = models.CharField(max_length=100, blank=True)
    payout_transaction_hash = models.CharField(max_length=100, blank=True)
    final_payout = models.DecimalField(max_digits=18, decimal_places=9, default=0)
    
    joined_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['user', 'game_session']
    
    def __str__(self):
        return f"{self.user.username} in {self.game_session.name}"

class LootItem(models.Model):
    ITEM_TYPES = [
        ('small', 'Small Loot'),
        ('medium', 'Medium Loot'),
        ('large', 'Large Loot'),
        ('final_chest', 'Final Chest'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game_session = models.ForeignKey(GameSession, on_delete=models.CASCADE, related_name='loot_items')
    item_type = models.CharField(max_length=20, choices=ITEM_TYPES)
    sol_value = models.DecimalField(max_digits=18, decimal_places=9, validators=[MinValueValidator(Decimal('0.01'))])
    
    # Encrypted position data
    encrypted_position_x = models.TextField()  # Encrypted coordinate
    encrypted_position_y = models.TextField()  # Encrypted coordinate
    arcium_reference = models.CharField(max_length=100, blank=True)
    
    # Collection state
    collected_by = models.ForeignKey(PlayerSession, on_delete=models.SET_NULL, null=True, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True)
    
    def __str__(self):
        return f"{self.get_item_type_display()} ({self.sol_value} SOL)"

class GameEvent(models.Model):
    EVENT_TYPES = [
        ('player_joined', 'Player Joined'),
        ('player_eliminated', 'Player Eliminated'),
        ('loot_collected', 'Loot Collected'),
        ('extraction_success', 'Extraction Success'),
        ('game_started', 'Game Started'),
        ('game_ended', 'Game Ended'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game_session = models.ForeignKey(GameSession, on_delete=models.CASCADE, related_name='events')
    event_type = models.CharField(max_length=50, choices=EVENT_TYPES)
    player = models.ForeignKey(PlayerSession, on_delete=models.CASCADE, null=True, blank=True)
    target_player = models.ForeignKey(PlayerSession, on_delete=models.CASCADE, null=True, blank=True, related_name='targeted_events')
    loot_item = models.ForeignKey(LootItem, on_delete=models.CASCADE, null=True, blank=True)
    
    # Event data
    data = models.JSONField(default=dict)  # Flexible event data storage
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.get_event_type_display()} - {self.game_session.name}"

class NPC(models.Model):
    NPC_TYPES = [
        ('guard', 'Guard'),
        ('patrol', 'Patrol'),
        ('sentinel', 'Sentinel'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game_session = models.ForeignKey(GameSession, on_delete=models.CASCADE, related_name='npcs')
    npc_type = models.CharField(max_length=20, choices=NPC_TYPES)
    name = models.CharField(max_length=50)

    # Position and movement
    position_x = models.FloatField(default=0)
    position_y = models.FloatField(default=0)
    patrol_path = models.JSONField(default=list)  # List of [x,y] coordinates for patrol
    patrol_index = models.IntegerField(default=0)  # Current position in patrol path
    speed = models.FloatField(default=1.0)  # Movement speed

    # Combat stats
    health = models.IntegerField(default=100)
    damage = models.IntegerField(default=15)
    detection_range = models.FloatField(default=10.0)  # Distance to detect players
    attack_range = models.FloatField(default=2.0)  # Distance to attack players

    # State
    is_active = models.BooleanField(default=True)
    last_move_time = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.get_npc_type_display()})"

class Hazard(models.Model):
    HAZARD_TYPES = [
        ('spike_trap', 'Spike Trap'),
        ('poison_gas', 'Poison Gas'),
        ('laser_grid', 'Laser Grid'),
        ('explosive_barrel', 'Explosive Barrel'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game_session = models.ForeignKey(GameSession, on_delete=models.CASCADE, related_name='hazards')
    hazard_type = models.CharField(max_length=20, choices=HAZARD_TYPES)

    # Position and area
    position_x = models.FloatField(default=0)
    position_y = models.FloatField(default=0)
    radius = models.FloatField(default=3.0)  # Effect radius
    damage = models.IntegerField(default=25)  # Damage per tick/second

    # State
    is_active = models.BooleanField(default=True)
    activation_time = models.DateTimeField(null=True, blank=True)
    duration = models.IntegerField(default=10)  # Duration in seconds

    def __str__(self):
        return f"{self.get_hazard_type_display()} at ({self.position_x}, {self.position_y})"

class Transaction(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('confirmed', 'Confirmed'),
        ('failed', 'Failed'),
    ]

    TYPE_CHOICES = [
        ('entry_fee', 'Entry Fee'),
        ('payout', 'Payout'),
        ('transfer', 'Loot Transfer'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    game_session = models.ForeignKey(GameSession, on_delete=models.CASCADE, null=True, blank=True)
    transaction_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    sol_amount = models.DecimalField(max_digits=18, decimal_places=9)
    transaction_hash = models.CharField(max_length=100, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.transaction_type} - {self.sol_amount} SOL"
