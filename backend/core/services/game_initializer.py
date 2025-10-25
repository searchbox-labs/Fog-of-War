# core/services/game_initializer.py
import random
from decimal import Decimal
from django.utils import timezone
from ..models import GameSession, LootItem
from .arcium_service import ArciumService

class GameInitializer:
    def initialize_game_session(self, game_session):
        """Initialize a game session with loot distribution"""
        
        # Calculate loot distribution
        total_prize_pool = game_session.prize_pool
        final_chest_amount = total_prize_pool * Decimal('0.4')  # 40% to final chest
        distributed_loot = total_prize_pool - final_chest_amount
        
        # Create loot items
        loot_items = []
        
        # Final chest
        loot_items.append({
            'item_type': 'final_chest',
            'sol_value': final_chest_amount,
            'position_x': random.uniform(40, 60),  # Center of map
            'position_y': random.uniform(40, 60)
        })
        
        # Distributed loot piles
        num_loot_piles = random.randint(20, 30)
        for i in range(num_loot_piles):
            loot_value = distributed_loot / num_loot_piles * random.uniform(0.5, 1.5)
            loot_items.append({
                'item_type': random.choice(['small', 'medium', 'large']),
                'sol_value': loot_value,
                'position_x': random.uniform(5, 95),
                'position_y': random.uniform(5, 95)
            })
        
        # Encrypt loot distribution using Arcium
        arcium_service = ArciumService()
        encrypted_loot_data = arcium_service.encrypt_loot_distribution(
            str(game_session.id),
            {'loot_items': loot_items}
        )
        
        game_session.encrypted_loot_data = encrypted_loot_data
        game_session.save()
        
        # Create LootItem records with encrypted positions
        for loot_data in loot_items:
            LootItem.objects.create(
                game_session=game_session,
                item_type=loot_data['item_type'],
                sol_value=loot_data['sol_value'],
                encrypted_position_x=arcium_service.encrypt_value(str(loot_data['position_x'])),
                encrypted_position_y=arcium_service.encrypt_value(str(loot_data['position_y']))
            )
        
        return loot_items