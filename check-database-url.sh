#!/bin/bash
echo "=== Checking DATABASE_URL ==="
echo ""

echo "1. Full DATABASE_URL in container:"
docker exec lobe-chat env | grep "^DATABASE_URL="
echo ""

echo "2. Testing database connection from container:"
docker exec lobe-chat /bin/node -e "
const { Pool } = require('pg');
const url = process.env.DATABASE_URL;
console.log('DATABASE_URL:', url);
if (url.includes('\${')) {
  console.log('❌ ERROR: Variables not substituted!');
  console.log('   Fix: Set POSTGRES_PASSWORD and LOBE_DB_NAME in docker-compose');
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
pool.query('SELECT 1')
  .then(() => console.log('✅ Database connection works'))
  .catch(err => {
    console.log('❌ Database connection FAILED:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
"
echo ""

echo "3. Manually run migration script to see error:"
docker exec lobe-chat /bin/node /app/docker.cjs
