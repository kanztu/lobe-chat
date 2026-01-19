#!/bin/bash
# Check your database state to diagnose migration issues

POSTGRES="${1:-lobe-postgres}"
DB="${2:-lobe_chat}"

echo "===================================="
echo "Database State Diagnostic"
echo "===================================="
echo ""

echo "1️⃣ Check which agent tables exist:"
docker exec $POSTGRES psql -U postgres -d $DB -c "\
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename LIKE 'agent%'
  ORDER BY tablename;"
echo ""

echo "2️⃣ Check migration history (last 10):"
docker exec $POSTGRES psql -U postgres -d $DB -c "\
  SELECT id, created_at
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  LIMIT 10;"
echo ""

echo "3️⃣ Check if agent_cron_jobs table exists specifically:"
if docker exec $POSTGRES psql -U postgres -d $DB -c "\d agent_cron_jobs" 2>&1 | grep -q "Did not find"; then
    echo "   ❌ agent_cron_jobs table DOES NOT EXIST"
    echo "   → Migration 0067 might not have run"
    echo "   → OR you're on older version without cron jobs"
    echo ""
    echo "   SOLUTION: Skip renaming, create fresh agent_triggers table"
else
    echo "   ✅ agent_cron_jobs table EXISTS"
    echo "   → Can be renamed to agent_triggers"
fi
echo ""

echo "4️⃣ Check if agent_triggers table exists:"
if docker exec $POSTGRES psql -U postgres -d $DB -c "\d agent_triggers" 2>&1 | grep -q "Did not find"; then
    echo "   ❌ agent_triggers table DOES NOT EXIST (expected)"
else
    echo "   ✅ agent_triggers table ALREADY EXISTS"
    echo "   → Migration 0070 might have already run partially"
fi
echo ""

echo "5️⃣ Check startup logs for migration errors:"
docker logs lobe-chat 2>&1 | grep -A10 "migration" | grep -E "(error|Error|ERROR|failed)" || echo "   No migration errors in logs"
echo ""

echo "===================================="
echo "Diagnosis:"
echo "===================================="
echo ""
echo "Run this output and send it to me for analysis."
