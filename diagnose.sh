#!/bin/bash
# Simple diagnostic - run this on your deployment machine

echo "🔍 LobeChat Migration Diagnostic"
echo "================================"
echo ""

# 1. Most critical check
echo "1. Is DATABASE_DRIVER set?"
docker exec lobe-chat env | grep -E "^DATABASE_DRIVER=" || echo "   ❌ NOT SET - THIS IS THE PROBLEM!"
echo ""

# 2. Check startup logs for migration
echo "2. Did migrations run?"
if docker logs lobe-chat 2>&1 | head -200 | grep -q "\[Database\] Start to migration"; then
    echo "   ✅ Migrations attempted"
    docker logs lobe-chat 2>&1 | grep -A5 "Start to migration"
else
    echo "   ❌ NO MIGRATION LOGS FOUND"
    echo "   → If DATABASE_DRIVER is not set, migrations are skipped"
    echo "   → Check your docker-compose.yml or docker run command"
fi
echo ""

# 3. Show first 50 lines of logs
echo "3. First 50 lines of startup logs:"
echo "---"
docker logs lobe-chat 2>&1 | head -50
echo "---"
echo ""

echo "================================"
echo "DIAGNOSIS:"
echo "================================"
echo ""
echo "If DATABASE_DRIVER is NOT SET:"
echo "  → Migrations are skipped (startServer.js line 130)"
echo "  → Tables won't be created"
echo "  → Worker will fail"
echo ""
echo "FIX: Add to docker-compose.yml:"
echo "  environment:"
echo "    DATABASE_DRIVER: node"
echo ""
echo "Then: docker-compose restart"
