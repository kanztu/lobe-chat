# Agent Trigger System - Deployment Guide

## Overview

The event-driven agent trigger system allows agents to be automatically triggered by:
- **Time-based (Cron)**: Schedule regular executions
- **Webhooks**: External HTTP POST events (GitHub, Stripe, etc.)
- **API Triggers**: Authenticated REST endpoints
- **Manual**: On-demand execution via UI

---

## Docker Deployment

### Environment Variables

#### Required:
```bash
DATABASE_URL=postgres://user:pass@host:5432/dbname
DATABASE_DRIVER=node  # Also auto-starts trigger queue worker
```

#### Optional - Disable Worker:
```bash
START_WORKER=false  # Disable worker (for development/serverless/separate worker container)
```

**Note:** Worker starts automatically when `DATABASE_DRIVER=node`. Only set `START_WORKER=false` if you want to disable it.

### What Happens on Docker Startup

**1. Automatic Migrations ✅**
```
[Database] Start to migration...
  → Running 0070_extend_agent_triggers.sql
  → Running 0071_create_trigger_queue.sql
✅ database migration pass.
```

**2. Worker Initialization (automatic in database mode) ✅**
```
🚀 Trigger Queue Worker started
  → Cron scheduler loop: checks every 30s
  → Queue processor loop: processes every 1s
```

**Note:** Worker starts automatically because `DATABASE_DRIVER=node` is set.

**3. Server Start ✅**
```
✓ Ready on http://0.0.0.0:3210
```

### Docker Run Command

```bash
docker run -d \
  --name lobe-chat \
  -p 3210:3210 \
  -e DATABASE_URL="postgres://user:pass@host:5432/lobe_chat" \
  -e DATABASE_DRIVER="node" \
  -e KEY_VAULTS_SECRET="your-secret-key" \
  lobe-chat:latest

# Note: Worker starts automatically with DATABASE_DRIVER=node
# To disable: add -e START_WORKER="false"
```

### Docker Compose

```yaml
version: '3.8'

services:
  lobe-chat:
    image: lobe-chat:latest
    ports:
      - "3210:3210"
    environment:
      # Database (also auto-starts worker)
      DATABASE_URL: postgres://user:pass@postgres:5432/lobe_chat
      DATABASE_DRIVER: node

      # Security
      KEY_VAULTS_SECRET: your-secret-key

      # Other config...
      NODE_ENV: production

      # Optional: Disable worker if needed
      # START_WORKER: "false"
    depends_on:
      - postgres

  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: password
      POSTGRES_DB: lobe_chat
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## Understanding Worker Auto-Start

### Default Behavior

**Worker starts automatically when:**
- ✅ `DATABASE_DRIVER=node` (database mode detected)
- ✅ `START_WORKER` is not set OR not `false`

**This means:**
- ✅ Docker deployments: Worker runs by default
- ✅ Self-hosted: Worker runs by default
- ✅ No configuration needed for typical deployments

**Worker does NOT start when:**
- ❌ `DATABASE_DRIVER` is not set (serverless/static mode)
- ❌ `START_WORKER=false` (explicitly disabled)

### What the Worker Does

**When running:**
- ✅ Runs **cron scheduler loop** (checks for due cron triggers every 30s)
- ✅ Runs **queue processor loop** (processes webhook/API jobs every 1s)
- ✅ Executes agents automatically
- ✅ Updates execution statistics
- ✅ Handles retries with exponential backoff

**When disabled:**
- ❌ No background processing
- ❌ Cron triggers won't execute
- ❌ Webhook jobs will queue but never process
- ✅ Webhooks still accepted (queued for later)
- ✅ UI still works for creating/managing triggers

### When to Disable (START_WORKER=false)

**Use cases for disabling:**
1. **Development:** Don't want background loops during local dev
2. **Serverless (Vercel):** Can't support long-running processes
3. **Separate worker container:** Web and worker run in different containers
4. **Testing:** Unit tests don't need worker running

### Deployment Scenarios

#### Scenario 1: Single Docker Container (Recommended for Most Users)
```bash
DATABASE_DRIVER=node  # Worker auto-starts
```
- Worker runs automatically in same container as Next.js server
- Simple deployment, zero configuration
- Good for: < 1000 triggers, < 10,000 executions/day
- **This is the default behavior - just works!**

#### Scenario 2: Separate Worker Container (Recommended for Scale)
```yaml
services:
  lobe-chat-web:
    image: lobe-chat:latest
    environment:
      DATABASE_URL: ...
      DATABASE_DRIVER: node
      START_WORKER: "false"  # Disable worker (web server only)

  lobe-chat-worker:
    image: lobe-chat:latest
    environment:
      DATABASE_URL: ...
      DATABASE_DRIVER: node  # Worker auto-starts
    # No START_WORKER needed - auto-starts by default
