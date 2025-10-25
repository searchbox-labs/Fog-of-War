from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q
from .models import User
from .serializers import (
    UserSerializer
)

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    
    @action(detail=False, methods=['get'])
    def leaderboard(self, request):
        users = User.objects.order_by('-total_sol_extracted')[:100]
        serializer = self.get_serializer(users, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def search(self, request):
        query = request.GET.get('q', '')
        users = User.objects.filter(
            Q(username__icontains=query) | Q(wallet_address__icontains=query)
        )[:10]
        serializer = self.get_serializer(users, many=True)
        return Response(serializer.data)
    
    
