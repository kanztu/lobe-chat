# Critical: DATABASE_DRIVER Not Set

## What Your Logs Show

**Missing from logs:**
```
[Database] Start to migration...
✅ database migration pass.
```

**Present in logs:**
```
Cron scheduler error: relation "agent_triggers" does not exist
```

## Root Cause

**Migrations are NOT running because `DATABASE_DRIVER` is not set.**

Looking at `startServer.js` line 130:
```javascript
if (process.env.DATABASE_DRIVER) {  // ← This check fails!
  await runScript(DB_MIGRATION_SCRIPT_PATH);
}
```

If `DATABASE_DRIVER` is not set, migrations are **completely skipped**.

---

## Check On Your Deployment Instance

```bash
# Check if DATABASE_DRIVER is set
docker exec lobe-chat env | grep DATABASE_DRIVER
```

**Expected:** `DATABASE_DRIVER=node`

**If NO OUTPUT:**
- 🎯 **ROOT CAUSE CONFIRMED:** DATABASE_DRIVER not set
- Migrations never run
- Tables never created

---

## Fix: Add DATABASE_DRIVER

### Option 1: docker-compose.yml

Edit your docker-compose.yml:

```yaml
services:
  lobe-chat:
    environment:
      DATABASE_URL: postgres://postgres:password@lobe-postgres:5432/lobe_chat
      DATABASE_DRIVER: node  # ← ADD THIS LINE
      KEY_VAULTS_SECRET: your-secret
```

Then:
```bash
docker-compose down
docker-compose up -d
```

### Option 2: docker run command

```bash
docker stop lobe-chat
docker rm lobe-chat

docker run -d \
  --name lobe-chat \
  -p 3210:3210 \
  -e DATABASE_URL="postgres://..." \
  -e DATABASE_DRIVER="node" \  # ← ADD THIS
  -e KEY_VAULTS_SECRET="..." \
  lobe-chat:latest
```

### Option 3: Environment File

Create `.env` file:
```bash
DATABASE_URL=postgres://...
DATABASE_DRIVER=node  # ← ADD THIS
KEY_VAULTS_SECRET=...
```

Then:
```bash
docker-compose --env-file .env up -d
```

---

## After Adding DATABASE_DRIVER

**On next startup, you'll see:**

```
[Database] Start to migration...
  Running 0001_...
  Running 0002_...
  ...
  Running 0070_extend_agent_triggers.sql
  Running 0071_create_trigger_queue.sql
✅ database migration pass.
-------------------------------------
🚀 Trigger Queue Worker started
-------------------------------------
✓ Ready on http://0.0.0.0:3210
```

**Tables will be created:**
- ✅ agent_triggers (renamed from agent_cron_jobs)
- ✅ agent_trigger_queue
- ✅ All other tables if they don't exist

**Worker will start successfully** - no more errors!

---

## Verification

```bash
# Check logs
docker logs lobe-chat 2>&1 | grep "database migration pass"

# Check tables exist
docker exec lobe-postgres psql -U postgres -d lobe_chat -c "\dt agent_trigger*"
```

---

## Why This Happens

LobeChat has two modes:
1. **Database mode** (DATABASE_DRIVER=node) - Full features, migrations run
2. **Static mode** (no DATABASE_DRIVER) - No database, no migrations

Your deployment is in database mode (you have PostgreSQL), but the env var is missing, so it thinks it's in static mode.

**Add `DATABASE_DRIVER=node` and restart - that's the fix!**