```
- Separate scaling: scale web and worker independently
- Better resource allocation
- Good for: > 1000 triggers, > 10,000 executions/day
- **Note:** FOR UPDATE SKIP LOCKED prevents duplicate job processing

#### Scenario 3: Serverless (Vercel) - Alternative Approach
```yaml
# vercel.json
{
  "crons": [
    {
      "path": "/api/cron/process-triggers",
      "schedule": "* * * * *"  # Every minute
    }
  ]
}
```
- Use Vercel Cron to trigger periodic checks
- No background worker needed
- Webhook jobs still queued and processed

---

## Migration Behavior

### Automatic Migration on Docker Start

**Docker's startServer.js automatically runs migrations:**

```javascript
if (process.env.DATABASE_DRIVER) {
  await runScript('/app/docker.cjs');  // ← Runs Drizzle migrations
}
await runServer();  // ← Starts Next.js
```

**What Gets Migrated:**

1. **Migration 0070**: `agent_cron_jobs` → `agent_triggers`
   - Adds `trigger_type` column (default: 'cron')
   - Adds `trigger_config` JSONB column
   - Migrates existing cron jobs to new structure
   - **Backward compatible** - existing cron jobs still work

2. **Migration 0071**: Creates `agent_trigger_queue` table
   - Queue for async execution
   - Retry logic support
   - Idempotency support

**Safe to restart:** Migrations only run once per database (tracked by Drizzle)

---

## Testing Your Deployment

### 1. Check Migrations Ran

```bash
docker logs lobe-chat | grep -A5 "Start to migration"
```

Expected output:
```
[Database] Start to migration...
✅ database migration pass.
```

### 2. Check Worker Started

```bash
docker logs lobe-chat | grep "Trigger Queue Worker"
```

Expected output:
```
🚀 Trigger Queue Worker started
```

### 3. Check Database Tables

```bash
docker exec -it postgres psql -U user -d lobe_chat -c "\dt agent_trigger*"
```

Expected output:
```
              List of relations
 Schema |         Name           | Type  | Owner
--------+------------------------+-------+-------
 public | agent_triggers         | table | user
 public | agent_trigger_queue    | table | user
```

### 4. Test Webhook Endpoint

```bash
curl -X POST http://localhost:3210/api/webhooks/trigger/trg_test \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

Expected response:
```json
{
  "success": true,
  "jobId": "queue_abc123",
  "message": "Agent execution queued"
}
```

---

## Troubleshooting

### Worker Not Starting

**Problem:** No "Trigger Queue Worker started" in logs

**Check:**
1. Is `START_WORKER=true` set?
   ```bash
   docker exec lobe-chat env | grep START_WORKER
   ```

2. Check instrumentation loaded:
   ```bash
   docker logs lobe-chat | grep instrumentation
   ```

**Solution:** Ensure `START_WORKER=true` in environment

### Migrations Not Running

**Problem:** Tables not created

**Check:**
1. Is `DATABASE_DRIVER` set?
   ```bash
   docker exec lobe-chat env | grep DATABASE_DRIVER
   ```

2. Check database connection:
   ```bash
   docker exec lobe-chat /bin/node -e "require('pg').Pool({connectionString:process.env.DATABASE_URL}).query('SELECT 1')"
   ```

**Solution:** Set `DATABASE_DRIVER=node`

### Webhooks Not Processing

**Problem:** Jobs queue but never execute

**Symptoms:**
```sql
SELECT * FROM agent_trigger_queue WHERE status='pending';
-- Returns pending jobs
```

**Cause:** Worker not running

**Solution:** Set `START_WORKER=true` and restart

---

## Production Recommendations

### For Self-Hosted Docker:

```bash
# Required
DATABASE_URL=...
DATABASE_DRIVER=node  # Worker auto-starts

# Recommended
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1

# Optional: Disable worker if running separate worker container
# START_WORKER=false
```

### For Kubernetes:

```yaml
# Deployment with auto-starting worker
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lobe-chat
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: lobe-chat
        image: lobe-chat:latest
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        - name: DATABASE_DRIVER
          value: "node"  # Worker auto-starts
        # Worker auto-starts in all replicas
        # FOR UPDATE SKIP LOCKED prevents duplicate processing
```

### For Vercel/Serverless:

- **Worker:** Auto-disabled (DATABASE_DRIVER not set in serverless mode)
- **Migrations:** Run via `bun run db:migrate` in CI/CD before deploy
- **Alternative:** Use Vercel Cron or external scheduler (GitHub Actions) to trigger periodic checks

---

## Performance Tuning

### Adjust Worker Poll Intervals

Edit `src/server/workers/triggerQueueWorker.ts`:

```typescript
// Cron check frequency (default: 30s)
await this.sleep(30000);  // Increase to 60000 for lower CPU

// Queue poll frequency (default: 1s)
await this.sleep(1000);   // Increase to 5000 for lower CPU
```

### Database Connection Pool

For high-throughput deployments, tune PostgreSQL connection pool:

```bash
DATABASE_URL="postgres://user:pass@host:5432/db?pool_min=5&pool_max=20"
```

---

## Summary

**Worker Auto-Start Behavior:**
- ✅ **Starts automatically** when `DATABASE_DRIVER=node` (database mode)
- ✅ No `START_WORKER` flag needed for typical deployments
- ✅ Set `START_WORKER=false` to disable (optional, for edge cases)

**What the worker does:**
- ✅ Processes webhook triggers automatically
- ✅ Executes scheduled cron jobs
- ✅ Handles retries and error recovery
- ✅ Works across multiple replicas (FOR UPDATE SKIP LOCKED)

**Docker deployments:**
- ✅ Migrations run automatically (no manual intervention)
- ✅ Worker starts automatically (no configuration needed)
- ✅ All triggered agents execute in background

**Just deploy - it works out of the box!** 🚀
