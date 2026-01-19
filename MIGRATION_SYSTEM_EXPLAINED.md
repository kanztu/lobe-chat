# LobeChat Migration System - How It Works

## Overview

LobeChat has **two deployment modes**:

### 1. Database Mode (Full Features)
```bash
DATABASE_DRIVER=node  # Enables database features
DATABASE_URL=postgres://...
```
- ✅ Runs migrations automatically on startup
- ✅ Full agent system, memory, files, knowledge bases
- ✅ Multi-user support
- ✅ Persistent data

### 2. Static Mode (Lightweight)
```bash
# No DATABASE_DRIVER set
```
- ❌ No automatic migrations
- ❌ No database persistence
- ✅ Works with browser storage only
- ✅ Single-user, ephemeral

---

## Migration Flow (Database Mode)

### Startup Sequence

```
Docker Container Starts
     │
     ▼
startServer.js runs
     │
     ├─ Check: if (DATABASE_DRIVER) ?
     │     ↓ YES
     │     ├─ Run docker.cjs (migration script)
     │     │    │
     │     │    ├─ Load Drizzle migrator
     │     │    ├─ Connect to PostgreSQL
     │     │    ├─ Check drizzle.__drizzle_migrations table
     │     │    ├─ Run new .sql files in /app/migrations/
     │     │    └─ Mark migrations as complete
     │     │
     │     └─ ✅ database migration pass
     │
     ▼
server.js starts (Next.js)
     │
     ├─ instrumentation.ts register() hook runs
     │    │
     │    ├─ Check: if (DATABASE_DRIVER === 'node' && START_WORKER !== 'false') ?
     │    │     ↓ YES
     │    │     └─ Start TriggerQueueWorker
     │    │           ├─ cronSchedulerLoop()
     │    │           └─ queueProcessorLoop()
     │    │
     │    └─ Telemetry (if ENABLE_TELEMETRY)
     │
     ▼
✓ Ready on http://0.0.0.0:3210
```

---

## Why DATABASE_DRIVER Exists

**Purpose:** Distinguish between database and static deployments

**Without DATABASE_DRIVER:**
- Migrations don't run (static mode assumed)
- Database features disabled
- App uses browser storage only

**With DATABASE_DRIVER=node:**
- Migrations run automatically
- Database features enabled
- App uses PostgreSQL

---

## Your Existing Setup

**You said:** "my deployment is in another instance with latest code"

**This means you SHOULD have:**
- ✅ DATABASE_DRIVER=node (otherwise existing database wouldn't work)
- ✅ DATABASE_URL pointing to your PostgreSQL
- ✅ Existing migrations 0001-0069 already ran (you have agent_cron_jobs table)

**But new migrations (0070, 0071) aren't running**

---

## Possible Causes

### Cause 1: Docker Build Cache

Docker cached old layers without new migrations:

```bash
# Check if migrations 0070/0071 are in source code
ls packages/database/migrations/ | grep -E "007[01]"

# Should show:
# 0070_extend_agent_triggers.sql
# 0071_create_trigger_queue.sql
```

**If present in source but missing from Docker:**

```bash
# Force rebuild without cache
docker build --no-cache -t lobe-chat:latest .
docker-compose down
docker-compose up -d
```

### Cause 2: Migration Already Marked as Run (Drizzle tracking)

Drizzle tracks which migrations ran in `drizzle.__drizzle_migrations` table.

**Check migration history:**

```bash
docker exec lobe-postgres psql -U postgres -d lobe_chat -c \
  "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 10;"
```

**If you see migrations 70 and 71 already marked:**
- They ran, but tables weren't created (migration failed silently)
- Check PostgreSQL logs for errors

**If you DON'T see 70 and 71:**
- Migrations never attempted
- Check if files are in Docker image

### Cause 3: Wrong Migration Folder Path

**Check where Docker looks for migrations:**

```bash
docker exec lobe-chat ls -la /app/migrations/ | tail -10
```

**Should show:** 0001.sql through 0071.sql

**If 0070/0071 missing:**
- Docker image doesn't have them
- Rebuild needed

### Cause 4: Migration Failed With Error

**Check full startup logs:**

```bash
docker logs lobe-chat 2>&1 | head -200 > /tmp/startup-logs.txt
cat /tmp/startup-logs.txt | grep -E "(migration|error|Error|ERROR)" | head -50
```

**Look for:**
- `❌ Error during DB migration:`
- SQL errors
- Connection errors

---

## Diagnostic Command

**Run this to get all info at once:**

```bash
echo "=== Migration Files in Source ==="
ls -la packages/database/migrations/ | grep -E "007[01]"

echo -e "\n=== Migration Files in Docker ==="
docker exec lobe-chat ls -la /app/migrations/ | grep -E "007[01]"

echo -e "\n=== Environment ==="
docker exec lobe-chat env | grep DATABASE

echo -e "\n=== Startup Logs ==="
docker logs lobe-chat 2>&1 | grep -E "(migration|Migration)" | head -10

echo -e "\n=== Tables in Database ==="
docker exec lobe-postgres psql -U postgres -d lobe_chat -c "\dt agent_*"

echo -e "\n=== Migration History ==="
docker exec lobe-postgres psql -U postgres -d lobe_chat -c \
  "SELECT id, created_at FROM drizzle.__drizzle_migrations WHERE id >= 67 ORDER BY id;"
```

---

## Most Likely Issue

**Since you have existing database working:**
- ✅ DATABASE_DRIVER is already set
- ✅ DATABASE_URL is correct
- ✅ Migrations 0001-0069 already ran

**Problem:**
- ❌ Docker image doesn't have migrations 0070/0071
- ❌ Built from old code OR build cache issue

**Solution:**
```bash
# On deployment instance
git pull origin next  # Get latest with migrations
docker build --no-cache -t lobe-chat:latest .  # Force rebuild
docker-compose restart
```

---

## The Answer to Your Question

**Why DATABASE_DRIVER?**

It's been in LobeChat since the beginning to support two deployment modes:
1. **Database mode** (DATABASE_DRIVER=node) - Full features
2. **Static mode** (no driver) - Browser-only

**Your existing migration process:**
- DATABASE_DRIVER=node → migrations run on every startup
- Drizzle tracks which ran → only new ones execute
- You already have migrations 0001-0069 completed

**Why new migrations aren't running:**
- Most likely: Docker image built before my commits reached your deployment
- Less likely: Build cache prevented copying new files
- Unlikely: DATABASE_DRIVER somehow not set

**Run the diagnostic command above to confirm!**
