# Fix: agent_trigger_queue Table Missing

## Error You're Seeing

```
error: relation "agent_trigger_queue" does not exist
code: '42P01'
```

## Root Cause

**Your Docker image doesn't include the new migrations** (0070, 0071) because it was built before the trigger system was added.

---

## Diagnosis Steps

### Step 1: Check if Migrations Exist in Container

```bash
docker exec lobe-chat ls /app/migrations/ | grep -E "0070|0071"
```

**If NO OUTPUT:**
- 🎯 **ROOT CAUSE CONFIRMED:** Docker image is old
- **Solution:** Rebuild Docker image (see below)

**If SHOWS FILES:**
- Migrations exist, but didn't run
- Check Step 2

### Step 2: Check DATABASE_DRIVER

```bash
docker exec lobe-chat env | grep DATABASE_DRIVER
```

**Expected:** `DATABASE_DRIVER=node`

**If MISSING:**
- 🎯 **ROOT CAUSE:** DATABASE_DRIVER not set
- **Solution:** Add to environment (see below)

### Step 3: Check Migration Logs

```bash
docker logs lobe-chat 2>&1 | grep -A5 "migration"
```

**Expected to see:**
```
[Database] Start to migration...
✅ database migration pass.
```

**If NOTHING:**
- Migrations never ran
- Usually means DATABASE_DRIVER not set

**If SEE ERRORS:**
- Migrations attempted but failed
- Check error message

---

## Fix 1: Rebuild Docker Image (Most Common)

**On your deployment instance, run:**

```bash
# Navigate to lobe-chat directory with latest code
cd /path/to/lobe-chat

# Rebuild Docker image
docker build -t lobe-chat:latest .

# Restart container
docker-compose down
docker-compose up -d

# Or if using docker run:
docker stop lobe-chat
docker rm lobe-chat
docker run -d \
  --name lobe-chat \
  -p 3210:3210 \
  -e DATABASE_URL="your-postgres-url" \
  -e DATABASE_DRIVER="node" \
  lobe-chat:latest
```

**Verify fix:**
```bash
docker logs lobe-chat 2>&1 | grep "database migration pass"
# Should see: ✅ database migration pass.

docker logs lobe-chat 2>&1 | grep "Trigger Queue Worker"
# Should see: 🚀 Trigger Queue Worker started
```

---

## Fix 2: Set DATABASE_DRIVER (If Missing)

**Edit your docker-compose.yml:**

```yaml
services:
  lobe-chat:
    environment:
      DATABASE_URL: postgres://...
      DATABASE_DRIVER: node  # ← ADD THIS
```

**Then restart:**
```bash
docker-compose down
docker-compose up -d
```

---

## Fix 3: Manual Migration (Emergency Workaround)

**If you can't rebuild immediately, run migrations manually:**

```bash
# Copy migration files to container
docker cp packages/database/migrations/0070_extend_agent_triggers.sql lobe-chat:/tmp/
docker cp packages/database/migrations/0071_create_trigger_queue.sql lobe-chat:/tmp/

# Run migrations directly in PostgreSQL
docker exec -i lobe-postgres psql -U postgres -d lobe_chat < /tmp/0070_extend_agent_triggers.sql
docker exec -i lobe-postgres psql -U postgres -d lobe_chat < /tmp/0071_create_trigger_queue.sql

# Restart lobe-chat
docker restart lobe-chat
```

**Note:** This is a workaround. Proper fix is rebuilding the image.

---

## Verification

After fix, verify everything works:

### 1. Check Tables Exist

```bash
docker exec lobe-postgres psql -U postgres -d lobe_chat -c "SELECT tablename FROM pg_tables WHERE tablename IN ('agent_triggers', 'agent_trigger_queue');"
```

**Expected output:**
```
      tablename
---------------------
 agent_triggers
 agent_trigger_queue
```

### 2. Check Worker Running

```bash
docker logs lobe-chat 2>&1 | tail -50 | grep "error"
```

**Expected:** No more "agent_trigger_queue does not exist" errors

### 3. Check Migration History

```bash
docker exec lobe-postgres psql -U postgres -d lobe_chat -c "SELECT * FROM drizzle.__drizzle_migrations WHERE id >= 70;"
```

**Should show:** Migrations 70 and 71 with success status

---

## Quick Diagnostic Script

**Run this for automated diagnosis:**

```bash
./quick-check.sh lobe-chat lobe-postgres
```

**Or comprehensive:**

```bash
./debug-migrations.sh lobe-chat lobe-postgres
```

---

## Most Likely Issue

**95% of cases:** Docker image is old and doesn't include migrations 0070/0071.

**Fix:** Rebuild Docker image on deployment instance with latest code.

The migrations exist in your git repo (you pushed them), but your Docker image was built before these commits were available on the deployment instance.

---

## After Fix

Once migrations complete:
- ✅ `agent_triggers` table exists (extended from agent_cron_jobs)
- ✅ `agent_trigger_queue` table exists
- ✅ Worker starts without errors
- ✅ Webhook triggers will work
- ✅ Cron jobs continue working (backward compatible)
