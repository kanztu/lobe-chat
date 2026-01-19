#!/bin/bash
echo "Checking DATABASE_DRIVER in your running container..."
echo ""
docker exec lobe-chat env | grep DATABASE || echo "DATABASE_DRIVER not found in environment"
echo ""
echo "Checking if migrations folder exists..."
docker exec lobe-chat ls /app/migrations/ 2>&1 | tail -5
echo ""
echo "Checking startup logs for migration..."
docker logs lobe-chat 2>&1 | grep -E "\[Database\]|migration" | head -10
