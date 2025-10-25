from django.db import models
from django.contrib.auth.models import AbstractUser, Group, Permission

class User(AbstractUser):
    wallet_address = models.CharField(max_length=44, unique=True)  # Solana wallet address
    sol_balance = models.DecimalField(max_digits=18, decimal_places=9, default=0)
    total_games_played = models.IntegerField(default=0)
    total_sol_extracted = models.DecimalField(max_digits=18, decimal_places=9, default=0)
    successful_extractions = models.IntegerField(default=0)
    eliminations = models.IntegerField(default=0)
    avatar_url = models.URLField(blank=True, null=True)
    
    groups = models.ManyToManyField(Group, related_name='user_set_groups')
    user_permissions = models.ManyToManyField(Permission, related_name='user_set_permissions')
    
    def __str__(self):
        return f"{self.username} ({self.wallet_address[:8]}...)"