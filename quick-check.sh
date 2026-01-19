#!/bin/bash
# Quick check for the most common issue

CONTAINER="${1:-lobe-chat}"

echo "🔍 Quick Check: Agent Trigger Migrations"
echo ""

# Most common issue: Old Docker image
echo "Checking if migrations exist in container..."
if docker exec $CONTAINER test -f /app/migrations/0070_extend_agent_triggers.sql 2>/dev/null; then
    echo "✅ Migration 0070 exists"
else
    echo "❌ Migration 0070 MISSING"
    echo ""
    echo "🎯 ROOT CAUSE: Docker image is OLD (built before trigger system)"
    echo ""
    echo "FIX:"
    echo "  1. On your deployment instance, rebuild Docker:"
    echo "     docker build -t lobe-chat:latest ."
    echo ""
    echo "  2. Restart container:"
    echo "     docker-compose restart"
    echo "     # or: docker restart $CONTAINER"
    exit 1
fi

if docker exec $CONTAINER test -f /app/migrations/0071_create_trigger_queue.sql 2>/dev/null; then
    echo "✅ Migration 0071 exists"
else
    echo "❌ Migration 0071 MISSING"
    echo "🎯 ROOT CAUSE: Docker image is OLD"
    echo "FIX: Rebuild Docker image"
    exit 1
fi

echo ""
echo "✅ Migration files exist in container"
echo ""
echo "Checking DATABASE_DRIVER..."
if docker exec $CONTAINER env | grep -q "DATABASE_DRIVER=node"; then
    echo "✅ DATABASE_DRIVER=node is set"
else
    echo "❌ DATABASE_DRIVER not set or wrong value"
    echo ""
    echo "🎯 ROOT CAUSE: DATABASE_DRIVER not configured"
    echo ""
    echo "FIX: Add to your docker-compose.yml:"
    echo "  environment:"
    echo "    DATABASE_DRIVER: node"
    exit 1
fi

echo ""
echo "✅ Configuration looks correct"
echo ""
echo "Checking if migrations ran..."
docker logs $CONTAINER 2>&1 | grep -q "database migration pass" && \
    echo "✅ Migrations completed successfully" || \
    echo "❌ Migrations might not have run - check full logs:"
echo ""
echo "Next steps:"
echo "  1. Check full startup logs: docker logs $CONTAINER 2>&1 | head -100"
echo "  2. Check if tables exist: docker exec lobe-postgres psql -U postgres -d lobe_chat -c \"\\dt agent_trigger*\""
echo "  3. If tables missing, migrations failed - check logs for errors"
