from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/game/(?P<game_session_id>[^/]+)/$', consumers.GameConsumer.as_asgi()),
]
