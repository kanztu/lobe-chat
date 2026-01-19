#!/bin/bash
# Migration Debugging Script for Agent Trigger System

echo "=================================="
echo "Agent Trigger Migration Debugger"
echo "=================================="
echo ""

CONTAINER_NAME="${1:-lobe-chat}"

echo "📋 Checking container: $CONTAINER_NAME"
echo ""

# 1. Check if container is running
echo "1️⃣ Container Status:"
if docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -q "$CONTAINER_NAME"; then
    echo "   ✅ Container is running"
else
    echo "   ❌ Container is not running!"
    echo "   Run: docker ps -a | grep $CONTAINER_NAME"
    exit 1
fi
echo ""

# 2. Check DATABASE_DRIVER
echo "2️⃣ DATABASE_DRIVER Environment Variable:"
DB_DRIVER=$(docker exec $CONTAINER_NAME env | grep DATABASE_DRIVER || echo "NOT_SET")
if echo "$DB_DRIVER" | grep -q "node"; then
    echo "   ✅ DATABASE_DRIVER=node (migrations should run)"
else
    echo "   ❌ DATABASE_DRIVER not set or wrong value!"
    echo "   Current: $DB_DRIVER"
    echo "   Fix: Set DATABASE_DRIVER=node in your docker-compose.yml or docker run command"
    exit 1
fi
echo ""

# 3. Check if migration files exist in container
echo "3️⃣ Migration Files in Container:"
docker exec $CONTAINER_NAME ls -la /app/migrations/ 2>/dev/null | grep -E "0070|0071" || \
    echo "   ❌ Migration files 0070 or 0071 NOT FOUND in /app/migrations/"

if docker exec $CONTAINER_NAME ls /app/migrations/0070_extend_agent_triggers.sql >/dev/null 2>&1; then
    echo "   ✅ 0070_extend_agent_triggers.sql exists"
else
    echo "   ❌ 0070_extend_agent_triggers.sql MISSING!"
    echo "   → Docker image is OLD (built before trigger system)"
    echo "   → Solution: Rebuild Docker image with: docker build -t lobe-chat:latest ."
fi

if docker exec $CONTAINER_NAME ls /app/migrations/0071_create_trigger_queue.sql >/dev/null 2>&1; then
    echo "   ✅ 0071_create_trigger_queue.sql exists"
else
    echo "   ❌ 0071_create_trigger_queue.sql MISSING!"
    echo "   → Docker image is OLD (built before trigger system)"
    echo "   → Solution: Rebuild Docker image"
fi
echo ""

# 4. Check if docker.cjs exists
echo "4️⃣ Migration Script:"
if docker exec $CONTAINER_NAME ls /app/docker.cjs >/dev/null 2>&1; then
    echo "   ✅ /app/docker.cjs exists"
else
    echo "   ❌ /app/docker.cjs MISSING!"
fi
echo ""

# 5. Check startup logs for migration
echo "5️⃣ Startup Logs (Migration Section):"
docker logs $CONTAINER_NAME 2>&1 | grep -A5 -B2 "migration" | head -20
echo ""

# 6. Check if tables exist
echo "6️⃣ Database Tables:"
POSTGRES_CONTAINER="${2:-lobe-postgres}"
echo "   Checking in PostgreSQL container: $POSTGRES_CONTAINER"

# Try to check tables
if docker exec $POSTGRES_CONTAINER psql -U postgres -d lobe_chat -c "\dt agent_trigger*" 2>/dev/null; then
    echo "   ✅ Tables checked above"
else
    echo "   ❌ Could not query tables"
    echo "   Try manually: docker exec $POSTGRES_CONTAINER psql -U postgres -d lobe_chat -c \"\\dt agent_*\""
fi
echo ""

# 7. Check Drizzle migrations tracking table
echo "7️⃣ Drizzle Migration History:"
docker exec $POSTGRES_CONTAINER psql -U postgres -d lobe_chat -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || \
    echo "   ❌ Could not query migration history"
echo ""

# 8. Summary
echo "=================================="
echo "🔍 Diagnosis Summary"
echo "=================================="
echo ""
echo "If migrations 0070/0071 are MISSING from container:"
echo "  → Docker image is old, rebuild with: docker build -t lobe-chat:latest ."
echo ""
echo "If DATABASE_DRIVER is NOT SET:"
echo "  → Add to docker-compose.yml or docker run: -e DATABASE_DRIVER=node"
echo ""
echo "If migrations EXIST but tables DON'T:"
echo "  → Check full logs: docker logs $CONTAINER_NAME 2>&1 | grep -C10 migration"
echo "  → Migrations might have failed with an error"
echo ""
echo "If migrations RAN (in drizzle table) but tables MISSING:"
echo "  → Migration SQL might have errors, check migration files"
echo ""
