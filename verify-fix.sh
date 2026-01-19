#!/bin/bash
echo "=== Verifying DATABASE_DRIVER Fix ==="
echo ""

echo "1. Checking if DATABASE_DRIVER is in running container:"
docker exec lobe-chat env | grep "^DATABASE_DRIVER=" || echo "❌ NOT FOUND IN CONTAINER!"
echo ""

echo "2. Checking if migration script exists:"
docker exec lobe-chat test -f /app/docker.cjs && echo "✅ /app/docker.cjs exists" || echo "❌ /app/docker.cjs MISSING!"
echo ""

echo "3. Checking VERY FIRST lines of logs (migration should be here):"
docker logs lobe-chat 2>&1 | head -30
echo ""

echo "4. Searching for ANY migration message:"
docker logs lobe-chat 2>&1 | grep -i migration || echo "❌ NO MIGRATION LOGS AT ALL"
echo ""

echo "=== DIAGNOSIS ==="
echo "If DATABASE_DRIVER NOT in container → docker-compose not restarted properly"
echo "If docker.cjs missing → Docker image issue"
echo "If NO migration logs → DATABASE_DRIVER not being read OR migration script failing silently"
