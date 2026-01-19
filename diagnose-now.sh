#!/bin/bash
# One-command diagnosis for agent trigger migration issue
# Usage: ./diagnose-now.sh [container-name] [postgres-container-name]

CONTAINER="${1:-lobe-chat}"
POSTGRES="${2:-lobe-postgres}"

echo "🔍 Agent Trigger Migration Diagnosis"
echo "===================================="
echo ""

# Function to check command
check_migration_files_source() {
    echo "📁 Migration Files in Source Code:"
    if [ -f packages/database/migrations/0070_extend_agent_triggers.sql ]; then
        echo "   ✅ 0070_extend_agent_triggers.sql present"
    else
        echo "   ❌ 0070 MISSING in source - git pull needed"
    fi

    if [ -f packages/database/migrations/0071_create_trigger_queue.sql ]; then
        echo "   ✅ 0071_create_trigger_queue.sql present"
    else
        echo "   ❌ 0071 MISSING in source - git pull needed"
    fi
    echo ""
}

check_migration_files_docker() {
    echo "🐳 Migration Files in Docker Container:"
    if docker exec $CONTAINER test -f /app/migrations/0070_extend_agent_triggers.sql 2>/dev/null; then
        echo "   ✅ 0070_extend_agent_triggers.sql in container"
    else
        echo "   ❌ 0070 MISSING in container"
        echo "   → 🎯 ROOT CAUSE: Docker image is OLD"
        echo "   → FIX: docker build --no-cache -t lobe-chat:latest ."
        return 1
    fi

    if docker exec $CONTAINER test -f /app/migrations/0071_create_trigger_queue.sql 2>/dev/null; then
        echo "   ✅ 0071_create_trigger_queue.sql in container"
    else
        echo "   ❌ 0071 MISSING in container"
        echo "   → 🎯 ROOT CAUSE: Docker image is OLD"
        echo "   → FIX: docker build --no-cache -t lobe-chat:latest ."
        return 1
    fi
    echo ""
    return 0
}

check_database_driver() {
    echo "⚙️  DATABASE_DRIVER Configuration:"
    if docker exec $CONTAINER env 2>/dev/null | grep -q "DATABASE_DRIVER=node"; then
        echo "   ✅ DATABASE_DRIVER=node is set"
    else
        echo "   ❌ DATABASE_DRIVER not set or wrong value"
        echo "   → 🎯 ROOT CAUSE: DATABASE_DRIVER missing"
        echo "   → FIX: Add DATABASE_DRIVER=node to docker-compose.yml"
        return 1
    fi
    echo ""
    return 0
}

check_migrations_ran() {
    echo "📊 Migration Execution Status:"
    if docker logs $CONTAINER 2>&1 | grep -q "database migration pass"; then
        echo "   ✅ Migrations completed successfully"
    else
        echo "   ❌ No migration success message in logs"
        echo "   → Migrations may not have run"
    fi
    echo ""
}

check_tables() {
    echo "🗄️  Database Tables:"
    TABLES=$(docker exec $POSTGRES psql -U postgres -d lobe_chat -t -c \
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'agent_trigger%';" 2>/dev/null | tr -d ' ')

    if echo "$TABLES" | grep -q "agent_triggers"; then
        echo "   ✅ agent_triggers table exists"
    else
        echo "   ❌ agent_triggers table MISSING"
    fi

    if echo "$TABLES" | grep -q "agent_trigger_queue"; then
        echo "   ✅ agent_trigger_queue table exists"
    else
        echo "   ❌ agent_trigger_queue table MISSING"
    fi

    # Check old table
    OLD_TABLE=$(docker exec $POSTGRES psql -U postgres -d lobe_chat -t -c \
        "SELECT tablename FROM pg_tables WHERE tablename='agent_cron_jobs';" 2>/dev/null | tr -d ' ')

    if [ -n "$OLD_TABLE" ]; then
        echo "   ⚠️  agent_cron_jobs (old table) still exists"
        echo "       → Migration 0070 hasn't run yet (renames to agent_triggers)"
    fi
    echo ""
}

check_migration_history() {
    echo "📜 Drizzle Migration History (last 5):"
    docker exec $POSTGRES psql -U postgres -d lobe_chat -t -c \
        "SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || \
        echo "   ❌ Could not query migration history"
    echo ""
}

# Run all checks
check_migration_files_source
DOCKER_FILES_OK=$(check_migration_files_docker && echo "yes" || echo "no")
DB_DRIVER_OK=$(check_database_driver && echo "yes" || echo "no")
check_migrations_ran
check_tables
check_migration_history

# Summary
echo "===================================="
echo "🎯 DIAGNOSIS SUMMARY"
echo "===================================="
echo ""

if [ "$DOCKER_FILES_OK" = "no" ]; then
    echo "🔴 PROBLEM: Docker image doesn't have migrations 0070/0071"
    echo ""
    echo "SOLUTION:"
    echo "  cd /path/to/lobe-chat"
    echo "  git pull origin next"
    echo "  docker build --no-cache -t lobe-chat:latest ."
    echo "  docker-compose down && docker-compose up -d"
    echo ""
elif [ "$DB_DRIVER_OK" = "no" ]; then
    echo "🔴 PROBLEM: DATABASE_DRIVER not configured"
    echo ""
    echo "SOLUTION:"
    echo "  Add to docker-compose.yml:"
    echo "    environment:"
    echo "      DATABASE_DRIVER: node"
    echo "  Then: docker-compose restart"
    echo ""
else
    echo "🟡 UNCLEAR: Configuration looks correct but tables missing"
    echo ""
    echo "Possible causes:"
    echo "  1. Migrations failed with error (check logs above)"
    echo "  2. Wrong database being queried"
    echo "  3. Migration script path issue"
    echo ""
    echo "Debug further:"
    echo "  docker logs $CONTAINER 2>&1 | grep -A20 'Start to migration'"
    echo ""
fi
