# core/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    GameSessionViewSet, PlayerSessionViewSet, GameEventViewSet,
    WalletConnectView, EncryptLootView, DecryptLootView, TransferLootView,
    LeaderboardView, ExtractLootView, CollectLootView, CreateGameView,
    PlayerMovementView
)

router = DefaultRouter()
router.register(r'games', GameSessionViewSet)
router.register(r'player-sessions', PlayerSessionViewSet)
router.register(r'events', GameEventViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('auth/', include('rest_framework.urls')),
    path('wallet/connect/', WalletConnectView.as_view(), name='wallet-connect'),
    path('loot/encrypt/', EncryptLootView.as_view(), name='encrypt-loot'),
    path('loot/decrypt/', DecryptLootView.as_view(), name='decrypt-loot'),
    path('transactions/transfer/', TransferLootView.as_view(), name='transfer-loot'),
    path('leaderboard/', LeaderboardView.as_view(), name='leaderboard'),
    path('game/extract/', ExtractLootView.as_view(), name='extract-loot'),
    path('game/collect-loot/', CollectLootView.as_view(), name='collect-loot'),
    
    path('api/games/create/', CreateGameView.as_view(), name='create-game'),
    path('api/game/move/', PlayerMovementView.as_view(), name='player-move'),
]