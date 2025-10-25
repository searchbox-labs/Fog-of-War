from rest_framework import serializers
from .models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'wallet_address', 'sol_balance', 'total_games_played', 
                 'total_sol_extracted', 'successful_extractions', 'eliminations', 'avatar_url']
